// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  GPSS_STD_LIB_DIAGRAMS,
  GPSS_STD_LIB_PKG_JSON,
  GPSS_STD_LIB_SYMBOLS,
  getGpssStdLibWasmBytes,
} from "./gpss-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/gpss-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInGpssLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("gpss").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(GPSS_STD_LIB_PKG_JSON, {
    symbols: GPSS_STD_LIB_SYMBOLS,
    diagrams: GPSS_STD_LIB_DIAGRAMS,
    wasmBytes: getGpssStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/gpss-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInGpssLibraryRegistered(): void {
  registerBuiltInGpssLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `gpss` library packages registered in `globalLibraryRegistry`.
 */
export function getGpssSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInGpssLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("gpss")) {
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
        category: (meta["category"] as string) ?? "Transaction Flow",
        domain: (meta["domain"] as string) ?? "discrete-event",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Geoffrey Gordon (1961) GPSS",
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
 * Case-insensitive lookup of a GPSS block or SNA schema by canonical name, path, or alias.
 */
export function lookupGpssModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getGpssSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
