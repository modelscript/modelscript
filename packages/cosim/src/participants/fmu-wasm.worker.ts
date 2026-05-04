// SPDX-License-Identifier: AGPL-3.0-or-later
/// <reference lib="webworker" />

/**
 * Web Worker implementation for FMU-WASM simulation.
 *
 * This worker receives the extracted `model.ts` AssemblyScript source,
 * compiles it into WebAssembly using the `@assemblyscript/compiler`,
 * and runs the numerical integration steps off the main thread.
 *
 * This prevents the browser UI from freezing during computationally
 * expensive co-simulation loops.
 */

import asc from "assemblyscript/dist/asc.js";

let wasmInstance: WebAssembly.Instance | undefined;
let wasmExports: unknown;
const values = new Map<string, number>();
const varRefs = new Map<string, number>();

self.onmessage = async (event: MessageEvent) => {
  const { type, payload, id } = event.data;

  try {
    switch (type) {
      case "INIT": {
        const { asSourceStr, variables } = payload;

        // Compile AssemblyScript
        const { error, binary } = await asc.compileString(asSourceStr, {
          optimizeLevel: 3,
          shrinkLevel: 0,
          runtime: "stub",
        });

        if (error || !binary) {
          throw new Error(`Failed to compile FMU AssemblyScript to WASM:\\n${error?.message}`);
        }

        const env = {
          abort: (msg: number, file: number, line: number, column: number) => {
            console.error(`WASM abort at ${line}:${column}`);
          },
        };

        const wasmModule = await WebAssembly.instantiate(binary, { env });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wasmInstance = wasmModule as any;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        wasmExports = wasmInstance!.exports;

        const exports = wasmExports as {
          initModel: () => void;
          doStep: (time: number, step: number) => void;
          getVar: (vr: number) => number;
          setVar: (vr: number, val: number) => void;
        };

        if (!exports.initModel || !exports.doStep || !exports.getVar) {
          throw new Error("WASM module missing expected exports");
        }

        exports.initModel();

        // Initialize maps
        varRefs.clear();
        values.clear();
        for (const v of variables) {
          varRefs.set(v.name, v.valueReference);
          values.set(v.name, typeof v.start === "number" ? v.start : 0);
        }

        self.postMessage({ id, type: "INIT_DONE" });
        break;
      }

      case "SET_INPUTS": {
        const exports = wasmExports as { setVar: (vr: number, val: number) => void };
        const inputs: [string, number][] = payload;
        for (const [name, value] of inputs) {
          const vr = varRefs.get(name);
          if (vr !== undefined) exports.setVar(vr, value);
          values.set(name, value);
        }
        self.postMessage({ id, type: "SET_INPUTS_DONE" });
        break;
      }

      case "DO_STEP": {
        const { time, stepSize } = payload;
        if (!wasmExports) throw new Error("Worker not initialized");
        const exports = wasmExports as { doStep: (time: number, step: number) => void; getVar: (vr: number) => number };

        exports.doStep(time, stepSize);

        // Sync values back from WASM
        const outputs: [string, number][] = [];
        for (const [name, vr] of varRefs) {
          const val = exports.getVar(vr);
          values.set(name, val);
          outputs.push([name, val]);
        }

        self.postMessage({ id, type: "DO_STEP_DONE", payload: outputs });
        break;
      }

      case "TERMINATE": {
        wasmInstance = undefined;
        wasmExports = undefined;
        values.clear();
        varRefs.clear();
        self.postMessage({ id, type: "TERMINATE_DONE" });
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (err: unknown) {
    self.postMessage({ id, type: "ERROR", error: err instanceof Error ? err.message : String(err) });
  }
};
