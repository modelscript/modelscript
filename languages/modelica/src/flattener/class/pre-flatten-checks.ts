// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pre-flattening structural validation checks for Modelica classes:
 * non-instantiable specializations, partial root classes, extends clauses,
 * duplicate top-level/local/inherited elements, and invalid break modifiers.
 */

import type { DAEBuilder, SymbolEntry, SymbolId } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";
import { isScopeEncapsulated } from "../../queries.js";
import type { checkTypeAliasSpecialization } from "../elaboration/index.js";
import { getSymbolQualifiedName, tokenizeCommentStrippedWords } from "../expressions/index.js";
import { getElementDiagRange } from "../support/range-utils.js";
import { extractClassAnnotations } from "./annotations-and-extensions.js";
import {
  dotPrefixPrimitiveTypeWords,
  findRedeclareSameNameRangeCst,
  findRedeclareTypeSpecRangeCst,
  formatParenModArgEquals,
  hasClassPrefixWordCst,
  hasCommandLineFlagInCst,
  hasNestedCommandLineFlagCst,
  moveCompArrayDimToTypeName,
  moveTypeArrayDimToCompName,
  parseComponentDeclTokensCst,
  replaceAliasDotPrefix,
  startsWithDottedIdentifierPair,
  startsWithPrimitiveTypeWord,
  stripTrailingSemicolon,
} from "./cst-token-helpers.js";
import type {
  ClassFlattenerContext,
  ComponentInstanceQueryData,
  CstNodeLike,
  EffectiveModLike,
  FlattenOptionsExtended,
  ModArgLike,
  NameResolverFn,
  QueryDBWithCaches,
  SymbolMetaLike,
} from "./types.js";

export interface PreFlattenValidationParams {
  ctx: ClassFlattenerContext;
  rootClassId: SymbolId;
  dae: DAEBuilder;
  classCst: CstNodeLike | null;
  rootSym: SymbolEntry | null | undefined;
  rootName: string;
  specKind: string | null;
  isOldInst: boolean;
  checkTypeAliasSpec: (typeSymId: SymbolId) => ReturnType<typeof checkTypeAliasSpecialization>;
}

/**
 * Runs pre-flattening structural validation checks on `rootClassId`.
 * Returns `true` if a fatal diagnostic was emitted and flattening should abort immediately.
 */
export function runPreFlattenValidation(params: PreFlattenValidationParams): boolean {
  const { ctx, rootClassId, dae, classCst, rootSym, rootName, specKind, isOldInst, checkTypeAliasSpec } = params;
  // Check for non-instantiable class specializations (package, function, etc.)
  const classCstForCheck = classCst as SyntaxNode | null;
  const optIsNested = hasNestedCommandLineFlagCst(classCstForCheck, "-d=-newInst");
  const hasExtendsInPkg =
    specKind === "package" &&
    !hasCommandLineFlagInCst(classCstForCheck, "-d=-newInst") &&
    ctx.db.childrenOf(rootClassId).some((c) => c.kind === "Extends");
  const allowOldInstSpec = isOldInst && !(specKind === "package" && (optIsNested || hasExtendsInPkg));
  if (specKind && !((specKind === "function" || specKind === "package") && allowOldInstSpec)) {
    let startPos = classCstForCheck?.startPosition;
    let startB = classCstForCheck?.startIndex ?? classCstForCheck?.startOffset ?? 0;
    const pfxNode = classCstForCheck ? Cst.ClassDefinition.classPrefixes(classCstForCheck) : null;
    if (pfxNode?.children) {
      for (const child of pfxNode.children) {
        if (child.type !== "comment" && child.type !== "description") {
          startPos = child.startPosition ?? startPos;
          startB = child.startIndex ?? child.startOffset ?? startB;
          break;
        }
      }
    }
    const range = classCstForCheck
      ? {
          startOffset: startB,
          endOffset: classCstForCheck.endIndex ?? classCstForCheck.endOffset ?? 0,
          startPosition: startPos,
          endPosition: classCstForCheck.endPosition,
        }
      : undefined;
    const msg =
      specKind === "type"
        ? `In class .${rootName}, class specialization 'type' can only be derived from predefined types.`
        : `Cannot instantiate ${rootName} due to class specialization ${specKind}.`;
    dae.diagnostics.push({
      severity: "error",
      message: msg,
      range: specKind === "type" ? undefined : range,
    });
    return true;
  }

  // Check for partial root class
  const isPartialRoot = ctx.isClassPartial(rootClassId) || hasClassPrefixWordCst(classCstForCheck, "partial");
  if (isPartialRoot) {
    let startPos = classCstForCheck?.startPosition;
    let startB = classCstForCheck?.startIndex ?? classCstForCheck?.startOffset ?? 0;
    const pfxNode = classCstForCheck ? Cst.ClassDefinition.classPrefixes(classCstForCheck) : null;
    if (pfxNode?.children) {
      for (const child of pfxNode.children) {
        if (child.type !== "comment" && child.type !== "description") {
          startPos = child.startPosition ?? startPos;
          startB = child.startIndex ?? child.startOffset ?? startB;
          break;
        }
      }
    }
    const range = classCstForCheck
      ? {
          startOffset: startB,
          endOffset: classCstForCheck.endIndex ?? classCstForCheck.endOffset ?? 0,
          startPosition: startPos,
          endPosition: classCstForCheck.endPosition,
        }
      : undefined;
    dae.diagnostics.push({
      severity: "error",
      code: ModelicaErrorCode.PARTIAL_INSTANTIATION.code,
      message: ModelicaErrorCode.PARTIAL_INSTANTIATION.message(rootName),
      range,
    });
    return true;
  }

  ctx.validateOperatorRecords(dae, rootClassId);
  ctx.validateClassSpecializationRestrictions(dae, rootClassId);
  extractClassAnnotations(ctx.db, dae, rootClassId);

  ctx.expandableBuses.clear();
  let useLocalDirection = Boolean(
    (ctx.options as FlattenOptionsExtended)?.useLocalDirection ||
    classCst?.text?.includes("--useLocalDirection") ||
    classCst?.tree?.rootNode?.text?.includes("--useLocalDirection") ||
    (ctx.db.cstNode(rootClassId) as CstNodeLike | null)?.text?.includes("--useLocalDirection"),
  );
  if (!useLocalDirection && rootSym?.resourceId) {
    const src = (ctx.db as QueryDBWithCaches).source?.(rootSym.resourceId);
    if (typeof src === "string" && src.includes("--useLocalDirection")) {
      useLocalDirection = true;
    }
  }
  ctx.useLocalDirection = useLocalDirection;
  if (classCst) {
    const findDesc = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
      if (!n) return null;
      if (Cst.LongClassSpecifier.is(n)) return Cst.LongClassSpecifier.description(n);
      if (Cst.ShortClassSpecifier.is(n)) return Cst.ShortClassSpecifier.description(n);
      if (Cst.ClassDefinition.is(n)) {
        const spec = Cst.ClassDefinition.classSpecifier(n);
        const d = findDesc(spec);
        if (d) return d;
      }
      for (const child of n.children) {
        if (Cst.LongClassSpecifier.is(child)) return Cst.LongClassSpecifier.description(child);
        if (Cst.ShortClassSpecifier.is(child)) return Cst.ShortClassSpecifier.description(child);
      }
      return null;
    };
    const descNode = findDesc(classCst as SyntaxNode);
    if (descNode) {
      let descText = descNode.text?.trim() ?? "";
      if (descText.startsWith('"') && descText.endsWith('"')) {
        descText = descText.slice(1, -1);
        if (descText) dae.description = descText;
      }
    }
  }

  // Validate extends clauses (illegal components in path, replaceable base classes, inherited extends cycles)
  const extendsClauses = ctx.db.childrenOf(rootClassId).filter((c) => c.kind === "Extends");
  for (let extIdx = 0; extIdx < extendsClauses.length; extIdx++) {
    const ext = extendsClauses[extIdx]!;
    const extCst = ctx.db.cstNode(ext.id) as CstNodeLike | null;
    const extRange = extCst
      ? {
          startOffset: extCst.startIndex ?? extCst.startOffset ?? 0,
          endOffset: extCst.endIndex ?? extCst.endOffset ?? 0,
        }
      : undefined;

    const parts = ext.name.split(".");
    let currentScope: SymbolEntry | null = ctx.db.symbol(rootClassId) ?? null;
    const isEncapsulatedRoot = isScopeEncapsulated(ctx.db, rootClassId);
    const resolvedChain: { name: string; symbol: SymbolEntry | null }[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      let resolved: SymbolEntry | null = null;
      if (i === 0) {
        const resolver =
          ctx.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", currentScope?.id ?? rootClassId) ??
          ctx.db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope?.id ?? rootClassId);
        resolved = resolver ? resolver(part) : null;
        if (!resolved && !isEncapsulatedRoot) {
          resolved = ctx.db.byName(part).find((e) => e.kind === "Class" || e.kind === "Component") ?? null;
        }
      } else {
        if (currentScope) {
          resolved = ctx.db.childrenOf(currentScope.id).find((c) => c.name === part) ?? null;
        }
      }
      resolvedChain.push({ name: part, symbol: resolved });
      currentScope = resolved;
    }

    if (!currentScope && isEncapsulatedRoot) {
      const scopeFQN = getSymbolQualifiedName(ctx.db, rootClassId);
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.code,
        message: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.message(ext.name, scopeFQN),
        range: extRange,
      });
      return true;
    }

    // Check 1: Part of base class name is a component instead of a class
    for (const item of resolvedChain) {
      if (item.symbol && item.symbol.kind === "Component") {
        const compCst = ctx.db.cstNode(item.symbol.id) as CstNodeLike | null;
        let clauseCst = compCst;
        while (clauseCst && clauseCst.type !== "component_clause" && clauseCst.parent) {
          clauseCst = clauseCst.parent;
        }
        const targetCst = clauseCst && clauseCst.type === "component_clause" ? clauseCst : compCst;
        const compRange = targetCst
          ? {
              startOffset: targetCst.startIndex ?? targetCst.startOffset ?? 0,
              endOffset: targetCst.endIndex ?? targetCst.endOffset ?? 0,
            }
          : undefined;
        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: compRange,
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.PARTIAL_BASE_CLASS.code,
          message: `Part ${item.name} of base class name ${ext.name} is not a class.`,
          range: extRange,
        });
        return true;
      }
    }

    // Check 1b: Part of base class name is partial, name lookup is not allowed in partial classes
    for (let i = 0; i < parts.length - 1; i++) {
      const item = resolvedChain[i];
      if (item?.symbol && ctx.isClassPartial(item.symbol.id)) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.PARTIAL_LOOKUP_DISALLOWED.code,
          message: ModelicaErrorCode.PARTIAL_LOOKUP_DISALLOWED.message(item.name),
          range: extRange,
        });
        return true;
      }
    }

    // Check 2: Replaceable base class or segment
    for (let i = 0; i < resolvedChain.length; i++) {
      const item = resolvedChain[i]!;
      if (item.symbol) {
        const isRep = ctx.db.query<boolean>("isReplaceable", item.symbol.id);
        if (isRep) {
          const repCst = ctx.db.cstNode(item.symbol.id) as CstNodeLike | null;
          let repParent = repCst;
          while (repParent && repParent.type !== "element") {
            if (repParent.type === "composition") break;
            repParent = repParent.parent ?? null;
          }
          const targetRepNode = repParent ?? repCst;
          const repRange = targetRepNode
            ? {
                startOffset: targetRepNode.startIndex ?? targetRepNode.startOffset ?? 0,
                endOffset: targetRepNode.endIndex ?? targetRepNode.endOffset ?? 0,
              }
            : undefined;

          const annotatedPath =
            parts.length === 1 ? parts[0] : parts.map((p, idx) => (idx === i ? `<${p}>` : p)).join(".");

          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: repRange,
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.REPLACEABLE_BASE_CLASS.code,
            message: `Class '${item.name}' in 'extends ${annotatedPath}' is replaceable, the base class name must be transitively non-replaceable.`,
            range: extRange,
          });
          return true;
        }
      }
    }

    // Check 3: Base class name depends on inherited elements from prior extends clauses
    const firstPart = parts[0];
    const priorMatches: { prevExt: SymbolEntry; prevBase: SymbolEntry; innerClass: SymbolEntry }[] = [];
    for (let j = 0; j < extIdx; j++) {
      const prevExt = extendsClauses[j]!;
      const prevBase =
        ctx.db.query<SymbolEntry | null>("resolvedBaseClass", prevExt.id) ??
        ctx.db.byName(prevExt.name).find((e) => e.kind === "Class");
      if (prevBase) {
        const innerClass = ctx.db.childrenOf(prevBase.id).find((c) => c.kind === "Class" && c.name === firstPart);
        if (innerClass) {
          priorMatches.push({ prevExt, prevBase, innerClass });
        }
      }
    }
    if (priorMatches.length > 0) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.BASE_CLASS_AMBIGUOUS.code,
        message: `The base class name ${firstPart} was found in one or more base classes:`,
        range: extRange,
      });
      for (const m of priorMatches) {
        const innerCst = ctx.db.cstNode(m.innerClass.id) as CstNodeLike | null;
        const innerRange = innerCst
          ? {
              startOffset: innerCst.startIndex ?? innerCst.startOffset ?? 0,
              endOffset: innerCst.endIndex ?? innerCst.endOffset ?? 0,
            }
          : undefined;
        const prevExtCst = ctx.db.cstNode(m.prevExt.id) as CstNodeLike | null;
        const prevExtRange = prevExtCst
          ? {
              startOffset: prevExtCst.startIndex ?? prevExtCst.startOffset ?? 0,
              endOffset: prevExtCst.endIndex ?? prevExtCst.endOffset ?? 0,
            }
          : undefined;

        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: innerRange,
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.BASE_CLASS_FOUND_IN.code,
          message: `${firstPart} was found in base class ${m.prevBase.name}.`,
          range: prevExtRange,
        });
      }
      return true;
    }
  }

  // Check 4: Class specialization violation for short class specifiers and redeclarations
  const checkedClassSyms = new Set<SymbolId>();
  for (const child of ctx.db.childrenOf(rootClassId)) {
    if (child.kind === "Class") {
      checkedClassSyms.add(child.id);
      const violation = checkTypeAliasSpec(child.id);
      if (violation) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.CLASS_SPECIALIZATION_VIOLATION.code,
          message: `Class specialization violation: .${violation.targetName} is ${violation.kindDesc}, not a type.`,
          range: violation.range,
        });
        return true;
      }
    }
  }
  if (rootSym?.resourceId) {
    const fileSyms = ctx.getFileSymbols(rootSym.resourceId);
    for (const s of fileSyms) {
      if (s.kind === "Class" && !checkedClassSyms.has(s.id)) {
        const violation = checkTypeAliasSpec(s.id);
        if (violation) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CLASS_SPECIALIZATION_VIOLATION.code,
            message: `Class specialization violation: .${violation.targetName} is ${violation.kindDesc}, not a type.`,
            range: violation.range,
          });
          return true;
        }
      }
    }
  }
  const rootModForSpec = ctx.db.query<EffectiveModLike | null>("effectiveModification", rootClassId);
  if (rootModForSpec?.args) {
    for (const arg of rootModForSpec.args) {
      if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
        const targetClass = ctx.db
          .byName(arg.redeclaredTypeSpecifier.split(".").pop()!)
          .find((e) => e.kind === "Class");
        if (targetClass && !ctx.isClassType(targetClass.id)) {
          const targetCst = ctx.db.cstNode(targetClass.id) as SyntaxNode | null;
          const prefixes = Cst.ClassDefinition.classPrefixes(targetCst);
          const prefixWords = tokenizeCommentStrippedWords(prefixes?.text ?? "");
          let kindDesc = "a new def";
          if (prefixWords.includes("model")) kindDesc = "a model";
          else if (prefixWords.includes("block")) kindDesc = "a block";
          else if (prefixWords.includes("record")) kindDesc = "a record";
          else if (prefixWords.includes("connector")) kindDesc = "a connector";

          const rootCst = ctx.db.cstNode(rootClassId) as CstNodeLike | null;
          const r = findRedeclareTypeSpecRangeCst(rootCst, arg.name, arg.redeclaredTypeSpecifier);
          if (r) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.CLASS_SPECIALIZATION_VIOLATION.code,
              message: `Class specialization violation: .${arg.redeclaredTypeSpecifier} is ${kindDesc}, not a type.`,
              range: r,
            });
            return true;
          }
        }
      }
    }
  }

  // 1. Check for duplicate top-level symbols in the same file (DoubleClassDeclaration1, ErrorMultipleClasses, Clock2)
  if (rootSym?.resourceId) {
    const topLevelSymbols = (ctx.db.childrenOf(null) ?? []).filter(
      (s) => s.resourceId === rootSym.resourceId && (s.kind === "Class" || s.kind === "Component"),
    );

    const seenTop = new Map<string, SymbolEntry>();
    for (const s of topLevelSymbols) {
      // Built-in type check for top-level classes
      if (
        s.name === "Clock" ||
        s.name === "Real" ||
        s.name === "Integer" ||
        s.name === "Boolean" ||
        s.name === "String"
      ) {
        const currCst = ctx.db.cstNode(s.id) as CstNodeLike | null;
        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: undefined,
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.DUPLICATE_ELEMENT.code,
          message: ModelicaErrorCode.DUPLICATE_ELEMENT.message(s.name),
          range: getElementDiagRange(currCst),
        });
        return true;
      }

      const prev = seenTop.get(s.name);
      if (prev) {
        const prevCst = ctx.db.cstNode(prev.id) as CstNodeLike | null;
        const currCst = ctx.db.cstNode(s.id) as CstNodeLike | null;
        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: getElementDiagRange(prevCst),
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.DUPLICATE_ELEMENT.code,
          message: ModelicaErrorCode.DUPLICATE_ELEMENT.message(s.name),
          range: getElementDiagRange(currCst),
        });
        return true;
      }
      seenTop.set(s.name, s);
    }
  }

  // 2. Check for duplicate local elements in rootClassId or any nested class (DuplicateElements1..4, DoubleClassDeclaration2, DoubleFuncDeclaration)
  const checkDuplicateScopeElements = (classId: SymbolId): boolean => {
    const localElems = ctx.db.childrenOf(classId).filter((c) => c.kind === "Component" || c.kind === "Class");
    const seenLocal = new Map<string, SymbolEntry>();
    for (const elem of localElems) {
      const prevElem = seenLocal.get(elem.name);
      if (prevElem) {
        const prevCst = ctx.db.cstNode(prevElem.id) as CstNodeLike | null;
        const currCst = ctx.db.cstNode(elem.id) as CstNodeLike | null;
        const isRedecl = (node: CstNodeLike | null | undefined) => {
          let curr = node;
          while (curr && curr.type !== "class_definition") {
            if (
              curr.type === "element" &&
              (curr.text?.trim().startsWith("redeclare") || curr.text?.includes("redeclare "))
            )
              return true;
            curr = curr.parent;
          }
          return false;
        };
        if (isRedecl(currCst) || isRedecl(prevCst)) {
          continue;
        }

        const prevRange = getElementDiagRange(prevCst);
        const currRange = getElementDiagRange(currCst);

        let notifRange = prevRange;
        let errorRange = currRange;
        // In OMC, if one is Class and one is Component, the Class is reported as the original (notification)
        if (elem.kind === "Component" && prevElem.kind === "Class") {
          notifRange = prevRange;
          errorRange = currRange;
        } else if (elem.kind === "Class" && prevElem.kind === "Component") {
          notifRange = currRange;
          errorRange = prevRange;
        }
        if (dae.extensionMetadata?.["isOldFrontend"] && elem.kind === "Component" && prevElem.kind === "Component") {
          const getClause = (node: CstNodeLike | null | undefined) => {
            let curr = node;
            while (curr && curr.type !== "component_clause") curr = curr.parent;
            return curr ?? node;
          };
          const prevCl = getClause(prevCst);
          const currCl = getClause(currCst);
          let prevText = stripTrailingSemicolon(prevCl?.text ?? "");
          const currText = stripTrailingSemicolon(currCl?.text ?? "");
          prevText = moveTypeArrayDimToCompName(prevText);
          const classImports = ctx.collectClassImports(classId);
          const resolveImportText = (txt: string) => {
            let res = txt;
            for (const [alias, target] of classImports) {
              res = replaceAliasDotPrefix(res, alias, target).text;
            }
            return res;
          };
          const resolvedPrev = resolveImportText(prevText);
          const resolvedCurr = resolveImportText(currText);
          if (resolvedPrev === resolvedCurr) {
            const fmtPrev = startsWithPrimitiveTypeWord(resolvedPrev) ? resolvedPrev : `.${resolvedPrev}`;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.DUPLICATE_ELEMENT.code,
              message: `Duplicate elements:\n ${fmtPrev}.`,
              range: getElementDiagRange(prevCl),
            });
            return true;
          }
          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: getElementDiagRange(currCl),
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.DUPLICATE_INHERITED_ELEMENT_NOT_IDENTICAL.code,
            message: `Duplicate elements (due to inherited elements) not identical:\n  first element is:  ${currText}\n  second element is: ${prevText}`,
            range: getElementDiagRange(prevCl),
          });
          return true;
        }

        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: notifRange,
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.DUPLICATE_ELEMENT.code,
          message: ModelicaErrorCode.DUPLICATE_ELEMENT.message(elem.name),
          range: errorRange,
        });
        return true;
      }
      seenLocal.set(elem.name, elem);
    }

    for (const elem of localElems) {
      if (elem.kind === "Class") {
        if (checkDuplicateScopeElements(elem.id)) return true;
      }
    }
    return false;
  };

  if (checkDuplicateScopeElements(rootClassId)) {
    return true;
  }

  const localComps = ctx.db.childrenOf(rootClassId).filter((c) => c.kind === "Component");
  for (const comp of localComps) {
    const compCst = ctx.db.cstNode(comp.id) as CstNodeLike | null;
    let clauseNode: CstNodeLike | null | undefined = compCst;
    while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.type !== "class_definition") {
      clauseNode = clauseNode.parent;
    }
    if (clauseNode && clauseNode.type === "component_clause") {
      const typeSpecNode = clauseNode.children?.find((c) => c.type === "type_specifier");
      const typeSpec = typeSpecNode?.text?.trim();
      if (typeSpec && !typeSpec.includes(".") && comp.name === typeSpec) {
        const rangeObj = {
          startOffset: clauseNode.startIndex ?? clauseNode.startOffset ?? 0,
          endOffset: clauseNode.endIndex ?? clauseNode.endOffset ?? 0,
          startPosition: clauseNode.startPosition,
          endPosition: clauseNode.endPosition,
        };
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.SAME_NAME_TYPE_SHADOWING.code,
          message: `Found a component with same name when looking for type ${typeSpec}.`,
          range: rangeObj,
        });
        return true;
      }
    }
  }

  for (const ext of extendsClauses) {
    const extCst = ctx.db.cstNode(ext.id) as CstNodeLike | null;
    const extendsModParsedRaw = ctx.db.query<ModArgLike[] | EffectiveModLike | null>(
      "extendsModificationParsed",
      ext.id,
    );
    const extendsModParsed: ModArgLike[] = Array.isArray(extendsModParsedRaw)
      ? extendsModParsedRaw
      : (extendsModParsedRaw?.args ?? []);
    for (const arg of extendsModParsed) {
      if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
        if (!arg.redeclaredTypeSpecifier.includes(".") && arg.name === arg.redeclaredTypeSpecifier) {
          const redeclRange = findRedeclareSameNameRangeCst(extCst, arg.name);
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.SAME_NAME_TYPE_SHADOWING.code,
            message: `Found a component with same name when looking for type ${arg.redeclaredTypeSpecifier}.`,
            range: redeclRange,
          });
          return true;
        }
      }
    }
  }

  // Check for duplicate elements due to inherited elements and invalid break on record components
  const checkInheritedAndBreakErrors = (targetClassId: SymbolId): boolean => {
    const targetChildren = ctx.db.childrenOf(targetClassId);
    const targetExtends = targetChildren.filter((c) => c.kind === "Extends");
    const targetLocalComps = targetChildren.filter((c) => c.kind === "Component");
    const targetImports = ctx.collectClassImports(targetClassId);
    const isOldFE = Boolean(ctx.options.isOldFrontend || dae.extensionMetadata?.["isOldFrontend"]);
    const seenInheritedComps = new Map<
      string,
      {
        elem: SymbolEntry;
        clause: CstNodeLike | null | undefined;
        range: { startOffset: number; endOffset: number };
        modText: string | null;
      }
    >();

    const getClause = (node: CstNodeLike | null | undefined): CstNodeLike | null | undefined => {
      let curr = node;
      while (curr && curr.type !== "component_clause") curr = curr.parent;
      if (curr && curr.parent && curr.parent.type === "element") {
        const parentText = curr.parent.text?.trim() ?? "";
        if (parentText.startsWith("final")) {
          return curr.parent;
        }
      }
      return curr;
    };

    const toRange = (clause: CstNodeLike | null | undefined, fallbackCst: CstNodeLike | null | undefined) =>
      clause
        ? {
            startOffset: clause.startIndex ?? clause.startOffset ?? 0,
            endOffset: clause.endIndex ?? clause.endOffset ?? 0,
          }
        : {
            startOffset: fallbackCst?.startIndex ?? fallbackCst?.startOffset ?? 0,
            endOffset: fallbackCst?.endIndex ?? fallbackCst?.endOffset ?? 0,
          };

    const formatArrayDimBeforeName = (txt: string) => moveCompArrayDimToTypeName(txt);

    for (const ext of targetExtends) {
      const baseClass =
        ctx.db.query<SymbolEntry | null>("resolvedBaseClass", ext.id) ??
        (targetClassId
          ? (ctx.db.query<NameResolverFn | null>("resolveName", targetClassId)?.(ext.name) ??
            ctx.db.query<NameResolverFn | null>("resolveSimpleName", targetClassId)?.(ext.name))
          : null) ??
        ctx.db.byName(ext.name)[0];
      if (!baseClass) continue;

      if (targetClassId === rootClassId) {
        const innerConflict = ctx.db
          .childrenOf(baseClass.id)
          .find((c) => c.name === ext.name && (c.kind === "Class" || c.kind === "Package"));
        if (innerConflict) {
          const extCst = ctx.db.cstNode(ext.id) as CstNodeLike | null;
          const conflictCst = ctx.db.cstNode(innerConflict.id) as CstNodeLike | null;
          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: {
              startOffset: extCst?.startIndex ?? extCst?.startOffset ?? 0,
              endOffset: extCst?.endIndex ?? extCst?.endOffset ?? 0,
              startPosition: extCst?.startPosition,
              endPosition: extCst?.endPosition,
            },
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.EXTENDS_OTHER_BASE_CLASS.code,
            message: ModelicaErrorCode.EXTENDS_OTHER_BASE_CLASS.message(ext.name),
            range: {
              startOffset: conflictCst?.startIndex ?? conflictCst?.startOffset ?? 0,
              endOffset: conflictCst?.endIndex ?? conflictCst?.endOffset ?? 0,
              startPosition: conflictCst?.startPosition,
              endPosition: conflictCst?.endPosition,
            },
          });
          return true;
        }
      }

      const extendsModParsedRaw = ctx.db.query<ModArgLike[] | EffectiveModLike | null>(
        "extendsModificationParsed",
        ext.id,
      );
      const extendsModParsed: ModArgLike[] = Array.isArray(extendsModParsedRaw)
        ? extendsModParsedRaw
        : (extendsModParsedRaw?.args ?? []);
      const baseElements = ctx.db.query<SymbolId[]>("instantiate", baseClass.id) || [];
      const brokenNames = new Set<string>();
      const extCst = ctx.db.cstNode(ext.id) as CstNodeLike | null;

      for (const arg of extendsModParsed) {
        if ((arg.isBreak || arg.value?.kind === "break") && !arg.name.startsWith("break_connect:")) {
          brokenNames.add(arg.name);
          for (const baseElemId of baseElements) {
            const baseElem = ctx.db.symbol(baseElemId);
            if (baseElem && baseElem.kind === "Component" && baseElem.name === arg.name) {
              const compClassId = ctx.db.query<SymbolId | null>("classInstance", baseElem.id);
              const compClassSym = compClassId ? ctx.db.symbol(compClassId) : null;
              if (compClassSym && (compClassSym.kind === "Record" || ctx.isRecordSym(compClassSym))) {
                const baseCst = ctx.db.cstNode(baseElem.id) as CstNodeLike | null;
                const baseClause = getClause(baseCst);
                const baseRange = toRange(baseClause, baseCst);
                const notifRange = arg.nameRange
                  ? { startOffset: arg.nameRange[0], endOffset: arg.nameRange[1] }
                  : toRange(null, extCst);
                dae.diagnostics.push({
                  severity: "notification",
                  code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                  message: "From here:",
                  range: notifRange,
                });
                dae.diagnostics.push({
                  severity: "error",
                  code: 4099,
                  message: `Invalid use of break on component '${arg.name}', component must be a model, block, or connector.`,
                  range: baseRange,
                });
                return true;
              }
            }
          }
        }
      }

      for (const baseElemId of baseElements) {
        const baseElem = ctx.db.symbol(baseElemId);
        if (!baseElem || baseElem.kind !== "Component") continue;
        if (brokenNames.has(baseElem.name)) continue;

        const baseCst = ctx.db.cstNode(baseElem.id) as CstNodeLike | null;
        const baseClause = getClause(baseCst);
        const baseRange = toRange(baseClause, baseCst);

        const extModArg = extendsModParsed.find(
          (a) => !a.isBreak && a.name === baseElem.name && (a.value?.text || a.bindingExpression),
        );
        const currModVal: string | null = extModArg
          ? String(extModArg.value?.text ?? extModArg.bindingExpression).trim()
          : null;

        const prevInh = seenInheritedComps.get(baseElem.name);
        if (prevInh && prevInh.elem.id !== baseElem.id) {
          if ((prevInh.modText !== null) !== (currModVal !== null)) {
            const prevRaw = formatArrayDimBeforeName(stripTrailingSemicolon(prevInh.clause?.text ?? ""));
            const currRaw = formatArrayDimBeforeName(stripTrailingSemicolon(baseClause?.text ?? baseCst?.text ?? ""));
            const applyModBinding = (raw: string, modVal: string | null) => {
              if (!modVal) return raw;
              const eqIdx = raw.indexOf("=");
              if (eqIdx >= 0 && !raw.slice(eqIdx + 1).includes(";")) {
                return `${raw.slice(0, eqIdx)}= ${modVal}`;
              }
              return `${raw} = ${modVal}`;
            };
            const firstText = applyModBinding(prevRaw, prevInh.modText);
            const secondText = applyModBinding(currRaw, currModVal);
            if (firstText !== secondText) {
              dae.diagnostics.push({
                severity: "notification",
                code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                message: "From here:",
                range: prevInh.range,
              });
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.DUPLICATE_INHERITED_ELEMENT_NOT_IDENTICAL.code,
                message: `Duplicate elements (due to inherited elements) not identical:\n  first element is:  ${firstText}\n  second element is: ${secondText}`,
                range: baseRange,
              });
              return true;
            }
          }
        }
        seenInheritedComps.set(baseElem.name, {
          elem: baseElem,
          clause: baseClause ?? baseCst,
          range: baseRange,
          modText: currModVal,
        });

        const matchingLocal = targetLocalComps.find((c) => c.name === baseElem.name);
        if (matchingLocal) {
          const isRedecl = ctx.db.query<boolean>("isRedeclare", matchingLocal.id);
          if (!isRedecl) {
            const localCst = ctx.db.cstNode(matchingLocal.id) as CstNodeLike | null;
            const localClause = getClause(localCst);
            const localRange = toRange(localClause, localCst);
            const extStart = extCst?.startIndex ?? extCst?.startOffset ?? 0;

            const localText = stripTrailingSemicolon(localClause?.text ?? localCst?.text ?? "");
            const baseText = stripTrailingSemicolon(baseClause?.text ?? baseCst?.text ?? "");

            let resolvedLocalText = localText;
            let usedImportAlias = false;
            for (const [alias, target] of targetImports) {
              const replaced = replaceAliasDotPrefix(resolvedLocalText, alias, target);
              if (replaced.changed) {
                usedImportAlias = true;
                resolvedLocalText = replaced.text;
              }
            }

            const canonicalizeDeclCst = (
              clauseNode: CstNodeLike | null | undefined,
              rawFallback: string,
              imports?: Map<string, string>,
            ): string => {
              const isTrivialTrueCond = (n: CstNodeLike | null | undefined): boolean => {
                if (!n || (n.type !== "condition_attribute" && n.type !== "ConditionAttribute")) return false;
                const children = (n.children || []).filter(
                  (c: CstNodeLike | null | undefined) =>
                    c?.type !== "if" && c?.text?.trim() !== "if" && c?.text?.trim() !== "",
                );
                if (children.length === 1 && children[0]?.text?.trim() === "true") return true;
                const txt = (n.text ?? "").trim();
                return txt.startsWith("if") && txt.slice(2).trim() === "true";
              };

              const tokens: string[] = [];
              const collectTokens = (n: CstNodeLike | null | undefined): void => {
                if (!n) return;
                if (isTrivialTrueCond(n)) return;
                if (
                  !isOldFE &&
                  (n.type === "comment" ||
                    n.type === "Comment" ||
                    n.type === "string_comment" ||
                    n.type === "StringComment" ||
                    n.type === "description" ||
                    n.type === "Description" ||
                    n.type === "description_string" ||
                    n.type === "DescriptionString" ||
                    n.type === "annotation" ||
                    n.type === "Annotation" ||
                    n.type === "annotation_clause")
                ) {
                  return;
                }
                if (Array.isArray(n.children) && n.children.length > 0) {
                  for (const ch of n.children) collectTokens(ch);
                  return;
                }
                const t = (n.text ?? "").trim();
                if (t && t !== ";") tokens.push(t);
              };

              if (clauseNode && Array.isArray(clauseNode.children) && clauseNode.children.length > 0) {
                collectTokens(clauseNode);
              } else {
                const parsedTokens = parseComponentDeclTokensCst(rawFallback, !isOldFE, isTrivialTrueCond);
                if (parsedTokens !== null) {
                  tokens.push(...parsedTokens);
                } else {
                  const s = rawFallback.trim();
                  const trimmed = s.endsWith("if true") ? s.slice(0, -7).trim() : s;
                  for (const tok of trimmed.split(" ")) {
                    for (const sub of tok.split("\t")) {
                      if (sub) tokens.push(sub);
                    }
                  }
                }
              }

              let joined = "";
              for (const tok of tokens) {
                if (!joined) {
                  joined = tok;
                } else if (
                  tok === "(" ||
                  tok === ")" ||
                  tok === "[" ||
                  tok === "]" ||
                  tok === "." ||
                  tok === "," ||
                  joined.endsWith("(") ||
                  joined.endsWith("[") ||
                  joined.endsWith(".")
                ) {
                  joined += tok;
                } else {
                  joined += ` ${tok}`;
                }
              }
              // Normalize `ident=val` inside single-token leaves if any
              let normalized = "";
              let inQuote = false;
              for (let idx = 0; idx < joined.length; idx++) {
                const ch = joined[idx]!;
                if (ch === '"') inQuote = !inQuote;
                if (!inQuote && ch === "=") {
                  const prev = normalized[normalized.length - 1];
                  if (
                    prev &&
                    prev !== " " &&
                    prev !== ":" &&
                    prev !== "<" &&
                    prev !== ">" &&
                    prev !== "=" &&
                    prev !== "/"
                  ) {
                    normalized += " ";
                  }
                  normalized += "=";
                  const next = joined[idx + 1];
                  if (next && next !== " " && next !== "=") {
                    normalized += " ";
                  }
                } else {
                  normalized += ch;
                }
              }
              if (imports && imports.size > 0) {
                for (const [alias, target] of imports) {
                  const prefix = `${alias}.`;
                  if (normalized.startsWith(prefix)) {
                    normalized = `${target}.${normalized.slice(prefix.length)}`;
                  }
                  normalized = normalized.replaceAll(` ${prefix}`, ` ${target}.`);
                }
              }
              return normalized.trim();
            };

            if (
              canonicalizeDeclCst(localClause ?? localCst, resolvedLocalText, targetImports) ===
              canonicalizeDeclCst(baseClause ?? baseCst, baseText)
            ) {
              continue;
            }

            let firstRange = localRange;
            let secondRange = baseRange;
            let firstText = localText;
            let secondText = baseText;

            if (isOldFE) {
              let localDisp = formatParenModArgEquals(resolvedLocalText);
              if (usedImportAlias && !localDisp.startsWith(".")) {
                localDisp = `.${localDisp}`;
              }
              let baseDisp = dotPrefixPrimitiveTypeWords(formatParenModArgEquals(baseText));
              if (startsWithDottedIdentifierPair(baseDisp)) {
                baseDisp = `.${baseDisp}`;
              }
              firstText = localDisp;
              secondText = baseDisp;
            } else {
              if (localRange.startOffset > extStart) {
                firstRange = baseRange;
                secondRange = localRange;
                firstText = baseText;
                secondText = localText;
              }
            }

            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
              message: "From here:",
              range: firstRange,
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.DUPLICATE_INHERITED_ELEMENT_NOT_IDENTICAL.code,
              message: `Duplicate elements (due to inherited elements) not identical:\n  first element is:  ${firstText}\n  second element is: ${secondText}`,
              range: secondRange,
            });
            return true;
          }
        }
      }
    }

    for (const comp of targetLocalComps) {
      const compClassId = ctx.db.query<SymbolId | null>("classInstance", comp.id);
      const compInst = ctx.db.query<ComponentInstanceQueryData | null>("componentInstance", comp.id);
      const modArgs: ModArgLike[] = compInst?.modification?.args ?? [];
      if (compClassId && modArgs.length > 0) {
        for (const arg of modArgs) {
          if (arg.isBreak || !arg.name) continue;
          const nestedArgs: readonly ModArgLike[] = arg.nestedArgs ?? arg.args ?? [];
          if (nestedArgs.length === 0) continue;
          const member = ctx.classFindMember(compClassId, arg.name);
          if (
            member &&
            (member.kind === "Class" || member.kind === "Package") &&
            !ctx.db.query<boolean>("isReplaceable", member.id)
          ) {
            const memberCst = ctx.db.cstNode(member.id) as CstNodeLike | null;
            const isPkg =
              member.kind === "Package" ||
              String((member.metadata as SymbolMetaLike | undefined)?.classKind ?? "").toLowerCase() === "package" ||
              hasClassPrefixWordCst(memberCst, "package");
            if (isPkg) {
              for (const nestedArg of nestedArgs) {
                if (!nestedArg?.name) continue;
                const nestedMember = ctx.classFindMember(member.id, nestedArg.name);
                if (nestedMember && nestedMember.kind === "Component") {
                  const compCst = ctx.db.cstNode(comp.id) as CstNodeLike | null;
                  const compClause = getClause(compCst);
                  const compRange = toRange(compClause, compCst);
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
                    message: `Found component '${nestedArg.name}' in composite name '${comp.name}.${arg.name}.${nestedArg.name}', expected class.`,
                    range: compRange,
                  });
                  return true;
                }
              }
            }
          }
        }
      }
    }
    return false;
  };

  if (checkInheritedAndBreakErrors(rootClassId)) {
    return true;
  }
  for (const comp of localComps) {
    const compClassId = ctx.db.query<SymbolId | null>("classInstance", comp.id);
    if (compClassId && checkInheritedAndBreakErrors(compClassId)) {
      return true;
    }
  }

  return false;
}
