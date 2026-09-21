import { LanguageOptions } from "../../dsl/language.js";
import { egraph_engineCode } from "../../src-gen/runtime-templates.js";
import { compileRewriteRules } from "../transpiler/compile_rules.js";

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
  let out = egraph_engineCode + "\n\n";

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

  out += "    if (kind == 7) {\n"; // Call
  out += "        let childId = dae.exprData.get(exprOffset + 2);\n";
  out += "        let childClass = addENode(childId, dae);\n";
  out += "        let opType = 1800 + (data1 as u16);\n";
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
