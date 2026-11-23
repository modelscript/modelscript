// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  IEEE_CDF_STD_LIB_DIAGRAMS,
  IEEE_CDF_STD_LIB_PKG_JSON,
  IEEE_CDF_STD_LIB_SYMBOLS,
  getIeeeCdfStdLibWasmBytes,
} from "./ieee-cdf-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/ieee-cdf-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInIeeeCdfLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("ieee-cdf").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(IEEE_CDF_STD_LIB_PKG_JSON, {
    symbols: IEEE_CDF_STD_LIB_SYMBOLS,
    diagrams: IEEE_CDF_STD_LIB_DIAGRAMS,
    wasmBytes: getIeeeCdfStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/ieee-cdf-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInIeeeCdfLibraryRegistered(): void {
  registerBuiltInIeeeCdfLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `ieee-cdf` library packages registered in `globalLibraryRegistry`.
 */
export function getIeeeCdfSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInIeeeCdfLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("ieee-cdf")) {
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
        category: (meta["category"] as string) ?? "Buses",
        domain: (meta["domain"] as string) ?? "electrical-power",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "IEEE Working Group 1973 Common Format",
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
 * Case-insensitive lookup of an IEEE CDF / BPA IPF archetype schema by canonical name or alias.
 */
export function lookupIeeeCdfModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getIeeeCdfSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.trim().toLowerCase() === key)) return s;
  }
  return undefined;
}
