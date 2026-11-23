// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  OBJ_STD_LIB_DIAGRAMS,
  OBJ_STD_LIB_PKG_JSON,
  OBJ_STD_LIB_SYMBOLS,
  getObjStdLibWasmBytes,
} from "./obj-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/obj-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInObjLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("obj").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(OBJ_STD_LIB_PKG_JSON, {
    symbols: OBJ_STD_LIB_SYMBOLS,
    diagrams: OBJ_STD_LIB_DIAGRAMS,
    wasmBytes: getObjStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/obj-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInObjLibraryRegistered(): void {
  registerBuiltInObjLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `obj` library packages registered in `globalLibraryRegistry`.
 */
export function getObjSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInObjLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("obj")) {
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
        category: (meta["category"] as string) ?? "Geometry Primitives",
        domain: (meta["domain"] as string) ?? "cad",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Wavefront Technologies OBJ/MTL",
        symbolKind: sym.kind,
        width: diag?.width ?? 92,
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
 * Case-insensitive lookup of an OBJ primitive or MTL material schema by name or alias.
 */
export function lookupObjSchema(nameOrAlias: string): CleanroomModelSchema | undefined {
  const key = nameOrAlias.trim().toLowerCase();
  const schemas = getObjSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
