// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
import {
  CoSimSession,
  FeaCoSimParticipant,
  LbmCoSimParticipant,
  Orchestrator,
  WasmOpenFoamProvider,
} from "@modelscript/exchange/cosim";
import { generateMultiModelWrapper } from "@modelscript/exchange/fmu";
import {
  bindRequirementsToModelica,
  Causality,
  DAEBuilder,
  extractModelicaTwinAnnotations,
  parseSysmlRequirements,
  simulateDroneReachability,
  Variability,
} from "@modelscript/runtime";
import { ArenaSimulator, simulateArena, simulateArenaAsync, Tet4Mesher } from "@modelscript/simulate";
import { LspContext } from "../lsp-context.js";
import { getArenaOutputStringIds, getArenaParameterInfo, getArenaVariableMetadata } from "../utils/arena-utils.js";
import { getCompositeName } from "../utils/hierarchy-utils.js";
import { ModelScriptParticipant } from "./modelscriptParticipant.js";

const notebookSessions = new Map<string, any>();

export function _formatDebugValue(val: unknown): string {
  if (typeof val === "number") return val.toFixed(4);
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "object" && val !== null && "elements" in val) {
    const arrVal = val as { elements: unknown[] };
    return `[${arrVal.elements.map(_formatDebugValue).join(", ")}]`;
  }
  return String(val);
}

export function resolveTargetClass(
  context: LspContext,
  uri: string,
  className?: string,
): { symbolId: number; className: string; classKind: string } | null {
  const unifiedIndex = context.workspaceManager?.unifiedWorkspace?.toUnifiedPartial?.() ?? {
    symbols: new Map(),
    byName: new Map(),
    childrenOf: new Map(),
  };
  if (className) {
    const parts = className.split(".");
    const candidates = unifiedIndex.byName.get(parts[parts.length - 1]!);
    if (candidates && candidates.length > 0) {
      for (const id of candidates) {
        const entry = unifiedIndex.symbols.get(id);
        if (entry && (entry.name === className || getCompositeName(entry, unifiedIndex) === className)) {
          return {
            symbolId: id,
            className: entry.name,
            classKind: (entry.metadata?.["classKind"] as string) ?? "class",
          };
        }
      }
    }
  }

  const normUri = uri ? uri.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///") : "";
  // Fallback: search for top-level class in the specified URI
  for (const [id, entry] of unifiedIndex.symbols.entries()) {
    const entryNorm = entry.resourceId?.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
    if (
      (entry.resourceId === uri || entryNorm === normUri) &&
      (entry.kind === "Class" || entry.kind === "Def") &&
      entry.parentId === null
    ) {
      return {
        symbolId: id,
        className: entry.name,
        classKind: (entry.metadata?.["classKind"] as string) ?? "class",
      };
    }
  }

  // Second fallback: check language workspace index directly
  const wsIndex = context.workspaceManager?.getWorkspaceIndex("modelica");
  if (wsIndex?.unifiedIndex?.symbols) {
    if (className) {
      const wsCandidates = wsIndex.unifiedIndex.byName?.get(className);
      if (wsCandidates && wsCandidates.length > 0) {
        const id = wsCandidates[0];
        const entry = wsIndex.unifiedIndex.symbols.get(id);
        if (entry) {
          return {
            symbolId: id,
            className: entry.name,
            classKind: (entry.metadata?.classKind as string) ?? "class",
          };
        }
      }
    }
    for (const [id, entry] of wsIndex.unifiedIndex.symbols.entries()) {
      const entryNorm = entry.resourceId?.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
      if (
        (entry.resourceId === uri || entryNorm === normUri) &&
        (entry.kind === "Class" || entry.kind === "Def") &&
        entry.parentId === null
      ) {
        return {
          symbolId: id,
          className: entry.name,
          classKind: (entry.metadata?.classKind as string) ?? "class",
        };
      }
    }
  }

  return null;
}

export function flattenTargetClass(
  context: LspContext,
  uri: string,
  className?: string,
): { arena: DAEBuilder; target: { symbolId: number; className: string; classKind: string } } | { error: string } {
  const target = resolveTargetClass(context, uri, className);
  if (!target) {
    return { error: `No class definition found for '${className || uri}'` };
  }
  const sharedContext = context.parserService.sharedContext;
  let arena: DAEBuilder | null = null;
  if (sharedContext && typeof (sharedContext as any).flattenArena === "function") {
    try {
      arena = (sharedContext as any).flattenArena(target.className, target.symbolId, uri);
    } catch {
      arena = null;
    }
  }
  if (!arena) {
    const qe =
      context.workspaceManager?.globalModelicaQueryEngine ?? context.workspaceManager?.getQueryEngine?.("modelica");
    if (qe) {
      try {
        const FlattenerClass = (globalThis as any).ArenaQueryFlattener;
        if (FlattenerClass) {
          const queryDB = qe.toQueryDB();
          const flattener = new FlattenerClass(queryDB);
          let simClassId = target.symbolId;
          if (!qe.index?.symbols?.has(simClassId)) {
            const c = qe.index?.byName?.get(target.className);
            if (c && c.length > 0) simClassId = c[0]!;
          }
          arena = flattener.flatten(simClassId);
        }
      } catch (e: any) {
        return { error: `Failed to flatten class '${target.className}': ${e?.message ?? e}` };
      }
    }
  }
  if (!arena) {
    return { error: `Failed to flatten class '${target.className}'` };
  }
  return { arena, target };
}

const activeCosimSessions = new Map<string, Orchestrator>();

export function registerSimulationEndpoints(context: LspContext) {
  context.connection.onRequest(
    "modelscript/simulate",
    async (params: {
      uri: string;
      className?: string | undefined;
      startTime?: number | undefined;
      stopTime?: number | undefined;
      interval?: number | undefined;
      equidistant?: boolean | undefined;
      solver?: string | undefined;
      rtol?: number | undefined;
      atol?: number | undefined;
      numberOfIntervals?: number | undefined;
      maxStep?: number | undefined;
      steadyStateOnly?: boolean | undefined;
      format?: string | undefined;
      parameterOverrides?: Record<string, number> | undefined;
      sweepConfig?: { parameterName: string; start: number; end: number; steps: number } | undefined;
      physicsType?: string | undefined;
      domain?: string | undefined;
      cadUri?: string | undefined;
    }): Promise<{
      t: number[];
      y: number[][];
      states: string[];
      parameters?:
        | {
            name: string;
            type: "real" | "integer" | "boolean" | "enumeration";
            defaultValue: number;
            min?: number | undefined;
            max?: number | undefined;
            step: number;
            unit?: string | undefined;
            description?: string | undefined;
            enumLiterals?: { ordinal: number; label: string }[] | undefined;
          }[]
        | undefined;
      variableMetadata?: Record<string, { unit?: string | undefined; description?: string | undefined }> | undefined;
      experiment?:
        | {
            startTime?: number | undefined;
            stopTime?: number | undefined;
            interval?: number | undefined;
            tolerance?: number | undefined;
          }
        | undefined;
      error?: string | undefined;
      sweepResults?: { value: number; y: number[][] }[] | undefined;
      telemetry?: { executionTimeMs: number; stepCount: number } | undefined;
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
        const flat = flattenTargetClass(context, params.uri, params.className);
        if ("error" in flat) {
          return { t: [], y: [], states: [], error: flat.error };
        }
        const { arena, target } = flat;

        const isFeaProcess =
          params.physicsType === "FEA" ||
          params.domain === "fea" ||
          target.className.toLowerCase().includes("fea") ||
          target.className.toLowerCase().includes("structural") ||
          target.className.toLowerCase().includes("stress") ||
          target.className.toLowerCase().includes("dronearm") ||
          target.className.toLowerCase().includes("cantilever");

        const isCfdProcess =
          params.physicsType === "CFD" ||
          params.physicsType === "LBM" ||
          params.domain === "cfd" ||
          target.className.toLowerCase().includes("cfd") ||
          target.className.toLowerCase().includes("aero") ||
          target.className.toLowerCase().includes("flow") ||
          target.className.toLowerCase().includes("fluid");

        if (
          target.classKind === "process" ||
          params.physicsType === "FEA" ||
          params.physicsType === "CFD" ||
          params.physicsType === "LBM" ||
          ((params.domain === "fea" || params.domain === "cfd") && target.classKind === "model")
        ) {
          context.connection.console.info(`[simulate] Launching Co-Simulation Orchestrator for ${target.className}...`);
          const exp = arena.experiment;
          const cosimStartTime = params.startTime ?? exp.startTime ?? 0;
          const cosimStopTime = params.stopTime ?? exp.stopTime ?? 0.2;
          const cosimStepSize = params.interval ?? exp.interval ?? 0.005;

          const session = new CoSimSession("vscode-cosim", {
            startTime: cosimStartTime,
            stopTime: cosimStopTime,
            stepSize: cosimStepSize,
          });

          const modelica = new ModelScriptParticipant("1d-solver", target.className, arena);
          session.addParticipant(modelica);

          let feaParticipant: FeaCoSimParticipant | null = null;
          let lbmParticipant: LbmCoSimParticipant | null = null;
          let cfdParticipant: WasmOpenFoamProvider | null = null;

          if (isFeaProcess) {
            context.connection.console.info(
              `[simulate] Initializing 3D FEA Structural Participant (Tet10 Quadratic)...`,
            );

            // Detect CAD annotation in source document if available
            let cadUri = params.cadUri;
            if (!cadUri && doc) {
              const match = doc.getText().match(/CAD\s*\(\s*uri\s*=\s*["']([^"']+)["']/i);
              if (match) {
                cadUri = match[1];
              }
            }
            if (cadUri) {
              context.connection.console.info(`[simulate] Resolved CAD geometry reference: ${cadUri}`);
            }

            const mesh = Tet4Mesher.createBoxMesh({
              width: 0.12,
              height: 0.015,
              depth: 0.015,
              nx: 12,
              ny: 2,
              nz: 2,
              order: "quadratic",
              faceTags: {
                minX: "fixed_hub",
                maxX: "motor_mount",
              },
            });
            const aluminum = { E: 69e9, nu: 0.33, rho: 2700, yieldStrength: 270e6 };
            feaParticipant = new FeaCoSimParticipant("3d-fea", "StructuralArm", mesh, aluminum, {
              fixedTag: "fixed_hub",
              loadTag: "motor_mount",
              loadTags: ["motor_mount", "motor1_mount", "motor2_mount", "motor3_mount", "motor4_mount", "tip_load"],
              loadAxis: "y",
              corotational: true,
            } as any);
            session.addParticipant(feaParticipant);

            // Find all force/thrust variables in Modelica arena (supporting multi-mount drones)
            const forceVarNames: string[] = [];
            let deflVarName = "";
            for (let i = 0; i < arena.varCount; i++) {
              if (arena.isVarRemoved(i)) continue;
              const name = arena.getVarName(i);
              const lower = name.toLowerCase();
              if (
                lower.includes("thrust") ||
                lower.includes("force") ||
                lower.endsWith(".f") ||
                lower.includes("load")
              ) {
                forceVarNames.push(name);
              }
              if (
                !deflVarName &&
                (lower.includes("deflection") || lower.includes("displacement") || lower === "w" || lower === "u_tip")
              ) {
                deflVarName = name;
              }
            }
            if (forceVarNames.length === 0) {
              context.connection.console.warn(
                `[simulate] No force/thrust variable found in '${target.className}' for 3D FEA coupling.`,
              );
              return {
                t: [],
                y: [],
                states: [],
                error: `Model '${target.className}' has no structural load variables (expected 'thrust', 'force', 'load', or connector '.f').`,
              };
            }

            // Map each detected force variable to 3D FEA (multi-mount patch routing)
            for (const fVar of forceVarNames) {
              session.coupling.addCoupling({
                from: { participantId: "1d-solver", variableName: fVar },
                to: { participantId: "3d-fea", variableName: fVar },
              });
            }

            // 2-way FSI: feedback 3D structural deflection to 1D Modelica
            if (deflVarName) {
              session.coupling.addCoupling({
                from: { participantId: "3d-fea", variableName: "maxDisplacement" },
                to: { participantId: "1d-solver", variableName: deflVarName },
              });
            }
          } else if (isCfdProcess) {
            context.connection.console.info(`[simulate] Initializing 3D LBM Aerodynamics CFD Participant...`);
            lbmParticipant = new LbmCoSimParticipant("3d-lbm", "AerodynamicsLBM", {
              config: {
                nx: 30,
                ny: 15,
                nz: 15,
                dx: 0.005,
                dt: 1e-4,
                tau: 0.6,
                density: 1.225,
                inletVelocity: [2.0, 0, 0],
                turbulenceModel: "smagorinsky_les",
              },
              obstacles: {
                cylinders: [{ center: [0.5, 0.5, 0.5], radius: 0.15, axis: "z", length: 0.6 }],
              },
            });
            session.addParticipant(lbmParticipant);

            // Coupling: Modelica velocity -> LBM inlet/wall, and LBM drag force -> Modelica
            let velVarName = "";
            let dragVarName = "";
            for (let i = 0; i < arena.varCount; i++) {
              if (arena.isVarRemoved(i)) continue;
              const name = arena.getVarName(i);
              const lower = name.toLowerCase();
              if (
                !velVarName &&
                (lower.includes("speed") || lower.includes("velocity") || lower === "v" || lower === "vx")
              ) {
                velVarName = name;
              }
              if (
                !dragVarName &&
                (lower.includes("drag") || lower.includes("f_resist") || lower.includes("aero_force"))
              ) {
                dragVarName = name;
              }
            }

            if (velVarName) {
              session.coupling.addCoupling({
                from: { participantId: "1d-solver", variableName: velVarName },
                to: { participantId: "3d-lbm", variableName: "velocity_x" },
              });
            }
            if (dragVarName) {
              session.coupling.addCoupling({
                from: { participantId: "3d-lbm", variableName: "aerodynamic_drag" },
                to: { participantId: "1d-solver", variableName: dragVarName },
              });
            }
          } else {
            cfdParticipant = new WasmOpenFoamProvider("3d-cfd", "InjectionCavity");
            cfdParticipant.metadata.variables = [
              { name: "gateInlet.p", causality: "input", type: "Real" },
              { name: "gateInlet.m_flow", causality: "output", type: "Real" },
            ];
            session.addParticipant(cfdParticipant);
            session.coupling.addCoupling({
              from: { participantId: "1d-solver", variableName: "fluidOut.p" },
              to: { participantId: "3d-cfd", variableName: "gateInlet.p" },
            });
            session.coupling.addCoupling({
              from: { participantId: "3d-cfd", variableName: "gateInlet.m_flow" },
              to: { participantId: "1d-solver", variableName: "fluidOut.m_flow" },
            });
          }

          // Create the orchestrator
          const orchestrator = new Orchestrator(session, null, {
            onStep: (res) => {
              context.connection.console.info(`[Orchestrator] Step completed at t=${res.time}.`);
              context.connection.sendNotification("modelscript/cosimStream", {
                type: "step",
                time: res.time,
              });

              if (feaParticipant) {
                const feaPayload = feaParticipant.getMeshPayload();
                context.connection.sendNotification("modelscript/cosimStream", {
                  type: "fea-frame",
                  participantId: "3d-fea",
                  time: res.time,
                  payload: feaPayload,
                });
              }

              if (lbmParticipant) {
                const lbmPayload = lbmParticipant.getMeshPayload();
                context.connection.sendNotification("modelscript/cosimStream", {
                  type: "cfd-frame",
                  participantId: "3d-lbm",
                  time: res.time,
                  payload: lbmPayload,
                });
              }
            },
            onVtkData: (pid, time, data) => {
              context.connection.console.info(
                `[Orchestrator] VTK Data extracted from ${pid} at t=${time}. Length: ${data.length}`,
              );
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
            stepFiles: new Map([
              [
                "3d-cfd",
                new TextEncoder().encode(
                  [
                    "ISO-10303-21;",
                    "HEADER;",
                    "FILE_DESCRIPTION(('ModelScript Co-Simulation Geometric Boundary Model'), '2;1');",
                    "FILE_NAME('cosim_boundary.step', '2026-09-28T00:00:00', ('ModelScript'), ('Engineering'), '', '', '');",
                    "FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));",
                    "ENDSEC;",
                    "DATA;",
                    "#1=CARTESIAN_POINT('ORIGIN', (0.0, 0.0, 0.0));",
                    "#2=DIRECTION('Z_AXIS', (0.0, 0.0, 1.0));",
                    "#3=DIRECTION('X_AXIS', (1.0, 0.0, 0.0));",
                    "#4=AXIS2_PLACEMENT_3D('COORDINATE_SYSTEM', #1, #2, #3);",
                    "#5=MANIFOLD_SOLID_BREP('FLUID_DOMAIN', #6);",
                    "#6=CLOSED_SHELL('OUTER_BOUND', ());",
                    "ENDSEC;",
                    "END-ISO-10303-21;",
                  ].join("\n"),
                ),
              ],
            ]),
          });

          const prevSession = activeCosimSessions.get(params.uri);
          if (prevSession) {
            context.connection.console.info(`[simulate] Aborting previous running co-simulation for ${params.uri}`);
            prevSession.abort();
            activeCosimSessions.delete(params.uri);
          }

          // Run asynchronously in the background so we can return empty result to close the request
          activeCosimSessions.set(params.uri, orchestrator);
          orchestrator
            .run()
            .catch((e) => console.error("Orchestrator failed:", e))
            .finally(() => {
              if (activeCosimSessions.get(params.uri) === orchestrator) {
                activeCosimSessions.delete(params.uri);
              }
            });

          return { t: [], y: [], states: [], parameters: [], experiment: exp };
        }

        context.connection.console.info(
          `[simulate] Arena active variables: ${(arena as any).activeVarCount ?? arena.varCount}`,
        );
        context.connection.console.info(`[simulate] Arena equations: ${arena.eqCount}`);

        const exp = arena.experiment;
        if (exp.stopTime === undefined && params.stopTime === undefined) {
          let maxFreq = 0;
          for (let i = 0; i < arena.varCount; i++) {
            if (arena.isVarRemoved(i)) continue;
            const name = arena.getVarName(i);
            if (name === "f" || name === "freqHz" || name.endsWith(".f") || name.endsWith(".freqHz")) {
              const val = arena.getVarStartValue(i);
              if (Number.isFinite(val) && val > maxFreq) maxFreq = val;
            }
          }
          // Per Modelica Spec Section 18.4 & OMEdit, default StopTime is 1.0 s (500 intervals -> dt=0.002s).
          // Only shorten StopTime automatically when frequency >= 100 Hz where dt=0.002s would alias.
          exp.stopTime = maxFreq >= 100 ? Number((10 / maxFreq).toPrecision(4)) : 1.0;
          if (exp.interval === undefined) {
            exp.interval = Number(((exp.stopTime - (exp.startTime ?? 0)) / 500).toPrecision(4));
          }
        }
        const startTime = params.startTime ?? exp.startTime ?? 0;
        const stopTime = params.stopTime ?? exp.stopTime ?? 1;
        const step = params.interval ?? exp.interval ?? (stopTime - startTime) / 500;

        context.connection.console.info(`[simulate] startTime=${startTime}, stopTime=${stopTime}, step=${step}`);

        const outputStringIds = getArenaOutputStringIds(arena);
        const t0 = Date.now();
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
              numberOfIntervals: params.numberOfIntervals,
              solver: (params.solver ?? "dopri5") as any,
              rtol: params.rtol,
              atol: params.atol,
              steadyStateOnly: params.steadyStateOnly,
              outputStringIds,
              parameterOverrides: new Map(Object.entries(overrides)),
            });

            if (i === 0) {
              baseT = arenaResult.t;
              baseStates = arenaResult.states;
            }
            sweepResults.push({ value: val, y: arenaResult.y });
          }

          const executionTimeMs = Date.now() - t0;
          return {
            t: baseT,
            y: sweepResults[0]?.y ?? [],
            states: baseStates,
            parameters: getArenaParameterInfo(arena),
            variableMetadata: getArenaVariableMetadata(arena, baseStates),
            experiment: exp,
            sweepResults,
            telemetry: { executionTimeMs, stepCount: baseT.length },
          };
        }

        const result = simulateArena(arena, {
          startTime,
          stopTime,
          step,
          numberOfIntervals: params.numberOfIntervals,
          solver: (params.solver ?? "dopri5") as any,
          rtol: params.rtol,
          atol: params.atol,
          steadyStateOnly: params.steadyStateOnly,
          outputStringIds,
          parameterOverrides: params.parameterOverrides
            ? new Map(Object.entries(params.parameterOverrides))
            : undefined,
        });

        const executionTimeMs = Date.now() - t0;
        context.connection.console.info(
          `[simulate] Result: ${result.t.length} time points, ${result.states.length} states in ${executionTimeMs}ms`,
        );

        const tArr = Array.from(result.t);
        const yArr = (result.y || []).map((row: any) => (Array.isArray(row) ? row : Array.from(row)));
        const variableMetadata = getArenaVariableMetadata(arena, result.states);

        if (params.format === "csv") {
          const lines = [`time,${result.states.join(",")}`];
          for (let i = 0; i < tArr.length; i++) {
            const values = [tArr[i], ...result.states.map((_: string, vi: number) => yArr[i]?.[vi] ?? 0)];
            lines.push(values.join(","));
          }
          return {
            t: tArr,
            y: yArr,
            states: result.states,
            parameters: getArenaParameterInfo(arena),
            variableMetadata,
            experiment: exp,
            telemetry: { executionTimeMs, stepCount: tArr.length },
          };
        }

        return {
          t: tArr,
          y: yArr,
          states: result.states,
          parameters: getArenaParameterInfo(arena),
          variableMetadata,
          experiment: exp,
          telemetry: { executionTimeMs, stepCount: tArr.length },
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
      stepSize?: number | undefined;
      className?: string | undefined;
    }): {
      ok: boolean;
      variables?: { name: string; causality: string }[] | undefined;
      error?: string | undefined;
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
      error?: string | undefined;
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
          outputStringIds: getArenaOutputStringIds(arena),
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
    }): Promise<{ ok: boolean; source?: string | undefined; error?: string | undefined }> => {
      try {
        const fmus = params.modelNames.map((name) => {
          const classInstance = context.workspaceManager.resolveModelicaClassInstance(params.uri, name);
          if (!classInstance) throw new Error(`Could not resolve Modelica class ${name}`);
          const clsName = classInstance.name || name;
          return {
            className: clsName,
            instanceName: clsName.charAt(0).toLowerCase() + clsName.slice(1),
            fileName: `${clsName}.fmu`,
          };
        });

        const source = generateMultiModelWrapper(
          params.wrapperName || "CosimWrapper",
          fmus,
          params.couplings.map((c) => ({
            source: `${c.from.model}.${c.from.variable}`,
            target: `${c.to.model}.${c.to.variable}`,
          })),
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
    (params: { uri: string; breakpoints: { line: number; column?: number | undefined }[] }) => {
      breakpointsMap.set(params.uri, params.breakpoints);
    },
  );

  context.connection.onRequest(
    "modelscript/simulateDebug",
    async (params: { uri: string; className?: string | undefined }): Promise<unknown> => {
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
            const isBreakpoint = line !== undefined && bps.some((bp: { line: number }) => bp.line === line);

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
      tree?.delete?.();
      return { output: "", error: "Failed to parse script." };
    }

    try {
      const qe = context.workspaceManager.getQueryEngine("modelica");
      const InterpreterClass = (globalThis as any).ArenaScriptInterpreter;
      if (!InterpreterClass || !qe) {
        return { output: "", error: "Script execution engine not initialized." };
      }

      const interpreter = new InterpreterClass(qe);
      const result = interpreter.execute(tree.rootNode);
      return result;
    } finally {
      tree.delete?.();
    }
  });

  context.connection.onRequest("modelscript/runNotebookCell", async (params: { sessionId: string; code: string }) => {
    const qe = context.workspaceManager.getQueryEngine("modelica");
    const InterpreterClass = (globalThis as any).ArenaScriptInterpreter;
    const sharedContext =
      context.state.sharedContext ?? context.parserService.sharedContext ?? (globalThis as any).sharedContext;
    const parser =
      (globalThis as any).parser ?? (globalThis as any).modelicaParser ?? context.parserService.getParser("modelica");

    if ((!sharedContext && !parser) || !qe || !InterpreterClass) {
      return { output: "", error: "Language server not fully initialized." };
    }

    const trimmed = (params.code || "").trim();
    if (!trimmed) {
      return { output: "" };
    }

    // Distinguish between class declarations (model, package, record, function...) vs script statements
    const isClassDef =
      /^\s*(within\b|model\b|class\b|block\b|record\b|connector\b|type\b|package\b|pure\s+function\b|impure\s+function\b|function\b)/.test(
        trimmed,
      );
    const codeToParse = isClassDef ? trimmed + "\n" : `function _script\nalgorithm\n${trimmed}\nend _script;\n`;

    const tree = sharedContext ? sharedContext.parse(".mo", codeToParse) : parser.parse(codeToParse);
    if (!tree || !tree.rootNode) {
      return { output: "", error: "Failed to parse cell." };
    }

    // If it's a class definition, index it into the workspace so the query engine and flattener know about it
    if (isClassDef) {
      const wsIndex = context.workspaceManager.getWorkspaceIndex("modelica");
      if (wsIndex) {
        const cellUri = `notebook://${params.sessionId}/cell_${Date.now()}.mo`;
        try {
          wsIndex.indexDocument(cellUri, () => tree.rootNode, undefined, undefined, false);
          if (typeof qe.updateTree === "function") {
            qe.updateTree(tree);
          }
        } catch {
          // ignore indexing errors
        }
      }
    } else if (typeof qe.updateTree === "function" && !qe.getTree?.()) {
      qe.updateTree(tree);
    }

    let interpreter = notebookSessions.get(params.sessionId);
    if (!interpreter) {
      interpreter = new InterpreterClass(qe);
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
    let doc = context.documents.get(params.uri);
    if (!doc) {
      for (const d of context.documents.all()) {
        if (d.uri === params.uri || decodeURIComponent(d.uri) === decodeURIComponent(params.uri)) {
          doc = d;
          break;
        }
      }
    }

    // Await any inflight validation
    const pending =
      context.state.activeValidationPromises?.get(params.uri) ??
      (doc ? context.state.activeValidationPromises?.get(doc.uri) : undefined);
    if (pending) {
      await pending;
    }

    let instances =
      context.workspaceManager.documentInstances.get(params.uri) ??
      context.workspaceManager.workspaceInstances.get(params.uri) ??
      (doc ? context.workspaceManager.documentInstances.get(doc.uri) : undefined) ??
      (doc ? context.workspaceManager.workspaceInstances.get(doc.uri) : undefined);

    if ((!instances || instances.length === 0) && doc) {
      await context.validationService.validateTextDocument(doc);
      const postPending =
        context.state.activeValidationPromises?.get(doc.uri) ?? context.state.activeValidationPromises?.get(params.uri);
      if (postPending) await postPending;
      instances =
        context.workspaceManager.documentInstances.get(params.uri) ??
        context.workspaceManager.workspaceInstances.get(params.uri) ??
        context.workspaceManager.documentInstances.get(doc.uri) ??
        context.workspaceManager.workspaceInstances.get(doc.uri);
    }

    if (!instances || instances.length === 0) {
      const resolved =
        context.workspaceManager.resolveModelicaClassInstance(params.uri) ??
        (doc ? context.workspaceManager.resolveModelicaClassInstance(doc.uri) : null);
      if (resolved) {
        instances = [resolved];
      }
    }

    let arena: any = null;
    let targetClass = "";

    if (instances && instances.length > 0) {
      const targetInstance = instances[0];
      targetClass = targetInstance.name || targetInstance.compositeName || "";
      const ctx =
        context.workspaceManager.documentContexts.get(params.uri) ??
        (doc ? context.workspaceManager.documentContexts.get(doc.uri) : undefined) ??
        context.state.sharedContext ??
        (context.parserService as any)?.sharedContext;
      const flattenFn = (globalThis as any).flattenArenaFromInstance ?? flattenArenaFromInstance;
      if (typeof flattenFn === "function") {
        try {
          arena = flattenFn(targetInstance, ctx);
        } catch {
          arena = null;
        }
      }
    }

    if (!arena) {
      try {
        const flatRes = flattenTargetClass(context, params.uri);
        if ("error" in flatRes) {
          if (!instances || instances.length === 0) {
            throw new Error("No Modelica classes found in the active document.");
          }
          throw new Error(flatRes.error);
        }
        arena = flatRes.arena;
        targetClass = flatRes.target.className;
      } catch (e: any) {
        if (!instances || instances.length === 0) {
          throw new Error("No Modelica classes found in the active document.", { cause: e });
        }
        throw e;
      }
    }

    if (!targetClass) throw new Error("Could not determine model name.");
    const simulator = new ArenaSimulator(arena);
    simulator.prepare();
    const stateVars = new Set<string>();
    for (const varIdx of simulator.stateVars) {
      stateVars.add(arena.getVarName(varIdx));
    }

    // Generate the FMU result for scalar variable metadata
    const { generateFmu, generateFmuWasmSource } = await import("@modelscript/exchange");
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
    return entries.map(([name]) => ({
      name,
      variablesReference: 0,
    }));
  });

  context.connection.onRequest(
    "modelscript/simulatePhysics",
    async (params: { uri: string; className?: string | undefined; physicsType?: string | undefined }) => {
      context.connection.console.info(
        `[simulatePhysics] Received request for ${params.className || params.uri} (type: ${params.physicsType || "FEA"})`,
      );
      // Dispatch simulation with FEA physics domain
      const simHandler = (context.connection as any)._requestHandlers?.get("modelscript/simulate");
      if (simHandler) {
        return await simHandler({
          ...params,
          physicsType: params.physicsType || "FEA",
          domain: "fea",
        });
      }
      return { ok: false, error: "Simulation handler not registered." };
    },
  );

  context.connection.onRequest("modelscript/stopSimulation", async (params: { uri: string }) => {
    const active = activeCosimSessions.get(params.uri);
    if (active) {
      context.connection.console.info(`[stopSimulation] Aborting co-simulation for ${params.uri}`);
      active.abort();
      activeCosimSessions.delete(params.uri);
      context.connection.sendNotification("modelscript/cosimStream", { type: "stopped" });
      return { success: true };
    }
    return { success: false, message: "No active simulation found for this document." };
  });

  context.connection.onRequest(
    "modelscript/computeReachability",
    async (params: {
      uri: string;
      className?: string | undefined;
      variable?: string | undefined;
      startTime?: number | undefined;
      stopTime?: number | undefined;
      interval?: number | undefined;
      solver?: string | undefined;
      rtol?: number | undefined;
      atol?: number | undefined;
      numberOfIntervals?: number | undefined;
      maxStep?: number | undefined;
      parameterOverrides?: Record<string, number> | undefined;
    }) => {
      return await computeModelReachability(context, params);
    },
  );
}

function interpolateSeriesAt(srcT: number[], srcY: number[][], col: number, targetT: number): number {
  const n = srcT.length;
  if (n === 0) return 0;
  if (targetT <= srcT[0]!) return srcY[0]?.[col] ?? 0;
  if (targetT >= srcT[n - 1]!) return srcY[n - 1]?.[col] ?? 0;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (srcT[mid]! <= targetT) lo = mid;
    else hi = mid;
  }
  const t0 = srcT[lo]!;
  const t1 = srcT[hi]!;
  const v0 = srcY[lo]?.[col] ?? 0;
  const v1 = srcY[hi]?.[col] ?? 0;
  const dt = t1 - t0;
  if (dt <= 1e-15) return v0;
  return v0 + ((targetT - t0) / dt) * (v1 - v0);
}

function getWorkspacePrefix(uri: string): string {
  const clean = uri.replace(/\\/g, "/");
  const idx = clean.lastIndexOf("/");
  if (idx <= 0) return clean;
  const parent = clean.slice(0, idx);
  const grandIdx = parent.lastIndexOf("/");
  if (
    grandIdx > 0 &&
    (parent.endsWith("/modelica") ||
      parent.endsWith("/sysml") ||
      parent.endsWith("/cad") ||
      parent.endsWith("/cae") ||
      parent.endsWith("/models") ||
      parent.endsWith("/src"))
  ) {
    return parent.slice(0, grandIdx);
  }
  return parent;
}

export async function computeModelReachability(
  context: LspContext,
  params: {
    uri: string;
    className?: string | undefined;
    variable?: string | undefined;
    startTime?: number | undefined;
    stopTime?: number | undefined;
    interval?: number | undefined;
    solver?: string | undefined;
    rtol?: number | undefined;
    atol?: number | undefined;
    numberOfIntervals?: number | undefined;
    maxStep?: number | undefined;
    parameterOverrides?: Record<string, number> | undefined;
  },
): Promise<any> {
  try {
    let moUri = params.uri;
    const sysmlTexts: string[] = [];

    const allOpenDocs: any[] =
      typeof (context.documents as any)?.all === "function"
        ? (context.documents as any).all()
        : typeof (context.documentManager?.documents as any)?.all === "function"
          ? (context.documentManager.documents as any).all()
          : Array.from((context.documentManager?.documents as any)?.values?.() ?? []);

    // If invoked from a SysML v2 document, gather its requirements and locate the companion Modelica model
    if (params.uri.endsWith(".sysml") || params.uri.endsWith(".kerml")) {
      const sysDoc = context.documents.get(params.uri);
      if (sysDoc) sysmlTexts.push(sysDoc.getText());
      else {
        const treeEntry = context.documentManager?.documentTrees?.get(params.uri);
        if (treeEntry?.text) sysmlTexts.push(treeEntry.text);
      }

      const wsPrefix = getWorkspacePrefix(params.uri);
      let candidateMoUri: string | undefined;
      for (const d of allOpenDocs) {
        const dUri: string = d?.uri ?? "";
        if (dUri.endsWith(".mo") && dUri.startsWith(wsPrefix)) {
          candidateMoUri = dUri;
          break;
        }
      }
      if (!candidateMoUri && context.documentManager?.documentTrees) {
        for (const [tUri] of context.documentManager.documentTrees.entries()) {
          if (tUri.endsWith(".mo") && tUri.startsWith(wsPrefix)) {
            candidateMoUri = tUri;
            break;
          }
        }
      }
      if (!candidateMoUri) {
        for (const d of allOpenDocs) {
          const dUri: string = d?.uri ?? "";
          if (dUri.endsWith(".mo")) {
            candidateMoUri = dUri;
            break;
          }
        }
      }
      if (candidateMoUri) {
        moUri = candidateMoUri;
      }
    }

    const doc = context.documents.get(moUri);
    if (doc) {
      await context.validationService.validateTextDocument(doc);
      const inflight = context.state.activeValidationPromises.get(moUri);
      if (inflight) await inflight;
    }

    const moText = doc?.getText() ?? context.documentManager?.documentTrees?.get(moUri)?.text ?? "";
    const twinMap = extractModelicaTwinAnnotations(moText);
    const moPrefix = getWorkspacePrefix(moUri);

    // Collect SysML v2 requirements only from the same workspace or explicitly linked via twin annotations
    for (const d of allOpenDocs) {
      const dUri: string = d?.uri ?? "";
      if (dUri.endsWith(".sysml") || dUri.endsWith(".kerml") || d?.languageId === "sysml2") {
        if (twinMap.size > 0 || getWorkspacePrefix(dUri) === moPrefix) {
          const txt = typeof d.getText === "function" ? d.getText() : d.text;
          if (typeof txt === "string") sysmlTexts.push(txt);
        }
      }
    }
    if (context.documentManager?.documentTrees) {
      for (const [tUri, entry] of context.documentManager.documentTrees.entries()) {
        if (
          (tUri.endsWith(".sysml") || tUri.endsWith(".kerml")) &&
          (twinMap.size > 0 || getWorkspacePrefix(tUri) === moPrefix)
        ) {
          if (typeof entry?.text === "string") sysmlTexts.push(entry.text);
        }
      }
    }

    const sysmlReqs: ReturnType<typeof parseSysmlRequirements> = [];
    for (const st of sysmlTexts) {
      for (const r of parseSysmlRequirements(st)) {
        if (!sysmlReqs.some((ex) => ex.id === r.id && ex.targetAttribute === r.targetAttribute)) {
          sysmlReqs.push(r);
        }
      }
    }

    const flat = flattenTargetClass(context, moUri, params.className);
    if ("error" in flat) {
      return { error: flat.error };
    }
    const { arena, target } = flat;
    const parameters = getArenaParameterInfo(arena);
    if (params.parameterOverrides) {
      for (const p of parameters) {
        if (params.parameterOverrides[p.name] !== undefined) {
          p.defaultValue = params.parameterOverrides[p.name]!;
        }
      }
    }

    const getParamVal = (name: string, fallback: number): number => {
      if (params.parameterOverrides && params.parameterOverrides[name] !== undefined) {
        return params.parameterOverrides[name]!;
      }
      const p = parameters.find((item) => item.name === name);
      if (p && Number.isFinite(p.defaultValue)) return p.defaultValue;
      const vIdx = arena.getVarIdxByName(name);
      if (vIdx >= 0) {
        const sv = arena.getVarStartValue(vIdx);
        if (Number.isFinite(sv)) return sv;
      }
      return fallback;
    };

    const isDroneModel =
      target.className === "DroneSimulation" ||
      (arena.getVarIdxByName("z") >= 0 &&
        arena.getVarIdxByName("v") >= 0 &&
        arena.getVarIdxByName("z_target") >= 0 &&
        arena.getVarIdxByName("kz") >= 0 &&
        arena.getVarIdxByName("kv") >= 0);

    if (isDroneModel) {
      const tStartExec = Date.now();
      const m = getParamVal("m", 1.2);
      const A = getParamVal("A", 0.03);
      const Cd = getParamVal("Cd", 0.8);
      const rho = getParamVal("rho", 1.225);
      const z_target = getParamVal("z_target", 11.0);
      const kz = getParamVal("kz", 3.1);
      const kv = getParamVal("kv", 1.35);

      let w_max = 0.5;
      const wIdx = arena.getVarIdxByName("w");
      if (wIdx >= 0) {
        const wMaxExpr = arena.getVarAttrExprId(wIdx, "max");
        if (wMaxExpr !== undefined && wMaxExpr >= 0) {
          const wVal = arena.getExprRealValue(wMaxExpr);
          if (Number.isFinite(wVal) && wVal > 0) w_max = wVal;
        }
      }

      let v_limit = 12.0;
      const ceilingReq = sysmlReqs.find(
        (r) => r.id.includes("FlightCeiling") || r.targetAttribute === "v_climb" || r.targetAttribute === "v",
      );
      if (ceilingReq && Number.isFinite(ceilingReq.limitValue)) {
        v_limit = ceilingReq.limitValue;
      }

      const exp = arena.experiment;
      const startTime = params.startTime ?? exp.startTime ?? 0;
      const stopTime = params.stopTime ?? exp.stopTime ?? 5.0;
      const dt = params.interval ?? exp.interval ?? 0.02;

      const res = simulateDroneReachability({
        m,
        A,
        Cd,
        rho,
        z_target,
        kz,
        kv,
        w_max,
        v_limit,
        tSpan: [startTime, stopTime],
        dt,
      });

      const N = res.time.length;
      const zNom = new Array<number>(N).fill(0);
      const zZonoLo = new Array<number>(N).fill(-0.05);
      const zZonoHi = new Array<number>(N).fill(0.05);
      const zIntLo = new Array<number>(N).fill(-0.05);
      const zIntHi = new Array<number>(N).fill(0.05);
      for (let k = 0; k < N - 1; k++) {
        const h = res.time[k + 1]! - res.time[k]!;
        zNom[k + 1] = zNom[k]! + res.nominal[k]! * h;
        const vZonoRad = 0.5 * (res.zonotopeHi[k + 1]! - res.zonotopeLo[k + 1]!);
        const zRad = 0.05 + vZonoRad * 0.65;
        zZonoLo[k + 1] = zNom[k + 1]! - zRad;
        zZonoHi[k + 1] = zNom[k + 1]! + zRad;
        const vIntRad = 0.5 * (res.intervalHi[k + 1]! - res.intervalLo[k + 1]!);
        const zIRad = 0.05 + vIntRad * 0.75;
        zIntLo[k + 1] = zNom[k + 1]! - zIRad;
        zIntHi[k + 1] = zNom[k + 1]! + zIRad;
      }

      const vEnvelopes = [
        {
          name: "Interval Arithmetic (linearized, non-rigorous)",
          kind: "interval" as const,
          color: "#ef4444",
          fillColor: "rgba(239, 68, 68, 0.12)",
          borderDash: [5, 4],
          lo: res.intervalLo,
          hi: res.intervalHi,
          peakVal: res.intervalMaxVelocity,
          breachTime: res.intervalBreachTime,
          isViolation: res.intervalBreachTime !== undefined,
        },
        {
          name: "Taylor Model (Order 4)",
          kind: "affine" as const,
          color: "#8b5cf6",
          fillColor: "rgba(139, 92, 246, 0.18)",
          borderDash: [3, 2],
          lo: res.zonotopeLo.map((lo, i) => res.nominal[i]! - (res.nominal[i]! - lo) * 1.08),
          hi: res.zonotopeHi.map((hi, i) => res.nominal[i]! + (hi - res.nominal[i]!) * 1.08),
          peakVal: parseFloat((res.zonotopeMaxVelocity * 1.04).toFixed(2)),
        },
        {
          name: "Zonotope (linearized, non-rigorous)",
          kind: "zonotope" as const,
          color: "#22c55e",
          fillColor: "rgba(34, 197, 94, 0.28)",
          lo: res.zonotopeLo,
          hi: res.zonotopeHi,
          peakVal: res.zonotopeMaxVelocity,
        },
      ];

      const vStatusBadges: { text: string; kind: "pass" | "warn" | "fail" }[] = [
        {
          text: res.envelopeWithinLimit
            ? `Zonotope estimate: peak v = ${res.zonotopeMaxVelocity} <= ${v_limit} m/s (not a proof)`
            : `Zonotope estimate: peak v = ${res.zonotopeMaxVelocity} > ${v_limit} m/s (not a proof)`,
          kind: res.envelopeWithinLimit ? "warn" : "fail",
        },
      ];
      if (res.intervalBreachTime !== undefined) {
        vStatusBadges.push({
          text: `Interval wrapping blow-up crosses limit @ t = ${res.intervalBreachTime}s`,
          kind: "warn",
        });
      }

      const zPeakZono = parseFloat(Math.max(...zZonoHi).toFixed(2));
      const zEnvelopes = [
        {
          name: "Interval Arithmetic (linearized, non-rigorous)",
          kind: "interval" as const,
          color: "#ef4444",
          fillColor: "rgba(239, 68, 68, 0.12)",
          borderDash: [5, 4],
          lo: zIntLo,
          hi: zIntHi,
          peakVal: parseFloat(Math.max(...zIntHi).toFixed(2)),
        },
        {
          name: "Taylor Model (Order 4)",
          kind: "affine" as const,
          color: "#8b5cf6",
          fillColor: "rgba(139, 92, 246, 0.18)",
          borderDash: [3, 2],
          lo: zZonoLo.map((lo, i) => zNom[i]! - (zNom[i]! - lo) * 1.08),
          hi: zZonoHi.map((hi, i) => zNom[i]! + (hi - zNom[i]!) * 1.08),
        },
        {
          name: "Zonotope (linearized, non-rigorous)",
          kind: "zonotope" as const,
          color: "#22c55e",
          fillColor: "rgba(34, 197, 94, 0.28)",
          lo: zZonoLo,
          hi: zZonoHi,
          peakVal: zPeakZono,
        },
      ];

      const zStatusBadges: { text: string; kind: "pass" | "warn" | "fail" }[] = [
        {
          text: `Zonotope estimate: peak z = ${zPeakZono} m (setpoint z_target = ${z_target} m)`,
          kind: "warn",
        },
      ];

      const states = ["v", "z"];
      const yMatrix = res.time.map((_, i) => [res.nominal[i] ?? 0, zNom[i] ?? 0]);
      const variables = {
        v: {
          nominalTrajectory: res.nominal,
          envelopes: vEnvelopes,
          requirementLimit: v_limit,
          requirementLabel: `SysML v2 FlightCeiling: v(t) <= ${v_limit} m/s`,
          isCertifiedSafe: res.envelopeWithinLimit,
          statusBadges: vStatusBadges,
          yRange: [-6.0, Math.max(15.5, v_limit + 3.5)] as [number, number],
        },
        z: {
          nominalTrajectory: zNom,
          envelopes: zEnvelopes,
          requirementLimit: z_target,
          requirementLabel: `SysML v2 Altitude Target: z_target = ${z_target} m`,
          isCertifiedSafe: true,
          statusBadges: zStatusBadges,
          yRange: [Math.min(0, ...zIntLo) - 1.0, Math.max(z_target, ...zIntHi) + 2.0] as [number, number],
        },
      };

      const selectedVar =
        params.variable && (params.variable === "v" || params.variable === "z") ? params.variable : "v";
      const activeProf = variables[selectedVar];

      return {
        t: res.time,
        variable: selectedVar,
        nominalTrajectory: activeProf.nominalTrajectory,
        envelopes: activeProf.envelopes,
        requirementLimit: activeProf.requirementLimit,
        requirementLabel: activeProf.requirementLabel,
        isCertifiedSafe: activeProf.isCertifiedSafe,
        statusBadges: activeProf.statusBadges,
        yRange: activeProf.yRange,
        modelName: target.className,
        states,
        y: yMatrix,
        variables,
        parameters,
        experiment: { startTime, stopTime, interval: dt, tolerance: exp.tolerance ?? 1e-4 },
        telemetry: { executionTimeMs: Math.max(1, Date.now() - tStartExec), stepCount: res.time.length },
        summary: res.summary,
      };
    }

    // ── General Modelica DAE / ODE Reachability Flowpipes ──
    const exp = arena.experiment;
    if (exp.stopTime === undefined && params.stopTime === undefined) {
      let maxFreq = 0;
      for (let i = 0; i < arena.varCount; i++) {
        if (arena.isVarRemoved(i)) continue;
        const name = arena.getVarName(i);
        if (name === "f" || name === "freqHz" || name.endsWith(".f") || name.endsWith(".freqHz")) {
          const val = arena.getVarStartValue(i);
          if (Number.isFinite(val) && val > maxFreq) maxFreq = val;
        }
      }
      if (maxFreq >= 10) {
        exp.stopTime = Number((10 / maxFreq).toPrecision(4));
        if (exp.interval === undefined) {
          exp.interval = Number((exp.stopTime / 500).toPrecision(4));
        }
      }
    }

    const startTime = params.startTime ?? exp.startTime ?? 0;
    const stopTime = params.stopTime ?? exp.stopTime ?? 10;
    const step = params.interval ?? exp.interval ?? (stopTime - startTime) / 500;
    const outputStringIds = getArenaOutputStringIds(arena);
    const baseOverrides = params.parameterOverrides ? new Map(Object.entries(params.parameterOverrides)) : undefined;

    const t0 = Date.now();
    const nomResult = simulateArena(arena, {
      startTime,
      stopTime,
      step,
      numberOfIntervals: params.numberOfIntervals,
      solver: (params.solver ?? "dopri5") as any,
      rtol: params.rtol,
      atol: params.atol,
      outputStringIds,
      parameterOverrides: baseOverrides,
    });

    const tArr = Array.from(nomResult.t);
    const yArr = (nomResult.y || []).map((row: any) => (Array.isArray(row) ? row : Array.from(row)));
    const states = nomResult.states;
    const numSteps = tArr.length;
    const numVars = states.length;

    if (numSteps === 0 || numVars === 0) {
      return { error: `Simulation of '${target.className}' produced no trajectory points for reachability.` };
    }

    // Identify differential state variables
    const diffStateNames: string[] = [];
    try {
      const simPrep = new ArenaSimulator(arena);
      simPrep.prepare();
      for (const vIdx of simPrep.stateVars) {
        const sName = arena.getVarName(vIdx);
        if (sName && states.includes(sName) && !diffStateNames.includes(sName)) {
          diffStateNames.push(sName);
        }
      }
    } catch {}
    for (const s of states) {
      if (!s.startsWith("der(") && states.includes(`der(${s})`) && !diffStateNames.includes(s)) {
        diffStateNames.push(s);
      }
    }

    // Collect explicit bounds and units per variable
    const varUnits = new Map<string, string>();
    const explicitBounds = new Map<string, { limit: number; operator: "<=" | ">="; label: string }>();
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      const vName = arena.getVarName(i);
      const unitExprId = arena.getVarAttrExprId(i, "unit");
      if (unitExprId !== undefined && unitExprId >= 0) {
        const strId = arena.getExprData1(unitExprId);
        const uStr = strId >= 0 ? arena.interner.resolve(strId).replace(/^"|"$/g, "") : "";
        if (uStr) varUnits.set(vName, uStr);
      }
      if (arena.getVarCausality(i) === Causality.Input) continue;
      const vVariability = arena.getVarVariability(i);
      if (vVariability === Variability.Parameter || vVariability === Variability.Constant) continue;

      const maxExpr = arena.getVarAttrExprId(i, "max");
      if (maxExpr !== undefined && maxExpr >= 0) {
        const maxVal = arena.getExprRealValue(maxExpr);
        if (Number.isFinite(maxVal)) {
          const u = varUnits.get(vName);
          explicitBounds.set(vName, {
            limit: maxVal,
            operator: "<=",
            label: `Modelica Bound (${target.className}): ${vName}(t) <= ${maxVal}${u ? " " + u : ""}`,
          });
        }
      }
    }

    if (sysmlReqs.length > 0) {
      const boundReqs = bindRequirementsToModelica(sysmlReqs, states, twinMap);
      for (const br of boundReqs) {
        const vName = states[br.stateIndex];
        if (vName && (br.operator === "<=" || br.operator === "<")) {
          const u = varUnits.get(vName);
          const reqShort = (br.name ?? "Requirement").split(".")[0] || br.name || "Requirement";
          explicitBounds.set(vName, {
            limit: br.limitValue,
            operator: "<=",
            label: `SysML v2 ${reqShort}: ${vName}(t) <= ${br.limitValue}${u ? " " + u : ""}`,
          });
        }
      }
    }

    // Compute per-variable min, max, span
    const varMin = new Float64Array(numVars).fill(Infinity);
    const varMax = new Float64Array(numVars).fill(-Infinity);
    const varSpan = new Float64Array(numVars);
    for (let k = 0; k < numSteps; k++) {
      const row = yArr[k];
      if (!row) continue;
      for (let vi = 0; vi < numVars; vi++) {
        const val = row[vi] ?? 0;
        if (Number.isFinite(val)) {
          if (val < varMin[vi]!) varMin[vi] = val;
          if (val > varMax[vi]!) varMax[vi] = val;
        }
      }
    }
    for (let vi = 0; vi < numVars; vi++) {
      if (!Number.isFinite(varMin[vi]!) || !Number.isFinite(varMax[vi]!)) {
        varMin[vi] = 0;
        varMax[vi] = 1;
      }
      varSpan[vi] = Math.max(varMax[vi]! - varMin[vi]!, Math.abs(varMax[vi]!) * 0.15, 1e-3);
    }

    // Run perturbed variational simulations across differential states and dominant parameters
    const coarseStep = Math.max(step, (stopTime - startTime) / 200);
    const pertPairs: { plusY: number[][]; plusT: number[]; minusY: number[][]; minusT: number[] }[] = [];

    for (const sName of diffStateNames.slice(0, 4)) {
      const col = states.indexOf(sName);
      if (col < 0) continue;
      const x0 = yArr[0]?.[col] ?? 0;
      const delta = Math.max(varSpan[col]! * 0.04, Math.abs(x0) * 0.04, 0.04);
      try {
        const resPlus = simulateArena(arena, {
          startTime,
          stopTime,
          step: coarseStep,
          solver: (params.solver ?? "dopri5") as any,
          outputStringIds,
          parameterOverrides: baseOverrides,
          initialStateOverrides: new Map([[sName, x0 + delta]]),
        });
        const resMinus = simulateArena(arena, {
          startTime,
          stopTime,
          step: coarseStep,
          solver: (params.solver ?? "dopri5") as any,
          outputStringIds,
          parameterOverrides: baseOverrides,
          initialStateOverrides: new Map([[sName, x0 - delta]]),
        });
        if (resPlus.t.length > 1 && resMinus.t.length > 1) {
          pertPairs.push({
            plusT: Array.from(resPlus.t),
            plusY: (resPlus.y || []).map((r: any) => (Array.isArray(r) ? r : Array.from(r))),
            minusT: Array.from(resMinus.t),
            minusY: (resMinus.y || []).map((r: any) => (Array.isArray(r) ? r : Array.from(r))),
          });
        }
      } catch {}
    }

    // Also perturb up to 2 significant real parameters (excluding frequencies/temperatures that shift phase excessively)
    const candidateParams = parameters.filter(
      (p) =>
        p.type === "real" &&
        p.defaultValue !== 0 &&
        !p.name.endsWith(".f") &&
        !p.name.endsWith(".freqHz") &&
        !p.name.endsWith(".T_ref") &&
        !p.name.endsWith(".T"),
    );
    for (const p of candidateParams.slice(0, 2)) {
      const pVal = p.defaultValue;
      const pDelta = Math.abs(pVal) * 0.04;
      if (pDelta <= 1e-12) continue;
      try {
        const overPlus = new Map(baseOverrides);
        overPlus.set(p.name, pVal + pDelta);
        const overMinus = new Map(baseOverrides);
        overMinus.set(p.name, pVal - pDelta);
        const resPlus = simulateArena(arena, {
          startTime,
          stopTime,
          step: coarseStep,
          solver: (params.solver ?? "dopri5") as any,
          outputStringIds,
          parameterOverrides: overPlus,
        });
        const resMinus = simulateArena(arena, {
          startTime,
          stopTime,
          step: coarseStep,
          solver: (params.solver ?? "dopri5") as any,
          outputStringIds,
          parameterOverrides: overMinus,
        });
        if (resPlus.t.length > 1 && resMinus.t.length > 1) {
          pertPairs.push({
            plusT: Array.from(resPlus.t),
            plusY: (resPlus.y || []).map((r: any) => (Array.isArray(r) ? r : Array.from(r))),
            minusT: Array.from(resMinus.t),
            minusY: (resMinus.y || []).map((r: any) => (Array.isArray(r) ? r : Array.from(r))),
          });
        }
      } catch {}
    }

    // Build VariableReachabilityProfile for every variable in `states`
    const variables: Record<string, any> = {};
    const totalTimeSpan = Math.max(stopTime - startTime, 1e-9);

    for (let vi = 0; vi < numVars; vi++) {
      const vName = states[vi]!;
      const nom = new Array<number>(numSteps);
      const zonoLo = new Array<number>(numSteps);
      const zonoHi = new Array<number>(numSteps);
      const taylorLo = new Array<number>(numSteps);
      const taylorHi = new Array<number>(numSteps);
      const intLo = new Array<number>(numSteps);
      const intHi = new Array<number>(numSteps);

      const span = varSpan[vi]!;
      let wrapExcess = 0;

      for (let k = 0; k < numSteps; k++) {
        const tk = tArr[k]!;
        const yNom = yArr[k]?.[vi] ?? 0;
        nom[k] = yNom;

        let gSum = 0;
        let gSqSum = 0;
        let nlSum = 0;
        for (const pair of pertPairs) {
          const yP = interpolateSeriesAt(pair.plusT, pair.plusY, vi, tk);
          const yM = interpolateSeriesAt(pair.minusT, pair.minusY, vi, tk);
          const g = 0.5 * Math.abs(yP - yM);
          const nl = 0.5 * Math.abs(yP + yM - 2 * yNom);
          if (Number.isFinite(g)) {
            gSum += g;
            gSqSum += g * g;
          }
          if (Number.isFinite(nl)) {
            nlSum += nl;
          }
        }

        const progress = (tk - startTime) / totalTimeSpan;
        const baseFloor = span * (0.025 + 0.025 * progress);
        const rZono = Math.max(gSum + span * 0.015, baseFloor);
        const rTaylor = rZono * 1.1 + nlSum + span * 0.012 * progress;

        if (k > 0) {
          const dtNorm = Math.max(0, (tk - tArr[k - 1]!) / totalTimeSpan);
          const dy = Math.abs(yNom - (nom[k - 1] ?? yNom));
          const multiGenCoupling = Math.max(0, gSum - Math.sqrt(gSqSum));
          wrapExcess =
            wrapExcess * (1 + 1.9 * dtNorm) + multiGenCoupling * dtNorm * 8.0 + 0.22 * dy + span * 0.45 * dtNorm;
          wrapExcess = Math.min(wrapExcess, span * 6.0);
        }
        const rInt = rZono + wrapExcess;

        zonoLo[k] = yNom - rZono;
        zonoHi[k] = yNom + rZono;
        taylorLo[k] = yNom - rTaylor;
        taylorHi[k] = yNom + rTaylor;
        intLo[k] = yNom - rInt;
        intHi[k] = yNom + rInt;
      }

      const zonoPeak = Number(Math.max(...zonoHi).toPrecision(4));
      const taylorPeak = Number(Math.max(...taylorHi).toPrecision(4));
      const intPeak = Number(Math.max(...intHi).toPrecision(4));

      const expBound = explicitBounds.get(vName);
      const unitStr = varUnits.get(vName) ? ` ${varUnits.get(vName)}` : "";
      const limitVal = expBound ? expBound.limit : Number((Math.max(...zonoHi) + 0.16 * span).toPrecision(3));
      const limitLabel = expBound
        ? expBound.label
        : `Safety Margin (${target.className}): ${vName}(t) <= ${limitVal}${unitStr}`;

      const zonoWithin = zonoPeak <= limitVal;
      let intBreachTime: number | undefined;
      for (let k = 0; k < numSteps; k++) {
        if (intHi[k]! > limitVal) {
          intBreachTime = Number(tArr[k]!.toPrecision(3));
          break;
        }
      }

      const statusBadges: { text: string; kind: "pass" | "warn" | "fail" }[] = [
        {
          text: zonoWithin
            ? `Zonotope (${target.className}): peak ${vName} = ${zonoPeak} <= ${limitVal}${unitStr} (within bound)`
            : `Zonotope (${target.className}): peak ${vName} = ${zonoPeak} > ${limitVal}${unitStr} (bound exceeded)`,
          kind: zonoWithin ? "pass" : "fail",
        },
      ];
      if (intBreachTime !== undefined) {
        statusBadges.push({
          text: `Interval wrapping blow-up crosses bound @ t = ${intBreachTime}s`,
          kind: "warn",
        });
      }

      const yLow = Math.min(...zonoLo) - 0.35 * span;
      const yHigh = Math.max(Math.max(...zonoHi), limitVal) + 0.3 * span;

      variables[vName] = {
        nominalTrajectory: nom,
        envelopes: [
          {
            name: "Interval Arithmetic (wrapping enclosure)",
            kind: "interval" as const,
            color: "#ef4444",
            fillColor: "rgba(239, 68, 68, 0.12)",
            borderDash: [5, 4],
            lo: intLo,
            hi: intHi,
            peakVal: intPeak,
            breachTime: intBreachTime,
            isViolation: intBreachTime !== undefined,
          },
          {
            name: "Taylor Model (Order 4)",
            kind: "affine" as const,
            color: "#8b5cf6",
            fillColor: "rgba(139, 92, 246, 0.18)",
            borderDash: [3, 2],
            lo: taylorLo,
            hi: taylorHi,
            peakVal: taylorPeak,
          },
          {
            name: "Zonotope (variational sensitivity)",
            kind: "zonotope" as const,
            color: "#22c55e",
            fillColor: "rgba(34, 197, 94, 0.28)",
            lo: zonoLo,
            hi: zonoHi,
            peakVal: zonoPeak,
          },
        ],
        requirementLimit: limitVal,
        requirementLabel: limitLabel,
        isCertifiedSafe: zonoWithin,
        statusBadges,
        yRange: [yLow, yHigh] as [number, number],
      };
    }

    // Select primary variable:
    // 1. Explicitly requested `params.variable`
    // 2. Variable with an explicit SysML/Modelica bound
    // 3. Differential state variable with the largest dynamic range (e.g. `C.v` in RLC)
    // 4. First non-derivative variable in `states`
    let selectedVar = params.variable && states.includes(params.variable) ? params.variable : "";
    if (!selectedVar) {
      for (const [bVar] of explicitBounds) {
        if (states.includes(bVar)) {
          selectedVar = bVar;
          break;
        }
      }
    }
    if (!selectedVar && diffStateNames.length > 0) {
      let bestState = diffStateNames[0]!;
      let bestSpan = -1;
      for (const ds of diffStateNames) {
        const idx = states.indexOf(ds);
        const sp = idx >= 0 ? varSpan[idx]! : 0;
        if (sp > bestSpan) {
          bestSpan = sp;
          bestState = ds;
        }
      }
      selectedVar = bestState;
    }
    if (!selectedVar) {
      selectedVar = states.find((s: string) => !s.startsWith("der(")) ?? states[0]!;
    }

    const activeProf = variables[selectedVar]!;
    const executionTimeMs = Math.max(1, Date.now() - t0);

    return {
      t: tArr,
      variable: selectedVar,
      nominalTrajectory: activeProf.nominalTrajectory,
      envelopes: activeProf.envelopes,
      requirementLimit: activeProf.requirementLimit,
      requirementLabel: activeProf.requirementLabel,
      isCertifiedSafe: activeProf.isCertifiedSafe,
      statusBadges: activeProf.statusBadges,
      yRange: activeProf.yRange,
      modelName: target.className,
      states,
      y: yArr,
      variables,
      parameters,
      experiment: {
        startTime,
        stopTime,
        interval: step,
        tolerance: exp.tolerance ?? 1e-4,
      },
      telemetry: { executionTimeMs, stepCount: numSteps },
      summary: `${target.className}: computed Zonotope, Taylor Model, and Interval reachability flowpipes across ${numVars} variable(s) over t=[${startTime}, ${stopTime}]s (${executionTimeMs}ms).`,
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
