// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Polyglot Co-Simulation Runner for Modelica <-> PSCAD <-> PSS/E.
 *
 * Detects direct name-based cross-language references in UnifiedWorkspace and
 * coordinates Dommel EMT leaf/island solvers (`EmtSolver`, `WasmEmtBridge`,
 * `FmiLsEmtCompanionInstance`) with outer DAE/ODE (`DAEBuilder` + `simulateArena`)
 * and positive-sequence Transient Stability (`HybridEmtTsCoordinator`).
 */

import type { FmiLsEmtCompanionInstance } from "@modelscript/exchange";
import { Context as ModelicaContext } from "@modelscript/modelica";
import type { PsseCase } from "@modelscript/psse";
import {
  initBltWasm,
  type DAEBuilder,
  type SymbolEntry,
  type SymbolIndex,
  type UnifiedWorkspace,
} from "@modelscript/runtime";
import {
  HybridEmtTsCoordinator,
  MultiRateCosimOrchestrator,
  WasmEmtBridge,
  simulateArena,
  type HybridBoundaryPortConfig,
  type SlowSystemStepFn,
  type TsBranchSpec,
  type TsBusSpec,
  type TsGeneratorSpec,
} from "@modelscript/simulate";
import { BrowserFileSystem } from "../vfs/browser-file-system.js";

export interface PolyglotSimResponse {
  t: number[];
  y: number[][];
  states: string[];
  experiment: { startTime: number; stopTime: number; interval: number; tolerance: number };
  telemetry: { executionTimeMs: number; stepCount: number; mode: string };
  error?: string | undefined;
}

export interface ModelicaEmtCompanionOptions {
  /** Number of electrical phases (1 or 3). Default: 3. */
  phases?: number | undefined;
  /** Norton equivalent conductance (S) per phase. Default: 1e-3 S. */
  conductanceSiemens?: number | undefined;
  /** Optional input variable names in the Modelica DAE receiving terminal voltages. */
  voltageInputVars?: string[] | undefined;
  /** Optional output variable names in the Modelica DAE providing current injections (A). */
  currentOutputVars?: string[] | undefined;
}

/**
 * Wraps a compiled Modelica `DAEBuilder` as an `fmi-ls-emt` Norton-companion leaf
 * (`FmiLsEmtCompanionInstance`) so `EmtSolver` can stamp it directly into the Dommel
 * nodal matrix at each microsecond sub-step without 1-step co-simulation delay.
 */
export function createModelicaEmtCompanion(
  dae: DAEBuilder,
  options: ModelicaEmtCompanionOptions = {},
): FmiLsEmtCompanionInstance {
  const phases = Math.max(1, options.phases ?? 3);
  const gBase = options.conductanceSiemens ?? 1e-3;
  const vVars = options.voltageInputVars ?? ["v_a", "v_b", "v_c"].slice(0, phases);
  const iVars = options.currentOutputVars ?? ["i_a", "i_b", "i_c"].slice(0, phases);

  const gEq = new Float64Array(phases * phases);
  for (let p = 0; p < phases; p++) {
    gEq[p * phases + p] = gBase;
  }
  const iHist = new Float64Array(phases);
  const stateOverrides = new Map<string, number>();

  return {
    stampCompanion(_tSec: number, _dtSec: number) {
      return { gEq, iHist };
    },
    doStep(tSec: number, dtSec: number, vNode: ArrayLike<number>) {
      const overrides = new Map<string, number>(stateOverrides);
      for (let p = 0; p < phases; p++) {
        const vName = vVars[p];
        if (vName) overrides.set(vName, Number(vNode[p] ?? 0));
      }
      try {
        const res = simulateArena(dae, {
          startTime: tSec,
          stopTime: tSec + dtSec,
          step: dtSec,
          solver: "rk4",
          parameterOverrides: overrides,
        });
        const lastRow = res.y[res.y.length - 1];
        if (lastRow) {
          for (let si = 0; si < res.states.length; si++) {
            const sName = res.states[si]!;
            const val = lastRow[si];
            if (typeof val === "number" && Number.isFinite(val)) {
              stateOverrides.set(sName, val);
            }
          }
          for (let p = 0; p < phases; p++) {
            const iName = iVars[p];
            const idx = iName ? res.states.indexOf(iName) : -1;
            const iVal = idx >= 0 ? (lastRow[idx] ?? 0) : 0;
            const vVal = Number(vNode[p] ?? 0);
            iHist[p] = iVal - gBase * vVal;
          }
        }
      } catch {
        // Keep previous history current if DAE step encounters a transient discontinuity
      }
    },
  };
}

/**
 * Wraps a compiled Modelica `DAEBuilder` as a `SlowSystemStepFn` for `MultiRateCosimOrchestrator`
 * (or macro-step supervisory control in `HybridEmtTsCoordinator`).
 */
export function createModelicaSlowStepFn(dae: DAEBuilder): SlowSystemStepFn {
  const carryState = new Map<string, number>();
  let prevTime = 0;

  return (timeSec, inputs) => {
    const dt = Math.max(1e-6, timeSec - prevTime);
    prevTime = timeSec;
    const overrides = new Map<string, number>(carryState);
    overrides.set("vRms", inputs.vRms);
    overrides.set("V_rms", inputs.vRms);
    overrides.set("Vt_in", inputs.vRms);
    overrides.set("iRms", inputs.iRms);
    overrides.set("I_rms", inputs.iRms);
    overrides.set("pMw", inputs.pMw);
    overrides.set("P_mw", inputs.pMw);
    overrides.set("qMvar", inputs.qMvar);
    overrides.set("Q_mvar", inputs.qMvar);

    const outputs: Record<string, number> = {};
    try {
      const res = simulateArena(dae, {
        startTime: timeSec,
        stopTime: timeSec + dt,
        step: dt,
        solver: "rk4",
        parameterOverrides: overrides,
      });
      const lastRow = res.y[res.y.length - 1];
      if (lastRow) {
        for (let si = 0; si < res.states.length; si++) {
          const name = res.states[si]!;
          const val = lastRow[si];
          if (typeof val === "number" && Number.isFinite(val)) {
            carryState.set(name, val);
            outputs[name] = val;
          }
        }
      }
    } catch (err) {
      console.error("[polyglot-cosim] createModelicaSlowStepFn error:", err);
      for (const [k, v] of carryState) outputs[k] = v;
    }
    return outputs;
  };
}

export interface PolyglotPlan {
  kind: "modelica-pscad" | "psse-pscad" | "psse-pscad-modelica";
  referencedPscadSymbols: string[];
  referencedModelicaSymbols: string[];
  referencedPsseSymbols: string[];
  pscadUri?: string | undefined;
  psseUri?: string | undefined;
  modelicaUri?: string | undefined;
}

function inferSymbolLang(sym: SymbolEntry | undefined): string {
  const metaLang = typeof sym?.metadata?.["language"] === "string" ? sym.metadata["language"] : undefined;
  if (metaLang) return metaLang.toLowerCase();
  const res = (sym?.resourceId ?? "").toLowerCase();
  if (res.endsWith(".mo")) return "modelica";
  if (res.endsWith(".pscx") || res.endsWith(".pslx") || res.includes("pscad")) return "pscad";
  if (res.endsWith(".raw") || res.endsWith(".dyr") || res.includes("psse")) return "psse";
  const rule = (sym?.ruleName ?? "").toLowerCase();
  if (rule.startsWith("pscad")) return "pscad";
  if (rule.startsWith("psse")) return "psse";
  return "";
}

function findSymbolByQualifiedName(index: SymbolIndex, fqn: string): SymbolEntry | undefined {
  const parts = fqn.split(/[.:/]+/).filter(Boolean);
  const leaf = parts[parts.length - 1];
  if (!leaf) return undefined;
  const candidates = index.byName.get(leaf) ?? [];
  for (const id of candidates) {
    const entry = index.symbols.get(id);
    if (!entry) continue;
    if (parts.length === 1) return entry;
    // Verify parent chain suffix
    const chain: string[] = [entry.name];
    let cur = entry;
    while (cur.parentId != null) {
      const p = index.symbols.get(cur.parentId);
      if (!p) break;
      chain.unshift(p.name);
      cur = p;
    }
    if (chain.join(".").endsWith(parts.join("."))) {
      return entry;
    }
  }
  return undefined;
}

export interface PolyglotBoundaryBindings {
  boundaryBusNumber?: number | undefined;
  signalBindings: Array<{ modelicaVar: string; pscadSignal: string }>;
}

/**
 * Extracts explicit boundary bus numbers and signal bindings from Modelica `connect(a, b)`
 * equations and `.pscx` wire/component references.
 */
export function extractPolyglotBoundaryBindings(
  modelicaText?: string | undefined,
  psseCase?: PsseCase | undefined,
): PolyglotBoundaryBindings {
  const signalBindings: Array<{ modelicaVar: string; pscadSignal: string }> = [];
  let boundaryBusNumber: number | undefined;

  if (modelicaText) {
    // Map component instance names to their declared types
    const instanceTypes = new Map<string, string>();
    const declRe = /^\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+([A-Za-z_]\w*)\s*(?:\(|;|\[)/gm;
    let dm: RegExpExecArray | null;
    while ((dm = declRe.exec(modelicaText)) !== null) {
      instanceTypes.set(dm[2]!, dm[1]!);
    }

    const connectRe = /\bconnect\s*\(\s*([^,\s)]+)\s*,\s*([^,\s)]+)\s*\)\s*;/g;
    let cm: RegExpExecArray | null;
    while ((cm = connectRe.exec(modelicaText)) !== null) {
      const lhs = cm[1]!;
      const rhs = cm[2]!;
      const lhsComp = lhs.split(".")[0]!;
      const rhsComp = rhs.split(".")[0]!;
      const lhsType = instanceTypes.get(lhsComp) ?? "";
      const rhsType = instanceTypes.get(rhsComp) ?? "";

      // Detect PSS/E bus number from Bus_<N> type or instance name
      const busMatch =
        /\bBus_(\d+)\b/.exec(lhsType) ??
        /\bBus_(\d+)\b/.exec(rhsType) ??
        /\bBus_(\d+)\b/.exec(lhsComp) ??
        /\bBus_(\d+)\b/.exec(rhsComp);
      if (busMatch && boundaryBusNumber === undefined) {
        const busNum = Number.parseInt(busMatch[1]!, 10);
        if (!psseCase || psseCase.buses.has(busNum)) {
          boundaryBusNumber = busNum;
        }
      }

      // Detect Modelica <-> PSCAD signal pair
      const lhsIsPscad = lhsType.startsWith("PSCAD.") || lhsComp.toLowerCase().includes("pscad");
      const rhsIsPscad = rhsType.startsWith("PSCAD.") || rhsComp.toLowerCase().includes("pscad");
      if (lhsIsPscad && !rhsIsPscad) {
        signalBindings.push({ modelicaVar: rhs, pscadSignal: lhs });
      } else if (rhsIsPscad && !lhsIsPscad) {
        signalBindings.push({ modelicaVar: lhs, pscadSignal: rhs });
      }
    }
  }

  return { boundaryBusNumber, signalBindings };
}

/**
 * Inspects the active document and `UnifiedWorkspace` for direct name-based cross-language
 * references between Modelica, PSCAD, and PSS/E (without any black-box / `@twin` annotations).
 */
export function detectPolyglotPlan(
  unifiedWs: UnifiedWorkspace | undefined,
  uri: string,
  text: string,
): PolyglotPlan | null {
  if (!unifiedWs) return null;
  const index = unifiedWs.getIndex();
  const isPscad = /\.(pscx|pslx|pswx|psmx)($|\?|#)/i.test(uri);
  const isPsse = /\.(raw|dyr|sav|psse)($|\?|#)/i.test(uri);
  const isModelica = /\.mo($|\?|#)/i.test(uri);

  const referencedPscadSymbols: string[] = [];
  const referencedModelicaSymbols: string[] = [];
  const referencedPsseSymbols: string[] = [];

  let pscadUri: string | undefined = isPscad ? uri : undefined;
  let psseUri: string | undefined = isPsse ? uri : undefined;
  let modelicaUri: string | undefined = isModelica ? uri : undefined;

  if (isModelica) {
    // Scan component type references in Modelica source (e.g., `PSCAD.VoltageSource v1;`, `Microgrid.IbrInverter inv;`)
    const typeRefRe = /^\s*(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+[A-Za-z_]\w*\s*(?:\(|;|\[)/gm;
    let m: RegExpExecArray | null;
    while ((m = typeRefRe.exec(text)) !== null) {
      const candidate = m[0]!.trim().split(/\s+/)[0]!;
      if (
        candidate === "model" ||
        candidate === "Real" ||
        candidate === "Integer" ||
        candidate === "Boolean" ||
        candidate === "String" ||
        candidate === "parameter" ||
        candidate === "constant" ||
        candidate === "input" ||
        candidate === "output" ||
        candidate === "import" ||
        candidate === "extends" ||
        candidate === "equation"
      ) {
        continue;
      }
      const sym = findSymbolByQualifiedName(index, candidate);
      const lang = inferSymbolLang(sym);
      if (lang === "pscad" || candidate.startsWith("PSCAD.")) {
        referencedPscadSymbols.push(candidate);
        if (sym?.resourceId && /\.(pscx|pslx)$/i.test(sym.resourceId)) {
          pscadUri = sym.resourceId;
        }
      } else if (lang === "psse" && !candidate.startsWith("PSSEDynamics.")) {
        referencedPsseSymbols.push(candidate);
        if (sym?.resourceId && /\.(raw|dyr)$/i.test(sym.resourceId)) {
          psseUri = sym.resourceId;
        }
      }
    }
  } else if (isPscad) {
    // Scan `<User ... defn="...">` attributes for direct foreign Modelica / PSS/E references
    const defnRe = /\bdefn="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = defnRe.exec(text)) !== null) {
      const defn = m[1]!;
      if (defn.includes(":")) continue; // local or master:lib reference
      const sym = findSymbolByQualifiedName(index, defn);
      const lang = inferSymbolLang(sym);
      if (lang === "modelica") {
        referencedModelicaSymbols.push(defn);
        if (sym?.resourceId?.endsWith(".mo")) modelicaUri = sym.resourceId;
      } else if (lang === "psse") {
        referencedPsseSymbols.push(defn);
        if (sym?.resourceId && /\.(raw|dyr)$/i.test(sym.resourceId)) psseUri = sym.resourceId;
      }
    }
  }

  // Also check if workspace has companion `.raw` + `.pscx` when running from `.mo` or `.pscx`
  if (referencedPscadSymbols.length > 0 && (referencedPsseSymbols.length > 0 || psseUri)) {
    return {
      kind: "psse-pscad-modelica",
      referencedPscadSymbols,
      referencedModelicaSymbols,
      referencedPsseSymbols,
      pscadUri,
      psseUri,
      modelicaUri,
    };
  }
  if ((isModelica && referencedPscadSymbols.length > 0) || (isPscad && referencedModelicaSymbols.length > 0)) {
    return {
      kind: "modelica-pscad",
      referencedPscadSymbols,
      referencedModelicaSymbols,
      referencedPsseSymbols,
      pscadUri,
      psseUri,
      modelicaUri,
    };
  }
  if (isPscad && referencedPsseSymbols.length > 0) {
    return {
      kind: "psse-pscad",
      referencedPscadSymbols,
      referencedModelicaSymbols,
      referencedPsseSymbols,
      pscadUri,
      psseUri,
      modelicaUri,
    };
  }

  return null;
}

/**
 * Executes a coordinated Modelica + PSCAD multi-rate co-simulation using
 * `MultiRateCosimOrchestrator` and `EmtSolver` (`fmi-ls-emt`).
 */
export async function runModelicaPscadCosim(options: {
  modelicaDae: DAEBuilder;
  pscadText?: string | undefined;
  stopTime?: number | undefined;
  dtSlowSec?: number | undefined;
  dtFastSec?: number | undefined;
}): Promise<PolyglotSimResponse> {
  await initBltWasm();
  const t0 = Date.now();
  const stopTime = options.stopTime ?? 0.2;
  const dtSlow = options.dtSlowSec ?? 1e-3;
  const dtFast = options.dtFastSec ?? 50e-6;

  const orchestrator = new MultiRateCosimOrchestrator({
    dtFastSec: dtFast,
    dtSlowSec: dtSlow,
    gridFrequencyHz: 60,
  });

  const slowStep = createModelicaSlowStepFn(options.modelicaDae);

  // If PSCAD source is provided, run EmtSolver; otherwise run a canonical 3-phase RL EMT leaf
  let emtVoltageSeries: Float64Array | undefined;
  let emtCurrentSeries: Float64Array | undefined;
  let emtBusName = "PCC";

  if (options.pscadText) {
    const { runPscadSimulationPipeline } = await import("@modelscript/pscad");
    const companion = createModelicaEmtCompanion(options.modelicaDae, { phases: 3 });
    const pscadRes = runPscadSimulationPipeline({
      documentText: options.pscadText,
      runSimulation: true,
      durationSec: stopTime,
      timeStepSec: dtFast,
      fmuCompanions: new Map([["modelica_leaf", companion]]),
      exportComtrade: false,
      exportOut: false,
      exportPsout: false,
    });
    const sim = pscadRes.simulationResult;
    if (sim) {
      const firstBus = sim.busVoltages.entries().next();
      if (!firstBus.done) {
        emtBusName = firstBus.value[0];
        emtVoltageSeries = firstBus.value[1];
      }
      const firstBr = sim.branchCurrents.entries().next();
      if (!firstBr.done) {
        emtCurrentSeries = firstBr.value[1];
      }
    }
  }

  const macroSteps = Math.max(1, Math.round(stopTime / dtSlow));
  const subSteps = orchestrator.subStepsPerMacro;

  const t: number[] = [];
  const y: number[][] = [];
  const slowStateNames = new Set<string>();
  const macroRecords: Array<{ time: number; vRms: number; iRms: number; pMw: number; slow: Record<string, number> }> =
    [];

  let fastIdx = 0;
  for (let m = 0; m < macroSteps; m++) {
    const snap = orchestrator.stepMacro((_subTime, _interpolatedSlow) => {
      const v = emtVoltageSeries?.[fastIdx] ?? 13800 * Math.SQRT2 * Math.sin(2 * Math.PI * 60 * fastIdx * dtFast);
      const i = emtCurrentSeries?.[fastIdx] ?? 100 * Math.SQRT2 * Math.sin(2 * Math.PI * 60 * fastIdx * dtFast - 0.1);
      fastIdx++;
      return { v, i };
    }, slowStep);
    for (const k of Object.keys(snap.slowOutputs)) {
      slowStateNames.add(k);
    }
    macroRecords.push({
      time: snap.timeSec,
      vRms: snap.vRms,
      iRms: snap.iRms,
      pMw: snap.activePowerMw,
      slow: snap.slowOutputs,
    });
    void subSteps;
  }

  const slowKeys = Array.from(slowStateNames);
  const states = [`EMT.${emtBusName}.V_rms`, `EMT.${emtBusName}.I_rms`, `EMT.${emtBusName}.P_MW`, ...slowKeys];
  for (const rec of macroRecords) {
    t.push(rec.time);
    const row = [rec.vRms, rec.iRms, rec.pMw];
    for (const k of slowKeys) {
      row.push(rec.slow[k] ?? 0);
    }
    y.push(row);
  }

  return {
    t,
    y,
    states,
    experiment: { startTime: 0, stopTime, interval: dtSlow, tolerance: 1e-4 },
    telemetry: {
      executionTimeMs: Date.now() - t0,
      stepCount: t.length,
      mode: "polyglot-multi-rate-cosim(modelica+pscad)",
    },
  };
}

/**
 * Executes a 3-way PSS/E (TS) + PSCAD (EMT) (+ optional Modelica control) hybrid
 * co-simulation via `HybridEmtTsCoordinator`.
 */
export async function runHybridPssePscadModelicaCosim(options: {
  psseCase: PsseCase;
  pscadText?: string | undefined;
  boundaryBusNumber?: number | undefined;
  modelicaDae?: DAEBuilder | undefined;
  stopTime?: number | undefined;
  dtTsSec?: number | undefined;
  dtEmtSec?: number | undefined;
}): Promise<PolyglotSimResponse> {
  if (options.modelicaDae) {
    await initBltWasm();
  }
  const t0 = Date.now();
  const stopTime = options.stopTime ?? 0.2;
  const dtTsSec = options.dtTsSec ?? 1e-3;
  const dtEmtSec = options.dtEmtSec ?? 20e-6;

  const buses: TsBusSpec[] = Array.from(options.psseCase.buses.values()).map((b) => ({
    busNumber: b.i,
    name: b.name,
    baseKv: b.baseKv || 230,
    vMagPu: b.vm || 1.0,
    vAngleDeg: b.va || 0.0,
  }));
  if (buses.length === 0) {
    buses.push({ busNumber: 1, name: "PCC", baseKv: 230, vMagPu: 1.0, vAngleDeg: 0.0 });
  }

  const branches: TsBranchSpec[] = options.psseCase.branches.map((br) => ({
    fromBus: br.i,
    toBus: br.j,
    rPu: br.r || 0.001,
    xPu: br.x || 0.05,
    bTotalPu: br.b || 0,
  }));

  const generators: TsGeneratorSpec[] = options.psseCase.generators.map((g, idx) => ({
    id: `Gen_${g.i}_${g.id || idx + 1}`,
    busNumber: g.i,
    pGenMw: g.pg || 100,
    qGenMvar: g.qg || 0,
    hInertiaSec: 4.5,
    dampingPu: 2.0,
    xdPrimePu: 0.25,
  }));

  const targetBus = options.boundaryBusNumber ?? buses[0]!.busNumber;
  const targetBusSpec = buses.find((b) => b.busNumber === targetBus) ?? buses[0]!;
  const boundary: HybridBoundaryPortConfig = {
    id: `PCC_Bus_${targetBusSpec.busNumber}`,
    tsBusNumber: targetBusSpec.busNumber,
    emtNodeA: 1,
    emtNodeB: 2,
    emtNodeC: 3,
    baseKvLL: targetBusSpec.baseKv || 230,
  };

  let emtBridge: WasmEmtBridge;
  const freq = options.psseCase.header.basfrq || 60;
  let stampedFromPscad = false;

  if (options.pscadText) {
    const { extractEmtNetlist, parsePscx } = await import("@modelscript/pscad");
    const project = parsePscx(options.pscadText);
    const netlist = extractEmtNetlist(project);
    const busCount = Math.max(3, netlist.buses.size);
    emtBridge = new WasmEmtBridge(
      busCount,
      dtEmtSec,
      Math.max(32, netlist.branches.length * 4),
      Math.max(16, netlist.sources.length * 4),
    );
    const busIndexById = new Map<string, number>();
    let busIdx = 0;
    for (const busId of netlist.buses.keys()) {
      busIndexById.set(busId, busIdx++);
    }
    for (const br of netlist.branches) {
      const fromIdx = busIndexById.get(br.fromBus) ?? 0;
      const toIdx = br.toBus ? (busIndexById.get(br.toBus) ?? -1) : -1;
      emtBridge.addBranch(fromIdx, toIdx, br.resistanceOhm || 0.1, br.inductanceH || 0.01, br.capacitanceF || 0);
      stampedFromPscad = true;
    }
    for (const src of netlist.sources) {
      const nodeIdx = busIndexById.get(src.bus) ?? 0;
      emtBridge.addSource({
        node: nodeIdx,
        vPeakKv: src.vPeakKv || ((targetBusSpec.baseKv || 230) * Math.SQRT2) / Math.sqrt(3),
        freqHz: src.frequencyHz || freq,
        phaseRad: src.phaseRad ?? 0,
        gSource: 2.0,
      });
      stampedFromPscad = true;
    }
  } else {
    emtBridge = new WasmEmtBridge(3, dtEmtSec, 16, 8);
  }

  if (!stampedFromPscad) {
    const vPeakLnKv = ((targetBusSpec.baseKv || 230) * Math.SQRT2) / Math.sqrt(3);
    for (let ph = 0; ph < 3; ph++) {
      emtBridge.addBranch(ph, -1, 10.0, 0.05, 0);
      emtBridge.addSource({
        node: ph,
        vPeakKv: vPeakLnKv,
        freqHz: freq,
        phaseRad: (-ph * 120 * Math.PI) / 180,
        gSource: 2.0,
      });
    }
  }

  const coordinator = new HybridEmtTsCoordinator(
    {
      buses,
      branches,
      generators,
      boundaries: [boundary],
    },
    emtBridge,
    {
      dtEmtSec,
      dtTsSec,
      durationSec: stopTime,
      nominalFrequencyHz: freq,
      sBaseMva: options.psseCase.header.sbase || 100,
      handshakingMode: "norton_current",
    },
  );

  const slowStep = options.modelicaDae ? createModelicaSlowStepFn(options.modelicaDae) : undefined;
  const hybridRes = coordinator.run();

  const states = [
    `TS.${boundary.id}.V1_pu`,
    `TS.${boundary.id}.Angle_deg`,
    `EMT.${boundary.id}.V1_pu`,
    `EMT.${boundary.id}.V2_pu`,
    `EMT.${boundary.id}.P1_MW`,
    `EMT.${boundary.id}.Q1_Mvar`,
  ];

  const genIds = generators.map((g) => g.id);
  for (const gid of genIds) {
    states.push(`PSSE.${gid}.delta_deg`, `PSSE.${gid}.omega_pu`);
  }

  const modelicaRows: Array<Record<string, number>> = [];
  const modelicaKeys = new Set<string>();
  if (slowStep) {
    for (const rec of hybridRes.macroHistory) {
      const out = slowStep(rec.timeSec, {
        vRms: rec.v1EmtPu,
        iRms: 1.0,
        pMw: rec.p1BoundaryMw,
        qMvar: rec.q1BoundaryMvar,
      });
      for (const k of Object.keys(out)) modelicaKeys.add(k);
      modelicaRows.push(out);
    }
  }
  const mKeys = Array.from(modelicaKeys);
  for (const k of mKeys) states.push(`Modelica.${k}`);

  const t: number[] = [];
  const y: number[][] = [];
  hybridRes.macroHistory.forEach((rec, idx) => {
    t.push(rec.timeSec);
    const row = [rec.v1TsPu, rec.v1AngleTsDeg, rec.v1EmtPu, rec.v2EmtPu, rec.p1BoundaryMw, rec.q1BoundaryMvar];
    for (const gid of genIds) {
      row.push(rec.rotorAnglesDeg[gid] ?? 0, rec.rotorSpeedsPu[gid] ?? 1);
    }
    const mOut = modelicaRows[idx];
    for (const k of mKeys) {
      row.push(mOut?.[k] ?? 0);
    }
    y.push(row);
  });

  return {
    t,
    y,
    states,
    experiment: { startTime: 0, stopTime, interval: dtTsSec, tolerance: 1e-4 },
    telemetry: {
      executionTimeMs: Date.now() - t0,
      stepCount: t.length,
      mode: slowStep ? "polyglot-hybrid-emt-ts-modelica" : "polyglot-hybrid-emt-ts",
    },
  };
}

export function flattenModelicaForCosim(text: string, uri: string, className?: string): DAEBuilder | null {
  try {
    const ctx = new ModelicaContext(new BrowserFileSystem());
    ctx.load(text, uri);
    let target = className;
    if (!target) {
      const syms = Array.from(
        ((ctx as any).workspaceIndex?.getUnifiedIndex?.()?.symbols?.values?.() ?? []) as Array<{
          kind?: string;
          name?: string;
          metadata?: { classKind?: string };
        }>,
      );
      const modelSym =
        syms.find((s) => (s.kind === "Class" || s.kind === "Def") && s.metadata?.classKind === "model") ??
        syms.find((s) => (s.kind === "Class" || s.kind === "Def") && s.name);
      target = modelSym?.name;
    }
    if (!target) return null;
    return ctx.flattenArena(target, undefined, uri);
  } catch {
    return null;
  }
}
