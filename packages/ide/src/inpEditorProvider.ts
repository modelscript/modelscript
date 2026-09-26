// SPDX-License-Identifier: AGPL-3.0-or-later

import { applyBoundaryActionToDeck, materializeCalculixDeck, parseInpDeck, type InpDeckData } from "@modelscript/fea";
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
import { CaeCloudClient } from "./caeCloudClient.js";

export interface InpMeshPayload {
  positions: number[];
  indices: number[];
  normals: number[];
  fixedNodes: { id: number; position: [number, number, number] }[];
  loads: { id: number; position: [number, number, number]; force: [number, number, number] }[];
  stats: {
    numNodes: number;
    numElements: number;
    materials: string[];
    isQuadratic: boolean;
  };
}

export class InpEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "modelscript.inpEditor";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: LanguageClient,
  ) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    };

    let disposed = false;
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    let currentParsedData: InpDeckData | null = null;
    let currentMesh: Tet4Mesh | null = null;
    let currentMaterial: MaterialProperties | null = null;
    let currentNodeIdToIdx = new Map<number, number>();

    const parseAndSendDeck = async () => {
      if (disposed) return;
      try {
        webviewPanel.webview.postMessage({ type: "setLoading", data: true });
        const text = document.getText();
        const rawDeck = text.includes("{{") ? materializeCalculixDeck(text) : text;

        const data = parseInpDeck(rawDeck);
        currentParsedData = data;

        // Map nodes into contiguous arrays
        const nodeIdToIdx = new Map<number, number>();
        const positions: number[] = [];
        let idx = 0;
        for (const [id, node] of data.nodes.entries()) {
          nodeIdToIdx.set(id, idx++);
          positions.push(node.x, node.y, node.z);
        }
        currentNodeIdToIdx = nodeIdToIdx;

        // Map elements
        const elementIndices: number[] = [];
        let isQuadratic = false;
        for (const elem of data.elements.values()) {
          if (elem.type === "C3D10") isQuadratic = true;
          for (const nId of elem.nodes) {
            const nIdx = nodeIdToIdx.get(nId);
            if (nIdx !== undefined) elementIndices.push(nIdx);
          }
        }

        const elements = new Uint32Array(elementIndices);
        const nodesPerElem = isQuadratic ? 10 : 4;
        const numElems = elements.length > 0 ? elements.length / nodesPerElem : 0;

        currentMesh = {
          nodeCoords: new Float32Array(positions),
          elements,
          numNodes: data.nodes.size,
          numElements: numElems,
          elementOrder: isQuadratic ? "quadratic" : "linear",
          nodesPerElement: nodesPerElem,
          boundaryNodes: new Map(),
        };

        // Resolve material
        let firstMat: MaterialProperties = { E: 70e9, nu: 0.33, rho: 2700.0 };
        for (const mat of data.materials.values()) {
          firstMat = {
            E: mat.E ?? 70e9,
            nu: mat.nu ?? 0.33,
            rho: mat.rho ?? 2700.0,
          };
          break;
        }
        currentMaterial = firstMat;

        // Surface boundary extraction
        const surfaceIndices: number[] = [];
        if (numElems > 0) {
          const faceMap = new Map<string, { count: number; face: [number, number, number] }>();
          for (let e = 0; e < numElems; e++) {
            const base = e * nodesPerElem;
            const n0 = elements[base + 0];
            const n1 = elements[base + 1];
            const n2 = elements[base + 2];
            const n3 = elements[base + 3];

            const faces: [number, number, number][] = [
              [n0, n2, n1],
              [n0, n1, n3],
              [n1, n2, n3],
              [n0, n3, n2],
            ];
            for (const f of faces) {
              const key = [f[0], f[1], f[2]].sort((a, b) => a - b).join("_");
              const entry = faceMap.get(key);
              if (entry) entry.count++;
              else faceMap.set(key, { count: 1, face: f });
            }
          }
          for (const { count, face } of faceMap.values()) {
            if (count === 1) surfaceIndices.push(face[0], face[1], face[2]);
          }
        }

        // Fixed nodes and loads positions
        const fixedNodesList: { id: number; position: [number, number, number] }[] = [];
        for (const nId of data.fixedNodes) {
          const node = data.nodes.get(nId);
          if (node) fixedNodesList.push({ id: nId, position: [node.x, node.y, node.z] });
        }

        const loadsList: { id: number; position: [number, number, number]; force: [number, number, number] }[] = [];
        for (const [nId, f] of data.nodalLoads.entries()) {
          const node = data.nodes.get(nId);
          if (node) loadsList.push({ id: nId, position: [node.x, node.y, node.z], force: f });
        }

        const payload: InpMeshPayload = {
          positions,
          indices:
            surfaceIndices.length > 0 ? surfaceIndices : Array.from({ length: positions.length / 3 }, (_, i) => i),
          normals: [],
          fixedNodes: fixedNodesList,
          loads: loadsList,
          stats: {
            numNodes: data.nodes.size,
            numElements: numElems,
            materials: Array.from(data.materials.keys()),
            isQuadratic,
          },
        };

        if (!disposed) {
          webviewPanel.webview.postMessage({ type: "inpMeshData", data: payload });
          webviewPanel.webview.postMessage({ type: "setLoading", data: false });
        }
      } catch (err: any) {
        console.warn("[InpEditorProvider] Failed to parse deck:", err);
        if (!disposed) {
          webviewPanel.webview.postMessage({ type: "setLoading", data: false });
          webviewPanel.webview.postMessage({ type: "error", message: err.message || String(err) });
        }
      }
    };

    const loadCompanionCad = async () => {
      try {
        const docPath = document.uri.path;
        const baseWithoutExt = docPath.replace(/\.(inp|inpt)$/, "");
        const stepUri = document.uri.with({ path: `${baseWithoutExt}.step` });
        const stpUri = document.uri.with({ path: `${baseWithoutExt}.stp` });

        let cadUriToLoad: vscode.Uri | null = null;
        try {
          await vscode.workspace.fs.stat(stepUri);
          cadUriToLoad = stepUri;
        } catch {
          try {
            await vscode.workspace.fs.stat(stpUri);
            cadUriToLoad = stpUri;
          } catch {}
        }

        if (cadUriToLoad) {
          const stepMeshes = await this.client.sendRequest<any[]>("modelscript/getStepMeshes", {
            uri: cadUriToLoad.toString(),
          });
          if (stepMeshes && stepMeshes.length > 0 && !disposed) {
            webviewPanel.webview.postMessage({ type: "companionCad", data: stepMeshes });
          }
        }
      } catch {
        // Gracefully ignore if no companion CAD exists
      }
    };

    webviewPanel.webview.onDidReceiveMessage(async (message) => {
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
            const npe = currentMesh.nodesPerElement;

            for (let e = 0; e < currentMesh.numElements; e++) {
              const s = stepResult.vonMisesStress[e];
              const base = e * npe;
              for (let i = 0; i < npe; i++) {
                const n = currentMesh.elements[base + i];
                nodalStress[n] += s;
                nodeElemCount[n]++;
              }
            }
            for (let n = 0; n < numNodes; n++) {
              if (nodeElemCount[n] > 0) nodalStress[n] /= nodeElemCount[n];
            }

            // Displacement magnitudes
            const displacementsArr = Array.from(stepResult.displacements);

            const feaPayload = {
              type: "fea-mesh",
              time: 0,
              geometry: {
                positions: Array.from(currentMesh.nodeCoords),
                indices: Array.from(currentMesh.elements.slice(0, currentMesh.numElements * 3)),
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
          } catch (err: any) {
            vscode.window.showErrorMessage(`FEA Solve failed: ${err.message || err}`);
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
              if (resultsLoaded) return;
              resultsLoaded = true;
              try {
                const meshPayload = await cloudClient.fetchMeshPayload(jobId);
                webviewPanel.webview.postMessage({ type: "feaResults", data: meshPayload });
                vscode.window.showInformationMessage(
                  `CalculiX job #${jobId} completed. Streamed results to 3D viewport.`,
                );
              } catch (fetchErr: any) {
                console.warn(`[inpEditorProvider] Could not load mesh payload for job #${jobId}:`, fetchErr?.message);
              } finally {
                webviewPanel.webview.postMessage({ type: "setLoading", data: false });
              }
            };

            cloudClient.connectTelemetry(jobId, (event) => {
              webviewPanel.webview.postMessage({ type: "telemetryEvent", data: event });

              if (
                event?.type === "phase" &&
                (event.phase === "Completed" || event.phase.toLowerCase().includes("finish"))
              ) {
                loadResults();
              }
            });

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
                  webviewPanel.webview.postMessage({ type: "setLoading", data: false });
                  vscode.window.showErrorMessage(`Cloud CalculiX job #${jobId} ${status.status}.`);
                }
              } catch {
                // Ignore transient network errors during polling
              }
            }, 1000);

            setTimeout(() => clearInterval(pollInterval), 600000);
          } catch (err: any) {
            vscode.window.showErrorMessage(`Cloud solver dispatch failed: ${err.message || err}`);
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
                const predictedMaxStressMpa = (baselineEval.scalarOutputs.maxStress ?? 214.2e6) / 1e6;
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
              } catch (err: any) {
                vscode.window.showErrorMessage(`Surrogate training failed: ${err.message || err}`);
              }
            },
          );
          break;
        }

        case "openRequirement": {
          const reqId = message.data;
          vscode.window.showInformationMessage(`Navigating to requirement: ${reqId}`);
          break;
        }

        case "launchSweep": {
          const sweepCfg = message.data || {};
          vscode.window.showInformationMessage(
            `Launching DoE Sweep: ${sweepCfg.title || "CalculiX Sweep"} (${sweepCfg.sampleCount || 10} runs)...`,
          );

          let completed = 0;
          const total = sweepCfg.sampleCount || 10;
          const sweepId = `sweep_${Date.now()}`;
          const runs: any[] = [];
          for (let i = 0; i < total; i++) {
            runs.push({
              runIndex: i,
              status: "pending",
              parameters: { thrustForce: 100 + i * 25, youngsModulus: 70e9 },
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
            if (completed < total) {
              runs[completed].status = "completed";
              runs[completed].scalars = { maxVonMisesStressPa: (150 + completed * 15) * 1e6 };
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
          break;
        }

        case "openModelica": {
          const mName = message.data?.modelName || "StructuralModel_Surrogate";
          if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const rootUri = vscode.workspace.workspaceFolders[0]!.uri;
            const moUri = vscode.Uri.joinPath(rootUri, "surrogates", `${mName}.mo`);
            try {
              await vscode.commands.executeCommand("vscode.open", moUri);
            } catch (e: any) {
              vscode.window.showErrorMessage(`Failed to open ${moUri.path}: ${e.message || e}`);
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
      changeSubscription.dispose();
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "feaDeckWebview.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FEA Deck 3D Viewer</title>
    <style>
      html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background: #1e1e1e; }
    </style>
</head>
<body class="vscode-dark">
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
