// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { getGtSuiteStdLibWasmBytes } from "./gtsuite-std-lib-data.js";
import { ensureBuiltInGtSuiteLibraryRegistered, lookupGtSuiteModelSchema } from "./library-package-adapter.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface GtSuiteComponentSpec {
  id: string;
  modelType: string;
  params?: number[] | Record<string, number> | undefined;
}

export interface GtSuiteModelIO {
  pIn?: number | undefined;
  tIn?: number | undefined;
  pOut?: number | undefined;
  tOut?: number | undefined;
  massFlow?: number | undefined;
  crankAngleDeg?: number | undefined;
  powerW?: number | undefined;
  speedRpm?: number | undefined;
  qHeatW?: number | undefined;
  currentA?: number | undefined;
}

export interface GtSuiteStepOutput {
  pOut: number;
  tOut: number;
  massFlow: number;
  burnFraction: number;
  heatTransferCoeff: number;
  powerW: number;
  speedRpm: number;
  qHeatW: number;
  tempK: number;
  voltageV: number;
  soc: number;
  auxOut: number;
}

export interface GtSuiteLinkedInstance {
  id: string;
  modelType: string;
  archetypeId: number;
  init(io?: GtSuiteModelIO): number;
  checkFlatStart(): number;
  doStep(tSec: number, dtSec: number, io?: GtSuiteModelIO): GtSuiteStepOutput;
}

interface GtSuiteWasmExports {
  memory: WebAssembly.Memory;
  gtGetArenaBase(): number;
  gtModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  gtModelStep(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): void;
  gtModelCheckFlatStart(archetypeId: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/gtsuite-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveGtSuiteStdLibWasmBytes(): Uint8Array {
  ensureBuiltInGtSuiteLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("gtsuite")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getGtSuiteStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: GtSuiteModelIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io.pIn ?? 101325.0;
  views.f64[base + 1] = io.tIn ?? 300.0;
  views.f64[base + 2] = io.pOut ?? 0.0;
  views.f64[base + 3] = io.tOut ?? 0.0;
  views.f64[base + 4] = io.massFlow ?? 0.0;
  views.f64[base + 5] = io.crankAngleDeg ?? 0.0;
  views.f64[base + 8] = io.powerW ?? 0.0;
  views.f64[base + 9] = io.speedRpm ?? 0.0;
  views.f64[base + 10] = io.qHeatW ?? 0.0;
  views.f64[base + 12] = io.currentA ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): GtSuiteStepOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    pOut: views.f64[base + 2] ?? 0,
    tOut: views.f64[base + 3] ?? 0,
    massFlow: views.f64[base + 4] ?? 0,
    burnFraction: views.f64[base + 6] ?? 0,
    heatTransferCoeff: views.f64[base + 7] ?? 0,
    powerW: views.f64[base + 8] ?? 0,
    speedRpm: views.f64[base + 9] ?? 0,
    qHeatW: views.f64[base + 10] ?? 0,
    tempK: views.f64[base + 11] ?? 0,
    voltageV: views.f64[base + 13] ?? 0,
    soc: views.f64[base + 14] ?? 0,
    auxOut: views.f64[base + 15] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a GT-SUITE / GT-POWER template component.
 */
export function instantiateGtSuiteWasmModel(
  spec: GtSuiteComponentSpec,
  wasmBytes?: Uint8Array,
): GtSuiteLinkedInstance | undefined {
  const schema = lookupGtSuiteModelSchema(spec.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveGtSuiteStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as GtSuiteWasmExports;
  if (!exports.memory || typeof exports.gtModelInit !== "function") return undefined;

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.gtGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (spec.params overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const positionalParams = Array.isArray(spec.params) ? spec.params : undefined;
  const namedParams = spec.params && !Array.isArray(spec.params) ? spec.params : undefined;
  const conCount = Math.max(schema.parameters.length, positionalParams?.length ?? 0);

  for (let i = 0; i < conCount; i++) {
    const paramSchema = schema.parameters[i];
    let val: number | undefined;
    if (positionalParams && i < positionalParams.length) {
      val = positionalParams[i];
    } else if (namedParams && paramSchema && Object.prototype.hasOwnProperty.call(namedParams, paramSchema.key)) {
      val = namedParams[paramSchema.key];
    }
    const defaultVal = paramSchema?.defaultValue;
    views.f64[conBase + i] =
      val !== undefined && Number.isFinite(val) ? val : typeof defaultVal === "number" ? defaultVal : 0.0;
  }

  return {
    id: spec.id,
    modelType: schema.name,
    archetypeId,
    init(io: GtSuiteModelIO = {}): number {
      writeIo(views, slotPtr, io);
      return exports.gtModelInit(archetypeId, slotPtr, conCount);
    },
    checkFlatStart(): number {
      return exports.gtModelCheckFlatStart(archetypeId, slotPtr, conCount);
    },
    doStep(tSec: number, dtSec: number, io: GtSuiteModelIO = {}): GtSuiteStepOutput {
      writeIo(views, slotPtr, io);
      exports.gtModelStep(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
