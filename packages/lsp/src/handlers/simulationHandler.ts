/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
// @ts-nocheck

import { Connection } from "vscode-languageserver";
import { documents, flattenArenaFromInstance, sharedContext } from "../browserServerMain";

export function registerSimulationHandlers(connection: Connection, documentManager: any, workspaceManager: any) {
  connection.onRequest("modelscript/simulateTerminate", (params: { participantId: string }): { ok: boolean } => {
    cosimSimulators.delete(params.participantId);
    return { ok: true };
  });

  connection.onRequest("modelscript/runScript", async (params: { uri: string }) => {
    if (!sharedContext || !workspaceManager.globalModelicaQueryEngine) {
      return { output: "", error: "Language server not fully initialized." };
    }
    const text = sharedContext.fs.read(params.uri);
    if (!text) {
      return { output: "", error: "File not found." };
    }

    const tree = sharedContext.parse(".mos", text);
    if (!tree || !tree.rootNode) {
      return { output: "", error: "Failed to parse script." };
    }

    const interpreter = new ArenaScriptInterpreter(workspaceManager.globalModelicaQueryEngine);
    const result = interpreter.execute(tree.rootNode);
    return result;
  });

  connection.onRequest("modelscript/runNotebookCell", async (params: { sessionId: string; code: string }) => {
    if (!sharedContext || !workspaceManager.globalModelicaQueryEngine) {
      return { output: "", error: "Language server not fully initialized." };
    }

    const tree = sharedContext.parse(".mos", params.code);
    if (!tree || !tree.rootNode) {
      return { output: "", error: "Failed to parse cell." };
    }

    let interpreter = notebookSessions.get(params.sessionId);
    if (!interpreter) {
      interpreter = new ArenaScriptInterpreter(workspaceManager.globalModelicaQueryEngine);
      notebookSessions.set(params.sessionId, interpreter);
    }

    const result = interpreter.execute(tree.rootNode);
    return result;
  });

  connection.onRequest("modelscript/resetNotebookSession", async (params: { sessionId: string }) => {
    notebookSessions.delete(params.sessionId);
    return { success: true };
  });

  connection.onRequest("modelscript/compileWasm", async (params: { uri: string }) => {
    const ctx = workspaceManager.documentContexts.get(params.uri);
    const doc = documents.get(params.uri);
    if (!ctx || !doc) throw new Error("Document not found or no context available.");

    const instances = workspaceManager.documentInstances.get(params.uri);
    if (!instances || instances.length === 0) throw new Error("No Modelica classes found in the active document.");

    const targetInstance = instances[0];
    const targetClass = targetInstance.name;
    if (!targetClass) throw new Error("Could not determine model name.");

    const arena = flattenArenaFromInstance(targetInstance, ctx);
    const simulator = new ArenaSimulator(arena);
    simulator.prepare();
    const stateVars = new Set<string>();
    for (const varIdx of simulator.stateVars) {
      stateVars.add(arena.getVarName(varIdx));
    }

    // Generate the FMU result for scalar variable metadata
    const { generateFmu } = await import("@modelscript/fmi");
    const fmuResult = generateFmu(arena, { modelIdentifier: targetClass }, stateVars);

    // Generate WASM-targeted C source
    const wasmResult = generateFmuWasmSource(arena, fmuResult, { modelIdentifier: targetClass });

    return {
      wasmC: wasmResult.wasmC,
      emccFlags: wasmResult.emccFlags,
      exportedFunctions: wasmResult.exportedFunctions,
      scalarVariables: fmuResult.scalarVariables.map((sv) => ({
        name: sv.name,
        valueReference: sv.valueReference,
        causality: sv.causality,
      })),
    };
  });

  connection.onRequest("modelscript/debuggerContinue", (params?: any) => {
    stepMode = params?.step || false;
    if (debuggerResumeCallback) {
      debuggerResumeCallback();
      debuggerResumeCallback = undefined;
    }
    return { ok: true };
  });

  connection.onRequest("modelscript/debuggerVariables", () => {
    if (!currentDebugEnv) return [];
    // Sort variables alphabetically for better UX
    const entries = Array.from(currentDebugEnv.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return entries.map(([name, value]) => ({
      name,
      value: formatDebugValue(value),
      variablesReference: 0,
    }));
  });
}
