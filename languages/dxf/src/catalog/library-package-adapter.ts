// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  DXF_STD_LIB_DIAGRAMS,
  DXF_STD_LIB_PKG_JSON,
  DXF_STD_LIB_SYMBOLS,
  getDxfStdLibWasmBytes,
} from "./dxf-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/dxf-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInDxfLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("dxf").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(DXF_STD_LIB_PKG_JSON, {
    symbols: DXF_STD_LIB_SYMBOLS,
    diagrams: DXF_STD_LIB_DIAGRAMS,
    wasmBytes: getDxfStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/dxf-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInDxfLibraryRegistered(): void {
  registerBuiltInDxfLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `dxf` library packages registered in `globalLibraryRegistry`.
 */
export function getDxfSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInDxfLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("dxf")) {
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
        category: (meta["category"] as string) ?? "2D Primitives",
        domain: (meta["domain"] as string) ?? "cad",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Autodesk DXF Reference (1982–2024)",
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
 * Case-insensitive lookup of a DXF entity schema by canonical name, path (`DXF.LINE`), or alias.
 */
export function lookupDxfEntitySchema(entityType: string): CleanroomModelSchema | undefined {
  const key = entityType
    .trim()
    .replace(/^DXF\./i, "")
    .toLowerCase();
  const schemas = getDxfSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
