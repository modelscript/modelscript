// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  IRIG106_STD_LIB_DIAGRAMS,
  IRIG106_STD_LIB_PKG_JSON,
  IRIG106_STD_LIB_SYMBOLS,
  getIrig106StdLibWasmBytes,
} from "./irig106-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/irig106-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInIrig106LibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("irig106").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(IRIG106_STD_LIB_PKG_JSON, {
    symbols: IRIG106_STD_LIB_SYMBOLS,
    diagrams: IRIG106_STD_LIB_DIAGRAMS,
    wasmBytes: getIrig106StdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/irig106-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInIrig106LibraryRegistered(): void {
  registerBuiltInIrig106LibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `irig106` library packages registered in `globalLibraryRegistry`.
 */
export function getIrig106SchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInIrig106LibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("irig106")) {
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
        category: (meta["category"] as string) ?? "TMATS Groups",
        domain: (meta["domain"] as string) ?? "aerospace",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "RCC IRIG 106 Chapter 9",
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
 * Case-insensitive lookup of an IRIG 106 TMATS group or standard sync word schema.
 */
export function lookupIrig106Schema(nameOrAlias: string): CleanroomModelSchema | undefined {
  const key = nameOrAlias.trim().toLowerCase();
  const schemas = getIrig106SchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
