// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  CIF_STD_LIB_DIAGRAMS,
  CIF_STD_LIB_PKG_JSON,
  CIF_STD_LIB_SYMBOLS,
  getCifStdLibWasmBytes,
} from "./cif-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/cif-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInCifLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("cif").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(CIF_STD_LIB_PKG_JSON, {
    symbols: CIF_STD_LIB_SYMBOLS,
    diagrams: CIF_STD_LIB_DIAGRAMS,
    wasmBytes: getCifStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/cif-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInCifLibraryRegistered(): void {
  registerBuiltInCifLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `cif` library packages registered in `globalLibraryRegistry`.
 */
export function getCifSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInCifLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("cif")) {
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
        category: (meta["category"] as string) ?? "MOSIS SCMOS",
        domain: (meta["domain"] as string) ?? "ic-layout",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "MOSIS SCMOS / Mead-Conway",
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
 * Case-insensitive lookup of a CIF layer or standard cell schema by name or alias.
 */
export function lookupCifLayerSchema(layerOrCell: string): CleanroomModelSchema | undefined {
  const key = layerOrCell.trim().toLowerCase();
  const schemas = getCifSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
