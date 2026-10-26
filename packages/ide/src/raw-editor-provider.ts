// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSS/E RAW Base Case Dual-Mode Visual Custom Editor Provider.
 *
 * Provides a dual-mode visual workspace for power system engineers:
 *   1. Interactive Single-Line Diagram (SLD) View with voltage-tier styling,
 *      pan/zoom controls, and equipment inspection.
 *   2. High-density Tabular Grid View for Buses, Generators, Branches,
 *      Transformers, Loads, and Shunts with live search/filter.
 *   3. Pre-flight electrical topology & bounds diagnostics banner.
 *   4. Export actions for SVG, Modelica projection, and PSCAD/EMT netlists.
 */

import { renderPsseSvg } from "@modelscript/diagram/psse-diagram-builder";
import {
  extractPowerFlowNetlist,
  lintPsse,
  parseRaw,
  psseToEmtNetlist,
  psseToModelica,
  solvePowerFlow,
} from "@modelscript/psse";

import * as vscode from "vscode";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export class RawEditorProvider extends BaseCustomEditorProvider {
  static readonly viewType = "modelscript.rawEditor";

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
        const parsed = parseRaw(text);
        const diags = lintPsse(parsed);
        const netlist = extractPowerFlowNetlist(parsed);
        const svg = renderPsseSvg(parsed);
        const powerflow = solvePowerFlow(parsed);

        // Serialize bus map into array for webview tables
        const busList = Array.from(parsed.buses.values());

        webviewPanel.webview.postMessage({
          type: "update",
          header: parsed.header,
          title1: parsed.title1,
          title2: parsed.title2,
          buses: busList,
          generators: parsed.generators,
          branches: parsed.branches,
          transformers: parsed.transformers,
          loads: parsed.loads,
          fixedShunts: parsed.fixedShunts,
          metrics: netlist.metrics,
          powerflow,
          diagnostics: diags,
          svg,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        webviewPanel.webview.postMessage({
          type: "error",
          message: `Failed to parse PSS/E RAW case: ${message}`,
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
          const text = document.getText();
          try {
            const parsed = parseRaw(text);
            const svg = renderPsseSvg(parsed);
            const saveUri = await vscode.window.showSaveDialog({
              filters: { "Scalable Vector Graphics (*.svg)": ["svg"] },
              defaultUri: vscode.Uri.file("grid.svg"),
            });
            if (saveUri) {
              await vscode.workspace.fs.writeFile(saveUri, Buffer.from(svg, "utf-8"));
              vscode.window.showInformationMessage(`Exported SLD SVG to ${saveUri.fsPath}`);
            }
          } catch (e: unknown) {
            vscode.window.showErrorMessage(`Failed to export SVG: ${e}`);
          }
          break;
        }

        case "exportModelica": {
          try {
            const parsed = parseRaw(document.getText());
            const modelicaCode = psseToModelica(parsed);
            const doc = await vscode.workspace.openTextDocument({
              content: modelicaCode,
              language: "modelica",
            });
            await vscode.window.showTextDocument(doc);
          } catch (e: unknown) {
            vscode.window.showErrorMessage(`Failed to project to Modelica: ${e}`);
          }
          break;
        }

        case "exportPscad": {
          try {
            const parsed = parseRaw(document.getText());
            const emtNetlist = psseToEmtNetlist(parsed);
            const jsonText = JSON.stringify(
              emtNetlist,
              (_key, val) => (val instanceof Map ? Object.fromEntries(val) : val),
              2,
            );

            const doc = await vscode.workspace.openTextDocument({
              content: jsonText,
              language: "json",
            });
            await vscode.window.showTextDocument(doc);
          } catch (e: unknown) {
            vscode.window.showErrorMessage(`Failed to project to PSCAD Netlist: ${e}`);
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
  <title>PSS/E Power Flow Case Editor</title>
  <style>
    :root {
      --bg-primary: var(--vscode-editor-background, #1e1e1e);
      --bg-secondary: var(--vscode-sideBar-background, #252526);
      --bg-tertiary: var(--vscode-editorWidget-background, #2d2d2d);
      --text-main: var(--vscode-foreground, #cccccc);
      --text-dim: var(--vscode-descriptionForeground, #858585);
      --accent: var(--vscode-focusBorder, #007fd4);
      --border: var(--vscode-panel-border, #3c3c3c);
      --success: #388e3c;
      --warning: #f57c00;
      --error: #d32f2f;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg-primary);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    /* Toolbar Header */
    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .header-info { display: flex; align-items: baseline; gap: 12px; }
    .header-title { font-size: 15px; font-weight: 600; color: #fff; }
    .header-meta { font-size: 11px; color: var(--text-dim); }
    .header-actions { display: flex; gap: 8px; align-items: center; }

    /* Button and Tab Controls */
    button {
      background: var(--bg-tertiary);
      color: var(--text-main);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 12px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    button:hover { background: var(--accent); color: #fff; border-color: var(--accent); }
    button.active { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 500; }

    .segmented-control {
      display: flex;
      background: var(--bg-primary);
      padding: 2px;
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .segmented-control button {
      border: none;
      border-radius: 4px;
      padding: 4px 12px;
    }

    /* KPI Summary Row */
    .kpi-row {
      display: flex;
      gap: 12px;
      padding: 8px 16px;
      background: var(--bg-primary);
      border-bottom: 1px solid var(--border);
      overflow-x: auto;
      flex-shrink: 0;
    }
    .kpi-chip {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 10px;
      display: flex;
      flex-direction: column;
      min-width: 100px;
    }
    .kpi-label { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi-value { font-size: 14px; font-weight: 600; color: #fff; margin-top: 2px; }

    /* Diagnostics Banner */
    .diag-banner {
      padding: 6px 16px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .diag-banner.clean { background: rgba(56, 142, 60, 0.15); color: #81c784; }
    .diag-banner.issues { background: rgba(211, 47, 47, 0.15); color: #ef9a9a; }

    /* Main Content Area */
    .content-area {
      flex: 1;
      display: flex;
      overflow: hidden;
      position: relative;
    }
    .view-pane {
      display: none;
      width: 100%;
      height: 100%;
      overflow: auto;
    }
    .view-pane.active { display: flex; flex-direction: column; }

    /* SLD Diagram View */
    #sld-view {
      position: relative;
      background: #090d16;
      display: flex;
      flex-direction: column;
    }
    .sld-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 14px;
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
      flex-shrink: 0;
    }
    .sld-search-input {
      background: #020617;
      border: 1px solid #334155;
      color: #f8fafc;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      width: 220px;
    }
    .sld-search-input:focus { border-color: #38bdf8; outline: none; }
    .legend-group {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
      font-size: 11px;
      color: #94a3b8;
    }
    .legend-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 6px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .legend-dot { width: 8px; height: 8px; border-radius: 50%; }

    .sld-workspace {
      flex: 1;
      display: flex;
      position: relative;
      overflow: hidden;
    }
    .svg-container {
      flex: 1;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      background: #080c14;
      user-select: none;
    }
    .svg-container svg {
      max-width: 96%;
      max-height: 96%;
      filter: drop-shadow(0 4px 12px rgba(0,0,0,0.6));
      transform-origin: center center;
      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* Substation & Equipment Inspector Drawer */
    .inspector-drawer {
      width: 360px;
      background: #0f172a;
      border-left: 1px solid #1e293b;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 16px;
      gap: 14px;
      flex-shrink: 0;
      box-shadow: -4px 0 16px rgba(0,0,0,0.4);
    }
    .inspector-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1px solid #1e293b;
      padding-bottom: 10px;
    }
    .inspector-title { font-size: 14px; font-weight: 700; color: #f8fafc; }
    .inspector-subtitle { font-size: 11px; color: #94a3b8; margin-top: 2px; }
    .inspector-close {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 14px;
      padding: 2px 6px;
    }
    .inspector-close:hover { color: #f8fafc; background: rgba(255,255,255,0.1); }
    .card-panel {
      background: #0b1120;
      border: 1px solid #1e293b;
      border-radius: 6px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .panel-heading {
      font-size: 11px;
      font-weight: 700;
      color: #38bdf8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .telemetry-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .telemetry-item { display: flex; flex-direction: column; gap: 1px; }
    .telemetry-label { font-size: 10px; color: #64748b; text-transform: uppercase; }
    .telemetry-val { font-size: 13px; font-weight: 600; color: #f1f5f9; }
    .loading-bar-wrap {
      width: 100%;
      height: 6px;
      background: #1e293b;
      border-radius: 9999px;
      overflow: hidden;
      margin-top: 4px;
    }
    .loading-bar-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.3s ease;
    }

    /* Grid Tables View */
    .grid-tabs-bar {
      display: flex;
      gap: 6px;
      padding: 8px 16px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .filter-input {
      margin-left: auto;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      color: var(--text-main);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      width: 220px;
    }
    .table-container {
      flex: 1;
      overflow: auto;
      padding: 12px 16px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      padding: 6px 10px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      background: var(--bg-secondary);
      color: var(--text-dim);
      font-weight: 600;
      position: sticky;
      top: 0;
      z-index: 2;
    }
    tr.clickable-row { cursor: pointer; }
    tr.clickable-row:hover td { background: rgba(56, 189, 248, 0.08); }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 500;
    }
    .badge-slack { background: #ab47bc; color: #fff; }
    .badge-pv { background: #29b6f6; color: #000; }
    .badge-pq { background: #66bb6a; color: #000; }
  </style>
</head>
<body>
  <!-- Header Bar -->
  <div class="header-bar">
    <div class="header-info">
      <div class="header-title" id="case-title">PSS/E Base Case</div>
      <div class="header-meta" id="case-meta">Loading...</div>
    </div>
    <div class="header-actions">
      <div class="segmented-control">
        <button id="btn-mode-sld" class="active" onclick="switchView('sld')">⚡ SLD Diagram</button>
        <button id="btn-mode-grid" onclick="switchView('grid')">📋 Grid Tables</button>
      </div>
      <button onclick="exportAction('exportSvg')">📥 Export SVG</button>
      <button onclick="exportAction('exportModelica')">⚡ Modelica</button>
      <button onclick="exportAction('exportPscad')">🌐 PSCAD</button>
    </div>
  </div>

  <!-- KPI Row -->
  <div class="kpi-row" id="kpi-row">
    <div class="kpi-chip"><span class="kpi-label">Buses</span><span class="kpi-value" id="kpi-buses">-</span></div>
    <div class="kpi-chip"><span class="kpi-label">Generators</span><span class="kpi-value" id="kpi-gens">-</span></div>
    <div class="kpi-chip"><span class="kpi-label">Total Gen (P)</span><span class="kpi-value" id="kpi-gen-p">-</span></div>
    <div class="kpi-chip"><span class="kpi-label">Total Load (P)</span><span class="kpi-value" id="kpi-load-p">-</span></div>
    <div class="kpi-chip"><span class="kpi-label">Losses</span><span class="kpi-value" id="kpi-losses">-</span></div>
    <div class="kpi-chip"><span class="kpi-label">Branches</span><span class="kpi-value" id="kpi-branches">-</span></div>
    <div class="kpi-chip"><span class="kpi-label">Transformers</span><span class="kpi-value" id="kpi-xfmrs">-</span></div>
  </div>

  <!-- Diagnostics Status Banner -->
  <div class="diag-banner clean" id="diag-banner">
    <span>✓ Pre-flight Electrical Linter: Clean (0 diagnostic errors)</span>
  </div>

  <!-- Content Area -->
  <div class="content-area">
    <!-- View 1: SLD Diagram -->
    <div id="sld-view" class="view-pane active">
      <div class="sld-toolbar">
        <input type="text" class="sld-search-input" id="sld-search" placeholder="Search bus number or name..." oninput="searchSld()">
        <button onclick="zoomSld(1.2)">➕ Zoom In</button>
        <button onclick="zoomSld(0.8)">➖ Zoom Out</button>
        <button onclick="resetSldZoom()">⛶ Fit View</button>
        <div class="legend-group">
          <span>Voltage Tiers:</span>
          <span class="legend-chip"><span class="legend-dot" style="background:#E53935;"></span> 500 kV</span>
          <span class="legend-chip"><span class="legend-dot" style="background:#FB8C00;"></span> 230 kV</span>
          <span class="legend-chip"><span class="legend-dot" style="background:#1E88E5;"></span> 138 kV</span>
          <span class="legend-chip"><span class="legend-dot" style="background:#43A047;"></span> 69 kV</span>
          <span class="legend-chip"><span class="legend-dot" style="background:#8E24AA;"></span> &lt;60 kV</span>
        </div>
      </div>
      <div class="sld-workspace">
        <div class="svg-container" id="svg-container" onclick="handleSvgClick(event)">
          <!-- SVG markup rendered here -->
        </div>
        <div class="inspector-drawer" id="substation-inspector">
          <div class="inspector-header">
            <div>
              <div class="inspector-title" id="insp-title">Substation Inspector</div>
              <div class="inspector-subtitle" id="insp-subtitle">Click a bus or transmission line</div>
            </div>
            <button class="inspector-close" onclick="clearSelection()">✕</button>
          </div>
          <div id="insp-body" style="display: flex; flex-direction: column; gap: 12px;">
            <div style="font-size: 12px; color: #64748b; text-align: center; margin-top: 40px;">
              Select any Substation Bus, Generator, Load, or Transmission Branch to view equipment details and live power flow telemetry.
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- View 2: Tabular Grid -->
    <div id="grid-view" class="view-pane">
      <div class="grid-tabs-bar">
        <button id="subtab-buses" class="active" onclick="switchGridTab('buses')">Buses</button>
        <button id="subtab-generators" onclick="switchGridTab('generators')">Generators</button>
        <button id="subtab-branches" onclick="switchGridTab('branches')">Branches</button>
        <button id="subtab-transformers" onclick="switchGridTab('transformers')">Transformers</button>
        <button id="subtab-loads" onclick="switchGridTab('loads')">Loads</button>
        <input type="text" class="filter-input" id="table-filter" placeholder="Filter equipment..." oninput="filterTable()">
      </div>
      <div class="table-container" id="table-container">
        <!-- Active table inserted here -->
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentData = null;
    let currentGridTab = "buses";

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "update") {
        currentData = msg;
        renderAll();
      }
    });

    function switchView(viewName) {
      document.getElementById("sld-view").classList.toggle("active", viewName === "sld");
      document.getElementById("grid-view").classList.toggle("active", viewName === "grid");
      document.getElementById("btn-mode-sld").classList.toggle("active", viewName === "sld");
      document.getElementById("btn-mode-grid").classList.toggle("active", viewName === "grid");
    }

    function switchGridTab(tabName) {
      currentGridTab = tabName;
      ["buses", "generators", "branches", "transformers", "loads"].forEach(t => {
        const btn = document.getElementById("subtab-" + t);
        if (btn) btn.classList.toggle("active", t === tabName);
      });
      renderTable();
    }

    function exportAction(actionType) {
      vscode.postMessage({ type: actionType });
    }

    function renderAll() {
      if (!currentData) return;

      // Titles & Meta
      document.getElementById("case-title").innerText = currentData.title1 || "PSS/E Base Case";
      document.getElementById("case-meta").innerText =
        \`SBASE = \${currentData.header.sbase} MVA | Freq = \${currentData.header.basfrq} Hz | Rev \${currentData.header.rev}\`;

      // KPIs
      document.getElementById("kpi-buses").innerText = currentData.buses.length;
      document.getElementById("kpi-gens").innerText = currentData.generators.length;
      document.getElementById("kpi-gen-p").innerText = currentData.metrics.totalGenMw.toFixed(1) + " MW";
      document.getElementById("kpi-load-p").innerText = currentData.metrics.totalLoadMw.toFixed(1) + " MW";
      document.getElementById("kpi-losses").innerText = currentData.metrics.lossesMw.toFixed(2) + " MW";
      document.getElementById("kpi-branches").innerText = currentData.branches.length;
      document.getElementById("kpi-xfmrs").innerText = currentData.transformers.length;

      // Diagnostics banner
      const banner = document.getElementById("diag-banner");
      const diags = currentData.diagnostics || [];
      const errors = diags.filter(d => d.severity === "error");
      if (errors.length > 0) {
        banner.className = "diag-banner issues";
        banner.innerText = \`⚠ \${errors.length} Pre-flight Diagnostic Error(s): \${errors[0].code} - \${errors[0].message}\`;
      } else if (diags.length > 0) {
        banner.className = "diag-banner issues";
        banner.innerText = \`ℹ \${diags.length} Pre-flight Warning(s): \${diags[0].code} - \${diags[0].message}\`;
      } else {
        banner.className = "diag-banner clean";
        banner.innerText = "✓ Pre-flight Electrical Linter: Clean (0 diagnostic errors)";
      }

      // SLD SVG
      if (currentData.svg) {
        document.getElementById("svg-container").innerHTML = currentData.svg;
      }

      renderTable();
    }

    function zoomSld(factor) {
      sldZoom = Math.max(0.4, Math.min(3.5, sldZoom * factor));
      const svg = document.querySelector("#svg-container svg");
      if (svg) svg.style.transform = "scale(" + sldZoom + ")";
    }

    function resetSldZoom() {
      sldZoom = 1.0;
      const svg = document.querySelector("#svg-container svg");
      if (svg) svg.style.transform = "scale(1)";
    }

    function searchSld() {
      const query = (document.getElementById("sld-search").value || "").trim().toLowerCase();
      if (!query || !currentData) return;
      const bus = currentData.buses.find(b => String(b.i) === query || b.name.toLowerCase().includes(query));
      if (bus) {
        selectBus(bus.i);
      }
    }

    function clearSelection() {
      selectedElement = null;
      document.querySelectorAll(".sld-node, .sld-edge").forEach(el => el.classList.remove("selected"));
      document.getElementById("insp-title").innerText = "Substation Inspector";
      document.getElementById("insp-subtitle").innerText = "Click a bus or transmission line";
      document.getElementById("insp-body").innerHTML =
        '<div style="font-size: 12px; color: #64748b; text-align: center; margin-top: 40px;">' +
        'Select any Substation Bus, Generator, Load, or Transmission Branch to view equipment details and live power flow telemetry.' +
        '</div>';
    }

    function handleSvgClick(e) {
      const busNode = e.target.closest(".bus-node");
      if (busNode) {
        const busNum = parseInt(busNode.getAttribute("data-bus") || "0", 10);
        if (busNum > 0) selectBus(busNum);
        return;
      }
      const branchEdge = e.target.closest(".branch-line");
      if (branchEdge) {
        const idParts = branchEdge.id.replace("branch_", "").split("_");
        if (idParts.length >= 2) {
          selectBranch(parseInt(idParts[0], 10), parseInt(idParts[1], 10), idParts[2] || "1");
        }
        return;
      }
      const xfmrEdge = e.target.closest(".xfmr-line");
      if (xfmrEdge) {
        const idParts = xfmrEdge.id.replace("xfmr_", "").split("_");
        if (idParts.length >= 2) {
          selectTransformer(parseInt(idParts[0], 10), parseInt(idParts[1], 10), idParts[2] || "1");
        }
        return;
      }
      const genNode = e.target.closest(".gen-node");
      if (genNode) {
        const parts = genNode.id.split("_");
        if (parts.length >= 2) selectBus(parseInt(parts[1], 10));
        return;
      }
      const loadNode = e.target.closest(".load-node");
      if (loadNode) {
        const parts = loadNode.id.split("_");
        if (parts.length >= 2) selectBus(parseInt(parts[1], 10));
        return;
      }
    }

    function selectBus(busNumber) {
      if (!currentData) return;
      const bus = currentData.buses.find(b => b.i === busNumber);
      if (!bus) return;

      selectedElement = { type: "bus", id: busNumber, data: bus };

      // Highlight in SVG
      document.querySelectorAll(".sld-node, .sld-edge").forEach(el => el.classList.remove("selected"));
      const busEl = document.getElementById("bus_" + busNumber);
      if (busEl) busEl.classList.add("selected");

      // Power flow data
      const pfBus = currentData.powerflow && currentData.powerflow.buses
        ? currentData.powerflow.buses.find(pb => pb.busNumber === busNumber)
        : null;
      const vm = pfBus ? pfBus.vm : bus.vm;
      const va = pfBus ? pfBus.va : bus.va;
      const actualKv = (vm * bus.baseKv).toFixed(2);
      const isUnder = vm < 0.95;
      const isOver = vm > 1.05;
      const vStatus = isUnder ? '<span class="badge" style="background:#5c1d1d;color:#ff7b72;">UNDERVOLTAGE</span>'
        : isOver ? '<span class="badge" style="background:#5a3e1b;color:#f0883e;">OVERVOLTAGE</span>'
        : '<span class="badge" style="background:#1b4332;color:#4ade80;">NORMAL (0.95-1.05 pu)</span>';

      const typeLabel = bus.ide === 3 ? "Swing / Slack (Type 3)" : bus.ide === 2 ? "Generator / PV (Type 2)" : "Load / PQ (Type 1)";

      // Connected equipment
      const gens = (currentData.generators || []).filter(g => g.i === busNumber);
      const loads = (currentData.loads || []).filter(l => l.i === busNumber);
      const shunts = (currentData.fixedShunts || []).filter(s => s.i === busNumber);

      // Connected branches
      const connectedBranches = (currentData.branches || []).filter(br => br.i === busNumber || br.j === busNumber);
      const connectedXfmrs = (currentData.transformers || []).filter(t => t.i === busNumber || t.j === busNumber);

      document.getElementById("insp-title").innerText = "Bus " + bus.i + ": " + bus.name.trim();
      document.getElementById("insp-subtitle").innerText = bus.baseKv.toFixed(1) + " kV Nominal | Area " + bus.area + " | Zone " + bus.zone;

      let html =
        '<div class="card-panel">' +
          '<div class="panel-heading">Electrical State ' + vStatus + '</div>' +
          '<div class="telemetry-grid">' +
            '<div class="telemetry-item"><span class="telemetry-label">Voltage Vm</span><span class="telemetry-val">' + vm.toFixed(4) + ' pu (' + actualKv + ' kV)</span></div>' +
            '<div class="telemetry-item"><span class="telemetry-label">Phase Angle Va</span><span class="telemetry-val">' + va.toFixed(2) + '°</span></div>' +
            '<div class="telemetry-item"><span class="telemetry-label">Bus Classification</span><span class="telemetry-val" style="font-size:11px;">' + typeLabel + '</span></div>' +
            '<div class="telemetry-item"><span class="telemetry-label">Base Voltage</span><span class="telemetry-val">' + bus.baseKv.toFixed(1) + ' kV</span></div>' +
          '</div>' +
        '</div>';

      // Connected Generations
      if (gens.length > 0) {
        html += '<div class="card-panel">' +
          '<div class="panel-heading">⚡ Connected Generation (' + gens.length + ')</div>' +
          gens.map(g =>
            '<div style="padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05);">' +
              '<div style="display:flex; justify-content:space-between; font-weight:600; font-size:12px; color:#4ade80;">' +
                "<span>Gen ID: '" + g.id + "'</span>" +
                '<span>' + (g.stat === 1 ? 'In-Service' : 'Out') + '</span>' +
              '</div>' +
              '<div class="telemetry-grid" style="margin-top:4px;">' +
                '<div class="telemetry-item"><span class="telemetry-label">Active Power Pg</span><span class="telemetry-val">' + g.pg.toFixed(1) + ' MW</span></div>' +
                '<div class="telemetry-item"><span class="telemetry-label">Reactive Qg</span><span class="telemetry-val">' + g.qg.toFixed(1) + ' MVAr</span></div>' +
                '<div class="telemetry-item"><span class="telemetry-label">Qmin / Qmax</span><span class="telemetry-val">' + g.qb.toFixed(1) + ' / ' + g.qt.toFixed(1) + '</span></div>' +
                '<div class="telemetry-item"><span class="telemetry-label">MBASE</span><span class="telemetry-val">' + g.mbase.toFixed(1) + ' MVA</span></div>' +
              '</div>' +
            '</div>'
          ).join('') +
        '</div>';
      }

      // Connected Loads
      if (loads.length > 0) {
        html += '<div class="card-panel">' +
          '<div class="panel-heading">🏭 Connected Loads (' + loads.length + ')</div>' +
          loads.map(l =>
            '<div style="padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05);">' +
              '<div style="display:flex; justify-content:space-between; font-weight:600; font-size:12px; color:#fbbf24;">' +
                "<span>Load ID: '" + l.id + "'</span>" +
                '<span>' + (l.status === 1 ? 'Online' : 'Offline') + '</span>' +
              '</div>' +
              '<div class="telemetry-grid" style="margin-top:4px;">' +
                '<div class="telemetry-item"><span class="telemetry-label">Active Pl</span><span class="telemetry-val">' + l.pl.toFixed(1) + ' MW</span></div>' +
                '<div class="telemetry-item"><span class="telemetry-label">Reactive Ql</span><span class="telemetry-val">' + l.ql.toFixed(1) + ' MVAr</span></div>' +
              '</div>' +
            '</div>'
          ).join('') +
        '</div>';
      }

      // Connected Circuits
      if (connectedBranches.length > 0 || connectedXfmrs.length > 0) {
        html += '<div class="card-panel">' +
          '<div class="panel-heading">🌐 Connected Outgoing Circuits (' + (connectedBranches.length + connectedXfmrs.length) + ')</div>' +
          connectedBranches.map(br => {
            const isFrom = br.i === busNumber;
            const remoteBusNum = isFrom ? br.j : br.i;
            const remoteBus = currentData.buses.find(b => b.i === remoteBusNum);
            const remoteName = remoteBus ? remoteBus.name.trim() : 'Unknown';
            const pfBr = currentData.powerflow && currentData.powerflow.branches
              ? currentData.powerflow.branches.find(b => b.fromBus === br.i && b.toBus === br.j && b.ckt.trim() === br.ckt.trim())
              : null;
            const mvaFlow = pfBr ? pfBr.mvaFlow : null;
            const loadPct = pfBr && pfBr.loadingPercent !== undefined ? pfBr.loadingPercent : null;
            const barColor = loadPct !== null && loadPct > 100 ? '#ef4444' : loadPct !== null && loadPct > 80 ? '#f59e0b' : '#22c55e';
            return '<div style="padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.06);">' +
              '<div style="display:flex; justify-content:space-between; font-size:12px;">' +
                '<b>' + (isFrom ? '→' : '←') + ' Bus ' + remoteBusNum + ' (' + remoteName + ')</b>' +
                '<span style="color:#94a3b8;">ckt ' + br.ckt + '</span>' +
              '</div>' +
              '<div style="display:flex; justify-content:space-between; font-size:11px; margin-top:4px;">' +
                '<span>Flow: ' + (mvaFlow !== null ? mvaFlow.toFixed(1) + ' MVA' : '-') + '</span>' +
                '<span>Rating: ' + (br.rateA > 0 ? br.rateA.toFixed(1) + ' MVA' : 'No Limit') + '</span>' +
              '</div>' +
              (loadPct !== null ?
                '<div class="loading-bar-wrap">' +
                  '<div class="loading-bar-fill" style="width:' + Math.min(100, loadPct) + '%; background:' + barColor + ';"></div>' +
                '</div>' +
                '<div style="text-align:right; font-size:10px; color:' + barColor + '; margin-top:2px;">' + loadPct.toFixed(1) + '% Capacity</div>'
                : '') +
              '<div style="margin-top:6px;">' +
                '<button style="font-size:10px; padding:2px 8px;" onclick="selectBus(' + remoteBusNum + ')">Jump to Bus ' + remoteBusNum + '</button>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>';
      }

      html += '<div style="margin-top:6px;">' +
        '<button style="width:100%; justify-content:center;" onclick="openInGridTable(' + busNumber + ')">📋 View Bus in Grid Table</button>' +
      '</div>';

      document.getElementById("insp-body").innerHTML = html;
    }

    function selectBranch(fromBus, toBus, ckt) {
      if (!currentData) return;
      const br = (currentData.branches || []).find(b => b.i === fromBus && b.j === toBus && b.ckt.trim() === ckt.trim());
      if (!br) return;

      selectedElement = { type: "branch", id: fromBus + "_" + toBus + "_" + ckt, data: br };

      document.querySelectorAll(".sld-node, .sld-edge").forEach(el => el.classList.remove("selected"));
      const brEl = document.getElementById("branch_" + fromBus + "_" + toBus + "_" + ckt);
      if (brEl) brEl.classList.add("selected");

      const bFrom = currentData.buses.find(b => b.i === fromBus);
      const bTo = currentData.buses.find(b => b.i === toBus);
      const pfBr = currentData.powerflow && currentData.powerflow.branches
        ? currentData.powerflow.branches.find(b => b.fromBus === fromBus && b.toBus === toBus && b.ckt.trim() === ckt.trim())
        : null;

      document.getElementById("insp-title").innerText = "Branch " + fromBus + " → " + toBus + " (ckt " + ckt + ")";
      document.getElementById("insp-subtitle").innerText = (bFrom ? bFrom.name.trim() : '') + " to " + (bTo ? bTo.name.trim() : '');

      const mva = pfBr ? pfBr.mvaFlow.toFixed(1) : '-';
      const loadPct = pfBr && pfBr.loadingPercent !== undefined ? pfBr.loadingPercent : null;
      const barColor = loadPct !== null && loadPct > 100 ? '#ef4444' : loadPct !== null && loadPct > 80 ? '#f59e0b' : '#22c55e';

      let html =
        '<div class="card-panel">' +
          '<div class="panel-heading">Branch Power Flow</div>' +
          '<div class="telemetry-grid">' +
            '<div class="telemetry-item"><span class="telemetry-label">Active Flow</span><span class="telemetry-val">' + (pfBr ? pfBr.pFlow.toFixed(1) + ' MW' : '-') + '</span></div>' +
            '<div class="telemetry-item"><span class="telemetry-label">Reactive Flow</span><span class="telemetry-val">' + (pfBr ? pfBr.qFlow.toFixed(1) + ' MVAr' : '-') + '</span></div>' +
            '<div class="telemetry-item"><span class="telemetry-label">Apparent Flow</span><span class="telemetry-val">' + mva + ' MVA</span></div>' +
            '<div class="telemetry-item"><span class="telemetry-label">Thermal Rating A</span><span class="telemetry-val">' + (br.rateA > 0 ? br.rateA.toFixed(1) + ' MVA' : 'Unlimited') + '</span></div>' +
          '</div>' +
          (loadPct !== null ?
            '<div class="loading-bar-wrap" style="margin-top:8px;">' +
              '<div class="loading-bar-fill" style="width:' + Math.min(100, loadPct) + '%; background:' + barColor + ';"></div>' +
            '</div>' +
            '<div style="display:flex; justify-content:space-between; font-size:10px; margin-top:2px;">' +
              '<span>Thermal Loading</span>' +
              '<span style="font-weight:700; color:' + barColor + ';">' + loadPct.toFixed(1) + '%</span>' +
            '</div>'
            : '') +
        '</div>' +
        '<div class="card-panel">' +
          '<div class="panel-heading">Line Electrical Parameters</div>' +
          '<div class="telemetry-grid">' +
            '<div class="telemetry-item"><span class="telemetry-label">Resistance R</span><span class="telemetry-val">' + br.r.toFixed(5) + ' pu</span></div>' +
            '<div class="telemetry-item"><span class="telemetry-label">Reactance X</span><span class="telemetry-val">' + br.x.toFixed(5) + ' pu</span></div>' +
            '<div class="telemetry-item"><span class="telemetry-label">Susceptance B</span><span class="telemetry-val">' + br.b.toFixed(5) + ' pu</span></div>' +
            '<div class="telemetry-item"><span class="telemetry-label">Status</span><span class="telemetry-val">' + (br.st === 1 ? 'In-Service' : 'Out-of-Service') + '</span></div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex; gap:8px;">' +
          '<button style="flex:1; justify-content:center;" onclick="selectBus(' + fromBus + ')">Jump to Bus ' + fromBus + '</button>' +
          '<button style="flex:1; justify-content:center;" onclick="selectBus(' + toBus + ')">Jump to Bus ' + toBus + '</button>' +
        '</div>';

      document.getElementById("insp-body").innerHTML = html;
    }

    function selectTransformer(fromBus, toBus, ckt) {
      if (!currentData) return;
      const xfmr = (currentData.transformers || []).find(t => t.i === fromBus && t.j === toBus && t.ckt.trim() === ckt.trim());
      if (!xfmr) return;

      document.querySelectorAll(".sld-node, .sld-edge").forEach(el => el.classList.remove("selected"));
      const xfmrEl = document.getElementById("xfmr_" + fromBus + "_" + toBus + "_" + ckt);
      if (xfmrEl) xfmrEl.classList.add("selected");

      document.getElementById("insp-title").innerText = "XFMR " + fromBus + " ⇄ " + toBus + " (ckt " + ckt + ")";
      document.getElementById("insp-subtitle").innerText = "Two-Winding Substation Power Transformer";

      let html =
        '<div class="card-panel">' +
          '<div class="panel-heading">Transformer Characteristics</div>' +
          '<div class="telemetry-grid">' +
            '<div class="telemetry-item"><span class="telemetry-label">SBASE</span><span class="telemetry-val">' + xfmr.sbase12.toFixed(1) + ' MVA</span></div>' +
            '<div class="telemetry-item"><span class="telemetry-label">Tap Ratio</span><span class="telemetry-val">' + xfmr.windv1.toFixed(4) + ' pu</span></div>' +
            '<div class="telemetry-item"><span class="telemetry-label">Resistance R</span><span class="telemetry-val">' + xfmr.r12.toFixed(5) + ' pu</span></div>' +
            '<div class="telemetry-item"><span class="telemetry-label">Reactance X</span><span class="telemetry-val">' + xfmr.x12.toFixed(5) + ' pu</span></div>' +
            '<div class="telemetry-item"><span class="telemetry-label">Phase Shift</span><span class="telemetry-val">' + xfmr.ang1.toFixed(2) + '°</span></div>' +
            '<div class="telemetry-item"><span class="telemetry-label">Status</span><span class="telemetry-val">' + (xfmr.stat === 1 ? 'In-Service' : 'Out') + '</span></div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex; gap:8px;">' +
          '<button style="flex:1; justify-content:center;" onclick="selectBus(' + fromBus + ')">Jump to Bus ' + fromBus + '</button>' +
          '<button style="flex:1; justify-content:center;" onclick="selectBus(' + toBus + ')">Jump to Bus ' + toBus + '</button>' +
        '</div>';

      document.getElementById("insp-body").innerHTML = html;
    }

    function openInGridTable(busNumber) {
      switchView("grid");
      switchGridTab("buses");
      const filterInput = document.getElementById("table-filter");
      if (filterInput) {
        filterInput.value = String(busNumber);
        filterTable();
      }
    }

    function selectBusFromTable(busNumber) {
      switchView("sld");
      selectBus(busNumber);
    }

    function selectBranchFromTable(from, to, ckt) {
      switchView("sld");
      selectBranch(from, to, ckt);
    }

    function renderTable() {
      if (!currentData) return;
      const container = document.getElementById("table-container");
      const filter = (document.getElementById("table-filter").value || "").toLowerCase();

      let html = "";
      if (currentGridTab === "buses") {
        html = \`<table>
          <thead>
            <tr><th>Bus #</th><th>Name</th><th>Base kV</th><th>Type</th><th>Vm (pu)</th><th>Va (deg)</th><th>Area</th><th>Zone</th><th>Action</th></tr>
          </thead>
          <tbody>
            \${currentData.buses
              .filter(b => !filter || String(b.i).includes(filter) || b.name.toLowerCase().includes(filter))
              .map(b => {
                const pfBus = currentData.powerflow && currentData.powerflow.buses ? currentData.powerflow.buses.find(pb => pb.busNumber === b.i) : null;
                const vm = pfBus ? pfBus.vm : b.vm;
                const va = pfBus ? pfBus.va : b.va;
                const isUnder = vm < 0.95;
                const isOver = vm > 1.05;
                const vmStyle = isUnder ? 'style="color:#ff7b72;font-weight:bold;"' : isOver ? 'style="color:#d29922;font-weight:bold;"' : '';
                const typeBadge = b.ide === 3 ? '<span class="badge badge-slack">Slack (3)</span>'
                  : b.ide === 2 ? '<span class="badge badge-pv">PV (2)</span>'
                  : '<span class="badge badge-pq">PQ (1)</span>';
                const violationBadge = isUnder ? ' <span class="badge" style="background:#5c1d1d;color:#ff7b72;">Low V</span>'
                  : isOver ? ' <span class="badge" style="background:#5a3e1b;color:#f0883e;">High V</span>' : '';
                return \`<tr class="clickable-row" onclick="selectBusFromTable(\${b.i})">
                  <td><b>\${b.i}</b></td>
                  <td>\${b.name.trim()}</td>
                  <td>\${b.baseKv.toFixed(1)} kV</td>
                  <td>\${typeBadge}</td>
                  <td \${vmStyle}>\${vm.toFixed(4)}\${violationBadge}</td>
                  <td>\${va.toFixed(2)}°</td>
                  <td>\${b.area}</td>
                  <td>\${b.zone}</td>
                  <td><button style="padding:2px 6px; font-size:11px;" onclick="event.stopPropagation(); selectBusFromTable(\${b.i});">Inspect SLD</button></td>
                </tr>\`;
              }).join("")}
          </tbody>
        </table>\`;
      } else if (currentGridTab === "generators") {
        html = \`<table>
          <thead>
            <tr><th>Bus</th><th>ID</th><th>Pg (MW)</th><th>Qg (MVAr)</th><th>Qmax</th><th>Qmin</th><th>Vs (pu)</th><th>MBASE</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            \${currentData.generators
              .filter(g => !filter || String(g.i).includes(filter) || g.id.toLowerCase().includes(filter))
              .map(g => \`<tr class="clickable-row" onclick="selectBusFromTable(\${g.i})">
                <td><b>\${g.i}</b></td>
                <td>\${g.id}</td>
                <td>\${g.pg.toFixed(1)}</td>
                <td>\${g.qg.toFixed(1)}</td>
                <td>\${g.qt.toFixed(1)}</td>
                <td>\${g.qb.toFixed(1)}</td>
                <td>\${g.vs.toFixed(4)}</td>
                <td>\${g.mbase.toFixed(1)}</td>
                <td>\${g.stat === 1 ? 'In-Service' : 'Out-of-Service'}</td>
                <td><button style="padding:2px 6px; font-size:11px;" onclick="event.stopPropagation(); selectBusFromTable(\${g.i});">View Bus</button></td>
              </tr>\`).join("")}
          </tbody>
        </table>\`;
      } else if (currentGridTab === "branches") {
        html = \`<table>
          <thead>
            <tr><th>From</th><th>To</th><th>Ckt</th><th>R (pu)</th><th>X (pu)</th><th>Rate A (MVA)</th><th>Flow (MVA)</th><th>Loading (%)</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            \${currentData.branches
              .filter(br => !filter || String(br.i).includes(filter) || String(br.j).includes(filter))
              .map(br => {
                const pfBr = currentData.powerflow && currentData.powerflow.branches ? currentData.powerflow.branches.find(b => b.fromBus === br.i && b.toBus === br.j && b.ckt.trim() === br.ckt.trim()) : null;
                const flow = pfBr ? pfBr.mvaFlow.toFixed(1) : '-';
                const loadPct = pfBr && pfBr.loadingPercent !== undefined ? pfBr.loadingPercent : null;
                const isOverload = loadPct !== null && loadPct > 100;
                const loadBadge = isOverload
                  ? \`<span class="badge" style="background:#5c1d1d;color:#ff7b72;">\${loadPct.toFixed(1)}% OVERLOAD</span>\`
                  : loadPct !== null ? \`\${loadPct.toFixed(1)}%\` : '-';
                return \`<tr class="clickable-row" onclick="selectBranchFromTable(\${br.i}, \${br.j}, '\${br.ckt.trim()}')">
                  <td><b>\${br.i}</b></td>
                  <td><b>\${br.j}</b></td>
                  <td>\${br.ckt}</td>
                  <td>\${br.r.toFixed(5)}</td>
                  <td>\${br.x.toFixed(5)}</td>
                  <td>\${br.rateA > 0 ? br.rateA.toFixed(1) : '-'}</td>
                  <td>\${flow}</td>
                  <td>\${loadBadge}</td>
                  <td>\${br.st === 1 ? 'In-Service' : 'Out'}</td>
                  <td><button style="padding:2px 6px; font-size:11px;" onclick="event.stopPropagation(); selectBranchFromTable(\${br.i}, \${br.j}, '\${br.ckt.trim()}');">Inspect</button></td>
                </tr>\`;
              }).join("")}
          </tbody>
        </table>\`;
      } else if (currentGridTab === "transformers") {
        html = \`<table>
          <thead>
            <tr><th>From</th><th>To</th><th>Ckt</th><th>R (pu)</th><th>X (pu)</th><th>SBASE</th><th>Tap Ratio</th><th>Nom Angle</th><th>Status</th></tr>
          </thead>
          <tbody>
            \${currentData.transformers
              .filter(t => !filter || String(t.i).includes(filter) || String(t.j).includes(filter))
              .map(t => \`<tr class="clickable-row" onclick="selectBranchFromTable(\${t.i}, \${t.j}, '\${t.ckt.trim()}')">
                <td><b>\${t.i}</b></td>
                <td><b>\${t.j}</b></td>
                <td>\${t.ckt}</td>
                <td>\${t.r12.toFixed(5)}</td>
                <td>\${t.x12.toFixed(5)}</td>
                <td>\${t.sbase12.toFixed(1)}</td>
                <td>\${t.windv1.toFixed(4)}</td>
                <td>\${t.ang1.toFixed(2)}°</td>
                <td>\${t.stat === 1 ? 'In-Service' : 'Out'}</td>
              </tr>\`).join("")}
          </tbody>
        </table>\`;
      } else if (currentGridTab === "loads") {
        html = \`<table>
          <thead>
            <tr><th>Bus</th><th>ID</th><th>Pl (MW)</th><th>Ql (MVAr)</th><th>Status</th><th>Area</th><th>Zone</th></tr>
          </thead>
          <tbody>
            \${currentData.loads
              .filter(l => !filter || String(l.i).includes(filter) || l.id.toLowerCase().includes(filter))
              .map(l => \`<tr class="clickable-row" onclick="selectBusFromTable(\${l.i})">
                <td><b>\${l.i}</b></td>
                <td>\${l.id}</td>
                <td>\${l.pl.toFixed(1)}</td>
                <td>\${l.ql.toFixed(1)}</td>
                <td>\${l.status === 1 ? 'In-Service' : 'Out'}</td>
                <td>\${l.area}</td>
                <td>\${l.zone}</td>
              </tr>\`).join("")}
          </tbody>
        </table>\`;
      }

      container.innerHTML = html;
    }

    function filterTable() {
      renderTable();
    }

    // Signal ready
    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
  }
}
