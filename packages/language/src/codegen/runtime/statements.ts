// SPDX-License-Identifier: AGPL-3.0-or-later

import { DaeBuilder, StmtKind, EXPR_STRIDE, EXPR_DATA1, STMT_STRIDE, STMT_KIND, STMT_DATA1, STMT_LEFT, STMT_RIGHT } from "./dae";
import { evalExpr } from "./eval";

export const SIGNAL_NONE: u32 = 0;
export const SIGNAL_BREAK: u32 = 1;
export const SIGNAL_RETURN: u32 = 2;

const MAX_WHILE_ITERATIONS: u32 = 100000;
const MAX_FOR_ITERATIONS: u32 = 1000000;

/**
 * Executes a sequence of statements in linear memory starting at startStmtIdx.
 * Returns signal status (SIGNAL_NONE, SIGNAL_BREAK, SIGNAL_RETURN).
 */
export function executeStatements(
  startStmtIdx: u32,
  stmtCount: u32,
  dae: DaeBuilder,
  varValuesPtr: usize,
): u32 {
  if (stmtCount == 0 || startStmtIdx >= dae.stmtCount) return SIGNAL_NONE;

  let stmtData = dae.getStmtData();
  let exprData = dae.getExprData();
  let i = startStmtIdx;
  let endIdx = startStmtIdx + stmtCount;

  while (i < endIdx) {
    let offset = i * STMT_STRIDE;
    let kind = stmtData.get(offset + STMT_KIND);
    let data1 = stmtData.get(offset + STMT_DATA1);
    let left = stmtData.get(offset + STMT_LEFT);
    let right = stmtData.get(offset + STMT_RIGHT);

    let nextIdx = i + 1;

    if (kind == StmtKind.Assignment) {
      let targetExprId = data1 as u32;
      let sourceExprId = left as u32;
      let val = evalExpr(sourceExprId, dae, varValuesPtr);

      // Target expression
      let targetOffset = targetExprId * EXPR_STRIDE;
      let varId = exprData.get(targetOffset + EXPR_DATA1) as u32;
      if (varId != 0xffffffff && varId < dae.varCount) {
        store<f64>(varValuesPtr + (varId as usize) * 8, val);
      }
    } else if (kind == StmtKind.If) {
      let condExprId = data1 as u32;
      let thenStmtCount = left as u32;

      let condVal = evalExpr(condExprId, dae, varValuesPtr);
      nextIdx = i + 1 + thenStmtCount;

      if (condVal != 0.0) {
        let sig = executeStatements(i + 1, thenStmtCount, dae, varValuesPtr);
        if (sig != SIGNAL_NONE) return sig;
      }
    } else if (kind == StmtKind.While) {
      let condExprId = data1 as u32;
      let bodyStmtCount = left as u32;
      nextIdx = i + 1 + bodyStmtCount;

      let iter: u32 = 0;
      while (evalExpr(condExprId, dae, varValuesPtr) != 0.0 && iter < MAX_WHILE_ITERATIONS) {
        let sig = executeStatements(i + 1, bodyStmtCount, dae, varValuesPtr);
        if (sig == SIGNAL_BREAK) break;
        if (sig == SIGNAL_RETURN) return SIGNAL_RETURN;
        iter++;
      }
    } else if (kind == StmtKind.For) {
      let varId = data1 as u32;
      let rangeExprId = left as u32;
      let bodyStmtCount = right as u32;
      nextIdx = i + 1 + bodyStmtCount;

      let rangeOffset = rangeExprId * EXPR_STRIDE;
      let startVal: i32 = 1;
      let endVal: i32 = 10;
      if (rangeExprId != 0xffffffff && rangeExprId < dae.exprCount) {
        let endExprId = exprData.get(rangeOffset + EXPR_DATA1) as u32;
        endVal = evalExpr(endExprId, dae, varValuesPtr) as i32;
      }

      let count: u32 = 0;
      for (let v = startVal; v <= endVal && count < MAX_FOR_ITERATIONS; v++) {
        if (varId != 0xffffffff && varId < dae.varCount) {
          store<f64>(varValuesPtr + (varId as usize) * 8, v as f64);
        }
        let sig = executeStatements(i + 1, bodyStmtCount, dae, varValuesPtr);
        if (sig == SIGNAL_BREAK) break;
        if (sig == SIGNAL_RETURN) return SIGNAL_RETURN;
        count++;
      }
    } else if (kind == StmtKind.Break) {
      return SIGNAL_BREAK;
    } else if (kind == StmtKind.Return) {
      return SIGNAL_RETURN;
    }

    i = nextIdx;
  }

  return SIGNAL_NONE;
}

export function dae_executeStatements(
  daePtr: u32,
  startStmtIdx: u32,
  stmtCount: u32,
  varValuesPtr: usize,
): u32 {
  return executeStatements(startStmtIdx, stmtCount, changetype<DaeBuilder>(daePtr), varValuesPtr);
}
