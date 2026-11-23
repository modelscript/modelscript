// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  LUSTRE_STD_LIB_DIAGRAMS,
  LUSTRE_STD_LIB_PKG_JSON,
  LUSTRE_STD_LIB_SYMBOLS,
  getLustreStdLibWasmBytes,
} from "./lustre-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/lustre-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInLustreLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("lustre").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(LUSTRE_STD_LIB_PKG_JSON, {
    symbols: LUSTRE_STD_LIB_SYMBOLS,
    diagrams: LUSTRE_STD_LIB_DIAGRAMS,
    wasmBytes: getLustreStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/lustre-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInLustreLibraryRegistered(): void {
  registerBuiltInLustreLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `lustre` library packages registered in `globalLibraryRegistry`.
 */
export function getLustreSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInLustreLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("lustre")) {
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
        category: (meta["category"] as string) ?? "Temporal Logic",
        domain: (meta["domain"] as string) ?? "controls",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Halbwachs et al., LUSTRE (1991)",
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
 * Case-insensitive lookup of a Lustre cleanroom standard library operator schema by name, path, or alias.
 */
export function lookupLustreOperatorSchema(name: string): CleanroomModelSchema | undefined {
  const key = name
    .trim()
    .replace(/^Lustre\.Std\./i, "")
    .toLowerCase();
  const schemas = getLustreSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
