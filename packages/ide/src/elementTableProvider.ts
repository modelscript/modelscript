// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Custom Editor Provider for General-Purpose SysML v2 Element Tables.
// Displays spreadsheet-style editable grids for Parts, Actions, Ports, States, and Attributes
// with in-cell autocompletion and bi-directional AST synchronization.

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";

export class ElementTableProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "modelscript.elementTable";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: LanguageClient,
  ) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = this.getHtmlForWebview();

    let currentMetaclass = "part";
    const uri = document.uri.toString();

    // Fetch and send table data
    const sendData = async () => {
      try {
        const table = await this.client.sendRequest<any>("modelscript/getElementsTable", {
          uri,
          metaclass: currentMetaclass,
        });

        webviewPanel.webview.postMessage({
          type: "setData",
          table,
          metaclass: currentMetaclass,
        });
      } catch (e) {
        webviewPanel.webview.postMessage({
          type: "setError",
          message: `Failed to load element table: ${e}`,
        });
      }
    };

    sendData();

    // Listen for text document edits
    const changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        sendData();
      }
    });

    // Listen for semantic project tree updates
    const projectTreeListener = this.client.onNotification("modelscript/projectTreeChanged", () => {
      sendData();
    });

    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "changeMetaclass":
          currentMetaclass = msg.metaclass ?? "part";
          sendData();
          break;

        case "refresh":
          sendData();
          break;

        case "goToSource": {
          const { startByte, endByte } = msg;
          try {
            const doc = await vscode.workspace.openTextDocument(document.uri);
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

        case "updateAttribute": {
          const { qualifiedName, attributeName, newValue } = msg;
          try {
            const res = await this.client.sendRequest<{ success: boolean; error?: string }>(
              "modelscript/updateElementAttribute",
              {
                uri,
                qualifiedName,
                attributeName,
                newValue,
              },
            );

            if (res.success) {
              sendData();
            } else {
              vscode.window.showErrorMessage(`Failed to update attribute: ${res.error}`);
            }
          } catch (e) {
            vscode.window.showErrorMessage(`Error updating attribute: ${e}`);
          }
          break;
        }

        case "getCompletions": {
          const { requestId, attributeName, prefix } = msg;
          try {
            const completions = await this.client.sendRequest<any[]>("modelscript/tableCellComplete", {
              uri,
              metaclass: currentMetaclass,
              attributeName,
              prefix,
            });
            webviewPanel.webview.postMessage({
              type: "completionResults",
              requestId,
              completions,
            });
          } catch {
            webviewPanel.webview.postMessage({
              type: "completionResults",
              requestId,
              completions: [],
            });
          }
          break;
        }

        case "validateCell": {
          const { requestId, attributeName, value } = msg;
          try {
            const res = await this.client.sendRequest<{ valid: boolean; error?: string }>(
              "modelscript/validateTableCell",
              {
                attributeName,
                value,
              },
            );
            webviewPanel.webview.postMessage({
              type: "validationResult",
              requestId,
              valid: res.valid,
              error: res.error,
            });
          } catch {
            webviewPanel.webview.postMessage({
              type: "validationResult",
              requestId,
              valid: true,
            });
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

  private getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SysML v2 Element Table</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #d4d4d4);
      --border: var(--vscode-widget-border, #3c3c3c);
      --hover-bg: var(--vscode-list-hoverBackground, #2a2d2e);
      --active-tab-bg: var(--vscode-button-background, #0e639c);
      --active-tab-fg: var(--vscode-button-foreground, #ffffff);
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --error-color: var(--vscode-errorForeground, #f48771);
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    /* Toolbar Ribbon */
    .ribbon {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
      background: rgba(0,0,0,0.15);
      gap: 12px;
    }
    .tabs {
      display: flex;
      gap: 6px;
    }
    .tab {
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--fg);
      transition: background 0.15s;
    }
    .tab:hover { background: var(--hover-bg); }
    .tab.active {
      background: var(--active-tab-bg);
      color: var(--active-tab-fg);
      border-color: var(--active-tab-bg);
    }
    .search-bar {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .search-input {
      padding: 5px 10px;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 12px;
      outline: none;
      width: 220px;
    }
    .search-input:focus { border-color: var(--active-tab-bg); }
    .btn-action {
      padding: 5px 10px;
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--fg);
      cursor: pointer;
      font-size: 11px;
    }
    .btn-action:hover { background: var(--hover-bg); }

    /* Grid Container */
    .grid-container {
      flex: 1;
      overflow: auto;
      position: relative;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    thead {
      position: sticky;
      top: 0;
      background: var(--bg);
      z-index: 10;
    }
    th {
      padding: 8px 12px;
      text-align: left;
      font-weight: 600;
      border-bottom: 2px solid var(--border);
      border-right: 1px solid var(--border);
      background: rgba(255,255,255,0.03);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    th:hover { background: var(--hover-bg); }
    td {
      padding: 6px 12px;
      border-bottom: 1px solid var(--border);
      border-right: 1px solid var(--border);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      position: relative;
    }
    tr:hover td { background: var(--hover-bg); }
    td.editable { cursor: cell; }
    td.editable:hover::after {
      content: "✎";
      position: absolute;
      right: 6px;
      top: 6px;
      font-size: 10px;
      opacity: 0.4;
    }

    /* In-Cell Editor */
    .cell-input {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1.5px solid var(--active-tab-bg);
      padding: 4px 10px;
      font-size: 12px;
      outline: none;
      z-index: 20;
    }
    .cell-input.invalid {
      border-color: var(--error-color);
      box-shadow: 0 0 4px var(--error-color);
    }
    .completion-dropdown {
      position: absolute;
      top: 100%; left: 0; width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      max-height: 180px;
      overflow-y: auto;
      z-index: 30;
    }
    .completion-item {
      padding: 6px 10px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      font-size: 11px;
    }
    .completion-item:hover, .completion-item.selected {
      background: var(--active-tab-bg);
      color: var(--active-tab-fg);
    }
    .badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--badge-bg);
      color: var(--badge-fg);
    }
  </style>
</head>
<body>
  <div class="ribbon">
    <div class="tabs">
      <button class="tab active" data-meta="part">Parts</button>
      <button class="tab" data-meta="action">Actions</button>
      <button class="tab" data-meta="port">Ports</button>
      <button class="tab" data-meta="state">States</button>
      <button class="tab" data-meta="attribute">Attributes</button>
    </div>
    <div class="search-bar">
      <input type="text" class="search-input" id="filterInput" placeholder="Filter rows (text or regex)..." />
      <button class="btn-action" id="btnExportCsv">Export CSV</button>
      <button class="btn-action" id="btnExportTsv">Export TSV</button>
    </div>
  </div>

  <div class="grid-container">
    <table id="elementsTable">
      <thead><tr id="tableHead"></tr></thead>
      <tbody id="tableBody"></tbody>
    </table>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentTable = null;
    let sortColumn = "name";
    let sortAsc = true;
    let activeEditor = null;
    let completionRequestId = 0;

    // Tab switcher
    document.querySelectorAll(".tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        vscode.postMessage({ type: "changeMetaclass", metaclass: tab.getAttribute("data-meta") });
      });
    });

    // Filter input
    document.getElementById("filterInput").addEventListener("input", (e) => {
      renderTable();
    });

    // CSV/TSV Export
    document.getElementById("btnExportCsv").addEventListener("click", () => exportTable(","));
    document.getElementById("btnExportTsv").addEventListener("click", () => exportTable("\\t"));

    function exportTable(delim) {
      if (!currentTable || !currentTable.rows) return;
      const cols = currentTable.columns;
      const lines = [cols.map(c => '"' + c.title + '"').join(delim)];
      for (const row of currentTable.rows) {
        lines.push(cols.map(c => '"' + (row[c.id] ?? "") + '"').join(delim));
      }
      const blob = new Blob([lines.join("\\n")], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = currentTable.metaclass + "_elements.csv";
      a.click();
    }

    // Message handler
    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "setData") {
        currentTable = msg.table;
        renderTable();
      } else if (msg.type === "completionResults" && activeEditor) {
        activeEditor.handleCompletions(msg.completions);
      } else if (msg.type === "validationResult" && activeEditor) {
        activeEditor.handleValidation(msg.valid, msg.error);
      }
    });

    function renderTable() {
      if (!currentTable) return;

      const head = document.getElementById("tableHead");
      const body = document.getElementById("tableBody");
      head.innerHTML = "";
      body.innerHTML = "";

      const cols = currentTable.columns;
      const filter = document.getElementById("filterInput").value.trim().toLowerCase();

      // Render Headers
      cols.forEach(col => {
        const th = document.createElement("th");
        th.textContent = col.title + (sortColumn === col.id ? (sortAsc ? " ▲" : " ▼") : "");
        th.addEventListener("click", () => {
          if (sortColumn === col.id) {
            sortAsc = !sortAsc;
          } else {
            sortColumn = col.id;
            sortAsc = true;
          }
          renderTable();
        });
        head.appendChild(th);
      });

      // Filter and sort rows
      let rows = [...currentTable.rows];
      if (filter) {
        rows = rows.filter(r => {
          return Object.values(r).some(val => String(val).toLowerCase().includes(filter));
        });
      }

      rows.sort((a, b) => {
        const valA = a[sortColumn] ?? "";
        const valB = b[sortColumn] ?? "";
        return sortAsc ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
      });

      // Render Rows
      rows.forEach(row => {
        const tr = document.createElement("tr");
        cols.forEach(col => {
          const td = document.createElement("td");
          const val = row[col.id] ?? "";
          td.textContent = val;
          if (col.editable) {
            td.classList.add("editable");
            td.addEventListener("dblclick", () => activateCellEditor(td, row, col));
          } else if (col.id === "name") {
            td.style.fontWeight = "500";
            td.title = "Click to jump to definition in source";
            td.style.cursor = "pointer";
            td.addEventListener("click", () => {
              vscode.postMessage({ type: "goToSource", startByte: row.startByte, endByte: row.endByte });
            });
          }
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
    }

    function activateCellEditor(td, row, col) {
      if (activeEditor) activeEditor.cancel();

      const origVal = td.textContent;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "cell-input";
      input.value = origVal;

      const dropdown = document.createElement("div");
      dropdown.className = "completion-dropdown";
      dropdown.style.display = "none";

      td.style.position = "relative";
      td.appendChild(input);
      td.appendChild(dropdown);
      input.focus();
      input.select();

      let currentCompletions = [];

      const queryCompletions = (prefix) => {
        completionRequestId++;
        vscode.postMessage({
          type: "getCompletions",
          requestId: completionRequestId,
          attributeName: col.id,
          prefix,
        });
      };

      const queryValidation = (val) => {
        vscode.postMessage({
          type: "validateCell",
          attributeName: col.id,
          value: val,
        });
      };

      input.addEventListener("input", (e) => {
        queryCompletions(input.value);
        queryValidation(input.value);
      });

      queryCompletions(input.value);

      const commit = () => {
        const newVal = input.value.trim();
        if (newVal !== origVal) {
          vscode.postMessage({
            type: "updateAttribute",
            qualifiedName: row.qualifiedName,
            attributeName: col.id,
            newValue: newVal,
          });
        }
        cleanup();
      };

      const cancel = () => {
        td.textContent = origVal;
        cleanup();
      };

      const cleanup = () => {
        input.remove();
        dropdown.remove();
        activeEditor = null;
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          cancel();
        }
      });

      input.addEventListener("blur", (e) => {
        // Debounce blur to permit dropdown click
        setTimeout(() => {
          if (activeEditor) commit();
        }, 200);
      });

      activeEditor = {
        cancel,
        handleCompletions: (comps) => {
          currentCompletions = comps;
          if (comps.length > 0) {
            dropdown.innerHTML = "";
            comps.forEach(c => {
              const item = document.createElement("div");
              item.className = "completion-item";
              item.innerHTML = "<span>" + c.label + "</span><span class='badge'>" + (c.kind || "") + "</span>";
              item.addEventListener("mousedown", (ev) => {
                ev.preventDefault();
                input.value = c.label;
                commit();
              });
              dropdown.appendChild(item);
            });
            dropdown.style.display = "block";
          } else {
            dropdown.style.display = "none";
          }
        },
        handleValidation: (valid, error) => {
          if (!valid) {
            input.classList.add("invalid");
            input.title = error || "Invalid input";
          } else {
            input.classList.remove("invalid");
            input.title = "";
          }
        }
      };
    }
  </script>
</body>
</html>`;
  }
}
