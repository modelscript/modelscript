// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInOneLinerLibraryRegistered, lookupOneLinerModelSchema } from "./library-package-adapter.js";
import { getOneLinerStdLibWasmBytes } from "./oneliner-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface OneLinerModelConfig {
  modelType: string;
  id?: string | undefined;
  busId?: string | undefined;
  branchId?: string | undefined;
  /** Positional parameter overrides matching schema order (or keyed map). */
  params?: number[] | Record<string, number> | undefined;
}

export interface OneLinerEvalInput {
  iFaultA?: number | undefined;
  rOhms?: number | undefined;
  xOhms?: number | undefined;
  iOpPu?: number | undefined;
  iRestPu?: number | undefined;
  angleDeg?: number | undefined;
  harm2Pct?: number | undefined;
  lengthMiles?: number | undefined;
}

export interface OneLinerEvalOutput {
  tripped: boolean;
  tripTimeSec: number;
  pickupMultiple: number;
  margin: number;
  z1Mag: number;
  z0Mag: number;
  rTotal: number;
  xTotal: number;
}

export interface OneLinerLinkedWasmInstance {
  id: string;
  busId: string;
  branchId: string;
  modelType: string;
  archetypeId: number;
  init(): number;
  evaluate(input: OneLinerEvalInput): OneLinerEvalOutput;
}

interface OneLinerWasmExports {
  memory: WebAssembly.Memory;
  olGetArenaBase(): number;
  olModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  olModelEval(archetypeId: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/oneliner-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveOneLinerStdLibWasmBytes(): Uint8Array {
  ensureBuiltInOneLinerLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("oneliner")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getOneLinerStdLibWasmBytes();
}

function writeEvalInput(views: CachedMemoryViews, slotPtr: number, input: OneLinerEvalInput): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = input.iFaultA ?? 0.0;
  views.f64[base + 1] = input.rOhms ?? 0.0;
  views.f64[base + 2] = input.xOhms ?? 0.0;
  views.f64[base + 3] = input.iOpPu ?? 0.0;
  views.f64[base + 4] = input.iRestPu ?? 0.0;
  views.f64[base + 5] = input.angleDeg ?? 0.0;
  views.f64[base + 6] = input.harm2Pct ?? 0.0;
  views.f64[base + 7] = input.lengthMiles ?? 1.0;
}

function readEvalOutput(views: CachedMemoryViews, slotPtr: number): OneLinerEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    tripped: (views.f64[base + 8] ?? 0.0) >= 0.5,
    tripTimeSec: views.f64[base + 9] ?? 1e9,
    pickupMultiple: views.f64[base + 10] ?? 0.0,
    margin: views.f64[base + 11] ?? 0.0,
    z1Mag: views.f64[base + 12] ?? 0.0,
    z0Mag: views.f64[base + 13] ?? 0.0,
    rTotal: views.f64[base + 14] ?? 0.0,
    xTotal: views.f64[base + 15] ?? 0.0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for an ASPEN OneLiner
 * protection relay or sequence equipment model.
 */
export function instantiateOneLinerWasmModel(
  config: OneLinerModelConfig,
  wasmBytes?: Uint8Array,
): OneLinerLinkedWasmInstance | undefined {
  const schema = lookupOneLinerModelSchema(config.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveOneLinerStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as OneLinerWasmExports;
  if (!exports.memory || typeof exports.olModelInit !== "function" || typeof exports.olModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.olGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (config.params overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const positional = Array.isArray(config.params) ? config.params : undefined;
  const keyed = config.params && !Array.isArray(config.params) ? config.params : undefined;
  const conCount = Math.max(schema.parameters.length, positional?.length ?? 0);

  for (let i = 0; i < conCount; i++) {
    const paramSchema = schema.parameters[i];
    const defaultVal = typeof paramSchema?.defaultValue === "number" ? paramSchema.defaultValue : 0.0;
    let resolved = defaultVal;
    if (positional && positional[i] !== undefined && Number.isFinite(positional[i])) {
      resolved = positional[i]!;
    } else if (
      keyed &&
      paramSchema &&
      keyed[paramSchema.key] !== undefined &&
      Number.isFinite(keyed[paramSchema.key])
    ) {
      resolved = keyed[paramSchema.key]!;
    }
    views.f64[conBase + i] = resolved;
  }

  return {
    id: config.id ?? `${schema.name}_1`,
    busId: config.busId ?? "BUS_1",
    branchId: config.branchId ?? "BR_1",
    modelType: schema.name,
    archetypeId,
    init(): number {
      return exports.olModelInit(archetypeId, slotPtr, conCount);
    },
    evaluate(input: OneLinerEvalInput): OneLinerEvalOutput {
      writeEvalInput(views, slotPtr, input);
      exports.olModelEval(archetypeId, slotPtr, conCount);
      return readEvalOutput(views, slotPtr);
    },
  };
}
