// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  GPROMS_STD_LIB_DIAGRAMS,
  GPROMS_STD_LIB_PKG_JSON,
  GPROMS_STD_LIB_SYMBOLS,
  getGpromsStdLibWasmBytes,
} from "./gproms-std-lib-data.js";

export function registerBuiltInGpromsLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("gproms").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(GPROMS_STD_LIB_PKG_JSON, {
    symbols: GPROMS_STD_LIB_SYMBOLS,
    diagrams: GPROMS_STD_LIB_DIAGRAMS,
    wasmBytes: getGpromsStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/gproms-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInGpromsLibraryRegistered(): void {
  registerBuiltInGpromsLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `gproms` library packages registered in `globalLibraryRegistry`.
 */
export function getGpromsSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInGpromsLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("gproms")) {
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
        category: (meta["category"] as string) ?? "Reactor",
        domain: (meta["domain"] as string) ?? "chemical",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Fogler / Seader-Henley / CAPE-OPEN",
        symbolKind: sym.kind,
        width: diag?.width ?? 92,
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
 * Case-insensitive lookup of a gPROMS PML or property package schema by canonical name or alias.
 */
export function lookupGpromsModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getGpromsSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
