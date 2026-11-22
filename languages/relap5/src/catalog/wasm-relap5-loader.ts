// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInRelap5LibraryRegistered, lookupRelap5ModelSchema } from "./library-package-adapter.js";
import { getRelap5StdLibWasmBytes } from "./relap5-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface Relap5ModelDescriptor {
  componentId: number;
  modelType: string;
  params?: number[] | undefined;
}

export interface Relap5ModelIO {
  pressure?: number | undefined;
  pressure2?: number | undefined;
  temperature?: number | undefined;
  massFlow?: number | undefined;
  voidFraction?: number | undefined;
  reactivity?: number | undefined;
  power?: number | undefined;
  htc?: number | undefined;
  reynolds?: number | undefined;
  prandtl?: number | undefined;
  kFluid?: number | undefined;
  dHyd?: number | undefined;
}

export interface Relap5StepOutput {
  pressure: number;
  pressure2: number;
  temperature: number;
  massFlow: number;
  voidFraction: number;
  power: number;
  htc: number;
  qFlux: number;
  tSat: number;
  decayFraction: number;
  aux: number;
}

export interface Relap5LinkedInstance {
  componentId: number;
  modelType: string;
  archetypeId: number;
  init(io?: Relap5ModelIO): number;
  checkFlatStart(): number;
  doStep(tSec: number, dtSec: number, io?: Relap5ModelIO): Relap5StepOutput;
}

interface Relap5WasmExports {
  memory: WebAssembly.Memory;
  r5GetArenaBase(): number;
  r5ModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  r5ModelStep(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): void;
  r5ModelCheckFlatStart(archetypeId: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/relap5-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveRelap5StdLibWasmBytes(): Uint8Array {
  ensureBuiltInRelap5LibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("relap5")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getRelap5StdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: Relap5ModelIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  if (io.pressure !== undefined) views.f64[base + 0] = io.pressure;
  if (io.pressure2 !== undefined) views.f64[base + 1] = io.pressure2;
  if (io.temperature !== undefined) views.f64[base + 2] = io.temperature;
  if (io.massFlow !== undefined) views.f64[base + 3] = io.massFlow;
  if (io.voidFraction !== undefined) views.f64[base + 4] = io.voidFraction;
  if (io.reactivity !== undefined) views.f64[base + 5] = io.reactivity;
  if (io.power !== undefined) views.f64[base + 6] = io.power;
  if (io.htc !== undefined) views.f64[base + 7] = io.htc;
  if (io.reynolds !== undefined) views.f64[base + 10] = io.reynolds;
  if (io.prandtl !== undefined) views.f64[base + 11] = io.prandtl;
  if (io.kFluid !== undefined) views.f64[base + 12] = io.kFluid;
  if (io.dHyd !== undefined) views.f64[base + 13] = io.dHyd;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): Relap5StepOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    pressure: views.f64[base + 0] ?? 0,
    pressure2: views.f64[base + 1] ?? 0,
    temperature: views.f64[base + 2] ?? 0,
    massFlow: views.f64[base + 3] ?? 0,
    voidFraction: views.f64[base + 4] ?? 0,
    power: views.f64[base + 6] ?? 0,
    htc: views.f64[base + 7] ?? 0,
    qFlux: views.f64[base + 8] ?? 0,
    tSat: views.f64[base + 9] ?? 0,
    decayFraction: views.f64[base + 14] ?? 0,
    aux: views.f64[base + 15] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a RELAP5 thermal-hydraulic,
 * boiling/CHF correlation, reactor kinetics, or IAPWS-IF97 component.
 */
export function instantiateRelap5WasmModel(
  model: Relap5ModelDescriptor,
  wasmBytes?: Uint8Array,
): Relap5LinkedInstance | undefined {
  const schema = lookupRelap5ModelSchema(model.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveRelap5StdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as Relap5WasmExports;
  if (!exports.memory || typeof exports.r5ModelInit !== "function") return undefined;

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.r5GetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (model.params overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const userParams = model.params ?? [];
  const conCount = Math.max(schema.parameters.length, userParams.length);
  for (let i = 0; i < conCount; i++) {
    const paramVal = userParams[i];
    const defaultVal = schema.parameters[i]?.defaultValue;
    views.f64[conBase + i] =
      paramVal !== undefined && Number.isFinite(paramVal)
        ? paramVal
        : typeof defaultVal === "number"
          ? defaultVal
          : 0.0;
  }

  return {
    componentId: model.componentId,
    modelType: schema.name,
    archetypeId,
    init(io: Relap5ModelIO = {}): number {
      writeIo(views, slotPtr, io);
      return exports.r5ModelInit(archetypeId, slotPtr, conCount);
    },
    checkFlatStart(): number {
      return exports.r5ModelCheckFlatStart(archetypeId, slotPtr, conCount);
    },
    doStep(tSec: number, dtSec: number, io: Relap5ModelIO = {}): Relap5StepOutput {
      writeIo(views, slotPtr, io);
      exports.r5ModelStep(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
