// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview High-Performance Zero-GC E-Graph & Equality Saturation Engine.
 *
 * Implements a WebAssembly linear-memory E-Graph (Equivalence Graph) data structure
 * with Union-Find congruence closure, hash-consing deduplication, and invariant rebuilding.
 *
 * Academic Citations:
 *   - Nelson, G., & Oppen, D. C. (1980). "Fast decision procedures based on congruence closure."
 *     Journal of the ACM, 27(2), pp. 356–364. DOI: 10.1145/322186.322198.
 *   - Tate, R., Stepp, M., Tatlock, Z., & Lerner, S. (2009). "Equality saturation: A new approach
 *     to optimization." In Proceedings of the 36th ACM SIGPLAN-SIGACT Symposium on Principles
 *     of Programming Languages (POPL '09), pp. 264–276. DOI: 10.1145/1480881.1480915.
 *   - Willsey, M., Nandi, C., Wang, Y. R., Flatt, O., Tatlock, Z., & Panchekha, P. (2021).
 *     "egg: Fast and extensible equality saturation." In Proceedings of the 48th ACM SIGPLAN
 *     Symposium on Principles of Programming Languages (POPL '21), pp. 1–29. DOI: 10.1145/3434304.
 *
 * ModelScript Architectural Rationale:
 *   In Modelica equation lowering and symbolic simplification, traditional term rewriting systems
 *   suffer from phase-ordering issues: applying one simplification rule can destroy opportunities
 *   for subsequent rules. E-graphs simultaneously represent exponentially large equivalence
 *   classes of syntactically distinct but mathematically equivalent expressions. In ModelScript,
 *   equality saturation evaluates multiple rewriting candidates simultaneously and extracts the
 *   globally minimal expression before DAE code emission.
 *
 * Modifications:
 *   - Native WebAssembly/AssemblyScript zero-GC implementation allocated via `atomicChunkAlloc`.
 *   - Flattened unmanaged 32-bit Union-Find with rank and two-pass path compression.
 *   - Fixed power-of-two open-addressing hash table (`HASH_MASK = 65535`) for O(1) e-node deduplication.
 *   - In-place upward congruence propagation and e-graph rebuilding without intermediate heap objects.
 */

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

// --- Lossless 64-Bit Float Constant Table ---
export const MAX_FLOAT_CONSTS: u32 = 16384;
export let floatConstTableOffset: u32 = 0;
export let floatConstCount: u32 = 0;
let floatConstMap: UnmanagedMap64 = changetype<UnmanagedMap64>(0);

export function internFloatConstant(val: f64): u32 {
    if (floatConstMap == changetype<UnmanagedMap64>(0)) {
        floatConstMap = changetype<UnmanagedMap64>(UnmanagedMap64.create(MAX_FLOAT_CONSTS * 2));
        floatConstTableOffset = atomicChunkAlloc(MAX_FLOAT_CONSTS * 8);
    }
    let bits: u64 = val == 0.0 ? 0 : reinterpret<u64>(val);
    if (bits >= 0xFFFFFFFFFFFFFFFE) bits = 0x7FF8000000000000;
    let existing = floatConstMap.get(bits);
    if (existing != 0) {
        return existing - 1;
    }
    let idx = floatConstCount;
    if (idx < MAX_FLOAT_CONSTS) {
        store<u64>(floatConstTableOffset + idx * 8, bits);
        floatConstCount++;
    }
    floatConstMap.set(bits, idx + 1);
    return idx;
}

export function getFloatConstant(idx: u32): f64 {
    if (floatConstTableOffset == 0 || idx >= floatConstCount) return 0.0;
    let bits = load<u64>(floatConstTableOffset + idx * 8);
    return reinterpret<f64>(bits);
}

export function initHashCons(): void {
    if (eNodeMap == changetype<UnmanagedMap64>(0)) {
        eNodeMap = changetype<UnmanagedMap64>(UnmanagedMap64.create(HASH_CAPACITY));
        eNodeKeysOffset = atomicChunkAlloc(MAX_ENODES * 8);
        eNodeClassesOffset = atomicChunkAlloc(MAX_ENODES * 4);
    } else {
        eNodeMap.clear();
    }
    if (floatConstMap != changetype<UnmanagedMap64>(0)) {
        floatConstMap.clear();
    }
    floatConstCount = 0;
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
    let eNodeKeys = changetype<UnmanagedUint64Array>(eNodeKeysOffset);
    let eNodeClasses = changetype<UnmanagedUint32Array>(eNodeClassesOffset);
    let merged = true;

    while (merged) {
        merged = false;
        if (eNodeMap != changetype<UnmanagedMap64>(0)) {
            eNodeMap.clear();
        }
        hashOccupied = 0;
        let writeIdx: u32 = 0;

        for (let i: u32 = 0; i < eNodeCount; i++) {
            let key = eNodeKeys[i];
            let eClass = ufFind(eNodeClasses[i]);
            let op = (key >> 48) as u16;
            let left = ((key >> 24) & 0xFFFFFF) as u32;
            let right = (key & 0xFFFFFF) as u32;

            if ((op >= 1280 && op <= 1289) || (op >= 1536 && op <= 1541) || (op >= 1792 && op <= 1793) || (op >= 1811 && op <= 1821)) {
                left = ufFind(left);
                right = ufFind(right);
                key = ((op as u64) << 48) | (((left & 0xFFFFFF) as u64) << 24) | ((right & 0xFFFFFF) as u64);
            } else if ((op >= 1024 && op <= 1027) || (op >= 1800 && op <= 1810) || op == 3072) {
                left = ufFind(left);
                key = ((op as u64) << 48) | (((left & 0xFFFFFF) as u64) << 24);
            }

            let existing = hashFind(key);
            if (existing != 0xFFFFFFFF) {
                let rootExisting = ufFind(existing);
                if (eClass != rootExisting) {
                    let newRoot = ufUnion(eClass, rootExisting);
                    eNodeMap.set(key, newRoot + 1);
                    merged = true;
                }
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
}

export function isConstant(eClass: u32, val: f64): boolean {
    let root = ufFind(eClass);
    let constIdx = internFloatConstant(val);
    let keyReal: u64 = ((512 as u64) << 48) | (constIdx as u64);
    let classReal = hashFind(keyReal);
    if (classReal != 0xFFFFFFFF && ufFind(classReal) == root) return true;
    if (val == (val as i32 as f64)) {
        let keyInt: u64 = ((256 as u64) << 48) | (((val as i32) as u32) as u64);
        let classInt = hashFind(keyInt);
        if (classInt != 0xFFFFFFFF && ufFind(classInt) == root) return true;
    }
    return false;
}

/**
 * Recursively lowers a `DaeBuilder` arena expression tree (`exprId`) into the equality
 * saturation e-graph, returning the canonical Union-Find e-class ID (`u32`).
 *
 * Performs bottom-up hash-consing using a 64-bit packed key:
 * - Upper 16 bits (`bits 48..63`): operator/literal tag `opType` (`0` for Name, `256` for IntLiteral,
 *   `512` for RealLiteral, `768` for BoolLiteral, `(kind << 8) | op` for Binary/Unary, `1800 + fnId` for Call).
 * - Middle 24 bits (`bits 24..47`): canonical left/first child e-class ID (`ufFind(left) & 0xFFFFFF`).
 * - Lower 24 bits (`bits 0..23`): canonical right/second child e-class ID (`ufFind(right) & 0xFFFFFF`),
 *   or literal payload bits for leaf constants/identifiers.
 *
 * Note: Commutative operand canonicalization and algebraic equivalences are unified via `rebuild()`
 * and equality saturation rewrite rules over the packed `((opType as u64) << 48) | ((left & 0xFFFFFF) << 24) | (right & 0xFFFFFF)` keys.
 *
 * @param exprId Arena expression index in `dae.exprData` (`0xFFFFFFFF` for null/invalid).
 * @param dae Source `DaeBuilder` linear-memory expression arena.
 * @returns Canonical e-class ID in the Union-Find structure, or `0xFFFFFFFF` if unsupported.
 */
export function addENode(exprId: u32, dae: DaeBuilder): u32 {
    if (exprId == 0xFFFFFFFF) return 0xFFFFFFFF;
    // Each expression slot in `dae.exprData` occupies 4 consecutive u32 words: [kind, data1, left/data2, right].
    let exprOffset = exprId * 4;
    let kind = dae.exprData.get(exprOffset + 0);
    let data1 = dae.exprData.get(exprOffset + 1);
    let data2 = dae.exprData.get(exprOffset + 2);

    if (kind == 0) { // Name
        // Leaf variable reference: upper 16 bits = 0, lower 32 bits = interned string ID `data1`.
        let key: u64 = ((data1 as u32) as u64);
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    if (kind == 1) { // IntLiteral
        // 32-bit integer literal: tag `opType = 256` in bits 48..63, raw u32 payload in bits 0..31.
        let key: u64 = ((256 as u64) << 48) | ((data1 as u32) as u64);
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    if (kind == 2) { // RealLiteral
        // 64-bit IEEE-754 float literal: reconstruct 64-bit pattern from `data1` (low u32) and `data2` (high u32),
        // intern into the lossless 64-bit float constant table, and pack the 32-bit constant index under `opType = 512`.
        let lo = (data1 as u32) as u64;
        let hi = (data2 as u32) as u64;
        let floatBits: u64 = lo | (hi << 32);
        let constIdx = internFloatConstant(reinterpret<f64>(floatBits));
        let key: u64 = ((512 as u64) << 48) | (constIdx as u64);
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    if (kind == 3) { // BoolLiteral
        // Boolean literal: tag `opType = 768` in bits 48..63, normalized 0/1 bit in bit 0.
        let key: u64 = ((768 as u64) << 48) | ((data1 != 0 ? 1 : 0) as u64);
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    if (kind == 5) { // Binary
        // Binary operator: recursively intern left and right operands, resolve their canonical e-class leaders
        // via `ufFind`, and pack `((opType as u64) << 48) | ((left & 0xFFFFFF) << 24) | (right & 0xFFFFFF)`.
        let leftId = dae.exprData.get(exprOffset + 2) as u32;
        let rightId = dae.exprData.get(exprOffset + 3) as u32;
        let leftClass = addENode(leftId, dae);
        let rightClass = addENode(rightId, dae);
        let opType: u16 = 1280;
        if (data1 >= 12 && data1 <= 17) {
            opType = (1536 + (data1 - 12)) as u16;
        } else if (data1 >= 10 && data1 <= 11) {
            opType = (1792 + (data1 - 10)) as u16;
        } else {
            opType = (1280 + (data1 & 0xFF)) as u16;
        }
        let key: u64 = ((opType as u64) << 48) | (((ufFind(leftClass) & 0xFFFFFF) as u64) << 24) | ((ufFind(rightClass) & 0xFFFFFF) as u64);
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    if (kind == 6 || kind == 14) { // Unary or Negate
        // Unary operator: pack `opType = 1024 + unaryOp` in bits 48..63 and canonical child e-class in bits 24..47.
        let rawChild = dae.exprData.get(exprOffset + 2);
        let childId = (rawChild != -1 && (rawChild as u32) != 0xFFFFFFFF) ? (rawChild as u32) : (data1 as u32);
        let childClass = addENode(childId, dae);
        let opType: u16 = kind == 14 ? 1024 : ((1024 + (data1 & 0xFF)) as u16);
        let key: u64 = ((opType as u64) << 48) | (((ufFind(childClass) & 0xFFFFFF) as u64) << 24);
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    if (kind == 7) { // Call
        // Intrinsic call: offset `opType = 1800 + funcNameId` and pack canonical argument e-classes in bits 24..47 and 0..23.
        let childId = dae.exprData.get(exprOffset + 2) as u32;
        let argInfo = dae.exprData.get(exprOffset + 3) as u32;
        let leftClass = childId != 0xFFFFFFFF ? addENode(childId, dae) : 0xFFFFFFFF;
        let rightClass: u32 = 0xFFFFFFFF;
        if (argInfo >= 2 && argInfo != 0xFFFFFFFF) {
            let nextExprId = exprId + 1;
            if (nextExprId < (dae.exprCount as u32) && dae.exprData.get(nextExprId * 4) == 15 /* Tuple */) {
                let secondArgId = dae.exprData.get(nextExprId * 4 + 2) as u32;
                rightClass = addENode(secondArgId, dae);
            } else if (childId + 1 < (dae.exprCount as u32)) {
                rightClass = addENode(childId + 1, dae);
            }
        }
        let opType: u16 = (1800 + (data1 & 0xFF)) as u16;
        let lBits: u64 = leftClass == 0xFFFFFFFF ? 0 : ((ufFind(leftClass) & 0xFFFFFF) as u64);
        let rBits: u64 = rightClass == 0xFFFFFFFF ? 0 : ((ufFind(rightClass) & 0xFFFFFF) as u64);
        let key: u64 = ((opType as u64) << 48) | (lBits << 24) | rBits;
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    if (kind == 12) { // Der
        let rawChild = dae.exprData.get(exprOffset + 2);
        let childId = (rawChild != -1 && (rawChild as u32) != 0xFFFFFFFF) ? (rawChild as u32) : (data1 as u32);
        let childClass = addENode(childId, dae);
        let opType: u16 = 3072;
        let key: u64 = ((opType as u64) << 48) | (((ufFind(childClass) & 0xFFFFFF) as u64) << 24);
        let existing = hashFind(key);
        if (existing != 0xFFFFFFFF) return ufFind(existing);
        let id = ufMakeSet();
        hashInsert(key, id);
        return id;
    }

    return 0xFFFFFFFF;
}
