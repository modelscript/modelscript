// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  ESL_STD_LIB_DIAGRAMS,
  ESL_STD_LIB_PKG_JSON,
  ESL_STD_LIB_SYMBOLS,
  getEslStdLibWasmBytes,
} from "./esl-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/esl-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInEslLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("esl").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(ESL_STD_LIB_PKG_JSON, {
    symbols: ESL_STD_LIB_SYMBOLS,
    diagrams: ESL_STD_LIB_DIAGRAMS,
    wasmBytes: getEslStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/esl-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInEslLibraryRegistered(): void {
  registerBuiltInEslLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `esl` library packages registered in `globalLibraryRegistry`.
 */
export function getEslSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInEslLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("esl")) {
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
        category: (meta["category"] as string) ?? "Control & Transfer",
        domain: (meta["domain"] as string) ?? "aerospace",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "ESA ESL Reference Manual",
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
 * Case-insensitive lookup of an ESL standard library block schema by canonical name or alias.
 */
export function lookupEslModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().replace(/^esl:/i, "").toLowerCase();
  const schemas = getEslSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
