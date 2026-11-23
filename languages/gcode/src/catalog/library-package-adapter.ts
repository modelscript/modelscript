// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalLibraryRegistry,
  type CleanroomModelSchema,
  type CleanroomParameterSchema,
  type DiagramComponentSpec,
} from "@modelscript/runtime";
import {
  GCODE_STD_LIB_DIAGRAMS,
  GCODE_STD_LIB_PKG_JSON,
  GCODE_STD_LIB_SYMBOLS,
  getGCodeStdLibWasmBytes,
} from "./gcode-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/gcode-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInGCodeLibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("gcode").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(GCODE_STD_LIB_PKG_JSON, {
    symbols: GCODE_STD_LIB_SYMBOLS,
    diagrams: GCODE_STD_LIB_DIAGRAMS,
    wasmBytes: getGCodeStdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/gcode-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInGCodeLibraryRegistered(): void {
  registerBuiltInGCodeLibrarySync();
}

/**
 * Reconstructs `CleanroomModelSchema[]` from all `gcode` library packages registered in `globalLibraryRegistry`.
 */
export function getGCodeSchemasFromLibraries(): CleanroomModelSchema[] {
  ensureBuiltInGCodeLibraryRegistered();
  const out: CleanroomModelSchema[] = [];
  for (const pkg of globalLibraryRegistry.getPackagesForLanguage("gcode")) {
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
        category: (meta["category"] as string) ?? "Motion Control",
        domain: (meta["domain"] as string) ?? "manufacturing",
        description: (meta["description"] as string) ?? "",
        provenance: (meta["provenance"] as string) ?? "ISO 6983-1 / EIA RS-274-D",
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
 * Case-insensitive lookup of a G-code or cutting tool preset schema by canonical code or alias.
 */
export function lookupGCodeSchema(codeOrAlias: string): CleanroomModelSchema | undefined {
  const key = codeOrAlias
    .trim()
    .replace(/^gcode\./i, "")
    .toLowerCase();
  const schemas = getGCodeSchemasFromLibraries();
  for (const s of schemas) {
    if (s.name.toLowerCase() === key || s.namePath.toLowerCase() === key) return s;
    if (s.aliases?.some((a) => a.toLowerCase() === key)) return s;
  }
  return undefined;
}

export interface GCodeWasmStepOutput {
  pathLengthMm: number;
  cycleTimeSec: number;
  spindleRpm: number;
  feedrateMmPerMin: number;
  mrrMm3PerSec: number;
  cuttingPowerW: number;
  spindleTorqueNm: number;
  peckCount: number;
}

export interface GCodeWasmInstance {
  schema: CleanroomModelSchema;
  archetypeId: number;
  step(params?: number[], dt?: number): GCodeWasmStepOutput;
}

/**
 * Instantiates a cleanroom G-code/tool-preset model from `@modelscript/gcode-std-lib`'s `runtime.wasm`.
 */
export function instantiateGCodeWasmModel(codeOrAlias: string): GCodeWasmInstance | undefined {
  const schema = lookupGCodeSchema(codeOrAlias);
  if (!schema) return undefined;
  const archetypeId = Number((schema.extra as Record<string, unknown> | undefined)?.["archetypeId"] ?? 0);
  if (!archetypeId) return undefined;

  const wasmBytes = getGCodeStdLibWasmBytes();
  const mod = new WebAssembly.Module(wasmBytes as unknown as BufferSource);
  const inst = new WebAssembly.Instance(mod, {});
  const exports = inst.exports as {
    memory: WebAssembly.Memory;
    gcodeModelInit: (arch: number, slotPtr: number, conCount: number) => void;
    gcodeModelStep: (arch: number, t: number, dt: number, slotPtr: number, conCount: number) => void;
  };

  // Reserve a 2048-byte aligned slot near the top of linear memory (page 0 offset 4096)
  const slotPtr = 4096;
  if (exports.memory.buffer.byteLength < slotPtr + 2048) {
    exports.memory.grow(1);
  }
  const defaults = schema.parameters.map((p) => (typeof p.defaultValue === "number" ? p.defaultValue : 0));

  const writeCon = (values: number[]): number => {
    const view = new Float64Array(exports.memory.buffer, slotPtr + 0x080, 160);
    for (let i = 0; i < values.length && i < 160; i++) {
      view[i] = values[i] ?? 0;
    }
    return values.length;
  };

  const conCount = writeCon(defaults);
  exports.gcodeModelInit(archetypeId, slotPtr, conCount);

  return {
    schema,
    archetypeId,
    step(params?: number[], dt = 0): GCodeWasmStepOutput {
      const n = params ? writeCon(params) : conCount;
      exports.gcodeModelStep(archetypeId, 0, dt, slotPtr, n);
      const io = new Float64Array(exports.memory.buffer, slotPtr + 0x780, 8);
      return {
        pathLengthMm: io[0] ?? 0,
        cycleTimeSec: io[1] ?? 0,
        spindleRpm: io[2] ?? 0,
        feedrateMmPerMin: io[3] ?? 0,
        mrrMm3PerSec: io[4] ?? 0,
        cuttingPowerW: io[5] ?? 0,
        spindleTorqueNm: io[6] ?? 0,
        peckCount: io[7] ?? 0,
      };
    },
  };
}
