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
  let out = egraph_engineCode.replace(/from "\.\.\//g, 'from "./') + "\n\n";

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
