/* eslint-disable */
import * as path from "path";

/**
 * Info about which rules have query hooks defined.
 * We don't serialize the actual functions — the generated file imports
 * them directly from the source language.ts.
 */
export interface QueryHookInfo {
  ruleName: string;
  queryNames: string[];
  lintNames: string[];
}

/**
 * Walks the evaluated language config and identifies which rules
 * have `queries` defined in their `def()` options.
 *
 * @param langConfig - The evaluated language() config object.
 * @param $ - The symbol proxy (same one used to evaluate rules).
 * @returns An array of QueryHookInfo for rules with queries.
 */
export function extractQueryHooks(langConfig: any, $: Record<string, any>): QueryHookInfo[] {
  const hooks: QueryHookInfo[] = [];

  if (!langConfig.rules) return hooks;

  for (const [ruleName, ruleFn] of Object.entries<any>(langConfig.rules)) {
    const ruleAST = ruleFn($);

    if (!ruleAST) continue;
    const t = (ruleAST.type || "").toUpperCase();
    if (t !== "DEF") continue;
    const options = ruleAST.options || ruleAST.value;
    const hasQueries = options?.queries && Object.keys(options.queries).length > 0;
    const hasLints = options?.lints && Object.keys(options.lints).length > 0;
    if (!hasQueries && !hasLints) continue;

    const queryNames = options?.queries ? Object.keys(options.queries) : [];
    const lintNames = options?.lints ? Object.keys(options.lints) : [];
    hooks.push({ ruleName, queryNames, lintNames });
  }

  return hooks;
}

/**
 * Generates the query_hooks.ts source file.
 *
 * Unlike the indexer config (which is pure data), the query hooks
 * file imports user-defined query lambdas directly from the source
 * language.ts — no transpilation or serialization of functions needed.
 *
 * @param hooks      - The extracted query hook info.
 * @param inputFile  - Absolute path to the source language.ts.
 * @param outputDir  - Directory where query_hooks.ts will be written.
 * @returns The generated TypeScript source string.
 */
export function serializeQueryHooks(hooks: QueryHookInfo[], inputFile: string, outputDir: string): string {
  // Compute relative import path from outputDir to inputFile
  let relativePath = path.relative(outputDir, inputFile);
  // Ensure it starts with ./ and strip the .ts extension
  if (!relativePath.startsWith(".")) {
    relativePath = "./" + relativePath;
  }
  relativePath = relativePath.replace(/\.ts$/, ".js");

  const lines: string[] = [`import type { QueryHooks } from "@modelscript/language/compiler";`, ``];

  if (hooks.length === 0) {
    // No queries defined — generate an empty map
    lines.push(
      `/** No queries defined in the language definition. */`,
      `export const QUERY_HOOKS = new Map<string, QueryHooks>();`,
    );
    return lines.join("\n") + "\n";
  }

  // Import the language definition to access the query lambdas
  lines.push(
    `// Import the language definition to access query lambdas directly.`,
    `// The functions are NOT serialized — they execute from the original source.`,
    `import langDef from ${JSON.stringify(relativePath)};`,
    ``,
  );

  // Generate the extraction logic
  lines.push(
    `/**`,
    ` * Query hooks extracted from language.ts def() rules.`,
    ` * Each entry maps a grammar rule name to its query functions.`,
    ` */`,
    `function buildQueryHooks(): Map<string, QueryHooks> {`,
    `  const hooks = new Map<string, QueryHooks>();`,
    `  if (!langDef.rules) return hooks;`,
    ``,
  );

  // For each rule with queries, extract them
  for (const hook of hooks) {
    const allNames = [...hook.queryNames, ...hook.lintNames.map((n) => `lint__${n}`)];
    lines.push(
      `  // ${hook.ruleName}: ${allNames.join(", ")}`,
      `  {`,
      `    const $ = new Proxy({}, { get(_, p) { return { type: "sym", name: p }; } });`,
      `    const rule = (langDef.rules as Record<string, unknown>)["${hook.ruleName}"] as (args: unknown) => unknown;`,
      `    const ruleAst = rule ? rule($) : null;`,
      `    const ast = ruleAst as any;`,
      `    if (ast && (ast.type === "def" || ast.type === "DEF")) {`,
      `      const opts = (ast.options || ast.value || {}) as Record<string, unknown>;`,
      `      const merged = {} as QueryHooks;`,
      `      if (opts?.queries) Object.assign(merged, opts.queries);`,
      `      // Register lint functions as lint__<name> queries`,
      `      if (opts?.lints) {`,
      `        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {`,
      `          (merged as Record<string, unknown>)["lint__" + name] = fn;`,
      `        }`,
      `      }`,
      `      if (Object.keys(merged).length > 0) {`,
      `        hooks.set("${hook.ruleName}", merged);`,
      `      }`,
      `    }`,
      `  }`,
      ``,
    );
  }

  lines.push(`  return hooks;`, `}`, ``, `export const QUERY_HOOKS = buildQueryHooks();`);

  return lines.join("\n") + "\n";
}
