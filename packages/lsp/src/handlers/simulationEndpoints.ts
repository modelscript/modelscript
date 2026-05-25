/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { Connection } from "vscode-languageserver";

export function registerSimulationEndpoints(connection: Connection, documentManager: any, workspaceManager: any) {
  connection.onRequest(
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
      connection.console.info(`[simulate] Requested simulation for URI: ${params.uri}`);
      connection.console.info(
        `[simulate] workspaceManager.documentInstances has ${workspaceManager.documentInstances.size} entries.`,
      );
      let instances = workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) {
        // Force-validate the document so the polyglot index is populated
        const doc = documents.get(params.uri);
        if (doc) {
          connection.console.info(`[simulate] No instances yet — force-validating ${params.uri}`);
          await validateTextDocument(doc);
          instances = workspaceManager.documentInstances.get(params.uri);
        }
      }
      if (!instances || instances.length === 0) {
        connection.console.info(
          `[simulate] Instances array empty/undefined for ${params.uri}. Available URIs: ${Array.from(workspaceManager.documentInstances.keys()).join(", ")}`,
        );
        return { t: [], y: [], states: [], error: "No class instances found for this document." };
      }

      let classInstance = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className);
        if (found) classInstance = found;
      }

      try {
        // Ensure the full MSL index is available before flattening — the flattener
        // resolves component types like Modelica.Electrical.Analog.Sources.SineVoltage
        // which require MSL to be fully indexed.
        if (!mslStdlibReady && workspaceManager.globalWorkspaceIndex.pendingFileCount > 0) {
          connection.console.info(`[simulate] MSL not fully indexed — forcing full index...`);
          connection.sendNotification("modelscript/status", {
            state: "loading",
            message: "Indexing MSL for simulation...",
          });
          await workspaceManager.globalWorkspaceIndex.indexRemainingInBackground(50);
          mslStdlibReady = true;
          connection.sendNotification("modelscript/status", { state: "ready", message: getReadyMessage() });

          // Re-create the query engine with the full unified index
          const fullIndex = workspaceManager.unifiedWorkspace.toUnifiedPartial();
          injectPredefinedTypes(fullIndex);
          const engine = params.uri.endsWith(".sysml")
            ? workspaceManager.globalSysML2QueryEngine
            : workspaceManager.globalModelicaQueryEngine;
          if (engine) {
            engine.updateIndex(fullIndex);
            const resolver = (engine as any).__resolverCache;
            if (resolver) resolver.updateIndex(fullIndex);
          }

          // Re-validate to rebuild instances with full index
          const doc = documents.get(params.uri);
          if (doc) await validateTextDocument(doc);
          instances = workspaceManager.documentInstances.get(params.uri);
          if (!instances || instances.length === 0) {
            return { t: [], y: [], states: [], error: "No class instances found after MSL indexing." };
          }
          classInstance = params.className
            ? (instances.find((i) => i.name === params.className) ?? instances[0])
            : instances[0];
        }

        const context = workspaceManager.documentContexts.get(params.uri);
        if (!context) {
          return { t: [], y: [], states: [], error: `No Modelica context found for URI '${params.uri}'` };
        }

        const arena = flattenArenaFromInstance(classInstance, context);

        connection.console.info(`[simulate] Arena active variables: ${arena.activeVarCount}`);
        connection.console.info(`[simulate] Arena equations: ${arena.eqCount}`);

        const exp = arena.experiment;
        const startTime = params.startTime ?? exp.startTime ?? 0;
        const stopTime = params.stopTime ?? exp.stopTime ?? 10;
        const step = params.interval ?? exp.interval ?? (stopTime - startTime) / 500;

        connection.console.info(`[simulate] startTime=${startTime}, stopTime=${stopTime}, step=${step}`);

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

        connection.console.info(`[simulate] Result: ${result.t.length} time points, ${result.states.length} states`);

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

  connection.onRequest(
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
      const instances = workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) {
        return { ok: false, error: "No class instances found for this document." };
      }

      let classInstance = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className);
        if (found) classInstance = found;
      }

      try {
        const context = workspaceManager.documentContexts.get(params.uri);
        if (!context) {
          return { ok: false, error: `No Modelica context found for URI '${params.uri}'` };
        }

        const arena = flattenArenaFromInstance(classInstance, context);

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

  connection.onRequest(
    "modelscript/simulateStep",
    (params: {
      participantId: string;
      currentTime: number;
      stepSize: number;
      inputs?: Record<string, number>;
    }): {
      ok: boolean;
      outputs?: Record<string, number>;
      allValues?: Record<string, number>;
      error?: string;
    } => {
      const entry = cosimSimulators.get(params.participantId);
      if (!entry) {
        return { ok: false, error: `Participant '${params.participantId}' not initialized.` };
      }

      try {
        // Apply input overrides (set them in current values before stepping)
        if (params.inputs) {
          for (const [name, value] of Object.entries(params.inputs)) {
            entry.currentValues.set(name, value);
          }
        }

        // Write all current values to the arena's start values before simulating
        for (const [name, val] of entry.currentValues) {
          try {
            const idx = entry.arena.getVarIdxByName(name);
            if (idx !== -1) {
              entry.arena.setVarStartValue(idx, val);
            }
          } catch {
            // ignore
          }
        }

        // Step the simulation by one communication interval
        const result = simulateArena(entry.arena, {
          startTime: params.currentTime,
          stopTime: params.currentTime + params.stepSize,
          step: params.stepSize,
          solver: "rk4",
        });

        // Extract values from the last time point
        const lastIdx = result.t.length - 1;
        if (lastIdx >= 0) {
          for (let i = 0; i < result.states.length; i++) {
            const name = result.states[i];
            const value = result.y[lastIdx]?.[i];
            if (name && value !== undefined) {
              entry.currentValues.set(name, value);
            }
          }
        }

        // Collect outputs (variables with causality "output")
        const outputs: Record<string, number> = {};
        const allValues: Record<string, number> = {};
        for (let i = 0; i < entry.arena.varCount; i++) {
          if (entry.arena.isVarRemoved(i)) continue;
          const name = entry.arena.getVarName(i);
          const val = entry.currentValues.get(name);
          if (val !== undefined) {
            allValues[name] = val;
            if (entry.arena.getVarCausality(i) === Causality.Output) {
              outputs[name] = val;
            }
          }
        }

        return { ok: true, outputs, allValues };
      } catch (e) {
        console.error("[simulateStep] Error:", e);
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  connection.onRequest(
    "modelscript/createCosimWrapper",
    (params: {
      modelName: string;
      fmus: { className: string; instanceName: string; fileName: string }[];
      connections?: { source: string; target: string }[];
    }): { ok: boolean; source?: string; error?: string } => {
      try {
        const source = generateMultiModelWrapper(params.modelName, params.fmus, params.connections ?? []);
        return { ok: true, source };
      } catch (e) {
        console.error("[createCosimWrapper] Error:", e);
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  connection.onNotification(
    "modelscript/setBreakpoints",
    (params: { uri: string; breakpoints: { line: number; column?: number }[] }) => {
      breakpointsMap.set(params.uri, params.breakpoints);
    },
  );

  connection.onRequest(
    "modelscript/simulateDebug",
    async (params: { uri: string; className?: string }): Promise<unknown> => {
      let instances = workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) {
        const doc = documents.get(params.uri);
        if (doc) {
          await validateTextDocument(doc);
          instances = workspaceManager.documentInstances.get(params.uri);
        }
      }
      if (!instances || instances.length === 0) {
        return {
          error: `No class instances found for ${params.uri}. Available: ${Array.from(workspaceManager.documentInstances.keys()).join(", ")}`,
        };
      }

      let classInstance = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className);
        if (found) classInstance = found;
      }

      try {
        const context = workspaceManager.documentContexts.get(params.uri);
        if (!context) return { error: "No context found" };

        const arena = flattenArenaFromInstance(classInstance, context);

        stepMode = true; // Reset step mode on new simulation run

        const exp = arena.experiment;
        const startTime = exp.startTime ?? 0;
        const stopTime = exp.stopTime ?? 10;
        const step = exp.interval ?? (stopTime - startTime) / 100;

        const debuggerHook = {
          onArenaStatement: async (arenaBuilder: ArenaDAEBuilder, stmtIdx: number, valuesByStringId: Float64Array) => {
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
              connection.sendNotification("modelscript/debuggerStopped", {
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
}

// @ts-nocheck
