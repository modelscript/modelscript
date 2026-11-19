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

import { type QueryDB, type SymbolEntry } from "@modelscript/runtime";
import {
  collectCstLeaves,
  findFirstDescendant,
  parseSysmlSource,
  readDottedChainFromLeaves,
  stripLeadingTilde,
  stripSurroundingQuotes,
  type SysmlCstNode,
} from "./cst-utils.js";
import {
  collectExpressionIdentifiers,
  evaluateSysML2Expression,
  extractAtomicComparisons,
  formatSysML2Expr,
  parseSysML2Expression,
  rewriteExpressionIdentifiers,
  type SysML2ExprAst,
} from "./evaluator.js";

// ─────────────────────────────────────────────────────────────────────
// Public interfaces
// ─────────────────────────────────────────────────────────────────────

export type ConstraintKind = "static_parameter" | "steady_state_limit" | "transient_dynamic";

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
  source: "sysml2" | "modelica";
  /** Requirement name, if traceable */
  requirementName?: string | undefined;
  /** Constraint entry name */
  constraintName?: string | undefined;
  /** Classification of the constraint for Tier 3/4 verification dispatch */
  kind?: ConstraintKind | undefined;
  /** Parameter uncertainty ranges (e.g. { R: [8, 12] }) */
  parameterRanges?: Record<string, [number, number]> | undefined;
}

export interface ExtractedFormulaBlock {
  /** Parsed compound boolean/arithmetic AST of the constraint block */
  ast: SysML2ExprAst;
  /** Raw/unwrapped constraint expression text */
  expression: string;
  /** Enclosing requirement name, if traceable */
  requirementName?: string | undefined;
  /** Constraint symbol name */
  constraintName?: string | undefined;
  /** Resolved numeric parameter environment from referenced attributes */
  parameterEnv: Record<string, number>;
}

/**
 * Classifies a constraint into static parameter limits, steady-state limits, or dynamic transients.
 */
export function classifyConstraint(lhs: string, expression: string, entryName?: string): ConstraintKind {
  const lower = `${lhs} ${expression} ${entryName ?? ""}`.toLowerCase();
  if (
    lower.includes("transient") ||
    lower.includes("time") ||
    lower.includes("dynamic") ||
    lower.includes("velocity") ||
    lower.includes("accel") ||
    lower.includes("trajectory") ||
    lower.includes("overshoot") ||
    lower.includes("settling")
  ) {
    return "transient_dynamic";
  }
  if (lower.includes("steady") || lower.includes("equilibrium") || lower.includes("operating_point")) {
    return "steady_state_limit";
  }
  return "static_parameter";
}

// ─────────────────────────────────────────────────────────────────────
// Subject scoping & requirement resolution helpers
// ─────────────────────────────────────────────────────────────────────

interface SubjectScopeInfo {
  reqId: number;
  subjectVarName?: string | undefined;
  subjectTypeName?: string | undefined;
}

function getConstraintKindRole(_db: QueryDB, entry: SymbolEntry, rawText: string): "assume" | "require" | "assert" {
  const metaKind = entry.metadata?.["constraintKind"];
  if (metaKind === "assume") return "assume";
  if (metaKind === "require") return "require";
  const trimmed = rawText.trimStart().toLowerCase();
  if (trimmed.startsWith("assume ") || trimmed.startsWith("assume{")) return "assume";
  if (trimmed.startsWith("require ") || trimmed.startsWith("require{")) return "require";
  return "assert";
}

function isNegatedAssertionEntry(entry: SymbolEntry, rawText: string): boolean {
  const metaNeg = entry.metadata?.["isNegated"];
  if (metaNeg === true || metaNeg === "true" || metaNeg === "not") return true;
  return /^\s*(?:#[A-Za-z0-9_:]+\s+)*(?:(?:public|private|protected)\s+)?assert\s+not\b/.test(rawText);
}

function extractSubjectTypeFromUsage(db: QueryDB, subj: SymbolEntry): string | undefined {
  for (const ch of db.childrenOf(subj.id)) {
    if (
      (ch.ruleName === "OwnedFeatureTyping" ||
        ch.ruleName === "OwnedSubsetting" ||
        ch.ruleName === "OwnedRedefinition") &&
      ch.name
    ) {
      const cleaned = stripLeadingTilde(ch.name);
      const last = cleaned.includes("::") ? cleaned.split("::").pop()! : cleaned;
      if (last) return stripSurroundingQuotes(last.trim());
    }
  }
  if (subj.metadata?.["typeSpecifier"]) {
    const cleaned = stripLeadingTilde(String(subj.metadata["typeSpecifier"]));
    const last = cleaned.includes("::") ? cleaned.split("::").pop()! : cleaned;
    if (last) return stripSurroundingQuotes(last.trim());
  }
  const text = db.cstText(subj.startOffset, subj.endOffset, subj);
  if (text) {
    const leaves = collectCstLeaves(parseSysmlSource(text));
    const colonIdx = leaves.findIndex((l) => l.text === ":");
    if (colonIdx !== -1) {
      const chain = readDottedChainFromLeaves(leaves, colonIdx + 1);
      if (chain) {
        const last = chain.text.includes("::") ? chain.text.split("::").pop()! : chain.text;
        if (last) return stripSurroundingQuotes(last.trim());
      }
    }
  }
  return undefined;
}

function findRequirementSubjectInfo(db: QueryDB, constraint: SymbolEntry): SubjectScopeInfo | null {
  let parentId = constraint.parentId;
  let guard = 0;
  while (parentId !== null && guard++ < 64) {
    const parent = db.symbol(parentId);
    if (!parent) break;
    if (parent.ruleName === "RequirementDefinition" || parent.ruleName === "RequirementUsage") {
      const findSubj = (reqSym: SymbolEntry, visited = new Set<number>()): SubjectUsageMatch | null => {
        if (visited.has(reqSym.id)) return null;
        visited.add(reqSym.id);
        for (const ch of db.childrenOf(reqSym.id)) {
          if (ch.ruleName === "SubjectUsage") {
            const varName =
              ch.name && ch.name !== "<anonymous>" && ch.name !== "SubjectUsage"
                ? stripSurroundingQuotes(ch.name)
                : undefined;
            const typeName = extractSubjectTypeFromUsage(db, ch);
            return { varName, typeName };
          }
        }
        // Check specialized requirement definitions (`:> BaseReq` or `: ReqDef`)
        for (const ch of db.childrenOf(reqSym.id)) {
          if (
            (ch.ruleName === "OwnedSubclassification" ||
              ch.ruleName === "OwnedFeatureTyping" ||
              ch.ruleName === "OwnedSubsetting" ||
              ch.ruleName === "OwnedRedefinition") &&
            ch.name
          ) {
            const baseName = ch.name.includes("::") ? ch.name.split("::").pop()! : ch.name;
            for (const cand of db.byName(baseName) || []) {
              if (cand.ruleName === "RequirementDefinition" || cand.ruleName === "RequirementUsage") {
                const inherited = findSubj(cand, visited);
                if (inherited) return inherited;
              }
            }
          }
        }
        return null;
      };

      const match = findSubj(parent);
      return {
        reqId: parent.id,
        subjectVarName: match?.varName,
        subjectTypeName: match?.typeName,
      };
    }
    parentId = parent.parentId;
  }
  return null;
}

interface SubjectUsageMatch {
  varName?: string | undefined;
  typeName?: string | undefined;
}

function collectSharedPackageAttributeNames(db: QueryDB, entry: SymbolEntry): Set<string> {
  const shared = new Set<string>();
  let pid = entry.parentId;
  let guard = 0;
  while (pid !== null && guard++ < 64) {
    const anc = db.symbol(pid);
    if (!anc) break;
    if (anc.ruleName === "Package" || anc.ruleName === "LibraryPackage") {
      for (const ch of db.childrenOf(anc.id)) {
        if (ch.ruleName === "AttributeUsage" && ch.name && ch.name !== "<anonymous>") {
          shared.add(stripSurroundingQuotes(ch.name));
        }
      }
    }
    pid = anc.parentId;
  }
  return shared;
}

function computeSubjectRenamesForAst(
  db: QueryDB,
  entry: SymbolEntry,
  ast: SysML2ExprAst,
  subjInfo: SubjectScopeInfo | null,
  distinctSubjectTypesCount: number,
  varNamesPerSubjectType: Map<string, Set<string>>,
): Array<readonly [string, string]> {
  if (!subjInfo?.subjectTypeName) return [];
  const typeName = subjInfo.subjectTypeName;
  const varName = subjInfo.subjectVarName;
  const renames: Array<readonly [string, string]> = [];

  if (distinctSubjectTypesCount >= 2) {
    if (varName && varName !== typeName) {
      renames.push([varName, typeName]);
    }
    const sharedPkgAttrs = collectSharedPackageAttributeNames(db, entry);
    const idents = collectExpressionIdentifiers(ast);
    for (const id of idents) {
      if (!id.includes(".") && !id.includes("::") && id !== varName && !sharedPkgAttrs.has(id)) {
        renames.push([id, `${typeName}.${id}`]);
      }
    }
  } else if (distinctSubjectTypesCount === 1 && varName) {
    const varNamesForType = varNamesPerSubjectType.get(typeName);
    if (varNamesForType && varNamesForType.size >= 2) {
      renames.push([varName, typeName]);
    }
  }

  return renames;
}

// ─────────────────────────────────────────────────────────────────────
// Constraint & Formula extraction
// ─────────────────────────────────────────────────────────────────────

/**
 * Extracts structured SysML v2 constraint/requirement formula blocks from `QueryDB`,
 * preserving compound boolean structure (`or`, `implies`, `not`, `xor`, `and`),
 * `assume ... implies require ...` requirement contracts, exact `scopeFilter` matching,
 * and `SubjectUsage` type scoping when multiple requirements constrain distinct subject types.
 */
export function extractSysML2FormulaBlocks(db: QueryDB, filter?: string): ExtractedFormulaBlock[] {
  const allEntries = db.allEntries();
  const matchedEntries: SymbolEntry[] = [];

  for (const entry of allEntries) {
    if (!isConstraintEntry(entry)) continue;
    if (filter && !matchesScopeFilter(db, entry, filter)) continue;
    matchedEntries.push(entry);
  }

  // Analyze SubjectUsage types across matched constraints
  const subjectInfoByEntry = new Map<number, SubjectScopeInfo | null>();
  const distinctSubjectTypes = new Set<string>();
  const varNamesPerSubjectType = new Map<string, Set<string>>();

  for (const entry of matchedEntries) {
    const info = findRequirementSubjectInfo(db, entry);
    subjectInfoByEntry.set(entry.id, info);
    if (info?.subjectTypeName) {
      distinctSubjectTypes.add(info.subjectTypeName);
      if (info.subjectVarName) {
        let s = varNamesPerSubjectType.get(info.subjectTypeName);
        if (!s) {
          s = new Set<string>();
          varNamesPerSubjectType.set(info.subjectTypeName, s);
        }
        s.add(info.subjectVarName);
      }
    }
  }

  // Group `assume` + `require` constraints belonging to the same requirement so `assume A; require R;` -> `A implies R`
  interface PreparedEntry {
    entry: SymbolEntry;
    role: "assume" | "require" | "assert";
    ast: SysML2ExprAst;
    rawText: string;
    reqName: string | undefined;
    reqId: number | null;
    parameterEnv: Record<string, number>;
  }

  const prepared: PreparedEntry[] = [];
  for (const entry of matchedEntries) {
    const cstText = db.cstText(entry.startOffset, entry.endOffset, entry);
    if (!cstText || !cstText.trim()) continue;

    let ast = parseSysML2Expression(cstText);
    if (isNegatedAssertionEntry(entry, cstText)) {
      ast = { kind: "UnaryExpr", op: "not", operand: ast };
    }
    const parameterEnv: Record<string, number> = {};
    for (const id of collectExpressionIdentifiers(ast)) {
      const resolved = resolveRhsFromDb(db, entry, id);
      if (typeof resolved === "number" && Number.isFinite(resolved)) {
        parameterEnv[id] = resolved;
      }
    }

    const subjInfo = subjectInfoByEntry.get(entry.id) ?? null;
    const renames = computeSubjectRenamesForAst(
      db,
      entry,
      ast,
      subjInfo,
      distinctSubjectTypes.size,
      varNamesPerSubjectType,
    );
    if (renames.length > 0) {
      ast = rewriteExpressionIdentifiers(ast, renames);
      for (const [src, dst] of renames) {
        if (src in parameterEnv && !(dst in parameterEnv)) {
          parameterEnv[dst] = parameterEnv[src]!;
        }
      }
    }

    const reqName = findRequirementName(db, entry);
    const role = getConstraintKindRole(db, entry, cstText);
    prepared.push({
      entry,
      role,
      ast,
      rawText: cstText.trim(),
      reqName,
      reqId: subjInfo?.reqId ?? null,
      parameterEnv,
    });
  }

  // Determine which requirements have both `assume` and `require` constraints
  const reqRoles = new Map<number, { assumes: PreparedEntry[]; requires: PreparedEntry[] }>();
  for (const p of prepared) {
    if (p.reqId !== null && (p.role === "assume" || p.role === "require")) {
      let bucket = reqRoles.get(p.reqId);
      if (!bucket) {
        bucket = { assumes: [], requires: [] };
        reqRoles.set(p.reqId, bucket);
      }
      if (p.role === "assume") bucket.assumes.push(p);
      else bucket.requires.push(p);
    }
  }

  const emittedReqContracts = new Set<number>();
  const blocks: ExtractedFormulaBlock[] = [];

  for (const p of prepared) {
    if (p.reqId !== null) {
      const bucket = reqRoles.get(p.reqId);
      if (bucket && bucket.assumes.length > 0 && bucket.requires.length > 0) {
        if (emittedReqContracts.has(p.reqId)) continue;
        emittedReqContracts.add(p.reqId);

        const conj = (items: PreparedEntry[]): SysML2ExprAst =>
          items
            .slice(1)
            .reduce<SysML2ExprAst>(
              (acc, cur) => ({ kind: "BinaryExpr", op: "and", left: acc, right: cur.ast }),
              items[0]!.ast,
            );
        const assumeAst = conj(bucket.assumes);
        const requireAst = conj(bucket.requires);
        const combinedAst: SysML2ExprAst = {
          kind: "BinaryExpr",
          op: "implies",
          left: assumeAst,
          right: requireAst,
        };
        const mergedEnv: Record<string, number> = {};
        for (const item of [...bucket.assumes, ...bucket.requires]) {
          Object.assign(mergedEnv, item.parameterEnv);
        }
        blocks.push({
          ast: combinedAst,
          expression: formatSysML2Expr(combinedAst),
          requirementName: p.reqName,
          constraintName: p.entry.name,
          parameterEnv: mergedEnv,
        });
        continue;
      }
    }

    blocks.push({
      ast: p.ast,
      expression: formatSysML2Expr(p.ast),
      requirementName: p.reqName,
      constraintName: p.entry.name,
      parameterEnv: p.parameterEnv,
    });
  }

  return blocks;
}

/**
 * Extract constraints from SysML2 analysis/verification cases and requirements.
 *
 * Scans the QueryDB for constraint entries within matching scopes,
 * parses their CST text into comparison expressions (including compound
 * boolean `and`/`or`/`implies`/`not` blocks and arithmetic RHS expressions),
 * and resolves RHS values from the requirement hierarchy.
 *
 * @param db      The polyglot QueryDB containing the SysML2 index
 * @param filter  Optional exact analysis/requirement/package name to restrict extraction to
 * @returns       Array of extracted constraints ready for optimizer injection
 */
export function extractSysML2Constraints(db: QueryDB, filter?: string): ExtractedConstraint[] {
  const constraints: ExtractedConstraint[] = [];
  const allEntries = db.allEntries();
  const matchedEntries: SymbolEntry[] = [];

  for (const entry of allEntries) {
    if (!isConstraintEntry(entry)) continue;
    if (filter && !matchesScopeFilter(db, entry, filter)) continue;
    matchedEntries.push(entry);
  }

  const subjectInfoByEntry = new Map<number, SubjectScopeInfo | null>();
  const distinctSubjectTypes = new Set<string>();
  const varNamesPerSubjectType = new Map<string, Set<string>>();

  for (const entry of matchedEntries) {
    const info = findRequirementSubjectInfo(db, entry);
    subjectInfoByEntry.set(entry.id, info);
    if (info?.subjectTypeName) {
      distinctSubjectTypes.add(info.subjectTypeName);
      if (info.subjectVarName) {
        let s = varNamesPerSubjectType.get(info.subjectTypeName);
        if (!s) {
          s = new Set<string>();
          varNamesPerSubjectType.set(info.subjectTypeName, s);
        }
        s.add(info.subjectVarName);
      }
    }
  }

  for (const entry of matchedEntries) {
    // Get the CST text for this constraint
    const cstText = db.cstText(entry.startOffset, entry.endOffset, entry);
    if (!cstText) continue;

    let parsedAst = parseSysML2Expression(cstText);
    if (isNegatedAssertionEntry(entry, cstText)) {
      parsedAst = { kind: "UnaryExpr", op: "not", operand: parsedAst };
    }
    const preRenameEnv: Record<string, number> = {};
    for (const id of collectExpressionIdentifiers(parsedAst)) {
      const val = resolveRhsFromDb(db, entry, id);
      if (typeof val === "number" && !Number.isNaN(val)) {
        preRenameEnv[id] = val;
      }
    }

    const subjInfo = subjectInfoByEntry.get(entry.id) ?? null;
    const renames = computeSubjectRenamesForAst(
      db,
      entry,
      parsedAst,
      subjInfo,
      distinctSubjectTypes.size,
      varNamesPerSubjectType,
    );
    if (renames.length > 0) {
      parsedAst = rewriteExpressionIdentifiers(parsedAst, renames);
      for (const [src, dst] of renames) {
        if (src in preRenameEnv && !(dst in preRenameEnv)) {
          preRenameEnv[dst] = preRenameEnv[src]!;
        }
      }
    }

    // Extract all atomic comparisons from the (subject-scoped) AST
    const atomicComps = extractAtomicComparisons(parsedAst);
    const comps = atomicComps.map((a) => ({
      lhs: a.lhs,
      op: a.negated
        ? a.operator === "<="
          ? ">"
          : a.operator === "<"
            ? ">="
            : a.operator === ">="
              ? "<"
              : a.operator === ">"
                ? "<="
                : a.operator === "=="
                  ? "!="
                  : a.operator === "!="
                    ? "=="
                    : a.operator
        : a.operator,
      rhs: a.rhs,
      rhsAst: a.rhsAst,
    }));

    const reqName = findRequirementName(db, entry);

    for (const comp of comps) {
      if (comp.op === "!=") continue;
      let resolvedRhs: number | string = comp.rhs;

      const idents = collectExpressionIdentifiers(comp.rhsAst);
      const env: Record<string, number> = {};
      let allNumeric = true;
      for (const id of idents) {
        const val = id in preRenameEnv ? preRenameEnv[id]! : resolveRhsFromDb(db, entry, id);
        if (typeof val === "number" && !Number.isNaN(val)) {
          env[id] = val;
        } else {
          allNumeric = false;
        }
      }
      if (allNumeric) {
        const evalVal = evaluateSysML2Expression(comp.rhsAst, env);
        if (typeof evalVal === "number" && Number.isFinite(evalVal)) {
          resolvedRhs = evalVal;
        }
      } else if (idents.size === 1) {
        const single = Array.from(idents)[0]!;
        resolvedRhs = single in preRenameEnv ? preRenameEnv[single]! : resolveRhsFromDb(db, entry, String(comp.rhs));
      }

      const kind = classifyConstraint(comp.lhs, cstText, entry.name);

      constraints.push({
        expression: `${comp.lhs} ${comp.op} ${comp.rhs}`,
        operator: comp.op as ExtractedConstraint["operator"],
        lhs: comp.lhs,
        rhs: resolvedRhs,
        source: "sysml2",
        requirementName: reqName,
        constraintName: entry.name,
        kind,
      });
    }
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

/** Checks exact symbol or ancestor scope name equality (never substring `.includes()`). */
function matchesScopeFilter(db: QueryDB, entry: SymbolEntry, filter: string): boolean {
  const cleanFilter = stripSurroundingQuotes(filter.trim());
  if (!cleanFilter) return true;
  if (entry.name && stripSurroundingQuotes(entry.name) === cleanFilter) return true;

  const ancestors = getAncestorNames(db, entry);
  if (ancestors.some((n) => stripSurroundingQuotes(n) === cleanFilter)) {
    return true;
  }

  if (cleanFilter.includes("::")) {
    const orderedAncestors = [...ancestors].reverse().map((n) => stripSurroundingQuotes(n));
    const fullPath = entry.name
      ? [...orderedAncestors, stripSurroundingQuotes(entry.name)].join("::")
      : orderedAncestors.join("::");
    const ancestorPath = orderedAncestors.join("::");
    if (
      fullPath === cleanFilter ||
      ancestorPath === cleanFilter ||
      ancestorPath.startsWith(`${cleanFilter}::`) ||
      ancestorPath.endsWith(`::${cleanFilter}`)
    ) {
      return true;
    }
  }

  return false;
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
  let parentId = constraint.parentId;
  while (parentId !== null) {
    const parent = db.symbol(parentId);
    if (!parent) break;

    if (
      parent.ruleName === "RequirementDefinition" ||
      parent.ruleName === "RequirementUsage" ||
      parent.ruleName === "ObjectiveRequirementUsage"
    ) {
      if (parent.name && parent.name !== "<anonymous>" && parent.name !== parent.ruleName) {
        return stripSurroundingQuotes(parent.name);
      }
      // Check if an anonymous requirement usage specializes/types a named requirement
      for (const ch of db.childrenOf(parent.id)) {
        if (
          (ch.ruleName === "OwnedFeatureTyping" ||
            ch.ruleName === "OwnedSubsetting" ||
            ch.ruleName === "OwnedRedefinition" ||
            ch.ruleName === "OwnedSubclassification") &&
          ch.name
        ) {
          return stripSurroundingQuotes(ch.name);
        }
      }
    }

    if (parent.ruleName.includes("Analysis") || parent.ruleName.includes("Verification")) {
      // Look for an "objective" child that references a requirement
      const children = db.childrenOf(parent.id);
      for (const child of children) {
        if (child.name && child.ruleName.includes("Subject")) continue;
        if (child.ruleName.includes("Objective") || child.ruleName.includes("Requirement")) {
          if (child.name && child.name !== "<anonymous>" && child.name !== child.ruleName) {
            return stripSurroundingQuotes(child.name);
          }
          for (const gc of db.childrenOf(child.id)) {
            if (gc.name && gc.name !== "<anonymous>") {
              return stripSurroundingQuotes(gc.name);
            }
          }
        }
      }
      return parent.name ? stripSurroundingQuotes(parent.name) : undefined;
    }
    parentId = parent.parentId;
  }
  return undefined;
}

/**
 * Attempt to resolve a non-numeric RHS (e.g., "velReq.maxVelocity")
 * from the QueryDB by finding the referenced attribute and its default value.
 */
function resolveRhsFromDb(db: QueryDB, constraint: SymbolEntry, rhsPath: string): number | string {
  const segments = rhsPath.split(".");
  if (segments.length < 2) {
    // Only substitute single-segment identifiers if declared `constant` in enclosing scope
    let pid = constraint.parentId;
    let guard = 0;
    while (pid !== null && guard++ < 32) {
      const anc = db.symbol(pid);
      if (!anc) break;
      for (const ch of db.childrenOf(anc.id)) {
        if (ch.name === rhsPath && ch.ruleName === "AttributeUsage" && Boolean(ch.metadata?.["isConstant"])) {
          const val = evaluateSymbolDefaultValue(db, ch);
          if (val !== undefined) return val;
        }
      }
      pid = anc.parentId;
    }
    return rhsPath;
  }

  // Walk from the constraint's parent scope to resolve the path
  const parentId = constraint.parentId;
  if (parentId === null) return rhsPath;

  // Find the first segment as a sibling (e.g., "velReq") or enclosing scope member
  let firstEntry: SymbolEntry | undefined;
  let searchScope: number | null = parentId;
  let guard = 0;
  while (searchScope !== null && guard++ < 32 && !firstEntry) {
    const siblings = db.childrenOf(searchScope);
    firstEntry = siblings.find((s) => s.name === segments[0]);
    if (firstEntry) break;
    searchScope = db.symbol(searchScope)?.parentId ?? null;
  }
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

  const evaluated = evaluateSymbolDefaultValue(db, current);
  return evaluated !== undefined ? evaluated : rhsPath;
}

function evaluateSymbolDefaultValue(db: QueryDB, sym: SymbolEntry): number | undefined {
  let cstNode: SysmlCstNode | null =
    typeof db.cstNode === "function" ? (db.cstNode(sym.id) as SysmlCstNode | null) : null;
  if (!cstNode) {
    const text = db.cstText(sym.startOffset, sym.endOffset, sym);
    if (text) cstNode = parseSysmlSource(text);
  }
  if (cstNode) {
    const fv = findFirstDescendant(cstNode, "FeatureValue");
    const exprNode = fv ? (findFirstDescendant(fv, "OwnedExpression") ?? fv) : null;
    if (exprNode) {
      const evaluated = evaluateSysML2Expression(exprNode.text);
      if (typeof evaluated === "number" && Number.isFinite(evaluated)) {
        return evaluated;
      }
    }
  }
  return undefined;
}
