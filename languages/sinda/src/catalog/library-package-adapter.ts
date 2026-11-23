// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  SINDA_STD_LIB_DIAGRAMS,
  SINDA_STD_LIB_PKG_JSON,
  SINDA_STD_LIB_SYMBOLS,
  getSindaStdLibWasmBytes,
} from "./sinda-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/sinda-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInSindaLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("sinda").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(SINDA_STD_LIB_PKG_JSON, {
    symbols: SINDA_STD_LIB_SYMBOLS,
    diagrams: SINDA_STD_LIB_DIAGRAMS,
    wasmBytes: getSindaStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/sinda-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInSindaLibraryRegistered(): void {
  registerBuiltInSindaLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `sinda` library packages registered in `globalLibraryRegistry`.
 */
export function getSindaSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInSindaLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("sinda")) {
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
        category: (meta["category"] as string) ?? "Solver Routines",
        domain: (meta["domain"] as string) ?? "thermal",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "NASA MSC-13805 / Gilmore Spacecraft Thermal Control Handbook",
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
 * Case-insensitive lookup of a SINDA solver routine or spacecraft thermal material schema.
 */
export function lookupSindaModelSchema(name: string): CleanroomModelSchema | undefined {
  const key = name
    .trim()
    .replace(/^SINDA\./i, "")
    .toLowerCase();
  const schemas = getSindaSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
