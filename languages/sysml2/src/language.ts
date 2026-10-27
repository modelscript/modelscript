// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * examples/sysml2/language.ts — SysML v2 language definition
 *
 * Port of the SysML2 Xtext grammar into metascript combinators.
 * Inherits KerML expression rules inline (flattened AST).
 *
 * @license AGPL-3.0-or-later
 */

import { analyzeInterproceduralCfa } from "./activity-cfa.js";
import { checkActivitySoundnessForSymbol } from "./activity-soundness.js";
import { extractActivityInvariants, SysML2ActivityVerifier } from "./activity-verifier.js";
import { DecisionTableVerifier } from "./decision-table-verifier.js";
import {
  areDimensionsEqual,
  getDimensionLabel,
  inferExpressionDimension,
  isDimensionless,
  resolveTypeDimension,
} from "./dimensions.js";
import { SysML2ErrorCode } from "./errors.js";
import type { SysmlCstNode } from "./flattener/cst-lowerer.js";
import { LoopInvariantAnalyzer } from "./loop-invariant-analyzer.js";
import { emitAxioms } from "./reasoner-bridge.js";
import {
  checkConnectionTypeCompatibility,
  checkFeatureAssignmentType,
  checkImportResolution,
  checkSymbolResolution,
} from "./type-checker.js";
import { sysml2Writeback } from "./writeback.js";

import {
  choice,
  def,
  domain,
  error,
  field,
  info,
  language,
  optional,
  prec,
  ref,
  repeat,
  repeat1,
  seq,
  tggComplement,
  tggDefaultVal,
  tggDer,
  tggEq,
  tggExprMap,
  tggForEach,
  tggFormatUri,
  tggPhysicalPort,
  tggRule,
  tggTypeMap,
  token,
  warning,
  type LintResult,
} from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";

// ---------------------------------------------------------------------------
// Precedence constants
// ---------------------------------------------------------------------------

const PREC = {
  CONDITIONAL: 1,
  NULL_COALESCING: 2,
  IMPLIES: 3,
  OR: 4,
  XOR: 5,
  AND: 6,
  EQUALITY: 7,
  CLASSIFICATION: 8,
  RELATIONAL: 9,
  RANGE: 10,
  ADDITIVE: 11,
  MULTIPLICATIVE: 12,
  EXPONENTIATION: 13,
  UNARY: 14,
  EXTENT: 15,
  PRIMARY: 16,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---- shared attribute extractors ----
const meta = (self: SymbolEntry) => self.metadata as Record<string, unknown> | null;
const metaStr = (self: SymbolEntry, key: string): string | null => (meta(self)?.[key] as string) ?? null;

// ---- shared symbol helpers ----

interface SysmlRuleSelf {
  declaredName?: string | undefined;
  isAbstract?: boolean | string | undefined;
  isVariation?: boolean | string | undefined;
  declaredShortName?: string | undefined;
  direction?: string | undefined;
  isDerived?: boolean | string | undefined;
  isEnd?: boolean | string | undefined;
  isRef?: boolean | string | undefined;
  isOrdered?: boolean | string | undefined;
  isNonunique?: boolean | string | undefined;
  isConstant?: boolean | string | undefined;
  isStandard?: boolean | string | undefined;
  importedNamespace?: string | undefined;
  isImportAll?: boolean | string | undefined;
  isRecursive?: boolean | string | undefined;
  guard?: unknown;
  isParallel?: boolean | string | undefined;
  trigger?: unknown;
  effect?: unknown;
  ownedMultiplicity?:
    | {
        ownedRelatedElement?:
          | {
              lowerBound?: unknown;
              upperBound?: unknown;
            }
          | undefined;
      }
    | undefined;
  [key: string]: unknown;
}

/** Shared symbol lambda for all Definition rules.
 *  Captures modifier fields as attributes from CST nodes. */
const defAttrs = (_defKind: string) => (self: SysmlRuleSelf) => ({
  kind: "Definition" as const,
  name: self.declaredName,
  exports: ["body"],
  attributes: {
    isAbstract: self.isAbstract,
    isVariation: self.isVariation,
    shortName: self.declaredShortName,
  },
});

/** Shared symbol lambda for all Usage rules.
 *  Captures all modifier fields from _usage_modifier as CST attributes. */
const usageAttrs = (_usageKind: string) => (self: SysmlRuleSelf) => ({
  kind: "Usage" as const,
  name: self.declaredName,
  attributes: {
    direction: self.direction,
    isAbstract: self.isAbstract,
    isVariation: self.isVariation,
    isDerived: self.isDerived,
    isEnd: self.isEnd,
    isRef: self.isRef,
    isOrdered: self.isOrdered,
    isNonunique: self.isNonunique,
    isConstant: self.isConstant,
    shortName: self.declaredShortName,
    multiplicityLower: self.ownedMultiplicity?.ownedRelatedElement?.lowerBound,
    multiplicityUpper: self.ownedMultiplicity?.ownedRelatedElement?.upperBound,
  },
});

// ---- shared queries ----

/** Shared queries for all Definition and Package rules */
const namespaceQueries = {
  members: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id),
  ownedDefinitions: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.kind === "Definition" || c.kind === "Enumeration"),
  ownedUsages: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Usage"),
  imports: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Import"),
};

/** Structural queries for definitions — filter children by usageKind metadata */
const definitionStructuralQueries = {
  ...namespaceQueries,
  inferredSuperClasses: (db: QueryDB, self: SymbolEntry) => packageTraceabilityQueries.inferredSuperClasses(db, self),
  ownedParts: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.ruleName === "PartUsage"),
  ownedAttributes: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "AttributeUsage"),
  ownedPorts: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.ruleName === "PortUsage"),
  ownedActions: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.ruleName === "ActionUsage"),
  ownedConstraints: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "ConstraintUsage"),
  ownedConnections: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "ConnectionUsage"),
  superclassifiers: (db: QueryDB, self: SymbolEntry) => {
    // Find child OwnedSubclassification ref entries and resolve them
    const results: SymbolEntry[] = [];
    for (const child of db.childrenOf(self.id)) {
      if (child.ruleName === "OwnedSubclassification" && child.name) {
        const targets = db.byName(child.name);
        for (const t of targets) if (t.kind === "Definition") results.push(t);
      }
    }
    return results;
  },
  extractTopology: (db: QueryDB, self: SymbolEntry) => {
    // Basic extraction to stub out Phase 3 logic
    const rootIds = [self.id];
    const nodes = new Map<number, import("@modelscript/diagram").TopologyNode>();
    const edges: import("@modelscript/diagram").TopologyEdge[] = [];

    const walk = (entryId: number, parentId: number | null, pathPrefix: string) => {
      const entry = db.symbol(entryId);
      if (!entry) return;

      const path = pathPrefix ? `${pathPrefix}.${entry.name}` : entry.name || "";
      const node: import("@modelscript/diagram").TopologyNode = {
        usageId: entry.id,
        path,
        targetClassId: null,
        typeName: "",
        children: [],
        parentId,
      };
      nodes.set(entry.id, node);

      // Check allocation
      const allocations = db.childrenOf(entry.id).filter((c) => c.ruleName === "AllocationUsage");
      for (const alloc of allocations) {
        const target = db.query<SymbolEntry | null>("resolvedTarget", alloc.id);
        if (target) {
          node.targetClassId = target.id;
        }
      }

      // Check implements in SysML itself (or modelica index)
      let implementsTarget = entry.metadata?.["implementsTarget"] as string | undefined;
      const ann = entry.metadata?.["annotationClause"] as string | undefined;
      if (!implementsTarget && ann) {
        const match = ann.match(/SysML\s*\(\s*implements\s*=\s*"([^"]+)"\s*\)/);
        if (match) implementsTarget = match[1];
      }

      if (implementsTarget) {
        const res = db.byName(implementsTarget);
        if (res && res.length > 0) node.targetClassId = res[0]!.id;
      }

      const parts = db
        .childrenOf(entry.id)
        .filter(
          (c) =>
            c.ruleName === "PartUsage" || c.ruleName === "SubjectUsage" || c.ruleName === "ObjectiveRequirementUsage",
        );
      for (const part of parts) {
        if (part.ruleName === "ObjectiveRequirementUsage" && !node.targetClassId) {
          // Find subject inside objective
          const subjects = db.childrenOf(part.id).filter((c) => c.ruleName === "SubjectUsage");
          for (const subj of subjects) {
            const typeNode = usageQueries.resolvedType(db, subj);
            if (typeNode) node.targetClassId = typeNode.id;
          }
        }

        const childNode = walk(part.id, entry.id, path);
        if (childNode) node.children.push(childNode);

        // If this part is a SubjectUsage and its type maps to a Class or Definition, optionally adopt its targetClassId
        // to bootstrap the root definition (useful if the subject IS the model to simulate)
        if (part.ruleName === "SubjectUsage" && !node.targetClassId) {
          const typeNode = usageQueries.resolvedType(db, part);
          if (typeNode) node.targetClassId = typeNode.id;
        }
      }

      const connects = db.childrenOf(entry.id).filter((c) => c.ruleName === "ConnectionUsage");
      for (const conn of connects) {
        // extract endpoints
        const refs = db.childrenOf(conn.id).filter((c) => c.kind === "Reference");
        if (refs.length >= 2 && refs[0]!.name && refs[1]!.name) {
          const src = resolveFeatureInScope(db, conn.parentId, refs[0]!.name);
          const tgt = resolveFeatureInScope(db, conn.parentId, refs[1]!.name);
          if (src && tgt) {
            edges.push({
              sourceId: src.id,
              targetId: tgt.id,
              connectionId: conn.id,
            });
          }
        }
      }

      return node;
    };

    walk(self.id, null, "");

    // Build explicit sysmlPath → simVarName mapping.
    // The root node's path segment is stripped because Modelica (and most simulators)
    // flatten under the top-level model without repeating its name.
    const variableMap = new Map<string, string>();
    const rootPath = self.name || "";
    const rootPrefix = rootPath ? rootPath + "." : "";

    const buildVarMap = (node: import("@modelscript/diagram").TopologyNode) => {
      if (node.path && node.path !== rootPath) {
        // Strip root prefix: "circuit.C.v" → "C.v"
        const simPath = node.path.startsWith(rootPrefix) ? node.path.substring(rootPrefix.length) : node.path;
        variableMap.set(node.path, simPath);
      }

      // Also map attribute children of each part (e.g., part.voltage → part.v)
      const usageEntry = db.symbol(node.usageId);
      if (usageEntry) {
        for (const attr of db.childrenOf(usageEntry.id)) {
          if (attr.ruleName === "AttributeUsage" && attr.name) {
            const sysmlAttrPath = node.path ? `${node.path}.${attr.name}` : attr.name;
            const simAttrPath =
              node.path && node.path.startsWith(rootPrefix)
                ? `${node.path.substring(rootPrefix.length)}.${attr.name}`
                : sysmlAttrPath;
            variableMap.set(sysmlAttrPath, simAttrPath);
          }
        }
      }

      for (const child of node.children) {
        buildVarMap(child);
      }
    };

    for (const rootId of rootIds) {
      const rootNode = nodes.get(rootId);
      if (rootNode) buildVarMap(rootNode);
    }

    return { rootIds, nodes, edges, variableMap };
  },
};

/**
 * Helper to resolve a multi-segment qualified path A::B::C::D.
 */
function resolveQualifiedPath(db: QueryDB, roots: SymbolEntry[], segments: string[]): SymbolEntry | null {
  let currentSet = roots;
  for (const seg of segments) {
    const nextSet: SymbolEntry[] = [];
    for (const curr of currentSet) {
      // 1. Direct children
      for (const child of db.childrenOf(curr.id)) {
        if (child.name === seg) {
          nextSet.push(child);
        }
      }
      // 2. Inherited children from superclassifiers
      for (const scChild of db.childrenOf(curr.id)) {
        if (scChild.ruleName === "OwnedSubclassification" && scChild.name) {
          const superTargets = db.byName(scChild.name);
          for (const st of superTargets) {
            for (const child of db.childrenOf(st.id)) {
              if (child.name === seg) nextSet.push(child);
            }
          }
        }
      }
    }
    if (nextSet.length === 0) return null;
    currentSet = nextSet;
  }
  return currentSet[0] ?? null;
}

/**
 * Resolve a feature reference name within a scope.
 * Searches: (1) multi-segment qualified names, (2) dot-separated feature paths, (3) direct scope children, (4) inherited members, (5) imported members/namespaces, (6) global byName.
 */
const resolveFeatureInScope = (db: QueryDB, scopeId: number | null, name: string): SymbolEntry | null => {
  // 1. Multi-segment qualified name lookup (e.g. "ScalarValues::Real", "A::B::C::D")
  if (name.includes("::")) {
    const parts = name.split("::");
    const rootName = parts[0]!;
    const rest = parts.slice(1);

    const rootCandidates: SymbolEntry[] = [];

    // Search lexical scope chain for the root segment
    if (scopeId !== null) {
      let cur: number | null = scopeId;
      while (cur !== null) {
        const p = db.symbol(cur);
        if (!p) break;
        for (const ch of db.childrenOf(p.id)) {
          if (ch.name === rootName) rootCandidates.push(ch);
        }
        cur = p.parentId;
      }
    }

    // Also include top-level packages matching rootName
    for (const cand of db.byName(rootName)) {
      if (!rootCandidates.some((r) => r.id === cand.id)) {
        rootCandidates.push(cand);
      }
    }

    const resolved = resolveQualifiedPath(db, rootCandidates, rest);
    if (resolved) return resolved;
  }

  // 1b. Dot-separated feature path lookup (e.g. "engine.fuelIn", "a.b.c")
  if (name.includes(".")) {
    const segments = name.split(".");
    let curr = resolveFeatureInScope(db, scopeId, segments[0]!);
    if (!curr) return null;
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i]!;
      let next: SymbolEntry | null = db.childrenOf(curr.id).find((c) => c.name === seg) ?? null;
      if (!next) {
        const typeDef = resolveTypeOf(db, curr);
        if (typeDef) {
          next = resolveQualifiedPath(db, [typeDef], [seg]);
        }
      }
      if (!next) return null;
      curr = next;
    }
    return curr;
  }

  // 2. Search enclosing scope's children, inheritance, and imports up the scope chain
  if (scopeId !== null) {
    let current: number | null = scopeId;
    while (current !== null) {
      const parent = db.symbol(current);
      if (!parent) break;
      const children = db.childrenOf(parent.id);

      // (a) Search direct non-import children
      for (const child of children) {
        if (child.kind !== "Import" && child.name === name) return child;
      }

      // (b) Search inherited members from superclassifiers (:>)
      const visitedSuper = new Set<string>();
      const superQueue: string[] = [];
      for (const child of children) {
        if (child.ruleName === "OwnedSubclassification" && child.name) {
          superQueue.push(child.name);
        }
      }
      while (superQueue.length > 0) {
        const superName = superQueue.shift()!;
        if (visitedSuper.has(superName)) continue;
        visitedSuper.add(superName);

        const superTargets = db.byName(superName);
        for (const st of superTargets) {
          for (const member of db.childrenOf(st.id)) {
            if (member.kind !== "Import" && member.name === name) return member;
          }
          // Transitive inheritance
          for (const grandChild of db.childrenOf(st.id)) {
            if (grandChild.ruleName === "OwnedSubclassification" && grandChild.name) {
              superQueue.push(grandChild.name);
            }
          }
        }
      }

      // (c) Search imports in this scope
      for (const child of children) {
        if (child.kind === "Import" && child.name) {
          const importTarget = child.name;

          // Case i: Namespace wildcard import (e.g. "ScalarValues::*" or "ScalarValues")
          if (importTarget.endsWith("::*") || importTarget.endsWith("::**") || !importTarget.includes("::")) {
            const rawPkg = importTarget.replace(/::\*+$/, "");
            const pkgBaseName = rawPkg.split("::").pop() || rawPkg;
            const pkgs = db.byName(pkgBaseName);
            for (const p of pkgs) {
              for (const member of db.childrenOf(p.id)) {
                if (member.name === name) return member;
              }
            }
          }

          // Case ii: Membership import (e.g. "ScalarValues::Real" or "ISQ::Time")
          if (importTarget.endsWith("::" + name) || importTarget === name) {
            const parts = importTarget.split("::");
            if (parts.length > 1) {
              const pkgName = parts[parts.length - 2]!;
              const pkgs = db.byName(pkgName);
              for (const p of pkgs) {
                for (const member of db.childrenOf(p.id)) {
                  if (member.name === name) return member;
                }
              }
            } else {
              const candidates = db.byName(name);
              if (candidates && candidates.length > 0) return candidates[0]!;
            }
          }
        }
      }

      current = parent.parentId;
    }
  }

  // 3. Fallback: global name lookup (restricted to root definitions and standard types)
  const globals = db.byName(name);
  if (!globals || globals.length === 0) return null;

  if (scopeId === null) return globals[0]!;

  const standardTypes = new Set(["Real", "Integer", "Boolean", "String", "Natural", "Complex", "Rational", "Anything"]);
  if (standardTypes.has(name)) return globals[0]!;

  const rootGlobal = globals.find((g) => g.parentId === null || g.kind === "Package");
  return rootGlobal ?? null;
};

/** Queries for all Usage rules */
const usageQueries = {
  inferredSuperClasses: (db: QueryDB, self: SymbolEntry) => packageTraceabilityQueries.inferredSuperClasses(db, self),
  ownedFeatures: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Usage"),
  resolvedType: (db: QueryDB, self: SymbolEntry) => {
    // Find child OwnedFeatureTyping ref entries and resolve the type in scope
    for (const child of db.childrenOf(self.id)) {
      if (child.ruleName === "OwnedFeatureTyping" && child.name) {
        const resolved = resolveFeatureInScope(db, self.parentId, child.name);
        if (resolved) return resolved;
      }
    }
    return null;
  },
  typeSpecifier: (db: QueryDB, self: SymbolEntry) => {
    // Resolve type from child OwnedFeatureTyping ref
    const typeChild = db.childrenOf(self.id).find((c) => c.ruleName === "OwnedFeatureTyping");
    let typeName = typeChild?.name ?? null;
    if (typeName === "KerML::Real" || typeName === "ISQ::Real") typeName = "Real";
    if (typeName === "KerML::Integer") typeName = "Integer";
    if (typeName === "KerML::Boolean") typeName = "Boolean";
    return typeName;
  },
  redefinedFeatures: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "OwnedRedefinition"),
  subsettedFeatures: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "OwnedSubsetting"),
};

// ---- shared model configs ----

/** Shared model config for all Definition rules */
const definitionModel = {
  name: "DefinitionNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    defKind: "string" as const,
    isAbstract: "boolean" as const,
    isVariation: "boolean" as const,
  },
  queryTypes: {
    members: "SemanticNode[]" as const,
    ownedUsages: "UsageNode[]" as const,
    ownedDefinitions: "DefinitionNode[]" as const,
    imports: "SemanticNode[]" as const,
    ownedParts: "UsageNode[]" as const,
    ownedAttributes: "UsageNode[]" as const,
    ownedPorts: "UsageNode[]" as const,
    ownedActions: "UsageNode[]" as const,
    ownedConstraints: "UsageNode[]" as const,
    ownedConnections: "UsageNode[]" as const,
    superclassifiers: "DefinitionNode[]" as const,
  },
};

/** Shared model config for all Usage rules */
const usageModel = {
  name: "UsageNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    usageKind: "string" as const,
    isRef: "boolean" as const,
    isAbstract: "boolean" as const,
    isVariation: "boolean" as const,
    isDerived: "boolean" as const,
    isEnd: "boolean" as const,
    isOrdered: "boolean" as const,
    isNonunique: "boolean" as const,
    isConstant: "boolean" as const,
    direction: "string | null" as const,
  },
  queryTypes: {
    resolvedType: "DefinitionNode | null" as const,
    ownedFeatures: "UsageNode[]" as const,
    redefinedFeatures: "SemanticNode[]" as const,
    subsettedFeatures: "SemanticNode[]" as const,
  },
};

/** Shared model config for Package rules */
const packageModel = {
  name: "PackageNode" as const,
  visitable: true,
  properties: { isLibrary: "boolean" as const, isStandard: "boolean" as const },
  queryTypes: {
    members: "SemanticNode[]" as const,
    ownedDefinitions: "DefinitionNode[]" as const,
    ownedUsages: "UsageNode[]" as const,
    imports: "SemanticNode[]" as const,
  },
};

// ---------------------------------------------------------------------------
// KerML Expression Evaluator — CST-based tree-walk interpreter
// ---------------------------------------------------------------------------

/** Result of evaluating an expression. undefined = "cannot evaluate". */
type EvalResult = number | boolean | string | null | undefined;

/** CSTNode type alias for expression evaluation */
type CSTNode = import("@modelscript/dsl").CSTNode;

/**
 * Resolve a feature reference name within a scope.
 * Searches: (1) qualified names, (2) direct scope children, (3) imported members/namespaces, (4) global byName.
 */
/**
 * Resolve the type entry for a feature usage.
 * Reads the OwnedFeatureTyping child's name and resolves via resolveFeatureInScope.
 */
const resolveTypeOf = (db: QueryDB, entry: SymbolEntry): SymbolEntry | null => {
  return usageQueries.resolvedType(db, entry);
};

/**
 * Get the bound value of a feature (from modification, default value, etc.).
 * Returns undefined if no value is bound.
 */
const getFeatureValue = (db: QueryDB, entry: SymbolEntry): EvalResult => {
  // Try to get the result expression (for calculations)
  // or read the CST default value
  const cst = db.cstNode(entry.id) as CSTNode | null;
  if (!cst) return undefined;

  // Look for a ValuePart → OwnedExpression default value
  for (const child of cst.children) {
    if (child.type === "OwnedExpression" || child.type === "ResultExpressionMember") {
      const exprNode = child.type === "ResultExpressionMember" ? child.childForFieldName("ownedRelatedElement") : child;
      if (exprNode) return evaluateExpressionNode(db, exprNode, entry.parentId);
    }
  }

  // Look for default value in modification syntax (= expr)
  const text = db.cstText(entry.startOffset, entry.endOffset);
  if (text) {
    const eqMatch = text.match(/=\s*([0-9]+(?:\.[0-9]+)?)\s*;?\s*$/);
    if (eqMatch) {
      const num = parseFloat(eqMatch[1]!);
      if (!isNaN(num)) return num;
    }
  }

  return undefined;
};

/**
 * Resolve a dot-path like `vehicle.mass`:
 * 1. Resolve `vehicle` in scope → find its type definition
 * 2. Look up `mass` in that type's children
 * 3. Return the final feature's value
 */
const resolveFeaturePath = (db: QueryDB, names: string[], scopeId: number | null): EvalResult => {
  if (names.length === 0) return undefined;

  // Resolve the base name
  let current = resolveFeatureInScope(db, scopeId, names[0]!);
  if (!current) return undefined;

  // If single name, return its value directly
  if (names.length === 1) {
    return getFeatureValue(db, current);
  }

  // Walk the chain: for each step, resolve the type and find the member
  for (let i = 1; i < names.length; i++) {
    // Get the type of the current feature
    const typeDef = resolveTypeOf(db, current);
    if (!typeDef) return undefined;

    // Find the named member in the type's children
    const memberName = names[i];
    let found: SymbolEntry | null = null;
    for (const child of db.childrenOf(typeDef.id)) {
      if (child.name === memberName) {
        found = child;
        break;
      }
    }

    // Cross-Language Resolution: If the member is not found in the SysML type,
    // search across the UnifiedWorkspace for any implementation targets (e.g. Modelica classes)
    if (!found) {
      for (const sym of db.allEntries()) {
        const meta = sym.metadata as Record<string, unknown> | undefined;
        let implementsTarget: string | undefined = undefined;

        // Fast path for native SysML items
        if (meta?.["implementsTarget"] === typeDef.name) {
          implementsTarget = typeDef.name;
        }
        // Fallback for external languages like Modelica
        else if (meta?.["annotationClause"] && typeof meta["annotationClause"] === "string") {
          const match = meta["annotationClause"].match(/SysML\s*\(\s*implements\s*=\s*"([^"]+)"\s*\)/);
          if (match && match[1] === typeDef.name) implementsTarget = match[1];
        }

        if (implementsTarget) {
          for (const child of db.childrenOf(sym.id)) {
            if (child.name === memberName) {
              found = child;
              break; // Found in Modelica/external class
            }
          }
        }
        if (found) break;
      }
    }

    if (!found) return undefined;

    // If this is the last step, return the value
    if (i === names.length - 1) {
      return getFeatureValue(db, found);
    }

    // Otherwise, continue traversal
    current = found;
  }

  return undefined;
};

/**
 * Extract the feature name chain from a FeatureReferenceExpression or
 * PrimaryExpression with featureChain.
 */
const extractNameChain = (node: CSTNode): string[] => {
  const names: string[] = [];

  const extractQualifiedName = (qn: CSTNode): string | null => {
    // QualifiedName → name: Name → ID
    const nameNode = qn.childForFieldName("name");
    if (nameNode) {
      // Get the last segment of a qualified name
      const id = nameNode.children.find((c) => c.type === "ID");
      if (id) return id.text;
      return nameNode.text;
    }
    return qn.text;
  };

  // Walk the node to extract names
  if (node.type === "FeatureReferenceExpression") {
    const rel =
      node.childForFieldName("ownedRelationship") ||
      node.children.find((c) => c.type === "FeatureReferenceMember") ||
      node.children[0];
    if (rel) {
      const memberElement =
        rel.childForFieldName("memberElement") ||
        rel.children.find((c) => c.type === "QualifiedName") ||
        rel.children[0];
      if (memberElement) {
        const name = extractQualifiedName(memberElement) || memberElement.text.trim();
        if (name) names.push(name.trim());
      }
    }
  } else if (node.type === "PrimaryExpression") {
    // base: _BaseExpression, featureChain: FeatureChainMember
    const base = node.childForFieldName("base");
    if (base) {
      const baseNames = extractNameChain(base);
      names.push(...baseNames);
    }
    // Collect all featureChain members
    for (const child of node.children) {
      if (child.type === "FeatureChainMember") {
        const memberElement = child.childForFieldName("memberElement");
        if (memberElement) {
          const name = extractQualifiedName(memberElement);
          if (name) names.push(name);
        }
      }
    }
  }

  return names;
};

/**
 * Evaluate a KerML expression CST node.
 *
 * Walks the expression AST and computes values for:
 * - Literals (integer, real, boolean, string, null, infinity)
 * - Arithmetic (+, -, *, /, %, **, ^)
 * - Relational (<, >, <=, >=)
 * - Equality (==, !=)
 * - Logical (and, or, xor, not, implies)
 * - Conditional (if ? else)
 * - Feature references with full dot-path resolution (vehicle.mass)
 *
 * Returns undefined for expressions that cannot be statically evaluated.
 */
const evaluateExpressionNode = (db: QueryDB, node: CSTNode, scopeId: number | null): EvalResult => {
  switch (node.type) {
    // --- Literals ---
    case "LiteralInteger": {
      const val = node.childForFieldName("value");
      return val ? parseInt(val.text, 10) : parseInt(node.text.trim(), 10);
    }
    case "LiteralReal": {
      const val = node.childForFieldName("value");
      return val ? parseFloat(val.text) : parseFloat(node.text.trim());
    }
    case "LiteralBoolean": {
      const val = node.childForFieldName("value");
      const text = val ? val.text : node.text.trim();
      if (text === "true") return true;
      if (text === "false") return false;
      return undefined;
    }
    case "LiteralString": {
      const val = node.childForFieldName("value");
      const text = val ? val.text : node.text.trim();
      return text.replace(/^["']|["']$/g, "");
    }
    case "NullExpression":
      return null;
    case "LiteralInfinity":
      return Infinity;

    // --- Arithmetic ---
    case "AdditiveExpression":
    case "MultiplicativeExpression": {
      const operands = node.childrenForFieldName("operand");
      const operators = node.childrenForFieldName("operator").map((op) => op.text);
      if (operands.length < 2 || operators.length === 0) return undefined;
      let result = evaluateExpressionNode(db, operands[0]!, scopeId);
      if (typeof result !== "number") return undefined;
      for (let i = 0; i < operators.length; i++) {
        const right = evaluateExpressionNode(db, operands[i + 1]!, scopeId);
        if (typeof right !== "number") return undefined;
        switch (operators[i]) {
          case "+":
            result = (result as number) + right;
            break;
          case "-":
            result = (result as number) - right;
            break;
          case "*":
            result = (result as number) * right;
            break;
          case "/":
            result = right !== 0 ? (result as number) / right : undefined;
            break;
          case "%":
            result = right !== 0 ? (result as number) % right : undefined;
            break;
          default:
            return undefined;
        }
        if (result === undefined) return undefined;
      }
      return result;
    }

    case "ExponentiationExpression": {
      const baseNode = node.childForFieldName("base") ?? node.childrenForFieldName("operand")?.[0];
      const expNode = node.childForFieldName("exponent") ?? node.childrenForFieldName("operand")?.[1];
      if (!baseNode || !expNode) return undefined;
      const left = evaluateExpressionNode(db, baseNode, scopeId);
      const right = evaluateExpressionNode(db, expNode, scopeId);
      if (typeof left !== "number" || typeof right !== "number") return undefined;
      return Math.pow(left, right);
    }

    // --- Unary ---
    case "UnaryExpression": {
      const op = node.childForFieldName("operator");
      const operand = node.childForFieldName("operand");
      if (!op || !operand) return undefined;
      const val = evaluateExpressionNode(db, operand, scopeId);
      switch (op.text) {
        case "+":
          return typeof val === "number" ? val : undefined;
        case "-":
          return typeof val === "number" ? -val : undefined;
        case "not":
          return typeof val === "boolean" ? !val : undefined;
        case "~":
          return typeof val === "number" ? ~val : undefined;
        default:
          return undefined;
      }
    }

    // --- Relational ---
    case "RelationalExpression": {
      let operands = node.childrenForFieldName("operand");
      let operators = node
        .childrenForFieldName("operator")
        .map((op) => (op.text ?? op.children?.[0]?.text ?? "").trim());
      if (operands.length < 2 && node.children.length === 3) {
        operands = [node.children[0]!, node.children[2]!];
        operators = [(node.children[1]!.text ?? "").trim()];
      }
      if (operands.length < 2 || operators.length === 0) return undefined;
      const left = evaluateExpressionNode(db, operands[0]!, scopeId);
      const right = evaluateExpressionNode(db, operands[1]!, scopeId);
      if (typeof left !== "number" || typeof right !== "number") return undefined;
      const opText = operators[0];
      switch (opText) {
        case "<":
          return left < right;
        case ">":
          return left > right;
        case "<=":
          return left <= right;
        case ">=":
          return left >= right;
        default:
          return undefined;
      }
    }

    // --- Equality ---
    case "EqualityExpression": {
      const operands = node.childrenForFieldName("operand");
      const operators = node
        .childrenForFieldName("operator")
        .map((op) => (op.text ?? op.children?.[0]?.text ?? "").trim());
      if (operands.length < 2 || operators.length === 0) return undefined;
      const left = evaluateExpressionNode(db, operands[0]!, scopeId);
      const right = evaluateExpressionNode(db, operands[1]!, scopeId);
      if (left === undefined || right === undefined) return undefined;
      const opText = operators[0];
      switch (opText) {
        case "==":
          return left === right;
        case "!=":
          return left !== right;
        case "===":
          return left === right;
        case "!==":
          return left !== right;
        default:
          return undefined;
      }
    }

    // --- Logical ---
    case "AndExpression": {
      const operands = node.childrenForFieldName("operand");
      if (operands.length < 2) return undefined;
      let result = evaluateExpressionNode(db, operands[0]!, scopeId);
      if (typeof result !== "boolean") return undefined;
      for (let i = 1; i < operands.length; i++) {
        const right = evaluateExpressionNode(db, operands[i]!, scopeId);
        if (typeof right !== "boolean") return undefined;
        result = (result as boolean) && right;
      }
      return result;
    }

    case "OrExpression": {
      const operands = node.childrenForFieldName("operand");
      if (operands.length < 2) return undefined;
      let result = evaluateExpressionNode(db, operands[0]!, scopeId);
      if (typeof result !== "boolean") return undefined;
      for (let i = 1; i < operands.length; i++) {
        const right = evaluateExpressionNode(db, operands[i]!, scopeId);
        if (typeof right !== "boolean") return undefined;
        result = (result as boolean) || right;
      }
      return result;
    }

    case "XorExpression": {
      const operands = node.childrenForFieldName("operand");
      if (operands.length < 2) return undefined;
      let result = evaluateExpressionNode(db, operands[0]!, scopeId);
      if (typeof result !== "boolean") return undefined;
      for (let i = 1; i < operands.length; i++) {
        const right = evaluateExpressionNode(db, operands[i]!, scopeId);
        if (typeof right !== "boolean") return undefined;
        result = (result as boolean) !== right;
      }
      return result;
    }

    case "ImpliesExpression": {
      const operands = node.childrenForFieldName("operand");
      if (operands.length < 2) return undefined;
      const left = evaluateExpressionNode(db, operands[0]!, scopeId);
      // For implies references, we need to unwrap the ImpliesExpressionReference
      let rightNode = operands[1]!;
      if (rightNode.type === "ImpliesExpressionReference") {
        const inner = rightNode.childForFieldName("ownedRelationship");
        if (inner) {
          const elem = inner.childForFieldName("ownedRelatedElement");
          if (elem) rightNode = elem;
        }
      }
      const right = evaluateExpressionNode(db, rightNode, scopeId);
      if (typeof left !== "boolean" || typeof right !== "boolean") return undefined;
      return !left || right; // p implies q ≡ ¬p ∨ q
    }

    // --- Conditional ---
    case "ConditionalExpression": {
      const operand = node.childForFieldName("operand");
      const thenRef = node.childForFieldName("thenOperand");
      const elseRef = node.childForFieldName("elseOperand");
      if (!operand || !thenRef || !elseRef) return undefined;
      const cond = evaluateExpressionNode(db, operand, scopeId);
      if (typeof cond !== "boolean") return undefined;
      // Unwrap OwnedExpressionReference → OwnedExpressionMember → OwnedExpression
      const unwrap = (ref: CSTNode): CSTNode => {
        const rel = ref.childForFieldName("ownedRelationship");
        if (rel) {
          const elem = rel.childForFieldName("ownedRelatedElement");
          if (elem) return elem;
        }
        return ref;
      };
      return cond
        ? evaluateExpressionNode(db, unwrap(thenRef), scopeId)
        : evaluateExpressionNode(db, unwrap(elseRef), scopeId);
    }

    // --- Feature references (with dot-path resolution) ---
    case "FeatureReferenceExpression": {
      const names = extractNameChain(node);
      if (names.length === 0) return undefined;
      return resolveFeaturePath(db, names, scopeId);
    }

    case "PrimaryExpression": {
      // Check for parenthesized expression: ( expr )
      const expr = node.childForFieldName("operand");
      if (expr) return evaluateExpressionNode(db, expr, scopeId);

      // Check for dot-path feature chain
      const names = extractNameChain(node);
      if (names.length > 0) {
        return resolveFeaturePath(db, names, scopeId);
      }

      // Check children
      for (const child of node.children) {
        const val = evaluateExpressionNode(db, child, scopeId);
        if (val !== undefined) return val;
      }
      return undefined;
    }

    // --- Wrapped expressions ---
    case "OwnedExpression":
    case "ExpressionBody": {
      for (const child of node.children) {
        const val = evaluateExpressionNode(db, child, scopeId);
        if (val !== undefined) return val;
      }
      return undefined;
    }

    default: {
      // For wrapper nodes, try to evaluate the first recognized child
      for (const child of node.children) {
        const val = evaluateExpressionNode(db, child, scopeId);
        if (val !== undefined) return val;
      }
      return undefined;
    }
  }
};

/**
 * Evaluate the body of a CalculationDefinition or CalculationUsage.
 * Finds the ResultExpressionMember in the CST and evaluates it.
 */
const evaluateResultExpression = (db: QueryDB, self: SymbolEntry, evalScopeId?: number | null): EvalResult => {
  const cst = db.cstNode(self.id) as CSTNode | null;
  if (!cst) return undefined;

  // Find ResultExpressionMember in the calculation body
  const findResultExpr = (node: CSTNode): CSTNode | null => {
    if (node.type === "ResultExpressionMember") return node;
    for (const child of node.children) {
      const found = findResultExpr(child);
      if (found) return found;
    }
    return null;
  };

  const resultMember = findResultExpr(cst);
  if (!resultMember) return undefined;

  // Navigate to the OwnedExpression inside
  const ownedRelElem =
    resultMember.childForFieldName("ownedRelatedElement") ||
    resultMember.children.find((c) => c.type === "OwnedExpression") ||
    resultMember.children[0];
  if (!ownedRelElem) return undefined;

  return evaluateExpressionNode(db, ownedRelElem, evalScopeId ?? self.parentId);
};

// ---------------------------------------------------------------------------
// Calculation Definition/Usage — dedicated models and queries
// ---------------------------------------------------------------------------

/** Model config for CalculationDefinition */
const calculationDefinitionModel = {
  name: "CalculationDefinitionNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...definitionModel.properties,
  },
  queryTypes: {
    ...definitionModel.queryTypes,
    parameters: "UsageNode[]" as const,
    returnParameter: "UsageNode | null" as const,
    resultExpression: "unknown" as const,
  },
};

/** Model config for CalculationUsage */
const calculationUsageModel = {
  name: "CalculationUsageNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...usageModel.properties,
  },
  queryTypes: {
    ...usageModel.queryTypes,
    parameters: "UsageNode[]" as const,
    returnParameter: "UsageNode | null" as const,
    resultExpression: "unknown" as const,
  },
};

/** Calculation Definition queries */
const calculationDefinitionQueries = {
  ...definitionStructuralQueries,
  parameters: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter((c) => c.kind === "Usage" && (metaStr(c, "direction") === "in" || metaStr(c, "direction") === "inout")),
  returnParameter: (db: QueryDB, self: SymbolEntry) => {
    const outputs = db.childrenOf(self.id).filter((c) => c.kind === "Usage" && metaStr(c, "direction") === "out");
    return outputs[0] ?? null;
  },
  resultExpression: (db: QueryDB, self: SymbolEntry) => evaluateResultExpression(db, self),
};

/** Calculation Usage queries */
const calculationUsageQueries = {
  ...usageQueries,
  parameters: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter((c) => c.kind === "Usage" && (metaStr(c, "direction") === "in" || metaStr(c, "direction") === "inout")),
  returnParameter: (db: QueryDB, self: SymbolEntry) => {
    const outputs = db.childrenOf(self.id).filter((c) => c.kind === "Usage" && metaStr(c, "direction") === "out");
    return outputs[0] ?? null;
  },
  resultExpression: (db: QueryDB, self: SymbolEntry) => evaluateResultExpression(db, self),
};

const calculationQueries = calculationDefinitionQueries;

// ---------------------------------------------------------------------------
// Constraint Evaluation — computed fields
// ---------------------------------------------------------------------------

/**
 * Evaluate the body of a ConstraintDefinition or ConstraintUsage.
 * The constraint body is a _CalculationBody containing a ResultExpressionMember.
 * Returns true/false/null (null = indeterminate).
 */
const evaluateConstraintBody = (db: QueryDB, self: SymbolEntry, evalScopeId?: number | null): boolean | null => {
  const result = evaluateResultExpression(db, self, evalScopeId);
  if (typeof result === "boolean") return result;
  if (result === undefined) return null; // indeterminate
  // Coerce numbers: 0 = false, nonzero = true
  if (typeof result === "number") return result !== 0;
  return null;
};

interface ActiveSimulationResult {
  trajectory?:
    | {
        signals?: { name?: string | undefined; values?: number[] | undefined }[] | undefined;
      }
    | undefined;
}

/** Constraint-specific queries */
const constraintEvalQueries = {
  /** Evaluate the constraint body and return true/false/null */
  constraintResult: (db: QueryDB, self: SymbolEntry) => evaluateConstraintBody(db, self),

  /** Dynamic simulation-backed validation via VerificationRunner */
  dynamicConstraintResult: (db: QueryDB, self: SymbolEntry) => {
    // Re-evaluates automatically when SimulationResult inputs (Salsa queries) change
    const dbWithSim = db as unknown as {
      query?(name: string): ActiveSimulationResult | undefined;
      activeSimulation?: ActiveSimulationResult | undefined;
    };
    const simResult = dbWithSim.query?.("activeSimulation") ?? dbWithSim.activeSimulation;
    if (simResult && simResult.trajectory) {
      const traj = simResult.trajectory;
      const staticRes = evaluateConstraintBody(db, self);
      if (staticRes === false) return false;

      if (Array.isArray(traj.signals)) {
        for (const sig of traj.signals) {
          if (sig.name && sig.values && (sig.name === self.name || sig.name.endsWith(`.${self.name}`))) {
            const hasViolation = sig.values.some((v: number) => !v);
            if (hasViolation) return false;
          }
        }
      }
      return true;
    }
    return evaluateConstraintBody(db, self);
  },
};

/** Constraint Definition model with evaluation */
const constraintDefinitionModel = {
  name: "ConstraintDefinitionNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...definitionModel.properties,
  },
  queryTypes: {
    ...definitionModel.queryTypes,
    constraintResult: "boolean | null" as const,
  },
};

/** Constraint Usage model with evaluation */
const constraintUsageModel = {
  name: "ConstraintUsageNode" as const,
  visitable: true,
  properties: {
    ...usageModel.properties,
  },
  queryTypes: {
    ...usageModel.queryTypes,
    constraintResult: "boolean | null" as const,
  },
};

/** Constraint Definition queries */
const constraintDefinitionQueries = {
  ...definitionStructuralQueries,
  ...constraintEvalQueries,
};

/** Constraint Usage queries */
const constraintUsageQueries = {
  ...usageQueries,
  ...constraintEvalQueries,
};

const getConstraintKind = (db: QueryDB, self: SymbolEntry): string => {
  const meta = metaStr(self, "constraintKind");
  if (meta) return meta;
  const text = db.cstText(Math.max(0, self.startOffset - 30), self.startOffset);
  if (text && text.includes("assume")) return "assume";
  return "require"; // default
};

/**
 * Computed: are all require constraints met for a requirement?
 * Returns true (all pass), false (any fail), or null (indeterminate).
 */
const evaluateConstraintsMet = (db: QueryDB, self: SymbolEntry): boolean | null => {
  let requireConstraints = db
    .childrenOf(self.id)
    .filter((c) => c.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, c) === "require");

  if (requireConstraints.length === 0) {
    const typeDef = usageQueries.resolvedType(db, self);
    if (typeDef) {
      requireConstraints = db
        .childrenOf(typeDef.id)
        .filter((c) => c.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, c) === "require");
    }
  }

  if (requireConstraints.length === 0) return null; // no constraints to check

  let allMet = true;
  let anyIndeterminate = false;

  for (const constraint of requireConstraints) {
    const result = evaluateConstraintBody(db, constraint, self.id);
    if (result === false) return false; // short-circuit: constraint violated
    if (result === null) anyIndeterminate = true;
    // result === true → continue
  }

  if (anyIndeterminate) return null;
  return allMet;
};

// ---------------------------------------------------------------------------
// Requirement satisfaction/verification — computed field helpers
// ---------------------------------------------------------------------------

/**
 * Extract the reference target name from a SatisfyRequirementUsage or VerifyRequirementUsage.
 * These nodes use OwnedReferenceSubsetting to reference the target requirement:
 *   satisfy MassRequirement by vehicle;  →  target = "MassRequirement"
 *   verify SafetyRequirement;            →  target = "SafetyRequirement"
 *
 * Falls back to the symbol's own name (for the `requirement <name>` branch).
 */
const getRelationshipTargetName = (db: QueryDB, entry: SymbolEntry): string | null => {
  // If the symbol has a declared name that is not its internal rule name, it's using the `requirement <name>` branch
  if (entry.name && entry.name !== entry.ruleName) {
    const parts = entry.name.split("::");
    return parts[parts.length - 1]!;
  }

  // Otherwise, extract from OwnedReferenceSubsetting CST child.
  // The CST text of the OwnedReferenceSubsetting span contains the qualified name.
  for (const child of db.childrenOf(entry.id)) {
    if (child.ruleName === "OwnedReferenceSubsetting") {
      const raw = db.cstText(child.startOffset, child.endOffset);
      if (raw) {
        const parts = raw.trim().split("::");
        return parts[parts.length - 1]!;
      }
    }
  }

  // Final fallback: read the raw CST text between the keyword and the body/semicolon
  // to get the target name from the source text.
  const text = db.cstText(entry.startOffset, entry.endOffset);
  if (text) {
    // Match patterns:  "verify <name>" or "satisfy <name>" or qualified names like "Pkg::Name"
    const match = text.match(
      /(?:verify|satisfy)\s+(?:requirement\s+)?([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)/,
    );
    if (match) {
      const parts = match[1]!.split("::");
      return parts[parts.length - 1]!;
    }
  }
  return null;
};

/**
 * Walk all symbols in the file to find satisfy/verify relationships
 * targeting a given requirement name.
 */
const findRelationshipsTargeting = (
  db: QueryDB,
  self: SymbolEntry,
  reqName: string,
  ruleNames: string[],
): SymbolEntry[] => {
  // Walk up to root to get the file-level scope
  let root = self;
  while (root.parentId !== null) {
    const parent = db.parentOf(root.id);
    if (!parent) break;
    root = parent;
  }

  // Recursively collect matching relationship entries
  const results: SymbolEntry[] = [];
  const walk = (parentId: number) => {
    for (const c of db.childrenOf(parentId)) {
      if (ruleNames.includes(c.ruleName)) {
        const targetName = getRelationshipTargetName(db, c);
        if (targetName === reqName) results.push(c);
      }
      // Walk into packages and definitions to find nested relationships
      if (c.kind === "Package" || c.kind === "Definition" || c.kind === "Usage") {
        walk(c.id);
      }
    }
  };
  walk(root.id);
  return results;
};

/** Computed satisfaction/verification queries for requirements */
const requirementSatisfactionQueries = {
  /** Whether this requirement has at least one satisfy relationship targeting it */
  isSatisfied: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name) return false;
    return findRelationshipsTargeting(db, self, self.name, ["SatisfyRequirementUsage"]).length > 0;
  },

  /** The satisfy relationships targeting this requirement */
  satisfiedBy: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name) return [];
    return findRelationshipsTargeting(db, self, self.name, ["SatisfyRequirementUsage"]);
  },

  /** Whether this requirement has at least one verify relationship targeting it */
  isVerified: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name) return false;
    return findRelationshipsTargeting(db, self, self.name, ["VerifyRequirementUsage"]).length > 0;
  },

  /** The verify relationships targeting this requirement */
  verifiedBy: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name) return [];
    return findRelationshipsTargeting(db, self, self.name, ["VerifyRequirementUsage"]);
  },

  /**
   * Computed verification status of this requirement.
   * Returns one of:
   *   "verified" | "satisfied" | "violated" | "partial" | "unverified" | "indeterminate"
   *
   * - "verified":      has both satisfy + verify, and all constraints met
   * - "satisfied":     has satisfy, constraints met (or no constraints)
   * - "violated":      has satisfy/verify, but constraints evaluate to false
   * - "partial":       has verify but no satisfy relationship
   * - "unverified":    has neither satisfy nor verify
   * - "indeterminate": constraints cannot be evaluated (references unresolved)
   */
  verificationStatus: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name) return "unverified";
    if (metaStr(self, "isAbstract") === "true") return "unverified";
    const hasSatisfy = findRelationshipsTargeting(db, self, self.name, ["SatisfyRequirementUsage"]).length > 0;
    const hasVerify = findRelationshipsTargeting(db, self, self.name, ["VerifyRequirementUsage"]).length > 0;

    // Evaluate constraints if satisfy/verify relationships exist
    if (hasSatisfy || hasVerify) {
      const constraintsMet = evaluateConstraintsMet(db, self);
      if (constraintsMet === false) return "violated";
      if (constraintsMet === null) {
        // Constraints exist but can't be evaluated
        const hasConstraints = db
          .childrenOf(self.id)
          .some((c) => c.ruleName === "RequirementConstraintUsage" && metaStr(c, "constraintKind") === "require");
        if (hasConstraints) return "indeterminate";
      }
    }

    if (hasSatisfy && hasVerify) return "verified";
    if (hasSatisfy) return "satisfied";
    if (hasVerify) return "partial";
    return "unverified";
  },

  /** Computed: are all require constraints met? */
  constraintsMet: (db: QueryDB, self: SymbolEntry) => evaluateConstraintsMet(db, self),
};

/** Model config for Requirement Definition/Usage */
const requirementDefinitionModel = {
  name: "RequirementDefinitionNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...definitionModel.properties,
  },
  queryTypes: {
    ...definitionModel.queryTypes,
    subject: "UsageNode | null" as const,
    assumeConstraints: "SemanticNode[]" as const,
    requireConstraints: "SemanticNode[]" as const,
    actors: "UsageNode[]" as const,
    stakeholders: "UsageNode[]" as const,
    isSatisfied: "boolean" as const,
    satisfiedBy: "SemanticNode[]" as const,
    isVerified: "boolean" as const,
    verifiedBy: "SemanticNode[]" as const,
    verificationStatus: "string" as const,
    constraintsMet: "boolean | null" as const,
  },
};

/** Queries for Requirement rules */
const requirementQueries = {
  ...definitionStructuralQueries,
  subject: (db: QueryDB, self: SymbolEntry) => {
    for (const c of db.childrenOf(self.id)) {
      if (c.ruleName === "SubjectUsage") return c;
    }
    return null;
  },
  assumeConstraints: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter((c) => c.ruleName === "RequirementConstraintUsage" && metaStr(c, "constraintKind") === "assume"),
  requireConstraints: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter((c) => c.ruleName === "RequirementConstraintUsage" && metaStr(c, "constraintKind") === "require"),
  actors: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.ruleName === "ActorUsage"),
  stakeholders: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "StakeholderUsage"),
  ...requirementSatisfactionQueries,
};

/** Model config for State Definition/Usage */
const stateDefinitionModel = {
  name: "StateDefinitionNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...definitionModel.properties,
    isParallel: "boolean" as const,
  },
  queryTypes: {
    ...definitionModel.queryTypes,
    entryAction: "SemanticNode | null" as const,
    doAction: "SemanticNode | null" as const,
    exitAction: "SemanticNode | null" as const,
    transitions: "SemanticNode[]" as const,
  },
};

/** Model config for State Usage */
const stateUsageModel = {
  name: "StateUsageNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...usageModel.properties,
    isParallel: "boolean" as const,
  },
  queryTypes: {
    ...usageModel.queryTypes,
  },
};

/** Queries for State rules */
const stateQueries = {
  ...definitionStructuralQueries,
  entryAction: (db: QueryDB, self: SymbolEntry) => {
    for (const c of db.childrenOf(self.id)) {
      if (c.ruleName === "StateActionUsage" && c.fieldName === "ownedRelatedElement") {
        // Check if parent is EntryActionMember
        const parent = db.parentOf(self.id);
        if (parent) return c;
      }
    }
    return null;
  },
  doAction: (_db: QueryDB, _self: SymbolEntry) => null as SymbolEntry | null,
  exitAction: (_db: QueryDB, _self: SymbolEntry) => null as SymbolEntry | null,
  transitions: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "TransitionUsage"),
};

/** Model config for Import rules */
const importModel = {
  name: "ImportNode" as const,
  visitable: true,
  properties: {
    importKind: "string" as const,
    isImportAll: "boolean" as const,
    isRecursive: "boolean" as const,
  },
};

/** Shared lint rules for all Definition rules */
const definitionLints = {
  definitionNaming: (_db: QueryDB, self: SymbolEntry) => {
    if (self.name && /^[a-z]/.test(self.name)) {
      return warning(SysML2ErrorCode.DEFINITION_NAMING.message(self.name), {
        code: SysML2ErrorCode.DEFINITION_NAMING.code,
        field: "declaredName",
      });
    }
    return null;
  },
  emptyDefinition: (db: QueryDB, self: SymbolEntry) => {
    if (db.childrenOf(self.id).length === 0) {
      return info(SysML2ErrorCode.EMPTY_DEFINITION.message(self.name), {
        code: SysML2ErrorCode.EMPTY_DEFINITION.code,
        field: "declaredName",
      });
    }
    return null;
  },
  /** Error when two direct children share the same name. */
  duplicateFeatureName: (db: QueryDB, self: SymbolEntry) => {
    const seen = new Map<string, SymbolEntry>();
    for (const child of db.childrenOf(self.id)) {
      if (!child.name || child.name === "<anonymous>") continue;
      if (
        child.kind === "Specialization" ||
        child.kind === "Import" ||
        child.kind === "Reference" ||
        child.ruleName === "OwnedSubclassification" ||
        child.ruleName === "OwnedFeatureTyping" ||
        child.ruleName === "OwnedRedefinition" ||
        child.ruleName === "OwnedSubsetting" ||
        child.ruleName === "SatisfyRequirementUsage" ||
        child.ruleName === "VerifyRequirementUsage" ||
        child.ruleName === "IncludeUseCaseUsage"
      ) {
        continue;
      }
      const prev = seen.get(child.name);
      if (prev) {
        const dupRange = child.fieldRanges?.["declaredName"] ?? child.fieldRanges?.["name"];
        return warning(SysML2ErrorCode.DUPLICATE_MEMBER.message(child.name, self.name), {
          code: SysML2ErrorCode.DUPLICATE_MEMBER.code,
          field: "declaredName",
          ...(dupRange
            ? { startOffset: dupRange.startOffset, endOffset: dupRange.endOffset }
            : { startOffset: child.startOffset, endOffset: child.endOffset }),
        });
      }
      seen.set(child.name, child);
    }
    return null;
  },
  /** Error when a definition's superclassifier chain creates a cycle. */
  circularSpecialization: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name) return null;
    const queue: string[] = [];
    for (const child of db.childrenOf(self.id)) {
      if (child.ruleName === "OwnedSubclassification" && child.name) {
        queue.push(child.name);
      }
    }
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === self.name) {
        return error(SysML2ErrorCode.CIRCULAR_SPECIALIZATION.message(self.name), {
          code: SysML2ErrorCode.CIRCULAR_SPECIALIZATION.code,
          field: "declaredName",
        });
      }
      if (visited.has(current)) continue;
      visited.add(current);
      const targets = db.byName(current);
      const target = targets.find((t) => t.kind === "Definition");
      if (!target) continue;
      if (target.name === self.name) {
        return error(SysML2ErrorCode.CIRCULAR_SPECIALIZATION.message(self.name), {
          code: SysML2ErrorCode.CIRCULAR_SPECIALIZATION.code,
          field: "declaredName",
        });
      }
      for (const sc of db.childrenOf(target.id)) {
        if (sc.ruleName === "OwnedSubclassification" && sc.name) {
          queue.push(sc.name);
        }
      }
    }
    return null;
  },
  symbolNotFound: (db: QueryDB, self: SymbolEntry) => checkSymbolResolution(db, self),
};

/** Shared lint rules for all Usage rules */
const usageLints = {
  usageNaming: (_db: QueryDB, self: SymbolEntry) => {
    if (
      self.ruleName === "SatisfyRequirementUsage" ||
      self.ruleName === "VerifyRequirementUsage" ||
      self.ruleName === "IncludeUseCaseUsage" ||
      self.ruleName === "AllocationUsage" ||
      self.ruleName === "AllocateUsage"
    ) {
      return null;
    }
    if (self.name && self.name !== self.ruleName && /^[A-Z]/.test(self.name)) {
      return warning(SysML2ErrorCode.USAGE_NAMING.message(self.name), {
        code: SysML2ErrorCode.USAGE_NAMING.code,
        field: "declaredName",
      });
    }
    return null;
  },
  duplicateFeatureName: (db: QueryDB, self: SymbolEntry) => definitionLints.duplicateFeatureName(db, self),
  circularSpecialization: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name || self.name === "<anonymous>") return null;
    const queue: string[] = [];
    for (const child of db.childrenOf(self.id)) {
      if ((child.ruleName === "OwnedSubsetting" || child.ruleName === "OwnedRedefinition") && child.name) {
        queue.push(child.name);
      }
    }
    if (queue.length === 0) return null;
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === self.name) {
        return error(SysML2ErrorCode.CIRCULAR_SPECIALIZATION.message(self.name), {
          code: SysML2ErrorCode.CIRCULAR_SPECIALIZATION.code,
          field: "declaredName",
        });
      }
      if (visited.has(current)) continue;
      visited.add(current);
      const targets = db.byName(current);
      const target = targets.find((t) => t.kind === "Usage");
      if (!target) continue;
      for (const sc of db.childrenOf(target.id)) {
        if ((sc.ruleName === "OwnedSubsetting" || sc.ruleName === "OwnedRedefinition") && sc.name) {
          queue.push(sc.name);
        }
      }
    }
    return null;
  },
  symbolNotFound: (db: QueryDB, self: SymbolEntry) => checkSymbolResolution(db, self),
  multiplicityBounds: (_db: QueryDB, self: SymbolEntry) => {
    // metadata fields are extracted as strings from the CST if they existed
    const lowerStr = self.metadata?.["multiplicityLower"] as string | undefined;
    if (!lowerStr) return null; // No multiplicity declared

    let upperStr = self.metadata?.["multiplicityUpper"] as string | undefined;
    if (!upperStr) upperStr = lowerStr; // e.g. [3] means lower=3, upper=3

    const parseBound = (s: string) => (s.trim() === "*" || s.includes("Infinity") ? Infinity : parseFloat(s));
    const lower = parseBound(lowerStr);
    const upper = parseBound(upperStr);

    if (!isNaN(lower) && !isNaN(upper) && lower > upper) {
      return error(SysML2ErrorCode.INVALID_MULTIPLICITY_BOUNDS.message(lowerStr, upperStr), {
        code: SysML2ErrorCode.INVALID_MULTIPLICITY_BOUNDS.code,
        startOffset: self.startOffset,
        endOffset: self.endOffset,
      });
    }

    return null;
  },
  dimensionalAssignment: (db: QueryDB, self: SymbolEntry) => {
    let typeName: string | null = null;
    for (const child of db.childrenOf(self.id)) {
      if (child.ruleName === "OwnedFeatureTyping" && child.name) {
        typeName = child.name;
        break;
      }
    }
    if (!typeName && self.metadata?.["typeSpecifier"]) {
      typeName = String(self.metadata["typeSpecifier"]);
    }
    if (!typeName) return null;

    const targetDim = resolveTypeDimension(db, typeName);
    if (!targetDim || isDimensionless(targetDim)) return null;

    const cst = db.cstNode(self.id) as SysmlCstNode | null;
    if (!cst) return null;

    let exprNode: SysmlCstNode | null | undefined = null;
    for (const child of cst.children || []) {
      if (child.type === "OwnedExpression" || child.type === "ResultExpressionMember") {
        exprNode = child.type === "ResultExpressionMember" ? child.childForFieldName?.("ownedRelatedElement") : child;
        break;
      }
      if (child.type === "FeatureValue" || child.type === "_ValuePart" || child.type === "ValuePart") {
        exprNode =
          child.children?.find((c: SysmlCstNode) => c.type === "OwnedExpression") ||
          child.childForFieldName?.("ownedRelatedElement") ||
          child;
        break;
      }
    }
    if (!exprNode) return null;

    const inferRes = inferExpressionDimension(db, exprNode, self.parentId);
    if (inferRes.error) {
      return error(inferRes.error.message, {
        code: SysML2ErrorCode.DIMENSIONAL_MISMATCH.code,
        startOffset: inferRes.error.startOffset ?? self.startOffset,
        endOffset: inferRes.error.endOffset ?? self.endOffset,
      });
    }

    if (inferRes.dimension && !areDimensionsEqual(targetDim, inferRes.dimension)) {
      return error(
        SysML2ErrorCode.DIMENSIONAL_MISMATCH.message(
          self.name || "<anonymous>",
          getDimensionLabel(targetDim),
          getDimensionLabel(inferRes.dimension),
        ),
        {
          code: SysML2ErrorCode.DIMENSIONAL_MISMATCH.code,
          startOffset: self.startOffset,
          endOffset: self.endOffset,
        },
      );
    }

    return null;
  },
  typeMismatchAssignment: (db: QueryDB, self: SymbolEntry) => checkFeatureAssignmentType(db, self),
};

/** Lint rules for Constraint Definition/Usage — report violated constraints */
const constraintLints = {
  constraintViolated: (db: QueryDB, self: SymbolEntry) => {
    const result = evaluateConstraintBody(db, self);
    if (result === false) {
      return error(SysML2ErrorCode.CONSTRAINT_VIOLATED.message(self.name || "<anonymous>"), {
        code: SysML2ErrorCode.CONSTRAINT_VIOLATED.code,
      });
    }
    return null;
  },
  dimensionalConstraint: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SysmlCstNode | null;
    if (!cst) return null;

    let exprNode: SysmlCstNode | null | undefined = null;
    for (const child of cst.children || []) {
      if (child.type === "OwnedExpression" || child.type === "ExpressionBody") {
        exprNode = child;
        break;
      }
      if (child.type === "ResultExpressionMember") {
        exprNode =
          child.children?.find((c: SysmlCstNode) => c.type === "OwnedExpression") ||
          child.childForFieldName?.("ownedRelatedElement") ||
          child;
        break;
      }
    }
    if (!exprNode) return null;

    const inferRes = inferExpressionDimension(db, exprNode, self.parentId ?? self.id);
    if (inferRes.error) {
      return error(inferRes.error.message, {
        code: SysML2ErrorCode.DIMENSIONAL_MISMATCH.code,
        startOffset: inferRes.error.startOffset ?? self.startOffset,
        endOffset: inferRes.error.endOffset ?? self.endOffset,
      });
    }
    return null;
  },
};

const constraintDefinitionLints = {
  ...definitionLints,
  ...constraintLints,
};

const constraintUsageLintRules = {
  ...usageLints,
  ...constraintLints,
};

const requirementLints = {
  missingSubject: (db: QueryDB, self: SymbolEntry) => {
    if (metaStr(self, "isAbstract") === "true") return null;

    const subjects = db.childrenOf(self.id).filter((c) => c.ruleName === "SubjectUsage");
    const satisfied = db.childrenOf(self.id).filter((c) => c.ruleName === "SatisfyRequirementUsage");
    if (subjects.length === 0 && satisfied.length === 0 && self.name && self.kind === "Definition") {
      return info(SysML2ErrorCode.MISSING_SUBJECT.message(self.name), {
        code: SysML2ErrorCode.MISSING_SUBJECT.code,
        field: "declaredName",
      });
    }
    return null;
  },
  cyclicSatisfaction: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name) return null;
    const satisfyUsages = db.childrenOf(self.id).filter((c) => c.ruleName === "SatisfyRequirementUsage");
    const queue: string[] = [];
    for (const satisfy of satisfyUsages) {
      const targetName = getRelationshipTargetName(db, satisfy);
      if (targetName) queue.push(targetName);
    }
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === self.name) {
        return error(SysML2ErrorCode.CYCLIC_SATISFACTION.message(self.name), {
          code: SysML2ErrorCode.CYCLIC_SATISFACTION.code,
          field: "declaredName",
        });
      }
      if (visited.has(current)) continue;
      visited.add(current);
      const targets = db.byName(current);
      const reqTarget = targets.find(
        (t) => t.ruleName === "RequirementDefinition" || t.ruleName === "RequirementUsage",
      );
      if (!reqTarget) continue;
      if (reqTarget.name === self.name) {
        return error(SysML2ErrorCode.CYCLIC_SATISFACTION.message(self.name), {
          code: SysML2ErrorCode.CYCLIC_SATISFACTION.code,
          field: "declaredName",
        });
      }
      for (const nextSat of db.childrenOf(reqTarget.id)) {
        if (nextSat.ruleName === "SatisfyRequirementUsage") {
          const nextTarget = getRelationshipTargetName(db, nextSat);
          if (nextTarget) queue.push(nextTarget);
        }
      }
    }
    return null;
  },
  /** Error when a requirement's require-constraints evaluate to false */
  requirementConstraintViolated: (db: QueryDB, self: SymbolEntry) => {
    const result = evaluateConstraintsMet(db, self);
    if (result === false) {
      return error(SysML2ErrorCode.REQUIREMENT_CONSTRAINT_VIOLATED.message(self.name), {
        code: SysML2ErrorCode.REQUIREMENT_CONSTRAINT_VIOLATED.code,
        field: "declaredName",
      });
    }
    return null;
  },
};

const satisfyRequirementLints = {
  ...usageLints,
  invalidTarget: (db: QueryDB, self: SymbolEntry) => {
    const targetName = getRelationshipTargetName(db, self);
    if (!targetName || targetName === self.ruleName) return null;
    const targets = db.byName(targetName);
    const reqTarget = targets.find((t) => t.ruleName === "RequirementDefinition" || t.ruleName === "RequirementUsage");
    if (targets.length > 0 && !reqTarget) {
      return error(SysML2ErrorCode.TARGET_NOT_REQUIREMENT.message(targetName), {
        code: SysML2ErrorCode.TARGET_NOT_REQUIREMENT.code,
        field: "declaredName",
      });
    }
    return null;
  },
  /** Warning when satisfying a requirement whose constraints are violated */
  satisfyingViolatedRequirement: (db: QueryDB, self: SymbolEntry) => {
    const targetName = getRelationshipTargetName(db, self);
    if (!targetName) return null;
    const targets = db.byName(targetName);
    const reqTarget = targets.find((t) => t.ruleName === "RequirementDefinition" || t.ruleName === "RequirementUsage");
    if (!reqTarget) return null;
    const constraintsMet = evaluateConstraintsMet(db, reqTarget);
    if (constraintsMet === false) {
      return warning(`Satisfying '${targetName}' whose constraints evaluate to false`, {
        code: SysML2ErrorCode.SATISFYING_VIOLATED_REQUIREMENT.code,
        field: "declaredName",
      });
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Verification Case models, queries, and lints
// ---------------------------------------------------------------------------

/** Model config for VerificationCaseDefinition */
const verificationCaseDefinitionModel = {
  name: "VerificationCaseDefinitionNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...definitionModel.properties,
  },
  queryTypes: {
    ...definitionModel.queryTypes,
    verifiedRequirements: "SemanticNode[]" as const,
    objective: "SemanticNode | null" as const,
  },
};

/** Model config for VerificationCaseUsage */
const verificationCaseUsageModel = {
  name: "VerificationCaseUsageNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...usageModel.properties,
  },
  queryTypes: {
    ...usageModel.queryTypes,
    verifiedRequirements: "SemanticNode[]" as const,
    objective: "SemanticNode | null" as const,
  },
};

/** Queries for VerificationCase rules */
const verificationCaseQueries = {
  ...definitionStructuralQueries,
  verifiedRequirements: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "VerifyRequirementUsage"),
  objective: (db: QueryDB, self: SymbolEntry) => {
    for (const c of db.childrenOf(self.id)) {
      if (c.ruleName === "ObjectiveRequirementUsage") return c;
    }
    return null;
  },
};

/** Queries for VerificationCaseUsage */
const verificationCaseUsageQueries = {
  ...usageQueries,
  verifiedRequirements: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "VerifyRequirementUsage"),
  objective: (db: QueryDB, self: SymbolEntry) => {
    for (const c of db.childrenOf(self.id)) {
      if (c.ruleName === "ObjectiveRequirementUsage") return c;
    }
    return null;
  },
};

/** Lint rules for VerificationCaseDefinition */
const verificationCaseDefinitionLints = {
  ...definitionLints,
  emptyVerificationCase: (db: QueryDB, self: SymbolEntry) => {
    const verifyMembers = db.childrenOf(self.id).filter((c) => c.ruleName === "VerifyRequirementUsage");
    if (verifyMembers.length === 0 && self.name) {
      return info(`Verification case '${self.name}' has no 'verify' members`, {
        code: SysML2ErrorCode.EMPTY_VERIFICATION_CASE.code,
        field: "declaredName",
      });
    }
    return null;
  },
  missingObjective: (db: QueryDB, self: SymbolEntry) => {
    if (metaStr(self, "isAbstract") === "true") return null;
    const objectives = db.childrenOf(self.id).filter((c) => c.ruleName === "ObjectiveRequirementUsage");
    if (objectives.length === 0 && self.name) {
      return info(`Verification case '${self.name}' has no objective`, {
        code: SysML2ErrorCode.MISSING_VERIFICATION_OBJECTIVE.code,
        field: "declaredName",
      });
    }
    return null;
  },
};

/** Lint rules for VerificationCaseUsage */
const verificationCaseUsageLints = {
  ...usageLints,
  emptyVerificationCase: (db: QueryDB, self: SymbolEntry) => {
    const verifyMembers = db.childrenOf(self.id).filter((c) => c.ruleName === "VerifyRequirementUsage");
    if (verifyMembers.length === 0 && self.name) {
      return info(`Verification case '${self.name}' has no 'verify' members`, {
        code: SysML2ErrorCode.EMPTY_VERIFICATION_CASE.code,
        field: "declaredName",
      });
    }
    return null;
  },
  /** Provide a hook into the VerificationRunner for incremental verification */
  verificationResult: (_db: QueryDB, _self: SymbolEntry) => {
    // Requires a SimulationResult object to evaluate.
    // In practice, this would look up another query that returns the simulation object:
    // const simResult = db.query<SimulationResult>("simulationData", self.id);
    return null;
  },
};

const getAllocationEndpointName = (db: QueryDB, ref: SymbolEntry): string => {
  if (ref.name && ref.name !== "OwnedReferenceSubsetting" && !ref.name.includes(".")) {
    const raw = (db.cstText(ref.startOffset, ref.endOffset) || "").trim();
    if (raw.includes(".")) return raw;
    return ref.name.trim();
  }
  if (ref.name && ref.name !== "OwnedReferenceSubsetting") {
    return ref.name.trim();
  }
  return (db.cstText(ref.startOffset, ref.endOffset) || "").trim();
};

const getUnresolvedFeatureRange = (
  db: QueryDB,
  scopeId: number | null,
  ref: SymbolEntry,
  pathStr: string,
): { startOffset: number; endOffset: number } => {
  if (!pathStr.includes(".")) {
    return { startOffset: ref.startOffset, endOffset: ref.endOffset };
  }
  const segments = pathStr.split(".");
  let curr = resolveFeatureInScope(db, scopeId, segments[0]!);
  let failIdx = 0;
  if (curr) {
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i]!;
      let next: SymbolEntry | null = db.childrenOf(curr.id).find((c) => c.name === seg) ?? null;
      if (!next) {
        const typeDef = resolveTypeOf(db, curr);
        if (typeDef) {
          next = resolveQualifiedPath(db, [typeDef], [seg]);
        }
      }
      if (!next) {
        failIdx = i;
        break;
      }
      curr = next;
    }
  }
  let offset = 0;
  for (let i = 0; i < failIdx; i++) {
    offset += segments[i]!.length + 1;
  }
  const segLen = segments[failIdx]?.length ?? pathStr.length;
  return {
    startOffset: ref.startOffset + offset,
    endOffset: Math.min(ref.endOffset, ref.startOffset + offset + segLen),
  };
};

/** Queries for Allocation usage */
const allocationQueries = {
  ...usageQueries,
  resolvedSource: (db: QueryDB, self: SymbolEntry) => {
    const refs = db.childrenOf(self.id).filter((c) => c.kind === "Reference");
    if (refs.length >= 2) {
      const sourceName = getAllocationEndpointName(db, refs[0]!);
      if (sourceName) {
        const resolved = resolveFeatureInScope(db, self.parentId, sourceName);
        if (resolved) return resolved;
      }
    }
    return null;
  },
  resolvedTarget: (db: QueryDB, self: SymbolEntry) => {
    const refs = db.childrenOf(self.id).filter((c) => c.kind === "Reference");
    if (refs.length >= 2) {
      const targetName = getAllocationEndpointName(db, refs[1]!);
      if (targetName) {
        const resolved = resolveFeatureInScope(db, self.parentId, targetName);
        if (resolved) return resolved;
      }
    }
    return null;
  },
};

/** Lint rules for AllocationUsage */
const allocationLints = {
  ...usageLints,
  allocationTargetUnresolved: (db: QueryDB, self: SymbolEntry) => {
    const refs = db.childrenOf(self.id).filter((c) => c.kind === "Reference");
    if (refs.length >= 2) {
      const targetRef = refs[1]!;
      const targetName = getAllocationEndpointName(db, targetRef);
      if (!targetName) return null;
      const resolved = resolveFeatureInScope(db, self.parentId, targetName);
      if (!resolved) {
        const range = getUnresolvedFeatureRange(db, self.parentId, targetRef, targetName);
        return error(SysML2ErrorCode.ALLOCATION_TARGET_UNRESOLVED.message(targetName), {
          code: SysML2ErrorCode.ALLOCATION_TARGET_UNRESOLVED.code,
          field: "declaredName",
          startOffset: range.startOffset,
          endOffset: range.endOffset,
        });
      }
    }
    return null;
  },
  allocationSourceUnresolved: (db: QueryDB, self: SymbolEntry) => {
    const refs = db.childrenOf(self.id).filter((c) => c.kind === "Reference");
    if (refs.length >= 2) {
      const sourceRef = refs[0]!;
      const sourceName = getAllocationEndpointName(db, sourceRef);
      if (!sourceName) return null;
      const resolved = resolveFeatureInScope(db, self.parentId, sourceName);
      if (!resolved) {
        const range = getUnresolvedFeatureRange(db, self.parentId, sourceRef, sourceName);
        return error(SysML2ErrorCode.ALLOCATION_SOURCE_UNRESOLVED.message(sourceName), {
          code: SysML2ErrorCode.ALLOCATION_SOURCE_UNRESOLVED.code,
          field: "declaredName",
          startOffset: range.startOffset,
          endOffset: range.endOffset,
        });
      }
    }
    return null;
  },
  portInterfaceMismatch: (db: QueryDB, self: SymbolEntry) => {
    const refs = db.childrenOf(self.id).filter((c) => c.kind === "Reference");
    if (refs.length >= 2) {
      const sourceName = getAllocationEndpointName(db, refs[0]!);
      const targetName = getAllocationEndpointName(db, refs[1]!);
      const sourceEntry = resolveFeatureInScope(db, self.parentId, sourceName);
      const targetEntry = resolveFeatureInScope(db, self.parentId, targetName);
      if (sourceEntry && targetEntry) {
        const sourceType = resolveTypeOf(db, sourceEntry);
        const targetType = resolveTypeOf(db, targetEntry);
        if (sourceType && targetType) {
          const sourceDim = resolveTypeDimension(db, sourceType);
          const targetDim = resolveTypeDimension(db, targetType);
          if (
            sourceDim &&
            targetDim &&
            !isDimensionless(sourceDim) &&
            !isDimensionless(targetDim) &&
            !areDimensionsEqual(sourceDim, targetDim)
          ) {
            return error(
              SysML2ErrorCode.DIMENSIONAL_CONNECTION_MISMATCH.message(
                sourceName,
                getDimensionLabel(sourceDim),
                targetName,
                getDimensionLabel(targetDim),
              ),
              {
                code: SysML2ErrorCode.DIMENSIONAL_CONNECTION_MISMATCH.code,
                startOffset: self.startOffset,
                endOffset: self.endOffset,
              },
            );
          }
        }
      }
    }
    return null;
  },
};

/** Lint rules for ConnectionUsage and BindingConnectorAsUsage */
const connectionLints = {
  ...usageLints,
  connectionDimensionalConsistency: (db: QueryDB, self: SymbolEntry) => {
    const refs = db.childrenOf(self.id).filter((c) => c.kind === "Reference");
    if (refs.length >= 2) {
      const sourceName = getAllocationEndpointName(db, refs[0]!);
      const targetName = getAllocationEndpointName(db, refs[1]!);
      const sourceEntry = resolveFeatureInScope(db, self.parentId, sourceName);
      const targetEntry = resolveFeatureInScope(db, self.parentId, targetName);
      if (sourceEntry && targetEntry) {
        const sourceType = resolveTypeOf(db, sourceEntry);
        const targetType = resolveTypeOf(db, targetEntry);
        if (sourceType && targetType) {
          const sourceDim = resolveTypeDimension(db, sourceType);
          const targetDim = resolveTypeDimension(db, targetType);
          if (
            sourceDim &&
            targetDim &&
            !isDimensionless(sourceDim) &&
            !isDimensionless(targetDim) &&
            !areDimensionsEqual(sourceDim, targetDim)
          ) {
            return error(
              SysML2ErrorCode.DIMENSIONAL_CONNECTION_MISMATCH.message(
                sourceName,
                getDimensionLabel(sourceDim),
                targetName,
                getDimensionLabel(targetDim),
              ),
              {
                code: SysML2ErrorCode.DIMENSIONAL_CONNECTION_MISMATCH.code,
                startOffset: self.startOffset,
                endOffset: self.endOffset,
              },
            );
          }
        }
      }
    }
    return null;
  },
  connectionTypeCompatibility: (db: QueryDB, self: SymbolEntry) => checkConnectionTypeCompatibility(db, self),
  interfaceContract: (db: QueryDB, self: SymbolEntry) => {
    const res = verifyAllInterfaceContracts(db, self.id);
    if (!res.isSatisfied && res.violations.length > 0) {
      const v = res.violations[0]!;
      const connName = self.name && self.name !== "<anonymous>" ? self.name : v.connectionName || "<anonymous>";
      return error(SysML2ErrorCode.INTERFACE_CONTRACT_BROKEN.message(connName, v.reason), {
        code: SysML2ErrorCode.INTERFACE_CONTRACT_BROKEN.code,
        startOffset: self.startOffset,
        endOffset: self.endOffset,
      });
    }
    return null;
  },
};

/** Lint rules for VerifyRequirementUsage */
const verifyRequirementLints = {
  verifyTargetNotRequirement: (db: QueryDB, self: SymbolEntry) => {
    const targetName = getRelationshipTargetName(db, self);
    if (!targetName || targetName === self.ruleName) return null;
    const targets = db.byName(targetName);
    const reqTarget = targets.find((t) => t.ruleName === "RequirementDefinition" || t.ruleName === "RequirementUsage");
    if (targets.length > 0 && !reqTarget) {
      return error(SysML2ErrorCode.VERIFY_TARGET_NOT_A_REQUIREMENT.message(targetName), {
        code: SysML2ErrorCode.VERIFY_TARGET_NOT_A_REQUIREMENT.code,
        field: "declaredName",
      });
    }
    return null;
  },
};

/** Lint rules for ActionDefinition and ActionUsage: Activity CFA, Definite Assignment, Soundness, Decision Tables & BMC */
const actionCommonLints = {
  activitySoundness: (db: QueryDB, self: SymbolEntry) => {
    const children = db.childrenOf(self.id);
    const hasActivityMembers = children.some(
      (c) =>
        c.ruleName === "ActionUsage" ||
        c.ruleName === "PerformActionUsage" ||
        c.ruleName === "AcceptActionNode" ||
        c.ruleName === "SendActionNode" ||
        c.ruleName === "AssignActionNode" ||
        c.ruleName === "DecisionNode" ||
        c.ruleName === "MergeNode" ||
        c.ruleName === "ForkNode" ||
        c.ruleName === "JoinNode" ||
        c.ruleName === "SuccessionAsUsage" ||
        c.ruleName === "SuccessionFlowUsage" ||
        c.ruleName === "FlowUsage",
    );
    if (!hasActivityMembers) return null;
    const res = checkActivitySoundnessForSymbol(db, self);
    if (res.diagnostics.length > 0) {
      const results = res.diagnostics.map((d) => {
        const code =
          d.rule === "unreachable-action"
            ? SysML2ErrorCode.ACTIVITY_CFA_UNREACHABLE.code
            : d.rule === "use-before-def" || d.rule === "definite-output-assignment"
              ? SysML2ErrorCode.DEFINITE_ASSIGNMENT_VIOLATION.code
              : SysML2ErrorCode.ACTIVITY_SOUNDNESS_VIOLATION.code;
        const emitFn = d.severity === "warning" ? warning : error;
        return emitFn(d.message, {
          code,
          startOffset: d.startOffset ?? self.startOffset,
          endOffset: d.endOffset ?? self.endOffset,
        });
      });
      return results.length === 1 ? results[0]! : results;
    }
    return null;
  },
  interproceduralContracts: (db: QueryDB, self: SymbolEntry) => {
    const text = db.cstText(self.startOffset, self.endOffset, self) || "";
    if (/\b(?:perform|:\s*[A-Za-z_])/.test(text)) {
      const res = analyzeInterproceduralCfa(db, self.name);
      const localRules = new Set([
        "unreachable-action",
        "use-before-def",
        "definite-output-assignment",
        "join-decide-deadlock",
        "unbound-action-input",
      ]);
      const childNames = new Set(
        db
          .childrenOf(self.id)
          .map((c) => c.name)
          .filter(Boolean),
      );
      const myErr = res.diagnostics.find(
        (d) =>
          !localRules.has(d.rule) &&
          (d.nodeName === self.name ||
            childNames.has(d.nodeName) ||
            (d.startOffset !== undefined &&
              d.startOffset >= self.startOffset &&
              (d.endOffset ?? d.startOffset) <= self.endOffset)),
      );
      if (myErr) {
        const emitFn = myErr.severity === "warning" ? warning : error;
        return emitFn(myErr.message, {
          code: SysML2ErrorCode.INTERPROCEDURAL_CONTRACT_VIOLATION.code,
          startOffset: myErr.startOffset ?? self.startOffset,
          endOffset: myErr.endOffset ?? self.endOffset,
        });
      }
    }
    return null;
  },
  loopTermination: (db: QueryDB, self: SymbolEntry) => {
    const text = db.cstText(self.startOffset, self.endOffset, self) || "";
    const whileMatch = /\bwhile\s*(?:\(([^)]+)\)|([^{]+?))\s*\{/.exec(text);
    if (whileMatch) {
      const cond = (whileMatch[1] ?? whileMatch[2] ?? "").trim();
      const openBrace = text.indexOf("{", whileMatch.index);
      const closeBrace = text.lastIndexOf("}");
      const body = openBrace !== -1 && closeBrace > openBrace ? text.slice(openBrace + 1, closeBrace) : "";
      const loopRes = LoopInvariantAnalyzer.analyzeLoop({ condition: cond, body });
      if (!loopRes.isTerminating && loopRes.diagnostics.length > 0) {
        const firstErr = loopRes.diagnostics[0]!;
        return warning(firstErr.message, {
          code: SysML2ErrorCode.LOOP_NON_TERMINATING.code,
          startOffset: self.startOffset + whileMatch.index,
          endOffset: self.endOffset,
        });
      }
    }
    return null;
  },
  decisionTableExhaustiveness: (db: QueryDB, self: SymbolEntry) => {
    const hasDecisions = db.childrenOf(self.id).some((c) => c.ruleName === "DecisionNode");
    const text = db.cstText(self.startOffset, self.endOffset, self) || "";
    if (!hasDecisions && !/\bdecide\b/.test(text)) return null;

    let dtMap = DecisionTableVerifier.verifyAllDecisionsInDb(db, self);
    if (dtMap.size === 0 && /\bdecide\b/.test(text)) {
      dtMap = DecisionTableVerifier.verifyAllDecisionsFromText(text);
    }
    const results: LintResult[] = [];
    for (const [decideName, dtRes] of dtMap) {
      if (!dtRes.isDeterministic && dtRes.overlappingBranches.length > 0) {
        const pairStr = dtRes.overlappingBranches.map((o) => `'${o.branchA}' and '${o.branchB}'`).join(", ");
        results.push(
          error(SysML2ErrorCode.DECISION_TABLE_NONDETERMINISTIC.message(decideName, pairStr), {
            code: SysML2ErrorCode.DECISION_TABLE_NONDETERMINISTIC.code,
            startOffset: self.startOffset,
            endOffset: self.endOffset,
          }),
        );
      }
      if (dtRes.hasDeadBranches && dtRes.deadBranches.length > 0) {
        results.push(
          warning(SysML2ErrorCode.DECISION_TABLE_DEAD_BRANCH.message(decideName, dtRes.deadBranches.join(", ")), {
            code: SysML2ErrorCode.DECISION_TABLE_DEAD_BRANCH.code,
            startOffset: self.startOffset,
            endOffset: self.endOffset,
          }),
        );
      }
      if (!dtRes.isExhaustive) {
        results.push(
          warning(
            SysML2ErrorCode.DECISION_TABLE_NON_EXHAUSTIVE.message(
              decideName,
              dtRes.suggestedFixCondition || dtRes.summary,
            ),
            {
              code: SysML2ErrorCode.DECISION_TABLE_NON_EXHAUSTIVE.code,
              startOffset: self.startOffset,
              endOffset: self.endOffset,
            },
          ),
        );
      }
    }
    if (results.length === 0) return null;
    return results.length === 1 ? results[0]! : results;
  },
  activitySafetyVerification: (db: QueryDB, self: SymbolEntry) => {
    const text = db.cstText(self.startOffset, self.endOffset, self) || "";
    if (!text || (!text.includes("hazard") && !text.includes("error") && !text.includes("assert"))) {
      return null;
    }
    const invariant = extractActivityInvariants(text);
    const hasForbidden = (invariant.forbiddenNodes?.length ?? 0) > 0;
    const hasMutex = (invariant.mutuallyExclusiveNodes?.length ?? 0) > 0;
    if (!hasForbidden && !hasMutex && invariant.maxTokenCapacity === undefined) return null;
    const res = SysML2ActivityVerifier.verify(text);
    if (!res.isCertified && res.bmcResult?.violation) {
      return error(res.summary, {
        code: SysML2ErrorCode.ACTIVITY_SAFETY_VIOLATION.code,
        startOffset: self.startOffset,
        endOffset: self.endOffset,
      });
    }
    return null;
  },
};

const actionDefinitionLints = {
  ...definitionLints,
  ...actionCommonLints,
};

const actionUsageLints = {
  ...usageLints,
  ...actionCommonLints,
};

// ---------------------------------------------------------------------------
// RequirementUsage — promoted model and queries
// ---------------------------------------------------------------------------

/** Model config for RequirementUsage (promoted from generic UsageNode) */
const requirementUsageModel = {
  name: "RequirementUsageNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...usageModel.properties,
  },
  queryTypes: {
    ...usageModel.queryTypes,
    subject: "UsageNode | null" as const,
    assumeConstraints: "SemanticNode[]" as const,
    requireConstraints: "SemanticNode[]" as const,
    isSatisfied: "boolean" as const,
    satisfiedBy: "SemanticNode[]" as const,
    isVerified: "boolean" as const,
    verifiedBy: "SemanticNode[]" as const,
    verificationStatus: "string" as const,
    constraintsMet: "boolean | null" as const,
  },
};

/** Queries for RequirementUsage (promoted) */
const requirementUsageQueries = {
  ...usageQueries,
  subject: requirementQueries.subject,
  assumeConstraints: requirementQueries.assumeConstraints,
  requireConstraints: requirementQueries.requireConstraints,
  ...requirementSatisfactionQueries,
};

// ---------------------------------------------------------------------------
// SatisfyRequirementUsage — dedicated model and queries
// ---------------------------------------------------------------------------

/** Model config for SatisfyRequirementUsage */
const satisfyRequirementModel = {
  name: "SatisfyRequirementNode" as const,
  visitable: true,
  properties: {
    ...usageModel.properties,
    isNegated: "boolean" as const,
  },
  queryTypes: {
    ...usageModel.queryTypes,
    satisfiedRequirement: "SemanticNode | null" as const,
    satisfyingSubject: "UsageNode | null" as const,
  },
};

/** Queries for SatisfyRequirementUsage */
const satisfyRequirementQueries = {
  ...usageQueries,
  satisfiedRequirement: (db: QueryDB, self: SymbolEntry) => {
    // The satisfy references a requirement via OwnedReferenceSubsetting or name
    if (!self.name) return null;
    const targets = db.byName(self.name);
    return targets.find((t) => t.ruleName === "RequirementDefinition" || t.ruleName === "RequirementUsage") ?? null;
  },
  satisfyingSubject: (db: QueryDB, self: SymbolEntry) => {
    for (const c of db.childrenOf(self.id)) {
      if (c.ruleName === "SubjectUsage") return c;
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Requirement structural lint (enhancement)
// ---------------------------------------------------------------------------

const requirementStructuralLints = {
  requirementWithoutConstraint: (db: QueryDB, self: SymbolEntry) => {
    if (metaStr(self, "isAbstract") === "true") return null;
    const assumes = db
      .childrenOf(self.id)
      .filter((c) => c.ruleName === "RequirementConstraintUsage" && metaStr(c, "constraintKind") === "assume");
    const requires = db
      .childrenOf(self.id)
      .filter((c) => c.ruleName === "RequirementConstraintUsage" && metaStr(c, "constraintKind") === "require");
    if (assumes.length === 0 && requires.length === 0 && self.name) {
      return info(`Requirement '${self.name}' has no assume or require constraints`, {
        code: SysML2ErrorCode.REQUIREMENT_WITHOUT_CONSTRAINT.code,
        field: "declaredName",
      });
    }
    return null;
  },
};

// Re-compose requirement lints with structural checks
const requirementDefinitionLintsEnhanced = {
  ...definitionLints,
  ...requirementLints,
  ...requirementStructuralLints,
};

const requirementUsageLintsEnhanced = {
  ...usageLints,
  ...requirementLints,
  ...requirementStructuralLints,
};

import { TableauReasoner } from "@modelscript/runtime";
import { verifyAllInterfaceContracts } from "./contract-verifier.js";
import { checkRequirementConsistency } from "./smt-bridge.js";
import { verifyAllStateMachineTransitions } from "./state-machine-verifier.js";

// ---------------------------------------------------------------------------
// Package-level traceability queries
// ---------------------------------------------------------------------------

/** Walk all descendants to find requirement/verification symbols */
const collectDescendants = (db: QueryDB, parentId: number, ruleNames: string[]): SymbolEntry[] => {
  const results: SymbolEntry[] = [];
  const walk = (id: number) => {
    for (const c of db.childrenOf(id)) {
      if (ruleNames.includes(c.ruleName)) results.push(c);
      if (c.kind === "Package" || c.kind === "Definition") walk(c.id);
    }
  };
  walk(parentId);
  return results;
};

interface TaxonomyEntry {
  iri?: string | undefined;
  directSuperClasses?: Iterable<string> | undefined;
  allSuperClasses?: Iterable<string> | undefined;
}

const traceabilityQueries = {
  allRequirements: (db: QueryDB, self: SymbolEntry) =>
    collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]),
  satisfiedRequirements: (db: QueryDB, self: SymbolEntry) => {
    const satisfies = collectDescendants(db, self.id, ["SatisfyRequirementUsage"]);
    const satisfiedNames = new Set(satisfies.map((s) => s.name).filter(Boolean));
    return collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]).filter(
      (r) => r.name && satisfiedNames.has(r.name),
    );
  },
  unsatisfiedRequirements: (db: QueryDB, self: SymbolEntry) => {
    const satisfies = collectDescendants(db, self.id, ["SatisfyRequirementUsage"]);
    const satisfiedNames = new Set(satisfies.map((s) => s.name).filter(Boolean));
    return collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]).filter(
      (r) => r.name && !satisfiedNames.has(r.name),
    );
  },
  verifiedRequirements: (db: QueryDB, self: SymbolEntry) => {
    const verifies = collectDescendants(db, self.id, ["VerifyRequirementUsage"]);
    const verifiedNames = new Set(verifies.map((v) => v.name).filter(Boolean));
    return collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]).filter(
      (r) => r.name && verifiedNames.has(r.name),
    );
  },
  unverifiedRequirements: (db: QueryDB, self: SymbolEntry) => {
    const verifies = collectDescendants(db, self.id, ["VerifyRequirementUsage"]);
    const verifiedNames = new Set(verifies.map((v) => v.name).filter(Boolean));
    return collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]).filter(
      (r) => r.name && !verifiedNames.has(r.name) && metaStr(r, "isAbstract") !== "true",
    );
  },
  inferredTaxonomy: (db: QueryDB, self: SymbolEntry) => {
    const axioms = emitAxioms(db, self) as Parameters<TableauReasoner["loadOntology"]>[0];
    // Instantiate a stateless fast reasoner for this query
    const reasoner = new TableauReasoner();
    // Bypass async init() by loading ontology directly; TableauReasoner init() does nothing for sync operations
    reasoner.loadOntology(axioms);
    reasoner.classify();
    return reasoner.getTaxonomy();
  },
  inferredSuperClasses: (db: QueryDB, self: SymbolEntry) => {
    // Traverse up to find the root package
    let rootId = self.id;
    let curr = self;
    while (curr && curr.parentId !== null) {
      rootId = curr.parentId;
      curr = db.symbol(curr.parentId)!;
    }
    const taxonomy = db.query<TaxonomyEntry[] | Map<string, TaxonomyEntry> | undefined>("inferredTaxonomy", rootId);
    const iri = `sysml:${self.name || `anon_${self.id}`}`;
    const node = Array.isArray(taxonomy)
      ? taxonomy.find((n: TaxonomyEntry) => n.iri === iri)
      : taxonomy?.get
        ? taxonomy.get(iri)
        : undefined;
    if (!node) return [];

    // Convert IRI back to SysML names by stripping "sysml:"
    const supers = node.directSuperClasses || node.allSuperClasses || [];
    return Array.from<string>(supers)
      .filter((superIri: string) => superIri !== "owl:Thing" && superIri !== iri)
      .map((superIri: string) => superIri.replace("sysml:", ""));
  },
};

/** Extended package queries with traceability */
const packageTraceabilityQueries = {
  ...namespaceQueries,
  ...traceabilityQueries,
  emitAxioms,
  inferredTaxonomy: traceabilityQueries.inferredTaxonomy,
  inferredSuperClasses: traceabilityQueries.inferredSuperClasses,
};

/** Extended package model with traceability query types */
const packageTraceabilityModel = {
  name: "PackageNode" as const,
  visitable: true,
  properties: { isLibrary: "boolean" as const, isStandard: "boolean" as const },
  queryTypes: {
    ...packageModel.queryTypes,
    allRequirements: "SemanticNode[]" as const,
    satisfiedRequirements: "SemanticNode[]" as const,
    unsatisfiedRequirements: "SemanticNode[]" as const,
    verifiedRequirements: "SemanticNode[]" as const,
    unverifiedRequirements: "SemanticNode[]" as const,
    emitAxioms: "OntologyAxiom[]" as const,
    inferredTaxonomy: "TaxonomyEntry[]" as const,
    inferredSuperClasses: "string[]" as const,
  },
};

/** Package lints with traceability gap detection */
const packageTraceabilityLints = {
  packageNaming: (_db: QueryDB, self: SymbolEntry) => {
    if (self.name && /^[a-z]/.test(self.name)) {
      return warning(SysML2ErrorCode.PACKAGE_NAMING.message(self.name), {
        code: SysML2ErrorCode.PACKAGE_NAMING.code,
        field: "declaredName",
      });
    }
    return null;
  },
  duplicateFeatureName: (db: QueryDB, self: SymbolEntry) => definitionLints.duplicateFeatureName(db, self),
  emptyPackage: (db: QueryDB, self: SymbolEntry) => {
    if (db.childrenOf(self.id).length === 0) {
      return info(SysML2ErrorCode.EMPTY_PACKAGE.message(self.name), {
        code: SysML2ErrorCode.EMPTY_PACKAGE.code,
        field: "declaredName",
      });
    }
    return null;
  },
  unverifiedRequirement: (db: QueryDB, self: SymbolEntry) => {
    const verifies = collectDescendants(db, self.id, ["VerifyRequirementUsage"]);
    const verifiedNames = new Set(verifies.map((v) => v.name).filter(Boolean));
    const unverified = collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]).filter(
      (r) => r.name && !verifiedNames.has(r.name) && metaStr(r, "isAbstract") !== "true",
    );
    if (unverified.length > 0) {
      const names = unverified.map((r) => r.name).join(", ");
      return warning(`Package '${self.name}' has unverified requirements: ${names}`, {
        code: SysML2ErrorCode.UNVERIFIED_REQUIREMENT.code,
        field: "declaredName",
      });
    }
    return null;
  },
  ontologicalInconsistency: (db: QueryDB, self: SymbolEntry) => {
    const axioms = emitAxioms(db, self);
    if (!axioms || axioms.length === 0) return null;
    const reasoner = new TableauReasoner();
    reasoner.loadOntology(axioms);
    reasoner.classify();
    const consistency = reasoner.checkConsistency();
    if (!consistency.isConsistent) {
      const core = consistency.minimalConflictCore;
      const detail =
        core && core.length > 0
          ? `: conflicting axioms [${core.map((a: { type?: string | undefined }) => a.type).join(", ")}]`
          : "";
      return error(SysML2ErrorCode.ONTOLOGICAL_INCONSISTENCY.message(self.name || "package", detail), {
        code: SysML2ErrorCode.ONTOLOGICAL_INCONSISTENCY.code,
        field: "declaredName",
      });
    }
    return null;
  },
  conflictingRequirements: (db: QueryDB, self: SymbolEntry) => {
    const smtResult = checkRequirementConsistency(db, self.name);
    if (!smtResult.isConsistent) {
      const coreNames =
        smtResult.conflictingRequirements.length > 0 ? ` (${smtResult.conflictingRequirements.join(", ")})` : "";
      return error(
        `Conflicting requirements detected in '${self.name || "package"}'${coreNames}: ${smtResult.violatedConstraints[0]?.reason || "unsatisfiable constraints"}`,
        {
          code: SysML2ErrorCode.CONFLICTING_REQUIREMENTS.code,
          field: "declaredName",
        },
      );
    }
    return null;
  },
  stateMachineDeterminism: (db: QueryDB, self: SymbolEntry) => {
    const smResult = verifyAllStateMachineTransitions(db, self.name);
    if (!smResult.isDeterministic && smResult.diagnostics.length > 0) {
      const diag = smResult.diagnostics.find((d) => d.type === "nondeterminism");
      if (diag) {
        return error(diag.message, {
          code: SysML2ErrorCode.STATEMACHINE_NONDETERMINISTIC.code,
          field: "declaredName",
        });
      }
    }
    if (!smResult.isComplete && smResult.diagnostics.length > 0) {
      const diag = smResult.diagnostics.find((d) => d.type === "deadlock");
      if (diag) {
        return warning(diag.message, {
          code: SysML2ErrorCode.STATEMACHINE_DEADLOCK.code,
          field: "declaredName",
        });
      }
    }
    return null;
  },
};

/** Lint rules for Import declarations */
const importLints = {
  unresolvedImport: (db: QueryDB, self: SymbolEntry) => checkImportResolution(db, self),
};

/** Lint rules for EnumeratedValue declarations */
const enumValueLints = {
  ...usageLints,
  duplicateEnumValue: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name || self.parentId == null) return null;
    const siblings = db
      .childrenOf(self.parentId)
      .filter((c) => c.ruleName === "EnumeratedValue" && c.name === self.name);
    if (siblings.length > 1 && siblings[0]?.id !== self.id) {
      const parentSym = db.symbol(self.parentId);
      return warning(SysML2ErrorCode.DUPLICATE_MEMBER.message(self.name, parentSym?.name || "enum"), {
        code: SysML2ErrorCode.DUPLICATE_MEMBER.code,
        field: "declaredName",
      });
    }
    return null;
  },
};

/** Lint rules for StateDefinition and StateUsage */
const stateMachineCommonLints = {
  stateMachineDeterminism: (db: QueryDB, self: SymbolEntry) => {
    const hasTransitions = db.childrenOf(self.id).some((c) => c.ruleName === "TransitionUsage");
    if (!hasTransitions) return null;
    const smResult = verifyAllStateMachineTransitions(db, self.name);
    const results: LintResult[] = [];
    for (const diag of smResult.diagnostics) {
      if (diag.type === "nondeterminism") {
        results.push(
          error(diag.message, {
            code: SysML2ErrorCode.STATEMACHINE_NONDETERMINISTIC.code,
            field: "declaredName",
            startOffset: self.startOffset,
            endOffset: self.endOffset,
          }),
        );
      } else if (diag.type === "deadlock") {
        results.push(
          warning(diag.message, {
            code: SysML2ErrorCode.STATEMACHINE_DEADLOCK.code,
            field: "declaredName",
            startOffset: self.startOffset,
            endOffset: self.endOffset,
          }),
        );
      }
    }
    if (results.length === 0) return null;
    return results.length === 1 ? results[0]! : results;
  },
};

const stateDefinitionLints = {
  ...definitionLints,
  ...stateMachineCommonLints,
};

const stateUsageLints = {
  ...usageLints,
  ...stateMachineCommonLints,
};

/** Lint rules for TransitionUsage */
const transitionUsageLints = {
  ...usageLints,
  unresolvedTransitionState: (db: QueryDB, self: SymbolEntry) => {
    if (self.parentId == null) return null;
    const stateSiblings = db
      .childrenOf(self.parentId)
      .filter(
        (c) => c.ruleName === "StateUsage" || c.ruleName === "ExhibitStateUsage" || c.ruleName === "StateDefinition",
      );
    if (stateSiblings.length === 0) return null;
    const validStateNames = new Set(stateSiblings.map((s) => s.name).filter(Boolean));

    const text = db.cstText(self.startOffset, self.endOffset, self) || "";
    const firstMatch = /\bfirst\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(text);
    const thenMatch = /\bthen\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(text);

    for (const m of [firstMatch, thenMatch]) {
      const stateName = m?.[1]?.trim();
      if (stateName && !validStateNames.has(stateName) && !resolveFeatureInScope(db, self.parentId, stateName)) {
        return error(SysML2ErrorCode.UNRESOLVED_TRANSITION_STATE.message(stateName), {
          code: SysML2ErrorCode.UNRESOLVED_TRANSITION_STATE.code,
          startOffset: self.startOffset,
          endOffset: self.endOffset,
        });
      }
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// X6-Compatible Graphics Configuration — Reusable helpers
// ---------------------------------------------------------------------------

import type { GraphicsConfig } from "@modelscript/diagram";
import type { X6Markup } from "@modelscript/diagram/builder";

/** Standard SysML block-style node markup: header + separator + label */
const blockMarkup: X6Markup[] = [
  { tagName: "rect", selector: "body" },
  { tagName: "text", selector: "header" },
  { tagName: "line", selector: "separator" },
  { tagName: "text", selector: "label" },
];

/** Standard SysML block-style node markup with icon */
const blockMarkupWithIcon: X6Markup[] = [...blockMarkup, { tagName: "image", selector: "icon" }];

/** Minimal node markup for simpler nodes */
const simpleMarkup: X6Markup[] = [
  { tagName: "rect", selector: "body" },
  { tagName: "text", selector: "label" },
];

/** Minimal node markup with icon */
const simpleMarkupWithIcon: X6Markup[] = [...simpleMarkup, { tagName: "image", selector: "icon" }];

/** Create a SysML block-style node GraphicsConfig */
const sysmlNodeGraphics = (opts: {
  stereotype: string;
  fill: string;
  stroke: string;
  iconHref?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  portQuery?: string | undefined;
}): GraphicsConfig => ({
  role: "node",
  node: {
    shape: "rect",
    markup: opts.iconHref ? blockMarkupWithIcon : blockMarkup,
    attrs: {
      body: { fill: opts.fill, stroke: opts.stroke, strokeWidth: 1.5, rx: 6, ry: 6 },
      header: {
        text: `«${opts.stereotype.toLowerCase()}»`,
        fill: opts.stroke,
        fontSize: 10,
        fontStyle: "italic",
        textAnchor: "middle",
        refX: 0.5,
        refY: 14,
      },
      separator: { x1: 0, y1: 24, x2: "100%", y2: 24, stroke: opts.stroke, strokeWidth: 1 },
      label: {
        text: "{{name}}",
        fill: "#0f172a",
        fontSize: 13,
        fontWeight: "bold",
        textAnchor: "middle",
        refX: 0.5,
        refY: 40,
      },
      ...(opts.iconHref
        ? {
            icon: { href: opts.iconHref, width: 16, height: 16, x: 6, y: 4 },
          }
        : {}),
    },
    size: { width: opts.width ?? 180, height: opts.height ?? 60 },
    ports: {
      groups: {
        in: {
          position: "left",
          attrs: {
            portBody: { width: 10, height: 10, x: -5, y: -5, fill: "#ffffff", stroke: opts.stroke, strokeWidth: 1.5 },
            rect: { width: 10, height: 10, x: -5, y: -5, fill: "#ffffff", stroke: opts.stroke, strokeWidth: 1.5 },
            circle: { r: 5, fill: "#ffffff", stroke: opts.stroke, strokeWidth: 1.5 },
          },
          label: { position: { name: "left", args: { y: -10 } } },
        },
        out: {
          position: "right",
          attrs: {
            portBody: { width: 10, height: 10, x: -5, y: -5, fill: "#ffffff", stroke: opts.stroke, strokeWidth: 1.5 },
            rect: { width: 10, height: 10, x: -5, y: -5, fill: "#ffffff", stroke: opts.stroke, strokeWidth: 1.5 },
            circle: { r: 5, fill: "#ffffff", stroke: opts.stroke, strokeWidth: 1.5 },
          },
          label: { position: { name: "right", args: { y: -10 } } },
        },
      },
    },
    portQuery: opts.portQuery,
  },
});

/** Create a SysML usage-style node (lighter fill, dashed border) */
const sysmlUsageGraphics = (opts: {
  stereotype: string;
  fill: string;
  stroke: string;
  iconHref?: string | undefined;
}): GraphicsConfig => ({
  role: "node",
  node: {
    shape: "rect",
    markup: opts.iconHref ? simpleMarkupWithIcon : simpleMarkup,
    attrs: {
      body: { fill: opts.fill, stroke: opts.stroke, strokeWidth: 1.5, rx: 6, ry: 6, strokeDasharray: "6 3" },
      label: {
        text: "{{name}}",
        fill: "#0f172a",
        fontSize: 13,
        fontWeight: "bold",
        textAnchor: "middle",
        refX: 0.5,
        refY: 0.5,
      },
      ...(opts.iconHref
        ? {
            icon: { href: opts.iconHref, width: 16, height: 16, x: 6, y: 4 },
          }
        : {}),
    },
    size: { width: 140, height: 40 },
  },
});

/** Create a SysML package/group GraphicsConfig */
const sysmlGroupGraphics = (opts: { fill: string; stroke: string; tabText: string }): GraphicsConfig => ({
  role: "group",
  node: {
    shape: "rect",
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "rect", selector: "tab" },
      { tagName: "text", selector: "tabStereotype" },
      { tagName: "text", selector: "tabLabel" },
    ],
    attrs: {
      body: {
        fill: opts.fill,
        stroke: opts.stroke,
        strokeWidth: 1.5,
        rx: 6,
        ry: 6,
        refWidth: "100%",
        refHeight: "100%",
      },
      tab: {
        fill: "#f1f5f9",
        stroke: opts.stroke,
        strokeWidth: 1.5,
        rx: 4,
        ry: 4,
        x: 0,
        y: 0,
        width: 140,
        height: 32,
      },
      tabStereotype: {
        text: `«${opts.tabText}»`,
        fill: opts.stroke,
        fontSize: 9,
        fontStyle: "italic",
        refX: 10,
        refY: 6,
        textAnchor: "start",
        textVerticalAnchor: "top",
      },
      tabLabel: {
        text: "{{name}}",
        fill: "#0f172a",
        fontSize: 11,
        fontWeight: "bold",
        refX: 10,
        refY: 18,
        textAnchor: "start",
        textVerticalAnchor: "top",
      },
    },
    size: { width: 300, height: 200 },
  },
});

/** Create a SysML edge GraphicsConfig */
const sysmlEdgeGraphics = (opts: {
  label?: string | undefined;
  stroke?: string | undefined;
  strokeDasharray?: string | undefined;
  targetMarker?: string | number | Record<string, unknown> | undefined;
  router?: string | { name: string; args?: Record<string, unknown> | undefined } | undefined;
  connector?: string | { name: string; args?: Record<string, unknown> | undefined } | undefined;
}): GraphicsConfig => ({
  role: "edge",
  edge: {
    shape: "edge",
    attrs: {
      line: {
        stroke: opts.stroke ?? "#64748b",
        strokeWidth: 1.5,
        ...(opts.strokeDasharray ? { strokeDasharray: opts.strokeDasharray } : {}),
        targetMarker: opts.targetMarker ?? "classic",
      },
    },
    labels: opts.label
      ? [
          {
            attrs: {
              text: { text: opts.label, fill: "#334155", fontSize: 10, fontWeight: "500" },
              rect: {
                fill: "#ffffff",
                stroke: "#cbd5e1",
                strokeWidth: 1,
                rx: 4,
                ry: 4,
                refWidth: 12,
                refHeight: 6,
                refX: -6,
                refY: -3,
              },
            },
            position: { distance: 0.5, offset: -8 },
          },
        ]
      : undefined,
    router: opts.router ?? "port-orthogonal-astar",
    connector: opts.connector ?? "rounded",
  },
});

interface SysmlActionWorkspaceManager {
  globalSysml2QueryEngine?: { toQueryDB(): QueryDB } | undefined;
  getFileContent?: ((uri: string) => Promise<string> | string) | undefined;
}

interface SysmlActionContext {
  uri?: string | undefined;
  queryDB?: QueryDB | undefined;
  workspaceManager?: SysmlActionWorkspaceManager | undefined;
}

/**
 * Complete SysML v2 & KerML declarative language definition for ModelScript.
 *
 * Integrates the Xtext-derived GLR grammar, Salsa incremental semantic queries,
 * CST-based expression evaluation, multi-tier static and formal verification lints
 * (type/dimensional checking, Octagon DBM/Simplex requirement consistency, state-machine
 * determinism, OCRA contract verification, activity soundness, and OWL2 DL reasoning),
 * X6 diagram graphics, and polyglot Triple Graph Grammar (TGG) rules targeting Modelica,
 * OWL2, and ISO 10303 STEP.
 */
export const sysml2Language = language({
  name: "sysml2",
  displayName: "SysML v2",
  fileExtensions: [".sysml", ".sysml2", ".kerml"],
  maturity: "stable",

  lsp: {
    fileExtensions: [".sysml", ".sysml2", ".kerml"],
    icons: {
      light: "./assets/sysml2/icon-light.png",
      dark: "./assets/sysml2/icon-dark.png",
    },
  },

  writeback: sysml2Writeback,

  // Configure background SMT theories (Linear Real Arithmetic + Equality with Uninterpreted Functions)
  semantics: {
    reasoner: {
      smt: {
        theories: ["LRA", "EUF"],
        maxSimplexVars: 500,
      },
    } as unknown as { maxFacts?: number | undefined },
  },

  // Relational Octagon abstract domain (±x ± y <= c) for static interval and difference bound analysis
  domains: {
    bounds: domain.octagon(),
  },

  // Control-flow graph (CFG) node descriptors for activity and state-machine static analysis
  cfgNodes: {
    IfNode: {
      condition: "condition",
      trueBranch: "thenBody",
      falseBranch: "elseBody",
    },
    WhileLoopNode: {
      condition: "condition",
      trueBranch: "ActionBodyParameter",
      isLoop: true,
    },
    TransitionUsage: {
      condition: "guard",
      trueBranch: "effect",
    },
  },

  actions: [
    {
      id: "open_requirements_matrix",
      title: "Open Requirements Matrix",
      description: "Opens the visual SysML v2 Requirements Verification & Traceability matrix editor.",
      category: "query",
      inputs: {
        partName: { type: "string", description: "Part name to inspect" },
      },
      ui: {
        editorTitle: {
          icon: "$(checklist)",
          group: "navigation@1",
        },
        editorContextMenu: {
          group: "1_run@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "sysml2_open_requirements_matrix",
          displayName: "Open SysML v2 Requirements Matrix",
          modelDescription: "Opens the visual SysML v2 Requirements Verification & Traceability matrix editor.",
        },
      },
    },
    {
      id: "extract_topology",
      title: "Extract Part Topology",
      description: "Extracts physical connection and port topology from a SysML v2 part definition.",
      category: "query",
      inputs: {
        name: { type: "string", description: "Fully qualified part name" },
      },
      ui: {
        editorTitle: {
          icon: "$(type-hierarchy)",
          group: "navigation@2",
        },
        editorContextMenu: {
          group: "3_analysis@0",
        },
        languageModelTool: {
          name: "sysml2_extract_topology",
          displayName: "Extract SysML v2 Part Topology",
          modelDescription: "Extracts physical connection and port topology from a SysML v2 part definition.",
        },
      },
    },
    {
      id: "verify_requirements",
      title: "Verify Requirements",
      description: "Evaluates requirement satisfaction matrices and constraint checks across a SysML v2 model.",
      category: "verify",
      inputs: {
        partName: { type: "string", description: "Part name to verify" },
      },
      execute: async (ctx: SysmlActionContext, params: { partName?: string | undefined }) => {
        const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
        if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
        const { checkRequirementConsistency } = await import("./smt-bridge.js");
        return checkRequirementConsistency(queryDB, params?.partName);
      },
      ui: {
        editorTitle: {
          icon: "$(checklist)",
          group: "navigation@1",
        },
        editorContextMenu: {
          group: "1_run@1",
        },
        explorerContextMenu: {
          group: "modelscript_run@1",
        },
        languageModelTool: {
          name: "sysml2_verify_requirements",
          displayName: "Verify SysML v2 Requirements",
          modelDescription:
            "Evaluates requirement satisfaction matrices and constraint checks across a SysML v2 model.",
        },
      },
    },
    {
      id: "verify_state_machine",
      title: "Verify State Machine Determinism",
      description: "Verifies that state machine transition guards are mutually exclusive and collectively exhaustive.",
      category: "verify",
      inputs: {
        stateName: { type: "string", description: "State or package name to verify" },
      },
      execute: async (ctx: SysmlActionContext, params: { stateName?: string | undefined }) => {
        const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
        if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
        const { verifyAllStateMachineTransitions } = await import("./state-machine-verifier.js");
        return verifyAllStateMachineTransitions(queryDB, params?.stateName);
      },
      ui: {
        editorTitle: {
          icon: "$(debug-rerun)",
          group: "navigation@1",
        },
        editorContextMenu: {
          group: "1_run@2",
        },
        languageModelTool: {
          name: "sysml2_verify_state_machine",
          displayName: "Verify SysML v2 State Machine",
          modelDescription: "Verifies state machine transition determinism and deadlock freedom.",
        },
      },
    },
    {
      id: "verify_contracts",
      title: "Verify Interface Contracts",
      description: "Verifies Assume-Guarantee interface contracts across component connections.",
      category: "verify",
      inputs: {
        connectionName: { type: "string", description: "Connection or package name to verify" },
      },
      execute: async (ctx: SysmlActionContext, params: { connectionName?: string | undefined }) => {
        const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
        if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
        const { verifyAllInterfaceContracts } = await import("./contract-verifier.js");
        return verifyAllInterfaceContracts(queryDB, params?.connectionName);
      },
      ui: {
        editorTitle: {
          icon: "$(check-all)",
          group: "navigation@1",
        },
        editorContextMenu: {
          group: "1_run@3",
        },
        languageModelTool: {
          name: "sysml2_verify_contracts",
          displayName: "Verify SysML v2 Interface Contracts",
          modelDescription: "Verifies Assume-Guarantee interface contracts across component connections.",
        },
      },
    },
    {
      id: "export_smtlib",
      title: "Export to SMT-LIB v2",
      description: "Serializes SysML v2 constraints and requirements into standard .smt2 formal benchmarks.",
      category: "export",
      inputs: {
        scope: { type: "string", description: "Target package or part scope" },
      },
      execute: async (ctx: SysmlActionContext, params: { scope?: string | undefined }) => {
        const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
        if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
        const { exportToSmtLib } = await import("./exporters/smtlib-exporter.js");
        return exportToSmtLib(queryDB, { scopeFilter: params?.scope });
      },
      ui: {
        editorContextMenu: {
          group: "2_transform@1",
        },
        explorerContextMenu: {
          group: "modelscript_convert@1",
        },
        languageModelTool: {
          name: "sysml2_export_smtlib",
          displayName: "Export SysML v2 to SMT-LIB v2",
          modelDescription: "Serializes SysML v2 constraints and requirements to SMT-LIB v2 (.smt2).",
        },
      },
    },
    {
      id: "export_nuxmv",
      title: "Export to nuXmv",
      description: "Serializes SysML v2 state machines into standard nuXmv (.smv) formal transition modules.",
      category: "export",
      inputs: {
        stateMachineName: { type: "string", description: "State machine name" },
      },
      execute: async (ctx: SysmlActionContext, params: { stateMachineName?: string | undefined }) => {
        const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
        if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
        const { exportToNuXmv } = await import("./exporters/nuxmv-exporter.js");
        return exportToNuXmv(queryDB, { stateMachineName: params?.stateMachineName });
      },
      ui: {
        editorContextMenu: {
          group: "2_transform@2",
        },
        explorerContextMenu: {
          group: "modelscript_convert@2",
        },
        languageModelTool: {
          name: "sysml2_export_nuxmv",
          displayName: "Export SysML v2 to nuXmv",
          modelDescription: "Serializes SysML v2 state machines to nuXmv (.smv).",
        },
      },
    },
    {
      id: "synthesize_fault_tree",
      title: "Synthesize Fault Tree (MCS)",
      description:
        "Performs automated safety analysis, synthesizes Minimal Cut Sets (MCS), and builds Fault Tree diagrams.",
      category: "verify",
      inputs: {
        hazardName: { type: "string", description: "Target hazard name or condition" },
        maxOrder: { type: "number", description: "Maximum cut set order to explore", default: 4 },
      },
      execute: async (
        ctx: SysmlActionContext,
        params: { hazardName?: string | undefined; maxOrder?: number | undefined },
      ) => {
        const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
        if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
        const { analyzeSafetyAndFaultTree } = await import("./safety-analyzer.js");
        return analyzeSafetyAndFaultTree(queryDB, {
          maxOrder: params?.maxOrder,
        });
      },
      ui: {
        editorTitle: {
          icon: "$(shield)",
          group: "navigation@2",
        },
        editorContextMenu: {
          group: "3_analysis@1",
        },
        languageModelTool: {
          name: "sysml2_synthesize_fault_tree",
          displayName: "Synthesize SysML v2 Fault Tree",
          modelDescription: "Synthesizes Minimal Cut Sets and fault tree diagrams from failure modes.",
        },
      },
    },
    {
      id: "verify_hybrid_flowpipe",
      title: "Verify Hybrid Flowpipe Reachability",
      description:
        "Computes guaranteed reachability tubes across hybrid continuous/discrete SysML v2 dynamics with guard root-finding and state resets.",
      category: "verify",
      inputs: {
        modelName: { type: "string", description: "Target system model or part name" },
        timeSpan: { type: "string", description: "Time horizon [t0, tEnd]", default: "[0, 5]" },
        dt: { type: "number", description: "Initial step size dt", default: 0.05 },
        order: { type: "number", description: "Taylor model polynomial order", default: 2 },
        adaptive: { type: "boolean", description: "Enable adaptive remainder step control", default: true },
        useQrPreconditioning: {
          type: "boolean",
          description: "Enable Householder QR coordinate rotations",
          default: true,
        },
      },
      execute: async (
        ctx: SysmlActionContext,
        params: {
          modelName?: string | undefined;
          timeSpan?: string | undefined;
          dt?: number | undefined;
          order?: number | undefined;
          adaptive?: boolean | undefined;
          useQrPreconditioning?: boolean | undefined;
        },
      ) => {
        const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
        if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
        const { verifyHybridSysml2Reachability } = await import("./hybrid-flowpipe-bridge.js");
        return verifyHybridSysml2Reachability(queryDB, params);
      },
      ui: {
        editorTitle: {
          icon: "$(graph-line)",
          group: "navigation@2",
        },
        editorContextMenu: {
          group: "1_run@4",
        },
        languageModelTool: {
          name: "sysml2_verify_hybrid_flowpipe",
          displayName: "Verify SysML v2 Hybrid Flowpipe Reachability",
          modelDescription:
            "Performs validated reachability analysis on continuous/discrete hybrid SysML v2 systems using Taylor models and QR preconditioning.",
        },
      },
    },
    {
      id: "hybrid_simulate",
      title: "Hybrid Simulation",
      description: "Flatten and simulate a hybrid SysML v2 / Modelica system.",
      category: "simulate",
      inputs: {
        name: { type: "string", description: "Fully qualified part/class name to simulate" },
        startTime: { type: "number", description: "Simulation start time", default: 0 },
        stopTime: { type: "number", description: "Simulation stop time", default: 10 },
      },
      execute: async (
        ctx: SysmlActionContext,
        params: {
          name?: string | undefined;
          startTime?: number | undefined;
          stopTime?: number | undefined;
          step?: number | undefined;
        },
      ) => {
        const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
        const { SysML2DaeLowerer } = await import("./sysml2-dae-lowerer.js");
        const { simulateArenaAsync } = await import("@modelscript/simulate");

        let sourceText = "";
        if (ctx.uri && ctx.workspaceManager?.getFileContent) {
          sourceText = await ctx.workspaceManager.getFileContent(ctx.uri);
        } else if (params?.name && queryDB) {
          const entry = queryDB
            .allEntries()
            .find((e): e is SymbolEntry & { source?: string | undefined } => e.name === params.name);
          if (entry?.source) sourceText = entry.source;
        }

        const lowered = await SysML2DaeLowerer.lowerAction(
          sourceText || (params?.name ? `action def ${params.name} {}` : "action def Sim {}"),
        );
        const startTime = params?.startTime ?? 0;
        const stopTime = params?.stopTime ?? 10;
        const step = params?.step ?? (stopTime > startTime ? (stopTime - startTime) / 100 : 0.1);
        const simResult = await simulateArenaAsync(lowered.arena, {
          startTime,
          stopTime,
          step,
        });

        return {
          name: lowered.name,
          times: simResult.t,
          states: simResult.states,
          y: simResult.y,
        };
      },
      ui: {
        editorContextMenu: {
          group: "1_run",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "sysml2_hybrid_simulate",
          displayName: "Simulate Hybrid SysML v2 / Modelica System",
          modelDescription: "Flatten and simulate a hybrid SysML v2 / Modelica system.",
        },
      },
    },
    {
      id: "verify_activity_soundness",
      title: "Verify Activity Soundness",
      description:
        "Verifies workflow soundness, deadlock freedom, and definite output assignment in SysML v2 activities.",
      category: "verify",
      inputs: {
        actionName: { type: "string", description: "Target action or activity name" },
      },
      execute: async (ctx: SysmlActionContext, params: { actionName?: string | undefined }) => {
        const queryDB = ctx.workspaceManager?.globalSysml2QueryEngine?.toQueryDB() || ctx.queryDB;
        if (!queryDB) throw new Error("SysML v2 query database is not initialized.");
        const { checkActivitySoundnessForSymbol } = await import("./activity-soundness.js");
        const actions = queryDB
          .allEntries()
          .filter(
            (e: SymbolEntry) =>
              (e.ruleName === "ActionDefinition" || e.ruleName === "ActionUsage") &&
              (!params?.actionName || e.name === params.actionName),
          );
        return actions.map((act: SymbolEntry) => checkActivitySoundnessForSymbol(queryDB, act));
      },
      ui: {
        editorTitle: {
          icon: "$(check-all)",
          group: "navigation@1",
        },
        editorContextMenu: {
          group: "1_run@5",
        },
        languageModelTool: {
          name: "sysml2_verify_activity_soundness",
          displayName: "Verify SysML v2 Activity Soundness",
          modelDescription:
            "Verifies workflow soundness, deadlock freedom, and definite output assignment in SysML v2 activities.",
        },
      },
    },
  ],

  mcp: {
    serverName: "sysml2-mcp",
    serverVersion: "1.0.0",
    tools: [
      {
        name: "sysml2_extract_topology",
        description: "Extracts physical connection and port topology from a SysML v2 part definition.",
        category: "ast",
        inputSchema: {
          name: { type: "string", description: "Fully qualified part name", required: true },
        },
      },
      {
        name: "sysml2_verify_requirements",
        description: "Evaluates requirement satisfaction matrices and constraint checks across a SysML v2 model.",
        category: "query",
        inputSchema: {
          partName: { type: "string", description: "Part name to verify", required: true },
        },
      },
      {
        name: "hybrid_simulate",
        description: "Flatten and simulate a hybrid SysML v2 / Modelica system.",
        category: "simulation",
        inputSchema: {
          name: { type: "string", description: "Fully qualified part/class name to simulate", required: true },
          paths: {
            type: "array",
            description: "Paths to load into UnifiedWorkspace",
            required: true,
            items: { type: "string" },
          },
          startTime: { type: "number", description: "Simulation start time", default: 0 },
          stopTime: { type: "number", description: "Simulation stop time", default: 10 },
        },
      },
    ],
    resources: [
      {
        uriTemplate: "sysml2://workspace/{partName}/topology",
        name: "SysML2 Topology Resource",
        mimeType: "application/json",
        description: "Directed port-connection topology graph of a SysML v2 part",
      },
    ],
    prompts: [
      {
        name: "sysml2_trace_requirements",
        description: "Trace requirements from high-level system requirements down to behavioral parts",
        arguments: [{ name: "requirementId", description: "Target requirement ID", required: true }],
        template: (args: Record<string, string>) => `Trace requirements from ${args["requirementId"]}`,
      },
    ],
  },

  primitives: {
    nestedComment: { open: "/*", close: "*/" },
    lineComment: "//",
  },

  extras: (_$) => [/\s/],

  conflicts: ($) => [
    [$["LiteralInteger"]!, $["RealValue"]!],
    [$["FeatureReferenceMember"]!, $["ElementReferenceMember"]!, $["OwnedFeatureChaining"]!],
    [$["Qualification"]!],
    [$["FeatureChainMember"]!, $["OwnedFeatureChaining"]!],
    [$["_FeatureChain"]!],
    [$["_postfix_operation"]!],
    [$["MeasurementExpression"]!, $["PrimaryExpression"]!],
    // All definition and usage rules share modifier keyword prefixes
    [
      $["DefaultReferenceUsage"]!,
      $["ReferenceUsage"]!,
      $["AttributeDefinition"]!,
      $["AttributeUsage"]!,
      $["EnumerationDefinition"]!,
      $["EnumerationUsage"]!,
      $["EnumeratedValue"]!,
      $["OccurrenceDefinition"]!,
      $["OccurrenceUsage"]!,
      $["ItemDefinition"]!,
      $["ItemUsage"]!,
      $["PartDefinition"]!,
      $["PartUsage"]!,
      $["PortDefinition"]!,
      $["PortUsage"]!,
      $["ConnectionDefinition"]!,
      $["ConnectionUsage"]!,
      $["InterfaceDefinition"]!,
      $["InterfaceUsage"]!,
      $["AllocationDefinition"]!,
      $["AllocationUsage"]!,
      $["FlowDefinition"]!,
      $["FlowUsage"]!,
      $["SuccessionFlowUsage"]!,
      $["BindingConnectorAsUsage"]!,
      $["SuccessionAsUsage"]!,
      $["ActionDefinition"]!,
      $["ActionUsage"]!,
      $["PerformActionUsage"]!,
      $["CalculationDefinition"]!,
      $["CalculationUsage"]!,
      $["ConstraintDefinition"]!,
      $["ConstraintUsage"]!,
      $["AssertConstraintUsage"]!,
      $["RequirementDefinition"]!,
      $["RequirementUsage"]!,
      $["SatisfyRequirementUsage"]!,
      $["ConcernDefinition"]!,
      $["ConcernUsage"]!,
      $["CaseDefinition"]!,
      $["CaseUsage"]!,
      $["AnalysisCaseDefinition"]!,
      $["AnalysisCaseUsage"]!,
      $["VerificationCaseDefinition"]!,
      $["VerificationCaseUsage"]!,
      $["UseCaseDefinition"]!,
      $["UseCaseUsage"]!,
      $["IncludeUseCaseUsage"]!,
      $["StateDefinition"]!,
      $["StateUsage"]!,
      $["ExhibitStateUsage"]!,
      $["ViewDefinition"]!,
      $["ViewUsage"]!,
      $["ViewpointDefinition"]!,
      $["ViewpointUsage"]!,
      $["RenderingDefinition"]!,
      $["RenderingUsage"]!,
      $["MetadataDefinition"]!,
      $["MergeNode"]!,
      $["DecisionNode"]!,
      $["JoinNode"]!,
      $["ForkNode"]!,
      $["AcceptActionNode"]!,
      $["SendActionNode"]!,
      $["AssignActionNode"]!,
      $["VerifyRequirementUsage"]!,
      $["ObjectiveRequirementUsage"]!,
    ],
    [$["_usage_modifier"]!, $["ReferenceUsage"]!],
    [$["PrefixMetadataAnnotation"]!, $["PrefixMetadataMember"]!],
    [$["OwnedReferenceSubsetting"]!, $["OwnedFeatureChaining"]!],
    [$["OwnedFeatureTyping"]!, $["OwnedFeatureChaining"]!],
    [$["OwnedSubsetting"]!, $["OwnedFeatureChaining"]!],
    [$["OwnedSubclassification"]!, $["OwnedSubsetting"]!, $["OwnedFeatureChaining"]!],
    [$["OwnedSubclassification"]!, $["OwnedFeatureChaining"]!],
    [$["OwnedRedefinition"]!, $["OwnedFeatureChaining"]!],
    [$["OwnedCrossSubsetting"]!, $["OwnedFeatureChaining"]!],
    [$["Qualification"]!, $["QualifiedName"]!],
    [$["_FeatureSpecializationPart"]!],
    [$["_SubclassificationPart"]!, $["_FeatureSpecializationPart"]!],
    [$["_SubclassificationPart"]!, $["_Subsettings"]!],
    [$["MetadataUsage"]!, $["ClassificationTestOperator"]!],
    [$["_Identification"]!, $["QualifiedName"]!],
    [$["_Identification"]!],
    [$["_ActionBody"]!, $["StateActionUsage"]!],
    [$["_ActionBodyItem"]!, $["_CalculationBody"]!],
    [$["FeatureReferenceMember"]!, $["InstantiatedTypeMember"]!],
    // GLR lookahead ambiguities whitelisted for SysML v2 grammar
    [$["_VisibilityIndicator"]!, $["_PrefixMetadataMember"]!],
    [$["_VisibilityIndicator"]!, $["_EmptySuccessionMember"]!, $["_PrefixMetadataMember"]!],
    [$["_VisibilityIndicator"]!, $["_EmptySuccessionMember"]!],
    [$["_VisibilityIndicator"]!, $["_PrefixMetadataAnnotation"]!],
    [$["_VisibilityIndicator"]!, $["ReferenceUsage"]!],
    [$["_VisibilityIndicator"]!, $["Comment"]!],
    [$["_VisibilityIndicator"]!, $["Documentation"]!],
    [$["_usage_modifier"]!, $["PrefixMetadataAnnotation"]!],
    [$["_usage_modifier"]!, $["_PrefixMetadataAnnotation"]!],
    [$["_usage_modifier"]!, $["GlobalQualification"]!],
    [$["_usage_modifier"]!, $["_GlobalQualification"]!],
    [$["_usage_modifier"]!, $["UnaryOperator"]!],
    [$["_usage_modifier"]!, $["MultiplicityRange"]!],
    [$["_usage_modifier"]!, $["UsageDeclaration"]!],
    [$["_usage_modifier"]!, $["_UsageDeclaration"]!],
    [$["_usage_modifier"]!, $["_Redefinitions"]!],
    [$["_usage_modifier"]!, $["_Subsettings"]!],
    [$["_usage_modifier"]!, $["_References"]!],
    [$["_usage_modifier"]!, $["_Crosses"]!],
    [$["_usage_modifier"]!, $["_Typings"]!],
    [$["_usage_modifier"]!, $["OwnedRedefinition"]!],
    [$["_usage_modifier"]!, $["OwnedSubsetting"]!],
    [$["_usage_modifier"]!, $["OwnedMultiplicity"]!],
    [$["_usage_modifier"]!, $["EnumerationUsage"]!],
    [$["_usage_modifier"]!, $["EnumeratedValue"]!],
    [$["_usage_modifier"]!, $["EnumerationDefinition"]!, $["EnumerationUsage"]!],
    [$["_usage_modifier"]!, $["AssertConstraintUsage"]!, $["ConstraintUsage"]!],
    [$["_usage_modifier"]!, $["ConstraintDefinition"]!, $["ConstraintUsage"]!, $["AssertConstraintUsage"]!],
    [
      $["_usage_modifier"]!,
      $["_Typings"]!,
      $["_Subsettings"]!,
      $["_References"]!,
      $["_Crosses"]!,
      $["_Redefinitions"]!,
    ],
    [$["_usage_modifier"]!, $["_Identification"]!, $["Name"]!, $["ID"]!, $["UNRESTRICTED_NAME"]!],
    [$["Comment"]!],
    [$["Comment"]!, $["REGULAR_COMMENT"]!, $["STRING_VALUE"]!],
    [$["Documentation"]!],
    [$["Documentation"]!, $["REGULAR_COMMENT"]!, $["STRING_VALUE"]!],
    [$["TextualRepresentation"]!],
    [$["TextualRepresentation"]!, $["Comment"]!],
    [$["TextualRepresentation"]!, $["REGULAR_COMMENT"]!, $["STRING_VALUE"]!],
    [$["_Identification"]!, $["ID"]!, $["UNRESTRICTED_NAME"]!],
    [$["_Identification"]!, $["Name"]!, $["ID"]!, $["UNRESTRICTED_NAME"]!],
    [
      $["_Identification"]!,
      $["GlobalQualification"]!,
      $["_GlobalQualification"]!,
      $["MultiplicityRange"]!,
      $["ID"]!,
      $["UNRESTRICTED_NAME"]!,
    ],
    [$["_Identification"]!, $["MultiplicityRange"]!],
    [$["_Identification"]!, $["_FeatureSpecializationPart"]!],
    [$["_Identification"]!, $["FeatureSpecializationPart"]!],
    [$["_Identification"]!, $["Dependency"]!],
    [$["MultiplicityRange"]!, $["_FeatureSpecializationPart"]!],
    [$["MultiplicityRange"]!, $["_UsageDeclaration"]!, $["ID"]!, $["UNRESTRICTED_NAME"]!],
    [$["MultiplicityRange"]!, $["OwnedMultiplicity"]!],
    [$["_MultiplicityPart"]!],
    [$["_MultiplicityPart"]!, $["OwnedMultiplicity"]!],
    [$["OwnedMultiplicity"]!],
    [$["Name"]!, $["ID"]!, $["UNRESTRICTED_NAME"]!],
    [
      $["GlobalQualification"]!,
      $["_GlobalQualification"]!,
      $["OwnedReferenceSubsetting"]!,
      $["ID"]!,
      $["UNRESTRICTED_NAME"]!,
    ],
    [$["GlobalQualification"]!, $["OwnedReferenceSubsetting"]!],
    [$["_GlobalQualification"]!, $["OwnedReferenceSubsetting"]!],
    [$["_GlobalQualification"]!, $["_PrefixMetadataAnnotation"]!, $["_usage_modifier"]!],
    [$["OwnedReferenceSubsetting"]!],
    [$["PayloadFeature"]!, $["FlowEndMember"]!],
    [$["TransitionUsage"]!, $["_UsageDeclaration"]!, $["ID"]!, $["UNRESTRICTED_NAME"]!],
    // Binary & arithmetic operator associativity/precedence lookahead groups
    [
      $["MultiplicativeExpression"]!,
      $["AdditiveExpression"]!,
      $["RelationalExpression"]!,
      $["EqualityExpression"]!,
      $["ClassificationTestExpression"]!,
      $["CastExpression"]!,
      $["ExponentiationExpression"]!,
      $["XorExpression"]!,
      $["ImpliesExpression"]!,
      $["AndExpression"]!,
      $["OrExpression"]!,
      $["OwnedExpression"]!,
      $["CastOperator"]!,
      $["MultiplicativeOperator"]!,
      $["AdditiveOperator"]!,
      $["RelationalOperator"]!,
      $["EqualityOperator"]!,
      $["ExponentiationOperator"]!,
      $["ClassificationTestOperator"]!,
    ],
  ],

  word: ($) => $["ID"]!,

  rules: {
    // =====================================================================
    // ROOT
    // =====================================================================

    RootNamespace: ($) => repeat($["_PackageBodyElement"]!),

    _PackageBodyElement: ($) =>
      choice($["PackageMember"]!, $["ElementFilterMember"]!, $["AliasMember"]!, $["Import"]!, $["AnnotatingMember"]!),

    // =====================================================================
    // BASIC ELEMENTS
    // =====================================================================

    _Identification: ($) =>
      choice(
        seq("<", field("declaredShortName", $["Name"]!), ">", optional(field("declaredName", $["Name"]!))),
        field("declaredName", $["Name"]!),
      ),

    _RelationshipBody: ($) => choice(";", seq("{", repeat($["OwnedAnnotation"]!), "}")),

    // =====================================================================
    // VISIBILITY
    // =====================================================================

    VisibilityIndicator: () => choice("public", "private", "protected"),

    // =====================================================================
    // DEPENDENCIES
    // =====================================================================

    Dependency: ($) =>
      seq(
        repeat($["PrefixMetadataAnnotation"]!),
        "dependency",
        optional(seq(optional($["_Identification"]!), "from")),
        field("client", $["QualifiedName"]!),
        repeat(seq(",", field("client", $["QualifiedName"]!))),
        "to",
        field("supplier", $["QualifiedName"]!),
        repeat(seq(",", field("supplier", $["QualifiedName"]!))),
        $["_RelationshipBody"]!,
      ),

    // =====================================================================
    // ANNOTATIONS
    // =====================================================================

    Annotation: ($) =>
      ref({
        syntax: field("annotatedElement", $["QualifiedName"]!),
        name: (self) => self.annotatedElement,
        targetKinds: ["Element"],
        resolve: "qualified",
      }),

    OwnedAnnotation: ($) => field("ownedRelatedElement", $["_AnnotatingElement"]!),

    AnnotatingMember: ($) => field("ownedRelatedElement", $["_AnnotatingElement"]!),

    _AnnotatingElement: ($) =>
      choice($["Comment"]!, $["Documentation"]!, $["TextualRepresentation"]!, $["MetadataUsage"]!),

    Comment: ($) =>
      seq(
        choice(
          seq(
            "comment",
            optional($["_Identification"]!),
            optional(seq("about", $["Annotation"]!, repeat(seq(",", $["Annotation"]!)))),
            optional(seq("locale", field("locale", $["STRING_VALUE"]!))),
            optional(field("body", choice($["REGULAR_COMMENT"]!, $["STRING_VALUE"]!))),
          ),
          seq(
            optional(seq("locale", field("locale", $["STRING_VALUE"]!))),
            field("body", choice($["REGULAR_COMMENT"]!, $["STRING_VALUE"]!)),
          ),
        ),
        optional(";"),
      ),

    Documentation: ($) =>
      seq(
        choice(
          seq(
            "doc",
            optional($["_Identification"]!),
            optional(seq("locale", field("locale", $["STRING_VALUE"]!))),
            field("body", choice($["REGULAR_COMMENT"]!, $["STRING_VALUE"]!)),
          ),
          seq(
            "doc",
            optional(seq("<", field("declaredShortName", $["Name"]!), ">")),
            optional(seq("locale", field("locale", $["STRING_VALUE"]!))),
          ),
        ),
        optional(";"),
      ),

    TextualRepresentation: ($) =>
      seq(
        optional(seq("rep", optional($["_Identification"]!))),
        "language",
        field("language", $["STRING_VALUE"]!),
        optional(field("body", choice($["REGULAR_COMMENT"]!, $["STRING_VALUE"]!))),
        optional(";"),
      ),

    // =====================================================================
    // METADATA
    // =====================================================================

    PrefixMetadataAnnotation: ($) => seq("#", field("ownedRelatedElement", $["PrefixMetadataUsage"]!)),

    PrefixMetadataMember: ($) => seq("#", field("ownedRelatedElement", $["PrefixMetadataUsage"]!)),

    PrefixMetadataUsage: ($) => field("ownedRelationship", $["MetadataTyping"]!),

    MetadataUsage: ($) =>
      def({
        syntax: seq(
          repeat($["PrefixMetadataMember"]!),
          choice("metadata", "@"),
          optional(seq(optional($["_Identification"]!), optional(seq(choice(":", seq("defined", "by")))))),
          field("ownedRelationship", $["MetadataTyping"]!),
          optional(seq("about", $["Annotation"]!, repeat(seq(",", $["Annotation"]!)))),
          $["_MetadataBody"]!,
        ),
        symbol: usageAttrs("metadata"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    MetadataTyping: ($) =>
      ref({
        syntax: field("type", $["QualifiedName"]!),
        name: (self) => self.type,
        targetKinds: ["Metaclass"],
        resolve: "qualified",
      }),

    _MetadataBody: ($) =>
      choice(
        ";",
        seq(
          "{",
          repeat(choice($["DefinitionMember"]!, $["MetadataBodyUsageMember"]!, $["AliasMember"]!, $["Import"]!)),
          "}",
        ),
      ),

    MetadataBodyUsageMember: ($) => field("ownedRelatedElement", $["MetadataBodyUsage"]!),

    MetadataBodyUsage: ($) =>
      seq(
        optional("ref"),
        optional(choice(":>>", "redefines")),
        field("ownedRelationship", $["OwnedRedefinition"]!),
        optional($["_FeatureSpecializationPart"]!),
        optional($["_ValuePart"]!),
        $["_MetadataBody"]!,
      ),

    MetadataDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "metadata", "def", $["_Definition"]!),
        symbol: defAttrs("metadata"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
      }),

    // =====================================================================
    // PACKAGES
    // =====================================================================

    Package: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "package",
          optional($["_Identification"]!),
          field("body", $["_PackageBody"]!),
        ),
        symbol: (self: SysmlRuleSelf) => ({
          kind: "Package",
          name: self.declaredName,
          exports: ["body"],
        }),
        queries: packageTraceabilityQueries,
        model: packageTraceabilityModel,
        lints: packageTraceabilityLints,
        graphics: () => sysmlGroupGraphics({ fill: "#f8fafc", stroke: "#475569", tabText: "package" }),
      }),

    LibraryPackage: ($) =>
      def({
        syntax: seq(
          optional(field("isStandard", "standard")),
          "library",
          repeat($["_usage_modifier"]!),
          "package",
          optional($["_Identification"]!),
          field("body", $["_PackageBody"]!),
        ),
        symbol: (self: SysmlRuleSelf) => ({
          kind: "Package",
          name: self.declaredName,
          exports: ["body"],
          attributes: { isStandard: self.isStandard },
        }),
        queries: packageTraceabilityQueries,
        model: packageTraceabilityModel,
        lints: packageTraceabilityLints,
        graphics: () => sysmlGroupGraphics({ fill: "#f8fafc", stroke: "#475569", tabText: "library" }),
      }),

    _PackageBody: ($) => choice(";", seq("{", repeat($["_PackageBodyElement"]!), "}")),

    PackageMember: ($) =>
      seq(
        optional($["VisibilityIndicator"]!),
        choice(
          field("ownedRelatedElement", $["_DefinitionElement"]!),
          field("ownedRelatedElement", $["_UsageElement"]!),
        ),
      ),

    ElementFilterMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), "filter", field("ownedRelatedElement", $["OwnedExpression"]!), ";"),

    AliasMember: ($) =>
      def({
        syntax: seq(
          optional($["VisibilityIndicator"]!),
          "alias",
          optional(seq("<", field("memberShortName", $["Name"]!), ">")),
          optional(field("memberName", $["Name"]!)),
          "for",
          ref({
            syntax: field("memberElement", $["QualifiedName"]!),
            name: (self) => self.memberElement,
            targetKinds: ["Element"],
            resolve: "qualified",
          }),
          $["_RelationshipBody"]!,
        ),
        symbol: (self) => ({ kind: "Alias", name: self.memberName }),
        model: {
          name: "AliasNode" as const,
          visitable: true,
        },
      }),

    // =====================================================================
    // IMPORTS
    // =====================================================================

    _ImportPrefix: ($) => seq(optional($["VisibilityIndicator"]!), "import", optional(field("isImportAll", "all"))),

    Import: ($) => seq(choice($["MembershipImport"]!, $["NamespaceImport"]!), $["_RelationshipBody"]!),

    MembershipImport: ($) =>
      def({
        syntax: seq($["_ImportPrefix"]!, $["_ImportedMembership"]!),
        symbol: (self) => ({
          kind: "Import",
          name: self.importedMembership,
          attributes: {
            isImportAll: self.isImportAll,
            isRecursive: self.isRecursive,
          },
        }),
        model: importModel,
        lints: importLints,
      }),

    _ImportedMembership: ($) =>
      seq(
        ref({
          syntax: field("importedMembership", $["QualifiedName"]!),
          name: (self) => self.importedMembership,
          targetKinds: ["Membership"],
          resolve: "qualified",
        }),
        optional(seq("::", field("isRecursive", "**"))),
      ),

    NamespaceImport: ($) =>
      def({
        syntax: seq(
          $["_ImportPrefix"]!,
          choice($["_ImportedNamespace"]!, field("ownedRelatedElement", $["FilterPackage"]!)),
        ),
        symbol: (self: SysmlRuleSelf) => ({
          kind: "Import",
          name: self.importedNamespace,
          attributes: {
            isImportAll: self.isImportAll,
            isRecursive: self.isRecursive,
          },
        }),
        model: importModel,
        lints: importLints,
      }),

    _ImportedNamespace: ($) =>
      seq(
        ref({
          syntax: field("importedNamespace", $["QualifiedName"]!),
          name: (self) => self.importedNamespace,
          targetKinds: ["Namespace"],
          resolve: "qualified",
        }),
        "::",
        "*",
        optional(seq("::", field("isRecursive", "**"))),
      ),

    FilterPackage: ($) => seq($["FilterPackageImport"]!, repeat1($["FilterPackageMember"]!)),

    FilterPackageImport: ($) => choice($["FilterPackageMembershipImport"]!, $["FilterPackageNamespaceImport"]!),

    FilterPackageMembershipImport: ($) => $["_ImportedMembership"]!,
    FilterPackageNamespaceImport: ($) => $["_ImportedNamespace"]!,

    FilterPackageMember: ($) => seq("[", field("ownedRelatedElement", $["OwnedExpression"]!), "]"),

    // =====================================================================
    // DEFINITION & USAGE ELEMENTS (dispatch)
    // =====================================================================

    _DefinitionElement: ($) =>
      choice(
        $["Package"]!,
        $["LibraryPackage"]!,
        $["Dependency"]!,
        $["AttributeDefinition"]!,
        $["EnumerationDefinition"]!,
        $["OccurrenceDefinition"]!,
        $["ItemDefinition"]!,
        $["MetadataDefinition"]!,
        $["PartDefinition"]!,
        $["ConnectionDefinition"]!,
        $["FlowDefinition"]!,
        $["InterfaceDefinition"]!,
        $["AllocationDefinition"]!,
        $["PortDefinition"]!,
        $["ActionDefinition"]!,
        $["CalculationDefinition"]!,
        $["StateDefinition"]!,
        $["ConstraintDefinition"]!,
        $["RequirementDefinition"]!,
        $["ConcernDefinition"]!,
        $["CaseDefinition"]!,
        $["AnalysisCaseDefinition"]!,
        $["VerificationCaseDefinition"]!,
        $["UseCaseDefinition"]!,
        $["ViewDefinition"]!,
        $["ViewpointDefinition"]!,
        $["RenderingDefinition"]!,
      ),

    _UsageElement: ($) => choice($["_NonOccurrenceUsageElement"]!, $["_OccurrenceUsageElement"]!),

    _NonOccurrenceUsageElement: ($) =>
      choice(
        $["DefaultReferenceUsage"]!,
        $["ReferenceUsage"]!,
        $["AttributeUsage"]!,
        $["EnumerationUsage"]!,
        $["BindingConnectorAsUsage"]!,
        $["SuccessionAsUsage"]!,
      ),

    _OccurrenceUsageElement: ($) => choice($["_StructureUsageElement"]!, $["_BehaviorUsageElement"]!),

    _StructureUsageElement: ($) =>
      choice(
        $["OccurrenceUsage"]!,
        $["ItemUsage"]!,
        $["PartUsage"]!,
        $["PortUsage"]!,
        $["ConnectionUsage"]!,
        $["InterfaceUsage"]!,
        $["AllocationUsage"]!,
        $["FlowUsage"]!,
        $["SuccessionFlowUsage"]!,
        $["ViewUsage"]!,
        $["RenderingUsage"]!,
      ),

    _BehaviorUsageElement: ($) =>
      choice(
        $["ActionUsage"]!,
        $["CalculationUsage"]!,
        $["StateUsage"]!,
        $["ConstraintUsage"]!,
        $["RequirementUsage"]!,
        $["ConcernUsage"]!,
        $["CaseUsage"]!,
        $["AnalysisCaseUsage"]!,
        $["VerificationCaseUsage"]!,
        $["UseCaseUsage"]!,
        $["ViewpointUsage"]!,
        $["PerformActionUsage"]!,
        $["ExhibitStateUsage"]!,
        $["IncludeUseCaseUsage"]!,
        $["AssertConstraintUsage"]!,
        $["SatisfyRequirementUsage"]!,
      ),

    // =====================================================================
    // CLASSIFIERS — Subclassification
    // =====================================================================

    _SubclassificationPart: ($) =>
      seq(choice(":>", "specializes"), $["OwnedSubclassification"]!, repeat(seq(",", $["OwnedSubclassification"]!))),

    OwnedSubclassification: ($) =>
      ref({
        syntax: field("superclassifier", $["QualifiedName"]!),
        name: (self) => self.superclassifier,
        targetKinds: ["Classifier"],
        resolve: "qualified",
      }),

    // =====================================================================
    // FEATURES
    // =====================================================================

    _FeatureDeclaration: ($) =>
      choice(seq($["_Identification"]!, optional($["_FeatureSpecializationPart"]!)), $["_FeatureSpecializationPart"]!),

    _FeatureSpecializationPart: ($) => repeat1(choice($["_FeatureSpecialization"]!, $["_MultiplicityPart"]!)),

    _MultiplicityPart: ($) =>
      choice(
        $["OwnedMultiplicity"]!,
        seq(
          optional($["OwnedMultiplicity"]!),
          choice(
            seq(field("isOrdered", "ordered"), optional(field("isNonunique", "nonunique"))),
            seq(field("isNonunique", "nonunique"), optional(field("isOrdered", "ordered"))),
          ),
        ),
      ),

    _FeatureSpecialization: ($) =>
      choice($["_Typings"]!, $["_Subsettings"]!, $["_References"]!, $["_Crosses"]!, $["_Redefinitions"]!),

    _Typings: ($) => seq(choice(":", seq("defined", "by")), $["FeatureTyping"]!, repeat(seq(",", $["FeatureTyping"]!))),

    _Subsettings: ($) =>
      seq(choice(":>", "subsets", "subset"), $["OwnedSubsetting"]!, repeat(seq(",", $["OwnedSubsetting"]!))),

    _References: ($) => seq(choice("::>", "references", "reference"), $["OwnedReferenceSubsetting"]!),

    _Crosses: ($) => seq(choice("=>", "crosses"), $["OwnedCrossSubsetting"]!),

    _Redefinitions: ($) =>
      seq(choice(":>>", "redefines", "redefine"), $["OwnedRedefinition"]!, repeat(seq(",", $["OwnedRedefinition"]!))),

    FeatureTyping: ($) => choice($["OwnedFeatureTyping"]!, $["ConjugatedPortTyping"]!),

    OwnedFeatureTyping: ($) =>
      choice(
        ref({
          syntax: field("type", $["QualifiedName"]!),
          name: (self) => self.type,
          targetKinds: ["Type"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $["OwnedFeatureChain"]!),
      ),

    OwnedSubsetting: ($) =>
      choice(
        ref({
          syntax: field("subsettedFeature", $["QualifiedName"]!),
          name: (self) => self.subsettedFeature,
          targetKinds: ["Feature"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $["OwnedFeatureChain"]!),
      ),

    OwnedReferenceSubsetting: ($) =>
      choice(
        ref({
          syntax: field("referencedFeature", $["QualifiedName"]!),
          name: (self) => self.referencedFeature,
          targetKinds: ["Feature"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $["OwnedFeatureChain"]!),
      ),

    OwnedCrossSubsetting: ($) =>
      choice(
        ref({
          syntax: field("crossedFeature", $["QualifiedName"]!),
          name: (self) => self.crossedFeature,
          targetKinds: ["Feature"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $["OwnedFeatureChain"]!),
      ),

    OwnedRedefinition: ($) =>
      choice(
        ref({
          syntax: field("redefinedFeature", $["QualifiedName"]!),
          name: (self) => self.redefinedFeature,
          targetKinds: ["Feature"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $["OwnedFeatureChain"]!),
      ),

    // =====================================================================
    // MULTIPLICITY
    // =====================================================================

    OwnedMultiplicity: ($) => field("ownedRelatedElement", $["MultiplicityRange"]!),

    MultiplicityRange: ($) =>
      seq(
        "[",
        field("lowerBound", $["MultiplicityExpressionMember"]!),
        optional(seq("..", field("upperBound", $["MultiplicityExpressionMember"]!))),
        "]",
      ),

    MultiplicityExpressionMember: ($) =>
      field("ownedRelatedElement", choice($["_LiteralExpression"]!, $["FeatureReferenceExpression"]!)),

    // =====================================================================
    // DEFINITIONS
    // =====================================================================

    _Definition: ($) =>
      seq(optional($["_Identification"]!), optional($["_SubclassificationPart"]!), $["_DefinitionBody"]!),

    _DefinitionBody: ($) => choice(";", seq("{", repeat($["_DefinitionBodyItem"]!), "}")),

    _DefinitionBodyItem: ($) =>
      choice(
        $["DefinitionMember"]!,
        $["VariantUsageMember"]!,
        $["NonOccurrenceUsageMember"]!,
        seq(optional($["EmptySuccessionMember"]!), $["OccurrenceUsageMember"]!),
        $["AliasMember"]!,
        $["Import"]!,
        $["AnnotatingMember"]!,
      ),

    DefinitionMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["_DefinitionElement"]!)),

    VariantUsageMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), "variant", field("ownedRelatedElement", $["_UsageElement"]!)),

    NonOccurrenceUsageMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["_NonOccurrenceUsageElement"]!)),

    OccurrenceUsageMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["_OccurrenceUsageElement"]!)),

    // =====================================================================
    // USAGES
    // =====================================================================
    // Single shared modifier rule — avoids per-rule repeat() conflicts
    _usage_modifier: ($) =>
      choice(
        field("isEnd", "end"),
        field("direction", "in"),
        field("direction", "out"),
        field("direction", "inout"),
        field("isDerived", "derived"),
        field("isAbstract", "abstract"),
        field("isVariation", "variation"),
        field("isConstant", "constant"),
        field("isRef", "ref"),
        field("isRedefine", "redefine"),
        field("isRedefine", "redefines"),
        field("isSubsetting", "subset"),
        field("isSubsetting", "subsets"),
        "individual",
        "snapshot",
        "timeslice",
        $["PrefixMetadataMember"]!,
      ),

    _UsageDeclaration: ($) => $["_FeatureDeclaration"]!,

    _UsageCompletion: ($) => seq(optional($["_ValuePart"]!), $["_DefinitionBody"]!),

    _Usage: ($) => seq(optional($["_UsageDeclaration"]!), $["_UsageCompletion"]!),

    _ValuePart: ($) => $["FeatureValue"]!,

    FeatureValue: ($) =>
      seq(
        choice(
          "=",
          field("isInitial", ":="),
          seq(field("isDefault", "default"), optional(choice("=", field("isInitial", ":=")))),
        ),
        field("ownedRelatedElement", $["OwnedExpression"]!),
      ),

    // =====================================================================
    // REFERENCE USAGES
    // =====================================================================

    DefaultReferenceUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          $["_UsageDeclaration"]!,
          optional($["_ValuePart"]!),
          $["_DefinitionBody"]!,
        ),
        symbol: usageAttrs("ref"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    ReferenceUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "ref", $["_Usage"]!),
        symbol: usageAttrs("ref"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    // =====================================================================
    // ATTRIBUTES
    // =====================================================================

    AttributeDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "attribute", "def", $["_Definition"]!),
        symbol: defAttrs("attribute"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "attribute def", fill: "#fce4ec", stroke: "#e91e63" }),
      }),

    AttributeUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "attribute", $["_Usage"]!),
        symbol: usageAttrs("attribute"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "attribute", fill: "#fce4ec", stroke: "#f48fb1" }),
      }),

    // =====================================================================
    // ENUMERATIONS
    // =====================================================================

    EnumerationDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "enum",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          field("body", $["_EnumerationBody"]!),
        ),
        symbol: (self: SysmlRuleSelf) => ({ kind: "Enumeration", name: self.declaredName, exports: ["body"] }),
        queries: definitionStructuralQueries,
        model: {
          name: "EnumerationNode" as const,
          visitable: true,
          specializable: true,
          properties: { isAbstract: "boolean" as const },
          queryTypes: {
            members: "SemanticNode[]" as const,
            ownedDefinitions: "DefinitionNode[]" as const,
            ownedUsages: "UsageNode[]" as const,
            imports: "SemanticNode[]" as const,
          },
        },
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "enum def", fill: "#f3e5f5", stroke: "#7b1fa2" }),
      }),

    _EnumerationBody: ($) =>
      choice(";", seq("{", repeat(choice($["AnnotatingMember"]!, $["EnumerationUsageMember"]!)), "}")),

    EnumerationUsageMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["EnumeratedValue"]!)),

    EnumeratedValue: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), optional("enum"), $["_Usage"]!),
        symbol: (self) => ({ kind: "EnumerationValue", name: self.declaredName }),
        model: {
          name: "EnumerationValueNode" as const,
          visitable: true,
        },
        lints: enumValueLints,
      }),

    EnumerationUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "enum", $["_Usage"]!),
        symbol: usageAttrs("enumeration"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    // =====================================================================
    // OCCURRENCES
    // =====================================================================

    OccurrenceDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "occurrence", "def", $["_Definition"]!),
        symbol: defAttrs("occurrence"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "occurrence def", fill: "#f5f5f5", stroke: "#616161" }),
      }),

    OccurrenceUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "occurrence", $["_Usage"]!),
        symbol: usageAttrs("occurrence"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    // =====================================================================
    // ITEMS
    // =====================================================================

    ItemDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "item", "def", $["_Definition"]!),
        symbol: defAttrs("item"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "item def", fill: "#f0fdfa", stroke: "#0d9488" }),
      }),

    ItemUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "item", $["_Usage"]!),
        symbol: usageAttrs("item"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "item", fill: "#f0fdfa", stroke: "#14b8a6" }),
      }),

    PartDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "part", "def", $["_Definition"]!),
        symbol: defAttrs("part"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () =>
          sysmlNodeGraphics({ stereotype: "part def", fill: "#ecfdf5", stroke: "#059669", portQuery: "ownedPorts" }),
        diff: {
          ignore: ["annotationClause", "description"],
          breaking: ["isAbstract"],
        },
      }),

    PartUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "part", $["_Usage"]!),
        symbol: usageAttrs("part"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "part", fill: "#ecfdf5", stroke: "#10b981" }),
      }),

    // =====================================================================
    // PORTS
    // =====================================================================

    PortDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "port", "def", $["_Definition"]!),
        symbol: defAttrs("port"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "port def", fill: "#fff7ed", stroke: "#ea580c" }),
        diff: {
          ignore: ["annotationClause", "description"],
          breaking: ["direction"],
        },
      }),

    PortUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "port", $["_Usage"]!),
        symbol: usageAttrs("port"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => ({
          role: "port-owner" as const,
          node: {
            shape: "rect",
            markup: [
              { tagName: "rect", selector: "body" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { fill: "#ffffff", stroke: "#ea580c", strokeWidth: 1.5, rx: 0, ry: 0, width: 12, height: 12 },
              label: {
                text: "{{name}}",
                fill: "#334155",
                fontSize: 10,
                fontWeight: "500",
                refX: 0.5,
                refY: 18,
                textAnchor: "middle",
              },
            },
            size: { width: 12, height: 12 },
          },
        }),
      }),

    ConjugatedPortTyping: ($) =>
      seq(
        "~",
        ref({
          syntax: field("conjugatedPortDefinition", $["QualifiedName"]!),
          name: (self) => self.conjugatedPortDefinition,
          targetKinds: ["ConjugatedPortDefinition"],
          resolve: "qualified",
        }),
      ),

    // =====================================================================
    // CONNECTIONS
    // =====================================================================

    ConnectorEndMember: ($) => field("ownedRelatedElement", $["ConnectorEnd"]!),

    ConnectorEnd: ($) =>
      seq(
        optional(field("ownedRelationship", $["OwnedMultiplicity"]!)),
        optional(seq(field("declaredName", $["Name"]!), choice("::>", "references"))),
        $["OwnedReferenceSubsetting"]!,
      ),

    ConnectionDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "connection", "def", $["_Definition"]!),
        symbol: defAttrs("connection"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "connection def", fill: "#eceff1", stroke: "#546e7a" }),
      }),

    ConnectionUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          choice(
            seq(
              "connection",
              optional($["_UsageDeclaration"]!),
              optional($["_ValuePart"]!),
              optional(seq("connect", $["_ConnectorPart"]!)),
            ),
            seq("connect", $["_ConnectorPart"]!),
          ),
          $["_DefinitionBody"]!,
        ),
        symbol: usageAttrs("connection"),
        queries: usageQueries,
        model: usageModel,
        lints: connectionLints,
        graphics: () => sysmlEdgeGraphics({ stroke: "#546e7a", label: "«connect»", connector: "jumpover" }),
        diff: {
          identity: (self) => self.name || `connection_${self.id}`,
        },
      }),

    _ConnectorPart: ($) => choice($["_BinaryConnectorPart"]!, $["_NaryConnectorPart"]!),

    _BinaryConnectorPart: ($) => seq($["ConnectorEndMember"]!, "to", $["ConnectorEndMember"]!),

    _NaryConnectorPart: ($) =>
      seq(
        "(",
        $["ConnectorEndMember"]!,
        ",",
        $["ConnectorEndMember"]!,
        repeat(seq(",", $["ConnectorEndMember"]!)),
        ")",
      ),

    BindingConnectorAsUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          optional(seq("binding", optional($["_UsageDeclaration"]!))),
          "bind",
          $["ConnectorEndMember"]!,
          "=",
          $["ConnectorEndMember"]!,
          $["_DefinitionBody"]!,
        ),
        symbol: usageAttrs("binding"),
        queries: usageQueries,
        model: usageModel,
        lints: connectionLints,
        graphics: () => sysmlEdgeGraphics({ label: "«bind»", stroke: "#37474f", connector: "jumpover" }),
      }),

    SuccessionAsUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          optional(seq("succession", optional($["_UsageDeclaration"]!))),
          optional("first"),
          $["ConnectorEndMember"]!,
          "then",
          $["ConnectorEndMember"]!,
          optional(seq("if", field("guard", $["OwnedExpression"]!))),
          $["_DefinitionBody"]!,
        ),
        symbol: (self: SysmlRuleSelf) => ({
          ...usageAttrs("succession")(self),
          attributes: {
            ...usageAttrs("succession")(self).attributes,
            guard: self.guard,
          },
        }),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlEdgeGraphics({ label: "«succession»", stroke: "#455a64", strokeDasharray: "4 2" }),
      }),

    // =====================================================================
    // INTERFACES
    // =====================================================================

    InterfaceDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "interface",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_DefinitionBody"]!,
        ),
        symbol: defAttrs("interface"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "interface def", fill: "#e0f2f1", stroke: "#00695c" }),
      }),

    InterfaceUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "interface",
          optional($["_UsageDeclaration"]!),
          optional(seq("connect", $["_ConnectorPart"]!)),
          $["_DefinitionBody"]!,
        ),
        symbol: usageAttrs("interface"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlEdgeGraphics({ label: "«interface»", stroke: "#00695c" }),
      }),

    // =====================================================================
    // ALLOCATIONS
    // =====================================================================

    AllocationDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "allocation", "def", $["_Definition"]!),
        symbol: defAttrs("allocation"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "allocation def", fill: "#e8eaf6", stroke: "#283593" }),
      }),

    AllocationUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          choice(
            seq("allocation", optional($["_UsageDeclaration"]!), optional(seq("allocate", $["_ConnectorPart"]!))),
            seq("allocate", $["_ConnectorPart"]!),
          ),
          $["_DefinitionBody"]!,
        ),
        symbol: usageAttrs("allocation"),
        queries: allocationQueries,
        model: usageModel,
        lints: allocationLints,
        graphics: () => sysmlEdgeGraphics({ label: "«allocate»", stroke: "#283593", strokeDasharray: "6 3" }),
      }),

    // =====================================================================
    // FLOWS
    // =====================================================================

    FlowDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "flow", "def", $["_Definition"]!),
        symbol: defAttrs("flow"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "flow def", fill: "#e1f5fe", stroke: "#01579b" }),
      }),

    FlowUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "flow",
          choice(
            seq($["FlowEndMember"]!, "to", $["FlowEndMember"]!),
            seq(
              optional($["_UsageDeclaration"]!),
              optional($["_ValuePart"]!),
              optional(seq("of", $["PayloadFeatureMember"]!)),
              optional(seq("from", $["FlowEndMember"]!, "to", $["FlowEndMember"]!)),
            ),
          ),
          $["_DefinitionBody"]!,
        ),
        symbol: usageAttrs("flow"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlEdgeGraphics({ label: "«flow»", stroke: "#01579b", connector: "jumpover" }),
      }),

    SuccessionFlowUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "succession",
          "flow",
          choice(
            seq($["FlowEndMember"]!, "to", $["FlowEndMember"]!),
            seq(
              optional($["_UsageDeclaration"]!),
              optional($["_ValuePart"]!),
              optional(seq("of", $["PayloadFeatureMember"]!)),
              optional(seq("from", $["FlowEndMember"]!, "to", $["FlowEndMember"]!)),
            ),
          ),
          $["_DefinitionBody"]!,
        ),
        symbol: usageAttrs("flow"),
        queries: usageQueries,
        lints: usageLints,
        graphics: () =>
          sysmlEdgeGraphics({
            label: "«succession flow»",
            stroke: "#01579b",
            strokeDasharray: "4 2",
            connector: "jumpover",
          }),
      }),

    PayloadFeatureMember: ($) => field("ownedRelatedElement", $["PayloadFeature"]!),

    PayloadFeature: ($) =>
      choice(
        seq(optional($["_Identification"]!), $["_FeatureSpecializationPart"]!, optional($["_ValuePart"]!)),
        seq(optional($["_Identification"]!), $["_ValuePart"]!),
        seq($["OwnedFeatureTyping"]!, optional($["OwnedMultiplicity"]!)),
        seq($["OwnedMultiplicity"]!, $["OwnedFeatureTyping"]!),
      ),

    FlowEndMember: ($) => field("ownedRelatedElement", $["FlowEnd"]!),

    FlowEnd: ($) =>
      seq(optional(seq($["OwnedReferenceSubsetting"]!, ".")), field("ownedRelationship", $["FlowFeatureMember"]!)),

    FlowFeatureMember: ($) => field("ownedRelatedElement", $["FlowFeature"]!),

    FlowFeature: ($) =>
      ref({
        syntax: field("ownedRelationship", $["QualifiedName"]!),
        name: (self) => self.ownedRelationship,
        targetKinds: ["Feature"],
        resolve: "qualified",
      }),

    // =====================================================================
    // ACTIONS
    // =====================================================================

    ActionDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "action",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          optional($["_ParameterList"]!),
          $["_ActionBody"]!,
        ),
        symbol: defAttrs("action"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: actionDefinitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "action def", fill: "#f0f9ff", stroke: "#0284c7" }),
      }),

    _ActionBody: ($) => choice(";", seq("{", repeat($["_ActionBodyItem"]!), "}")),

    _ActionBodyItem: ($) =>
      choice(
        $["Import"]!,
        $["AliasMember"]!,
        $["DefinitionMember"]!,
        $["VariantUsageMember"]!,
        $["NonOccurrenceUsageMember"]!,
        $["OccurrenceUsageMember"]!,
        seq(optional($["EmptySuccessionMember"]!), $["_OccurrenceUsageElement"]!),
        $["ActionNodeMember"]!,
        $["ReturnParameterMember"]!,
        $["AnnotatingMember"]!,
      ),

    EmptySuccessionMember: ($) => seq("then", field("ownedRelatedElement", $["MultiplicitySourceEnd"]!)),

    MultiplicitySourceEnd: ($) => field("ownedRelationship", $["OwnedMultiplicity"]!),

    ActionNodeMember: ($) => seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["_ActionNode"]!)),

    _ActionNode: ($) =>
      choice(
        $["IfNode"]!,
        $["WhileLoopNode"]!,
        $["ForLoopNode"]!,
        $["ControlNode"]!,
        $["AcceptActionNode"]!,
        $["SendActionNode"]!,
        $["AssignActionNode"]!,
      ),

    IfNode: ($) =>
      seq(
        repeat($["_usage_modifier"]!),
        optional(seq("action", optional($["_UsageDeclaration"]!))),
        "if",
        field("condition", $["OwnedExpression"]!),
        field("thenBody", $["ActionBodyParameter"]!),
        optional(seq("else", choice(field("elseBody", $["ActionBodyParameter"]!), $["IfNode"]!))),
      ),

    ActionBodyParameter: ($) =>
      seq(optional(seq("action", optional($["_UsageDeclaration"]!))), "{", repeat($["_ActionBodyItem"]!), "}"),

    WhileLoopNode: ($) =>
      seq(
        repeat($["_usage_modifier"]!),
        optional(seq("action", optional($["_UsageDeclaration"]!))),
        choice(seq("while", field("condition", $["OwnedExpression"]!)), "loop"),
        $["ActionBodyParameter"]!,
        optional(seq("until", field("untilCondition", $["OwnedExpression"]!), ";")),
      ),

    ForLoopNode: ($) =>
      seq(
        repeat($["_usage_modifier"]!),
        optional(seq("action", optional($["_UsageDeclaration"]!))),
        "for",
        field("variable", $["ForVariableDeclaration"]!),
        "in",
        field("range", $["OwnedExpression"]!),
        $["ActionBodyParameter"]!,
      ),

    ForVariableDeclaration: ($) => $["_UsageDeclaration"]!,

    ControlNode: ($) => choice($["MergeNode"]!, $["DecisionNode"]!, $["JoinNode"]!, $["ForkNode"]!),

    MergeNode: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "merge", optional($["_UsageDeclaration"]!), $["_ActionBody"]!),
        symbol: usageAttrs("merge"),
        graphics: () => ({
          role: "node",
          node: {
            shape: "polygon",
            markup: [
              { tagName: "polygon", selector: "body" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { points: "20,0 40,20 20,40 0,20", fill: "#f0f9ff", stroke: "#0284c7", strokeWidth: 1.5 },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 10,
                fontWeight: "600",
                refX: 20,
                refY: 48,
                textAnchor: "middle",
              },
            },
            size: { width: 40, height: 40 },
          },
        }),
      }),

    DecisionNode: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "decide", optional($["_UsageDeclaration"]!), $["_ActionBody"]!),
        symbol: usageAttrs("decide"),
        graphics: () => ({
          role: "node",
          node: {
            shape: "polygon",
            markup: [
              { tagName: "polygon", selector: "body" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { points: "20,0 40,20 20,40 0,20", fill: "#f0f9ff", stroke: "#0284c7", strokeWidth: 1.5 },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 10,
                fontWeight: "600",
                refX: 20,
                refY: 48,
                textAnchor: "middle",
              },
            },
            size: { width: 40, height: 40 },
          },
        }),
      }),

    JoinNode: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "join", optional($["_UsageDeclaration"]!), $["_ActionBody"]!),
        symbol: usageAttrs("join"),
        graphics: () => ({
          role: "node",
          node: {
            shape: "rect",
            markup: [
              { tagName: "rect", selector: "body" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { fill: "#1e293b", stroke: "#0f172a", strokeWidth: 1, rx: 1, ry: 1 },
              label: { text: "{{name}}", fill: "#475569", fontSize: 9, refX: 0.5, refY: -8, textAnchor: "middle" },
            },
            size: { width: 60, height: 6 },
          },
        }),
      }),

    ForkNode: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "fork", optional($["_UsageDeclaration"]!), $["_ActionBody"]!),
        symbol: usageAttrs("fork"),
        graphics: () => ({
          role: "node",
          node: {
            shape: "rect",
            markup: [
              { tagName: "rect", selector: "body" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { fill: "#1e293b", stroke: "#0f172a", strokeWidth: 1, rx: 1, ry: 1 },
              label: { text: "{{name}}", fill: "#475569", fontSize: 9, refX: 0.5, refY: -8, textAnchor: "middle" },
            },
            size: { width: 60, height: 6 },
          },
        }),
      }),

    ActionUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "action",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          optional($["_ParameterList"]!),
          $["_ActionBody"]!,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
        lints: actionUsageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "action", fill: "#f0f9ff", stroke: "#0284c7" }),
      }),

    // -----------------------------------------------------------------
    // ACCEPT / SEND / ASSIGN action nodes
    // -----------------------------------------------------------------

    AcceptActionNode: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          optional(seq("action", optional($["_UsageDeclaration"]!))),
          "accept",
          $["PayloadFeatureMember"]!,
          optional(seq("via", $["OwnedReferenceSubsetting"]!)),
          $["_ActionBody"]!,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => ({
          role: "node",
          node: {
            shape: "polygon",
            markup: [
              { tagName: "polygon", selector: "body" },
              { tagName: "text", selector: "stereotype" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { points: "0,0 120,0 120,40 0,40 16,20", fill: "#f0f9ff", stroke: "#0284c7", strokeWidth: 1.5 },
              stereotype: {
                text: "«accept»",
                fill: "#0284c7",
                fontSize: 9,
                fontStyle: "italic",
                refX: 0.55,
                refY: 14,
                textAnchor: "middle",
              },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 11,
                fontWeight: "bold",
                refX: 0.55,
                refY: 28,
                textAnchor: "middle",
              },
            },
            size: { width: 120, height: 40 },
          },
        }),
      }),

    SendActionNode: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          optional(seq("action", optional($["_UsageDeclaration"]!))),
          "send",
          field("sentItem", $["OwnedExpression"]!),
          optional(seq("via", $["OwnedReferenceSubsetting"]!)),
          optional(seq("to", field("receiver", $["OwnedExpression"]!))),
          $["_ActionBody"]!,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => ({
          role: "node",
          node: {
            shape: "polygon",
            markup: [
              { tagName: "polygon", selector: "body" },
              { tagName: "text", selector: "stereotype" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { points: "0,0 104,0 120,20 104,40 0,40", fill: "#f0f9ff", stroke: "#0284c7", strokeWidth: 1.5 },
              stereotype: {
                text: "«send»",
                fill: "#0284c7",
                fontSize: 9,
                fontStyle: "italic",
                refX: 0.45,
                refY: 14,
                textAnchor: "middle",
              },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 11,
                fontWeight: "bold",
                refX: 0.45,
                refY: 28,
                textAnchor: "middle",
              },
            },
            size: { width: 120, height: 40 },
          },
        }),
      }),

    AssignActionNode: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          optional(seq("action", optional($["_UsageDeclaration"]!))),
          "assign",
          field("assignedValue", $["OwnedExpression"]!),
          "=:",
          field("targetFeature", $["OwnedExpression"]!),
          $["_ActionBody"]!,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    PerformActionUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "perform",
          choice(
            seq($["OwnedReferenceSubsetting"]!, optional($["_FeatureSpecializationPart"]!)),
            seq("action", optional($["_UsageDeclaration"]!)),
          ),
          optional($["_ValuePart"]!),
          $["_ActionBody"]!,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
        lints: actionUsageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "perform", fill: "#f0f9ff", stroke: "#0369a1" }),
      }),

    // =====================================================================
    // CALCULATIONS
    // =====================================================================

    CalculationDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "calc",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          optional($["_ParameterList"]!),
          $["_CalculationBody"]!,
        ),
        symbol: defAttrs("calc"),
        queries: calculationQueries,
        model: calculationDefinitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "calc def", fill: "#f0fdfa", stroke: "#0f766e" }),
      }),

    _CalculationBody: ($) =>
      choice(
        ";",
        seq(
          "{",
          repeat(choice($["_ActionBodyItem"]!, $["ReturnParameterMember"]!)),
          optional($["ResultExpressionMember"]!),
          "}",
        ),
      ),

    _ParameterList: ($) => seq("(", optional(seq($["ParameterMember"]!, repeat(seq(",", $["ParameterMember"]!)))), ")"),

    ParameterMember: ($) => seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["_UsageElement"]!)),

    ReturnParameterMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), "return", field("ownedRelatedElement", $["_UsageElement"]!)),

    ResultExpressionMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["OwnedExpression"]!)),

    CalculationUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "calc",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          optional($["_ParameterList"]!),
          $["_CalculationBody"]!,
        ),
        symbol: usageAttrs("calc"),
        queries: calculationUsageQueries,
        model: calculationUsageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "calc", fill: "#f0fdfa", stroke: "#0f766e" }),
      }),

    // =====================================================================
    // CONSTRAINTS
    // =====================================================================

    ConstraintDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "constraint",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_CalculationBody"]!,
        ),
        symbol: defAttrs("constraint"),
        queries: constraintDefinitionQueries,
        model: constraintDefinitionModel,
        lints: constraintDefinitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "constraint def", fill: "#fff1f2", stroke: "#e11d48" }),
      }),

    ConstraintUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "constraint",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_CalculationBody"]!,
        ),
        symbol: usageAttrs("constraint"),
        queries: constraintUsageQueries,
        model: constraintUsageModel,
        lints: constraintUsageLintRules,
        graphics: () => sysmlUsageGraphics({ stereotype: "constraint", fill: "#fff1f2", stroke: "#f43f5e" }),
      }),

    AssertConstraintUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "assert",
          optional(field("isNegated", "not")),
          choice(
            seq($["OwnedReferenceSubsetting"]!, optional($["_FeatureSpecializationPart"]!)),
            seq("constraint", optional($["_UsageDeclaration"]!), optional($["_ValuePart"]!)),
          ),
          $["_CalculationBody"]!,
        ),
        symbol: usageAttrs("constraint"),
        queries: constraintUsageQueries,
        model: constraintUsageModel,
        lints: constraintUsageLintRules,
      }),

    // =====================================================================
    // REQUIREMENTS
    // =====================================================================

    RequirementDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "requirement",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: defAttrs("requirement"),
        queries: requirementQueries,
        model: requirementDefinitionModel,
        lints: {
          ...requirementDefinitionLintsEnhanced,
          evolutionCheck: (_db: QueryDB, self: SymbolEntry, previous?: SymbolEntry) => {
            if (previous) {
              const prevIsAbstract = (previous.metadata as Record<string, unknown>)?.["isAbstract"];
              const currIsAbstract = (self.metadata as Record<string, unknown>)?.["isAbstract"];
              if (currIsAbstract && !prevIsAbstract) {
                return error(SysML2ErrorCode.ABSTRACT_REQUIREMENT_VIOLATION.message(), {
                  code: SysML2ErrorCode.ABSTRACT_REQUIREMENT_VIOLATION.code,
                  field: "declaredName",
                });
              }
            }
            return null;
          },
        },
        graphics: () =>
          sysmlNodeGraphics({
            stereotype: "requirement def",
            fill: "#f5f3ff",
            stroke: "#7c3aed",
            width: 200,
            height: 70,
          }),
        diff: {
          ignore: ["description", "text"], // Formatting of text is ignored, logical rules matter
          breaking: ["subject", "isAbstract"],
        },
      }),

    _RequirementBody: ($) => choice(";", seq("{", repeat($["_RequirementBodyItem"]!), "}")),

    _RequirementBodyItem: ($) =>
      choice(
        $["_DefinitionBodyItem"]!,
        $["SubjectMember"]!,
        $["RequirementConstraintMember"]!,
        $["ActorMember"]!,
        $["StakeholderMember"]!,
      ),

    SubjectMember: ($) => seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["SubjectUsage"]!)),

    SubjectUsage: ($) =>
      def({
        syntax: seq("subject", repeat($["_usage_modifier"]!), $["_Usage"]!),
        symbol: usageAttrs("subject"),
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "subject", fill: "#f1f8e9", stroke: "#33691e" }),
      }),

    RequirementConstraintMember: ($) =>
      seq(
        optional($["VisibilityIndicator"]!),
        field("constraintKind", choice("assume", "require")),
        field("ownedRelatedElement", $["RequirementConstraintUsage"]!),
      ),

    RequirementConstraintUsage: ($) =>
      def({
        syntax: choice(
          seq($["OwnedReferenceSubsetting"]!, repeat($["_FeatureSpecialization"]!), $["_CalculationBody"]!),
          seq(
            repeat($["_usage_modifier"]!),
            optional("constraint"),
            optional($["_UsageDeclaration"]!),
            optional($["_ValuePart"]!),
            $["_CalculationBody"]!,
          ),
        ),
        symbol: usageAttrs("constraint"),
        queries: constraintUsageQueries,
        model: constraintUsageModel,
      }),

    ActorMember: ($) => seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["ActorUsage"]!)),

    ActorUsage: ($) =>
      def({
        syntax: seq("actor", repeat($["_usage_modifier"]!), $["_Usage"]!),
        symbol: usageAttrs("actor"),
        model: usageModel,
        graphics: () => ({
          role: "node",
          node: {
            shape: "rect",
            markup: [
              { tagName: "circle", selector: "actorHead" },
              { tagName: "line", selector: "actorSpine" },
              { tagName: "line", selector: "actorArms" },
              { tagName: "line", selector: "actorLeftLeg" },
              { tagName: "line", selector: "actorRightLeg" },
              { tagName: "text", selector: "stereotype" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              actorHead: { cx: 25, cy: 12, r: 8, fill: "#fff7ed", stroke: "#ea580c", strokeWidth: 1.5 },
              actorSpine: { x1: 25, y1: 20, x2: 25, y2: 38, stroke: "#ea580c", strokeWidth: 1.5 },
              actorArms: { x1: 10, y1: 26, x2: 40, y2: 26, stroke: "#ea580c", strokeWidth: 1.5 },
              actorLeftLeg: { x1: 25, y1: 38, x2: 12, y2: 54, stroke: "#ea580c", strokeWidth: 1.5 },
              actorRightLeg: { x1: 25, y1: 38, x2: 38, y2: 54, stroke: "#ea580c", strokeWidth: 1.5 },
              stereotype: {
                text: "«actor»",
                fill: "#ea580c",
                fontSize: 9,
                fontStyle: "italic",
                textAnchor: "middle",
                refX: 25,
                refY: 66,
              },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 11,
                fontWeight: "bold",
                textAnchor: "middle",
                refX: 25,
                refY: 78,
              },
            },
            size: { width: 50, height: 85 },
          },
        }),
      }),

    StakeholderMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["StakeholderUsage"]!)),

    StakeholderUsage: ($) =>
      def({
        syntax: seq("stakeholder", repeat($["_usage_modifier"]!), $["_Usage"]!),
        symbol: usageAttrs("stakeholder"),
        model: usageModel,
        graphics: () => sysmlUsageGraphics({ stereotype: "stakeholder", fill: "#fbe9e7", stroke: "#bf360c" }),
      }),

    RequirementUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "requirement",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: usageAttrs("requirement"),
        queries: requirementUsageQueries,
        model: requirementUsageModel,
        lints: requirementUsageLintsEnhanced,
        graphics: () => sysmlUsageGraphics({ stereotype: "requirement", fill: "#f5f3ff", stroke: "#8b5cf6" }),
      }),

    SatisfyRequirementUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          optional("assert"),
          optional(field("isNegated", "not")),
          "satisfy",
          choice(
            seq($["OwnedReferenceSubsetting"]!, optional($["_FeatureSpecializationPart"]!)),
            seq("requirement", optional($["_UsageDeclaration"]!)),
          ),
          optional($["_ValuePart"]!),
          optional(seq("by", field("satisfyingFeature", $["OwnedReferenceSubsetting"]!))),
          $["_RequirementBody"]!,
        ),
        symbol: usageAttrs("requirement"),
        queries: satisfyRequirementQueries,
        model: satisfyRequirementModel,
        lints: satisfyRequirementLints,
        graphics: () => sysmlEdgeGraphics({ label: "«satisfy»", stroke: "#7c3aed", strokeDasharray: "8 4" }),
      }),

    // =====================================================================
    // CONCERNS
    // =====================================================================

    ConcernDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "concern",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: defAttrs("concern"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "concern def", fill: "#fdf2f8", stroke: "#db2777" }),
      }),

    ConcernUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "concern",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: usageAttrs("concern"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "concern", fill: "#fdf2f8", stroke: "#ec4899" }),
      }),

    // =====================================================================
    // CASES
    // =====================================================================

    CaseDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "case",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_CaseBody"]!,
        ),
        symbol: defAttrs("case"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "case def", fill: "#ede7f6", stroke: "#4527a0" }),
      }),

    _CaseBody: ($) =>
      choice(
        ";",
        seq(
          "{",
          repeat(
            choice(
              $["_ActionBodyItem"]!,
              $["SubjectMember"]!,
              $["ActorMember"]!,
              $["StakeholderMember"]!,
              $["ObjectiveMember"]!,
            ),
          ),
          optional($["ResultExpressionMember"]!),
          "}",
        ),
      ),

    CaseUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "case",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_CaseBody"]!,
        ),
        symbol: usageAttrs("case"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "case", fill: "#ede7f6", stroke: "#311b92" }),
      }),

    AnalysisCaseDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "analysis",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_CaseBody"]!,
        ),
        symbol: defAttrs("analysisCase"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "analysis case def", fill: "#ede7f6", stroke: "#311b92" }),
      }),

    AnalysisCaseUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "analysis",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_CaseBody"]!,
        ),
        symbol: usageAttrs("analysisCase"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "analysis case", fill: "#ede7f6", stroke: "#512da8" }),
      }),

    VerificationCaseDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "verification",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_VerificationBody"]!,
        ),
        symbol: defAttrs("verificationCase"),
        queries: verificationCaseQueries,
        model: verificationCaseDefinitionModel,
        lints: verificationCaseDefinitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "verification def", fill: "#e8eaf6", stroke: "#3f51b5" }),
      }),

    VerificationCaseUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "verification",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_VerificationBody"]!,
        ),
        symbol: usageAttrs("verificationCase"),
        queries: verificationCaseUsageQueries,
        model: verificationCaseUsageModel,
        graphics: () => sysmlUsageGraphics({ stereotype: "verification case", fill: "#e8eaf6", stroke: "#1a237e" }),
        lints: verificationCaseUsageLints,
      }),

    _VerificationBody: ($) =>
      choice(";", seq("{", repeat($["_VerificationBodyItem"]!), optional($["ResultExpressionMember"]!), "}")),

    _VerificationBodyItem: ($) =>
      choice($["_ActionBodyItem"]!, $["VerifyRequirementUsageMember"]!, $["ObjectiveMember"]!, $["AnnotatingMember"]!),

    VerifyRequirementUsageMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["VerifyRequirementUsage"]!)),

    VerifyRequirementUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "verify",
          choice(
            seq($["OwnedReferenceSubsetting"]!, optional($["_FeatureSpecializationPart"]!)),
            seq("requirement", optional($["_UsageDeclaration"]!)),
          ),
          optional($["_ValuePart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: usageAttrs("verification"),
        queries: usageQueries,
        model: usageModel,
        lints: verifyRequirementLints,
        graphics: () => sysmlEdgeGraphics({ label: "«verify»", stroke: "#3f51b5", strokeDasharray: "4 4" }),
      }),

    ObjectiveMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["ObjectiveRequirementUsage"]!)),

    ObjectiveRequirementUsage: ($) =>
      def({
        syntax: seq(
          "objective",
          repeat($["_usage_modifier"]!),
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: usageAttrs("objective"),
        model: usageModel,
      }),

    UseCaseDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "use",
          "case",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_CaseBody"]!,
        ),
        symbol: defAttrs("useCase"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => ({
          role: "node",
          node: {
            shape: "ellipse",
            markup: [
              { tagName: "ellipse", selector: "body" },
              { tagName: "text", selector: "stereotype" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: {
                refCx: "50%",
                refCy: "50%",
                refRx: "50%",
                refRy: "50%",
                fill: "#fdf2f8",
                stroke: "#db2777",
                strokeWidth: 1.5,
              },
              stereotype: {
                text: "«use case def»",
                fill: "#db2777",
                fontSize: 10,
                fontStyle: "italic",
                textAnchor: "middle",
                refX: 0.5,
                refY: 18,
              },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 12,
                fontWeight: "bold",
                textAnchor: "middle",
                refX: 0.5,
                refY: 34,
              },
            },
            size: { width: 160, height: 60 },
          },
        }),
      }),

    UseCaseUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "use",
          "case",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_CaseBody"]!,
        ),
        symbol: usageAttrs("useCase"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => ({
          role: "node",
          node: {
            shape: "ellipse",
            markup: [
              { tagName: "ellipse", selector: "body" },
              { tagName: "text", selector: "stereotype" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: {
                refCx: "50%",
                refCy: "50%",
                refRx: "50%",
                refRy: "50%",
                fill: "#fdf2f8",
                stroke: "#db2777",
                strokeWidth: 1.5,
                strokeDasharray: "6 3",
              },
              stereotype: {
                text: "«use case»",
                fill: "#db2777",
                fontSize: 9,
                fontStyle: "italic",
                textAnchor: "middle",
                refX: 0.5,
                refY: 16,
              },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 12,
                fontWeight: "bold",
                textAnchor: "middle",
                refX: 0.5,
                refY: 32,
              },
            },
            size: { width: 140, height: 50 },
          },
        }),
      }),

    IncludeUseCaseUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "include",
          choice(
            seq($["OwnedReferenceSubsetting"]!, optional($["_FeatureSpecializationPart"]!)),
            seq("use", "case", optional($["_UsageDeclaration"]!)),
          ),
          optional($["_ValuePart"]!),
          $["_CaseBody"]!,
        ),
        symbol: usageAttrs("useCase"),
        queries: usageQueries,
        model: usageModel,
        graphics: () => ({
          role: "node",
          node: {
            shape: "ellipse",
            markup: [
              { tagName: "ellipse", selector: "body" },
              { tagName: "text", selector: "stereotype" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: {
                refCx: "50%",
                refCy: "50%",
                refRx: "50%",
                refRy: "50%",
                fill: "#fdf2f8",
                stroke: "#db2777",
                strokeWidth: 1.5,
                strokeDasharray: "6 3",
              },
              stereotype: {
                text: "«include»",
                fill: "#db2777",
                fontSize: 9,
                fontStyle: "italic",
                textAnchor: "middle",
                refX: 0.5,
                refY: 16,
              },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 12,
                fontWeight: "bold",
                textAnchor: "middle",
                refX: 0.5,
                refY: 32,
              },
            },
            size: { width: 140, height: 50 },
          },
        }),
      }),

    // =====================================================================
    // STATES
    // =====================================================================

    StateDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "state",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          choice(";", seq(optional(field("isParallel", "parallel")), "{", repeat($["_StateBodyItem"]!), "}")),
        ),
        symbol: (self: SysmlRuleSelf) => ({
          kind: "Definition" as const,
          name: self.declaredName,
          exports: [],
          attributes: {
            isAbstract: self.isAbstract,
            isVariation: self.isVariation,
            isParallel: self.isParallel,
          },
        }),
        queries: stateQueries,
        model: stateDefinitionModel,
        lints: stateDefinitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "state def", fill: "#fffbeb", stroke: "#d97706" }),
      }),

    _StateBodyItem: ($) =>
      choice(
        $["Import"]!,
        $["AliasMember"]!,
        $["DefinitionMember"]!,
        $["VariantUsageMember"]!,
        $["NonOccurrenceUsageMember"]!,
        $["OccurrenceUsageMember"]!,
        seq(optional($["EmptySuccessionMember"]!), $["_OccurrenceUsageElement"]!),
        $["TransitionUsageMember"]!,
        $["EntryActionMember"]!,
        $["DoActionMember"]!,
        $["ExitActionMember"]!,
        $["AnnotatingMember"]!,
      ),

    EntryActionMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), "entry", field("ownedRelatedElement", $["StateActionUsage"]!)),

    DoActionMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), "do", field("ownedRelatedElement", $["StateActionUsage"]!)),

    ExitActionMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), "exit", field("ownedRelatedElement", $["StateActionUsage"]!)),

    StateActionUsage: ($) =>
      choice(";", seq(optional($["_UsageDeclaration"]!), optional($["_ValuePart"]!), $["_ActionBody"]!)),

    StateUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "state",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          choice(";", seq(optional(field("isParallel", "parallel")), "{", repeat($["_StateBodyItem"]!), "}")),
        ),
        symbol: (self: SysmlRuleSelf) => ({
          kind: "Usage" as const,
          name: self.declaredName,
          attributes: {
            ...usageAttrs("state")(self).attributes,
            isParallel: self.isParallel,
          },
        }),
        queries: { ...usageQueries, ...stateQueries },
        model: stateUsageModel,
        lints: stateUsageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "state", fill: "#fffbeb", stroke: "#f59e0b" }),
      }),

    ExhibitStateUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "exhibit",
          choice(
            seq($["OwnedReferenceSubsetting"]!, optional($["_FeatureSpecializationPart"]!)),
            seq("state", optional($["_UsageDeclaration"]!)),
          ),
          optional($["_ValuePart"]!),
          choice(";", seq(optional(field("isParallel", "parallel")), "{", repeat($["_StateBodyItem"]!), "}")),
        ),
        symbol: (self: SysmlRuleSelf) => ({
          kind: "Usage" as const,
          name: self.declaredName,
          attributes: {
            ...usageAttrs("state")(self).attributes,
            isParallel: self.isParallel,
          },
          graphics: () => sysmlUsageGraphics({ stereotype: "exhibit", fill: "#fff8e1", stroke: "#ff8f00" }),
        }),
        queries: { ...usageQueries, ...stateQueries },
        model: stateUsageModel,
        lints: stateUsageLints,
      }),

    TransitionUsageMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["TransitionUsage"]!)),

    TransitionUsage: ($) =>
      def({
        syntax: seq(
          "transition",
          optional(seq(optional($["_UsageDeclaration"]!), "first")),
          ref({
            syntax: field("source", $["QualifiedName"]!),
            name: (self) => self.source,
            targetKinds: ["Feature"],
            resolve: "qualified",
          }),
          optional(seq("accept", field("trigger", $["PayloadFeatureMember"]!))),
          optional(seq("if", field("guard", $["OwnedExpression"]!))),
          optional(seq("do", field("effect", $["StateActionUsage"]!))),
          "then",
          $["ConnectorEndMember"]!,
          $["_ActionBody"]!,
        ),
        symbol: (self: SysmlRuleSelf) => ({
          ...usageAttrs("transition")(self),
          attributes: {
            ...usageAttrs("transition")(self).attributes,
            trigger: self.trigger,
            guard: self.guard,
            effect: self.effect,
          },
        }),
        queries: usageQueries,
        model: usageModel,
        lints: transitionUsageLints,
        graphics: () =>
          sysmlEdgeGraphics({
            label: "«transition»",
            stroke: "#f9a825",
            targetMarker: "classic",
            router: "manhattan",
            connector: "rounded",
          }),
      }),

    // =====================================================================
    // VIEWS
    // =====================================================================

    ViewDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "view",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          choice(";", seq("{", repeat(choice($["_DefinitionBodyItem"]!, $["ElementFilterMember"]!)), "}")),
        ),
        symbol: defAttrs("view"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "view def", fill: "#efebe9", stroke: "#4e342e" }),
      }),

    ViewUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "view",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          choice(";", seq("{", repeat(choice($["_DefinitionBodyItem"]!, $["ElementFilterMember"]!)), "}")),
        ),
        symbol: usageAttrs("view"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "view", fill: "#efebe9", stroke: "#6d4c41" }),
      }),

    ViewpointDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "viewpoint",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: defAttrs("viewpoint"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "viewpoint def", fill: "#efebe9", stroke: "#3e2723" }),
      }),

    ViewpointUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "viewpoint",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: usageAttrs("viewpoint"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "viewpoint", fill: "#efebe9", stroke: "#5d4037" }),
      }),

    // =====================================================================
    // RENDERINGS
    // =====================================================================

    RenderingDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "rendering", "def", $["_Definition"]!),
        symbol: defAttrs("rendering"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "rendering def", fill: "#fafafa", stroke: "#424242" }),
      }),

    RenderingUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "rendering", $["_Usage"]!),
        symbol: usageAttrs("rendering"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "rendering", fill: "#fafafa", stroke: "#616161" }),
      }),

    // =====================================================================
    // EXPRESSIONS (copied from KerML Expressions, flattened)
    // =====================================================================

    OwnedExpressionMember: ($) => field("ownedRelatedElement", $["OwnedExpression"]!),

    OwnedExpression: ($) => $["_Expression"]!,

    _Expression: ($) =>
      choice(
        $["ConditionalExpression"]!,
        $["NullCoalescingExpression"]!,
        $["ImpliesExpression"]!,
        $["OrExpression"]!,
        $["XorExpression"]!,
        $["AndExpression"]!,
        $["EqualityExpression"]!,
        $["ClassificationExpression"]!,
        $["RelationalExpression"]!,
        $["RangeExpression"]!,
        $["AdditiveExpression"]!,
        $["MultiplicativeExpression"]!,
        $["ExponentiationExpression"]!,
        $["UnaryExpression"]!,
        $["ExtentExpression"]!,
        $["MeasurementExpression"]!,
        $["PrimaryExpression"]!,
        $["_BaseExpression"]!,
      ),

    OwnedExpressionReference: ($) => field("ownedRelationship", $["OwnedExpressionMember"]!),

    ConditionalExpression: ($) =>
      prec.right(
        PREC.CONDITIONAL,
        seq(
          field("operator", "if"),
          field("operand", $["_Expression"]!),
          "?",
          field("thenOperand", $["OwnedExpressionReference"]!),
          "else",
          field("elseOperand", $["OwnedExpressionReference"]!),
        ),
      ),

    NullCoalescingExpression: ($) =>
      prec.left(
        PREC.NULL_COALESCING,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(seq(field("operator", "??"), field("operand", $["ImpliesExpressionReference"]!))),
        ),
      ),

    ImpliesExpressionReference: ($) => field("ownedRelationship", $["ImpliesExpressionMember"]!),
    ImpliesExpressionMember: ($) => field("ownedRelatedElement", $["_Expression"]!),

    ImpliesExpression: ($) =>
      prec.left(
        PREC.IMPLIES,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(seq(field("operator", "implies"), field("operand", $["ImpliesExpressionReference"]!))),
        ),
      ),

    OrExpressionReference: ($) => field("ownedRelationship", $["OrExpressionMember"]!),
    OrExpressionMember: ($) => field("ownedRelatedElement", $["_Expression"]!),

    OrExpression: ($) =>
      prec.left(
        PREC.OR,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(
            choice(
              seq(field("operator", "|"), field("operand", $["_Expression"]!)),
              seq(field("operator", "or"), field("operand", $["XorExpressionReference"]!)),
            ),
          ),
        ),
      ),

    XorExpressionReference: ($) => field("ownedRelationship", $["XorExpressionMember"]!),
    XorExpressionMember: ($) => field("ownedRelatedElement", $["_Expression"]!),

    XorExpression: ($) =>
      prec.left(
        PREC.XOR,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(seq(field("operator", "xor"), field("operand", $["_Expression"]!))),
        ),
      ),

    AndExpression: ($) =>
      prec.left(
        PREC.AND,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(
            choice(
              seq(field("operator", "&"), field("operand", $["_Expression"]!)),
              seq(field("operator", "and"), field("operand", $["EqualityExpressionReference"]!)),
            ),
          ),
        ),
      ),

    EqualityExpressionReference: ($) => field("ownedRelationship", $["EqualityExpressionMember"]!),
    EqualityExpressionMember: ($) => field("ownedRelatedElement", $["_Expression"]!),

    EqualityExpression: ($) =>
      prec.left(
        PREC.EQUALITY,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(seq(field("operator", $["EqualityOperator"]!), field("operand", $["_Expression"]!))),
        ),
      ),

    EqualityOperator: () => choice("==", "!=", "===", "!=="),

    ClassificationExpression: ($) =>
      prec(
        PREC.CLASSIFICATION,
        choice(
          seq(
            field("operand", $["_Expression"]!),
            choice(
              seq(
                field("operator", $["ClassificationTestOperator"]!),
                field("typeReference", $["TypeReferenceMember"]!),
              ),
              seq(field("operator", $["CastOperator"]!), field("typeResult", $["TypeResultMember"]!)),
            ),
          ),
          seq(field("operator", $["ClassificationTestOperator"]!), field("typeReference", $["TypeReferenceMember"]!)),
          seq(
            field("operand", $["MetadataReference"]!),
            field("operator", $["MetaClassificationTestOperator"]!),
            field("typeReference", $["TypeReferenceMember"]!),
          ),
          seq(field("operator", $["CastOperator"]!), field("typeResult", $["TypeResultMember"]!)),
          seq(
            field("operand", $["MetadataReference"]!),
            field("operator", $["MetaCastOperator"]!),
            field("typeResult", $["TypeResultMember"]!),
          ),
        ),
      ),

    ClassificationTestOperator: () => choice("hastype", "istype", "@"),
    MetaClassificationTestOperator: () => "@@",
    CastOperator: () => "as",
    MetaCastOperator: () => "meta",

    MetadataReference: ($) => field("ownedRelationship", $["ElementReferenceMember"]!),

    TypeReferenceMember: ($) => field("ownedRelatedElement", $["TypeReference"]!),
    TypeResultMember: ($) => field("ownedRelatedElement", $["TypeReference"]!),
    TypeReference: ($) => field("ownedRelationship", $["ReferenceTyping"]!),

    ReferenceTyping: ($) =>
      ref({
        syntax: field("type", $["QualifiedName"]!),
        name: (self) => self.type,
        targetKinds: ["Type"],
        resolve: "qualified",
      }),

    RelationalExpression: ($) =>
      prec.left(
        PREC.RELATIONAL,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(seq(field("operator", $["RelationalOperator"]!), field("operand", $["_Expression"]!))),
        ),
      ),
    RelationalOperator: () => choice("<", ">", "<=", ">="),

    RangeExpression: ($) =>
      prec.left(
        PREC.RANGE,
        seq(field("operand", $["_Expression"]!), field("operator", ".."), field("operand", $["_Expression"]!)),
      ),

    AdditiveExpression: ($) =>
      prec.left(
        PREC.ADDITIVE,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(seq(field("operator", $["AdditiveOperator"]!), field("operand", $["_Expression"]!))),
        ),
      ),
    AdditiveOperator: () => choice("+", "-"),

    MultiplicativeExpression: ($) =>
      prec.left(
        PREC.MULTIPLICATIVE,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(seq(field("operator", $["MultiplicativeOperator"]!), field("operand", $["_Expression"]!))),
        ),
      ),
    MultiplicativeOperator: () => choice("*", "/", "%"),

    ExponentiationExpression: ($) =>
      prec.right(
        PREC.EXPONENTIATION,
        seq(
          field("base", $["_Expression"]!),
          field("operator", $["ExponentiationOperator"]!),
          field("exponent", $["_Expression"]!),
        ),
      ),
    ExponentiationOperator: () => choice("**", "^"),

    UnaryExpression: ($) =>
      prec(PREC.UNARY, seq(field("operator", $["UnaryOperator"]!), field("operand", $["_Expression"]!))),
    UnaryOperator: () => choice("+", "-", "~", "not"),

    ExtentExpression: ($) =>
      prec(PREC.EXTENT, seq(field("operator", "all"), field("typeResult", $["TypeResultMember"]!))),

    _postfix_operation: ($) =>
      seq(
        choice(
          seq("#", "(", field("indexOperand", $["SequenceExpression"]!), ")"),
          seq(field("operator", "["), field("filterOperand", $["SequenceExpression"]!), "]"),
          seq(
            "->",
            field("invocationType", $["InstantiatedTypeMember"]!),
            choice(
              field("body", $["BodyExpression"]!),
              field("functionRef", $["FunctionReferenceExpression"]!),
              $["_ArgumentList"]!,
            ),
          ),
          seq(".", field("collect", $["BodyExpression"]!)),
          seq(".?", field("select", $["BodyExpression"]!)),
        ),
        optional(seq(".", field("featureChain", $["FeatureChainMember"]!))),
      ),

    MeasurementExpression: ($) =>
      prec.left(
        PREC.PRIMARY,
        seq(
          field("value", choice($["_LiteralExpression"]!, $["FeatureReferenceExpression"]!)),
          "[",
          field("unit", $["_UnitExpression"]!),
          "]",
        ),
      ),

    _UnitExpression: ($) =>
      choice($["UnitBinaryExpression"]!, $["UnitExponentExpression"]!, $["_UnitPrimaryExpression"]!),

    UnitBinaryExpression: ($) =>
      prec.left(
        PREC.MULTIPLICATIVE,
        seq(
          field("left", $["_UnitExpression"]!),
          field("operator", choice("*", "/")),
          field("right", $["_UnitExpression"]!),
        ),
      ),

    UnitExponentExpression: ($) =>
      prec.right(
        PREC.EXPONENTIATION,
        seq(
          field("base", $["_UnitPrimaryExpression"]!),
          field("operator", choice("^", "**")),
          field("exponent", choice($["LiteralInteger"]!, seq("-", $["LiteralInteger"]!))),
        ),
      ),

    _UnitPrimaryExpression: ($) => choice($["FeatureReferenceExpression"]!, seq("(", $["_UnitExpression"]!, ")")),

    PrimaryExpression: ($) =>
      prec.left(
        PREC.PRIMARY,
        choice(
          seq(
            field("base", $["_BaseExpression"]!),
            seq(".", field("featureChain", $["FeatureChainMember"]!)),
            repeat($["_postfix_operation"]!),
          ),
          seq(field("base", $["_BaseExpression"]!), repeat1($["_postfix_operation"]!)),
        ),
      ),

    FunctionReferenceExpression: ($) => field("ownedRelationship", $["FunctionReferenceMember"]!),
    FunctionReferenceMember: ($) => field("ownedRelatedElement", $["FunctionReference"]!),
    FunctionReference: ($) => field("ownedRelationship", $["ReferenceTyping"]!),

    FeatureChainMember: ($) =>
      choice(
        ref({
          syntax: field("memberElement", $["QualifiedName"]!),
          name: (self) => self.memberElement,
          targetKinds: ["Feature"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $["OwnedFeatureChain"]!),
      ),

    OwnedFeatureChain: ($) => $["_FeatureChain"]!,

    _BaseExpression: ($) =>
      choice(
        $["NullExpression"]!,
        $["_LiteralExpression"]!,
        $["FeatureReferenceExpression"]!,
        $["MetadataAccessExpression"]!,
        $["InvocationExpression"]!,
        $["ConstructorExpression"]!,
        $["BodyExpression"]!,
        seq("(", $["SequenceExpression"]!, ")"),
      ),

    // SysML2 overrides ExpressionBody to use CalculationBody
    BodyExpression: ($) => field("ownedRelationship", $["ExpressionBodyMember"]!),
    ExpressionBodyMember: ($) => field("ownedRelatedElement", $["ExpressionBody"]!),
    ExpressionBody: ($) => $["_CalculationBody"]!,

    SequenceExpression: ($) =>
      seq(
        $["OwnedExpression"]!,
        optional(choice(",", seq(field("operator", ","), field("operand", $["SequenceExpression"]!)))),
      ),

    FeatureReferenceExpression: ($) => field("ownedRelationship", $["FeatureReferenceMember"]!),
    FeatureReferenceMember: ($) =>
      ref({
        syntax: field("memberElement", $["QualifiedName"]!),
        name: (self) => self.memberElement,
        targetKinds: ["Feature"],
        resolve: "qualified",
      }),

    MetadataAccessExpression: ($) => seq(field("ownedRelationship", $["ElementReferenceMember"]!), ".", "metadata"),
    ElementReferenceMember: ($) =>
      ref({
        syntax: field("memberElement", $["QualifiedName"]!),
        name: (self) => self.memberElement,
        targetKinds: ["Element"],
        resolve: "qualified",
      }),

    InvocationExpression: ($) => seq(field("type", $["InstantiatedTypeMember"]!), $["_ArgumentList"]!),
    ConstructorExpression: ($) =>
      seq("new", field("type", $["InstantiatedTypeMember"]!), field("result", $["ConstructorResultMember"]!)),
    ConstructorResultMember: ($) => field("ownedRelatedElement", $["ConstructorResult"]!),
    ConstructorResult: ($) => $["_ArgumentList"]!,

    InstantiatedTypeMember: ($) =>
      choice(
        ref({
          syntax: field("memberElement", $["QualifiedName"]!),
          name: (self) => self.memberElement,
          targetKinds: ["Type"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $["OwnedFeatureChain"]!),
      ),

    _FeatureChain: ($) =>
      seq(
        field("chaining", $["OwnedFeatureChaining"]!),
        repeat1(seq(".", field("chaining", $["OwnedFeatureChaining"]!))),
      ),

    OwnedFeatureChaining: ($) =>
      ref({
        syntax: field("chainingFeature", $["QualifiedName"]!),
        name: (self) => self.chainingFeature,
        targetKinds: ["Feature"],
        resolve: "qualified",
      }),

    _ArgumentList: ($) => seq("(", optional(choice($["_PositionalArgumentList"]!, $["_NamedArgumentList"]!)), ")"),

    _PositionalArgumentList: ($) =>
      seq(field("argument", $["ArgumentMember"]!), repeat(seq(",", field("argument", $["ArgumentMember"]!)))),

    ArgumentMember: ($) => field("ownedRelatedElement", $["Argument"]!),
    Argument: ($) => field("ownedRelationship", $["ArgumentValue"]!),

    _NamedArgumentList: ($) =>
      seq(
        field("namedArgument", $["NamedArgumentMember"]!),
        repeat(seq(",", field("namedArgument", $["NamedArgumentMember"]!))),
      ),

    NamedArgumentMember: ($) => field("ownedRelatedElement", $["NamedArgument"]!),
    NamedArgument: ($) =>
      seq(field("parameterRedefinition", $["ParameterRedefinition"]!), "=", field("value", $["ArgumentValue"]!)),

    ParameterRedefinition: ($) =>
      ref({
        syntax: field("redefinedFeature", $["QualifiedName"]!),
        name: (self) => self.redefinedFeature,
        targetKinds: ["Feature"],
        resolve: "qualified",
      }),

    ArgumentValue: ($) => field("ownedRelatedElement", $["OwnedExpression"]!),

    NullExpression: () => choice("null", seq("(", ")")),

    _LiteralExpression: ($) =>
      choice($["LiteralBoolean"]!, $["LiteralString"]!, $["LiteralInteger"]!, $["LiteralReal"]!, $["LiteralInfinity"]!),

    LiteralBoolean: ($) => field("value", $["BooleanValue"]!),
    BooleanValue: () => choice("true", "false"),
    LiteralString: ($) => field("value", $["STRING_VALUE"]!),
    LiteralInteger: ($) => field("value", $["DECIMAL_VALUE"]!),
    LiteralReal: ($) => field("value", $["RealValue"]!),
    RealValue: ($) =>
      choice(seq(optional($["DECIMAL_VALUE"]!), ".", choice($["DECIMAL_VALUE"]!, $["EXP_VALUE"]!)), $["EXP_VALUE"]!),
    LiteralInfinity: () => "*",

    // =====================================================================
    // NAMES
    // =====================================================================

    Name: ($) => choice($["ID"]!, $["UNRESTRICTED_NAME"]!),
    GlobalQualification: () => seq("$", "::"),
    Qualification: ($) => seq($["Name"]!, "::"),
    QualifiedName: ($) =>
      choice(
        seq(optional($["GlobalQualification"]!), field("name", $["Name"]!)),
        prec.left(1, seq($["QualifiedName"]!, "::", field("name", $["Name"]!))),
      ),

    // =====================================================================
    // TERMINALS
    // =====================================================================

    DECIMAL_VALUE: () => token(/[0-9]+/),
    EXP_VALUE: () => token(/[0-9]+[eE][+-]?[0-9]+/),
    ID: () => token(/[a-zA-Z_][a-zA-Z_0-9\u00B2\u00B3\u00B9\u2070-\u2079]*/),
    UNRESTRICTED_NAME: () => token(/'(?:[^'\\]|\\.)*'/),
    STRING_VALUE: () => token(/"(?:[^"\\]|\\.)*"/),
    REGULAR_COMMENT: () => token(/\/\*[^*]*\*+([^/*][^*]*\*+)*\//),
    ML_NOTE: () => token(/\/\*[^*]*\*+([^/*][^*]*\*+)*\//),
    SL_NOTE: () => token(/\/\/[^\r\n]*/),
  },

  polyglot: {
    languages: ["modelica", "owl2", "step"],
    typeMaps: {
      modelica: {
        "KerML::Real": "Real",
        "ISQ::Real": "Real",
        "KerML::Integer": "Integer",
        "KerML::Boolean": "Boolean",
        "KerML::String": "String",
      },
      step: {
        "KerML::Real": "REAL",
        "ISQ::Real": "REAL",
        "KerML::Integer": "INTEGER",
        "KerML::Boolean": "BOOLEAN",
        "KerML::String": "STRING",
      },
      owl2: {
        "KerML::Real": "xsd:double",
        "ISQ::Real": "xsd:double",
        "KerML::Integer": "xsd:integer",
        "KerML::Boolean": "xsd:boolean",
        "KerML::String": "xsd:string",
      },
    },
    rules: [
      tggRule({
        name: "PartDefToModelicaModel",
        targetLang: "modelica",
        sourceLang: "sysml2",
        priority: 0,
        source: ($, v) => $.PartDefinition({ declaredName: v("className") }),
        target: ($, v) => $.ClassDefinition({ name: v("className"), classKind: "model" }),
        where: (v) => [tggEq(v("className"), v("className")), tggDefaultVal(v("isAbstract"), false)],
      }),
      tggRule({
        name: "AttributeDefToModelicaRecord",
        targetLang: "modelica",
        sourceLang: "sysml2",
        priority: 0,
        source: ($, v) => $.AttributeDefinition({ declaredName: v("className") }),
        target: ($, v) => $.ClassDefinition({ name: v("className"), classKind: "record" }),
        where: (v) => [tggEq(v("className"), v("className")), tggDefaultVal(v("isAbstract"), false)],
      }),
      tggRule({
        name: "PortDefToModelicaConnector",
        targetLang: "modelica",
        sourceLang: "sysml2",
        priority: 0,
        source: ($, v) => $.PortDefinition({ declaredName: v("className") }),
        target: ($, v) => $.ClassDefinition({ name: v("className"), classKind: "connector" }),
        where: (v) => [tggEq(v("className"), v("className")), tggDefaultVal(v("isAbstract"), false)],
      }),
      tggRule({
        name: "ConnectionDefToModelicaModel",
        targetLang: "modelica",
        sourceLang: "sysml2",
        priority: -1,
        source: ($, v) => $.ConnectionDefinition({ declaredName: v("className") }),
        target: ($, v) => $.ClassDefinition({ name: v("className"), classKind: "model" }),
        where: (v) => [tggEq(v("className"), v("className")), tggDefaultVal(v("isAbstract"), false)],
      }),
      tggRule({
        name: "AttributeUsageToModelicaParameter",
        targetLang: "modelica",
        sourceLang: "sysml2",
        priority: 10,
        source: ($, v) => $.AttributeUsage({ declaredName: v("compName"), declaredType: v("typeName") }),
        target: ($, v) =>
          $.ComponentClause({ name: v("compName"), typeSpecifier: v("typeName"), variability: "parameter" }),
        where: (v) => [
          tggEq(v("compName"), v("compName")),
          tggTypeMap(v("typeName"), v("typeName"), "modelica"),
          tggDefaultVal(v("variability"), "parameter"),
        ],
      }),
      tggRule({
        name: "PartUsageToModelicaComponent",
        targetLang: "modelica",
        sourceLang: "sysml2",
        priority: 0,
        source: ($, v) =>
          $.PartUsage({
            declaredName: v("compName"),
            declaredType: v("typeName"),
            redefinedAttributes: v("mods"),
            multiplicity: v("dims"),
          }),
        target: ($, v) =>
          $.ComponentClause({
            name: v("compName"),
            typeSpecifier: v("typeName"),
            variability: "continuous",
            modifications: v("mods"),
            dimensions: v("dims"),
          }),
        where: (v) => [
          tggEq(v("compName"), v("compName")),
          tggTypeMap(v("typeName"), v("typeName"), "modelica"),
          tggEq(v("dims"), v("dims")),
          tggForEach(v("mods"), v("mod"), [tggEq(v("mod"), v("mod"))]),
        ],
      }),
      tggRule({
        name: "SysmlElectricalPortToModelicaPin",
        targetLang: "modelica",
        sourceLang: "sysml2",
        priority: 15,
        source: ($, v) => $.PortUsage({ declaredName: v("portName"), declaredType: "ElectricalPort" }),
        target: ($, v) =>
          $.ComponentClause({ name: v("portName"), typeSpecifier: "Modelica.Electrical.Analog.Interfaces.Pin" }),
        where: (v) => [tggEq(v("portName"), v("portName")), tggPhysicalPort(v("v"), v("i"), "electrical")],
      }),
      tggRule({
        name: "RequirementUsageToModelicaAssert",
        targetLang: "modelica",
        sourceLang: "sysml2",
        source: ($, v) => $.RequirementUsage({ declaredName: v("reqName"), condition: v("condExpr") }),
        target: ($, v) => $.AssertStatement({ condition: v("condExpr"), message: v("reqName") }),
        where: (v) => [tggEq(v("reqName"), v("reqName")), tggEq(v("condExpr"), v("condExpr"))],
      }),
      tggRule({
        name: "PortUsageToModelicaComponent",
        targetLang: "modelica",
        sourceLang: "sysml2",
        priority: 5,
        source: ($, v) => $.PortUsage({ declaredName: v("compName"), declaredType: v("typeName") }),
        target: ($, v) =>
          $.ComponentClause({ name: v("compName"), typeSpecifier: v("typeName"), variability: "discrete" }),
        where: (v) => [tggEq(v("compName"), v("compName")), tggTypeMap(v("typeName"), v("typeName"), "modelica")],
      }),
      tggRule({
        name: "ConnectionUsageToModelicaConnect",
        targetLang: "modelica",
        sourceLang: "sysml2",
        source: ($, v) => $.ConnectionUsage({ declaredName: v("connName") }),
        target: ($, v) => $.ConnectClause({ name: v("connName") }),
        where: (v) => [tggEq(v("connName"), v("connName"))],
      }),
      tggRule({
        name: "ConstraintUsageToModelicaEquation",
        targetLang: "modelica",
        sourceLang: "sysml2",
        source: ($, v) => $.ConstraintUsage({ declaredName: v("eqName") }),
        target: ($, v) => $.EquationClause({ name: v("eqName") }),
        where: (v) => [tggEq(v("eqName"), v("eqName"))],
      }),
      tggRule({
        name: "SysmlConstraintUsageToModelicaSimpleEquation",
        targetLang: "modelica",
        sourceLang: "sysml2",
        priority: 5,
        source: ($, v) => $.ConstraintUsage({ declaredName: v("eqName"), condition: v("eqExpr") }),
        target: ($, v) => $.SimpleEquation({ lhs: v("eqName"), rhs: v("eqExpr") }),
        where: (v) => [
          tggEq(v("eqName"), v("eqName")),
          tggEq(v("eqExpr"), v("eqExpr")),
          tggExprMap(v("eqExpr"), v("eqExpr")),
        ],
      }),
      tggRule({
        name: "SysmlRateConstraintToModelicaDerEquation",
        targetLang: "modelica",
        sourceLang: "sysml2",
        priority: 10,
        source: ($, v) => $.ConstraintUsage({ declaredName: v("rateName"), condition: v("rate") }),
        target: ($, v) => $.DerEquation({ stateVar: v("state"), rateExpr: v("rate") }),
        where: (v) => [
          tggDefaultVal(v("rateName"), "rate_eq"),
          tggEq(v("state"), tggDer(v("state"), 1)),
          tggExprMap(v("rate"), v("rate")),
        ],
      }),
      tggRule({
        name: "SysmlCalcDefToModelicaFunction",
        targetLang: "modelica",
        sourceLang: "sysml2",
        priority: 5,
        source: ($, v) => $.CalcDefinition({ declaredName: v("funcName") }),
        target: ($, v) => $.ClassDefinition({ name: v("funcName"), classKind: "function" }),
        where: (v) => [
          tggEq(v("funcName"), v("funcName")),
          tggDefaultVal(v("isAbstract"), false),
          tggComplement(["inputs", "outputs", "body"]),
        ],
      }),
      tggRule({
        name: "SysML2ToOWL2Class",
        targetLang: "owl2",
        sourceLang: "sysml2",
        source: ($, v) => $.PartDefinition({ declaredName: v("className") }),
        target: ($, v) => $.ClassDeclaration({ iri: v("iri") }),
        where: (v) => [tggFormatUri(v("className"), "sysml:", v("iri"))],
      }),
      tggRule({
        name: "SysML2ToOWL2SubClassOf",
        targetLang: "owl2",
        sourceLang: "sysml2",
        source: ($, v) => $.Specialization({ specificType: v("subClass"), generalType: v("superClass") }),
        target: ($, v) => $.SubClassOfAxiom({ subClassIri: v("subIri"), superClassIri: v("superIri") }),
        where: (v) => [
          tggFormatUri(v("subClass"), "sysml:", v("subIri")),
          tggFormatUri(v("superClass"), "sysml:", v("superIri")),
        ],
      }),
      tggRule({
        name: "SysML2ToOWL2ObjectProperty",
        targetLang: "owl2",
        sourceLang: "sysml2",
        source: ($, v) => $.PortDefinition({ declaredName: v("propName") }),
        target: ($, v) => $.ObjectPropertyDeclaration({ iri: v("iri") }),
        where: (v) => [tggFormatUri(v("propName"), "sysml:", v("iri"))],
      }),
      tggRule({
        name: "SysML2ToOWL2DataProperty",
        targetLang: "owl2",
        sourceLang: "sysml2",
        source: ($, v) => $.AttributeDefinition({ declaredName: v("attrName") }),
        target: ($, v) => $.DataPropertyDeclaration({ iri: v("iri") }),
        where: (v) => [tggFormatUri(v("attrName"), "sysml:", v("iri"))],
      }),
      tggRule({
        name: "SysML2ToOWL2Individual",
        targetLang: "owl2",
        sourceLang: "sysml2",
        source: ($, v) => $.PartUsage({ declaredName: v("indivName"), declaredType: v("className") }),
        target: ($, v) => $.NamedIndividualDeclaration({ iri: v("indivIri"), classIri: v("classIri") }),
        where: (v) => [
          tggFormatUri(v("indivName"), "sysml:", v("indivIri")),
          tggFormatUri(v("className"), "sysml:", v("classIri")),
        ],
      }),
      tggRule({
        name: "SysML2ToStepProduct",
        targetLang: "step",
        sourceLang: "sysml2",
        source: ($, v) => $.PartDefinition({ declaredName: v("partName") }),
        target: ($, v) => $.ProductDefinition({ name: v("partName"), description: v("desc") }),
        where: (v) => [tggEq(v("partName"), v("partName")), tggDefaultVal(v("desc"), "SysML Part")],
      }),
      tggRule({
        name: "SysML2ToStepMeasure",
        targetLang: "step",
        sourceLang: "sysml2",
        source: ($, v) => $.AttributeUsage({ declaredName: v("attrName"), declaredType: v("attrType") }),
        target: ($, v) => $.PropertyDefinition({ propertyName: v("attrName"), valueType: v("valType") }),
        where: (v) => [tggEq(v("attrName"), v("attrName")), tggTypeMap(v("attrType"), v("valType"), "step")],
      }),
      tggRule({
        name: "SysML2ToStepPlacement",
        targetLang: "step",
        sourceLang: "sysml2",
        source: ($, v) => $.PortUsage({ declaredName: v("portName") }),
        target: ($, v) => $.Axis2Placement3D({ placementName: v("portName") }),
        where: (v) => [tggEq(v("portName"), v("portName"))],
      }),
    ],
  },
});

export default sysml2Language;
