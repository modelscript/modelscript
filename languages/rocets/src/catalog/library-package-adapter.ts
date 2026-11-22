// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  ROCETS_STD_LIB_DIAGRAMS,
  ROCETS_STD_LIB_PKG_JSON,
  ROCETS_STD_LIB_SYMBOLS,
  getRocetsStdLibWasmBytes,
} from "./rocets-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/rocets-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInRocetsLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("rocets").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(ROCETS_STD_LIB_PKG_JSON, {
    symbols: ROCETS_STD_LIB_SYMBOLS,
    diagrams: ROCETS_STD_LIB_DIAGRAMS,
    wasmBytes: getRocetsStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/rocets-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInRocetsLibraryRegistered(): void {
  registerBuiltInRocetsLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `rocets` library packages registered in `globalLibraryRegistry`.
 */
export function getRocetsSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInRocetsLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("rocets")) {
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
        category: (meta["category"] as string) ?? "Turbomachinery",
        domain: (meta["domain"] as string) ?? "aerospace",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "NASA SP-1252 / Sutton Standard",
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
 * Case-insensitive lookup of a ROCETS propulsion module schema by canonical name, alias, or `GP/` prefix.
 */
export function lookupRocetsModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().replace(/^GP\//i, "").toLowerCase();
  const schemas = getRocetsSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
