// SPDX-License-Identifier: AGPL-3.0-or-later

// AssemblyScript implementation of WebAssembly Solvers, DAE Builder & BLT
export { atomicChunkAlloc, atomicChunkFree } from "../src/wasm/core/array";
export * from "../src/wasm/dae/alias";
export * from "../src/wasm/autodiff/affine";
export * from "../src/wasm/solvers/bdf";
export * from "../src/wasm/optimization/branch_and_bound";
export * from "../src/wasm/autodiff/coloring";
export * from "../src/wasm/cse";
export * from "../src/wasm/dae/types";
export * from "../src/wasm/dae/accessors";
export * from "../src/wasm/dae/builder";
export * from "../src/wasm/simulation/delay";
export * from "../src/wasm/simulation/doe";
export * from "../src/wasm/simulation/events";
export * from "../src/wasm/simulation/homotopy";
export * from "../src/wasm/dae/fold";
export * from "../src/wasm/gpu/gpu_buffers";
export * from "../src/wasm/solvers/groebner";
export * from "../src/wasm/solvers/integrators";
export * from "../src/wasm/solvers/matrix";
export * from "../src/wasm/solvers/rodas4p";
export * from "../src/wasm/solvers/symplectic";
export * from "../src/wasm/autodiff/interval";
export * from "../src/wasm/autodiff/mccormick";
export * from "../src/wasm/simulation/monte_carlo";
export * from "../src/wasm/structural/pantelides";
export * from "../src/wasm/dae/scalarize";
export * from "../src/wasm/solvers/sparse_cholesky";
export * from "../src/wasm/solvers/sparse_lu";
export * from "../src/wasm/core/string_pool";
export * from "../src/wasm/autodiff/tape";
export * from "../src/wasm/structural/tearing";
export * from "../src/wasm/ontology_module/ontology";
export * from "../src/wasm/storage/paged_btree";
export * from "../src/wasm/formal/stl_monitor";
export * from "../src/wasm/formal/octagon";
export * from "../src/wasm/dae/interval_eval";
export * from "../src/wasm/formal/sat";
export * from "../src/wasm/formal/simplex";
export * from "../src/wasm/formal/sturm";
export * from "../src/wasm/formal/zonotope";
export * from "../src/wasm/solvers/wasm_emt";
export * from "../src/wasm/structural/emt_partitioner";
export {
  cas_getRealValue,
  cas_isZero,
  cas_isOne,
  cas_isConstant,
  cas_simplify,
  cas_differentiate,
  cas_export_simplify,
  cas_export_differentiate,
} from "../src/wasm/dae/cas";
export * from "../src/wasm/dae/eval";
export * from "../src/wasm/dae/statements";
export * from "../src/wasm/dae/builtins_math";
export {
  dae_evalDualExpr,
  dae_evalDualEquationResidual,
  dae_evalDualJacobianColumn,
} from "../src/wasm/autodiff/dual";
export * from "../src/wasm/fmi/fmi2_wasm";
export * from "../src/wasm/fmi/fmi3_wasm";
export * from "../src/wasm/fmi/cosim";
export * from "../src/wasm/indexing/correspondence";
export * from "../src/wasm/simulation/verifier";
export * from "../src/wasm/simulation/vmap";
export * from "../src/wasm/solvers/integrate";
export * from "../src/wasm/solvers/linalg";
export * from "../src/wasm/structural/blt";
export {
  isTargetVar,
  countVarOccurrences,
  isExplicitlySolvable,
  invertSingleOccurrence,
  isolateSymbolically,
  dae_isolateEquation,
  inverseSinh,
  inverseCosh,
  inverseTanh,
  lambertW0,
  initWarmStartCache,
  getWarmStartValue,
  setWarmStartValue,
  solve1x1Newton,
  solveHomotopy,
} from "../src/wasm/optimization/isolation";
export * from "../src/wasm/fea/wasm_fea";
export * from "../src/wasm/cad/wasm_bsp_bvh";
export * from "../src/wasm/diagram/wasm_layout";
export * from "../src/wasm/solvers/wasm_advanced_solvers";
export * from "./flattener";


import {
  BinOp,
  EQ_KIND,
  EQ_LHS,
  EQ_RHS,
  EQ_STRIDE,
  EqKind,
  ExprKind,
  VAR_STRIDE,
  VAR_VARIABILITY,
  VarAttrKind,
  Variability,
} from "../src/wasm/dae/types";
import { DaeBuilder } from "../src/wasm/dae/builder";

function dfsCsr(
  start_e: i32,
  iter: i32,
  visitedPtr: usize,
  csrRowPtr: usize,
  csrColsPtr: usize,
  matchPtr: usize,
  eStackPtr: usize,
  idxStackPtr: usize,
  vStackPtr: usize,
): bool {
  store<i32>(eStackPtr, start_e);
  store<i32>(idxStackPtr, load<i32>(csrRowPtr + ((start_e as usize) << 2)));
  store<i32>(vStackPtr, -1);
  let stackLen: i32 = 1;
  let childReturnedTrue: bool = false;

  while (stackLen > 0) {
    let topOffset = ((stackLen - 1) as usize) << 2;
    let e = load<i32>(eStackPtr + topOffset);
    let idx = load<i32>(idxStackPtr + topOffset);
    let v = load<i32>(vStackPtr + topOffset);

    if (childReturnedTrue) {
      store<i32>(matchPtr + ((v as usize) << 2), e);
      stackLen--;
      childReturnedTrue = true;
      continue;
    }

    let endIdx = load<i32>(csrRowPtr + (((e + 1) as usize) << 2));
    let advanced: bool = false;

    while (idx < endIdx) {
      let nextV = load<i32>(csrColsPtr + ((idx as usize) << 2));
      idx++;

      let nextVOffset = (nextV as usize) << 2;
      if (load<i32>(visitedPtr + nextVOffset) != iter) {
        store<i32>(visitedPtr + nextVOffset, iter);
        let matchedEq = load<i32>(matchPtr + nextVOffset);
        if (matchedEq == -1) {
          store<i32>(matchPtr + nextVOffset, e);
          stackLen--;
          childReturnedTrue = true;
          advanced = true;
          break;
        } else {
          store<i32>(idxStackPtr + topOffset, idx);
          store<i32>(vStackPtr + topOffset, nextV);

          let pushOffset = (stackLen as usize) << 2;
          store<i32>(eStackPtr + pushOffset, matchedEq);
          store<i32>(idxStackPtr + pushOffset, load<i32>(csrRowPtr + ((matchedEq as usize) << 2)));
          store<i32>(vStackPtr + pushOffset, -1);
          stackLen++;
          advanced = true;
          break;
        }
      }
    }

    if (!advanced && !childReturnedTrue) {
      stackLen--;
      childReturnedTrue = false;
    }
  }

  return childReturnedTrue;
}

function solveBltCsrCore(
  numUnknowns: i32,
  numEquations: i32,
  csrRowPtr: usize,
  csrColsPtr: usize,
  allUnknownsPtr: usize,
  allUnknownsLen: i32,
  activeToEqPtr: usize,
  activeToVarPtr: usize,
  outEqsPtr: usize,
  outBlocksPtr: usize,
  outBlocksWordsWrittenPtr: usize,
): i32 {
  if (numUnknowns <= 0 || numEquations <= 0) {
    store<i32>(outBlocksPtr, 0);
    if (outBlocksWordsWrittenPtr != 0) store<i32>(outBlocksWordsWrittenPtr, 1);
    return 0;
  }

  let matchBytes = (numUnknowns as usize) << 2;
  let eqStackBytes = ((numEquations + 2) as usize) << 2;
  let varStackBytes = ((numUnknowns + 2) as usize) << 2;

  let matchPtr = heap.alloc(matchBytes);
  let assignedEqsPtr = heap.alloc(numEquations as usize);
  let visitedPtr = heap.alloc(matchBytes);
  let eStackPtr = heap.alloc(eqStackBytes);
  let idxStackPtr = heap.alloc(eqStackBytes);
  let vStackPtr = heap.alloc(eqStackBytes);

  memory.fill(matchPtr, 0xff, matchBytes);
  memory.fill(assignedEqsPtr, 0, numEquations as usize);
  memory.fill(visitedPtr, 0xff, matchBytes);

  // 1. Duff's O(E) cheap greedy matching pass
  for (let i: i32 = 0; i < numEquations; i++) {
    let start = load<i32>(csrRowPtr + ((i as usize) << 2));
    let end = load<i32>(csrRowPtr + (((i + 1) as usize) << 2));
    for (let j: i32 = start; j < end; j++) {
      let v = load<i32>(csrColsPtr + ((j as usize) << 2));
      if (v >= 0 && v < numUnknowns) {
        let vOffset = (v as usize) << 2;
        if (load<i32>(matchPtr + vOffset) == -1) {
          store<i32>(matchPtr + vOffset, i);
          store<u8>(assignedEqsPtr + (i as usize), 1);
          break;
        }
      }
    }
  }

  // 2. Augmenting path DFS only for residual unmatched equations
  for (let i: i32 = 0; i < numEquations; i++) {
    if (load<u8>(assignedEqsPtr + (i as usize)) == 0) {
      if (dfsCsr(i, i, visitedPtr, csrRowPtr, csrColsPtr, matchPtr, eStackPtr, idxStackPtr, vStackPtr)) {
        store<u8>(assignedEqsPtr + (i as usize), 1);
      }
    }
  }

  heap.free(eStackPtr);
  heap.free(idxStackPtr);
  heap.free(vStackPtr);
  heap.free(visitedPtr);

  // 3. Iterative Tarjan's SCC streaming directly to outEqsPtr & outBlocksPtr
  let indexArrPtr = heap.alloc(matchBytes);
  let lowlinkArrPtr = heap.alloc(matchBytes);
  let onStackArrPtr = heap.alloc(numUnknowns as usize);
  let tarjanStackPtr = heap.alloc(varStackBytes);
  let callStackVPtr = heap.alloc(varStackBytes);
  let callStackIdxPtr = heap.alloc(varStackBytes);
  let sccTempPtr = heap.alloc(varStackBytes);

  memory.fill(indexArrPtr, 0xff, matchBytes);
  memory.fill(lowlinkArrPtr, 0xff, matchBytes);
  memory.fill(onStackArrPtr, 0, numUnknowns as usize);

  let indexCounter: i32 = 0;
  let tarjanStackLen: i32 = 0;
  let eqsOffset: usize = outEqsPtr;
  let blocksOffset: usize = outBlocksPtr + 4;
  let numBlocks: i32 = 0;

  for (let i: i32 = 0; i < allUnknownsLen; i++) {
    let start_v = load<i32>(allUnknownsPtr + ((i as usize) << 2));
    if (load<i32>(indexArrPtr + ((start_v as usize) << 2)) != -1) continue;

    store<i32>(callStackVPtr, start_v);
    let m0 = load<i32>(matchPtr + ((start_v as usize) << 2));
    store<i32>(callStackIdxPtr, m0 != -1 ? load<i32>(csrRowPtr + ((m0 as usize) << 2)) : 0);
    let callStackLen: i32 = 1;

    store<i32>(indexArrPtr + ((start_v as usize) << 2), indexCounter);
    store<i32>(lowlinkArrPtr + ((start_v as usize) << 2), indexCounter);
    indexCounter++;
    store<i32>(tarjanStackPtr + ((tarjanStackLen as usize) << 2), start_v);
    tarjanStackLen++;
    store<u8>(onStackArrPtr + (start_v as usize), 1);

    while (callStackLen > 0) {
      let topOffset = ((callStackLen - 1) as usize) << 2;
      let v = load<i32>(callStackVPtr + topOffset);
      let idx = load<i32>(callStackIdxPtr + topOffset);
      let eqIdx = load<i32>(matchPtr + ((v as usize) << 2));

      let advanced: bool = false;
      if (eqIdx != -1) {
        let endIdx = load<i32>(csrRowPtr + (((eqIdx + 1) as usize) << 2));
        while (idx < endIdx) {
          let w = load<i32>(csrColsPtr + ((idx as usize) << 2));
          idx++;
          if (w == v) continue;

          let wOffset = (w as usize) << 2;
          let wIndex = load<i32>(indexArrPtr + wOffset);
          if (wIndex == -1) {
            store<i32>(callStackIdxPtr + topOffset, idx);

            store<i32>(indexArrPtr + wOffset, indexCounter);
            store<i32>(lowlinkArrPtr + wOffset, indexCounter);
            indexCounter++;
            store<i32>(tarjanStackPtr + ((tarjanStackLen as usize) << 2), w);
            tarjanStackLen++;
            store<u8>(onStackArrPtr + (w as usize), 1);

            let pushOffset = (callStackLen as usize) << 2;
            store<i32>(callStackVPtr + pushOffset, w);
            let mw = load<i32>(matchPtr + wOffset);
            store<i32>(callStackIdxPtr + pushOffset, mw != -1 ? load<i32>(csrRowPtr + ((mw as usize) << 2)) : 0);
            callStackLen++;
            advanced = true;
            break;
          } else if (load<u8>(onStackArrPtr + (w as usize)) == 1) {
            let vOffset = (v as usize) << 2;
            let vLow = load<i32>(lowlinkArrPtr + vOffset);
            if (wIndex < vLow) {
              store<i32>(lowlinkArrPtr + vOffset, wIndex);
            }
          }
        }
      }

      if (advanced) continue;

      callStackLen--;
      let vOffset = (v as usize) << 2;
      let vLow = load<i32>(lowlinkArrPtr + vOffset);

      if (callStackLen > 0) {
        let parent_v = load<i32>(callStackVPtr + (((callStackLen - 1) as usize) << 2));
        let pOffset = (parent_v as usize) << 2;
        let pLow = load<i32>(lowlinkArrPtr + pOffset);
        if (vLow < pLow) {
          store<i32>(lowlinkArrPtr + pOffset, vLow);
        }
      }

      if (vLow == load<i32>(indexArrPtr + vOffset)) {
        let sccLen: i32 = 0;
        let sccEqCount: i32 = 0;
        while (tarjanStackLen > 0) {
          tarjanStackLen--;
          let w = load<i32>(tarjanStackPtr + ((tarjanStackLen as usize) << 2));
          store<u8>(onStackArrPtr + (w as usize), 0);
          store<i32>(sccTempPtr + ((sccLen as usize) << 2), w);
          sccLen++;
          if (load<i32>(matchPtr + ((w as usize) << 2)) != -1) {
            sccEqCount++;
          }
          if (w == v) break;
        }

        store<i32>(blocksOffset, sccEqCount);
        blocksOffset += 4;
        store<i32>(blocksOffset, sccLen);
        blocksOffset += 4;

        for (let j: i32 = 0; j < sccLen; j++) {
          let w = load<i32>(sccTempPtr + ((j as usize) << 2));
          let m = load<i32>(matchPtr + ((w as usize) << 2));
          if (m != -1) {
            let outEq = activeToEqPtr != 0 ? load<i32>(activeToEqPtr + ((m as usize) << 2)) : m;
            store<i32>(eqsOffset, outEq);
            eqsOffset += 4;
            store<i32>(blocksOffset, outEq);
            blocksOffset += 4;
          }
        }
        for (let j: i32 = 0; j < sccLen; j++) {
          let w = load<i32>(sccTempPtr + ((j as usize) << 2));
          let outVar = activeToVarPtr != 0 ? load<i32>(activeToVarPtr + ((w as usize) << 2)) : w;
          store<i32>(blocksOffset, outVar);
          blocksOffset += 4;
        }
        numBlocks++;
      }
    }
  }

  store<i32>(outBlocksPtr, numBlocks);

  // 4. Append unused equations
  for (let i: i32 = 0; i < numEquations; i++) {
    if (load<u8>(assignedEqsPtr + (i as usize)) == 0) {
      let outEq = activeToEqPtr != 0 ? load<i32>(activeToEqPtr + ((i as usize) << 2)) : i;
      store<i32>(eqsOffset, outEq);
      eqsOffset += 4;
    }
  }

  if (outBlocksWordsWrittenPtr != 0) {
    store<i32>(outBlocksWordsWrittenPtr, ((blocksOffset - outBlocksPtr) >> 2) as i32);
  }

  heap.free(indexArrPtr);
  heap.free(lowlinkArrPtr);
  heap.free(onStackArrPtr);
  heap.free(tarjanStackPtr);
  heap.free(callStackVPtr);
  heap.free(callStackIdxPtr);
  heap.free(sccTempPtr);
  heap.free(matchPtr);
  heap.free(assignedEqsPtr);

  return numBlocks;
}

export function computeBlt(
  numUnknowns: i32,
  numEquations: i32,
  adjPtr: usize,
  outEqsPtr: usize,
  outBlocksPtr: usize,
): i32 {
  if (numUnknowns <= 0 || numEquations <= 0) {
    store<i32>(outBlocksPtr, 0);
    return 0;
  }

  // First pass over adjPtr to count total edges
  let offset = adjPtr;
  let totalEdges: i32 = 0;
  for (let i: i32 = 0; i < numEquations; i++) {
    let count = load<i32>(offset);
    offset += 4 + ((count as usize) << 2);
    totalEdges += count;
  }

  let csrRowPtr = heap.alloc(((numEquations + 1) as usize) << 2);
  let csrColsPtr = heap.alloc(((totalEdges > 0 ? totalEdges : 1) as usize) << 2);
  let allUnknownsPtr = heap.alloc((numUnknowns as usize) << 2);
  let isUnknownKnownPtr = heap.alloc(numUnknowns as usize);
  memory.fill(isUnknownKnownPtr, 0, numUnknowns as usize);

  offset = adjPtr;
  let edgeCursor: i32 = 0;
  let allUnknownsLen: i32 = 0;

  for (let i: i32 = 0; i < numEquations; i++) {
    store<i32>(csrRowPtr + ((i as usize) << 2), edgeCursor);
    let count = load<i32>(offset);
    offset += 4;
    for (let j: i32 = 0; j < count; j++) {
      let v = load<i32>(offset);
      offset += 4;
      store<i32>(csrColsPtr + ((edgeCursor as usize) << 2), v);
      edgeCursor++;
      if (v >= 0 && v < numUnknowns && load<u8>(isUnknownKnownPtr + (v as usize)) == 0) {
        store<u8>(isUnknownKnownPtr + (v as usize), 1);
        store<i32>(allUnknownsPtr + ((allUnknownsLen as usize) << 2), v);
        allUnknownsLen++;
      }
    }
  }
  store<i32>(csrRowPtr + ((numEquations as usize) << 2), edgeCursor);
  heap.free(isUnknownKnownPtr);

  let numBlocks = solveBltCsrCore(
    numUnknowns,
    numEquations,
    csrRowPtr,
    csrColsPtr,
    allUnknownsPtr,
    allUnknownsLen,
    0,
    0,
    outEqsPtr,
    outBlocksPtr,
    0,
  );

  heap.free(csrRowPtr);
  heap.free(csrColsPtr);
  heap.free(allUnknownsPtr);
  return numBlocks;
}

function isZeroExprWasm(dae: DaeBuilder, exprId: u32, depth: i32): bool {
  if (exprId == 0xffffffff || exprId >= dae.exprCount || depth > 32) return false;
  let k = dae.getExprKind(exprId);
  if (k == ExprKind.RealLiteral) return dae.getExprRealValue(exprId) == 0.0;
  if (k == ExprKind.IntLiteral) return (dae.getExprData1(exprId) as i32) == 0;
  if (k == ExprKind.Name) {
    let nameId = dae.getExprData1(exprId);
    let varIdx = dae.lookupVariableByName(nameId);
    if (varIdx >= 0 && (varIdx as u32) < dae.varCount) {
      let v = dae.getVarData().get((varIdx as u32) * VAR_STRIDE + VAR_VARIABILITY);
      if (v == Variability.Parameter || v == Variability.Constant) {
        if (dae.getVarStartValue(varIdx as u32) == 0.0) {
          let bindExpr = dae.getVarAttrExpr(varIdx as u32, VarAttrKind.Binding);
          if (bindExpr == 0xffffffff) {
            bindExpr = dae.getVarAttrExpr(varIdx as u32, VarAttrKind.Start);
          }
          if (bindExpr == 0xffffffff) return true;
          return isZeroExprWasm(dae, bindExpr, depth + 1);
        }
      }
    }
  }
  if (k == ExprKind.Negate) {
    let left = dae.getExprLeft(exprId);
    let inner = (left as i32) >= 0 ? left : dae.getExprData1(exprId);
    return isZeroExprWasm(dae, inner, depth + 1);
  }
  if (k == ExprKind.Binary) {
    let op = dae.getExprData1(exprId);
    if (op == BinOp.Mul || op == BinOp.ElemMul) {
      return isZeroExprWasm(dae, dae.getExprLeft(exprId), depth + 1) || isZeroExprWasm(dae, dae.getExprRight(exprId), depth + 1);
    }
  }
  return false;
}

/**
 * Extracts CSR incidence graph directly from a `DaeBuilder` in WASM linear memory
 * and executes Duff's matching + Tarjan's SCC in one pass.
 *
 * `varFilterMaskPtr` is an optional `u8[varCount]` array:
 * - bit 1 (`1`): variable is in `stateVars`
 * - bit 2 (`2`): variable is in `dummyDerivatives`
 * - bit 4 (`4`): variable is excluded (FMU output, `parameterVars`, or JS-only explicit binding)
 *
 * Returns a heap-allocated `i32` buffer pointer `resPtr` (caller frees via `free(resPtr)`):
 * - `resPtr + 0`: `numBlocks`
 * - `resPtr + 4`: `activeEqCount`
 * - `resPtr + 8`: `blocksWordsWritten`
 * - `resPtr + 12`: `sortedEquations[activeEqCount]` (mapped to original equation indices)
 * - `resPtr + 12 + activeEqCount * 4`: `blocksData` (`[bEqCount, bVarCount, ...bEqs, ...bVars]` per block, mapped to original indices)
 */
export function computeBltFromArena(
  daePtr: u32,
  varFilterMaskPtr: usize,
  hasExplicitParamSet: i32,
  hasStateSet: i32,
): usize {
  if (daePtr == 0) return 0;
  let dae = changetype<DaeBuilder>(daePtr);
  let varCount = dae.varCount;
  let eqCount = dae.eqCount;
  let exprCount = dae.exprCount;
  if (varCount == 0 || eqCount == 0) return 0;

  let sp = dae.stringPool;
  let spPtr = changetype<usize>(sp);

  let varToActivePtr = heap.alloc((varCount as usize) << 2);
  let activeToVarPtr = heap.alloc((varCount as usize) << 2);
  let derVarOfStatePtr = heap.alloc((varCount as usize) << 2);
  memory.fill(varToActivePtr, 0xff, (varCount as usize) << 2);
  memory.fill(derVarOfStatePtr, 0xff, (varCount as usize) << 2);

  let activeVarCount: i32 = 0;

  for (let i: u32 = 0; i < varCount; i++) {
    let nameId = dae.getVarNameId(i);
    if (spPtr != 0 && nameId != 0) {
      let innerId = sp.unwrapDerSingle(nameId);
      if (innerId != 0) {
        let baseIdx = dae.lookupVariableByName(innerId);
        if (baseIdx >= 0 && (baseIdx as u32) < varCount) {
          store<i32>(derVarOfStatePtr + ((baseIdx as usize) << 2), i as i32);
        }
      }
    }

    if (dae.isVarRemoved(i)) continue;
    let mask: u8 = varFilterMaskPtr != 0 ? load<u8>(varFilterMaskPtr + (i as usize)) : 0;
    if ((mask & 4) != 0) continue;

    let variability = dae.getVarData().get(i * VAR_STRIDE + VAR_VARIABILITY);
    if (
      variability == Variability.Parameter ||
      variability == Variability.Constant ||
      variability == Variability.Discrete
    ) {
      continue;
    }

    if (hasExplicitParamSet == 0) {
      let binding = dae.getVarAttrExpr(i, VarAttrKind.Binding);
      if (binding != 0xffffffff && (binding as i32) >= 0 && (hasStateSet == 0 || (mask & 1) == 0)) {
        continue;
      }
    }

    if (hasStateSet != 0 && (mask & 1) != 0 && (mask & 2) == 0) {
      continue;
    }

    store<i32>(varToActivePtr + ((i as usize) << 2), activeVarCount);
    store<i32>(activeToVarPtr + ((activeVarCount as usize) << 2), i as i32);
    activeVarCount++;
  }

  let activeToEqPtr = heap.alloc((eqCount as usize) << 2);
  let activeEqCount: i32 = 0;

  for (let i: u32 = 0; i < eqCount; i++) {
    if (dae.isEqRemoved(i) || dae.isEqInitial(i)) continue;
    let kind = dae.getEqData().get(i * EQ_STRIDE + EQ_KIND);
    if (kind == EqKind.Simple) {
      let lhs = dae.getEqData().get(i * EQ_STRIDE + EQ_LHS);
      let rhs = dae.getEqData().get(i * EQ_STRIDE + EQ_RHS);
      if (lhs == rhs) continue;
      if (
        lhs >= 0 &&
        rhs >= 0 &&
        (lhs as u32) < exprCount &&
        (rhs as u32) < exprCount &&
        dae.getExprKind(lhs as u32) == ExprKind.Name &&
        dae.getExprKind(rhs as u32) == ExprKind.Name &&
        dae.getExprData1(lhs as u32) == dae.getExprData1(rhs as u32)
      ) {
        continue;
      }
      store<i32>(activeToEqPtr + ((activeEqCount as usize) << 2), i as i32);
      activeEqCount++;
    }
  }

  if (activeVarCount == 0 || activeEqCount == 0) {
    heap.free(varToActivePtr);
    heap.free(activeToVarPtr);
    heap.free(derVarOfStatePtr);
    heap.free(activeToEqPtr);
    let emptyRes = heap.alloc(16);
    store<i32>(emptyRes, 0);
    store<i32>(emptyRes + 4, 0);
    store<i32>(emptyRes + 8, 1);
    store<i32>(emptyRes + 12, 0);
    return emptyRes;
  }

  let csrRowPtr = heap.alloc(((activeEqCount + 1) as usize) << 2);
  let colsCap: usize = (activeEqCount as usize) * 6;
  if (colsCap < 1024) colsCap = 1024;
  let csrColsPtr = heap.alloc(colsCap << 2);
  let edgeCursor: usize = 0;

  let seenActivePtr = heap.alloc((activeVarCount as usize) << 2);
  memory.fill(seenActivePtr, 0, (activeVarCount as usize) << 2);
  let allUnknownsPtr = heap.alloc((activeVarCount as usize) << 2);
  let isUnknownKnownPtr = heap.alloc(activeVarCount as usize);
  memory.fill(isUnknownKnownPtr, 0, activeVarCount as usize);
  let allUnknownsLen: i32 = 0;

  let stackCap: usize = 1024;
  let exprStackPtr = heap.alloc(stackCap << 2);

  for (let e: i32 = 0; e < activeEqCount; e++) {
    store<i32>(csrRowPtr + ((e as usize) << 2), edgeCursor as i32);
    let eqIdx = load<i32>(activeToEqPtr + ((e as usize) << 2)) as u32;
    let lhs = dae.getEqData().get(eqIdx * EQ_STRIDE + EQ_LHS) as u32;
    let rhs = dae.getEqData().get(eqIdx * EQ_STRIDE + EQ_RHS) as u32;
    let eqToken: i32 = e + 1;

    let spTop: usize = 0;
    if (rhs != 0xffffffff && rhs < exprCount) {
      store<u32>(exprStackPtr + (spTop << 2), rhs);
      spTop++;
    }
    if (lhs != 0xffffffff && lhs < exprCount) {
      store<u32>(exprStackPtr + (spTop << 2), lhs);
      spTop++;
    }

    while (spTop > 0) {
      spTop--;
      let cur = load<u32>(exprStackPtr + (spTop << 2));
      if (cur == 0xffffffff || cur >= exprCount) continue;

      let kind = dae.getExprKind(cur);
      if (kind == ExprKind.Name) {
        let nameId = dae.getExprData1(cur);
        let varIdx = dae.lookupVariableByName(nameId);
        if (varIdx >= 0 && (varIdx as u32) < varCount) {
          let activeIdx = load<i32>(varToActivePtr + ((varIdx as usize) << 2));
          if (activeIdx >= 0) {
            let activeOffset = (activeIdx as usize) << 2;
            if (load<i32>(seenActivePtr + activeOffset) != eqToken) {
              store<i32>(seenActivePtr + activeOffset, eqToken);
              if (edgeCursor >= colsCap) {
                let newCap = colsCap * 2;
                let newCols = heap.alloc(newCap << 2);
                memory.copy(newCols, csrColsPtr, edgeCursor << 2);
                heap.free(csrColsPtr);
                csrColsPtr = newCols;
                colsCap = newCap;
              }
              store<i32>(csrColsPtr + (edgeCursor << 2), activeIdx);
              edgeCursor++;
              if (load<u8>(isUnknownKnownPtr + (activeIdx as usize)) == 0) {
                store<u8>(isUnknownKnownPtr + (activeIdx as usize), 1);
                store<i32>(allUnknownsPtr + ((allUnknownsLen as usize) << 2), activeIdx);
                allUnknownsLen++;
              }
            }
          }
        }
      } else if (kind == ExprKind.Der) {
        let argId = dae.getExprData1(cur);
        if (argId != 0xffffffff && argId < exprCount && dae.getExprKind(argId) == ExprKind.Name) {
          let nameId = dae.getExprData1(argId);
          let derVarIdx: i32 = -1;
          let baseIdx = dae.lookupVariableByName(nameId);
          if (baseIdx >= 0 && (baseIdx as u32) < varCount) {
            derVarIdx = load<i32>(derVarOfStatePtr + ((baseIdx as usize) << 2));
          }
          if (derVarIdx < 0 && spPtr != 0) {
            let derNameId = sp.lookupDerOf(nameId);
            if (derNameId != 0) {
              derVarIdx = dae.lookupVariableByName(derNameId);
            }
          }
          if (derVarIdx >= 0 && (derVarIdx as u32) < varCount) {
            let activeIdx = load<i32>(varToActivePtr + ((derVarIdx as usize) << 2));
            if (activeIdx >= 0) {
              let activeOffset = (activeIdx as usize) << 2;
              if (load<i32>(seenActivePtr + activeOffset) != eqToken) {
                store<i32>(seenActivePtr + activeOffset, eqToken);
                if (edgeCursor >= colsCap) {
                  let newCap = colsCap * 2;
                  let newCols = heap.alloc(newCap << 2);
                  memory.copy(newCols, csrColsPtr, edgeCursor << 2);
                  heap.free(csrColsPtr);
                  csrColsPtr = newCols;
                  colsCap = newCap;
                }
                store<i32>(csrColsPtr + (edgeCursor << 2), activeIdx);
                edgeCursor++;
                if (load<u8>(isUnknownKnownPtr + (activeIdx as usize)) == 0) {
                  store<u8>(isUnknownKnownPtr + (activeIdx as usize), 1);
                  store<i32>(allUnknownsPtr + ((allUnknownsLen as usize) << 2), activeIdx);
                  allUnknownsLen++;
                }
              }
            }
          }
        }
      } else if (kind == ExprKind.Binary) {
        let op = dae.getExprData1(cur);
        let left = dae.getExprLeft(cur);
        let right = dae.getExprRight(cur);
        if (op == BinOp.Mul || op == BinOp.ElemMul) {
          if (isZeroExprWasm(dae, left, 0) || isZeroExprWasm(dae, right, 0)) {
            continue;
          }
        }
        if (spTop + 2 >= stackCap) {
          let newCap = stackCap * 2;
          let newStack = heap.alloc(newCap << 2);
          memory.copy(newStack, exprStackPtr, spTop << 2);
          heap.free(exprStackPtr);
          exprStackPtr = newStack;
          stackCap = newCap;
        }
        if (right != 0xffffffff && right < exprCount) {
          store<u32>(exprStackPtr + (spTop << 2), right);
          spTop++;
        }
        if (left != 0xffffffff && left < exprCount) {
          store<u32>(exprStackPtr + (spTop << 2), left);
          spTop++;
        }
      } else if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
        let left = dae.getExprLeft(cur);
        if (left != 0xffffffff && left < exprCount) {
          if (spTop + 1 >= stackCap) {
            let newCap = stackCap * 2;
            let newStack = heap.alloc(newCap << 2);
            memory.copy(newStack, exprStackPtr, spTop << 2);
            heap.free(exprStackPtr);
            exprStackPtr = newStack;
            stackCap = newCap;
          }
          store<u32>(exprStackPtr + (spTop << 2), left);
          spTop++;
        }
      } else if (kind == ExprKind.Pre) {
        let d1 = dae.getExprData1(cur);
        if (d1 != 0xffffffff && d1 < exprCount) {
          if (spTop + 1 >= stackCap) {
            let newCap = stackCap * 2;
            let newStack = heap.alloc(newCap << 2);
            memory.copy(newStack, exprStackPtr, spTop << 2);
            heap.free(exprStackPtr);
            exprStackPtr = newStack;
            stackCap = newCap;
          }
          store<u32>(exprStackPtr + (spTop << 2), d1);
          spTop++;
        }
      } else if (kind == ExprKind.IfElse) {
        let cond = dae.getExprData1(cur);
        let tExpr = dae.getExprLeft(cur);
        let fExpr = dae.getExprRight(cur);
        if (spTop + 3 >= stackCap) {
          let newCap = stackCap * 2;
          let newStack = heap.alloc(newCap << 2);
          memory.copy(newStack, exprStackPtr, spTop << 2);
          heap.free(exprStackPtr);
          exprStackPtr = newStack;
          stackCap = newCap;
        }
        if (fExpr != 0xffffffff && fExpr < exprCount) {
          store<u32>(exprStackPtr + (spTop << 2), fExpr);
          spTop++;
        }
        if (tExpr != 0xffffffff && tExpr < exprCount) {
          store<u32>(exprStackPtr + (spTop << 2), tExpr);
          spTop++;
        }
        if (cond != 0xffffffff && cond < exprCount) {
          store<u32>(exprStackPtr + (spTop << 2), cond);
          spTop++;
        }
      } else if (kind == ExprKind.Call) {
        let argCount = dae.getExprRight(cur);
        let firstArg = dae.getExprLeft(cur);
        if (argCount > 0 && argCount < 1024) {
          if (spTop + (argCount as usize) >= stackCap) {
            let newCap = (stackCap + (argCount as usize)) * 2;
            let newStack = heap.alloc(newCap << 2);
            memory.copy(newStack, exprStackPtr, spTop << 2);
            heap.free(exprStackPtr);
            exprStackPtr = newStack;
            stackCap = newCap;
          }
          for (let k: i32 = (argCount as i32) - 1; k >= 0; k--) {
            let argExpr = k == 0 ? firstArg : dae.getExprLeft(cur + (k as u32));
            if ((argExpr as i32) >= 0 && argExpr < exprCount) {
              store<u32>(exprStackPtr + (spTop << 2), argExpr);
              spTop++;
            }
          }
        }
      } else if (kind == ExprKind.Subscript) {
        let baseExpr = dae.getExprData1(cur);
        let rawSubCount = dae.getExprRight(cur) as i32;
        let subCount: i32 = rawSubCount > 1 ? rawSubCount : 1;
        let firstSub = dae.getExprLeft(cur);
        if (subCount < 1024) {
          if (spTop + (subCount as usize) + 1 >= stackCap) {
            let newCap = (stackCap + (subCount as usize) + 1) * 2;
            let newStack = heap.alloc(newCap << 2);
            memory.copy(newStack, exprStackPtr, spTop << 2);
            heap.free(exprStackPtr);
            exprStackPtr = newStack;
            stackCap = newCap;
          }
          for (let k: i32 = subCount - 1; k >= 0; k--) {
            let subExpr = k == 0 ? firstSub : dae.getExprLeft(cur + (k as u32));
            if ((subExpr as i32) >= 0 && subExpr != 0xffffffff && subExpr < exprCount) {
              store<u32>(exprStackPtr + (spTop << 2), subExpr);
              spTop++;
            }
          }
        }
        if (baseExpr != 0xffffffff && baseExpr < exprCount) {
          store<u32>(exprStackPtr + (spTop << 2), baseExpr);
          spTop++;
        }
      } else if (kind == ExprKind.ArrayCtor || kind == ExprKind.Tuple) {
        let count = dae.getExprData1(cur);
        if (count > 0 && count < 65536) {
          if (spTop + (count as usize) >= stackCap) {
            let newCap = (stackCap + (count as usize)) * 2;
            let newStack = heap.alloc(newCap << 2);
            memory.copy(newStack, exprStackPtr, spTop << 2);
            heap.free(exprStackPtr);
            exprStackPtr = newStack;
            stackCap = newCap;
          }
          for (let k: i32 = (count as i32) - 1; k >= 0; k--) {
            let elem = k == 0 ? dae.getExprLeft(cur) : dae.getExprLeft(cur + (k as u32));
            if ((elem as i32) >= 0 && elem < exprCount) {
              store<u32>(exprStackPtr + (spTop << 2), elem);
              spTop++;
            }
          }
        }
      } else if (kind == ExprKind.Range) {
        let d1 = dae.getExprData1(cur);
        let left = dae.getExprLeft(cur);
        let right = dae.getExprRight(cur);
        if (spTop + 3 >= stackCap) {
          let newCap = stackCap * 2;
          let newStack = heap.alloc(newCap << 2);
          memory.copy(newStack, exprStackPtr, spTop << 2);
          heap.free(exprStackPtr);
          exprStackPtr = newStack;
          stackCap = newCap;
        }
        if (right != 0xffffffff && right < exprCount) {
          store<u32>(exprStackPtr + (spTop << 2), right);
          spTop++;
        }
        if ((left as i32) >= 0 && left != 0xffffffff && left < exprCount) {
          store<u32>(exprStackPtr + (spTop << 2), left);
          spTop++;
        }
        if (d1 != 0xffffffff && d1 < exprCount) {
          store<u32>(exprStackPtr + (spTop << 2), d1);
          spTop++;
        }
      }
    }
  }
  store<i32>(csrRowPtr + ((activeEqCount as usize) << 2), edgeCursor as i32);

  heap.free(exprStackPtr);
  heap.free(seenActivePtr);
  heap.free(isUnknownKnownPtr);
  heap.free(varToActivePtr);
  heap.free(derVarOfStatePtr);

  let maxResultWords: usize = 3 + (activeEqCount as usize) + 1 + (activeVarCount as usize) * 4;
  let resPtr = heap.alloc(maxResultWords << 2);
  let outEqsPtr = resPtr + 12;
  let outBlocksPtr = outEqsPtr + ((activeEqCount as usize) << 2);

  let numBlocks = solveBltCsrCore(
    activeVarCount,
    activeEqCount,
    csrRowPtr,
    csrColsPtr,
    allUnknownsPtr,
    allUnknownsLen,
    activeToEqPtr,
    activeToVarPtr,
    outEqsPtr,
    outBlocksPtr,
    resPtr + 8,
  );

  store<i32>(resPtr + 0, numBlocks);
  store<i32>(resPtr + 4, activeEqCount);

  heap.free(csrRowPtr);
  heap.free(csrColsPtr);
  heap.free(allUnknownsPtr);
  heap.free(activeToEqPtr);
  heap.free(activeToVarPtr);

  return resPtr;
}

export function alloc(size: i32): usize {
  return heap.alloc(size);
}

export function free(ptr: usize): void {
  heap.free(ptr);
}

