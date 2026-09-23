// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Generic Dataflow Analysis Worklist & Fixed-Point Framework ---
// Zero-GC AssemblyScript framework for intra-procedural dataflow analysis,
// Reverse Post-Order (RPO) computation, and worklist propagation.

import { allocGen0, getNodePadding, getNodeByteLength, getNodeFlags, FLAG_IS_SYNTHETIC } from "./arena";
import {
  BasicBlock,
  DfsStackFrame,
  BLOCK_STATE_IN,
  BLOCK_STATE_OUT,
  BLOCK_STATE_TRUE,
  BLOCK_STATE_FALSE,
  BLOCK_FIRST_INSTR,
  IR_INSTR_NEXT,
} from "./ir_layout";
import { UnmanagedUint32Array } from "../core/array";

export const DATAFLOW_MAX_ITERATIONS: u32 = 1000;

import { allocDiagnostic } from "./graph";
import { globalAstRoot, lsp_findNodeOffset } from "./lsp";

export function dataflowError(nodeId: u32, code: u32): void {
  if (nodeId == 0 || (getNodeFlags(nodeId) & FLAG_IS_SYNTHETIC) != 0) return;
  let absStart = lsp_findNodeOffset(globalAstRoot, nodeId, 0);
  let startByte: u32 = absStart >= 0 ? (absStart as u32) : getNodePadding(nodeId);
  let endByte = startByte + getNodeByteLength(nodeId);
  allocDiagnostic(startByte, endByte, code, 0);
}

export function computeBlockRPO(firstBlock: u32, outRpoBuf: usize, outCountPtr: usize): void {
  let numBlocks: u32 = 0;
  for (let ptr = firstBlock; ptr != 0; ptr = BasicBlock.at(ptr as usize).nextBlock) {
    numBlocks++;
  }
  if (numBlocks == 0) {
    store<u32>(outCountPtr, 0);
    return;
  }

  let visitedOffset = allocGen0(numBlocks * 4);
  let visited = changetype<UnmanagedUint32Array>(visitedOffset);
  let postOrderOffset = allocGen0(numBlocks * 4);
  let postOrder = changetype<UnmanagedUint32Array>(postOrderOffset);
  let blockIndexMap = allocGen0(numBlocks * 8);

  let idx: u32 = 0;
  for (let ptr = firstBlock; ptr != 0; ptr = BasicBlock.at(ptr as usize).nextBlock) {
    store<u32>(blockIndexMap + idx * 8, ptr);
    store<u32>(blockIndexMap + idx * 8 + 4, idx);
    visited[idx] = 0;
    idx++;
  }

  let postIdx: u32 = 0;
  let stackOffset = allocGen0(numBlocks * 8);

  let f0 = DfsStackFrame.at(stackOffset, 0);
  f0.blk = firstBlock;
  f0.phase = 0;
  let stackTop: u32 = 1;

  while (stackTop > 0) {
    stackTop--;
    let frame = DfsStackFrame.at(stackOffset, stackTop);
    let blk = frame.blk;
    let phase = frame.phase;

    let blkIdx: u32 = 0xffffffff;
    for (let i: u32 = 0; i < numBlocks; i++) {
      if (load<u32>(blockIndexMap + i * 8) == blk) {
        blkIdx = i;
        break;
      }
    }
    if (blkIdx == 0xffffffff) continue;

    if (phase == 1) {
      postOrder[postIdx] = blk;
      postIdx++;
      continue;
    }

    if (visited[blkIdx] != 0) continue;
    visited[blkIdx] = 1;

    let fRet = DfsStackFrame.at(stackOffset, stackTop);
    fRet.blk = blk;
    fRet.phase = 1;
    stackTop++;

    let blockObj = BasicBlock.at(blk as usize);
    let fBranch = blockObj.falseBranch;
    if (fBranch != 0) {
      let fIdx: u32 = 0xffffffff;
      for (let i: u32 = 0; i < numBlocks; i++) {
        if (load<u32>(blockIndexMap + i * 8) == fBranch) {
          fIdx = i;
          break;
        }
      }
      if (fIdx != 0xffffffff && visited[fIdx] == 0) {
        let fNext = DfsStackFrame.at(stackOffset, stackTop);
        fNext.blk = fBranch;
        fNext.phase = 0;
        stackTop++;
      }
    }
    let tBranch = blockObj.trueBranch;
    if (tBranch != 0) {
      let tIdx: u32 = 0xffffffff;
      for (let i: u32 = 0; i < numBlocks; i++) {
        if (load<u32>(blockIndexMap + i * 8) == tBranch) {
          tIdx = i;
          break;
        }
      }
      if (tIdx != 0xffffffff && visited[tIdx] == 0) {
        let tNext = DfsStackFrame.at(stackOffset, stackTop);
        tNext.blk = tBranch;
        tNext.phase = 0;
        stackTop++;
      }
    }
  }

  store<u32>(outCountPtr, postIdx);
  let rpoBuf = allocGen0(postIdx * 4);
  let rpo = changetype<UnmanagedUint32Array>(rpoBuf);
  for (let i: u32 = 0; i < postIdx; i++) {
    rpo[i] = postOrder[postIdx - 1 - i];
  }
  store<usize>(outRpoBuf, rpoBuf);
}
