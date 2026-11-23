// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Structural Causal Model (SCM) & Do-Calculus Engine.
 *
 * Supports:
 *   - Causal DAG topology & d-separation checking (Bayes-Ball algorithm)
 *   - Pearl's `do(X = x)` interventional evaluation via graph mutilation
 *   - Counterfactual reasoning (Abduction -> Action -> Prediction)
 *   - Shapley-value causal root-cause attribution for digital twin & grid anomalies
 */

export interface ScmNode {
  readonly name: string;
  readonly parents: readonly string[];
  /** Structural equation f_i(parentValues, noiseU). */
  readonly equation: (parents: Readonly<Record<string, number>>, u: number) => number;
  readonly defaultNoise?: number | undefined;
}

export interface CounterfactualResult {
  readonly factual: Record<string, number>;
  readonly inferredNoise: Record<string, number>;
  readonly counterfactual: Record<string, number>;
}

export class StructuralCausalModel {
  private readonly nodes = new Map<string, ScmNode>();
  private topoOrder: string[] = [];

  constructor(nodes: readonly ScmNode[]) {
    for (const n of nodes) {
      this.nodes.set(n.name, n);
    }
    this.topoOrder = this.computeTopoOrder();
  }

  private computeTopoOrder(): string[] {
    const inDeg = new Map<string, number>();
    const children = new Map<string, string[]>();
    for (const [name, node] of this.nodes) {
      inDeg.set(name, node.parents.length);
      for (const p of node.parents) {
        let list = children.get(p);
        if (!list) {
          list = [];
          children.set(p, list);
        }
        list.push(name);
      }
    }
    const q: string[] = [];
    for (const [name, deg] of inDeg) {
      if (deg === 0) q.push(name);
    }
    const order: string[] = [];
    for (let i = 0; i < q.length; i++) {
      const u = q[i]!;
      order.push(u);
      for (const v of children.get(u) ?? []) {
        const next = (inDeg.get(v) ?? 1) - 1;
        inDeg.set(v, next);
        if (next === 0) q.push(v);
      }
    }
    if (order.length !== this.nodes.size) {
      throw new Error("StructuralCausalModel requires an acyclic causal DAG.");
    }
    return order;
  }

  /** Evaluates the SCM under optional `do(interventions)` and exogenous noise `noise`. */
  public evaluate(
    interventions: Readonly<Record<string, number>> = {},
    noise: Readonly<Record<string, number>> = {},
  ): Record<string, number> {
    const values: Record<string, number> = {};
    for (const name of this.topoOrder) {
      if (Object.prototype.hasOwnProperty.call(interventions, name)) {
        values[name] = interventions[name]!;
      } else {
        const node = this.nodes.get(name)!;
        const u = noise[name] ?? node.defaultNoise ?? 0;
        values[name] = node.equation(values, u);
      }
    }
    return values;
  }

  /**
   * Counterfactual query: given observed factual values (for additive-noise structural equations),
   * abduces exogenous noise U, applies `do(interventions)`, and predicts counterfactual outcomes.
   */
  public counterfactual(
    factualObservations: Readonly<Record<string, number>>,
    interventions: Readonly<Record<string, number>>,
  ): CounterfactualResult {
    const factual = this.evaluate({}, {});
    const inferredNoise: Record<string, number> = {};

    // Abduction for additive noise: u_i = observed_i - f_i(pa_i, 0)
    for (const name of this.topoOrder) {
      const node = this.nodes.get(name)!;
      const base = node.equation(factualObservations, 0);
      if (Object.prototype.hasOwnProperty.call(factualObservations, name)) {
        const obs = factualObservations[name]!;
        inferredNoise[name] = obs - base;
        factual[name] = obs;
      } else {
        inferredNoise[name] = node.defaultNoise ?? 0;
        factual[name] = node.equation(factual, inferredNoise[name]!);
      }
    }

    const cf = this.evaluate(interventions, inferredNoise);
    return { factual, inferredNoise, counterfactual: cf };
  }

  /**
   * Computes exact Shapley causal attribution of each candidate cause to the deviation
   * of `targetVar` between baseline noise (0) and observed `anomalyNoise`.
   */
  public shapleyAttribution(
    targetVar: string,
    candidateCauses: readonly string[],
    anomalyNoise: Readonly<Record<string, number>>,
  ): Record<string, number> {
    const k = candidateCauses.length;
    const attributions: Record<string, number> = {};
    for (const c of candidateCauses) attributions[c] = 0;
    if (k === 0) return attributions;

    // Exact Shapley for k <= 12
    const totalSubsets = 1 << Math.min(k, 12);
    const fact = (n: number): number => {
      let r = 1;
      for (let i = 2; i <= n; i++) r *= i;
      return r;
    };
    const kFact = fact(k);

    const evalMask = (mask: number): number => {
      const nMap: Record<string, number> = {};
      for (let i = 0; i < k; i++) {
        if ((mask & (1 << i)) !== 0) {
          const c = candidateCauses[i]!;
          nMap[c] = anomalyNoise[c] ?? 0;
        }
      }
      return this.evaluate({}, nMap)[targetVar] ?? 0;
    };

    const cache = new Float64Array(totalSubsets);
    for (let mask = 0; mask < totalSubsets; mask++) {
      cache[mask] = evalMask(mask);
    }

    for (let i = 0; i < Math.min(k, 12); i++) {
      const bit = 1 << i;
      let phi = 0;
      for (let mask = 0; mask < totalSubsets; mask++) {
        if ((mask & bit) !== 0) continue;
        let pop = 0;
        for (let m = mask; m > 0; m &= m - 1) pop++;
        const weight = (fact(pop) * fact(k - pop - 1)) / kFact;
        phi += weight * (cache[mask | bit]! - cache[mask]!);
      }
      attributions[candidateCauses[i]!] = phi;
    }

    return attributions;
  }

  /**
   * Checks d-separation: is `x` d-separated from `y` given conditioning set `z`?
   * Uses the Bayes-Ball reachability algorithm.
   */
  public isDSeparated(x: string, y: string, z: readonly string[]): boolean {
    const zSet = new Set(z);
    const children = new Map<string, string[]>();
    for (const [name, node] of this.nodes) {
      for (const p of node.parents) {
        let list = children.get(p);
        if (!list) {
          list = [];
          children.set(p, list);
        }
        list.push(name);
      }
    }

    // Ancestors of Z
    const zAncestors = new Set<string>(zSet);
    const stack = Array.from(zSet);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const p of this.nodes.get(cur)?.parents ?? []) {
        if (!zAncestors.has(p)) {
          zAncestors.add(p);
          stack.push(p);
        }
      }
    }

    // State: (node, direction: "up" | "down")
    const visited = new Set<string>();
    const queue: Array<{ node: string; dir: "up" | "down" }> = [
      { node: x, dir: "up" },
      { node: x, dir: "down" },
    ];

    while (queue.length > 0) {
      const { node, dir } = queue.shift()!;
      const key = `${node}:${dir}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (node === y) return false;
      const inZ = zSet.has(node);

      if (dir === "up" && !inZ) {
        for (const p of this.nodes.get(node)?.parents ?? []) {
          queue.push({ node: p, dir: "up" });
        }
        for (const c of children.get(node) ?? []) {
          queue.push({ node: c, dir: "down" });
        }
      } else if (dir === "down") {
        if (!inZ) {
          for (const c of children.get(node) ?? []) {
            queue.push({ node: c, dir: "down" });
          }
        }
        if (inZ || zAncestors.has(node)) {
          for (const p of this.nodes.get(node)?.parents ?? []) {
            queue.push({ node: p, dir: "up" });
          }
        }
      }
    }

    return true;
  }
}
