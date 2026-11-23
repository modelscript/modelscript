// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  DYNAMO_STD_LIB_DIAGRAMS,
  DYNAMO_STD_LIB_PKG_JSON,
  DYNAMO_STD_LIB_SYMBOLS,
  getDynamoStdLibWasmBytes,
} from "./dynamo-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/dynamo-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInDynamoLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("dynamo").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(DYNAMO_STD_LIB_PKG_JSON, {
    symbols: DYNAMO_STD_LIB_SYMBOLS,
    diagrams: DYNAMO_STD_LIB_DIAGRAMS,
    wasmBytes: getDynamoStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/dynamo-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInDynamoLibraryRegistered(): void {
  registerBuiltInDynamoLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `dynamo` library packages registered in `globalLibraryRegistry`.
 */
export function getDynamoSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInDynamoLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("dynamo")) {
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
        category: (meta["category"] as string) ?? "Information & Material Delays",
        domain: (meta["domain"] as string) ?? "system-dynamics",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "Pugh DYNAMO User's Manual / Forrester Industrial Dynamics",
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
 * Case-insensitive lookup of a DYNAMO standard function schema by canonical name or alias.
 */
export function lookupDynamoFunctionSchema(fnName: string): CleanroomModelSchema | undefined {
  const key = fnName
    .trim()
    .replace(/^DYNAMO\./i, "")
    .toLowerCase();
  const schemas = getDynamoSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
