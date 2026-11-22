// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  SPICE_STD_LIB_DIAGRAMS,
  SPICE_STD_LIB_PKG_JSON,
  SPICE_STD_LIB_SYMBOLS,
  getSpiceStdLibWasmBytes,
} from "./spice-std-lib-data.js";

export function registerBuiltInSpiceLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("spice").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(SPICE_STD_LIB_PKG_JSON, {
    symbols: SPICE_STD_LIB_SYMBOLS,
    diagrams: SPICE_STD_LIB_DIAGRAMS,
    wasmBytes: getSpiceStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/spice-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInSpiceLibraryRegistered(): void {
  registerBuiltInSpiceLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `spice` library packages registered in `globalLibraryRegistry`.
 */
export function getSpiceSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInSpiceLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("spice")) {
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
        category: (meta["category"] as string) ?? "Diode",
        domain: (meta["domain"] as string) ?? "electrical",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "SPICE3F5 / Standard Semiconductor Physics",
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
 * Case-insensitive lookup of a SPICE device/primitive schema by canonical name or alias.
 */
export function lookupSpiceModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getSpiceSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
