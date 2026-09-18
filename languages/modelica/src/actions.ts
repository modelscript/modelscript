// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ActionExecutionContext } from "@modelscript/dsl";
import { printArenaDAE } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import { ModelicaFlattener } from "./flattener.js";

function resolveClassId(queryEngine: any, queryDB: any, className: string): number | undefined {
  let firstId: number | undefined;
  if (className.includes(".")) {
    const parts = className.split(".");
    let currentId: any = null;
    for (const part of parts) {
      const resolver = queryDB.query?.("resolveSimpleName", currentId);
      const res = resolver ? resolver(part) : null;
      if (!res) {
        currentId = null;
        break;
      }
      currentId = res.id ?? null;
    }
    firstId = currentId ?? undefined;
  }
  if (firstId === undefined && queryEngine.index?.byName) {
    const entries = queryEngine.index.byName.get(className) || [];
    firstId = entries[0];
  }
  if (firstId === undefined && queryEngine.index?.symbols) {
    for (const [id, entry] of queryEngine.index.symbols.entries()) {
      if (entry.name === className || entry.qualifiedName === className) {
        firstId = id;
        break;
      }
    }
  }
  return firstId;
}

/**
 * Host-side execution handlers for Modelica actions.
 * Decoupled from the declarative language syntax grammar.
 */
export const modelicaActionHandlers: Record<
  string,
  (context: ActionExecutionContext, inputs: any) => Promise<any> | any
> = {
  flatten: async (context: ActionExecutionContext, inputs: any) => {
    let className = inputs?.name;
    if (!className && context.documentText) {
      const m = context.documentText.match(/\b(?:model|block|class|record)\s+([A-Za-z0-9_]+)/);
      if (m) className = m[1];
    }
    if (!className) {
      throw new Error("No Modelica class name specified to flatten.");
    }

    const queryEngine = context.queryEngine;
    if (!queryEngine) {
      throw new Error("QueryEngine not available in execution context.");
    }

    const queryDB = queryEngine.toQueryDB();
    const flattener = new ModelicaFlattener(queryDB);
    const firstId = resolveClassId(queryEngine, queryDB, className);
    if (firstId === undefined) {
      throw new Error(`Class '${className}' not found in index.`);
    }

    context.notifyProgress?.(`Flattening ${className}...`, 50);
    const arena = flattener.flatten(firstId);
    const text = printArenaDAE(arena);
    context.notifyProgress?.("Flattening complete", 100);
    return {
      text,
      name: className,
    };
  },

  simulate: async (context: ActionExecutionContext, inputs: any) => {
    let className = inputs?.name;
    if (!className && context.documentText) {
      const m = context.documentText.match(/\b(?:model|block|class|record)\s+([A-Za-z0-9_]+)/);
      if (m) className = m[1];
    }
    if (!className) {
      throw new Error("No Modelica class name specified to simulate.");
    }

    const queryEngine = context.queryEngine;
    if (!queryEngine) {
      throw new Error("QueryEngine not available in execution context.");
    }

    const queryDB = queryEngine.toQueryDB();
    const flattener = new ModelicaFlattener(queryDB);
    const firstId = resolveClassId(queryEngine, queryDB, className);
    if (firstId === undefined) {
      throw new Error(`Class '${className}' not found in index.`);
    }

    context.notifyProgress?.(`Flattening ${className}...`, 30);
    const arena = flattener.flatten(firstId);

    context.notifyProgress?.(`Simulating ${className}...`, 60);
    const simOpts: any = {
      solver: inputs?.solver || "dopri5",
    };
    if (inputs?.startTime !== undefined) simOpts.startTime = inputs.startTime;
    if (inputs?.stopTime !== undefined) simOpts.stopTime = inputs.stopTime;
    if (inputs?.interval !== undefined) simOpts.step = inputs.interval;

    const result = simulateArena(arena as any, simOpts);
    context.notifyProgress?.("Simulation complete", 100);

    if ((inputs?.format ?? "json") === "csv") {
      const states = result.states || [];
      const lines = [`time,${states.join(",")}`];
      for (let i = 0; i < result.t.length; i++) {
        const values = [result.t[i], ...states.map((_: string, vi: number) => result.y[i]?.[vi] ?? 0)];
        lines.push(values.join(","));
      }
      return {
        format: "csv",
        text: lines.join("\n"),
        t: result.t,
        states,
      };
    }

    return {
      name: className,
      t: result.t,
      y: result.y,
      states: result.states,
      text: `Simulation of ${className} completed: ${result.t.length} steps, states: [${(result.states || []).join(", ")}]`,
    };
  },

  query: async (context: ActionExecutionContext, inputs: any) => {
    const name = inputs?.name;
    if (!name) throw new Error("Missing required class name");
    const queryEngine = context.queryEngine;
    if (!queryEngine) throw new Error("QueryEngine not available");

    const queryDB = queryEngine.toQueryDB ? queryEngine.toQueryDB() : null;
    const firstId = resolveClassId(queryEngine, queryDB, name);
    if (firstId === undefined) {
      return { error: `Class '${name}' not found.` };
    }
    const entry = queryEngine.index.symbols.get(firstId);
    const children = queryEngine.index.childrenOf.get(firstId) || [];
    const components: any[] = [];
    const childClasses: any[] = [];

    for (const chId of children) {
      const ch = queryEngine.index.symbols.get(chId);
      if (!ch) continue;
      if (ch.kind === 2 /* Component */) {
        components.push({
          name: ch.name,
          type: ch.typeText || "",
          description: ch.comment || "",
        });
      } else if (ch.kind === 1 /* Class */) {
        childClasses.push({
          name: ch.name,
          kind: "class",
        });
      }
    }

    return {
      name,
      kind: entry ? "class" : "unknown",
      description: entry?.comment || "",
      components,
      childClasses,
    };
  },

  parse: async (_context: ActionExecutionContext, inputs: any) => {
    const code = inputs?.code ?? "";
    const classes: { name: string; kind: string }[] = [];
    const classRegex = /\b(model|block|class|record|connector|function|package)\s+([A-Za-z0-9_]+)/g;
    let m: RegExpExecArray | null;
    while ((m = classRegex.exec(code)) !== null) {
      classes.push({ kind: m[1], name: m[2] });
    }
    return {
      classes,
      syntaxErrors: [],
    };
  },
};
