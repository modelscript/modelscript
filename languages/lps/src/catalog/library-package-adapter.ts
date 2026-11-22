// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  LPS_STD_LIB_DIAGRAMS,
  LPS_STD_LIB_PKG_JSON,
  LPS_STD_LIB_SYMBOLS,
  getLpsStdLibWasmBytes,
} from "./lps-std-lib-data.js";

export function registerBuiltInLpsLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("lps").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(LPS_STD_LIB_PKG_JSON, {
    symbols: LPS_STD_LIB_SYMBOLS,
    diagrams: LPS_STD_LIB_DIAGRAMS,
    wasmBytes: getLpsStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/lps-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInLpsLibraryRegistered(): void {
  registerBuiltInLpsLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `lps` library packages registered in `globalLibraryRegistry`.
 */
export function getLpsSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInLpsLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("lps")) {
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
        category: (meta["category"] as string) ?? "Pipeline",
        domain: (meta["domain"] as string) ?? "fluid",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "ISO 20765 / Darcy-Weisbach Standard",
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
 * Case-insensitive lookup of an LPS pipeline equipment or EOS model schema by canonical name or alias.
 */
export function lookupLpsModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getLpsSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
