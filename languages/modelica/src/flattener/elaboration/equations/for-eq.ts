// SPDX-License-Identifier: AGPL-3.0-or-later

import { EqKind, ExprKind, VarType } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import { isAsciiDigitsOnly } from "../../expressions/cst-utils.js";
import {
  castToRealExpr,
  evaluateCSTNumber,
  evaluateEnumRange,
  findArraySubscriptsForIter,
  findImplicitArrayDim,
  flattenColonNodes,
  getArrayLiteralItems,
  isRealExpr,
} from "../../expressions/index.js";
import { extractSimpleEquationSides } from "./simple-eq.js";
import type { EquationCstNode, EquationWalkContext, LoweredBodyEquation } from "./types.js";

export function lowerForEquation(
  ctx: EquationWalkContext,
  node: EquationCstNode,
  substitutions: Map<string, number | string> | undefined,
  isInitial: boolean | undefined,
): void {
  const { flattener, classId, prefix, dae, walk } = ctx;
  const indicesNode = Cst.ForEquation.indices(node);
  const forIndexNodes: SyntaxNode[] = [];
  if (indicesNode) {
    if (Cst.ForIndex.is(indicesNode)) {
      forIndexNodes.push(indicesNode);
    } else {
      for (const c of indicesNode.children || []) {
        if (Cst.ForIndex.is(c)) {
          forIndexNodes.push(c);
        }
      }
    }
  }

  const bodyNodes: EquationCstNode[] = [];
  let inLoop = false;
  for (const child of node.children || []) {
    const t = child.text?.trim() ?? "";
    const ty = child.type ?? "";
    if (t === "loop" || ty === '"loop"') {
      inLoop = true;
      continue;
    }
    if (t === "end for" || ty === '"end for"') {
      inLoop = false;
      break;
    }
    if (inLoop) {
      if (t !== ";" && ty !== '";"') {
        bodyNodes.push(child);
      }
    }
  }
  if (bodyNodes.length === 0) {
    for (const child of node.children || []) {
      if (
        child.type !== "for" &&
        child.type !== "loop" &&
        child.type !== "end for" &&
        child.type !== "for_indices" &&
        child.type !== "for_index" &&
        child !== indicesNode &&
        child.text?.trim() !== ";"
      ) {
        bodyNodes.push(child);
      }
    }
  }

  // Resolves the sequence of discrete iteration values (numbers or enum literal strings)
  // for a single `for_index` clause under the current outer loop `currentSubs`.
  const getForIndexValues = (fIndex: SyntaxNode, currentSubs: Map<string, number | string>): (number | string)[] => {
    const rangeNode = Cst.ForIndex.range(fIndex) || fIndex.children?.find?.((c: SyntaxNode) => c.type === "expression");
    if (!rangeNode) {
      const varName = Cst.ForIndex.variable(fIndex)?.text?.trim() || fIndex.child(0)?.text?.trim();
      if (varName) {
        const subs = findArraySubscriptsForIter(bodyNodes, varName, dae, flattener.db, prefix, true, fIndex);
        if (subs.length > 0) return subs;
        const implicitDim = findImplicitArrayDim(bodyNodes, varName, dae);
        if (implicitDim && implicitDim > 0) {
          return Array.from({ length: implicitDim }, (_, i) => i + 1);
        }
      }
      return [1];
    }

    const prevDiagCount = dae.diagnostics.length;
    flattener.lowerExpr(rangeNode, dae, prefix, currentSubs);
    if (dae.diagnostics.slice(prevDiagCount).some((d) => d.severity === "error")) {
      return [];
    }

    const rangeText = rangeNode.text?.trim() ?? "";
    if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
      const enumVals = evaluateEnumRange(rangeNode, currentSubs, classId, flattener.db, dae, prefix);
      if (enumVals !== null && enumVals.length > 0) return enumVals;
      const items = getArrayLiteralItems(rangeNode);
      const vals: number[] = [];
      for (const item of items) {
        const v = evaluateCSTNumber(item, currentSubs, classId, flattener.db, dae, prefix);
        if (v !== null) vals.push(v);
      }
      if (vals.length > 0) return vals;
    }

    const colonNodes = flattenColonNodes(rangeNode);
    if (colonNodes.length >= 2) {
      const enumVals = evaluateEnumRange(rangeNode, currentSubs, classId, flattener.db, dae, prefix);
      if (enumVals !== null) return enumVals;

      const sVal = evaluateCSTNumber(colonNodes[0], currentSubs, classId, flattener.db, dae, prefix);
      let stVal: number | null = 1;
      let eVal: number | null = null;
      if (colonNodes.length === 2) {
        eVal = evaluateCSTNumber(colonNodes[1], currentSubs, classId, flattener.db, dae, prefix);
      } else if (colonNodes.length >= 3) {
        stVal = evaluateCSTNumber(colonNodes[1], currentSubs, classId, flattener.db, dae, prefix);
        eVal = evaluateCSTNumber(colonNodes[2], currentSubs, classId, flattener.db, dae, prefix);
      }

      if (sVal === null || eVal === null || stVal === null) {
        let formattedRangeText = rangeText;
        const isOldInst = Boolean(
          dae.extensionMetadata?.["isOldFrontend"] ||
          flattener?.options?.isOldFrontend ||
          dae.extensionMetadata?.["hasOldInstOption"],
        );
        if (!isOldInst && colonNodes.length === 2) {
          const n0Text = colonNodes[0]?.text?.trim() ?? "";
          const n1Text = colonNodes[1]?.text?.trim() ?? "";
          const v1Idx = dae.getVarIdxByName(prefix ? `${prefix}.${n1Text}` : n1Text);
          if (v1Idx >= 0 && dae.getVarType(v1Idx) === VarType.Real && isAsciiDigitsOnly(n0Text)) {
            formattedRangeText = `${n0Text}.0:${n1Text}`;
          }
        }
        dae.diagnostics.push({
          severity: "error",
          message: `The iteration range ${formattedRangeText} is not a constant or parameter expression.`,
          range: node
            ? {
                startPosition: node.startPosition,
                endPosition: node.endPosition,
              }
            : undefined,
        });
        return [];
      }

      let startVal = sVal;
      let stopVal = eVal;
      let stepVal = stVal;

      const result: number[] = [];
      if (stepVal > 0) {
        for (let v = startVal; v <= stopVal; v += stepVal) {
          result.push(v);
        }
      } else if (stepVal < 0) {
        for (let v = startVal; v >= stopVal; v += stepVal) {
          result.push(v);
        }
      }
      return result;
    }

    const singleVal = evaluateCSTNumber(rangeNode, currentSubs, classId, flattener.db, dae, prefix);
    if (singleVal !== null) {
      const sType = Number.isInteger(singleVal) ? "Integer" : "Real";
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
        message: `Type error in iteration range '${rangeText}'. Expected array got ${sType}.`,
        range: node
          ? {
              startPosition: node.startPosition,
              endPosition: node.endPosition,
            }
          : undefined,
      });
      return [];
    }

    const enumVals = evaluateEnumRange(rangeNode, currentSubs, classId, flattener.db, dae, prefix);
    if (enumVals !== null) return enumVals;

    return [1];
  };

  // Recursively unrolls multi-dimensional `for` indices by binding each iterator variable
  // in `currentSubs` and walking `bodyNodes` at the innermost level.
  const unroll = (indexIdx: number, currentSubs: Map<string, number | string>) => {
    if (indexIdx >= forIndexNodes.length) {
      for (const bodyChild of bodyNodes) {
        walk(bodyChild, currentSubs, isInitial);
      }
      return;
    }
    const fIndex = forIndexNodes[indexIdx]!;
    const varName = Cst.ForIndex.variable(fIndex)?.text?.trim() || fIndex.child(0)?.text?.trim();
    const iterVals = getForIndexValues(fIndex, currentSubs);
    for (const v of iterVals) {
      const nextSubs = new Map<string, number | string>(currentSubs);
      if (varName) nextSubs.set(varName, v);
      unroll(indexIdx + 1, nextSubs);
    }
  };
  const diagBeforeForCheck = dae.diagnostics.length;
  const totalEstimated = forIndexNodes.reduce((acc, fIndex) => {
    const vals = getForIndexValues(fIndex, substitutions || new Map());
    return acc * Math.max(1, vals.length);
  }, 1);
  const hasForDiagError = dae.diagnostics.slice(diagBeforeForCheck).some((d) => d.severity === "error");

  const containsUnpreservableEq = (n: SyntaxNode | null | undefined): boolean => {
    if (!n) return false;
    if (
      n.type === "connect_equation" ||
      Cst.ConnectEquation.is(n) ||
      n.type === "when_equation" ||
      Cst.WhenEquation.is(n)
    ) {
      return true;
    }
    for (const c of n.children || []) {
      if (containsUnpreservableEq(c)) return true;
    }
    return false;
  };

  // Preserve `for` loops as symbolic `EqKind.For` arena equations when `arrayMode === "preserve"`
  // and the loop body does not contain `connect()` or `when` equations.
  const shouldPreserveFor =
    !hasForDiagError &&
    forIndexNodes.length > 0 &&
    (flattener.explicitArrayMode === "preserve" ||
      (totalEstimated > 5000 && flattener.options.arrayMode === "preserve")) &&
    !bodyNodes.some(containsUnpreservableEq);

  if (shouldPreserveFor) {
    const lowerForBodyNode = (n: SyntaxNode | null | undefined): LoweredBodyEquation[] => {
      if (!n) return [];
      if (n.type === "some_equation" && n.childCount === 1) n = n.child(0);
      if (!n) return [];
      if (Cst.ForEquation.is(n) || n.type === "for_equation") {
        const subIndicesNode =
          Cst.ForEquation.indices(n) || n.children?.find((c: SyntaxNode) => c.type === "for_indices");
        const subForIndices = subIndicesNode
          ? (subIndicesNode.children || []).filter((c: SyntaxNode) => Cst.ForIndex.is(c) || c.type === "for_index")
          : (n.children || []).filter((c: SyntaxNode) => Cst.ForIndex.is(c) || c.type === "for_index");
        const subBodyNodes: SyntaxNode[] = [];
        let seenLoop = false;
        for (const child of n.children || []) {
          const t = child.text?.trim();
          if (t === "loop" || child.type === "loop") {
            seenLoop = true;
            continue;
          }
          if (t === "end for" || child.type === "end for") break;
          if (seenLoop && t !== ";") subBodyNodes.push(child);
        }
        const buildNestedFor = (idx: number): LoweredBodyEquation[] => {
          if (idx >= subForIndices.length) {
            const out: LoweredBodyEquation[] = [];
            for (const sb of subBodyNodes) out.push(...lowerForBodyNode(sb));
            return out;
          }
          const fi = subForIndices[idx]!;
          const vName = Cst.ForIndex.variable(fi)?.text?.trim() || fi.child(0)?.text?.trim() || "i";
          const rNode = Cst.ForIndex.range(fi) || fi.children?.find?.((c: SyntaxNode) => c.type === "expression");
          const rExprId = rNode
            ? flattener.lowerExpr(rNode, dae, prefix, substitutions)
            : dae.addExpression(ExprKind.Range, dae.addIntLiteral(1), -1, dae.addIntLiteral(1));
          flattener.pushLoopVar(vName);
          let innerEqs: LoweredBodyEquation[] = [];
          try {
            innerEqs = buildNestedFor(idx + 1);
          } finally {
            flattener.popLoopVar(vName);
          }
          return [
            {
              kind: isInitial ? EqKind.InitialFor : EqKind.For,
              lhsExprId: dae.interner.intern(vName),
              rhsExprId: rExprId,
              bodyEquations: innerEqs,
            },
          ];
        };
        return buildNestedFor(0);
      }
      if (Cst.IfEquation.is(n) || n.type === "if_equation") {
        interface SubIfBranch {
          conditionNode?: SyntaxNode;
          equationNodes: SyntaxNode[];
        }
        const subBranches: SubIfBranch[] = [];
        let curB: SubIfBranch | null = null;
        let inCond = false;
        let inB = false;
        for (const child of n.children || []) {
          const text = child.text?.trim() ?? "";
          const type = child.type ?? "";
          if (text === "if" || type === '"if"' || text === "elseif" || type === '"elseif"') {
            inCond = true;
            inB = false;
            curB = { equationNodes: [] };
            subBranches.push(curB);
          } else if (text === "else" || type === '"else"') {
            inCond = false;
            inB = true;
            curB = { equationNodes: [] };
            subBranches.push(curB);
          } else if (text === "then" || type === '"then"') {
            inCond = false;
            inB = true;
          } else if (text === "end if" || type === '"end if"') {
            inCond = false;
            inB = false;
            curB = null;
          } else if (inCond && curB && !curB.conditionNode) {
            curB.conditionNode = child;
          } else if (inB && curB && text !== ";" && type !== '";"') {
            curB.equationNodes.push(child);
          }
        }
        if (subBranches.length > 0 && subBranches[0]!.conditionNode) {
          const subCondId = flattener.lowerExpr(subBranches[0]!.conditionNode, dae, prefix, substitutions);
          const subThen: LoweredBodyEquation[] = [];
          for (const eqN of subBranches[0]!.equationNodes) subThen.push(...lowerForBodyNode(eqN));
          const subElseIf: {
            conditionExprId: number;
            bodyEquations: LoweredBodyEquation[];
            equations: { kind: EqKind; lhs: number; rhs: number }[];
          }[] = [];
          const subElse: LoweredBodyEquation[] = [];
          for (let bi = 1; bi < subBranches.length; bi++) {
            const sb = subBranches[bi]!;
            if (sb.conditionNode) {
              const eCondId = flattener.lowerExpr(sb.conditionNode, dae, prefix, substitutions);
              const bEqs: LoweredBodyEquation[] = [];
              for (const eqN of sb.equationNodes) bEqs.push(...lowerForBodyNode(eqN));
              subElseIf.push({ conditionExprId: eCondId, bodyEquations: bEqs, equations: [] });
            } else {
              for (const eqN of sb.equationNodes) subElse.push(...lowerForBodyNode(eqN));
            }
          }
          return [
            {
              kind: EqKind.If,
              lhsExprId: subCondId,
              rhsExprId: -1,
              thenEquations: subThen,
              elseIfClauses: subElseIf,
              elseEquations: subElse,
            },
          ];
        }
        return [];
      }
      if (n.type === "simple_equation") {
        const sides = extractSimpleEquationSides(n, flattener, dae, prefix, substitutions);
        if (sides) {
          let lId = sides.lhsExprId;
          let rId = flattener.lowerExpr(sides.rhsNode, dae, prefix, substitutions);
          if (isRealExpr(lId, dae) && !isRealExpr(rId, dae)) {
            rId = castToRealExpr(rId, dae);
          }
          return [{ kind: EqKind.Simple, lhsExprId: lId, rhsExprId: rId }];
        }
      }
      if (n.type === "function_call") {
        const callId = flattener.lowerExpr(n, dae, prefix, substitutions);
        return [
          {
            kind: isInitial ? EqKind.InitialFunctionCall : EqKind.FunctionCall,
            lhsExprId: callId,
            rhsExprId: -1,
          },
        ];
      }
      for (const kid of n.children || []) {
        const res = lowerForBodyNode(kid);
        if (res.length > 0) return res;
      }
      return [];
    };

    const buildForLevel = (indexIdx: number): LoweredBodyEquation[] => {
      if (indexIdx >= forIndexNodes.length) {
        const out: LoweredBodyEquation[] = [];
        for (const bodyChild of bodyNodes) {
          out.push(...lowerForBodyNode(bodyChild));
        }
        return out;
      }
      const fIndex = forIndexNodes[indexIdx]!;
      const varName = Cst.ForIndex.variable(fIndex)?.text?.trim() || fIndex.child(0)?.text?.trim() || "i";
      const rangeNode =
        Cst.ForIndex.range(fIndex) || fIndex.children?.find?.((c: SyntaxNode) => c.type === "expression");
      let rangeExprId: number;
      if (rangeNode) {
        rangeExprId = flattener.lowerExpr(rangeNode, dae, prefix, substitutions);
      } else {
        const vals = getForIndexValues(fIndex, substitutions || new Map());
        rangeExprId = dae.addExpression(
          ExprKind.Range,
          dae.addIntLiteral(1),
          -1,
          dae.addIntLiteral(Math.max(1, vals.length)),
        );
      }
      flattener.pushLoopVar(varName);
      let innerEqs: LoweredBodyEquation[] = [];
      try {
        innerEqs = buildForLevel(indexIdx + 1);
      } finally {
        flattener.popLoopVar(varName);
      }
      const indexNameId = dae.interner.intern(varName);
      if (indexIdx === 0) {
        const forEqIdx = dae.addForEquation(indexNameId, rangeExprId);
        if (isInitial) {
          dae.setEqKind(forEqIdx, EqKind.InitialFor);
        }
        const forMeta = dae.getForEquationMeta(forEqIdx);
        if (forMeta) {
          forMeta.bodyEquations.push(...innerEqs);
        }
        return [];
      }
      return [
        {
          kind: isInitial ? EqKind.InitialFor : EqKind.For,
          lhsExprId: indexNameId,
          rhsExprId: rangeExprId,
          bodyEquations: innerEqs,
        },
      ];
    };

    buildForLevel(0);
    return;
  }

  unroll(0, new Map<string, number | string>(substitutions || []));
  return;
}
