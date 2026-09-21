// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Generic Dataflow Analysis Worklist & Fixed-Point Framework ---
// Zero-GC AssemblyScript framework for intra-procedural dataflow analysis,
// Reverse Post-Order (RPO) computation, and worklist propagation.

import { allocGen0, getNodePadding, getNodeByteLength, getNodeFlags, FLAG_IS_SYNTHETIC } from "./arena";
import {
  BLOCK_STATE_IN,
  BLOCK_STATE_OUT,
  BLOCK_STATE_TRUE,
  BLOCK_STATE_FALSE,
  BLOCK_TRUE_BRANCH,
  BLOCK_FALSE_BRANCH,
  BLOCK_NEXT,
  BLOCK_FIRST_INSTR,
  IR_INSTR_NEXT,
} from "./ir_layout";

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
  for (let ptr = firstBlock; ptr != 0; ptr = load<u32>(ptr + BLOCK_NEXT, 0)) {
    numBlocks++;
  }
  if (numBlocks == 0) {
    store<u32>(outCountPtr, 0);
    return;
  }

  let visitedOffset = allocGen0(numBlocks * 4);
  let postOrderOffset = allocGen0(numBlocks * 4);
  let blockIndexMap = allocGen0(numBlocks * 8);

  let idx: u32 = 0;
  for (let ptr = firstBlock; ptr != 0; ptr = load<u32>(ptr + BLOCK_NEXT, 0)) {
    store<u32>(blockIndexMap + idx * 8, ptr);
    store<u32>(blockIndexMap + idx * 8 + 4, idx);
    store<u32>(visitedOffset + idx * 4, 0);
    idx++;
  }

  let postIdx: u32 = 0;
  let stackOffset = allocGen0(numBlocks * 8);

  store<u32>(stackOffset, firstBlock);
  store<u32>(stackOffset + 4, 0);
  let stackTop: u32 = 1;

  while (stackTop > 0) {
    stackTop--;
    let blk = load<u32>(stackOffset + stackTop * 8);
    let phase = load<u32>(stackOffset + stackTop * 8 + 4);

    let blkIdx: u32 = 0xffffffff;
    for (let i: u32 = 0; i < numBlocks; i++) {
      if (load<u32>(blockIndexMap + i * 8) == blk) {
        blkIdx = i;
        break;
      }
    }
    if (blkIdx == 0xffffffff) continue;

    if (phase == 1) {
      store<u32>(postOrderOffset + postIdx * 4, blk);
      postIdx++;
      continue;
    }

    if (load<u32>(visitedOffset + blkIdx * 4) != 0) continue;
    store<u32>(visitedOffset + blkIdx * 4, 1);

    store<u32>(stackOffset + stackTop * 8, blk);
    store<u32>(stackOffset + stackTop * 8 + 4, 1);
    stackTop++;

    let fBranch = load<u32>(blk + BLOCK_FALSE_BRANCH, 0);
    if (fBranch != 0) {
      let fIdx: u32 = 0xffffffff;
      for (let i: u32 = 0; i < numBlocks; i++) {
        if (load<u32>(blockIndexMap + i * 8) == fBranch) {
          fIdx = i;
          break;
        }
      }
      if (fIdx != 0xffffffff && load<u32>(visitedOffset + fIdx * 4) == 0) {
        store<u32>(stackOffset + stackTop * 8, fBranch);
        store<u32>(stackOffset + stackTop * 8 + 4, 0);
        stackTop++;
      }
    }
    let tBranch = load<u32>(blk + BLOCK_TRUE_BRANCH, 0);
    if (tBranch != 0) {
      let tIdx: u32 = 0xffffffff;
      for (let i: u32 = 0; i < numBlocks; i++) {
        if (load<u32>(blockIndexMap + i * 8) == tBranch) {
          tIdx = i;
          break;
        }
      }
      if (tIdx != 0xffffffff && load<u32>(visitedOffset + tIdx * 4) == 0) {
        store<u32>(stackOffset + stackTop * 8, tBranch);
        store<u32>(stackOffset + stackTop * 8 + 4, 0);
        stackTop++;
      }
    }
  }

  store<u32>(outCountPtr, postIdx);
  let rpoBuf = allocGen0(postIdx * 4);
  for (let i: u32 = 0; i < postIdx; i++) {
    store<u32>(rpoBuf + i * 4, load<u32>(postOrderOffset + (postIdx - 1 - i) * 4));
  }
  store<usize>(outRpoBuf, rpoBuf);
}
