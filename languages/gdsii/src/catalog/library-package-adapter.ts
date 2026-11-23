// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  GDSII_STD_LIB_DIAGRAMS,
  GDSII_STD_LIB_PKG_JSON,
  GDSII_STD_LIB_SYMBOLS,
  getGdsiiStdLibWasmBytes,
} from "./gdsii-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/gdsii-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInGdsiiLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("gdsii").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(GDSII_STD_LIB_PKG_JSON, {
    symbols: GDSII_STD_LIB_SYMBOLS,
    diagrams: GDSII_STD_LIB_DIAGRAMS,
    wasmBytes: getGdsiiStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/gdsii-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInGdsiiLibraryRegistered(): void {
  registerBuiltInGdsiiLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `gdsii` library packages registered in `globalLibraryRegistry`.
 */
export function getGdsiiSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInGdsiiLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("gdsii")) {
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
        category: (meta["category"] as string) ?? "Foundry Layer",
        domain: (meta["domain"] as string) ?? "semiconductor",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Cleanroom Generic 180nm CMOS PDK",
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
 * Case-insensitive lookup of a GDSII foundry layer or standard cell schema by name or alias.
 */
export function lookupGdsiiSchema(nameOrAlias: string): CleanroomModelSchema | undefined {
  const key = nameOrAlias.trim().toLowerCase();
  const schemas = getGdsiiSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
