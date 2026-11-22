// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInMlxtranLibraryRegistered, lookupMlxtranModelSchema } from "./library-package-adapter.js";
import { getMlxtranStdLibWasmBytes } from "./mlxtran-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_PARAM = 0x080;
const OFF_IO = 0x780;

export interface MlxtranModelEvalIO {
  dose?: number | undefined;
  amt?: number | undefined;
  tinf?: number | undefined;
  rate?: number | undefined;
  ii?: number | undefined;
  addl?: number | undefined;
  ss?: number | boolean | undefined;
  alag?: number | undefined;
  f1?: number | undefined;
  concIn?: number | undefined;
}

export interface MlxtranModelEvalOutput {
  primary: number;
  concOut: number;
  effectOut: number;
  tumorOut: number;
  peripheralOut: number;
  depotOut: number;
  aucOut: number;
}

export interface MlxtranLinkedModelInstance {
  modelType: string;
  archetypeId: number;
  init(io?: MlxtranModelEvalIO): number;
  eval(t: number, dt?: number, io?: MlxtranModelEvalIO): MlxtranModelEvalOutput;
}

interface MlxtranWasmExports {
  memory: WebAssembly.Memory;
  mlxGetArenaBase(): number;
  mlxModelInit(archetypeId: number, slotPtr: number, paramCount: number): number;
  mlxModelEval(archetypeId: number, t: number, dt: number, slotPtr: number, paramCount: number): number;
}

/**
 * Resolves the active `@modelscript/mlxtran-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveMlxtranStdLibWasmBytes(): Uint8Array {
  ensureBuiltInMlxtranLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("mlxtran")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getMlxtranStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io?: MlxtranModelEvalIO): void {
  if (!io) return;
  const base = (slotPtr + OFF_IO) >> 3;
  const doseVal = io.dose ?? io.amt;
  if (doseVal !== undefined) views.f64[base + 1] = doseVal;
  if (io.tinf !== undefined) views.f64[base + 2] = io.tinf;
  if (io.concIn !== undefined) views.f64[base + 3] = io.concIn;
  if (io.ii !== undefined) views.f64[base + 10] = io.ii;
  if (io.addl !== undefined) views.f64[base + 11] = io.addl;
  if (io.ss !== undefined) {
    views.f64[base + 12] = io.ss === true || (typeof io.ss === "number" && io.ss !== 0) ? 1.0 : 0.0;
  }
  if (io.alag !== undefined) views.f64[base + 13] = io.alag;
  if (io.rate !== undefined) views.f64[base + 14] = io.rate;
  if (io.f1 !== undefined) views.f64[base + 15] = io.f1;
}

function readOutput(views: CachedMemoryViews, slotPtr: number, primary: number): MlxtranModelEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    primary,
    concOut: views.f64[base + 4] ?? 0,
    effectOut: views.f64[base + 5] ?? 0,
    tumorOut: views.f64[base + 6] ?? 0,
    peripheralOut: views.f64[base + 7] ?? 0,
    depotOut: views.f64[base + 8] ?? 0,
    aucOut: views.f64[base + 9] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a standard Mlxtran
 * PK/PD/TMDD/TGI model by canonical name or alias.
 */
export function instantiateMlxtranWasmModel(
  modelType: string,
  params?: Record<string, number> | number[],
  wasmBytes?: Uint8Array,
): MlxtranLinkedModelInstance | undefined {
  const schema = lookupMlxtranModelSchema(modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveMlxtranStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as MlxtranWasmExports;
  if (!exports.memory || typeof exports.mlxModelInit !== "function" || typeof exports.mlxModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.mlxGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate PARAM array (overrides override schema defaults)
  const paramBase = (slotPtr + OFF_PARAM) >> 3;
  const paramCount = Array.isArray(params)
    ? Math.max(schema.parameters.length, params.length)
    : schema.parameters.length;
  for (let i = 0; i < paramCount; i++) {
    const paramSpec = schema.parameters[i];
    let val: number | undefined;
    if (Array.isArray(params)) {
      val = params[i];
    } else if (params && paramSpec) {
      val = params[paramSpec.key];
    }
    const defaultVal = paramSpec?.defaultValue;
    views.f64[paramBase + i] =
      val !== undefined && Number.isFinite(val) ? val : typeof defaultVal === "number" ? defaultVal : 0.0;
  }

  return {
    modelType: schema.name,
    archetypeId,
    init(io?: MlxtranModelEvalIO): number {
      writeIo(views, slotPtr, io);
      return exports.mlxModelInit(archetypeId, slotPtr, paramCount);
    },
    eval(t: number, dt = 0.0, io?: MlxtranModelEvalIO): MlxtranModelEvalOutput {
      writeIo(views, slotPtr, io);
      const primary = exports.mlxModelEval(archetypeId, t, dt, slotPtr, paramCount);
      return readOutput(views, slotPtr, primary);
    },
  };
}
