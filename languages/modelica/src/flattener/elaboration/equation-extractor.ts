// SPDX-License-Identifier: AGPL-3.0-or-later

import { StringWriter } from "@modelscript/dsl/utils";
import { AnnotationEvaluator } from "../../diagram/annotation-evaluator.js";
import { getShortClassSpecifierNode } from "../../queries.js";

import {
  ArenaDAEPrinter,
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  inferArenaExprVarType,
  simplifyArenaExpr,
  StmtKind,
  Variability,
  VarType,
  varTypeName,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, FieldId, type SyntaxNode } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";
import { isPredefinedType } from "../../predefined-types.js";
import {
  addArenaValueAsExpr,
  addArrayBinaryExpr,
  castToRealExpr,
  checkIfExprTypeMismatch,
  evalDaeExpr,
  evaluateCSTNumber,
  evaluateEnumRange,
  expandColonToArrayCtor,
  expandVarToArrayCtor,
  findArraySubscriptsForIter,
  findImplicitArrayDim,
  flattenColonNodes,
  generateArrayIndices,
  getArrayCtorElements,
  getArrayLiteralItems,
  getExprDims,
  getVarPrefixSet,
  isDefinitelyScalarExpr,
  isEquationExpr,
  isRealExpr,
  matrixOrVectorMul,
  matrixPower,
} from "../expressions/index.js";
import { getElementDiagRange } from "../support/range-utils.js";
import type { ComponentInstanceData } from "../types.js";

export function isStaticTrueAssert(callId: number, dae: DAEBuilder): boolean {
  if (callId < 0 || dae.getExprKind(callId) !== ExprKind.Call) return false;
  const fname = dae.interner.resolve(dae.getExprData1(callId));
  if (fname !== "assert") return false;
  const firstArg = dae.getExprLeft(callId);
  if (firstArg < 0) return false;
  return dae.getExprKind(firstArg) === ExprKind.BoolLiteral && dae.getExprData1(firstArg) === 1;
}

export function emitFunctionCallEquation(
  flattener: any,
  node: SyntaxNode | null | undefined,
  dae: DAEBuilder,
  prefix: string,
  substitutions?: Map<string, number | string>,
  isInitial = false,
  whenIdx = -1,
): void {
  const isReinit =
    node.child?.(0)?.text?.trim() === "reinit" ||
    node.children?.[0]?.text?.trim() === "reinit" ||
    /^\s*reinit\s*\(/.test(node.text ?? "");
  if (isReinit) {
    let startB = node.startIndex ?? node.startByte;
    let endB = node.endIndex ?? node.endByte;
    if (endB != null && (node.text ?? "").endsWith(";")) {
      endB -= 1;
    }
    const range =
      startB != null && endB != null
        ? {
            startByte: startB,
            endByte: endB,
            startPosition: node.startPosition,
            endPosition: node.endPosition,
          }
        : undefined;

    if (whenIdx === -1) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.REINIT_OUTSIDE_WHEN.code,
        message: ModelicaErrorCode.REINIT_OUTSIDE_WHEN.message(),
        range,
      });
      return;
    }

    const match = (node.text ?? "").match(/reinit\s*\(\s*([^,\s()]+)/);
    if (match) {
      const rawTarget = match[1].trim();
      if (flattener.activeLoopVars.has(rawTarget) || (substitutions && substitutions.has(rawTarget))) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.ASSIGNMENT_TO_ITERATOR.code,
          message: ModelicaErrorCode.ASSIGNMENT_TO_ITERATOR.message(rawTarget),
          range,
        });
        return;
      }

      if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(rawTarget) || rawTarget === "true" || rawTarget === "false") {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.REINIT_ARG1_NOT_VARIABLE.code,
          message: ModelicaErrorCode.REINIT_ARG1_NOT_VARIABLE.message(),
          range,
        });
        return;
      }

      const targetName = prefix ? `${prefix}.${rawTarget}` : rawTarget;
      let vIdx = dae.getVarIdxByName(targetName);
      if (vIdx < 0) {
        vIdx = dae.getVarIdxByName(rawTarget);
      }
      if (vIdx >= 0) {
        const vType = dae.getVarType(vIdx);
        const vVariability = dae.getVarVariability(vIdx);

        if (vType !== VarType.Real) {
          const typeName = vType === VarType.Boolean ? "Boolean" : vType === VarType.Integer ? "Integer" : "String";
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.REINIT_TYPE_MISMATCH.code,
            message: ModelicaErrorCode.REINIT_TYPE_MISMATCH.message(rawTarget, typeName),
            range,
          });
          return;
        }
        if (vVariability === Variability.Parameter) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.code,
            message: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.message(rawTarget, "parameter"),
            range,
          });
          return;
        }
        if (vVariability === Variability.Constant) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.code,
            message: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.message(rawTarget, "constant"),
            range,
          });
          return;
        }
        if (vVariability === Variability.Discrete) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.code,
            message: ModelicaErrorCode.REINIT_NOT_CONTINUOUS.message(rawTarget, "discrete"),
            range,
          });
          return;
        }

        const fullText = (node.text ?? "").trim();
        const arg2Match = fullText.match(/reinit\s*\([^,]+,\s*(.+)\)\s*;?$/s);
        if (arg2Match) {
          const arg2Text = arg2Match[1].trim();
          if (arg2Text.startsWith("{") && arg2Text.endsWith("}")) {
            const elements = arg2Text
              .slice(1, -1)
              .split(",")
              .map((s) => s.trim());
            const actualType = `Real[${elements.length}]`;
            const expectedType = "Real";
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.REINIT_ARG2_TYPE_MISMATCH.code,
              message: ModelicaErrorCode.REINIT_ARG2_TYPE_MISMATCH.message(arg2Text, actualType, expectedType),
              range,
            });
            return;
          }
        }
      }
    }
  }

  const callId = flattener.lowerExpr(node, dae, prefix, substitutions);
  if (isStaticTrueAssert(callId, dae)) {
    return;
  }

  if (dae.getExprKind(callId) === ExprKind.Call) {
    const callName = dae.interner.resolve(dae.getExprData1(callId));
    if (callName === "reinit" && dae.getExprRight(callId) >= 2) {
      const arg0 = dae.getExprLeft(callId);
      if (dae.getExprKind(arg0) === ExprKind.Name) {
        const varName = dae.interner.resolve(dae.getExprData1(arg0));
        if (flattener.activeLoopVars.has(varName)) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.ASSIGNMENT_TO_ITERATOR.code,
            message: ModelicaErrorCode.ASSIGNMENT_TO_ITERATOR.message(varName),
            range: {
              startByte: node.startIndex ?? node.startByte,
              endByte: node.endIndex ?? node.endByte,
              startPosition: node.startPosition,
              endPosition: node.endPosition,
            },
          });
          return;
        }
      }
      const arg1 = dae.getExprLeft(callId + 1);
      if (dae.getExprKind(arg0) === ExprKind.ArrayCtor && dae.getExprKind(arg1) === ExprKind.ArrayCtor) {
        const len0 = dae.getExprData1(arg0);
        const len1 = dae.getExprData1(arg1);
        if (len0 === len1) {
          for (let i = 0; i < len0; i++) {
            const el0 = i === 0 ? dae.getExprLeft(arg0) : dae.getExprLeft(arg0 + i);
            const el1 = i === 0 ? dae.getExprLeft(arg1) : dae.getExprLeft(arg1 + i);
            const scalarCall = dae.addCallExpr("reinit", [el0, el1]);
            if (whenIdx >= 0) {
              dae.addWhenBodyEquation(whenIdx, EqKind.FunctionCall, scalarCall, -1);
            } else {
              const eqKind = isInitial ? EqKind.InitialFunctionCall : EqKind.FunctionCall;
              dae.addEquation(eqKind, scalarCall, -1);
            }
          }
          return;
        }
      }
    }
  }

  if (whenIdx >= 0) {
    dae.addWhenBodyEquation(whenIdx, EqKind.FunctionCall, callId, -1);
  } else {
    const eqKind = isInitial ? EqKind.InitialFunctionCall : EqKind.FunctionCall;
    const eqIdx = dae.addEquation(eqKind, callId, -1);
    const startB = node.startIndex ?? node.startByte;
    const endB = node.endIndex ?? node.endByte;
    if (startB != null && endB != null && eqIdx >= 0) {
      dae.setEqSourceRange(eqIdx, startB, endB);
    }
  }
}

export function extractClassEquations(
  flattener: any,
  classId: SymbolId,
  prefix: string,
  dae: DAEBuilder,
  breakContext?: {
    brokenComponents: Set<string>;
    brokenConnections: Set<string>;
  },
  parentMods?: any,
  visitedClasses?: Set<SymbolId>,
): void {
  const db: QueryDB = flattener.db;
  const curBreakContext = breakContext ?? {
    brokenComponents: new Set<string>(),
    brokenConnections: new Set<string>(),
  };
  const curVisited = visitedClasses ? new Set(visitedClasses) : new Set<SymbolId>();
  if (curVisited.has(classId)) {
    return;
  }
  curVisited.add(classId);

  if (flattener.pendingArrayBindings.has(prefix)) {
    const pending = flattener.pendingArrayBindings.get(prefix)!;
    for (const item of pending) {
      dae.addEquation(EqKind.Array, item.lhsExprId, item.rhsExprId);
    }
    flattener.pendingArrayBindings.delete(prefix);
  }

  const classEntry = db.symbol(classId);
  const children = db.childrenOf(classId);
  for (const child of children) {
    if (child.kind === "Component") {
      if (curBreakContext.brokenComponents.has(child.name)) {
        continue;
      }
      const compInst = db.query<ComponentInstanceData>("componentInstance", child.id);
      const typeSpec =
        compInst?.typeSpecifier ?? (child.metadata as any)?.typeSpecifier ?? (child.metadata as any)?.type_specifier;
      if (typeSpec === "Real" || typeSpec === "Integer" || typeSpec === "Boolean" || typeSpec === "String") {
        continue;
      }
      let compClassId = db.query<SymbolId | null>("classInstance", child.id);
      if (classId && typeSpec) {
        const origClassSym = compClassId ? db.symbol(compClassId) : null;
        if (origClassSym && origClassSym.parentId !== null) {
          const scopeTarget = typeSpec.includes(".")
            ? db.query<(n: string) => SymbolEntry | null>("resolveName", classId)?.(typeSpec)
            : db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", classId)?.(typeSpec);
          if (
            scopeTarget &&
            scopeTarget.id !== compClassId &&
            !(scopeTarget.metadata as any)?.isPredefined &&
            (scopeTarget.kind === "Class" || (scopeTarget.metadata as any)?.classKind === "type")
          ) {
            compClassId = scopeTarget.id;
          }
        }
      }
      const matchingClassArg = parentMods?.args?.find(
        (a: any) =>
          !a.isBreak &&
          a.isRedeclaration &&
          a.redeclaredTypeSpecifier &&
          (a.name === typeSpec || a.name === child.name),
      );
      if (matchingClassArg?.redeclaredTypeSpecifier) {
        const redeclId = flattener.resolveRedeclarationType(classId, matchingClassArg.redeclaredTypeSpecifier);
        if (redeclId !== null) {
          compClassId = redeclId;
        }
      }
      if (!compClassId) {
        if (typeSpec) {
          try {
            const res =
              db.query<any>("resolveName", classId)?.(typeSpec) ??
              db.query<any>("resolveSimpleName", classId)?.(typeSpec);
            if (res) {
              const s = db.symbol(res);
              if (s && s.kind === "Class") compClassId = s.id;
            }
          } catch {}
          if (!compClassId) {
            const targets = db.byName(typeSpec);
            if (targets.length > 0 && targets[0].kind === "Class") {
              compClassId = targets[0].id;
            }
          }
        }
      }
      if (compClassId !== null) {
        compClassId = flattener.resolveInnerOuterClass(compClassId);
        const compClassSym = db.symbol(compClassId);
        if (
          compClassSym &&
          compClassSym.kind === "Class" &&
          (compClassSym.metadata as any)?.classKind !== "type" &&
          !(compClassSym.metadata as any)?.isEnum &&
          !isPredefinedType(compClassSym)
        ) {
          const childPrefix = prefix ? `${prefix}.${child.name}` : child.name;
          const matchingArg = parentMods?.args?.find((a: any) => !a.isBreak && a.name === child.name);
          const compInst = db.query<ComponentInstanceData>("componentInstance", child.id);
          const compMods = compInst?.modification?.args || [];
          const childSubMod = {
            args: [
              ...compMods,
              ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
              ...(matchingArg?.nestedArgs || matchingArg?.args || []),
            ],
            ownerClassId: compClassId,
          };
          const arrayDims = db.query<number[] | null>("resolvedArrayDimensions", child.id);
          if (curVisited.has(compClassId)) {
            continue;
          }
          const nextVisited = new Set(curVisited);
          nextVisited.add(classId);
          if (flattener.options.arrayMode === "preserve") {
            extractClassEquations(flattener, compClassId, childPrefix, dae, curBreakContext, childSubMod, nextVisited);
          } else if (arrayDims && arrayDims.length > 0) {
            const indices = generateArrayIndices(arrayDims);
            for (const indexStr of indices) {
              extractClassEquations(
                flattener,
                compClassId,
                `${childPrefix}${indexStr}`,
                dae,
                curBreakContext,
                childSubMod,
                nextVisited,
              );
            }
          } else {
            extractClassEquations(flattener, compClassId, childPrefix, dae, curBreakContext, childSubMod, nextVisited);
          }
        }
      }
    }
  }

  const cst = db.cstNode(classId);
  if (cst) {
    const classSym = db.symbol(classId);
    const rawKind = String(classSym?.metadata?.classKind ?? classSym?.metadata?.classPrefixes ?? "");
    if (rawKind === "type" || rawKind === "record" || rawKind === "package" || rawKind === "connector") {
      return;
    }
    const prevParentMods = flattener.currentParentMods;
    const prevClassId = flattener.currentClassId;
    flattener.currentParentMods = parentMods;
    flattener.currentClassId = classId;
    try {
      const walk = (node: any, substitutions?: Map<string, number | string>, isInitial?: boolean): void => {
        if (!node) return;
        if (process.env.DEBUG_TUPLE && node.type) {
          console.log("WALK NODE:", node.type, node.text?.slice(0, 30));
        }
        if (
          (node !== cst && node.type === "class_definition") ||
          node.type === "extends_clause" ||
          node.type === "inheritance_modification" ||
          node.type === "component_clause" ||
          node.type === "component_clause1" ||
          node.type === "component_declaration"
        ) {
          return;
        }

        // For equations: for i in 1:N loop ... end for;
        if (Cst.ForEquation.is(node)) {
          const indicesNode = Cst.ForEquation.indices(node);
          const forIndexNodes: any[] = [];
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

          const bodyNodes: any[] = [];
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

          const getForIndexValues = (fIndex: any, currentSubs: Map<string, number | string>): (number | string)[] => {
            const rangeNode =
              Cst.ForIndex.range(fIndex) || fIndex.children?.find?.((c: any) => c.type === "expression");
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

            flattener.lowerExpr(rangeNode, dae, prefix, currentSubs);
            if (dae.diagnostics.some((d: any) => d.severity === "error")) {
              return [];
            }

            const rangeText = rangeNode.text?.trim() ?? "";
            if (rangeText.startsWith("{") && rangeText.endsWith("}")) {
              const enumVals = evaluateEnumRange(rangeNode, currentSubs, classId, flattener.db, dae, prefix);
              if (enumVals !== null && enumVals.length > 0) return enumVals;
              const items = getArrayLiteralItems(rangeNode);
              const vals: number[] = [];
              for (const item of items) {
                const v = evaluateCSTNumber(item, currentSubs as any, classId, flattener.db, dae, prefix);
                if (v !== null) vals.push(v);
              }
              if (vals.length > 0) return vals;
            }

            const colonNodes = flattenColonNodes(rangeNode);
            if (colonNodes.length >= 2) {
              const enumVals = evaluateEnumRange(rangeNode, currentSubs, classId, flattener.db, dae, prefix);
              if (enumVals !== null) return enumVals;

              const sVal = evaluateCSTNumber(colonNodes[0], currentSubs as any, classId, flattener.db, dae, prefix);
              let stVal: number | null = 1;
              let eVal: number | null = null;
              if (colonNodes.length === 2) {
                eVal = evaluateCSTNumber(colonNodes[1], currentSubs as any, classId, flattener.db, dae, prefix);
              } else if (colonNodes.length >= 3) {
                stVal = evaluateCSTNumber(colonNodes[1], currentSubs as any, classId, flattener.db, dae, prefix);
                eVal = evaluateCSTNumber(colonNodes[2], currentSubs as any, classId, flattener.db, dae, prefix);
              }

              if (sVal === null || eVal === null || stVal === null) {
                let formattedRangeText = rangeText;
                if (colonNodes.length === 2) {
                  const n0Text = colonNodes[0]?.text?.trim() ?? "";
                  const n1Text = colonNodes[1]?.text?.trim() ?? "";
                  const v1Idx = dae.getVarIdxByName(prefix ? `${prefix}.${n1Text}` : n1Text);
                  if (v1Idx >= 0 && dae.getVarType(v1Idx) === VarType.Real && /^\d+$/.test(n0Text)) {
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

            const singleVal = evaluateCSTNumber(rangeNode, currentSubs as any, classId, flattener.db, dae, prefix);
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

          const unroll = (indexIdx: number, currentSubs: Map<string, number | string>) => {
            if (indexIdx >= forIndexNodes.length) {
              for (const bodyChild of bodyNodes) {
                walk(bodyChild, currentSubs, isInitial);
              }
              return;
            }
            const fIndex = forIndexNodes[indexIdx];
            const varName = Cst.ForIndex.variable(fIndex)?.text?.trim() || fIndex.child(0)?.text?.trim();
            const iterVals = getForIndexValues(fIndex, currentSubs);
            for (const v of iterVals) {
              const nextSubs = new Map<string, number | string>(currentSubs);
              if (varName) nextSubs.set(varName, v);
              unroll(indexIdx + 1, nextSubs);
            }
          };
          const totalEstimated = forIndexNodes.reduce((acc, fIndex) => {
            const vals = getForIndexValues(fIndex, substitutions || new Map());
            return acc * Math.max(1, vals.length);
          }, 1);
          if (totalEstimated > 5000 && flattener.options.arrayMode === "preserve") {
            return;
          }
          unroll(0, new Map<string, number | string>(substitutions || []));
          return;
        }

        // If equations: if cond then ... elseif cond then ... else ... end if;
        if (Cst.IfEquation.is(node) || node.type === "if_equation") {
          interface IfBranch {
            conditionNode?: any;
            equationNodes: any[];
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
            const b = branches[i];
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
            if (staticBranchIndex !== null) {
              // Statically chosen branch: emit only its equations!
              const chosen = branches[staticBranchIndex];
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
                    : (eq.children || []).find((c: any) => c.type === "connect_equation");
                if (connNode) {
                  const connText = connNode.text?.trim()?.replace(/;$/, "") ?? "connect(...)";
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

          if (branches.length > 0 && branches[0].conditionNode) {
            const firstCondId = flattener.lowerExpr(branches[0].conditionNode, dae, prefix, substitutions);
            const ifIdx = dae.addIfEquation(firstCondId);
            const meta = dae.getIfEquationMeta(ifIdx);

            const lowerInlineEq = (n: any): { kind: EqKind; lhsExprId: number; rhsExprId: number } | null => {
              if (!n) return null;
              if (n.type === "some_equation" && n.childCount === 1) n = n.child(0);
              if (n.type === "simple_equation") {
                const leftNode = Cst.SimpleEquation.lhs(n) ?? n.childForFieldId?.(FieldId.lhs);
                const rightNode = Cst.SimpleEquation.rhs(n) ?? n.childForFieldId?.(FieldId.rhs);
                const exprs = leftNode && rightNode ? [leftNode, rightNode] : (n.children || []).filter(isEquationExpr);
                if (exprs.length >= 2) {
                  let lId = flattener.lowerExpr(exprs[0], dae, prefix, substitutions);
                  let rId = flattener.lowerExpr(exprs[1], dae, prefix, substitutions);
                  if (isRealExpr(lId, dae) && !isRealExpr(rId, dae)) {
                    rId = castToRealExpr(rId, dae);
                  }
                  return { kind: EqKind.Simple, lhsExprId: lId, rhsExprId: rId };
                }
              }
              if (n.type === "function_call") {
                const callId = flattener.lowerExpr(n, dae, prefix, substitutions);
                return { kind: EqKind.FunctionCall, lhsExprId: callId, rhsExprId: -1 };
              }
              for (const kid of n.children || []) {
                const res = lowerInlineEq(kid);
                if (res) return res;
              }
              return null;
            };

            for (const eqNode of branches[0].equationNodes) {
              const eq = lowerInlineEq(eqNode);
              if (eq && meta) {
                meta.thenEquations.push(eq);
              }
            }

            for (let i = 1; i < branches.length; i++) {
              const b = branches[i];
              if (b.conditionNode) {
                const elseCondId = flattener.lowerExpr(b.conditionNode, dae, prefix, substitutions);
                const bodyEqs: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
                for (const eqNode of b.equationNodes) {
                  const eq = lowerInlineEq(eqNode);
                  if (eq) bodyEqs.push(eq);
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
                    const eq = lowerInlineEq(eqNode);
                    if (eq) meta.elseEquations.push(eq);
                  }
                }
              }
            }
            return;
          }
        }

        // Simple and Equality equations: lhs = rhs;
        if (node.type === "simple_equation") {
          if (curBreakContext.brokenComponents.size > 0) {
            const checkNodeForBroken = (n: any): string | null => {
              if (!n) return null;
              if (n.type === "component_reference" || n.type === "name") {
                const text = n.text?.trim() ?? "";
                const root = text.split(".")[0].split("[")[0];
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
              const startB = node.startIndex ?? node.startByte;
              const endB = node.endIndex ?? node.endByte;
              const scopeName = classEntry?.name ?? "";
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                message: `Variable ${brokenRef} not found in scope ${scopeName}.`,
                range: {
                  startByte: startB,
                  endByte: endB,
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                },
              });
              return;
            }
          }

          if (flattener.db) {
            const findClassUsedAsComponent = (exprNode: any, scopeId: any): { name: string; node: any } | null => {
              if (!exprNode) return null;
              if (exprNode.type === "primary" && exprNode.children?.some((c: any) => c.type === "function_call_args")) {
                const callArgs = exprNode.children.find((c: any) => c.type === "function_call_args");
                return findClassUsedAsComponent(callArgs, scopeId);
              }
              if (exprNode.type === "function_call" || exprNode.type === "call_expression") {
                for (const arg of exprNode.children || []) {
                  if (
                    arg.type === "function_arguments" ||
                    arg.type === "function_call_args" ||
                    arg.type === "arguments"
                  ) {
                    for (const c of arg.children || []) {
                      const res = findClassUsedAsComponent(c, scopeId);
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
                  const res = db.query<any>("resolveSimpleName", scopeId)?.(root) ?? db.byName(root)[0];
                  if (res && res.kind === "Class") {
                    const kind = String(
                      (res.metadata as any)?.classKind ?? (res.metadata as any)?.classPrefixes ?? "",
                    ).toLowerCase();
                    if (!kind.includes("function") && !kind.includes("record")) {
                      return { name: root, node: exprNode };
                    }
                  }
                }
                return null;
              }
              for (const c of exprNode.children || []) {
                const res = findClassUsedAsComponent(c, scopeId);
                if (res) return res;
              }
              return null;
            };

            const classAsComp = findClassUsedAsComponent(node, classId);
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

          const expressions = (node.children || []).filter(isEquationExpr);
          if (expressions.length >= 2) {
            let lhsExprId = flattener.lowerExpr(expressions[0], dae, prefix, substitutions, false, true);
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
              for (const elemId of elemIds) {
                const k = dae.getExprKind(elemId);
                if (k !== ExprKind.Name && k !== ExprKind.Subscript && k !== ExprKind.Der) {
                  isAllCompRefs = false;
                  break;
                }
              }
              if (!isAllCompRefs) {
                const startB = node.startIndex ?? node.startByte;
                const endB = node.endIndex ?? node.endByte;
                const printer = new ArenaDAEPrinter(new StringWriter(), dae, false);
                const lhsStr = printer.printExprToString(lhsExprId);
                let formattedInStr = lhsStr;
                if (dae.extensionMetadata?.isOldFrontend) {
                  const rawText = node.text ? node.text.trim().replace(/\s+/g, " ") : "";
                  const semiText = rawText.endsWith(";") ? rawText : `${rawText};`;
                  formattedInStr = semiText.replace(/([A-Za-z0-9_]+)\+([A-Za-z0-9_]+)/g, "$1 + $2");
                }
                dae.diagnostics.push({
                  severity: "error",
                  message: `Tuple assignment only allowed for tuple of component references in lhs (in ${formattedInStr}).`,
                  range: {
                    startByte: startB,
                    endByte: endB,
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

            const isCstTupleExpr = (n: any): boolean => {
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
              const startB = node.startIndex ?? node.startByte;
              const endB = node.endIndex ?? node.endByte;
              const printer = new ArenaDAEPrinter(new StringWriter(), dae, true);
              const rhsStr = printer.printExprToString(rhsExprId);
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.TUPLE_EXPRESSION_CONTEXT.code,
                message: `Tuple expressions may only occur on the left side of an assignment or equation with a single function call on the right side. Got the following expression: ${rhsStr}.`,
                range: {
                  startByte: startB,
                  endByte: endB,
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                },
              });
              return;
            }

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
              const startB = node.startIndex ?? node.startByte;
              const endB = node.endIndex ?? node.endByte;
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
              eqText = eqText.replace(/\s*=\s*/, " = ");

              dae.diagnostics.push({
                severity: ModelicaErrorCode.EQUATION_TYPE_MISMATCH.severity,
                code: ModelicaErrorCode.EQUATION_TYPE_MISMATCH.code,
                message: `Type mismatch in equation ${eqText} of type ${lhsTypeStr} = ${rhsTypeStr}.`,
                range: {
                  startByte: startB,
                  endByte: endB,
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                },
              });
              return;
            }
            if (
              !isTupleLhs &&
              dae.getExprKind(lhsExprId) !== ExprKind.Tuple &&
              dae.getExprKind(rhsExprId) !== ExprKind.Tuple
            ) {
              if (isRealExpr(lhsExprId, dae) && !isRealExpr(rhsExprId, dae)) {
                rhsExprId = castToRealExpr(rhsExprId, dae);
              }
            }
            const lhsDims = getExprDims(lhsExprId, dae, flattener.db);
            const rhsDims = getExprDims(rhsExprId, dae, flattener.db);
            if ((lhsDims && lhsDims[0] === 0) || (rhsDims && rhsDims[0] === 0)) {
              return;
            }
            const lhsKind = dae.getExprKind(lhsExprId);
            const rhsKind = dae.getExprKind(rhsExprId);
            const emittedEqIndices: number[] = [];

            const resolveToArrayCtor = (id: number): number => {
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
              } else if (k === ExprKind.Der) {
                const inner = resolveToArrayCtor(dae.getExprLeft(id));
                if (dae.getExprKind(inner) === ExprKind.ArrayCtor) {
                  const distributeDer = (exprId: number): number => {
                    if (dae.getExprKind(exprId) === ExprKind.ArrayCtor) {
                      const elems = getArrayCtorElements(exprId, dae);
                      return dae.addArrayCtorExpr(elems.map((e) => distributeDer(e)));
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
                  return distributeDer(inner);
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
                  if (!lIsArr && rIsArr) {
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
                            const lV =
                              lK === ExprKind.IntLiteral ? dae.getExprData1(scalar) : dae.getExprRealValue(scalar);
                            const eV = eK === ExprKind.IntLiteral ? dae.getExprData1(e) : dae.getExprRealValue(e);
                            return isReal ? dae.addRealLiteral(lV * eV) : dae.addIntLiteral(lV * eV);
                          }
                          return dae.addBinaryExpr(BinOp.Mul, scalar, e);
                        }),
                      );
                    };
                    return scaleArray(lInner, rInner);
                  }
                  if (lIsArr && !rIsArr) {
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
                            const rV =
                              rK === ExprKind.IntLiteral ? dae.getExprData1(scalar) : dae.getExprRealValue(scalar);
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
                            const rV =
                              rK === ExprKind.IntLiteral ? dae.getExprData1(scalar) : dae.getExprRealValue(scalar);
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

            const effectiveLhsDims =
              getExprDims(expandedLhs, dae, flattener.db) ?? getExprDims(lhsExprId, dae, flattener.db);
            const effectiveRhsDims =
              getExprDims(expandedRhs, dae, flattener.db) ?? getExprDims(rhsExprId, dae, flattener.db);
            const hasLeftDims = effectiveLhsDims !== null && effectiveLhsDims.length > 0;
            const hasRightDims = effectiveRhsDims !== null && effectiveRhsDims.length > 0;

            let dimsMismatch = false;
            if (hasLeftDims && hasRightDims) {
              dimsMismatch =
                effectiveLhsDims!.length !== effectiveRhsDims!.length ||
                effectiveLhsDims!.some((d, i) => d !== effectiveRhsDims![i]);
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
              const startB = node.startIndex ?? node.startByte;
              const endB = node.endIndex ?? node.endByte;
              dae.diagnostics.push({
                severity: ModelicaErrorCode.EQUATION_TYPE_MISMATCH.severity,
                code: ModelicaErrorCode.EQUATION_TYPE_MISMATCH.code,
                message: ModelicaErrorCode.EQUATION_TYPE_MISMATCH.message(
                  lhsExpanded,
                  rhsExpanded,
                  lhsTypeStr,
                  rhsTypeStr,
                ),
                range: {
                  startByte: startB,
                  endByte: endB,
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                },
              });
              return;
            }

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
                  dae.extensionMetadata?.isOldFrontend &&
                  !isRealExpr(finalLhs, dae) &&
                  isRealExpr(finalRhs, dae)
                ) {
                  finalLhs = castToRealExpr(finalLhs, dae);
                }
              }
              const eqIdx = dae.addEquation(isInitial ? EqKind.InitialSimple : EqKind.Simple, finalLhs, finalRhs);
              if (eqIdx >= 0) emittedEqIndices.push(eqIdx);
              const startB = node.startIndex ?? node.startByte;
              const endB = node.endIndex ?? node.endByte;
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
              if (dae.getExprKind(exprId) === ExprKind.Call) {
                const fn = dae.interner.resolve(dae.getExprData1(exprId));
                if (fn && (fn.startsWith("/*Real") || fn === "Real")) return false;
                const fnDims = getExprDims(exprId, dae, flattener.db);
                return Boolean(fnDims && fnDims.length > 0);
              }
              return false;
            };

            if (
              hasLeftDims &&
              dae.getExprKind(expandedRhs) !== ExprKind.ArrayCtor &&
              (isSyncArrayCall(rhsExprId) || isCardinalityCall(rhsExprId) || isArrayReturningCall(rhsExprId))
            ) {
              let finalLhs = lhsExprId;
              if (dae.getExprKind(finalLhs) === ExprKind.ArrayCtor) {
                const firstElem = dae.getExprLeft(finalLhs);
                if (firstElem >= 0 && dae.getExprKind(firstElem) === ExprKind.Name) {
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
              const eqIdx = dae.addEquation(isInitial ? EqKind.InitialSimple : EqKind.Array, finalLhs, finalRhs);
              if (eqIdx >= 0) emittedEqIndices.push(eqIdx);
              const startB = node.startIndex ?? node.startByte;
              const endB = node.endIndex ?? node.endByte;
              if (startB != null && endB != null && eqIdx >= 0) {
                dae.setEqSourceRange(eqIdx, startB, endB);
              }
            } else {
              emitEq(expandedLhs, expandedRhs);
            }

            // Check equation annotation for diffusion (SDE)
            const evaluator = new AnnotationEvaluator();
            const diffVal =
              evaluator.evaluate(node, "diffusion") ??
              evaluator.evaluate(node.parent, "diffusion") ??
              evaluator.evaluate(node.parent?.parent, "diffusion");
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
                if (typeof diffVal === "number") {
                  diffExprId = dae.addRealLiteral(diffVal);
                } else if (typeof diffVal === "object" && diffVal.coefficient !== undefined) {
                  diffExprId =
                    typeof diffVal.coefficient === "number"
                      ? dae.addRealLiteral(diffVal.coefficient)
                      : addArenaValueAsExpr(dae, diffVal.coefficient, VarType.Real);
                } else if (typeof diffVal === "object" && diffVal.value !== undefined) {
                  diffExprId =
                    typeof diffVal.value === "number"
                      ? dae.addRealLiteral(diffVal.value)
                      : addArenaValueAsExpr(dae, diffVal.value, VarType.Real);
                } else {
                  diffExprId = addArenaValueAsExpr(dae, diffVal, VarType.Real);
                }
                dae.diffusionExprIds.set(stateVarIdx, diffExprId);
              }
            }
            let t = "";
            for (const c of node.children || []) {
              if (c.type === "description" || c.type === "description_string" || c.type === "string_literal") {
                t = c.text?.trim() ?? "";
                break;
              }
              if (c.type === "comment") {
                const sc = (c.children || []).find(
                  (ch: any) =>
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
              while (p && p.type !== "equation_section") {
                for (const c of p.children || []) {
                  if (c.type === "description" || c.type === "description_string" || c.type === "string_literal") {
                    t = c.text?.trim() ?? "";
                    break;
                  }
                  if (c.type === "comment") {
                    const sc = (c.children || []).find(
                      (ch: any) =>
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
            if (t && emittedEqIndices.length > 0) {
              for (const eqId of emittedEqIndices) {
                dae.setEqDescription(eqId, t);
              }
            }
            return;
          }
        }

        // Function call equations (e.g. terminate(...), reinit(...))
        if (node.type === "function_call") {
          emitFunctionCallEquation(flattener, node, dae, prefix, substitutions, isInitial, -1);
          return;
        }

        // Connect equations: connect(c1, c2);
        if (node.type === "connect_equation") {
          const lhsNode = Cst.ConnectEquation.lhs(node) ?? node.childForFieldId?.(FieldId.lhs);
          const rhsNode = Cst.ConnectEquation.rhs(node) ?? node.childForFieldId?.(FieldId.rhs);
          const refs =
            lhsNode && rhsNode
              ? [lhsNode, rhsNode]
              : (node.children || []).filter(
                  (c: any) =>
                    c.type === "component_reference" ||
                    c.type === "expression" ||
                    c.type === "identifier" ||
                    c.type === "name",
                );
          if (refs.length >= 2) {
            const r0Raw = refs[0].text?.trim().replace(/\s+/g, "") ?? "";
            const r1Raw = refs[1].text?.trim().replace(/\s+/g, "") ?? "";
            const r0Full = prefix ? `${prefix}.${r0Raw}` : r0Raw;
            const r1Full = prefix ? `${prefix}.${r1Raw}` : r1Raw;

            if (flattener.isComponentDisabled(r0Full) || flattener.isComponentDisabled(r1Full)) {
              return;
            }

            const r0Root = r0Raw.split(".")[0].split("[")[0];
            const r1Root = r1Raw.split(".")[0].split("[")[0];

            if (curBreakContext.brokenComponents.has(r0Root) || curBreakContext.brokenComponents.has(r1Root)) {
              return;
            }

            let isBrokenConn = false;
            let r0Sub = r0Raw;
            let r1Sub = r1Raw;
            if (substitutions && substitutions.size > 0) {
              const applySubs = (s: string) =>
                s.replace(/\b[a-zA-Z_]\w*\b/g, (match) => {
                  const val = substitutions.get(match);
                  return val !== undefined ? String(val) : match;
                });
              r0Sub = applySubs(r0Sub);
              r1Sub = applySubs(r1Sub);
            }

            for (const bConn of curBreakContext.brokenConnections) {
              const m = bConn.match(/connect\(([^,]+),([^)]+)\)/);
              if (m) {
                const bFrom = m[1].trim().replace(/\s+/g, "");
                const bTo = m[2].trim().replace(/\s+/g, "");
                if (
                  (r0Raw === bFrom && r1Raw === bTo) ||
                  (r0Raw === bTo && r1Raw === bFrom) ||
                  (r0Sub === bFrom && r1Sub === bTo) ||
                  (r0Sub === bTo && r1Sub === bFrom)
                ) {
                  isBrokenConn = true;
                  break;
                }
              }
            }
            if (isBrokenConn) {
              return;
            }

            const isR0Outside = prefix !== "" && !r0Raw.includes(".");
            const isR1Outside = prefix !== "" && !r1Raw.includes(".");
            const connFlags = (isR0Outside ? 1 : 0) | (isR1Outside ? 2 : 0);

            // Plug-compatibility check: compare connector types and dimensions
            // before lowering/expanding. Only check simple (non-dotted) connector refs
            // at the top level (no prefix), where we can look up component instances.
            if (!r0Raw.includes(".") && !r1Raw.includes(".") && !r0Raw.includes("[") && !r1Raw.includes("[")) {
              const scopeId = flattener.currentRootClassId;
              if (scopeId) {
                const allChildren = db.childrenOf(scopeId);
                const c0Sym = allChildren.find((c) => c.kind === "Component" && c.name === r0Raw);
                const c1Sym = allChildren.find((c) => c.kind === "Component" && c.name === r1Raw);
                if (c0Sym && c1Sym) {
                  const c0Inst = db.query<ComponentInstanceData>("componentInstance", c0Sym.id);
                  const c1Inst = db.query<ComponentInstanceData>("componentInstance", c1Sym.id);
                  if (c0Inst && c1Inst) {
                    let connIncompat = false;
                    let sym0: SymbolEntry | null = null;
                    let sym1: SymbolEntry | null = null;
                    let flowMismatch: { flowComp: string; nonFlowComp: string } | null = null;
                    const getPublicComps = (sym: SymbolEntry): SymbolEntry[] => {
                      const elems = db.query<SymbolEntry[]>("allElements", sym.id) ?? db.childrenOf(sym.id);
                      return elems.filter((e) => e.kind === "Component" && !(e.metadata as any)?.isProtected);
                    };
                    // Array dimensions check (scalar vs array)
                    const d0 = c0Inst.arrayDimensions ?? [];
                    const d1 = c1Inst.arrayDimensions ?? [];
                    if (d0.length !== d1.length || d0.some((v, i) => v !== d1[i])) {
                      connIncompat = true;
                    } else if (c0Inst.typeSpecifier !== c1Inst.typeSpecifier) {
                      // Different type specifiers: check structural connector compatibility
                      const resolveConnectorSym = (typeSpec: string | null): SymbolEntry | null => {
                        if (!typeSpec) return null;
                        const resolved =
                          db.query<(n: string) => SymbolEntry | null>("resolveName", scopeId)?.(typeSpec) ?? null;
                        if (resolved && (resolved.kind === "Class" || db.query<boolean>("isConnector", resolved.id))) {
                          return resolved;
                        }
                        const matches = db.byName(typeSpec);
                        return matches?.find((e: any) => e.kind === "Class") ?? null;
                      };
                      sym0 = resolveConnectorSym(c0Inst.typeSpecifier);
                      sym1 = resolveConnectorSym(c1Inst.typeSpecifier);
                      if (!sym0 || !sym1) {
                        connIncompat = true;
                      } else {
                        const isC0Exp = flattener.isExpandableConnectorClass(sym0.id);
                        const isC1Exp = flattener.isExpandableConnectorClass(sym1.id);
                        if (isC0Exp || isC1Exp) {
                          return;
                        }
                        const comps0 = getPublicComps(sym0);
                        const comps1 = getPublicComps(sym1);
                        if (comps0.length !== comps1.length) {
                          connIncompat = true;
                        } else {
                          for (const p0 of comps0) {
                            const p1 = comps1.find((c) => c.name === p0.name);
                            if (!p1) {
                              connIncompat = true;
                              break;
                            }
                            const inst0 = db.query<ComponentInstanceData>("componentInstance", p0.id);
                            const inst1 = db.query<ComponentInstanceData>("componentInstance", p1.id);
                            const isFlow0 = Boolean(inst0?.flowPrefix || (p0.metadata as any)?.flowPrefix);
                            const isFlow1 = Boolean(inst1?.flowPrefix || (p1.metadata as any)?.flowPrefix);
                            if (isFlow0 !== isFlow1) {
                              flowMismatch = {
                                flowComp: isFlow0 ? `${r0Raw}.${p0.name}` : `${r1Raw}.${p1.name}`,
                                nonFlowComp: isFlow0 ? `${r1Raw}.${p1.name}` : `${r0Raw}.${p0.name}`,
                              };
                              connIncompat = true;
                              break;
                            }
                          }
                        }
                      }
                    }
                    if (connIncompat) {
                      const sb = node?.startIndex ?? node?.startByte;
                      const eb = node?.endIndex ?? node?.endByte;
                      const range = sb !== undefined && eb !== undefined ? { startByte: sb, endByte: eb } : undefined;
                      if (flowMismatch && sym0 && sym1) {
                        const formatConnectorType = (sym: SymbolEntry): string => {
                          const comps = getPublicComps(sym);
                          const compLines = comps.map((c) => {
                            const inst = db.query<ComponentInstanceData>("componentInstance", c.id);
                            const m = (c.metadata as any) ?? {};
                            const flow = inst?.flowPrefix || m.flowPrefix ? "flow " : "";
                            let typeName = inst?.typeSpecifier ?? (c as any).typeSpecifier ?? "Real";
                            let modStr = "";
                            if (inst?.modification?.args && inst.modification.args.length > 0) {
                              modStr =
                                "(" +
                                inst.modification.args
                                  .map((a) => `${a.name} = "${a.value?.text ?? a.value?.value ?? ""}"`)
                                  .join(", ") +
                                ")";
                            } else {
                              const resolved = db.byName(typeName)?.find((e) => e.kind === "Class");
                              if (resolved && (flattener.db as any).source) {
                                const src = (flattener.db as any).source(resolved.resourceId) ?? "";
                                const snippet = src.substring(resolved.startByte, resolved.endByte);
                                const match = snippet.match(/=\s*([A-Za-z0-9_]+(\([^)]+\))?)/);
                                if (match) {
                                  typeName = match[1];
                                }
                              }
                            }
                            return `  ${flow}${typeName}${modStr} ${c.name};`;
                          });
                          return `connector ${sym.name}\n${compLines.join("\n")}\nend ${sym.name};`;
                        };
                        dae.diagnostics.push({
                          severity: "error",
                          code: ModelicaErrorCode.CONNECT_FLOW_MISMATCH.code,
                          message: ModelicaErrorCode.CONNECT_FLOW_MISMATCH.message(
                            flowMismatch.flowComp,
                            flowMismatch.nonFlowComp,
                          ),
                          range,
                        });
                        dae.diagnostics.push({
                          severity: "error",
                          code: ModelicaErrorCode.CONNECT_TYPES_INCONSISTENT.code,
                          message: `The type of variables \n${r0Raw} type:\n${formatConnectorType(
                            sym0,
                          )} and \n${r1Raw} type:\n${formatConnectorType(sym1)}\nare inconsistent in connect equations.`,
                          range,
                        });
                      } else {
                        dae.diagnostics.push({
                          severity: "error",
                          code: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
                          message: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.message(r0Raw, r1Raw),
                          range,
                        });
                      }
                      return;
                    }
                  }
                }
              }
            }

            const lhsExprId = flattener.lowerExpr(refs[0], dae, prefix, substitutions);
            if (lhsExprId < 0) return;
            const rhsExprId = flattener.lowerExpr(refs[1], dae, prefix, substitutions);
            if (rhsExprId < 0) return;
            const lhsName =
              dae.getExprKind(lhsExprId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(lhsExprId)) : "";
            const rhsName =
              dae.getExprKind(rhsExprId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(rhsExprId)) : "";
            const lhsExpanded = lhsName ? expandConnectorRef(lhsName, dae) : [];
            const rhsExpanded = rhsName ? expandConnectorRef(rhsName, dae) : [];
            const keepOuterOuterWhole =
              connFlags === 3 &&
              [...lhsExpanded, ...rhsExpanded].some((n) => {
                const vi = dae.getVarIdxByName(n);
                return vi >= 0 && dae.isVarStream(vi);
              });
            if (!keepOuterOuterWhole && lhsExpanded.length > 1 && lhsExpanded.length === rhsExpanded.length) {
              for (let k = 0; k < lhsExpanded.length; k++) {
                const lId = dae.addName(dae.interner.intern(lhsExpanded[k]!));
                const rId = dae.addName(dae.interner.intern(rhsExpanded[k]!));
                const eqId = dae.addEquation(EqKind.Connect, lId, rId, connFlags);
                const sb = node?.startIndex ?? node?.startByte;
                const eb = node?.endIndex ?? node?.endByte;
                if (sb !== undefined && eb !== undefined) {
                  dae.setEqSourceRange(eqId, sb, eb);
                }
              }
              return;
            }
            const eqId = dae.addEquation(EqKind.Connect, lhsExprId, rhsExprId, connFlags);
            const sb = node?.startIndex ?? node?.startByte;
            const eb = node?.endIndex ?? node?.endByte;
            if (sb !== undefined && eb !== undefined) {
              dae.setEqSourceRange(eqId, sb, eb);
            }
            return;
          }
        }

        if (Cst.WhenEquation.is(node) || node.type === "when_equation") {
          if (isInitial) {
            const diagRange = getElementDiagRange(node);
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.WHEN_IN_INITIAL_EQUATION.code,
              message: `when-clause is not allowed in initial section.`,
              range: diagRange,
            });
            return;
          }

          // Check condition for noEvent
          const cond =
            Cst.WhenEquation.condition(node) ?? (node.children || []).find((c: any) => c.type === "expression");
          if (cond && cond.text?.trim()?.includes("noEvent")) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.WHEN_CONDITION_NOT_DISCRETE.code,
              message: `When-condition '${cond.text.trim()}' is not a discrete-time expression.`,
              range: {
                startPosition: node.startPosition,
                endPosition: node.endPosition,
              },
            });
            return;
          }

          // Check if-equations inside when-equation for consistent LHS branches
          const checkIfInWhen = (n: any): boolean => {
            if (n.type === "if_equation" || Cst.IfEquation.is(n)) {
              const branches: string[][] = [[]];
              let curBranch = branches[0];
              for (const child of n.children || []) {
                const norm = Cst.kind(child);
                const text = child.text?.trim() ?? "";
                if (
                  norm === "elseif" ||
                  child.type === "elseif" ||
                  text === "elseif" ||
                  norm === "else" ||
                  child.type === "else" ||
                  text === "else"
                ) {
                  curBranch = [];
                  branches.push(curBranch);
                } else {
                  const collectSimpleLhs = (sn: any) => {
                    if (sn.type === "simple_equation") {
                      const lhs = (sn.children || []).find(
                        (k: any) => k.type === "lhs_expression" || k.type === "component_reference",
                      );
                      if (lhs) {
                        const v = lhs.text.trim().replace(/\s+/g, "");
                        if (!curBranch.includes(v)) curBranch.push(v);
                      }
                      return;
                    }
                    for (const c of sn.children || []) {
                      collectSimpleLhs(c);
                    }
                  };
                  collectSimpleLhs(child);
                }
              }
              if (branches.length > 1) {
                const baseVars = branches[0].slice().sort();
                let mismatch = false;
                for (let b = 1; b < branches.length; b++) {
                  const compVars = branches[b].slice().sort();
                  if (baseVars.length !== compVars.length || baseVars.some((v, i) => v !== compVars[i])) {
                    mismatch = true;
                    break;
                  }
                }
                if (mismatch) {
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.WHEN_IF_BRANCH_LHS_MISMATCH.code,
                    message:
                      "The branches of an if-equation inside a when-equation must have the same set of component references on the left-hand side.",
                    range: {
                      startPosition: n.startPosition,
                      endPosition: n.endPosition,
                    },
                  });
                  return true;
                }
              }
            }
            for (const c of n.children || []) {
              if (checkIfInWhen(c)) return true;
            }
            return false;
          };

          if (checkIfInWhen(node)) return;

          // Collect elsewhen conditions
          const elseConditions: any[] = [];
          let nextIsElseCond = false;
          for (const child of node.children || []) {
            const norm = Cst.kind(child);
            const text = child.text?.trim() ?? "";
            if (norm === "elsewhen" || child.type === "elsewhen" || text === "elsewhen") {
              nextIsElseCond = true;
            } else if (nextIsElseCond && (child.type === "expression" || !child.isTerminal)) {
              elseConditions.push(child);
              nextIsElseCond = false;
            }
          }

          const isClockNode = (n: any): boolean => {
            if (!n) return false;
            const txt = n.text?.trim() ?? "";
            if (/^(?:\.?Clock)\s*\(/.test(txt)) return true;
            try {
              const eid = flattener.lowerExpr(n, dae, prefix, substitutions);
              if (eid >= 0 && dae.getExprKind(eid) === ExprKind.Call) {
                const callee = dae.interner.resolve(dae.getExprData1(eid));
                if (callee === "Clock" || callee === ".Clock") return true;
              }
            } catch {}
            return false;
          };

          if (elseConditions.length > 0) {
            if (isClockNode(cond)) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.CLOCKED_WHEN_HAS_ELSEWHEN.code,
                message: "Clocked when equation can not contain elsewhen part.",
                range: {
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                },
              });
              return;
            }
            for (const ec of elseConditions) {
              if (isClockNode(ec)) {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.CLOCKED_WHEN_BRANCH_IN_WHEN.code,
                  message: "Clocked when branch in when equation.",
                  range: {
                    startPosition: node.startPosition,
                    endPosition: node.endPosition,
                  },
                });
                return;
              }
            }
          }

          // Check elsewhen variable consistency
          const whenBranches: string[][] = [[]];
          let currentWhenBranch = whenBranches[0];
          for (const child of node.children || []) {
            const text = child.text?.trim() ?? "";
            const norm = Cst.kind(child);
            if (norm === "elsewhen" || child.type === "elsewhen" || text === "elsewhen") {
              currentWhenBranch = [];
              whenBranches.push(currentWhenBranch);
            } else {
              const collectLhs = (n: any) => {
                if (n.type === "simple_equation") {
                  const lhs = (n.children || []).find(
                    (k: any) => k.type === "lhs_expression" || k.type === "component_reference",
                  );
                  if (lhs) {
                    const v = lhs.text.trim().replace(/\s+/g, "");
                    if (!currentWhenBranch.includes(v)) currentWhenBranch.push(v);
                  }
                  return;
                }
                for (const c of n.children || []) {
                  collectLhs(c);
                }
              };
              collectLhs(child);
            }
          }

          if (whenBranches.length > 1) {
            const hasNestedWhen = (node.children || []).some(
              (c: any) => c.type === "when_equation" || c.type === "when_statement",
            );
            if (hasNestedWhen) return;
            const baseVars = whenBranches[0].slice().sort();
            let hasMismatch = false;
            for (let b = 1; b < whenBranches.length; b++) {
              const compVars = whenBranches[b].slice().sort();
              if (baseVars.length !== compVars.length) {
                hasMismatch = true;
                break;
              }
              for (let i = 0; i < baseVars.length; i++) {
                if (baseVars[i] !== compVars[i]) {
                  hasMismatch = true;
                  break;
                }
              }
              if (hasMismatch) break;
            }
            if (hasMismatch) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.ELSEWHEN_VARIABLE_MISMATCH.code,
                message: ModelicaErrorCode.ELSEWHEN_VARIABLE_MISMATCH.message(),
                range: {
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                },
              });
              return;
            }
          }

          const condId = cond ? flattener.lowerExpr(cond, dae, prefix, substitutions) : -1;
          const whenIdx = dae.addWhenEquation(condId);

          let hasWhenLhsError = false;
          const collectWhenBody = (n: any) => {
            if (!n || hasWhenLhsError) return;
            if (n.type === "simple_equation") {
              const leftNode = Cst.SimpleEquation.lhs(n) ?? n.childForFieldId?.(FieldId.lhs);
              const rightNode = Cst.SimpleEquation.rhs(n) ?? n.childForFieldId?.(FieldId.rhs);
              const expressions =
                leftNode && rightNode ? [leftNode, rightNode] : (n.children || []).filter(isEquationExpr);
              if (expressions.length >= 2) {
                let lhsId = flattener.lowerExpr(expressions[0], dae, prefix, substitutions);
                let rhsId = flattener.lowerExpr(expressions[1], dae, prefix, substitutions);
                if (isRealExpr(lhsId, dae) && !isRealExpr(rhsId, dae)) {
                  rhsId = castToRealExpr(rhsId, dae);
                }
                if (dae.getExprKind(rhsId) === ExprKind.Call) {
                  const fnName = dae.interner.resolve(dae.getExprData1(rhsId));
                  if (fnName === "fill" && dae.getExprRight(rhsId) >= 2) {
                    const arg2 = dae.getExprLeft(rhsId + 1);
                    if (evalDaeExpr(arg2, dae) === 0) {
                      return;
                    }
                  }
                }
                const lhsKind = dae.getExprKind(lhsId);
                if (
                  lhsKind === ExprKind.Binary ||
                  lhsKind === ExprKind.RealLiteral ||
                  lhsKind === ExprKind.IntLiteral ||
                  lhsKind === ExprKind.Unary
                ) {
                  const out = new StringWriter();
                  const printer = new ArenaDAEPrinter(out, dae, true);
                  printer.printExpr(lhsId);
                  const lhsStr = out.toString();
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.INVALID_WHEN_LHS.code,
                    message: `Invalid left-hand side of when-equation: ${lhsStr}.`,
                    range: {
                      startPosition: n.startPosition,
                      endPosition: n.endPosition,
                    },
                  });
                  hasWhenLhsError = true;
                  return;
                }
                dae.addWhenBodyEquation(whenIdx, EqKind.Simple, lhsId, rhsId);
              }
              return;
            }

            if (n.type === "connect_equation") {
              const connText = n.text?.trim()?.replace(/;$/, "") ?? "connect(...)";
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.CONNECT_IN_WHEN.code,
                message: ModelicaErrorCode.CONNECT_IN_WHEN.message(connText),
                range: {
                  startPosition: n.startPosition,
                  endPosition: n.endPosition,
                },
              });
              return;
            }

            if (n.type === "function_call") {
              emitFunctionCallEquation(flattener, n, dae, prefix, substitutions, false, whenIdx);
              return;
            }

            for (const child of n.children || []) {
              if (child !== cond && child.type !== "when" && child.type !== "then" && child.type !== "end when") {
                collectWhenBody(child);
              }
            }
          };

          for (const kid of node.children || []) {
            if (kid !== cond && kid.type !== "when" && kid.type !== "then" && kid.type !== "end when") {
              collectWhenBody(kid);
            }
          }
          return;
        }

        // Algorithm sections:
        if (node.type === "algorithm_section") {
          (dae as any).hasAlgorithmSection = true;
          const prevInAlg = (dae as any).inAlgorithmSection;
          (dae as any).inAlgorithmSection = true;
          const secStart = dae.stmtCount;
          const isInitAlg =
            (node.text?.trim()?.startsWith("initial") ?? false) ||
            (node.children || []).some(
              (c: any) => c.text?.trim() === "initial" || c.type === '"initial"' || c.type === "initial",
            );

          const extractExecutableStmts = (n: any): any[] => {
            if (!n) return [];
            const text = n.text?.trim() ?? "";
            if (
              n.type === "assignment_statement" ||
              n.type === "when_statement" ||
              n.type === "for_statement" ||
              n.type === "while_statement" ||
              n.type === "if_statement" ||
              n.type === "function_call" ||
              n.type === "break" ||
              n.type === '"break"' ||
              text === "break" ||
              n.type === "return" ||
              n.type === '"return"' ||
              text === "return"
            ) {
              return [n];
            }
            if (n.type === "statement" || n.type === "statement_or_procedure") {
              if ((n.children || []).some((c: any) => c.type === "output_expression_list")) {
                return [n];
              }
              const hasAssign = (n.children || []).some((c: any) => c.text?.trim() === ":=" || c.type === ":=");
              const hasCallArgs = (n.children || []).some(
                (c: any) => c.type === "function_call_args" || c.text?.trim() === "(",
              );
              if (!hasAssign && hasCallArgs) {
                return [n];
              }
              const res: any[] = [];
              for (const c of n.children || []) {
                if (c.type !== "description" && c.type !== ";" && c.text?.trim() !== ";") {
                  res.push(...extractExecutableStmts(c));
                }
              }
              return res;
            }
            return [];
          };

          const lowerStatement = (sNode: any): void => {
            if (!sNode) return;

            const sText = (sNode.text ?? "").trim();
            let rootP: any = sNode;
            while (rootP?.parent) rootP = rootP.parent;
            const fileSrc = rootP?.text ?? "";
            const allowsReinitInAlg =
              dae.extensionMetadata?.isOldFrontend ||
              (flattener.options as any)?.allowNonStandardModelica?.includes("reinitInAlgorithms") ||
              /annotation\s*\(\s*__OpenModelica_commandLineOptions\s*=\s*"[^"]*reinitInAlgorithms[^"]*"\s*\)/.test(
                fileSrc,
              );
            if (
              (/^\s*reinit\s*\(/.test(sText) || (sNode.type === "function_call" && sText.startsWith("reinit"))) &&
              !allowsReinitInAlg
            ) {
              let startB = sNode.startIndex ?? sNode.startByte;
              let endB = sNode.endIndex ?? sNode.endByte;
              if (endB != null && sText.endsWith(";")) endB -= 1;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.REINIT_IN_ALGORITHM.code,
                message: ModelicaErrorCode.REINIT_IN_ALGORITHM.message(),
                range: {
                  startByte: startB,
                  endByte: endB,
                  startPosition: sNode.startPosition,
                  endPosition: sNode.endPosition,
                },
              });
              return;
            }

            if (sNode.type === "statement" || sNode.type === "statement_or_procedure") {
              const outList = (sNode.children || []).find((c: any) => c.type === "output_expression_list");
              const fnCall = (sNode.children || []).find((c: any) => c.type === "function_call");
              if (outList && fnCall) {
                const rawTargets: (any | null)[] = [];
                let currentExpr: any | null = null;
                for (const k of outList.children || []) {
                  if (k.type === "," || k.text?.trim() === ",") {
                    rawTargets.push(currentExpr);
                    currentExpr = null;
                  } else if (k.type === "expression" || k.type === "component_reference") {
                    currentExpr = k;
                  }
                }
                rawTargets.push(currentExpr);
                let stmtText = sNode.text?.trim() ?? "";
                if (stmtText.endsWith(";")) stmtText = stmtText.slice(0, -1).trim();
                for (const rt of rawTargets) {
                  if (!rt) continue;
                  const rText = rt.text?.trim() ?? "";
                  const vIdx = dae.getVarIdxByName(prefix ? `${prefix}.${rText}` : rText);
                  if (vIdx >= 0) {
                    const vari = dae.getVarVariability(vIdx);
                    if (vari === Variability.Parameter || vari === Variability.Constant) {
                      const isFixed = dae.getVarAttr(vIdx, "fixed");
                      const isExplicitFalse =
                        isFixed >= 0 &&
                        dae.getExprKind(isFixed) === ExprKind.BoolLiteral &&
                        dae.getExprData1(isFixed) === 0;
                      if ((isInitial || isInitAlg) && isExplicitFalse && vari === Variability.Parameter) {
                        continue;
                      }
                      let fixedStr = "";
                      if (
                        isFixed >= 0 &&
                        dae.getExprKind(isFixed) === ExprKind.BoolLiteral &&
                        dae.getExprData1(isFixed) === 1
                      ) {
                        fixedStr = "(fixed=true)";
                      } else if (vari === Variability.Parameter) {
                        fixedStr = "(fixed=true)";
                      }
                      const formattedCall = stmtText.replace(/\b([a-zA-Z_]\w*)\s*\(\s*(\d+)\s*\)/, (_, fn, arg) => {
                        const qual = flattener.currentRootClassId
                          ? `${db.symbol(flattener.currentRootClassId)?.name}.${fn}`
                          : fn;
                        return `${qual}(${Number(arg).toFixed(1)})`;
                      });
                      const startB = sNode.startIndex ?? sNode.startByte;
                      const endB = sNode.endIndex ?? sNode.endByte;
                      dae.diagnostics.push({
                        severity: "error",
                        code: ModelicaErrorCode.ASSIGNMENT_TO_PARAMETER.code,
                        message: `Trying to assign to parameter component ${rText}${fixedStr} in ${formattedCall}`,
                        range: {
                          startByte: startB,
                          endByte: endB,
                          startPosition: sNode.startPosition,
                          endPosition: sNode.endPosition,
                        },
                      });
                      return;
                    }
                  }
                }

                const fnCallId = flattener.lowerExpr(fnCall, dae, prefix, substitutions, true);
                const fnName = fnCall.children?.[0]?.text?.trim() ?? fnCall.text?.split("(")[0]?.trim() ?? "";
                const fnObj =
                  dae.getFunction(fnName) ||
                  dae.getFunction(`${prefix}${fnName}`) ||
                  dae.getFunction(fnName.split(".").pop() ?? "");
                if (fnObj) {
                  const fnOutputs: { name: string; type: string }[] = [];
                  for (let i = 0; i < fnObj.varCount; i++) {
                    if (fnObj.getVarCausality(i) === Causality.Output) {
                      const vType = fnObj.getVarType(i);
                      const typeName =
                        vType === VarType.Integer
                          ? "Integer"
                          : vType === VarType.Boolean
                            ? "Boolean"
                            : vType === VarType.String
                              ? "String"
                              : "Real";
                      fnOutputs.push({ name: fnObj.getVarName(i), type: typeName });
                    }
                  }
                  if (fnOutputs.length > 0 && rawTargets.length !== fnOutputs.length) {
                    const targetTypes: string[] = [];
                    for (const rt of rawTargets) {
                      if (!rt) {
                        targetTypes.push("Unknown");
                      } else {
                        const rText = rt.text?.trim() ?? "";
                        const vIdx = dae.getVarIdxByName(prefix ? `${prefix}${rText}` : rText);
                        if (vIdx >= 0) {
                          const vType = dae.getVarType(vIdx);
                          targetTypes.push(
                            vType === VarType.Integer
                              ? "Integer"
                              : vType === VarType.Boolean
                                ? "Boolean"
                                : vType === VarType.String
                                  ? "String"
                                  : "Real",
                          );
                        } else {
                          targetTypes.push("Real");
                        }
                      }
                    }
                    const targetSig = `(${targetTypes.join(", ")})`;
                    const fnSig = `(${fnOutputs.map((o) => o.type).join(", ")})`;
                    const startB = sNode.startIndex ?? sNode.startByte;
                    const endB = sNode.endIndex ?? sNode.endByte;
                    let stmtText = sNode.text?.trim() ?? "";
                    if (stmtText.endsWith(";")) stmtText = stmtText.slice(0, -1).trim();
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.code,
                      message: `Type mismatch in assignment in ${stmtText} of ${targetSig} := ${fnSig}`,
                      range: {
                        startByte: startB,
                        endByte: endB,
                        startPosition: sNode.startPosition,
                        endPosition: sNode.endPosition,
                      },
                    });
                    return;
                  }
                }
                dae.addStatement(StmtKind.ComplexAssignment, rawTargets.length, fnCallId);
                for (const rt of rawTargets) {
                  const tid = rt ? flattener.lowerExpr(rt, dae, prefix, substitutions) : -1;
                  dae.addStatement(StmtKind.Assignment, tid);
                }
                return;
              }

              const hasAssign = (sNode.children || []).some((c: any) => c.text?.trim() === ":=" || c.type === ":=");
              const hasCallArgs = (sNode.children || []).some(
                (c: any) => c.type === "function_call_args" || c.text?.trim() === "(",
              );
              if (!hasAssign && hasCallArgs) {
                const callId = flattener.lowerExpr(sNode, dae, prefix, substitutions);
                if (!isStaticTrueAssert(callId, dae)) {
                  const sId = dae.addStatement(StmtKind.ProcedureCall, callId);
                  ((dae as any).stmtRanges ??= new Map()).set(sId, {
                    startByte: sNode.startIndex ?? sNode.startByte,
                    endByte: sNode.endIndex ?? sNode.endByte,
                    startPosition: sNode.startPosition,
                    endPosition: sNode.endPosition,
                  });
                }
                return;
              }

              for (const c of sNode.children || []) {
                if (c.type !== "description" && c.type !== ";" && c.text?.trim() !== ";") {
                  lowerStatement(c);
                }
              }
              return;
            }

            const trimmedText = sNode.text?.trim() ?? "";
            if (sNode.type === "break" || sNode.type === '"break"' || trimmedText === "break") {
              dae.addStatement(StmtKind.Break);
              return;
            }

            if (sNode.type === "return" || sNode.type === '"return"' || trimmedText === "return") {
              dae.addStatement(StmtKind.Return);
              return;
            }

            if (sNode.type === "function_call") {
              const callId = flattener.lowerExpr(sNode, dae, prefix, substitutions);
              if (isStaticTrueAssert(callId, dae)) {
                return;
              }
              const sId = dae.addStatement(StmtKind.ProcedureCall, callId);
              ((dae as any).stmtRanges ??= new Map()).set(sId, {
                startByte: sNode.startIndex ?? sNode.startByte,
                endByte: sNode.endIndex ?? sNode.endByte,
                startPosition: sNode.startPosition,
                endPosition: sNode.endPosition,
              });
              return;
            }

            if (sNode.type === "for_statement") {
              const indicesNode = (sNode.children || []).find((c: any) => c.type === "for_indices");
              const forIndices = (indicesNode?.children || []).filter((c: any) => c.type === "for_index");
              if (forIndices.length === 0) {
                const fIndex = indicesNode
                  ? (indicesNode.children || []).find((c: any) => c.type === "for_index")
                  : null;
                if (fIndex) forIndices.push(fIndex);
              }

              const bodyStmts: any[] = [];
              let inLoop = false;
              for (const child of sNode.children || []) {
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
                if (inLoop && child.type !== ";" && child.text?.trim() !== ";") {
                  bodyStmts.push(...extractExecutableStmts(child));
                }
              }

              const deduceRange = (varName: string): number => {
                let targetArr = "";
                let targetDimIdx = -1;

                const findSubscript = (node: any) => {
                  if (!node || targetArr) return;
                  if (node.type === "array_subscripts" && node.childCount > 0) {
                    const p = node.parent;
                    let baseText = "";
                    if (p && p.childCount >= 2) {
                      baseText = p.child(0)?.text?.trim() ?? "";
                    }
                    let dim = 0;
                    for (const sc of node.children || []) {
                      if (sc.type === "subscript" || sc.type === "expression") {
                        if (sc.text?.trim() === varName) {
                          targetArr = baseText;
                          targetDimIdx = dim;
                          return;
                        }
                        dim++;
                      }
                    }
                  }
                  for (const c of node.children || []) {
                    findSubscript(c);
                  }
                };

                for (const s of bodyStmts) {
                  findSubscript(s);
                  if (targetArr) break;
                }

                if (targetArr && targetDimIdx >= 0) {
                  let maxIdx = 0;
                  const namedShape =
                    (dae as any).getNamedArrayShape?.(targetArr) ?? (dae as any).namedArrayShapes?.get(targetArr);
                  if (namedShape && namedShape.length > targetDimIdx && namedShape[targetDimIdx]! > 0) {
                    maxIdx = namedShape[targetDimIdx]!;
                  } else {
                    const vIdx = dae.getVarIdxByName(targetArr);
                    if (vIdx >= 0) {
                      const shape = dae.getVarShape(vIdx);
                      if (shape && shape.length > targetDimIdx && shape[targetDimIdx]! > 0) {
                        maxIdx = shape[targetDimIdx]!;
                      }
                    }
                  }
                  if (maxIdx === 0) {
                    const prefix = `${targetArr}[`;
                    for (let v = 0; v < dae.varCount; v++) {
                      const vName = dae.getVarName(v);
                      if (vName.startsWith(prefix) && vName.endsWith("]")) {
                        const rest = vName.slice(prefix.length, -1);
                        const indices = rest.split(",").map(Number);
                        if (targetDimIdx < indices.length && indices[targetDimIdx]! > maxIdx) {
                          maxIdx = indices[targetDimIdx]!;
                        }
                      }
                    }
                  }
                  if (maxIdx > 0) {
                    const oneId = dae.addIntLiteral(1);
                    const maxExprId = dae.addIntLiteral(maxIdx);
                    return dae.addBinaryExpr(BinOp.Colon, oneId, maxExprId);
                  }
                }
                return -1;
              };

              const lowerForIndexAt = (idx: number) => {
                if (idx >= forIndices.length) {
                  for (const s of bodyStmts) {
                    lowerStatement(s);
                  }
                  return;
                }
                const fi = forIndices[idx];
                const varName = fi.child(0)?.text?.trim() ?? "i";
                const rangeNode = (fi.children || []).find((c: any) => c.type === "expression");
                let rangeExprId = -1;
                const enumVals = evaluateEnumRange(
                  rangeNode,
                  substitutions,
                  flattener.currentRootClassId,
                  flattener.db,
                  dae,
                  prefix,
                );
                if (enumVals && enumVals.length > 0) {
                  const litExprIds = enumVals.map((lit: string) =>
                    dae.addExpression(ExprKind.Name, dae.interner.intern(lit)),
                  );
                  rangeExprId = dae.addArrayCtorExpr(litExprIds);
                }
                if (rangeExprId < 0) {
                  rangeExprId = rangeNode ? flattener.lowerExpr(rangeNode, dae, prefix, substitutions) : -1;
                }
                if (rangeExprId < 0) {
                  rangeExprId = deduceRange(varName);
                }
                const isInnermost = idx === forIndices.length - 1;
                const childCount = isInnermost ? bodyStmts.length : 1;
                dae.addStatement(StmtKind.For, dae.interner.intern(varName), rangeExprId, childCount);
                flattener.pushLoopVar(varName);
                try {
                  lowerForIndexAt(idx + 1);
                } finally {
                  flattener.popLoopVar(varName);
                }
              };

              lowerForIndexAt(0);
              return;
            }

            if (Cst.WhileStatement.is(sNode) || sNode.type === "while_statement") {
              const cond =
                Cst.WhileStatement.condition(sNode) ?? (sNode.children || []).find((c: any) => c.type === "expression");
              const condId = cond ? flattener.lowerExpr(cond, dae, prefix, substitutions) : -1;
              const bodyStmts: any[] = [];
              const cstBodies = Cst.WhileStatement.bodyList(sNode);
              if (cstBodies && cstBodies.length > 0) {
                for (const b of cstBodies) {
                  bodyStmts.push(...extractExecutableStmts(b));
                }
              } else {
                let inLoop = false;
                for (const child of sNode.children || []) {
                  const norm = Cst.kind(child);
                  if (norm === "loop") {
                    inLoop = true;
                    continue;
                  }
                  if (norm === "end while") {
                    inLoop = false;
                    break;
                  }
                  if (inLoop && norm !== ";") {
                    bodyStmts.push(...extractExecutableStmts(child));
                  }
                }
              }
              dae.addStatement(StmtKind.While, condId, bodyStmts.length);
              for (const s of bodyStmts) {
                lowerStatement(s);
              }
              return;
            }

            if (Cst.IfStatement.is(sNode) || sNode.type === "if_statement") {
              const cond =
                Cst.IfStatement.condition(sNode) ?? (sNode.children || []).find((c: any) => c.type === "expression");
              const condId = cond ? flattener.lowerExpr(cond, dae, prefix, substitutions) : -1;

              let inThen = false;
              let inElseIf = false;
              let inElseIfThen = false;
              let inElse = false;
              const thenStmts: any[] = [];
              const branches: { condNode: any; stmts: any[] }[] = [];
              let currBranch: { condNode: any; stmts: any[] } | null = null;

              for (const child of sNode.children || []) {
                const norm = Cst.kind(child);
                if (norm === "then") {
                  if (inElseIf) {
                    inElseIfThen = true;
                  } else if (!inElse) {
                    inThen = true;
                  }
                  continue;
                }
                if (norm === "elseif") {
                  inThen = false;
                  inElseIf = true;
                  inElseIfThen = false;
                  inElse = false;
                  currBranch = { condNode: null, stmts: [] };
                  branches.push(currBranch);
                  continue;
                }
                if (norm === "else") {
                  inThen = false;
                  inElseIf = false;
                  inElseIfThen = false;
                  inElse = true;
                  currBranch = { condNode: null, stmts: [] };
                  branches.push(currBranch);
                  continue;
                }
                if (norm === "end if") {
                  inThen = false;
                  inElseIf = false;
                  inElseIfThen = false;
                  inElse = false;
                  break;
                }
                if (inElseIf && currBranch) {
                  if (!inElseIfThen) {
                    if (child.type === "expression") {
                      currBranch.condNode = child;
                    }
                  } else if (norm !== ";") {
                    currBranch.stmts.push(...extractExecutableStmts(child));
                  }
                } else if (inElse && currBranch) {
                  if (norm !== ";") {
                    currBranch.stmts.push(...extractExecutableStmts(child));
                  }
                } else if (inThen) {
                  if (norm !== ";") {
                    thenStmts.push(...extractExecutableStmts(child));
                  }
                }
              }

              const evalCond = (id: number) => {
                if (id < 0) return undefined;
                if (dae.getExprKind(id) === ExprKind.BoolLiteral) {
                  return dae.getExprData1(id) !== 0;
                }
                return undefined;
              };
              const allBranches: { condNode: any; condId: number; stmts: any[]; condVal?: any }[] = [
                {
                  condNode: cond,
                  condId,
                  stmts: thenStmts,
                  condVal: evalCond(condId),
                },
              ];
              for (const b of branches) {
                const bCondId = b.condNode ? flattener.lowerExpr(b.condNode, dae, prefix, substitutions) : -1;
                const bCondVal = evalCond(bCondId);
                allBranches.push({ condNode: b.condNode, condId: bCondId, stmts: b.stmts, condVal: bCondVal });
              }

              let startIdx = 0;
              while (startIdx < allBranches.length && allBranches[startIdx]!.condVal === false) {
                startIdx++;
              }
              if (startIdx >= allBranches.length) {
                // All branches false
                return;
              }

              const rootBranch = allBranches[startIdx]!;
              if (rootBranch.condVal === true || !rootBranch.condNode) {
                // Statically true or unconditional else
                for (const s of rootBranch.stmts) {
                  lowerStatement(s);
                }
                return;
              }

              const activeBranches: { condId: number; stmts: any[] }[] = [];
              for (let i = startIdx + 1; i < allBranches.length; i++) {
                const b = allBranches[i]!;
                if (b.condVal === false) continue;
                if (b.condVal === true || !b.condNode) {
                  activeBranches.push({ condId: -1, stmts: b.stmts });
                  break;
                }
                activeBranches.push({ condId: b.condId, stmts: b.stmts });
              }

              dae.addStatement(StmtKind.If, rootBranch.condId, rootBranch.stmts.length, activeBranches.length);
              for (const s of rootBranch.stmts) {
                lowerStatement(s);
              }
              for (const b of activeBranches) {
                dae.addStatement(StmtKind.Block, b.condId, b.stmts.length);
                for (const s of b.stmts) {
                  lowerStatement(s);
                }
              }
              return;
            }

            if (sNode.type === "assignment_statement") {
              const exprs = (sNode.children || []).filter(
                (c: any) => c.type === "expression" || c.type === "component_reference",
              );
              if (exprs.length >= 2) {
                const targetText = exprs[0].text?.trim() ?? "";
                const cleanTargetText = targetText.split("[")[0]?.trim() ?? targetText;

                // 1. Check assignment to iterator
                if (flattener.activeLoopVars.has(cleanTargetText)) {
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.ASSIGNMENT_TO_ITERATOR.code,
                    message: ModelicaErrorCode.ASSIGNMENT_TO_ITERATOR.message(cleanTargetText),
                    range: {
                      startByte: sNode.startIndex ?? sNode.startByte,
                      endByte: sNode.endIndex ?? sNode.endByte,
                      startPosition: sNode.startPosition,
                      endPosition: sNode.endPosition,
                    },
                  });
                  return;
                }

                // 2. Check assignment to non-assignable class specialization (model, package, block)
                let targetCompSym: SymbolEntry | null = null;
                if (flattener.currentClassId) {
                  const children = db.childrenOf(flattener.currentClassId);
                  targetCompSym = children.find((c) => c.kind === "Component" && c.name === cleanTargetText) ?? null;
                }
                if (!targetCompSym) {
                  targetCompSym = db.byName(cleanTargetText).find((s) => s.kind === "Component") ?? null;
                }
                if (targetCompSym) {
                  let typeName = db.query<string | null>("typeSpecifier", targetCompSym.id);
                  if (!typeName) typeName = (targetCompSym.metadata as any)?.typeSpecifier;
                  let classSym: SymbolEntry | null = null;
                  const typeClassId = db.query<SymbolId | null>("classInstance", targetCompSym.id);
                  if (typeClassId) classSym = db.symbol(typeClassId);
                  if (!classSym && targetCompSym.parentId !== null && typeName) {
                    const simpleResolver = db.query<(n: string) => SymbolEntry | null>(
                      "resolveSimpleName",
                      targetCompSym.parentId,
                    );
                    if (simpleResolver) classSym = simpleResolver(typeName);
                  }
                  if (!classSym && typeName) {
                    const entries = db.byName(typeName);
                    classSym =
                      entries?.find((e: any) => e.kind === "Package" || e.kind === "Class" || e.kind === "Function") ??
                      null;
                  }
                  if (classSym) {
                    const classMeta = classSym.metadata as any;
                    const rawKind = String(
                      classMeta?.classKind ?? classMeta?.classPrefixes ?? classSym.kind ?? "",
                    ).toLowerCase();
                    const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
                    const words = cleanKind.split(/\s+/).filter(Boolean);
                    let specialization: string | null = null;
                    if (classSym.kind === "Package" || words.includes("package")) specialization = "package";
                    else if (classSym.kind === "Model" || words.includes("model")) specialization = "model";
                    else if (classSym.kind === "Block" || words.includes("block")) specialization = "block";
                    if (specialization) {
                      dae.diagnostics.push({
                        severity: "error",
                        code: ModelicaErrorCode.ASSIGNMENT_TO_NON_VARIABLE.code,
                        message: ModelicaErrorCode.ASSIGNMENT_TO_NON_VARIABLE.message(cleanTargetText, specialization),
                        range: {
                          startByte: sNode.startIndex ?? sNode.startByte,
                          endByte: sNode.endIndex ?? sNode.endByte,
                          startPosition: sNode.startPosition,
                          endPosition: sNode.endPosition,
                        },
                      });
                      return;
                    }
                  }
                }

                const targetId = flattener.lowerExpr(exprs[0], dae, prefix, substitutions, undefined, true);
                const isTupleTarget = dae.getExprKind(targetId) === ExprKind.Tuple;
                let valId = flattener.lowerExpr(exprs[1], dae, prefix, substitutions, isTupleTarget);

                // 3. Check assignment to constant or parameter
                const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
                const targetStr = printer.printExprToString(targetId);
                let valStr = printer.printExprToString(valId);

                let vIdx = dae.getVarIdxByName(targetStr);
                if (vIdx < 0 && cleanTargetText) vIdx = dae.getVarIdxByName(cleanTargetText);
                if (vIdx < 0 && cleanTargetText && prefix) vIdx = dae.getVarIdxByName(`${prefix}.${cleanTargetText}`);
                if (vIdx >= 0 && (dae as any).lastLoweredShape) {
                  const deducedShape = (dae as any).lastLoweredShape as number[];
                  if (deducedShape && deducedShape.length > 0 && deducedShape.every((d: number) => d > 0)) {
                    ((dae as any).deducedOutputShapes ??= new Map()).set(dae.getVarName(vIdx), deducedShape);
                    if (cleanTargetText !== dae.getVarName(vIdx)) {
                      (dae as any).deducedOutputShapes.set(cleanTargetText, deducedShape);
                    }
                    if (dae.classKind !== "function") {
                      dae.setVarShape(vIdx, deducedShape);
                    }
                  }
                }
                if (vIdx >= 0) {
                  const variability = dae.getVarVariability(vIdx);
                  if (variability === Variability.Constant || variability === Variability.Parameter) {
                    const displayTarget = targetText || cleanTargetText || targetStr;
                    if (dae.getVarType(vIdx) === VarType.Real && /^[+-]?\d+$/.test(valStr)) {
                      valStr = `${valStr}.0`;
                    }
                    if (variability === Variability.Constant) {
                      const msg = dae.extensionMetadata?.isOldFrontend
                        ? `Trying to assign to constant component ${displayTarget}.`
                        : ModelicaErrorCode.ASSIGNMENT_TO_CONSTANT.message(displayTarget, valStr);
                      dae.diagnostics.push({
                        severity: "error",
                        code: ModelicaErrorCode.ASSIGNMENT_TO_CONSTANT.code,
                        message: msg,
                        range: {
                          startByte: sNode.startIndex ?? sNode.startByte,
                          endByte: sNode.endIndex ?? sNode.endByte,
                          startPosition: sNode.startPosition,
                          endPosition: sNode.endPosition,
                        },
                      });
                      return;
                    }
                    if (variability === Variability.Parameter) {
                      dae.diagnostics.push({
                        severity: "error",
                        code: ModelicaErrorCode.ASSIGNMENT_TO_PARAMETER.code,
                        message: ModelicaErrorCode.ASSIGNMENT_TO_PARAMETER.message(displayTarget, valStr),
                        range: {
                          startByte: sNode.startIndex ?? sNode.startByte,
                          endByte: sNode.endIndex ?? sNode.endByte,
                          startPosition: sNode.startPosition,
                          endPosition: sNode.endPosition,
                        },
                      });
                      return;
                    }
                  }
                }

                const targetDims = getExprDims(targetId, dae, flattener.db);
                if (targetDims && targetDims.length > 0 && targetDims[0] === 0 && !exprs[1]?.text?.includes("[")) {
                  return;
                }
                const valDims = getExprDims(valId, dae, flattener.db);
                if (
                  targetDims &&
                  valDims &&
                  (targetDims.length !== valDims.length ||
                    targetDims.some((d, idx) => d > 0 && valDims[idx]! > 0 && d !== valDims[idx]))
                ) {
                  const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
                  const targetStr = printer.printExprToString(targetId);
                  const valStr = printer.printExprToString(valId);
                  const tType = inferArenaExprVarType(dae, targetId);
                  const vType = inferArenaExprVarType(dae, valId);
                  const tTypeName = varTypeName(tType ?? VarType.Real);
                  const vTypeName = varTypeName(vType ?? VarType.Real);
                  const startB = sNode.startIndex ?? sNode.startByte;
                  const endB = sNode.endIndex ?? sNode.endByte;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.code,
                    message: `Type mismatch in assignment in ${targetStr} := ${valStr} of ${tTypeName}[${targetDims.join(", ")}] := ${vTypeName}[${valDims.join(", ")}]`,
                    range: {
                      startByte: startB,
                      endByte: endB,
                      startPosition: sNode.startPosition,
                      endPosition: sNode.endPosition,
                    },
                  });
                  return;
                }

                if (isRealExpr(targetId, dae) && !isRealExpr(valId, dae)) {
                  valId = castToRealExpr(valId, dae);
                }
                const targetType = inferArenaExprVarType(dae, targetId);
                const valType = inferArenaExprVarType(dae, valId);
                if (targetType === VarType.Enumeration && valType === VarType.Integer) {
                  const val = dae.getExprKind(valId) === ExprKind.IntLiteral ? dae.getExprData1(valId) : null;
                  if (val !== null && dae.getExprKind(targetId) === ExprKind.Name) {
                    const nameId = dae.getExprData1(targetId);
                    let vIdx = dae.lookupVariable(nameId);
                    if (vIdx < 0) {
                      const nameStr = dae.interner.resolve(nameId);
                      if (nameStr) vIdx = dae.getVarIdxByName(nameStr);
                    }
                    if (vIdx >= 0) {
                      const lits = dae.getVarEnumerationLiterals(vIdx);
                      const cType = dae.getVarCustomType(vIdx);
                      if (lits && val >= 1 && val <= lits.length) {
                        const lit = lits[val - 1];
                        const litName =
                          typeof lit === "string"
                            ? lit
                            : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                        const varName = dae.getVarName(vIdx);
                        const enumPrefix =
                          flattener.options.omcCompatibility && varName ? `${cType ?? ""}$${varName}` : (cType ?? "");
                        const fullLit = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                        valId = dae.addEnumLiteral(val, fullLit);
                      }
                    }
                  }
                }
                if (targetType === VarType.Integer && valType === VarType.Real) {
                  const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
                  const targetStr = printer.printExprToString(targetId);
                  const valStr = printer.printExprToString(valId);
                  const startB = sNode.startIndex ?? sNode.startByte;
                  const endB = sNode.endIndex ?? sNode.endByte;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.code,
                    message: `Type mismatch in assignment in ${targetStr} := ${valStr} of Integer := Real`,
                    range: {
                      startByte: startB,
                      endByte: endB,
                      startPosition: sNode.startPosition,
                      endPosition: sNode.endPosition,
                    },
                  });
                  return;
                }
                if (dae.getExprKind(valId) === ExprKind.Call) {
                  const fnName = dae.interner.resolve(dae.getExprData1(valId));
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
                    if (outCount > 1 && dae.getExprKind(targetId) !== ExprKind.Tuple) {
                      valId = dae.addSubscriptExpr(valId, [dae.addIntLiteral(1)]);
                    }
                  }
                }
                if (valId >= 0) {
                  valId = simplifyArenaExpr(dae, valId);
                }
                dae.addStatement(StmtKind.Assignment, targetId, valId);
              }
              return;
            }

            if (Cst.WhenStatement.is(sNode) || sNode.type === "when_statement") {
              const cond =
                Cst.WhenStatement.condition(sNode) ?? (sNode.children || []).find((c: any) => c.type === "expression");
              if (cond && cond.text?.trim()?.includes("noEvent")) {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.WHEN_CONDITION_NOT_DISCRETE.code,
                  message: `When-condition '${cond.text.trim()}' is not a discrete-time expression.`,
                  range: {
                    startPosition: sNode.startPosition,
                    endPosition: sNode.endPosition,
                  },
                });
                return;
              }
              const condId = cond ? flattener.lowerExpr(cond, dae, prefix, substitutions) : -1;
              if (condId >= 0 && dae.getExprKind(condId) === ExprKind.Call) {
                const callee = dae.interner.resolve(dae.getExprData1(condId));
                if (callee === "Clock" || callee === ".Clock") {
                  const out = new StringWriter();
                  const printer = new ArenaDAEPrinter(out, dae, true);
                  printer.printExpr(condId);
                  const condStr = out.toString();
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.WHEN_CONDITIONAL_EXPECTED_BOOLEAN.code,
                    message: `Type error in when conditional '${condStr}'. Expected Boolean scalar or vector, got Clock.`,
                    range: {
                      startPosition: sNode.startPosition,
                      endPosition: sNode.endPosition,
                    },
                  });
                  return;
                }
              }

              let inThen = false;
              let inElseWhen = false;
              const thenStmts: any[] = [];
              const elseWhenList: { condNode: any; stmts: any[] }[] = [];
              let currEw: { condNode: any; stmts: any[] } | null = null;

              for (const child of sNode.children || []) {
                const norm = Cst.kind(child);
                if (norm === "then") {
                  if (!inElseWhen) inThen = true;
                  continue;
                }
                if (norm === "elsewhen") {
                  inThen = false;
                  inElseWhen = true;
                  currEw = { condNode: null, stmts: [] };
                  elseWhenList.push(currEw);
                  continue;
                }
                if (norm === "end when") {
                  inThen = false;
                  inElseWhen = false;
                  break;
                }
                if (inElseWhen && currEw) {
                  if (!currEw.condNode && child.type === "expression") {
                    currEw.condNode = child;
                  } else if (norm !== ";") {
                    currEw.stmts.push(...extractExecutableStmts(child));
                  }
                } else if (inThen) {
                  if (norm !== ";") {
                    thenStmts.push(...extractExecutableStmts(child));
                  }
                }
              }

              if (elseWhenList.length > 0) {
                const hasNestedWhen =
                  thenStmts.some((s: any) => s.type === "when_statement" || s.type === "when_equation") ||
                  elseWhenList.some((ew: any) =>
                    ew.stmts?.some((s: any) => s.type === "when_statement" || s.type === "when_equation"),
                  );
                if (hasNestedWhen) {
                  return;
                }
                const getTarget = (s: any): string | null => {
                  if (s.type === "assignment_statement") {
                    const tgt = (s.children || []).find((k: any) => k.type === "component_reference");
                    if (tgt) return tgt.text.trim().replace(/\s+/g, "");
                  }
                  return null;
                };
                const thenVars: string[] = [];
                for (const s of thenStmts) {
                  const t = getTarget(s);
                  if (t && !thenVars.includes(t)) thenVars.push(t);
                }
                thenVars.sort();
                let hasMismatch = false;
                for (const ew of elseWhenList) {
                  const ewVars: string[] = [];
                  for (const s of ew.stmts) {
                    const t = getTarget(s);
                    if (t && !ewVars.includes(t)) ewVars.push(t);
                  }
                  ewVars.sort();
                  if (thenVars.length !== ewVars.length) {
                    hasMismatch = true;
                    break;
                  }
                  for (let i = 0; i < thenVars.length; i++) {
                    if (thenVars[i] !== ewVars[i]) {
                      hasMismatch = true;
                      break;
                    }
                  }
                  if (hasMismatch) break;
                }
                if (hasMismatch) {
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.ELSEWHEN_VARIABLE_MISMATCH.code,
                    message: ModelicaErrorCode.ELSEWHEN_VARIABLE_MISMATCH.message(),
                    range: {
                      startPosition: sNode.startPosition,
                      endPosition: sNode.endPosition,
                    },
                  });
                  return;
                }
              }

              dae.addStatement(StmtKind.When, condId, thenStmts.length, elseWhenList.length);
              for (const s of thenStmts) {
                lowerStatement(s);
              }
              for (const ew of elseWhenList) {
                const ewCondId = ew.condNode ? flattener.lowerExpr(ew.condNode, dae, prefix, substitutions) : -1;
                dae.addStatement(StmtKind.Block, ewCondId, ew.stmts.length);
                for (const s of ew.stmts) {
                  lowerStatement(s);
                }
              }
              return;
            }

            for (const child of sNode.children || []) {
              if (
                child.type === "statement" ||
                child.type === "assignment_statement" ||
                child.type === "when_statement" ||
                child.type === "for_statement" ||
                child.type === "while_statement" ||
                child.type === "if_statement"
              ) {
                lowerStatement(child);
              }
            }
          };

          for (const stmt of node.children || []) {
            if (
              stmt.type === "statement" ||
              stmt.type === "assignment_statement" ||
              stmt.type === "when_statement" ||
              stmt.type === "for_statement" ||
              stmt.type === "while_statement" ||
              stmt.type === "if_statement"
            ) {
              lowerStatement(stmt);
            }
          }
          if (isInitAlg) {
            dae.initialAlgorithmSections.push({ start: secStart, count: dae.stmtCount - secStart });
          } else {
            dae.algorithmSections.push({ start: secStart, count: dae.stmtCount - secStart });
          }
          (dae as any).inAlgorithmSection = prevInAlg;
          return;
        }

        if (node.type === "equation_section") {
          const isInit =
            isInitial ||
            (node.text?.trim()?.startsWith("initial") ?? false) ||
            (node.children || []).some(
              (c: any) => c.text?.trim() === "initial" || c.type === '"initial"' || c.type === "initial",
            );
          for (const kid of node.children || []) {
            if (dae.diagnostics.some((d) => d.message.includes("Function argument delayTime"))) {
              break;
            }
            walk(kid, substitutions, isInit);
          }
          return;
        }

        if (node.type === "composition") {
          const eqSections: any[] = [];
          const otherChildren: any[] = [];
          for (const kid of node.children || []) {
            if (kid.type === "equation_section") {
              eqSections.push(kid);
            } else {
              otherChildren.push(kid);
            }
          }
          for (const eqSec of eqSections.slice().reverse()) {
            walk(eqSec, substitutions, isInitial);
          }
          for (const other of otherChildren) {
            walk(other, substitutions, isInitial);
          }
          return;
        }

        for (const kid of node.children || []) {
          if (kid.type !== "class_definition") {
            walk(kid, substitutions, isInitial);
          }
        }
      };
      walk(cst);
    } finally {
      flattener.currentParentMods = prevParentMods;
      flattener.currentClassId = prevClassId;
    }
  }

  const selfCstShort = db.cstNode(classId) as any;
  const specShort = getShortClassSpecifierNode(selfCstShort);
  if (specShort) {
    const typeSpec =
      Cst.ShortClassSpecifier.typeSpecifier(specShort) ??
      specShort.children?.find((c: any) => c.type === "type_specifier");
    const typeName = typeSpec?.text?.trim();
    if (typeName) {
      const matches = db.byName(typeName);
      if (matches.length > 0 && matches[0].kind === "Class") {
        const shortMod = db.query<any>("effectiveModification", classId);
        const shortArgs = shortMod?.args ?? [];
        const combinedMods = {
          args: [...(parentMods?.args ?? []), ...shortArgs],
          ownerClassId: parentMods?.ownerClassId ?? classId,
        };
        if (!curVisited.has(matches[0].id)) {
          extractClassEquations(flattener, matches[0].id, prefix, dae, curBreakContext, combinedMods, curVisited);
        }
      }
    }
  }

  for (const child of children) {
    if (child.kind === "Extends") {
      const extendsModParsedRaw = db.query<any>("extendsModificationParsed", child.id);
      const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
        ? extendsModParsedRaw
        : (extendsModParsedRaw?.args ?? []);

      const childBrokenComponents = new Set<string>(curBreakContext.brokenComponents);
      const childBrokenConnections = new Set<string>(curBreakContext.brokenConnections);

      for (const arg of extendsModParsed) {
        if (arg.isBreak || arg.value?.kind === "break") {
          if (arg.name.startsWith("break_connect:")) {
            const connStr = arg.name.substring("break_connect:".length);
            childBrokenConnections.add(connStr);
          } else {
            childBrokenComponents.add(arg.name);
          }
        }
      }

      const extSubMod = {
        args: [...(extendsModParsed || []), ...(parentMods?.args || [])],
      };
      const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
      const baseTargets = baseClass
        ? [baseClass]
        : (() => {
            try {
              const res =
                db.query<any>("resolveName", classId)?.(child.name) ??
                db.query<any>("resolveSimpleName", classId)?.(child.name);
              if (res) {
                const s = db.symbol(res);
                if (s && s.kind === "Class") return [s];
              }
            } catch {}
            return db.byName(child.name);
          })();
      for (const target of baseTargets) {
        if (target.kind === "Class") {
          if (curVisited.has(target.id) || target.id === classId) {
            const startB = child.startByte ?? 0;
            const endB = child.endByte ?? 0;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.EXTENDS_CYCLE.code,
              message: ModelicaErrorCode.EXTENDS_CYCLE.message(child.name),
              range: {
                startByte: startB,
                endByte: endB,
              },
            });
            continue;
          }
          extractClassEquations(
            flattener,
            target.id,
            prefix,
            dae,
            {
              brokenComponents: childBrokenComponents,
              brokenConnections: childBrokenConnections,
            },
            extSubMod,
            curVisited,
          );
        }
      }
    }
  }
}

export function expandConnectorRef(refStr: string, dae: DAEBuilder): string[] {
  // 1. Direct scalar or exact variable reference
  if (dae.getVarIdxByName(refStr) >= 0) {
    return [refStr];
  }
  // 2. Direct shape lookup for array connector
  const namedShape = (dae as any).getNamedArrayShape?.(refStr) ?? (dae as any).namedArrayShapes?.get(refStr);
  if (namedShape && namedShape.length > 0) {
    return generateArrayIndices(namedShape).map((idx) => `${refStr}${idx}`);
  }
  // 3. Fallback: regex scan when array elements exist in prefixes
  const prefixSet = getVarPrefixSet(dae);
  const parts = refStr.split(".");
  const firstPart = parts[0]!;
  const hasArrayPrefix = Array.from(prefixSet).some(
    (p) => p.startsWith(`${firstPart}[`) || p.startsWith(`${firstPart}.`),
  );
  if (!prefixSet.has(refStr) && !hasArrayPrefix) {
    return [refStr];
  }
  const pattern = new RegExp(
    "^(" +
      parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:\\[[\\d,\\s]+\\])?").join("\\.") +
      ")(?:\\..*)?$",
  );
  const found = new Set<string>();
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const vn = dae.getVarName(i);
    const m = vn.match(pattern);
    if (m && m[1].includes("[")) {
      found.add(m[1]);
    }
  }
  if (found.size === 0) return [refStr];
  return Array.from(found).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
