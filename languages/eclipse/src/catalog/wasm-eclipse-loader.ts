// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { getEclipseStdLibWasmBytes } from "./eclipse-std-lib-data.js";
import { ensureBuiltInEclipseLibraryRegistered, lookupEclipseModelSchema } from "./library-package-adapter.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface EclipseModelConfig {
  modelType: string;
  id?: string | undefined;
  /** Positional parameter overrides matching schema order (or keyed map). */
  params?: number[] | Record<string, number> | undefined;
}

export interface EclipseModelIO {
  pressure?: number | undefined;
  temperature?: number | undefined;
  sw?: number | undefined;
  sg?: number | undefined;
  bhp?: number | undefined;
  dt?: number | undefined;
  mobility?: number | undefined;
  rateIn?: number | undefined;
}

export interface EclipseModelEvalOutput {
  out0: number;
  out1: number;
  out2: number;
  out3: number;
}

export interface EclipseLinkedPhysicsInstance {
  id: string;
  modelType: string;
  archetypeId: number;
  init(io?: EclipseModelIO): number;
  eval(io: EclipseModelIO): EclipseModelEvalOutput;
}

interface EclipseWasmExports {
  memory: WebAssembly.Memory;
  eclGetArenaBase(): number;
  eclModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  eclModelEval(archetypeId: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/eclipse-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveEclipseStdLibWasmBytes(): Uint8Array {
  ensureBuiltInEclipseLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("eclipse")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getEclipseStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: EclipseModelIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io.pressure ?? 3000.0;
  views.f64[base + 1] = io.temperature ?? 180.0;
  views.f64[base + 2] = io.sw ?? 0.2;
  views.f64[base + 3] = io.sg ?? 0.0;
  views.f64[base + 4] = io.bhp ?? 2000.0;
  views.f64[base + 5] = io.dt ?? 0.0;
  views.f64[base + 6] = io.mobility ?? 1.0;
  views.f64[base + 7] = io.rateIn ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): EclipseModelEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    out0: views.f64[base + 8] ?? 0,
    out1: views.f64[base + 9] ?? 0,
    out2: views.f64[base + 10] ?? 0,
    out3: views.f64[base + 11] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for an ECLIPSE reservoir physics model.
 */
export function instantiateEclipseWasmModel(
  config: EclipseModelConfig,
  wasmBytes?: Uint8Array,
): EclipseLinkedPhysicsInstance | undefined {
  const schema = lookupEclipseModelSchema(config.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveEclipseStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as EclipseWasmExports;
  if (!exports.memory || typeof exports.eclModelInit !== "function" || typeof exports.eclModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.eclGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (config.params overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const positional = Array.isArray(config.params) ? config.params : undefined;
  const keyed = config.params && !Array.isArray(config.params) ? config.params : undefined;
  const conCount = Math.max(schema.parameters.length, positional?.length ?? 0);

  for (let i = 0; i < conCount; i++) {
    const paramSpec = schema.parameters[i];
    const override = positional ? positional[i] : paramSpec ? keyed?.[paramSpec.key] : undefined;
    const defaultVal = paramSpec?.defaultValue;
    views.f64[conBase + i] =
      override !== undefined && Number.isFinite(override)
        ? override
        : typeof defaultVal === "number"
          ? defaultVal
          : 0.0;
  }

  return {
    id: config.id ?? schema.name,
    modelType: schema.name,
    archetypeId,
    init(io?: EclipseModelIO): number {
      if (io) writeIo(views, slotPtr, io);
      return exports.eclModelInit(archetypeId, slotPtr, conCount);
    },
    eval(io: EclipseModelIO): EclipseModelEvalOutput {
      writeIo(views, slotPtr, io);
      exports.eclModelEval(archetypeId, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
