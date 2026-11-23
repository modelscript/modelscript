// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import type { CeaSpeciesData } from "../types.js";
import {
  CEA_STD_LIB_DIAGRAMS,
  CEA_STD_LIB_PKG_JSON,
  CEA_STD_LIB_SYMBOLS,
  getCeaStdLibWasmBytes,
} from "./cea-std-lib-data.js";
import { CEA_STD_SPECIES_DATA } from "./cea-std-schemas.js";

/**
 * Registers the built-in `@modelscript/cea-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInCeaLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("cea").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(CEA_STD_LIB_PKG_JSON, {
    symbols: CEA_STD_LIB_SYMBOLS,
    diagrams: CEA_STD_LIB_DIAGRAMS,
    wasmBytes: getCeaStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/cea-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInCeaLibraryRegistered(): void {
  registerBuiltInCeaLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `cea` library packages registered in `globalLibraryRegistry`.
 */
export function getCeaSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInCeaLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("cea")) {
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
        category: (meta["category"] as string) ?? "Combustion Product",
        domain: (meta["domain"] as string) ?? "thermochemistry",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "NASA RP-1311 / NIST-JANAF",
        symbolKind: sym.kind,
        width: diag?.width ?? 88,
        height: diag?.height ?? 52,
        svg: diag?.svg,
        ports: diag?.ports ?? [],
        parameters: Array.isArray(meta["parameters"]) ? (meta["parameters"] as CleanroomParameterSchema[]) : [],
        wasmKernel: typeof meta["wasmKernel"] === "string" ? meta["wasmKernel"] : undefined,
      });
    }
  }
  return out;
}

/**
 * Case-insensitive lookup of a NASA CEA species schema by canonical name or alias.
 */
export function lookupCeaSpeciesSchema(speciesName: string): CleanroomModelSchema | undefined {
  const key = speciesName.trim().toLowerCase();
  const schemas = getCeaSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}

export interface CeaWasmSpeciesEvalResult {
  cpOverR: number;
  hOverRT: number;
  sOverR: number;
  gOverRT: number;
  cpJMolK: number;
  hJMol: number;
  sJMolK: number;
  gJMol: number;
}

interface CeaWasmExports {
  memory: WebAssembly.Memory;
  evalSpeciesNasa7: (slotPtr: number, tempK: number) => number;
  evalNasa9CpOverR: (
    a1: number,
    a2: number,
    a3: number,
    a4: number,
    a5: number,
    a6: number,
    a7: number,
    tempK: number,
  ) => number;
}

let cachedWasmExports: CeaWasmExports | undefined;

function getCeaWasmExports(): CeaWasmExports {
  if (!cachedWasmExports) {
    const bytes = getCeaStdLibWasmBytes();
    const mod = new WebAssembly.Module(bytes as BufferSource);
    const inst = new WebAssembly.Instance(mod, {
      env: {
        abort: () => {
          throw new Error("CEA stdlib WASM abort");
        },
      },
    });
    cachedWasmExports = inst.exports as unknown as CeaWasmExports;
  }
  return cachedWasmExports;
}

/**
 * Evaluates a standard-library species' NASA-7 properties inside `cea-std-lib/dist/runtime.wasm`.
 */
export function evalCeaSpeciesInWasm(speciesName: string, temperatureK: number): CeaWasmSpeciesEvalResult {
  const key = speciesName.trim().toUpperCase();
  const sp: CeaSpeciesData | undefined = CEA_STD_SPECIES_DATA.find(
    (s) => s.name.toUpperCase() === key || s.aliases.some((a) => a.toUpperCase() === key),
  );
  if (!sp) {
    throw new Error(`Species '${speciesName}' not found in @modelscript/cea-std-lib`);
  }

  const exports = getCeaWasmExports();
  const slotPtr = 1024; // 8-byte aligned scratch slot in linear memory
  const f64 = new Float64Array(exports.memory.buffer, slotPtr, 32);
  f64[0] = sp.nasa7.tMid;
  for (let i = 0; i < 7; i++) {
    f64[1 + i] = sp.nasa7.low[i] ?? 0;
    f64[8 + i] = sp.nasa7.high[i] ?? 0;
  }
  f64[15] = sp.molarMassKgMol;
  f64[16] = temperatureK;

  exports.evalSpeciesNasa7(slotPtr, temperatureK);

  // OUT starts at byte offset 0x088 = 136 = index 17 in Float64Array
  return {
    cpOverR: f64[17]!,
    hOverRT: f64[18]!,
    sOverR: f64[19]!,
    gOverRT: f64[20]!,
    cpJMolK: f64[21]!,
    hJMol: f64[22]!,
    sJMolK: f64[23]!,
    gJMol: f64[24]!,
  };
}
