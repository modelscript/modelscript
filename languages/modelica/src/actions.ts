// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ActionExecutionContext } from "@modelscript/dsl";
import { printArenaDAE, Variability, VarType } from "@modelscript/runtime";
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

function ensureClassIndexed(
  context: ActionExecutionContext,
  className: string,
  queryEngine: any,
): { firstId: number | undefined; queryDB: any } {
  let queryDB = queryEngine.toQueryDB();
  let firstId = resolveClassId(queryEngine, queryDB, className);
  if (
    firstId === undefined &&
    context.uri &&
    context.documentText &&
    (context.workspaceManager as any)?.globalWorkspaceIndex
  ) {
    try {
      const ws = (context.workspaceManager as any).globalWorkspaceIndex;
      const sharedCtx = (globalThis as any).sharedContext;
      if (sharedCtx) {
        const tree = sharedCtx.parse(".mo", context.documentText);
        if (tree) {
          ws.indexDocument(context.uri, () => tree.rootNode);
          const unified = ws.toUnified();
          if (typeof queryEngine.updateIndex === "function") {
            queryEngine.updateIndex(unified);
            queryDB = queryEngine.toQueryDB();
            firstId = resolveClassId(queryEngine, queryDB, className);
          }
        }
      }
    } catch {
      /* ignore fallback indexing error */
    }
  }
  return { firstId, queryDB };
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

    const { firstId, queryDB } = ensureClassIndexed(context, className, queryEngine);
    if (firstId === undefined) {
      throw new Error(`Class '${className}' not found in index.`);
    }

    const flattener = new ModelicaFlattener(queryDB);
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

    const { firstId, queryDB } = ensureClassIndexed(context, className, queryEngine);
    if (firstId === undefined) {
      throw new Error(`Class '${className}' not found in index.`);
    }

    const flattener = new ModelicaFlattener(queryDB);
    context.notifyProgress?.(`Flattening ${className}...`, 30);
    const arena = flattener.flatten(firstId);

    context.notifyProgress?.(`Simulating ${className}...`, 60);
    const simOpts: any = {
      solver: inputs?.solver || "dopri5",
    };
    if (inputs?.startTime !== undefined) simOpts.startTime = inputs.startTime;
    if (inputs?.stopTime !== undefined) simOpts.stopTime = inputs.stopTime;
    if (inputs?.interval !== undefined) simOpts.step = inputs.interval;

    if (inputs?.parameterOverrides) {
      simOpts.parameterOverrides = new Map(Object.entries(inputs.parameterOverrides));
    }

    const result = simulateArena(arena as any, simOpts);
    context.notifyProgress?.("Simulation complete", 100);

    const tArr = Array.from(result.t);
    const yArr = (result.y || []).map((row: any) => (Array.isArray(row) ? row : Array.from(row)));

    function extractArenaParameters(ar: any): any[] {
      const infos: any[] = [];
      for (let i = 0; i < ar.varCount; i++) {
        if (ar.isVarRemoved(i)) continue;
        if (ar.getVarVariability(i) !== Variability.Parameter) continue;
        const name = ar.getVarName(i);
        const startVal = ar.getVarStartValue(i);
        const varType = ar.getVarType(i);
        let type: "real" | "integer" | "boolean" | "enumeration" = "real";
        let step = 0.1;
        if (varType === VarType.Boolean) {
          type = "boolean";
          step = 1;
        } else if (varType === VarType.Integer) {
          type = "integer";
          step = 1;
        }
        infos.push({ name, type, defaultValue: startVal, step });
      }
      return infos;
    }

    if ((inputs?.format ?? "json") === "csv") {
      const states = result.states || [];
      const lines = [`time,${states.join(",")}`];
      for (let i = 0; i < tArr.length; i++) {
        const values = [tArr[i], ...states.map((_: string, vi: number) => yArr[i]?.[vi] ?? 0)];
        lines.push(values.join(","));
      }
      return {
        format: "csv",
        text: lines.join("\n"),
        t: tArr,
        states,
        parameters: extractArenaParameters(arena),
        experiment: (arena as any).experiment,
      };
    }

    return {
      name: className,
      t: tArr,
      y: yArr,
      states: result.states || [],
      parameters: extractArenaParameters(arena),
      experiment: (arena as any).experiment,
      text: `Simulation of ${className} completed: ${tArr.length} steps, states: [${(result.states || []).join(", ")}]`,
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
