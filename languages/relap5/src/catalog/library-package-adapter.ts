// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  RELAP5_STD_LIB_DIAGRAMS,
  RELAP5_STD_LIB_PKG_JSON,
  RELAP5_STD_LIB_SYMBOLS,
  getRelap5StdLibWasmBytes,
} from "./relap5-std-lib-data.js";

export function registerBuiltInRelap5LibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("relap5").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(RELAP5_STD_LIB_PKG_JSON, {
    symbols: RELAP5_STD_LIB_SYMBOLS,
    diagrams: RELAP5_STD_LIB_DIAGRAMS,
    wasmBytes: getRelap5StdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/relap5-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInRelap5LibraryRegistered(): void {
  registerBuiltInRelap5LibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `relap5` library packages registered in `globalLibraryRegistry`.
 */
export function getRelap5SchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInRelap5LibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("relap5")) {
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
        category: (meta["category"] as string) ?? "Hydrodynamic Volume",
        domain: (meta["domain"] as string) ?? "thermal-hydraulics",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "US NRC NUREG/CR-5535",
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
 * Case-insensitive lookup of a RELAP5 component or correlation schema by canonical name or alias.
 */
export function lookupRelap5ModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getRelap5SchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
