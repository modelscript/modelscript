// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  AMPL_STD_LIB_DIAGRAMS,
  AMPL_STD_LIB_PKG_JSON,
  AMPL_STD_LIB_SYMBOLS,
  getAmplStdLibWasmBytes,
} from "./ampl-std-lib-data.js";

export function registerBuiltInAmplLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("ampl").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(AMPL_STD_LIB_PKG_JSON, {
    symbols: AMPL_STD_LIB_SYMBOLS,
    diagrams: AMPL_STD_LIB_DIAGRAMS,
    wasmBytes: getAmplStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/ampl-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInAmplLibraryRegistered(): void {
  registerBuiltInAmplLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `ampl` library packages registered in `globalLibraryRegistry`.
 */
export function getAmplSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInAmplLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("ampl")) {
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
        category: (meta["category"] as string) ?? "Elementary Math",
        domain: (meta["domain"] as string) ?? "optimization",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Fourer, Gay & Kernighan AMPL Book",
        symbolKind: sym.kind,
        width: diag?.width ?? 80,
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
 * Case-insensitive lookup of an AMPL standard library function schema by canonical name or alias.
 */
export function lookupAmplModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getAmplSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
