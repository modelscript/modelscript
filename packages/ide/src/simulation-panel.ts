// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the simulation results webview panel lifecycle.
// Sends simulation requests to the LSP server and displays results as a chart.
// Supports both batch (one-shot) and live (MQTT streaming) simulation modes.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { CadViewerPanel } from "./cad-viewer-panel";
import { MultiBodyAnimationPanel } from "./multibody-animation-panel";

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
    description?: string;
    enumLiterals?: { ordinal: number; label: string }[];
  }[];
  experiment?: { startTime?: number; stopTime?: number; interval?: number; tolerance?: number };
  error?: string;
  sweepResults?: { value: number; y: number[][] }[];
  telemetry?: { executionTimeMs: number; stepCount: number };
}

export class SimulationPanel {
  static currentPanel: SimulationPanel | undefined;
  static readonly viewType = "modelscript.simulation";

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly liveMode: boolean;
  public sourceUri?: string;
  public client?: LanguageClient;
  private isReady = false;
  private lastResult?: SimulationResult;
  private lastLiveConfig?: {
    type: "live" | "liveLocal";
    mqttWsUrl?: string;
    sessionId?: string;
    participantId?: string;
  };
  private disposables: vscode.Disposable[] = [];

  static async createOrShow(extensionUri: vscode.Uri, client: LanguageClient) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Open a model file to run a simulation.");
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
  static createOrShowWithData(
    extensionUri: vscode.Uri,
    result: SimulationResult,
    uri: string,
    client?: LanguageClient,
  ): void {
    if (SimulationPanel.currentPanel) {
      SimulationPanel.currentPanel.sourceUri = uri;
      if (client) SimulationPanel.currentPanel.client = client;
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
    if (client) SimulationPanel.currentPanel.client = client;
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
        if (msg.type === "ready") {
          this.isReady = true;
          if (this.lastResult) {
            this.postResults(this.lastResult);
          } else if (this.lastLiveConfig) {
            if (this.lastLiveConfig.type === "live") {
              this.postLiveConfig(
                this.lastLiveConfig.mqttWsUrl || "",
                this.lastLiveConfig.sessionId,
                this.lastLiveConfig.participantId,
              );
            } else {
              this.postLiveLocalConfig(this.lastLiveConfig.sessionId);
            }
          }
        } else if (msg.type === "simulateRequest" && this.client) {
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
              let result: SimulationResult;
              try {
                result = await this.client.sendRequest("modelscript/simulate", {
                  uri,
                  startTime: msg.payload?.startTime,
                  stopTime: msg.payload?.stopTime,
                  interval: msg.payload?.interval,
                  solver: msg.payload?.solver,
                  rtol: msg.payload?.rtol,
                  atol: msg.payload?.atol,
                  numberOfIntervals: msg.payload?.numberOfIntervals,
                  maxStep: msg.payload?.maxStep,
                  steadyStateOnly: msg.payload?.steadyStateOnly,
                  parameterOverrides: msg.payload?.parameterOverrides,
                  sweepConfig: msg.payload?.sweepConfig,
                });
              } catch {
                const activeDoc = vscode.window.activeTextEditor?.document;
                const res: any = await this.client.sendRequest("modelscript/executeAction", {
                  actionId: "simulate",
                  languageId: activeDoc?.languageId ?? "modelica",
                  uri,
                  inputs: {
                    documentText: activeDoc?.getText(),
                    startTime: msg.payload?.startTime,
                    stopTime: msg.payload?.stopTime,
                    interval: msg.payload?.interval,
                    solver: msg.payload?.solver,
                    rtol: msg.payload?.rtol,
                    atol: msg.payload?.atol,
                    numberOfIntervals: msg.payload?.numberOfIntervals,
                    maxStep: msg.payload?.maxStep,
                    steadyStateOnly: msg.payload?.steadyStateOnly,
                    parameterOverrides: msg.payload?.parameterOverrides,
                    sweepConfig: msg.payload?.sweepConfig,
                  },
                });
                result = {
                  t: Array.isArray(res?.t) ? res.t : Object.values(res?.t || {}),
                  y: Array.isArray(res?.y) ? res.y : Object.values(res?.y || {}),
                  states: res?.states || [],
                  parameters: res?.parameters,
                  experiment: res?.experiment,
                  error: res?.error,
                  sweepResults: res?.sweepResults,
                  telemetry: res?.telemetry,
                };
              }

              if (result && result.t) {
                result.t = Array.isArray(result.t) ? result.t : Object.values(result.t);
              }
              if (result && result.y) {
                const rawY = Array.isArray(result.y) ? result.y : Object.values(result.y);
                result.y = rawY.map((row: any) => (Array.isArray(row) ? row : Object.values(row)));
              }

              if (result.error) {
                vscode.window.showErrorMessage(`Simulation failed: ${result.error}`);
                return;
              }
              if (!result.t || result.t.length === 0) {
                vscode.window.showWarningMessage("Simulation produced no data.");
                return;
              }

              // Inject user requested overrides back into the result so the webview preserves them
              if (result.experiment) {
                if (msg.payload?.startTime !== undefined) result.experiment.startTime = msg.payload.startTime;
                if (msg.payload?.stopTime !== undefined) result.experiment.stopTime = msg.payload.stopTime;
                if (msg.payload?.interval !== undefined) result.experiment.interval = msg.payload.interval;
                if (msg.payload?.tolerance !== undefined) result.experiment.tolerance = msg.payload.tolerance;
              } else {
                result.experiment = {
                  startTime: msg.payload?.startTime,
                  stopTime: msg.payload?.stopTime,
                  interval: msg.payload?.interval,
                  tolerance: msg.payload?.tolerance,
                };
              }

              if (result.parameters && msg.payload?.parameterOverrides) {
                for (const p of result.parameters) {
                  if (msg.payload.parameterOverrides[p.name] !== undefined) {
                    p.defaultValue = msg.payload.parameterOverrides[p.name];
                  }
                }
              }

              this.postResults(result);
            },
          );
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
    this.lastResult = result;
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
    this.lastLiveConfig = { type: "live", mqttWsUrl, sessionId, participantId };
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
    this.lastLiveConfig = { type: "liveLocal", sessionId };
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
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "simulation-webview.js"));
    const nonce = getNonce();

    // Allow WebSocket connections for live MQTT streaming
    const connectSrc = this.liveMode ? "connect-src ws: wss:;" : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; ${connectSrc}">
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
      gap: 8px;
    }
    .settings-row.checkbox-row {
      justify-content: flex-start;
      gap: 12px;
    }
    .settings-row.checkbox-row input[type="checkbox"] {
      width: auto;
      margin: 0;
      cursor: pointer;
    }
    .settings-row label {
      color: var(--vscode-sideBar-foreground, #ccc);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-right: 4px;
    }
    .settings-row input, .settings-row select {
      width: 95px;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 2px 4px;
      font-family: inherit;
      font-size: 12px;
      border-radius: 2px;
    }
    .settings-row input:focus, .settings-row select:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    .section-badge {
      margin-left: 6px;
      padding: 1px 6px;
      font-size: 10px;
      font-weight: 500;
      border-radius: 10px;
      background: rgba(128, 128, 128, 0.2);
      color: var(--vscode-descriptionForeground, #aaa);
    }
    .header-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .icon-btn {
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground, #888);
      cursor: pointer;
      font-size: 10px;
      padding: 2px 4px;
      border-radius: 2px;
    }
    .icon-btn:hover {
      color: var(--vscode-foreground, #fff);
      background: rgba(255, 255, 255, 0.08);
    }
    .sidebar-controls {
      padding: 4px 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      border-bottom: 1px solid rgba(128, 128, 128, 0.15);
    }
    .search-box {
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-box input {
      width: 100%;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 3px 20px 3px 6px;
      font-family: inherit;
      font-size: 11px;
      border-radius: 2px;
    }
    .search-box input:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    .search-box .clear-btn {
      position: absolute;
      right: 4px;
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground, #888);
      cursor: pointer;
      font-size: 10px;
      padding: 0 2px;
      display: none;
    }
    .bulk-actions {
      display: flex;
      gap: 4px;
    }
    .bulk-actions button {
      flex: 1;
      padding: 2px 4px;
      font-size: 10px;
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
      border: 1px solid transparent;
      border-radius: 2px;
      cursor: pointer;
    }
    .bulk-actions button:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
    .advanced-settings-details {
      margin: 8px 16px;
      border-top: 1px dashed var(--vscode-panel-border, #444);
      padding-top: 6px;
    }
    .advanced-summary {
      font-size: 11px;
      font-weight: 500;
      color: var(--vscode-descriptionForeground, #888);
      cursor: pointer;
      user-select: none;
      outline: none;
    }
    .advanced-content {
      padding-top: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .advanced-content .settings-row {
      padding: 2px 0;
    }
    .sidebar-footer {
      padding: 10px 14px;
      background: var(--vscode-sideBar-background, #252526);
      border-top: 1px solid var(--vscode-panel-border, #333);
      flex-shrink: 0;
    }
    .sim-telemetry {
      font-size: 10px;
      font-family: monospace;
      color: #2da44e;
      text-align: center;
      margin-bottom: 6px;
    }
    .simulate-btn {
      width: 100%;
      padding: 6px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .simulate-btn:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
    .btn-subtext {
      font-size: 10px;
      opacity: 0.75;
      font-weight: normal;
    }
    /* Parameter Item UI */
    .param-item {
      display: flex;
      flex-direction: column;
      padding: 6px 14px;
      border-bottom: 1px solid rgba(128, 128, 128, 0.08);
      font-size: 12px;
    }
    .param-item.hidden {
      display: none;
    }
    .param-item-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .param-label {
      display: flex;
      align-items: center;
      color: var(--vscode-sideBar-foreground, #ccc);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .param-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #007acc;
      margin-right: 6px;
      flex-shrink: 0;
    }
    .param-actions {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .param-action-btn {
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground, #888);
      cursor: pointer;
      font-size: 11px;
      padding: 1px 3px;
      border-radius: 2px;
    }
    .param-action-btn:hover {
      color: var(--vscode-foreground, #fff);
      background: rgba(255, 255, 255, 0.1);
    }
    .param-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .param-slider {
      flex: 1;
      height: 4px;
      cursor: pointer;
      accent-color: var(--vscode-button-background, #0e639c);
    }
    .param-input {
      width: 70px;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 2px 4px;
      font-family: inherit;
      font-size: 11px;
      border-radius: 2px;
    }
    .param-sweep-panel {
      margin-top: 6px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 3px;
      padding: 6px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 11px;
    }
    .param-sweep-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .param-sweep-row label {
      width: 36px;
      color: var(--vscode-descriptionForeground, #888);
    }
    .param-sweep-row input {
      flex: 1;
      width: 50px;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 1px 4px;
      font-size: 10px;
    }
    .btn-run-sweep {
      padding: 3px 6px;
      background: #8957e5;
      color: white;
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-size: 10px;
      font-weight: 600;
      margin-top: 2px;
    }
    .btn-run-sweep:hover {
      background: #a371f7;
    }
    /* Variable Item Dual-Y Pill and Metrics */
    .tree-item-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .axis-pill {
      font-size: 9px;
      font-weight: 600;
      padding: 0 4px;
      border-radius: 3px;
      border: 1px solid rgba(128,128,128,0.4);
      background: rgba(0,0,0,0.2);
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      user-select: none;
    }
    .axis-pill.right {
      border-color: #f78166;
      color: #f78166;
      background: rgba(247, 129, 102, 0.15);
    }
    .var-stat-pill {
      font-size: 9px;
      font-family: monospace;
      color: var(--vscode-descriptionForeground);
      opacity: 0.8;
      margin-right: 4px;
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
      padding: 6px 12px;
      gap: 8px;
      align-items: center;
      font-size: 12px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      flex-wrap: wrap;
    }
    #toolbar.visible { display: flex; }
    #toolbar:not(.live-mode) .live-only {
      display: none;
    }
    .toolbar-group {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .toolbar-divider {
      width: 1px;
      height: 16px;
      background: var(--vscode-panel-border, #444);
      margin: 0 2px;
    }
    #toolbar select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      padding: 3px 6px;
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
      padding: 3px 8px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 2px;
      background: var(--vscode-button-secondaryBackground, #333);
      color: var(--vscode-button-secondaryForeground, #ccc);
      cursor: pointer;
      font-size: 11px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
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
    #cursor-hud {
      display: none;
      position: absolute;
      bottom: 45px;
      left: 70px;
      background: rgba(30, 30, 30, 0.92);
      backdrop-filter: blur(8px);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      border-radius: 4px;
      padding: 6px 14px;
      font-size: 11px;
      font-family: var(--vscode-editor-font-family, monospace);
      color: #eee;
      z-index: 5;
      pointer-events: none;
      box-shadow: 0 4px 14px rgba(0,0,0,0.45);
      flex-wrap: wrap;
      gap: 16px;
    }
    #cursor-hud.visible {
      display: flex;
    }
    .hud-metric {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .hud-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground, #888);
    }
    .hud-value {
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div id="main-layout">
    <div id="sidebar">
      <div class="sidebar-section" id="vars-section">
        <div class="sidebar-header">
          <span>Variables</span>
          <span id="var-count-badge" class="section-badge"></span>
        </div>
        <div class="sidebar-controls">
          <div class="search-box">
            <input type="text" id="var-search" placeholder="Search variables (e.g. der, v)..." autocomplete="off">
            <button id="btn-clear-var-search" class="clear-btn" title="Clear filter">✕</button>
          </div>
          <div class="bulk-actions">
            <button id="btn-vars-all" title="Select All">All</button>
            <button id="btn-vars-none" title="Deselect All">None</button>
            <button id="btn-vars-invert" title="Invert Selection">Invert</button>
            <button id="btn-vars-states" title="Filter State Variables">der(*)</button>
          </div>
        </div>
        <div class="sidebar-content">
          <ul id="tree-view" class="tree-node tree-root"></ul>
        </div>
      </div>

      <div class="sidebar-section" id="params-section" style="display: none;">
        <div class="sidebar-header">
          <span>Parameters</span>
          <div class="header-actions">
            <span id="param-modified-badge" class="section-badge" style="display: none;"></span>
            <button id="btn-reset-all-params" class="icon-btn" title="Reset all modified parameters to defaults">↺ Reset All</button>
          </div>
        </div>
        <div class="sidebar-controls">
          <div class="search-box">
            <input type="text" id="param-search" placeholder="Search parameters..." autocomplete="off">
            <button id="btn-clear-param-search" class="clear-btn" title="Clear filter">✕</button>
          </div>
        </div>
        <div class="sidebar-content" id="parameters-view"></div>
      </div>

      <div class="sidebar-section" id="settings-section" style="display: none;">
        <div class="sidebar-header"><span>Simulation Settings</span></div>
        <div class="sidebar-content" id="settings-view">
          <div class="settings-row">
            <label for="st-preset">Preset</label>
            <select id="st-preset" class="settings-select">
              <option value="standard">Standard (DOPRI5)</option>
              <option value="fast">Fast Preview (RK4)</option>
              <option value="high-accuracy">High Accuracy (1e-7)</option>
              <option value="stiff">Stiff DAE (CVODE/BDF)</option>
              <option value="steady-state">Steady-State Only</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div class="settings-row">
            <label for="st-solver">Solver</label>
            <select id="st-solver" class="settings-select">
              <option value="dopri5">DOPRI5 (Adaptive 5(4))</option>
              <option value="cvode">CVODE / BDF (Stiff DAE)</option>
              <option value="rodas4p">RODAS4P (SDIRK Stiff)</option>
              <option value="tsit5">Tsit5 (Fast Non-Stiff)</option>
              <option value="rk4">RK4 (Classic Fixed-Step)</option>
              <option value="euler">Euler (Explicit Real-Time)</option>
              <option value="webgpu">WebGPU (Batched)</option>
            </select>
          </div>
          <div class="settings-row"><label for="st-start">Start Time</label><input type="number" id="st-start" step="any"></div>
          <div class="settings-row"><label for="st-stop">Stop Time</label><input type="number" id="st-stop" step="any"></div>
          <div class="settings-row"><label for="st-interval">Interval (dt)</label><input type="number" id="st-interval" step="any"></div>
          <div class="settings-row"><label for="st-tolerance">Tolerance</label><input type="number" id="st-tolerance" step="any"></div>
          
          <details class="advanced-settings-details" id="st-advanced-details">
            <summary class="advanced-summary">Advanced Settings</summary>
            <div class="advanced-content">
              <div class="settings-row"><label for="st-rtol">Rel. Tol (rtol)</label><input type="number" id="st-rtol" step="any" placeholder="1e-4"></div>
              <div class="settings-row"><label for="st-atol">Abs. Tol (atol)</label><input type="number" id="st-atol" step="any" placeholder="1e-6"></div>
              <div class="settings-row"><label for="st-max-step">Max Step Size</label><input type="number" id="st-max-step" step="any" placeholder="auto"></div>
              <div class="settings-row"><label for="st-intervals">Intervals (N)</label><input type="number" id="st-intervals" step="1" placeholder="500"></div>
              <div class="settings-row checkbox-row">
                <label for="st-steady-state" title="Solve initial steady-state equilibrium at t0 without transient integration">Steady-State Only</label>
                <input type="checkbox" id="st-steady-state">
              </div>
            </div>
          </details>
        </div>
      </div>

      <div class="sidebar-footer">
        <div id="sim-telemetry" class="sim-telemetry" style="display: none;"></div>
        <button id="btn-simulate" class="simulate-btn">
          <span>Simulate</span>
          <span class="btn-subtext">Ctrl+Enter</span>
        </button>
      </div>
    </div>
    <div id="chart-container">
      <div id="toolbar">
        <div class="status-indicator live-only" id="live-status"></div>
        <span class="status-text live-only" id="live-status-text">Disconnected</span>
        
        <div class="toolbar-group">
          <label for="select-xaxis" style="color: var(--vscode-foreground); font-size: 11px; font-weight: 500;">X:</label>
          <select id="select-xaxis" title="Select X-Axis (Time or State Variable for Phase Portrait)">
            <option value="__time__">Time (s)</option>
          </select>
        </div>

        <div class="toolbar-divider"></div>

        <label style="display: flex; align-items: center; gap: 4px; color: var(--vscode-foreground); cursor: pointer;" title="Normalize curves to 0-100% to compare different units and magnitudes">
          <input type="checkbox" id="checkbox-normalize"> Normalize (0-100%)
        </label>

        <label style="display: flex; align-items: center; gap: 4px; color: var(--vscode-foreground); cursor: pointer;" title="Dual Y-Axis (Left and Right axes for primary vs secondary variables)">
          <input type="checkbox" id="checkbox-dual-y"> Dual Y
        </label>

        <label style="display: flex; align-items: center; gap: 4px; color: var(--vscode-foreground); cursor: pointer;">
          <input type="checkbox" id="checkbox-smooth" checked> Smooth
        </label>

        <div class="toolbar-divider"></div>

        <button id="btn-toggle-cursors" title="Toggle measurement cursors A & B to inspect delta-time and delta-y">📐 Cursors</button>
        <button id="btn-pin-run" title="Pin current trajectory as ghost baseline for comparison">📌 Pin Run</button>

        <span class="spacer"></span>

        <button id="btn-export-csv" title="Download trajectory as CSV">📥 CSV</button>
        <button id="btn-export-png" title="Download chart snapshot as PNG">📷 PNG</button>
        <button id="btn-copy-csv" title="Copy trajectory data to clipboard">📋 Copy</button>

        <button id="btn-pause" class="live-only">⏸ Pause</button>
        <button id="btn-clear" class="live-only">Clear</button>
        <button id="btn-3d-animation" style="display: none; background: #2da44e; color: white;">🎬 3D Animation</button>
        <button id="btn-reset-view" title="Reset View Bounds">⌂ Reset</button>
      </div>
      <!-- legend was removed -->
      <canvas id="canvas"></canvas>
      <div id="tooltip"></div>
      <div id="cursor-hud"></div>
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
