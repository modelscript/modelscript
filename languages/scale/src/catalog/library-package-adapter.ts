// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  SCALE_STD_LIB_DIAGRAMS,
  SCALE_STD_LIB_PKG_JSON,
  SCALE_STD_LIB_SYMBOLS,
  getScaleStdLibWasmBytes,
} from "./scale-std-lib-data.js";

export function registerBuiltInScaleLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("scale").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(SCALE_STD_LIB_PKG_JSON, {
    symbols: SCALE_STD_LIB_SYMBOLS,
    diagrams: SCALE_STD_LIB_DIAGRAMS,
    wasmBytes: getScaleStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/scale-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInScaleLibraryRegistered(): void {
  registerBuiltInScaleLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `scale` library packages registered in `globalLibraryRegistry`.
 */
export function getScaleSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInScaleLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("scale")) {
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
        category: (meta["category"] as string) ?? "Standard Composition",
        domain: (meta["domain"] as string) ?? "nuclear-criticality",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "ORNL/TM-2005/39 SCALE",
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
 * Case-insensitive lookup of a SCALE composition or nuclide schema by canonical name or alias.
 */
export function lookupScaleModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getScaleSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
