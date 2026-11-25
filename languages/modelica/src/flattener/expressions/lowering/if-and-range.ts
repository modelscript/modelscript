// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExprKind } from "@modelscript/dsl";
import { DAEBuilder, inferArenaExprVarType, Variability, VarType, varTypeName } from "@modelscript/runtime";
import { type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import { getElementDiagRange } from "../../support/range-utils.js";
import { getFlatteningState } from "../../support/state.js";
import type { LoweringContext } from "../../types.js";
import { exprReferencesEnumParameter, exprReferencesRuntimeParameter } from "../binary-ops.js";
import { expandColonToArrayCtor } from "../comprehensions.js";
import { isInsideForIndex, resolveEnumType, stripOuterDoubleQuotes } from "../cst-utils.js";
import { castToRealExpr, evalDaeExpr, getExprDims, isRealExpr } from "../eval.js";

import { asDaeExt, cstHasDerCall } from "./helpers.js";
import type { LowerExprFn } from "./types.js";

export function lowerRangeCSTExpression(
  node: SyntaxNode,
  dae: DAEBuilder,
  ctx: LoweringContext,
  lowerExpr: LowerExprFn,
): number | null {
  const { prefix = "", substitutions, imports, db, flattener } = ctx;
  // Range expression: start : stop or start : step : stop
  if (
    node.childCount === 3 &&
    (node.child(1)?.type === ":" || node.child(1)?.text === ":" || node.child(1)?.type === '":"')
  ) {
    let leftChild = node.child(0);
    while (leftChild && leftChild.childCount === 1) leftChild = leftChild.child(0);
    const isLeftColon =
      leftChild &&
      leftChild.childCount === 3 &&
      (leftChild.child(1)?.type === ":" || leftChild.child(1)?.text === ":" || leftChild.child(1)?.type === '":"');

    const isForIndex = isInsideForIndex(node);

    if (isLeftColon && leftChild) {
      const startId = lowerExpr(leftChild.child(0), dae, prefix, substitutions, imports, db, flattener);
      const stepId = lowerExpr(leftChild.child(2), dae, prefix, substitutions, imports, db, flattener);
      const stopId = lowerExpr(node.child(2), dae, prefix, substitutions, imports, db, flattener);
      if (dae.getExprKind(stepId) === ExprKind.EnumLiteral && dae.getExprKind(startId) !== ExprKind.EnumLiteral) {
        let cur: SyntaxNode | null | undefined = node;
        while (
          cur &&
          cur.type !== "component_clause" &&
          cur.type !== "simple_equation" &&
          cur.type !== "statement" &&
          cur.type !== "assignment_statement"
        ) {
          cur = cur.parent;
        }
        const diagRange = getElementDiagRange(cur ?? node);
        const startText = leftChild.child(0)?.text?.trim() ?? "1";
        const stepText = leftChild.child(2)?.text?.trim() ?? "E.one";
        const startType = varTypeName(inferArenaExprVarType(dae, startId) ?? VarType.Real);
        let enumTypeStr = "enumeration E(one, two, three)";
        const dotIdx = stepText.lastIndexOf(".");
        const enumPfx = dotIdx > 0 ? stepText.slice(0, dotIdx).trim() : stepText;
        const scopeId =
          flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId;
        const enumInfo = resolveEnumType(enumPfx, scopeId, db);
        if (enumInfo) {
          const simpleName = enumInfo.qual.includes(".") ? enumInfo.qual.split(".").pop()! : enumInfo.qual;
          enumTypeStr = `enumeration ${simpleName}(${enumInfo.literals.join(", ")})`;
        }
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
          message: `Type mismatch in range: '${startText}' of type\n  ${startType}\nis not type compatible with '${stepText}' of type\n  ${enumTypeStr}`,
          range: diagRange,
        });
        return -1;
      }
      if (dae.getExprKind(startId) === ExprKind.EnumLiteral || dae.getExprKind(stopId) === ExprKind.EnumLiteral) {
        let eqNode: SyntaxNode | null | undefined = node;
        while (
          eqNode &&
          eqNode.type !== "simple_equation" &&
          eqNode.type !== "component_clause" &&
          eqNode.type !== "statement" &&
          eqNode.type !== "assignment_statement"
        ) {
          eqNode = eqNode.parent;
        }
        const diagNode = eqNode ?? node;
        const startB = diagNode?.startIndex ?? diagNode?.startOffset;
        const endB = diagNode?.endIndex ?? diagNode?.endOffset;
        const range =
          startB != null && endB != null
            ? {
                startOffset: startB,
                endOffset: endB,
                startPosition: diagNode?.startPosition,
                endPosition: diagNode?.endPosition,
              }
            : undefined;

        let enumTypeStr = "E";
        const startText = leftChild.child(0)?.text?.trim() ?? "";
        const dotIdx = startText.lastIndexOf(".");
        const enumPfx = dotIdx > 0 ? startText.slice(0, dotIdx).trim() : startText;
        const scopeId =
          flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId;
        const enumInfo = resolveEnumType(enumPfx, scopeId, db);
        if (enumInfo) {
          const simpleName = enumInfo.qual.includes(".") ? enumInfo.qual.split(".").pop()! : enumInfo.qual;
          enumTypeStr = `${simpleName}(${enumInfo.literals.join(", ")})`;
        }
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.ENUM_RANGE_WITH_STEP.code,
          message: ModelicaErrorCode.ENUM_RANGE_WITH_STEP.message(enumTypeStr),
          range,
        });
        return -1;
      }
      const isAnyReal = isRealExpr(startId, dae) || isRealExpr(stepId, dae) || isRealExpr(stopId, dae);
      const effStartId = isAnyReal ? castToRealExpr(startId, dae) : startId;
      const effStepId = isAnyReal ? castToRealExpr(stepId, dae) : stepId;
      const effStopId = isAnyReal ? castToRealExpr(stopId, dae) : stopId;
      const rangeId = dae.addExpression(ExprKind.Range, effStartId, effStepId, effStopId);
      const isMulOperand = (() => {
        if (dae.classKind !== "function" || asDaeExt(dae).isEarlyInline) return false;
        let cur: SyntaxNode | null | undefined = node.parent;
        while (cur && (cur.childCount === 1 || (cur.childCount === 3 && cur.child(0)?.text?.trim() === "("))) {
          cur = cur.parent;
        }
        return Boolean(cur && cur.childCount === 3 && cur.child(1)?.text?.trim() === "*");
      })();
      const expanded = !isForIndex && !isMulOperand ? expandColonToArrayCtor(rangeId, dae) : null;
      return expanded !== null ? expanded : rangeId;
    } else {
      const startId = lowerExpr(node.child(0), dae, prefix, substitutions, imports, db, flattener);
      const stopId = lowerExpr(node.child(2), dae, prefix, substitutions, imports, db, flattener);
      if (
        !isForIndex &&
        dae.getExprKind(startId) === ExprKind.EnumLiteral &&
        dae.getExprKind(stopId) === ExprKind.EnumLiteral
      ) {
        const startFull = dae.interner.resolve(dae.getExprLeft(startId)) ?? "";
        const lastDot = startFull.lastIndexOf(".");
        if (lastDot > 0) {
          const enumPfx = startFull.slice(0, lastDot);
          const scopeId =
            flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId;
          const enumInfo = resolveEnumType(enumPfx, scopeId, db);
          if (enumInfo) {
            const sOrd = dae.getExprData1(startId);
            const eOrd = dae.getExprData1(stopId);
            const elemIds: number[] = [];
            for (let ord = sOrd; ord <= eOrd; ord++) {
              const litName = enumInfo.literals[ord - 1];
              if (litName) {
                elemIds.push(dae.addEnumLiteral(ord, `${enumPfx}.${litName}`));
              }
            }
            return dae.addArrayCtorExpr(elemIds);
          }
        }
      }
      const isAnyReal = isRealExpr(startId, dae) || isRealExpr(stopId, dae);
      const effStartId = isAnyReal ? castToRealExpr(startId, dae) : startId;
      const effStopId = isAnyReal ? castToRealExpr(stopId, dae) : stopId;
      const rangeId = dae.addExpression(ExprKind.Range, effStartId, -1, effStopId);
      const isMulOperand = (() => {
        if (dae.classKind !== "function" || asDaeExt(dae).isEarlyInline) return false;
        let cur: SyntaxNode | null | undefined = node.parent;
        while (cur && (cur.childCount === 1 || (cur.childCount === 3 && cur.child(0)?.text?.trim() === "("))) {
          cur = cur.parent;
        }
        return Boolean(cur && cur.childCount === 3 && cur.child(1)?.text?.trim() === "*");
      })();
      const expanded = !isForIndex && !isMulOperand ? expandColonToArrayCtor(rangeId, dae) : null;
      return expanded !== null ? expanded : rangeId;
    }
  }
  if (
    node.childCount === 5 &&
    (node.child(1)?.type === ":" || node.child(1)?.text === ":" || node.child(1)?.type === '":"') &&
    (node.child(3)?.type === ":" || node.child(3)?.text === ":" || node.child(3)?.type === '":"')
  ) {
    const isForIndex = isInsideForIndex(node);
    const startId = lowerExpr(node.child(0), dae, prefix, substitutions, imports, db, flattener);
    const stepId = lowerExpr(node.child(2), dae, prefix, substitutions, imports, db, flattener);
    if (dae.getExprKind(stepId) === ExprKind.EnumLiteral && dae.getExprKind(startId) !== ExprKind.EnumLiteral) {
      let cur: SyntaxNode | null | undefined = node;
      while (
        cur &&
        cur.type !== "component_clause" &&
        cur.type !== "simple_equation" &&
        cur.type !== "statement" &&
        cur.type !== "assignment_statement"
      ) {
        cur = cur.parent;
      }
      const diagRange = getElementDiagRange(cur ?? node);
      const startText = node.child(0)?.text?.trim() ?? "1";
      const stepText = node.child(2)?.text?.trim() ?? "E.one";
      const startType = varTypeName(inferArenaExprVarType(dae, startId) ?? VarType.Real);
      let enumTypeStr = "enumeration E(one, two, three)";
      const dotIdx = stepText.lastIndexOf(".");
      const enumPfx = dotIdx > 0 ? stepText.slice(0, dotIdx).trim() : stepText;
      const scopeId =
        flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId;
      const enumInfo = resolveEnumType(enumPfx, scopeId, db);
      if (enumInfo) {
        const simpleName = enumInfo.qual.includes(".") ? enumInfo.qual.split(".").pop()! : enumInfo.qual;
        enumTypeStr = `enumeration ${simpleName}(${enumInfo.literals.join(", ")})`;
      }
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
        message: `Type mismatch in range: '${startText}' of type\n  ${startType}\nis not type compatible with '${stepText}' of type\n  ${enumTypeStr}`,
        range: diagRange,
      });
      return -1;
    }
    const stopId = lowerExpr(node.child(4), dae, prefix, substitutions, imports, db, flattener);
    if (dae.getExprKind(startId) === ExprKind.EnumLiteral || dae.getExprKind(stopId) === ExprKind.EnumLiteral) {
      let eqNode: SyntaxNode | null | undefined = node;
      while (
        eqNode &&
        eqNode.type !== "simple_equation" &&
        eqNode.type !== "component_clause" &&
        eqNode.type !== "statement" &&
        eqNode.type !== "assignment_statement"
      ) {
        eqNode = eqNode.parent;
      }
      const diagNode = eqNode ?? node;
      const startB = diagNode?.startIndex ?? diagNode?.startOffset;
      const endB = diagNode?.endIndex ?? diagNode?.endOffset;
      const range =
        startB != null && endB != null
          ? {
              startOffset: startB,
              endOffset: endB,
              startPosition: diagNode?.startPosition,
              endPosition: diagNode?.endPosition,
            }
          : undefined;

      let enumTypeStr = "E";
      const startText = node.child(0)?.text?.trim() ?? "";
      const dotIdx = startText.lastIndexOf(".");
      const enumPfx = dotIdx > 0 ? startText.slice(0, dotIdx).trim() : startText;
      const scopeId =
        flattener?.currentClassId ?? flattener?.currentRootClassId ?? getFlatteningState(dae).currentClassId;
      const enumInfo = resolveEnumType(enumPfx, scopeId, db);
      if (enumInfo) {
        const simpleName = enumInfo.qual.includes(".") ? enumInfo.qual.split(".").pop()! : enumInfo.qual;
        enumTypeStr = `${simpleName}(${enumInfo.literals.join(", ")})`;
      }
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.ENUM_RANGE_WITH_STEP.code,
        message: ModelicaErrorCode.ENUM_RANGE_WITH_STEP.message(enumTypeStr),
        range,
      });
      return -1;
    }
    const isAnyReal = isRealExpr(startId, dae) || isRealExpr(stepId, dae) || isRealExpr(stopId, dae);
    const effStartId = isAnyReal ? castToRealExpr(startId, dae) : startId;
    const effStepId = isAnyReal ? castToRealExpr(stepId, dae) : stepId;
    const effStopId = isAnyReal ? castToRealExpr(stopId, dae) : stopId;
    const rangeId = dae.addExpression(ExprKind.Range, effStartId, effStepId, effStopId);
    const isMulOperand = (() => {
      if (dae.classKind !== "function" || asDaeExt(dae).isEarlyInline) return false;
      let cur: SyntaxNode | null | undefined = node.parent;
      while (cur && (cur.childCount === 1 || (cur.childCount === 3 && cur.child(0)?.text?.trim() === "("))) {
        cur = cur.parent;
      }
      return Boolean(cur && cur.childCount === 3 && cur.child(1)?.text?.trim() === "*");
    })();
    const expanded = !isForIndex && !isMulOperand ? expandColonToArrayCtor(rangeId, dae) : null;
    return expanded !== null ? expanded : rangeId;
  }

  return null;
}

export function lowerIfElseCSTExpression(
  node: SyntaxNode,
  firstChildToken: string,
  dae: DAEBuilder,
  ctx: LoweringContext,
  lowerExpr: LowerExprFn,
): number | null {
  const { prefix = "", substitutions, imports, db, flattener } = ctx;
  // If-Else expression: if cond then e1 [elseif cond2 then e2 ...] else e_last
  if (firstChildToken === "if" && node.childCount >= 6) {
    const branches: { condNode: SyntaxNode | null; thenNode: SyntaxNode | null }[] = [
      { condNode: node.child(1), thenNode: node.child(3) },
    ];
    let i = 4;
    while (i < node.childCount) {
      const tok = node.child(i)?.text?.trim() ?? node.child(i)?.type ?? "";
      const tokClean = stripOuterDoubleQuotes(tok);
      if (tokClean === "elseif" && i + 3 < node.childCount) {
        branches.push({ condNode: node.child(i + 1), thenNode: node.child(i + 3) });
        i += 4;
      } else if (tokClean === "else" && i + 1 < node.childCount) {
        break;
      } else {
        i++;
      }
    }
    const elseNode = node.child(node.childCount - 1);

    // If static condition evaluates to true, only lower that branch
    const loweredConds: { condId: number; condVal: unknown }[] = [];
    let takenBranchIdx = -1;
    let allFalseSoFar = true;
    const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
    const hasBranchDer =
      !isOldFrontend && (branches.some((br) => cstHasDerCall(br.thenNode)) || cstHasDerCall(elseNode));
    for (let b = 0; b < branches.length; b++) {
      const condId = lowerExpr(branches[b]!.condNode, dae, prefix, substitutions, imports, db, flattener);
      const isRuntimeParam = hasBranchDer
        ? false
        : isOldFrontend && !prefix
          ? exprReferencesEnumParameter(condId, dae)
          : exprReferencesRuntimeParameter(condId, dae, new Set(), Boolean(isOldFrontend && prefix));
      if (isRuntimeParam) {
        loweredConds.push({ condId, condVal: null });
        allFalseSoFar = false;
        break;
      }
      const condVal = evalDaeExpr(condId, dae);
      if (hasBranchDer && (condVal === true || condVal === 1 || condVal === false || condVal === 0)) {
        const condVars = new Set<string>();
        dae.collectExprVarNames(condId, condVars);
        for (const vName of condVars) {
          const vIdx = dae.getVarIdxByName(vName);
          if (vIdx >= 0 && dae.getVarVariability(vIdx) === Variability.Parameter) {
            dae.setVarFinal(vIdx, true);
          }
        }
      }
      if (condVal === true || condVal === 1) {
        takenBranchIdx = b;
        allFalseSoFar = false;
        break;
      } else if (condVal === false || condVal === 0) {
        loweredConds.push({ condId, condVal });
        // condition is false, continue to next branch
      } else {
        loweredConds.push({ condId, condVal: null });
        allFalseSoFar = false;
        break;
      }
    }

    if (takenBranchIdx >= 0) {
      return lowerExpr(branches[takenBranchIdx]!.thenNode, dae, prefix, substitutions, imports, db, flattener);
    }
    if (allFalseSoFar && loweredConds.length === branches.length) {
      return lowerExpr(elseNode, dae, prefix, substitutions, imports, db, flattener);
    }

    let currElseId = lowerExpr(elseNode, dae, prefix, substitutions, imports, db, flattener);

    for (let b = branches.length - 1; b >= 0; b--) {
      if (b < loweredConds.length && (loweredConds[b]!.condVal === false || loweredConds[b]!.condVal === 0)) {
        continue;
      }
      const branch = branches[b]!;
      const condId =
        b < loweredConds.length
          ? loweredConds[b]!.condId
          : lowerExpr(branch.condNode, dae, prefix, substitutions, imports, db, flattener);
      let thenId = lowerExpr(branch.thenNode, dae, prefix, substitutions, imports, db, flattener);
      if (isRealExpr(thenId, dae) && !isRealExpr(currElseId, dae)) {
        currElseId = castToRealExpr(currElseId, dae);
      } else if (!isRealExpr(thenId, dae) && isRealExpr(currElseId, dae)) {
        thenId = castToRealExpr(thenId, dae);
      }
      const thenDims = getExprDims(thenId, dae, db);
      const elseDims = getExprDims(currElseId, dae, db);
      if (
        thenDims &&
        elseDims &&
        (thenDims.length !== elseDims.length || thenDims.some((d, i) => d > 0 && elseDims[i]! > 0 && d !== elseDims[i]))
      ) {
        const cVal = evalDaeExpr(condId, dae);
        if (cVal === true || cVal === 1 || cVal === false || cVal === 0) {
          const markParamsFinal = (id: number): void => {
            if (id < 0) return;
            const k = dae.getExprKind(id);
            if (k === ExprKind.Name) {
              const nm = dae.interner.resolve(dae.getExprData1(id));
              if (nm) {
                const vIdx = dae.lookupVariable(nm);
                if (vIdx >= 0 && dae.getVarVariability(vIdx) === Variability.Parameter) {
                  dae.setVarFinal(vIdx, true);
                }
              }
            } else if (k === ExprKind.Binary || k === ExprKind.Subscript) {
              markParamsFinal(dae.getExprLeft(id));
              markParamsFinal(dae.getExprRight(id));
            } else if (k === ExprKind.Unary || k === ExprKind.Negate) {
              markParamsFinal(dae.getExprLeft(id));
            }
          };
          markParamsFinal(condId);
          currElseId = cVal === true || cVal === 1 ? thenId : currElseId;
          continue;
        }
      }
      if (
        thenId >= 0 &&
        currElseId >= 0 &&
        dae.getExprKind(thenId) === ExprKind.EnumLiteral &&
        dae.getExprKind(currElseId) === ExprKind.EnumLiteral &&
        dae.getExprData1(thenId) === dae.getExprData1(currElseId) &&
        dae.getExprLeft(thenId) === dae.getExprLeft(currElseId)
      ) {
        continue;
      }
      currElseId = dae.addExpression(ExprKind.IfElse, condId, thenId, currElseId);
    }
    return currElseId;
  }

  return null;
}
