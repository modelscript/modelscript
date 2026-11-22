// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  GENSYS_STD_LIB_DIAGRAMS,
  GENSYS_STD_LIB_PKG_JSON,
  GENSYS_STD_LIB_SYMBOLS,
  getGensysStdLibWasmBytes,
} from "./gensys-std-lib-data.js";

export function registerBuiltInGensysLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("gensys").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(GENSYS_STD_LIB_PKG_JSON, {
    symbols: GENSYS_STD_LIB_SYMBOLS,
    diagrams: GENSYS_STD_LIB_DIAGRAMS,
    wasmBytes: getGensysStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/gensys-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInGensysLibraryRegistered(): void {
  registerBuiltInGensysLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `gensys` library packages registered in `globalLibraryRegistry`.
 */
export function getGensysSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInGensysLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("gensys")) {
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
        category: (meta["category"] as string) ?? "Elastic & Damping Couplings",
        domain: (meta["domain"] as string) ?? "mechanical",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "DEsolver GENSYS / EN 14363",
        symbolKind: sym.kind,
        width: diag?.width ?? 88,
        height: diag?.height ?? 48,
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
 * Case-insensitive lookup of a GENSYS element schema by canonical name or alias.
 */
export function lookupGensysModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getGensysSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
