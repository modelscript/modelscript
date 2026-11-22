// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  OLGA_STD_LIB_DIAGRAMS,
  OLGA_STD_LIB_PKG_JSON,
  OLGA_STD_LIB_SYMBOLS,
  getOlgaStdLibWasmBytes,
} from "./olga-std-lib-data.js";

export function registerBuiltInOlgaLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("olga").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(OLGA_STD_LIB_PKG_JSON, {
    symbols: OLGA_STD_LIB_SYMBOLS,
    diagrams: OLGA_STD_LIB_DIAGRAMS,
    wasmBytes: getOlgaStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/olga-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInOlgaLibraryRegistered(): void {
  registerBuiltInOlgaLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `olga` library packages registered in `globalLibraryRegistry`.
 */
export function getOlgaSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInOlgaLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("olga")) {
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
        category: (meta["category"] as string) ?? "Multiphase Flow",
        domain: (meta["domain"] as string) ?? "fluid",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Public Multiphase Flow Standard",
        symbolKind: sym.kind,
        width: diag?.width ?? 80,
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
 * Case-insensitive lookup of an OLGA equipment or correlation schema by canonical name or alias.
 */
export function lookupOlgaModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getOlgaSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
