// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the simulation results webview panel lifecycle.
// Sends simulation requests to the LSP server and displays results as a chart.
// Supports both batch (one-shot) and live (MQTT streaming) simulation modes.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { CadViewerPanel } from "./cadViewerPanel";
import { MultiBodyAnimationPanel } from "./multibodyAnimationPanel";

interface SimulationResult {
  t: number[];
  y: number[][];
  states: string[];
  parameters?: {
    name: string;
    type: "real" | "integer" | "boolean" | "enumeration";
    defaultValue: number;
    min?: number;
    max?: number;
    step: number;
    unit?: string;
    enumLiterals?: { ordinal: number; label: string }[];
  }[];
  experiment?: { startTime?: number; stopTime?: number; interval?: number; tolerance?: number };
  error?: string;
}

export class SimulationPanel {
  static currentPanel: SimulationPanel | undefined;
  static readonly viewType = "modelscript.simulation";

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly liveMode: boolean;
  public sourceUri?: string;
  private client?: LanguageClient;
  private disposables: vscode.Disposable[] = [];
  private currentSurrogate?: {
    modelId: string;
    wasmC: string;
    emccFlags: string[];
    exportedFunctions: string[];
  };

  static async createOrShow(extensionUri: vscode.Uri, client: LanguageClient) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "modelica") {
      vscode.window.showWarningMessage("Open a Modelica file to run a simulation.");
      return;
    }

    // Send simulate request to LSP
    const uri = editor.document.uri.toString();

    // Show progress
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Running simulation...",
        cancellable: false,
      },
      async () => {
        const result: SimulationResult = await client.sendRequest("modelscript/simulate", { uri });

        if (result.error) {
          vscode.window.showErrorMessage(`Simulation failed: ${result.error}`);
          return;
        }

        if (result.t.length === 0) {
          vscode.window.showWarningMessage("Simulation produced no data.");
          return;
        }

        // Create or reuse panel
        if (SimulationPanel.currentPanel) {
          SimulationPanel.currentPanel.sourceUri = uri;
          SimulationPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
          SimulationPanel.currentPanel.postResults(result);
          return;
        }

        const panel = vscode.window.createWebviewPanel(
          SimulationPanel.viewType,
          "Simulation Results",
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
          },
        );

        SimulationPanel.currentPanel = new SimulationPanel(panel, extensionUri, false);
        SimulationPanel.currentPanel.client = client;
        SimulationPanel.currentPanel.sourceUri = uri;
        SimulationPanel.currentPanel.postResults(result);
      },
    );
  }

  /**
   * Render a plot for externally generated data (like client-side FMU JS evaluations).
   */
  static createOrShowWithData(extensionUri: vscode.Uri, result: SimulationResult, uri: string): void {
    if (SimulationPanel.currentPanel) {
      SimulationPanel.currentPanel.sourceUri = uri;
      SimulationPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      SimulationPanel.currentPanel.postResults(result);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SimulationPanel.viewType,
      "Simulation Results",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    SimulationPanel.currentPanel = new SimulationPanel(panel, extensionUri, false);
    SimulationPanel.currentPanel.sourceUri = uri;
    SimulationPanel.currentPanel.postResults(result);
  }

  /**
   * Open the simulation webview in live MQTT streaming mode.
   * Connects to the MQTT broker via WebSocket and plots incoming data in real-time.
   */
  static createOrShowLive(extensionUri: vscode.Uri, sessionId?: string, participantId?: string): void {
    const mqttWsUrl =
      vscode.workspace.getConfiguration("modelscript.cosim").get<string>("mqttWsUrl") ?? "ws://localhost:9001";

    // Always create a new panel for live mode (don't reuse batch panels)
    if (SimulationPanel.currentPanel?.liveMode) {
      SimulationPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      SimulationPanel.currentPanel.postLiveConfig(mqttWsUrl, sessionId, participantId);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SimulationPanel.viewType,
      "Live Simulation",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    SimulationPanel.currentPanel = new SimulationPanel(panel, extensionUri, true);
    SimulationPanel.currentPanel.postLiveConfig(mqttWsUrl, sessionId, participantId);
  }

  /** Open a live-plot panel in browser-local mode (no WebSocket, data via postMessage). */
  static createOrShowLiveLocal(extensionUri: vscode.Uri, sessionId?: string): SimulationPanel {
    if (SimulationPanel.currentPanel?.liveMode) {
      SimulationPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      SimulationPanel.currentPanel.postLiveLocalConfig(sessionId);
      return SimulationPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      SimulationPanel.viewType,
      "Live Simulation (Local)",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    SimulationPanel.currentPanel = new SimulationPanel(panel, extensionUri, true);
    SimulationPanel.currentPanel.postLiveLocalConfig(sessionId);
    return SimulationPanel.currentPanel;
  }

  /** Push a single data point to a live local webview. */
  static postLiveDataPoint(variable: string, time: number, value: number): void {
    if (SimulationPanel.currentPanel?.liveMode) {
      SimulationPanel.currentPanel.panel.webview.postMessage({
        type: "liveDataPoint",
        variable,
        time,
        value,
      });
    }

    // Forward live values to the 3D CAD viewer for animation
    if (CadViewerPanel.currentPanel) {
      CadViewerPanel.currentPanel.sendLiveValues({ [variable]: value }, time);
    }
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, liveMode: boolean) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.liveMode = liveMode;
    this.panel.webview.html = this.getHtmlForWebview();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === "simulateRequest" && this.client) {
          const uri = this.sourceUri;
          if (!uri) return;

          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Simulating with new parameters...",
              cancellable: false,
            },
            async () => {
              if (!this.client) return;
              const result: SimulationResult = await this.client.sendRequest("modelscript/simulate", {
                uri,
                startTime: msg.payload.startTime,
                stopTime: msg.payload.stopTime,
                interval: msg.payload.interval,
                parameterOverrides: msg.payload.parameterOverrides,
              });

              if (result.error) {
                vscode.window.showErrorMessage(`Simulation failed: ${result.error}`);
                return;
              }
              if (result.t.length === 0) {
                vscode.window.showWarningMessage("Simulation produced no data.");
                return;
              }

              // Inject user requested overrides back into the result so the webview preserves them
              if (result.experiment) {
                if (msg.payload.startTime !== undefined) result.experiment.startTime = msg.payload.startTime;
                if (msg.payload.stopTime !== undefined) result.experiment.stopTime = msg.payload.stopTime;
                if (msg.payload.interval !== undefined) result.experiment.interval = msg.payload.interval;
                if (msg.payload.tolerance !== undefined) result.experiment.tolerance = msg.payload.tolerance;
              } else {
                result.experiment = {
                  startTime: msg.payload.startTime,
                  stopTime: msg.payload.stopTime,
                  interval: msg.payload.interval,
                  tolerance: msg.payload.tolerance,
                };
              }

              if (result.parameters && msg.payload.parameterOverrides) {
                for (const p of result.parameters) {
                  if (msg.payload.parameterOverrides[p.name] !== undefined) {
                    p.defaultValue = msg.payload.parameterOverrides[p.name];
                  }
                }
              }

              this.postResults(result);
            },
          );
        } else if (msg.type === "trainSurrogate" && this.client) {
          const uri = this.sourceUri;
          if (!uri) return;

          this.panel.webview.postMessage({
            type: "surrogateTrainingProgress",
            progress: 10,
            message: "Running Design of Experiments...",
          });

          try {
            const result = await this.client.sendRequest<{
              success: boolean;
              metrics?: { trainMSE: number; valMSE: number; r2: number };
              wasmC: string;
              emccFlags: string[];
              exportedFunctions: string[];
              error?: string;
            }>("modelscript/trainSurrogate", {
              uri,
              ...msg.payload,
            });

            if (result.success && result.metrics) {
              this.currentSurrogate = {
                modelId: (uri.split("/").pop() ?? "Surrogate").replace(".mo", ""),
                wasmC: result.wasmC,
                emccFlags: result.emccFlags,
                exportedFunctions: result.exportedFunctions,
              };

              this.panel.webview.postMessage({
                type: "surrogateTrainingComplete",
                metrics: result.metrics,
              });
            } else {
              this.panel.webview.postMessage({
                type: "surrogateTrainingError",
                error: result.error || "Unknown error occurred during training.",
              });
            }
          } catch (e) {
            this.panel.webview.postMessage({
              type: "surrogateTrainingError",
              error: e instanceof Error ? e.message : String(e),
            });
          }
        } else if (msg.type === "exportSurrogate") {
          if (!this.currentSurrogate) return;
          const folder = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file("/");
          const modelName = this.currentSurrogate.modelId;
          const cUri = vscode.Uri.joinPath(folder, `${modelName}_wasm.c`);
          const buildUri = vscode.Uri.joinPath(folder, `BUILD_WASM.md`);

          try {
            await vscode.workspace.fs.writeFile(cUri, new TextEncoder().encode(this.currentSurrogate.wasmC));

            const buildCmd = `emcc ${modelName}_wasm.c ${this.currentSurrogate.emccFlags.join(" ")} -o ${modelName}.js`;
            await vscode.workspace.fs.writeFile(
              buildUri,
              new TextEncoder().encode(
                [
                  `# WebAssembly Surrogate Build Instructions`,
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
                  ...this.currentSurrogate.exportedFunctions.map((f: string) => `- \`${f}\``),
                ].join("\n"),
              ),
            );

            vscode.window.showInformationMessage(`Exported surrogate WASM source to ${modelName}_wasm.c`);
          } catch (e) {
            vscode.window.showErrorMessage(`Failed to export surrogate WASM: ${e}`);
          }
        } else if (msg.type === "open3dAnimation" && this.client && this.sourceUri) {
          // Launch the 3D Multi-Body Animation viewer
          MultiBodyAnimationPanel.createOrShow(
            this.extensionUri,
            this.client,
            msg.payload.simulationData,
            this.sourceUri,
          );
        }
      },
      null,
      this.disposables,
    );
  }

  public postResults(result: SimulationResult) {
    const isDark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    this.panel.webview.postMessage({ type: "simulationData", data: result, isDark });

    // Also forward simulation data to the 3D CAD viewer for animation
    if (CadViewerPanel.currentPanel && result.t && result.y && result.states) {
      CadViewerPanel.currentPanel.sendSimulationData(result.t, result.y, result.states);
    }
  }

  private postLiveConfig(mqttWsUrl: string, sessionId?: string, participantId?: string) {
    const isDark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    this.panel.webview.postMessage({
      type: "liveMode",
      mqttWsUrl,
      sessionId,
      participantId,
      isDark,
    });
  }

  private postLiveLocalConfig(sessionId?: string) {
    const isDark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    this.panel.webview.postMessage({
      type: "liveLocalMode",
      sessionId,
      isDark,
    });
  }

  /**
   * Forward verification limit lines to the simulation chart overlay.
   * Each limit draws a dashed horizontal line at the constraint value.
   */
  static postVerificationLimits(limits: { variable: string; value: number; label: string; violated: boolean }[]): void {
    if (SimulationPanel.currentPanel) {
      SimulationPanel.currentPanel.panel.webview.postMessage({
        type: "verificationLimits",
        limits,
      });
    }
  }

  /**
   * Forward Monte Carlo statistics to the simulation chart for fan-chart rendering.
   * The webview already handles 'monteCarloData' messages with percentile band drawing.
   */
  static postMonteCarloData(
    data: {
      numSamples: number;
      statistics: Record<
        string,
        {
          mean: number[];
          stddev: number[];
          ciLo: number[];
          ciHi: number[];
          percentiles: Record<string, number[]>;
        }
      >;
      t: number[];
      convergence: { coeffOfVariation: number; effectiveSampleSize: number };
    },
    isDark: boolean,
  ): void {
    if (SimulationPanel.currentPanel) {
      SimulationPanel.currentPanel.panel.webview.postMessage({
        type: "monteCarloData",
        data,
        isDark,
      });
    }
  }

  private getHtmlForWebview(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "simulationWebview.js"));
    const nonce = getNonce();

    // Allow WebSocket connections for live MQTT streaming
    const connectSrc = this.liveMode ? "connect-src ws: wss:;" : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; ${connectSrc}">
  <title>Simulation Results</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-foreground, #ccc);
      font-family: var(--vscode-font-family, system-ui, sans-serif);
    }
    #main-layout {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: row;
    }
    #sidebar {
      width: 300px;
      min-width: 200px;
      max-width: 50%;
      resize: horizontal;
      overflow-y: auto;
      overflow-x: hidden;
      border-right: 1px solid var(--vscode-panel-border, #333);
      background: var(--vscode-sideBar-background, #252526);
      display: flex;
      flex-direction: column;
    }
    .sidebar-section {
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .sidebar-section.collapsed {
      flex: 0 0 auto;
    }
    .sidebar-header {
      padding: 8px 16px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-sideBarTitle-foreground, #ccc);
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      background: rgba(0,0,0,0.1);
    }
    .sidebar-header:hover {
      background: rgba(0,0,0,0.2);
    }
    .sidebar-header::before {
      content: "▼";
      font-size: 9px;
      margin-right: 6px;
      transition: transform 0.1s;
    }
    .sidebar-section.collapsed .sidebar-header::before {
      transform: rotate(-90deg);
    }
    .sidebar-content {
      padding: 4px 0;
      display: block;
      flex: 1;
      overflow-y: auto;
    }
    .sidebar-section.collapsed .sidebar-content {
      display: none;
    }
    .settings-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 16px;
      font-size: 12px;
    }
    .settings-row label {
      color: var(--vscode-sideBar-foreground, #ccc);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-right: 8px;
    }
    .settings-row input {
      width: 80px;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 2px 4px;
      font-family: inherit;
      font-size: 12px;
      border-radius: 2px;
    }
    .settings-row input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    .simulate-btn-container {
      padding: 12px 16px;
    }
    .simulate-btn {
      width: 100%;
      padding: 6px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .simulate-btn:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
    #tree-view, #parameters-view {
      margin: 0;
    }
    #chart-container {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    canvas {
      flex: 1;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
    }
    #toolbar {
      display: none;
      padding: 6px 16px;
      gap: 8px;
      align-items: center;
      font-size: 12px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
    }
    #toolbar.visible { display: flex; }
    #toolbar:not(.live-mode) .live-only {
      display: none;
    }
    #toolbar select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      padding: 4px 8px;
      font-family: inherit;
      font-size: 11px;
      border-radius: 2px;
      cursor: pointer;
    }
    #toolbar select:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    #toolbar button {
      padding: 2px 8px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 2px;
      background: var(--vscode-button-secondaryBackground, #333);
      color: var(--vscode-button-secondaryForeground, #ccc);
      cursor: pointer;
      font-size: 12px;
    }
    #toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, #444); }
    #toolbar .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #666;
    }
    #toolbar .status-indicator.connected { background: #2da44e; }
    #toolbar .status-indicator.connecting { background: #bf8700; animation: pulse 1s infinite; }
    #toolbar .status-indicator.error { background: #cf222e; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    #toolbar .status-text { color: var(--vscode-descriptionForeground); }
    #toolbar .spacer { flex: 1; }
    /* Tree View Native Controls */
    .tree-node {
      list-style: none;
      padding-left: 8px;
      margin: 0;
    }
    .tree-root {
      padding-left: 0;
    }
    .tree-item {
      display: flex;
      align-items: center;
      padding: 4px 4px 4px 8px;
      cursor: pointer;
      user-select: none;
      color: var(--vscode-sideBar-foreground, #ccc);
      font-size: 13px;
    }
    .tree-item:hover {
      background: var(--vscode-list-hoverBackground, #2a2d2e);
    }
    .tree-caret {
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.1s;
    }
    .tree-caret::before {
      content: "▶";
      font-size: 10px;
      color: var(--vscode-icon-foreground, #c5c5c5);
    }
    .tree-caret.expanded {
      transform: rotate(90deg);
    }
    .tree-caret.empty {
      visibility: hidden;
    }
    .tree-checkbox {
      margin: 0 6px 0 0;
      accent-color: var(--vscode-button-background, #0e639c);
      cursor: pointer;
    }
    .tree-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tree-children {
      display: none;
      margin: 0;
      padding: 0;
    }
    .tree-children.expanded {
      display: block;
    }
    canvas {
      flex: 1;
    }
    #placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      opacity: 0.6;
      font-size: 14px;
    }
    #tooltip {
      position: absolute;
      display: none;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 12px;
      pointer-events: none;
      z-index: 10;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
  </style>
</head>
<body>
  <div id="main-layout">
    <div id="sidebar">
      <div class="sidebar-section">
        <div class="sidebar-header" onclick="this.parentElement.classList.toggle('collapsed')">Variables</div>
        <div class="sidebar-content">
          <ul id="tree-view" class="tree-node tree-root"></ul>
        </div>
      </div>
      <div class="sidebar-section" id="params-section" style="display: none;">
        <div class="sidebar-header" onclick="this.parentElement.classList.toggle('collapsed')">Parameters</div>
        <div class="sidebar-content" id="parameters-view"></div>
      </div>
      <div class="sidebar-section" id="settings-section" style="display: none;">
        <div class="sidebar-header" onclick="this.parentElement.classList.toggle('collapsed')">Simulation Settings</div>
        <div class="sidebar-content" id="settings-view">
          <div class="settings-row"><label>Start Time</label><input type="number" id="st-start" step="any"></div>
          <div class="settings-row"><label>Stop Time</label><input type="number" id="st-stop" step="any"></div>
          <div class="settings-row"><label>Interval</label><input type="number" id="st-interval" step="any"></div>
          <div class="settings-row"><label>Tolerance</label><input type="number" id="st-tolerance" step="any"></div>
          <div class="simulate-btn-container">
            <button id="btn-simulate" class="simulate-btn">Simulate</button>
          </div>
        </div>
      </div>
      <div class="sidebar-section collapsed" id="surrogate-section" style="display: none;">
        <div class="sidebar-header" onclick="this.parentElement.classList.toggle('collapsed')">Surrogate Training</div>
        <div class="sidebar-content" id="surrogate-view">
          <div class="settings-row">
            <label>DoE Strategy</label>
            <select id="surrogate-strategy" style="width: 100px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);">
              <option value="latin-hypercube">LHS</option>
              <option value="full-factorial">Factorial</option>
              <option value="sobol">Sobol</option>
              <option value="central-composite">CCD</option>
            </select>
          </div>
          <div class="settings-row">
            <label>Samples</label>
            <input type="number" id="surrogate-samples" value="50" min="1">
          </div>
          <div class="settings-row">
            <label>Architecture</label>
            <select id="surrogate-arch" style="width: 100px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);">
              <option value="mlp">MLP</option>
              <option value="rbf">RBF</option>
              <option value="polynomial">Polynomial</option>
            </select>
          </div>
          <div class="simulate-btn-container">
            <button id="btn-train-surrogate" class="simulate-btn">Train Surrogate</button>
          </div>
          <div id="surrogate-progress" style="padding: 0 16px; font-size: 11px; display: none;">
            <div style="margin-bottom: 4px;">Training... <span id="surrogate-status">0%</span></div>
            <div style="width: 100%; height: 4px; background: var(--vscode-editor-background); border-radius: 2px;">
              <div id="surrogate-progress-bar" style="width: 0%; height: 100%; background: var(--vscode-progressBar-background, #0e70c0); border-radius: 2px;"></div>
            </div>
          </div>
          <div id="surrogate-results" style="padding: 8px 16px; font-size: 11px; display: none; border-top: 1px solid var(--vscode-panel-border);">
            <div style="margin-bottom: 4px;"><strong>R² Score:</strong> <span id="surrogate-r2"></span></div>
            <div style="margin-bottom: 8px;"><strong>Train MSE:</strong> <span id="surrogate-mse"></span></div>
            <button id="btn-export-surrogate" class="simulate-btn" style="background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);">Generate WASM</button>
          </div>
        </div>
      </div>
    </div>
    <div id="chart-container">
      <div id="toolbar">
        <div class="status-indicator live-only" id="live-status"></div>
        <span class="status-text live-only" id="live-status-text">Disconnected</span>
        <span class="spacer"></span>
        <label style="display: flex; align-items: center; gap: 4px; color: var(--vscode-foreground); cursor: pointer;">
          <input type="checkbox" id="checkbox-smooth" checked> Smooth Curves
        </label>
        <button id="btn-pause" class="live-only">⏸ Pause</button>
        <button id="btn-clear" class="live-only">Clear</button>
        <button id="btn-3d-animation" style="display: none; background: #2da44e; color: white;">🎬 3D Animation</button>
        <button id="btn-reset-view">⌂ Reset View</button>
      </div>
      <!-- legend was removed -->
      <canvas id="canvas"></canvas>
      <div id="tooltip"></div>
    </div>
  </div>
  <div id="placeholder">Run a simulation to see results</div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose() {
    SimulationPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) x.dispose();
    }
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
