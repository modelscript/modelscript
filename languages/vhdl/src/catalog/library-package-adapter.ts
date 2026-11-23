// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  VHDL_STD_LIB_DIAGRAMS,
  VHDL_STD_LIB_PKG_JSON,
  VHDL_STD_LIB_SYMBOLS,
  getVhdlStdLibWasmBytes,
} from "./vhdl-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/vhdl-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInVhdlLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("vhdl").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(VHDL_STD_LIB_PKG_JSON, {
    symbols: VHDL_STD_LIB_SYMBOLS,
    diagrams: VHDL_STD_LIB_DIAGRAMS,
    wasmBytes: getVhdlStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/vhdl-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInVhdlLibraryRegistered(): void {
  registerBuiltInVhdlLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `vhdl` library packages registered in `globalLibraryRegistry`.
 */
export function getVhdlSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInVhdlLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("vhdl")) {
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
        category: (meta["category"] as string) ?? "IEEE.STD_LOGIC_1164",
        domain: (meta["domain"] as string) ?? "digital",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "IEEE Std 1076-1987 / IEEE Std 1164-1993",
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
 * Case-insensitive lookup of a VHDL standard library schema by name, full path, or alias.
 */
export function lookupVhdlModelSchema(name: string): CleanroomModelSchema | undefined {
  const key = name.trim().toLowerCase();
  const schemas = getVhdlSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
