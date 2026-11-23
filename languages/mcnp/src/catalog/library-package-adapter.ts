// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  MCNP_STD_LIB_DIAGRAMS,
  MCNP_STD_LIB_PKG_JSON,
  MCNP_STD_LIB_SYMBOLS,
  getMcnpStdLibWasmBytes,
} from "./mcnp-std-lib-data.js";
import { CLEANROOM_ISOTOPE_LIBRARY, type IsotopeCrossSectionData } from "./mcnp-std-schemas.js";

/**
 * Registers the built-in `@modelscript/mcnp-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInMcnpLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("mcnp").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(MCNP_STD_LIB_PKG_JSON, {
    symbols: MCNP_STD_LIB_SYMBOLS,
    diagrams: MCNP_STD_LIB_DIAGRAMS,
    wasmBytes: getMcnpStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/mcnp-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInMcnpLibraryRegistered(): void {
  registerBuiltInMcnpLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `mcnp` library packages registered in `globalLibraryRegistry`.
 */
export function getMcnpSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInMcnpLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("mcnp")) {
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
        category: (meta["category"] as string) ?? "Isotope",
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
        extra: meta["archetypeId"] !== undefined ? { archetypeId: meta["archetypeId"] } : undefined,
      });
    }
  }
  return out;
}

/**
 * Case-insensitive lookup of an MCNP stdlib schema by canonical name, alias, or namePath.
 */
export function lookupMcnpModelSchema(query: string): CleanroomModelSchema | undefined {
  const key = query.trim().toLowerCase();
  const schemas = getMcnpSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}

/**
 * Looks up cleanroom ENDF-like microscopic neutron cross-section data for a ZAID (e.g. 92235 or "92235.80c").
 */
export function lookupIsotopeCrossSection(zaid: number | string): IsotopeCrossSectionData | undefined {
  ensureBuiltInMcnpLibraryRegistered();
  const num = typeof zaid === "number" ? zaid : parseInt(String(zaid).split(".")[0] ?? "", 10);
  if (!Number.isFinite(num)) return undefined;
  return CLEANROOM_ISOTOPE_LIBRARY.get(num);
}
