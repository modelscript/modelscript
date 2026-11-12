// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Semantic Queries, AST Models, and KerML Expression Evaluator.
 *
 * Implements Salsa memoized query descriptors, AST model interfaces, and zero-allocation
 * CST expression evaluation for SysML v2 / KerML declarations.
 */

import type { CSTNode } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { TableauReasoner } from "@modelscript/runtime";
import { emitAxioms } from "./reasoner-bridge.js";

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

/** CSTNode type alias for expression evaluation */
// type CSTNode imported at top

/**
 * Resolve a feature reference name within a scope.
 * Searches: (1) qualified names, (2) direct scope children, (3) imported members/namespaces, (4) global byName.
 */
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
export const getFeatureValue = (db: QueryDB, entry: SymbolEntry): EvalResult => {
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
export const resolveFeaturePath = (db: QueryDB, names: string[], scopeId: number | null): EvalResult => {
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
export const evaluateExpressionNode = (db: QueryDB, node: CSTNode, scopeId: number | null): EvalResult => {
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
export const evaluateResultExpression = (db: QueryDB, self: SymbolEntry, evalScopeId?: number | null): EvalResult => {
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
export const evaluateConstraintBody = (db: QueryDB, self: SymbolEntry, evalScopeId?: number | null): boolean | null => {
  const result = evaluateResultExpression(db, self, evalScopeId);
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
  const text = db.cstText(Math.max(0, self.startOffset - 30), self.startOffset);
  if (text && text.includes("assume")) return "assume";
  return "require"; // default
};

/**
 * Computed: are all require constraints met for a requirement?
 * Returns true (all pass), false (any fail), or null (indeterminate).
 */
export const evaluateConstraintsMet = (db: QueryDB, self: SymbolEntry): boolean | null => {
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
    const raw = (db.cstText(ref.startOffset, ref.endOffset) || "").trim();
    if (raw.includes(".")) return raw;
    return ref.name.trim();
  }
  if (ref.name && ref.name !== "OwnedReferenceSubsetting") {
    return ref.name.trim();
  }
  return (db.cstText(ref.startOffset, ref.endOffset) || "").trim();
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
      if (c.kind === "Package" || c.kind === "Definition") walk(c.id);
    }
  };
  walk(parentId);
  return results;
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
