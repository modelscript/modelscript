// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  ECLIPSE_STD_LIB_DIAGRAMS,
  ECLIPSE_STD_LIB_PKG_JSON,
  ECLIPSE_STD_LIB_SYMBOLS,
  getEclipseStdLibWasmBytes,
} from "./eclipse-std-lib-data.js";

export function registerBuiltInEclipseLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("eclipse").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(ECLIPSE_STD_LIB_PKG_JSON, {
    symbols: ECLIPSE_STD_LIB_SYMBOLS,
    diagrams: ECLIPSE_STD_LIB_DIAGRAMS,
    wasmBytes: getEclipseStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/eclipse-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInEclipseLibraryRegistered(): void {
  registerBuiltInEclipseLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `eclipse` library packages registered in `globalLibraryRegistry`.
 */
export function getEclipseSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInEclipseLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("eclipse")) {
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
        category: (meta["category"] as string) ?? "PVT & EOS",
        domain: (meta["domain"] as string) ?? "subsurface",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "OPM Flow Reference Manual",
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
 * Case-insensitive lookup of an ECLIPSE reservoir physics model schema by canonical name or alias.
 */
export function lookupEclipseModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getEclipseSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
