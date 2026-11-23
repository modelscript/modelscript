// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  APT_STD_LIB_DIAGRAMS,
  APT_STD_LIB_PKG_JSON,
  APT_STD_LIB_SYMBOLS,
  getAptStdLibWasmBytes,
} from "./apt-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/apt-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInAptLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("apt").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(APT_STD_LIB_PKG_JSON, {
    symbols: APT_STD_LIB_SYMBOLS,
    diagrams: APT_STD_LIB_DIAGRAMS,
    wasmBytes: getAptStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/apt-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInAptLibraryRegistered(): void {
  registerBuiltInAptLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `apt` library packages registered in `globalLibraryRegistry`.
 */
export function getAptSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInAptLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("apt")) {
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
        category: (meta["category"] as string) ?? "Analytic Geometry",
        domain: (meta["domain"] as string) ?? "manufacturing",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "MIT APT III / ISO 4342",
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
 * Case-insensitive lookup of an APT standard schema by canonical name, path, or alias.
 */
export function lookupAptModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType
    .trim()
    .replace(/^APT\./i, "")
    .toLowerCase();
  const schemas = getAptSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
