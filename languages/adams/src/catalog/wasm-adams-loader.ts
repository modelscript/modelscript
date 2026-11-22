// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { getAdamsStdLibWasmBytes } from "./adams-std-lib-data.js";
import { ensureBuiltInAdamsLibraryRegistered, lookupAdamsModelSchema } from "./library-package-adapter.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_DSTATE = 0x680;
const OFF_IO = 0x780;

export interface AdamsEvalIO {
  /** Primary scalar input: x / displacement dx / longitudinal slip kappa */
  x?: number | undefined;
  /** Primary velocity input: xdot / vx / slip angle alpha (rad) */
  xdot?: number | undefined;
  /** Y-axis displacement dy / vertical tire load Fz (N) */
  dy?: number | undefined;
  /** Z-axis displacement dz / camber angle gamma (rad) */
  dz?: number | undefined;
  /** Roll rotation rx (rad) */
  rx?: number | undefined;
  /** Pitch rotation ry (rad) */
  ry?: number | undefined;
  /** Yaw rotation rz (rad) */
  rz?: number | undefined;
  /** Y-axis translational velocity vy */
  vy?: number | undefined;
  /** Z-axis translational velocity vz */
  vz?: number | undefined;
  /** X-axis angular velocity wx (rad/s) */
  wx?: number | undefined;
  /** Y-axis angular velocity wy (rad/s) */
  wy?: number | undefined;
  /** Z-axis angular velocity wz (rad/s) */
  wz?: number | undefined;
}

export interface AdamsEvalOutput {
  /** Primary scalar result (function value or Fx) */
  value: number;
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
  /** Aligning torque Mz (alias for tz on tire models) */
  mz: number;
}

export interface AdamsElementDescriptor {
  id?: string | number | undefined;
  modelType: string;
  params?: number[] | Record<string, number> | undefined;
}

export interface AdamsLinkedElementInstance {
  id: string;
  modelType: string;
  archetypeId: number;
  init(): number;
  evaluate(io: AdamsEvalIO, tSec?: number, dtSec?: number): AdamsEvalOutput;
}

interface AdamsWasmExports {
  memory: WebAssembly.Memory;
  adamsGetArenaBase(): number;
  adamsModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  adamsModelEval(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/adams-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveAdamsStdLibWasmBytes(): Uint8Array {
  ensureBuiltInAdamsLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("adams")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getAdamsStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: AdamsEvalIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io.x ?? 0.0;
  views.f64[base + 1] = io.xdot ?? 0.0;
  views.f64[base + 2] = io.dy ?? 0.0;
  views.f64[base + 3] = io.dz ?? 0.0;
  views.f64[base + 4] = io.rx ?? 0.0;
  views.f64[base + 5] = io.ry ?? 0.0;
  views.f64[base + 6] = io.rz ?? 0.0;
  views.f64[base + 7] = io.vy ?? 0.0;
  views.f64[base + 8] = io.vz ?? 0.0;
  views.f64[base + 9] = io.wx ?? 0.0;
  views.f64[base + 10] = io.wy ?? 0.0;
  views.f64[base + 11] = io.wz ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number, scalarVal: number): AdamsEvalOutput {
  const dBase = (slotPtr + OFF_DSTATE) >> 3;
  const fx = views.f64[dBase + 0] ?? scalarVal;
  const fy = views.f64[dBase + 1] ?? 0.0;
  const fz = views.f64[dBase + 2] ?? 0.0;
  const tx = views.f64[dBase + 3] ?? 0.0;
  const ty = views.f64[dBase + 4] ?? 0.0;
  const tz = views.f64[dBase + 5] ?? 0.0;
  return {
    value: scalarVal,
    fx,
    fy,
    fz,
    tx,
    ty,
    tz,
    mz: tz,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for an MSC Adams element or runtime function.
 */
export function instantiateAdamsWasmModel(
  element: AdamsElementDescriptor,
  wasmBytes?: Uint8Array,
): AdamsLinkedElementInstance | undefined {
  const schema = lookupAdamsModelSchema(element.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveAdamsStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as AdamsWasmExports;
  if (!exports.memory || typeof exports.adamsModelInit !== "function" || typeof exports.adamsModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.adamsGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (positional array or named record overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const paramArr = Array.isArray(element.params) ? element.params : undefined;
  const paramMap = !Array.isArray(element.params) && element.params ? element.params : undefined;
  const conCount = Math.max(schema.parameters.length, paramArr?.length ?? 0);

  for (let i = 0; i < conCount; i++) {
    const pSpec = schema.parameters[i];
    const defaultVal = typeof pSpec?.defaultValue === "number" ? pSpec.defaultValue : 0.0;
    let resolved = defaultVal;
    const posVal = paramArr?.[i];
    const namedVal = pSpec?.key !== undefined ? paramMap?.[pSpec.key] : undefined;
    if (posVal !== undefined && Number.isFinite(posVal)) {
      resolved = posVal;
    } else if (namedVal !== undefined && Number.isFinite(namedVal)) {
      resolved = namedVal;
    }
    views.f64[conBase + i] = resolved;
  }

  return {
    id: String(element.id ?? schema.name),
    modelType: schema.name,
    archetypeId,
    init(): number {
      return exports.adamsModelInit(archetypeId, slotPtr, conCount);
    },
    evaluate(io: AdamsEvalIO, tSec = 0.0, dtSec = 1e-3): AdamsEvalOutput {
      writeIo(views, slotPtr, io);
      const scalarVal = exports.adamsModelEval(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr, scalarVal);
    },
  };
}
