// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  EASY5_STD_LIB_DIAGRAMS,
  EASY5_STD_LIB_PKG_JSON,
  EASY5_STD_LIB_SYMBOLS,
  getEasy5StdLibWasmBytes,
} from "./easy5-std-lib-data.js";

/**
 * Registers the pre-bundled `@modelscript/easy5-std-lib` synchronously (zero I/O)
 * in `globalLibraryRegistry` for Node.js, Browsers, and Web Workers.
 */
export function registerBuiltInEasy5LibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("easy5").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(EASY5_STD_LIB_PKG_JSON, {
    symbols: EASY5_STD_LIB_SYMBOLS,
    diagrams: EASY5_STD_LIB_DIAGRAMS,
    wasmBytes: getEasy5StdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/easy5-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInEasy5LibraryRegistered(): void {
  registerBuiltInEasy5LibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `easy5` library packages registered in `globalLibraryRegistry`.
 */
export function getEasy5SchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInEasy5LibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("easy5")) {
    const diagByPath = new Map<string, DiagramComponentSpec>();
    for (const d of pkg.diagrams) {
      diagByPath.set(d.namePath, d);
    }
    for (const sym of pkg.symbols) {
      const meta = (sym.metadata ?? {}) as Record<string, unknown>;
      const diag = diagByPath.get(sym.namePath);
      const extra: Record<string, unknown> = {};
      if (meta["archetypeId"] !== undefined) extra["archetypeId"] = meta["archetypeId"];
      if (meta["library"] !== undefined) extra["library"] = meta["library"];
      out.push({
        namePath: sym.namePath,
        name: sym.name,
        aliases: Array.isArray(meta["aliases"]) ? (meta["aliases"] as string[]) : [],
        label: (meta["label"] as string) ?? diag?.label ?? sym.name,
        category: (meta["category"] as string) ?? "General Purpose",
        domain: (meta["domain"] as string) ?? "control",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Standard Engineering Textbook",
        symbolKind: sym.kind,
        width: diag?.width ?? 80,
        height: diag?.height ?? 48,
        svg: diag?.svg,
        ports: diag?.ports ?? [],
        parameters: Array.isArray(meta["parameters"]) ? (meta["parameters"] as CleanroomParameterSchema[]) : [],
        wasmKernel: typeof meta["wasmKernel"] === "string" ? meta["wasmKernel"] : undefined,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      });
    }
  }
  return out;
}

/**
 * Case-insensitive lookup of an Easy5 standard library schema by canonical name, library-prefixed
 * path (e.g. `GP/IN`, `HC/OR`, `AE/AT`, `easy5:gp/IN`), or alias.
 */
export function lookupEasy5ModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getEasy5SchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
