// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { SimulationPanel } from "./simulation-panel.js";

export interface ComputeProfileViewModel {
  id: string;
  name: string;
  description: string;
  partition: string;
  cpus: number;
  memoryMb: number;
  gpus?: number;
  costCreditsPerHour: number;
}

export class CloudJobPanel {
  public static currentPanel: CloudJobPanel | undefined;
  public static readonly viewType = "modelscript.cloudJob";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _client?: LanguageClient;
  private _disposables: vscode.Disposable[] = [];
  private _apiBaseUrl: string;
  private _targetUri?: string;
  private _activeJobId?: string;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, targetUri?: string) {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (CloudJobPanel.currentPanel) {
      if (targetUri) {
        CloudJobPanel.currentPanel._targetUri = targetUri;
      }
      CloudJobPanel.currentPanel._panel.reveal(column);
      CloudJobPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(CloudJobPanel.viewType, "ModelScript Cloud HPC Dispatch", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
    });

    CloudJobPanel.currentPanel = new CloudJobPanel(panel, extensionUri, client, targetUri);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client?: LanguageClient,
    targetUri?: string,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._client = client;
    this._targetUri = targetUri ?? vscode.window.activeTextEditor?.document.uri.toString();
    this._apiBaseUrl = "http://localhost:3000/api/v1";

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case "refresh":
            await this.refresh();
            break;
          case "dispatch":
            await this.dispatchJob(message.profileId, message.options);
            break;
          case "cancel":
            await this.cancelJob(message.jobId);
            break;
          case "openResult":
            if (message.jobId) {
              await this.openSimulationResult(message.jobId);
            }
            break;
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.html = this._getHtmlForWebview();
    this.refresh();
  }

  public async refresh(): Promise<void> {
    try {
      const activeDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this._targetUri);
      const fileName = activeDoc ? activeDoc.uri.path.split("/").pop() : "active_model.mo";
      const ext = fileName ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : ".mo";

      let domain = "modelica";
      if (ext === ".cfg") domain = "cfd";
      else if (ext === ".inp") domain = "fea";

      // Fetch profiles & balance
      const [profilesRes, balanceRes] = await Promise.all([
        fetch(`${this._apiBaseUrl}/cloud/profiles`).catch(() => null),
        fetch(`${this._apiBaseUrl}/cloud/balance`).catch(() => null),
      ]);

      const profiles = profilesRes?.ok
        ? ((await profilesRes.json()) as { profiles: ComputeProfileViewModel[] }).profiles
        : [];
      const balanceData = balanceRes?.ok ? ((await balanceRes.json()) as { balance: number }) : { balance: 0 };

      this._panel.webview.postMessage({
        type: "initData",
        data: {
          fileName,
          domain,
          targetUri: this._targetUri,
          profiles,
          balance: balanceData.balance,
          activeJobId: this._activeJobId,
        },
      });
    } catch (err: any) {
      console.error("[CloudJobPanel] Refresh failed:", err);
    }
  }

  private async dispatchJob(profileId: string, options: any): Promise<void> {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this._targetUri);
    if (!doc) {
      vscode.window.showErrorMessage("No active model file selected to dispatch.");
      return;
    }

    const content = doc.getText();
    const fileName = doc.uri.path.split("/").pop() || "model.mo";
    const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
    const modelName = fileName.replace(/\.[^.]+$/, "");

    let domain: "modelica" | "cfd" | "fea" = "modelica";
    if (ext === ".cfg") domain = "cfd";
    else if (ext === ".inp") domain = "fea";

    const payload: any = {
      domain,
      name: modelName,
      profile: profileId,
    };

    if (domain === "cfd" || domain === "fea") {
      payload.deck = { content, format: ext.replace(".", "") };
    } else {
      payload.sourceContent = content;
      payload.experiment = {
        startTime: options.startTime ?? 0,
        stopTime: options.stopTime ?? 10,
        numberOfIntervals: options.numberOfIntervals ?? 500,
      };
    }

    this._panel.webview.postMessage({ type: "dispatchStarted" });

    try {
      const res = await fetch(`${this._apiBaseUrl}/cloud/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 402) {
        const errData = (await res.json().catch(() => ({}))) as any;
        vscode.window.showErrorMessage(
          `Payment Required: Insufficient Compute Credits. Required: ${errData.required ?? "?"} cr, Balance: ${errData.balance ?? "?"} cr`,
        );
        this._panel.webview.postMessage({ type: "dispatchFailed", error: "Insufficient credits" });
        return;
      }

      if (!res.ok) {
        const errText = await res.text();
        vscode.window.showErrorMessage(`Cloud dispatch failed: ${errText}`);
        this._panel.webview.postMessage({ type: "dispatchFailed", error: errText });
        return;
      }

      const data = (await res.json()) as { jobId: string; streamUrl: string };
      this._activeJobId = data.jobId;
      vscode.window.showInformationMessage(`Dispatched Cloud Job #${data.jobId}`);

      this._panel.webview.postMessage({
        type: "jobDispatched",
        data: {
          jobId: data.jobId,
          streamUrl: `${this._apiBaseUrl}/cloud/jobs/${data.jobId}/events`,
        },
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Dispatch failed: ${err.message}`);
      this._panel.webview.postMessage({ type: "dispatchFailed", error: err.message });
    }
  }

  private async cancelJob(jobId: string): Promise<void> {
    try {
      const res = await fetch(`${this._apiBaseUrl}/cloud/jobs/${jobId}/cancel`, {
        method: "POST",
      });
      if (res.ok) {
        vscode.window.showInformationMessage(`Job #${jobId} cancelled.`);
        this._panel.webview.postMessage({ type: "jobCancelled", jobId });
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to cancel job: ${err.message}`);
    }
  }

  private async openSimulationResult(jobId: string): Promise<void> {
    try {
      const res = await fetch(`${this._apiBaseUrl}/cloud/jobs/${jobId}/result`);
      if (!res.ok) {
        vscode.window.showErrorMessage("Could not load simulation results.");
        return;
      }
      const csvText = await res.text();
      const lines = csvText.trim().split("\n");
      if (lines.length < 2) return;

      const header = lines[0]?.split(",") || [];
      const timeIdx = header.findIndex((h) => h.toLowerCase() === "time");
      const validTimeIdx = timeIdx >= 0 ? timeIdx : 0;

      const t: number[] = [];
      const y: number[][] = [];
      const states = header.filter((_, idx) => idx !== validTimeIdx);

      for (let i = 0; i < states.length; i++) {
        y.push([]);
      }

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i]?.split(",").map(Number) || [];
        if (parts.length === header.length) {
          t.push(parts[validTimeIdx] ?? 0);
          let varCounter = 0;
          for (let j = 0; j < parts.length; j++) {
            if (j !== validTimeIdx) {
              y[varCounter]?.push(parts[j] ?? 0);
              varCounter++;
            }
          }
        }
      }

      SimulationPanel.createOrShowWithData(this._extensionUri, { t, y, states }, this._targetUri, this._client);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to display result: ${err.message}`);
    }
  }

  public dispose() {
    CloudJobPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }

  private _getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ModelScript Cloud HPC Dispatch</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border, #333);
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #fff);
      --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
      --card-bg: var(--vscode-sideBar-background, #252526);
      --card-hover: var(--vscode-list-hoverBackground, #2a2d2e);
      --accent: #388bfd;
      --success: #3fb950;
      --warn: #d29922;
      --danger: #f85149;
    }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .title {
      font-size: 1.25rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .wallet-badge {
      background: rgba(63, 185, 80, 0.15);
      color: var(--success);
      border: 1px solid rgba(63, 185, 80, 0.4);
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .section-title {
      font-size: 0.95rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin: 16px 0 8px 0;
    }
    .profile-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .profile-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .profile-card:hover {
      background: var(--card-hover);
      border-color: var(--accent);
    }
    .profile-card.selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
      background: rgba(56, 139, 253, 0.08);
    }
    .profile-name {
      font-weight: 600;
      font-size: 0.95rem;
      margin-bottom: 4px;
    }
    .profile-desc {
      font-size: 0.75rem;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
      line-height: 1.3;
    }
    .profile-specs {
      font-size: 0.75rem;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }
    .tag {
      background: rgba(255, 255, 255, 0.08);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .profile-cost {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--accent);
      align-self: flex-end;
    }
    .controls {
      display: flex;
      gap: 12px;
      align-items: center;
      margin-bottom: 20px;
    }
    button.primary {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    button.primary:hover {
      background: var(--btn-hover);
    }
    button.primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    button.secondary {
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--border);
      padding: 8px 14px;
      border-radius: 4px;
      cursor: pointer;
    }
    button.secondary:hover {
      background: var(--card-hover);
    }
    .job-status-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
      margin-top: 16px;
      display: none;
    }
    .job-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .status-badge {
      padding: 3px 8px;
      border-radius: 10px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-queued { background: rgba(210, 153, 34, 0.2); color: var(--warn); }
    .status-running { background: rgba(56, 139, 253, 0.2); color: var(--accent); }
    .status-completed { background: rgba(63, 185, 80, 0.2); color: var(--success); }
    .status-failed { background: rgba(248, 81, 73, 0.2); color: var(--danger); }
    .log-box {
      background: #111;
      color: #ccc;
      font-family: monospace;
      font-size: 0.8rem;
      padding: 10px;
      border-radius: 4px;
      height: 180px;
      overflow-y: auto;
      white-space: pre-wrap;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">
      <span>☁️</span>
      <span id="modelTitle">ModelScript Cloud HPC</span>
    </div>
    <div class="wallet-badge" id="walletBadge">Loading balance…</div>
  </div>

  <div class="section-title">Select Cloud Compute Profile</div>
  <div class="profile-grid" id="profileGrid">
    <!-- Populated by JS -->
  </div>

  <div class="controls">
    <button class="primary" id="btnDispatch">
      <span>🚀 Dispatch to Cloud</span>
    </button>
    <button class="secondary" id="btnRefresh">Refresh Profiles</button>
  </div>

  <div class="job-status-container" id="jobContainer">
    <div class="job-header">
      <div>
        <strong id="activeJobTitle">Job #</strong>
        <span class="status-badge" id="jobStatusBadge">Queued</span>
      </div>
      <div>
        <button class="secondary" id="btnCancel" style="padding: 4px 8px; font-size: 0.75rem;">Cancel Job</button>
        <button class="primary" id="btnOpenResult" style="padding: 4px 10px; font-size: 0.75rem; display: none;">Open Results</button>
      </div>
    </div>
    <div class="log-box" id="logBox">Connecting to telemetry stream…</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let selectedProfileId = "standard";
    let profilesList = [];
    let currentJobId = null;
    let eventSource = null;

    document.getElementById("btnRefresh").addEventListener("click", () => {
      vscode.postMessage({ type: "refresh" });
    });

    document.getElementById("btnDispatch").addEventListener("click", () => {
      vscode.postMessage({
        type: "dispatch",
        profileId: selectedProfileId,
        options: { startTime: 0, stopTime: 10, numberOfIntervals: 500 }
      });
    });

    document.getElementById("btnCancel").addEventListener("click", () => {
      if (currentJobId) {
        vscode.postMessage({ type: "cancel", jobId: currentJobId });
      }
    });

    document.getElementById("btnOpenResult").addEventListener("click", () => {
      if (currentJobId) {
        vscode.postMessage({ type: "openResult", jobId: currentJobId });
      }
    });

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "initData") {
        const { fileName, balance, profiles } = msg.data;
        document.getElementById("modelTitle").textContent = "Cloud HPC: " + (fileName || "Model");
        document.getElementById("walletBadge").textContent = (balance || 0).toFixed(0) + " Credits";
        profilesList = profiles || [];
        renderProfiles();
      } else if (msg.type === "dispatchStarted") {
        document.getElementById("btnDispatch").disabled = true;
        document.getElementById("jobContainer").style.display = "block";
        document.getElementById("jobStatusBadge").className = "status-badge status-queued";
        document.getElementById("jobStatusBadge").textContent = "Dispatching…";
        document.getElementById("logBox").textContent = "Submitting job manifest to cloud gateway...";
      } else if (msg.type === "jobDispatched") {
        currentJobId = msg.data.jobId;
        document.getElementById("activeJobTitle").textContent = "Job #" + currentJobId;
        document.getElementById("jobStatusBadge").className = "status-badge status-running";
        document.getElementById("jobStatusBadge").textContent = "Running";
        connectTelemetryStream(msg.data.streamUrl);
      } else if (msg.type === "dispatchFailed") {
        document.getElementById("btnDispatch").disabled = false;
        document.getElementById("jobStatusBadge").className = "status-badge status-failed";
        document.getElementById("jobStatusBadge").textContent = "Failed";
        document.getElementById("logBox").textContent += "\\nDispatch Error: " + msg.error;
      } else if (msg.type === "jobCancelled") {
        document.getElementById("btnDispatch").disabled = false;
        document.getElementById("jobStatusBadge").className = "status-badge status-failed";
        document.getElementById("jobStatusBadge").textContent = "Cancelled";
        if (eventSource) eventSource.close();
      }
    });

    function renderProfiles() {
      const grid = document.getElementById("profileGrid");
      grid.innerHTML = "";
      if (!profilesList.length) {
        grid.innerHTML = "<p>No compute profiles available.</p>";
        return;
      }
      profilesList.forEach((p) => {
        const card = document.createElement("div");
        card.className = "profile-card" + (p.id === selectedProfileId ? " selected" : "");
        card.onclick = () => {
          selectedProfileId = p.id;
          renderProfiles();
        };

        const gpus = p.gpus ? '<span class="tag">' + p.gpus + 'x GPU</span>' : '';
        const ram = '<span class="tag">' + (p.memoryMb / 1024).toFixed(0) + ' GB RAM</span>';
        const cpus = '<span class="tag">' + p.cpus + ' vCPUs</span>';

        card.innerHTML = \`
          <div>
            <div class="profile-name">\${p.name}</div>
            <div class="profile-desc">\${p.description}</div>
            <div class="profile-specs">\${cpus}\${ram}\${gpus}</div>
          </div>
          <div class="profile-cost">\${p.costCreditsPerHour.toFixed(1)} cr/hr</div>
        \`;
        grid.appendChild(card);
      });
    }

    function connectTelemetryStream(streamUrl) {
      if (eventSource) eventSource.close();
      const logBox = document.getElementById("logBox");
      logBox.textContent = "";

      eventSource = new EventSource(streamUrl);
      eventSource.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === "log") {
            logBox.textContent += payload.data + "\\n";
            logBox.scrollTop = logBox.scrollHeight;
          } else if (payload.type === "init") {
            if (payload.logs) {
              logBox.textContent = payload.logs.join("\\n") + "\\n";
            }
          } else if (payload.type === "status") {
            const st = payload.data.status;
            document.getElementById("jobStatusBadge").textContent = st;
            if (st === "completed") {
              document.getElementById("jobStatusBadge").className = "status-badge status-completed";
              document.getElementById("btnDispatch").disabled = false;
              document.getElementById("btnOpenResult").style.display = "inline-block";
              eventSource.close();
            } else if (st === "failed") {
              document.getElementById("jobStatusBadge").className = "status-badge status-failed";
              document.getElementById("btnDispatch").disabled = false;
              eventSource.close();
            }
          }
        } catch (err) {
          logBox.textContent += e.data + "\\n";
        }
      };
      eventSource.onerror = () => {
        // SSE may complete
      };
    }
  </script>
</body>
</html>`;
  }
}
