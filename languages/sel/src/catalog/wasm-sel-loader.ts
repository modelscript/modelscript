// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInSelLibraryRegistered, lookupSelElementSchema } from "./library-package-adapter.js";
import { getSelStdLibWasmBytes } from "./sel-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface SelElementConfig {
  elementType: string;
  id?: string | undefined;
  relayId?: string | undefined;
  /** Positional parameter vector or named parameter overrides matching schema parameter keys */
  params?: number[] | Record<string, number> | undefined;
}

export interface SelElementIO {
  iMag?: number | undefined;
  iAngDeg?: number | undefined;
  vMag?: number | undefined;
  vAngDeg?: number | undefined;
  zReal?: number | undefined;
  zImag?: number | undefined;
  iDiff?: number | undefined;
  iRest?: number | undefined;
  freqHz?: number | undefined;
  logicIn?: number | boolean | undefined;
  logicReset?: number | boolean | undefined;
  auxIn?: number | undefined;
}

export interface SelElementEvalOutput {
  pickup: boolean;
  trip: boolean;
  operateTimeSec: number;
  integrator: number;
}

export interface SelLinkedElementInstance {
  id: string;
  relayId: string;
  elementType: string;
  archetypeId: number;
  init(): number;
  evalStep(tSec: number, dtSec: number, io: SelElementIO): SelElementEvalOutput;
}

interface SelWasmExports {
  memory: WebAssembly.Memory;
  selGetArenaBase(): number;
  selModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  selModelEval(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/sel-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveSelStdLibWasmBytes(): Uint8Array {
  ensureBuiltInSelLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("sel")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getSelStdLibWasmBytes();
}

function toFlag(v: number | boolean | undefined): number {
  if (typeof v === "boolean") return v ? 1.0 : 0.0;
  return v ?? 0.0;
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: SelElementIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io.iMag ?? 0.0;
  views.f64[base + 1] = io.iAngDeg ?? 0.0;
  views.f64[base + 2] = io.vMag ?? 0.0;
  views.f64[base + 3] = io.vAngDeg ?? 0.0;
  views.f64[base + 4] = io.zReal ?? 0.0;
  views.f64[base + 5] = io.zImag ?? 0.0;
  views.f64[base + 6] = io.iDiff ?? 0.0;
  views.f64[base + 7] = io.iRest ?? 0.0;
  views.f64[base + 8] = io.freqHz ?? 60.0;
  views.f64[base + 9] = toFlag(io.logicIn);
  views.f64[base + 10] = toFlag(io.logicReset);
  views.f64[base + 11] = io.auxIn ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): SelElementEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    pickup: (views.f64[base + 12] ?? 0.0) > 0.5,
    trip: (views.f64[base + 13] ?? 0.0) > 0.5,
    operateTimeSec: views.f64[base + 14] ?? -1.0,
    integrator: views.f64[base + 15] ?? 0.0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for an SEL protection element,
 * IEEE/IEC TCC curve, or SELogic control block.
 */
export function instantiateSelWasmElement(
  config: SelElementConfig,
  wasmBytes?: Uint8Array,
): SelLinkedElementInstance | undefined {
  const schema = lookupSelElementSchema(config.elementType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveSelStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as SelWasmExports;
  if (!exports.memory || typeof exports.selModelInit !== "function" || typeof exports.selModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.selGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (config.params overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const positional = Array.isArray(config.params) ? config.params : undefined;
  const named = config.params && !Array.isArray(config.params) ? config.params : undefined;
  const conCount = Math.max(schema.parameters.length, positional?.length ?? 0);

  for (let i = 0; i < conCount; i++) {
    const paramSpec = schema.parameters[i];
    const overrideVal =
      positional !== undefined ? positional[i] : paramSpec && named !== undefined ? named[paramSpec.key] : undefined;
    const defaultVal = paramSpec?.defaultValue;
    views.f64[conBase + i] =
      overrideVal !== undefined && Number.isFinite(overrideVal)
        ? overrideVal
        : typeof defaultVal === "number"
          ? defaultVal
          : 0.0;
  }

  return {
    id: config.id ?? schema.name,
    relayId: config.relayId ?? "SEL_RELAY",
    elementType: schema.name,
    archetypeId,
    init(): number {
      return exports.selModelInit(archetypeId, slotPtr, conCount);
    },
    evalStep(tSec: number, dtSec: number, io: SelElementIO): SelElementEvalOutput {
      writeIo(views, slotPtr, io);
      exports.selModelEval(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
