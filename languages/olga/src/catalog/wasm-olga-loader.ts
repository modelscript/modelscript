// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInOlgaLibraryRegistered, lookupOlgaModelSchema } from "./library-package-adapter.js";
import { getOlgaStdLibWasmBytes } from "./olga-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface OlgaModelConfig {
  id: string;
  modelType: string;
  branch?: string | undefined;
  params?: number[] | Record<string, number> | undefined;
}

export interface OlgaModelIO {
  pressureIn?: number | undefined;
  pressureOut?: number | undefined;
  temperatureIn?: number | undefined;
  temperatureAmb?: number | undefined;
  massFlowIn?: number | undefined;
  jGas?: number | undefined;
  jLiq?: number | undefined;
  opening?: number | undefined;
}

export interface OlgaEvalOutput {
  voidFraction: number;
  pressureDrop: number;
  massFlowOut: number;
  heatFlux: number;
  solutionGor: number;
  oilFvf: number;
  temperatureOut: number;
  controlOut: number;
  /** 3-field continuous liquid film holdup alpha_f (IO[11] for multiphase flow models). */
  filmHoldup?: number | undefined;
  /** 3-field entrained liquid droplet holdup alpha_d = 1 - alpha_g - alpha_f. */
  dropletHoldup?: number | undefined;
  /** 3-field droplet entrainment fraction E in [0, 1] (IO[12] for multiphase flow models). */
  entrainmentFraction?: number | undefined;
  /** 3-field interfacial shear stress tau_i [Pa] (IO[15] for multiphase flow models). */
  interfacialShear?: number | undefined;
}

export interface OlgaLinkedModelInstance {
  id: string;
  branch: string;
  modelType: string;
  archetypeId: number;
  init(io?: OlgaModelIO): number;
  eval(tSec: number, dtSec: number, io: OlgaModelIO): OlgaEvalOutput;
}

interface OlgaWasmExports {
  memory: WebAssembly.Memory;
  olgaGetArenaBase(): number;
  olgaModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  olgaModelEval(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): void;
}

/**
 * Resolves the active `@modelscript/olga-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveOlgaStdLibWasmBytes(): Uint8Array {
  ensureBuiltInOlgaLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("olga")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getOlgaStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: OlgaModelIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io.pressureIn ?? 5.0e6;
  views.f64[base + 1] = io.pressureOut ?? 4.5e6;
  views.f64[base + 2] = io.temperatureIn ?? 330.0;
  views.f64[base + 3] = io.temperatureAmb ?? 280.0;
  views.f64[base + 4] = io.massFlowIn ?? 25.0;
  views.f64[base + 5] = io.jGas ?? 0.0;
  views.f64[base + 6] = io.jLiq ?? 0.0;
  views.f64[base + 7] = io.opening ?? 1.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): OlgaEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  const voidFraction = views.f64[base + 8] ?? 0;
  const heatFlux = views.f64[base + 11] ?? 0;
  const solutionGor = views.f64[base + 12] ?? 0;
  const controlOut = views.f64[base + 15] ?? 0;
  return {
    voidFraction,
    pressureDrop: views.f64[base + 9] ?? 0,
    massFlowOut: views.f64[base + 10] ?? 0,
    heatFlux,
    solutionGor,
    oilFvf: views.f64[base + 13] ?? 0,
    temperatureOut: views.f64[base + 14] ?? 0,
    controlOut,
    filmHoldup: heatFlux,
    dropletHoldup: Math.max(0, 1 - voidFraction - heatFlux),
    entrainmentFraction: solutionGor,
    interfacialShear: controlOut,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for an OLGA equipment or correlation model.
 */
export function instantiateOlgaWasmModel(
  config: OlgaModelConfig,
  wasmBytes?: Uint8Array,
): OlgaLinkedModelInstance | undefined {
  const schema = lookupOlgaModelSchema(config.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveOlgaStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as OlgaWasmExports;
  if (!exports.memory || typeof exports.olgaModelInit !== "function" || typeof exports.olgaModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.olgaGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (positional array or named record overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const positional = Array.isArray(config.params) ? config.params : undefined;
  const named = config.params && !Array.isArray(config.params) ? config.params : undefined;
  const conCount = Math.max(schema.parameters.length, positional?.length ?? 0);

  for (let i = 0; i < conCount; i++) {
    const paramSpec = schema.parameters[i];
    const overrideVal = positional ? positional[i] : paramSpec && named ? named[paramSpec.key] : undefined;
    const defaultVal = paramSpec?.defaultValue;
    views.f64[conBase + i] =
      overrideVal !== undefined && Number.isFinite(overrideVal)
        ? overrideVal
        : typeof defaultVal === "number"
          ? defaultVal
          : 0.0;
  }

  return {
    id: config.id,
    branch: config.branch ?? "BRANCH-1",
    modelType: schema.name,
    archetypeId,
    init(io: OlgaModelIO = {}): number {
      writeIo(views, slotPtr, io);
      return exports.olgaModelInit(archetypeId, slotPtr, conCount);
    },
    eval(tSec: number, dtSec: number, io: OlgaModelIO): OlgaEvalOutput {
      writeIo(views, slotPtr, io);
      exports.olgaModelEval(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
