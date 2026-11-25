// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LintResult } from "@modelscript/dsl";
import { CraigInterpolator, NumericalInterval, type QueryDB, type SymbolEntry } from "@modelscript/runtime";
import {
  collectCstLeaves,
  findCstDescendants,
  getCstChildren,
  isSysmlIdentLeaf,
  readDottedChainFromLeaves,
  stripLeadingTilde,
  stripNamespaceWildcard,
  type SysmlCstNode,
} from "../cst-utils.js";
import { createSysML2Diagnostic, SysML2ErrorCode } from "../errors.js";
import { getFeatureValue, resolveFeatureInScope, resolveTypeOf } from "../queries.js";
import { RealSimplexSolver } from "../real-simplex.js";
import {
  inferExpressionType,
  isStdlibOrBuiltinSymbol,
  isTypeAssignable,
  normalizeTypeName,
  resolvePathInScope,
} from "../type-checker.js";
import { collectOwnExpressionSubtrees } from "./behavioral-modifiers.js";
import {
  evalCstInterval,
  extractLinearAtomsFromConstraintSymbol,
  isUserWorkspaceSymbol,
  toCraigConstraints,
  type ExtractedLinearAtom,
} from "./formal-verification.js";
import {
  cstHasError,
  emitDiag,
  extractSpecializationClauses,
  findInheritedMemberOnSymbol,
  getFeatureDeclaredTypeRaw,
  getHeaderLeavesBeforeBody,
  getSymbolCst,
  getSymbolLeavesFast,
  hasExternalOrStdlibBaseInHierarchy,
  hasFeatureValueInfo,
  hasHeaderKeyword,
  isDeclarationEntry,
  isTruthyMeta,
  parseExplicitMultiplicity,
  resolveSpecializationTarget,
  resolveTypeOrClassifierByName,
  type ParsedMultiplicity,
} from "./shared.js";
import {
  areClassifierFamiliesDisjoint,
  extractDeclaredVisibility,
  getClassifierFamily,
  NON_SHADOWING_USAGE_RULES,
  type MetaClassifierFamily,
} from "./type-hierarchy.js";
// ---------------------------------------------------------------------------
// S2012: Unused Import or Private Member
// ---------------------------------------------------------------------------

interface IdentSpanEntry {
  uri: string;
  start: number;
  end: number;
}

interface WorkspaceIdentIndex {
  userEntries: SymbolEntry[];
  identSpans: Map<string, IdentSpanEntry[]>;
}

const workspaceIdentCache = new WeakMap<object, WorkspaceIdentIndex>();

function getWorkspaceIdentIndex(db: QueryDB): WorkspaceIdentIndex {
  const key = db as unknown as object;
  const cached = workspaceIdentCache.get(key);
  if (cached) return cached;

  const userEntries = db.allEntries().filter(isUserWorkspaceSymbol);
  const identSpans = new Map<string, IdentSpanEntry[]>();

  const recordIdent = (name: string, uri: string, start: number, end: number) => {
    if (!name || name === "<anonymous>") return;
    let list = identSpans.get(name);
    if (!list) {
      list = [];
      identSpans.set(name, list);
    }
    list.push({ uri, start, end });
  };

  for (const root of userEntries) {
    if (root.parentId !== null) continue;
    const uri = root.resourceId ?? root.documentUri ?? "";
    const { leaves, baseOffset } = getSymbolLeavesFast(db, root);
    for (const lf of leaves) {
      if (isSysmlIdentLeaf(lf.text)) {
        recordIdent(lf.text, uri, baseOffset + lf.start, baseOffset + lf.end);
      }
    }
  }

  for (const entry of userEntries) {
    if (entry.kind === "Reference" || entry.kind === "Specialization") {
      const uri = entry.resourceId ?? entry.documentUri ?? "";
      const raw = (entry.name || "").trim();
      if (!raw) continue;
      for (const seg of raw.split(/::|\./)) {
        const clean = stripLeadingTilde(seg).trim();
        if (isSysmlIdentLeaf(clean)) {
          recordIdent(clean, uri, entry.startOffset, entry.endOffset);
        }
      }
    }
  }

  const built: WorkspaceIdentIndex = { userEntries, identSpans };
  workspaceIdentCache.set(key, built);
  return built;
}

function packageHasStandardComplianceClause(db: QueryDB, pkgSym: SymbolEntry): boolean {
  const queue: SymbolEntry[] = [pkgSym];
  const visited = new Set<number>();
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur.id)) continue;
    visited.add(cur.id);
    for (const ch of db.childrenOf(cur.id)) {
      if (ch.ruleName === "MetadataUsage") {
        const mName = extractMetadataTypeName(db, ch).toLowerCase();
        if (mName === "standardclause" || mName === "compliancerule") return true;
      }
      if (isDeclarationEntry(ch)) queue.push(ch);
    }
  }
  return false;
}

/**
 * Validates S2012 (`unused-import-or-private-member`).
 */
export function checkUnusedImportAndPrivateMember(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  if (!isUserWorkspaceSymbol(self)) return null;
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const selfUri = self.resourceId ?? self.documentUri ?? "";

  // 1. Unused user-package import (`MembershipImport` / `NamespaceImport`)
  if (self.ruleName === "MembershipImport" || self.ruleName === "NamespaceImport" || self.kind === "Import") {
    if (extractDeclaredVisibility(db, self) === "public") return null;

    const { leaves } = getSymbolLeavesFast(db, self);
    const impIdx = leaves.findIndex((l) => l.text === "import");
    let rawImport = (self.name && self.name !== "<anonymous>" ? self.name : "").trim();
    let isWildcard = self.ruleName === "NamespaceImport";
    if (impIdx !== -1) {
      let k = impIdx + 1;
      if (leaves[k]?.text === "all") k++;
      const chain = readDottedChainFromLeaves(leaves, k);
      if (chain) {
        rawImport = chain.text;
        if (
          leaves[chain.nextIdx]?.text === "::" &&
          (leaves[chain.nextIdx + 1]?.text === "*" || leaves[chain.nextIdx + 1]?.text === "**")
        ) {
          isWildcard = true;
        }
      }
    }

    const cleanPath = stripNamespaceWildcard(rawImport).trim();
    if (!cleanPath) return null;
    const pathSegs = cleanPath
      .split("::")
      .map((s) => s.trim())
      .filter(Boolean);
    if (pathSegs.length === 0) return null;
    if (isStdlibOrBuiltinSymbol(cleanPath) || isStdlibOrBuiltinSymbol(pathSegs[0]!)) {
      return null;
    }

    const index = getWorkspaceIdentIndex(db);
    const resolveUserSymbolByPath = (segs: readonly string[], wantNamespace: boolean): SymbolEntry | null => {
      const tail = segs[segs.length - 1]!;
      const cands = index.userEntries.filter((e) => {
        if (e.name !== tail || !isDeclarationEntry(e)) return false;
        if (wantNamespace) return e.kind === "Package" || e.kind === "Definition";
        return true;
      });
      if (cands.length === 0) return null;
      if (segs.length === 1) return cands[0]!;
      const ownerName = segs[segs.length - 2]!;
      return (
        cands.find((c) => {
          const p = c.parentId !== null ? db.symbol(c.parentId) : undefined;
          return p?.name === ownerName;
        }) ?? null
      );
    };

    const targetSym = resolveUserSymbolByPath(pathSegs, isWildcard);
    if (!targetSym) return null;

    if (targetSym.kind === "Package" && packageHasStandardComplianceClause(db, targetSym)) {
      return null;
    }

    const candidateNames = new Set<string>();
    if (targetSym.name) candidateNames.add(targetSym.name);
    if (isWildcard || targetSym.kind === "Package") {
      const collectExported = (container: SymbolEntry, depth: number) => {
        if (depth > 6) return;
        for (const ch of db.childrenOf(container.id)) {
          if (!isDeclarationEntry(ch) || !ch.name || ch.name === "<anonymous>") continue;
          if (extractDeclaredVisibility(db, ch) === "private") continue;
          candidateNames.add(ch.name);
          if (ch.kind === "Package" || ch.kind === "Enumeration") {
            collectExported(ch, depth + 1);
          }
        }
      };
      collectExported(targetSym, 0);
    }

    const encSym = self.parentId !== null ? db.symbol(self.parentId) : undefined;
    const scopeStart = encSym ? encSym.startOffset : 0;
    const scopeEnd = encSym ? encSym.endOffset : Number.POSITIVE_INFINITY;

    for (const cand of candidateNames) {
      const spans = index.identSpans.get(cand);
      if (!spans) continue;
      const usedOutsideImport = spans.some(
        (sp) =>
          sp.uri === selfUri &&
          sp.start >= scopeStart &&
          sp.end <= scopeEnd &&
          (sp.end <= self.startOffset || sp.start >= self.endOffset),
      );
      if (usedOutsideImport) return null;
    }

    const displayTarget = isWildcard ? `${cleanPath}::*` : cleanPath;
    return emitDiag(db, self, SysML2ErrorCode.UNUSED_IMPORT_OR_PRIVATE_MEMBER, ["import", displayTarget]);
  }

  // 2. Unused `private` member inside a `Package` / `LibraryPackage` / `PartDefinition`
  if (
    self.parentId !== null &&
    (self.kind === "Definition" || self.kind === "Usage" || self.kind === "Enumeration") &&
    self.name &&
    self.name !== "<anonymous>" &&
    self.name !== self.ruleName &&
    !NON_SHADOWING_USAGE_RULES.has(self.ruleName) &&
    self.ruleName !== "MetadataUsage" &&
    self.ruleName !== "PrefixMetadataUsage"
  ) {
    const parentSym = db.symbol(self.parentId);
    if (
      !parentSym ||
      (parentSym.ruleName !== "Package" &&
        parentSym.ruleName !== "LibraryPackage" &&
        parentSym.ruleName !== "PartDefinition")
    ) {
      return null;
    }
    if (extractDeclaredVisibility(db, self) !== "private") return null;

    const index = getWorkspaceIdentIndex(db);
    const spans = index.identSpans.get(self.name) ?? [];
    const referencedOutsideSelf = spans.some(
      (sp) => sp.uri !== selfUri || sp.end <= self.startOffset || sp.start >= self.endOffset,
    );
    if (!referencedOutsideSelf) {
      const memberLabel =
        self.kind === "Definition" || self.kind === "Enumeration" ? "private definition" : "private member";
      return emitDiag(db, self, SysML2ErrorCode.UNUSED_IMPORT_OR_PRIVATE_MEMBER, [memberLabel, self.name]);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// S3018: Invalid Cast or Classification Type Test
// ---------------------------------------------------------------------------

type ScalarPrimitiveFamily = "boolean" | "string" | "numeric";

const UNIVERSAL_TOP_TYPES = new Set<string>([
  "Anything",
  "Element",
  "Type",
  "Classifier",
  "Feature",
  "DataValue",
  "ScalarValue",
]);

const NUMERIC_SCALAR_TYPES = new Set<string>([
  "Real",
  "Integer",
  "Natural",
  "Positive",
  "UnlimitedNatural",
  "Rational",
  "Complex",
  "NumericalValue",
]);

function classifyPrimitiveScalarFamily(db: QueryDB, rawType: string): ScalarPrimitiveFamily | null {
  const short = normalizeTypeName(rawType);
  if (short === "Boolean") return "boolean";
  if (short === "String") return "string";
  if (NUMERIC_SCALAR_TYPES.has(short) || short.endsWith("Value")) return "numeric";

  // Check if user AttributeDefinition specializes Boolean / String / Real / Integer
  const sym = db.byName(short).find((s) => s.ruleName === "AttributeDefinition");
  if (sym) {
    if (isTypeAssignable(db, short, "Boolean")) return "boolean";
    if (isTypeAssignable(db, short, "String")) return "string";
    if (isTypeAssignable(db, short, "Real") || isTypeAssignable(db, short, "Integer")) return "numeric";
  }
  return null;
}

function getUsageImplicitFamily(ruleName: string): MetaClassifierFamily | null {
  switch (ruleName) {
    case "AttributeUsage":
    case "EnumerationUsage":
    case "EnumeratedValue":
      return "datatype";
    case "PortUsage":
      return "port";
    case "PartUsage":
    case "ItemUsage":
    case "ConnectionUsage":
    case "InterfaceUsage":
    case "AllocationUsage":
    case "ViewUsage":
    case "RenderingUsage":
      return "structural";
    case "ActionUsage":
    case "PerformActionUsage":
    case "StateUsage":
    case "ExhibitStateUsage":
    case "CalculationUsage":
    case "ConstraintUsage":
    case "RequirementUsage":
    case "CaseUsage":
    case "AnalysisCaseUsage":
    case "VerificationCaseUsage":
    case "UseCaseUsage":
      return "behavioral";
    default:
      return null;
  }
}

function resolveTypeMetaFamily(
  db: QueryDB,
  scopeId: number | null,
  typeName: string,
): { family: MetaClassifierFamily | null; defSym: SymbolEntry | null } {
  const short = normalizeTypeName(typeName);
  if (classifyPrimitiveScalarFamily(db, short) !== null) {
    const defSym = resolveTypeOrClassifierByName(db, scopeId, typeName);
    return { family: "datatype", defSym: defSym && isUserWorkspaceSymbol(defSym) ? defSym : null };
  }
  if (short === "Part" || short === "Item") return { family: "structural", defSym: null };
  if (short === "Port") return { family: "port", defSym: null };
  if (
    short === "Action" ||
    short === "State" ||
    short === "Calculation" ||
    short === "Constraint" ||
    short === "Requirement"
  ) {
    return { family: "behavioral", defSym: null };
  }
  const defSym = resolveTypeOrClassifierByName(db, scopeId, typeName);
  if (defSym && (defSym.kind === "Definition" || defSym.kind === "Enumeration")) {
    return { family: getClassifierFamily(defSym.ruleName), defSym };
  }
  return { family: null, defSym: null };
}

function hasDisjointMarkerInHierarchy(db: QueryDB, defSym: SymbolEntry): boolean {
  const hasTag = (sym: SymbolEntry): boolean => {
    const { leaves } = getHeaderLeavesBeforeBody(db, sym);
    for (let i = 0; i < leaves.length - 1; i++) {
      if (leaves[i]!.text === "#" && leaves[i + 1]!.text.toLowerCase() === "disjoint") return true;
    }
    return db
      .childrenOf(sym.id)
      .some(
        (c) =>
          (c.ruleName === "MetadataUsage" || c.ruleName === "PrefixMetadataUsage") &&
          extractMetadataTypeName(db, c).toLowerCase() === "disjoint",
      );
  };
  return hasTag(defSym);
}

function hasCommonSubtypeInWorkspace(db: QueryDB, defA: SymbolEntry, defB: SymbolEntry): boolean {
  if (!defA.name || !defB.name) return false;
  for (const entry of db.allEntries()) {
    if (!isUserWorkspaceSymbol(entry) || entry.kind !== "Definition" || !entry.name) continue;
    if (isTypeAssignable(db, entry.name, defA.name) && isTypeAssignable(db, entry.name, defB.name)) {
      return true;
    }
  }
  return false;
}

/**
 * Validates S3018 (`invalid-cast-or-type-test`) on `as`, `hastype`, `istype`, and `@` expressions.
 */
export function checkInvalidCastOrTypeTest(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  const { node: cst, baseOffset } = getSymbolCst(db, self);
  if (!cst || cstHasError(cst)) return null;

  const evalScopeId = self.kind === "Definition" || self.kind === "Package" ? self.id : (self.parentId ?? self.id);
  const classifNodes = collectOwnExpressionSubtrees(db, self, cst, baseOffset, new Set(["ClassificationExpression"]));
  if (classifNodes.length === 0) return null;

  const diagnostics: LintResult[] = [];

  for (const ce of classifNodes) {
    let operandNode = ce.childForFieldName?.("operand") ?? null;
    let opText = ce.childForFieldName?.("operator")?.text?.trim() ?? "";
    let targetNode = ce.childForFieldName?.("typeReference") ?? ce.childForFieldName?.("typeResult") ?? null;

    if (!operandNode || !opText || !targetNode) {
      const chs = getCstChildren(ce);
      for (const ch of chs) {
        if (ch.type === "ClassificationTestOperator" || ch.type === "CastOperator") {
          opText = ch.text.trim();
        } else if (ch.type === "TypeReferenceMember" || ch.type === "TypeResultMember" || ch.type === "TypeReference") {
          targetNode = ch;
        } else if (!operandNode && (ch.type.includes("Expression") || ch.type.includes("Literal"))) {
          operandNode = ch;
        }
      }
    }

    if (!operandNode || !targetNode) continue;
    if (opText !== "as" && opText !== "hastype" && opText !== "istype" && opText !== "@") continue;

    const rawTargetType = stripLeadingTilde(targetNode.text.trim());
    if (!rawTargetType) continue;
    const shortTarget = normalizeTypeName(rawTargetType);
    if (UNIVERSAL_TOP_TYPES.has(shortTarget)) continue;

    // Infer operand static type or implicit usage metaclass family
    const inferred = inferExpressionType(db, operandNode, evalScopeId);
    let srcTypeName = inferred.typeName ? stripLeadingTilde(inferred.typeName) : null;
    let srcImplicitFamily: MetaClassifierFamily | null = null;

    if (!srcTypeName) {
      const refText = operandNode.text.trim();
      if (refText && !refText.includes("(")) {
        const refSym = resolvePathInScope(db, evalScopeId, refText) ?? resolveFeatureInScope(db, evalScopeId, refText);
        if (refSym) {
          const declType = getFeatureDeclaredTypeRaw(db, refSym);
          if (declType?.raw) {
            srcTypeName = declType.raw;
          } else {
            srcImplicitFamily = getUsageImplicitFamily(refSym.ruleName);
            if (srcImplicitFamily) {
              srcTypeName = refSym.ruleName;
            }
          }
        }
      }
    }

    if (!srcTypeName) continue;
    const shortSrc = normalizeTypeName(srcTypeName);
    if (UNIVERSAL_TOP_TYPES.has(shortSrc)) continue;

    // Valid upcast or downcast along specialization hierarchy
    if (isTypeAssignable(db, srcTypeName, rawTargetType) || isTypeAssignable(db, rawTargetType, srcTypeName)) {
      continue;
    }

    const srcMeta = srcImplicitFamily
      ? { family: srcImplicitFamily, defSym: null }
      : resolveTypeMetaFamily(db, evalScopeId, srcTypeName);
    const tgtMeta = resolveTypeMetaFamily(db, evalScopeId, rawTargetType);

    // Allow Occurrence / Object supertypes when casting non-datatype occurrences
    if ((shortSrc === "Occurrence" || shortSrc === "Object") && tgtMeta.family && tgtMeta.family !== "datatype") {
      continue;
    }
    if ((shortTarget === "Occurrence" || shortTarget === "Object") && srcMeta.family && srcMeta.family !== "datatype") {
      continue;
    }

    let isDisjoint = false;

    // 1. Disjoint primitive scalar families (e.g. Boolean as Real, String as Integer)
    const srcPrim = srcImplicitFamily ? null : classifyPrimitiveScalarFamily(db, srcTypeName);
    const tgtPrim = classifyPrimitiveScalarFamily(db, rawTargetType);
    if (srcPrim && tgtPrim && srcPrim !== tgtPrim) {
      isDisjoint = true;
    }

    // 2. Disjoint metaclass families (e.g. PartUsage/PartDefinition <-> String/Boolean/ActionDefinition/PortDefinition)
    if (
      !isDisjoint &&
      srcMeta.family &&
      tgtMeta.family &&
      areClassifierFamiliesDisjoint(srcMeta.family, tgtMeta.family)
    ) {
      isDisjoint = true;
    }

    // 3. Distinct Enumerations or #disjoint classifiers with no common subtype
    if (!isDisjoint && srcMeta.defSym && tgtMeta.defSym && srcMeta.defSym.id !== tgtMeta.defSym.id) {
      if (srcMeta.defSym.ruleName === "EnumerationDefinition" || tgtMeta.defSym.ruleName === "EnumerationDefinition") {
        isDisjoint = true;
      } else if (
        (hasDisjointMarkerInHierarchy(db, srcMeta.defSym) || hasDisjointMarkerInHierarchy(db, tgtMeta.defSym)) &&
        !hasCommonSubtypeInWorkspace(db, srcMeta.defSym, tgtMeta.defSym)
      ) {
        isDisjoint = true;
      }
    }

    if (isDisjoint) {
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.INVALID_CAST_OR_TYPE_TEST, [opText, srcTypeName, rawTargetType], {
          node: ce,
          baseOffset,
        }),
      );
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S4025: Individual, Snapshot & Timeslice Portion Misuse
// ---------------------------------------------------------------------------

const ALLOWED_PORTION_OWNER_RULES = new Set<string>([
  "OccurrenceDefinition",
  "OccurrenceUsage",
  "PartDefinition",
  "PartUsage",
  "ItemDefinition",
  "ItemUsage",
]);

function isIndividualClassifierDef(db: QueryDB, sym: SymbolEntry): boolean {
  if (sym.kind !== "Definition") return false;
  return isTruthyMeta(sym, "isIndividual") || hasHeaderKeyword(db, sym, "individual");
}

function collectIncomparableIndividualDefs(db: QueryDB, self: SymbolEntry): SymbolEntry[] {
  const found = new Map<number, SymbolEntry>();
  const visited = new Set<number>();

  const walk = (sym: SymbolEntry) => {
    if (visited.has(sym.id)) return;
    visited.add(sym.id);
    if (sym.id !== self.id && isIndividualClassifierDef(db, sym)) {
      found.set(sym.id, sym);
    }
    for (const ch of db.childrenOf(sym.id)) {
      if (
        ch.ruleName === "OwnedFeatureTyping" ||
        ch.ruleName === "OwnedSubclassification" ||
        ch.ruleName === "Subclassification" ||
        ch.ruleName === "OwnedSubsetting" ||
        ch.ruleName === "OwnedRedefinition"
      ) {
        const raw = stripLeadingTilde((ch.name || db.cstText(ch.startOffset, ch.endOffset, ch) || "").trim());
        if (!raw || isStdlibOrBuiltinSymbol(raw)) continue;
        const resolved = resolveTypeOrClassifierByName(db, sym.parentId, raw);
        if (resolved && isUserWorkspaceSymbol(resolved)) {
          walk(resolved);
        }
      }
    }
  };

  walk(self);
  const allInds = Array.from(found.values());
  if (allInds.length <= 1) return allInds;

  // Keep maximal incomparable individual definitions (drop supertypes of another individual definition in the set)
  return allInds.filter(
    (cand) =>
      !allInds.some(
        (other) => other.id !== cand.id && other.name && cand.name && isTypeAssignable(db, other.name, cand.name),
      ),
  );
}

/**
 * Validates S4025 (`individual-or-portion-misuse`).
 */
export function checkIndividualAndPortionRules(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const { leaves: headerLeaves } = getHeaderLeavesBeforeBody(db, self);
  if (headerLeaves.length === 0) return null;

  const hasIndividual = isTruthyMeta(self, "isIndividual") || headerLeaves.some((l) => l.text === "individual");
  const hasSnapshot = headerLeaves.some((l) => l.text === "snapshot");
  const hasTimeslice = headerLeaves.some((l) => l.text === "timeslice");
  const isVariation = isTruthyMeta(self, "isVariation") || headerLeaves.some((l) => l.text === "variation");

  if (!hasIndividual && !hasSnapshot && !hasTimeslice) {
    // Still check if a usage/definition references > 1 distinct individual definitions via multiple typing/inheritance
    if (self.kind !== "Usage" && self.kind !== "Definition") return null;
    const indDefs = collectIncomparableIndividualDefs(db, self);
    if (indDefs.length > 1) {
      const selfName = self.name && self.name !== "<anonymous>" ? self.name : self.ruleName;
      const names = indDefs.map((d) => `'${d.name || d.ruleName}'`).join(", ");
      return emitDiag(db, self, SysML2ErrorCode.INDIVIDUAL_OR_PORTION_MISUSE, [
        selfName,
        `references multiple distinct 'individual' definitions (${names})`,
      ]);
    }
    return null;
  }

  const diagnostics: LintResult[] = [];
  const selfName = self.name && self.name !== "<anonymous>" ? self.name : self.ruleName;

  // 1. A variation cannot simultaneously be individual
  if (hasIndividual && isVariation) {
    diagnostics.push(
      emitDiag(db, self, SysML2ErrorCode.INDIVIDUAL_OR_PORTION_MISUSE, [
        selfName,
        "a 'variation' cannot simultaneously be declared 'individual'",
      ]),
    );
  }

  // 2. At most one individual definition may type/classify an individual usage or definition
  const indDefs = collectIncomparableIndividualDefs(db, self);
  if (indDefs.length > 1) {
    const names = indDefs.map((d) => `'${d.name || d.ruleName}'`).join(", ");
    diagnostics.push(
      emitDiag(db, self, SysML2ErrorCode.INDIVIDUAL_OR_PORTION_MISUSE, [
        selfName,
        `'individual' element cannot be typed/classified by multiple 'individual' definitions (${names})`,
      ]),
    );
  }

  // 3. Portion (`snapshot` / `timeslice`) ownership and immutability rules
  if (self.kind === "Usage" && (hasSnapshot || hasTimeslice)) {
    const portionKind = hasSnapshot ? "snapshot" : "timeslice";
    const parentSym = self.parentId !== null ? db.symbol(self.parentId) : undefined;
    if (!parentSym || !ALLOWED_PORTION_OWNER_RULES.has(parentSym.ruleName)) {
      const ownerDesc = parentSym ? `'${parentSym.ruleName}'` : "top-level root";
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.INDIVIDUAL_OR_PORTION_MISUSE, [
          selfName,
          `'${portionKind}' portion usage cannot be owned directly by ${ownerDesc}; expected an Occurrence, Part, or Item`,
        ]),
      );
    }

    const valInfo = hasFeatureValueInfo(db, self);
    if (valInfo.isInitialMutable) {
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.INDIVIDUAL_OR_PORTION_MISUSE, [
          selfName,
          `'${portionKind}' portion usage cannot use mutable ':=' assignment`,
        ]),
      );
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S4026: Metadata Annotation Invalid (@Meta / #Meta)
// ---------------------------------------------------------------------------

const KNOWN_CONVENTION_METADATA = new Set<string>([
  "unsafe",
  "hazard",
  "forbidden",
  "disjoint",
  "critical",
  "safety",
  "safetycritical",
  "failuremode",
  "fault",
  "basicfault",
  "primaryevent",
  "topevent",
  "safetygoal",
  "asil",
  "asil_a",
  "asil_b",
  "asil_c",
  "asil_d",
  "normal",
  "uniform",
  "tolerance",
  "maxfailureprobability",
  "noninterference",
  "untrusted",
  "highintegrity",
  "lipschitz",
  "robustness",
  "timehorizon",
  "flowpipe",
  "simulation",
  "standardclause",
  "compliancerule",
  "externalcalculator",
  "conserved",
  "spatialbox",
  "boundingbox",
  "maxlength",
]);

export function extractMetadataTypeName(db: QueryDB, metaSym: SymbolEntry): string {
  const typingRef = db.childrenOf(metaSym.id).find((c) => c.ruleName === "MetadataTyping");
  if (typingRef?.name) return typingRef.name.trim();
  const { leaves } = getSymbolLeavesFast(db, metaSym);
  for (let i = 0; i < leaves.length; i++) {
    const tok = leaves[i]!.text;
    if (tok === "{" || tok === ";") break;
    if (tok === "@" || tok === "#" || tok === "metadata" || tok === ":") {
      const ch = readDottedChainFromLeaves(leaves, i + 1);
      if (ch && leaves[ch.nextIdx]?.text !== ":") {
        return ch.text;
      }
    }
  }
  return "";
}

function resolveUserCandidatesForMetadata(db: QueryDB, scopeId: number | null, rawMetaName: string): SymbolEntry[] {
  const clean = rawMetaName.trim();
  if (!clean) return [];
  if (clean.includes("::")) {
    const resolved = resolvePathInScope(db, scopeId, clean);
    if (resolved && isUserWorkspaceSymbol(resolved) && isDeclarationEntry(resolved)) {
      return [resolved];
    }
    const segs = clean.split("::").filter(Boolean);
    const tail = segs[segs.length - 1]!;
    const owner = segs.length >= 2 ? segs[segs.length - 2]! : "";
    return db.byName(tail).filter((s) => {
      if (!isUserWorkspaceSymbol(s) || !isDeclarationEntry(s)) return false;
      if (!owner) return true;
      const p = s.parentId !== null ? db.symbol(s.parentId) : undefined;
      return p?.name === owner;
    });
  }

  return db
    .byName(clean)
    .filter(
      (s) => isUserWorkspaceSymbol(s) && (s.kind === "Definition" || s.kind === "Enumeration" || s.kind === "Package"),
    );
}

/**
 * Validates S4026 (`metadata-annotation-invalid`) on `@Meta { ... }` and `#Meta` annotations.
 */
export function checkMetadataAnnotationValidity(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  if (!isUserWorkspaceSymbol(self)) return null;
  const { node: cst, baseOffset } = getSymbolCst(db, self);
  if (!cst || cstHasError(cst)) return null;

  const diagnostics: LintResult[] = [];

  // 1. Owned `MetadataUsage` (`@Meta { ... }` or `metadata Meta { ... }`)
  if (self.ruleName === "MetadataUsage" || self.ruleName === "PrefixMetadataUsage") {
    const rawMeta = extractMetadataTypeName(db, self);
    if (!rawMeta) return null;

    const shortLower = normalizeTypeName(rawMeta).toLowerCase();
    const userCands = resolveUserCandidatesForMetadata(db, self.parentId, rawMeta);
    const metaDef = userCands.find((s) => s.ruleName === "MetadataDefinition") ?? null;

    if (!metaDef) {
      if (userCands.length > 0 && !KNOWN_CONVENTION_METADATA.has(shortLower)) {
        const wrongSym = userCands[0]!;
        diagnostics.push(
          emitDiag(db, self, SysML2ErrorCode.METADATA_ANNOTATION_INVALID, [
            `@${rawMeta}`,
            `'${rawMeta}' resolves to '${wrongSym.ruleName}', expected a 'metadata def'`,
          ]),
        );
      }
      return diagnostics.length > 0 ? diagnostics[0]! : null;
    }

    // Validate redefined fields inside `@Meta { field = ...; }` against `metaDef`
    if (!hasExternalOrStdlibBaseInHierarchy(db, metaDef)) {
      const bodyUsages = findCstDescendants(cst, "MetadataBodyUsage");
      const checkedFields = new Set<string>();

      for (const bu of bodyUsages) {
        // Only inspect direct body usages of this MetadataUsage (skip nested MetadataBodyUsage blocks)
        let nestedInsideAnotherBody = false;
        let p = bu.parent;
        while (p && p !== cst) {
          if (p.type === "MetadataBodyUsage" || p.type === "MetadataUsage") {
            nestedInsideAnotherBody = true;
            break;
          }
          p = p.parent;
        }
        if (nestedInsideAnotherBody) continue;

        const buLeaves = collectCstLeaves(bu);
        let idx = 0;
        if (buLeaves[idx]?.text === "ref") idx++;
        if (buLeaves[idx]?.text === ":>>" || buLeaves[idx]?.text === "redefines") idx++;
        const chain = readDottedChainFromLeaves(buLeaves, idx);
        if (!chain) continue;

        const fieldPath = chain.text.trim();
        if (!fieldPath || checkedFields.has(fieldPath)) continue;
        checkedFields.add(fieldPath);

        const segs = fieldPath
          .split(".")
          .map((s) => s.trim())
          .filter(Boolean);
        let currDef: SymbolEntry | null = metaDef;
        let missingSeg: string | null = null;

        for (let sIdx = 0; sIdx < segs.length; sIdx++) {
          const seg = segs[sIdx]!;
          const member: SymbolEntry | null = currDef ? findInheritedMemberOnSymbol(db, currDef, seg, self.id) : null;
          if (!member) {
            missingSeg = seg;
            break;
          }
          if (sIdx + 1 < segs.length) {
            currDef = resolveTypeOf(db, member) ?? member;
          }
        }

        if (missingSeg) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.METADATA_ANNOTATION_INVALID,
              [
                `@${rawMeta}`,
                `field '${fieldPath}' is not declared on metadata definition '${metaDef.name || rawMeta}'`,
              ],
              { node: bu, baseOffset },
            ),
          );
        }
      }
    }

    if (diagnostics.length === 0) return null;
    return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
  }

  // 2. Prefix `#Meta` annotations in header of any Definition, Usage, or Package
  const { leaves: headerLeaves, baseOffset: hBase } = getHeaderLeavesBeforeBody(db, self);
  for (let i = 0; i < headerLeaves.length; i++) {
    if (headerLeaves[i]!.text !== "#") continue;
    const chain = readDottedChainFromLeaves(headerLeaves, i + 1);
    if (!chain) continue;
    const rawMeta = chain.text;
    const shortLower = normalizeTypeName(rawMeta).toLowerCase();
    const userCands = resolveUserCandidatesForMetadata(db, self.parentId ?? self.id, rawMeta);
    const hasMetaDef = userCands.some((s) => s.ruleName === "MetadataDefinition");
    if (!hasMetaDef && userCands.length > 0 && !KNOWN_CONVENTION_METADATA.has(shortLower)) {
      const startLf = headerLeaves[i]!;
      const endLf = headerLeaves[chain.nextIdx - 1]!;
      diagnostics.push(
        createSysML2Diagnostic(
          SysML2ErrorCode.METADATA_ANNOTATION_INVALID,
          [`#${rawMeta}`, `'${rawMeta}' resolves to '${userCands[0]!.ruleName}', expected a 'metadata def'`],
          { startOffset: hBase + startLf.start, endOffset: hBase + endLf.end },
        ),
      );
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S6004: Opaque Interface Incompatibility (Port Contract & Craig Interpolation)
// ---------------------------------------------------------------------------

export function extractConnectionEndpointsFast(
  db: QueryDB,
  connSym: SymbolEntry,
): { source: string; target: string } | null {
  const { leaves } = getSymbolLeavesFast(db, connSym);
  let braceDepth = 0;
  for (let i = 0; i < leaves.length; i++) {
    const tok = leaves[i]!.text;
    if (tok === "{") braceDepth++;
    else if (tok === "}") braceDepth = Math.max(0, braceDepth - 1);
    if (braceDepth > 0) continue;
    if (tok === "connect") {
      const src = readDottedChainFromLeaves(leaves, i + 1);
      if (src && leaves[src.nextIdx]?.text === "to") {
        const tgt = readDottedChainFromLeaves(leaves, src.nextIdx + 1);
        if (tgt) return { source: src.text, target: tgt.text };
      }
    }
  }
  const refs = db.childrenOf(connSym.id).filter((c) => c.kind === "Reference");
  if (refs.length >= 2) {
    const readRef = (r: SymbolEntry): string => {
      const chs = db.childrenOf(r.id).filter((c) => c.name && c.name !== "<anonymous>");
      if (chs.length > 0) return chs.map((c) => c.name).join(".");
      return (r.name || db.cstText(r.startOffset, r.endOffset, r) || "").trim();
    };
    const s = readRef(refs[refs.length - 2]!);
    const t = readRef(refs[refs.length - 1]!);
    if (s && t) return { source: s, target: t };
  }
  return null;
}

function collectPortEndpointLinearAtoms(
  db: QueryDB,
  parentScopeId: number,
  endpointPath: string,
): { atoms: ExtractedLinearAtom[]; featureNames: Set<string> } {
  const segs = endpointPath
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segs.length === 0) return { atoms: [], featureNames: new Set() };

  let partSym: SymbolEntry | null = null;
  let partDef: SymbolEntry | null = null;
  let portSym: SymbolEntry | null = null;
  let portName = segs[segs.length - 1]!;

  if (segs.length >= 2) {
    partSym = resolveFeatureInScope(db, parentScopeId, segs[0]!);
    partDef = partSym ? resolveTypeOf(db, partSym) : null;
    portName = segs[1]!;
    if (partSym) {
      portSym =
        db
          .childrenOf(partSym.id)
          .find(
            (c) =>
              c.kind === "Usage" &&
              (c.name === portName ||
                extractSpecializationClauses(db, c).some((cl) => cl.targetPath.split(".").pop() === portName)),
          ) ?? null;
    }
    if (!portSym && partDef) {
      portSym = db.childrenOf(partDef.id).find((c) => c.kind === "Usage" && c.name === portName) ?? null;
    }
  } else {
    portSym = resolveFeatureInScope(db, parentScopeId, portName);
  }

  if (!portSym) return { atoms: [], featureNames: new Set() };

  const portDef = resolveTypeOf(db, portSym);
  const featureNames = new Set<string>();
  const boundValues = new Map<string, { val: number; sym: SymbolEntry }>();
  const rawBoundRatings = new Map<string, { kind: "min" | "max"; baseFeat: string; val: number; sym: SymbolEntry }>();

  const ingestPortMember = (member: SymbolEntry, evalScope: number, allowOverride: boolean) => {
    if (member.kind !== "Usage") return;
    let featName = member.name && member.name !== "<anonymous>" ? member.name : "";
    if (!featName) {
      const cls = extractSpecializationClauses(db, member);
      if (cls.length > 0) {
        featName = cls[0]!.targetPath.split("::").pop()!.split(".").pop()!;
      }
    }
    if (!featName || NON_SHADOWING_USAGE_RULES.has(member.ruleName)) return;

    const vInfo = hasFeatureValueInfo(db, member);
    const numVal = vInfo.hasValue && !vInfo.isDefault ? getFeatureValue(db, member, evalScope) : undefined;

    if (featName.startsWith("max") && featName.length > 3 && /^[A-Z]/.test(featName[3]!)) {
      const base = featName[3]!.toLowerCase() + featName.slice(4);
      if (typeof numVal === "number" && Number.isFinite(numVal)) {
        if (allowOverride || !rawBoundRatings.has(featName)) {
          rawBoundRatings.set(featName, { kind: "max", baseFeat: base, val: numVal, sym: member });
        }
      }
      return;
    }
    if (featName.startsWith("min") && featName.length > 3 && /^[A-Z]/.test(featName[3]!)) {
      const base = featName[3]!.toLowerCase() + featName.slice(4);
      if (typeof numVal === "number" && Number.isFinite(numVal)) {
        if (allowOverride || !rawBoundRatings.has(featName)) {
          rawBoundRatings.set(featName, { kind: "min", baseFeat: base, val: numVal, sym: member });
        }
      }
      return;
    }

    featureNames.add(featName);
    if (typeof numVal === "number" && Number.isFinite(numVal)) {
      if (allowOverride || !boundValues.has(featName)) {
        boundValues.set(featName, { val: numVal, sym: member });
      }
    }
  };

  if (portDef) {
    for (const ch of db.childrenOf(portDef.id)) ingestPortMember(ch, portDef.id, false);
  }
  if (partDef) {
    const basePort = db.childrenOf(partDef.id).find((c) => c.kind === "Usage" && c.name === portName);
    if (basePort && basePort.id !== portSym.id) {
      for (const ch of db.childrenOf(basePort.id)) ingestPortMember(ch, basePort.id, true);
    }
  }
  for (const ch of db.childrenOf(portSym.id)) ingestPortMember(ch, portSym.id, true);

  const atoms: ExtractedLinearAtom[] = [];
  for (const [featName, { val, sym }] of boundValues) {
    atoms.push({
      constraintSym: sym,
      terms: [{ varName: featName, coeff: 1 }],
      operator: "==",
      rhs: val,
      rawText: `${featName} == ${val}`,
    });
  }
  for (const [, rating] of rawBoundRatings) {
    featureNames.add(rating.baseFeat);
    atoms.push({
      constraintSym: rating.sym,
      terms: [{ varName: rating.baseFeat, coeff: 1 }],
      operator: rating.kind === "max" ? "<=" : ">=",
      rhs: rating.val,
      rawText: `${rating.baseFeat} ${rating.kind === "max" ? "<=" : ">="} ${rating.val}`,
    });
  }

  const harvestPortConstraints = (
    container: SymbolEntry,
    stripPrefixes: ReadonlySet<string>,
    requirePortPrefix: boolean,
  ) => {
    for (const ch of db.childrenOf(container.id)) {
      if (
        ch.ruleName !== "AssertConstraintUsage" &&
        ch.ruleName !== "ConstraintUsage" &&
        ch.ruleName !== "RequirementConstraintUsage"
      ) {
        continue;
      }
      const rawAtoms = extractLinearAtomsFromConstraintSymbol(
        db,
        ch,
        requirePortPrefix ? new Set() : stripPrefixes,
        container.id,
      );
      for (const at of rawAtoms) {
        if (requirePortPrefix) {
          const touchesThisPort = at.terms.every((t) => {
            const dot = t.varName.indexOf(".");
            return dot > 0 && stripPrefixes.has(t.varName.slice(0, dot));
          });
          if (!touchesThisPort) continue;
          const strippedTerms = at.terms.map((t) => {
            const dot = t.varName.indexOf(".");
            const f = dot > 0 ? t.varName.slice(dot + 1) : t.varName;
            featureNames.add(f);
            return { varName: f, coeff: t.coeff };
          });
          atoms.push({ ...at, terms: strippedTerms });
        } else {
          for (const t of at.terms) featureNames.add(t.varName);
          atoms.push(at);
        }
      }
    }
  };

  const portAliases = new Set<string>([
    portName,
    ...(portSym.name ? [portSym.name] : []),
    ...(portDef?.name ? [portDef.name] : []),
  ]);
  if (portDef) harvestPortConstraints(portDef, portAliases, false);
  if (partDef) {
    const basePort = db.childrenOf(partDef.id).find((c) => c.kind === "Usage" && c.name === portName);
    if (basePort && basePort.id !== portSym.id) harvestPortConstraints(basePort, portAliases, false);
    harvestPortConstraints(partDef, new Set([portName]), true);
  }
  harvestPortConstraints(portSym, portAliases, false);
  if (partSym) harvestPortConstraints(partSym, new Set([portName]), true);

  return { atoms, featureNames };
}

function formatLinearInterpolantText(coeffs: ReadonlyMap<string, number>, rhs: number): string {
  const parts: string[] = [];
  for (const [v, c] of coeffs) {
    if (Math.abs(c) <= 1e-9) continue;
    const absC = Number(Math.abs(c).toFixed(4));
    const coeffStr = absC === 1 ? v : `${absC}*${v}`;
    if (parts.length === 0) {
      parts.push(c < 0 ? `-${coeffStr}` : coeffStr);
    } else {
      parts.push(c < 0 ? `- ${coeffStr}` : `+ ${coeffStr}`);
    }
  }
  if (parts.length === 0) return `0 <= ${Number(rhs.toFixed(4))}`;
  // Normalize single negative term `-x <= -48` to `x >= 48` for readability
  if (coeffs.size === 1) {
    const [[varName, coeff]] = Array.from(coeffs.entries()) as [[string, number]];
    if (coeff < -1e-9) {
      const scaled = Number((-rhs / -coeff).toFixed(4));
      return `${varName} >= ${scaled}`;
    }
    if (coeff > 1e-9) {
      const scaled = Number((rhs / coeff).toFixed(4));
      return `${varName} <= ${scaled}`;
    }
  }
  return `${parts.join(" ")} <= ${Number(rhs.toFixed(4))}`;
}

/**
 * Validates S6004 (`opaque-interface-incompatibility`) on `ConnectionUsage` using
 * `RealSimplexSolver` and `CraigInterpolator.interpolateLRA`.
 */
export function checkOpaqueInterfaceCompatibility(db: QueryDB, self: SymbolEntry): LintResult | null {
  if (self.ruleName !== "ConnectionUsage" || self.parentId === null) return null;
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const ep = extractConnectionEndpointsFast(db, self);
  if (!ep || !ep.source || !ep.target || ep.source === ep.target) return null;

  const sideA = collectPortEndpointLinearAtoms(db, self.parentId, ep.source);
  const sideB = collectPortEndpointLinearAtoms(db, self.parentId, ep.target);
  if (sideA.atoms.length === 0 || sideB.atoms.length === 0) return null;

  const sharedFeatures = Array.from(sideA.featureNames).filter((f) => sideB.featureNames.has(f));
  if (sharedFeatures.length === 0) return null;

  const isSideFeasible = (atoms: readonly ExtractedLinearAtom[]): boolean => {
    const s = new RealSimplexSolver();
    for (const a of atoms) {
      s.addConstraint({ terms: a.terms, operator: a.operator, rhs: a.rhs, expression: a.rawText });
    }
    return s.solve(500).isFeasible;
  };

  if (!isSideFeasible(sideA.atoms) || !isSideFeasible(sideB.atoms)) return null;

  const jointSolver = new RealSimplexSolver();
  for (const a of [...sideA.atoms, ...sideB.atoms]) {
    jointSolver.addConstraint({ terms: a.terms, operator: a.operator, rhs: a.rhs, expression: a.rawText });
  }
  if (jointSolver.solve(1000).isFeasible) return null;

  const craigRes = CraigInterpolator.interpolateLRA(toCraigConstraints(sideA.atoms), toCraigConstraints(sideB.atoms));
  let explanation = "";
  if (craigRes.status === "INTERPOLANT_FOUND" && craigRes.linearInterpolant) {
    const interpStr = formatLinearInterpolantText(craigRes.linearInterpolant.coeffs, craigRes.linearInterpolant.rhs);
    explanation = `Craig interpolant '${interpStr}' over [${craigRes.sharedVars.join(", ") || sharedFeatures.join(", ")}] refutes '${sideB.atoms.map((b) => b.rawText).join(" and ")}'`;
  } else {
    explanation = `'${sideA.atoms.map((a) => a.rawText).join(" and ")}' conflicts with '${sideB.atoms.map((b) => b.rawText).join(" and ")}'`;
  }

  return emitDiag(db, self, SysML2ErrorCode.OPAQUE_INTERFACE_INCOMPATIBILITY, [ep.source, ep.target, explanation]);
}

// ---------------------------------------------------------------------------
// S6021: 1-Based KerML Sequence Index Out of Bounds (`seq#(idx)`)
// ---------------------------------------------------------------------------

export function evalSequenceIndexInterval(
  db: QueryDB,
  exprNode: SysmlCstNode,
  ownerSym: SymbolEntry,
  scopeId: number | null,
): NumericalInterval {
  const direct = evalCstInterval(db, exprNode, scopeId);
  if (!direct.isBottom() && !direct.isTop()) return direct;

  // Unwrap single-child SequenceExpression / OwnedExpression wrappers
  let cur: SysmlCstNode | null | undefined = exprNode;
  while (
    cur &&
    (cur.type === "SequenceExpression" ||
      cur.type === "OwnedExpression" ||
      cur.type === "OwnedExpressionMember" ||
      cur.type === "OwnedExpressionReference")
  ) {
    const chs: SysmlCstNode[] = getCstChildren(cur).filter((c) => c.type !== "(" && c.type !== ")" && c.type !== ",");
    if (chs.length === 1) cur = chs[0]!;
    else break;
  }
  if (!cur) return NumericalInterval.TOP;

  // Support simple additive offset `v + c` / `v - c` over a bounded index variable `v`
  if (cur.type === "AdditiveExpression") {
    const ops = (cur.childrenForFieldName?.("operator") ?? []).map((o) => o.text.trim());
    const operands = cur.childrenForFieldName?.("operand") ?? [];
    if (operands.length === 2 && ops.length === 1) {
      const lhsIv = evalSequenceIndexInterval(db, operands[0]!, ownerSym, scopeId);
      const rhsIv = evalSequenceIndexInterval(db, operands[1]!, ownerSym, scopeId);
      if (!lhsIv.isTop() && !rhsIv.isTop()) {
        return ops[0] === "+" ? lhsIv.add(rhsIv) : lhsIv.sub(rhsIv);
      }
    }
  }

  const varName = cur.text.trim();
  if (!isSysmlIdentLeaf(varName)) return NumericalInterval.TOP;

  // Check assume / assert linear constraints in `ownerSym` and its enclosing container constraining `varName`
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  const candidateScopes: SymbolEntry[] = [ownerSym];
  if (ownerSym.parentId !== null) {
    const parentSym = db.symbol(ownerSym.parentId);
    if (parentSym) candidateScopes.push(parentSym);
  }

  for (const scopeSym of candidateScopes) {
    for (const ch of db.childrenOf(scopeSym.id)) {
      if (
        ch.ruleName !== "RequirementConstraintUsage" &&
        ch.ruleName !== "AssertConstraintUsage" &&
        ch.ruleName !== "ConstraintUsage"
      ) {
        continue;
      }
      const atoms = extractLinearAtomsFromConstraintSymbol(db, ch, new Set(), scopeSym.id);
      for (const at of atoms) {
        if (at.terms.length !== 1 || at.terms[0]!.varName !== varName) continue;
        const coeff = at.terms[0]!.coeff;
        if (Math.abs(coeff) <= 1e-12) continue;
        const bound = at.rhs / coeff;
        const effOp =
          coeff > 0
            ? at.operator
            : at.operator === "<="
              ? ">="
              : at.operator === "<"
                ? ">"
                : at.operator === ">="
                  ? "<="
                  : at.operator === ">"
                    ? "<"
                    : "==";
        if (effOp === "==") {
          lo = Math.max(lo, bound);
          hi = Math.min(hi, bound);
        } else if (effOp === ">=") {
          lo = Math.max(lo, bound);
        } else if (effOp === ">") {
          lo = Math.max(lo, Number.isInteger(bound) ? bound + 1 : bound + 1e-6);
        } else if (effOp === "<=") {
          hi = Math.min(hi, bound);
        } else if (effOp === "<") {
          hi = Math.min(hi, Number.isInteger(bound) ? bound - 1 : bound - 1e-6);
        }
      }
    }
  }
  if (lo <= hi && (Number.isFinite(lo) || Number.isFinite(hi))) {
    return new NumericalInterval(lo, hi);
  }

  // Fallback: `in` parameter with explicit `default = val`
  const feat = resolveFeatureInScope(db, scopeId, varName);
  if (feat) {
    const val = getFeatureValue(db, feat, feat.parentId ?? scopeId);
    if (typeof val === "number" && Number.isFinite(val)) {
      return new NumericalInterval(val, val);
    }
  }

  return NumericalInterval.TOP;
}

export function resolveSequenceMultiplicity(db: QueryDB, seqSym: SymbolEntry | null): ParsedMultiplicity | null {
  let cur = seqSym;
  const visited = new Set<number>();
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    const mult = parseExplicitMultiplicity(db, cur);
    if (mult) return mult;
    const specs = extractSpecializationClauses(db, cur);
    if (specs.length === 0) break;
    cur = resolveSpecializationTarget(db, cur, specs[0]!.targetPath, specs[0]!.ruleName);
  }
  return null;
}
