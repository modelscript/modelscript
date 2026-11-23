// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  SDL_STD_LIB_DIAGRAMS,
  SDL_STD_LIB_PKG_JSON,
  SDL_STD_LIB_SYMBOLS,
  getSdlStdLibWasmBytes,
} from "./sdl-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/sdl-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInSdlLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("sdl").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(SDL_STD_LIB_PKG_JSON, {
    symbols: SDL_STD_LIB_SYMBOLS,
    diagrams: SDL_STD_LIB_DIAGRAMS,
    wasmBytes: getSdlStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/sdl-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInSdlLibraryRegistered(): void {
  registerBuiltInSdlLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `sdl` library packages registered in `globalLibraryRegistry`.
 */
export function getSdlSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInSdlLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("sdl")) {
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
        category: (meta["category"] as string) ?? "Telecom Protocol Blocks",
        domain: (meta["domain"] as string) ?? "telecom",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "ITU-T Recommendation Z.100 (1988)",
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
 * Case-insensitive lookup of an SDL-88 predefined sort or telecom protocol block schema by name or alias.
 */
export function lookupSdlModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType.trim().toLowerCase();
  const schemas = getSdlSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
