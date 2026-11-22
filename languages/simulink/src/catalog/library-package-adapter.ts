// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  SIMULINK_STD_LIB_DIAGRAMS,
  SIMULINK_STD_LIB_PKG_JSON,
  SIMULINK_STD_LIB_SYMBOLS,
  getSimulinkStdLibWasmBytes,
} from "./simulink-std-lib-data.js";

/**
 * Synchronously registers the pre-bundled `@modelscript/simulink-std-lib` (schemas,
 * cleanroom SVG block icons, and `runtime.wasm`) in `globalLibraryRegistry` with
 * zero filesystem I/O — works identically in Browsers, Web Workers, and Node.js.
 */
export function registerBuiltInSimulinkLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("simulink").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(SIMULINK_STD_LIB_PKG_JSON, {
    symbols: SIMULINK_STD_LIB_SYMBOLS,
    diagrams: SIMULINK_STD_LIB_DIAGRAMS,
    wasmBytes: getSimulinkStdLibWasmBytes(),
  });
}

export function ensureBuiltInSimulinkLibraryRegistered(): void {
  registerBuiltInSimulinkLibrarySync();
}

export function getSimulinkSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInSimulinkLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("simulink")) {
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
        category: (meta["category"] as string) ?? "Continuous",
        domain: (meta["domain"] as string) ?? "control",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Classical Control Theory",
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

export function lookupSimulinkBlockSchema(blockType: string): CleanroomModelSchema | undefined {
  const key = blockType.trim().toLowerCase();
  const schemas = getSimulinkSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
