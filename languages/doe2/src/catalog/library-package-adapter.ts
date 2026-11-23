// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/doe2 — Cleanroom Standard Library Registry Adapter & WASM Evaluator.
 */

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  DOE2_STD_LIB_DIAGRAMS,
  DOE2_STD_LIB_PKG_JSON,
  DOE2_STD_LIB_SYMBOLS,
  getDoe2StdLibWasmBytes,
} from "./doe2-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/doe2-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInDoe2LibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("doe2").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(DOE2_STD_LIB_PKG_JSON, {
    symbols: DOE2_STD_LIB_SYMBOLS,
    diagrams: DOE2_STD_LIB_DIAGRAMS,
    wasmBytes: getDoe2StdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/doe2-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInDoe2LibraryRegistered(): void {
  registerBuiltInDoe2LibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `doe2` library packages registered in `globalLibraryRegistry`.
 */
export function getDoe2SchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInDoe2LibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("doe2")) {
    const diagByPath = new Map<string, DiagramComponentSpec>();
    for (const d of pkg.diagrams) {
      diagByPath.set(d.namePath, d);
    }
    for (const sym of pkg.symbols) {
      const meta = (sym.metadata ?? {}) as Record<string, unknown>;
      const diag = diagByPath.get(sym.namePath);
      out.push({
        namePath: sym.namePath,
        name: sym.name,
        aliases: Array.isArray(meta["aliases"]) ? (meta["aliases"] as string[]) : [],
        label: (meta["label"] as string) ?? diag?.label ?? sym.name,
        category: (meta["category"] as string) ?? "Envelope Material",
        domain: (meta["domain"] as string) ?? "building-energy",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "ASHRAE Fundamentals / LBNL DOE-2",
        symbolKind: sym.kind,
        width: diag?.width ?? 96,
        height: diag?.height ?? 52,
        svg: diag?.svg,
        ports: diag?.ports ?? [],
        parameters: Array.isArray(meta["parameters"]) ? (meta["parameters"] as CleanroomParameterSchema[]) : [],
        wasmKernel: typeof meta["wasmKernel"] === "string" ? meta["wasmKernel"] : undefined,
        extra: meta["archetypeId"] !== undefined ? { archetypeId: meta["archetypeId"] } : undefined,
      });
    }
  }
  return out;
}

/**
 * Case-insensitive lookup of a DOE-2 standard library schema by canonical name, path, or alias.
 */
export function lookupDoe2ModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType
    .trim()
    .replace(/^DOE2\./i, "")
    .toLowerCase();
  const schemas = getDoe2SchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}

export interface Doe2WasmEvalInputs {
  areaM2?: number | undefined;
  deltaTK?: number | undefined;
  solarWPerM2?: number | undefined;
  thermalLoadW?: number | undefined;
  capacityW?: number | undefined;
}

export interface Doe2WasmEvalOutputs {
  rValueSi: number;
  uValueSi: number;
  capacitancePerAreaSi: number;
  qConductiveW: number;
  qSolarW: number;
  electricPowerW: number;
  fuelPowerW: number;
  fanPowerW: number;
  partLoadRatio: number;
}

interface Doe2WasmExports {
  memory: WebAssembly.Memory;
  doe2GetArenaBase(): number;
  doe2ModelEval(archetypeId: number, slotPtr: number, conCount: number): void;
}

let cachedWasmExports: Doe2WasmExports | undefined;

function getDoe2WasmExports(): Doe2WasmExports {
  if (!cachedWasmExports) {
    const bytes = getDoe2StdLibWasmBytes();
    const mod = new WebAssembly.Module(bytes as BufferSource);
    const inst = new WebAssembly.Instance(mod, {});
    cachedWasmExports = inst.exports as unknown as Doe2WasmExports;
  }
  return cachedWasmExports;
}

/**
 * Evaluates a `@modelscript/doe2-std-lib` material, glazing, or HVAC archetype inside `runtime.wasm`.
 */
export function evaluateDoe2StdWasmModel(
  modelType: string,
  inputs: Doe2WasmEvalInputs = {},
  paramOverrides?: Record<string, number>,
): Doe2WasmEvalOutputs | undefined {
  const schema = lookupDoe2ModelSchema(modelType);
  if (!schema) return undefined;
  const archetypeId = typeof schema.extra?.["archetypeId"] === "number" ? schema.extra["archetypeId"] : 0;
  if (archetypeId <= 0) return undefined;

  const wasm = getDoe2WasmExports();
  const slotPtr = wasm.doe2GetArenaBase();
  const view = new Float64Array(wasm.memory.buffer);
  const conBase = slotPtr >> 3;
  const ioBase = (slotPtr + 0x100) >> 3;

  // Zero IO bus
  for (let i = 0; i < 16; i++) view[ioBase + i] = 0.0;

  // Populate parameters
  const params = schema.parameters ?? [];
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    const override = paramOverrides?.[p.key];
    view[conBase + i] = override !== undefined ? override : Number(p.defaultValue ?? 0.0);
  }

  // Populate inputs
  view[ioBase + 0] = inputs.areaM2 ?? 1.0;
  view[ioBase + 1] = inputs.deltaTK ?? 0.0;
  view[ioBase + 2] = inputs.solarWPerM2 ?? 0.0;
  view[ioBase + 3] = inputs.thermalLoadW ?? 0.0;
  view[ioBase + 4] = inputs.capacityW ?? 0.0;

  wasm.doe2ModelEval(archetypeId, slotPtr, params.length);

  return {
    rValueSi: view[ioBase + 5] ?? 0.0,
    uValueSi: view[ioBase + 6] ?? 0.0,
    capacitancePerAreaSi: view[ioBase + 7] ?? 0.0,
    qConductiveW: view[ioBase + 8] ?? 0.0,
    qSolarW: view[ioBase + 9] ?? 0.0,
    electricPowerW: view[ioBase + 10] ?? 0.0,
    fuelPowerW: view[ioBase + 11] ?? 0.0,
    fanPowerW: view[ioBase + 12] ?? 0.0,
    partLoadRatio: view[ioBase + 13] ?? 0.0,
  };
}
