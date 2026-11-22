// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  ATP_STD_LIB_DIAGRAMS,
  ATP_STD_LIB_PKG_JSON,
  ATP_STD_LIB_SYMBOLS,
  getAtpStdLibWasmBytes,
} from "./atp-std-lib-data.js";

export function registerBuiltInAtpLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("atp").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(ATP_STD_LIB_PKG_JSON, {
    symbols: ATP_STD_LIB_SYMBOLS,
    diagrams: ATP_STD_LIB_DIAGRAMS,
    wasmBytes: getAtpStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/atp-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInAtpLibraryRegistered(): void {
  registerBuiltInAtpLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `atp` library packages registered in `globalLibraryRegistry`.
 */
export function getAtpSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInAtpLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("atp")) {
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
        category: (meta["category"] as string) ?? "Linear & Distributed Branch",
        domain: (meta["domain"] as string) ?? "electrical",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Dommel EMTP Theory Book / IEEE",
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
 * Case-insensitive lookup of an EMTP-ATP component schema by canonical name or alias.
 */
export function lookupAtpModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getAtpSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
