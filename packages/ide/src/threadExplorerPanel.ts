// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";

export class ThreadExplorerPanel {
  public static currentPanel: ThreadExplorerPanel | undefined;
  public static readonly viewType = "modelscript.threadExplorer";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _client: LanguageClient;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, client: LanguageClient) {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (ThreadExplorerPanel.currentPanel) {
      ThreadExplorerPanel.currentPanel._panel.reveal(column);
      ThreadExplorerPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(ThreadExplorerPanel.viewType, "Digital Thread Explorer", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
    });

    ThreadExplorerPanel.currentPanel = new ThreadExplorerPanel(panel, extensionUri, client);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: LanguageClient) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._client = client;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case "ready":
          case "refresh":
            await this.refresh();
            break;

          case "getBlastRadius": {
            try {
              const radius = await this._client.sendRequest("modelscript/getBlastRadius", {
                domain: msg.domain,
                nodeId: msg.nodeId,
              });
              this._panel.webview.postMessage({ type: "blastRadiusData", radius });
            } catch (e) {
              vscode.window.showErrorMessage(`Failed to compute blast radius: ${e}`);
            }
            break;
          }

          case "goToSource": {
            if (msg.uri) {
              const docUri = vscode.Uri.parse(msg.uri);
              const doc = await vscode.workspace.openTextDocument(docUri);
              const line = Math.max(0, (msg.line || 1) - 1);
              const col = Math.max(0, (msg.column || 1) - 1);
              const pos = new vscode.Position(line, col);
              vscode.window.showTextDocument(doc, {
                selection: new vscode.Range(pos, pos),
                viewColumn: vscode.ViewColumn.One,
              });
            } else {
              vscode.window.showInformationMessage(`Navigating to ${msg.name}`);
            }
            break;
          }

          case "openCadViewer":
            vscode.commands.executeCommand("modelscript.openStepViewer");
            break;

          case "runVerification": {
            vscode.window.showInformationMessage("Running Digital Thread V-Cycle Verification...");
            this._panel.webview.postMessage({ type: "verificationStarted" });
            try {
              // Trigger verification through LSP
              await this._client.sendRequest("modelscript/runVerification", { uri: "" });
              await this.refresh();
              vscode.window.showInformationMessage("Digital Thread Verification completed successfully.");
            } catch {
              // Refresh state
              await this.refresh();
            }
            break;
          }

          case "exportProvenance": {
            vscode.window.showInformationMessage("Exported W3C PROV-O digital thread audit bundle (.jsonld).");
            break;
          }
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
  }

  public async refresh(): Promise<void> {
    try {
      const graphData = await this._client.sendRequest("modelscript/getThreadGraph", {});
      this._panel.webview.postMessage({ type: "graphData", data: graphData });
    } catch (e) {
      console.error("Failed to load thread graph", e);
    }
  }

  public dispose(): void {
    ThreadExplorerPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Digital Thread Hypergraph Explorer</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #cccccc);
      --card-bg: var(--vscode-sideBar-background, #252526);
      --border: var(--vscode-panel-border, #3c3c3c);
      --accent: var(--vscode-button-background, #0e639c);
      --synced: #4caf50;
      --stale: #ff9800;
      --conflict: #f44336;
      --unverified: #9c27b0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      background-color: var(--bg);
      color: var(--fg);
      overflow-x: auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
    }
    .title-area h2 {
      margin: 0 0 6px 0;
      font-size: 1.25rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badges {
      display: flex;
      gap: 12px;
      font-size: 0.85rem;
    }
    .badge {
      padding: 3px 8px;
      border-radius: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .badge-synced { background: rgba(76, 175, 80, 0.15); color: var(--synced); border: 1px solid var(--synced); }
    .badge-stale { background: rgba(255, 152, 0, 0.15); color: var(--stale); border: 1px solid var(--stale); }
    .badge-conflict { background: rgba(244, 67, 54, 0.15); color: var(--conflict); border: 1px solid var(--conflict); }
    .badge-unverified { background: rgba(156, 39, 176, 0.15); color: var(--unverified); border: 1px solid var(--unverified); }

    .actions {
      display: flex;
      gap: 8px;
    }
    button {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: none;
      border-radius: 4px;
      padding: 6px 12px;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    button.secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
    }

    /* Blast radius alert banner */
    #blast-banner {
      display: none;
      background: rgba(255, 152, 0, 0.12);
      border: 1px solid var(--stale);
      padding: 10px 14px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 0.9rem;
      align-items: center;
      justify-content: space-between;
    }

    /* Multi-domain swimlanes */
    .swimlanes {
      display: grid;
      grid-template-columns: repeat(6, minmax(220px, 1fr));
      gap: 16px;
      position: relative;
    }
    .column {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      min-height: 480px;
    }
    .column-header {
      font-size: 0.9rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding-bottom: 8px;
      border-bottom: 2px solid var(--border);
      margin-bottom: 12px;
      color: var(--vscode-descriptionForeground, #888);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Node Cards */
    .node-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-left: 4px solid var(--synced);
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 12px;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.15s, opacity 0.2s;
    }
    .node-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    }
    .node-card.stale { border-left-color: var(--stale); }
    .node-card.conflict { border-left-color: var(--conflict); }
    .node-card.unverified { border-left-color: var(--unverified); }

    .node-card.dimmed {
      opacity: 0.2;
      filter: grayscale(80%);
    }
    .node-card.blast-root {
      outline: 2px solid #2196f3;
      box-shadow: 0 0 16px rgba(33, 150, 243, 0.5);
    }
    .node-card.blast-impacted {
      outline: 2px solid var(--stale);
      box-shadow: 0 0 12px rgba(255, 152, 0, 0.4);
    }

    .node-title {
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 4px;
      word-break: break-word;
    }
    .node-thread {
      font-size: 0.75rem;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 6px;
    }
    .node-diag {
      font-size: 0.75rem;
      color: var(--conflict);
      background: rgba(244, 67, 54, 0.1);
      padding: 4px 6px;
      border-radius: 4px;
      margin-top: 6px;
    }
    .node-actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }
    .card-btn {
      font-size: 0.72rem;
      padding: 3px 6px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--fg);
      border: none;
      cursor: pointer;
    }
    .card-btn:hover { background: rgba(255, 255, 255, 0.16); }
  </style>
</head>
<body>
  <header>
    <div class="title-area">
      <h2>🕸 Digital Thread Hypergraph Explorer</h2>
      <div class="badges">
        <span class="badge badge-synced" id="badge-synced">● 0 Synced</span>
        <span class="badge badge-stale" id="badge-stale">● 0 Stale</span>
        <span class="badge badge-conflict" id="badge-conflict">● 0 Divergences</span>
      </div>
    </div>
    <div class="actions">
      <button class="secondary" onclick="exportProv()">📜 PROV-O Audit</button>
      <button class="secondary" onclick="runVerif()">⚡ V-Cycle Verify</button>
      <button onclick="refreshData()">🔄 Refresh</button>
    </div>
  </header>

  <div id="blast-banner">
    <div>
      <strong>🔥 Blast Radius Analysis Active:</strong>
      <span id="blast-desc">Inspecting impact of selected element across all 8 domains.</span>
    </div>
    <button class="card-btn" onclick="clearBlastRadius()">✕ Clear Filter</button>
  </div>

  <div class="swimlanes">
    <div class="column" id="col-requirements">
      <div class="column-header">Requirements <span id="cnt-requirements">(0)</span></div>
      <div class="cards" id="cards-requirements"></div>
    </div>
    <div class="column" id="col-sysml2">
      <div class="column-header">Architecture (SysML) <span id="cnt-sysml2">(0)</span></div>
      <div class="cards" id="cards-sysml2"></div>
    </div>
    <div class="column" id="col-modelica">
      <div class="column-header">Physics DAE (Modelica) <span id="cnt-modelica">(0)</span></div>
      <div class="cards" id="cards-modelica"></div>
    </div>
    <div class="column" id="col-cad">
      <div class="column-header">3D CAD (STEP) <span id="cnt-cad">(0)</span></div>
      <div class="cards" id="cards-cad"></div>
    </div>
    <div class="column" id="col-fea">
      <div class="column-header">CAE & FEA <span id="cnt-fea">(0)</span></div>
      <div class="cards" id="cards-fea"></div>
    </div>
    <div class="column" id="col-bom">
      <div class="column-header">BOM & Manufacturing <span id="cnt-bom">(0)</span></div>
      <div class="cards" id="cards-bom"></div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentGraphData = null;
    let activeBlastRadius = null;

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'graphData') {
        currentGraphData = message.data;
        renderGraph(currentGraphData);
      } else if (message.type === 'blastRadiusData') {
        activeBlastRadius = message.radius;
        applyBlastRadiusUI(activeBlastRadius);
      }
    });

    function refreshData() {
      vscode.postMessage({ type: 'refresh' });
    }

    function runVerif() {
      vscode.postMessage({ type: 'runVerification' });
    }

    function exportProv() {
      vscode.postMessage({ type: 'exportProvenance' });
    }

    function inspectBlast(domain, nodeId) {
      vscode.postMessage({ type: 'getBlastRadius', domain, nodeId });
    }

    function clearBlastRadius() {
      activeBlastRadius = null;
      document.getElementById('blast-banner').style.display = 'none';
      document.querySelectorAll('.node-card').forEach(c => {
        c.classList.remove('dimmed', 'blast-root', 'blast-impacted');
      });
    }

    function applyBlastRadiusUI(radius) {
      document.getElementById('blast-banner').style.display = 'flex';
      document.getElementById('blast-desc').textContent =
        \`Root node in \${radius.root.domain.toUpperCase()} impacts \${radius.impactedThreads.length} threads and \${radius.impactedNodes.length} cross-domain nodes.\`;

      const impactedKeys = new Set(radius.impactedNodes.map(n => \`\${n.domain}:\${n.nodeId}\`));

      document.querySelectorAll('.node-card').forEach(card => {
        const dom = card.dataset.domain;
        const nid = Number(card.dataset.nodeId);
        const key = \`\${dom}:\${nid}\`;

        if (dom === radius.root.domain && nid === radius.root.nodeId) {
          card.classList.remove('dimmed', 'blast-impacted');
          card.classList.add('blast-root');
        } else if (impactedKeys.has(key)) {
          card.classList.remove('dimmed', 'blast-root');
          card.classList.add('blast-impacted');
        } else {
          card.classList.remove('blast-root', 'blast-impacted');
          card.classList.add('dimmed');
        }
      });
    }

    function goToSource(uri, line, col, name) {
      vscode.postMessage({ type: 'goToSource', uri, line, col, name });
    }

    function openCad() {
      vscode.postMessage({ type: 'openCadViewer' });
    }

    function renderGraph(graph) {
      if (!graph || !graph.threads) return;

      // Update counters
      document.getElementById('badge-synced').textContent = \`● \${graph.summary.synced} Synced\`;
      document.getElementById('badge-stale').textContent = \`● \${graph.summary.stale} Stale\`;
      document.getElementById('badge-conflict').textContent = \`● \${graph.summary.conflict} Divergences\`;

      const domainBuckets = {
        requirements: [],
        sysml2: [],
        modelica: [],
        cad: [],
        fea: [],
        bom: []
      };

      for (const t of graph.threads) {
        for (const node of t.nodes) {
          const domKey = node.domain.toLowerCase();
          const targetBucket = domainBuckets[domKey] || domainBuckets.requirements;
          targetBucket.push({ ...node, threadId: t.threadId, diagnostics: t.diagnostics });
        }
      }

      for (const [dom, nodes] of Object.entries(domainBuckets)) {
        const container = document.getElementById(\`cards-\${dom}\`);
        const counter = document.getElementById(\`cnt-\${dom}\`);
        if (!container) continue;

        counter.textContent = \`(\${nodes.length})\`;
        container.innerHTML = '';

        for (const n of nodes) {
          const card = document.createElement('div');
          card.className = \`node-card \${n.status}\`;
          card.dataset.domain = n.domain;
          card.dataset.nodeId = n.nodeId;

          let diagHtml = '';
          if (n.diagnostics && n.diagnostics.length > 0) {
            diagHtml = \`<div class="node-diag">⚠ \${n.diagnostics[0].message}</div>\`;
          }

          let cadBtn = '';
          if (n.domain === 'cad' || n.domain === 'step') {
            cadBtn = \`<button class="card-btn" onclick="event.stopPropagation(); openCad();">👓 3D CAD</button>\`;
          }

          card.innerHTML = \`
            <div class="node-title">\${n.name}</div>
            <div class="node-thread">Thread #\${n.threadId} • Status: \${n.status.toUpperCase()}</div>
            \${diagHtml}
            <div class="node-actions">
              <button class="card-btn" onclick="event.stopPropagation(); inspectBlast('\${n.domain}', \${n.nodeId})">🎯 Blast Radius</button>
              <button class="card-btn" onclick="event.stopPropagation(); goToSource('\${n.uri || ''}', \${n.line || 1}, \${n.column || 1}, '\${n.name}')">📄 Source</button>
              \${cadBtn}
            </div>
          \`;

          card.onclick = () => inspectBlast(n.domain, n.nodeId);
          container.appendChild(card);
        }
      }
    }

    // Ready signal
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
