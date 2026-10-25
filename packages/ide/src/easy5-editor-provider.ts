// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * EASY5 Dynamic Simulation & Linear Control Dual-Mode Custom Editor Provider.
 *
 * Provides a rich, interactive visual workspace for control engineers:
 *   1. Interactive Schematic Diagram View with pan/zoom controls and SVG export.
 *   2. Linear Control Systems View: State-Space (A, B, C, D) matrices,
 *      eigenvalues/poles stability table, and logarithmic Bode magnitude/phase plots.
 *   3. High-density Tabular Component & Connection Netlist with search/filtering.
 *   4. Pre-flight linter diagnostics banner (M7001–M7012).
 *   5. Instant cross-language projections to Modelica 3.x and FMI 2.0/3.0 SSP XML.
 */

import {
  computeBodePlot,
  computeEigenvalues,
  easy5ToModelica,
  easy5ToSsp,
  linearizeEasy5,
  lintEasy5,
  parseEasy5,
  renderEasy5SchematicSvg,
} from "@modelscript/easy5";

import * as vscode from "vscode";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export class Easy5EditorProvider extends BaseCustomEditorProvider {
  static readonly viewType = "modelscript.easy5Editor";

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
        const model = parseEasy5(text);
        const diags = lintEasy5(model);
        const svg = renderEasy5SchematicSvg(model);
        const sys = linearizeEasy5(model);
        const eigenvalues = computeEigenvalues(sys.A);
        const bode = computeBodePlot(sys, { minFreqRadS: 0.01, maxFreqRadS: 1000.0, points: 50 });
        const modelicaCode = easy5ToModelica(model);
        const sspXml = easy5ToSsp(model);

        const compList = Array.from(model.components.values());

        webviewPanel.webview.postMessage({
          type: "update",
          name: model.name,
          title: model.title,
          components: compList,
          connections: model.connections,
          sys,
          eigenvalues,
          bode,
          svg,
          diagnostics: diags,
          modelicaCode,
          sspXml,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        webviewPanel.webview.postMessage({
          type: "error",
          message: `Failed to parse EASY5 model: ${message}`,
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
            const model = parseEasy5(document.getText());
            const svg = renderEasy5SchematicSvg(model);
            const saveUri = await vscode.window.showSaveDialog({
              filters: { "Scalable Vector Graphics (*.svg)": ["svg"] },
              defaultUri: vscode.Uri.file(`${model.name || "schematic"}.svg`),
            });
            if (saveUri) {
              await vscode.workspace.fs.writeFile(saveUri, Buffer.from(svg, "utf-8"));
              vscode.window.showInformationMessage(`Exported Schematic SVG to ${saveUri.fsPath}`);
            }
          } catch (e: unknown) {
            vscode.window.showErrorMessage(`Failed to export SVG: ${e}`);
          }
          break;
        }

        case "exportModelica": {
          try {
            const model = parseEasy5(document.getText());
            const mo = easy5ToModelica(model);
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
            const model = parseEasy5(document.getText());
            const ssd = easy5ToSsp(model);
            const doc = await vscode.workspace.openTextDocument({
              content: ssd,
              language: "xml",
            });
            await vscode.window.showTextDocument(doc);
          } catch (e: unknown) {
            vscode.window.showErrorMessage(`Failed to project to FMI SSP: ${e}`);
          }
          break;
        }

        case "copyText": {
          if (msg.text) {
            await vscode.env.clipboard.writeText(msg.text);
            vscode.window.showInformationMessage(msg.message ?? "Copied to clipboard");
          }
          break;
        }

        case "showInfo":
          if (msg.message) {
            vscode.window.showInformationMessage(msg.message);
          }
          break;
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
  <title>EASY5 Model Editor</title>
  <style>
    :root {
      --bg-primary: var(--vscode-editor-background, #1e1e1e);
      --bg-secondary: var(--vscode-sideBar-background, #252526);
      --bg-tertiary: var(--vscode-editorWidget-background, #2d2d2d);
      --text-main: var(--vscode-foreground, #cccccc);
      --text-dim: var(--vscode-descriptionForeground, #858585);
      --accent: var(--vscode-button-background, #0e639c);
      --accent-hover: var(--vscode-button-hoverBackground, #1177bb);
      --border: var(--vscode-editorGroup-border, #3c3c3c);
      --card-bg: var(--vscode-sideBar-background, #252526);
      --success: #4ec9b0;
      --warning: #cca700;
      --error: #f14c4c;
      --table-header: var(--vscode-list-hoverBackground, #2a2d2e);
      --table-row-alt: rgba(255, 255, 255, 0.02);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--text-main);
      background-color: var(--bg-primary);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Top Bar */
    header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 10px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .badge-icon {
      background: var(--accent);
      color: #fff;
      font-weight: 700;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 4px;
      letter-spacing: 0.5px;
    }
    h1 {
      font-size: 15px;
      font-weight: 600;
      color: #fff;
    }
    .header-subtitle {
      font-size: 12px;
      color: var(--text-dim);
    }
    .header-stats {
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 12px;
    }
    .stat-pill {
      background: var(--bg-tertiary);
      padding: 3px 10px;
      border-radius: 12px;
      border: 1px solid var(--border);
    }
    .stat-pill strong { color: #fff; }

    /* Tab navigation */
    nav.tab-bar {
      display: flex;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 0 16px;
      flex-shrink: 0;
      gap: 4px;
    }
    .tab-btn {
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-dim);
      padding: 9px 14px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .tab-btn:hover {
      color: var(--text-main);
    }
    .tab-btn.active {
      color: #fff;
      border-bottom-color: var(--accent);
      font-weight: 600;
    }

    /* Main view area */
    main.view-area {
      flex: 1;
      overflow: hidden;
      position: relative;
    }
    .tab-pane {
      display: none;
      width: 100%;
      height: 100%;
      overflow: auto;
      padding: 16px;
    }
    .tab-pane.active {
      display: flex;
      flex-direction: column;
    }

    /* Diagram Tab */
    #tab-diagram {
      padding: 0;
      position: relative;
      background: #141414;
    }
    .diagram-toolbar {
      position: absolute;
      top: 12px;
      right: 16px;
      z-index: 10;
      display: flex;
      gap: 6px;
      background: rgba(30, 30, 30, 0.85);
      backdrop-filter: blur(4px);
      padding: 4px 6px;
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .btn {
      background: var(--bg-tertiary);
      color: var(--text-main);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 5px 10px;
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .btn:hover {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .diagram-viewport {
      width: 100%;
      height: 100%;
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
    }
    .diagram-viewport svg {
      max-width: none;
      transform-origin: center center;
      transition: transform 0.1s ease-out;
    }

    /* Tables & Grids */
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      margin-bottom: 16px;
    }
    .table-header {
      padding: 10px 14px;
      background: var(--table-header);
      font-weight: 600;
      font-size: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      text-align: left;
    }
    table.data-table th {
      background: var(--table-header);
      padding: 8px 12px;
      color: var(--text-dim);
      font-weight: 600;
      border-bottom: 1px solid var(--border);
    }
    table.data-table td {
      padding: 7px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    table.data-table tr:hover {
      background: rgba(255, 255, 255, 0.03);
    }
    .tag {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .tag-stable { background: rgba(78, 201, 176, 0.2); color: var(--success); }
    .tag-unstable { background: rgba(241, 76, 76, 0.2); color: var(--error); }
    .tag-warn { background: rgba(204, 167, 0, 0.2); color: var(--warning); }

    /* Linear Control Cards */
    .grid-2col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    .matrix-box {
      background: #181818;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      white-space: pre;
      overflow-x: auto;
      line-height: 1.4;
      color: #9cdcfe;
    }

    /* Diagnostics Banner */
    .diag-banner {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 16px;
    }
    .diag-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 12px;
    }

    /* Projections Code Box */
    .code-box {
      background: #141414;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      white-space: pre;
      overflow: auto;
      color: #ce9178;
      max-height: 280px;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <span class="badge-icon">EASY5</span>
      <div>
        <h1 id="model-name">Loading Model...</h1>
        <div class="header-subtitle" id="model-title">Boeing / MSC Continuous Dynamic System</div>
      </div>
    </div>
    <div class="header-stats">
      <div class="stat-pill">Components: <strong id="stat-components">0</strong></div>
      <div class="stat-pill">States: <strong id="stat-states">0</strong></div>
      <div class="stat-pill">Connections: <strong id="stat-conns">0</strong></div>
      <div class="stat-pill" id="stat-diag-pill">Status: <strong id="stat-diag">Checking...</strong></div>
    </div>
  </header>

  <nav class="tab-bar">
    <button class="tab-btn active" data-tab="diagram">Schematic Diagram</button>
    <button class="tab-btn" data-tab="linear">Linear Control &amp; Bode</button>
    <button class="tab-btn" data-tab="components">Components &amp; Netlist</button>
    <button class="tab-btn" data-tab="diagnostics">Diagnostics (<span id="diag-count">0</span>)</button>
    <button class="tab-btn" data-tab="projections">Projections &amp; Export</button>
  </nav>

  <main class="view-area">
    <!-- Tab 1: Schematic Diagram -->
    <div class="tab-pane active" id="tab-diagram">
      <div class="diagram-toolbar">
        <button class="btn" id="btn-zoom-in">＋ Zoom In</button>
        <button class="btn" id="btn-zoom-out">－ Zoom Out</button>
        <button class="btn" id="btn-zoom-reset">Reset</button>
        <button class="btn" id="btn-export-svg">Export SVG</button>
      </div>
      <div class="diagram-viewport" id="svg-viewport">
        <div id="svg-container"></div>
      </div>
    </div>

    <!-- Tab 2: Linear Control & Bode -->
    <div class="tab-pane" id="tab-linear">
      <div class="grid-2col">
        <div class="table-container">
          <div class="table-header">State Space Matrices (A, B)</div>
          <div style="padding: 10px;">
            <div style="font-size: 11px; color: var(--text-dim); margin-bottom: 4px;">Matrix A (dx/dt = A x + B u):</div>
            <div class="matrix-box" id="matrix-a">[ 0.0 ]</div>
            <div style="font-size: 11px; color: var(--text-dim); margin: 8px 0 4px 0;">Matrix B:</div>
            <div class="matrix-box" id="matrix-b">[ 0.0 ]</div>
          </div>
        </div>

        <div class="table-container">
          <div class="table-header">Output Matrices (C, D)</div>
          <div style="padding: 10px;">
            <div style="font-size: 11px; color: var(--text-dim); margin-bottom: 4px;">Matrix C (y = C x + D u):</div>
            <div class="matrix-box" id="matrix-c">[ 0.0 ]</div>
            <div style="font-size: 11px; color: var(--text-dim); margin: 8px 0 4px 0;">Matrix D:</div>
            <div class="matrix-box" id="matrix-d">[ 0.0 ]</div>
          </div>
        </div>
      </div>

      <div class="table-container">
        <div class="table-header">System Eigenvalues &amp; Closed-Loop Poles</div>
        <table class="data-table" id="eigs-table">
          <thead>
            <tr>
              <th>Pole Real</th>
              <th>Pole Imag</th>
              <th>Magnitude</th>
              <th>Freq (rad/s)</th>
              <th>Freq (Hz)</th>
              <th>Damping (&zeta;)</th>
              <th>Stability</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>

      <div class="table-container">
        <div class="table-header">
          <span>Logarithmic Frequency Response (Bode Plot)</span>
          <select id="bode-channel-select" class="btn" style="padding: 2px 8px;"></select>
        </div>
        <div style="padding: 14px;" id="bode-plot-area">
          <div style="color: var(--text-dim); font-size: 12px; margin-bottom: 8px;">Magnitude (dB) &amp; Phase (deg) vs Log Frequency:</div>
          <div id="bode-chart-svg"></div>
        </div>
      </div>
    </div>

    <!-- Tab 3: Components & Netlist -->
    <div class="tab-pane" id="tab-components">
      <div class="table-container">
        <div class="table-header">Component Declarations</div>
        <table class="data-table" id="comp-table">
          <thead>
            <tr>
              <th>Component ID</th>
              <th>Library Type</th>
              <th>Title / Description</th>
              <th>Parameters (XP)</th>
              <th>Initial States (S0)</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>

      <div class="table-container">
        <div class="table-header">Inter-Block Connections</div>
        <table class="data-table" id="conn-table">
          <thead>
            <tr>
              <th>From Block</th>
              <th>From Port</th>
              <th></th>
              <th>To Block</th>
              <th>To Port</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <!-- Tab 4: Diagnostics -->
    <div class="tab-pane" id="tab-diagnostics">
      <div class="diag-banner">
        <h3 style="margin-bottom: 8px; font-size: 13px;">Pre-flight Topology &amp; Numerical Linter</h3>
        <div id="diag-list"></div>
      </div>
    </div>

    <!-- Tab 5: Projections & Export -->
    <div class="tab-pane" id="tab-projections">
      <div class="table-container" style="margin-bottom: 20px;">
        <div class="table-header">
          <span>Modelica 3.x Continuous Blocks Projection</span>
          <button class="btn" id="btn-export-modelica">Open in New Editor</button>
        </div>
        <div style="padding: 10px;">
          <div class="code-box" id="code-modelica">// Generated Modelica code...</div>
        </div>
      </div>

      <div class="table-container">
        <div class="table-header">
          <span>FMI System Structure Description (SystemStructure.ssd XML)</span>
          <button class="btn" id="btn-export-ssp">Open in New Editor</button>
        </div>
        <div style="padding: 10px;">
          <div class="code-box" id="code-ssp">&lt;!-- Generated SSP XML... --&gt;</div>
        </div>
      </div>
    </div>
  </main>

  <script>
    const vscode = acquireVsCodeApi();

    // Zoom state
    let zoomLevel = 1.0;
    const svgContainer = document.getElementById("svg-container");

    // Tab switching
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        const targetId = "tab-" + btn.getAttribute("data-tab");
        const pane = document.getElementById(targetId);
        if (pane) pane.classList.add("active");
      });
    });

    // Zoom controls
    document.getElementById("btn-zoom-in").addEventListener("click", () => {
      zoomLevel = Math.min(zoomLevel * 1.2, 5.0);
      svgContainer.style.transform = "scale(" + zoomLevel + ")";
    });
    document.getElementById("btn-zoom-out").addEventListener("click", () => {
      zoomLevel = Math.max(zoomLevel / 1.2, 0.2);
      svgContainer.style.transform = "scale(" + zoomLevel + ")";
    });
    document.getElementById("btn-zoom-reset").addEventListener("click", () => {
      zoomLevel = 1.0;
      svgContainer.style.transform = "scale(1.0)";
    });

    // Export button actions
    document.getElementById("btn-export-svg").addEventListener("click", () => {
      vscode.postMessage({ type: "exportSvg" });
    });
    document.getElementById("btn-export-modelica").addEventListener("click", () => {
      vscode.postMessage({ type: "exportModelica" });
    });
    document.getElementById("btn-export-ssp").addEventListener("click", () => {
      vscode.postMessage({ type: "exportSsp" });
    });

    let currentBodeData = null;

    document.getElementById("bode-channel-select").addEventListener("change", (e) => {
      renderBodeCurves(e.target.value);
    });

    function renderBodeCurves(channelIdxStr) {
      if (!currentBodeData || !currentBodeData.channels) return;
      const idx = parseInt(channelIdxStr, 10) || 0;
      const ch = currentBodeData.channels[idx];
      if (!ch) return;

      const freqs = currentBodeData.frequenciesRadS || [];
      if (freqs.length === 0) return;

      const w = 580;
      const hMag = 140;
      const hPhase = 140;
      const pad = 40;

      const minLog = Math.log10(freqs[0]);
      const maxLog = Math.log10(freqs[freqs.length - 1]);
      const logRange = maxLog - minLog || 1;

      // Magnitude bounds
      const minMag = Math.min(...ch.magnitudeDb);
      const maxMag = Math.max(...ch.magnitudeDb);
      const magRange = maxMag - minMag || 1;

      // Phase bounds
      const minPh = Math.min(...ch.phaseDeg);
      const maxPh = Math.max(...ch.phaseDeg);
      const phRange = maxPh - minPh || 1;

      let magPts = [];
      let phPts = [];
      for (let i = 0; i < freqs.length; i++) {
        const x = pad + ((Math.log10(freqs[i]) - minLog) / logRange) * (w - 2 * pad);
        const yMag = pad + hMag - 15 - ((ch.magnitudeDb[i] - minMag) / magRange) * (hMag - 30);
        const yPh = pad + hPhase - 15 - ((ch.phaseDeg[i] - minPh) / phRange) * (hPhase - 30);
        magPts.push(x.toFixed(1) + "," + yMag.toFixed(1));
        phPts.push(x.toFixed(1) + "," + yPh.toFixed(1));
      }

      const svgHtml =
        '<svg width="' + w + '" height="' + (hMag + hPhase + 40) + '" style="background:#181818; border-radius:6px;">' +
        '<text x="' + pad + '" y="24" fill="#4ec9b0" font-size="12" font-weight="600">Magnitude (dB): [' + minMag.toFixed(1) + ' to ' + maxMag.toFixed(1) + ' dB]</text>' +
        '<polyline fill="none" stroke="#4ec9b0" stroke-width="2" points="' + magPts.join(" ") + '" />' +
        '<g transform="translate(0, ' + (hMag + 20) + ')">' +
        '<text x="' + pad + '" y="24" fill="#9cdcfe" font-size="12" font-weight="600">Phase (deg): [' + minPh.toFixed(1) + '° to ' + maxPh.toFixed(1) + '°]</text>' +
        '<polyline fill="none" stroke="#9cdcfe" stroke-width="2" points="' + phPts.join(" ") + '" />' +
        '</g>' +
        '</svg>';

      document.getElementById("bode-chart-svg").innerHTML = svgHtml;
    }

    // Handle incoming messages from extension host
    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "update") {
        document.getElementById("model-name").textContent = msg.name || "EASY5 Model";
        document.getElementById("model-title").textContent = msg.title || "Boeing / MSC Continuous Dynamic System";
        document.getElementById("stat-components").textContent = (msg.components || []).length;
        document.getElementById("stat-conns").textContent = (msg.connections || []).length;

        // Count states
        let stateCount = 0;
        (msg.components || []).forEach((c) => {
          if (c.initialStates) stateCount += Object.keys(c.initialStates).length;
        });
        document.getElementById("stat-states").textContent = stateCount;

        // SVG diagram
        svgContainer.innerHTML = msg.svg || "";

        // Diagnostics
        const diags = msg.diagnostics || [];
        document.getElementById("diag-count").textContent = diags.length;
        const statDiag = document.getElementById("stat-diag");
        if (diags.length === 0) {
          statDiag.innerHTML = '<span class="tag tag-stable">✔ OK</span>';
        } else if (diags.some((d) => d.severity === "error")) {
          statDiag.innerHTML = '<span class="tag tag-unstable">✖ ' + diags.length + ' Issues</span>';
        } else {
          statDiag.innerHTML = '<span class="tag tag-warn">⚠ ' + diags.length + ' Warnings</span>';
        }

        const diagList = document.getElementById("diag-list");
        diagList.innerHTML = "";
        if (diags.length === 0) {
          diagList.innerHTML = '<div style="color:var(--success); padding:8px;">✔ No topological or parameter issues found.</div>';
        } else {
          diags.forEach((d) => {
            const item = document.createElement("div");
            item.className = "diag-item";
            const tagClass = d.severity === "error" ? "tag-unstable" : "tag-warn";
            item.innerHTML =
              '<span class="tag ' + tagClass + '">' + (d.code || "M7000") + '</span>' +
              '<span><strong>Line ' + (d.line || 1) + ':</strong> ' + d.message + '</span>';
            diagList.appendChild(item);
          });
        }

        // Matrices
        if (msg.sys) {
          const fmtMat = (M) => (M || []).map((r) => "[ " + r.map((v) => v.toFixed(4).padStart(8)).join(" ") + " ]").join("\\n");
          document.getElementById("matrix-a").textContent = fmtMat(msg.sys.A);
          document.getElementById("matrix-b").textContent = fmtMat(msg.sys.B);
          document.getElementById("matrix-c").textContent = fmtMat(msg.sys.C);
          document.getElementById("matrix-d").textContent = fmtMat(msg.sys.D);
        }

        // Eigenvalues
        const eigsTbody = document.querySelector("#eigs-table tbody");
        eigsTbody.innerHTML = "";
        (msg.eigenvalues || []).forEach((e) => {
          const tr = document.createElement("tr");
          const tag = e.isStable ? '<span class="tag tag-stable">Stable</span>' : '<span class="tag tag-unstable">Unstable</span>';
          tr.innerHTML =
            '<td>' + e.real.toFixed(5) + '</td>' +
            '<td>' + (e.imag >= 0 ? '+' : '') + e.imag.toFixed(5) + 'j</td>' +
            '<td>' + e.magnitude.toFixed(5) + '</td>' +
            '<td>' + e.frequencyRadS.toFixed(4) + '</td>' +
            '<td>' + e.frequencyHz.toFixed(4) + '</td>' +
            '<td>' + e.dampingRatio.toFixed(4) + '</td>' +
            '<td>' + tag + '</td>';
          eigsTbody.appendChild(tr);
        });

        // Bode
        currentBodeData = msg.bode;
        const sel = document.getElementById("bode-channel-select");
        sel.innerHTML = "";
        if (msg.bode && msg.bode.channels) {
          msg.bode.channels.forEach((ch, idx) => {
            const opt = document.createElement("option");
            opt.value = String(idx);
            opt.textContent = ch.inputName + " → " + ch.outputName;
            sel.appendChild(opt);
          });
          renderBodeCurves("0");
        }

        // Components table
        const compTbody = document.querySelector("#comp-table tbody");
        compTbody.innerHTML = "";
        (msg.components || []).forEach((c) => {
          const tr = document.createElement("tr");
          const pStr = Object.entries(c.parameters || {}).map(([k, v]) => k + '=' + JSON.stringify(v)).join(", ") || "-";
          const sStr = Object.entries(c.initialStates || {}).map(([k, v]) => k + '=' + v).join(", ") || "-";
          tr.innerHTML =
            '<td><strong>' + c.id + '</strong></td>' +
            '<td><span class="tag tag-stable">' + c.type + '</span></td>' +
            '<td>' + (c.title || "-") + '</td>' +
            '<td style="font-family:monospace; font-size:11px;">' + pStr + '</td>' +
            '<td style="font-family:monospace; font-size:11px;">' + sStr + '</td>';
          compTbody.appendChild(tr);
        });

        // Connections table
        const connTbody = document.querySelector("#conn-table tbody");
        connTbody.innerHTML = "";
        (msg.connections || []).forEach((c) => {
          const tr = document.createElement("tr");
          tr.innerHTML =
            '<td><strong>' + c.fromComponent + '</strong></td>' +
            '<td>' + c.fromPort + '</td>' +
            '<td style="color:var(--text-dim); text-align:center;">➔</td>' +
            '<td><strong>' + c.toComponent + '</strong></td>' +
            '<td>' + c.toPort + '</td>';
          connTbody.appendChild(tr);
        });

        // Projections
        document.getElementById("code-modelica").textContent = msg.modelicaCode || "// No code";
        document.getElementById("code-ssp").textContent = msg.sspXml || "<!-- No XML -->";
      }
    });

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
  }
}
