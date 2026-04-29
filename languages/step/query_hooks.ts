import type { QueryHooks } from "@modelscript/polyglot/runtime";

// Import the language definition to access query lambdas directly.
// The functions are NOT serialized — they execute from the original source.
import langDef from "./language.js";

/**
 * Query hooks extracted from language.ts def() rules.
 * Each entry maps a grammar rule name to its query functions.
 */
function buildQueryHooks(): Map<string, QueryHooks> {
  const hooks = new Map<string, QueryHooks>();
  if (!langDef.rules) return hooks;

  // EntityInstance: entityType, stepName, references
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["EntityInstance"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("EntityInstance", merged);
      }
    }
  }

  return hooks;
}

export const QUERY_HOOKS = buildQueryHooks();
