// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DaeBuilder,
  StmtKind,
  ExprKind,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  EXPR_LEFT,
  EXPR_RIGHT,
  STMT_STRIDE,
  STMT_KIND,
  STMT_DATA1,
  STMT_LEFT,
  STMT_RIGHT,
} from "./builder";
import { evalExpr } from "./eval";
import { UnmanagedFloat64Array } from "../core/array";

export const SIGNAL_NONE: u32 = 0;
export const SIGNAL_BREAK: u32 = 1;
export const SIGNAL_RETURN: u32 = 2;

const MAX_WHILE_ITERATIONS: u32 = 100000;
const MAX_FOR_ITERATIONS: u32 = 1000000;

@inline
function resolveVarSlot(dae: DaeBuilder, idOrName: u32): i32 {
  if (idOrName == 0xffffffff) return -1;
  if (idOrName < dae.varCount) return idOrName as i32;
  return dae.lookupVariableByName(idOrName);
}

@inline
function countNestedStmts(stmtData: any, startIdx: u32, topCount: u32, totalStmts: u32): u32 {
  let curr = startIdx;
  let remaining = topCount;
  while (remaining > 0 && curr < totalStmts) {
    let off = curr * STMT_STRIDE;
    let k = stmtData.get(off + STMT_KIND);
    let d1 = stmtData.get(off + STMT_DATA1) as u32;
    let l = stmtData.get(off + STMT_LEFT) as u32;
    let r = stmtData.get(off + STMT_RIGHT) as u32;
    curr++;
    remaining--;
    if (k == StmtKind.If) {
      remaining += l;
      // Also account for `r` Block branches if encoded via StmtKind.Block headers
      for (let b: u32 = 0; b < r && curr < totalStmts; b++) {
        let bOff = curr * STMT_STRIDE;
        if (stmtData.get(bOff + STMT_KIND) == StmtKind.Block) {
          let bLen = stmtData.get(bOff + STMT_LEFT) as u32;
          curr = countNestedStmts(stmtData, curr + 1, bLen, totalStmts);
        } else {
          remaining += 1;
        }
      }
    } else if (k == StmtKind.While) {
      remaining += l;
    } else if (k == StmtKind.For) {
      remaining += r;
    } else if (k == StmtKind.When) {
      remaining += l;
    } else if (k == StmtKind.ComplexAssignment) {
      remaining += d1;
    }
  }
  return curr;
}

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
  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr);
  let i = startStmtIdx;
  let executedTopLevel: u32 = 0;

  while (executedTopLevel < stmtCount && i < dae.stmtCount) {
    let offset = i * STMT_STRIDE;
    let kind = stmtData.get(offset + STMT_KIND);
    let data1 = stmtData.get(offset + STMT_DATA1);
    let left = stmtData.get(offset + STMT_LEFT);
    let right = stmtData.get(offset + STMT_RIGHT);

    let nextIdx = i + 1;
    executedTopLevel++;

    if (kind == StmtKind.Assignment) {
      let targetExprId = data1 as u32;
      let sourceExprId = left as u32;
      let val = evalExpr(sourceExprId, dae, varValuesPtr);

      if (targetExprId < dae.exprCount) {
        let targetOffset = targetExprId * EXPR_STRIDE;
        let rawVarId = exprData.get(targetOffset + EXPR_DATA1) as u32;
        let slot = resolveVarSlot(dae, rawVarId);
        if (slot >= 0) {
          varValues[slot] = val;
        }
      }
    } else if (kind == StmtKind.If) {
      let condExprId = data1 as u32;
      let thenStmtCount = left as u32;
      let rightCount = right as u32;

      let condVal = evalExpr(condExprId, dae, varValuesPtr);
      let branchexecuted = false;
      let thenEnd = countNestedStmts(stmtData, i + 1, thenStmtCount, dae.stmtCount);

      if (condVal != 0.0) {
        branchexecuted = true;
        let sig = executeStatements(i + 1, thenStmtCount, dae, varValuesPtr);
        if (sig != SIGNAL_NONE) return sig;
      }

      let curBranchIdx = thenEnd;
      if (rightCount > 0 && curBranchIdx < dae.stmtCount) {
        let firstBranchKind = stmtData.get(curBranchIdx * STMT_STRIDE + STMT_KIND);
        if (firstBranchKind == StmtKind.Block) {
          for (let b: u32 = 0; b < rightCount && curBranchIdx < dae.stmtCount; b++) {
            let bOff = curBranchIdx * STMT_STRIDE;
            let bCond = stmtData.get(bOff + STMT_DATA1) as u32;
            let bStmtCount = stmtData.get(bOff + STMT_LEFT) as u32;
            let bEnd = countNestedStmts(stmtData, curBranchIdx + 1, bStmtCount, dae.stmtCount);
            if (!branchexecuted) {
              if (bCond == 0xffffffff || evalExpr(bCond, dae, varValuesPtr) != 0.0) {
                branchexecuted = true;
                let sig = executeStatements(curBranchIdx + 1, bStmtCount, dae, varValuesPtr);
                if (sig != SIGNAL_NONE) return sig;
              }
            }
            curBranchIdx = bEnd;
          }
        } else {
          // Flat else statement count stored in `right`
          let elseEnd = countNestedStmts(stmtData, curBranchIdx, rightCount, dae.stmtCount);
          if (!branchexecuted) {
            let sig = executeStatements(curBranchIdx, rightCount, dae, varValuesPtr);
            if (sig != SIGNAL_NONE) return sig;
          }
          curBranchIdx = elseEnd;
        }
      }
      nextIdx = curBranchIdx;
    } else if (kind == StmtKind.While) {
      let condExprId = data1 as u32;
      let bodyStmtCount = left as u32;
      nextIdx = countNestedStmts(stmtData, i + 1, bodyStmtCount, dae.stmtCount);

      let iter: u32 = 0;
      while (evalExpr(condExprId, dae, varValuesPtr) != 0.0 && iter < MAX_WHILE_ITERATIONS) {
        let sig = executeStatements(i + 1, bodyStmtCount, dae, varValuesPtr);
        if (sig == SIGNAL_BREAK) break;
        if (sig == SIGNAL_RETURN) return SIGNAL_RETURN;
        iter++;
      }
    } else if (kind == StmtKind.For) {
      let rawVarId = data1 as u32;
      let varSlot = resolveVarSlot(dae, rawVarId);
      let rangeExprId = left as u32;
      let bodyStmtCount = right as u32;
      nextIdx = countNestedStmts(stmtData, i + 1, bodyStmtCount, dae.stmtCount);

      let startVal: i32 = 1;
      let stepVal: i32 = 1;
      let endVal: i32 = 10;
      if (rangeExprId != 0xffffffff && rangeExprId < dae.exprCount) {
        let rangeOffset = rangeExprId * EXPR_STRIDE;
        let rangeKind = exprData.get(rangeOffset + EXPR_KIND);
        let rData1 = exprData.get(rangeOffset + EXPR_DATA1) as u32;
        let rLeft = exprData.get(rangeOffset + EXPR_LEFT) as u32;
        let rRight = exprData.get(rangeOffset + EXPR_RIGHT) as u32;
        if (rangeKind == ExprKind.Range) {
          if (rRight != 0xffffffff && rRight < dae.exprCount) {
            startVal = evalExpr(rData1, dae, varValuesPtr) as i32;
            if (rLeft != 0xffffffff && rLeft < dae.exprCount) {
              stepVal = evalExpr(rLeft, dae, varValuesPtr) as i32;
            }
            endVal = evalExpr(rRight, dae, varValuesPtr) as i32;
          } else {
            // Legacy 1-operand Range where data1 is endExprId
            endVal = evalExpr(rData1, dae, varValuesPtr) as i32;
          }
        } else {
          endVal = evalExpr(rangeExprId, dae, varValuesPtr) as i32;
        }
      }

      if (stepVal != 0) {
        let count: u32 = 0;
        let v = startVal;
        while ((stepVal > 0 ? v <= endVal : v >= endVal) && count < MAX_FOR_ITERATIONS) {
          if (varSlot >= 0) {
            varValues[varSlot] = v as f64;
          }
          let sig = executeStatements(i + 1, bodyStmtCount, dae, varValuesPtr);
          if (sig == SIGNAL_BREAK) break;
          if (sig == SIGNAL_RETURN) return SIGNAL_RETURN;
          v += stepVal;
          count++;
        }
      }
    } else if (kind == StmtKind.When) {
      let bodyStmtCount = left as u32;
      let elseWhenCount = right as u32;
      let curIdx = countNestedStmts(stmtData, i + 1, bodyStmtCount, dae.stmtCount);
      for (let b: u32 = 0; b < elseWhenCount && curIdx < dae.stmtCount; b++) {
        let bOff = curIdx * STMT_STRIDE;
        let bCount = stmtData.get(bOff + STMT_LEFT) as u32;
        curIdx = countNestedStmts(stmtData, curIdx + 1, bCount, dae.stmtCount);
      }
      nextIdx = curIdx;
    } else if (kind == StmtKind.ComplexAssignment) {
      let numTargets = data1 as u32;
      nextIdx = i + 1 + numTargets;
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
