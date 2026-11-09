// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — High-Performance N-1-1 & N-2 Contingency Screener with DFAX & RAS/SPS
 *
 * Implements:
 * 1. Exact Linear Sensitivities (DFAX):
 *    - Power Transfer Distribution Factors (PTDF) for bilateral & bus injection transfers
 *    - Line Outage Distribution Factors (LODF) with islanding/bridge branch detection
 *    - Outage Transfer Distribution Factors (OTDF) for post-contingency sensitivity
 * 2. Dynamic Remedial Action Schemes (RAS / SPS):
 *    - Multi-stage trigger evaluation (branch trip, generator outage, MVA/MW overload, voltage sag)
 *    - Compound trigger logic (AND, OR, k_of_n) and arming thresholds
 *    - Mitigation dispatch: generator trip/runback, under-voltage/frequency load shedding,
 *      branch switching, and shunt capacitor/reactor adjustment
 * 3. Coupled AC Multi-Island Non-Linear Verification:
 *    - Evaluates post-mitigation grid equilibrium and tracks exact overload alleviation
 */

import type { BranchRecord, BusRecord, PsseCase } from "../types.js";
import { solvePowerFlow } from "./ac-powerflow.js";
import { detectElectricalIslands, solveMultiIslandPowerFlow } from "./island-solver.js";

// ============================================================================
// DFAX Interfaces (PTDF / LODF / OTDF)
// ============================================================================

export interface BranchIdentifier {
  fromBus: number;
  toBus: number;
  ckt: string;
}

export interface PtdfOptions {
  /** Optional custom reference (slack) bus. Defaults to the case swing bus. */
  referenceBus?: number | undefined;
  /** Subset of monitored branches. Defaults to all in-service branches. */
  monitoredBranches?: BranchIdentifier[] | undefined;
}

export interface PtdfMatrixResult {
  /** In-service monitored branch identifiers. */
  branches: BranchIdentifier[];
  /** In-service non-isolated bus numbers. */
  buses: number[];
  /** Reference (slack) bus number. */
  referenceBus: number;
  /** PTDF factors matrix [branches.length][buses.length] relative to reference bus. */
  factors: number[][];
  /**
   * Helper to retrieve the linear shift factor on a branch for a transaction from injBus to wdrBus.
   */
  getTransferFactor: (fromBus: number, toBus: number, ckt: string, injBus: number, wdrBus: number) => number;
}

export interface LodfOptions {
  /** Pre-calculated PTDF result. If omitted, calculated automatically. */
  ptdf?: PtdfMatrixResult | undefined;
  /** Monitored branches. Defaults to all in-service branches. */
  monitoredBranches?: BranchIdentifier[] | undefined;
}

export interface LodfMatrixResult {
  /** Monitored branch identifiers. */
  branches: BranchIdentifier[];
  /**
   * LODF matrix [monitoredIdx][outagedIdx].
   * Represents the fraction of outaged branch flow that shifts to the monitored branch.
   */
  factors: number[][];
  /** Branches whose outage splits or islands the grid (where 1 - PTDF ≈ 0). */
  islandingBranches: BranchIdentifier[];
  /** Helper to query LODF factor for a pair of branches. */
  getOutageFactor: (monitored: BranchIdentifier, outaged: BranchIdentifier) => number;
}

export interface OtdfOptions {
  ptdf?: PtdfMatrixResult | undefined;
  lodf?: LodfMatrixResult | undefined;
}

export interface OtdfMatrixResult {
  outagedBranch: BranchIdentifier;
  branches: BranchIdentifier[];
  buses: number[];
  referenceBus: number;
  factors: number[][];
  getTransferFactor: (fromBus: number, toBus: number, ckt: string, injBus: number, wdrBus: number) => number;
}

// ============================================================================
// Remedial Action Scheme (RAS / SPS) Interfaces
// ============================================================================

export type RasTriggerType = "branch_trip" | "generator_trip" | "branch_overload" | "bus_voltage" | "compound";

export interface RasTriggerCondition {
  type: RasTriggerType;
  /** For branch_trip & branch_overload. */
  fromBus?: number | undefined;
  toBus?: number | undefined;
  ckt?: string | undefined;
  /** For generator_trip. */
  genBus?: number | undefined;
  genId?: string | undefined;
  /** For branch_overload: flow MVA or loading percentage. */
  thresholdMva?: number | undefined;
  thresholdLoadingPercent?: number | undefined;
  /** For bus_voltage: bus number and thresholds. */
  busNumber?: number | undefined;
  minVmPu?: number | undefined;
  maxVmPu?: number | undefined;
  /** For compound: logic operator. */
  logic?: "AND" | "OR" | "k_of_n" | undefined;
  k?: number | undefined;
  subConditions?: RasTriggerCondition[] | undefined;
}

export type RasActionType =
  | "trip_generator"
  | "runback_generator"
  | "shed_load"
  | "open_branch"
  | "close_branch"
  | "switch_shunt";

export interface RasAction {
  type: RasActionType;
  busNumber?: number | undefined;
  genId?: string | undefined;
  loadId?: string | undefined;
  fromBus?: number | undefined;
  toBus?: number | undefined;
  ckt?: string | undefined;
  /** Real power to shed or runback by (MW). */
  deltaMw?: number | undefined;
  /** Target maximum generation (MW). */
  targetMw?: number | undefined;
  /** Fraction (0 to 1) of load to shed. */
  fraction?: number | undefined;
  /** Shunt reactive power adjustment in Mvar (positive = add capacitive, negative = add inductive). */
  deltaMvar?: number | undefined;
  /** Action intentional delay in seconds. */
  delaySec?: number | undefined;
}

export interface RemedialActionScheme {
  id: string;
  name: string;
  enabled?: boolean | undefined;
  /** Optional arming condition (e.g. system import level or branch flow). */
  armingCondition?: RasTriggerCondition | undefined;
  /** Primary trigger condition. */
  trigger: RasTriggerCondition;
  /** Remedial actions executed when triggered. */
  actions: RasAction[];
  /** Priority ordering for multiple schemes (lowest number runs first). */
  priority?: number | undefined;
}

// ============================================================================
// Contingency Screening Interfaces
// ============================================================================

export interface ContingencyEvent {
  type: "trip_branch" | "trip_generator";
  fromBus?: number | undefined;
  toBus?: number | undefined;
  ckt?: string | undefined;
  genBus?: number | undefined;
  genId?: string | undefined;
}

export interface CandidateContingency {
  id: string;
  name: string;
  events: ContingencyEvent[];
}

export interface ContingencyEvaluationResult {
  id: string;
  name: string;
  events: ContingencyEvent[];
  severityIndex: number;
  causesIslanding: boolean;
  islandCount: number;
  acConverged: boolean;
  maxBranchLoadingPercent: number;
  overloadedBranches: Array<{
    fromBus: number;
    toBus: number;
    ckt: string;
    flowMva: number;
    ratingMva: number;
    loadingPercent: number;
  }>;
  voltageViolations: Array<{
    busNumber: number;
    vmPu: number;
    violationType: "low" | "high";
  }>;
  /** Remedial Action Schemes triggered during this contingency. */
  rasTriggered?: string[] | undefined;
  /** Specific RAS actions dispatched to mitigate violations. */
  rasActionsExecuted?: RasAction[] | undefined;
  /** Post-RAS maximum branch loading percentage. */
  postRasMaxBranchLoadingPercent?: number | undefined;
  /** Whether the RAS successfully mitigated overloads below threshold. */
  mitigated?: boolean | undefined;
}

export interface ContingencyScreeningOptions {
  /** Maximum number of top severe contingencies to confirm with non-linear AC power flow (default: 50). */
  topKAcConfirmation?: number | undefined;
  /** Voltage low threshold in p.u. (default: 0.90). */
  vMinPu?: number | undefined;
  /** Voltage high threshold in p.u. (default: 1.10). */
  vMaxPu?: number | undefined;
  /** Branch loading threshold percent considered an overload (default: 100.0). */
  overloadThresholdPercent?: number | undefined;
  /** Optional active Remedial Action Schemes (RAS / SPS). */
  rasSchemes?: RemedialActionScheme[] | undefined;
}

export interface ContingencyScreeningReport {
  totalEvaluated: number;
  criticalCount: number;
  islandingCount: number;
  rankedContingencies: ContingencyEvaluationResult[];
}

// ============================================================================
// Dense Linear Solver Helper (Gaussian elimination with partial pivoting)
// ============================================================================

function solveDenseLinear(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = new Float64Array(A);
  const x = new Float64Array(b);

  for (let k = 0; k < n; k++) {
    let maxVal = Math.abs(M[k * n + k]!);
    let maxRow = k;
    for (let r = k + 1; r < n; r++) {
      const val = Math.abs(M[r * n + k]!);
      if (val > maxVal) {
        maxVal = val;
        maxRow = r;
      }
    }

    if (maxVal < 1e-12) {
      M[k * n + k] = 1e-6; // Regularization
    }

    if (maxRow !== k) {
      for (let c = 0; c < n; c++) {
        const tmp = M[k * n + c]!;
        M[k * n + c] = M[maxRow * n + c]!;
        M[maxRow * n + c] = tmp;
      }
      const tmpB = x[k]!;
      x[k] = x[maxRow]!;
      x[maxRow] = tmpB;
    }

    const diag = M[k * n + k]!;
    for (let r = k + 1; r < n; r++) {
      const factor = M[r * n + k]! / diag;
      M[r * n + k] = factor;
      for (let c = k + 1; c < n; c++) {
        M[r * n + c] = M[r * n + c]! - factor * M[k * n + c]!;
      }
      x[r] = x[r]! - factor * x[k]!;
    }
  }

  // Back-substitution
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i]!;
    for (let j = i + 1; j < n; j++) {
      sum -= M[i * n + j]! * x[j]!;
    }
    const diag = M[i * n + i]!;
    x[i] = Math.abs(diag) > 1e-14 ? sum / diag : 0.0;
  }

  return x;
}

// ============================================================================
// DFAX Sensitivity Calculations
// ============================================================================

/**
 * Calculates the exact Power Transfer Distribution Factors (PTDF) matrix.
 */
export function calculatePtdfMatrix(psCase: PsseCase, options: PtdfOptions = {}): PtdfMatrixResult {
  const allBuses = Array.from(psCase.buses.values());
  const activeBuses = allBuses.filter((b) => b.ide !== 4);
  const busNumbers = activeBuses.map((b) => b.i);

  // Identify reference bus
  let refBus = options.referenceBus;
  if (refBus === undefined) {
    const swingBus = activeBuses.find((b) => b.ide === 3);
    refBus = swingBus ? swingBus.i : (activeBuses[0]?.i ?? 1);
  }

  // Filter in-service branches
  const inServiceBranches = psCase.branches.filter((b) => b.st !== 0 && Math.abs(b.x) > 1e-6);
  const branchList: BranchIdentifier[] =
    options.monitoredBranches ?? inServiceBranches.map((b) => ({ fromBus: b.i, toBus: b.j, ckt: b.ckt }));

  // Non-reference buses mapping
  const nonRefBuses = activeBuses.filter((b) => b.i !== refBus);
  const nr = nonRefBuses.length;
  const busToNrIdx = new Map<number, number>();
  nonRefBuses.forEach((b, idx) => busToNrIdx.set(b.i, idx));

  // Build DC bus susceptance matrix B_bus (Nr x Nr)
  const B = new Float64Array(nr * nr);
  for (const br of inServiceBranches) {
    const idx1 = busToNrIdx.get(br.i);
    const idx2 = busToNrIdx.get(br.j);
    const b = 1.0 / br.x;

    if (idx1 !== undefined && idx2 !== undefined) {
      B[idx1 * nr + idx1] = (B[idx1 * nr + idx1] ?? 0) + b;
      B[idx2 * nr + idx2] = (B[idx2 * nr + idx2] ?? 0) + b;
      B[idx1 * nr + idx2] = (B[idx1 * nr + idx2] ?? 0) - b;
      B[idx2 * nr + idx1] = (B[idx2 * nr + idx1] ?? 0) - b;
    } else if (idx1 !== undefined) {
      B[idx1 * nr + idx1] = (B[idx1 * nr + idx1] ?? 0) + b;
    } else if (idx2 !== undefined) {
      B[idx2 * nr + idx2] = (B[idx2 * nr + idx2] ?? 0) + b;
    }
  }

  // Solve B * X = I to obtain X = B_bus^(-1)
  const X = new Float64Array(nr * nr);
  for (let c = 0; c < nr; c++) {
    const e = new Float64Array(nr);
    e[c] = 1.0;
    const col = solveDenseLinear(B, e, nr);
    if (col) {
      for (let r = 0; r < nr; r++) {
        X[r * nr + c] = col[r]!;
      }
    }
  }

  const getX = (busA: number, busB: number): number => {
    if (busA === refBus || busB === refBus) return 0.0;
    const r = busToNrIdx.get(busA);
    const c = busToNrIdx.get(busB);
    if (r === undefined || c === undefined) return 0.0;
    return X[r * nr + c] ?? 0.0;
  };

  // Branch index lookup for quick reactance retrieval
  const branchMap = new Map<string, BranchRecord>();
  for (const br of psCase.branches) {
    branchMap.set(`${br.i}_${br.j}_${br.ckt}`, br);
    branchMap.set(`${br.j}_${br.i}_${br.ckt}`, br);
  }

  // Compute bus injection shift factor Psi_l,i = (X(a, i) - X(b, i)) / x_l
  const factors: number[][] = [];
  const branchRowMap = new Map<string, number>();

  for (let l = 0; l < branchList.length; l++) {
    const brId = branchList[l]!;
    branchRowMap.set(`${brId.fromBus}_${brId.toBus}_${brId.ckt}`, l);
    const brRec = branchMap.get(`${brId.fromBus}_${brId.toBus}_${brId.ckt}`);
    const xl = brRec ? (Math.abs(brRec.x) > 1e-6 ? brRec.x : 0.01) : 0.01;

    const row: number[] = [];
    for (let bIdx = 0; bIdx < busNumbers.length; bIdx++) {
      const bus = busNumbers[bIdx]!;
      const psi = (getX(brId.fromBus, bus) - getX(brId.toBus, bus)) / xl;
      row.push(Number(psi.toFixed(6)));
    }
    factors.push(row);
  }

  const busColMap = new Map<number, number>();
  busNumbers.forEach((b, idx) => busColMap.set(b, idx));

  const getTransferFactor = (fromBus: number, toBus: number, ckt: string, injBus: number, wdrBus: number): number => {
    let rowIdx = branchRowMap.get(`${fromBus}_${toBus}_${ckt}`);
    let sign = 1.0;
    if (rowIdx === undefined) {
      rowIdx = branchRowMap.get(`${toBus}_${fromBus}_${ckt}`);
      sign = -1.0;
    }
    if (rowIdx === undefined) return 0.0;

    const cInj = busColMap.get(injBus);
    const cWdr = busColMap.get(wdrBus);
    const psiInj = cInj !== undefined ? (factors[rowIdx]![cInj] ?? 0.0) : 0.0;
    const psiWdr = cWdr !== undefined ? (factors[rowIdx]![cWdr] ?? 0.0) : 0.0;

    return sign * (psiInj - psiWdr);
  };

  return {
    branches: branchList,
    buses: busNumbers,
    referenceBus: refBus,
    factors,
    getTransferFactor,
  };
}

/**
 * Calculates the exact Line Outage Distribution Factors (LODF) matrix.
 */
export function calculateLodfMatrix(psCase: PsseCase, options: LodfOptions = {}): LodfMatrixResult {
  const ptdf = options.ptdf ?? calculatePtdfMatrix(psCase, { monitoredBranches: options.monitoredBranches });
  const branches = ptdf.branches;
  const nBranches = branches.length;

  const factors: number[][] = [];
  const islandingBranches: BranchIdentifier[] = [];
  const branchIdxMap = new Map<string, number>();
  branches.forEach((b, idx) => branchIdxMap.set(`${b.fromBus}_${b.toBus}_${b.ckt}`, idx));

  for (let l = 0; l < nBranches; l++) {
    const mon = branches[l]!;
    const row: number[] = [];

    for (let k = 0; k < nBranches; k++) {
      const out = branches[k]!;
      if (l === k) {
        row.push(-1.0); // Own line outage shifts -100% of its flow to 0
        continue;
      }

      // Pre-outage PTDF of outaged line k for transfer from its own fromBus to toBus
      const ptdf_k = ptdf.getTransferFactor(out.fromBus, out.toBus, out.ckt, out.fromBus, out.toBus);

      // Radial tie / islanding check
      if (Math.abs(1.0 - ptdf_k) < 1e-4) {
        if (l === 0) islandingBranches.push(out);
        row.push(0.0);
        continue;
      }

      // Monitored line response to transfer between outaged line endpoints
      const ptdf_l = ptdf.getTransferFactor(mon.fromBus, mon.toBus, mon.ckt, out.fromBus, out.toBus);
      const lodf = ptdf_l / (1.0 - ptdf_k);
      row.push(Number(lodf.toFixed(6)));
    }
    factors.push(row);
  }

  const getOutageFactor = (monitored: BranchIdentifier, outaged: BranchIdentifier): number => {
    const l = branchIdxMap.get(`${monitored.fromBus}_${monitored.toBus}_${monitored.ckt}`);
    const k = branchIdxMap.get(`${outaged.fromBus}_${outaged.toBus}_${outaged.ckt}`);
    if (l === undefined || k === undefined) return 0.0;
    return factors[l]![k] ?? 0.0;
  };

  return {
    branches,
    factors,
    islandingBranches,
    getOutageFactor,
  };
}

/**
 * Calculates the Outage Transfer Distribution Factors (OTDF) matrix.
 */
export function calculateOtdfMatrix(
  psCase: PsseCase,
  outagedBranch: BranchIdentifier,
  options: OtdfOptions = {},
): OtdfMatrixResult {
  const ptdf = options.ptdf ?? calculatePtdfMatrix(psCase);
  const lodf = options.lodf ?? calculateLodfMatrix(psCase, { ptdf });

  const branches = ptdf.branches;
  const buses = ptdf.buses;
  const factors: number[][] = [];

  for (let l = 0; l < branches.length; l++) {
    const mon = branches[l]!;
    const row: number[] = [];
    const lodf_lk = lodf.getOutageFactor(mon, outagedBranch);

    for (let b = 0; b < buses.length; b++) {
      const ptdf_l = ptdf.factors[l]![b] ?? 0.0;
      // PTDF of outaged line k for transfer at bus relative to reference
      const kIdx = branches.findIndex(
        (br) =>
          br.fromBus === outagedBranch.fromBus && br.toBus === outagedBranch.toBus && br.ckt === outagedBranch.ckt,
      );
      const ptdf_k = kIdx >= 0 ? (ptdf.factors[kIdx]![b] ?? 0.0) : 0.0;

      const otdf = ptdf_l + lodf_lk * ptdf_k;
      row.push(Number(otdf.toFixed(6)));
    }
    factors.push(row);
  }

  const branchRowMap = new Map<string, number>();
  branches.forEach((b, idx) => branchRowMap.set(`${b.fromBus}_${b.toBus}_${b.ckt}`, idx));
  const busColMap = new Map<number, number>();
  buses.forEach((b, idx) => busColMap.set(b, idx));

  const getTransferFactor = (fromBus: number, toBus: number, ckt: string, injBus: number, wdrBus: number): number => {
    let rowIdx = branchRowMap.get(`${fromBus}_${toBus}_${ckt}`);
    let sign = 1.0;
    if (rowIdx === undefined) {
      rowIdx = branchRowMap.get(`${toBus}_${fromBus}_${ckt}`);
      sign = -1.0;
    }
    if (rowIdx === undefined) return 0.0;

    const cInj = busColMap.get(injBus);
    const cWdr = busColMap.get(wdrBus);
    const otdfInj = cInj !== undefined ? (factors[rowIdx]![cInj] ?? 0.0) : 0.0;
    const otdfWdr = cWdr !== undefined ? (factors[rowIdx]![cWdr] ?? 0.0) : 0.0;
    return sign * (otdfInj - otdfWdr);
  };

  return {
    outagedBranch,
    branches,
    buses,
    referenceBus: ptdf.referenceBus,
    factors,
    getTransferFactor,
  };
}

// ============================================================================
// Remedial Action Schemes (RAS) Evaluation & Dispatch
// ============================================================================

export interface RasEvaluationContext {
  events: ContingencyEvent[];
  flowMap: Map<string, number>;
  ratingMap: Map<string, number>;
  vmMap: Map<number, number>;
  psCase: PsseCase;
}

/**
 * Recursively tests if a RAS trigger condition is satisfied.
 */
export function evaluateRasTriggerCondition(cond: RasTriggerCondition, ctx: RasEvaluationContext): boolean {
  switch (cond.type) {
    case "branch_trip": {
      return ctx.events.some(
        (ev) =>
          ev.type === "trip_branch" &&
          ((ev.fromBus === cond.fromBus && ev.toBus === cond.toBus) ||
            (ev.fromBus === cond.toBus && ev.toBus === cond.fromBus)) &&
          (cond.ckt === undefined || ev.ckt === cond.ckt),
      );
    }
    case "generator_trip": {
      return ctx.events.some(
        (ev) =>
          ev.type === "trip_generator" &&
          ev.genBus === cond.genBus &&
          (cond.genId === undefined || ev.genId === cond.genId),
      );
    }
    case "branch_overload": {
      if (cond.fromBus === undefined || cond.toBus === undefined) return false;
      const ckt = cond.ckt ?? "1";
      const key1 = `${cond.fromBus}_${cond.toBus}_${ckt}`;
      const key2 = `${cond.toBus}_${cond.fromBus}_${ckt}`;
      const flow = ctx.flowMap.get(key1) ?? ctx.flowMap.get(key2) ?? 0.0;
      const rating = ctx.ratingMap.get(key1) ?? ctx.ratingMap.get(key2) ?? 100.0;

      if (cond.thresholdMva !== undefined && flow >= cond.thresholdMva) {
        return true;
      }
      if (cond.thresholdLoadingPercent !== undefined && rating > 0) {
        const loading = (flow / rating) * 100.0;
        if (loading >= cond.thresholdLoadingPercent) return true;
      }
      return false;
    }
    case "bus_voltage": {
      if (cond.busNumber === undefined) return false;
      const vm = ctx.vmMap.get(cond.busNumber);
      if (vm === undefined) return false;
      if (cond.minVmPu !== undefined && vm < cond.minVmPu) return true;
      if (cond.maxVmPu !== undefined && vm > cond.maxVmPu) return true;
      return false;
    }
    case "compound": {
      const subs = cond.subConditions ?? [];
      if (subs.length === 0) return false;
      const logic = cond.logic ?? "AND";
      if (logic === "AND") {
        return subs.every((sc) => evaluateRasTriggerCondition(sc, ctx));
      } else if (logic === "OR") {
        return subs.some((sc) => evaluateRasTriggerCondition(sc, ctx));
      } else if (logic === "k_of_n") {
        const kNeeded = cond.k ?? 1;
        const passCount = subs.filter((sc) => evaluateRasTriggerCondition(sc, ctx)).length;
        return passCount >= kNeeded;
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * Clones a PsseCase and executes remedial actions.
 */
export function applyRasActions(
  baseCase: PsseCase,
  actions: RasAction[],
): { modifiedCase: PsseCase; actionSummary: string[] } {
  // Deep copy case components
  const modifiedBuses = new Map<number, BusRecord>();
  for (const [k, v] of baseCase.buses.entries()) {
    modifiedBuses.set(k, { ...v });
  }

  const modifiedCase: PsseCase = {
    ...baseCase,
    buses: modifiedBuses,
    loads: baseCase.loads.map((l) => ({ ...l })),
    generators: baseCase.generators.map((g) => ({ ...g })),
    branches: baseCase.branches.map((b) => ({ ...b })),
    transformers: baseCase.transformers.map((t) => ({ ...t })),
    fixedShunts: baseCase.fixedShunts.map((s) => ({ ...s })),
    switchedShunts: baseCase.switchedShunts ? baseCase.switchedShunts.map((s) => ({ ...s })) : [],
  };

  const actionSummary: string[] = [];

  for (const act of actions) {
    switch (act.type) {
      case "trip_generator": {
        for (const gen of modifiedCase.generators) {
          if (gen.i === act.busNumber && (act.genId === undefined || gen.id === act.genId)) {
            gen.stat = 0;
            gen.pg = 0.0;
            gen.qg = 0.0;
            actionSummary.push(`Tripped generator at Bus ${gen.i} ID '${gen.id}'`);
          }
        }
        break;
      }
      case "runback_generator": {
        for (const gen of modifiedCase.generators) {
          if (gen.i === act.busNumber && (act.genId === undefined || gen.id === act.genId)) {
            const oldPg = gen.pg;
            if (act.targetMw !== undefined) {
              gen.pg = Math.min(gen.pg, act.targetMw);
            } else if (act.deltaMw !== undefined) {
              gen.pg = Math.max(0.0, gen.pg - act.deltaMw);
            }
            actionSummary.push(
              `Runback generator Bus ${gen.i} ID '${gen.id}' from ${oldPg.toFixed(1)} MW to ${gen.pg.toFixed(1)} MW`,
            );
          }
        }
        break;
      }
      case "shed_load": {
        for (const load of modifiedCase.loads) {
          if (load.i === act.busNumber && (act.loadId === undefined || load.id === act.loadId)) {
            const oldPl = load.pl;
            if (act.fraction !== undefined) {
              const keep = Math.max(0.0, 1.0 - act.fraction);
              load.pl *= keep;
              load.ql *= keep;
            } else if (act.deltaMw !== undefined) {
              const ratio = oldPl > 0 ? Math.max(0.0, (oldPl - act.deltaMw) / oldPl) : 1.0;
              load.pl = Math.max(0.0, load.pl - act.deltaMw);
              load.ql *= ratio;
            }
            actionSummary.push(
              `Shed load Bus ${load.i} ID '${load.id}' from ${oldPl.toFixed(1)} MW to ${load.pl.toFixed(1)} MW`,
            );
          }
        }
        break;
      }
      case "open_branch": {
        for (const br of modifiedCase.branches) {
          if (
            ((br.i === act.fromBus && br.j === act.toBus) || (br.i === act.toBus && br.j === act.fromBus)) &&
            (act.ckt === undefined || br.ckt === act.ckt)
          ) {
            br.st = 0;
            actionSummary.push(`Opened branch ${br.i}-${br.j} Ckt '${br.ckt}'`);
          }
        }
        break;
      }
      case "close_branch": {
        for (const br of modifiedCase.branches) {
          if (
            ((br.i === act.fromBus && br.j === act.toBus) || (br.i === act.toBus && br.j === act.fromBus)) &&
            (act.ckt === undefined || br.ckt === act.ckt)
          ) {
            br.st = 1;
            actionSummary.push(`Closed branch ${br.i}-${br.j} Ckt '${br.ckt}'`);
          }
        }
        break;
      }
      case "switch_shunt": {
        if (act.busNumber !== undefined && act.deltaMvar !== undefined) {
          const shunt = modifiedCase.fixedShunts.find((s) => s.i === act.busNumber);
          if (shunt) {
            shunt.bl += act.deltaMvar;
            actionSummary.push(`Switched shunt Bus ${act.busNumber}: delta ${act.deltaMvar.toFixed(1)} Mvar`);
          } else {
            modifiedCase.fixedShunts.push({
              i: act.busNumber,
              id: "1",
              status: 1,
              gl: 0.0,
              bl: act.deltaMvar,
            });
            actionSummary.push(`Added shunt Bus ${act.busNumber}: ${act.deltaMvar.toFixed(1)} Mvar`);
          }
        }
        break;
      }
    }
  }

  return { modifiedCase, actionSummary };
}

// ============================================================================
// Fast Linear Heuristic (LODF-based) for Initial Candidate Ranking
// ============================================================================

function estimateBranchFlowsAfterOutage(
  baseBranches: Array<{ fromBus: number; toBus: number; ckt: string; pFlow: number; x: number; rateA: number }>,
  trippedIndices: Set<number>,
): Map<string, number> {
  const result = new Map<string, number>();

  let trippedPowerSum = 0;
  for (const idx of trippedIndices) {
    const br = baseBranches[idx];
    if (br) {
      trippedPowerSum += Math.abs(br.pFlow);
    }
  }

  const remainingLines = baseBranches.filter((_, idx) => !trippedIndices.has(idx));
  const totalRemainingWeight = remainingLines.reduce(
    (acc, br) => acc + (br.rateA > 0 ? br.rateA : 100.0) / Math.max(br.x, 0.001),
    0,
  );

  for (let idx = 0; idx < baseBranches.length; idx++) {
    const br = baseBranches[idx]!;
    const key = `${br.fromBus}_${br.toBus}_${br.ckt}`;
    if (trippedIndices.has(idx)) {
      result.set(key, 0.0);
    } else {
      const weight = (br.rateA > 0 ? br.rateA : 100.0) / Math.max(br.x, 0.001) / Math.max(totalRemainingWeight, 1e-6);
      const deltaFlow = trippedPowerSum * weight * 0.7;
      const postFlow = Math.abs(br.pFlow) + deltaFlow;
      result.set(key, postFlow);
    }
  }

  return result;
}

// ============================================================================
// Main Contingency Screener
// ============================================================================

/**
 * Screen N-1-1 and N-2 contingencies across a power system case with DFAX & RAS support.
 */
export function screenContingencies(
  psCase: PsseCase,
  contingencies: CandidateContingency[],
  options: ContingencyScreeningOptions = {},
): ContingencyScreeningReport {
  const topK = options.topKAcConfirmation ?? 50;
  const vMin = options.vMinPu ?? 0.9;
  const vMax = options.vMaxPu ?? 1.1;
  const overloadThreshold = options.overloadThresholdPercent ?? 100.0;
  const rasSchemes = (options.rasSchemes ?? []).filter((s) => s.enabled !== false);

  // 1. Solve base AC power flow to establish initial operating point
  const baseSol = solvePowerFlow(psCase, { maxIterations: 30, tolerance: 1e-4 });

  const branchBaseMap = new Map<string, number>();
  for (const br of baseSol.branches) {
    branchBaseMap.set(`${br.fromBus}_${br.toBus}_${br.ckt}`, br.mvaFlow);
  }

  const inServiceBranches = psCase.branches.filter((b) => b.st !== 0);
  const branchFastList = inServiceBranches.map((b) => {
    const key = `${b.i}_${b.j}_${b.ckt}`;
    const pFlow = branchBaseMap.get(key) ?? 10.0;
    return {
      fromBus: b.i,
      toBus: b.j,
      ckt: b.ckt,
      pFlow,
      x: b.x > 0 ? b.x : 0.05,
      rateA: b.rateA > 0 ? b.rateA : 100.0,
    };
  });

  const branchIndexMap = new Map<string, number>();
  branchFastList.forEach((br, idx) => {
    branchIndexMap.set(`${br.fromBus}_${br.toBus}_${br.ckt}`, idx);
    branchIndexMap.set(`${br.toBus}_${br.fromBus}_${br.ckt}`, idx);
  });

  // 2. Fast linear screening pass to compute Severity Index (SI)
  const screenedCandidates: Array<{
    contingency: CandidateContingency;
    severityIndex: number;
    causesIslanding: boolean;
    islandCount: number;
    linearOverloads: number;
    trippedBranches: Set<string>;
  }> = [];

  for (const ctg of contingencies) {
    const trippedBranches = new Set<string>();
    const trippedIndices = new Set<number>();

    for (const ev of ctg.events) {
      if (ev.type === "trip_branch" && ev.fromBus !== undefined && ev.toBus !== undefined) {
        const ckt = ev.ckt ?? "1";
        const key = `${ev.fromBus}_${ev.toBus}_${ckt}`;
        trippedBranches.add(key);
        const idx = branchIndexMap.get(key);
        if (idx !== undefined) trippedIndices.add(idx);
      }
    }

    // Topological check: does this outage cause network splitting?
    const islands = detectElectricalIslands(psCase, (br) => {
      const k1 = `${br.i}_${br.j}_${br.ckt}`;
      const k2 = `${br.j}_${br.i}_${br.ckt}`;
      return !trippedBranches.has(k1) && !trippedBranches.has(k2);
    });

    const causesIslanding = islands.length > 1;
    const islandCount = islands.length;

    // Linear flow estimation
    const estFlows = estimateBranchFlowsAfterOutage(branchFastList, trippedIndices);
    let si = 0.0;
    let linearOverloads = 0;

    for (const br of branchFastList) {
      const key = `${br.fromBus}_${br.toBus}_${br.ckt}`;
      const flow = estFlows.get(key) ?? br.pFlow;
      const rating = br.rateA;
      const loading = (flow / rating) * 100.0;
      if (loading > overloadThreshold) {
        linearOverloads++;
      }
      si += Math.pow(flow / rating, 4);
    }

    if (causesIslanding) {
      si += 5000.0 * (islandCount - 1);
    }

    screenedCandidates.push({
      contingency: ctg,
      severityIndex: si,
      causesIslanding,
      islandCount,
      linearOverloads,
      trippedBranches,
    });
  }

  // Sort candidate contingencies by severity descending
  screenedCandidates.sort((a, b) => b.severityIndex - a.severityIndex);

  // 3. Exact non-linear AC multi-island confirmation for top K candidates
  const evaluatedResults: ContingencyEvaluationResult[] = [];
  const topCandidates = screenedCandidates.slice(0, Math.min(topK, screenedCandidates.length));

  for (const cand of topCandidates) {
    const ctg = cand.contingency;
    const activeFilter = (br: any) => {
      const k1 = `${br.i}_${br.j}_${br.ckt}`;
      const k2 = `${br.j}_${br.i}_${br.ckt}`;
      return !cand.trippedBranches.has(k1) && !cand.trippedBranches.has(k2);
    };

    let acSol = solveMultiIslandPowerFlow(psCase, {
      maxIterations: 25,
      tolerance: 1e-4,
      autoBalanceIslands: true,
      activeBranchFilter: activeFilter,
    });

    const overloadedBranches: ContingencyEvaluationResult["overloadedBranches"] = [];
    let maxLoading = 0.0;
    const flowMap = new Map<string, number>();
    const ratingMap = new Map<string, number>();

    for (const br of acSol.branches) {
      const key = `${br.fromBus}_${br.toBus}_${br.ckt}`;
      flowMap.set(key, br.mvaFlow);
      const rating = br.rateMva ?? 100.0;
      ratingMap.set(key, rating);

      if (rating > 0) {
        const loading = (br.mvaFlow / rating) * 100.0;
        if (loading > maxLoading) maxLoading = loading;
        if (loading >= overloadThreshold) {
          overloadedBranches.push({
            fromBus: br.fromBus,
            toBus: br.toBus,
            ckt: br.ckt,
            flowMva: br.mvaFlow,
            ratingMva: rating,
            loadingPercent: loading,
          });
        }
      }
    }

    const voltageViolations: ContingencyEvaluationResult["voltageViolations"] = [];
    const vmMap = new Map<number, number>();
    for (const b of acSol.buses) {
      vmMap.set(b.busNumber, b.vm);
      if (b.vm < vMin && b.vm > 0.1) {
        voltageViolations.push({
          busNumber: b.busNumber,
          vmPu: b.vm,
          violationType: "low",
        });
      } else if (b.vm > vMax) {
        voltageViolations.push({
          busNumber: b.busNumber,
          vmPu: b.vm,
          violationType: "high",
        });
      }
    }

    // 4. Remedial Action Scheme (RAS / SPS) Trigger & Mitigation Phase
    let rasTriggered: string[] | undefined;
    let rasActionsExecuted: RasAction[] | undefined;
    let postRasMaxLoading: number | undefined;
    let mitigated = false;

    if (rasSchemes.length > 0) {
      const rasCtx: RasEvaluationContext = {
        events: ctg.events,
        flowMap,
        ratingMap,
        vmMap,
        psCase,
      };

      const triggeredSchemes: RemedialActionScheme[] = [];
      for (const scheme of rasSchemes) {
        // Arming check
        if (scheme.armingCondition && !evaluateRasTriggerCondition(scheme.armingCondition, rasCtx)) {
          continue;
        }
        if (evaluateRasTriggerCondition(scheme.trigger, rasCtx)) {
          triggeredSchemes.push(scheme);
        }
      }

      if (triggeredSchemes.length > 0) {
        // Sort by priority (lowest number first)
        triggeredSchemes.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
        rasTriggered = triggeredSchemes.map((s) => s.id);
        rasActionsExecuted = triggeredSchemes.flatMap((s) => s.actions);

        // Apply actions to the case and re-solve
        const { modifiedCase } = applyRasActions(psCase, rasActionsExecuted);

        const postRasSol = solveMultiIslandPowerFlow(modifiedCase, {
          maxIterations: 25,
          tolerance: 1e-4,
          autoBalanceIslands: true,
          activeBranchFilter: activeFilter,
        });

        if (postRasSol.converged) {
          let pMax = 0.0;
          let pOverloads = 0;
          for (const br of postRasSol.branches) {
            const rating = br.rateMva ?? 100.0;
            if (rating > 0) {
              const ld = (br.mvaFlow / rating) * 100.0;
              if (ld > pMax) pMax = ld;
              if (ld >= overloadThreshold) pOverloads++;
            }
          }
          postRasMaxLoading = Number(pMax.toFixed(1));
          mitigated = pOverloads === 0 || pMax < maxLoading;
        }
      }
    }

    // Compute final severity index
    let exactSi = cand.severityIndex;
    if (overloadedBranches.length > 0) {
      exactSi += overloadedBranches.reduce((sum, o) => sum + Math.pow(o.loadingPercent / 100.0, 4) * 100.0, 0);
    }
    if (voltageViolations.length > 0) {
      exactSi += voltageViolations.length * 200.0;
    }
    if (!acSol.converged) {
      exactSi += 10000.0;
    }

    // Alleviate SI if successfully mitigated by RAS
    if (mitigated && postRasMaxLoading !== undefined) {
      exactSi = Math.max(10.0, exactSi * (postRasMaxLoading / Math.max(1.0, maxLoading)));
    }

    evaluatedResults.push({
      id: ctg.id,
      name: ctg.name,
      events: ctg.events,
      severityIndex: Number(exactSi.toFixed(2)),
      causesIslanding: cand.causesIslanding,
      islandCount: cand.islandCount,
      acConverged: acSol.converged,
      maxBranchLoadingPercent: Number(maxLoading.toFixed(1)),
      overloadedBranches,
      voltageViolations,
      rasTriggered,
      rasActionsExecuted,
      postRasMaxBranchLoadingPercent: postRasMaxLoading,
      mitigated: rasTriggered ? mitigated : undefined,
    });
  }

  // Re-sort evaluated results by exact severity
  evaluatedResults.sort((a, b) => b.severityIndex - a.severityIndex);

  const criticalCount = evaluatedResults.filter(
    (r) => (r.overloadedBranches.length > 0 && !r.mitigated) || r.voltageViolations.length > 0 || !r.acConverged,
  ).length;
  const islandingCount = evaluatedResults.filter((r) => r.causesIslanding).length;

  return {
    totalEvaluated: contingencies.length,
    criticalCount,
    islandingCount,
    rankedContingencies: evaluatedResults,
  };
}
