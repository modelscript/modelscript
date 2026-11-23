// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  CHEMKIN_STD_LIB_DIAGRAMS,
  CHEMKIN_STD_LIB_PKG_JSON,
  CHEMKIN_STD_LIB_SYMBOLS,
  getChemkinStdLibWasmBytes,
} from "./chemkin-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/chemkin-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInChemkinLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("chemkin").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(CHEMKIN_STD_LIB_PKG_JSON, {
    symbols: CHEMKIN_STD_LIB_SYMBOLS,
    diagrams: CHEMKIN_STD_LIB_DIAGRAMS,
    wasmBytes: getChemkinStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/chemkin-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInChemkinLibraryRegistered(): void {
  registerBuiltInChemkinLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `chemkin` library packages registered in `globalLibraryRegistry`.
 */
export function getChemkinSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInChemkinLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("chemkin")) {
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
        category: (meta["category"] as string) ?? "Product",
        domain: (meta["domain"] as string) ?? "chemistry",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "NASA Glenn / McBride-Gordon-Reno SP-3027",
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
 * Case-insensitive lookup of a CHEMKIN standard species schema by name or alias.
 */
export function lookupChemkinSpeciesSchema(speciesName: string): CleanroomModelSchema | undefined {
  const key = speciesName.trim().toLowerCase();
  const schemas = getChemkinSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
