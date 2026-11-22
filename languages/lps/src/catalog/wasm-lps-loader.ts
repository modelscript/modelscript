// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInLpsLibraryRegistered, lookupLpsModelSchema } from "./library-package-adapter.js";
import { getLpsStdLibWasmBytes } from "./lps-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface LpsComponentSpec {
  id: string;
  modelType: string;
  params?: Record<string, number> | number[] | undefined;
}

export interface LpsHydraulicIO {
  pinPa: number;
  tinK?: number | undefined;
  massFlowKgS?: number | undefined;
  deltaVelocityMs?: number | undefined;
  opening?: number | undefined;
}

export interface LpsEvalOutput {
  poutPa: number;
  toutK: number;
  deltaPPa: number;
  powerW: number;
  headM: number;
  zFactor: number;
  densityKgM3: number;
  velocityMs: number;
  surgeDeltaPPa: number;
  waveSpeedMs: number;
  pressureRatio: number;
  opening: number;
}

export interface LpsLinkedModelInstance {
  id: string;
  modelType: string;
  archetypeId: number;
  init(io: LpsHydraulicIO): number;
  eval(io: LpsHydraulicIO, tSec?: number, dtSec?: number): LpsEvalOutput;
}

interface LpsWasmExports {
  memory: WebAssembly.Memory;
  lpsGetArenaBase(): number;
  lpsModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  lpsModelEval(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/lps-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveLpsStdLibWasmBytes(): Uint8Array {
  ensureBuiltInLpsLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("lps")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getLpsStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: LpsHydraulicIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io.pinPa;
  views.f64[base + 1] = io.tinK ?? 288.15;
  views.f64[base + 2] = io.massFlowKgS ?? 0.0;
  views.f64[base + 3] = io.deltaVelocityMs ?? 0.0;
  views.f64[base + 15] = io.opening ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): LpsEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    poutPa: views.f64[base + 4] ?? 0,
    toutK: views.f64[base + 5] ?? 288.15,
    deltaPPa: views.f64[base + 6] ?? 0,
    powerW: views.f64[base + 7] ?? 0,
    headM: views.f64[base + 8] ?? 0,
    zFactor: views.f64[base + 9] ?? 1,
    densityKgM3: views.f64[base + 10] ?? 0,
    velocityMs: views.f64[base + 11] ?? 0,
    surgeDeltaPPa: views.f64[base + 12] ?? 0,
    waveSpeedMs: views.f64[base + 13] ?? 0,
    pressureRatio: views.f64[base + 14] ?? 1,
    opening: views.f64[base + 15] ?? 1,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for an LPS pipeline equipment or EOS model.
 */
export function instantiateLpsWasmModel(
  spec: LpsComponentSpec,
  wasmBytes?: Uint8Array,
): LpsLinkedModelInstance | undefined {
  const schema = lookupLpsModelSchema(spec.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveLpsStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as LpsWasmExports;
  if (!exports.memory || typeof exports.lpsModelInit !== "function" || typeof exports.lpsModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.lpsGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (spec.params overrides schema defaults by position or key)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const positional = Array.isArray(spec.params) ? spec.params : undefined;
  const keyed = spec.params && !Array.isArray(spec.params) ? spec.params : undefined;
  const conCount = Math.max(schema.parameters.length, positional?.length ?? 0);

  for (let i = 0; i < conCount; i++) {
    const paramSchema = schema.parameters[i];
    const defaultVal = paramSchema?.defaultValue;
    let resolved: number | undefined;
    if (positional && positional[i] !== undefined && Number.isFinite(positional[i])) {
      resolved = positional[i];
    } else if (
      keyed &&
      paramSchema &&
      keyed[paramSchema.key] !== undefined &&
      Number.isFinite(keyed[paramSchema.key])
    ) {
      resolved = keyed[paramSchema.key];
    }
    views.f64[conBase + i] = resolved !== undefined ? resolved : typeof defaultVal === "number" ? defaultVal : 0.0;
  }

  return {
    id: spec.id,
    modelType: schema.name,
    archetypeId,
    init(io: LpsHydraulicIO): number {
      writeIo(views, slotPtr, io);
      return exports.lpsModelInit(archetypeId, slotPtr, conCount);
    },
    eval(io: LpsHydraulicIO, tSec = 0.0, dtSec = 0.0): LpsEvalOutput {
      writeIo(views, slotPtr, io);
      exports.lpsModelEval(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
