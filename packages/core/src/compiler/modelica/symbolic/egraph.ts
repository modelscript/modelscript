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
    if (expr instanceof ModelicaNameExpression) {
      return this.makeEClass({ op: `var:${expr.name}`, children: [] });
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

/**
 * Identity rules: x + 0 → x, x * 1 → x, x * 0 → 0, x ^ 1 → x, x ^ 0 → 1
 */
const identityRules: RewriteRule[] = [
  {
    name: "add-zero-left",
    apply(egraph, classId, node) {
      if (node.op !== "add") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      if (egraph.getLiteral(ch[0]) === 0) {
        return [{ id: classId, newId: egraph.find(ch[1]) }];
      }
      return [];
    },
  },
  {
    name: "add-zero-right",
    apply(egraph, classId, node) {
      if (node.op !== "add") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      if (egraph.getLiteral(ch[1]) === 0) {
        return [{ id: classId, newId: egraph.find(ch[0]) }];
      }
      return [];
    },
  },
  {
    name: "mul-one-left",
    apply(egraph, classId, node) {
      if (node.op !== "mul") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      if (egraph.getLiteral(ch[0]) === 1) {
        return [{ id: classId, newId: egraph.find(ch[1]) }];
      }
      return [];
    },
  },
  {
    name: "mul-one-right",
    apply(egraph, classId, node) {
      if (node.op !== "mul") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      if (egraph.getLiteral(ch[1]) === 1) {
        return [{ id: classId, newId: egraph.find(ch[0]) }];
      }
      return [];
    },
  },
  {
    name: "mul-zero-left",
    apply(egraph, classId, node) {
      if (node.op !== "mul") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      if (egraph.getLiteral(ch[0]) === 0) {
        return [{ id: classId, newId: egraph.find(ch[0]) }];
      }
      return [];
    },
  },
  {
    name: "mul-zero-right",
    apply(egraph, classId, node) {
      if (node.op !== "mul") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      if (egraph.getLiteral(ch[1]) === 0) {
        return [{ id: classId, newId: egraph.find(ch[1]) }];
      }
      return [];
    },
  },
  {
    name: "sub-zero",
    apply(egraph, classId, node) {
      if (node.op !== "sub") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      if (egraph.getLiteral(ch[1]) === 0) {
        return [{ id: classId, newId: egraph.find(ch[0]) }];
      }
      return [];
    },
  },
  {
    name: "div-one",
    apply(egraph, classId, node) {
      if (node.op !== "div") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      if (egraph.getLiteral(ch[1]) === 1) {
        return [{ id: classId, newId: egraph.find(ch[0]) }];
      }
      return [];
    },
  },
  {
    name: "pow-one",
    apply(egraph, classId, node) {
      if (node.op !== "pow") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      if (egraph.getLiteral(ch[1]) === 1) {
        return [{ id: classId, newId: egraph.find(ch[0]) }];
      }
      return [];
    },
  },
  {
    name: "pow-zero",
    apply(egraph, classId, node) {
      if (node.op !== "pow") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      if (egraph.getLiteral(ch[1]) === 0) {
        const oneId = egraph.addNode({ op: "lit:1", children: [] });
        return [{ id: classId, newId: oneId }];
      }
      return [];
    },
  },
];

/**
 * Self-cancellation rules: x - x → 0, x / x → 1, -(-x) → x
 */
const cancellationRules: RewriteRule[] = [
  {
    name: "sub-self",
    apply(egraph, classId, node) {
      if (node.op !== "sub") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      if (egraph.find(ch[0]) === egraph.find(ch[1])) {
        const zeroId = egraph.addNode({ op: "lit:0", children: [] });
        return [{ id: classId, newId: zeroId }];
      }
      return [];
    },
  },
  {
    name: "div-self",
    apply(egraph, classId, node) {
      if (node.op !== "div") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      if (egraph.find(ch[0]) === egraph.find(ch[1])) {
        const oneId = egraph.addNode({ op: "lit:1", children: [] });
        return [{ id: classId, newId: oneId }];
      }
      return [];
    },
  },
  {
    name: "double-neg",
    apply(egraph, classId, node) {
      if (node.op !== "neg") return [];
      const c = unaryChild(node);
      if (c === null) return [];
      const innerNode = egraph.findOp(c, "neg");
      if (innerNode) {
        const innerC = unaryChild(innerNode);
        if (innerC !== null) {
          return [{ id: classId, newId: egraph.find(innerC) }];
        }
      }
      return [];
    },
  },
];

/**
 * Constant folding: evaluate pure numeric sub-expressions.
 */
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

/**
 * Commutativity rules: a + b ↔ b + a, a * b ↔ b * a
 */
const commutativityRules: RewriteRule[] = [
  {
    name: "add-comm",
    apply(egraph, classId, node) {
      if (node.op !== "add") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const swapped = egraph.addNode({ op: "add", children: [ch[1], ch[0]] });
      return [{ id: classId, newId: swapped }];
    },
  },
  {
    name: "mul-comm",
    apply(egraph, classId, node) {
      if (node.op !== "mul") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const swapped = egraph.addNode({ op: "mul", children: [ch[1], ch[0]] });
      return [{ id: classId, newId: swapped }];
    },
  },
];

/**
 * Exponential and logarithmic identity rules.
 */
const expLogRules: RewriteRule[] = [
  {
    name: "exp-log",
    apply(egraph, classId, node) {
      // exp(log(x)) → x
      if (node.op !== "fn:exp") return [];
      const c = unaryChild(node);
      if (c === null) return [];
      const inner = egraph.findOp(c, "fn:log");
      if (inner) {
        const innerC = unaryChild(inner);
        if (innerC !== null) {
          return [{ id: classId, newId: egraph.find(innerC) }];
        }
      }
      return [];
    },
  },
  {
    name: "log-exp",
    apply(egraph, classId, node) {
      // log(exp(x)) → x
      if (node.op !== "fn:log") return [];
      const c = unaryChild(node);
      if (c === null) return [];
      const inner = egraph.findOp(c, "fn:exp");
      if (inner) {
        const innerC = unaryChild(inner);
        if (innerC !== null) {
          return [{ id: classId, newId: egraph.find(innerC) }];
        }
      }
      return [];
    },
  },
  {
    name: "exp-zero",
    apply(egraph, classId, node) {
      // exp(0) → 1
      if (node.op !== "fn:exp") return [];
      const c = unaryChild(node);
      if (c === null) return [];
      if (egraph.getLiteral(c) === 0) {
        const oneId = egraph.addNode({ op: "lit:1", children: [] });
        return [{ id: classId, newId: oneId }];
      }
      return [];
    },
  },
  {
    name: "log-one",
    apply(egraph, classId, node) {
      // log(1) → 0
      if (node.op !== "fn:log") return [];
      const c = unaryChild(node);
      if (c === null) return [];
      if (egraph.getLiteral(c) === 1) {
        const zeroId = egraph.addNode({ op: "lit:0", children: [] });
        return [{ id: classId, newId: zeroId }];
      }
      return [];
    },
  },
];

/**
 * Trigonometric identity rules.
 */
const trigRules: RewriteRule[] = [
  {
    name: "sin-zero",
    apply(egraph, classId, node) {
      // sin(0) → 0
      if (node.op !== "fn:sin") return [];
      const c = unaryChild(node);
      if (c === null) return [];
      if (egraph.getLiteral(c) === 0) {
        const zeroId = egraph.addNode({ op: "lit:0", children: [] });
        return [{ id: classId, newId: zeroId }];
      }
      return [];
    },
  },
  {
    name: "cos-zero",
    apply(egraph, classId, node) {
      // cos(0) → 1
      if (node.op !== "fn:cos") return [];
      const c = unaryChild(node);
      if (c === null) return [];
      if (egraph.getLiteral(c) === 0) {
        const oneId = egraph.addNode({ op: "lit:1", children: [] });
        return [{ id: classId, newId: oneId }];
      }
      return [];
    },
  },
  {
    name: "sqrt-square",
    apply(egraph, classId, node) {
      // sqrt(x^2) → abs(x)
      if (node.op !== "fn:sqrt") return [];
      const c = unaryChild(node);
      if (c === null) return [];
      const inner = egraph.findOp(c, "pow");
      if (inner) {
        const ch = binChildren(inner);
        if (ch && egraph.getLiteral(ch[1]) === 2) {
          const absId = egraph.addNode({ op: "fn:abs", children: [ch[0]] });
          return [{ id: classId, newId: absId }];
        }
      }
      return [];
    },
  },
];

/**
 * Subtraction-to-addition rewrite: a - b ↔ a + (-b)
 */
const subToAddRules: RewriteRule[] = [
  {
    name: "sub-to-add-neg",
    apply(egraph, classId, node) {
      // a - b → a + (-b)
      if (node.op !== "sub") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const negB = egraph.addNode({ op: "neg", children: [ch[1]] });
      const addNode = egraph.addNode({ op: "add", children: [ch[0], negB] });
      return [{ id: classId, newId: addNode }];
    },
  },
];

/**
 * Associativity rules: (a+b)+c ↔ a+(b+c), (a*b)*c ↔ a*(b*c)
 */
const associativityRules: RewriteRule[] = [
  {
    name: "add-assoc-left",
    apply(egraph, classId, node) {
      // (a + b) + c → a + (b + c)
      if (node.op !== "add") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const inner = egraph.findOp(ch[0], "add");
      if (!inner) return [];
      const innerCh = binChildren(inner);
      if (!innerCh) return [];
      const bc = egraph.addNode({ op: "add", children: [innerCh[1], ch[1]] });
      const result = egraph.addNode({ op: "add", children: [innerCh[0], bc] });
      return [{ id: classId, newId: result }];
    },
  },
  {
    name: "add-assoc-right",
    apply(egraph, classId, node) {
      // a + (b + c) → (a + b) + c
      if (node.op !== "add") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const inner = egraph.findOp(ch[1], "add");
      if (!inner) return [];
      const innerCh = binChildren(inner);
      if (!innerCh) return [];
      const ab = egraph.addNode({ op: "add", children: [ch[0], innerCh[0]] });
      const result = egraph.addNode({ op: "add", children: [ab, innerCh[1]] });
      return [{ id: classId, newId: result }];
    },
  },
  {
    name: "mul-assoc-left",
    apply(egraph, classId, node) {
      // (a * b) * c → a * (b * c)
      if (node.op !== "mul") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const inner = egraph.findOp(ch[0], "mul");
      if (!inner) return [];
      const innerCh = binChildren(inner);
      if (!innerCh) return [];
      const bc = egraph.addNode({ op: "mul", children: [innerCh[1], ch[1]] });
      const result = egraph.addNode({ op: "mul", children: [innerCh[0], bc] });
      return [{ id: classId, newId: result }];
    },
  },
  {
    name: "mul-assoc-right",
    apply(egraph, classId, node) {
      // a * (b * c) → (a * b) * c
      if (node.op !== "mul") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const inner = egraph.findOp(ch[1], "mul");
      if (!inner) return [];
      const innerCh = binChildren(inner);
      if (!innerCh) return [];
      const ab = egraph.addNode({ op: "mul", children: [ch[0], innerCh[0]] });
      const result = egraph.addNode({ op: "mul", children: [ab, innerCh[1]] });
      return [{ id: classId, newId: result }];
    },
  },
];

/**
 * Distributivity rules: a*(b+c) ↔ a*b + a*c
 */
const distributivityRules: RewriteRule[] = [
  {
    name: "distribute-mul-over-add",
    apply(egraph, classId, node) {
      // a * (b + c) → a*b + a*c
      if (node.op !== "mul") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      // Check right child for add
      const addNode = egraph.findOp(ch[1], "add");
      if (addNode) {
        const addCh = binChildren(addNode);
        if (addCh) {
          const ab = egraph.addNode({ op: "mul", children: [ch[0], addCh[0]] });
          const ac = egraph.addNode({ op: "mul", children: [ch[0], addCh[1]] });
          const result = egraph.addNode({ op: "add", children: [ab, ac] });
          return [{ id: classId, newId: result }];
        }
      }
      return [];
    },
  },
  {
    name: "distribute-mul-over-add-left",
    apply(egraph, classId, node) {
      // (b + c) * a → b*a + c*a
      if (node.op !== "mul") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const addNode = egraph.findOp(ch[0], "add");
      if (addNode) {
        const addCh = binChildren(addNode);
        if (addCh) {
          const ba = egraph.addNode({ op: "mul", children: [addCh[0], ch[1]] });
          const ca = egraph.addNode({ op: "mul", children: [addCh[1], ch[1]] });
          const result = egraph.addNode({ op: "add", children: [ba, ca] });
          return [{ id: classId, newId: result }];
        }
      }
      return [];
    },
  },
  {
    name: "factor-add-common-left",
    apply(egraph, classId, node) {
      // a*b + a*c → a*(b+c)
      if (node.op !== "add") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const leftMul = egraph.findOp(ch[0], "mul");
      const rightMul = egraph.findOp(ch[1], "mul");
      if (!leftMul || !rightMul) return [];
      const lch = binChildren(leftMul);
      const rch = binChildren(rightMul);
      if (!lch || !rch) return [];
      // Check if left factors match: a*b + a*c
      if (egraph.find(lch[0]) === egraph.find(rch[0])) {
        const sum = egraph.addNode({ op: "add", children: [lch[1], rch[1]] });
        const result = egraph.addNode({ op: "mul", children: [lch[0], sum] });
        return [{ id: classId, newId: result }];
      }
      return [];
    },
  },
];

/**
 * Power rules: x^a * x^b → x^(a+b), (x^a)^b → x^(a*b)
 */
const powerRules: RewriteRule[] = [
  {
    name: "pow-mul-same-base",
    apply(egraph, classId, node) {
      // x^a * x^b → x^(a+b)
      if (node.op !== "mul") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const leftPow = egraph.findOp(ch[0], "pow");
      const rightPow = egraph.findOp(ch[1], "pow");
      if (!leftPow || !rightPow) return [];
      const lch = binChildren(leftPow);
      const rch = binChildren(rightPow);
      if (!lch || !rch) return [];
      // Same base?
      if (egraph.find(lch[0]) === egraph.find(rch[0])) {
        const sumExp = egraph.addNode({ op: "add", children: [lch[1], rch[1]] });
        const result = egraph.addNode({ op: "pow", children: [lch[0], sumExp] });
        return [{ id: classId, newId: result }];
      }
      return [];
    },
  },
  {
    name: "pow-pow",
    apply(egraph, classId, node) {
      // (x^a)^b → x^(a*b)
      if (node.op !== "pow") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const innerPow = egraph.findOp(ch[0], "pow");
      if (!innerPow) return [];
      const innerCh = binChildren(innerPow);
      if (!innerCh) return [];
      const prodExp = egraph.addNode({ op: "mul", children: [innerCh[1], ch[1]] });
      const result = egraph.addNode({ op: "pow", children: [innerCh[0], prodExp] });
      return [{ id: classId, newId: result }];
    },
  },
  {
    name: "mul-as-pow2",
    apply(egraph, classId, node) {
      // x * x → x^2
      if (node.op !== "mul") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      if (egraph.find(ch[0]) === egraph.find(ch[1])) {
        const two = egraph.addNode({ op: "lit:2", children: [] });
        const result = egraph.addNode({ op: "pow", children: [ch[0], two] });
        return [{ id: classId, newId: result }];
      }
      return [];
    },
  },
];

/**
 * Negation distribution: -(a+b) → -a + -b, -(a*b) → (-a)*b
 */
const negationDistributionRules: RewriteRule[] = [
  {
    name: "neg-add",
    apply(egraph, classId, node) {
      // -(a + b) → (-a) + (-b)
      if (node.op !== "neg") return [];
      const c = unaryChild(node);
      if (c === null) return [];
      const addNode = egraph.findOp(c, "add");
      if (!addNode) return [];
      const ch = binChildren(addNode);
      if (!ch) return [];
      const negA = egraph.addNode({ op: "neg", children: [ch[0]] });
      const negB = egraph.addNode({ op: "neg", children: [ch[1]] });
      const result = egraph.addNode({ op: "add", children: [negA, negB] });
      return [{ id: classId, newId: result }];
    },
  },
  {
    name: "neg-mul",
    apply(egraph, classId, node) {
      // -(a * b) → (-a) * b
      if (node.op !== "neg") return [];
      const c = unaryChild(node);
      if (c === null) return [];
      const mulNode = egraph.findOp(c, "mul");
      if (!mulNode) return [];
      const ch = binChildren(mulNode);
      if (!ch) return [];
      const negA = egraph.addNode({ op: "neg", children: [ch[0]] });
      const result = egraph.addNode({ op: "mul", children: [negA, ch[1]] });
      return [{ id: classId, newId: result }];
    },
  },
  {
    name: "neg-sub",
    apply(egraph, classId, node) {
      // -(a - b) → b - a
      if (node.op !== "neg") return [];
      const c = unaryChild(node);
      if (c === null) return [];
      const subNode = egraph.findOp(c, "sub");
      if (!subNode) return [];
      const ch = binChildren(subNode);
      if (!ch) return [];
      const result = egraph.addNode({ op: "sub", children: [ch[1], ch[0]] });
      return [{ id: classId, newId: result }];
    },
  },
];

/**
 * Division simplification rules.
 */
const divisionRules: RewriteRule[] = [
  {
    name: "div-zero-numerator",
    apply(egraph, classId, node) {
      // 0 / x → 0
      if (node.op !== "div") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      if (egraph.getLiteral(ch[0]) === 0) {
        const zeroId = egraph.addNode({ op: "lit:0", children: [] });
        return [{ id: classId, newId: zeroId }];
      }
      return [];
    },
  },
  {
    name: "div-to-mul-inv",
    apply(egraph, classId, node) {
      // a / b → a * b^(-1)
      if (node.op !== "div") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const negOne = egraph.addNode({ op: "lit:-1", children: [] });
      const inv = egraph.addNode({ op: "pow", children: [ch[1], negOne] });
      const result = egraph.addNode({ op: "mul", children: [ch[0], inv] });
      return [{ id: classId, newId: result }];
    },
  },
  {
    name: "div-div-to-mul",
    apply(egraph, classId, node) {
      // (a / b) / c → a / (b * c)
      if (node.op !== "div") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const innerDiv = egraph.findOp(ch[0], "div");
      if (!innerDiv) return [];
      const innerCh = binChildren(innerDiv);
      if (!innerCh) return [];
      const bc = egraph.addNode({ op: "mul", children: [innerCh[1], ch[1]] });
      const result = egraph.addNode({ op: "div", children: [innerCh[0], bc] });
      return [{ id: classId, newId: result }];
    },
  },
];

/**
 * Pythagorean identity: sin²(x) + cos²(x) → 1
 * Detects the pattern structurally through e-class membership.
 */
const pythagoreanRules: RewriteRule[] = [
  {
    name: "sin2-cos2",
    apply(egraph, classId, node) {
      // sin(x)^2 + cos(x)^2 → 1
      if (node.op !== "add") return [];
      const ch = binChildren(node);
      if (!ch) return [];

      // Try both orderings: left=sin², right=cos² or left=cos², right=sin²
      const result = matchSinCosPair(egraph, ch[0], ch[1]) ?? matchSinCosPair(egraph, ch[1], ch[0]);
      if (result !== null) {
        const oneId = egraph.addNode({ op: "lit:1", children: [] });
        return [{ id: classId, newId: oneId }];
      }
      return [];
    },
  },
];

/**
 * Check if leftId is sin(x)^2 and rightId is cos(x)^2 for the same x.
 */
function matchSinCosPair(egraph: EGraph, leftId: EClassId, rightId: EClassId): true | null {
  // left must be pow with exponent 2
  const leftPow = egraph.findOp(leftId, "pow");
  if (!leftPow) return null;
  const leftCh = binChildren(leftPow);
  if (!leftCh || egraph.getLiteral(leftCh[1]) !== 2) return null;

  // right must be pow with exponent 2
  const rightPow = egraph.findOp(rightId, "pow");
  if (!rightPow) return null;
  const rightCh = binChildren(rightPow);
  if (!rightCh || egraph.getLiteral(rightCh[1]) !== 2) return null;

  // One base must be sin(x), the other cos(x), with the same x
  const leftSin = egraph.findOp(leftCh[0], "fn:sin");
  const rightCos = egraph.findOp(rightCh[0], "fn:cos");
  if (leftSin && rightCos) {
    const sinArg = unaryChild(leftSin);
    const cosArg = unaryChild(rightCos);
    if (sinArg !== null && cosArg !== null && egraph.find(sinArg) === egraph.find(cosArg)) {
      return true;
    }
  }

  // Also check the reverse: left=cos², right=sin²
  const leftCos = egraph.findOp(leftCh[0], "fn:cos");
  const rightSin = egraph.findOp(rightCh[0], "fn:sin");
  if (leftCos && rightSin) {
    const cosArg = unaryChild(leftCos);
    const sinArg = unaryChild(rightSin);
    if (cosArg !== null && sinArg !== null && egraph.find(cosArg) === egraph.find(sinArg)) {
      return true;
    }
  }

  return null;
}

/**
 * Double angle formulas.
 */
const doubleAngleRules: RewriteRule[] = [
  {
    name: "double-angle-sin",
    apply(egraph, classId, node) {
      // 2 * sin(x) * cos(x) → sin(2*x)
      // We look for mul(A, B) where one side is 2*sin(x) or sin(x)*2 and other is cos(x), or similar.
      // Simplified: look for mul(mul(2, sin(x)), cos(x)) pattern via e-class search.
      if (node.op !== "mul") return [];
      const ch = binChildren(node);
      if (!ch) return [];

      // Check pattern: left is mul with lit:2 and sin, right is cos
      const result = matchDoubleAngleSin(egraph, ch[0], ch[1]);
      if (result !== null) {
        const two = egraph.addNode({ op: "lit:2", children: [] });
        const twoX = egraph.addNode({ op: "mul", children: [two, result] });
        const sin2x = egraph.addNode({ op: "fn:sin", children: [twoX] });
        return [{ id: classId, newId: sin2x }];
      }
      return [];
    },
  },
  {
    name: "cos-double-angle-diff",
    apply(egraph, classId, node) {
      // cos²(x) - sin²(x) → cos(2x)
      if (node.op !== "sub") return [];
      const ch = binChildren(node);
      if (!ch) return [];

      // left = cos(x)^2, right = sin(x)^2
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

/**
 * Match pattern: one e-class is 2*sin(x) (or sin(x)*2) and the other is cos(x),
 * returning the argument x if matched.
 */
function matchDoubleAngleSin(egraph: EGraph, aId: EClassId, bId: EClassId): EClassId | null {
  // Check if aId contains mul(2, sin(x)) and bId contains cos(x)
  const mulNode = egraph.findOp(aId, "mul");
  if (mulNode) {
    const mch = binChildren(mulNode);
    if (mch) {
      // Check for 2 * sin(x)
      const lit = egraph.getLiteral(mch[0]);
      if (lit === 2) {
        const sinNode = egraph.findOp(mch[1], "fn:sin");
        if (sinNode) {
          const sinArg = unaryChild(sinNode);
          if (sinArg !== null) {
            const cosNode = egraph.findOp(bId, "fn:cos");
            if (cosNode) {
              const cosArg = unaryChild(cosNode);
              if (cosArg !== null && egraph.find(sinArg) === egraph.find(cosArg)) {
                return sinArg;
              }
            }
          }
        }
      }
      // Check for sin(x) * 2
      const litR = egraph.getLiteral(mch[1]);
      if (litR === 2) {
        const sinNode = egraph.findOp(mch[0], "fn:sin");
        if (sinNode) {
          const sinArg = unaryChild(sinNode);
          if (sinArg !== null) {
            const cosNode = egraph.findOp(bId, "fn:cos");
            if (cosNode) {
              const cosArg = unaryChild(cosNode);
              if (cosArg !== null && egraph.find(sinArg) === egraph.find(cosArg)) {
                return sinArg;
              }
            }
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
