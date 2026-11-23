// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  MELCOR_STD_LIB_DIAGRAMS,
  MELCOR_STD_LIB_PKG_JSON,
  MELCOR_STD_LIB_SYMBOLS,
  getMelcorStdLibWasmBytes,
} from "./melcor-std-lib-data.js";

export function registerBuiltInMelcorLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("melcor").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(MELCOR_STD_LIB_PKG_JSON, {
    symbols: MELCOR_STD_LIB_SYMBOLS,
    diagrams: MELCOR_STD_LIB_DIAGRAMS,
    wasmBytes: getMelcorStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/melcor-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInMelcorLibraryRegistered(): void {
  registerBuiltInMelcorLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `melcor` library packages registered in `globalLibraryRegistry`.
 */
export function getMelcorSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInMelcorLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("melcor")) {
    const diagByPath = new Map<string, DiagramComponentSpec>();
    for (const d of pkg.diagrams) {
      diagByPath.set(d.namePath, d);
    }
    for (const sym of pkg.symbols) {
      const meta = (sym.metadata ?? {}) as Record<string, unknown>;
      const diag = diagByPath.get(sym.namePath);
      const extra: Record<string, unknown> = {};
      if (meta["archetypeId"] !== undefined) extra["archetypeId"] = meta["archetypeId"];
      if (meta["melcorPackage"] !== undefined) extra["melcorPackage"] = meta["melcorPackage"];
      out.push({
        namePath: sym.namePath,
        name: sym.name,
        aliases: Array.isArray(meta["aliases"]) ? (meta["aliases"] as string[]) : [],
        label: (meta["label"] as string) ?? diag?.label ?? sym.name,
        category: (meta["category"] as string) ?? "CVH Control Volume",
        domain: (meta["domain"] as string) ?? "nuclear-severe-accident",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Sandia MELCOR 2.2 Reference Manual",
        symbolKind: sym.kind,
        width: diag?.width ?? 92,
        height: diag?.height ?? 48,
        svg: diag?.svg,
        ports: diag?.ports ?? [],
        parameters: Array.isArray(meta["parameters"]) ? (meta["parameters"] as CleanroomParameterSchema[]) : [],
        wasmKernel: typeof meta["wasmKernel"] === "string" ? meta["wasmKernel"] : undefined,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      });
    }
  }
  return out;
}

/**
 * Case-insensitive lookup of a MELCOR package or material schema by canonical name, namePath, or alias.
 */
export function lookupMelcorModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getMelcorSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
