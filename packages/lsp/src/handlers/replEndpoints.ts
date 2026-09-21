import { LspContext } from "../LspContext.js";

let replInterpreter: any = null;

export function registerReplEndpoints(context: LspContext) {
  context.connection.onRequest("modelscript/repl/evaluate", async (params: { input: string }) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parser =
        (globalThis as any).parser ?? (globalThis as any).modelicaParser ?? context.parserService.getParser("modelica");
      if (!parser) {
        return { status: "error", error: "Script parser not initialized on server." };
      }

      const queryEngine = context.workspaceManager.getQueryEngine("modelica");
      if (!queryEngine) {
        return { status: "error", error: "Query engine not initialized on server." };
      }

      const InterpreterClass = (globalThis as any).ArenaScriptInterpreter;
      if (!InterpreterClass) {
        return { status: "error", error: "Script interpreter engine not registered on server." };
      }

      if (!replInterpreter) {
        replInterpreter = new InterpreterClass(queryEngine as any);
      }

      // We append a newline to ensure tree-sitter treats single-line statements correctly
      const tree = parser.parse(params.input + "\n");

      // If there's an error and the user hasn't explicitly terminated the statement or block
      if (tree.rootNode.hasError) {
        const trimmed = params.input.trim();
        if (
          !trimmed.endsWith(";") &&
          !trimmed.endsWith("end if") &&
          !trimmed.endsWith("end for") &&
          !trimmed.endsWith("end while")
        ) {
          return { status: "incomplete" };
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = replInterpreter.execute(tree.rootNode as any);

      if (result.error) {
        return { status: "error", error: result.error, result: result.output };
      }

      return { status: "success", result: result.output };
    } catch (e: unknown) {
      return { status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  });

  context.connection.onRequest("modelscript/repl/completion", async (params: { prefix: string }) => {
    try {
      const prefix = params.prefix;
      const comps = new Set<string>();

      // 1. Check local REPL variables
      if (replInterpreter) {
        for (const v of replInterpreter.scope.variables.keys()) {
          if (v.startsWith(prefix)) comps.add(v);
        }
      }

      // 2. Check workspace classes
      const queryEngine = context.workspaceManager.globalModelicaQueryEngine;
      if (queryEngine) {
        const shortName = prefix.includes(".") ? (prefix.split(".").pop() ?? "") : prefix;
        for (const name of queryEngine.index.byName.keys()) {
          if (name.startsWith(shortName)) {
            const fullComp = prefix.slice(0, prefix.length - shortName.length) + name;
            comps.add(fullComp);
          }
        }
      }

      // 3. Built-in functions
      const builtins = ["print", "simulate", "loadModel"];
      for (const b of builtins) {
        if (b.startsWith(prefix)) comps.add(b);
      }

      return { completions: Array.from(comps).sort().slice(0, 50) };
    } catch {
      return { completions: [] };
    }
  });
}
