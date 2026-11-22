// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  NMTRAN_STD_LIB_DIAGRAMS,
  NMTRAN_STD_LIB_PKG_JSON,
  NMTRAN_STD_LIB_SYMBOLS,
  getNmtranStdLibWasmBytes,
} from "./nmtran-std-lib-data.js";

export function registerBuiltInNmtranLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("nmtran").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(NMTRAN_STD_LIB_PKG_JSON, {
    symbols: NMTRAN_STD_LIB_SYMBOLS,
    diagrams: NMTRAN_STD_LIB_DIAGRAMS,
    wasmBytes: getNmtranStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/nmtran-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInNmtranLibraryRegistered(): void {
  registerBuiltInNmtranLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `nmtran` library packages registered in `globalLibraryRegistry`.
 */
export function getNmtranSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInNmtranLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("nmtran")) {
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
        category: (meta["category"] as string) ?? "Compartmental ADVAN",
        domain: (meta["domain"] as string) ?? "pharmacometrics",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Gibaldi & Perrier / Rowland & Tozer",
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
 * Case-insensitive lookup of an NMTRAN / PREDPP model schema by canonical name or alias.
 */
export function lookupNmtranModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getNmtranSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
