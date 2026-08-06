import { LanguageOptions } from "../dsl.js";

export function generateAdJacobian(grammarDef: LanguageOptions, normalized: any): string {
  if (!(grammarDef as any).acausal && (grammarDef as any).name !== "Calc") return "";

  return `
// --- AD Jacobian & Hessian Sparsity Extraction (Phase 4) ---
// Variables are identified by their AST node pointers.
// All data structures use the arena allocator (zero-GC).

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

export function computeDependencies(eqnAst: u32, eqnIdx: u32, varMappingsPtr: u32, numMappings: u32): void {
    if (eqnAst == 0) return;
    let type = getNodeType(eqnAst);
    
    if (type == <u16>SyntaxType.IDENTIFIER || type == 10) {
        let varIdx = lookupVarIdx(eqnAst);
        if (varIdx != 0xFFFFFFFF) {
            setDependency(eqnIdx, varIdx);
        }
    }
    
    let child = getNodeFirstChild(eqnAst);
    while (child != 0) {
        computeDependencies(child, eqnIdx, varMappingsPtr, numMappings);
        child = getNodeNextSibling(child);
    }
}

export function computeJacobianCCS(eqnsPtr: u32, numEqns: u32, numVars: u32, varMappingsPtr: u32, numMappings: u32, varFirstNodePtr: u32): u32 {
    if (numEqns == 0 || numVars == 0) {
        let resultStruct = arenaOffset;
        arenaOffset += 16;
        store<u32>(resultStruct, 0);
        store<u32>(resultStruct + 4, 0);
        store<u32>(resultStruct + 8, 0);
        store<u32>(resultStruct + 12, 0);
        return resultStruct;
    }

    initVarHashTable(varMappingsPtr, numMappings);
    initDependencies(numVars, numEqns);
    
    for (let i: u32 = 0; i < numEqns; i++) {
        let eqnNode = load<u32>(eqnsPtr + i * 4);
        computeDependencies(eqnNode, i, varMappingsPtr, numMappings);
    }
    
    let colPtrOffset = arenaOffset;
    arenaOffset += (numVars + 1) * 4;
    
    let nnz: u32 = 0;
    store<u32>(colPtrOffset, 0);
    
    for (let j: u32 = 0; j < numVars; j++) {
        for (let i: u32 = 0; i < numEqns; i++) {
            if (hasDependency(i, j)) {
                nnz++;
            }
        }
        store<u32>(colPtrOffset + (j + 1) * 4, nnz);
    }
    
    let rowIdxOffset = arenaOffset;
    arenaOffset += nnz * 4;
    
    let valuesOffset = arenaOffset;
    arenaOffset += nnz * 4;
    
    let currentK: u32 = 0;
    
    for (let j: u32 = 0; j < numVars; j++) {
        let varNode = load<u32>(varFirstNodePtr + j * 4);
        for (let i: u32 = 0; i < numEqns; i++) {
            if (hasDependency(i, j)) {
                let eqnNode = load<u32>(eqnsPtr + i * 4);
                let deriv = transform_tangent(eqnNode, varNode);
                store<u32>(rowIdxOffset + currentK * 4, i);
                store<u32>(valuesOffset + currentK * 4, deriv);
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

function isNonLinear(nodeType: u16): boolean {
    return nodeType == 8
        || nodeType == 9
        || nodeType == 22
        || nodeType == 23
        || nodeType == 24
        || nodeType == 25
        || nodeType == 26
        || nodeType == 27
        || nodeType == 28;
}

let nodeVarSetOffset: u32 = 0;
let varSetWordsPerNode: u32 = 0;
let hessianBitsetOffset: u32 = 0;

function initHessianBitset(numVars: u32): void {
    let totalBits = (numVars * (numVars + 1)) / 2;
    let totalWords = (totalBits + 31) >> 5;
    hessianBitsetOffset = arenaOffset;
    arenaOffset += totalWords * 4;
    for (let i: u32 = 0; i < totalWords; i++) {
        store<u32>(hessianBitsetOffset + i * 4, 0);
    }
}

function hessianBitIndex(row: u32, col: u32): u32 {
    return (row * (row + 1)) / 2 + col;
}

function setHessianEntry(row: u32, col: u32): void {
    let r = row; let c = col;
    if (c > r) { let tmp = r; r = c; c = tmp; }
    let idx = hessianBitIndex(r, c);
    let wordIdx = idx >> 5;
    let bitIdx = idx & 31;
    let current = load<u32>(hessianBitsetOffset + wordIdx * 4);
    store<u32>(hessianBitsetOffset + wordIdx * 4, current | (1 << bitIdx));
}

function hasHessianEntry(row: u32, col: u32): boolean {
    let r = row; let c = col;
    if (c > r) { let tmp = r; r = c; c = tmp; }
    let idx = hessianBitIndex(r, c);
    let wordIdx = idx >> 5;
    let bitIdx = idx & 31;
    let current = load<u32>(hessianBitsetOffset + wordIdx * 4);
    return (current & (1 << bitIdx)) != 0;
}

let varSetPoolOffset: u32 = 0;
let varSetPoolTop: u32 = 0;

function initVarSetPool(numVars: u32, maxNodes: u32): void {
    varSetWordsPerNode = (numVars + 31) >> 5;
    let poolSize = maxNodes < 4096 ? maxNodes : 4096;
    varSetPoolOffset = arenaOffset;
    arenaOffset += poolSize * varSetWordsPerNode * 4;
    varSetPoolTop = 0;
    let totalBytes = poolSize * varSetWordsPerNode * 4;
    for (let i: u32 = 0; i < totalBytes / 4; i++) {
        store<u32>(varSetPoolOffset + i * 4, 0);
    }
}

function allocVarSet(): u32 {
    let offset = varSetPoolOffset + varSetPoolTop * varSetWordsPerNode * 4;
    for (let i: u32 = 0; i < varSetWordsPerNode; i++) {
        store<u32>(offset + i * 4, 0);
    }
    varSetPoolTop++;
    return offset;
}

function freeVarSet(): void {
    if (varSetPoolTop > 0) varSetPoolTop--;
}

function varSetUnion(dst: u32, src: u32): void {
    for (let i: u32 = 0; i < varSetWordsPerNode; i++) {
        let d = load<u32>(dst + i * 4);
        let s = load<u32>(src + i * 4);
        store<u32>(dst + i * 4, d | s);
    }
}

function varSetSetBit(set: u32, varIdx: u32): void {
    let wordIdx = varIdx >> 5;
    let bitIdx = varIdx & 31;
    let current = load<u32>(set + wordIdx * 4);
    store<u32>(set + wordIdx * 4, current | (1 << bitIdx));
}

function varSetHasBit(set: u32, varIdx: u32): boolean {
    let wordIdx = varIdx >> 5;
    let bitIdx = varIdx & 31;
    return (load<u32>(set + wordIdx * 4) & (1 << bitIdx)) != 0;
}

function propagateVarSets(node: u32, numVars: u32): u32 {
    if (node == 0) return allocVarSet();

    let type = getNodeType(node);

    if (type == 20) {
        return allocVarSet();
    }

    if (type == <u16>SyntaxType.IDENTIFIER || type == 10) {
        let vs = allocVarSet();
        let varIdx = lookupVarIdx(node);
        if (varIdx != 0xFFFFFFFF && varIdx < numVars) {
            varSetSetBit(vs, varIdx);
        }
        return vs;
    }

    let mySet = allocVarSet();
    let childSetCount: u32 = 0;

    let child = getNodeFirstChild(node);
    while (child != 0) {
        let childVs = propagateVarSets(child, numVars);
        
        if (isNonLinear(type)) {
            if (childSetCount > 0) {
                for (let j: u32 = 0; j < numVars; j++) {
                    if (!varSetHasBit(mySet, j)) continue;
                    for (let k: u32 = 0; k < numVars; k++) {
                        if (varSetHasBit(childVs, k)) {
                            setHessianEntry(j, k);
                        }
                    }
                }
            }
            childSetCount++;
        }

        if (isNonLinear(type) && getNodeNextSibling(child) == 0 && childSetCount == 1) {
            for (let j: u32 = 0; j < numVars; j++) {
                if (varSetHasBit(childVs, j)) {
                    setHessianEntry(j, j);
                }
            }
        }

        varSetUnion(mySet, childVs);
        freeVarSet();

        child = getNodeNextSibling(child);
    }

    return mySet;
}

export function computeHessianCCS(eqnsPtr: u32, numEqns: u32, numVars: u32, varMappingsPtr: u32, numMappings: u32, varFirstNodePtr: u32): u32 {
    if (numEqns == 0 || numVars == 0) {
        let resultStruct = arenaOffset;
        arenaOffset += 16;
        store<u32>(resultStruct, 0);
        store<u32>(resultStruct + 4, 0);
        store<u32>(resultStruct + 8, 0);
        store<u32>(resultStruct + 12, 0);
        return resultStruct;
    }

    if (varHashTableCapacity == 0) {
        initVarHashTable(varMappingsPtr, numMappings);
    }

    initHessianBitset(numVars);
    let estimatedNodes = numEqns * 200;
    initVarSetPool(numVars, estimatedNodes);

    for (let i: u32 = 0; i < numEqns; i++) {
        let eqnNode = load<u32>(eqnsPtr + i * 4);
        varSetPoolTop = 0;
        propagateVarSets(eqnNode, numVars);
    }

    let colPtrOffsetH = arenaOffset;
    arenaOffset += (numVars + 1) * 4;

    let nnzH: u32 = 0;
    store<u32>(colPtrOffsetH, 0);

    for (let j: u32 = 0; j < numVars; j++) {
        for (let i: u32 = j; i < numVars; i++) {
            if (hasHessianEntry(i, j)) {
                nnzH++;
            }
        }
        store<u32>(colPtrOffsetH + (j + 1) * 4, nnzH);
    }

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
`;
}
