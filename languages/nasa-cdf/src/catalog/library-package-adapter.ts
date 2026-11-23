// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  getNasaCdfStdLibWasmBytes,
  NASA_CDF_STD_LIB_DIAGRAMS,
  NASA_CDF_STD_LIB_PKG_JSON,
  NASA_CDF_STD_LIB_SYMBOLS,
} from "./nasa-cdf-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/nasa-cdf-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInNasaCdfLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("nasa-cdf").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(NASA_CDF_STD_LIB_PKG_JSON, {
    symbols: NASA_CDF_STD_LIB_SYMBOLS,
    diagrams: NASA_CDF_STD_LIB_DIAGRAMS,
    wasmBytes: getNasaCdfStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/nasa-cdf-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInNasaCdfLibraryRegistered(): void {
  registerBuiltInNasaCdfLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `nasa-cdf` library packages registered in `globalLibraryRegistry`.
 */
export function getNasaCdfSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInNasaCdfLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("nasa-cdf")) {
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
        category: (meta["category"] as string) ?? "ISTP Variable",
        domain: (meta["domain"] as string) ?? "space-physics",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "NASA SPDF ISTP/IACG Metadata Guidelines",
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
 * Case-insensitive lookup of a NASA CDF / ISTP schema by canonical name or alias.
 */
export function lookupNasaCdfSchema(name: string): CleanroomModelSchema | undefined {
  const key = name.trim().toLowerCase();
  const schemas = getNasaCdfSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
