// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  STL_STD_LIB_DIAGRAMS,
  STL_STD_LIB_PKG_JSON,
  STL_STD_LIB_SYMBOLS,
  getStlStdLibWasmBytes,
} from "./stl-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/stl-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInStlLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("stl").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(STL_STD_LIB_PKG_JSON, {
    symbols: STL_STD_LIB_SYMBOLS,
    diagrams: STL_STD_LIB_DIAGRAMS,
    wasmBytes: getStlStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/stl-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInStlLibraryRegistered(): void {
  registerBuiltInStlLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `stl` library packages registered in `globalLibraryRegistry`.
 */
export function getStlSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInStlLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("stl")) {
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
        category: (meta["category"] as string) ?? "Polyhedra",
        domain: (meta["domain"] as string) ?? "cad",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "3D Systems STL Specification (1987)",
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
 * Case-insensitive lookup of an STL primitive schema by canonical name or alias.
 */
export function lookupStlModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType
    .trim()
    .replace(/^STL\./i, "")
    .toLowerCase();
  const schemas = getStlSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
