// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  LSDYNA_STD_LIB_DIAGRAMS,
  LSDYNA_STD_LIB_PKG_JSON,
  LSDYNA_STD_LIB_SYMBOLS,
  getLsDynaStdLibWasmBytes,
} from "./lsdyna-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/lsdyna-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInLsDynaLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("lsdyna").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(LSDYNA_STD_LIB_PKG_JSON, {
    symbols: LSDYNA_STD_LIB_SYMBOLS,
    diagrams: LSDYNA_STD_LIB_DIAGRAMS,
    wasmBytes: getLsDynaStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/lsdyna-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInLsDynaLibraryRegistered(): void {
  registerBuiltInLsDynaLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `lsdyna` library packages registered in `globalLibraryRegistry`.
 */
export function getLsDynaSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInLsDynaLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("lsdyna")) {
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
        category: (meta["category"] as string) ?? "Material",
        domain: (meta["domain"] as string) ?? "structural",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Hallquist (1976-1988) DYNA3D / LS-DYNA",
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
 * Case-insensitive lookup of an LS-DYNA material or section schema by canonical name or alias.
 */
export function lookupLsDynaSchema(cardName: string): CleanroomModelSchema | undefined {
  const key = cardName.trim().replace(/^\*/, "").toLowerCase();
  const schemas = getLsDynaSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
