// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Unified E-Graph (Equality Graph) engine for Equality Saturation-based
 * expression optimization on the Arena DAE representation.
 *
 * Compactly represents equivalent expressions, runs saturation using declarative
 * rewrite rules (scalar, trig, and tensor), and extracts optimized expressions back to the arena.
 */

import { ArenaDAEBuilder, BinOp, ExprKind, UnaryOp } from "../../dae-arena.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type EClassId = number;

/**
 * An E-Node represents a single operation in the E-Graph.
 * It stores an operator tag and its children as EClassIds.
 */
export interface ENode {
  /** Operator tag (e.g. "add", "mul", "sin", "lit:3.14", "var:x", "tmatmul") */
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

function getSequenceElements(
  arena: ArenaDAEBuilder,
  baseExprId: number,
  count: number,
  firstElement: number,
): number[] {
  if (count <= 0) return [];
  const elements = [firstElement];
  for (let i = 1; i < count; i++) {
    const tupleId = baseExprId + i;
    elements.push(arena.getExprLeft(tupleId));
  }
  return elements;
}

const TENSOR_OPS = new Set([
  "tmatmul",
  "ttranspose",
  "tscalar_mul",
  "tadd",
  "tsub",
  "tkron",
  "tzero",
  "tsin",
  "tcos",
  "texp",
  "tlog",
  "tsqrt",
  "tneg",
  "tmul_elem",
]);

function isTensorOp(name: string): boolean {
  return TENSOR_OPS.has(name);
}

function binaryOpToTag(op: BinOp): string {
  switch (op) {
    case BinOp.Add:
    case BinOp.ElemAdd:
      return "add";
    case BinOp.Sub:
    case BinOp.ElemSub:
      return "sub";
    case BinOp.Mul:
    case BinOp.ElemMul:
      return "mul";
    case BinOp.Div:
    case BinOp.ElemDiv:
      return "div";
    case BinOp.Pow:
    case BinOp.ElemPow:
      return "pow";
    case BinOp.And:
      return "and";
    case BinOp.Or:
      return "or";
    case BinOp.Eq:
      return "eq";
    case BinOp.Neq:
      return "neq";
    case BinOp.Lt:
      return "lt";
    case BinOp.Gt:
      return "gt";
    case BinOp.Lte:
      return "lte";
    case BinOp.Gte:
      return "gte";
  }
}

function tagToBinaryOp(tag: string): BinOp | null {
  switch (tag) {
    case "add":
      return BinOp.Add;
    case "sub":
      return BinOp.Sub;
    case "mul":
      return BinOp.Mul;
    case "div":
      return BinOp.Div;
    case "pow":
      return BinOp.Pow;
    case "and":
      return BinOp.And;
    case "or":
      return BinOp.Or;
    case "eq":
      return BinOp.Eq;
    case "neq":
      return BinOp.Neq;
    case "lt":
      return BinOp.Lt;
    case "gt":
      return BinOp.Gt;
    case "lte":
      return BinOp.Lte;
    case "gte":
      return BinOp.Gte;
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// E-Class Analysis
// ─────────────────────────────────────────────────────────────────────

export interface EGraphAnalysis<D> {
  make(egraph: EGraph, node: ENode): D;
  merge(a: D, b: D): { data: D; didChange: boolean };
}

export type Sign = "positive" | "negative" | "zero" | "unknown";

export interface AnalysisData {
  constant: number | null;
  sign: Sign;
}

export const ConstantAnalysis: EGraphAnalysis<number | null> = {
  make(egraph: EGraph, node: ENode): number | null {
    if (node.op.startsWith("lit:")) return parseFloat(node.op.slice(4));
    if (node.children.length === 2) {
      const leftId = node.children[0];
      const rightId = node.children[1];
      if (leftId !== undefined && rightId !== undefined) {
        const l = egraph.getAnalysis(leftId)?.constant ?? null;
        const r = egraph.getAnalysis(rightId)?.constant ?? null;
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
    }
    if (node.children.length === 1 && node.op === "neg") {
      const firstChild = node.children[0];
      if (firstChild !== undefined) {
        const c = egraph.getAnalysis(firstChild)?.constant ?? null;
        return c !== null ? -c : null;
      }
    }
    return null;
  },
  merge(a: number | null, b: number | null): { data: number | null; didChange: boolean } {
    if (a !== null) return { data: a, didChange: b === null };
    if (b !== null) return { data: b, didChange: true };
    return { data: null, didChange: false };
  },
};

export const SignAnalysis: EGraphAnalysis<Sign> = {
  make(egraph: EGraph, node: ENode): Sign {
    if (node.op.startsWith("lit:")) {
      const v = parseFloat(node.op.slice(4));
      if (v > 0) return "positive";
      if (v < 0) return "negative";
      return "zero";
    }
    if (node.children.length === 1 && node.op === "neg") {
      const firstChild = node.children[0];
      if (firstChild !== undefined) {
        const childSign = egraph.getAnalysis(firstChild)?.sign ?? "unknown";
        if (childSign === "positive") return "negative";
        if (childSign === "negative") return "positive";
        if (childSign === "zero") return "zero";
      }
    }
    if (node.children.length === 2 && node.op === "mul") {
      const leftId = node.children[0];
      const rightId = node.children[1];
      if (leftId !== undefined && rightId !== undefined) {
        const ls = egraph.getAnalysis(leftId)?.sign ?? "unknown";
        const rs = egraph.getAnalysis(rightId)?.sign ?? "unknown";
        if (ls === "zero" || rs === "zero") return "zero";
        if (ls === "positive" && rs === "positive") return "positive";
        if (ls === "negative" && rs === "negative") return "positive";
        if ((ls === "positive" && rs === "negative") || (ls === "negative" && rs === "positive")) return "negative";
      }
    }
    if (node.op === "fn:abs") return "positive";
    if (node.op === "fn:exp") return "positive";
    if (node.op === "pow" && node.children.length === 2) {
      const rightId = node.children[1];
      if (rightId !== undefined) {
        const exp = egraph.getAnalysis(rightId)?.constant ?? null;
        if (exp !== null && exp % 2 === 0 && exp > 0) return "positive";
      }
    }
    return "unknown";
  },
  merge(a: Sign, b: Sign): { data: Sign; didChange: boolean } {
    if (a === b) return { data: a, didChange: false };
    if (a !== "unknown" && b === "unknown") return { data: a, didChange: true };
    if (b !== "unknown" && a === "unknown") return { data: b, didChange: true };
    return { data: "unknown", didChange: a !== "unknown" || b !== "unknown" };
  },
};

// ─────────────────────────────────────────────────────────────────────
// E-Graph Engine
// ─────────────────────────────────────────────────────────────────────

export class EGraph {
  private uf = new UnionFind();
  private classes = new Map<EClassId, ENode[]>();
  private hashcons = new Map<string, EClassId>();
  private pending: [EClassId, EClassId][] = [];
  private analysisMap = new Map<EClassId, AnalysisData>();

  private makeEClass(node: ENode): EClassId {
    const key = this.canonicalKey(node);
    const existing = this.hashcons.get(key);
    if (existing !== undefined) {
      return this.uf.find(existing);
    }

    const id = this.uf.makeSet();
    this.classes.set(id, [node]);
    this.hashcons.set(key, id);
    this.analysisMap.set(id, this.computeAnalysis(node));
    return id;
  }

  private canonicalKey(node: ENode): string {
    const childKeys = node.children.map((c) => this.uf.find(c));
    return `${node.op}(${childKeys.join(",")})`;
  }

  find(id: EClassId): EClassId {
    return this.uf.find(id);
  }

  add(arena: ArenaDAEBuilder, exprId: number): EClassId {
    const kind = arena.getExprKind(exprId);
    switch (kind) {
      case ExprKind.RealLiteral: {
        const val = arena.getExprRealValue(exprId);
        return this.makeEClass({ op: `lit:${val}`, children: [] });
      }
      case ExprKind.IntLiteral: {
        const val = arena.getExprData1(exprId);
        return this.makeEClass({ op: `lit:${val}`, children: [] });
      }
      case ExprKind.BoolLiteral: {
        const val = arena.getExprData1(exprId) !== 0;
        return this.makeEClass({ op: `bool:${val}`, children: [] });
      }
      case ExprKind.StringLiteral: {
        const val = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
        return this.makeEClass({ op: `str:${val}`, children: [] });
      }
      case ExprKind.Name: {
        const val = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
        return this.makeEClass({ op: `var:${val}`, children: [] });
      }
      case ExprKind.Negate: {
        const childId = this.add(arena, arena.getExprLeft(exprId));
        return this.makeEClass({ op: "neg", children: [childId] });
      }
      case ExprKind.Unary: {
        const op = arena.getExprData1(exprId) as UnaryOp;
        const operand = arena.getExprLeft(exprId);
        const childId = this.add(arena, operand);
        const opTag = op === UnaryOp.Negate ? "neg" : `unary:${op}`;
        return this.makeEClass({ op: opTag, children: [childId] });
      }
      case ExprKind.Binary: {
        const op = arena.getExprData1(exprId) as BinOp;
        const leftId = this.add(arena, arena.getExprLeft(exprId));
        const rightId = this.add(arena, arena.getExprRight(exprId));
        const opTag = binaryOpToTag(op);
        return this.makeEClass({ op: opTag, children: [leftId, rightId] });
      }
      case ExprKind.Call: {
        const fname = arena.interner.resolve(arena.getExprData1(exprId)) ?? "";
        const argCount = arena.getExprRight(exprId);
        const firstArg = arena.getExprLeft(exprId);
        const args = getSequenceElements(arena, exprId, argCount, firstArg);
        const childIds = args.map((a) => this.add(arena, a));
        if (isTensorOp(fname)) {
          return this.makeEClass({ op: fname, children: childIds });
        }
        return this.makeEClass({ op: `fn:${fname}`, children: childIds });
      }
      case ExprKind.IfElse: {
        const condId = this.add(arena, arena.getExprData1(exprId));
        const thenId = this.add(arena, arena.getExprLeft(exprId));
        const elseId = this.add(arena, arena.getExprRight(exprId));
        return this.makeEClass({ op: "ifelse", children: [condId, thenId, elseId] });
      }
      case ExprKind.Der: {
        const argId = this.add(arena, arena.getExprData1(exprId));
        return this.makeEClass({ op: "der", children: [argId] });
      }
      case ExprKind.Pre: {
        const argId = this.add(arena, arena.getExprData1(exprId));
        return this.makeEClass({ op: "pre", children: [argId] });
      }
      default:
        return this.makeEClass({ op: "opaque", children: [] });
    }
  }

  merge(a: EClassId, b: EClassId): EClassId {
    const rootA = this.uf.find(a);
    const rootB = this.uf.find(b);
    if (rootA === rootB) return rootA;

    const merged = this.uf.union(rootA, rootB);
    const other = merged === rootA ? rootB : rootA;

    const mergedNodes = this.classes.get(merged) ?? [];
    const otherNodes = this.classes.get(other) ?? [];
    mergedNodes.push(...otherNodes);
    this.classes.set(merged, mergedNodes);
    this.classes.delete(other);

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

    this.pending.push([rootA, rootB]);
    return merged;
  }

  rebuild(): void {
    while (this.pending.length > 0) {
      const batchMap = new Map<string, [EClassId, EClassId]>();
      for (const [a, b] of this.pending) {
        const rA = this.uf.find(a);
        const rB = this.uf.find(b);
        if (rA !== rB) {
          batchMap.set(`${Math.min(rA, rB)},${Math.max(rA, rB)}`, [rA, rB]);
        }
      }
      const batch = Array.from(batchMap.values());
      this.pending = [];

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

      const newHashcons = new Map<string, EClassId>();
      for (const [classId, nodes] of this.classes.entries()) {
        const canonicalClass = this.uf.find(classId);
        const iterNodes = nodes.length > 50 ? nodes.slice(0, 50) : nodes;
        for (const node of iterNodes) {
          const canonNode: ENode = { op: node.op, children: node.children.map((c) => this.uf.find(c)) };

          let childHash = "";
          for (let i = 0; i < canonNode.children.length; i++) {
            const childVal = canonNode.children[i];
            if (childVal !== undefined) {
              childHash += childVal + (i < canonNode.children.length - 1 ? "," : "");
            }
          }
          const hash = canonNode.op + "(" + childHash + ")";

          const existing = newHashcons.get(hash);
          if (existing !== undefined) {
            this.merge(canonicalClass, this.uf.find(existing));
          } else {
            newHashcons.set(hash, canonicalClass);
          }
        }
      }
      this.hashcons = newHashcons;
    }
  }

  saturate(rules: RewriteRule[], maxIterations = 30): void {
    for (let iter = 0; iter < maxIterations; iter++) {
      let anyMerged = false;
      const classIds = Array.from(this.classes.keys()).map((id) => this.uf.find(id));
      const uniqueIds = [...new Set(classIds)];

      for (const classId of uniqueIds) {
        const nodes = this.classes.get(this.uf.find(classId));
        if (!nodes) continue;

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

  extract(arena: ArenaDAEBuilder, id: EClassId, costFn: CostFunction = AstSizeCost): number {
    const canonical = this.uf.find(id);
    const memo = new Map<EClassId, { cost: number; exprId: number }>();
    return this.extractRec(arena, canonical, memo, costFn).exprId;
  }

  private extractRec(
    arena: ArenaDAEBuilder,
    id: EClassId,
    memo: Map<EClassId, { cost: number; exprId: number }>,
    costFn: CostFunction,
  ): { cost: number; exprId: number } {
    const canonical = this.uf.find(id);
    const cached = memo.get(canonical);
    if (cached) return cached;

    const sentinel = { cost: Infinity, exprId: -1 };
    memo.set(canonical, sentinel);

    const nodes = this.classes.get(canonical) ?? [];
    let best: { cost: number; exprId: number } = sentinel;

    for (const node of nodes) {
      const childResults = node.children.map((c) => this.extractRec(arena, this.uf.find(c), memo, costFn));
      const childCost = childResults.reduce((sum, r) => sum + r.cost, 0);

      if (childResults.some((r) => r.cost === Infinity)) continue;

      const nodeCost =
        costFn.cost(
          node,
          childResults.map((r) => r.cost),
          this,
        ) + childCost;
      if (nodeCost < best.cost) {
        const exprId = this.nodeToExpr(
          arena,
          node,
          childResults.map((r) => r.exprId),
        );
        if (exprId !== null) {
          best = { cost: nodeCost, exprId };
        }
      }
    }

    memo.set(canonical, best);
    return best;
  }

  private nodeToExpr(arena: ArenaDAEBuilder, node: ENode, children: number[]): number | null {
    if (node.op.startsWith("lit:")) {
      const val = parseFloat(node.op.slice(4));
      if (Number.isInteger(val) && Math.abs(val) < 2 ** 31) {
        return arena.addIntLiteral(val);
      }
      return arena.addRealLiteral(val);
    }
    if (node.op.startsWith("bool:")) {
      return arena.addBoolLiteral(node.op === "bool:true");
    }
    if (node.op.startsWith("str:")) {
      return arena.addStringLiteral(node.op.slice(4));
    }
    if (node.op.startsWith("var:")) {
      return arena.addNameExpr(node.op.slice(4));
    }
    if (node.op === "neg" && children.length === 1) {
      const childExpr = children[0];
      return childExpr !== undefined ? arena.addUnaryExpr(UnaryOp.Negate, childExpr) : null;
    }
    const binOp = tagToBinaryOp(node.op);
    if (binOp !== null && children.length === 2) {
      const leftExpr = children[0];
      const rightExpr = children[1];
      if (leftExpr !== undefined && rightExpr !== undefined) {
        return arena.addBinaryExpr(binOp, leftExpr, rightExpr);
      }
    }
    if (node.op.startsWith("fn:")) {
      const fname = node.op.slice(3);
      return arena.addCallExpr(fname, children);
    }
    if (isTensorOp(node.op)) {
      return arena.addCallExpr(node.op, children);
    }
    if (node.op === "ifelse" && children.length === 3) {
      const condExpr = children[0];
      const thenExpr = children[1];
      const elseExpr = children[2];
      if (condExpr !== undefined && thenExpr !== undefined && elseExpr !== undefined) {
        return arena.addIfElseExpr(condExpr, thenExpr, elseExpr);
      }
    }
    if (node.op === "der" && children.length === 1) {
      const childExpr = children[0];
      return childExpr !== undefined ? arena.addDerExpr(childExpr) : null;
    }
    if (node.op === "pre" && children.length === 1) {
      const childExpr = children[0];
      return childExpr !== undefined ? arena.addPreExpr(childExpr) : null;
    }
    return null;
  }

  addNode(node: ENode): EClassId {
    const canonNode: ENode = {
      op: node.op,
      children: node.children.map((c) => this.uf.find(c)),
    };
    return this.makeEClass(canonNode);
  }

  getNodes(id: EClassId): readonly ENode[] {
    return this.classes.get(this.uf.find(id)) ?? [];
  }

  hasOp(id: EClassId, op: string): boolean {
    const nodes = this.classes.get(this.uf.find(id));
    if (!nodes) return false;
    return nodes.some((n) => n.op === op);
  }

  findOp(id: EClassId, op: string): ENode | null {
    const nodes = this.classes.get(this.uf.find(id));
    if (!nodes) return null;
    return nodes.find((n) => n.op === op) ?? null;
  }

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

  getAnalysis(id: EClassId): AnalysisData | undefined {
    return this.analysisMap.get(this.uf.find(id));
  }

  private computeAnalysis(node: ENode): AnalysisData {
    return {
      constant: ConstantAnalysis.make(this, node),
      sign: SignAnalysis.make(this, node),
    };
  }

  classIds(): IterableIterator<EClassId> {
    return this.classes.keys();
  }

  nodeCount(): number {
    let count = 0;
    for (const nodes of this.classes.values()) count += nodes.length;
    return count;
  }

  classCount(): number {
    return this.classes.size;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Cost Functions
// ─────────────────────────────────────────────────────────────────────

export interface CostFunction {
  cost(node: ENode, childCosts: number[], egraph?: EGraph): number;
}

export const AstSizeCost: CostFunction = {
  cost(node: ENode, childCosts: number[]): number {
    if (node.op.startsWith("lit:") || node.op.startsWith("var:")) return 1;
    if (node.op.startsWith("fn:")) return 2;
    return 1 + childCosts.reduce((a, b) => a + b, 0);
  },
};

export const AstDepthCost: CostFunction = {
  cost(_node: ENode, childCosts: number[]): number {
    return 1 + (childCosts.length > 0 ? Math.max(...childCosts) : 0);
  },
};

export const TrigExpandCost: CostFunction = {
  cost(node: ENode, childCosts: number[], egraph?: EGraph): number {
    if (egraph && (node.op === "fn:sin" || node.op === "fn:cos")) {
      const childId = node.children[0];
      if (childId !== undefined) {
        const childNodes = egraph.getNodes(childId);
        for (const cn of childNodes) {
          if (cn.op === "add" || cn.op === "sub") {
            return 100 + childCosts.reduce((a, b) => a + b, 0);
          }
        }
      }
    }
    const baseCost = node.op.startsWith("lit:") || node.op.startsWith("var:") ? 1 : node.op.startsWith("fn:") ? 2 : 1;
    return baseCost + childCosts.reduce((a, b) => a + b, 0);
  },
};

const TENSOR_OP_COSTS: Record<string, number> = {
  tmatmul: 10,
  ttranspose: 1,
  tscalar_mul: 2,
  tadd: 2,
  tsub: 2,
  tkron: 15,
  tzero: 0,
};

export const TensorFlopCost: CostFunction = {
  cost(node: ENode, childCosts: number[]): number {
    const baseCost = TENSOR_OP_COSTS[node.op] ?? 1;
    return baseCost + childCosts.reduce((a, b) => a + b, 0);
  },
};

// ─────────────────────────────────────────────────────────────────────
// Rewrite Runner with Limits
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
    if (numMatches > 0 && numMerged === 0) {
      this.banCount.set(rule.name, Math.min(totalMatches * this.backoffFactor, 1000));
    }
  }
}

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

export function runEqualitySaturation(
  egraph: EGraph,
  rules: RewriteRule[],
  config: Partial<RunnerConfig> = {},
): RunReport {
  const cfg = {
    ...DEFAULT_RUNNER_CONFIG,
    scheduler: config.scheduler ?? new BackoffScheduler(),
    ...config,
  };
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

    let limitBreached = false;

    for (const classId of classIds) {
      if (limitBreached) break;
      const nodes = egraph.getNodes(classId);
      const nodeSnapshot = [...nodes];

      for (const node of nodeSnapshot) {
        if (limitBreached) break;
        for (const rule of rules) {
          if (!cfg.scheduler.canFireRule(rule, iter)) continue;

          if (Date.now() - start > cfg.maxTimeMs) {
            stopReason = "TimeLimit";
            limitBreached = true;
            break;
          }
          if (egraph.nodeCount() > cfg.maxNodeCount) {
            stopReason = "NodeLimit";
            limitBreached = true;
            break;
          }

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
    if (limitBreached) break;

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
// Pattern Language Adapter
// ─────────────────────────────────────────────────────────────────────

export type PatternNode = { kind: "op"; op: string; children: PatternNode[] } | { kind: "var"; name: string };

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

export type Substitution = Map<string, EClassId>;

export function matchPattern(egraph: EGraph, pattern: PatternNode, node: ENode, eClassId: EClassId): Substitution[] {
  const results: Substitution[] = [];
  if (pattern.kind === "var") {
    const existing = new Map<string, EClassId>();
    existing.set(pattern.name, egraph.find(eClassId));
    results.push(existing);
    return results;
  }

  if (node.op !== pattern.op || node.children.length !== pattern.children.length) return [];
  matchChildren(egraph, pattern.children, node.children, 0, new Map(), results);
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
  if (pat === undefined || childId === undefined) return;
  const childSubsts: Substitution[] = [];
  matchRec(egraph, pat, childId, subst, childSubsts);
  for (const s of childSubsts) {
    matchChildren(egraph, patterns, children, index + 1, s, results);
  }
}

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

export function rewrite(name: string, lhsSexpr: string, rhsSexpr: string): RewriteRule {
  const lhs = parsePattern(lhsSexpr);
  const rhs = parsePattern(rhsSexpr);
  return {
    name,
    apply(egraph, eClassId, node) {
      const substitutions = matchPattern(egraph, lhs, node, eClassId);
      const merges: { id: EClassId; newId: EClassId }[] = [];
      for (const subst of substitutions) {
        const newId = instantiatePattern(egraph, rhs, subst);
        merges.push({ id: eClassId, newId });
      }
      return merges;
    },
  };
}

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
    apply(egraph, eClassId, node) {
      const substitutions = matchPattern(egraph, lhs, node, eClassId);
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
// Built-in Rewrite Rules
// ─────────────────────────────────────────────────────────────────────

function binChildren(node: ENode): [EClassId, EClassId] | null {
  if (node.children.length !== 2) return null;
  const a = node.children[0];
  const b = node.children[1];
  if (a === undefined || b === undefined) return null;
  return [a, b];
}

function unaryChild(node: ENode): EClassId | null {
  if (node.children.length !== 1) return null;
  const c = node.children[0];
  return c !== undefined ? c : null;
}

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

const doubleAngleRules: RewriteRule[] = [
  {
    name: "double-angle-sin",
    apply(egraph, classId, node) {
      if (node.op !== "mul") return [];
      const ch = binChildren(node);
      if (!ch) return [];
      const argId = matchDoubleAngleSin(egraph, ch[0], ch[1]) ?? matchDoubleAngleSin(egraph, ch[1], ch[0]);
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
// Trigonometric Identity Rules (trigsimp.ts)
// ─────────────────────────────────────────────────────────────────────

const halfAngleRules: RewriteRule[] = [
  rewrite("sin2-half", "(pow (fn:sin ?x) 2)", "(div (sub 1 (fn:cos (mul 2 ?x))) 2)"),
  rewrite("cos2-half", "(pow (fn:cos ?x) 2)", "(div (add 1 (fn:cos (mul 2 ?x))) 2)"),
];

const sumToProductRules: RewriteRule[] = [
  rewrite(
    "sin-sum-to-prod",
    "(add (fn:sin ?a) (fn:sin ?b))",
    "(mul 2 (mul (fn:sin (div (add ?a ?b) 2)) (fn:cos (div (sub ?a ?b) 2))))",
  ),
  rewrite(
    "cos-sum-to-prod",
    "(add (fn:cos ?a) (fn:cos ?b))",
    "(mul 2 (mul (fn:cos (div (add ?a ?b) 2)) (fn:cos (div (sub ?a ?b) 2))))",
  ),
];

const productToSumRules: RewriteRule[] = [
  rewrite(
    "sin-cos-prod-to-sum",
    "(mul (fn:sin ?a) (fn:cos ?b))",
    "(div (add (fn:sin (add ?a ?b)) (fn:sin (sub ?a ?b))) 2)",
  ),
  rewrite(
    "cos-cos-prod-to-sum",
    "(mul (fn:cos ?a) (fn:cos ?b))",
    "(div (add (fn:cos (sub ?a ?b)) (fn:cos (add ?a ?b))) 2)",
  ),
  rewrite(
    "sin-sin-prod-to-sum",
    "(mul (fn:sin ?a) (fn:sin ?b))",
    "(div (sub (fn:cos (sub ?a ?b)) (fn:cos (add ?a ?b))) 2)",
  ),
];

const inverseTrigRules: RewriteRule[] = [
  rewrite("sin-asin", "(fn:sin (fn:asin ?x))", "?x"),
  rewrite("cos-acos", "(fn:cos (fn:acos ?x))", "?x"),
  rewrite("tan-atan", "(fn:tan (fn:atan ?x))", "?x"),
];

const trigAdditionRules: RewriteRule[] = [
  rewrite("sin-add", "(fn:sin (add ?a ?b))", "(add (mul (fn:sin ?a) (fn:cos ?b)) (mul (fn:cos ?a) (fn:sin ?b)))"),
  rewrite("cos-add", "(fn:cos (add ?a ?b))", "(sub (mul (fn:cos ?a) (fn:cos ?b)) (mul (fn:sin ?a) (fn:sin ?b)))"),
];

const hyperbolicRules: RewriteRule[] = [
  rewrite("sinh-neg", "(fn:sinh (neg ?x))", "(neg (fn:sinh ?x))"),
  rewrite("cosh-neg", "(fn:cosh (neg ?x))", "(fn:cosh ?x)"),
  rewrite("tanh-neg", "(fn:tanh (neg ?x))", "(neg (fn:tanh ?x))"),
  rewrite("sinh-zero", "(fn:sinh 0)", "0"),
  rewrite("cosh-zero", "(fn:cosh 0)", "1"),
  rewrite("tanh-zero", "(fn:tanh 0)", "0"),
];

export const TRIG_RULES: RewriteRule[] = [
  ...DEFAULT_RULES,
  ...halfAngleRules,
  ...sumToProductRules,
  ...productToSumRules,
  ...inverseTrigRules,
  ...hyperbolicRules,
];

export const TRIG_EXPAND_RULES: RewriteRule[] = [...DEFAULT_RULES, ...trigAdditionRules];

// ─────────────────────────────────────────────────────────────────────
// Tensor Rewrite Rules (egraph-tensor.ts)
// ─────────────────────────────────────────────────────────────────────

const transposeRules: RewriteRule[] = [rewrite("transpose-involution", "(ttranspose (ttranspose ?A))", "?A")];

const matmulTransposeRules: RewriteRule[] = [
  rewrite("matmul-transpose-dist", "(ttranspose (tmatmul ?A ?B))", "(tmatmul (ttranspose ?B) (ttranspose ?A))"),
];

const scalarHoistRules: RewriteRule[] = [
  rewrite("scalar-mul-matmul-hoist-l", "(tmatmul (tscalar_mul ?c ?A) ?B)", "(tscalar_mul ?c (tmatmul ?A ?B))"),
  rewrite("scalar-mul-matmul-hoist-r", "(tmatmul ?A (tscalar_mul ?c ?B))", "(tscalar_mul ?c (tmatmul ?A ?B))"),
];

const matmulAssocRules: RewriteRule[] = [
  rewrite("matmul-assoc-l", "(tmatmul (tmatmul ?A ?B) ?C)", "(tmatmul ?A (tmatmul ?B ?C))"),
  rewrite("matmul-assoc-r", "(tmatmul ?A (tmatmul ?B ?C))", "(tmatmul (tmatmul ?A ?B) ?C)"),
];

const tensorAddRules: RewriteRule[] = [
  rewrite("tadd-comm", "(tadd ?A ?B)", "(tadd ?B ?A)"),
  rewrite("tadd-assoc", "(tadd (tadd ?A ?B) ?C)", "(tadd ?A (tadd ?B ?C))"),
  rewrite("tsub-self", "(tsub ?A ?A)", "tzero"),
];

const scalarAlgebraRules: RewriteRule[] = [
  rewrite("scalar-mul-compose", "(tscalar_mul ?a (tscalar_mul ?b ?A))", "(tscalar_mul (smul ?a ?b) ?A)"),
  rewrite("scalar-mul-one", "(tscalar_mul 1 ?A)", "?A"),
  rewrite("scalar-mul-zero", "(tscalar_mul 0 ?A)", "tzero"),
];

const kroneckerRules: RewriteRule[] = [
  rewrite("kron-transpose", "(ttranspose (tkron ?A ?B))", "(tkron (ttranspose ?A) (ttranspose ?B))"),
];

export const TENSOR_RULES: RewriteRule[] = [
  ...transposeRules,
  ...matmulTransposeRules,
  ...scalarHoistRules,
  ...matmulAssocRules,
  ...tensorAddRules,
  ...scalarAlgebraRules,
  ...kroneckerRules,
];

// ─────────────────────────────────────────────────────────────────────
// XLA-Style Kernel Fusion Pass (egraph-tensor.ts)
// ─────────────────────────────────────────────────────────────────────

export interface FusedKernel {
  name: string;
  ops: string[];
  inputs: EClassId[];
  output: EClassId;
}

const FUSABLE_OPS = new Set([
  "tadd",
  "tsub",
  "tscalar_mul",
  "ttranspose",
  "tsin",
  "tcos",
  "texp",
  "tlog",
  "tsqrt",
  "tneg",
  "tmul_elem",
]);

export function identifyFusableChains(egraph: EGraph): FusedKernel[] {
  const kernels: FusedKernel[] = [];
  const visited = new Set<EClassId>();
  let kernelId = 0;

  for (const classId of egraph.classIds()) {
    const canonical = egraph.find(classId);
    if (visited.has(canonical)) continue;

    const nodes = egraph.getNodes(canonical);
    for (const node of nodes) {
      if (!FUSABLE_OPS.has(node.op)) continue;

      const chain: string[] = [node.op];
      const inputs: EClassId[] = [];
      const chainVisited = new Set<EClassId>([canonical]);

      const stack = [...node.children];
      while (stack.length > 0) {
        const topNode = stack.pop();
        if (topNode === undefined) continue;
        const childId = egraph.find(topNode);
        if (chainVisited.has(childId)) continue;
        chainVisited.add(childId);

        const childNodes = egraph.getNodes(childId);
        let fused = false;
        for (const cn of childNodes) {
          if (FUSABLE_OPS.has(cn.op)) {
            chain.push(cn.op);
            stack.push(...cn.children);
            fused = true;
            break;
          }
        }
        if (!fused) {
          inputs.push(childId);
        }
      }

      if (chain.length >= 2) {
        kernels.push({
          name: `fused_kernel_${kernelId++}`,
          ops: chain,
          inputs,
          output: canonical,
        });
        for (const id of chainVisited) visited.add(id);
      }
    }
  }

  return kernels;
}

export function emitFusedKernelC(kernel: FusedKernel, _size: number): string[] {
  const lines: string[] = [];
  lines.push(`/* ${kernel.name}: fused ${kernel.ops.join(" → ")} */`);
  lines.push(`static void ${kernel.name}(`);

  for (let i = 0; i < kernel.inputs.length; i++) {
    lines.push(`    const double* restrict in${i},`);
  }
  lines.push(`    double* restrict out,`);
  lines.push(`    int n) {`);
  lines.push(`  for (int i = 0; i < n; i++) {`);

  let regIdx = 0;
  const regNames: string[] = [];
  for (let i = 0; i < kernel.ops.length; i++) {
    const op = kernel.ops[i];
    if (op === undefined) continue;
    const reg = `r${regIdx++}`;
    regNames.push(reg);

    switch (op) {
      case "tadd":
        lines.push(`    double ${reg} = ${regNames[i - 2] ?? `in0[i]`} + ${regNames[i - 1] ?? `in1[i]`};`);
        break;
      case "tsub":
        lines.push(`    double ${reg} = ${regNames[i - 2] ?? `in0[i]`} - ${regNames[i - 1] ?? `in1[i]`};`);
        break;
      case "tscalar_mul":
        lines.push(
          `    double ${reg} = ${regNames[i - 1] ?? `in0[i]`} * in${Math.min(i, kernel.inputs.length - 1)}[0];`,
        );
        break;
      case "tneg":
        lines.push(`    double ${reg} = -${regNames[i - 1] ?? `in0[i]`};`);
        break;
      case "tsin":
        lines.push(`    double ${reg} = sin(${regNames[i - 1] ?? `in0[i]`});`);
        break;
      case "tcos":
        lines.push(`    double ${reg} = cos(${regNames[i - 1] ?? `in0[i]`});`);
        break;
      case "texp":
        lines.push(`    double ${reg} = exp(${regNames[i - 1] ?? `in0[i]`});`);
        break;
      case "tlog":
        lines.push(`    double ${reg} = log(${regNames[i - 1] ?? `in0[i]`});`);
        break;
      case "tsqrt":
        lines.push(`    double ${reg} = sqrt(${regNames[i - 1] ?? `in0[i]`});`);
        break;
      default:
        lines.push(`    double ${reg} = in0[i]; /* fallback: ${op} */`);
    }
  }

  const lastReg = regNames[regNames.length - 1] ?? "0.0";
  lines.push(`    out[i] = ${lastReg};`);
  lines.push(`  }`);
  lines.push(`}`);

  return lines;
}

// ─────────────────────────────────────────────────────────────────────
// High-level API (egraph.ts, egraph-tensor.ts, trigsimp.ts)
// ─────────────────────────────────────────────────────────────────────

/**
 * Simplify a Modelica expression in the Arena using Equality Saturation.
 */
export function egraphSimplify(arena: ArenaDAEBuilder, exprId: number, maxIterations = 2): number {
  const egraph = new EGraph();
  const rootId = egraph.add(arena, exprId);
  runEqualitySaturation(egraph, DEFAULT_RULES, { maxIterations, maxNodeCount: 10_000 });
  return egraph.extract(arena, rootId, AstSizeCost);
}

/**
 * Simplify a Modelica expression in the Arena using trigonometric identities.
 */
export function trigSimplify(arena: ArenaDAEBuilder, exprId: number, maxIterations = 30): number {
  const egraph = new EGraph();
  const rootId = egraph.add(arena, exprId);
  runEqualitySaturation(egraph, TRIG_RULES, {
    maxIterations,
    scheduler: new BackoffScheduler(),
  });
  return egraph.extract(arena, rootId, AstSizeCost);
}

/**
 * Expand a trigonometric expression in the Arena using addition formulas.
 */
export function trigExpand(arena: ArenaDAEBuilder, exprId: number, maxIterations = 20): number {
  const egraph = new EGraph();
  const rootId = egraph.add(arena, exprId);
  runEqualitySaturation(egraph, TRIG_EXPAND_RULES, {
    maxIterations,
    scheduler: new BackoffScheduler(),
  });
  return egraph.extract(arena, rootId, TrigExpandCost);
}

/**
 * Simplify a tensor expression in the Arena using tensor rewrite rules.
 */
export function tensorEgraphSimplify(arena: ArenaDAEBuilder, exprId: number, maxIterations = 20): number {
  const egraph = new EGraph();
  const rootId = egraph.add(arena, exprId);
  runEqualitySaturation(egraph, TENSOR_RULES, { maxIterations, maxNodeCount: 10_000 });
  return egraph.extract(arena, rootId, TensorFlopCost);
}
