import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";

/**
 * Custom editor provider for SysML v2 requirements & Interactive Traceability Matrix (RTM).
 *
 * Opens a rich, interactive digital thread control surface alongside `.sysml` and `.mo` files.
 * Provides:
 *   - Live KPI health metrics & coverage analytics
 *   - Interactive 2D matrix grid with bi-directional click-to-link code synthesis
 *   - 6 Standard matrix presets (Allocations, Satisfaction, Verification, N² Interfaces, Derivation, Risk Mitigation)
 *   - Dense Mode toggle with compact glyphs for high-density scanning
 *   - Collapsible hierarchical package group headers
 *   - Multi-cell marquee / shift-selection with floating batch linking actions
 *   - Suspect link tracking & one-click re-verification
 *   - Multi-tier domain switching & axis transposition
 *   - Digital thread hierarchy chain view
 *   - CSV & TSV compliance export
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
    let currentColDomain = "physical_component";
    let currentPresetId = "allocations";

    // Fetch and send data on first open
    const sendData = async () => {
      try {
        const uri = document.uri.toString();
        const [requirements, matrix, rtmMatrix, presets] = await Promise.all([
          this.client.sendRequest<unknown>("modelscript/getRequirements", { uri }),
          this.client.sendRequest<unknown>("modelscript/getTraceabilityMatrix", { uri }),
          this.client.sendRequest<unknown>("modelscript/getRtmMatrix", {
            uri,
            rowDomain: currentRowDomain,
            colDomain: currentColDomain,
          }),
          this.client.sendRequest<unknown>("modelscript/getMatrixPresets", {}).catch(() => []),
        ]);
        webviewPanel.webview.postMessage({
          type: "setData",
          requirements,
          matrix,
          rtmMatrix,
          presets,
          rowDomain: currentRowDomain,
          colDomain: currentColDomain,
          presetId: currentPresetId,
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

        case "applyPreset": {
          currentPresetId = msg.presetId ?? currentPresetId;
          currentRowDomain = msg.rowDomain ?? currentRowDomain;
          currentColDomain = msg.colDomain ?? currentColDomain;
          sendData();
          break;
        }

        case "changeDomains": {
          currentPresetId = "custom";
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

        case "batchUpdateTraceLinks": {
          const { additions, deletions } = msg;
          try {
            const res = await this.client.sendRequest<{ success: boolean; appliedCount: number; errors?: string[] }>(
              "modelscript/batchUpdateTraceLinks",
              { additions, deletions },
            );
            if (res.success) {
              vscode.window.showInformationMessage(
                `Batch updated ${res.appliedCount} trace link(s)` +
                  (res.errors && res.errors.length > 0 ? ` (${res.errors.length} failed)` : ""),
              );
              sendData();
            } else {
              vscode.window.showErrorMessage(`Batch update failed: ${res.errors?.join(", ") ?? "Unknown error"}`);
            }
          } catch (e) {
            vscode.window.showErrorMessage(`Error batch updating trace links: ${e}`);
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
      --connect-bg: rgba(79, 193, 255, 0.18);
      --derive-bg: rgba(220, 180, 50, 0.2);
      --mitigate-bg: rgba(100, 200, 100, 0.2);
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
    button.secondary.active {
      background: rgba(0, 122, 204, 0.25); border-color: var(--accent); color: #fff;
    }

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
      position: sticky; top: 0; left: 0; z-index: 4; background: var(--header-bg);
      text-align: left;
    }
    .matrix-table th.col-header {
      position: sticky; top: 0; z-index: 3; background: var(--header-bg);
      writing-mode: horizontal-tb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .matrix-table th.row-header {
      position: sticky; left: 0; z-index: 2; background: var(--header-bg);
      text-align: left; white-space: nowrap;
    }

    /* Hierarchical Package Group Headers */
    .group-header-row th {
      position: sticky; left: 0; z-index: 2;
      background: rgba(255,255,255,0.06); text-align: left;
      padding: 6px 12px; font-size: 11px; font-weight: 700;
      color: #9cdcfe; cursor: pointer; letter-spacing: 0.5px;
      border-top: 2px solid var(--border);
    }
    .group-header-row:hover th { background: rgba(255,255,255,0.09); }
    .chevron { display: inline-block; width: 14px; transition: transform 0.15s; }

    /* Dense Mode */
    .matrix-table.dense th, .matrix-table.dense td {
      min-width: 38px; max-width: 50px; padding: 2px; height: 24px; font-size: 11px;
    }
    .matrix-table.dense .cell-btn {
      height: 20px; font-size: 11px; padding: 0;
    }
    .matrix-table.dense .cell-label-full { display: none; }
    .matrix-table.dense .cell-glyph { display: inline !important; font-weight: bold; }
    .cell-glyph { display: none; }

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
    .cell-empty:hover::after { content: "+"; color: var(--accent); font-size: 12px; }

    .cell-satisfy {
      background: var(--satisfy-bg); color: var(--badge-pass); border: 1px solid rgba(78, 201, 176, 0.4);
    }
    .cell-verify {
      background: var(--verify-bg); color: #4fc1ff; border: 1px solid rgba(79, 193, 255, 0.4);
    }
    .cell-allocate {
      background: var(--allocate-bg); color: #ce9178; border: 1px solid rgba(206, 145, 120, 0.4);
    }
    .cell-connect {
      background: var(--connect-bg); color: #4fc1ff; border: 1px solid rgba(79, 193, 255, 0.4);
    }
    .cell-derive {
      background: var(--derive-bg); color: #dcdcaa; border: 1px solid rgba(220, 220, 170, 0.4);
    }
    .cell-mitigate {
      background: var(--mitigate-bg); color: #b5cea8; border: 1px solid rgba(181, 206, 168, 0.4);
    }
    .cell-suspect {
      background: rgba(255, 152, 0, 0.2); border: 1px solid var(--badge-suspect) !important;
      color: var(--badge-suspect); animation: pulse 2s infinite;
    }
    .cell-failed {
      background: rgba(241, 76, 76, 0.2); border: 1px solid var(--badge-fail) !important;
      color: var(--badge-fail);
    }

    /* Selected cell for batch operations */
    .cell-selected {
      outline: 2px solid var(--accent) !important;
      outline-offset: -2px;
      background: rgba(0, 122, 204, 0.28) !important;
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
      padding: 8px; min-width: 220px; display: none; flex-direction: column; gap: 4px;
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

    /* Floating Batch Action Bar */
    .batch-bar {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      background: var(--header-bg); border: 1px solid var(--accent);
      border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      padding: 8px 16px; display: flex; align-items: center; gap: 14px;
      z-index: 999; animation: slideUp 0.2s ease-out;
    }
    @keyframes slideUp {
      from { transform: translate(-50%, 20px); opacity: 0; }
      to { transform: translate(-50%, 0); opacity: 1; }
    }
    .batch-count { font-weight: 600; font-size: 12px; color: #4fc1ff; }
    .batch-buttons { display: flex; gap: 6px; align-items: center; }
    .batch-btn { padding: 4px 10px; font-size: 11px; }
    .batch-danger { background: var(--badge-fail); }

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
    <input type="text" id="search" placeholder="Filter elements…" style="width: 160px;" />
    
    <label style="font-size: 11px; opacity: 0.8;">Preset:</label>
    <select id="presetSelect" style="min-width: 170px; font-weight: 600;">
      <option value="allocations">Allocations (Logical ➔ Physical)</option>
      <option value="satisfaction">Requirements Satisfaction</option>
      <option value="verification">Verification Matrix</option>
      <option value="n2_interfaces">N² Interface Matrix</option>
      <option value="derivation">Requirement Derivation</option>
      <option value="risk_mitigation">Risk Mitigation</option>
      <option value="custom">Custom (Manual Domains)</option>
    </select>

    <label style="font-size: 11px; opacity: 0.8;">Rows:</label>
    <select id="rowDomainSelect">
      <option value="sysml_logical">Logical Parts (SysML)</option>
      <option value="physical_component">Physical Hardware</option>
      <option value="modelica_physics">Physics Models (Modelica)</option>
      <option value="requirement">Requirements</option>
      <option value="verification_case">Verification Cases</option>
      <option value="sysml_port">Ports & Interfaces</option>
      <option value="sysml_activity">Actions & Activities</option>
    </select>

    <label style="font-size: 11px; opacity: 0.8;">Cols:</label>
    <select id="colDomainSelect">
      <option value="physical_component">Physical Hardware</option>
      <option value="requirement">Requirements</option>
      <option value="verification_case">Verification Cases</option>
      <option value="sysml_logical">Logical Parts (SysML)</option>
      <option value="modelica_physics">Physics Models (Modelica)</option>
      <option value="sysml_port">Ports & Interfaces</option>
      <option value="sysml_activity">Actions & Activities</option>
    </select>

    <button id="denseToggleBtn" class="secondary" title="Toggle Compact / Dense View">🗜 Dense View</button>
    <button id="transposeBtn" class="secondary" title="Swap Rows and Columns">⤾ Transpose</button>
    <button id="exportCsvBtn" class="secondary" title="Export matrix as CSV">⬇ Export CSV</button>
    <button id="copyTsvBtn" class="secondary" title="Copy matrix to clipboard as TSV">📋 Copy TSV</button>
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

  <!-- Floating Batch Action Bar -->
  <div id="batchBar" class="batch-bar" style="display: none;">
    <span id="batchCount" class="batch-count">0 cells selected</span>
    <div class="batch-buttons">
      <button id="batchAllocateBtn" class="batch-btn" title="Allocate selected logical to physical">🔗 Allocate</button>
      <button id="batchSatisfyBtn" class="batch-btn" title="Satisfy selected requirements">✓ Satisfy</button>
      <button id="batchVerifyBtn" class="batch-btn" title="Verify selected requirements">⚡ Verify</button>
      <button id="batchConnectBtn" class="batch-btn" title="Connect selected interfaces">⇄ Connect</button>
      <button id="batchDeleteBtn" class="batch-btn batch-danger" title="Remove existing links">✕ Remove</button>
      <button id="batchCancelBtn" class="batch-btn secondary" title="Cancel selection">Cancel</button>
    </div>
  </div>

  <!-- Action Popover Menu -->
  <div id="actionPopover" class="popover"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let allRequirements = [];
    let rtmMatrix = null;
    let availablePresets = [];
    let activeFilter = '';
    let quickFilter = 'all'; // 'all' | 'suspect' | 'orphan' | 'failed'
    let isDenseMode = false;
    let collapsedGroups = new Set();
    let selectedCells = new Map(); // key -> { row, col, rowUri, colUri, key, link }
    let isMouseDown = false;

    const PRESET_MAP = {
      allocations: { row: 'sysml_logical', col: 'physical_component' },
      satisfaction: { row: 'sysml_logical', col: 'requirement' },
      verification: { row: 'verification_case', col: 'requirement' },
      n2_interfaces: { row: 'sysml_port', col: 'sysml_port' },
      derivation: { row: 'requirement', col: 'requirement' },
      risk_mitigation: { row: 'sysml_activity', col: 'requirement' },
    };

    // DOM Elements
    const matrixWrapper = document.getElementById('matrixWrapper');
    const chainTree = document.getElementById('chainTree');
    const reqGridContainer = document.getElementById('reqGridContainer');
    const presetSelect = document.getElementById('presetSelect');
    const rowDomainSelect = document.getElementById('rowDomainSelect');
    const colDomainSelect = document.getElementById('colDomainSelect');
    const actionPopover = document.getElementById('actionPopover');
    const denseToggleBtn = document.getElementById('denseToggleBtn');
    const batchBar = document.getElementById('batchBar');
    const batchCount = document.getElementById('batchCount');

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

    // Preset Selection
    presetSelect.addEventListener('change', () => {
      const pid = presetSelect.value;
      if (pid === 'custom') return;
      const def = PRESET_MAP[pid];
      if (def) {
        rowDomainSelect.value = def.row;
        colDomainSelect.value = def.col;
        vscode.postMessage({
          type: 'applyPreset',
          presetId: pid,
          rowDomain: def.row,
          colDomain: def.col,
        });
      }
    });

    // Domain selectors & Transpose
    rowDomainSelect.addEventListener('change', () => {
      presetSelect.value = 'custom';
      vscode.postMessage({
        type: 'changeDomains',
        rowDomain: rowDomainSelect.value,
        colDomain: colDomainSelect.value,
      });
    });

    colDomainSelect.addEventListener('change', () => {
      presetSelect.value = 'custom';
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
      presetSelect.value = 'custom';
      vscode.postMessage({ type: 'changeDomains', rowDomain: c, colDomain: r });
    });

    // Dense Mode Toggle
    denseToggleBtn.addEventListener('click', () => {
      isDenseMode = !isDenseMode;
      denseToggleBtn.classList.toggle('active', isDenseMode);
      denseToggleBtn.textContent = isDenseMode ? '⤢ Expanded View' : '🗜 Dense View';
      const tbl = document.getElementById('matrixTable');
      if (tbl) tbl.classList.toggle('dense', isDenseMode);
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

    // Copy TSV to Clipboard
    document.getElementById('copyTsvBtn').addEventListener('click', () => {
      if (!rtmMatrix || !rtmMatrix.rows || !rtmMatrix.cols) return;
      const { rows, cols, links } = rtmMatrix;
      let tsv = 'Row \\ Col\t' + cols.map(c => c.name).join('\t') + '\n';
      for (const r of rows) {
        tsv += r.name + '\t';
        tsv += cols.map(c => {
          const l = links[r.name + '|' + c.name];
          return l ? l.linkKind : '';
        }).join('\t') + '\n';
      }
      navigator.clipboard.writeText(tsv).then(() => {
        const orig = document.getElementById('copyTsvBtn').textContent;
        document.getElementById('copyTsvBtn').textContent = '✓ Copied!';
        setTimeout(() => { document.getElementById('copyTsvBtn').textContent = orig; }, 1500);
      });
    });

    document.getElementById('search').addEventListener('input', (e) => {
      activeFilter = e.target.value.toLowerCase();
      renderCurrentViews();
    });

    // Mouse tracking for drag-selection
    window.addEventListener('mousedown', () => { isMouseDown = true; });
    window.addEventListener('mouseup', () => { isMouseDown = false; });

    // Close popover on outside click
    window.addEventListener('click', (e) => {
      if (!actionPopover.contains(e.target) && !e.target.classList.contains('cell-btn')) {
        actionPopover.style.display = 'none';
      }
    });

    // Batch Bar Actions
    document.getElementById('batchCancelBtn').addEventListener('click', () => {
      clearSelection();
    });

    document.getElementById('batchAllocateBtn').addEventListener('click', () => {
      applyBatchKind('allocate');
    });

    document.getElementById('batchSatisfyBtn').addEventListener('click', () => {
      applyBatchKind('satisfy');
    });

    document.getElementById('batchVerifyBtn').addEventListener('click', () => {
      applyBatchKind('verify');
    });

    document.getElementById('batchConnectBtn').addEventListener('click', () => {
      applyBatchKind('connect');
    });

    document.getElementById('batchDeleteBtn').addEventListener('click', () => {
      const deletions = [];
      for (const item of selectedCells.values()) {
        if (item.link) {
          deletions.push({
            declarationUri: item.link.declarationUri || item.rowUri,
            sourceName: item.row,
            targetName: item.col,
            linkKind: item.link.linkKind,
            declarationRange: item.link.declarationStartByte !== undefined
              ? [item.link.declarationStartByte, item.link.declarationEndByte]
              : undefined,
          });
        }
      }
      if (deletions.length > 0) {
        vscode.postMessage({
          type: 'batchUpdateTraceLinks',
          deletions,
        });
      }
      clearSelection();
    });

    function applyBatchKind(kind) {
      const additions = [];
      for (const item of selectedCells.values()) {
        if (!item.link || item.link.linkKind !== kind) {
          additions.push({
            sourceUri: item.rowUri,
            sourceName: item.row,
            targetName: item.col,
            linkKind: kind,
          });
        }
      }
      if (additions.length > 0) {
        vscode.postMessage({
          type: 'batchUpdateTraceLinks',
          additions,
        });
      }
      clearSelection();
    }

    function clearSelection() {
      selectedCells.clear();
      document.querySelectorAll('.cell-selected').forEach(c => c.classList.remove('cell-selected'));
      batchBar.style.display = 'none';
    }

    function updateBatchBar() {
      if (selectedCells.size > 0) {
        batchCount.textContent = selectedCells.size + ' cell(s) selected';
        batchBar.style.display = 'flex';
      } else {
        batchBar.style.display = 'none';
      }
    }

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

      if (quickFilter === 'suspect') {
        const suspectKeys = new Set(Object.values(links).filter(l => l.isSuspect).map(l => l.sourceName));
        rows = rows.filter(r => suspectKeys.has(r.name));
      }

      if (rows.length === 0 || cols.length === 0) {
        matrixWrapper.innerHTML = '<div class="empty-state">No matching rows or columns found.</div>';
        return;
      }

      // Group rows by packagePath or parentName
      const rowGroups = new Map();
      for (const r of rows) {
        const group = r.packagePath || r.parentName || 'Global';
        if (!rowGroups.has(group)) rowGroups.set(group, []);
        rowGroups.get(group).push(r);
      }

      let html = '<table id="matrixTable" class="matrix-table' + (isDenseMode ? ' dense' : '') + '"><thead><tr>';
      html += '<th class="corner">' + esc(rowDomainSelect.options[rowDomainSelect.selectedIndex].text) + ' \\ ' +
              esc(colDomainSelect.options[colDomainSelect.selectedIndex].text) + '</th>';

      for (const col of cols) {
        html += '<th class="col-header" title="' + esc(col.name) + '">' + esc(col.name) + '</th>';
      }
      html += '</tr></thead><tbody>';

      for (const [groupName, groupRows] of rowGroups.entries()) {
        const isCollapsed = collapsedGroups.has(groupName);

        // Render hierarchical group row if multiple groups exist
        if (rowGroups.size > 1 || groupName !== 'Global') {
          html += '<tr class="group-header-row"><th colspan="' + (cols.length + 1) + '" class="group-header" data-group="' + esc(groupName) + '">';
          html += '<span class="chevron">' + (isCollapsed ? '►' : '▼') + '</span> 📦 ' + esc(groupName) + ' (' + groupRows.length + ')';
          html += '</th></tr>';
        }

        if (isCollapsed) continue;

        for (const row of groupRows) {
          html += '<tr>';
          html += '<th class="row-header" title="' + esc(row.name) + '"><span class="link-src" data-uri="' +
                  esc(row.uri) + '" data-start="' + row.startByte + '" data-end="' + row.endByte + '">' +
                  esc(row.name) + '</span></th>';

          for (const col of cols) {
            const key = row.name + '|' + col.name;
            const link = links[key];

            let cellClass = 'cell-empty';
            let label = '';
            let glyph = '';

            if (link) {
              if (link.isSuspect) {
                cellClass = 'cell-suspect';
                label = '⚠️ Suspect';
                glyph = '⚠️';
              } else if (link.status === 'failed') {
                cellClass = 'cell-failed';
                label = '❌ Failed';
                glyph = '❌';
              } else if (link.status === 'passed') {
                cellClass = 'cell-verify';
                label = '✓ Passed';
                glyph = '✓';
              } else if (link.linkKind === 'satisfy') {
                cellClass = 'cell-satisfy';
                label = '✓ Satisfy';
                glyph = '✓';
              } else if (link.linkKind === 'verify') {
                cellClass = 'cell-verify';
                label = '⚡ Verify';
                glyph = '⚡';
              } else if (link.linkKind === 'allocate') {
                cellClass = 'cell-allocate';
                label = '🔗 Allocate';
                glyph = '🔗';
              } else if (link.linkKind === 'connect') {
                cellClass = 'cell-connect';
                label = '⇄ Connect';
                glyph = '⇄';
              } else if (link.linkKind === 'derive') {
                cellClass = 'cell-derive';
                label = '↳ Derive';
                glyph = '↳';
              } else if (link.linkKind === 'mitigate') {
                cellClass = 'cell-mitigate';
                label = '🛡 Mitigate';
                glyph = '🛡';
              } else {
                cellClass = 'cell-allocate';
                label = '🔗 ' + link.linkKind;
                glyph = '🔗';
              }
            }

            const isSelected = selectedCells.has(key);
            if (isSelected) cellClass += ' cell-selected';

            html += '<td><button class="cell-btn ' + cellClass + '" data-row="' + esc(row.name) +
                    '" data-col="' + esc(col.name) + '" data-rowuri="' + esc(row.uri) +
                    '" data-coluri="' + esc(col.uri) + '" data-key="' + esc(key) + '">' +
                    '<span class="cell-label-full">' + esc(label) + '</span>' +
                    '<span class="cell-glyph">' + esc(glyph) + '</span>' +
                    '</button></td>';
          }
          html += '</tr>';
        }
      }

      html += '</tbody></table>';
      matrixWrapper.innerHTML = html;

      // Group Collapse / Expand Handlers
      matrixWrapper.querySelectorAll('.group-header').forEach(gh => {
        gh.addEventListener('click', () => {
          const grp = gh.dataset.group;
          if (collapsedGroups.has(grp)) collapsedGroups.delete(grp);
          else collapsedGroups.add(grp);
          renderMatrix();
        });
      });

      // Cell interaction: Click, Shift-Click & Drag Selection
      matrixWrapper.querySelectorAll('.cell-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const key = btn.dataset.key;
          const link = rtmMatrix?.links?.[key];

          if (e.shiftKey) {
            // Shift-Click: toggle selection
            toggleCellSelection(btn, key, link);
          } else if (selectedCells.size > 0) {
            // If already selecting, regular click continues selection toggle
            toggleCellSelection(btn, key, link);
          } else {
            // Single cell inspection / action popover
            showCellPopover(btn, e);
          }
        });

        // Drag-selection support
        btn.addEventListener('mouseenter', (e) => {
          if (isMouseDown && e.buttons === 1) {
            const key = btn.dataset.key;
            const link = rtmMatrix?.links?.[key];
            if (!selectedCells.has(key)) {
              toggleCellSelection(btn, key, link);
            }
          }
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

    function toggleCellSelection(btn, key, link) {
      if (selectedCells.has(key)) {
        selectedCells.delete(key);
        btn.classList.remove('cell-selected');
      } else {
        selectedCells.set(key, {
          row: btn.dataset.row,
          col: btn.dataset.col,
          rowUri: btn.dataset.rowuri,
          colUri: btn.dataset.coluri,
          key,
          link,
        });
        btn.classList.add('cell-selected');
      }
      updateBatchBar();
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
        html += '<div class="popover-item" id="actAllocate">🔗 Allocate to physical</div>';
        html += '<div class="popover-item" id="actSatisfy">✓ Satisfy requirement</div>';
        html += '<div class="popover-item" id="actVerify">⚡ Verify requirement</div>';
        html += '<div class="popover-item" id="actConnect">⇄ Connect interface</div>';
        html += '<div class="popover-item" id="actDerive">↳ Derive requirement</div>';
        html += '<div class="popover-item" id="actMitigate">🛡 Mitigate risk</div>';
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
      actionPopover.style.left = Math.min(event.clientX + 10, window.innerWidth - 240) + 'px';
      actionPopover.style.top = Math.min(event.clientY + 10, window.innerHeight - 250) + 'px';

      // Attach popover actions
      const wireAction = (id, kind) => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('click', () => {
            actionPopover.style.display = 'none';
            vscode.postMessage({
              type: 'createTraceLink',
              sourceUri: rowUri,
              sourceName: row,
              targetName: col,
              linkKind: kind,
            });
          });
        }
      };

      wireAction('actAllocate', 'allocate');
      wireAction('actSatisfy', 'satisfy');
      wireAction('actVerify', 'verify');
      wireAction('actConnect', 'connect');
      wireAction('actDerive', 'derive');
      wireAction('actMitigate', 'mitigate');

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
          if (msg.presets && Array.isArray(msg.presets) && msg.presets.length > 0) {
            availablePresets = msg.presets;
          }
          if (msg.presetId && presetSelect.querySelector('option[value="' + msg.presetId + '"]')) {
            presetSelect.value = msg.presetId;
          }
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
