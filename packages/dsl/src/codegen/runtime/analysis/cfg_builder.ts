// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Control Flow Graph (CFG) Basic Block Builder ---
// Manages zero-GC basic block allocations, sequential chains, and loop contexts in linear memory.

import { allocGen0 } from "./arena";
import { BLOCK_SIZE, BasicBlock } from "./ir_layout";

export let firstBlock: u32 = 0;
export let lastBlock: u32 = 0;
export let currentBlock: u32 = 0;
export let currentLoopHeader: u32 = 0;
export let currentLoopExit: u32 = 0;
export let fnExitBlock: u32 = 0;

export function allocBlock(): u32 {
  let blk = allocGen0(BLOCK_SIZE);
  if (blk != 0) {
    memory.fill(blk as usize, 0, BLOCK_SIZE);
    if (firstBlock == 0) {
      firstBlock = blk;
    } else if (lastBlock != 0) {
      let last = BasicBlock.at(lastBlock as usize);
      let curr = BasicBlock.at(blk as usize);
      last.nextBlock = blk;
      curr.prevBlock = lastBlock;
    }
    lastBlock = blk;
  }
  return blk;
}

export function resetCFG(): void {
  firstBlock = 0;
  lastBlock = 0;
  currentBlock = 0;
  currentLoopHeader = 0;
  currentLoopExit = 0;
  fnExitBlock = 0;
}

export function addCFGSuccessor(srcBlk: u32, dstBlk: u32, isTrueBranch: boolean): void {
  if (srcBlk == 0 || dstBlk == 0) return;
  let src = BasicBlock.at(srcBlk as usize);
  if (isTrueBranch) {
    src.trueBranch = dstBlk;
  } else {
    src.falseBranch = dstBlk;
  }
}
