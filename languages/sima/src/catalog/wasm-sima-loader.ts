// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInSimaLibraryRegistered, lookupSimaModelSchema } from "./library-package-adapter.js";
import { getSimaStdLibWasmBytes } from "./sima-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface SimaModelInstanceInput {
  id: string;
  modelType: string;
  /** Positional or named parameter overrides matching schema order/keys. */
  params?: number[] | Record<string, number> | undefined;
}

export interface SimaModelIO {
  /** IO[0]: displacement / horizontal span / fender deflection / depth z (m or rad) */
  displacement?: number | undefined;
  /** IO[1]: body velocity / approach velocity / inflow velocity (m/s or rad/s) */
  velocity?: number | undefined;
  /** IO[2]: fluid velocity / body acceleration (m/s or m/s^2) */
  fluidVelocity?: number | undefined;
  /** IO[3]: fluid acceleration / external force (m/s^2 or N) */
  fluidAccel?: number | undefined;
  /** IO[4]: command / thruster RPM fraction / curvature */
  command?: number | undefined;
  /** IO[5]: angular frequency omega (rad/s) or frequency f (Hz) */
  frequency?: number | undefined;
  /** IO[6]: angle / azimuth / heading (rad) */
  angle?: number | undefined;
  /** IO[7]: auxiliary input (e.g. body acceleration for Morison) */
  auxInput?: number | undefined;
}

export interface SimaEvalOutput {
  /** IO[8]: primary output (force, total tension, spectral density S(omega)/S_u(f), thrust, current speed) */
  primary: number;
  /** IO[9]: secondary output (drag force, horizontal tension T_H, omega_p, friction force, thrust X) */
  secondary: number;
  /** IO[10]: tertiary output (inertia force, vertical tension T_V, S_PM, thrust Y, moment) */
  tertiary: number;
  /** IO[11]: auxiliary output 1 (suspended length s, displacement, utilization) */
  aux1: number;
  /** IO[12]: auxiliary output 2 (grounded length L_g, velocity) */
  aux2: number;
  /** IO[15]: status flag (0 = nominal, 1 = limit/saturated/taut) */
  statusFlag: number;
}

export interface SimaLinkedInstance {
  id: string;
  modelType: string;
  archetypeId: number;
  init(io?: SimaModelIO): number;
  eval(tSec: number, dtSec: number, io?: SimaModelIO): SimaEvalOutput;
}

interface SimaWasmExports {
  memory: WebAssembly.Memory;
  simaGetArenaBase(): number;
  simaModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  simaModelEval(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): void;
}

/**
 * Resolves the active `@modelscript/sima-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveSimaStdLibWasmBytes(): Uint8Array {
  ensureBuiltInSimaLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("sima")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getSimaStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io?: SimaModelIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io?.displacement ?? 0.0;
  views.f64[base + 1] = io?.velocity ?? 0.0;
  views.f64[base + 2] = io?.fluidVelocity ?? 0.0;
  views.f64[base + 3] = io?.fluidAccel ?? 0.0;
  views.f64[base + 4] = io?.command ?? 0.0;
  views.f64[base + 5] = io?.frequency ?? 0.0;
  views.f64[base + 6] = io?.angle ?? 0.0;
  views.f64[base + 7] = io?.auxInput ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): SimaEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    primary: views.f64[base + 8] ?? 0,
    secondary: views.f64[base + 9] ?? 0,
    tertiary: views.f64[base + 10] ?? 0,
    aux1: views.f64[base + 11] ?? 0,
    aux2: views.f64[base + 12] ?? 0,
    statusFlag: views.f64[base + 15] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a SIMA (SIMO/RIFLEX/Metocean) model.
 */
export function instantiateSimaWasmModel(
  model: SimaModelInstanceInput,
  wasmBytes?: Uint8Array,
): SimaLinkedInstance | undefined {
  const schema = lookupSimaModelSchema(model.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveSimaStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as SimaWasmExports;
  if (!exports.memory || typeof exports.simaModelInit !== "function" || typeof exports.simaModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.simaGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (model.params overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const arrayParams = Array.isArray(model.params) ? model.params : undefined;
  const recordParams = model.params && !Array.isArray(model.params) ? model.params : undefined;
  const conCount = Math.max(schema.parameters.length, arrayParams?.length ?? 0);

  for (let i = 0; i < conCount; i++) {
    const schemaParam = schema.parameters[i];
    const positional = arrayParams?.[i];
    const named = schemaParam && recordParams ? recordParams[schemaParam.key] : undefined;
    const override = positional !== undefined ? positional : named;
    const defaultVal = schemaParam?.defaultValue;
    views.f64[conBase + i] =
      override !== undefined && Number.isFinite(override)
        ? override
        : typeof defaultVal === "number"
          ? defaultVal
          : 0.0;
  }

  return {
    id: model.id,
    modelType: schema.name,
    archetypeId,
    init(io?: SimaModelIO): number {
      writeIo(views, slotPtr, io);
      return exports.simaModelInit(archetypeId, slotPtr, conCount);
    },
    eval(tSec: number, dtSec: number, io?: SimaModelIO): SimaEvalOutput {
      writeIo(views, slotPtr, io);
      exports.simaModelEval(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
