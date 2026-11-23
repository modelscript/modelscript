// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  IUCR_CIF_STD_LIB_DIAGRAMS,
  IUCR_CIF_STD_LIB_PKG_JSON,
  IUCR_CIF_STD_LIB_SYMBOLS,
  getIucrCifStdLibWasmBytes,
} from "./iucr-cif-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/iucr-cif-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInIucrCifLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("iucr-cif").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(IUCR_CIF_STD_LIB_PKG_JSON, {
    symbols: IUCR_CIF_STD_LIB_SYMBOLS,
    diagrams: IUCR_CIF_STD_LIB_DIAGRAMS,
    wasmBytes: getIucrCifStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/iucr-cif-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInIucrCifLibraryRegistered(): void {
  registerBuiltInIucrCifLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `iucr-cif` library packages registered in `globalLibraryRegistry`.
 */
export function getIucrCifSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInIucrCifLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("iucr-cif")) {
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
        category: (meta["category"] as string) ?? "CIF Core Dictionary",
        domain: (meta["domain"] as string) ?? "materials",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "IUCr CIF Core Dictionary 2.4.5",
        symbolKind: sym.kind,
        width: diag?.width ?? 92,
        height: diag?.height ?? 54,
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
 * Case-insensitive lookup of an IUCr CIF schema by canonical name or alias.
 */
export function lookupIucrCifSchema(key: string): CleanroomModelSchema | undefined {
  const norm = key.trim().toLowerCase();
  const schemas = getIucrCifSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === norm || s.namePath.toLowerCase() === norm) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === norm)) return s;
  }
  return undefined;
}
