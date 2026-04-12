/* eslint-disable */
import { createSelfProxy, extractScopePath } from "./index.js";
import type { IndexerHook } from "./runtime.js";

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

    // Only process rules wrapped in def()
    if (!ruleAST || ruleAST.type !== "def") continue;

    const options = ruleAST.options;
    if (!options) continue;

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

  return hooks;
}

/**
 * Serializes IndexerHook[] to a TypeScript source string.
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
    `import type { IndexerHook } from "@modelscript/polyglot/runtime";\n\n` +
    `export const INDEXER_HOOKS: IndexerHook[] = [\n${hooksStr}\n];\n`
  );
}
