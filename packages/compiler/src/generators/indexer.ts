/* eslint-disable */
import type { IndexerHook } from "../index.js";
import { createSelfProxy, extractScopePath } from "../index.js";

/**
 * Walks the evaluated language config and extracts IndexerHook[]
 * from all rules wrapped in `def()`.
 *
 * @param langConfig - The evaluated language() config object.
 * @param $ - The symbol proxy (same one used to evaluate rules).
 * @returns An array of IndexerHook configurations.
 */
export function extractIndexerHooks(langConfig: any, $: Record<string, any>): IndexerHook[] {
  const hooks: IndexerHook[] = [];

  if (!langConfig.rules) return hooks;

  for (const [ruleName, ruleFn] of Object.entries<any>(langConfig.rules)) {
    const ruleAST = ruleFn($);
    collectIndexerHooks(ruleAST, ruleName, hooks);
  }

  return hooks;
}

/**
 * Recursively walks the structure of a rule AST node to extract indexing hooks.
 *
 * This function deeply explores AST wrappers like `choice`, `seq`, `opt`, and `rep`
 * to locate `def()` and `ref()` nodes. When found, it evaluates the `symbol` configuration,
 * extracting the defined `kind`, the dot-path to the `name` field, and paths for
 * `exports`, `inherits`, and any custom `attributes`.
 *
 * @param node The rule AST node being explored.
 * @param ruleName The name of the Tree-sitter rule being analyzed.
 * @param hooks The array of extracted IndexerHooks being mutated.
 */
function collectIndexerHooks(node: any, ruleName: string, hooks: IndexerHook[]): void {
  if (!node || typeof node !== "object") return;

  if (node.type === "def") {
    const options = node.options;
    if (options) {
      let kind = "Unknown";
      let namePath = "name"; // default
      let exportPaths: string[] = [];
      let inheritPaths: string[] = [];
      const metadataFieldPaths: Record<string, string> = {};

      if (typeof options.symbol === "function") {
        const self = createSelfProxy();
        const symConfig = options.symbol(self);

        if (symConfig.kind) kind = symConfig.kind;
        if (symConfig.name) namePath = extractScopePath(symConfig.name);

        if (symConfig.exports) {
          exportPaths = symConfig.exports.map(extractScopePath);
        }
        if (symConfig.inherits) {
          inheritPaths = symConfig.inherits.map(extractScopePath);
        }
        if (symConfig.attributes) {
          for (const [key, accessor] of Object.entries(symConfig.attributes)) {
            metadataFieldPaths[key] = extractScopePath(accessor as any);
          }
        }
      }

      hooks.push({
        ruleName,
        kind,
        namePath,
        exportPaths,
        inheritPaths,
        metadataFieldPaths,
      });
    }
  } else if (node.type === "ref") {
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
      kind: "Reference" as any, // Reference symbol kind
      namePath,
      exportPaths: [],
      inheritPaths: [],
      metadataFieldPaths: {},
    });
  } else if (node.type === "choice" || node.type === "seq") {
    if (Array.isArray(node.args)) {
      for (const arg of node.args) {
        collectIndexerHooks(arg, ruleName, hooks);
      }
    }
  } else if (
    node.type === "optional" ||
    node.type === "repeat" ||
    node.type === "repeat1" ||
    node.type === "token" ||
    node.type === "token_immediate"
  ) {
    if (node.arg) {
      collectIndexerHooks(node.arg, ruleName, hooks);
    }
  }
}

/**
 * Serializes an array of `IndexerHook` definitions into a TypeScript source string.
 *
 * The resulting file provides the `INDEXER_HOOKS` array, which the ModelScript
 * Polyglot Runtime consumes. This runtime uses the hooks to know exactly which
 * CST nodes represent declarations, what kind of symbols they produce, and how
 * to extract their hierarchical semantic data without needing handwritten code.
 *
 * @param hooks The extracted array of IndexerHooks.
 * @returns The complete TypeScript source string for the generated indexer hooks.
 */
export function serializeIndexerConfig(hooks: IndexerHook[]): string {
  const hooksStr = hooks
    .map(
      (h) =>
        `  {\n` +
        `    ruleName: ${JSON.stringify(h.ruleName)},\n` +
        `    kind: ${JSON.stringify(h.kind)},\n` +
        `    namePath: ${JSON.stringify(h.namePath)},\n` +
        `    exportPaths: ${JSON.stringify(h.exportPaths)},\n` +
        `    inheritPaths: ${JSON.stringify(h.inheritPaths)},\n` +
        `    metadataFieldPaths: ${JSON.stringify(h.metadataFieldPaths)},\n` +
        `  }`,
    )
    .join(",\n");

  return (
    `import type { IndexerHook } from "@modelscript/compiler";\n\n` +
    `export const INDEXER_HOOKS: IndexerHook[] = [\n${hooksStr}\n];\n`
  );
}
