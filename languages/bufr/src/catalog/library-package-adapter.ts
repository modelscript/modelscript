// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  BUFR_STD_LIB_DIAGRAMS,
  BUFR_STD_LIB_PKG_JSON,
  BUFR_STD_LIB_SYMBOLS,
  getBufrStdLibWasmBytes,
} from "./bufr-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/bufr-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInBufrLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("bufr").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(BUFR_STD_LIB_PKG_JSON, {
    symbols: BUFR_STD_LIB_SYMBOLS,
    diagrams: BUFR_STD_LIB_DIAGRAMS,
    wasmBytes: getBufrStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/bufr-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInBufrLibraryRegistered(): void {
  registerBuiltInBufrLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `bufr` library packages registered in `globalLibraryRegistry`.
 */
export function getBufrSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInBufrLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("bufr")) {
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
        category: (meta["category"] as string) ?? "Thermodynamics & Moisture",
        domain: (meta["domain"] as string) ?? "meteorology",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "WMO-No. 306 FM 94 BUFR",
        symbolKind: sym.kind,
        width: diag?.width ?? 96,
        height: diag?.height ?? 56,
        svg: diag?.svg,
        ports: diag?.ports ?? [],
        parameters: Array.isArray(meta["parameters"]) ? (meta["parameters"] as CleanroomParameterSchema[]) : [],
        wasmKernel: typeof meta["wasmKernel"] === "string" ? meta["wasmKernel"] : undefined,
        extra:
          meta["archetypeId"] !== undefined || meta["descriptor"] !== undefined
            ? { archetypeId: meta["archetypeId"], descriptor: meta["descriptor"] }
            : undefined,
      });
    }
  }
  return out;
}

/**
 * Case-insensitive lookup of a BUFR meteorological descriptor schema by descriptor code, name, or alias.
 */
export function lookupBufrModelSchema(keyOrDescriptor: string): CleanroomModelSchema | undefined {
  const key = keyOrDescriptor.trim().toLowerCase();
  const schemas = getBufrSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
    const desc = s.extra?.["descriptor"];
    if (typeof desc === "string" && desc.toLowerCase() === key) return s;
  }
  return undefined;
}
