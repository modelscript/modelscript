// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  NEC2_STD_LIB_DIAGRAMS,
  NEC2_STD_LIB_PKG_JSON,
  NEC2_STD_LIB_SYMBOLS,
  getNec2StdLibWasmBytes,
} from "./nec2-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/nec2-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInNec2LibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("nec2").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(NEC2_STD_LIB_PKG_JSON, {
    symbols: NEC2_STD_LIB_SYMBOLS,
    diagrams: NEC2_STD_LIB_DIAGRAMS,
    wasmBytes: getNec2StdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/nec2-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInNec2LibraryRegistered(): void {
  registerBuiltInNec2LibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `nec2` library packages registered in `globalLibraryRegistry`.
 */
export function getNec2SchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInNec2LibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("nec2")) {
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
        category: (meta["category"] as string) ?? "Dipoles",
        domain: (meta["domain"] as string) ?? "electromagnetics",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "LLNL NEC-2",
        symbolKind: sym.kind,
        width: diag?.width ?? 96,
        height: diag?.height ?? 56,
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
 * Case-insensitive lookup of a NEC-2 antenna archetype schema by canonical name, namePath, or alias.
 */
export function lookupNec2ModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getNec2SchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
