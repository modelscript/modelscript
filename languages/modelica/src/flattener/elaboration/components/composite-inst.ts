// SPDX-License-Identifier: AGPL-3.0-or-later

import { type DiagnosticRange } from "../../support/range-utils.js";

import { EqKind, ExprKind } from "@modelscript/dsl";
import {
  BinOp,
  Causality,
  DAEBuilder,
  evaluateArenaFunctionCall,
  UnaryOp,
  Variability,
  VarType,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import { getShortClassSpecifierNode } from "../../../queries.js";
import {
  containsWholeWordOutsideStrings,
  evalDaeExpr,
  evaluateCSTNumber,
  extractAsciiIdentifiers,
  extractCallTargetsFromExpr,
  firstBracketedIdentifier,
  formatArenaValForMod,
  generateArrayTuples,
  getArrayLiteralItems,
  getSymbolQualifiedName,
  hasClassHeaderKeywordCst,
  hasColonSubscript,
  isArrayLiteral,
  isAsciiDigitsOnly,
  isDottedComponentRefWithSubscripts,
  isDottedIdentifierChain,
  isIntegerTypeSpec,
  isSignedAsciiIntText,
  isSignedAsciiNumberText,
  lookupDbConstant,
  parseArrayLiteralElements,
  parseNamedArgAssignment,
  parseNamedCallArgsFromText,
  parseRawLiteralArg,
  parseSizeCallIdentDim,
  replaceWordOutsideStrings,
  resolveEnumType,
  splitTopLevel,
  splitTopLevelArgs,
  stripArraySubscripts,
  stripCommentsAndStrings,
  stripLeadingDots,
  stripLeadingEquals,
  tokenizeCommentStrippedWords,
} from "../../expressions/index.js";
import { getNamedArrayShape, setNamedArrayShape } from "../../support/state.js";
import { ModelicaModificationEnv } from "../../support/wasm-bridge.js";
import { type ComponentInstanceData, type ParentModsLike } from "../../types.js";
import {
  evaluateComprehensionRangeValues,
  extractReplaceablePackagePrefix,
  hasFieldVariablesInDae,
  isReplaceablePackageIdentifier,
  lowerStandaloneExpression,
  parseArrayComprehension,
  parseBraceComprehension,
} from "./cst-helpers.js";
import { collectExtendsMods, collectProtectedNames } from "./modifications.js";
import { resolveRedeclarationType, tryLowerForeignComponent } from "./redeclare-and-alias.js";
import {
  asExtDae,
  getCstNode,
  getCstNodeRange,
  getDaeExtMeta,
  getSymMeta,
  type ArenaEvalArg,
  type ArenaEvalResult,
  type ArrayDimRawEntry,
  type ComponentFlattener,
  type ComponentInstanceInfo,
  type EffectiveBindingData,
  type EvaluateArenaFunctionCallWithNamed,
  type ExtendedFlatteningState,
  type InstantiateElementsFn,
  type ModArgData,
  type ParentModData,
  type ResolvedComponentContext,
  type ResolveNameFn,
  type ResolveSimpleNameFn,
} from "./types.js";
import { validateClassModifiers } from "./validation.js";

export function elaborateCompositeClass(
  flattener: ComponentFlattener,
  elemId: SymbolId,
  compInst: ComponentInstanceInfo,
  fullCompName: string,
  elemCst: SyntaxNode | null,
  prefix: string,
  dae: DAEBuilder,
  state: ExtendedFlatteningState,
  parentMods: ParentModData | null | undefined,
  wasmEnv: ModelicaModificationEnv | null,
  matchingParentArg: ModArgData | undefined,
  ctx: ResolvedComponentContext,
  recurse: InstantiateElementsFn,
): "continue" | "break" | "return" {
  const {
    isElemProtected,
    name,
    elemSym,
    meta,
    classTargetId,
    redeclPkgId,
    redeclPkgPrefix,
    elemParent,
    matchingClassArg,
    redeclArg,
    classTarget,
    compSpecPkgPrefix,
    isRecordTarget,
    isUserClass,
  } = ctx;
  if (isUserClass) {
    if (classTargetId && flattener.isFmuClass?.(classTargetId)) {
      flattener.fmuComponents?.set(name, classTargetId);
    }
    // Check for dot lookup in partial classes/packages (e.g. P.A a; where P is partial)
    const typeSpecParts = (compInst.typeSpecifier ?? "").split(".");
    if (typeSpecParts.length > 1) {
      const curScopeId = flattener.currentClassId ?? flattener.currentRootClassId;
      let currentScope: SymbolEntry | null = curScopeId ? (flattener.db.symbol(curScopeId) ?? null) : null;
      let hasPartialLookup = false;
      for (let i = 0; i < typeSpecParts.length - 1; i++) {
        const part = typeSpecParts[i]!;
        let resolved: SymbolEntry | null = null;
        if (i === 0) {
          if (redeclPkgId && part === redeclPkgPrefix) {
            resolved = flattener.db.symbol(redeclPkgId) ?? null;
          } else {
            const resolver =
              (curScopeId
                ? flattener.db.query<(n: string) => SymbolEntry | null>(
                    "resolveSimpleName",
                    currentScope?.id ?? curScopeId,
                  )
                : null) ??
              (curScopeId
                ? flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope?.id ?? curScopeId)
                : null);
            resolved = resolver ? resolver(part) : null;
            if (!resolved) {
              resolved = flattener.db.byName(part).find((e) => e.kind === "Class" || e.kind === "Package") ?? null;
            }
            if (
              resolved &&
              flattener.isClassPartial(resolved.id) &&
              parentMods?.packageScopeId &&
              (flattener.db.query<boolean>("isReplaceable", resolved.id) ||
                getCstNode(flattener.db, resolved.id)?.parent?.type === "element_replaceable")
            ) {
              resolved = flattener.db.symbol(parentMods.packageScopeId) ?? resolved;
            }
          }
        } else if (currentScope) {
          resolved = flattener.db.childrenOf(currentScope.id).find((c) => c.name === part) ?? null;
        }
        if (resolved && flattener.isClassPartial(resolved.id)) {
          const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
          if (!isOldFrontend) {
            let clauseNode: SyntaxNode | null = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
              clauseNode = clauseNode.parent;
            }
            const compRange = clauseNode
              ? {
                  startOffset: clauseNode.startIndex ?? clauseNode.startOffset,
                  endOffset: clauseNode.endIndex ?? clauseNode.endOffset,
                  startPosition: clauseNode.startPosition,
                  endPosition: clauseNode.endPosition,
                }
              : elemCst
                ? {
                    startOffset: elemCst.startIndex ?? elemCst.startOffset,
                    endOffset: elemCst.endIndex ?? elemCst.endOffset,
                    startPosition: elemCst.startPosition,
                    endPosition: elemCst.endPosition,
                  }
                : undefined;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.PARTIAL_LOOKUP_DISALLOWED.code,
              message: ModelicaErrorCode.PARTIAL_LOOKUP_DISALLOWED.message(part),
              range: compRange,
            });
          }
          hasPartialLookup = true;
          break;
        }
        currentScope = resolved;
      }
      if (hasPartialLookup) return "continue";
    }

    if (compInst.flowPrefix === "flow" && classTargetId) {
      const findNestedFlow = (targetId: SymbolId): string | null => {
        const elements = flattener.db.query<SymbolId[]>("instantiate", targetId) ?? [];
        for (const eid of elements) {
          const sym = flattener.db.symbol(eid);
          if (sym?.kind === "Component") {
            const inst = flattener.db.query<ComponentInstanceInfo | null>("componentInstance", eid);
            if (inst?.flowPrefix === "flow") {
              return inst.name;
            }
            const childTarget = flattener.db.query<SymbolEntry | null>("classInstance", eid);
            if (childTarget) {
              const nested = findNestedFlow(childTarget.id);
              if (nested) return `${inst?.name ?? sym.name}.${nested}`;
            }
          }
        }
        return null;
      };
      const nestedFlowVar = findNestedFlow(classTargetId);
      if (nestedFlowVar) {
        const fullNestedVar = prefix
          ? `${prefix}.${compInst.name}.${nestedFlowVar}`
          : `${compInst.name}.${nestedFlowVar}`;
        let clauseNode: SyntaxNode | null = elemCst;
        while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
          clauseNode = clauseNode.parent;
        }
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.INVALID_TYPE_PREFIX_FLOW_NESTED.code,
          message: ModelicaErrorCode.INVALID_TYPE_PREFIX_FLOW_NESTED.message(fullNestedVar),
          range: {
            startOffset: clauseNode?.startIndex ?? clauseNode?.startOffset,
            endOffset: clauseNode?.endIndex ?? clauseNode?.endOffset,
            startPosition: clauseNode?.startPosition,
            endPosition: clauseNode?.endPosition,
          },
        });
        return "return";
      }
    }

    // Detect direct or mutually recursive class instantiation cycles via `instantiatingClassIds`
    const instantiatingClassIds: Set<SymbolId> =
      parentMods?.instantiatingClassIds ?? new Set(flattener.currentRootClassId ? [flattener.currentRootClassId] : []);
    if (classTargetId && instantiatingClassIds.has(classTargetId)) {
      const sym = flattener.db.symbol(elemId);
      const isInherited = flattener.currentClassId != null && sym?.parentId !== flattener.currentClassId;
      if (isInherited && flattener.currentClassId != null) {
        const classCst = getCstNode(flattener.db, flattener.currentClassId);
        const rangeObj = classCst
          ? {
              startOffset: classCst.startIndex ?? classCst.startOffset,
              endOffset: classCst.endIndex ?? classCst.endOffset,
              startPosition: classCst.startPosition,
              endPosition: classCst.endPosition,
            }
          : undefined;
        const rootName = flattener.currentRootClassId
          ? (flattener.db.symbol(flattener.currentRootClassId)?.name ?? "")
          : "";
        const scopeParts = [rootName];
        if (prefix) scopeParts.push(...prefix.split("."));
        const targetClassName = classTarget?.name ?? compInst.typeSpecifier ?? "";
        while (scopeParts.length < 255) {
          scopeParts.push(targetClassName);
        }
        const scopeStr = scopeParts.join(".");
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.MAX_RECURSION_DEPTH_EXCEEDED.code,
          message: `The maximum recursion depth of 256 was reached, probably due to mutual recursion. The current scope: ${scopeStr}.`,
          range: rangeObj,
        });
        return "return";
      }

      let clauseNode: SyntaxNode | null = elemCst;
      while (clauseNode && clauseNode.type !== "component_clause") {
        clauseNode = clauseNode.parent;
      }
      const rangeObj = clauseNode
        ? {
            startOffset: clauseNode.startIndex ?? clauseNode.startOffset,
            endOffset: clauseNode.endIndex ?? clauseNode.endOffset,
          }
        : elemCst
          ? {
              startOffset: elemCst.startIndex ?? elemCst.startOffset,
              endOffset: elemCst.endIndex ?? elemCst.endOffset,
            }
          : undefined;
      const targetClassName = classTarget?.name ?? compInst.typeSpecifier;
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.RECURSIVE_DEFINITION.code,
        message: `Declaration of element ${compInst.name} causes recursive definition of class ${targetClassName}.`,
        range: rangeObj,
      });
      return "continue";
    }

    if (
      classTargetId &&
      !compInst.isReplaceable &&
      !(dae.classKind === "function" && (compInst.causality === "input" || flattener.isFunctionSym(classTarget))) &&
      flattener.isClassPartial(classTargetId)
    ) {
      const targetCst = getCstNode(flattener.db, classTargetId);
      const targetRange = targetCst
        ? {
            startOffset: targetCst.startIndex ?? targetCst.startOffset,
            endOffset: targetCst.endIndex ?? targetCst.endOffset,
            startPosition: targetCst.startPosition,
            endPosition: targetCst.endPosition,
          }
        : undefined;
      let clauseNode: SyntaxNode | null = elemCst;
      while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
        clauseNode = clauseNode.parent;
      }
      const compRange = clauseNode
        ? {
            startOffset: clauseNode.startIndex ?? clauseNode.startOffset,
            endOffset: clauseNode.endIndex ?? clauseNode.endOffset,
            startPosition: clauseNode.startPosition,
            endPosition: clauseNode.endPosition,
          }
        : elemCst
          ? {
              startOffset: elemCst.startIndex ?? elemCst.startOffset,
              endOffset: elemCst.endIndex ?? elemCst.endOffset,
              startPosition: elemCst.startPosition,
              endPosition: elemCst.endPosition,
            }
          : undefined;

      if (dae.extensionMetadata["isOldFrontend"]) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.PARTIAL_INSTANTIATION.code,
          message: ModelicaErrorCode.PARTIAL_INSTANTIATION.message(classTarget?.name ?? compInst.typeSpecifier ?? ""),
          range: targetRange,
        });
      } else {
        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: targetRange,
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.PARTIAL_TYPE_COMPONENT.code,
          message: ModelicaErrorCode.PARTIAL_TYPE_COMPONENT.message(compInst.name, compInst.typeSpecifier ?? ""),
          range: compRange,
        });
      }
      return "continue";
    }

    if (dae.classKind === "function" && classTarget && flattener.isFunctionSym(classTarget)) {
      const fnVarIdx = dae.addVariable(
        dae.interner.intern(name),
        VarType.Real,
        Variability.Continuous,
        compInst.causality === "input" ? Causality.Input : Causality.Local,
        0.0,
      );
      const instIds = flattener.db.query<SymbolId[]>("instantiate", classTarget.id);
      const chs =
        instIds && instIds.length > 0
          ? instIds.map((id) => flattener.db.symbol(id)).filter((s): s is SymbolEntry => Boolean(s))
          : flattener.db.childrenOf(classTarget.id) || [];
      const inParts: string[] = [];
      const outParts: string[] = [];
      for (const ch of chs) {
        if (ch.kind === "Component") {
          const ci = flattener.db.query<ComponentInstanceData>("componentInstance", ch.id);
          const t = ci?.typeSpecifier ?? "Real";
          if (ci?.causality === "input") {
            inParts.push(`#${t} ${ch.name}`);
          } else if (ci?.causality === "output") {
            outParts.push(`#${t}`);
          }
        }
      }
      const outStr = outParts.length === 0 ? "()" : outParts.join(", ");
      dae.setVarCustomType(fnVarIdx, `${compInst.name}<function>(${inParts.join(", ")}) => ${outStr}`);
      (state.formalFunctionParams ??= new Map<string, { targetSymId: SymbolId; targetName: string }>()).set(name, {
        targetSymId: classTarget.id,
        targetName: classTarget.name,
      });
      (state.functionParameterNames ??= new Set<string>()).add(name);
      return "continue";
    }

    if (classTargetId) {
      const nestedClasses = flattener.db
        .childrenOf(classTargetId)
        .filter((c) => c.kind === "Class" || c.kind === "Package");
      let hasPartialErr = false;
      for (const nc of nestedClasses) {
        const ncCst = getCstNode(flattener.db, nc.id);
        const isPartialClass = hasClassHeaderKeywordCst(ncCst, "partial");
        if (isPartialClass) {
          const isRedeclared = parentMods?.args?.some(
            (a) => a.name === nc.name && (a.kind === "redeclare" || a.isRedeclare),
          );
          if (!isRedeclared) {
            const ncRange = ncCst
              ? {
                  startOffset: ncCst.startIndex ?? ncCst.startOffset,
                  endOffset: ncCst.endIndex ?? ncCst.endOffset,
                }
              : undefined;
            let clauseNode: SyntaxNode | null = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const compRange = clauseNode
              ? {
                  startOffset: clauseNode.startIndex ?? clauseNode.startOffset,
                  endOffset: clauseNode.endIndex ?? clauseNode.endOffset,
                }
              : elemCst
                ? {
                    startOffset: elemCst.startIndex ?? elemCst.startOffset,
                    endOffset: elemCst.endIndex ?? elemCst.endOffset,
                  }
                : undefined;
            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
              message: "From here:",
              range: ncRange,
            });
            const targetClassName = classTarget?.name ?? compInst.typeSpecifier;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.PARTIAL_TYPE_COMPONENT.code,
              message: `component ${compInst.name} contains the definition of a partial class ${nc.name}.\nPlease redeclare it to any package compatible with ${targetClassName}.${nc.name}.`,
              range: compRange,
            });
            hasPartialErr = true;
            break;
          }
        }
      }
      if (hasPartialErr) return "continue";
    }

    if (classTargetId) {
      const compModsToValidate = [
        ...(compInst.modification?.args ?? []),
        ...(matchingParentArg?.nestedArgs ?? matchingParentArg?.args ?? []),
      ];
      if (compModsToValidate.length > 0) {
        if (!validateClassModifiers(flattener, classTargetId, compModsToValidate, dae)) {
          return "continue";
        }
      }
    }

    const nextInstantiatingClassIds = new Set(instantiatingClassIds);
    if (classTargetId) nextInstantiatingClassIds.add(classTargetId);

    const isOpRec = Boolean(classTarget && isRecordTarget && flattener.isOperatorRecordSym(classTarget));
    const hasOpRecBinding = Boolean(
      isOpRec &&
      compInst?.modification?.bindingExpression &&
      compInst?.variability !== "parameter" &&
      compInst?.variability !== "constant" &&
      parentMods?.parentVariability !== Variability.Parameter &&
      parentMods?.parentVariability !== Variability.Constant,
    );
    if (hasOpRecBinding) {
      const modChild = elemCst?.children?.find((c) => c.type === "modification");
      const findBindingExprNode = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
        if (!n) return null;
        if (n.type === "expression") return n;
        for (const c of n.children || []) {
          const res = findBindingExprNode(c);
          if (res) return res;
        }
        return null;
      };
      const exprCst = findBindingExprNode(modChild ?? elemCst);
      if (exprCst) {
        const rhsExprId = flattener.lowerExpr(exprCst, dae, prefix);
        if (rhsExprId >= 0) {
          const lhsExprId = dae.addNameExpr(name);
          dae.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
        }
      }
    }
    const subElements = flattener.db.query<SymbolId[]>("instantiate", classTargetId!);
    let pkgScopeId: number | undefined = redeclPkgId ?? parentMods?.packageScopeId;
    if (!redeclPkgId && compInst.typeSpecifier?.includes(".")) {
      const pkgPrefix = compInst.typeSpecifier.split(".")[0]!;
      const concreteScopeId = parentMods?.currentClassId ?? flattener.currentClassId;
      const resolvePkgInScope = (sid?: SymbolId): SymbolEntry | null => {
        if (!sid) return null;
        return (
          flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", sid)?.(pkgPrefix) ??
          flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", sid)?.(pkgPrefix) ??
          null
        );
      };
      const pkgSym =
        resolvePkgInScope(concreteScopeId) ??
        (elemParent && elemParent !== concreteScopeId ? resolvePkgInScope(elemParent) : null) ??
        flattener.db.byName(pkgPrefix).find((e) => e.kind === "Class" || e.kind === "Package");
      if (pkgSym) {
        let targetPkgId: SymbolId = pkgSym.id;
        const visitedAliases = new Set<SymbolId>();
        while (targetPkgId && !visitedAliases.has(targetPkgId)) {
          visitedAliases.add(targetPkgId);
          const shortCst = getCstNode(flattener.db, targetPkgId);
          const specShort = getShortClassSpecifierNode(shortCst);
          if (!specShort) break;
          const basePkg = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", targetPkgId);
          if (basePkg) {
            targetPkgId = basePkg.id;
            continue;
          }
          const tName = (
            Cst.ShortClassSpecifier.typeSpecifier(specShort) ??
            specShort.children?.find((c) => c.type === "type_specifier")
          )?.text?.trim();
          if (tName) {
            const aliasParentId = flattener.db.symbol(targetPkgId)?.parentId ?? concreteScopeId;
            const aliased =
              (aliasParentId
                ? flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", aliasParentId)?.(tName)
                : null) ?? flattener.db.byName(tName).find((e) => e.kind === "Class" || e.kind === "Package");
            if (aliased) {
              targetPkgId = aliased.id;
              continue;
            }
          }
          break;
        }
        pkgScopeId = targetPkgId;
      }
    }
    const classExtendsMods = collectExtendsMods(flattener, classTargetId!);
    const protectedNames = collectProtectedNames(flattener, classTargetId!);
    const targetMetaObj = getSymMeta(classTarget);
    const targetPrefixes = targetMetaObj.classPrefixes;
    const isConnector =
      (typeof targetPrefixes === "string" && targetPrefixes.includes("connector")) ||
      targetMetaObj.classKind === "connector" ||
      Boolean(parentMods?.isConnector);
    const isInterfaceRecord = Boolean(
      isRecordTarget && prefix === "" && (compInst?.causality === "input" || compInst?.causality === "output"),
    );
    const hasNonConnectorParent = Boolean(parentMods?.hasNonConnectorParent) || (!isConnector && !isInterfaceRecord);
    const recordCtorArgs: ModArgData[] = [];
    let resolvedPkgRecordConst = false;
    let isContinuousRecordCtorEq = false;
    let isContinuousRecordFnEq = false;
    let isParameterRecordInitEq = false;
    if (isRecordTarget && !hasOpRecBinding) {
      const bText = (
        matchingParentArg?.value?.text ??
        matchingClassArg?.value?.text ??
        compInst.modification?.bindingExpression?.text
      )?.trim();
      const cleanB = bText ? stripLeadingEquals(bText) : "";
      const ctorCallMatch = cleanB ? parseNamedCallArgsFromText(cleanB) : null;
      if (ctorCallMatch) {
        const ctorName = ctorCallMatch.callee;
        const targetBaseName = classTarget?.name ?? compInst.typeSpecifier?.split(".").pop();
        const origTypeBaseName = compInst.typeSpecifier?.split(".").pop();
        const isDirectRecordCtor =
          ctorName === targetBaseName ||
          ctorName.endsWith(`.${targetBaseName}`) ||
          Boolean(
            redeclArg &&
            origTypeBaseName &&
            (ctorName === origTypeBaseName || ctorName.endsWith(`.${origTypeBaseName}`)),
          );
        const derivedRecordSym = !isDirectRecordCtor
          ? (flattener.db
              .byName(ctorName.split(".").pop()!)
              .find(
                (e) =>
                  flattener.isRecordSym(e) &&
                  (e.name === ctorName || getSymbolQualifiedName(flattener.db, e.id) === ctorName),
              ) ?? flattener.db.byName(ctorName.split(".").pop()!).find((e) => flattener.isRecordSym(e)))
          : null;
        if (isDirectRecordCtor || derivedRecordSym) {
          if (derivedRecordSym) {
            flattener.usedRecordSymIds?.add(derivedRecordSym.id);
            if (derivedRecordSym.name) flattener.usedRecordNames?.add(derivedRecordSym.name);
            flattener.usedRecordNames?.add(ctorName);
            const derivedExtMods = collectExtendsMods(flattener, derivedRecordSym.id);
            for (const dm of derivedExtMods) {
              if (dm.name && dm.value) {
                recordCtorArgs.push({ name: dm.name, value: dm.value });
              }
            }
          }
          const rawArgs = splitTopLevelArgs(ctorCallMatch.argsText);
          const subSyms = subElements
            .map((id) => flattener.db.symbol(id))
            .filter((s): s is SymbolEntry =>
              Boolean(
                s &&
                s.kind === "Component" &&
                !flattener.isCstNodeProtected(flattener.db.cstNode(s.id)) &&
                getSymMeta(s).variability !== "constant",
              ),
            );
          const ctorEvalScopeId =
            matchingParentArg?.evaluationScopeId ??
            matchingClassArg?.evaluationScopeId ??
            flattener.db.symbol(elemId)?.parentId ??
            flattener.currentClassId;
          for (let aIdx = 0; aIdx < rawArgs.length; aIdx++) {
            const argStr = rawArgs[aIdx]!;
            const eqIdx = argStr.indexOf("=");
            if (eqIdx > 0 && !argStr.slice(0, eqIdx).includes("(") && !argStr.slice(0, eqIdx).includes("[")) {
              const fName = argStr.slice(0, eqIdx).trim();
              const fVal = argStr.slice(eqIdx + 1).trim();
              recordCtorArgs.push({
                name: fName,
                value: { kind: "expression", text: fVal },
                evaluationScopeId: ctorEvalScopeId,
              });
            } else if (subSyms[aIdx]) {
              const fName = subSyms[aIdx]!.name;
              recordCtorArgs.push({
                name: fName,
                value: { kind: "expression", text: argStr },
                evaluationScopeId: ctorEvalScopeId,
              });
            }
          }
          if (rawArgs.length === 0 && !isOpRec) {
            resolvedPkgRecordConst = true;
          }
          if (
            isDirectRecordCtor &&
            !matchingParentArg?.value &&
            !matchingClassArg?.value &&
            compInst.modification?.bindingExpression &&
            compInst.variability !== "parameter" &&
            compInst.variability !== "constant" &&
            parentMods?.parentVariability !== Variability.Parameter &&
            parentMods?.parentVariability !== Variability.Constant &&
            dae.classKind !== "function" &&
            (!compInst.arrayDimensions || compInst.arrayDimensions.length === 0) &&
            subSyms.length > 0 &&
            subSyms.every((s) => {
              const ci = flattener.db.query<ComponentInstanceData>("componentInstance", s.id);
              return ci?.variability !== "parameter" && ci?.variability !== "constant";
            }) &&
            recordCtorArgs.some((a) => containsWholeWordOutsideStrings(a.value?.text ?? "", "time"))
          ) {
            isContinuousRecordCtorEq = true;
          }
          if (!isContinuousRecordCtorEq && flattener.generateRecordConstructorFor) {
            const targetSymForCtor = derivedRecordSym ?? classTarget;
            const ctorFn =
              dae.getFunction(ctorName) ??
              (targetSymForCtor
                ? flattener.generateRecordConstructorFor(targetSymForCtor, dae, flattener.currentRootClassId)
                : null);
            if (ctorFn) {
              const providedNames = new Set(recordCtorArgs.map((a) => a.name).filter(Boolean));
              let hasDependentDefault = false;
              for (let vi = 0; vi < ctorFn.varCount; vi++) {
                if (ctorFn.getVarCausality(vi) === Causality.Input && !providedNames.has(ctorFn.getVarName(vi))) {
                  const defId = ctorFn.getVarExpression(vi);
                  if (defId !== undefined && defId >= 0) {
                    const k = ctorFn.getExprKind(defId);
                    if (
                      k !== ExprKind.IntLiteral &&
                      k !== ExprKind.RealLiteral &&
                      k !== ExprKind.BoolLiteral &&
                      k !== ExprKind.StringLiteral
                    ) {
                      hasDependentDefault = true;
                      break;
                    }
                  }
                }
              }
              if (hasDependentDefault) {
                const evalArgs: ArenaEvalArg[] = [];
                const namedEvalArgs: { name: string; value: number | boolean | string }[] = [];
                let canEvalAll = true;
                for (const rArg of recordCtorArgs) {
                  const txt = rArg.value?.text?.trim() ?? "";
                  const num = Number(txt);
                  if (!isNaN(num) && txt !== "") {
                    namedEvalArgs.push({ name: rArg.name, value: num });
                  } else if (txt === "true" || txt === "false") {
                    namedEvalArgs.push({ name: rArg.name, value: txt === "true" });
                  } else {
                    canEvalAll = false;
                    break;
                  }
                }
                if (canEvalAll && ctorFn.name) {
                  try {
                    const fnInternId = dae.interner.intern(ctorFn.name);
                    const evalWithNamed = evaluateArenaFunctionCall as unknown as EvaluateArenaFunctionCallWithNamed;
                    const res = evalWithNamed(
                      dae,
                      fnInternId,
                      evalArgs,
                      flattener.db,
                      targetSymForCtor!.id,
                      namedEvalArgs,
                    );
                    if (Array.isArray(res) && res.length === subSyms.length) {
                      for (let aIdx = 0; aIdx < res.length; aIdx++) {
                        const fName = subSyms[aIdx]!.name;
                        if (!providedNames.has(fName)) {
                          const val = res[aIdx];
                          const isInt = isIntegerTypeSpec(
                            flattener.db.query<string | null>("typeSpecifier", subSyms[aIdx]!.id),
                            flattener.db,
                          );
                          const fVal =
                            typeof val === "number"
                              ? Number.isInteger(val) && !isInt
                                ? `${val}.0`
                                : String(val)
                              : String(val);
                          recordCtorArgs.push({
                            name: fName,
                            value: { kind: "literal", value: val, text: fVal },
                            isRecordCtorDefault: true,
                          });
                        }
                      }
                    }
                  } catch {
                    /* fallback on evaluation error */
                  }
                }
              }
            }
          }
        } else if (!(isOpRec && classTarget?.name === "Complex")) {
          const ctorShortName = ctorName.includes(".") ? ctorName.split(".").pop()! : ctorName;
          const fnCandidates = flattener.db.byName(ctorShortName).filter((e) => flattener.isFunctionSym(e));
          const isNonPartialFn = (e: SymbolEntry) => {
            const fnCst = getCstNode(flattener.db, e.id);
            return !(hasClassHeaderKeywordCst(fnCst, "partial") && hasClassHeaderKeywordCst(fnCst, "function"));
          };
          const pkgScopeForFn = redeclPkgId ?? parentMods?.packageScopeId;
          const ctorPkgPrefix = pkgScopeForFn
            ? extractReplaceablePackagePrefix(ctorName, flattener, dae, redeclPkgPrefix, parentMods, classTargetId)
            : null;
          let matchingFnSym: SymbolEntry | undefined;
          if (pkgScopeForFn && ctorPkgPrefix) {
            const resolvedInPkg =
              flattener.db.query<ResolveSimpleNameFn | undefined>(
                "resolveSimpleName",
                pkgScopeForFn,
              )?.(ctorShortName) ??
              flattener.db.query<ResolveNameFn | undefined>("resolveName", pkgScopeForFn)?.(ctorShortName);
            if (resolvedInPkg && flattener.isFunctionSym(resolvedInPkg) && isNonPartialFn(resolvedInPkg)) {
              matchingFnSym = resolvedInPkg;
            }
          }
          if (!matchingFnSym) {
            const matchingByQn = ctorName.includes(".")
              ? fnCandidates.filter((e) => {
                  const qn = getSymbolQualifiedName(flattener.db, e.id);
                  return qn === ctorName || qn.endsWith(`.${ctorName}`);
                })
              : [];
            matchingFnSym =
              matchingByQn.find(isNonPartialFn) ??
              matchingByQn[0] ??
              fnCandidates.find(isNonPartialFn) ??
              fnCandidates[0];
          }
          if (matchingFnSym) {
            const parseConstArg = (s: string): ArenaEvalArg | null => {
              const t = s.trim();
              const n = Number(t);
              if (!isNaN(n) && t !== "") return n;
              if (t === "true") return true;
              if (t === "false") return false;
              const zCall = parseNamedCallArgsFromText(t);
              if (zCall && zCall.callee === "zeros" && isAsciiDigitsOnly(zCall.argsText.trim())) {
                return new Array<number>(Number(zCall.argsText.trim())).fill(0);
              }
              if (t.startsWith("{") && t.endsWith("}")) {
                const elems = parseArrayLiteralElements(t);
                const parsed = elems.map(parseConstArg);
                return parsed.every((p): p is ArenaEvalArg => p !== null) ? (parsed as ArenaEvalArg) : null;
              }
              if (t.endsWith("]")) {
                const lb = t.lastIndexOf("[");
                if (lb > 0) {
                  const inner = t.slice(lb + 1, -1);
                  const colonIdx = inner.indexOf(":");
                  if (
                    colonIdx > 0 &&
                    colonIdx < inner.length - 1 &&
                    !inner.includes(":", colonIdx + 1) &&
                    !inner.includes("]")
                  ) {
                    const startIdx = parseConstArg(inner.slice(0, colonIdx));
                    const stopIdx = parseConstArg(inner.slice(colonIdx + 1));
                    if (typeof startIdx === "number" && typeof stopIdx === "number") {
                      if (startIdx > stopIdx) return [];
                      const baseArr = parseConstArg(t.slice(0, lb));
                      if (Array.isArray(baseArr)) {
                        return baseArr.slice(startIdx - 1, stopIdx) as ArenaEvalArg;
                      }
                    }
                  }
                }
              }
              const scopedAp = prefix ? `${prefix}.${t}` : t;
              let vIdx = dae.lookupVariable(scopedAp);
              if (vIdx < 0) vIdx = dae.lookupVariable(t);
              if (vIdx >= 0) {
                if (!dae.isVarFixed(vIdx)) return null;
                const sv = dae.getVarExpression(vIdx);
                const val =
                  sv !== undefined && sv >= 0
                    ? evalDaeExpr(sv, dae)
                    : dae.hasExplicitVarExpression(vIdx)
                      ? dae.getVarStartValue(vIdx)
                      : null;
                return val !== null && val !== undefined ? (val as ArenaEvalArg) : null;
              }
              const arrBase = dae.hasArrayElements(scopedAp) ? scopedAp : dae.hasArrayElements(t) ? t : null;
              if (arrBase) {
                const elemIndices = dae.getArrayElementIndices(arrBase);
                if (elemIndices && elemIndices.length > 0) {
                  const vals: ArenaEvalArg[] = [];
                  for (const eIdx of elemIndices) {
                    const sv = dae.getVarExpression(eIdx);
                    const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(eIdx);
                    if (val === null || val === undefined) return null;
                    vals.push(val as ArenaEvalArg);
                  }
                  return vals;
                }
              }
              const tPkgPrefix = pkgScopeForFn
                ? extractReplaceablePackagePrefix(t, flattener, dae, redeclPkgPrefix, parentMods, classTargetId)
                : null;
              const strippedPkgT = pkgScopeForFn && tPkgPrefix ? t.slice(tPkgPrefix.length + 1) : t;
              const dbConst =
                (pkgScopeForFn ? lookupDbConstant(strippedPkgT, flattener.db, pkgScopeForFn) : null) ??
                lookupDbConstant(t, flattener.db, pkgScopeForFn ?? flattener.currentClassId);
              if (dbConst !== null && dbConst.value !== undefined) {
                return dbConst.value as ArenaEvalArg;
              }
              if (pkgScopeForFn) {
                const ev = flattener.db.evaluate(strippedPkgT, pkgScopeForFn);
                if (typeof ev === "number" || typeof ev === "boolean" || Array.isArray(ev)) {
                  return ev as ArenaEvalArg;
                }
              }
              return null;
            };
            const rawArgs = splitTopLevelArgs(ctorCallMatch.argsText);
            const hasNamedArg = rawArgs.some((a) => parseNamedArgAssignment(a) !== null);
            const prelimEvalArgs = !hasNamedArg ? rawArgs.map(parseConstArg) : null;
            if (
              prelimEvalArgs &&
              !prelimEvalArgs.every((a) => a !== null) &&
              !matchingParentArg?.value &&
              !matchingClassArg?.value &&
              compInst.modification?.bindingExpression &&
              compInst.variability !== "parameter" &&
              compInst.variability !== "constant" &&
              parentMods?.parentVariability !== Variability.Parameter &&
              parentMods?.parentVariability !== Variability.Constant &&
              dae.classKind !== "function" &&
              (!compInst.arrayDimensions || compInst.arrayDimensions.length === 0)
            ) {
              resolvedPkgRecordConst = true;
              isContinuousRecordFnEq = true;
            } else {
              const specPkgPrefix =
                pkgScopeForFn && ctorPkgPrefix
                  ? (() => {
                      const ownerClsId =
                        parentMods?.currentClassId ?? parentMods?.ownerClassId ?? flattener.currentClassId;
                      const ownerQual = ownerClsId ? getSymbolQualifiedName(flattener.db, ownerClsId) : "";
                      if (!ownerQual) return null;
                      return prefix
                        ? `${ownerQual}$${prefix.replaceAll(".", "$")}.${ctorPkgPrefix}`
                        : `${ownerQual}.${ctorPkgPrefix}`;
                    })()
                  : null;
              if (classTarget && flattener.generateRecordConstructorFor) {
                flattener.generateRecordConstructorFor(
                  classTarget,
                  dae,
                  flattener.currentRootClassId,
                  specPkgPrefix ? `${specPkgPrefix}.${classTarget.name}` : undefined,
                );
              }
              const qualFnName = specPkgPrefix
                ? `${specPkgPrefix}.${ctorShortName}`
                : getSymbolQualifiedName(flattener.db, matchingFnSym.id);
              let fn = dae.getFunction(qualFnName) ?? (!specPkgPrefix ? dae.getFunction(ctorName) : undefined);
              if (!fn) {
                const prevSpecPrefix = flattener.currentFunctionSpecializedPrefix;
                const prevCompPrefix = flattener.currentFunctionComponentPrefix;
                if (specPkgPrefix) {
                  flattener.currentFunctionSpecializedPrefix = specPkgPrefix;
                  flattener.currentFunctionComponentPrefix = prefix || undefined;
                }
                try {
                  fn = flattener.flattenFunction(
                    matchingFnSym.id,
                    qualFnName,
                    undefined,
                    dae,
                    specPkgPrefix ? pkgScopeForFn : undefined,
                  );
                } finally {
                  flattener.currentFunctionSpecializedPrefix = prevSpecPrefix;
                  flattener.currentFunctionComponentPrefix = prevCompPrefix;
                }
                dae.addFunction(qualFnName, fn);
                if (!specPkgPrefix) {
                  dae.addFunction(ctorName, fn);
                }
              }
              if (fn) {
                asExtDae(fn).wasCalled = true;
                flattener.calledFunctionSymIds?.add(matchingFnSym.id);
                for (const [nName, nFn] of fn.functions?.entries() ?? []) {
                  const extNFn = asExtDae(nFn);
                  extNFn.wasCalled = true;
                  if (extNFn.symId) flattener.calledFunctionSymIds?.add(extNFn.symId);
                  dae.addFunction(nName, nFn);
                }
              }
              if (fn && fn.diagnostics.some((d: { severity?: string }) => d.severity === "error")) {
                flattener.failedFunctionIds?.add(matchingFnSym.id);
                flattener.invalidInterfaceFunctionIds?.add(matchingFnSym.id);
                if (dae.extensionMetadata?.["isOldFrontend"]) {
                  const scopeName =
                    (flattener.currentRootClassId ? flattener.db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
                  let compClauseNode: SyntaxNode | null = elemCst;
                  while (compClauseNode && compClauseNode.type !== "component_clause") {
                    compClauseNode = compClauseNode.parent;
                  }
                  const callRange = compClauseNode
                    ? {
                        startPosition: compClauseNode.startPosition,
                        endPosition: compClauseNode.endPosition,
                      }
                    : undefined;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
                    message: ModelicaErrorCode.CLASS_NOT_FOUND.message(ctorName, scopeName),
                    range: callRange,
                  });
                }
              }
              let evalArgs: (ArenaEvalArg | null)[];
              if (hasNamedArg && fn) {
                const inputNames: string[] = [];
                const inputDefaults = new Map<string, ArenaEvalArg>();
                for (let vi = 0; vi < fn.varCount; vi++) {
                  if (fn.isVarRemoved(vi)) continue;
                  if (fn.getVarCausality(vi) === Causality.Input) {
                    const rawVName = fn.getVarName(vi);
                    const bIdx = rawVName.indexOf("[");
                    const vName = bIdx >= 0 ? rawVName.slice(0, bIdx) : rawVName;
                    if (!inputNames.includes(vName)) {
                      inputNames.push(vName);
                      const vExpr = fn.getVarExpression(vi);
                      if (vExpr !== undefined && vExpr >= 0) {
                        const dVal = evalDaeExpr(vExpr, fn);
                        if (dVal !== null && dVal !== undefined) inputDefaults.set(vName, dVal);
                      } else if (fn.hasExplicitVarExpression(vi)) {
                        inputDefaults.set(vName, fn.getVarStartValue(vi));
                      }
                    }
                  }
                }
                const byName = new Map<string, ArenaEvalArg | null>();
                let posIdx = 0;
                for (const ra of rawArgs) {
                  const nmMatch = parseNamedArgAssignment(ra);
                  if (nmMatch) {
                    byName.set(nmMatch.name, parseConstArg(nmMatch.valueText));
                  } else {
                    if (posIdx < inputNames.length) {
                      byName.set(inputNames[posIdx]!, parseConstArg(ra));
                    }
                    posIdx++;
                  }
                }
                evalArgs = inputNames.map((inName) =>
                  byName.has(inName) ? (byName.get(inName) ?? null) : (inputDefaults.get(inName) ?? null),
                );
              } else {
                evalArgs = prelimEvalArgs ?? rawArgs.map(parseConstArg);
              }
              if (evalArgs.every((a): a is ArenaEvalArg => a !== null)) {
                const fnInternId = dae.interner.intern(qualFnName);
                let res: ArenaEvalResult = null;
                try {
                  res = evaluateArenaFunctionCall(dae, fnInternId, evalArgs, flattener.db, matchingFnSym.id);
                  if (res === null) {
                    const shortInternId = dae.interner.intern(ctorName);
                    res = evaluateArenaFunctionCall(dae, shortInternId, evalArgs, flattener.db, matchingFnSym.id);
                  }
                } catch {
                  /* fallback on evaluation error */
                }
                if (res !== null) {
                  const formatEvalVal = (v: unknown, isInt: boolean): string => {
                    if (Array.isArray(v)) {
                      return `{${v.map((item) => formatEvalVal(item, isInt)).join(", ")}}`;
                    }
                    if (typeof v === "number") {
                      const cleanV = Math.abs(v) === 0 ? 0 : v;
                      return Number.isInteger(cleanV) && !isInt ? `${cleanV}.0` : String(cleanV);
                    }
                    return String(v);
                  };
                  const subSyms = subElements
                    .map((id) => flattener.db.symbol(id))
                    .filter((s): s is SymbolEntry =>
                      Boolean(
                        s &&
                        s.kind === "Component" &&
                        !flattener.isCstNodeProtected(flattener.db.cstNode(s.id)) &&
                        getSymMeta(s).variability !== "constant",
                      ),
                    );
                  if (Array.isArray(res) && res.length === subSyms.length) {
                    for (let aIdx = 0; aIdx < res.length; aIdx++) {
                      const fName = subSyms[aIdx]!.name;
                      const val = res[aIdx];
                      const isInt = isIntegerTypeSpec(
                        flattener.db.query<string | null>("typeSpecifier", subSyms[aIdx]!.id),
                        flattener.db,
                      );
                      const fVal = formatEvalVal(val, isInt);
                      recordCtorArgs.push({
                        name: fName,
                        isRecordCtorArg: true,
                        value: {
                          kind: Array.isArray(val) ? "expression" : "literal",
                          value: Array.isArray(val) ? undefined : val,
                          text: fVal,
                        },
                      });
                    }
                    resolvedPkgRecordConst = true;
                  } else if (typeof res === "number" && subSyms.length === 1) {
                    const fName = subSyms[0]!.name;
                    const isInt = isIntegerTypeSpec(
                      flattener.db.query<string | null>("typeSpecifier", subSyms[0]!.id),
                      flattener.db,
                    );
                    const fVal = formatEvalVal(res, isInt);
                    recordCtorArgs.push({
                      name: fName,
                      isRecordCtorArg: true,
                      value: { kind: "literal", value: res, text: fVal },
                    });
                    resolvedPkgRecordConst = true;
                  }
                }
              }
              if (
                !resolvedPkgRecordConst &&
                (compInst.variability === "parameter" || parentMods?.parentVariability === Variability.Parameter) &&
                dae.classKind !== "function" &&
                (!compInst.arrayDimensions || compInst.arrayDimensions.length === 0)
              ) {
                isParameterRecordInitEq = true;
              }
            }
          }
        }
      } else if (cleanB && cleanB.includes(".") && isDottedIdentifierChain(cleanB)) {
        const leafName = cleanB.split(".").pop()!;
        const pkgComp = flattener.db
          .byName(leafName)
          .find((e) => e.kind === "Component" && getSymbolQualifiedName(flattener.db, e.id) === cleanB);
        if (pkgComp) {
          const pkgCompInst = flattener.db.query<ComponentInstanceInfo>("componentInstance", pkgComp.id);
          if (pkgCompInst?.modification?.args && pkgCompInst.modification.args.length > 0) {
            recordCtorArgs.push(...pkgCompInst.modification.args);
            resolvedPkgRecordConst = true;
          } else if (pkgCompInst?.modification?.bindingExpression?.text) {
            const pkgBText = stripLeadingEquals(pkgCompInst.modification.bindingExpression.text);
            const pkgCtorMatch = parseNamedCallArgsFromText(pkgBText);
            if (pkgCtorMatch) {
              const pkgCtorName = pkgCtorMatch.callee;
              const pkgCtorSym = flattener.db
                .byName(pkgCtorName.split(".").pop()!)
                .find((e) => flattener.isRecordSym(e));
              if (pkgCtorSym && flattener.generateRecordConstructorFor) {
                const pkgScopeId = pkgComp.parentId ?? flattener.currentRootClassId;
                flattener.generateRecordConstructorFor(pkgCtorSym, dae, pkgScopeId);
              }
              const rawArgs = splitTopLevelArgs(pkgCtorMatch.argsText);
              const subSyms = subElements
                .map((id) => flattener.db.symbol(id))
                .filter((s): s is SymbolEntry =>
                  Boolean(
                    s &&
                    s.kind === "Component" &&
                    !flattener.isCstNodeProtected(flattener.db.cstNode(s.id)) &&
                    getSymMeta(s).variability !== "constant",
                  ),
                );
              for (let aIdx = 0; aIdx < rawArgs.length; aIdx++) {
                const argStr = rawArgs[aIdx]!;
                const eqIdx = argStr.indexOf("=");
                if (eqIdx > 0 && !argStr.slice(0, eqIdx).includes("(") && !argStr.slice(0, eqIdx).includes("[")) {
                  const fName = argStr.slice(0, eqIdx).trim();
                  const fVal = argStr.slice(eqIdx + 1).trim();
                  recordCtorArgs.push({ name: fName, value: { kind: "expression", text: fVal } });
                } else if (subSyms[aIdx]) {
                  const fName = subSyms[aIdx]!.name;
                  recordCtorArgs.push({ name: fName, value: { kind: "expression", text: argStr } });
                }
              }
              resolvedPkgRecordConst = true;
            }
          }
        }
      }
    }

    const isRecordVarRef =
      !resolvedPkgRecordConst &&
      parentMods?.bindingExpression?.text &&
      isDottedComponentRefWithSubscripts(parentMods.bindingExpression.text.trim(), true);
    const parentBoundRecordField = isRecordVarRef
      ? { kind: "expression", text: `${parentMods!.bindingExpression!.text!.trim()}.${compInst.name}` }
      : null;

    const bindingScope = matchingParentArg?.value
      ? prefix.includes(".")
        ? prefix.split(".").slice(0, -1).join(".")
        : ""
      : (parentMods?.bindingScope ?? prefix);

    let compClauseNode: SyntaxNode | null = elemCst;
    while (compClauseNode && compClauseNode.type !== "component_clause") {
      compClauseNode = compClauseNode.parent;
    }
    const compClauseRange: DiagnosticRange | undefined = compClauseNode
      ? {
          startOffset: compClauseNode.startIndex ?? compClauseNode.startOffset ?? 0,
          endOffset: compClauseNode.endIndex ?? compClauseNode.endOffset ?? 0,
          startPosition: compClauseNode.startPosition,
          endPosition: compClauseNode.endPosition,
        }
      : elemCst
        ? {
            startOffset: elemCst.startIndex ?? elemCst.startOffset ?? 0,
            endOffset: elemCst.endIndex ?? elemCst.endOffset ?? 0,
            startPosition: elemCst.startPosition,
            endPosition: elemCst.endPosition,
          }
        : undefined;

    if (compClauseRange) {
      state.currentCompClauseRange = compClauseRange;
    }

    // Tag local component modifiers with their lexical `evaluationScopeId` so relative name
    // references inside modifier expressions resolve in the declaring component's scope.
    const resolveChainedRedecl = (
      arg: ModArgData,
      fallbackScopeId: number | null | undefined,
      extraMods?: readonly ModArgData[],
    ): ModArgData => {
      let effRedeclSpec = arg.redeclaredTypeSpecifier;
      let effEvalScopeId = arg.evaluationScopeId ?? fallbackScopeId;
      let effOwnerClassId = arg.ownerClassId;
      if ((arg.isRedeclaration || effRedeclSpec) && effRedeclSpec) {
        const visitedRedecl = new Set<string>();
        while (effRedeclSpec && !effRedeclSpec.includes(".")) {
          const visitKey = `${effRedeclSpec}@${effEvalScopeId ?? ""}@${effOwnerClassId ?? ""}`;
          if (visitedRedecl.has(visitKey)) break;
          visitedRedecl.add(visitKey);
          const outerRedecl =
            extraMods
              ?.slice()
              .reverse()
              .find(
                (pa) =>
                  pa !== arg &&
                  !pa.isBreak &&
                  (pa.isRedeclaration || pa.redeclaredTypeSpecifier) &&
                  pa.name === effRedeclSpec &&
                  pa.redeclaredTypeSpecifier &&
                  (pa.redeclaredTypeSpecifier !== pa.name ||
                    (pa.evaluationScopeId !== undefined && pa.evaluationScopeId !== effEvalScopeId) ||
                    (pa.ownerClassId !== undefined && pa.ownerClassId !== effOwnerClassId)),
              ) ??
            parentMods?.args
              ?.slice()
              .reverse()
              .find(
                (pa) =>
                  !pa.isBreak &&
                  (pa.isRedeclaration || pa.redeclaredTypeSpecifier) &&
                  pa.name === effRedeclSpec &&
                  pa.redeclaredTypeSpecifier &&
                  (pa.redeclaredTypeSpecifier !== pa.name ||
                    (pa.evaluationScopeId !== undefined && pa.evaluationScopeId !== effEvalScopeId) ||
                    (pa.ownerClassId !== undefined && pa.ownerClassId !== effOwnerClassId)),
              );
          if (outerRedecl?.redeclaredTypeSpecifier) {
            effRedeclSpec = outerRedecl.redeclaredTypeSpecifier;
            effEvalScopeId = outerRedecl.evaluationScopeId ?? outerRedecl.ownerClassId ?? effEvalScopeId;
            effOwnerClassId = outerRedecl.ownerClassId ?? effOwnerClassId;
          } else {
            break;
          }
        }
        if (!effRedeclSpec.includes(".") && flattener.currentClassId) {
          const localSym: SymbolEntry | null | undefined =
            flattener.db.query<(n: string) => SymbolEntry | null>(
              "resolveName",
              flattener.currentClassId,
            )?.(effRedeclSpec) ??
            flattener.db.query<(n: string) => SymbolEntry | null>(
              "resolveSimpleName",
              flattener.currentClassId,
            )?.(effRedeclSpec);
          if (localSym && (localSym.kind === "Class" || localSym.kind === "Package")) {
            let curSym: SymbolEntry | null = localSym;
            const visitedAliases = new Set<SymbolId>();
            while (curSym && !visitedAliases.has(curSym.id)) {
              visitedAliases.add(curSym.id);
              const curCst = getCstNode(flattener.db, curSym.id);
              if (!getShortClassSpecifierNode(curCst)) break;
              if (
                flattener.db.query<boolean>("isReplaceable", curSym.id) ||
                curCst?.parent?.type === "element_replaceable"
              ) {
                break;
              }
              if (flattener.db.query<ParentModData | null>("effectiveModification", curSym.id)) break;
              const curMeta = getSymMeta(curSym);
              if (
                String(curMeta.classKind ?? curMeta.classPrefixes ?? "")
                  .toLowerCase()
                  .includes("type")
              ) {
                break;
              }
              const nextBase: SymbolEntry | null = flattener.db.query<SymbolEntry | null>(
                "resolvedBaseClass",
                curSym.id,
              );
              if (nextBase && !getSymMeta(nextBase).isPredefined) curSym = nextBase;
              else break;
            }
            if (curSym && curSym.id !== localSym.id) {
              effRedeclSpec = getSymbolQualifiedName(flattener.db, curSym.id) || curSym.name;
            }
          }
        }
      }
      return {
        ...arg,
        redeclaredTypeSpecifier: effRedeclSpec,
        evaluationScopeId: effEvalScopeId,
        ...(effOwnerClassId !== undefined ? { ownerClassId: effOwnerClassId } : {}),
      };
    };

    const tagEvalScope = (
      args: readonly ModArgData[] | undefined,
      scopeId: number | null | undefined,
    ): ModArgData[] => {
      if (!args || !scopeId) return args ? [...args] : [];
      return args.map((a) => {
        const resolvedA = resolveChainedRedecl(a, scopeId);
        const effScopeId = resolvedA.evaluationScopeId ?? scopeId;
        return {
          ...resolvedA,
          value: a.value ? { ...a.value, evaluationScopeId: a.value.evaluationScopeId ?? effScopeId } : a.value,
          nestedArgs: a.nestedArgs ? tagEvalScope(a.nestedArgs, effScopeId) : a.nestedArgs,
          args: a.args ? tagEvalScope(a.args, effScopeId) : a.args,
        };
      });
    };

    // Merge hierarchical modifications in precedence order (inner/default -> outer/override):
    //   1. Base `extends` class modifications (`classExtendsMods`)
    //   2. Class-level type modifications (`matchingClassArg`)
    //   3. Component declaration modifications (`compInst.modification.args`)
    //   4. Outer instance modifications passed down via `parentMods` (`matchingParentArg`)
    //   5. Record constructor positional/named arguments (`recordCtorArgs`)
    const rawSubModArgs: ModArgData[] = [
      ...classExtendsMods.map((m) => ({
        ...m,
        originPrefix: m.originPrefix ?? name,
        ownerClassId: m.ownerClassId ?? classTargetId ?? undefined,
      })),
      ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
      ...tagEvalScope(compInst.modification?.args, elemId).map((m) => ({
        ...m,
        originPrefix: m.originPrefix ?? prefix,
        ownerClassId: m.ownerClassId ?? flattener.currentClassId ?? elemSym?.parentId ?? undefined,
      })),
      ...(parentMods?.args
        ?.filter((a) => !a.isBreak && a.name === compInst.name)
        .flatMap((a) =>
          (a.nestedArgs || a.args || []).map((na) => ({
            ...na,
            ...(a.isExtendsMod ? { isExtendsMod: true, isFromParentExtends: true } : {}),
            originPrefix: na.originPrefix ?? a.originPrefix ?? prefix,
            ownerClassId: na.ownerClassId ?? a.ownerClassId ?? parentMods?.ownerClassId,
          })),
        ) || []),
      ...recordCtorArgs,
    ];
    const resolvedSubModArgs = rawSubModArgs.map((a) =>
      (a.isRedeclaration || a.redeclaredTypeSpecifier) && a.redeclaredTypeSpecifier
        ? resolveChainedRedecl(a, a.evaluationScopeId, rawSubModArgs)
        : a,
    );
    const recordBindingSource =
      matchingParentArg?.value ?? matchingClassArg?.value ?? compInst.modification?.bindingExpression;
    const cleanRecordBindText = recordBindingSource?.text ? stripLeadingEquals(recordBindingSource.text) : "";
    const isSelfRecordVarRef =
      Boolean(cleanRecordBindText) && isDottedComponentRefWithSubscripts(cleanRecordBindText, false);
    const isParamRecord =
      compInst.variability === "parameter" || parentMods?.parentVariability === Variability.Parameter;
    if (
      isRecordTarget &&
      !hasOpRecBinding &&
      isParamRecord &&
      cleanRecordBindText &&
      !isSelfRecordVarRef &&
      // OMC keeps `Complex S = Complex(p0, q0)` as a whole-record equation instead of scalarizing
      // the constructor call into field bindings (only field modifications become bindings).
      (recordCtorArgs.length === 0 ||
        (Boolean(flattener.options.omcCompatibility) &&
          isOpRec &&
          (() => {
            const parenIdx = cleanRecordBindText.indexOf("(");
            if (parenIdx <= 0) return false;
            const callee = cleanRecordBindText.slice(0, parenIdx).trim();
            if (!isDottedIdentifierChain(callee)) return false;
            // Constant-literal arguments (`Complex(0, 0)`) are evaluated and scalarized by OMC; only
            // calls that reference other variables/parameters stay as a record equation.
            return extractAsciiIdentifiers(stripCommentsAndStrings(cleanRecordBindText.slice(parenIdx + 1))).length > 0;
          })())) &&
      !resolvedPkgRecordConst &&
      !isRecordVarRef &&
      dae.classKind !== "function" &&
      (!compInst.arrayDimensions || compInst.arrayDimensions.length === 0)
    ) {
      isParameterRecordInitEq = true;
    }
    const effectiveSubMod: ParentModData = {
      args: resolvedSubModArgs,
      suppressDefaultBindings: isContinuousRecordCtorEq || isParameterRecordInitEq,
      forceFixedFalse: Boolean(
        (isParameterRecordInitEq && !(isOpRec && classTarget?.name === "Complex")) || parentMods?.forceFixedFalse,
      ),
      instantiatingClassIds: nextInstantiatingClassIds,
      componentClauseRange: compClauseRange ?? parentMods?.componentClauseRange,
      currentClassId: classTargetId ?? flattener.currentClassId,
      bindingExpression:
        hasOpRecBinding || resolvedPkgRecordConst || isContinuousRecordCtorEq || isParameterRecordInitEq
          ? null
          : (matchingParentArg?.value ??
            matchingClassArg?.value ??
            parentBoundRecordField ??
            compInst.modification?.bindingExpression),
      isProtected: isElemProtected,
      protectedNames,
      packageScopeId: pkgScopeId,
      specializedPkgPrefix: compSpecPkgPrefix ?? undefined,
      isConnector,
      hasNonConnectorParent,
      bindingScope,
      isRecord: Boolean(isRecordTarget || parentMods?.isRecord),
      parentVariability:
        compInst?.variability === "parameter"
          ? Variability.Parameter
          : compInst?.variability === "constant"
            ? Variability.Constant
            : compInst?.variability === "discrete"
              ? Variability.Discrete
              : parentMods?.parentVariability,
      parentCausality:
        compInst?.causality === "input"
          ? Causality.Input
          : compInst?.causality === "output"
            ? Causality.Output
            : parentMods?.parentCausality,
      parentFlowPrefix:
        parentMods?.isConnector || (!flattener.isOldFrontend && !dae.extensionMetadata?.["isOldFrontend"])
          ? ((compInst?.flowPrefix && compInst.flowPrefix !== "unspecified" ? compInst.flowPrefix : undefined) ??
            (meta.flowPrefix && meta.flowPrefix !== "unspecified" ? meta.flowPrefix : undefined) ??
            parentMods?.parentFlowPrefix)
          : undefined,
      isFinal: compInst?.isFinal || meta.isFinal || parentMods?.isFinal,
    };
    const childEnvPtr = wasmEnv ? wasmEnv.lookupNested(dae.interner.intern(compInst.name)) : 0;
    if (childEnvPtr !== 0) {
      effectiveSubMod.wasmEnv = new ModelicaModificationEnv(dae.exports, childEnvPtr);
    }
    let arrayDims = compInst?.arrayDimensions;
    const rawCompDims =
      arrayDims && arrayDims.length > 0
        ? flattener.db.query<ArrayDimRawEntry[] | null>("arrayDimensions", elemId)
        : null;
    if (arrayDims && (arrayDims.some((d) => d <= 0) || rawCompDims?.some((d) => d?.kind === "expression"))) {
      const rawDims = rawCompDims;
      let dimNames: string[] = [];
      if (rawDims && rawDims.length === arrayDims.length) {
        dimNames = rawDims.map((d) => d?.text?.trim() ?? "");
      }
      if (dimNames.length === 0 && elemCst) {
        const firstDim = firstBracketedIdentifier(elemCst.text ?? "");
        if (firstDim) {
          dimNames = [firstDim];
        }
      }
      const resolvedDims = [...arrayDims];
      for (let i = 0; i < resolvedDims.length; i++) {
        if (resolvedDims[i]! <= 0 || rawDims?.[i]?.kind === "expression") {
          const dimName = dimNames[i];
          if ((rawDims?.[i]?.kind === "flexible" || dimName === ":") && resolvedDims[i]! <= 0) {
            for (const rArg of recordCtorArgs) {
              const txt = rArg.value?.text?.trim() ?? "";
              if (txt.startsWith("{") && txt.endsWith("}")) {
                const items = splitTopLevelArgs(txt.slice(1, -1));
                if (items.length > 0) {
                  resolvedDims[i] = items.length;
                  break;
                }
              }
            }
          }
          if (dimName && dimName !== ":") {
            const prefixedDim = prefix ? `${prefix}.${dimName}` : dimName;
            let varIdx = dae.getVarIdxByName(prefixedDim);
            if (varIdx < 0) varIdx = dae.getVarIdxByName(dimName);
            let evalVal: unknown = null;
            if (varIdx >= 0) {
              const exprId = dae.getVarExpression(varIdx);
              if (exprId !== undefined) evalVal = evalDaeExpr(exprId, dae);
            }
            if (typeof evalVal !== "number" || evalVal < 0) {
              const arg = parentMods?.args?.find((a) => a.name === dimName);
              if (arg?.value) {
                if (arg.value.kind === "literal" && typeof arg.value.value === "number") {
                  evalVal = arg.value.value;
                } else if (arg.value.kind === "expression" && arg.value.text) {
                  const num = Number(arg.value.text.trim());
                  if (!isNaN(num)) evalVal = num;
                }
              }
            }
            if (typeof evalVal !== "number" || evalVal < 0) {
              evalVal = evaluateCSTNumber(
                dimName,
                undefined,
                flattener.currentClassId ?? undefined,
                flattener.db,
                dae,
                prefix,
              );
            }
            if (typeof evalVal === "number" && evalVal >= 0) {
              resolvedDims[i] = evalVal;
            } else if (flattener.options.omcCompatibility) {
              const sizeMatch = parseSizeCallIdentDim(dimName);
              if (sizeMatch) {
                const targetVarName = sizeMatch.target;
                const targetDimIdx = sizeMatch.dimStr;
                const targetElemSym = flattener.currentRootClassId
                  ? flattener.db
                      .childrenOf(flattener.currentRootClassId)
                      ?.find((c) => c.name === targetVarName && c.kind === "Component")
                  : null;
                if (targetElemSym) {
                  const targetCompInst = flattener.db.query<ComponentInstanceData>(
                    "componentInstance",
                    targetElemSym.id,
                  );
                  const targetRawDims = flattener.db.query<ArrayDimRawEntry[] | null>(
                    "arrayDimensions",
                    targetElemSym.id,
                  );
                  const targetCst = getCstNode(flattener.db, targetElemSym.id);
                  const cstText = targetCst?.text ?? "";
                  const targetHasColon =
                    (targetRawDims &&
                      targetRawDims.some(
                        (d) => d?.text?.trim() === ":" || d?.kind === "colon" || d?.kind === "flexible",
                      )) ||
                    hasColonSubscript(cstText);
                  const targetBinding = flattener.db.query<EffectiveBindingData | null>(
                    "effectiveBinding",
                    targetElemSym.id,
                  );
                  const targetHasBinding = Boolean(
                    targetCompInst?.modification?.bindingExpression || targetBinding?.expression,
                  );
                  if (targetHasColon && !targetHasBinding) {
                    let targetClauseNode: SyntaxNode | null = targetCst;
                    while (targetClauseNode && targetClauseNode.type !== "component_clause") {
                      targetClauseNode = targetClauseNode.parent;
                    }
                    const diagNode = targetClauseNode ?? targetCst;
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.code,
                      message: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.message(targetDimIdx, targetVarName),
                      range: {
                        startOffset: diagNode?.startIndex ?? diagNode?.startOffset,
                        endOffset: diagNode?.endIndex ?? diagNode?.endOffset,
                        startPosition: diagNode?.startPosition,
                        endPosition: diagNode?.endPosition,
                      },
                    });
                    return "return";
                  }
                }
              }
              const isFunc =
                dae.classKind === "function" ||
                Boolean(
                  flattener.currentClassId &&
                  getSymMeta(flattener.db.symbol(flattener.currentClassId)).classKind === "function",
                );
              if (!isFunc && resolvedDims[i]! < 0) {
                if (flattener.options.arrayMode === "preserve" && dae.extensionMetadata?.["isOldFrontend"]) {
                  dae.diagnostics.push({
                    severity: "error",
                    code: 0,
                    message: `Error occurred while flattening model ${dae.name}`,
                    range: null,
                  });
                  return "return";
                }
                const startB = elemCst?.startIndex ?? elemCst?.startOffset;
                const endB = elemCst?.endIndex ?? elemCst?.endOffset;
                const arrayName = getDaeExtMeta(dae)?.hasOldInstOption ? `${compInst.name}[${dimName}]` : compInst.name;
                dae.diagnostics.push({
                  severity: "error",
                  message: `Could not evaluate structural parameter (or constant): ${dimName} which gives dimensions of array: ${arrayName}. Array dimensions must be known at compile time.`,
                  range: {
                    startOffset: startB,
                    endOffset: endB,
                    startPosition: elemCst?.startPosition,
                    endPosition: elemCst?.endPosition,
                  },
                });
                return "return";
              }
            }
          }
        }
      }
      arrayDims = resolvedDims;
    }
    if (
      dae.extensionMetadata?.["isOldFrontend"] &&
      dae.classKind !== "function" &&
      classTargetId &&
      !(arrayDims && arrayDims.some((d) => d === 0))
    ) {
      const elaboratePkgConsts = (pkgId: SymbolId, pkgPrefix: string) => {
        const elabSet: Set<string> = (flattener.elaboratedPkgPrefixes ??= new Set<string>());
        if (elabSet.has(pkgPrefix)) return;
        elabSet.add(pkgPrefix);
        const pkgElements = flattener.db.query<SymbolId[]>("instantiate", pkgId) ?? [];
        const pkgExtendsMods = collectExtendsMods(flattener, pkgId);
        for (const peId of pkgElements) {
          const peSym = flattener.db.symbol(peId);
          if (!peSym || peSym.kind !== "Component") continue;
          const peInst = flattener.db.query<ComponentInstanceData>("componentInstance", peId);
          const peCst = getCstNode(flattener.db, peId);
          const isConst =
            peInst?.variability === "constant" ||
            getSymMeta(peSym).variability === "constant" ||
            tokenizeCommentStrippedWords(peCst?.text ?? "").includes("constant");
          if (!isConst) continue;
          if (peInst?.typeSpecifier) {
            const tSpec = stripLeadingDots(peInst.typeSpecifier);
            const recSym =
              (tSpec.includes(".")
                ? flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", pkgId)?.(tSpec)
                : flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", pkgId)?.(tSpec)) ??
              flattener.db
                .byName(tSpec.split(".").pop()!)
                .find(
                  (e) =>
                    flattener.isRecordSym(e) &&
                    (!tSpec.includes(".") || getSymbolQualifiedName(flattener.db, e.id) === tSpec),
                );
            if (recSym && flattener.isRecordSym(recSym)) {
              if (recSym.parentId && flattener.isClassPartial(recSym.parentId)) {
                flattener.generateRecordConstructorFor?.(
                  recSym,
                  dae,
                  flattener.currentRootClassId,
                  `${pkgPrefix}.${recSym.name}`,
                  recSym.name,
                );
              } else {
                flattener.generateRecordConstructorFor?.(recSym, dae, flattener.currentRootClassId);
                if (peInst.modification?.args && peInst.modification.args.length > 0 && peSym.name) {
                  const recQual = getSymbolQualifiedName(flattener.db, recSym.id) || recSym.name;
                  flattener.generateRecordConstructorFor?.(
                    recSym,
                    dae,
                    flattener.currentRootClassId,
                    `${recQual}$${peSym.name}`,
                    `${recSym.name}$${peSym.name}`,
                  );
                }
              }
            }
          }
          const extMod = [...pkgExtendsMods].reverse().find((m) => m.name === peSym.name && m.value?.text);
          const bText = (extMod?.value?.text ?? peInst?.modification?.bindingExpression?.text)?.trim();
          if (bText) {
            for (const fnCallName of extractCallTargetsFromExpr(bText, null, false)) {
              if (
                fnCallName === "fill" ||
                fnCallName === "size" ||
                fnCallName === "zeros" ||
                fnCallName === "ones" ||
                fnCallName === "array"
              ) {
                continue;
              }
              const cleanFnCall = stripLeadingDots(fnCallName);
              if (cleanFnCall.includes(".")) {
                const fnShort = cleanFnCall.split(".").pop()!;
                const fnSym =
                  flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", pkgId)?.(cleanFnCall) ??
                  flattener.db
                    .byName(fnShort)
                    .find(
                      (e) =>
                        flattener.isFunctionSym(e) &&
                        !flattener.isClassPartial(e.id) &&
                        getSymbolQualifiedName(flattener.db, e.id) === cleanFnCall,
                    );
                if (fnSym && flattener.isFunctionSym(fnSym) && !flattener.isClassPartial(fnSym.id)) {
                  const fnQual = getSymbolQualifiedName(flattener.db, fnSym.id) || cleanFnCall;
                  if (!dae.getFunction(fnQual)) {
                    const fn = flattener.flattenFunction(fnSym.id, fnQual, undefined, dae);
                    if (fn) asExtDae(fn).wasCalled = true;
                  }
                }
              } else {
                const fnSym =
                  flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", pkgId)?.(cleanFnCall) ??
                  flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", pkgId)?.(cleanFnCall);
                if (fnSym && flattener.isFunctionSym(fnSym) && !flattener.isClassPartial(fnSym.id)) {
                  const specFnQual = `${pkgPrefix}.${fnSym.name}`;
                  if (!dae.getFunction(specFnQual)) {
                    const prevSpecPrefix = flattener.currentFunctionSpecializedPrefix;
                    flattener.currentFunctionSpecializedPrefix = pkgPrefix;
                    try {
                      const fn = flattener.flattenFunction(fnSym.id, specFnQual, undefined, dae, pkgId);
                      if (fn) asExtDae(fn).wasCalled = true;
                    } finally {
                      flattener.currentFunctionSpecializedPrefix = prevSpecPrefix;
                    }
                  }
                }
              }
            }
            const cleanRef = stripLeadingDots(bText).trim();
            if (cleanRef.includes(".") && isDottedIdentifierChain(cleanRef)) {
              const refParts = cleanRef.split(".");
              const refCompName = refParts.pop()!;
              const refPkgQual = refParts.join(".");
              const refCompSym = flattener.db
                .byName(refCompName)
                .find((e) => e.kind === "Component" && getSymbolQualifiedName(flattener.db, e.id) === cleanRef);
              if (refCompSym && refCompSym.parentId) {
                elaboratePkgConsts(refCompSym.parentId, refPkgQual);
              }
            }
          }
        }
      };
      const pkgRedeclByName = new Map<string, ModArgData>();
      for (const a of resolvedSubModArgs) {
        if (
          !a ||
          a.isBreak ||
          !(a.isRedeclaration || a.redeclaredTypeSpecifier) ||
          !a.redeclaredTypeSpecifier ||
          !a.name
        ) {
          continue;
        }
        pkgRedeclByName.set(a.name, a);
        (state.packageRedeclares ??= new Set<string>()).add(a.name);
      }
      const targetClassQual = getSymbolQualifiedName(flattener.db, classTargetId);
      const unsubscriptedComp = stripArraySubscripts(name).replaceAll(".", "$");
      if (targetClassQual) {
        for (const [pkgName, pkgArg] of pkgRedeclByName) {
          const origPkgSym =
            flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", classTargetId)?.(pkgName) ??
            flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", classTargetId)?.(pkgName);
          const isPkgSym =
            Boolean(
              origPkgSym &&
              (origPkgSym.kind === "Package" ||
                origPkgSym.kind === "Class" ||
                getSymMeta(origPkgSym).classKind === "package"),
            ) || isReplaceablePackageIdentifier(pkgName, flattener, dae, redeclPkgPrefix, parentMods, classTargetId);
          if (!isPkgSym) continue;
          let targetPkgId = resolveRedeclarationType(
            flattener,
            pkgArg.evaluationScopeId ?? flattener.currentClassId,
            pkgArg.redeclaredTypeSpecifier!,
          );
          if (targetPkgId) {
            const visitedAliases = new Set<SymbolId>();
            while (targetPkgId && !visitedAliases.has(targetPkgId)) {
              visitedAliases.add(targetPkgId);
              if (!getShortClassSpecifierNode(getCstNode(flattener.db, targetPkgId))) break;
              const basePkg: SymbolEntry | null = flattener.db.query<SymbolEntry | null>(
                "resolvedBaseClass",
                targetPkgId,
              );
              if (basePkg) targetPkgId = basePkg.id;
              else break;
            }
            const specPkgPrefix = unsubscriptedComp
              ? `${targetClassQual}$${unsubscriptedComp}.${pkgName}`
              : `${targetClassQual}.${pkgName}`;
            if (targetPkgId != null) {
              elaboratePkgConsts(targetPkgId, specPkgPrefix);
            }
          }
        }
      }
    }
    if (arrayDims && arrayDims.length > 0) {
      const rawDimsComp = flattener.db.query<ArrayDimRawEntry[] | null>("arrayDimensions", elemId);
      if (rawDimsComp) {
        for (const rd of rawDimsComp) {
          let rdText = rd?.text?.trim() ?? "";
          if (!rdText && rd?.cstBytes) {
            const node = getCstNodeRange(flattener.db, rd.cstBytes[0], rd.cstBytes[1]);
            if (node) rdText = node.text?.trim() ?? "";
          }
          const idMatches = extractAsciiIdentifiers(rdText);
          if (idMatches.length > 0) {
            for (const idm of idMatches) {
              if (
                idm === "if" ||
                idm === "then" ||
                idm === "else" ||
                idm === "elseif" ||
                idm === "true" ||
                idm === "false" ||
                idm === "size" ||
                idm === "ndims" ||
                idm === "Integer" ||
                idm === "Real" ||
                idm === "Boolean"
              )
                continue;
              const candidates = [
                prefix ? `${prefix}.${idm}` : idm,
                prefix.includes(".") ? `${prefix.split(".").slice(0, -1).join(".")}.${idm}` : idm,
                idm,
              ];
              for (const c of candidates) {
                (state.pendingFinalParamNames ??= new Set<string>()).add(c);
                const vi = dae.lookupVariable(c);
                if (
                  !dae.extensionMetadata?.["isOldFrontend"] &&
                  vi >= 0 &&
                  dae.getVarVariability(vi) === Variability.Parameter &&
                  dae.getVarType(vi) === VarType.Integer
                ) {
                  dae.setVarFinal(vi, true);
                  break;
                }
              }
            }
          }
        }
      }
      setNamedArrayShape(dae, compInst.name, arrayDims);
      if (prefix) {
        setNamedArrayShape(dae, fullCompName, arrayDims);
      }
      if (arrayDims.some((d) => d === 0)) {
        return "continue";
      }
      const bText = (
        matchingParentArg?.value?.text ??
        matchingClassArg?.value?.text ??
        compInst.modification?.bindingExpression?.text
      )?.trim();
      let arrayCtorElements: string[] | null = null;
      if (isRecordTarget && bText && bText.startsWith("{") && bText.endsWith("}")) {
        arrayCtorElements = parseArrayLiteralElements(bText);
      }
      if (bText) {
        const cleanB = stripLeadingEquals(bText);
        if (isArrayLiteral(cleanB) && !containsWholeWordOutsideStrings(cleanB, "for")) {
          const ctorElems = parseArrayLiteralElements(cleanB);
          if (ctorElems.length !== arrayDims[0]) {
            let clauseNode: SyntaxNode | null = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const rangeNode = clauseNode ?? elemCst;
            const rangeObj = rangeNode
              ? {
                  startOffset: rangeNode.startIndex ?? rangeNode.startOffset,
                  endOffset: rangeNode.endIndex ?? rangeNode.endOffset,
                  startPosition: rangeNode.startPosition,
                  endPosition: rangeNode.endPosition,
                }
              : undefined;
            let formattedBText = cleanB;
            if (compInst.typeSpecifier === "Real") {
              formattedBText = `{${ctorElems.map((e) => (isAsciiDigitsOnly(e.trim()) ? `${e.trim()}.0` : e.trim())).join(", ")}}`;
            }
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.code,
              message: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                compInst.name,
                formattedBText,
                arrayDims.join(", "),
                String(ctorElems.length),
              ),
              range: rangeObj,
            });
            return "return";
          } else if (
            compInst.typeSpecifier === "Real" &&
            ctorElems.length > 0 &&
            ctorElems.every((e) => e.startsWith('"') && e.endsWith('"'))
          ) {
            let clauseNode: SyntaxNode | null = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const rangeNode = clauseNode ?? elemCst;
            const rangeObj = rangeNode
              ? {
                  startOffset: rangeNode.startIndex ?? rangeNode.startOffset,
                  endOffset: rangeNode.endIndex ?? rangeNode.endOffset,
                  startPosition: rangeNode.startPosition,
                  endPosition: rangeNode.endPosition,
                }
              : undefined;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
              message: `Type mismatch in binding ${compInst.name} = ${cleanB}, expected subtype of Real[${arrayDims.join(", ")}], got type String[${ctorElems.length}].`,
              range: rangeObj,
            });
            return "return";
          }
        } else if (
          isSignedAsciiNumberText(cleanB) ||
          cleanB === "true" ||
          cleanB === "false" ||
          (cleanB.startsWith('"') && cleanB.endsWith('"'))
        ) {
          const hasEach = Boolean(
            compInst.modification?.isEach || matchingParentArg?.isEach || matchingClassArg?.isEach,
          );
          if (!hasEach) {
            let clauseNode: SyntaxNode | null = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const rangeNode = clauseNode ?? elemCst;
            const rangeObj = rangeNode
              ? {
                  startOffset: rangeNode.startIndex ?? rangeNode.startOffset,
                  endOffset: rangeNode.endIndex ?? rangeNode.endOffset,
                  startPosition: rangeNode.startPosition,
                  endPosition: rangeNode.endPosition,
                }
              : undefined;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.NON_ARRAY_MODIFICATION.code,
              message: ModelicaErrorCode.NON_ARRAY_MODIFICATION.message(cleanB, compInst.name),
              range: rangeObj,
            });
            return "return";
          }
        }
      }
      if (flattener.options.arrayMode === "preserve") {
        setNamedArrayShape(dae, name, arrayDims);
        if (classTargetId && flattener.isExpandableConnectorClass(classTargetId)) {
          flattener.expandableBuses.set(name, classTargetId);
        }
        if (classTargetId && flattener.isFmuClass?.(classTargetId)) {
          flattener.fmuComponents?.set(name, classTargetId);
        }
        if (subElements && subElements.length > 0) {
          const prevImports = flattener.currentImports;
          if (classTargetId) {
            const compClassImports = flattener.collectClassImports(classTargetId);
            flattener.currentImports = new Map([...flattener.currentImports, ...compClassImports]);
          }
          const isOldPreserve = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
          const preservePrefix = isOldPreserve ? `${name}[${arrayDims.join(", ")}]` : name;
          const preserveSubMod: ParentModData = {
            ...effectiveSubMod,
            outerArrayDims: isOldPreserve ? [] : [...(parentMods?.outerArrayDims ?? []), ...arrayDims],
            preserveOrigOuterDims: [...(parentMods?.preserveOrigOuterDims ?? []), ...arrayDims],
          };
          recurse(flattener, subElements, preservePrefix, dae, preserveSubMod);
          flattener.currentImports = prevImports;
          if (
            dae.diagnostics.some(
              (d) =>
                d.code === 2012 ||
                d.code === 2013 ||
                d.code === ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.code ||
                d.message.includes("Error occurred while flattening model"),
            )
          )
            return "break";
        }
        return "continue";
      }
      const userDimLabels: (string[] | null)[] = [];
      if (rawDimsComp) {
        for (const d of rawDimsComp) {
          const dText = d?.text?.trim() ?? "";
          if (dText === "Boolean") {
            userDimLabels.push(["false", "true"]);
          } else if (dText) {
            const scopeId =
              flattener.db.symbol(elemId)?.parentId ??
              flattener.currentClassId ??
              flattener.currentRootClassId ??
              undefined;
            const enumInfo = resolveEnumType(dText, scopeId, flattener.db);
            if (enumInfo) {
              userDimLabels.push(enumInfo.literals.map((l) => `${enumInfo.qual}.${l}`));
            } else {
              userDimLabels.push(null);
            }
          } else {
            userDimLabels.push(null);
          }
        }
      }
      // Expand multi-dimensional composite arrays into cartesian index tuples (`[1,1]`, `[1,2]`, ...),
      // formatting Boolean (`[false]`, `[true]`) and Enumeration (`[Enum.Lit]`) dimension labels when present.
      const indices = generateArrayTuples(arrayDims).map(
        (tuple) =>
          `[${tuple.map((val, dIdx) => (userDimLabels[dIdx] && userDimLabels[dIdx]![val - 1] ? userDimLabels[dIdx]![val - 1] : val)).join(",")}]`,
      );
      for (let idxNum = 0; idxNum < indices.length; idxNum++) {
        const indexStr = indices[idxNum]!;
        const arrVarName = `${name}${indexStr}`;
        if (classTargetId && flattener.isExpandableConnectorClass(classTargetId)) {
          flattener.expandableBuses.set(arrVarName, classTargetId);
        }
        if (classTargetId && flattener.isFmuClass?.(classTargetId)) {
          flattener.fmuComponents?.set(arrVarName, classTargetId);
        }
        let elemSubMod: ParentModData = effectiveSubMod;
        // When `each` is NOT specified on a modifier targeting an array of composite components,
        // slice array literals (`{...}`), comprehensions (`array(... for i in ...)`), or array variable
        // references so each element instance `arr[idxNum + 1]` receives its corresponding slice.
        if (effectiveSubMod.args && effectiveSubMod.args.length > 0) {
          const splitArgs = effectiveSubMod.args.map((arg): ModArgData => {
            const argText = arg?.value?.text?.trim();
            const sliceCompModifier = (
              comp: { body: string; iter: string; range: string },
              origText: string,
            ): ModArgData | null => {
              if (splitTopLevel(comp.range, ",").length !== 1) return null;
              const rangeVals = evaluateComprehensionRangeValues(
                comp.range,
                flattener,
                dae,
                prefix,
                flattener.currentClassId ?? classTargetId ?? undefined,
              );
              const iterVal = rangeVals && idxNum < rangeVals.length ? rangeVals[idxNum]! : String(idxNum + 1);
              const itemText = replaceWordOutsideStrings(comp.body, comp.iter, iterVal, true);
              return {
                ...arg,
                value: {
                  ...arg.value,
                  text: itemText,
                  origArrayCompText: origText,
                  kind: "expression",
                  cstBytes: undefined,
                },
              };
            };
            if (argText && !arg.each && !arg.isEach && argText.startsWith("{") && argText.endsWith("}")) {
              const compMatch = parseBraceComprehension(argText);
              if (compMatch) {
                if (compMatch.body === compMatch.iter && userDimLabels[0]?.[idxNum]) {
                  const itemText = userDimLabels[0][idxNum]!;
                  return {
                    ...arg,
                    value: {
                      ...arg.value,
                      text: itemText,
                      kind: "expression",
                      cstBytes: undefined,
                    },
                  };
                }
                const sliced = sliceCompModifier(compMatch, argText);
                if (sliced) return sliced;
              }
              const items = parseArrayLiteralElements(argText);
              if (items.length === indices.length) {
                const itemText = items[idxNum]!.trim();
                return {
                  ...arg,
                  value: {
                    ...arg.value,
                    text: itemText,
                    kind: isSignedAsciiIntText(itemText) ? "literal" : "expression",
                    value: isSignedAsciiIntText(itemText) ? Number(itemText) : arg.value?.value,
                    cstBytes: undefined,
                  },
                };
              }
            } else if (
              argText &&
              !arg.each &&
              !arg.isEach &&
              argText.startsWith("array") &&
              argText.slice(5).trimStart().startsWith("(")
            ) {
              const arrCompMatch = parseArrayComprehension(argText);
              if (arrCompMatch) {
                const sliced = sliceCompModifier(arrCompMatch, argText);
                if (sliced) return sliced;
              }
            } else if (
              argText &&
              !arg.each &&
              isDottedIdentifierChain(argText) &&
              (dae.getVarIdxByName(`${argText}[1]`) >= 0 ||
                dae.hasArrayElements(argText) ||
                (!hasFieldVariablesInDae(dae, argText) && getNamedArrayShape(dae, argText) !== undefined))
            ) {
              const itemText = `${argText}${indexStr}`;
              return {
                ...arg,
                value: {
                  ...arg.value,
                  text: itemText,
                  kind: "expression",
                  cstBytes: undefined,
                },
              };
            }
            return arg;
          });
          elemSubMod = {
            ...effectiveSubMod,
            args: splitArgs,
          };
        }
        let isContinuousRecordElemFnEq = false;
        const bExprText = elemSubMod.bindingExpression?.text?.trim();
        if (bExprText && !bExprText.startsWith("{") && isDottedIdentifierChain(bExprText)) {
          elemSubMod = {
            ...elemSubMod,
            bindingExpression: {
              ...elemSubMod.bindingExpression,
              text: `${bExprText}${indexStr}`,
              cstBytes: undefined,
            },
          };
        } else if (arrayCtorElements && idxNum < arrayCtorElements.length) {
          const elemText = arrayCtorElements[idxNum]!.trim();
          const ctorCallMatch = parseNamedCallArgsFromText(elemText);
          if (!ctorCallMatch && isDottedIdentifierChain(elemText)) {
            elemSubMod = {
              ...elemSubMod,
              bindingExpression: { kind: "expression", text: elemText },
            };
          } else if (ctorCallMatch) {
            const ctorName = ctorCallMatch.callee;
            const targetBaseName = classTarget?.name ?? compInst.typeSpecifier?.split(".").pop();
            if (ctorName === targetBaseName || ctorName.endsWith(`.${targetBaseName}`)) {
              const rawArgs = splitTopLevelArgs(ctorCallMatch.argsText);
              const subSyms = subElements
                .map((id) => flattener.db.symbol(id))
                .filter((s): s is SymbolEntry =>
                  Boolean(
                    s &&
                    s.kind === "Component" &&
                    !flattener.isCstNodeProtected(flattener.db.cstNode(s.id)) &&
                    getSymMeta(s).variability !== "constant",
                  ),
                );
              const elemRecordArgs: ModArgData[] = [];
              for (let aIdx = 0; aIdx < rawArgs.length; aIdx++) {
                const argStr = rawArgs[aIdx]!;
                const eqIdx = argStr.indexOf("=");
                if (eqIdx > 0 && !argStr.slice(0, eqIdx).includes("(") && !argStr.slice(0, eqIdx).includes("[")) {
                  const fName = argStr.slice(0, eqIdx).trim();
                  const fVal = argStr.slice(eqIdx + 1).trim();
                  elemRecordArgs.push({ name: fName, value: { kind: "expression", text: fVal } });
                } else if (subSyms[aIdx]) {
                  const fName = subSyms[aIdx]!.name;
                  elemRecordArgs.push({ name: fName, value: { kind: "expression", text: argStr } });
                }
              }
              elemSubMod = {
                ...effectiveSubMod,
                bindingExpression: null,
                args: [...(effectiveSubMod.args ?? []), ...elemRecordArgs],
              };
            } else {
              const pkgScopeForFn = redeclPkgId ?? parentMods?.packageScopeId;
              const ctorShortName = ctorName.split(".").pop()!;
              const matchingFnSym =
                (pkgScopeForFn
                  ? (flattener.db.query<ResolveSimpleNameFn | undefined>(
                      "resolveSimpleName",
                      pkgScopeForFn,
                    )?.(ctorShortName) ??
                    flattener.db.query<ResolveNameFn | undefined>("resolveName", pkgScopeForFn)?.(ctorShortName))
                  : null) ??
                flattener.db.byName(ctorName).find((e) => flattener.isFunctionSym(e)) ??
                flattener.db.byName(ctorShortName).find((e) => flattener.isFunctionSym(e));
              let resolvedArrayElemConst = false;
              if (matchingFnSym && flattener.isFunctionSym(matchingFnSym)) {
                const rawArgs = splitTopLevelArgs(ctorCallMatch.argsText);
                const evalArgs = rawArgs.map(parseRawLiteralArg);
                if (evalArgs.every((a): a is NonNullable<typeof a> => a !== null)) {
                  const qualFnName = getSymbolQualifiedName(flattener.db, matchingFnSym.id);
                  let fn = dae.getFunction(qualFnName) ?? dae.getFunction(ctorName);
                  if (!fn) {
                    fn = flattener.flattenFunction(matchingFnSym.id, qualFnName, undefined, dae);
                    dae.addFunction(qualFnName, fn);
                    dae.addFunction(ctorName, fn);
                  }
                  const fnInternId = dae.interner.intern(qualFnName);
                  let res: ArenaEvalResult = null;
                  try {
                    res = evaluateArenaFunctionCall(dae, fnInternId, evalArgs, flattener.db, matchingFnSym.id);
                    if (res === null) {
                      const shortInternId = dae.interner.intern(ctorName);
                      res = evaluateArenaFunctionCall(dae, shortInternId, evalArgs, flattener.db, matchingFnSym.id);
                    }
                  } catch {
                    /* fallback on evaluation error */
                  }
                  if (res !== null) {
                    const subSyms = subElements
                      .map((id) => flattener.db.symbol(id))
                      .filter((s): s is SymbolEntry =>
                        Boolean(
                          s &&
                          s.kind === "Component" &&
                          !flattener.isCstNodeProtected(flattener.db.cstNode(s.id)) &&
                          getSymMeta(s).variability !== "constant",
                        ),
                      );
                    if (Array.isArray(res) && res.length === subSyms.length) {
                      const elemRecordArgs: ModArgData[] = [];
                      for (let aIdx = 0; aIdx < res.length; aIdx++) {
                        const fName = subSyms[aIdx]!.name;
                        const val = res[aIdx];
                        const symType = getSymMeta(subSyms[aIdx]).type;
                        const fVal = formatArenaValForMod(val, symType);
                        elemRecordArgs.push({ name: fName, value: { kind: "expression", text: fVal } });
                      }
                      elemSubMod = {
                        ...effectiveSubMod,
                        bindingExpression: null,
                        args: [...(effectiveSubMod?.args ?? []), ...elemRecordArgs],
                      };
                      resolvedArrayElemConst = true;
                    }
                  }
                }
              }
              if (
                !resolvedArrayElemConst &&
                compInst.variability !== "parameter" &&
                compInst.variability !== "constant" &&
                parentMods?.parentVariability !== Variability.Parameter &&
                parentMods?.parentVariability !== Variability.Constant &&
                dae.classKind !== "function"
              ) {
                isContinuousRecordElemFnEq = true;
                elemSubMod = {
                  ...elemSubMod,
                  suppressDefaultBindings: true,
                  bindingExpression: null,
                };
              }
            }
          }
        }
        if (subElements && subElements.length > 0) {
          if (tryLowerForeignComponent(flattener, classTarget, arrVarName, dae, elemSubMod, bindingScope)) {
            continue;
          }
          const prevImports = flattener.currentImports;
          if (classTargetId) {
            const compClassImports = flattener.collectClassImports(classTargetId);
            flattener.currentImports = new Map([...flattener.currentImports, ...compClassImports]);
          }
          if (classTargetId && flattener.isFmuClass?.(classTargetId)) {
            flattener.fmuComponents?.set(arrVarName, classTargetId);
          }
          recurse(flattener, subElements, arrVarName, dae, elemSubMod);
          flattener.currentImports = prevImports;
          if (dae.diagnostics.some((d) => d.code === 2012 || d.code === 2013)) return "break";
          if (isContinuousRecordElemFnEq) {
            const bValSource =
              matchingParentArg?.value ?? matchingClassArg?.value ?? compInst.modification?.bindingExpression;
            const modScopeId =
              bValSource?.evaluationScopeId ??
              matchingParentArg?.evaluationScopeId ??
              matchingParentArg?.ownerClassId ??
              matchingClassArg?.evaluationScopeId ??
              flattener.db.symbol(elemId)?.parentId ??
              flattener.currentClassId;
            const modScopeSym = modScopeId ? flattener.db.symbol(modScopeId) : undefined;
            let arrayExprCst: SyntaxNode | null =
              bValSource?.cstBytes && modScopeSym
                ? getCstNodeRange(flattener.db, bValSource.cstBytes[0], bValSource.cstBytes[1], modScopeSym)
                : null;
            if (!arrayExprCst) {
              const modChild = elemCst?.children?.find((c) => c.type === "modification");
              const findBindingExprNode = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
                if (!n) return null;
                if (n.type === "expression") return n;
                for (const c of n.children || []) {
                  const res = findBindingExprNode(c);
                  if (res) return res;
                }
                return null;
              };
              arrayExprCst = findBindingExprNode(modChild ?? elemCst);
            }
            const itemNodes = arrayExprCst ? getArrayLiteralItems(arrayExprCst) : [];
            const itemCst = itemNodes[idxNum];
            if (itemCst) {
              const prevClassId = flattener.currentClassId;
              const prevParentMods = flattener.currentParentMods;
              if (modScopeId) flattener.currentClassId = modScopeId;
              flattener.currentParentMods = parentMods as ParentModsLike | null | undefined;
              try {
                const rhsExprId = flattener.lowerExpr(itemCst, dae, bindingScope);
                if (rhsExprId >= 0) {
                  dae.addEquation(EqKind.Simple, dae.addNameExpr(arrVarName), rhsExprId);
                }
              } finally {
                flattener.currentClassId = prevClassId;
                flattener.currentParentMods = prevParentMods;
              }
            }
          }
        }
      }
      if (dae.diagnostics.some((d) => d.code === 2012 || d.code === 2013)) return "break";
    } else {
      if (classTargetId && flattener.isExpandableConnectorClass(classTargetId)) {
        flattener.expandableBuses.set(name, classTargetId);
      }
      if (classTargetId && flattener.isFmuClass?.(classTargetId)) {
        flattener.fmuComponents?.set(name, classTargetId);
      }
      if (tryLowerForeignComponent(flattener, classTarget, name, dae, effectiveSubMod, bindingScope)) {
        return "continue";
      }
      if (subElements && subElements.length > 0) {
        const prevImports = flattener.currentImports;
        if (classTargetId) {
          const compClassImports = flattener.collectClassImports(classTargetId);
          flattener.currentImports = new Map([...flattener.currentImports, ...compClassImports]);
        }
        recurse(flattener, subElements, name, dae, effectiveSubMod);
        flattener.currentImports = prevImports;
        if (dae.diagnostics.some((d) => d.code === 2012 || d.code === 2013)) return "break";
        if (isContinuousRecordCtorEq) {
          for (const rArg of recordCtorArgs) {
            if (rArg.name) {
              const fVarName = `${name}.${rArg.name}`;
              const fVarIdx = dae.getVarIdxByName(fVarName);
              if (fVarIdx >= 0) {
                const rhsExprId = dae.getVarExpression(fVarIdx);
                if (rhsExprId !== undefined && rhsExprId >= 0) {
                  dae.setVarExpression(fVarIdx, -1);
                  dae.removeVarAttr(fVarIdx, "start");
                  dae.addEquation(EqKind.Simple, dae.addNameExpr(fVarName), rhsExprId);
                }
              }
            }
          }
        }
        if (isContinuousRecordFnEq || isParameterRecordInitEq) {
          const modScopeId =
            matchingParentArg?.evaluationScopeId ??
            matchingClassArg?.evaluationScopeId ??
            flattener.db.symbol(elemId)?.parentId ??
            flattener.currentClassId;
          const modScopeSym = modScopeId != null ? flattener.db.symbol(modScopeId) : null;
          let exprCst: SyntaxNode | null =
            recordBindingSource?.cstBytes && modScopeSym
              ? getCstNodeRange(
                  flattener.db,
                  recordBindingSource.cstBytes[0],
                  recordBindingSource.cstBytes[1],
                  modScopeSym,
                )
              : null;
          if (!exprCst) {
            const modChild = elemCst?.children?.find((c) => c.type === "modification");
            const findBindingExprNode = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
              if (!n) return null;
              if (n.type === "expression") return n;
              for (const c of n.children || []) {
                const res = findBindingExprNode(c);
                if (res) return res;
              }
              return null;
            };
            exprCst = findBindingExprNode(modChild ?? elemCst);
          }
          const prevClassId = flattener.currentClassId;
          const prevOwnerImports = flattener.currentImports;
          const elemOwnerId = modScopeId ?? flattener.db.symbol(elemId)?.parentId ?? flattener.currentClassId;
          if (elemOwnerId) {
            flattener.currentClassId = elemOwnerId;
            const ownerImports = flattener.collectClassImports?.(elemOwnerId);
            if (ownerImports) {
              flattener.currentImports = new Map([...flattener.currentImports, ...ownerImports]);
            }
          }
          try {
            const rhsExprId = exprCst
              ? flattener.lowerExpr(exprCst, dae, prefix)
              : recordBindingSource?.text
                ? (lowerStandaloneExpression(
                    flattener,
                    recordBindingSource.text,
                    dae,
                    prefix,
                    compInst.name,
                    VarType.Real,
                  ) ?? -1)
                : -1;
            if (rhsExprId >= 0) {
              let decomposedComplex = false;
              if (isParameterRecordInitEq && isOpRec && classTarget?.name === "Complex") {
                const decomposeComplexExpr = (id: number, depth = 0): [number, number] | null => {
                  if (id < 0 || depth > 24) return null;
                  const k = dae.getExprKind(id);
                  if (k === ExprKind.RealLiteral || k === ExprKind.IntLiteral) {
                    return [id, dae.addRealLiteral(0.0)];
                  }
                  if (k === ExprKind.Name) {
                    const nm = dae.interner.resolve(dae.getExprData1(id)) || "";
                    if (nm === "Modelica.ComplexMath.j" || nm === "ComplexMath.j" || nm.endsWith(".ComplexMath.j")) {
                      return [dae.addRealLiteral(0.0), dae.addRealLiteral(1.0)];
                    }
                    return [dae.addNameExpr(`${nm}.re`), dae.addNameExpr(`${nm}.im`)];
                  }
                  if (k === ExprKind.Negate) {
                    const sub = decomposeComplexExpr(dae.getExprLeft(id), depth + 1);
                    if (!sub) return null;
                    return [
                      dae.addExpression(ExprKind.Negate, 0, sub[0]),
                      dae.addExpression(ExprKind.Negate, 0, sub[1]),
                    ];
                  }
                  if (k === ExprKind.Unary) {
                    const op = dae.getExprData1(id);
                    const sub = decomposeComplexExpr(dae.getExprLeft(id), depth + 1);
                    if (!sub) return null;
                    if (op === UnaryOp.Negate) {
                      return [
                        dae.addExpression(ExprKind.Negate, 0, sub[0]),
                        dae.addExpression(ExprKind.Negate, 0, sub[1]),
                      ];
                    }
                    return sub;
                  }
                  if (k === ExprKind.Binary) {
                    const op = dae.getExprData1(id);
                    const l = decomposeComplexExpr(dae.getExprLeft(id), depth + 1);
                    const r = decomposeComplexExpr(dae.getExprRight(id), depth + 1);
                    if (!l || !r) return null;
                    if (op === BinOp.Add) {
                      return [dae.addBinaryExpr(BinOp.Add, l[0], r[0]), dae.addBinaryExpr(BinOp.Add, l[1], r[1])];
                    }
                    if (op === BinOp.Sub) {
                      return [dae.addBinaryExpr(BinOp.Sub, l[0], r[0]), dae.addBinaryExpr(BinOp.Sub, l[1], r[1])];
                    }
                    if (op === BinOp.Mul) {
                      return [
                        dae.addBinaryExpr(
                          BinOp.Sub,
                          dae.addBinaryExpr(BinOp.Mul, l[0], r[0]),
                          dae.addBinaryExpr(BinOp.Mul, l[1], r[1]),
                        ),
                        dae.addBinaryExpr(
                          BinOp.Add,
                          dae.addBinaryExpr(BinOp.Mul, l[0], r[1]),
                          dae.addBinaryExpr(BinOp.Mul, l[1], r[0]),
                        ),
                      ];
                    }
                    if (op === BinOp.Div) {
                      const denom = dae.addBinaryExpr(
                        BinOp.Add,
                        dae.addBinaryExpr(BinOp.Mul, r[0], r[0]),
                        dae.addBinaryExpr(BinOp.Mul, r[1], r[1]),
                      );
                      return [
                        dae.addBinaryExpr(
                          BinOp.Div,
                          dae.addBinaryExpr(
                            BinOp.Add,
                            dae.addBinaryExpr(BinOp.Mul, l[0], r[0]),
                            dae.addBinaryExpr(BinOp.Mul, l[1], r[1]),
                          ),
                          denom,
                        ),
                        dae.addBinaryExpr(
                          BinOp.Div,
                          dae.addBinaryExpr(
                            BinOp.Sub,
                            dae.addBinaryExpr(BinOp.Mul, l[1], r[0]),
                            dae.addBinaryExpr(BinOp.Mul, l[0], r[1]),
                          ),
                          denom,
                        ),
                      ];
                    }
                  }
                  if (k === ExprKind.IfElse) {
                    const cond = dae.getExprData1(id);
                    const tBranch = decomposeComplexExpr(dae.getExprLeft(id), depth + 1);
                    const fBranch = decomposeComplexExpr(dae.getExprRight(id), depth + 1);
                    if (!tBranch || !fBranch) return null;
                    return [
                      dae.addIfElseExpr(cond, tBranch[0], fBranch[0]),
                      dae.addIfElseExpr(cond, tBranch[1], fBranch[1]),
                    ];
                  }
                  if (k === ExprKind.Call) {
                    const fnName = dae.interner.resolve(dae.getExprData1(id)) || "";
                    const argCount = dae.getExprRight(id);
                    const getArg = (idx: number) => (idx === 0 ? dae.getExprLeft(id) : dae.getExprLeft(id + idx));
                    // OMC does not scalarize function-call bindings of Complex parameters into field
                    // bindings (`Complex S = Complex(p0, q0)`, fromPolar, conj, '/', '*', ...): they stay
                    // as a whole-record equation with `fixed = false` fields. Only field modifications
                    // (`Complex S(re = p0, im = -q0)`) become field bindings, and those don't come here.
                    if (flattener.options.omcCompatibility) {
                      return null;
                    }
                    if (fnName === "Complex" || fnName === "Complex.'constructor'.fromReal") {
                      if (argCount >= 2) return [getArg(0), getArg(1)];
                      if (argCount === 1) return [getArg(0), dae.addRealLiteral(0.0)];
                    }
                    if (fnName === "Complex.'0'") {
                      return [dae.addRealLiteral(0.0), dae.addRealLiteral(0.0)];
                    }
                    if ((fnName === "Complex.'-'.negate" || fnName === "Complex.'-'") && argCount === 1) {
                      const sub = decomposeComplexExpr(getArg(0), depth + 1);
                      if (!sub) return null;
                      return [
                        dae.addExpression(ExprKind.Negate, 0, sub[0]),
                        dae.addExpression(ExprKind.Negate, 0, sub[1]),
                      ];
                    }
                    if ((fnName === "Complex.'+'.add" || fnName === "Complex.'+'") && argCount === 2) {
                      const l = decomposeComplexExpr(getArg(0), depth + 1);
                      const r = decomposeComplexExpr(getArg(1), depth + 1);
                      if (!l || !r) return null;
                      return [dae.addBinaryExpr(BinOp.Add, l[0], r[0]), dae.addBinaryExpr(BinOp.Add, l[1], r[1])];
                    }
                    if ((fnName === "Complex.'-'.subtract" || fnName === "Complex.'-'") && argCount === 2) {
                      const l = decomposeComplexExpr(getArg(0), depth + 1);
                      const r = decomposeComplexExpr(getArg(1), depth + 1);
                      if (!l || !r) return null;
                      return [dae.addBinaryExpr(BinOp.Sub, l[0], r[0]), dae.addBinaryExpr(BinOp.Sub, l[1], r[1])];
                    }
                    if ((fnName === "Complex.'*'.multiply" || fnName === "Complex.'*'") && argCount === 2) {
                      const l = decomposeComplexExpr(getArg(0), depth + 1);
                      const r = decomposeComplexExpr(getArg(1), depth + 1);
                      if (!l || !r) return null;
                      return [
                        dae.addBinaryExpr(
                          BinOp.Sub,
                          dae.addBinaryExpr(BinOp.Mul, l[0], r[0]),
                          dae.addBinaryExpr(BinOp.Mul, l[1], r[1]),
                        ),
                        dae.addBinaryExpr(
                          BinOp.Add,
                          dae.addBinaryExpr(BinOp.Mul, l[0], r[1]),
                          dae.addBinaryExpr(BinOp.Mul, l[1], r[0]),
                        ),
                      ];
                    }
                    if ((fnName === "Complex.'/'.divide" || fnName === "Complex.'/'") && argCount === 2) {
                      const l = decomposeComplexExpr(getArg(0), depth + 1);
                      const r = decomposeComplexExpr(getArg(1), depth + 1);
                      if (!l || !r) return null;
                      const denom = dae.addBinaryExpr(
                        BinOp.Add,
                        dae.addBinaryExpr(BinOp.Mul, r[0], r[0]),
                        dae.addBinaryExpr(BinOp.Mul, r[1], r[1]),
                      );
                      return [
                        dae.addBinaryExpr(
                          BinOp.Div,
                          dae.addBinaryExpr(
                            BinOp.Add,
                            dae.addBinaryExpr(BinOp.Mul, l[0], r[0]),
                            dae.addBinaryExpr(BinOp.Mul, l[1], r[1]),
                          ),
                          denom,
                        ),
                        dae.addBinaryExpr(
                          BinOp.Div,
                          dae.addBinaryExpr(
                            BinOp.Sub,
                            dae.addBinaryExpr(BinOp.Mul, l[1], r[0]),
                            dae.addBinaryExpr(BinOp.Mul, l[0], r[1]),
                          ),
                          denom,
                        ),
                      ];
                    }
                    if (
                      (fnName === "conj" ||
                        fnName === "Modelica.ComplexMath.conj" ||
                        fnName === "ComplexMath.conj" ||
                        fnName.endsWith(".conj")) &&
                      argCount === 1
                    ) {
                      const sub = decomposeComplexExpr(getArg(0), depth + 1);
                      if (!sub) return null;
                      return [sub[0], dae.addExpression(ExprKind.Negate, 0, sub[1])];
                    }
                    if (
                      (fnName === "fromPolar" ||
                        fnName === "Modelica.ComplexMath.fromPolar" ||
                        fnName === "ComplexMath.fromPolar" ||
                        fnName.endsWith(".fromPolar")) &&
                      argCount === 2
                    ) {
                      const lenExpr = getArg(0);
                      const phiExpr = getArg(1);
                      return [
                        dae.addBinaryExpr(BinOp.Mul, lenExpr, dae.addCallExpr("cos", [phiExpr])),
                        dae.addBinaryExpr(BinOp.Mul, lenExpr, dae.addCallExpr("sin", [phiExpr])),
                      ];
                    }
                    if (
                      (fnName === "exp" ||
                        fnName === "Modelica.ComplexMath.exp" ||
                        fnName === "ComplexMath.exp" ||
                        fnName.endsWith(".exp")) &&
                      argCount === 1
                    ) {
                      const sub = decomposeComplexExpr(getArg(0), depth + 1);
                      if (!sub) return null;
                      return [
                        dae.addBinaryExpr(
                          BinOp.Mul,
                          dae.addCallExpr("exp", [sub[0]]),
                          dae.addCallExpr("cos", [sub[1]]),
                        ),
                        dae.addBinaryExpr(
                          BinOp.Mul,
                          dae.addCallExpr("exp", [sub[0]]),
                          dae.addCallExpr("sin", [sub[1]]),
                        ),
                      ];
                    }
                  }
                  return null;
                };
                const pair = decomposeComplexExpr(rhsExprId);
                const reIdx = dae.getVarIdxByName(`${name}.re`);
                const imIdx = dae.getVarIdxByName(`${name}.im`);
                if (pair && reIdx >= 0 && imIdx >= 0) {
                  dae.setVarExpression(reIdx, pair[0]);
                  dae.setVarExpression(imIdx, pair[1]);
                  decomposedComplex = true;
                } else {
                  if (reIdx >= 0) dae.setVarAttr(reIdx, "fixed", dae.addBoolLiteral(false));
                  if (imIdx >= 0) dae.setVarAttr(imIdx, "fixed", dae.addBoolLiteral(false));
                }
              }
              if (!decomposedComplex) {
                dae.addEquation(
                  isParameterRecordInitEq ? EqKind.InitialSimple : EqKind.Simple,
                  dae.addNameExpr(name),
                  rhsExprId,
                );
              }
            }
          } finally {
            flattener.currentClassId = prevClassId;
            flattener.currentImports = prevOwnerImports;
          }
        }
      }
    }
    return "continue";
  }

  return "continue";
}
