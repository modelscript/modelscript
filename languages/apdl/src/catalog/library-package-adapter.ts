// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  APDL_STD_LIB_DIAGRAMS,
  APDL_STD_LIB_PKG_JSON,
  APDL_STD_LIB_SYMBOLS,
  getApdlStdLibWasmBytes,
} from "./apdl-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/apdl-std-lib` bundle in `globalLibraryRegistry` (zero-I/O).
 */
export function registerBuiltInApdlLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("apdl").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(APDL_STD_LIB_PKG_JSON, {
    symbols: APDL_STD_LIB_SYMBOLS,
    diagrams: APDL_STD_LIB_DIAGRAMS,
    wasmBytes: getApdlStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/apdl-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInApdlLibraryRegistered(): void {
  registerBuiltInApdlLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `apdl` library packages registered in `globalLibraryRegistry`.
 */
export function getApdlSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInApdlLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("apdl")) {
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
        category: (meta["category"] as string) ?? "1D Truss / Beam",
        domain: (meta["domain"] as string) ?? "structural",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Cleanroom ANSYS APDL structural element",
        symbolKind: sym.kind,
        width: diag?.width ?? 80,
        height: diag?.height ?? 48,
        svg: diag?.svg,
        ports: diag?.ports ?? [],
        parameters: Array.isArray(meta["parameters"]) ? (meta["parameters"] as CleanroomParameterSchema[]) : [],
        wasmKernel: typeof meta["wasmKernel"] === "string" ? meta["wasmKernel"] : undefined,
        extra:
          meta["archetypeId"] !== undefined
            ? {
                archetypeId: meta["archetypeId"],
                dofs: meta["dofs"],
                nodeCount: meta["nodeCount"],
              }
            : undefined,
      });
    }
  }
  return out;
}

/**
 * Case-insensitive lookup of an APDL element schema by canonical name (e.g., `BEAM188`) or alias.
 */
export function lookupApdlElementSchema(elementType: string): CleanroomModelSchema | undefined {
  const key = elementType.trim().toLowerCase();
  const schemas = getApdlSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
