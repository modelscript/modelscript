// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInRocetsLibraryRegistered, lookupRocetsModelSchema } from "./library-package-adapter.js";
import { getRocetsStdLibWasmBytes } from "./rocets-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface RocetsModuleConfig {
  id: string;
  modelType: string;
  params?: Record<string, number> | number[] | undefined;
}

export interface RocetsModuleIO {
  pIn?: number | undefined;
  pOut?: number | undefined;
  tIn?: number | undefined;
  tOut?: number | undefined;
  mdotIn?: number | undefined;
  mdotOut?: number | undefined;
  mdotFuel?: number | undefined;
  speedRpm?: number | undefined;
  torqueNm?: number | undefined;
  powerW?: number | undefined;
  density?: number | undefined;
  enthalpy?: number | undefined;
  valveCmd?: number | undefined;
}

export interface RocetsStepOutput {
  pOut: number;
  tOut: number;
  mdotOut: number;
  mdotSecondary: number;
  speedRpm: number;
  torqueNm: number;
  powerW: number;
  density: number;
  enthalpy: number;
  thrustN: number;
  ispSec: number;
  headM: number;
}

export interface RocetsLinkedModuleInstance {
  id: string;
  modelType: string;
  archetypeId: number;
  init(io?: RocetsModuleIO): number;
  checkFlatStart(): number;
  doStep(tSec: number, dtSec: number, io?: RocetsModuleIO): RocetsStepOutput;
}

interface RocetsWasmExports {
  memory: WebAssembly.Memory;
  rocetsGetArenaBase(): number;
  rocetsModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  rocetsModelStep(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): void;
  rocetsModelCheckFlatStart(archetypeId: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/rocets-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveRocetsStdLibWasmBytes(): Uint8Array {
  ensureBuiltInRocetsLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("rocets")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getRocetsStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: RocetsModuleIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  if (io.pIn !== undefined) views.f64[base + 0] = io.pIn;
  if (io.pOut !== undefined) views.f64[base + 1] = io.pOut;
  if (io.tIn !== undefined) views.f64[base + 2] = io.tIn;
  if (io.tOut !== undefined) views.f64[base + 3] = io.tOut;
  if (io.mdotIn !== undefined) views.f64[base + 4] = io.mdotIn;
  if (io.mdotOut !== undefined) views.f64[base + 5] = io.mdotOut;
  if (io.mdotFuel !== undefined) views.f64[base + 6] = io.mdotFuel;
  if (io.speedRpm !== undefined) views.f64[base + 7] = io.speedRpm;
  if (io.torqueNm !== undefined) views.f64[base + 8] = io.torqueNm;
  if (io.powerW !== undefined) views.f64[base + 9] = io.powerW;
  if (io.density !== undefined) views.f64[base + 10] = io.density;
  if (io.enthalpy !== undefined) views.f64[base + 11] = io.enthalpy;
  if (io.valveCmd !== undefined) views.f64[base + 12] = io.valveCmd;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): RocetsStepOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    pOut: views.f64[base + 1] ?? 0,
    tOut: views.f64[base + 3] ?? 0,
    mdotOut: views.f64[base + 5] ?? 0,
    mdotSecondary: views.f64[base + 6] ?? 0,
    speedRpm: views.f64[base + 7] ?? 0,
    torqueNm: views.f64[base + 8] ?? 0,
    powerW: views.f64[base + 9] ?? 0,
    density: views.f64[base + 10] ?? 0,
    enthalpy: views.f64[base + 11] ?? 0,
    thrustN: views.f64[base + 13] ?? 0,
    ispSec: views.f64[base + 14] ?? 0,
    headM: views.f64[base + 15] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a ROCETS propulsion module.
 */
export function instantiateRocetsWasmModel(
  config: RocetsModuleConfig,
  wasmBytes?: Uint8Array,
): RocetsLinkedModuleInstance | undefined {
  const schema = lookupRocetsModelSchema(config.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveRocetsStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as RocetsWasmExports;
  if (!exports.memory || typeof exports.rocetsModelInit !== "function") return undefined;

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.rocetsGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Zero IO slot initially
  const ioBase = (slotPtr + OFF_IO) >> 3;
  for (let i = 0; i < 16; i++) {
    views.f64[ioBase + i] = 0.0;
  }

  // Populate CON parameter array (config.params overrides schema defaults by position or key)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const positional = Array.isArray(config.params) ? config.params : undefined;
  const named = !Array.isArray(config.params) && config.params ? config.params : undefined;
  const conCount = Math.max(schema.parameters.length, positional?.length ?? 0);

  for (let i = 0; i < conCount; i++) {
    const paramSpec = schema.parameters[i];
    let val: number | undefined;
    if (positional && positional[i] !== undefined && Number.isFinite(positional[i])) {
      val = positional[i];
    } else if (named && paramSpec) {
      const exact = named[paramSpec.key];
      const upper = named[paramSpec.key.toUpperCase()];
      const candidate = exact ?? upper;
      if (candidate !== undefined && Number.isFinite(candidate)) {
        val = candidate;
      }
    }
    if (val === undefined) {
      val = typeof paramSpec?.defaultValue === "number" ? paramSpec.defaultValue : 0.0;
    }
    views.f64[conBase + i] = val;
  }

  return {
    id: config.id,
    modelType: schema.name,
    archetypeId,
    init(io: RocetsModuleIO = {}): number {
      writeIo(views, slotPtr, io);
      return exports.rocetsModelInit(archetypeId, slotPtr, conCount);
    },
    checkFlatStart(): number {
      return exports.rocetsModelCheckFlatStart(archetypeId, slotPtr, conCount);
    },
    doStep(tSec: number, dtSec: number, io: RocetsModuleIO = {}): RocetsStepOutput {
      writeIo(views, slotPtr, io);
      exports.rocetsModelStep(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
