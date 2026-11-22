// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInSpiceLibraryRegistered, lookupSpiceModelSchema } from "./library-package-adapter.js";
import { getSpiceStdLibWasmBytes } from "./spice-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface SpiceDeviceModelRequest {
  name: string;
  modelType: string;
  params?: Record<string, number> | undefined;
}

export interface SpiceDeviceEvalInput {
  v1: number;
  v2?: number | undefined;
  v3?: number | undefined;
  tempK?: number | undefined;
  dt?: number | undefined;
  t?: number | undefined;
}

export interface SpiceDeviceEvalOutput {
  iOut: number;
  iAux: number;
  vOut: number;
  gm: number;
  gds: number;
  region: number;
  cje?: number | undefined;
  cjc?: number | undefined;
}

export interface SpiceLinkedDeviceInstance {
  name: string;
  modelType: string;
  archetypeId: number;
  init(): number;
  eval(input: SpiceDeviceEvalInput): SpiceDeviceEvalOutput;
}

interface SpiceWasmExports {
  memory: WebAssembly.Memory;
  spiceGetArenaBase(): number;
  spiceModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  spiceModelEval(archetypeId: number, slotPtr: number, conCount: number): void;
}

/**
 * Resolves the active `@modelscript/spice-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveSpiceStdLibWasmBytes(): Uint8Array {
  ensureBuiltInSpiceLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("spice")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getSpiceStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, input: SpiceDeviceEvalInput): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = input.v1;
  views.f64[base + 1] = input.v2 ?? 0.0;
  views.f64[base + 2] = input.v3 ?? 0.0;
  views.f64[base + 3] = input.tempK ?? 300.15;
  views.f64[base + 4] = input.dt ?? 1.0e-6;
  views.f64[base + 5] = input.t ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): SpiceDeviceEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    iOut: views.f64[base + 8] ?? 0,
    iAux: views.f64[base + 9] ?? 0,
    vOut: views.f64[base + 10] ?? 0,
    gm: views.f64[base + 11] ?? 0,
    gds: views.f64[base + 12] ?? 0,
    region: views.f64[base + 13] ?? 0,
    cje: views.f64[base + 14] ?? 0,
    cjc: views.f64[base + 15] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a SPICE standard library device
 * or behavioral primitive.
 */
export function instantiateSpiceWasmDevice(
  request: SpiceDeviceModelRequest,
  wasmBytes?: Uint8Array,
): SpiceLinkedDeviceInstance | undefined {
  const schema = lookupSpiceModelSchema(request.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveSpiceStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as SpiceWasmExports;
  if (!exports.memory || typeof exports.spiceModelInit !== "function" || typeof exports.spiceModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.spiceGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (case-insensitive overrides from request.params)
  const overrides = new Map<string, number>();
  if (request.params) {
    for (const [k, v] of Object.entries(request.params)) {
      if (Number.isFinite(v)) overrides.set(k.toLowerCase(), v);
    }
  }

  const conBase = (slotPtr + OFF_CON) >> 3;
  const conCount = schema.parameters.length;
  for (let i = 0; i < conCount; i++) {
    const paramSpec = schema.parameters[i];
    const override = paramSpec ? overrides.get(paramSpec.key.toLowerCase()) : undefined;
    const defaultVal = paramSpec?.defaultValue;
    views.f64[conBase + i] = override !== undefined ? override : typeof defaultVal === "number" ? defaultVal : 0.0;
  }

  return {
    name: request.name,
    modelType: schema.name,
    archetypeId,
    init(): number {
      return exports.spiceModelInit(archetypeId, slotPtr, conCount);
    },
    eval(input: SpiceDeviceEvalInput): SpiceDeviceEvalOutput {
      writeIo(views, slotPtr, input);
      exports.spiceModelEval(archetypeId, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
