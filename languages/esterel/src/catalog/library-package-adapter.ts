// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  ESTEREL_STD_LIB_DIAGRAMS,
  ESTEREL_STD_LIB_PKG_JSON,
  ESTEREL_STD_LIB_SYMBOLS,
  getEsterelStdLibWasmBytes,
} from "./esterel-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/esterel-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInEsterelLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("esterel").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(ESTEREL_STD_LIB_PKG_JSON, {
    symbols: ESTEREL_STD_LIB_SYMBOLS,
    diagrams: ESTEREL_STD_LIB_DIAGRAMS,
    wasmBytes: getEsterelStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/esterel-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInEsterelLibraryRegistered(): void {
  registerBuiltInEsterelLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `esterel` library packages registered in `globalLibraryRegistry`.
 */
export function getEsterelSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInEsterelLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("esterel")) {
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
        category: (meta["category"] as string) ?? "Synchronization",
        domain: (meta["domain"] as string) ?? "reactive",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Berry Esterel Standard Library",
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
 * Case-insensitive lookup of an Esterel reactive pattern schema by canonical name or alias.
 */
export function lookupEsterelPatternSchema(patternName: string): CleanroomModelSchema | undefined {
  const key = patternName.trim().toLowerCase();
  const schemas = getEsterelSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
