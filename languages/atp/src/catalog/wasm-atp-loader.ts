// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { getAtpStdLibWasmBytes } from "./atp-std-lib-data.js";
import { ensureBuiltInAtpLibraryRegistered, lookupAtpModelSchema } from "./library-package-adapter.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface AtpComponentSpecInput {
  modelType: string;
  id?: string | undefined;
  node1?: string | undefined;
  node2?: string | undefined;
  params?: number[] | undefined;
}

export interface AtpComponentIO {
  vNode1?: number | undefined;
  vNode2?: number | undefined;
  ctrlIn?: number | undefined;
  auxIn?: number | undefined;
}

export interface AtpComponentStepOutput {
  iBranch: number;
  gEq: number;
  iHist: number;
  iHist2: number;
  vSource: number;
  switchState: number;
  ctrlOut: number;
  flux: number;
  powerW: number;
  omegaRadS: number;
  torqueNm: number;
  auxOut: number;
}

export interface AtpLinkedComponentInstance {
  id: string;
  node1: string;
  node2: string;
  modelType: string;
  archetypeId: number;
  init(io?: AtpComponentIO): number;
  doStep(tSec: number, dtSec: number, io?: AtpComponentIO): AtpComponentStepOutput;
}

interface AtpWasmExports {
  memory: WebAssembly.Memory;
  atpGetArenaBase(): number;
  atpModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  atpModelStep(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): void;
}

/**
 * Resolves the active `@modelscript/atp-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveAtpStdLibWasmBytes(): Uint8Array {
  ensureBuiltInAtpLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("atp")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getAtpStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io?: AtpComponentIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io?.vNode1 ?? 0.0;
  views.f64[base + 1] = io?.vNode2 ?? 0.0;
  views.f64[base + 8] = io?.ctrlIn ?? 0.0;
  views.f64[base + 14] = io?.auxIn ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): AtpComponentStepOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    iBranch: views.f64[base + 2] ?? 0,
    gEq: views.f64[base + 3] ?? 0,
    iHist: views.f64[base + 4] ?? 0,
    iHist2: views.f64[base + 5] ?? 0,
    vSource: views.f64[base + 6] ?? 0,
    switchState: views.f64[base + 7] ?? 0,
    ctrlOut: views.f64[base + 9] ?? 0,
    flux: views.f64[base + 10] ?? 0,
    powerW: views.f64[base + 11] ?? 0,
    omegaRadS: views.f64[base + 12] ?? 0,
    torqueNm: views.f64[base + 13] ?? 0,
    auxOut: views.f64[base + 15] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for an EMTP-ATP component.
 */
export function instantiateAtpWasmModel(
  model: AtpComponentSpecInput,
  wasmBytes?: Uint8Array,
): AtpLinkedComponentInstance | undefined {
  const schema = lookupAtpModelSchema(model.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveAtpStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as AtpWasmExports;
  if (!exports.memory || typeof exports.atpModelInit !== "function") return undefined;

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.atpGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (model.params overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const provided = model.params ?? [];
  const conCount = Math.max(schema.parameters.length, provided.length);
  for (let i = 0; i < conCount; i++) {
    const paramVal = provided[i];
    const defaultVal = schema.parameters[i]?.defaultValue;
    views.f64[conBase + i] =
      paramVal !== undefined && Number.isFinite(paramVal)
        ? paramVal
        : typeof defaultVal === "number"
          ? defaultVal
          : 0.0;
  }

  return {
    id: model.id ?? schema.name,
    node1: model.node1 ?? "NODE1",
    node2: model.node2 ?? "GND",
    modelType: schema.name,
    archetypeId,
    init(io?: AtpComponentIO): number {
      writeIo(views, slotPtr, io);
      return exports.atpModelInit(archetypeId, slotPtr, conCount);
    },
    doStep(tSec: number, dtSec: number, io?: AtpComponentIO): AtpComponentStepOutput {
      writeIo(views, slotPtr, io);
      exports.atpModelStep(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
