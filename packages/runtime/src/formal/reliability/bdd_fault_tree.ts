// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Reduced Ordered BDD (ROBDD) Fault Tree Reliability Engine.
 *
 * Compiles Boolean Fault Trees (AND, OR, K-of-N, NOT, Basic Events — including shared/repeated
 * events across subtrees) into a canonical ROBDD to compute:
 *   1. Exact Top-Event Failure Probability (O(|BDD|), immune to shared-event double counting)
 *   2. Exact Minimal Cut Sets (MCS)
 *   3. Birnbaum & Fussell-Vesely Importance Measures
 */

export type FaultTreeNode =
  | { readonly kind: "event"; readonly id: string; readonly failureProb: number }
  | { readonly kind: "and"; readonly children: readonly FaultTreeNode[] }
  | { readonly kind: "or"; readonly children: readonly FaultTreeNode[] }
  | { readonly kind: "kofn"; readonly k: number; readonly children: readonly FaultTreeNode[] }
  | { readonly kind: "not"; readonly child: FaultTreeNode };

export interface EventImportance {
  readonly eventId: string;
  readonly failureProb: number;
  readonly birnbaum: number;
  readonly fussellVesely: number;
}

export interface FaultTreeAnalysisResult {
  readonly topEventProbability: number;
  readonly minimalCutSets: string[][];
  readonly bddNodeCount: number;
  readonly importance: EventImportance[];
}

interface BddNode {
  readonly varIdx: number;
  readonly low: number;
  readonly high: number;
}

const BDD_FALSE = 0;
const BDD_TRUE = 1;

export class BddFaultTreeEngine {
  private nodes: BddNode[] = [
    { varIdx: -1, low: 0, high: 0 }, // 0 = FALSE
    { varIdx: -1, low: 1, high: 1 }, // 1 = TRUE
  ];
  private uniqueTable = new Map<string, number>();
  private applyCache = new Map<string, number>();
  private varOrder: string[] = [];
  private varIndex = new Map<string, number>();
  private eventProbs = new Map<string, number>();

  private mk(varIdx: number, low: number, high: number): number {
    if (low === high) return low;
    const key = `${varIdx}:${low}:${high}`;
    const existing = this.uniqueTable.get(key);
    if (existing !== undefined) return existing;
    const id = this.nodes.length;
    this.nodes.push({ varIdx, low, high });
    this.uniqueTable.set(key, id);
    return id;
  }

  private apply(op: "and" | "or", u: number, v: number): number {
    if (op === "and") {
      if (u === BDD_FALSE || v === BDD_FALSE) return BDD_FALSE;
      if (u === BDD_TRUE) return v;
      if (v === BDD_TRUE) return u;
    } else {
      if (u === BDD_TRUE || v === BDD_TRUE) return BDD_TRUE;
      if (u === BDD_FALSE) return v;
      if (v === BDD_FALSE) return u;
    }
    const key = `${op}:${u}:${v}`;
    const cached = this.applyCache.get(key);
    if (cached !== undefined) return cached;

    const nu = this.nodes[u]!;
    const nv = this.nodes[v]!;
    let res: number;
    if (nu.varIdx === nv.varIdx) {
      res = this.mk(nu.varIdx, this.apply(op, nu.low, nv.low), this.apply(op, nu.high, nv.high));
    } else if (nu.varIdx < nv.varIdx) {
      res = this.mk(nu.varIdx, this.apply(op, nu.low, v), this.apply(op, nu.high, v));
    } else {
      res = this.mk(nv.varIdx, this.apply(op, u, nv.low), this.apply(op, u, nv.high));
    }
    this.applyCache.set(key, res);
    return res;
  }

  private negate(u: number): number {
    if (u === BDD_FALSE) return BDD_TRUE;
    if (u === BDD_TRUE) return BDD_FALSE;
    const key = `not:${u}`;
    const cached = this.applyCache.get(key);
    if (cached !== undefined) return cached;
    const n = this.nodes[u]!;
    const res = this.mk(n.varIdx, this.negate(n.low), this.negate(n.high));
    this.applyCache.set(key, res);
    return res;
  }

  private collectEvents(node: FaultTreeNode): void {
    if (node.kind === "event") {
      if (!this.varIndex.has(node.id)) {
        this.varIndex.set(node.id, this.varOrder.length);
        this.varOrder.push(node.id);
      }
      this.eventProbs.set(node.id, node.failureProb);
      return;
    }
    if (node.kind === "not") {
      this.collectEvents(node.child);
      return;
    }
    for (const c of node.children) this.collectEvents(c);
  }

  private compile(node: FaultTreeNode): number {
    switch (node.kind) {
      case "event":
        return this.mk(this.varIndex.get(node.id)!, BDD_FALSE, BDD_TRUE);
      case "not":
        return this.negate(this.compile(node.child));
      case "and": {
        let acc = BDD_TRUE;
        for (const c of node.children) acc = this.apply("and", acc, this.compile(c));
        return acc;
      }
      case "or": {
        let acc = BDD_FALSE;
        for (const c of node.children) acc = this.apply("or", acc, this.compile(c));
        return acc;
      }
      case "kofn": {
        const compiled = node.children.map((c) => this.compile(c));
        const k = node.k;
        // DP over children: dp[j] = at least j children true
        const dp = new Int32Array(k + 1).fill(BDD_FALSE);
        dp[0] = BDD_TRUE;
        for (const cBdd of compiled) {
          for (let j = k; j >= 1; j--) {
            dp[j] = this.apply("or", dp[j]!, this.apply("and", dp[j - 1]!, cBdd));
          }
        }
        return dp[k]!;
      }
    }
  }

  private evalProbability(root: number, overrides?: ReadonlyMap<string, number>): number {
    const memo = new Map<number, number>([
      [BDD_FALSE, 0.0],
      [BDD_TRUE, 1.0],
    ]);
    const rec = (u: number): number => {
      const hit = memo.get(u);
      if (hit !== undefined) return hit;
      const n = this.nodes[u]!;
      const name = this.varOrder[n.varIdx]!;
      const p = overrides?.get(name) ?? this.eventProbs.get(name) ?? 0.0;
      const val = p * rec(n.high) + (1.0 - p) * rec(n.low);
      memo.set(u, val);
      return val;
    };
    return rec(root);
  }

  private extractMinimalCutSets(root: number): string[][] {
    const raw: string[][] = [];
    const path: string[] = [];
    const dfs = (u: number): void => {
      if (u === BDD_FALSE) return;
      if (u === BDD_TRUE) {
        raw.push([...path]);
        return;
      }
      const n = this.nodes[u]!;
      // Low branch (event did NOT occur)
      dfs(n.low);
      // High branch (event occurred)
      path.push(this.varOrder[n.varIdx]!);
      dfs(n.high);
      path.pop();
    };
    dfs(root);

    // Subsumption filter to retain only minimal cut sets
    raw.sort((a, b) => a.length - b.length);
    const minimal: string[][] = [];
    const minimalSets: Set<string>[] = [];
    for (const cs of raw) {
      const s = new Set(cs);
      let subsumed = false;
      for (const m of minimalSets) {
        if (m.size <= s.size) {
          let allIn = true;
          for (const elem of m) {
            if (!s.has(elem)) {
              allIn = false;
              break;
            }
          }
          if (allIn) {
            subsumed = true;
            break;
          }
        }
      }
      if (!subsumed) {
        minimal.push(cs);
        minimalSets.push(s);
      }
    }
    return minimal;
  }

  /** Compiles and analyzes the fault tree, returning exact top-event probability, MCS, and importance. */
  public analyze(tree: FaultTreeNode): FaultTreeAnalysisResult {
    this.collectEvents(tree);
    const root = this.compile(tree);
    const topProb = this.evalProbability(root);
    const minimalCutSets = this.extractMinimalCutSets(root);

    const importance: EventImportance[] = [];
    for (const eventId of this.varOrder) {
      const p = this.eventProbs.get(eventId) ?? 0.0;
      const pOne = this.evalProbability(root, new Map([[eventId, 1.0]]));
      const pZero = this.evalProbability(root, new Map([[eventId, 0.0]]));
      const birnbaum = pOne - pZero;
      const fussellVesely = topProb > 1e-15 ? (topProb - pZero) / topProb : 0.0;
      importance.push({ eventId, failureProb: p, birnbaum, fussellVesely });
    }

    return {
      topEventProbability: topProb,
      minimalCutSets,
      bddNodeCount: this.nodes.length,
      importance,
    };
  }
}
