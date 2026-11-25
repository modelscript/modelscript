// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unified Multi-Tool Steady-State Power Flow Comparison Engine.
 *
 * Normalizes steady-state bus voltages (V, theta) and branch flows (P, Q)
 * across phasor (PSS/E, OpenDSS, PSLF, PowerFactory, MATPOWER, CGMES) and
 * EMT steady-state (PSCAD fundamental-frequency phasor extraction) solvers,
 * computing per-bus / per-branch deltas and overall parity status.
 */

export interface PowerFlowBusSnapshot {
  busId: string;
  name?: string | undefined;
  baseKv?: number | undefined;
  vmPu: number;
  vaDeg: number;
  pGenMw?: number | undefined;
  qGenMvar?: number | undefined;
  pLoadMw?: number | undefined;
  qLoadMvar?: number | undefined;
}

export interface PowerFlowBranchSnapshot {
  id: string;
  fromBus: string;
  toBus: string;
  ckt?: string | undefined;
  pFlowMw: number;
  qFlowMvar: number;
  loadingPct?: number | undefined;
}

export interface PowerFlowSnapshot {
  solver: string;
  label?: string | undefined;
  converged: boolean;
  frequencyHz: number;
  sbaseMva: number;
  buses: PowerFlowBusSnapshot[];
  branches: PowerFlowBranchSnapshot[];
  executionTimeMs?: number | undefined;
}

export interface PowerFlowBusDelta {
  busId: string;
  comparatorBusId: string;
  baseKv?: number | undefined;
  baselineVmPu: number;
  comparatorVmPu: number;
  deltaVmPu: number;
  baselineVaDeg: number;
  comparatorVaDeg: number;
  deltaVaDeg: number;
  withinTolerance: boolean;
}

export interface PowerFlowBranchDelta {
  id: string;
  fromBus: string;
  toBus: string;
  baselinePMw: number;
  comparatorPMw: number;
  deltaPMw: number;
  baselineQMvar: number;
  comparatorQMvar: number;
  deltaQMvar: number;
  withinTolerance: boolean;
}

export type PowerFlowParityStatus = "PASS" | "WARN" | "FAIL";

export interface PowerFlowPairComparison {
  baselineSolver: string;
  comparatorSolver: string;
  status: PowerFlowParityStatus;
  matchedBuses: number;
  matchedBranches: number;
  maxDeltaVmPu: number;
  rmseDeltaVmPu: number;
  maxDeltaVaDeg: number;
  maxDeltaPMw: number;
  maxDeltaQMvar: number;
  busDeltas: PowerFlowBusDelta[];
  branchDeltas: PowerFlowBranchDelta[];
}

export interface PowerFlowComparisonOptions {
  /** Maximum allowable bus voltage magnitude difference in p.u. (default: 0.005). */
  vmTolerancePu?: number | undefined;
  /** Maximum allowable bus voltage angle difference in degrees (default: 0.5). */
  vaToleranceDeg?: number | undefined;
  /** Maximum allowable branch active power flow difference in MW (default: 2.0). */
  pToleranceMw?: number | undefined;
  /** Maximum allowable branch reactive power flow difference in Mvar (default: 2.0). */
  qToleranceMvar?: number | undefined;
  /** Optional map from comparator busId -> baseline busId when naming differs. */
  busIdMap?: Readonly<Record<string, string>> | undefined;
}

export interface PowerFlowComparisonReport {
  baselineSolver: string;
  solversCompared: string[];
  overallStatus: PowerFlowParityStatus;
  maxDeltaVmPu: number;
  maxDeltaVaDeg: number;
  maxDeltaPMw: number;
  pairs: PowerFlowPairComparison[];
  snapshots: PowerFlowSnapshot[];
  summaryText: string;
}

function normalizeAngleDiffDeg(aDeg: number, bDeg: number): number {
  let d = (aDeg - bDeg) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
}

function normalizeBusKey(raw: string): string {
  return raw
    .trim()
    .replace(/^bus[_\s-]*/i, "")
    .toLowerCase();
}

/**
 * Compares a baseline `PowerFlowSnapshot` (typically PSS/E) against one or more
 * comparator snapshots (e.g. PSCAD steady-state, OpenDSS, PSLF, PowerFactory, MATPOWER, CGMES).
 */
export function comparePowerFlowSnapshots(
  baseline: PowerFlowSnapshot,
  comparators: readonly PowerFlowSnapshot[],
  options: PowerFlowComparisonOptions = {},
): PowerFlowComparisonReport {
  const vmTol = options.vmTolerancePu ?? 0.005;
  const vaTol = options.vaToleranceDeg ?? 0.5;
  const pTol = options.pToleranceMw ?? 2.0;
  const qTol = options.qToleranceMvar ?? 2.0;
  const busIdMap = options.busIdMap ?? {};

  const baseBusById = new Map<string, PowerFlowBusSnapshot>();
  const baseBusByNorm = new Map<string, PowerFlowBusSnapshot>();
  for (const b of baseline.buses) {
    baseBusById.set(b.busId, b);
    baseBusByNorm.set(normalizeBusKey(b.busId), b);
  }

  const baseBranchByKey = new Map<string, PowerFlowBranchSnapshot>();
  for (const br of baseline.branches) {
    const k1 = `${normalizeBusKey(br.fromBus)}->${normalizeBusKey(br.toBus)}#${(br.ckt ?? "1").trim()}`;
    baseBranchByKey.set(k1, br);
    baseBranchByKey.set(br.id, br);
  }

  const pairs: PowerFlowPairComparison[] = [];
  let globalMaxVm = 0;
  let globalMaxVa = 0;
  let globalMaxP = 0;

  for (const comp of comparators) {
    const busDeltas: PowerFlowBusDelta[] = [];
    let sumSqVm = 0;
    let maxVm = 0;
    let maxVa = 0;

    for (const cb of comp.buses) {
      const mappedId = busIdMap[cb.busId] ?? cb.busId;
      const bb = baseBusById.get(mappedId) ?? baseBusByNorm.get(normalizeBusKey(mappedId));
      if (!bb) continue;

      const dVm = Math.abs(cb.vmPu - bb.vmPu);
      const dVa = normalizeAngleDiffDeg(cb.vaDeg, bb.vaDeg);
      const ok = dVm <= vmTol && dVa <= vaTol;

      sumSqVm += dVm * dVm;
      if (dVm > maxVm) maxVm = dVm;
      if (dVa > maxVa) maxVa = dVa;

      busDeltas.push({
        busId: bb.busId,
        comparatorBusId: cb.busId,
        baseKv: bb.baseKv ?? cb.baseKv,
        baselineVmPu: bb.vmPu,
        comparatorVmPu: cb.vmPu,
        deltaVmPu: dVm,
        baselineVaDeg: bb.vaDeg,
        comparatorVaDeg: cb.vaDeg,
        deltaVaDeg: dVa,
        withinTolerance: ok,
      });
    }

    const branchDeltas: PowerFlowBranchDelta[] = [];
    let maxP = 0;
    let maxQ = 0;

    for (const cbr of comp.branches) {
      const fromMapped = busIdMap[cbr.fromBus] ?? cbr.fromBus;
      const toMapped = busIdMap[cbr.toBus] ?? cbr.toBus;
      const key = `${normalizeBusKey(fromMapped)}->${normalizeBusKey(toMapped)}#${(cbr.ckt ?? "1").trim()}`;
      const bbr = baseBranchByKey.get(cbr.id) ?? baseBranchByKey.get(key);
      if (!bbr) continue;

      const dP = Math.abs(cbr.pFlowMw - bbr.pFlowMw);
      const dQ = Math.abs(cbr.qFlowMvar - bbr.qFlowMvar);
      const ok = dP <= pTol && dQ <= qTol;

      if (dP > maxP) maxP = dP;
      if (dQ > maxQ) maxQ = dQ;

      branchDeltas.push({
        id: bbr.id,
        fromBus: bbr.fromBus,
        toBus: bbr.toBus,
        baselinePMw: bbr.pFlowMw,
        comparatorPMw: cbr.pFlowMw,
        deltaPMw: dP,
        baselineQMvar: bbr.qFlowMvar,
        comparatorQMvar: cbr.qFlowMvar,
        deltaQMvar: dQ,
        withinTolerance: ok,
      });
    }

    const rmseVm = busDeltas.length > 0 ? Math.sqrt(sumSqVm / busDeltas.length) : 0;
    const anyBusOut = busDeltas.some((d) => !d.withinTolerance);
    const anyBranchOut = branchDeltas.some((d) => !d.withinTolerance);

    let status: PowerFlowParityStatus = "PASS";
    if (!baseline.converged || !comp.converged || busDeltas.length === 0) {
      status = "FAIL";
    } else if (maxVm > vmTol * 3 || maxVa > vaTol * 3) {
      status = "FAIL";
    } else if (anyBusOut || anyBranchOut) {
      status = "WARN";
    }

    if (maxVm > globalMaxVm) globalMaxVm = maxVm;
    if (maxVa > globalMaxVa) globalMaxVa = maxVa;
    if (maxP > globalMaxP) globalMaxP = maxP;

    pairs.push({
      baselineSolver: baseline.solver,
      comparatorSolver: comp.solver,
      status,
      matchedBuses: busDeltas.length,
      matchedBranches: branchDeltas.length,
      maxDeltaVmPu: maxVm,
      rmseDeltaVmPu: rmseVm,
      maxDeltaVaDeg: maxVa,
      maxDeltaPMw: maxP,
      maxDeltaQMvar: maxQ,
      busDeltas,
      branchDeltas,
    });
  }

  let overallStatus: PowerFlowParityStatus = "PASS";
  if (pairs.some((p) => p.status === "FAIL")) overallStatus = "FAIL";
  else if (pairs.some((p) => p.status === "WARN")) overallStatus = "WARN";

  const solversCompared = [baseline.solver, ...comparators.map((c) => c.solver)];
  const summaryText =
    pairs.length === 0
      ? `Baseline ${baseline.solver} (${baseline.buses.length} buses); no comparator snapshots provided.`
      : pairs
          .map(
            (p) =>
              `${p.baselineSolver} vs ${p.comparatorSolver}: ${p.status} (${p.matchedBuses} buses, max ΔV=${p.maxDeltaVmPu.toFixed(4)} pu, max Δθ=${p.maxDeltaVaDeg.toFixed(2)}°)`,
          )
          .join("; ");

  return {
    baselineSolver: baseline.solver,
    solversCompared,
    overallStatus,
    maxDeltaVmPu: globalMaxVm,
    maxDeltaVaDeg: globalMaxVa,
    maxDeltaPMw: globalMaxP,
    pairs,
    snapshots: [baseline, ...comparators],
    summaryText,
  };
}
