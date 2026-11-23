// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  buildStepFunction,
  parseFortranModule,
  type FortranModuleAst,
  type FortranStepFunction,
  type FortranUnitAst,
} from "@modelscript/fortran";
import {
  buildProjectModel,
  type ExternalDefinitions,
  type ModelDefinition,
  type PscadProjectModel,
} from "./pscad-model.js";

/**
 * Process-wide registry of PSCAD project sources known to the workspace (libraries, cases).
 *
 * Workspace indexers register every file they see; `parsePscx` then resolves
 * cross-file user definitions (e.g. `DC_EMT_lib:AC_Grid_Eq`) through `externalDefinitions`
 * without every caller having to thread a workspace object through.
 */
const sources = new Map<string, string>();
let byName: Map<string, PscadProjectModel> | undefined;

interface CompiledWorkspaceFortranUnit {
  unit: FortranUnitAst;
  moduleAst: FortranModuleAst;
  step: FortranStepFunction;
}

const fortranSources = new Map<string, string>();
let compiledFortranUnits: Map<string, CompiledWorkspaceFortranUnit> | undefined;

export function registerPscadSource(uri: string, text: string): void {
  if (sources.get(uri) === text) return;
  sources.set(uri, text);
  byName = undefined;
}

export function unregisterPscadSource(uri: string): void {
  if (sources.delete(uri)) byName = undefined;
}

export function clearPscadSources(): void {
  sources.clear();
  byName = undefined;
}

/** Registers a workspace Fortran (.f90/.f95/.f/.for) source file for PSCAD external subroutine/function resolution. */
export function registerPscadFortranSource(uri: string, text: string): void {
  if (fortranSources.get(uri) === text) return;
  fortranSources.set(uri, text);
  compiledFortranUnits = undefined;
}

/** Unregisters a previously registered workspace Fortran source file. */
export function unregisterPscadFortranSource(uri: string): void {
  if (fortranSources.delete(uri)) compiledFortranUnits = undefined;
}

/** Clears all registered workspace Fortran source files. */
export function clearPscadFortranSources(): void {
  fortranSources.clear();
  compiledFortranUnits = undefined;
}

function getCompiledFortranUnits(): Map<string, CompiledWorkspaceFortranUnit> {
  if (compiledFortranUnits) return compiledFortranUnits;
  const map = new Map<string, CompiledWorkspaceFortranUnit>();
  for (const text of fortranSources.values()) {
    try {
      const mod = parseFortranModule(text);
      for (const [upperName, unit] of mod.units.entries()) {
        if (unit.kind !== "subroutine" && unit.kind !== "function") continue;
        const mergedConstants = { ...mod.moduleConstants, ...unit.signature.constants };
        const step = buildStepFunction(unit.stmts, mergedConstants, unit.signature.arrays, mod);
        map.set(upperName.toUpperCase(), { unit, moduleAst: mod, step });
      }
    } catch {
      // Ignore unparseable Fortran sources; diagnostics are surfaced by the Fortran linter.
    }
  }
  compiledFortranUnits = map;
  return map;
}

/** Returns true if a subroutine or function with the given name is registered from workspace Fortran sources. */
export function hasRegisteredFortranUnit(subName: string): boolean {
  if (fortranSources.size === 0) return false;
  return getCompiledFortranUnits().has(subName.toUpperCase());
}

/**
 * Invokes a registered workspace Fortran SUBROUTINE or FUNCTION by name, passing positional
 * arguments by reference (mutating `args` in-place for INTENT(OUT)/INTENT(INOUT) parameters)
 * and returning the function result if the unit is a FUNCTION.
 */
export function invokeRegisteredFortranUnit(
  subName: string,
  args: number[],
  execCtx?: {
    time?: number | undefined;
    dt?: number | undefined;
    firstStep?: boolean | undefined;
    storf?: Float64Array | undefined;
    stori?: Int32Array | undefined;
  },
): number | undefined {
  if (fortranSources.size === 0) return undefined;
  const entry = getCompiledFortranUnits().get(subName.toUpperCase());
  if (!entry) return undefined;

  const { unit, step } = entry;
  const locals: Record<string, number | boolean | string> = {};
  const formalArgs = unit.signature.args;
  for (let i = 0; i < formalArgs.length; i++) {
    const param = formalArgs[i]!;
    const val = i < args.length ? args[i]! : 0;
    locals[param] = val;
    locals[param.toLowerCase()] = val;
    locals[param.toUpperCase()] = val;
  }

  step({
    locals,
    time: execCtx?.time ?? 0,
    dt: execCtx?.dt ?? 50e-6,
    firstStep: execCtx?.firstStep ?? false,
    storf: execCtx?.storf,
    stori: execCtx?.stori,
    invokeExternalSubroutine: (nestedName, nestedArgs) => invokeRegisteredFortranUnit(nestedName, nestedArgs, execCtx),
  });

  // Propagate modified formal parameters back to caller arguments (pass-by-reference semantics)
  for (let i = 0; i < formalArgs.length && i < args.length; i++) {
    const param = formalArgs[i]!;
    const candidates = [locals[param], locals[param.toLowerCase()], locals[param.toUpperCase()]];
    const orig = args[i]!;
    for (const c of candidates) {
      if (typeof c === "number" && c !== orig) {
        args[i] = c;
        break;
      }
    }
  }

  if (unit.kind === "function") {
    const retName = unit.returnVar ?? unit.signature.returnVar ?? unit.name;
    const retVal = locals[retName] ?? locals[retName.toLowerCase()] ?? locals[retName.toUpperCase()];
    return typeof retVal === "number" ? retVal : Number(retVal ?? 0);
  }
  return 0;
}

/**
 * Tries to discover and register a local master.pslx if present in standard locations.
 */
function tryAutoDiscoverMaster(): void {
  if (typeof process === "undefined" || !process.env) return;
  try {
    const nodeFs =
      typeof (process as { getBuiltinModule?: (m: string) => typeof import("node:fs") }).getBuiltinModule === "function"
        ? (process as { getBuiltinModule: (m: string) => typeof import("node:fs") }).getBuiltinModule("node:fs")
        : undefined;
    if (!nodeFs) return;
    const candidates = [
      process.env["PSCAD_MASTER_LIB_PATH"],
      "master.pslx",
      ".pscad/master.pslx",
      ".cache/pscad-corpus/master.pslx",
      ".cache/pscad-corpus/DC-EMT_v0/master.pslx",
    ].filter((p): p is string => typeof p === "string" && p.length > 0);

    for (const cand of candidates) {
      if (nodeFs.existsSync(cand)) {
        const text = nodeFs.readFileSync(cand, "utf-8");
        registerPscadSource("file:///master.pslx", text);
        break;
      }
    }
  } catch {
    // Environment does not support synchronous fs lookup; ignore
  }
}

/** Registers a master library text (e.g. from user-provided master.pslx). */
export function registerMasterLibrary(text: string): void {
  registerPscadSource("file:///master.pslx", text);
}

/** Returns the registered master library project model if one is registered or discovered. */
export function getRegisteredMasterProject(): PscadProjectModel | undefined {
  return projects().get("master") ?? projects().get("Master");
}

function projects(): Map<string, PscadProjectModel> {
  if (byName) return byName;
  if (!sources.has("file:///master.pslx")) {
    tryAutoDiscoverMaster();
  }
  const map = new Map<string, PscadProjectModel>();
  for (const [uri, text] of sources.entries()) {
    try {
      const m = buildProjectModel(text);
      if (m.name) {
        if (!map.has(m.name)) map.set(m.name, m);
        const lower = m.name.toLowerCase();
        if (!map.has(lower)) map.set(lower, m);
      }
      if (uri.toLowerCase().endsWith("master.pslx")) {
        if (!map.has("master")) map.set("master", m);
      }
    } catch {
      // Unparseable sources simply do not contribute definitions.
    }
  }
  byName = map;
  return map;
}

/** Lookup suitable for `buildProjectModel`/`parsePscx`; `undefined` when nothing is registered. */
export function registeredExternalDefinitions(): ExternalDefinitions | undefined {
  if (sources.size === 0) {
    tryAutoDiscoverMaster();
  }
  if (sources.size === 0) return undefined;
  return (lib: string, name: string): ModelDefinition | undefined => {
    const p = projects();
    return p.get(lib)?.definitions.get(name) ?? p.get(lib.toLowerCase())?.definitions.get(name);
  };
}

/** Raw texts of every registered source (used to resolve cross-file schematic modules). */
export function registeredPscadSourceTexts(): string[] {
  return [...sources.values()];
}
