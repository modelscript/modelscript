// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  SIMSCRIPT_STD_LIB_DIAGRAMS,
  SIMSCRIPT_STD_LIB_PKG_JSON,
  SIMSCRIPT_STD_LIB_SYMBOLS,
  getSimscriptStdLibWasmBytes,
} from "./simscript-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/simscript-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInSimscriptLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("simscript").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(SIMSCRIPT_STD_LIB_PKG_JSON, {
    symbols: SIMSCRIPT_STD_LIB_SYMBOLS,
    diagrams: SIMSCRIPT_STD_LIB_DIAGRAMS,
    wasmBytes: getSimscriptStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/simscript-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInSimscriptLibraryRegistered(): void {
  registerBuiltInSimscriptLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `simscript` library packages registered in `globalLibraryRegistry`.
 */
export function getSimscriptSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInSimscriptLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("simscript")) {
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
        category: (meta["category"] as string) ?? "Distributions",
        domain: (meta["domain"] as string) ?? "discrete-event-simulation",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "RAND RM-5776-PR — SIMSCRIPT II.5",
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
 * Case-insensitive lookup of a SIMSCRIPT II.5 library schema by canonical name or alias.
 */
export function lookupSimscriptModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType
    .trim()
    .replace(/^SIMSCRIPT\./i, "")
    .toLowerCase();
  const schemas = getSimscriptSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
