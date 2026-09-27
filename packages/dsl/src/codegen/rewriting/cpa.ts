// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TGGConstraint, TGGRuleOptions } from "../../dsl/language.js";

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

export function inferRuleLanguages(
  rule: TGGRuleOptions,
  evaluatedSource: any,
  evaluatedTarget: any,
  constraints: TGGConstraint[] = [],
): { sourceLang?: string; targetLang?: string } {
  let sourceLang = rule.sourceLang;
  let targetLang = rule.targetLang;

  // 1. Check constraints for typeMap
  for (const c of constraints) {
    if (c.kind === "typeMap" && typeof c.args[2] === "string") {
      const mapKey = c.args[2].toLowerCase();
      if (mapKey.includes("sysml2") || mapKey.includes("sysml")) targetLang = targetLang || "sysml2";
      else if (mapKey.includes("modelica")) targetLang = targetLang || "modelica";
      else if (mapKey.includes("owl2")) targetLang = targetLang || "owl2";
      else if (mapKey.includes("step")) targetLang = targetLang || "step";
      else if (mapKey.includes("csv")) targetLang = targetLang || "csv";
      else if (mapKey.includes("ssp")) targetLang = targetLang || "ssp";
    }
  }

  // 2. Check rule name
  const name = rule.name || "";
  if (!targetLang) {
    if (name.includes("ToSysml") || name.includes("ToSysML2")) targetLang = "sysml2";
    else if (name.includes("ToModelica") || name.includes("ToModel")) targetLang = "modelica";
    else if (name.includes("ToOWL2") || name.includes("ToOwl2")) targetLang = "owl2";
    else if (name.includes("ToStep") || name.includes("ToSTEP")) targetLang = "step";
    else if (name.includes("ToCsv") || name.includes("ToCSV")) targetLang = "csv";
    else if (name.includes("ToSsp") || name.includes("ToSSP")) targetLang = "ssp";
  }

  if (!sourceLang) {
    if (
      name.startsWith("SysML2") ||
      name.startsWith("Sysml") ||
      name.startsWith("PartDef") ||
      name.startsWith("AttributeUsage") ||
      name.startsWith("PortUsage")
    )
      sourceLang = "sysml2";
    else if (name.startsWith("Modelica")) sourceLang = "modelica";
    else if (name.startsWith("Csv") || name.startsWith("CSV")) sourceLang = "csv";
    else if (name.startsWith("Step") || name.startsWith("STEP")) sourceLang = "step";
    else if (name.startsWith("OWL2") || name.startsWith("Owl2")) sourceLang = "owl2";
    else if (name.startsWith("Ssp") || name.startsWith("SSP")) sourceLang = "ssp";
  }

  // 3. Check target node types
  const tgtType = evaluatedTarget?.nodeType || "";
  if (!targetLang) {
    if (
      [
        "BlockDefinition",
        "PartUsage",
        "ConnectionUsage",
        "ConstraintUsage",
        "PortUsage",
        "AttributeUsage",
        "Specialization",
      ].includes(tgtType)
    ) {
      targetLang = "sysml2";
    } else if (
      [
        "ClassDefinition",
        "ComponentClause",
        "ConnectClause",
        "EquationClause",
        "ModelicaClass",
        "ModelicaBlock",
      ].includes(tgtType)
    ) {
      targetLang = "modelica";
    } else if (
      [
        "ClassDeclaration",
        "SubClassOfAxiom",
        "ObjectPropertyDeclaration",
        "DataPropertyDeclaration",
        "NamedIndividualDeclaration",
      ].includes(tgtType)
    ) {
      targetLang = "owl2";
    } else if (["ProductDefinition", "PropertyDefinition", "Axis2Placement3D"].includes(tgtType)) {
      targetLang = "step";
    } else if (["CsvColumnHeader", "CSVVirtualComponent", "SourceFile"].includes(tgtType)) {
      targetLang = "csv";
    } else if (["System", "Component", "Connector", "Connection"].includes(tgtType)) {
      targetLang = "ssp";
    }
  }

  return { sourceLang, targetLang };
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
  targetLang?: string;
  sourceLang?: string;
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
    const { sourceLang, targetLang } = inferRuleLanguages(rule, evaluatedSource, evaluatedTarget, constraints);

    signatures.push({
      index: i,
      name: rule.name || `rule_${i}`,
      sourceNodeType: evaluatedSource?.nodeType || "UnknownNode",
      targetNodeType: evaluatedTarget?.nodeType || "UnknownNode",
      sourceBindings: evaluatedSource?.bindings || {},
      targetBindings: evaluatedTarget?.bindings || {},
      constraints,
      priority: rule.priority ?? 0,
      sourceLang,
      targetLang,
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

        // Check if rules target different languages: if so, they do not overlap in forward execution
        const isDifferentTargetLang = Boolean(r1.targetLang && r2.targetLang && r1.targetLang !== r2.targetLang);

        // If guards or bindings are disjoint or target different languages, rules do not conflict
        if (hasDisjointBinding || hasDisjointNac || isDifferentTargetLang) {
          // Confluent via semantic guard or distinct target languages
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
        const overlappingTargetKeys = Object.keys(r1.targetBindings).filter((k) => k in r2.targetBindings);
        let hasDisjointTargetBinding = false;
        for (const k of overlappingTargetKeys) {
          const val1 = r1.targetBindings[k];
          const val2 = r2.targetBindings[k];
          if (
            val1 !== undefined &&
            val2 !== undefined &&
            val1 !== val2 &&
            !(typeof val1 === "string" && val1.startsWith("__var_")) &&
            !(typeof val2 === "string" && val2.startsWith("__var_"))
          ) {
            hasDisjointTargetBinding = true;
            break;
          }
        }

        const isDifferentSourceLang = Boolean(r1.sourceLang && r2.sourceLang && r1.sourceLang !== r2.sourceLang);

        if (
          !hasDisjointTargetBinding &&
          !isDifferentSourceLang &&
          r1.priority === r2.priority &&
          r1.sourceNodeType !== r2.sourceNodeType
        ) {
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
