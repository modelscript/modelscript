// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { getGpromsStdLibWasmBytes } from "./gproms-std-lib-data.js";
import { ensureBuiltInGpromsLibraryRegistered, lookupGpromsModelSchema } from "./library-package-adapter.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface GpromsUnitSpec {
  unitName: string;
  modelType: string;
  params?: number[] | Record<string, number> | undefined;
}

export interface GpromsDynamicModelIO {
  flowIn?: number | undefined;
  concIn?: number | undefined;
  tempIn?: number | undefined;
  pressureIn?: number | undefined;
  coolantTemp?: number | undefined;
  setpoint?: number | undefined;
  measurement?: number | undefined;
  valveOpening?: number | undefined;
}

export interface GpromsDynamicStepOutput {
  flowOut: number;
  concOut: number;
  tempOut: number;
  pressureOut: number;
  heatDuty: number;
  controlOut: number;
  holdup: number;
  conversion: number;
}

export interface GpromsLinkedUnitInstance {
  unitName: string;
  modelType: string;
  archetypeId: number;
  init(io: GpromsDynamicModelIO): number;
  checkFlatStart(): number;
  doStep(tSec: number, dtSec: number, io: GpromsDynamicModelIO): GpromsDynamicStepOutput;
}

interface GpromsWasmExports {
  memory: WebAssembly.Memory;
  gpGetArenaBase(): number;
  gpModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  gpModelStep(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): void;
  gpModelCheckFlatStart(archetypeId: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/gproms-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveGpromsStdLibWasmBytes(): Uint8Array {
  ensureBuiltInGpromsLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("gproms")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getGpromsStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: GpromsDynamicModelIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io.flowIn ?? 0.0;
  views.f64[base + 1] = io.concIn ?? 0.0;
  views.f64[base + 2] = io.tempIn ?? 300.0;
  views.f64[base + 3] = io.pressureIn ?? 101325.0;
  views.f64[base + 4] = io.coolantTemp ?? 298.15;
  views.f64[base + 5] = io.setpoint ?? 0.0;
  views.f64[base + 6] = io.measurement ?? 0.0;
  views.f64[base + 7] = io.valveOpening ?? 0.5;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): GpromsDynamicStepOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    flowOut: views.f64[base + 8] ?? 0,
    concOut: views.f64[base + 9] ?? 0,
    tempOut: views.f64[base + 10] ?? 0,
    pressureOut: views.f64[base + 11] ?? 0,
    heatDuty: views.f64[base + 12] ?? 0,
    controlOut: views.f64[base + 13] ?? 0,
    holdup: views.f64[base + 14] ?? 0,
    conversion: views.f64[base + 15] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a gPROMS PML unit or property package.
 */
export function instantiateGpromsWasmModel(
  unit: GpromsUnitSpec,
  wasmBytes?: Uint8Array,
): GpromsLinkedUnitInstance | undefined {
  const schema = lookupGpromsModelSchema(unit.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveGpromsStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as GpromsWasmExports;
  if (!exports.memory || typeof exports.gpModelInit !== "function") return undefined;

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.gpGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (unit.params overrides schema defaults by index or key)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const positional = Array.isArray(unit.params) ? unit.params : undefined;
  const named = !Array.isArray(unit.params) ? unit.params : undefined;
  const conCount = Math.max(schema.parameters.length, positional?.length ?? 0);

  for (let i = 0; i < conCount; i++) {
    const paramSpec = schema.parameters[i];
    const defaultVal = typeof paramSpec?.defaultValue === "number" ? paramSpec.defaultValue : 0.0;
    let resolved = defaultVal;
    if (positional && positional[i] !== undefined && Number.isFinite(positional[i])) {
      resolved = positional[i]!;
    } else if (named && paramSpec && named[paramSpec.key] !== undefined && Number.isFinite(named[paramSpec.key])) {
      resolved = named[paramSpec.key]!;
    }
    views.f64[conBase + i] = resolved;
  }

  return {
    unitName: unit.unitName,
    modelType: schema.name,
    archetypeId,
    init(io: GpromsDynamicModelIO): number {
      writeIo(views, slotPtr, io);
      return exports.gpModelInit(archetypeId, slotPtr, conCount);
    },
    checkFlatStart(): number {
      return exports.gpModelCheckFlatStart(archetypeId, slotPtr, conCount);
    },
    doStep(tSec: number, dtSec: number, io: GpromsDynamicModelIO): GpromsDynamicStepOutput {
      writeIo(views, slotPtr, io);
      exports.gpModelStep(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
