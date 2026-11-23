// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  IHEX_STD_LIB_DIAGRAMS,
  IHEX_STD_LIB_PKG_JSON,
  IHEX_STD_LIB_SYMBOLS,
  getIhexStdLibWasmBytes,
} from "./ihex-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/ihex-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInIhexLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("ihex").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(IHEX_STD_LIB_PKG_JSON, {
    symbols: IHEX_STD_LIB_SYMBOLS,
    diagrams: IHEX_STD_LIB_DIAGRAMS,
    wasmBytes: getIhexStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/ihex-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInIhexLibraryRegistered(): void {
  registerBuiltInIhexLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `ihex` library packages registered in `globalLibraryRegistry`.
 */
export function getIhexSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInIhexLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("ihex")) {
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
        category: (meta["category"] as string) ?? "Record Types",
        domain: (meta["domain"] as string) ?? "firmware",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Intel Hexadecimal Object File Format Specification",
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
 * Case-insensitive lookup of an Intel HEX record type or MCU flash layout schema.
 */
export function lookupIhexModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getIhexSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
