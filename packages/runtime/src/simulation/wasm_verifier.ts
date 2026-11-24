// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic WASM Requirement & Trajectory Verification Framework.
 *
 * Provides language-agnostic requirement verification over dynamic simulation traces,
 * integrating symbol/CST resolution with zero-allocation in-WASM vector checking.
 */

import { getDefaultWasmExports } from "../dae/wasm_loader.js";
import {
  type ConstraintExprAst,
  type InlineCalcDef,
  evaluateConstraintExprScalar,
  parseConstraintComparisonAst,
  parseConstraintExprAst,
} from "../formal/requirement_binder.js";
import { DigitalThreadHypergraph, ThreadDomain } from "../interop/thread_hypergraph.js";
import type { QueryDB, SymbolEntry } from "../runtime.js";
import { globalLibraryRegistry } from "../workspace/library-manifest.js";

export interface SimulationResult {
  t: number[];
  states: string[];
  y: number[][];
  parameters?: { name: string; value: string | number | boolean }[] | undefined;
}

export interface VerificationResult {
  requirementId: number;
  constraintId: number;
  isSatisfied: boolean;
  timeSeriesResult?: boolean[] | undefined;
  message?: string | undefined;
  requirementName?: string | undefined;
  /** Peak (extremal) value of the LHS operand over the simulation timeline. */
  peakValue?: number | undefined;
  /** The RHS limit value from the requirement. */
  limitValue?: number | undefined;
  /** Simulation time at which the constraint was first violated. */
  violationTime?: number | undefined;
  /** Name of the LHS operand (e.g., "motor.T", "circuit.C.v"). */
  lhsName?: string | undefined;
  /** Temporal metric evaluated (e.g., "max", "min", "settlingTime", "overshoot", "steadyState", "integral", "pointwise"). */
  metricName?: "max" | "min" | "settlingTime" | "overshoot" | "steadyState" | "integral" | "pointwise" | undefined;
  /** Computed scalar value of the temporal metric. */
  metricValue?: number | undefined;
  /** Blast radius: number of impacted downstream artifacts in the digital thread on verification failure. */
  blastRadius?: number | undefined;
  /** Formal verification verdict kind (proven, violated, unknown). */
  verdict?: string | undefined;
  /** Rigor level of the formal verification verdict. */
  rigor?: string | undefined;
  /** Standard clause identifier if constraint belongs to a standard pack rule (e.g. "ASME BPVC VIII-1 UG-27"). */
  standardClause?: string | undefined;
  /** Signed safety margin (positive = headroom, negative = exceedance). */
  margin?: number | undefined;
}

export type ComparisonOp = "<" | "<=" | "==" | ">=" | ">" | "!=";

export interface TrajectoryConstraint {
  lhs: string;
  op: ComparisonOp;
  rhs: string | number;
  timeRange?: [number, number] | undefined;
  tolerance?: number | undefined;
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
  const n = Math.min(t.length, x.length);
  const w = getDefaultWasmExports();
  if (
    w &&
    typeof w.verifier_settlingTime === "function" &&
    typeof w.alloc === "function" &&
    typeof w.free === "function"
  ) {
    const tPtr = w.alloc(n * 8);
    const xPtr = w.alloc(n * 8);
    try {
      new Float64Array(w.memory.buffer, tPtr, n).set(t.length === n ? t : t.slice(0, n));
      new Float64Array(w.memory.buffer, xPtr, n).set(x.length === n ? x : x.slice(0, n));
      return w.verifier_settlingTime(tPtr, xPtr, n, band);
    } finally {
      w.free(tPtr);
      w.free(xPtr);
    }
  }

  const finalVal = x[n - 1] ?? 0;
  const tolerance = Math.max(Math.abs(finalVal) * band, band);
  let lastOutOfBandIndex = -1;
  for (let i = 0; i < n; i++) {
    if (Math.abs((x[i] ?? 0) - finalVal) > tolerance) lastOutOfBandIndex = i;
  }
  if (lastOutOfBandIndex === -1) return t[0] ?? 0;
  if (lastOutOfBandIndex >= n - 1) return t[n - 1] ?? 0;
  return t[lastOutOfBandIndex + 1] ?? t[n - 1] ?? 0;
}

/**
 * Computes percentage overshoot of signal trajectory relative to target/steady-state value.
 */
export function computeOvershoot(x: number[], targetVal?: number): number {
  if (x.length === 0) return 0;
  const n = x.length;
  const w = getDefaultWasmExports();
  if (
    w &&
    typeof w.verifier_overshoot === "function" &&
    typeof w.alloc === "function" &&
    typeof w.free === "function"
  ) {
    const xPtr = w.alloc(n * 8);
    try {
      new Float64Array(w.memory.buffer, xPtr, n).set(x);
      return w.verifier_overshoot(xPtr, n, targetVal !== undefined ? 1 : 0, targetVal ?? 0);
    } finally {
      w.free(xPtr);
    }
  }

  const finalVal = targetVal !== undefined ? targetVal : (x[x.length - 1] ?? 0);
  const x0 = x[0] ?? 0;
  let minVal = x0;
  let maxVal = x0;
  for (let i = 1; i < x.length; i++) {
    const val = x[i]!;
    if (val < minVal) minVal = val;
    if (val > maxVal) maxVal = val;
  }
  if (finalVal === 0) return Math.max(Math.abs(minVal), Math.abs(maxVal));
  if (finalVal > x0) {
    const diff = maxVal - finalVal;
    return diff <= 0 ? 0 : (diff / Math.abs(finalVal)) * 100;
  } else if (finalVal < x0) {
    const diff = finalVal - minVal;
    return diff <= 0 ? 0 : (diff / Math.abs(finalVal)) * 100;
  } else {
    const maxDev = Math.max(Math.abs(maxVal - finalVal), Math.abs(finalVal - minVal));
    return (maxDev / Math.abs(finalVal)) * 100;
  }
}

/**
 * Computes the steady-state value of a signal (mean of the final windowFrac of simulation).
 */
export function computeSteadyState(x: number[], windowFrac = 0.1): number {
  if (x.length === 0) return 0;
  const n = x.length;
  const w = getDefaultWasmExports();
  if (
    w &&
    typeof w.verifier_steadyState === "function" &&
    typeof w.alloc === "function" &&
    typeof w.free === "function"
  ) {
    const xPtr = w.alloc(n * 8);
    try {
      new Float64Array(w.memory.buffer, xPtr, n).set(x);
      return w.verifier_steadyState(xPtr, n, windowFrac);
    } finally {
      w.free(xPtr);
    }
  }

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
  const n = Math.min(t.length, x.length);
  const w = getDefaultWasmExports();
  if (w && typeof w.verifier_integral === "function" && typeof w.alloc === "function" && typeof w.free === "function") {
    const tPtr = w.alloc(n * 8);
    const xPtr = w.alloc(n * 8);
    try {
      new Float64Array(w.memory.buffer, tPtr, n).set(t.length === n ? t : t.slice(0, n));
      new Float64Array(w.memory.buffer, xPtr, n).set(x.length === n ? x : x.slice(0, n));
      return w.verifier_integral(tPtr, xPtr, n);
    } finally {
      w.free(tPtr);
      w.free(xPtr);
    }
  }

  let sum = 0;
  for (let i = 0; i < n - 1; i++) {
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

    // 2. Check numeric parameters (constant over time)
    if (simResult.parameters) {
      const pIdx = simResult.parameters.findIndex((p) => p.name === varName && typeof p.value === "number");
      if (pIdx !== -1) return simResult.parameters[pIdx]?.value as number;
    }
    return undefined;
  }

  private findStringInSimulation(simResult: SimulationResult, varName: string): string | undefined {
    if (!simResult.parameters) return undefined;
    const p = simResult.parameters.find((param) => param.name === varName && typeof param.value === "string");
    return p && typeof p.value === "string" ? p.value : undefined;
  }

  private resolveStringOperand(path: string, constraint: SymbolEntry, simResult: SimulationResult): string | undefined {
    const trimmed = path.trim();
    const mapped = this.variableMap.get(trimmed);
    if (mapped) {
      const s = this.findStringInSimulation(simResult, mapped);
      if (s !== undefined) return s;
    }

    const segments = trimmed.split(".");
    for (let i = 0; i < segments.length; i++) {
      const cand = segments.slice(i).join(".");
      const s = this.findStringInSimulation(simResult, cand);
      if (s !== undefined) return s;
    }

    const leafName = segments[segments.length - 1];
    if (leafName) {
      const candidateIds = new Set<number>();
      if (constraint.parentId !== null) {
        for (const c of this.db.childrenOf(constraint.parentId)) candidateIds.add(c.id);
      }
      for (const e of this.db.byName(leafName)) candidateIds.add(e.id);

      for (const id of candidateIds) {
        const entry = this.db.symbol(id);
        if (!entry || entry.name !== leafName) continue;
        const text = this.db.cstText(entry.startOffset, entry.endOffset, entry);
        const strMatch = text?.match(/=\s*(?:"([^"]*)"|'([^']*)')/);
        if (strMatch) return strMatch[1] ?? strMatch[2] ?? "";
      }
    }
    return undefined;
  }

  private collectWorkspaceCalculators(): Record<string, InlineCalcDef> {
    const calculators: Record<string, InlineCalcDef> = {};
    for (const entry of this.db.allEntries()) {
      if (entry.ruleName !== "CalculationDefinition" || !entry.name) continue;
      const text = this.db.cstText(entry.startOffset, entry.endOffset, entry);
      if (!text) continue;

      const params: string[] = [];
      const inRe = /\bin\s+(?:attribute\s+)?([a-zA-Z0-9_]+)\b/g;
      let pm: RegExpExecArray | null;
      while ((pm = inRe.exec(text)) !== null) params.push(pm[1]!);

      let externalCalculator: string | undefined;
      const extMatch = text.match(/@(?:ExternalCalculator|LookupTable)\b\s*(?:\{([^}]*)\}|\(([^)]*)\))/);
      if (extMatch) {
        const body = extMatch[1] ?? extMatch[2] ?? "";
        const prop = body.match(/(?:calculator|table|name|id)\s*=\s*(?:"([^"]*)"|'([^']*)'|([a-zA-Z0-9_.:/-]+))/);
        if (prop) externalCalculator = prop[1] ?? prop[2] ?? prop[3];
      }

      let bodyAst: ConstraintExprAst | undefined;
      const retMatch = text.match(/return\b[^=;]*=\s*([\s\S]*?);/);
      if (retMatch && retMatch[1]) {
        bodyAst = parseConstraintExprAst(retMatch[1]);
      }

      const def: InlineCalcDef = { name: entry.name, params, bodyAst, externalCalculator };
      calculators[entry.name] = def;
      if (entry.parentId !== null) {
        const parent = this.db.symbol(entry.parentId);
        if (parent?.name) calculators[`${parent.name}::${entry.name}`] = def;
      }
    }
    return calculators;
  }

  private collectNumericAttrsForExpr(
    ast: ConstraintExprAst,
    constraint: SymbolEntry,
    simResult: SimulationResult,
    timeIndex: number,
    out: Map<string, number>,
    strOut: Map<string, string>,
  ): void {
    if (ast.kind === "var") {
      if (!out.has(ast.path) && !strOut.has(ast.path)) {
        const strVal = this.resolveStringOperand(ast.path, constraint, simResult);
        if (strVal !== undefined) {
          strOut.set(ast.path, strVal);
          return;
        }
        const numVal = this.resolveOperand(ast.path, constraint, simResult, timeIndex);
        if (numVal !== undefined && Number.isFinite(numVal)) out.set(ast.path, numVal);
      }
      return;
    }
    if (ast.kind === "unary") {
      this.collectNumericAttrsForExpr(ast.operand, constraint, simResult, timeIndex, out, strOut);
    } else if (ast.kind === "bin") {
      this.collectNumericAttrsForExpr(ast.left, constraint, simResult, timeIndex, out, strOut);
      this.collectNumericAttrsForExpr(ast.right, constraint, simResult, timeIndex, out, strOut);
    } else if (ast.kind === "call") {
      for (const a of ast.args) this.collectNumericAttrsForExpr(a, constraint, simResult, timeIndex, out, strOut);
    }
  }

  private evaluateExprAstAtTime(
    exprText: string,
    constraint: SymbolEntry,
    simResult: SimulationResult,
    timeIndex: number,
  ): number | undefined {
    const ast = parseConstraintExprAst(exprText);
    if (!ast || ast.kind === "var" || ast.kind === "str") return undefined;

    const numMap = new Map<string, number>();
    const strMap = new Map<string, string>();
    this.collectNumericAttrsForExpr(ast, constraint, simResult, timeIndex, numMap, strMap);

    const calcs = this.collectWorkspaceCalculators();
    if (ast.kind === "call" && !calcs[ast.name]) {
      // Allow direct external registry call even when no `calc def` CST wrapper exists in scope
      const directExt = globalLibraryRegistry.invokeCalculator(
        ast.name,
        ast.args.map((a) =>
          a.kind === "str"
            ? a.value
            : a.kind === "var" && strMap.has(a.path)
              ? strMap.get(a.path)!
              : evaluateConstraintExprScalar(a, numMap, strMap, calcs),
        ),
      );
      if (typeof directExt === "number" && Number.isFinite(directExt)) return directExt;
    }

    const val = evaluateConstraintExprScalar(ast, numMap, strMap, calcs);
    return Number.isFinite(val) ? val : undefined;
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
   *   4. Arithmetic / calc def / lookup-table AST evaluation
   *   5. QueryDB expression evaluation
   *   6. Scope-walking for dotted paths (e.g. "req.maxLimit")
   *   7. Leaf-name CST text fallback (= <number>)
   */
  public resolveOperand(
    path: string,
    constraint: SymbolEntry,
    simResult: SimulationResult,
    timeIndex: number,
  ): number | undefined {
    const trimmed = path.trim();

    // 1. Literal number (strictly numeric so expressions like "2 * P" do not truncate to 2)
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      const num = Number(trimmed);
      if (Number.isFinite(num)) return num;
    }

    // 2. Explicit variableMap lookup
    const mapped = this.variableMap.get(trimmed);
    if (mapped !== undefined) {
      const val = this.findValueInSimulation(simResult, mapped, timeIndex);
      if (val !== undefined) return val;
    }

    // 3. Progressive path stripping: "circuit.C.v" → "C.v" → "v"
    const segments = trimmed.split(".");
    for (let i = 0; i < segments.length; i++) {
      const candidate = segments.slice(i).join(".");
      const val = this.findValueInSimulation(simResult, candidate, timeIndex);
      if (val !== undefined) return val;
    }

    // 4. Symbolic arithmetic, calc def, and external lookup-table call evaluation
    if (/[+\-*/^()]/.test(trimmed)) {
      const astVal = this.evaluateExprAstAtTime(trimmed, constraint, simResult, timeIndex);
      if (astVal !== undefined) return astVal;
    }

    // 5. QueryDB expression evaluation
    try {
      const result = this.db.evaluate(trimmed, constraint.parentId);
      if (typeof result === "number") return result;
    } catch {
      // continue fallback
    }

    // 6. Scope-walking for dotted paths like "req.maxLimit"
    if (segments.length >= 2) {
      const resolved = this.resolveQualifiedPath(segments, constraint);
      if (resolved !== undefined) return resolved;
    }

    // 7. Leaf-name CST text fallback
    const leafName = segments[segments.length - 1];
    if (leafName) {
      let candidates = this.db.byName(leafName);
      if (!candidates || candidates.length === 0) {
        candidates = this.db.allEntries().filter((e) => e.name === leafName);
      }
      for (const entry of candidates) {
        const text = this.db.cstText(entry.startOffset, entry.endOffset, entry);
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

    const text = this.db.cstText(currentEntry.startOffset, currentEntry.endOffset, currentEntry);
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

    if (typeof node.text === "string") {
      const text: string = node.text;
      const openBrace = text.indexOf("{");
      const closeBrace = text.lastIndexOf("}");
      const inner = openBrace >= 0 && closeBrace > openBrace ? text.slice(openBrace + 1, closeBrace) : text;
      const parts = inner
        .split(/[;\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const candidate of [inner.trim(), ...parts]) {
        const opMatch = candidate.match(/^([\s\S]+?)\s*(<=|>=|==|!=|<|>)\s*([\s\S]+)$/);
        if (opMatch && parseConstraintComparisonAst(candidate)) {
          return {
            lhs: opMatch[1]!.trim(),
            op: opMatch[2]!.trim() as ComparisonOp,
            rhs: opMatch[3]!.trim(),
          };
        }
      }
    }

    return null;
  }

  private extractRequirementStandardClause(requirementId: number): string | undefined {
    const reqEntry = this.db.symbol?.(requirementId);
    if (!reqEntry) return undefined;
    const text = this.db.cstText?.(reqEntry.startOffset, reqEntry.endOffset, reqEntry);
    if (!text) return undefined;
    const metaMatch = text.match(/@(?:StandardClause|ComplianceRule|Standard)\b\s*(?:\{([^}]*)\}|\(([^)]*)\))/);
    if (!metaMatch) return undefined;
    const body = metaMatch[1] ?? metaMatch[2] ?? "";
    const stdMatch = body.match(/(?:standard|code)\s*=\s*(?:"([^"]*)"|'([^']*)')/);
    const clsMatch = body.match(/(?:clauseId|clause|id)\s*=\s*(?:"([^"]*)"|'([^']*)')/);
    const parts = [stdMatch?.[1] ?? stdMatch?.[2], clsMatch?.[1] ?? clsMatch?.[2]].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : undefined;
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
  ): { isSatisfied: boolean; error?: string | undefined } {
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
    const standardClause = this.extractRequirementStandardClause(requirementId);

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

        const clausePrefix = standardClause ? `[${standardClause}] ` : "";
        let message: string | undefined;
        if (!passed) {
          message = `${clausePrefix}Requirement violated: ${comp.lhs} was ${computedMetric.toFixed(2)} (limit: ${comp.op} ${rhsVal.toFixed(2)})`;
        }
        const metricMargin =
          comp.op === "<=" || comp.op === "<"
            ? rhsVal - computedMetric
            : comp.op === ">=" || comp.op === ">"
              ? computedMetric - rhsVal
              : undefined;

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
          standardClause,
          margin: metricMargin,
        };
      }
    }

    let allMet = true;
    const timeSeriesResult: boolean[] = [];

    let peakLhs = -Infinity;
    let limitRhs: number | undefined;
    let firstViolationTime: number | undefined;
    let minMargin = Infinity;

    for (let i = 0; i < simResult.t.length; i++) {
      const res = this.evaluateConstraintAtTime(constraint, simResult, i);
      timeSeriesResult.push(res.isSatisfied);

      if (comp) {
        const lVal = this.resolveOperand(comp.lhs, constraint, simResult, i);
        const rVal = this.resolveOperand(comp.rhs, constraint, simResult, i);
        if (lVal !== undefined && lVal > peakLhs) peakLhs = lVal;
        if (rVal !== undefined) limitRhs = rVal;
        if (lVal !== undefined && rVal !== undefined) {
          const marginAtT =
            comp.op === "<=" || comp.op === "<"
              ? rVal - lVal
              : comp.op === ">=" || comp.op === ">"
                ? lVal - rVal
                : undefined;
          if (marginAtT !== undefined && marginAtT < minMargin) minMargin = marginAtT;
        }
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
      const clausePrefix = standardClause ? `[${standardClause}] ` : "";
      const timeStr = firstViolationTime !== undefined ? `at t=${firstViolationTime.toFixed(2)}s` : "";
      message =
        `${clausePrefix}Requirement violated: ${lhsName ?? "value"} reached ${peakStr} (limit: ${limitStr}) ${timeStr}`.trim();
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
      standardClause,
      margin: Number.isFinite(minMargin) ? minMargin : undefined,
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
      const assumeConstraints = reqConstraints.filter((c) =>
        (db.cstText(c.startOffset, c.endOffset, c) ?? "").trimStart().startsWith("assume"),
      );
      const requireConstraints = reqConstraints.filter((c) => !assumeConstraints.includes(c));

      if (assumeConstraints.length > 0) {
        const assumeAnyActive = assumeConstraints.every((ac) => {
          const aRes = this.evaluateConstraintOverTime(ac, reqTarget.id, simResult);
          return aRes.isSatisfied || (aRes.timeSeriesResult?.some(Boolean) ?? false);
        });
        if (!assumeAnyActive) {
          continue;
        }
      }

      for (const constraint of requireConstraints) {
        const res = this.evaluateConstraintOverTime(constraint, reqTarget.id, simResult);
        res.requirementName = res.requirementName ?? reqTarget.name;
        results.push(res);
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
 * Direct vectorized trajectory verification over typed arrays using
 * the compiled AssemblyScript `verifier_verifyTrajectoryDirect` kernel.
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
  violationTime?: number | undefined;
  violationIndex?: number | undefined;
  timeSeriesResult: boolean[];
} {
  const numSteps = t.length;
  const verifyOp = parseComparisonOp(op);

  if (numSteps > 0) {
    const w = getDefaultWasmExports();
    if (
      w &&
      typeof w.verifier_verifyTrajectoryDirect === "function" &&
      typeof w.alloc === "function" &&
      typeof w.free === "function"
    ) {
      const tPtr = w.alloc(numSteps * 8);
      const yFlatLen = numSteps * Math.max(1, numStates);
      const yPtr = w.alloc(yFlatLen * 8);
      const outSeriesPtr = w.alloc(numSteps);
      const outStatsPtr = w.alloc(5 * 8);
      try {
        const tView = new Float64Array(w.memory.buffer, tPtr, numSteps);
        if (t instanceof Float64Array) {
          tView.set(t);
        } else {
          for (let i = 0; i < numSteps; i++) tView[i] = t[i] ?? 0;
        }

        const yView = new Float64Array(w.memory.buffer, yPtr, yFlatLen);
        if (y instanceof Float64Array) {
          yView.set(y.subarray(0, Math.min(y.length, yFlatLen)));
        } else {
          // Support both row-major y[step][state] and column-major y[state][step]
          const isRowMajor = y.length === numSteps && y[0] && y[0]![stateIdx] !== undefined;
          for (let i = 0; i < numSteps; i++) {
            let val: number;
            if (isRowMajor) {
              val = y[i]?.[stateIdx] ?? 0;
            } else if (y[stateIdx] && y[stateIdx]![i] !== undefined) {
              val = y[stateIdx]![i]!;
            } else {
              val = y[i]?.[stateIdx] ?? 0;
            }
            yView[i * numStates + stateIdx] = val;
          }
        }

        const satisfiedFlag = w.verifier_verifyTrajectoryDirect(
          tPtr,
          yPtr,
          numSteps,
          numStates,
          stateIdx,
          verifyOp,
          limitValue,
          tol,
          outSeriesPtr,
          outStatsPtr,
        );

        const stats = new Float64Array(w.memory.buffer, outStatsPtr, 5);
        const seriesBytes = new Uint8Array(w.memory.buffer, outSeriesPtr, numSteps);
        const timeSeriesResult: boolean[] = new Array(numSteps);
        for (let i = 0; i < numSteps; i++) {
          timeSeriesResult[i] = seriesBytes[i] === 1;
        }

        const isSatisfied = satisfiedFlag === 1;
        const peakValue = stats[1]!;
        const violationTime = !isSatisfied && stats[3]! >= 0 ? stats[3]! : undefined;
        const violationIndex = !isSatisfied && stats[4]! >= 0 ? Math.trunc(stats[4]!) : undefined;

        return {
          isSatisfied,
          peakValue,
          violationTime,
          violationIndex,
          timeSeriesResult,
        };
      } finally {
        w.free(tPtr);
        w.free(yPtr);
        w.free(outSeriesPtr);
        w.free(outStatsPtr);
      }
    }
  }

  let allSatisfied = true;
  let peakValue = -Infinity;
  let violationTime: number | undefined;
  let violationIndex: number | undefined;
  const timeSeriesResult: boolean[] = new Array(numSteps);

  for (let i = 0; i < numSteps; i++) {
    const timeVal = t[i]!;
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
