// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { getCymeStdLibWasmBytes } from "./cyme-std-lib-data.js";
import { ensureBuiltInCymeLibraryRegistered, lookupCymeModelSchema } from "./library-package-adapter.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_AUX = 0x680;
const OFF_IO = 0x780;

export interface CymeEquipmentDescriptor {
  equipmentId: string;
  modelType: string;
  params?: number[] | undefined;
}

export interface CymeEvalInput {
  vPu?: number | undefined;
  iAmps?: number | undefined;
  lengthKm?: number | undefined;
  freqHz?: number | undefined;
  rhoOhmM?: number | undefined;
  tapStep?: number | undefined;
  pAvailPu?: number | undefined;
  closedFlag?: number | undefined;
}

export interface CymeEvalOutput {
  r1Ohm: number;
  x1Ohm: number;
  r0Ohm: number;
  x0Ohm: number;
  tripTimeSec: number;
  tapRatio: number;
  pOutPu: number;
  qOutPu: number;
  /** Full Kron-reduced 3x3 phase impedance matrix [R_ij, X_ij] in Ohms (row-major, 18 f64s) for conductors/cables. */
  zAbc?: number[] | undefined;
}

export interface CymeLinkedEquipmentInstance {
  equipmentId: string;
  modelType: string;
  archetypeId: number;
  init(): number;
  evaluate(input: CymeEvalInput): CymeEvalOutput;
}

interface CymeWasmExports {
  memory: WebAssembly.Memory;
  cymeGetArenaBase(): number;
  cymeModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  cymeModelEval(archetypeId: number, slotPtr: number, conCount: number): void;
}

/**
 * Resolves the active `@modelscript/cyme-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveCymeStdLibWasmBytes(): Uint8Array {
  ensureBuiltInCymeLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("cyme")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getCymeStdLibWasmBytes();
}

function writeEvalInput(views: CachedMemoryViews, slotPtr: number, input: CymeEvalInput): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = input.vPu ?? 1.0;
  views.f64[base + 1] = input.iAmps ?? 0.0;
  views.f64[base + 2] = input.lengthKm ?? 1.0;
  views.f64[base + 3] = input.freqHz ?? 60.0;
  views.f64[base + 4] = input.rhoOhmM ?? 100.0;
  views.f64[base + 5] = input.tapStep !== undefined ? input.tapStep : Number.NaN;
  views.f64[base + 6] = input.pAvailPu ?? 1.0;
  views.f64[base + 7] = input.closedFlag ?? 1.0;
}

function readEvalOutput(views: CachedMemoryViews, slotPtr: number): CymeEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  const auxBase = (slotPtr + OFF_AUX) >> 3;
  const zAbc: number[] = [];
  for (let i = 0; i < 18; i++) {
    zAbc.push(views.f64[auxBase + i] ?? 0);
  }
  return {
    r1Ohm: views.f64[base + 8] ?? 0,
    x1Ohm: views.f64[base + 9] ?? 0,
    r0Ohm: views.f64[base + 10] ?? 0,
    x0Ohm: views.f64[base + 11] ?? 0,
    tripTimeSec: views.f64[base + 12] ?? -1,
    tapRatio: views.f64[base + 13] ?? 1,
    pOutPu: views.f64[base + 14] ?? 0,
    qOutPu: views.f64[base + 15] ?? 0,
    zAbc,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for an Eaton CYME equipment model.
 */
export function instantiateCymeWasmModel(
  equipment: CymeEquipmentDescriptor,
  wasmBytes?: Uint8Array,
): CymeLinkedEquipmentInstance | undefined {
  const schema = lookupCymeModelSchema(equipment.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveCymeStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as CymeWasmExports;
  if (!exports.memory || typeof exports.cymeModelInit !== "function" || typeof exports.cymeModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.cymeGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (equipment.params overrides schema defaults)
  const overrides = equipment.params ?? [];
  const conBase = (slotPtr + OFF_CON) >> 3;
  const conCount = Math.max(schema.parameters.length, overrides.length);
  for (let i = 0; i < conCount; i++) {
    const paramVal = overrides[i];
    const defaultVal = schema.parameters[i]?.defaultValue;
    views.f64[conBase + i] =
      paramVal !== undefined && Number.isFinite(paramVal)
        ? paramVal
        : typeof defaultVal === "number"
          ? defaultVal
          : 0.0;
  }

  return {
    equipmentId: equipment.equipmentId,
    modelType: schema.name,
    archetypeId,
    init(): number {
      return exports.cymeModelInit(archetypeId, slotPtr, conCount);
    },
    evaluate(input: CymeEvalInput): CymeEvalOutput {
      writeEvalInput(views, slotPtr, input);
      exports.cymeModelEval(archetypeId, slotPtr, conCount);
      return readEvalOutput(views, slotPtr);
    },
  };
}
