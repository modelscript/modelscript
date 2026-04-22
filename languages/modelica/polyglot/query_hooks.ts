/* eslint-disable */
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

  // ClassDefinition: queries and various lints
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ClassDefinition"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ClassDefinition", merged);
      }
    }
  }

  // ExtendsClause: queries and lints, effectiveModification, lint__extendsCycle
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ExtendsClause"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ExtendsClause", merged);
      }
    }
  }

  // ComponentDeclaration: queries and lints
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ComponentDeclaration"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ComponentDeclaration", merged);
      }
    }
  }

  // ConnectEquation: queries and lints
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = langDef.rules!["ConnectEquation"]($);
    if (rule && (rule as any).type === "def") {
      const opts = (rule as any).options;
      const merged: Record<string, any> = {};
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints)) {
          merged["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ConnectEquation", merged);
      }
    }
  }

  return hooks;
}

export const QUERY_HOOKS = buildQueryHooks();
