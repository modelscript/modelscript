// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  CSMP_STD_LIB_DIAGRAMS,
  CSMP_STD_LIB_PKG_JSON,
  CSMP_STD_LIB_SYMBOLS,
  getCsmpStdLibWasmBytes,
} from "./csmp-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/csmp-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInCsmpLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("csmp").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(CSMP_STD_LIB_PKG_JSON, {
    symbols: CSMP_STD_LIB_SYMBOLS,
    diagrams: CSMP_STD_LIB_DIAGRAMS,
    wasmBytes: getCsmpStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/csmp-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInCsmpLibraryRegistered(): void {
  registerBuiltInCsmpLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `csmp` library packages registered in `globalLibraryRegistry`.
 */
export function getCsmpSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInCsmpLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("csmp")) {
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
        category: (meta["category"] as string) ?? "Integration & Differentiation",
        domain: (meta["domain"] as string) ?? "controls",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "IBM System/360 CSMP GH20-0367-4",
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
 * Case-insensitive lookup of a CSMP/360 standard block schema by canonical name or alias.
 */
export function lookupCsmpBlockSchema(blockType: string): CleanroomModelSchema | undefined {
  const key = blockType.trim().toLowerCase();
  const schemas = getCsmpSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
