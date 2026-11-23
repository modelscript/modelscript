// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  PLOT3D_STD_LIB_DIAGRAMS,
  PLOT3D_STD_LIB_PKG_JSON,
  PLOT3D_STD_LIB_SYMBOLS,
  getPlot3dStdLibWasmBytes,
} from "./plot3d-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/plot3d-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInPlot3dLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("plot3d").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(PLOT3D_STD_LIB_PKG_JSON, {
    symbols: PLOT3D_STD_LIB_SYMBOLS,
    diagrams: PLOT3D_STD_LIB_DIAGRAMS,
    wasmBytes: getPlot3dStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/plot3d-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInPlot3dLibraryRegistered(): void {
  registerBuiltInPlot3dLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `plot3d` library packages registered in `globalLibraryRegistry`.
 */
export function getPlot3dSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInPlot3dLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("plot3d")) {
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
        category: (meta["category"] as string) ?? "Structured Grids",
        domain: (meta["domain"] as string) ?? "cfd",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "NASA TM-101067 PLOT3D",
        symbolKind: sym.kind,
        width: diag?.width ?? 96,
        height: diag?.height ?? 54,
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
 * Case-insensitive lookup of a PLOT3D standard library schema by canonical name, path, or alias.
 */
export function lookupPlot3dModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getPlot3dSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
