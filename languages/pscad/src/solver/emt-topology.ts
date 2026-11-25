// SPDX-License-Identifier: AGPL-3.0-or-later

import { SparseTripletBuilder } from "@modelscript/runtime";
import {
  EmtdcHostBridge,
  type EmtdcRegisteredUdm,
  type EmtdcWasmMachinaDllRunner,
} from "../script/emtdc-abi-bridge.js";
import type { EmtNetlist } from "../types.js";
import { CsmfControlEvaluator } from "./csmf-evaluator.js";
import type {
  BergeronLineState,
  BusInfo,
  CompanionBranch,
  ConverterBridgeRuntimeState,
  CustomBlockRuntimeState,
  EmtSolverOptions,
  FmuState,
  IndMachineRuntimeState,
  LegacyBranchLike,
  LegacyLineLike,
  LegacyNetlistExtensions,
  LegacySourceLike,
  LegacyTransformerLike,
  NUlmLineRuntimeState,
  OltcState,
  SatXfmrRuntimeState,
  SourceInfo,
  SurgeArresterState,
  SwitchState,
  SyncGenState,
} from "./emt-solver-types.js";
import { createUniversalLineModel, type UniversalLineModelData } from "./universal-line-model.js";
import { synthesizeFdLineModel } from "./vector-fitting.js";

export interface EmtTopologyContext {
  readonly netlist: EmtNetlist;
  readonly options: EmtSolverOptions;
  readonly timeStepSec: number;
  readonly omega: number;
  readonly nSteps: number;
  readonly defaultSrcR: number;

  readonly busList: BusInfo[];
  readonly busIdxMap: Map<string, number>;
  readonly companionBranches: CompanionBranch[];
  readonly bergeronLines: BergeronLineState[];
  readonly ulmLines: UniversalLineModelData[];
  readonly nUlmLines: NUlmLineRuntimeState[];
  readonly syncGenerators: SyncGenState[];
  readonly oltcStates: OltcState[];
  readonly bridgeRuntimeStates: ConverterBridgeRuntimeState[];
  readonly switchStates: SwitchState[];
  readonly fmuStates: FmuState[];
  readonly surgeArresters: SurgeArresterState[];
  readonly busSources: Map<number, SourceInfo[]>;
  readonly customBlockStates: CustomBlockRuntimeState[];
  readonly indMachineStates: IndMachineRuntimeState[];
  readonly satXfmrStates: SatXfmrRuntimeState[];

  readonly busPhaseVoltages: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
  readonly branchCurrents: Map<string, Float64Array>;
  readonly branchPhaseCurrents: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
  readonly vA: Map<string, Float64Array>;
  readonly vB: Map<string, Float64Array>;
  readonly vC: Map<string, Float64Array>;
  readonly iA: Map<string, Float64Array>;
  readonly iB: Map<string, Float64Array>;
  readonly iC: Map<string, Float64Array>;
  readonly controlSignals: Map<string, Float64Array>;

  nBuses: number;
  nPhaseNodes: number;
  time: Float64Array;
  csmfEvaluator: CsmfControlEvaluator | null;
  emtdcHostBridge: EmtdcHostBridge | null;
  G3: Float64Array;
  J3: Float64Array;
  LU3: Float64Array;
  piv3: Int32Array;
  v3Step: Float64Array;
  vaStep: Float64Array;
  vbStep: Float64Array;
  vcStep: Float64Array;
  useSparse: boolean;
  gTriplets: SparseTripletBuilder | null;

  registerBranchBuffers(id: string): { ia: Float64Array; ib: Float64Array; ic: Float64Array };
}

/**
 * Indexes buses, sources, transmission lines (PI, Bergeron, FDPM, ULM, N-conductor ULM),
 * transformers, OLTCs, breakers, synchronous/induction machines, converters, surge arresters,
 * FMUs, CSMF control graphs, and EMTDC custom Fortran/C blocks, and allocates nodal matrix memory.
 */
export function initializeEmtTopology(ctx: EmtTopologyContext): void {
  ctx.time = new Float64Array(ctx.nSteps);
  for (let k = 0; k < ctx.nSteps; k++) {
    ctx.time[k] = k * ctx.timeStepSec;
  }

  // Index non-ground buses (supporting both Map<string, EmtBus> and string[] from netlistToEmtCircuit)
  const rawBuses = ctx.netlist.buses as unknown;
  if (rawBuses instanceof Map) {
    for (const [busId, bus] of rawBuses.entries()) {
      if (busId === "0" || busId === "GND") continue;
      const busLike = bus as { baseKv?: number; nominalKv?: number } | undefined;
      const rawKv = busLike?.baseKv ?? busLike?.nominalKv ?? 0;
      const baseKv = rawKv > 0 ? rawKv : 230.0;
      ctx.busIdxMap.set(busId, ctx.busList.length);
      ctx.busList.push({ id: busId, baseKv, vPeak: baseKv * 1e3 });
      const a = new Float64Array(ctx.nSteps);
      const b = new Float64Array(ctx.nSteps);
      const c = new Float64Array(ctx.nSteps);
      ctx.busPhaseVoltages.set(busId, { a, b, c });
      ctx.vA.set(busId, a);
      ctx.vB.set(busId, b);
      ctx.vC.set(busId, c);
    }
  } else if (Array.isArray(rawBuses)) {
    for (const item of rawBuses) {
      const busId = typeof item === "string" ? item : item?.id;
      if (!busId || busId === "0" || busId === "GND") continue;
      const rawKv = typeof item === "object" && item !== null ? (item.baseKv ?? item.nominalKv) || 0 : 0;
      const baseKv = rawKv > 0 ? rawKv : 230.0;
      ctx.busIdxMap.set(busId, ctx.busList.length);
      ctx.busList.push({ id: busId, baseKv, vPeak: baseKv * 1e3 });
      const a = new Float64Array(ctx.nSteps);
      const b = new Float64Array(ctx.nSteps);
      const c = new Float64Array(ctx.nSteps);
      ctx.busPhaseVoltages.set(busId, { a, b, c });
      ctx.vA.set(busId, a);
      ctx.vB.set(busId, b);
      ctx.vC.set(busId, c);
    }
  }

  const ensureInternalBus = (busId: string, baseKv: number) => {
    if (!busId || busId === "0" || busId === "GND" || ctx.busIdxMap.has(busId)) return;
    const safeKv = baseKv > 0 ? baseKv : 230.0;
    ctx.busIdxMap.set(busId, ctx.busList.length);
    ctx.busList.push({ id: busId, baseKv: safeKv, vPeak: safeKv * 1e3 });
    const a = new Float64Array(ctx.nSteps);
    const b = new Float64Array(ctx.nSteps);
    const c = new Float64Array(ctx.nSteps);
    ctx.busPhaseVoltages.set(busId, { a, b, c });
    ctx.vA.set(busId, a);
    ctx.vB.set(busId, b);
    ctx.vC.set(busId, c);
  };

  for (const xf of (ctx.netlist.transformers ?? []) as LegacyTransformerLike[]) {
    if (xf.tertiaryBus) {
      ensureInternalBus(`_xf_star_${xf.id}`, xf.primaryKv || 230.0);
    }
  }
  for (const conv of ctx.netlist.converterBridges ?? []) {
    if (conv.dcBus) {
      ensureInternalBus(conv.dcBus, conv.vDcNominalKv || conv.vDcRefKv || conv.ratedKvLL * 1.6);
    }
  }

  const controlBlocks = ctx.netlist.controlBlocks ?? [];
  if (controlBlocks.length > 0) {
    ctx.csmfEvaluator = new CsmfControlEvaluator(controlBlocks);
    for (const blk of controlBlocks) {
      ctx.controlSignals.set(blk.id, new Float64Array(ctx.nSteps));
    }
  }

  ctx.nBuses = ctx.busList.length;
  ctx.nPhaseNodes = 3 * ctx.nBuses;
  if (ctx.nBuses === 0) return;

  // Allocate coupled 3N x 3N phase-domain working memory (sparse CCS for >= 60 buses / 180 phase nodes)
  const n3 = ctx.nPhaseNodes;
  ctx.useSparse = n3 >= 180;
  if (ctx.useSparse) {
    ctx.G3 = new Float64Array(0);
    ctx.LU3 = new Float64Array(0);
    ctx.piv3 = new Int32Array(0);
    ctx.gTriplets = new SparseTripletBuilder(n3, n3, n3 * 12);
  } else {
    ctx.G3 = new Float64Array(n3 * n3);
    ctx.LU3 = new Float64Array(n3 * n3);
    ctx.piv3 = new Int32Array(n3);
  }
  ctx.J3 = new Float64Array(n3);
  ctx.v3Step = new Float64Array(n3);

  ctx.vaStep = new Float64Array(ctx.nBuses);
  ctx.vbStep = new Float64Array(ctx.nBuses);
  ctx.vcStep = new Float64Array(ctx.nBuses);

  // Register companion branches
  const addCompanion = (
    id: string,
    fromBus: string,
    toBus: string,
    rOhm: number,
    lHenry: number,
    cFarad: number = 0,
    r0Ohm?: number,
    l0Henry?: number,
    windingConnection?: "Yg-Yg" | "Yg-D" | "D-Yg" | "D-D",
    tapRatio?: number,
  ) => {
    const fromIdx = fromBus === "0" || fromBus === "GND" ? -1 : (ctx.busIdxMap.get(fromBus) ?? -1);
    const toIdx = toBus === "0" || toBus === "GND" ? -1 : (ctx.busIdxMap.get(toBus) ?? -1);
    if (fromIdx === -1 && toIdx === -1) return;

    const L1 = Math.max(lHenry, 0.0);
    const isCapacitiveBranch = L1 === 0.0 && cFarad > 0.0;
    const R1 = isCapacitiveBranch ? Math.max(rOhm, 0.0) : Math.max(rOhm, 1e-4);

    let gEq: number;
    let gMut = 0.0;
    let alphaHist: number;
    let alphaMutHist = 0.0;
    let vCoeffHist = 1.0;
    const shuntG = 0.0;

    if (isCapacitiveBranch) {
      const denomC = ctx.timeStepSec + 2.0 * R1 * cFarad;
      gEq = denomC > 1e-18 ? (2.0 * cFarad) / denomC : 1e4;
      alphaHist = denomC > 1e-18 ? (2.0 * R1 * cFarad - ctx.timeStepSec) / denomC : -1.0;
      vCoeffHist = -1.0;
    } else {
      const denom1 = 2.0 * L1 + R1 * ctx.timeStepSec;
      const g1 = denom1 > 1e-12 ? ctx.timeStepSec / denom1 : 1.0 / R1;
      const alpha1 = denom1 > 1e-12 ? (2.0 * L1 - R1 * ctx.timeStepSec) / denom1 : 0.0;
      gEq = g1;
      alphaHist = alpha1;

      if ((r0Ohm !== undefined && r0Ohm > R1) || (l0Henry !== undefined && l0Henry > L1)) {
        const R0 = Math.max(r0Ohm ?? R1, R1);
        const L0 = Math.max(l0Henry ?? L1, L1);
        const denom0 = 2.0 * L0 + R0 * ctx.timeStepSec;
        const g0 = denom0 > 1e-12 ? ctx.timeStepSec / denom0 : 1.0 / R0;
        const alpha0 = denom0 > 1e-12 ? (2.0 * L0 - R0 * ctx.timeStepSec) / denom0 : 0.0;
        gEq = (2.0 * g1 + g0) / 3.0;
        gMut = (g0 - g1) / 3.0;
        alphaHist = (2.0 * alpha1 + alpha0) / 3.0;
        alphaMutHist = (alpha0 - alpha1) / 3.0;
      }
      // Split Pi-section capacitance to ground at each terminal bus so capacitor history updates cleanly
      if (cFarad > 0.0) {
        const cHalf = fromIdx >= 0 && toIdx >= 0 ? 0.5 * cFarad : cFarad;
        if (fromIdx >= 0) addCompanion(`${id}__cFrom`, fromBus, "0", 0.0, 0.0, cHalf);
        if (toIdx >= 0) addCompanion(`${id}__cTo`, toBus, "0", 0.0, 0.0, cHalf);
      }
    }

    const alphaBe = L1 > 0.0 ? L1 / Math.max(1e-12, L1 + R1 * 0.5 * ctx.timeStepSec) : 0.0;
    const { ia, ib, ic } = ctx.registerBranchBuffers(id);

    ctx.companionBranches.push({
      id,
      fromIdx,
      toIdx,
      rOhm: R1,
      lHenry: L1,
      cFarad: isCapacitiveBranch ? cFarad : 0,
      gEq,
      gMut,
      alphaHist,
      alphaMutHist,
      vCoeffHist,
      shuntG,
      tapRatio,
      alphaBe,
      windingConnection,
      iHistA: 0,
      iHistB: 0,
      iHistC: 0,
      ia,
      ib,
      ic,
    });
  };

  // Helper to register Bergeron distributed traveling-wave line, ULM / J. Marti FDPM line, or fallback pi-section
  const addTransmissionLine = (ln: LegacyLineLike) => {
    const fromBus = ln.fromBus ?? ln.from ?? "0";
    const toBus = ln.toBus ?? ln.to ?? "0";
    const fromIdx = fromBus === "0" || fromBus === "GND" ? -1 : (ctx.busIdxMap.get(fromBus) ?? -1);
    const toIdx = toBus === "0" || toBus === "GND" ? -1 : (ctx.busIdxMap.get(toBus) ?? -1);
    if (fromIdx === -1 && toIdx === -1) return;

    const lengthKm = ln.lengthKm ?? 0;
    const rTotal = ln.rTotalOhm ?? (lengthKm > 0 ? (ln.rPerKm ?? 0.03) * lengthKm : 1.0);
    const lTotal = ln.lTotalHenry ?? (lengthKm > 0 ? (ln.lPerKm ?? 0.001) * lengthKm : 0.01);
    const cTotal = ln.cTotalFarad ?? (lengthKm > 0 ? (ln.cPerKm ?? 1.1e-8) * lengthKm : 0.0);
    const modelType = ln.modelType ?? (lengthKm > 0 && cTotal > 0 ? "bergeron" : "pi");

    if (modelType === "ulm" && ln.nUlmData && fromIdx >= 0 && toIdx >= 0) {
      ctx.nUlmLines.push({
        id: ln.id,
        fromIdx,
        toIdx,
        model: ln.nUlmData,
        vK: new Float64Array(Math.max(3, ln.nUlmData.nCond)),
        vM: new Float64Array(Math.max(3, ln.nUlmData.nCond)),
      });
      ctx.registerBranchBuffers(ln.id);
      return;
    }

    if (modelType === "ulm" && fromIdx >= 0 && toIdx >= 0) {
      const ulm =
        ln.ulmData ??
        createUniversalLineModel({
          id: ln.id,
          fromBus,
          toBus,
          fromIdx,
          toIdx,
          lengthKm: lengthKm > 0 ? lengthKm : 100.0,
          dtSec: ctx.timeStepSec,
          rPerKm: ln.rPerKm ?? (lengthKm > 0 ? rTotal / lengthKm : 0.03),
          lPerKm: ln.lPerKm ?? (lengthKm > 0 ? lTotal / lengthKm : 0.001),
          cPerKm: ln.cPerKm ?? (lengthKm > 0 ? cTotal / lengthKm : 1.1e-8),
          r0PerKm: ln.r0PerKm,
          l0PerKm: ln.l0PerKm,
          c0PerKm: ln.c0PerKm,
        });
      ctx.ulmLines.push(ulm);
      ctx.registerBranchBuffers(ln.id);
      return;
    }

    const tau = lTotal > 0 && cTotal > 0 ? Math.sqrt(lTotal * cTotal) : 0;
    if (modelType !== "pi" && tau >= ctx.timeStepSec && fromIdx >= 0 && toIdx >= 0) {
      const zChar = Math.sqrt(lTotal / cTotal);
      const rQuarter = 0.25 * Math.max(0, rTotal);
      const zBerg = Math.max(1e-3, zChar + rQuarter);
      const gBerg = 1.0 / zBerg;
      const hLoss = Math.max(-0.999, Math.min(1.0, (zChar - rQuarter) / zBerg));
      const exactSteps = tau / ctx.timeStepSec;
      const delaySteps = Math.max(1, Math.floor(exactSteps));
      const fracDelay = Math.max(0, Math.min(1, exactSteps - delaySteps));

      const hasModal = Boolean(
        ln.hasModal ||
        ln.r0PerKm !== undefined ||
        ln.l0PerKm !== undefined ||
        ln.c0PerKm !== undefined ||
        ln.r0TotalOhm !== undefined ||
        ln.l0TotalHenry !== undefined ||
        ln.c0TotalFarad !== undefined,
      );

      let delaySteps0 = delaySteps;
      let fracDelay0 = fracDelay;
      let gBerg0 = gBerg;
      let hLoss0 = hLoss;
      let delaySteps1 = delaySteps;
      let fracDelay1 = fracDelay;
      let gBerg1 = gBerg;
      let hLoss1 = hLoss;
      let gSelf = gBerg;
      let gMutual = 0.0;

      if (hasModal) {
        const r0Total = ln.r0TotalOhm ?? (lengthKm > 0 && ln.r0PerKm ? ln.r0PerKm * lengthKm : 3.0 * rTotal);
        const l0Total = ln.l0TotalHenry ?? (lengthKm > 0 && ln.l0PerKm ? ln.l0PerKm * lengthKm : 3.0 * lTotal);
        const c0Total = ln.c0TotalFarad ?? (lengthKm > 0 && ln.c0PerKm ? ln.c0PerKm * lengthKm : 0.65 * cTotal);

        const tau0 = l0Total > 0 && c0Total > 0 ? Math.sqrt(l0Total * c0Total) : tau;
        const zChar0 = Math.sqrt(l0Total / c0Total);
        const rQuarter0 = 0.25 * Math.max(0, r0Total);
        const zBerg0 = Math.max(1e-3, zChar0 + rQuarter0);
        gBerg0 = 1.0 / zBerg0;
        hLoss0 = Math.max(-0.999, Math.min(1.0, (zChar0 - rQuarter0) / zBerg0));
        const exactSteps0 = tau0 / ctx.timeStepSec;
        delaySteps0 = Math.max(1, Math.floor(exactSteps0));
        fracDelay0 = Math.max(0, Math.min(1, exactSteps0 - delaySteps0));

        delaySteps1 = delaySteps;
        fracDelay1 = fracDelay;
        gBerg1 = gBerg;
        hLoss1 = hLoss;

        gSelf = (1.0 / 3.0) * gBerg0 + (2.0 / 3.0) * gBerg1;
        gMutual = (1.0 / 3.0) * (gBerg0 - gBerg1);
      }

      const maxDelay = Math.max(delaySteps, delaySteps0, delaySteps1);
      const bufLen = maxDelay + 3;
      const { ia, ib, ic } = ctx.registerBranchBuffers(ln.id);

      const isFdpm = modelType === "fdpm";
      const fdSynth = isFdpm
        ? synthesizeFdLineModel(
            {
              lengthKm: lengthKm > 0 ? lengthKm : 100.0,
              rPerKm: ln.rPerKm ?? (lengthKm > 0 ? rTotal / lengthKm : 0.03),
              lPerKm: ln.lPerKm ?? (lengthKm > 0 ? lTotal / lengthKm : 0.001),
              cPerKm: ln.cPerKm ?? (lengthKm > 0 ? cTotal / lengthKm : 1.1e-8),
              r0PerKm: ln.r0PerKm,
              l0PerKm: ln.l0PerKm,
              c0PerKm: ln.c0PerKm,
              towerHeightM: ln.towerHeightM,
              phaseSpacingM: ln.phaseSpacingM,
              conductorRadiusM: ln.conductorRadiusM,
              soilResistivityOhmM: ln.soilResistivityOhmM,
              poles: ln.poles,
              residues: ln.residues,
              d0: ln.d0,
            },
            ctx.timeStepSec,
          )
        : null;

      const rawPoles = isFdpm && ln.poles && ln.poles.length > 0 ? ln.poles : fdSynth ? Array.from(fdSynth.hPoles) : [];
      const nPoles = rawPoles.length;
      const expDecays = new Float64Array(nPoles);
      const convGains = new Float64Array(nPoles);
      let d0 = isFdpm ? (ln.d0 ?? fdSynth?.hD0 ?? 0.35) : 1.0;

      if (isFdpm && nPoles > 0) {
        const defaultWeights = [0.4, 0.3, 0.2, 0.1];
        const explicitRes =
          ln.residues && ln.residues.length === nPoles
            ? ln.residues
            : fdSynth && fdSynth.hResidues.length === nPoles
              ? Array.from(fdSynth.hResidues)
              : undefined;
        const hasExplicitResidues = Boolean(explicitRes && explicitRes.some((r) => r > 0));
        let sumWeights = 0.0;
        const poleWeights = new Float64Array(nPoles);

        for (let m = 0; m < nPoles; m++) {
          const p = -Math.max(1.0, Math.abs(rawPoles[m]!));
          const alpha = Math.exp(p * ctx.timeStepSec);
          expDecays[m] = alpha;
          if (hasExplicitResidues) {
            const res = Math.max(0.0, explicitRes![m]!);
            const pw = res / -p;
            poleWeights[m] = pw;
            sumWeights += pw;
          }
        }

        const hDc = Math.max(0.0, Math.min(1.0, hLoss > 0 ? hLoss : 0.98));
        if (hasExplicitResidues) {
          d0 = Math.max(0.05, Math.min(0.5, ln.d0 ?? fdSynth?.hD0 ?? 0.35));
          const totalDynamicGain = Math.max(0.0, hDc - d0);
          for (let m = 0; m < nPoles; m++) {
            const w = sumWeights > 1e-12 ? poleWeights[m]! / sumWeights : 1.0 / nPoles;
            convGains[m] = totalDynamicGain * w * (1.0 - expDecays[m]!);
          }
        } else {
          for (let m = 0; m < nPoles; m++) {
            const w = defaultWeights[m] ?? 1.0 / nPoles;
            convGains[m] = (1.0 - d0) * w * (1.0 - expDecays[m]!);
          }
        }
      }

      ctx.bergeronLines.push({
        id: ln.id,
        fromIdx,
        toIdx,
        zChar,
        gBerg,
        hLoss,
        delaySteps,
        fracDelay,
        bufLen,
        ptr: 0,
        vkBufA: new Float64Array(bufLen),
        vkBufB: new Float64Array(bufLen),
        vkBufC: new Float64Array(bufLen),
        vmBufA: new Float64Array(bufLen),
        vmBufB: new Float64Array(bufLen),
        vmBufC: new Float64Array(bufLen),
        ikmBufA: new Float64Array(bufLen),
        ikmBufB: new Float64Array(bufLen),
        ikmBufC: new Float64Array(bufLen),
        imkBufA: new Float64Array(bufLen),
        imkBufB: new Float64Array(bufLen),
        imkBufC: new Float64Array(bufLen),
        hasModal,
        delaySteps0,
        fracDelay0,
        gBerg0,
        hLoss0,
        delaySteps1,
        fracDelay1,
        gBerg1,
        hLoss1,
        gSelf,
        gMutual,
        isFdpm,
        d0,
        gInf: fdSynth ? fdSynth.gInf : gBerg,
        yPoles: fdSynth ? fdSynth.yPoles : new Float64Array(0),
        yResidues: fdSynth ? fdSynth.yResidues : new Float64Array(0),
        hPoles: fdSynth ? fdSynth.hPoles : new Float64Array(0),
        hResidues: fdSynth ? fdSynth.hResidues : new Float64Array(0),
        expDecays,
        convGains,
        xKmA: new Float64Array(nPoles),
        xKmB: new Float64Array(nPoles),
        xKmC: new Float64Array(nPoles),
        xMkA: new Float64Array(nPoles),
        xMkB: new Float64Array(nPoles),
        xMkC: new Float64Array(nPoles),
        ia,
        ib,
        ic,
      });
    } else {
      addCompanion(ln.id, fromBus, toBus, rTotal || 1.0, lTotal || 0.01, cTotal || 0);
    }
  };

  const netlistExt = ctx.netlist as EmtNetlist & LegacyNetlistExtensions;

  for (const br of (ctx.netlist.branches ?? []) as LegacyBranchLike[]) {
    if (br.kind === "switch") {
      const fromBus = br.fromBus ?? br.from ?? "0";
      const toBus = br.toBus ?? br.to ?? "0";
      const fromIdx = fromBus === "0" || fromBus === "GND" ? -1 : (ctx.busIdxMap.get(fromBus) ?? -1);
      const toIdx = toBus === "0" || toBus === "GND" ? -1 : (ctx.busIdxMap.get(toBus) ?? -1);
      const { ia, ib, ic } = ctx.registerBranchBuffers(br.id);
      const initialClosed = br.status !== "open";
      const actionTimeSec = (initialClosed ? br.openTimeSec : br.closeTimeSec) ?? 1e9;
      type PoleTimesShape = { a?: number; b?: number; c?: number; [idx: number]: number | undefined };
      const brPole = br as unknown as {
        poleOpenTimesSec?: PoleTimesShape;
        poleCloseTimesSec?: PoleTimesShape;
        poleActionTimesSec?: PoleTimesShape;
      };
      const poleTimes = initialClosed
        ? brPole.poleOpenTimesSec
        : (brPole.poleCloseTimesSec ?? brPole.poleActionTimesSec);
      const poleActionTimesSec: [number, number, number] | undefined = poleTimes
        ? [
            poleTimes.a ?? poleTimes[0] ?? actionTimeSec,
            poleTimes.b ?? poleTimes[1] ?? actionTimeSec,
            poleTimes.c ?? poleTimes[2] ?? actionTimeSec,
          ]
        : undefined;

      ctx.switchStates.push({
        sw: {
          id: br.id,
          fromBus,
          toBus,
          initialClosed,
          actionTimeSec,
          poleActionTimesSec,
          rClosedOhm: br.rClosedOhm,
          rOpenOhm: br.rOpenOhm,
          waitForCurrentZero: (br as { waitForCurrentZero?: boolean | undefined }).waitForCurrentZero,
          diode: (br as { diode?: boolean | undefined }).diode,
        },
        fromIdx,
        toIdx,
        currentClosed: initialClosed,
        phaseClosed: [initialClosed, initialClosed, initialClosed],
        ia,
        ib,
        ic,
      });
      continue;
    }
    const fromBus = br.fromBus ?? br.from ?? "0";
    const toBus = br.toBus ?? br.to ?? "0";
    const rVal = br.rOhm ?? br.resistanceOhm ?? br.r ?? 0.1;
    const lVal = br.lHenry ?? br.inductanceH ?? br.lH ?? br.l ?? 0;
    const cVal = br.cFarad ?? br.capacitanceF ?? br.cF ?? br.c ?? 0;
    const l0Val = br.l0Henry ?? (br.mutualInductanceH !== undefined ? lVal + 2 * br.mutualInductanceH : undefined);
    addCompanion(br.id, fromBus, toBus, rVal, lVal, cVal, br.r0Ohm, l0Val);
  }

  for (const br of netlistExt.rlc ?? []) {
    const fromBus = br.fromBus ?? br.from ?? "0";
    const toBus = br.toBus ?? br.to ?? "0";
    addCompanion(br.id, fromBus, toBus, br.r ?? br.rOhm ?? 0.1, br.l ?? br.lHenry ?? 0, br.c ?? br.cFarad ?? 0);
  }

  for (const ln of netlistExt.lines ?? []) {
    addTransmissionLine(ln);
  }
  for (const ln of (ctx.netlist.transmissionLines ?? []) as LegacyLineLike[]) {
    addTransmissionLine(ln);
  }

  // Register Metal Oxide Surge Arresters (MOVs)
  for (const arr of ctx.netlist.surgeArresters ?? []) {
    const fromBus = arr.fromBus ?? "0";
    const toBus = arr.toBus ?? "0";
    const fromIdx = fromBus === "0" || fromBus === "GND" ? -1 : (ctx.busIdxMap.get(fromBus) ?? -1);
    const toIdx = toBus === "0" || toBus === "GND" ? -1 : (ctx.busIdxMap.get(toBus) ?? -1);
    if (fromIdx === -1 && toIdx === -1) continue;
    const vRefVolts = (arr.vRefKv ?? 400.0) * 1e3;
    const rClampOhm = arr.rClampOhm ?? 0.5;
    const n3 = ctx.nPhaseNodes;
    ctx.surgeArresters.push({
      id: arr.id,
      fromIdx,
      toIdx,
      vRefVolts,
      rClampOhm,
      energyJoules: 0.0,
      zThPhase: [50.0, 50.0, 50.0],
      xThPhase: [new Float64Array(n3), new Float64Array(n3), new Float64Array(n3)],
    });
  }

  for (const xf of (ctx.netlist.transformers ?? []) as LegacyTransformerLike[]) {
    const primKv = xf.primaryKv || 230.0;
    const secKv = xf.secondaryKv || primKv;
    const primBus = xf.primaryBus ?? xf.fromBus ?? "0";
    const secBus = xf.secondaryBus ?? xf.toBus ?? "0";
    const ratedMva = Math.max(xf.ratedMva || xf.mvaRating || xf.mva || 100.0, 1.0);
    const baseZ = primKv ** 2 / ratedMva;
    const autoScale = xf.isAutotransformer
      ? Math.max(0.15, 1.0 - Math.min(primKv, secKv) / Math.max(primKv, secKv))
      : 1.0;
    const xPuDefault = (xf.leakageXPu || xf.xLeakagePu || xf.leakageReactancePu || 0.1) * autoScale;
    const rPrimOhm = Math.max(1e-4, 0.005 * baseZ);
    const tapPu = xf.tapPu ?? 1.0;
    const baseTapRatio = primKv > 0 && secKv > 0 ? secKv / primKv : 1.0;

    if (xf.tertiaryBus) {
      const starBus = `_xf_star_${xf.id}`;
      const tertKv = xf.tertiaryKv || secKv;
      const xPsPu = xf.leakagePsPu ?? xPuDefault;
      const xPtPu = xf.leakagePtPu ?? Math.max(xPuDefault, 0.12);
      const xStPu =
        xf.leakageStPu ??
        (xf.tertiaryLeakagePu !== undefined ? xPsPu + xf.tertiaryLeakagePu : Math.max(xPuDefault, 0.12));
      const xPPu = Math.max(0.002, 0.5 * (xPsPu + xPtPu - xStPu));
      const xSPu = Math.max(0.002, 0.5 * (xPsPu + xStPu - xPtPu));
      const xTPu =
        xf.tertiaryLeakagePu !== undefined
          ? Math.max(0.002, xf.tertiaryLeakagePu)
          : Math.max(0.002, 0.5 * (xPtPu + xStPu - xPsPu));

      const secBranchIdx = ctx.companionBranches.length + 1;
      addCompanion(
        `${xf.id}_P`,
        primBus,
        starBus,
        rPrimOhm,
        (xPPu * baseZ) / ctx.omega,
        0,
        undefined,
        undefined,
        "Yg-Yg",
        1.0,
      );
      addCompanion(
        `${xf.id}_S`,
        starBus,
        secBus,
        rPrimOhm * baseTapRatio ** 2,
        (xSPu * baseZ) / ctx.omega,
        0,
        undefined,
        undefined,
        xf.windingConnection,
        baseTapRatio * tapPu,
      );
      const tertTapRatio = primKv > 0 && tertKv > 0 ? tertKv / primKv : 1.0;
      const tertConn = xf.tertiaryConnection === "D" ? "Yg-D" : "Yg-Yg";
      addCompanion(
        `${xf.id}_T`,
        starBus,
        xf.tertiaryBus,
        rPrimOhm * tertTapRatio ** 2,
        (xTPu * baseZ) / ctx.omega,
        0,
        undefined,
        undefined,
        tertConn,
        tertTapRatio,
      );
      // Mirror secondary winding buffer under main transformer ID for direct current lookup
      const secBuf = ctx.branchPhaseCurrents.get(`${xf.id}_S`);
      if (secBuf) {
        ctx.branchCurrents.set(xf.id, secBuf.a);
        ctx.branchPhaseCurrents.set(xf.id, secBuf);
        ctx.iA.set(xf.id, secBuf.a);
        ctx.iB.set(xf.id, secBuf.b);
        ctx.iC.set(xf.id, secBuf.c);
      }
      if (xf.oltc) {
        const targetId = xf.oltc.targetBus ?? secBus;
        const targetBusIdx = ctx.busIdxMap.get(targetId) ?? -1;
        const tapTraj = new Float64Array(ctx.nSteps);
        ctx.controlSignals.set(`${xf.id}_tapPu`, tapTraj);
        const vRefKv = ctx.busList[targetBusIdx]?.baseKv ?? secKv;
        ctx.oltcStates.push({
          id: xf.id,
          branchIdx: secBranchIdx,
          baseTapRatio,
          tapPu,
          tapMin: xf.oltc.tapMin ?? 0.9,
          tapMax: xf.oltc.tapMax ?? 1.1,
          tapStepPu: xf.oltc.tapStepPu ?? 0.00625,
          targetBusIdx,
          vRefVoltsPeak: ((xf.oltc.vRefPu ?? 1.0) * vRefKv * 1e3 * Math.SQRT2) / Math.sqrt(3.0),
          deadbandPu: xf.oltc.deadbandPu ?? 0.015,
          delaySec: xf.oltc.delaySec ?? 0.01,
          timerSec: 0,
          tapTraj,
        });
      }
    } else {
      const xOhm = Math.max(xPuDefault * baseZ, 0.02);
      const lHenry = xOhm / ctx.omega;
      const branchIdx = ctx.companionBranches.length;
      addCompanion(
        xf.id,
        primBus,
        secBus,
        0.01 * baseZ,
        lHenry,
        0,
        undefined,
        undefined,
        xf.windingConnection,
        baseTapRatio * tapPu,
      );
      if (xf.oltc) {
        const targetId = xf.oltc.targetBus ?? secBus;
        const targetBusIdx = ctx.busIdxMap.get(targetId) ?? -1;
        const tapTraj = new Float64Array(ctx.nSteps);
        ctx.controlSignals.set(`${xf.id}_tapPu`, tapTraj);
        const vRefKv = ctx.busList[targetBusIdx]?.baseKv ?? secKv;
        ctx.oltcStates.push({
          id: xf.id,
          branchIdx,
          baseTapRatio,
          tapPu,
          tapMin: xf.oltc.tapMin ?? 0.9,
          tapMax: xf.oltc.tapMax ?? 1.1,
          tapStepPu: xf.oltc.tapStepPu ?? 0.00625,
          targetBusIdx,
          vRefVoltsPeak: ((xf.oltc.vRefPu ?? 1.0) * vRefKv * 1e3 * Math.SQRT2) / Math.sqrt(3.0),
          deadbandPu: xf.oltc.deadbandPu ?? 0.015,
          delaySec: xf.oltc.delaySec ?? 0.01,
          timerSec: 0,
          tapTraj,
        });
      }
    }
  }

  // Register switch states
  for (const sw of netlistExt.switches ?? []) {
    const fromIdx = sw.fromBus === "0" || sw.fromBus === "GND" ? -1 : (ctx.busIdxMap.get(sw.fromBus) ?? -1);
    const toIdx = sw.toBus === "0" || sw.toBus === "GND" ? -1 : (ctx.busIdxMap.get(sw.toBus) ?? -1);
    const { ia, ib, ic } = ctx.registerBranchBuffers(sw.id);
    const initClosed = Boolean(sw.initialClosed);
    ctx.switchStates.push({
      sw,
      fromIdx,
      toIdx,
      currentClosed: initClosed,
      phaseClosed: [initClosed, initClosed, initClosed],
      ia,
      ib,
      ic,
    });
  }
  for (const brk of netlistExt.breakers ?? []) {
    const fromIdx = brk.from === "0" || brk.from === "GND" ? -1 : (ctx.busIdxMap.get(brk.from) ?? -1);
    const toIdx = brk.to === "0" || brk.to === "GND" ? -1 : (ctx.busIdxMap.get(brk.to) ?? -1);
    const { ia, ib, ic } = ctx.registerBranchBuffers(brk.id);
    const initialClosed = brk.closedInitially ?? true;
    const actionTimeSec = (initialClosed ? brk.openTimeSec : brk.closeTimeSec) ?? 1e9;
    ctx.switchStates.push({
      sw: {
        id: brk.id,
        fromBus: brk.from,
        toBus: brk.to,
        initialClosed,
        actionTimeSec,
        rClosedOhm: brk.rClosedOhm,
        rOpenOhm: brk.rOpenOhm,
      },
      fromIdx,
      toIdx,
      currentClosed: initialClosed,
      phaseClosed: [initialClosed, initialClosed, initialClosed],
      ia,
      ib,
      ic,
    });
  }

  // Register Park dq0 synchronous generators
  for (const sm of ctx.netlist.synchronousMachines ?? []) {
    const busIdx = ctx.busIdxMap.get(sm.bus) ?? -1;
    if (busIdx < 0) continue;
    const ratedMva = Math.max(1e-3, sm.ratedMva || 100.0);
    const ratedKv = sm.ratedKvLL || ctx.busList[busIdx]?.baseKv || 230.0;
    const vPeak = (ratedKv * 1e3 * Math.SQRT2) / Math.sqrt(3.0);
    const zBase = (ratedKv * ratedKv) / ratedMva;
    const xdSubPu = Math.max(0.05, sm.xdSub ?? sm.xdPrime ?? sm.xd ?? 0.2);
    const xqSubPu = Math.max(0.05, sm.xqSub ?? sm.xqPrime ?? sm.xq ?? xdSubPu);
    const xSubOhm = Math.max(0.01, xdSubPu * zBase);
    const freqHz = sm.frequencyHz || ctx.netlist.nominalFrequencyHz || 60.0;
    const omega0 = 2 * Math.PI * freqHz;
    const lSubH = xSubOhm / omega0;
    const rGenOhm = Math.max(1e-4, 0.003 * zBase);
    const twoLOverDt = (2.0 * lSubH) / ctx.timeStepSec;
    const gGen = 1.0 / (rGenOhm + twoLOverDt);
    const alphaGen = (twoLOverDt - rGenOhm) / (twoLOverDt + rGenOhm);
    const iBasePeak = vPeak / Math.max(1e-4, zBase);
    const hSec = Math.max(0.1, sm.hInertiaSec ?? 3.5);
    const dampingPu = Math.max(0.0, sm.dampingPu ?? 2.0);
    const pmPu = sm.mechanicalPowerPu ?? 0.8;
    const efPu = Math.max(0.1, sm.fieldVoltagePu ?? 1.05);
    const sinDelta0 = Math.max(-0.85, Math.min(0.85, (pmPu * xdSubPu) / efPu));
    const delta0 = Math.asin(sinDelta0);

    const { ia, ib, ic } = ctx.registerBranchBuffers(sm.id);
    const deltaTraj = new Float64Array(ctx.nSteps);
    const omegaTraj = new Float64Array(ctx.nSteps);
    const speedPuTraj = new Float64Array(ctx.nSteps);
    const peTraj = new Float64Array(ctx.nSteps);
    const vdTraj = new Float64Array(ctx.nSteps);
    const vqTraj = new Float64Array(ctx.nSteps);
    const idTraj = new Float64Array(ctx.nSteps);
    const iqTraj = new Float64Array(ctx.nSteps);

    ctx.controlSignals.set(`${sm.id}_delta`, deltaTraj);
    ctx.controlSignals.set(`${sm.id}_omega`, omegaTraj);
    ctx.controlSignals.set(`${sm.id}_speedPu`, speedPuTraj);
    ctx.controlSignals.set(`${sm.id}_Pe`, peTraj);
    ctx.controlSignals.set(`${sm.id}_vd`, vdTraj);
    ctx.controlSignals.set(`${sm.id}_vq`, vqTraj);
    ctx.controlSignals.set(`${sm.id}_id`, idTraj);
    ctx.controlSignals.set(`${sm.id}_iq`, iqTraj);

    const torsionalMasses =
      sm.torsionalMasses && sm.torsionalMasses.length >= 2
        ? sm.torsionalMasses.map((tm, mIdx) => {
            const torqueTraj = new Float64Array(ctx.nSteps);
            const speedTraj = new Float64Array(ctx.nSteps);
            ctx.controlSignals.set(`${sm.id}_torque_${mIdx}`, torqueTraj);
            ctx.controlSignals.set(`${sm.id}_speed_${mIdx}`, speedTraj);
            return {
              id: tm.id,
              hInertiaSec: Math.max(0.02, tm.hInertiaSec),
              dampingPu: tm.dampingPu ?? 0.25,
              kShaftPuPerRad: tm.kShaftPuPerRad ?? 20.0,
              dampingMutualPu: tm.dampingMutualPu ?? 0.0,
              torqueFraction:
                tm.torqueFraction ??
                (mIdx === sm.torsionalMasses!.length - 1 ? 0.0 : 1.0 / (sm.torsionalMasses!.length - 1)),
              deltaRad: delta0,
              omegaRadSec: omega0,
              torqueTraj,
              speedTraj,
            };
          })
        : undefined;

    ctx.syncGenerators.push({
      id: sm.id,
      busIdx,
      ratedMva,
      vPeak,
      iBasePeak,
      omega0,
      gGen,
      alphaGen,
      iHistA: 0.0,
      iHistB: 0.0,
      iHistC: 0.0,
      xdSubPu,
      xqSubPu,
      xdPu: sm.xd ?? Math.max(xdSubPu, 1.8),
      xqPu: sm.xq ?? Math.max(xqSubPu, 1.7),
      xdPrimePu: sm.xdPrime ?? Math.max(xdSubPu, 0.3),
      xqPrimePu: sm.xqPrime ?? Math.max(xqSubPu, 0.55),
      hSec,
      dampingPu,
      pmPu,
      efPu,
      eqPrimePu: efPu,
      edPrimePu: 0.0,
      eqSubPu: efPu,
      edSubPu: 0.0,
      deltaRad: delta0,
      omegaRadSec: omega0,
      ia,
      ib,
      ic,
      deltaTraj,
      omegaTraj,
      speedPuTraj,
      peTraj,
      vdTraj,
      vqTraj,
      idTraj,
      iqTraj,
      efSignal: sm.efSignal,
      tmSignal: sm.tmSignal,
      torsionalMasses,
    });
  }

  // Register FMU / IBR converters
  for (const fmu of (ctx.netlist.fmuInstances ?? []) as FmuState["fmu"][]) {
    const busId = fmu.busConnection ?? fmu.bus ?? "";
    const busIdx = ctx.busIdxMap.get(busId) ?? 0;
    const busKv =
      (ctx.netlist.buses instanceof Map ? ctx.netlist.buses.get(busId)?.baseKv : undefined) ??
      (fmu.ratedKv > 0 ? fmu.ratedKv : 230.0);
    const iRatedPeak = ((fmu.ratedMva || 100.0) * 1e6) / (Math.max(0.1, busKv) * 1e3);
    const { ia, ib, ic } = ctx.registerBranchBuffers(fmu.id);
    const companion = ctx.options.fmuCompanions?.get(fmu.id);
    ctx.fmuStates.push({
      fmu,
      busIdx,
      iRatedPeak,
      iqState: 0.0,
      ia,
      ib,
      ic,
      companion,
      lastGEq: companion ? new Float64Array(9) : undefined,
      lastIHist: companion ? new Float64Array(3) : undefined,
    });
  }

  // Register sources
  for (const src of (ctx.netlist.sources ?? []) as LegacySourceLike[]) {
    const bIdx = ctx.busIdxMap.get(src.bus) ?? 0;
    const rSrcRaw = src.rSourceOhm ?? src.rSource;
    const rSrc = rSrcRaw !== undefined && rSrcRaw > 0 ? rSrcRaw : ctx.defaultSrcR;
    const rawLSrc = src.lSourceHenry ?? src.lSourceH ?? 0;
    const lSrc = rawLSrc > 0 ? rawLSrc : 0.0;
    const zSrc = Math.hypot(rSrc, ctx.omega * lSrc);
    const gSrc = 1.0 / Math.max(zSrc, 1e-4);
    const llKv = src.voltageKv ?? src.kv;
    const vPeak =
      src.vPeakKv !== undefined && src.vPeakKv > 0
        ? src.vPeakKv * 1e3
        : ((llKv !== undefined && llKv > 0 ? llKv : ctx.busList[bIdx]?.baseKv || 230.0) * 1e3 * Math.SQRT2) /
          Math.sqrt(3.0);
    const freqRad = 2 * Math.PI * (src.frequencyHz || src.freqHz || ctx.netlist.nominalFrequencyHz || 60.0);
    const phaseRad =
      src.phaseRad !== undefined ? src.phaseRad : (((src.phaseDeg ?? src.phaseAngleDeg) || 0) * Math.PI) / 180.0;
    const list = ctx.busSources.get(bIdx) ?? [];
    list.push({ vPeak, freqRad, phaseRad, gSrc });
    ctx.busSources.set(bIdx, list);
  }

  // Register Induction / DFIG Machines as slip-dependent Norton equivalents
  for (const im of ctx.netlist.inductionMachines ?? []) {
    const busIdx = ctx.busIdxMap.get(im.bus);
    if (busIdx === undefined) continue;
    const vBaseKv = ctx.busList[busIdx]?.baseKv || im.ratedKvLL || 230.0;
    const mvaBase = im.ratedMva > 0 ? im.ratedMva : 10.0;
    const sBaseVa = mvaBase * 1e6;
    const vPeak = (vBaseKv * 1e3 * Math.SQRT2) / Math.sqrt(3);
    const zBase = (vBaseKv * 1e3) ** 2 / sBaseVa;
    const rStator = (im.rsPu !== undefined && im.rsPu > 0 ? im.rsPu : 0.01) * zBase;
    const xTrans = Math.max(0.05, (im.xsPu ?? 0.1) + (im.xrPu ?? 0.1)) * zBase;
    const gStator = 1.0 / Math.max(Math.hypot(rStator, xTrans), 1e-4);
    const { ia, ib, ic } = ctx.registerBranchBuffers(im.id);
    ctx.indMachineStates.push({
      id: im.id,
      busIdx,
      gStator,
      vPeak,
      eInternalPu: 0.95,
      slip: im.initialSlip ?? 0.02,
      thetaR: 0.0,
      hSec: im.hInertiaSec !== undefined && im.hInertiaSec > 0 ? im.hInertiaSec : 1.5,
      tmPu: im.mechanicalTorquePu ?? 0.8,
      sBaseVa,
      ia,
      ib,
      ic,
    });
    const list = ctx.busSources.get(busIdx) ?? [];
    list.push({ vPeak: 0.0, freqRad: 0, phaseRad: 0.0, gSrc: gStator });
    ctx.busSources.set(busIdx, list);
  }

  // Register Saturable Transformers for nonlinear magnetizing branch compensation
  for (const xf of ctx.netlist.saturableTransformers ?? []) {
    const primIdx = ctx.busIdxMap.get(xf.fromBus);
    const secIdx = ctx.busIdxMap.get(xf.toBus);
    if (primIdx === undefined) continue;
    const vBaseKv = xf.primaryKv > 0 ? xf.primaryKv : ctx.busList[primIdx]?.baseKv || 230.0;
    const vPeak = (vBaseKv * 1e3 * Math.SQRT2) / Math.sqrt(3);
    const lambdaKnee =
      xf.kneeFluxWb !== undefined && xf.kneeFluxWb > 0 ? xf.kneeFluxWb : 1.15 * (vPeak / Math.max(1e-3, ctx.omega));
    const mvaBase = xf.mvaRating > 0 ? xf.mvaRating : 100.0;
    const zBase = (vBaseKv * 1e3) ** 2 / (mvaBase * 1e6);
    const lSatH =
      xf.lSatH !== undefined && xf.lSatH > 0 ? xf.lSatH : Math.max(1e-5, (0.2 * zBase) / Math.max(1e-3, ctx.omega));
    const fluxRem = xf.remanentFluxWb ?? 0;
    ctx.satXfmrStates.push({
      id: xf.id,
      primIdx,
      secIdx: secIdx ?? -1,
      lambdaKnee,
      lSatH,
      fluxA: fluxRem,
      fluxB: -0.5 * fluxRem,
      fluxC: -0.5 * fluxRem,
      vPrevA: 0,
      vPrevB: 0,
      vPrevC: 0,
      iMagA: 0,
      iMagB: 0,
      iMagC: 0,
      coreModel: xf.coreModel,
      jaMs: xf.jaParams?.ms ?? 1.6e6,
      jaA: xf.jaParams?.a ?? 1100,
      jaK: xf.jaParams?.k ?? 400,
      jaC: xf.jaParams?.c ?? 0.2,
      jaAlpha: xf.jaParams?.alpha ?? 1.6e-3,
      mA: 0,
      mB: 0,
      mC: 0,
      hPrevA: 0,
      hPrevB: 0,
      hPrevC: 0,
    });
  }

  // Register switched 2-level VSC PWM & 6-pulse LCC thyristor converter bridges
  for (const conv of ctx.netlist.converterBridges ?? []) {
    if (conv.kind !== "vsc_pwm" && conv.kind !== "lcc_6pulse") continue;
    const acBusIdx = ctx.busIdxMap.get(conv.acBus) ?? -1;
    if (acBusIdx < 0) continue;
    const dcBusIdx = conv.dcBus ? (ctx.busIdxMap.get(conv.dcBus) ?? -1) : -1;
    const ratedKv = Math.max(1.0, conv.ratedKvLL || ctx.busList[acBusIdx]?.baseKv || 230.0);
    const ratedMva = Math.max(1.0, conv.ratedMva || 100.0);
    const zBase = (ratedKv * ratedKv) / ratedMva;
    const vPeakNom = (ratedKv * 1e3 * Math.SQRT2) / Math.sqrt(3.0);
    const iRatedPeak = (ratedMva * 1e6 * Math.SQRT2) / (Math.sqrt(3.0) * ratedKv * 1e3);
    const xFilterOhm = Math.max(0.05, 0.12 * zBase);
    const rFilterOhm = Math.max(0.01, 0.01 * zBase);
    const lFilterH = xFilterOhm / ctx.omega;
    const twoLfOverDt = (2.0 * lFilterH) / ctx.timeStepSec;
    const gChoke = 1.0 / (rFilterOhm + twoLfOverDt);
    const alphaChoke = (twoLfOverDt - rFilterOhm) / (twoLfOverDt + rFilterOhm);
    const vDcRefVolts = (conv.vDcRefKv ?? conv.vDcNominalKv ?? Math.max(1.5, 1.8 * ratedKv)) * 1e3;
    const cDcFarad = Math.max(1e-4, conv.dcCapacitanceF ?? 2e-3);
    const pRatedW = ratedMva * 1e6;
    const rDcLoadOhm = Math.max(1.0, conv.dcLoadOhm ?? (vDcRefVolts * vDcRefVolts) / Math.max(1e3, 0.8 * pRatedW));

    if (conv.kind === "vsc_pwm") {
      const list = ctx.busSources.get(acBusIdx) ?? [];
      list.push({ vPeak: 0.0, freqRad: 0, phaseRad: 0.0, gSrc: gChoke });
      ctx.busSources.set(acBusIdx, list);
    }
    if (dcBusIdx >= 0) {
      const gDc = 1.0 / Math.max(0.05, 0.01 * rDcLoadOhm);
      const listDc = ctx.busSources.get(dcBusIdx) ?? [];
      listDc.push({ vPeak: 0.0, freqRad: 0, phaseRad: 0.0, gSrc: gDc });
      ctx.busSources.set(dcBusIdx, listDc);
    }

    const { ia, ib, ic } = ctx.registerBranchBuffers(conv.id);
    const vDcTraj = new Float64Array(ctx.nSteps);
    ctx.controlSignals.set(`${conv.id}_Vdc`, vDcTraj);

    const state: ConverterBridgeRuntimeState = {
      conv,
      acBusIdx,
      dcBusIdx,
      gChoke,
      alphaChoke,
      iHistChokeA: 0.0,
      iHistChokeB: 0.0,
      iHistChokeC: 0.0,
      vPeakNom,
      iRatedPeak,
      vDcRefVolts,
      vDcVolts: vDcRefVolts,
      iDcAmp: (0.8 * pRatedW) / Math.max(100.0, vDcRefVolts),
      cDcFarad,
      rDcLoadOhm,
      thetaPll: 0.0,
      intErrD: 0.0,
      intErrQ: 0.0,
      intErrVdc: 0.0,
      vPoleA: 0.0,
      vPoleB: 0.0,
      vPoleC: 0.0,
      muRad: 0.08,
      gammaRad: Math.PI - ((conv.firingAngleDeg ?? 15) * Math.PI) / 180 - 0.08,
      ia,
      ib,
      ic,
      vDcTraj,
    };

    if (conv.kind === "lcc_6pulse") {
      state.iDcTraj = new Float64Array(ctx.nSteps);
      state.muDegTraj = new Float64Array(ctx.nSteps);
      state.gammaDegTraj = new Float64Array(ctx.nSteps);
      ctx.controlSignals.set(`${conv.id}_Idc`, state.iDcTraj);
      ctx.controlSignals.set(`${conv.id}_muDeg`, state.muDegTraj);
      ctx.controlSignals.set(`${conv.id}_gammaDeg`, state.gammaDegTraj);
    } else {
      state.pMwTraj = new Float64Array(ctx.nSteps);
      state.qMvarTraj = new Float64Array(ctx.nSteps);
      state.mIndexTraj = new Float64Array(ctx.nSteps);
      ctx.controlSignals.set(`${conv.id}_P_mw`, state.pMwTraj);
      ctx.controlSignals.set(`${conv.id}_Q_mvar`, state.qMvarTraj);
      ctx.controlSignals.set(`${conv.id}_mIndex`, state.mIndexTraj);
    }

    ctx.bridgeRuntimeStates.push(state);
  }

  // Islanded bus stabilization
  for (let i = 0; i < ctx.nBuses; i++) {
    const hasSyncGen = ctx.syncGenerators.some((g) => g.busIdx === i);
    if (!ctx.busSources.has(i) && !hasSyncGen) {
      const hasBranch =
        ctx.companionBranches.some((b) => b.fromIdx === i || b.toIdx === i) ||
        ctx.bergeronLines.some((l) => l.fromIdx === i || l.toIdx === i) ||
        ctx.ulmLines.some((l) => l.fromIdx === i || l.toIdx === i) ||
        ctx.nUlmLines.some((l) => l.fromIdx === i || l.toIdx === i);
      const gStab = hasBranch ? 1e-5 : 1e-4;
      ctx.busSources.set(i, [{ vPeak: 0.0, freqRad: 0, phaseRad: 0.0, gSrc: gStab }]);
    }
  }

  // Register EMTDC Fortran / C / Binary UDM blocks
  if (ctx.netlist.customFortranBlocks && ctx.netlist.customFortranBlocks.length > 0) {
    ctx.emtdcHostBridge = new EmtdcHostBridge({
      timeStepSec: ctx.timeStepSec,
      maxNodes: Math.max(1024, ctx.nBuses + 1),
    });

    for (const block of ctx.netlist.customFortranBlocks) {
      let udm: EmtdcRegisteredUdm;
      let runner: EmtdcWasmMachinaDllRunner | undefined;
      if (block.binaryBuffer) {
        const drmOptions =
          ctx.options.drmLicenseOptions ??
          (ctx.options.strictDrmLicense || block.requireHardwareDongle
            ? {
                mode: "strict" as const,
                allowedFirmCodes: block.drmFirmCode !== undefined ? [block.drmFirmCode] : undefined,
                allowedProductCodes: block.drmProductCode !== undefined ? [block.drmProductCode] : undefined,
              }
            : undefined);
        const res = ctx.emtdcHostBridge.registerBinaryDll({
          id: block.id,
          binaryBuffer: block.binaryBuffer,
          dsdynSymbol: block.dsdynSymbol,
          dsoutSymbol: block.dsoutSymbol,
          portNames: (block.referencedPorts ?? []).concat(block.assignedPorts ?? []),
          numRealStates: block.numRealStates,
          numIntStates: block.numIntStates,
          drmOptions,
        });
        udm = res.udm;
        runner = res.runner;
      } else if (block.step) {
        udm = ctx.emtdcHostBridge.registerCustomFortranBlock(block);
      } else {
        udm = ctx.emtdcHostBridge.registerUdm({
          id: block.id,
          subroutineName: block.name,
          numRealStates: block.numRealStates,
          numIntStates: block.numIntStates,
        });
      }

      const busId =
        block.connectedBus ??
        block.outputs?.find((o) => ctx.busIdxMap.has(o.targetId ?? ""))?.targetId ??
        block.inputs?.find((i) => ctx.busIdxMap.has(i.sourceId ?? ""))?.sourceId;
      const busIdx = busId ? (ctx.busIdxMap.get(busId) ?? -1) : -1;

      let ia: Float64Array | undefined;
      let ib: Float64Array | undefined;
      let ic: Float64Array | undefined;
      if (busIdx >= 0) {
        const buffers = ctx.registerBranchBuffers(block.id);
        ia = buffers.ia;
        ib = buffers.ib;
        ic = buffers.ic;
      }

      const signalTrajs = new Map<string, Float64Array>();
      const allPorts = (block.assignedPorts ?? []).concat(block.referencedPorts ?? []);
      for (const port of allPorts) {
        const traj = new Float64Array(ctx.nSteps);
        signalTrajs.set(port, traj);
        ctx.controlSignals.set(`${block.id}_${port}`, traj);
      }

      ctx.customBlockStates.push({
        block,
        udm,
        runner,
        busIdx,
        ia,
        ib,
        ic,
        signalTrajs,
      });
    }
  }
}
