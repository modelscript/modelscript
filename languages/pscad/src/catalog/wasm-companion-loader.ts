// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FmiLsEmtCompanionInstance } from "@modelscript/exchange";
import { globalLibraryRegistry } from "@modelscript/runtime";
import type { EmtCustomFortranBlock, EmtNetlist } from "../types.js";

function sanitizeIdent(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

interface WasmLibraryExports {
  memory?: WebAssembly.Memory;
  [fnName: string]: unknown;
}

const compiledCache = new WeakMap<Uint8Array, WebAssembly.Instance>();

function getOrInstantiateWasm(wasmBytes: Uint8Array): WebAssembly.Instance | undefined {
  let inst = compiledCache.get(wasmBytes);
  if (inst) return inst;
  try {
    const copy = new Uint8Array(wasmBytes);
    const mod = new WebAssembly.Module(copy);
    inst = new WebAssembly.Instance(mod, { env: { abort: () => {} } });
    compiledCache.set(wasmBytes, inst);
    return inst;
  } catch {
    return undefined;
  }
}

/**
 * Instantiates `fmi-ls-emt` Norton-companion callbacks from any loaded `package.json#modelscript`
 * PSCAD library package that provides `runtime.wasm` (`pkg.wasmBytes`), matching `fmuInstances`
 * in `netlist` by component/model name (`<Component>_stampCompanion` / `<Component>_doStep`).
 */
export function instantiateWasmCompanionsForNetlist(netlist: EmtNetlist): Map<string, FmiLsEmtCompanionInstance> {
  const companions = new Map<string, FmiLsEmtCompanionInstance>();
  const fmus = netlist.fmuInstances ?? [];
  if (fmus.length === 0) return companions;

  const pkgs = globalLibraryRegistry
    .getPackagesForLanguage("pscad")
    .filter((p) => p.wasmBytes && p.wasmBytes.byteLength > 0);
  if (pkgs.length === 0) return companions;

  for (const fmu of fmus) {
    const rawName = (fmu as unknown as { modelName?: string; defn?: string }).modelName ?? fmu.id;
    const shortName = rawName.includes(":") ? rawName.split(":").pop()! : rawName;
    const safe = sanitizeIdent(shortName);

    for (const pkg of pkgs) {
      if (!pkg.wasmBytes) continue;
      const instance = getOrInstantiateWasm(pkg.wasmBytes);
      if (!instance) continue;
      const exports = instance.exports as WasmLibraryExports;
      const stampFn =
        (exports[`${safe}_stampCompanion`] as
          | ((t: number, dt: number, gPtr: number, iPtr: number) => void)
          | undefined) ??
        (exports["stampCompanion"] as ((t: number, dt: number, gPtr: number, iPtr: number) => void) | undefined);
      const stepFn =
        (exports[`${safe}_doStep`] as ((t: number, dt: number, vPtr: number) => void) | undefined) ??
        (exports["doStep"] as ((t: number, dt: number, vPtr: number) => void) | undefined);

      if (typeof stampFn !== "function" || typeof stepFn !== "function" || !exports.memory) continue;

      const mem = exports.memory;
      // Reserve 128 bytes at offset 1024 (aligned to 8 bytes): 9 f64s for gEq (72B), 3 f64s for iHist (24B), 3 f64s for vNode (24B)
      const gEqPtr = 1024;
      const iHistPtr = 1096;
      const vNodePtr = 1120;
      const paramsPtr = 1152;

      const initFn =
        (exports[`${safe}_init`] as ((pPtr: number, count: number) => void) | undefined) ??
        (exports["init"] as ((pPtr: number, count: number) => void) | undefined);
      if (typeof initFn === "function") {
        const rawParams = (fmu as unknown as { params?: Record<string, unknown> }).params ?? {};
        const pickNum = (...keys: string[]): number => {
          for (const k of keys) {
            const v = rawParams[k];
            if (typeof v === "number" && Number.isFinite(v)) return v;
            if (typeof v === "string") {
              const parsed = parseFloat(v);
              if (Number.isFinite(parsed)) return parsed;
            }
          }
          return NaN;
        };
        const vec = [
          pickNum("R", "r", "Rcls", "Ron", "Resistance"),
          pickNum("L", "l", "L_leak", "Inductance"),
          pickNum("C", "c", "Capacitance"),
          pickNum("Vref", "VRef", "V_ref", "vRefKv"),
          pickNum("Kp", "kp", "G"),
          pickNum("Ki", "ki", "T"),
        ];
        const f64 = new Float64Array(mem.buffer);
        for (let i = 0; i < vec.length; i++) {
          f64[(paramsPtr >> 3) + i] = vec[i]!;
        }
        initFn(paramsPtr, vec.length);
      }

      companions.set(fmu.id, {
        stampCompanion(tSec: number, dtSec: number) {
          stampFn(tSec, dtSec, gEqPtr, iHistPtr);
          const f64 = new Float64Array(mem.buffer);
          const gEq = new Float64Array(9);
          const iHist = new Float64Array(3);
          for (let i = 0; i < 9; i++) gEq[i] = f64[(gEqPtr >> 3) + i] ?? 0;
          for (let i = 0; i < 3; i++) iHist[i] = f64[(iHistPtr >> 3) + i] ?? 0;
          return { gEq, iHist };
        },
        doStep(tSec: number, dtSec: number, vNode: ArrayLike<number>) {
          const f64 = new Float64Array(mem.buffer);
          f64[(vNodePtr >> 3) + 0] = vNode[0] ?? 0;
          f64[(vNodePtr >> 3) + 1] = vNode[1] ?? 0;
          f64[(vNodePtr >> 3) + 2] = vNode[2] ?? 0;
          stepFn(tSec, dtSec, vNodePtr);
        },
      });
      break;
    }
  }

  return companions;
}

/**
 * Compiles AssemblyScript `fmi-ls-emt` companion source(s) into a `Uint8Array` WebAssembly
 * module in both Node.js and browser environments using `assemblyscript/asc`.
 */
export async function compileAssemblyScriptCompanion(
  sources: string | Record<string, string>,
  options?: { optimizeLevel?: number; memoryBase?: number },
): Promise<{ wasmBytes?: Uint8Array | undefined; stderr: string }> {
  const asc = (await import("assemblyscript/asc")) as unknown as {
    compileString: (
      src: string | Record<string, string>,
      opts?: Record<string, unknown>,
    ) => Promise<{
      error: Error | null;
      stderr: { toString(): string };
      binary: Uint8Array | null;
    }>;
  };
  const result = await asc.compileString(sources, {
    optimizeLevel: options?.optimizeLevel ?? 3,
    noAssert: true,
    memoryBase: options?.memoryBase ?? 2048,
    bindings: "raw",
  });
  return {
    wasmBytes: result.binary ?? undefined,
    stderr: result.stderr ? result.stderr.toString() : "",
  };
}

/**
 * Compiles AssemblyScript companion source(s) in a Web Worker when running in a browser
 * with `Worker`/`Blob` support and a reachable `assemblyscript/asc` module URL, falling back
 * to `compileAssemblyScriptCompanion` in Node.js or when Worker creation is unavailable.
 */
export async function compileAssemblyScriptInWorker(
  sources: string | Record<string, string>,
  options?: { optimizeLevel?: number; memoryBase?: number; ascModuleUrl?: string },
): Promise<{ wasmBytes?: Uint8Array | undefined; stderr: string }> {
  const hasWorker =
    typeof globalThis.Worker === "function" &&
    typeof globalThis.Blob === "function" &&
    typeof globalThis.URL?.createObjectURL === "function" &&
    Boolean(options?.ascModuleUrl);
  if (!hasWorker || !options?.ascModuleUrl) {
    return compileAssemblyScriptCompanion(sources, options);
  }

  const workerCode = `
    self.onmessage = async (event) => {
      const { sources, options, ascModuleUrl } = event.data;
      try {
        const asc = await import(ascModuleUrl);
        const result = await asc.compileString(sources, {
          optimizeLevel: options?.optimizeLevel ?? 3,
          noAssert: true,
          memoryBase: options?.memoryBase ?? 2048,
          bindings: "raw",
        });
        const wasmBytes = result.binary ?? undefined;
        const stderr = result.stderr ? result.stderr.toString() : "";
        self.postMessage({ wasmBytes, stderr }, wasmBytes ? [wasmBytes.buffer] : []);
      } catch (err) {
        self.postMessage({ stderr: err instanceof Error ? err.message : String(err) });
      }
    };
  `;

  const blobUrl = URL.createObjectURL(new Blob([workerCode], { type: "application/javascript" }));
  return new Promise((resolve) => {
    const worker = new Worker(blobUrl, { type: "module" });
    const cleanup = () => {
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
    };
    worker.onmessage = (e: MessageEvent<{ wasmBytes?: Uint8Array; stderr: string }>) => {
      cleanup();
      resolve(e.data);
    };
    worker.onerror = (e: ErrorEvent) => {
      cleanup();
      resolve({ stderr: e.message || "AssemblyScript worker compilation failed" });
    };
    worker.postMessage({
      sources,
      options: { optimizeLevel: options.optimizeLevel, memoryBase: options.memoryBase },
      ascModuleUrl: options.ascModuleUrl,
    });
  });
}

/**
 * Generates a clean-room AssemblyScript `fmi-ls-emt` Norton-companion scaffold from a
 * parsed PSCAD custom Fortran block (`EmtCustomFortranBlock`). The generated source
 * compiles directly via `compileAssemblyScriptCompanion()` and matches the ABI expected
 * by `instantiateWasmCompanionsForNetlist()`.
 */
export function generateCleanRoomCompanionFromFortran(block: EmtCustomFortranBlock): string {
  const safeName = sanitizeIdent(block.name || block.id || "CustomBlock");
  const inputsList = block.referencedPorts.length > 0 ? block.referencedPorts.join(", ") : "none";
  const outputsList = block.assignedPorts.length > 0 ? block.assignedPorts.join(", ") : "none";
  const stateCount = Math.max(1, block.numRealStates + block.numIntStates);

  return `// Clean-room fmi-ls-emt AssemblyScript companion for ${block.name} (${block.id})
// Referenced inputs: ${inputsList}
// Assigned outputs: ${outputsList}
// Declared states: ${block.numRealStates} real, ${block.numIntStates} integer

const states = new Float64Array(${stateCount});
let gEqDiag: f64 = 1e-6;
let iHistA: f64 = 0.0;
let iHistB: f64 = 0.0;
let iHistC: f64 = 0.0;

export function ${safeName}_init(paramsPtr: usize, count: i32): void {
  if (count > 0) {
    const r = load<f64>(paramsPtr);
    if (!isNaN(r) && r > 1e-9) {
      gEqDiag = 1.0 / r;
    }
  }
  for (let i = 0; i < states.length; i++) {
    states[i] = 0.0;
  }
}

export function ${safeName}_stampCompanion(tSec: f64, dtSec: f64, gEqPtr: usize, iHistPtr: usize): void {
  // Diagonal 3-phase Norton conductance G_eq (3x3 row-major) and history current I_hist
  for (let i = 0; i < 9; i++) {
    store<f64>(gEqPtr + (<usize>i << 3), i === 0 || i === 4 || i === 8 ? gEqDiag : 0.0);
  }
  store<f64>(iHistPtr + 0, iHistA);
  store<f64>(iHistPtr + 8, iHistB);
  store<f64>(iHistPtr + 16, iHistC);
}

export function ${safeName}_doStep(tSec: f64, dtSec: f64, vNodePtr: usize): void {
  const va = load<f64>(vNodePtr + 0);
  const vb = load<f64>(vNodePtr + 8);
  const vc = load<f64>(vNodePtr + 16);
  // Clean-room user equations go here; default passive update preserves energy balance
  states[0] = (va + vb + vc) * dtSec;
  iHistA = 0.0;
  iHistB = 0.0;
  iHistC = 0.0;
}

export function init(paramsPtr: usize, count: i32): void {
  ${safeName}_init(paramsPtr, count);
}

export function stampCompanion(tSec: f64, dtSec: f64, gEqPtr: usize, iHistPtr: usize): void {
  ${safeName}_stampCompanion(tSec, dtSec, gEqPtr, iHistPtr);
}

export function doStep(tSec: f64, dtSec: f64, vNodePtr: usize): void {
  ${safeName}_doStep(tSec, dtSec, vNodePtr);
}
`;
}

/**
 * Generates and compiles clean-room AssemblyScript `fmi-ls-emt` companions for all
 * `customFortranBlocks` in `netlist`, returning `FmiLsEmtCompanionInstance` handles
 * ready for `EmtSolver` (`fmuCompanions` option).
 */
export async function compileCleanRoomCompanionsForNetlist(
  netlist: EmtNetlist,
  options?: { optimizeLevel?: number; memoryBase?: number },
): Promise<Map<string, FmiLsEmtCompanionInstance>> {
  const result = new Map<string, FmiLsEmtCompanionInstance>();
  const blocks = netlist.customFortranBlocks ?? [];
  if (blocks.length === 0) return result;

  for (const block of blocks) {
    const src = generateCleanRoomCompanionFromFortran(block);
    const compiled = await compileAssemblyScriptCompanion(src, options);
    if (!compiled.wasmBytes || compiled.wasmBytes.byteLength === 0) continue;
    const instance = getOrInstantiateWasm(compiled.wasmBytes);
    if (!instance) continue;
    const exports = instance.exports as WasmLibraryExports;
    const safe = sanitizeIdent(block.name || block.id || "CustomBlock");
    const stampFn =
      (exports[`${safe}_stampCompanion`] as
        | ((t: number, dt: number, gPtr: number, iPtr: number) => void)
        | undefined) ??
      (exports["stampCompanion"] as ((t: number, dt: number, gPtr: number, iPtr: number) => void) | undefined);
    const stepFn =
      (exports[`${safe}_doStep`] as ((t: number, dt: number, vPtr: number) => void) | undefined) ??
      (exports["doStep"] as ((t: number, dt: number, vPtr: number) => void) | undefined);
    if (typeof stampFn !== "function" || typeof stepFn !== "function" || !exports.memory) continue;

    const mem = exports.memory;
    const gEqPtr = 1024;
    const iHistPtr = 1096;
    const vNodePtr = 1120;
    result.set(block.id, {
      stampCompanion(tSec: number, dtSec: number) {
        stampFn(tSec, dtSec, gEqPtr, iHistPtr);
        const f64 = new Float64Array(mem.buffer);
        const gEq = new Float64Array(9);
        const iHist = new Float64Array(3);
        for (let i = 0; i < 9; i++) gEq[i] = f64[(gEqPtr >> 3) + i] ?? 0;
        for (let i = 0; i < 3; i++) iHist[i] = f64[(iHistPtr >> 3) + i] ?? 0;
        return { gEq, iHist };
      },
      doStep(tSec: number, dtSec: number, vNode: ArrayLike<number>) {
        const f64 = new Float64Array(mem.buffer);
        f64[(vNodePtr >> 3) + 0] = vNode[0] ?? 0;
        f64[(vNodePtr >> 3) + 1] = vNode[1] ?? 0;
        f64[(vNodePtr >> 3) + 2] = vNode[2] ?? 0;
        stepFn(tSec, dtSec, vNodePtr);
      },
    });
  }

  return result;
}
