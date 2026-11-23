// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  JCAMP_DX_STD_LIB_DIAGRAMS,
  JCAMP_DX_STD_LIB_PKG_JSON,
  JCAMP_DX_STD_LIB_SYMBOLS,
  getJcampDxStdLibWasmBytes,
} from "./jcamp-dx-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/jcamp-dx-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInJcampDxLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("jcamp-dx").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(JCAMP_DX_STD_LIB_PKG_JSON, {
    symbols: JCAMP_DX_STD_LIB_SYMBOLS,
    diagrams: JCAMP_DX_STD_LIB_DIAGRAMS,
    wasmBytes: getJcampDxStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/jcamp-dx-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInJcampDxLibraryRegistered(): void {
  registerBuiltInJcampDxLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `jcamp-dx` library packages registered in `globalLibraryRegistry`.
 */
export function getJcampDxSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInJcampDxLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("jcamp-dx")) {
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
        category: (meta["category"] as string) ?? "Spectroscopy Types",
        domain: (meta["domain"] as string) ?? "chemistry",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "IUPAC JCAMP-DX 4.24",
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
 * Case-insensitive lookup of a JCAMP-DX spectroscopy type or IR functional group schema.
 */
export function lookupJcampDxModelSchema(nameOrAlias: string): CleanroomModelSchema | undefined {
  const key = nameOrAlias.trim().toLowerCase();
  const schemas = getJcampDxSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
