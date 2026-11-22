// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  TOUGH_STD_LIB_DIAGRAMS,
  TOUGH_STD_LIB_PKG_JSON,
  TOUGH_STD_LIB_SYMBOLS,
  getToughStdLibWasmBytes,
} from "./tough-std-lib-data.js";

export function registerBuiltInToughLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("tough").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(TOUGH_STD_LIB_PKG_JSON, {
    symbols: TOUGH_STD_LIB_SYMBOLS,
    diagrams: TOUGH_STD_LIB_DIAGRAMS,
    wasmBytes: getToughStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/tough-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInToughLibraryRegistered(): void {
  registerBuiltInToughLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `tough` library packages registered in `globalLibraryRegistry`.
 */
export function getToughSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInToughLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("tough")) {
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
        category: (meta["category"] as string) ?? "EOS Module",
        domain: (meta["domain"] as string) ?? "subsurface",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "LBNL TOUGH2 / TOUGH3",
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
 * Case-insensitive lookup of a TOUGH2/TOUGH3 EOS or constitutive model schema by canonical name or alias.
 */
export function lookupToughModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getToughSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
