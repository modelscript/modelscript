// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  GRIB_STD_LIB_DIAGRAMS,
  GRIB_STD_LIB_PKG_JSON,
  GRIB_STD_LIB_SYMBOLS,
  getGribStdLibWasmBytes,
} from "./grib-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/grib-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInGribLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("grib").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(GRIB_STD_LIB_PKG_JSON, {
    symbols: GRIB_STD_LIB_SYMBOLS,
    diagrams: GRIB_STD_LIB_DIAGRAMS,
    wasmBytes: getGribStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/grib-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInGribLibraryRegistered(): void {
  registerBuiltInGribLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `grib` library packages registered in `globalLibraryRegistry`.
 */
export function getGribSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInGribLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("grib")) {
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
        category: (meta["category"] as string) ?? "WMO Parameter",
        domain: (meta["domain"] as string) ?? "meteorology",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "WMO FM 92-VIII Ext. GRIB",
        symbolKind: sym.kind,
        width: diag?.width ?? 88,
        height: diag?.height ?? 52,
        svg: diag?.svg,
        ports: diag?.ports ?? [],
        parameters: Array.isArray(meta["parameters"]) ? (meta["parameters"] as CleanroomParameterSchema[]) : [],
        wasmKernel: typeof meta["wasmKernel"] === "string" ? meta["wasmKernel"] : undefined,
        extra:
          meta["archetypeId"] !== undefined
            ? { archetypeId: meta["archetypeId"], wmoCode: meta["wmoCode"], unit: meta["unit"] }
            : undefined,
      });
    }
  }
  return out;
}

/**
 * Case-insensitive lookup of a GRIB WMO parameter or level schema by canonical name or alias.
 */
export function lookupGribSchema(keyword: string): CleanroomModelSchema | undefined {
  const key = keyword.trim().toLowerCase();
  const schemas = getGribSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
