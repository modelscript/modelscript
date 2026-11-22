// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { getEasy5StdLibWasmBytes } from "./easy5-std-lib-data.js";
import { ensureBuiltInEasy5LibraryRegistered, lookupEasy5ModelSchema } from "./library-package-adapter.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface Easy5WasmComponentSpec {
  id: string;
  type: string;
  parameters?: Record<string, number | number[] | string> | number[] | undefined;
}

export interface Easy5ModelIO {
  u0: number;
  u1?: number | undefined;
  u2?: number | undefined;
  u3?: number | undefined;
}

export interface Easy5StepOutput {
  y0: number;
  y1: number;
  y2: number;
  y3: number;
}

export interface Easy5LinkedComponentInstance {
  id: string;
  modelType: string;
  archetypeId: number;
  init(io?: Easy5ModelIO): number;
  checkFlatStart(): number;
  doStep(tSec: number, dtSec: number, io: Easy5ModelIO): Easy5StepOutput;
}

interface Easy5WasmExports {
  memory: WebAssembly.Memory;
  easy5GetArenaBase(): number;
  easy5ModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  easy5ModelStep(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): void;
  easy5ModelCheckFlatStart(archetypeId: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/easy5-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveEasy5StdLibWasmBytes(): Uint8Array {
  ensureBuiltInEasy5LibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("easy5")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getEasy5StdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: Easy5ModelIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io.u0;
  views.f64[base + 1] = io.u1 ?? 0.0;
  views.f64[base + 2] = io.u2 ?? 0.0;
  views.f64[base + 3] = io.u3 ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): Easy5StepOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    y0: views.f64[base + 4] ?? 0.0,
    y1: views.f64[base + 5] ?? 0.0,
    y2: views.f64[base + 6] ?? 0.0,
    y3: views.f64[base + 7] ?? 0.0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for an Easy5 component.
 */
export function instantiateEasy5WasmModel(
  component: Easy5WasmComponentSpec,
  wasmBytes?: Uint8Array,
): Easy5LinkedComponentInstance | undefined {
  const schema = lookupEasy5ModelSchema(component.type);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveEasy5StdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as Easy5WasmExports;
  if (!exports.memory || typeof exports.easy5ModelInit !== "function") return undefined;

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.easy5GetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (component.parameters overrides schema defaults by position or key)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const paramsInput = component.parameters;
  const isArrayParams = Array.isArray(paramsInput);
  const conCount = Math.max(schema.parameters.length, isArrayParams ? paramsInput.length : 0);

  const paramMap = new Map<string, number>();
  if (paramsInput && !isArrayParams) {
    for (const [k, v] of Object.entries(paramsInput)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        paramMap.set(k.toUpperCase(), v);
      }
    }
  }

  for (let i = 0; i < conCount; i++) {
    const schemaParam = schema.parameters[i];
    const defaultVal = typeof schemaParam?.defaultValue === "number" ? schemaParam.defaultValue : 0.0;
    let val = defaultVal;
    if (isArrayParams) {
      const p = paramsInput[i];
      if (p !== undefined && Number.isFinite(p)) val = p;
    } else if (schemaParam) {
      const override = paramMap.get(schemaParam.key.toUpperCase());
      if (override !== undefined) val = override;
    }
    views.f64[conBase + i] = val;
  }

  return {
    id: component.id,
    modelType: schema.name,
    archetypeId,
    init(io?: Easy5ModelIO): number {
      writeIo(views, slotPtr, io ?? { u0: 0.0 });
      return exports.easy5ModelInit(archetypeId, slotPtr, conCount);
    },
    checkFlatStart(): number {
      return exports.easy5ModelCheckFlatStart(archetypeId, slotPtr, conCount);
    },
    doStep(tSec: number, dtSec: number, io: Easy5ModelIO): Easy5StepOutput {
      writeIo(views, slotPtr, io);
      exports.easy5ModelStep(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
