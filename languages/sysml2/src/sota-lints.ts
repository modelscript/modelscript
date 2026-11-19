// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — SOTA KerML/SysML v2 Static & Live Formal Verification Lints.
 *
 * Implements:
 *   - S2007–S2012: SOTA Scoping, Visibility, Import Hygiene, Unused Private/Import & Specialization Shadowing
 *   - S3010–S3018: Polyglot-Aware Usage/Definition Kind Conformance, Disjoint Classifiers,
 *                  Redefinition Type/Multiplicity/Modifier Conformance, Invocations, Triggers & Disjoint Casts
 *   - S4014–S4026: Variation/Variant Rules, Composite/End/Constant Modifiers, Parallel States,
 *                  Singleton Members, Send-Via-Port, Interface Ends, Binary Bindings, INCOSE GtWR,
 *                  Individual/Portion Semantics & Metadata Annotation Validation
 *   - S6001–S6042: Sub-10ms Live Formal Verification Lints (Assume-Guarantee Liskov Refinement,
 *                  Vacuous Assumptions, Requirement Decomposition Gap with Craig Interpolation,
 *                  Opaque Port Interface Compatibility, Zero-Dwell Zeno Chattering Cycles,
 *                  Orthogonal Region Write Races, Abstract Interpretation Domain/Div-By-Zero,
 *                  1-Based Sequence Index Bounds, Physical Domain Impossibility, Scalar Equation Balance,
 *                  Flow Network Driver Conflicts & Conservation, Cyber-Physical Nyquist Stability,
 *                  Multiplicity Roll-Up & 3D RCC-8 Spatial Envelope Clash/Protrusion)
 */

import type { CSTNode, LintRangeOptions, LintResult } from "@modelscript/dsl";
import {
  CausalizationTheoryOracle,
  computeRcc8Relation,
  CraigInterpolator,
  DpllTSolver,
  FlowAlgebraOracle,
  Interval,
  isTypeLikeSymbol,
  NumericalInterval,
  SpatialPhysicsOracle,
  type CadBoundingBox,
  type LinearConstraint as CraigLinearConstraint,
  type NonlinearConstraint,
  type QueryDB,
  type SymbolEntry,
} from "@modelscript/runtime";
import { KERML_STDLIB_URI } from "../src-gen/kerml-snapshot.js";
import {
  collapseWhitespace,
  collectCstLeaves,
  findCstDescendants,
  findFirstDescendant,
  getCstChildren,
  isSysmlIdentLeaf,
  parseSignedNumberFromLeaves,
  parseSysmlSource,
  readDottedChainFromLeaves,
  sliceBetweenLeaves,
  stripLeadingTilde,
  stripNamespaceWildcard,
  type CstLeaf,
  type SysmlCstNode,
} from "./cst-utils.js";
import { createSysML2Diagnostic, SysML2ErrorCode, type ErrorCodeDef } from "./errors.js";
import { isGuardTautologicallyFalse } from "./lints.js";
import {
  collectEffectiveSubjectAttributes,
  evaluateConstraintBody,
  evaluateExpressionNode,
  findRelationshipsTargeting,
  getConstraintKind,
  getFeatureValue,
  getRelationshipTargetName,
  metaStr,
  resolveFeatureInScope,
  resolveTypeOf,
} from "./queries.js";
import {
  parseLinearExpression,
  RealSimplexSolver,
  type LinearConstraint as SimplexLinearConstraint,
} from "./real-simplex.js";
import { checkGuardsMutuallyExclusive, parseGuardConstraints } from "./state-machine-verifier.js";
import {
  inferExpressionType,
  isStdlibOrBuiltinSymbol,
  isTypeAssignable,
  normalizeTypeName,
  resolvePathInScope,
} from "./type-checker.js";

export type SysML2LintFn = (db: QueryDB, self: SymbolEntry) => LintResult | LintResult[] | null;

// ---------------------------------------------------------------------------
// Zero-Reparse CST & Narrow Diagnostic Span Helpers
// ---------------------------------------------------------------------------

function cstHasError(node: SysmlCstNode | null | undefined): boolean {
  if (!node) return false;
  if (typeof node.hasError === "function") return Boolean(node.hasError());
  return Boolean(node.hasError);
}

function getSymbolCst(db: QueryDB, entry: SymbolEntry): { node: SysmlCstNode | null; baseOffset: number } {
  const direct = db.cstNode(entry.id) as SysmlCstNode | null | undefined;
  if (direct) {
    return { node: direct, baseOffset: 0 };
  }
  const text = db.cstText(entry.startOffset, entry.endOffset, entry);
  if (text) {
    const parsed = parseSysmlSource(text);
    if (parsed) return { node: parsed, baseOffset: entry.startOffset };
  }
  return { node: null, baseOffset: 0 };
}

function getSymbolLeavesFast(db: QueryDB, entry: SymbolEntry): { leaves: CstLeaf[]; baseOffset: number } {
  const { node, baseOffset } = getSymbolCst(db, entry);
  if (!node) return { leaves: [], baseOffset: 0 };
  return { leaves: collectCstLeaves(node), baseOffset };
}

function getNodeOffsets(node: SysmlCstNode, baseOffset = 0): { startOffset: number; endOffset: number } | null {
  const rawStart = node.startIndex ?? node.startOffset;
  const rawEnd = node.endIndex ?? node.endOffset;
  if (typeof rawStart === "number" && typeof rawEnd === "number" && rawEnd > rawStart) {
    return { startOffset: baseOffset + rawStart, endOffset: baseOffset + rawEnd };
  }
  return null;
}

function clampSingleLineSpan(
  db: QueryDB,
  owner: SymbolEntry,
  startOffset: number,
  endOffset: number,
): { startOffset: number; endOffset: number } {
  if (endOffset <= startOffset) {
    return { startOffset, endOffset: Math.max(startOffset + 1, endOffset) };
  }
  if (endOffset - startOffset <= 80) {
    const slice = db.cstText(startOffset, endOffset, owner);
    if (!slice || (!slice.includes("\n") && !slice.includes("{"))) {
      return { startOffset, endOffset };
    }
  }
  const probeEnd = Math.min(endOffset, startOffset + 160);
  const head = db.cstText(startOffset, probeEnd, owner);
  if (head) {
    let cut = head.length;
    const nl = head.indexOf("\n");
    if (nl > 0 && nl < cut) cut = nl;
    const brace = head.indexOf("{");
    if (brace > 0 && brace < cut) cut = brace;
    while (cut > 1 && (head[cut - 1] === " " || head[cut - 1] === "\t" || head[cut - 1] === "\r")) {
      cut--;
    }
    if (cut > 0) {
      return { startOffset, endOffset: startOffset + cut };
    }
  }
  return { startOffset, endOffset: Math.min(endOffset, startOffset + 32) };
}

/**
 * Computes a narrow, single-token or header-level diagnostic byte span,
 * never emitting full multi-line block ranges.
 */
export function narrowDiagnosticRange(
  db: QueryDB,
  self: SymbolEntry,
  target?: SymbolEntry | { node: SysmlCstNode; baseOffset?: number | undefined } | LintRangeOptions | null,
): LintRangeOptions {
  if (target && "id" in target) {
    const nameRange =
      target.fieldRanges?.["declaredName"] ?? target.fieldRanges?.["name"] ?? target.fieldRanges?.["memberName"];
    if (nameRange && nameRange.endOffset > nameRange.startOffset) {
      return { startOffset: nameRange.startOffset, endOffset: nameRange.endOffset };
    }
    const clamped = clampSingleLineSpan(db, target, target.startOffset, target.endOffset);
    return clamped;
  }

  if (target && "node" in target) {
    const offs = getNodeOffsets(target.node, target.baseOffset ?? 0);
    if (offs) {
      return clampSingleLineSpan(db, self, offs.startOffset, offs.endOffset);
    }
  }

  if (
    target &&
    "startOffset" in target &&
    typeof target.startOffset === "number" &&
    typeof target.endOffset === "number" &&
    target.endOffset > target.startOffset
  ) {
    return clampSingleLineSpan(db, self, target.startOffset, target.endOffset);
  }

  const selfFieldRange =
    self.fieldRanges?.["declaredName"] ?? self.fieldRanges?.["name"] ?? self.fieldRanges?.["memberName"];
  if (selfFieldRange && selfFieldRange.endOffset > selfFieldRange.startOffset) {
    return {
      field: "declaredName",
      startOffset: selfFieldRange.startOffset,
      endOffset: selfFieldRange.endOffset,
    };
  }

  const { node, baseOffset } = getSymbolCst(db, self);
  if (node) {
    const children = getCstChildren(node);
    for (const ch of children) {
      if (ch.type === "{" || ch.text === "{") break;
      const idNode = ch.type === "Name" || ch.type === "ID" ? ch : findFirstDescendant(ch, "Name");
      if (idNode) {
        const offs = getNodeOffsets(idNode, baseOffset);
        if (offs) return offs;
      }
    }
    const leaves = collectCstLeaves(node);
    if (leaves.length > 0) {
      const nameLeaf = leaves.find((l) => l.text === self.name) ?? leaves[0]!;
      if (nameLeaf.end > nameLeaf.start) {
        return { startOffset: baseOffset + nameLeaf.start, endOffset: baseOffset + nameLeaf.end };
      }
    }
  }

  return clampSingleLineSpan(db, self, self.startOffset, self.endOffset);
}

function emitDiag<TArgs extends readonly unknown[]>(
  db: QueryDB,
  self: SymbolEntry,
  def: ErrorCodeDef<TArgs>,
  args: TArgs,
  target?: SymbolEntry | { node: SysmlCstNode; baseOffset?: number | undefined } | LintRangeOptions | null,
): LintResult {
  return createSysML2Diagnostic(def, args, narrowDiagnosticRange(db, self, target));
}

function isTruthyMeta(entry: SymbolEntry, key: string): boolean {
  const raw = entry.metadata?.[key];
  if (raw === true) return true;
  if (typeof raw === "string") {
    const clean = raw.trim().toLowerCase();
    return clean === "true" || clean === key.toLowerCase() || (clean.length > 0 && clean !== "false");
  }
  return false;
}

function getHeaderLeavesBeforeBody(db: QueryDB, entry: SymbolEntry): { leaves: CstLeaf[]; baseOffset: number } {
  const { leaves, baseOffset } = getSymbolLeavesFast(db, entry);
  const out: CstLeaf[] = [];
  for (const lf of leaves) {
    if (lf.text === "{" || lf.text === ";" || lf.text === "=" || lf.text === ":=") break;
    out.push(lf);
  }
  return { leaves: out, baseOffset };
}

function hasHeaderKeyword(db: QueryDB, entry: SymbolEntry, keyword: string): boolean {
  const { leaves } = getHeaderLeavesBeforeBody(db, entry);
  return leaves.some((l) => l.text === keyword);
}

function getFeatureDeclaredTypeRaw(db: QueryDB, entry: SymbolEntry): { raw: string; refChild?: SymbolEntry } | null {
  for (const child of db.childrenOf(entry.id)) {
    if ((child.ruleName === "OwnedFeatureTyping" || child.ruleName === "ConjugatedPortTyping") && child.name) {
      return { raw: stripLeadingTilde(child.name), refChild: child };
    }
  }
  if (entry.metadata?.["typeSpecifier"]) {
    return { raw: stripLeadingTilde(String(entry.metadata["typeSpecifier"])) };
  }
  return null;
}

function isSysmlLanguageSymbol(entry: SymbolEntry): boolean {
  if (!entry.language) return true;
  const lower = entry.language.toLowerCase();
  return lower === "sysml2" || lower === "sysml" || lower === "kerml";
}

function isDeclarationEntry(entry: SymbolEntry): boolean {
  return entry.kind !== "Reference" && entry.kind !== "Specialization" && entry.kind !== "Import";
}

// ---------------------------------------------------------------------------
// Inherited / Enclosing Scope Feature Resolution (S2007, S3012, S3013, S3014)
// ---------------------------------------------------------------------------

const EXCLUDED_REFERENCE_SUBSETTING_OWNERS = new Set<string>([
  "SatisfyRequirementUsage",
  "VerifyRequirementUsage",
  "AllocationUsage",
  "AllocateUsage",
  "ConnectionUsage",
  "BindingConnectorAsUsage",
  "SuccessionAsUsage",
  "FlowUsage",
  "SuccessionFlowUsage",
  "InterfaceUsage",
  "PerformActionUsage",
  "ExhibitStateUsage",
  "IncludeUseCaseUsage",
  "AssertConstraintUsage",
  "RequirementConstraintUsage",
  "TransitionUsage",
  "AcceptActionNode",
  "SendActionNode",
  "ConnectorEnd",
  "FlowEnd",
  "MetadataUsage",
  "PrefixMetadataUsage",
]);

function resolveTypeOrClassifierByName(db: QueryDB, scopeId: number | null, rawName: string): SymbolEntry | null {
  const clean = stripLeadingTilde(rawName).trim();
  if (!clean || clean === "<anonymous>") return null;
  const scoped = resolvePathInScope(db, scopeId, clean) ?? resolveFeatureInScope(db, scopeId, clean);
  if (scoped && isDeclarationEntry(scoped)) return scoped;
  const short = normalizeTypeName(clean);
  const cands = db.byName(short);
  return cands.find((c) => isTypeLikeSymbol(c)) ?? cands.find(isDeclarationEntry) ?? null;
}

/**
 * Returns true if `owner` (or any supertype in its inheritance/typing chain) explicitly
 * references a built-in KerML/SysML stdlib type or an unresolved external base, in which
 * case inherited features of that base may legitimately live outside the user SymbolIndex.
 */
function hasExternalOrStdlibBaseInHierarchy(
  db: QueryDB,
  owner: SymbolEntry | undefined,
  visited = new Set<number>(),
): boolean {
  if (!owner || visited.has(owner.id)) return false;
  visited.add(owner.id);

  if (owner.ruleName === "MetadataUsage" || owner.ruleName === "PrefixMetadataUsage") {
    const metaRef = db.childrenOf(owner.id).find((c) => c.ruleName === "MetadataTyping");
    const rawMeta = (
      metaRef?.name ||
      (metaRef ? db.cstText(metaRef.startOffset, metaRef.endOffset, metaRef) : "") ||
      ""
    ).trim();
    if (!rawMeta || isStdlibOrBuiltinSymbol(rawMeta)) return true;
    const metaDef = db.byName(normalizeTypeName(rawMeta)).find((s) => s.ruleName === "MetadataDefinition");
    if (!metaDef) return true;
    return hasExternalOrStdlibBaseInHierarchy(db, metaDef, visited);
  }

  for (const child of db.childrenOf(owner.id)) {
    if (
      child.ruleName === "OwnedSubclassification" ||
      child.ruleName === "Subclassification" ||
      child.ruleName === "OwnedFeatureTyping" ||
      child.ruleName === "ConjugatedPortTyping" ||
      child.ruleName === "OwnedSubsetting" ||
      child.ruleName === "OwnedRedefinition" ||
      child.ruleName === "OwnedReferenceSubsetting"
    ) {
      const raw = stripLeadingTilde((child.name || db.cstText(child.startOffset, child.endOffset, child) || "").trim());
      if (!raw || raw === "<anonymous>") continue;
      if (isStdlibOrBuiltinSymbol(raw)) return true;
      const target = resolveTypeOrClassifierByName(db, owner.parentId, raw);
      if (!target) return true;
      if (!isSysmlLanguageSymbol(target)) return true;
      if (hasExternalOrStdlibBaseInHierarchy(db, target, visited)) return true;
    }
  }

  if (owner.ruleName === "SatisfyRequirementUsage" || owner.ruleName === "VerifyRequirementUsage") {
    const reqName = getRelationshipTargetName(db, owner);
    if (!reqName || isStdlibOrBuiltinSymbol(reqName)) return true;
    const reqSym = db
      .byName(reqName)
      .find((s) => s.ruleName === "RequirementDefinition" || s.ruleName === "RequirementUsage");
    if (!reqSym) return true;
    if (hasExternalOrStdlibBaseInHierarchy(db, reqSym, visited)) return true;
  }

  return false;
}

function findInheritedMemberOnSymbol(
  db: QueryDB,
  container: SymbolEntry,
  memberName: string,
  excludeId: number,
  visited = new Set<number>(),
): SymbolEntry | null {
  if (visited.has(container.id)) return null;
  visited.add(container.id);

  for (const child of db.childrenOf(container.id)) {
    if (child.id === excludeId || !isDeclarationEntry(child)) continue;
    if (child.name === memberName) return child;
    for (const sub of db.childrenOf(child.id)) {
      if ((sub.ruleName === "OwnedRedefinition" || sub.ruleName === "OwnedSubsetting") && sub.name) {
        const last = sub.name.split("::").pop()?.split(".").pop()?.trim();
        if (last === memberName) return child;
      }
    }
  }

  if (container.ruleName === "MetadataUsage") {
    const metaRef = db.childrenOf(container.id).find((c) => c.ruleName === "MetadataTyping");
    const rawMeta = (
      metaRef?.name ||
      (metaRef ? db.cstText(metaRef.startOffset, metaRef.endOffset, metaRef) : "") ||
      ""
    ).trim();
    if (rawMeta) {
      const metaDef = db.byName(normalizeTypeName(rawMeta)).find((s) => s.ruleName === "MetadataDefinition");
      if (metaDef) {
        const hit = findInheritedMemberOnSymbol(db, metaDef, memberName, excludeId, visited);
        if (hit) return hit;
      }
    }
  }

  if (container.ruleName === "SatisfyRequirementUsage" || container.ruleName === "VerifyRequirementUsage") {
    const reqName = getRelationshipTargetName(db, container);
    if (reqName) {
      const reqSym = db
        .byName(reqName)
        .find((s) => s.ruleName === "RequirementDefinition" || s.ruleName === "RequirementUsage");
      if (reqSym) {
        const hit = findInheritedMemberOnSymbol(db, reqSym, memberName, excludeId, visited);
        if (hit) return hit;
      }
    }
  }

  for (const child of db.childrenOf(container.id)) {
    if (
      child.ruleName === "OwnedSubclassification" ||
      child.ruleName === "Subclassification" ||
      child.ruleName === "OwnedFeatureTyping" ||
      child.ruleName === "ConjugatedPortTyping" ||
      child.ruleName === "OwnedSubsetting" ||
      child.ruleName === "OwnedRedefinition" ||
      child.ruleName === "OwnedReferenceSubsetting"
    ) {
      const raw = stripLeadingTilde((child.name || db.cstText(child.startOffset, child.endOffset, child) || "").trim());
      if (!raw || raw === "<anonymous>") continue;
      const baseSym = resolveTypeOrClassifierByName(db, container.parentId, raw);
      if (baseSym) {
        const hit = findInheritedMemberOnSymbol(db, baseSym, memberName, excludeId, visited);
        if (hit) return hit;
        const baseType = resolveTypeOf(db, baseSym);
        if (baseType) {
          const typeHit = findInheritedMemberOnSymbol(db, baseType, memberName, excludeId, visited);
          if (typeHit) return typeHit;
        }
      }
    }
  }

  return null;
}

function resolveSpecializationTarget(
  db: QueryDB,
  self: SymbolEntry,
  targetPath: string,
  specRule: string,
): SymbolEntry | null {
  const clean = targetPath.trim();
  if (!clean) return null;

  const parentSym = self.parentId !== null ? db.symbol(self.parentId) : undefined;

  // 1. Dotted feature chain: e.g. `engine.power` or `subPart.portA`
  if (clean.includes(".")) {
    const segments = clean
      .split(".")
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) return null;
    let curr = resolveSpecializationTarget(db, self, segments[0]!, specRule);
    if (!curr) return null;
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i]!;
      const next = findInheritedMemberOnSymbol(db, curr, seg, self.id);
      if (!next) return null;
      curr = next;
    }
    return curr;
  }

  // 2. Qualified path `Pkg::Classifier::feature`
  if (clean.includes("::")) {
    const resolved = resolvePathInScope(db, self.parentId, clean) ?? resolveFeatureInScope(db, self.parentId, clean);
    if (resolved && resolved.id !== self.id && isDeclarationEntry(resolved)) return resolved;
    return null;
  }

  // 3. For `:>>` (`OwnedRedefinition`), prioritize inherited members of enclosing classifier/usage first
  if (parentSym) {
    if (specRule === "OwnedRedefinition") {
      // Search supertypes / typed definitions of parent first (skipping direct sibling with self.id)
      for (const rel of db.childrenOf(parentSym.id)) {
        if (
          rel.ruleName === "OwnedSubclassification" ||
          rel.ruleName === "Subclassification" ||
          rel.ruleName === "OwnedFeatureTyping" ||
          rel.ruleName === "ConjugatedPortTyping" ||
          rel.ruleName === "OwnedSubsetting" ||
          rel.ruleName === "OwnedRedefinition" ||
          rel.ruleName === "OwnedReferenceSubsetting" ||
          rel.ruleName === "MetadataTyping"
        ) {
          const raw = stripLeadingTilde((rel.name || db.cstText(rel.startOffset, rel.endOffset, rel) || "").trim());
          if (!raw) continue;
          const baseSym = resolveTypeOrClassifierByName(db, parentSym.parentId, raw);
          if (baseSym) {
            const hit = findInheritedMemberOnSymbol(db, baseSym, clean, self.id);
            if (hit) return hit;
          }
        }
      }
      if (parentSym.ruleName === "SatisfyRequirementUsage" || parentSym.ruleName === "VerifyRequirementUsage") {
        const hit = findInheritedMemberOnSymbol(db, parentSym, clean, self.id);
        if (hit) return hit;
      }
    }

    // Search enclosing parent + its inheritance chain (excluding `self.id`)
    const inParent = findInheritedMemberOnSymbol(db, parentSym, clean, self.id);
    if (inParent) return inParent;
  }

  // 4. Walk lexical outer scopes (excluding `self.id`)
  let scopeId = parentSym?.parentId ?? null;
  while (scopeId !== null) {
    const scopeSym = db.symbol(scopeId);
    if (!scopeSym) break;
    const hit = findInheritedMemberOnSymbol(db, scopeSym, clean, self.id);
    if (hit) return hit;
    scopeId = scopeSym.parentId;
  }

  // 5. Fallback via general scope/import lookup (if not resolving to `self`)
  const fallback = resolveFeatureInScope(db, self.parentId, clean);
  if (fallback && fallback.id !== self.id && isDeclarationEntry(fallback)) {
    return fallback;
  }

  return null;
}

interface SpecializationClauseInfo {
  ruleName:
    | "OwnedRedefinition"
    | "OwnedSubsetting"
    | "OwnedReferenceSubsetting"
    | "OwnedCrossSubsetting"
    | "AliasMember";
  kindLabel: string;
  targetPath: string;
  range: LintRangeOptions;
}

function extractSpecializationClauses(db: QueryDB, self: SymbolEntry): SpecializationClauseInfo[] {
  const clauses: SpecializationClauseInfo[] = [];

  if (self.ruleName === "AliasMember" || self.kind === "Alias") {
    const { leaves, baseOffset } = getSymbolLeavesFast(db, self);
    const forIdx = leaves.findIndex((l) => l.text === "for");
    if (forIdx !== -1) {
      const chain = readDottedChainFromLeaves(leaves, forIdx + 1);
      if (chain) {
        const firstLeaf = leaves[forIdx + 1]!;
        const lastLeaf = leaves[chain.nextIdx - 1]!;
        clauses.push({
          ruleName: "AliasMember",
          kindLabel: "alias",
          targetPath: chain.text,
          range: { startOffset: baseOffset + firstLeaf.start, endOffset: baseOffset + lastLeaf.end },
        });
      }
    }
    return clauses;
  }

  const seenKeys = new Set<string>();
  const kindLabelOf = (
    r: "OwnedRedefinition" | "OwnedSubsetting" | "OwnedReferenceSubsetting" | "OwnedCrossSubsetting",
  ): string => {
    switch (r) {
      case "OwnedRedefinition":
        return "redefinition";
      case "OwnedSubsetting":
        return "subsetting";
      case "OwnedReferenceSubsetting":
        return "reference subsetting";
      case "OwnedCrossSubsetting":
        return "cross subsetting";
    }
  };

  for (const child of db.childrenOf(self.id)) {
    if (
      child.ruleName === "OwnedRedefinition" ||
      child.ruleName === "OwnedSubsetting" ||
      child.ruleName === "OwnedReferenceSubsetting" ||
      child.ruleName === "OwnedCrossSubsetting"
    ) {
      if (child.ruleName === "OwnedReferenceSubsetting" && EXCLUDED_REFERENCE_SUBSETTING_OWNERS.has(self.ruleName)) {
        continue;
      }
      const chainParts = db
        .childrenOf(child.id)
        .filter((c) => c.ruleName === "OwnedFeatureChaining" && c.name)
        .map((c) => c.name.trim());
      const rawText =
        chainParts.length > 0
          ? chainParts.join(".")
          : (child.name || db.cstText(child.startOffset, child.endOffset, child) || "").trim();
      if (!rawText || rawText === "<anonymous>" || rawText === child.ruleName) continue;
      const key = `${child.ruleName}:${rawText}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      clauses.push({
        ruleName: child.ruleName,
        kindLabel: kindLabelOf(child.ruleName),
        targetPath: rawText,
        range: narrowDiagnosticRange(db, self, child),
      });
    }
  }

  // CST header scan for OwnedFeatureChain specializations (`:>> a.b`, `:> a.b`, `=> a.b`) where ref was nested
  const { leaves, baseOffset } = getHeaderLeavesBeforeBody(db, self);
  for (let i = 0; i < leaves.length; i++) {
    const tok = leaves[i]!.text;
    let ruleName: "OwnedRedefinition" | "OwnedSubsetting" | "OwnedReferenceSubsetting" | "OwnedCrossSubsetting" | null =
      null;
    if (tok === ":>>" || tok === "redefines" || tok === "redefine") {
      ruleName = "OwnedRedefinition";
    } else if ((tok === ":>" || tok === "subsets" || tok === "subset") && self.kind === "Usage") {
      ruleName = "OwnedSubsetting";
    } else if (
      (tok === "::>" || tok === "references" || tok === "reference") &&
      !EXCLUDED_REFERENCE_SUBSETTING_OWNERS.has(self.ruleName)
    ) {
      ruleName = "OwnedReferenceSubsetting";
    } else if (tok === "=>" || tok === "crosses") {
      ruleName = "OwnedCrossSubsetting";
    }
    if (!ruleName) continue;

    let k = i + 1;
    while (k < leaves.length) {
      const chain = readDottedChainFromLeaves(leaves, k);
      if (!chain) break;
      const key = `${ruleName}:${chain.text}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        const startLf = leaves[k]!;
        const endLf = leaves[chain.nextIdx - 1]!;
        clauses.push({
          ruleName,
          kindLabel: kindLabelOf(ruleName),
          targetPath: chain.text,
          range: { startOffset: baseOffset + startLf.start, endOffset: baseOffset + endLf.end },
        });
      }
      if (leaves[chain.nextIdx]?.text === ",") {
        k = chain.nextIdx + 1;
      } else {
        break;
      }
    }
  }

  return clauses;
}

interface ParsedMultiplicity {
  lower: number;
  upper: number;
  label: string;
}

function parseExplicitMultiplicity(db: QueryDB, entry: SymbolEntry): ParsedMultiplicity | null {
  let lowerStr = metaStr(entry, "multiplicityLower")?.trim() ?? "";
  let upperStr = metaStr(entry, "multiplicityUpper")?.trim() ?? "";

  if (!lowerStr) {
    const { node } = getSymbolCst(db, entry);
    if (node) {
      for (const ch of getCstChildren(node)) {
        if (ch.type === "{" || ch.text === "{") break;
        const multRange = ch.type === "MultiplicityRange" ? ch : findFirstDescendant(ch, "MultiplicityRange");
        if (multRange) {
          const lbNode = multRange.childForFieldName?.("lowerBound");
          const ubNode = multRange.childForFieldName?.("upperBound");
          if (lbNode) lowerStr = lbNode.text.trim();
          if (ubNode) upperStr = ubNode.text.trim();
          break;
        }
      }
    }
  }

  if (!lowerStr) return null;

  if (lowerStr === "*" && !upperStr) {
    return { lower: 0, upper: Infinity, label: "*" };
  }

  const parseBoundVal = (s: string): number => {
    const clean = s.trim();
    if (clean === "*" || clean === "Infinity") return Infinity;
    const num = Number(clean);
    return Number.isFinite(num) && Number.isInteger(num) && num >= 0 ? num : NaN;
  };

  const lower = parseBoundVal(lowerStr);
  const upper = upperStr ? parseBoundVal(upperStr) : lower;
  if (Number.isNaN(lower) || Number.isNaN(upper) || lower === Infinity || lower > upper) {
    return null;
  }

  const label = upperStr ? `${lowerStr}..${upperStr}` : lowerStr;
  return { lower, upper, label };
}

function hasFeatureValueInfo(
  db: QueryDB,
  entry: SymbolEntry,
): { hasValue: boolean; isInitialMutable: boolean; isDefault: boolean } {
  const { node } = getSymbolCst(db, entry);
  if (node) {
    for (const ch of getCstChildren(node)) {
      if (ch.type === "{" || ch.text === "{") break;
      const fv = ch.type === "FeatureValue" ? ch : findFirstDescendant(ch, "FeatureValue");
      if (fv) {
        const fvLeaves = collectCstLeaves(fv);
        const isInitialMutable = fvLeaves.some((l) => l.text === ":=");
        const isDefault = fvLeaves.some((l) => l.text === "default");
        return { hasValue: true, isInitialMutable, isDefault };
      }
    }
  }
  const { leaves } = getSymbolLeavesFast(db, entry);
  for (const lf of leaves) {
    if (lf.text === "{") break;
    if (lf.text === ":=") return { hasValue: true, isInitialMutable: true, isDefault: false };
    if (lf.text === "=") {
      const isDefault = leaves.some((p) => p.end <= lf.start && p.text === "default");
      return { hasValue: true, isInitialMutable: false, isDefault };
    }
  }
  return { hasValue: false, isInitialMutable: false, isDefault: false };
}

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

function extractDeclaredVisibility(db: QueryDB, entry: SymbolEntry): "public" | "private" | "protected" | null {
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

const NON_SHADOWING_USAGE_RULES = new Set<string>([
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

function hasExplicitRedefinition(db: QueryDB, usage: SymbolEntry): boolean {
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

type MetaClassifierFamily = "datatype" | "structural" | "port" | "behavioral";

function getClassifierFamily(ruleName: string): MetaClassifierFamily | null {
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

function areClassifierFamiliesDisjoint(subFam: MetaClassifierFamily, supFam: MetaClassifierFamily): boolean {
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

// ---------------------------------------------------------------------------
// S3015 & S3016: Invocations & Trigger / Guard / Filter Expressions
// ---------------------------------------------------------------------------

function collectOwnExpressionSubtrees(
  db: QueryDB,
  self: SymbolEntry,
  cst: SysmlCstNode,
  baseOffset: number,
  targetTypes: ReadonlySet<string>,
): SysmlCstNode[] {
  const childSymbolSpans: Array<{ start: number; end: number }> = [];
  for (const ch of db.childrenOf(self.id)) {
    if (ch.kind === "Usage" || ch.kind === "Definition" || ch.kind === "Package" || ch.kind === "Enumeration") {
      if (ch.startOffset > self.startOffset || ch.endOffset < self.endOffset) {
        childSymbolSpans.push({ start: ch.startOffset, end: ch.endOffset });
      }
    }
  }

  const results: SysmlCstNode[] = [];
  const walk = (n: SysmlCstNode) => {
    const offs = getNodeOffsets(n, baseOffset);
    if (offs && n !== cst) {
      for (const sp of childSymbolSpans) {
        if (offs.startOffset >= sp.start && offs.endOffset <= sp.end) {
          return;
        }
      }
    }
    if (targetTypes.has(n.type)) {
      results.push(n);
    }
    for (const c of getCstChildren(n)) {
      walk(c);
    }
  };
  walk(cst);
  return results;
}

function isParameterMemberChild(db: QueryDB, ownerSym: SymbolEntry, paramSym: SymbolEntry): boolean {
  const paramCst = db.cstNode(paramSym.id) as SysmlCstNode | null | undefined;
  if (paramCst?.parent?.type === "ParameterMember") return true;
  // Also check if paramSym offset falls inside `( ... )` header before `{` of ownerSym
  const { leaves, baseOffset } = getSymbolLeavesFast(db, ownerSym);
  let inParamList = false;
  for (const lf of leaves) {
    if (lf.text === "{") break;
    if (lf.text === "(") inParamList = true;
    else if (lf.text === ")") inParamList = false;
    else if (
      inParamList &&
      baseOffset + lf.start >= paramSym.startOffset &&
      baseOffset + lf.end <= paramSym.endOffset
    ) {
      return true;
    }
  }
  return false;
}

function collectInputParameters(db: QueryDB, calleeSym: SymbolEntry): SymbolEntry[] {
  const params: SymbolEntry[] = [];
  const seenNames = new Set<string>();

  const collectFrom = (sym: SymbolEntry, visited: Set<number>) => {
    if (visited.has(sym.id)) return;
    visited.add(sym.id);

    // Inherited parameters first
    for (const ch of db.childrenOf(sym.id)) {
      if ((ch.ruleName === "OwnedSubclassification" || ch.ruleName === "OwnedFeatureTyping") && ch.name) {
        if (isStdlibOrBuiltinSymbol(ch.name)) continue;
        const sup = resolveTypeOrClassifierByName(db, sym.parentId, ch.name);
        if (sup && isSysmlLanguageSymbol(sup)) collectFrom(sup, visited);
      }
    }

    for (const ch of db.childrenOf(sym.id)) {
      if (ch.kind !== "Usage") continue;
      if (ch.ruleName === "ReturnParameterMember" || ch.name === "return") continue;
      const dir = metaStr(ch, "direction");
      if (dir === "out") continue;
      if (dir === "in" || dir === "inout" || isParameterMemberChild(db, sym, ch)) {
        const key = ch.name || `param_${ch.id}`;
        if (!seenNames.has(key)) {
          seenNames.add(key);
          params.push(ch);
        }
      }
    }
  };

  collectFrom(calleeSym, new Set<number>());
  return params;
}

function unwrapArgOwnedExpr(node: SysmlCstNode | null | undefined): SysmlCstNode | null {
  if (!node) return null;
  if (node.type === "OwnedExpression") return node;
  for (const ch of getCstChildren(node)) {
    if (ch.type === "OwnedExpression") return ch;
    if (ch.type === "Argument" || ch.type === "ArgumentValue") {
      const inner = unwrapArgOwnedExpr(ch);
      if (inner) return inner;
    }
  }
  return findFirstDescendant(node, "OwnedExpression");
}

/**
 * Validates S3015 (`invocation-signature-mismatch`) and S3016 (`trigger-expression-type-mismatch`).
 */
export function checkInvocationAndTriggers(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  const { node: cst, baseOffset } = getSymbolCst(db, self);
  if (!cst || cstHasError(cst)) return null;

  const diagnostics: LintResult[] = [];
  const evalScopeId = self.kind === "Definition" || self.kind === "Package" ? self.id : (self.parentId ?? self.id);

  // 1. S3015: InvocationExpression signature checking
  const invocations = collectOwnExpressionSubtrees(db, self, cst, baseOffset, new Set(["InvocationExpression"]));
  for (const invNode of invocations) {
    const typeNode = invNode.childForFieldName?.("type") ?? getCstChildren(invNode)[0];
    const rawCallee = typeNode?.text?.trim();
    if (!rawCallee) continue;

    const shortCallee = normalizeTypeName(rawCallee.split(".").pop() || rawCallee);
    let calleeSym = resolveFeatureInScope(db, evalScopeId, rawCallee);
    if (
      !calleeSym ||
      (calleeSym.ruleName !== "CalculationDefinition" &&
        calleeSym.ruleName !== "ActionDefinition" &&
        calleeSym.ruleName !== "CalculationUsage")
    ) {
      calleeSym =
        db
          .byName(shortCallee)
          .find(
            (s) =>
              isSysmlLanguageSymbol(s) &&
              (s.ruleName === "CalculationDefinition" ||
                s.ruleName === "ActionDefinition" ||
                s.ruleName === "CalculationUsage"),
          ) ?? null;
    }
    if (!calleeSym || !isSysmlLanguageSymbol(calleeSym)) continue;
    if (
      calleeSym.ruleName !== "CalculationDefinition" &&
      calleeSym.ruleName !== "CalculationUsage" &&
      calleeSym.ruleName !== "ActionDefinition"
    ) {
      continue;
    }

    const inParams = collectInputParameters(db, calleeSym);
    const calleeHasExplicitParens = getHeaderLeavesBeforeBody(db, calleeSym).leaves.some((l) => l.text === "(");
    if (inParams.length === 0 && !calleeHasExplicitParens) continue;

    // Collect direct ArgumentMember / NamedArgumentMember children of this InvocationExpression (not nested calls)
    const positionalArgs: SysmlCstNode[] = [];
    const namedArgs: Array<{ name: string; expr: SysmlCstNode | null; node: SysmlCstNode }> = [];

    const collectDirectArgs = (cur: SysmlCstNode) => {
      if (cur !== invNode && cur.type === "InvocationExpression") return;
      if (cur.type === "ArgumentMember") {
        positionalArgs.push(cur);
        return;
      }
      if (cur.type === "NamedArgumentMember") {
        const namedNode = getCstChildren(cur).find((c) => c.type === "NamedArgument") ?? cur;
        const paramRedef =
          namedNode.childForFieldName?.("parameterRedefinition") ??
          findFirstDescendant(namedNode, "ParameterRedefinition");
        const valNode = namedNode.childForFieldName?.("value") ?? findFirstDescendant(namedNode, "ArgumentValue");
        const paramName = paramRedef?.text?.trim().split("::").pop()?.trim() ?? "";
        namedArgs.push({ name: paramName, expr: unwrapArgOwnedExpr(valNode), node: cur });
        return;
      }
      for (const ch of getCstChildren(cur)) {
        collectDirectArgs(ch);
      }
    };
    collectDirectArgs(invNode);

    if (positionalArgs.length > inParams.length) {
      diagnostics.push(
        emitDiag(
          db,
          self,
          SysML2ErrorCode.INVOCATION_SIGNATURE_MISMATCH,
          [rawCallee, `expected at most ${inParams.length} 'in' argument(s), got ${positionalArgs.length}`],
          { node: positionalArgs[inParams.length] ?? invNode, baseOffset },
        ),
      );
      continue;
    }

    if (namedArgs.length === 0 && positionalArgs.length < inParams.length) {
      const requiredParams = inParams.filter((p) => {
        const vInfo = hasFeatureValueInfo(db, p);
        if (vInfo.hasValue) return false;
        const m = parseExplicitMultiplicity(db, p);
        return !m || m.lower > 0;
      });
      if (positionalArgs.length < requiredParams.length) {
        diagnostics.push(
          emitDiag(
            db,
            self,
            SysML2ErrorCode.INVOCATION_SIGNATURE_MISMATCH,
            [rawCallee, `expected ${requiredParams.length} required 'in' argument(s), got ${positionalArgs.length}`],
            { node: invNode, baseOffset },
          ),
        );
        continue;
      }
    }

    for (let i = 0; i < positionalArgs.length && i < inParams.length; i++) {
      const argExpr = unwrapArgOwnedExpr(positionalArgs[i]!);
      const paramTypeInfo = getFeatureDeclaredTypeRaw(db, inParams[i]!);
      if (argExpr && paramTypeInfo) {
        const argInfer = inferExpressionType(db, argExpr, evalScopeId);
        if (argInfer.typeName && !isTypeAssignable(db, argInfer.typeName, paramTypeInfo.raw)) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.INVOCATION_SIGNATURE_MISMATCH,
              [
                rawCallee,
                `argument ${i + 1} ('${inParams[i]!.name || `arg${i + 1}`}') expects '${paramTypeInfo.raw}', got '${argInfer.typeName}'`,
              ],
              { node: argExpr, baseOffset },
            ),
          );
        }
      }
    }

    const seenNamed = new Set<string>();
    for (const na of namedArgs) {
      if (!na.name) continue;
      if (seenNamed.has(na.name)) {
        diagnostics.push(
          emitDiag(
            db,
            self,
            SysML2ErrorCode.INVOCATION_SIGNATURE_MISMATCH,
            [rawCallee, `duplicate named argument '${na.name}'`],
            { node: na.node, baseOffset },
          ),
        );
        continue;
      }
      seenNamed.add(na.name);
      const matchedParam = inParams.find((p) => p.name === na.name);
      if (!matchedParam) {
        diagnostics.push(
          emitDiag(
            db,
            self,
            SysML2ErrorCode.INVOCATION_SIGNATURE_MISMATCH,
            [rawCallee, `unknown parameter '${na.name}'`],
            { node: na.node, baseOffset },
          ),
        );
        continue;
      }
      const paramTypeInfo = getFeatureDeclaredTypeRaw(db, matchedParam);
      if (na.expr && paramTypeInfo) {
        const argInfer = inferExpressionType(db, na.expr, evalScopeId);
        if (argInfer.typeName && !isTypeAssignable(db, argInfer.typeName, paramTypeInfo.raw)) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.INVOCATION_SIGNATURE_MISMATCH,
              [rawCallee, `argument '${na.name}' expects '${paramTypeInfo.raw}', got '${argInfer.typeName}'`],
              { node: na.expr, baseOffset },
            ),
          );
        }
      }
    }
  }

  // 2. S3016: Transition guard / Succession guard / ElementFilterMember / `after` trigger expression types
  if (self.ruleName === "TransitionUsage" || self.ruleName === "SuccessionAsUsage") {
    const guardNode = cst.childForFieldName?.("guard");
    if (guardNode) {
      const gRes = inferExpressionType(db, guardNode, self.parentId ?? self.id);
      if (gRes.typeName && gRes.typeName !== "Boolean") {
        diagnostics.push(
          emitDiag(db, self, SysML2ErrorCode.TRIGGER_EXPRESSION_TYPE_MISMATCH, ["guard", "Boolean", gRes.typeName], {
            node: guardNode,
            baseOffset,
          }),
        );
      }
    }
  }

  if (self.ruleName === "TransitionUsage" || self.ruleName === "AcceptActionNode") {
    const leaves = collectCstLeaves(cst);
    for (let i = 0; i < leaves.length - 1; i++) {
      if (leaves[i]!.text === "after") {
        const nextLeaf = leaves[i + 1]!;
        let badType: string | null = null;
        if ((nextLeaf.text.startsWith('"') && nextLeaf.text.endsWith('"')) || nextLeaf.type === "STRING_VALUE") {
          badType = "String";
        } else if (nextLeaf.text === "true" || nextLeaf.text === "false" || nextLeaf.type === "BooleanValue") {
          badType = "Boolean";
        }
        if (badType) {
          diagnostics.push(
            createSysML2Diagnostic(
              SysML2ErrorCode.TRIGGER_EXPRESSION_TYPE_MISMATCH,
              ["after trigger", "DurationValue/Real", badType],
              { startOffset: baseOffset + nextLeaf.start, endOffset: baseOffset + nextLeaf.end },
            ),
          );
        }
      }
    }
  }

  const filterNodes = collectOwnExpressionSubtrees(db, self, cst, baseOffset, new Set(["ElementFilterMember"]));
  for (const filterMember of filterNodes) {
    const condExpr =
      filterMember.childForFieldName?.("ownedRelatedElement") ?? findFirstDescendant(filterMember, "OwnedExpression");
    if (condExpr) {
      const fRes = inferExpressionType(db, condExpr, evalScopeId);
      if (fRes.typeName && fRes.typeName !== "Boolean") {
        diagnostics.push(
          emitDiag(db, self, SysML2ErrorCode.TRIGGER_EXPRESSION_TYPE_MISMATCH, ["filter", "Boolean", fRes.typeName], {
            node: condExpr,
            baseOffset,
          }),
        );
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S3017: Multiplicity Natural Bounds
// ---------------------------------------------------------------------------

/**
 * Validates S3017 (`multiplicity-bound-not-natural`) on feature multiplicities.
 */
export function checkMultiplicityNaturalBounds(db: QueryDB, self: SymbolEntry): LintResult | null {
  const { node: cst, baseOffset } = getSymbolCst(db, self);
  if (!cst) return null;

  // Locate header OwnedMultiplicity / MultiplicityRange before `{`
  let multNode: SysmlCstNode | null = null;
  for (const ch of getCstChildren(cst)) {
    if (ch.type === "{" || ch.text === "{") break;
    if (ch.type === "OwnedMultiplicity" || ch.type === "MultiplicityRange") {
      multNode = ch;
      break;
    }
    const desc = findFirstDescendant(ch, "MultiplicityRange");
    if (desc) {
      multNode = desc;
      break;
    }
  }

  // Also inspect header `[ ... ]` leaves before `{`, `=`, `:=`, `;` (catches negative `-1` even under GLR recovery)
  const { leaves: headerLeaves } = getHeaderLeavesBeforeBody(db, self);
  const openBrk = headerLeaves.findIndex(
    (l, idx) => l.text === "[" && (idx === 0 || !/^[0-9]/.test(headerLeaves[idx - 1]!.text)),
  );
  if (openBrk !== -1) {
    const closeBrk = headerLeaves.findIndex((l, idx) => idx > openBrk && l.text === "]");
    if (closeBrk > openBrk + 1) {
      const innerLeaves = headerLeaves.slice(openBrk + 1, closeBrk);
      const dotDotIdx = innerLeaves.findIndex((l) => l.text === "..");
      const boundSlices =
        dotDotIdx !== -1
          ? [
              { leaves: innerLeaves.slice(0, dotDotIdx), isUpper: false, hasUpper: true },
              { leaves: innerLeaves.slice(dotDotIdx + 1), isUpper: true, hasUpper: true },
            ]
          : [{ leaves: innerLeaves, isUpper: false, hasUpper: false }];

      for (const part of boundSlices) {
        if (part.leaves.length === 0) continue;
        const rawText = part.leaves.map((l) => l.text).join("");
        const span = {
          startOffset: baseOffset + part.leaves[0]!.start,
          endOffset: baseOffset + part.leaves[part.leaves.length - 1]!.end,
        };

        // `[*]` alone or `*` as upper bound is valid UnlimitedNatural
        if (rawText === "*" && (part.isUpper || !part.hasUpper)) continue;
        if (rawText === "*" && !part.isUpper && part.hasUpper) {
          return createSysML2Diagnostic(SysML2ErrorCode.MULTIPLICITY_BOUND_NOT_NATURAL, [rawText], span);
        }

        const parsedNum = parseSignedNumberFromLeaves(part.leaves, 0);
        if (parsedNum && parsedNum.nextIdx === part.leaves.length) {
          if (parsedNum.value < 0 || !Number.isInteger(parsedNum.value) || rawText.includes(".")) {
            return createSysML2Diagnostic(SysML2ErrorCode.MULTIPLICITY_BOUND_NOT_NATURAL, [rawText], span);
          }
          continue;
        }

        if (rawText === "true" || rawText === "false" || rawText.startsWith('"') || rawText.startsWith("'")) {
          return createSysML2Diagnostic(SysML2ErrorCode.MULTIPLICITY_BOUND_NOT_NATURAL, [rawText], span);
        }

        // Check constant feature reference bound (e.g. `[negConst]`)
        if (part.leaves.length === 1 && isSysmlIdentLeaf(rawText)) {
          const refSym = resolveFeatureInScope(db, self.parentId, rawText);
          if (refSym) {
            const val = getFeatureValue(db, refSym, self.parentId);
            if (
              typeof val === "boolean" ||
              typeof val === "string" ||
              (typeof val === "number" && (val < 0 || !Number.isInteger(val)))
            ) {
              return createSysML2Diagnostic(
                SysML2ErrorCode.MULTIPLICITY_BOUND_NOT_NATURAL,
                [`${rawText} (= ${String(val)})`],
                span,
              );
            }
          }
        }
      }
    }
  }

  // Fallback check via metadata strings
  for (const key of ["multiplicityLower", "multiplicityUpper"] as const) {
    const raw = metaStr(self, key)?.trim();
    if (!raw) continue;
    if (raw === "*") continue;
    const num = Number(raw);
    if (!Number.isNaN(num) && (num < 0 || !Number.isInteger(num) || raw.includes("."))) {
      return emitDiag(
        db,
        self,
        SysML2ErrorCode.MULTIPLICITY_BOUND_NOT_NATURAL,
        [raw],
        multNode ? { node: multNode, baseOffset } : null,
      );
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// S4014 & S4015: Variation/Variant & Composite/End/Constant Modifier Rules
// ---------------------------------------------------------------------------

function unwrapBodyItemNode(node: SysmlCstNode): SysmlCstNode[] {
  if (
    node.type.endsWith("BodyItem") ||
    node.type.endsWith("BodyPart") ||
    node.type === "StateDefBody" ||
    node.type === "CalculationBodyPart"
  ) {
    const inner: SysmlCstNode[] = [];
    for (const ch of getCstChildren(node)) {
      if (
        ch.type === "{" ||
        ch.text === "{" ||
        ch.type === "}" ||
        ch.text === "}" ||
        ch.type === ";" ||
        ch.text === ";"
      ) {
        continue;
      }
      inner.push(...unwrapBodyItemNode(ch));
    }
    return inner;
  }
  return [node];
}

function collectDirectBodyMemberNodes(cst: SysmlCstNode): SysmlCstNode[] {
  const out: SysmlCstNode[] = [];
  let seenOpenBrace = false;

  const scanBodyItems = (n: SysmlCstNode) => {
    for (const ch of getCstChildren(n)) {
      if (ch.type === "{" || ch.text === "{") {
        seenOpenBrace = true;
        continue;
      }
      if (!seenOpenBrace) {
        if (ch.type.includes("Body")) {
          scanBodyItems(ch);
        }
        continue;
      }
      if (ch.type === "}" || ch.text === "}") break;
      out.push(...unwrapBodyItemNode(ch));
    }
  };
  scanBodyItems(cst);
  return out;
}

/**
 * Validates S4014 (`variation-variant-misuse`) and S4015 (`abstract-or-composite-misuse`).
 */
export function checkVariationAndModifierRules(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  const { node: cst, baseOffset } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const diagnostics: LintResult[] = [];
  const selfName = self.name && self.name !== "<anonymous>" ? self.name : self.ruleName;
  const selfIsVariation = isTruthyMeta(self, "isVariation") || hasHeaderKeyword(db, self, "variation");

  // S4014 (a) & (b): on `variation` definition or usage
  if (selfIsVariation) {
    // (a) A variation cannot specialize another variation
    for (const child of db.childrenOf(self.id)) {
      if (
        child.ruleName === "OwnedSubclassification" ||
        child.ruleName === "Subclassification" ||
        child.ruleName === "OwnedSubsetting" ||
        child.ruleName === "OwnedRedefinition" ||
        child.ruleName === "OwnedFeatureTyping"
      ) {
        const raw = stripLeadingTilde(
          (child.name || db.cstText(child.startOffset, child.endOffset, child) || "").trim(),
        );
        if (!raw || isStdlibOrBuiltinSymbol(raw)) continue;
        const base = resolveTypeOrClassifierByName(db, self.parentId, raw);
        if (base && (isTruthyMeta(base, "isVariation") || hasHeaderKeyword(db, base, "variation"))) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.VARIATION_VARIANT_MISUSE,
              [selfName, `variation '${selfName}' cannot specialize another variation '${base.name || raw}'`],
              child,
            ),
          );
        }
      }
    }

    // (b) Owned usages in variation body must be `variant` (excluding parameters, subject, objective, constraints, annotations)
    if (cst) {
      const bodyMembers = collectDirectBodyMemberNodes(cst);
      for (const bm of bodyMembers) {
        if (bm.type === "NonOccurrenceUsageMember" || bm.type === "OccurrenceUsageMember") {
          const bmLeaves = collectCstLeaves(bm);
          const firstTok = bmLeaves[0]?.text ?? "";
          if (
            firstTok === "in" ||
            firstTok === "out" ||
            firstTok === "inout" ||
            firstTok === "return" ||
            firstTok === "subject" ||
            firstTok === "objective" ||
            firstTok === "assume" ||
            firstTok === "require" ||
            firstTok === "assert" ||
            firstTok === "@" ||
            firstTok === "metadata"
          ) {
            continue;
          }
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.VARIATION_VARIANT_MISUSE,
              [selfName, "owned usage inside a 'variation' must be declared as a 'variant'"],
              { node: bm, baseOffset },
            ),
          );
        }
      }
    }
  } else if (cst && self.ruleName !== "EnumerationDefinition" && self.ruleName !== "EnumerationUsage") {
    // S4014 converse: `variant` member inside a non-variation container
    const bodyMembers = collectDirectBodyMemberNodes(cst);
    for (const bm of bodyMembers) {
      if (bm.type === "VariantUsageMember") {
        diagnostics.push(
          emitDiag(
            db,
            self,
            SysML2ErrorCode.VARIATION_VARIANT_MISUSE,
            [selfName, "'variant' member is only allowed inside a 'variation' definition or usage"],
            { node: bm, baseOffset },
          ),
        );
      }
    }
  }

  // S4015 (a): AttributeDefinition or PortDefinition owning a composite PartUsage (`isRef` not true)
  if (self.ruleName === "AttributeDefinition" || self.ruleName === "PortDefinition") {
    for (const child of db.childrenOf(self.id)) {
      if (child.ruleName !== "PartUsage") continue;
      const isRef =
        isTruthyMeta(child, "isRef") || hasHeaderKeyword(db, child, "ref") || Boolean(metaStr(child, "direction"));
      if (!isRef) {
        diagnostics.push(
          emitDiag(
            db,
            self,
            SysML2ErrorCode.ABSTRACT_OR_COMPOSITE_MISUSE,
            [
              child.name || selfName,
              `'${self.ruleName}' cannot own composite part '${child.name || "part"}'; declare 'ref part' instead`,
            ],
            child,
          ),
        );
      }
    }
  }

  // S4015 (b): Usage with `isEnd === true` that also has direction (`in`/`out`/`inout`), `derived`, or `abstract`
  if (self.kind === "Usage" && (isTruthyMeta(self, "isEnd") || hasHeaderKeyword(db, self, "end"))) {
    const dir = metaStr(self, "direction");
    const isDerived = isTruthyMeta(self, "isDerived") || hasHeaderKeyword(db, self, "derived");
    const isAbstract = isTruthyMeta(self, "isAbstract") || hasHeaderKeyword(db, self, "abstract");
    const conflictMod =
      dir === "in" || dir === "out" || dir === "inout" ? dir : isDerived ? "derived" : isAbstract ? "abstract" : null;
    if (conflictMod) {
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.ABSTRACT_OR_COMPOSITE_MISUSE, [
          selfName,
          `'end' feature cannot also declare modifier '${conflictMod}'`,
        ]),
      );
    }
  }

  // S4015 (c): AssignActionNode targeting a `constant` feature
  if (self.ruleName === "AssignActionNode" && cst) {
    const targetNode = cst.childForFieldName?.("targetFeature");
    const targetPath = targetNode?.text?.trim();
    if (targetPath) {
      const targetSym =
        resolvePathInScope(db, self.parentId, targetPath) ?? resolveFeatureInScope(db, self.parentId, targetPath);
      if (targetSym && (isTruthyMeta(targetSym, "isConstant") || hasHeaderKeyword(db, targetSym, "constant"))) {
        diagnostics.push(
          emitDiag(
            db,
            self,
            SysML2ErrorCode.ABSTRACT_OR_COMPOSITE_MISUSE,
            [targetPath, `cannot assign to 'constant' feature '${targetPath}'`],
            { node: targetNode!, baseOffset },
          ),
        );
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S4016, S4020, S4021, S4022, S4023, S4024: Parallel States, Singletons & INCOSE
// ---------------------------------------------------------------------------

const INCOSE_AMBIGUOUS_PATTERNS: Array<{ term: string; regex: RegExp }> = [
  { term: "TBD", regex: /\btbd\b/i },
  { term: "TBC", regex: /\btbc\b/i },
  { term: "approximately", regex: /\bapproximately\b/i },
  { term: "as appropriate", regex: /\bas\s+appropriate\b/i },
  { term: "etc.", regex: /\betc\.(?!\w)/i },
];

/**
 * Validates S4016, S4020, S4021, S4022, S4023, and S4024.
 */
export function checkParallelStateAndSingletonMembers(
  db: QueryDB,
  self: SymbolEntry,
): LintResult | LintResult[] | null {
  const { node: cst, baseOffset } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const diagnostics: LintResult[] = [];
  const selfName = self.name && self.name !== "<anonymous>" ? self.name : self.ruleName;
  const children = db.childrenOf(self.id);

  // S4016: PARALLEL_STATE_INVALID_TRANSITION
  if (
    (self.ruleName === "StateDefinition" || self.ruleName === "StateUsage" || self.ruleName === "ExhibitStateUsage") &&
    (isTruthyMeta(self, "isParallel") || hasHeaderKeyword(db, self, "parallel"))
  ) {
    const badChild = children.find((c) => c.ruleName === "TransitionUsage" || c.ruleName === "SuccessionAsUsage");
    if (badChild) {
      diagnostics.push(emitDiag(db, self, SysML2ErrorCode.PARALLEL_STATE_INVALID_TRANSITION, [selfName], badChild));
    } else if (cst) {
      const bodyItems = collectDirectBodyMemberNodes(cst);
      const badCst = bodyItems.find((b) => b.type === "TransitionUsageMember" || b.type === "EmptySuccessionMember");
      if (badCst) {
        diagnostics.push(
          emitDiag(db, self, SysML2ErrorCode.PARALLEL_STATE_INVALID_TRANSITION, [selfName], {
            node: badCst,
            baseOffset,
          }),
        );
      }
    }
  }

  // S4020: DUPLICATE_SINGLETON_MEMBER
  if (
    self.ruleName === "RequirementDefinition" ||
    self.ruleName === "RequirementUsage" ||
    self.ruleName === "CaseDefinition" ||
    self.ruleName === "CaseUsage" ||
    self.ruleName === "AnalysisCaseDefinition" ||
    self.ruleName === "AnalysisCaseUsage" ||
    self.ruleName === "VerificationCaseDefinition" ||
    self.ruleName === "VerificationCaseUsage" ||
    self.ruleName === "UseCaseDefinition" ||
    self.ruleName === "UseCaseUsage"
  ) {
    const subjects = children.filter((c) => c.ruleName === "SubjectUsage");
    if (subjects.length > 1) {
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.DUPLICATE_SINGLETON_MEMBER, ["subject", selfName], subjects[1]!),
      );
    }
    const objectives = children.filter((c) => c.ruleName === "ObjectiveRequirementUsage");
    if (objectives.length > 1) {
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.DUPLICATE_SINGLETON_MEMBER, ["objective", selfName], objectives[1]!),
      );
    }
  }

  if (
    cst &&
    (self.ruleName === "StateDefinition" || self.ruleName === "StateUsage" || self.ruleName === "ExhibitStateUsage")
  ) {
    const bodyItems = collectDirectBodyMemberNodes(cst);
    const entries = bodyItems.filter((b) => b.type === "EntryActionMember");
    const dos = bodyItems.filter((b) => b.type === "DoActionMember");
    const exits = bodyItems.filter((b) => b.type === "ExitActionMember");
    if (entries.length > 1) {
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.DUPLICATE_SINGLETON_MEMBER, ["entry", selfName], {
          node: entries[1]!,
          baseOffset,
        }),
      );
    }
    if (dos.length > 1) {
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.DUPLICATE_SINGLETON_MEMBER, ["do", selfName], {
          node: dos[1]!,
          baseOffset,
        }),
      );
    }
    if (exits.length > 1) {
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.DUPLICATE_SINGLETON_MEMBER, ["exit", selfName], {
          node: exits[1]!,
          baseOffset,
        }),
      );
    }
  }

  if (cst && (self.ruleName === "CalculationDefinition" || self.ruleName === "CalculationUsage")) {
    const bodyItems = collectDirectBodyMemberNodes(cst);
    const returns = bodyItems.filter((b) => b.type === "ReturnParameterMember");
    if (returns.length > 1) {
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.DUPLICATE_SINGLETON_MEMBER, ["return", selfName], {
          node: returns[1]!,
          baseOffset,
        }),
      );
    }
  }

  // S4021: SEND_TO_PORT_WITHOUT_VIA
  if (self.ruleName === "SendActionNode" && cst) {
    const leaves = collectCstLeaves(cst);
    let hasVia = false;
    let braceDepth = 0;
    for (const lf of leaves) {
      if (lf.text === "{") braceDepth++;
      else if (lf.text === "}") braceDepth = Math.max(0, braceDepth - 1);
      else if (braceDepth === 0 && lf.text === "via") {
        hasVia = true;
        break;
      }
    }
    if (!hasVia) {
      const receiverNode = cst.childForFieldName?.("receiver");
      const receiverPath = receiverNode?.text?.trim();
      if (receiverPath) {
        const targetSym =
          resolvePathInScope(db, self.parentId, receiverPath) ?? resolveFeatureInScope(db, self.parentId, receiverPath);
        if (
          targetSym &&
          (targetSym.ruleName === "PortUsage" || resolveTypeOf(db, targetSym)?.ruleName === "PortDefinition")
        ) {
          diagnostics.push(
            emitDiag(db, self, SysML2ErrorCode.SEND_TO_PORT_WITHOUT_VIA, [receiverPath], {
              node: receiverNode!,
              baseOffset,
            }),
          );
        }
      }
    }
  }

  // S4022: INTERFACE_END_NOT_PORT
  if (self.ruleName === "InterfaceDefinition" || self.ruleName === "InterfaceUsage") {
    for (const child of children) {
      if (child.kind !== "Usage") continue;
      if (!(isTruthyMeta(child, "isEnd") || hasHeaderKeyword(db, child, "end"))) continue;
      if (child.ruleName === "PortUsage") continue;

      if (child.ruleName === "DefaultReferenceUsage" || child.ruleName === "ReferenceUsage") {
        const tInfo = getFeatureDeclaredTypeRaw(db, child);
        if (tInfo) {
          const tSym = resolveTypeOrClassifierByName(db, self.id, tInfo.raw);
          if (tSym?.ruleName === "PortDefinition") continue;
        }
        const childSpecs = extractSpecializationClauses(db, child);
        const refsPort = childSpecs.some((sp) => {
          const refTarget = resolveSpecializationTarget(db, child, sp.targetPath, sp.ruleName);
          return (
            refTarget?.ruleName === "PortUsage" ||
            (refTarget ? resolveTypeOf(db, refTarget)?.ruleName === "PortDefinition" : false)
          );
        });
        if (refsPort) continue;
      }

      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.INTERFACE_END_NOT_PORT, [child.name || "end", selfName], child),
      );
    }
  }

  // S4023: BINDING_CONNECTOR_NOT_BINARY
  if (self.ruleName === "BindingConnectorAsUsage") {
    const endUsages = children.filter(
      (c) => c.kind === "Usage" && (isTruthyMeta(c, "isEnd") || hasHeaderKeyword(db, c, "end")),
    );
    const refEnds = children.filter((c) => c.kind === "Reference");
    if (endUsages.length > 2 || (refEnds.length === 0 && endUsages.length === 1)) {
      diagnostics.push(emitDiag(db, self, SysML2ErrorCode.BINDING_CONNECTOR_NOT_BINARY, [selfName]));
    }
  }

  // S4024: INCOSE_REQUIREMENT_QUALITY
  if (
    (self.ruleName === "RequirementDefinition" || self.ruleName === "RequirementUsage") &&
    !isTruthyMeta(self, "isAbstract") &&
    cst
  ) {
    const docNodes = collectOwnExpressionSubtrees(db, self, cst, baseOffset, new Set(["Documentation"]));
    const rawSelfText = docNodes.length > 0 ? db.cstText(self.startOffset, self.endOffset, self) || "" : "";

    for (const docNode of docNodes) {
      let docBody = "";
      let bodyStartAbs = self.startOffset;

      const docLeaves = collectCstLeaves(docNode);
      const strLeaf = docLeaves.find(
        (l) => (l.text.startsWith('"') && l.text.endsWith('"')) || (l.text.startsWith("'") && l.text.endsWith("'")),
      );
      if (strLeaf) {
        docBody = strLeaf.text.slice(1, -1);
        bodyStartAbs = baseOffset + strLeaf.start + 1;
      } else if (rawSelfText) {
        const offs = getNodeOffsets(docNode, baseOffset);
        const relSearch = offs ? offs.endOffset - self.startOffset : 0;
        if (relSearch >= 0 && relSearch <= rawSelfText.length) {
          let pos = relSearch;
          while (
            pos < rawSelfText.length &&
            (rawSelfText[pos] === " " ||
              rawSelfText[pos] === "\t" ||
              rawSelfText[pos] === "\n" ||
              rawSelfText[pos] === "\r")
          ) {
            pos++;
          }
          if (rawSelfText.startsWith("/*", pos)) {
            const closeIdx = rawSelfText.indexOf("*/", pos + 2);
            if (closeIdx !== -1) {
              docBody = rawSelfText.slice(pos + 2, closeIdx);
              bodyStartAbs = self.startOffset + pos + 2;
            }
          }
        }
      }

      if (!docBody) continue;
      for (const pat of INCOSE_AMBIGUOUS_PATTERNS) {
        const m = pat.regex.exec(docBody);
        if (m && typeof m.index === "number") {
          diagnostics.push(
            createSysML2Diagnostic(SysML2ErrorCode.INCOSE_REQUIREMENT_QUALITY, [selfName, m[0]], {
              startOffset: bodyStartAbs + m.index,
              endOffset: bodyStartAbs + m.index + m[0].length,
            }),
          );
          break;
        }
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// Shared Linear Constraint Extraction for Live Formal Verification (S6xxx)
// ---------------------------------------------------------------------------

interface ExtractedLinearAtom {
  constraintSym: SymbolEntry;
  terms: Array<{ varName: string; coeff: number }>;
  operator: "<=" | "<" | ">=" | ">" | "==";
  rhs: number;
  rawText: string;
}

function stripSubjectAlias(varName: string, subjectNames: ReadonlySet<string>): string {
  const dotIdx = varName.indexOf(".");
  if (dotIdx > 0) {
    const prefix = varName.slice(0, dotIdx);
    if (subjectNames.has(prefix)) {
      return varName.slice(dotIdx + 1);
    }
  }
  return varName;
}

function getSubjectAliasesForReq(db: QueryDB, reqSym: SymbolEntry): Set<string> {
  const aliases = new Set<string>();
  const walk = (sym: SymbolEntry, visited: Set<number>) => {
    if (visited.has(sym.id)) return;
    visited.add(sym.id);
    for (const ch of db.childrenOf(sym.id)) {
      if (ch.ruleName === "SubjectUsage" && ch.name) {
        aliases.add(ch.name);
      }
      if ((ch.ruleName === "OwnedSubclassification" || ch.ruleName === "OwnedSubsetting") && ch.name) {
        const sup = resolveTypeOrClassifierByName(db, sym.parentId, ch.name);
        if (sup) walk(sup, visited);
      }
    }
  };
  walk(reqSym, new Set<number>());
  return aliases;
}

function extractLinearAtomsFromConstraintSymbol(
  db: QueryDB,
  constraintSym: SymbolEntry,
  subjectAliases: ReadonlySet<string>,
  evalScopeId: number | null,
): ExtractedLinearAtom[] {
  const { node: cst } = getSymbolCst(db, constraintSym);
  if (!cst || cstHasError(cst)) return [];

  const atoms: ExtractedLinearAtom[] = [];

  const walkBoolExpr = (expr: SysmlCstNode, negated: boolean) => {
    const t = expr.type;
    if (t === "AndExpression" && !negated) {
      for (const op of expr.childrenForFieldName?.("operand") ?? []) {
        walkBoolExpr(op, false);
      }
      return;
    }
    if (t === "UnaryExpression") {
      const opTok = expr.childForFieldName?.("operator")?.text?.trim();
      const inner = expr.childForFieldName?.("operand");
      if (opTok === "not" && inner) {
        walkBoolExpr(inner, !negated);
        return;
      }
    }
    if (t === "RelationalExpression" || t === "EqualityExpression") {
      let operands = expr.childrenForFieldName?.("operand") ?? [];
      let ops = (expr.childrenForFieldName?.("operator") ?? []).map((o) => o.text.trim());
      if (operands.length < 2 && getCstChildren(expr).length === 3) {
        const chs = getCstChildren(expr);
        operands = [chs[0]!, chs[2]!];
        ops = [chs[1]!.text.trim()];
      }
      if (operands.length < 2 || ops.length === 0) return;
      let op = ops[0]!;
      if (op === "===") op = "==";
      if (op === "!==") op = "!=";
      if (negated) {
        if (op === "<=") op = ">";
        else if (op === "<") op = ">=";
        else if (op === ">=") op = "<";
        else if (op === ">") op = "<=";
        else return;
      }
      if (op !== "<=" && op !== "<" && op !== ">=" && op !== ">" && op !== "==") return;

      const lhsVal = evaluateExpressionNode(db, operands[0]! as unknown as CSTNode, evalScopeId);
      const rhsVal = evaluateExpressionNode(db, operands[1]! as unknown as CSTNode, evalScopeId);

      const lhsLinear =
        typeof lhsVal === "number" && Number.isFinite(lhsVal)
          ? { terms: [], constant: lhsVal }
          : parseLinearExpression(operands[0]!.text);
      const rhsLinear =
        typeof rhsVal === "number" && Number.isFinite(rhsVal)
          ? { terms: [], constant: rhsVal }
          : parseLinearExpression(operands[1]!.text);

      if (lhsLinear.terms.length === 0 && rhsLinear.terms.length === 0) return;

      // Reject nonlinear expressions (`*` between variables, `/`, `(`, `[` other than unit)
      const combinedText = `${operands[0]!.text} ${operands[1]!.text}`;
      if (combinedText.includes("/") || combinedText.includes("^") || combinedText.includes("**")) return;

      const coeffByVar = new Map<string, number>();
      for (const term of lhsLinear.terms) {
        const normVar = stripSubjectAlias(term.varName, subjectAliases);
        coeffByVar.set(normVar, (coeffByVar.get(normVar) ?? 0) + term.coeff);
      }
      for (const term of rhsLinear.terms) {
        const normVar = stripSubjectAlias(term.varName, subjectAliases);
        coeffByVar.set(normVar, (coeffByVar.get(normVar) ?? 0) - term.coeff);
      }

      const terms = Array.from(coeffByVar.entries())
        .filter(([, c]) => Math.abs(c) > 1e-12)
        .map(([varName, coeff]) => ({ varName, coeff }));
      if (terms.length === 0) return;

      const effectiveRhs = rhsLinear.constant - lhsLinear.constant;
      atoms.push({
        constraintSym,
        terms,
        operator: op,
        rhs: effectiveRhs,
        rawText: collapseWhitespace(expr.text),
      });
      return;
    }

    const children = getCstChildren(expr);
    if (children.length === 1) {
      walkBoolExpr(children[0]!, negated);
      return;
    }
    for (const ch of children) {
      if (
        ch.type === "ResultExpressionMember" ||
        ch.type === "OwnedExpression" ||
        ch.type === "EqualityExpressionReference" ||
        ch.type === "EqualityExpressionMember" ||
        ch.type.endsWith("Body")
      ) {
        walkBoolExpr(ch, negated);
      }
    }
  };

  walkBoolExpr(cst, false);
  return atoms;
}

function negateLinearAtom(atom: ExtractedLinearAtom): SimplexLinearConstraint[] {
  switch (atom.operator) {
    case "<=":
      return [{ terms: atom.terms, operator: ">", rhs: atom.rhs, expression: `not (${atom.rawText})` }];
    case "<":
      return [{ terms: atom.terms, operator: ">=", rhs: atom.rhs, expression: `not (${atom.rawText})` }];
    case ">=":
      return [{ terms: atom.terms, operator: "<", rhs: atom.rhs, expression: `not (${atom.rawText})` }];
    case ">":
      return [{ terms: atom.terms, operator: "<=", rhs: atom.rhs, expression: `not (${atom.rawText})` }];
    case "==":
      return [
        { terms: atom.terms, operator: "<", rhs: atom.rhs, expression: `not (${atom.rawText})` },
        { terms: atom.terms, operator: ">", rhs: atom.rhs, expression: `not (${atom.rawText})` },
      ];
  }
}

function checkLinearEntailment(
  premises: readonly ExtractedLinearAtom[],
  goal: ExtractedLinearAtom,
): { entailed: boolean; witness?: Record<string, number> | undefined } {
  const negations = negateLinearAtom(goal);
  for (const neg of negations) {
    const solver = new RealSimplexSolver();
    for (const p of premises) {
      solver.addConstraint({
        terms: p.terms,
        operator: p.operator,
        rhs: p.rhs,
        expression: p.rawText,
      });
    }
    solver.addConstraint(neg);
    const res = solver.solve(1000);
    if (res.isFeasible) {
      return { entailed: false, witness: res.assignment };
    }
  }
  return { entailed: true };
}

function formatWitnessAssignment(witness: Record<string, number> | undefined): string {
  if (!witness) return "";
  const entries = Object.entries(witness).slice(0, 3);
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}=${Number.isInteger(v) ? v : Number(v.toFixed(4))}`).join(", ");
}

function toCraigConstraints(atoms: readonly ExtractedLinearAtom[]): CraigLinearConstraint[] {
  const out: CraigLinearConstraint[] = [];
  for (const a of atoms) {
    if (a.operator === "<=" || a.operator === "<") {
      const coeffs = new Map<string, number>();
      for (const t of a.terms) coeffs.set(t.varName, t.coeff);
      out.push({ coeffs, rhs: a.operator === "<" ? a.rhs - 1e-6 : a.rhs });
    } else if (a.operator === ">=" || a.operator === ">") {
      const coeffs = new Map<string, number>();
      for (const t of a.terms) coeffs.set(t.varName, -t.coeff);
      out.push({ coeffs, rhs: a.operator === ">" ? -(a.rhs + 1e-6) : -a.rhs });
    } else if (a.operator === "==") {
      const pos = new Map<string, number>();
      const neg = new Map<string, number>();
      for (const t of a.terms) {
        pos.set(t.varName, t.coeff);
        neg.set(t.varName, -t.coeff);
      }
      out.push({ coeffs: pos, rhs: a.rhs });
      out.push({ coeffs: neg, rhs: -a.rhs });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// S6001: Behavioral Liskov Contract Refinement
// ---------------------------------------------------------------------------

/**
 * Validates S6001 (`contract-refinement-violation`) using `RealSimplexSolver`.
 * Verifies contravariant preconditions (`A_super => A_sub`) and covariant guarantees
 * (`(A_super & G_sub) => G_super`) on redefined or weakened contract constraints.
 */
export function checkContractRefinement(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  if (
    self.ruleName !== "RequirementDefinition" &&
    self.ruleName !== "RequirementUsage" &&
    self.ruleName !== "PartDefinition"
  ) {
    return null;
  }
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const superSyms: SymbolEntry[] = [];
  for (const child of db.childrenOf(self.id)) {
    if (
      (child.ruleName === "OwnedSubclassification" ||
        child.ruleName === "Subclassification" ||
        child.ruleName === "OwnedSubsetting") &&
      child.name
    ) {
      if (isStdlibOrBuiltinSymbol(child.name)) continue;
      const sup = resolveTypeOrClassifierByName(db, self.parentId, child.name);
      if (sup && isSysmlLanguageSymbol(sup)) superSyms.push(sup);
    }
  }
  if (superSyms.length === 0) return null;

  const subAliases = getSubjectAliasesForReq(db, self);
  const subChildren = db.childrenOf(self.id);

  const subAssumeSyms = subChildren.filter(
    (c) => c.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, c) === "assume",
  );
  const subRequireSyms = subChildren.filter(
    (c) =>
      (c.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, c) === "require") ||
      c.ruleName === "AssertConstraintUsage" ||
      c.ruleName === "ConstraintUsage",
  );

  if (subAssumeSyms.length === 0 && subRequireSyms.length === 0) return null;

  const subAssumeAtoms = subAssumeSyms.flatMap((s) =>
    extractLinearAtomsFromConstraintSymbol(db, s, subAliases, self.id),
  );
  const diagnostics: LintResult[] = [];
  const selfName = self.name || "<anonymous>";

  for (const sup of superSyms) {
    const supAliases = new Set<string>([...subAliases, ...getSubjectAliasesForReq(db, sup)]);
    const supChildren = db.childrenOf(sup.id);

    const supAssumeSyms = supChildren.filter(
      (c) => c.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, c) === "assume",
    );
    const supRequireSyms = supChildren.filter(
      (c) =>
        (c.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, c) === "require") ||
        c.ruleName === "AssertConstraintUsage" ||
        c.ruleName === "ConstraintUsage",
    );

    const supAssumeAtoms = supAssumeSyms.flatMap((s) =>
      extractLinearAtomsFromConstraintSymbol(db, s, supAliases, sup.id),
    );
    const supAssumeVars = new Set(supAssumeAtoms.flatMap((a) => a.terms.map((t) => t.varName)));

    // 1. Precondition contravariance: `A_super => A_sub` when overriding/tightening existing assumed variables
    for (const subAssSym of subAssumeSyms) {
      const isRedef = hasExplicitRedefinition(db, subAssSym);
      const atoms = extractLinearAtomsFromConstraintSymbol(db, subAssSym, supAliases, self.id);
      for (const atom of atoms) {
        const touchesSupVar = atom.terms.some((t) => supAssumeVars.has(t.varName));
        if (!isRedef && !touchesSupVar) continue;
        const ent = checkLinearEntailment(supAssumeAtoms, atom);
        if (!ent.entailed) {
          const wStr = formatWitnessAssignment(ent.witness);
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.CONTRACT_REFINEMENT_VIOLATION,
              [
                selfName,
                sup.name || "<super>",
                `tightened 'assume' precondition '${atom.rawText}' rejects supertype input${wStr ? ` (${wStr})` : ""}`,
              ],
              subAssSym,
            ),
          );
          break;
        }
      }
    }

    // 2. Postcondition covariance: `(A_super & G_sub) => G_super` on redefined/overridden guarantees
    for (const subReqSym of subRequireSyms) {
      const subAtoms = extractLinearAtomsFromConstraintSymbol(db, subReqSym, supAliases, self.id);
      if (subAtoms.length === 0) continue;

      const redefTargets = extractSpecializationClauses(db, subReqSym)
        .filter((cl) => cl.ruleName === "OwnedRedefinition")
        .map((cl) => cl.targetPath.split("::").pop()?.split(".").pop()?.trim())
        .filter((x): x is string => Boolean(x));

      const isExplicitRedef = redefTargets.length > 0 || hasExplicitRedefinition(db, subReqSym);

      let matchedSuperSyms: SymbolEntry[] = [];
      if (redefTargets.length > 0) {
        matchedSuperSyms = supRequireSyms.filter((s) => s.name && redefTargets.includes(s.name));
      } else if (subReqSym.name && subReqSym.name !== "<anonymous>" && subReqSym.name !== subReqSym.ruleName) {
        matchedSuperSyms = supRequireSyms.filter((s) => s.name === subReqSym.name);
      }

      if (matchedSuperSyms.length > 0 || isExplicitRedef) {
        const targetSupSyms = matchedSuperSyms.length > 0 ? matchedSuperSyms : supRequireSyms;
        const supGuaranteeAtoms = targetSupSyms.flatMap((s) =>
          extractLinearAtomsFromConstraintSymbol(db, s, supAliases, sup.id),
        );
        for (const supAtom of supGuaranteeAtoms) {
          const ent = checkLinearEntailment([...supAssumeAtoms, ...subAtoms], supAtom);
          if (!ent.entailed) {
            const wStr = formatWitnessAssignment(ent.witness);
            diagnostics.push(
              emitDiag(
                db,
                self,
                SysML2ErrorCode.CONTRACT_REFINEMENT_VIOLATION,
                [
                  selfName,
                  sup.name || "<super>",
                  `redefined guarantee '${subAtoms[0]!.rawText}' weakens '${supAtom.rawText}'${wStr ? ` (witness: ${wStr})` : ""}`,
                ],
                subReqSym,
              ),
            );
            break;
          }
        }
      } else {
        // Unnamed constraint over identical variable set that is strictly weaker than supertype guarantee
        const subVars = new Set(subAtoms.flatMap((a) => a.terms.map((t) => t.varName)));
        for (const supReqSym of supRequireSyms) {
          const supAtoms = extractLinearAtomsFromConstraintSymbol(db, supReqSym, supAliases, sup.id);
          if (supAtoms.length === 0) continue;
          const supVars = new Set(supAtoms.flatMap((a) => a.terms.map((t) => t.varName)));
          if (subVars.size !== supVars.size || Array.from(subVars).some((v) => !supVars.has(v))) continue;

          const supEntailsSub = subAtoms.every(
            (sa) => checkLinearEntailment([...supAssumeAtoms, ...supAtoms], sa).entailed,
          );
          const subFailsSup = supAtoms.find(
            (pa) => !checkLinearEntailment([...supAssumeAtoms, ...subAtoms], pa).entailed,
          );
          if (supEntailsSub && subFailsSup) {
            const ent = checkLinearEntailment([...supAssumeAtoms, ...subAtoms], subFailsSup);
            const wStr = formatWitnessAssignment(ent.witness);
            diagnostics.push(
              emitDiag(
                db,
                self,
                SysML2ErrorCode.CONTRACT_REFINEMENT_VIOLATION,
                [
                  selfName,
                  sup.name || "<super>",
                  `guarantee '${subAtoms[0]!.rawText}' weakens inherited '${subFailsSup.rawText}'${wStr ? ` (witness: ${wStr})` : ""}`,
                ],
                subReqSym,
              ),
            );
            break;
          }
        }
      }
    }

    if (subAssumeAtoms.length > 0 && supAssumeAtoms.length === 0 && supRequireSyms.length > 0) {
      // Adding a new assume precondition where supertype had unconditional `true` assumption violates A_super => A_sub
      const hasStandardMeta = subChildren.some((c) => c.ruleName === "MetadataUsage");
      if (!hasStandardMeta && subAssumeSyms.some((s) => hasExplicitRedefinition(db, s))) {
        diagnostics.push(
          emitDiag(
            db,
            self,
            SysML2ErrorCode.CONTRACT_REFINEMENT_VIOLATION,
            [selfName, sup.name || "<super>", "cannot strengthen unconditional supertype assumption"],
            subAssumeSyms[0]!,
          ),
        );
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S6002 & S6003: Requirement Decomposition Gap & Vacuous Assumption
// ---------------------------------------------------------------------------

/**
 * Validates S6002 (`requirement-decomposition-gap`) and S6003 (`vacuous-requirement-assumption`).
 */
export function checkRequirementDecompositionAndVacuity(
  db: QueryDB,
  self: SymbolEntry,
): LintResult | LintResult[] | null {
  if (self.ruleName !== "RequirementDefinition" && self.ruleName !== "RequirementUsage") return null;
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const selfName = self.name || "<anonymous>";
  const children = db.childrenOf(self.id);
  const subjectAliases = getSubjectAliasesForReq(db, self);
  const diagnostics: LintResult[] = [];

  // 1. S6003: VACUOUS_REQUIREMENT_ASSUMPTION
  const assumeSyms = children.filter(
    (c) => c.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, c) === "assume",
  );

  let assumptionsConsistent = true;
  const assumeAtoms: ExtractedLinearAtom[] = [];

  if (assumeSyms.length > 0) {
    // Check constant/tautological false assumption first
    for (const assSym of assumeSyms) {
      const staticEval = evaluateConstraintBody(db, assSym, self.id);
      if (staticEval === false) {
        assumptionsConsistent = false;
        const rawText = collapseWhitespace(db.cstText(assSym.startOffset, assSym.endOffset, assSym) || "assume false");
        diagnostics.push(
          emitDiag(
            db,
            self,
            SysML2ErrorCode.VACUOUS_REQUIREMENT_ASSUMPTION,
            [selfName, `'${rawText}' evaluates to false`],
            assSym,
          ),
        );
        break;
      }
      assumeAtoms.push(...extractLinearAtomsFromConstraintSymbol(db, assSym, subjectAliases, self.id));
    }

    // Include subject constant/domain bounds if SubjectUsage has a type
    const subjectSym = children.find((c) => c.ruleName === "SubjectUsage");
    const subjectType = subjectSym ? resolveTypeOf(db, subjectSym) : null;

    if (assumptionsConsistent && assumeAtoms.length > 0) {
      const solver = new RealSimplexSolver();
      if (subjectType) {
        for (const member of db.childrenOf(subjectType.id)) {
          if (member.kind !== "Usage" || !member.name) continue;
          const tInfo = getFeatureDeclaredTypeRaw(db, member);
          const normT = tInfo ? normalizeTypeName(tInfo.raw) : "";
          if (normT === "Positive") {
            solver.addConstraint({ terms: [{ varName: member.name, coeff: 1 }], operator: ">", rhs: 0 });
          } else if (normT === "Natural") {
            solver.addConstraint({ terms: [{ varName: member.name, coeff: 1 }], operator: ">=", rhs: 0 });
          }
          if (isTruthyMeta(member, "isConstant") || hasHeaderKeyword(db, member, "constant")) {
            const cVal = getFeatureValue(db, member, subjectType.id);
            if (typeof cVal === "number" && Number.isFinite(cVal)) {
              solver.addConstraint({ terms: [{ varName: member.name, coeff: 1 }], operator: "==", rhs: cVal });
            }
          }
        }
      }
      for (const a of assumeAtoms) {
        solver.addConstraint({
          requirementName: selfName,
          terms: a.terms,
          operator: a.operator,
          rhs: a.rhs,
          expression: a.rawText,
        });
      }
      const res = solver.solve(1000);
      if (!res.isFeasible) {
        assumptionsConsistent = false;
        const exprSummary = assumeAtoms.map((a) => a.rawText).join(" and ");
        diagnostics.push(
          emitDiag(
            db,
            self,
            SysML2ErrorCode.VACUOUS_REQUIREMENT_ASSUMPTION,
            [selfName, `contradictory assumptions: ${exprSummary}`],
            assumeSyms[assumeSyms.length - 1]!,
          ),
        );
      }
    } else if (assumptionsConsistent && assumeSyms.length >= 1) {
      // Nonlinear fallback via DPLL(T) + HC4 contractor
      const rawBodies = assumeSyms
        .map((s) => db.cstText(s.startOffset, s.endOffset, s) || "")
        .map((txt) => {
          const open = txt.indexOf("{");
          const close = txt.lastIndexOf("}");
          return open !== -1 && close > open ? txt.slice(open + 1, close).trim() : txt.trim();
        });
      const nlConstraints = rawBodies.flatMap((b) => parseGuardConstraints(b)).filter((c) => c.nonlinear);
      if (nlConstraints.length > 0) {
        const theoryLiterals = new Map<number, NonlinearConstraint>();
        const clauses: number[][] = [];
        const initialBox = new Map<string, Interval>();
        let litId = 1;
        for (const nc of nlConstraints) {
          theoryLiterals.set(litId, nc.nonlinear!);
          clauses.push([litId]);
          initialBox.set(nc.variable, new Interval(-1000, 1000));
          litId++;
        }
        const dpll = new DpllTSolver({ clauses, theoryLiterals, initialBox, delta: 1e-3, maxSubdivisions: 500 });
        if (dpll.solve(initialBox).status === "UNSAT") {
          assumptionsConsistent = false;
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.VACUOUS_REQUIREMENT_ASSUMPTION,
              [selfName, "nonlinear assumption constraints are unsatisfiable"],
              assumeSyms[0]!,
            ),
          );
        }
      }
    }
  }

  // 2. S6002: REQUIREMENT_DECOMPOSITION_GAP
  if (assumptionsConsistent) {
    const parentReqSyms = children.filter(
      (c) => c.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, c) === "require",
    );
    const childReqs = children.filter((c) => c.ruleName === "RequirementUsage");

    if (parentReqSyms.length >= 1 && childReqs.length >= 1) {
      const parentAtoms = parentReqSyms.flatMap((s) =>
        extractLinearAtomsFromConstraintSymbol(db, s, subjectAliases, self.id),
      );
      const childAtoms: ExtractedLinearAtom[] = [];
      for (const cr of childReqs) {
        const crAliases = new Set<string>([...subjectAliases, ...getSubjectAliasesForReq(db, cr)]);
        for (const subC of db.childrenOf(cr.id)) {
          if (subC.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, subC) === "require") {
            childAtoms.push(...extractLinearAtomsFromConstraintSymbol(db, subC, crAliases, cr.id));
          }
        }
        // Also support RequirementUsage typed by a RequirementDefinition
        const crType = resolveTypeOf(db, cr);
        if (crType && crType.ruleName === "RequirementDefinition") {
          const typeAliases = new Set<string>([...crAliases, ...getSubjectAliasesForReq(db, crType)]);
          for (const subC of db.childrenOf(crType.id)) {
            if (subC.ruleName === "RequirementConstraintUsage" && getConstraintKind(db, subC) === "require") {
              childAtoms.push(...extractLinearAtomsFromConstraintSymbol(db, subC, typeAliases, crType.id));
            }
          }
        }
      }

      if (parentAtoms.length > 0 && childAtoms.length > 0) {
        const childVars = new Set(childAtoms.flatMap((a) => a.terms.map((t) => t.varName)));
        for (const pAtom of parentAtoms) {
          const allVarsCovered = pAtom.terms.every((t) => childVars.has(t.varName));
          if (!allVarsCovered) continue;

          const premises = [...assumeAtoms, ...childAtoms];
          const ent = checkLinearEntailment(premises, pAtom);
          if (!ent.entailed) {
            const wStr = formatWitnessAssignment(ent.witness);
            // Compute Craig interpolant explanation when child bounds are compared against strengthened region
            let interpNote = "";
            if (ent.witness) {
              const witnessAtoms: ExtractedLinearAtom[] = Object.entries(ent.witness).map(([varName, val]) => ({
                constraintSym: pAtom.constraintSym,
                terms: [{ varName, coeff: 1 }],
                operator: "==",
                rhs: val,
                rawText: `${varName} == ${val}`,
              }));
              const craigRes = CraigInterpolator.interpolateLRA(
                toCraigConstraints(witnessAtoms),
                toCraigConstraints([pAtom]),
              );
              if (craigRes.status === "INTERPOLANT_FOUND" && craigRes.summary) {
                interpNote = `; Craig separator over [${craigRes.sharedVars.join(", ")}]`;
              }
            }
            diagnostics.push(
              emitDiag(
                db,
                self,
                SysML2ErrorCode.REQUIREMENT_DECOMPOSITION_GAP,
                [
                  selfName,
                  `sub-requirements permit ${wStr || "unconstrained witness"} violating '${pAtom.rawText}'${interpNote}`,
                ],
                pAtom.constraintSym,
              ),
            );
            break;
          }
        }
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S6011 & S6012: State Machine Zeno Chattering & Orthogonal Region Write Races
// ---------------------------------------------------------------------------

interface ParsedTransitionFast {
  sym: SymbolEntry;
  source: string;
  target: string;
  trigger: string;
  hasEventOrDelay: boolean;
  guard: string;
  assignedVars: Set<string>;
}

function extractAssignedVarsInSubtree(cst: SysmlCstNode | null | undefined): Set<string> {
  const vars = new Set<string>();
  if (!cst) return vars;
  const assignNodes = findCstDescendants(cst, "AssignActionNode");
  for (const an of assignNodes) {
    const tgt = an.childForFieldName?.("targetFeature")?.text?.trim();
    if (tgt) {
      vars.add(tgt);
      const tail = tgt.split(".").pop();
      if (tail) vars.add(tail);
    }
  }
  const leaves = collectCstLeaves(cst);
  for (let i = 0; i < leaves.length - 1; i++) {
    if (leaves[i]!.text === ":=" && i > 0 && isSysmlIdentLeaf(leaves[i - 1]!.text)) {
      vars.add(leaves[i - 1]!.text);
    } else if (leaves[i]!.text === "=:" && isSysmlIdentLeaf(leaves[i + 1]?.text)) {
      vars.add(leaves[i + 1]!.text);
    }
  }
  return vars;
}

function parseTransitionFast(db: QueryDB, trSym: SymbolEntry): ParsedTransitionFast {
  const { node: cst } = getSymbolCst(db, trSym);
  const leaves = cst ? collectCstLeaves(cst) : [];

  let source = "";
  let target = "";
  let trigger = "";
  let hasEventOrDelay = false;
  let guard = "";

  // Check top-level tokens (braceDepth === 0)
  let braceDepth = 0;
  for (let i = 0; i < leaves.length; i++) {
    const tok = leaves[i]!.text;
    if (tok === "{") {
      braceDepth++;
      continue;
    }
    if (tok === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (braceDepth > 0) continue;

    if (tok === "first" && !source) {
      const ch = readDottedChainFromLeaves(leaves, i + 1);
      if (ch) source = ch.text;
    } else if (tok === "transition" && !source) {
      const next = leaves[i + 1]?.text;
      if (next && next !== "first" && isSysmlIdentLeaf(next)) {
        const afterNext = leaves[i + 2]?.text;
        if (afterNext !== "first") {
          const ch = readDottedChainFromLeaves(leaves, i + 1);
          if (ch) source = ch.text;
        }
      }
    } else if (tok === "accept" && !hasEventOrDelay) {
      hasEventOrDelay = true;
      const trigParts: string[] = [];
      for (let j = i + 1; j < leaves.length; j++) {
        const t = leaves[j]!.text;
        if (t === "if" || t === "do" || t === "then" || t === "{" || t === ";") break;
        trigParts.push(t);
      }
      trigger = trigParts.join(" ").trim();
    } else if ((tok === "after" || tok === "at" || tok === "when") && !hasEventOrDelay) {
      hasEventOrDelay = true;
      trigger = tok;
    } else if (tok === "if" && !guard) {
      const guardNode = cst?.childForFieldName?.("guard");
      if (guardNode) {
        guard = guardNode.text.trim();
      } else {
        const raw = db.cstText(trSym.startOffset, trSym.endOffset, trSym) || "";
        for (let j = i + 1; j < leaves.length; j++) {
          const endTok = leaves[j]!.text;
          if (endTok === "do" || endTok === "then" || endTok === "{" || endTok === ";") {
            guard = sliceBetweenLeaves(raw, leaves[i]!, leaves[j]!);
            break;
          }
        }
      }
    } else if (tok === "then" && !target) {
      const ch = readDottedChainFromLeaves(leaves, i + 1);
      if (ch) target = ch.text;
    }
  }

  const effectNode = cst?.childForFieldName?.("effect") ?? cst;
  const assignedVars = extractAssignedVarsInSubtree(effectNode);

  return { sym: trSym, source, target, trigger, hasEventOrDelay, guard, assignedVars };
}

function areGuardsJointlySatisfiable(db: QueryDB, trA: ParsedTransitionFast, trB: ParsedTransitionFast): boolean {
  if (trA.guard && isGuardTautologicallyFalse(db, trA.sym, trA.guard)) return false;
  if (trB.guard && isGuardTautologicallyFalse(db, trB.sym, trB.guard)) return false;
  if (!trA.guard || !trB.guard) return true;
  return !checkGuardsMutuallyExclusive(trA.guard, trB.guard).mutuallyExclusive;
}

/**
 * Validates S6011 (`zeno-chattering-transition-cycle`) and S6012 (`parallel-region-write-race`).
 */
export function checkStateMachineZenoAndParallelRaces(
  db: QueryDB,
  self: SymbolEntry,
): LintResult | LintResult[] | null {
  if (self.ruleName !== "StateDefinition" && self.ruleName !== "StateUsage" && self.ruleName !== "ExhibitStateUsage") {
    return null;
  }
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const diagnostics: LintResult[] = [];
  const children = db.childrenOf(self.id);
  const selfName = self.name || "state";

  // 1. S6011: ZENO_CHATTERING_TRANSITION_CYCLE (2-cycles without trigger/delay or guard-variable mutation)
  const directTransitions = children
    .filter((c) => c.ruleName === "TransitionUsage")
    .map((t) => parseTransitionFast(db, t));
  if (directTransitions.length >= 2) {
    const stateMutations = new Map<string, Set<string>>();
    for (const st of children) {
      if ((st.ruleName === "StateUsage" || st.ruleName === "ExhibitStateUsage") && st.name) {
        const { node: stCst } = getSymbolCst(db, st);
        stateMutations.set(st.name, extractAssignedVarsInSubtree(stCst));
      }
    }

    for (let i = 0; i < directTransitions.length; i++) {
      for (let j = i + 1; j < directTransitions.length; j++) {
        const t12 = directTransitions[i]!;
        const t21 = directTransitions[j]!;
        if (!t12.source || !t12.target || !t21.source || !t21.target) continue;
        if (t12.source === t12.target) continue;
        if (!(t12.source === t21.target && t12.target === t21.source)) continue;
        if (t12.hasEventOrDelay || t21.hasEventOrDelay) continue;
        if (!areGuardsJointlySatisfiable(db, t12, t21)) continue;

        const allMutated = new Set<string>([
          ...t12.assignedVars,
          ...t21.assignedVars,
          ...(stateMutations.get(t12.source) ?? []),
          ...(stateMutations.get(t12.target) ?? []),
        ]);

        const guardVars = new Set<string>();
        for (const gc of [...parseGuardConstraints(t12.guard), ...parseGuardConstraints(t21.guard)]) {
          guardVars.add(gc.variable);
          const tail = gc.variable.split(".").pop();
          if (tail) guardVars.add(tail);
        }

        const mutatesGuardVar = Array.from(guardVars).some((v) => allMutated.has(v));
        if (!mutatesGuardVar) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.ZENO_CHATTERING_TRANSITION_CYCLE,
              [`'${t12.source}' <-> '${t12.target}'`],
              t12.sym,
            ),
          );
          break;
        }
      }
      if (diagnostics.length > 0) break;
    }
  }

  // 2. S6012: PARALLEL_REGION_WRITE_RACE
  if (isTruthyMeta(self, "isParallel") || hasHeaderKeyword(db, self, "parallel")) {
    const regions = children.filter((c) => c.ruleName === "StateUsage" || c.ruleName === "ExhibitStateUsage");
    if (regions.length >= 2) {
      const regionTransitions = regions.map((reg) => {
        const { node: regCst } = getSymbolCst(db, reg);
        return {
          region: reg,
          transitions: db
            .childrenOf(reg.id)
            .filter((c) => c.ruleName === "TransitionUsage")
            .map((t) => parseTransitionFast(db, t)),
          actionVars: extractAssignedVarsInSubtree(regCst),
        };
      });

      let emittedRace = false;
      for (let a = 0; a < regionTransitions.length && !emittedRace; a++) {
        for (let b = a + 1; b < regionTransitions.length && !emittedRace; b++) {
          const regA = regionTransitions[a]!;
          const regB = regionTransitions[b]!;
          for (const trA of regA.transitions) {
            if (trA.assignedVars.size === 0) continue;
            for (const trB of regB.transitions) {
              if (trB.assignedVars.size === 0) continue;
              // Normalize trigger event token (`accept sig : Sig` -> `sig` / `Sig`)
              const normTrig = (t: string) =>
                t
                  .replace(/^via\s+\S+/, "")
                  .trim()
                  .split(/\s+/)[0] ?? "";
              if (normTrig(trA.trigger) !== normTrig(trB.trigger)) continue;
              if (!areGuardsJointlySatisfiable(db, trA, trB)) continue;

              const sharedVar =
                Array.from(trA.assignedVars).find((v) => !v.includes(".") && trB.assignedVars.has(v)) ??
                Array.from(trA.assignedVars).find((v) => trB.assignedVars.has(v));

              if (sharedVar) {
                diagnostics.push(
                  emitDiag(
                    db,
                    self,
                    SysML2ErrorCode.PARALLEL_REGION_WRITE_RACE,
                    [selfName, sharedVar, regA.region.name || `region_${a + 1}`, regB.region.name || `region_${b + 1}`],
                    trB.sym,
                  ),
                );
                emittedRace = true;
                break;
              }
            }
            if (emittedRace) break;
          }

          if (!emittedRace && regA.actionVars.size > 0 && regB.actionVars.size > 0) {
            const sharedActionVar =
              Array.from(regA.actionVars).find((v) => !v.includes(".") && regB.actionVars.has(v)) ??
              Array.from(regA.actionVars).find((v) => regB.actionVars.has(v));
            if (sharedActionVar) {
              diagnostics.push(
                emitDiag(
                  db,
                  self,
                  SysML2ErrorCode.PARALLEL_REGION_WRITE_RACE,
                  [
                    selfName,
                    sharedActionVar,
                    regA.region.name || `region_${a + 1}`,
                    regB.region.name || `region_${b + 1}`,
                  ],
                  regB.region,
                ),
              );
              emittedRace = true;
            }
          }
        }
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S6020 & S6022: Abstract Interpretation Domain / Div-By-Zero & Physical Bounds
// ---------------------------------------------------------------------------

const STRICTLY_POSITIVE_TYPES = new Set<string>(["Positive"]);

const NON_NEGATIVE_PHYSICAL_TYPES = new Set<string>([
  "Natural",
  "MassValue",
  "Mass",
  "DurationValue",
  "Duration",
  "ThermodynamicTemperatureValue",
  "ThermodynamicTemperature",
  "LengthValue",
  "FrequencyValue",
  "Frequency",
  "AreaValue",
  "Area",
  "VolumeValue",
  "Volume",
]);

function evalCstInterval(
  db: QueryDB,
  node: SysmlCstNode | null | undefined,
  scopeId: number | null,
  depth = 0,
): NumericalInterval {
  if (!node || depth > 12) return NumericalInterval.TOP;

  switch (node.type) {
    case "LiteralInteger":
    case "DECIMAL_VALUE": {
      const v = Number.parseInt(node.text.trim(), 10);
      return Number.isFinite(v) ? new NumericalInterval(v, v) : NumericalInterval.TOP;
    }
    case "LiteralReal":
    case "RealValue": {
      const v = Number.parseFloat(node.text.trim());
      return Number.isFinite(v) ? new NumericalInterval(v, v) : NumericalInterval.TOP;
    }
    case "MeasurementExpression": {
      const valNode = node.childForFieldName?.("value") ?? getCstChildren(node)[0];
      return evalCstInterval(db, valNode, scopeId, depth + 1);
    }
    case "UnaryExpression": {
      const op = node.childForFieldName?.("operator")?.text?.trim();
      const operand = node.childForFieldName?.("operand") ?? getCstChildren(node)[1];
      const inner = evalCstInterval(db, operand, scopeId, depth + 1);
      if (inner.isBottom() || inner.isTop()) return inner;
      if (op === "-") return new NumericalInterval(-inner.high, -inner.low);
      if (op === "+") return inner;
      return NumericalInterval.TOP;
    }
    case "FeatureReferenceExpression":
    case "PrimaryExpression": {
      const exprOperand = node.childForFieldName?.("operand");
      if (exprOperand) return evalCstInterval(db, exprOperand, scopeId, depth + 1);

      const refPath = node.text.trim();
      if (!refPath || refPath.includes("(")) return NumericalInterval.TOP;
      const feat = resolvePathInScope(db, scopeId, refPath) ?? resolveFeatureInScope(db, scopeId, refPath);
      if (!feat) return NumericalInterval.TOP;

      const dir = metaStr(feat, "direction");
      const valInfo = hasFeatureValueInfo(db, feat);
      // Do not treat an unbound or default-valued `in` parameter as a fixed constant
      if ((dir !== "in" && dir !== "inout") || (valInfo.hasValue && !valInfo.isDefault)) {
        const scalar = getFeatureValue(db, feat, feat.parentId ?? scopeId);
        if (typeof scalar === "number" && Number.isFinite(scalar)) {
          return new NumericalInterval(scalar, scalar);
        }
      }

      const tInfo = getFeatureDeclaredTypeRaw(db, feat);
      const normT = tInfo ? normalizeTypeName(tInfo.raw) : "";
      if (STRICTLY_POSITIVE_TYPES.has(normT)) return new NumericalInterval(1e-12, Infinity);
      if (NON_NEGATIVE_PHYSICAL_TYPES.has(normT)) return new NumericalInterval(0, Infinity);
      return NumericalInterval.TOP;
    }
    case "AdditiveExpression":
    case "MultiplicativeExpression": {
      const operands = node.childrenForFieldName?.("operand") ?? [];
      const ops = (node.childrenForFieldName?.("operator") ?? []).map((o) => o.text.trim());
      if (operands.length < 2 || ops.length < operands.length - 1) {
        return operands[0] ? evalCstInterval(db, operands[0], scopeId, depth + 1) : NumericalInterval.TOP;
      }
      let acc = evalCstInterval(db, operands[0]!, scopeId, depth + 1);
      for (let i = 0; i < ops.length; i++) {
        const rhs = evalCstInterval(db, operands[i + 1]!, scopeId, depth + 1);
        const op = ops[i]!;
        if (op === "+") acc = acc.add(rhs);
        else if (op === "-") acc = acc.sub(rhs);
        else if (op === "*") acc = acc.mul(rhs);
        else if (op === "/") acc = acc.div(rhs).result;
        else return NumericalInterval.TOP;
      }
      return acc;
    }
    default: {
      const chs = getCstChildren(node);
      if (chs.length === 1) return evalCstInterval(db, chs[0]!, scopeId, depth + 1);
      for (const ch of chs) {
        if (ch.type === "(" || ch.text === "(" || ch.type === ")" || ch.text === ")") continue;
        if (ch.type.includes("Expression") || ch.type.includes("Literal") || ch.type === "SequenceExpression") {
          return evalCstInterval(db, ch, scopeId, depth + 1);
        }
      }
      return NumericalInterval.TOP;
    }
  }
}

/**
 * Validates S6020 (`calc-domain-or-div-zero`) and S6022 (`physical-domain-impossibility`).
 */
export function checkCalcAndFeatureAbstractInterpretation(
  db: QueryDB,
  self: SymbolEntry,
): LintResult | LintResult[] | null {
  const { node: cst, baseOffset } = getSymbolCst(db, self);
  if (!cst || cstHasError(cst)) return null;

  const diagnostics: LintResult[] = [];
  const ownerName = self.name && self.name !== "<anonymous>" ? self.name : self.ruleName;
  const evalScopeId =
    self.ruleName === "CalculationDefinition" ||
    self.ruleName === "CalculationUsage" ||
    self.ruleName === "ConstraintDefinition"
      ? self.id
      : (self.parentId ?? self.id);

  // 1. S6020: Division/modulo by zero and math domain violations (`sqrt`, `log`/`ln`, `asin`/`acos`)
  if (
    self.ruleName === "CalculationDefinition" ||
    self.ruleName === "CalculationUsage" ||
    self.ruleName === "ConstraintDefinition" ||
    self.ruleName === "ConstraintUsage" ||
    self.ruleName === "AssertConstraintUsage" ||
    self.ruleName === "RequirementConstraintUsage" ||
    self.ruleName === "AttributeUsage" ||
    self.ruleName === "ReferenceUsage" ||
    self.ruleName === "DefaultReferenceUsage"
  ) {
    const exprNodes = collectOwnExpressionSubtrees(
      db,
      self,
      cst,
      baseOffset,
      new Set(["MultiplicativeExpression", "InvocationExpression"]),
    );

    for (const en of exprNodes) {
      if (en.type === "MultiplicativeExpression") {
        const operands = en.childrenForFieldName?.("operand") ?? [];
        const ops = (en.childrenForFieldName?.("operator") ?? []).map((o) => o.text.trim());
        for (let i = 0; i < ops.length && i + 1 < operands.length; i++) {
          const op = ops[i]!;
          if (op !== "/" && op !== "%") continue;
          const denomNode = operands[i + 1]!;
          const iv = evalCstInterval(db, denomNode, evalScopeId);
          if (!iv.isBottom() && iv.low === 0 && iv.high === 0) {
            diagnostics.push(
              emitDiag(
                db,
                self,
                SysML2ErrorCode.CALC_DOMAIN_OR_DIV_ZERO,
                [
                  ownerName,
                  `definite ${op === "%" ? "modulo" : "division"} by zero ('${collapseWhitespace(en.text)}')`,
                ],
                { node: denomNode, baseOffset },
              ),
            );
          }
        }
      } else if (en.type === "InvocationExpression") {
        const fnRaw = (en.childForFieldName?.("type") ?? getCstChildren(en)[0])?.text?.trim() ?? "";
        const fnShort = normalizeTypeName(fnRaw.split(".").pop() || fnRaw).toLowerCase();
        if (
          fnShort !== "sqrt" &&
          fnShort !== "log" &&
          fnShort !== "ln" &&
          fnShort !== "log10" &&
          fnShort !== "asin" &&
          fnShort !== "acos"
        ) {
          continue;
        }
        const firstArgMember = findFirstDescendant(en, "ArgumentMember");
        const argExpr = unwrapArgOwnedExpr(firstArgMember);
        if (!argExpr) continue;
        const iv = evalCstInterval(db, argExpr, evalScopeId);
        if (iv.isBottom() || iv.isTop()) continue;

        if (fnShort === "sqrt" && iv.high < 0) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.CALC_DOMAIN_OR_DIV_ZERO,
              [ownerName, `'sqrt' argument interval [${iv.low}, ${iv.high}] is strictly negative`],
              { node: argExpr, baseOffset },
            ),
          );
        } else if ((fnShort === "log" || fnShort === "ln" || fnShort === "log10") && iv.high <= 0) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.CALC_DOMAIN_OR_DIV_ZERO,
              [ownerName, `'${fnShort}' argument interval [${iv.low}, ${iv.high}] is non-positive`],
              { node: argExpr, baseOffset },
            ),
          );
        } else if ((fnShort === "asin" || fnShort === "acos") && (iv.high < -1 || iv.low > 1)) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.CALC_DOMAIN_OR_DIV_ZERO,
              [ownerName, `'${fnShort}' argument interval [${iv.low}, ${iv.high}] lies outside [-1, 1]`],
              { node: argExpr, baseOffset },
            ),
          );
        }
      }
    }
  }

  // 2. S6022: PHYSICAL_DOMAIN_IMPOSSIBILITY
  if (
    self.ruleName === "AttributeUsage" ||
    self.ruleName === "ReferenceUsage" ||
    self.ruleName === "DefaultReferenceUsage" ||
    self.ruleName === "ItemUsage"
  ) {
    let typeRaw = getFeatureDeclaredTypeRaw(db, self)?.raw ?? null;
    if (!typeRaw) {
      for (const cl of extractSpecializationClauses(db, self)) {
        const base = resolveSpecializationTarget(db, self, cl.targetPath, cl.ruleName);
        if (base) {
          typeRaw = getFeatureDeclaredTypeRaw(db, base)?.raw ?? null;
          if (typeRaw) break;
        }
      }
    }

    if (typeRaw) {
      const normType = normalizeTypeName(typeRaw);
      const isPositiveType = STRICTLY_POSITIVE_TYPES.has(normType);
      const isNonNegativeType = NON_NEGATIVE_PHYSICAL_TYPES.has(normType);

      if (isPositiveType || isNonNegativeType) {
        let valueExpr: SysmlCstNode | null = null;
        for (const ch of getCstChildren(cst)) {
          if (ch.type === "{" || ch.text === "{") break;
          if (ch.type === "FeatureValue" || ch.type === "_ValuePart" || ch.type === "ValuePart") {
            valueExpr =
              findFirstDescendant(ch, "OwnedExpression") ?? ch.childForFieldName?.("ownedRelatedElement") ?? ch;
            break;
          }
          if (ch.type === "OwnedExpression") {
            valueExpr = ch;
            break;
          }
        }

        if (valueExpr) {
          const iv = evalCstInterval(db, valueExpr, self.parentId ?? self.id);
          if (!iv.isBottom() && !iv.isTop()) {
            const measNode =
              valueExpr.type === "MeasurementExpression"
                ? valueExpr
                : findFirstDescendant(valueExpr, "MeasurementExpression");
            const unitText = measNode?.childForFieldName?.("unit")?.text?.trim() ?? "";
            const isTempType = normType === "ThermodynamicTemperatureValue" || normType === "ThermodynamicTemperature";

            if (isPositiveType && iv.high <= 0) {
              diagnostics.push(
                emitDiag(
                  db,
                  self,
                  SysML2ErrorCode.PHYSICAL_DOMAIN_IMPOSSIBILITY,
                  [ownerName, typeRaw, `value ${iv.high} violates strictly positive domain (> 0)`],
                  { node: valueExpr, baseOffset },
                ),
              );
            } else if (isTempType && (unitText === "degC" || unitText === "°C")) {
              if (iv.high < -273.15) {
                diagnostics.push(
                  emitDiag(
                    db,
                    self,
                    SysML2ErrorCode.PHYSICAL_DOMAIN_IMPOSSIBILITY,
                    [ownerName, typeRaw, `temperature ${iv.high} [degC] is below absolute zero (-273.15 degC)`],
                    { node: valueExpr, baseOffset },
                  ),
                );
              }
            } else if (isTempType && (unitText === "degF" || unitText === "°F")) {
              if (iv.high < -459.67) {
                diagnostics.push(
                  emitDiag(
                    db,
                    self,
                    SysML2ErrorCode.PHYSICAL_DOMAIN_IMPOSSIBILITY,
                    [ownerName, typeRaw, `temperature ${iv.high} [degF] is below absolute zero (-459.67 degF)`],
                    { node: valueExpr, baseOffset },
                  ),
                );
              }
            } else if (isNonNegativeType && iv.high < 0) {
              diagnostics.push(
                emitDiag(
                  db,
                  self,
                  SysML2ErrorCode.PHYSICAL_DOMAIN_IMPOSSIBILITY,
                  [ownerName, typeRaw, `negative value ${iv.high} violates non-negative physical domain (>= 0)`],
                  { node: valueExpr, baseOffset },
                ),
              );
            }
          }
        }
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S6030, S6032, S6041: Structural Balance, Flow Driver Conflict & Budget Roll-Up
// ---------------------------------------------------------------------------

const ADDITIVE_EXTENSIVE_PREFIXES = [
  "mass",
  "weight",
  "power",
  "cost",
  "price",
  "energy",
  "current",
  "area",
  "volume",
  "heat",
  "dissipation",
  "load",
  "budget",
  "capacity",
  "latency",
  "bandwidth",
  "memory",
  "storage",
  "total",
  "sum",
];

function isAdditiveExtensiveAttribute(attrName: string): boolean {
  const lower = attrName.toLowerCase();
  return ADDITIVE_EXTENSIVE_PREFIXES.some((p) => lower === p || lower.startsWith(p) || lower.endsWith(p));
}

function extractBindingEndpoints(db: QueryDB, bindSym: SymbolEntry): [string, string] | null {
  const refs = db.childrenOf(bindSym.id).filter((c) => c.kind === "Reference");
  const readRef = (ref: SymbolEntry): string => {
    const chain = db.childrenOf(ref.id).filter((c) => c.name && c.name !== "<anonymous>");
    if (chain.length > 0) return chain.map((c) => c.name).join(".");
    if (ref.name && ref.name !== "OwnedReferenceSubsetting") return ref.name.trim();
    return (db.cstText(ref.startOffset, ref.endOffset, ref) || "").trim();
  };
  if (refs.length >= 2) {
    const a = readRef(refs[0]!);
    const b = readRef(refs[1]!);
    if (a && b) return [a, b];
  }
  const { leaves } = getSymbolLeavesFast(db, bindSym);
  const bindIdx = leaves.findIndex((l) => l.text === "bind");
  if (bindIdx !== -1) {
    const lhs = readDottedChainFromLeaves(leaves, bindIdx + 1);
    if (lhs && leaves[lhs.nextIdx]?.text === "=") {
      const rhs = readDottedChainFromLeaves(leaves, lhs.nextIdx + 1);
      if (rhs) return [lhs.text, rhs.text];
    }
  }
  return null;
}

function extractFlowEndpointsFast(db: QueryDB, flowSym: SymbolEntry): { source: string; target: string } | null {
  const { leaves } = getSymbolLeavesFast(db, flowSym);
  let braceDepth = 0;
  for (let i = 0; i < leaves.length; i++) {
    const tok = leaves[i]!.text;
    if (tok === "{") braceDepth++;
    else if (tok === "}") braceDepth = Math.max(0, braceDepth - 1);
    if (braceDepth > 0) continue;

    if (tok === "from") {
      const src = readDottedChainFromLeaves(leaves, i + 1);
      if (src && leaves[src.nextIdx]?.text === "to") {
        const tgt = readDottedChainFromLeaves(leaves, src.nextIdx + 1);
        if (tgt) return { source: src.text, target: tgt.text };
      }
    }
  }
  const flowIdx = leaves.findIndex((l) => l.text === "flow");
  if (flowIdx !== -1) {
    let src = readDottedChainFromLeaves(leaves, flowIdx + 1);
    if (src && leaves[src.nextIdx]?.text !== "to") {
      src = readDottedChainFromLeaves(leaves, src.nextIdx);
    }
    if (src && leaves[src.nextIdx]?.text === "to") {
      const tgt = readDottedChainFromLeaves(leaves, src.nextIdx + 1);
      if (tgt) return { source: src.text, target: tgt.text };
    }
  }
  return null;
}

function getEffectiveLowerMultiplicity(db: QueryDB, partUsage: SymbolEntry): number {
  const mult = parseExplicitMultiplicity(db, partUsage);
  return mult ? mult.lower : 1;
}

function computeMinimumChildRollup(
  db: QueryDB,
  container: SymbolEntry,
  attrNames: readonly string[],
  visited = new Set<number>(),
): { sum: number; contributorCount: number } {
  if (visited.has(container.id)) return { sum: 0, contributorCount: 0 };
  visited.add(container.id);

  let sum = 0;
  let contributorCount = 0;

  for (const child of db.childrenOf(container.id)) {
    if (child.ruleName !== "PartUsage") continue;
    if (isTruthyMeta(child, "isRef") || hasHeaderKeyword(db, child, "ref")) continue;

    const lowerMult = getEffectiveLowerMultiplicity(db, child);
    if (lowerMult <= 0) continue;

    const childAttrs = collectEffectiveSubjectAttributes(db, child);
    let matchedVal: number | undefined;
    for (const candName of attrNames) {
      const v = childAttrs.get(candName);
      if (typeof v === "number" && Number.isFinite(v)) {
        matchedVal = v;
        break;
      }
    }
    if (matchedVal === undefined) {
      const partDef = resolveTypeOf(db, child);
      if (partDef) {
        for (const defChild of db.childrenOf(partDef.id)) {
          if (defChild.ruleName === "AttributeUsage" && defChild.name && attrNames.includes(defChild.name)) {
            const dv = getFeatureValue(db, defChild, partDef.id);
            if (typeof dv === "number" && Number.isFinite(dv)) {
              matchedVal = dv;
              break;
            }
          }
        }
      }
    }

    if (matchedVal !== undefined) {
      sum += lowerMult * matchedVal;
      contributorCount++;
    } else {
      const nested = computeMinimumChildRollup(db, child, attrNames, visited);
      if (nested.contributorCount > 0) {
        sum += lowerMult * nested.sum;
        contributorCount += nested.contributorCount;
      }
    }
  }

  return { sum, contributorCount };
}

/**
 * Validates S6030 (`over-or-under-constrained-part`), S6032 (`flow-network-driver-conflict`),
 * and S6041 (`multiplicity-budget-rollup-violation`).
 */
export function checkStructuralBalanceAndRollup(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  if (self.ruleName !== "PartDefinition" && self.ruleName !== "PartUsage") return null;
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const diagnostics: LintResult[] = [];
  const children = db.childrenOf(self.id);
  const selfName = self.name || "part";

  // 1. S6030: OVER_OR_UNDER_CONSTRAINED_PART (scalar binding connector & equality equation balance)
  if (self.ruleName === "PartDefinition") {
    const bindings = children.filter((c) => c.ruleName === "BindingConnectorAsUsage");
    const assertEqSyms = children.filter(
      (c) => c.ruleName === "AssertConstraintUsage" || c.ruleName === "ConstraintUsage",
    );

    if (bindings.length > 0 || assertEqSyms.length > 1) {
      const solver = new RealSimplexSolver();
      const parentMap = new Map<string, string>();
      const findRoot = (x: string): string => {
        let r = x;
        while (parentMap.has(r) && parentMap.get(r) !== r) r = parentMap.get(r)!;
        return r;
      };
      const unionVars = (a: string, b: string) => {
        const ra = findRoot(a);
        const rb = findRoot(b);
        if (ra !== rb) parentMap.set(ra, rb);
      };

      const fixedValues = new Map<string, number>();
      const allVars = new Set<string>();
      const eqEdges: Array<{ vars: string[]; sym: SymbolEntry; desc: string }> = [];

      const registerVar = (pathStr: string) => {
        allVars.add(pathStr);
        if (!parentMap.has(pathStr)) parentMap.set(pathStr, pathStr);
        const resolved = resolvePathInScope(db, self.id, pathStr) ?? resolveFeatureInScope(db, self.id, pathStr);
        if (resolved && !fixedValues.has(pathStr)) {
          const vInfo = hasFeatureValueInfo(db, resolved);
          if (vInfo.hasValue && !vInfo.isDefault) {
            const val = getFeatureValue(db, resolved, resolved.parentId ?? self.id);
            if (typeof val === "number" && Number.isFinite(val)) {
              fixedValues.set(pathStr, val);
              solver.addConstraint({
                terms: [{ varName: pathStr, coeff: 1 }],
                operator: "==",
                rhs: val,
                expression: `${pathStr} == ${val}`,
              });
            }
          }
        }
      };

      const seenPairs = new Set<string>();
      for (const bSym of bindings) {
        const pair = extractBindingEndpoints(db, bSym);
        if (!pair) continue;
        const [lhs, rhs] = pair;
        if (lhs === rhs) continue;
        const pairKey = lhs < rhs ? `${lhs}=${rhs}` : `${rhs}=${lhs}`;
        registerVar(lhs);
        registerVar(rhs);
        unionVars(lhs, rhs);
        eqEdges.push({ vars: [lhs, rhs], sym: bSym, desc: `bind ${lhs} = ${rhs}` });
        if (!seenPairs.has(pairKey)) {
          seenPairs.add(pairKey);
          solver.addConstraint({
            terms: [
              { varName: lhs, coeff: 1 },
              { varName: rhs, coeff: -1 },
            ],
            operator: "==",
            rhs: 0,
            expression: `${lhs} == ${rhs}`,
          });
        }
      }

      for (const aSym of assertEqSyms) {
        const atoms = extractLinearAtomsFromConstraintSymbol(db, aSym, new Set(), self.id).filter(
          (at) => at.operator === "==",
        );
        for (const at of atoms) {
          const vNames = at.terms.map((t) => t.varName);
          for (const v of vNames) registerVar(v);
          for (let k = 1; k < vNames.length; k++) unionVars(vNames[0]!, vNames[k]!);
          eqEdges.push({ vars: vNames, sym: aSym, desc: at.rawText });
          solver.addConstraint({
            terms: at.terms,
            operator: "==",
            rhs: at.rhs,
            expression: at.rawText,
          });
        }
      }

      if (eqEdges.length > 0) {
        const solveRes = solver.solve(1000);
        if (!solveRes.isFeasible) {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.OVER_OR_UNDER_CONSTRAINED_PART,
              [selfName, "contradictory scalar bindings / equality constraints have no solution"],
              eqEdges[eqEdges.length - 1]!.sym,
            ),
          );
        } else {
          // Check equation count vs variable count per connected component
          const varsByComp = new Map<string, Set<string>>();
          const eqsByComp = new Map<string, number>();
          for (const v of allVars) {
            const r = findRoot(v);
            if (!varsByComp.has(r)) varsByComp.set(r, new Set());
            varsByComp.get(r)!.add(v);
          }
          for (const eq of eqEdges) {
            if (eq.vars.length === 0) continue;
            const r = findRoot(eq.vars[0]!);
            eqsByComp.set(r, (eqsByComp.get(r) ?? 0) + 1);
          }
          for (const [r, compVars] of varsByComp) {
            const fixedCount = Array.from(compVars).filter((v) => fixedValues.has(v)).length;
            const eqCount = eqsByComp.get(r) ?? 0;
            if (fixedCount + eqCount > compVars.size) {
              diagnostics.push(
                emitDiag(
                  db,
                  self,
                  SysML2ErrorCode.OVER_OR_UNDER_CONSTRAINED_PART,
                  [
                    selfName,
                    `over-constrained component (${fixedCount + eqCount} scalar equations for ${compVars.size} variable(s): ${Array.from(compVars).join(", ")})`,
                  ],
                  eqEdges[eqEdges.length - 1]!.sym,
                ),
              );
              break;
            }
          }
        }
      }
    }
  }

  // 2. S6032: FLOW_NETWORK_DRIVER_CONFLICT
  const flows = children.filter((c) => c.ruleName === "FlowUsage" || c.ruleName === "SuccessionFlowUsage");
  if (flows.length >= 2) {
    const driversByTarget = new Map<string, { sources: Set<string>; lastFlow: SymbolEntry }>();
    for (const fl of flows) {
      const ep = extractFlowEndpointsFast(db, fl);
      if (!ep || !ep.source || !ep.target) continue;
      let rec = driversByTarget.get(ep.target);
      if (!rec) {
        rec = { sources: new Set<string>(), lastFlow: fl };
        driversByTarget.set(ep.target, rec);
      }
      rec.sources.add(ep.source);
      rec.lastFlow = fl;
    }

    for (const [targetPath, rec] of driversByTarget) {
      if (rec.sources.size < 2) continue;
      const targetSym = resolvePathInScope(db, self.id, targetPath) ?? resolveFeatureInScope(db, self.id, targetPath);
      if (targetSym) {
        const mult = parseExplicitMultiplicity(db, targetSym);
        if (mult && mult.upper > 1) continue;
      }
      const driversList = Array.from(rec.sources)
        .map((s) => `'${s}'`)
        .join(", ");
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.FLOW_NETWORK_DRIVER_CONFLICT, [targetPath, driversList], rec.lastFlow),
      );
    }
  }

  // 2b. S6032 Enhancement: Steady-state Kirchhoff flow conservation via FlowAlgebraOracle
  const selfIsConserved = hasConservedFlowAnnotation(db, self);
  if (selfIsConserved) {
    const dirFlowPorts: Array<{ dir: "in" | "out"; rate: number; sym: SymbolEntry; name: string }> = [];
    let allBound = true;
    const oracle = new FlowAlgebraOracle();
    let litCounter = 1;

    for (const ch of children) {
      if (ch.kind !== "Usage") continue;
      const dir = metaStr(ch, "direction");
      if (dir !== "in" && dir !== "out") continue;
      const extracted = extractConservedFlowRate(db, ch, self.id);
      if (!extracted) {
        allBound = false;
        break;
      }
      const pName = ch.name || `port_${ch.id}`;
      const pType = `ConservedPort_${ch.id}`;
      oracle.assertLiteral({
        id: litCounter++,
        predicate: "portType",
        args: [pType, [{ name: extracted.attrName, direction: dir, isFlow: true }]],
      });
      oracle.assertLiteral({
        id: litCounter++,
        predicate: "portUsage",
        args: [pName, pType, false],
      });
      dirFlowPorts.push({ dir, rate: extracted.value, sym: ch, name: pName });
    }

    const inPorts = dirFlowPorts.filter((p) => p.dir === "in");
    const outPorts = dirFlowPorts.filter((p) => p.dir === "out");
    if (allBound && inPorts.length >= 1 && outPorts.length >= 1) {
      oracle.checkSat();
      const sumIn = inPorts.reduce((acc, p) => acc + p.rate, 0);
      const sumOut = outPorts.reduce((acc, p) => acc + p.rate, 0);
      if (Math.abs(sumIn - sumOut) > 1e-6) {
        const fmt = (n: number) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(4)).toString());
        diagnostics.push({
          code: SysML2ErrorCode.FLOW_NETWORK_DRIVER_CONFLICT.code,
          severity: SysML2ErrorCode.FLOW_NETWORK_DRIVER_CONFLICT.severity,
          message: `Steady-state flow conservation violated on '${selfName}': inflow sum (${fmt(sumIn)}) != outflow sum (${fmt(sumOut)}).`,
          ...narrowDiagnosticRange(db, self, outPorts[outPorts.length - 1]!.sym),
        });
      }
    }
  }

  if (flows.length >= 2) {
    const inflowsByPart = new Map<string, Array<{ flowSym: SymbolEntry; endpoint: string }>>();
    const outflowsByPart = new Map<string, Array<{ flowSym: SymbolEntry; endpoint: string }>>();

    for (const fl of flows) {
      const ep = extractFlowEndpointsFast(db, fl);
      if (!ep || !ep.source || !ep.target) continue;
      const srcRoot = ep.source.split(".")[0]!;
      const tgtRoot = ep.target.split(".")[0]!;
      if (srcRoot === tgtRoot) continue;
      if (!outflowsByPart.has(srcRoot)) outflowsByPart.set(srcRoot, []);
      outflowsByPart.get(srcRoot)!.push({ flowSym: fl, endpoint: ep.source });
      if (!inflowsByPart.has(tgtRoot)) inflowsByPart.set(tgtRoot, []);
      inflowsByPart.get(tgtRoot)!.push({ flowSym: fl, endpoint: ep.target });
    }

    for (const [partName, inList] of inflowsByPart) {
      const outList = outflowsByPart.get(partName);
      if (!outList || inList.length === 0 || outList.length === 0) continue;
      const partSym = children.find((c) => c.ruleName === "PartUsage" && c.name === partName);
      if (!partSym) continue;

      const explicitNodeConserved = selfIsConserved || hasConservedFlowAnnotation(db, partSym);
      let sumIn = 0;
      let sumOut = 0;
      let allIncidentBound = true;
      const attrKinds = new Set<string>();

      for (const item of inList) {
        const rateInfo =
          extractConservedFlowRate(db, item.flowSym, self.id) ??
          extractEndpointConservedFlowRate(db, self.id, item.endpoint);
        if (!rateInfo) {
          allIncidentBound = false;
          break;
        }
        sumIn += rateInfo.value;
        attrKinds.add(rateInfo.attrName);
      }

      for (const item of outList) {
        if (!allIncidentBound) break;
        const rateInfo =
          extractConservedFlowRate(db, item.flowSym, self.id) ??
          extractEndpointConservedFlowRate(db, self.id, item.endpoint);
        if (!rateInfo) {
          allIncidentBound = false;
          break;
        }
        sumOut += rateInfo.value;
        attrKinds.add(rateInfo.attrName);
      }

      if (allIncidentBound && (explicitNodeConserved || attrKinds.size === 1) && Math.abs(sumIn - sumOut) > 1e-6) {
        const oracle = new FlowAlgebraOracle();
        oracle.assert1DPortValues({ portName: `${partName}_in`, massFlow: sumIn, pressure: 0 });
        oracle.assertSpatialFlux({ patchName: `${partName}_out`, integratedMassFlow: -sumOut, meanPressure: 0 });
        oracle.connect1Dto3D(`${partName}_in`, `${partName}_out`);
        const satRes = oracle.checkSat();
        if (!satRes.isSat || Math.abs(sumIn - sumOut) > 1e-6) {
          const fmt = (n: number) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(4)).toString());
          diagnostics.push({
            code: SysML2ErrorCode.FLOW_NETWORK_DRIVER_CONFLICT.code,
            severity: SysML2ErrorCode.FLOW_NETWORK_DRIVER_CONFLICT.severity,
            message: `Steady-state flow conservation violated at junction '${partName}': inflow sum (${fmt(sumIn)}) != outflow sum (${fmt(sumOut)}).`,
            ...narrowDiagnosticRange(db, self, outList[outList.length - 1]!.flowSym),
          });
        }
      }
    }
  }

  // 3. S6041: MULTIPLICITY_BUDGET_ROLLUP_VIOLATION
  const hasCompositeSubparts = children.some(
    (c) => c.ruleName === "PartUsage" && !isTruthyMeta(c, "isRef") && !hasHeaderKeyword(db, c, "ref"),
  );
  if (hasCompositeSubparts) {
    const upperBoundBudgets: Array<{ attr: string; limit: number; strict: boolean; sourceSym: SymbolEntry }> = [];

    // (a) Direct `assert constraint` / `constraint` on `self`
    for (const ch of children) {
      if (ch.ruleName !== "AssertConstraintUsage" && ch.ruleName !== "ConstraintUsage") continue;
      const scopedAtoms = extractLinearAtomsFromConstraintSymbol(db, ch, new Set([selfName]), self.id);
      const atoms =
        scopedAtoms.length > 0
          ? scopedAtoms
          : extractLinearAtomsFromConstraintSymbol(db, ch, new Set([selfName]), null);
      for (const at of atoms) {
        if (at.terms.length === 1 && at.terms[0]!.coeff > 0 && (at.operator === "<=" || at.operator === "<")) {
          const attr = at.terms[0]!.varName;
          const limit = at.rhs / at.terms[0]!.coeff;
          if (isAdditiveExtensiveAttribute(attr)) {
            upperBoundBudgets.push({ attr, limit, strict: at.operator === "<", sourceSym: ch });
          }
        }
      }
    }

    // (a2) Direct `max<Attr>` / `total<Attr>` / `<attr>Budget` / `<attr>Limit` attributes on `self`
    for (const ch of children) {
      if (ch.ruleName !== "AttributeUsage" || !ch.name) continue;
      const nm = ch.name;
      if (nm.startsWith("max") || nm.startsWith("total") || nm.endsWith("Budget") || nm.endsWith("Limit")) {
        const val = getFeatureValue(db, ch, self.id);
        if (typeof val === "number" && Number.isFinite(val) && val > 0 && isAdditiveExtensiveAttribute(nm)) {
          upperBoundBudgets.push({ attr: nm, limit: val, strict: false, sourceSym: ch });
        }
      }
    }

    // (b) Satisfied requirements (owned `satisfy Req;` or external `satisfy Req by <selfName>;`)
    const satisfiedReqs: Array<{ reqSym: SymbolEntry; satSym: SymbolEntry }> = [];
    for (const ch of children) {
      if (ch.ruleName === "SatisfyRequirementUsage") {
        const reqName = getRelationshipTargetName(db, ch);
        if (reqName) {
          const rSym = db
            .byName(reqName)
            .find((s) => s.ruleName === "RequirementDefinition" || s.ruleName === "RequirementUsage");
          if (rSym) satisfiedReqs.push({ reqSym: rSym, satSym: ch });
        }
      }
    }
    if (self.parentId !== null && self.name) {
      for (const sib of db.childrenOf(self.parentId)) {
        if (sib.ruleName !== "SatisfyRequirementUsage") continue;
        const { leaves } = getSymbolLeavesFast(db, sib);
        const byIdx = leaves.findIndex((l) => l.text === "by");
        const byTarget = byIdx !== -1 ? readDottedChainFromLeaves(leaves, byIdx + 1)?.text : null;
        if (byTarget === self.name) {
          const reqName = getRelationshipTargetName(db, sib);
          if (reqName) {
            const rSym = db
              .byName(reqName)
              .find((s) => s.ruleName === "RequirementDefinition" || s.ruleName === "RequirementUsage");
            if (rSym) satisfiedReqs.push({ reqSym: rSym, satSym: sib });
          }
        }
      }
    }
    if (self.name && self.kind === "Definition") {
      for (const rel of findRelationshipsTargeting(db, self, self.name, ["SatisfyRequirementUsage"])) {
        void rel;
      }
    }

    for (const { reqSym, satSym } of satisfiedReqs) {
      const aliases = new Set<string>([selfName, ...getSubjectAliasesForReq(db, reqSym)]);
      for (const rChild of db.childrenOf(reqSym.id)) {
        if (rChild.ruleName !== "RequirementConstraintUsage" || getConstraintKind(db, rChild) !== "require") continue;
        const scopedAtoms = extractLinearAtomsFromConstraintSymbol(db, rChild, aliases, reqSym.id);
        const atoms =
          scopedAtoms.length > 0 ? scopedAtoms : extractLinearAtomsFromConstraintSymbol(db, rChild, aliases, null);
        for (const at of atoms) {
          if (at.terms.length === 1 && at.terms[0]!.coeff > 0 && (at.operator === "<=" || at.operator === "<")) {
            const attr = at.terms[0]!.varName;
            const limit = at.rhs / at.terms[0]!.coeff;
            if (isAdditiveExtensiveAttribute(attr)) {
              upperBoundBudgets.push({
                attr,
                limit,
                strict: at.operator === "<",
                sourceSym: satSym.parentId === self.id ? satSym : self,
              });
            }
          }
        }
      }
    }

    const checkedAttrs = new Set<string>();
    for (const budget of upperBoundBudgets) {
      if (checkedAttrs.has(budget.attr)) continue;
      checkedAttrs.add(budget.attr);

      const candidateNames = [budget.attr];
      if (budget.attr.startsWith("total") && budget.attr.length > 5) {
        const stripped = budget.attr[5]!.toLowerCase() + budget.attr.slice(6);
        candidateNames.push(stripped);
      } else if (budget.attr.startsWith("max") && budget.attr.length > 3) {
        const stripped = budget.attr[3]!.toLowerCase() + budget.attr.slice(4);
        candidateNames.push(stripped);
      } else if (budget.attr.endsWith("Budget") && budget.attr.length > 6) {
        candidateNames.push(budget.attr.slice(0, -6));
      } else if (budget.attr.endsWith("Limit") && budget.attr.length > 5) {
        candidateNames.push(budget.attr.slice(0, -5));
      }

      const { sum, contributorCount } = computeMinimumChildRollup(db, self, candidateNames);
      if (contributorCount < 1) continue;

      const violated = budget.strict ? sum >= budget.limit - 1e-9 : sum > budget.limit + 1e-9;
      if (violated) {
        const fmt = (n: number) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(4)).toString());
        diagnostics.push(
          emitDiag(
            db,
            self,
            SysML2ErrorCode.MULTIPLICITY_BUDGET_ROLLUP_VIOLATION,
            [selfName, budget.attr, fmt(sum), fmt(budget.limit)],
            budget.sourceSym.id === self.id ? null : budget.sourceSym,
          ),
        );
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// Shared Helpers for User Workspace & Metadata / Conservation Inspection
// ---------------------------------------------------------------------------

function isUserWorkspaceSymbol(entry: SymbolEntry): boolean {
  const uri = entry.resourceId ?? entry.documentUri ?? "";
  if (uri === KERML_STDLIB_URI || uri.startsWith("sysml2://stdlib")) return false;
  return isSysmlLanguageSymbol(entry);
}

const CONSERVED_FLOW_ATTR_NAMES = new Set<string>([
  "flowrate",
  "massflow",
  "m_flow",
  "current",
  "rate",
  "flux",
  "volumetricflow",
  "heatflow",
]);

function hasConservedFlowAnnotation(db: QueryDB, sym: SymbolEntry): boolean {
  const checkSingle = (s: SymbolEntry): boolean => {
    const { leaves } = getHeaderLeavesBeforeBody(db, s);
    for (let i = 0; i < leaves.length - 1; i++) {
      if (leaves[i]!.text === "#" && leaves[i + 1]!.text.toLowerCase() === "conserved") return true;
    }
    for (const ch of db.childrenOf(s.id)) {
      if (ch.ruleName !== "MetadataUsage" && ch.ruleName !== "PrefixMetadataUsage") continue;
      const mName = extractMetadataTypeName(db, ch).toLowerCase();
      if (mName === "conserved" || mName.endsWith("::conserved")) return true;
    }
    return false;
  };
  if (checkSingle(sym)) return true;
  const tSym = resolveTypeOf(db, sym);
  return Boolean(tSym && isUserWorkspaceSymbol(tSym) && checkSingle(tSym));
}

function extractConservedFlowRate(
  db: QueryDB,
  sym: SymbolEntry,
  scopeId: number | null,
): { attrName: string; value: number } | null {
  for (const ch of db.childrenOf(sym.id)) {
    if (ch.kind !== "Usage") continue;
    let rawName = ch.name && ch.name !== "<anonymous>" ? ch.name : "";
    if (!rawName) {
      const specs = extractSpecializationClauses(db, ch);
      if (specs.length > 0) {
        rawName = specs[0]!.targetPath.split("::").pop()!.split(".").pop()!;
      }
    }
    if (!rawName || !CONSERVED_FLOW_ATTR_NAMES.has(rawName.toLowerCase())) continue;
    const vInfo = hasFeatureValueInfo(db, ch);
    if (!vInfo.hasValue || vInfo.isDefault) continue;
    const val = getFeatureValue(db, ch, sym.id);
    if (typeof val === "number" && Number.isFinite(val)) {
      return { attrName: rawName.toLowerCase(), value: val };
    }
  }
  const selfValInfo = hasFeatureValueInfo(db, sym);
  if (selfValInfo.hasValue && !selfValInfo.isDefault) {
    const directVal = getFeatureValue(db, sym, scopeId);
    if (typeof directVal === "number" && Number.isFinite(directVal)) {
      const nm = (sym.name || "flow").toLowerCase();
      return { attrName: CONSERVED_FLOW_ATTR_NAMES.has(nm) ? nm : "flow", value: directVal };
    }
  }
  return null;
}

function extractEndpointConservedFlowRate(
  db: QueryDB,
  scopeId: number,
  endpointPath: string,
): { attrName: string; value: number } | null {
  const segs = endpointPath
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segs.length === 0) return null;
  if (segs.length === 1) {
    const pSym = resolveFeatureInScope(db, scopeId, segs[0]!);
    return pSym ? extractConservedFlowRate(db, pSym, scopeId) : null;
  }
  const partSym = resolveFeatureInScope(db, scopeId, segs[0]!);
  if (!partSym) return null;
  const portName = segs[1]!;
  // Check redefined port on partSym first
  for (const ch of db.childrenOf(partSym.id)) {
    if (ch.kind !== "Usage") continue;
    const matchesDirect = ch.name === portName;
    const matchesRedef =
      !matchesDirect && extractSpecializationClauses(db, ch).some((cl) => cl.targetPath.split(".").pop() === portName);
    if (matchesDirect || matchesRedef) {
      const hit = extractConservedFlowRate(db, ch, partSym.id);
      if (hit) return hit;
    }
  }
  const partDef = resolveTypeOf(db, partSym);
  if (partDef) {
    for (const ch of db.childrenOf(partDef.id)) {
      if (ch.kind === "Usage" && ch.name === portName) {
        const hit = extractConservedFlowRate(db, ch, partDef.id);
        if (hit) return hit;
      }
    }
  }
  return null;
}

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

function extractMetadataTypeName(db: QueryDB, metaSym: SymbolEntry): string {
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

function extractConnectionEndpointsFast(db: QueryDB, connSym: SymbolEntry): { source: string; target: string } | null {
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

function evalSequenceIndexInterval(
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

function resolveSequenceMultiplicity(db: QueryDB, seqSym: SymbolEntry | null): ParsedMultiplicity | null {
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

/**
 * Validates S6021 (`sequence-index-out-of-bounds`) on 1-based KerML `seq#(idx)` expressions.
 */
export function checkSequenceIndexBounds(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  const { node: cst, baseOffset } = getSymbolCst(db, self);
  if (!cst || cstHasError(cst)) return null;

  const evalScopeId = self.kind === "Definition" || self.kind === "Package" ? self.id : (self.parentId ?? self.id);
  const primNodes = collectOwnExpressionSubtrees(db, self, cst, baseOffset, new Set(["PrimaryExpression"]));
  if (primNodes.length === 0) return null;

  const diagnostics: LintResult[] = [];

  for (const prim of primNodes) {
    const chs = getCstChildren(prim);
    const hashIdx = chs.findIndex((c) => c.type === "#" || c.text === "#");
    const indexOperand =
      prim.childForFieldName?.("indexOperand") ??
      (hashIdx !== -1
        ? chs.slice(hashIdx + 1).find((c) => c.type === "SequenceExpression" || c.type === "OwnedExpression")
        : null);
    if (!indexOperand) continue;

    // Extract sequence target path preceding `#(`
    const primLeaves = collectCstLeaves(prim);
    const hashLeafIdx = primLeaves.findIndex((l) => l.text === "#");
    if (hashLeafIdx <= 0 || primLeaves[hashLeafIdx + 1]?.text !== "(") continue;
    const seqChain = readDottedChainFromLeaves(primLeaves, 0);
    const seqPath =
      seqChain && seqChain.nextIdx <= hashLeafIdx
        ? seqChain.text
        : primLeaves
            .slice(0, hashLeafIdx)
            .map((l) => l.text)
            .join("");
    if (!seqPath) continue;

    const seqSym = resolvePathInScope(db, evalScopeId, seqPath) ?? resolveFeatureInScope(db, evalScopeId, seqPath);
    const mult = resolveSequenceMultiplicity(db, seqSym);

    const iv = evalSequenceIndexInterval(db, indexOperand, self, evalScopeId);
    if (iv.isBottom() || iv.isTop()) continue;

    const fmtNum = (n: number) =>
      !Number.isFinite(n)
        ? n > 0
          ? "*"
          : "-Infinity"
        : Number.isInteger(n)
          ? String(n)
          : Number(n.toFixed(4)).toString();
    const indexDesc = iv.low === iv.high ? fmtNum(iv.low) : `[${fmtNum(iv.low)}, ${fmtNum(iv.high)}]`;
    const upperBoundLabel = mult && Number.isFinite(mult.upper) ? String(mult.upper) : "*";
    const boundsDesc = `valid 1-based range is 1..${upperBoundLabel}`;

    if (iv.high < 1) {
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.SEQUENCE_INDEX_OUT_OF_BOUNDS, [seqPath, indexDesc, boundsDesc], {
          node: indexOperand,
          baseOffset,
        }),
      );
    } else if (mult && Number.isFinite(mult.upper) && iv.low > mult.upper) {
      diagnostics.push(
        emitDiag(db, self, SysML2ErrorCode.SEQUENCE_INDEX_OUT_OF_BOUNDS, [seqPath, indexDesc, boundsDesc], {
          node: indexOperand,
          baseOffset,
        }),
      );
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S6033: Cyber-Physical Nyquist & Sampling Stability (`CausalizationTheoryOracle`)
// ---------------------------------------------------------------------------

const CONTROLLER_PERIOD_ATTRS = new Set<string>(["sampleperiod", "samplingperiod", "dt", "controlperiod", "stepsize"]);

const CONTROLLER_FREQ_ATTRS = new Set<string>([
  "samplerate",
  "samplingrate",
  "samplingfrequency",
  "samplefrequency",
  "controlrate",
  "looprate",
]);

const PLANT_BANDWIDTH_ATTRS = new Set<string>([
  "bandwidth",
  "cutofffrequency",
  "maxfrequency",
  "signalbandwidth",
  "nyquistbandwidth",
]);

const PLANT_POLE_ATTRS = new Set<string>(["polefrequency", "dominantpolefrequency", "naturalfrequency"]);

const PLANT_TAU_ATTRS = new Set<string>(["timeconstant", "tau"]);

function extractFeatureScalarWithUnit(
  db: QueryDB,
  featSym: SymbolEntry,
  scopeId: number | null,
): { value: number; unit: string } | null {
  const val = getFeatureValue(db, featSym, scopeId);
  if (typeof val !== "number" || !Number.isFinite(val)) return null;
  let unit = "";
  const { node } = getSymbolCst(db, featSym);
  if (node) {
    const meas = findFirstDescendant(node, "MeasurementExpression");
    if (meas) {
      unit = meas.childForFieldName?.("unit")?.text?.trim() ?? "";
    }
  }
  if (!unit) {
    const { leaves } = getSymbolLeavesFast(db, featSym);
    for (let i = 0; i < leaves.length - 2; i++) {
      if (leaves[i]!.text === "[" && leaves[i + 2]?.text === "]") {
        unit = leaves[i + 1]!.text;
      }
    }
  }
  return { value: val, unit };
}

function toSeconds(value: number, unit: string): number {
  const u = unit.trim();
  if (u === "ms") return value * 1e-3;
  if (u === "us" || u === "µs") return value * 1e-6;
  if (u === "ns") return value * 1e-9;
  if (u === "min") return value * 60;
  return value;
}

function toHertz(value: number, unit: string): number {
  const u = unit.trim();
  if (u === "kHz") return value * 1e3;
  if (u === "MHz") return value * 1e6;
  if (u === "mHz") return value * 1e-3;
  return value;
}

function extractControllerSamplingHz(db: QueryDB, sym: SymbolEntry): { fsHz: number; sourceDesc: string } | null {
  const inspectSingle = (target: SymbolEntry): { fsHz: number; sourceDesc: string } | null => {
    for (const ch of db.childrenOf(target.id)) {
      if (ch.kind !== "Usage") continue;
      let nm = ch.name && ch.name !== "<anonymous>" ? ch.name : "";
      if (!nm) {
        const cls = extractSpecializationClauses(db, ch);
        if (cls.length > 0) nm = cls[0]!.targetPath.split(".").pop()!;
      }
      const low = nm.toLowerCase();
      if (CONTROLLER_PERIOD_ATTRS.has(low)) {
        const parsed = extractFeatureScalarWithUnit(db, ch, target.id);
        if (parsed && parsed.value > 0) {
          const tsSec = toSeconds(parsed.value, parsed.unit);
          if (tsSec > 0) {
            return {
              fsHz: 1.0 / tsSec,
              sourceDesc: `${nm} = ${parsed.value}${parsed.unit ? ` [${parsed.unit}]` : ""}`,
            };
          }
        }
      } else if (CONTROLLER_FREQ_ATTRS.has(low)) {
        const parsed = extractFeatureScalarWithUnit(db, ch, target.id);
        if (parsed && parsed.value > 0) {
          return {
            fsHz: toHertz(parsed.value, parsed.unit),
            sourceDesc: `${nm} = ${parsed.value}${parsed.unit ? ` [${parsed.unit}]` : ""}`,
          };
        }
      }
    }

    // Periodic `after <T_s> [s|ms]` trigger inside TransitionUsage / AcceptActionNode
    for (const ch of db.childrenOf(target.id)) {
      if (ch.ruleName !== "TransitionUsage" && ch.ruleName !== "AcceptActionNode") continue;
      const { leaves } = getSymbolLeavesFast(db, ch);
      for (let i = 0; i < leaves.length - 1; i++) {
        if (leaves[i]!.text !== "after") continue;
        const num = parseSignedNumberFromLeaves(leaves, i + 1);
        if (num && num.value > 0) {
          let unit = "";
          if (leaves[num.nextIdx]?.text === "[" && leaves[num.nextIdx + 2]?.text === "]") {
            unit = leaves[num.nextIdx + 1]!.text;
          }
          const tsSec = toSeconds(num.value, unit);
          if (tsSec > 0) {
            return { fsHz: 1.0 / tsSec, sourceDesc: `after ${num.value}${unit ? ` [${unit}]` : ""}` };
          }
        }
      }
    }

    // Also inspect owned `exhibit state` / `perform action` / `state` / `action` children
    for (const ch of db.childrenOf(target.id)) {
      if (
        ch.ruleName === "StateUsage" ||
        ch.ruleName === "ExhibitStateUsage" ||
        ch.ruleName === "ActionUsage" ||
        ch.ruleName === "PerformActionUsage"
      ) {
        const subHit = extractControllerSamplingHz(db, ch);
        if (subHit) return subHit;
      }
    }

    return null;
  };

  const direct = inspectSingle(sym);
  if (direct) return direct;
  const tSym = resolveTypeOf(db, sym);
  if (tSym && isUserWorkspaceSymbol(tSym) && tSym.id !== sym.id) {
    return inspectSingle(tSym);
  }
  return null;
}

interface PlantDynamicsRequirement {
  minSamplingHz: number;
  strictGreater: boolean;
  oraclePoleHz: number;
  detail: string;
}

function extractPlantDynamicsDemand(db: QueryDB, sym: SymbolEntry): PlantDynamicsRequirement | null {
  const inspectSingle = (target: SymbolEntry): PlantDynamicsRequirement | null => {
    for (const ch of db.childrenOf(target.id)) {
      if (ch.kind !== "Usage") continue;
      let nm = ch.name && ch.name !== "<anonymous>" ? ch.name : "";
      if (!nm) {
        const cls = extractSpecializationClauses(db, ch);
        if (cls.length > 0) nm = cls[0]!.targetPath.split(".").pop()!;
      }
      const low = nm.toLowerCase();
      if (PLANT_BANDWIDTH_ATTRS.has(low)) {
        const parsed = extractFeatureScalarWithUnit(db, ch, target.id);
        if (parsed && parsed.value > 0) {
          const fMax = toHertz(parsed.value, parsed.unit);
          return {
            minSamplingHz: 2.0 * fMax,
            strictGreater: true,
            oraclePoleHz: 0.2 * fMax,
            detail: `Nyquist limit > 2 * ${nm} (${fMax.toFixed(2)} Hz)`,
          };
        }
      } else if (PLANT_POLE_ATTRS.has(low)) {
        const parsed = extractFeatureScalarWithUnit(db, ch, target.id);
        if (parsed && parsed.value > 0) {
          const fPole = toHertz(parsed.value, parsed.unit);
          return {
            minSamplingHz: 5.0 * fPole,
            strictGreater: false,
            oraclePoleHz: fPole,
            detail: `5x dominant pole ${nm} (${fPole.toFixed(2)} Hz)`,
          };
        }
      } else if (PLANT_TAU_ATTRS.has(low)) {
        const parsed = extractFeatureScalarWithUnit(db, ch, target.id);
        if (parsed && parsed.value > 0) {
          const tauSec = toSeconds(parsed.value, parsed.unit);
          if (tauSec > 0) {
            const fPole = 1.0 / (2.0 * Math.PI * tauSec);
            return {
              minSamplingHz: 5.0 * fPole,
              strictGreater: false,
              oraclePoleHz: fPole,
              detail: `timeConstant ${tauSec}s -> f_pole = ${fPole.toFixed(2)} Hz`,
            };
          }
        }
      }
    }
    return null;
  };

  const direct = inspectSingle(sym);
  if (direct) return direct;
  const tSym = resolveTypeOf(db, sym);
  if (tSym && isUserWorkspaceSymbol(tSym) && tSym.id !== sym.id) {
    return inspectSingle(tSym);
  }
  return null;
}

/**
 * Validates S6033 (`cyber-physical-nyquist-violation`) using `CausalizationTheoryOracle`
 * and Nyquist-Shannon / pole-discretization criteria.
 */
export function checkCyberPhysicalNyquist(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  if (!isUserWorkspaceSymbol(self)) return null;
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const fmtHz = (n: number) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(2)).toString());
  const diagnostics: LintResult[] = [];

  const verifyLoopPair = (
    ctrlSym: SymbolEntry,
    ctrlInfo: { fsHz: number; sourceDesc: string },
    plantInfo: PlantDynamicsRequirement,
    targetSym: SymbolEntry | null,
  ) => {
    const oracle = new CausalizationTheoryOracle();
    const loopId = `${ctrlSym.name || "controller"}_loop`;
    oracle.assertLiteral({
      id: 1,
      predicate: "sampleRate",
      args: [loopId, ctrlInfo.fsHz, plantInfo.oraclePoleHz],
    });
    const oracleRes = oracle.checkSat();

    const nyquistViolated = plantInfo.strictGreater
      ? ctrlInfo.fsHz <= plantInfo.minSamplingHz + 1e-9
      : ctrlInfo.fsHz < plantInfo.minSamplingHz - 1e-9;

    if (nyquistViolated && (!oracleRes.isSat || nyquistViolated)) {
      const ctrlLabel = ctrlSym.name || self.name || ctrlSym.ruleName;
      const reqStr = plantInfo.strictGreater ? `> ${fmtHz(plantInfo.minSamplingHz)}` : fmtHz(plantInfo.minSamplingHz);
      diagnostics.push(
        emitDiag(
          db,
          self,
          SysML2ErrorCode.CYBER_PHYSICAL_NYQUIST_VIOLATION,
          [ctrlLabel, fmtHz(ctrlInfo.fsHz), reqStr, `${ctrlInfo.sourceDesc}; ${plantInfo.detail}`],
          targetSym,
        ),
      );
    }
  };

  // 1. Composite container (`PartDefinition`, `PartUsage`, `Package`) pairing discrete controllers & plants
  if (
    self.ruleName === "PartDefinition" ||
    self.ruleName === "PartUsage" ||
    self.ruleName === "Package" ||
    self.ruleName === "LibraryPackage"
  ) {
    const children = db.childrenOf(self.id);
    const subComponents = children.filter(
      (c) =>
        c.kind === "Usage" &&
        (c.ruleName === "PartUsage" ||
          c.ruleName === "ActionUsage" ||
          c.ruleName === "PerformActionUsage" ||
          c.ruleName === "StateUsage" ||
          c.ruleName === "ExhibitStateUsage"),
    );

    if (subComponents.length >= 2) {
      const ctrls: Array<{ sym: SymbolEntry; info: { fsHz: number; sourceDesc: string } }> = [];
      const plants: Array<{ sym: SymbolEntry; info: PlantDynamicsRequirement }> = [];
      for (const sc of subComponents) {
        const cInfo = extractControllerSamplingHz(db, sc);
        if (cInfo) ctrls.push({ sym: sc, info: cInfo });
        const pInfo = extractPlantDynamicsDemand(db, sc);
        if (pInfo) plants.push({ sym: sc, info: pInfo });
      }

      if (ctrls.length > 0 && plants.length > 0) {
        // Build explicit connection/flow/allocation adjacency if in Package; in PartDefinition/PartUsage colocation also suffices
        const linkedPairs = new Set<string>();
        for (const ch of children) {
          if (ch.ruleName === "ConnectionUsage") {
            const ep = extractConnectionEndpointsFast(db, ch);
            if (ep) {
              const a = ep.source.split(".")[0]!;
              const b = ep.target.split(".")[0]!;
              linkedPairs.add(`${a}<->${b}`);
              linkedPairs.add(`${b}<->${a}`);
            }
          } else if (ch.ruleName === "FlowUsage" || ch.ruleName === "SuccessionFlowUsage") {
            const ep = extractFlowEndpointsFast(db, ch);
            if (ep) {
              const a = ep.source.split(".")[0]!;
              const b = ep.target.split(".")[0]!;
              linkedPairs.add(`${a}<->${b}`);
              linkedPairs.add(`${b}<->${a}`);
            }
          } else if (ch.ruleName === "AllocationUsage") {
            const refs = db.childrenOf(ch.id).filter((r) => r.kind === "Reference");
            if (refs.length >= 2) {
              const a = (refs[0]!.name || "").split(".")[0]!;
              const b = (refs[1]!.name || "").split(".")[0]!;
              linkedPairs.add(`${a}<->${b}`);
              linkedPairs.add(`${b}<->${a}`);
            }
          } else if (ch.ruleName === "BindingConnectorAsUsage") {
            const pair = extractBindingEndpoints(db, ch);
            if (pair) {
              const a = pair[0].split(".")[0]!;
              const b = pair[1].split(".")[0]!;
              linkedPairs.add(`${a}<->${b}`);
              linkedPairs.add(`${b}<->${a}`);
            }
          }
        }

        const isColocatedComposite = self.ruleName === "PartDefinition" || self.ruleName === "PartUsage";
        const flaggedCtrls = new Set<number>();

        for (const ctrl of ctrls) {
          if (flaggedCtrls.has(ctrl.sym.id)) continue;
          for (const plant of plants) {
            if (ctrl.sym.id === plant.sym.id) continue;
            const pairKey = `${ctrl.sym.name || ""}<->${plant.sym.name || ""}`;
            if (!isColocatedComposite && !linkedPairs.has(pairKey)) continue;
            const prevLen = diagnostics.length;
            verifyLoopPair(ctrl.sym, ctrl.info, plant.info, ctrl.sym);
            if (diagnostics.length > prevLen) {
              flaggedCtrls.add(ctrl.sym.id);
              break;
            }
          }
        }
      }
    }
  }

  // 2. Self-contained controller+plant declaration on a single Definition (without child PartUsages)
  if (
    diagnostics.length === 0 &&
    (self.ruleName === "PartDefinition" || self.ruleName === "ActionDefinition" || self.ruleName === "StateDefinition")
  ) {
    const selfCtrl = extractControllerSamplingHz(db, self);
    const selfPlant = extractPlantDynamicsDemand(db, self);
    if (selfCtrl && selfPlant) {
      verifyLoopPair(self, selfCtrl, selfPlant, null);
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// S6042: 3D RCC-8 Spatial Envelope Clash, Protrusion & Max Wire Length
// ---------------------------------------------------------------------------

function parseMetadataNumericFields(db: QueryDB, metaSym: SymbolEntry): Map<string, number> {
  const fields = new Map<string, number>();
  const { leaves } = getSymbolLeavesFast(db, metaSym);
  for (let i = 0; i < leaves.length; i++) {
    const tok = leaves[i]!.text;
    if ((tok === "=" || tok === ":=") && i > 0) {
      const key = leaves[i - 1]!.text;
      if (!isSysmlIdentLeaf(key)) continue;
      const parsed = parseSignedNumberFromLeaves(leaves, i + 1);
      if (parsed && Number.isFinite(parsed.value)) {
        fields.set(key.toLowerCase(), parsed.value);
      }
    }
  }
  return fields;
}

/**
 * Extracts a 3D `CadBoundingBox` from `@SpatialBox` / `@BoundingBox` metadata on `entry` (or its `PartDefinition`).
 */
export function extractSpatialBoundingBox(db: QueryDB, entry: SymbolEntry): CadBoundingBox | null {
  const tryFromSymbol = (sym: SymbolEntry): CadBoundingBox | null => {
    for (const ch of db.childrenOf(sym.id)) {
      if (ch.ruleName !== "MetadataUsage") continue;
      const mName = normalizeTypeName(extractMetadataTypeName(db, ch)).toLowerCase();
      if (mName !== "spatialbox" && mName !== "boundingbox") continue;
      const f = parseMetadataNumericFields(db, ch);

      if (f.has("minx") && f.has("maxx")) {
        const minX = f.get("minx")!;
        const maxX = f.get("maxx")!;
        const minY = f.get("miny") ?? 0;
        const maxY = f.get("maxy") ?? 1;
        const minZ = f.get("minz") ?? 0;
        const maxZ = f.get("maxz") ?? 1;
        if (maxX > minX && maxY > minY && maxZ > minZ) {
          return {
            id: entry.name || String(entry.id),
            name: entry.name,
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ],
          };
        }
      }

      const x = f.get("x");
      const dx = f.get("dx") ?? f.get("width") ?? f.get("lx");
      if (x !== undefined && dx !== undefined && dx > 0) {
        const y = f.get("y") ?? 0;
        const z = f.get("z") ?? 0;
        const dy = f.get("dy") ?? f.get("height") ?? f.get("ly") ?? 1;
        const dz = f.get("dz") ?? f.get("depth") ?? f.get("lz") ?? 1;
        if (dy > 0 && dz > 0) {
          return {
            id: entry.name || String(entry.id),
            name: entry.name,
            min: [x, y, z],
            max: [x + dx, y + dy, z + dz],
          };
        }
      }
    }
    return null;
  };

  const direct = tryFromSymbol(entry);
  if (direct) return direct;
  const typeDef = resolveTypeOf(db, entry);
  if (typeDef && isUserWorkspaceSymbol(typeDef)) {
    return tryFromSymbol(typeDef);
  }
  return null;
}

function extractConnectionMaxLength(db: QueryDB, connSym: SymbolEntry): number | null {
  const inspectSym = (sym: SymbolEntry): number | null => {
    for (const ch of db.childrenOf(sym.id)) {
      if (ch.ruleName === "MetadataUsage") {
        const mName = normalizeTypeName(extractMetadataTypeName(db, ch)).toLowerCase();
        if (mName === "maxlength") {
          const f = parseMetadataNumericFields(db, ch);
          const v = f.get("max") ?? f.get("maxlength") ?? f.get("length") ?? f.get("limit") ?? f.get("value");
          if (v !== undefined && v > 0) return v;
        }
      } else if (ch.kind === "Usage") {
        let nm = ch.name && ch.name !== "<anonymous>" ? ch.name : "";
        if (!nm) {
          const cls = extractSpecializationClauses(db, ch);
          if (cls.length > 0) nm = cls[0]!.targetPath.split(".").pop()!;
        }
        if (nm.toLowerCase() === "maxlength") {
          const val = getFeatureValue(db, ch, sym.id);
          if (typeof val === "number" && Number.isFinite(val) && val > 0) return val;
        }
      }
    }
    return null;
  };

  const direct = inspectSym(connSym);
  if (direct !== null) return direct;
  const connDef = resolveTypeOf(db, connSym);
  if (connDef && isUserWorkspaceSymbol(connDef)) {
    return inspectSym(connDef);
  }
  return null;
}

/**
 * Validates S6042 (`spatial-envelope-clash-or-protrusion`) using `computeRcc8Relation`
 * and `SpatialPhysicsOracle`.
 */
export function checkSpatialEnvelopes(db: QueryDB, self: SymbolEntry): LintResult | LintResult[] | null {
  if (!isUserWorkspaceSymbol(self)) return null;
  const { node: cst } = getSymbolCst(db, self);
  if (cst && cstHasError(cst)) return null;

  const diagnostics: LintResult[] = [];
  const selfName = self.name || self.ruleName;

  // 1 & 2. Enclosure protrusion & sibling 3D AABB clash on PartDefinition / PartUsage
  if (self.ruleName === "PartDefinition" || self.ruleName === "PartUsage") {
    const parentBox = extractSpatialBoundingBox(db, self);
    const childBoxes: Array<{ sym: SymbolEntry; box: CadBoundingBox }> = [];

    for (const ch of db.childrenOf(self.id)) {
      if (ch.ruleName !== "PartUsage") continue;
      if (isTruthyMeta(ch, "isRef") || hasHeaderKeyword(db, ch, "ref")) continue;
      const box = extractSpatialBoundingBox(db, ch);
      if (box) childBoxes.push({ sym: ch, box });
    }

    if (parentBox) {
      for (const { sym: childSym, box: childBox } of childBoxes) {
        const rel = computeRcc8Relation(childBox, parentBox, 1e-6);
        if (rel !== "rcc:TPP" && rel !== "rcc:NTPP" && rel !== "rcc:EQ") {
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.SPATIAL_ENVELOPE_CLASH_OR_PROTRUSION,
              [
                childSym.name || selfName,
                `child part '${childSym.name || "part"}' protrudes outside enclosure '${selfName}' (${rel})`,
              ],
              childSym,
            ),
          );
        }
      }
    }

    for (let i = 0; i < childBoxes.length; i++) {
      for (let j = i + 1; j < childBoxes.length; j++) {
        const a = childBoxes[i]!;
        const b = childBoxes[j]!;
        const rel = computeRcc8Relation(a.box, b.box, 1e-6);
        if (rel !== "rcc:DC" && rel !== "rcc:EC") {
          const ox = Math.max(0, Math.min(a.box.max[0], b.box.max[0]) - Math.max(a.box.min[0], b.box.min[0]));
          const oy = Math.max(0, Math.min(a.box.max[1], b.box.max[1]) - Math.max(a.box.min[1], b.box.min[1]));
          const oz = Math.max(0, Math.min(a.box.max[2], b.box.max[2]) - Math.max(a.box.min[2], b.box.min[2]));
          const vol = Number((ox * oy * oz).toFixed(4));
          diagnostics.push(
            emitDiag(
              db,
              self,
              SysML2ErrorCode.SPATIAL_ENVELOPE_CLASH_OR_PROTRUSION,
              [
                selfName,
                `sibling parts '${a.sym.name || "partA"}' and '${b.sym.name || "partB"}' clash in 3D space (${rel}, overlap volume ${vol})`,
              ],
              b.sym,
            ),
          );
        }
      }
    }
  }

  // 3. ConnectionUsage physical length bound (`@MaxLength` / `maxLength`) via SpatialPhysicsOracle
  if (self.ruleName === "ConnectionUsage" && self.parentId !== null) {
    const maxL = extractConnectionMaxLength(db, self);
    if (maxL !== null) {
      const ep = extractConnectionEndpointsFast(db, self);
      if (ep && ep.source && ep.target) {
        const partAName = ep.source.split(".")[0]!;
        const partBName = ep.target.split(".")[0]!;
        const partASym = resolveFeatureInScope(db, self.parentId, partAName);
        const partBSym = resolveFeatureInScope(db, self.parentId, partBName);
        const boxA = partASym ? extractSpatialBoundingBox(db, partASym) : null;
        const boxB = partBSym ? extractSpatialBoundingBox(db, partBSym) : null;

        if (boxA && boxB) {
          const centerOf = (b: CadBoundingBox) => ({
            x: 0.5 * (b.min[0] + b.max[0]),
            y: 0.5 * (b.min[1] + b.max[1]),
            z: 0.5 * (b.min[2] + b.max[2]),
          });
          const oracle = new SpatialPhysicsOracle();
          const connLabel = self.name && self.name !== "<anonymous>" ? self.name : `${ep.source}->${ep.target}`;
          oracle.assertPortPosition(ep.source, centerOf(boxA));
          oracle.assertPortPosition(ep.target, centerOf(boxB));
          oracle.assertConnectionLengthBound({
            connectionName: connLabel,
            sourcePort: ep.source,
            targetPort: ep.target,
            maxLengthMeters: maxL,
          });
          const sat = oracle.checkSat();
          if (!sat.isSat) {
            const cA = centerOf(boxA);
            const cB = centerOf(boxB);
            const dist = Math.hypot(cB.x - cA.x, cB.y - cA.y, cB.z - cA.z);
            diagnostics.push(
              emitDiag(db, self, SysML2ErrorCode.SPATIAL_ENVELOPE_CLASH_OR_PROTRUSION, [
                connLabel,
                `connection span ${dist.toFixed(3)} between '${ep.source}' and '${ep.target}' exceeds maxLength ${maxL}`,
              ]),
            );
          }
        }
      }
    }
  }

  if (diagnostics.length === 0) return null;
  return diagnostics.length === 1 ? diagnostics[0]! : diagnostics;
}

// ---------------------------------------------------------------------------
// Composable Rule Bundles for Salsa Query Integration
// ---------------------------------------------------------------------------

export const sotaDefinitionLints = {
  specializationResolutionAndConformance: checkSpecializationResolutionAndConformance,
  visibilityAndImports: checkVisibilityAndImports,
  unusedImportAndPrivateMember: checkUnusedImportAndPrivateMember,
  inheritedMemberShadowing: checkInheritedMemberShadowing,
  disjointClassifierSpecialization: checkDisjointClassifierSpecialization,
  invocationAndTriggers: checkInvocationAndTriggers,
  invalidCastOrTypeTest: checkInvalidCastOrTypeTest,
  variationAndModifierRules: checkVariationAndModifierRules,
  individualAndPortionRules: checkIndividualAndPortionRules,
  metadataAnnotationValidity: checkMetadataAnnotationValidity,
  parallelStateAndSingletonMembers: checkParallelStateAndSingletonMembers,
  contractRefinement: checkContractRefinement,
  requirementDecompositionAndVacuity: checkRequirementDecompositionAndVacuity,
  stateMachineZenoAndParallelRaces: checkStateMachineZenoAndParallelRaces,
  calcAndFeatureAbstractInterpretation: checkCalcAndFeatureAbstractInterpretation,
  sequenceIndexBounds: checkSequenceIndexBounds,
  structuralBalanceAndRollup: checkStructuralBalanceAndRollup,
  cyberPhysicalNyquist: checkCyberPhysicalNyquist,
  spatialEnvelopes: checkSpatialEnvelopes,
};

export const sotaUsageLints = {
  specializationResolutionAndConformance: checkSpecializationResolutionAndConformance,
  visibilityAndImports: checkVisibilityAndImports,
  unusedImportAndPrivateMember: checkUnusedImportAndPrivateMember,
  usageDefinitionKindMatch: checkUsageDefinitionKindMatch,
  invocationAndTriggers: checkInvocationAndTriggers,
  invalidCastOrTypeTest: checkInvalidCastOrTypeTest,
  multiplicityNaturalBounds: checkMultiplicityNaturalBounds,
  variationAndModifierRules: checkVariationAndModifierRules,
  individualAndPortionRules: checkIndividualAndPortionRules,
  metadataAnnotationValidity: checkMetadataAnnotationValidity,
  parallelStateAndSingletonMembers: checkParallelStateAndSingletonMembers,
  contractRefinement: checkContractRefinement,
  requirementDecompositionAndVacuity: checkRequirementDecompositionAndVacuity,
  opaqueInterfaceCompatibility: checkOpaqueInterfaceCompatibility,
  stateMachineZenoAndParallelRaces: checkStateMachineZenoAndParallelRaces,
  calcAndFeatureAbstractInterpretation: checkCalcAndFeatureAbstractInterpretation,
  sequenceIndexBounds: checkSequenceIndexBounds,
  structuralBalanceAndRollup: checkStructuralBalanceAndRollup,
  cyberPhysicalNyquist: checkCyberPhysicalNyquist,
  spatialEnvelopes: checkSpatialEnvelopes,
};

export const sotaImportLints = {
  visibilityAndImports: checkVisibilityAndImports,
  unusedImportAndPrivateMember: checkUnusedImportAndPrivateMember,
};

export const sotaAliasLints = {
  specializationResolutionAndConformance: checkSpecializationResolutionAndConformance,
  visibilityAndImports: checkVisibilityAndImports,
};

export const sotaPackageLints = {
  invocationAndTriggers: checkInvocationAndTriggers,
  invalidCastOrTypeTest: checkInvalidCastOrTypeTest,
  metadataAnnotationValidity: checkMetadataAnnotationValidity,
  sequenceIndexBounds: checkSequenceIndexBounds,
  cyberPhysicalNyquist: checkCyberPhysicalNyquist,
};

/**
 * Evaluates all applicable SOTA static and live-formal lint rules on `self` in a single pass.
 */
export function runAllSotaLintsForSymbol(db: QueryDB, self: SymbolEntry): LintResult[] {
  const fns: SysML2LintFn[] = [
    checkSpecializationResolutionAndConformance,
    checkVisibilityAndImports,
    checkUnusedImportAndPrivateMember,
    checkInheritedMemberShadowing,
    checkUsageDefinitionKindMatch,
    checkDisjointClassifierSpecialization,
    checkInvocationAndTriggers,
    checkInvalidCastOrTypeTest,
    checkMultiplicityNaturalBounds,
    checkVariationAndModifierRules,
    checkIndividualAndPortionRules,
    checkMetadataAnnotationValidity,
    checkParallelStateAndSingletonMembers,
    checkContractRefinement,
    checkRequirementDecompositionAndVacuity,
    checkOpaqueInterfaceCompatibility,
    checkStateMachineZenoAndParallelRaces,
    checkCalcAndFeatureAbstractInterpretation,
    checkSequenceIndexBounds,
    checkStructuralBalanceAndRollup,
    checkCyberPhysicalNyquist,
    checkSpatialEnvelopes,
  ];
  const results: LintResult[] = [];
  for (const fn of fns) {
    const res = fn(db, self);
    if (!res) continue;
    if (Array.isArray(res)) {
      results.push(...res);
    } else {
      results.push(res);
    }
  }
  return results;
}
