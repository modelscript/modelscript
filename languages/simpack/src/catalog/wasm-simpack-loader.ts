// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInSimpackLibraryRegistered, lookupSimpackModelSchema } from "./library-package-adapter.js";
import { getSimpackStdLibWasmBytes } from "./simpack-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_PARAM = 0x080;
const OFF_IO = 0x780;

export interface SimpackElementIO {
  /** Primary displacement (m/rad), longitudinal creepage xi_x, longitudinal slip kappa, or control input u. */
  disp?: number | undefined;
  /** Relative velocity (m/s or rad/s), lateral creepage xi_y, or tire slip angle alpha (rad). */
  vel?: number | undefined;
  /** Normal contact load Fn / Fz (N). */
  normalLoad?: number | undefined;
  /** Spin creepage phi (1/m), tire camber angle gamma (rad), or control setpoint r. */
  aux1?: number | undefined;
  /** Forward speed v0 (m/s) or lateral displacement dy (m). */
  aux2?: number | undefined;
  /** Vertical displacement dz (m). */
  aux3?: number | undefined;
}

export interface SimpackElementOutput {
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
  stiffnessEff: number;
  powerLoss: number;
}

export interface SimpackLinkedElementInstance {
  id: string;
  modelType: string;
  archetypeId: number;
  init(io?: SimpackElementIO): number;
  eval(tSec: number, dtSec: number, io: SimpackElementIO): SimpackElementOutput;
}

interface SimpackWasmExports {
  memory: WebAssembly.Memory;
  simpackGetArenaBase(): number;
  simpackModelInit(archetypeId: number, slotPtr: number, paramCount: number): number;
  simpackModelEval(archetypeId: number, t: number, dt: number, slotPtr: number, paramCount: number): void;
}

/**
 * Resolves the active `@modelscript/simpack-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveSimpackStdLibWasmBytes(): Uint8Array {
  ensureBuiltInSimpackLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("simpack")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getSimpackStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: SimpackElementIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io.disp ?? 0.0;
  views.f64[base + 1] = io.vel ?? 0.0;
  views.f64[base + 2] = io.normalLoad ?? 0.0;
  views.f64[base + 3] = io.aux1 ?? 0.0;
  views.f64[base + 4] = io.aux2 ?? 0.0;
  views.f64[base + 5] = io.aux3 ?? 0.0;
  views.f64[base + 6] = 0.0;
  views.f64[base + 7] = 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): SimpackElementOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    fx: views.f64[base + 8] ?? 0,
    fy: views.f64[base + 9] ?? 0,
    fz: views.f64[base + 10] ?? 0,
    tx: views.f64[base + 11] ?? 0,
    ty: views.f64[base + 12] ?? 0,
    tz: views.f64[base + 13] ?? 0,
    stiffnessEff: views.f64[base + 14] ?? 0,
    powerLoss: views.f64[base + 15] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a SIMPACK standard library element.
 */
export function instantiateSimpackWasmModel(
  modelType: string,
  params?: number[] | Record<string, number>,
  id = "elem_1",
  wasmBytes?: Uint8Array,
): SimpackLinkedElementInstance | undefined {
  const schema = lookupSimpackModelSchema(modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveSimpackStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as SimpackWasmExports;
  if (!exports.memory || typeof exports.simpackModelInit !== "function") return undefined;

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.simpackGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate PARAM array (positional or named overrides take precedence over schema defaults)
  const paramBase = (slotPtr + OFF_PARAM) >> 3;
  const paramArray = Array.isArray(params) ? params : undefined;
  const paramRecord = params && !Array.isArray(params) ? params : undefined;
  const paramCount = Math.max(schema.parameters.length, paramArray?.length ?? 0);

  for (let i = 0; i < paramCount; i++) {
    const schemaParam = schema.parameters[i];
    const positionalVal = paramArray?.[i];
    const namedVal = schemaParam && paramRecord ? paramRecord[schemaParam.key] : undefined;
    const defaultVal = schemaParam?.defaultValue;

    let value = 0.0;
    if (positionalVal !== undefined && Number.isFinite(positionalVal)) {
      value = positionalVal;
    } else if (namedVal !== undefined && Number.isFinite(namedVal)) {
      value = namedVal;
    } else if (typeof defaultVal === "number") {
      value = defaultVal;
    }
    views.f64[paramBase + i] = value;
  }

  return {
    id,
    modelType: schema.name,
    archetypeId,
    init(io?: SimpackElementIO): number {
      writeIo(views, slotPtr, io ?? {});
      return exports.simpackModelInit(archetypeId, slotPtr, paramCount);
    },
    eval(tSec: number, dtSec: number, io: SimpackElementIO): SimpackElementOutput {
      writeIo(views, slotPtr, io);
      exports.simpackModelEval(archetypeId, tSec, dtSec, slotPtr, paramCount);
      return readOutput(views, slotPtr);
    },
  };
}
