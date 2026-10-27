// SPDX-License-Identifier: AGPL-3.0-or-later

import { planDiagramActions } from "@modelscript/pscad";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import { getNonce } from "./utils/nonce.js";

export interface LineGeometryConfig {
  name: string;
  lengthKm: number;
  freqHz: number;
  soilResistivityOhmM: number;
  rDcOhmPerKm: number;
  conductorRadiusM: number;
  gmrM: number;
  bundleCount: number;
  bundleSpacingM: number;
  conductors: {
    id: string;
    phase: "A" | "B" | "C" | "G1" | "G2";
    x: number;
    y: number;
    isShield: boolean;
  }[];
}

/**
 * Manages the interactive 2D Transmission Line & Cable Cross-Section CAD sub-editor webview panel.
 *
 * Provides an interactive 2D SVG canvas for placing phase conductors (A, B, C) and shield wires (G1, G2),
 * computes multi-conductor Carson / Deri-Semlyen earth return impedances, performs Kron reduction and
 * symmetrical component transformations, and writes computed parameters back to PSCAD schematic lines.
 */
export class LineGeometryPanel {
  public static currentPanel: LineGeometryPanel | undefined;
  public static readonly viewType = "modelscript.lineGeometryEditor";

  private readonly _panel: vscode.WebviewPanel;
  private _targetUri: string | undefined;
  private _componentName: string | undefined;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    _client?: LanguageClient,
    targetUri?: string,
    componentName?: string,
    initialParams?: Record<string, any>,
  ): LineGeometryPanel {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (LineGeometryPanel.currentPanel) {
      LineGeometryPanel.currentPanel._panel.reveal(column);
      LineGeometryPanel.currentPanel.update(targetUri, componentName, initialParams);
      return LineGeometryPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      LineGeometryPanel.viewType,
      `Line CAD: ${componentName || "Overhead Tower"}`,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    LineGeometryPanel.currentPanel = new LineGeometryPanel(panel, targetUri, componentName, initialParams);
    return LineGeometryPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    targetUri?: string,
    componentName?: string,
    initialParams?: Record<string, any>,
  ) {
    this._panel = panel;
    this._targetUri = targetUri;
    this._componentName = componentName;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case "applyLineParameters": {
            await this.applyParametersToDocument(message.params);
            break;
          }
          case "showInfo": {
            vscode.window.showInformationMessage(message.message);
            break;
          }
        }
      },
      null,
      this._disposables,
    );

    this.update(targetUri, componentName, initialParams);
  }

  public update(targetUri?: string, componentName?: string, initialParams?: Record<string, any>): void {
    if (targetUri) this._targetUri = targetUri;
    if (componentName) {
      this._componentName = componentName;
      this._panel.title = `Line CAD: ${componentName}`;
    }
    this._panel.webview.html = this.getHtmlForWebview(initialParams);
  }

  private async applyParametersToDocument(params: {
    R: number;
    L: number;
    C: number;
    length: number;
    conductor_height: number;
    conductor_radius: number;
    soil_resistivity: number;
    model_type?: string;
    y0?: number;
    tau?: number;
    num_poles?: number;
    [key: string]: any;
  }): Promise<void> {
    if (!this._targetUri || !this._componentName) {
      vscode.window.showWarningMessage("No active PSCAD document or component target to update.");
      return;
    }

    try {
      const docUri = vscode.Uri.parse(this._targetUri);
      let docText = "";
      const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this._targetUri);
      if (openDoc) {
        docText = openDoc.getText();
      } else {
        const bytes = await vscode.workspace.fs.readFile(docUri);
        docText = new TextDecoder().decode(bytes);
      }

      // Generate text edits for each parameter update
      const actions: any[] = [
        { type: "updateParameter", name: this._componentName, parameter: "R", value: params.R.toFixed(5) },
        { type: "updateParameter", name: this._componentName, parameter: "L", value: params.L.toFixed(6) },
        { type: "updateParameter", name: this._componentName, parameter: "C", value: params.C.toExponential(4) },
        { type: "updateParameter", name: this._componentName, parameter: "length", value: params.length.toFixed(1) },
        {
          type: "updateParameter",
          name: this._componentName,
          parameter: "conductor_height",
          value: params.conductor_height.toFixed(2),
        },
        {
          type: "updateParameter",
          name: this._componentName,
          parameter: "conductor_radius",
          value: params.conductor_radius.toFixed(4),
        },
        {
          type: "updateParameter",
          name: this._componentName,
          parameter: "soil_resistivity",
          value: params.soil_resistivity.toFixed(1),
        },
      ];

      if (params.model_type) {
        actions.push({
          type: "updateParameter",
          name: this._componentName,
          parameter: "model_type",
          value: params.model_type,
        });
      }
      if (params.model_type === "JMarti") {
        if (params.y0 !== undefined) {
          actions.push({
            type: "updateParameter",
            name: this._componentName,
            parameter: "y0",
            value: params.y0.toExponential(4),
          });
        }
        if (params.tau !== undefined) {
          actions.push({
            type: "updateParameter",
            name: this._componentName,
            parameter: "tau",
            value: params.tau.toExponential(4),
          });
        }
        if (params.num_poles !== undefined) {
          actions.push({
            type: "updateParameter",
            name: this._componentName,
            parameter: "num_poles",
            value: String(params.num_poles),
          });
        }
      }

      const planned = planDiagramActions(docText, actions);
      if (planned.edits.length === 0) {
        vscode.window.showWarningMessage(`Could not find component '${this._componentName}' in ${docUri.path}.`);
        return;
      }

      const wsEdit = new vscode.WorkspaceEdit();
      for (const edit of planned.edits) {
        const startPos = new vscode.Position(edit.range.start.line, edit.range.start.character);
        const endPos = new vscode.Position(edit.range.end.line, edit.range.end.character);
        wsEdit.replace(docUri, new vscode.Range(startPos, endPos), edit.newText);
      }

      const success = await vscode.workspace.applyEdit(wsEdit);
      if (success) {
        if (params.model_type === "JMarti") {
          vscode.window.showInformationMessage(
            `Updated '${this._componentName}' (J.Marti Frequency-Dependent): ${params.num_poles ?? 4} Poles, Y0=${((params.y0 ?? 0) * 1e3).toFixed(3)} mS, τ=${((params.tau ?? 0) * 1e6).toFixed(1)} µs, R1=${params.R.toFixed(4)} Ω/km`,
          );
        } else {
          vscode.window.showInformationMessage(
            `Updated '${this._componentName}' (Bergeron Wave): R1=${params.R.toFixed(4)} Ω/km, L1=${(params.L * 1e3).toFixed(3)} mH/km, C1=${(params.C * 1e9).toFixed(2)} nF/km`,
          );
        }
      } else {
        vscode.window.showErrorMessage(`Failed to apply parameters to '${this._componentName}'.`);
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Error applying line parameters: ${e?.message ?? e}`);
    }
  }

  public dispose(): void {
    LineGeometryPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  private getHtmlForWebview(initialParams?: Record<string, any>): string {
    const nonce = getNonce();

    // Default configuration
    const lengthKm = parseFloat(String(initialParams?.["length"] ?? initialParams?.["Length"] ?? 100.0)) || 100.0;
    const condHeight = parseFloat(String(initialParams?.["conductor_height"] ?? 22.0)) || 22.0;
    const condRadius = parseFloat(String(initialParams?.["conductor_radius"] ?? 0.016)) || 0.016;
    const soilRho = parseFloat(String(initialParams?.["soil_resistivity"] ?? 100.0)) || 100.0;
    const rDc = parseFloat(String(initialParams?.["R"] ?? initialParams?.["r_per_km"] ?? 0.032)) || 0.032;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:; font-src data:;">
  <title>2D Transmission Line & Cable Cross-Section CAD</title>
  <style>
    :root {
      --bg-color: var(--vscode-editor-background, #0f172a);
      --panel-bg: var(--vscode-sideBar-background, #1e293b);
      --border-color: var(--vscode-widget-border, #334155);
      --text-color: var(--vscode-foreground, #f8fafc);
      --text-muted: var(--vscode-descriptionForeground, #94a3b8);
      --accent: var(--vscode-button-background, #0284c7);
      --accent-hover: var(--vscode-button-hoverBackground, #0369a1);
      --phase-a: #ef4444;
      --phase-b: #10b981;
      --phase-c: #3b82f6;
      --shield: #94a3b8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: row;
      background: var(--bg-color);
      color: var(--text-color);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      font-size: 12px;
    }

    /* Left 2D CAD Canvas Area */
    .cad-viewport {
      flex: 1;
      height: 100%;
      position: relative;
      background: radial-gradient(circle at 50% 50%, #1e293b 0%, #0f172a 100%);
      overflow: hidden;
      user-select: none;
    }
    #cad-svg {
      width: 100%;
      height: 100%;
      cursor: crosshair;
    }
    .hud-overlay {
      position: absolute;
      top: 12px;
      left: 12px;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 8px 12px;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      display: flex;
      flex-direction: column;
      gap: 4px;
      pointer-events: none;
    }
    .hud-overlay h3 { margin: 0; font-size: 12px; color: #38bdf8; }
    .hud-overlay p { margin: 0; font-size: 10px; color: var(--text-muted); }

    /* Right Control & Results Sidebar */
    .sidebar {
      width: 380px;
      height: 100%;
      border-left: 1px solid var(--border-color);
      background: var(--panel-bg);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }
    .section {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
    }
    .section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #38bdf8;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .param-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 12px;
    }
    .param-group {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .param-group label {
      font-size: 10px;
      color: var(--text-muted);
    }
    .param-group input, .param-group select {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      color: var(--text-color);
      padding: 4px 8px;
      font-size: 11px;
      font-family: monospace;
      outline: none;
    }
    .param-group input:focus, .param-group select:focus {
      border-color: #38bdf8;
    }

    /* Tabs for Results */
    .tab-header {
      display: flex;
      background: rgba(15, 23, 42, 0.4);
      border-bottom: 1px solid var(--border-color);
    }
    .tab-btn {
      flex: 1;
      padding: 8px 4px;
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      text-align: center;
      border-bottom: 2px solid transparent;
      transition: all 0.15s ease;
    }
    .tab-btn.active {
      color: #38bdf8;
      border-bottom-color: #38bdf8;
      background: rgba(56, 189, 248, 0.05);
    }
    .tab-content {
      padding: 12px 16px;
      display: none;
    }
    .tab-content.active {
      display: block;
    }

    /* Metric Cards */
    .metric-card {
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 8px 10px;
      margin-bottom: 8px;
    }
    .metric-title {
      font-size: 10px;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .metric-val {
      font-size: 14px;
      font-weight: 700;
      font-family: monospace;
      color: #f8fafc;
    }
    .metric-val span { font-size: 10px; font-weight: normal; color: #94a3b8; margin-left: 2px; }

    /* Matrix Table */
    .matrix-table {
      width: 100%;
      border-collapse: collapse;
      font-family: monospace;
      font-size: 10px;
      margin-top: 6px;
    }
    .matrix-table th, .matrix-table td {
      border: 1px solid var(--border-color);
      padding: 4px 6px;
      text-align: right;
    }
    .matrix-table th {
      background: rgba(15, 23, 42, 0.8);
      color: #38bdf8;
      font-weight: 600;
    }

    /* Action Toolbar at Bottom */
    .action-bar {
      margin-top: auto;
      padding: 12px 16px;
      border-top: 1px solid var(--border-color);
      background: rgba(15, 23, 42, 0.8);
      display: flex;
      gap: 8px;
    }
    .btn-apply {
      flex: 1;
      padding: 8px 12px;
      background: #0284c7;
      color: white;
      border: none;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: background 0.15s;
    }
    .btn-apply:hover { background: #0369a1; }
  </style>
</head>
<body>
  <!-- 2D Interactive CAD Viewport -->
  <div class="cad-viewport">
    <div class="hud-overlay">
      <h3>Tower Cross-Section (Carson / Deri-Semlyen)</h3>
      <p>Drag Phase (A, B, C) and Ground (G1, G2) conductor handles to adjust spacing & height</p>
    </div>
    <svg id="cad-svg" viewBox="-25 -5 50 40" preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="ground-hatch" width="2" height="2" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="2" stroke="#334155" stroke-width="0.5" />
        </pattern>
        <!-- Gradients for Phase Conductors -->
        <radialGradient id="grad-a" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#f87171"/>
          <stop offset="100%" stop-color="#dc2626"/>
        </radialGradient>
        <radialGradient id="grad-b" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#34d399"/>
          <stop offset="100%" stop-color="#059669"/>
        </radialGradient>
        <radialGradient id="grad-c" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#60a5fa"/>
          <stop offset="100%" stop-color="#2563eb"/>
        </radialGradient>
        <radialGradient id="grad-g" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stop-color="#cbd5e1"/>
          <stop offset="100%" stop-color="#64748b"/>
        </radialGradient>
      </defs>

      <!-- Earth Ground Plane (y <= 0 in Cartesian, inverted in SVG) -->
      <g id="ground-group">
        <!-- SVG coords: Y grows downwards, so ground surface is at y = 35, earth is below -->
        <rect x="-30" y="35" width="60" height="10" fill="url(#ground-hatch)" opacity="0.6"/>
        <line x1="-30" y1="35" x2="30" y2="35" stroke="#4ade80" stroke-width="0.4" stroke-dasharray="0.8,0.4"/>
        <text x="-24" y="37.5" fill="#4ade80" font-size="1.2" font-family="monospace">Earth Plane (y = 0 m)</text>
      </g>

      <!-- Tower Structure Outline (lattice silhouette) -->
      <g id="tower-structure" stroke="#475569" stroke-width="0.3" fill="none">
        <!-- Tower Legs -->
        <polygon points="0,7 -3,35 3,35" fill="rgba(30, 41, 59, 0.4)"/>
        <!-- Crossarms -->
        <line x1="-8" y1="13" x2="8" y2="13" stroke-width="0.5"/>
        <line x1="-7" y1="18" x2="7" y2="18" stroke-width="0.5"/>
        <line x1="-5" y1="7" x2="5" y2="7" stroke-width="0.4"/>
        <!-- Lattice Bracing -->
        <line x1="-2" y1="30" x2="2" y2="25"/>
        <line x1="2" y1="30" x2="-2" y2="25"/>
        <line x1="-1.5" y1="25" x2="1.5" y2="20"/>
        <line x1="1.5" y1="25" x2="-1.5" y2="20"/>
        <line x1="-1" y1="20" x2="1" y2="15"/>
        <line x1="1" y1="20" x2="-1" y2="15"/>
      </g>

      <!-- Grid lines (meters) -->
      <g id="grid-lines" stroke="#1e293b" stroke-width="0.15">
        <line x1="-20" y1="5" x2="-20" y2="35"/>
        <line x1="-10" y1="5" x2="-10" y2="35"/>
        <line x1="0" y1="5" x2="0" y2="35"/>
        <line x1="10" y1="5" x2="10" y2="35"/>
        <line x1="20" y1="5" x2="20" y2="35"/>
        <line x1="-25" y1="15" x2="25" y2="15"/>
        <line x1="-25" y1="25" x2="25" y2="25"/>
      </g>

      <!-- Interactive Conductor Handles -->
      <g id="conductor-handles">
        <!-- Phase A -->
        <g id="handle-A" class="handle" cursor="grab" data-phase="A">
          <circle cx="-6.5" cy="13" r="1.2" fill="url(#grad-a)" stroke="#f87171" stroke-width="0.25"/>
          <text x="-6.5" y="13.4" fill="#ffffff" font-size="1.1" font-weight="bold" text-anchor="middle">A</text>
          <text id="lbl-pos-A" x="-6.5" y="11.2" fill="#fca5a5" font-size="0.9" font-family="monospace" text-anchor="middle">(-6.5, 22.0) m</text>
        </g>
        <!-- Phase B -->
        <g id="handle-B" class="handle" cursor="grab" data-phase="B">
          <circle cx="0.0" cy="13" r="1.2" fill="url(#grad-b)" stroke="#34d399" stroke-width="0.25"/>
          <text x="0.0" y="13.4" fill="#ffffff" font-size="1.1" font-weight="bold" text-anchor="middle">B</text>
          <text id="lbl-pos-B" x="0.0" y="11.2" fill="#86efac" font-size="0.9" font-family="monospace" text-anchor="middle">(0.0, 22.0) m</text>
        </g>
        <!-- Phase C -->
        <g id="handle-C" class="handle" cursor="grab" data-phase="C">
          <circle cx="6.5" cy="13" r="1.2" fill="url(#grad-c)" stroke="#60a5fa" stroke-width="0.25"/>
          <text x="6.5" y="13.4" fill="#ffffff" font-size="1.1" font-weight="bold" text-anchor="middle">C</text>
          <text id="lbl-pos-C" x="6.5" y="11.2" fill="#93c5fd" font-size="0.9" font-family="monospace" text-anchor="middle">(6.5, 22.0) m</text>
        </g>
        <!-- Shield G1 -->
        <g id="handle-G1" class="handle" cursor="grab" data-phase="G1">
          <circle cx="-4.0" cy="7" r="0.9" fill="url(#grad-g)" stroke="#cbd5e1" stroke-width="0.2"/>
          <text x="-4.0" y="7.3" fill="#ffffff" font-size="0.8" font-weight="bold" text-anchor="middle">G1</text>
          <text id="lbl-pos-G1" x="-4.0" y="5.5" fill="#cbd5e1" font-size="0.8" font-family="monospace" text-anchor="middle">(-4.0, 28.0) m</text>
        </g>
        <!-- Shield G2 -->
        <g id="handle-G2" class="handle" cursor="grab" data-phase="G2">
          <circle cx="4.0" cy="7" r="0.9" fill="url(#grad-g)" stroke="#cbd5e1" stroke-width="0.2"/>
          <text x="4.0" y="7.3" fill="#ffffff" font-size="0.8" font-weight="bold" text-anchor="middle">G2</text>
          <text id="lbl-pos-G2" x="4.0" y="5.5" fill="#cbd5e1" font-size="0.8" font-family="monospace" text-anchor="middle">(4.0, 28.0) m</text>
        </g>
      </g>
    </svg>
  </div>

  <!-- Sidebar Configuration & Results -->
  <div class="sidebar">
    <div class="section">
      <div class="section-title">Line & Earth Parameters</div>
      <div class="param-grid">
        <div class="param-group">
          <label>Line Length (km)</label>
          <input type="number" id="inp-length" value="${lengthKm}" step="1" min="0.1" />
        </div>
        <div class="param-group">
          <label>Frequency (Hz)</label>
          <input type="number" id="inp-freq" value="60" step="10" min="10" />
        </div>
        <div class="param-group">
          <label>Soil Resistivity (Ω·m)</label>
          <input type="number" id="inp-soil" value="${soilRho}" step="10" min="1" />
        </div>
        <div class="param-group">
          <label>DC Resistance (Ω/km)</label>
          <input type="number" id="inp-rdc" value="${rDc}" step="0.005" min="0.001" />
        </div>
        <div class="param-group">
          <label>Conductor Radius (mm)</label>
          <input type="number" id="inp-radius" value="${(condRadius * 1e3).toFixed(1)}" step="1" min="1" />
        </div>
        <div class="param-group">
          <label>Bundle Setup</label>
          <select id="inp-bundle">
            <option value="1">1 (Single Conductor)</option>
            <option value="2">2-Bundle (d = 40 cm)</option>
            <option value="4">4-Bundle (d = 45 cm)</option>
          </select>
        </div>
        <div class="param-group">
          <label>Model Formulation</label>
          <select id="inp-model-type">
            <option value="Bergeron">Bergeron (Traveling Wave)</option>
            <option value="JMarti" selected>Frequency-Dependent (J.Marti)</option>
          </select>
        </div>
        <div class="param-group">
          <label>Fitting Poles (M)</label>
          <select id="inp-poles">
            <option value="2">2 Poles</option>
            <option value="4" selected>4 Poles</option>
            <option value="6">6 Poles</option>
            <option value="8">8 Poles</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="tab-header">
      <button class="tab-btn active" data-tab="tab-seq">Sequence RLC</button>
      <button class="tab-btn" data-tab="tab-matrix">Phase Matrix [Z, Y]</button>
      <button class="tab-btn" data-tab="tab-bergeron">Bergeron Wave</button>
      <button class="tab-btn" data-tab="tab-vectorfit">Vector Fitting (J.Marti)</button>
    </div>

    <!-- Tab 1: Sequence Parameters -->
    <div id="tab-seq" class="tab-content active">
      <div class="metric-card">
        <div class="metric-title">Positive-Sequence Resistance (R1)</div>
        <div class="metric-val" id="res-r1">0.0320 <span>Ω/km</span></div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Positive-Sequence Inductance (L1)</div>
        <div class="metric-val" id="res-l1">0.965 <span>mH/km</span></div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Positive-Sequence Capacitance (C1)</div>
        <div class="metric-val" id="res-c1">11.85 <span>nF/km</span></div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Zero-Sequence Impedance (Z0)</div>
        <div class="metric-val" id="res-z0">0.245 + j1.12 <span>Ω/km</span></div>
      </div>
    </div>

    <!-- Tab 2: Phase Domain Matrices -->
    <div id="tab-matrix" class="tab-content">
      <div class="metric-title">Impedance Matrix [Z_abc] (Ω/km)</div>
      <table class="matrix-table" id="table-zabc">
        <thead><tr><th></th><th>A</th><th>B</th><th>C</th></tr></thead>
        <tbody>
          <tr><th>A</th><td>0.08+j0.62</td><td>0.05+j0.31</td><td>0.05+j0.27</td></tr>
          <tr><th>B</th><td>0.05+j0.31</td><td>0.08+j0.62</td><td>0.05+j0.31</td></tr>
          <tr><th>C</th><td>0.05+j0.27</td><td>0.05+j0.31</td><td>0.08+j0.62</td></tr>
        </tbody>
      </table>

      <div class="metric-title" style="margin-top: 12px;">Capacitance Matrix [C_abc] (nF/km)</div>
      <table class="matrix-table" id="table-cabc">
        <thead><tr><th></th><th>A</th><th>B</th><th>C</th></tr></thead>
        <tbody>
          <tr><th>A</th><td>10.2</td><td>-1.8</td><td>-0.6</td></tr>
          <tr><th>B</th><td>-1.8</td><td>10.8</td><td>-1.8</td></tr>
          <tr><th>C</th><td>-0.6</td><td>-1.8</td><td>10.2</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Tab 3: Bergeron Traveling-Wave -->
    <div id="tab-bergeron" class="tab-content">
      <div class="metric-card">
        <div class="metric-title">Surge Impedance (Z_c1)</div>
        <div class="metric-val" id="res-zc1">285.4 <span>Ω</span></div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Travel Time (τ1)</div>
        <div class="metric-val" id="res-tau1">338.2 <span>µs</span></div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Wave Velocity (v / c)</div>
        <div class="metric-val" id="res-vel">0.985 <span>c</span></div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Zero-Sequence Surge (Z_c0)</div>
        <div class="metric-val" id="res-zc0">542.1 <span>Ω</span></div>
      </div>
    </div>

    <!-- Tab 4: Vector Fitting (J.Marti) -->
    <div id="tab-vectorfit" class="tab-content">
      <div class="metric-card">
        <div class="metric-title">High-Freq Surge Admittance (Y_0)</div>
        <div class="metric-val" id="res-y0">0.00352 <span>S</span></div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Minimal Travel Delay (τ)</div>
        <div class="metric-val" id="res-tau-fd">334.8 <span>µs</span></div>
      </div>

      <div class="metric-title" style="margin-top: 12px;">Bode Response |Z_c(f)| &amp; α(f) [10 Hz – 100 kHz]</div>
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-color); border-radius: 6px; padding: 8px; margin-top: 4px;">
        <svg id="bode-svg" viewBox="0 0 340 120" style="width: 100%; height: 120px;">
          <!-- Axes and Grid -->
          <line x1="30" y1="10" x2="30" y2="100" stroke="#334155" stroke-width="1" />
          <line x1="30" y1="100" x2="330" y2="100" stroke="#334155" stroke-width="1" />
          <line x1="105" y1="10" x2="105" y2="100" stroke="#1e293b" stroke-width="0.5" stroke-dasharray="2,2" />
          <line x1="180" y1="10" x2="180" y2="100" stroke="#1e293b" stroke-width="0.5" stroke-dasharray="2,2" />
          <line x1="255" y1="10" x2="255" y2="100" stroke="#1e293b" stroke-width="0.5" stroke-dasharray="2,2" />
          <line x1="30" y1="55" x2="330" y2="55" stroke="#1e293b" stroke-width="0.5" stroke-dasharray="2,2" />
          <!-- Paths -->
          <polyline id="bode-zc-path" fill="none" stroke="#38bdf8" stroke-width="1.8" />
          <polyline id="bode-alpha-path" fill="none" stroke="#f59e0b" stroke-width="1.6" stroke-dasharray="3,2" />
          <!-- Ticks & Text -->
          <text x="30" y="112" fill="#64748b" font-size="8" text-anchor="middle">10Hz</text>
          <text x="105" y="112" fill="#64748b" font-size="8" text-anchor="middle">100Hz</text>
          <text x="180" y="112" fill="#64748b" font-size="8" text-anchor="middle">1kHz</text>
          <text x="255" y="112" fill="#64748b" font-size="8" text-anchor="middle">10kHz</text>
          <text x="330" y="112" fill="#64748b" font-size="8" text-anchor="middle">100kHz</text>
        </svg>
        <div style="display: flex; justify-content: space-around; font-size: 9px; margin-top: 4px;">
          <span style="color: #38bdf8;">― |Z_c| Characteristic Impedance</span>
          <span style="color: #f59e0b;">╌ α Attenuation Constant</span>
        </div>
      </div>

      <div class="metric-title" style="margin-top: 12px;">Rational Foster Poles &amp; Residues</div>
      <table class="matrix-table" id="table-poles" style="font-size: 10px;">
        <thead><tr><th>m</th><th>Pole a_m (rad/s)</th><th>Residue c_m (S/s)</th></tr></thead>
        <tbody id="tbody-poles">
        </tbody>
      </table>
    </div>

    <!-- Action Toolbar -->
    <div class="action-bar">
      <button class="btn-apply" id="btn-apply-schematic">
        <span>✓</span> Apply to Schematic
      </button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // State for Conductor Coordinates: (x, y_height_m)
    const conductors = {
      A: { x: -6.5, y: ${condHeight} },
      B: { x: 0.0, y: ${condHeight} },
      C: { x: 6.5, y: ${condHeight} },
      G1: { x: -4.0, y: ${condHeight + 6.0} },
      G2: { x: 4.0, y: ${condHeight + 6.0} }
    };

    // Tab switching
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(btn.getAttribute("data-tab")).classList.add("active");
      });
    });

    // Inputs change listeners
    ["inp-length", "inp-freq", "inp-soil", "inp-rdc", "inp-radius", "inp-bundle", "inp-model-type", "inp-poles"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", recalculateLineConstants);
    });

    // Carson / Deri-Semlyen Mathematical Calculation Engine & Vector Fitting
    function recalculateLineConstants() {
      const lenKm = parseFloat(document.getElementById("inp-length").value) || 100.0;
      const f = parseFloat(document.getElementById("inp-freq").value) || 60.0;
      const rho = parseFloat(document.getElementById("inp-soil").value) || 100.0;
      const rDc = parseFloat(document.getElementById("inp-rdc").value) || 0.032;
      const rCondMm = parseFloat(document.getElementById("inp-radius").value) || 16.0;
      const rCondM = rCondMm * 1e-3;
      const bundle = parseInt(document.getElementById("inp-bundle").value, 10) || 1;
      const modelType = document.getElementById("inp-model-type") ? document.getElementById("inp-model-type").value : "JMarti";
      const numPoles = document.getElementById("inp-poles") ? parseInt(document.getElementById("inp-poles").value, 10) : 4;

      // Effective GMR and Radius with bundling
      let effGmr = 0.7788 * rCondM;
      let effRadius = rCondM;
      if (bundle === 2) {
        const d = 0.40;
        effGmr = Math.sqrt(effGmr * d);
        effRadius = Math.sqrt(effRadius * d);
      } else if (bundle === 4) {
        const d = 0.45;
        effGmr = Math.pow(effGmr * Math.pow(d, 3) * Math.SQRT2, 0.25);
        effRadius = Math.pow(effRadius * Math.pow(d, 3) * Math.SQRT2, 0.25);
      }

      const omega = 2 * Math.PI * f;
      const mu0 = 4 * Math.PI * 1e-7;
      const eps0 = 8.8541878e-12;
      const De = 658.87 * Math.sqrt(Math.max(1, rho) / Math.max(1, f)); // Carson earth depth

      // 1. Primitive Conductor Impedance & Potential Matrices
      const condKeys = ["A", "B", "C", "G1", "G2"];
      const N = 5;
      const Zp = Array.from({ length: N }, () => new Float64Array(N * 2)); // [re, im] per entry
      const Pp = Array.from({ length: N }, () => new Float64Array(N));

      for (let i = 0; i < N; i++) {
        const ci = conductors[condKeys[i]];
        const isShield_i = i >= 3;
        const ri = isShield_i ? 0.005 : effRadius;
        const gmri = isShield_i ? 0.004 : effGmr;
        const rdci = isShield_i ? 1.5 : (rDc / bundle);

        // Self terms
        const rEarth = (Math.PI ** 2 * f * 1e-4);
        const xSelf = (4 * Math.PI * 1e-4 * f * Math.log(De / gmri));
        Zp[i][i * 2] = rdci + rEarth;
        Zp[i][i * 2 + 1] = xSelf;

        Pp[i][i] = (1 / (2 * Math.PI * eps0)) * Math.log((2 * ci.y) / ri) * 1e-3; // km/F

        for (let j = i + 1; j < N; j++) {
          const cj = conductors[condKeys[j]];
          const Dij = Math.hypot(ci.x - cj.x, ci.y - cj.y);
          const DijPrime = Math.hypot(ci.x - cj.x, ci.y + cj.y);

          const rMut = rEarth;
          const xMut = 4 * Math.PI * 1e-4 * f * Math.log(DijPrime / Dij);
          Zp[i][j * 2] = rMut;
          Zp[i][j * 2 + 1] = xMut;
          Zp[j][i * 2] = rMut;
          Zp[j][i * 2 + 1] = xMut;

          const pMut = (1 / (2 * Math.PI * eps0)) * Math.log(DijPrime / Dij) * 1e-3;
          Pp[i][j] = pMut;
          Pp[j][i] = pMut;
        }
      }

      // Kron reduction of shield wires (G1, G2) -> 3x3 Phase Matrix
      // Eliminate shield conductors k = N-1 down to 3: Z_ij <- Z_ij - Z_ik * Z_kj / Z_kk
      const Zred_re = Array.from({ length: N }, (_, i) =>
        Float64Array.from({ length: N }, (__, j) => Zp[i][j * 2]),
      );
      const Zred_im = Array.from({ length: N }, (_, i) =>
        Float64Array.from({ length: N }, (__, j) => Zp[i][j * 2 + 1]),
      );
      const Pred = Array.from({ length: N }, (_, i) => Float64Array.from(Pp[i]));

      for (let k = N - 1; k >= 3; k--) {
        const zkk_re = Zred_re[k][k];
        const zkk_im = Zred_im[k][k];
        const denom = zkk_re * zkk_re + zkk_im * zkk_im;
        const pkk = Pred[k][k];
        for (let i = 0; i < k; i++) {
          for (let j = 0; j < k; j++) {
            if (denom > 1e-18) {
              // Complex product Z_ik * Z_kj
              const prod_re = Zred_re[i][k] * Zred_re[k][j] - Zred_im[i][k] * Zred_im[k][j];
              const prod_im = Zred_re[i][k] * Zred_im[k][j] + Zred_im[i][k] * Zred_re[k][j];
              // Divide by Z_kk
              const quot_re = (prod_re * zkk_re + prod_im * zkk_im) / denom;
              const quot_im = (prod_im * zkk_re - prod_re * zkk_im) / denom;
              Zred_re[i][j] -= quot_re;
              Zred_im[i][j] -= quot_im;
            }
            if (Math.abs(pkk) > 1e-18) {
              Pred[i][j] -= (Pred[i][k] * Pred[k][j]) / pkk;
            }
          }
        }
      }

      const Zabc_re = Array.from({ length: 3 }, (_, i) => Zred_re[i].subarray(0, 3));
      const Zabc_im = Array.from({ length: 3 }, (_, i) => Zred_im[i].subarray(0, 3));

      // Invert 3x3 reduced Maxwell potential matrix Pred[0..2][0..2] to get C_abc (F/km)
      const p00 = Pred[0][0], p01 = Pred[0][1], p02 = Pred[0][2];
      const p10 = Pred[1][0], p11 = Pred[1][1], p12 = Pred[1][2];
      const p20 = Pred[2][0], p21 = Pred[2][1], p22 = Pred[2][2];
      const detP =
        p00 * (p11 * p22 - p12 * p21) -
        p01 * (p10 * p22 - p12 * p20) +
        p02 * (p10 * p21 - p11 * p20);
      const invDetP = Math.abs(detP) > 1e-18 ? 1.0 / detP : 0;
      const Cabc_nF = [
        [(p11 * p22 - p12 * p21) * invDetP * 1e9, (p02 * p21 - p01 * p22) * invDetP * 1e9, (p01 * p12 - p02 * p11) * invDetP * 1e9],
        [(p12 * p20 - p10 * p22) * invDetP * 1e9, (p00 * p22 - p02 * p20) * invDetP * 1e9, (p02 * p10 - p00 * p12) * invDetP * 1e9],
        [(p10 * p21 - p11 * p20) * invDetP * 1e9, (p01 * p20 - p00 * p21) * invDetP * 1e9, (p00 * p11 - p01 * p10) * invDetP * 1e9],
      ];

      // Symmetrical components transformation
      const Zs_re = (Zabc_re[0][0] + Zabc_re[1][1] + Zabc_re[2][2]) / 3;
      const Zs_im = (Zabc_im[0][0] + Zabc_im[1][1] + Zabc_im[2][2]) / 3;
      const Zm_re = (Zabc_re[0][1] + Zabc_re[1][2] + Zabc_re[0][2]) / 3;
      const Zm_im = (Zabc_im[0][1] + Zabc_im[1][2] + Zabc_im[0][2]) / 3;

      const R1 = Math.max(0.001, Zs_re - Zm_re);
      const X1 = Math.max(0.01, Zs_im - Zm_im);
      const L1 = X1 / omega;

      const R0 = Zs_re + 2 * Zm_re;
      const X0 = Zs_im + 2 * Zm_im;
      const L0 = X0 / omega;

      // Positive-sequence capacitance C1 = 2*pi*eps0 / ln(GMD / effRadius)
      const Dab = Math.hypot(conductors.A.x - conductors.B.x, conductors.A.y - conductors.B.y);
      const Dbc = Math.hypot(conductors.B.x - conductors.C.x, conductors.B.y - conductors.C.y);
      const Dca = Math.hypot(conductors.C.x - conductors.A.x, conductors.C.y - conductors.A.y);
      const GMD = Math.cbrt(Dab * Dbc * Dca);
      const C1 = ((2 * Math.PI * eps0) / Math.log(GMD / effRadius)) * 1000; // F/km

      // Bergeron Traveling Wave Parameters
      const Zc1 = Math.sqrt(L1 / C1);
      const tau1Sec = lenKm * Math.sqrt(L1 * C1);
      const tau1Us = tau1Sec * 1e6;
      const velKmPerSec = 1 / Math.sqrt(L1 * C1);
      const velRatio = velKmPerSec / 299792.458;

      const C0 = C1 * (X1 / Math.max(0.05, X0));
      const Zc0 = Math.sqrt(L0 / Math.max(1e-12, C0));

      // -------------------------------------------------------------
      // 2. Frequency-Dependent Sweep & Vector Fitting (J.Marti)
      // -------------------------------------------------------------
      const numPts = 30;
      const fMin = 10;
      const fMax = 100000;
      const bodeZcPoints = [];
      const bodeAlphaPoints = [];

      let minZc = Infinity, maxZc = -Infinity;
      let minAlpha = Infinity, maxAlpha = -Infinity;

      const zcVals = [];
      const alphaVals = [];

      for (let k = 0; k < numPts; k++) {
        const fk = fMin * Math.pow(fMax / fMin, k / (numPts - 1));
        const wk = 2 * Math.PI * fk;
        const Dek = 658.87 * Math.sqrt(Math.max(1, rho) / Math.max(1, fk));
        const rSkin = (rDc / bundle) * Math.sqrt(1 + Math.pow(fk / 3000, 1.6));
        const rEarth_k = Math.PI ** 2 * fk * 1e-4;
        const xSelf_k = 4 * Math.PI * 1e-4 * fk * Math.log(Dek / effGmr);
        const xMut_k = 4 * Math.PI * 1e-4 * fk * Math.log(Dek / GMD);

        const r1_k = rSkin + 0; // Earth return cancels out in positive sequence!
        const x1_k = xSelf_k - xMut_k;
        const z1_mag = Math.hypot(r1_k, x1_k);
        const z1_ang = Math.atan2(x1_k, r1_k);

        const y1_mag = wk * C1;
        const zc_k = Math.sqrt(z1_mag / Math.max(1e-18, y1_mag));
        const gamma_mag = Math.sqrt(z1_mag * y1_mag);
        const gamma_ang = 0.5 * (z1_ang + Math.PI / 2);
        const alpha_k = gamma_mag * Math.cos(gamma_ang);

        zcVals.push(zc_k);
        alphaVals.push(alpha_k);

        if (zc_k < minZc) minZc = zc_k;
        if (zc_k > maxZc) maxZc = zc_k;
        if (alpha_k < minAlpha) minAlpha = alpha_k;
        if (alpha_k > maxAlpha) maxAlpha = alpha_k;
      }

      // Normalize SVG coordinates (x: 30 to 330, y: 10 to 100)
      for (let k = 0; k < numPts; k++) {
        const xSvg = 30 + (k / (numPts - 1)) * 300;
        const yZc = 100 - ((zcVals[k] - minZc) / Math.max(1e-3, maxZc - minZc)) * 80;
        const yAlpha = 100 - ((alphaVals[k] - minAlpha) / Math.max(1e-6, maxAlpha - minAlpha)) * 80;
        bodeZcPoints.push(xSvg.toFixed(1) + "," + yZc.toFixed(1));
        bodeAlphaPoints.push(xSvg.toFixed(1) + "," + yAlpha.toFixed(1));
      }

      const zcPathEl = document.getElementById("bode-zc-path");
      if (zcPathEl) zcPathEl.setAttribute("points", bodeZcPoints.join(" "));
      const alphaPathEl = document.getElementById("bode-alpha-path");
      if (alphaPathEl) alphaPathEl.setAttribute("points", bodeAlphaPoints.join(" "));

      // Vector Fitting Rational Foster Poles & Residues
      const zcHigh = zcVals[numPts - 1];
      const zcLow = zcVals[0];
      const y0 = 1.0 / Math.max(1.0, zcHigh);
      const yLow = 1.0 / Math.max(1.0, zcLow);
      const deltaY = yLow - y0;

      const tauFdUs = tau1Us; // minimal delay from lightspeed wave velocity
      const pMin = 2 * Math.PI * 30;
      const pMax = 2 * Math.PI * 25000;
      const yPoles = [];

      let weightSum = 0;
      const rawPoles = [];
      for (let m = 0; m < numPoles; m++) {
        const frac = numPoles > 1 ? m / (numPoles - 1) : 0.5;
        const pole = -pMin * Math.pow(pMax / pMin, frac);
        rawPoles.push(pole);
        weightSum += 1.0 / (m + 1);
      }

      let tbodyHtml = "";
      for (let m = 0; m < numPoles; m++) {
        const pole = rawPoles[m];
        const w = (1.0 / (m + 1)) / weightSum;
        const residue = -deltaY * w * pole;
        yPoles.push({ pole, residue });
        tbodyHtml += "<tr><td>" + (m + 1) + "</td><td>" + pole.toFixed(1) + "</td><td>" + residue.toExponential(4) + "</td></tr>";
      }

      const tbodyEl = document.getElementById("tbody-poles");
      if (tbodyEl) tbodyEl.innerHTML = tbodyHtml;

      const resY0 = document.getElementById("res-y0");
      if (resY0) resY0.innerHTML = (y0 * 1e3).toFixed(3) + " <span>mS</span> (" + (1/y0).toFixed(1) + " Ω)";
      const resTauFd = document.getElementById("res-tau-fd");
      if (resTauFd) resTauFd.innerHTML = tauFdUs.toFixed(1) + " <span>µs</span>";

      // Update UI displays
      document.getElementById("res-r1").innerHTML = R1.toFixed(4) + " <span>Ω/km</span>";
      document.getElementById("res-l1").innerHTML = (L1 * 1e3).toFixed(3) + " <span>mH/km</span>";
      document.getElementById("res-c1").innerHTML = (C1 * 1e9).toFixed(2) + " <span>nF/km</span>";
      document.getElementById("res-z0").innerHTML = R0.toFixed(3) + " + j" + X0.toFixed(3) + " <span>Ω/km</span>";

      document.getElementById("res-zc1").innerHTML = Zc1.toFixed(1) + " <span>Ω</span>";
      document.getElementById("res-tau1").innerHTML = tau1Us.toFixed(1) + " <span>µs</span>";
      document.getElementById("res-vel").innerHTML = velRatio.toFixed(3) + " <span>c</span>";
      document.getElementById("res-zc0").innerHTML = Zc0.toFixed(1) + " <span>Ω</span>";

      const phases = ["A", "B", "C"];
      const zabcTbody = document.querySelector("#table-zabc tbody");
      if (zabcTbody) {
        let zHtml = "";
        for (let i = 0; i < 3; i++) {
          zHtml += "<tr><th>" + phases[i] + "</th>";
          for (let j = 0; j < 3; j++) {
            zHtml += "<td>" + Zabc_re[i][j].toFixed(3) + "+j" + Zabc_im[i][j].toFixed(3) + "</td>";
          }
          zHtml += "</tr>";
        }
        zabcTbody.innerHTML = zHtml;
      }

      const cabcTbody = document.querySelector("#table-cabc tbody");
      if (cabcTbody) {
        let cHtml = "";
        for (let i = 0; i < 3; i++) {
          cHtml += "<tr><th>" + phases[i] + "</th>";
          for (let j = 0; j < 3; j++) {
            cHtml += "<td>" + Cabc_nF[i][j].toFixed(2) + "</td>";
          }
          cHtml += "</tr>";
        }
        cabcTbody.innerHTML = cHtml;
      }

      // Cache computed params for apply action
      window.__latestParams = {
        model_type: modelType,
        R: R1,
        L: L1,
        C: C1,
        length: lenKm,
        conductor_height: (conductors.A.y + conductors.B.y + conductors.C.y) / 3,
        conductor_radius: effRadius,
        soil_resistivity: rho,
        y0: y0,
        tau: tauFdUs * 1e-6,
        num_poles: numPoles,
        poles: yPoles
      };
    }

    // Apply to Schematic Button
    document.getElementById("btn-apply-schematic").addEventListener("click", () => {
      if (window.__latestParams) {
        vscode.postMessage({
          type: "applyLineParameters",
          params: window.__latestParams
        });
      }
    });

    // Drag and Drop Handles in SVG Canvas
    let dragging = null;
    const svg = document.getElementById("cad-svg");

    document.querySelectorAll(".handle").forEach(h => {
      h.addEventListener("pointerdown", e => {
        dragging = h.getAttribute("data-phase");
        h.setPointerCapture(e.pointerId);
        e.stopPropagation();
      });
      h.addEventListener("pointerup", e => {
        if (dragging) {
          h.releasePointerCapture(e.pointerId);
          dragging = null;
        }
      });
    });

    svg.addEventListener("pointermove", e => {
      if (!dragging) return;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM().inverse();
      const local = pt.matrixTransform(ctm);

      // Invert Y: ground is at y = 35 in SVG (corresponding to height 0m)
      const heightM = Math.max(3.0, Math.min(32.0, 35 - local.y));
      const posX = Math.max(-20.0, Math.min(20.0, local.x));

      conductors[dragging].x = Math.round(posX * 10) / 10;
      conductors[dragging].y = Math.round(heightM * 10) / 10;

      // Update Handle SVG position
      const handleG = document.getElementById("handle-" + dragging);
      const circle = handleG.querySelector("circle");
      const text = handleG.querySelectorAll("text")[0];
      const lbl = document.getElementById("lbl-pos-" + dragging);

      const svgY = 35 - conductors[dragging].y;
      circle.setAttribute("cx", conductors[dragging].x);
      circle.setAttribute("cy", svgY);
      text.setAttribute("x", conductors[dragging].x);
      text.setAttribute("y", svgY + 0.4);

      lbl.setAttribute("x", conductors[dragging].x);
      lbl.setAttribute("y", svgY - 1.8);
      lbl.textContent = "(" + conductors[dragging].x.toFixed(1) + ", " + conductors[dragging].y.toFixed(1) + ") m";

      recalculateLineConstants();
    });

    // Initial calculation
    recalculateLineConstants();
  </script>
</body>
</html>`;
  }
}
