// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  SLAM_STD_LIB_DIAGRAMS,
  SLAM_STD_LIB_PKG_JSON,
  SLAM_STD_LIB_SYMBOLS,
  getSlamStdLibWasmBytes,
} from "./slam-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/slam-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInSlamLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("slam").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(SLAM_STD_LIB_PKG_JSON, {
    symbols: SLAM_STD_LIB_SYMBOLS,
    diagrams: SLAM_STD_LIB_DIAGRAMS,
    wasmBytes: getSlamStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/slam-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInSlamLibraryRegistered(): void {
  registerBuiltInSlamLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `slam` library packages registered in `globalLibraryRegistry`.
 */
export function getSlamSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInSlamLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("slam")) {
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
        category: (meta["category"] as string) ?? "Entity Flow",
        domain: (meta["domain"] as string) ?? "systems",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Pritsker & Pegden (1979)",
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
 * Case-insensitive lookup of a SLAM II block schema by canonical name, `SLAM.` prefix, or alias.
 */
export function lookupSlamModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType
    .trim()
    .replace(/^SLAM\./i, "")
    .toLowerCase();
  const schemas = getSlamSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
