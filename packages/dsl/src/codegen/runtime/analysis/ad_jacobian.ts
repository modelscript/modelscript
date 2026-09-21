// --- AD Jacobian & Hessian Sparsity Extraction (Phase 4) ---
// Variables are identified by their AST node pointers.
// All data structures use the arena allocator (zero-GC).

import { getNodeFirstChild, getNodeNextSibling, getNodeType } from "../arena";

export let arenaOffset: u32 = 0;

// ========================================================================
// Dependency Bitset — tracks which variables appear in each equation
// ========================================================================

let depsBitsetOffset: u32 = 0;
let depsWordsPerEqn: u32 = 0;

export function initDependencies(numVars: u32, numEqns: u32): void {
    depsWordsPerEqn = (numVars + 31) >> 5;
    depsBitsetOffset = arenaOffset;
    let totalWords = depsWordsPerEqn * numEqns;
    arenaOffset += totalWords * 4;
    for (let i: u32 = 0; i < totalWords; i++) {
        store<u32>(depsBitsetOffset + i * 4, 0);
    }
}

function setDependency(eqnIdx: u32, varIdx: u32): void {
    let wordIdx = eqnIdx * depsWordsPerEqn + (varIdx >> 5);
    let bitIdx = varIdx & 31;
    let current = load<u32>(depsBitsetOffset + wordIdx * 4);
    store<u32>(depsBitsetOffset + wordIdx * 4, current | (1 << bitIdx));
}

function hasDependency(eqnIdx: u32, varIdx: u32): boolean {
    let wordIdx = eqnIdx * depsWordsPerEqn + (varIdx >> 5);
    let bitIdx = varIdx & 31;
    let current = load<u32>(depsBitsetOffset + wordIdx * 4);
    return (current & (1 << bitIdx)) != 0;
}

// ========================================================================
// Variable Lookup — hash table for O(1) nodePtr → varIdx resolution
// ========================================================================

let varHashTableOffset: u32 = 0;
let varHashTableCapacity: u32 = 0;

function fnvHashPtr(ptr: u32): u32 {
    let h: u32 = 0x811c9dc5;
    h ^= ptr & 0xFF;        h = (h * 0x01000193) >>> 0;
    h ^= (ptr >> 8) & 0xFF; h = (h * 0x01000193) >>> 0;
    h ^= (ptr >> 16) & 0xFF; h = (h * 0x01000193) >>> 0;
    h ^= (ptr >> 24) & 0xFF; h = (h * 0x01000193) >>> 0;
    return h;
}

function initVarHashTable(varMappingsPtr: u32, numMappings: u32): void {
    varHashTableCapacity = numMappings < 4 ? 8 : numMappings * 2;
    let cap = varHashTableCapacity;
    cap--;
    cap |= cap >> 1; cap |= cap >> 2; cap |= cap >> 4;
    cap |= cap >> 8; cap |= cap >> 16;
    cap++;
    varHashTableCapacity = cap;

    varHashTableOffset = arenaOffset;
    arenaOffset += varHashTableCapacity * 8;

    for (let i: u32 = 0; i < varHashTableCapacity; i++) {
        store<u32>(varHashTableOffset + i * 8, 0);
        store<u32>(varHashTableOffset + i * 8 + 4, 0xFFFFFFFF);
    }

    let mask = varHashTableCapacity - 1;
    for (let v: u32 = 0; v < numMappings; v++) {
        let vNode = load<u32>(varMappingsPtr + v * 8);
        let varIdx = load<u32>(varMappingsPtr + v * 8 + 4);
        if (vNode == 0) continue;
        let slot = fnvHashPtr(vNode) & mask;
        while (load<u32>(varHashTableOffset + slot * 8) != 0) {
            slot = (slot + 1) & mask;
        }
        store<u32>(varHashTableOffset + slot * 8, vNode);
        store<u32>(varHashTableOffset + slot * 8 + 4, varIdx);
    }
}

function lookupVarIdx(nodePtr: u32): u32 {
    if (nodePtr == 0 || varHashTableCapacity == 0) return 0xFFFFFFFF;
    let mask = varHashTableCapacity - 1;
    let slot = fnvHashPtr(nodePtr) & mask;
    while (true) {
        let key = load<u32>(varHashTableOffset + slot * 8);
        if (key == 0) return 0xFFFFFFFF;
        if (key == nodePtr) return load<u32>(varHashTableOffset + slot * 8 + 4);
        slot = (slot + 1) & mask;
    }
}

// ========================================================================
// AST Variable Harvester (Tree Traversal)
// ========================================================================

function harvestVariables(nodeId: u32, eqnIdx: u32): void {
    let varIdx = lookupVarIdx(nodeId);
    if (varIdx != 0xFFFFFFFF) {
        setDependency(eqnIdx, varIdx);
    }

    let child = getNodeFirstChild(nodeId);
    while (child != 0) {
        harvestVariables(child, eqnIdx);
        child = getNodeNextSibling(child);
    }
}

// ========================================================================
// Main Entry Point: Build Sparse Jacobian Pattern in CCS Format
// ========================================================================

export function buildJacobianSparsity(
    equationRootsPtr: u32,
    numEqns: u32,
    varMappingsPtr: u32,
    numVars: u32
): u32 {
    if (numEqns == 0 || numVars == 0) {
        let emptyResult = arenaOffset;
        arenaOffset += 16;
        store<u32>(emptyResult, 0);
        store<u32>(emptyResult + 4, 0);
        store<u32>(emptyResult + 8, 0);
        store<u32>(emptyResult + 12, 0);
        return emptyResult;
    }

    initDependencies(numVars, numEqns);
    initVarHashTable(varMappingsPtr, numVars);

    for (let e: u32 = 0; e < numEqns; e++) {
        let eqNode = load<u32>(equationRootsPtr + e * 4);
        if (eqNode != 0) {
            harvestVariables(eqNode, e);
        }
    }

    let colPtrOffset = arenaOffset;
    arenaOffset += (numVars + 1) * 4;

    let nnz: u32 = 0;
    for (let j: u32 = 0; j < numVars; j++) {
        store<u32>(colPtrOffset + j * 4, nnz);
        for (let i: u32 = 0; i < numEqns; i++) {
            if (hasDependency(i, j)) {
                nnz++;
            }
        }
    }
    store<u32>(colPtrOffset + numVars * 4, nnz);

    let rowIdxOffset = arenaOffset;
    arenaOffset += nnz * 4;

    let valuesOffset = arenaOffset;
    arenaOffset += nnz * 4;

    let currentK: u32 = 0;
    for (let j: u32 = 0; j < numVars; j++) {
        for (let i: u32 = 0; i < numEqns; i++) {
            if (hasDependency(i, j)) {
                store<u32>(rowIdxOffset + currentK * 4, i);
                store<f32>(valuesOffset + currentK * 4, 1.0);
                currentK++;
            }
        }
    }

    let resultStruct = arenaOffset;
    arenaOffset += 16;
    store<u32>(resultStruct, nnz);
    store<u32>(resultStruct + 4, colPtrOffset);
    store<u32>(resultStruct + 8, rowIdxOffset);
    store<u32>(resultStruct + 12, valuesOffset);

    return resultStruct;
}

// ========================================================================
// Phase 4.2: Hessian Sparsity Extraction via Expression Variable-Set Propagation
// ========================================================================

let hessianBitsetOffset: u32 = 0;
let hessianWordsPerVar: u32 = 0;

export function initHessian(numVars: u32): void {
    hessianWordsPerVar = (numVars + 31) >> 5;
    hessianBitsetOffset = arenaOffset;
    let totalWords = hessianWordsPerVar * numVars;
    arenaOffset += totalWords * 4;
    for (let i: u32 = 0; i < totalWords; i++) {
        store<u32>(hessianBitsetOffset + i * 4, 0);
    }
}

function setHessianEntry(varIdx1: u32, varIdx2: u32): void {
    let wordIdx1 = varIdx1 * hessianWordsPerVar + (varIdx2 >> 5);
    let bitIdx1 = varIdx2 & 31;
    let cur1 = load<u32>(hessianBitsetOffset + wordIdx1 * 4);
    store<u32>(hessianBitsetOffset + wordIdx1 * 4, cur1 | (1 << bitIdx1));

    let wordIdx2 = varIdx2 * hessianWordsPerVar + (varIdx1 >> 5);
    let bitIdx2 = varIdx1 & 31;
    let cur2 = load<u32>(hessianBitsetOffset + wordIdx2 * 4);
    store<u32>(hessianBitsetOffset + wordIdx2 * 4, cur2 | (1 << bitIdx2));
}

function hasHessianEntry(varIdx1: u32, varIdx2: u32): boolean {
    let wordIdx = varIdx1 * hessianWordsPerVar + (varIdx2 >> 5);
    let bitIdx = varIdx2 & 31;
    let cur = load<u32>(hessianBitsetOffset + wordIdx * 4);
    return (cur & (1 << bitIdx)) != 0;
}

// Variable-set pool for AST nodes (scratch space in arena)
let varSetPoolOffset: u32 = 0;
let varSetWordsPerNode: u32 = 0;

function initVarSetPool(numVars: u32, poolSize: u32): void {
    varSetWordsPerNode = (numVars + 31) >> 5;
    varSetPoolOffset = arenaOffset;
    arenaOffset += poolSize * varSetWordsPerNode * 4;
}

function getVarSetPtr(slotIdx: u32): u32 {
    return varSetPoolOffset + slotIdx * varSetWordsPerNode * 4;
}

function clearVarSet(setPtr: u32): void {
    for (let i: u32 = 0; i < varSetWordsPerNode; i++) {
        store<u32>(setPtr + i * 4, 0);
    }
}

function addVarToSet(setPtr: u32, varIdx: u32): void {
    let wordIdx = varIdx >> 5;
    let bitIdx = varIdx & 31;
    let cur = load<u32>(setPtr + wordIdx * 4);
    store<u32>(setPtr + wordIdx * 4, cur | (1 << bitIdx));
}

function unionVarSets(destPtr: u32, srcPtr: u32): void {
    for (let i: u32 = 0; i < varSetWordsPerNode; i++) {
        let d = load<u32>(destPtr + i * 4);
        let s = load<u32>(srcPtr + i * 4);
        store<u32>(destPtr + i * 4, d | s);
    }
}

// Cross-product of two variable sets — records cross-derivatives d2f/(dx_i dx_j)
function crossProductVarSets(set1Ptr: u32, set2Ptr: u32, numVars: u32): void {
    for (let w1: u32 = 0; w1 < varSetWordsPerNode; w1++) {
        let word1 = load<u32>(set1Ptr + w1 * 4);
        if (word1 == 0) continue;
        for (let b1: u32 = 0; b1 < 32; b1++) {
            if ((word1 & (1 << b1)) != 0) {
                let v1 = w1 * 32 + b1;
                if (v1 >= numVars) break;

                for (let w2: u32 = 0; w2 < varSetWordsPerNode; w2++) {
                    let word2 = load<u32>(set2Ptr + w2 * 4);
                    if (word2 == 0) continue;
                    for (let b2: u32 = 0; b2 < 32; b2++) {
                        if ((word2 & (1 << b2)) != 0) {
                            let v2 = w2 * 32 + b2;
                            if (v2 >= numVars) break;
                            setHessianEntry(v1, v2);
                        }
                    }
                }
            }
        }
    }
}

// Bottom-up AST propagation to detect non-linear interactions
function propagateHessian(nodeId: u32, outSetPtr: u32, numVars: u32, scratchSlot: u32): void {
    clearVarSet(outSetPtr);

    let vIdx = lookupVarIdx(nodeId);
    if (vIdx != 0xFFFFFFFF) {
        addVarToSet(outSetPtr, vIdx);
        return;
    }

    let childCount: u32 = 0;
    let child = getNodeFirstChild(nodeId);
    let childSetsPtr = getVarSetPtr(scratchSlot);

    while (child != 0 && childCount < 8) {
        let childSet = childSetsPtr + childCount * varSetWordsPerNode * 4;
        propagateHessian(child, childSet, numVars, scratchSlot + childCount + 1);
        unionVarSets(outSetPtr, childSet);
        childCount++;
        child = getNodeNextSibling(child);
    }

    let nodeType = getNodeType(nodeId);
    let isNonlinear = (childCount >= 2);

    if (isNonlinear) {
        for (let i: u32 = 0; i < childCount; i++) {
            let setI = childSetsPtr + i * varSetWordsPerNode * 4;
            for (let j: u32 = i + 1; j < childCount; j++) {
                let setJ = childSetsPtr + j * varSetWordsPerNode * 4;
                crossProductVarSets(setI, setJ, numVars);
            }
        }
    }
}

export function buildHessianSparsity(
    equationRootsPtr: u32,
    numEqns: u32,
    varMappingsPtr: u32,
    numVars: u32
): u32 {
    if (numEqns == 0 || numVars == 0) {
        let emptyResult = arenaOffset;
        arenaOffset += 16;
        store<u32>(emptyResult, 0);
        store<u32>(emptyResult + 4, 0);
        store<u32>(emptyResult + 8, 0);
        store<u32>(emptyResult + 12, 0);
        return emptyResult;
    }

    initHessian(numVars);
    initVarHashTable(varMappingsPtr, numVars);
    initVarSetPool(numVars, 32);

    let topSetPtr = getVarSetPtr(30);

    for (let e: u32 = 0; e < numEqns; e++) {
        let eqNode = load<u32>(equationRootsPtr + e * 4);
        if (eqNode != 0) {
            propagateHessian(eqNode, topSetPtr, numVars, 0);
        }
    }

    let colPtrOffsetH = arenaOffset;
    arenaOffset += (numVars + 1) * 4;

    let nnzH: u32 = 0;
    for (let j: u32 = 0; j < numVars; j++) {
        store<u32>(colPtrOffsetH + j * 4, nnzH);
        for (let i: u32 = j; i < numVars; i++) {
            if (hasHessianEntry(i, j)) {
                nnzH++;
            }
        }
    }
    store<u32>(colPtrOffsetH + numVars * 4, nnzH);

    let rowIdxOffsetH = arenaOffset;
    arenaOffset += nnzH * 4;

    let currentK: u32 = 0;
    for (let j: u32 = 0; j < numVars; j++) {
        for (let i: u32 = j; i < numVars; i++) {
            if (hasHessianEntry(i, j)) {
                store<u32>(rowIdxOffsetH + currentK * 4, i);
                currentK++;
            }
        }
    }

    let resultStruct = arenaOffset;
    arenaOffset += 16;
    store<u32>(resultStruct, nnzH);
    store<u32>(resultStruct + 4, colPtrOffsetH);
    store<u32>(resultStruct + 8, rowIdxOffsetH);
    store<u32>(resultStruct + 12, 0);

    return resultStruct;
}

export function getJacobianNnz(resultPtr: u32): u32 {
    return load<u32>(resultPtr);
}
export function getJacobianColPtr(resultPtr: u32): u32 {
    return load<u32>(resultPtr + 4);
}
export function getJacobianRowIdx(resultPtr: u32): u32 {
    return load<u32>(resultPtr + 8);
}
export function getJacobianValues(resultPtr: u32): u32 {
    return load<u32>(resultPtr + 12);
}
