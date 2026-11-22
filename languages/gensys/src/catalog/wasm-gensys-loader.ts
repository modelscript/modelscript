// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { getGensysStdLibWasmBytes } from "./gensys-std-lib-data.js";
import { ensureBuiltInGensysLibraryRegistered, lookupGensysModelSchema } from "./library-package-adapter.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface GensysElementSpec {
  name: string;
  modelType: string;
  params?: number[] | Record<string, number> | undefined;
}

export interface GensysElementIO {
  dx?: number | undefined;
  dy?: number | undefined;
  dz?: number | undefined;
  vx?: number | undefined;
  vy?: number | undefined;
  vz?: number | undefined;
  normalForce?: number | undefined;
  creepX?: number | undefined;
  creepY?: number | undefined;
  spin?: number | undefined;
}

export interface GensysElementEvalOutput {
  fx: number;
  fy: number;
  fz: number;
  mz: number;
  aux1: number;
  aux2: number;
}

export interface GensysLinkedElementInstance {
  name: string;
  modelType: string;
  archetypeId: number;
  init(io?: GensysElementIO): number;
  eval(tSec: number, dtSec: number, io: GensysElementIO): GensysElementEvalOutput;
}

interface GensysWasmExports {
  memory: WebAssembly.Memory;
  gensysGetArenaBase(): number;
  gensysModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  gensysModelEval(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): void;
}

/**
 * Resolves the active `@modelscript/gensys-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveGensysStdLibWasmBytes(): Uint8Array {
  ensureBuiltInGensysLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("gensys")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getGensysStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: GensysElementIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io.dx ?? 0.0;
  views.f64[base + 1] = io.dy ?? 0.0;
  views.f64[base + 2] = io.dz ?? 0.0;
  views.f64[base + 3] = io.vx ?? 0.0;
  views.f64[base + 4] = io.vy ?? 0.0;
  views.f64[base + 5] = io.vz ?? 0.0;
  views.f64[base + 6] = io.normalForce ?? 0.0;
  views.f64[base + 7] = io.creepX ?? 0.0;
  views.f64[base + 8] = io.creepY ?? 0.0;
  views.f64[base + 9] = io.spin ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): GensysElementEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    fx: views.f64[base + 10] ?? 0,
    fy: views.f64[base + 11] ?? 0,
    fz: views.f64[base + 12] ?? 0,
    mz: views.f64[base + 13] ?? 0,
    aux1: views.f64[base + 14] ?? 0,
    aux2: views.f64[base + 15] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a GENSYS standard library element.
 */
export function instantiateGensysWasmModel(
  spec: GensysElementSpec,
  wasmBytes?: Uint8Array,
): GensysLinkedElementInstance | undefined {
  const schema = lookupGensysModelSchema(spec.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveGensysStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as GensysWasmExports;
  if (!exports.memory || typeof exports.gensysModelInit !== "function") return undefined;

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.gensysGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (spec.params overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const positionalParams = Array.isArray(spec.params) ? spec.params : undefined;
  const namedParams = spec.params && !Array.isArray(spec.params) ? spec.params : undefined;
  const conCount = Math.max(schema.parameters.length, positionalParams?.length ?? 0);

  for (let i = 0; i < conCount; i++) {
    const schemaParam = schema.parameters[i];
    const defaultVal = schemaParam?.defaultValue;
    let resolved: number | undefined;
    if (positionalParams && positionalParams[i] !== undefined && Number.isFinite(positionalParams[i])) {
      resolved = positionalParams[i];
    } else if (
      namedParams &&
      schemaParam &&
      namedParams[schemaParam.key] !== undefined &&
      Number.isFinite(namedParams[schemaParam.key])
    ) {
      resolved = namedParams[schemaParam.key];
    } else if (typeof defaultVal === "number") {
      resolved = defaultVal;
    }
    views.f64[conBase + i] = resolved ?? 0.0;
  }

  return {
    name: spec.name,
    modelType: schema.name,
    archetypeId,
    init(io: GensysElementIO = {}): number {
      writeIo(views, slotPtr, io);
      return exports.gensysModelInit(archetypeId, slotPtr, conCount);
    },
    eval(tSec: number, dtSec: number, io: GensysElementIO): GensysElementEvalOutput {
      writeIo(views, slotPtr, io);
      exports.gensysModelEval(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
