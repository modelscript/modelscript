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
import type { BrowserBroker } from "./browser-broker";
import type { BrowserHistorian } from "./browser-historian";
import { CosimLocalEngine, type ParticipantInfo, type SessionInfo } from "./cosim-local-engine";
import { isFeatureEnabled } from "./utils/config.js";
import { getNonce } from "./utils/nonce.js";

export class CosimViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "modelscript.cosimPanel";

  private view?: vscode.WebviewView | undefined;
  private disposables: vscode.Disposable[] = [];
  private healthPollTimer?: ReturnType<typeof setInterval> | undefined;
  private fastPollTimer?: ReturnType<typeof setInterval> | undefined;
  private fastPollStopTimer?: ReturnType<typeof setTimeout> | undefined;

  private readonly localEngine: CosimLocalEngine;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: LanguageClient,
  ) {
    this.localEngine = new CosimLocalEngine(this.client, (msg) => this.postMessage(msg));
  }

  /** Whether browser-local mode is active. */
  get isLocalMode(): boolean {
    return this.localEngine.isLocalMode;
  }

  /** The browser broker instance (when local mode is active). */
  get broker(): BrowserBroker | null {
    return this.localEngine.broker;
  }

  /** The browser historian instance (when local mode is active). */
  get historian(): BrowserHistorian | null {
    return this.localEngine.historian;
  }

  /** Publish an SSP archive, creating local FMU participants for each component and wiring them together. */
  public async localPublishSsp(sessionId: string): Promise<void> {
    return this.localEngine.localPublishSsp(sessionId);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.stopHealthPoll();
    this.stopFastInfraPoll();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];

    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      async (msg: unknown) => {
        await this.handleWebviewMessage(msg);
      },
      undefined,
      this.disposables,
    );

    this.disposables.push(
      webviewView.onDidDispose(() => {
        this.stopHealthPoll();
        this.stopFastInfraPoll();
        for (const d of this.disposables) d.dispose();
        this.disposables = [];
        if (this.view === webviewView) {
          this.view = undefined;
        }
      }),
    );

    if (typeof webviewView.onDidChangeVisibility === "function") {
      this.disposables.push(
        webviewView.onDidChangeVisibility(() => {
          if (webviewView.visible && isFeatureEnabled("coSimulation")) {
            this.startHealthPoll();
          } else {
            this.stopHealthPoll();
          }
        }),
      );
    }

    // Detect co-simulation wrapper files in the active editor
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (isFeatureEnabled("coSimulation")) {
          this.detectCosimWrapper(editor);
        }
      }),
    );
    if (isFeatureEnabled("coSimulation")) {
      this.detectCosimWrapper(vscode.window.activeTextEditor);
      if (webviewView.visible) {
        this.startHealthPoll();
      }
    }
  }

  /** Dispose all timers, listeners, and local runtime state. */
  dispose(): void {
    this.stopHealthPoll();
    this.stopFastInfraPoll();
    this.localEngine.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.view = undefined;
  }

  /** Refresh the panel UI. */
  refresh(): void {
    void this.checkHealth();
    void this.fetchSessions();
  }

  // ── Health Polling ──

  private startHealthPoll(): void {
    this.stopHealthPoll();
    if (!isFeatureEnabled("coSimulation")) return;
    void this.checkHealth();
    this.healthPollTimer = setInterval(() => {
      if (this.view?.visible && isFeatureEnabled("coSimulation")) {
        void this.checkHealth();
      }
    }, 10_000);
  }

  private stopHealthPoll(): void {
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer);
      this.healthPollTimer = undefined;
    }
  }

  private stopFastInfraPoll(): void {
    if (this.fastPollTimer) {
      clearInterval(this.fastPollTimer);
      this.fastPollTimer = undefined;
    }
    if (this.fastPollStopTimer) {
      clearTimeout(this.fastPollStopTimer);
      this.fastPollStopTimer = undefined;
    }
  }

  private getSessionId(msg: Record<string, unknown>): string | null {
    const id = msg["sessionId"];
    return typeof id === "string" && id.trim().length > 0 ? id : null;
  }

  private validateEndpointUrl(raw: unknown, allowedProtocols: readonly string[]): string | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      if (!allowedProtocols.includes(parsed.protocol)) return null;
      return trimmed;
    } catch {
      return null;
    }
  }

  private async checkHealth(): Promise<void> {
    // If local mode is active, report local status
    if (this.localEngine.isLocalMode) {
      this.postMessage({
        type: "healthUpdate",
        api: false,
        mqtt: "local",
        historian: "local",
        localMode: true,
      });
      return;
    }

    const apiUrl = this.getApiUrl();
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) {
        const data = (await response.json()) as {
          status: string;
          mqtt?: string | undefined;
          historian?: string | undefined;
        };
        this.postMessage({
          type: "healthUpdate",
          api: true,
          mqtt: data.mqtt === "connected",
          historian: data.historian === "connected",
          localMode: false,
        });
      } else {
        this.postMessage({ type: "healthUpdate", api: false, mqtt: false, historian: false, localMode: false });
      }
    } catch {
      this.postMessage({ type: "healthUpdate", api: false, mqtt: false, historian: false, localMode: false });
    }
  }

  // ── Message Handling ──

  private async handleWebviewMessage(rawMsg: unknown): Promise<void> {
    if (!rawMsg || typeof rawMsg !== "object") return;
    const msg = rawMsg as Record<string, unknown>;
    if (typeof msg["type"] !== "string") return;

    const apiUrl = this.getApiUrl();

    switch (msg["type"]) {
      case "refresh":
        this.refresh();
        break;

      case "enableLocal":
        this.localEngine.enable();
        void this.checkHealth();
        break;

      case "disableLocal":
        this.localEngine.disable();
        void this.checkHealth();
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
        if (msg["apiUrl"] !== undefined) {
          const validApiUrl = this.validateEndpointUrl(msg["apiUrl"], ["http:", "https:"]);
          if (!validApiUrl) {
            this.postMessage({ type: "error", message: "Invalid API URL. Must use http:// or https://." });
            break;
          }
          await config.update("apiUrl", validApiUrl, vscode.ConfigurationTarget.Global);
        }
        if (msg["mqttWsUrl"] !== undefined) {
          const validMqttUrl = this.validateEndpointUrl(msg["mqttWsUrl"], ["ws:", "wss:"]);
          if (!validMqttUrl) {
            this.postMessage({ type: "error", message: "Invalid MQTT WebSocket URL. Must use ws:// or wss://." });
            break;
          }
          await config.update("mqttWsUrl", validMqttUrl, vscode.ConfigurationTarget.Global);
        }
        this.postMessage({
          type: "config",
          apiUrl: this.getApiUrl(),
          mqttWsUrl: this.getMqttWsUrl(),
        });
        void this.checkHealth();
        break;
      }

      case "createSession": {
        if (this.localEngine.isLocalMode) {
          this.localEngine.localCreateSession(msg);
          break;
        }
        try {
          const body = {
            startTime: (msg["startTime"] as number) ?? 0,
            stopTime: (msg["stopTime"] as number) ?? 10,
            stepSize: (msg["stepSize"] as number) ?? 0.01,
            realtimeFactor: (msg["realtimeFactor"] as number) ?? 1,
            masterAlgorithm: (msg["masterAlgorithm"] as string) ?? "gauss-seidel",
            richardsonTolerance: (msg["richardsonTolerance"] as number) ?? 1e-4,
            autoRemediateLoops: msg["autoRemediateLoops"],
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
        if (this.localEngine.isLocalMode) {
          this.localEngine.localFetchSessions();
        } else {
          await this.fetchSessions();
        }
        break;

      case "startSession": {
        const sessionId = this.getSessionId(msg);
        if (!sessionId) break;
        if (this.localEngine.isLocalMode) {
          void this.localEngine.localStartSession(sessionId);
          break;
        }
        try {
          const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions/${encodeURIComponent(sessionId)}/start`, {
            method: "POST",
          });
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
        const sessionId = this.getSessionId(msg);
        if (!sessionId) break;
        if (this.localEngine.isLocalMode) {
          this.localEngine.localStopSession(sessionId);
          break;
        }
        try {
          const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions/${encodeURIComponent(sessionId)}/stop`, {
            method: "POST",
          });
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

      case "hardwareConnected": {
        const protocol = typeof msg["protocol"] === "string" ? msg["protocol"] : "slcan";
        const baudRate = typeof msg["baudRate"] === "number" ? msg["baudRate"] : 500000;
        const portName = typeof msg["portName"] === "string" ? msg["portName"] : "Serial Device";
        vscode.window.showInformationMessage(
          `Soft HIL: Connected to ${portName} (${protocol.toUpperCase()} @ ${baudRate} baud).`,
        );
        this.postMessage({ type: "hardwareStatus", connected: true, protocol, baudRate, portName });
        break;
      }

      case "hardwareDisconnected": {
        vscode.window.showInformationMessage("Soft HIL: Hardware disconnected.");
        this.postMessage({ type: "hardwareStatus", connected: false });
        break;
      }

      case "hardwareFrameTx":
      case "hardwareFrameRx": {
        break;
      }

      case "deleteSession": {
        const sessionId = this.getSessionId(msg);
        if (!sessionId) break;
        if (this.localEngine.isLocalMode) {
          this.localEngine.localDeleteSession(sessionId);
          break;
        }
        try {
          await fetch(`${apiUrl}/api/v1/cosim/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
          void this.fetchSessions();
        } catch (e) {
          this.postMessage({ type: "error", message: `Failed to delete session: ${e}` });
        }
        break;
      }

      case "publishModel": {
        const sessionId = this.getSessionId(msg);
        if (!sessionId) break;
        if (this.localEngine.isLocalMode) {
          this.localEngine.localPublishModel(sessionId);
          break;
        }
        await this.publishCurrentModel(sessionId);
        break;
      }

      case "publishFmu": {
        const sessionId = this.getSessionId(msg);
        if (!sessionId) break;
        if (this.localEngine.isLocalMode) {
          await this.localEngine.localPublishFmu(sessionId);
        }
        break;
      }

      case "publishSsp": {
        const sessionId = this.getSessionId(msg);
        if (!sessionId) break;
        if (this.localEngine.isLocalMode) {
          await this.localEngine.localPublishSsp(sessionId);
        }
        break;
      }

      case "publishCosimModel": {
        const sessionId = this.getSessionId(msg);
        if (!sessionId) break;
        if (this.localEngine.isLocalMode) {
          await this.localEngine.localPublishCosimModel(sessionId);
        }
        break;
      }

      case "addFmuParticipant": {
        const sessionId = this.getSessionId(msg);
        if (!sessionId) break;
        try {
          const resp = await fetch(
            `${apiUrl}/api/v1/cosim/sessions/${encodeURIComponent(sessionId)}/participants/fmu`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fmuId: msg["fmuId"] }),
            },
          );
          if (resp.ok) {
            const data = await resp.json();
            this.postMessage({ type: "participantAdded", data });
            void this.fetchSessionParticipants(sessionId);
          } else {
            const err = await resp.text();
            this.postMessage({ type: "error", message: `Failed to add FMU: ${err}` });
          }
        } catch (e) {
          this.postMessage({ type: "error", message: `Failed to add FMU: ${e}` });
        }
        break;
      }

      case "fetchParticipants": {
        const sessionId = this.getSessionId(msg);
        if (!sessionId) break;
        if (this.localEngine.isLocalMode) {
          this.localEngine.localFetchParticipants(sessionId);
        } else {
          await this.fetchSessionParticipants(sessionId);
        }
        break;
      }

      case "openLivePlot": {
        await vscode.commands.executeCommand("modelscript.cosimOpenLivePlot", msg["sessionId"], msg["participantId"]);
        break;
      }

      case "addCoupling": {
        const sessionId = this.getSessionId(msg);
        if (!sessionId) break;
        if (this.localEngine.isLocalMode) {
          this.localEngine.localAddCoupling(
            sessionId,
            msg["fromParticipantId"] as string,
            msg["fromVariable"] as string,
            msg["toParticipantId"] as string,
            msg["toVariable"] as string,
          );
        }
        break;
      }

      case "createCosimWrapper": {
        const sessionId = this.getSessionId(msg);
        if (!sessionId) break;
        if (this.localEngine.isLocalMode) {
          await this.localEngine.localCreateCosimWrapper(sessionId);
        }
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
      const resp = await fetch(`${apiUrl}/api/v1/cosim/sessions/${encodeURIComponent(sessionId)}/participants`);
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
    if (!editor) {
      vscode.window.showWarningMessage("Open a model file to publish as a participant.");
      return;
    }

    try {
      const uri = editor.document.uri.toString();
      // Request the LSP server to simulate and register the model
      const result = await this.client.sendRequest<{
        ok: boolean;
        participantId?: string | undefined;
        error?: string | undefined;
      }>("modelscript/publishParticipant", { uri, sessionId });

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
    const cmd = "docker compose up -d mqtt timescaledb api";

    // In VS Code Web, createTerminal is not available — copy command to clipboard instead
    try {
      await vscode.env.clipboard.writeText(cmd);
      await vscode.window.showInformationMessage(
        `Run the following in your terminal to start infrastructure (copied to clipboard):\n\n${cmd}`,
        "OK",
      );
    } catch {
      await vscode.window.showInformationMessage(`Run this command in your terminal:\n\n${cmd}`, "OK");
    }

    // Start checking health more frequently until services are up
    this.stopFastInfraPoll();
    this.fastPollTimer = setInterval(() => {
      void this.checkHealth();
    }, 3_000);
    this.fastPollStopTimer = setTimeout(() => {
      this.stopFastInfraPoll();
    }, 60_000);
  }

  /** Detect if the active editor contains a co-simulation wrapper model. */
  private detectCosimWrapper(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      this.postMessage({ type: "cosimWrapperDetected", detected: false });
      return;
    }
    const text = editor.document.getText();
    const hasConnect = /\bconnect\s*\(/.test(text);
    this.postMessage({ type: "cosimWrapperDetected", detected: hasConnect });
  }

  // ── Config Helpers ──

  private getApiUrl(): string {
    return vscode.workspace.getConfiguration("modelscript.cosim").get<string>("apiUrl") ?? "https://ansatz.social";
  }

  private getMqttWsUrl(): string {
    return (
      vscode.workspace.getConfiguration("modelscript.cosim").get<string>("mqttWsUrl") ?? "wss://ansatz.social/mqtt"
    );
  }

  // ── PostMessage ──

  private postMessage(msg: Record<string, unknown>): void {
    void this.view?.webview.postMessage(msg);
  }

  // ── HTML ──

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "cosim-webview.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
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

    /* ── Mode bar ── */
    .mode-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
    }
    .mode-bar select {
      flex: 1;
      padding: 4px 6px;
      font-size: 12px;
      font-family: inherit;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
    }
    .mode-status {
      font-size: 11px;
      white-space: nowrap;
    }
    .mode-status.ready { color: var(--vscode-testing-iconPassed, #2da44e); }
    .mode-status.offline { color: var(--vscode-testing-iconFailed, #cf222e); }
    .mode-status.local { color: #f0883e; }

    /* ── Buttons ── */
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

    /* ── Session cards ── */
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
      flex-wrap: wrap;
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
    .badge.completed { background: rgba(34, 211, 238, 0.14); color: var(--vscode-textLink-foreground, #22d3ee); }
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

    /* ── Add-participant picker ── */
    .add-picker {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: var(--vscode-editor-background);
      padding: 6px;
      margin-top: 6px;
    }
    .add-picker-option {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    .add-picker-option:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .add-picker-option .icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
    .add-picker-option .label { font-weight: 500; }
    .add-picker-option .desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 1px;
    }
    .add-picker-option .recommended {
      font-size: 9px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 1px 5px;
      border-radius: 8px;
      margin-left: 4px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .add-picker-divider {
      border-top: 1px solid var(--vscode-panel-border);
      margin: 4px 0;
    }

    /* ── Coupling arrows ── */
    .coupling-list {
      margin-top: 6px;
      font-size: 11px;
    }
    .coupling-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 0;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--vscode-descriptionForeground);
    }
    .coupling-arrow {
      color: var(--vscode-charts-green, #2da44e);
      font-weight: bold;
    }

    /* ── Progress bar ── */
    .progress-container {
      margin-top: 6px;
    }
    .progress-track {
      height: 4px;
      background: var(--vscode-progressBar-background, #0891b2);
      opacity: 0.2;
      border-radius: 2px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: var(--vscode-progressBar-background, #0891b2);
      opacity: 1;
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    .progress-text {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
      display: block;
    }

    /* ── Wrapper detection banner ── */
    .wrapper-banner {
      background: var(--vscode-editorInfo-background, rgba(34, 211, 238, 0.1));
      border: 1px solid var(--vscode-editorInfo-border, rgba(34, 211, 238, 0.3));
      border-radius: 4px;
      padding: 8px 10px;
      margin-bottom: 8px;
      font-size: 12px;
      display: none;
    }
    .wrapper-banner.visible { display: block; }
    .wrapper-banner button { margin-top: 6px; }

    /* ── Hardware-in-the-Loop (Soft HIL) ── */
    .hil-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }
    .hil-badge.disconnected {
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-badge-background, rgba(128,128,128,0.2));
    }
    .hil-badge.connected {
      color: #fff;
      background: var(--vscode-charts-green, #2da44e);
    }
    .hil-badge.active {
      color: #fff;
      background: var(--vscode-charts-blue, #0891b2);
      animation: hilPulse 1.5s infinite ease-in-out;
    }
    @keyframes hilPulse {
      0% { opacity: 0.8; }
      50% { opacity: 1; }
      100% { opacity: 0.8; }
    }
    .can-dir-rx {
      color: var(--vscode-charts-green, #2da44e);
      font-weight: bold;
    }
    .can-dir-tx {
      color: var(--vscode-textLink-foreground, #22d3ee);
      font-weight: bold;
    }
  </style>
</head>
<body>
  <!-- Mode Selector -->
  <div class="section" id="mode-section">
    <div class="mode-bar">
      <select id="mode-select">
        <option value="local">🖥 Local (Browser)</option>
        <option value="remote">☁ Remote Server</option>
      </select>
      <span class="mode-status ready" id="mode-status">● Ready</span>
      <button id="btn-refresh" class="secondary" title="Refresh" style="padding:2px 6px">⟳</button>
    </div>
  </div>

  <!-- Remote Configuration (hidden by default) -->
  <div class="section" id="config-section" style="display:none">
    <div class="section-header" data-section="config">
      <span class="chevron">▾</span>
      Connection Settings
    </div>
    <div class="section-body" id="config-body">
      <div class="connection-form">
        <div class="field">
          <label>API URL</label>
          <input type="text" id="input-api-url" placeholder="https://ansatz.social">
        </div>
        <div class="field">
          <label>MQTT WebSocket URL</label>
          <input type="text" id="input-mqtt-url" placeholder="wss://ansatz.social/mqtt">
        </div>
        <div class="btn-row">
          <button id="btn-save-config">Save</button>
          <button id="btn-cancel-config" class="secondary">Cancel</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Wrapper Detection Banner -->
  <div class="wrapper-banner" id="wrapper-banner">
    🔗 The open file looks like a co-simulation wrapper.
    <button id="btn-import-wrapper">Import Participants &amp; Couplings</button>
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
        <button id="btn-quick-start" style="flex:1">⚡ Quick Start</button>
        <button id="btn-create-session" class="secondary" style="flex:1">Custom…</button>
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
      <div class="field">
        <label>Master Algorithm</label>
        <select id="select-master-algorithm">
          <option value="gauss-seidel" selected>Gauss-Seidel (Sequential)</option>
          <option value="jacobi">Jacobi (Parallel)</option>
          <option value="richardson">Richardson (Adaptive Step)</option>
          <option value="newton">Newton-Raphson (Interface Jacobian)</option>
        </select>
      </div>
      <div class="field" id="field-tolerance" style="display:none">
        <label>Error Tolerance</label>
        <input type="number" id="input-tolerance" value="0.0001" step="0.00001">
      </div>
      <div class="field">
        <label>Algebraic Loop Remediation</label>
        <select id="select-loop-remediation">
          <option value="none">Manual / Default</option>
          <option value="delay">Auto-Insert Extrapolated Delay</option>
          <option value="aitken">Aitken Dynamic Relaxation</option>
          <option value="newton">Interface Newton-Raphson</option>
        </select>
      </div>
      <div class="btn-row">
        <button id="btn-submit-session">Create</button>
        <button id="btn-cancel-session" class="secondary">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Hardware-in-the-Loop (Soft HIL) -->
  <div class="section" id="hardware-hil-section">
    <div class="section-header" data-section="hardware-hil">
      <span class="chevron">▾</span>
      Hardware-in-the-Loop (Soft HIL)
    </div>
    <div class="section-body" id="hardware-hil-body">
      <div class="field">
        <label>Interface Protocol</label>
        <select id="hil-protocol-select">
          <option value="slcan">CAN Bus (SLCAN / CANable / USBtin)</option>
          <option value="json">Line-delimited JSON Stream</option>
          <option value="cobs">COBS Binary Framing</option>
        </select>
      </div>
      <div class="field">
        <label>Baud Rate</label>
        <select id="hil-baud-select">
          <option value="115200">115,200 baud</option>
          <option value="230400">230,400 baud</option>
          <option value="460800">460,800 baud</option>
          <option value="500000" selected>500,000 baud (Standard CAN)</option>
          <option value="921600">921,600 baud</option>
          <option value="2000000">2,000,000 baud</option>
        </select>
      </div>
      <div class="field">
        <label>Real-Time Clock Synchronization</label>
        <select id="hil-clock-select">
          <option value="realtime">Unthrottled Web Audio (AudioWorklet)</option>
          <option value="free">Free Running (Max Speed)</option>
          <option value="sync">Hardware Synchronized Step</option>
        </select>
      </div>
      <div style="margin: 8px 0; display: flex; align-items: center; justify-content: space-between;">
        <span class="hil-badge disconnected" id="hil-status-badge">● Disconnected</span>
        <span id="hil-metrics" style="font-size: 11px; color: var(--vscode-descriptionForeground);">0 frames | 0 fps</span>
      </div>
      <div class="btn-row">
        <button id="btn-connect-hardware" style="flex:1">⚡ Connect Hardware</button>
        <button id="btn-disconnect-hardware" class="secondary" style="flex:1" disabled>Disconnect</button>
      </div>

      <!-- Live CAN Bus Inspector -->
      <div style="margin-top: 12px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border)); padding-top: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-sideBarSectionHeader-foreground);">Live CAN Inspector</span>
          <div style="display: flex; gap: 4px;">
            <button id="btn-pause-can" class="secondary" style="padding: 2px 6px; font-size: 10px;">Pause</button>
            <button id="btn-clear-can" class="secondary" style="padding: 2px 6px; font-size: 10px;">Clear</button>
          </div>
        </div>
        <div id="can-monitor-container" style="max-height: 160px; overflow-y: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; background: var(--vscode-editor-background); border-radius: 4px; padding: 4px; border: 1px solid var(--vscode-widget-border);">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="text-align: left; opacity: 0.7; border-bottom: 1px solid var(--vscode-widget-border);">
                <th style="padding: 2px 4px;">Dir</th>
                <th style="padding: 2px 4px;">ID</th>
                <th style="padding: 2px 4px;">DLC</th>
                <th style="padding: 2px 4px;">Payload</th>
                <th style="padding: 2px 4px;">Signals</th>
              </tr>
            </thead>
            <tbody id="can-frame-rows">
              <tr><td colspan="5" style="text-align: center; opacity: 0.5; padding: 12px 0;">No traffic on bus</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <div id="error-container"></div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
