import type { QueryHooks } from "@modelscript/compiler";

// Import the language definition to access query lambdas directly.
// The functions are NOT serialized — they execute from the original source.
import langDef from "../language.js";

/**
 * Query hooks extracted from language.ts def() rules.
 * Each entry maps a grammar rule name to its query functions.
 */
function buildQueryHooks(): Map<string, QueryHooks> {
  const hooks = new Map<string, QueryHooks>();
  if (!langDef.rules) return hooks;

  // Ontology: axioms
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["Ontology"] as (args: unknown) => unknown;
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
        hooks.set("Ontology", merged);
      }
    }
  }

  // SubClassOfAxiom: lint
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["SubClassOfAxiom"] as (args: unknown) => unknown;
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
        hooks.set("SubClassOfAxiom", merged);
      }
    }
  }

  // EquivalentClassesAxiom: lint
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["EquivalentClassesAxiom"] as (args: unknown) => unknown;
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
        hooks.set("EquivalentClassesAxiom", merged);
      }
    }
  }

  // DisjointClassesAxiom: lint
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["DisjointClassesAxiom"] as (args: unknown) => unknown;
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
        hooks.set("DisjointClassesAxiom", merged);
      }
    }
  }

  // ObjectPropertyAssertionAxiom: lint
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ObjectPropertyAssertionAxiom"] as (
      args: unknown,
    ) => unknown;
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
        hooks.set("ObjectPropertyAssertionAxiom", merged);
      }
    }
  }

  // DataPropertyAssertionAxiom: lint
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["DataPropertyAssertionAxiom"] as (args: unknown) => unknown;
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
        hooks.set("DataPropertyAssertionAxiom", merged);
      }
    }
  }

  // ClassAssertionAxiom: lint
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ClassAssertionAxiom"] as (args: unknown) => unknown;
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
        hooks.set("ClassAssertionAxiom", merged);
      }
    }
  }

  // TransitiveObjectPropertyAxiom: lint
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["TransitiveObjectPropertyAxiom"] as (
      args: unknown,
    ) => unknown;
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
        hooks.set("TransitiveObjectPropertyAxiom", merged);
      }
    }
  }

  return hooks;
}

export const QUERY_HOOKS = buildQueryHooks();
