// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  MLXTRAN_STD_LIB_DIAGRAMS,
  MLXTRAN_STD_LIB_PKG_JSON,
  MLXTRAN_STD_LIB_SYMBOLS,
  getMlxtranStdLibWasmBytes,
} from "./mlxtran-std-lib-data.js";

export function registerBuiltInMlxtranLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("mlxtran").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(MLXTRAN_STD_LIB_PKG_JSON, {
    symbols: MLXTRAN_STD_LIB_SYMBOLS,
    diagrams: MLXTRAN_STD_LIB_DIAGRAMS,
    wasmBytes: getMlxtranStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/mlxtran-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInMlxtranLibraryRegistered(): void {
  registerBuiltInMlxtranLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `mlxtran` library packages registered in `globalLibraryRegistry`.
 */
export function getMlxtranSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInMlxtranLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("mlxtran")) {
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
        category: (meta["category"] as string) ?? "Structural PK",
        domain: (meta["domain"] as string) ?? "pharmacometrics",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Gibaldi & Perrier / Lavielle",
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
 * Case-insensitive lookup of an Mlxtran pharmacometrics model schema by canonical name or alias.
 */
export function lookupMlxtranModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getMlxtranSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
