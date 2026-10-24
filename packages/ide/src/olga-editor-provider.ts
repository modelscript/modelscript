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

import { renderOlgaElevationProfileSvg, renderOlgaSchematicSvg } from "@modelscript/diagram/olga-diagram-builder";
import {
  calculateHydrateDepression,
  calculateInhibitorDosing,
  evaluatePipelineCooldown,
  lintOlgaModel,
  parseOlga,
  projectOlgaToSysml2,
  simulateDriftFlux,
  verifyFlowAssuranceLimits,
  type FlowAssuranceLimits,
  type OlgaModel,
  type OlgaSimulationResult,
} from "@modelscript/olga";
import * as vscode from "vscode";

export class OlgaEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "modelscript.olgaEditor";

  constructor(private readonly context: vscode.ExtensionContext) {}

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
    webviewPanel.webview.html = this.getHtmlForWebview();

    let cachedModel: OlgaModel | null = null;
    let cachedSimResult: OlgaSimulationResult | null = null;

    const updateWebview = (customDuration?: number) => {
      if (disposed) return;
      try {
        const text = document.getText();
        const model = parseOlga(text);
        cachedModel = model;

        const duration = customDuration ?? Math.min(model.endTime - model.startTime, 3600);
        const simResult = simulateDriftFlux(model, {
          durationSeconds: duration,
          timeStepSeconds: model.maxDt,
        });
        cachedSimResult = simResult;

        const diagnostics = lintOlgaModel(model);
        const limits: FlowAssuranceLimits = {
          maop: 250e5,
          hydrateMarginKelvin: 3.0,
          slugCatcherLiquidCapacity: 150.0,
          minGasVelocity: 0.5,
        };
        const verification = verifyFlowAssuranceLimits(model, limits);

        const profileSvg = renderOlgaElevationProfileSvg(model, simResult);
        const schematicSvg = renderOlgaSchematicSvg(model);

        // Run default cooldown assessment
        const cooldown = evaluatePipelineCooldown({
          innerDiameter: model.flowpaths[0]?.pipes[0]?.diameter ?? 0.254,
          pipeLength: model.flowpaths[0]?.pipes.reduce((acc, p) => acc + p.length, 0) ?? 1000.0,
          initialTemperatureK: model.nodes[0]?.temperature ?? 333.15,
          ambientTemperatureK: 277.15,
          shutInPressurePa: model.nodes[0]?.pressure ?? 100e5,
          liquidHoldup: 0.35,
          heatTransfer: model.flowpaths[0]?.heatTransfer,
        });

        // Run default inhibitor assessment
        const megDepressionK = calculateHydrateDepression(30.0, "MEG");
        const inhibitorDosing = calculateInhibitorDosing(model.nodes[0]?.pressure ?? 100e5, 277.15, 1500.0, "MEG");

        webviewPanel.webview.postMessage({
          type: "update",
          data: {
            title: model.title,
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
            verification,
            diagnostics,
            cooldown,
            inhibition: {
              megDepressionK,
              dosingRateKgH: inhibitorDosing.injectionMassRateKgPerHour,
              requiredWtPercent: inhibitorDosing.requiredInhibitorWeightPercent,
            },
            profileSvg,
            schematicSvg,
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
          const svgContent =
            msg.view === "schematic"
              ? renderOlgaSchematicSvg(cachedModel)
              : renderOlgaElevationProfileSvg(cachedModel, cachedSimResult);
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
          } catch (e: any) {
            vscode.window.showErrorMessage(`SysML v2 projection failed: ${e.message}`);
          }
          break;
        }

        case "requestSnapshot": {
          if (!cachedModel || !cachedSimResult) return;
          const idx = Number(msg.snapshotIndex);
          const newSvg = renderOlgaElevationProfileSvg(cachedModel, cachedSimResult, idx);
          webviewPanel.webview.postMessage({
            type: "snapshotSvg",
            svg: newSvg,
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
      <button onclick="switchTab('schematicTab')">Schematic P&ID</button>
      <button onclick="switchTab('verificationTab')">Flow Assurance</button>
      <button onclick="switchTab('thermalTab')">Thermal & Dosing</button>
      <button onclick="switchTab('diagnosticsTab')">Diagnostics</button>
    </div>

    <!-- Actions -->
    <div class="header-actions">
      <button onclick="exportActiveSvg()">Export SVG</button>
      <button onclick="exportTrajectoryCsv()">Export CSV</button>
      <button class="primary" onclick="projectSysml()">To SysML v2</button>
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

    <!-- Tab 2: Schematic Flowline -->
    <div id="schematicTab" class="tab-view">
      <div class="svg-container" id="schematicSvgContainer">Loading Schematic...</div>
    </div>

    <!-- Tab 3: Flow Assurance Limits Verification -->
    <div id="verificationTab" class="tab-view">
      <div class="card-grid" id="verificationCards"></div>
    </div>

    <!-- Tab 4: Thermal & Dosing -->
    <div id="thermalTab" class="tab-view">
      <div class="card-grid" id="thermalCards"></div>
    </div>

    <!-- Tab 5: Pre-Flight Diagnostics -->
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

    function switchTab(tabId) {
      activeTabId = tabId;
      document.querySelectorAll('.tab-view').forEach(t => t.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      document.querySelectorAll('.segmented-control button').forEach((b, idx) => {
        b.classList.toggle('active', ['profileTab', 'schematicTab', 'verificationTab', 'thermalTab', 'diagnosticsTab'][idx] === tabId);
      });
    }

    function exportActiveSvg() {
      vscode.postMessage({
        type: 'exportSvg',
        view: activeTabId === 'schematicTab' ? 'schematic' : 'profile',
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

      // Request new SVG frame snapshot
      vscode.postMessage({
        type: 'requestSnapshot',
        snapshotIndex: idx,
      });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'snapshotSvg') {
        document.getElementById('profileSvgContainer').innerHTML = msg.svg;
        return;
      }

      if (msg.type === 'update') {
        currentData = msg.data;
        document.getElementById('modelTitle').textContent = currentData.title;

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
        document.getElementById('schematicSvgContainer').innerHTML = currentData.schematicSvg;

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

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
