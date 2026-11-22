// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  GTSUITE_STD_LIB_DIAGRAMS,
  GTSUITE_STD_LIB_PKG_JSON,
  GTSUITE_STD_LIB_SYMBOLS,
  getGtSuiteStdLibWasmBytes,
} from "./gtsuite-std-lib-data.js";

export function registerBuiltInGtSuiteLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("gtsuite").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(GTSUITE_STD_LIB_PKG_JSON, {
    symbols: GTSUITE_STD_LIB_SYMBOLS,
    diagrams: GTSUITE_STD_LIB_DIAGRAMS,
    wasmBytes: getGtSuiteStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/gtsuite-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInGtSuiteLibraryRegistered(): void {
  registerBuiltInGtSuiteLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `gtsuite` library packages registered in `globalLibraryRegistry`.
 */
export function getGtSuiteSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInGtSuiteLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("gtsuite")) {
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
        category: (meta["category"] as string) ?? "Flow & Gas Dynamics",
        domain: (meta["domain"] as string) ?? "fluid",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Heywood / NASA-9 Cleanroom Standard",
        symbolKind: sym.kind,
        width: diag?.width ?? 88,
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
 * Case-insensitive lookup of a GT-SUITE template schema by canonical name or alias.
 */
export function lookupGtSuiteModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getGtSuiteSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
