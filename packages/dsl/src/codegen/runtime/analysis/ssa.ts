// --- SSA Form & Dominator Tree Construction ---
// Implements Cooper-Harvey-Kennedy Immediate Dominator (idom) computation,
// Dominance Frontiers (DF), and minimal Phi-node placement in AssemblyScript zero-GC linear memory.

import { allocGen0 } from "../arena";
import { BasicBlock, IRInstruction, DfsStackFrame, UnmanagedUint32List, IR_INSTR_SIZE, IR_OPCODE_PHI } from "../core/ir_layout";
import { UnmanagedUint32Array } from "../core/array";

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
    let visited = changetype<UnmanagedUint32Array>(visitedMap);
    let visitedCount: u32 = 0;

    let stackTop: u32 = 0;
    let f0 = DfsStackFrame.at(stackOffset, 0);
    f0.blk = entryBlock;
    f0.phase = 0; // phase 0: discover
    stackTop = 1;

    let postIdx: u32 = 0;

    while (stackTop > 0) {
        stackTop--;
        let frame = DfsStackFrame.at(stackOffset, stackTop);
        let blk = frame.blk;
        let phase = frame.phase;
        let bb = BasicBlock.at(blk);

        if (phase == 1) {
            // Post-order finish: assign post-order index
            bb.postOrder = postIdx;
            postIdx++;
            continue;
        }

        // Check if already visited
        let alreadyVisited = false;
        for (let i: u32 = 0; i < visitedCount; i++) {
            if (visited[i] == blk) {
                alreadyVisited = true;
                break;
            }
        }
        if (alreadyVisited) continue;

        // Record visited block
        if (visitedCount < maxCapacity) {
            visited[visitedCount] = blk;
            visitedCount++;
        }

        // Push phase 1 (finish / post-order assignment)
        if (stackTop < stackCapacity) {
            let f = DfsStackFrame.at(stackOffset, stackTop);
            f.blk = blk;
            f.phase = 1;
            stackTop++;
        }

        // Push false branch
        let fBranch = bb.falseBranch;
        if (fBranch != 0 && stackTop < stackCapacity) {
            let f = DfsStackFrame.at(stackOffset, stackTop);
            f.blk = fBranch;
            f.phase = 0;
            stackTop++;
        }

        // Push true branch
        let tBranch = bb.trueBranch;
        if (tBranch != 0 && stackTop < stackCapacity) {
            let f = DfsStackFrame.at(stackOffset, stackTop);
            f.blk = tBranch;
            f.phase = 0;
            stackTop++;
        }

        // Push multi-way branch successors from successorList if present
        let succList = bb.successorList;
        if (succList != 0) {
            let succs = UnmanagedUint32List.at(succList);
            for (let s: u32 = 0; s < succs.count; s++) {
                let sBlk = succs.get(s);
                if (sBlk != 0 && stackTop < stackCapacity) {
                    let f = DfsStackFrame.at(stackOffset, stackTop);
                    f.blk = sBlk;
                    f.phase = 0;
                    stackTop++;
                }
            }
        }
    }

    ssaBlockCount = visitedCount;
    if (ssaBlockCount == 0) return 0;

    // Allocate dense RPO array
    ssaRPOOffset = allocGen0(ssaBlockCount * 4);
    let rpo = changetype<UnmanagedUint32Array>(ssaRPOOffset);

    // Build Reverse Post-Order array (rpo[0] is entryBlock with max postIdx)
    for (let i: u32 = 0; i < visitedCount; i++) {
        let blk = visited[i];
        let po = BasicBlock.at(blk).postOrder;
        let rpoIdx = ssaBlockCount - 1 - po;
        if (rpoIdx < ssaBlockCount) {
            rpo[rpoIdx] = blk;
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

    let rpo = changetype<UnmanagedUint32Array>(ssaRPOOffset);

    // Initialize all reachable dominators to 0
    for (let i: u32 = 0; i < numBlocks; i++) {
        BasicBlock.at(rpo[i]).dominator = 0;
    }

    // Set entry block dominator to itself
    BasicBlock.at(entryBlock).dominator = entryBlock;

    let changed = true;
    let iter: u32 = 0;

    while (changed && iter < 100) {
        iter++;
        changed = false;

        // Iterate in Reverse Post-Order (skipping entry block at index 0)
        for (let i: u32 = 1; i < numBlocks; i++) {
            let b = rpo[i];
            let bb = BasicBlock.at(b);
            let newIdom: u32 = 0;

            // Iterate predecessors of b
            for (let j: u32 = 0; j < numBlocks; j++) {
                let p = rpo[j];
                let pb = BasicBlock.at(p);
                let isPred = (pb.trueBranch == b || pb.falseBranch == b);

                if (!isPred) {
                    let succList = pb.successorList;
                    if (succList != 0) {
                        let succs = UnmanagedUint32List.at(succList);
                        for (let s: u32 = 0; s < succs.count; s++) {
                            if (succs.get(s) == b) {
                                isPred = true;
                                break;
                            }
                        }
                    }
                }

                if (isPred) {
                    let domP = pb.dominator;
                    if (domP != 0) { // Predecessor has an established dominator
                        if (newIdom == 0) {
                            newIdom = p;
                        } else {
                            newIdom = intersectDominator(p, newIdom, entryBlock);
                        }
                    }
                }
            }

            let currentDom = bb.dominator;
            if (newIdom != 0 && newIdom != currentDom) {
                bb.dominator = newIdom;
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
        let po1 = BasicBlock.at(finger1).postOrder;
        let po2 = BasicBlock.at(finger2).postOrder;

        while (po1 < po2 && finger1 != entryBlock && finger1 != 0) {
            let nextDom = BasicBlock.at(finger1).dominator;
            if (nextDom == finger1 || nextDom == 0) break;
            finger1 = nextDom;
            po1 = BasicBlock.at(finger1).postOrder;
        }
        while (po2 < po1 && finger2 != entryBlock && finger2 != 0) {
            let nextDom = BasicBlock.at(finger2).dominator;
            if (nextDom == finger2 || nextDom == 0) break;
            finger2 = nextDom;
            po2 = BasicBlock.at(finger2).postOrder;
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

    let rpo = changetype<UnmanagedUint32Array>(ssaRPOOffset);

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
        let b = rpo[i];
        let idomB = BasicBlock.at(b).dominator;

        // Check each predecessor p of b
        for (let j: u32 = 0; j < numBlocks; j++) {
            let p = rpo[j];
            let pb = BasicBlock.at(p);
            let isPred = (pb.trueBranch == b || pb.falseBranch == b);

            if (isPred) {
                let runner = p;
                while (runner != 0 && runner != idomB && runner != entryBlock) {
                    addBlockToDF(runner, b);
                    let nextRunner = BasicBlock.at(runner).dominator;
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
    let rpo = changetype<UnmanagedUint32Array>(ssaRPOOffset);
    for (let i: u32 = 0; i < ssaBlockCount; i++) {
        if (rpo[i] == blockPtr) {
            rpoIdx = i;
            found = true;
            break;
        }
    }
    if (!found || ssaDFOffset == 0) return;

    let ssaDF = changetype<UnmanagedUint32Array>(ssaDFOffset);
    let listPtr = ssaDF[rpoIdx];
    if (listPtr == 0) return;

    let list = UnmanagedUint32List.at(listPtr);
    if (!list.contains(dfTargetBlock)) {
        list.push(dfTargetBlock);
    }
}

/**
 * Returns the Dominance Frontier list pointer [count, cap, item0, ...] for a given block.
 */
export function getDominanceFrontier(blockPtr: u32): u32 {
    if (ssaDFOffset == 0 || ssaBlockCount == 0) return 0;
    let rpo = changetype<UnmanagedUint32Array>(ssaRPOOffset);
    let ssaDF = changetype<UnmanagedUint32Array>(ssaDFOffset);
    for (let i: u32 = 0; i < ssaBlockCount; i++) {
        if (rpo[i] == blockPtr) {
            return ssaDF[i];
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

    let ssaDF = changetype<UnmanagedUint32Array>(ssaDFOffset);

    // For all blocks with non-empty dominance frontiers, insert Phi instructions
    for (let i: u32 = 0; i < numBlocks; i++) {
        let listPtr = ssaDF[i];
        if (listPtr == 0) continue;
        let list = UnmanagedUint32List.at(listPtr);

        for (let j: u32 = 0; j < list.count; j++) {
            let targetBlk = list.get(j);
            if (targetBlk == 0) continue;

            let target = BasicBlock.at(targetBlk);
            let firstInstr = target.firstInstr;
            let hasPhi = false;
            let curr = firstInstr;
            while (curr != 0) {
                let instr = IRInstruction.at(curr);
                if (instr.opcode == <u16>IR_OPCODE_PHI) {
                    hasPhi = true;
                    break;
                }
                curr = instr.nextInstr;
            }

            if (!hasPhi) {
                // Allocate and prepend Phi node instruction
                let phiInstr = allocGen0(IR_INSTR_SIZE);
                if (phiInstr != 0) {
                    let phi = IRInstruction.at(phiInstr);
                    phi.opcode = <u16>IR_OPCODE_PHI;
                    phi.typeId = 0;
                    phi.operand1 = 0;
                    phi.operand2 = 0;
                    phi.nextInstr = firstInstr;

                    target.firstInstr = phiInstr;
                    if (target.lastInstr == 0) {
                        target.lastInstr = phiInstr;
                    }
                }
            }
        }
    }
}

