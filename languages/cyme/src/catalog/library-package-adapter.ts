// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  CYME_STD_LIB_DIAGRAMS,
  CYME_STD_LIB_PKG_JSON,
  CYME_STD_LIB_SYMBOLS,
  getCymeStdLibWasmBytes,
} from "./cyme-std-lib-data.js";

export function registerBuiltInCymeLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("cyme").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(CYME_STD_LIB_PKG_JSON, {
    symbols: CYME_STD_LIB_SYMBOLS,
    diagrams: CYME_STD_LIB_DIAGRAMS,
    wasmBytes: getCymeStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/cyme-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInCymeLibraryRegistered(): void {
  registerBuiltInCymeLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `cyme` library packages registered in `globalLibraryRegistry`.
 */
export function getCymeSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInCymeLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("cyme")) {
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
        category: (meta["category"] as string) ?? "Conductors & Cables",
        domain: (meta["domain"] as string) ?? "electrical",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "IEEE / IEC / Kersting Distribution Standard",
        symbolKind: sym.kind,
        width: diag?.width ?? 96,
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
 * Case-insensitive lookup of a CYME distribution equipment schema by canonical name or alias.
 */
export function lookupCymeModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getCymeSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
