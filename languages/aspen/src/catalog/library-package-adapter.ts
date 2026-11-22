// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  ASPEN_STD_LIB_DIAGRAMS,
  ASPEN_STD_LIB_PKG_JSON,
  ASPEN_STD_LIB_SYMBOLS,
  getAspenStdLibWasmBytes,
} from "./aspen-std-lib-data.js";

/**
 * Registers the zero-I/O pre-bundled `@modelscript/aspen-std-lib` package synchronously
 * in `globalLibraryRegistry` (idempotent).
 */
export function registerBuiltInAspenLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("aspen").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(ASPEN_STD_LIB_PKG_JSON, {
    symbols: ASPEN_STD_LIB_SYMBOLS,
    diagrams: ASPEN_STD_LIB_DIAGRAMS,
    wasmBytes: getAspenStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/aspen-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInAspenLibraryRegistered(): void {
  registerBuiltInAspenLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `aspen` library packages registered in `globalLibraryRegistry`.
 */
export function getAspenSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInAspenLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("aspen")) {
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
        category: (meta["category"] as string) ?? "Separator",
        domain: (meta["domain"] as string) ?? "process",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Smith-Van Ness-Abbott / NIST WebBook",
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
 * Case-insensitive lookup of an Aspen unit operation, property method, or pure component schema
 * by canonical name or alias.
 */
export function lookupAspenModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getAspenSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
