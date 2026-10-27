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

interface EmtActionExecuteResponse extends EmtSimulationResultPayload {
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
          let targetUri = (args instanceof vscode.Uri ? args.toString() : args?.uri) ?? targetDoc?.uri.toString();
          if (!targetUri) {
            const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
            if (tab?.input instanceof vscode.TabInputCustom) {
              targetUri = tab.input.uri.toString();
            }
          }
          const inputs: { documentText?: string | undefined; name?: string | undefined } & Record<string, unknown> =
            typeof args === "object" && args && !(args instanceof vscode.Uri) ? { ...args } : {};
          if (!inputs.documentText) {
            if (targetDoc) {
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

          if (action.id === "simulate_hybrid_emt" || action.category === "simulate") {
            try {
              return await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: action.title ? `Running ${action.title}...` : "Running EMT simulation...",
                  cancellable: false,
                },
                async () => {
                  const res = await client.sendRequest<EmtActionExecuteResponse>("modelscript/executeAction", {
                    actionId: action.id,
                    uri: targetUri,
                    languageId: action.languageId ?? targetDoc?.languageId ?? "pscad",
                    inputs,
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

                      if (simRes.busPhaseVoltages) {
                        const mapEntries: [string, PhaseMapValue][] =
                          simRes.busPhaseVoltages instanceof Map
                            ? Array.from(simRes.busPhaseVoltages.entries())
                            : Object.entries(simRes.busPhaseVoltages);
                        for (const [bus, phases] of mapEntries) {
                          for (const ph of ["a", "b", "c"] as const) {
                            if (phases?.[ph]) {
                              stateNames.push(`v_${bus}_${ph}`);
                              yRows.push(Array.from(phases[ph]));
                            }
                          }
                        }
                      } else if (simRes.busVoltages) {
                        const mapEntries: [string, Iterable<number> | ArrayLike<number>][] =
                          simRes.busVoltages instanceof Map
                            ? Array.from(simRes.busVoltages.entries())
                            : Object.entries(simRes.busVoltages);
                        for (const [bus, arr] of mapEntries) {
                          stateNames.push(`v_${bus}`);
                          yRows.push(Array.from(arr));
                        }
                      }

                      if (simRes.branchPhaseCurrents) {
                        const mapEntries: [string, PhaseMapValue][] =
                          simRes.branchPhaseCurrents instanceof Map
                            ? Array.from(simRes.branchPhaseCurrents.entries())
                            : Object.entries(simRes.branchPhaseCurrents);
                        for (const [branch, phases] of mapEntries) {
                          for (const ph of ["a", "b", "c"] as const) {
                            if (phases?.[ph]) {
                              stateNames.push(`i_${branch}_${ph}`);
                              yRows.push(Array.from(phases[ph]));
                            }
                          }
                        }
                      } else if (simRes.branchCurrents) {
                        const mapEntries: [string, Iterable<number> | ArrayLike<number>][] =
                          simRes.branchCurrents instanceof Map
                            ? Array.from(simRes.branchCurrents.entries())
                            : Object.entries(simRes.branchCurrents);
                        for (const [branch, arr] of mapEntries) {
                          stateNames.push(`i_${branch}`);
                          yRows.push(Array.from(arr));
                        }
                      }

                      if (yRows.length > 0) {
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

                        const dt =
                          timeArr.length > 1 ? timeArr[1]! - timeArr[0]! : (res?.settings?.timeStepUs ?? 50) * 1e-6;
                        const tStop = timeArr[timeArr.length - 1] ?? res?.settings?.durationSec ?? 0.25;

                        SimulationPanel.createOrShowWithData(
                          context.extensionUri,
                          {
                            t: timeArr,
                            states: stateNames,
                            y: yMatrix,
                            parameters: [],
                            experiment: {
                              startTime: timeArr[0] ?? 0,
                              stopTime: tStop,
                              interval: dt,
                              tolerance: 1e-4,
                              solver: "Dommel Companion (EMT)",
                            },
                            comtrade: res?.comtrade ?? simRes?.comtrade,
                            pscadOut: res?.pscadOut ?? simRes?.pscadOut,
                            projectName: res?.project ?? "pscad_model",
                          },
                          targetUri || "",
                          client,
                        );
                        return res;
                      }
                    }
                  }
                  if (res?.complianceReport) {
                    vscode.window.showInformationMessage(
                      `IEEE 2800 Verification: ${res.complianceReport.overallCompliance ? "PASS" : "NON-COMPLIANT"} (${res.complianceReport.clauses?.length ?? 0} clauses evaluated).`,
                    );
                  }
                  return res;
                },
              );
            } catch (simErr: unknown) {
              const errMsg = simErr instanceof Error ? simErr.message : String(simErr);
              vscode.window.showErrorMessage(`Simulation failed: ${errMsg}`);
              throw simErr;
            }
          }

          return await client.sendRequest("modelscript/executeAction", {
            actionId: action.id,
            uri: targetUri,
            languageId: action.languageId ?? targetDoc?.languageId,
            inputs,
          });
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
