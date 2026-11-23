// SPDX-License-Identifier: AGPL-3.0-or-later

import { getCsmpStdLibWasmBytes } from "./csmp-std-lib-data.js";
import { lookupCsmpBlockSchema } from "./library-package-adapter.js";

const SLOT_BASE = 4096;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

interface CsmpWasmExports {
  memory: WebAssembly.Memory;
  csmpModelInit(archetypeId: number, slotPtr: number, conCount: number): void;
  csmpModelEval(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): void;
  csmpModelStep(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): void;
}

export interface CsmpWasmBlockInstance {
  readonly blockType: string;
  readonly archetypeId: number;
  init(): void;
  step(t: number, dt: number, x: number, x2?: number): { y: number; dy: number };
}

/**
 * Instantiates a single CSMP/360 standard block inside the compiled `runtime.wasm` module.
 */
export function instantiateCsmpWasmBlock(blockType: string, params: number[] = []): CsmpWasmBlockInstance | undefined {
  const schema = lookupCsmpBlockSchema(blockType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? schema.extra["archetypeId"] : undefined;
  if (archetypeId === undefined) return undefined;

  const wasmBytes = getCsmpStdLibWasmBytes();
  const wasmModule = new WebAssembly.Module(wasmBytes as BufferSource);
  const instance = new WebAssembly.Instance(wasmModule, {});
  const exports = instance.exports as unknown as CsmpWasmExports;
  const f64 = new Float64Array(exports.memory.buffer);

  const conCount = params.length;
  for (let i = 0; i < conCount; i++) {
    f64[(SLOT_BASE + OFF_CON) / 8 + i] = params[i] ?? 0;
  }

  return {
    blockType: schema?.name ?? blockType,
    archetypeId,
    init() {
      exports.csmpModelInit(archetypeId, SLOT_BASE, conCount);
    },
    step(t: number, dt: number, x: number, x2: number = 0): { y: number; dy: number } {
      f64[(SLOT_BASE + OFF_IO) / 8 + 0] = x;
      f64[(SLOT_BASE + OFF_IO) / 8 + 1] = x2;
      exports.csmpModelStep(archetypeId, t, dt, SLOT_BASE, conCount);
      return {
        y: f64[(SLOT_BASE + OFF_IO) / 8 + 2] ?? 0,
        dy: f64[(SLOT_BASE + OFF_IO) / 8 + 3] ?? 0,
      };
    },
  };
}
