// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  POWERWORLD_STD_LIB_DIAGRAMS,
  POWERWORLD_STD_LIB_PKG_JSON,
  POWERWORLD_STD_LIB_SYMBOLS,
  getPowerWorldStdLibWasmBytes,
} from "./powerworld-std-lib-data.js";

export function registerBuiltInPowerWorldLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("powerworld").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(POWERWORLD_STD_LIB_PKG_JSON, {
    symbols: POWERWORLD_STD_LIB_SYMBOLS,
    diagrams: POWERWORLD_STD_LIB_DIAGRAMS,
    wasmBytes: getPowerWorldStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/powerworld-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInPowerWorldLibraryRegistered(): void {
  registerBuiltInPowerWorldLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `powerworld` library packages registered in `globalLibraryRegistry`.
 */
export function getPowerWorldSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInPowerWorldLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("powerworld")) {
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
        category: (meta["category"] as string) ?? "Generator",
        domain: (meta["domain"] as string) ?? "electrical",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "IEEE / WECC Standard",
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
 * Case-insensitive lookup of a PowerWorld dynamic model schema by canonical name or alias.
 */
export function lookupPowerWorldModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getPowerWorldSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
