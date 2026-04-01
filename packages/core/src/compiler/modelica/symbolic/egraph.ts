// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * E-Graph (Equality Graph) engine for Equality Saturation-based expression optimization.
 *
 * An E-Graph compactly represents many equivalent expressions simultaneously.
 * Instead of destructive rewriting (replacing one form with another), the E-Graph
 * stores ALL equivalent forms and extracts the optimal one at the end using a
 * cost function.
 *
 * Core operations:
 *   1. add(expr)          — insert a ModelicaExpression, returning its EClassId
 *   2. merge(id1, id2)    — declare two expressions equivalent
 *   3. rebuild()          — restore congruence invariants after merges
 *   4. saturate(rules, N) — apply rewrite rules until saturation or N iterations
 *   5. extract(id)        — extract the lowest-cost expression from an e-class
 *
 * Used by the flattener and BLT modules to canonicalize and simplify equations
 * before structural analysis and symbolic isolation.
 */

import type { ModelicaExpression } from "../dae.js";
import {
  ModelicaBinaryExpression,
  ModelicaBooleanLiteral,
  ModelicaFunctionCallExpression,
  ModelicaIntegerLiteral,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaStringLiteral,
  ModelicaUnaryExpression,
  ModelicaVariable,
} from "../dae.js";
import { ModelicaBinaryOperator, ModelicaUnaryOperator } from "../syntax.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type EClassId = number;

/**
 * An E-Node represents a single operation in the E-Graph.
 * It stores an operator tag and its children as EClassIds.
 */
export interface ENode {
  /** Operator tag (e.g. "add", "mul", "sin", "lit:3.14", "var:x") */
  op: string;
  /** Child e-class IDs */
  children: EClassId[];
}

/**
 * A rewrite rule: when the LHS pattern matches, add the RHS as equivalent.
 */
export interface RewriteRule {
  name: string;
  /** Try to match this rule against an e-node in the given e-class.
   *  Returns a list of (eClassId, newExpression) pairs to merge, or empty if no match. */
  apply(egraph: EGraph, eClassId: EClassId, eNode: ENode): { id: EClassId; newId: EClassId }[];
}

// ─────────────────────────────────────────────────────────────────────
// Union-Find with path compression and union by rank
// ─────────────────────────────────────────────────────────────────────

class UnionFind {
  private parent: number[] = [];
  private rank: number[] = [];

  makeSet(): number {
    const id = this.parent.length;
    this.parent.push(id);
    this.rank.push(0);
    return id;
  }

  find(x: number): number {
    let root = x;
    let p = this.parent[root];
    while (p !== undefined && p !== root) {
      root = p;
      p = this.parent[root];
    }
    // Path compression
    let current = x;
    while (current !== root) {
      const next = this.parent[current];
      if (next === undefined) break;
      this.parent[current] = root;
      current = next;
    }
    return root;
  }

  union(a: number, b: number): number {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return rootA;

    const rankA = this.rank[rootA] ?? 0;
    const rankB = this.rank[rootB] ?? 0;

    if (rankA < rankB) {
      this.parent[rootA] = rootB;
      return rootB;
    } else if (rankA > rankB) {
      this.parent[rootB] = rootA;
      return rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA] = rankA + 1;
      return rootA;
    }
  }

  connected(a: number, b: number): boolean {
    return this.find(a) === this.find(b);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/** Safe child accessor — returns undefined if out of bounds. */
function child(node: ENode, index: number): EClassId | undefined {
  return node.children[index];
}

// ─────────────────────────────────────────────────────────────────────
// E-Class Analysis
// ─────────────────────────────────────────────────────────────────────

/**
 * An analysis computes and propagates metadata for each e-class.
 * When two e-classes merge, their analysis data is also merged.
 */
export interface EGraphAnalysis<D> {
  /** Compute analysis data for a single e-node given its children's data. */
  make(egraph: EGraph, node: ENode): D;
  /** Merge analysis data when two e-classes are unified. */
  merge(a: D, b: D): { data: D; didChange: boolean };
}

/** Sign info for sign analysis. */
export type Sign = "positive" | "negative" | "zero" | "unknown";

/** Analysis data attached to each e-class. */
export interface AnalysisData {
  constant: number | null; // known numeric value, or null if unknown
  sign: Sign;
}

/**
 * Constant propagation analysis.
 */
export const ConstantAnalysis: EGraphAnalysis<number | null> = {
  make(egraph: EGraph, node: ENode): number | null {
    if (node.op.startsWith("lit:")) return parseFloat(node.op.slice(4));
    if (node.children.length === 2) {
      const l = egraph.getAnalysis(node.children[0] as EClassId)?.constant ?? null;
      const r = egraph.getAnalysis(node.children[1] as EClassId)?.constant ?? null;
      if (l !== null && r !== null) {
        switch (node.op) {
          case "add":
            return l + r;
          case "sub":
            return l - r;
          case "mul":
            return l * r;
          case "div":
            return r !== 0 ? l / r : null;
          case "pow":
            return Math.pow(l, r);
        }
      }
    }
    if (node.children.length === 1 && node.op === "neg") {
      const c = egraph.getAnalysis(node.children[0] as EClassId)?.constant ?? null;
      return c !== null ? -c : null;
    }
    return null;
  },
  merge(a: number | null, b: number | null): { data: number | null; didChange: boolean } {
    // Prefer known value
    if (a !== null) return { data: a, didChange: b === null };
    if (b !== null) return { data: b, didChange: true };
    return { data: null, didChange: false };
  },
};

/**
 * Sign propagation analysis.
 */
export const SignAnalysis: EGraphAnalysis<Sign> = {
  make(egraph: EGraph, node: ENode): Sign {
    if (node.op.startsWith("lit:")) {
      const v = parseFloat(node.op.slice(4));
      if (v > 0) return "positive";
      if (v < 0) return "negative";
      return "zero";
    }
    if (node.children.length === 1 && node.op === "neg") {
      const childSign = egraph.getAnalysis(node.children[0] as EClassId)?.sign ?? "unknown";
      if (childSign === "positive") return "negative";
      if (childSign === "negative") return "positive";
      if (childSign === "zero") return "zero";
    }
    if (node.children.length === 2 && node.op === "mul") {
      const ls = egraph.getAnalysis(node.children[0] as EClassId)?.sign ?? "unknown";
      const rs = egraph.getAnalysis(node.children[1] as EClassId)?.sign ?? "unknown";
      if (ls === "zero" || rs === "zero") return "zero";
      if (ls === "positive" && rs === "positive") return "positive";
      if (ls === "negative" && rs === "negative") return "positive";
      if ((ls === "positive" && rs === "negative") || (ls === "negative" && rs === "positive")) return "negative";
    }
    if (node.op === "fn:abs") return "positive";
    if (node.op === "fn:exp") return "positive";
    // pow with even exponent → non-negative
    if (node.op === "pow" && node.children.length === 2) {
      const exp = egraph.getAnalysis(node.children[1] as EClassId)?.constant ?? null;
      if (exp !== null && exp % 2 === 0 && exp > 0) return "positive";
    }
    return "unknown";
  },
  merge(a: Sign, b: Sign): { data: Sign; didChange: boolean } {
    if (a === b) return { data: a, didChange: false };
    // Non-unknown beats unknown
    if (a !== "unknown" && b === "unknown") return { data: a, didChange: true };
    if (b !== "unknown" && a === "unknown") return { data: b, didChange: true };
    // Conflicting known signs → unknown (conservative)
    return { data: "unknown", didChange: a !== "unknown" || b !== "unknown" };
  },
};

// ─────────────────────────────────────────────────────────────────────
// E-Graph
// ─────────────────────────────────────────────────────────────────────

/**
 * The EGraph stores equivalence classes of expression nodes.
 */
export class EGraph {
  private uf = new UnionFind();
  /** Map from canonical EClassId → set of ENodes in that class */
  private classes = new Map<EClassId, ENode[]>();
  /** Hashcons: canonical ENode key → EClassId */
  private hashcons = new Map<string, EClassId>();
  /** Pending merges to process during rebuild */
  private pending: [EClassId, EClassId][] = [];
  /** Per-class analysis data */
  private analysisMap = new Map<EClassId, AnalysisData>();
  /**
   * Create a new e-class containing a single e-node.
   */
  private makeEClass(node: ENode): EClassId {
    const key = this.canonicalKey(node);
    const existing = this.hashcons.get(key);
    if (existing !== undefined) {
      return this.uf.find(existing);
    }

    const id = this.uf.makeSet();
    this.classes.set(id, [node]);
    this.hashcons.set(key, id);
    // Compute analysis data for the new e-class
    this.analysisMap.set(id, this.computeAnalysis(node));
    return id;
  }

  /**
   * Canonical string key for an ENode (for hashcons dedup).
   */
  private canonicalKey(node: ENode): string {
    const childKeys = node.children.map((c) => this.uf.find(c));
    return `${node.op}(${childKeys.join(",")})`;
  }

  /**
   * Find the canonical e-class ID.
   */
  find(id: EClassId): EClassId {
    return this.uf.find(id);
  }

  /**
   * Add a ModelicaExpression to the E-Graph, returning its EClassId.
   */
  add(expr: ModelicaExpression): EClassId {
    // Literals
    if (expr instanceof ModelicaRealLiteral) {
      return this.makeEClass({ op: `lit:${expr.value}`, children: [] });
    }
    if (expr instanceof ModelicaIntegerLiteral) {
      return this.makeEClass({ op: `lit:${expr.value}`, children: [] });
    }
    if (expr instanceof ModelicaBooleanLiteral) {
      return this.makeEClass({ op: `bool:${expr.value}`, children: [] });
    }
    if (expr instanceof ModelicaStringLiteral) {
      return this.makeEClass({ op: `str:${expr.value}`, children: [] });
    }

    // Variable references
    if (expr instanceof ModelicaNameExpression || expr instanceof ModelicaVariable) {
      return this.makeEClass({ op: `var:${(expr as ModelicaNameExpression | ModelicaVariable).name}`, children: [] });
    }

    // Unary expressions
    if (expr instanceof ModelicaUnaryExpression) {
      const childId = this.add(expr.operand);
      const op = expr.operator === ModelicaUnaryOperator.UNARY_MINUS ? "neg" : `unary:${expr.operator}`;
      return this.makeEClass({ op, children: [childId] });
    }

    // Binary expressions
    if (expr instanceof ModelicaBinaryExpression) {
      const leftId = this.add(expr.operand1);
      const rightId = this.add(expr.operand2);
      const op = binaryOpToTag(expr.operator);
      return this.makeEClass({ op, children: [leftId, rightId] });
    }

    // Function calls
    if (expr instanceof ModelicaFunctionCallExpression) {
      const childIds = (expr.args as ModelicaExpression[]).map((a) => this.add(a));
      return this.makeEClass({ op: `fn:${expr.functionName}`, children: childIds });
    }

    // Fallback: opaque node
    return this.makeEClass({ op: "opaque", children: [] });
  }

  /**
   * Merge two e-classes, declaring them equivalent.
   */
  merge(a: EClassId, b: EClassId): EClassId {
    const rootA = this.uf.find(a);
    const rootB = this.uf.find(b);
    if (rootA === rootB) return rootA;

    const merged = this.uf.union(rootA, rootB);
    const other = merged === rootA ? rootB : rootA;

    // Merge e-node sets
    const mergedNodes = this.classes.get(merged) ?? [];
    const otherNodes = this.classes.get(other) ?? [];
    mergedNodes.push(...otherNodes);
    this.classes.set(merged, mergedNodes);
    this.classes.delete(other);

    // Merge analysis data
    const dataA = this.analysisMap.get(rootA);
    const dataB = this.analysisMap.get(rootB);
    if (dataA && dataB) {
      const constResult = ConstantAnalysis.merge(dataA.constant, dataB.constant);
      const signResult = SignAnalysis.merge(dataA.sign, dataB.sign);
      this.analysisMap.set(merged, { constant: constResult.data, sign: signResult.data });
    } else if (dataA) {
      this.analysisMap.set(merged, dataA);
    } else if (dataB) {
      this.analysisMap.set(merged, dataB);
    }
    this.analysisMap.delete(other);

    // Schedule rebuild
    this.pending.push([rootA, rootB]);

    return merged;
  }

  /**
   * Rebuild: restore the congruence invariant after merges.
   * Re-canonicalizes all hashcons entries.
   */
  rebuild(): void {
    while (this.pending.length > 0) {
      const batch = [...this.pending];
      this.pending = [];

      // Rebuild hashcons
      const newHashcons = new Map<string, EClassId>();
      for (const [, id] of this.hashcons) {
        const canonical = this.uf.find(id);
        const nodes = this.classes.get(canonical);
        if (nodes) {
          for (const node of nodes) {
            const newKey = this.canonicalKey(node);
            const existing = newHashcons.get(newKey);
            if (existing !== undefined) {
              const existingCanon = this.uf.find(existing);
              const currentCanon = this.uf.find(canonical);
              if (existingCanon !== currentCanon) {
                this.pending.push([existingCanon, currentCanon]);
                this.uf.union(existingCanon, currentCanon);
              }
            } else {
              newHashcons.set(newKey, canonical);
            }
          }
        }
      }
      this.hashcons = newHashcons;

      // Re-merge classes that were split
      for (const [a, b] of batch) {
        const canonA = this.uf.find(a);
        const canonB = this.uf.find(b);
        if (canonA !== canonB) {
          const merged = this.uf.union(canonA, canonB);
          const other = merged === canonA ? canonB : canonA;
          const mergedNodes = this.classes.get(merged) ?? [];
          const otherNodes = this.classes.get(other) ?? [];
          mergedNodes.push(...otherNodes);
          this.classes.set(merged, mergedNodes);
          this.classes.delete(other);
        }
      }
    }
  }

  /**
   * Run equality saturation: iteratively apply rewrite rules until
   * no new merges occur or the iteration limit is reached.
   */
  saturate(rules: RewriteRule[], maxIterations = 30): void {
    for (let iter = 0; iter < maxIterations; iter++) {
      let anyMerged = false;

      // Collect all canonical class IDs (snapshot to avoid mutation during iteration)
      const classIds = Array.from(this.classes.keys()).map((id) => this.uf.find(id));
      const uniqueIds = [...new Set(classIds)];

      for (const classId of uniqueIds) {
        const nodes = this.classes.get(this.uf.find(classId));
        if (!nodes) continue;

        // Snapshot nodes to avoid mutation during iteration
        const nodeSnapshot = [...nodes];

        for (const node of nodeSnapshot) {
          for (const rule of rules) {
            const merges = rule.apply(this, this.uf.find(classId), node);
            for (const { id, newId } of merges) {
              if (!this.uf.connected(id, newId)) {
                this.merge(id, newId);
                anyMerged = true;
              }
            }
          }
        }
      }

      this.rebuild();

      if (!anyMerged) break;
    }
  }

  /**
   * Extract the lowest-cost expression from an e-class.
   * Uses a simple bottom-up dynamic programming approach.
   */
  extract(id: EClassId): ModelicaExpression {
    const canonical = this.uf.find(id);
    const memo = new Map<EClassId, { cost: number; expr: ModelicaExpression }>();
    return this.extractRec(canonical, memo).expr;
  }

  private extractRec(
    id: EClassId,
    memo: Map<EClassId, { cost: number; expr: ModelicaExpression }>,
  ): { cost: number; expr: ModelicaExpression } {
    const canonical = this.uf.find(id);
    const cached = memo.get(canonical);
    if (cached) return cached;

    // Prevent infinite recursion with a sentinel
    const sentinel = { cost: Infinity, expr: new ModelicaRealLiteral(0) as ModelicaExpression };
    memo.set(canonical, sentinel);

    const nodes = this.classes.get(canonical) ?? [];
    let best: { cost: number; expr: ModelicaExpression } = sentinel;

    for (const node of nodes) {
      const childResults = node.children.map((c) => this.extractRec(this.uf.find(c), memo));
      const childCost = childResults.reduce((sum, r) => sum + r.cost, 0);

      // Skip if any child was infinite (cycle)
      if (childResults.some((r) => r.cost === Infinity)) continue;

      const nodeCost = this.nodeCost(node) + childCost;
      if (nodeCost < best.cost) {
        const expr = this.nodeToExpr(
          node,
          childResults.map((r) => r.expr),
        );
        if (expr) {
          best = { cost: nodeCost, expr };
        }
      }
    }

    memo.set(canonical, best);
    return best;
  }

  /**
   * Cost of a single node (lower = simpler).
   */
  private nodeCost(node: ENode): number {
    if (node.op.startsWith("lit:") || node.op.startsWith("var:")) return 1;
    if (node.op.startsWith("fn:")) return 2;
    return 1; // binary/unary ops
  }

  /**
   * Convert an ENode + extracted children back to a ModelicaExpression.
   */
  private nodeToExpr(node: ENode, children: ModelicaExpression[]): ModelicaExpression | null {
    // Literals
    if (node.op.startsWith("lit:")) {
      const val = parseFloat(node.op.slice(4));
      if (Number.isInteger(val) && Math.abs(val) < 2 ** 31) {
        return new ModelicaIntegerLiteral(val);
      }
      return new ModelicaRealLiteral(val);
    }

    // Boolean literals
    if (node.op.startsWith("bool:")) {
      return new ModelicaBooleanLiteral(node.op === "bool:true");
    }

    // String literals
    if (node.op.startsWith("str:")) {
      return new ModelicaStringLiteral(node.op.slice(4));
    }

    // Variable references
    if (node.op.startsWith("var:")) {
      return new ModelicaNameExpression(node.op.slice(4));
    }

    // Negation
    if (node.op === "neg" && children.length === 1) {
      const c = children[0];
      if (!c) return null;
      return new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, c);
    }

    // Binary operators
    const binOp = tagToBinaryOp(node.op);
    if (binOp !== null && children.length === 2) {
      const left = children[0];
      const right = children[1];
      if (!left || !right) return null;
      return new ModelicaBinaryExpression(binOp, left, right);
    }

    // Function calls
    if (node.op.startsWith("fn:")) {
      const fname = node.op.slice(3);
      return new ModelicaFunctionCallExpression(fname, children);
    }

    return null;
  }

  // ── Helpers for rule application ──

  /**
   * Add an e-node directly, returning its e-class ID.
   * Used by rewrite rules to construct new expressions.
   */
  addNode(node: ENode): EClassId {
    // Canonicalize children
    const canonNode: ENode = {
      op: node.op,
      children: node.children.map((c) => this.uf.find(c)),
    };
    return this.makeEClass(canonNode);
  }

  /**
   * Get all e-nodes in a given e-class.
   */
  getNodes(id: EClassId): readonly ENode[] {
    return this.classes.get(this.uf.find(id)) ?? [];
  }

  /**
   * Check if an e-class contains a node with the given op tag.
   */
  hasOp(id: EClassId, op: string): boolean {
    const nodes = this.classes.get(this.uf.find(id));
    if (!nodes) return false;
    return nodes.some((n) => n.op === op);
  }

  /**
   * Find a node with a specific op in an e-class, returning first match.
   */
  findOp(id: EClassId, op: string): ENode | null {
    const nodes = this.classes.get(this.uf.find(id));
    if (!nodes) return null;
    return nodes.find((n) => n.op === op) ?? null;
  }

  /**
   * Get the numeric value of a literal e-class, if it is one.
   */
  getLiteral(id: EClassId): number | null {
    const nodes = this.classes.get(this.uf.find(id));
    if (!nodes) return null;
    for (const node of nodes) {
      if (node.op.startsWith("lit:")) {
        return parseFloat(node.op.slice(4));
      }
    }
    return null;
  }

  /**
   * Get the analysis data for an e-class.
   */
  getAnalysis(id: EClassId): AnalysisData | undefined {
    return this.analysisMap.get(this.uf.find(id));
  }

  /**
   * Compute analysis data for a single e-node.
   */
  private computeAnalysis(node: ENode): AnalysisData {
    return {
      constant: ConstantAnalysis.make(this, node),
      sign: SignAnalysis.make(this, node),
    };
  }

  /**
   * Iterate over all canonical e-class IDs.
   */
  classIds(): IterableIterator<EClassId> {
    return this.classes.keys();
  }

  /**
   * Total number of e-nodes across all e-classes.
   */
  nodeCount(): number {
    let count = 0;
    for (const nodes of this.classes.values()) count += nodes.length;
    return count;
  }

  /**
   * Number of distinct e-classes.
   */
  classCount(): number {
    return this.classes.size;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 3: Conditional Rewrites
// ─────────────────────────────────────────────────────────────────────

/**
 * Create a conditional rewrite rule. The rule only fires if the condition
 * returns true for the matched substitution.
 *
 * @example
 *   conditionalRewrite("sqrt-x2-pos", "(fn:sqrt (pow ?x 2))", "?x",
 *     (eg, subst) => eg.getAnalysis(subst.get("x")!)?.sign === "positive");
 */
export function conditionalRewrite(
  name: string,
  lhsSexpr: string,
  rhsSexpr: string,
  condition: (egraph: EGraph, subst: Substitution) => boolean,
): RewriteRule {
  const lhs = parsePattern(lhsSexpr);
  const rhs = parsePattern(rhsSexpr);
  return {
    name,
    apply(egraph, eClassId) {
      const substitutions = matchPattern(egraph, lhs, eClassId);
      const merges: { id: EClassId; newId: EClassId }[] = [];
      for (const subst of substitutions) {
        if (condition(egraph, subst)) {
          const newId = instantiatePattern(egraph, rhs, subst);
          merges.push({ id: eClassId, newId });
        }
      }
      return merges;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Phase 4: Runner with Limits & Scheduling
// ─────────────────────────────────────────────────────────────────────

export type StopReason = "Saturated" | "NodeLimit" | "TimeLimit" | "IterationLimit";

export interface RunReport {
  stopReason: StopReason;
  iterations: number;
  totalNodes: number;
  totalClasses: number;
  timeMs: number;
}

export interface RewriteScheduler {
  canFireRule(rule: RewriteRule, iteration: number): boolean;
  onRuleFired(rule: RewriteRule, numMatches: number, numMerged: number): void;
}

/**
 * BackoffScheduler: throttles rules that fire frequently without producing merges.
 */
export class BackoffScheduler implements RewriteScheduler {
  private banCount = new Map<string, number>();
  private matchCount = new Map<string, number>();
  private readonly backoffFactor: number;

  constructor(backoffFactor = 2) {
    this.backoffFactor = backoffFactor;
  }

  canFireRule(rule: RewriteRule): boolean {
    const ban = this.banCount.get(rule.name) ?? 0;
    if (ban > 0) {
      this.banCount.set(rule.name, ban - 1);
      return false;
    }
    return true;
  }

  onRuleFired(rule: RewriteRule, numMatches: number, numMerged: number): void {
    const totalMatches = (this.matchCount.get(rule.name) ?? 0) + numMatches;
    this.matchCount.set(rule.name, totalMatches);
    // If rule matched but produced no merges, impose a backoff
    if (numMatches > 0 && numMerged === 0) {
      this.banCount.set(rule.name, Math.min(totalMatches * this.backoffFactor, 1000));
    }
  }
}

/** Simple scheduler that always allows rules to fire. */
export class SimpleScheduler implements RewriteScheduler {
  canFireRule(): boolean {
    return true;
  }
  onRuleFired(): void {
    /* no-op */
  }
}

export interface RunnerConfig {
  maxIterations: number;
  maxNodeCount: number;
  maxTimeMs: number;
  scheduler: RewriteScheduler;
}

const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  maxIterations: 30,
  maxNodeCount: 10_000,
  maxTimeMs: 1000,
  scheduler: new BackoffScheduler(),
};

/**
 * Run equality saturation with configurable limits and scheduling.
 */
export function runEqualitySaturation(
  egraph: EGraph,
  rules: RewriteRule[],
  config: Partial<RunnerConfig> = {},
): RunReport {
  const cfg = { ...DEFAULT_RUNNER_CONFIG, ...config };
  const start = Date.now();
  let iterations = 0;
  let stopReason: StopReason = "IterationLimit";

  for (let iter = 0; iter < cfg.maxIterations; iter++) {
    iterations = iter + 1;

    if (Date.now() - start > cfg.maxTimeMs) {
      stopReason = "TimeLimit";
      break;
    }

    let anyMerged = false;
    const classIds = [...new Set(Array.from(egraph.classIds()).map((id) => egraph.find(id)))];

    if (classIds.length > cfg.maxNodeCount) {
      stopReason = "NodeLimit";
      break;
    }

    for (const classId of classIds) {
      const nodes = egraph.getNodes(classId);
      const nodeSnapshot = [...nodes];

      for (const node of nodeSnapshot) {
        for (const rule of rules) {
          if (!cfg.scheduler.canFireRule(rule, iter)) continue;

          const merges = rule.apply(egraph, egraph.find(classId), node);
          let numMerged = 0;
          for (const { id, newId } of merges) {
            if (egraph.find(id) !== egraph.find(newId)) {
              egraph.merge(id, newId);
              numMerged++;
              anyMerged = true;
            }
          }
          cfg.scheduler.onRuleFired(rule, merges.length, numMerged);
        }
      }
    }

    egraph.rebuild();
    if (!anyMerged) {
      stopReason = "Saturated";
      break;
    }
  }

  return {
    stopReason,
    iterations,
    totalNodes: egraph.nodeCount(),
    totalClasses: egraph.classCount(),
    timeMs: Date.now() - start,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Phase 5: Multi-Patterns
// ─────────────────────────────────────────────────────────────────────

/**
 * Create a multi-pattern rewrite that matches across multiple e-classes.
 * The applier receives the joint substitution from matching all patterns.
 */
export function multiRewrite(
  name: string,
  patterns: string[],
  applier: (egraph: EGraph, subst: Substitution) => { id: EClassId; newId: EClassId }[],
): RewriteRule {
  const parsedPatterns = patterns.map(parsePattern);
  return {
    name,
    apply(egraph, eClassId) {
      // Only match first pattern against this e-class; if it matches,
      // search all e-classes for subsequent patterns with compatible substitutions.
      if (parsedPatterns.length === 0) return [];
      const firstPat = parsedPatterns[0];
      if (!firstPat) return [];
      const firstMatches = matchPattern(egraph, firstPat, eClassId);
      if (firstMatches.length === 0) return [];

      const allMerges: { id: EClassId; newId: EClassId }[] = [];
      for (const subst of firstMatches) {
        const jointSubsts = matchRemainingPatterns(egraph, parsedPatterns.slice(1), subst);
        for (const joint of jointSubsts) {
          allMerges.push(...applier(egraph, joint));
        }
      }
      return allMerges;
    },
  };
}

function matchRemainingPatterns(egraph: EGraph, patterns: PatternNode[], subst: Substitution): Substitution[] {
  if (patterns.length === 0) return [subst];
  const pat = patterns[0];
  if (!pat) return [subst];
  const remaining = patterns.slice(1);
  const results: Substitution[] = [];

  // Search all e-classes for matches of this pattern
  for (const classId of egraph.classIds()) {
    const matches = matchPattern(egraph, pat, egraph.find(classId));
    for (const m of matches) {
      // Check consistency with existing substitution
      let consistent = true;
      for (const [k, v] of subst) {
        const mv = m.get(k);
        if (mv !== undefined && egraph.find(mv) !== egraph.find(v)) {
          consistent = false;
          break;
        }
      }
      if (consistent) {
        const merged = new Map(subst);
        for (const [k, v] of m) merged.set(k, v);
        results.push(...matchRemainingPatterns(egraph, remaining, merged));
      }
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────
// Phase 6: Proof Explanations
// ─────────────────────────────────────────────────────────────────────

export interface ExplanationStep {
  rule: string;
  from: EClassId;
  to: EClassId;
}

/**
 * Proof-tracking wrapper. When enabled, records which rules caused each merge.
 * Usage: wrap the EGraph before saturation; query afterwards.
 */
export class ProofLog {
  private steps: ExplanationStep[] = [];

  record(rule: string, from: EClassId, to: EClassId): void {
    this.steps.push({ rule, from, to });
  }

  getSteps(): readonly ExplanationStep[] {
    return this.steps;
  }

  /**
   * Wrap rules to automatically record proof steps when they fire.
   */
  wrapRules(rules: RewriteRule[]): RewriteRule[] {
    return rules.map((rule) => ({
      name: rule.name,
      apply: (egraph: EGraph, classId: EClassId, node: ENode) => {
        const merges = rule.apply(egraph, classId, node);
        for (const { id, newId } of merges) {
          if (egraph.find(id) !== egraph.find(newId)) {
            this.record(rule.name, id, newId);
          }
        }
        return merges;
      },
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 7: Pluggable Cost Functions
// ─────────────────────────────────────────────────────────────────────

/**
 * A cost function that assigns costs to e-nodes during extraction.
 * C must be a totally ordered type (compared with <).
 */
export interface CostFunction<C> {
  cost(node: ENode, childCosts: C[]): C;
}

/** Minimize total AST size (node count). */
export const AstSize: CostFunction<number> = {
  cost(_node: ENode, childCosts: number[]): number {
    return 1 + childCosts.reduce((a, b) => a + b, 0);
  },
};

/** Minimize AST depth. */
export const AstDepth: CostFunction<number> = {
  cost(_node: ENode, childCosts: number[]): number {
    return 1 + (childCosts.length > 0 ? Math.max(...childCosts) : 0);
  },
};

// ─────────────────────────────────────────────────────────────────────
// Phase 8: GraphViz Export
// ─────────────────────────────────────────────────────────────────────

/**
 * Export an EGraph as a GraphViz DOT string for debugging.
 */
export function toDot(egraph: EGraph): string {
  const lines: string[] = ["digraph EGraph {", "  compound=true;", "  clusterrank=local;"];

  for (const classId of egraph.classIds()) {
    const canonical = egraph.find(classId);
    if (classId !== canonical) continue;
    const nodes = egraph.getNodes(canonical);
    lines.push(`  subgraph cluster_${canonical} {`);
    lines.push(`    label="e${canonical}";`);
    lines.push("    style=dotted;");

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;
      const nodeId = `e${canonical}_n${i}`;
      lines.push(`    ${nodeId} [label="${node.op}" shape=box];`);
    }
    lines.push("  }");

    // Edges to children
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;
      const nodeId = `e${canonical}_n${i}`;
      for (const childId of node.children) {
        const childCanon = egraph.find(childId);
        lines.push(`  ${nodeId} -> e${childCanon}_n0 [lhead=cluster_${childCanon}];`);
      }
    }
  }

  lines.push("}");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// Operator Tag <-> ModelicaBinaryOperator mappings
// ─────────────────────────────────────────────────────────────────────

function binaryOpToTag(op: ModelicaBinaryOperator): string {
  switch (op) {
    case ModelicaBinaryOperator.ADDITION:
    case ModelicaBinaryOperator.ELEMENTWISE_ADDITION:
      return "add";
    case ModelicaBinaryOperator.SUBTRACTION:
    case ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION:
      return "sub";
    case ModelicaBinaryOperator.MULTIPLICATION:
    case ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION:
      return "mul";
    case ModelicaBinaryOperator.DIVISION:
    case ModelicaBinaryOperator.ELEMENTWISE_DIVISION:
      return "div";
    case ModelicaBinaryOperator.EXPONENTIATION:
    case ModelicaBinaryOperator.ELEMENTWISE_EXPONENTIATION:
      return "pow";
    default:
      return `binop:${op}`;
  }
}

function tagToBinaryOp(tag: string): ModelicaBinaryOperator | null {
  switch (tag) {
    case "add":
      return ModelicaBinaryOperator.ADDITION;
    case "sub":
      return ModelicaBinaryOperator.SUBTRACTION;
    case "mul":
      return ModelicaBinaryOperator.MULTIPLICATION;
    case "div":
      return ModelicaBinaryOperator.DIVISION;
    case "pow":
      return ModelicaBinaryOperator.EXPONENTIATION;
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Pattern Language Engine
// ─────────────────────────────────────────────────────────────────────

/**
 * A pattern node: either a concrete operator with children, or a pattern variable.
 */
export type PatternNode = { kind: "op"; op: string; children: PatternNode[] } | { kind: "var"; name: string };

/**
 * Parse an s-expression pattern string into a PatternNode tree.
 *
 * Syntax:
 *   - `?name`        → pattern variable
 *   - `0`, `1`, etc. → literal (becomes `lit:0`)
 *   - `(op c1 c2)`   → operator node with children
 *   - `x`            → bare atom (literal number or operator)
 */
export function parsePattern(sexpr: string): PatternNode {
  const tokens = tokenize(sexpr);
  let pos = 0;

  function peek(): string | undefined {
    return tokens[pos];
  }
  function consume(): string {
    const t = tokens[pos];
    if (t === undefined) throw new Error("Unexpected end of pattern");
    pos++;
    return t;
  }

  function parse(): PatternNode {
    const t = peek();
    if (t === "(") {
      consume(); // (
      const op = consume();
      const children: PatternNode[] = [];
      while (peek() !== ")") {
        children.push(parse());
      }
      consume(); // )
      return { kind: "op", op, children };
    } else {
      const atom = consume();
      if (atom.startsWith("?")) {
        return { kind: "var", name: atom.slice(1) };
      }
      const num = Number(atom);
      if (!isNaN(num)) {
        return { kind: "op", op: `lit:${num}`, children: [] };
      }
      return { kind: "op", op: atom, children: [] };
    }
  }

  return parse();
}

function tokenize(s: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === " " || s[i] === "\t" || s[i] === "\n") {
      i++;
    } else if (s[i] === "(" || s[i] === ")") {
      tokens.push(s[i] ?? "");
      i++;
    } else {
      const start = i;
      while (i < s.length && s[i] !== " " && s[i] !== "\t" && s[i] !== "\n" && s[i] !== "(" && s[i] !== ")") {
        i++;
      }
      tokens.push(s.slice(start, i));
    }
  }
  return tokens;
}

/** A substitution maps pattern variable names to e-class IDs. */
export type Substitution = Map<string, EClassId>;

/**
 * Match a pattern against an e-class in the e-graph.
 * Returns all valid substitutions (may be empty if no match).
 */
export function matchPattern(egraph: EGraph, pattern: PatternNode, eClassId: EClassId): Substitution[] {
  const results: Substitution[] = [];
  matchRec(egraph, pattern, eClassId, new Map(), results);
  return results;
}

function matchRec(
  egraph: EGraph,
  pattern: PatternNode,
  eClassId: EClassId,
  subst: Substitution,
  results: Substitution[],
): void {
  const canonical = egraph.find(eClassId);
  if (pattern.kind === "var") {
    const existing = subst.get(pattern.name);
    if (existing !== undefined) {
      if (egraph.find(existing) === canonical) results.push(new Map(subst));
    } else {
      const newSubst = new Map(subst);
      newSubst.set(pattern.name, canonical);
      results.push(newSubst);
    }
    return;
  }
  const nodes = egraph.getNodes(canonical);
  for (const node of nodes) {
    if (node.op !== pattern.op || node.children.length !== pattern.children.length) continue;
    matchChildren(egraph, pattern.children, node.children, 0, new Map(subst), results);
  }
}

function matchChildren(
  egraph: EGraph,
  patterns: PatternNode[],
  children: EClassId[],
  index: number,
  subst: Substitution,
  results: Substitution[],
): void {
  if (index >= patterns.length) {
    results.push(new Map(subst));
    return;
  }
  const pat = patterns[index];
  const childId = children[index];
  if (!pat || childId === undefined) return;
  const childSubsts: Substitution[] = [];
  matchRec(egraph, pat, childId, subst, childSubsts);
  for (const s of childSubsts) {
    matchChildren(egraph, patterns, children, index + 1, s, results);
  }
}

/**
 * Instantiate a pattern with a substitution, adding nodes to the e-graph.
 */
export function instantiatePattern(egraph: EGraph, pattern: PatternNode, subst: Substitution): EClassId {
  if (pattern.kind === "var") {
    const id = subst.get(pattern.name);
    if (id === undefined) throw new Error(`Unbound pattern variable: ?${pattern.name}`);
    return id;
  }
  if (pattern.children.length === 0) return egraph.addNode({ op: pattern.op, children: [] });
  const childIds = pattern.children.map((c) => instantiatePattern(egraph, c, subst));
  return egraph.addNode({ op: pattern.op, children: childIds });
}

/**
 * Create a declarative rewrite rule from s-expression pattern strings.
 *
 * @example
 *   rewrite("mul-zero-l", "(mul 0 ?a)", "0")
 *   rewrite("add-comm", "(add ?a ?b)", "(add ?b ?a)")
 */
export function rewrite(name: string, lhsSexpr: string, rhsSexpr: string): RewriteRule {
  const lhs = parsePattern(lhsSexpr);
  const rhs = parsePattern(rhsSexpr);
  return {
    name,
    apply(egraph, eClassId) {
      const substitutions = matchPattern(egraph, lhs, eClassId);
      const merges: { id: EClassId; newId: EClassId }[] = [];
      for (const subst of substitutions) {
        const newId = instantiatePattern(egraph, rhs, subst);
        merges.push({ id: eClassId, newId });
      }
      return merges;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Built-in Rewrite Rules
// ─────────────────────────────────────────────────────────────────────

/**
 * Helper: get two children from a binary node safely.
 */
function binChildren(node: ENode): [EClassId, EClassId] | null {
  if (node.children.length !== 2) return null;
  const a = child(node, 0);
  const b = child(node, 1);
  if (a === undefined || b === undefined) return null;
  return [a, b];
}

/**
 * Helper: get one child from a unary node safely.
 */
function unaryChild(node: ENode): EClassId | null {
  if (node.children.length !== 1) return null;
  const c = child(node, 0);
  return c !== undefined ? c : null;
}

// ── Declarative Rules ────────────────────────────────────────────────

const identityRules: RewriteRule[] = [
  rewrite("add-zero-l", "(add 0 ?a)", "?a"),
  rewrite("add-zero-r", "(add ?a 0)", "?a"),
  rewrite("mul-one-l", "(mul 1 ?a)", "?a"),
  rewrite("mul-one-r", "(mul ?a 1)", "?a"),
  rewrite("mul-zero-l", "(mul 0 ?a)", "0"),
  rewrite("mul-zero-r", "(mul ?a 0)", "0"),
  rewrite("sub-zero", "(sub ?a 0)", "?a"),
  rewrite("div-one", "(div ?a 1)", "?a"),
  rewrite("pow-one", "(pow ?a 1)", "?a"),
  rewrite("pow-zero", "(pow ?a 0)", "1"),
];

const cancellationRules: RewriteRule[] = [
  rewrite("sub-self", "(sub ?a ?a)", "0"),
  rewrite("div-self", "(div ?a ?a)", "1"),
  rewrite("double-neg", "(neg (neg ?a))", "?a"),
];

const commutativityRules: RewriteRule[] = [
  rewrite("add-comm", "(add ?a ?b)", "(add ?b ?a)"),
  rewrite("mul-comm", "(mul ?a ?b)", "(mul ?b ?a)"),
];

const associativityRules: RewriteRule[] = [
  rewrite("add-assoc-l", "(add (add ?a ?b) ?c)", "(add ?a (add ?b ?c))"),
  rewrite("add-assoc-r", "(add ?a (add ?b ?c))", "(add (add ?a ?b) ?c)"),
  rewrite("mul-assoc-l", "(mul (mul ?a ?b) ?c)", "(mul ?a (mul ?b ?c))"),
  rewrite("mul-assoc-r", "(mul ?a (mul ?b ?c))", "(mul (mul ?a ?b) ?c)"),
];

const distributivityRules: RewriteRule[] = [
  rewrite("dist-mul-add-r", "(mul ?a (add ?b ?c))", "(add (mul ?a ?b) (mul ?a ?c))"),
  rewrite("dist-mul-add-l", "(mul (add ?b ?c) ?a)", "(add (mul ?b ?a) (mul ?c ?a))"),
  rewrite("factor-common-l", "(add (mul ?a ?b) (mul ?a ?c))", "(mul ?a (add ?b ?c))"),
];

const powerRules: RewriteRule[] = [
  rewrite("pow-mul-base", "(mul (pow ?x ?a) (pow ?x ?b))", "(pow ?x (add ?a ?b))"),
  rewrite("pow-pow", "(pow (pow ?x ?a) ?b)", "(pow ?x (mul ?a ?b))"),
  rewrite("mul-self", "(mul ?x ?x)", "(pow ?x 2)"),
];

const negationDistributionRules: RewriteRule[] = [
  rewrite("neg-add", "(neg (add ?a ?b))", "(add (neg ?a) (neg ?b))"),
  rewrite("neg-mul", "(neg (mul ?a ?b))", "(mul (neg ?a) ?b)"),
  rewrite("neg-sub", "(neg (sub ?a ?b))", "(sub ?b ?a)"),
];

const divisionRules: RewriteRule[] = [
  rewrite("div-zero-num", "(div 0 ?a)", "0"),
  rewrite("div-to-mul-inv", "(div ?a ?b)", "(mul ?a (pow ?b -1))"),
  rewrite("div-div", "(div (div ?a ?b) ?c)", "(div ?a (mul ?b ?c))"),
];

const expLogRules: RewriteRule[] = [
  rewrite("exp-log", "(fn:exp (fn:log ?x))", "?x"),
  rewrite("log-exp", "(fn:log (fn:exp ?x))", "?x"),
  rewrite("exp-zero", "(fn:exp 0)", "1"),
  rewrite("log-one", "(fn:log 1)", "0"),
];

const trigRules: RewriteRule[] = [
  rewrite("sin-zero", "(fn:sin 0)", "0"),
  rewrite("cos-zero", "(fn:cos 0)", "1"),
  rewrite("sqrt-square", "(fn:sqrt (pow ?x 2))", "(fn:abs ?x)"),
];

const subToAddRules: RewriteRule[] = [rewrite("sub-to-add-neg", "(sub ?a ?b)", "(add ?a (neg ?b))")];

// ── Hand-Coded Rules (require runtime computation or deep e-class lookups) ──

const constantFoldingRules: RewriteRule[] = [
  {
    name: "const-fold-binary",
    apply(egraph, classId, node) {
      if (node.op !== "add" && node.op !== "sub" && node.op !== "mul" && node.op !== "div" && node.op !== "pow") {
        return [];
      }
      const ch = binChildren(node);
      if (!ch) return [];
      const left = egraph.getLiteral(ch[0]);
      const right = egraph.getLiteral(ch[1]);
      if (left === null || right === null) return [];
      let result: number | null = null;
      switch (node.op) {
        case "add":
          result = left + right;
          break;
        case "sub":
          result = left - right;
          break;
        case "mul":
          result = left * right;
          break;
        case "div":
          if (right !== 0) result = left / right;
          break;
        case "pow":
          result = Math.pow(left, right);
          break;
      }
      if (result !== null && isFinite(result)) {
        const resultId = egraph.addNode({ op: `lit:${result}`, children: [] });
        return [{ id: classId, newId: resultId }];
      }
      return [];
    },
  },
  {
    name: "const-fold-neg",
    apply(egraph, classId, node) {
      if (node.op !== "neg") return [];
      const c = unaryChild(node);
      if (c === null) return [];
      const val = egraph.getLiteral(c);
      if (val !== null) {
        const resultId = egraph.addNode({ op: `lit:${-val}`, children: [] });
        return [{ id: classId, newId: resultId }];
      }
      return [];
    },
  },
];

const pythagoreanRules: RewriteRule[] = [
  {
    name: "sin2-cos2",
    apply(egraph, classId, node) {
      if (node.op !== "add") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const result = matchSinCosPair(egraph, ch[0], ch[1]) ?? matchSinCosPair(egraph, ch[1], ch[0]);
      if (result !== null) {
        const oneId = egraph.addNode({ op: "lit:1", children: [] });
        return [{ id: classId, newId: oneId }];
      }
      return [];
    },
  },
];

function matchSinCosPair(egraph: EGraph, leftId: EClassId, rightId: EClassId): true | null {
  const leftPow = egraph.findOp(leftId, "pow");
  if (!leftPow) return null;
  const leftCh = binChildren(leftPow);
  if (!leftCh || egraph.getLiteral(leftCh[1]) !== 2) return null;
  const rightPow = egraph.findOp(rightId, "pow");
  if (!rightPow) return null;
  const rightCh = binChildren(rightPow);
  if (!rightCh || egraph.getLiteral(rightCh[1]) !== 2) return null;
  const leftSin = egraph.findOp(leftCh[0], "fn:sin");
  const rightCos = egraph.findOp(rightCh[0], "fn:cos");
  if (leftSin && rightCos) {
    const sinArg = unaryChild(leftSin);
    const cosArg = unaryChild(rightCos);
    if (sinArg !== null && cosArg !== null && egraph.find(sinArg) === egraph.find(cosArg)) return true;
  }
  const leftCos = egraph.findOp(leftCh[0], "fn:cos");
  const rightSin = egraph.findOp(rightCh[0], "fn:sin");
  if (leftCos && rightSin) {
    const cosArg = unaryChild(leftCos);
    const sinArg = unaryChild(rightSin);
    if (cosArg !== null && sinArg !== null && egraph.find(cosArg) === egraph.find(sinArg)) return true;
  }
  return null;
}

const doubleAngleRules: RewriteRule[] = [
  {
    name: "double-angle-sin",
    apply(egraph, classId, node) {
      if (node.op !== "mul") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const argId = matchDoubleAngleSin(egraph, ch[0], ch[1]);
      if (argId !== null) {
        const two = egraph.addNode({ op: "lit:2", children: [] });
        const twoX = egraph.addNode({ op: "mul", children: [two, argId] });
        const sin2x = egraph.addNode({ op: "fn:sin", children: [twoX] });
        return [{ id: classId, newId: sin2x }];
      }
      return [];
    },
  },
  {
    name: "cos-double-angle-diff",
    apply(egraph, classId, node) {
      if (node.op !== "sub") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const leftPow = egraph.findOp(ch[0], "pow");
      const rightPow = egraph.findOp(ch[1], "pow");
      if (!leftPow || !rightPow) return [];
      const lch = binChildren(leftPow);
      const rch = binChildren(rightPow);
      if (!lch || !rch) return [];
      if (egraph.getLiteral(lch[1]) !== 2 || egraph.getLiteral(rch[1]) !== 2) return [];
      const leftCos = egraph.findOp(lch[0], "fn:cos");
      const rightSin = egraph.findOp(rch[0], "fn:sin");
      if (!leftCos || !rightSin) return [];
      const cosArg = unaryChild(leftCos);
      const sinArg = unaryChild(rightSin);
      if (cosArg === null || sinArg === null) return [];
      if (egraph.find(cosArg) !== egraph.find(sinArg)) return [];
      const two = egraph.addNode({ op: "lit:2", children: [] });
      const twoX = egraph.addNode({ op: "mul", children: [two, cosArg] });
      const cos2x = egraph.addNode({ op: "fn:cos", children: [twoX] });
      return [{ id: classId, newId: cos2x }];
    },
  },
];

function matchDoubleAngleSin(egraph: EGraph, aId: EClassId, bId: EClassId): EClassId | null {
  const mulNode = egraph.findOp(aId, "mul");
  if (!mulNode) return null;
  const mch = binChildren(mulNode);
  if (!mch) return null;
  for (const [litIdx, sinIdx] of [
    [0, 1],
    [1, 0],
  ] as const) {
    if (egraph.getLiteral(mch[litIdx]) === 2) {
      const sinNode = egraph.findOp(mch[sinIdx], "fn:sin");
      if (sinNode) {
        const sinArg = unaryChild(sinNode);
        if (sinArg !== null) {
          const cosNode = egraph.findOp(bId, "fn:cos");
          if (cosNode) {
            const cosArg = unaryChild(cosNode);
            if (cosArg !== null && egraph.find(sinArg) === egraph.find(cosArg)) return sinArg;
          }
        }
      }
    }
  }
  return null;
}

/**
 * All built-in rules combined.
 */
export const DEFAULT_RULES: RewriteRule[] = [
  ...identityRules,
  ...cancellationRules,
  ...constantFoldingRules,
  ...commutativityRules,
  ...associativityRules,
  ...distributivityRules,
  ...powerRules,
  ...negationDistributionRules,
  ...divisionRules,
  ...expLogRules,
  ...trigRules,
  ...pythagoreanRules,
  ...doubleAngleRules,
  ...subToAddRules,
];
// ─────────────────────────────────────────────────────────────────────
// High-level API
// ─────────────────────────────────────────────────────────────────────

/**
 * Simplify a ModelicaExpression using Equality Saturation.
 *
 * 1. Adds the expression to a fresh E-Graph
 * 2. Runs equality saturation with the default rewrite rules
 * 3. Extracts the lowest-cost equivalent expression
 *
 * @param expr The expression to simplify
 * @param maxIterations Maximum number of saturation iterations (default: 20)
 * @returns The simplified expression
 */
export function egraphSimplify(expr: ModelicaExpression, maxIterations = 20): ModelicaExpression {
  const egraph = new EGraph();
  const rootId = egraph.add(expr);
  egraph.saturate(DEFAULT_RULES, maxIterations);
  return egraph.extract(rootId);
}
