// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OLGA Transient Multiphase Flow Assurance Visual Custom Editor Provider.
 *
 * Provides a high-fidelity visual workspace for flow assurance and subsea production engineers:
 *   1. Interactive Bathymetry & Pipeline Elevation Profile Z(X) with holdup heatmaps and pig markers.
 *   2. Schematic P&ID Flowline View showing manifolds, flowpaths, valves, and separators.
 *   3. Real-time Transient Simulation scrubber with interactive playback, pressure and surge trends.
 *   4. Flow Assurance Limits Compliance verification (MAOP, Hydrate Margin, Slug Catcher Capacity).
 *   5. Thermal Cooldown & No-Touch Time calculator with Hammerschmidt MEG/Methanol inhibitor dosing.
 *   6. Automated export to SysML v2, CSV time series, and standalone SVG.
 */

import {
  renderOlgaBathymetry3dSvg,
  renderOlgaElevationProfileSvg,
  renderOlgaPvtEnvelopeSvg,
  renderOlgaSchematicSvg,
  renderOlgaSlugStatisticsSvg,
  renderOlgaWellboreIprSvg,
} from "@modelscript/diagram/olga-diagram-builder";
import {
  calculateHydrateDepression,
  calculateInhibitorDosing,
  calibrateOlgaModel,
  CubicEos,
  deserializeCheckpoint,
  eosToPvtTable,
  evaluateFlowAssuranceGate,
  evaluatePipelineCooldown,
  formatPvtTable,
  importBathymetrySurvey,
  lintOlgaModel,
  parseObservationCsv,
  parseOlga,
  parseOlgaPpl,
  parseOlgaTpl,
  parseOlgaTplDataset,
  profileDatasetToSnapshots,
  projectOlgaToSysml2,
  serializeCheckpoint,
  simulateDriftFlux,
  verifyFlowAssuranceTrajectory,
  type FlowAssuranceLimits,
  type OlgaCheckpointState,
  type OlgaModel,
  type OlgaProfileDataset,
  type OlgaSimulationResult,
  type OlgaTrendDataset,
  type TunableParameter,
} from "@modelscript/olga";
import * as path from "node:path";
import * as vscode from "vscode";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export class OlgaEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.olgaEditor";

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,

    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.configureWebview(webviewPanel);

    let disposed = false;
    webviewPanel.webview.html = this.getHtmlForWebview();

    let cachedModel: OlgaModel | null = null;
    let cachedSimResult: OlgaSimulationResult | null = null;

    const updateWebview = (
      customDuration?: number,
      whatIf?: { chokeOpening?: number; massRateFactor?: number; pumpTripped?: boolean },
    ) => {
      if (disposed) return;
      try {
        const text = document.getText();
        const docUriStr = document.uri.toString().toLowerCase();
        let mode: "model" | "tpl" | "ppl" = "model";
        if (docUriStr.endsWith(".tpl")) mode = "tpl";
        else if (docUriStr.endsWith(".ppl")) mode = "ppl";

        let model: OlgaModel;
        let simResult: OlgaSimulationResult;
        let trendDataset: OlgaTrendDataset | undefined;
        let profileDataset: OlgaProfileDataset | undefined;

        if (mode === "tpl") {
          trendDataset = parseOlgaTplDataset(text);
          simResult = parseOlgaTpl(text);
          model = {
            title: trendDataset.title || "OLGA Trend Trajectory (.tpl)",
            startTime: trendDataset.times[0] ?? 0,
            endTime: trendDataset.times[trendDataset.times.length - 1] ?? 100,
            minDt: 0.1,
            maxDt: 1.0,
            flowpaths: [],
            nodes: [],
          };
        } else if (mode === "ppl") {
          profileDataset = parseOlgaPpl(text);
          const snaps = profileDatasetToSnapshots(profileDataset);
          model = {
            title: profileDataset.title || "OLGA Spatial Profile (.ppl)",
            startTime: snaps[0]?.time ?? 0,
            endTime: snaps[snaps.length - 1]?.time ?? 100,
            minDt: 0.1,
            maxDt: 1.0,
            flowpaths: [
              {
                name: profileDataset.branch,
                pipes: [
                  {
                    label: "PIPE_SECTION",
                    length: snaps[0]?.x[snaps[0]?.x.length - 1] ?? 5000,
                    diameter: 0.254,
                    elevation: 0,
                    roughness: 1e-5,
                    discretization: 20,
                  },
                ],
                valves: [],
                sources: [],
                controllers: [],
              },
            ],
            nodes: [],
          };
          simResult = {
            times: snaps.map((s) => s.time),
            profiles: snaps,
            profileDataset,
            trends: {
              inletPressure: snaps.map((s) => s.pressure[0] ?? 50e5),
              arrivalPressure: snaps.map((s) => s.pressure[s.pressure.length - 1] ?? 20e5),
              arrivalTemperature: snaps.map((s) => s.temperature[s.temperature.length - 1] ?? 300),
              arrivalLiquidHoldup: snaps.map((s) => s.liquidHoldup[s.liquidHoldup.length - 1] ?? 0.1),
              arrivalLiquidMassRate: snaps.map(() => 5.0),
              accumulatedLiquidVolume: snaps.map(() => 0),
              peakLiquidSurgeVolume: 0,
            },
          };
        } else {
          model = parseOlga(text);
          const duration = customDuration ?? Math.min(model.endTime - model.startTime, 3600);
          simResult = simulateDriftFlux(model, {
            durationSeconds: duration,
            timeStepSeconds: model.maxDt,
          });
        }

        cachedModel = model;
        cachedSimResult = simResult;

        const diagnostics = lintOlgaModel(model);
        let olgaConfig: vscode.WorkspaceConfiguration | undefined;
        try {
          olgaConfig =
            typeof vscode.workspace?.getConfiguration === "function"
              ? vscode.workspace.getConfiguration("modelscript.olga")
              : undefined;
        } catch {
          olgaConfig = undefined;
        }
        const limits: FlowAssuranceLimits = {
          maop: olgaConfig?.get<number>("maopPa") ?? 250e5,
          hydrateMarginKelvin: olgaConfig?.get<number>("hydrateMarginKelvin") ?? 3.0,
          slugCatcherLiquidCapacity: olgaConfig?.get<number>("slugCatcherLiquidCapacityM3") ?? 150.0,
          minGasVelocity: olgaConfig?.get<number>("minGasVelocity") ?? 0.5,
        };
        const verification = verifyFlowAssuranceTrajectory(simResult, limits);

        // Core Visualizer SVGs
        const profileSvg = model.flowpaths.length > 0 ? renderOlgaElevationProfileSvg(model, simResult) : "";
        const bathySvg = model.flowpaths.length > 0 ? renderOlgaBathymetry3dSvg(model) : "";

        // Extract 3D seabed bathymetry trajectory points and data
        const flowpath = model.flowpaths[0];
        const pipes = flowpath?.pipes ?? [];
        const bathyPoints: {
          x: number;
          y: number;
          z: number;
          kp: number;
          name: string;
          diameter: number;
          holdup: number;
          pressureBar: number;
          tempC: number;
        }[] = [];

        let curX = 0;
        let curY = 0;
        let curZ = 0;
        let curKp = 0;
        const lastProf = simResult.profiles[simResult.profiles.length - 1];

        if (pipes.length > 0) {
          bathyPoints.push({
            x: curX,
            y: curY,
            z: curZ,
            kp: 0,
            name: `${pipes[0]?.label || "PIPE"}_INLET`,
            diameter: pipes[0]?.diameter ?? 0.3,
            holdup: lastProf?.liquidHoldup?.[0] ?? 0.35,
            pressureBar: (lastProf?.pressure?.[0] ?? 120e5) / 1e5,
            tempC: (lastProf?.temperature?.[0] ?? 335) - 273.15,
          });

          for (let i = 0; i < pipes.length; i++) {
            const p = pipes[i]!;
            curX += p.length * 0.96;
            curY += p.length * 0.28 * Math.sin((i / Math.max(1, pipes.length)) * Math.PI * 1.5);
            curZ += p.elevation;
            curKp += p.length;

            const profIdx = Math.min(i + 1, (lastProf?.x?.length ?? 1) - 1);
            bathyPoints.push({
              x: curX,
              y: curY,
              z: curZ,
              kp: curKp,
              name: p.label || `Pipe-${i + 1}`,
              diameter: p.diameter,
              holdup: lastProf?.liquidHoldup?.[profIdx] ?? 0.2 + 0.3 * Math.sin(i * 0.7),
              pressureBar: (lastProf?.pressure?.[profIdx] ?? Math.max(20e5, 120e5 - i * 8e5)) / 1e5,
              tempC: (lastProf?.temperature?.[profIdx] ?? 335 - i * 4) - 273.15,
            });
          }
        } else {
          bathyPoints.push(
            { x: 0, y: 0, z: -400, kp: 0, name: "WELLHEAD", diameter: 0.3, holdup: 0.35, pressureBar: 120, tempC: 65 },
            { x: 2000, y: 300, z: -450, kp: 2000, name: "P1", diameter: 0.3, holdup: 0.4, pressureBar: 105, tempC: 45 },
            { x: 4500, y: 600, z: -380, kp: 4500, name: "P2", diameter: 0.3, holdup: 0.48, pressureBar: 88, tempC: 25 },
            {
              x: 6000,
              y: 800,
              z: 20,
              kp: 6000,
              name: "RISER",
              diameter: 0.3,
              holdup: 0.65,
              pressureBar: 62,
              tempC: 18,
            },
          );
        }

        const bathy3dData = {
          points: bathyPoints,
          profilesCount: simResult.profiles.length,
          allProfiles: simResult.profiles.slice(0, 100).map((pr) => ({
            time: pr.time,
            liquidHoldup: pr.liquidHoldup,
            pressureBar: pr.pressure.map((v) => v / 1e5),
            temperatureC: pr.temperature.map((v) => v - 273.15),
          })),
        };

        const schematicSvg = model.flowpaths.length > 0 ? renderOlgaSchematicSvg(model) : "";
        const pvtSvg = model.flowpaths.length > 0 ? renderOlgaPvtEnvelopeSvg(undefined, simResult, model.title) : "";
        const wellNode =
          model.nodes.find((n) => (n.type as string) === "WELL" || n.type === "TERMINAL") ?? model.nodes[0];
        const wellboreSvg = wellNode
          ? renderOlgaWellboreIprSvg(
              (wellNode as { ipr?: Parameters<typeof renderOlgaWellboreIprSvg>[0] })?.ipr,
              wellNode.name || "SUBSEA WELL",
              wellNode.massRate ?? 35.0,
              (wellNode.pressure ?? 140e5) / 1e5,
            )
          : "";
        const slugSvg = renderOlgaSlugStatisticsSvg(simResult, limits.slugCatcherLiquidCapacity);

        // What-If perturbed transient simulation
        let whatIfSimulation:
          | {
              times: number[];
              inletPressureBar: number[];
              arrivalPressureBar: number[];
              arrivalTempC: number[];
              arrivalHoldup: number[];
              peakSurgeM3: number;
            }
          | undefined = undefined;
        if (whatIf) {
          try {
            const pModel: OlgaModel = JSON.parse(JSON.stringify(model));
            if (whatIf.chokeOpening !== undefined && pModel.flowpaths[0]?.valves[0]) {
              pModel.flowpaths[0].valves[0].opening = Number(whatIf.chokeOpening);
            }
            if (whatIf.massRateFactor !== undefined && pModel.nodes[0]?.massRate !== undefined) {
              pModel.nodes[0].massRate *= Number(whatIf.massRateFactor);
            }
            if (whatIf.pumpTripped && pModel.flowpaths[0]?.pumps?.[0]) {
              pModel.flowpaths[0].pumps[0].ratedHead = 0;
            }
            const pResult = simulateDriftFlux(pModel, {
              durationSeconds: (model.endTime ?? 100) - (model.startTime ?? 0),
              timeStepSeconds: model.maxDt,
            });
            whatIfSimulation = {
              times: pResult.times,
              inletPressureBar: pResult.trends.inletPressure.map((p) => p / 1e5),
              arrivalPressureBar: pResult.trends.arrivalPressure.map((p) => p / 1e5),
              arrivalTempC: pResult.trends.arrivalTemperature.map((t) => t - 273.15),
              arrivalHoldup: pResult.trends.arrivalLiquidHoldup,
              peakSurgeM3: pResult.trends.peakLiquidSurgeVolume,
            };
          } catch {
            whatIfSimulation = undefined;
          }
        }

        // Run cooldown assessment with configurable ambient temperature
        const ambientTempK = olgaConfig?.get<number>("ambientTemperatureKelvin") ?? 277.15;
        const cooldown = evaluatePipelineCooldown({
          innerDiameter: model.flowpaths[0]?.pipes[0]?.diameter ?? 0.254,
          pipeLength: model.flowpaths[0]?.pipes.reduce((acc, p) => acc + p.length, 0) ?? 1000.0,
          initialTemperatureK: model.nodes[0]?.temperature ?? 333.15,
          ambientTemperatureK: ambientTempK,
          shutInPressurePa: model.nodes[0]?.pressure ?? 100e5,
          liquidHoldup: 0.35,
          heatTransfer: model.flowpaths[0]?.heatTransfer,
        });

        // Run inhibitor assessment
        const megDepressionK = calculateHydrateDepression(30.0, "MEG");
        const inhibitorDosing = calculateInhibitorDosing(
          model.nodes[0]?.pressure ?? 100e5,
          ambientTempK,
          1500.0,
          "MEG",
        );

        const safetyGate = evaluateFlowAssuranceGate(model, {
          maxSurgeM3: limits.slugCatcherLiquidCapacity,
          minHydrateMarginK: limits.hydrateMarginKelvin,
          maxPressureBar: limits.maop / 1e5,
          minGasVelocity: limits.minGasVelocity,
          durationSeconds: customDuration ?? Math.min(model.endTime - model.startTime, 3600),
        });

        webviewPanel.webview.postMessage({
          type: "update",
          data: {
            mode,
            title: model.title,
            trendDataset,
            profileDataset,
            flowpathsCount: model.flowpaths.length,
            pipesCount: model.flowpaths.reduce((acc, f) => acc + f.pipes.length, 0),
            nodesCount: model.nodes.length,
            valvesCount: model.flowpaths.reduce((acc, f) => acc + f.valves.length, 0),
            pigsCount: model.flowpaths.reduce((acc, f) => acc + (f.pigs?.length ?? 0), 0),
            simulation: {
              times: simResult.times,
              inletPressureBar: simResult.trends.inletPressure.map((p) => p / 1e5),
              arrivalPressureBar: simResult.trends.arrivalPressure.map((p) => p / 1e5),
              arrivalTempC: simResult.trends.arrivalTemperature.map((t) => t - 273.15),
              arrivalHoldup: simResult.trends.arrivalLiquidHoldup,
              peakSurgeM3: simResult.trends.peakLiquidSurgeVolume,
              meanSlugLength: simResult.trends.meanSlugLength ?? [],
              profilesCount: simResult.profiles.length,
            },
            whatIfSimulation,
            verification,
            safetyGate,
            diagnostics,
            cooldown,
            inhibition: {
              megDepressionK,
              dosingRateKgH: inhibitorDosing.injectionMassRateKgPerHour,
              requiredWtPercent: inhibitorDosing.requiredInhibitorWeightPercent,
            },
            profileSvg,
            bathySvg,
            bathy3dData,
            schematicSvg,
            pvtSvg,
            wellboreSvg,
            slugSvg,
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        webviewPanel.webview.postMessage({
          type: "error",
          message,
        });
      }
    };

    updateWebview();

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    const msgSubscription = webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type || msg.command) {
        case "ready":
          updateWebview();
          break;

        case "runSimulation":
          updateWebview(msg.duration ? Number(msg.duration) : undefined);
          break;

        case "simulateWhatIf":
          updateWebview(undefined, msg.whatIf);
          break;

        case "saveCheckpoint": {
          if (!cachedModel || !cachedSimResult) return;
          try {
            const lastProfile = cachedSimResult.profiles[cachedSimResult.profiles.length - 1];
            const cpState: OlgaCheckpointState = {
              version: "1.0",
              timestamp: new Date().toISOString(),
              simulatedTime: cachedSimResult.times[cachedSimResult.times.length - 1] ?? 0,
              modelTitle: cachedModel.title,
              gridCells: (lastProfile?.x ?? []).map((x, i) => ({
                x,
                pressurePa: lastProfile?.pressure[i] ?? 1e5,
                temperatureK: lastProfile?.temperature[i] ?? 293.15,
                liquidHoldup: lastProfile?.liquidHoldup[i] ?? 0,
                gasHoldup: 1.0 - (lastProfile?.liquidHoldup[i] ?? 0),
                liquidVelocityMps: lastProfile?.liquidVelocity[i] ?? 0,
                gasVelocityMps: lastProfile?.gasVelocity[i] ?? 0,
              })),
              pigStates: lastProfile?.pigs?.map((p) => ({
                name: p.name,
                position: p.position,
                velocity: p.velocity,
                sweptVolume: p.sweptLiquidVolume,
                isStuck: p.isStuck,
              })),
            };
            const json = serializeCheckpoint(cpState);
            const defaultUri = vscode.Uri.joinPath(
              vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file("/"),
              `${cachedModel.title.replace(/\s+/g, "_")}_t${cpState.simulatedTime.toFixed(0)}s.rst`,
            );
            const saveUri = await vscode.window.showSaveDialog({
              defaultUri,
              filters: { "OLGA Checkpoint Snapshot": ["rst", "json"] },
            });
            if (saveUri) {
              await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(json));
              vscode.window.showInformationMessage(`Saved simulation state checkpoint to ${saveUri.path}`);
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to save checkpoint: ${message}`);
          }
          break;
        }

        case "loadCheckpoint": {
          try {
            const fileUris = await vscode.window.showOpenDialog({
              canSelectMany: false,
              filters: { "OLGA Checkpoint Snapshot": ["rst", "json"] },
            });
            if (fileUris && fileUris[0]) {
              const fileBytes = await vscode.workspace.fs.readFile(fileUris[0]);
              const initialCp = deserializeCheckpoint(fileBytes);
              vscode.window.showInformationMessage(
                `Resuming from checkpoint (t=${initialCp.simulatedTime.toFixed(1)}s, ${initialCp.gridCells.length} cells)`,
              );
              if (cachedModel) {
                const simResult = simulateDriftFlux(cachedModel, {
                  durationSeconds: Math.max((cachedModel.endTime ?? 100) - initialCp.simulatedTime, 10),
                  timeStepSeconds: cachedModel.maxDt,
                  initialCheckpoint: initialCp,
                });
                cachedSimResult = simResult;
                updateWebview();
              }
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to load checkpoint: ${message}`);
          }
          break;
        }

        case "runCalibration": {
          if (!cachedModel) return;
          try {
            const obsData = parseObservationCsv(msg.csvText);
            const tuningResult = calibrateOlgaModel(cachedModel, obsData, {
              parameters: msg.parameters as TunableParameter[] | undefined,
              maxEvaluations: msg.maxEvaluations ? Number(msg.maxEvaluations) : 80,
            });
            webviewPanel.webview.postMessage({
              type: "calibrationResult",
              data: tuningResult,
            });
            vscode.window.showInformationMessage(
              `History matching completed with ${tuningResult.evaluations} evaluations (R²: ${(tuningResult.metrics.pressureR2 * 100).toFixed(1)}%, Reduction: ${tuningResult.improvementPercent.toFixed(1)}%)`,
            );
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Calibration failed: ${message}`);
            webviewPanel.webview.postMessage({
              type: "calibrationError",
              message,
            });
          }
          break;
        }

        case "applyCalibrationToCode": {
          try {
            const text = document.getText();
            let newText = text;
            if (msg.shifts && Array.isArray(msg.shifts)) {
              for (const p of msg.shifts) {
                if (p.name === "roughness" && p.calibratedValue) {
                  newText = newText.replace(
                    /(<Pipe\b[^>]*\bRoughness=")[^"]*(")/i,
                    `$1${p.calibratedValue.toExponential(4)}$2`,
                  );
                } else if (p.name === "choke-cd" && p.calibratedValue) {
                  newText = newText.replace(/(<Valve\b[^>]*\bCd=")[^"]*(")/i, `$1${p.calibratedValue.toFixed(4)}$2`);
                }
              }
            }
            if (newText !== text) {
              const edit = new vscode.WorkspaceEdit();
              const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
              edit.replace(document.uri, fullRange, newText);
              await vscode.workspace.applyEdit(edit);
              vscode.window.showInformationMessage("Applied calibrated parameters to active OLGA model.");
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to apply calibrated parameters: ${message}`);
          }
          break;
        }

        case "applyWhatIfToCode": {
          try {
            const text = document.getText();
            let newText = text;
            if (msg.chokeOpening !== undefined) {
              newText = newText.replace(
                /(<Valve\b[^>]*\bOpening=")[^"]*(")/i,
                `$1${Number(msg.chokeOpening).toFixed(2)}$2`,
              );
            }
            if (newText !== text) {
              const edit = new vscode.WorkspaceEdit();
              const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
              edit.replace(document.uri, fullRange, newText);
              await vscode.workspace.applyEdit(edit);
              vscode.window.showInformationMessage(
                `Applied What-If scenario (Choke: ${(Number(msg.chokeOpening) * 100).toFixed(0)}%) to model.`,
              );
            }
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Failed to apply What-If to code: ${message}`);
          }
          break;
        }

        case "exportCsv": {
          if (!cachedSimResult) {
            vscode.window.showErrorMessage("No simulation results available to export.");
            return;
          }
          const lines = [
            "time_s,inlet_pressure_bar,arrival_pressure_bar,arrival_temperature_c,arrival_liquid_holdup,peak_surge_volume_m3",
          ];
          for (let i = 0; i < cachedSimResult.times.length; i++) {
            lines.push(
              [
                cachedSimResult.times[i]!.toFixed(2),
                ((cachedSimResult.trends.inletPressure[i] ?? 0) / 1e5).toFixed(3),
                ((cachedSimResult.trends.arrivalPressure[i] ?? 0) / 1e5).toFixed(3),
                ((cachedSimResult.trends.arrivalTemperature[i] ?? 273.15) - 273.15).toFixed(2),
                (cachedSimResult.trends.arrivalLiquidHoldup[i] ?? 0).toFixed(4),
                cachedSimResult.trends.peakLiquidSurgeVolume.toFixed(3),
              ].join(","),
            );
          }
          const csvContent = lines.join("\n");
          const defaultUri = vscode.Uri.joinPath(
            vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file("/"),
            `${cachedModel?.title.replace(/\\s+/g, "_") || "olga_simulation"}_trajectory.csv`,
          );
          const saveUri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { "CSV Table": ["csv"] },
          });
          if (saveUri) {
            await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(csvContent));
            vscode.window.showInformationMessage(`Simulation trajectory exported to ${saveUri.path}`);
          }
          break;
        }

        case "exportSvg": {
          if (!cachedModel || !cachedSimResult) return;
          let svgContent = renderOlgaElevationProfileSvg(cachedModel, cachedSimResult);
          if (msg.view === "schematic") {
            svgContent = renderOlgaSchematicSvg(cachedModel);
          } else if (msg.view === "pvt") {
            svgContent = renderOlgaPvtEnvelopeSvg(undefined, cachedSimResult, cachedModel.title);
          } else if (msg.view === "wellbore") {
            const wellNode =
              cachedModel.nodes.find((n) => (n.type as string) === "WELL" || n.type === "TERMINAL") ??
              cachedModel.nodes[0];
            svgContent = renderOlgaWellboreIprSvg(
              (wellNode as { ipr?: Parameters<typeof renderOlgaWellboreIprSvg>[0] } | undefined)?.ipr,
              wellNode?.name || "SUBSEA WELL",
              wellNode?.massRate ?? 35.0,
              (wellNode?.pressure ?? 140e5) / 1e5,
            );
          } else if (msg.view === "slug") {
            svgContent = renderOlgaSlugStatisticsSvg(cachedSimResult, 150.0);
          } else if (msg.view === "bathy") {
            svgContent = renderOlgaBathymetry3dSvg(cachedModel);
          }

          const defaultUri = vscode.Uri.joinPath(
            vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file("/"),
            `${cachedModel.title.replace(/\\s+/g, "_")}_${msg.view || "profile"}.svg`,
          );
          const saveUri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { "Vector Graphics": ["svg"] },
          });
          if (saveUri) {
            await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(svgContent));
            vscode.window.showInformationMessage(`SVG diagram exported to ${saveUri.path}`);
          }
          break;
        }

        case "importSurvey": {
          try {
            const surveyRes = importBathymetrySurvey(msg.surveyText, {
              defaultDiameter: msg.diameter ? Number(msg.diameter) : undefined,
              targetCellLength: msg.cellLength ? Number(msg.cellLength) : undefined,
            });
            webviewPanel.webview.postMessage({
              type: "surveyImportResult",
              snippet: surveyRes.opiXmlSnippet,
              summary: `Total length: ${(surveyRes.totalLengthM / 1000).toFixed(2)} km, Elevation: [${surveyRes.minElevationM}m, ${surveyRes.maxElevationM}m], Pipes: ${surveyRes.pipes.length} segments`,
            });
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Survey import failed: ${message}`);
          }
          break;
        }

        case "applySurveyPipes": {
          try {
            const text = document.getText();
            const fpMatch = /(<Flowpath\b[^>]*>)/i.exec(text);
            if (fpMatch && msg.snippet) {
              const insertPos = document.positionAt(fpMatch.index + fpMatch[0].length);
              const edit = new vscode.WorkspaceEdit();
              edit.insert(document.uri, insertPos, "\n" + msg.snippet);
              await vscode.workspace.applyEdit(edit);
              vscode.window.showInformationMessage("Discretized seabed bathymetry pipes inserted into Flowpath.");
            } else {
              vscode.window.showWarningMessage("Could not locate <Flowpath> tag to insert pipes.");
            }
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Failed to apply survey pipes: ${message}`);
          }
          break;
        }

        case "flashPTComposition": {
          try {
            const feedComp: Record<string, number> = msg.composition || {
              C1: 0.75,
              C2: 0.1,
              C3: 0.08,
              nC4: 0.04,
              C7: 0.03,
            };
            const pBar = Number(msg.pressureBar ?? 50.0);
            const tC = Number(msg.temperatureC ?? 25.0);
            const tKelvin = tC + 273.15;
            const modelType = msg.modelType === "SRK" ? "SRK" : "PENG_ROBINSON";
            const compNames = Object.keys(feedComp);
            const eos = new CubicEos(compNames, modelType);
            const flash = eos.flashPT(pBar * 1e5, tKelvin, feedComp);
            webviewPanel.webview.postMessage({
              type: "flashResult",
              data: {
                pressureBar: pBar,
                temperatureC: tC,
                modelType,
                vaporFraction: flash.vaporFraction,
                isTwoPhase: flash.isTwoPhase,
                gas: flash.gas,
                liquid: flash.liquid,
                surfaceTensionNPerM: flash.surfaceTensionNPerM,
                equilibriumKValues: flash.equilibriumKValues,
                componentKeys: eos.componentKeys,
              },
            });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Compositional flash failed: ${message}`);
            webviewPanel.webview.postMessage({ type: "flashError", message });
          }
          break;
        }

        case "tracePhaseEnvelope": {
          try {
            const feedComp: Record<string, number> = msg.composition || {
              C1: 0.75,
              C2: 0.1,
              C3: 0.08,
              nC4: 0.04,
              C7: 0.03,
            };
            const modelType = msg.modelType === "SRK" ? "SRK" : "PENG_ROBINSON";
            const compNames = Object.keys(feedComp);
            const eos = new CubicEos(compNames, modelType);
            const envelope = eos.generatePhaseEnvelope(feedComp, 220.0, 420.0, 20);
            webviewPanel.webview.postMessage({
              type: "phaseEnvelopeResult",
              data: envelope,
            });
            vscode.window.showInformationMessage(
              `Generated phase envelope: Cricondenbar ${(envelope.cricondenbar.pressurePa / 1e5).toFixed(1)} bar, Cricondentherm ${(envelope.cricondentherm.temperatureK - 273.15).toFixed(1)} °C`,
            );
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Phase envelope tracing failed: ${message}`);
            webviewPanel.webview.postMessage({ type: "phaseEnvelopeError", message });
          }
          break;
        }

        case "bindSynthesizedPvtTable": {
          try {
            const feedComp: Record<string, number> = msg.composition || {
              C1: 0.75,
              C2: 0.1,
              C3: 0.08,
              nC4: 0.04,
              C7: 0.03,
            };
            const modelType = msg.modelType === "SRK" ? "SRK" : "PENG_ROBINSON";
            const compNames = Object.keys(feedComp);
            const eos = new CubicEos(compNames, modelType);
            const pressuresGrid = [10e5, 25e5, 50e5, 75e5, 100e5, 150e5];
            const tempsGrid = [273.15, 293.15, 313.15, 333.15, 363.15];
            const pvtData = eosToPvtTable(eos, feedComp, pressuresGrid, tempsGrid);
            const tabText = formatPvtTable(pvtData);

            const docUri = document.uri;
            const tabUri = vscode.Uri.joinPath(
              vscode.Uri.file(path.dirname(docUri.fsPath)),
              `${path.basename(docUri.fsPath, path.extname(docUri.fsPath))}_fluid.tab`,
            );
            await vscode.workspace.fs.writeFile(tabUri, new TextEncoder().encode(tabText));
            vscode.window.showInformationMessage(`Synthesized 2D PVT Table saved to ${tabUri.path}`);
            webviewPanel.webview.postMessage({
              type: "pvtTableBound",
              filePath: tabUri.path,
            });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to synthesize PVT table: ${message}`);
          }
          break;
        }

        case "addComponent": {
          try {
            const text = document.getText();
            const componentType = (msg.componentType || "Pipe") as string;
            const attrs = msg.attributes || {};
            let xmlTag = "";

            switch (componentType.toLowerCase()) {
              case "pipe": {
                const name = attrs.name || `PIPE_${Date.now().toString().slice(-4)}`;
                const len = attrs.length ?? 1000.0;
                const diam = attrs.diameter ?? 0.3048;
                const elev = attrs.elevation ?? 0.0;
                const rough = attrs.roughness ?? 0.000045;
                const disc = attrs.discretization ?? 10;
                xmlTag = `    <Pipe Name="${name}" Length="${len}" Diameter="${diam}" Elevation="${elev}" Roughness="${rough}" Discretization="${disc}" />`;
                break;
              }
              case "valve": {
                const name = attrs.name || `VALVE_${Date.now().toString().slice(-4)}`;
                const pos = attrs.position ?? 500.0;
                const diam = attrs.diameter ?? 0.2;
                const open = attrs.opening ?? 1.0;
                const cd = attrs.cd ?? 0.84;
                xmlTag = `    <Valve Name="${name}" Position="${pos}" Diameter="${diam}" Opening="${open}" Cd="${cd}" />`;
                break;
              }
              case "pump": {
                const name = attrs.name || `PUMP_${Date.now().toString().slice(-4)}`;
                const pos = attrs.position ?? 200.0;
                const pumpType = attrs.type || "CENTRIFUGAL";
                const deltaP = attrs.deltaP ?? 1500000;
                xmlTag = `    <Pump Name="${name}" Position="${pos}" Type="${pumpType}" DeltaP="${deltaP}" />`;
                break;
              }
              case "source": {
                const name = attrs.name || `SRC_${Date.now().toString().slice(-4)}`;
                const pos = attrs.position ?? 100.0;
                const fluid = attrs.fluidType || "HYDROCARBON";
                const rate = attrs.massRate ?? 10.0;
                const temp = attrs.temperature ?? 330.15;
                xmlTag = `    <Source Name="${name}" Position="${pos}" FluidType="${fluid}" MassRate="${rate}" Temperature="${temp}" />`;
                break;
              }
              case "well":
              case "wellhead": {
                const name = attrs.name || `WELL_${Date.now().toString().slice(-4)}`;
                const fp = attrs.flowpath || "FLOWPATH_1";
                const p = attrs.pressure ?? 14000000;
                const t = attrs.temperature ?? 340.15;
                const rate = attrs.massRate ?? 35.0;
                xmlTag = `  <Node Name="${name}" Type="WELL" Flowpath="${fp}" Fraction="0.0" Pressure="${p}" Temperature="${t}" MassRate="${rate}" />`;
                break;
              }
              case "separator": {
                const name = attrs.name || `SEP_${Date.now().toString().slice(-4)}`;
                const fp = attrs.flowpath || "FLOWPATH_1";
                const p = attrs.pressure ?? 3000000;
                const t = attrs.temperature ?? 295.15;
                xmlTag = `  <Node Name="${name}" Type="SEPARATOR" Flowpath="${fp}" Fraction="1.0" Pressure="${p}" Temperature="${t}" />`;
                break;
              }
              default: {
                vscode.window.showWarningMessage(`Unsupported component type: ${componentType}`);
                return;
              }
            }

            const edit = new vscode.WorkspaceEdit();
            if (
              componentType.toLowerCase() === "well" ||
              componentType.toLowerCase() === "wellhead" ||
              componentType.toLowerCase() === "separator"
            ) {
              const modelEndMatch = /(<\/Model>)/i.exec(text);
              if (modelEndMatch) {
                const insertPos = document.positionAt(modelEndMatch.index);
                edit.insert(document.uri, insertPos, xmlTag + "\n");
                await vscode.workspace.applyEdit(edit);
                vscode.window.showInformationMessage(
                  `Synthesized <Node Name="${attrs.name || componentType}"> into OLGA model.`,
                );
              } else {
                vscode.window.showWarningMessage("Could not locate </Model> closing tag.");
              }
            } else {
              const fpEndMatch = /(<\/Flowpath>)/i.exec(text);
              if (fpEndMatch) {
                const insertPos = document.positionAt(fpEndMatch.index);
                edit.insert(document.uri, insertPos, xmlTag + "\n");
                await vscode.workspace.applyEdit(edit);
                vscode.window.showInformationMessage(`Synthesized <${componentType}> element into Flowpath.`);
              } else {
                const fpOpenMatch = /(<Flowpath\b[^>]*>)/i.exec(text);
                if (fpOpenMatch) {
                  const insertPos = document.positionAt(fpOpenMatch.index + fpOpenMatch[0].length);
                  edit.insert(document.uri, insertPos, "\n" + xmlTag);
                  await vscode.workspace.applyEdit(edit);
                  vscode.window.showInformationMessage(`Synthesized <${componentType}> element into Flowpath.`);
                } else {
                  vscode.window.showWarningMessage("Could not locate <Flowpath> tag to insert component.");
                }
              }
            }
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Failed to synthesize component: ${message}`);
          }
          break;
        }

        case "projectSysml2": {
          if (!cachedModel) return;
          try {
            const sysml = projectOlgaToSysml2(cachedModel);
            const doc = await vscode.workspace.openTextDocument({
              language: "sysml2",
              content: sysml,
            });
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage("OLGA model projected to SysML v2 Digital Thread package.");
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`SysML v2 projection failed: ${message}`);
          }
          break;
        }

        case "requestSnapshot": {
          if (!cachedModel || !cachedSimResult) return;
          const idx = Number(msg.snapshotIndex);
          const newSvg = renderOlgaElevationProfileSvg(cachedModel, cachedSimResult, idx);
          const p = cachedSimResult.profiles[idx];
          webviewPanel.webview.postMessage({
            type: "snapshotSvg",
            svg: newSvg,
            snapshotIndex: idx,
            profileSnapshot: p
              ? {
                  liquidHoldup: p.liquidHoldup,
                  pressureBar: p.pressure.map((v) => v / 1e5),
                  temperatureC: p.temperature.map((v) => v - 273.15),
                }
              : undefined,
          });
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      changeSubscription.dispose();
      msgSubscription.dispose();
    });
  }

  private getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' 'unsafe-eval' https:; connect-src https: http: ws: wss:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OLGA Multiphase Flow Assurance Editor</title>
  <style>
    :root {
      --bg-primary: var(--vscode-editor-background, #0b0f19);
      --bg-secondary: var(--vscode-sideBar-background, #111827);
      --bg-tertiary: var(--vscode-editorWidget-background, #1f2937);
      --text-main: var(--vscode-foreground, #f3f4f6);
      --text-dim: var(--vscode-descriptionForeground, #9ca3af);
      --accent: var(--vscode-focusBorder, #38bdf8);
      --border: var(--vscode-panel-border, #374151);
      --success: #10b981;
      --warning: #f59e0b;
      --error: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg-primary);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Header Bar */
    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 18px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .header-info { display: flex; align-items: baseline; gap: 14px; }
    .header-title { font-size: 16px; font-weight: 600; color: #fff; }
    .header-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-pass { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    .badge-fail { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }

    .header-actions { display: flex; gap: 8px; align-items: center; }

    button {
      background: var(--bg-tertiary);
      color: var(--text-main);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    button:hover { background: #2563eb; color: #fff; border-color: #3b82f6; }
    button.primary { background: #0284c7; color: #fff; border-color: #38bdf8; }
    button.primary:hover { background: #0369a1; }

    /* Segmented View Switcher */
    .segmented-control {
      display: flex;
      background: #0f172a;
      padding: 3px;
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .segmented-control button {
      background: transparent;
      border: none;
      border-radius: 4px;
      padding: 4px 12px;
      color: var(--text-dim);
    }
    .segmented-control button.active {
      background: #1e293b;
      color: #38bdf8;
      font-weight: 600;
    }

    /* Plots Toolbar */
    .plots-toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 18px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .plot-var-label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--text-main);
      cursor: pointer;
    }
    .plot-var-label input {
      accent-color: #38bdf8;
      cursor: pointer;
    }

    /* What-If Scratchpad Modal */
    .what-if-modal {
      position: absolute;
      top: 55px;
      right: 20px;
      width: 320px;
      background: #0f172a;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.7);
      padding: 14px;
      z-index: 100;
    }

    /* KPI Summary Row */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      padding: 10px 18px;
      background: rgba(15, 23, 42, 0.6);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .kpi-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
    }
    .kpi-label { font-size: 10px; color: var(--text-dim); text-transform: uppercase; font-weight: 600; }
    .kpi-val { font-size: 16px; font-weight: 700; color: #38bdf8; margin-top: 2px; }

    /* Main Container */
    .main-content {
      flex: 1;
      position: relative;
      overflow: auto;
      display: flex;
      flex-direction: column;
    }
    .tab-view { display: none; width: 100%; height: 100%; flex-direction: column; }
    .tab-view.active { display: flex; }

    /* Diagram Canvas */
    .svg-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      padding: 16px;
      background: #060911;
    }
    .svg-container svg { max-width: 100%; max-height: 100%; height: auto; }

    /* Timeline Scrubber */
    .timeline-bar {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 10px 18px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }
    .scrubber-slider {
      flex: 1;
      accent-color: #38bdf8;
      cursor: pointer;
    }
    .time-badge {
      font-family: ui-monospace, monospace;
      font-size: 12px;
      color: #38bdf8;
      font-weight: 600;
      min-width: 70px;
    }

    /* Verification & Diagnostics Tables */
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
      padding: 18px;
    }
    .status-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .card-title { font-size: 13px; font-weight: 600; color: #fff; }
    .metric-list { display: flex; flex-direction: column; gap: 8px; }
    .metric-item { display: flex; justify-content: space-between; font-size: 12px; border-bottom: 1px solid #1f2937; padding-bottom: 4px; }
    .metric-name { color: var(--text-dim); }
    .metric-value { font-weight: 600; font-family: ui-monospace, monospace; }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .data-table th, .data-table td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    .data-table th { background: #1e293b; color: var(--text-dim); font-weight: 600; }

    /* 3D Seabed Orbit Canvas */
    .active-bathy-btn {
      background: #0284c7 !important;
      color: #fff !important;
      border-color: #38bdf8 !important;
    }
    .bathy-toolbar-btn {
      background: #0f172a;
      color: #cbd5e1;
      border: 1px solid #334155;
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .bathy-toolbar-btn:hover {
      background: #1e293b;
      color: #fff;
      border-color: #64748b;
    }
  </style>
</head>
<body>

  <!-- Top Header -->
  <div class="header-bar">
    <div class="header-info">
      <span class="header-title" id="modelTitle">OLGA Simulation Model</span>
      <span class="header-badge badge-pass" id="complianceBadge">Compliant</span>
    </div>

    <!-- View Switcher -->
    <div class="segmented-control">
      <button class="active" onclick="switchTab('profileTab')">Bathymetry Z(X)</button>
      <button onclick="switchTab('bathyTab')">3D Seabed</button>
      <button onclick="switchTab('schematicTab')">Schematic P&ID</button>
      <button onclick="switchTab('plotsTab')">Plots & Trends</button>
      <button onclick="switchTab('pvtTab')">PVT Envelope</button>
      <button onclick="switchTab('wellboreTab')">Wellbore & IPR</button>
      <button onclick="switchTab('slugTab')">Slugging & Surge</button>
      <button onclick="switchTab('verificationTab')">Flow Assurance</button>
      <button onclick="switchTab('thermalTab')">Thermal & Dosing</button>
      <button onclick="switchTab('tuningTab')">Tuning & Match ✨</button>
      <button onclick="switchTab('diagnosticsTab')">Diagnostics</button>
    </div>

    <!-- Actions -->
    <div class="header-actions">
      <button onclick="saveCheckpointSnapshot()" title="Save simulation state checkpoint (.rst)">💾 Save Checkpoint</button>
      <button onclick="loadCheckpointSnapshot()" title="Resume simulation from .rst checkpoint">📂 Load Checkpoint</button>
      <button onclick="toggleWhatIfModal()" style="border-color: #f59e0b; color: #fbbf24;">⚡ What-If</button>
      <button onclick="exportActiveSvg()">Export SVG</button>
      <button onclick="exportTrajectoryCsv()">Export CSV</button>
      <button class="primary" onclick="projectSysml()">To SysML v2</button>
    </div>
  </div>

  <!-- What-If Floating Scratchpad Modal -->
  <div id="whatIfModal" class="what-if-modal" style="display:none;">
    <div class="card-header">
      <span class="card-title" style="color: #fbbf24;">⚡ What-If Scratchpad</span>
      <button onclick="toggleWhatIfModal()" style="padding: 2px 7px; font-size: 11px;">✕</button>
    </div>
    <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 10px;">
      <div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
          <span style="color: var(--text-dim);">Choke Valve Opening</span>
          <span style="font-weight: 600; color: #fbbf24;" id="lblWhatIfChoke">75%</span>
        </div>
        <input type="range" id="rngWhatIfChoke" min="0" max="100" value="75" oninput="updateWhatIfLabels()" style="width: 100%; accent-color: #f59e0b;">
      </div>
      <div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
          <span style="color: var(--text-dim);">Wellhead Rate Adjustment</span>
          <span style="font-weight: 600; color: #38bdf8;" id="lblWhatIfRate">0%</span>
        </div>
        <input type="range" id="rngWhatIfRate" min="-50" max="50" value="0" oninput="updateWhatIfLabels()" style="width: 100%; accent-color: #38bdf8;">
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <input type="checkbox" id="chkWhatIfPump" style="accent-color: #ef4444;">
        <span style="font-size: 11.5px; color: var(--text-main);">Trip Booster Pump (Head = 0)</span>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 6px;">
        <button class="primary" onclick="runWhatIfSimulation()" style="flex: 1; padding: 4px;">Simulate</button>
        <button onclick="applyWhatIfToCode()" style="border-color: #10b981; color: #34d399; padding: 4px;">Apply to Code</button>
      </div>
    </div>
  </div>

  <!-- KPI Row -->
  <div class="kpi-row">
    <div class="kpi-card">
      <div class="kpi-label">Arrival P</div>
      <div class="kpi-val" id="kpiArrivalP">—</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Arrival T</div>
      <div class="kpi-val" id="kpiArrivalT">—</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Liquid Holdup</div>
      <div class="kpi-val" id="kpiHoldup">—</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Peak Liquid Surge</div>
      <div class="kpi-val" id="kpiSurge">—</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">No-Touch Cooldown</div>
      <div class="kpi-val" id="kpiCooldown">—</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">MEG Dosing</div>
      <div class="kpi-val" id="kpiDosing">—</div>
    </div>
  </div>

  <!-- Main Content Views -->
  <div class="main-content">
    
    <!-- Tab 1: Elevation Profile -->
    <div id="profileTab" class="tab-view active">
      <div class="svg-container" id="profileSvgContainer">Loading Profile...</div>
      <div class="timeline-bar">
        <button id="playBtn" onclick="togglePlayback()">▶ Play</button>
        <span class="time-badge" id="timeDisplay">t = 0.0 s</span>
        <input type="range" class="scrubber-slider" id="scrubber" min="0" max="0" value="0" oninput="onScrub(this.value)">
      </div>
    </div>

    <!-- Tab 2: 3D Seabed Bathymetry & Orbit Canvas -->
    <div id="bathyTab" class="tab-view">
      <div style="display: flex; flex-direction: column; width: 100%; height: 100%; position: relative;">
        <!-- Viewport Toolbar -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 14px; gap: 8px; border-bottom: 1px solid #1e293b; background: #070b12; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <span style="font-weight: 700; color: #38bdf8; font-size: 11px; letter-spacing: 0.05em;">3D SEABED ORBIT CANVAS</span>
            <div style="display: flex; gap: 4px;">
              <button id="bathyModeOrbitBtn" onclick="setBathyCameraMode('orbit')" class="bathy-toolbar-btn active-bathy-btn">🎥 Orbit</button>
              <button id="bathyModeRovBtn" onclick="setBathyCameraMode('rov')" class="bathy-toolbar-btn">🚢 ROV Fly-Through</button>
            </div>
            <label style="font-size: 11px; color: #94a3b8; display: flex; align-items: center; gap: 4px;">
              Colormap:
              <select id="bathyColormapSelect" onchange="onBathyColormapChange(this.value)" style="background: #0f172a; color: #f8fafc; border: 1px solid #334155; font-size: 11px; padding: 2px 6px; border-radius: 4px; cursor: pointer;">
                <option value="holdup">Liquid Holdup (HL)</option>
                <option value="pressure">Pressure (PT)</option>
                <option value="temperature">Temperature (TM)</option>
              </select>
            </label>
            <button onclick="resetBathyCamera()" class="bathy-toolbar-btn">↺ Reset Camera</button>
            <button id="bathyRovSpeedBtn" onclick="toggleRovSpeed()" class="bathy-toolbar-btn" style="display: none;">Speed: 1x</button>
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button onclick="toggleBathyRenderer()" id="bathyRendererToggle" class="bathy-toolbar-btn" style="color: #94a3b8;">Show 2D SVG</button>
            <button onclick="toggleSurveyDrawer()" style="background:#0284c7; color:#fff; border-color:#38bdf8; font-size: 11px; border-radius:4px; padding:3px 8px; cursor:pointer;">📥 Import Survey XYZ / CSV</button>
          </div>
        </div>

        <!-- 3D Canvas Viewport -->
        <div id="bathy3dContainer" style="flex: 1; width: 100%; height: 100%; position: relative; overflow: hidden; background: #050811;">
          <canvas id="bathy3dCanvas" style="width: 100%; height: 100%; display: block; cursor: grab;"></canvas>

          <!-- Telemetry HUD Overlay -->
          <div id="bathyHudOverlay" style="position: absolute; left: 16px; top: 16px; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(8px); border: 1px solid #334155; border-radius: 6px; padding: 10px 14px; font-size: 11px; color: #cbd5e1; pointer-events: none; max-width: 320px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-weight: bold; color: #38bdf8;">Offshore Subsea Telemetry</span>
              <span id="bathyModeIndicator" style="color: #10b981; font-weight: 600; font-size: 10px;">[ORBIT]</span>
            </div>
            <div id="bathyHudInfo" style="font-size: 10px; line-height: 1.4; color: #94a3b8;">Rotate: Left Click + Drag | Pan: Right Click + Drag | Zoom: Wheel</div>
            <div id="bathyCameraPos" style="font-family: monospace; font-size: 10px; color: #64748b; margin-top: 4px;">Az: 35° | El: 25° | Dist: 100%</div>
          </div>

          <!-- Color Legend Bar -->
          <div id="bathyColorLegend" style="position: absolute; right: 16px; bottom: 20px; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(8px); border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; font-size: 10px; color: #cbd5e1; pointer-events: none; width: 150px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);">
            <div id="bathyLegendTitle" style="font-weight: 600; color: #38bdf8; margin-bottom: 4px; text-align: center;">Liquid Holdup (HL)</div>
            <div id="bathyLegendGradient" style="height: 10px; border-radius: 3px; background: linear-gradient(to right, #0284c7, #10b981, #f59e0b, #ef4444); margin-bottom: 3px;"></div>
            <div style="display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8; font-family: monospace;">
              <span id="bathyLegendMin">0.00</span>
              <span id="bathyLegendMid">0.50</span>
              <span id="bathyLegendMax">1.00</span>
            </div>
          </div>

          <!-- Raycast Hover Card -->
          <div id="bathyHoverCard" style="display: none; position: absolute; background: #0f172a; border: 1px solid #38bdf8; border-radius: 6px; padding: 8px 12px; font-size: 11px; color: #f8fafc; pointer-events: none; box-shadow: 0 8px 24px rgba(0,0,0,0.8); z-index: 50;">
            <div id="hoverPipeName" style="font-weight: bold; color: #38bdf8;">Pipe-01</div>
            <div id="hoverDetails" style="color: #94a3b8; font-size: 10px;">KP: 1.2 km | TVD: -420 m</div>
            <div id="hoverMetrics" style="margin-top: 4px; font-family: monospace; font-size: 11px;">HL: 0.42 | P: 85.0 bar | T: 38.5 °C</div>
          </div>
        </div>

        <!-- 2D SVG Container (Fallback or Alternate view) -->
        <div class="svg-container" id="bathySvgContainer" style="display: none; flex: 1;">Loading 3D Seabed Bathymetry...</div>

        <!-- Survey Ingestion Modal Drawer -->
        <div id="surveyDrawer" style="display:none; position:absolute; right:20px; top:45px; width:450px; background:#0f172a; border:1px solid #38bdf8; border-radius:8px; padding:16px; box-shadow:0 12px 32px rgba(0,0,0,0.7); z-index:100;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-weight:bold; color:#38bdf8; font-size:12px;">📥 Ingest Offshore Seabed Survey</span>
            <button onclick="toggleSurveyDrawer()" style="padding:2px 7px; font-size:11px;">✕</button>
          </div>
          <div style="font-size:11px; color:#94a3b8; margin-bottom:8px;">
            Paste survey coordinates (Easting, Northing, Depth) or (KP, Elevation). Automatically discretizes pipeline into curvature-adaptive &lt;Pipe&gt; elements.
          </div>
          <textarea id="surveyInput" rows="5" style="width:100%; box-sizing:border-box; background:#070b12; border:1px solid #334155; color:#f8fafc; font-family:monospace; font-size:11px; padding:8px; border-radius:4px;" placeholder="Easting,Northing,Depth&#10;0,0,-450&#10;1500,200,-480&#10;3000,500,-420&#10;4500,750,20"></textarea>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
            <button onclick="submitSurvey()" class="primary" style="font-size:11px;">Discretize Route</button>
            <button id="applySurveyBtn" onclick="applySurveyToCode()" style="display:none; background:#10b981; color:#fff; border-color:#34d399; font-size:11px;">Insert &lt;Pipe&gt; Elements</button>
          </div>
          <div id="surveySummary" style="font-size:11px; color:#38bdf8; margin-top:8px;"></div>
        </div>
      </div>
    </div>

    <!-- Tab 2: Schematic Flowline -->
    <div id="schematicTab" class="tab-view">
      <div class="schematic-palette-toolbar" style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:rgba(30,41,59,0.85); border-bottom:1px solid #334155; flex-wrap:wrap;">
        <span style="font-weight:700; color:#38bdf8; font-size:11px; letter-spacing:0.05em;">COMPONENT PALETTE:</span>
        <button onclick="promptAddComponent('Pipe')" style="background:#0284c7; color:#fff; border:1px solid #38bdf8; border-radius:4px; padding:3px 8px; font-size:11px; cursor:pointer;">+ Pipe</button>
        <button onclick="promptAddComponent('Valve')" style="background:#0d9488; color:#fff; border:1px solid #2dd4bf; border-radius:4px; padding:3px 8px; font-size:11px; cursor:pointer;">+ Valve</button>
        <button onclick="promptAddComponent('Pump')" style="background:#7c3aed; color:#fff; border:1px solid #a78bfa; border-radius:4px; padding:3px 8px; font-size:11px; cursor:pointer;">+ Pump</button>
        <button onclick="promptAddComponent('Source')" style="background:#d97706; color:#fff; border:1px solid #fbbf24; border-radius:4px; padding:3px 8px; font-size:11px; cursor:pointer;">+ Source</button>
        <button onclick="promptAddComponent('Well')" style="background:#059669; color:#fff; border:1px solid #34d399; border-radius:4px; padding:3px 8px; font-size:11px; cursor:pointer;">+ Wellhead</button>
        <button onclick="promptAddComponent('Separator')" style="background:#e11d48; color:#fff; border:1px solid #fb7185; border-radius:4px; padding:3px 8px; font-size:11px; cursor:pointer;">+ Separator</button>
      </div>
      <div class="svg-container" id="schematicSvgContainer">Loading Schematic...</div>
    </div>

    <!-- Tab 3: Interactive Multi-Variable Plotting & Trends -->
    <div id="plotsTab" class="tab-view">
      <div class="plots-toolbar">
        <span style="font-weight: 600; color: #94a3b8; font-size: 11px;">VARIABLES:</span>
        <div id="plotsVariablesContainer" style="display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px;">
          <label class="plot-var-label"><input type="checkbox" id="chkInletP" checked onchange="renderTrendsPlot()"> Inlet P</label>
          <label class="plot-var-label"><input type="checkbox" id="chkArrivalP" checked onchange="renderTrendsPlot()"> Arrival P</label>
          <label class="plot-var-label"><input type="checkbox" id="chkArrivalT" checked onchange="renderTrendsPlot()"> Arrival T</label>
          <label class="plot-var-label"><input type="checkbox" id="chkHoldup" onchange="renderTrendsPlot()"> Holdup α_L</label>
          <label class="plot-var-label"><input type="checkbox" id="chkSurge" onchange="renderTrendsPlot()"> Surge Vol</label>
        </div>
        <div style="flex: 1;"></div>
        <button onclick="applyPlotPreset('pressure')">Pressure Waves</button>
        <button onclick="applyPlotPreset('hydrate')">Hydrate Margin</button>
        <button onclick="applyPlotPreset('surge')">Surge Dynamics</button>
      </div>
      <div class="svg-container" id="plotsSvgContainer">Loading Plots...</div>
    </div>

    <!-- Tab 4: PVT Phase Envelope & In-WASM Compositional Flash Studio -->
    <div id="pvtTab" class="tab-view">
      <div style="padding: 16px; display: flex; flex-direction: column; gap: 14px; max-width: 1100px; margin: 0 auto; width: 100%; box-sizing: border-box;">
        <div class="card" id="compositionalFlashPanel" style="padding: 14px;">
          <div class="card-header" style="margin-bottom: 8px;">
            <span class="card-title">In-WASM Compositional Flash & Phase Envelope Studio</span>
            <span class="header-badge badge-pass" id="pvtEosBadge">PR78 / SRK Ready</span>
          </div>
          <p style="font-size: 11.5px; color: var(--text-dim); margin-bottom: 12px;">
            Evaluate rigorous vapor-liquid equilibrium (VLE) flash, predict dense fluid transport properties (LBC viscosity, Parachor surface tension), and trace retrograde condensation envelopes directly in WebAssembly linear memory.
          </p>

          <div style="display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 220px;">
              <label style="font-size: 11px; font-weight: 600; color: var(--text-main); display: block; margin-bottom: 4px;">Fluid Composition Preset</label>
              <select id="pvtPresetSelect" onchange="applyPvtPreset(this.value)" style="width: 100%; padding: 6px; background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 4px; font-size: 11.5px;">
                <option value="condensate">Rich Gas Condensate (70% C1, 10% C2, 8% C3, 5% nC4, 7% C7+)</option>
                <option value="lean_gas">Lean Gas (90% C1, 5% C2, 2% C3, 2% N2, 1% CO2)</option>
                <option value="volatile_oil">Volatile Light Oil (50% C1, 8% C2, 7% C3, 5% nC4, 30% C7+)</option>
                <option value="black_oil">Deepwater Black Oil (35% C1, 5% C2, 5% C3, 5% nC4, 50% C7+)</option>
              </select>
            </div>
            <div style="flex: 1; min-width: 180px;">
              <label style="font-size: 11px; font-weight: 600; color: var(--text-main); display: block; margin-bottom: 4px;">Equation of State (EOS)</label>
              <select id="pvtEosModel" style="width: 100%; padding: 6px; background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 4px; font-size: 11.5px;">
                <option value="PENG_ROBINSON">Peng-Robinson (PR78)</option>
                <option value="SRK">Soave-Redlich-Kwong (SRK)</option>
              </select>
            </div>
            <div style="display: flex; gap: 8px; align-items: flex-end;">
              <div>
                <label style="font-size: 11px; font-weight: 600; color: var(--text-main); display: block; margin-bottom: 4px;">Pressure [bar]</label>
                <input id="flashPressureInput" type="number" step="1" value="50.0" style="width: 80px; padding: 5px; background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 4px; font-size: 11.5px;" />
              </div>
              <div>
                <label style="font-size: 11px; font-weight: 600; color: var(--text-main); display: block; margin-bottom: 4px;">Temp [°C]</label>
                <input id="flashTempInput" type="number" step="1" value="25.0" style="width: 80px; padding: 5px; background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 4px; font-size: 11.5px;" />
              </div>
            </div>
          </div>

          <div style="margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label style="font-size: 11px; font-weight: 600; color: var(--text-main);">Component Feed Fractions (Mole %)</label>
              <button onclick="normalizePvtComposition()" style="font-size: 10.5px; padding: 2px 8px;">Normalize to 100%</button>
            </div>
            <div id="pvtCompGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(75px, 1fr)); gap: 6px;"></div>
          </div>

          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button id="btnRunFlash" onclick="runCompositionalFlash()" style="padding: 6px 14px; font-weight: 600; background: #0284c7; color: white;">⚡ Flash P-T</button>
            <button id="btnTraceEnvelope" onclick="runTraceEnvelope()" style="padding: 6px 14px; font-weight: 600;">📈 Trace Phase Envelope</button>
            <button id="btnBindPvt" onclick="runBindSynthesizedPvtTable()" style="padding: 6px 14px;">💾 Bind Synthesized Table</button>
          </div>
        </div>

        <!-- Flash Results Container -->
        <div class="card" id="flashResultCard" style="padding: 14px; display: none;">
          <div class="card-header" style="margin-bottom: 8px;">
            <span class="card-title">Thermodynamic Equilibrium State</span>
            <span class="header-badge badge-pass" id="flashPhaseBadge">Two-Phase</span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-bottom: 12px;" id="flashMetricsGrid"></div>
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
              <thead>
                <tr style="border-bottom: 1px solid var(--border-color); text-align: left; color: var(--text-dim);">
                  <th style="padding: 4px;">Component</th>
                  <th style="padding: 4px;">Feed z_i</th>
                  <th style="padding: 4px;">Liquid x_i</th>
                  <th style="padding: 4px;">Vapor y_i</th>
                  <th style="padding: 4px;">K-Value</th>
                </tr>
              </thead>
              <tbody id="flashDistributionBody"></tbody>
            </table>
          </div>
        </div>

        <!-- SVG Visualizer -->
        <div class="svg-container" id="pvtSvgContainer" style="min-height: 480px; width: 100%;">Loading PVT Envelope...</div>
      </div>
    </div>

    <!-- Tab 5: Wellbore Completion & IPR -->
    <div id="wellboreTab" class="tab-view">
      <div class="svg-container" id="wellboreSvgContainer">Loading Wellbore IPR...</div>
    </div>

    <!-- Tab 6: Slugging & Surge Capacity -->
    <div id="slugTab" class="tab-view">
      <div class="svg-container" id="slugSvgContainer">Loading Slugging...</div>
    </div>

    <!-- Tab 7: Flow Assurance Limits Verification -->
    <div id="verificationTab" class="tab-view">
      <div id="safetyGateCard" class="card" style="padding: 12px 16px; margin: 12px 18px 0 18px; display: flex; align-items: center; justify-content: space-between; border-left: 4px solid #10b981;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-weight: 700; font-size: 13px;" id="gateVerdictTitle">FLOW ASSURANCE SAFETY GATE: APPROVED</span>
          <span class="header-badge badge-pass" id="gateVerdictBadge">PASSED</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button onclick="downloadSafetyGateReport()" style="padding: 3px 8px; font-size: 11px;">Export Gate Report (MD)</button>
        </div>
      </div>
      <div class="card-grid" id="verificationCards"></div>
    </div>

    <!-- Tab 8: Thermal & Dosing -->
    <div id="thermalTab" class="tab-view">
      <div class="card-grid" id="thermalCards"></div>
    </div>

    <!-- Tab 9: Autonomous History Matching & Calibration -->
    <div id="tuningTab" class="tab-view">
      <div style="padding: 16px; display: flex; flex-direction: column; gap: 16px; overflow: auto; max-width: 1000px; margin: 0 auto;">
        <div class="card" style="padding: 14px;">
          <div class="card-header" style="margin-bottom: 8px;">
            <span class="card-title">Autonomous Field Telemetry History Matcher</span>
            <span class="header-badge badge-pass" id="tuningStatusBadge">Ready</span>
          </div>
          <p style="font-size: 11.5px; color: var(--text-dim); margin-bottom: 12px;">
            Calibrate pipeline hydraulic roughness, choke discharge coefficients, and thermal parameters to match measured SCADA or separator test observations using bounded Nelder-Mead Simplex optimization.
          </p>
          <div style="margin-bottom: 10px;">
            <label style="font-size: 11px; font-weight: 600; color: var(--text-main); display: block; margin-bottom: 4px;">Field Observation Telemetry (CSV)</label>
            <textarea id="telemetryInput" rows="5" placeholder="TIME,PT_INLET,PT_ARRIVAL,TM_ARRIVAL,QLT&#10;0.0,12000000,3200000,290.15,25.0&#10;10.0,12100000,3250000,289.85,25.2" style="width: 100%; font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; background: #0b0f19; color: #e2e8f0; border: 1px solid var(--border-color); border-radius: 4px; padding: 8px;"></textarea>
          </div>
          <div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: center; margin-bottom: 12px;">
            <span style="font-size: 11px; font-weight: 600; color: var(--text-main);">Parameters to Tune:</span>
            <label style="font-size: 11px; display: flex; align-items: center; gap: 4px;"><input type="checkbox" id="tuneRoughness" checked> Pipe Roughness (ε)</label>
            <label style="font-size: 11px; display: flex; align-items: center; gap: 4px;"><input type="checkbox" id="tuneChokeCd" checked> Choke Valve Cd</label>
            <label style="font-size: 11px; display: flex; align-items: center; gap: 4px;"><input type="checkbox" id="tuneHeatTransfer" checked> Heat Transfer (U)</label>
            <label style="font-size: 11px; display: flex; align-items: center; gap: 4px;"><input type="checkbox" id="tuneWellRate"> Well Productivity PI</label>
            <span style="font-size: 11px; color: var(--text-dim); margin-left: auto;">Max Evals: <input type="number" id="tuneMaxEvals" value="80" min="10" max="300" style="width: 50px; background: #0f172a; border: 1px solid var(--border-color); color: #fff; border-radius: 3px; padding: 2px 4px;"></span>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="primary" onclick="runSimplexCalibration()" id="btnRunCalibration">⚡ Run Simplex Calibration</button>
            <button onclick="applyCalibrationToCode()" id="btnApplyCalibration" style="display: none; border-color: #10b981; color: #34d399;">✔ Apply Calibrated Parameters to Model</button>
          </div>
        </div>

        <!-- Calibration Results Card -->
        <div id="calibrationResultsCard" class="card" style="padding: 14px; display: none;">
          <div class="card-header" style="margin-bottom: 10px;">
            <span class="card-title">Calibration Optimization Metrics</span>
            <span id="tuningMetricsBadge" class="header-badge badge-pass">—</span>
          </div>
          <div class="kpi-row" style="margin-bottom: 14px;">
            <div class="kpi-card"><div class="kpi-label">Improvement</div><div class="kpi-val" id="tuneImprovement">—</div></div>
            <div class="kpi-card"><div class="kpi-label">Evaluations</div><div class="kpi-val" id="tuneEvaluations">—</div></div>
            <div class="kpi-card"><div class="kpi-label">Pressure R²</div><div class="kpi-val" id="tunePressureR2">—</div></div>
            <div class="kpi-card"><div class="kpi-label">Pressure RMSE</div><div class="kpi-val" id="tunePressureRmse">—</div></div>
            <div class="kpi-card"><div class="kpi-label">Temperature RMSE</div><div class="kpi-val" id="tuneTempRmse">—</div></div>
          </div>
          <table class="data-table" style="margin-bottom: 12px;">
            <thead>
              <tr><th>Parameter</th><th>Initial Value</th><th>Calibrated Value</th><th>Unit</th><th>Shift %</th></tr>
            </thead>
            <tbody id="calibrationShiftsBody"></tbody>
          </table>
          <pre id="tuningReportText" style="font-size: 11px; background: #080d1a; color: #94a3b8; border: 1px solid var(--border-color); border-radius: 4px; padding: 10px; max-height: 200px; overflow: auto; white-space: pre-wrap;"></pre>
        </div>
      </div>
    </div>

    <!-- Tab 10: Pre-Flight Diagnostics -->
    <div id="diagnosticsTab" class="tab-view">
      <div style="padding: 18px; overflow: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Severity</th>
              <th>Message</th>
              <th>Recommendation</th>
            </tr>
          </thead>
          <tbody id="diagnosticsBody"></tbody>
        </table>
      </div>
    </div>

  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentData = null;
    let isPlaying = false;
    let playInterval = null;
    let activeTabId = 'profileTab';

    const tabNames = [
      'profileTab',
      'bathyTab',
      'schematicTab',
      'plotsTab',
      'pvtTab',
      'wellboreTab',
      'slugTab',
      'verificationTab',
      'thermalTab',
      'tuningTab',
      'diagnosticsTab',
    ];

    function switchTab(tabId) {
      activeTabId = tabId;
      document.querySelectorAll('.tab-view').forEach(t => t.classList.remove('active'));
      const activeEl = document.getElementById(tabId);
      if (activeEl) activeEl.classList.add('active');

      document.querySelectorAll('.segmented-control button').forEach((b, idx) => {
        b.classList.toggle('active', tabNames[idx] === tabId);
      });

      if (tabId === 'plotsTab') {
        renderTrendsPlot();
      }
      if (tabId === 'bathyTab') {
        resizeBathyCanvas();
        requestBathyRender();
      }
    }

    const PVT_PRESETS = {
      condensate: { C1: 0.70, C2: 0.10, C3: 0.08, nC4: 0.05, C7: 0.07 },
      lean_gas: { C1: 0.90, C2: 0.05, C3: 0.02, N2: 0.02, CO2: 0.01 },
      volatile_oil: { C1: 0.50, C2: 0.08, C3: 0.07, nC4: 0.05, C7: 0.30 },
      black_oil: { C1: 0.35, C2: 0.05, C3: 0.05, nC4: 0.05, C7: 0.50 },
    };

    const ALL_COMP_KEYS = ['N2', 'CO2', 'H2S', 'C1', 'C2', 'C3', 'iC4', 'nC4', 'iC5', 'nC5', 'C6', 'C7'];

    function initPvtCompGrid() {
      const container = document.getElementById('pvtCompGrid');
      if (!container || container.children.length > 0) return;
      container.innerHTML = ALL_COMP_KEYS.map(k =>
        '<div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 4px; padding: 4px; text-align: center;">' +
          '<div style="font-size: 10px; color: var(--text-dim); font-weight: 600;">' + k + '</div>' +
          '<input type="number" step="0.5" min="0" max="100" id="comp_' + k + '" value="0.0" style="width: 100%; border: none; background: transparent; text-align: center; color: var(--text-main); font-size: 11px; font-weight: 600;" />' +
        '</div>'
      ).join('');
      applyPvtPreset('condensate');
    }

    function applyPvtPreset(presetName) {
      const preset = PVT_PRESETS[presetName] || PVT_PRESETS.condensate;
      for (const k of ALL_COMP_KEYS) {
        const input = document.getElementById('comp_' + k);
        if (input) {
          const val = (preset[k] || 0) * 100;
          input.value = val.toFixed(1);
        }
      }
    }

    function getFeedComposition() {
      const comp = {};
      for (const k of ALL_COMP_KEYS) {
        const input = document.getElementById('comp_' + k);
        const val = input ? parseFloat(input.value) : 0;
        if (val > 0) comp[k] = val / 100.0;
      }
      return comp;
    }

    function normalizePvtComposition() {
      let sum = 0;
      for (const k of ALL_COMP_KEYS) {
        const input = document.getElementById('comp_' + k);
        sum += input ? parseFloat(input.value) || 0 : 0;
      }
      if (sum > 0) {
        for (const k of ALL_COMP_KEYS) {
          const input = document.getElementById('comp_' + k);
          if (input) {
            const v = ((parseFloat(input.value) || 0) / sum) * 100;
            input.value = v.toFixed(1);
          }
        }
      }
    }

    function runCompositionalFlash() {
      const comp = getFeedComposition();
      const pBar = parseFloat(document.getElementById('flashPressureInput')?.value || '50.0');
      const tC = parseFloat(document.getElementById('flashTempInput')?.value || '25.0');
      const modelType = document.getElementById('pvtEosModel')?.value || 'PENG_ROBINSON';
      vscode.postMessage({
        type: 'flashPTComposition',
        composition: comp,
        pressureBar: pBar,
        temperatureC: tC,
        modelType: modelType,
      });
    }

    function runTraceEnvelope() {
      const comp = getFeedComposition();
      const modelType = document.getElementById('pvtEosModel')?.value || 'PENG_ROBINSON';
      vscode.postMessage({
        type: 'tracePhaseEnvelope',
        composition: comp,
        modelType: modelType,
      });
    }

    function runBindSynthesizedPvtTable() {
      const comp = getFeedComposition();
      const modelType = document.getElementById('pvtEosModel')?.value || 'PENG_ROBINSON';
      vscode.postMessage({
        type: 'bindSynthesizedPvtTable',
        composition: comp,
        modelType: modelType,
      });
    }

    function renderInteractivePhaseEnvelopeSvg(env, curPBar, curTKelvin) {
      const W = 840, H = 480;
      const padL = 70, padR = 40, padT = 60, padB = 60;
      const pW = W - padL - padR;
      const pH = H - padT - padB;

      const allPts = [
        ...env.bubblePoints.map(p => ({ T: p.temperatureK - 273.15, P: p.pressurePa / 1e5 })),
        ...env.dewPoints.map(p => ({ T: p.temperatureK - 273.15, P: p.pressurePa / 1e5 })),
      ];
      if (env.cricondenbar) allPts.push({ T: env.cricondenbar.temperatureK - 273.15, P: env.cricondenbar.pressurePa / 1e5 });
      if (env.cricondentherm) allPts.push({ T: env.cricondentherm.temperatureK - 273.15, P: env.cricondentherm.pressurePa / 1e5 });
      allPts.push({ T: curTKelvin - 273.15, P: curPBar });

      const minT = Math.floor(Math.min(...allPts.map(p => p.T)) - 10);
      const maxT = Math.ceil(Math.max(...allPts.map(p => p.T)) + 15);
      const minP = 0;
      const maxP = Math.ceil(Math.max(...allPts.map(p => p.P)) * 1.15);

      const mapX = (T) => padL + ((T - minT) / (maxT - minT || 1)) * pW;
      const mapY = (P) => padT + pH - ((P - minP) / (maxP - minP || 1)) * pH;

      const makePath = (pts) => {
        if (!pts || pts.length === 0) return '';
        const sorted = [...pts].sort((a, b) => a.temperatureK - b.temperatureK);
        return sorted.map((pt, i) => (i === 0 ? 'M ' : 'L ') + mapX(pt.temperatureK - 273.15).toFixed(1) + ' ' + mapY(pt.pressurePa / 1e5).toFixed(1)).join(' ');
      };

      const bubblePath = makePath(env.bubblePoints);
      const dewPath = makePath(env.dewPoints);

      const cBarX = mapX(env.cricondenbar.temperatureK - 273.15);
      const cBarY = mapY(env.cricondenbar.pressurePa / 1e5);
      const cThermX = mapX(env.cricondentherm.temperatureK - 273.15);
      const cThermY = mapY(env.cricondentherm.pressurePa / 1e5);

      const opX = mapX(curTKelvin - 273.15);
      const opY = mapY(curPBar);

      let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width: 100%; height: 100%; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;">' +
        '<rect width="' + W + '" height="' + H + '" fill="#0f172a" rx="6" />' +
        '<text x="' + (W / 2) + '" y="32" text-anchor="middle" fill="#f8fafc" font-size="14" font-weight="700">IN-WASM CUBIC EQUATION OF STATE PHASE ENVELOPE</text>';

      [0, 0.25, 0.5, 0.75, 1.0].forEach(f => {
        const y = padT + pH * f;
        const pVal = maxP - f * (maxP - minP);
        svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (padL + pW) + '" y2="' + y + '" stroke="#1e293b" stroke-width="1" />' +
               '<text x="' + (padL - 10) + '" y="' + (y + 4) + '" fill="#94a3b8" font-size="10" text-anchor="end">' + pVal.toFixed(0) + ' bar</text>';
      });

      [0, 0.25, 0.5, 0.75, 1.0].forEach(f => {
        const x = padL + pW * f;
        const tVal = minT + f * (maxT - minT);
        svg += '<line x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (padT + pH) + '" stroke="#1e293b" stroke-width="1" />' +
               '<text x="' + x + '" y="' + (padT + pH + 20) + '" fill="#94a3b8" font-size="10" text-anchor="middle">' + tVal.toFixed(0) + ' °C</text>';
      });

      if (bubblePath) {
        svg += '<path d="' + bubblePath + '" stroke="#10b981" stroke-width="3" fill="none" />';
      }
      if (dewPath) {
        svg += '<path d="' + dewPath + '" stroke="#06b6d4" stroke-width="3" fill="none" />';
      }

      svg += '<circle cx="' + cBarX + '" cy="' + cBarY + '" r="5" fill="#f59e0b" stroke="#fff" stroke-width="1.5" />' +
             '<text x="' + (cBarX + 8) + '" y="' + (cBarY - 6) + '" fill="#f59e0b" font-size="10.5" font-weight="600">Cricondenbar: ' + (env.cricondenbar.pressurePa / 1e5).toFixed(1) + ' bar</text>' +
             '<circle cx="' + cThermX + '" cy="' + cThermY + '" r="5" fill="#ec4899" stroke="#fff" stroke-width="1.5" />' +
             '<text x="' + (cThermX + 8) + '" y="' + (cThermY + 14) + '" fill="#ec4899" font-size="10.5" font-weight="600">Cricondentherm: ' + (env.cricondentherm.temperatureK - 273.15).toFixed(1) + ' °C</text>' +
             '<line x1="' + (opX - 12) + '" y1="' + opY + '" x2="' + (opX + 12) + '" y2="' + opY + '" stroke="#ef4444" stroke-width="2" />' +
             '<line x1="' + opX + '" y1="' + (opY - 12) + '" x2="' + opX + '" y2="' + (opY + 12) + '" stroke="#ef4444" stroke-width="2" />' +
             '<circle cx="' + opX + '" cy="' + opY + '" r="6" fill="none" stroke="#ef4444" stroke-width="2" />' +
             '<text x="' + (opX + 10) + '" y="' + (opY - 10) + '" fill="#ef4444" font-size="11" font-weight="700">Operating Point (' + curPBar.toFixed(1) + ' bar, ' + (curTKelvin - 273.15).toFixed(1) + ' °C)</text>' +
             '<g transform="translate(' + (padL + 15) + ', ' + (padT + 15) + ')">' +
               '<rect width="210" height="95" fill="#1e293b" opacity="0.9" rx="4" />' +
               '<line x1="12" y1="18" x2="35" y2="18" stroke="#10b981" stroke-width="3" />' +
               '<text x="42" y="22" fill="#f8fafc" font-size="10.5">Bubble Point Curve (Liquid)</text>' +
               '<line x1="12" y1="38" x2="35" y2="38" stroke="#06b6d4" stroke-width="3" />' +
               '<text x="42" y="42" fill="#f8fafc" font-size="10.5">Dew Point Curve (Vapor)</text>' +
               '<circle cx="23" cy="58" r="4" fill="#f59e0b" />' +
               '<text x="42" y="62" fill="#f8fafc" font-size="10.5">Cricondenbar</text>' +
               '<circle cx="23" cy="78" r="4" fill="#ec4899" />' +
               '<text x="42" y="82" fill="#f8fafc" font-size="10.5">Cricondentherm</text>' +
             '</g>' +
           '</svg>';
      return svg;
    }

    let lastSurveySnippet = '';
    let lastCalibrationShifts = [];

    function saveCheckpointSnapshot() {
      vscode.postMessage({ type: 'saveCheckpoint' });
    }

    function loadCheckpointSnapshot() {
      vscode.postMessage({ type: 'loadCheckpoint' });
    }

    function runSimplexCalibration() {
      const csvEl = document.getElementById('telemetryInput');
      const csvText = csvEl ? csvEl.value.trim() : '';
      if (!csvText) {
        const statusBadge = document.getElementById('tuningStatusBadge');
        if (statusBadge) {
          statusBadge.textContent = 'Enter CSV Telemetry First';
          statusBadge.className = 'header-badge badge-warn';
        }
        return;
      }
      const params = [];
      if (document.getElementById('tuneRoughness')?.checked) params.push('roughness');
      if (document.getElementById('tuneChokeCd')?.checked) params.push('choke-cd');
      if (document.getElementById('tuneHeatTransfer')?.checked) params.push('heat-transfer');
      if (document.getElementById('tuneWellRate')?.checked) params.push('well-rate');
      const maxEvals = parseInt(document.getElementById('tuneMaxEvals')?.value || '80', 10);

      const statusBadge = document.getElementById('tuningStatusBadge');
      if (statusBadge) {
        statusBadge.textContent = 'Optimizing...';
        statusBadge.className = 'header-badge badge-warn';
      }

      vscode.postMessage({
        type: 'runCalibration',
        csvText,
        parameters: params,
        maxEvaluations: maxEvals,
      });
    }

    function applyCalibrationToCode() {
      if (!lastCalibrationShifts || lastCalibrationShifts.length === 0) return;
      vscode.postMessage({
        type: 'applyCalibrationToCode',
        shifts: lastCalibrationShifts,
      });
    }

    function downloadSafetyGateReport() {
      if (!currentData?.safetyGate?.markdownReport) return;
      const blob = new Blob([currentData.safetyGate.markdownReport], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = ((currentData.title || 'olga').replace(/\\s+/g, '_')) + '_safety_gate.md';
      a.click();
    }

    function toggleSurveyDrawer() {
      const drawer = document.getElementById('surveyDrawer');
      drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
    }

    function submitSurvey() {
      const surveyText = document.getElementById('surveyInput').value;
      if (!surveyText.trim()) return;
      vscode.postMessage({
        type: 'importSurvey',
        surveyText,
      });
    }

    function applySurveyToCode() {
      if (!lastSurveySnippet) return;
      vscode.postMessage({
        type: 'applySurveyPipes',
        snippet: lastSurveySnippet,
      });
      toggleSurveyDrawer();
    }

    function safePromptValue(label, fallback) {
      try {
        if (typeof prompt === 'function') {
          const val = prompt(label, fallback);
          if (val !== null && val !== undefined && String(val).trim() !== '') {
            return String(val).trim();
          }
        }
      } catch {
        // Sandboxed VS Code webviews block window.prompt()
      }
      return fallback;
    }

    function promptAddComponent(type) {
      let attrs = {};
      if (type === 'Pipe') {
        const len = safePromptValue("Pipe Section Length [m]:", "1000");
        const diam = safePromptValue("Internal Diameter [m]:", "0.254");
        attrs = { length: parseFloat(len), diameter: parseFloat(diam) };
      } else if (type === 'Valve') {
        const pos = safePromptValue("Valve Location along Flowpath [m]:", "500");
        const open = safePromptValue("Initial Valve Opening [0.0 - 1.0]:", "1.0");
        attrs = { position: parseFloat(pos), opening: parseFloat(open) };
      } else if (type === 'Pump') {
        const pos = safePromptValue("Pump Location along Flowpath [m]:", "250");
        const dp = safePromptValue("Pump Differential Pressure Delta-P [bar]:", "15");
        attrs = { position: parseFloat(pos), deltaP: parseFloat(dp) * 1e5 };
      } else if (type === 'Source') {
        const pos = safePromptValue("Source Injection Location [m]:", "100");
        const rate = safePromptValue("Mass Flow Rate [kg/s]:", "10.0");
        attrs = { position: parseFloat(pos), massRate: parseFloat(rate) };
      } else if (type === 'Well') {
        const name = safePromptValue("Wellhead Identifier:", "WELL_PROD_02");
        const p = safePromptValue("Wellhead Flowing Pressure [bar]:", "140");
        attrs = { name, pressure: parseFloat(p) * 1e5 };
      } else if (type === 'Separator') {
        const name = safePromptValue("Topside Separator Identifier:", "SEP_HP_02");
        const p = safePromptValue("Operating Pressure [bar]:", "30");
        attrs = { name, pressure: parseFloat(p) * 1e5 };
      }

      vscode.postMessage({
        type: 'addComponent',
        componentType: type,
        attributes: attrs,
      });
    }

    function toggleWhatIfModal() {
      const modal = document.getElementById('whatIfModal');
      modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
    }

    function updateWhatIfLabels() {
      const choke = document.getElementById('rngWhatIfChoke').value;
      const rate = document.getElementById('rngWhatIfRate').value;
      document.getElementById('lblWhatIfChoke').textContent = choke + '%';
      document.getElementById('lblWhatIfRate').textContent = (rate >= 0 ? '+' : '') + rate + '%';
    }

    function runWhatIfSimulation() {
      const chokeOpening = parseFloat(document.getElementById('rngWhatIfChoke').value) / 100.0;
      const rateDelta = parseFloat(document.getElementById('rngWhatIfRate').value) / 100.0;
      const pumpTripped = document.getElementById('chkWhatIfPump').checked;

      vscode.postMessage({
        type: 'simulateWhatIf',
        whatIf: {
          chokeOpening,
          massRateFactor: 1.0 + rateDelta,
          pumpTripped,
        },
      });
    }

    function applyWhatIfToCode() {
      const chokeOpening = parseFloat(document.getElementById('rngWhatIfChoke').value) / 100.0;
      vscode.postMessage({
        type: 'applyWhatIfToCode',
        chokeOpening,
      });
      toggleWhatIfModal();
    }

    function exportActiveSvg() {
      let view = 'profile';
      if (activeTabId === 'bathyTab') view = 'bathy';
      else if (activeTabId === 'schematicTab') view = 'schematic';
      else if (activeTabId === 'pvtTab') view = 'pvt';
      else if (activeTabId === 'wellboreTab') view = 'wellbore';
      else if (activeTabId === 'slugTab') view = 'slug';

      vscode.postMessage({
        type: 'exportSvg',
        view,
      });
    }

    function exportTrajectoryCsv() {
      vscode.postMessage({ type: 'exportCsv' });
    }

    function projectSysml() {
      vscode.postMessage({ type: 'projectSysml2' });
    }

    function togglePlayback() {
      isPlaying = !isPlaying;
      document.getElementById('playBtn').textContent = isPlaying ? '⏸ Pause' : '▶ Play';
      if (isPlaying) {
        playInterval = setInterval(() => {
          const slider = document.getElementById('scrubber');
          let val = parseInt(slider.value, 10) + 1;
          if (val > parseInt(slider.max, 10)) val = 0;
          slider.value = val;
          onScrub(val);
        }, 120);
      } else {
        clearInterval(playInterval);
      }
    }

    function onScrub(val) {
      if (!currentData || !currentData.simulation) return;
      const idx = parseInt(val, 10);
      const timeSec = currentData.simulation.times[idx] || 0;
      document.getElementById('timeDisplay').textContent = 't = ' + timeSec.toFixed(1) + ' s';
      
      // Update dynamic KPIs
      if (currentData.simulation.arrivalPressureBar[idx] !== undefined) {
        document.getElementById('kpiArrivalP').textContent = currentData.simulation.arrivalPressureBar[idx].toFixed(1) + ' bar';
      }
      if (currentData.simulation.arrivalTempC[idx] !== undefined) {
        document.getElementById('kpiArrivalT').textContent = currentData.simulation.arrivalTempC[idx].toFixed(1) + ' °C';
      }
      if (currentData.simulation.arrivalHoldup[idx] !== undefined) {
        document.getElementById('kpiHoldup').textContent = (currentData.simulation.arrivalHoldup[idx] * 100).toFixed(1) + ' %';
      }

      if (activeTabId === 'plotsTab') {
        renderTrendsPlot();
      }
      if (activeTabId === 'bathyTab') {
        updateBathyFrame(idx);
      }

      // Request new SVG frame snapshot
      vscode.postMessage({
        type: 'requestSnapshot',
        snapshotIndex: idx,
      });
    }

    function applyPlotPreset(preset) {
      if (preset === 'pressure') {
        document.getElementById('chkInletP').checked = true;
        document.getElementById('chkArrivalP').checked = true;
        document.getElementById('chkArrivalT').checked = false;
        document.getElementById('chkHoldup').checked = false;
        document.getElementById('chkSurge').checked = false;
      } else if (preset === 'hydrate') {
        document.getElementById('chkInletP').checked = false;
        document.getElementById('chkArrivalP').checked = true;
        document.getElementById('chkArrivalT').checked = true;
        document.getElementById('chkHoldup').checked = true;
        document.getElementById('chkSurge').checked = false;
      } else if (preset === 'surge') {
        document.getElementById('chkInletP').checked = false;
        document.getElementById('chkArrivalP').checked = true;
        document.getElementById('chkArrivalT').checked = false;
        document.getElementById('chkHoldup').checked = true;
        document.getElementById('chkSurge').checked = true;
      }
      renderTrendsPlot();
    }

    function renderTplDatasetPlot(container, dataset) {
      const colors = ['#38bdf8', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f43f5e', '#a855f7', '#14b8a6', '#eab308'];
      const activeVars = [];
      dataset.variables.forEach((v, idx) => {
        const chk = document.getElementById('chkTplVar_' + idx);
        if (!chk || chk.checked) {
          activeVars.push({ var: v, idx, color: colors[idx % colors.length] });
        }
      });

      if (activeVars.length === 0) {
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;">No trend variables selected. Check variables above to display curves.</div>';
        return;
      }

      const w = 860;
      const h = 420;
      const padL = 65;
      const padT = 40;
      const padB = 45;

      const times = dataset.times;
      const maxT = times.length > 0 ? (times[times.length - 1] || 1) : 1;
      const minT = times.length > 0 ? (times[0] || 0) : 0;
      const spanT = (maxT - minT) || 1;

      // Group active variables into Left vs Right axes
      const hasPressure = activeVars.some(av => /PA|BAR|PSI/i.test(av.var.unit));
      const hasNonPressure = activeVars.some(av => !/PA|BAR|PSI/i.test(av.var.unit));
      const useDualAxis = hasPressure && hasNonPressure;

      const leftVars = [];
      const rightVars = [];
      for (const av of activeVars) {
        if (useDualAxis) {
          if (/PA|BAR|PSI/i.test(av.var.unit)) {
            leftVars.push(av);
          } else {
            rightVars.push(av);
          }
        } else {
          leftVars.push(av);
        }
      }

      const padR = rightVars.length > 0 ? 65 : 25;
      const pW = w - padL - padR;
      const pH = h - padT - padB;

      const getBounds = (varsList) => {
        let minVal = Infinity;
        let maxVal = -Infinity;
        for (const av of varsList) {
          for (const val of av.var.values) {
            if (val < minVal) minVal = val;
            if (val > maxVal) maxVal = val;
          }
        }
        if (!isFinite(minVal)) minVal = 0;
        if (!isFinite(maxVal)) maxVal = 1;
        if (minVal === maxVal) {
          minVal -= 1;
          maxVal += 1;
        } else {
          const margin = (maxVal - minVal) * 0.08;
          minVal -= margin;
          maxVal += margin;
        }
        return { minVal, maxVal };
      };

      const leftBounds = getBounds(leftVars.length > 0 ? leftVars : activeVars);
      const rightBounds = rightVars.length > 0 ? getBounds(rightVars) : null;

      const mapX = (t) => padL + ((t - minT) / spanT) * pW;
      const mapYLeft = (v) => padT + ((leftBounds.maxVal - v) / (leftBounds.maxVal - leftBounds.minVal)) * pH;
      const mapYRight = (v) => rightBounds ? padT + ((rightBounds.maxVal - v) / (rightBounds.maxVal - rightBounds.minVal)) * pH : 0;

      let svg = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \${w} \${h}" width="100%" height="100%" style="background:#090d16;">
        <style>
          .ax-lbl { font-family: Inter, sans-serif; fill: #64748b; font-size: 10px; }
          .title { font-family: Inter, sans-serif; fill: #f8fafc; font-size: 13px; font-weight: 600; }
          .grid { stroke: #1e293b; stroke-dasharray: 4,4; stroke-width: 1; }
        </style>
        <text x="\${padL}" y="24" class="title">\${currentData.title || 'OLGA Trend Dataset (.tpl)'} — Dynamic Multi-Axis Waveforms</text>
      \`;

      // X Grid
      for (let i = 0; i <= 6; i++) {
        const tVal = minT + (i / 6) * spanT;
        const x = mapX(tVal);
        svg += \`<line x1="\${x}" y1="\${padT}" x2="\${x}" y2="\${padT + pH}" class="grid" />
          <text x="\${x}" y="\${padT + pH + 16}" text-anchor="middle" class="ax-lbl">\${tVal.toFixed(1)} s</text>\`;
      }

      // Left Y Grid & Ticks
      for (let i = 0; i <= 4; i++) {
        const val = leftBounds.minVal + (i / 4) * (leftBounds.maxVal - leftBounds.minVal);
        const y = mapYLeft(val);
        svg += \`<line x1="\${padL}" y1="\${y}" x2="\${padL + pW}" y2="\${y}" class="grid" />
          <text x="\${padL - 8}" y="\${y + 4}" text-anchor="end" class="ax-lbl" fill="#38bdf8">\${val >= 1000 ? val.toExponential(2) : val.toFixed(2)}</text>\`;
      }

      // Right Y Ticks if present
      if (rightBounds && rightVars.length > 0) {
        for (let i = 0; i <= 4; i++) {
          const val = rightBounds.minVal + (i / 4) * (rightBounds.maxVal - rightBounds.minVal);
          const y = mapYRight(val);
          svg += \`<text x="\${padL + pW + 8}" y="\${y + 4}" text-anchor="start" class="ax-lbl" fill="#f59e0b">\${val >= 1000 ? val.toExponential(2) : val.toFixed(2)}</text>\`;
        }
      }

      // Curves
      for (const av of activeVars) {
        const isRight = rightVars.includes(av);
        const mapper = isRight ? mapYRight : mapYLeft;
        const pts = [];
        for (let i = 0; i < times.length; i++) {
          const t = times[i];
          const val = av.var.values[i] ?? 0;
          pts.push((i === 0 ? 'M ' : 'L ') + mapX(t).toFixed(1) + ' ' + mapper(val).toFixed(1));
        }
        svg += \`<path d="\${pts.join(' ')}" stroke="\${av.color}" stroke-width="2" fill="none" opacity="0.9" />\`;
      }

      svg += \`</svg>\`;
      container.innerHTML = svg;
    }

    function renderTrendsPlot() {
      if (!currentData) return;
      const container = document.getElementById('plotsSvgContainer');
      if (!container) return;

      if (currentData.trendDataset && currentData.trendDataset.variables && currentData.trendDataset.variables.length > 0) {
        renderTplDatasetPlot(container, currentData.trendDataset);
        return;
      }

      if (!currentData.simulation) return;
      const sim = currentData.simulation;
      const whatIf = currentData.whatIfSimulation;

      const w = 860;
      const h = 420;
      const padL = 60;
      const padR = 60;
      const padT = 40;
      const padB = 45;
      const pW = w - padL - padR;
      const pH = h - padT - padB;

      const times = sim.times;
      const maxT = times[times.length - 1] || 1800;

      // Collect active curves
      const showInletP = document.getElementById('chkInletP')?.checked ?? true;
      const showArrivalP = document.getElementById('chkArrivalP')?.checked ?? true;
      const showArrivalT = document.getElementById('chkArrivalT')?.checked ?? true;
      const showHoldup = document.getElementById('chkHoldup')?.checked ?? false;
      const showSurge = document.getElementById('chkSurge')?.checked ?? false;

      // Left axis: Pressure (0 - 220 bar)
      const mapX = (t) => padL + (t / maxT) * pW;
      const mapP = (p) => padT + ((220 - p) / 220) * pH;
      // Right axis: Secondary (0 - 100 for T, Holdup %, Surge m3)
      const mapS = (val) => padT + ((100 - val) / 100) * pH;

      let svg = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \${w} \${h}" width="100%" height="100%" style="background:#090d16;">
        <style>
          .ax-lbl { font-family: Inter, sans-serif; fill: #64748b; font-size: 10px; }
          .title { font-family: Inter, sans-serif; fill: #f8fafc; font-size: 13px; font-weight: 600; }
          .grid { stroke: #1e293b; stroke-dasharray: 4,4; stroke-width: 1; }
        </style>
        <text x="\${padL}" y="24" class="title">\${currentData.title} — Transient Dynamic Waveforms & Perturbation Overlays</text>
      \`;

      // X Grid
      for (let i = 0; i <= 6; i++) {
        const tVal = (i / 6) * maxT;
        const x = mapX(tVal);
        svg += \`<line x1="\${x}" y1="\${padT}" x2="\${x}" y2="\${padT + pH}" class="grid" />
          <text x="\${x}" y="\${padT + pH + 16}" text-anchor="middle" class="ax-lbl">\${tVal.toFixed(0)} s</text>\`;
      }

      // Left Y Grid (Pressure)
      for (let i = 0; i <= 4; i++) {
        const pVal = (i / 4) * 220;
        const y = mapP(pVal);
        svg += \`<line x1="\${padL}" y1="\${y}" x2="\${padL + pW}" y2="\${y}" class="grid" />
          <text x="\${padL - 10}" y="\${y + 4}" text-anchor="end" class="ax-lbl" fill="#38bdf8">\${pVal.toFixed(0)} bar</text>\`;
      }

      // Right Y Axis (Secondary)
      for (let i = 0; i <= 4; i++) {
        const sVal = (i / 4) * 100;
        const y = mapS(sVal);
        svg += \`<text x="\${padL + pW + 10}" y="\${y + 4}" text-anchor="start" class="ax-lbl" fill="#f59e0b">\${sVal.toFixed(0)}</text>\`;
      }

      // Draw helper path generator
      const makePath = (dataArr, mapper) => {
        if (!dataArr || dataArr.length === 0) return '';
        return times.map((t, idx) => \`\${idx === 0 ? 'M' : 'L'} \${mapX(t)} \${mapper(dataArr[idx] ?? 0)}\`).join(' ');
      };

      // Baseline Curves
      if (showInletP) {
        svg += \`<path d="\${makePath(sim.inletPressureBar, mapP)}" stroke="#06b6d4" stroke-width="2.5" fill="none" />\`;
      }
      if (showArrivalP) {
        svg += \`<path d="\${makePath(sim.arrivalPressureBar, mapP)}" stroke="#3b82f6" stroke-width="2.5" fill="none" />\`;
      }
      if (showArrivalT) {
        svg += \`<path d="\${makePath(sim.arrivalTempC, mapS)}" stroke="#f59e0b" stroke-width="2" fill="none" />\`;
      }
      if (showHoldup) {
        const holdupPct = sim.arrivalHoldup.map(h => h * 100);
        svg += \`<path d="\${makePath(holdupPct, mapS)}" stroke="#10b981" stroke-width="2" fill="none" />\`;
      }
      if (showSurge) {
        const surgeCurve = times.map(t => sim.peakSurgeM3 * (t / maxT));
        svg += \`<path d="\${makePath(surgeCurve, mapS)}" stroke="#ef4444" stroke-width="2" fill="none" />\`;
      }

      // Ghost Perturbation Curves if present
      if (whatIf) {
        if (showInletP && whatIf.inletPressureBar) {
          svg += \`<path d="\${makePath(whatIf.inletPressureBar, mapP)}" stroke="#06b6d4" stroke-dasharray="4,3" stroke-width="2" fill="none" />\`;
        }
        if (showArrivalP && whatIf.arrivalPressureBar) {
          svg += \`<path d="\${makePath(whatIf.arrivalPressureBar, mapP)}" stroke="#3b82f6" stroke-dasharray="4,3" stroke-width="2" fill="none" />\`;
        }
        if (showArrivalT && whatIf.arrivalTempC) {
          svg += \`<path d="\${makePath(whatIf.arrivalTempC, mapS)}" stroke="#f59e0b" stroke-dasharray="4,3" stroke-width="1.8" fill="none" />\`;
        }
      }

      // Scrubber Cursor Line
      const scrubber = document.getElementById('scrubber');
      const curIdx = parseInt(scrubber?.value || 0, 10);
      const curTime = times[curIdx] || 0;
      const curX = mapX(curTime);
      svg += \`<line x1="\${curX}" y1="\${padT}" x2="\${curX}" y2="\${padT + pH}" stroke="#fff" stroke-width="1.5" stroke-dasharray="2,2" />\`;

      svg += \`</svg>\`;
      container.innerHTML = svg;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'snapshotSvg') {
        document.getElementById('profileSvgContainer').innerHTML = msg.svg;
        if (msg.profileSnapshot) {
          updateBathyFromProfileSnapshot(msg.profileSnapshot);
        }
        return;
      }

      if (msg.type === 'surveyImportResult') {
        lastSurveySnippet = msg.snippet;
        const summaryEl = document.getElementById('surveySummary');
        if (summaryEl) summaryEl.textContent = '✔ ' + msg.summary;
        const applyBtn = document.getElementById('applySurveyBtn');
        if (applyBtn) applyBtn.style.display = 'inline-block';
        return;
      }

      if (msg.type === 'flashResult') {
        const res = msg.data;
        const resCard = document.getElementById('flashResultCard');
        if (resCard) resCard.style.display = 'block';

        const phaseBadge = document.getElementById('flashPhaseBadge');
        if (phaseBadge) {
          const isTwo = res.isTwoPhase;
          phaseBadge.textContent = isTwo ? 'Two-Phase (Vapor + Liquid)' : (res.vaporFraction > 0.5 ? 'Single-Phase Gas' : 'Single-Phase Liquid');
          phaseBadge.className = 'header-badge ' + (isTwo ? 'badge-pass' : 'badge-warn');
        }

        const metricsGrid = document.getElementById('flashMetricsGrid');
        if (metricsGrid) {
          metricsGrid.innerHTML = [
            { label: 'Vapor Fraction β', val: (res.vaporFraction * 100).toFixed(1) + ' %' },
            { label: 'Gas Density', val: res.gas.densityKgM3.toFixed(2) + ' kg/m³' },
            { label: 'Liquid Density', val: res.liquid.densityKgM3.toFixed(2) + ' kg/m³' },
            { label: 'Gas Viscosity', val: (res.gas.viscosityPaS * 1000).toFixed(4) + ' cP' },
            { label: 'Liquid Viscosity', val: (res.liquid.viscosityPaS * 1000).toFixed(4) + ' cP' },
            { label: 'Surface Tension', val: (res.surfaceTensionNPerM * 1000).toFixed(2) + ' mN/m' },
            { label: 'Gas Sound Speed', val: res.gas.soundSpeedMS.toFixed(1) + ' m/s' },
            { label: 'Liquid Sound Speed', val: res.liquid.soundSpeedMS.toFixed(1) + ' m/s' },
          ].map(m =>
            '<div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 4px; padding: 8px;">' +
              '<div style="font-size: 10.5px; color: var(--text-dim); margin-bottom: 2px;">' + m.label + '</div>' +
              '<div style="font-size: 13px; font-weight: 700; color: #38bdf8;">' + m.val + '</div>' +
            '</div>'
          ).join('');
        }

        const distBody = document.getElementById('flashDistributionBody');
        if (distBody) {
          const compKeys = res.componentKeys || [];
          distBody.innerHTML = compKeys.map((k, idx) => {
            const z = (getFeedComposition()[k] || 0);
            const x = res.liquid.composition[idx] ?? 0;
            const y = res.gas.composition[idx] ?? 0;
            const kval = res.equilibriumKValues[idx] ?? (x > 0 ? y / x : 0);
            return '<tr style="border-bottom: 1px solid var(--border-color);">' +
              '<td style="padding: 4px; font-weight: 600;">' + k + '</td>' +
              '<td style="padding: 4px;">' + (z * 100).toFixed(2) + ' %</td>' +
              '<td style="padding: 4px; color: #34d399;">' + (x * 100).toFixed(2) + ' %</td>' +
              '<td style="padding: 4px; color: #38bdf8;">' + (y * 100).toFixed(2) + ' %</td>' +
              '<td style="padding: 4px;">' + kval.toFixed(4) + '</td>' +
            '</tr>';
          }).join('');
        }
        return;
      }

      if (msg.type === 'phaseEnvelopeResult') {
        const env = msg.data;
        const curP = parseFloat(document.getElementById('flashPressureInput')?.value || '50.0');
        const curT = parseFloat(document.getElementById('flashTempInput')?.value || '25.0') + 273.15;
        const svg = renderInteractivePhaseEnvelopeSvg(env, curP, curT);
        const pvtBox = document.getElementById('pvtSvgContainer');
        if (pvtBox) pvtBox.innerHTML = svg;
        return;
      }

      if (msg.type === 'calibrationResult') {
        const res = msg.data;
        const statusBadge = document.getElementById('tuningStatusBadge');
        if (statusBadge) {
          statusBadge.textContent = res.success ? 'Optimized' : 'Completed';
          statusBadge.className = 'header-badge ' + (res.success ? 'badge-pass' : 'badge-warn');
        }
        const resCard = document.getElementById('calibrationResultsCard');
        if (resCard) resCard.style.display = 'block';
        const applyBtn = document.getElementById('btnApplyCalibration');
        if (applyBtn) applyBtn.style.display = 'inline-block';

        const mBadge = document.getElementById('tuningMetricsBadge');
        if (mBadge) mBadge.textContent = 'Obj: ' + res.finalObjective.toExponential(3);
        const impEl = document.getElementById('tuneImprovement');
        if (impEl) impEl.textContent = res.improvementPercent.toFixed(1) + '%';
        const evalsEl = document.getElementById('tuneEvaluations');
        if (evalsEl) evalsEl.textContent = res.evaluations;
        const pR2El = document.getElementById('tunePressureR2');
        if (pR2El) pR2El.textContent = (res.metrics.pressureR2 * 100).toFixed(1) + '%';
        const pRmseEl = document.getElementById('tunePressureRmse');
        if (pRmseEl) pRmseEl.textContent = res.metrics.pressureRmseBar.toFixed(2) + ' bar';
        const tRmseEl = document.getElementById('tuneTempRmse');
        if (tRmseEl) tRmseEl.textContent = res.metrics.temperatureRmseK.toFixed(2) + ' K';

        lastCalibrationShifts = res.calibratedParameters || [];
        const rows = (res.calibratedParameters || []).map(p =>
          '<tr>' +
            '<td><strong>' + p.name + '</strong></td>' +
            '<td>' + p.initialValue.toFixed(4) + '</td>' +
            '<td style="color: #38bdf8; font-weight: 600;">' + p.calibratedValue.toFixed(4) + '</td>' +
            '<td>' + p.unit + '</td>' +
            '<td style="color: ' + (p.shiftPercent >= 0 ? '#34d399' : '#f87171') + ';">' + (p.shiftPercent >= 0 ? '+' : '') + p.shiftPercent.toFixed(1) + '%</td>' +
          '</tr>'
        ).join('');
        const shiftsBody = document.getElementById('calibrationShiftsBody');
        if (shiftsBody) shiftsBody.innerHTML = rows;
        const repText = document.getElementById('tuningReportText');
        if (repText) repText.textContent = res.markdownReport || '';
        return;
      }

      if (msg.type === 'update') {
        currentData = msg.data;
        document.getElementById('modelTitle').textContent = currentData.title;

        if (currentData.safetyGate) {
          const sg = currentData.safetyGate;
          const sgTitle = document.getElementById('gateVerdictTitle');
          const sgBadge = document.getElementById('gateVerdictBadge');
          const sgCard = document.getElementById('safetyGateCard');
          if (sgTitle && sgBadge && sgCard) {
            sgTitle.textContent = 'FLOW ASSURANCE SAFETY GATE: ' + (sg.passed ? 'APPROVED FOR OPERATION' : 'BLOCKED (LIMIT VIOLATIONS)');
            sgBadge.textContent = sg.passed ? 'APPROVED' : 'BLOCKED';
            sgBadge.className = 'header-badge ' + (sg.passed ? 'badge-pass' : 'badge-fail');
            sgCard.style.borderLeftColor = sg.passed ? '#10b981' : '#ef4444';
          }
        }

        if (currentData.bathy3dData) {
          initOrUpdateBathy3d(currentData.bathy3dData);
        }

        // Auto-switch tab based on file mode
        if (currentData.mode === 'tpl') {
          switchTab('plotsTab');
        } else if (currentData.mode === 'ppl') {
          switchTab('profileTab');
        }

        // Populate dynamic variables for TPL dataset
        if (currentData.trendDataset && currentData.trendDataset.variables && currentData.trendDataset.variables.length > 0) {
          const varContainer = document.getElementById('plotsVariablesContainer');
          if (varContainer) {
            varContainer.innerHTML = currentData.trendDataset.variables.map((v, i) => \`
              <label class="plot-var-label">
                <input type="checkbox" id="chkTplVar_\${i}" \${i < 6 ? 'checked' : ''} onchange="renderTrendsPlot()">
                \${v.name}\${v.unit ? ' [' + v.unit + ']' : ''}
              </label>
            \`).join('');
          }
        }

        // Initialize PVT Composition Studio
        initPvtCompGrid();

        // Compliance status
        const isPassed = currentData.verification.passed;
        const badge = document.getElementById('complianceBadge');
        badge.textContent = isPassed ? 'Compliant' : 'Non-Compliant';
        badge.className = 'header-badge ' + (isPassed ? 'badge-pass' : 'badge-fail');

        // Initial KPIs
        const sim = currentData.simulation;
        const lastIdx = sim.times.length - 1;
        document.getElementById('kpiArrivalP').textContent = (sim.arrivalPressureBar[lastIdx] ?? 0).toFixed(1) + ' bar';
        document.getElementById('kpiArrivalT').textContent = (sim.arrivalTempC[lastIdx] ?? 0).toFixed(1) + ' °C';
        document.getElementById('kpiHoldup').textContent = ((sim.arrivalHoldup[lastIdx] ?? 0) * 100).toFixed(1) + ' %';
        document.getElementById('kpiSurge').textContent = sim.peakSurgeM3.toFixed(1) + ' m³';
        document.getElementById('kpiCooldown').textContent = (currentData.cooldown.noTouchTimeSeconds / 3600).toFixed(1) + ' hrs';
        document.getElementById('kpiDosing').textContent = currentData.inhibition.dosingRateKgH.toFixed(0) + ' kg/h';

        // SVGs
        document.getElementById('profileSvgContainer').innerHTML = currentData.profileSvg;
        const bathyBox = document.getElementById('bathySvgContainer');
        if (bathyBox && currentData.bathySvg) bathyBox.innerHTML = currentData.bathySvg;
        document.getElementById('schematicSvgContainer').innerHTML = currentData.schematicSvg;
        if (currentData.pvtSvg) document.getElementById('pvtSvgContainer').innerHTML = currentData.pvtSvg;
        if (currentData.wellboreSvg) document.getElementById('wellboreSvgContainer').innerHTML = currentData.wellboreSvg;
        if (currentData.slugSvg) document.getElementById('slugSvgContainer').innerHTML = currentData.slugSvg;

        // Scrubber
        const scrubber = document.getElementById('scrubber');
        scrubber.max = (sim.profilesCount - 1) || (sim.times.length - 1);
        scrubber.value = scrubber.max;
        document.getElementById('timeDisplay').textContent = 't = ' + (sim.times[sim.times.length - 1] || 0).toFixed(1) + ' s';

        // Render Flow Assurance Cards
        const ver = currentData.verification.checks;
        const verHtml = [
          renderCard('MAOP Overpressure Limit', ver.maopOverpressure.passed, [
            { name: 'Peak Pressure Observed', val: (ver.maopOverpressure.peakPressureObserved / 1e5).toFixed(1) + ' bar' },
            { name: 'Allowable MAOP', val: (ver.maopOverpressure.limit / 1e5).toFixed(1) + ' bar' },
          ]),
          renderCard('Hydrate Equilibrium Avoidance', ver.hydrateAvoidance.passed, [
            { name: 'Min Observed Subcooling Margin', val: ver.hydrateAvoidance.minMarginObserved.toFixed(1) + ' K' },
            { name: 'Required Safety Margin', val: ver.hydrateAvoidance.requiredMargin.toFixed(1) + ' K' },
            { name: 'Critical Location', val: ver.hydrateAvoidance.criticalLocation || 'Pipeline Riser' },
          ]),
          renderCard('Slug Catcher Capacity', ver.slugCatcherSurge.passed, [
            { name: 'Peak Liquid Surge Volume', val: ver.slugCatcherSurge.peakArrivalLiquidVolume.toFixed(1) + ' m³' },
            { name: 'Liquid Surge Limit (85%)', val: ver.slugCatcherSurge.capacityLimit.toFixed(1) + ' m³' },
          ]),
          renderCard('Turndown Gas Velocity', ver.turndownVelocity.passed, [
            { name: 'Min Gas Velocity Observed', val: ver.turndownVelocity.minVelocityObserved.toFixed(2) + ' m/s' },
            { name: 'Minimum Turndown Limit', val: ver.turndownVelocity.minVelocityLimit.toFixed(2) + ' m/s' },
          ]),
        ].join('');
        document.getElementById('verificationCards').innerHTML = verHtml;

        // Render Thermal & Dosing Cards
        const cd = currentData.cooldown;
        const thermalHtml = [
          renderCard('Pipeline Cooldown & No-Touch Time', true, [
            { name: 'No-Touch Cooldown Time', val: (cd.noTouchTimeSeconds / 3600).toFixed(1) + ' hours' },
            { name: 'Overall Heat Transfer U', val: cd.uHeatTransfer.toFixed(2) + ' W/m²K' },
            { name: 'Lumped Thermal Mass C_th', val: (cd.thermalCapacitancePerMeter / 1e3).toFixed(1) + ' kJ/m·K' },
            { name: 'Steady-State Cooldown Time', val: (cd.timeConstantSeconds / 3600).toFixed(1) + ' hours' },
          ]),
          renderCard('Hydrate Inhibition Dosing (MEG / Hammerschmidt)', true, [
            { name: 'Hydrate Temp Depression ΔT (30 wt%)', val: currentData.inhibition.megDepressionK.toFixed(1) + ' K' },
            { name: 'Inhibitor Dosing Injection Rate', val: currentData.inhibition.dosingRateKgH.toFixed(1) + ' kg/h' },
            { name: 'Required Inhibitor Concentration', val: (currentData.inhibition.requiredWtPercent || 35.0).toFixed(1) + ' wt%' },
          ]),
        ].join('');
        document.getElementById('thermalCards').innerHTML = thermalHtml;

        // Render Diagnostics Table
        const diags = currentData.diagnostics || [];
        const dRows = diags.map(d => \`
          <tr>
            <td><strong style="color: #38bdf8;">\${d.code}</strong></td>
            <td><span style="color: \${d.severity === 'error' ? '#ef4444' : '#f59e0b'};">\${d.severity.toUpperCase()}</span></td>
            <td>\${d.message}</td>
            <td style="color: #94a3b8;">\${d.recommendation || '—'}</td>
          </tr>
        \`).join('');
        document.getElementById('diagnosticsBody').innerHTML = dRows || '<tr><td colspan="4" style="text-align:center; color:#10b981;">No flow assurance rule violations detected.</td></tr>';

        // Render Plots tab if active
        if (activeTabId === 'plotsTab') {
          renderTrendsPlot();
        }
      }
    });

    function renderCard(title, passed, metrics) {
      const badgeClass = passed ? 'badge-pass' : 'badge-fail';
      const badgeText = passed ? 'PASSED' : 'VIOLATION';
      const rows = metrics.map(m => \`
        <div class="metric-item">
          <span class="metric-name">\${m.name}</span>
          <span class="metric-value">\${m.val}</span>
        </div>
      \`).join('');

      return \`
        <div class="status-card">
          <div class="card-header">
            <span class="card-title">\${title}</span>
            <span class="header-badge \${badgeClass}">\${badgeText}</span>
          </div>
          <div class="metric-list">\${rows}</div>
        </div>
      \`;
    }

    // ── 3D Seabed Orbit Canvas & ROV Fly-Through Engine ───────────────────────
    let bathyGl = null;
    let bathyCanvas = null;
    let bathy3dData = null;
    let bathyCameraMode = 'orbit'; // 'orbit' | 'rov'
    let bathyColormap = 'holdup'; // 'holdup' | 'pressure' | 'temperature'
    let rovSpeedMult = 1.0;
    let rovProgress = 0.0;
    let bathyRafId = null;
    let isBathyDragging = false;
    let bathyDragBtn = 0;
    let lastBathyMouse = { x: 0, y: 0 };
    let isBathyShowingSvg = false;

    let bathySolidProg = null;
    let bathyLineProg = null;

    let bathyCamera = {
      rotX: 0.44, // elevation (radians)
      rotY: 0.61, // azimuth (radians)
      dist: 3500, // camera distance
      target: [3000, 400, -200], // look-at target
      panX: 0,
      panY: 0,
    };

    let bathyPipeMesh = null;
    let bathyGridMesh = null;
    let bathyMarkerMesh = null;
    let bathySegments = []; // for raycasting: { p0, p1, name, kp, tvd, holdup, pressure, temp }

    function fallbackToBathySvg(reason) {
      isBathyShowingSvg = true;
      const c3d = document.getElementById('bathy3dContainer');
      const cSvg = document.getElementById('bathySvgContainer');
      const toggleBtn = document.getElementById('bathyRendererToggle');
      if (c3d) c3d.style.display = 'none';
      if (cSvg) cSvg.style.display = 'flex';
      if (toggleBtn) toggleBtn.textContent = 'Show 3D WebGL';
      if (reason) console.info('[Bathy 3D Fallback]', reason);
    }

    function toggleBathyRenderer() {
      isBathyShowingSvg = !isBathyShowingSvg;
      const c3d = document.getElementById('bathy3dContainer');
      const cSvg = document.getElementById('bathySvgContainer');
      const toggleBtn = document.getElementById('bathyRendererToggle');
      if (isBathyShowingSvg) {
        if (c3d) c3d.style.display = 'none';
        if (cSvg) cSvg.style.display = 'flex';
        if (toggleBtn) toggleBtn.textContent = 'Show 3D WebGL';
      } else {
        if (c3d) c3d.style.display = 'block';
        if (cSvg) cSvg.style.display = 'none';
        if (toggleBtn) toggleBtn.textContent = 'Show 2D SVG';
        resizeBathyCanvas();
        requestBathyRender();
      }
    }

    function setBathyCameraMode(mode) {
      bathyCameraMode = mode;
      const orbitBtn = document.getElementById('bathyModeOrbitBtn');
      const rovBtn = document.getElementById('bathyModeRovBtn');
      const speedBtn = document.getElementById('bathyRovSpeedBtn');
      const indicator = document.getElementById('bathyModeIndicator');
      const hudInfo = document.getElementById('bathyHudInfo');

      if (orbitBtn) orbitBtn.classList.toggle('active-bathy-btn', mode === 'orbit');
      if (rovBtn) rovBtn.classList.toggle('active-bathy-btn', mode === 'rov');

      if (mode === 'rov') {
        if (speedBtn) speedBtn.style.display = 'inline-block';
        if (indicator) {
          indicator.textContent = '[ROV FLY-THROUGH]';
          indicator.style.color = '#38bdf8';
        }
        if (hudInfo) hudInfo.textContent = 'ROV Navigating Pipeline Survey Spline | Click Orbit to resume manual camera';
      } else {
        if (speedBtn) speedBtn.style.display = 'none';
        if (indicator) {
          indicator.textContent = '[ORBIT]';
          indicator.style.color = '#10b981';
        }
        if (hudInfo) hudInfo.textContent = 'Rotate: Left Click + Drag | Pan: Right Click + Drag | Zoom: Wheel';
      }
      requestBathyRender();
    }

    function toggleRovSpeed() {
      const speeds = [1.0, 2.0, 4.0, 0.5];
      const curIdx = speeds.indexOf(rovSpeedMult);
      rovSpeedMult = speeds[(curIdx + 1) % speeds.length];
      const btn = document.getElementById('bathyRovSpeedBtn');
      if (btn) btn.textContent = 'Speed: ' + rovSpeedMult + 'x';
    }

    function resetBathyCamera() {
      if (!bathy3dData || !bathy3dData.points || bathy3dData.points.length === 0) return;
      const pts = bathy3dData.points;
      let minX = pts[0].x, maxX = pts[0].x;
      let minY = pts[0].y, maxY = pts[0].y;
      let minZ = pts[0].z, maxZ = pts[0].z;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;
      const span = Math.max(maxX - minX, maxY - minY, (maxZ - minZ) * 2, 800);

      bathyCamera.target = [cx, cy, cz];
      bathyCamera.dist = span * 1.35;
      bathyCamera.rotX = 0.44;
      bathyCamera.rotY = 0.61;
      bathyCamera.panX = 0;
      bathyCamera.panY = 0;
      rovProgress = 0.0;
      requestBathyRender();
    }

    function onBathyColormapChange(colormap) {
      bathyColormap = colormap;
      const titleEl = document.getElementById('bathyLegendTitle');
      const minEl = document.getElementById('bathyLegendMin');
      const midEl = document.getElementById('bathyLegendMid');
      const maxEl = document.getElementById('bathyLegendMax');
      const gradEl = document.getElementById('bathyLegendGradient');

      if (colormap === 'holdup') {
        if (titleEl) titleEl.textContent = 'Liquid Holdup (HL)';
        if (minEl) minEl.textContent = '0.00';
        if (midEl) midEl.textContent = '0.50';
        if (maxEl) maxEl.textContent = '1.00';
        if (gradEl) gradEl.style.background = 'linear-gradient(to right, #0284c7, #10b981, #f59e0b, #ef4444)';
      } else if (colormap === 'pressure') {
        if (titleEl) titleEl.textContent = 'Pressure (bar)';
        if (minEl) minEl.textContent = '20 bar';
        if (midEl) midEl.textContent = '80 bar';
        if (maxEl) maxEl.textContent = '150 bar';
        if (gradEl) gradEl.style.background = 'linear-gradient(to right, #0284c7, #06b6d4, #f59e0b, #dc2626)';
      } else {
        if (titleEl) titleEl.textContent = 'Temperature (°C)';
        if (minEl) minEl.textContent = '4 °C';
        if (midEl) midEl.textContent = '40 °C';
        if (maxEl) maxEl.textContent = '80 °C';
        if (gradEl) gradEl.style.background = 'linear-gradient(to right, #38bdf8, #0ea5e9, #f59e0b, #e11d48)';
      }

      if (bathy3dData) {
        rebuildBathyPipeMesh(bathy3dData.points);
      }
      requestBathyRender();
    }

    function getBathyColor(val, minV, maxV, mode) {
      const t = Math.max(0, Math.min(1, (val - minV) / (maxV - minV || 1)));
      if (mode === 'holdup') {
        if (t < 0.25) {
          const s = t / 0.25;
          return [0.05 + 0.1 * s, 0.35 + 0.4 * s, 0.85 + 0.15 * s];
        } else if (t < 0.5) {
          const s = (t - 0.25) / 0.25;
          return [0.15 + 0.1 * s, 0.75 + 0.15 * s, 0.95 - 0.5 * s];
        } else if (t < 0.75) {
          const s = (t - 0.5) / 0.25;
          return [0.25 + 0.7 * s, 0.9 - 0.3 * s, 0.35 - 0.25 * s];
        } else {
          const s = (t - 0.75) / 0.25;
          return [0.95, 0.6 - 0.45 * s, 0.1 - 0.1 * s];
        }
      } else if (mode === 'pressure') {
        if (t < 0.33) {
          const s = t / 0.33;
          return [0.1 + 0.1 * s, 0.4 + 0.5 * s, 0.9];
        } else if (t < 0.66) {
          const s = (t - 0.33) / 0.33;
          return [0.2 + 0.75 * s, 0.9 - 0.2 * s, 0.9 - 0.7 * s];
        } else {
          const s = (t - 0.66) / 0.34;
          return [0.95, 0.7 - 0.55 * s, 0.2 - 0.1 * s];
        }
      } else {
        if (t < 0.33) {
          const s = t / 0.33;
          return [0.2 + 0.1 * s, 0.7 + 0.2 * s, 0.95];
        } else if (t < 0.66) {
          const s = (t - 0.33) / 0.33;
          return [0.3 + 0.65 * s, 0.9 - 0.1 * s, 0.95 - 0.8 * s];
        } else {
          const s = (t - 0.66) / 0.34;
          return [0.95, 0.8 - 0.65 * s, 0.15 - 0.1 * s];
        }
      }
    }

    // ── Matrix Math ──────────────────────────────────────────────────────────
    function bMat4Identity() {
      return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    }
    function bMat4Multiply(a, b) {
      const out = new Float32Array(16);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          out[i * 4 + j] =
            a[i * 4 + 0] * b[0 * 4 + j] +
            a[i * 4 + 1] * b[1 * 4 + j] +
            a[i * 4 + 2] * b[2 * 4 + j] +
            a[i * 4 + 3] * b[3 * 4 + j];
        }
      }
      return out;
    }
    function bMat4Perspective(fovRad, aspect, near, far) {
      const f = 1.0 / Math.tan(fovRad / 2);
      const out = new Float32Array(16);
      out[0] = f / aspect;
      out[5] = f;
      out[10] = (far + near) / (near - far);
      out[11] = -1;
      out[14] = (2 * far * near) / (near - far);
      return out;
    }
    function bMat4LookAt(eye, center, up) {
      const z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
      const lenZ = Math.sqrt(z0*z0 + z1*z1 + z2*z2) || 1;
      const zx = z0/lenZ, zy = z1/lenZ, zz = z2/lenZ;

      const x0 = up[1]*zz - up[2]*zy, x1 = up[2]*zx - up[0]*zz, x2 = up[0]*zy - up[1]*zx;
      const lenX = Math.sqrt(x0*x0 + x1*x1 + x2*x2) || 1;
      const xx = x0/lenX, xy = x1/lenX, xz = x2/lenX;

      const yx = zy*xz - zz*xy, yy = zz*xx - zx*xz, yz = zx*xy - zy*xx;

      const out = new Float32Array(16);
      out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
      out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
      out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
      out[12] = -(xx*eye[0] + xy*eye[1] + xz*eye[2]);
      out[13] = -(yx*eye[0] + yy*eye[1] + yz*eye[2]);
      out[14] = -(zx*eye[0] + zy*eye[1] + zz*eye[2]);
      out[15] = 1;
      return out;
    }
    function bMat3FromMat4(m) {
      return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
    }

    // ── Mesh Builders ────────────────────────────────────────────────────────
    function rebuildBathyPipeMesh(points) {
      if (!bathyGl || !points || points.length < 2) return;
      bathySegments = [];

      let minX = points[0].x, maxX = points[0].x;
      let minZ = points[0].z, maxZ = points[0].z;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      }
      const span = Math.max(maxX - minX, 1000);
      const pipeR = Math.max(12, span * 0.005);

      const pos = [];
      const norm = [];
      const col = [];
      const idx = [];
      const segSides = 12;

      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
        const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
        const wx = dx / len, wy = dy / len, wz = dz / len;

        let upx = 0, upy = 0, upz = 1;
        if (Math.abs(wz) > 0.95) { upx = 0; upy = 1; upz = 0; }

        let ux = upy * wz - upz * wy, uy = upz * wx - upx * wz, uz = upx * wy - upy * wx;
        const uLen = Math.sqrt(ux*ux + uy*uy + uz*uz) || 1;
        ux /= uLen; uy /= uLen; uz /= uLen;

        const vx = wy * uz - wz * uy, vy = wz * ux - wx * uz, vz = wx * uy - wy * ux;

        let val0 = p0.holdup, val1 = p1.holdup, minV = 0, maxV = 1.0;
        if (bathyColormap === 'pressure') {
          val0 = p0.pressureBar; val1 = p1.pressureBar; minV = 20; maxV = 150;
        } else if (bathyColormap === 'temperature') {
          val0 = p0.tempC; val1 = p1.tempC; minV = 4; maxV = 80;
        }

        const c0 = getBathyColor(val0, minV, maxV, bathyColormap);
        const c1 = getBathyColor(val1, minV, maxV, bathyColormap);

        const baseIdx = pos.length / 3;

        for (let j = 0; j <= segSides; j++) {
          const th = (j / segSides) * Math.PI * 2;
          const cosT = Math.cos(th), sinT = Math.sin(th);
          const nx = cosT * ux + sinT * vx;
          const ny = cosT * uy + sinT * vy;
          const nz = cosT * uz + sinT * vz;

          pos.push(p0.x + nx * pipeR, p0.y + ny * pipeR, p0.z + nz * pipeR);
          norm.push(nx, ny, nz);
          col.push(c0[0], c0[1], c0[2]);

          pos.push(p1.x + nx * pipeR, p1.y + ny * pipeR, p1.z + nz * pipeR);
          norm.push(nx, ny, nz);
          col.push(c1[0], c1[1], c1[2]);
        }

        for (let j = 0; j < segSides; j++) {
          const pA = baseIdx + j * 2;
          const pB = baseIdx + j * 2 + 1;
          const pC = baseIdx + (j + 1) * 2;
          const pD = baseIdx + (j + 1) * 2 + 1;
          idx.push(pA, pB, pC);
          idx.push(pC, pB, pD);
        }

        bathySegments.push({
          p0: [p0.x, p0.y, p0.z],
          p1: [p1.x, p1.y, p1.z],
          name: p1.name || ('Section-' + (i + 1)),
          kp: p1.kp || ((i + 1) * 1000),
          tvd: p1.z,
          holdup: p1.holdup,
          pressure: p1.pressureBar,
          temp: p1.tempC,
        });
      }

      if (bathyPipeMesh) {
        bathyGl.deleteBuffer(bathyPipeMesh.vbo);
        bathyGl.deleteBuffer(bathyPipeMesh.nbo);
        bathyGl.deleteBuffer(bathyPipeMesh.cbo);
        bathyGl.deleteBuffer(bathyPipeMesh.ibo);
      }

      const vbo = bathyGl.createBuffer();
      bathyGl.bindBuffer(bathyGl.ARRAY_BUFFER, vbo);
      bathyGl.bufferData(bathyGl.ARRAY_BUFFER, new Float32Array(pos), bathyGl.STATIC_DRAW);

      const nbo = bathyGl.createBuffer();
      bathyGl.bindBuffer(bathyGl.ARRAY_BUFFER, nbo);
      bathyGl.bufferData(bathyGl.ARRAY_BUFFER, new Float32Array(norm), bathyGl.STATIC_DRAW);

      const cbo = bathyGl.createBuffer();
      bathyGl.bindBuffer(bathyGl.ARRAY_BUFFER, cbo);
      bathyGl.bufferData(bathyGl.ARRAY_BUFFER, new Float32Array(col), bathyGl.STATIC_DRAW);

      const ibo = bathyGl.createBuffer();
      bathyGl.bindBuffer(bathyGl.ELEMENT_ARRAY_BUFFER, ibo);
      bathyGl.bufferData(bathyGl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), bathyGl.STATIC_DRAW);

      bathyPipeMesh = { vbo, nbo, cbo, ibo, count: idx.length };
    }

    function buildBathySeabedGrid(points) {
      if (!bathyGl || !points || points.length === 0) return;
      let minX = points[0].x, maxX = points[0].x;
      let minY = points[0].y, maxY = points[0].y;
      let minZ = points[0].z;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        if (p.z < minZ) minZ = p.z;
      }
      const spanX = Math.max(1000, maxX - minX);
      const spanY = Math.max(1000, maxY - minY);
      const gMinX = minX - spanX * 0.15;
      const gMaxX = maxX + spanX * 0.15;
      const gMinY = minY - spanY * 0.25;
      const gMaxY = maxY + spanY * 0.25;
      const baseZ = minZ - 35;

      const gridLines = [];
      const numLinesX = 24;
      const numLinesY = 16;

      for (let i = 0; i <= numLinesX; i++) {
        const x = gMinX + (i / numLinesX) * (gMaxX - gMinX);
        for (let j = 0; j < numLinesY; j++) {
          const y0 = gMinY + (j / numLinesY) * (gMaxY - gMinY);
          const y1 = gMinY + ((j + 1) / numLinesY) * (gMaxY - gMinY);
          const z0 = baseZ + Math.sin(x / 450) * 12 + Math.cos(y0 / 380) * 8;
          const z1 = baseZ + Math.sin(x / 450) * 12 + Math.cos(y1 / 380) * 8;
          gridLines.push(x, y0, z0, x, y1, z1);
        }
      }
      for (let j = 0; j <= numLinesY; j++) {
        const y = gMinY + (j / numLinesY) * (gMaxY - gMinY);
        for (let i = 0; i < numLinesX; i++) {
          const x0 = gMinX + (i / numLinesX) * (gMaxX - gMinX);
          const x1 = gMinX + ((i + 1) / numLinesX) * (gMaxX - gMinX);
          const z0 = baseZ + Math.sin(x0 / 450) * 12 + Math.cos(y / 380) * 8;
          const z1 = baseZ + Math.sin(x1 / 450) * 12 + Math.cos(y / 380) * 8;
          gridLines.push(x0, y, z0, x1, y, z1);
        }
      }

      if (bathyGridMesh) {
        bathyGl.deleteBuffer(bathyGridMesh.vbo);
      }
      const vbo = bathyGl.createBuffer();
      bathyGl.bindBuffer(bathyGl.ARRAY_BUFFER, vbo);
      bathyGl.bufferData(bathyGl.ARRAY_BUFFER, new Float32Array(gridLines), bathyGl.STATIC_DRAW);
      bathyGridMesh = { vbo, count: gridLines.length / 3 };
    }

    function buildBathyMarkers(points) {
      if (!bathyGl || !points || points.length < 2) return;
      const p0 = points[0];
      const pN = points[points.length - 1];

      const pos = [];
      const norm = [];
      const col = [];
      const idx = [];

      function addBox(cx, cy, cz, w, d, h, r, g, b) {
        const hw = w/2, hd = d/2, hh = h/2;
        const bPos = [
          cx-hw, cy-hd, cz+hh,  cx+hw, cy-hd, cz+hh,  cx+hw, cy+hd, cz+hh,  cx-hw, cy+hd, cz+hh,
          cx-hw, cy-hd, cz-hh,  cx-hw, cy+hd, cz-hh,  cx+hw, cy+hd, cz-hh,  cx+hw, cy-hd, cz-hh,
          cx-hw, cy-hd, cz-hh,  cx+hw, cy-hd, cz-hh,  cx+hw, cy-hd, cz+hh,  cx-hw, cy-hd, cz+hh,
          cx-hw, cy+hd, cz-hh,  cx-hw, cy+hd, cz+hh,  cx+hw, cy+hd, cz+hh,  cx+hw, cy+hd, cz-hh,
          cx+hw, cy-hd, cz-hh,  cx+hw, cy+hd, cz-hh,  cx+hw, cy+hd, cz+hh,  cx+hw, cy-hd, cz+hh,
          cx-hw, cy-hd, cz-hh,  cx-hw, cy-hd, cz+hh,  cx-hw, cy+hd, cz+hh,  cx-hw, cy+hd, cz-hh
        ];
        const bNorm = [
          0,0,1, 0,0,1, 0,0,1, 0,0,1,
          0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
          0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
          0,1,0, 0,1,0, 0,1,0, 0,1,0,
          1,0,0, 1,0,0, 1,0,0, 1,0,0,
          -1,0,0, -1,0,0, -1,0,0, -1,0,0
        ];
        const baseI = pos.length / 3;
        for (let i = 0; i < 24; i++) {
          pos.push(bPos[i*3], bPos[i*3+1], bPos[i*3+2]);
          norm.push(bNorm[i*3], bNorm[i*3+1], bNorm[i*3+2]);
          col.push(r, g, b);
        }
        for (let f = 0; f < 6; f++) {
          const off = baseI + f * 4;
          idx.push(off, off+1, off+2, off, off+2, off+3);
        }
      }

      addBox(p0.x, p0.y, p0.z - 10, 45, 45, 20, 0.95, 0.75, 0.15);
      addBox(pN.x, pN.y, pN.z + 15, 60, 60, 15, 0.92, 0.45, 0.12);
      addBox(pN.x - 22, pN.y - 22, pN.z, 8, 8, 30, 0.45, 0.55, 0.65);
      addBox(pN.x + 22, pN.y - 22, pN.z, 8, 8, 30, 0.45, 0.55, 0.65);
      addBox(pN.x - 22, pN.y + 22, pN.z, 8, 8, 30, 0.45, 0.55, 0.65);
      addBox(pN.x + 22, pN.y + 22, pN.z, 8, 8, 30, 0.45, 0.55, 0.65);

      if (bathyMarkerMesh) {
        bathyGl.deleteBuffer(bathyMarkerMesh.vbo);
        bathyGl.deleteBuffer(bathyMarkerMesh.nbo);
        bathyGl.deleteBuffer(bathyMarkerMesh.cbo);
        bathyGl.deleteBuffer(bathyMarkerMesh.ibo);
      }

      const vbo = bathyGl.createBuffer();
      bathyGl.bindBuffer(bathyGl.ARRAY_BUFFER, vbo);
      bathyGl.bufferData(bathyGl.ARRAY_BUFFER, new Float32Array(pos), bathyGl.STATIC_DRAW);

      const nbo = bathyGl.createBuffer();
      bathyGl.bindBuffer(bathyGl.ARRAY_BUFFER, nbo);
      bathyGl.bufferData(bathyGl.ARRAY_BUFFER, new Float32Array(norm), bathyGl.STATIC_DRAW);

      const cbo = bathyGl.createBuffer();
      bathyGl.bindBuffer(bathyGl.ARRAY_BUFFER, cbo);
      bathyGl.bufferData(bathyGl.ARRAY_BUFFER, new Float32Array(col), bathyGl.STATIC_DRAW);

      const ibo = bathyGl.createBuffer();
      bathyGl.bindBuffer(bathyGl.ELEMENT_ARRAY_BUFFER, ibo);
      bathyGl.bufferData(bathyGl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), bathyGl.STATIC_DRAW);

      bathyMarkerMesh = { vbo, nbo, cbo, ibo, count: idx.length };
    }

    // ── Setup & Rendering ───────────────────────────────────────────────────
    function initBathy3dEngine() {
      bathyCanvas = document.getElementById('bathy3dCanvas');
      if (!bathyCanvas) return;

      try {
        bathyGl = bathyCanvas.getContext('webgl', { antialias: true, alpha: false, depth: true });
      } catch (err) {
        console.warn('[Bathy 3D] WebGL not supported, falling back to SVG:', err);
      }

      if (!bathyGl) {
        fallbackToBathySvg('WebGL context unavailable on this system.');
        return;
      }

      bathyGl.enable(bathyGl.DEPTH_TEST);
      bathyGl.depthFunc(bathyGl.LEQUAL);

      const vsSource = [
        'attribute vec3 aPos;',
        'attribute vec3 aNorm;',
        'attribute vec3 aColor;',
        'uniform mat4 uProj;',
        'uniform mat4 uView;',
        'uniform mat4 uModel;',
        'uniform mat3 uNormMat;',
        'varying vec3 vPos;',
        'varying vec3 vNorm;',
        'varying vec3 vColor;',
        'void main() {',
        '  vec4 worldPos = uModel * vec4(aPos, 1.0);',
        '  vPos = worldPos.xyz;',
        '  vNorm = normalize(uNormMat * aNorm);',
        '  vColor = aColor;',
        '  gl_Position = uProj * uView * worldPos;',
        '}'
      ].join('\n');

      const fsSource = [
        'precision mediump float;',
        'varying vec3 vPos;',
        'varying vec3 vNorm;',
        'varying vec3 vColor;',
        'uniform vec3 uLightDir1;',
        'uniform vec3 uLightDir2;',
        'void main() {',
        '  vec3 n = normalize(vNorm);',
        '  vec3 l1 = normalize(uLightDir1);',
        '  vec3 l2 = normalize(uLightDir2);',
        '  float diff1 = max(dot(n, l1), 0.0);',
        '  float diff2 = max(dot(n, l2), 0.0) * 0.4;',
        '  vec3 ambient = vec3(0.20, 0.24, 0.32);',
        '  vec3 lit = vColor * (ambient + diff1 * 0.85 + diff2);',
        '  gl_FragColor = vec4(lit, 1.0);',
        '}'
      ].join('\n');

      const lineVs = [
        'attribute vec3 aPos;',
        'uniform mat4 uProj;',
        'uniform mat4 uView;',
        'uniform mat4 uModel;',
        'void main() {',
        '  gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);',
        '}'
      ].join('\n');

      const lineFs = [
        'precision mediump float;',
        'uniform vec4 uLineColor;',
        'void main() {',
        '  gl_FragColor = uLineColor;',
        '}'
      ].join('\n');

      function compile(src, type) {
        const s = bathyGl.createShader(type);
        bathyGl.shaderSource(s, src);
        bathyGl.compileShader(s);
        return s;
      }
      function createProg(vs, fs) {
        const p = bathyGl.createProgram();
        bathyGl.attachShader(p, compile(vs, bathyGl.VERTEX_SHADER));
        bathyGl.attachShader(p, compile(fs, bathyGl.FRAGMENT_SHADER));
        bathyGl.linkProgram(p);
        return p;
      }

      bathySolidProg = createProg(vsSource, fsSource);
      bathyLineProg = createProg(lineVs, lineFs);

      setupBathyEventListeners();
      resizeBathyCanvas();
    }

    function resizeBathyCanvas() {
      if (!bathyCanvas || !bathyCanvas.parentElement) return;
      const dpr = window.devicePixelRatio || 1;
      const w = bathyCanvas.parentElement.clientWidth;
      const h = bathyCanvas.parentElement.clientHeight;
      if (w <= 0 || h <= 0) return;
      bathyCanvas.width = w * dpr;
      bathyCanvas.height = h * dpr;
      if (bathyGl) bathyGl.viewport(0, 0, bathyCanvas.width, bathyCanvas.height);
    }
    window.addEventListener('resize', resizeBathyCanvas);

    function setupBathyEventListeners() {
      if (!bathyCanvas) return;

      bathyCanvas.addEventListener('pointerdown', (e) => {
        isBathyDragging = true;
        bathyDragBtn = e.button;
        lastBathyMouse = { x: e.clientX, y: e.clientY };
        bathyCanvas.style.cursor = 'grabbing';
      });

      window.addEventListener('pointermove', (e) => {
        if (isBathyDragging) {
          const dx = e.clientX - lastBathyMouse.x;
          const dy = e.clientY - lastBathyMouse.y;
          lastBathyMouse = { x: e.clientX, y: e.clientY };

          if (bathyCameraMode === 'rov') {
            setBathyCameraMode('orbit');
          }

          if (bathyDragBtn === 0 && !e.shiftKey) {
            bathyCamera.rotY += dx * 0.008;
            bathyCamera.rotX = Math.max(0.05, Math.min(1.52, bathyCamera.rotX + dy * 0.008));
          } else {
            const panScale = bathyCamera.dist * 0.001;
            const cosY = Math.cos(bathyCamera.rotY), sinY = Math.sin(bathyCamera.rotY);
            bathyCamera.target[0] -= (dx * -sinY - dy * cosY) * panScale;
            bathyCamera.target[1] -= (dx * cosY - dy * -sinY) * panScale;
          }
          requestBathyRender();
        } else if (activeTabId === 'bathyTab' && !isBathyShowingSvg) {
          handleBathyHover(e);
        }
      });

      window.addEventListener('pointerup', () => {
        isBathyDragging = false;
        if (bathyCanvas) bathyCanvas.style.cursor = 'grab';
      });

      bathyCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (bathyCameraMode === 'rov') setBathyCameraMode('orbit');
        const zoomDelta = Math.sign(e.deltaY) * 0.12;
        bathyCamera.dist = Math.max(250, Math.min(30000, bathyCamera.dist * (1 + zoomDelta)));
        requestBathyRender();
      }, { passive: false });
    }

    function handleBathyHover(e) {
      if (!bathyCanvas || bathySegments.length === 0) return;
      const rect = bathyCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (mx < 0 || mx > rect.width || my < 0 || my > rect.height) {
        hideBathyHoverCard();
        return;
      }

      const aspect = (bathyCanvas.width || 1) / (bathyCanvas.height || 1);
      const proj = bMat4Perspective(45 * Math.PI / 180, aspect, 10, 50000);
      const view = getBathyViewMatrix();
      const vp = bMat4Multiply(proj, view);

      function toScreen(pt) {
        const x = pt[0], y = pt[1], z = pt[2];
        const clipX = vp[0]*x + vp[4]*y + vp[8]*z + vp[12];
        const clipY = vp[1]*x + vp[5]*y + vp[9]*z + vp[13];
        const clipW = vp[3]*x + vp[7]*y + vp[11]*z + vp[15];
        if (clipW <= 0) return null;
        return [
          ((clipX / clipW) * 0.5 + 0.5) * rect.width,
          ((-(clipY / clipW)) * 0.5 + 0.5) * rect.height,
        ];
      }

      let closestSeg = null;
      let minDist = 22;

      for (let i = 0; i < bathySegments.length; i++) {
        const seg = bathySegments[i];
        const s0 = toScreen(seg.p0);
        const s1 = toScreen(seg.p1);
        if (!s0 || !s1) continue;

        const ldx = s1[0] - s0[0], ldy = s1[1] - s0[1];
        const lenSq = ldx*ldx + ldy*ldy || 1;
        const u = Math.max(0, Math.min(1, ((mx - s0[0]) * ldx + (my - s0[1]) * ldy) / lenSq));
        const px = s0[0] + u * ldx, py = s0[1] + u * ldy;
        const d = Math.hypot(mx - px, my - py);

        if (d < minDist) {
          minDist = d;
          closestSeg = seg;
        }
      }

      if (closestSeg) {
        showBathyHoverCard(e.clientX, e.clientY, closestSeg);
      } else {
        hideBathyHoverCard();
      }
    }

    function showBathyHoverCard(cx, cy, seg) {
      const card = document.getElementById('bathyHoverCard');
      if (!card) return;
      card.style.display = 'block';
      card.style.left = (cx + 14) + 'px';
      card.style.top = (cy + 14) + 'px';

      document.getElementById('hoverPipeName').textContent = seg.name;
      document.getElementById('hoverDetails').textContent = 'KP: ' + (seg.kp / 1000).toFixed(2) + ' km | TVD: ' + seg.tvd.toFixed(1) + ' m';
      document.getElementById('hoverMetrics').textContent =
        'HL: ' + seg.holdup.toFixed(2) + ' | P: ' + seg.pressure.toFixed(1) + ' bar | T: ' + seg.temp.toFixed(1) + ' °C';
    }

    function hideBathyHoverCard() {
      const card = document.getElementById('bathyHoverCard');
      if (card) card.style.display = 'none';
    }

    function getBathyViewMatrix() {
      if (bathyCameraMode === 'rov' && bathy3dData && bathy3dData.points && bathy3dData.points.length >= 2) {
        const pts = bathy3dData.points;
        const total = pts.length - 1;
        const exact = rovProgress * total;
        const idx = Math.min(total - 1, Math.floor(exact));
        const frac = exact - idx;
        const p0 = pts[idx], p1 = pts[idx + 1];

        const cx = p0.x + (p1.x - p0.x) * frac;
        const cy = p0.y + (p1.y - p0.y) * frac;
        const cz = p0.z + (p1.z - p0.z) * frac;

        const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        const tx = dx / len, ty = dy / len, tz = dz / len;

        const eye = [cx - tx * 60, cy - ty * 60, cz + 25];
        const target = [cx + tx * 80, cy + ty * 80, cz + tz * 10];
        return bMat4LookAt(eye, target, [0, 0, 1]);
      }

      const cy = Math.cos(bathyCamera.rotY), sy = Math.sin(bathyCamera.rotY);
      const cp = Math.cos(bathyCamera.rotX), sp = Math.sin(bathyCamera.rotX);

      const eye = [
        bathyCamera.target[0] + bathyCamera.dist * cp * sy,
        bathyCamera.target[1] + bathyCamera.dist * cp * cy,
        bathyCamera.target[2] + bathyCamera.dist * sp,
      ];
      return bMat4LookAt(eye, bathyCamera.target, [0, 0, 1]);
    }

    function requestBathyRender() {
      if (bathyRafId) return;
      bathyRafId = requestAnimationFrame(renderBathyScene);
    }

    function renderBathyScene() {
      bathyRafId = null;
      if (!bathyGl || isBathyShowingSvg) return;

      if (bathyCameraMode === 'rov') {
        rovProgress += 0.0012 * rovSpeedMult;
        if (rovProgress > 1.0) rovProgress = 0.0;
        requestBathyRender();
      }

      const camPosEl = document.getElementById('bathyCameraPos');
      if (camPosEl) {
        if (bathyCameraMode === 'rov') {
          const kp = (rovProgress * (bathySegments.length > 0 ? bathySegments[bathySegments.length - 1].kp : 0) / 1000).toFixed(2);
          camPosEl.textContent = 'ROV KP: ' + kp + ' km | Speed: ' + rovSpeedMult + 'x';
        } else {
          const azDeg = Math.round((bathyCamera.rotY * 180 / Math.PI) % 360);
          const elDeg = Math.round(bathyCamera.rotX * 180 / Math.PI);
          camPosEl.textContent = 'Az: ' + azDeg + '° | El: ' + elDeg + '° | Dist: ' + Math.round(bathyCamera.dist) + 'm';
        }
      }

      bathyGl.clearColor(0.02, 0.03, 0.07, 1.0);
      bathyGl.clear(bathyGl.COLOR_BUFFER_BIT | bathyGl.DEPTH_BUFFER_BIT);

      const aspect = (bathyCanvas.width || 1) / (bathyCanvas.height || 1);
      const proj = bMat4Perspective(45 * Math.PI / 180, aspect, 10, 50000);
      const view = getBathyViewMatrix();
      const model = bMat4Identity();
      const normMat = bMat3FromMat4(model);

      // 1. Render Seabed Grid
      if (bathyGridMesh && bathyLineProg) {
        bathyGl.useProgram(bathyLineProg);
        const uProj = bathyGl.getUniformLocation(bathyLineProg, 'uProj');
        const uView = bathyGl.getUniformLocation(bathyLineProg, 'uView');
        const uModel = bathyGl.getUniformLocation(bathyLineProg, 'uModel');
        const uLineColor = bathyGl.getUniformLocation(bathyLineProg, 'uLineColor');

        bathyGl.uniformMatrix4fv(uProj, false, proj);
        bathyGl.uniformMatrix4fv(uView, false, view);
        bathyGl.uniformMatrix4fv(uModel, false, model);
        bathyGl.uniform4f(uLineColor, 0.04, 0.30, 0.42, 0.40);

        const aPos = bathyGl.getAttribLocation(bathyLineProg, 'aPos');
        bathyGl.bindBuffer(bathyGl.ARRAY_BUFFER, bathyGridMesh.vbo);
        bathyGl.enableVertexAttribArray(aPos);
        bathyGl.vertexAttribPointer(aPos, 3, bathyGl.FLOAT, false, 0, 0);

        bathyGl.drawArrays(bathyGl.LINES, 0, bathyGridMesh.count);
      }

      // 2. Render Pipeline
      if (bathyPipeMesh && bathySolidProg) {
        bathyGl.useProgram(bathySolidProg);
        const uProj = bathyGl.getUniformLocation(bathySolidProg, 'uProj');
        const uView = bathyGl.getUniformLocation(bathySolidProg, 'uView');
        const uModel = bathyGl.getUniformLocation(bathySolidProg, 'uModel');
        const uNormMat = bathyGl.getUniformLocation(bathySolidProg, 'uNormMat');
        const uLightDir1 = bathyGl.getUniformLocation(bathySolidProg, 'uLightDir1');
        const uLightDir2 = bathyGl.getUniformLocation(bathySolidProg, 'uLightDir2');

        bathyGl.uniformMatrix4fv(uProj, false, proj);
        bathyGl.uniformMatrix4fv(uView, false, view);
        bathyGl.uniformMatrix4fv(uModel, false, model);
        bathyGl.uniformMatrix3fv(uNormMat, false, normMat);
        bathyGl.uniform3f(uLightDir1, 0.5, 0.8, 0.7);
        bathyGl.uniform3f(uLightDir2, -0.4, -0.3, 0.8);

        const aPos = bathyGl.getAttribLocation(bathySolidProg, 'aPos');
        const aNorm = bathyGl.getAttribLocation(bathySolidProg, 'aNorm');
        const aColor = bathyGl.getAttribLocation(bathySolidProg, 'aColor');

        bathyGl.bindBuffer(bathyGl.ARRAY_BUFFER, bathyPipeMesh.vbo);
        bathyGl.enableVertexAttribArray(aPos);
        bathyGl.vertexAttribPointer(aPos, 3, bathyGl.FLOAT, false, 0, 0);

        bathyGl.bindBuffer(bathyGl.ARRAY_BUFFER, bathyPipeMesh.nbo);
        bathyGl.enableVertexAttribArray(aNorm);
        bathyGl.vertexAttribPointer(aNorm, 3, bathyGl.FLOAT, false, 0, 0);

        bathyGl.bindBuffer(bathyGl.ARRAY_BUFFER, bathyPipeMesh.cbo);
        bathyGl.enableVertexAttribArray(aColor);
        bathyGl.vertexAttribPointer(aColor, 3, bathyGl.FLOAT, false, 0, 0);

        bathyGl.bindBuffer(bathyGl.ELEMENT_ARRAY_BUFFER, bathyPipeMesh.ibo);
        bathyGl.drawElements(bathyGl.TRIANGLES, bathyPipeMesh.count, bathyGl.UNSIGNED_SHORT, 0);
      }

      // 3. Render Wellhead & Topside Platform Markers
      if (bathyMarkerMesh && bathySolidProg) {
        bathyGl.useProgram(bathySolidProg);
        const aPos = bathyGl.getAttribLocation(bathySolidProg, 'aPos');
        const aNorm = bathyGl.getAttribLocation(bathySolidProg, 'aNorm');
        const aColor = bathyGl.getAttribLocation(bathySolidProg, 'aColor');

        bathyGl.bindBuffer(bathyGl.ARRAY_BUFFER, bathyMarkerMesh.vbo);
        bathyGl.enableVertexAttribArray(aPos);
        bathyGl.vertexAttribPointer(aPos, 3, bathyGl.FLOAT, false, 0, 0);

        bathyGl.bindBuffer(bathyGl.ARRAY_BUFFER, bathyMarkerMesh.nbo);
        bathyGl.enableVertexAttribArray(aNorm);
        bathyGl.vertexAttribPointer(aNorm, 3, bathyGl.FLOAT, false, 0, 0);

        bathyGl.bindBuffer(bathyGl.ARRAY_BUFFER, bathyMarkerMesh.cbo);
        bathyGl.enableVertexAttribArray(aColor);
        bathyGl.vertexAttribPointer(aColor, 3, bathyGl.FLOAT, false, 0, 0);

        bathyGl.bindBuffer(bathyGl.ELEMENT_ARRAY_BUFFER, bathyMarkerMesh.ibo);
        bathyGl.drawElements(bathyGl.TRIANGLES, bathyMarkerMesh.count, bathyGl.UNSIGNED_SHORT, 0);
      }
    }

    function initOrUpdateBathy3d(data) {
      bathy3dData = data;
      if (!bathyGl) initBathy3dEngine();
      if (!bathyGl) return;

      rebuildBathyPipeMesh(data.points);
      buildBathySeabedGrid(data.points);
      buildBathyMarkers(data.points);
      resetBathyCamera();
    }

    function updateBathyFrame(idx) {
      if (!bathy3dData || !bathy3dData.allProfiles || bathy3dData.allProfiles.length === 0) return;
      const profIdx = Math.min(idx, bathy3dData.allProfiles.length - 1);
      const prof = bathy3dData.allProfiles[profIdx];
      if (!prof) return;

      updateBathyFromProfileSnapshot(prof);
    }

    function updateBathyFromProfileSnapshot(prof) {
      if (!bathy3dData || !bathy3dData.points) return;
      const pts = bathy3dData.points;
      const numPos = prof.liquidHoldup ? prof.liquidHoldup.length : 0;
      if (numPos === 0) return;

      for (let i = 0; i < pts.length; i++) {
        const pIdx = Math.min(i, numPos - 1);
        if (prof.liquidHoldup && prof.liquidHoldup[pIdx] !== undefined) pts[i].holdup = prof.liquidHoldup[pIdx];
        if (prof.pressureBar && prof.pressureBar[pIdx] !== undefined) pts[i].pressureBar = prof.pressureBar[pIdx];
        if (prof.temperatureC && prof.temperatureC[pIdx] !== undefined) pts[i].tempC = prof.temperatureC[pIdx];
      }

      rebuildBathyPipeMesh(pts);
      requestBathyRender();
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
