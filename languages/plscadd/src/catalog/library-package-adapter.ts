// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  PLSCADD_STD_LIB_DIAGRAMS,
  PLSCADD_STD_LIB_PKG_JSON,
  PLSCADD_STD_LIB_SYMBOLS,
  getPlsCaddStdLibWasmBytes,
} from "./plscadd-std-lib-data.js";

export function registerBuiltInPlsCaddLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("plscadd").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(PLSCADD_STD_LIB_PKG_JSON, {
    symbols: PLSCADD_STD_LIB_SYMBOLS,
    diagrams: PLSCADD_STD_LIB_DIAGRAMS,
    wasmBytes: getPlsCaddStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/plscadd-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInPlsCaddLibraryRegistered(): void {
  registerBuiltInPlsCaddLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `plscadd` library packages registered in `globalLibraryRegistry`.
 */
export function getPlsCaddSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInPlsCaddLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("plscadd")) {
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
        category: (meta["category"] as string) ?? "Conductor",
        domain: (meta["domain"] as string) ?? "electrical",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "ASTM / IEEE / NESC / IEC Standard",
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
 * Case-insensitive lookup of a PLS-CADD cleanroom model schema by canonical name or alias.
 */
export function lookupPlsCaddModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getPlsCaddSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
