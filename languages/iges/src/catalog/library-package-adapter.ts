// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  IGES_STD_LIB_DIAGRAMS,
  IGES_STD_LIB_PKG_JSON,
  IGES_STD_LIB_SYMBOLS,
  getIgesStdLibWasmBytes,
} from "./iges-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/iges-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInIgesLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("iges").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(IGES_STD_LIB_PKG_JSON, {
    symbols: IGES_STD_LIB_SYMBOLS,
    diagrams: IGES_STD_LIB_DIAGRAMS,
    wasmBytes: getIgesStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/iges-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInIgesLibraryRegistered(): void {
  registerBuiltInIgesLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `iges` library packages registered in `globalLibraryRegistry`.
 */
export function getIgesSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInIgesLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("iges")) {
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
        category: (meta["category"] as string) ?? "Curves & Points",
        domain: (meta["domain"] as string) ?? "cad",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "IGES 5.3 (ANSI Y14.26M)",
        symbolKind: sym.kind,
        width: diag?.width ?? 92,
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
 * Case-insensitive lookup of an IGES entity or unit preset schema by type number, canonical name, or alias.
 */
export function lookupIgesEntitySchema(entityOrAlias: string | number): CleanroomModelSchema | undefined {
  const key = String(entityOrAlias).trim().toLowerCase();
  const schemas = getIgesSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
