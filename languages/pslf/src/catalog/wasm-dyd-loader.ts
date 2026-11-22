// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import type { PslfDynamicModel } from "../types.js";
import { ensureBuiltInPslfLibraryRegistered, lookupPslfModelSchema } from "./library-package-adapter.js";
import { getPslfStdLibWasmBytes } from "./pslf-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface PslfDynamicModelIO {
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
  pref?: number | undefined;
  qref?: number | undefined;
}

export interface PslfDynamicStepOutput {
  efd: number;
  pmech: number;
  vsPss: number;
  pelec: number;
  irInj: number;
  iiInj: number;
  qSvc: number;
  tripMult: number;
}

export interface PslfLinkedDynamicInstance {
  busNumber: number;
  id: string;
  modelType: string;
  archetypeId: number;
  init(io: PslfDynamicModelIO): number;
  checkFlatStart(): number;
  doStep(tSec: number, dtSec: number, io: PslfDynamicModelIO): PslfDynamicStepOutput;
}

interface PslfWasmExports {
  memory: WebAssembly.Memory;
  pslfGetArenaBase(): number;
  pslfModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  pslfModelStep(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): void;
  pslfModelCheckFlatStart(archetypeId: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/pslf-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolvePslfStdLibWasmBytes(): Uint8Array {
  ensureBuiltInPslfLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("pslf")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getPslfStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: PslfDynamicModelIO): void {
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
  views.f64[base + 13] = io.freqHz ?? 60.0 * (1.0 + io.speedDev);
  views.f64[base + 14] = io.pref ?? io.pmech;
  views.f64[base + 15] = io.qref ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): PslfDynamicStepOutput {
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
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a parsed PSLF `.dyd` dynamic model.
 */
export function instantiatePslfWasmModel(
  model: PslfDynamicModel,
  wasmBytes?: Uint8Array,
): PslfLinkedDynamicInstance | undefined {
  const schema = lookupPslfModelSchema(model.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolvePslfStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as PslfWasmExports;
  if (!exports.memory || typeof exports.pslfModelInit !== "function") return undefined;

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.pslfGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (model.params overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const conCount = Math.max(schema.parameters.length, model.params.length);
  for (let i = 0; i < conCount; i++) {
    const paramVal = model.params[i];
    const defaultVal = schema.parameters[i]?.defaultValue;
    views.f64[conBase + i] =
      paramVal !== undefined && Number.isFinite(paramVal)
        ? paramVal
        : typeof defaultVal === "number"
          ? defaultVal
          : 0.0;
  }

  return {
    busNumber: model.busNumber,
    id: model.id,
    modelType: schema.name,
    archetypeId,
    init(io: PslfDynamicModelIO): number {
      writeIo(views, slotPtr, io);
      return exports.pslfModelInit(archetypeId, slotPtr, conCount);
    },
    checkFlatStart(): number {
      return exports.pslfModelCheckFlatStart(archetypeId, slotPtr, conCount);
    },
    doStep(tSec: number, dtSec: number, io: PslfDynamicModelIO): PslfDynamicStepOutput {
      writeIo(views, slotPtr, io);
      exports.pslfModelStep(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
