// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  EDIF_STD_LIB_DIAGRAMS,
  EDIF_STD_LIB_PKG_JSON,
  EDIF_STD_LIB_SYMBOLS,
  getEdifStdLibWasmBytes,
} from "./edif-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/edif-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInEdifLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("edif").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(EDIF_STD_LIB_PKG_JSON, {
    symbols: EDIF_STD_LIB_SYMBOLS,
    diagrams: EDIF_STD_LIB_DIAGRAMS,
    wasmBytes: getEdifStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/edif-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInEdifLibraryRegistered(): void {
  registerBuiltInEdifLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `edif` library packages registered in `globalLibraryRegistry`.
 */
export function getEdifSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInEdifLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("edif")) {
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
        category: (meta["category"] as string) ?? "Passive",
        domain: (meta["domain"] as string) ?? "electronics",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "EIA-548 / EDIF 2.0.0 GENERIC Standard Library",
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
 * Case-insensitive lookup of an EDIF standard GENERIC cell schema by name, namePath, or alias.
 */
export function lookupEdifModelSchema(cellName: string): CleanroomModelSchema | undefined {
  const key = cellName
    .trim()
    .replace(/^GENERIC[./]/i, "")
    .toLowerCase();
  const schemas = getEdifSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
