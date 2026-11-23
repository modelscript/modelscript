// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  JEDEC_STD_LIB_DIAGRAMS,
  JEDEC_STD_LIB_PKG_JSON,
  JEDEC_STD_LIB_SYMBOLS,
  getJedecStdLibWasmBytes,
} from "./jedec-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/jedec-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInJedecLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("jedec").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(JEDEC_STD_LIB_PKG_JSON, {
    symbols: JEDEC_STD_LIB_SYMBOLS,
    diagrams: JEDEC_STD_LIB_DIAGRAMS,
    wasmBytes: getJedecStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/jedec-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInJedecLibraryRegistered(): void {
  registerBuiltInJedecLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `jedec` library packages registered in `globalLibraryRegistry`.
 */
export function getJedecSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInJedecLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("jedec")) {
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
        category: (meta["category"] as string) ?? "Programmable Logic Devices",
        domain: (meta["domain"] as string) ?? "electronics",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "JEDEC Standard 3 (JESD3)",
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
 * Case-insensitive lookup of a JEDEC PLD device or field descriptor by canonical name or alias.
 */
export function lookupJedecModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getJedecSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
