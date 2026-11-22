// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { getAspenStdLibWasmBytes } from "./aspen-std-lib-data.js";
import { ensureBuiltInAspenLibraryRegistered, lookupAspenModelSchema } from "./library-package-adapter.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface AspenModelConfig {
  id: string;
  modelType: string;
  params?: Record<string, number> | number[] | undefined;
}

export interface AspenModelIO {
  /** Inlet / hot / evaluation temperature (K). */
  T_in: number;
  /** Inlet / evaluation pressure (Pa). */
  P_in: number;
  /** Total molar flow rate (mol/s). */
  F_in?: number | undefined;
  /** Feed mole fraction of light component 1 (0..1). */
  z1?: number | undefined;
  /** Cold stream inlet temperature (HeatX) or specified target temperature (K). */
  T_cold_in?: number | undefined;
  /** Specified outlet pressure (Pa) or cold stream molar flow (HeatX, mol/s). */
  P_out_spec?: number | undefined;
  /** Hot stream molar heat capacity Cp (J/(mol*K)) or Cp/Cv ratio gamma. */
  Cp_hot?: number | undefined;
  /** Overall heat transfer coefficient times area UA (W/K) or cold Cp. */
  UA?: number | undefined;
}

export interface AspenModelOutput {
  /** Outlet / hot-outlet temperature (K). */
  T_out: number;
  /** Outlet pressure (Pa). */
  P_out: number;
  /** Vapor fraction beta (Flash), conversion X (Reactor), or cold outlet T (HeatX). */
  vaporFraction: number;
  /** Heat duty Q (W) or shaft power W_shaft (W). */
  dutyW: number;
  /** Compressibility Z (EOS), LMTD (K, HeatX), or liquid mole fraction x1 (Flash). */
  compressibilityOrLmtd: number;
  /** Fugacity coefficient phi (EOS), vapor mole fraction y1 (Flash), or P_sat (Pa, Pure Component). */
  fugacityOrY1OrPsat: number;
  /** VLE K1, liquid Z, Damkohler number, or pressure drop dP. */
  aux1: number;
  /** VLE K2 or convergence residual (0 = converged). */
  aux2: number;
  /** Convergence status code (0 = success). */
  status: number;
}

export interface AspenLinkedModelInstance {
  id: string;
  modelType: string;
  archetypeId: number;
  init(): number;
  eval(io: AspenModelIO): AspenModelOutput;
}

interface AspenWasmExports {
  memory: WebAssembly.Memory;
  aspenGetArenaBase(): number;
  aspenModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  aspenModelEval(archetypeId: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/aspen-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveAspenStdLibWasmBytes(): Uint8Array {
  ensureBuiltInAspenLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("aspen")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getAspenStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: AspenModelIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  views.f64[base + 0] = io.T_in;
  views.f64[base + 1] = io.P_in;
  views.f64[base + 2] = io.F_in ?? 100.0;
  views.f64[base + 3] = io.z1 ?? 0.5;
  views.f64[base + 4] = io.T_cold_in ?? 0.0;
  views.f64[base + 5] = io.P_out_spec ?? 0.0;
  views.f64[base + 6] = io.Cp_hot ?? 0.0;
  views.f64[base + 7] = io.UA ?? 0.0;
}

function readOutput(views: CachedMemoryViews, slotPtr: number, status: number): AspenModelOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    T_out: views.f64[base + 8] ?? 0,
    P_out: views.f64[base + 9] ?? 0,
    vaporFraction: views.f64[base + 10] ?? 0,
    dutyW: views.f64[base + 11] ?? 0,
    compressibilityOrLmtd: views.f64[base + 12] ?? 0,
    fugacityOrY1OrPsat: views.f64[base + 13] ?? 0,
    aux1: views.f64[base + 14] ?? 0,
    aux2: views.f64[base + 15] ?? 0,
    status,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for an Aspen unit operation,
 * thermodynamic property method, or pure component databank entry.
 */
export function instantiateAspenWasmModel(
  config: AspenModelConfig,
  wasmBytes?: Uint8Array,
): AspenLinkedModelInstance | undefined {
  const schema = lookupAspenModelSchema(config.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveAspenStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as AspenWasmExports;
  if (!exports.memory || typeof exports.aspenModelEval !== "function") return undefined;

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.aspenGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (positional array or keyed Record overrides schema defaults)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const positional = Array.isArray(config.params) ? config.params : undefined;
  const keyed = config.params && !Array.isArray(config.params) ? config.params : undefined;
  const conCount = Math.max(schema.parameters.length, positional?.length ?? 0);

  for (let i = 0; i < conCount; i++) {
    const paramSpec = schema.parameters[i];
    let val: number | undefined = positional ? positional[i] : undefined;
    if (val === undefined && keyed && paramSpec) {
      const exact = keyed[paramSpec.key];
      if (exact !== undefined) {
        val = exact;
      } else {
        const lowerKey = paramSpec.key.toLowerCase();
        for (const [k, v] of Object.entries(keyed)) {
          if (k.toLowerCase() === lowerKey) {
            val = v;
            break;
          }
        }
      }
    }
    const defaultVal = paramSpec?.defaultValue;
    views.f64[conBase + i] =
      val !== undefined && Number.isFinite(val) ? val : typeof defaultVal === "number" ? defaultVal : 0.0;
  }

  return {
    id: config.id,
    modelType: schema.name,
    archetypeId,
    init(): number {
      return exports.aspenModelInit(archetypeId, slotPtr, conCount);
    },
    eval(io: AspenModelIO): AspenModelOutput {
      writeIo(views, slotPtr, io);
      const status = exports.aspenModelEval(archetypeId, slotPtr, conCount);
      return readOutput(views, slotPtr, status);
    },
  };
}
