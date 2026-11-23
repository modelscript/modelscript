// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  FITS_STD_LIB_DIAGRAMS,
  FITS_STD_LIB_PKG_JSON,
  FITS_STD_LIB_SYMBOLS,
  getFitsStdLibWasmBytes,
} from "./fits-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/fits-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInFitsLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("fits").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(FITS_STD_LIB_PKG_JSON, {
    symbols: FITS_STD_LIB_SYMBOLS,
    diagrams: FITS_STD_LIB_DIAGRAMS,
    wasmBytes: getFitsStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/fits-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInFitsLibraryRegistered(): void {
  registerBuiltInFitsLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `fits` library packages registered in `globalLibraryRegistry`.
 */
export function getFitsSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInFitsLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("fits")) {
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
        category: (meta["category"] as string) ?? "Mandatory Header",
        domain: (meta["domain"] as string) ?? "astronomy",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "IAU FITS 4.0 Standard",
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
 * Case-insensitive lookup of a FITS 4.0 / WCS schema by canonical name or alias.
 */
export function lookupFitsKeywordSchema(keyword: string): CleanroomModelSchema | undefined {
  const key = keyword.trim().toLowerCase();
  const schemas = getFitsSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
