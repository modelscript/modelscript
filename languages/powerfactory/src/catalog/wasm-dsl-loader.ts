// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import {
  ensureBuiltInPowerFactoryLibraryRegistered,
  lookupPowerFactoryModelSchema,
} from "./library-package-adapter.js";
import { getPowerFactoryStdLibWasmBytes } from "./powerfactory-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export const PowerFactoryTocCurve = {
  IEC_STANDARD_INVERSE: 0,
  IEC_VERY_INVERSE: 1,
  IEC_EXTREMELY_INVERSE: 2,
  IEC_LONG_TIME_INVERSE: 3,
  IEEE_MODERATELY_INVERSE: 10,
  IEEE_VERY_INVERSE: 11,
  IEEE_EXTREMELY_INVERSE: 12,
} as const;

export type PowerFactoryTocCurve = (typeof PowerFactoryTocCurve)[keyof typeof PowerFactoryTocCurve];

export interface PowerFactoryDynamicModelRef {
  modelType: string;
  name: string;
  params?: number[] | Record<string, number> | undefined;
}

export interface PowerFactoryDynamicModelIO {
  eterm: number;
  speedDev: number;
  efd: number;
  pmech: number;
  vr?: number | undefined;
  vi?: number | undefined;
  vsPss?: number | undefined;
  pelec?: number | undefined;
  qelec?: number | undefined;
  freqHz?: number | undefined;
  iMeas?: number | undefined;
  pref?: number | undefined;
}

export interface PowerFactoryDynamicStepOutput {
  efd: number;
  pmech: number;
  vsPss: number;
  pelec: number;
  irInj: number;
  iiInj: number;
  qSvc: number;
  tripMult: number;
}

export interface PowerFactoryLinkedDynamicInstance {
  name: string;
  modelType: string;
  archetypeId: number;
  init(io: PowerFactoryDynamicModelIO): number;
  checkFlatStart(): number;
  doStep(tSec: number, dtSec: number, io: PowerFactoryDynamicModelIO): PowerFactoryDynamicStepOutput;
}

interface PowerFactoryWasmExports {
  memory: WebAssembly.Memory;
  pfGetArenaBase(): number;
  pfModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  pfModelStep(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): void;
  pfModelCheckFlatStart(archetypeId: number, slotPtr: number, conCount: number): number;
  pfEvalTocTripTime(curveType: number, iMultiple: number, tms: number): number;
}

/**
 * Resolves the active `@modelscript/powerfactory-std-lib` `runtime.wasm` bytes from
 * `globalLibraryRegistry` (falling back to the zero-I/O pre-bundled payload).
 */
export function resolvePowerFactoryStdLibWasmBytes(): Uint8Array {
  ensureBuiltInPowerFactoryLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("powerfactory")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getPowerFactoryStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: PowerFactoryDynamicModelIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io.eterm;
  views.f64[base + 1] = io.speedDev;
  views.f64[base + 2] = io.efd;
  views.f64[base + 3] = io.pmech;
  views.f64[base + 4] = io.vr ?? io.eterm;
  views.f64[base + 5] = io.vi ?? 0.0;
  views.f64[base + 6] = io.vsPss ?? 0.0;
  views.f64[base + 7] = io.pelec ?? io.pmech;
  views.f64[base + 8] = io.qelec ?? 0.0;
  views.f64[base + 13] = io.freqHz ?? 50.0 * (1.0 + io.speedDev);
  views.f64[base + 14] = io.iMeas ?? 0.0;
  views.f64[base + 15] = io.pref ?? io.pmech;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): PowerFactoryDynamicStepOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    efd: views.f64[base + 2] ?? 0,
    pmech: views.f64[base + 3] ?? 0,
    vsPss: views.f64[base + 6] ?? 0,
    pelec: views.f64[base + 7] ?? 0,
    irInj: views.f64[base + 9] ?? 0,
    iiInj: views.f64[base + 10] ?? 0,
    qSvc: views.f64[base + 11] ?? 0,
    tripMult: views.f64[base + 12] ?? 1,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a PowerFactory
 * Global Library equipment type, DSL controller, or protection relay.
 */
export function instantiatePowerFactoryWasmModel(
  model: PowerFactoryDynamicModelRef,
  wasmBytes?: Uint8Array,
): PowerFactoryLinkedDynamicInstance | undefined {
  const schema = lookupPowerFactoryModelSchema(model.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolvePowerFactoryStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as PowerFactoryWasmExports;
  if (!exports.memory || typeof exports.pfModelInit !== "function") return undefined;

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.pfGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (model.params overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const positional = Array.isArray(model.params) ? model.params : undefined;
  const named = model.params && !Array.isArray(model.params) ? model.params : undefined;
  const conCount = Math.max(schema.parameters.length, positional?.length ?? 0);
  for (let i = 0; i < conCount; i++) {
    const paramSchema = schema.parameters[i];
    const overrideVal = positional !== undefined ? positional[i] : paramSchema ? named?.[paramSchema.key] : undefined;
    const defaultVal = paramSchema?.defaultValue;
    views.f64[conBase + i] =
      overrideVal !== undefined && Number.isFinite(overrideVal)
        ? overrideVal
        : typeof defaultVal === "number"
          ? defaultVal
          : 0.0;
  }

  return {
    name: model.name,
    modelType: schema.name,
    archetypeId,
    init(io: PowerFactoryDynamicModelIO): number {
      writeIo(views, slotPtr, io);
      return exports.pfModelInit(archetypeId, slotPtr, conCount);
    },
    checkFlatStart(): number {
      return exports.pfModelCheckFlatStart(archetypeId, slotPtr, conCount);
    },
    doStep(tSec: number, dtSec: number, io: PowerFactoryDynamicModelIO): PowerFactoryDynamicStepOutput {
      writeIo(views, slotPtr, io);
      exports.pfModelStep(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}

/**
 * Evaluates an IEC 60255-151 or IEEE C37.112 inverse-time overcurrent relay curve
 * directly in `@modelscript/powerfactory-std-lib`'s `runtime.wasm`.
 */
export function evalPowerFactoryTocTripTime(
  curveType: PowerFactoryTocCurve | number,
  iMultiple: number,
  tms: number,
  wasmBytes?: Uint8Array,
): number {
  const bytes = wasmBytes ?? resolvePowerFactoryStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return Number.POSITIVE_INFINITY;
  const exports = instance.exports as unknown as PowerFactoryWasmExports;
  if (typeof exports.pfEvalTocTripTime !== "function") return Number.POSITIVE_INFINITY;
  return exports.pfEvalTocTripTime(curveType, iMultiple, tms);
}
