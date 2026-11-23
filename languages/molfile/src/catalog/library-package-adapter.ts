// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  MOLFILE_STD_LIB_DIAGRAMS,
  MOLFILE_STD_LIB_PKG_JSON,
  MOLFILE_STD_LIB_SYMBOLS,
  getMolfileStdLibWasmBytes,
} from "./molfile-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/molfile-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInMolfileLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("molfile").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(MOLFILE_STD_LIB_PKG_JSON, {
    symbols: MOLFILE_STD_LIB_SYMBOLS,
    diagrams: MOLFILE_STD_LIB_DIAGRAMS,
    wasmBytes: getMolfileStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/molfile-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInMolfileLibraryRegistered(): void {
  registerBuiltInMolfileLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `molfile` library packages registered in `globalLibraryRegistry`.
 */
export function getMolfileSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInMolfileLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("molfile")) {
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
        category: (meta["category"] as string) ?? "Elements",
        domain: (meta["domain"] as string) ?? "chemistry",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "IUPAC 2021 / MDL CTfile",
        symbolKind: sym.kind,
        width: diag?.width ?? 88,
        height: diag?.height ?? 52,
        svg: diag?.svg,
        ports: diag?.ports ?? [],
        parameters: Array.isArray(meta["parameters"]) ? (meta["parameters"] as CleanroomParameterSchema[]) : [],
        wasmKernel: typeof meta["wasmKernel"] === "string" ? meta["wasmKernel"] : undefined,
        extra: meta["formula"] !== undefined ? { formula: meta["formula"] } : undefined,
      });
    }
  }
  return out;
}

/**
 * Case-insensitive lookup of a Molfile element or canonical molecule schema by name, path, or alias.
 */
export function lookupMolfileModelSchema(query: string): CleanroomModelSchema | undefined {
  const key = query.trim().toLowerCase();
  const schemas = getMolfileSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
