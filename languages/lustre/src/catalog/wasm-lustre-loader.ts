// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Zero-GC WebAssembly runtime loader for `@modelscript/lustre-std-lib` temporal operators.
 */

import { getLustreStdLibWasmBytes } from "./lustre-std-lib-data.js";
import { LUSTRE_OPERATOR_SPECS, type LustreOperatorSpec } from "./lustre-std-schemas.js";

const SLOT_SIZE = 512;
const OFF_CON = 0x040;
const OFF_IN = 0x140;
const OFF_OUT = 0x1c0;
const BASE_SLOT_OFFSET = 4096;

interface LustreWasmExports {
  memory: WebAssembly.Memory;
  lustreOpInit(archetypeId: number, slotPtr: number, conCount: number): void;
  lustreOpStep(archetypeId: number, slotPtr: number, conCount: number): void;
}

let cachedExports: LustreWasmExports | null = null;
let nextSlotIndex = 0;

function getWasmExports(): LustreWasmExports {
  if (cachedExports) return cachedExports;
  const bytes = getLustreStdLibWasmBytes();
  const mod = new WebAssembly.Module(bytes as BufferSource);
  const inst = new WebAssembly.Instance(mod, {
    env: {
      abort: () => {
        throw new Error("Lustre stdlib WASM abort");
      },
    },
  });
  cachedExports = inst.exports as unknown as LustreWasmExports;
  return cachedExports;
}

export interface LustreWasmOperatorInstance {
  readonly spec: LustreOperatorSpec;
  init(): void;
  step(inputs: number[]): number[];
}

/**
 * Instantiates a cleanroom Lustre standard library operator in `runtime.wasm`.
 */
export function instantiateLustreWasmOperator(
  operatorName: string,
  params: Record<string, number> = {},
): LustreWasmOperatorInstance | undefined {
  const key = operatorName.trim().toLowerCase();
  const spec = LUSTRE_OPERATOR_SPECS.find(
    (s) => s.name.toLowerCase() === key || s.aliases?.some((a) => a.toLowerCase() === key),
  );
  if (!spec) return undefined;

  const exports = getWasmExports();
  const slotPtr = BASE_SLOT_OFFSET + nextSlotIndex * SLOT_SIZE;
  nextSlotIndex++;

  const neededBytes = slotPtr + SLOT_SIZE;
  if (exports.memory.buffer.byteLength < neededBytes) {
    const pages = Math.ceil((neededBytes - exports.memory.buffer.byteLength) / 65536);
    exports.memory.grow(Math.max(1, pages));
  }

  const conCount = spec.params.length;
  const view = new DataView(exports.memory.buffer);
  for (let i = 0; i < conCount; i++) {
    const [paramKey, defaultVal] = spec.params[i]!;
    const val = params[paramKey] ?? defaultVal;
    view.setFloat64(slotPtr + OFF_CON + i * 8, val, true);
  }

  const init = (): void => {
    exports.lustreOpInit(spec.archetypeId, slotPtr, conCount);
  };

  init();

  return {
    spec,
    init,
    step(inputs: number[]): number[] {
      const dv = new DataView(exports.memory.buffer);
      for (let i = 0; i < inputs.length && i < 16; i++) {
        dv.setFloat64(slotPtr + OFF_IN + i * 8, inputs[i] ?? 0, true);
      }
      exports.lustreOpStep(spec.archetypeId, slotPtr, conCount);
      const outCount = Math.max(1, spec.outputs.length);
      const result: number[] = [];
      for (let i = 0; i < outCount; i++) {
        result.push(dv.getFloat64(slotPtr + OFF_OUT + i * 8, true));
      }
      return result;
    },
  };
}
