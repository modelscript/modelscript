// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  RINEX_STD_LIB_DIAGRAMS,
  RINEX_STD_LIB_PKG_JSON,
  RINEX_STD_LIB_SYMBOLS,
  getRinexStdLibWasmBytes,
} from "./rinex-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/rinex-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInRinexLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("rinex").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(RINEX_STD_LIB_PKG_JSON, {
    symbols: RINEX_STD_LIB_SYMBOLS,
    diagrams: RINEX_STD_LIB_DIAGRAMS,
    wasmBytes: getRinexStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/rinex-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInRinexLibraryRegistered(): void {
  registerBuiltInRinexLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `rinex` library packages registered in `globalLibraryRegistry`.
 */
export function getRinexSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInRinexLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("rinex")) {
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
        category: (meta["category"] as string) ?? "Observation Type",
        domain: (meta["domain"] as string) ?? "aerospace",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Gurtner et al. (1989) RINEX v2.11",
        symbolKind: sym.kind,
        width: diag?.width ?? 88,
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
 * Case-insensitive lookup of a RINEX observation type or WGS-84 constant schema.
 */
export function lookupRinexSchema(name: string): CleanroomModelSchema | undefined {
  const key = name
    .trim()
    .replace(/^RINEX\./i, "")
    .toLowerCase();
  const schemas = getRinexSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
