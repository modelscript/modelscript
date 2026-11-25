// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LintRangeOptions, LintResult } from "@modelscript/dsl";
import { isTypeLikeSymbol, type QueryDB, type SymbolEntry } from "@modelscript/runtime";
import {
  collectCstLeaves,
  findFirstDescendant,
  getCstChildren,
  parseSysmlSource,
  readDottedChainFromLeaves,
  stripLeadingTilde,
  type CstLeaf,
  type SysmlCstNode,
} from "../cst-utils.js";
import { createSysML2Diagnostic, type ErrorCodeDef } from "../errors.js";
import { getRelationshipTargetName, metaStr, resolveFeatureInScope, resolveTypeOf } from "../queries.js";
import { isStdlibOrBuiltinSymbol, normalizeTypeName, resolvePathInScope } from "../type-checker.js";

export type SysML2LintFn = (db: QueryDB, self: SymbolEntry) => LintResult | LintResult[] | null;

// ---------------------------------------------------------------------------
// Zero-Reparse CST & Narrow Diagnostic Span Helpers
// ---------------------------------------------------------------------------

export function cstHasError(node: SysmlCstNode | null | undefined): boolean {
  if (!node) return false;
  if (typeof node.hasError === "function") return Boolean(node.hasError());
  return Boolean(node.hasError);
}

export function getSymbolCst(db: QueryDB, entry: SymbolEntry): { node: SysmlCstNode | null; baseOffset: number } {
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

export function getSymbolLeavesFast(db: QueryDB, entry: SymbolEntry): { leaves: CstLeaf[]; baseOffset: number } {
  const { node, baseOffset } = getSymbolCst(db, entry);
  if (!node) return { leaves: [], baseOffset: 0 };
  return { leaves: collectCstLeaves(node), baseOffset };
}

export function getNodeOffsets(node: SysmlCstNode, baseOffset = 0): { startOffset: number; endOffset: number } | null {
  const rawStart = node.startIndex ?? node.startOffset;
  const rawEnd = node.endIndex ?? node.endOffset;
  if (typeof rawStart === "number" && typeof rawEnd === "number" && rawEnd > rawStart) {
    return { startOffset: baseOffset + rawStart, endOffset: baseOffset + rawEnd };
  }
  return null;
}

export function clampSingleLineSpan(
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

export function emitDiag<TArgs extends readonly unknown[]>(
  db: QueryDB,
  self: SymbolEntry,
  def: ErrorCodeDef<TArgs>,
  args: TArgs,
  target?: SymbolEntry | { node: SysmlCstNode; baseOffset?: number | undefined } | LintRangeOptions | null,
): LintResult {
  return createSysML2Diagnostic(def, args, narrowDiagnosticRange(db, self, target));
}

export function isTruthyMeta(entry: SymbolEntry, key: string): boolean {
  const raw = entry.metadata?.[key];
  if (raw === true) return true;
  if (typeof raw === "string") {
    const clean = raw.trim().toLowerCase();
    return clean === "true" || clean === key.toLowerCase() || (clean.length > 0 && clean !== "false");
  }
  return false;
}

export function getHeaderLeavesBeforeBody(db: QueryDB, entry: SymbolEntry): { leaves: CstLeaf[]; baseOffset: number } {
  const { leaves, baseOffset } = getSymbolLeavesFast(db, entry);
  const out: CstLeaf[] = [];
  for (const lf of leaves) {
    if (lf.text === "{" || lf.text === ";" || lf.text === "=" || lf.text === ":=") break;
    out.push(lf);
  }
  return { leaves: out, baseOffset };
}

export function hasHeaderKeyword(db: QueryDB, entry: SymbolEntry, keyword: string): boolean {
  const { leaves } = getHeaderLeavesBeforeBody(db, entry);
  return leaves.some((l) => l.text === keyword);
}

export function getFeatureDeclaredTypeRaw(
  db: QueryDB,
  entry: SymbolEntry,
): { raw: string; refChild?: SymbolEntry } | null {
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

export function isSysmlLanguageSymbol(entry: SymbolEntry): boolean {
  if (!entry.language) return true;
  const lower = entry.language.toLowerCase();
  return lower === "sysml2" || lower === "sysml" || lower === "kerml";
}

export function isDeclarationEntry(entry: SymbolEntry): boolean {
  return entry.kind !== "Reference" && entry.kind !== "Specialization" && entry.kind !== "Import";
}

// ---------------------------------------------------------------------------
// Inherited / Enclosing Scope Feature Resolution (S2007, S3012, S3013, S3014)
// ---------------------------------------------------------------------------

export const EXCLUDED_REFERENCE_SUBSETTING_OWNERS = new Set<string>([
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

export function resolveTypeOrClassifierByName(
  db: QueryDB,
  scopeId: number | null,
  rawName: string,
): SymbolEntry | null {
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
export function hasExternalOrStdlibBaseInHierarchy(
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

export function findInheritedMemberOnSymbol(
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

export function resolveSpecializationTarget(
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

export interface SpecializationClauseInfo {
  ruleName:
    "OwnedRedefinition" | "OwnedSubsetting" | "OwnedReferenceSubsetting" | "OwnedCrossSubsetting" | "AliasMember";
  kindLabel: string;
  targetPath: string;
  range: LintRangeOptions;
}

export function extractSpecializationClauses(db: QueryDB, self: SymbolEntry): SpecializationClauseInfo[] {
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

export interface ParsedMultiplicity {
  lower: number;
  upper: number;
  label: string;
}

export function parseExplicitMultiplicity(db: QueryDB, entry: SymbolEntry): ParsedMultiplicity | null {
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

export function hasFeatureValueInfo(
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
