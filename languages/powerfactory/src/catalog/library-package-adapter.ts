// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  POWERFACTORY_STD_LIB_DIAGRAMS,
  POWERFACTORY_STD_LIB_PKG_JSON,
  POWERFACTORY_STD_LIB_SYMBOLS,
  getPowerFactoryStdLibWasmBytes,
} from "./powerfactory-std-lib-data.js";

/**
 * Synchronously registers the zero-I/O built-in `@modelscript/powerfactory-std-lib` bundle
 * in `globalLibraryRegistry`.
 */
export function registerBuiltInPowerFactoryLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("powerfactory").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(POWERFACTORY_STD_LIB_PKG_JSON, {
    symbols: POWERFACTORY_STD_LIB_SYMBOLS,
    diagrams: POWERFACTORY_STD_LIB_DIAGRAMS,
    wasmBytes: getPowerFactoryStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/powerfactory-std-lib` package is registered
 * in `globalLibraryRegistry`.
 */
export function ensureBuiltInPowerFactoryLibraryRegistered(): void {
  registerBuiltInPowerFactoryLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `powerfactory` library packages
 * registered in `globalLibraryRegistry`.
 */
export function getPowerFactorySchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInPowerFactoryLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("powerfactory")) {
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
        category: (meta["category"] as string) ?? "Rotating Machine",
        domain: (meta["domain"] as string) ?? "electrical",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "IEC / IEEE / CIGRE / WECC Standard",
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
 * Case-insensitive lookup of a PowerFactory Global Library or DSL model schema
 * by canonical name, namePath, or alias.
 */
export function lookupPowerFactoryModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getPowerFactorySchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
