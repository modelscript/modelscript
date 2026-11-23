// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  ENDF6_STD_LIB_DIAGRAMS,
  ENDF6_STD_LIB_PKG_JSON,
  ENDF6_STD_LIB_SYMBOLS,
  getEndf6StdLibWasmBytes,
} from "./endf6-std-lib-data.js";
import {
  CLEANROOM_ENDF6_NUCLIDES,
  ENDF6_MT_DESCRIPTORS,
  type Endf6MtDescriptor,
  type Endf6ReferenceNuclide,
} from "./endf6-std-schemas.js";

/**
 * Registers the built-in `@modelscript/endf6-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInEndf6LibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("endf6").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(ENDF6_STD_LIB_PKG_JSON, {
    symbols: ENDF6_STD_LIB_SYMBOLS,
    diagrams: ENDF6_STD_LIB_DIAGRAMS,
    wasmBytes: getEndf6StdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/endf6-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInEndf6LibraryRegistered(): void {
  registerBuiltInEndf6LibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `endf6` library packages registered in `globalLibraryRegistry`.
 */
export function getEndf6SchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInEndf6LibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("endf6")) {
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
        category: (meta["category"] as string) ?? "Nuclide",
        domain: (meta["domain"] as string) ?? "nuclear",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Cleanroom ENDF/B-VIII.0",
        symbolKind: sym.kind,
        width: diag?.width ?? 88,
        height: diag?.height ?? 52,
        svg: diag?.svg,
        ports: diag?.ports ?? [],
        parameters: Array.isArray(meta["parameters"]) ? (meta["parameters"] as CleanroomParameterSchema[]) : [],
        wasmKernel: typeof meta["wasmKernel"] === "string" ? meta["wasmKernel"] : undefined,
      });
    }
  }
  return out;
}

/**
 * Case-insensitive lookup of an ENDF-6 stdlib schema by name, alias, or namePath.
 */
export function lookupEndf6ModelSchema(query: string): CleanroomModelSchema | undefined {
  const key = query.trim().toLowerCase();
  const schemas = getEndf6SchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}

/** Looks up a cleanroom reference nuclide by symbol (e.g. `"U-235"`), MAT, or ZA. */
export function lookupReferenceNuclide(query: string | number): Endf6ReferenceNuclide | undefined {
  if (typeof query === "number") {
    for (const nuc of CLEANROOM_ENDF6_NUCLIDES.values()) {
      if (nuc.mat === query || nuc.za === query) return nuc;
    }
    return undefined;
  }
  const key = query.trim().toLowerCase();
  for (const nuc of CLEANROOM_ENDF6_NUCLIDES.values()) {
    if (
      nuc.symbol.toLowerCase() === key ||
      nuc.name.toLowerCase() === key ||
      `mat${nuc.mat}` === key ||
      `za${nuc.za}` === key
    ) {
      return nuc;
    }
  }
  return undefined;
}

/** Looks up an ENDF-6 MT reaction descriptor. */
export function lookupMtDescriptor(mt: number): Endf6MtDescriptor | undefined {
  return ENDF6_MT_DESCRIPTORS.get(mt);
}
