// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  RTDS_STD_LIB_DIAGRAMS,
  RTDS_STD_LIB_PKG_JSON,
  RTDS_STD_LIB_SYMBOLS,
  getRtdsStdLibWasmBytes,
} from "./rtds-std-lib-data.js";

export function registerBuiltInRtdsLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("rtds").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(RTDS_STD_LIB_PKG_JSON, {
    symbols: RTDS_STD_LIB_SYMBOLS,
    diagrams: RTDS_STD_LIB_DIAGRAMS,
    wasmBytes: getRtdsStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/rtds-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInRtdsLibraryRegistered(): void {
  registerBuiltInRtdsLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `rtds` library packages registered in `globalLibraryRegistry`.
 */
export function getRtdsSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInRtdsLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("rtds")) {
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
        category: (meta["category"] as string) ?? "Passive & Transmission",
        domain: (meta["domain"] as string) ?? "electrical",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Dommel / EMTP / IEEE Standard",
        symbolKind: sym.kind,
        width: diag?.width ?? 88,
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
 * Case-insensitive lookup of an RTDS EMT component schema by canonical name or alias.
 */
export function lookupRtdsModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getRtdsSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
