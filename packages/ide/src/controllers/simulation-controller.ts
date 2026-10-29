// SPDX-License-Identifier: AGPL-3.0-or-later

import { simulateDroneReachability } from "@modelscript/runtime";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import { CalibrationPanel } from "../calibration-panel.js";
import { CandidateTradeStudyPanel } from "../candidate-trade-study-panel.js";
import type { FmuContentProvider } from "../fmu-document-provider.js";
import { OptimizationPanel } from "../optimization-panel.js";
import { decodeBase64ToArray } from "../services/virtual-fs-service.js";
import { type FlowpipeEnvelope, SimulationPanel } from "../simulation-panel.js";
import { SurrogatePanel } from "../surrogate-panel.js";
import { UncertaintyPanel } from "../uncertainty-panel.js";
import { getSimulationDefaults } from "../utils/config.js";
import { extractFromZip } from "../utils/zip.js";
import { VerificationPanel } from "../verification-panel.js";

interface ModelicaActionInputs extends Record<string, unknown> {
  documentText?: string | undefined;
  name?: string | undefined;
  stopTime?: number | undefined;
  intervals?: number | undefined;
  tolerance?: number | undefined;
  solver?: string | undefined;
}

type SimulationCommandArg =
  | vscode.Uri
  | ({
      scheme?: string | undefined;
      path?: string | undefined;
      uri?: vscode.Uri | string | undefined;
    } & ModelicaActionInputs)
  | string
  | undefined;

interface ModelicaSimulateResponse {
  t?: number[] | undefined;
  states?: string[] | undefined;
  y?: number[][] | undefined;
  experiment?:
    | {
        startTime?: number | undefined;
        stopTime?: number | undefined;
        interval?: number | undefined;
        tolerance?: number | undefined;
        solver?: string | undefined;
      }
    | undefined;
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
  telemetry?: { executionTimeMs: number; stepCount: number } | undefined;
  projectName?: string | undefined;
  error?: string | undefined;
}

type PhaseSeriesMap = Partial<Record<"a" | "b" | "c", Iterable<number> | ArrayLike<number>>>;

interface PscadSimulationPayload {
  time?: number[] | Float64Array | ArrayBufferView | undefined;
  t?: number[] | Float64Array | ArrayBufferView | undefined;
  busPhaseVoltages?: Map<string, PhaseSeriesMap> | Record<string, PhaseSeriesMap> | undefined;
  busVoltages?:
    | Map<string, Iterable<number> | ArrayLike<number>>
    | Record<string, Iterable<number> | ArrayLike<number>>
    | undefined;
  branchCurrents?:
    | Map<string, Iterable<number> | ArrayLike<number>>
    | Record<string, Iterable<number> | ArrayLike<number>>
    | undefined;
}

interface PscadSimulateActionResponse extends PscadSimulationPayload {
  simulationResult?: PscadSimulationPayload | undefined;
  comtrade?: { cfg: string; dat: string } | undefined;
  pscadOut?: { inf: string; out: { suffix: string; content: string }[] } | undefined;
  pscadPsout?: Uint8Array | string | undefined;
  project?: string | undefined;
}

export function registerSimulationCommands(
  context: vscode.ExtensionContext,
  client: LanguageClient | undefined,
  outputChannel: vscode.OutputChannel,
  fmuContentProvider?: FmuContentProvider,
  onVerificationCompleted?: () => void,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("modelscript.runSimulation", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.fileName.endsWith(".mos")) {
        outputChannel.clear();
        outputChannel.show(true);
        try {
          const result = await client.sendRequest<{ output: string }>("modelscript/runScript", {
            uri: editor.document.uri.toString(),
          });
          outputChannel.appendLine(result.output || "(no output)");
        } catch (e) {
          outputChannel.appendLine(`Error: ${e}`);
        }
      } else if (editor?.document.uri.scheme === "fmu-view") {
        outputChannel.clear();
        outputChannel.show(true);
        try {
          const name = editor.document.uri.path.replace(/^\//, "");
          const fmuBytes = fmuContentProvider?.getFmuBytes(name);
          if (!fmuBytes) {
            vscode.window.showErrorMessage("FMU data not found in cache.");
            return;
          }
          const jsBytes = extractFromZip(fmuBytes, "resources/model.js");
          if (!jsBytes) {
            vscode.window.showErrorMessage("No resources/model.js found in FMU. Please re-export the FMU.");
            return;
          }

          const jsCode = new TextDecoder().decode(jsBytes);

          // Evaluate the JS inside an encapsulated strict factory
          interface FmuJsInstance {
            vars: number[];
            doStep(t: number, dt: number): void;
          }
          const DynamicFunction = Object.getPrototypeOf(function () {}).constructor as (
            ...args: string[]
          ) => () => FmuJsInstance;
          const createFmuInstance = DynamicFunction(
            `"use strict";\n${jsCode}\nif (typeof FmuModel === "undefined") { throw new Error("FmuModel not defined in FMU JS"); }\nreturn new FmuModel();`,
          );
          const inst = createFmuInstance();

          let t = 0.0;
          const dt = 0.01;
          const tStop = 10.0;

          // Collect series data
          const result: { time: number[]; series: Record<string, number[]> } = { time: [], series: {} };
          for (let i = 0; i < inst.vars.length; i++) {
            result.series[`var_${i}`] = [];
          }

          inst.doStep(0, 0); // initial eval
          while (t <= tStop) {
            result.time.push(t);
            for (let i = 0; i < inst.vars.length; i++) {
              result.series[`var_${i}`]!.push(inst.vars[i]!);
            }
            inst.doStep(t, dt);
            t += dt;
          }

          const text = editor.document.getText();
          const varLines = text.split("\n").filter((line) => line.includes("/* VR="));

          const states: string[] = [];
          const y: number[][] = [];
          for (const line of varLines) {
            const match = line.match(/Real (.*?); \/\* VR=(\d+) \*\//);
            if (match) {
              const varName = match[1]!.trim();
              const vr = parseInt(match[2]!);
              states.push(varName);
              y.push(result.series[`var_${vr}`] || []);
            }
          }

          // Show Plot
          SimulationPanel.createOrShowWithData(
            context.extensionUri,
            {
              t: result.time,
              states,
              y,
              experiment: {
                startTime: result.time[0] ?? 0,
                stopTime: result.time[result.time.length - 1] ?? 1,
                interval: result.time.length > 1 ? result.time[1]! - result.time[0]! : 0.002,
                tolerance: 1e-4,
                solver: "dopri5",
              },
            },
            editor.document.uri.toString(),
            client,
          );
          outputChannel.appendLine("FMU (JS) Simulation complete.");
        } catch (e) {
          vscode.window.showErrorMessage(`FMU JavaScript Evaluation Error: ${e}`);
          outputChannel.appendLine(`Error executing JS FMU: ${e}`);
        }
      } else {
        SimulationPanel.createOrShow(context.extensionUri, client);
      }
    }),

    vscode.commands.registerCommand("modelscript.action.simulate", async (args?: SimulationCommandArg) => {
      return vscode.commands.executeCommand("modelscript.modelica.simulate", args);
    }),

    vscode.commands.registerCommand("modelscript.modelica.simulate", async (args?: SimulationCommandArg) => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      let uri = editor?.document.uri.toString();
      let inputs: ModelicaActionInputs = {};
      if (args && typeof args === "object") {
        if ("scheme" in args && "path" in args && args.scheme && args.path) {
          uri = args.toString();
        } else if (typeof args.toString === "function" && args.scheme) {
          uri = args.toString();
        } else {
          inputs = { ...args };
        }
      }
      if (!uri && editor?.document) {
        uri = editor.document.uri.toString();
      }
      if (!uri) {
        const candidate =
          vscode.window.visibleTextEditors.find(
            (e) =>
              e.document.uri.scheme !== "output" &&
              (e.document.uri.path.endsWith(".mo") || e.document.languageId === "modelica"),
          )?.document ??
          vscode.workspace.textDocuments.find(
            (d) => d.uri.scheme !== "output" && (d.uri.path.endsWith(".mo") || d.languageId === "modelica"),
          );
        if (candidate) {
          uri = candidate.uri.toString();
          if (!inputs.documentText) inputs.documentText = candidate.getText();
          if (!inputs.name) {
            const wm = candidate.getText().match(/^\s*within\s*([a-zA-Z0-9_.]+)\s*;/m);
            const m = candidate.getText().match(/\b(?:model|block|class|record)\s+([A-Za-z0-9_]+)/);
            if (m) {
              inputs.name = wm && wm[1]?.trim() ? `${wm[1].trim()}.${m[1]}` : m[1];
            }
          }
        }
      }
      if (!inputs.documentText && editor?.document) {
        inputs.documentText = editor.document.getText();
      }
      if (inputs.documentText && !inputs.name) {
        const wm = inputs.documentText.match(/^\s*within\s*([a-zA-Z0-9_.]+)\s*;/m);
        const m = inputs.documentText.match(/\b(?:model|block|class|record)\s+([A-Za-z0-9_]+)/);
        if (m) {
          inputs.name = wm && wm[1]?.trim() ? `${wm[1].trim()}.${m[1]}` : m[1];
        }
      }

      const simDefaults = getSimulationDefaults();
      if (inputs.stopTime === undefined) inputs.stopTime = simDefaults.stopTime;
      if (inputs.intervals === undefined) inputs.intervals = simDefaults.intervals;
      if (inputs.tolerance === undefined) inputs.tolerance = simDefaults.tolerance;
      if (inputs.solver === undefined) inputs.solver = simDefaults.solver;

      try {
        const lang = editor?.document.languageId ?? "modelica";
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Simulating ${inputs.name || "Model"}...`,
            cancellable: false,
          },
          async () => {
            const res = await client!.sendRequest<ModelicaSimulateResponse>("modelscript/executeAction", {
              actionId: "simulate",
              languageId: lang,
              uri,
              inputs,
            });

            if (res && res.t && res.t.length > 0) {
              SimulationPanel.createOrShowWithData(
                context.extensionUri,
                {
                  t: res.t,
                  states: res.states || [],
                  y: res.y || [],
                  experiment: res.experiment ?? {
                    startTime: 0,
                    stopTime: simDefaults.stopTime,
                    interval: simDefaults.stopTime / Math.max(1, simDefaults.intervals),
                    tolerance: simDefaults.tolerance,
                    solver: simDefaults.solver,
                  },
                  parameters: res.parameters ?? [],
                  telemetry: res.telemetry,
                  projectName: res.projectName ?? inputs.name,
                },
                uri ?? "",
                client,
              );
            } else if (res && res.error) {
              vscode.window.showErrorMessage(`Simulation failed: ${res.error}`);
              outputChannel.appendLine(`[Simulation Error] ${res.error}`);
              outputChannel.show(true);
            }
          },
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Simulation failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand(
      "modelscript.openLineGeometryEditor",
      async (args?: {
        uri?: string | undefined;
        componentName?: string | undefined;
        params?: Record<string, unknown> | undefined;
      }) => {
        const { LineGeometryPanel } = await import("../line-geometry-panel.js");
        LineGeometryPanel.createOrShow(context.extensionUri, client, args?.uri, args?.componentName, args?.params);
      },
    ),

    vscode.commands.registerCommand("modelscript.diagram.simulate", async (args?: SimulationCommandArg) => {
      if (!client) return;
      let uri =
        args && typeof args === "object" && (args.path || args.scheme)
          ? args.toString()
          : typeof args === "string"
            ? args
            : undefined;
      if (!uri) {
        uri = vscode.window.activeTextEditor?.document.uri.toString();
      }
      if (!uri) {
        const candidate = vscode.workspace.textDocuments.find(
          (d) =>
            d.uri.scheme !== "output" &&
            (d.uri.path.endsWith(".pscx") ||
              d.uri.path.endsWith(".pslx") ||
              d.uri.path.endsWith(".raw") ||
              d.uri.path.endsWith(".dyr") ||
              d.uri.path.endsWith(".mo")),
        );
        if (candidate) uri = candidate.uri.toString();
      }
      if (!uri) {
        vscode.window.showWarningMessage("No active model or diagram document found to simulate.");
        return;
      }

      if (uri.endsWith(".raw") || uri.endsWith(".dyr")) {
        return await vscode.commands.executeCommand("modelscript.psse.simulate_psse_transient", uri);
      }

      const isPscad = uri.endsWith(".pscx") || uri.endsWith(".pslx");
      if (isPscad) {
        return await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Simulating PSCAD Power System (EMT)...",
            cancellable: false,
          },
          async () => {
            try {
              let docText: string | undefined;
              const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
              if (openDoc) docText = openDoc.getText();

              const res = await client!.sendRequest<PscadSimulateActionResponse>("modelscript/executeAction", {
                actionId: "simulate_hybrid_emt",
                languageId: "pscad",
                uri,
                inputs: { ...(docText ? { documentText: docText } : {}), exportPsout: true },
              });

              const simRes = res?.simulationResult ?? res;
              if (simRes) {
                const timeArr: number[] = Array.isArray(simRes.time)
                  ? simRes.time
                  : simRes.time instanceof Float64Array || ArrayBuffer.isView(simRes.time)
                    ? Array.from(simRes.time as unknown as ArrayLike<number>)
                    : simRes.t
                      ? Array.isArray(simRes.t)
                        ? simRes.t
                        : Array.from(simRes.t as unknown as ArrayLike<number>)
                      : [];

                if (timeArr.length > 0) {
                  const stateNames: string[] = [];
                  const yRows: number[][] = [];
                  const busVoltagesObj: Record<string, number[]> = {};
                  const busPhaseVoltagesObj: Record<string, { a: number[]; b: number[]; c: number[] }> = {};
                  const branchCurrentsObj: Record<string, number[]> = {};

                  if (simRes.busPhaseVoltages) {
                    const entries: [string, PhaseSeriesMap][] =
                      simRes.busPhaseVoltages instanceof Map
                        ? Array.from(simRes.busPhaseVoltages.entries())
                        : Object.entries(simRes.busPhaseVoltages);
                    for (const [bus, phases] of entries) {
                      busPhaseVoltagesObj[bus] = {
                        a: Array.from(phases.a ?? []),
                        b: Array.from(phases.b ?? []),
                        c: Array.from(phases.c ?? []),
                      };
                      for (const ph of ["a", "b", "c"] as const) {
                        if (phases?.[ph]) {
                          stateNames.push(`v_${bus}_${ph}`);
                          yRows.push(Array.from(phases[ph]));
                        }
                      }
                    }
                  } else if (simRes.busVoltages) {
                    const entries: [string, Iterable<number> | ArrayLike<number>][] =
                      simRes.busVoltages instanceof Map
                        ? Array.from(simRes.busVoltages.entries())
                        : Object.entries(simRes.busVoltages);
                    for (const [bus, arr] of entries) {
                      busVoltagesObj[bus] = Array.from(arr);
                      stateNames.push(`v_${bus}`);
                      yRows.push(Array.from(arr));
                    }
                  }

                  if (simRes.branchCurrents) {
                    const entries: [string, Iterable<number> | ArrayLike<number>][] =
                      simRes.branchCurrents instanceof Map
                        ? Array.from(simRes.branchCurrents.entries())
                        : Object.entries(simRes.branchCurrents);
                    for (const [branch, arr] of entries) {
                      branchCurrentsObj[branch] = Array.from(arr);
                      stateNames.push(`i_${branch}`);
                      yRows.push(Array.from(arr));
                    }
                  }

                  // Transpose for SimulationPanel
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

                  // 1. Post to active diagram webviews for live hover probing & sparkline scopes
                  const { DiagramEditorProvider } = await import("../diagram-editor-provider.js");
                  DiagramEditorProvider.postSimulationData(uri, {
                    time: timeArr,
                    busVoltages: busVoltagesObj,
                    busPhaseVoltages: busPhaseVoltagesObj,
                    branchCurrents: branchCurrentsObj,
                  });

                  // 2. Open SimulationPanel
                  SimulationPanel.createOrShowWithData(
                    context.extensionUri,
                    {
                      t: timeArr,
                      states: stateNames,
                      y: yMatrix,
                      parameters: [],
                      experiment: {
                        startTime: timeArr[0] ?? 0,
                        stopTime: timeArr[timeArr.length - 1] ?? 0.2,
                        interval: timeArr.length > 1 ? timeArr[1]! - timeArr[0]! : 50e-6,
                        tolerance: 1e-4,
                        solver: "Dommel Companion (EMT)",
                      },
                      comtrade: res?.comtrade,
                      pscadOut: res?.pscadOut,
                      pscadPsout: res?.pscadPsout,
                      projectName: res?.project ?? "pscad_model",
                    },
                    uri,
                    client,
                  );
                }
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              vscode.window.showErrorMessage(`PSCAD Simulation failed: ${msg}`);
            }
          },
        );
      } else {
        return vscode.commands.executeCommand("modelscript.modelica.simulate", args);
      }
    }),

    vscode.commands.registerCommand("modelscript.action.flatten", async (args?: SimulationCommandArg) => {
      return vscode.commands.executeCommand("modelscript.modelica.flatten", args);
    }),

    vscode.commands.registerCommand("modelscript.modelica.flatten", async (args?: SimulationCommandArg) => {
      if (!client) return;
      let editor = vscode.window.activeTextEditor;
      if (editor?.document.uri.scheme === "untitled" || editor?.document.uri.scheme === "output") {
        const candidateEditor = vscode.window.visibleTextEditors.find(
          (e) =>
            e.document.uri.scheme !== "output" &&
            e.document.uri.scheme !== "untitled" &&
            (e.document.uri.path.endsWith(".mo") || e.document.languageId === "modelica"),
        );
        if (candidateEditor) {
          editor = candidateEditor;
        }
      }
      let uri =
        editor?.document.uri.scheme !== "untitled" && editor?.document.uri.scheme !== "output"
          ? editor?.document.uri.toString()
          : undefined;
      let inputs: ModelicaActionInputs = {};
      if (args && typeof args === "object") {
        if ("scheme" in args && "path" in args && args.scheme && args.path) {
          uri = args.toString();
        } else {
          inputs = { ...args };
        }
      }
      if (
        !uri &&
        editor?.document &&
        editor.document.uri.scheme !== "untitled" &&
        editor.document.uri.scheme !== "output"
      ) {
        uri = editor.document.uri.toString();
      }
      if (!uri) {
        const candidate =
          vscode.window.visibleTextEditors.find(
            (e) =>
              e.document.uri.scheme !== "output" &&
              e.document.uri.scheme !== "untitled" &&
              (e.document.uri.path.endsWith(".mo") || e.document.languageId === "modelica"),
          )?.document ??
          vscode.workspace.textDocuments.find(
            (d) =>
              d.uri.scheme !== "output" &&
              d.uri.scheme !== "untitled" &&
              (d.uri.path.endsWith(".mo") || d.languageId === "modelica"),
          );
        if (candidate) {
          uri = candidate.uri.toString();
          if (!inputs.documentText) inputs.documentText = candidate.getText();
          if (!inputs.name) {
            const wm = candidate.getText().match(/^\s*within\s*([a-zA-Z0-9_.]+)\s*;/m);
            const m = candidate.getText().match(/\b(?:model|block|class|record)\s+([A-Za-z0-9_]+)/);
            if (m) {
              inputs.name = wm && wm[1]?.trim() ? `${wm[1].trim()}.${m[1]}` : m[1];
            }
          } else if (!inputs.name.includes(".")) {
            const wm = candidate.getText().match(/^\s*within\s*([a-zA-Z0-9_.]+)\s*;/m);
            if (wm && wm[1]?.trim()) {
              inputs.name = `${wm[1].trim()}.${inputs.name}`;
            }
          }
        }
      }
      if (uri && !inputs.documentText) {
        const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
        if (openDoc) {
          inputs.documentText = openDoc.getText();
        } else {
          try {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
            inputs.documentText = new TextDecoder("utf-8").decode(bytes);
          } catch {
            // ignore
          }
        }
      }
      if (!inputs.documentText && editor?.document) {
        inputs.documentText = editor.document.getText();
      }
      if (inputs.documentText) {
        const wm = inputs.documentText.match(/^\s*within\s*([a-zA-Z0-9_.]+)\s*;/m);
        if (!inputs.name) {
          const m = inputs.documentText.match(/\b(?:model|block|class|record)\s+([A-Za-z0-9_]+)/);
          if (m) {
            inputs.name = wm && wm[1]?.trim() ? `${wm[1].trim()}.${m[1]}` : m[1];
          }
        } else if (!inputs.name.includes(".") && wm && wm[1]?.trim()) {
          inputs.name = `${wm[1].trim()}.${inputs.name}`;
        }
      }
      try {
        const lang = editor?.document.languageId ?? "modelica";
        const res = await client.sendRequest<{ text?: string | undefined }>("modelscript/executeAction", {
          actionId: "flatten",
          languageId: lang,
          uri,
          inputs,
        });
        if (res?.text) {
          const doc = await vscode.workspace.openTextDocument({
            content: res.text,
            language: lang,
          });
          await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Flatten failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("modelscript.flatten", async () => {
      return vscode.commands.executeCommand("modelscript.modelica.flatten");
    }),

    vscode.commands.registerCommand("modelscript.openCalibration", (uri?: string) => {
      if (!client) return;
      CalibrationPanel.createOrShow(context.extensionUri, client, uri);
    }),

    vscode.commands.registerCommand("modelscript.openOptimization", (uri?: string) => {
      if (!client) return;
      OptimizationPanel.createOrShow(context.extensionUri, client, uri);
    }),

    vscode.commands.registerCommand("modelscript.openUncertainty", (uri?: string) => {
      if (!client) return;
      UncertaintyPanel.createOrShow(context.extensionUri, client, uri);
    }),

    vscode.commands.registerCommand("modelscript.openSurrogateEditor", (uri?: string) => {
      if (!client) return;
      SurrogatePanel.createOrShow(context.extensionUri, client, uri);
    }),

    vscode.commands.registerCommand("modelscript.openCandidateTradeStudy", (_uri?: string, entityName?: string) => {
      CandidateTradeStudyPanel.createOrShow(context.extensionUri, client, entityName);
    }),

    vscode.commands.registerCommand(
      "modelscript.exportFmi2",
      async (args?: vscode.Uri | { uri?: vscode.Uri | string | undefined }) => {
        if (!client) return;
        const targetUri =
          args instanceof vscode.Uri
            ? args
            : args?.uri
              ? typeof args.uri === "string"
                ? vscode.Uri.parse(args.uri)
                : args.uri
              : undefined;
        const editor = vscode.window.activeTextEditor;
        const docUri = targetUri ?? editor?.document?.uri;
        if (!docUri) {
          vscode.window.showErrorMessage("Open a model file to export an FMU.");
          return;
        }
        vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Exporting FMI 2.0...", cancellable: false },
          async () => {
            if (!client) return;
            try {
              if (editor?.document && editor.document.isDirty) {
                await editor.document.save();
              }
              const res = await client.sendRequest<{ fmuName: string; base64: string }>("modelscript/exportFmu", {
                uri: docUri.toString(),
                fmiVersion: "2.0",
              });
              const folder =
                vscode.workspace.workspaceFolders?.[0]?.uri ||
                (docUri.scheme !== "untitled" ? vscode.Uri.joinPath(docUri, "..") : vscode.Uri.file("/"));
              const uri = vscode.Uri.joinPath(folder, res.fmuName + ".fmu");
              await vscode.workspace.fs.writeFile(uri, decodeBase64ToArray(res.base64));
              vscode.window.showInformationMessage(`Exported FMI 2.0 to ${res.fmuName}.fmu`);
            } catch (e) {
              vscode.window.showErrorMessage(`FMI 2.0 Export failed: ${e}`);
            }
          },
        );
      },
    ),

    vscode.commands.registerCommand(
      "modelscript.exportFmi3",
      async (args?: vscode.Uri | { uri?: vscode.Uri | string | undefined }) => {
        if (!client) return;
        const targetUri =
          args instanceof vscode.Uri
            ? args
            : args?.uri
              ? typeof args.uri === "string"
                ? vscode.Uri.parse(args.uri)
                : args.uri
              : undefined;
        const editor = vscode.window.activeTextEditor;
        const docUri = targetUri ?? editor?.document?.uri;
        if (!docUri) {
          vscode.window.showErrorMessage("Open a model file to export an FMU.");
          return;
        }
        vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Exporting FMI 3.0...", cancellable: false },
          async () => {
            if (!client) return;
            try {
              if (editor?.document && editor.document.isDirty) {
                await editor.document.save();
              }
              const res = await client.sendRequest<{ fmuName: string; base64: string }>("modelscript/exportFmu", {
                uri: docUri.toString(),
                fmiVersion: "3.0",
              });
              const folder =
                vscode.workspace.workspaceFolders?.[0]?.uri ||
                (docUri.scheme !== "untitled" ? vscode.Uri.joinPath(docUri, "..") : vscode.Uri.file("/"));
              const uri = vscode.Uri.joinPath(folder, res.fmuName + ".fmu");
              await vscode.workspace.fs.writeFile(uri, decodeBase64ToArray(res.base64));
              vscode.window.showInformationMessage(`Exported FMI 3.0 to ${res.fmuName}.fmu`);
            } catch (e) {
              vscode.window.showErrorMessage(`FMI 3.0 Export failed: ${e}`);
            }
          },
        );
      },
    ),

    vscode.commands.registerCommand("modelscript.generateMultiBody", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document.fileName.match(/\.(step|stp)$/i)) {
        vscode.window.showErrorMessage("Open a STEP file (.step or .stp) to generate a Multi-Body model.");
        return;
      }
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Extracting constraints and generating Modelica...",
          cancellable: false,
        },
        async () => {
          if (!client) return;
          try {
            const res = await client.sendRequest<{ source: string; name: string }>("modelscript/generateMultiBody", {
              uri: editor.document.uri.toString(),
            });

            const folder = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file("/");
            const outUri = vscode.Uri.joinPath(folder, `${res.name}.mo`);
            await vscode.workspace.fs.writeFile(outUri, new TextEncoder().encode(res.source));

            vscode.window.showInformationMessage(`Generated Modelica Multi-Body model: ${res.name}.mo`);

            const doc = await vscode.workspace.openTextDocument(outUri);
            await vscode.window.showTextDocument(doc);
          } catch (e) {
            vscode.window.showErrorMessage(`Multi-Body generation failed: ${e}`);
          }
        },
      );
    }),

    vscode.commands.registerCommand("modelscript.compileWasm", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("Open a model file to compile to WebAssembly.");
        return;
      }
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Generating WebAssembly C Source & Build Script...",
          cancellable: false,
        },
        async () => {
          if (!client) return;
          try {
            const res = await client.sendRequest<{
              wasmC: string;
              emccFlags: string[];
              exportedFunctions: string[];
              scalarVariables: { name: string; valueReference: number; causality: string }[];
            }>("modelscript/compileWasm", {
              uri: editor.document.uri.toString(),
            });

            const folder = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file("/");
            const modelName = editor.document.fileName.replace(/.*[/\\]/, "").replace(/\.mo$/, "");
            const cUri = vscode.Uri.joinPath(folder, `${modelName}_wasm.c`);
            await vscode.workspace.fs.writeFile(cUri, new TextEncoder().encode(res.wasmC));

            const buildCmd = `emcc ${modelName}_wasm.c ${res.emccFlags.join(" ")} -o ${modelName}.js`;
            const buildUri = vscode.Uri.joinPath(folder, `BUILD_WASM.md`);
            await vscode.workspace.fs.writeFile(
              buildUri,
              new TextEncoder().encode(
                [
                  `# WebAssembly Build Instructions`,
                  ``,
                  `## Prerequisites`,
                  `- Install [Emscripten](https://emscripten.org/)`,
                  `- Activate the Emscripten environment: \`source emsdk_env.sh\``,
                  ``,
                  `## Build Command`,
                  `\`\`\`bash`,
                  buildCmd,
                  `\`\`\``,
                  ``,
                  `## Output`,
                  `- \`${modelName}.js\` — Emscripten JS glue code`,
                  `- \`${modelName}.wasm\` — WebAssembly binary`,
                  ``,
                  `## Exported Functions`,
                  ...res.exportedFunctions.map((f) => `- \`${f}\``),
                  ``,
                  `## Scalar Variables`,
                  `| Name | Value Reference | Causality |`,
                  `|------|----------------|-----------|`,
                  ...res.scalarVariables.map((sv) => `| ${sv.name} | ${sv.valueReference} | ${sv.causality} |`),
                ].join("\n"),
              ),
            );

            const hasTerminal = typeof vscode.window.createTerminal === "function";
            const choice = await vscode.window.showInformationMessage(
              `Generated WASM C source: ${modelName}_wasm.c and BUILD_WASM.md.`,
              "Open BUILD_WASM.md",
              hasTerminal ? "Run Build in Terminal" : "Copy Build Command",
            );
            if (choice === "Open BUILD_WASM.md") {
              const doc = await vscode.workspace.openTextDocument(buildUri);
              await vscode.window.showTextDocument(doc);
            } else if (choice === "Run Build in Terminal" && hasTerminal) {
              const terminal = vscode.window.createTerminal({ name: "Emscripten WASM Build" });
              terminal.show();
              terminal.sendText(buildCmd);
            } else if (choice === "Copy Build Command") {
              await vscode.env.clipboard.writeText(buildCmd);
              vscode.window.showInformationMessage(`Copied to clipboard: ${buildCmd}`);
            }
          } catch (e) {
            vscode.window.showErrorMessage(`WebAssembly generation failed: ${e}`);
          }
        },
      );
    }),

    vscode.commands.registerCommand("modelscript.runVerification", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("Open a file first to run requirements verification.");
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Running Requirements Verification..." },
        async () => {
          try {
            if (client && editor) {
              await client.sendRequest("modelscript/runVerification", { uri: editor.document.uri.toString() });
              if (onVerificationCompleted) {
                onVerificationCompleted();
              }

              // Forward verification limits to the Simulation Panel for chart overlay
              try {
                const reqs: {
                  peakValue?: number | undefined;
                  limitValue?: number | undefined;
                  lhsName?: string | undefined;
                  status: string;
                }[] = await client.sendRequest("modelscript/getRequirements", {
                  uri: editor.document.uri.toString(),
                });
                const limits = reqs
                  .filter((r): r is typeof r & { limitValue: number } => r.limitValue !== undefined)
                  .map((r) => ({
                    variable: r.lhsName ?? "value",
                    value: r.limitValue,
                    label: `max: ${r.limitValue.toFixed(1)}`,
                    violated: r.status === "Failed",
                  }));
                if (limits.length > 0) {
                  SimulationPanel.postVerificationLimits(limits);
                }
              } catch {
                // Ignore — limit overlay is best-effort
              }
            }
          } catch (e: unknown) {
            vscode.window.showErrorMessage(`Verification failed: ${(e as Error).message}`);
          }
        },
      );
    }),

    vscode.commands.registerCommand("modelscript.openVerificationDashboard", () => {
      if (!client) return;
      VerificationPanel.createOrShow(context.extensionUri, client);
    }),

    vscode.commands.registerCommand("modelscript.verifyAll", async (uri?: string) => {
      if (!client) return;
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri.toString();
      if (!targetUri) {
        vscode.window.showWarningMessage("Open a model file first to run formal verification.");
        return;
      }
      VerificationPanel.createOrShow(context.extensionUri, client);
      try {
        const report = await client.sendRequest<{
          summary?:
            | {
                overallPassed?: boolean | undefined;
                passedStages?: number | undefined;
                totalStages?: number | undefined;
                totalViolations?: number | undefined;
              }
            | undefined;
        }>("modelscript/verifyAll", {
          uri: targetUri,
          options: { all: true },
        });
        if (report?.summary?.overallPassed) {
          vscode.window.showInformationMessage(
            `All formal verification stages passed (${report.summary.passedStages}/${report.summary.totalStages})`,
          );
        } else {
          vscode.window.showWarningMessage(
            `Formal verification detected ${report?.summary?.totalViolations || 0} violation(s).`,
          );
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Verification failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("modelscript.verifyB2B", async (uri?: string) => {
      if (!client) return;
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri.toString();
      if (!targetUri) {
        vscode.window.showWarningMessage("Open a Modelica model file first to run B2B equivalence verification.");
        return;
      }
      VerificationPanel.createOrShow(context.extensionUri, client);
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Running ISO 26262 Back-to-Back (MiL vs SiL) Equivalence Verification...",
          cancellable: false,
        },
        async () => {
          try {
            const res = await client!.sendRequest<{
              success?: boolean | undefined;
              maxDiscrepancy?: number | undefined;
              sha256CSource?: string | undefined;
              tolerance?: number | undefined;
              error?: string | undefined;
              stage?: { summary?: string | undefined } | undefined;
            }>("modelscript/verifyB2B", { uri: targetUri, format: "dhf" });
            if (res.success) {
              const disc = res.maxDiscrepancy !== undefined ? res.maxDiscrepancy.toExponential(3) : "0.0";
              const sha = res.sha256CSource ? res.sha256CSource.slice(0, 12) : "unknown";
              vscode.window.showInformationMessage(
                `B2B Equivalence PASSED (ISO 26262 ASIL D / TCL1): Max discrepancy ${disc} <= tolerance ${res.tolerance}. C99 SHA: ${sha}...`,
              );
            } else {
              vscode.window.showErrorMessage(
                `B2B Equivalence FAILED: ${res.error || res.stage?.summary || "Discrepancy exceeds tolerance"}`,
              );
            }
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`B2B Equivalence failed: ${msg}`);
          }
        },
      );
    }),

    vscode.commands.registerCommand("modelscript.verifyDecisionLogic", async (uri?: string) => {
      if (!client) return;
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri.toString();
      if (!targetUri) return;
      VerificationPanel.createOrShow(context.extensionUri, client);
      await client.sendRequest("modelscript/verifyAll", { uri: targetUri, options: { decisions: true } });
    }),

    vscode.commands.registerCommand(
      "modelscript.showDaeVerificationDetails",
      (_uri: string, className: string, proof?: { issues?: { message: string }[] | undefined }) => {
        const msg = proof?.issues?.length
          ? `DAE Verification Issues for ${className}:\n` + proof.issues.map((i) => `• ${i.message}`).join("\n")
          : `DAE Verification: No singularity found among bounded variables for ${className || "model"}.`;
        vscode.window.showInformationMessage(msg);
      },
    ),

    vscode.commands.registerCommand("modelscript.runReachabilityFlowpipe", async (uri?: string) => {
      if (!client) return;
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri.toString();
      if (!targetUri) return;
      VerificationPanel.createOrShow(context.extensionUri, client);
      await client.sendRequest("modelscript/verifyAll", { uri: targetUri, options: { flowpipes: true } });
    }),

    vscode.commands.registerCommand("modelscript.generateBoundaryTests", async (uri?: string) => {
      if (!client) return;
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri.toString();
      if (!targetUri) return;
      await client.sendRequest("modelscript/verifyAll", {
        uri: targetUri,
        options: { regionDecomposition: true, mcdc: true },
      });
    }),

    vscode.commands.registerCommand(
      "modelscript.openDroneReachabilityDemo",
      async (uriArg?: string, classNameArg?: string) => {
        const doc = vscode.window.activeTextEditor?.document;
        const targetUri = typeof uriArg === "string" && uriArg.length > 0 ? uriArg : doc?.uri.toString();

        if (client && targetUri) {
          try {
            const reachResult = await SimulationPanel.createOrShowReachability(
              context.extensionUri,
              client,
              targetUri,
              typeof classNameArg === "string" ? classNameArg : undefined,
            );
            if (reachResult && !reachResult.error && reachResult.t && reachResult.t.length > 0) {
              if (reachResult.summary) {
                vscode.window.showInformationMessage(`Reachability analysis: ${reachResult.summary}`);
              }
              return;
            }
          } catch (err) {
            console.warn(
              "[ModelScript] LSP reachability request failed, falling back to local solver if applicable:",
              err,
            );
          }
        }

        // Fallback when no LSP client is connected or for standalone drone reachability demo
        let m = 1.2;
        let A = 0.03;
        let Cd = 0.8;
        let z_target = 11.0;
        let kz = 3.1;
        let kv = 1.35;
        let w_max = 0.5;
        let v_limit = 12.0;

        if (doc) {
          const text = doc.getText();
          const mMatch = text.match(/\bm\s*=\s*([\d.]+)/);
          if (mMatch) m = parseFloat(mMatch[1]!);
          const aMatch = text.match(/\bA\s*=\s*([\d.]+)/);
          if (aMatch) A = parseFloat(aMatch[1]!);
          const cdMatch = text.match(/\bCd\s*=\s*([\d.]+)/i);
          if (cdMatch) Cd = parseFloat(cdMatch[1]!);
          const zMatch = text.match(/\bz_target\s*=\s*([\d.]+)/);
          if (zMatch) z_target = parseFloat(zMatch[1]!);
          const kzMatch = text.match(/\bkz\s*=\s*([\d.]+)/);
          if (kzMatch) kz = parseFloat(kzMatch[1]!);
          const kvMatch = text.match(/\bkv\s*=\s*([\d.]+)/);
          if (kvMatch) kv = parseFloat(kvMatch[1]!);
          const vLimitMatch = text.match(/\bv_climb_max\s*=\s*([\d.]+)/);
          if (vLimitMatch) v_limit = parseFloat(vLimitMatch[1]!);
          const wMatch =
            text.match(/\b(?:w_max)\s*=\s*([\d.]+)/) || text.match(/\binput\s+Real\s+w\s*\([^)]*max\s*=\s*([\d.]+)/);
          if (wMatch) w_max = parseFloat(wMatch[1]!);
        }

        const res = simulateDroneReachability({
          m,
          A,
          Cd,
          rho: 1.225,
          z_target,
          kz,
          kv,
          w_max,
          v_limit,
        });

        if (client) {
          await SimulationPanel.createOrShow(context.extensionUri, client);
        }

        const envelopes: FlowpipeEnvelope[] = [
          {
            name: "Interval Arithmetic (linearized, non-rigorous)",
            kind: "interval",
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
            name: "Zonotope (linearized, non-rigorous)",
            kind: "zonotope",
            color: "#22c55e",
            fillColor: "rgba(34, 197, 94, 0.28)",
            lo: res.zonotopeLo,
            hi: res.zonotopeHi,
            peakVal: res.zonotopeMaxVelocity,
          },
        ];

        const statusBadges: { text: string; kind: "pass" | "warn" | "fail" }[] = [
          {
            text: res.envelopeWithinLimit
              ? `Zonotope estimate: peak v = ${res.zonotopeMaxVelocity} <= ${v_limit} m/s (not a proof)`
              : `Zonotope estimate: peak v = ${res.zonotopeMaxVelocity} > ${v_limit} m/s (not a proof)`,
            kind: "warn",
          },
        ];
        if (res.intervalBreachTime !== undefined) {
          statusBadges.push({
            text: `Interval wrapping blow-up crosses limit @ t = ${res.intervalBreachTime}s`,
            kind: "warn",
          });
        }

        SimulationPanel.postReachabilityData({
          t: res.time,
          variable: "v",
          nominalTrajectory: res.nominal,
          envelopes,
          requirementLimit: v_limit,
          requirementLabel: `SysML v2 FlightCeiling: v(t) <= ${v_limit} m/s`,
          isCertifiedSafe: res.envelopeWithinLimit,
          statusBadges,
          yRange: [-6.0, 15.5],
        });

        vscode.window.showInformationMessage(`Reachability estimate (non-rigorous): ${res.summary}`);
      },
    ),
  ];
}
