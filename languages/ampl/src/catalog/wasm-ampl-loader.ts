// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { getAmplStdLibWasmBytes } from "./ampl-std-lib-data.js";
import { ensureBuiltInAmplLibraryRegistered, lookupAmplModelSchema } from "./library-package-adapter.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_DSTATE = 0x680;
const OFF_IO = 0x780;

export interface AmplPwlSpec {
  /** Strictly non-decreasing breakpoints `[b_1, ..., b_k]` (1 <= k <= 16). */
  breakpoints: number[];
  /** Segment slopes `[s_0, ..., s_k]` (`length === breakpoints.length + 1`). */
  slopes: number[];
}

export interface AmplFunctionSpec {
  modelType: string;
  id?: string | undefined;
  params?: number[] | undefined;
  /** Optional structured arbitrary-breakpoint specification for `ampl_pwl` (`<<b_1, ..., b_k; s_0, ..., s_k>> x`). */
  pwl?: AmplPwlSpec | undefined;
}

export interface AmplFunctionIO {
  x0: number;
  x1?: number | undefined;
  x2?: number | undefined;
  x3?: number | undefined;
  count?: number | undefined;
}

export interface AmplFunctionEvalOutput {
  result: number;
  aux1: number;
  aux2: number;
  deriv: number;
  status: number;
}

export interface AmplLinkedFunctionInstance {
  id: string;
  modelType: string;
  archetypeId: number;
  init(): number;
  eval(io: AmplFunctionIO): AmplFunctionEvalOutput;
}

interface AmplWasmExports {
  memory: WebAssembly.Memory;
  amplGetArenaBase(): number;
  amplModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  amplModelEval(archetypeId: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/ampl-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveAmplStdLibWasmBytes(): Uint8Array {
  ensureBuiltInAmplLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("ampl")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getAmplStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: AmplFunctionIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io.x0;
  views.f64[base + 1] = io.x1 ?? 0.0;
  views.f64[base + 2] = io.x2 ?? 0.0;
  views.f64[base + 3] = io.x3 ?? 0.0;
  views.f64[base + 4] = io.count ?? 0.0;
  views.f64[base + 5] = io.x1 !== undefined ? 1.0 : 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): AmplFunctionEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  const dBase = (slotPtr + OFF_DSTATE) >> 3;
  return {
    result: views.f64[base + 8] ?? 0,
    aux1: views.f64[base + 9] ?? 0,
    aux2: views.f64[base + 10] ?? 0,
    deriv: views.f64[dBase + 0] ?? 0,
    status: views.f64[base + 11] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for an AMPL standard library function.
 */
export function instantiateAmplWasmModel(
  model: AmplFunctionSpec,
  wasmBytes?: Uint8Array,
): AmplLinkedFunctionInstance | undefined {
  const schema = lookupAmplModelSchema(model.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveAmplStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as AmplWasmExports;
  if (!exports.memory || typeof exports.amplModelInit !== "function" || typeof exports.amplModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.amplGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (structured pwl or model.params overrides schema defaults)
  let modelParams = model.params ?? [];
  if (model.pwl && model.pwl.breakpoints.length >= 1 && model.pwl.slopes.length === model.pwl.breakpoints.length + 1) {
    const k = Math.min(16, model.pwl.breakpoints.length);
    modelParams = [...model.pwl.breakpoints.slice(0, k), ...model.pwl.slopes.slice(0, k + 1)];
  }
  const conBase = (slotPtr + OFF_CON) >> 3;
  // For arbitrary-breakpoint ampl_pwl (archetypeId=40), honor exact 2*k+1 param length (3..33) without padding
  const isCustomPwl = archetypeId === 40 && modelParams.length >= 3 && modelParams.length % 2 === 1;
  const conCount = isCustomPwl
    ? Math.min(33, modelParams.length)
    : Math.max(schema.parameters.length, modelParams.length);
  for (let i = 0; i < conCount; i++) {
    const paramVal = modelParams[i];
    const defaultVal = schema.parameters[i]?.defaultValue;
    views.f64[conBase + i] =
      paramVal !== undefined && Number.isFinite(paramVal)
        ? paramVal
        : typeof defaultVal === "number"
          ? defaultVal
          : 0.0;
  }

  return {
    id: model.id ?? schema.name,
    modelType: schema.name,
    archetypeId,
    init(): number {
      return exports.amplModelInit(archetypeId, slotPtr, conCount);
    },
    eval(io: AmplFunctionIO): AmplFunctionEvalOutput {
      writeIo(views, slotPtr, io);
      exports.amplModelEval(archetypeId, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
