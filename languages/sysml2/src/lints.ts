// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Static and Formal Verification Lints.
 *
 * Implements multi-tier diagnostics for SysML v2 / KerML declarations:
 * - Structural and semantic lints (S1xxx - S5xxx)
 * - Interprocedural control-flow analysis (CFA)
 * - State machine reachability and determinism verification
 * - Requirement satisfaction and contract verification
 * - Physical dimensional compatibility checking
 */

import { error, info, warning, type CSTNode, type LintResult } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { analyzeInterproceduralCfa } from "./activity-cfa.js";
import { checkActivitySoundnessForSymbol } from "./activity-soundness.js";
import { extractActivityInvariants, SysML2ActivityVerifier } from "./activity-verifier.js";
import {
  collectCstLeaves,
  findMatchingBraceLeaf,
  isSysmlIdentLeaf,
  parseSignedNumberFromLeaves,
  parseSysmlSource,
  readDottedChainFromLeaves,
  sliceBetweenLeaves,
  stripNamespaceWildcard,
} from "./cst-utils.js";
import { DecisionTableVerifier } from "./decision-table-verifier.js";
import {
  areDimensionsEqual,
  getDimensionLabel,
  inferExpressionDimension,
  isDimensionless,
  resolveTypeDimension,
} from "./dimensions.js";
import { createSysML2Diagnostic, SysML2ErrorCode } from "./errors.js";
import type { SysmlCstNode } from "./flattener/cst-lowerer.js";
import { LoopInvariantAnalyzer } from "./loop-invariant-analyzer.js";
import {
  collectDescendants,
  evaluateConstraintBody,
  evaluateConstraintsMet,
  evaluateExpressionNode,
  evaluateRequirementCompliance,
  findApplicableStandardRequirements,
  findExplicitSatisfyTargetsForSubject,
  findRelationshipsTargeting,
  getAllocationEndpointName,
  getRelationshipTargetName,
  getUnresolvedFeatureRange,
  metaStr,
  resolveFeatureInScope,
  resolveSatisfyingSubject,
  resolveSatisfyingTargetRequirement,
  resolveTypeOf,
  type RequirementComplianceResult,
} from "./queries.js";
import { emitAxioms } from "./reasoner-bridge.js";
import {
  checkBindingConnectorTypeMismatch,
  checkConnectionTypeCompatibility,
  checkFeatureAssignmentType,
  checkImportResolution,
  checkPortConjugationMismatch,
  checkSymbolResolution,
} from "./type-checker.js";

function isAsciiWordCharCode(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function startsWithLowerAscii(value: string): boolean {
  if (value.length === 0) return false;
  const code = value.charCodeAt(0);
  return code >= 97 && code <= 122;
}

function startsWithUpperAscii(value: string): boolean {
  if (value.length === 0) return false;
  const code = value.charCodeAt(0);
  return code >= 65 && code <= 90;
}

function hasWordPrefixCaseInsensitive(text: string, prefix: string): boolean {
  const lower = text.toLowerCase();
  const needle = prefix.toLowerCase();
  let from = 0;
  while (from < lower.length) {
    const idx = lower.indexOf(needle, from);
    if (idx < 0) return false;
    if (idx === 0 || !isAsciiWordCharCode(text.charCodeAt(idx - 1))) {
      return true;
    }
    from = idx + 1;
  }
  return false;
}

function hasCriticalRequirementMarker(name: string, text: string): boolean {
  if (name && hasWordPrefixCaseInsensitive(name, "critical")) {
    return true;
  }
  if (!text) return false;
  const leaves = collectCstLeaves(parseSysmlSource(text));
  for (let i = 0; i < leaves.length; i++) {
    const tok = leaves[i]!.text;
    const lowerTok = tok.toLowerCase();
    if (lowerTok === "criticality") return true;
    if (tok === "@" && i + 1 < leaves.length) {
      const nextLower = leaves[i + 1]!.text.toLowerCase();
      if (nextLower === "critical" || nextLower === "safetycritical") {
        return true;
      }
    }
    if (tok === "#" && i + 1 < leaves.length) {
      const nextLower = leaves[i + 1]!.text.toLowerCase();
      if (nextLower === "critical" || nextLower === "safety") {
        return true;
      }
    }
  }
  // Block comments are discarded by the WASM lexer, so inspect /* ... */ spans directly.
  let pos = 0;
  while (pos < text.length) {
    const open = text.indexOf("/*", pos);
    if (open < 0) break;
    const close = text.indexOf("*/", open + 2);
    const end = close < 0 ? text.length : close;
    const commentBody = text.slice(open + 2, end);
    if (hasWordPrefixCaseInsensitive(commentBody, "critical")) {
      return true;
    }
    pos = close < 0 ? text.length : close + 2;
  }
  return false;
}

/** Shared lint rules for all Definition rules */
export const definitionLints = {
  definitionNaming: (_db: QueryDB, self: SymbolEntry) => {
    if (self.name && startsWithLowerAscii(self.name)) {
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
      if (!child.name || child.name === "<anonymous>" || child.name === child.ruleName) continue;
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
export const usageLints = {
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
    if (self.name && self.name !== self.ruleName && startsWithUpperAscii(self.name)) {
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
  multiplicityBounds: (db: QueryDB, self: SymbolEntry) => {
    // metadata fields are extracted as strings from the CST if they existed
    const lowerStr = self.metadata?.["multiplicityLower"] as string | undefined;
    if (!lowerStr) return null; // No multiplicity declared

    let upperStr = self.metadata?.["multiplicityUpper"] as string | undefined;
    if (!upperStr) upperStr = lowerStr; // e.g. [3] means lower=3, upper=3

    const parseBound = (s: string) => (s.trim() === "*" || s.includes("Infinity") ? Infinity : parseFloat(s));
    const lower = parseBound(lowerStr);
    const upper = parseBound(upperStr);

    if (!isNaN(lower) && !isNaN(upper) && lower > upper) {
      let startOffset = self.fieldRanges?.["multiplicityLower"]?.startOffset;
      let endOffset =
        self.fieldRanges?.["multiplicityUpper"]?.endOffset ?? self.fieldRanges?.["multiplicityLower"]?.endOffset;
      if (startOffset === undefined || endOffset === undefined) {
        const cst = db.cstNode(self.id) as CSTNode | null;
        const findMult = (n: CSTNode | null): CSTNode | null => {
          if (!n) return null;
          if (n.type === "MultiplicityBounds" || n.type === "OwnedMultiplicity" || n.type === "MultiplicityRange") {
            return n;
          }
          for (const ch of n.children || []) {
            if (ch.type === "{") break;
            const found = findMult(ch);
            if (found) return found;
          }
          return null;
        };
        const multNode = findMult(cst) as (CSTNode & { startOffset?: number; endOffset?: number }) | null;
        if (multNode && typeof multNode.startOffset === "number" && typeof multNode.endOffset === "number") {
          startOffset = multNode.startOffset;
          endOffset = multNode.endOffset;
        }
      }
      return error(SysML2ErrorCode.MULTIPLICITY_LOWER_GT_UPPER.message(lowerStr, upperStr), {
        code: SysML2ErrorCode.MULTIPLICITY_LOWER_GT_UPPER.code,
        startOffset: startOffset ?? self.startOffset,
        endOffset: endOffset ?? self.endOffset,
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
  /** Automatically checks PartUsage/ItemUsage/OccurrenceUsage against imported or workspace-active standard clauses matching its type. */
  standardComplianceCheck: (db: QueryDB, self: SymbolEntry): LintResult[] | null => {
    if (self.ruleName !== "PartUsage" && self.ruleName !== "ItemUsage" && self.ruleName !== "OccurrenceUsage") {
      return null;
    }
    if (metaStr(self, "isAbstract") === "true") return null;

    const applicableReqs = findApplicableStandardRequirements(db, self);
    if (applicableReqs.length === 0) return null;

    const explicitlyCovered = findExplicitSatisfyTargetsForSubject(db, self);
    const diagnostics: LintResult[] = [];
    const subjectLabel = self.name || self.ruleName;

    for (const req of applicableReqs) {
      if (explicitlyCovered.has(req.id)) continue;
      const compliance = evaluateRequirementCompliance(db, req, self);
      // Assume guards make inapplicable requirements vacuously satisfied during implicit profile scanning
      if (compliance.status !== "violated") continue;
      const range = self.name
        ? { field: "declaredName" as const }
        : { startOffset: self.startOffset, endOffset: self.endOffset };
      diagnostics.push(formatStandardComplianceDiagnostic(compliance, subjectLabel, req.name || req.ruleName, range));
    }

    return diagnostics.length > 0 ? diagnostics : null;
  },
};

function formatStandardComplianceDiagnostic(
  compliance: RequirementComplianceResult,
  subjectName: string,
  reqName: string,
  range: { field?: string; startOffset?: number; endOffset?: number },
): LintResult {
  const clauseLabel = compliance.clauseMeta.label ?? "";
  const detail = compliance.failedConstraints.join("; ");
  const def =
    compliance.clauseMeta.severity === "warning"
      ? SysML2ErrorCode.STANDARD_COMPLIANCE_WARNING
      : SysML2ErrorCode.STANDARD_COMPLIANCE_VIOLATION;
  return createSysML2Diagnostic(def, [clauseLabel, subjectName, reqName, detail], range);
}

/** Lint rules for Constraint Definition/Usage — report violated constraints */
export const constraintLints = {
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

export const constraintDefinitionLints = {
  ...definitionLints,
  ...constraintLints,
};

export const constraintUsageLintRules = {
  ...usageLints,
  ...constraintLints,
};

export const requirementLints = {
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

export const satisfyRequirementLints = {
  ...usageLints,
  invalidTarget: (db: QueryDB, self: SymbolEntry) => {
    const targetName = getRelationshipTargetName(db, self);
    if (!targetName || targetName === self.ruleName) return null;
    const targets = db.byName(targetName);
    const reqTarget = targets.find((t) => t.ruleName === "RequirementDefinition" || t.ruleName === "RequirementUsage");
    if (targets.length > 0 && !reqTarget) {
      const ref = db.childrenOf(self.id).find((c) => c.kind === "Reference" || c.kind === "Specialization");
      return error(SysML2ErrorCode.SATISFY_TARGET_NOT_REQUIREMENT.message(targetName), {
        code: SysML2ErrorCode.SATISFY_TARGET_NOT_REQUIREMENT.code,
        ...(ref ? { startOffset: ref.startOffset, endOffset: ref.endOffset } : { field: "declaredName" }),
      });
    }
    return null;
  },
  /** Error/Warning when satisfying a requirement whose constraints are violated or inapplicable */
  satisfyingViolatedRequirement: (db: QueryDB, self: SymbolEntry) => {
    const reqTarget = resolveSatisfyingTargetRequirement(db, self);
    const targetName = reqTarget?.name || getRelationshipTargetName(db, self);
    if (!reqTarget || !targetName) return null;

    const subjectSym = resolveSatisfyingSubject(db, self);
    const compliance = evaluateRequirementCompliance(db, reqTarget, subjectSym);
    const ref = db.childrenOf(self.id).find((c) => c.kind === "Reference" || c.kind === "Specialization");
    const range = ref ? { startOffset: ref.startOffset, endOffset: ref.endOffset } : { field: "declaredName" as const };

    if (compliance.status === "inapplicable") {
      return createSysML2Diagnostic(
        SysML2ErrorCode.REQUIREMENT_NOT_APPLICABLE,
        [
          reqTarget.name || targetName,
          compliance.subjectName ?? subjectSym?.name ?? "",
          compliance.clauseMeta.label ?? "",
        ],
        range,
      );
    }

    if (compliance.status === "violated") {
      if (compliance.clauseMeta.label) {
        const subjectLabel = compliance.subjectName ?? subjectSym?.name ?? targetName;
        return formatStandardComplianceDiagnostic(compliance, subjectLabel, reqTarget.name || targetName, range);
      }
      return warning(`Satisfying '${targetName}' whose constraints evaluate to false`, {
        code: SysML2ErrorCode.SATISFYING_VIOLATED_REQUIREMENT.code,
        ...range,
      });
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Verification Case models, queries, and lints
// ---------------------------------------------------------------------------

/** Model config for VerificationCaseDefinition */
export const verificationCaseDefinitionLints = {
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
export const verificationCaseUsageLints = {
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

export const allocationLints = {
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
                startOffset: refs[1]!.startOffset,
                endOffset: refs[1]!.endOffset,
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
export const connectionLints = {
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
                startOffset: refs[1]!.startOffset,
                endOffset: refs[1]!.endOffset,
              },
            );
          }
        }
      }
    }
    return null;
  },
  connectionTypeCompatibility: (db: QueryDB, self: SymbolEntry) => checkConnectionTypeCompatibility(db, self),
  portConjugationMismatch: (db: QueryDB, self: SymbolEntry) => checkPortConjugationMismatch(db, self),
  circularPortDelegation: (db: QueryDB, self: SymbolEntry) => {
    const refs = db.childrenOf(self.id).filter((c) => c.kind === "Reference");
    if (refs.length < 2) return null;
    const sourceName = getAllocationEndpointName(db, refs[0]!);
    const targetName = getAllocationEndpointName(db, refs[1]!);
    if (!sourceName || !targetName) return null;

    if (sourceName === targetName) {
      return error(SysML2ErrorCode.CIRCULAR_PORT_DELEGATION.message(sourceName), {
        code: SysML2ErrorCode.CIRCULAR_PORT_DELEGATION.code,
        startOffset: refs[1]!.startOffset,
        endOffset: refs[1]!.endOffset,
      });
    }

    if (self.parentId == null) return null;
    const connSiblings = db.childrenOf(self.parentId).filter((c) => c.ruleName === "ConnectionUsage");
    const adj = new Map<string, string[]>();
    for (const conn of connSiblings) {
      const cRefs = db.childrenOf(conn.id).filter((c) => c.kind === "Reference");
      if (cRefs.length >= 2) {
        const u = getAllocationEndpointName(db, cRefs[0]!);
        const v = getAllocationEndpointName(db, cRefs[1]!);
        if (u && v) {
          let list = adj.get(u);
          if (!list) {
            list = [];
            adj.set(u, list);
          }
          list.push(v);
        }
      }
    }

    const visited = new Set<string>();
    const queue: string[] = [targetName];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr === sourceName) {
        return error(SysML2ErrorCode.CIRCULAR_PORT_DELEGATION.message(sourceName), {
          code: SysML2ErrorCode.CIRCULAR_PORT_DELEGATION.code,
          field: "declaredName",
          startOffset: self.startOffset,
          endOffset: self.endOffset,
        });
      }
      if (visited.has(curr)) continue;
      visited.add(curr);
      for (const next of adj.get(curr) || []) {
        queue.push(next);
      }
    }
    return null;
  },
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

/** Lint rules for BindingConnectorAsUsage */
export const bindingConnectorLints = {
  ...connectionLints,
  bindingConnectorTypeMismatch: (db: QueryDB, self: SymbolEntry) => checkBindingConnectorTypeMismatch(db, self),
};

/** Helper to check incompatible flow dimensions on FlowUsage and SuccessionFlowUsage (Code S4019). */
export const checkFlowDimensionalCompatibility = (db: QueryDB, self: SymbolEntry): LintResult | null => {
  const refs = db.childrenOf(self.id).filter((c) => c.kind === "Reference");
  let sourceName = "";
  let targetName = "";
  if (refs.length >= 2) {
    sourceName = getAllocationEndpointName(db, refs[refs.length - 2]!);
    targetName = getAllocationEndpointName(db, refs[refs.length - 1]!);
  }
  const text = db.cstText(self.startOffset, self.endOffset, self) || "";
  if (!sourceName || !targetName) {
    const leaves = collectCstLeaves(parseSysmlSource(text));
    const fromIdx = leaves.findIndex((l) => l.text === "from");
    if (fromIdx !== -1) {
      const src = readDottedChainFromLeaves(leaves, fromIdx + 1);
      if (src && leaves[src.nextIdx]?.text === "to") {
        const tgt = readDottedChainFromLeaves(leaves, src.nextIdx + 1);
        if (tgt) {
          sourceName = src.text;
          targetName = tgt.text;
        }
      }
    }
    if (!sourceName || !targetName) {
      const flowIdx = leaves.findIndex((l) => l.text === "flow");
      if (flowIdx !== -1) {
        let src = readDottedChainFromLeaves(leaves, flowIdx + 1);
        if (src && leaves[src.nextIdx]?.text !== "to") {
          src = readDottedChainFromLeaves(leaves, src.nextIdx);
        }
        if (src && leaves[src.nextIdx]?.text === "to") {
          const tgt = readDottedChainFromLeaves(leaves, src.nextIdx + 1);
          if (tgt) {
            sourceName = src.text;
            targetName = tgt.text;
          }
        }
      }
    }
  }
  if (!sourceName || !targetName) return null;

  const resolveEndpointDimension = (endpointName: string) => {
    const entry = resolveFeatureInScope(db, self.parentId, endpointName);
    if (!entry) return null;
    const typeSym = resolveTypeOf(db, entry);
    if (typeSym) {
      const dim = resolveTypeDimension(db, typeSym);
      if (dim && !isDimensionless(dim)) return dim;
      for (const member of db.childrenOf(typeSym.id)) {
        if (member.kind === "Usage") {
          const memberTypeChild = db.childrenOf(member.id).find((c) => c.ruleName === "OwnedFeatureTyping");
          const memberDim =
            (memberTypeChild?.name ? resolveTypeDimension(db, memberTypeChild.name) : null) ??
            (resolveTypeOf(db, member) ? resolveTypeDimension(db, resolveTypeOf(db, member)!) : null);
          if (memberDim && !isDimensionless(memberDim)) return memberDim;
        }
      }
    }
    const typeChild = db.childrenOf(entry.id).find((c) => c.ruleName === "OwnedFeatureTyping");
    if (typeChild?.name) {
      const dim = resolveTypeDimension(db, typeChild.name);
      if (dim && !isDimensionless(dim)) return dim;
    }
    if (entry.metadata?.["typeSpecifier"]) {
      const dim = resolveTypeDimension(db, String(entry.metadata["typeSpecifier"]));
      if (dim && !isDimensionless(dim)) return dim;
    }
    return null;
  };

  const sourceDim = resolveEndpointDimension(sourceName);
  const targetDim = resolveEndpointDimension(targetName);
  if (
    sourceDim &&
    targetDim &&
    !isDimensionless(sourceDim) &&
    !isDimensionless(targetDim) &&
    !areDimensionsEqual(sourceDim, targetDim)
  ) {
    return error(SysML2ErrorCode.INCOMPATIBLE_FLOW_DIMENSIONS.message(sourceName, targetName), {
      code: SysML2ErrorCode.INCOMPATIBLE_FLOW_DIMENSIONS.code,
      startOffset: self.startOffset,
      endOffset: self.endOffset,
    });
  }
  return null;
};

/** Lint rules for FlowUsage and SuccessionFlowUsage */
export const flowLints = {
  ...usageLints,
  incompatibleFlowDimensions: (db: QueryDB, self: SymbolEntry) => checkFlowDimensionalCompatibility(db, self),
};

/** Helper to check that a calculation with a non-empty body has a return parameter or result expression (Code S4012). */
export const checkCalculationReturn = (db: QueryDB, self: SymbolEntry): LintResult | null => {
  if (metaStr(self, "isAbstract") === "true") return null;
  const text = db.cstText(self.startOffset, self.endOffset, self) || "";
  const openBrace = text.indexOf("{");
  const closeBrace = text.lastIndexOf("}");
  if (openBrace === -1 || closeBrace <= openBrace) return null;
  const bodyText = text.slice(openBrace + 1, closeBrace).trim();
  if (!bodyText) return null;

  const bodyLeaves = collectCstLeaves(parseSysmlSource(bodyText));

  // Check for explicit `return` keyword or `out` parameter
  if (bodyLeaves.some((l) => l.text === "return")) return null;
  const children = db.childrenOf(self.id);
  if (children.some((c) => metaStr(c, "direction") === "out" || c.name === "return")) return null;

  // Check CST for ResultExpressionMember
  const cst = db.cstNode(self.id) as CSTNode | null;
  if (cst) {
    const hasResultMember = (node: CSTNode): boolean => {
      if (node.type === "ResultExpressionMember") return true;
      return (node.children || []).some(hasResultMember);
    };
    if (hasResultMember(cst)) return null;
  } else {
    // Fallback when CST node is unavailable: WASM lexer drops comments, so check non-comment leaves end without ';'
    if (bodyLeaves.length > 0 && bodyLeaves[bodyLeaves.length - 1]!.text !== ";") return null;
  }

  return warning(SysML2ErrorCode.CALC_RETURN_MISSING.message(self.name || "<anonymous>"), {
    code: SysML2ErrorCode.CALC_RETURN_MISSING.code,
    field: "declaredName",
    startOffset: self.fieldRanges?.["declaredName"]?.startOffset ?? self.startOffset,
    endOffset: self.fieldRanges?.["declaredName"]?.endOffset ?? self.endOffset,
  });
};

export const calculationDefinitionLints = {
  ...definitionLints,
  calcReturnMissing: (db: QueryDB, self: SymbolEntry) => checkCalculationReturn(db, self),
};

export const calculationUsageLints = {
  ...usageLints,
  calcReturnMissing: (db: QueryDB, self: SymbolEntry) => checkCalculationReturn(db, self),
};

/** Helper to validate exposed/filtered target elements in ViewDefinition and ViewUsage (Code S4013). */
export const checkViewExposeTargets = (db: QueryDB, self: SymbolEntry): LintResult | null => {
  const candidates: string[] = [];
  for (const child of db.childrenOf(self.id)) {
    if (child.ruleName === "ElementFilterMember" && child.name && child.name !== "<anonymous>") {
      candidates.push(child.name.trim());
    } else if ((child.name === "expose" || child.name === "exposed") && child.kind === "Usage") {
      for (const sub of db.childrenOf(child.id)) {
        if (sub.name && sub.name !== "<anonymous>") candidates.push(sub.name.trim());
      }
    }
  }

  const text = db.cstText(self.startOffset, self.endOffset, self) || "";
  const openBrace = text.indexOf("{");
  const closeBrace = text.lastIndexOf("}");
  if (openBrace !== -1 && closeBrace > openBrace) {
    const body = text.slice(openBrace + 1, closeBrace);
    const bodyLeaves = collectCstLeaves(parseSysmlSource(body));
    for (let i = 0; i < bodyLeaves.length; i++) {
      const kw = bodyLeaves[i]!.text;
      if (kw === "expose") {
        let k = i + 1;
        if (bodyLeaves[k]?.text === "all") k++;
        const mod = bodyLeaves[k]?.text;
        if (mod === ":>" || mod === "::>" || mod === ":" || mod === "=") k++;
        const chain = readDottedChainFromLeaves(bodyLeaves, k);
        if (chain) {
          let target = chain.text;
          if (bodyLeaves[chain.nextIdx]?.text === "::") {
            const wild = bodyLeaves[chain.nextIdx + 1]?.text;
            if (wild === "*" || wild === "**") target += `::${wild}`;
          }
          candidates.push(target);
        }
      } else if (kw === "filter") {
        let k = i + 1;
        if (bodyLeaves[k]?.text === "@") k++;
        const chain = readDottedChainFromLeaves(bodyLeaves, k);
        if (chain && bodyLeaves[chain.nextIdx]?.text === ";") {
          const tok = chain.text;
          if (tok !== "true" && tok !== "false" && tok !== "null") {
            candidates.push(tok);
          }
        }
      }
    }
  }

  const isDecl = (s: SymbolEntry | null | undefined): s is SymbolEntry =>
    Boolean(s && s.kind !== "Reference" && s.kind !== "Specialization" && s.kind !== "Import");
  const ignored = new Set(["true", "false", "null", "all", "Real", "Integer", "Boolean", "String", "Natural"]);
  for (const rawTarget of candidates) {
    const cleanTarget = stripNamespaceWildcard(rawTarget).trim();
    if (!cleanTarget || ignored.has(cleanTarget)) continue;
    const scopeRes = resolveFeatureInScope(db, self.parentId, cleanTarget);
    const resolved = (isDecl(scopeRes) ? scopeRes : null) ?? db.byName(cleanTarget)?.find(isDecl) ?? null;
    if (!resolved) {
      return error(SysML2ErrorCode.EXPOSE_TARGET_INVALID.message(rawTarget, self.name || "<anonymous>"), {
        code: SysML2ErrorCode.EXPOSE_TARGET_INVALID.code,
        field: "declaredName",
        startOffset: self.startOffset,
        endOffset: self.endOffset,
      });
    }
  }
  return null;
};

export const viewDefinitionLints = {
  ...definitionLints,
  exposeTargetInvalid: (db: QueryDB, self: SymbolEntry) => checkViewExposeTargets(db, self),
};

export const viewUsageLints = {
  ...usageLints,
  exposeTargetInvalid: (db: QueryDB, self: SymbolEntry) => checkViewExposeTargets(db, self),
};

/** Lint rules for VerifyRequirementUsage */
export const verifyRequirementLints = {
  verifyTargetNotRequirement: (db: QueryDB, self: SymbolEntry) => {
    const targetName = getRelationshipTargetName(db, self);
    if (!targetName || targetName === self.ruleName) return null;
    const targets = db.byName(targetName);
    const reqTarget = targets.find((t) => t.ruleName === "RequirementDefinition" || t.ruleName === "RequirementUsage");
    if (targets.length > 0 && !reqTarget) {
      const ref = db.childrenOf(self.id).find((c) => c.kind === "Reference" || c.kind === "Specialization");
      return error(SysML2ErrorCode.VERIFY_TARGET_NOT_A_REQUIREMENT.message(targetName), {
        code: SysML2ErrorCode.VERIFY_TARGET_NOT_A_REQUIREMENT.code,
        ...(ref ? { startOffset: ref.startOffset, endOffset: ref.endOffset } : { field: "declaredName" }),
      });
    }
    return null;
  },
};

/** Lint rules for ActionDefinition and ActionUsage: Activity CFA, Definite Assignment, Soundness, Decision Tables & BMC */
export const actionCommonLints = {
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
    const actionLeaves = collectCstLeaves(parseSysmlSource(text));
    const hasInvocationSyntax = actionLeaves.some(
      (l, idx) => l.text === "perform" || (l.text === ":" && isSysmlIdentLeaf(actionLeaves[idx + 1]?.text)),
    );
    if (hasInvocationSyntax) {
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
    const leaves = collectCstLeaves(parseSysmlSource(text));
    const whileIdx = leaves.findIndex((l) => l.text === "while");
    if (whileIdx !== -1) {
      const openIdx = leaves.findIndex((l, idx) => idx > whileIdx && l.text === "{");
      if (openIdx > whileIdx + 1) {
        const cond =
          leaves[whileIdx + 1]!.text === "(" && leaves[openIdx - 1]!.text === ")"
            ? sliceBetweenLeaves(text, leaves[whileIdx + 1]!, leaves[openIdx - 1]!)
            : sliceBetweenLeaves(text, leaves[whileIdx]!, leaves[openIdx]!);
        const closeIdx = findMatchingBraceLeaf(leaves, openIdx);
        const body =
          leaves[closeIdx]?.text === "}"
            ? sliceBetweenLeaves(text, leaves[openIdx]!, leaves[closeIdx]!)
            : text.slice(leaves[openIdx]!.end);
        const loopRes = LoopInvariantAnalyzer.analyzeLoop({ condition: cond, body });
        if (!loopRes.isTerminating && loopRes.diagnostics.length > 0) {
          const firstErr = loopRes.diagnostics[0]!;
          return warning(firstErr.message, {
            code: SysML2ErrorCode.LOOP_NON_TERMINATING.code,
            startOffset: self.startOffset + leaves[whileIdx]!.start,
            endOffset: self.endOffset,
          });
        }
      }
    }
    return null;
  },
  decisionTableExhaustiveness: (db: QueryDB, self: SymbolEntry) => {
    const hasDecisions = db.childrenOf(self.id).some((c) => c.ruleName === "DecisionNode");
    const text = db.cstText(self.startOffset, self.endOffset, self) || "";
    const hasDecideToken = text ? collectCstLeaves(parseSysmlSource(text)).some((l) => l.text === "decide") : false;
    if (!hasDecisions && !hasDecideToken) return null;

    let dtMap = DecisionTableVerifier.verifyAllDecisionsInDb(db, self);
    if (dtMap.size === 0 && hasDecideToken) {
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

export const actionDefinitionLints = {
  ...definitionLints,
  ...actionCommonLints,
};

export const actionUsageLints = {
  ...usageLints,
  ...actionCommonLints,
};

// ---------------------------------------------------------------------------
// RequirementUsage — promoted model and queries
// ---------------------------------------------------------------------------

/** Model config for RequirementUsage (promoted from generic UsageNode) */
export const requirementStructuralLints = {
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
  unsatisfiedCriticalRequirement: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name || metaStr(self, "isAbstract") === "true") return null;
    const text = db.cstText(self.startOffset, self.endOffset, self) || "";
    if (!hasCriticalRequirementMarker(self.name, text)) return null;

    const hasSatisfy =
      findRelationshipsTargeting(db, self, self.name, ["SatisfyRequirementUsage"]).length > 0 ||
      db.childrenOf(self.id).some((c) => c.ruleName === "SatisfyRequirementUsage");
    const hasVerify =
      findRelationshipsTargeting(db, self, self.name, ["VerifyRequirementUsage"]).length > 0 ||
      db.childrenOf(self.id).some((c) => c.ruleName === "VerifyRequirementUsage");
    if (!hasSatisfy && !hasVerify) {
      return warning(SysML2ErrorCode.UNSATISFIED_CRITICAL_REQUIREMENT.message(self.name), {
        code: SysML2ErrorCode.UNSATISFIED_CRITICAL_REQUIREMENT.code,
        field: "declaredName",
        startOffset: self.startOffset,
        endOffset: self.endOffset,
      });
    }
    return null;
  },
};

// Re-compose requirement lints with structural checks
export const requirementDefinitionLintsEnhanced = {
  ...definitionLints,
  ...requirementLints,
  ...requirementStructuralLints,
};

export const requirementUsageLintsEnhanced = {
  ...usageLints,
  ...requirementLints,
  ...requirementStructuralLints,
};

import { TableauReasoner } from "@modelscript/runtime";
import { verifyAllInterfaceContracts } from "./contract-verifier.js";
import { checkRequirementConsistency } from "./smt-bridge.js";
import { parseGuardConstraints, verifyAllStateMachineTransitions } from "./state-machine-verifier.js";

// ---------------------------------------------------------------------------
// Package-level traceability queries
// ---------------------------------------------------------------------------

/** Walk all descendants to find requirement/verification symbols */
export const packageTraceabilityLints = {
  packageNaming: (_db: QueryDB, self: SymbolEntry) => {
    if (self.name && startsWithLowerAscii(self.name)) {
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
export const importLints = {
  unresolvedImport: (db: QueryDB, self: SymbolEntry) => checkImportResolution(db, self),
};

/** Lint rules for EnumeratedValue declarations */
export const enumValueLints = {
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

/** Helper to parse transition source, trigger, guard, and target from a TransitionUsage symbol. */
export const parseTransitionComponents = (
  db: QueryDB,
  trans: SymbolEntry,
): { source: string; trigger: string; guard: string; target: string } => {
  const text = db.cstText(trans.startOffset, trans.endOffset, trans) || "";
  const leaves = collectCstLeaves(parseSysmlSource(text));

  let source = "";
  let trigger = "";
  let guard = "";
  let target = "";

  for (let i = 0; i < leaves.length; i++) {
    const tok = leaves[i]!.text;
    if (tok === "first" && !source && isSysmlIdentLeaf(leaves[i + 1]?.text)) {
      source = leaves[i + 1]!.text;
    } else if (tok === "accept" && !trigger) {
      for (let j = i + 1; j < leaves.length; j++) {
        const endTok = leaves[j]!.text;
        if (endTok === "if" || endTok === "do" || endTok === "then") {
          trigger = sliceBetweenLeaves(text, leaves[i]!, leaves[j]!);
          break;
        }
      }
    } else if (tok === "if" && !guard) {
      for (let j = i + 1; j < leaves.length; j++) {
        const endTok = leaves[j]!.text;
        if (endTok === "do" || endTok === "then") {
          guard = sliceBetweenLeaves(text, leaves[i]!, leaves[j]!);
          break;
        }
      }
    } else if (tok === "then" && !target && isSysmlIdentLeaf(leaves[i + 1]?.text)) {
      target = leaves[i + 1]!.text;
    }
  }

  return { source, trigger, guard, target };
};

/** Helper to check if a guard expression is tautologically false (Code S5017). */
export const isGuardTautologicallyFalse = (db: QueryDB, self: SymbolEntry, guardText: string): boolean => {
  const trimmed = guardText.trim();
  if (!trimmed) return false;
  if (trimmed === "false" || trimmed === "not true" || trimmed === "!true") return true;

  // Check CST evaluation first
  const cst = db.cstNode(self.id) as CSTNode | null;
  if (cst) {
    const guardNode = cst.childForFieldName?.("guard") ?? cst.children?.find((c) => c.type === "OwnedExpression");
    if (guardNode) {
      const evalRes = evaluateExpressionNode(db, guardNode, self.parentId);
      if (evalRes === false) return true;
    }
  }

  const leaves = collectCstLeaves(parseSysmlSource(trimmed));

  // Check simple literal relational / equality expressions (e.g. 0 > 1, 1 == 2)
  const lhsLit = parseSignedNumberFromLeaves(leaves, 0);
  if (lhsLit) {
    const op = leaves[lhsLit.nextIdx]?.text;
    if (op === "==" || op === "!=" || op === "<=" || op === ">=" || op === "<" || op === ">") {
      const rhsLit = parseSignedNumberFromLeaves(leaves, lhsLit.nextIdx + 1);
      if (rhsLit && rhsLit.nextIdx === leaves.length) {
        const a = lhsLit.value;
        const b = rhsLit.value;
        if (op === "==" && !(a === b)) return true;
        if (op === "!=" && !(a !== b)) return true;
        if (op === "<" && !(a < b)) return true;
        if (op === ">" && !(a > b)) return true;
        if (op === "<=" && !(a <= b)) return true;
        if (op === ">=" && !(a >= b)) return true;
      }
    }
  }

  // Check self-contradictory variable comparison (x < x, x > x, x != x)
  const lhsVar = readDottedChainFromLeaves(leaves, 0);
  if (lhsVar) {
    const op = leaves[lhsVar.nextIdx]?.text;
    if (op === "<" || op === ">" || op === "!=") {
      const rhsVar = readDottedChainFromLeaves(leaves, lhsVar.nextIdx + 1);
      if (rhsVar && rhsVar.nextIdx === leaves.length && rhsVar.text === lhsVar.text) {
        return true;
      }
    }
  }

  // Check conjunctive numeric bounds (e.g., x > 10 and x < 5)
  const hasDisjunction = leaves.some((l) => {
    const low = l.text.toLowerCase();
    return low === "or" || low === "xor" || low === "implies" || low === "||";
  });
  if (!hasDisjunction) {
    const constraints = parseGuardConstraints(trimmed);
    if (constraints.length >= 2) {
      const byVar = new Map<string, typeof constraints>();
      for (const c of constraints) {
        let arr = byVar.get(c.variable);
        if (!arr) {
          arr = [];
          byVar.set(c.variable, arr);
        }
        arr.push(c);
      }
      for (const [, vConstraints] of byVar) {
        let lower = -Infinity;
        let lowerStrict = false;
        let upper = Infinity;
        let upperStrict = false;
        const notEquals = new Set<number>();
        for (const c of vConstraints) {
          if (c.operator === ">") {
            if (c.value > lower || (c.value === lower && !lowerStrict)) {
              lower = c.value;
              lowerStrict = true;
            }
          } else if (c.operator === ">=") {
            if (c.value > lower) {
              lower = c.value;
              lowerStrict = false;
            }
          } else if (c.operator === "<") {
            if (c.value < upper || (c.value === upper && !upperStrict)) {
              upper = c.value;
              upperStrict = true;
            }
          } else if (c.operator === "<=") {
            if (c.value < upper) {
              upper = c.value;
              upperStrict = false;
            }
          } else if (c.operator === "==") {
            if (c.value > lower) {
              lower = c.value;
              lowerStrict = false;
            }
            if (c.value < upper) {
              upper = c.value;
              upperStrict = false;
            }
          } else if (c.operator === "!=") {
            notEquals.add(c.value);
          }
        }
        if (lower > upper) return true;
        if (lower === upper && (lowerStrict || upperStrict || notEquals.has(lower))) return true;
      }
    }
  }

  return false;
};

/** Lint rules for StateDefinition and StateUsage */
export const stateMachineCommonLints = {
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
  nonDeterministicTransitions: (db: QueryDB, self: SymbolEntry) => {
    // Case 1: StateDefinition or composite StateUsage containing TransitionUsage children
    const childTransitions = db.childrenOf(self.id).filter((c) => c.ruleName === "TransitionUsage");
    if (childTransitions.length >= 2) {
      const smResult = verifyAllStateMachineTransitions(db, self.name);
      const nonDetDiag = smResult.diagnostics.find((d) => d.type === "nondeterminism");
      if (nonDetDiag) {
        return warning(SysML2ErrorCode.NON_DETERMINISTIC_TRANSITIONS.message(nonDetDiag.stateName || self.name), {
          code: SysML2ErrorCode.NON_DETERMINISTIC_TRANSITIONS.code,
          field: "declaredName",
          startOffset: self.startOffset,
          endOffset: self.endOffset,
        });
      }
      // Also check for multiple unguarded or identical-guard transitions from the same source state and trigger
      const bySourceAndTrigger = new Map<string, string[]>();
      for (const tr of childTransitions) {
        const comp = parseTransitionComponents(db, tr);
        if (!comp.source) continue;
        const key = `${comp.source}::${comp.trigger}`;
        let guards = bySourceAndTrigger.get(key);
        if (!guards) {
          guards = [];
          bySourceAndTrigger.set(key, guards);
        }
        guards.push(comp.guard);
      }
      for (const [key, guards] of bySourceAndTrigger) {
        if (guards.length >= 2) {
          const srcState = key.split("::")[0]!;
          const unguardedCount = guards.filter((g) => !g || g === "true").length;
          const uniqueGuards = new Set(guards.filter(Boolean));
          if (unguardedCount >= 2 || uniqueGuards.size < guards.filter(Boolean).length) {
            return warning(SysML2ErrorCode.NON_DETERMINISTIC_TRANSITIONS.message(srcState), {
              code: SysML2ErrorCode.NON_DETERMINISTIC_TRANSITIONS.code,
              field: "declaredName",
              startOffset: self.startOffset,
              endOffset: self.endOffset,
            });
          }
        }
      }
    }

    // Case 2: Leaf StateUsage inside an enclosing state machine with overlapping outgoing transitions
    if (self.parentId != null && self.name && childTransitions.length === 0) {
      const siblingTransitions = db
        .childrenOf(self.parentId)
        .filter((c) => c.ruleName === "TransitionUsage")
        .map((tr) => parseTransitionComponents(db, tr))
        .filter((comp) => comp.source === self.name);
      if (siblingTransitions.length >= 2) {
        const parentSym = db.symbol(self.parentId);
        const smResult = verifyAllStateMachineTransitions(db, parentSym?.name);
        if (smResult.diagnostics.some((d) => d.type === "nondeterminism" && d.stateName === self.name)) {
          return warning(SysML2ErrorCode.NON_DETERMINISTIC_TRANSITIONS.message(self.name), {
            code: SysML2ErrorCode.NON_DETERMINISTIC_TRANSITIONS.code,
            field: "declaredName",
            startOffset: self.startOffset,
            endOffset: self.endOffset,
          });
        }
        const byTrigger = new Map<string, string[]>();
        for (const comp of siblingTransitions) {
          let guards = byTrigger.get(comp.trigger);
          if (!guards) {
            guards = [];
            byTrigger.set(comp.trigger, guards);
          }
          guards.push(comp.guard);
        }
        for (const [, guards] of byTrigger) {
          if (guards.length >= 2) {
            const unguardedCount = guards.filter((g) => !g || g === "true").length;
            const uniqueGuards = new Set(guards.filter(Boolean));
            if (unguardedCount >= 2 || uniqueGuards.size < guards.filter(Boolean).length) {
              return warning(SysML2ErrorCode.NON_DETERMINISTIC_TRANSITIONS.message(self.name), {
                code: SysML2ErrorCode.NON_DETERMINISTIC_TRANSITIONS.code,
                field: "declaredName",
                startOffset: self.startOffset,
                endOffset: self.endOffset,
              });
            }
          }
        }
      }
    }

    return null;
  },
};

export const stateDefinitionLints = {
  ...definitionLints,
  ...stateMachineCommonLints,
};

export const stateUsageLints = {
  ...usageLints,
  ...stateMachineCommonLints,
};

/** Lint rules for TransitionUsage */
export const transitionUsageLints = {
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

    const comp = parseTransitionComponents(db, self);
    for (const stateName of [comp.source, comp.target]) {
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
  deadStateTransition: (db: QueryDB, self: SymbolEntry) => {
    const comp = parseTransitionComponents(db, self);
    if (!comp.guard) return null;
    if (isGuardTautologicallyFalse(db, self, comp.guard)) {
      const transName =
        self.name && self.name !== "<anonymous>" && self.name !== "TransitionUsage" ? self.name : "transition";
      return warning(SysML2ErrorCode.DEAD_STATE_TRANSITION.message(transName), {
        code: SysML2ErrorCode.DEAD_STATE_TRANSITION.code,
        field: "declaredName",
        startOffset: self.startOffset,
        endOffset: self.endOffset,
      });
    }
    return null;
  },
  stateTransitionUnreachable: (db: QueryDB, self: SymbolEntry) => {
    if (self.parentId == null) return null;
    const children = db.childrenOf(self.parentId);
    const stateSiblings = children.filter(
      (c) => c.ruleName === "StateUsage" || c.ruleName === "ExhibitStateUsage" || c.ruleName === "StateDefinition",
    );
    const transSiblings = children.filter((c) => c.ruleName === "TransitionUsage");
    if (stateSiblings.length < 2 || transSiblings.length === 0) return null;

    const validStateNames = new Set(stateSiblings.map((s) => s.name).filter(Boolean));
    const myComp = parseTransitionComponents(db, self);
    if (!myComp.source || !validStateNames.has(myComp.source)) return null;

    // Determine initial state(s): explicit `entry; then <state>;` in parent, or the first declared state
    const parentSym = db.symbol(self.parentId);
    const parentText = parentSym ? db.cstText(parentSym.startOffset, parentSym.endOffset, parentSym) || "" : "";
    const parentLeaves = parentText ? collectCstLeaves(parseSysmlSource(parentText)) : [];
    let entryTarget: string | undefined;
    for (let i = 0; i < parentLeaves.length; i++) {
      if (parentLeaves[i]!.text !== "entry") continue;
      let k = i + 1;
      if (parentLeaves[k]?.text === ";") k++;
      if (parentLeaves[k]?.text === "then" && isSysmlIdentLeaf(parentLeaves[k + 1]?.text)) {
        entryTarget = parentLeaves[k + 1]!.text;
        break;
      }
    }
    const initialStates = new Set<string>();
    if (entryTarget && validStateNames.has(entryTarget)) {
      initialStates.add(entryTarget);
    } else if (stateSiblings[0]?.name) {
      initialStates.add(stateSiblings[0].name);
    }

    // Build reachability graph over non-dead transitions
    const adj = new Map<string, string[]>();
    for (const tr of transSiblings) {
      const c = parseTransitionComponents(db, tr);
      if (!c.source || !c.target) continue;
      if (c.guard && isGuardTautologicallyFalse(db, tr, c.guard)) continue;
      let list = adj.get(c.source);
      if (!list) {
        list = [];
        adj.set(c.source, list);
      }
      list.push(c.target);
    }

    const reachable = new Set<string>(initialStates);
    const queue = Array.from(initialStates);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const next of adj.get(curr) || []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }

    if (!reachable.has(myComp.source)) {
      const transName =
        self.name && self.name !== "<anonymous>" && self.name !== "TransitionUsage" ? self.name : "transition";
      return warning(SysML2ErrorCode.STATE_TRANSITION_UNREACHABLE.message(transName, myComp.source), {
        code: SysML2ErrorCode.STATE_TRANSITION_UNREACHABLE.code,
        field: "declaredName",
        startOffset: self.startOffset,
        endOffset: self.endOffset,
      });
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
