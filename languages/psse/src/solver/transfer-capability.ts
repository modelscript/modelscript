// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — Sequential N-1-1 Contingency Analysis & FCITC Transfer Capability Engine
 *
 * Implements:
 * - NERC TPL-001 P3/P6 Sequential N-1-1 Contingency Screening (Outage 1 -> between-outage system
 *   adjustment [OLTC/shunt/distributed slack] -> Outage 2), with optional `.con` and `.mon` filtering.
 * - First Contingency Incremental Transfer Capability (FCITC) between source and sink subsystems
 *   using full PTDF + LODF/OTDF first-contingency thermal screening and AC CPF voltage-collapse ceiling.
 */

import { resolveSubsystemBuses, type PsseMonFile, type PsseSubFile } from "../parser/sub-mon-parser.js";
import type { PsseCase, PsseConCase } from "../types.js";
import { solvePowerFlow } from "./ac-powerflow.js";
import { calculateLodfMatrix, calculatePtdfMatrix } from "./contingency-screener.js";
import { solveContinuationPowerFlow } from "./continuation-powerflow.js";

export interface N11Options {
  /** Maximum number of primary outages to pair (default: 10). */
  maxPrimaryOutages?: number | undefined;
  /** Maximum number of secondary outages per primary outage (default: 10). */
  maxSecondaryOutages?: number | undefined;
  /** Under-voltage limit in p.u. (default: 0.90 for N-1-1 emergency). */
  vMinPu?: number | undefined;
  /** Over-voltage limit in p.u. (default: 1.05). */
  vMaxPu?: number | undefined;
  /** Enable between-outage system adjustment (OLTC, switched shunts, distributed slack) per TPL-001 P6 (default: true). */
  enableSystemAdjustment?: boolean | undefined;
  /** Optional parsed `.mon` file for monitored limits. */
  monFile?: PsseMonFile | undefined;
  /** Optional parsed `.con` file to prioritize specific contingency branch outages. */
  conCase?: PsseConCase | undefined;
}

export interface N11PairResult {
  primaryBranch: string;
  secondaryBranch: string;
  intermediateAdjusted: boolean;
  converged: boolean;
  severity: "secure" | "violation" | "collapse";
  maxBranchLoadingPct: number;
  minVoltagePu: number;
  maxVoltagePu: number;
  violationCount: number;
}

export interface N11AnalysisResult {
  totalPairs: number;
  secureCount: number;
  violationCount: number;
  collapseCount: number;
  pairs: N11PairResult[];
  summary: string;
}

export interface FcitcOptions {
  sourceSubsystem: string;
  sinkSubsystem: string;
  subFile: PsseSubFile;
  /** Maximum transfer increment to test in MW (default: 500 MW). */
  maxTransferMw?: number | undefined;
  /** Emergency rating multiplier (default: 1.0 = 100% Rate B or Rate A). */
  thermalLimitPct?: number | undefined;
  /** Evaluate N-1 OTDF first-contingency limits in addition to base case PTDF (default: true). */
  includeN1Otdf?: boolean | undefined;
  /** Cap FCITC by AC Continuation Power Flow (CPF) voltage collapse margin (default: false). */
  verifyWithAcCpf?: boolean | undefined;
}

export interface FcitcLimitingElement {
  monitoredBranch: string;
  contingency: string;
  ptdfOrOtdf: number;
  baseFlowMva: number;
  ratingMva: number;
  fcitcMw: number;
}

export interface FcitcResult {
  sourceSubsystem: string;
  sinkSubsystem: string;
  sourceBuses: number[];
  sinkBuses: number[];
  baseCaseConverged: boolean;
  fcitcMw: number;
  acCpfMarginMw?: number | undefined;
  limitingElement: FcitcLimitingElement | null;
  allLimits: FcitcLimitingElement[];
  summary: string;
}

function cloneCaseWithOutages(psseCase: PsseCase, outagedBranchIndices: number[]): PsseCase {
  const outSet = new Set(outagedBranchIndices);
  return {
    ...psseCase,
    branches: psseCase.branches.map((br, idx) => (outSet.has(idx) ? { ...br, st: 0 } : br)),
  };
}

/**
 * Runs Sequential N-1-1 (NERC TPL-001 P3/P6) AC contingency screening with between-outage system adjustment.
 */
export function analyzeN11Contingencies(psseCase: PsseCase, options: N11Options = {}): N11AnalysisResult {
  const vMinPu = options.monFile?.voltageLimits[0]?.vMinPu ?? options.vMinPu ?? 0.9;
  const vMaxPu = options.monFile?.voltageLimits[0]?.vMaxPu ?? options.vMaxPu ?? 1.05;
  const maxPrimary = options.maxPrimaryOutages ?? 10;
  const maxSecondary = options.maxSecondaryOutages ?? 10;
  const enableAdjustment = options.enableSystemAdjustment ?? true;

  let activeBranches = psseCase.branches.map((br, idx) => ({ br, idx })).filter(({ br }) => br.st !== 0);

  // If a .con case is provided, prioritize branches explicitly referenced in contingency events
  if (options.conCase && options.conCase.contingencies.length > 0) {
    const conKeys = new Set<string>();
    for (const c of options.conCase.contingencies) {
      for (const ev of c.actions) {
        if ("fromBus" in ev && "toBus" in ev) {
          const ckt = ("ckt" in ev && typeof ev.ckt === "string" ? ev.ckt : "1").trim() || "1";
          conKeys.add(`${ev.fromBus}-${ev.toBus}-${ckt}`);
          conKeys.add(`${ev.toBus}-${ev.fromBus}-${ckt}`);
        }
      }
    }
    const prioritized = activeBranches.filter(({ br }) => conKeys.has(`${br.i}-${br.j}-${br.ckt.trim() || "1"}`));
    if (prioritized.length >= 2) {
      activeBranches = prioritized;
    }
  }

  const primaryList = activeBranches.slice(0, maxPrimary);
  const pairs: N11PairResult[] = [];
  let secureCount = 0;
  let violationCount = 0;
  let collapseCount = 0;

  for (let p = 0; p < primaryList.length; p++) {
    const first = primaryList[p]!;
    const primaryLabel = `${first.br.i}-${first.br.j}(${first.br.ckt.trim() || "1"})`;

    // Stage 1: Apply Outage 1 + between-outage system adjustment (OLTC, switched shunts, distributed slack)
    let adjustedCase = cloneCaseWithOutages(psseCase, [first.idx]);
    let intermediateAdjusted = false;
    if (enableAdjustment) {
      const stage1Sol = solvePowerFlow(adjustedCase, {
        maxIterations: 20,
        adjustTaps: true,
        adjustSwitchedShunts: true,
        distributedSlack: true,
      });
      if (stage1Sol.converged) {
        intermediateAdjusted = true;
        const adjustedBuses = new Map(adjustedCase.buses);
        for (const sb of stage1Sol.buses) {
          const orig = adjustedBuses.get(sb.busNumber);
          if (orig) {
            adjustedBuses.set(sb.busNumber, { ...orig, vm: sb.vm, va: sb.va });
          }
        }
        adjustedCase = { ...adjustedCase, buses: adjustedBuses };
      }
    }

    // Stage 2: Apply Outage 2 on top of the post-adjustment state
    const secondaryCandidates = activeBranches.slice(p + 1, p + 1 + maxSecondary);
    for (const second of secondaryCandidates) {
      const modCase = cloneCaseWithOutages(adjustedCase, [second.idx]);
      const sol = solvePowerFlow(modCase, { maxIterations: 20 });
      const secondaryLabel = `${second.br.i}-${second.br.j}(${second.br.ckt.trim() || "1"})`;

      if (!sol.converged) {
        collapseCount++;
        pairs.push({
          primaryBranch: primaryLabel,
          secondaryBranch: secondaryLabel,
          intermediateAdjusted,
          converged: false,
          severity: "collapse",
          maxBranchLoadingPct: Infinity,
          minVoltagePu: 0,
          maxVoltagePu: 0,
          violationCount: 1,
        });
        continue;
      }

      let minV = Infinity;
      let maxV = 0;
      let violations = 0;
      for (const b of sol.buses) {
        if (b.vm < minV) minV = b.vm;
        if (b.vm > maxV) maxV = b.vm;
        if (b.vm < vMinPu || b.vm > vMaxPu) violations++;
      }

      let maxLoadPct = 0;
      for (const br of sol.branches) {
        const loadPct = br.loadingPercent ?? 0;
        if (loadPct > maxLoadPct) maxLoadPct = loadPct;
        if (loadPct > 100.0) violations++;
      }

      const severity = violations > 0 ? "violation" : "secure";
      if (severity === "secure") secureCount++;
      else violationCount++;

      pairs.push({
        primaryBranch: primaryLabel,
        secondaryBranch: secondaryLabel,
        intermediateAdjusted,
        converged: true,
        severity,
        maxBranchLoadingPct: Number(maxLoadPct.toFixed(2)),
        minVoltagePu: Number(minV.toFixed(4)),
        maxVoltagePu: Number(maxV.toFixed(4)),
        violationCount: violations,
      });
    }
  }

  const summary =
    `N-1-1 Sequential Contingency Study: ${pairs.length} pairs evaluated (adjustment=${enableAdjustment}) — ` +
    `${secureCount} secure, ${violationCount} violations, ${collapseCount} collapses.`;

  return {
    totalPairs: pairs.length,
    secureCount,
    violationCount,
    collapseCount,
    pairs,
    summary,
  };
}

/**
 * Computes First Contingency Incremental Transfer Capability (FCITC) between source and sink subsystems
 * using PTDF + N-1 OTDF screening and optional AC Continuation Power Flow (CPF) voltage-collapse ceiling.
 */
export function calculateFcitc(psseCase: PsseCase, options: FcitcOptions): FcitcResult {
  const srcSpec = options.subFile.subsystems.get(options.sourceSubsystem);
  const snkSpec = options.subFile.subsystems.get(options.sinkSubsystem);
  const sourceBuses = srcSpec ? [...resolveSubsystemBuses(psseCase, srcSpec)] : [];
  const sinkBuses = snkSpec ? [...resolveSubsystemBuses(psseCase, snkSpec)] : [];

  const baseSol = solvePowerFlow(psseCase);
  const maxTransferMw = options.maxTransferMw ?? 500.0;
  const thermalLimitPct = options.thermalLimitPct ?? 100.0;
  const includeN1Otdf = options.includeN1Otdf ?? true;

  if (!baseSol.converged || sourceBuses.length === 0 || sinkBuses.length === 0) {
    return {
      sourceSubsystem: options.sourceSubsystem,
      sinkSubsystem: options.sinkSubsystem,
      sourceBuses,
      sinkBuses,
      baseCaseConverged: baseSol.converged,
      fcitcMw: 0,
      limitingElement: null,
      allLimits: [],
      summary: `FCITC failed: base case converged=${baseSol.converged}, sourceBuses=${sourceBuses.length}, sinkBuses=${sinkBuses.length}.`,
    };
  }

  const ptdfRes = calculatePtdfMatrix(psseCase);
  const lodfRes = includeN1Otdf ? calculateLodfMatrix(psseCase, { ptdf: ptdfRes }) : null;
  const busToIdx = new Map<number, number>();
  ptdfRes.buses.forEach((b, i) => busToIdx.set(b, i));

  // Precompute per-branch net transfer PTDF, base flow, and ratings
  const netPtdfByBranch: number[] = [];
  const baseFlowByBranch: number[] = [];
  const rateByBranch: number[] = [];
  const labelByBranch: string[] = [];

  for (let brIdx = 0; brIdx < ptdfRes.branches.length; brIdx++) {
    const brMeta = ptdfRes.branches[brIdx]!;
    const rawBr = psseCase.branches.find(
      (b) => b.i === brMeta.fromBus && b.j === brMeta.toBus && (b.ckt.trim() || "1") === brMeta.ckt,
    );
    const rateMva = rawBr ? (rawBr.rateB > 0 ? rawBr.rateB : rawBr.rateA) : 0;
    const row = ptdfRes.factors[brIdx];
    let srcPtdf = 0;
    let srcCount = 0;
    for (const sb of sourceBuses) {
      const bi = busToIdx.get(sb);
      if (bi !== undefined) {
        srcPtdf += row?.[bi] ?? 0;
        srcCount++;
      }
    }
    let snkPtdf = 0;
    let snkCount = 0;
    for (const kb of sinkBuses) {
      const bi = busToIdx.get(kb);
      if (bi !== undefined) {
        snkPtdf += row?.[bi] ?? 0;
        snkCount++;
      }
    }
    const netPtdf = (srcCount > 0 ? srcPtdf / srcCount : 0) - (snkCount > 0 ? snkPtdf / snkCount : 0);
    const solvedBr = baseSol.branches.find(
      (b) => b.fromBus === brMeta.fromBus && b.toBus === brMeta.toBus && b.ckt === brMeta.ckt,
    );

    netPtdfByBranch.push(netPtdf);
    baseFlowByBranch.push(solvedBr ? solvedBr.mvaFlow : 0);
    rateByBranch.push(rateMva);
    labelByBranch.push(`${brMeta.fromBus}-${brMeta.toBus}(${brMeta.ckt})`);
  }

  const allLimits: FcitcLimitingElement[] = [];

  // 1. Base-case PTDF limits
  for (let l = 0; l < ptdfRes.branches.length; l++) {
    const rateMva = rateByBranch[l]!;
    const ptdfL = netPtdfByBranch[l]!;
    if (rateMva <= 0 || Math.abs(ptdfL) < 1e-4) continue;
    const baseFlow = baseFlowByBranch[l]!;
    const headroom = Math.max(0, rateMva * (thermalLimitPct / 100.0) - baseFlow);
    allLimits.push({
      monitoredBranch: labelByBranch[l]!,
      contingency: "BASE_CASE",
      ptdfOrOtdf: Number(ptdfL.toFixed(5)),
      baseFlowMva: Number(baseFlow.toFixed(2)),
      ratingMva: Number(rateMva.toFixed(2)),
      fcitcMw: Number(Math.min(maxTransferMw, headroom / Math.abs(ptdfL)).toFixed(2)),
    });
  }

  // 2. First-contingency N-1 OTDF limits: F_post = F_l + LODF(l,k)*F_k, OTDF(l,k) = PTDF_l + LODF(l,k)*PTDF_k
  if (lodfRes) {
    const nBr = ptdfRes.branches.length;
    for (let k = 0; k < nBr; k++) {
      const outBr = ptdfRes.branches[k]!;
      const contLabel = `OUTAGE_${labelByBranch[k]!}`;
      const ptdfK = netPtdfByBranch[k]!;
      const flowK = baseFlowByBranch[k]!;
      for (let l = 0; l < nBr; l++) {
        if (l === k) continue;
        const rateMva = rateByBranch[l]!;
        if (rateMva <= 0) continue;
        const lodfLk = lodfRes.getOutageFactor(ptdfRes.branches[l]!, outBr);
        if (!Number.isFinite(lodfLk) || Math.abs(lodfLk) < 1e-4) continue;
        const otdf = netPtdfByBranch[l]! + lodfLk * ptdfK;
        if (Math.abs(otdf) < 1e-4) continue;
        const postOutageFlow = Math.abs(baseFlowByBranch[l]! + lodfLk * flowK);
        const headroom = Math.max(0, rateMva * (thermalLimitPct / 100.0) - postOutageFlow);
        allLimits.push({
          monitoredBranch: labelByBranch[l]!,
          contingency: contLabel,
          ptdfOrOtdf: Number(otdf.toFixed(5)),
          baseFlowMva: Number(postOutageFlow.toFixed(2)),
          ratingMva: Number(rateMva.toFixed(2)),
          fcitcMw: Number(Math.min(maxTransferMw, headroom / Math.abs(otdf)).toFixed(2)),
        });
      }
    }
  }

  allLimits.sort((a, b) => a.fcitcMw - b.fcitcMw);
  const limitingElement = allLimits[0] ?? null;
  let fcitcMw = limitingElement ? limitingElement.fcitcMw : maxTransferMw;

  // 3. Optional AC Continuation Power Flow (CPF) voltage-collapse ceiling
  let acCpfMarginMw: number | undefined;
  if (options.verifyWithAcCpf) {
    const cpf = solveContinuationPowerFlow(psseCase, { maxSteps: 20 });
    if (cpf.converged && cpf.marginMw > 0) {
      acCpfMarginMw = Number(cpf.marginMw.toFixed(2));
      fcitcMw = Math.min(fcitcMw, acCpfMarginMw);
    }
  }

  return {
    sourceSubsystem: options.sourceSubsystem,
    sinkSubsystem: options.sinkSubsystem,
    sourceBuses,
    sinkBuses,
    baseCaseConverged: true,
    fcitcMw: Number(fcitcMw.toFixed(2)),
    acCpfMarginMw,
    limitingElement,
    allLimits: allLimits.slice(0, 20),
    summary: limitingElement
      ? `FCITC (${options.sourceSubsystem} -> ${options.sinkSubsystem}) = ${fcitcMw.toFixed(1)} MW, limited by ${limitingElement.monitoredBranch} under ${limitingElement.contingency} (OTDF/PTDF=${limitingElement.ptdfOrOtdf}).`
      : `FCITC (${options.sourceSubsystem} -> ${options.sinkSubsystem}) >= ${maxTransferMw.toFixed(1)} MW (no binding thermal limits).`,
  };
}
