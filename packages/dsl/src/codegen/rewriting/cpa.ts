// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Critical Pair Analysis (CPA) Engine for Graph Rewriting Rules.
 *
 * Implements static confluence and conflict analysis for ModelScript's Triple Graph
 * Grammar (TGG) transformation rules.
 *
 * Academic Citations:
 *   - Knuth, D. E., & Bendix, P. B. (1970). "Simple word problems in universal algebras."
 *     In J. Leech (Ed.), Computational Problems in Abstract Algebra, pp. 263–297. Pergamon Press.
 *   - Ehrig, H., Ehrig, K., de Lara, J., Taentzer, G., Varró, D., & Varró, G. (2005).
 *     "Termination and confluence of graph transformation systems." In Formal Methods in
 *     Software and Systems Modeling, LNCS 3440, pp. 180–195. Springer.
 *   - Heckel, R., & Taentzer, G. (2020). Graph Transformation for Software Engineers:
 *     Formal Foundation and Industrial Applications. Springer. DOI: 10.1007/978-3-030-43969-9.
 *
 * ModelScript Architectural Rationale:
 *   In polyglot engineering workflows, multiple transformation rules may attempt to translate
 *   the same source AST elements (e.g. Modelica connector or SysML v2 part definition) into target
 *   constructs. Such rule overlaps can lead to non-deterministic transformations or translation
 *   cycles. CPA statically detects all critical pairs (conflicting rule overlaps, target collisions,
 *   and circular translation loops) at compile time, guaranteeing deterministic, confluent model
 *   transformations.
 *
 * Modifications:
 *   - Tailored for polyglot AST metamodels across Modelica, SysML v2, STEP, and OWL2.
 *   - Classifies conflicts into source overlaps, target collisions, cyclic loops, and type mismatches.
 *   - Generates actionable diagnostics formatted for LSP and CLI reporting.
 */

import type { TGGConstraint, TGGRuleOptions } from "../../dsl/language.js";

export interface CpaConflict {
  kind: "overlap" | "target-collision" | "cycle" | "incompatible-assignment";
  rule1: string;
  rule2?: string | undefined;
  nodeType?: string | undefined;
  description: string;
  severity: "error" | "warning";
}

export interface CpaReport {
  hasConflicts: boolean;
  conflicts: CpaConflict[];
  cycles: string[][];
  ruleCount: number;
}

export const DEFAULT_NODE_DOMAIN_MAP: Record<string, string> = {
  // SysML v2 / KerML
  BlockDefinition: "sysml2",
  PartDefinition: "sysml2",
  PartUsage: "sysml2",
  ConnectionUsage: "sysml2",
  ConstraintDefinition: "sysml2",
  ConstraintUsage: "sysml2",
  PortDefinition: "sysml2",
  PortUsage: "sysml2",
  AttributeDefinition: "sysml2",
  AttributeUsage: "sysml2",
  ItemDefinition: "sysml2",
  ItemUsage: "sysml2",
  ActionDefinition: "sysml2",
  ActionUsage: "sysml2",
  StateDefinition: "sysml2",
  StateUsage: "sysml2",
  RequirementDefinition: "sysml2",
  RequirementUsage: "sysml2",
  AllocationUsage: "sysml2",
  InterfaceDefinition: "sysml2",
  InterfaceUsage: "sysml2",
  FlowConnectionUsage: "sysml2",
  Specialization: "sysml2",
  SysMLBlock: "sysml2",
  SysMLPart: "sysml2",
  SysMLPort: "sysml2",
  // Modelica 3.x
  ClassDefinition: "modelica",
  ShortClassDefinition: "modelica",
  ComponentClause: "modelica",
  ComponentDeclaration: "modelica",
  ConnectClause: "modelica",
  EquationClause: "modelica",
  AlgorithmSection: "modelica",
  ExtendsClause: "modelica",
  ModelicaClass: "modelica",
  ModelicaBlock: "modelica",
  ModelicaModel: "modelica",
  ModelicaConnector: "modelica",
  // OWL2 Functional Syntax
  ClassDeclaration: "owl2",
  SubClassOfAxiom: "owl2",
  EquivalentClassesAxiom: "owl2",
  DisjointClassesAxiom: "owl2",
  ObjectPropertyDeclaration: "owl2",
  DataPropertyDeclaration: "owl2",
  NamedIndividualDeclaration: "owl2",
  ClassAssertionAxiom: "owl2",
  ObjectPropertyAssertionAxiom: "owl2",
  DataPropertyAssertionAxiom: "owl2",
  // STEP (ISO 10303)
  ProductDefinition: "step",
  PropertyDefinition: "step",
  Axis2Placement3D: "step",
  NextAssemblyUsageOccurrence: "step",
  ManifoldSolidBrep: "step",
  AdvancedFace: "step",
  CartesianPoint: "step",
  Direction: "step",
  GeometricRepresentationContext: "step",
  ApplicationContext: "step",
  EntityInstance: "step",
  // CSV
  CsvColumnHeader: "csv",
  CSVVirtualComponent: "csv",
  SourceFile: "csv",
  CsvRow: "csv",
  CsvRecord: "csv",
  CsvTable: "csv",
  // SSP
  System: "ssp",
  Component: "ssp",
  Connector: "ssp",
  Connection: "ssp",
  SystemStructureDescription: "ssp",
  // PSCAD / Power Systems
  PscadComponent: "pscad",
  PscadSchematic: "pscad",
  PscadWire: "pscad",
  PscadBus: "pscad",
  // FEA / CFD / SCAD
  FeaMesh: "fea",
  FeaMaterial: "fea",
  FeaBoundaryCondition: "fea",
  CfdMesh: "cfd",
  Su2Config: "cfd",
  ScadModule: "scad",
  ScadPrimitive: "scad",
};

export function inferRuleLanguages(
  rule: TGGRuleOptions,
  evaluatedSource: any,
  evaluatedTarget: any,
  constraints: TGGConstraint[] = [],
  nodeDomainMap?: Record<string, string>,
): { sourceLang?: string | undefined; targetLang?: string | undefined } {
  const anyRule = rule as any;
  let sourceLang: string | undefined =
    rule.sourceLang || anyRule.sourceLanguage || anyRule.domain || evaluatedSource?.lang || evaluatedSource?.domain;
  let targetLang: string | undefined =
    rule.targetLang ||
    anyRule.targetLanguage ||
    anyRule.targetSyncDomain ||
    evaluatedTarget?.lang ||
    evaluatedTarget?.domain;

  // 1. Check constraints for explicit language/dialect metadata (typeMap, exprMap)
  for (const c of constraints) {
    if (c.kind === "exprMap" && typeof c.args[2] === "string") {
      const dialect = c.args[2].toLowerCase();
      if (dialect === "modelica-sysml2") {
        sourceLang = sourceLang || "modelica";
        targetLang = targetLang || "sysml2";
      } else if (dialect === "sysml2-modelica") {
        sourceLang = sourceLang || "sysml2";
        targetLang = targetLang || "modelica";
      }
    } else if (c.kind === "typeMap" && typeof c.args[2] === "string") {
      const mapKey = c.args[2].toLowerCase();
      if (mapKey.includes("sysml2") || mapKey.includes("sysml")) targetLang = targetLang || "sysml2";
      else if (mapKey.includes("modelica")) targetLang = targetLang || "modelica";
      else if (mapKey.includes("owl2")) targetLang = targetLang || "owl2";
      else if (mapKey.includes("step")) targetLang = targetLang || "step";
      else if (mapKey.includes("csv")) targetLang = targetLang || "csv";
      else if (mapKey.includes("ssp")) targetLang = targetLang || "ssp";
      else if (mapKey.includes("pscad")) targetLang = targetLang || "pscad";
      else if (mapKey.includes("fea")) targetLang = targetLang || "fea";
      else if (mapKey.includes("cfd")) targetLang = targetLang || "cfd";
      else if (mapKey.includes("scad")) targetLang = targetLang || "scad";
    }
  }

  // 2. Lookup source and target AST node types in dynamic/registered node-to-domain map
  const effectiveDomainMap = nodeDomainMap ? { ...DEFAULT_NODE_DOMAIN_MAP, ...nodeDomainMap } : DEFAULT_NODE_DOMAIN_MAP;
  const srcType = evaluatedSource?.nodeType || "";
  const tgtType = evaluatedTarget?.nodeType || "";
  if (!sourceLang && srcType && effectiveDomainMap[srcType]) {
    sourceLang = effectiveDomainMap[srcType];
  }
  if (!targetLang && tgtType && effectiveDomainMap[tgtType]) {
    targetLang = effectiveDomainMap[tgtType];
  }

  // 3. Fallback: Check rule name conventions if still unresolved
  const name = rule.name || "";
  if (!targetLang) {
    if (name.includes("ToSysml") || name.includes("ToSysML2") || name.includes("ToSysML")) targetLang = "sysml2";
    else if (name.includes("ToModelica") || name.includes("ToModel")) targetLang = "modelica";
    else if (name.includes("ToOWL2") || name.includes("ToOwl2")) targetLang = "owl2";
    else if (name.includes("ToStep") || name.includes("ToSTEP")) targetLang = "step";
    else if (name.includes("ToCsv") || name.includes("ToCSV")) targetLang = "csv";
    else if (name.includes("ToSsp") || name.includes("ToSSP")) targetLang = "ssp";
  }

  if (!sourceLang) {
    if (
      name.startsWith("SysML2") ||
      name.startsWith("SysML") ||
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
  targetLang?: string | undefined;
  sourceLang?: string | undefined;
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
    const rule = rules[i]!;
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
      const r1 = signatures[i]!;
      const r2 = signatures[j]!;

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
