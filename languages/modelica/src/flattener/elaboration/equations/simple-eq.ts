// SPDX-License-Identifier: AGPL-3.0-or-later

import { StringWriter } from "@modelscript/dsl/utils";
import {
  ArenaDAEPrinter,
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  inferArenaExprVarType,
  Variability,
  VarType,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, FieldId, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import type { ModelicaFlattener } from "../../class-flattener.js";
import { collapseAsciiWhitespace, isAsciiIdentifier } from "../../expressions/cst-utils.js";
import {
  addArenaValueAsExpr,
  addArrayBinaryExpr,
  castToRealExpr,
  checkIfExprTypeMismatch,
  evalDaeExpr,
  expandColonToArrayCtor,
  expandVarToArrayCtor,
  getArrayCtorElements,
  getExprDims,
  isDefinitelyScalarExpr,
  isEquationExpr,
  isRealExpr,
  matrixOrVectorMul,
  matrixPower,
} from "../../expressions/index.js";
import { getElementDiagRange } from "../../support/range-utils.js";
import { formatPlusOperatorSpacing, sharedAnnotationEvaluator } from "./cst-helpers.js";
import type {
  DiffusionAnnotationVal,
  EquationCstNode,
  EquationWalkContext,
  NameResolverFn,
  SymbolMetaLike,
} from "./types.js";

function getSimpleEqBinOp(op: string | undefined): BinOp | null {
  if (!op) return null;
  switch (op) {
    case "+":
      return BinOp.Add;
    case ".+":
      return BinOp.ElemAdd;
    case "-":
      return BinOp.Sub;
    case ".-":
      return BinOp.ElemSub;
    case "*":
      return BinOp.Mul;
    case ".*":
      return BinOp.ElemMul;
    case "/":
      return BinOp.Div;
    case "./":
      return BinOp.ElemDiv;
    case "^":
      return BinOp.Pow;
    case ".^":
      return BinOp.ElemPow;
    case "<":
      return BinOp.Lt;
    case "<=":
      return BinOp.Lte;
    case ">":
      return BinOp.Gt;
    case ">=":
      return BinOp.Gte;
    case "==":
      return BinOp.Eq;
    case "<>":
      return BinOp.Neq;
    case "and":
      return BinOp.And;
    case "or":
      return BinOp.Or;
    case ":":
      return BinOp.Colon;
    default:
      return null;
  }
}

export function extractSimpleEquationSides(
  n: SyntaxNode,
  flattener: ModelicaFlattener,
  dae: DAEBuilder,
  prefix: string,
  substitutions?: Map<string, number | string>,
): { lhsExprId: number; rhsNode: SyntaxNode; isTupleLhs: boolean; lhsNode: SyntaxNode } | null {
  const children: SyntaxNode[] = n.children || [];
  const eqIdx = children.findIndex((c: SyntaxNode) => c.type === "=" || c.type === '"="' || c.text?.trim() === "=");
  const lhsKids =
    eqIdx >= 0
      ? children.slice(0, eqIdx).filter((c: SyntaxNode) => c.type !== "comment" && c.type !== "description")
      : [];
  const rhsKids =
    eqIdx >= 0
      ? children.slice(eqIdx + 1).filter((c: SyntaxNode) => c.type !== "comment" && c.type !== "description")
      : [];

  if (lhsKids.length > 1 && rhsKids.length > 0) {
    let lhsExprId = flattener.lowerExpr(lhsKids[0]!, dae, prefix, substitutions, false, true);
    for (let k = 1; k < lhsKids.length; k += 2) {
      const opText = lhsKids[k]?.text?.trim();
      const nextKid = lhsKids[k + 1];
      if (!nextKid) break;
      const nextId = flattener.lowerExpr(nextKid, dae, prefix, substitutions, false, true);
      const binOp = getSimpleEqBinOp(opText);
      if (binOp !== null && lhsExprId >= 0 && nextId >= 0) {
        lhsExprId = dae.addBinaryExpr(binOp, lhsExprId, nextId);
      }
    }
    const isTuple = lhsExprId >= 0 && dae.getExprKind(lhsExprId) === ExprKind.Tuple;
    return { lhsExprId, rhsNode: rhsKids[0]!, isTupleLhs: isTuple, lhsNode: lhsKids[0]! };
  }

  const leftNode = lhsKids.length === 1 ? lhsKids[0] : (Cst.SimpleEquation.lhs(n) ?? n.childForFieldId?.(FieldId.lhs));
  const rightNode = rhsKids.length === 1 ? rhsKids[0] : (Cst.SimpleEquation.rhs(n) ?? n.childForFieldId?.(FieldId.rhs));
  const exprs = leftNode && rightNode ? [leftNode, rightNode] : children.filter(isEquationExpr);
  if (exprs.length >= 2 && exprs[0] && exprs[1]) {
    const lId = flattener.lowerExpr(exprs[0], dae, prefix, substitutions, false, true);
    const isTuple = lId >= 0 && dae.getExprKind(lId) === ExprKind.Tuple;
    return { lhsExprId: lId, rhsNode: exprs[1], isTupleLhs: isTuple, lhsNode: exprs[0] };
  }
  return null;
}

export function lowerSimpleEquation(
  ctx: EquationWalkContext,
  node: EquationCstNode,
  substitutions: Map<string, number | string> | undefined,
  isInitial: boolean | undefined,
): void {
  const { flattener, db, classId, classEntry, prefix, dae, curBreakContext, walk } = ctx;
  // 1. Reject equations referencing components removed by an inheritance `break` modifier.
  if (curBreakContext.brokenComponents.size > 0) {
    const checkNodeForBroken = (n: SyntaxNode | null | undefined): string | null => {
      if (!n) return null;
      if (n.type === "component_reference" || n.type === "name") {
        const text = n.text?.trim() ?? "";
        const root = text.split(".")[0]!.split("[")[0]!;
        if (curBreakContext.brokenComponents.has(root)) {
          return text;
        }
      }
      if (n.children) {
        for (const c of n.children) {
          const b = checkNodeForBroken(c);
          if (b) return b;
        }
      }
      return null;
    };

    const brokenRef = checkNodeForBroken(node);
    if (brokenRef) {
      const startB = node.startIndex ?? node.startOffset;
      const endB = node.endIndex ?? node.endOffset;
      const scopeName = classEntry?.name ?? "";
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
        message: `Variable ${brokenRef} not found in scope ${scopeName}.`,
        range: {
          startOffset: startB,
          endOffset: endB,
          startPosition: node.startPosition,
          endPosition: node.endPosition,
        },
      });
      return;
    }
  }

  // 2. Detect bare class names illegally referenced as component values in equations
  // (excluding function/record constructor calls and the first argument of `size(Class, dim)`).
  if (flattener.db) {
    let classAsComp = node._classAsCompId === classId ? node._classAsComp : undefined;
    if (classAsComp === undefined) {
      const findClassUsedAsComponent = (
        exprNode: EquationCstNode | null | undefined,
        scopeId: SymbolId,
      ): { name: string; node: EquationCstNode } | null => {
        if (!exprNode) return null;
        if (exprNode.type === "for_indices" || exprNode.type === "for_index") {
          return null;
        }
        if (
          exprNode.type === "primary" &&
          exprNode.children?.some((c: SyntaxNode) => c.type === "function_call_args")
        ) {
          const callee = exprNode.childForFieldName?.("callee") ?? exprNode.children?.[0];
          const calleeName = callee?.text?.trim();
          const callArgs = exprNode.children.find((c: SyntaxNode) => c.type === "function_call_args");
          if (calleeName === "size") {
            const funcArgs = callArgs?.children?.find((c: SyntaxNode) => c.type === "function_arguments");
            const nonFirst =
              funcArgs?.children?.filter((c: SyntaxNode) => c.type === "function_arguments_non_first") || [];
            for (const nf of nonFirst) {
              const res = findClassUsedAsComponent(nf as EquationCstNode, scopeId);
              if (res) return res;
            }
            return null;
          }
          return findClassUsedAsComponent(callArgs as EquationCstNode | undefined, scopeId);
        }
        if (exprNode.type === "function_call" || exprNode.type === "call_expression") {
          const callee = exprNode.childForFieldName?.("callee") ?? exprNode.children?.[0];
          const calleeName = callee?.text?.trim();
          for (const arg of exprNode.children || []) {
            if (arg.type === "function_arguments" || arg.type === "function_call_args" || arg.type === "arguments") {
              if (calleeName === "size") {
                const nonFirst =
                  arg.children?.filter((c: SyntaxNode) => c.type === "function_arguments_non_first") || [];
                for (const nf of nonFirst) {
                  const res = findClassUsedAsComponent(nf as EquationCstNode, scopeId);
                  if (res) return res;
                }
                continue;
              }
              for (const c of arg.children || []) {
                const res = findClassUsedAsComponent(c as EquationCstNode, scopeId);
                if (res) return res;
              }
            }
          }
          return null;
        }
        if (exprNode.type === "component_reference") {
          const text = exprNode.text?.trim() ?? "";
          if (text.includes(".")) {
            return null;
          }
          const root = text.split("[")[0];
          if (root && root !== "time") {
            const fullCand = prefix ? `${prefix}.${root}` : root;
            if (
              substitutions?.has(root) ||
              dae.getVarIdxByName(fullCand) >= 0 ||
              dae.getVarIdxByName(root) >= 0 ||
              dae.hasArrayElements(fullCand) ||
              dae.hasArrayElements(root)
            ) {
              return null;
            }
            const res = db.query<NameResolverFn>("resolveSimpleName", scopeId)?.(root);
            if (res && res.kind === "Class") {
              const resMeta = res.metadata as SymbolMetaLike | undefined;
              const kind = String(resMeta?.classKind ?? resMeta?.classPrefixes ?? "").toLowerCase();
              if (!kind.includes("function") && !kind.includes("record")) {
                return { name: root, node: exprNode };
              }
            }
          }
          return null;
        }
        for (const c of exprNode.children || []) {
          const res = findClassUsedAsComponent(c as EquationCstNode, scopeId);
          if (res) return res;
        }
        return null;
      };
      classAsComp = findClassUsedAsComponent(node, classId);
      node._classAsCompId = classId;
      node._classAsComp = classAsComp;
    }

    if (classAsComp) {
      const diagRange = getElementDiagRange(node);
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.CARDINALITY_EXPECTED_COMPONENT.code,
        message: ModelicaErrorCode.CARDINALITY_EXPECTED_COMPONENT.message(classAsComp.name),
        range: diagRange,
      });
      return;
    }
  }

  const sides = extractSimpleEquationSides(node, flattener, dae, prefix, substitutions);
  if (sides) {
    let lhsExprId = sides.lhsExprId;
    const expressions = [sides.lhsNode, sides.rhsNode];
    if (dae.extensionMetadata?.["isOldFrontend"] && lhsExprId >= 0 && dae.getExprKind(lhsExprId) === ExprKind.Name) {
      const rawLhsText = expressions[0]?.text?.trim() ?? "";
      if (isAsciiIdentifier(rawLhsText) && classEntry && db) {
        const vName = dae.interner.resolve(dae.getExprData1(lhsExprId)) ?? "";
        if (
          vName &&
          dae.getVarIdxByName(vName) < 0 &&
          !dae.hasArrayElements(vName) &&
          !flattener.activeLoopVars?.has(rawLhsText) &&
          !(substitutions && substitutions.has(rawLhsText))
        ) {
          const allElems = db.query<SymbolEntry[]>("allElements", classId) ?? db.childrenOf(classId) ?? [];
          if (!allElems.some((e) => e.name === rawLhsText)) {
            const startB = node.startIndex ?? node.startOffset;
            const endB = node.endIndex ?? node.endOffset;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
              message: ModelicaErrorCode.VARIABLE_NOT_FOUND.message(rawLhsText, classEntry.name),
              range: {
                startOffset: startB,
                endOffset: endB,
                startPosition: node.startPosition,
                endPosition: node.endPosition,
              },
            });
            return;
          }
        }
      }
    }
    // 3. Validate tuple LHS `(a, b) = fn(...)`: every tuple element must be a component reference
    // (or `der(...)` / subscripted array of component references), and the RHS must be a single
    // multi-output function call rather than a literal tuple expression.
    const isTupleLhs = dae.getExprKind(lhsExprId) === ExprKind.Tuple;
    if (isTupleLhs) {
      let isAllCompRefs = true;
      const tupleCount = dae.getExprData1(lhsExprId);
      const elemIds: number[] = [];
      if (tupleCount > 0) {
        elemIds.push(dae.getExprLeft(lhsExprId));
        for (let i = 1; i < tupleCount; i++) {
          elemIds.push(dae.getExprLeft(lhsExprId + i));
        }
      }
      const isCompRefOrArrayOfCompRefs = (eId: number): boolean => {
        const k = dae.getExprKind(eId);
        if (k === ExprKind.Name || k === ExprKind.Subscript || k === ExprKind.Der) {
          return true;
        }
        if (k === ExprKind.ArrayCtor && !expressions[0]?.text?.includes("{")) {
          const elems = getArrayCtorElements(eId, dae);
          return elems.length > 0 && elems.every(isCompRefOrArrayOfCompRefs);
        }
        return false;
      };
      for (const elemId of elemIds) {
        if (!isCompRefOrArrayOfCompRefs(elemId)) {
          isAllCompRefs = false;
          break;
        }
      }
      if (!isAllCompRefs) {
        const startB = node.startIndex ?? node.startOffset;
        const endB = node.endIndex ?? node.endOffset;
        const printer = new ArenaDAEPrinter(new StringWriter(), dae, false);
        const lhsStr = printer.printExprToString(lhsExprId);
        let formattedInStr = lhsStr;
        if (dae.extensionMetadata?.["isOldFrontend"]) {
          const rawText = node.text ? collapseAsciiWhitespace(node.text) : "";
          const semiText = rawText.endsWith(";") ? rawText : `${rawText};`;
          formattedInStr = formatPlusOperatorSpacing(semiText);
        }
        dae.diagnostics.push({
          severity: "error",
          message: `Tuple assignment only allowed for tuple of component references in lhs (in ${formattedInStr}).`,
          range: {
            startOffset: startB,
            endOffset: endB,
            startPosition: node.startPosition,
            endPosition: node.endPosition,
          },
        });
        return;
      }
    }
    let rhsExprId = flattener.lowerExpr(expressions[1], dae, prefix, substitutions, isTupleLhs);
    const expRhs = expandColonToArrayCtor(rhsExprId, dae);
    if (expRhs !== null) rhsExprId = expRhs;
    if (lhsExprId < 0 || rhsExprId < 0) {
      return;
    }
    if (checkIfExprTypeMismatch(dae, rhsExprId, node, "<NO COMPONENT>")) {
      return;
    }
    if (checkIfExprTypeMismatch(dae, lhsExprId, node, "<NO COMPONENT>")) {
      return;
    }

    const isCstTupleExpr = (n: SyntaxNode | null | undefined): boolean => {
      if (!n) return false;
      if (n.type === "output_expression_list") return true;
      if (n.type === "function_call_args" || n.type === "function_arguments") return false;
      for (let i = 0; i < (n.childCount ?? (n.children?.length || 0)); i++) {
        const c = n.child ? n.child(i) : n.children[i];
        if (isCstTupleExpr(c)) return true;
      }
      return false;
    };

    if (dae.getExprKind(rhsExprId) === ExprKind.Tuple && isCstTupleExpr(expressions[1])) {
      const startB = node.startIndex ?? node.startOffset;
      const endB = node.endIndex ?? node.endOffset;
      const printer = new ArenaDAEPrinter(new StringWriter(), dae, true);
      const rhsStr = printer.printExprToString(rhsExprId);
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.TUPLE_EXPRESSION_CONTEXT.code,
        message: `Tuple expressions may only occur on the left side of an assignment or equation with a single function call on the right side. Got the following expression: ${rhsStr}.`,
        range: {
          startOffset: startB,
          endOffset: endB,
          startPosition: node.startPosition,
          endPosition: node.endPosition,
        },
      });
      return;
    }

    // Check whether the RHS is a multi-output function call, padding the LHS tuple with
    // wildcard `_` placeholders if fewer LHS targets were provided than function outputs.
    let callExprId = rhsExprId;
    if (
      dae.getExprKind(rhsExprId) === ExprKind.Subscript &&
      dae.getExprKind(dae.getExprData1(rhsExprId)) === ExprKind.Call
    ) {
      callExprId = dae.getExprData1(rhsExprId);
    }
    let isMultiOutputCall = false;
    if (dae.getExprKind(rhsExprId) === ExprKind.Tuple && !isCstTupleExpr(expressions[1])) {
      isMultiOutputCall = true;
    } else if (dae.getExprKind(callExprId) === ExprKind.Call) {
      const fnName = dae.interner.resolve(dae.getExprData1(callExprId));
      const fn = fnName
        ? dae.getFunction(fnName) ||
          dae.getFunction(`${prefix}${fnName}`) ||
          dae.getFunction(fnName.split(".").pop() ?? "")
        : null;
      if (fn) {
        let outCount = 0;
        for (let i = 0; i < fn.varCount; i++) {
          if (fn.getVarCausality(i) === Causality.Output) outCount++;
        }
        if (outCount > 1) {
          isMultiOutputCall = true;
          rhsExprId = callExprId;
          const lhsElems: number[] = [];
          if (dae.getExprKind(lhsExprId) === ExprKind.Tuple) {
            const cnt = dae.getExprData1(lhsExprId);
            if (cnt > 0) {
              lhsElems.push(dae.getExprLeft(lhsExprId));
              for (let i = 1; i < cnt; i++) {
                lhsElems.push(dae.getExprLeft(lhsExprId + i));
              }
            }
          } else {
            const unexpandedLhs = flattener.lowerExpr(expressions[0], dae, prefix, substitutions, false, true);
            lhsElems.push(unexpandedLhs >= 0 ? unexpandedLhs : lhsExprId);
          }
          if (lhsElems.length < outCount) {
            const wildId = dae.addExpression(ExprKind.Name, dae.interner.intern("_"));
            while (lhsElems.length < outCount) {
              lhsElems.push(wildId);
            }
            lhsExprId = dae.addTupleExpr(lhsElems);
          }
        }
      }
    }

    if (isTupleLhs && !isMultiOutputCall) {
      const startB = node.startIndex ?? node.startOffset;
      const endB = node.endIndex ?? node.endOffset;
      const formatSingleTypeStr = (id: number): string => {
        const dims = getExprDims(id, dae, flattener.db);
        let t = inferArenaExprVarType(dae, id);
        if (t === null && dae.getExprKind(id) === ExprKind.Name) {
          const name = dae.interner.resolve(dae.getExprData1(id));
          if (name) {
            const vIdx = dae.getVarIdxByName(name);
            if (vIdx >= 0) t = dae.getVarType(vIdx);
          }
        }
        let baseType = "Real";
        if (t === VarType.Integer || dae.getExprKind(id) === ExprKind.IntLiteral) baseType = "Integer";
        else if (t === VarType.Boolean || dae.getExprKind(id) === ExprKind.BoolLiteral) baseType = "Boolean";
        else if (t === VarType.String || dae.getExprKind(id) === ExprKind.StringLiteral) baseType = "String";
        if (dims && dims.length > 0) {
          return `${baseType}[${dims.join(", ")}]`;
        }
        return baseType;
      };

      const cnt = dae.getExprData1(lhsExprId);
      const lhsElemTypes: string[] = [];
      if (cnt > 0) {
        lhsElemTypes.push(formatSingleTypeStr(dae.getExprLeft(lhsExprId)));
        for (let i = 1; i < cnt; i++) {
          lhsElemTypes.push(formatSingleTypeStr(dae.getExprLeft(lhsExprId + i)));
        }
      }
      const lhsTypeStr = `(${lhsElemTypes.join(", ")})`;
      const rhsDims = getExprDims(rhsExprId, dae, flattener.db);
      let rhsTypeStr = formatSingleTypeStr(rhsExprId);
      if (rhsDims && rhsDims.length > 0 && !rhsTypeStr.includes("[")) {
        rhsTypeStr = `${rhsTypeStr}[${rhsDims.join(", ")}]`;
      }
      let eqText = node.text?.trim() ?? "";
      if (eqText.endsWith(";")) eqText = eqText.slice(0, -1).trim();
      const eqPos = eqText.indexOf("=");
      if (eqPos >= 0) {
        eqText = `${eqText.slice(0, eqPos).trimEnd()} = ${eqText.slice(eqPos + 1).trimStart()}`;
      }

      dae.diagnostics.push({
        severity: ModelicaErrorCode.EQUATION_TYPE_MISMATCH.severity,
        code: ModelicaErrorCode.EQUATION_TYPE_MISMATCH.code,
        message: `Type mismatch in equation ${eqText} of type ${lhsTypeStr} = ${rhsTypeStr}.`,
        range: {
          startOffset: startB,
          endOffset: endB,
          startPosition: node.startPosition,
          endPosition: node.endPosition,
        },
      });
      return;
    }
    if (!isTupleLhs && dae.getExprKind(lhsExprId) !== ExprKind.Tuple && dae.getExprKind(rhsExprId) !== ExprKind.Tuple) {
      if (isRealExpr(lhsExprId, dae) && !isRealExpr(rhsExprId, dae)) {
        rhsExprId = castToRealExpr(rhsExprId, dae);
      }
    }
    const lhsDims = getExprDims(lhsExprId, dae, flattener.db);
    const rhsDims = getExprDims(rhsExprId, dae, flattener.db);
    if ((lhsDims && lhsDims.some((d) => d === 0)) || (rhsDims && rhsDims.some((d) => d === 0))) {
      return;
    }
    const lhsKind = dae.getExprKind(lhsExprId);
    const rhsKind = dae.getExprKind(rhsExprId);
    const emittedEqIndices: number[] = [];

    // 4. Symbolic array constructor expansion (`resolveToArrayCtor`):
    // Recursively materializes nested `ExprKind.ArrayCtor` trees for array variable names,
    // built-in matrix constructors (`identity`, `diagonal`, `zeros`, `ones`, `fill`),
    // element-wise `der(...)` differentiation (folding constant/parameter derivatives to 0.0),
    // and binary array/matrix arithmetic (`+`, `-`, matrix/vector `*`, scalar scaling, `/`, `^`).
    const resolveToArrayCtor = (id: number): number => {
      if (flattener.explicitArrayMode === "preserve") return id;
      const k = dae.getExprKind(id);
      if (k === ExprKind.Name) {
        const vName = dae.interner.resolve(dae.getExprData1(id));
        if (vName && dae.hasArrayElements(vName)) {
          const ctor = expandVarToArrayCtor(vName, dae);
          if (ctor !== null) return ctor;
        }
      } else if (k === ExprKind.Call) {
        const fnName = dae.interner.resolve(dae.getExprData1(id));
        if (fnName && (fnName.startsWith("/*Real") || fnName === "Real")) {
          const inner = resolveToArrayCtor(dae.getExprLeft(id));
          if (dae.getExprKind(inner) === ExprKind.ArrayCtor) {
            return castToRealExpr(inner, dae);
          }
        } else if (fnName === "identity") {
          const argCount = dae.getExprRight(id);
          if (argCount >= 1) {
            const firstArgId = dae.getExprLeft(id);
            const nVal = evalDaeExpr(firstArgId, dae);
            if (typeof nVal === "number" && Number.isInteger(nVal) && nVal > 0) {
              const n = Math.trunc(nVal);
              const rows: number[] = [];
              for (let r = 0; r < n; r++) {
                const cols: number[] = [];
                for (let c = 0; c < n; c++) {
                  cols.push(dae.addIntLiteral(r === c ? 1 : 0));
                }
                rows.push(dae.addArrayCtorExpr(cols));
              }
              return dae.addArrayCtorExpr(rows);
            }
          }
        } else if (fnName === "diagonal") {
          const argCount = dae.getExprRight(id);
          if (argCount >= 1) {
            const firstArgId = dae.getExprLeft(id);
            const vCtor = resolveToArrayCtor(firstArgId);
            if (dae.getExprKind(vCtor) === ExprKind.ArrayCtor) {
              const elems = getArrayCtorElements(vCtor, dae);
              const n = elems.length;
              const isReal = elems.some((e) => isRealExpr(e, dae));
              const zeroLit = isReal ? dae.addRealLiteral(0.0) : dae.addIntLiteral(0);
              const rows: number[] = [];
              for (let r = 0; r < n; r++) {
                const cols: number[] = [];
                for (let c = 0; c < n; c++) {
                  cols.push(r === c ? elems[r]! : zeroLit);
                }
                rows.push(dae.addArrayCtorExpr(cols));
              }
              return dae.addArrayCtorExpr(rows);
            }
          }
        } else if (fnName === "zeros" || fnName === "ones") {
          const argCount = dae.getExprRight(id);
          const dims: number[] = [];
          for (let i = 0; i < argCount; i++) {
            const aId = i === 0 ? dae.getExprLeft(id) : dae.getExprLeft(id + i);
            const v = evalDaeExpr(aId, dae);
            if (typeof v === "number" && Number.isInteger(v) && v > 0) {
              dims.push(Math.trunc(v));
            }
          }
          if (dims.length === argCount && dims.length > 0) {
            const defaultVal = fnName === "zeros" ? 0 : 1;
            const buildZerosOrOnes = (dimIdx: number): number => {
              if (dimIdx === dims.length) {
                return dae.addRealLiteral(defaultVal);
              }
              const children: number[] = [];
              const size = dims[dimIdx]!;
              for (let j = 0; j < size; j++) {
                children.push(buildZerosOrOnes(dimIdx + 1));
              }
              return dae.addArrayCtorExpr(children);
            };
            return buildZerosOrOnes(0);
          }
        } else if (fnName === "fill") {
          const argCount = dae.getExprRight(id);
          if (argCount >= 2) {
            const valId = dae.getExprLeft(id);
            const dims: number[] = [];
            for (let i = 1; i < argCount; i++) {
              const aId = dae.getExprLeft(id + i);
              const v = evalDaeExpr(aId, dae);
              if (typeof v === "number" && Number.isInteger(v) && v > 0) {
                dims.push(Math.trunc(v));
              }
            }
            if (dims.length === argCount - 1 && dims.length > 0) {
              const buildFill = (dimIdx: number): number => {
                if (dimIdx === dims.length) {
                  return valId;
                }
                const children: number[] = [];
                const size = dims[dimIdx]!;
                for (let j = 0; j < size; j++) {
                  children.push(buildFill(dimIdx + 1));
                }
                return dae.addArrayCtorExpr(children);
              };
              return buildFill(0);
            }
          }
        }
      } else if (k === ExprKind.Der || k === ExprKind.Pre) {
        const inner = resolveToArrayCtor(dae.getExprLeft(id));
        if (dae.getExprKind(inner) === ExprKind.ArrayCtor) {
          const distributeOp = (exprId: number): number => {
            if (dae.getExprKind(exprId) === ExprKind.ArrayCtor) {
              const elems = getArrayCtorElements(exprId, dae);
              return dae.addArrayCtorExpr(elems.map((e) => distributeOp(e)));
            }
            if (k === ExprKind.Pre) {
              return dae.addPreExpr(exprId);
            }
            const ek = dae.getExprKind(exprId);
            if (ek === ExprKind.RealLiteral || ek === ExprKind.IntLiteral) {
              return dae.addRealLiteral(0.0);
            }
            if (ek === ExprKind.Name) {
              const vName = dae.interner.resolve(dae.getExprData1(exprId));
              let vIdx = dae.getVarIdxByName(vName);
              if (vIdx >= 0) {
                const varVar = dae.getVarVariability(vIdx);
                if (varVar === Variability.Constant || varVar === Variability.Parameter) {
                  return dae.addRealLiteral(0.0);
                }
              }
            }
            const constVal = evalDaeExpr(exprId, dae);
            if (typeof constVal === "number") {
              return dae.addRealLiteral(0.0);
            }
            return dae.addDerExpr(exprId);
          };
          return distributeOp(inner);
        }
      } else if (k === ExprKind.Binary) {
        const op = dae.getExprData1(id) as BinOp;
        const lInner = resolveToArrayCtor(dae.getExprLeft(id));
        const rInner = resolveToArrayCtor(dae.getExprRight(id));
        const lIsArr = dae.getExprKind(lInner) === ExprKind.ArrayCtor;
        const rIsArr = dae.getExprKind(rInner) === ExprKind.ArrayCtor;
        if (op === BinOp.Add || op === BinOp.Sub) {
          if (lIsArr && rIsArr) {
            return addArrayBinaryExpr(op, lInner, rInner, dae);
          }
        } else if (op === BinOp.Mul) {
          if (lIsArr && rIsArr) {
            return matrixOrVectorMul(lInner, rInner, dae);
          }
          const lDims = getExprDims(lInner, dae, flattener.db);
          const rDims = getExprDims(rInner, dae, flattener.db);
          if (!lIsArr && rIsArr && (!lDims || lDims.length === 0)) {
            const scaleArray = (scalar: number, arr: number): number => {
              const rElems = getArrayCtorElements(arr, dae);
              return dae.addArrayCtorExpr(
                rElems.map((e) => {
                  if (dae.getExprKind(e) === ExprKind.ArrayCtor) {
                    return scaleArray(scalar, e);
                  }
                  const lK = dae.getExprKind(scalar);
                  const eK = dae.getExprKind(e);
                  if (
                    (lK === ExprKind.RealLiteral || lK === ExprKind.IntLiteral) &&
                    (eK === ExprKind.RealLiteral || eK === ExprKind.IntLiteral)
                  ) {
                    const isReal = lK === ExprKind.RealLiteral || eK === ExprKind.RealLiteral;
                    const lV = lK === ExprKind.IntLiteral ? dae.getExprData1(scalar) : dae.getExprRealValue(scalar);
                    const eV = eK === ExprKind.IntLiteral ? dae.getExprData1(e) : dae.getExprRealValue(e);
                    return isReal ? dae.addRealLiteral(lV * eV) : dae.addIntLiteral(lV * eV);
                  }
                  return dae.addBinaryExpr(BinOp.Mul, scalar, e);
                }),
              );
            };
            return scaleArray(lInner, rInner);
          }
          if (lIsArr && !rIsArr && (!rDims || rDims.length === 0)) {
            const scaleArray = (arr: number, scalar: number): number => {
              const lElems = getArrayCtorElements(arr, dae);
              return dae.addArrayCtorExpr(
                lElems.map((e) => {
                  if (dae.getExprKind(e) === ExprKind.ArrayCtor) {
                    return scaleArray(e, scalar);
                  }
                  const rK = dae.getExprKind(scalar);
                  const eK = dae.getExprKind(e);
                  if (
                    (rK === ExprKind.RealLiteral || rK === ExprKind.IntLiteral) &&
                    (eK === ExprKind.RealLiteral || eK === ExprKind.IntLiteral)
                  ) {
                    const isReal = rK === ExprKind.RealLiteral || eK === ExprKind.RealLiteral;
                    const rV = rK === ExprKind.IntLiteral ? dae.getExprData1(scalar) : dae.getExprRealValue(scalar);
                    const eV = eK === ExprKind.IntLiteral ? dae.getExprData1(e) : dae.getExprRealValue(e);
                    return isReal ? dae.addRealLiteral(eV * rV) : dae.addIntLiteral(eV * rV);
                  }
                  return dae.addBinaryExpr(BinOp.Mul, e, scalar);
                }),
              );
            };
            return scaleArray(lInner, rInner);
          }
        } else if (op === BinOp.Div) {
          if (lIsArr && !rIsArr) {
            const divArray = (arr: number, scalar: number): number => {
              const lElems = getArrayCtorElements(arr, dae);
              return dae.addArrayCtorExpr(
                lElems.map((e) => {
                  if (dae.getExprKind(e) === ExprKind.ArrayCtor) {
                    return divArray(e, scalar);
                  }
                  const rK = dae.getExprKind(scalar);
                  const eK = dae.getExprKind(e);
                  if (
                    (rK === ExprKind.RealLiteral || rK === ExprKind.IntLiteral) &&
                    (eK === ExprKind.RealLiteral || eK === ExprKind.IntLiteral)
                  ) {
                    const rV = rK === ExprKind.IntLiteral ? dae.getExprData1(scalar) : dae.getExprRealValue(scalar);
                    const eV = eK === ExprKind.IntLiteral ? dae.getExprData1(e) : dae.getExprRealValue(e);
                    if (rV !== 0) {
                      return dae.addRealLiteral(eV / rV);
                    }
                  }
                  return dae.addBinaryExpr(BinOp.Div, e, scalar);
                }),
              );
            };
            return divArray(lInner, rInner);
          }
        } else if (op === BinOp.Pow) {
          if (lIsArr) {
            let powVal: number | null = null;
            if (dae.getExprKind(rInner) === ExprKind.IntLiteral) {
              powVal = dae.getExprData1(rInner);
            } else if (dae.getExprKind(rInner) === ExprKind.RealLiteral) {
              powVal = dae.getExprRealValue(rInner);
            }
            if (powVal !== null && Number.isInteger(powVal) && powVal >= 0) {
              return matrixPower(lInner, powVal, dae);
            }
          }
        }
      }
      return id;
    };

    const expandedLhs = resolveToArrayCtor(lhsExprId);
    const expandedRhs = resolveToArrayCtor(rhsExprId);

    // 5. Verify array rank and dimension compatibility between expanded LHS and RHS.
    const effectiveLhsDims = getExprDims(expandedLhs, dae, flattener.db) ?? getExprDims(lhsExprId, dae, flattener.db);
    const effectiveRhsDims = getExprDims(expandedRhs, dae, flattener.db) ?? getExprDims(rhsExprId, dae, flattener.db);
    const hasLeftDims = effectiveLhsDims !== null && effectiveLhsDims.length > 0;
    const hasRightDims = effectiveRhsDims !== null && effectiveRhsDims.length > 0;

    let dimsMismatch = false;
    if (hasLeftDims && hasRightDims) {
      dimsMismatch =
        effectiveLhsDims!.length !== effectiveRhsDims!.length ||
        effectiveLhsDims!.some((d, i) => d !== effectiveRhsDims![i] && d !== -1 && effectiveRhsDims![i] !== -1);
    } else if (hasLeftDims && !hasRightDims && isDefinitelyScalarExpr(expandedRhs, dae)) {
      dimsMismatch = true;
    } else if (!hasLeftDims && hasRightDims && isDefinitelyScalarExpr(expandedLhs, dae)) {
      dimsMismatch = true;
    }

    if (dimsMismatch) {
      const formatTypeStr = (id: number, dims: number[] | null): string => {
        let t = inferArenaExprVarType(dae, id);
        if (t === null && dae.getExprKind(id) === ExprKind.Name) {
          const name = dae.interner.resolve(dae.getExprData1(id));
          if (name) {
            const vIdx =
              dae.getVarIdxByName(`${name}[1]`) >= 0
                ? dae.getVarIdxByName(`${name}[1]`)
                : dae.getVarIdxByName(`${name}[1,1]`);
            if (vIdx >= 0) t = dae.getVarType(vIdx);
          }
        }
        let baseType = "Real";
        if (t === VarType.Integer || dae.getExprKind(id) === ExprKind.IntLiteral) baseType = "Integer";
        else if (t === VarType.Boolean || dae.getExprKind(id) === ExprKind.BoolLiteral) baseType = "Boolean";
        else if (t === VarType.String || dae.getExprKind(id) === ExprKind.StringLiteral) baseType = "String";
        if (dims && dims.length > 0) {
          return `${baseType}[${dims.join(", ")}]`;
        }
        return baseType;
      };
      const printer = new ArenaDAEPrinter(new StringWriter(), dae, true);
      const lhsExpanded = printer.printExprToString(expandedLhs);
      const rhsExpanded = printer.printExprToString(expandedRhs);
      const lhsTypeStr = formatTypeStr(expandedLhs, effectiveLhsDims);
      const rhsTypeStr = formatTypeStr(expandedRhs, effectiveRhsDims);
      const startB = node.startIndex ?? node.startOffset;
      const endB = node.endIndex ?? node.endOffset;
      dae.diagnostics.push({
        severity: ModelicaErrorCode.EQUATION_TYPE_MISMATCH.severity,
        code: ModelicaErrorCode.EQUATION_TYPE_MISMATCH.code,
        message: ModelicaErrorCode.EQUATION_TYPE_MISMATCH.message(lhsExpanded, rhsExpanded, lhsTypeStr, rhsTypeStr),
        range: {
          startOffset: startB,
          endOffset: endB,
          startPosition: node.startPosition,
          endPosition: node.endPosition,
        },
      });
      return;
    }

    // 6. Recursively unroll matching `ExprKind.ArrayCtor` pairs into scalar `EqKind.Simple`
    // equations, normalizing `literal = var` into `var = literal` and coercing Integer to Real.
    const emitEq = (lId: number, rId: number) => {
      const lK = dae.getExprKind(lId);
      const rK = dae.getExprKind(rId);
      if (lK === ExprKind.ArrayCtor && rK === ExprKind.ArrayCtor) {
        const lElems = getArrayCtorElements(lId, dae);
        const rElems = getArrayCtorElements(rId, dae);
        if (lElems.length === rElems.length && lElems.length > 0) {
          for (let i = 0; i < lElems.length; i++) {
            emitEq(lElems[i]!, rElems[i]!);
          }
          return;
        }
      }
      const isLhsLiteral =
        lK === ExprKind.EnumLiteral ||
        lK === ExprKind.IntLiteral ||
        lK === ExprKind.RealLiteral ||
        lK === ExprKind.BoolLiteral ||
        lK === ExprKind.StringLiteral;
      const isRhsVar = rK === ExprKind.Name || rK === ExprKind.Subscript || rK === ExprKind.Der;

      let finalLhs = lId;
      let finalRhs = rId;
      if (isLhsLiteral && isRhsVar) {
        finalLhs = rId;
        finalRhs = lId;
      }
      if (dae.getExprKind(finalLhs) !== ExprKind.Tuple && dae.getExprKind(finalRhs) !== ExprKind.Tuple) {
        if (isRealExpr(finalLhs, dae) && !isRealExpr(finalRhs, dae)) {
          finalRhs = castToRealExpr(finalRhs, dae);
        } else if (
          (flattener.isOldFrontend || dae.extensionMetadata?.["isOldFrontend"]) &&
          !isRealExpr(finalLhs, dae) &&
          isRealExpr(finalRhs, dae)
        ) {
          let lhsType = inferArenaExprVarType(dae, finalLhs);
          if (lhsType === null && dae.getExprKind(finalLhs) === ExprKind.Subscript) {
            const baseId = dae.getExprData1(finalLhs);
            if (dae.getExprKind(baseId) === ExprKind.Name) {
              const baseName = dae.interner.resolve(dae.getExprData1(baseId));
              const vIdx = dae.getVarIdxByName(`${baseName}[1]`);
              if (vIdx >= 0) lhsType = dae.getVarType(vIdx);
            }
          }
          if (lhsType === VarType.Integer) {
            finalLhs = castToRealExpr(finalLhs, dae);
          }
        }
      }
      const eqIdx = dae.addEquation(isInitial ? EqKind.InitialSimple : EqKind.Simple, finalLhs, finalRhs);
      if (eqIdx >= 0) emittedEqIndices.push(eqIdx);
      const startB = node.startIndex ?? node.startOffset;
      const endB = node.endIndex ?? node.endOffset;
      if (startB != null && endB != null && eqIdx >= 0) {
        dae.setEqSourceRange(eqIdx, startB, endB);
      }
    };
    const isSyncArrayCall = (exprId: number): boolean => {
      if (exprId < 0) return false;
      let curr = exprId;
      if (dae.getExprKind(curr) === ExprKind.Call) {
        const fn = dae.interner.resolve(dae.getExprData1(curr));
        if (fn && fn.startsWith("/*Real")) {
          curr = dae.getExprLeft(curr);
        }
      }
      if (dae.getExprKind(curr) === ExprKind.Call) {
        const fn = dae.interner.resolve(dae.getExprData1(curr));
        if (fn === "subSample" || fn === "superSample") {
          const firstArg = dae.getExprLeft(curr);
          const firstDims = getExprDims(firstArg, dae, flattener.db);
          return Boolean(firstDims && firstDims.length > 0);
        }
      }
      return false;
    };
    const isCardinalityCall = (exprId: number): boolean => {
      if (exprId < 0) return false;
      if (dae.getExprKind(exprId) === ExprKind.Call) {
        const fn = dae.interner.resolve(dae.getExprData1(exprId));
        if (fn === "cardinality") return true;
      }
      return false;
    };

    const isArrayReturningCall = (exprId: number): boolean => {
      if (exprId < 0) return false;
      const k = dae.getExprKind(exprId);
      if (k === ExprKind.Call) {
        const fn = dae.interner.resolve(dae.getExprData1(exprId));
        if (fn && (fn.startsWith("/*Real") || fn === "Real")) return false;
        const fnDims = getExprDims(exprId, dae, flattener.db);
        return Boolean(fnDims && fnDims.length > 0);
      }
      if (k === ExprKind.Negate || k === ExprKind.Unary) {
        return isArrayReturningCall(dae.getExprLeft(exprId));
      }
      if (k === ExprKind.Binary) {
        return isArrayReturningCall(dae.getExprLeft(exprId)) || isArrayReturningCall(dae.getExprRight(exprId));
      }
      return false;
    };

    // If the RHS is an opaque array-returning function call (or synchronous `subSample`/`superSample`),
    // emit a whole-array `EqKind.Array` equation with the unsubscripted LHS base array name.
    if (
      hasLeftDims &&
      dae.getExprKind(expandedRhs) !== ExprKind.ArrayCtor &&
      (isSyncArrayCall(rhsExprId) || isCardinalityCall(rhsExprId) || isArrayReturningCall(rhsExprId))
    ) {
      let finalLhs = lhsExprId;
      if (dae.getExprKind(finalLhs) === ExprKind.ArrayCtor) {
        let firstElem = dae.getExprLeft(finalLhs);
        while (firstElem >= 0 && dae.getExprKind(firstElem) === ExprKind.ArrayCtor) {
          firstElem = dae.getExprLeft(firstElem);
        }
        const firstElemKind = firstElem >= 0 ? dae.getExprKind(firstElem) : -1;
        if (firstElemKind === ExprKind.Pre || firstElemKind === ExprKind.Der) {
          const innerId = dae.getExprData1(firstElem);
          if (innerId >= 0 && dae.getExprKind(innerId) === ExprKind.Name) {
            const elemName = dae.interner.resolve(dae.getExprData1(innerId));
            if (elemName && elemName.includes("[")) {
              const baseNameExpr = dae.addNameExpr(elemName.split("[")[0]!);
              finalLhs = firstElemKind === ExprKind.Pre ? dae.addPreExpr(baseNameExpr) : dae.addDerExpr(baseNameExpr);
            }
          }
        } else if (firstElem >= 0 && dae.getExprKind(firstElem) === ExprKind.Name) {
          const elemName = dae.interner.resolve(dae.getExprData1(firstElem));
          if (elemName && elemName.includes("[")) {
            finalLhs = dae.addNameExpr(elemName.split("[")[0]!);
          }
        }
      }
      let finalRhs = rhsExprId;
      if (isRealExpr(finalLhs, dae) && !isRealExpr(finalRhs, dae)) {
        finalRhs = castToRealExpr(finalRhs, dae);
      }
      const shape = effectiveLhsDims && effectiveLhsDims.length > 0 ? effectiveLhsDims : [1];
      const eqIdx =
        typeof dae.addArrayEquation === "function"
          ? dae.addArrayEquation(finalLhs, finalRhs, shape)
          : dae.addEquation(EqKind.Array, finalLhs, finalRhs);
      if (eqIdx >= 0) emittedEqIndices.push(eqIdx);
      const startB = node.startIndex ?? node.startOffset;
      const endB = node.endIndex ?? node.endOffset;
      if (startB != null && endB != null && eqIdx >= 0) {
        dae.setEqSourceRange(eqIdx, startB, endB);
      }
    } else if (
      flattener.options.arrayMode === "preserve" &&
      hasLeftDims &&
      hasRightDims &&
      !dimsMismatch &&
      dae.getExprKind(expandedRhs) !== ExprKind.ArrayCtor
    ) {
      let finalLhs = lhsExprId;
      let finalRhs = rhsExprId;
      if (isRealExpr(finalLhs, dae) && !isRealExpr(finalRhs, dae)) {
        finalRhs = castToRealExpr(finalRhs, dae);
      }
      const shape = effectiveLhsDims && effectiveLhsDims.length > 0 ? effectiveLhsDims : [1];
      const eqIdx =
        !isInitial && typeof dae.addArrayEquation === "function"
          ? dae.addArrayEquation(finalLhs, finalRhs, shape)
          : dae.addEquation(isInitial ? EqKind.InitialSimple : EqKind.Array, finalLhs, finalRhs);
      if (eqIdx >= 0) emittedEqIndices.push(eqIdx);
      const startB = node.startIndex ?? node.startOffset;
      const endB = node.endIndex ?? node.endOffset;
      if (startB != null && endB != null && eqIdx >= 0) {
        dae.setEqSourceRange(eqIdx, startB, endB);
      }
    } else {
      emitEq(expandedLhs, expandedRhs);
    }

    // Check equation annotation for diffusion (SDE) and equation description (cached per CST node)
    let eqStaticMeta = node._eqStaticMeta;
    if (eqStaticMeta === undefined) {
      const p1 = node.parent;
      const p2 = p1?.parent;
      const checkP1 = p1 && p1.type !== "equation_section" && p1.type !== "composition";
      const checkP2 = p2 && p2.type !== "equation_section" && p2.type !== "composition";
      const hasDiffusionHint =
        node.text?.includes("diffusion") ||
        (checkP1 && p1.text?.includes("diffusion")) ||
        (checkP2 && p2.text?.includes("diffusion"));
      const diffVal = hasDiffusionHint
        ? (sharedAnnotationEvaluator.evaluate(node, "diffusion") ??
          (checkP1 ? sharedAnnotationEvaluator.evaluate(p1, "diffusion") : null) ??
          (checkP2 ? sharedAnnotationEvaluator.evaluate(p2, "diffusion") : null))
        : null;
      let t = "";
      for (const c of node.children || []) {
        if (c.type === "description" || c.type === "description_string" || c.type === "string_literal") {
          t = c.text?.trim() ?? "";
          break;
        }
        if (c.type === "comment") {
          const sc = (c.children || []).find(
            (ch: SyntaxNode) =>
              ch.type === "description" || ch.type === "description_string" || ch.type === "string_literal",
          );
          if (sc) {
            t = sc.text?.trim() ?? "";
            break;
          }
        }
      }
      if (!t) {
        let p = node.parent;
        while (p && p.type !== "equation_section" && p.type !== "composition") {
          for (const c of p.children || []) {
            if (c.type === "description" || c.type === "description_string" || c.type === "string_literal") {
              t = c.text?.trim() ?? "";
              break;
            }
            if (c.type === "comment") {
              const sc = (c.children || []).find(
                (ch: SyntaxNode) =>
                  ch.type === "description" || ch.type === "description_string" || ch.type === "string_literal",
              );
              if (sc) {
                t = sc.text?.trim() ?? "";
                break;
              }
            }
          }
          if (t) break;
          p = p.parent;
        }
      }
      if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
      eqStaticMeta = { diffVal, description: t };
      node._eqStaticMeta = eqStaticMeta;
    }
    const { diffVal, description: t } = eqStaticMeta;
    if (diffVal !== null && diffVal !== undefined) {
      let stateVarIdx = -1;
      const derExpr = lhsKind === ExprKind.Der ? lhsExprId : rhsKind === ExprKind.Der ? rhsExprId : -1;
      if (derExpr >= 0) {
        const derArgId = dae.getExprData1(derExpr);
        if (dae.getExprKind(derArgId) === ExprKind.Name) {
          const nameId = dae.getExprData1(derArgId);
          const varName = dae.interner.resolve(nameId);
          stateVarIdx = dae.findVar(varName);
        }
      }
      if (stateVarIdx >= 0) {
        let diffExprId: number;
        const diffObj = typeof diffVal === "object" ? (diffVal as DiffusionAnnotationVal) : null;
        if (typeof diffVal === "number") {
          diffExprId = dae.addRealLiteral(diffVal);
        } else if (diffObj && diffObj.coefficient !== undefined) {
          diffExprId =
            typeof diffObj.coefficient === "number"
              ? dae.addRealLiteral(diffObj.coefficient)
              : addArenaValueAsExpr(dae, diffObj.coefficient, VarType.Real);
        } else if (diffObj && diffObj.value !== undefined) {
          diffExprId =
            typeof diffObj.value === "number"
              ? dae.addRealLiteral(diffObj.value)
              : addArenaValueAsExpr(dae, diffObj.value, VarType.Real);
        } else {
          diffExprId = addArenaValueAsExpr(dae, diffVal, VarType.Real);
        }
        dae.stochastic.addDiffusion(stateVarIdx, diffExprId);
      }
    }
    if (t && emittedEqIndices.length > 0) {
      for (const eqId of emittedEqIndices) {
        dae.setEqDescription(eqId, t);
      }
    }
    return;
  }
  for (const kid of (node.children || []) as EquationCstNode[]) {
    if (kid.type !== "class_definition") {
      walk(kid, substitutions, isInitial);
    }
  }
}
