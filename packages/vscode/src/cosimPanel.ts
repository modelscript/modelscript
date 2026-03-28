// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Co-simulation sidebar panel for VS Code.
//
// Provides a WebviewViewProvider that renders the cosim management UI:
// - Infrastructure status (API, MQTT, Historian)
// - Local/remote connection configuration
// - Session management (create, start, stop)
// - Participant enrollment (publish models/FMUs)
// - Live simulation plot trigger

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

interface SessionInfo {
  id: string;
  state: string;
  participants: number;
}

interface ParticipantInfo {
  id: string;
  modelName: string;
  type: string;
  variables: number;
}

export class CosimViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "modelscript.cosimPanel";

  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];
  private healthPollTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: LanguageClient,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext, // eslint-disable-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      async (msg: { type: string; [key: string]: unknown }) => {
        await this.handleWebviewMessage(msg);
      },
      undefined,
      this.disposables,
    );

    webviewView.onDidDispose(() => {
      this.stopHealthPoll();
      for (const d of this.disposables) d.dispose();
      this.disposables = [];
    });

    // Start health polling
    this.startHealthPoll();
  }

  /** Refresh the panel UI. */
  refresh(): void {
    void this.checkHealth();
    void this.fetchSessions();
  }

  // ── Health Polling ──

  private startHealthPoll(): void {
    void this.checkHealth();
    this.healthPollTimer = setInterval(() => void this.checkHealth(), 10_000);
  }

  private stopHealthPoll(): void {
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer);
      this.healthPollTimer = undefined;
    }
  }

  private async checkHealth(): Promise<void> {
    const apiUrl = this.getApiUrl();
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) {
        const data = (await response.json()) as {
          status: string;
          mqtt?: string;
          historian?: string;
        };
        this.postMessage({
          type: "healthUpdate",
          api: true,
          mqtt: data.mqtt === "connected",
          historian: data.historian === "connected",
        });
      } else {
        this.postMessage({ type: "healthUpdate", api: false, mqtt: false, historian: false });
      }
    } catch {
      this.postMessage({ type: "healthUpdate", api: false, mqtt: false, historian: false });
    }
  }

  // ── Message Handling ──

  private async handleWebviewMessage(msg: { type: string; [key: string]: unknown }): Promise<void> {
    const apiUrl = this.getApiUrl();

    switch (msg.type) {
      case "refresh":
        this.refresh();
        break;

      case "startInfra":
        await this.startLocalInfra();
        break;

      case "getConfig":
        this.postMessage({
          type: "config",
          apiUrl: this.getApiUrl(),
          mqttWsUrl: this.getMqttWsUrl(),
        });
        break;

      case "updateConfig": {
        const config = vscode.workspace.getConfiguration("modelscript.cosim");
        if (msg.apiUrl) await config.update("apiUrl", msg.apiUrl as string, vscode.ConfigurationTarget.Global);
        if (msg.mqttWsUrl) await config.update("mqttWsUrl", msg.mqttWsUrl as string, vscode.ConfigurationTarget.Global);
        this.postMessage({
          type: "config",
          apiUrl: this.getApiUrl(),
          mqttWsUrl: this.getMqttWsUrl(),
        });
        void this.checkHealth();
        break;
      }

      case "createSession": {
        try {
          const body = {
            startTime: (msg.startTime as number) ?? 0,
            stopTime: (msg.stopTime as number) ?? 10,
            stepSize: (msg.stepSize as number) ?? 0.01,
            realtimeFactor: (msg.realtimeFactor as number) ?? 1,
          };
          const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (resp.ok) {
            const session = await resp.json();
            this.postMessage({ type: "sessionCreated", session });
            void this.fetchSessions();
          } else {
            const err = await resp.text();
            this.postMessage({ type: "error", message: `Failed to create session: ${err}` });
          }
        } catch (e) {
          this.postMessage({ type: "error", message: `Failed to create session: ${e}` });
        }
        break;
      }

      case "fetchSessions":
        await this.fetchSessions();
        break;

      case "startSession": {
        try {
          const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions/${msg.sessionId}/start`, { method: "POST" });
          if (resp.ok) {
            void this.fetchSessions();
          } else {
            const err = await resp.text();
            this.postMessage({ type: "error", message: `Failed to start session: ${err}` });
          }
        } catch (e) {
          this.postMessage({ type: "error", message: `Failed to start session: ${e}` });
        }
        break;
      }

      case "stopSession": {
        try {
          const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions/${msg.sessionId}/stop`, { method: "POST" });
          if (resp.ok) {
            void this.fetchSessions();
          } else {
            const err = await resp.text();
            this.postMessage({ type: "error", message: `Failed to stop session: ${err}` });
          }
        } catch (e) {
          this.postMessage({ type: "error", message: `Failed to stop session: ${e}` });
        }
        break;
      }

      case "deleteSession": {
        try {
          await fetch(`${apiUrl}/api/v1/cosim/sessions/${msg.sessionId}`, { method: "DELETE" });
          void this.fetchSessions();
        } catch (e) {
          this.postMessage({ type: "error", message: `Failed to delete session: ${e}` });
        }
        break;
      }

      case "publishModel": {
        await this.publishCurrentModel(msg.sessionId as string);
        break;
      }

      case "addFmuParticipant": {
        try {
          const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions/${msg.sessionId}/participants/fmu`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fmuId: msg.fmuId }),
          });
          if (resp.ok) {
            const data = await resp.json();
            this.postMessage({ type: "participantAdded", data });
            void this.fetchSessionParticipants(msg.sessionId as string);
          } else {
            const err = await resp.text();
            this.postMessage({ type: "error", message: `Failed to add FMU: ${err}` });
          }
        } catch (e) {
          this.postMessage({ type: "error", message: `Failed to add FMU: ${e}` });
        }
        break;
      }

      case "fetchParticipants":
        await this.fetchSessionParticipants(msg.sessionId as string);
        break;

      case "openLivePlot": {
        await vscode.commands.executeCommand("modelscript.cosimOpenLivePlot", msg.sessionId, msg.participantId);
        break;
      }

      case "fetchFmus": {
        try {
          const resp = await fetch(`${apiUrl}/api/v1/fmus`);
          if (resp.ok) {
            const data = await resp.json();
            this.postMessage({ type: "fmuList", fmus: (data as { fmus: unknown[] }).fmus });
          }
        } catch {
          this.postMessage({ type: "fmuList", fmus: [] });
        }
        break;
      }
    }
  }

  // ── Session Fetching ──

  private async fetchSessions(): Promise<void> {
    const apiUrl = this.getApiUrl();
    try {
      const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions`);
      if (resp.ok) {
        const data = (await resp.json()) as { sessions: SessionInfo[] };
        this.postMessage({ type: "sessionList", sessions: data.sessions });
      }
    } catch {
      this.postMessage({ type: "sessionList", sessions: [] });
    }
  }

  private async fetchSessionParticipants(sessionId: string): Promise<void> {
    const apiUrl = this.getApiUrl();
    try {
      const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions/${sessionId}/participants`);
      if (resp.ok) {
        const data = (await resp.json()) as { participants: ParticipantInfo[] };
        this.postMessage({ type: "participantList", sessionId, participants: data.participants });
      }
    } catch {
      this.postMessage({ type: "participantList", sessionId, participants: [] });
    }
  }

  // ── Publish Model ──

  private async publishCurrentModel(sessionId: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "modelica") {
      vscode.window.showWarningMessage("Open a Modelica file to publish as a participant.");
      return;
    }

    try {
      const uri = editor.document.uri.toString();
      // Request the LSP server to simulate and register the model
      const result = await this.client.sendRequest<{ ok: boolean; participantId?: string; error?: string }>(
        "modelscript/publishParticipant",
        { uri, sessionId },
      );

      if (result.ok) {
        vscode.window.showInformationMessage(`Published model as participant: ${result.participantId}`);
        void this.fetchSessionParticipants(sessionId);
      } else {
        vscode.window.showErrorMessage(`Failed to publish: ${result.error}`);
      }
    } catch (e) {
      // Fall back to API-based simulation registration
      vscode.window.showWarningMessage(`LSP publish not supported yet. Use the API to register participants.`);
      console.error("[cosim] publish error:", e);
    }
  }

  // ── Local Infrastructure ──

  private async startLocalInfra(): Promise<void> {
    const terminal = vscode.window.createTerminal({
      name: "ModelScript Infrastructure",
      iconPath: new vscode.ThemeIcon("server-process"),
    });
    terminal.show();
    terminal.sendText("docker compose up -d mqtt timescaledb api");
    vscode.window.showInformationMessage(
      "Starting local infrastructure (MQTT + TimescaleDB + API)... Check the terminal for progress.",
    );

    // Start checking health more frequently until services are up
    const fastPoll = setInterval(async () => {
      await this.checkHealth();
    }, 3_000);

    setTimeout(() => clearInterval(fastPoll), 60_000);
  }

  // ── Config Helpers ──

  private getApiUrl(): string {
    return vscode.workspace.getConfiguration("modelscript.cosim").get<string>("apiUrl") ?? "http://localhost:3000";
  }

  private getMqttWsUrl(): string {
    return vscode.workspace.getConfiguration("modelscript.cosim").get<string>("mqttWsUrl") ?? "ws://localhost:9001";
  }

  // ── PostMessage ──

  private postMessage(msg: Record<string, unknown>): void {
    void this.view?.webview.postMessage(msg);
  }

  // ── HTML ──

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "cosimWebview.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Co-Simulation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 0;
      overflow-x: hidden;
    }
    .section {
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      padding: 10px 14px;
    }
    .section-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarSectionHeader-foreground);
      margin-bottom: 8px;
      cursor: pointer;
      user-select: none;
    }
    .section-header .chevron {
      font-size: 10px;
      transition: transform 0.15s;
    }
    .section-header.collapsed .chevron {
      transform: rotate(-90deg);
    }
    .section-body.hidden {
      display: none;
    }
    .status-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 3px 0;
      font-size: 12px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .status-dot.online { background: var(--vscode-testing-iconPassed, #2da44e); }
    .status-dot.offline { background: var(--vscode-testing-iconFailed, #cf222e); }
    .status-dot.unknown { background: var(--vscode-disabledForeground, #666); }
    .status-label { flex: 1; }
    .status-value {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    button {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      font-size: 12px;
      font-family: inherit;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 2px;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .btn-row {
      display: flex;
      gap: 6px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .btn-block {
      width: 100%;
      justify-content: center;
    }
    input, select {
      width: 100%;
      padding: 4px 6px;
      font-size: 12px;
      font-family: inherit;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      outline: none;
    }
    input:focus, select:focus {
      border-color: var(--vscode-focusBorder);
    }
    .field {
      margin-bottom: 6px;
    }
    .field label {
      display: block;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 2px;
    }
    .session-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px 10px;
      margin-bottom: 6px;
    }
    .session-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
    }
    .session-meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }
    .session-actions {
      display: flex;
      gap: 4px;
      margin-top: 6px;
    }
    .session-actions button {
      font-size: 11px;
      padding: 2px 6px;
    }
    .badge {
      display: inline-block;
      padding: 1px 6px;
      font-size: 10px;
      font-weight: 600;
      border-radius: 10px;
      text-transform: uppercase;
    }
    .badge.created { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .badge.running { background: #2da44e20; color: #2da44e; }
    .badge.completed { background: #0969da20; color: #0969da; }
    .badge.error { background: #cf222e20; color: #cf222e; }
    .empty-state {
      padding: 12px 0;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .error-msg {
      background: var(--vscode-inputValidation-errorBackground, #5a121220);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      color: var(--vscode-errorForeground);
      padding: 6px 8px;
      border-radius: 3px;
      font-size: 12px;
      margin-top: 6px;
    }
    .connection-form {
      margin-top: 6px;
    }
  </style>
</head>
<body>
  <!-- Infrastructure Status -->
  <div class="section" id="status-section">
    <div class="section-header" data-section="status">
      <span class="chevron">▾</span>
      Infrastructure Status
    </div>
    <div class="section-body" id="status-body">
      <div class="status-row">
        <div class="status-dot unknown" id="api-dot"></div>
        <span class="status-label">API Server</span>
        <span class="status-value" id="api-status">checking…</span>
      </div>
      <div class="status-row">
        <div class="status-dot unknown" id="mqtt-dot"></div>
        <span class="status-label">MQTT Broker</span>
        <span class="status-value" id="mqtt-status">checking…</span>
      </div>
      <div class="status-row">
        <div class="status-dot unknown" id="historian-dot"></div>
        <span class="status-label">Historian DB</span>
        <span class="status-value" id="historian-status">checking…</span>
      </div>
      <div class="btn-row">
        <button id="btn-start-infra" class="secondary">Start Local</button>
        <button id="btn-connect-remote" class="secondary">Configure…</button>
        <button id="btn-refresh" class="secondary" title="Refresh">⟳</button>
      </div>
    </div>
  </div>

  <!-- Connection Configuration (hidden by default) -->
  <div class="section" id="config-section" style="display:none">
    <div class="section-header" data-section="config">
      <span class="chevron">▾</span>
      Connection Settings
    </div>
    <div class="section-body" id="config-body">
      <div class="connection-form">
        <div class="field">
          <label>API URL</label>
          <input type="text" id="input-api-url" placeholder="http://localhost:3000">
        </div>
        <div class="field">
          <label>MQTT WebSocket URL</label>
          <input type="text" id="input-mqtt-url" placeholder="ws://localhost:9001">
        </div>
        <div class="btn-row">
          <button id="btn-save-config">Save</button>
          <button id="btn-cancel-config" class="secondary">Cancel</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Sessions -->
  <div class="section" id="sessions-section">
    <div class="section-header" data-section="sessions">
      <span class="chevron">▾</span>
      Sessions
    </div>
    <div class="section-body" id="sessions-body">
      <div id="sessions-list"></div>
      <div class="btn-row">
        <button id="btn-create-session" class="btn-block">+ New Session</button>
      </div>
    </div>
  </div>

  <!-- Create Session Form (hidden by default) -->
  <div class="section" id="new-session-section" style="display:none">
    <div class="section-header">
      <span class="chevron">▾</span>
      New Session
    </div>
    <div class="section-body">
      <div class="field">
        <label>Start Time</label>
        <input type="number" id="input-start-time" value="0" step="0.1">
      </div>
      <div class="field">
        <label>Stop Time</label>
        <input type="number" id="input-stop-time" value="10" step="0.1">
      </div>
      <div class="field">
        <label>Step Size</label>
        <input type="number" id="input-step-size" value="0.01" step="0.001">
      </div>
      <div class="field">
        <label>Real-time Factor (0 = as fast as possible)</label>
        <input type="number" id="input-rt-factor" value="1" step="0.1">
      </div>
      <div class="btn-row">
        <button id="btn-submit-session">Create</button>
        <button id="btn-cancel-session" class="secondary">Cancel</button>
      </div>
    </div>
  </div>

  <div id="error-container"></div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
