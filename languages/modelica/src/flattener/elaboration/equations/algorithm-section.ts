// SPDX-License-Identifier: AGPL-3.0-or-later

import { StringWriter } from "@modelscript/dsl/utils";
import {
  ArenaDAEPrinter,
  BinOp,
  Causality,
  ExprKind,
  inferArenaExprVarType,
  simplifyArenaExpr,
  StmtKind,
  Variability,
  VarType,
  varTypeName,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import {
  isSignedAsciiIntText,
  stripArraySubscripts,
  stripAsciiWhitespace,
  tokenizeCommentStrippedWords,
} from "../../expressions/cst-utils.js";
import {
  castToRealExpr,
  evaluateEnumRange,
  getArrayCtorElements,
  getExprDims,
  isRealExpr,
} from "../../expressions/index.js";
import { getFlatteningState, getNamedArrayShape } from "../../support/state.js";
import { formatQualifiedIntArgCallFromCst, hasCommandLineOptionInCst, isReinitCallNode } from "./cst-helpers.js";
import { isStaticTrueAssert } from "./function-call-eq.js";
import type { EquationCstNode, EquationWalkContext, FlattenOptionsWithNonStd, SymbolMetaLike } from "./types.js";

export function lowerAlgorithmSection(
  ctx: EquationWalkContext,
  node: EquationCstNode,
  substitutions: Map<string, number | string> | undefined,
  isInitial: boolean | undefined,
): void {
  const { flattener, db, prefix, dae } = ctx;
  const state = getFlatteningState(dae);
  state.hasAlgorithmSection = true;
  const prevInAlg = state.inAlgorithmSection;
  state.inAlgorithmSection = true;
  const secStart = dae.stmtCount;
  const isInitAlg =
    (node.text?.trim()?.startsWith("initial") ?? false) ||
    (node.children || []).some(
      (c: SyntaxNode) => c.text?.trim() === "initial" || c.type === '"initial"' || c.type === "initial",
    );

  // Recursively unwraps generic `statement` / `statement_or_procedure` CST wrappers
  // into concrete executable statement CST nodes while preserving multi-output
  // tuple assignments `(a, b) := fn(...)` and standalone procedure calls.
  const extractExecutableStmts = (n: SyntaxNode | null | undefined): SyntaxNode[] => {
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
      if ((n.children || []).some((c: SyntaxNode) => c.type === "output_expression_list")) {
        return [n];
      }
      const hasAssign = (n.children || []).some((c: SyntaxNode) => c.text?.trim() === ":=" || c.type === ":=");
      const hasCallArgs = (n.children || []).some(
        (c: SyntaxNode) => c.type === "function_call_args" || c.text?.trim() === "(",
      );
      if (!hasAssign && hasCallArgs) {
        return [n];
      }
      const res: SyntaxNode[] = [];
      for (const c of n.children || []) {
        if (c.type !== "description" && c.type !== ";" && c.text?.trim() !== ";") {
          res.push(...extractExecutableStmts(c));
        }
      }
      return res;
    }
    return [];
  };

  // Lowers a single imperative statement CST node into `DAEBuilder` statement arena entries.
  const lowerStatement = (sNode: SyntaxNode): void => {
    if (!sNode) return;

    // Validate `reinit(v, expr)`: forbidden inside algorithm sections by MLS §12.2
    // unless `--allowNonStandardModelica=reinitInAlgorithms` is active.
    if (isReinitCallNode(sNode)) {
      const sText = (sNode.text ?? "").trim();
      let allowsReinitInAlg =
        Boolean(dae.extensionMetadata?.["isOldFrontend"]) ||
        Boolean(
          (flattener.options as FlattenOptionsWithNonStd)?.allowNonStandardModelica?.includes("reinitInAlgorithms"),
        );
      if (!allowsReinitInAlg) {
        let rootP: SyntaxNode | null | undefined = sNode;
        while (rootP?.parent) rootP = rootP.parent;
        allowsReinitInAlg = hasCommandLineOptionInCst(rootP, "reinitInAlgorithms");
      }
      if (!allowsReinitInAlg) {
        let startB = sNode.startIndex ?? sNode.startOffset;
        let endB = sNode.endIndex ?? sNode.endOffset;
        if (endB != null && sText.endsWith(";")) endB -= 1;
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.REINIT_IN_ALGORITHM.code,
          message: ModelicaErrorCode.REINIT_IN_ALGORITHM.message(),
          range: {
            startOffset: startB,
            endOffset: endB,
            startPosition: sNode.startPosition,
            endPosition: sNode.endPosition,
          },
        });
        return;
      }
    }

    // Handle wrapper `statement` nodes: either multi-output tuple assignments
    // `(y1, y2) := fn(x)` or standalone procedure call statements `proc(x)`.
    if (sNode.type === "statement" || sNode.type === "statement_or_procedure") {
      const outList = (sNode.children || []).find((c: SyntaxNode) => c.type === "output_expression_list");
      const fnCall = (sNode.children || []).find((c: SyntaxNode) => c.type === "function_call");
      if (outList && fnCall) {
        // Extract comma-separated LHS target expressions, preserving null slots for wildcards.
        const rawTargets: (SyntaxNode | null)[] = [];
        let currentExpr: SyntaxNode | null = null;
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
        // Verify that none of the tuple LHS targets are read-only parameters or constants
        // (except `fixed=false` parameters inside `initial algorithm`).
        for (const rt of rawTargets) {
          if (!rt) continue;
          const rText = rt.text?.trim() ?? "";
          const vIdx = dae.getVarIdxByName(prefix ? `${prefix}.${rText}` : rText);
          if (vIdx >= 0) {
            const vari = dae.getVarVariability(vIdx);
            if (vari === Variability.Parameter || vari === Variability.Constant) {
              const isFixed = dae.getVarAttr(vIdx, "fixed");
              const isExplicitFalse =
                isFixed !== undefined &&
                isFixed >= 0 &&
                dae.getExprKind(isFixed) === ExprKind.BoolLiteral &&
                dae.getExprData1(isFixed) === 0;
              if ((isInitial || isInitAlg) && isExplicitFalse && vari === Variability.Parameter) {
                continue;
              }
              let fixedStr = "";
              if (
                isFixed !== undefined &&
                isFixed >= 0 &&
                dae.getExprKind(isFixed) === ExprKind.BoolLiteral &&
                dae.getExprData1(isFixed) === 1
              ) {
                fixedStr = "(fixed=true)";
              } else if (vari === Variability.Parameter) {
                fixedStr = "(fixed=true)";
              }
              const formattedCall = formatQualifiedIntArgCallFromCst(
                stmtText,
                fnCall,
                flattener.currentRootClassId ? db.symbol(flattener.currentRootClassId)?.name : undefined,
              );
              const startB = sNode.startIndex ?? sNode.startOffset;
              const endB = sNode.endIndex ?? sNode.endOffset;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.ASSIGNMENT_TO_PARAMETER.code,
                message: `Trying to assign to parameter component ${rText}${fixedStr} in ${formattedCall}`,
                range: {
                  startOffset: startB,
                  endOffset: endB,
                  startPosition: sNode.startPosition,
                  endPosition: sNode.endPosition,
                },
              });
              return;
            }
          }
        }

        // Validate that the number of LHS tuple targets matches the function's output arity.
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
            const startB = sNode.startIndex ?? sNode.startOffset;
            const endB = sNode.endIndex ?? sNode.endOffset;
            let stmtText = sNode.text?.trim() ?? "";
            if (stmtText.endsWith(";")) stmtText = stmtText.slice(0, -1).trim();
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.code,
              message: `Type mismatch in assignment in ${stmtText} of ${targetSig} := ${fnSig}`,
              range: {
                startOffset: startB,
                endOffset: endB,
                startPosition: sNode.startPosition,
                endPosition: sNode.endPosition,
              },
            });
            return;
          }
        }
        // If the function call was inlined directly into an `ExprKind.Tuple`, decompose into
        // individual `StmtKind.Assignment` statements; otherwise emit `StmtKind.ComplexAssignment`
        // followed by one `StmtKind.Assignment` slot per output target.
        if (dae.getExprKind(fnCallId) === ExprKind.Tuple) {
          const tupleElems = getArrayCtorElements(fnCallId, dae);
          if (tupleElems.length === rawTargets.length) {
            for (let i = 0; i < rawTargets.length; i++) {
              const rt = rawTargets[i];
              if (!rt) continue;
              const tid = flattener.lowerExpr(rt, dae, prefix, substitutions, undefined, true);
              if (tid >= 0) {
                dae.addStatement(StmtKind.Assignment, tid, tupleElems[i]!);
              }
            }
            return;
          }
        }
        dae.addStatement(StmtKind.ComplexAssignment, rawTargets.length, fnCallId);
        for (const rt of rawTargets) {
          const tid = rt ? flattener.lowerExpr(rt, dae, prefix, substitutions, undefined, true) : -1;
          dae.addStatement(StmtKind.Assignment, tid);
        }
        return;
      }

      const hasAssign = (sNode.children || []).some((c: SyntaxNode) => c.text?.trim() === ":=" || c.type === ":=");
      const hasCallArgs = (sNode.children || []).some(
        (c: SyntaxNode) => c.type === "function_call_args" || c.text?.trim() === "(",
      );
      if (!hasAssign && hasCallArgs) {
        const callId = flattener.lowerExpr(sNode, dae, prefix, substitutions);
        if (!isStaticTrueAssert(callId, dae)) {
          const sId = dae.addStatement(StmtKind.ProcedureCall, callId);
          state.stmtRanges.set(sId, {
            startOffset: sNode.startIndex ?? sNode.startOffset,
            endOffset: sNode.endIndex ?? sNode.endOffset,
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
      state.stmtRanges.set(sId, {
        startOffset: sNode.startIndex ?? sNode.startOffset,
        endOffset: sNode.endIndex ?? sNode.endOffset,
        startPosition: sNode.startPosition,
        endPosition: sNode.endPosition,
      });
      return;
    }

    // `for` statements in algorithms: preserve loop structure as nested `StmtKind.For`
    // arena statements rather than unrolling, deducing implicit `for i loop` bounds
    // from subscripted array shapes in the loop body when the `in range` clause is omitted.
    if (sNode.type === "for_statement") {
      const indicesNode = (sNode.children || []).find((c: SyntaxNode) => c.type === "for_indices");
      const forIndices = (indicesNode?.children || []).filter((c: SyntaxNode) => c.type === "for_index");
      if (forIndices.length === 0) {
        const fIndex = indicesNode
          ? (indicesNode.children || []).find((c: SyntaxNode) => c.type === "for_index")
          : null;
        if (fIndex) forIndices.push(fIndex);
      }

      const bodyStmts: SyntaxNode[] = [];
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

      // Infers `1:maxIdx` (or `firstEnum:lastEnum`) when a `for` index omits an explicit range
      // by inspecting which array dimension is indexed by `varName` inside `bodyStmts`.
      const deduceRange = (varName: string): number => {
        let targetArr = "";
        let targetDimIdx = -1;

        const findSubscript = (node: SyntaxNode | null | undefined) => {
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
          const namedShape = getNamedArrayShape(dae, targetArr);
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
            const arrPrefix = prefix ? `${prefix}.${targetArr}[` : `${targetArr}[`;
            const fallbackPrefix = `${targetArr}[`;
            const enumIndices: string[] = [];
            for (let v = 0; v < dae.varCount; v++) {
              const vName = dae.getVarName(v);
              const matchedPrefix =
                vName.startsWith(arrPrefix) && vName.endsWith("]")
                  ? arrPrefix
                  : vName.startsWith(fallbackPrefix) && vName.endsWith("]")
                    ? fallbackPrefix
                    : null;
              if (matchedPrefix) {
                const rest = vName.slice(matchedPrefix.length, -1);
                const rawParts = rest.split(",");
                if (targetDimIdx < rawParts.length) {
                  const part = rawParts[targetDimIdx]!.trim();
                  const num = Number(part);
                  if (!isNaN(num)) {
                    if (num > maxIdx) maxIdx = num;
                  } else if (part && !enumIndices.includes(part)) {
                    enumIndices.push(part);
                  }
                }
              }
            }
            if (maxIdx === 0 && enumIndices.length > 0) {
              const firstId = dae.addExpression(ExprKind.Name, dae.interner.intern(enumIndices[0]!));
              const lastId = dae.addExpression(
                ExprKind.Name,
                dae.interner.intern(enumIndices[enumIndices.length - 1]!),
              );
              return dae.addBinaryExpr(BinOp.Colon, firstId, lastId);
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

      // Recursively emits one `StmtKind.For` header per multi-index `for i in ..., j in ...` level.
      const lowerForIndexAt = (idx: number) => {
        if (idx >= forIndices.length) {
          for (const s of bodyStmts) {
            lowerStatement(s);
          }
          return;
        }
        const fi = forIndices[idx]!;
        const varName = fi.child(0)?.text?.trim() ?? "i";
        const rangeNode = (fi.children || []).find((c: SyntaxNode) => c.type === "expression");
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
          const litExprIds = enumVals.map((lit: string) => dae.addExpression(ExprKind.Name, dae.interner.intern(lit)));
          if (rangeNode?.text?.includes(":") && litExprIds.length >= 2) {
            rangeExprId = dae.addBinaryExpr(BinOp.Colon, litExprIds[0]!, litExprIds[litExprIds.length - 1]!);
          } else {
            rangeExprId = dae.addArrayCtorExpr(litExprIds);
          }
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

    // `while` statement: emits `StmtKind.While` with condition expression ID and body statement count,
    // followed immediately in the statement arena by its lowered body statements.
    if (Cst.WhileStatement.is(sNode) || sNode.type === "while_statement") {
      const cond =
        Cst.WhileStatement.condition(sNode) ?? (sNode.children || []).find((c: SyntaxNode) => c.type === "expression");
      const condId = cond ? flattener.lowerExpr(cond, dae, prefix, substitutions) : -1;
      const bodyStmts: SyntaxNode[] = [];
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
      const sId = dae.addStatement(StmtKind.While, condId, bodyStmts.length);
      state.stmtRanges.set(sId, {
        startOffset: sNode.startIndex ?? sNode.startOffset,
        endOffset: sNode.endIndex ?? sNode.endOffset,
        startPosition: sNode.startPosition,
        endPosition: sNode.endPosition,
      });
      for (const s of bodyStmts) {
        lowerStatement(s);
      }
      return;
    }

    // `if` statement: collects `then`, `elseif`, and `else` branches, prunes branches
    // whose conditions fold to `ExprKind.BoolLiteral`, and emits `StmtKind.If` followed
    // by `StmtKind.Block` headers for any remaining `elseif`/`else` clauses.
    if (Cst.IfStatement.is(sNode) || sNode.type === "if_statement") {
      const cond =
        Cst.IfStatement.condition(sNode) ?? (sNode.children || []).find((c: SyntaxNode) => c.type === "expression");
      const condId = cond ? flattener.lowerExpr(cond, dae, prefix, substitutions) : -1;

      let inThen = false;
      let inElseIf = false;
      let inElseIfThen = false;
      let inElse = false;
      const thenStmts: SyntaxNode[] = [];
      const branches: { condNode: SyntaxNode | null; stmts: SyntaxNode[] }[] = [];
      let currBranch: { condNode: SyntaxNode | null; stmts: SyntaxNode[] } | null = null;

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
      const allBranches: { condNode: SyntaxNode | null; condId: number; stmts: SyntaxNode[]; condVal?: unknown }[] = [
        {
          condNode: cond ?? null,
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

      // Skip leading branches whose conditions are statically false.
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

      const activeBranches: { condId: number; stmts: SyntaxNode[] }[] = [];
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

    // Scalar/array/tuple assignment statement (`lhs := rhs`):
    // Validates LHS mutability, array rank/dimension compatibility, and type conversions
    // before emitting `StmtKind.Assignment`.
    if (sNode.type === "assignment_statement") {
      const exprs = (sNode.children || []).filter(
        (c: SyntaxNode) => c.type === "expression" || c.type === "component_reference",
      );
      if (exprs.length >= 2) {
        const targetText = exprs[0]!.text?.trim() ?? "";
        const cleanTargetText = targetText.split("[")[0]?.trim() ?? targetText;

        // 1. Check assignment to iterator
        if (flattener.activeLoopVars.has(cleanTargetText)) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.ASSIGNMENT_TO_ITERATOR.code,
            message: ModelicaErrorCode.ASSIGNMENT_TO_ITERATOR.message(cleanTargetText),
            range: {
              startOffset: sNode.startIndex ?? sNode.startOffset,
              endOffset: sNode.endIndex ?? sNode.endOffset,
              startPosition: sNode.startPosition,
              endPosition: sNode.endPosition,
            },
          });
          return;
        }

        // 2. Check assignment to non-assignable class specialization (model, package, block)
        let targetCompSym: SymbolEntry | null = null;
        if (!stripArraySubscripts(targetText).includes(".")) {
          if (flattener.currentClassId) {
            const children = db.childrenOf(flattener.currentClassId);
            targetCompSym = children.find((c) => c.kind === "Component" && c.name === cleanTargetText) ?? null;
          }
          if (!targetCompSym) {
            targetCompSym = db.byName(cleanTargetText).find((s) => s.kind === "Component") ?? null;
          }
        }
        if (targetCompSym) {
          let typeName = db.query<string | null>("typeSpecifier", targetCompSym.id);
          if (!typeName) typeName = (targetCompSym.metadata as SymbolMetaLike | undefined)?.typeSpecifier ?? null;
          let classSym: SymbolEntry | null = null;
          const typeClassId = db.query<SymbolId | null>("classInstance", targetCompSym.id);
          if (typeClassId) classSym = db.symbol(typeClassId) ?? null;
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
              entries?.find((e: SymbolEntry) => e.kind === "Package" || e.kind === "Class" || e.kind === "Function") ??
              null;
          }
          if (classSym) {
            const classMeta = classSym.metadata as SymbolMetaLike | undefined;
            const rawKind = String(
              classMeta?.classKind ?? classMeta?.classPrefixes ?? classSym.kind ?? "",
            ).toLowerCase();
            const words = tokenizeCommentStrippedWords(rawKind);
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
                  startOffset: sNode.startIndex ?? sNode.startOffset,
                  endOffset: sNode.endIndex ?? sNode.endOffset,
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

        // 3. Check assignment to constant or parameter, and propagate deduced array shapes
        // from the RHS expression onto dynamically sized output variables.
        const printer = new ArenaDAEPrinter({ write: () => {} }, dae, true);
        const targetStr = printer.printExprToString(targetId);
        let valStr = printer.printExprToString(valId);

        let vIdx = dae.getVarIdxByName(targetStr);
        if (vIdx < 0 && cleanTargetText) vIdx = dae.getVarIdxByName(cleanTargetText);
        if (vIdx < 0 && cleanTargetText && prefix) vIdx = dae.getVarIdxByName(`${prefix}.${cleanTargetText}`);
        if (vIdx >= 0 && state.lastLoweredShape) {
          const existingShape = dae.getVarShape(vIdx);
          const hasConcreteExisting =
            existingShape && existingShape.length > 0 && existingShape.every((d: number) => d > 0);
          const deducedShape = state.lastLoweredShape;
          if (
            !hasConcreteExisting &&
            deducedShape &&
            deducedShape.length > 0 &&
            deducedShape.every((d: number) => d > 0)
          ) {
            state.deducedOutputShapes.set(dae.getVarName(vIdx), deducedShape);
            if (cleanTargetText !== dae.getVarName(vIdx)) {
              state.deducedOutputShapes.set(cleanTargetText, deducedShape);
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
            if (dae.getVarType(vIdx) === VarType.Real && isSignedAsciiIntText(valStr)) {
              valStr = `${valStr}.0`;
            }
            if (variability === Variability.Constant) {
              const msg = dae.extensionMetadata?.["isOldFrontend"]
                ? `Trying to assign to constant component ${displayTarget}.`
                : ModelicaErrorCode.ASSIGNMENT_TO_CONSTANT.message(displayTarget, valStr);
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.ASSIGNMENT_TO_CONSTANT.code,
                message: msg,
                range: {
                  startOffset: sNode.startIndex ?? sNode.startOffset,
                  endOffset: sNode.endIndex ?? sNode.endOffset,
                  startPosition: sNode.startPosition,
                  endPosition: sNode.endPosition,
                },
              });
              return;
            }
            if (variability === Variability.Parameter) {
              const isFixed = dae.getVarAttr(vIdx, "fixed");
              const isExplicitFalse =
                isFixed !== undefined &&
                isFixed >= 0 &&
                dae.getExprKind(isFixed) === ExprKind.BoolLiteral &&
                dae.getExprData1(isFixed) === 0;
              if (!(isInitial || isInitAlg) || !isExplicitFalse) {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.ASSIGNMENT_TO_PARAMETER.code,
                  message: ModelicaErrorCode.ASSIGNMENT_TO_PARAMETER.message(displayTarget, valStr),
                  range: {
                    startOffset: sNode.startIndex ?? sNode.startOffset,
                    endOffset: sNode.endIndex ?? sNode.endOffset,
                    startPosition: sNode.startPosition,
                    endPosition: sNode.endPosition,
                  },
                });
                return;
              }
            }
          }
        }

        // 4. Verify array dimension compatibility between target and value expressions.
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
          const startB = sNode.startIndex ?? sNode.startOffset;
          const endB = sNode.endIndex ?? sNode.endOffset;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.code,
            message: `Type mismatch in assignment in ${targetStr} := ${valStr} of ${tTypeName}[${targetDims.join(", ")}] := ${vTypeName}[${valDims.join(", ")}]`,
            range: {
              startOffset: startB,
              endOffset: endB,
              startPosition: sNode.startPosition,
              endPosition: sNode.endPosition,
            },
          });
          return;
        }

        // 5. Apply Real promotion, Enumeration integer-index coercion, and type checks.
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
                    : ((lit as { stringValue?: string; name?: string }).stringValue ??
                      (lit as { stringValue?: string; name?: string }).name ??
                      String(lit));
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
          const startB = sNode.startIndex ?? sNode.startOffset;
          const endB = sNode.endIndex ?? sNode.endOffset;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.ASSIGNMENT_TYPE_MISMATCH.code,
            message: `Type mismatch in assignment in ${targetStr} := ${valStr} of Integer := Real`,
            range: {
              startOffset: startB,
              endOffset: endB,
              startPosition: sNode.startPosition,
              endPosition: sNode.endPosition,
            },
          });
          return;
        }
        // When assigning a multi-output function call to a single scalar LHS, bind to output #1 (`call[1]`).
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
        if (dae.getExprKind(targetId) === ExprKind.Tuple && dae.getExprKind(valId) === ExprKind.Tuple) {
          const targetElems = getArrayCtorElements(targetId, dae);
          const valElems = getArrayCtorElements(valId, dae);
          if (targetElems.length === valElems.length) {
            for (let i = 0; i < targetElems.length; i++) {
              if (targetElems[i]! >= 0) {
                dae.addStatement(StmtKind.Assignment, targetElems[i]!, valElems[i]!);
              }
            }
            return;
          }
        }
        dae.addStatement(StmtKind.Assignment, targetId, valId);
      }
      return;
    }

    // `when` statement in algorithms: validates discrete-time Boolean conditions
    // (rejecting `noEvent(...)` and `Clock(...)`) and enforces that every `elsewhen`
    // branch assigns to the exact same set of target variables as the primary `when` branch.
    if (Cst.WhenStatement.is(sNode) || sNode.type === "when_statement") {
      const cond =
        Cst.WhenStatement.condition(sNode) ?? (sNode.children || []).find((c: SyntaxNode) => c.type === "expression");
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
      const thenStmts: SyntaxNode[] = [];
      const elseWhenList: { condNode: SyntaxNode | null; stmts: SyntaxNode[] }[] = [];
      let currEw: { condNode: SyntaxNode | null; stmts: SyntaxNode[] } | null = null;

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
          thenStmts.some((s: SyntaxNode) => s.type === "when_statement" || s.type === "when_equation") ||
          elseWhenList.some((ew) =>
            ew.stmts?.some((s: SyntaxNode) => s.type === "when_statement" || s.type === "when_equation"),
          );
        if (hasNestedWhen) {
          return;
        }
        const getTarget = (s: SyntaxNode): string | null => {
          if (s.type === "assignment_statement") {
            const tgt = (s.children || []).find((k: SyntaxNode) => k.type === "component_reference");
            if (tgt) return stripAsciiWhitespace(tgt.text);
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
  state.inAlgorithmSection = Boolean(prevInAlg);
  return;
}
