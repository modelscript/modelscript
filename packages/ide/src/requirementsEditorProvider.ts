import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";

/**
 * Custom editor provider for SysML v2 requirements & Interactive Traceability Matrix (RTM).
 *
 * Opens a rich, interactive digital thread control surface alongside `.sysml` and `.mo` files.
 * Provides:
 *   - Live KPI health metrics & coverage analytics
 *   - Interactive 2D matrix grid with bi-directional click-to-link code synthesis
 *   - Suspect link tracking & one-click re-verification
 *   - Multi-tier domain switching & axis transposition
 *   - Digital thread hierarchy chain view
 *   - CSV compliance export
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

    let currentRowDomain = "sysml_logical";
    let currentColDomain = "requirement";

    // Fetch and send data on first open
    const sendData = async () => {
      try {
        const uri = document.uri.toString();
        const [requirements, matrix, rtmMatrix] = await Promise.all([
          this.client.sendRequest<unknown>("modelscript/getRequirements", { uri }),
          this.client.sendRequest<unknown>("modelscript/getTraceabilityMatrix", { uri }),
          this.client.sendRequest<unknown>("modelscript/getRtmMatrix", {
            uri,
            rowDomain: currentRowDomain,
            colDomain: currentColDomain,
          }),
        ]);
        webviewPanel.webview.postMessage({
          type: "setData",
          requirements,
          matrix,
          rtmMatrix,
          rowDomain: currentRowDomain,
          colDomain: currentColDomain,
        });
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

    // Re-fetch when LSP completes semantic indexing
    const projectTreeListener = this.client.onNotification("modelscript/projectTreeChanged", () => {
      sendData();
    });

    // Handle interactive messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "goToSource": {
          const { uri, startByte, endByte } = msg;
          const targetUri = uri ? vscode.Uri.parse(uri) : document.uri;
          try {
            const doc = await vscode.workspace.openTextDocument(targetUri);
            const startPos = doc.positionAt(startByte ?? 0);
            const endPos = doc.positionAt(endByte ?? startByte ?? 0);
            vscode.window.showTextDocument(doc, {
              selection: new vscode.Range(startPos, endPos),
              viewColumn: vscode.ViewColumn.One,
            });
          } catch (e) {
            vscode.window.showErrorMessage(`Failed to open source: ${e}`);
          }
          break;
        }

        case "refresh":
          sendData();
          break;

        case "changeDomains": {
          currentRowDomain = msg.rowDomain ?? currentRowDomain;
          currentColDomain = msg.colDomain ?? currentColDomain;
          sendData();
          break;
        }

        case "createTraceLink": {
          const { sourceUri, sourceName, targetName, linkKind } = msg;
          try {
            const res = await this.client.sendRequest<{ success: boolean; error?: string }>(
              "modelscript/createTraceLink",
              {
                sourceUri: sourceUri || document.uri.toString(),
                sourceName,
                targetName,
                linkKind: linkKind || "satisfy",
              },
            );
            if (res.success) {
              vscode.window.showInformationMessage(
                `Created ${linkKind || "satisfy"} link between '${sourceName}' and '${targetName}'`,
              );
              sendData();
            } else {
              vscode.window.showErrorMessage(`Failed to create trace link: ${res.error}`);
            }
          } catch (e) {
            vscode.window.showErrorMessage(`Error creating trace link: ${e}`);
          }
          break;
        }

        case "deleteTraceLink": {
          const { declarationUri, sourceName, targetName, linkKind, declarationRange } = msg;
          try {
            const res = await this.client.sendRequest<{ success: boolean; error?: string }>(
              "modelscript/deleteTraceLink",
              {
                declarationUri: declarationUri || document.uri.toString(),
                sourceName,
                targetName,
                linkKind: linkKind || "satisfy",
                declarationRange,
              },
            );
            if (res.success) {
              vscode.window.showInformationMessage(`Removed link: ${sourceName} → ${targetName}`);
              sendData();
            } else {
              vscode.window.showErrorMessage(`Failed to remove trace link: ${res.error}`);
            }
          } catch (e) {
            vscode.window.showErrorMessage(`Error removing trace link: ${e}`);
          }
          break;
        }

        case "clearSuspectLink": {
          await this.client.sendRequest("modelscript/clearSuspectLink", { linkKey: msg.linkKey });
          sendData();
          break;
        }

        case "reverifyLink": {
          const targetUri = msg.targetUri || document.uri.toString();
          const targetName = msg.targetName;
          vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Re-verifying ${targetName || "trace link"}...`,
            },
            async () => {
              try {
                await this.client.sendRequest("modelscript/reverifyLink", { targetUri, targetName });
                sendData();
              } catch (e) {
                vscode.window.showErrorMessage(`Re-verification failed: ${e}`);
              }
            },
          );
          break;
        }

        case "exportRtm": {
          try {
            const res = await this.client.sendRequest<{ csv: string; filename: string }>("modelscript/exportRtm", {
              uri: document.uri.toString(),
              rowDomain: currentRowDomain,
              colDomain: currentColDomain,
            });
            if (res?.csv) {
              const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(res.filename),
                filters: { "CSV Files": ["csv"] },
              });
              if (saveUri) {
                await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(res.csv));
                vscode.window.showInformationMessage(`Exported RTM to ${saveUri.fsPath}`);
              }
            }
          } catch (e) {
            vscode.window.showErrorMessage(`Export failed: ${e}`);
          }
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      changeListener.dispose();
      projectTreeListener.dispose();
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
  <title>Requirements & Traceability Control Surface</title>
  <style nonce="${nonce}">
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #cccccc);
      --border: var(--vscode-panel-border, #333333);
      --header-bg: var(--vscode-editorGroupHeader-tabsBackground, #252526);
      --row-hover: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06));
      --accent: var(--vscode-focusBorder, #007acc);
      --badge-pass: #4ec9b0;
      --badge-fail: #f14c4c;
      --badge-pending: #cca700;
      --badge-suspect: #ff9800;
      --satisfy-bg: rgba(78, 201, 176, 0.18);
      --verify-bg: rgba(0, 122, 204, 0.22);
      --allocate-bg: rgba(186, 104, 200, 0.2);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0;
      background: var(--bg); color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      user-select: none;
    }

    /* Top KPI Health Ribbon */
    .kpi-ribbon {
      display: flex; gap: 12px; padding: 12px 16px;
      background: var(--header-bg); border-bottom: 1px solid var(--border);
      flex-wrap: wrap; align-items: center;
    }
    .kpi-card {
      display: flex; flex-direction: column; gap: 2px;
      padding: 6px 12px; border-radius: 6px;
      background: rgba(255,255,255,0.04); border: 1px solid var(--border);
      min-width: 110px; cursor: pointer; transition: background 0.15s;
    }
    .kpi-card:hover { background: rgba(255,255,255,0.08); }
    .kpi-card.active { border-color: var(--accent); background: rgba(0,122,204,0.15); }
    .kpi-val { font-size: 16px; font-weight: 700; }
    .kpi-label { font-size: 11px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.5px; }

    /* Controls & Toolbar */
    .toolbar {
      display: flex; align-items: center; gap: 10px; padding: 10px 16px;
      border-bottom: 1px solid var(--border); flex-wrap: wrap;
    }
    .toolbar h2 { margin: 0; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
    input[type="text"], select {
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 4px; padding: 5px 10px; font-size: 12px; outline: none;
    }
    input[type="text"]:focus, select:focus { border-color: var(--accent); }
    button {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none; border-radius: 4px; padding: 5px 12px; font-size: 12px;
      cursor: pointer; display: flex; align-items: center; gap: 4px; transition: opacity 0.15s;
    }
    button:hover { opacity: 0.9; }
    button.secondary {
      background: transparent; border: 1px solid var(--border); color: var(--fg);
    }
    button.secondary:hover { background: var(--row-hover); }

    /* Tabs */
    .tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--header-bg); }
    .tab {
      padding: 8px 18px; cursor: pointer; border-bottom: 2px solid transparent;
      font-size: 12px; font-weight: 500; opacity: 0.7; transition: all 0.15s;
    }
    .tab:hover { opacity: 1; }
    .tab.active { opacity: 1; border-bottom-color: var(--accent); color: var(--accent); }

    .panel { display: none; padding: 12px 16px; }
    .panel.active { display: block; }

    /* Tables & Matrix */
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th {
      background: var(--header-bg); text-align: left; padding: 8px 12px;
      border-bottom: 2px solid var(--border); font-weight: 600; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    td { padding: 6px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    tr:hover td { background: var(--row-hover); }

    /* Matrix Styles */
    .matrix-wrapper {
      overflow: auto; max-height: calc(100vh - 230px); border: 1px solid var(--border);
      border-radius: 4px; position: relative;
    }
    .matrix-table { border-collapse: separate; border-spacing: 0; }
    .matrix-table th, .matrix-table td {
      border: 1px solid var(--border); text-align: center; min-width: 120px; max-width: 180px;
      padding: 6px 8px; position: relative;
    }
    .matrix-table th.corner {
      position: sticky; top: 0; left: 0; z-index: 3; background: var(--header-bg);
    }
    .matrix-table th.col-header {
      position: sticky; top: 0; z-index: 2; background: var(--header-bg);
      writing-mode: horizontal-tb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .matrix-table th.row-header {
      position: sticky; left: 0; z-index: 1; background: var(--header-bg);
      text-align: left; white-space: nowrap;
    }

    /* Matrix Cell Badges */
    .cell-btn {
      width: 100%; height: 28px; border-radius: 4px; border: 1px dashed transparent;
      background: transparent; color: inherit; display: flex; align-items: center;
      justify-content: center; font-size: 11px; font-weight: 600; cursor: pointer;
      position: relative; transition: all 0.15s;
    }
    .cell-empty:hover {
      border-color: var(--accent); background: rgba(0,122,204,0.1);
    }
    .cell-empty:hover::after { content: "+ Link"; color: var(--accent); font-size: 10px; }

    .cell-satisfy {
      background: var(--satisfy-bg); color: var(--badge-pass); border: 1px solid rgba(78, 201, 176, 0.4);
    }
    .cell-verify {
      background: var(--verify-bg); color: #4fc1ff; border: 1px solid rgba(79, 193, 255, 0.4);
    }
    .cell-allocate {
      background: var(--allocate-bg); color: #ce9178; border: 1px solid rgba(206, 145, 120, 0.4);
    }
    .cell-suspect {
      background: rgba(255, 152, 0, 0.2); border: 1px solid var(--badge-suspect) !important;
      color: var(--badge-suspect); animation: pulse 2s infinite;
    }
    .cell-failed {
      background: rgba(241, 76, 76, 0.2); border: 1px solid var(--badge-fail) !important;
      color: var(--badge-fail);
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(255, 152, 0, 0.4); }
      70% { box-shadow: 0 0 0 6px rgba(255, 152, 0, 0); }
      100% { box-shadow: 0 0 0 0 rgba(255, 152, 0, 0); }
    }

    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 10px;
      font-size: 11px; font-weight: 600;
    }
    .badge-Passed { background: rgba(78,201,176,0.2); color: var(--badge-pass); }
    .badge-Failed { background: rgba(241,76,76,0.2); color: var(--badge-fail); }
    .badge-Pending { background: rgba(204,167,0,0.2); color: var(--badge-pending); }
    .badge-Suspect { background: rgba(255,152,0,0.2); color: var(--badge-suspect); }

    /* Interactive Action Popover */
    .popover {
      position: fixed; z-index: 1000; background: var(--header-bg);
      border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      padding: 8px; min-width: 200px; display: none; flex-direction: column; gap: 4px;
    }
    .popover-header {
      font-size: 11px; opacity: 0.7; padding: 4px 8px; border-bottom: 1px solid var(--border);
      margin-bottom: 4px; font-weight: 600;
    }
    .popover-item {
      padding: 6px 10px; font-size: 12px; cursor: pointer; border-radius: 4px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .popover-item:hover { background: var(--row-hover); }
    .popover-item.danger { color: var(--badge-fail); }
    .popover-item.danger:hover { background: rgba(241,76,76,0.15); }

    /* Traceability Chain Tree View */
    .chain-tree { display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 200px); overflow: auto; }
    .chain-card {
      background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 6px;
      padding: 10px 14px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    }
    .chain-node {
      display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 4px;
      background: rgba(255,255,255,0.06); font-size: 12px;
    }
    .chain-arrow { opacity: 0.5; font-size: 14px; }

    .link-src { cursor: pointer; color: #4fc1ff; text-decoration: underline; }
    .link-src:hover { opacity: 0.8; }
    .empty-state { text-align: center; padding: 50px 20px; opacity: 0.6; }
  </style>
</head>
<body>

  <!-- Top KPI Ribbon -->
  <div class="kpi-ribbon">
    <div class="kpi-card" id="kpiTotal" title="Click to show all requirements">
      <span class="kpi-val" id="valTotal">—</span>
      <span class="kpi-label">Requirements</span>
    </div>
    <div class="kpi-card" id="kpiSatisfied" title="Click to filter satisfied">
      <span class="kpi-val" style="color: var(--badge-pass);" id="valSatisfied">—%</span>
      <span class="kpi-label">Satisfied</span>
    </div>
    <div class="kpi-card" id="kpiVerified" title="Click to filter verified">
      <span class="kpi-val" style="color: #4fc1ff;" id="valVerified">—%</span>
      <span class="kpi-label">Verified</span>
    </div>
    <div class="kpi-card" id="kpiSuspect" title="Click to show suspect links">
      <span class="kpi-val" style="color: var(--badge-suspect);" id="valSuspect">—</span>
      <span class="kpi-label">⚠️ Suspect</span>
    </div>
    <div class="kpi-card" id="kpiOrphans" title="Click to show orphan requirements">
      <span class="kpi-val" style="color: var(--badge-fail);" id="valOrphans">—</span>
      <span class="kpi-label">Orphans</span>
    </div>
  </div>

  <!-- Main Toolbar -->
  <div class="toolbar">
    <h2>📋 Traceability Surface</h2>
    <input type="text" id="search" placeholder="Filter elements…" style="width: 180px;" />
    
    <label style="font-size: 11px; opacity: 0.8;">Rows:</label>
    <select id="rowDomainSelect">
      <option value="sysml_logical">Logical Parts (SysML)</option>
      <option value="modelica_physics">Physics Models (Modelica)</option>
      <option value="verification_case">Verification Cases</option>
    </select>

    <label style="font-size: 11px; opacity: 0.8;">Cols:</label>
    <select id="colDomainSelect">
      <option value="requirement">Requirements</option>
      <option value="verification_case">Verification Cases</option>
      <option value="sysml_logical">Logical Parts</option>
    </select>

    <button id="transposeBtn" class="secondary" title="Swap Rows and Columns">⤾ Transpose</button>
    <button id="exportCsvBtn" class="secondary" title="Export matrix as CSV">⬇ Export CSV</button>
    <button id="refreshBtn" title="Refresh index">⟳ Refresh</button>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <div class="tab active" data-tab="matrix">Interactive Matrix</div>
    <div class="tab" data-tab="chain">Digital Thread Chain</div>
    <div class="tab" data-tab="grid">Requirements Catalog</div>
  </div>

  <!-- 1. Interactive Matrix Panel -->
  <div id="matrixPanel" class="panel active">
    <div class="matrix-wrapper" id="matrixWrapper">
      <div class="empty-state">Loading Traceability Matrix…</div>
    </div>
  </div>

  <!-- 2. Digital Thread Chain Panel -->
  <div id="chainPanel" class="panel">
    <div class="chain-tree" id="chainTree">
      <div class="empty-state">Loading Digital Thread Chain…</div>
    </div>
  </div>

  <!-- 3. Requirements Catalog Panel -->
  <div id="gridPanel" class="panel">
    <div id="reqGridContainer"></div>
  </div>

  <!-- Action Popover Menu -->
  <div id="actionPopover" class="popover"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let allRequirements = [];
    let rtmMatrix = null;
    let activeFilter = '';
    let quickFilter = 'all'; // 'all' | 'suspect' | 'orphan' | 'failed'

    // DOM Elements
    const matrixWrapper = document.getElementById('matrixWrapper');
    const chainTree = document.getElementById('chainTree');
    const reqGridContainer = document.getElementById('reqGridContainer');
    const rowDomainSelect = document.getElementById('rowDomainSelect');
    const colDomainSelect = document.getElementById('colDomainSelect');
    const actionPopover = document.getElementById('actionPopover');

    // Tab Switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + 'Panel').classList.add('active');
      });
    });

    // KPI Card Click Filters
    document.getElementById('kpiTotal').addEventListener('click', () => setQuickFilter('all'));
    document.getElementById('kpiSatisfied').addEventListener('click', () => setQuickFilter('all'));
    document.getElementById('kpiVerified').addEventListener('click', () => setQuickFilter('all'));
    document.getElementById('kpiSuspect').addEventListener('click', () => setQuickFilter('suspect'));
    document.getElementById('kpiOrphans').addEventListener('click', () => setQuickFilter('orphan'));

    function setQuickFilter(mode) {
      quickFilter = mode;
      document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('active'));
      if (mode === 'suspect') document.getElementById('kpiSuspect').classList.add('active');
      if (mode === 'orphan') document.getElementById('kpiOrphans').classList.add('active');
      renderCurrentViews();
    }

    // Domain selectors & Transpose
    rowDomainSelect.addEventListener('change', () => {
      vscode.postMessage({
        type: 'changeDomains',
        rowDomain: rowDomainSelect.value,
        colDomain: colDomainSelect.value,
      });
    });

    colDomainSelect.addEventListener('change', () => {
      vscode.postMessage({
        type: 'changeDomains',
        rowDomain: rowDomainSelect.value,
        colDomain: colDomainSelect.value,
      });
    });

    document.getElementById('transposeBtn').addEventListener('click', () => {
      const r = rowDomainSelect.value;
      const c = colDomainSelect.value;
      rowDomainSelect.value = c;
      colDomainSelect.value = r;
      vscode.postMessage({ type: 'changeDomains', rowDomain: c, colDomain: r });
    });

    document.getElementById('refreshBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    document.getElementById('exportCsvBtn').addEventListener('click', () => {
      vscode.postMessage({
        type: 'exportRtm',
        rowDomain: rowDomainSelect.value,
        colDomain: colDomainSelect.value,
      });
    });

    document.getElementById('search').addEventListener('input', (e) => {
      activeFilter = e.target.value.toLowerCase();
      renderCurrentViews();
    });

    // Close popover on outside click
    window.addEventListener('click', (e) => {
      if (!actionPopover.contains(e.target) && !e.target.classList.contains('cell-btn')) {
        actionPopover.style.display = 'none';
      }
    });

    // Render all views
    function renderCurrentViews() {
      renderRibbon();
      renderMatrix();
      renderChain();
      renderGrid();
    }

    function renderRibbon() {
      if (!rtmMatrix?.analytics) return;
      const a = rtmMatrix.analytics;
      document.getElementById('valTotal').textContent = a.totalRequirements;
      document.getElementById('valSatisfied').textContent = a.satisfiedPercentage + '%';
      document.getElementById('valVerified').textContent = a.verifiedPercentage + '%';
      document.getElementById('valSuspect').textContent = a.suspectLinkCount;
      document.getElementById('valOrphans').textContent = a.orphanRequirements.length;
    }

    // ── 1. Interactive Matrix Rendering ─────────────────────────────────────
    function renderMatrix() {
      if (!rtmMatrix || !rtmMatrix.rows || !rtmMatrix.cols) {
        matrixWrapper.innerHTML = '<div class="empty-state">No matrix data available.</div>';
        return;
      }

      let { rows, cols, links } = rtmMatrix;

      // Filtering
      if (activeFilter) {
        rows = rows.filter(r => r.name.toLowerCase().includes(activeFilter));
        cols = cols.filter(c => c.name.toLowerCase().includes(activeFilter));
      }

      if (quickFilter === 'orphan' && rtmMatrix.analytics) {
        const orphans = new Set(rtmMatrix.analytics.orphanRequirements);
        cols = cols.filter(c => orphans.has(c.name));
      }

      if (rows.length === 0 || cols.length === 0) {
        matrixWrapper.innerHTML = '<div class="empty-state">No matching rows or columns found.</div>';
        return;
      }

      let html = '<table class="matrix-table"><thead><tr>';
      html += '<th class="corner">' + esc(rowDomainSelect.options[rowDomainSelect.selectedIndex].text) + ' \\ ' +
              esc(colDomainSelect.options[colDomainSelect.selectedIndex].text) + '</th>';

      for (const col of cols) {
        html += '<th class="col-header" title="' + esc(col.name) + '">' + esc(col.name) + '</th>';
      }
      html += '</tr></thead><tbody>';

      for (const row of rows) {
        html += '<tr>';
        html += '<th class="row-header" title="' + esc(row.name) + '"><span class="link-src" data-uri="' +
                esc(row.uri) + '" data-start="' + row.startByte + '" data-end="' + row.endByte + '">' +
                esc(row.name) + '</span></th>';

        for (const col of cols) {
          const key = row.name + '|' + col.name;
          const link = links[key];

          let cellClass = 'cell-empty';
          let label = '';

          if (link) {
            if (link.isSuspect) {
              cellClass = 'cell-suspect';
              label = '⚠️ Suspect';
            } else if (link.status === 'failed') {
              cellClass = 'cell-failed';
              label = '❌ Failed';
            } else if (link.status === 'passed') {
              cellClass = 'cell-verify';
              label = '✓ Passed';
            } else if (link.linkKind === 'satisfy') {
              cellClass = 'cell-satisfy';
              label = '✓ Satisfy';
            } else if (link.linkKind === 'verify') {
              cellClass = 'cell-verify';
              label = '⚡ Verify';
            } else {
              cellClass = 'cell-allocate';
              label = '🔗 ' + link.linkKind;
            }
          }

          html += '<td><button class="cell-btn ' + cellClass + '" data-row="' + esc(row.name) +
                  '" data-col="' + esc(col.name) + '" data-rowuri="' + esc(row.uri) +
                  '" data-coluri="' + esc(col.uri) + '" data-key="' + esc(key) + '">' +
                  esc(label) + '</button></td>';
        }
        html += '</tr>';
      }

      html += '</tbody></table>';
      matrixWrapper.innerHTML = html;

      // Attach Click-to-Connect / Popover handlers
      matrixWrapper.querySelectorAll('.cell-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          showCellPopover(btn, e);
        });
      });

      // Wire go-to-source on row headers
      matrixWrapper.querySelectorAll('.link-src').forEach(el => {
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

    // ── Popover Menu for Cell Linking & Verification ────────────────────────
    function showCellPopover(btn, event) {
      const row = btn.dataset.row;
      const col = btn.dataset.col;
      const rowUri = btn.dataset.rowuri;
      const colUri = btn.dataset.coluri;
      const key = btn.dataset.key;
      const link = rtmMatrix?.links?.[key];

      let html = '<div class="popover-header">' + esc(row) + ' ➔ ' + esc(col) + '</div>';

      if (!link) {
        // Empty cell: Synthesis actions
        html += '<div class="popover-item" id="actSatisfy">✓ Satisfy requirement</div>';
        html += '<div class="popover-item" id="actVerify">⚡ Verify requirement</div>';
        html += '<div class="popover-item" id="actAllocate">🔗 Allocate to target</div>';
      } else {
        // Existing link: Inspection, Re-verification & Deletion
        html += '<div class="popover-item" id="actGoToSource">🔍 Go to declaration</div>';
        if (link.isSuspect) {
          html += '<div class="popover-item" id="actReverify">⚡ Re-verify link</div>';
          html += '<div class="popover-item" id="actAckSuspect">✓ Acknowledge (Clear suspect)</div>';
        }
        html += '<div class="popover-item danger" id="actDeleteLink">✕ Delete trace link</div>';
      }

      actionPopover.innerHTML = html;
      actionPopover.style.display = 'flex';
      actionPopover.style.left = Math.min(event.clientX + 10, window.innerWidth - 220) + 'px';
      actionPopover.style.top = Math.min(event.clientY + 10, window.innerHeight - 200) + 'px';

      // Attach popover actions
      const satisfyBtn = document.getElementById('actSatisfy');
      if (satisfyBtn) {
        satisfyBtn.addEventListener('click', () => {
          actionPopover.style.display = 'none';
          vscode.postMessage({
            type: 'createTraceLink',
            sourceUri: rowUri,
            sourceName: row,
            targetName: col,
            linkKind: 'satisfy',
          });
        });
      }

      const verifyBtn = document.getElementById('actVerify');
      if (verifyBtn) {
        verifyBtn.addEventListener('click', () => {
          actionPopover.style.display = 'none';
          vscode.postMessage({
            type: 'createTraceLink',
            sourceUri: rowUri,
            sourceName: row,
            targetName: col,
            linkKind: 'verify',
          });
        });
      }

      const allocateBtn = document.getElementById('actAllocate');
      if (allocateBtn) {
        allocateBtn.addEventListener('click', () => {
          actionPopover.style.display = 'none';
          vscode.postMessage({
            type: 'createTraceLink',
            sourceUri: rowUri,
            sourceName: row,
            targetName: col,
            linkKind: 'allocate',
          });
        });
      }

      const goToSourceBtn = document.getElementById('actGoToSource');
      if (goToSourceBtn) {
        goToSourceBtn.addEventListener('click', () => {
          actionPopover.style.display = 'none';
          vscode.postMessage({
            type: 'goToSource',
            uri: link.declarationUri || rowUri,
            startByte: link.declarationStartByte ?? 0,
            endByte: link.declarationEndByte ?? 0,
          });
        });
      }

      const reverifyBtn = document.getElementById('actReverify');
      if (reverifyBtn) {
        reverifyBtn.addEventListener('click', () => {
          actionPopover.style.display = 'none';
          vscode.postMessage({
            type: 'reverifyLink',
            targetUri: colUri,
            targetName: col,
          });
        });
      }

      const ackBtn = document.getElementById('actAckSuspect');
      if (ackBtn) {
        ackBtn.addEventListener('click', () => {
          actionPopover.style.display = 'none';
          vscode.postMessage({ type: 'clearSuspectLink', linkKey: key });
        });
      }

      const deleteBtn = document.getElementById('actDeleteLink');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
          actionPopover.style.display = 'none';
          vscode.postMessage({
            type: 'deleteTraceLink',
            declarationUri: link.declarationUri || rowUri,
            sourceName: row,
            targetName: col,
            linkKind: link.linkKind,
            declarationRange: link.declarationStartByte !== undefined
              ? [link.declarationStartByte, link.declarationEndByte]
              : undefined,
          });
        });
      }
    }

    // ── 2. Digital Thread Chain View ────────────────────────────────────────
    function renderChain() {
      if (!rtmMatrix || !rtmMatrix.links) {
        chainTree.innerHTML = '<div class="empty-state">No digital thread links available.</div>';
        return;
      }

      const entries = Object.values(rtmMatrix.links);
      if (entries.length === 0) {
        chainTree.innerHTML = '<div class="empty-state">No trace links recorded yet. Click on the Interactive Matrix to connect elements.</div>';
        return;
      }

      let html = '';
      for (const link of entries) {
        html += '<div class="chain-card">';
        html += '<div class="chain-node" style="color: #4fc1ff;">🏛 ' + esc(link.sourceName) + '</div>';
        html += '<div class="chain-arrow">➔ <b>' + esc(link.linkKind) + '</b> ➔</div>';
        html += '<div class="chain-node" style="color: var(--badge-pass);">📋 ' + esc(link.targetName) + '</div>';
        html += '<div style="margin-left: auto;"><span class="badge badge-' +
                (link.isSuspect ? 'Suspect' : link.status === 'passed' ? 'Passed' : link.status === 'failed' ? 'Failed' : 'Pending') +
                '">' + (link.isSuspect ? '⚠️ Suspect' : link.status) + '</span></div>';
        html += '</div>';
      }

      chainTree.innerHTML = html;
    }

    // ── 3. Requirements Catalog Grid ────────────────────────────────────────
    function renderGrid() {
      if (!allRequirements || allRequirements.length === 0) {
        reqGridContainer.innerHTML = '<div class="empty-state">No requirements loaded.</div>';
        return;
      }

      let reqs = allRequirements;
      if (activeFilter) {
        reqs = reqs.filter(r =>
          r.name.toLowerCase().includes(activeFilter) ||
          (r.reqId && r.reqId.toLowerCase().includes(activeFilter)) ||
          (r.text && r.text.toLowerCase().includes(activeFilter))
        );
      }

      let html = '<table><thead><tr>' +
        '<th>ID</th><th>Type</th><th>Name</th><th>Description</th><th>Constraints</th><th>Status</th>' +
        '</tr></thead><tbody>';

      for (const r of reqs) {
        html += '<tr>' +
          '<td><span style="font-family: monospace; opacity: 0.8;">' + esc(r.reqId || '—') + '</span></td>' +
          '<td><span class="badge" style="background: rgba(255,255,255,0.06);">' + esc(r.type.replace('Requirement', 'Req')) + '</span></td>' +
          '<td><span class="link-src" data-uri="' + esc(r.uri) + '" data-start="' + r.startByte + '" data-end="' + r.endByte + '">' + esc(r.name) + '</span></td>' +
          '<td>' + esc(r.text || '—') + '</td>' +
          '<td>' + (r.constraintIds ? r.constraintIds.length : 0) + '</td>' +
          '<td><span class="badge badge-' + (r.status || 'Pending') + '">' + (r.status || 'Pending') + '</span></td>' +
          '</tr>';
      }

      html += '</tbody></table>';
      reqGridContainer.innerHTML = html;

      reqGridContainer.querySelectorAll('.link-src').forEach(el => {
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

    // ── Message Listener ────────────────────────────────────────────────────
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'setData':
          allRequirements = msg.requirements || [];
          rtmMatrix = msg.rtmMatrix || null;
          if (msg.rowDomain) rowDomainSelect.value = msg.rowDomain;
          if (msg.colDomain) colDomainSelect.value = msg.colDomain;
          renderCurrentViews();
          break;
      }
    });

    function esc(s) {
      if (s === undefined || s === null) return '';
      const div = document.createElement('div');
      div.textContent = String(s);
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
