// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
} from "@modelscript/runtime";
import { ensureBuiltInSimulinkLibraryRegistered, lookupSimulinkBlockSchema } from "./library-package-adapter.js";
import { getSimulinkStdLibWasmBytes } from "./simulink-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_PARAM = 0x080;
const OFF_IN = 0x780;
const OFF_OUT = 0x7c0;

export interface SimulinkLinkedBlockInstance {
  blockType: string;
  archetypeId: number;
  init(): number;
  step(tSec: number, dtSec: number, inputs?: readonly number[]): number;
}

interface SimulinkWasmExports {
  memory: WebAssembly.Memory;
  simGetArenaBase(): number;
  simBlockInit(archetypeId: number, slotPtr: number, paramCount: number): number;
  simBlockStep(archetypeId: number, t: number, dt: number, slotPtr: number, paramCount: number): void;
}

export function resolveSimulinkStdLibWasmBytes(): Uint8Array {
  ensureBuiltInSimulinkLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("simulink")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) return pkg.wasmBytes;
  }
  return getSimulinkStdLibWasmBytes();
}

/**
 * Instantiates a cleanroom AssemblyScript WASM block from `@modelscript/simulink-std-lib`.
 */
export function instantiateSimulinkWasmBlock(
  blockType: string,
  params: Record<string, number> = {},
  wasmBytes?: Uint8Array,
): SimulinkLinkedBlockInstance | undefined {
  const schema = lookupSimulinkBlockSchema(blockType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const instance = createIsolatedWasmInstance(wasmBytes ?? resolveSimulinkStdLibWasmBytes());
  if (!instance) return undefined;
  const exports = instance.exports as unknown as SimulinkWasmExports;
  if (!exports.memory || typeof exports.simBlockInit !== "function") return undefined;

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.simGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  const pBase = (slotPtr + OFF_PARAM) >> 3;
  const paramCount = schema.parameters.length;
  for (let i = 0; i < paramCount; i++) {
    const p = schema.parameters[i]!;
    const override = params[p.key];
    views.f64[pBase + i] =
      override !== undefined && Number.isFinite(override)
        ? override
        : typeof p.defaultValue === "number"
          ? p.defaultValue
          : 0.0;
  }

  return {
    blockType: schema.name,
    archetypeId,
    init() {
      return exports.simBlockInit(archetypeId, slotPtr, paramCount);
    },
    step(tSec: number, dtSec: number, inputs: readonly number[] = []): number {
      const inBase = (slotPtr + OFF_IN) >> 3;
      for (let i = 0; i < Math.min(inputs.length, 8); i++) {
        views.f64[inBase + i] = inputs[i] ?? 0.0;
      }
      exports.simBlockStep(archetypeId, tSec, dtSec, slotPtr, paramCount);
      return views.f64[(slotPtr + OFF_OUT) >> 3] ?? 0.0;
    },
  };
}
