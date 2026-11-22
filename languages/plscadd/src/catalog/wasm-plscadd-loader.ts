// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInPlsCaddLibraryRegistered, lookupPlsCaddModelSchema } from "./library-package-adapter.js";
import { getPlsCaddStdLibWasmBytes } from "./plscadd-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface PlsCaddModelSpecInput {
  id: string;
  modelType: string;
  params?: number[] | undefined;
}

export interface PlsCaddEvalInput {
  spanM?: number | undefined;
  horizontalTensionN?: number | undefined;
  unitWeightNPerM?: number | undefined;
  conductorDiamM?: number | undefined;
  ambientTempC?: number | undefined;
  operatingCurrentA?: number | undefined;
  windSpeedMs?: number | undefined;
  lineAngleDeg?: number | undefined;
}

export interface PlsCaddEvalOutput {
  sagM: number;
  arcLengthM: number;
  maxTensionN: number;
  resultantUnitWeightNPerM: number;
  stateChangeTensionN: number;
  ampacityA: number;
  conductorTempC: number;
  utilizationRatio: number;
}

export interface PlsCaddLinkedWasmInstance {
  id: string;
  modelType: string;
  archetypeId: number;
  init(input?: PlsCaddEvalInput): number;
  eval(input: PlsCaddEvalInput): PlsCaddEvalOutput;
}

interface PlsCaddWasmExports {
  memory: WebAssembly.Memory;
  plsGetArenaBase(): number;
  plsModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  plsModelEval(archetypeId: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/plscadd-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolvePlsCaddStdLibWasmBytes(): Uint8Array {
  ensureBuiltInPlsCaddLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("plscadd")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getPlsCaddStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, input: PlsCaddEvalInput): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = input.spanM ?? 0.0;
  views.f64[base + 1] = input.horizontalTensionN ?? 0.0;
  views.f64[base + 2] = input.unitWeightNPerM ?? 0.0;
  views.f64[base + 3] = input.conductorDiamM ?? 0.0;
  views.f64[base + 4] = input.ambientTempC !== undefined ? input.ambientTempC : Number.NaN;
  views.f64[base + 5] = input.operatingCurrentA ?? 0.0;
  views.f64[base + 6] = input.windSpeedMs ?? 0.0;
  views.f64[base + 7] = input.lineAngleDeg ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): PlsCaddEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    sagM: views.f64[base + 8] ?? 0,
    arcLengthM: views.f64[base + 9] ?? 0,
    maxTensionN: views.f64[base + 10] ?? 0,
    resultantUnitWeightNPerM: views.f64[base + 11] ?? 0,
    stateChangeTensionN: views.f64[base + 12] ?? 0,
    ampacityA: views.f64[base + 13] ?? 0,
    conductorTempC: views.f64[base + 14] ?? 0,
    utilizationRatio: views.f64[base + 15] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a PLS-CADD conductor,
 * structure, insulator, or NESC/IEC weather load case.
 */
export function instantiatePlsCaddWasmModel(
  spec: PlsCaddModelSpecInput,
  wasmBytes?: Uint8Array,
): PlsCaddLinkedWasmInstance | undefined {
  const schema = lookupPlsCaddModelSchema(spec.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolvePlsCaddStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as PlsCaddWasmExports;
  if (!exports.memory || typeof exports.plsModelInit !== "function" || typeof exports.plsModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.plsGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (spec.params overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const overrides = spec.params ?? [];
  const conCount = Math.max(schema.parameters.length, overrides.length);
  for (let i = 0; i < conCount; i++) {
    const paramVal = overrides[i];
    const defaultVal = schema.parameters[i]?.defaultValue;
    views.f64[conBase + i] =
      paramVal !== undefined && Number.isFinite(paramVal)
        ? paramVal
        : typeof defaultVal === "number"
          ? defaultVal
          : 0.0;
  }

  return {
    id: spec.id,
    modelType: schema.name,
    archetypeId,
    init(input: PlsCaddEvalInput = {}): number {
      writeIo(views, slotPtr, input);
      return exports.plsModelInit(archetypeId, slotPtr, conCount);
    },
    eval(input: PlsCaddEvalInput): PlsCaddEvalOutput {
      writeIo(views, slotPtr, input);
      exports.plsModelEval(archetypeId, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
