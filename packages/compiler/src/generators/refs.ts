/* eslint-disable */
import { createSelfProxy, extractScopePath } from "../index.js";

/**
 * Info about a reference rule extracted from a `ref()` call.
 */
export interface RefHookInfo {
  ruleName: string;
  namePath: string;
  targetKinds: string[];
  resolve: "lexical" | "qualified";
}

/**
 * Walks the evaluated language configuration to identify reference sites.
 *
 * Scans all rules for `ref()` annotations and `def()` nodes that carry
 * a `symbol.ref` config (indicating the node is both a declaration and a reference).
 * Extracts resolution configuration like target symbol kinds and resolution scopes
 * (e.g., lexical vs. qualified lookup).
 *
 * @param langConfig The evaluated language config object.
 * @param $ The proxy object used for rule evaluation.
 * @returns An array of RefHookInfo structures defining reference sites.
 */
export function extractRefHooks(langConfig: any, $: Record<string, any>): RefHookInfo[] {
  const hooks: RefHookInfo[] = [];

  if (!langConfig.rules) return hooks;

  for (const [ruleName, ruleFn] of Object.entries<any>(langConfig.rules)) {
    const ruleAST = ruleFn($);
    if (!ruleAST) continue;

    // Recursively search for ref() nodes within choice/seq/opt/rep wrappers
    collectRefNodes(ruleAST, ruleName, hooks);
  }

  return hooks;
}

/**
 * Recursively walks an AST node tree to find all `ref()` annotations.
 *
 * Handles deep nesting inside combinatorial rules like `choice()`, `seq()`,
 * `optional()`, `repeat()`, and `repeat1()`. Resolves the precise dot-path needed
 * to access the reference target's name dynamically at runtime.
 *
 * @param node The rule node currently being inspected.
 * @param ruleName The name of the Tree-sitter grammar rule.
 * @param hooks The target array being populated with extracted hooks.
 */
function collectRefNodes(node: any, ruleName: string, hooks: RefHookInfo[]): void {
  if (!node || typeof node !== "object") return;

  if (node.type === "ref") {
    const opts = node.options || {};

    let namePath = "name";
    if (opts.name) {
      const self = createSelfProxy();
      const accessor = opts.name(self);
      if (typeof accessor === "string" && accessor === "$self") {
        namePath = "$self";
      } else {
        namePath = extractScopePath(accessor);
      }
    }

    hooks.push({
      ruleName,
      namePath,
      targetKinds: opts.targetKinds || [],
      resolve: opts.resolve || "lexical",
    });
  } else if (node.type === "def") {
    // def() node with symbol.ref — also acts as a reference site
    const opts = node.options || {};
    if (!opts.symbol) return;

    const self = createSelfProxy();
    const symbolConfig = opts.symbol(self);
    if (!symbolConfig?.ref) return;

    const namePath = symbolConfig.name ? extractScopePath(symbolConfig.name) : "name";

    hooks.push({
      ruleName,
      namePath,
      targetKinds: symbolConfig.ref.targetKinds || [],
      resolve: symbolConfig.ref.resolve || "lexical",
    });
  } else if (node.type === "choice" || node.type === "seq") {
    // Walk into choice/seq args
    if (Array.isArray(node.args)) {
      for (const arg of node.args) {
        collectRefNodes(arg, ruleName, hooks);
      }
    }
  } else if (
    node.type === "optional" ||
    node.type === "repeat" ||
    node.type === "repeat1" ||
    node.type === "token" ||
    node.type === "token_immediate"
  ) {
    // Walk into unary wrappers
    if (node.arg) {
      collectRefNodes(node.arg, ruleName, hooks);
    }
  }
}

/**
 * Generates the TypeScript source for the reference resolution configuration.
 *
 * The output powers the ModelScript workspace indexer, enabling it to accurately
 * wire up cross-references (like variable usages to their definitions) during
 * semantic analysis based solely on the declarative `ref()` rules.
 *
 * @param hooks The collected array of RefHookInfo hooks.
 * @returns The serialized TypeScript code exporting the `REF_HOOKS`.
 */
export function serializeRefConfig(hooks: RefHookInfo[]): string {
  const lines: string[] = [
    `import type { RefHook } from "@modelscript/compiler";`,
    ``,
    `export const REF_HOOKS: RefHook[] = [`,
  ];

  for (const hook of hooks) {
    lines.push(`  {`);
    lines.push(`    ruleName: ${JSON.stringify(hook.ruleName)},`);
    lines.push(`    namePath: ${JSON.stringify(hook.namePath)},`);
    lines.push(`    targetKinds: ${JSON.stringify(hook.targetKinds)},`);
    lines.push(`    resolve: ${JSON.stringify(hook.resolve)},`);
    lines.push(`  },`);
  }

  lines.push(`];`);
  return lines.join("\n") + "\n";
}
