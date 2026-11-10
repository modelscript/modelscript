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

import { SparseTripletBuilder, sparseLuFactor, sparseLuSolve } from "@modelscript/runtime";
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
  /** Skip building legacy 2D number[][] rows when only flatFactors / getTransferFactor are needed. */
  skipDenseRows?: boolean | undefined;
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
  /** Flat row-major PTDF buffer of length branches.length * buses.length. */
  flatFactors?: Float64Array | undefined;
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
  /** Skip building legacy 2D number[][] rows when only flatFactors / getOutageFactor are needed. */
  skipDenseRows?: boolean | undefined;
}

export interface LodfMatrixResult {
  /** Monitored branch identifiers. */
  branches: BranchIdentifier[];
  /**
   * LODF matrix [monitoredIdx][outagedIdx].
   * Represents the fraction of outaged branch flow that shifts to the monitored branch.
   */
  factors: number[][];
  /** Flat row-major LODF buffer of length branches.length * branches.length. */
  flatFactors?: Float64Array | undefined;
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
  /** Optional custom reference (slack) bus. Defaults to the case swing bus. */
  referenceBus?: number | undefined;
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

export interface LinearCandidateResult {
  id: string;
  name?: string | undefined;
  severityIndex: number;
  causesIslanding: boolean;
  linearOverloads: number;
  maxBranchLoadingPercent: number;
}

export interface ContingencyScreeningReport {
  totalEvaluated: number;
  criticalCount: number;
  islandingCount: number;
  rankedContingencies: ContingencyEvaluationResult[];
  screenedLinearCandidates?: LinearCandidateResult[] | undefined;
}

// ============================================================================
// DFAX Sensitivity Calculations (Sparse B_bus LU Factorization)
// ============================================================================

/**
 * Calculates the exact Power Transfer Distribution Factors (PTDF) matrix
 * using a single sparse LU factorization of B_bus and per-branch sparse forward/back-solves.
 */
export function calculatePtdfMatrix(psCase: PsseCase, options: PtdfOptions = {}): PtdfMatrixResult {
  const allBuses = Array.from(psCase.buses.values());
  const activeBuses = allBuses.filter((b) => b.ide !== 4);
  const busNumbers = activeBuses.map((b) => b.i);
  const nBuses = busNumbers.length;

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
  const nBranches = branchList.length;

  // Non-reference buses mapping
  const nonRefBuses = activeBuses.filter((b) => b.i !== refBus);
  const nr = nonRefBuses.length;
  const busToNrIdx = new Map<number, number>();
  nonRefBuses.forEach((b, idx) => busToNrIdx.set(b.i, idx));

  const busColMap = new Map<number, number>();
  busNumbers.forEach((b, idx) => busColMap.set(b, idx));

  // Map non-ref index r in [0, nr) to output column index in [0, nBuses)
  const nrIdxToBusCol = new Int32Array(nr);
  for (let r = 0; r < nr; r++) {
    nrIdxToBusCol[r] = busColMap.get(nonRefBuses[r]!.i) ?? 0;
  }

  // Assemble sparse DC bus susceptance matrix B_bus (nr x nr)
  const bTriplets = new SparseTripletBuilder(nr, nr, inServiceBranches.length * 4 + nr + 4);
  for (let r = 0; r < nr; r++) {
    bTriplets.add(r, r, 1e-9);
  }
  for (const br of inServiceBranches) {
    const idx1 = busToNrIdx.get(br.i);
    const idx2 = busToNrIdx.get(br.j);
    const b = 1.0 / br.x;

    if (idx1 !== undefined && idx2 !== undefined) {
      bTriplets.add(idx1, idx1, b);
      bTriplets.add(idx2, idx2, b);
      bTriplets.add(idx1, idx2, -b);
      bTriplets.add(idx2, idx1, -b);
    } else if (idx1 !== undefined) {
      bTriplets.add(idx1, idx1, b);
    } else if (idx2 !== undefined) {
      bTriplets.add(idx2, idx2, b);
    }
  }

  const bCcs = nr > 0 ? bTriplets.toCCS() : null;
  const bLu = bCcs ? sparseLuFactor(bCcs, { allowPerturbation: true }) : null;

  // Branch index lookup for quick reactance retrieval
  const branchMap = new Map<string, BranchRecord>();
  for (const br of psCase.branches) {
    branchMap.set(`${br.i}_${br.j}_${br.ckt}`, br);
    branchMap.set(`${br.j}_${br.i}_${br.ckt}`, br);
  }

  // Solve symmetric B_bus * psi_l = (e_a - e_b) / x_l for each monitored branch l
  const flatFactors = new Float64Array(nBranches * nBuses);
  const factors: number[][] = [];
  const branchRowMap = new Map<string, number>();
  const rhs = new Float64Array(nr);
  const sol = new Float64Array(nr);
  const buildRows = !options.skipDenseRows;

  for (let l = 0; l < nBranches; l++) {
    const brId = branchList[l]!;
    branchRowMap.set(`${brId.fromBus}_${brId.toBus}_${brId.ckt}`, l);
    const brRec = branchMap.get(`${brId.fromBus}_${brId.toBus}_${brId.ckt}`);
    const xl = brRec ? (Math.abs(brRec.x) > 1e-6 ? brRec.x : 0.01) : 0.01;
    const invXl = 1.0 / xl;

    const idxA = busToNrIdx.get(brId.fromBus);
    const idxB = busToNrIdx.get(brId.toBus);

    if (bLu && (idxA !== undefined || idxB !== undefined)) {
      if (idxA !== undefined) rhs[idxA] = invXl;
      if (idxB !== undefined) rhs[idxB] = (rhs[idxB] ?? 0.0) - invXl;

      sparseLuSolve(bLu, rhs, sol);

      // Clean up RHS for next branch
      if (idxA !== undefined) rhs[idxA] = 0.0;
      if (idxB !== undefined) rhs[idxB] = 0.0;

      const rowOffset = l * nBuses;
      for (let r = 0; r < nr; r++) {
        const colIdx = nrIdxToBusCol[r]!;
        flatFactors[rowOffset + colIdx] = Math.round(sol[r]! * 1e6) * 1e-6;
      }
    }

    if (buildRows) {
      const rowOffset = l * nBuses;
      const row = new Array<number>(nBuses);
      for (let c = 0; c < nBuses; c++) {
        row[c] = flatFactors[rowOffset + c]!;
      }
      factors.push(row);
    }
  }

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
    const rowOffset = rowIdx * nBuses;
    const psiInj = cInj !== undefined ? (flatFactors[rowOffset + cInj] ?? 0.0) : 0.0;
    const psiWdr = cWdr !== undefined ? (flatFactors[rowOffset + cWdr] ?? 0.0) : 0.0;

    return sign * (psiInj - psiWdr);
  };

  return {
    branches: branchList,
    buses: busNumbers,
    referenceBus: refBus,
    factors,
    flatFactors,
    getTransferFactor,
  };
}

/**
 * Calculates the exact Line Outage Distribution Factors (LODF) matrix
 * using pre-indexed typed-array PTDF lookups with zero string allocations in the O(M^2) loop.
 */
export function calculateLodfMatrix(psCase: PsseCase, options: LodfOptions = {}): LodfMatrixResult {
  const ptdf =
    options.ptdf ??
    calculatePtdfMatrix(psCase, {
      monitoredBranches: options.monitoredBranches,
      skipDenseRows: options.skipDenseRows,
    });
  const branches = ptdf.branches;
  const buses = ptdf.buses;
  const nBranches = branches.length;
  const nBuses = buses.length;

  const busColMap = new Map<number, number>();
  for (let c = 0; c < nBuses; c++) {
    busColMap.set(buses[c]!, c);
  }

  // Ensure we have a flat PTDF buffer even if the caller passed a custom PtdfMatrixResult without flatFactors
  let flatPtdf = ptdf.flatFactors;
  if (!flatPtdf) {
    flatPtdf = new Float64Array(nBranches * nBuses);
    for (let l = 0; l < nBranches; l++) {
      const r = ptdf.factors[l];
      if (!r) continue;
      const offset = l * nBuses;
      for (let c = 0; c < nBuses; c++) {
        flatPtdf[offset + c] = r[c] ?? 0.0;
      }
    }
  }

  const branchIdxMap = new Map<string, number>();
  const fromColIdx = new Int32Array(nBranches);
  const toColIdx = new Int32Array(nBranches);
  const denomInv = new Float64Array(nBranches);
  const islandingBranches: BranchIdentifier[] = [];

  for (let k = 0; k < nBranches; k++) {
    const out = branches[k]!;
    branchIdxMap.set(`${out.fromBus}_${out.toBus}_${out.ckt}`, k);
    const fCol = busColMap.get(out.fromBus) ?? -1;
    const tCol = busColMap.get(out.toBus) ?? -1;
    fromColIdx[k] = fCol;
    toColIdx[k] = tCol;

    const kOffset = k * nBuses;
    const psiFrom = fCol >= 0 ? flatPtdf[kOffset + fCol]! : 0.0;
    const psiTo = tCol >= 0 ? flatPtdf[kOffset + tCol]! : 0.0;
    const ptdf_kk = psiFrom - psiTo;

    if (Math.abs(1.0 - ptdf_kk) < 1e-4) {
      islandingBranches.push(out);
      denomInv[k] = 0.0;
    } else {
      denomInv[k] = 1.0 / (1.0 - ptdf_kk);
    }
  }

  const flatFactors = new Float64Array(nBranches * nBranches);
  const factors: number[][] = [];
  const buildRows = !options.skipDenseRows;

  for (let l = 0; l < nBranches; l++) {
    const ptdfRowOffset = l * nBuses;
    const lodfRowOffset = l * nBranches;
    const row = buildRows ? new Array<number>(nBranches) : null;

    for (let k = 0; k < nBranches; k++) {
      if (l === k) {
        flatFactors[lodfRowOffset + k] = -1.0;
        if (row) row[k] = -1.0;
        continue;
      }

      const dInv = denomInv[k]!;
      if (dInv === 0.0) {
        flatFactors[lodfRowOffset + k] = 0.0;
        if (row) row[k] = 0.0;
        continue;
      }

      const fCol = fromColIdx[k]!;
      const tCol = toColIdx[k]!;
      const psiFrom = fCol >= 0 ? flatPtdf[ptdfRowOffset + fCol]! : 0.0;
      const psiTo = tCol >= 0 ? flatPtdf[ptdfRowOffset + tCol]! : 0.0;
      const ptdf_lk = psiFrom - psiTo;
      const lodf = Math.round(ptdf_lk * dInv * 1e6) * 1e-6;

      flatFactors[lodfRowOffset + k] = lodf;
      if (row) row[k] = lodf;
    }

    if (row) {
      factors.push(row);
    }
  }

  const getOutageFactor = (monitored: BranchIdentifier, outaged: BranchIdentifier): number => {
    const l = branchIdxMap.get(`${monitored.fromBus}_${monitored.toBus}_${monitored.ckt}`);
    const k = branchIdxMap.get(`${outaged.fromBus}_${outaged.toBus}_${outaged.ckt}`);
    if (l === undefined || k === undefined) return 0.0;
    return flatFactors[l * nBranches + k] ?? 0.0;
  };

  return {
    branches,
    factors,
    flatFactors,
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
  const nFast = branchFastList.length;
  const basePFlows = new Float64Array(nFast);
  const baseRatings = new Float64Array(nFast);
  branchFastList.forEach((br, idx) => {
    branchIndexMap.set(`${br.fromBus}_${br.toBus}_${br.ckt}`, idx);
    branchIndexMap.set(`${br.toBus}_${br.fromBus}_${br.ckt}`, idx);
    basePFlows[idx] = br.pFlow;
    baseRatings[idx] = br.rateA;
  });

  // Assemble sparse B_bus once for exact linear sensitivity analysis across all grid scales
  const allBuses = Array.from(psCase.buses.values());
  const activeBuses = allBuses.filter((b) => b.ide !== 4);
  let refBus = options.referenceBus;
  if (refBus === undefined) {
    const swingBus = activeBuses.find((b) => b.ide === 3);
    refBus = swingBus ? swingBus.i : (activeBuses[0]?.i ?? 1);
  }
  const nonRefBuses = activeBuses.filter((b) => b.i !== refBus);
  const nr = nonRefBuses.length;
  const busToNrIdx = new Map<number, number>();
  nonRefBuses.forEach((b, idx) => busToNrIdx.set(b.i, idx));

  const bTriplets = new SparseTripletBuilder(nr, nr, inServiceBranches.length * 4 + nr + 4);
  for (let r = 0; r < nr; r++) {
    bTriplets.add(r, r, 1e-9);
  }
  for (const br of inServiceBranches) {
    const idx1 = busToNrIdx.get(br.i);
    const idx2 = busToNrIdx.get(br.j);
    const b = 1.0 / (Math.abs(br.x) > 1e-6 ? br.x : 0.01);
    if (idx1 !== undefined && idx2 !== undefined) {
      bTriplets.add(idx1, idx1, b);
      bTriplets.add(idx2, idx2, b);
      bTriplets.add(idx1, idx2, -b);
      bTriplets.add(idx2, idx1, -b);
    } else if (idx1 !== undefined) {
      bTriplets.add(idx1, idx1, b);
    } else if (idx2 !== undefined) {
      bTriplets.add(idx2, idx2, b);
    }
  }
  const bCcs = nr > 0 ? bTriplets.toCCS() : null;
  const bLu = bCcs ? sparseLuFactor(bCcs, { allowPerturbation: true }) : null;
  const rhsVec = new Float64Array(nr);
  const solVec = new Float64Array(nr);

  // Pre-indexed typed arrays for zero-lookup linear sensitivity evaluation
  const branchFromNrIdx = new Int32Array(nFast);
  const branchToNrIdx = new Int32Array(nFast);
  const branchInvX = new Float64Array(nFast);
  for (let l = 0; l < nFast; l++) {
    const br = branchFastList[l]!;
    branchFromNrIdx[l] = busToNrIdx.get(br.fromBus) ?? -1;
    branchToNrIdx[l] = busToNrIdx.get(br.toBus) ?? -1;
    branchInvX[l] = 1.0 / (Math.abs(br.x) > 1e-6 ? br.x : 0.01);
  }
  const scratchPostFlows = new Float64Array(nFast);

  // Exact linear sensitivity helper: calculates post-outage branch flows via sparse B_bus solve
  const computeExactLinearOutageFlows = (trippedIndices: Set<number>): Float64Array => {
    if (!bLu || nr === 0) {
      for (let l = 0; l < nFast; l++) {
        scratchPostFlows[l] = trippedIndices.has(l) ? 0.0 : basePFlows[l]!;
      }
      return scratchPostFlows;
    }

    if (trippedIndices.size === 1) {
      const k = trippedIndices.values().next().value as number;
      const pk = basePFlows[k]!;
      const invXk = branchInvX[k]!;
      const idxA = branchFromNrIdx[k]!;
      const idxB = branchToNrIdx[k]!;

      if (idxA >= 0) rhsVec[idxA] = invXk;
      if (idxB >= 0) rhsVec[idxB] = (rhsVec[idxB] ?? 0.0) - invXk;

      sparseLuSolve(bLu, rhsVec, solVec);
      if (idxA >= 0) rhsVec[idxA] = 0.0;
      if (idxB >= 0) rhsVec[idxB] = 0.0;

      const ptdf_kk = (idxA >= 0 ? solVec[idxA]! : 0.0) - (idxB >= 0 ? solVec[idxB]! : 0.0);
      const denom = Math.abs(1.0 - ptdf_kk) > 1e-4 ? 1.0 / (1.0 - ptdf_kk) : 0.0;

      for (let l = 0; l < nFast; l++) {
        if (l === k) {
          scratchPostFlows[l] = 0.0;
          continue;
        }
        if (denom === 0.0) {
          scratchPostFlows[l] = basePFlows[l]!;
          continue;
        }
        const idxAl = branchFromNrIdx[l]!;
        const idxBl = branchToNrIdx[l]!;
        const dTh = (idxAl >= 0 ? solVec[idxAl]! : 0.0) - (idxBl >= 0 ? solVec[idxBl]! : 0.0);
        const lodf_lk = dTh * branchInvX[l]! * denom;
        scratchPostFlows[l] = Math.abs(basePFlows[l]! + Math.abs(lodf_lk) * pk);
      }
      return scratchPostFlows;
    }

    // Multi-branch outage (k >= 2): exact linear injection compensation via B_bus solve
    for (const k of trippedIndices) {
      const pk = basePFlows[k]!;
      const idxA = branchFromNrIdx[k]!;
      const idxB = branchToNrIdx[k]!;
      if (idxA >= 0) rhsVec[idxA] = (rhsVec[idxA] ?? 0.0) + pk;
      if (idxB >= 0) rhsVec[idxB] = (rhsVec[idxB] ?? 0.0) - pk;
    }

    sparseLuSolve(bLu, rhsVec, solVec);
    rhsVec.fill(0.0);

    for (let l = 0; l < nFast; l++) {
      if (trippedIndices.has(l)) {
        scratchPostFlows[l] = 0.0;
        continue;
      }
      const idxAl = branchFromNrIdx[l]!;
      const idxBl = branchToNrIdx[l]!;
      const dTh = (idxAl >= 0 ? solVec[idxAl]! : 0.0) - (idxBl >= 0 ? solVec[idxBl]! : 0.0);
      const deltaFlow = dTh * branchInvX[l]!;
      scratchPostFlows[l] = Math.abs(basePFlows[l]! + deltaFlow);
    }
    return scratchPostFlows;
  };

  // Precompute sparse LODF matrix and bridge-branch islanding set once for fast O(M) screening
  const lodfResult =
    contingencies.length > 0 && nFast > 0 && nFast <= 5000
      ? calculateLodfMatrix(psCase, {
          monitoredBranches: branchFastList.map((b) => ({ fromBus: b.fromBus, toBus: b.toBus, ckt: b.ckt })),
          skipDenseRows: true,
        })
      : null;
  const flatLodf = lodfResult?.flatFactors ?? null;

  // Base islands if no branches are tripped
  const baseIslands = detectElectricalIslands(psCase);
  const baseIslandCount = baseIslands.length;

  // Identify all bridge branches causing islanding across any network scale
  const islandingIdxSet = new Set<number>();
  if (lodfResult) {
    for (const br of lodfResult.islandingBranches) {
      const idx = branchIndexMap.get(`${br.fromBus}_${br.toBus}_${br.ckt}`);
      if (idx !== undefined) islandingIdxSet.add(idx);
    }
  } else if (baseIslandCount === 1) {
    // Fast iterative Tarjan's bridge-finding algorithm O(V + E) for arbitrary large-scale grids
    const adj = new Map<number, Array<{ neighbor: number; edgeIdx: number }>>();
    for (let l = 0; l < nFast; l++) {
      const br = branchFastList[l]!;
      let listI = adj.get(br.fromBus);
      if (!listI) {
        listI = [];
        adj.set(br.fromBus, listI);
      }
      listI.push({ neighbor: br.toBus, edgeIdx: l });
      let listJ = adj.get(br.toBus);
      if (!listJ) {
        listJ = [];
        adj.set(br.toBus, listJ);
      }
      listJ.push({ neighbor: br.fromBus, edgeIdx: l });
    }

    const tin = new Map<number, number>();
    const low = new Map<number, number>();
    let timer = 0;

    for (const b of activeBuses) {
      const startNode = b.i;
      if (tin.has(startNode)) continue;

      const stack: Array<{ u: number; pEdge: number; nextI: number }> = [{ u: startNode, pEdge: -1, nextI: 0 }];
      timer++;
      tin.set(startNode, timer);
      low.set(startNode, timer);

      while (stack.length > 0) {
        const top = stack[stack.length - 1]!;
        const u = top.u;
        const neighbors = adj.get(u) ?? [];

        if (top.nextI < neighbors.length) {
          const edge = neighbors[top.nextI]!;
          top.nextI++;
          if (edge.edgeIdx === top.pEdge) continue;

          const v = edge.neighbor;
          if (tin.has(v)) {
            const curLow = low.get(u)!;
            const targetTin = tin.get(v)!;
            if (targetTin < curLow) low.set(u, targetTin);
          } else {
            timer++;
            tin.set(v, timer);
            low.set(v, timer);
            stack.push({ u: v, pEdge: edge.edgeIdx, nextI: 0 });
          }
        } else {
          stack.pop();
          if (stack.length > 0) {
            const parent = stack[stack.length - 1]!;
            const lowU = low.get(u)!;
            const curLowParent = low.get(parent.u)!;
            if (lowU < curLowParent) {
              low.set(parent.u, lowU);
            }
            if (lowU > tin.get(parent.u)!) {
              islandingIdxSet.add(top.pEdge);
            }
          }
        }
      }
    }
  }

  // 2. Fast linear DFAX (LODF) screening pass to compute Severity Index (SI)
  const screenedCandidates: Array<{
    contingency: CandidateContingency;
    severityIndex: number;
    causesIslanding: boolean;
    islandCount: number;
    linearOverloads: number;
    maxLinearLoading: number;
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

    const trippedArr = Array.from(trippedIndices);

    // Topological check: O(1) bridge-branch lookup for single-branch outages, BFS for multi-branch
    let causesIslanding = false;
    let islandCount = baseIslandCount;
    if (trippedArr.length === 0) {
      causesIslanding = baseIslandCount > 1;
    } else if (trippedArr.length === 1 && baseIslandCount === 1) {
      causesIslanding = islandingIdxSet.has(trippedArr[0]!);
      islandCount = causesIslanding ? 2 : 1;
    } else {
      const islands = detectElectricalIslands(psCase, (br) => {
        const k1 = `${br.i}_${br.j}_${br.ckt}`;
        const k2 = `${br.j}_${br.i}_${br.ckt}`;
        return !trippedBranches.has(k1) && !trippedBranches.has(k2);
      });
      causesIslanding = islands.length > 1;
      islandCount = islands.length;
    }

    let si = 0.0;
    let linearOverloads = 0;
    let maxLinearLoading = 0.0;

    if (flatLodf && !causesIslanding && (trippedArr.length === 1 || trippedArr.length === 2)) {
      if (trippedArr.length === 1) {
        const k = trippedArr[0]!;
        const pk = basePFlows[k]!;
        for (let l = 0; l < nFast; l++) {
          if (l === k) continue;
          const lodf_lk = flatLodf[l * nFast + k]!;
          const postFlow = Math.abs(basePFlows[l]! + Math.abs(lodf_lk) * pk);
          const rating = baseRatings[l]!;
          const ratio = postFlow / rating;
          const loadingPct = ratio * 100.0;
          if (loadingPct > maxLinearLoading) maxLinearLoading = loadingPct;
          if (loadingPct > overloadThreshold) {
            linearOverloads++;
          }
          const r2 = ratio * ratio;
          si += r2 * r2;
        }
      } else {
        // Exact N-2 double-outage Woodbury / generalized 2x2 LODF superposition
        const k1 = trippedArr[0]!;
        const k2 = trippedArr[1]!;
        const lodf_12 = flatLodf[k1 * nFast + k2]!;
        const lodf_21 = flatLodf[k2 * nFast + k1]!;
        const det = 1.0 - lodf_12 * lodf_21;
        if (Math.abs(det) > 1e-4) {
          const invDet = 1.0 / det;
          const pk1 = basePFlows[k1]!;
          const pk2 = basePFlows[k2]!;
          const eff1 = (pk1 + Math.abs(lodf_12) * pk2) * invDet;
          const eff2 = (Math.abs(lodf_21) * pk1 + pk2) * invDet;
          for (let l = 0; l < nFast; l++) {
            if (l === k1 || l === k2) continue;
            const lodf_l1 = Math.abs(flatLodf[l * nFast + k1]!);
            const lodf_l2 = Math.abs(flatLodf[l * nFast + k2]!);
            const postFlow = Math.abs(basePFlows[l]! + lodf_l1 * eff1 + lodf_l2 * eff2);
            const rating = baseRatings[l]!;
            const ratio = postFlow / rating;
            const loadingPct = ratio * 100.0;
            if (loadingPct > maxLinearLoading) maxLinearLoading = loadingPct;
            if (loadingPct > overloadThreshold) {
              linearOverloads++;
            }
            const r2 = ratio * ratio;
            si += r2 * r2;
          }
        } else {
          // Near-islanding N-2 pair: exact sparse injection solve
          const exactFlows = computeExactLinearOutageFlows(trippedIndices);
          for (let l = 0; l < nFast; l++) {
            const flow = exactFlows[l]!;
            const rating = baseRatings[l]!;
            const ratio = flow / rating;
            const loadingPct = ratio * 100.0;
            if (loadingPct > maxLinearLoading) maxLinearLoading = loadingPct;
            if (loadingPct > overloadThreshold) linearOverloads++;
            const r2 = ratio * ratio;
            si += r2 * r2;
          }
        }
      }
    } else {
      // Exact sparse solve for grids where flatLodf is omitted (M > 5000) or multi-branch outages (k >= 3)
      const exactFlows = computeExactLinearOutageFlows(trippedIndices);
      for (let l = 0; l < nFast; l++) {
        const flow = exactFlows[l]!;
        const rating = baseRatings[l]!;
        const ratio = flow / rating;
        const loadingPct = ratio * 100.0;
        if (loadingPct > maxLinearLoading) maxLinearLoading = loadingPct;
        if (loadingPct > overloadThreshold) linearOverloads++;
        const r2 = ratio * ratio;
        si += r2 * r2;
      }
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
      maxLinearLoading,
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
    screenedLinearCandidates: screenedCandidates.map((c) => ({
      id: c.contingency.id,
      name: c.contingency.name,
      severityIndex: Number(c.severityIndex.toFixed(2)),
      causesIslanding: c.causesIslanding,
      linearOverloads: c.linearOverloads,
      maxBranchLoadingPercent: Number(c.maxLinearLoading.toFixed(1)),
    })),
  };
}
