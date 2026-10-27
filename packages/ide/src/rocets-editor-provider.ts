// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * NASA ROCETS Liquid Rocket Propulsion Dual-Mode Custom Editor Provider.
 *
 * Provides a rich, interactive visual workspace for propulsion engineers:
 *   1. Interactive P&ID Vector Flow Diagram View with propellant color coding and SVG export.
 *   2. Steady-State Engine Balance View: Shaft power conservation, mass flow rates,
 *      throat conditions, vacuum/SL thrust, and specific impulse.
 *   3. Dynamic Start Transient View: Ignition filling, rotor spinup, and wall heating trajectories.
 *   4. High-density Tabular Propulsion Modules & Feed Netlist with search/filtering.
 *   5. Pre-flight linter diagnostics banner (M8001–M8014).
 *   6. Instant cross-language projections to Modelica 3.x and FMI 2.0/3.0 SSP XML.
 */

import {
  lintRocets,
  parseRocetsDeck,
  renderRocetsPidSvg,
  rocetsToModelica,
  rocetsToSsp,
  simulateRocetsTransient,
  solveRocetsBalance,
} from "@modelscript/rocets";

import * as vscode from "vscode";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export class RocetsEditorProvider extends BaseCustomEditorProvider {
  static readonly viewType = "modelscript.rocetsEditor";

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.configureWebview(webviewPanel);

    let disposed = false;
    webviewPanel.webview.html = this.getHtmlForWebview();

    const updateWebview = () => {
      if (disposed) return;
      try {
        const text = document.getText();
        const model = parseRocetsDeck(text);
        const diags = lintRocets(model);
        const svg = renderRocetsPidSvg(model);
        const balance = solveRocetsBalance(model);
        const transient = simulateRocetsTransient(model, { tEnd: 1.5, dt: 0.02 });
        const modelicaCode = rocetsToModelica(model);
        const sspXml = rocetsToSsp(model);

        const compList = Array.from(model.components.values());

        webviewPanel.webview.postMessage({
          type: "update",
          name: model.name,
          title: model.title,
          components: compList,
          connections: model.connections,
          balance,
          transient,
          svg,
          diagnostics: diags,
          modelicaCode,
          sspXml,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        webviewPanel.webview.postMessage({
          type: "error",
          message: `Failed to parse ROCETS engine deck: ${message}`,
        });
      }
    };

    // Initial update
    updateWebview();

    // Re-render when document changes
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    // Handle messages from the webview
    const msgSubscription = webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "ready":
          updateWebview();
          break;

        case "exportSvg": {
          try {
            const model = parseRocetsDeck(document.getText());
            const svg = renderRocetsPidSvg(model);
            const saveUri = await vscode.window.showSaveDialog({
              filters: { "Scalable Vector Graphics (*.svg)": ["svg"] },
              defaultUri: vscode.Uri.file(`${model.name || "propulsion_pid"}.svg`),
            });
            if (saveUri) {
              await vscode.workspace.fs.writeFile(saveUri, Buffer.from(svg, "utf-8"));
              vscode.window.showInformationMessage(`Exported P&ID SVG to ${saveUri.fsPath}`);
            }
          } catch (e: unknown) {
            vscode.window.showErrorMessage(`Failed to export SVG: ${e}`);
          }
          break;
        }

        case "exportModelica": {
          try {
            const model = parseRocetsDeck(document.getText());
            const mo = rocetsToModelica(model);
            const doc = await vscode.workspace.openTextDocument({
              content: mo,
              language: "modelica",
            });
            await vscode.window.showTextDocument(doc);
          } catch (e: unknown) {
            vscode.window.showErrorMessage(`Failed to project to Modelica: ${e}`);
          }
          break;
        }

        case "exportSsp": {
          try {
            const model = parseRocetsDeck(document.getText());
            const xml = rocetsToSsp(model);
            const doc = await vscode.workspace.openTextDocument({
              content: xml,
              language: "xml",
            });
            await vscode.window.showTextDocument(doc);
          } catch (e: unknown) {
            vscode.window.showErrorMessage(`Failed to project to SSP: ${e}`);
          }
          break;
        }

        case "jumpToLine": {
          const line = typeof msg.line === "number" ? msg.line - 1 : 0;
          const editor = vscode.window.visibleTextEditors.find(
            (ed) => ed.document.uri.toString() === document.uri.toString(),
          );
          if (editor) {
            const pos = new vscode.Position(Math.max(0, line), 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          }
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

  protected getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' 'unsafe-eval' https:; connect-src https: http: ws: wss:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ROCETS Liquid Rocket Propulsion Editor</title>
  <style>
    :root {
      --bg: #11111b;
      --card-bg: #181825;
      --card-border: #313244;
      --accent: #89dceb;
      --accent-flame: #f38ba8;
      --text: #cdd6f4;
      --text-muted: #a6adc8;
      --error: #f38ba8;
      --warning: #f9e2af;
      --success: #a6e3a1;
      --font-mono: 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    /* Toolbar */
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: var(--card-bg);
      border-bottom: 1px solid var(--card-border);
      flex-shrink: 0;
    }
    .model-info { display: flex; align-items: center; gap: 12px; }
    .model-name { font-size: 15px; font-weight: 700; color: var(--accent); }
    .model-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 12px;
      background: #313244;
      color: var(--text-muted);
    }
    .nav-tabs { display: flex; gap: 4px; }
    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: all 0.15s ease;
    }
    .tab-btn:hover { background: rgba(255,255,255,0.05); color: var(--text); }
    .tab-btn.active {
      background: #313244;
      border-color: var(--accent);
      color: var(--accent);
    }
    .actions { display: flex; gap: 8px; }
    .action-btn {
      background: #313244;
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .action-btn:hover { background: #45475a; }

    /* Diagnostic Banner */
    .diag-banner {
      padding: 8px 16px;
      background: rgba(243, 139, 168, 0.15);
      border-bottom: 1px solid var(--error);
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      flex-shrink: 0;
    }
    .diag-pill {
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
    }
    .diag-pill.error { background: var(--error); color: #111; }
    .diag-pill.warning { background: var(--warning); color: #111; }

    /* Main Tab Content */
    .tab-pane {
      display: none;
      flex: 1;
      overflow: auto;
      padding: 16px;
    }
    .tab-pane.active { display: flex; flex-direction: column; }

    /* Diagram Pane */
    #pane-diagram {
      padding: 0;
      background: #11111b;
      position: relative;
    }
    #svg-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
    }
    #svg-container svg { max-width: 100%; max-height: 100%; }

    /* Metrics Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .metric-label { font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; }
    .metric-val { font-size: 20px; font-weight: 700; color: var(--accent); font-family: var(--font-mono); }
    .metric-sub { font-size: 11px; color: var(--text-muted); }

    /* Tables */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 12px;
    }
    .data-table th, .data-table td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid var(--card-border);
    }
    .data-table th {
      background: #1e1e2e;
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
    }
    .data-table tr:hover { background: rgba(255, 255, 255, 0.02); }

    /* Code View */
    .code-box {
      background: #181825;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 14px;
      font-family: var(--font-mono);
      font-size: 12px;
      white-space: pre;
      overflow: auto;
      flex: 1;
      color: #bac2de;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="model-info">
      <span class="model-name" id="model-name">Loading ROCETS Engine...</span>
      <span class="model-badge" id="module-count">0 Modules</span>
    </div>
    <div class="nav-tabs">
      <button class="tab-btn active" onclick="showTab('diagram')">P&amp;ID Schematic</button>
      <button class="tab-btn" onclick="showTab('balance')">Engine Balance</button>
      <button class="tab-btn" onclick="showTab('transient')">Start Transient</button>
      <button class="tab-btn" onclick="showTab('components')">Module Netlist</button>
      <button class="tab-btn" onclick="showTab('diagnostics')">Diagnostics (<span id="diag-count">0</span>)</button>
      <button class="tab-btn" onclick="showTab('projections')">Projections</button>
    </div>
    <div class="actions">
      <button class="action-btn" onclick="vscode.postMessage({ type: 'exportSvg' })">Export SVG</button>
      <button class="action-btn" onclick="vscode.postMessage({ type: 'exportModelica' })">Modelica</button>
      <button class="action-btn" onclick="vscode.postMessage({ type: 'exportSsp' })">SSP SSD</button>
    </div>
  </div>

  <div class="diag-banner" id="diag-banner" style="display: none;">
    <span class="diag-pill error">DIAGNOSTIC</span>
    <span id="banner-text">Errors detected in ROCETS model deck</span>
  </div>

  <!-- P&ID Diagram Pane -->
  <div class="tab-pane active" id="pane-diagram">
    <div id="svg-container"></div>
  </div>

  <!-- Engine Balance Pane -->
  <div class="tab-pane" id="pane-balance">
    <div class="metrics-grid">
      <div class="metric-card">
        <span class="metric-label">Chamber Pressure (Pc)</span>
        <span class="metric-val" id="metric-pc">0.00 MPa</span>
        <span class="metric-sub">Combustion chamber throat stagnation</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Mixture Ratio (O/F)</span>
        <span class="metric-val" id="metric-mr">0.00</span>
        <span class="metric-sub">Oxidizer to fuel mass fraction</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Total Mass Flow</span>
        <span class="metric-val" id="metric-mdot">0.00 kg/s</span>
        <span class="metric-sub" id="metric-mdot-split">Ox: 0 / Fuel: 0</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Shaft Speed</span>
        <span class="metric-val" id="metric-rpm">0 RPM</span>
        <span class="metric-sub">Turbopump rotor rotation</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Vacuum Thrust</span>
        <span class="metric-val" id="metric-thrust-vac">0.0 kN</span>
        <span class="metric-sub" id="metric-thrust-sl">Sea Level: 0.0 kN</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Specific Impulse</span>
        <span class="metric-val" id="metric-isp-vac">0.0 s</span>
        <span class="metric-sub" id="metric-isp-sl">Sea Level: 0.0 s</span>
      </div>
    </div>

    <h3 style="margin-top: 12px; margin-bottom: 8px; font-size: 13px;">Turbomachinery Shaft Power Conservation</h3>
    <table class="data-table" id="powers-table">
      <thead>
        <tr>
          <th>Component</th>
          <th>Type</th>
          <th>Power (kW)</th>
          <th>Discharge Pressure (MPa)</th>
          <th>Temperature (K)</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </div>

  <!-- Transient Simulation Pane -->
  <div class="tab-pane" id="pane-transient">
    <h3 style="margin-bottom: 8px; font-size: 13px;">Ignition &amp; Throttle Transient Trajectory</h3>
    <table class="data-table" id="transient-table">
      <thead>
        <tr>
          <th>Time (s)</th>
          <th>Pc (MPa)</th>
          <th>Thrust (kN)</th>
          <th>Shaft Speed (RPM)</th>
          <th>Wall Temp (K)</th>
          <th>Mass Flow (kg/s)</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </div>

  <!-- Components Netlist Pane -->
  <div class="tab-pane" id="pane-components">
    <h3 style="margin-bottom: 8px; font-size: 13px;">Propulsion Modules</h3>
    <table class="data-table" id="components-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Type</th>
          <th>Title</th>
          <th>Declared Ports</th>
          <th>Parameters</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </div>

  <!-- Diagnostics Pane -->
  <div class="tab-pane" id="pane-diagnostics">
    <h3 style="margin-bottom: 8px; font-size: 13px;">Pre-Flight Propulsion Verification</h3>
    <table class="data-table" id="diagnostics-table">
      <thead>
        <tr>
          <th>Code</th>
          <th>Severity</th>
          <th>Module</th>
          <th>Message</th>
          <th>Line</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  </div>

  <!-- Projections Pane -->
  <div class="tab-pane" id="pane-projections">
    <div style="display: flex; gap: 12px; flex: 1; height: 100%;">
      <div style="flex: 1; display: flex; flex-direction: column;">
        <h4 style="margin-bottom: 6px; font-size: 12px;">Modelica 3.x Continuous Model</h4>
        <div class="code-box" id="code-modelica"></div>
      </div>
      <div style="flex: 1; display: flex; flex-direction: column;">
        <h4 style="margin-bottom: 6px; font-size: 12px;">FMI SystemStructure.ssd XML</h4>
        <div class="code-box" id="code-ssp"></div>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentData = null;

    function showTab(id) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick')?.includes(id));
      if (activeBtn) activeBtn.classList.add('active');
      const pane = document.getElementById('pane-' + id);
      if (pane) pane.classList.add('active');
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'update') {
        currentData = msg;
        document.getElementById('model-name').textContent = msg.name || 'ROCETS Engine';
        document.getElementById('module-count').textContent = (msg.components?.length || 0) + ' Modules';

        // Diagram
        document.getElementById('svg-container').innerHTML = msg.svg || '<div style="color:#666;">No diagram</div>';

        // Diagnostics
        const diags = msg.diagnostics || [];
        document.getElementById('diag-count').textContent = diags.length;
        const banner = document.getElementById('diag-banner');
        if (diags.length > 0) {
          banner.style.display = 'flex';
          document.getElementById('banner-text').textContent = diags.length + ' diagnostic(s) detected: ' + diags[0].message;
        } else {
          banner.style.display = 'none';
        }

        const diagTbody = document.getElementById('diagnostics-table').querySelector('tbody');
        diagTbody.innerHTML = '';
        for (const d of diags) {
          const tr = document.createElement('tr');
          tr.style.cursor = 'pointer';
          tr.onclick = () => vscode.postMessage({ type: 'jumpToLine', line: d.line });
          tr.innerHTML = '<td><b>' + (d.id || d.code) + '</b></td>' +
            '<td><span class="diag-pill ' + (d.severity || 'error') + '">' + d.severity + '</span></td>' +
            '<td>' + (d.componentId || '-') + '</td>' +
            '<td>' + d.message + '</td>' +
            '<td>' + (d.line || '-') + '</td>';
          diagTbody.appendChild(tr);
        }

        // Balance Metrics
        if (msg.balance) {
          const b = msg.balance;
          document.getElementById('metric-pc').textContent = (b.chamberPressurePa / 1e6).toFixed(2) + ' MPa';
          document.getElementById('metric-mr').textContent = b.mixtureRatio.toFixed(2);
          document.getElementById('metric-mdot').textContent = b.totalMassFlowKgS.toFixed(2) + ' kg/s';
          document.getElementById('metric-mdot-split').textContent = 'Ox: ' + b.oxMassFlowKgS.toFixed(1) + ' / Fuel: ' + b.fuelMassFlowKgS.toFixed(1);
          document.getElementById('metric-rpm').textContent = b.shaftSpeedRpm.toFixed(0) + ' RPM';
          document.getElementById('metric-thrust-vac').textContent = (b.thrustVacN / 1e3).toFixed(1) + ' kN';
          document.getElementById('metric-thrust-sl').textContent = 'Sea Level: ' + (b.thrustSlN / 1e3).toFixed(1) + ' kN';
          document.getElementById('metric-isp-vac').textContent = b.ispVacSec.toFixed(1) + ' s';
          document.getElementById('metric-isp-sl').textContent = 'Sea Level: ' + b.ispSlSec.toFixed(1) + ' s';

          const pTbody = document.getElementById('powers-table').querySelector('tbody');
          pTbody.innerHTML = '';
          for (const [id, pow] of Object.entries(b.pumpPowersW || {})) {
            const tr = document.createElement('tr');
            const p = (b.componentPressuresPa?.[id] || 0) / 1e6;
            const t = (b.componentTemperaturesK?.[id] || 0).toFixed(0);
            tr.innerHTML = '<td><b>' + id + '</b></td><td>PUMP</td><td>' + (pow / 1e3).toFixed(1) + '</td><td>' + p.toFixed(2) + '</td><td>' + t + '</td>';
            pTbody.appendChild(tr);
          }
          for (const [id, pow] of Object.entries(b.turbinePowersW || {})) {
            const tr = document.createElement('tr');
            const p = (b.componentPressuresPa?.[id] || 0) / 1e6;
            const t = (b.componentTemperaturesK?.[id] || 0).toFixed(0);
            tr.innerHTML = '<td><b>' + id + '</b></td><td>TURBINE</td><td>' + (pow / 1e3).toFixed(1) + '</td><td>' + p.toFixed(2) + '</td><td>' + t + '</td>';
            pTbody.appendChild(tr);
          }
        }

        // Transient Table
        if (msg.transient?.times) {
          const tTbody = document.getElementById('transient-table').querySelector('tbody');
          tTbody.innerHTML = '';
          for (let i = 0; i < msg.transient.times.length; i += 10) {
            const tr = document.createElement('tr');
            const t = msg.transient.times[i];
            const p = (msg.transient.pcPa[i] / 1e6).toFixed(2);
            const th = (msg.transient.thrustN[i] / 1e3).toFixed(1);
            const r = msg.transient.speedRpm[i].toFixed(0);
            const w = msg.transient.wallTempK[i].toFixed(0);
            const m = msg.transient.mdotKgS[i].toFixed(2);
            tr.innerHTML = '<td>' + t.toFixed(2) + '</td><td>' + p + '</td><td>' + th + '</td><td>' + r + '</td><td>' + w + '</td><td>' + m + '</td>';
            tTbody.appendChild(tr);
          }
        }

        // Module Netlist
        const compTbody = document.getElementById('components-table').querySelector('tbody');
        compTbody.innerHTML = '';
        for (const c of msg.components || []) {
          const tr = document.createElement('tr');
          const ports = Object.keys(c.ports || {}).join(', ');
          const params = Object.entries(c.parameters || {}).map(([k, v]) => k + '=' + v).join(', ');
          tr.innerHTML = '<td><b>' + c.id + '</b></td><td>' + c.type + '</td><td>' + (c.title || '') + '</td><td>' + ports + '</td><td>' + params + '</td>';
          compTbody.appendChild(tr);
        }

        // Projections
        document.getElementById('code-modelica').textContent = msg.modelicaCode || '';
        document.getElementById('code-ssp').textContent = msg.sspXml || '';
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
