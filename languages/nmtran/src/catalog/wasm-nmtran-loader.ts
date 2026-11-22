// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInNmtranLibraryRegistered, lookupNmtranModelSchema } from "./library-package-adapter.js";
import { getNmtranStdLibWasmBytes } from "./nmtran-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_STATE = 0x580;
const OFF_IO = 0x780;

export interface NmtranModelDescriptor {
  /** Canonical subroutine or block name (e.g. `"ADVAN1"`, `"ADVAN2"`, `"PRED_EMAX"`). */
  modelType: string;
  /** Optional positional or named parameter overrides (named keys match schema parameter keys). */
  params?: number[] | Record<string, number> | undefined;
}

export interface NmtranEvalIO {
  dose?: number | undefined;
  amt?: number | undefined;
  rate?: number | undefined;
  ii?: number | undefined;
  addl?: number | undefined;
  ss?: number | boolean | undefined;
  conc?: number | undefined;
  ipred?: number | undefined;
  eps1?: number | undefined;
  eps2?: number | undefined;
  dt?: number | undefined;
}

export interface NmtranEvalOutput {
  /** Primary scalar output returned by `nmModelEval` (conc for ADVAN, effect for PD, dv for ERROR, K for TRANS). */
  value: number;
  time: number;
  conc: number;
  amountCentral: number;
  amountDepot: number;
  amountPeriph1: number;
  amountPeriph2: number;
  effect: number;
  ipred: number;
  dv: number;
  states: number[];
}

export interface NmtranLinkedModelInstance {
  modelType: string;
  archetypeId: number;
  init(io?: NmtranEvalIO): number;
  evalAt(tHours: number, io?: NmtranEvalIO): NmtranEvalOutput;
}

interface NmtranWasmExports {
  memory: WebAssembly.Memory;
  nmGetArenaBase(): number;
  nmModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  nmModelEval(archetypeId: number, t: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/nmtran-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveNmtranStdLibWasmBytes(): Uint8Array {
  ensureBuiltInNmtranLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("nmtran")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getNmtranStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io?: NmtranEvalIO): void {
  if (!io) return;
  const base = (slotPtr + OFF_IO) >> 3;
  const doseVal = io.dose ?? io.amt;
  if (doseVal !== undefined) views.f64[base + 1] = doseVal;
  if (io.rate !== undefined) views.f64[base + 2] = io.rate;
  if (io.conc !== undefined) views.f64[base + 3] = io.conc;
  if (io.ipred !== undefined) views.f64[base + 9] = io.ipred;
  if (io.eps1 !== undefined) views.f64[base + 11] = io.eps1;
  if (io.eps2 !== undefined) views.f64[base + 12] = io.eps2;
  if (io.dt !== undefined) views.f64[base + 13] = io.dt;
  if (io.ii !== undefined) views.f64[base + 14] = io.ii;
  if (io.addl !== undefined) views.f64[base + 15] = io.addl;
  if (io.ss !== undefined) {
    views.i32[slotPtr >> 2] = io.ss === true || (typeof io.ss === "number" && io.ss !== 0) ? 1 : 0;
  }
}

function readOutput(views: CachedMemoryViews, slotPtr: number, value: number, stateCount: number): NmtranEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  const stateBase = (slotPtr + OFF_STATE) >> 3;
  const states: number[] = [];
  for (let i = 0; i < stateCount; i++) {
    states.push(views.f64[stateBase + i] ?? 0);
  }
  return {
    value,
    time: views.f64[base + 0] ?? 0,
    conc: views.f64[base + 3] ?? 0,
    amountCentral: views.f64[base + 4] ?? 0,
    amountDepot: views.f64[base + 5] ?? 0,
    amountPeriph1: views.f64[base + 6] ?? 0,
    amountPeriph2: views.f64[base + 7] ?? 0,
    effect: views.f64[base + 8] ?? 0,
    ipred: views.f64[base + 9] ?? 0,
    dv: views.f64[base + 10] ?? 0,
    states,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a NONMEM / PREDPP subroutine or PK/PD model.
 */
export function instantiateNmtranWasmModel(
  model: NmtranModelDescriptor,
  wasmBytes?: Uint8Array,
): NmtranLinkedModelInstance | undefined {
  const schema = lookupNmtranModelSchema(model.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveNmtranStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as NmtranWasmExports;
  if (!exports.memory || typeof exports.nmModelInit !== "function" || typeof exports.nmModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.nmGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (positional array or named record overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const positional = Array.isArray(model.params) ? model.params : undefined;
  const named = model.params && !Array.isArray(model.params) ? model.params : undefined;
  const namedLower = new Map<string, number>();
  if (named) {
    for (const [k, v] of Object.entries(named)) {
      if (Number.isFinite(v)) namedLower.set(k.toLowerCase(), v);
    }
  }

  const conCount = Math.max(schema.parameters.length, positional?.length ?? 0);
  for (let i = 0; i < conCount; i++) {
    const paramSpec = schema.parameters[i];
    const defaultVal = paramSpec?.defaultValue;
    let resolved: number | undefined;
    if (positional && positional[i] !== undefined && Number.isFinite(positional[i])) {
      resolved = positional[i];
    } else if (paramSpec && namedLower.has(paramSpec.key.toLowerCase())) {
      resolved = namedLower.get(paramSpec.key.toLowerCase());
    }
    views.f64[conBase + i] = resolved ?? (typeof defaultVal === "number" ? defaultVal : 0.0);
  }

  let activeStates = Math.max(1, schema.parameters.length > 0 ? 4 : 1);

  return {
    modelType: schema.name,
    archetypeId,
    init(io?: NmtranEvalIO): number {
      writeIo(views, slotPtr, io);
      activeStates = exports.nmModelInit(archetypeId, slotPtr, conCount);
      return activeStates;
    },
    evalAt(tHours: number, io?: NmtranEvalIO): NmtranEvalOutput {
      writeIo(views, slotPtr, io);
      const value = exports.nmModelEval(archetypeId, tHours, slotPtr, conCount);
      return readOutput(views, slotPtr, value, Math.max(activeStates, 3));
    },
  };
}
