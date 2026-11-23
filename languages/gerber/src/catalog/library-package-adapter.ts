// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  GERBER_STD_LIB_DIAGRAMS,
  GERBER_STD_LIB_PKG_JSON,
  GERBER_STD_LIB_SYMBOLS,
  getGerberStdLibWasmBytes,
} from "./gerber-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/gerber-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInGerberLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("gerber").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(GERBER_STD_LIB_PKG_JSON, {
    symbols: GERBER_STD_LIB_SYMBOLS,
    diagrams: GERBER_STD_LIB_DIAGRAMS,
    wasmBytes: getGerberStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/gerber-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInGerberLibraryRegistered(): void {
  registerBuiltInGerberLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `gerber` library packages registered in `globalLibraryRegistry`.
 */
export function getGerberSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInGerberLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("gerber")) {
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
        category: (meta["category"] as string) ?? "Aperture Primitives",
        domain: (meta["domain"] as string) ?? "electronics",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Ucamco Gerber RS-274X / IPC-2221A",
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
 * Case-insensitive lookup of a Gerber aperture primitive or IPC-2221 preset by canonical name or alias.
 */
export function lookupGerberModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getGerberSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
