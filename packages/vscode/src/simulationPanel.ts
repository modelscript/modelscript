// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the simulation results webview panel lifecycle.
// Sends simulation requests to the LSP server and displays results as a chart.
// Supports both batch (one-shot) and live (MQTT streaming) simulation modes.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

interface SimulationResult {
  t: number[];
  y: number[][];
  states: string[];
  error?: string;
}

export class SimulationPanel {
  static currentPanel: SimulationPanel | undefined;
  static readonly viewType = "modelscript.simulation";

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly liveMode: boolean;
  private disposables: vscode.Disposable[] = [];

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
        SimulationPanel.currentPanel.postResults(result);
      },
    );
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
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, liveMode: boolean) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.liveMode = liveMode;
    this.panel.webview.html = this.getHtmlForWebview();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private postResults(result: SimulationResult) {
    const isDark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    this.panel.webview.postMessage({ type: "simulationData", data: result, isDark });
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
    #chart-container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
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
    #legend {
      padding: 8px 16px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      font-size: 12px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      opacity: 1;
      transition: opacity 0.15s;
    }
    .legend-item.hidden {
      opacity: 0.35;
      text-decoration: line-through;
    }
    .legend-swatch {
      width: 12px;
      height: 3px;
      border-radius: 1px;
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
  <div id="chart-container">
    <div id="toolbar">
      <div class="status-indicator" id="live-status"></div>
      <span class="status-text" id="live-status-text">Disconnected</span>
      <span class="spacer"></span>
      <button id="btn-pause">⏸ Pause</button>
      <button id="btn-clear">Clear</button>
    </div>
    <div id="legend"></div>
    <canvas id="canvas"></canvas>
    <div id="tooltip"></div>
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
