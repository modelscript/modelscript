// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TGGConstraint, TGGRuleOptions } from "../dsl/language.js";

export interface CpaConflict {
  kind: "overlap" | "target-collision" | "cycle" | "incompatible-assignment";
  rule1: string;
  rule2?: string;
  nodeType?: string;
  description: string;
  severity: "error" | "warning";
}

export interface CpaReport {
  hasConflicts: boolean;
  conflicts: CpaConflict[];
  cycles: string[][];
  ruleCount: number;
}

interface RuleSignature {
  index: number;
  name: string;
  sourceNodeType: string;
  targetNodeType: string;
  sourceBindings: Record<string, any>;
  targetBindings: Record<string, any>;
  constraints: TGGConstraint[];
  priority: number;
}

/**
 * Performs ahead-of-time (AOT) Critical Pair Analysis on declarative TGG rules.
 * Identifies rule overlaps, target attribute collisions, non-deterministic ambiguities,
 * and cyclic ping-pong synchronization dependencies.
 */
export function runCPA(rules: TGGRuleOptions[]): CpaReport {
  const conflicts: CpaConflict[] = [];
  const signatures: RuleSignature[] = [];

  const $proxy: any = new Proxy(
    {},
    {
      get:
        (_, prop: string) =>
        (bindings: Record<string, any> = {}) => ({
          nodeType: prop,
          bindings,
        }),
    },
  );

  const vProxy = (name: string) => `__var_${name}`;

  // 1. Extract rule signatures
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const evaluatedSource = typeof rule.source === "function" ? rule.source($proxy, vProxy) : rule.source;
    const evaluatedTarget = typeof rule.target === "function" ? rule.target($proxy, vProxy) : rule.target;
    const constraints = typeof rule.where === "function" ? rule.where(vProxy) : rule.where || [];

    signatures.push({
      index: i,
      name: rule.name || `rule_${i}`,
      sourceNodeType: evaluatedSource?.nodeType || "UnknownNode",
      targetNodeType: evaluatedTarget?.nodeType || "UnknownNode",
      sourceBindings: evaluatedSource?.bindings || {},
      targetBindings: evaluatedTarget?.bindings || {},
      constraints,
      priority: rule.priority ?? 0,
    });
  }

  // 2. Pairwise Critical Pair Analysis
  for (let i = 0; i < signatures.length; i++) {
    for (let j = i + 1; j < signatures.length; j++) {
      const r1 = signatures[i];
      const r2 = signatures[j];

      // Check for source pattern overlap (both match the same source AST type)
      if (r1.sourceNodeType === r2.sourceNodeType && r1.sourceNodeType !== "UnknownNode") {
        const overlappingSourceKeys = Object.keys(r1.sourceBindings).filter((k) => k in r2.sourceBindings);

        // Check for semantic guard / literal disjointness
        let hasDisjointBinding = false;
        for (const k of overlappingSourceKeys) {
          const val1 = r1.sourceBindings[k];
          const val2 = r2.sourceBindings[k];
          // If bindings are literal values (boolean, number, or literal string) and differ
          if (
            val1 !== undefined &&
            val2 !== undefined &&
            val1 !== val2 &&
            !(typeof val1 === "string" && val1.startsWith("__var_")) &&
            !(typeof val2 === "string" && val2.startsWith("__var_"))
          ) {
            hasDisjointBinding = true;
            break;
          }
        }

        // Check for mutually exclusive NACs
        const r1Nacs = r1.constraints.filter((c) => c.kind === "not").map((c) => String(c.args[0]));
        const r2Nacs = r2.constraints.filter((c) => c.kind === "not").map((c) => String(c.args[0]));
        let hasDisjointNac = false;
        for (const nac of r1Nacs) {
          if (r2.sourceNodeType === nac || Object.values(r2.sourceBindings).some((v) => String(v) === nac)) {
            hasDisjointNac = true;
            break;
          }
        }
        for (const nac of r2Nacs) {
          if (r1.sourceNodeType === nac || Object.values(r1.sourceBindings).some((v) => String(v) === nac)) {
            hasDisjointNac = true;
            break;
          }
        }

        // If guards or bindings are disjoint, rules are confluent and do not conflict
        if (hasDisjointBinding || hasDisjointNac) {
          // Confluent via semantic guard
        } else if (r1.priority === r2.priority) {
          // Check if target outputs differ
          if (r1.targetNodeType !== r2.targetNodeType) {
            conflicts.push({
              kind: "overlap",
              rule1: r1.name,
              rule2: r2.name,
              nodeType: r1.sourceNodeType,
              description: `Ambiguous forward transformation: rules '${r1.name}' and '${r2.name}' both match source node '${r1.sourceNodeType}' with equal priority (${r1.priority}) but produce different target types ('${r1.targetNodeType}' vs '${r2.targetNodeType}').`,
              severity: "warning",
            });
          } else if (overlappingSourceKeys.length > 0) {
            // Check if bindings collide on same target type
            conflicts.push({
              kind: "target-collision",
              rule1: r1.name,
              rule2: r2.name,
              nodeType: r1.sourceNodeType,
              description: `Potential forward rule collision: rules '${r1.name}' and '${r2.name}' match '${r1.sourceNodeType}' and produce '${r1.targetNodeType}' with overlapping bindings: [${overlappingSourceKeys.join(", ")}].`,
              severity: "warning",
            });
          }
        }
      }

      // Check for backward overlap (both match the same target AST type)
      if (r1.targetNodeType === r2.targetNodeType && r1.targetNodeType !== "UnknownNode") {
        if (r1.priority === r2.priority && r1.sourceNodeType !== r2.sourceNodeType) {
          conflicts.push({
            kind: "overlap",
            rule1: r1.name,
            rule2: r2.name,
            nodeType: r1.targetNodeType,
            description: `Ambiguous backward transformation: rules '${r1.name}' and '${r2.name}' both match target node '${r1.targetNodeType}' with equal priority (${r1.priority}) but produce different source types ('${r1.sourceNodeType}' vs '${r2.sourceNodeType}').`,
            severity: "warning",
          });
        }
      }
    }
  }

  // 3. Cyclic Dependency Analysis (Rule A target produces Rule B source, and vice versa)
  const adjList = new Map<string, Set<string>>();
  for (const sig of signatures) {
    if (!adjList.has(sig.name)) adjList.set(sig.name, new Set());
    for (const other of signatures) {
      if (sig.name === other.name) continue;
      // If sig's target could be consumed as other's source
      if (sig.targetNodeType === other.sourceNodeType && sig.targetNodeType !== "UnknownNode") {
        adjList.get(sig.name)!.add(other.name);
      }
    }
  }

  // Detect elementary cycles using DFS
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function dfs(curr: string) {
    visited.add(curr);
    recStack.add(curr);
    path.push(curr);

    const neighbors = adjList.get(curr) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (recStack.has(neighbor)) {
        const cycleStartIndex = path.indexOf(neighbor);
        if (cycleStartIndex >= 0) {
          const cycle = path.slice(cycleStartIndex).concat(neighbor);
          cycles.push(cycle);
          conflicts.push({
            kind: "cycle",
            rule1: curr,
            rule2: neighbor,
            description: `Cyclic TGG dependency detected: ${cycle.join(" -> ")}. May cause infinite synchronization loops.`,
            severity: "error",
          });
        }
      }
    }

    path.pop();
    recStack.delete(curr);
  }

  for (const sig of signatures) {
    if (!visited.has(sig.name)) {
      dfs(sig.name);
    }
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
    cycles,
    ruleCount: rules.length,
  };
}
