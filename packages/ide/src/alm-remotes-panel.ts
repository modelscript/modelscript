// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { getNonce } from "./utils/nonce.js";

const DEFAULT_PROTOCOLS = [
  "oslc",
  "jama",
  "codebeamer",
  "polarion",
  "jira",
  "azdo",
  "testrail",
  "xray",
  "windchill",
  "teamcenter",
  "aras",
  "github",
  "gitlab",
  "bitbucket",
  "confluence",
  "onshape",
  "artifactory",
  "airflow",
  "genesys",
  "twc",
  "rhapsody",
  "zuken",
  "sql",
  "excel",
  "rest",
];

export class AlmRemotesPanel {
  public static currentPanel: AlmRemotesPanel | undefined;
  public static readonly viewType = "modelscript.almRemotes";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _apiBaseUrl: string;

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
    if (AlmRemotesPanel.currentPanel) {
      AlmRemotesPanel.currentPanel._panel.reveal(column);
      void AlmRemotesPanel.currentPanel.loadProtocols();
      return;
    }

    const panel = vscode.window.createWebviewPanel(AlmRemotesPanel.viewType, "ModelScript ALM & PLM Remotes", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
    });

    AlmRemotesPanel.currentPanel = new AlmRemotesPanel(panel);
  }

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    const cfg = vscode.workspace.getConfiguration("modelscript.cloud");
    const configured = cfg.get<string>("apiUrl");
    this._apiBaseUrl = (configured || "http://localhost:3000/api/v1").replace(/\/+$/, "");

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === "loadProtocols") {
          await this.loadProtocols();
        } else if (msg.type === "discover") {
          await this.callAlmProxy(
            "/alm/discover",
            {
              packageName: msg.packageName || "@alm/remote",
              spec: msg.source,
              auth: msg.token ? { token: msg.token } : undefined,
            },
            "discoverResult",
          );
        } else if (msg.type === "pull") {
          await this.callAlmProxy(
            "/alm/pull",
            {
              packageName: msg.packageName || "@alm/remote",
              spec: msg.source,
              auth: msg.token ? { token: msg.token } : undefined,
            },
            "pullResult",
          );
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.html = this._getHtmlForWebview();
    void this.loadProtocols();
  }

  public async loadProtocols(): Promise<void> {
    try {
      const res = await fetch(`${this._apiBaseUrl}/alm/protocols`);
      if (res.ok) {
        const data = (await res.json()) as { protocols?: string[] };
        if (Array.isArray(data.protocols) && data.protocols.length > 0) {
          this._panel.webview.postMessage({ type: "protocols", protocols: data.protocols, online: true });
          return;
        }
      }
    } catch {
      // Fallback to built-in protocol list when API proxy is offline
    }
    this._panel.webview.postMessage({ type: "protocols", protocols: DEFAULT_PROTOCOLS, online: false });
  }

  private async callAlmProxy(path: string, body: Record<string, unknown>, replyType: string): Promise<void> {
    try {
      const res = await fetch(`${this._apiBaseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      this._panel.webview.postMessage({ type: replyType, ok: res.ok, data: payload });
    } catch (err) {
      this._panel.webview.postMessage({
        type: replyType,
        ok: false,
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  public dispose(): void {
    AlmRemotesPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      d?.dispose();
    }
  }

  private _getHtmlForWebview(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>ModelScript ALM &amp; PLM Remotes</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
    h2 { margin-top: 0; font-size: 16px; }
    .row { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; }
    label { min-width: 110px; font-size: 12px; opacity: 0.85; }
    input, select { flex: 1; padding: 6px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #444); border-radius: 3px; }
    button { padding: 6px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
    .badge { font-size: 11px; padding: 2px 7px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); cursor: pointer; }
    pre { background: var(--vscode-textBlockQuote-background); padding: 10px; border-radius: 4px; overflow: auto; max-height: 360px; font-size: 12px; }
  </style>
</head>
<body>
  <h2>ALM, PLM &amp; Digital-Thread Remotes</h2>
  <div id="status" style="font-size:12px;margin-bottom:8px;opacity:0.8;">Loading protocols...</div>
  <div id="badges" class="badges"></div>
  <div class="row"><label>Package Name</label><input id="pkg" value="@reqs/remote" /></div>
  <div class="row"><label>Protocol URI</label><input id="source" placeholder="windchill+https://plm.corp.com/Windchill/servlet/odata/ProdMgmt" /></div>
  <div class="row"><label>Bearer Token</label><input id="token" type="password" placeholder="Optional PAT / API token" /></div>
  <div class="row">
    <button id="btnDiscover">Discover Capabilities</button>
    <button id="btnPull">Pull Snapshot</button>
  </div>
  <pre id="output">Select a protocol or enter a remote URI to begin.</pre>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const badgesEl = document.getElementById("badges");
    const statusEl = document.getElementById("status");
    const outputEl = document.getElementById("output");
    const sourceEl = document.getElementById("source");
    const pkgEl = document.getElementById("pkg");
    const tokenEl = document.getElementById("token");

    document.getElementById("btnDiscover").addEventListener("click", () => {
      outputEl.textContent = "Probing remote...";
      vscode.postMessage({ type: "discover", packageName: pkgEl.value, source: sourceEl.value, token: tokenEl.value });
    });
    document.getElementById("btnPull").addEventListener("click", () => {
      outputEl.textContent = "Pulling snapshot...";
      vscode.postMessage({ type: "pull", packageName: pkgEl.value, source: sourceEl.value, token: tokenEl.value });
    });

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "protocols") {
        statusEl.textContent = msg.protocols.length + " protocols available (" + (msg.online ? "API proxy online" : "offline fallback") + ")";
        badgesEl.innerHTML = "";
        for (const p of msg.protocols) {
          const span = document.createElement("span");
          span.className = "badge";
          span.textContent = p;
          span.addEventListener("click", () => { sourceEl.value = p + "+https://"; sourceEl.focus(); });
          badgesEl.appendChild(span);
        }
      } else if (msg.type === "discoverResult" || msg.type === "pullResult") {
        outputEl.textContent = JSON.stringify(msg.data, null, 2);
      }
    });
  </script>
</body>
</html>`;
  }
}
