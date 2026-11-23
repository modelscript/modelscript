// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  TRASYS_STD_LIB_DIAGRAMS,
  TRASYS_STD_LIB_PKG_JSON,
  TRASYS_STD_LIB_SYMBOLS,
  getTrasysStdLibWasmBytes,
} from "./trasys-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/trasys-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInTrasysLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("trasys").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(TRASYS_STD_LIB_PKG_JSON, {
    symbols: TRASYS_STD_LIB_SYMBOLS,
    diagrams: TRASYS_STD_LIB_DIAGRAMS,
    wasmBytes: getTrasysStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/trasys-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInTrasysLibraryRegistered(): void {
  registerBuiltInTrasysLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `trasys` library packages registered in `globalLibraryRegistry`.
 */
export function getTrasysSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInTrasysLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("trasys")) {
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
        category: (meta["category"] as string) ?? "Surface Primitives",
        domain: (meta["domain"] as string) ?? "aerospace",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "NASA TRASYS II / Gilmore Handbook",
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
 * Case-insensitive lookup of a TRASYS surface primitive or thermal coating schema by canonical name or alias.
 */
export function lookupTrasysModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getTrasysSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
