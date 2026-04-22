import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";

/**
 * Custom editor provider for SysML v2 requirements.
 *
 * Opens a rich, spreadsheet-style webview alongside (or instead of) the plain
 * text editor for `.sysml` files. The webview renders requirements in a
 * sortable, filterable grid and a traceability matrix.
 *
 * Communication:
 *   Extension ←→ LSP:       `modelscript/getRequirements`, `modelscript/getTraceabilityMatrix`
 *   Extension ←→ Webview:   postMessage / onDidReceiveMessage
 */
export class RequirementsEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = "modelscript.requirementsEditor";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: LanguageClient,
  ) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    // Fetch and send data on first open
    const sendData = async () => {
      try {
        const uri = document.uri.toString();
        const [requirements, matrix] = await Promise.all([
          this.client.sendRequest<unknown>("modelscript/getRequirements", { uri }),
          this.client.sendRequest<unknown>("modelscript/getTraceabilityMatrix", { uri }),
        ]);
        webviewPanel.webview.postMessage({ type: "setData", requirements, matrix });
      } catch (e) {
        webviewPanel.webview.postMessage({
          type: "setError",
          message: `Failed to load requirements: ${e}`,
        });
      }
    };

    sendData();

    // Re-fetch whenever the document changes
    const changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        sendData();
      }
    });

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case "goToSource": {
          const { uri, startByte, endByte } = msg;
          const docUri = vscode.Uri.parse(uri);
          vscode.workspace.openTextDocument(docUri).then((doc) => {
            const startPos = doc.positionAt(startByte);
            const endPos = doc.positionAt(endByte);
            vscode.window.showTextDocument(doc, {
              selection: new vscode.Range(startPos, endPos),
              viewColumn: vscode.ViewColumn.One,
            });
          });
          break;
        }
        case "refresh":
          sendData();
          break;
      }
    });

    webviewPanel.onDidDispose(() => {
      changeListener.dispose();
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>Requirements Editor</title>
  <style nonce="${nonce}">
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border, #333);
      --header-bg: var(--vscode-editorGroupHeader-tabsBackground, #252526);
      --row-hover: var(--vscode-list-hoverBackground, #2a2d2e);
      --badge-pass: #4ec9b0;
      --badge-fail: #f14c4c;
      --badge-pending: #ccc;
      --accent: var(--vscode-textLink-foreground, #3794ff);
      --satisfy-bg: rgba(78, 201, 176, 0.15);
      --verify-bg: rgba(55, 148, 255, 0.15);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family, 'Segoe UI', sans-serif); font-size: 13px; color: var(--fg); background: var(--bg); }

    .toolbar {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; background: var(--header-bg);
      border-bottom: 1px solid var(--border);
      position: sticky; top: 0; z-index: 10;
    }
    .toolbar h2 { font-size: 14px; font-weight: 600; flex: 1; }
    .toolbar button {
      padding: 4px 12px; border: 1px solid var(--border); border-radius: 4px;
      background: transparent; color: var(--fg); cursor: pointer; font-size: 12px;
    }
    .toolbar button:hover { background: var(--row-hover); }
    .toolbar input {
      padding: 4px 8px; border: 1px solid var(--border); border-radius: 4px;
      background: var(--bg); color: var(--fg); font-size: 12px; width: 200px;
    }

    .tabs {
      display: flex; gap: 0; border-bottom: 1px solid var(--border);
    }
    .tab {
      padding: 8px 16px; cursor: pointer; border-bottom: 2px solid transparent;
      font-size: 13px; color: var(--fg); opacity: 0.7;
    }
    .tab.active { border-bottom-color: var(--accent); opacity: 1; font-weight: 600; }
    .tab:hover { opacity: 1; }

    .panel { display: none; padding: 0; }
    .panel.active { display: block; }

    /* Requirements Grid */
    table { width: 100%; border-collapse: collapse; }
    thead { position: sticky; top: 44px; z-index: 5; }
    th {
      text-align: left; padding: 8px 10px;
      background: var(--header-bg); border-bottom: 2px solid var(--border);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--fg); opacity: 0.8; cursor: pointer; user-select: none;
    }
    th:hover { opacity: 1; }
    td { padding: 6px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
    tr:hover td { background: var(--row-hover); }
    tr { transition: background 0.1s; }

    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 10px;
      font-size: 11px; font-weight: 600; line-height: 1.4;
    }
    .badge-Passed { background: var(--badge-pass); color: #000; }
    .badge-Failed { background: var(--badge-fail); color: #fff; }
    .badge-Pending { background: var(--badge-pending); color: #000; }

    .link-src { cursor: pointer; color: var(--accent); text-decoration: underline; }
    .link-src:hover { opacity: 0.8; }

    .req-id { font-family: monospace; font-size: 12px; opacity: 0.7; }
    .req-type {
      font-size: 11px; padding: 2px 6px; border-radius: 4px;
      background: rgba(255,255,255,0.06); display: inline-block;
    }

    /* Traceability Matrix */
    .matrix-container { overflow: auto; max-height: calc(100vh - 120px); }
    .matrix { border-collapse: collapse; }
    .matrix th, .matrix td {
      padding: 6px 10px; border: 1px solid var(--border); text-align: center; min-width: 100px;
    }
    .matrix th { background: var(--header-bg); font-size: 11px; text-transform: uppercase; }
    .matrix .corner { background: var(--header-bg); }
    .cell-satisfy { background: var(--satisfy-bg); font-weight: 600; }
    .cell-verify { background: var(--verify-bg); font-weight: 600; }

    .empty-state {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 60px 20px; opacity: 0.5; gap: 12px;
    }
    .empty-state h3 { font-size: 16px; }
    .empty-state p { font-size: 13px; max-width: 400px; text-align: center; }

    .error-banner {
      padding: 12px 16px; background: rgba(241, 76, 76, 0.15);
      border-left: 3px solid var(--badge-fail); margin: 8px;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <h2>📋 Requirements</h2>
    <input type="text" id="search" placeholder="Filter requirements…" />
    <button id="refreshBtn" title="Refresh">⟳ Refresh</button>
  </div>

  <div class="tabs">
    <div class="tab active" data-tab="grid">Requirements</div>
    <div class="tab" data-tab="matrix">Traceability Matrix</div>
  </div>

  <div id="gridPanel" class="panel active"></div>
  <div id="matrixPanel" class="panel"></div>

  <div id="errorBanner" class="error-banner" style="display:none"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let allRequirements = [];
    let matrix = null;

    // --- Tabs ---
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + 'Panel').classList.add('active');
      });
    });

    // --- Search ---
    document.getElementById('search').addEventListener('input', (e) => {
      renderGrid(e.target.value.toLowerCase());
    });

    // --- Refresh ---
    document.getElementById('refreshBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    // --- Grid rendering ---
    function renderGrid(filter) {
      const panel = document.getElementById('gridPanel');
      const reqs = filter
        ? allRequirements.filter(r =>
            r.name.toLowerCase().includes(filter) ||
            r.reqId.toLowerCase().includes(filter) ||
            r.text.toLowerCase().includes(filter))
        : allRequirements;

      if (reqs.length === 0) {
        panel.innerHTML = '<div class="empty-state"><h3>No requirements found</h3>' +
          '<p>Open a .sysml file containing requirement definitions or usages.</p></div>';
        return;
      }

      let html = '<table><thead><tr>' +
        '<th>ID</th><th>Type</th><th>Name</th><th>Description</th><th>Constraints</th><th>Status</th>' +
        '</tr></thead><tbody>';

      for (const r of reqs) {
        html += '<tr>' +
          '<td><span class="req-id">' + esc(r.reqId) + '</span></td>' +
          '<td><span class="req-type">' + esc(r.type.replace('Requirement', 'Req')) + '</span></td>' +
          '<td><span class="link-src" data-uri="' + esc(r.uri) + '" data-start="' + r.startByte + '" data-end="' + r.endByte + '">' + esc(r.name) + '</span></td>' +
          '<td>' + esc(r.text || '—') + '</td>' +
          '<td>' + r.constraintIds.length + '</td>' +
          '<td><span class="badge badge-' + r.status + '">' + r.status + '</span></td>' +
          '</tr>';
      }

      html += '</tbody></table>';
      panel.innerHTML = html;

      // Wire up go-to-source clicks
      panel.querySelectorAll('.link-src').forEach(el => {
        el.addEventListener('click', () => {
          vscode.postMessage({
            type: 'goToSource',
            uri: el.dataset.uri,
            startByte: parseInt(el.dataset.start, 10),
            endByte: parseInt(el.dataset.end, 10),
          });
        });
      });
    }

    // --- Matrix rendering ---
    function renderMatrix() {
      const panel = document.getElementById('matrixPanel');
      if (!matrix || matrix.links.length === 0) {
        panel.innerHTML = '<div class="empty-state"><h3>No traceability links</h3>' +
          '<p>Add satisfy or verify usages to your SysML model.</p></div>';
        return;
      }

      const { sources, targets, links } = matrix;
      // Build lookup: "source|target" → linkKind
      const lookup = {};
      for (const l of links) {
        const key = l.sourceName + '|' + l.targetName;
        lookup[key] = l.linkKind;
      }

      let html = '<div class="matrix-container"><table class="matrix"><thead><tr><th class="corner">Source \\ Requirement</th>';
      for (const t of targets) html += '<th>' + esc(t) + '</th>';
      html += '</tr></thead><tbody>';

      for (const s of sources) {
        html += '<tr><th>' + esc(s) + '</th>';
        for (const t of targets) {
          const kind = lookup[s + '|' + t];
          if (kind === 'satisfy') {
            html += '<td class="cell-satisfy">✓ Satisfy</td>';
          } else if (kind === 'verify') {
            html += '<td class="cell-verify">⚡ Verify</td>';
          } else {
            html += '<td></td>';
          }
        }
        html += '</tr>';
      }

      html += '</tbody></table></div>';
      panel.innerHTML = html;
    }

    // --- Message handler ---
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'setData':
          allRequirements = msg.requirements || [];
          matrix = msg.matrix || null;
          renderGrid('');
          renderMatrix();
          break;
        case 'setError':
          document.getElementById('errorBanner').style.display = 'block';
          document.getElementById('errorBanner').textContent = msg.message;
          break;
      }
    });

    function esc(s) {
      const div = document.createElement('div');
      div.textContent = s;
      return div.innerHTML;
    }
  </script>
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
