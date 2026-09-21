// --- EGraph Engine (Zero-GC) ---
// Implements zero-GC union-find, dense e-node arrays, hash-consing deduplication, and e-graph rebuilding.

import { atomicChunkAlloc, getNodeType, getNodeFirstChild, getNodeNextSibling, allocNode } from "../arena";
import { DaeBuilder } from "../dae";

export const MAX_ECLASSES: u32 = 65536;
export const MAX_ENODES: u32 = 65536;
export const HASH_CAPACITY: u32 = 65536; // Power of 2
export const HASH_MASK: u32 = HASH_CAPACITY - 1;
export const EMPTY_KEY: u64 = 0xFFFFFFFFFFFFFFFF;

export function unwrapNode(node: u32): u32 {
    return node;
}

// --- Union-Find Disjoint Set ---
let ufParentOffset: u32 = 0;
let ufRankOffset: u32 = 0;
export let ufCount: u32 = 0;

export function initEGraph(): void {
    if (ufParentOffset == 0) {
        ufParentOffset = atomicChunkAlloc(MAX_ECLASSES * 4);
        ufRankOffset = atomicChunkAlloc(MAX_ECLASSES);
    }
    ufCount = 0;
}

export function ufMakeSet(): u32 {
    if (ufCount >= MAX_ECLASSES) return 0xFFFFFFFF;
    let id = ufCount++;
    store<u32>(ufParentOffset + id * 4, id);
    store<u8>(ufRankOffset + id, 0);
    return id;
}

export function ufFind(x: u32): u32 {
    if (x >= MAX_ECLASSES || x == 0xFFFFFFFF || ufParentOffset == 0) return x;
    let root = x;
    while (true) {
        let parent = load<u32>(ufParentOffset + root * 4);
        if (parent == root || parent >= MAX_ECLASSES) break;
        root = parent;
    }
    let curr = x;
    while (curr != root && curr < MAX_ECLASSES) {
        let nxt = load<u32>(ufParentOffset + curr * 4);
        store<u32>(ufParentOffset + curr * 4, root);
        curr = nxt;
    }
    return root;
}

export function ufUnion(a: u32, b: u32): u32 {
    let rootA = ufFind(a);
    let rootB = ufFind(b);
    if (rootA == rootB) return rootA;
    let rankA = load<u8>(ufRankOffset + rootA);
    let rankB = load<u8>(ufRankOffset + rootB);
    if (rankA < rankB) {
        store<u32>(ufParentOffset + rootA * 4, rootB);
        return rootB;
    } else if (rankA > rankB) {
        store<u32>(ufParentOffset + rootB * 4, rootA);
        return rootA;
    } else {
        store<u32>(ufParentOffset + rootB * 4, rootA);
        store<u8>(ufRankOffset + rootA, rankA + 1);
        return rootA;
    }
}

// --- Dense E-Node Storage & Hash-Consing Deduplication Table ---
export let eNodeKeysOffset: u32 = 0;
export let eNodeClassesOffset: u32 = 0;
export let eNodeCount: u32 = 0;

let hashKeysOffset: u32 = 0;
let hashValsOffset: u32 = 0;
export let hashOccupied: u32 = 0;

export function initHashCons(): void {
    if (hashKeysOffset == 0) {
        hashKeysOffset = atomicChunkAlloc(HASH_CAPACITY * 8);
        hashValsOffset = atomicChunkAlloc(HASH_CAPACITY * 4);
        eNodeKeysOffset = atomicChunkAlloc(MAX_ENODES * 8);
        eNodeClassesOffset = atomicChunkAlloc(MAX_ENODES * 4);
    }
    eNodeCount = 0;
    hashOccupied = 0;
    // Set all key slots to EMPTY_KEY sentinel (0xFFFFFFFFFFFFFFFF)
    memory.fill(hashKeysOffset, 0xFF, HASH_CAPACITY * 8);
}

export function hashProbe(key: u64): u32 {
    let h = (key ^ (key >> 32)) as u32;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = ((h >> 16) ^ h);
    return h & HASH_MASK;
}

export function hashFind(key: u64): u32 {
    let slot = hashProbe(key);
    let guard: u32 = 0;
    while (guard < HASH_CAPACITY) {
        let storedKey = load<u64>(hashKeysOffset + slot * 8);
        if (storedKey == EMPTY_KEY) return 0xFFFFFFFF; // Empty slot
        if (storedKey == key) return load<u32>(hashValsOffset + slot * 4);
        slot = (slot + 1) & HASH_MASK;
        guard++;
    }
    return 0xFFFFFFFF;
}

export function hashInsert(key: u64, val: u32): void {
    let slot = hashProbe(key);
    let guard: u32 = 0;
    while (guard < HASH_CAPACITY) {
        let storedKey = load<u64>(hashKeysOffset + slot * 8);
        if (storedKey == EMPTY_KEY) {
            store<u64>(hashKeysOffset + slot * 8, key);
            store<u32>(hashValsOffset + slot * 4, val);
            if (eNodeCount < MAX_ENODES) {
                store<u64>(eNodeKeysOffset + eNodeCount * 8, key);
                store<u32>(eNodeClassesOffset + eNodeCount * 4, val);
                eNodeCount++;
            }
            hashOccupied++;
            return;
        }
        if (storedKey == key) {
            store<u32>(hashValsOffset + slot * 4, val);
            return;
        }
        slot = (slot + 1) & HASH_MASK;
        guard++;
    }
}

export function rebuildEGraph(): void {
    memory.fill(hashKeysOffset, 0xFF, HASH_CAPACITY * 8);
    hashOccupied = 0;
    let writeIdx: u32 = 0;
    for (let i: u32 = 0; i < eNodeCount; i++) {
        let key = load<u64>(eNodeKeysOffset + i * 8);
        let eClass = ufFind(load<u32>(eNodeClassesOffset + i * 4));
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
            let slot = hashProbe(key);
            let guard: u32 = 0;
            while (guard < HASH_CAPACITY) {
                let storedKey = load<u64>(hashKeysOffset + slot * 8);
                if (storedKey == EMPTY_KEY) {
                    store<u64>(hashKeysOffset + slot * 8, key);
                    store<u32>(hashValsOffset + slot * 4, eClass);
                    hashOccupied++;
                    break;
                }
                slot = (slot + 1) & HASH_MASK;
                guard++;
            }
            store<u64>(eNodeKeysOffset + writeIdx * 8, key);
            store<u32>(eNodeClassesOffset + writeIdx * 4, eClass);
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
