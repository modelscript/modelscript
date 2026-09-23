// --- EGraph Engine (Zero-GC) ---
// Implements zero-GC union-find, dense e-node arrays, hash-consing deduplication, and e-graph rebuilding.

import { atomicChunkAlloc, getNodeType, getNodeFirstChild, getNodeNextSibling, allocNode } from "../arena";
import { DaeBuilder } from "../dae";
import { UnmanagedMap64 } from "../core/hashmap";
import { UnmanagedUint64Array, UnmanagedUint32Array, UnmanagedUint8Array } from "../core/array";

export const MAX_ECLASSES: u32 = 65536;
export const MAX_ENODES: u32 = 65536;
export const HASH_CAPACITY: u32 = 65536; // Power of 2
export const HASH_MASK: u32 = HASH_CAPACITY - 1;
export const EMPTY_KEY: u64 = 0xFFFFFFFFFFFFFFFF;

export function unwrapNode(node: u32): u32 {
    return node;
}

// --- Union-Find Disjoint Set ---
let ufParents: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let ufRanks: UnmanagedUint8Array = changetype<UnmanagedUint8Array>(0);
export let ufCount: u32 = 0;

export function getUfParentOffset(): u32 {
    return changetype<usize>(ufParents) as u32;
}

export function initEGraph(): void {
    if (ufParents == changetype<UnmanagedUint32Array>(0)) {
        ufParents = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MAX_ECLASSES * 4));
        ufRanks = changetype<UnmanagedUint8Array>(atomicChunkAlloc(MAX_ECLASSES));
    }
    ufCount = 0;
}

export function ufMakeSet(): u32 {
    if (ufCount >= MAX_ECLASSES) return 0xFFFFFFFF;
    let id = ufCount++;
    ufParents[id] = id;
    ufRanks[id] = 0;
    return id;
}

export function ufFind(x: u32): u32 {
    if (x >= MAX_ECLASSES || x == 0xFFFFFFFF || ufParents == changetype<UnmanagedUint32Array>(0)) return x;
    let root = x;
    while (true) {
        let parent = ufParents[root];
        if (parent == root || parent >= MAX_ECLASSES) break;
        root = parent;
    }
    let curr = x;
    while (curr != root && curr < MAX_ECLASSES) {
        let nxt = ufParents[curr];
        ufParents[curr] = root;
        curr = nxt;
    }
    return root;
}

export function ufUnion(a: u32, b: u32): u32 {
    let rootA = ufFind(a);
    let rootB = ufFind(b);
    if (rootA == rootB) return rootA;
    let rankA = ufRanks[rootA];
    let rankB = ufRanks[rootB];
    if (rankA < rankB) {
        ufParents[rootA] = rootB;
        return rootB;
    } else if (rankA > rankB) {
        ufParents[rootB] = rootA;
        return rootA;
    } else {
        ufParents[rootB] = rootA;
        ufRanks[rootA] = rankA + 1;
        return rootA;
    }
}

// --- Dense E-Node Storage & Hash-Consing Deduplication Table ---
export let eNodeKeysOffset: u32 = 0;
export let eNodeClassesOffset: u32 = 0;
export let eNodeCount: u32 = 0;

let eNodeMap: UnmanagedMap64 = changetype<UnmanagedMap64>(0);
export let hashOccupied: u32 = 0;

export function initHashCons(): void {
    if (eNodeMap == changetype<UnmanagedMap64>(0)) {
        eNodeMap = changetype<UnmanagedMap64>(UnmanagedMap64.create(HASH_CAPACITY));
        eNodeKeysOffset = atomicChunkAlloc(MAX_ENODES * 8);
        eNodeClassesOffset = atomicChunkAlloc(MAX_ENODES * 4);
    } else {
        eNodeMap.clear();
    }
    eNodeCount = 0;
    hashOccupied = 0;
}

export function hashProbe(key: u64): u32 {
    let h = (key ^ (key >> 32)) as u32;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = ((h >> 16) ^ h);
    return h & HASH_MASK;
}

export function hashFind(key: u64): u32 {
    if (eNodeMap == changetype<UnmanagedMap64>(0)) return 0xFFFFFFFF;
    let v = eNodeMap.get(key);
    if (v == 0) return 0xFFFFFFFF;
    return v - 1;
}

export function hashInsert(key: u64, val: u32): void {
    if (eNodeMap == changetype<UnmanagedMap64>(0)) initHashCons();
    let existing = eNodeMap.get(key);
    if (existing == 0) {
        eNodeMap.set(key, val + 1);
        if (eNodeCount < MAX_ENODES) {
            let eNodeKeys = changetype<UnmanagedUint64Array>(eNodeKeysOffset);
            let eNodeClasses = changetype<UnmanagedUint32Array>(eNodeClassesOffset);
            eNodeKeys[eNodeCount] = key;
            eNodeClasses[eNodeCount] = val;
            eNodeCount++;
        }
        hashOccupied++;
    } else {
        eNodeMap.set(key, val + 1);
    }
}

export function rebuildEGraph(): void {
    if (eNodeMap != changetype<UnmanagedMap64>(0)) {
        eNodeMap.clear();
    }
    hashOccupied = 0;
    let writeIdx: u32 = 0;
    let eNodeKeys = changetype<UnmanagedUint64Array>(eNodeKeysOffset);
    let eNodeClasses = changetype<UnmanagedUint32Array>(eNodeClassesOffset);

    for (let i: u32 = 0; i < eNodeCount; i++) {
        let key = eNodeKeys[i];
        let eClass = ufFind(eNodeClasses[i]);
        let op = (key >> 48) as u16;
        let left = ((key >> 24) & 0xFFFFFF) as u32;
        let right = (key & 0xFFFFFF) as u32;

        if ((op >= 1280 && op <= 1284) || (op >= 1536 && op <= 1539) || (op >= 1792 && op <= 1793)) {
            left = ufFind(left);
            right = ufFind(right);
            key = ((op as u64) << 48) | (((left & 0xFFFFFF) as u64) << 24) | ((right & 0xFFFFFF) as u64);
        } else if ((op >= 1024 && op <= 1027) || (op >= 1800 && op <= 1810)) {
            left = ufFind(left);
            key = ((op as u64) << 48) | (((left & 0xFFFFFF) as u64) << 24);
        }

        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) {
            ufUnion(eClass, existing);
        } else {
            eNodeMap.set(key, eClass + 1);
            hashOccupied++;
            eNodeKeys[writeIdx] = key;
            eNodeClasses[writeIdx] = eClass;
            writeIdx++;
        }
    }
    eNodeCount = writeIdx;
}

export function isConstant(eClass: u32, val: f64): boolean {
    let root = ufFind(eClass);
    let floatBits = reinterpret<u64>(val);
    let keyReal: u64 = ((512 as u64) << 48) | (floatBits >>> 16);
    let classReal = hashFind(keyReal);
    if (classReal != 0xFFFFFFFF && ufFind(classReal) == root) return true;
    let keyInt: u64 = ((256 as u64) << 48) | ((val as u32) & 0xFFFFFFFF);
    let classInt = hashFind(keyInt);
    if (classInt != 0xFFFFFFFF && ufFind(classInt) == root) return true;
    return false;
}

export function addENode(exprId: u32, dae: DaeBuilder): u32 {
    if (exprId == 0xFFFFFFFF) return 0xFFFFFFFF;
    let exprOffset = exprId * 4;
    let kind = dae.exprData.get(exprOffset + 0);
    let data1 = dae.exprData.get(exprOffset + 1);
    let data2 = dae.exprData.get(exprOffset + 2);

    if (kind == 0) { // Name
        let key: u64 = (data1 as u64);
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    if (kind == 1) { // IntLiteral
        let key: u64 = ((256 as u64) << 48) | ((data1 as u32) as u64);
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    if (kind == 2) { // RealLiteral
        let lo = data1 as u64;
        let hi = data2 as u64;
        let floatBits: u64 = lo | (hi << 32);
        let key: u64 = ((512 as u64) << 48) | (floatBits >>> 16);
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    if (kind == 3) { // BoolLiteral
        let key: u64 = ((768 as u64) << 48) | ((data1 != 0 ? 1 : 0) as u64);
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    if (kind == 5) { // Binary
        let leftId = dae.exprData.get(exprOffset + 2);
        let rightId = dae.exprData.get(exprOffset + 3);
        let leftClass = addENode(leftId, dae);
        let rightClass = addENode(rightId, dae);
        let opType = (kind << 8) | data1;
        let key: u64 = ((opType as u64) << 48) | (((ufFind(leftClass) & 0xFFFFFF) as u64) << 24) | ((ufFind(rightClass) & 0xFFFFFF) as u64);
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    if (kind == 6) { // Unary
        let childId = dae.exprData.get(exprOffset + 2);
        let childClass = addENode(childId, dae);
        let opType = (kind << 8) | data1;
        let key: u64 = ((opType as u64) << 48) | (((ufFind(childClass) & 0xFFFFFF) as u64) << 24);
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    if (kind == 7) { // Call
        let childId = dae.exprData.get(exprOffset + 2);
        let childClass = addENode(childId, dae);
        let opType = 1800 + (data1 as u16);
        let key: u64 = ((opType as u64) << 48) | (((ufFind(childClass) & 0xFFFFFF) as u64) << 24);
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    return 0xFFFFFFFF;
}
