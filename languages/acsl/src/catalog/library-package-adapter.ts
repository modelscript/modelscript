// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  ACSL_STD_LIB_DIAGRAMS,
  ACSL_STD_LIB_PKG_JSON,
  ACSL_STD_LIB_SYMBOLS,
  getAcslStdLibWasmBytes,
} from "./acsl-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/acsl-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInAcslLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("acsl").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(ACSL_STD_LIB_PKG_JSON, {
    symbols: ACSL_STD_LIB_SYMBOLS,
    diagrams: ACSL_STD_LIB_DIAGRAMS,
    wasmBytes: getAcslStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/acsl-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInAcslLibraryRegistered(): void {
  registerBuiltInAcslLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `acsl` library packages registered in `globalLibraryRegistry`.
 */
export function getAcslSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInAcslLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("acsl")) {
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
        category: (meta["category"] as string) ?? "Continuous Dynamics",
        domain: (meta["domain"] as string) ?? "controls",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "ACSL Reference Manual (Mitchell & Gauthier, 1975)",
        symbolKind: sym.kind,
        width: diag?.width ?? 88,
        height: diag?.height ?? 52,
        svg: diag?.svg,
        ports: diag?.ports ?? [],
        parameters: Array.isArray(meta["parameters"]) ? (meta["parameters"] as CleanroomParameterSchema[]) : [],
        wasmKernel: typeof meta["wasmKernel"] === "string" ? meta["wasmKernel"] : undefined,
        extra:
          meta["archetypeId"] !== undefined || meta["signature"] !== undefined
            ? {
                ...(meta["archetypeId"] !== undefined ? { archetypeId: meta["archetypeId"] } : {}),
                ...(meta["signature"] !== undefined ? { signature: meta["signature"] } : {}),
              }
            : undefined,
      });
    }
  }
  return out;
}

/**
 * Case-insensitive lookup of an ACSL standard operator schema by canonical name, path, or alias.
 */
export function lookupAcslOperatorSchema(operatorName: string): CleanroomModelSchema | undefined {
  const key = operatorName
    .trim()
    .replace(/^ACSL\./i, "")
    .toLowerCase();
  const schemas = getAcslSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
