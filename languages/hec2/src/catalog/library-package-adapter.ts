// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  HEC2_STD_LIB_DIAGRAMS,
  HEC2_STD_LIB_PKG_JSON,
  HEC2_STD_LIB_SYMBOLS,
  getHec2StdLibWasmBytes,
} from "./hec2-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/hec2-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInHec2LibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("hec2").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(HEC2_STD_LIB_PKG_JSON, {
    symbols: HEC2_STD_LIB_SYMBOLS,
    diagrams: HEC2_STD_LIB_DIAGRAMS,
    wasmBytes: getHec2StdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/hec2-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInHec2LibraryRegistered(): void {
  registerBuiltInHec2LibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `hec2` library packages registered in `globalLibraryRegistry`.
 */
export function getHec2SchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInHec2LibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("hec2")) {
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
        category: (meta["category"] as string) ?? "Natural Streams",
        domain: (meta["domain"] as string) ?? "hydraulics",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Chow (1959) / USACE HEC-2",
        symbolKind: sym.kind,
        width: diag?.width ?? 96,
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
 * Case-insensitive lookup of a HEC-2 Manning roughness or loss schema by canonical name, path, or alias.
 */
export function lookupHec2ModelSchema(query: string): CleanroomModelSchema | undefined {
  const key = query.trim().toLowerCase();
  const schemas = getHec2SchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
