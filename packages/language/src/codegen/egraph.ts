import { LanguageOptions } from "../dsl.js";
import { compileRewriteRules } from "./compile_rules.js";

/**
 * Generates an AssemblyScript e-graph saturation and Bellman-Ford DP extraction engine.
 * Emits zero-GC union-find data structures, dense e-node arrays, hash-consing deduplication,
 * and rule matching loops.
 *
 * @param grammar Language configuration options.
 * @param rules Array of rewrite rule definitions.
 * @returns AssemblyScript source code string for the e-graph runtime module.
 */
export function generateEGraphEngine(grammar: LanguageOptions, rules: any[]): string {
  let out =
    'import { atomicChunkAlloc, getNodeType, getNodeFirstChild, getNodeNextSibling, allocNode } from "./arena";\n' +
    'import { DaeBuilder } from "./dae";\n\n' +
    "// --- EGraph Engine (Zero-GC) ---\n" +
    "export const MAX_ECLASSES: u32 = 65536;\n" +
    "export const MAX_ENODES: u32 = 65536;\n" +
    "export const HASH_CAPACITY: u32 = 65536; // Power of 2\n" +
    "export const HASH_MASK: u32 = HASH_CAPACITY - 1;\n" +
    "export const EMPTY_KEY: u64 = 0xFFFFFFFFFFFFFFFF;\n\n" +
    "export function unwrapNode(node: u32): u32 {\n" +
    "    return node;\n" +
    "}\n\n" +
    "// --- Union-Find Disjoint Set ---\n" +
    "let ufParentOffset: u32 = 0;\n" +
    "let ufRankOffset: u32 = 0;\n" +
    "export let ufCount: u32 = 0;\n\n" +
    "export function initEGraph(): void {\n" +
    "    if (ufParentOffset == 0) {\n" +
    "        ufParentOffset = atomicChunkAlloc(MAX_ECLASSES * 4);\n" +
    "        ufRankOffset = atomicChunkAlloc(MAX_ECLASSES);\n" +
    "    }\n" +
    "    ufCount = 0;\n" +
    "}\n\n" +
    "export function ufMakeSet(): u32 {\n" +
    "    if (ufCount >= MAX_ECLASSES) return 0xFFFFFFFF;\n" +
    "    let id = ufCount++;\n" +
    "    store<u32>(ufParentOffset + id * 4, id);\n" +
    "    store<u8>(ufRankOffset + id, 0);\n" +
    "    return id;\n" +
    "}\n\n" +
    "export function ufFind(x: u32): u32 {\n" +
    "    if (x >= MAX_ECLASSES || x == 0xFFFFFFFF || ufParentOffset == 0) return x;\n" +
    "    let root = x;\n" +
    "    while (true) {\n" +
    "        let parent = load<u32>(ufParentOffset + root * 4);\n" +
    "        if (parent == root || parent >= MAX_ECLASSES) break;\n" +
    "        root = parent;\n" +
    "    }\n" +
    "    let curr = x;\n" +
    "    while (curr != root && curr < MAX_ECLASSES) {\n" +
    "        let nxt = load<u32>(ufParentOffset + curr * 4);\n" +
    "        store<u32>(ufParentOffset + curr * 4, root);\n" +
    "        curr = nxt;\n" +
    "    }\n" +
    "    return root;\n" +
    "}\n\n" +
    "export function ufUnion(a: u32, b: u32): u32 {\n" +
    "    let rootA = ufFind(a);\n" +
    "    let rootB = ufFind(b);\n" +
    "    if (rootA == rootB) return rootA;\n" +
    "    let rankA = load<u8>(ufRankOffset + rootA);\n" +
    "    let rankB = load<u8>(ufRankOffset + rootB);\n" +
    "    if (rankA < rankB) {\n" +
    "        store<u32>(ufParentOffset + rootA * 4, rootB);\n" +
    "        return rootB;\n" +
    "    } else if (rankA > rankB) {\n" +
    "        store<u32>(ufParentOffset + rootB * 4, rootA);\n" +
    "        return rootA;\n" +
    "    } else {\n" +
    "        store<u32>(ufParentOffset + rootB * 4, rootA);\n" +
    "        store<u8>(ufRankOffset + rootA, rankA + 1);\n" +
    "        return rootA;\n" +
    "    }\n" +
    "}\n\n" +
    "// --- Dense E-Node Storage & Hash-Consing Deduplication Table ---\n" +
    "export let eNodeKeysOffset: u32 = 0;\n" +
    "export let eNodeClassesOffset: u32 = 0;\n" +
    "export let eNodeCount: u32 = 0;\n\n" +
    "let hashKeysOffset: u32 = 0;\n" +
    "let hashValsOffset: u32 = 0;\n" +
    "export let hashOccupied: u32 = 0;\n\n" +
    "export function initHashCons(): void {\n" +
    "    if (hashKeysOffset == 0) {\n" +
    "        hashKeysOffset = atomicChunkAlloc(HASH_CAPACITY * 8);\n" +
    "        hashValsOffset = atomicChunkAlloc(HASH_CAPACITY * 4);\n" +
    "        eNodeKeysOffset = atomicChunkAlloc(MAX_ENODES * 8);\n" +
    "        eNodeClassesOffset = atomicChunkAlloc(MAX_ENODES * 4);\n" +
    "    }\n" +
    "    eNodeCount = 0;\n" +
    "    hashOccupied = 0;\n" +
    "    // Set all key slots to EMPTY_KEY sentinel (0xFFFFFFFFFFFFFFFF)\n" +
    "    memory.fill(hashKeysOffset, 0xFF, HASH_CAPACITY * 8);\n" +
    "}\n\n" +
    "export function hashProbe(key: u64): u32 {\n" +
    "    let h = (key ^ (key >> 32)) as u32;\n" +
    "    h = ((h >> 16) ^ h) * 0x45d9f3b;\n" +
    "    h = ((h >> 16) ^ h);\n" +
    "    return h & HASH_MASK;\n" +
    "}\n\n" +
    "export function hashFind(key: u64): u32 {\n" +
    "    let slot = hashProbe(key);\n" +
    "    let guard: u32 = 0;\n" +
    "    while (guard < HASH_CAPACITY) {\n" +
    "        let storedKey = load<u64>(hashKeysOffset + slot * 8);\n" +
    "        if (storedKey == EMPTY_KEY) return 0xFFFFFFFF; // Empty slot\n" +
    "        if (storedKey == key) return load<u32>(hashValsOffset + slot * 4);\n" +
    "        slot = (slot + 1) & HASH_MASK;\n" +
    "        guard++;\n" +
    "    }\n" +
    "    return 0xFFFFFFFF;\n" +
    "}\n\n" +
    "export function hashInsert(key: u64, val: u32): void {\n" +
    "    let slot = hashProbe(key);\n" +
    "    let guard: u32 = 0;\n" +
    "    while (guard < HASH_CAPACITY) {\n" +
    "        let storedKey = load<u64>(hashKeysOffset + slot * 8);\n" +
    "        if (storedKey == EMPTY_KEY) {\n" +
    "            store<u64>(hashKeysOffset + slot * 8, key);\n" +
    "            store<u32>(hashValsOffset + slot * 4, val);\n" +
    "            if (eNodeCount < MAX_ENODES) {\n" +
    "                store<u64>(eNodeKeysOffset + eNodeCount * 8, key);\n" +
    "                store<u32>(eNodeClassesOffset + eNodeCount * 4, val);\n" +
    "                eNodeCount++;\n" +
    "            }\n" +
    "            hashOccupied++;\n" +
    "            return;\n" +
    "        }\n" +
    "        if (storedKey == key) {\n" +
    "            store<u32>(hashValsOffset + slot * 4, val);\n" +
    "            return;\n" +
    "        }\n" +
    "        slot = (slot + 1) & HASH_MASK;\n" +
    "        guard++;\n" +
    "    }\n" +
    "}\n\n" +
    "export function rebuildEGraph(): void {\n" +
    "    memory.fill(hashKeysOffset, 0xFF, HASH_CAPACITY * 8);\n" +
    "    hashOccupied = 0;\n" +
    "    let writeIdx: u32 = 0;\n" +
    "    for (let i: u32 = 0; i < eNodeCount; i++) {\n" +
    "        let key = load<u64>(eNodeKeysOffset + i * 8);\n" +
    "        let eClass = ufFind(load<u32>(eNodeClassesOffset + i * 4));\n" +
    "        let op = (key >> 48) as u16;\n" +
    "        let left = ((key >> 24) & 0xFFFFFF) as u32;\n" +
    "        let right = (key & 0xFFFFFF) as u32;\n\n" +
    "        if (op >= 1280 && op <= 1283) {\n" +
    "            left = ufFind(left);\n" +
    "            right = ufFind(right);\n" +
    "            key = ((op as u64) << 48) | (((left & 0xFFFFFF) as u64) << 24) | ((right & 0xFFFFFF) as u64);\n" +
    "        } else if (op == 1024 || op == 1026) {\n" +
    "            left = ufFind(left);\n" +
    "            key = ((op as u64) << 48) | (((left & 0xFFFFFF) as u64) << 24);\n" +
    "        }\n\n" +
    "        let existing = hashFind(key);\n" +
    "        if (existing != 0xFFFFFFFF) {\n" +
    "            ufUnion(eClass, existing);\n" +
    "        } else {\n" +
    "            let slot = hashProbe(key);\n" +
    "            let guard: u32 = 0;\n" +
    "            while (guard < HASH_CAPACITY) {\n" +
    "                let storedKey = load<u64>(hashKeysOffset + slot * 8);\n" +
    "                if (storedKey == EMPTY_KEY) {\n" +
    "                    store<u64>(hashKeysOffset + slot * 8, key);\n" +
    "                    store<u32>(hashValsOffset + slot * 4, eClass);\n" +
    "                    hashOccupied++;\n" +
    "                    break;\n" +
    "                }\n" +
    "                slot = (slot + 1) & HASH_MASK;\n" +
    "                guard++;\n" +
    "            }\n" +
    "            store<u64>(eNodeKeysOffset + writeIdx * 8, key);\n" +
    "            store<u32>(eNodeClassesOffset + writeIdx * 4, eClass);\n" +
    "            writeIdx++;\n" +
    "        }\n" +
    "    }\n" +
    "    eNodeCount = writeIdx;\n" +
    "}\n\n" +
    "export function isConstant(eClass: u32, val: f64): boolean {\n" +
    "    let root = ufFind(eClass);\n" +
    "    let floatBits = reinterpret<u64>(val);\n" +
    "    let keyReal: u64 = ((512 as u64) << 48) | (floatBits >>> 16);\n" +
    "    let classReal = hashFind(keyReal);\n" +
    "    if (classReal != 0xFFFFFFFF && ufFind(classReal) == root) return true;\n" +
    "    let keyInt: u64 = ((256 as u64) << 48) | ((val as u32) & 0xFFFFFFFF);\n" +
    "    let classInt = hashFind(keyInt);\n" +
    "    if (classInt != 0xFFFFFFFF && ufFind(classInt) == root) return true;\n" +
    "    return false;\n" +
    "}\n\n";

  out += "export function addENode(exprId: u32, dae: DaeBuilder): u32 {\n";
  out += "    if (exprId == 0xFFFFFFFF) return 0xFFFFFFFF;\n";
  out += "    let exprOffset = exprId * 4;\n";
  out += "    let kind = dae.exprData.get(exprOffset + 0);\n";
  out += "    let data1 = dae.exprData.get(exprOffset + 1);\n";
  out += "    let data2 = dae.exprData.get(exprOffset + 2);\n\n";

  out += "    if (kind == 0) {\n"; // Name
  out += "        let key: u64 = (data1 as u64);\n";
  out += "        let existing = hashFind(key);\n";
  out += "        if (existing != 0xFFFFFFFF) return ufFind(existing);\n";
  out += "        let id = ufMakeSet();\n";
  out += "        hashInsert(key, id);\n";
  out += "        return id;\n";
  out += "    }\n";

  out += "    if (kind == 1) {\n"; // IntLiteral
  out += "        let key: u64 = ((256 as u64) << 48) | ((data1 as u32) as u64);\n";
  out += "        let existing = hashFind(key);\n";
  out += "        if (existing != 0xFFFFFFFF) return ufFind(existing);\n";
  out += "        let id = ufMakeSet();\n";
  out += "        hashInsert(key, id);\n";
  out += "        return id;\n";
  out += "    }\n";

  out += "    if (kind == 2) {\n"; // RealLiteral
  out += "        let lo = data1 as u64;\n";
  out += "        let hi = data2 as u64;\n";
  out += "        let floatBits: u64 = lo | (hi << 32);\n";
  out += "        let key: u64 = ((512 as u64) << 48) | (floatBits >>> 16);\n";
  out += "        let existing = hashFind(key);\n";
  out += "        if (existing != 0xFFFFFFFF) return ufFind(existing);\n";
  out += "        let id = ufMakeSet();\n";
  out += "        hashInsert(key, id);\n";
  out += "        return id;\n";
  out += "    }\n";

  out += "    if (kind == 3) {\n"; // BoolLiteral
  out += "        let key: u64 = ((768 as u64) << 48) | ((data1 != 0 ? 1 : 0) as u64);\n";
  out += "        let existing = hashFind(key);\n";
  out += "        if (existing != 0xFFFFFFFF) return ufFind(existing);\n";
  out += "        let id = ufMakeSet();\n";
  out += "        hashInsert(key, id);\n";
  out += "        return id;\n";
  out += "    }\n";

  out += "    if (kind == 5) {\n"; // Binary
  out += "        let leftId = dae.exprData.get(exprOffset + 2);\n";
  out += "        let rightId = dae.exprData.get(exprOffset + 3);\n";
  out += "        let leftClass = addENode(leftId, dae);\n";
  out += "        let rightClass = addENode(rightId, dae);\n";
  out += "        let opType = (kind << 8) | data1;\n";
  out +=
    "        let key: u64 = ((opType as u64) << 48) | (((ufFind(leftClass) & 0xFFFFFF) as u64) << 24) | ((ufFind(rightClass) & 0xFFFFFF) as u64);\n";
  out += "        let existing = hashFind(key);\n";
  out += "        if (existing != 0xFFFFFFFF) return ufFind(existing);\n";
  out += "        let id = ufMakeSet();\n";
  out += "        hashInsert(key, id);\n";
  out += "        return id;\n";
  out += "    }\n";

  out += "    if (kind == 6) {\n"; // Unary
  out += "        let childId = dae.exprData.get(exprOffset + 2);\n";
  out += "        let childClass = addENode(childId, dae);\n";
  out += "        let opType = (kind << 8) | data1;\n";
  out += "        let key: u64 = ((opType as u64) << 48) | (((ufFind(childClass) & 0xFFFFFF) as u64) << 24);\n";
  out += "        let existing = hashFind(key);\n";
  out += "        if (existing != 0xFFFFFFFF) return ufFind(existing);\n";
  out += "        let id = ufMakeSet();\n";
  out += "        hashInsert(key, id);\n";
  out += "        return id;\n";
  out += "    }\n";

  out += "    return 0xFFFFFFFF;\n";
  out += "}\n";

  if (rules && rules.length > 0) {
    out += compileRewriteRules(rules);
  } else {
    out += "export function saturateEGraph(): void {}\n";
    out += "export function initDPExtractor(): void {}\n";
    out += "export function extractAst(rootClass: u32, dae: DaeBuilder): u32 { return 0; }\n";
  }

  out +=
    "\n// --- Global AST Simplification ---\n" +
    "export function simplifyAst(exprId: u32, dae: DaeBuilder): u32 {\n" +
    "    initEGraph();\n" +
    "    initHashCons();\n" +
    "    let rootClass = addENode(exprId, dae);\n" +
    "    if (rootClass == 0xFFFFFFFF) return exprId;\n" +
    "    saturateEGraph();\n" +
    "    initDPExtractor();\n" +
    "    let simplifiedAst = extractAst(rootClass, dae);\n" +
    "    if (simplifiedAst == 0xFFFFFFFF) return exprId;\n" +
    "    return simplifiedAst;\n" +
    "}\n";

  return out;
}
