// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  VERILOG_STD_LIB_DIAGRAMS,
  VERILOG_STD_LIB_PKG_JSON,
  VERILOG_STD_LIB_SYMBOLS,
  getVerilogStdLibWasmBytes,
} from "./verilog-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/verilog-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInVerilogLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("verilog").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(VERILOG_STD_LIB_PKG_JSON, {
    symbols: VERILOG_STD_LIB_SYMBOLS,
    diagrams: VERILOG_STD_LIB_DIAGRAMS,
    wasmBytes: getVerilogStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/verilog-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInVerilogLibraryRegistered(): void {
  registerBuiltInVerilogLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `verilog` library packages registered in `globalLibraryRegistry`.
 */
export function getVerilogSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInVerilogLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("verilog")) {
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
        category: (meta["category"] as string) ?? "Logic Gates",
        domain: (meta["domain"] as string) ?? "digital-rtl",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "IEEE Std 1364-2001",
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
 * Case-insensitive lookup of a Verilog primitive or RTL block schema by name, namePath, or alias.
 */
export function lookupVerilogModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getVerilogSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
