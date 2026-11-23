// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  HDF4_STD_LIB_DIAGRAMS,
  HDF4_STD_LIB_PKG_JSON,
  HDF4_STD_LIB_SYMBOLS,
  getHdf4StdLibWasmBytes,
} from "./hdf4-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/hdf4-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInHdf4LibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("hdf4").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(HDF4_STD_LIB_PKG_JSON, {
    symbols: HDF4_STD_LIB_SYMBOLS,
    diagrams: HDF4_STD_LIB_DIAGRAMS,
    wasmBytes: getHdf4StdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/hdf4-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInHdf4LibraryRegistered(): void {
  registerBuiltInHdf4LibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `hdf4` library packages registered in `globalLibraryRegistry`.
 */
export function getHdf4SchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInHdf4LibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("hdf4")) {
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
        category: (meta["category"] as string) ?? "HDF4 Core Objects",
        domain: (meta["domain"] as string) ?? "scientific-data",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "NCSA HDF4 Specification v4.2",
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
 * Case-insensitive lookup of an HDF4 or NASA EOS-HDF schema by canonical name or alias.
 */
export function lookupHdf4ModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType
    .trim()
    .replace(/^HDF4\./i, "")
    .toLowerCase();
  const schemas = getHdf4SchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
