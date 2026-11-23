// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  GAUSSIAN_STD_LIB_DIAGRAMS,
  GAUSSIAN_STD_LIB_PKG_JSON,
  GAUSSIAN_STD_LIB_SYMBOLS,
  getGaussianStdLibWasmBytes,
} from "./gaussian-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/gaussian-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInGaussianLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("gaussian").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(GAUSSIAN_STD_LIB_PKG_JSON, {
    symbols: GAUSSIAN_STD_LIB_SYMBOLS,
    diagrams: GAUSSIAN_STD_LIB_DIAGRAMS,
    wasmBytes: getGaussianStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/gaussian-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInGaussianLibraryRegistered(): void {
  registerBuiltInGaussianLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `gaussian` library packages registered in `globalLibraryRegistry`.
 */
export function getGaussianSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInGaussianLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("gaussian")) {
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
        category: (meta["category"] as string) ?? "Quantum Chemistry",
        domain: (meta["domain"] as string) ?? "chemistry",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Gaussian Cleanroom Standard Library",
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
 * Case-insensitive lookup of a Gaussian method or basis set schema by canonical name or alias.
 */
export function lookupGaussianModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  if (!key) return undefined;
  const schemas = getGaussianSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
