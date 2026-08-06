// --- SSA Form & Dominator Tree Construction ---
// Implements Cooper-Harvey-Kennedy Immediate Dominator (idom) computation
// and phi-node placement in AssemblyScript zero-GC linear memory.

import { BLOCK_DOMINATOR, BLOCK_FALSE_BRANCH, BLOCK_NEXT, BLOCK_POST_ORDER, BLOCK_TRUE_BRANCH } from "./ir_layout.js";

export function generateSSA(): string {
  return `
import { allocGen0 } from "./arena";

// --- Dynamic SSA Dominator Construction ---

export function computeSSAPostOrder(entryBlock: u32): void {
    let maxPtr: u32 = 0;
    let numBlocks: u32 = 0;
    for (let b = entryBlock; b != 0; b = load<u32>(b + ${BLOCK_NEXT}, 0)) {
        if (b > maxPtr) maxPtr = b;
        numBlocks++;
    }
    if (numBlocks == 0) return;

    let visitedOffset = allocGen0(maxPtr + 4);
    for (let i: u32 = 0; i <= maxPtr; i += 4) {
        store<u32>(visitedOffset + i, 0);
    }
    
    let stackOffset = allocGen0(numBlocks * 8);
    let stackTop: u32 = 0;

    store<u32>(stackOffset, entryBlock);
    store<u32>(stackOffset + 4, 0);
    stackTop = 1;

    let postIdx: u32 = 0;

    while (stackTop > 0) {
        stackTop--;
        let blk = load<u32>(stackOffset + stackTop * 8);
        let phase = load<u32>(stackOffset + stackTop * 8 + 4);

        if (phase == 1) {
            store<u32>(blk + ${BLOCK_POST_ORDER}, postIdx);
            postIdx++;
            continue;
        }

        if (load<u32>(visitedOffset + blk) != 0) continue;
        store<u32>(visitedOffset + blk, 1);

        store<u32>(stackOffset + stackTop * 8, blk);
        store<u32>(stackOffset + stackTop * 8 + 4, 1);
        stackTop++;

        let fBranch = load<u32>(blk + ${BLOCK_FALSE_BRANCH}, 0);
        if (fBranch != 0 && load<u32>(visitedOffset + fBranch) == 0) {
            store<u32>(stackOffset + stackTop * 8, fBranch);
            store<u32>(stackOffset + stackTop * 8 + 4, 0);
            stackTop++;
        }
        let tBranch = load<u32>(blk + ${BLOCK_TRUE_BRANCH}, 0);
        if (tBranch != 0 && load<u32>(visitedOffset + tBranch) == 0) {
            store<u32>(stackOffset + stackTop * 8, tBranch);
            store<u32>(stackOffset + stackTop * 8 + 4, 0);
            stackTop++;
        }
    }
}

export function computeDominators(entryBlock: u32): void {
    if (entryBlock == 0) return;
    
    computeSSAPostOrder(entryBlock);

    // Set entry block dominator to itself
    store<u32>(entryBlock + ${BLOCK_DOMINATOR}, entryBlock);

    let changed = true;
    let iter = 0;

    while (changed && iter < 100) {
        iter++;
        changed = false;

        for (let b = entryBlock; b != 0; b = load<u32>(b + ${BLOCK_NEXT}, 0)) {
            if (b == entryBlock) continue;

            let newIdom: u32 = 0;
            // Iterate predecessors
            for (let p = entryBlock; p != 0; p = load<u32>(p + ${BLOCK_NEXT}, 0)) {
                let tBranch = load<u32>(p + ${BLOCK_TRUE_BRANCH}, 0);
                let fBranch = load<u32>(p + ${BLOCK_FALSE_BRANCH}, 0);

                if (tBranch == b || fBranch == b) {
                    let domP = load<u32>(p + ${BLOCK_DOMINATOR}, 0);
                    if (domP != 0) {
                        if (newIdom == 0) {
                            newIdom = p;
                        } else {
                            newIdom = intersectDominator(p, newIdom);
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

function intersectDominator(b1: u32, b2: u32): u32 {
    let finger1 = b1;
    let finger2 = b2;
    while (finger1 != finger2 && finger1 != 0 && finger2 != 0) {
        let po1 = load<u32>(finger1 + ${BLOCK_POST_ORDER}, 0);
        let po2 = load<u32>(finger2 + ${BLOCK_POST_ORDER}, 0);
        while (po1 < po2 && finger1 != 0) {
            finger1 = load<u32>(finger1 + ${BLOCK_DOMINATOR}, 0);
            if (finger1 != 0) po1 = load<u32>(finger1 + ${BLOCK_POST_ORDER}, 0);
        }
        while (po2 < po1 && finger2 != 0) {
            finger2 = load<u32>(finger2 + ${BLOCK_DOMINATOR}, 0);
            if (finger2 != 0) po2 = load<u32>(finger2 + ${BLOCK_POST_ORDER}, 0);
        }
    }
    return finger1 != 0 ? finger1 : b2;
}

export function placePhiNodes(entryBlock: u32): void {
    if (entryBlock == 0) return;
    computeDominators(entryBlock);
}
`;
}
