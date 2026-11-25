// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LintRangeOptions, LintResult } from "@modelscript/dsl";
import { type QueryDB, type SymbolEntry } from "@modelscript/runtime";
import { getCstChildren, stripLeadingTilde, stripNamespaceWildcard, type SysmlCstNode } from "../cst-utils.js";
import { createSysML2Diagnostic, SysML2ErrorCode } from "../errors.js";
import { metaStr } from "../queries.js";
import { isStdlibOrBuiltinSymbol, isTypeAssignable } from "../type-checker.js";
import {
  cstHasError,
  emitDiag,
  extractSpecializationClauses,
  getFeatureDeclaredTypeRaw,
  getHeaderLeavesBeforeBody,
  getSymbolCst,
  getSymbolLeavesFast,
  hasExternalOrStdlibBaseInHierarchy,
  hasFeatureValueInfo,
  hasHeaderKeyword,
  isSysmlLanguageSymbol,
  isTruthyMeta,
  narrowDiagnosticRange,
  parseExplicitMultiplicity,
  resolveSpecializationTarget,
  resolveTypeOrClassifierByName,
} from "./shared.js";
/**
 * Validates S2007 (`unresolved-redefinition-or-subsetting`), S3012 (`redefinition-type-not-conforming`),
 * S3013 (`subsetting-multiplicity-widening`), and S3014 (`redefinition-modifier-conformance`).
 */
export function checkSpecializationResolutionAndConformance(
  db: QueryDB,
  self: SymbolEntry,
): LintResult | LintResult[] | null {
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;
  if (self.ruleName === "MetadataUsage" || self.ruleName === "PrefixMetadataUsage") return null;

  const parentSym = self.parentId !== null ? db.symbol(self.parentId) : undefined;
  const clauses = extractSpecializationClauses(db, self);
  if (clauses.length === 0) return null;

  const skipUnresolvedForExternalBase =
    clauses[0]!.ruleName !== "AliasMember" && hasExternalOrStdlibBaseInHierarchy(db, parentSym);

  const diagnostics: LintResult[] = [];
  const selfTypeInfo = getFeatureDeclaredTypeRaw(db, self);
  const selfMult = self.kind === "Usage" ? parseExplicitMultiplicity(db, self) : null;
  const selfIsEnd = isTruthyMeta(self, "isEnd") || hasHeaderKeyword(db, self, "end");
  const selfIsConstant = isTruthyMeta(self, "isConstant") || hasHeaderKeyword(db, self, "constant");
  const selfIsNonunique = isTruthyMeta(self, "isNonunique") || hasHeaderKeyword(db, self, "nonunique");
  const selfDir = metaStr(self, "direction");
  const selfValInfo = self.kind === "Usage" ? hasFeatureValueInfo(db, self) : null;
  const selfDisplayName = self.name && self.name !== "<anonymous>" ? self.name : clauses[0]!.targetPath;

  for (const clause of clauses) {
    const cleanTarget = stripNamespaceWildcard(stripLeadingTilde(clause.targetPath));
    if (!cleanTarget || isStdlibOrBuiltinSymbol(cleanTarget)) continue;

    const baseFeat = resolveSpecializationTarget(db, self, cleanTarget, clause.ruleName);
    if (!baseFeat) {
      if (!skipUnresolvedForExternalBase) {
        diagnostics.push(
          createSysML2Diagnostic(
            SysML2ErrorCode.UNRESOLVED_REDEFINITION_OR_SUBSETTING,
            [clause.kindLabel, clause.targetPath],
            clause.range,
          ),
        );
      }
      continue;
    }

    if (clause.ruleName === "AliasMember" || !isSysmlLanguageSymbol(baseFeat)) {
      continue;
    }

    // S3012: REDEFINITION_TYPE_NOT_CONFORMING
    if (
      selfTypeInfo &&
      (clause.ruleName === "OwnedRedefinition" ||
        clause.ruleName === "OwnedSubsetting" ||
        clause.ruleName === "OwnedReferenceSubsetting")
    ) {
      const baseTypeInfo = getFeatureDeclaredTypeRaw(db, baseFeat);
      if (baseTypeInfo) {
        const subType = selfTypeInfo.raw;
        const baseType = baseTypeInfo.raw;
        const subTypeKnown =
          isStdlibOrBuiltinSymbol(subType) || Boolean(resolveTypeOrClassifierByName(db, self.parentId, subType));
        const baseTypeKnown =
          isStdlibOrBuiltinSymbol(baseType) || Boolean(resolveTypeOrClassifierByName(db, baseFeat.parentId, baseType));
        if (subTypeKnown && baseTypeKnown && !isTypeAssignable(db, subType, baseType)) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.REDEFINITION_TYPE_NOT_CONFORMING,
              [selfDisplayName, subType, baseFeat.name || clause.targetPath, baseType],
              selfTypeInfo.refChild ?? clause.range,
            ),
          );
        }
      }
    }

    // S3013: SUBSETTING_MULTIPLICITY_WIDENING
    if (selfMult && (clause.ruleName === "OwnedRedefinition" || clause.ruleName === "OwnedSubsetting")) {
      const baseMult = parseExplicitMultiplicity(db, baseFeat);
      const baseIsEnd = isTruthyMeta(baseFeat, "isEnd") || hasHeaderKeyword(db, baseFeat, "end");
      if (baseMult && selfIsEnd === baseIsEnd) {
        const upperWidened = selfMult.upper > baseMult.upper;
        const lowerWeakenedOnRedef =
          (clause.ruleName === "OwnedRedefinition" || isTruthyMeta(self, "isRedefine")) &&
          !selfIsEnd &&
          selfMult.lower < baseMult.lower;
        if (upperWidened || lowerWeakenedOnRedef) {
          diagnostics.push(
            createSysML2Diagnostic(
              SysML2ErrorCode.SUBSETTING_MULTIPLICITY_WIDENING,
              [selfDisplayName, selfMult.label, baseFeat.name || clause.targetPath, baseMult.label],
              narrowDiagnosticRange(db, self),
            ),
          );
        }
      }
    }

    // S3014: REDEFINITION_MODIFIER_CONFORMANCE
    if (clause.ruleName === "OwnedRedefinition" || clause.ruleName === "OwnedSubsetting") {
      const baseIsConstant = isTruthyMeta(baseFeat, "isConstant") || hasHeaderKeyword(db, baseFeat, "constant");
      if (baseIsConstant && !selfIsConstant && selfValInfo) {
        const baseValInfo = hasFeatureValueInfo(db, baseFeat);
        const mutableOverride =
          selfValInfo.isInitialMutable || (baseValInfo.hasValue && !baseValInfo.isDefault && selfValInfo.hasValue);
        if (mutableOverride) {
          diagnostics.push(
            createSysML2Diagnostic(
              SysML2ErrorCode.REDEFINITION_MODIFIER_CONFORMANCE,
              [
                selfDisplayName,
                `cannot mutably override or omit 'constant' when specializing constant feature '${baseFeat.name || clause.targetPath}'`,
              ],
              clause.range,
            ),
          );
        }
      }

      const baseIsNonunique = isTruthyMeta(baseFeat, "isNonunique") || hasHeaderKeyword(db, baseFeat, "nonunique");
      if (!baseIsNonunique && selfIsNonunique) {
        diagnostics.push(
          createSysML2Diagnostic(
            SysML2ErrorCode.REDEFINITION_MODIFIER_CONFORMANCE,
            [
              selfDisplayName,
              `cannot relax uniqueness to 'nonunique' when specializing unique feature '${baseFeat.name || clause.targetPath}'`,
            ],
            clause.range,
          ),
        );
      }

      const baseDir = metaStr(baseFeat, "direction");
      if (
        (baseDir === "in" && (selfDir === "out" || selfDir === "inout")) ||
        (baseDir === "out" && (selfDir === "in" || selfDir === "inout"))
      ) {
        diagnostics.push(
          createSysML2Diagnostic(
            SysML2ErrorCode.REDEFINITION_MODIFIER_CONFORMANCE,
            [
              selfDisplayName,
              `conflicting direction '${selfDir}' against '${baseDir}' on '${baseFeat.name || clause.targetPath}'`,
            ],
            clause.range,
          ),
        );
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// Visibility & Import Hygiene (S2009, S2010)
// ---------------------------------------------------------------------------

export function extractDeclaredVisibility(db: QueryDB, entry: SymbolEntry): "public" | "private" | "protected" | null {
  const fromMeta = metaStr(entry, "visibility")?.trim().toLowerCase();
  if (fromMeta === "private" || fromMeta === "protected" || fromMeta === "public") {
    return fromMeta;
  }

  const directCst = db.cstNode(entry.id) as SysmlCstNode | null | undefined;
  if (directCst?.parent) {
    const parentChildren = getCstChildren(directCst.parent);
    for (const sibling of parentChildren) {
      if (sibling === directCst) break;
      if (sibling.type === "VisibilityIndicator") {
        const t = sibling.text.trim();
        if (t === "private" || t === "protected" || t === "public") return t;
      }
    }
  }

  // Fallback: inspect up to 28 characters immediately preceding `entry.startOffset`
  if (entry.startOffset > 0) {
    const lookback = db.cstText(Math.max(0, entry.startOffset - 28), entry.startOffset, entry);
    if (lookback) {
      const trimmed = lookback.trimEnd();
      for (const vis of ["private", "protected", "public"] as const) {
        if (trimmed.endsWith(vis)) {
          const beforeIdx = trimmed.length - vis.length - 1;
          if (beforeIdx < 0) return vis;
          const prevChar = trimmed[beforeIdx]!;
          if (
            prevChar === " " ||
            prevChar === "\t" ||
            prevChar === "\n" ||
            prevChar === "\r" ||
            prevChar === "{" ||
            prevChar === ";" ||
            prevChar === "/"
          ) {
            return vis;
          }
        }
      }
    }
  }

  return null;
}

function collectAncestorIds(db: QueryDB, entry: SymbolEntry): Set<number> {
  const ids = new Set<number>([entry.id]);
  let cur = entry.parentId;
  while (cur !== null && !ids.has(cur)) {
    ids.add(cur);
    cur = db.symbol(cur)?.parentId ?? null;
  }
  return ids;
}

function hasAncestorSpecializingOwner(db: QueryDB, entry: SymbolEntry, owner: SymbolEntry): boolean {
  if (!owner.name) return false;
  let cur: SymbolEntry | undefined = entry;
  const visited = new Set<number>();
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    if (cur.name && isTypeAssignable(db, cur.name, owner.name)) return true;
    cur = cur.parentId !== null ? db.symbol(cur.parentId) : undefined;
  }
  return false;
}

/**
 * Validates S2009 (`visibility-access-violation`) and S2010 (`top-level-import-not-private`).
 */
export function checkVisibilityAndImports(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  const { node: cst, baseOffset } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  // S2010: TOP_LEVEL_IMPORT_NOT_PRIVATE
  if (
    (self.ruleName === "MembershipImport" || self.ruleName === "NamespaceImport" || self.kind === "Import") &&
    self.parentId === null
  ) {
    const vis = extractDeclaredVisibility(db, self);
    if (vis !== "private") {
      const { leaves } = getSymbolLeavesFast(db, self);
      const anchorLeaf = leaves[0];
      const targetName = self.name && self.name !== "<anonymous>" ? self.name : "import";
      return createSysML2Diagnostic(
        SysML2ErrorCode.TOP_LEVEL_IMPORT_NOT_PRIVATE,
        [targetName],
        anchorLeaf
          ? { startOffset: baseOffset + anchorLeaf.start, endOffset: baseOffset + anchorLeaf.end }
          : narrowDiagnosticRange(db, self),
      );
    }
    return null;
  }

  // S2009: VISIBILITY_ACCESS_VIOLATION
  const selfAncestors = collectAncestorIds(db, self);
  const diagnostics: LintResult[] = [];

  const checkTargetAccess = (targetSym: SymbolEntry | null, rangeTarget: SymbolEntry | LintRangeOptions) => {
    if (!targetSym || !isSysmlLanguageSymbol(targetSym) || targetSym.parentId === null) return;
    const vis = extractDeclaredVisibility(db, targetSym);
    if (vis !== "private" && vis !== "protected") return;

    const owner = db.symbol(targetSym.parentId);
    if (!owner) return;
    if (selfAncestors.has(owner.id)) return;
    if (vis === "protected" && hasAncestorSpecializingOwner(db, self, owner)) return;

    const range = "id" in rangeTarget ? narrowDiagnosticRange(db, self, rangeTarget) : rangeTarget;
    diagnostics.push(
      createSysML2Diagnostic(
        SysML2ErrorCode.VISIBILITY_ACCESS_VIOLATION,
        [targetSym.name || "<anonymous>", vis, owner.name || "<namespace>"],
        range,
      ),
    );
  };

  for (const child of db.childrenOf(self.id)) {
    if (
      child.ruleName === "OwnedFeatureTyping" ||
      child.ruleName === "ConjugatedPortTyping" ||
      child.ruleName === "OwnedSubclassification" ||
      child.ruleName === "Subclassification"
    ) {
      const raw = stripLeadingTilde((child.name || db.cstText(child.startOffset, child.endOffset, child) || "").trim());
      if (!raw || isStdlibOrBuiltinSymbol(raw)) continue;
      const resolved = resolveTypeOrClassifierByName(db, self.parentId, raw);
      checkTargetAccess(resolved, child);
    }
  }

  for (const clause of extractSpecializationClauses(db, self)) {
    const clean = stripNamespaceWildcard(stripLeadingTilde(clause.targetPath));
    if (!clean || isStdlibOrBuiltinSymbol(clean)) continue;
    const resolved = resolveSpecializationTarget(db, self, clean, clause.ruleName);
    checkTargetAccess(resolved, clause.range);
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S2011: Inherited Member Shadowing Without `:>>`
// ---------------------------------------------------------------------------

export const NON_SHADOWING_USAGE_RULES = new Set<string>([
  "SatisfyRequirementUsage",
  "VerifyRequirementUsage",
  "IncludeUseCaseUsage",
  "RequirementConstraintUsage",
  "AssertConstraintUsage",
  "TransitionUsage",
  "SuccessionAsUsage",
  "BindingConnectorAsUsage",
  "ConnectionUsage",
  "AllocationUsage",
  "FlowUsage",
  "SuccessionFlowUsage",
  "MetadataUsage",
  "SubjectUsage",
  "ObjectiveRequirementUsage",
  "SendActionNode",
  "AcceptActionNode",
  "AssignActionNode",
]);

export function hasExplicitRedefinition(db: QueryDB, usage: SymbolEntry): boolean {
  if (isTruthyMeta(usage, "isRedefine")) return true;
  if (db.childrenOf(usage.id).some((c) => c.ruleName === "OwnedRedefinition")) return true;
  const { leaves } = getHeaderLeavesBeforeBody(db, usage);
  return leaves.some((l) => l.text === ":>>" || l.text === "redefines" || l.text === "redefine");
}

/**
 * Validates S2011 (`inherited-member-shadowing`) on Definition declarations.
 */
export function checkInheritedMemberShadowing(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  if (self.kind !== "Definition") return null;
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const inheritedByName = new Map<string, { member: SymbolEntry; baseDef: SymbolEntry }>();
  const visitedDefs = new Set<number>([self.id]);
  const queue: SymbolEntry[] = [];

  for (const child of db.childrenOf(self.id)) {
    if ((child.ruleName === "OwnedSubclassification" || child.ruleName === "Subclassification") && child.name) {
      if (isStdlibOrBuiltinSymbol(child.name)) continue;
      const sup = resolveTypeOrClassifierByName(db, self.parentId, child.name);
      if (sup && sup.kind === "Definition" && isSysmlLanguageSymbol(sup)) {
        queue.push(sup);
      }
    }
  }

  if (queue.length === 0) return null;

  while (queue.length > 0) {
    const baseDef = queue.shift()!;
    if (visitedDefs.has(baseDef.id)) continue;
    visitedDefs.add(baseDef.id);

    for (const member of db.childrenOf(baseDef.id)) {
      if (
        member.kind === "Usage" &&
        member.name &&
        member.name !== "<anonymous>" &&
        member.name !== member.ruleName &&
        !NON_SHADOWING_USAGE_RULES.has(member.ruleName)
      ) {
        if (!inheritedByName.has(member.name)) {
          inheritedByName.set(member.name, { member, baseDef });
        }
      }
      if ((member.ruleName === "OwnedSubclassification" || member.ruleName === "Subclassification") && member.name) {
        if (isStdlibOrBuiltinSymbol(member.name)) continue;
        const grandSup = resolveTypeOrClassifierByName(db, baseDef.parentId, member.name);
        if (grandSup && grandSup.kind === "Definition" && isSysmlLanguageSymbol(grandSup)) {
          queue.push(grandSup);
        }
      }
    }
  }

  if (inheritedByName.size === 0) return null;

  const diagnostics: LintResult[] = [];
  for (const child of db.childrenOf(self.id)) {
    if (
      child.kind !== "Usage" ||
      !child.name ||
      child.name === "<anonymous>" ||
      child.name === child.ruleName ||
      NON_SHADOWING_USAGE_RULES.has(child.ruleName)
    ) {
      continue;
    }
    const hit = inheritedByName.get(child.name);
    if (hit && !hasExplicitRedefinition(db, child)) {
      diagnostics.push(
        emitDiag(
          db,
          self,
          SysML2ErrorCode.INHERITED_MEMBER_SHADOWING,
          [child.name, hit.baseDef.name || "<superclassifier>"],
          child,
        ),
      );
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S3010: Polyglot-Aware Usage / Definition Kind Conformance
// ---------------------------------------------------------------------------

const SYSML2_FORBIDDEN_DEFINITIONS_BY_USAGE: Record<string, { expected: string; forbidden: ReadonlySet<string> }> = {
  AttributeUsage: {
    expected: "an AttributeDefinition or EnumerationDefinition",
    forbidden: new Set([
      "PartDefinition",
      "ItemDefinition",
      "ActionDefinition",
      "StateDefinition",
      "PortDefinition",
      "RequirementDefinition",
      "ConnectionDefinition",
      "InterfaceDefinition",
      "AllocationDefinition",
      "UseCaseDefinition",
      "VerificationCaseDefinition",
      "AnalysisCaseDefinition",
      "CaseDefinition",
      "CalculationDefinition",
      "ConstraintDefinition",
      "ViewDefinition",
      "ViewpointDefinition",
      "RenderingDefinition",
      "ConcernDefinition",
    ]),
  },
  PortUsage: {
    expected: "a PortDefinition",
    forbidden: new Set([
      "PartDefinition",
      "ItemDefinition",
      "OccurrenceDefinition",
      "AttributeDefinition",
      "EnumerationDefinition",
      "ActionDefinition",
      "StateDefinition",
      "RequirementDefinition",
      "ConstraintDefinition",
      "CalculationDefinition",
      "ConnectionDefinition",
      "InterfaceDefinition",
      "AllocationDefinition",
      "UseCaseDefinition",
      "VerificationCaseDefinition",
      "AnalysisCaseDefinition",
      "CaseDefinition",
      "ViewDefinition",
      "ViewpointDefinition",
      "RenderingDefinition",
      "ConcernDefinition",
    ]),
  },
  PartUsage: {
    expected: "a PartDefinition or ItemDefinition",
    forbidden: new Set([
      "AttributeDefinition",
      "EnumerationDefinition",
      "ActionDefinition",
      "StateDefinition",
      "RequirementDefinition",
      "ConstraintDefinition",
      "CalculationDefinition",
      "PortDefinition",
      "ViewDefinition",
      "ViewpointDefinition",
      "UseCaseDefinition",
      "VerificationCaseDefinition",
      "AnalysisCaseDefinition",
      "CaseDefinition",
      "ConcernDefinition",
    ]),
  },
  ItemUsage: {
    expected: "an ItemDefinition or PartDefinition",
    forbidden: new Set([
      "AttributeDefinition",
      "EnumerationDefinition",
      "ActionDefinition",
      "StateDefinition",
      "RequirementDefinition",
      "ConstraintDefinition",
      "CalculationDefinition",
      "PortDefinition",
      "ViewDefinition",
      "ViewpointDefinition",
      "UseCaseDefinition",
      "VerificationCaseDefinition",
      "AnalysisCaseDefinition",
      "CaseDefinition",
      "ConcernDefinition",
    ]),
  },
  ActionUsage: {
    expected: "an ActionDefinition",
    forbidden: new Set([
      "PartDefinition",
      "ItemDefinition",
      "AttributeDefinition",
      "EnumerationDefinition",
      "PortDefinition",
      "RequirementDefinition",
      "ConnectionDefinition",
      "InterfaceDefinition",
      "AllocationDefinition",
      "ViewDefinition",
    ]),
  },
  StateUsage: {
    expected: "a StateDefinition",
    forbidden: new Set([
      "PartDefinition",
      "ItemDefinition",
      "AttributeDefinition",
      "EnumerationDefinition",
      "PortDefinition",
      "RequirementDefinition",
      "ConnectionDefinition",
      "InterfaceDefinition",
      "AllocationDefinition",
      "ViewDefinition",
    ]),
  },
  ConstraintUsage: {
    expected: "a ConstraintDefinition",
    forbidden: new Set([
      "PartDefinition",
      "ItemDefinition",
      "ActionDefinition",
      "PortDefinition",
      "AttributeDefinition",
      "EnumerationDefinition",
      "StateDefinition",
      "ConnectionDefinition",
      "InterfaceDefinition",
      "ViewDefinition",
    ]),
  },
  RequirementUsage: {
    expected: "a RequirementDefinition",
    forbidden: new Set([
      "PartDefinition",
      "ItemDefinition",
      "ActionDefinition",
      "PortDefinition",
      "AttributeDefinition",
      "EnumerationDefinition",
      "StateDefinition",
      "CalculationDefinition",
      "ConnectionDefinition",
      "InterfaceDefinition",
      "ViewDefinition",
    ]),
  },
  CalculationUsage: {
    expected: "a CalculationDefinition",
    forbidden: new Set([
      "PartDefinition",
      "ItemDefinition",
      "PortDefinition",
      "RequirementDefinition",
      "AttributeDefinition",
      "EnumerationDefinition",
      "StateDefinition",
      "ConnectionDefinition",
      "InterfaceDefinition",
      "ViewDefinition",
    ]),
  },
};

function checkPolyglotCounterpartMismatch(usageRule: string, targetDef: SymbolEntry): { expected: string } | null {
  const lang = (targetDef.language ?? "").toLowerCase();
  const classKind = String(targetDef.metadata?.["classKind"] ?? "").toLowerCase();
  const ruleLower = targetDef.ruleName.toLowerCase();

  // Whitelist valid cross-language counterparts explicitly
  if (lang.includes("modelica")) {
    if (usageRule === "PortUsage") {
      if (classKind === "model" || classKind === "block" || classKind === "function") {
        return { expected: "a PortDefinition or Modelica connector" };
      }
      return null;
    }
    if (usageRule === "AttributeUsage") {
      if (classKind === "model" || classKind === "connector" || classKind === "block") {
        return { expected: "an AttributeDefinition or Modelica type/record" };
      }
      return null;
    }
    if (usageRule === "PartUsage" || usageRule === "ItemUsage") {
      if (classKind === "connector") {
        return { expected: "a PartDefinition or Modelica model/block/class/record" };
      }
      return null;
    }
    return null;
  }

  if (lang.includes("reqif") || ruleLower.includes("reqif_requirement")) {
    if (usageRule === "PartUsage" || usageRule === "PortUsage" || usageRule === "AttributeUsage") {
      return { expected: `a ${usageRule.replace("Usage", "Definition")} (got ReqIF requirement)` };
    }
    return null;
  }

  // STEP products, URDF links, SCAD modules, SPICE/PSCAD/SSP components are valid polyglot types
  return null;
}

/**
 * Validates S3010 (`usage-definition-kind-mismatch`) with cross-language polyglot whitelisting.
 */
export function checkUsageDefinitionKindMatch(db: QueryDB, self: SymbolEntry): LintResult | null {
  if (self.kind !== "Usage") return null;
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const typeInfo = getFeatureDeclaredTypeRaw(db, self);
  if (!typeInfo || !typeInfo.raw) return null;
  if (isStdlibOrBuiltinSymbol(typeInfo.raw)) return null;

  const targetDef = resolveTypeOrClassifierByName(db, self.parentId ?? self.id, typeInfo.raw);
  if (!targetDef) return null;
  if (
    targetDef.kind === "TypeParameter" ||
    targetDef.kind === "Template" ||
    targetDef.ruleName === "MetadataDefinition"
  ) {
    return null;
  }

  const usageName = self.name && self.name !== "<anonymous>" ? self.name : self.ruleName;

  if (!isSysmlLanguageSymbol(targetDef)) {
    const polyErr = checkPolyglotCounterpartMismatch(self.ruleName, targetDef);
    if (polyErr) {
      return emitDiag(
        db,
        self,
        SysML2ErrorCode.USAGE_DEFINITION_KIND_MISMATCH,
        [usageName, self.ruleName, typeInfo.raw, polyErr.expected],
        typeInfo.refChild ?? null,
      );
    }
    return null;
  }

  if (targetDef.kind !== "Definition" && targetDef.kind !== "Enumeration") {
    return null;
  }

  const spec = SYSML2_FORBIDDEN_DEFINITIONS_BY_USAGE[self.ruleName];
  if (!spec) return null;

  if (spec.forbidden.has(targetDef.ruleName)) {
    return emitDiag(
      db,
      self,
      SysML2ErrorCode.USAGE_DEFINITION_KIND_MISMATCH,
      [usageName, self.ruleName, `${typeInfo.raw} (${targetDef.ruleName})`, spec.expected],
      typeInfo.refChild ?? null,
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// S3011: Disjoint Classifier Specialization
// ---------------------------------------------------------------------------

export type MetaClassifierFamily = "datatype" | "structural" | "port" | "behavioral";

export function getClassifierFamily(ruleName: string): MetaClassifierFamily | null {
  switch (ruleName) {
    case "AttributeDefinition":
    case "EnumerationDefinition":
      return "datatype";
    case "PortDefinition":
      return "port";
    case "PartDefinition":
    case "ItemDefinition":
    case "ConnectionDefinition":
    case "InterfaceDefinition":
    case "AllocationDefinition":
    case "ViewDefinition":
    case "RenderingDefinition":
      return "structural";
    case "ActionDefinition":
    case "StateDefinition":
    case "CalculationDefinition":
    case "ConstraintDefinition":
    case "RequirementDefinition":
    case "ConcernDefinition":
    case "CaseDefinition":
    case "AnalysisCaseDefinition":
    case "VerificationCaseDefinition":
    case "UseCaseDefinition":
    case "ViewpointDefinition":
      return "behavioral";
    default:
      return null;
  }
}

export function areClassifierFamiliesDisjoint(subFam: MetaClassifierFamily, supFam: MetaClassifierFamily): boolean {
  if (subFam === supFam) return false;
  // DataType <-> Structural/Port/Behavioral, Behavioral <-> Structural/Port, Port <-> Part/Item/Connection
  return true;
}

/**
 * Validates S3011 (`disjoint-classifier-specialization`) on Definition symbols.
 */
export function checkDisjointClassifierSpecialization(
  db: QueryDB,
  self: SymbolEntry,
): LintResult | LintResult[] | null {
  if (self.kind !== "Definition" && self.kind !== "Enumeration") return null;
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const subFamily = getClassifierFamily(self.ruleName);
  if (!subFamily) return null;

  const hasDisjointTag = (sym: SymbolEntry): boolean => {
    const { leaves } = getHeaderLeavesBeforeBody(db, sym);
    for (let i = 0; i < leaves.length - 1; i++) {
      if (leaves[i]!.text === "#" && leaves[i + 1]!.text.toLowerCase() === "disjoint") {
        return true;
      }
    }
    return db
      .childrenOf(sym.id)
      .some(
        (c) =>
          (c.ruleName === "MetadataUsage" || c.ruleName === "PrefixMetadataUsage") &&
          (c.name || "").toLowerCase().endsWith("disjoint"),
      );
  };

  const diagnostics: LintResult[] = [];
  const disjointSupers: Array<{ def: SymbolEntry; rel: SymbolEntry }> = [];
  for (const child of db.childrenOf(self.id)) {
    if (child.ruleName !== "OwnedSubclassification" && child.ruleName !== "Subclassification") continue;
    const rawSup = (child.name || db.cstText(child.startOffset, child.endOffset, child) || "").trim();
    if (!rawSup || isStdlibOrBuiltinSymbol(rawSup)) continue;

    const superDef = resolveTypeOrClassifierByName(db, self.parentId, rawSup);
    if (!superDef || !isSysmlLanguageSymbol(superDef)) continue;
    if (superDef.kind !== "Definition" && superDef.kind !== "Enumeration") continue;

    const supFamily = getClassifierFamily(superDef.ruleName);
    if (supFamily && areClassifierFamiliesDisjoint(subFamily, supFamily)) {
      diagnostics.push(
        emitDiag(
          db,
          self,
          SysML2ErrorCode.DISJOINT_CLASSIFIER_SPECIALIZATION,
          [self.name || "<anonymous>", self.ruleName, superDef.name || rawSup, superDef.ruleName],
          child,
        ),
      );
      continue;
    }

    if (hasDisjointTag(superDef)) {
      disjointSupers.push({ def: superDef, rel: child });
    }
  }

  if (disjointSupers.length >= 2) {
    const first = disjointSupers[0]!;
    const second = disjointSupers[1]!;
    diagnostics.push(
      emitDiag(
        db,
        self,
        SysML2ErrorCode.DISJOINT_CLASSIFIER_SPECIALIZATION,
        [
          self.name || "<anonymous>",
          `specializes #disjoint '${first.def.name}'`,
          second.def.name || "<anonymous>",
          "#disjoint classifier",
        ],
        second.rel,
      ),
    );
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}
