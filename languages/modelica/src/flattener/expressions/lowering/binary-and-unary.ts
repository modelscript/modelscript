// SPDX-License-Identifier: AGPL-3.0-or-later

import { ExprKind } from "@modelscript/dsl";
import { BinOp, DAEBuilder, inferArenaExprVarType, UnaryOp, Variability, VarType } from "@modelscript/runtime";
import { type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import { getFlatteningState, setExprArrayShape } from "../../support/state.js";
import type { LoweringContext } from "../../types.js";
import {
  addArrayBinaryExpr,
  areExpressionsEqual,
  broadcastElemBinOp,
  dispatchBinaryOperator,
  dispatchUnaryOperator,
  exprsEqual,
  getArrayCtorElements,
  getOperatorNameForBinOp,
  matrixOrVectorMul,
  matrixPower,
  mulWithSimplification,
  negateExpr,
  resolveOperatorRecord,
  simplifyTrigonometricBinary,
} from "../binary-ops.js";
import {
  expandVarToArrayCtor,
  isDottedIdentifierChain,
  resolveEnumType,
  resolveScopedName,
  stripOuterDoubleQuotes,
} from "../cst-utils.js";
import { castToRealExpr, evalDaeExpr, getExprDims, isRealExpr } from "../eval.js";

import type { LowerExprFn, SymbolMetaLike } from "./types.js";

export function finishBinaryCSTExpression(
  node: SyntaxNode,
  binOp: BinOp,
  opToken: string,
  leftNode: SyntaxNode | null | undefined,
  rightNode: SyntaxNode | null | undefined,
  leftId: number,
  rightId: number,
  dae: DAEBuilder,
  ctx: LoweringContext,
): number {
  const { prefix = "", db, flattener, tupleContext, isAssignmentLhs } = ctx;
  {
    {
      if (
        (binOp === BinOp.Eq ||
          binOp === BinOp.Neq ||
          binOp === BinOp.Lt ||
          binOp === BinOp.Lte ||
          binOp === BinOp.Gt ||
          binOp === BinOp.Gte) &&
        leftNode &&
        (() => {
          let cur: SyntaxNode | null | undefined = leftNode;
          while (cur && cur.childCount === 1) cur = cur.child(0);
          return cur?.type === "expression" && cur.childCount === 2 && cur.child(0)?.text?.trim() === "not";
        })() &&
        dae.getExprKind(leftId) === ExprKind.Unary &&
        dae.getExprData1(leftId) === UnaryOp.Not
      ) {
        const innerLeft = dae.getExprLeft(leftId);
        return dae.addExpression(ExprKind.Unary, UnaryOp.Not, dae.addBinaryExpr(binOp, innerLeft, rightId));
      }
      // 1. Operator record overload resolution (`operator '+'`, `operator '*'`, etc.):
      //    If either operand is an `operator record`, dispatch to the matching overloaded operator function.
      if (db && flattener) {
        const opName = getOperatorNameForBinOp(binOp);
        if (opName) {
          const dispatched = dispatchBinaryOperator(opName, leftId, rightId, leftNode, rightNode, dae, db, flattener);
          if (dispatched !== null) return dispatched;
        }
      }
      // 2. Element-wise binary operators (`.+`, `.-`, `.*`, `./`, `.^`):
      //    Expand scalarized array variable references into `ArrayCtor` trees and broadcast element-wise.
      if (
        binOp === BinOp.ElemAdd ||
        binOp === BinOp.ElemSub ||
        binOp === BinOp.ElemMul ||
        binOp === BinOp.ElemDiv ||
        binOp === BinOp.ElemPow
      ) {
        if (db && flattener) {
          const hasOpRec = (id: number, n?: SyntaxNode | null): boolean => {
            if (id < 0) return false;
            if (resolveOperatorRecord(id, n ?? null, dae, db, flattener) !== null) return true;
            if (dae.getExprKind(id) === ExprKind.Binary) {
              return hasOpRec(dae.getExprLeft(id)) || hasOpRec(dae.getExprRight(id));
            }
            return false;
          };
          if (hasOpRec(leftId, leftNode) || hasOpRec(rightId, rightNode)) {
            return dae.addBinaryExpr(binOp, leftId, rightId);
          }
        }
        if (dae.getExprKind(leftId) === ExprKind.Name) {
          const lName = dae.interner.resolve(dae.getExprData1(leftId));
          if (lName && dae.hasArrayElements(lName)) {
            const lCtor = expandVarToArrayCtor(lName, dae);
            if (lCtor !== null) leftId = lCtor;
          }
        }
        if (dae.getExprKind(rightId) === ExprKind.Name) {
          const rName = dae.interner.resolve(dae.getExprData1(rightId));
          if (rName && dae.hasArrayElements(rName)) {
            const rCtor = expandVarToArrayCtor(rName, dae);
            if (rCtor !== null) rightId = rCtor;
          }
        }
        let baseOp = BinOp.Add;
        if (binOp === BinOp.ElemSub) baseOp = BinOp.Sub;
        else if (binOp === BinOp.ElemMul) baseOp = BinOp.Mul;
        else if (binOp === BinOp.ElemDiv) baseOp = BinOp.Div;
        else if (binOp === BinOp.ElemPow) baseOp = BinOp.Pow;
        return broadcastElemBinOp(binOp, baseOp, leftId, rightId, dae, flattener, true);
      }
      if (binOp === BinOp.Eq || binOp === BinOp.Neq) {
        if (
          db &&
          ((dae.getExprKind(leftId) === ExprKind.Name && dae.getExprKind(rightId) === ExprKind.EnumLiteral) ||
            (dae.getExprKind(rightId) === ExprKind.Name && dae.getExprKind(leftId) === ExprKind.EnumLiteral))
        ) {
          const fnExprId = dae.getExprKind(leftId) === ExprKind.Name ? leftId : rightId;
          const enumExprId = dae.getExprKind(leftId) === ExprKind.EnumLiteral ? leftId : rightId;
          const fnNameStr = dae.interner.resolve(dae.getExprData1(fnExprId));
          if (fnNameStr && dae.getVarIdxByName(fnNameStr) < 0) {
            const fnShort = fnNameStr.split(".").pop()!;
            const fnSym = db
              .byName(fnShort)
              .find(
                (s) =>
                  s.kind === "Function" ||
                  (s.metadata as SymbolMetaLike | undefined)?.classPrefixes?.includes("function"),
              );
            if (fnSym) {
              const enumPath = dae.interner.resolve(dae.getExprLeft(enumExprId));
              const enumTypeName = enumPath.slice(0, enumPath.lastIndexOf("."));
              const scopeId = flattener?.currentClassId ?? flattener?.currentRootClassId ?? undefined;
              const enumInfo = resolveEnumType(enumTypeName, scopeId, db);
              const litsStr = enumInfo ? enumInfo.literals.join(", ") : "";
              const leftTypeStr =
                fnExprId === leftId ? `.${fnShort}<function>() => #enumeration(${litsStr})` : `enumeration(${litsStr})`;
              const rightTypeStr =
                fnExprId === rightId
                  ? `.${fnShort}<function>() => #enumeration(${litsStr})`
                  : `enumeration(${litsStr})`;
              let stmtNode: SyntaxNode | null | undefined = node;
              while (
                stmtNode?.parent &&
                stmtNode.type !== "if_statement" &&
                stmtNode.type !== "statement" &&
                stmtNode.type !== "simple_equation" &&
                stmtNode.type !== "equation"
              ) {
                stmtNode = stmtNode.parent;
              }
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.BINARY_OP_TYPE_MISMATCH.code,
                message: `Cannot resolve type of expression ${leftNode?.text?.trim()} ${opToken} ${rightNode?.text?.trim()}. The operands have types ${leftTypeStr}, ${rightTypeStr} in component <NO COMPONENT>.`,
                range: {
                  startOffset: stmtNode?.startIndex ?? stmtNode?.startOffset ?? node.startIndex,
                  endOffset: stmtNode?.endIndex ?? stmtNode?.endOffset ?? node.endIndex,
                  startPosition: stmtNode?.startPosition ?? node.startPosition,
                  endPosition: stmtNode?.endPosition ?? node.endPosition,
                },
              });
              return -1;
            }
          }
        }
        const leftType = inferArenaExprVarType(dae, leftId);
        const rightType = inferArenaExprVarType(dae, rightId);
        if (leftType === VarType.Enumeration && rightType === VarType.Integer) {
          const val = dae.getExprKind(rightId) === ExprKind.IntLiteral ? dae.getExprData1(rightId) : null;
          if (val !== null && dae.getExprKind(leftId) === ExprKind.Name) {
            const nameId = dae.getExprData1(leftId);
            let vIdx = dae.lookupVariable(nameId);
            if (vIdx < 0) {
              const nameStr = dae.interner.resolve(nameId);
              if (nameStr) vIdx = dae.getVarIdxByName(nameStr);
            }
            if (vIdx >= 0) {
              const lits = dae.getVarEnumerationLiterals(vIdx);
              const cType = dae.getVarCustomType(vIdx);
              if (lits && val >= 1 && val <= lits.length) {
                const lit = lits[val - 1] as string | { stringValue?: string; name?: string };
                const litName = typeof lit === "string" ? lit : (lit.stringValue ?? lit.name ?? String(lit));
                const varName = dae.getVarName(vIdx);
                const enumPrefix =
                  flattener?.options?.omcCompatibility && varName ? `${cType ?? ""}$${varName}` : (cType ?? "");
                const fullLit = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                rightId = dae.addEnumLiteral(val, fullLit);
              }
            }
          }
        } else if (leftType === VarType.Integer && rightType === VarType.Enumeration) {
          const val = dae.getExprKind(leftId) === ExprKind.IntLiteral ? dae.getExprData1(leftId) : null;
          if (val !== null && dae.getExprKind(rightId) === ExprKind.Name) {
            const nameId = dae.getExprData1(rightId);
            let vIdx = dae.lookupVariable(nameId);
            if (vIdx < 0) {
              const nameStr = dae.interner.resolve(nameId);
              if (nameStr) vIdx = dae.getVarIdxByName(nameStr);
            }
            if (vIdx >= 0) {
              const lits = dae.getVarEnumerationLiterals(vIdx);
              const cType = dae.getVarCustomType(vIdx);
              if (lits && val >= 1 && val <= lits.length) {
                const lit = lits[val - 1] as string | { stringValue?: string; name?: string };
                const litName = typeof lit === "string" ? lit : (lit.stringValue ?? lit.name ?? String(lit));
                const varName = dae.getVarName(vIdx);
                const enumPrefix =
                  flattener?.options?.omcCompatibility && varName ? `${cType ?? ""}$${varName}` : (cType ?? "");
                const fullLit = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                leftId = dae.addEnumLiteral(val, fullLit);
              }
            }
          }
        }
      }
      if (binOp === BinOp.Mul || binOp === BinOp.Add || binOp === BinOp.Sub) {
        if (dae.getExprKind(leftId) === ExprKind.Name) {
          const lName = dae.interner.resolve(dae.getExprData1(leftId));
          if (
            lName &&
            dae.hasArrayElements(lName) &&
            !(dae.classKind === "function" && flattener?.currentBindingCompName === lName)
          ) {
            const lCtor = expandVarToArrayCtor(lName, dae);
            if (lCtor !== null) leftId = lCtor;
          }
        }
        if (dae.getExprKind(rightId) === ExprKind.Name) {
          const rName = dae.interner.resolve(dae.getExprData1(rightId));
          if (
            rName &&
            dae.hasArrayElements(rName) &&
            !(dae.classKind === "function" && flattener?.currentBindingCompName === rName)
          ) {
            const rCtor = expandVarToArrayCtor(rName, dae);
            if (rCtor !== null) rightId = rCtor;
          }
        }
      }
      const isArithmeticOp =
        binOp === BinOp.Add || binOp === BinOp.Sub || binOp === BinOp.Mul || binOp === BinOp.Div || binOp === BinOp.Pow;

      if (isArithmeticOp) {
        const lType = inferArenaExprVarType(dae, leftId);
        const rType = inferArenaExprVarType(dae, rightId);
        const isLNonNumeric =
          lType === VarType.Boolean ||
          lType === VarType.String ||
          dae.getExprKind(leftId) === ExprKind.BoolLiteral ||
          dae.getExprKind(leftId) === ExprKind.StringLiteral;
        const isRNonNumeric =
          rType === VarType.Boolean ||
          rType === VarType.String ||
          dae.getExprKind(rightId) === ExprKind.BoolLiteral ||
          dae.getExprKind(rightId) === ExprKind.StringLiteral;
        const isStringAdd =
          binOp === BinOp.Add &&
          (lType === VarType.String || dae.getExprKind(leftId) === ExprKind.StringLiteral) &&
          (rType === VarType.String || dae.getExprKind(rightId) === ExprKind.StringLiteral);
        if (
          isStringAdd &&
          dae.getExprKind(leftId) === ExprKind.StringLiteral &&
          dae.getExprKind(rightId) === ExprKind.StringLiteral
        ) {
          const s1 = dae.interner.resolve(dae.getExprData1(leftId)) ?? "";
          const s2 = dae.interner.resolve(dae.getExprData1(rightId)) ?? "";
          return dae.addStringLiteral(s1 + s2);
        }

        if (!isStringAdd && (isLNonNumeric || isRNonNumeric)) {
          const getOperandFullTypeStr = (id: number): string => {
            const t = inferArenaExprVarType(dae, id);
            if (t === VarType.Integer || dae.getExprKind(id) === ExprKind.IntLiteral) return "Integer";
            if (t === VarType.Boolean || dae.getExprKind(id) === ExprKind.BoolLiteral) return "Boolean";
            if (t === VarType.String || dae.getExprKind(id) === ExprKind.StringLiteral) return "String";
            return "Real";
          };
          const leftTypeStr = getOperandFullTypeStr(leftId);
          const rightTypeStr = getOperandFullTypeStr(rightId);
          const rawExpr = `${node.child(0)?.text?.trim() ?? ""}${opToken}${node.child(2)?.text?.trim() ?? ""}`;
          const startB = node.startIndex ?? node.startOffset;
          const endB = node.endIndex ?? node.endOffset;
          dae.diagnostics.push({
            severity: "error",
            message: `Cannot resolve type of expression ${rawExpr}. The operands have types ${leftTypeStr}, ${rightTypeStr} in component <NO COMPONENT>.`,
            range: {
              startOffset: startB,
              endOffset: endB,
              startPosition: node.startPosition,
              endPosition: node.endPosition,
            },
          });
          return -1;
        }
      }

      if (binOp === BinOp.Add || binOp === BinOp.Sub) {
        const leftDims = getExprDims(leftId, dae, flattener?.db);
        const rightDims = getExprDims(rightId, dae, flattener?.db);
        const hasLeftDims = leftDims !== null && leftDims.length > 0;
        const hasRightDims = rightDims !== null && rightDims.length > 0;
        const isKnownScalar = (id: number): boolean => {
          const k = dae.getExprKind(id);
          if (
            k === ExprKind.RealLiteral ||
            k === ExprKind.IntLiteral ||
            k === ExprKind.BoolLiteral ||
            k === ExprKind.StringLiteral
          ) {
            return true;
          }
          if (k === ExprKind.Name) {
            const nameId = dae.getExprData1(id);
            const name = dae.interner.resolve(nameId);
            if (name && !dae.hasArrayElements(name)) {
              const vIdx = dae.getVarIdxByName(name);
              if (vIdx >= 0) {
                const shape = dae.getVarShape(vIdx);
                return !shape || shape.length === 0;
              }
            }
          }
          return false;
        };

        const leftKnownScalar = isKnownScalar(leftId);
        const rightKnownScalar = isKnownScalar(rightId);

        const dimensionMismatch =
          (hasLeftDims &&
            hasRightDims &&
            (leftDims!.length !== rightDims!.length ||
              leftDims!.some((d, i) => d > 0 && rightDims![i]! > 0 && d !== rightDims![i]))) ||
          (hasLeftDims && rightKnownScalar) ||
          (hasRightDims && leftKnownScalar);

        if (dimensionMismatch) {
          const getOperandFullTypeStr = (id: number, dims: number[] | null): string => {
            const t = inferArenaExprVarType(dae, id);
            let baseType = "Real";
            if (t === VarType.Integer || dae.getExprKind(id) === ExprKind.IntLiteral) baseType = "Integer";
            else if (t === VarType.Boolean || dae.getExprKind(id) === ExprKind.BoolLiteral) baseType = "Boolean";
            else if (t === VarType.String || dae.getExprKind(id) === ExprKind.StringLiteral) baseType = "String";
            if (dims && dims.length > 0) {
              return `${baseType}[${dims.join(", ")}]`;
            }
            return baseType;
          };
          const leftTypeStr = getOperandFullTypeStr(leftId, leftDims);
          const rightTypeStr = getOperandFullTypeStr(rightId, rightDims);
          const exprText = `${node.child(0)?.text?.trim() ?? ""} ${opToken} ${node.child(2)?.text?.trim() ?? ""}`;
          const startB = node.startIndex ?? node.startOffset;
          const endB = node.endIndex ?? node.endOffset;
          dae.diagnostics.push({
            severity: "error",
            message: `Cannot resolve type of expression ${exprText}. The operands have types ${leftTypeStr}, ${rightTypeStr} in component <NO COMPONENT>.`,
            range: {
              startOffset: startB,
              endOffset: endB,
              startPosition: node.startPosition,
              endPosition: node.endPosition,
            },
          });
          return -1;
        }
      }
      if (binOp === BinOp.Add) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addIntLiteral(dae.getExprData1(leftId) + dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) + dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprData1(leftId) + dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) + dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.ArrayCtor && rightKind === ExprKind.ArrayCtor) {
          const leftElems = getArrayCtorElements(leftId, dae);
          const rightElems = getArrayCtorElements(rightId, dae);
          if (leftElems.length === rightElems.length) {
            if (leftElems.length === 0) return dae.addArrayCtorExpr([]);
            const newElems = leftElems.map((e, i) => addArrayBinaryExpr(BinOp.Add, e, rightElems[i]!, dae));
            return dae.addArrayCtorExpr(newElems);
          }
        }
        if (
          (inferArenaExprVarType(dae, leftId) === VarType.String || leftKind === ExprKind.StringLiteral) &&
          (inferArenaExprVarType(dae, rightId) === VarType.String || rightKind === ExprKind.StringLiteral)
        ) {
          return dae.addBinaryExpr(BinOp.Add, leftId, rightId);
        }
        const leftDims = getExprDims(leftId, dae, flattener?.db);
        const rightDims = getExprDims(rightId, dae, flattener?.db);
        if (leftDims && rightDims && leftDims.length === 2 && rightDims.length === 2) {
          const [M1, N1] = leftDims;
          const [M2, N2] = rightDims;
          if (M1 === M2 && N1 === N2 && (M1 === 0 || N1 === 0)) {
            const resRows: number[] = [];
            for (let i = 0; i < M1!; i++) {
              resRows.push(dae.addArrayCtorExpr([]));
            }
            return dae.addArrayCtorExpr(resRows);
          }
        }
      }
      if (binOp === BinOp.Sub) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addIntLiteral(dae.getExprData1(leftId) - dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) - dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprData1(leftId) - dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) - dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.ArrayCtor && rightKind === ExprKind.ArrayCtor) {
          const leftElems = getArrayCtorElements(leftId, dae);
          const rightElems = getArrayCtorElements(rightId, dae);
          if (leftElems.length === rightElems.length) {
            if (leftElems.length === 0) return dae.addArrayCtorExpr([]);
            const newElems = leftElems.map((e, i) => addArrayBinaryExpr(BinOp.Sub, e, rightElems[i]!, dae));
            return dae.addArrayCtorExpr(newElems);
          }
        }
        const leftDimsSub = getExprDims(leftId, dae, flattener?.db);
        const rightDimsSub = getExprDims(rightId, dae, flattener?.db);
        if (leftDimsSub && rightDimsSub && leftDimsSub.length === 2 && rightDimsSub.length === 2) {
          const [M1, N1] = leftDimsSub;
          const [M2, N2] = rightDimsSub;
          if (M1 === M2 && N1 === N2 && (M1 === 0 || N1 === 0)) {
            const resRows: number[] = [];
            for (let i = 0; i < M1!; i++) {
              resRows.push(dae.addArrayCtorExpr([]));
            }
            return dae.addArrayCtorExpr(resRows);
          }
        }
        if (
          flattener?.options?.omcCompatibility &&
          (rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral)
        ) {
          const isReal = isRealExpr(leftId, dae) || rightKind === ExprKind.RealLiteral;
          const rVal = rightKind === ExprKind.RealLiteral ? dae.getExprRealValue(rightId) : dae.getExprData1(rightId);
          const negLitId = isReal ? dae.addRealLiteral(-rVal) : dae.addIntLiteral(-Math.round(rVal));
          const realLeftId = isReal && !isRealExpr(leftId, dae) ? castToRealExpr(leftId, dae) : leftId;
          return dae.addBinaryExpr(BinOp.Add, negLitId, realLeftId);
        }
        if (
          flattener?.options?.omcCompatibility &&
          dae.classKind === "function" &&
          rightKind === ExprKind.Binary &&
          dae.getExprData1(rightId) === BinOp.Add
        ) {
          const addL = dae.getExprLeft(rightId);
          const addR = dae.getExprRight(rightId);
          if (
            dae.getExprKind(addL) === ExprKind.Name &&
            dae.getExprKind(addR) === ExprKind.Binary &&
            dae.getExprData1(addR) === BinOp.Mul
          ) {
            const negAddL = dae.addUnaryExpr(UnaryOp.Negate, addL);
            const firstAdd = dae.addBinaryExpr(BinOp.Add, leftId, negAddL);
            return dae.addBinaryExpr(BinOp.Sub, firstAdd, addR);
          }
        }
        const negateLeadingMulDivLiteral = (id: number): number | null => {
          if (id < 0 || dae.getExprKind(id) !== ExprKind.Binary) return null;
          const op = dae.getExprData1(id) as BinOp;
          if (op === BinOp.Mul) {
            const mulL = dae.getExprLeft(id);
            const mulR = dae.getExprRight(id);
            const mulLKind = dae.getExprKind(mulL);
            const mulRKind = dae.getExprKind(mulR);
            if (mulLKind === ExprKind.RealLiteral) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-dae.getExprRealValue(mulL)), mulR);
            }
            if (mulLKind === ExprKind.IntLiteral) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addIntLiteral(-dae.getExprData1(mulL)), mulR);
            }
            if (mulRKind === ExprKind.RealLiteral) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-dae.getExprRealValue(mulR)), mulL);
            }
            if (mulRKind === ExprKind.IntLiteral) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addIntLiteral(-dae.getExprData1(mulR)), mulL);
            }
            if (Boolean(dae.extensionMetadata?.["isOldFrontend"]) && dae.classKind === "function") {
              if (mulLKind === ExprKind.Binary && (dae.getExprData1(mulL) as BinOp) === BinOp.Sub) {
                const negSubL = negateLeadingMulDivLiteral(dae.getExprLeft(mulL));
                if (negSubL !== null) {
                  return dae.addBinaryExpr(
                    BinOp.Mul,
                    dae.addBinaryExpr(BinOp.Add, dae.getExprRight(mulL), negSubL),
                    mulR,
                  );
                }
              }
              const negL = negateLeadingMulDivLiteral(mulL);
              if (negL !== null) return dae.addBinaryExpr(BinOp.Mul, negL, mulR);
            }
          } else if (
            op === BinOp.Div &&
            Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
            dae.classKind === "function"
          ) {
            const negL = negateLeadingMulDivLiteral(dae.getExprLeft(id));
            if (negL !== null) return dae.addBinaryExpr(BinOp.Div, negL, dae.getExprRight(id));
          }
          return null;
        };
        const negRight = negateLeadingMulDivLiteral(rightId);
        if (negRight !== null) {
          binOp = BinOp.Add;
          rightId = negRight;
        }
      }
      if (binOp === BinOp.Mul) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addIntLiteral(dae.getExprData1(leftId) * dae.getExprData1(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) * dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.IntLiteral && rightKind === ExprKind.RealLiteral) {
          return dae.addRealLiteral(dae.getExprData1(leftId) * dae.getExprRealValue(rightId));
        }
        if (leftKind === ExprKind.RealLiteral && rightKind === ExprKind.IntLiteral) {
          return dae.addRealLiteral(dae.getExprRealValue(leftId) * dae.getExprData1(rightId));
        }
        const leftDims = getExprDims(leftId, dae, flattener?.db, flattener);
        const rightDims = getExprDims(rightId, dae, flattener?.db, flattener);
        if (leftDims && rightDims) {
          // Matrix * Matrix: [M, K1] * [K2, N]
          if (leftDims.length === 2 && rightDims.length === 2 && leftDims[1] === rightDims[0]) {
            const [M, K] = leftDims;
            const [, N] = rightDims;
            if (K === 0 || M === 0 || N === 0) {
              if (M === 0) {
                const res = dae.addArrayCtorExpr([]);
                setExprArrayShape(dae, res, [0, N!]);
                return res;
              }
              const zeroLit = dae.addRealLiteral(0.0);
              const resRows: number[] = [];
              for (let i = 0; i < M!; i++) {
                const rowElems: number[] = [];
                for (let j = 0; j < N!; j++) {
                  rowElems.push(zeroLit);
                }
                resRows.push(dae.addArrayCtorExpr(rowElems));
              }
              const res = dae.addArrayCtorExpr(resRows);
              setExprArrayShape(dae, res, [M!, N!]);
              return res;
            }
          }
          // Matrix * Vector: [M, K1] * [K2]
          if (leftDims.length === 2 && rightDims.length === 1 && leftDims[1] === rightDims[0]) {
            const [M, K] = leftDims;
            if (M === 0) {
              const res = dae.addArrayCtorExpr([]);
              setExprArrayShape(dae, res, [0]);
              return res;
            }
            if (K === 0) {
              const zeroLit = dae.addRealLiteral(0.0);
              const resElems: number[] = [];
              for (let i = 0; i < M!; i++) resElems.push(zeroLit);
              const res = dae.addArrayCtorExpr(resElems);
              setExprArrayShape(dae, res, [M!]);
              return res;
            }
          }
          // Vector * Matrix: [K1] * [K2, N]
          if (leftDims.length === 1 && rightDims.length === 2 && leftDims[0] === rightDims[0]) {
            const [, N] = rightDims;
            const K = leftDims[0]!;
            if (N === 0) {
              const res = dae.addArrayCtorExpr([]);
              setExprArrayShape(dae, res, [0]);
              return res;
            }
            if (K === 0) {
              const zeroLit = dae.addRealLiteral(0.0);
              const resElems: number[] = [];
              for (let i = 0; i < N!; i++) resElems.push(zeroLit);
              const res = dae.addArrayCtorExpr(resElems);
              setExprArrayShape(dae, res, [N!]);
              return res;
            }
          }
          // Vector * Vector: [K1] * [K2]
          if (leftDims.length === 1 && rightDims.length === 1 && leftDims[0] === rightDims[0]) {
            if (leftDims[0] === 0) return dae.addRealLiteral(0.0);
          }
        }
        const makeMul = (l: number, r: number) => {
          return mulWithSimplification(l, r, dae);
        };
        let effectiveLeftId = leftId;
        let effectiveLeftKind = leftKind;
        if (effectiveLeftKind !== ExprKind.ArrayCtor && leftDims && leftDims.length > 0) {
          const lName =
            dae.getExprKind(effectiveLeftId) === ExprKind.Name
              ? dae.interner.resolve(dae.getExprData1(effectiveLeftId))
              : null;
          if (lName && !(dae.classKind === "function" && flattener?.currentBindingCompName === lName)) {
            const exp = expandVarToArrayCtor(lName, dae);
            if (exp !== null) {
              effectiveLeftId = exp;
              effectiveLeftKind = dae.getExprKind(effectiveLeftId);
            }
          }
        }
        let effectiveRightId = rightId;
        let effectiveRightKind = rightKind;
        if (effectiveRightKind !== ExprKind.ArrayCtor && rightDims && rightDims.length > 0) {
          const rName =
            dae.getExprKind(effectiveRightId) === ExprKind.Name
              ? dae.interner.resolve(dae.getExprData1(effectiveRightId))
              : null;
          if (rName && !(dae.classKind === "function" && flattener?.currentBindingCompName === rName)) {
            const exp = expandVarToArrayCtor(rName, dae);
            if (exp !== null) {
              effectiveRightId = exp;
              effectiveRightKind = dae.getExprKind(effectiveRightId);
            }
          } else if (effectiveRightKind === ExprKind.Call) {
            const rVal = evalDaeExpr(effectiveRightId, dae);
            if (Array.isArray(rVal) && rVal.length > 0 && rVal.every((x) => typeof x === "number")) {
              effectiveRightId = dae.addArrayCtorExpr(rVal.map((x) => dae.addRealLiteral(x as number)));
              effectiveRightKind = ExprKind.ArrayCtor;
            }
          }
        }
        if (effectiveLeftKind === ExprKind.ArrayCtor && effectiveRightKind === ExprKind.ArrayCtor) {
          return matrixOrVectorMul(effectiveLeftId, effectiveRightId, dae);
        } else if (
          effectiveLeftKind !== ExprKind.ArrayCtor &&
          effectiveLeftKind !== ExprKind.Range &&
          !(effectiveLeftKind === ExprKind.Binary && dae.getExprData1(effectiveLeftId) === BinOp.Colon) &&
          leftDims &&
          leftDims.length > 0 &&
          effectiveRightKind === ExprKind.ArrayCtor &&
          rightDims &&
          rightDims.length > 0
        ) {
          const rRaw = rightNode?.text?.trim() ?? "";
          if (isDottedIdentifierChain(rRaw)) {
            rightId = dae.addNameExpr(resolveScopedName(rRaw, prefix, dae));
          }
        } else if (
          effectiveRightKind !== ExprKind.ArrayCtor &&
          effectiveRightKind !== ExprKind.Range &&
          !(effectiveRightKind === ExprKind.Binary && dae.getExprData1(effectiveRightId) === BinOp.Colon) &&
          rightDims &&
          rightDims.length > 0 &&
          effectiveLeftKind === ExprKind.ArrayCtor &&
          leftDims &&
          leftDims.length > 0
        ) {
          const lRaw = leftNode?.text?.trim() ?? "";
          if (isDottedIdentifierChain(lRaw)) {
            leftId = dae.addNameExpr(resolveScopedName(lRaw, prefix, dae));
          }
        } else if (
          effectiveLeftKind === ExprKind.ArrayCtor &&
          (effectiveRightKind === ExprKind.Range ||
            (effectiveRightKind === ExprKind.Binary && dae.getExprData1(effectiveRightId) === BinOp.Colon))
        ) {
          leftId = effectiveLeftId;
        } else if (
          effectiveRightKind === ExprKind.ArrayCtor &&
          (effectiveLeftKind === ExprKind.Range ||
            (effectiveLeftKind === ExprKind.Binary && dae.getExprData1(effectiveLeftId) === BinOp.Colon))
        ) {
          rightId = effectiveRightId;
        } else if (effectiveLeftKind === ExprKind.ArrayCtor && (!rightDims || rightDims.length === 0)) {
          // Vector/Matrix/ND-Array * Scalar
          const mulArrayByScalar = (arrId: number): number => {
            const elems = getArrayCtorElements(arrId, dae);
            if (elems.length > 0 && dae.getExprKind(elems[0]!) === ExprKind.ArrayCtor) {
              return dae.addArrayCtorExpr(elems.map((e) => mulArrayByScalar(e)));
            }
            return dae.addArrayCtorExpr(elems.map((e) => makeMul(e, effectiveRightId)));
          };
          return mulArrayByScalar(effectiveLeftId);
        } else if (effectiveRightKind === ExprKind.ArrayCtor && (!leftDims || leftDims.length === 0)) {
          // Scalar * Vector/Matrix/ND-Array
          const mulScalarByArray = (arrId: number): number => {
            const elems = getArrayCtorElements(arrId, dae);
            if (elems.length > 0 && dae.getExprKind(elems[0]!) === ExprKind.ArrayCtor) {
              return dae.addArrayCtorExpr(elems.map((e) => mulScalarByArray(e)));
            }
            return dae.addArrayCtorExpr(elems.map((e) => makeMul(effectiveLeftId, e)));
          };
          return mulScalarByArray(effectiveRightId);
        } else if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          (!leftDims || leftDims.length === 0) &&
          rightDims &&
          rightDims.length > 0 &&
          effectiveLeftKind === ExprKind.Name &&
          effectiveRightKind === ExprKind.Binary
        ) {
          [leftId, rightId] = [rightId, leftId];
        }
      }
      if (binOp === BinOp.Pow) {
        const getConstVal = (id: number): number | null => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.RealLiteral) return dae.getExprRealValue(id);
          if (k === ExprKind.IntLiteral) return dae.getExprData1(id);
          if (k === ExprKind.Negate) {
            const inner = getConstVal(dae.getExprLeft(id));
            return inner !== null ? -inner : null;
          }
          if (k === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
            const inner = getConstVal(dae.getExprLeft(id));
            return inner !== null ? -inner : null;
          }
          return null;
        };
        const lVal = getConstVal(leftId);
        const rVal = getConstVal(rightId);
        if (lVal !== null && rVal !== null && lVal < 0 && !Number.isInteger(rVal)) {
          const startB = node.startIndex ?? node.startOffset;
          const endB = node.endIndex ?? node.endOffset;
          const lStr = Number.isInteger(lVal) ? lVal.toFixed(1) : String(lVal);
          const rStr = Number.isInteger(rVal) ? rVal.toFixed(1) : String(rVal);
          dae.diagnostics.push({
            severity: "error",
            message: `Invalid operation ${lStr} ^ ${rStr}, exponent must be an Integer when the base is negative.`,
            range:
              startB != null && endB != null
                ? {
                    startOffset: startB,
                    endOffset: endB,
                    startPosition: node.startPosition,
                    endPosition: node.endPosition,
                  }
                : undefined,
          });
          return -1;
        }
        if (dae.getExprKind(leftId) === ExprKind.Name) {
          const lName = dae.interner.resolve(dae.getExprData1(leftId));
          if (lName && dae.hasArrayElements(lName)) {
            const lCtor = expandVarToArrayCtor(lName, dae);
            if (lCtor !== null) leftId = lCtor;
          }
        }
        if (dae.getExprKind(leftId) === ExprKind.ArrayCtor) {
          let powVal: number | null = null;
          if (dae.getExprKind(rightId) === ExprKind.IntLiteral) {
            powVal = dae.getExprData1(rightId);
          } else if (dae.getExprKind(rightId) === ExprKind.RealLiteral) {
            powVal = dae.getExprRealValue(rightId);
          }
          if (powVal !== null && Number.isInteger(powVal) && powVal >= 0) {
            return matrixPower(leftId, powVal, dae);
          }
        }
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (
          (leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral) &&
          (rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral)
        ) {
          const lNum = leftKind === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
          const rNum = rightKind === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
          return dae.addRealLiteral(Math.pow(lNum, rNum));
        }

        const isOne = (id: number): boolean => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.IntLiteral && dae.getExprData1(id) === 1) return true;
          if (k === ExprKind.RealLiteral && dae.getExprRealValue(id) === 1.0) return true;
          return false;
        };
        if (isOne(rightId)) return leftId;
        const isZero = (id: number): boolean => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.IntLiteral && dae.getExprData1(id) === 0) return true;
          if (k === ExprKind.RealLiteral && dae.getExprRealValue(id) === 0.0) return true;
          return false;
        };
        if (isZero(rightId)) {
          return isRealExpr(leftId, dae) || rightKind === ExprKind.RealLiteral
            ? dae.addRealLiteral(1.0)
            : dae.addIntLiteral(1);
        }

        // Power of power simplification: (x ^ a) ^ b
        if (leftKind === ExprKind.Binary && dae.getExprData1(leftId) === BinOp.Pow) {
          const innerBase = dae.getExprLeft(leftId);
          const innerExp = dae.getExprRight(leftId);
          const outerExp = rightId;

          const getNum = (id: number): number | null => {
            const k = dae.getExprKind(id);
            if (k === ExprKind.IntLiteral) return dae.getExprData1(id);
            if (k === ExprKind.RealLiteral) return dae.getExprRealValue(id);
            return null;
          };

          const isHalf = dae.getExprKind(outerExp) === ExprKind.RealLiteral && dae.getExprRealValue(outerExp) === 0.5;
          const inNum = getNum(innerExp);
          if (isHalf && inNum !== null && inNum % 2 === 0) {
            const absBase = dae.addCallExpr("abs", [innerBase]);
            const newExp = dae.addRealLiteral(inNum * 0.5);
            return dae.addBinaryExpr(BinOp.Pow, absBase, newExp);
          }

          const isDiv = dae.getExprKind(outerExp) === ExprKind.Binary && dae.getExprData1(outerExp) === BinOp.Div;
          if (isDiv) {
            const dL = dae.getExprLeft(outerExp);
            const dR = dae.getExprRight(outerExp);
            if (isOne(dL)) {
              const innerExpName = dae.getExprKind(innerExp) === ExprKind.Name ? dae.getExprData1(innerExp) : null;
              const dRName = dae.getExprKind(dR) === ExprKind.Name ? dae.getExprData1(dR) : null;
              if (innerExpName !== null && innerExpName === dRName) {
                return innerBase;
              }
            }
          }

          const outNum = getNum(outerExp);
          if (inNum !== null && outNum !== null) {
            const newExp = dae.addRealLiteral(inNum * outNum);
            return dae.addBinaryExpr(BinOp.Pow, innerBase, newExp);
          }
        }
      }
      // Algebraic linear term combination (`c1 * x +/- c2 * x -> (c1 +/- c2) * x`):
      // Decomposes additive operands into `(coeff, baseId)` pairs and combines terms with identical symbolic bases.
      if (flattener?.options?.omcCompatibility && (binOp === BinOp.Add || binOp === BinOp.Sub)) {
        const decomposeLinearTerm = (id: number): { coeff: number; isReal: boolean; baseId: number } => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.Negate) {
            const inner = decomposeLinearTerm(dae.getExprLeft(id));
            return { coeff: -inner.coeff, isReal: inner.isReal, baseId: inner.baseId };
          }
          if (k === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
            const inner = decomposeLinearTerm(dae.getExprLeft(id));
            return { coeff: -inner.coeff, isReal: inner.isReal, baseId: inner.baseId };
          }
          if (k === ExprKind.Binary && (dae.getExprData1(id) === BinOp.Mul || dae.getExprData1(id) === BinOp.ElemMul)) {
            const l = dae.getExprLeft(id);
            const r = dae.getExprRight(id);
            const lKind = dae.getExprKind(l);
            const rKind = dae.getExprKind(r);
            if (lKind === ExprKind.RealLiteral || lKind === ExprKind.IntLiteral) {
              const isReal = lKind === ExprKind.RealLiteral;
              const v = isReal ? dae.getExprRealValue(l) : dae.getExprData1(l);
              const inner = decomposeLinearTerm(r);
              return { coeff: v * inner.coeff, isReal: isReal || inner.isReal, baseId: inner.baseId };
            }
            if (rKind === ExprKind.RealLiteral || rKind === ExprKind.IntLiteral) {
              const isReal = rKind === ExprKind.RealLiteral;
              const v = isReal ? dae.getExprRealValue(r) : dae.getExprData1(r);
              const inner = decomposeLinearTerm(l);
              return { coeff: v * inner.coeff, isReal: isReal || inner.isReal, baseId: inner.baseId };
            }
          }
          if (k === ExprKind.Binary && (dae.getExprData1(id) === BinOp.Div || dae.getExprData1(id) === BinOp.ElemDiv)) {
            const l = dae.getExprLeft(id);
            const r = dae.getExprRight(id);
            const rKind = dae.getExprKind(r);
            if (rKind === ExprKind.RealLiteral || rKind === ExprKind.IntLiteral) {
              const isReal = rKind === ExprKind.RealLiteral;
              const v = isReal ? dae.getExprRealValue(r) : dae.getExprData1(r);
              if (v !== 0) {
                const inner = decomposeLinearTerm(l);
                return { coeff: inner.coeff / v, isReal: isReal || inner.isReal, baseId: inner.baseId };
              }
            }
          }
          return { coeff: 1, isReal: false, baseId: id };
        };

        const isLiteralKind = (id: number): boolean => {
          const k = dae.getExprKind(id);
          return (
            k === ExprKind.RealLiteral ||
            k === ExprKind.IntLiteral ||
            k === ExprKind.BoolLiteral ||
            k === ExprKind.StringLiteral
          );
        };

        const term1 = decomposeLinearTerm(leftId);
        const term2 = decomposeLinearTerm(rightId);
        if (!isLiteralKind(term1.baseId) && areExpressionsEqual(dae, term1.baseId, term2.baseId)) {
          const totalCoeff = binOp === BinOp.Add ? term1.coeff + term2.coeff : term1.coeff - term2.coeff;
          const isReal = term1.isReal || term2.isReal || isRealExpr(term1.baseId, dae) || !Number.isInteger(totalCoeff);
          if (Math.abs(totalCoeff) < 1e-12) {
            const dims = getExprDims(term1.baseId, dae, flattener?.db);
            if (dims && dims.length > 0) {
              if (dims.every((d) => d > 0)) {
                const buildZeros = (dimIdx: number): number => {
                  if (dimIdx === dims.length) {
                    return isReal ? dae.addRealLiteral(0.0) : dae.addIntLiteral(0);
                  }
                  const children: number[] = [];
                  for (let j = 0; j < dims[dimIdx]!; j++) {
                    children.push(buildZeros(dimIdx + 1));
                  }
                  return dae.addArrayCtorExpr(children);
                };
                return buildZeros(0);
              }
              return dae.addBinaryExpr(binOp, leftId, rightId);
            }
            return isReal ? dae.addRealLiteral(0.0) : dae.addIntLiteral(0);
          }
          if (totalCoeff === 1) {
            return term1.baseId;
          }
          if (totalCoeff === -1) {
            return dae.addUnaryExpr(UnaryOp.Negate, term1.baseId);
          }
          const coeffLit = isReal ? dae.addRealLiteral(totalCoeff) : dae.addIntLiteral(totalCoeff);
          return dae.addBinaryExpr(BinOp.Mul, coeffLit, term1.baseId);
        }
        const getMulFactors = (exprId: number): number[] => {
          if (dae.getExprKind(exprId) === ExprKind.Binary && dae.getExprData1(exprId) === BinOp.Mul) {
            return [...getMulFactors(dae.getExprLeft(exprId)), ...getMulFactors(dae.getExprRight(exprId))];
          }
          return [exprId];
        };
        const leftFactors = getMulFactors(leftId);
        const rightFactors = getMulFactors(rightId);
        if (leftFactors.length > 1 || rightFactors.length > 1) {
          let matchLeftIdx = -1;
          let matchRightIdx = -1;
          for (let li = 0; li < leftFactors.length; li++) {
            const factorId = leftFactors[li]!;
            const kind = dae.getExprKind(factorId);
            if (kind === ExprKind.Name) {
              const nameStr = dae.interner.resolve(dae.getExprData1(factorId));
              let vIdx = dae.getVarIdxByName(nameStr);
              if (vIdx < 0 && prefix) {
                vIdx = dae.getVarIdxByName(`${prefix}.${nameStr}`);
              }
              if (vIdx >= 0) {
                const variability = dae.getVarVariability(vIdx);
                if (variability === Variability.Continuous || variability === Variability.Discrete) {
                  continue;
                }
              }
            } else if (kind !== ExprKind.IntLiteral && kind !== ExprKind.RealLiteral) {
              continue;
            }
            for (let ri = 0; ri < rightFactors.length; ri++) {
              if (areExpressionsEqual(dae, leftFactors[li]!, rightFactors[ri]!)) {
                matchLeftIdx = li;
                matchRightIdx = ri;
                break;
              }
            }
            if (matchLeftIdx >= 0) break;
          }

          if (matchLeftIdx >= 0 && matchRightIdx >= 0) {
            let commonFactorId = leftFactors[matchLeftIdx]!;
            const remLeft = leftFactors.filter((_, idx) => idx !== matchLeftIdx);
            const remRight = rightFactors.filter((_, idx) => idx !== matchRightIdx);
            const rebuildMul = (factors: number[]): number => {
              if (factors.length === 0) return dae.addRealLiteral(1.0);
              let res = factors[0]!;
              for (let i = 1; i < factors.length; i++) {
                res = dae.addBinaryExpr(BinOp.Mul, res, factors[i]!);
              }
              return res;
            };
            let innerLeft = rebuildMul(remLeft);
            let innerRight = rebuildMul(remRight);
            if (isRealExpr(innerLeft, dae) && !isRealExpr(innerRight, dae)) {
              innerRight = castToRealExpr(innerRight, dae);
            } else if (!isRealExpr(innerLeft, dae) && isRealExpr(innerRight, dae)) {
              innerLeft = castToRealExpr(innerLeft, dae);
            }
            const innerAddSub = dae.addBinaryExpr(binOp, innerLeft, innerRight);
            if (isRealExpr(innerAddSub, dae) && !isRealExpr(commonFactorId, dae)) {
              commonFactorId = castToRealExpr(commonFactorId, dae);
            }
            return dae.addBinaryExpr(BinOp.Mul, commonFactorId, innerAddSub);
          }
        }
      }
      const hasNoCallExpr = (id: number): boolean => {
        if (id < 0) return false;
        const k = dae.getExprKind(id);
        if (k === ExprKind.Call) return false;
        if (k === ExprKind.Binary) {
          return hasNoCallExpr(dae.getExprLeft(id)) && hasNoCallExpr(dae.getExprRight(id));
        }
        if (k === ExprKind.Unary || k === ExprKind.Negate) {
          return hasNoCallExpr(dae.getExprLeft(id));
        }
        return true;
      };
      const extractLeadingMulLiteral = (id: number, reverseRest = false): { cVal: number; restId: number } | null => {
        if (id < 0 || dae.getExprKind(id) !== ExprKind.Binary || (dae.getExprData1(id) as BinOp) !== BinOp.Mul) {
          return null;
        }
        const l = dae.getExprLeft(id);
        const r = dae.getExprRight(id);
        const lK = dae.getExprKind(l);
        if (lK === ExprKind.RealLiteral || lK === ExprKind.IntLiteral) {
          const cVal = lK === ExprKind.RealLiteral ? dae.getExprRealValue(l) : dae.getExprData1(l);
          return cVal !== 0 ? { cVal, restId: r } : null;
        }
        const subL = extractLeadingMulLiteral(l, reverseRest);
        if (subL) {
          const reverseFactors =
            reverseRest &&
            Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
            hasNoCallExpr(subL.restId) &&
            hasNoCallExpr(r);
          return {
            cVal: subL.cVal,
            restId: reverseFactors
              ? dae.addBinaryExpr(BinOp.Mul, r, subL.restId)
              : dae.addBinaryExpr(BinOp.Mul, subL.restId, r),
          };
        }
        return null;
      };
      if (binOp === BinOp.Div) {
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          ((leftKind === ExprKind.IntLiteral && dae.getExprData1(leftId) === 1) ||
            (leftKind === ExprKind.RealLiteral && dae.getExprRealValue(leftId) === 1.0)) &&
          rightKind === ExprKind.Binary &&
          (dae.getExprData1(rightId) as BinOp) === BinOp.Pow
        ) {
          const baseId = dae.getExprLeft(rightId);
          const expId = dae.getExprRight(rightId);
          const expK = dae.getExprKind(expId);
          if (
            dae.getExprKind(baseId) === ExprKind.Name &&
            (expK === ExprKind.IntLiteral || expK === ExprKind.RealLiteral)
          ) {
            const eVal = expK === ExprKind.RealLiteral ? dae.getExprRealValue(expId) : dae.getExprData1(expId);
            return dae.addBinaryExpr(
              BinOp.Pow,
              isRealExpr(baseId, dae) ? baseId : castToRealExpr(baseId, dae),
              dae.addRealLiteral(-eVal),
            );
          }
        }
        if (
          (leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral) &&
          (rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral)
        ) {
          const lVal = leftKind === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
          const rVal = rightKind === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
          if (rVal !== 0) {
            return dae.addRealLiteral(lVal / rVal);
          }
        }
        if (
          flattener?.options?.omcCompatibility &&
          (rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral) &&
          leftKind !== ExprKind.IntLiteral &&
          leftKind !== ExprKind.RealLiteral
        ) {
          const rVal = rightKind === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
          if (rVal !== 0) {
            const reciprocal = 1 / rVal;
            const realLeftId = isRealExpr(leftId, dae) ? leftId : castToRealExpr(leftId, dae);
            if (leftKind === ExprKind.Negate) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-reciprocal), dae.getExprLeft(realLeftId));
            }
            if (leftKind === ExprKind.Unary && (dae.getExprData1(leftId) as UnaryOp) === UnaryOp.Negate) {
              return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(-reciprocal), dae.getExprLeft(realLeftId));
            }
            if (leftKind === ExprKind.ArrayCtor) {
              const recId = dae.addRealLiteral(reciprocal);
              const elems = getArrayCtorElements(leftId, dae);
              return dae.addArrayCtorExpr(elems.map((e) => mulWithSimplification(recId, e, dae)));
            }
            if (
              Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
              leftKind === ExprKind.Binary &&
              (dae.getExprData1(leftId) as BinOp) === BinOp.Add &&
              extractLeadingMulLiteral(dae.getExprRight(leftId)) !== null
            ) {
              const recId = dae.addRealLiteral(reciprocal);
              return dae.addBinaryExpr(
                BinOp.Add,
                mulWithSimplification(recId, dae.getExprLeft(realLeftId), dae),
                mulWithSimplification(recId, dae.getExprRight(realLeftId), dae),
              );
            }
            return dae.classKind === "function"
              ? mulWithSimplification(dae.addRealLiteral(reciprocal), realLeftId, dae)
              : dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(reciprocal), realLeftId);
          }
        }
        if (
          flattener?.options?.omcCompatibility &&
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          rightKind === ExprKind.Binary &&
          (dae.getExprData1(rightId) as BinOp) === BinOp.Div
        ) {
          // Unwrap a / (b / c) -> (a * c) / b
          let numId = isRealExpr(leftId, dae) ? leftId : castToRealExpr(leftId, dae);
          let denId = rightId;
          while (dae.getExprKind(denId) === ExprKind.Binary && (dae.getExprData1(denId) as BinOp) === BinOp.Div) {
            const dL = dae.getExprLeft(denId);
            const dR = dae.getExprRight(denId);
            const dRReal = isRealExpr(dR, dae) ? dR : castToRealExpr(dR, dae);
            numId = mulWithSimplification(numId, dRReal, dae);
            denId = dL;
          }
          leftId = numId;
          rightId = denId;
        }
        if (
          flattener?.options?.omcCompatibility &&
          (dae.getExprKind(leftId) === ExprKind.IntLiteral || dae.getExprKind(leftId) === ExprKind.RealLiteral) &&
          dae.getExprKind(rightId) === ExprKind.Binary &&
          (dae.getExprData1(rightId) as BinOp) === BinOp.Mul
        ) {
          const lK = dae.getExprKind(leftId);
          const lVal = lK === ExprKind.RealLiteral ? dae.getExprRealValue(leftId) : dae.getExprData1(leftId);
          if (!dae.extensionMetadata?.["isOldFrontend"] || lVal === 1) {
            const extracted = extractLeadingMulLiteral(rightId, true);
            if (extracted) {
              const rRightReal = isRealExpr(extracted.restId, dae)
                ? extracted.restId
                : castToRealExpr(extracted.restId, dae);
              return dae.addBinaryExpr(BinOp.Div, dae.addRealLiteral(lVal / extracted.cVal), rRightReal);
            }
          }
        }
        if (
          flattener?.options?.omcCompatibility &&
          (dae.description?.includes("record constructor") || Boolean(dae.extensionMetadata?.["isOldFrontend"])) &&
          !(dae.getExprKind(leftId) === ExprKind.IntLiteral || dae.getExprKind(leftId) === ExprKind.RealLiteral) &&
          dae.getExprKind(rightId) === ExprKind.Binary &&
          (dae.getExprData1(rightId) as BinOp) === BinOp.Mul
        ) {
          const extracted = extractLeadingMulLiteral(rightId, true);
          if (extracted) {
            const reciprocal = 1 / extracted.cVal;
            const realLeftId = isRealExpr(leftId, dae) ? leftId : castToRealExpr(leftId, dae);
            const rRightReal = isRealExpr(extracted.restId, dae)
              ? extracted.restId
              : castToRealExpr(extracted.restId, dae);
            if (
              Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
              dae.getExprKind(realLeftId) === ExprKind.Binary &&
              (dae.getExprData1(realLeftId) as BinOp) === BinOp.Pow &&
              dae.getExprKind(rRightReal) === ExprKind.Binary &&
              (dae.getExprData1(rRightReal) as BinOp) === BinOp.Pow &&
              exprsEqual(dae.getExprRight(realLeftId), dae.getExprRight(rRightReal), dae)
            ) {
              const combinedBase = dae.addBinaryExpr(
                BinOp.Div,
                dae.getExprLeft(realLeftId),
                dae.getExprLeft(rRightReal),
              );
              const combinedPow = dae.addBinaryExpr(BinOp.Pow, combinedBase, dae.getExprRight(realLeftId));
              return dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(reciprocal), combinedPow);
            }
            const leftExtracted = extractLeadingMulLiteral(realLeftId);
            const scaledLeft = leftExtracted
              ? dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(reciprocal * leftExtracted.cVal), leftExtracted.restId)
              : mulWithSimplification(dae.addRealLiteral(reciprocal), realLeftId, dae);
            return dae.addBinaryExpr(BinOp.Div, scaledLeft, rRightReal);
          }
        }
        if (
          flattener?.options?.omcCompatibility &&
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          dae.getExprKind(leftId) === ExprKind.Binary &&
          (dae.getExprData1(leftId) as BinOp) === BinOp.Div &&
          extractLeadingMulLiteral(dae.getExprLeft(leftId)) !== null
        ) {
          const aId = dae.getExprLeft(leftId);
          const bId = dae.getExprRight(leftId);
          const realRight = isRealExpr(rightId, dae) ? rightId : castToRealExpr(rightId, dae);
          return dae.addBinaryExpr(BinOp.Div, aId, dae.addBinaryExpr(BinOp.Mul, bId, realRight));
        }
        if (leftKind === ExprKind.Call && rightKind === ExprKind.Call) {
          const leftFn = dae.interner.resolve(dae.getExprData1(leftId));
          const rightFn = dae.interner.resolve(dae.getExprData1(rightId));
          if (leftFn === "sin" && rightFn === "cos") {
            const leftArg = dae.getExprLeft(leftId);
            const rightArg = dae.getExprLeft(rightId);
            const leftArgCount = dae.getExprRight(leftId);
            const rightArgCount = dae.getExprRight(rightId);
            const sameArg = leftArg === rightArg || areExpressionsEqual(dae, leftArg, rightArg);
            if (leftArgCount === 1 && rightArgCount === 1 && sameArg) {
              return dae.addCallExpr("tan", [leftArg]);
            }
          }
        }
        const leftDims = getExprDims(leftId, dae, flattener?.db, flattener);
        const rightDims = getExprDims(rightId, dae, flattener?.db, flattener);
        let effectiveLeftId = leftId;
        let effectiveLeftKind = leftKind;
        if (
          flattener?.options?.arrayMode !== "preserve" &&
          effectiveLeftKind !== ExprKind.ArrayCtor &&
          leftDims &&
          leftDims.length > 0
        ) {
          const lName =
            dae.getExprKind(effectiveLeftId) === ExprKind.Name
              ? dae.interner.resolve(dae.getExprData1(effectiveLeftId))
              : null;
          if (lName && !(dae.classKind === "function" && flattener?.currentBindingCompName === lName)) {
            const exp = expandVarToArrayCtor(lName, dae);
            if (exp !== null) {
              effectiveLeftId = exp;
              effectiveLeftKind = dae.getExprKind(effectiveLeftId);
            }
          }
        }
        if (effectiveLeftKind === ExprKind.ArrayCtor && (!rightDims || rightDims.length === 0)) {
          // Vector/Matrix / Scalar
          const leftElems = getArrayCtorElements(effectiveLeftId, dae);
          const isMatrix = leftElems.length > 0 && dae.getExprKind(leftElems[0]!) === ExprKind.ArrayCtor;
          let castRight = rightId;
          if (!isRealExpr(castRight, dae)) {
            castRight = castToRealExpr(castRight, dae);
          }
          if (isMatrix) {
            const rows = leftElems.map((r) => {
              const rElems = getArrayCtorElements(r, dae);
              return dae.addArrayCtorExpr(
                rElems.map((e) => {
                  const castE = !isRealExpr(e, dae) ? castToRealExpr(e, dae) : e;
                  return dae.addBinaryExpr(BinOp.Div, castE, castRight);
                }),
              );
            });
            return dae.addArrayCtorExpr(rows);
          } else {
            return dae.addArrayCtorExpr(
              leftElems.map((e) => {
                const castE = !isRealExpr(e, dae) ? castToRealExpr(e, dae) : e;
                return dae.addBinaryExpr(BinOp.Div, castE, castRight);
              }),
            );
          }
        }
      }
      if (binOp === BinOp.Mul) {
        const isOne = (id: number): boolean => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.IntLiteral && dae.getExprData1(id) === 1) return true;
          if (k === ExprKind.RealLiteral && dae.getExprRealValue(id) === 1.0) return true;
          return false;
        };
        if (isOne(leftId)) return rightId;
        if (isOne(rightId)) return leftId;
        const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
        const leftMulDims = getExprDims(leftId, dae, flattener?.db, flattener);
        const rightMulDims = getExprDims(rightId, dae, flattener?.db, flattener);
        const isScalarMul = (!leftMulDims || leftMulDims.length === 0) && (!rightMulDims || rightMulDims.length === 0);
        const leftMulText =
          dae.getExprKind(leftId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(leftId)) : null;
        const rightMulText =
          dae.getExprKind(rightId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(rightId)) : null;
        const isFnFieldAccess =
          dae.classKind === "function" && Boolean(leftMulText?.includes(".") || rightMulText?.includes("."));
        if (isOldFrontend && isScalarMul && !isFnFieldAccess && exprsEqual(leftId, rightId, dae)) {
          const isReal = isRealExpr(leftId, dae);
          return dae.addBinaryExpr(BinOp.Pow, leftId, isReal ? dae.addRealLiteral(2.0) : dae.addIntLiteral(2));
        }
        if (
          isOldFrontend &&
          isScalarMul &&
          !isFnFieldAccess &&
          dae.getExprKind(leftId) === ExprKind.Binary &&
          dae.getExprData1(leftId) === BinOp.Mul &&
          exprsEqual(dae.getExprRight(leftId), rightId, dae)
        ) {
          const mL = dae.getExprLeft(leftId);
          const mR = dae.getExprRight(leftId);
          const isReal = isRealExpr(mR, dae);
          const powExpr = dae.addBinaryExpr(BinOp.Pow, mR, isReal ? dae.addRealLiteral(2.0) : dae.addIntLiteral(2));
          return dae.addBinaryExpr(BinOp.Mul, mL, powExpr);
        }
        if (
          isOldFrontend &&
          isScalarMul &&
          dae.getExprKind(rightId) === ExprKind.Binary &&
          dae.getExprData1(rightId) === BinOp.Pow
        ) {
          const rBase = dae.getExprLeft(rightId);
          const rExp = dae.getExprRight(rightId);
          if (
            dae.getExprKind(leftId) === ExprKind.Binary &&
            dae.getExprData1(leftId) === BinOp.Pow &&
            exprsEqual(dae.getExprRight(leftId), rExp, dae)
          ) {
            return dae.addBinaryExpr(BinOp.Pow, mulWithSimplification(dae.getExprLeft(leftId), rBase, dae), rExp);
          }
          if (dae.getExprKind(leftId) === ExprKind.Binary && dae.getExprData1(leftId) === BinOp.Mul) {
            const mL = dae.getExprLeft(leftId);
            const mR = dae.getExprRight(leftId);
            if (
              dae.getExprKind(mR) === ExprKind.Binary &&
              dae.getExprData1(mR) === BinOp.Pow &&
              exprsEqual(dae.getExprRight(mR), rExp, dae)
            ) {
              const combinedPow = dae.addBinaryExpr(
                BinOp.Pow,
                mulWithSimplification(dae.getExprLeft(mR), rBase, dae),
                rExp,
              );
              return dae.addBinaryExpr(BinOp.Mul, mL, combinedPow);
            }
          }
        }
        const leftText =
          dae.getExprKind(leftId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(leftId)) : null;
        const rightText =
          dae.getExprKind(rightId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(rightId)) : null;
        const isOmc =
          flattener?.options?.omcCompatibility ?? getFlatteningState(dae).flattener?.options?.omcCompatibility ?? true;
        if (
          !isOmc &&
          leftText &&
          leftText === rightText &&
          dae.classKind !== "function" &&
          !dae.hasArrayElements(leftText)
        ) {
          const twoExpr = dae.addRealLiteral(2.0);
          return dae.addBinaryExpr(BinOp.Pow, leftId, twoExpr);
        }
      }
      // Real coercion in binary expressions:
      // Division (`/`) and exponentiation (`^`) unconditionally promote both operands to Real;
      // other binary operators promote an Integer operand to Real if the paired operand is Real-typed.
      if (binOp === BinOp.Div || binOp === BinOp.Pow) {
        if (!isRealExpr(leftId, dae)) {
          leftId = castToRealExpr(leftId, dae);
        }
        if (!isRealExpr(rightId, dae)) {
          rightId = castToRealExpr(rightId, dae);
        }
      } else if (isRealExpr(leftId, dae) && !isRealExpr(rightId, dae)) {
        rightId = castToRealExpr(rightId, dae);
      } else if (!isRealExpr(leftId, dae) && isRealExpr(rightId, dae)) {
        leftId = castToRealExpr(leftId, dae);
      }
      if (flattener?.options?.omcCompatibility && binOp === BinOp.Add) {
        const trig = simplifyTrigonometricBinary(dae, binOp, leftId, rightId);
        if (trig !== null) return trig;
        if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          dae.getExprKind(leftId) === ExprKind.Binary &&
          dae.getExprData1(leftId) === BinOp.Mul &&
          dae.getExprKind(rightId) === ExprKind.Binary &&
          dae.getExprData1(rightId) === BinOp.Mul
        ) {
          const lA = dae.getExprLeft(leftId);
          const lB = dae.getExprRight(leftId);
          const rA = dae.getExprLeft(rightId);
          const rB = dae.getExprRight(rightId);
          if (exprsEqual(lA, rA, dae) && dae.getExprKind(lA) === ExprKind.Call) {
            return dae.addBinaryExpr(BinOp.Mul, lA, dae.addBinaryExpr(BinOp.Add, lB, rB));
          }
        }
        const isNegatedExpr = (id: number): { isNeg: boolean; posId: number } => {
          const k = dae.getExprKind(id);
          if (k === ExprKind.Negate) {
            return { isNeg: true, posId: dae.getExprLeft(id) };
          }
          if (k === ExprKind.Unary && (dae.getExprData1(id) as UnaryOp) === UnaryOp.Negate) {
            return { isNeg: true, posId: dae.getExprLeft(id) };
          }
          if (k === ExprKind.Binary && dae.getExprData1(id) === BinOp.Mul) {
            const mL = dae.getExprLeft(id);
            const mR = dae.getExprRight(id);
            const nL = isNegatedExpr(mL);
            if (nL.isNeg) {
              return { isNeg: true, posId: dae.addBinaryExpr(BinOp.Mul, nL.posId, mR) };
            }
          }
          return { isNeg: false, posId: id };
        };
        const negL = isNegatedExpr(leftId);
        if (negL.isNeg) {
          return dae.addBinaryExpr(BinOp.Sub, rightId, negL.posId);
        }
        if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          dae.getExprKind(leftId) === ExprKind.Binary &&
          (dae.getExprData1(leftId) as BinOp) === BinOp.Sub
        ) {
          const subL = dae.getExprLeft(leftId);
          const subR = dae.getExprRight(leftId);
          const newAdd =
            dae.getExprKind(subL) === ExprKind.IntLiteral && dae.getExprKind(rightId) === ExprKind.IntLiteral
              ? dae.addIntLiteral(dae.getExprData1(subL) + dae.getExprData1(rightId))
              : dae.getExprKind(subL) === ExprKind.RealLiteral && dae.getExprKind(rightId) === ExprKind.RealLiteral
                ? dae.addRealLiteral(dae.getExprRealValue(subL) + dae.getExprRealValue(rightId))
                : dae.addBinaryExpr(BinOp.Add, subL, rightId);
          return dae.addBinaryExpr(BinOp.Sub, newAdd, subR);
        }
        if (
          (dae.classKind !== "function" ||
            Boolean(dae.extensionMetadata?.["isOldFrontend"]) ||
            Boolean(flattener?.options?.isOldFrontend)) &&
          !tupleContext &&
          !isAssignmentLhs
        ) {
          const leftKind = dae.getExprKind(leftId);
          const rightKind = dae.getExprKind(rightId);
          const isLeftLit = leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral;
          const isRightLit = rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral;
          if (!isLeftLit && isRightLit) {
            [leftId, rightId] = [rightId, leftId];
          }
        }
      }
      if (flattener?.options?.omcCompatibility && binOp === BinOp.Mul) {
        const trig = simplifyTrigonometricBinary(dae, binOp, leftId, rightId);
        if (trig !== null) return trig;
        const leftKind = dae.getExprKind(leftId);
        const rightKind = dae.getExprKind(rightId);
        const isLeftLit = leftKind === ExprKind.IntLiteral || leftKind === ExprKind.RealLiteral;
        const isRightLit = rightKind === ExprKind.IntLiteral || rightKind === ExprKind.RealLiteral;
        if (
          !dae.extensionMetadata?.["isOldFrontend"] &&
          !flattener?.isOldFrontend &&
          leftKind !== ExprKind.ArrayCtor &&
          rightKind !== ExprKind.ArrayCtor &&
          ((leftKind === ExprKind.RealLiteral && dae.getExprRealValue(leftId) === 0) ||
            (rightKind === ExprKind.RealLiteral && dae.getExprRealValue(rightId) === 0))
        ) {
          return dae.addRealLiteral(0.0);
        }
        if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          isLeftLit &&
          (rightKind === ExprKind.Negate ||
            (rightKind === ExprKind.Unary && (dae.getExprData1(rightId) as UnaryOp) === UnaryOp.Negate))
        ) {
          const lVal = leftKind === ExprKind.RealLiteral ? dae.getExprRealValue(leftId) : dae.getExprData1(leftId);
          leftId = leftKind === ExprKind.RealLiteral ? dae.addRealLiteral(-lVal) : dae.addIntLiteral(-lVal);
          rightId = dae.getExprLeft(rightId);
        } else if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          isRightLit &&
          (leftKind === ExprKind.Negate ||
            (leftKind === ExprKind.Unary && (dae.getExprData1(leftId) as UnaryOp) === UnaryOp.Negate))
        ) {
          const rVal = rightKind === ExprKind.RealLiteral ? dae.getExprRealValue(rightId) : dae.getExprData1(rightId);
          const innerL = dae.getExprLeft(leftId);
          leftId = rightKind === ExprKind.RealLiteral ? dae.addRealLiteral(-rVal) : dae.addIntLiteral(-rVal);
          rightId = innerL;
        } else if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          dae.classKind === "function" &&
          isLeftLit &&
          rightKind === ExprKind.Binary &&
          dae.getExprData1(rightId) === BinOp.Div
        ) {
          return mulWithSimplification(leftId, rightId, dae);
        } else if (
          Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
          dae.classKind === "function" &&
          leftKind === ExprKind.Binary &&
          dae.getExprData1(leftId) === BinOp.Div &&
          ((rightKind === ExprKind.Binary && dae.getExprData1(rightId) === BinOp.Div) ||
            extractLeadingMulLiteral(rightId) !== null ||
            (() => {
              let num = dae.getExprLeft(leftId);
              while (dae.getExprKind(num) === ExprKind.Binary && dae.getExprData1(num) === BinOp.Div) {
                num = dae.getExprLeft(num);
              }
              return (
                dae.getExprKind(num) === ExprKind.RealLiteral ||
                dae.getExprKind(num) === ExprKind.IntLiteral ||
                extractLeadingMulLiteral(num) !== null
              );
            })())
        ) {
          return mulWithSimplification(leftId, rightId, dae);
        } else if (
          (isLeftLit && extractLeadingMulLiteral(rightId) !== null) ||
          (isRightLit && extractLeadingMulLiteral(leftId) !== null)
        ) {
          return mulWithSimplification(leftId, rightId, dae);
        } else if (
          !isLeftLit &&
          isRightLit &&
          !(leftKind === ExprKind.Binary && dae.getExprData1(leftId) === BinOp.Div)
        ) {
          [leftId, rightId] = [rightId, leftId];
        }
      }
      if (
        binOp === BinOp.Eq ||
        binOp === BinOp.Neq ||
        binOp === BinOp.Lt ||
        binOp === BinOp.Lte ||
        binOp === BinOp.Gt ||
        binOp === BinOp.Gte
      ) {
        const lKind = dae.getExprKind(leftId);
        const rKind = dae.getExprKind(rightId);
        if (lKind === ExprKind.StringLiteral && rKind === ExprKind.StringLiteral) {
          const s1 = dae.interner.resolve(dae.getExprData1(leftId)) ?? "";
          const s2 = dae.interner.resolve(dae.getExprData1(rightId)) ?? "";
          let res: boolean;
          switch (binOp) {
            case BinOp.Eq:
              res = s1 === s2;
              break;
            case BinOp.Neq:
              res = s1 !== s2;
              break;
            case BinOp.Lt:
              res = s1 < s2;
              break;
            case BinOp.Lte:
              res = s1 <= s2;
              break;
            case BinOp.Gt:
              res = s1 > s2;
              break;
            case BinOp.Gte:
              res = s1 >= s2;
              break;
            default:
              res = false;
          }
          return dae.addBoolLiteral(res);
        }
        if (
          dae.classKind !== "function" &&
          (lKind === ExprKind.IntLiteral || lKind === ExprKind.RealLiteral) &&
          (rKind === ExprKind.IntLiteral || rKind === ExprKind.RealLiteral)
        ) {
          const n1 = lKind === ExprKind.IntLiteral ? dae.getExprData1(leftId) : dae.getExprRealValue(leftId);
          const n2 = rKind === ExprKind.IntLiteral ? dae.getExprData1(rightId) : dae.getExprRealValue(rightId);
          let res: boolean;
          switch (binOp) {
            case BinOp.Eq:
              res = n1 === n2;
              break;
            case BinOp.Neq:
              res = n1 !== n2;
              break;
            case BinOp.Lt:
              res = n1 < n2;
              break;
            case BinOp.Lte:
              res = n1 <= n2;
              break;
            case BinOp.Gt:
              res = n1 > n2;
              break;
            case BinOp.Gte:
              res = n1 >= n2;
              break;
            default:
              res = false;
          }
          return dae.addBoolLiteral(res);
        }
      }
      if ((binOp === BinOp.And || binOp === BinOp.Or) && dae.classKind !== "function") {
        const lKind = dae.getExprKind(leftId);
        const rKind = dae.getExprKind(rightId);
        if (lKind === ExprKind.BoolLiteral && rKind === ExprKind.BoolLiteral) {
          const lBool = dae.getExprData1(leftId) === 1;
          const rBool = dae.getExprData1(rightId) === 1;
          return dae.addBoolLiteral(binOp === BinOp.And ? lBool && rBool : lBool || rBool);
        }
      }
      return dae.addBinaryExpr(binOp, leftId, rightId);
    }
  }
}

export function lowerUnaryCSTExpression(
  node: SyntaxNode,
  dae: DAEBuilder,
  ctx: LoweringContext,
  lowerExpr: LowerExprFn,
): number | null {
  const { prefix = "", substitutions, imports, db, flattener } = ctx;
  // Unary expression: -expr or +expr or not expr
  if (node.childCount === 2) {
    const rawOp = node.child(0)?.text?.trim() ?? node.child(0)?.type ?? "";
    const op = stripOuterDoubleQuotes(rawOp);
    if (op === "-" || op === "-.") {
      const operandId = lowerExpr(node.child(1), dae, prefix, substitutions, imports, db, flattener);
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'-'", operandId, node.child(1), dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
      return negateExpr(operandId, dae);
    }

    if (op === "+" || op === "+.") {
      const operandId = lowerExpr(node.child(1), dae, prefix, substitutions, imports, db, flattener);
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'+'", operandId, node.child(1), dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
      return operandId;
    }
    if (op === "not") {
      const operandId = lowerExpr(node.child(1), dae, prefix, substitutions, imports, db, flattener);
      if (db && flattener) {
        const dispatched = dispatchUnaryOperator("'not'", operandId, node.child(1), dae, db, flattener);
        if (dispatched !== null) return dispatched;
      }
      return dae.addExpression(ExprKind.Unary, UnaryOp.Not, operandId);
    }
  }

  return null;
}
