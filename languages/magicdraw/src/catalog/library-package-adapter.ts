// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  MAGICDRAW_STD_LIB_DIAGRAMS,
  MAGICDRAW_STD_LIB_PKG_JSON,
  MAGICDRAW_STD_LIB_SYMBOLS,
  getMagicDrawStdLibWasmBytes,
} from "./magicdraw-std-lib-data.js";

export function registerBuiltInMagicDrawLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("magicdraw").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(MAGICDRAW_STD_LIB_PKG_JSON, {
    symbols: MAGICDRAW_STD_LIB_SYMBOLS,
    diagrams: MAGICDRAW_STD_LIB_DIAGRAMS,
    wasmBytes: getMagicDrawStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/magicdraw-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInMagicDrawLibraryRegistered(): void {
  registerBuiltInMagicDrawLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `magicdraw` library packages registered in `globalLibraryRegistry`.
 */
export function getMagicDrawSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInMagicDrawLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("magicdraw")) {
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
        category: (meta["category"] as string) ?? "MD Customization",
        domain: (meta["domain"] as string) ?? "systems",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "OMG SysML 1.6 / UML 2.5.1 Standard",
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
 * Case-insensitive lookup of a MagicDraw / Cameo standard library schema by canonical name or alias.
 */
export function lookupMagicDrawModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getMagicDrawSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
