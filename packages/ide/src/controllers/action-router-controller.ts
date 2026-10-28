// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { SimulationPanel } from "../simulation-panel.js";

const STATIC_ACTION_COMMANDS = new Set([
  "modelscript.modelica.simulate",
  "modelscript.modelica.flatten",
  "modelscript.action.simulate",
  "modelscript.action.flatten",
  "modelscript.flatten",
  "modelscript.runSimulation",
  "modelscript.scad.preview_csg",
  "modelscript.scad.export_step",
  "modelscript.previewCsg",
]);

interface DynamicActionDescriptor {
  id: string;
  title?: string | undefined;
  category?: string | undefined;
  languageId?: string | undefined;
}

type ActionCommandArgs =
  | string
  | vscode.Uri
  | ({
      uri?: string | undefined;
      documentText?: string | undefined;
      name?: string | undefined;
    } & Record<string, unknown>);

type PhaseMapValue = Partial<Record<"a" | "b" | "c", Iterable<number> | ArrayLike<number>>>;

interface EmtSimulationResultPayload {
  time?: number[] | Float64Array | ArrayBufferView | undefined;
  t?: number[] | Float64Array | ArrayBufferView | undefined;
  busPhaseVoltages?: Map<string, PhaseMapValue> | Record<string, PhaseMapValue> | undefined;
  busVoltages?:
    | Map<string, Iterable<number> | ArrayLike<number>>
    | Record<string, Iterable<number> | ArrayLike<number>>
    | undefined;
  branchPhaseCurrents?: Map<string, PhaseMapValue> | Record<string, PhaseMapValue> | undefined;
  branchCurrents?:
    | Map<string, Iterable<number> | ArrayLike<number>>
    | Record<string, Iterable<number> | ArrayLike<number>>
    | undefined;
  comtrade?: { cfg: string; dat: string } | undefined;
  pscadOut?: { inf: string; out: { suffix: string; content: string }[] } | undefined;
}

export interface EmtActionExecuteResponse extends EmtSimulationResultPayload {
  simulationResult?: EmtSimulationResultPayload | undefined;
  settings?: { timeStepUs?: number | undefined; durationSec?: number | undefined } | undefined;
  project?: string | undefined;
  complianceReport?:
    | {
        overallCompliance?: boolean | undefined;
        clauses?: unknown[] | undefined;
      }
    | undefined;
}

interface TrajectoryResult {
  t: number[];
  states: string[];
  y: number[][];
}

interface ActionExecutionResult {
  simulationResult?: {
    comtrade?: { cfg: string; dat: string } | undefined;
    pscadOut?: { inf: string; out: { suffix: string; content: string }[] } | undefined;
    [key: string]: unknown;
  };
  trajectory?: unknown;
  comtrade?: { cfg: string; dat: string } | undefined;
  pscadOut?: { inf: string; out: { suffix: string; content: string }[] } | undefined;
  project?: string;
  complianceReport?: {
    overallCompliance?: boolean;
    clauses?: unknown[];
  };
  variableCount?: number;
  equationCount?: number;
  compliant?: boolean;
  passed?: boolean;
  [key: string]: unknown;
}

interface RawSimulationData {
  simulationResult?: unknown;
  trajectory?: unknown;
  t?: unknown;
  states?: unknown;
  y?: unknown;
  time?: unknown;
  timePoints?: unknown;
  times?: unknown;
  steps?: unknown;
  busPhaseVoltages?: unknown;
  busVoltages?: unknown;
  branchPhaseCurrents?: unknown;
  branchCurrents?: unknown;
  history?: unknown;
  dtMs?: unknown;
  [key: string]: unknown;
}

function normalizeToTrajectory(raw: unknown): TrajectoryResult | null {
  if (!raw || typeof raw !== "object") return null;
  const rawObj = raw as RawSimulationData;
  const rawSub = rawObj.simulationResult ?? rawObj.trajectory ?? raw;
  if (!rawSub || typeof rawSub !== "object") return null;
  const obj = rawSub as RawSimulationData;

  // 1. Direct Arena DAE format: { t: number[], states: string[], y: number[][] }
  if (Array.isArray(obj.t) && Array.isArray(obj.states) && Array.isArray(obj.y) && obj.t.length > 0) {
    return { t: obj.t as number[], states: obj.states as string[], y: obj.y as number[][] };
  }

  // 2. Time vector extraction
  const rawTime = obj.time ?? obj.t ?? obj.timePoints ?? obj.times ?? obj.steps;
  const timeArr: number[] = Array.isArray(rawTime)
    ? rawTime.map(Number)
    : rawTime instanceof Float64Array || ArrayBuffer.isView(rawTime)
      ? Array.from(rawTime as unknown as ArrayLike<number>)
      : [];

  const stateNames: string[] = [];
  const yRows: number[][] = [];

  const addSeriesMap = (prefix: string, mapOrObj: unknown) => {
    if (!mapOrObj || typeof mapOrObj !== "object") return;
    const entries: [string, unknown][] =
      mapOrObj instanceof Map ? Array.from(mapOrObj.entries()) : Object.entries(mapOrObj);
    for (const [k, val] of entries) {
      if (Array.isArray(val) || val instanceof Float64Array || ArrayBuffer.isView(val)) {
        const arr = Array.from(val as ArrayLike<number>).map(Number);
        if (arr.length > 0 && !arr.some(isNaN)) {
          stateNames.push(prefix ? `${prefix}_${k}` : k);
          yRows.push(arr);
        }
      } else if (val && typeof val === "object") {
        for (const [subK, subVal] of Object.entries(val as Record<string, unknown>)) {
          if (Array.isArray(subVal) || subVal instanceof Float64Array || ArrayBuffer.isView(subVal)) {
            const arr = Array.from(subVal as ArrayLike<number>).map(Number);
            if (arr.length > 0) {
              stateNames.push(`${prefix ? `${prefix}_` : ""}${k}_${subK}`);
              yRows.push(arr);
            }
          }
        }
      }
    }
  };

  if (obj.busPhaseVoltages) addSeriesMap("v", obj.busPhaseVoltages);
  else if (obj.busVoltages) addSeriesMap("v", obj.busVoltages);
  if (obj.branchPhaseCurrents) addSeriesMap("i", obj.branchPhaseCurrents);
  else if (obj.branchCurrents) addSeriesMap("i", obj.branchCurrents);

  for (const field of [
    "variables",
    "series",
    "signals",
    "species",
    "traces",
    "channels",
    "nodes",
    "pressures",
    "temperatures",
    "flows",
    "holdups",
    "history",
    "results",
  ]) {
    if (obj[field] && !Array.isArray(obj[field])) {
      addSeriesMap("", obj[field]);
    }
  }

  // PLCopen / step history array of records: { history: Record<string, number>[] }
  if (
    yRows.length === 0 &&
    Array.isArray(obj.history) &&
    obj.history.length > 0 &&
    typeof obj.history[0] === "object"
  ) {
    const historyRows = obj.history as Record<string, unknown>[];
    const firstRow = historyRows[0] ?? {};
    const keys = Object.keys(firstRow).filter((k) => k !== "time" && k !== "cycle");
    const dtMs = typeof obj.dtMs === "number" ? obj.dtMs : 10;
    const tHist = historyRows.map((row, idx) => Number(row["time"] ?? idx * dtMs * 0.001));
    for (const k of keys) {
      stateNames.push(k);
      yRows.push(historyRows.map((row) => Number(row[k] ?? 0)));
    }
    if (timeArr.length === 0) timeArr.push(...tHist);
  }

  // Top-level numeric arrays alongside time
  if (yRows.length === 0 && timeArr.length > 0) {
    for (const [k, val] of Object.entries(obj)) {
      if (k === "time" || k === "t" || k === "timePoints" || k === "times" || k === "steps") continue;
      if (Array.isArray(val) && val.length === timeArr.length && typeof val[0] === "number") {
        stateNames.push(k);
        yRows.push(val as number[]);
      }
    }
  }

  if (timeArr.length > 0 && yRows.length > 0) {
    const nSteps = timeArr.length;
    const nVars = yRows.length;
    const yMatrix: number[][] = new Array(nSteps);
    for (let ti = 0; ti < nSteps; ti++) {
      const row = new Array(nVars);
      for (let vi = 0; vi < nVars; vi++) {
        row[vi] = yRows[vi]![ti] ?? 0;
      }
      yMatrix[ti] = row;
    }
    return { t: timeArr, states: stateNames, y: yMatrix };
  }

  return null;
}

export async function registerDynamicActions(
  context: vscode.ExtensionContext,
  client: LanguageClient,
  safeRegisterCommand: (commandId: string, callback: (...args: never[]) => unknown) => vscode.Disposable,
): Promise<void> {
  try {
    const actions = await client.sendRequest<DynamicActionDescriptor[]>("modelscript/listActions", {});
    if (!Array.isArray(actions)) return;

    for (const action of actions) {
      if (!action.id) continue;
      try {
        const cmdId = `modelscript.action.${action.id}`;
        const handler = async (args?: ActionCommandArgs) => {
          const targetDoc = vscode.window.activeTextEditor?.document;
          let targetUri =
            (typeof args === "string" ? args : args instanceof vscode.Uri ? args.toString() : args?.uri) ??
            targetDoc?.uri.toString();
          if (!targetUri) {
            const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (tab?.input instanceof vscode.TabInputCustom) {
              targetUri = tab.input.uri.toString();
            }
          }
          const inputs: { documentText?: string | undefined; name?: string | undefined } & Record<string, unknown> =
            typeof args === "object" && args && !(args instanceof vscode.Uri) ? { ...args } : {};
          if (!inputs.documentText) {
            if (targetDoc && (!targetUri || targetDoc.uri.toString() === targetUri)) {
              inputs.documentText = targetDoc.getText();
            } else if (targetUri) {
              const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === targetUri);
              if (openDoc) {
                inputs.documentText = openDoc.getText();
              } else {
                try {
                  const fileBytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(targetUri));
                  inputs.documentText = new TextDecoder().decode(fileBytes);
                } catch {
                  // ignore
                }
              }
            }
          }
          if (!inputs.name && inputs.documentText) {
            const text = inputs.documentText;
            const m = text.match(/\b(?:model|block|class|record)\s+([A-Za-z0-9_]+)/);
            if (m) inputs.name = m[1];
          }
          if (action.id === "open_diagram" || action.id === "diagram" || action.id === "openDiagram") {
            return await vscode.commands.executeCommand("modelscript.openDiagram", args);
          }
          if (action.id === "open_cad_viewer") {
            return await vscode.commands.executeCommand("modelscript.openStepViewer", args);
          }
          if (action.id === "preview_csg" || action.id === "scad_preview_csg") {
            return await vscode.commands.executeCommand("modelscript.previewCsg", args);
          }
          if (action.id === "open_requirements_matrix") {
            return await vscode.commands.executeCommand("modelscript.openRequirements", args);
          }
          if (action.id === "export_fmu") {
            return await vscode.commands.executeCommand("modelscript.exportFmi2", args);
          }
          if (action.id === "compile_wasm") {
            return await vscode.commands.executeCommand("modelscript.compileWasm", args);
          }
          if (action.id === "analyze_blt") {
            return await vscode.commands.executeCommand("modelscript.analyzeBlt", args);
          }
          if (action.id === "generate_multibody") {
            return await vscode.commands.executeCommand("modelscript.generateMultiBody", args);
          }
          if (action.id === "generate_fea_mesh" || action.id === "discretize_fea") {
            return await vscode.commands.executeCommand("modelscript.generateFeaMesh", args);
          }
          if (action.id === "generate_cfd_mesh" || action.id === "discretize_cfd") {
            return await vscode.commands.executeCommand("modelscript.generateCfdMesh", args);
          }
          if (action.id === "create_fea_setup") {
            return await vscode.commands.executeCommand("modelscript.createFeaSetup", args);
          }
          if (action.id === "create_cfd_setup") {
            return await vscode.commands.executeCommand("modelscript.createCfdSetup", args);
          }
          if (action.id === "export_step" || action.id === "scad_export_step") {
            const isScad = targetUri?.endsWith(".scad") || targetDoc?.languageId === "scad";
            if (isScad) {
              return await vscode.commands.executeCommand("modelscript.scad.exportStep", args);
            }
            return await vscode.commands.executeCommand("modelscript.exportShapeToStep", args);
          }
          if (action.id === "materialize_deck") {
            return await vscode.commands.executeCommand("modelscript.materializeCalculixDeck", args);
          }
          if (action.id === "materialize_config") {
            return await vscode.commands.executeCommand("modelscript.materializeSu2Config", args);
          }
          if (action.id === "open_ontology_diagram") {
            return await vscode.commands.executeCommand("modelscript.owl2.openDiagram", args);
          }
          if (action.id === "launch_cosimulation") {
            return await vscode.commands.executeCommand("modelscript.cosimOpenLivePlot", args);
          }

          return await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: action.title ? `Running ${action.title}...` : `Executing ${action.id}...`,
              cancellable: false,
            },
            async () => {
              const res = await client.sendRequest<ActionExecutionResult | string | unknown[]>(
                "modelscript/executeAction",
                {
                  actionId: action.id,
                  uri: targetUri,
                  languageId: action.languageId ?? targetDoc?.languageId,
                  inputs,
                },
              );

              const traj = normalizeToTrajectory(res);
              if (traj) {
                const resObj = (
                  typeof res === "object" && !Array.isArray(res) ? res : null
                ) as ActionExecutionResult | null;
                const dt = traj.t.length > 1 ? traj.t[1]! - traj.t[0]! : 0.01;
                const tStop = traj.t[traj.t.length - 1] ?? 1.0;
                SimulationPanel.createOrShowWithData(
                  context.extensionUri,
                  {
                    t: traj.t,
                    states: traj.states,
                    y: traj.y,
                    parameters: [],
                    experiment: {
                      startTime: traj.t[0] ?? 0,
                      stopTime: tStop,
                      interval: dt,
                      tolerance: 1e-4,
                      solver: action.title ?? action.id,
                    },
                    comtrade: resObj?.comtrade ?? resObj?.simulationResult?.comtrade,
                    pscadOut: resObj?.pscadOut ?? resObj?.simulationResult?.pscadOut,
                    projectName:
                      resObj?.project ?? (inputs.name as string | undefined) ?? action.languageId ?? "simulation",
                  },
                  targetUri || "",
                  client,
                );
                return res;
              }

              if (typeof res === "string" && res.trim().length > 0 && !res.trimStart().startsWith("<svg")) {
                const langHint = action.id.includes("modelica")
                  ? "modelica"
                  : action.id.includes("sysml")
                    ? "sysml2"
                    : action.id.includes("ssp")
                      ? "xml"
                      : action.id.includes("spice")
                        ? "spice"
                        : "plaintext";
                const doc = await vscode.workspace.openTextDocument({ content: res, language: langHint });
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
                return res;
              }

              const resObj = typeof res === "object" && !Array.isArray(res) ? (res as ActionExecutionResult) : null;
              if (resObj?.complianceReport) {
                vscode.window.showInformationMessage(
                  `IEEE 2800 Verification: ${resObj.complianceReport.overallCompliance ? "PASS" : "NON-COMPLIANT"} (${resObj.complianceReport.clauses?.length ?? 0} clauses evaluated).`,
                );
              } else if (Array.isArray(res)) {
                vscode.window.showInformationMessage(
                  `${action.title ?? action.id}: ${res.length === 0 ? "✓ 0 issues found (Verified Clean)" : `${res.length} diagnostic(s) reported`}.`,
                );
              } else if (resObj) {
                if (typeof resObj.variableCount === "number" && typeof resObj.equationCount === "number") {
                  vscode.window.showInformationMessage(
                    `${action.title ?? action.id}: Lowered to DAE (${resObj.variableCount} variables, ${resObj.equationCount} equations).`,
                  );
                } else if (typeof resObj.compliant === "boolean" || typeof resObj.passed === "boolean") {
                  const ok = resObj.compliant ?? resObj.passed;
                  vscode.window.showInformationMessage(`${action.title ?? action.id}: ${ok ? "✓ PASS" : "✗ FAIL"}`);
                }
              }

              return res;
            },
          );
        };

        if (!STATIC_ACTION_COMMANDS.has(cmdId)) {
          context.subscriptions.push(safeRegisterCommand(cmdId, handler));
        }
        if (action.languageId) {
          const langCmdId = `modelscript.${action.languageId}.${action.id}`;
          if (!STATIC_ACTION_COMMANDS.has(langCmdId)) {
            context.subscriptions.push(safeRegisterCommand(langCmdId, handler));
          }
        }
      } catch (actionErr) {
        console.warn(`[client] Failed to register dynamic action '${action.id}':`, actionErr);
      }
    }
  } catch (err) {
    console.warn("[client] Could not register dynamic language actions:", err);
  }
}
