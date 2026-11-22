// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  SIMA_STD_LIB_DIAGRAMS,
  SIMA_STD_LIB_PKG_JSON,
  SIMA_STD_LIB_SYMBOLS,
  getSimaStdLibWasmBytes,
} from "./sima-std-lib-data.js";

export function registerBuiltInSimaLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("sima").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(SIMA_STD_LIB_PKG_JSON, {
    symbols: SIMA_STD_LIB_SYMBOLS,
    diagrams: SIMA_STD_LIB_DIAGRAMS,
    wasmBytes: getSimaStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/sima-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInSimaLibraryRegistered(): void {
  registerBuiltInSimaLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `sima` library packages registered in `globalLibraryRegistry`.
 */
export function getSimaSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInSimaLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("sima")) {
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
        category: (meta["category"] as string) ?? "Hydrodynamics & Bodies",
        domain: (meta["domain"] as string) ?? "marine",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "DNV-RP-C205 / Faltinsen",
        symbolKind: sym.kind,
        width: diag?.width ?? 96,
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
 * Case-insensitive lookup of a SIMA (SIMO/RIFLEX) model schema by canonical name or alias.
 */
export function lookupSimaModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getSimaSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
