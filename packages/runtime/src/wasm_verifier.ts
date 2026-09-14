// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic WASM Requirement & Trajectory Verification Framework.
 *
 * Provides language-agnostic requirement verification over dynamic simulation traces,
 * integrating symbol/CST resolution with zero-allocation in-WASM vector checking.
 */

import type { QueryDB, SymbolEntry } from "./runtime.js";
import { DigitalThreadHypergraph, ThreadDomain } from "./thread_hypergraph.js";

export interface SimulationResult {
  t: number[];
  states: string[];
  y: number[][];
  parameters?: { name: string; value: string | number | boolean }[];
}

export interface VerificationResult {
  requirementId: number;
  constraintId: number;
  isSatisfied: boolean;
  timeSeriesResult?: boolean[];
  message?: string;
  requirementName?: string;
  /** Peak (extremal) value of the LHS operand over the simulation timeline. */
  peakValue?: number;
  /** The RHS limit value from the requirement. */
  limitValue?: number;
  /** Simulation time at which the constraint was first violated. */
  violationTime?: number;
  /** Name of the LHS operand (e.g., "motor.T", "circuit.C.v"). */
  lhsName?: string;
  /** Temporal metric evaluated (e.g., "max", "min", "settlingTime", "overshoot", "steadyState", "integral", "pointwise"). */
  metricName?: "max" | "min" | "settlingTime" | "overshoot" | "steadyState" | "integral" | "pointwise";
  /** Computed scalar value of the temporal metric. */
  metricValue?: number;
  /** Blast radius: number of impacted downstream artifacts in the digital thread on verification failure. */
  blastRadius?: number;
}

export type ComparisonOp = "<" | "<=" | "==" | ">=" | ">" | "!=";

export interface TrajectoryConstraint {
  lhs: string;
  op: ComparisonOp;
  rhs: string | number;
  timeRange?: [number, number];
  tolerance?: number;
}

export enum VerifyOp {
  LT = 0,
  LTE = 1,
  EQ = 2,
  GTE = 3,
  GT = 4,
  NEQ = 5,
}

export function parseComparisonOp(opStr: string): VerifyOp {
  switch (opStr) {
    case "<":
      return VerifyOp.LT;
    case "<=":
      return VerifyOp.LTE;
    case "==":
      return VerifyOp.EQ;
    case ">=":
      return VerifyOp.GTE;
    case ">":
      return VerifyOp.GT;
    case "!=":
      return VerifyOp.NEQ;
    default:
      return VerifyOp.LTE;
  }
}

/**
 * Computes the settling time of a signal trajectory x(t).
 * Settling time is the earliest time t_s such that for all t >= t_s,
 * |x(t) - x_final| <= band * |x_final| (or band if x_final is 0).
 */
export function computeSettlingTime(t: number[], x: number[], band: number = 0.02): number {
  if (t.length === 0 || x.length === 0) return 0;
  const n = x.length;
  const finalVal = x[n - 1] ?? 0;
  const tolerance = Math.max(Math.abs(finalVal) * band, band);

  let lastOutOfBandIndex = -1;
  for (let i = 0; i < n; i++) {
    if (Math.abs((x[i] ?? 0) - finalVal) > tolerance) {
      lastOutOfBandIndex = i;
    }
  }

  if (lastOutOfBandIndex === -1) {
    return t[0] ?? 0;
  }
  if (lastOutOfBandIndex >= n - 1) {
    return t[n - 1] ?? 0;
  }
  return t[lastOutOfBandIndex + 1] ?? t[n - 1] ?? 0;
}

/**
 * Computes percentage overshoot of signal trajectory relative to target/steady-state value.
 */
export function computeOvershoot(x: number[], targetVal?: number): number {
  if (x.length === 0) return 0;
  const finalVal = targetVal !== undefined ? targetVal : (x[x.length - 1] ?? 0);
  const maxVal = Math.max(...x);
  if (finalVal === 0) {
    return maxVal;
  }
  const diff = maxVal - finalVal;
  if (diff <= 0) return 0;
  return (diff / Math.abs(finalVal)) * 100;
}

/**
 * Computes the steady-state value of a signal (mean of the final windowFrac of simulation).
 */
export function computeSteadyState(x: number[], windowFrac = 0.1): number {
  if (x.length === 0) return 0;
  const windowCount = Math.max(1, Math.floor(x.length * windowFrac));
  const slice = x.slice(x.length - windowCount);
  const sum = slice.reduce((acc, val) => acc + val, 0);
  return sum / slice.length;
}

/**
 * Computes trapezoidal numerical integration of signal x(t).
 */
export function computeIntegral(t: number[], x: number[]): number {
  if (t.length < 2 || x.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < t.length - 1; i++) {
    const dt = (t[i + 1] ?? 0) - (t[i] ?? 0);
    const avgX = ((x[i] ?? 0) + (x[i + 1] ?? 0)) * 0.5;
    sum += avgX * dt;
  }
  return sum;
}

/**
 * Language-agnostic orchestrator that evaluates constraints extracted from a
 * verification/analysis case against dynamic time-series simulation results.
 */
export class VerificationRunner {
  private variableMap: Map<string, string>;

  constructor(
    private db: QueryDB,
    variableMap?: Map<string, string>,
  ) {
    this.variableMap = variableMap ?? new Map();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Simulation value lookup
  // -------------------------------------------------------------------------

  private findValueInSimulation(simResult: SimulationResult, varName: string, timeIndex: number): number | undefined {
    // 1. Check states
    const stateIdx = simResult.states.indexOf(varName);
    if (stateIdx !== -1 && simResult.y[timeIndex]) {
      return simResult.y[timeIndex][stateIdx];
    }

    // 2. Check parameters (constant over time)
    if (simResult.parameters) {
      const pIdx = simResult.parameters.findIndex((p) => p.name === varName);
      if (pIdx !== -1) return simResult.parameters[pIdx]?.value as number;
    }
    return undefined;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Language-agnostic operand resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve a constraint operand (LHS or RHS) to a numeric value.
   *
   * Resolution cascade:
   *   1. Numeric literal
   *   2. Explicit variableMap → simulation lookup
   *   3. Progressive path stripping → simulation lookup
   *   4. QueryDB expression evaluation
   *   5. Scope-walking for dotted paths (e.g. "req.maxLimit")
   *   6. Leaf-name CST text fallback (= <number>)
   */
  public resolveOperand(
    path: string,
    constraint: SymbolEntry,
    simResult: SimulationResult,
    timeIndex: number,
  ): number | undefined {
    // 1. Literal number
    const num = parseFloat(path);
    if (!isNaN(num) && isFinite(num)) return num;

    // 2. Explicit variableMap lookup
    const mapped = this.variableMap.get(path);
    if (mapped !== undefined) {
      const val = this.findValueInSimulation(simResult, mapped, timeIndex);
      if (val !== undefined) return val;
    }

    // 3. Progressive path stripping: "circuit.C.v" → "C.v" → "v"
    const segments = path.split(".");
    for (let i = 0; i < segments.length; i++) {
      const candidate = segments.slice(i).join(".");
      const val = this.findValueInSimulation(simResult, candidate, timeIndex);
      if (val !== undefined) return val;
    }

    // 4. QueryDB expression evaluation
    try {
      const result = this.db.evaluate(path, constraint.parentId);
      if (typeof result === "number") return result;
    } catch {
      // continue fallback
    }

    // 5. Scope-walking for dotted paths like "req.maxLimit"
    if (segments.length >= 2) {
      const resolved = this.resolveQualifiedPath(segments, constraint);
      if (resolved !== undefined) return resolved;
    }

    // 6. Leaf-name CST text fallback
    const leafName = segments[segments.length - 1];
    if (leafName) {
      let candidates = this.db.byName(leafName);
      if (!candidates || candidates.length === 0) {
        candidates = this.db.allEntries().filter((e) => e.name === leafName);
      }
      for (const entry of candidates) {
        const text = this.db.cstText(entry.startByte, entry.endByte, entry);
        if (text) {
          const match = text.match(/=\s*(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
          if (match && match[1]) return parseFloat(match[1]);
        }
      }
    }

    return undefined;
  }

  /**
   * Walk a qualified path like ["req", "maxLimit"] through typing hierarchies.
   */
  private resolveQualifiedPath(segments: string[], constraint: SymbolEntry): number | undefined {
    const parentId = constraint.parentId;
    const firstName = segments[0];
    let currentEntry: SymbolEntry | undefined;

    if (parentId !== null) {
      const siblings = this.db.childrenOf(parentId);
      currentEntry = siblings.find((s) => s.name === firstName);
    }

    if (!currentEntry && firstName) {
      const globalEntries = this.db.byName(firstName);
      if (globalEntries.length > 0) currentEntry = globalEntries[0];
    }

    if (!currentEntry) return undefined;

    for (let i = 1; i < segments.length; i++) {
      const nextName = segments[i];

      const directChildren = this.db.childrenOf(currentEntry.id);
      let child = directChildren.find((c) => c.name === nextName);
      if (child) {
        currentEntry = child;
        continue;
      }

      const typeEntry = this.resolveTypeEntry(currentEntry);
      if (typeEntry) {
        const typeChildren = this.db.childrenOf(typeEntry.id);
        child = typeChildren.find((c) => c.name === nextName);
        if (child) {
          currentEntry = child;
          continue;
        }
      }

      return undefined;
    }

    if (!currentEntry) return undefined;

    const text = this.db.cstText(currentEntry.startByte, currentEntry.endByte, currentEntry);
    if (text) {
      const match = text.match(/=\s*(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
      if (match && match[1]) return parseFloat(match[1]);
    }

    return undefined;
  }

  private resolveTypeEntry(entry: SymbolEntry): SymbolEntry | undefined {
    const children = this.db.childrenOf(entry.id);
    for (const child of children) {
      if (
        child.kind === "Reference" ||
        child.ruleName.includes("Typing") ||
        child.ruleName.includes("Specialization")
      ) {
        const typeEntries = this.db.byName(child.name);
        if (typeEntries.length > 0) {
          const def = typeEntries.find((e) => e.kind === "Definition") ?? typeEntries[0];
          return def;
        }
      }
    }

    if (entry.inherits && entry.inherits.length > 0) {
      for (const inheritPath of entry.inherits) {
        const entries = this.db.byName(inheritPath);
        if (entries.length > 0) return entries[0];
      }
    }

    return undefined;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CST comparison extraction
  // -------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public extractComparison(node: any): { lhs: string; op: ComparisonOp; rhs: string } | null {
    if (!node) return null;

    const opNodeRef = node.childForFieldName ? node.childForFieldName("operator") : null;
    const leftNodeRef = node.childForFieldName
      ? node.childForFieldName("left") || node.childForFieldName("operand")
      : null;
    const rightNodeRef = node.childForFieldName ? node.childForFieldName("right") : null;

    if (leftNodeRef && opNodeRef && rightNodeRef && typeof opNodeRef.text === "string") {
      const opText = opNodeRef.text.trim() as ComparisonOp;
      const ops = new Set(["<", "<=", "==", ">=", ">", "!="]);
      if (ops.has(opText) && leftNodeRef.text && rightNodeRef.text) {
        return {
          lhs: leftNodeRef.text.trim(),
          op: opText,
          rhs: rightNodeRef.text.trim(),
        };
      }
    }

    const ops = new Set(["<", "<=", "==", ">=", ">", "!="]);
    const children = node.children || [];
    if (children.length >= 3) {
      for (let i = 1; i < children.length - 1; i++) {
        const opNode = children[i];
        if (opNode && typeof opNode.text === "string" && ops.has(opNode.text.trim())) {
          const leftNode = children[i - 1];
          const rightNode = children[i + 1];
          if (leftNode && rightNode && typeof leftNode.text === "string" && typeof rightNode.text === "string") {
            return {
              lhs: leftNode.text.trim(),
              op: opNode.text.trim() as ComparisonOp,
              rhs: rightNode.text.trim(),
            };
          }
        }
      }
    }

    for (const child of children) {
      const res = this.extractComparison(child);
      if (res) return res;
    }
    return null;
  }

  private isConstraintEntry(entry: SymbolEntry): boolean {
    return entry.ruleName.includes("Constraint") && (entry.kind === "Usage" || entry.kind === "Definition");
  }

  private isRequirementEntry(entry: SymbolEntry): boolean {
    return entry.ruleName.includes("Requirement") && (entry.kind === "Usage" || entry.kind === "Definition");
  }

  private isVerifyEntry(entry: SymbolEntry): boolean {
    return entry.ruleName.includes("Verify");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Constraint evaluation
  // -------------------------------------------------------------------------

  public evaluateConstraintAtTime(
    constraint: SymbolEntry,
    simResult: SimulationResult,
    timeIndex: number,
  ): { isSatisfied: boolean; error?: string } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cst = this.db.cstNode(constraint.id) as any;
    if (!cst) {
      return { isSatisfied: false, error: "No CST node found for constraint" };
    }

    const comp = this.extractComparison(cst);
    if (!comp) {
      return { isSatisfied: false, error: "Could not extract comparison from CST" };
    }

    const { lhs: lhsPath, op, rhs: rhsPath } = comp;
    const lhsValue = this.resolveOperand(lhsPath, constraint, simResult, timeIndex);
    const rhsValue = this.resolveOperand(rhsPath, constraint, simResult, timeIndex);

    if (lhsValue === undefined) {
      return { isSatisfied: false, error: `Unresolved simulation variable: ${lhsPath}` };
    }
    if (rhsValue === undefined) {
      return { isSatisfied: false, error: `Unresolved requirement limit: ${rhsPath}` };
    }

    let passed: boolean;
    switch (op) {
      case "<=":
        passed = lhsValue <= rhsValue + 1e-6;
        break;
      case ">=":
        passed = lhsValue >= rhsValue - 1e-6;
        break;
      case "<":
        passed = lhsValue < rhsValue;
        break;
      case ">":
        passed = lhsValue > rhsValue;
        break;
      case "==":
        passed = Math.abs(lhsValue - rhsValue) <= 1e-6;
        break;
      case "!=":
        passed = Math.abs(lhsValue - rhsValue) > 1e-6;
        break;
      default:
        passed = true;
        break;
    }

    if (!passed) {
      return {
        isSatisfied: false,
        error: `Constraint violated: ${lhsPath} (${lhsValue}) ${op} ${rhsPath} (${rhsValue})`,
      };
    }
    return { isSatisfied: true };
  }

  /**
   * Evaluate a constraint over the full simulation timeline.
   */
  public evaluateConstraintOverTime(
    constraint: SymbolEntry,
    requirementId: number,
    simResult: SimulationResult,
  ): VerificationResult {
    const cst = constraint.id ? (this.db.cstNode(constraint.id) as unknown) : null;
    const comp = cst ? this.extractComparison(cst) : null;

    if (comp) {
      const metricMatch = comp.lhs.match(/^(max|min|peak|settlingTime|overshoot|steadyState|integral)\s*\((.+)\)$/);
      if (metricMatch) {
        const rawMetricName = metricMatch[1]!;
        const innerVar = metricMatch[2]!.trim();
        const metricName: "max" | "min" | "settlingTime" | "overshoot" | "steadyState" | "integral" =
          rawMetricName === "peak" ? "max" : (rawMetricName as any);

        const xVals: number[] = [];
        for (let i = 0; i < simResult.t.length; i++) {
          const val = this.resolveOperand(innerVar, constraint, simResult, i);
          xVals.push(val ?? 0);
        }

        const rhsVal = this.resolveOperand(comp.rhs, constraint, simResult, simResult.t.length - 1) ?? 0;

        let computedMetric = 0;
        switch (metricName) {
          case "max":
            computedMetric = Math.max(...xVals);
            break;
          case "min":
            computedMetric = Math.min(...xVals);
            break;
          case "settlingTime":
            computedMetric = computeSettlingTime(simResult.t, xVals);
            break;
          case "overshoot":
            computedMetric = computeOvershoot(xVals);
            break;
          case "steadyState":
            computedMetric = computeSteadyState(xVals);
            break;
          case "integral":
            computedMetric = computeIntegral(simResult.t, xVals);
            break;
        }

        let passed = false;
        switch (comp.op) {
          case "<=":
            passed = computedMetric <= rhsVal + 1e-6;
            break;
          case ">=":
            passed = computedMetric >= rhsVal - 1e-6;
            break;
          case "<":
            passed = computedMetric < rhsVal;
            break;
          case ">":
            passed = computedMetric > rhsVal;
            break;
          case "==":
            passed = Math.abs(computedMetric - rhsVal) <= 1e-6;
            break;
          case "!=":
            passed = Math.abs(computedMetric - rhsVal) > 1e-6;
            break;
          default:
            passed = true;
            break;
        }

        let message: string | undefined;
        if (!passed) {
          message = `Requirement violated: ${comp.lhs} was ${computedMetric.toFixed(2)} (limit: ${comp.op} ${rhsVal.toFixed(2)})`;
        }

        return {
          requirementId,
          constraintId: constraint.id,
          isSatisfied: passed,
          timeSeriesResult: simResult.t.map(() => passed),
          message,
          peakValue: Math.max(...xVals),
          limitValue: rhsVal,
          lhsName: comp.lhs,
          metricName,
          metricValue: computedMetric,
        };
      }
    }

    let allMet = true;
    const timeSeriesResult: boolean[] = [];

    let peakLhs = -Infinity;
    let limitRhs: number | undefined;
    let firstViolationTime: number | undefined;

    for (let i = 0; i < simResult.t.length; i++) {
      const res = this.evaluateConstraintAtTime(constraint, simResult, i);
      timeSeriesResult.push(res.isSatisfied);

      if (comp) {
        const lVal = this.resolveOperand(comp.lhs, constraint, simResult, i);
        const rVal = this.resolveOperand(comp.rhs, constraint, simResult, i);
        if (lVal !== undefined && lVal > peakLhs) peakLhs = lVal;
        if (rVal !== undefined) limitRhs = rVal;
      }

      if (!res.isSatisfied) {
        if (allMet) {
          firstViolationTime = simResult.t[i];
        }
        allMet = false;
      }
    }

    let message: string | undefined;
    const lhsName = comp?.lhs;
    const limitStr = limitRhs !== undefined ? limitRhs.toFixed(1) : "?";
    const peakStr = isFinite(peakLhs) ? peakLhs.toFixed(1) : "?";

    if (!allMet) {
      const timeStr = firstViolationTime !== undefined ? `at t=${firstViolationTime.toFixed(2)}s` : "";
      message = `Requirement violated: ${lhsName ?? "value"} reached ${peakStr} (limit: ${limitStr}) ${timeStr}`.trim();
    }

    return {
      requirementId,
      constraintId: constraint.id,
      isSatisfied: allMet,
      timeSeriesResult,
      message,
      peakValue: isFinite(peakLhs) ? peakLhs : undefined,
      limitValue: limitRhs,
      violationTime: firstViolationTime,
      lhsName: lhsName ?? undefined,
      metricName: "pointwise",
    };
  }

  /**
   * Run a full verification suite against a VerificationCase/AnalysisCase symbol.
   */
  public verifyCase(
    verifyCaseId: number,
    simResult: SimulationResult,
    hypergraph?: DigitalThreadHypergraph,
  ): VerificationResult[] {
    const results: VerificationResult[] = [];
    const db = this.db;

    const verifyMembers = db
      .childrenOf(verifyCaseId)
      .filter(
        (c) =>
          this.isVerifyEntry(c) ||
          c.ruleName.includes("RequirementUsage") ||
          c.ruleName.includes("ObjectiveRequirementUsage"),
      );

    const localConstraints = db.childrenOf(verifyCaseId).filter((c) => this.isConstraintEntry(c));

    for (const constraint of localConstraints) {
      if (verifyMembers.length > 0) {
        for (const vMember of verifyMembers) {
          const reqTarget =
            this.resolveTypeEntry(vMember) ?? db.byName(vMember.name || "").find((t) => this.isRequirementEntry(t));
          if (reqTarget && this.isRequirementEntry(reqTarget)) {
            const res = this.evaluateConstraintOverTime(constraint, reqTarget.id, simResult);
            res.requirementName = reqTarget.name;
            results.push(res);
          }
        }
      } else {
        results.push(this.evaluateConstraintOverTime(constraint, verifyCaseId, simResult));
      }
    }

    for (const vMember of verifyMembers) {
      const reqTarget =
        this.resolveTypeEntry(vMember) ?? db.byName(vMember.name || "").find((t) => this.isRequirementEntry(t));
      if (!reqTarget || !this.isRequirementEntry(reqTarget)) continue;

      const allChildren = db.childrenOf(reqTarget.id);
      const reqConstraints = allChildren.filter((c) => this.isConstraintEntry(c));

      for (const constraint of reqConstraints) {
        results.push(this.evaluateConstraintOverTime(constraint, reqTarget.id, simResult));
      }
    }

    if (hypergraph) {
      for (const res of results) {
        const reqId = res.requirementId;
        let slot = hypergraph.findSlotByDomainNode(ThreadDomain.Requirements, reqId);
        if (slot === undefined) {
          slot = hypergraph.createThread(reqId);
          hypergraph.bindDomainNode(slot, ThreadDomain.Requirements, reqId);
        }

        if (res.isSatisfied) {
          hypergraph.clearConflict(slot);
          hypergraph.clearStale(slot);
        } else {
          hypergraph.markConflict(slot);
          const blast = hypergraph.computeBlastRadius(ThreadDomain.Requirements, reqId);
          res.blastRadius = blast.impactedNodes.length;
        }
      }
    }

    return results;
  }
}

/**
 * Direct vectorized trajectory verification over typed arrays.
 */
export function verifyTrajectoryDirect(
  t: Float64Array | number[],
  y: Float64Array | number[][],
  numStates: number,
  stateIdx: number,
  op: ComparisonOp,
  limitValue: number,
  tol = 1e-6,
): {
  isSatisfied: boolean;
  peakValue: number;
  violationTime?: number;
  violationIndex?: number;
  timeSeriesResult: boolean[];
} {
  const numSteps = Array.isArray(t) ? t.length : t.length;
  let allSatisfied = true;
  let peakValue = -Infinity;
  let violationTime: number | undefined;
  let violationIndex: number | undefined;
  const timeSeriesResult: boolean[] = new Array(numSteps);

  const verifyOp = parseComparisonOp(op);

  for (let i = 0; i < numSteps; i++) {
    const timeVal = Array.isArray(t) ? t[i]! : t[i]!;
    let val: number;
    if (Array.isArray(y)) {
      if (y.length === numSteps && y[i] && y[i]![stateIdx] !== undefined) {
        val = y[i]![stateIdx]!;
      } else if (y[stateIdx] && y[stateIdx]![i] !== undefined) {
        val = y[stateIdx]![i]!;
      } else {
        val = y[i] && y[i]![stateIdx] !== undefined ? y[i]![stateIdx]! : 0;
      }
    } else {
      val = y[i * numStates + stateIdx]!;
    }

    if (val > peakValue) {
      peakValue = val;
    }

    let isMet: boolean;
    switch (verifyOp) {
      case VerifyOp.LT:
        isMet = val < limitValue;
        break;
      case VerifyOp.LTE:
        isMet = val <= limitValue + tol;
        break;
      case VerifyOp.EQ:
        isMet = Math.abs(val - limitValue) <= tol;
        break;
      case VerifyOp.GTE:
        isMet = val >= limitValue - tol;
        break;
      case VerifyOp.GT:
        isMet = val > limitValue;
        break;
      case VerifyOp.NEQ:
        isMet = Math.abs(val - limitValue) > tol;
        break;
    }

    timeSeriesResult[i] = isMet;
    if (!isMet && allSatisfied) {
      allSatisfied = false;
      violationTime = timeVal;
      violationIndex = i;
    }
  }

  return {
    isSatisfied: allSatisfied,
    peakValue,
    violationTime,
    violationIndex,
    timeSeriesResult,
  };
}
