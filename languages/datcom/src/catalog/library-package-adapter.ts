// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  DATCOM_STD_LIB_DIAGRAMS,
  DATCOM_STD_LIB_PKG_JSON,
  DATCOM_STD_LIB_SYMBOLS,
  getDatcomStdLibWasmBytes,
} from "./datcom-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/datcom-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInDatcomLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("datcom").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(DATCOM_STD_LIB_PKG_JSON, {
    symbols: DATCOM_STD_LIB_SYMBOLS,
    diagrams: DATCOM_STD_LIB_DIAGRAMS,
    wasmBytes: getDatcomStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/datcom-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInDatcomLibraryRegistered(): void {
  registerBuiltInDatcomLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `datcom` library packages registered in `globalLibraryRegistry`.
 */
export function getDatcomSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInDatcomLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("datcom")) {
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
        category: (meta["category"] as string) ?? "NACA Airfoils",
        domain: (meta["domain"] as string) ?? "aerospace",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "USAF Digital DATCOM",
        symbolKind: sym.kind,
        width: diag?.width ?? 96,
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
 * Case-insensitive lookup of a DATCOM airfoil or aircraft configuration schema by name or alias.
 */
export function lookupDatcomModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getDatcomSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
