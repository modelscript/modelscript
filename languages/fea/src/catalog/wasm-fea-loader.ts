// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { getFeaStdLibWasmBytes } from "./fea-std-lib-data.js";
import { ensureBuiltInFeaLibraryRegistered, lookupFeaCardSchema } from "./library-package-adapter.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_DSTATE = 0x680;
const OFF_IO = 0x780;

export interface FeaConstitutiveInput {
  eps11: number;
  eps22?: number | undefined;
  eps33?: number | undefined;
  gamma12?: number | undefined;
  gamma23?: number | undefined;
  gamma13?: number | undefined;
  tempC?: number | undefined;
  dtSec?: number | undefined;
}

export interface FeaConstitutiveOutput {
  sig11: number;
  sig22: number;
  sig33: number;
  tau12: number;
  tau23?: number | undefined;
  tau13?: number | undefined;
  vonMises: number;
  strainEnergy: number;
  aux1: number;
  aux2: number;
  dGamma?: number | undefined;
  shearStiffness?: number | undefined;
}

export interface FeaLinkedCardInstance {
  id: string;
  cardType: string;
  archetypeId: number;
  init(): number;
  evaluate(input: FeaConstitutiveInput): FeaConstitutiveOutput;
}

interface FeaWasmExports {
  memory: WebAssembly.Memory;
  feaGetArenaBase(): number;
  feaModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  feaModelEval(archetypeId: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/fea-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveFeaStdLibWasmBytes(): Uint8Array {
  ensureBuiltInFeaLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("fea")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getFeaStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, input: FeaConstitutiveInput): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = input.eps11;
  views.f64[base + 1] = input.eps22 ?? 0.0;
  views.f64[base + 2] = input.eps33 ?? 0.0;
  views.f64[base + 3] = input.gamma12 ?? 0.0;
  views.f64[base + 4] = input.gamma23 ?? 0.0;
  views.f64[base + 5] = input.gamma13 ?? 0.0;
  views.f64[base + 6] = input.tempC ?? 20.0;
  views.f64[base + 7] = input.dtSec ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number): FeaConstitutiveOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  const dBase = (slotPtr + OFF_DSTATE) >> 3;
  return {
    sig11: views.f64[base + 8] ?? 0,
    sig22: views.f64[base + 9] ?? 0,
    sig33: views.f64[base + 10] ?? 0,
    tau12: views.f64[base + 11] ?? 0,
    tau23: views.f64[dBase + 1] ?? 0,
    tau13: views.f64[dBase + 2] ?? 0,
    vonMises: views.f64[base + 12] ?? 0,
    strainEnergy: views.f64[base + 13] ?? 0,
    aux1: views.f64[base + 14] ?? 0,
    aux2: views.f64[base + 15] ?? 0,
    dGamma: views.f64[dBase + 0] ?? 0,
    shearStiffness: views.f64[dBase + 3] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for an FEA element, section, or material card.
 */
export function instantiateFeaWasmCard(
  cardType: string,
  params?: number[] | Record<string, number>,
  id = "1",
  wasmBytes?: Uint8Array,
): FeaLinkedCardInstance | undefined {
  const schema = lookupFeaCardSchema(cardType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveFeaStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as FeaWasmExports;
  if (!exports.memory || typeof exports.feaModelInit !== "function" || typeof exports.feaModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.feaGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (positional or named overrides take precedence over schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const positional = Array.isArray(params) ? params : undefined;
  const named = params && !Array.isArray(params) ? params : undefined;
  const conCount = Math.max(schema.parameters.length, positional?.length ?? 0);

  for (let i = 0; i < conCount; i++) {
    const paramSchema = schema.parameters[i];
    const positionalVal = positional?.[i];
    const namedVal = paramSchema && named ? named[paramSchema.key] : undefined;
    const defaultVal = paramSchema?.defaultValue;

    let value = 0.0;
    if (positionalVal !== undefined && Number.isFinite(positionalVal)) {
      value = positionalVal;
    } else if (namedVal !== undefined && Number.isFinite(namedVal)) {
      value = namedVal;
    } else if (typeof defaultVal === "number") {
      value = defaultVal;
    }
    views.f64[conBase + i] = value;
  }

  return {
    id,
    cardType: schema.name,
    archetypeId,
    init(): number {
      return exports.feaModelInit(archetypeId, slotPtr, conCount);
    },
    evaluate(input: FeaConstitutiveInput): FeaConstitutiveOutput {
      writeIo(views, slotPtr, input);
      exports.feaModelEval(archetypeId, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
