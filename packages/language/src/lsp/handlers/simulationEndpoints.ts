/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { ArenaScriptInterpreter } from "@modelscript/modelica/arena-script-interpreter";
import { Causality, DAEBuilder } from "../../compiler/index.js";
import { ArenaSimulator, simulateArena, simulateArenaAsync } from "../../compiler/simulator/index.js";
import { CoSimSession, Orchestrator } from "../../cosim/index.js";
import { WasmOpenFoamProvider } from "../../cosim/participants/cfd-provider.js";
import { generateFmuWasmSource, generateMultiModelWrapper } from "../../fmu/index.js";
import { LspContext } from "../LspContext.js";
import { getArenaParameterInfo } from "../utils/arenaUtils.js";
import { getCompositeName } from "../utils/hierarchyUtils.js";
import { ModelScriptParticipant } from "./modelscriptParticipant.js";

const notebookSessions = new Map<string, any>();

function formatDebugValue(val: unknown): string {
  if (typeof val === "number") return val.toFixed(4);
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "object" && val !== null && "elements" in val) {
    const arrVal = val as { elements: unknown[] };
    return `[${arrVal.elements.map(formatDebugValue).join(", ")}]`;
  }
  return String(val);
}

function resolveTargetClass(
  context: LspContext,
  uri: string,
  className?: string,
): { symbolId: number; className: string; classKind: string } | null {
  const unifiedIndex = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();
  if (className) {
    const parts = className.split(".");
    const candidates = unifiedIndex.byName.get(parts[parts.length - 1]);
    if (candidates && candidates.length > 0) {
      for (const id of candidates) {
        const entry = unifiedIndex.symbols.get(id);
        if (entry && (entry.name === className || getCompositeName(entry, unifiedIndex) === className)) {
          return {
            symbolId: id,
            className: entry.name,
            classKind: (entry.metadata?.classKind as string) ?? "class",
          };
        }
      }
    }
  }

  // Fallback: search for top-level class in the specified URI
  for (const [id, entry] of unifiedIndex.symbols.entries()) {
    if (entry.resourceId === uri && (entry.kind === "Class" || entry.kind === "Def") && entry.parentId === null) {
      return {
        symbolId: id,
        className: entry.name,
        classKind: (entry.metadata?.classKind as string) ?? "class",
      };
    }
  }

  return null;
}

function flattenTargetClass(
  context: LspContext,
  uri: string,
  className?: string,
): { arena: DAEBuilder; target: { symbolId: number; className: string; classKind: string } } | { error: string } {
  const target = resolveTargetClass(context, uri, className);
  if (!target) {
    return { error: `No class definition found for '${className || uri}'` };
  }
  const sharedContext = context.parserService.sharedContext;
  if (!sharedContext) {
    return { error: "Shared Context not ready." };
  }
  const arena = sharedContext.flattenArena(target.className, target.symbolId, uri);
  if (!arena) {
    return { error: `Failed to flatten class '${target.className}'` };
  }
  return { arena, target };
}

export function registerSimulationEndpoints(context: LspContext) {
  context.connection.onRequest(
    "modelscript/simulate",
    async (params: {
      uri: string;
      className?: string;
      startTime?: number;
      stopTime?: number;
      interval?: number;
      equidistant?: boolean;
      solver?: string;
      format?: string;
      parameterOverrides?: Record<string, number>;
      sweepConfig?: { parameterName: string; start: number; end: number; steps: number };
    }): Promise<{
      t: number[];
      y: number[][];
      states: string[];
      parameters?: {
        name: string;
        type: "real" | "integer" | "boolean" | "enumeration";
        defaultValue: number;
        min?: number;
        max?: number;
        step: number;
        unit?: string;
        enumLiterals?: { ordinal: number; label: string }[];
      }[];
      experiment?: { startTime?: number; stopTime?: number; interval?: number; tolerance?: number };
      error?: string;
      sweepResults?: { value: number; y: number[][] }[];
    }> => {
      context.connection.console.info(
        `[simulate] Requested simulation for URI: ${params.uri} class: ${params.className}`,
      );
      const doc = context.documents.get(params.uri);
      if (doc) {
        await context.validationService.validateTextDocument(doc);
        const inflight = context.state.activeValidationPromises.get(params.uri);
        if (inflight) await inflight;
      }

      try {
        // Ensure MSL index is ready if dependencies are pending
        if (!context.state.dependenciesReady && context.workspaceManager.globalWorkspaceIndex.pendingFileCount > 0) {
          context.connection.console.info(`[simulate] MSL not fully indexed — forcing full index...`);
          context.connection.sendNotification("modelscript/status", {
            state: "loading",
            message: "Indexing MSL for simulation...",
          });
          await context.workspaceManager.globalWorkspaceIndex.indexRemainingInBackground(50);
          context.connection.sendNotification("modelscript/status", { state: "ready", message: getReadyMessage() });
        }

        const flat = flattenTargetClass(context, params.uri, params.className);
        if ("error" in flat) {
          return { t: [], y: [], states: [], error: flat.error };
        }
        const { arena, target } = flat;

        if (target.classKind === "process") {
          context.connection.console.info(`[simulate] Detected process. Launching Co-Simulation Orchestrator...`);
          const session = new CoSimSession("vscode-cosim");
          const exp = arena.experiment;
          const cosimStartTime = params.startTime ?? exp.startTime ?? 0;
          const cosimStopTime = params.stopTime ?? exp.stopTime ?? 0.1;
          const cosimStepSize = params.interval ?? exp.interval ?? 0.05;

          session.experiment = {
            startTime: cosimStartTime,
            stopTime: cosimStopTime,
            stepSize: cosimStepSize,
            tolerance: exp.tolerance ?? 1e-4,
          };

          const cfd = new WasmOpenFoamProvider("3d-cfd", "InjectionCavity");
          cfd.metadata.variables = [
            { name: "gateInlet.p", causality: "input", type: "Real" },
            { name: "gateInlet.m_flow", causality: "output", type: "Real" },
          ];

          const modelica = new ModelScriptParticipant("1d-solver", target.className, arena);

          session.addParticipant(cfd);
          session.addParticipant(modelica);

          session.coupling.addCoupling({
            from: { participantId: "1d-solver", variableName: "fluidOut.p" },
            to: { participantId: "3d-cfd", variableName: "gateInlet.p" },
          });
          session.coupling.addCoupling({
            from: { participantId: "3d-cfd", variableName: "gateInlet.m_flow" },
            to: { participantId: "1d-solver", variableName: "fluidOut.m_flow" },
          });

          // Create the orchestrator
          const orchestrator = new Orchestrator(session, null, {
            onStep: (res) => {
              context.connection.console.info(`[Orchestrator] Step completed at t=${res.time}.`);
              context.connection.sendNotification("modelscript/cosimStream", {
                type: "step",
                time: res.time,
              });
            },
            onVtkData: (pid, time, data) => {
              context.connection.console.info(
                `[Orchestrator] VTK Data extracted from ${pid} at t=${time}. Length: ${data.length}`,
              );
              // Send the VTK blob
              context.connection.sendNotification("modelscript/cosimStream", {
                type: "vtk",
                participantId: pid,
                time,
                data: Array.from(data),
              });
            },
            onComplete: () => {
              context.connection.console.info("[Orchestrator] Simulation completed.");
              context.connection.sendNotification("modelscript/cosimStream", { type: "complete" });
            },
            onError: (err) => {
              context.connection.console.error(`[Orchestrator] Simulation failed: ${err.message}`);
              context.connection.sendNotification("modelscript/cosimStream", { type: "error", message: err.message });
            },
            stepFiles: new Map([["3d-cfd", new Uint8Array([83, 84, 69, 80])]]), // mock step file
          });

          // Run asynchronously in the background so we can return empty result to close the request
          orchestrator.run().catch((e) => console.error("Orchestrator failed:", e));

          return { t: [], y: [], states: [], parameters: [], experiment: exp };
        }

        context.connection.console.info(`[simulate] Arena active variables: ${arena.activeVarCount}`);
        context.connection.console.info(`[simulate] Arena equations: ${arena.eqCount}`);

        const exp = arena.experiment;
        const startTime = params.startTime ?? exp.startTime ?? 0;
        const stopTime = params.stopTime ?? exp.stopTime ?? 10;
        const step = params.interval ?? exp.interval ?? (stopTime - startTime) / 500;

        context.connection.console.info(`[simulate] startTime=${startTime}, stopTime=${stopTime}, step=${step}`);

        if (params.sweepConfig) {
          const { parameterName, start, end, steps } = params.sweepConfig;
          const sweepResults: { value: number; y: number[][] }[] = [];
          let baseT: number[] = [];
          let baseStates: string[] = [];

          for (let i = 0; i < steps; i++) {
            const val = steps > 1 ? start + i * ((end - start) / (steps - 1)) : start;
            const overrides = params.parameterOverrides ? { ...params.parameterOverrides } : {};
            overrides[parameterName] = val;

            const arenaResult = simulateArena(arena, {
              startTime,
              stopTime,
              step,
              solver: (params.solver ?? "dopri5") as any,
              parameterOverrides: new Map(Object.entries(overrides)),
            });

            if (i === 0) {
              baseT = arenaResult.t;
              baseStates = arenaResult.states;
            }
            sweepResults.push({ value: val, y: arenaResult.y });
          }

          return {
            t: baseT,
            y: sweepResults[0]?.y ?? [],
            states: baseStates,
            parameters: getArenaParameterInfo(arena),
            experiment: exp,
            sweepResults,
          };
        }

        const result = simulateArena(arena, {
          startTime,
          stopTime,
          step,
          solver: (params.solver ?? "dopri5") as any,
          parameterOverrides: params.parameterOverrides
            ? new Map(Object.entries(params.parameterOverrides))
            : undefined,
        });

        context.connection.console.info(
          `[simulate] Result: ${result.t.length} time points, ${result.states.length} states`,
        );

        if (params.format === "csv") {
          const lines = [`time,${result.states.join(",")}`];
          for (let i = 0; i < result.t.length; i++) {
            const values = [result.t[i], ...result.states.map((_: string, vi: number) => result.y[i]?.[vi] ?? 0)];
            lines.push(values.join(","));
          }
          return {
            t: result.t,
            y: result.y,
            states: result.states,
            parameters: getArenaParameterInfo(arena),
            experiment: exp,
          };
        }

        return {
          t: result.t,
          y: result.y,
          states: result.states,
          parameters: getArenaParameterInfo(arena),
          experiment: exp,
        };
      } catch (e) {
        console.error("[simulate] Error:", e);
        return {
          t: [],
          y: [],
          states: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/simulateInit",
    (params: {
      uri: string;
      participantId: string;
      stepSize?: number;
      className?: string;
    }): {
      ok: boolean;
      variables?: { name: string; causality: string }[];
      error?: string;
    } => {
      try {
        const flat = flattenTargetClass(context, params.uri, params.className);
        if ("error" in flat) {
          return { ok: false, error: flat.error };
        }
        const { arena } = flat;

        // Initialize current values from start attributes
        const currentValues = new Map<string, number>();
        for (let i = 0; i < arena.varCount; i++) {
          if (arena.isVarRemoved(i)) continue;
          const startVal = arena.getVarStartValue(i);
          if (startVal !== undefined && typeof startVal === "number") {
            currentValues.set(arena.getVarName(i), startVal);
          }
        }

        // Store the simulation state
        cosimSimulators.set(params.participantId, {
          arena,
          currentValues,
          stepSize: params.stepSize ?? 0.01,
        });

        // Build variable list with causality info
        const variables: { name: string; causality: string }[] = [];
        for (let i = 0; i < arena.varCount; i++) {
          if (arena.isVarRemoved(i)) continue;
          const causalityVal = arena.getVarCausality(i);
          const causalityStr =
            causalityVal === Causality.Input ? "input" : causalityVal === Causality.Output ? "output" : "local";
          variables.push({
            name: arena.getVarName(i),
            causality: causalityStr,
          });
        }

        return { ok: true, variables };
      } catch (e) {
        console.error("[simulateInit] Error:", e);
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/simulateStep",
    (params: {
      participantId: string;
      inputs: Record<string, number>;
      time: number;
    }): {
      outputs: Record<string, number>;
      error?: string;
    } => {
      const simState = cosimSimulators.get(params.participantId);
      if (!simState) {
        return { outputs: {}, error: `No simulator found for participant ${params.participantId}` };
      }

      try {
        const { arena, currentValues, stepSize } = simState;

        // Apply input values
        for (const [name, val] of Object.entries(params.inputs)) {
          currentValues.set(name, val);
        }

        // Set up parameter overrides with current values
        const overrides = new Map<string, number>(currentValues);

        // Step the simulation forward by stepSize
        const stepResult = simulateArena(arena, {
          startTime: params.time,
          stopTime: params.time + stepSize,
          step: stepSize,
          solver: "euler",
          parameterOverrides: overrides,
        });

        // Update current values with the final state
        const lastIdx = stepResult.t.length - 1;
        if (lastIdx >= 0) {
          for (let vi = 0; vi < stepResult.states.length; vi++) {
            const stateName = stepResult.states[vi];
            const val = stepResult.y[lastIdx]?.[vi];
            if (val !== undefined) {
              currentValues.set(stateName, val);
            }
          }
        }

        // Collect outputs
        const outputs: Record<string, number> = {};
        for (let i = 0; i < arena.varCount; i++) {
          if (arena.isVarRemoved(i)) continue;
          if (arena.getVarCausality(i) === Causality.Output) {
            const name = arena.getVarName(i);
            outputs[name] = currentValues.get(name) ?? 0;
          }
        }

        return { outputs };
      } catch (e) {
        console.error("[simulateStep] Error:", e);
        return { outputs: {}, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/createCosimWrapper",
    async (params: {
      modelNames: string[];
      couplings: {
        from: { model: string; variable: string };
        to: { model: string; variable: string };
      }[];
      wrapperName: string;
      uri: string;
    }): Promise<{ ok: boolean; source?: string; error?: string }> => {
      try {
        const models = params.modelNames.map((name) => {
          const classInstance = context.workspaceManager.resolveModelicaClassInstance(params.uri, name);
          if (!classInstance) throw new Error(`Could not resolve Modelica class ${name}`);
          return classInstance;
        });

        const source = generateMultiModelWrapper(
          models,
          params.couplings.map((c) => ({
            fromModel: c.from.model,
            fromVar: c.from.variable,
            toModel: c.to.model,
            toVar: c.to.variable,
          })),
          params.wrapperName,
        );

        return { ok: true, source };
      } catch (e) {
        console.error("[createCosimWrapper] Error:", e);
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onNotification(
    "modelscript/setBreakpoints",
    (params: { uri: string; breakpoints: { line: number; column?: number }[] }) => {
      breakpointsMap.set(params.uri, params.breakpoints);
    },
  );

  context.connection.onRequest(
    "modelscript/simulateDebug",
    async (params: { uri: string; className?: string }): Promise<unknown> => {
      const doc = context.documents.get(params.uri);
      if (doc) {
        await context.validationService.validateTextDocument(doc);
        const inflight = context.state.activeValidationPromises.get(params.uri);
        if (inflight) await inflight;
      }

      try {
        const flat = flattenTargetClass(context, params.uri, params.className);
        if ("error" in flat) {
          return { error: flat.error };
        }
        const { arena } = flat;

        stepMode = true; // Reset step mode on new simulation run

        const exp = arena.experiment;
        const startTime = exp.startTime ?? 0;
        const stopTime = exp.stopTime ?? 10;
        const step = exp.interval ?? (stopTime - startTime) / 100;

        const debuggerHook = {
          onArenaStatement: async (arenaBuilder: DAEBuilder, stmtIdx: number, valuesByStringId: Float64Array) => {
            const loc = arenaBuilder.stmtLocations.get(stmtIdx);
            const line = loc ? loc.startLine : undefined;
            const col = loc ? loc.startCol : undefined;

            const bps = breakpointsMap.get(params.uri) || [];
            const isBreakpoint = line !== undefined && bps.some((bp) => bp.line === line);

            if (stepMode || isBreakpoint) {
              stepMode = false;

              const env = new Map<string, number>();
              for (let i = 0; i < arenaBuilder.varCount; i++) {
                if (arenaBuilder.isVarRemoved(i)) continue;
                const name = arenaBuilder.getVarName(i);
                const nameId = arenaBuilder.getVarNameId(i);
                const val = valuesByStringId[nameId];
                if (val !== undefined) {
                  env.set(name, val);
                }
              }
              currentDebugEnv = env;

              // Send notification to the VS Code client
              context.connection.sendNotification("modelscript/debuggerStopped", {
                uri: params.uri,
                line,
                column: col,
              });

              // Wait for client to send modelscript/debuggerContinue
              await new Promise<void>((resolve) => {
                debuggerResumeCallback = resolve;
              });
              currentDebugEnv = undefined;
            }
          },
        };

        const result = await simulateArenaAsync(arena, {
          startTime,
          stopTime,
          step,
          debuggerHook,
        });
        return result;
      } catch (error: unknown) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/simulateTerminate",
    (params: { participantId: string }): { ok: boolean } => {
      cosimSimulators.delete(params.participantId);
      return { ok: true };
    },
  );

  context.connection.onRequest("modelscript/runScript", async (params: { uri: string }) => {
    if (!context.state.sharedContext || !context.workspaceManager.globalModelicaQueryEngine) {
      return { output: "", error: "Language server not fully initialized." };
    }
    const text = context.state.sharedContext.fs.read(params.uri);
    if (!text) {
      return { output: "", error: "File not found." };
    }

    const tree = context.state.sharedContext.parse(".mos", text);
    if (!tree || !tree.rootNode) {
      return { output: "", error: "Failed to parse script." };
    }

    const interpreter = new ArenaScriptInterpreter(context.workspaceManager.globalModelicaQueryEngine);
    const result = interpreter.execute(tree.rootNode);
    return result;
  });

  context.connection.onRequest("modelscript/runNotebookCell", async (params: { sessionId: string; code: string }) => {
    if (!context.state.sharedContext || !context.workspaceManager.globalModelicaQueryEngine) {
      return { output: "", error: "Language server not fully initialized." };
    }

    const tree = context.state.sharedContext.parse(".mos", params.code);
    if (!tree || !tree.rootNode) {
      return { output: "", error: "Failed to parse cell." };
    }

    let interpreter = notebookSessions.get(params.sessionId);
    if (!interpreter) {
      interpreter = new ArenaScriptInterpreter(context.workspaceManager.globalModelicaQueryEngine);
      notebookSessions.set(params.sessionId, interpreter);
    }

    const result = interpreter.execute(tree.rootNode);
    return result;
  });

  context.connection.onRequest("modelscript/resetNotebookSession", async (params: { sessionId: string }) => {
    notebookSessions.delete(params.sessionId);
    return { success: true };
  });

  context.connection.onRequest("modelscript/compileWasm", async (params: { uri: string }) => {
    const ctx = context.workspaceManager.documentContexts.get(params.uri);
    const doc = context.documents.get(params.uri);
    if (!ctx || !doc) throw new Error("Document not found or no context available.");

    const instances = context.workspaceManager.documentInstances.get(params.uri);
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
    const { generateFmu } = await import("../../fmu/index.js");
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

  context.connection.onRequest("modelscript/debuggerContinue", (params?: any) => {
    stepMode = params?.step || false;
    if (debuggerResumeCallback) {
      debuggerResumeCallback();
      debuggerResumeCallback = undefined;
    }
    return { ok: true };
  });

  context.connection.onRequest("modelscript/debuggerVariables", () => {
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

// @ts-nocheck
