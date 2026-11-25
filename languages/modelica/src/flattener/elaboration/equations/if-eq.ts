// SPDX-License-Identifier: AGPL-3.0-or-later

import { EqKind, ExprKind, Variability, VarType } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import {
  castToRealExpr,
  evalDaeExpr,
  expandVarToArrayCtor,
  getArrayCtorElements,
  isRealExpr,
} from "../../expressions/index.js";
import { getFlatteningState } from "../../support/state.js";
import { isCstNode } from "./cst-helpers.js";
import { extractSimpleEquationSides } from "./simple-eq.js";
import type { EquationCstNode, EquationWalkContext, LoweredBodyEquation } from "./types.js";

export function lowerIfEquation(
  ctx: EquationWalkContext,
  node: EquationCstNode,
  substitutions: Map<string, number | string> | undefined,
  isInitial: boolean | undefined,
): void {
  const { flattener, prefix, dae, walk } = ctx;
  interface IfBranch {
    conditionNode?: EquationCstNode;
    equationNodes: EquationCstNode[];
  }
  const branches: IfBranch[] = [];
  let currentBranch: IfBranch | null = null;
  let inCondition = false;
  let inBody = false;

  for (const child of node.children || []) {
    const text = child.text?.trim() ?? "";
    const type = child.type ?? "";

    if (text === "if" || type === '"if"' || text === "elseif" || type === '"elseif"') {
      inCondition = true;
      inBody = false;
      currentBranch = { equationNodes: [] };
      branches.push(currentBranch);
    } else if (text === "else" || type === '"else"') {
      inCondition = false;
      inBody = true;
      currentBranch = { equationNodes: [] };
      branches.push(currentBranch);
    } else if (text === "then" || type === '"then"') {
      inCondition = false;
      inBody = true;
    } else if (text === "end if" || type === '"end if"') {
      inCondition = false;
      inBody = false;
      currentBranch = null;
    } else {
      if (inCondition && currentBranch && !currentBranch.conditionNode) {
        currentBranch.conditionNode = child;
      } else if (inBody && currentBranch) {
        if (text !== ";" && type !== '";"') {
          currentBranch.equationNodes.push(child);
        }
      }
    }
  }

  // Check if condition can be statically evaluated
  let staticBranchIndex: number | null = null;
  let isDynamic = false;

  for (let i = 0; i < branches.length; i++) {
    const b = branches[i]!;
    if (b.conditionNode) {
      const condExprId = flattener.lowerExpr(b.conditionNode, dae, prefix, substitutions);
      if (condExprId >= 0) {
        let condType: string | null = null;
        const cKind = dae.getExprKind(condExprId);
        if (cKind === ExprKind.StringLiteral) condType = "String";
        else if (cKind === ExprKind.IntLiteral) condType = "Integer";
        else if (cKind === ExprKind.RealLiteral) condType = "Real";
        else if (cKind === ExprKind.Name) {
          const nm = dae.interner.resolve(dae.getExprData1(condExprId));
          const vIdx = dae.lookupVariable(nm) ?? dae.lookupVariable(`${prefix}${nm}`);
          if (vIdx >= 0) {
            const vt = dae.getVarType(vIdx);
            if (vt === VarType.String) condType = "String";
            else if (vt === VarType.Integer) condType = "Integer";
            else if (vt === VarType.Real) condType = "Real";
          }
        }
        if (condType !== null && condType !== "Boolean") {
          const condText = b.conditionNode.text?.trim() ?? "cond";
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CONDITIONAL_TYPE_MISMATCH.code,
            message: `Type error in conditional '${condText}'. Expected Boolean, got ${condType}.`,
            range: {
              startPosition: node.startPosition,
              endPosition: node.endPosition,
            },
          });
          return;
        }
      }
      const evaluated = evalDaeExpr(condExprId, dae);
      if (
        evaluated !== null &&
        !dae.extensionMetadata?.["isOldFrontend"] &&
        branches.some((br) =>
          br.equationNodes.some((eq) => eq.type === "connect_equation" || eq.text?.includes("connect(")),
        )
      ) {
        const condVars = new Set<string>();
        dae.collectExprVarNames(condExprId, condVars);
        for (const vName of condVars) {
          const vIdx = dae.getVarIdxByName(vName);
          if (vIdx >= 0 && dae.getVarVariability(vIdx) === Variability.Parameter) {
            dae.setVarFinal(vIdx, true);
          }
        }
      }
      if (evaluated === null) {
        isDynamic = true;
        break;
      } else if (evaluated === true) {
        staticBranchIndex = i;
        break;
      }
    } else {
      // else branch
      staticBranchIndex = i;
      break;
    }
  }

  if (!isDynamic) {
    if (!dae.extensionMetadata?.["isOldFrontend"] && !flattener.isOldFrontend) {
      const state = getFlatteningState(dae);
      for (let bi = 0; bi <= (staticBranchIndex ?? branches.length - 1); bi++) {
        const b = branches[bi];
        if (!b?.conditionNode) continue;
        const cId = flattener.lowerExpr(b.conditionNode, dae, prefix, substitutions);
        if (cId >= 0) {
          const condVars = new Set<string>();
          dae.collectExprVarNames(cId, condVars);
          for (const vName of condVars) {
            const vIdx = dae.getVarIdxByName(vName);
            if (vIdx >= 0 && dae.getVarVariability(vIdx) === Variability.Parameter) {
              (state.evaluatedParams ??= new Set<string>()).add(vName);
            }
          }
        }
      }
    }
    if (staticBranchIndex !== null) {
      // Statically chosen branch: emit only its equations!
      const chosen = branches[staticBranchIndex]!;
      for (const eqNode of chosen.equationNodes) {
        walk(eqNode, substitutions, isInitial);
      }
    }
    return;
  }

  // Otherwise dynamic If equation in DAE
  if (isDynamic) {
    let hasConnectInNonParamIf = false;
    for (const b of branches) {
      for (const eq of b.equationNodes) {
        const connNode =
          eq.type === "connect_equation"
            ? eq
            : (eq.children || []).find((c: SyntaxNode) => c.type === "connect_equation");
        if (connNode) {
          const rawConn = connNode.text?.trim();
          const connText =
            rawConn === undefined ? "connect(...)" : rawConn.endsWith(";") ? rawConn.slice(0, -1) : rawConn;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CONNECT_IN_NON_PARAM_IF.code,
            message: ModelicaErrorCode.CONNECT_IN_NON_PARAM_IF.message(connText),
            range: {
              startPosition: connNode.startPosition,
              endPosition: connNode.endPosition,
            },
          });
          hasConnectInNonParamIf = true;
          break;
        }
      }
      if (hasConnectInNonParamIf) break;
    }
    if (hasConnectInNonParamIf) return;
  }

  if (branches.length > 0 && branches[0]!.conditionNode) {
    const firstCondId = flattener.lowerExpr(branches[0]!.conditionNode, dae, prefix, substitutions);
    const ifIdx = dae.addIfEquation(firstCondId);
    const meta = dae.getIfEquationMeta(ifIdx);

    const scalarizeInlineSimpleEq = (
      lId: number,
      rId: number,
    ): { kind: EqKind; lhsExprId: number; rhsExprId: number }[] => {
      let expL = lId;
      let expR = rId;
      const isInlineArrayCall = (id: number): boolean => {
        if (id < 0) return false;
        const k = dae.getExprKind(id);
        if (k === ExprKind.Call) {
          const fn = dae.interner.resolve(dae.getExprData1(id));
          return Boolean(fn && !fn.startsWith("/*Real") && fn !== "Real");
        }
        if (k === ExprKind.Negate || k === ExprKind.Unary) {
          return isInlineArrayCall(dae.getExprLeft(id));
        }
        if (k === ExprKind.Binary) {
          return isInlineArrayCall(dae.getExprLeft(id)) || isInlineArrayCall(dae.getExprRight(id));
        }
        return false;
      };
      if (dae.getExprKind(expL) === ExprKind.Name) {
        const lName = dae.interner.resolve(dae.getExprData1(expL));
        if (lName && dae.hasArrayElements(lName)) {
          if (isInlineArrayCall(expR)) {
            return [{ kind: EqKind.Array, lhsExprId: expL, rhsExprId: expR }];
          }
          const ctor = expandVarToArrayCtor(lName, dae);
          if (ctor !== null) expL = ctor;
        }
      } else if (
        dae.getExprKind(expL) === ExprKind.ArrayCtor &&
        dae.getExprKind(expR) !== ExprKind.ArrayCtor &&
        isInlineArrayCall(expR)
      ) {
        let finalLhs = expL;
        let firstElem = dae.getExprLeft(expL);
        while (firstElem >= 0 && dae.getExprKind(firstElem) === ExprKind.ArrayCtor) {
          firstElem = dae.getExprLeft(firstElem);
        }
        if (firstElem >= 0 && dae.getExprKind(firstElem) === ExprKind.Name) {
          const elemName = dae.interner.resolve(dae.getExprData1(firstElem));
          if (elemName && elemName.includes("[")) {
            finalLhs = dae.addNameExpr(elemName.split("[")[0]!);
          }
        }
        return [{ kind: EqKind.Array, lhsExprId: finalLhs, rhsExprId: expR }];
      }
      if (dae.getExprKind(expR) === ExprKind.Name) {
        const rName = dae.interner.resolve(dae.getExprData1(expR));
        if (rName && dae.hasArrayElements(rName)) {
          const ctor = expandVarToArrayCtor(rName, dae);
          if (ctor !== null) expR = ctor;
        }
      }
      if (dae.getExprKind(expL) === ExprKind.ArrayCtor && dae.getExprKind(expR) === ExprKind.ArrayCtor) {
        const lElems = getArrayCtorElements(expL, dae);
        const rElems = getArrayCtorElements(expR, dae);
        if (lElems.length === rElems.length) {
          const out: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
          for (let k = 0; k < lElems.length; k++) {
            out.push(...scalarizeInlineSimpleEq(lElems[k]!, rElems[k]!));
          }
          return out;
        }
      }
      if (isRealExpr(expL, dae) && !isRealExpr(expR, dae)) {
        expR = castToRealExpr(expR, dae);
      }
      return [{ kind: EqKind.Simple, lhsExprId: expL, rhsExprId: expR }];
    };

    const lowerInlineEqs = (n: EquationCstNode | null | undefined): LoweredBodyEquation[] => {
      if (!n) return [];
      if (n.type === "some_equation" && n.childCount === 1) n = n.child(0);
      if (!n) return [];
      if (isCstNode(Cst.IfEquation, n) || n.type === "if_equation") {
        const subBranches: IfBranch[] = [];
        let curB: IfBranch | null = null;
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
        let subStaticIdx: number | null = null;
        let subDynamic = false;
        for (let bi = 0; bi < subBranches.length; bi++) {
          const sb = subBranches[bi]!;
          if (sb.conditionNode) {
            const cId = flattener.lowerExpr(sb.conditionNode, dae, prefix, substitutions);
            const ev = evalDaeExpr(cId, dae);
            if (ev === null) {
              subDynamic = true;
              break;
            } else if (ev === true) {
              subStaticIdx = bi;
              break;
            }
          } else {
            subStaticIdx = bi;
            break;
          }
        }
        if (!subDynamic) {
          if (subStaticIdx !== null) {
            const out: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
            for (const eqN of subBranches[subStaticIdx]!.equationNodes) {
              out.push(...lowerInlineEqs(eqN));
            }
            return out;
          }
          return [];
        }
        if (subBranches.length > 0 && subBranches[0]!.conditionNode) {
          const subCondId = flattener.lowerExpr(subBranches[0]!.conditionNode, dae, prefix, substitutions);
          const subThen: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
          for (const eqN of subBranches[0]!.equationNodes) {
            subThen.push(...lowerInlineEqs(eqN));
          }
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
              for (const eqN of sb.equationNodes) bEqs.push(...lowerInlineEqs(eqN));
              subElseIf.push({ conditionExprId: eCondId, bodyEquations: bEqs, equations: [] });
            } else {
              for (const eqN of sb.equationNodes) subElse.push(...lowerInlineEqs(eqN));
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
          const lId = sides.lhsExprId;
          const rId = flattener.lowerExpr(sides.rhsNode, dae, prefix, substitutions);
          return scalarizeInlineSimpleEq(lId, rId);
        }
      }
      if (n.type === "function_call") {
        const callId = flattener.lowerExpr(n, dae, prefix, substitutions);
        return [{ kind: EqKind.FunctionCall, lhsExprId: callId, rhsExprId: -1 }];
      }
      for (const kid of n.children || []) {
        const res = lowerInlineEqs(kid);
        if (res.length > 0) return res;
      }
      return [];
    };

    for (const eqNode of branches[0]!.equationNodes) {
      const eqs = lowerInlineEqs(eqNode);
      if (eqs.length > 0 && meta) {
        meta.thenEquations.push(...eqs);
      }
    }

    for (let i = 1; i < branches.length; i++) {
      const b = branches[i]!;
      if (b.conditionNode) {
        const elseCondId = flattener.lowerExpr(b.conditionNode, dae, prefix, substitutions);
        const bodyEqs: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
        for (const eqNode of b.equationNodes) {
          const eqs = lowerInlineEqs(eqNode);
          if (eqs.length > 0) bodyEqs.push(...eqs);
        }
        if (meta) {
          meta.elseIfClauses.push({
            conditionExprId: elseCondId,
            bodyEquations: bodyEqs,
            equations: [],
          });
        }
      } else {
        // Else branch
        if (meta) {
          if (!meta.elseEquations) meta.elseEquations = [];
          for (const eqNode of b.equationNodes) {
            const eqs = lowerInlineEqs(eqNode);
            if (eqs.length > 0) meta.elseEquations.push(...eqs);
          }
        }
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
