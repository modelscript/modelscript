// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  NMEA0183_STD_LIB_DIAGRAMS,
  NMEA0183_STD_LIB_PKG_JSON,
  NMEA0183_STD_LIB_SYMBOLS,
  getNmea0183StdLibWasmBytes,
} from "./nmea0183-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/nmea0183-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInNmea0183LibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("nmea0183").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(NMEA0183_STD_LIB_PKG_JSON, {
    symbols: NMEA0183_STD_LIB_SYMBOLS,
    diagrams: NMEA0183_STD_LIB_DIAGRAMS,
    wasmBytes: getNmea0183StdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/nmea0183-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInNmea0183LibraryRegistered(): void {
  registerBuiltInNmea0183LibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `nmea0183` library packages registered in `globalLibraryRegistry`.
 */
export function getNmea0183SchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInNmea0183LibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("nmea0183")) {
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
        category: (meta["category"] as string) ?? "GNSS Position & Fix",
        domain: (meta["domain"] as string) ?? "marine-navigation",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "NMEA 0183 v4.11 Standard Sentence",
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
 * Case-insensitive lookup of an NMEA 0183 sentence schema by formatter (`GGA`), address (`GPGGA`), or namePath.
 */
export function lookupNmea0183SentenceSchema(formatterOrAddress: string): CleanroomModelSchema | undefined {
  const key = formatterOrAddress.trim().replace(/^[$!]/, "").toLowerCase();
  const schemas = getNmea0183SchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  if (key.length === 5) {
    const fmt = key.slice(2);
    return schemas.find((s) => s.name.toLowerCase() === fmt);
  }
  return undefined;
}
