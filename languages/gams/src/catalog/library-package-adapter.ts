// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  GAMS_STD_LIB_DIAGRAMS,
  GAMS_STD_LIB_PKG_JSON,
  GAMS_STD_LIB_SYMBOLS,
  getGamsStdLibWasmBytes,
} from "./gams-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/gams-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInGamsLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("gams").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(GAMS_STD_LIB_PKG_JSON, {
    symbols: GAMS_STD_LIB_SYMBOLS,
    diagrams: GAMS_STD_LIB_DIAGRAMS,
    wasmBytes: getGamsStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/gams-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInGamsLibraryRegistered(): void {
  registerBuiltInGamsLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `gams` library packages registered in `globalLibraryRegistry`.
 */
export function getGamsSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInGamsLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("gams")) {
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
        category: (meta["category"] as string) ?? "Set & Indexed Operators",
        domain: (meta["domain"] as string) ?? "optimization",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "GAMS User's Guide / GAMSlib",
        symbolKind: sym.kind,
        width: diag?.width ?? 96,
        height: diag?.height ?? 56,
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
 * Case-insensitive lookup of a GAMS operator or GAMSlib archetype schema by name or alias.
 */
export function lookupGamsModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType
    .trim()
    .replace(/^GAMS\./i, "")
    .toLowerCase();
  const schemas = getGamsSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
