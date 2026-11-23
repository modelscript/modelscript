// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  SEGY_STD_LIB_DIAGRAMS,
  SEGY_STD_LIB_PKG_JSON,
  SEGY_STD_LIB_SYMBOLS,
  getSegyStdLibWasmBytes,
} from "./segy-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/segy-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInSegyLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("segy").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(SEGY_STD_LIB_PKG_JSON, {
    symbols: SEGY_STD_LIB_SYMBOLS,
    diagrams: SEGY_STD_LIB_DIAGRAMS,
    wasmBytes: getSegyStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/segy-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInSegyLibraryRegistered(): void {
  registerBuiltInSegyLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `segy` library packages registered in `globalLibraryRegistry`.
 */
export function getSegySchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInSegyLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("segy")) {
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
        category: (meta["category"] as string) ?? "Binary Reel Header",
        domain: (meta["domain"] as string) ?? "geophysics",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "SEG-Y Rev 0 / Rev 1 Standard",
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
 * Case-insensitive lookup of a SEG-Y header field or wavelet schema by canonical name or alias.
 */
export function lookupSegySchema(nameOrAlias: string): CleanroomModelSchema | undefined {
  const key = nameOrAlias
    .trim()
    .replace(/^SEGY\./i, "")
    .toLowerCase();
  const schemas = getSegySchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
