// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInToughLibraryRegistered, lookupToughModelSchema } from "./library-package-adapter.js";
import { getToughStdLibWasmBytes } from "./tough-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface ToughModelConfig {
  id?: string | undefined;
  modelType: string;
  params?: number[] | undefined;
}

export interface ToughModelIO {
  pressurePa?: number | undefined;
  temperatureC?: number | undefined;
  liquidSat?: number | undefined;
  gasSat?: number | undefined;
  salinity?: number | undefined;
  co2Frac?: number | undefined;
}

export interface ToughEvalOutput {
  krLiquid: number;
  krGas: number;
  capillaryPressurePa: number;
  liquidDensity: number;
  gasDensity: number;
  liquidViscosity: number;
  saturationPressurePa: number;
  liquidEnthalpy: number;
  co2Solubility: number;
  effectiveConductivity: number;
}

export interface ToughLinkedModelInstance {
  id: string;
  modelType: string;
  archetypeId: number;
  init(io?: ToughModelIO): number;
  eval(io: ToughModelIO): ToughEvalOutput;
}

interface ToughWasmExports {
  memory: WebAssembly.Memory;
  toughGetArenaBase(): number;
  toughModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  toughModelEval(archetypeId: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/tough-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveToughStdLibWasmBytes(): Uint8Array {
  ensureBuiltInToughLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("tough")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getToughStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: ToughModelIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  const sl = io.liquidSat ?? 0.5;
  views.f64[base + 0] = io.pressurePa ?? 101325.0;
  views.f64[base + 1] = io.temperatureC ?? 25.0;
  views.f64[base + 2] = sl;
  views.f64[base + 3] = io.gasSat ?? Math.max(0.0, 1.0 - sl);
  views.f64[base + 4] = io.salinity ?? 0.0;
  views.f64[base + 5] = io.co2Frac ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): ToughEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    krLiquid: views.f64[base + 6] ?? 0,
    krGas: views.f64[base + 7] ?? 0,
    capillaryPressurePa: views.f64[base + 8] ?? 0,
    liquidDensity: views.f64[base + 9] ?? 0,
    gasDensity: views.f64[base + 10] ?? 0,
    liquidViscosity: views.f64[base + 11] ?? 0,
    saturationPressurePa: views.f64[base + 12] ?? 0,
    liquidEnthalpy: views.f64[base + 13] ?? 0,
    co2Solubility: views.f64[base + 14] ?? 0,
    effectiveConductivity: views.f64[base + 15] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a TOUGH2/TOUGH3 EOS,
 * relative permeability (IRP), or capillary pressure (ICP) model.
 */
export function instantiateToughWasmModel(
  config: ToughModelConfig,
  wasmBytes?: Uint8Array,
): ToughLinkedModelInstance | undefined {
  const schema = lookupToughModelSchema(config.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveToughStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as ToughWasmExports;
  if (!exports.memory || typeof exports.toughModelInit !== "function" || typeof exports.toughModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.toughGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (config.params overrides schema defaults)
  const params = config.params ?? [];
  const conBase = (slotPtr + OFF_CON) >> 3;
  const conCount = Math.max(schema.parameters.length, params.length);
  for (let i = 0; i < conCount; i++) {
    const paramVal = params[i];
    const defaultVal = schema.parameters[i]?.defaultValue;
    views.f64[conBase + i] =
      paramVal !== undefined && Number.isFinite(paramVal)
        ? paramVal
        : typeof defaultVal === "number"
          ? defaultVal
          : 0.0;
  }

  return {
    id: config.id ?? schema.name,
    modelType: schema.name,
    archetypeId,
    init(io: ToughModelIO = {}): number {
      writeIo(views, slotPtr, io);
      return exports.toughModelInit(archetypeId, slotPtr, conCount);
    },
    eval(io: ToughModelIO): ToughEvalOutput {
      writeIo(views, slotPtr, io);
      exports.toughModelEval(archetypeId, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
