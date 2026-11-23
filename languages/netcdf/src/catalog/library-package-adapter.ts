// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  NETCDF_STD_LIB_DIAGRAMS,
  NETCDF_STD_LIB_PKG_JSON,
  NETCDF_STD_LIB_SYMBOLS,
  getNetcdfStdLibWasmBytes,
} from "./netcdf-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/netcdf-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInNetcdfLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("netcdf").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(NETCDF_STD_LIB_PKG_JSON, {
    symbols: NETCDF_STD_LIB_SYMBOLS,
    diagrams: NETCDF_STD_LIB_DIAGRAMS,
    wasmBytes: getNetcdfStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/netcdf-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInNetcdfLibraryRegistered(): void {
  registerBuiltInNetcdfLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `netcdf` library packages registered in `globalLibraryRegistry`.
 */
export function getNetcdfSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInNetcdfLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("netcdf")) {
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
        category: (meta["category"] as string) ?? "CF-1.x Atmosphere",
        domain: (meta["domain"] as string) ?? "earth-science",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "CF Conventions 1.8 / Unidata NetCDF Classic",
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
 * Case-insensitive lookup of a NetCDF / CF-1.x standard schema by canonical name or alias.
 */
export function lookupNetcdfModelSchema(nameOrAlias: string): CleanroomModelSchema | undefined {
  const key = nameOrAlias
    .trim()
    .replace(/^NetCDF\./i, "")
    .toLowerCase();
  const schemas = getNetcdfSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
