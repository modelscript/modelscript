// SPDX-License-Identifier: AGPL-3.0-or-later

import { type SyntaxNode } from "../../../../src-gen/bindings.js";

import { EqKind, ExprKind } from "@modelscript/dsl";
import {
  Causality,
  DAEBuilder,
  evaluateArenaFunctionCall,
  Variability,
  VarType,
  varTypeName,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { ModelicaErrorCode } from "../../../errors.js";
import {
  castToRealExpr,
  checkIfExprTypeMismatch,
  containsWholeWordOutsideStrings,
  evalDaeExpr,
  evaluateCSTNumber,
  expandColonToArrayCtor,
  exprReferencesRuntimeParameter,
  extractAsciiIdentifiers,
  extractCallTargetsFromExpr,
  extractEnumLiteralsFromCst,
  firstBracketedIdentifier,
  generateArrayTuples,
  getExprDims,
  getSymbolQualifiedName,
  hasColonSubscript,
  isArrayLiteral,
  isAsciiDigitsOnly,
  isDottedIdentifierChain,
  isRealExpr,
  isSignedAsciiIntText,
  isSignedAsciiNumberText,
  leadingIdentifierBeforeDot,
  parseArrayLiteralElements,
  parseNamedCallArgsFromText,
  parseSizeCallIdentDim,
  resolveScopedName,
  spaceAfterCommas,
  splitBraceCommasAndTrim,
  splitTopLevel,
  splitTopLevelArgs,
  stripLeadingDots,
  stripLeadingEquals,
  stripLeadingMinusWs,
} from "../../expressions/index.js";
import { getFlatteningState, getNamedArrayShape, setNamedArrayShape } from "../../support/state.js";
import { type ComponentInstanceData, type FlattenerCstNode } from "../../types.js";
import { findBindingExprFromCst, isComponentHidden, parseStandaloneExpressionCst } from "./cst-helpers.js";
import {
  asExtDae,
  getCstNode,
  getCstNodeRange,
  getDaeExtMeta,
  getEnumLiteralName,
  getPendingArrayBindings,
  getSymMeta,
  type ArenaEvalArg,
  type ArrayDimRawEntry,
  type ComponentFlattener,
  type ComponentInstanceInfo,
  type EffectiveBindingData,
  type EnumLiteralEntry,
  type ExtendedFlatteningState,
  type ModArgData,
  type ParentModData,
  type ResolvedComponentContext,
} from "./types.js";
import { validateFunctionComponentDeclaration } from "./validation.js";

export interface ArrayEmissionInput {
  flattener: ComponentFlattener;
  elements: SymbolId[];
  elemId: SymbolId;
  arrayDimsRef: { current: number[] | null | undefined };
  compInst: ComponentInstanceInfo;
  fullCompName: string;
  elemCst: SyntaxNode | null;
  prefix: string;
  basePrefix: string;
  dae: DAEBuilder;
  state: ExtendedFlatteningState;
  parentMods: ParentModData | null | undefined;
  matchingParentArg: ModArgData | undefined;
  ctx: ResolvedComponentContext;
  varType: VarType;
  customType: string | null;
  typeMods: ModArgData[];
  enumLiterals: EnumLiteralEntry[] | null;
  variability: Variability;
  isEvaluated: boolean;
  causality: Causality;
  isParentBoundField: boolean;
  effectiveBinding: EffectiveBindingData | null | undefined;
  bText: string;
  _isEnclosingFunction: boolean;
  applyModifiers: (varIdx: number, idxTuple?: number[], currentDimLabels?: (string[] | null)[]) => void;
}

export function resolveArrayDimsAndEmit(input: ArrayEmissionInput): "handled" | "scalar" | "continue" | "return" {
  const {
    flattener,
    elements,
    elemId,
    arrayDimsRef,
    compInst,
    fullCompName,
    elemCst,
    prefix,
    dae,
    state,
    parentMods,
    matchingParentArg,
    ctx,
    varType,
    customType,
    typeMods,
    enumLiterals,
    variability,
    isEvaluated,
    causality,
    isParentBoundField,
    effectiveBinding,
    _isEnclosingFunction,
    applyModifiers,
  } = input;
  const {
    isElemProtected,
    name,
    meta,
    classTargetId,
    matchingClassArg,
    effectiveParentArg,
    effectiveClassArg,
    redeclArg,
    isRecordTarget,
  } = ctx;
  let arrayDims = compInst?.arrayDimensions;
  const rawDimsInitial = flattener.db.query<ArrayDimRawEntry[] | null>("arrayDimensions", elemId);
  if (rawDimsInitial) {
    for (const d of rawDimsInitial) {
      if (d.kind === "literal" && d.value !== undefined && d.value < 0) {
        let clauseNode: SyntaxNode | null = elemCst;
        while (clauseNode && clauseNode.type !== "component_clause") {
          clauseNode = clauseNode.parent;
        }
        const diagNode = clauseNode ?? elemCst;
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.NEGATIVE_DIMENSION.code,
          message: ModelicaErrorCode.NEGATIVE_DIMENSION.message(String(d.value), compInst.name),
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
  if (rawDimsInitial) {
    for (const rd of rawDimsInitial) {
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
  if (
    rawDimsInitial &&
    rawDimsInitial.length > 0 &&
    rawDimsInitial.some((d) => d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible")
  ) {
    arrayDims = rawDimsInitial.map((d) =>
      d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible"
        ? -1
        : typeof d.value === "number"
          ? d.value
          : -1,
    );
  }
  let typeDims: number[] | null = null;
  if (classTargetId) {
    const rawTypeDims =
      flattener.db.query<(number | ArrayDimRawEntry)[] | null>("resolvedArrayDimensions", classTargetId) ??
      flattener.db.query<ArrayDimRawEntry[] | null>("arrayDimensions", classTargetId);
    if (rawTypeDims) {
      typeDims = rawTypeDims.map((d) =>
        typeof d === "number" ? d : d?.kind === "literal" && typeof d.value === "number" ? d.value : -1,
      );
    }
    if (redeclArg && typeDims && typeDims.length > 0) {
      arrayDims = typeDims;
    } else if ((!arrayDims || arrayDims.length === 0) && typeDims && typeDims.length > 0) {
      arrayDims = typeDims;
    }
  }
  if (redeclArg?.redeclaredArrayDimensionsRaw && redeclArg.redeclaredArrayDimensionsRaw.length > 0) {
    arrayDims = redeclArg.redeclaredArrayDimensionsRaw.map((d) =>
      d.kind === "literal" && typeof d.value === "number" ? d.value : -1,
    );
  }
  if ((!arrayDims || arrayDims.length === 0) && rawDimsInitial && rawDimsInitial.length > 0) {
    arrayDims = rawDimsInitial.map((d) => (d.kind === "literal" && typeof d.value === "number" ? d.value : -1));
  }
  const preRegisteredShape =
    getNamedArrayShape(dae, fullCompName) ??
    (prefix ? getNamedArrayShape(dae, `${prefix}.${compInst.name}`) : getNamedArrayShape(dae, compInst.name));
  if (preRegisteredShape && preRegisteredShape.length > 0) {
    arrayDims = preRegisteredShape;
  }
  const isFunctionInputWithColon =
    dae.classKind === "function" &&
    causality === Causality.Input &&
    rawDimsInitial &&
    rawDimsInitial.some((d) => d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible");

  if (effectiveBinding?.text && !isFunctionInputWithColon) {
    const bText = effectiveBinding.text.trim();
    if (isArrayLiteral(bText)) {
      arrayDimsRef.current = arrayDims;
      if (arrayDims && arrayDims.length > 0) {
        let currentLit = bText;
        for (let d = 0; d < arrayDims.length; d++) {
          if (currentLit.startsWith("{") && currentLit.endsWith("}")) {
            const subElems = parseArrayLiteralElements(currentLit);
            if ((arrayDims[d] === 0 || matchingParentArg?.value || matchingClassArg?.value) && subElems.length > 0) {
              arrayDims[d] = subElems.length;
            }
            if (subElems.length > 0) currentLit = subElems[0]!.trim();
          }
        }
      }
    } else if (bText.startsWith("[") && bText.endsWith("]")) {
      const rows = splitTopLevel(bText.slice(1, -1), ";");
      const rowElements = rows.map((r) => splitTopLevel(r, ","));
      const rowsCount = rows.length;
      const colsCount = rowElements.length > 0 ? rowElements[0]!.length : 0;
      if (arrayDims && arrayDims.length === 1) {
        let clauseStart = elemCst?.startIndex ?? elemCst?.startOffset;
        let clauseEnd = elemCst?.endIndex ?? elemCst?.endOffset;
        if (elemCst) {
          let curr: SyntaxNode | null = elemCst;
          while (curr && curr.type !== "component_clause") curr = curr.parent;
          if (curr) {
            clauseStart = curr.startIndex ?? curr.startOffset;
            clauseEnd = curr.endIndex ?? curr.endOffset;
          }
        }
        const formattedExpr = "{" + rowElements.map((cols) => "{" + cols.join(", ") + "}").join(", ") + "}";
        const allInts = rowElements.every((row) => row.every((c) => isSignedAsciiIntText(c)));
        const elemType = allInts ? "Integer" : "Real";
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
          message: `Array dimension mismatch, expression ${formattedExpr} has type ${elemType}[${rowsCount}, ${colsCount}], expected array dimensions [${arrayDims.join(", ")}].`,
          range: { startOffset: clauseStart, endOffset: clauseEnd },
        });
        return "return";
      }
      if (arrayDims && arrayDims.length >= 2) {
        const rCount = rowsCount;
        const cCount = colsCount;
        if (
          rCount > 0 &&
          (arrayDims[0] === 0 || arrayDims[0] === -1 || matchingParentArg?.value || matchingClassArg?.value)
        ) {
          arrayDims[0] = rCount;
        }
        if (
          cCount > 0 &&
          (arrayDims[1] === 0 || arrayDims[1] === -1 || matchingParentArg?.value || matchingClassArg?.value)
        ) {
          arrayDims[1] = cCount;
        }
      }
    }
  }
  const rawPredefDims =
    arrayDims && arrayDims.length > 0
      ? redeclArg?.redeclaredArrayDimensionsRaw && redeclArg.redeclaredArrayDimensionsRaw.length > 0
        ? redeclArg.redeclaredArrayDimensionsRaw
        : flattener.db.query<ArrayDimRawEntry[] | null>("arrayDimensions", elemId)
      : null;
  if (arrayDims && (arrayDims.some((d) => d <= 0) || rawPredefDims?.some((d) => d?.kind === "expression"))) {
    const rawDims = rawPredefDims;
    let dimNames: string[] = [];
    if (rawDims && rawDims.length === arrayDims.length) {
      dimNames = rawDims.map((d) => d?.text?.trim() ?? "");
    }
    if (dimNames.length === 0 && elemCst) {
      const firstDimName = firstBracketedIdentifier(elemCst.text ?? "");
      if (firstDimName) {
        dimNames = [firstDimName];
      }
    }
    const resolvedDims = [...arrayDims];
    for (let i = 0; i < resolvedDims.length; i++) {
      if (resolvedDims[i]! <= 0 || rawDims?.[i]?.kind === "expression") {
        const dimName = dimNames[i];
        if (dimName) {
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
            if (typeof evalVal !== "number" || evalVal < 0) {
              const defaultDimScopeId = asExtDae(dae).enclosingScopeId ?? flattener.currentClassId ?? undefined;
              const dimFirstId = leadingIdentifierBeforeDot(dimName) ?? undefined;
              const dimPkgRedecl = dimFirstId
                ? parentMods?.args
                    ?.slice()
                    .reverse()
                    .find(
                      (a) =>
                        !a.isBreak &&
                        a.name === dimFirstId &&
                        (a.isRedeclaration || a.redeclaredTypeSpecifier) &&
                        a.redeclaredTypeSpecifier,
                    )
                : undefined;
              const effectiveDimName = dimPkgRedecl
                ? `${stripLeadingDots(String(dimPkgRedecl.redeclaredTypeSpecifier))}${dimName.slice(dimFirstId!.length)}`
                : dimName;
              const dimScopeId =
                dimPkgRedecl?.evaluationScopeId ??
                dimPkgRedecl?.ownerClassId ??
                parentMods?.packageScopeId ??
                defaultDimScopeId;
              evalVal = evaluateCSTNumber(effectiveDimName, undefined, dimScopeId, flattener.db, dae, prefix);
              if (
                (typeof evalVal !== "number" || evalVal < 0) &&
                defaultDimScopeId !== undefined &&
                defaultDimScopeId !== dimScopeId
              ) {
                evalVal = evaluateCSTNumber(dimName, undefined, defaultDimScopeId, flattener.db, dae, prefix);
              }
              if ((typeof evalVal !== "number" || evalVal < 0) && prefix) {
                const parentPrefix = prefix.includes(".") ? prefix.split(".").slice(0, -1).join(".") : "";
                evalVal = evaluateCSTNumber(effectiveDimName, undefined, dimScopeId, flattener.db, dae, parentPrefix);
              }
            }
            if (typeof evalVal !== "number" || evalVal < 0) {
              const dimCstBytes = rawDims?.[i]?.cstBytes;
              if (dimCstBytes) {
                const targetScopeId =
                  rawDims?.[i]?.evaluationScopeId ?? elemId ?? flattener.currentClassId ?? flattener.currentRootClassId;
                const scopeSym = targetScopeId ? flattener.db.symbol(targetScopeId) : undefined;
                const dimCst = getCstNodeRange(flattener.db, dimCstBytes[0], dimCstBytes[1], scopeSym ?? undefined);
                if (dimCst) {
                  let loweredId = flattener.lowerExpr(dimCst, dae, prefix);
                  if (loweredId >= 0) {
                    const ev = evalDaeExpr(loweredId, dae);
                    if (typeof ev === "number" && ev >= 0) {
                      evalVal = ev;
                    }
                  }
                  if ((typeof evalVal !== "number" || evalVal < 0) && prefix) {
                    const parentPrefix = prefix.includes(".") ? prefix.split(".").slice(0, -1).join(".") : "";
                    loweredId = flattener.lowerExpr(dimCst, dae, parentPrefix);
                    if (loweredId >= 0) {
                      const ev = evalDaeExpr(loweredId, dae);
                      if (typeof ev === "number" && ev >= 0) {
                        evalVal = ev;
                      }
                    }
                  }
                }
              }
            }
          }
          if (typeof evalVal === "number" && evalVal >= 0) {
            resolvedDims[i] = evalVal;
          } else if (flattener.options.omcCompatibility && dimName && !isFunctionInputWithColon) {
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
                const targetCompInst = flattener.db.query<ComponentInstanceData>("componentInstance", targetElemSym.id);
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
            if (dae.classKind !== "function" && !_isEnclosingFunction && resolvedDims[i]! < 0) {
              if (flattener.options.arrayMode === "preserve" && dae.extensionMetadata?.["isOldFrontend"]) {
                dae.diagnostics.push({
                  severity: "error",
                  code: 0,
                  message: `Error occurred while flattening model ${dae.name}`,
                  range: null,
                });
                return "return";
              }
              let clauseNode: SyntaxNode | null = elemCst;
              while (clauseNode && clauseNode.type !== "component_clause") {
                clauseNode = clauseNode.parent;
              }
              const diagNode = clauseNode ?? elemCst;
              const arrayName = getDaeExtMeta(dae)?.hasOldInstOption ? `${compInst.name}[${dimName}]` : compInst.name;
              dae.diagnostics.push({
                severity: "error",
                message: `Could not evaluate structural parameter (or constant): ${dimName} which gives dimensions of array: ${arrayName}. Array dimensions must be known at compile time.`,
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
        if (resolvedDims[i]! <= 0 && effectiveBinding?.cstBytes && !isFunctionInputWithColon) {
          const targetScopeId =
            effectiveBinding?.evaluationScopeId ??
            effectiveParentArg?.evaluationScopeId ??
            effectiveClassArg?.evaluationScopeId ??
            elemId ??
            flattener.currentClassId ??
            flattener.currentRootClassId;
          const scopeSym = targetScopeId ? flattener.db.symbol(targetScopeId) : undefined;
          const scopeClassId =
            scopeSym?.kind === "Class" ? targetScopeId : (scopeSym?.parentId ?? flattener.currentClassId);
          const bindCst = getCstNodeRange(
            flattener.db,
            effectiveBinding.cstBytes[0],
            effectiveBinding.cstBytes[1],
            scopeSym ?? undefined,
          );
          if (bindCst) {
            const bindingPrefix =
              parentMods?.bindingScope !== undefined && isParentBoundField
                ? parentMods.bindingScope
                : effectiveParentArg?.value &&
                    (!effectiveParentArg?.isExtendsMod || effectiveParentArg?.isFromParentExtends)
                  ? prefix.includes(".")
                    ? prefix.split(".").slice(0, -1).join(".")
                    : ""
                  : prefix;
            const prevClassId = flattener.currentClassId;
            if (scopeClassId) flattener.currentClassId = scopeClassId;
            let loweredId = -1;
            try {
              const exprCst = findBindingExprFromCst(bindCst);
              if (exprCst) {
                loweredId = flattener.lowerExpr(exprCst, dae, bindingPrefix);
              }
            } finally {
              flattener.currentClassId = prevClassId;
            }
            if (loweredId >= 0) {
              const deducedDims = getExprDims(loweredId, dae, flattener.db);
              if (deducedDims) {
                const targetDims =
                  deducedDims.length > resolvedDims.length
                    ? deducedDims.slice(deducedDims.length - resolvedDims.length)
                    : deducedDims;
                if (targetDims.length === resolvedDims.length) {
                  for (let d = 0; d < resolvedDims.length; d++) {
                    if (resolvedDims[d]! <= 0 && targetDims[d]! >= 0) {
                      resolvedDims[d] = targetDims[d]!;
                    }
                  }
                }
              }
              if (
                (variability === Variability.Parameter || variability === Variability.Constant) &&
                dae.getExprKind(loweredId) === ExprKind.Call
              ) {
                const fnNameId = dae.getExprData1(loweredId);
                const fnName = dae.interner.resolve(fnNameId);
                const argCount = dae.getExprRight(loweredId);
                const firstArg = dae.getExprLeft(loweredId);
                const evalArgs: ArenaEvalArg[] = [];
                let allArgsOk = true;
                for (let aIdx = 0; aIdx < argCount; aIdx++) {
                  const aId = aIdx === 0 ? firstArg : dae.getExprLeft(loweredId + aIdx);
                  if (exprReferencesRuntimeParameter(aId, dae)) {
                    allArgsOk = false;
                    break;
                  }
                  const val = evalDaeExpr(aId, dae);
                  if (val !== null && val !== undefined) {
                    evalArgs.push(val as ArenaEvalArg);
                  } else {
                    allArgsOk = false;
                    break;
                  }
                }
                if (allArgsOk && fnName) {
                  try {
                    const evalRes = evaluateArenaFunctionCall(
                      dae,
                      fnNameId,
                      evalArgs,
                      flattener.db,
                      flattener.currentRootClassId,
                    );
                    if (evalRes) {
                      const evaluatedKey = prefix ? `${prefix}.${name}` : name;
                      flattener.evaluatedConstantArrays.set(evaluatedKey, evalRes);
                    }
                  } catch {
                    // Speculative evaluation of constant function call during dimension inference.
                    // If evaluation cannot be completed at this stage, continue with standard dimension resolution.
                  }
                }
              }
            }
          }
        }
        if (resolvedDims[i]! <= 0 && effectiveBinding?.text && !isFunctionInputWithColon) {
          const bRef = effectiveBinding.text.trim();
          if (isArrayLiteral(bRef)) {
            let currentLit = bRef;
            let valid = true;
            for (let d = 0; d < i; d++) {
              if (currentLit.startsWith("{") && currentLit.endsWith("}")) {
                const subElems = parseArrayLiteralElements(currentLit);
                if (subElems.length > 0) {
                  currentLit = subElems[0]!.trim();
                } else {
                  valid = false;
                  break;
                }
              } else {
                valid = false;
                break;
              }
            }
            if (valid && currentLit.startsWith("{") && currentLit.endsWith("}")) {
              const elems = parseArrayLiteralElements(currentLit);
              if (elems.length > 0) resolvedDims[i] = elems.length;
            }
          } else if (bRef.startsWith("[") && bRef.endsWith("]")) {
            const rows = splitTopLevel(bRef.slice(1, -1), ";");
            const rowsCount = rows.length;
            const colsCount = rows.length > 0 ? splitTopLevel(rows[0]!, ",").length : 0;
            if (i === 0 && rowsCount > 0) resolvedDims[0] = rowsCount;
            if (i === 1 && colsCount > 0) resolvedDims[1] = colsCount;
          } else if (
            (bRef.startsWith("zeros(") || bRef.startsWith("ones(") || bRef.startsWith("fill(")) &&
            bRef.endsWith(")")
          ) {
            const inner = bRef.slice(bRef.indexOf("(") + 1, -1).trim();
            const parts = splitTopLevelArgs(inner);
            const dimArgs = bRef.startsWith("fill(") ? parts.slice(1) : parts;
            if (dimArgs.length > i) {
              const dimVal = evaluateCSTNumber(dimArgs[i], undefined, undefined, flattener.db, dae, prefix);
              if (typeof dimVal === "number" && dimVal >= 0) {
                resolvedDims[i] = dimVal;
              }
            }
          } else if (bRef.includes("(") && bRef.endsWith(")")) {
            const parsedCall = parseNamedCallArgsFromText(bRef);
            const fnCallMatch = parsedCall && isDottedIdentifierChain(parsedCall.callee) ? parsedCall : null;
            if (fnCallMatch) {
              const fnCallName = fnCallMatch.callee;
              const argsText = fnCallMatch.argsText;
              const prefixFnCallName = prefix ? `${prefix}.${fnCallName}` : fnCallName;
              let fnObj = dae.getFunction(fnCallName) || dae.getFunction(prefixFnCallName);
              if (!fnObj) {
                const matchingFnSym = flattener.db.byName(fnCallName).find((e) => flattener["isFunctionSym"](e));
                if (matchingFnSym) {
                  const qualFnName = getSymbolQualifiedName(flattener.db, matchingFnSym.id);
                  fnObj = flattener.flattenFunction(matchingFnSym.id, qualFnName, undefined, dae);
                  dae.addFunction(qualFnName, fnObj);
                  dae.addFunction(fnCallName, fnObj);
                }
              }
              if (fnObj) {
                for (let vi = 0; vi < fnObj.varCount; vi++) {
                  if (fnObj.getVarCausality(vi) === Causality.Output) {
                    const outShape =
                      getFlatteningState(fnObj).deducedOutputShapes.get(fnObj.getVarName(vi)) ?? fnObj.getVarShape(vi);
                    if (outShape && outShape.length === resolvedDims.length && outShape.every((d: number) => d > 0)) {
                      for (let d = 0; d < resolvedDims.length; d++) {
                        if (resolvedDims[d]! <= 0) {
                          resolvedDims[d] = outShape[d]!;
                        }
                      }
                      break;
                    }
                  }
                }
              }
              if (fnObj) {
                const argParts = splitTopLevelArgs(argsText);
                const evalArgs: ArenaEvalArg[] = [];
                let allArgsOk = true;
                for (const ap of argParts) {
                  const cleanAp = ap.trim();
                  const resolvedAp = resolveScopedName(cleanAp, prefix, dae);
                  const arrayTarget = dae.hasArrayElements(resolvedAp)
                    ? resolvedAp
                    : dae.hasArrayElements(cleanAp)
                      ? cleanAp
                      : null;
                  if (arrayTarget) {
                    const elemIndices = dae.getArrayElementIndices(arrayTarget);
                    const arrVals: ArenaEvalArg[] = [];
                    for (const eIdx of elemIndices) {
                      const sv = dae.getVarExpression(eIdx);
                      const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(eIdx);
                      arrVals.push((val ?? 0) as ArenaEvalArg);
                    }
                    evalArgs.push(arrVals);
                    continue;
                  }
                  const vIdx =
                    dae.lookupVariable(resolvedAp) >= 0 ? dae.lookupVariable(resolvedAp) : dae.lookupVariable(cleanAp);
                  if (vIdx >= 0) {
                    if (
                      dae.getVarVariability(vIdx) === Variability.Parameter &&
                      !dae.isVarFinal(vIdx) &&
                      dae.getVarType(vIdx) !== VarType.Integer
                    ) {
                      allArgsOk = false;
                      break;
                    }
                    const sv = dae.getVarExpression(vIdx);
                    const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(vIdx);
                    if (val !== null && val !== undefined) {
                      evalArgs.push(val as ArenaEvalArg);
                      continue;
                    }
                  }
                  const num = Number(cleanAp);
                  if (!isNaN(num)) {
                    evalArgs.push(num);
                    continue;
                  }
                  allArgsOk = false;
                  break;
                }
                if (allArgsOk) {
                  try {
                    const resolvedFnName = dae.getFunction(fnCallName) ? fnCallName : prefixFnCallName;
                    const fnInternId = dae.interner.intern(resolvedFnName);
                    const evalRes = evaluateArenaFunctionCall(
                      dae,
                      fnInternId,
                      evalArgs,
                      flattener.db,
                      flattener.currentRootClassId,
                    );
                    if (evalRes) {
                      const evaluatedKey = prefix ? `${prefix}.${name}` : name;
                      flattener.evaluatedConstantArrays.set(evaluatedKey, evalRes);
                      const getShape = (val: unknown): number[] => {
                        const resShape: number[] = [];
                        let curr: unknown = val;
                        while (Array.isArray(curr)) {
                          resShape.push(curr.length);
                          curr = curr[0];
                        }
                        return resShape;
                      };
                      const resShape = getShape(evalRes);
                      for (let d = 0; d < resolvedDims.length; d++) {
                        if (resolvedDims[d]! <= 0 && d < resShape.length && resShape[d]! > 0) {
                          resolvedDims[d] = resShape[d]!;
                        }
                      }
                    }
                  } catch {
                    // Speculative evaluation of array shape during dimension inference.
                    // If evaluation cannot be completed at this stage, continue with standard dimension resolution.
                  }
                }
              }
            }
          } else {
            const cleanRef = stripLeadingMinusWs(bRef);
            const resolvedRef = resolveScopedName(cleanRef, prefix, dae);
            let maxDimVal = 0;
            const searchRefs = [resolvedRef];
            if (resolvedRef !== cleanRef) searchRefs.push(cleanRef);
            for (const targetRef of searchRefs) {
              const prefixMatch = `${targetRef}[`;
              for (let v = 0; v < dae.varCount; v++) {
                if (!dae.isVarRemoved(v)) {
                  const vName = dae.getVarName(v);
                  if (vName.startsWith(prefixMatch) && vName.endsWith("]")) {
                    const innerIndices = vName.slice(prefixMatch.length, -1).split(",").map(Number);
                    if (i < innerIndices.length) {
                      const idxVal = innerIndices[i];
                      if (idxVal !== undefined && !isNaN(idxVal) && idxVal > maxDimVal) {
                        maxDimVal = idxVal;
                      }
                    }
                  }
                }
              }
              if (maxDimVal > 0) break;
            }
            if (maxDimVal > 0) {
              resolvedDims[i] = maxDimVal;
            }
          }
        }
      }
    }
    if (resolvedDims.every((d) => d >= 0)) {
      arrayDims = resolvedDims;
    } else if (
      dae.classKind !== "function" &&
      flattener.options.arrayMode !== "preserve" &&
      rawDims &&
      rawDims.some((d) => d?.text?.trim() === ":" || d?.kind === "colon" || d?.kind === "flexible")
    ) {
      if (flattener.options.omcCompatibility && !getDaeExtMeta(dae)?.hasOldInstOption) {
        for (let i = 0; i < resolvedDims.length; i++) {
          const rd = rawDims[i];
          const isColon = rd?.text?.trim() === ":" || rd?.kind === "colon" || rd?.kind === "flexible";
          if (isColon && resolvedDims[i]! <= 0 && !dae.diagnostics.some((d) => d.severity === "error")) {
            const startB = elemCst?.startIndex ?? elemCst?.startOffset;
            const endB = elemCst?.endIndex ?? elemCst?.endOffset;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.code,
              message: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.message(String(i + 1), name),
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
      for (let i = 0; i < resolvedDims.length; i++) {
        if (resolvedDims[i]! <= 0) resolvedDims[i] = 1;
      }
      arrayDims = resolvedDims;
    }
  }
  arrayDimsRef.current = arrayDims;
  if (arrayDims && arrayDims.length > 0) {
    setNamedArrayShape(dae, name, arrayDims);
    const sizeVars: number[] = (state.pendingSizeCallVars ??= []);
    const scannedTo: number = state.pendingSizeScannedCount ?? 0;
    for (let v = scannedTo; v < dae.varCount; v++) {
      const vExpr = dae.getVarExpression(v);
      if (vExpr !== undefined && vExpr >= 0 && dae.getExprKind(vExpr) === ExprKind.Call) {
        if (dae.interner.resolve(dae.getExprData1(vExpr)) === "size") {
          sizeVars.push(v);
        }
      }
    }
    state.pendingSizeScannedCount = dae.varCount;
    for (const v of sizeVars) {
      const vExpr = dae.getVarExpression(v);
      if (vExpr !== undefined && vExpr >= 0 && dae.getExprKind(vExpr) === ExprKind.Call) {
        const fnStr = dae.interner.resolve(dae.getExprData1(vExpr));
        if (fnStr === "size" && dae.getExprRight(vExpr) === 2) {
          const arg0 = dae.getExprLeft(vExpr);
          const arg1 = dae.getExprLeft(vExpr + 1);
          if (dae.getExprKind(arg0) === ExprKind.Name && dae.getExprKind(arg1) === ExprKind.IntLiteral) {
            const targetArrName = dae.interner.resolve(dae.getExprData1(arg0));
            const dimIdx = dae.getExprData1(arg1);
            if (
              (targetArrName === name || targetArrName === compInst.name) &&
              dimIdx >= 1 &&
              dimIdx <= arrayDims.length &&
              arrayDims[dimIdx - 1]! > 0
            ) {
              dae.setVarExpression(v, dae.addIntLiteral(arrayDims[dimIdx - 1]!));
            }
          }
        }
      }
    }
    (state.namedArrayTypes ??= new Map<string, number>()).set(name, varType);
    if (varType === VarType.Enumeration && customType && enumLiterals && enumLiterals.length > 0) {
      (state.namedArrayEnumInfo ??= new Map<string, { qual: string; literals: string[] }>()).set(name, {
        qual: customType,
        literals: enumLiterals.map(getEnumLiteralName),
      });
    }
    if (dae.classKind !== "function" && flattener.options.arrayMode !== "preserve" && arrayDims.some((d) => d === 0)) {
      if (dae.extensionMetadata?.["isOldFrontend"] && effectiveBinding?.text) {
        for (const fnCallName of extractCallTargetsFromExpr(effectiveBinding.text, null, true)) {
          const fnShort = fnCallName.split(".").pop()!;
          const fnSym = flattener.db
            .byName(fnShort)
            .find(
              (e) =>
                flattener["isFunctionSym"](e) &&
                !flattener.isClassPartial(e.id) &&
                getSymbolQualifiedName(flattener.db, e.id) === fnCallName,
            );
          if (fnSym && !dae.getFunction(fnCallName)) {
            const fn = flattener.flattenFunction(fnSym.id, fnCallName, undefined, dae);
            if (fn) asExtDae(fn).wasCalled = true;
          }
        }
      }
      if (
        arrayDims.length === 2 &&
        arrayDims[0]! > 0 &&
        arrayDims[1] === 0 &&
        variability !== Variability.Parameter &&
        variability !== Variability.Constant &&
        effectiveBinding
      ) {
        const emptyMatrixExpr = "{" + Array(arrayDims[0]).fill("{}").join(", ") + "}";
        const lhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(name));
        const rhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(emptyMatrixExpr));
        dae.addEquation(EqKind.Simple, lhsId, rhsId);
      }
      return "continue";
    }

    const combinedArgs: ModArgData[] = [
      ...typeMods,
      ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
      ...(compInst?.modification?.args || []),
      ...(matchingParentArg?.nestedArgs || matchingParentArg?.args || []),
    ];
    for (const arg of combinedArgs) {
      const targetDims = arrayDims;
      if (typeMods.includes(arg)) {
        if (
          (arg.name === "start" || arg.name === "min" || arg.name === "max" || arg.name === "nominal") &&
          targetDims &&
          targetDims.length >= 2
        ) {
          const rawVal: unknown = arg.value;
          const rawText =
            arg.value?.text?.trim() ??
            (typeof rawVal === "string"
              ? rawVal
              : typeof arg.bindingExpression === "string"
                ? arg.bindingExpression
                : (arg.bindingExpression?.text?.trim() ?? ""));
          if (rawText.startsWith("{") && rawText.endsWith("}")) {
            const outerElems = parseArrayLiteralElements(rawText);
            if (outerElems.length > 0 && !outerElems[0]!.startsWith("{")) {
              let clauseStart = elemCst?.startIndex ?? elemCst?.startOffset;
              let clauseEnd = elemCst?.endIndex ?? elemCst?.endOffset;
              if (elemCst) {
                let curr: SyntaxNode | null = elemCst;
                while (curr && curr.type !== "component_clause") curr = curr.parent;
                if (curr) {
                  clauseStart = curr.startIndex ?? curr.startOffset;
                  clauseEnd = curr.endIndex ?? curr.endOffset;
                }
              }
              const allInts = outerElems.every((e: string) => isSignedAsciiIntText(e.trim()));
              const elemType = allInts ? "Integer" : "Real";
              const baseTypeName = varTypeName(varType);
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.ATTRIBUTE_TYPE_MISMATCH.code,
                message: `Variable ${compInst.name}: Wrong type on builtin attribute ${arg.name} of type ${elemType}[${outerElems.length}], expected ${baseTypeName}.`,
                range: { startOffset: clauseStart, endOffset: clauseEnd },
              });
              return "return";
            }
          }
        }
        continue;
      }
      if (!targetDims || targetDims.length === 0) continue;
      const rawVal: unknown = arg.value;
      const rawText =
        arg.value?.text?.trim() ??
        (typeof rawVal === "string"
          ? rawVal
          : typeof arg.bindingExpression === "string"
            ? arg.bindingExpression
            : (arg.bindingExpression?.text?.trim() ?? ""));
      if (rawText.startsWith("[") && rawText.endsWith("]")) {
        const rows = splitTopLevel(rawText.slice(1, -1), ";");
        const rowElements = rows.map((r) => splitTopLevel(r, ","));
        const rowsCount = rows.length;
        const colsCount = rowElements.length > 0 ? rowElements[0]!.length : 0;
        if (
          targetDims.length === 1 ||
          (targetDims.length >= 2 && (targetDims[0] !== rowsCount || targetDims[1] !== colsCount))
        ) {
          let clauseStart = elemCst?.startIndex ?? elemCst?.startOffset;
          let clauseEnd = elemCst?.endIndex ?? elemCst?.endOffset;
          if (elemCst) {
            let curr: SyntaxNode | null = elemCst;
            while (curr && curr.type !== "component_clause") curr = curr.parent;
            if (curr) {
              clauseStart = curr.startIndex ?? curr.startOffset;
              clauseEnd = curr.endIndex ?? curr.endOffset;
            }
          }
          const formattedExpr = "{" + rowElements.map((cols) => "{" + cols.join(", ") + "}").join(", ") + "}";
          const allInts = rowElements.every((row) => row.every((c) => isSignedAsciiIntText(c)));
          const elemType = allInts ? "Integer" : "Real";
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
            message: `Array dimension mismatch, expression ${formattedExpr} has type ${elemType}[${rowsCount}, ${colsCount}], expected array dimensions [${targetDims.join(", ")}].`,
            range: { startOffset: clauseStart, endOffset: clauseEnd },
          });
          return "return";
        }
      }
      if (rawText.startsWith("{") && rawText.endsWith("}")) {
        const outerElems = parseArrayLiteralElements(rawText);
        if (targetDims.length >= 2) {
          let mismatchRow: { rowText: string; innerElems: string[] } | null = null;
          for (const rowText of outerElems) {
            if (rowText.startsWith("{") && rowText.endsWith("}")) {
              const innerElems = parseArrayLiteralElements(rowText);
              if (innerElems.length !== targetDims[1]) {
                mismatchRow = { rowText, innerElems };
              }
            }
          }
          if (mismatchRow) {
            let clauseStart = elemCst?.startIndex ?? elemCst?.startOffset;
            let clauseEnd = elemCst?.endIndex ?? elemCst?.endOffset;
            if (elemCst) {
              let curr: SyntaxNode | null = elemCst;
              while (curr && curr.type !== "component_clause") curr = curr.parent;
              if (curr) {
                clauseStart = curr.startIndex ?? curr.startOffset;
                clauseEnd = curr.endIndex ?? curr.endOffset;
              }
            }
            const elemType = mismatchRow.innerElems.every((e: string) => isSignedAsciiIntText(e.trim()))
              ? "Integer"
              : "Real";
            const notifRange = arg.modRange ?? [clauseStart, clauseEnd];
            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE_TRACE.code,
              message: "From here:",
              range: { startOffset: notifRange[0], endOffset: notifRange[1] },
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
              message: `Array dimension mismatch, expression ${mismatchRow.rowText} has type ${elemType}[${mismatchRow.innerElems.length}], expected array dimensions [${targetDims[1]}].`,
              range: { startOffset: clauseStart, endOffset: clauseEnd },
            });
            return "return";
          }
        } else if (targetDims.length === 1 && outerElems.length !== targetDims[0]) {
          let clauseStart = elemCst?.startIndex ?? elemCst?.startOffset;
          let clauseEnd = elemCst?.endIndex ?? elemCst?.endOffset;
          if (elemCst) {
            let curr: SyntaxNode | null = elemCst;
            while (curr && curr.type !== "component_clause") curr = curr.parent;
            if (curr) {
              clauseStart = curr.startIndex ?? curr.startOffset;
              clauseEnd = curr.endIndex ?? curr.endOffset;
            }
          }
          const elemType = outerElems.every((e: string) => isSignedAsciiIntText(e.trim())) ? "Integer" : "Real";
          const notifRange = arg.modRange ?? [clauseStart, clauseEnd];
          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE_TRACE.code,
            message: "From here:",
            range: { startOffset: notifRange[0], endOffset: notifRange[1] },
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
            message: `Array dimension mismatch, expression ${rawText} has type ${elemType}[${outerElems.length}], expected array dimensions [${targetDims[0]}].`,
            range: { startOffset: clauseStart, endOffset: clauseEnd },
          });
          return "return";
        }
      }
    }

    if (dae.classKind === "function" || flattener.options.arrayMode === "preserve") {
      const rawDims = flattener.db.query<ArrayDimRawEntry[] | null>("arrayDimensions", elemId);
      const hasColon =
        rawDims && rawDims.some((d) => d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible");
      const concreteShape =
        arrayDims && arrayDims.length > 0 && arrayDims.every((d) => d > 0)
          ? arrayDims
          : hasColon
            ? rawDims!.map((d) => (d.kind === "literal" && typeof d.value === "number" ? d.value : -1))
            : (rawDims?.map((d) => (d.kind === "literal" && typeof d.value === "number" ? d.value : -1)) ?? []);
      if (
        flattener.options.arrayMode === "preserve" &&
        dae.extensionMetadata?.["isOldFrontend"] &&
        varType === VarType.Real &&
        concreteShape.length > 0 &&
        effectiveBinding?.text
      ) {
        const cleanB = stripLeadingEquals(effectiveBinding.text);
        if (cleanB.startsWith("{") && cleanB.endsWith("}")) {
          const leafTokens = splitBraceCommasAndTrim(cleanB);
          if (leafTokens.length > 0 && leafTokens.every((t: string) => isSignedAsciiIntText(t))) {
            const compLabel = prefix ? name : `.${compInst.name}`;
            const formattedMod = cleanB
              .split(",")
              .map((seg: string, idx: number) => (idx === 0 ? seg : seg.trimStart()))
              .join(", ");
            let clauseNode: SyntaxNode | null = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const rangeNode = clauseNode ?? elemCst;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.code,
              message: `Type mismatch in modifier of component ${compLabel}, expected type Real, got modifier =${formattedMod} of type Integer[${concreteShape.join(", ")}].`,
              range: rangeNode
                ? {
                    startOffset: rangeNode.startIndex ?? rangeNode.startOffset,
                    endOffset: rangeNode.endIndex ?? rangeNode.endOffset,
                    startPosition: rangeNode.startPosition,
                    endPosition: rangeNode.endPosition,
                  }
                : undefined,
            });
            return "return";
          }
        }
      }
      const varIdx = dae.addVariable(
        dae.interner.intern(name),
        varType as number,
        variability as number,
        causality as number,
        0.0,
      );
      if (isComponentHidden(flattener, elemId)) {
        dae.hiddenVarIndices.add(varIdx);
      }
      const finalShape = [...(parentMods?.outerArrayDims ?? []), ...concreteShape];
      if (finalShape.length > 0) {
        dae.setVarShape(varIdx, finalShape);
      }
      if ((rawDims && rawDims.length > 0) || (parentMods?.outerArrayDims && parentMods.outerArrayDims.length > 0)) {
        const shapeExprIds: number[] = [];
        if (parentMods?.outerArrayDims) {
          for (const od of parentMods.outerArrayDims) {
            shapeExprIds.push(dae.addIntLiteral(od));
          }
        }
        const fnElemNames = new Set<string>();
        if (dae.classKind === "function") {
          for (let vi = 0; vi < dae.varCount; vi++) {
            if (!dae.isVarRemoved(vi)) fnElemNames.add(dae.getVarName(vi));
          }
          for (const eid of elements) {
            const es = flattener.db.symbol(eid);
            if (es?.kind === "Component") fnElemNames.add(es.name);
          }
        }
        for (let dIdx = 0; dIdx < (rawDims?.length ?? 0); dIdx++) {
          const d = rawDims![dIdx]!;
          if (d.kind === "expression") {
            let exprId = -1;
            const dimText = d.text?.trim() ?? "";
            const refsFnVar =
              dae.classKind === "function" &&
              extractAsciiIdentifiers(dimText).some((id: string) => fnElemNames.has(id));
            if (!refsFnVar && dimText) {
              const dimScopeId = asExtDae(dae).enclosingScopeId ?? flattener.currentClassId ?? undefined;
              let constDimVal = evaluateCSTNumber(dimText, undefined, dimScopeId, flattener.db, dae, prefix);
              if (
                (typeof constDimVal !== "number" || constDimVal <= 0) &&
                flattener.currentClassId !== undefined &&
                flattener.currentClassId !== dimScopeId
              ) {
                constDimVal = evaluateCSTNumber(
                  dimText,
                  undefined,
                  flattener.currentClassId,
                  flattener.db,
                  dae,
                  prefix,
                );
              }
              if (typeof constDimVal === "number" && constDimVal > 0 && Number.isInteger(constDimVal)) {
                exprId = dae.addIntLiteral(constDimVal);
              }
            }
            if (exprId < 0 && d.cstBytes) {
              const elemSym = flattener.db.symbol(elemId);
              const cstNode = getCstNodeRange(flattener.db, d.cstBytes[0], d.cstBytes[1], elemSym ?? undefined);
              if (cstNode) {
                exprId = flattener.lowerExpr(cstNode, dae, prefix);
              }
            }
            if (exprId < 0 && d.text) {
              const normText = spaceAfterCommas(d.text);
              exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(normText));
            }
            if (exprId >= 0) {
              shapeExprIds.push(exprId);
            }
          } else if (d.kind === "literal" && typeof d.value === "number") {
            shapeExprIds.push(dae.addIntLiteral(d.value));
          } else if (d.kind === "colon" || d.kind === "flexible" || d.text?.trim() === ":") {
            shapeExprIds.push(dae.addColonExpr());
          }
        }
        if (shapeExprIds.length > 0) {
          dae.setVarShapeExprs(varIdx, shapeExprIds);
        }
      }
      if (elemCst) {
        const startB = elemCst.startIndex ?? elemCst.startOffset;
        const endB = elemCst.endIndex ?? elemCst.endOffset;
        if (startB != null && endB != null) {
          dae.setVarSourceRange(varIdx, startB, endB);
        }
      }
      if (isElemProtected) {
        dae.setVarProtected(varIdx, true);
      }
      validateFunctionComponentDeclaration(flattener, dae, compInst, causality, isElemProtected, elemCst);
      if (compInst?.flowPrefix === "flow" || meta.flowPrefix === "flow" || parentMods?.parentFlowPrefix === "flow") {
        dae.setVarFlow(varIdx, true);
      }
      if (
        compInst?.flowPrefix === "stream" ||
        meta.flowPrefix === "stream" ||
        parentMods?.parentFlowPrefix === "stream"
      ) {
        dae.setVarStream(varIdx, true);
      }
      if (
        compInst?.isFinal ||
        meta.isFinal ||
        (!dae.extensionMetadata?.["isOldFrontend"] &&
          (parentMods?.isFinal || matchingParentArg?.final || matchingClassArg?.final || redeclArg?.final)) ||
        (isEvaluated && !prefix) ||
        (!flattener.options.omcCompatibility && isEvaluated)
      ) {
        dae.setVarFinal(varIdx, true);
      }
      if (dae.classKind === "function" && isRecordTarget && compInst?.modification?.args) {
        const fieldMap = new Map<string, number>();
        for (const arg of compInst.modification.args) {
          if (arg.name && arg.value) {
            let exprId = -1;
            if (arg.value.cst) {
              exprId = flattener.lowerExpr(arg.value.cst, dae, prefix);
            } else if (arg.value.text) {
              const normText = arg.value.text.trim();
              const num = Number(normText);
              if (!isNaN(num)) {
                exprId = dae.addRealLiteral(num);
              } else if (normText === "true" || normText === "false") {
                exprId = dae.addBoolLiteral(normText === "true");
              } else {
                exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(normText));
              }
            }
            if (exprId >= 0) {
              fieldMap.set(arg.name, exprId);
            }
          }
        }
        if (fieldMap.size > 0) {
          (state.recordVarFieldExprs ??= new Map()).set(name, fieldMap);
          (asExtDae(dae).recordVarFieldExprs ??= new Map()).set(name, fieldMap);
        }
      }
      applyModifiers(varIdx, []);
      return "continue";
    }

    const rawDims = flattener.db.query<ArrayDimRawEntry[] | null>("arrayDimensions", elemId);
    const dimLabels: (string[] | null)[] = [];
    if (rawDims) {
      for (const d of rawDims) {
        const dText = d?.text?.trim() ?? "";
        if (dText === "Boolean") {
          dimLabels.push(["false", "true"]);
        } else if (dText) {
          const scopeId =
            flattener.db.symbol(elemId)?.parentId ?? flattener.currentClassId ?? flattener.currentRootClassId ?? 0;
          const resolver = flattener.db.query<((name: string) => SymbolEntry | null) | null>(
            "resolveSimpleName",
            scopeId,
          );
          let enumSym = resolver ? resolver(dText) : null;
          if (!enumSym) {
            const candidates = flattener.db.byName(dText.includes(".") ? dText.split(".").pop()! : dText);
            if (candidates.length > 0) enumSym = candidates[0]!;
          }
          if (enumSym) {
            const qual = getSymbolQualifiedName(flattener.db, enumSym.id);
            const rawLits = extractEnumLiteralsFromCst(getCstNode(flattener.db, enumSym.id), getSymMeta(enumSym));
            if (rawLits && rawLits.length > 0) {
              const lits = rawLits.map((s) => `${qual}.${s}`);
              dimLabels.push(lits);
              continue;
            }
          }
          dimLabels.push(null);
        } else {
          dimLabels.push(null);
        }
      }
    }
    const bText = effectiveBinding?.text?.trim() ?? "";
    if (arrayDims && arrayDims.length > 0 && bText) {
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
          if (varType === VarType.Real) {
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
          varType === VarType.Real &&
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
        const hasEach = Boolean(compInst.modification?.isEach || matchingParentArg?.isEach || matchingClassArg?.isEach);
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
    // ============================================================================
    // Phase 6: Scalarized DAE Variable Emission (`arr[i,j]` Tuple Expansion)
    // ============================================================================
    // Generate 1-based cartesian index tuples across `arrayDims` and emit a scalarized
    // variable in `DAEBuilder` for each element, formatting Boolean/Enumeration subscripts
    // via `dimLabels` when the dimension is typed by `Boolean` or an `enumeration`.
    const is1DNumeric = arrayDims.length === 1 && (!dimLabels || !dimLabels[0] || dimLabels[0].length === 0);

    if (is1DNumeric) {
      const dim1 = arrayDims[0]!;
      const tuple = [1];
      for (let i = 1; i <= dim1; i++) {
        tuple[0] = i;
        const arrVarName = `${name}[${i}]`;
        const varIdx = dae.addVariable(
          dae.interner.intern(arrVarName),
          varType as number,
          variability as number,
          causality as number,
          0.0,
        );
        if (isComponentHidden(flattener, elemId)) {
          dae.hiddenVarIndices.add(varIdx);
        }
        if (elemCst) {
          const startB = elemCst.startIndex ?? elemCst.startOffset;
          const endB = elemCst.endIndex ?? elemCst.endOffset;
          if (startB != null && endB != null) {
            dae.setVarSourceRange(varIdx, startB, endB);
          }
        }
        if (isElemProtected) {
          dae.setVarProtected(varIdx, true);
        }
        validateFunctionComponentDeclaration(flattener, dae, compInst, causality, isElemProtected, elemCst);
        if (compInst?.flowPrefix === "flow" || meta.flowPrefix === "flow" || parentMods?.parentFlowPrefix === "flow") {
          dae.setVarFlow(varIdx, true);
        }
        if (
          compInst?.flowPrefix === "stream" ||
          meta.flowPrefix === "stream" ||
          parentMods?.parentFlowPrefix === "stream"
        ) {
          dae.setVarStream(varIdx, true);
        }
        if (
          compInst?.isFinal ||
          meta.isFinal ||
          (parentMods?.isFinal && parentMods?.isRecord) ||
          (!dae.extensionMetadata?.["isOldFrontend"] &&
            (parentMods?.isFinal || matchingParentArg?.final || matchingClassArg?.final || redeclArg?.final)) ||
          (isEvaluated && !prefix) ||
          (!flattener.options.omcCompatibility && isEvaluated)
        ) {
          dae.setVarFinal(varIdx, true);
        }
        applyModifiers(varIdx, tuple, dimLabels);
      }
    } else {
      const tuples = generateArrayTuples(arrayDims);
      for (const tuple of tuples) {
        const indexStr = `[${tuple.map((val, dIdx) => (dimLabels[dIdx] && dimLabels[dIdx]![val - 1] ? dimLabels[dIdx]![val - 1] : val)).join(",")}]`;
        const arrVarName = `${name}${indexStr}`;
        const varIdx = dae.addVariable(
          dae.interner.intern(arrVarName),
          varType as number,
          variability as number,
          causality as number,
          0.0,
        );
        if (isComponentHidden(flattener, elemId)) {
          dae.hiddenVarIndices.add(varIdx);
        }
        if (elemCst) {
          const startB = elemCst.startIndex ?? elemCst.startOffset;
          const endB = elemCst.endIndex ?? elemCst.endOffset;
          if (startB != null && endB != null) {
            dae.setVarSourceRange(varIdx, startB, endB);
          }
        }
        if (isElemProtected) {
          dae.setVarProtected(varIdx, true);
        }
        validateFunctionComponentDeclaration(flattener, dae, compInst, causality, isElemProtected, elemCst);
        if (compInst?.flowPrefix === "flow" || meta.flowPrefix === "flow" || parentMods?.parentFlowPrefix === "flow") {
          dae.setVarFlow(varIdx, true);
        }
        if (
          compInst?.flowPrefix === "stream" ||
          meta.flowPrefix === "stream" ||
          parentMods?.parentFlowPrefix === "stream"
        ) {
          dae.setVarStream(varIdx, true);
        }
        if (
          compInst?.isFinal ||
          meta.isFinal ||
          (parentMods?.isFinal && parentMods?.isRecord) ||
          (!dae.extensionMetadata?.["isOldFrontend"] &&
            (parentMods?.isFinal || matchingParentArg?.final || matchingClassArg?.final || redeclArg?.final)) ||
          (isEvaluated && !prefix) ||
          (!flattener.options.omcCompatibility && isEvaluated)
        ) {
          dae.setVarFinal(varIdx, true);
        }
        applyModifiers(varIdx, tuple, dimLabels);
      }
    }
    const isRecordParamOrConst =
      Boolean(
        parentMods?.isRecord && (varType !== VarType.Real || isParentBoundField || effectiveParentArg?.isRecordCtorArg),
      ) ||
      dae.classKind === "function" ||
      dae.classKind === "record" ||
      parentMods?.parentVariability === Variability.Parameter ||
      parentMods?.parentVariability === Variability.Constant;
    if (
      !isRecordParamOrConst &&
      (variability === Variability.Continuous || variability === Variability.Discrete) &&
      effectiveBinding?.text &&
      !dae.extensionMetadata?.["scalarizeBindings"] &&
      (!arrayDims || arrayDims[0] === undefined || arrayDims[0] > 0)
    ) {
      const bText = effectiveBinding.text.trim();
      const bindingPrefix =
        parentMods?.bindingScope !== undefined && isParentBoundField
          ? parentMods.bindingScope
          : effectiveParentArg?.value && (!effectiveParentArg?.isExtendsMod || effectiveParentArg?.isFromParentExtends)
            ? prefix.includes(".")
              ? prefix.split(".").slice(0, -1).join(".")
              : ""
            : prefix;
      let rhsExprId: number | null = null;
      const modChild = elemCst?.children?.find((c) => c.type === "modification");
      const findBindingExprNode = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
        if (!n) return null;
        if (n.type === "type_specifier" || n.type === "array_subscripts") return null;
        if (n.type === "expression" && n.text?.trim() === bText) return n;
        for (const c of n.children || []) {
          const res = findBindingExprNode(c);
          if (res) return res;
        }
        return null;
      };
      let exprCst: FlattenerCstNode | SyntaxNode | null = findBindingExprNode(modChild ?? elemCst);
      if (!exprCst && effectiveBinding?.cstBytes) {
        const docUri = effectiveBinding.evaluationScopeId
          ? flattener.db.symbol(effectiveBinding.evaluationScopeId)
          : flattener.db.symbol(elemId);
        let bindCst: FlattenerCstNode | SyntaxNode | null = getCstNodeRange(
          flattener.db,
          effectiveBinding.cstBytes[0],
          effectiveBinding.cstBytes[1],
          docUri,
        );
        if (bindCst && bindCst.type !== "expression") {
          const found = findBindingExprFromCst(bindCst);
          if (found) bindCst = found;
        }
        if (bindCst && bindCst.text?.trim() === bText) {
          exprCst = bindCst;
        }
      }
      if (!exprCst) {
        exprCst = parseStandaloneExpressionCst(bText);
      }
      const prevBindingCompName = flattener.currentBindingCompName;
      flattener.currentBindingCompName = compInst.name;
      try {
        if (exprCst && exprCst.text?.trim() === bText) {
          rhsExprId = flattener.lowerExpr(exprCst, dae, bindingPrefix);
          const expRange = expandColonToArrayCtor(rhsExprId, dae, varType);
          if (expRange !== null) rhsExprId = expRange;
          if (varType === VarType.Real && !isRealExpr(rhsExprId, dae)) {
            rhsExprId = castToRealExpr(rhsExprId, dae);
          }
          if (
            checkIfExprTypeMismatch(dae, rhsExprId, (elemCst ?? exprCst) as SyntaxNode | null, bindingPrefix, arrayDims)
          ) {
            return "return";
          }
        } else if (bText.startsWith("{") && bText.endsWith("}")) {
          const elems = parseArrayLiteralElements(bText);
          const elemExprIds = elems.map((e) => {
            const num = parseFloat(e);
            return !isNaN(num)
              ? varType === VarType.Integer
                ? dae.addIntLiteral(parseInt(e, 10))
                : dae.addRealLiteral(num)
              : dae.addExpression(ExprKind.Name, dae.interner.intern(resolveScopedName(e, bindingPrefix, dae)));
          });
          rhsExprId = dae.addArrayCtorExpr(elemExprIds);
          if (varType === VarType.Real && !isRealExpr(rhsExprId, dae)) {
            rhsExprId = castToRealExpr(rhsExprId, dae);
          }
        } else {
          const resolvedBText = resolveScopedName(bText, bindingPrefix, dae);
          if (
            (dae.hasArrayElements(resolvedBText) ||
              dae.hasArrayElements(bText) ||
              flattener.db.byName(bText).some((e) => {
                const d = flattener.db.query<ArrayDimRawEntry[] | null>("arrayDimensions", e.id);
                return Boolean(d && d.length > 0);
              })) &&
            arrayDims &&
            arrayDims.length > 0
          ) {
            const baseName = dae.hasArrayElements(resolvedBText) ? resolvedBText : bText;
            const elemExprIds =
              arrayDims.length === 1
                ? Array.from({ length: arrayDims[0]! }, (_, idx) =>
                    dae.addExpression(ExprKind.Name, dae.interner.intern(`${baseName}[${idx + 1}]`)),
                  )
                : generateArrayTuples(arrayDims).map((t) =>
                    dae.addExpression(ExprKind.Name, dae.interner.intern(`${baseName}[${t.join(",")}]`)),
                  );
            rhsExprId = dae.addArrayCtorExpr(elemExprIds);
          } else {
            rhsExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
          }
          if (varType === VarType.Real && !isRealExpr(rhsExprId, dae)) {
            rhsExprId = castToRealExpr(rhsExprId, dae);
          }
        }
      } finally {
        flattener.currentBindingCompName = prevBindingCompName;
      }
      const lhsExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(name));
      const pendingBindings = getPendingArrayBindings(flattener);
      if (!pendingBindings.has(prefix)) {
        pendingBindings.set(prefix, []);
      }
      pendingBindings.get(prefix)!.push({ lhsExprId, rhsExprId });
    }

    return "handled";
  }
  return "scalar";
}
