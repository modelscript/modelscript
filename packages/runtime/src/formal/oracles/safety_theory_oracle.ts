// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Nelson-Oppen Safety & Reliability Theory Oracle.
 *
 * Implements automated Fault Tree Analysis (FTA), Minimal Cut Set (MCS) extraction,
 * probabilistic safety metric verification (ISO 26262 PMHF/SPFM/LFM and DO-178C/ARP4754A),
 * and Failure Mode and Effects Analysis (FMEA) generation with CDCL conflict synthesis.
 *
 * Mathematical Foundations:
 *   - Minimal Cut Sets (MOCUS Boolean absorption algebra):
 *       A and (A or B) = A,   A or (A and B) = A,   A and A = A
 *   - Unreliability calculation:
 *       Q_OR = 1 - prod(1 - Q_i),   Q_AND = prod(Q_i)
 *   - Probabilistic Metric for random Hardware Failures (PMHF in FIT):
 *       PMHF = (Q_top(T_mission) / T_mission) * 1e9
 *   - Single-Point Fault Metric:
 *       SPFM = 1 - (sum lambda_SPF + sum lambda_RF) / (sum lambda_total)
 */

import type {
  ConflictClause,
  SharedEquality,
  TheoryDomain,
  TheoryLiteral,
  TheoryOracle,
} from "../theory_coordinator.js";

export type SafetyStandard = "ISO26262" | "DO178C" | "ARP4754A" | "IEC61508";

export type AsilLevel = "QM" | "ASIL_A" | "ASIL_B" | "ASIL_C" | "ASIL_D";
export type DalLevel = "DAL_E" | "DAL_D" | "DAL_C" | "DAL_B" | "DAL_A";

export interface ComponentFailureMode {
  id: string;
  componentName: string;
  modeName: string;
  /** Failure rate per hour (lambda). 1e-9 / hr = 1 FIT. */
  failureRatePerHour: number;
  /** Safety mechanism name (e.g. "hardware_watchdog", "dual_redundancy"). */
  safetyMechanism?: string;
  /** Diagnostic coverage K_dc in [0, 1]. E.g. 0.99 for 99%. */
  diagnosticCoverage?: number;
  /** Severity score 1..10 for FMEA. */
  severityScore?: number;
}

export type FtaGateType = "AND" | "OR" | "VOTING_K_OF_N" | "PRIMARY_EVENT";

export interface FtaNode {
  id: string;
  name: string;
  gateType: FtaGateType;
  /** For VOTING_K_OF_N gates: required number of active inputs to fire. */
  k?: number;
  children: string[];
  failureModeId?: string;
  description?: string;
}

export interface SystemHazard {
  id: string;
  name: string;
  asilLevel?: AsilLevel;
  dalLevel?: DalLevel;
  /** Maximum acceptable PMHF target in FIT. (e.g., ASIL-D target < 10 FIT). */
  targetPmhfFit?: number;
  /** Target Single-Point Fault Metric (SPFM) fraction (e.g., ASIL-D target >= 0.99). */
  targetSpfm?: number;
  /** Target Latent Fault Metric (LFM) fraction (e.g., ASIL-D target >= 0.90). */
  targetLfm?: number;
  rootNodeId: string;
}

export interface FmeaRow {
  component: string;
  failureMode: string;
  failureRateFit: number;
  safetyMechanism: string;
  diagnosticCoverage: number;
  severity: number;
  occurrence: number;
  detection: number;
  rpn: number;
  safetyClass: string;
}

export interface SafetyVerificationReport {
  hazardId: string;
  hazardName: string;
  targetPmhfFit?: number;
  actualPmhfFit: number;
  targetSpfm?: number;
  actualSpfm: number;
  actualLfm: number;
  isCompliant: boolean;
  minimalCutSets: string[][];
  singlePointsOfFailure: string[];
  dualPointsOfFailure: string[][];
  unreliabilityT: number;
  fmeaTable: FmeaRow[];
  violations: string[];
}

export class SafetyTheoryOracle implements TheoryOracle {
  public readonly name = "SafetyTheoryOracle";
  public readonly domain: TheoryDomain = "continuous_safety";

  private failureModes = new Map<string, ComponentFailureMode>();
  private ftaNodes = new Map<string, FtaNode>();
  private hazards = new Map<string, SystemHazard>();
  private activeLiterals: TheoryLiteral[] = [];
  private missionTimeHours = 10000; // 10,000 hours typical automotive/aerospace life

  constructor(missionTimeHours = 10000) {
    this.missionTimeHours = missionTimeHours;
  }

  public registerFailureMode(mode: ComponentFailureMode): void {
    this.failureModes.set(mode.id, mode);
  }

  public registerFtaNode(node: FtaNode): void {
    this.ftaNodes.set(node.id, node);
  }

  public registerHazard(hazard: SystemHazard): void {
    this.hazards.set(hazard.id, hazard);
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.activeLiterals.push(lit);
    return true;
  }

  public retractLiteral(litId: number): void {
    this.activeLiterals = this.activeLiterals.filter((l) => l.id !== litId);
  }

  public reset(): void {
    this.activeLiterals = [];
  }

  public onSharedEquality(_eq: SharedEquality): void {
    // Shared equalities from other domains can link parameter values or tolerances
  }

  public propagateEqualities(): SharedEquality[] {
    const equalities: SharedEquality[] = [];
    for (const [hId, hazard] of this.hazards) {
      const report = this.evaluateHazard(hazard);
      equalities.push({
        varA: `${hId}.actualPmhf`,
        varB: `${report.actualPmhfFit.toFixed(2)}_FIT`,
        domain: "real",
        bounds: [report.actualPmhfFit, report.actualPmhfFit],
        sourceOracle: this.name,
        explanation: `Calculated PMHF metric for hazard '${hazard.name}'`,
      });
    }
    return equalities;
  }

  /**
   * Evaluates satisfaction across all registered system hazards against ASIL/DAL metrics.
   */
  public checkSat(): { isSat: boolean; conflict?: ConflictClause } {
    for (const [, hazard] of this.hazards) {
      const report = this.evaluateHazard(hazard);
      if (!report.isCompliant) {
        return {
          isSat: false,
          conflict: {
            literals: [...this.activeLiterals],
            explanation:
              `Safety goal violated for '${hazard.name}' (${hazard.asilLevel || hazard.dalLevel}): ` +
              report.violations.join("; "),
            culpritEntities: report.singlePointsOfFailure.concat(
              report.dualPointsOfFailure.map((dpf) => dpf.join("&")),
            ),
            theoryName: this.name,
          },
        };
      }
    }

    return { isSat: true };
  }

  /**
   * Computes the Minimal Cut Sets (MCS) of a Fault Tree using MOCUS top-down expansion.
   */
  public computeMinimalCutSets(rootNodeId: string): string[][] {
    // Represents a sum of products (OR of ANDs)
    let cutSets: Set<string>[] = [new Set([rootNodeId])];

    let hasExpanded = true;
    let iteration = 0;
    const maxIterations = 200;

    while (hasExpanded && iteration++ < maxIterations) {
      hasExpanded = false;
      const nextCutSets: Set<string>[] = [];

      for (const cs of cutSets) {
        // Find first non-primary event node
        let nonTerminalId: string | null = null;
        for (const nodeId of cs) {
          const node = this.ftaNodes.get(nodeId);
          if (node && node.gateType !== "PRIMARY_EVENT") {
            nonTerminalId = nodeId;
            break;
          }
        }

        if (!nonTerminalId) {
          nextCutSets.push(cs);
          continue;
        }

        hasExpanded = true;
        const gate = this.ftaNodes.get(nonTerminalId)!;
        const remaining = new Set(cs);
        remaining.delete(nonTerminalId);

        if (gate.gateType === "OR") {
          // OR gate: replicates current cut set for each child
          for (const childId of gate.children) {
            const newCs = new Set(remaining);
            newCs.add(childId);
            nextCutSets.push(newCs);
          }
        } else if (gate.gateType === "AND") {
          // AND gate: combines all children into current cut set
          const newCs = new Set(remaining);
          for (const childId of gate.children) {
            newCs.add(childId);
          }
          nextCutSets.push(newCs);
        } else if (gate.gateType === "VOTING_K_OF_N") {
          // k-of-n voting gate: generate all combinations of k children
          const k = gate.k ?? 2;
          const combos = this.combinations(gate.children, k);
          for (const combo of combos) {
            const newCs = new Set(remaining);
            for (const id of combo) newCs.add(id);
            nextCutSets.push(newCs);
          }
        }
      }

      cutSets = this.simplifyCutSets(nextCutSets);
    }

    // Convert node IDs to failure mode identifiers or descriptions
    const resolvedCutSets: string[][] = [];
    for (const cs of cutSets) {
      const items: string[] = [];
      for (const id of cs) {
        const node = this.ftaNodes.get(id);
        if (node && node.failureModeId) {
          const fm = this.failureModes.get(node.failureModeId);
          items.push(fm ? `${fm.componentName}.${fm.modeName}` : node.name);
        } else {
          items.push(node?.name || id);
        }
      }
      resolvedCutSets.push(items.sort());
    }

    return resolvedCutSets;
  }

  /**
   * Applies absorption law: if CS_A is subset of CS_B, CS_B is eliminated.
   */
  private simplifyCutSets(cutSets: Set<string>[]): Set<string>[] {
    const unique: Set<string>[] = [];

    // 1. Remove duplicate elements within sets
    for (const cs of cutSets) {
      let isSubset = false;
      for (let i = 0; i < unique.length; i++) {
        const existing = unique[i]!;
        if (this.isSubsetOf(existing, cs)) {
          isSubset = true;
          break;
        }
      }
      if (!isSubset) {
        // Also remove any existing sets that are supersets of cs
        for (let i = unique.length - 1; i >= 0; i--) {
          if (this.isSubsetOf(cs, unique[i]!)) {
            unique.splice(i, 1);
          }
        }
        unique.push(cs);
      }
    }

    return unique;
  }

  private isSubsetOf(a: Set<string>, b: Set<string>): boolean {
    for (const elem of a) {
      if (!b.has(elem)) return false;
    }
    return true;
  }

  private combinations(arr: string[], k: number): string[][] {
    if (k === 0) return [[]];
    if (arr.length < k) return [];
    const head = arr[0]!;
    const tail = arr.slice(1);
    const withHead = this.combinations(tail, k - 1).map((c) => [head, ...c]);
    const withoutHead = this.combinations(tail, k);
    return withHead.concat(withoutHead);
  }

  /**
   * Recursively evaluates probability of failure for a node over mission time T.
   */
  public evaluateNodeUnreliability(nodeId: string, T: number): number {
    const node = this.ftaNodes.get(nodeId);
    if (!node) return 0.0;

    if (node.gateType === "PRIMARY_EVENT") {
      if (!node.failureModeId) return 0.0;
      const fm = this.failureModes.get(node.failureModeId);
      if (!fm) return 0.0;
      // Exponential unreliability: Q(T) = 1 - exp(-lambda * T)
      const lambda = fm.failureRatePerHour;
      return 1.0 - Math.exp(-lambda * T);
    }

    if (node.gateType === "OR") {
      let prodReliability = 1.0;
      for (const childId of node.children) {
        const qChild = this.evaluateNodeUnreliability(childId, T);
        prodReliability *= 1.0 - qChild;
      }
      return 1.0 - prodReliability;
    }

    if (node.gateType === "AND") {
      let prodQ = 1.0;
      for (const childId of node.children) {
        prodQ *= this.evaluateNodeUnreliability(childId, T);
      }
      return prodQ;
    }

    if (node.gateType === "VOTING_K_OF_N") {
      const k = node.k ?? 2;
      const childQs = node.children.map((cid) => this.evaluateNodeUnreliability(cid, T));
      // Approximation for small identical probabilities
      const qAvg = childQs.reduce((a, b) => a + b, 0) / (childQs.length || 1);
      const n = childQs.length;
      let qVote = 0.0;
      for (let j = k; j <= n; j++) {
        const nChooseJ = this.nChooseK(n, j);
        qVote += nChooseJ * Math.pow(qAvg, j) * Math.pow(1 - qAvg, n - j);
      }
      return Math.min(1.0, qVote);
    }

    return 0.0;
  }

  private nChooseK(n: number, k: number): number {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    let res = 1;
    for (let i = 1; i <= k; i++) {
      res = (res * (n - i + 1)) / i;
    }
    return res;
  }

  /**
   * Generates complete safety verification report and FMEA table for a hazard.
   */
  public evaluateHazard(hazard: SystemHazard): SafetyVerificationReport {
    const T = this.missionTimeHours;
    const topQ = this.evaluateNodeUnreliability(hazard.rootNodeId, T);

    // PMHF: average failure rate per hour expressed in FIT (1 FIT = 1e-9 / hr)
    const avgLambdaPerHour = topQ / (T || 1);
    const actualPmhfFit = avgLambdaPerHour * 1e9;

    // Minimal cut sets
    const mcs = this.computeMinimalCutSets(hazard.rootNodeId);
    const singlePoints: string[] = [];
    const dualPoints: string[][] = [];

    for (const cs of mcs) {
      if (cs.length === 1) singlePoints.push(cs[0]!);
      else if (cs.length === 2) dualPoints.push(cs);
    }

    // SPFM and LFM calculations (ISO 26262-5)
    let sumTotalLambda = 0.0;
    let sumSpfLambda = 0.0;
    let sumResidualLambda = 0.0;
    let sumLatentLambda = 0.0;

    const fmeaRows: FmeaRow[] = [];

    for (const [, fm] of this.failureModes) {
      const lambda = fm.failureRatePerHour;
      const fit = lambda * 1e9;
      sumTotalLambda += lambda;

      const dc = fm.diagnosticCoverage ?? 0.0;
      const isSpf = singlePoints.some((sp) => sp.includes(fm.componentName) || sp.includes(fm.modeName));

      if (isSpf) {
        if (dc > 0) {
          sumResidualLambda += lambda * (1.0 - dc);
          sumLatentLambda += lambda * dc;
        } else {
          sumSpfLambda += lambda;
        }
      }

      // FMEA ratings
      const severity = fm.severityScore ?? (hazard.asilLevel === "ASIL_D" ? 10 : 8);
      // Occurrence rating: log scale based on FIT
      let occurrence = 1;
      if (fit > 1000) occurrence = 10;
      else if (fit > 500) occurrence = 8;
      else if (fit > 100) occurrence = 6;
      else if (fit > 20) occurrence = 4;
      else if (fit > 5) occurrence = 2;

      // Detection rating: inverted from diagnostic coverage
      let detection = 1;
      if (dc < 0.6) detection = 8;
      else if (dc < 0.9) detection = 5;
      else if (dc < 0.99) detection = 3;
      else detection = 1;

      const rpn = severity * occurrence * detection;

      fmeaRows.push({
        component: fm.componentName,
        failureMode: fm.modeName,
        failureRateFit: parseFloat(fit.toFixed(2)),
        safetyMechanism: fm.safetyMechanism || "None",
        diagnosticCoverage: dc,
        severity,
        occurrence,
        detection,
        rpn,
        safetyClass: hazard.asilLevel || hazard.dalLevel || "QM",
      });
    }

    const actualSpfm = sumTotalLambda > 0 ? 1.0 - (sumSpfLambda + sumResidualLambda) / sumTotalLambda : 1.0;
    const actualLfm = sumTotalLambda > 0 ? 1.0 - sumLatentLambda / sumTotalLambda : 1.0;

    // Check violations
    const violations: string[] = [];
    if (hazard.targetPmhfFit !== undefined && actualPmhfFit > hazard.targetPmhfFit) {
      violations.push(`PMHF ${actualPmhfFit.toFixed(2)} FIT exceeds target ${hazard.targetPmhfFit} FIT`);
    }
    if (hazard.targetSpfm !== undefined && actualSpfm < hazard.targetSpfm) {
      violations.push(
        `SPFM ${(actualSpfm * 100).toFixed(1)}% falls below target ${(hazard.targetSpfm * 100).toFixed(1)}%`,
      );
    }
    if (hazard.targetLfm !== undefined && actualLfm < hazard.targetLfm) {
      violations.push(
        `LFM ${(actualLfm * 100).toFixed(1)}% falls below target ${(hazard.targetLfm * 100).toFixed(1)}%`,
      );
    }
    if (hazard.asilLevel === "ASIL_D" && singlePoints.length > 0) {
      violations.push(
        `ASIL-D prohibits unmitigated Single Points of Failure (detected ${singlePoints.length} SPF: ${singlePoints.join(", ")})`,
      );
    }

    return {
      hazardId: hazard.id,
      hazardName: hazard.name,
      targetPmhfFit: hazard.targetPmhfFit,
      actualPmhfFit: parseFloat(actualPmhfFit.toFixed(2)),
      targetSpfm: hazard.targetSpfm,
      actualSpfm: parseFloat(actualSpfm.toFixed(4)),
      actualLfm: parseFloat(actualLfm.toFixed(4)),
      isCompliant: violations.length === 0,
      minimalCutSets: mcs,
      singlePointsOfFailure: singlePoints,
      dualPointsOfFailure: dualPoints,
      unreliabilityT: topQ,
      fmeaTable: fmeaRows,
      violations,
    };
  }
}
