// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  ADAMS_STD_LIB_DIAGRAMS,
  ADAMS_STD_LIB_PKG_JSON,
  ADAMS_STD_LIB_SYMBOLS,
  getAdamsStdLibWasmBytes,
} from "./adams-std-lib-data.js";

export function registerBuiltInAdamsLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("adams").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(ADAMS_STD_LIB_PKG_JSON, {
    symbols: ADAMS_STD_LIB_SYMBOLS,
    diagrams: ADAMS_STD_LIB_DIAGRAMS,
    wasmBytes: getAdamsStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/adams-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInAdamsLibraryRegistered(): void {
  registerBuiltInAdamsLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `adams` library packages registered in `globalLibraryRegistry`.
 */
export function getAdamsSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInAdamsLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("adams")) {
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
        category: (meta["category"] as string) ?? "Runtime Function",
        domain: (meta["domain"] as string) ?? "mechanical",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Shabana / Pacejka Standard Multibody Formulation",
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
 * Case-insensitive lookup of an MSC Adams element or runtime function schema by canonical name or alias.
 */
export function lookupAdamsModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getAdamsSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
