// --- SSA Form & Dominator Tree Construction ---
// Implements Cooper-Harvey-Kennedy Immediate Dominator (idom) computation,
// Dominance Frontiers (DF), and minimal Phi-node placement in AssemblyScript zero-GC linear memory.

import {
  BLOCK_DOMINATOR,
  BLOCK_FALSE_BRANCH,
  BLOCK_FIRST_INSTR,
  BLOCK_LAST_INSTR,
  BLOCK_POST_ORDER,
  BLOCK_SUCCESSOR_LIST,
  BLOCK_TRUE_BRANCH,
  IR_INSTR_NEXT,
  IR_INSTR_OPCODE,
  IR_INSTR_OPERAND1,
  IR_INSTR_OPERAND2,
  IR_INSTR_SIZE,
  IR_INSTR_TYPE_ID,
  IR_OPCODE_PHI,
} from "./ir_layout.js";

export function generateSSA(): string {
  return `
import { allocGen0 } from "./arena";
import {
  BLOCK_DOMINATOR,
  BLOCK_FALSE_BRANCH,
  BLOCK_FIRST_INSTR,
  BLOCK_LAST_INSTR,
  BLOCK_NEXT,
  BLOCK_POST_ORDER,
  BLOCK_SUCCESSOR_LIST,
  BLOCK_TRUE_BRANCH,
  IR_INSTR_NEXT,
  IR_INSTR_OPCODE,
  IR_INSTR_OPERAND1,
  IR_INSTR_OPERAND2,
  IR_INSTR_SIZE,
  IR_INSTR_TYPE_ID,
  IR_OPCODE_PHI,
} from "./ir_layout";

// --- Global SSA State in Linear Memory ---

export let ssaBlockCount: u32 = 0;
export let ssaRPOOffset: u32 = 0;           // Dense array of block pointers in Reverse Post-Order
export let ssaDFOffset: u32 = 0;            // Table of Dominance Frontier list pointers (1 per block index)

/**
 * Traverses reachable blocks via DFS starting at entryBlock.
 * Numbers each block in post-order and constructs the dense Reverse Post-Order (RPO) array.
 */
export function computeSSAPostOrder(entryBlock: u32): u32 {
    if (entryBlock == 0) {
        ssaBlockCount = 0;
        ssaRPOOffset = 0;
        return 0;
    }

    // Capacity sizing based on allocated basic blocks or fallback minimum
    let maxCapacity: u32 = 256;
    let stackCapacity: u32 = maxCapacity * 4;
    let stackOffset = allocGen0(stackCapacity * 8); // [blockPtr, phase]
    let visitedMap = allocGen0(maxCapacity * 4);    // dense array of visited block pointers
    let visitedCount: u32 = 0;

    let stackTop: u32 = 0;
    store<u32>(stackOffset, entryBlock);
    store<u32>(stackOffset + 4, 0); // phase 0: discover
    stackTop = 1;

    let postIdx: u32 = 0;

    while (stackTop > 0) {
        stackTop--;
        let blk = load<u32>(stackOffset + stackTop * 8);
        let phase = load<u32>(stackOffset + stackTop * 8 + 4);

        if (phase == 1) {
            // Post-order finish: assign post-order index
            store<u32>(blk + ${BLOCK_POST_ORDER}, postIdx);
            postIdx++;
            continue;
        }

        // Check if already visited
        let alreadyVisited = false;
        for (let i: u32 = 0; i < visitedCount; i++) {
            if (load<u32>(visitedMap + i * 4) == blk) {
                alreadyVisited = true;
                break;
            }
        }
        if (alreadyVisited) continue;

        // Record visited block
        if (visitedCount < maxCapacity) {
            store<u32>(visitedMap + visitedCount * 4, blk);
            visitedCount++;
        }

        // Push phase 1 (finish / post-order assignment)
        if (stackTop < stackCapacity) {
            store<u32>(stackOffset + stackTop * 8, blk);
            store<u32>(stackOffset + stackTop * 8 + 4, 1);
            stackTop++;
        }

        // Push false branch
        let fBranch = load<u32>(blk + ${BLOCK_FALSE_BRANCH}, 0);
        if (fBranch != 0 && stackTop < stackCapacity) {
            store<u32>(stackOffset + stackTop * 8, fBranch);
            store<u32>(stackOffset + stackTop * 8 + 4, 0);
            stackTop++;
        }

        // Push true branch
        let tBranch = load<u32>(blk + ${BLOCK_TRUE_BRANCH}, 0);
        if (tBranch != 0 && stackTop < stackCapacity) {
            store<u32>(stackOffset + stackTop * 8, tBranch);
            store<u32>(stackOffset + stackTop * 8 + 4, 0);
            stackTop++;
        }

        // Push multi-way branch successors from BLOCK_SUCCESSOR_LIST if present
        let succList = load<u32>(blk + ${BLOCK_SUCCESSOR_LIST}, 0);
        if (succList != 0) {
            let succCount = load<u32>(succList, 0);
            for (let s: u32 = 0; s < succCount; s++) {
                let sBlk = load<u32>(succList + 4 + s * 4);
                if (sBlk != 0 && stackTop < stackCapacity) {
                    store<u32>(stackOffset + stackTop * 8, sBlk);
                    store<u32>(stackOffset + stackTop * 8 + 4, 0);
                    stackTop++;
                }
            }
        }
    }

    ssaBlockCount = visitedCount;
    if (ssaBlockCount == 0) return 0;

    // Allocate dense RPO array
    ssaRPOOffset = allocGen0(ssaBlockCount * 4);

    // Build Reverse Post-Order array (rpo[0] is entryBlock with max postIdx)
    for (let i: u32 = 0; i < visitedCount; i++) {
        let blk = load<u32>(visitedMap + i * 4);
        let po = load<u32>(blk + ${BLOCK_POST_ORDER}, 0);
        let rpoIdx = ssaBlockCount - 1 - po;
        if (rpoIdx < ssaBlockCount) {
            store<u32>(ssaRPOOffset + rpoIdx * 4, blk);
        }
    }

    return ssaBlockCount;
}

/**
 * Computes Immediate Dominators (idom) using the Cooper-Harvey-Kennedy algorithm.
 * Guarantees fast convergence in Reverse Post-Order (RPO).
 */
export function computeDominators(entryBlock: u32): void {
    if (entryBlock == 0) return;
    let numBlocks = computeSSAPostOrder(entryBlock);
    if (numBlocks == 0) return;

    // Initialize all reachable dominators to 0
    for (let i: u32 = 0; i < numBlocks; i++) {
        let b = load<u32>(ssaRPOOffset + i * 4);
        store<u32>(b + ${BLOCK_DOMINATOR}, 0);
    }

    // Set entry block dominator to itself
    store<u32>(entryBlock + ${BLOCK_DOMINATOR}, entryBlock);

    let changed = true;
    let iter: u32 = 0;

    while (changed && iter < 100) {
        iter++;
        changed = false;

        // Iterate in Reverse Post-Order (skipping entry block at index 0)
        for (let i: u32 = 1; i < numBlocks; i++) {
            let b = load<u32>(ssaRPOOffset + i * 4);
            let newIdom: u32 = 0;

            // Iterate predecessors of b
            for (let j: u32 = 0; j < numBlocks; j++) {
                let p = load<u32>(ssaRPOOffset + j * 4);
                let tBranch = load<u32>(p + ${BLOCK_TRUE_BRANCH}, 0);
                let fBranch = load<u32>(p + ${BLOCK_FALSE_BRANCH}, 0);
                let isPred = (tBranch == b || fBranch == b);

                if (!isPred) {
                    let succList = load<u32>(p + ${BLOCK_SUCCESSOR_LIST}, 0);
                    if (succList != 0) {
                        let succCount = load<u32>(succList, 0);
                        for (let s: u32 = 0; s < succCount; s++) {
                            if (load<u32>(succList + 4 + s * 4) == b) {
                                isPred = true;
                                break;
                            }
                        }
                    }
                }

                if (isPred) {
                    let domP = load<u32>(p + ${BLOCK_DOMINATOR}, 0);
                    if (domP != 0) { // Predecessor has an established dominator
                        if (newIdom == 0) {
                            newIdom = p;
                        } else {
                            newIdom = intersectDominator(p, newIdom, entryBlock);
                        }
                    }
                }
            }

            let currentDom = load<u32>(b + ${BLOCK_DOMINATOR}, 0);
            if (newIdom != 0 && newIdom != currentDom) {
                store<u32>(b + ${BLOCK_DOMINATOR}, newIdom);
                changed = true;
            }
        }
    }
}

/**
 * Finds the Lowest Common Ancestor (LCA) in the dominator tree using Post-Order numbers.
 */
export function intersectDominator(b1: u32, b2: u32, entryBlock: u32): u32 {
    let finger1 = b1;
    let finger2 = b2;
    while (finger1 != finger2 && finger1 != 0 && finger2 != 0) {
        let po1 = load<u32>(finger1 + ${BLOCK_POST_ORDER}, 0);
        let po2 = load<u32>(finger2 + ${BLOCK_POST_ORDER}, 0);

        while (po1 < po2 && finger1 != entryBlock && finger1 != 0) {
            let nextDom = load<u32>(finger1 + ${BLOCK_DOMINATOR}, 0);
            if (nextDom == finger1 || nextDom == 0) break;
            finger1 = nextDom;
            po1 = load<u32>(finger1 + ${BLOCK_POST_ORDER}, 0);
        }
        while (po2 < po1 && finger2 != entryBlock && finger2 != 0) {
            let nextDom = load<u32>(finger2 + ${BLOCK_DOMINATOR}, 0);
            if (nextDom == finger2 || nextDom == 0) break;
            finger2 = nextDom;
            po2 = load<u32>(finger2 + ${BLOCK_POST_ORDER}, 0);
        }

        if (finger1 == entryBlock && finger2 == entryBlock) return entryBlock;
        if (po1 == po2 && finger1 == finger2) return finger1;
        if (finger1 == entryBlock || finger2 == entryBlock) return entryBlock;
    }
    return finger1 != 0 ? finger1 : finger2;
}

/**
 * Computes Dominance Frontiers (DF) for all reachable basic blocks.
 * Returns the arena pointer to the table of DF lists (indexed by RPO block index).
 */
export function computeDominanceFrontiers(entryBlock: u32): u32 {
    if (entryBlock == 0) return 0;
    computeDominators(entryBlock);
    let numBlocks = ssaBlockCount;
    if (numBlocks == 0) return 0;

    // Allocate array of pointers to DF lists: [listPtr0, listPtr1, ...]
    ssaDFOffset = allocGen0(numBlocks * 4);
    for (let i: u32 = 0; i < numBlocks; i++) {
        // Allocate empty list: [count, capacity, item0, item1, ...]
        let listPtr = allocGen0(32); // initial capacity of 6 blocks
        store<u32>(listPtr, 0);      // count = 0
        store<u32>(listPtr + 4, 6);  // capacity = 6
        store<u32>(ssaDFOffset + i * 4, listPtr);
    }

    // For all blocks b: if count(preds(b)) >= 2
    for (let i: u32 = 0; i < numBlocks; i++) {
        let b = load<u32>(ssaRPOOffset + i * 4);
        let idomB = load<u32>(b + ${BLOCK_DOMINATOR}, 0);

        // Check each predecessor p of b
        for (let j: u32 = 0; j < numBlocks; j++) {
            let p = load<u32>(ssaRPOOffset + j * 4);
            let tBranch = load<u32>(p + ${BLOCK_TRUE_BRANCH}, 0);
            let fBranch = load<u32>(p + ${BLOCK_FALSE_BRANCH}, 0);
            let isPred = (tBranch == b || fBranch == b);

            if (isPred) {
                let runner = p;
                while (runner != 0 && runner != idomB && runner != entryBlock) {
                    addBlockToDF(runner, b);
                    let nextRunner = load<u32>(runner + ${BLOCK_DOMINATOR}, 0);
                    if (nextRunner == runner) break;
                    runner = nextRunner;
                }
                if (runner != 0 && runner != idomB && runner == entryBlock && idomB != entryBlock) {
                    addBlockToDF(entryBlock, b);
                }
            }
        }
    }

    return ssaDFOffset;
}

function addBlockToDF(blockPtr: u32, dfTargetBlock: u32): void {
    let rpoIdx: u32 = 0;
    let found = false;
    for (let i: u32 = 0; i < ssaBlockCount; i++) {
        if (load<u32>(ssaRPOOffset + i * 4) == blockPtr) {
            rpoIdx = i;
            found = true;
            break;
        }
    }
    if (!found || ssaDFOffset == 0) return;

    let listPtr = load<u32>(ssaDFOffset + rpoIdx * 4);
    if (listPtr == 0) return;

    let count = load<u32>(listPtr);
    let cap = load<u32>(listPtr + 4);

    // Check for duplicate
    for (let i: u32 = 0; i < count; i++) {
        if (load<u32>(listPtr + 8 + i * 4) == dfTargetBlock) return;
    }

    if (count < cap) {
        store<u32>(listPtr + 8 + count * 4, dfTargetBlock);
        store<u32>(listPtr, count + 1);
    }
}

/**
 * Returns the Dominance Frontier list pointer [count, cap, item0, ...] for a given block.
 */
export function getDominanceFrontier(blockPtr: u32): u32 {
    if (ssaDFOffset == 0 || ssaBlockCount == 0) return 0;
    for (let i: u32 = 0; i < ssaBlockCount; i++) {
        if (load<u32>(ssaRPOOffset + i * 4) == blockPtr) {
            return load<u32>(ssaDFOffset + i * 4);
        }
    }
    return 0;
}

/**
 * Places minimal Phi-node instructions at join blocks in the Dominance Frontier.
 */
export function placePhiNodes(entryBlock: u32): void {
    if (entryBlock == 0) return;
    computeDominanceFrontiers(entryBlock);

    let numBlocks = ssaBlockCount;
    if (numBlocks == 0 || ssaDFOffset == 0) return;

    // For all blocks with non-empty dominance frontiers, insert Phi instructions
    for (let i: u32 = 0; i < numBlocks; i++) {
        let listPtr = load<u32>(ssaDFOffset + i * 4);
        if (listPtr == 0) continue;
        let count = load<u32>(listPtr);

        for (let j: u32 = 0; j < count; j++) {
            let targetBlk = load<u32>(listPtr + 8 + j * 4);
            if (targetBlk == 0) continue;

            // Check if targetBlk already has a Phi instruction
            let firstInstr = load<u32>(targetBlk + ${BLOCK_FIRST_INSTR}, 0);
            let hasPhi = false;
            let curr = firstInstr;
            while (curr != 0) {
                let op = load<u16>(curr + ${IR_INSTR_OPCODE}, 0);
                if (op == <u16>${IR_OPCODE_PHI}) {
                    hasPhi = true;
                    break;
                }
                curr = load<u32>(curr + ${IR_INSTR_NEXT}, 0);
            }

            if (!hasPhi) {
                // Allocate and prepend Phi node instruction
                let phiInstr = allocGen0(${IR_INSTR_SIZE});
                if (phiInstr != 0) {
                    store<u16>(phiInstr + ${IR_INSTR_OPCODE}, <u16>${IR_OPCODE_PHI});
                    store<u16>(phiInstr + ${IR_INSTR_TYPE_ID}, 0);
                    store<u32>(phiInstr + ${IR_INSTR_OPERAND1}, 0);
                    store<u32>(phiInstr + ${IR_INSTR_OPERAND2}, 0);
                    store<u32>(phiInstr + ${IR_INSTR_NEXT}, firstInstr);

                    store<u32>(targetBlk + ${BLOCK_FIRST_INSTR}, phiInstr);
                    if (load<u32>(targetBlk + ${BLOCK_LAST_INSTR}, 0) == 0) {
                        store<u32>(targetBlk + ${BLOCK_LAST_INSTR}, phiInstr);
                    }
                }
            }
        }
    }
}
`;
}
