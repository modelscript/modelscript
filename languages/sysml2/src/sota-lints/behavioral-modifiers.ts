// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LintResult } from "@modelscript/dsl";
import { type QueryDB, type SymbolEntry } from "@modelscript/runtime";
import {
  collectCstLeaves,
  findFirstDescendant,
  getCstChildren,
  isSysmlIdentLeaf,
  parseSignedNumberFromLeaves,
  stripLeadingTilde,
  type SysmlCstNode,
} from "../cst-utils.js";
import { createSysML2Diagnostic, SysML2ErrorCode } from "../errors.js";
import { getFeatureValue, metaStr, resolveFeatureInScope, resolveTypeOf } from "../queries.js";
import {
  inferExpressionType,
  isStdlibOrBuiltinSymbol,
  isTypeAssignable,
  normalizeTypeName,
  resolvePathInScope,
} from "../type-checker.js";
import {
  cstHasError,
  emitDiag,
  extractSpecializationClauses,
  getFeatureDeclaredTypeRaw,
  getHeaderLeavesBeforeBody,
  getNodeOffsets,
  getSymbolCst,
  getSymbolLeavesFast,
  hasFeatureValueInfo,
  hasHeaderKeyword,
  isSysmlLanguageSymbol,
  isTruthyMeta,
  parseExplicitMultiplicity,
  resolveSpecializationTarget,
  resolveTypeOrClassifierByName,
} from "./shared.js";

// ---------------------------------------------------------------------------
// S3015 & S3016: Invocations & Trigger / Guard / Filter Expressions
// ---------------------------------------------------------------------------

export function collectOwnExpressionSubtrees(
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

export function unwrapArgOwnedExpr(node: SysmlCstNode | null | undefined): SysmlCstNode | null {
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
