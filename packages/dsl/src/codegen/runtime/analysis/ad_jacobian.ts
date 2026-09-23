// --- AD Jacobian & Hessian Sparsity Extraction (Phase 4) ---
// Variables are identified by their AST node pointers.
// All data structures use the arena allocator (zero-GC).

import { getNodeFirstChild, getNodeNextSibling, getNodeType } from "../arena";
import { UnmanagedMap64 } from "../core/hashmap";
import { UnmanagedUint32Array, UnmanagedFloat32Array } from "../core/array";

export let arenaOffset: u32 = 0;

/**
 * Result structure in linear memory containing CCS format sparsity metadata (16 bytes).
 */
@unmanaged
export class SparsityPatternResult {
    nnz: u32;
    colPtrOffset: u32;
    rowIdxOffset: u32;
    valuesOffset: u32;

    @inline static at(ptr: usize): SparsityPatternResult {
        return changetype<SparsityPatternResult>(ptr);
    }

    @inline init(nnz: u32, colPtr: u32, rowIdx: u32, values: u32): void {
        this.nnz = nnz;
        this.colPtrOffset = colPtr;
        this.rowIdxOffset = rowIdx;
        this.valuesOffset = values;
    }
}

// Aliases for backwards compatibility with tests
export const computeJacobianCCS = buildJacobianSparsity;
export const computeHessianCCS = buildHessianSparsity;

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
    let bitset = changetype<UnmanagedUint32Array>(depsBitsetOffset);
    for (let i: u32 = 0; i < totalWords; i++) {
        bitset[i] = 0;
    }
}

function setDependency(eqnIdx: u32, varIdx: u32): void {
    let wordIdx = eqnIdx * depsWordsPerEqn + (varIdx >> 5);
    let bitIdx = varIdx & 31;
    let bitset = changetype<UnmanagedUint32Array>(depsBitsetOffset);
    bitset[wordIdx] = bitset[wordIdx] | (1 << bitIdx);
}

function hasDependency(eqnIdx: u32, varIdx: u32): boolean {
    let wordIdx = eqnIdx * depsWordsPerEqn + (varIdx >> 5);
    let bitIdx = varIdx & 31;
    let bitset = changetype<UnmanagedUint32Array>(depsBitsetOffset);
    return (bitset[wordIdx] & (1 << bitIdx)) != 0;
}

// ========================================================================
// Variable Lookup — hash table for O(1) nodePtr → varIdx resolution
// ========================================================================

let varMap: UnmanagedMap64 = changetype<UnmanagedMap64>(0);

export function fnvHashPtr(ptr: u32): u32 {
    let h: u32 = 0x811c9dc5;
    h ^= ptr & 0xFF;        h = (h * 0x01000193) >>> 0;
    h ^= (ptr >> 8) & 0xFF; h = (h * 0x01000193) >>> 0;
    h ^= (ptr >> 16) & 0xFF; h = (h * 0x01000193) >>> 0;
    h ^= (ptr >> 24) & 0xFF; h = (h * 0x01000193) >>> 0;
    return h;
}

export function initVarHashTable(varMappingsPtr: u32, numMappings: u32): void {
    if (varMap == changetype<UnmanagedMap64>(0)) {
        varMap = changetype<UnmanagedMap64>(UnmanagedMap64.create(numMappings < 8 ? 16 : numMappings * 2));
    } else {
        varMap.clear();
    }

    let mappings = changetype<UnmanagedUint32Array>(varMappingsPtr);
    for (let v: u32 = 0; v < numMappings; v++) {
        let vNode = mappings[v * 2];
        let varIdx = mappings[v * 2 + 1];
        if (vNode == 0) continue;
        varMap.set(vNode as u64, varIdx + 1);
    }
}

export function lookupVarIdx(nodePtr: u32): u32 {
    if (nodePtr == 0 || varMap == changetype<UnmanagedMap64>(0)) return 0xFFFFFFFF;
    let val = varMap.get(nodePtr as u64);
    if (val == 0) return 0xFFFFFFFF;
    return val - 1;
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
        let emptyRes = SparsityPatternResult.at(arenaOffset);
        arenaOffset += sizeof<SparsityPatternResult>();
        emptyRes.init(0, 0, 0, 0);
        return changetype<usize>(emptyRes) as u32;
    }

    initDependencies(numVars, numEqns);
    initVarHashTable(varMappingsPtr, numVars);

    let eqRoots = changetype<UnmanagedUint32Array>(equationRootsPtr);
    for (let e: u32 = 0; e < numEqns; e++) {
        let eqNode = eqRoots[e];
        if (eqNode != 0) {
            harvestVariables(eqNode, e);
        }
    }

    let colPtrOffset = arenaOffset;
    arenaOffset += (numVars + 1) * 4;
    let colPtr = changetype<UnmanagedUint32Array>(colPtrOffset);

    let nnz: u32 = 0;
    for (let j: u32 = 0; j < numVars; j++) {
        colPtr[j] = nnz;
        for (let i: u32 = 0; i < numEqns; i++) {
            if (hasDependency(i, j)) {
                nnz++;
            }
        }
    }
    colPtr[numVars] = nnz;

    let rowIdxOffset = arenaOffset;
    arenaOffset += nnz * 4;
    let rowIdx = changetype<UnmanagedUint32Array>(rowIdxOffset);

    let valuesOffset = arenaOffset;
    arenaOffset += nnz * 4;
    let values = changetype<UnmanagedFloat32Array>(valuesOffset);

    let currentK: u32 = 0;
    for (let j: u32 = 0; j < numVars; j++) {
        for (let i: u32 = 0; i < numEqns; i++) {
            if (hasDependency(i, j)) {
                rowIdx[currentK] = i;
                values[currentK] = 1.0;
                currentK++;
            }
        }
    }

    let resultStruct = SparsityPatternResult.at(arenaOffset);
    arenaOffset += sizeof<SparsityPatternResult>();
    resultStruct.init(nnz, colPtrOffset, rowIdxOffset, valuesOffset);

    return changetype<usize>(resultStruct) as u32;
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
    let bitset = changetype<UnmanagedUint32Array>(hessianBitsetOffset);
    for (let i: u32 = 0; i < totalWords; i++) {
        bitset[i] = 0;
    }
}

function setHessianEntry(varIdx1: u32, varIdx2: u32): void {
    let bitset = changetype<UnmanagedUint32Array>(hessianBitsetOffset);
    let wordIdx1 = varIdx1 * hessianWordsPerVar + (varIdx2 >> 5);
    let bitIdx1 = varIdx2 & 31;
    bitset[wordIdx1] = bitset[wordIdx1] | (1 << bitIdx1);

    let wordIdx2 = varIdx2 * hessianWordsPerVar + (varIdx1 >> 5);
    let bitIdx2 = varIdx1 & 31;
    bitset[wordIdx2] = bitset[wordIdx2] | (1 << bitIdx2);
}

function hasHessianEntry(varIdx1: u32, varIdx2: u32): boolean {
    let wordIdx = varIdx1 * hessianWordsPerVar + (varIdx2 >> 5);
    let bitIdx = varIdx2 & 31;
    let bitset = changetype<UnmanagedUint32Array>(hessianBitsetOffset);
    return (bitset[wordIdx] & (1 << bitIdx)) != 0;
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
    let s = changetype<UnmanagedUint32Array>(setPtr);
    for (let i: u32 = 0; i < varSetWordsPerNode; i++) {
        s[i] = 0;
    }
}

function addVarToSet(setPtr: u32, varIdx: u32): void {
    let wordIdx = varIdx >> 5;
    let bitIdx = varIdx & 31;
    let s = changetype<UnmanagedUint32Array>(setPtr);
    s[wordIdx] = s[wordIdx] | (1 << bitIdx);
}

function unionVarSets(destPtr: u32, srcPtr: u32): void {
    let d = changetype<UnmanagedUint32Array>(destPtr);
    let s = changetype<UnmanagedUint32Array>(srcPtr);
    for (let i: u32 = 0; i < varSetWordsPerNode; i++) {
        d[i] = d[i] | s[i];
    }
}

// Cross-product of two variable sets — records cross-derivatives d2f/(dx_i dx_j)
function crossProductVarSets(set1Ptr: u32, set2Ptr: u32, numVars: u32): void {
    let s1 = changetype<UnmanagedUint32Array>(set1Ptr);
    let s2 = changetype<UnmanagedUint32Array>(set2Ptr);
    for (let w1: u32 = 0; w1 < varSetWordsPerNode; w1++) {
        let word1 = s1[w1];
        if (word1 == 0) continue;
        for (let b1: u32 = 0; b1 < 32; b1++) {
            if ((word1 & (1 << b1)) != 0) {
                let v1 = w1 * 32 + b1;
                if (v1 >= numVars) break;

                for (let w2: u32 = 0; w2 < varSetWordsPerNode; w2++) {
                    let word2 = s2[w2];
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
        let emptyRes = SparsityPatternResult.at(arenaOffset);
        arenaOffset += sizeof<SparsityPatternResult>();
        emptyRes.init(0, 0, 0, 0);
        return changetype<usize>(emptyRes) as u32;
    }

    initHessian(numVars);
    initVarHashTable(varMappingsPtr, numVars);
    initVarSetPool(numVars, 32);

    let topSetPtr = getVarSetPtr(30);

    let eqRoots = changetype<UnmanagedUint32Array>(equationRootsPtr);
    for (let e: u32 = 0; e < numEqns; e++) {
        let eqNode = eqRoots[e];
        if (eqNode != 0) {
            propagateHessian(eqNode, topSetPtr, numVars, 0);
        }
    }

    let colPtrOffsetH = arenaOffset;
    arenaOffset += (numVars + 1) * 4;
    let colPtrH = changetype<UnmanagedUint32Array>(colPtrOffsetH);

    let nnzH: u32 = 0;
    for (let j: u32 = 0; j < numVars; j++) {
        colPtrH[j] = nnzH;
        for (let i: u32 = j; i < numVars; i++) {
            if (hasHessianEntry(i, j)) {
                nnzH++;
            }
        }
    }
    colPtrH[numVars] = nnzH;

    let rowIdxOffsetH = arenaOffset;
    arenaOffset += nnzH * 4;
    let rowIdxH = changetype<UnmanagedUint32Array>(rowIdxOffsetH);

    let currentK: u32 = 0;
    for (let j: u32 = 0; j < numVars; j++) {
        for (let i: u32 = j; i < numVars; i++) {
            if (hasHessianEntry(i, j)) {
                rowIdxH[currentK] = i;
                currentK++;
            }
        }
    }

    let resultStruct = SparsityPatternResult.at(arenaOffset);
    arenaOffset += sizeof<SparsityPatternResult>();
    resultStruct.init(nnzH, colPtrOffsetH, rowIdxOffsetH, 0);

    return changetype<usize>(resultStruct) as u32;
}

export function getJacobianNnz(resultPtr: u32): u32 {
    return SparsityPatternResult.at(resultPtr).nnz;
}
export function getJacobianColPtr(resultPtr: u32): u32 {
    return SparsityPatternResult.at(resultPtr).colPtrOffset;
}
export function getJacobianRowIdx(resultPtr: u32): u32 {
    return SparsityPatternResult.at(resultPtr).rowIdxOffset;
}
export function getJacobianValues(resultPtr: u32): u32 {
    return SparsityPatternResult.at(resultPtr).valuesOffset;
}
