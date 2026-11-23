// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  SREC_STD_LIB_DIAGRAMS,
  SREC_STD_LIB_PKG_JSON,
  SREC_STD_LIB_SYMBOLS,
  getSrecStdLibWasmBytes,
} from "./srec-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/srec-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInSrecLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("srec").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(SREC_STD_LIB_PKG_JSON, {
    symbols: SREC_STD_LIB_SYMBOLS,
    diagrams: SREC_STD_LIB_DIAGRAMS,
    wasmBytes: getSrecStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/srec-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInSrecLibraryRegistered(): void {
  registerBuiltInSrecLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `srec` library packages registered in `globalLibraryRegistry`.
 */
export function getSrecSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInSrecLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("srec")) {
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
        category: (meta["category"] as string) ?? "Record Types",
        domain: (meta["domain"] as string) ?? "firmware",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Motorola S-Record Specification",
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
 * Case-insensitive lookup of an SREC record type or Motorola memory map preset schema.
 */
export function lookupSrecModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getSrecSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
