// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  ASN1_STD_LIB_DIAGRAMS,
  ASN1_STD_LIB_PKG_JSON,
  ASN1_STD_LIB_SYMBOLS,
  getAsn1StdLibWasmBytes,
} from "./asn1-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/asn1-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInAsn1LibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("asn1").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(ASN1_STD_LIB_PKG_JSON, {
    symbols: ASN1_STD_LIB_SYMBOLS,
    diagrams: ASN1_STD_LIB_DIAGRAMS,
    wasmBytes: getAsn1StdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/asn1-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInAsn1LibraryRegistered(): void {
  registerBuiltInAsn1LibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `asn1` library packages registered in `globalLibraryRegistry`.
 */
export function getAsn1SchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInAsn1LibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("asn1")) {
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
        category: (meta["category"] as string) ?? "X.680 Universal Tags",
        domain: (meta["domain"] as string) ?? "protocols",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "ISO/ITU-T X.680 / X.690",
        symbolKind: sym.kind,
        width: diag?.width ?? 96,
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
 * Case-insensitive lookup of an ASN.1 universal tag or protocol schema by name or alias.
 */
export function lookupAsn1ModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getAsn1SchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
