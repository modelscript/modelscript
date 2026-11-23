// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  TRNSYS_STD_LIB_DIAGRAMS,
  TRNSYS_STD_LIB_PKG_JSON,
  TRNSYS_STD_LIB_SYMBOLS,
  getTrnsysStdLibWasmBytes,
} from "./trnsys-std-lib-data.js";
import { TRNSYS_MODEL_SPECS, type TrnsysModelSpec } from "./trnsys-std-schemas.js";

/**
 * Registers the built-in `@modelscript/trnsys-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInTrnsysLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("trnsys").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(TRNSYS_STD_LIB_PKG_JSON, {
    symbols: TRNSYS_STD_LIB_SYMBOLS,
    diagrams: TRNSYS_STD_LIB_DIAGRAMS,
    wasmBytes: getTrnsysStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/trnsys-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInTrnsysLibraryRegistered(): void {
  registerBuiltInTrnsysLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `trnsys` library packages registered in `globalLibraryRegistry`.
 */
export function getTrnsysSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInTrnsysLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("trnsys")) {
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
        category: (meta["category"] as string) ?? "Solar Thermal",
        domain: (meta["domain"] as string) ?? "thermal",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "TRNSYS Mathematical Reference",
        symbolKind: sym.kind,
        width: diag?.width ?? 88,
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
 * Case-insensitive lookup of a TRNSYS Type schema by canonical name, alias, or numeric Type number.
 */
export function lookupTrnsysModelSchema(modelTypeOrNum: string | number): CleanroomModelSchema | undefined {
  const key =
    typeof modelTypeOrNum === "number"
      ? `type${modelTypeOrNum}`
      : modelTypeOrNum.trim().replace(/\s+/g, "").toLowerCase();
  const schemas = getTrnsysSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.replace(/\s+/g, "").toLowerCase() === key)) return s;
  }
  return undefined;
}

const SPEC_BY_TYPE_NUM = new Map<number, TrnsysModelSpec>(TRNSYS_MODEL_SPECS.map((s) => [s.typeNumber, s]));

/**
 * Looks up metadata (inputs, outputs, parameters, state-breaking flag) for a TRNSYS TYPE number.
 */
export function getTrnsysTypeSpec(typeNumber: number): TrnsysModelSpec | undefined {
  return SPEC_BY_TYPE_NUM.get(typeNumber);
}
