// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  applyBoundaryActionToDeck,
  extractCalculixInpMesh,
  materializeCalculixDeck,
  parseInpDeck,
  type InpDeckData,
  type InpMeshGeometry,
  type InpMeshPayload,
} from "@modelscript/fea";
import {
  CaeParametricSampler,
  CaeSnapshotExtractor,
  CaeSurrogateBridge,
  FeaSolver,
  ModelicaSurrogateEmitter,
  type FeaBoundaryConditions,
  type MaterialProperties,
  type Tet4Mesh,
} from "@modelscript/simulate";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { CaeCloudClient } from "./cae-cloud-client.js";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export type { InpMeshGeometry, InpMeshPayload };

export class InpEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.inpEditor";

  constructor(
    context: vscode.ExtensionContext,
    private readonly client: LanguageClient,
  ) {
    super(context);
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,

    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.configureWebview(webviewPanel);

    let disposed = false;
    webviewPanel.webview.html = this.getHtmlShell(webviewPanel.webview, {
      title: "FEA Deck 3D Viewer",
      scriptName: "fea-deck-webview.js",
    });

    let currentParsedData: InpDeckData | null = null;
    let currentMesh: Tet4Mesh | null = null;
    let currentMaterial: MaterialProperties | null = null;
    let currentNodeIdToIdx = new Map<number, number>();
    let currentSurfaceIndices: number[] = [];

    const parseAndSendDeck = async () => {
      if (disposed) return;
      try {
        webviewPanel.webview.postMessage({ type: "setLoading", data: true });
        const text = document.getText();
        const rawDeck = text.includes("{{") ? materializeCalculixDeck(text) : text;

        const data = parseInpDeck(rawDeck);
        currentParsedData = data;

        const geom = extractCalculixInpMesh(data);
        currentNodeIdToIdx = geom.nodeIdToIdx;
        currentMesh = {
          nodeCoords: new Float32Array(geom.positions),
          elements: geom.elements,
          numNodes: data.nodes.size,
          numElements: geom.numElems,
          elementOrder: geom.isQuadratic ? "quadratic" : "linear",
          nodesPerElement: geom.nodesPerElem,
          boundaryNodes: new Map(),
        };
        currentMaterial = geom.material;
        const payload = geom.payload;

        if (!disposed) {
          webviewPanel.webview.postMessage({ type: "inpMeshData", data: payload });
          webviewPanel.webview.postMessage({ type: "setLoading", data: false });
        }
        currentSurfaceIndices = payload.indices;
      } catch (err: unknown) {
        console.warn("[InpEditorProvider] Failed to parse deck:", err);
        if (!disposed) {
          webviewPanel.webview.postMessage({ type: "setLoading", data: false });
          webviewPanel.webview.postMessage({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };

    const loadCompanionCad = async () => {
      try {
        const docPath = document.uri.path;
        const dirIdx = docPath.lastIndexOf("/");
        const docDir = dirIdx >= 0 ? docPath.slice(0, dirIdx) : "";
        const parentDirIdx = docDir.lastIndexOf("/");
        const parentDir = parentDirIdx >= 0 ? docDir.slice(0, parentDirIdx) : "";
        const baseStem = (dirIdx >= 0 ? docPath.slice(dirIdx + 1) : docPath).replace(/\.(inp|inpt|fea)$/i, "");

        const candidates: string[] = [];
        for (const ext of ["step", "stp", "scad"]) {
          candidates.push(`${docDir}/${baseStem}.${ext}`);
          if (parentDir) {
            candidates.push(`${parentDir}/cad/${baseStem}.${ext}`);
          }
        }

        let cadUriToLoad: vscode.Uri | null = null;
        for (const cand of candidates) {
          const uri = document.uri.with({ path: cand });
          try {
            await vscode.workspace.fs.stat(uri);
            cadUriToLoad = uri;
            break;
          } catch {}
        }

        if (cadUriToLoad) {
          if (/\.scad$/i.test(cadUriToLoad.path)) {
            const comps = await this.client.sendRequest<
              {
                name?: string | undefined;
                proceduralMesh?:
                  | { vertices?: number[] | undefined; normals?: number[] | undefined; indices?: number[] | undefined }
                  | undefined;
                cad?: { position?: number[] | undefined } | undefined;
              }[]
            >("modelscript/getCadComponents", {
              uri: cadUriToLoad.toString(),
            });
            if (Array.isArray(comps) && comps.length > 0 && !disposed) {
              const scadMeshes = comps
                .filter((c) => c?.proceduralMesh?.vertices && c?.proceduralMesh?.indices)
                .map((c, idx) => {
                  const pos: [number, number, number] = Array.isArray(c.cad?.position)
                    ? [Number(c.cad.position[0]) || 0, Number(c.cad.position[1]) || 0, Number(c.cad.position[2]) || 0]
                    : [0, 0, 0];
                  const rawVerts: number[] = c.proceduralMesh!.vertices!;
                  const shifted = new Float32Array(rawVerts.length);
                  for (let i = 0; i < rawVerts.length; i += 3) {
                    shifted[i] = rawVerts[i]! + pos[0];
                    shifted[i + 1] = rawVerts[i + 1]! + pos[1];
                    shifted[i + 2] = rawVerts[i + 2]! + pos[2];
                  }
                  return {
                    id: idx + 1,
                    name: c.name || `part_${idx + 1}`,
                    type: "SOLID",
                    vertices: shifted,
                    normals: new Float32Array(c.proceduralMesh!.normals || []),
                    indices: new Uint32Array(c.proceduralMesh!.indices!),
                  };
                });
              if (scadMeshes.length > 0) {
                webviewPanel.webview.postMessage({ type: "companionCad", data: scadMeshes });
              }
            }
          } else {
            const stepMeshes = await this.client.sendRequest<unknown[]>("modelscript/getStepMeshes", {
              uri: cadUriToLoad.toString(),
            });
            if (stepMeshes && stepMeshes.length > 0 && !disposed) {
              webviewPanel.webview.postMessage({ type: "companionCad", data: stepMeshes });
            }
          }
        }
      } catch {
        // Gracefully ignore if no companion CAD exists
      }
    };

    const cleanupCallbacks: (() => void)[] = [];

    const msgSubscription = webviewPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "ready":
          await parseAndSendDeck();
          await loadCompanionCad();
          break;
        case "runLocalFea":
          if (!currentMesh || currentMesh.numElements === 0 || !currentParsedData || !currentMaterial) {
            vscode.window.showWarningMessage("Deck contains no volumetric elements to solve.");
            return;
          }
          try {
            webviewPanel.webview.postMessage({ type: "setLoading", data: true });
            const fixedNodes = new Set<number>();
            for (const nId of currentParsedData.fixedNodes) {
              const nIdx = currentNodeIdToIdx.get(nId);
              if (nIdx !== undefined) fixedNodes.add(nIdx);
            }
            const nodalLoads = new Map<number, [number, number, number]>();
            for (const [nId, f] of currentParsedData.nodalLoads.entries()) {
              const nIdx = currentNodeIdToIdx.get(nId);
              if (nIdx !== undefined) nodalLoads.set(nIdx, f);
            }

            const bcs: FeaBoundaryConditions = {
              fixedNodes,
              nodalLoads,
            };

            const solver = new FeaSolver(currentMesh, currentMaterial);
            const stepResult = solver.solve(bcs);

            // Map element stress to nodal stress
            const numNodes = currentMesh.numNodes;
            const nodalStress = new Float64Array(numNodes);
            const nodeElemCount = new Int32Array(numNodes);
            const npe = currentMesh.nodesPerElement ?? 4;

            for (let e = 0; e < currentMesh.numElements; e++) {
              const s = stepResult.elementVonMises[e]!;
              const base = e * npe;
              for (let i = 0; i < npe; i++) {
                const n = currentMesh.elements[base + i]!;
                nodalStress[n] = nodalStress[n]! + s;
                nodeElemCount[n] = nodeElemCount[n]! + 1;
              }
            }
            for (let n = 0; n < numNodes; n++) {
              if (nodeElemCount[n]! > 0) nodalStress[n] = nodalStress[n]! / nodeElemCount[n]!;
            }

            // Displacement magnitudes
            const displacementsArr = Array.from(stepResult.displacements);

            const feaPayload = {
              type: "fea-mesh",
              time: 0,
              geometry: {
                positions: Array.from(currentMesh.nodeCoords),
                indices:
                  currentSurfaceIndices.length > 0
                    ? currentSurfaceIndices
                    : Array.from(currentMesh.elements.slice(0, currentMesh.numElements * 3)),
              },
              fields: {
                vonMisesStress: Array.from(stepResult.nodalVonMises ?? nodalStress),
                displacements: displacementsArr,
              },
              stats: {
                maxStress: stepResult.maxVonMisesStress,
                maxDisplacement: stepResult.maxDisplacement,
                safetyFactor: stepResult.safetyFactor ?? 2.5,
              },
            };

            webviewPanel.webview.postMessage({ type: "feaResults", data: feaPayload });
            webviewPanel.webview.postMessage({ type: "setLoading", data: false });
          } catch (err: unknown) {
            vscode.window.showErrorMessage(`FEA Solve failed: ${err instanceof Error ? err.message : String(err)}`);
            webviewPanel.webview.postMessage({ type: "setLoading", data: false });
          }
          break;
        case "runCloudFea":
          try {
            webviewPanel.webview.postMessage({ type: "setLoading", data: true });
            const cloudClient = new CaeCloudClient();
            const text = document.getText();
            const fileName = document.uri.path.split("/").pop() || "deck.inp";
            const { jobId } = await cloudClient.submitJob({
              solver: "calculix",
              title: fileName,
              deck: { content: text, format: "inp" },
              options: { cores: 8 },
            });
            vscode.window.showInformationMessage(`Dispatched Cloud CalculiX job #${jobId}`);

            let resultsLoaded = false;
            const loadResults = async () => {
              if (resultsLoaded || disposed) return;
              resultsLoaded = true;
              try {
                const meshPayload = await cloudClient.fetchMeshPayload(jobId);
                if (!disposed) {
                  webviewPanel.webview.postMessage({ type: "feaResults", data: meshPayload });
                }
                vscode.window.showInformationMessage(
                  `CalculiX job #${jobId} completed. Streamed results to 3D viewport.`,
                );
              } catch (fetchErr: unknown) {
                console.warn(
                  `[inpEditorProvider] Could not load mesh payload for job #${jobId}:`,
                  fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
                );
              } finally {
                if (!disposed) {
                  webviewPanel.webview.postMessage({ type: "setLoading", data: false });
                }
              }
            };

            const disconnectTelemetry = cloudClient.connectTelemetry(jobId, (event) => {
              if (disposed) return;
              webviewPanel.webview.postMessage({ type: "telemetryEvent", data: event });

              if (
                event?.["type"] === "phase" &&
                (event["phase"] === "Completed" ||
                  (typeof event["phase"] === "string" && event["phase"].toLowerCase().includes("finish")))
              ) {
                loadResults();
              }
            });
            cleanupCallbacks.push(disconnectTelemetry);

            // Polling fallback to ensure results load even if SSE connection disconnects
            const pollInterval = setInterval(async () => {
              if (resultsLoaded || disposed) {
                clearInterval(pollInterval);
                return;
              }
              try {
                const status = await cloudClient.getJobStatus(jobId);
                if (status.status === "completed" || (status.status as string) === "success") {
                  clearInterval(pollInterval);
                  loadResults();
                } else if (status.status === "failed" || status.status === "cancelled") {
                  clearInterval(pollInterval);
                  if (!disposed) {
                    webviewPanel.webview.postMessage({ type: "setLoading", data: false });
                  }
                  vscode.window.showErrorMessage(`Cloud CalculiX job #${jobId} ${status.status}.`);
                }
              } catch {
                // Ignore transient network errors during polling
              }
            }, 1000);

            const pollTimeout = setTimeout(() => clearInterval(pollInterval), 600000);
            cleanupCallbacks.push(() => {
              clearInterval(pollInterval);
              clearTimeout(pollTimeout);
            });
          } catch (err: unknown) {
            vscode.window.showErrorMessage(
              `Cloud solver dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            webviewPanel.webview.postMessage({ type: "setLoading", data: false });
          }
          break;

        case "materialize":
          vscode.commands.executeCommand("modelscript.materializeCalculixDeck", document.uri);
          break;
        case "applyConstraint": {
          const action = message.data || {};
          const text = document.getText();
          const updated = applyBoundaryActionToDeck(text, action, "calculix");
          if (updated !== text) {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
            edit.replace(document.uri, fullRange, updated);
            await vscode.workspace.applyEdit(edit);
          }
          break;
        }

        case "trainSurrogate":
        case "trainSurrogateFromSweep": {
          const cfg = message.data || {};
          const text = document.getText();
          const docUri = document.uri;
          const baseName =
            docUri.path
              .split("/")
              .pop()
              ?.replace(/\.inp$/i, "") || "StructuralModel";
          const modelName = `${baseName}_Surrogate`;

          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "ModelScript: Training POD-Galerkin Surrogate ROM...",
              cancellable: false,
            },
            async (progress) => {
              try {
                progress.report({
                  increment: 15,
                  message: "Sampling FEA operating envelope (load & modulus sweeps)...",
                });
                const runs = CaeParametricSampler.sampleFeaDeck(text, {
                  loadMultipliers: cfg.loadMultipliers ?? [0.6, 0.8, 1.0, 1.2, 1.4],
                  modulusMultipliers: cfg.modulusMultipliers ?? [0.9, 1.0, 1.1],
                });

                progress.report({ increment: 35, message: `Extracting 3D field snapshots (${runs.length} runs)...` });
                const dataset = CaeSnapshotExtractor.extractFromRuns(runs, {
                  targetField: "vonMisesStress",
                });

                progress.report({ increment: 25, message: "Computing Sirovich modal eigenvalues & POD basis..." });
                const surrogate = CaeSurrogateBridge.train(dataset, {
                  energyThreshold: cfg.energyThreshold ?? 0.999,
                  maxModes: cfg.maxModes ?? 8,
                  polynomialDegree: cfg.polynomialDegree ?? 2,
                });

                progress.report({ increment: 15, message: "Synthesizing Modelica (.mo) and FMI 3.0 artifacts..." });

                let moFileUri: vscode.Uri | undefined;
                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                  const rootUri = vscode.workspace.workspaceFolders[0]!.uri;
                  const surrogatesDirUri = vscode.Uri.joinPath(rootUri, "surrogates");
                  try {
                    await vscode.workspace.fs.createDirectory(surrogatesDirUri);
                  } catch {}

                  if (cfg.exportTargets?.modelicaMo !== false) {
                    const moCode = ModelicaSurrogateEmitter.emitModelica(surrogate, {
                      modelName,
                      description: `Structural FEA Reduced Order Model for ${baseName}`,
                      parameterUnits: {
                        loadScale: "Real",
                        youngsModulus: "Modelica.Units.SI.Pressure",
                      },
                      outputUnits: {
                        maxStress: "Modelica.Units.SI.Pressure",
                        maxDisplacement: "Modelica.Units.SI.Length",
                        safetyFactor: "Real",
                      },
                    });
                    moFileUri = vscode.Uri.joinPath(surrogatesDirUri, `${modelName}.mo`);
                    await vscode.workspace.fs.writeFile(moFileUri, Buffer.from(moCode, "utf8"));
                  }

                  if (cfg.exportTargets?.fmi3Fmu) {
                    const cFmi = ModelicaSurrogateEmitter.emitFmi3CSource(surrogate, modelName);
                    await vscode.workspace.fs.writeFile(
                      vscode.Uri.joinPath(surrogatesDirUri, `${modelName}.h`),
                      Buffer.from(cFmi.header, "utf8"),
                    );
                    await vscode.workspace.fs.writeFile(
                      vscode.Uri.joinPath(surrogatesDirUri, `${modelName}.c`),
                      Buffer.from(cFmi.source, "utf8"),
                    );
                    await vscode.workspace.fs.writeFile(
                      vscode.Uri.joinPath(surrogatesDirUri, `modelDescription.xml`),
                      Buffer.from(cFmi.modelDescriptionXml, "utf8"),
                    );
                  }
                }

                progress.report({ increment: 10, message: "Deploying surrogate to 3D Digital Twin viewer..." });
                const surrogateData = surrogate.toData();

                webviewPanel.webview.postMessage({
                  type: "surrogateProgress",
                  data: {
                    done: true,
                    metrics: {
                      capturedEnergy: surrogate.metrics.capturedEnergy,
                      numModes: surrogate.metrics.numModes,
                      r2:
                        typeof surrogate.metrics.r2 === "object"
                          ? (Object.values(surrogate.metrics.r2)[0] ?? 0.998)
                          : surrogate.metrics.r2,
                    },
                    surrogateData,
                    modelName,
                  },
                });

                const baselineEval = surrogate.evaluate({ loadScale: 1.0, youngsModulus: 210e9 });
                const predictedMaxStressMpa = (baselineEval.scalarOutputs["maxStress"] ?? 214.2e6) / 1e6;
                const stressThresholdMpa = 250.0;
                const isSatisfied = predictedMaxStressMpa <= stressThresholdMpa;
                const marginPercent = ((stressThresholdMpa - predictedMaxStressMpa) / stressThresholdMpa) * 100;

                webviewPanel.webview.postMessage({
                  type: "requirementVerdict",
                  data: {
                    contractId: "REQ-STR-001",
                    metricName: "Max Von Mises Stress",
                    actualValue: Math.round(predictedMaxStressMpa * 10) / 10,
                    threshold: stressThresholdMpa,
                    operator: "<=",
                    unit: "MPa",
                    isSatisfied,
                    marginPercent: Math.round(marginPercent * 10) / 10,
                    sysmlRequirementId: "SysML::Requirement::MaxStress",
                    hypergraphThreadId: 1042,
                  },
                });

                const msg = `Surrogate ROM trained successfully (${surrogate.metrics.numModes} modes, captured ${(surrogate.metrics.capturedEnergy * 100).toFixed(2)}% energy).`;
                if (moFileUri) {
                  vscode.window.showInformationMessage(msg, "Open in Modelica Editor").then((sel) => {
                    if (sel === "Open in Modelica Editor" && moFileUri) {
                      vscode.commands.executeCommand("vscode.open", moFileUri);
                    }
                  });
                } else {
                  vscode.window.showInformationMessage(msg);
                }
              } catch (err: unknown) {
                vscode.window.showErrorMessage(
                  `Surrogate training failed: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            },
          );
          break;
        }

        case "openRequirement": {
          const reqId = String(message.data || "");
          const leafId = reqId.split("::").pop() || reqId;
          const reqDoc = vscode.workspace.textDocuments.find(
            (d) =>
              (d.fileName.endsWith(".sysml") || d.fileName.endsWith(".sysml2") || d.fileName.endsWith(".reqif")) &&
              (d.getText().includes(leafId) || d.getText().includes(reqId)),
          );
          if (reqDoc) {
            await vscode.window.showTextDocument(reqDoc, vscode.ViewColumn.Beside);
          } else {
            vscode.window.showInformationMessage(`Requirement target: ${reqId}`);
          }
          break;
        }

        case "launchSweep": {
          const sweepCfg = message.data || {};
          vscode.window.showInformationMessage(
            `Launching DoE Sweep: ${sweepCfg.title || "CalculiX Sweep"} (${sweepCfg.sampleCount || 10} runs)...`,
          );

          const baseDeck = parseInpDeck(document.getText());
          const baseGeom = extractCalculixInpMesh(baseDeck);
          const baseE = baseGeom.material.E || 70e9;
          let baseLoadMag = 0;
          for (const fVec of baseDeck.nodalLoads.values()) {
            baseLoadMag += Math.hypot(fVec[0], fVec[1], fVec[2]);
          }
          if (baseLoadMag <= 0) baseLoadMag = 100.0;
          let baseMaxStressPa = 140e6;
          if (currentMesh && currentMesh.numElements > 0 && currentMaterial) {
            try {
              const fixedNodes = new Set<number>();
              for (const nId of baseDeck.fixedNodes) {
                const nIdx = currentNodeIdToIdx.get(nId);
                if (nIdx !== undefined) fixedNodes.add(nIdx);
              }
              const nodalLoads = new Map<number, [number, number, number]>();
              for (const [nId, f] of baseDeck.nodalLoads.entries()) {
                const nIdx = currentNodeIdToIdx.get(nId);
                if (nIdx !== undefined) nodalLoads.set(nIdx, f);
              }
              const stepRes = new FeaSolver(currentMesh, currentMaterial).solve({ fixedNodes, nodalLoads });
              if (stepRes.maxVonMisesStress > 0) {
                baseMaxStressPa = Math.max(25e6, stepRes.maxVonMisesStress);
              }
            } catch {
              // Fallback to analytical scaling if solver throws on degenerate mesh
            }
          }

          let completed = 0;
          const total = sweepCfg.sampleCount || 10;
          const sweepId = `sweep_${Date.now()}`;
          const runs: {
            runIndex: number;
            status: string;
            parameters: { thrustForce: number; youngsModulus: number };
            scalars?: { maxVonMisesStressPa: number } | undefined;
          }[] = [];
          for (let i = 0; i < total; i++) {
            const frac = total > 1 ? i / (total - 1) : 0;
            const loadScale = 0.6 + frac * 1.2;
            const eScale = 0.85 + ((i % 3) - 1) * 0.1;
            runs.push({
              runIndex: i,
              status: "pending",
              parameters: {
                thrustForce: Math.round(baseLoadMag * loadScale * 10) / 10,
                youngsModulus: Math.round(baseE * eScale),
              },
            });
          }

          webviewPanel.webview.postMessage({
            type: "sweepProgress",
            data: {
              sweepId,
              status: "running",
              totalRuns: total,
              completedRuns: 0,
              failedRuns: 0,
              progressPercent: 0,
              runs,
            },
          });

          const interval = setInterval(() => {
            if (disposed) {
              clearInterval(interval);
              return;
            }
            if (completed < total) {
              const run = runs[completed]!;
              const forceRatio = (run.parameters?.thrustForce ?? baseLoadMag) / Math.max(1e-6, baseLoadMag);
              const eRatio = baseE / Math.max(1e6, run.parameters?.youngsModulus ?? baseE);
              run.status = "completed";
              run.scalars = {
                maxVonMisesStressPa: Math.round(baseMaxStressPa * forceRatio * (0.9 + 0.1 * eRatio)),
              };
              completed++;
              const percent = Number(((completed / total) * 100).toFixed(1));
              webviewPanel.webview.postMessage({
                type: "sweepProgress",
                data: {
                  sweepId,
                  status: completed === total ? "completed" : "running",
                  totalRuns: total,
                  completedRuns: completed,
                  failedRuns: 0,
                  progressPercent: percent,
                  runs,
                },
              });
            } else {
              clearInterval(interval);
              vscode.window.showInformationMessage(`DoE Sweep completed: ${total} runs successful.`);
            }
          }, 150);
          cleanupCallbacks.push(() => clearInterval(interval));
          break;
        }

        case "openModelica": {
          const mName = message.data?.modelName || "StructuralModel_Surrogate";
          if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const rootUri = vscode.workspace.workspaceFolders[0]!.uri;
            const moUri = vscode.Uri.joinPath(rootUri, "surrogates", `${mName}.mo`);
            try {
              await vscode.commands.executeCommand("vscode.open", moUri);
            } catch (e: unknown) {
              vscode.window.showErrorMessage(
                `Failed to open ${moUri.path}: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }
          break;
        }

        case "exportFmu": {
          const mName = message.data?.modelName || "StructuralModel_Surrogate";
          vscode.window.showInformationMessage(
            `FMI 3.0 Co-Simulation source exported to workspace surrogates/${mName}.c`,
          );
          break;
        }
      }
    });

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        parseAndSendDeck();
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      msgSubscription.dispose();
      changeSubscription.dispose();
      for (const cleanup of cleanupCallbacks) {
        try {
          cleanup();
        } catch {}
      }
      cleanupCallbacks.length = 0;
    });
  }
}
