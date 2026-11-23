// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  HEC1_STD_LIB_DIAGRAMS,
  HEC1_STD_LIB_PKG_JSON,
  HEC1_STD_LIB_SYMBOLS,
  getHec1StdLibWasmBytes,
} from "./hec1-std-lib-data.js";

export interface Hec1StdLibWasmExports {
  scsExcessRunoff(p: number, cn: number, iaOverride: number, metric: number): number;
  muskingumStep(iCurr: number, iPrev: number, oPrev: number, kSub: number, x: number, dt: number): number;
  clarkReservoirStep(inflow: number, oPrev: number, r: number, dt: number): number;
  snyderPeakDischarge(area: number, tp: number, cp: number, metric: number): number;
}

let cachedWasmExports: Hec1StdLibWasmExports | undefined;

/**
 * Registers the built-in `@modelscript/hec1-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInHec1LibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("hec1").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(HEC1_STD_LIB_PKG_JSON, {
    symbols: HEC1_STD_LIB_SYMBOLS,
    diagrams: HEC1_STD_LIB_DIAGRAMS,
    wasmBytes: getHec1StdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/hec1-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInHec1LibraryRegistered(): void {
  registerBuiltInHec1LibrarySync();
}

/**
 * Synchronously instantiates the cleanroom HEC-1 AssemblyScript WASM runtime.
 */
export function getHec1StdLibWasmRuntime(): Hec1StdLibWasmExports {
  if (cachedWasmExports) return cachedWasmExports;
  const bytes = getHec1StdLibWasmBytes();
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const mod = new WebAssembly.Module(buf);
  const inst = new WebAssembly.Instance(mod, {});
  cachedWasmExports = inst.exports as unknown as Hec1StdLibWasmExports;
  return cachedWasmExports;
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `hec1` library packages registered in `globalLibraryRegistry`.
 */
export function getHec1SchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInHec1LibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("hec1")) {
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
        category: (meta["category"] as string) ?? "Unit Hydrograph",
        domain: (meta["domain"] as string) ?? "hydrology",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "USACE HEC-1 (1968) / USDA TR-55",
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
 * Case-insensitive lookup of a HEC-1 cleanroom model schema by canonical name, path, or alias.
 */
export function lookupHec1ModelSchema(modelType: string): CleanroomModelSchema | undefined {
  const key = modelType
    .trim()
    .replace(/^HEC1\./i, "")
    .toLowerCase();
  const schemas = getHec1SchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}
