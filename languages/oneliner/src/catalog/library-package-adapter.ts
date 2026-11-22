// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  ONELINER_STD_LIB_DIAGRAMS,
  ONELINER_STD_LIB_PKG_JSON,
  ONELINER_STD_LIB_SYMBOLS,
  getOneLinerStdLibWasmBytes,
} from "./oneliner-std-lib-data.js";

export function registerBuiltInOneLinerLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("oneliner").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(ONELINER_STD_LIB_PKG_JSON, {
    symbols: ONELINER_STD_LIB_SYMBOLS,
    diagrams: ONELINER_STD_LIB_DIAGRAMS,
    wasmBytes: getOneLinerStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/oneliner-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInOneLinerLibraryRegistered(): void {
  registerBuiltInOneLinerLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `oneliner` library packages registered in `globalLibraryRegistry`.
 */
export function getOneLinerSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInOneLinerLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("oneliner")) {
    const diagByPath = new Map<string, DiagramComponentSpec>();
    for (const d of pkg.diagrams) {
      diagByPath.set(d.namePath, d);
    }
    for (const sym of pkg.symbols) {
      const meta = (sym.metadata ?? {}) as Record<string, unknown>;
      const diag = diagByPath.get(sym.namePath);
      const extra: Record<string, unknown> = {};
      if (meta["archetypeId"] !== undefined) extra["archetypeId"] = meta["archetypeId"];
      if (meta["ansiCode"] !== undefined) extra["ansiCode"] = meta["ansiCode"];

      out.push({
        namePath: sym.namePath,
        name: sym.name,
        aliases: Array.isArray(meta["aliases"]) ? (meta["aliases"] as string[]) : [],
        label: (meta["label"] as string) ?? diag?.label ?? sym.name,
        category: (meta["category"] as string) ?? "Overcurrent Relay",
        domain: (meta["domain"] as string) ?? "electrical",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "IEEE C37.112 / IEC 60255-151",
        symbolKind: sym.kind,
        width: diag?.width ?? 88,
        height: diag?.height ?? 52,
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
 * Case-insensitive lookup of an ASPEN OneLiner relay or sequence equipment schema
 * by canonical name or alias.
 */
export function lookupOneLinerModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getOneLinerSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
