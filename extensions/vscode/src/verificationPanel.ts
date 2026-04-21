import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";

/**
 * V&V Dashboard panel — displays requirement verification results from
 * simulation runs in a rich, sortable table with pass/fail/pending status.
 *
 * Deep-links back to the simulation results panel when a failure is clicked.
 */
export class VerificationPanel {
  static currentPanel: VerificationPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly client: LanguageClient,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case "runVerification": {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== "sysml") {
              vscode.window.showWarningMessage("Open a SysML file first.");
              return;
            }
            const uri = editor.document.uri.toString();
            this.panel.webview.postMessage({ type: "verificationStarted" });
            try {
              await this.client.sendRequest("modelscript/runVerification", { uri });
              // Fetch updated requirements to refresh statuses
              const requirements = await this.client.sendRequest<unknown>("modelscript/getRequirements", { uri });
              this.panel.webview.postMessage({ type: "verificationComplete", requirements });
            } catch (e) {
              this.panel.webview.postMessage({
                type: "verificationError",
                message: `${e}`,
              });
            }
            break;
          }
          case "openSimulation":
            vscode.commands.executeCommand("modelscript.runSimulation");
            break;
          case "goToSource": {
            const docUri = vscode.Uri.parse(msg.uri);
            const doc = await vscode.workspace.openTextDocument(docUri);
            const startPos = doc.positionAt(msg.startByte);
            const endPos = doc.positionAt(msg.endByte);
            vscode.window.showTextDocument(doc, {
              selection: new vscode.Range(startPos, endPos),
              viewColumn: vscode.ViewColumn.One,
            });
            break;
          }
        }
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(
      () => {
        VerificationPanel.currentPanel = undefined;
        for (const d of this.disposables) d.dispose();
      },
      null,
      this.disposables,
    );
  }

  static createOrShow(extensionUri: vscode.Uri, client: LanguageClient): void {
    const column = vscode.ViewColumn.Beside;

    if (VerificationPanel.currentPanel) {
      VerificationPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel("modelscript.verificationDashboard", "V&V Dashboard", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    VerificationPanel.currentPanel = new VerificationPanel(panel, extensionUri, client);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <title>V&amp;V Dashboard</title>
  <style nonce="${nonce}">
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border, #333);
      --header-bg: var(--vscode-editorGroupHeader-tabsBackground, #252526);
      --row-hover: var(--vscode-list-hoverBackground, #2a2d2e);
      --badge-pass: #4ec9b0;
      --badge-fail: #f14c4c;
      --badge-pending: #888;
      --accent: var(--vscode-textLink-foreground, #3794ff);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
      font-size: 13px; color: var(--fg); background: var(--bg);
    }

    .header {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 16px; border-bottom: 1px solid var(--border);
      background: var(--header-bg);
    }
    .header h1 { font-size: 16px; font-weight: 600; flex: 1; }
    .header .btn {
      padding: 6px 14px; border: 1px solid var(--border); border-radius: 4px;
      background: transparent; color: var(--fg); cursor: pointer; font-size: 12px;
      display: flex; align-items: center; gap: 4px;
    }
    .header .btn-primary {
      background: var(--accent); color: #fff; border-color: var(--accent);
    }
    .header .btn:hover { opacity: 0.85; }
    .header .btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .summary-strip {
      display: flex; gap: 0; border-bottom: 1px solid var(--border);
    }
    .summary-card {
      flex: 1; padding: 12px 16px; text-align: center;
      border-right: 1px solid var(--border);
    }
    .summary-card:last-child { border-right: none; }
    .summary-card .number { font-size: 28px; font-weight: 700; line-height: 1.2; }
    .summary-card .label { font-size: 11px; text-transform: uppercase; opacity: 0.6; letter-spacing: 0.5px; }
    .summary-card.passed .number { color: var(--badge-pass); }
    .summary-card.failed .number { color: var(--badge-fail); }
    .summary-card.pending .number { color: var(--badge-pending); }

    .spinner {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid var(--border); border-top-color: var(--accent);
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    table { width: 100%; border-collapse: collapse; }
    th {
      text-align: left; padding: 8px 12px;
      background: var(--header-bg); border-bottom: 2px solid var(--border);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--fg); opacity: 0.8;
    }
    td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
    tr:hover td { background: var(--row-hover); }

    .badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;
    }
    .badge-Passed { background: rgba(78,201,176,0.2); color: var(--badge-pass); }
    .badge-Failed { background: rgba(241,76,76,0.2); color: var(--badge-fail); }
    .badge-Pending { background: rgba(136,136,136,0.2); color: var(--badge-pending); }

    .link { color: var(--accent); cursor: pointer; text-decoration: underline; }
    .link:hover { opacity: 0.8; }

    .empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 60px 20px; opacity: 0.5; gap: 8px;
    }
    .error-bar {
      padding: 10px 16px; background: rgba(241,76,76,0.15);
      border-left: 3px solid var(--badge-fail); margin: 8px 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>⚡ Verification &amp; Validation Dashboard</h1>
    <button class="btn" id="simBtn" title="Open Simulation Panel">📊 Simulation</button>
    <button class="btn btn-primary" id="runBtn">▶ Run Verification</button>
  </div>

  <div class="summary-strip">
    <div class="summary-card total"><div class="number" id="totalCount">0</div><div class="label">Total</div></div>
    <div class="summary-card passed"><div class="number" id="passedCount">0</div><div class="label">Passed</div></div>
    <div class="summary-card failed"><div class="number" id="failedCount">0</div><div class="label">Failed</div></div>
    <div class="summary-card pending"><div class="number" id="pendingCount">0</div><div class="label">Pending</div></div>
  </div>

  <div id="statusBar" style="display:none; padding: 8px 16px; font-size: 12px;">
    <span class="spinner"></span> Running verification…
  </div>
  <div id="errorBar" class="error-bar" style="display:none"></div>
  <div id="content"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let requirements = [];

    document.getElementById('runBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'runVerification' });
    });
    document.getElementById('simBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'openSimulation' });
    });

    function render() {
      const content = document.getElementById('content');
      if (requirements.length === 0) {
        content.innerHTML = '<div class="empty"><h3>No requirements loaded</h3>' +
          '<p>Open a .sysml file and click "Run Verification".</p></div>';
        updateSummary(0, 0, 0);
        return;
      }

      let passed = 0, failed = 0, pending = 0;
      for (const r of requirements) {
        if (r.status === 'Passed') passed++;
        else if (r.status === 'Failed') failed++;
        else pending++;
      }
      updateSummary(requirements.length, passed, failed);

      let html = '<table><thead><tr>' +
        '<th>Requirement</th><th>Target Variable</th><th>Status</th><th>Message</th>' +
        '</tr></thead><tbody>';

      for (const r of requirements) {
        const statusIcon = r.status === 'Passed' ? '✓' : r.status === 'Failed' ? '✗' : '◌';
        html += '<tr>' +
          '<td><span class="link" data-uri="' + esc(r.uri) + '" data-start="' + r.startByte + '" data-end="' + r.endByte + '">' + esc(r.name) + '</span></td>' +
          '<td>' + esc(r.constraintIds.length ? r.constraintIds.length + ' constraint(s)' : '—') + '</td>' +
          '<td><span class="badge badge-' + r.status + '">' + statusIcon + ' ' + r.status + '</span></td>' +
          '<td>' + esc(r.text || '—') + '</td>' +
          '</tr>';
      }
      html += '</tbody></table>';
      content.innerHTML = html;

      content.querySelectorAll('.link').forEach(el => {
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

    function updateSummary(total, passed, failed) {
      document.getElementById('totalCount').textContent = total;
      document.getElementById('passedCount').textContent = passed;
      document.getElementById('failedCount').textContent = failed;
      document.getElementById('pendingCount').textContent = total - passed - failed;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'verificationStarted':
          document.getElementById('statusBar').style.display = 'block';
          document.getElementById('errorBar').style.display = 'none';
          document.getElementById('runBtn').disabled = true;
          break;
        case 'verificationComplete':
          document.getElementById('statusBar').style.display = 'none';
          document.getElementById('runBtn').disabled = false;
          requirements = msg.requirements || [];
          render();
          break;
        case 'verificationError':
          document.getElementById('statusBar').style.display = 'none';
          document.getElementById('runBtn').disabled = false;
          document.getElementById('errorBar').style.display = 'block';
          document.getElementById('errorBar').textContent = msg.message;
          break;
      }
    });

    function esc(s) {
      const div = document.createElement('div');
      div.textContent = String(s);
      return div.innerHTML;
    }

    render();
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
