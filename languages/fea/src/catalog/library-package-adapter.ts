// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  FEA_STD_LIB_DIAGRAMS,
  FEA_STD_LIB_PKG_JSON,
  FEA_STD_LIB_SYMBOLS,
  getFeaStdLibWasmBytes,
} from "./fea-std-lib-data.js";

export function registerBuiltInFeaLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("fea").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(FEA_STD_LIB_PKG_JSON, {
    symbols: FEA_STD_LIB_SYMBOLS,
    diagrams: FEA_STD_LIB_DIAGRAMS,
    wasmBytes: getFeaStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/fea-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInFeaLibraryRegistered(): void {
  registerBuiltInFeaLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `fea` library packages registered in `globalLibraryRegistry`.
 */
export function getFeaSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInFeaLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("fea")) {
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
        category: (meta["category"] as string) ?? "Elastic Material",
        domain: (meta["domain"] as string) ?? "structural",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Zienkiewicz & Taylor / Bathe",
        symbolKind: sym.kind,
        width: diag?.width ?? 80,
        height: diag?.height ?? 48,
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
 * Case-insensitive lookup of an FEA element, section, or constitutive material schema by canonical name or alias.
 */
export function lookupFeaCardSchema(cardType: string): CleanroomModelSchema | undefined {
  const key = cardType.trim().toLowerCase();
  const schemas = getFeaSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
