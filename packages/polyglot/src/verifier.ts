import type { QueryDB, SymbolEntry } from "./runtime.js";
import type { SimulationResult } from "./simulation.js";

/**
 * Result of verifying a requirement constraint against a dynamic simulation run.
 */
export interface VerificationResult {
  requirementId: number;
  constraintId: number;
  isSatisfied: boolean;
  /** Array of boolean values over time, or a single boolean if static */
  timeSeriesResult?: boolean[];
  message?: string;
}

/**
 * Language-agnostic orchestrator that evaluates constraints extracted from a
 * verification/analysis case against time-series simulation results.
 *
 * The runner is completely decoupled from any specific grammar rule names.
 * It relies on:
 *   - `QueryDB` for symbol index traversal and expression evaluation
 *   - An explicit `variableMap` (sysmlPath → simVarName) from topology extraction
 *   - Pattern-based predicates to discover constraints, requirements, and verify entries
 */
export class VerificationRunner {
  /**
   * Optional explicit mapping from constraint feature paths to simulation
   * variable names, produced by the topology extraction query.
   * e.g., "circuit.C.v" → "C.v"
   */
  private variableMap: Map<string, string>;

  constructor(
    private db: QueryDB,
    variableMap?: Map<string, string>,
  ) {
    this.variableMap = variableMap ?? new Map();
  }

  // -------------------------------------------------------------------------
  // Simulation value lookup
  // -------------------------------------------------------------------------

  private findValueInSimulation(simResult: SimulationResult, varName: string, timeIndex: number): number | undefined {
    // Check states
    const stateIdx = simResult.states.indexOf(varName);
    if (stateIdx !== -1) return simResult.y[timeIndex][stateIdx];

    // Check parameters (they are constant over time)
    if (simResult.parameters) {
      const pIdx = simResult.parameters.findIndex((p) => p.name === varName);
      if (pIdx !== -1) return simResult.parameters[pIdx].value as number;
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Language-agnostic operand resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve a constraint operand (LHS or RHS) to a numeric value.
   *
   * Resolution cascade:
   *   1. Numeric literal
   *   2. Explicit variableMap → simulation lookup
   *   3. Progressive path stripping → simulation lookup
   *   4. QueryDB expression evaluation (resolves feature paths, defaults, expressions)
   *   5. Leaf-name CST text fallback (reads `= <number>` patterns from default values)
   */
  private resolveOperand(
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
      // evaluation not available or failed — continue
    }

    // 5. Leaf-name CST text fallback
    const leafName = segments[segments.length - 1];
    const candidates = this.db.byName(leafName);
    for (const entry of candidates) {
      const text = this.db.cstText(entry.startByte, entry.endByte);
      if (text) {
        const match = text.match(/=\s*(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
        if (match) return parseFloat(match[1]);
      }
    }

    return undefined;
  }

  // -------------------------------------------------------------------------
  // CST comparison extraction
  // -------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractComparison(node: any): { lhs: string; op: string; rhs: string } | null {
    if (!node || typeof node.childCount !== "number") return null;

    // Strategy 1: Named field access (tree-sitter grammars that use operator/left/right)
    const opNodeRef = node.childForFieldName ? node.childForFieldName("operator") : null;
    const leftNodeRef = node.childForFieldName
      ? node.childForFieldName("left") || node.childForFieldName("operand")
      : null;
    const rightNodeRef = node.childForFieldName ? node.childForFieldName("right") : null;

    if (leftNodeRef && opNodeRef && rightNodeRef && typeof opNodeRef.text === "string") {
      const opText = opNodeRef.text.trim();
      const ops = new Set(["<", "<=", "==", ">=", ">"]);
      if (ops.has(opText) && leftNodeRef.text && rightNodeRef.text) {
        return {
          lhs: leftNodeRef.text.trim(),
          op: opText,
          rhs: rightNodeRef.text.trim(),
        };
      }
    }

    // Strategy 2: Positional child iteration (for flat CST structures)
    const ops = new Set(["<", "<=", "==", ">=", ">"]);
    if (node.childCount >= 3) {
      for (let i = 1; i < node.childCount - 1; i++) {
        const opNode = node.child(i);
        if (opNode && typeof opNode.text === "string" && ops.has(opNode.text.trim())) {
          const leftNode = node.child(i - 1);
          const rightNode = node.child(i + 1);
          if (leftNode && rightNode && typeof leftNode.text === "string" && typeof rightNode.text === "string") {
            return {
              lhs: leftNode.text.trim(),
              op: opNode.text.trim(),
              rhs: rightNode.text.trim(),
            };
          }
        }
      }
    }

    // Strategy 3: Recursive descent into children
    for (let i = 0; i < node.childCount; i++) {
      const res = this.extractComparison(node.child(i));
      if (res) return res;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Language-agnostic predicates
  // -------------------------------------------------------------------------

  /** True if the entry represents a constraint (any language). */
  private isConstraintEntry(entry: SymbolEntry): boolean {
    return entry.ruleName.includes("Constraint") && (entry.kind === "Usage" || entry.kind === "Definition");
  }

  /** True if the entry represents a requirement (any language). */
  private isRequirementEntry(entry: SymbolEntry): boolean {
    return entry.ruleName.includes("Requirement") && (entry.kind === "Usage" || entry.kind === "Definition");
  }

  /** True if the entry represents a verify-requirement usage. */
  private isVerifyEntry(entry: SymbolEntry): boolean {
    return entry.ruleName.includes("Verify");
  }

  // -------------------------------------------------------------------------
  // Constraint evaluation
  // -------------------------------------------------------------------------

  /**
   * Evaluates a constraint AST against a specific timestep of simulation results.
   */
  evaluateConstraintAtTime(
    constraint: SymbolEntry,
    simResult: SimulationResult,
    timeIndex: number,
  ): { isSatisfied: boolean; error?: string } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cst = this.db.cstNode(constraint.id) as any;
    if (!cst) {
      return { isSatisfied: true };
    }

    const comp = this.extractComparison(cst);
    if (!comp) {
      return { isSatisfied: true };
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
        passed = lhsValue <= rhsValue;
        break;
      case ">=":
        passed = lhsValue >= rhsValue;
        break;
      case "<":
        passed = lhsValue < rhsValue;
        break;
      case ">":
        passed = lhsValue > rhsValue;
        break;
      case "==":
        passed = Math.abs(lhsValue - rhsValue) < 1e-6;
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

  // -------------------------------------------------------------------------
  // Time-series evaluation helper
  // -------------------------------------------------------------------------

  /**
   * Evaluate a single constraint over the full simulation timeline.
   * Returns a VerificationResult with time-series data.
   */
  private evaluateConstraintOverTime(
    constraint: SymbolEntry,
    requirementId: number,
    simResult: SimulationResult,
  ): VerificationResult {
    let allMet = true;
    let failMessage: string | undefined;
    const timeSeriesResult: boolean[] = [];

    for (let i = 0; i < simResult.t.length; i++) {
      const res = this.evaluateConstraintAtTime(constraint, simResult, i);
      timeSeriesResult.push(res.isSatisfied);
      if (!res.isSatisfied) {
        allMet = false;
        if (!failMessage) failMessage = res.error;
      }
    }

    return {
      requirementId,
      constraintId: constraint.id,
      isSatisfied: allMet,
      timeSeriesResult,
      message: failMessage,
    };
  }

  // -------------------------------------------------------------------------
  // Top-level verification
  // -------------------------------------------------------------------------

  /**
   * Run a full verification suite against a VerificationCase/AnalysisCase symbol.
   * Discovers constraints and requirements using language-agnostic predicates.
   */
  verifyCase(verifyCaseId: number, simResult: SimulationResult): VerificationResult[] {
    const results: VerificationResult[] = [];
    const db = this.db;

    // A. Evaluate constraint children directly defined within the case
    const localConstraints = db.childrenOf(verifyCaseId).filter((c) => this.isConstraintEntry(c));
    for (const constraint of localConstraints) {
      results.push(this.evaluateConstraintOverTime(constraint, verifyCaseId, simResult));
    }

    // B. Find verify-requirement children and evaluate their target requirements
    const verifyMembers = db.childrenOf(verifyCaseId).filter((c) => this.isVerifyEntry(c));

    for (const vMember of verifyMembers) {
      if (!vMember.name) continue;

      // Discover target Requirement by name
      const targets = db.byName(vMember.name);
      const reqTarget = targets.find((t) => this.isRequirementEntry(t));
      if (!reqTarget) continue;

      // Find and evaluate the requirement's constraint children
      const reqConstraints = db.childrenOf(reqTarget.id).filter((c) => this.isConstraintEntry(c));
      for (const constraint of reqConstraints) {
        results.push(this.evaluateConstraintOverTime(constraint, reqTarget.id, simResult));
      }
    }

    return results;
  }
}
