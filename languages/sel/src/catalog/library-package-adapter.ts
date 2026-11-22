// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  SEL_STD_LIB_DIAGRAMS,
  SEL_STD_LIB_PKG_JSON,
  SEL_STD_LIB_SYMBOLS,
  getSelStdLibWasmBytes,
} from "./sel-std-lib-data.js";

export function registerBuiltInSelLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("sel").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(SEL_STD_LIB_PKG_JSON, {
    symbols: SEL_STD_LIB_SYMBOLS,
    diagrams: SEL_STD_LIB_DIAGRAMS,
    wasmBytes: getSelStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/sel-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInSelLibraryRegistered(): void {
  registerBuiltInSelLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `sel` library packages registered in `globalLibraryRegistry`.
 */
export function getSelSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInSelLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("sel")) {
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
        category: (meta["category"] as string) ?? "Protection Element",
        domain: (meta["domain"] as string) ?? "electrical",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "IEEE C37.2 / IEEE C37.112 / IEC 60255",
        symbolKind: sym.kind,
        width: diag?.width ?? 84,
        height: diag?.height ?? 48,
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
 * Case-insensitive lookup of an SEL relay element, TCC curve, or SELogic schema by canonical name or alias.
 */
export function lookupSelElementSchema(elementType: string): CleanroomModelSchema | undefined {
  const key = elementType.trim().toLowerCase();
  const schemas = getSelSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
