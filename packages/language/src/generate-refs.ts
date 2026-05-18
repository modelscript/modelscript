/* eslint-disable */
import { createSelfProxy, extractScopePath } from "./index.js";

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
 * Walks the evaluated language config and identifies rules
 * wrapped in `ref()`, extracting their resolution configuration.
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
 * Recursively walk an AST node tree to find all `ref()` nodes.
 * Handles nesting inside choice(), seq(), opt(), rep(), rep1().
 */
function collectRefNodes(node: any, ruleName: string, hooks: RefHookInfo[]): void {
  if (!node || typeof node !== "object") return;

  if (node.type === "ref") {
    const opts = node.options || {};

    let namePath = "name";
    if (opts.name) {
      const self = createSelfProxy();
      const accessor = opts.name(self);
      namePath = extractScopePath(accessor);
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
    node.type === "opt" ||
    node.type === "rep" ||
    node.type === "rep1" ||
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
 * Generates the ref_config.ts source file.
 */
export function serializeRefConfig(hooks: RefHookInfo[]): string {
  const lines: string[] = [
    `import type { RefHook } from "@modelscript/polyglot/runtime";`,
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
