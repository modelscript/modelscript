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
            if (!editor) {
              vscode.window.showWarningMessage("Open a file first.");
              return;
            }
            const uri = editor.document.uri.toString();
            this.panel.webview.postMessage({ type: "verificationStarted" });
            try {
              await this.client.sendRequest("modelscript/runVerification", { uri });
              // Fetch updated requirements to refresh statuses
              const requirements = await this.client.sendRequest<unknown>("modelscript/getRequirements", { uri });
              let unifiedReport = null;
              try {
                unifiedReport = await this.client.sendRequest<any>("modelscript/verifyAll", {
                  uri,
                  options: { all: true },
                });
              } catch {}
              this.panel.webview.postMessage({
                type: "verificationComplete",
                requirements,
                unifiedReport,
              });
            } catch (e) {
              this.panel.webview.postMessage({
                type: "verificationError",
                message: `${e}`,
              });
            }
            break;
          }
          case "runB2B": {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
              vscode.window.showWarningMessage("Open a model file first.");
              return;
            }
            const uri = editor.document.uri.toString();
            this.panel.webview.postMessage({ type: "verificationStarted" });
            try {
              const b2bResult = await this.client.sendRequest<any>("modelscript/verifyB2B", {
                uri,
                format: "dhf",
              });
              this.panel.webview.postMessage({ type: "b2bComplete", b2bResult });
            } catch (e) {
              this.panel.webview.postMessage({
                type: "verificationError",
                message: `${e}`,
              });
            }
            break;
          }
          case "exportDhf": {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
              vscode.window.showWarningMessage("Open a model file first.");
              return;
            }
            const uri = editor.document.uri.toString();
            try {
              const b2bResult = await this.client.sendRequest<any>("modelscript/verifyB2B", {
                uri,
                format: "dhf",
              });
              if (b2bResult?.formattedOutput) {
                const doc = await vscode.workspace.openTextDocument({
                  content: b2bResult.formattedOutput,
                  language: "markdown",
                });
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
              } else {
                vscode.window.showWarningMessage("No DHF markdown generated.");
              }
            } catch (e: any) {
              vscode.window.showErrorMessage(`Export DHF failed: ${e.message}`);
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
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
      --card-bg: var(--vscode-editorWidget-background, #202020);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
      font-size: 13px; color: var(--fg); background: var(--bg);
    }

    .header {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 16px; border-bottom: 1px solid var(--border);
      background: var(--header-bg); flex-wrap: wrap;
    }
    .header h1 { font-size: 15px; font-weight: 600; flex: 1; min-width: 200px; }
    .header .btn {
      padding: 6px 12px; border: 1px solid var(--border); border-radius: 4px;
      background: transparent; color: var(--fg); cursor: pointer; font-size: 12px;
      display: flex; align-items: center; gap: 5px;
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
    .summary-card .number { font-size: 26px; font-weight: 700; line-height: 1.2; }
    .summary-card .label { font-size: 10px; text-transform: uppercase; opacity: 0.6; letter-spacing: 0.5px; }
    .summary-card.passed .number { color: var(--badge-pass); }
    .summary-card.failed .number { color: var(--badge-fail); }
    .summary-card.pending .number { color: var(--badge-pending); }

    .b2b-banner {
      margin: 12px 16px; padding: 12px 16px; border-radius: 6px;
      border: 1px solid var(--border); background: var(--card-bg);
      display: flex; flex-direction: column; gap: 8px;
    }
    .b2b-header {
      display: flex; align-items: center; justify-content: space-between;
    }
    .b2b-title { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px; }
    .b2b-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px; font-size: 12px; padding-top: 4px;
    }
    .b2b-metric { display: flex; flex-direction: column; gap: 2px; }
    .b2b-metric .metric-label { font-size: 10px; text-transform: uppercase; opacity: 0.6; }
    .b2b-metric .metric-val { font-family: monospace; font-weight: 600; }

    .stages-container {
      margin: 12px 16px; display: flex; flex-direction: column; gap: 8px;
    }
    .stages-title { font-size: 12px; font-weight: 600; text-transform: uppercase; opacity: 0.7; }
    .stages-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px;
    }
    .stage-card {
      border: 1px solid var(--border); border-radius: 4px; padding: 8px 12px;
      background: var(--card-bg); display: flex; flex-direction: column; gap: 4px;
    }
    .stage-card-header { display: flex; justify-content: space-between; align-items: center; }
    .stage-card-name { font-weight: 600; font-size: 12px; }
    .stage-card-summary { font-size: 11px; opacity: 0.7; }

    .spinner {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid var(--border); border-top-color: var(--accent);
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
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
      padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;
    }
    .badge-Passed { background: rgba(78,201,176,0.2); color: var(--badge-pass); }
    .badge-Failed { background: rgba(241,76,76,0.2); color: var(--badge-fail); }
    .badge-Pending { background: rgba(136,136,136,0.2); color: var(--badge-pending); }
    .badge-Certified { background: rgba(78,201,176,0.3); color: var(--badge-pass); border: 1px solid var(--badge-pass); }

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
    <button class="btn" id="b2bBtn" title="Run Back-to-Back (MiL vs SiL) Equivalence Verification">🛡️ B2B Equiv (ASIL D)</button>
    <button class="btn" id="dhfBtn" title="Export ISO 26262 DHF Audit Dossier">📑 Export DHF</button>
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

  <div id="b2bContainer"></div>
  <div id="stagesContainer"></div>
  <div id="content"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let requirements = [];
    let unifiedReport = null;
    let b2bResult = null;

    document.getElementById('runBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'runVerification' });
    });
    document.getElementById('b2bBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'runB2B' });
    });
    document.getElementById('dhfBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'exportDhf' });
    });
    document.getElementById('simBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'openSimulation' });
    });

    function renderB2B() {
      const b2bBox = document.getElementById('b2bContainer');
      if (!b2bResult) {
        b2bBox.innerHTML = '';
        return;
      }
      const passed = b2bResult.success || (b2bResult.stage && b2bResult.stage.passed);
      const maxDisc = b2bResult.maxDiscrepancy !== undefined ? b2bResult.maxDiscrepancy.toExponential(3) : '0.0';
      const tol = b2bResult.tolerance !== undefined ? b2bResult.tolerance.toExponential(1) : '1.0e-4';
      const worstVar = b2bResult.worstVariable || 'none';
      const sha = b2bResult.sha256CSource ? b2bResult.sha256CSource.substring(0, 16) + '...' : '—';
      const badgeClass = passed ? 'badge-Certified' : 'badge-Failed';
      const badgeText = passed ? '✓ ISO 26262 ASIL D / TCL1 PASS' : '✗ B2B EQUIVALENCE FAILED';

      b2bBox.innerHTML = '<div class="b2b-banner">' +
        '<div class="b2b-header">' +
          '<div class="b2b-title">🛡️ ISO 26262 Back-to-Back (MiL vs SiL) Equivalence</div>' +
          '<span class="badge ' + badgeClass + '">' + badgeText + '</span>' +
        '</div>' +
        '<div class="b2b-grid">' +
          '<div class="b2b-metric"><span class="metric-label">Max Discrepancy (Δmax)</span><span class="metric-val">' + maxDisc + ' (tol: ' + tol + ')</span></div>' +
          '<div class="b2b-metric"><span class="metric-label">Worst Diverging Variable</span><span class="metric-val">' + esc(worstVar) + '</span></div>' +
          '<div class="b2b-metric"><span class="metric-label">C99 Source SHA-256</span><span class="metric-val">' + sha + '</span></div>' +
        '</div>' +
      '</div>';
    }

    function renderStages() {
      const stagesBox = document.getElementById('stagesContainer');
      if (!unifiedReport || !unifiedReport.stages) {
        stagesBox.innerHTML = '';
        return;
      }
      const stages = unifiedReport.stages;
      const stageKeys = Object.keys(stages);
      if (stageKeys.length === 0) {
        stagesBox.innerHTML = '';
        return;
      }

      let html = '<div class="stages-container"><div class="stages-title">Unified Formal Verification Stages</div><div class="stages-grid">';
      for (const k of stageKeys) {
        const s = stages[k];
        const statusClass = s.passed ? 'badge-Passed' : 'badge-Failed';
        const statusText = s.passed ? '✓ Pass' : '✗ Fail';
        const dur = s.durationMs !== undefined ? '(' + s.durationMs + ' ms)' : '';
        html += '<div class="stage-card">' +
          '<div class="stage-card-header">' +
            '<span class="stage-card-name">' + esc(s.name || k) + '</span>' +
            '<span class="badge ' + statusClass + '">' + statusText + '</span>' +
          '</div>' +
          '<div class="stage-card-summary">' + esc(s.summary || '') + ' ' + dur + '</div>' +
        '</div>';
      }
      html += '</div></div>';
      stagesBox.innerHTML = html;
    }

    function render() {
      renderB2B();
      renderStages();

      const content = document.getElementById('content');
      if (requirements.length === 0 && !unifiedReport && !b2bResult) {
        content.innerHTML = '<div class="empty"><h3>No verification results loaded</h3>' +
          '<p>Open a model file and click "Run Verification" or "B2B Equiv (ASIL D)".</p></div>';
        updateSummary(0, 0, 0);
        return;
      }

      let passed = 0, failed = 0, pending = 0;
      for (const r of requirements) {
        if (r.status === 'Passed') passed++;
        else if (r.status === 'Failed') failed++;
        else pending++;
      }
      if (unifiedReport && unifiedReport.summary) {
        passed += unifiedReport.summary.passedStages || 0;
        failed += unifiedReport.summary.failedStages || 0;
      }
      if (b2bResult) {
        if (b2bResult.success || (b2bResult.stage && b2bResult.stage.passed)) passed++;
        else failed++;
      }
      updateSummary(requirements.length + (unifiedReport ? unifiedReport.summary.totalStages : 0) + (b2bResult ? 1 : 0), passed, failed);

      if (requirements.length === 0) {
        content.innerHTML = '';
        return;
      }

      let html = '<table><thead><tr>' +
        '<th>Requirement</th><th>Variable</th><th>Peak</th><th>Limit</th><th>Status</th><th>Violation</th>' +
        '</tr></thead><tbody>';

      for (const r of requirements) {
        const statusIcon = r.status === 'Passed' ? '✓' : r.status === 'Failed' ? '✗' : '◌';
        const peak = r.peakValue !== undefined ? r.peakValue.toFixed(1) : '—';
        const limit = r.limitValue !== undefined ? r.limitValue.toFixed(1) : '—';
        const violTime = r.violationTime !== undefined ? ('t=' + r.violationTime.toFixed(2) + 's') : '—';
        const variable = r.lhsName || (r.constraintIds.length ? r.constraintIds.length + ' constraint(s)' : '—');
        html += '<tr' + (r.status === 'Failed' ? ' style="background: rgba(241,76,76,0.06);"' : '') + '>' +
          '<td><span class="link" data-uri="' + esc(r.uri) + '" data-start="' + r.startByte + '" data-end="' + r.endByte + '">' + esc(r.name) + '</span></td>' +
          '<td style="font-family: monospace; font-size: 12px;">' + esc(variable) + '</td>' +
          '<td style="font-family: monospace; text-align: right;">' + esc(peak) + '</td>' +
          '<td style="font-family: monospace; text-align: right;">' + esc(limit) + '</td>' +
          '<td><span class="badge badge-' + r.status + '">' + statusIcon + ' ' + r.status + '</span></td>' +
          '<td style="font-size: 11px; opacity: 0.7;">' + esc(r.status === 'Failed' ? violTime : '—') + '</td>' +
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
      document.getElementById('pendingCount').textContent = Math.max(0, total - passed - failed);
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'verificationStarted':
          document.getElementById('statusBar').style.display = 'block';
          document.getElementById('errorBar').style.display = 'none';
          document.getElementById('runBtn').disabled = true;
          document.getElementById('b2bBtn').disabled = true;
          break;
        case 'verificationComplete':
          document.getElementById('statusBar').style.display = 'none';
          document.getElementById('runBtn').disabled = false;
          document.getElementById('b2bBtn').disabled = false;
          requirements = msg.requirements || [];
          unifiedReport = msg.unifiedReport || null;
          render();
          break;
        case 'b2bComplete':
          document.getElementById('statusBar').style.display = 'none';
          document.getElementById('runBtn').disabled = false;
          document.getElementById('b2bBtn').disabled = false;
          b2bResult = msg.b2bResult || null;
          render();
          break;
        case 'verificationError':
          document.getElementById('statusBar').style.display = 'none';
          document.getElementById('runBtn').disabled = false;
          document.getElementById('b2bBtn').disabled = false;
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
