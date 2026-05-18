// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SysML2 Constraint Extractor for Optimization.
 *
 * Extracts inequality/equality constraints from SysML2 `constraint` nodes
 * in analysis/verification cases and converts them into a format that can
 * be injected into Optimica optimization problems.
 *
 * This bridges the polyglot layer: SysML2 requirements → Optimica constraints.
 */

import type { QueryDB, SymbolEntry } from "@modelscript/compiler";

// ─────────────────────────────────────────────────────────────────────
// Public interfaces
// ─────────────────────────────────────────────────────────────────────

export interface ExtractedConstraint {
  /** Full constraint expression, e.g. "v <= 10.0" */
  expression: string;
  /** Comparison operator */
  operator: "<=" | ">=" | "==" | "<" | ">";
  /** Left-hand side variable path, e.g. "sled.v" */
  lhs: string;
  /** Right-hand side value (resolved to a number if possible) */
  rhs: number | string;
  /** Origin language */
  source: "sysml2";
  /** Requirement name, if traceable */
  requirementName?: string;
  /** Constraint entry name */
  constraintName?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Constraint extraction
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract constraints from SysML2 analysis/verification cases.
 *
 * Scans the QueryDB for constraint entries within analysis definitions,
 * parses their CST text into comparison expressions, and resolves RHS
 * values from the requirement hierarchy.
 *
 * @param db      The polyglot QueryDB containing the SysML2 index
 * @param filter  Optional analysis/package name to restrict extraction to
 * @returns       Array of extracted constraints ready for optimizer injection
 */
export function extractSysML2Constraints(db: QueryDB, filter?: string): ExtractedConstraint[] {
  const constraints: ExtractedConstraint[] = [];
  const allEntries = db.allEntries();

  // Find all constraint entries
  for (const entry of allEntries) {
    if (!isConstraintEntry(entry)) continue;

    // If a filter is specified, check that this constraint is within
    // the target analysis/package scope
    if (filter) {
      const ancestors = getAncestorNames(db, entry);
      if (!ancestors.some((n) => n === filter || n.includes(filter))) continue;
    }

    // Get the CST text for this constraint
    const cstText = db.cstText(entry.startByte, entry.endByte, entry);
    if (!cstText) continue;

    // Try to parse a comparison from the CST text
    const comp = parseComparisonFromText(cstText);
    if (!comp) continue;

    // Try to resolve the RHS to a numeric value
    const rhsNum = parseFloat(String(comp.rhs));
    const resolvedRhs = !isNaN(rhsNum) && isFinite(rhsNum) ? rhsNum : resolveRhsFromDb(db, entry, String(comp.rhs));

    // Find the parent requirement name (if any)
    const reqName = findRequirementName(db, entry);

    constraints.push({
      expression: `${comp.lhs} ${comp.op} ${comp.rhs}`,
      operator: comp.op as ExtractedConstraint["operator"],
      lhs: comp.lhs,
      rhs: resolvedRhs,
      source: "sysml2",
      requirementName: reqName,
      constraintName: entry.name,
    });
  }

  return constraints;
}

/**
 * Map extracted SysML2 constraints into optimizer-compatible constraint
 * descriptors that can be injected into an OptimizationProblem.
 *
 * @param constraints  Extracted constraints from `extractSysML2Constraints`
 * @param variableMap  Mapping from SysML2 paths to Modelica variable names
 *                     e.g., "sled.v" → "v"
 */
export function mapConstraintsToOptimizer(
  constraints: ExtractedConstraint[],
  variableMap?: Map<string, string>,
): { variable: string; bound: number; type: "<=" | ">=" }[] {
  const result: { variable: string; bound: number; type: "<=" | ">=" }[] = [];

  for (const c of constraints) {
    if (typeof c.rhs !== "number") continue; // Can only inject numeric bounds

    // Map the LHS variable path through the variable map
    let varName = c.lhs;
    if (variableMap) {
      const mapped = variableMap.get(varName);
      if (mapped) varName = mapped;
    }

    // Strip subject prefix (e.g., "sled.v" → "v")
    const dotIdx = varName.indexOf(".");
    if (dotIdx !== -1) {
      varName = varName.substring(dotIdx + 1);
    }

    // Normalize the constraint direction
    switch (c.operator) {
      case "<=":
      case "<":
        result.push({ variable: varName, bound: c.rhs, type: "<=" });
        break;
      case ">=":
      case ">":
        result.push({ variable: varName, bound: c.rhs, type: ">=" });
        break;
      case "==":
        // Equality constraints → two-sided bounds
        result.push({ variable: varName, bound: c.rhs, type: "<=" });
        result.push({ variable: varName, bound: c.rhs, type: ">=" });
        break;
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

/** True if the entry represents a SysML2 constraint usage/definition. */
function isConstraintEntry(entry: SymbolEntry): boolean {
  return entry.ruleName.includes("Constraint") && (entry.kind === "Usage" || entry.kind === "Definition");
}

/** Get ancestor names for scope filtering. */
function getAncestorNames(db: QueryDB, entry: SymbolEntry): string[] {
  const names: string[] = [];
  let current: SymbolEntry | undefined = entry;
  while (current && current.parentId !== null) {
    const parent = db.symbol(current.parentId);
    if (parent) {
      if (parent.name) names.push(parent.name);
      current = parent;
    } else {
      break;
    }
  }
  return names;
}

/** Find the requirement name associated with a constraint entry. */
function findRequirementName(db: QueryDB, constraint: SymbolEntry): string | undefined {
  // Walk up to find an analysis/verification case, then look for
  // its objective/requirement reference
  let parentId = constraint.parentId;
  while (parentId !== null) {
    const parent = db.symbol(parentId);
    if (!parent) break;

    if (parent.ruleName.includes("Analysis") || parent.ruleName.includes("Verification")) {
      // Look for an "objective" child that references a requirement
      const children = db.childrenOf(parent.id);
      for (const child of children) {
        if (child.name && child.ruleName.includes("Subject")) continue;
        if (child.ruleName.includes("Objective") || child.ruleName.includes("Requirement")) {
          return child.name || undefined;
        }
      }
      return parent.name || undefined;
    }
    parentId = parent.parentId;
  }
  return undefined;
}

/**
 * Parse a comparison expression from constraint CST text.
 * Handles patterns like:
 *   "constraint max_v { sled.v <= velReq.maxVelocity }"
 *   "sled.v <= 10.0"
 */
function parseComparisonFromText(text: string): { lhs: string; op: string; rhs: string } | null {
  // Strip constraint wrapper: "constraint name { ... }"
  let inner = text;
  const braceMatch = text.match(/\{([^}]+)\}/);
  if (braceMatch) {
    inner = braceMatch[1].trim();
  }

  // Match comparison operators
  const compMatch = inner.match(
    /([a-zA-Z_][a-zA-Z0-9_.]*)\s*(<=|>=|==|<|>)\s*([a-zA-Z_][a-zA-Z0-9_.]*|[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/,
  );
  if (compMatch) {
    return {
      lhs: compMatch[1],
      op: compMatch[2],
      rhs: compMatch[3],
    };
  }

  return null;
}

/**
 * Attempt to resolve a non-numeric RHS (e.g., "velReq.maxVelocity")
 * from the QueryDB by finding the referenced attribute and its default value.
 */
function resolveRhsFromDb(db: QueryDB, constraint: SymbolEntry, rhsPath: string): number | string {
  const segments = rhsPath.split(".");
  if (segments.length < 2) return rhsPath;

  // Walk from the constraint's parent scope to resolve the path
  const parentId = constraint.parentId;
  if (parentId === null) return rhsPath;

  // Find the first segment as a sibling (e.g., "velReq")
  const siblings = db.childrenOf(parentId);
  const firstEntry = siblings.find((s) => s.name === segments[0]);
  if (!firstEntry) return rhsPath;

  // Resolve through the type hierarchy to find the attribute
  let current = firstEntry;
  for (let i = 1; i < segments.length; i++) {
    // Look for the child directly
    const children = db.childrenOf(current.id);
    let child = children.find((c) => c.name === segments[i]);

    if (!child) {
      // Try resolving through the type
      const typeEntries = children.filter(
        (c) => c.ruleName.includes("Typing") || c.ruleName.includes("Reference") || c.ruleName.includes("Inherit"),
      );
      for (const typeRef of typeEntries) {
        if (typeRef.name) {
          const typeDefs = db.byName(typeRef.name);
          for (const typeDef of typeDefs) {
            const typeChildren = db.childrenOf(typeDef.id);
            child = typeChildren.find((c) => c.name === segments[i]);
            if (child) break;
          }
          if (child) break;
        }
      }
    }

    if (!child) return rhsPath;
    current = child;
  }

  // Extract numeric default from CST text
  const text = db.cstText(current.startByte, current.endByte, current);
  if (text) {
    const match = text.match(/=\s*(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
    if (match) return parseFloat(match[1]);
  }

  return rhsPath;
}
