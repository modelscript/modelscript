// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Semantic Queries, AST Models, and KerML Expression Evaluator.
 *
 * Implements Salsa memoized query descriptors, AST model interfaces, and zero-allocation
 * CST expression evaluation for SysML v2 / KerML declarations.
 */

import type { CSTNode } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { globalLibraryRegistry, TableauReasoner } from "@modelscript/runtime";
import {
  collapseWhitespace,
  collectCstLeaves,
  parseSignedNumberFromLeaves,
  parseSysmlSource,
  readDottedChainFromLeaves,
  stripNamespaceWildcard,
  stripSurroundingQuotes,
} from "./cst-utils.js";
import { emitAxioms } from "./reasoner-bridge.js";

function extractSysmlImplementsTarget(clause: string): string | undefined {
  const leaves = collectCstLeaves(parseSysmlSource(clause));
  for (let i = 0; i + 5 < leaves.length; i++) {
    if (
      leaves[i]!.text === "SysML" &&
      leaves[i + 1]!.text === "(" &&
      leaves[i + 2]!.text === "implements" &&
      leaves[i + 3]!.text === "=" &&
      leaves[i + 5]!.text === ")"
    ) {
      const valTok = leaves[i + 4]!.text;
      if (valTok.length >= 2 && valTok.startsWith('"') && valTok.endsWith('"')) {
        const inner = stripSurroundingQuotes(valTok);
        return inner.length > 0 ? inner : undefined;
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---- shared attribute extractors ----
export const meta = (self: SymbolEntry) => self.metadata as Record<string, unknown> | null;
export const metaStr = (self: SymbolEntry, key: string): string | null => (meta(self)?.[key] as string) ?? null;

// ---- shared symbol helpers ----

export interface SysmlRuleSelf {
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
  isNegated?: boolean | string | undefined;
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
export const defAttrs = (_defKind: string) => (self: SysmlRuleSelf) => ({
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
export const usageAttrs = (_usageKind: string) => (self: SysmlRuleSelf) => ({
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
    isNegated: self.isNegated,
    shortName: self.declaredShortName,
    multiplicityLower: self.ownedMultiplicity?.ownedRelatedElement?.lowerBound,
    multiplicityUpper: self.ownedMultiplicity?.ownedRelatedElement?.upperBound,
    value: self["ownedRelatedElement"],
    expression: self["ownedRelatedElement"],
  },
});

// ---- shared queries ----

/** Shared queries for all Definition and Package rules */
export const namespaceQueries = {
  members: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id),
  ownedDefinitions: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.kind === "Definition" || c.kind === "Enumeration"),
  ownedUsages: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Usage"),
  imports: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Import"),
};

/** Structural queries for definitions — filter children by usageKind metadata */
export const definitionStructuralQueries = {
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
      if (!entry) return null;

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
        implementsTarget = extractSysmlImplementsTarget(ann);
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
export function resolveQualifiedPath(db: QueryDB, roots: SymbolEntry[], segments: string[]): SymbolEntry | null {
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
export const resolveFeatureInScope = (db: QueryDB, scopeId: number | null, name: string): SymbolEntry | null => {
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
            const rawPkg = stripNamespaceWildcard(importTarget);
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

  const rootGlobal =
    globals.find(
      (g) =>
        (g.language === "sysml2" || g.language === "sysml" || !g.language) &&
        (g.parentId === null || g.kind === "Package"),
    ) ??
    globals.find((g) => {
      if (g.parentId === null || g.kind === "Package") return true;
      if (!g.language || g.language === "sysml2" || g.language === "sysml") return false;
      const parent = db.symbol(g.parentId);
      return Boolean(
        parent &&
        parent.parentId === null &&
        (parent.ruleName === "reqif_specification" ||
          parent.ruleName === "scad_file" ||
          parent.ruleName === "step_product" ||
          parent.ruleName === "pscad_library" ||
          parent.ruleName === "pscad_project"),
      );
    });
  return rootGlobal ?? null;
};

/** Queries for all Usage rules */
export const usageQueries = {
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
export const definitionModel = {
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
export const usageModel = {
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
export const packageModel = {
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
export type EvalResult = number | boolean | string | null | undefined;

/** Optional variable/path binding overrides active during constraint or calculation evaluation. */
export type EvalBindings = ReadonlyMap<string, EvalResult>;

function extractValueExprFromFeatureNode(cst: CSTNode): CSTNode | null {
  for (const child of cst.children) {
    if (child.type === "OwnedExpression") return child;
    if (child.type === "ResultExpressionMember") {
      return child.childForFieldName("ownedRelatedElement") ?? child.children[0] ?? null;
    }
    if (child.type === "FeatureValue" || child.type === "ValuePart" || child.type === "_ValuePart") {
      const inner =
        child.children.find((c) => c.type === "OwnedExpression") ??
        child.childForFieldName("ownedRelatedElement") ??
        child.children.find((c) => c.type !== "=" && c.type !== ":=" && c.type !== "default");
      if (inner) return inner;
    }
  }
  return null;
}

function getEffectiveFeatureNames(db: QueryDB, entry: SymbolEntry): string[] {
  const names: string[] = [];
  if (
    entry.name &&
    entry.name !== "<anonymous>" &&
    entry.name !== entry.ruleName &&
    !entry.name.startsWith("redefines ")
  ) {
    names.push(entry.name);
  }
  for (const child of db.childrenOf(entry.id)) {
    if ((child.ruleName === "OwnedRedefinition" || child.ruleName === "OwnedSubsetting") && child.name) {
      const seg = child.name.split("::").pop()?.split(".").pop()?.trim();
      if (seg && !names.includes(seg)) names.push(seg);
    }
  }
  return names;
}

function findMemberRecursiveInType(
  db: QueryDB,
  typeSym: SymbolEntry,
  memberName: string,
  visited = new Set<number>(),
): SymbolEntry | null {
  if (visited.has(typeSym.id)) return null;
  visited.add(typeSym.id);

  for (const child of db.childrenOf(typeSym.id)) {
    const names = getEffectiveFeatureNames(db, child);
    if (names.includes(memberName)) return child;
  }

  // Check inherited types via typing / subsetting / subclassification
  for (const child of db.childrenOf(typeSym.id)) {
    if (
      (child.ruleName === "OwnedFeatureTyping" ||
        child.ruleName === "OwnedSubclassification" ||
        child.ruleName === "OwnedSubsetting") &&
      child.name
    ) {
      const superSym = resolveFeatureInScope(db, typeSym.parentId, child.name);
      if (superSym) {
        const hit = findMemberRecursiveInType(db, superSym, memberName, visited);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/**
 * Collect effective attribute values on a Part/Requirement/Definition by walking its
 * supertype/superclassification hierarchy first and applying local overrides & `:>>` redefinitions.
 */
export function collectEffectiveSubjectAttributes(
  db: QueryDB,
  entry: SymbolEntry,
  visited = new Set<number>(),
  baseBindings?: EvalBindings,
): Map<string, EvalResult> {
  const attrs = new Map<string, EvalResult>();
  if (visited.has(entry.id)) return attrs;
  visited.add(entry.id);

  // 1. Inherit defaults from supertype / superclassifiers first
  for (const child of db.childrenOf(entry.id)) {
    if (
      (child.ruleName === "OwnedFeatureTyping" ||
        child.ruleName === "OwnedSubclassification" ||
        child.ruleName === "OwnedSubsetting") &&
      child.name
    ) {
      const baseSym = resolveFeatureInScope(db, entry.parentId, child.name);
      if (baseSym) {
        const baseAttrs = collectEffectiveSubjectAttributes(db, baseSym, visited, baseBindings);
        for (const [k, v] of baseAttrs) {
          attrs.set(k, v);
        }
      }
    }
  }

  // 2. Apply direct child usage bindings (evaluating with prior attributes available)
  for (const child of db.childrenOf(entry.id)) {
    if (child.kind !== "Usage") continue;
    if (
      child.ruleName === "SatisfyRequirementUsage" ||
      child.ruleName === "VerifyRequirementUsage" ||
      child.ruleName === "RequirementConstraintUsage"
    ) {
      continue;
    }
    const mergedScopeBindings = baseBindings ? new Map<string, EvalResult>([...baseBindings, ...attrs]) : attrs;
    const val = getFeatureValue(db, child, entry.id, mergedScopeBindings);
    if (val !== undefined) {
      for (const fname of getEffectiveFeatureNames(db, child)) {
        attrs.set(fname, val);
      }
    }
  }

  return attrs;
}

/**
 * Resolve the type entry for a feature usage.
 * Reads the OwnedFeatureTyping child's name and resolves via resolveFeatureInScope.
 */
export const resolveTypeOf = (db: QueryDB, entry: SymbolEntry): SymbolEntry | null => {
  return usageQueries.resolvedType(db, entry);
};

/**
 * Get the bound value of a feature (from modification, default value, etc.).
 * Returns undefined if no value is bound.
 */
export const getFeatureValue = (
  db: QueryDB,
  entry: SymbolEntry,
  evalScopeId?: number | null,
  bindings?: EvalBindings,
): EvalResult => {
  const cst = db.cstNode(entry.id) as CSTNode | null;
  if (cst) {
    const exprNode = extractValueExprFromFeatureNode(cst);
    if (exprNode) {
      return evaluateExpressionNode(db, exprNode, evalScopeId ?? entry.parentId, bindings);
    }
  }

  // Fallback for compact text assignments when CST children lack FeatureValue wrapper
  const text = db.cstText(entry.startOffset, entry.endOffset, entry);
  if (text) {
    const cstLeaves = cst ? collectCstLeaves(cst as unknown as Parameters<typeof collectCstLeaves>[0]) : [];
    const leaves = cstLeaves.length > 0 ? cstLeaves : collectCstLeaves(parseSysmlSource(text));
    const eqIdx = leaves.findIndex((leaf) => leaf.text === "=");
    if (eqIdx >= 0 && eqIdx + 1 < leaves.length) {
      let endIdx = leaves.length;
      if (leaves[endIdx - 1]!.text === ";") {
        endIdx--;
      }
      if (endIdx === eqIdx + 2) {
        const tok = leaves[eqIdx + 1]!.text;
        if (tok.length >= 2 && tok.startsWith('"') && tok.endsWith('"')) {
          return stripSurroundingQuotes(tok);
        }
        if (tok === "true") return true;
        if (tok === "false") return false;
      }
      if (endIdx > eqIdx + 1) {
        const parsed = parseSignedNumberFromLeaves(leaves, eqIdx + 1);
        if (parsed && parsed.nextIdx === endIdx) {
          return parsed.value;
        }
      }
    }
  }

  return undefined;
};

/**
 * Resolve a dot-path like `vehicle.mass`:
 * 1. Check virtual `bindings` map (from subject bindings or calc invocation args)
 * 2. Resolve `vehicle` in scope -> find its type definition
 * 3. Look up `mass` in that type's children/redefinitions
 * 4. Return the final feature's value
 */
export const resolveFeaturePath = (
  db: QueryDB,
  names: string[],
  scopeId: number | null,
  bindings?: EvalBindings,
): EvalResult => {
  if (names.length === 0) return undefined;

  if (bindings) {
    const joined = names.join(".");
    if (bindings.has(joined)) return bindings.get(joined);
    if (names.length === 1 && bindings.has(names[0]!)) return bindings.get(names[0]!);
  }

  // Resolve the base name
  let current = resolveFeatureInScope(db, scopeId, names[0]!);
  if (!current) return undefined;

  // If single name, return its value directly
  if (names.length === 1) {
    return getFeatureValue(db, current, scopeId, bindings);
  }

  // Walk the chain: for each step, resolve local member/redefinition or type member
  for (let i = 1; i < names.length; i++) {
    const memberName = names[i]!;
    let found: SymbolEntry | null = null;

    // First inspect direct members/redefinitions on `current` itself
    for (const child of db.childrenOf(current.id)) {
      if (getEffectiveFeatureNames(db, child).includes(memberName)) {
        found = child;
        break;
      }
    }

    // Then inspect `current`'s resolved type hierarchy
    const typeDef = resolveTypeOf(db, current);
    if (!found && typeDef) {
      found = findMemberRecursiveInType(db, typeDef, memberName);
    }

    // Cross-Language Resolution: If the member is not found in the SysML type,
    // search across the UnifiedWorkspace for any implementation targets (e.g. Modelica classes)
    if (!found && typeDef) {
      for (const sym of db.allEntries()) {
        const meta = sym.metadata as Record<string, unknown> | undefined;
        let implementsTarget: string | undefined = undefined;

        // Fast path for native SysML items
        if (meta?.["implementsTarget"] === typeDef.name) {
          implementsTarget = typeDef.name;
        }
        // Fallback for external languages like Modelica
        else if (meta?.["annotationClause"] && typeof meta["annotationClause"] === "string") {
          const parsedTarget = extractSysmlImplementsTarget(meta["annotationClause"]);
          if (parsedTarget && parsedTarget === typeDef.name) implementsTarget = parsedTarget;
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
      return getFeatureValue(db, found, current.id, bindings);
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
export const extractNameChain = (node: CSTNode): string[] => {
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
function collectInvocationArgs(
  node: CSTNode,
  db: QueryDB,
  scopeId: number | null,
  bindings?: EvalBindings,
): { positional: EvalResult[]; named: Map<string, EvalResult> } {
  const positional: EvalResult[] = [];
  const named = new Map<string, EvalResult>();

  const unwrapArgExpr = (argNode: CSTNode): CSTNode | null => {
    if (argNode.type === "OwnedExpression") return argNode;
    for (const child of argNode.children) {
      if (child.type === "OwnedExpression" || child.type === "Argument" || child.type === "ArgumentValue") {
        const inner = unwrapArgExpr(child);
        if (inner) return inner;
      }
    }
    return argNode.children[0] ?? null;
  };

  const walkArgs = (cur: CSTNode) => {
    if (cur.type === "ArgumentMember") {
      const expr = unwrapArgExpr(cur);
      positional.push(expr ? evaluateExpressionNode(db, expr, scopeId, bindings) : undefined);
      return;
    }
    if (cur.type === "NamedArgumentMember") {
      const namedArg = cur.children.find((c) => c.type === "NamedArgument") ?? cur;
      const paramRedef = namedArg.childForFieldName("parameterRedefinition");
      const valNode = namedArg.childForFieldName("value");
      const paramName = paramRedef?.text?.trim().split("::").pop()?.trim();
      const expr = valNode ? unwrapArgExpr(valNode) : null;
      if (paramName && expr) {
        named.set(paramName, evaluateExpressionNode(db, expr, scopeId, bindings));
      }
      return;
    }
    for (const child of cur.children) {
      walkArgs(child);
    }
  };
  walkArgs(node);
  return { positional, named };
}

function evaluateMathBuiltin(shortName: string, args: EvalResult[]): EvalResult {
  const nums = args.filter((a): a is number => typeof a === "number");
  if (nums.length !== args.length || nums.length === 0) return undefined;
  switch (shortName) {
    case "abs":
      return Math.abs(nums[0]!);
    case "sqrt":
      return nums[0]! >= 0 ? Math.sqrt(nums[0]!) : undefined;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
    case "pow":
      return nums.length >= 2 ? Math.pow(nums[0]!, nums[1]!) : undefined;
    case "exp":
      return Math.exp(nums[0]!);
    case "log":
      return nums[0]! > 0 ? Math.log(nums[0]!) : undefined;
    case "floor":
      return Math.floor(nums[0]!);
    case "ceil":
      return Math.ceil(nums[0]!);
    case "round":
      return Math.round(nums[0]!);
    case "sin":
      return Math.sin(nums[0]!);
    case "cos":
      return Math.cos(nums[0]!);
    case "tan":
      return Math.tan(nums[0]!);
    default:
      return undefined;
  }
}

function evaluateInvocationExpression(
  db: QueryDB,
  node: CSTNode,
  scopeId: number | null,
  bindings?: EvalBindings,
): EvalResult {
  const typeNode = node.childForFieldName("type") ?? node.children[0];
  const rawCallee = typeNode?.text?.trim();
  if (!rawCallee) return undefined;
  const shortName = rawCallee.split("::").pop()!.split(".").pop()!.trim();

  const { positional, named } = collectInvocationArgs(node, db, scopeId, bindings);
  if (positional.some((a) => a === undefined) || Array.from(named.values()).some((a) => a === undefined)) {
    return undefined;
  }

  // 1. Resolve workspace CalculationDefinition / CalculationUsage
  let calcSym = resolveFeatureInScope(db, scopeId, shortName);
  if (!calcSym) {
    const byName = db.byName(shortName);
    calcSym = byName.find((s) => s.ruleName === "CalculationDefinition" || s.ruleName === "CalculationUsage") ?? null;
  }

  const orderedArgs: Array<number | string | boolean> = [];
  if (calcSym && (calcSym.ruleName === "CalculationDefinition" || calcSym.ruleName === "CalculationUsage")) {
    const params = db
      .childrenOf(calcSym.id)
      .filter((c) => c.kind === "Usage" && (metaStr(c, "direction") === "in" || metaStr(c, "direction") === "inout"));
    const calcBindings = new Map<string, EvalResult>();
    for (let i = 0; i < params.length; i++) {
      const pName = params[i]!.name;
      if (!pName) continue;
      const argVal = named.has(pName) ? named.get(pName) : positional[i];
      if (argVal !== undefined) {
        calcBindings.set(pName, argVal);
        if (typeof argVal === "number" || typeof argVal === "string" || typeof argVal === "boolean") {
          orderedArgs.push(argVal);
        }
      }
    }
    for (const [k, v] of named) {
      if (!calcBindings.has(k)) calcBindings.set(k, v);
    }

    const bodyVal = evaluateResultExpression(db, calcSym, calcSym.id, calcBindings);
    if (bodyVal !== undefined) return bodyVal;

    // Check explicit external metadata on calcSym (e.g. @ExternalCalculator / @LookupTable)
    for (const ch of db.childrenOf(calcSym.id)) {
      if (ch.ruleName === "MetadataUsage") {
        const metaText = db.cstText(ch.startOffset, ch.endOffset, ch) ?? "";
        const leaves = collectCstLeaves(parseSysmlSource(metaText));
        let tableName: string | undefined;
        for (let i = 0; i + 2 < leaves.length; i++) {
          const key = leaves[i]!.text;
          if (
            (key === "tableKey" ||
              key === "table" ||
              key === "functionName" ||
              key === "exportName" ||
              key === "calculator") &&
            leaves[i + 1]!.text === "=" &&
            leaves[i + 2]!.text.length > 2 &&
            leaves[i + 2]!.text.startsWith('"') &&
            leaves[i + 2]!.text.endsWith('"')
          ) {
            tableName = stripSurroundingQuotes(leaves[i + 2]!.text);
            break;
          }
        }
        if (tableName) {
          const extArgs =
            orderedArgs.length > 0
              ? orderedArgs
              : positional.filter((v): v is number | string | boolean => v !== null && v !== undefined);
          const extRes = globalLibraryRegistry.invokeCalculator(tableName, extArgs);
          if (extRes !== undefined && extRes !== null) return extRes;
        }
      }
    }
  }

  // 2. Dispatch to registered standard-pack WASM or JSON lookup-table calculators
  const flatArgs =
    orderedArgs.length > 0
      ? orderedArgs
      : positional.filter((v): v is number | string | boolean => v !== null && v !== undefined);
  const direct = globalLibraryRegistry.invokeCalculator(rawCallee, flatArgs);
  if (direct !== undefined && direct !== null) return direct;
  if (shortName !== rawCallee) {
    const shortRes = globalLibraryRegistry.invokeCalculator(shortName, flatArgs);
    if (shortRes !== undefined && shortRes !== null) return shortRes;
  }

  // 3. Built-in pure mathematical functions
  return evaluateMathBuiltin(shortName, positional);
}

/**
 * Evaluates unparenthesized Additive/Multiplicative CST subtrees with strict `* / %` > `+ -`
 * left-associative precedence, guarding against GLR precedence inversions on mixed expressions.
 */
function evaluateArithmeticSubtree(
  db: QueryDB,
  root: CSTNode,
  scopeId: number | null,
  bindings?: EvalBindings,
): EvalResult {
  const atoms: number[] = [];
  const ops: string[] = [];

  const collect = (curNode: CSTNode): boolean => {
    let cur = curNode;
    while (cur.type === "OwnedExpression" && cur.children.length === 1) {
      cur = cur.children[0]!;
    }
    if (cur.type === "AdditiveExpression" || cur.type === "MultiplicativeExpression") {
      const operands = cur.childrenForFieldName("operand");
      const operators = cur.childrenForFieldName("operator").map((op) => op.text.trim());
      if (operands.length >= 2 && operators.length >= operands.length - 1) {
        if (!collect(operands[0]!)) return false;
        for (let i = 0; i < operands.length - 1; i++) {
          ops.push(operators[i]!);
          if (!collect(operands[i + 1]!)) return false;
        }
        return true;
      }
    }
    const val = evaluateExpressionNode(db, cur, scopeId, bindings);
    if (typeof val !== "number") return false;
    atoms.push(val);
    return true;
  };

  if (!collect(root) || atoms.length === 0) return undefined;

  const reducedNums: number[] = [atoms[0]!];
  const reducedOps: string[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    const rhs = atoms[i + 1]!;
    if (op === "*" || op === "/" || op === "%") {
      const lhs = reducedNums[reducedNums.length - 1]!;
      if ((op === "/" || op === "%") && rhs === 0) return undefined;
      reducedNums[reducedNums.length - 1] = op === "*" ? lhs * rhs : op === "/" ? lhs / rhs : lhs % rhs;
    } else if (op === "+" || op === "-") {
      reducedOps.push(op);
      reducedNums.push(rhs);
    } else {
      return undefined;
    }
  }

  let total = reducedNums[0]!;
  for (let i = 0; i < reducedOps.length; i++) {
    const rhs = reducedNums[i + 1]!;
    total = reducedOps[i] === "+" ? total + rhs : total - rhs;
  }
  return total;
}

export const evaluateExpressionNode = (
  db: QueryDB,
  node: CSTNode,
  scopeId: number | null,
  bindings?: EvalBindings,
): EvalResult => {
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
      return stripSurroundingQuotes(text);
    }
    case "NullExpression":
      return null;
    case "LiteralInfinity":
      return Infinity;

    // --- Calculation / Function Invocations ---
    case "InvocationExpression":
      return evaluateInvocationExpression(db, node, scopeId, bindings);

    // --- Arithmetic ---
    case "AdditiveExpression":
    case "MultiplicativeExpression":
      return evaluateArithmeticSubtree(db, node, scopeId, bindings);

    case "ExponentiationExpression": {
      const baseNode = node.childForFieldName("base") ?? node.childrenForFieldName("operand")?.[0];
      const expNode = node.childForFieldName("exponent") ?? node.childrenForFieldName("operand")?.[1];
      if (!baseNode || !expNode) return undefined;
      const left = evaluateExpressionNode(db, baseNode, scopeId, bindings);
      const right = evaluateExpressionNode(db, expNode, scopeId, bindings);
      if (typeof left !== "number" || typeof right !== "number") return undefined;
      return Math.pow(left, right);
    }

    // --- Unary ---
    case "UnaryExpression": {
      const op = node.childForFieldName("operator");
      const operand = node.childForFieldName("operand");
      if (!op || !operand) return undefined;
      const val = evaluateExpressionNode(db, operand, scopeId, bindings);
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
      const left = evaluateExpressionNode(db, operands[0]!, scopeId, bindings);
      const right = evaluateExpressionNode(db, operands[1]!, scopeId, bindings);
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
      const left = evaluateExpressionNode(db, operands[0]!, scopeId, bindings);
      const right = evaluateExpressionNode(db, operands[1]!, scopeId, bindings);
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
      let result = evaluateExpressionNode(db, operands[0]!, scopeId, bindings);
      if (typeof result !== "boolean") return undefined;
      for (let i = 1; i < operands.length; i++) {
        const right = evaluateExpressionNode(db, operands[i]!, scopeId, bindings);
        if (typeof right !== "boolean") return undefined;
        result = (result as boolean) && right;
      }
      return result;
    }

    case "OrExpression": {
      const operands = node.childrenForFieldName("operand");
      if (operands.length < 2) return undefined;
      let result = evaluateExpressionNode(db, operands[0]!, scopeId, bindings);
      if (typeof result !== "boolean") return undefined;
      for (let i = 1; i < operands.length; i++) {
        const right = evaluateExpressionNode(db, operands[i]!, scopeId, bindings);
        if (typeof right !== "boolean") return undefined;
        result = (result as boolean) || right;
      }
      return result;
    }

    case "XorExpression": {
      const operands = node.childrenForFieldName("operand");
      if (operands.length < 2) return undefined;
      let result = evaluateExpressionNode(db, operands[0]!, scopeId, bindings);
      if (typeof result !== "boolean") return undefined;
      for (let i = 1; i < operands.length; i++) {
        const right = evaluateExpressionNode(db, operands[i]!, scopeId, bindings);
        if (typeof right !== "boolean") return undefined;
        result = (result as boolean) !== right;
      }
      return result;
    }

    case "ImpliesExpression": {
      const operands = node.childrenForFieldName("operand");
      if (operands.length < 2) return undefined;
      const left = evaluateExpressionNode(db, operands[0]!, scopeId, bindings);
      // For implies references, we need to unwrap the ImpliesExpressionReference
      let rightNode = operands[1]!;
      if (rightNode.type === "ImpliesExpressionReference") {
        const inner = rightNode.childForFieldName("ownedRelationship");
        if (inner) {
          const elem = inner.childForFieldName("ownedRelatedElement");
          if (elem) rightNode = elem;
        }
      }
      const right = evaluateExpressionNode(db, rightNode, scopeId, bindings);
      if (typeof left !== "boolean" || typeof right !== "boolean") return undefined;
      return !left || right; // p implies q ≡ ¬p ∨ q
    }

    // --- Conditional ---
    case "ConditionalExpression": {
      const operand = node.childForFieldName("operand");
      const thenRef = node.childForFieldName("thenOperand");
      const elseRef = node.childForFieldName("elseOperand");
      if (!operand || !thenRef || !elseRef) return undefined;
      const cond = evaluateExpressionNode(db, operand, scopeId, bindings);
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
        ? evaluateExpressionNode(db, unwrap(thenRef), scopeId, bindings)
        : evaluateExpressionNode(db, unwrap(elseRef), scopeId, bindings);
    }

    // --- Feature references (with dot-path resolution) ---
    case "FeatureReferenceExpression": {
      const names = extractNameChain(node);
      if (names.length === 0) return undefined;
      return resolveFeaturePath(db, names, scopeId, bindings);
    }

    case "PrimaryExpression": {
      // Check for parenthesized expression: ( expr )
      const expr = node.childForFieldName("operand");
      if (expr) return evaluateExpressionNode(db, expr, scopeId, bindings);

      // Check for dot-path feature chain
      const names = extractNameChain(node);
      if (names.length > 0) {
        return resolveFeaturePath(db, names, scopeId, bindings);
      }

      // Check children
      for (const child of node.children) {
        const val = evaluateExpressionNode(db, child, scopeId, bindings);
        if (val !== undefined) return val;
      }
      return undefined;
    }

    // --- Wrapped expressions ---
    case "OwnedExpression":
    case "ExpressionBody": {
      for (const child of node.children) {
        const val = evaluateExpressionNode(db, child, scopeId, bindings);
        if (val !== undefined) return val;
      }
      return undefined;
    }

    default: {
      // For wrapper nodes, try to evaluate the first recognized child
      for (const child of node.children) {
        const val = evaluateExpressionNode(db, child, scopeId, bindings);
        if (val !== undefined) return val;
      }
      return undefined;
    }
  }
};

/**
 * Evaluate the body of a CalculationDefinition or CalculationUsage.
 * Finds the ResultExpressionMember (or direct OwnedExpression) in the CST and evaluates it.
 */
export const evaluateResultExpression = (
  db: QueryDB,
  self: SymbolEntry,
  evalScopeId?: number | null,
  bindings?: EvalBindings,
): EvalResult => {
  const cst = db.cstNode(self.id) as CSTNode | null;
  if (!cst) return undefined;

  // Find ResultExpressionMember in the calculation/constraint body
  const findResultExpr = (node: CSTNode): CSTNode | null => {
    if (node.type === "ResultExpressionMember") return node;
    for (const child of node.children) {
      const found = findResultExpr(child);
      if (found) return found;
    }
    return null;
  };

  const resultMember = findResultExpr(cst);
  if (resultMember) {
    const ownedRelElem =
      resultMember.childForFieldName("ownedRelatedElement") ||
      resultMember.children.find((c) => c.type === "OwnedExpression") ||
      resultMember.children[0];
    if (!ownedRelElem) return undefined;
    return evaluateExpressionNode(db, ownedRelElem, evalScopeId ?? self.parentId, bindings);
  }

  // Fallback 1: `return [name] [: Type] = <expr>;` (ReturnParameterMember / return/out usage with value)
  const findCstByType = (node: CSTNode, targetType: string): CSTNode | null => {
    if (node.type === targetType) return node;
    for (const child of node.children) {
      const found = findCstByType(child, targetType);
      if (found) return found;
    }
    return null;
  };
  const retMember = findCstByType(cst, "ReturnParameterMember");
  if (retMember) {
    const ownedElem = retMember.childForFieldName("ownedRelatedElement") ?? retMember;
    const exprInRet = findCstByType(ownedElem, "OwnedExpression");
    if (exprInRet) {
      return evaluateExpressionNode(db, exprInRet, evalScopeId ?? self.id, bindings);
    }
  }
  for (const child of db.childrenOf(self.id)) {
    const dir = metaStr(child, "direction");
    if (dir === "out" || dir === "return") {
      const val = getFeatureValue(db, child, evalScopeId ?? self.id, bindings);
      if (val !== undefined) return val;
    }
  }

  // Fallback 2: ExpressionBody / OwnedExpression directly attached to CST
  const directExpr = cst.children.find((c) => c.type === "OwnedExpression" || c.type === "ExpressionBody");
  if (directExpr) {
    return evaluateExpressionNode(db, directExpr, evalScopeId ?? self.parentId, bindings);
  }

  return undefined;
};

// ---------------------------------------------------------------------------
// Calculation Definition/Usage — dedicated models and queries
// ---------------------------------------------------------------------------

/** Model config for CalculationDefinition */
export const calculationDefinitionModel = {
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
export const calculationUsageModel = {
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
export const calculationDefinitionQueries = {
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
export const calculationUsageQueries = {
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

export const calculationQueries = calculationDefinitionQueries;

// ---------------------------------------------------------------------------
// Constraint Evaluation — computed fields
// ---------------------------------------------------------------------------

/**
 * Evaluate the body of a ConstraintDefinition or ConstraintUsage.
 * The constraint body is a _CalculationBody containing a ResultExpressionMember.
 * Returns true/false/null (null = indeterminate).
 */
export const evaluateConstraintBody = (
  db: QueryDB,
  self: SymbolEntry,
  evalScopeId?: number | null,
  bindings?: EvalBindings,
): boolean | null => {
  const result = evaluateResultExpression(db, self, evalScopeId, bindings);
  if (typeof result === "boolean") return result;
  if (result === undefined) return null; // indeterminate
  // Coerce numbers: 0 = false, nonzero = true
  if (typeof result === "number") return result !== 0;
  return null;
};

export interface ActiveSimulationResult {
  trajectory?:
    | {
        signals?: { name?: string | undefined; values?: number[] | undefined }[] | undefined;
      }
    | undefined;
}

/** Constraint-specific queries */
export const constraintEvalQueries = {
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
export const constraintDefinitionModel = {
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
export const constraintUsageModel = {
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
export const constraintDefinitionQueries = {
  ...definitionStructuralQueries,
  ...constraintEvalQueries,
};

/** Constraint Usage queries */
export const constraintUsageQueries = {
  ...usageQueries,
  ...constraintEvalQueries,
};

export const getConstraintKind = (db: QueryDB, self: SymbolEntry): string => {
  const meta = metaStr(self, "constraintKind");
  if (meta) return meta;
  const text = db.cstText(Math.max(0, self.startOffset - 30), self.startOffset, self);
  if (text && text.includes("assume")) return "assume";
  return "require"; // default
};

export interface StandardClauseMeta {
  standard?: string;
  edition?: string;
  clauseId?: string;
  title?: string;
  severity?: "error" | "warning" | "info";
  label?: string;
}

export type RequirementComplianceStatus = "satisfied" | "violated" | "inapplicable" | "indeterminate";

export interface RequirementComplianceResult {
  status: RequirementComplianceStatus;
  clauseMeta: StandardClauseMeta;
  failedConstraints: string[];
  subjectName?: string;
}

const STANDARD_METADATA_NAMES = ["StandardClause", "ComplianceRule", "StandardRule", "ComplianceProfile"];

type StandardMetadataField = "standard" | "edition" | "clauseId" | "title" | "severity";

function parseMetadataAssignments(metaText: string): Partial<Record<StandardMetadataField, string>> {
  const result: Partial<Record<StandardMetadataField, string>> = {};
  const leaves = collectCstLeaves(parseSysmlSource(metaText));
  for (let i = 0; i + 2 < leaves.length; i++) {
    const rawKey = leaves[i]!.text;
    if (
      rawKey !== "standard" &&
      rawKey !== "edition" &&
      rawKey !== "clauseId" &&
      rawKey !== "clause" &&
      rawKey !== "title" &&
      rawKey !== "severity"
    ) {
      continue;
    }
    if (leaves[i + 1]!.text !== "=") continue;
    const valLeaf = leaves[i + 2]!.text;
    if (!valLeaf.startsWith('"') || !valLeaf.endsWith('"')) continue;
    const key: StandardMetadataField = rawKey === "clause" ? "clauseId" : rawKey;
    if (result[key] === undefined) {
      result[key] = stripSurroundingQuotes(valLeaf);
    }
  }
  return result;
}

function resolveTypeReferenceByName(db: QueryDB, scopeId: number | null, refText: string): SymbolEntry | null {
  const trimmed = refText.trim();
  if (!trimmed) return null;
  const resolved = resolveFeatureInScope(db, scopeId, trimmed);
  if (resolved) return resolved;
  const shortName = trimmed.split("::").pop()!;
  return (
    db
      .byName(shortName)
      .find((s) => s.kind === "Definition" || s.ruleName === "RequirementUsage" || s.kind === "Package") ?? null
  );
}

/**
 * Collect the inheritance / typing chain for a requirement symbol from most derived to most general.
 */
export function collectRequirementInheritanceChain(db: QueryDB, reqSym: SymbolEntry): SymbolEntry[] {
  const chain: SymbolEntry[] = [];
  const visited = new Set<number>();
  const queue: SymbolEntry[] = [reqSym];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    chain.push(current);

    const typed = usageQueries.resolvedType(db, current);
    if (typed && !visited.has(typed.id)) queue.push(typed);

    for (const child of db.childrenOf(current.id)) {
      if (
        child.ruleName === "OwnedSubclassification" ||
        child.ruleName === "OwnedSubsetting" ||
        child.ruleName === "OwnedFeatureTyping"
      ) {
        const refName = (child.name || db.cstText(child.startOffset, child.endOffset, child) || "").trim();
        if (refName) {
          const base = resolveTypeReferenceByName(db, current.parentId, refName);
          if (base && !visited.has(base.id)) queue.push(base);
        }
      }
    }
  }

  return chain;
}

function collectStandardMetaFromNode(
  db: QueryDB,
  node: SymbolEntry,
): Partial<StandardClauseMeta> & { isMarked: boolean } {
  const collected: Partial<StandardClauseMeta> & { isMarked: boolean } = { isMarked: false };

  for (const child of db.childrenOf(node.id)) {
    if (child.ruleName === "MetadataUsage") {
      const metaText = db.cstText(child.startOffset, child.endOffset, child) ?? "";
      const isStdAnnot = STANDARD_METADATA_NAMES.some((tag) => metaText.includes(tag) || child.name === tag);
      const kv = parseMetadataAssignments(metaText);
      if (isStdAnnot || Object.keys(kv).length > 0) {
        collected.isMarked = true;
      }
      if (kv.standard && !collected.standard) collected.standard = kv.standard;
      if (kv.edition && !collected.edition) collected.edition = kv.edition;
      if (kv.clauseId && !collected.clauseId) collected.clauseId = kv.clauseId;
      if (kv.title && !collected.title) collected.title = kv.title;
      if ((kv.severity === "error" || kv.severity === "warning" || kv.severity === "info") && !collected.severity) {
        collected.severity = kv.severity;
      }
      // Also inspect child AttributeUsages inside MetadataUsage if present
      for (const mChild of db.childrenOf(child.id)) {
        const mNames = getEffectiveFeatureNames(db, mChild);
        const val = getFeatureValue(db, mChild, child.id);
        if (typeof val !== "string") continue;
        if (mNames.includes("standard") && !collected.standard) collected.standard = val;
        if (mNames.includes("edition") && !collected.edition) collected.edition = val;
        if ((mNames.includes("clauseId") || mNames.includes("clause")) && !collected.clauseId) collected.clauseId = val;
        if (mNames.includes("title") && !collected.title) collected.title = val;
        if (
          mNames.includes("severity") &&
          (val === "error" || val === "warning" || val === "info") &&
          !collected.severity
        ) {
          collected.severity = val;
        }
      }
    }
  }

  return collected;
}

/**
 * Extracts standard compliance clause metadata from a requirement (its annotations, inheritance chain,
 * enclosing package metadata, or registered standard-pack manifest).
 */
export function extractStandardClauseMeta(db: QueryDB, sym: SymbolEntry): StandardClauseMeta {
  const meta: StandardClauseMeta = {};
  let isStandardClause = false;
  const standardPacks = globalLibraryRegistry.getStandardPacks();

  for (const node of collectRequirementInheritanceChain(db, sym)) {
    const extracted = collectStandardMetaFromNode(db, node);
    if (extracted.isMarked) isStandardClause = true;
    if (extracted.standard && !meta.standard) meta.standard = extracted.standard;
    if (extracted.edition && !meta.edition) meta.edition = extracted.edition;
    if (extracted.clauseId && !meta.clauseId) meta.clauseId = extracted.clauseId;
    if (extracted.title && !meta.title) meta.title = extracted.title;
    if (extracted.severity && !meta.severity) meta.severity = extracted.severity;
  }

  // Inherit pack/standard metadata from enclosing packages
  let parentId = sym.parentId;
  while (parentId !== null) {
    const parent = db.symbol(parentId);
    if (!parent) break;
    if (parent.kind === "Package") {
      const pkgExtracted = collectStandardMetaFromNode(db, parent);
      if (pkgExtracted.isMarked) isStandardClause = true;
      if (pkgExtracted.standard && !meta.standard) meta.standard = pkgExtracted.standard;
      if (pkgExtracted.edition && !meta.edition) meta.edition = pkgExtracted.edition;
      if (pkgExtracted.severity && !meta.severity) meta.severity = pkgExtracted.severity;

      if (parent.name) {
        const matchedPack = standardPacks.find(
          (p) => p.packageName === parent.name || p.manifest.standard?.code === parent.name,
        );
        if (matchedPack) {
          isStandardClause = true;
          if (!meta.standard) {
            meta.standard = matchedPack.manifest.standard?.code ?? matchedPack.packageName;
          }
          if (!meta.edition && matchedPack.manifest.standard?.edition) {
            meta.edition = matchedPack.manifest.standard.edition;
          }
        }
      }
    }
    parentId = parent.parentId;
  }

  if (isStandardClause || meta.standard || meta.clauseId) {
    const shortName = metaStr(sym, "shortName") ?? undefined;
    if (!meta.clauseId && shortName) meta.clauseId = shortName;
    if (meta.standard && meta.clauseId) {
      meta.label = `${meta.standard} ${meta.clauseId}`;
    } else if (meta.clauseId) {
      meta.label = meta.clauseId;
    } else if (meta.standard) {
      meta.label = meta.standard;
    } else {
      meta.label = sym.name || "StandardClause";
    }
  }

  return meta;
}

/**
 * Resolves the target requirement symbol referenced by a `satisfy` or `verify` relationship.
 */
export function resolveSatisfyingTargetRequirement(db: QueryDB, entry: SymbolEntry): SymbolEntry | null {
  const satisfyingFeatureIds = new Set(db.childrenOfField(entry.id, "satisfyingFeature").map((c) => c.id));
  const cst = db.cstNode(entry.id) as CSTNode | null;
  const satFeatNode = cst?.childForFieldName("satisfyingFeature") ?? null;

  let rawTarget = entry.name && entry.name !== entry.ruleName ? entry.name : "";
  if (!rawTarget) {
    for (const child of db.childrenOf(entry.id)) {
      if (child.ruleName !== "OwnedReferenceSubsetting") continue;
      if (satisfyingFeatureIds.has(child.id)) continue;
      if (satFeatNode && child.startOffset >= satFeatNode.startIndex && child.endOffset <= satFeatNode.endIndex) {
        continue;
      }
      const text = db.cstText(child.startOffset, child.endOffset, child)?.trim();
      if (text) {
        rawTarget = text;
        break;
      }
    }
  }

  if (!rawTarget) {
    rawTarget = getRelationshipTargetName(db, entry) ?? "";
  }
  if (!rawTarget) return null;

  const isSatisfiableReqRule = (r: string | undefined): boolean =>
    r === "RequirementDefinition" ||
    r === "RequirementUsage" ||
    r === "reqif_requirement" ||
    r === "SpecObject" ||
    r === "qif_characteristic" ||
    r === "DimensionalCharacteristic";

  const resolved = resolveFeatureInScope(db, entry.parentId, rawTarget);
  if (resolved && isSatisfiableReqRule(resolved.ruleName)) {
    return resolved;
  }

  const shortName = rawTarget.split("::").pop()!;
  return db.byName(shortName).find((t) => isSatisfiableReqRule(t.ruleName)) ?? null;
}

/**
 * Resolves the satisfying subject element for a `SatisfyRequirementUsage` (`by <subject>` or enclosing part).
 */
export function resolveSatisfyingSubject(db: QueryDB, satisfyEntry: SymbolEntry): SymbolEntry | null {
  const satFieldChildren = db.childrenOfField(satisfyEntry.id, "satisfyingFeature");
  let rawSubjectRef =
    satFieldChildren.length > 0
      ? (db.cstText(satFieldChildren[0]!.startOffset, satFieldChildren[0]!.endOffset, satFieldChildren[0]!)?.trim() ??
        "")
      : "";

  if (!rawSubjectRef) {
    const cst = db.cstNode(satisfyEntry.id) as CSTNode | null;
    const satNode = cst?.childForFieldName("satisfyingFeature");
    if (satNode?.text) {
      rawSubjectRef = satNode.text.trim();
    }
  }

  if (!rawSubjectRef) {
    const fullText = db.cstText(satisfyEntry.startOffset, satisfyEntry.endOffset, satisfyEntry) ?? "";
    const braceIdx = fullText.indexOf("{");
    const headerText = braceIdx !== -1 ? fullText.slice(0, braceIdx) : fullText;
    const leaves = collectCstLeaves(parseSysmlSource(headerText));
    const byIdx = leaves.findIndex((l) => l.text === "by");
    const byChain = byIdx !== -1 ? readDottedChainFromLeaves(leaves, byIdx + 1) : null;
    if (byChain) rawSubjectRef = byChain.text;
  }

  if (rawSubjectRef) {
    const resolved = resolveFeatureInScope(db, satisfyEntry.parentId, rawSubjectRef);
    if (resolved) return resolved;
    const shortName = rawSubjectRef.split("::").pop()!;
    const cand = db.byName(shortName).find((s) => s.kind === "Usage" || s.kind === "Definition");
    if (cand) return cand;
  }

  for (const child of db.childrenOf(satisfyEntry.id)) {
    if (child.ruleName === "SubjectUsage") {
      const exprValName = db.cstText(child.startOffset, child.endOffset, child);
      if (exprValName) {
        const leaves = collectCstLeaves(parseSysmlSource(exprValName));
        const eqIdx = leaves.findIndex((l) => l.text === "=");
        const eqChain = eqIdx !== -1 ? readDottedChainFromLeaves(leaves, eqIdx + 1) : null;
        if (eqChain) {
          const resolved = resolveFeatureInScope(db, satisfyEntry.parentId, eqChain.text);
          if (resolved) return resolved;
        }
      }
      return child;
    }
  }

  // Fallback: implicit subject inside enclosing PartUsage/PartDefinition/ItemUsage/ItemDefinition
  let parentId = satisfyEntry.parentId;
  while (parentId !== null) {
    const parent = db.symbol(parentId);
    if (!parent) break;
    if (
      parent.ruleName === "PartUsage" ||
      parent.ruleName === "PartDefinition" ||
      parent.ruleName === "ItemUsage" ||
      parent.ruleName === "ItemDefinition" ||
      parent.ruleName === "OccurrenceUsage"
    ) {
      return parent;
    }
    parentId = parent.parentId;
  }

  return null;
}

function collectNestedSubjectAttributes(
  db: QueryDB,
  container: SymbolEntry,
  prefix: string,
  subjectAliases: string[],
  outBindings: Map<string, EvalResult>,
  visited = new Set<number>(),
  depth = 0,
): void {
  if (depth > 3 || visited.has(container.id)) return;
  visited.add(container.id);

  const attrs = collectEffectiveSubjectAttributes(db, container, new Set(), outBindings);
  for (const [k, v] of attrs) {
    if (prefix === "") {
      outBindings.set(k, v);
      for (const alias of subjectAliases) {
        outBindings.set(`${alias}.${k}`, v);
      }
    } else {
      outBindings.set(`${prefix}.${k}`, v);
      for (const alias of subjectAliases) {
        outBindings.set(`${alias}.${prefix}.${k}`, v);
      }
    }
  }

  for (const child of db.childrenOf(container.id)) {
    if (
      child.ruleName === "PartUsage" ||
      child.ruleName === "ItemUsage" ||
      child.ruleName === "PortUsage" ||
      child.ruleName === "OccurrenceUsage"
    ) {
      for (const childName of getEffectiveFeatureNames(db, child)) {
        const nextPrefix = prefix ? `${prefix}.${childName}` : childName;
        collectNestedSubjectAttributes(db, child, nextPrefix, subjectAliases, outBindings, visited, depth + 1);
      }
    }
  }
}

function buildSubjectEvalBindings(db: QueryDB, chain: SymbolEntry[], subjectSym?: SymbolEntry | null): EvalBindings {
  const bindings = new Map<string, EvalResult>();
  const subjectAliases: string[] = [];

  if (subjectSym?.name) subjectAliases.push(subjectSym.name);

  // Collect requirement parameters and declared subject aliases from general -> specific
  for (let i = chain.length - 1; i >= 0; i--) {
    const reqNode = chain[i]!;
    const reqAttrs = collectEffectiveSubjectAttributes(db, reqNode, new Set(), bindings);
    for (const [k, v] of reqAttrs) bindings.set(k, v);

    for (const child of db.childrenOf(reqNode.id)) {
      if (child.ruleName === "SubjectUsage" && child.name && !subjectAliases.includes(child.name)) {
        subjectAliases.push(child.name);
        const subjAttrs = collectEffectiveSubjectAttributes(db, child, new Set(), bindings);
        for (const [k, v] of subjAttrs) {
          bindings.set(k, v);
          bindings.set(`${child.name}.${k}`, v);
        }
      }
    }
  }

  if (subjectSym) {
    collectNestedSubjectAttributes(db, subjectSym, "", subjectAliases, bindings);
  }

  return bindings;
}

function findResultExprCst(node: CSTNode): CSTNode | null {
  if (node.type === "ResultExpressionMember") return node;
  for (const child of node.children) {
    const found = findResultExprCst(child);
    if (found) return found;
  }
  return null;
}

function findRelationalExprCst(node: CSTNode): CSTNode | null {
  if (node.type === "RelationalExpression") return node;
  for (const child of node.children) {
    const found = findRelationalExprCst(child);
    if (found) return found;
  }
  return null;
}

function formatEvalScalar(val: EvalResult): string {
  if (typeof val === "number") {
    return Number.isInteger(val) ? String(val) : Number(val.toPrecision(6)).toString();
  }
  return String(val);
}

function formatConstraintFailureDetail(
  db: QueryDB,
  constraint: SymbolEntry,
  evalScopeId: number | null,
  bindings?: EvalBindings,
): string {
  const cst = db.cstNode(constraint.id) as CSTNode | null;
  const resultExpr = cst ? findResultExprCst(cst) : null;
  const rawExpr = collapseWhitespace(
    resultExpr?.text ??
      db.cstText(constraint.startOffset, constraint.endOffset, constraint) ??
      constraint.name ??
      "constraint",
  );

  if (resultExpr) {
    const rel = findRelationalExprCst(resultExpr);
    if (rel) {
      let operands = rel.childrenForFieldName("operand");
      let opText = rel.childrenForFieldName("operator")[0]?.text?.trim() ?? "";
      if (operands.length < 2 && rel.children.length === 3) {
        operands = [rel.children[0]!, rel.children[2]!];
        opText = rel.children[1]!.text?.trim() ?? opText;
      }
      if (operands.length >= 2) {
        const lhs = evaluateExpressionNode(db, operands[0]!, evalScopeId, bindings);
        const rhs = evaluateExpressionNode(db, operands[1]!, evalScopeId, bindings);
        if (lhs !== undefined && lhs !== null && rhs !== undefined && rhs !== null) {
          return `${rawExpr} (${formatEvalScalar(lhs)} vs ${opText || "?"} ${formatEvalScalar(rhs)})`;
        }
      }
    }
  }

  return rawExpr;
}

function collectConstraintsAlongChain(
  db: QueryDB,
  chain: SymbolEntry[],
  kind: "assume" | "require",
): Array<{ constraint: SymbolEntry; ownerId: number }> {
  const result: Array<{ constraint: SymbolEntry; ownerId: number }> = [];
  const seenNames = new Set<string>();

  for (const node of chain) {
    for (const c of db.childrenOf(node.id)) {
      if (c.ruleName !== "RequirementConstraintUsage" || getConstraintKind(db, c) !== kind) continue;
      if (c.name) {
        if (seenNames.has(c.name)) continue;
        seenNames.add(c.name);
      }
      result.push({ constraint: c, ownerId: node.id });
    }
  }

  return result;
}

/**
 * Evaluates full standard/requirement compliance for a requirement against an optional subject element.
 * Respects `assume` guards (returning `"inapplicable"` when an assumption evaluates to false) and
 * collects detailed constraint failure explanations.
 */
export function evaluateRequirementCompliance(
  db: QueryDB,
  reqSym: SymbolEntry,
  subjectSym?: SymbolEntry | null,
): RequirementComplianceResult {
  const chain = collectRequirementInheritanceChain(db, reqSym);
  const clauseMeta = extractStandardClauseMeta(db, reqSym);
  const bindings = buildSubjectEvalBindings(db, chain, subjectSym);
  const subjectName = subjectSym?.name || undefined;

  const assumptions = collectConstraintsAlongChain(db, chain, "assume");
  for (const { constraint, ownerId } of assumptions) {
    const ok = evaluateConstraintBody(db, constraint, ownerId, bindings);
    if (ok === false) {
      return {
        status: "inapplicable",
        clauseMeta,
        failedConstraints: [formatConstraintFailureDetail(db, constraint, ownerId, bindings)],
        ...(subjectName ? { subjectName } : {}),
      };
    }
  }

  const requirements = collectConstraintsAlongChain(db, chain, "require");
  if (requirements.length === 0) {
    return {
      status: "indeterminate",
      clauseMeta,
      failedConstraints: [],
      ...(subjectName ? { subjectName } : {}),
    };
  }

  const failedConstraints: string[] = [];
  let anyIndeterminate = false;

  for (const { constraint, ownerId } of requirements) {
    const ok = evaluateConstraintBody(db, constraint, ownerId, bindings);
    if (ok === false) {
      failedConstraints.push(formatConstraintFailureDetail(db, constraint, ownerId, bindings));
    } else if (ok === null) {
      anyIndeterminate = true;
    }
  }

  if (failedConstraints.length > 0) {
    return {
      status: "violated",
      clauseMeta,
      failedConstraints,
      ...(subjectName ? { subjectName } : {}),
    };
  }

  return {
    status: anyIndeterminate ? "indeterminate" : "satisfied",
    clauseMeta,
    failedConstraints: [],
    ...(subjectName ? { subjectName } : {}),
  };
}

/**
 * Computed: are all require constraints met for a requirement?
 * Returns true (all pass or assumption makes it inapplicable), false (any fail), or null (indeterminate).
 */
export const evaluateConstraintsMet = (
  db: QueryDB,
  self: SymbolEntry,
  subjectSym?: SymbolEntry | null,
): boolean | null => {
  const compliance = evaluateRequirementCompliance(db, self, subjectSym);
  if (compliance.status === "violated") return false;
  if (compliance.status === "satisfied" || compliance.status === "inapplicable") return true;
  return null;
};

function collectTypeChain(db: QueryDB, startType: SymbolEntry): { ids: Set<number>; names: Set<string> } {
  const ids = new Set<number>();
  const names = new Set<string>();
  const queue: SymbolEntry[] = [startType];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (ids.has(cur.id)) continue;
    ids.add(cur.id);
    if (cur.name) names.add(cur.name);

    for (const child of db.childrenOf(cur.id)) {
      if (child.ruleName === "OwnedSubclassification" || child.ruleName === "OwnedSubsetting") {
        const refName = (child.name || db.cstText(child.startOffset, child.endOffset, child) || "").trim();
        if (refName) {
          names.add(refName.split("::").pop()!);
          const base = resolveTypeReferenceByName(db, cur.parentId, refName);
          if (base && !ids.has(base.id)) queue.push(base);
        }
      }
    }
  }

  return { ids, names };
}

function findSubjectTypeMatch(
  db: QueryDB,
  reqSym: SymbolEntry,
  targetTypeIds: Set<number>,
  targetTypeNames: Set<string>,
): boolean {
  for (const node of collectRequirementInheritanceChain(db, reqSym)) {
    for (const child of db.childrenOf(node.id)) {
      if (child.ruleName !== "SubjectUsage") continue;
      const subjType = usageQueries.resolvedType(db, child);
      if (subjType) {
        if (targetTypeIds.has(subjType.id)) return true;
        if (subjType.name && targetTypeNames.has(subjType.name)) return true;
      }
      for (const rel of db.childrenOf(child.id)) {
        if (rel.ruleName === "OwnedFeatureTyping" && rel.name) {
          const short = rel.name.split("::").pop()!;
          if (targetTypeNames.has(rel.name) || targetTypeNames.has(short)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Discovers standard compliance requirements visible to `usageSym` (via enclosing package, explicit
 * `Import` declarations, or workspace-activated standard packs) whose `subject` type matches
 * `usageSym`'s type hierarchy.
 */
export function findApplicableStandardRequirements(db: QueryDB, usageSym: SymbolEntry): SymbolEntry[] {
  const usageType = usageQueries.resolvedType(db, usageSym);
  if (!usageType) return [];

  const { ids: targetTypeIds, names: targetTypeNames } = collectTypeChain(db, usageType);
  const candidateReqs = new Map<number, SymbolEntry>();
  const visitedNamespaces = new Set<number>();

  const collectFromNamespace = (nsId: number | null, recursive = false) => {
    if (nsId !== null) {
      if (visitedNamespaces.has(nsId)) return;
      visitedNamespaces.add(nsId);
    }
    for (const ch of db.childrenOf(nsId)) {
      if (ch.ruleName === "RequirementDefinition" || ch.ruleName === "RequirementUsage") {
        candidateReqs.set(ch.id, ch);
      } else if (recursive && ch.kind === "Package") {
        collectFromNamespace(ch.id, true);
      }
    }
  };

  // Walk enclosing scopes and follow Import declarations
  let scopeId: number | null = usageSym.parentId;
  while (true) {
    collectFromNamespace(scopeId, false);
    for (const child of db.childrenOf(scopeId)) {
      if (child.kind !== "Import" || !child.name) continue;
      const rawTarget = child.name;
      const isWildcard = rawTarget.endsWith("::*") || rawTarget.endsWith("::**");
      const isRecursive = rawTarget.endsWith("::**");
      const cleanPath = stripNamespaceWildcard(rawTarget);

      if (isWildcard || !rawTarget.includes("::")) {
        const pkg = resolveTypeReferenceByName(db, scopeId, cleanPath);
        if (pkg) collectFromNamespace(pkg.id, isRecursive);
        const baseName = cleanPath.split("::").pop()!;
        for (const cand of db.byName(baseName)) {
          if (cand.kind === "Package") collectFromNamespace(cand.id, isRecursive);
        }
      } else {
        const target = resolveTypeReferenceByName(db, scopeId, cleanPath);
        if (target && (target.ruleName === "RequirementDefinition" || target.ruleName === "RequirementUsage")) {
          candidateReqs.set(target.id, target);
        } else if (target && target.kind === "Package") {
          collectFromNamespace(target.id, false);
        }
      }
    }
    if (scopeId === null) break;
    scopeId = db.symbol(scopeId)?.parentId ?? null;
  }

  // Include standard packs configured with `activation: "workspace"`
  for (const pack of globalLibraryRegistry.getStandardPacks()) {
    if (pack.manifest.standard?.activation !== "workspace") continue;
    const pkgNames = new Set<string>([pack.packageName]);
    if (pack.manifest.standard.code) pkgNames.add(pack.manifest.standard.code);
    for (const pkgName of pkgNames) {
      for (const pkg of db.byName(pkgName)) {
        if (pkg.kind === "Package") collectFromNamespace(pkg.id, true);
      }
    }
  }

  const applicable: SymbolEntry[] = [];
  for (const req of candidateReqs.values()) {
    if (metaStr(req, "isAbstract") === "true") continue;
    if (!extractStandardClauseMeta(db, req).label) continue;
    if (!findSubjectTypeMatch(db, req, targetTypeIds, targetTypeNames)) continue;
    applicable.push(req);
  }

  return applicable;
}

/**
 * Collects requirement IDs already explicitly bound to `usageSym` via `satisfy ... by <usage>` or
 * an enclosed `satisfy ...` statement so implicit usage checks do not duplicate diagnostics.
 */
export function findExplicitSatisfyTargetsForSubject(db: QueryDB, usageSym: SymbolEntry): Set<number> {
  const covered = new Set<number>();
  const scanContainer = (containerId: number | null) => {
    for (const child of db.childrenOf(containerId)) {
      if (child.ruleName !== "SatisfyRequirementUsage") continue;
      const subject = resolveSatisfyingSubject(db, child);
      if (subject?.id === usageSym.id) {
        const target = resolveSatisfyingTargetRequirement(db, child);
        if (target) covered.add(target.id);
      }
    }
  };

  scanContainer(usageSym.id);
  let ancestorId = usageSym.parentId;
  while (true) {
    scanContainer(ancestorId);
    if (ancestorId === null) break;
    ancestorId = db.symbol(ancestorId)?.parentId ?? null;
  }

  return covered;
}

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
export const getRelationshipTargetName = (db: QueryDB, entry: SymbolEntry): string | null => {
  // If the symbol has a declared name that is not its internal rule name, it's using the `requirement <name>` branch
  if (entry.name && entry.name !== entry.ruleName) {
    const parts = entry.name.split("::");
    return parts[parts.length - 1]!;
  }

  // Otherwise, extract from OwnedReferenceSubsetting CST child.
  // The CST text of the OwnedReferenceSubsetting span contains the qualified name.
  for (const child of db.childrenOf(entry.id)) {
    if (child.ruleName === "OwnedReferenceSubsetting") {
      const raw = db.cstText(child.startOffset, child.endOffset, child);
      if (raw) {
        const parts = raw.trim().split("::");
        return parts[parts.length - 1]!;
      }
    }
  }

  // Final fallback: read the raw CST leaves between the keyword and target
  const text = db.cstText(entry.startOffset, entry.endOffset, entry);
  if (text) {
    const leaves = collectCstLeaves(parseSysmlSource(text));
    const kwIdx = leaves.findIndex((l) => l.text === "verify" || l.text === "satisfy");
    if (kwIdx !== -1) {
      let k = kwIdx + 1;
      if (leaves[k]?.text === "requirement") k++;
      const chain = readDottedChainFromLeaves(leaves, k);
      if (chain) {
        const parts = chain.text.split("::");
        return parts[parts.length - 1]!;
      }
    }
  }
  return null;
};

/**
 * Walk all symbols in the file to find satisfy/verify relationships
 * targeting a given requirement name.
 */
export const findRelationshipsTargeting = (
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
export const requirementSatisfactionQueries = {
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
export const requirementDefinitionModel = {
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
export const requirementQueries = {
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
export const stateDefinitionModel = {
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
export const stateUsageModel = {
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
export const stateQueries = {
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
export const importModel = {
  name: "ImportNode" as const,
  visitable: true,
  properties: {
    importKind: "string" as const,
    isImportAll: "boolean" as const,
    isRecursive: "boolean" as const,
  },
};
export const verificationCaseDefinitionModel = {
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
export const verificationCaseUsageModel = {
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
export const verificationCaseQueries = {
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
export const verificationCaseUsageQueries = {
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
export const getAllocationEndpointName = (db: QueryDB, ref: SymbolEntry): string => {
  if (ref.name && ref.name !== "OwnedReferenceSubsetting" && !ref.name.includes(".")) {
    const raw = (db.cstText(ref.startOffset, ref.endOffset, ref) || "").trim();
    if (raw.includes(".")) return raw;
    return ref.name.trim();
  }
  if (ref.name && ref.name !== "OwnedReferenceSubsetting") {
    return ref.name.trim();
  }
  return (db.cstText(ref.startOffset, ref.endOffset, ref) || "").trim();
};

export const getUnresolvedFeatureRange = (
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
export const allocationQueries = {
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
export const requirementUsageModel = {
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
export const requirementUsageQueries = {
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
export const satisfyRequirementModel = {
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
export const satisfyRequirementQueries = {
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

export const collectDescendants = (db: QueryDB, parentId: number, ruleNames: string[]): SymbolEntry[] => {
  const results: SymbolEntry[] = [];
  const walk = (id: number) => {
    for (const c of db.childrenOf(id)) {
      if (ruleNames.includes(c.ruleName)) results.push(c);
      if (c.kind === "Package" || c.kind === "Definition" || c.kind === "Usage") walk(c.id);
    }
  };
  walk(parentId);
  return results;
};

const collectTargetNames = (db: QueryDB, entries: SymbolEntry[]): Set<string> => {
  const names = new Set<string>();
  for (const e of entries) {
    const raw = getRelationshipTargetName(db, e) || e.name;
    if (!raw) continue;
    names.add(raw);
    const tailColon = raw.lastIndexOf("::");
    if (tailColon !== -1) names.add(raw.slice(tailColon + 2));
    const tailDot = raw.lastIndexOf(".");
    if (tailDot !== -1) names.add(raw.slice(tailDot + 1));
  }
  return names;
};

export interface TaxonomyEntry {
  iri?: string | undefined;
  directSuperClasses?: Iterable<string> | undefined;
  allSuperClasses?: Iterable<string> | undefined;
}

export const traceabilityQueries = {
  allRequirements: (db: QueryDB, self: SymbolEntry) =>
    collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]),
  satisfiedRequirements: (db: QueryDB, self: SymbolEntry) => {
    const satisfies = collectDescendants(db, self.id, ["SatisfyRequirementUsage"]);
    const satisfiedNames = collectTargetNames(db, satisfies);
    return collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]).filter(
      (r) => r.name && satisfiedNames.has(r.name),
    );
  },
  unsatisfiedRequirements: (db: QueryDB, self: SymbolEntry) => {
    const satisfies = collectDescendants(db, self.id, ["SatisfyRequirementUsage"]);
    const satisfiedNames = collectTargetNames(db, satisfies);
    return collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]).filter(
      (r) => r.name && !satisfiedNames.has(r.name),
    );
  },
  verifiedRequirements: (db: QueryDB, self: SymbolEntry) => {
    const verifies = collectDescendants(db, self.id, ["VerifyRequirementUsage"]);
    const verifiedNames = collectTargetNames(db, verifies);
    return collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]).filter(
      (r) => r.name && verifiedNames.has(r.name),
    );
  },
  unverifiedRequirements: (db: QueryDB, self: SymbolEntry) => {
    const verifies = collectDescendants(db, self.id, ["VerifyRequirementUsage"]);
    const verifiedNames = collectTargetNames(db, verifies);
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
  ontologyConsistency: (db: QueryDB, self: SymbolEntry) => {
    const axioms = emitAxioms(db, self) as Parameters<TableauReasoner["loadOntology"]>[0];
    if (!axioms || axioms.length === 0) {
      return { isConsistent: true as const, minimalConflictCore: undefined };
    }
    const reasoner = new TableauReasoner();
    reasoner.loadOntology(axioms);
    reasoner.classify();
    return reasoner.checkConsistency();
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
export const packageTraceabilityQueries = {
  ...namespaceQueries,
  ...traceabilityQueries,
  emitAxioms,
  inferredTaxonomy: traceabilityQueries.inferredTaxonomy,
  inferredSuperClasses: traceabilityQueries.inferredSuperClasses,
};

/** Extended package model with traceability query types */
export const packageTraceabilityModel = {
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
