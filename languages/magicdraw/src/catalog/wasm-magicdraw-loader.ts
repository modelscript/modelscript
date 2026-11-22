// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createIsolatedWasmInstance,
  createMemoryViews,
  ensureMemoryCapacity,
  globalLibraryRegistry,
  type CachedMemoryViews,
} from "@modelscript/runtime";
import { ensureBuiltInMagicDrawLibraryRegistered, lookupMagicDrawModelSchema } from "./library-package-adapter.js";
import { getMagicDrawStdLibWasmBytes } from "./magicdraw-std-lib-data.js";

const SLOT_STRIDE_BYTES = 2048;
const OFF_CON = 0x080;
const OFF_IO = 0x780;

export interface MagicDrawModelDescriptor {
  elementId: string;
  modelType: string;
  params?: Record<string, number> | number[] | undefined;
}

export interface MagicDrawModelIO {
  /** Primary input (`x` for unit conversion, `lhs` for constraints, `actual` for requirements, `child0` for rollups). */
  x?: number | undefined;
  /** Secondary input (`rhs` for constraints, optional `limit` override for requirements, `child1` for rollups). */
  rhs?: number | undefined;
  /** Optional vector of up to 8 child values for `CST_RollupPattern` aggregation (overrides `x`/`rhs` if provided). */
  values?: number[] | undefined;
}

export interface MagicDrawEvalOutput {
  /** Primary numeric output (`y` converted value, `rollupTotal`, `residual`, `margin`, or `mean`). */
  value: number;
  /** Boolean pass/fail verdict (`true` when `IO[9] >= 0.5`). */
  pass: boolean;
  /** Secondary output (`siCanonicalValue`, `budgetMargin`, `absResidual`, `marginPct`, or `sum`). */
  secondary: number;
  /** Tertiary output (`rollupTotalWithMargin`, `normalizedResidual`, `actual`, or `sampleCount`). */
  tertiary: number;
  /** Number of evaluations performed since `init()`. */
  evalCount: number;
  /** Minimum observed primary value. */
  minObserved: number;
  /** Maximum observed primary value. */
  maxObserved: number;
  /** Status code (`1` = pass, `-1` = fail, `0` = neutral). */
  statusCode: number;
}

export interface MagicDrawLinkedInstance {
  elementId: string;
  modelType: string;
  archetypeId: number;
  init(): number;
  eval(io: MagicDrawModelIO, tSec?: number, dtSec?: number): MagicDrawEvalOutput;
}

interface MagicDrawWasmExports {
  memory: WebAssembly.Memory;
  mdGetArenaBase(): number;
  mdModelInit(archetypeId: number, slotPtr: number, conCount: number): number;
  mdModelEval(archetypeId: number, t: number, dt: number, slotPtr: number, conCount: number): number;
}

/**
 * Resolves the active `@modelscript/magicdraw-std-lib` `runtime.wasm` bytes from `globalLibraryRegistry`
 * (falling back to the zero-I/O pre-bundled payload).
 */
export function resolveMagicDrawStdLibWasmBytes(): Uint8Array {
  ensureBuiltInMagicDrawLibraryRegistered();
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("magicdraw")) {
    if (pkg.wasmBytes && pkg.wasmBytes.byteLength > 0) {
      return pkg.wasmBytes;
    }
  }
  return getMagicDrawStdLibWasmBytes();
}

function writeIo(views: CachedMemoryViews, slotPtr: number, io: MagicDrawModelIO): void {
  const base = (slotPtr + OFF_IO) >> 3;
  for (let i = 0; i < 8; i++) {
    views.f64[base + i] = 0.0;
  }
  if (io.values && io.values.length > 0) {
    const count = Math.min(8, io.values.length);
    for (let i = 0; i < count; i++) {
      views.f64[base + i] = io.values[i] ?? 0.0;
    }
  } else {
    views.f64[base + 0] = io.x ?? 0.0;
    views.f64[base + 1] = io.rhs ?? 0.0;
  }
}

function readOutput(views: CachedMemoryViews, slotPtr: number): MagicDrawEvalOutput {
  const base = (slotPtr + OFF_IO) >> 3;
  return {
    value: views.f64[base + 8] ?? 0,
    pass: (views.f64[base + 9] ?? 0) >= 0.5,
    secondary: views.f64[base + 10] ?? 0,
    tertiary: views.f64[base + 11] ?? 0,
    evalCount: views.f64[base + 12] ?? 0,
    minObserved: views.f64[base + 13] ?? 0,
    maxObserved: views.f64[base + 14] ?? 0,
    statusCode: views.f64[base + 15] ?? 0,
  };
}

/**
 * Instantiates a cleanroom AssemblyScript WASM runtime slot for a MagicDraw / Cameo standard library element.
 */
export function instantiateMagicDrawWasmModel(
  model: MagicDrawModelDescriptor,
  wasmBytes?: Uint8Array,
): MagicDrawLinkedInstance | undefined {
  const schema = lookupMagicDrawModelSchema(model.modelType);
  const archetypeId = typeof schema?.extra?.["archetypeId"] === "number" ? (schema.extra["archetypeId"] as number) : 0;
  if (!schema || archetypeId <= 0) return undefined;

  const bytes = wasmBytes ?? resolveMagicDrawStdLibWasmBytes();
  const instance = createIsolatedWasmInstance(bytes);
  if (!instance) return undefined;

  const exports = instance.exports as unknown as MagicDrawWasmExports;
  if (!exports.memory || typeof exports.mdModelInit !== "function" || typeof exports.mdModelEval !== "function") {
    return undefined;
  }

  const views = createMemoryViews(exports.memory);
  const slotPtr = exports.mdGetArenaBase();
  ensureMemoryCapacity(views, slotPtr + SLOT_STRIDE_BYTES);

  // Populate CON parameter array (model.params overrides schema defaults by index or key)
  const conBase = (slotPtr + OFF_CON) >> 3;
  const positionalParams = Array.isArray(model.params) ? model.params : undefined;
  const namedParams = model.params && !Array.isArray(model.params) ? model.params : undefined;
  const conCount = Math.max(schema.parameters.length, positionalParams?.length ?? 0);

  for (let i = 0; i < conCount; i++) {
    const paramSpec = schema.parameters[i];
    const defaultVal = typeof paramSpec?.defaultValue === "number" ? paramSpec.defaultValue : 0.0;
    let resolved = defaultVal;
    if (positionalParams && positionalParams[i] !== undefined && Number.isFinite(positionalParams[i])) {
      resolved = positionalParams[i]!;
    } else if (
      namedParams &&
      paramSpec &&
      namedParams[paramSpec.key] !== undefined &&
      Number.isFinite(namedParams[paramSpec.key])
    ) {
      resolved = namedParams[paramSpec.key]!;
    }
    views.f64[conBase + i] = resolved;
  }

  return {
    elementId: model.elementId,
    modelType: schema.name,
    archetypeId,
    init(): number {
      return exports.mdModelInit(archetypeId, slotPtr, conCount);
    },
    eval(io: MagicDrawModelIO, tSec = 0.0, dtSec = 0.01): MagicDrawEvalOutput {
      writeIo(views, slotPtr, io);
      exports.mdModelEval(archetypeId, tSec, dtSec, slotPtr, conCount);
      return readOutput(views, slotPtr);
    },
  };
}
