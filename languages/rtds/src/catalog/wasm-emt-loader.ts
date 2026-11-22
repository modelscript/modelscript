// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInRtdsLibraryRegistered, lookupRtdsModelSchema } from "./library-package-adapter.js";
import { getRtdsStdLibWasmBytes } from "./rtds-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_PARAM = 0x080;
const OFF_IO = 0x680;

export interface RtdsEmtModelSpecInput {
  name: string;
  modelType: string;
  subsystem?: number | undefined;
  params?: Record<string, number> | number[] | undefined;
}

export interface RtdsEmtIO {
  va?: number | undefined;
  vb?: number | undefined;
  vc?: number | undefined;
  ia?: number | undefined;
  ib?: number | undefined;
  ic?: number | undefined;
  vdc?: number | undefined;
  idc?: number | undefined;
  vd?: number | undefined;
  vq?: number | undefined;
  v0?: number | undefined;
  theta?: number | undefined;
  omega?: number | undefined;
  freqHz?: number | undefined;
  ref?: number | undefined;
  meas?: number | undefined;
  va2?: number | undefined;
  ia2?: number | undefined;
}

export interface RtdsEmtStepOutput {
  va: number;
  vb: number;
  vc: number;
  ia: number;
  ib: number;
  ic: number;
  vdc: number;
  idc: number;
  vd: number;
  vq: number;
  v0: number;
  theta: number;
  omega: number;
  freqHz: number;
  ctrlOut: number;
  trip: number;
  gEq: number;
  iHist: number;
  pOut: number;
  qOut: number;
  va2: number;
  ia2: number;
}

export interface RtdsLinkedEmtInstance {
  name: string;
  subsystem: number;
  modelType: string;
  archetypeId: number;
  init(io?: RtdsEmtIO): number;
  doStep(tSec: number, dtSec: number, io?: RtdsEmtIO): RtdsEmtStepOutput;
}

interface RtdsWasmExports {
  memory: WebAssembly.Memory;
  rtdsGetArenaBase(): number;
  rtdsModelInit(archetypeId: number, slotPtr: number, paramCount: number): number;
  rtdsModelStep(archetypeId: number, t: number, dt: number, slotPtr: number, paramCount: number): void;
}

/**
 * Resolves the active `@modelscript/rtds-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveRtdsStdLibWasmBytes(): Uint8Array {
  ensureBuiltInRtdsLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("rtds")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getRtdsStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io?: RtdsEmtIO): void {
  if (!io) return;
  const base = (slotPtr + OFF_IO) >> 3;
  if (io.va !== undefined) views.f64[base + 0] = io.va;
  if (io.vb !== undefined) views.f64[base + 1] = io.vb;
  if (io.vc !== undefined) views.f64[base + 2] = io.vc;
  if (io.ia !== undefined) views.f64[base + 3] = io.ia;
  if (io.ib !== undefined) views.f64[base + 4] = io.ib;
  if (io.ic !== undefined) views.f64[base + 5] = io.ic;
  if (io.vdc !== undefined) views.f64[base + 6] = io.vdc;
  if (io.idc !== undefined) views.f64[base + 7] = io.idc;
  if (io.vd !== undefined) views.f64[base + 8] = io.vd;
  if (io.vq !== undefined) views.f64[base + 9] = io.vq;
  if (io.v0 !== undefined) views.f64[base + 10] = io.v0;
  if (io.theta !== undefined) views.f64[base + 11] = io.theta;
  if (io.omega !== undefined) views.f64[base + 12] = io.omega;
  if (io.freqHz !== undefined) views.f64[base + 13] = io.freqHz;
  if (io.ref !== undefined) views.f64[base + 14] = io.ref;
  if (io.meas !== undefined) views.f64[base + 15] = io.meas;
  if (io.va2 !== undefined) views.f64[base + 22] = io.va2;
  if (io.ia2 !== undefined) views.f64[base + 23] = io.ia2;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): RtdsEmtStepOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    va: views.f64[base + 0] ?? 0,
    vb: views.f64[base + 1] ?? 0,
    vc: views.f64[base + 2] ?? 0,
    ia: views.f64[base + 3] ?? 0,
    ib: views.f64[base + 4] ?? 0,
    ic: views.f64[base + 5] ?? 0,
    vdc: views.f64[base + 6] ?? 0,
    idc: views.f64[base + 7] ?? 0,
    vd: views.f64[base + 8] ?? 0,
    vq: views.f64[base + 9] ?? 0,
    v0: views.f64[base + 10] ?? 0,
    theta: views.f64[base + 11] ?? 0,
    omega: views.f64[base + 12] ?? 0,
    freqHz: views.f64[base + 13] ?? 0,
    ctrlOut: views.f64[base + 16] ?? 0,
    trip: views.f64[base + 17] ?? 0,
    gEq: views.f64[base + 18] ?? 0,
    iHist: views.f64[base + 19] ?? 0,
    pOut: views.f64[base + 20] ?? 0,
    qOut: views.f64[base + 21] ?? 0,
    va2: views.f64[base + 22] ?? 0,
    ia2: views.f64[base + 23] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for an RTDS / RSCAD EMT component.
 */
export function instantiateRtdsWasmModel(
  model: RtdsEmtModelSpecInput,
  wasmBytes?: Uint8Array,
): RtdsLinkedEmtInstance | undefined {
  const schema = lookupRtdsModelSchema(model.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveRtdsStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as RtdsWasmExports;
  if (!exports.memory || typeof exports.rtdsModelInit !== "function") return undefined;

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.rtdsGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate PARAM array (named or positional overrides take precedence over schema defaults)
  const paramBase = (slotPtr + OFF_PARAM) >> 3;
  const positional = Array.isArray(model.params) ? model.params : undefined;
  const named = !Array.isArray(model.params) && model.params ? model.params : undefined;
  const paramCount = Math.max(schema.parameters.length, positional?.length ?? 0);

  for (let i = 0; i < paramCount; i++) {
    const schemaParam = schema.parameters[i];
    const defaultVal = typeof schemaParam?.defaultValue === "number" ? schemaParam.defaultValue : 0.0;
    let resolved = defaultVal;
    if (positional && positional[i] !== undefined && Number.isFinite(positional[i])) {
      resolved = positional[i]!;
    } else if (
      named &&
      schemaParam &&
      named[schemaParam.key] !== undefined &&
      Number.isFinite(named[schemaParam.key])
    ) {
      resolved = named[schemaParam.key]!;
    }
    views.f64[paramBase + i] = resolved;
  }

  return {
    name: model.name,
    subsystem: model.subsystem ?? 1,
    modelType: schema.name,
    archetypeId,
    init(io?: RtdsEmtIO): number {
      writeIo(views, slotPtr, io);
      return exports.rtdsModelInit(archetypeId, slotPtr, paramCount);
    },
    doStep(tSec: number, dtSec: number, io?: RtdsEmtIO): RtdsEmtStepOutput {
      writeIo(views, slotPtr, io);
      exports.rtdsModelStep(archetypeId, tSec, dtSec, slotPtr, paramCount);
      return readOutput(views, slotPtr);
    },
  };
}
