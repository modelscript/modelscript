// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseCsvHeaderAnnotation, parseCsvRecords } from "@modelscript/csv/csv-parser";
import { datasetToLas, type LasDocument, lasToDataset, parseLas } from "@modelscript/las/las-parser";
import { datasetToCsv, type IndexedDataset, rowsToDataset } from "@modelscript/simulate/charts";
import * as vscode from "vscode";
import { getNonce } from "./utils/nonce.js";

function parseCsvToIndexedDataset(csvText: string, fileName: string): IndexedDataset {
  const records = parseCsvRecords(csvText, { trim: true });
  if (records.length === 0) {
    return {
      title: fileName,
      sourceFormat: "csv",
      indexAxis: { key: "index", label: "Index" },
      indexValues: [],
      series: [],
    };
  }

  const rawKeys = Object.keys(records[0] ?? {});
  const cleanedNames = new Map<string, string>();
  const units = new Map<string, string>();
  for (const rawKey of rawKeys) {
    const parsedHeader = parseCsvHeaderAnnotation(rawKey);
    const cleanName = parsedHeader.name || rawKey;
    cleanedNames.set(rawKey, cleanName);
    if (parsedHeader.unit) {
      units.set(cleanName, parsedHeader.unit);
    }
  }

  const numericRows: Record<string, unknown>[] = records.map((rec) => {
    const out: Record<string, unknown> = {};
    for (const rawKey of rawKeys) {
      const cleanName = cleanedNames.get(rawKey) ?? rawKey;
      const rawVal = (rec[rawKey] ?? "").trim();
      if (rawVal === "") continue;
      const num = Number(rawVal);
      if (Number.isFinite(num)) {
        out[cleanName] = num;
      }
    }
    return out;
  });

  const ds = rowsToDataset(numericRows, {
    title: fileName,
    sourceFormat: "csv",
  });

  const axisUnit = units.get(ds.indexAxis.key);
  if (axisUnit && !ds.indexAxis.unit) {
    ds.indexAxis.unit = axisUnit;
  }
  for (const series of ds.series) {
    const unit = units.get(series.name);
    if (unit && !series.unit) {
      series.unit = unit;
    }
  }
  return ds;
}

export class TabularCustomDocument implements vscode.CustomDocument {
  public readonly uri: vscode.Uri;
  public readonly format: "las" | "csv";
  public readonly dataset: IndexedDataset;
  public readonly lasDoc?: LasDocument | undefined;
  public readonly parseError?: string | undefined;

  constructor(
    uri: vscode.Uri,
    format: "las" | "csv",
    dataset: IndexedDataset,
    lasDoc?: LasDocument,
    parseError?: string,
  ) {
    this.uri = uri;
    this.format = format;
    this.dataset = dataset;
    this.lasDoc = lasDoc;
    this.parseError = parseError;
  }

  dispose(): void {
    // No external resources to dispose
  }
}

/**
 * Custom readonly visual plot studio editor for `.las` (Log ASCII Standard) and `.csv`
 * indexed tabular datasets, rendering Overlay, Multi-Track, Crossplot, and Histogram views.
 */
export class TabularPlotEditorProvider implements vscode.CustomReadonlyEditorProvider<TabularCustomDocument> {
  public static readonly viewType = "modelscript.tabularPlotViewer";

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async openCustomDocument(uri: vscode.Uri): Promise<TabularCustomDocument> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder("utf-8").decode(bytes);
    const fileName = uri.path.split("/").pop() || "dataset";
    const format: "las" | "csv" = uri.path.toLowerCase().endsWith(".las") ? "las" : "csv";

    try {
      if (format === "las") {
        const lasDoc = parseLas(text);
        const dataset = lasToDataset(lasDoc, { title: fileName });
        return new TabularCustomDocument(uri, "las", dataset, lasDoc);
      }
      const dataset = parseCsvToIndexedDataset(text, fileName);
      return new TabularCustomDocument(uri, "csv", dataset);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const emptyDataset: IndexedDataset = {
        title: fileName,
        sourceFormat: format,
        indexAxis: { key: format === "las" ? "DEPTH" : "time", label: format === "las" ? "Depth" : "Time" },
        indexValues: [],
        series: [],
      };
      return new TabularCustomDocument(uri, format, emptyDataset, undefined, msg);
    }
  }

  public static createOrShowDataset(
    extensionUri: vscode.Uri,
    dataset: IndexedDataset,
    sourceUri?: string,
    title?: string,
    lasDoc?: LasDocument,
    parseError?: string,
  ): vscode.WebviewPanel {
    const panelTitle = title || dataset.title || "Log & Tabular Plot";
    const panel = vscode.window.createWebviewPanel(
      "modelscript.tabularPlotPreview",
      panelTitle,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: extensionUri ? [vscode.Uri.joinPath(extensionUri, "dist")] : [],
      },
    );
    const parsedUri = sourceUri ? vscode.Uri.parse(sourceUri) : undefined;
    const format: "las" | "csv" =
      dataset.sourceFormat === "las" || parsedUri?.path.toLowerCase().endsWith(".las") ? "las" : "csv";
    const fileName = parsedUri?.path.split("/").pop() || dataset.title || "dataset";
    TabularPlotEditorProvider.attachDatasetWebview(extensionUri, panel, {
      dataset,
      format,
      fileName,
      uri: parsedUri,
      lasDoc,
      parseError,
    });
    return panel;
  }

  public async resolveCustomEditor(
    document: TabularCustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      ...(this.context.extensionUri
        ? { localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")] }
        : {}),
    };

    TabularPlotEditorProvider.attachDatasetWebview(this.context.extensionUri, webviewPanel, {
      dataset: document.dataset,
      format: document.format,
      fileName: document.uri.path.split("/").pop() || "dataset",
      uri: document.uri,
      lasDoc: document.lasDoc,
      parseError: document.parseError,
    });
  }

  private static attachDatasetWebview(
    extensionUri: vscode.Uri,
    webviewPanel: vscode.WebviewPanel,
    payload: {
      dataset: IndexedDataset;
      format: "las" | "csv";
      fileName: string;
      uri?: vscode.Uri | undefined;
      lasDoc?: LasDocument | undefined;
      parseError?: string | undefined;
    },
  ): void {
    webviewPanel.webview.html = TabularPlotEditorProvider.buildHtmlForWebview(extensionUri, webviewPanel.webview);

    let disposed = false;
    const isDarkTheme = (): boolean =>
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

    const postData = () => {
      if (disposed) return;
      webviewPanel.webview.postMessage({
        type: "datasetData",
        dataset: payload.dataset,
        format: payload.format,
        fileName: payload.fileName,
        parseError: payload.parseError,
        lasMeta: payload.lasDoc
          ? {
              version: payload.lasDoc.version,
              wrap: payload.lasDoc.wrap,
              well: Object.values(payload.lasDoc.well),
              parameters: Object.values(payload.lasDoc.params),
            }
          : undefined,
        isDark: isDarkTheme(),
      });
    };

    const exportTabularFile = async (ext: "csv" | "las", content: string) => {
      try {
        let targetUri: vscode.Uri | undefined;
        if (payload.uri && payload.uri.scheme === "file") {
          const fsPath = payload.uri.fsPath || payload.uri.path;
          const slashIdx = fsPath.lastIndexOf("/");
          const dirPath = slashIdx >= 0 ? fsPath.slice(0, slashIdx) : "";
          const baseName = (fsPath.slice(slashIdx + 1) || "dataset").replace(/\.[^.]+$/, "");
          targetUri = vscode.Uri.joinPath(vscode.Uri.file(dirPath || "/"), `${baseName}.${ext}`);
        } else {
          const baseName = payload.fileName.replace(/\.[^.]+$/, "") || "dataset";
          targetUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`${baseName}.${ext}`),
            filters: { [ext.toUpperCase()]: [ext] },
          });
        }
        if (!targetUri) return;
        await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(content));
        const savedName = targetUri.path.split("/").pop() || `${payload.fileName}.${ext}`;
        vscode.window.showInformationMessage(`Exported ${ext.toUpperCase()}: ${savedName}`);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Failed to export ${ext.toUpperCase()}: ${message}`);
      }
    };

    const msgSubscription = webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg.type !== "string") return;
      switch (msg.type) {
        case "ready":
          postData();
          break;
        case "exportCsv":
          await exportTabularFile("csv", datasetToCsv(payload.dataset));
          break;
        case "exportLas":
          await exportTabularFile("las", datasetToLas(payload.dataset, { version: "2.0" }));
          break;
      }
    });

    const themeSubscription = vscode.window.onDidChangeActiveColorTheme?.(() => {
      if (!disposed) {
        webviewPanel.webview.postMessage({ type: "themeChange", isDark: isDarkTheme() });
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      msgSubscription.dispose();
      themeSubscription?.dispose();
    });

    postData();
  }

  private static buildHtmlForWebview(extensionUri: vscode.Uri, webview: vscode.Webview): string {
    const nonce = getNonce();
    const rawScriptUri = vscode.Uri.joinPath(extensionUri, "dist", "tabular-plot-webview.js");
    const scriptUri =
      typeof webview.asWebviewUri === "function"
        ? webview.asWebviewUri(rawScriptUri).toString()
        : rawScriptUri.toString();
    const cspSource = webview.cspSource ?? "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob: ${cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Log & Tabular Plot Studio</title>
  <style>
    :root {
      --bg-primary: var(--vscode-editor-background, #111622);
      --bg-secondary: var(--vscode-sideBar-background, #171c2b);
      --bg-tertiary: var(--vscode-editorWidget-background, #1f2637);
      --border: var(--vscode-panel-border, rgba(255, 255, 255, 0.12));
      --text-main: var(--vscode-foreground, #e5e7eb);
      --text-dim: var(--vscode-descriptionForeground, #9ca3af);
      --accent: var(--vscode-button-background, #0e639c);
      --accent-fg: var(--vscode-button-foreground, #ffffff);
      --font-sans: var(--vscode-font-family, system-ui, sans-serif);
      --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg-primary);
      color: var(--text-main);
      font-family: var(--font-sans);
      font-size: 12px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      padding: 6px 12px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .header-info, .header-actions, .toolbar-group {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .header-title { font-size: 13px; font-weight: 600; }
    .badge {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 10.5px;
      font-family: var(--font-mono);
      color: var(--text-dim);
    }
    .mode-group {
      display: inline-flex;
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 2px;
      gap: 2px;
    }
    button {
      background: transparent;
      color: var(--text-main);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 3px 8px;
      font-size: 11px;
      cursor: pointer;
    }
    button.mode-btn { border-color: transparent; }
    button:hover { background: rgba(128, 128, 128, 0.18); }
    button.active, button.mode-btn.active {
      background: var(--accent);
      color: var(--accent-fg);
      border-color: var(--accent);
      font-weight: 600;
    }
    select {
      background: var(--vscode-dropdown-background, var(--bg-tertiary));
      color: var(--vscode-dropdown-foreground, var(--text-main));
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 11px;
    }
    label.pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      padding: 2px 7px;
      border: 1px solid var(--border);
      border-radius: 999px;
      cursor: pointer;
    }
    #error-banner {
      display: none;
      padding: 6px 12px;
      background: rgba(239, 68, 68, 0.14);
      color: #fca5a5;
      border-bottom: 1px solid rgba(239, 68, 68, 0.35);
      font-size: 11px;
    }
    .main-layout {
      display: flex;
      flex: 1;
      min-height: 0;
    }
    .sidebar {
      width: 245px;
      flex-shrink: 0;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .section-title {
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
      font-weight: 600;
      margin-bottom: 4px;
    }
    .curve-item {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 4px;
      border-radius: 4px;
      cursor: pointer;
    }
    .curve-item:hover { background: rgba(128, 128, 128, 0.12); }
    .curve-swatch {
      width: 9px;
      height: 9px;
      border-radius: 2px;
      margin-top: 3px;
      flex-shrink: 0;
    }
    .curve-info { min-width: 0; }
    .curve-name { font-weight: 600; font-size: 11px; word-break: break-word; }
    .curve-stats { font-size: 10px; color: var(--text-dim); font-family: var(--font-mono); }
    table.meta-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
      font-family: var(--font-mono);
    }
    table.meta-table td {
      padding: 2px 4px;
      border-bottom: 1px solid var(--border);
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .canvas-column {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    #cursor-hud {
      display: none;
      padding: 4px 10px;
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border);
      font-family: var(--font-mono);
      font-size: 11px;
    }
    #canvas-wrap {
      flex: 1;
      min-height: 0;
      position: relative;
    }
    canvas { display: block; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <header class="header-bar">
    <div class="header-info">
      <span class="badge" id="badge-format">DATA</span>
      <span class="header-title" id="header-filename">Tabular Plot Studio</span>
      <span class="badge" id="badge-meta">Loading...</span>
    </div>
    <div class="header-actions">
      <div class="mode-group" id="mode-group" role="tablist">
        <button class="mode-btn active" data-mode="overlay" role="tab" aria-selected="true">Overlay</button>
        <button class="mode-btn" data-mode="multitrack" role="tab" aria-selected="false">Multi-Track</button>
        <button class="mode-btn" data-mode="crossplot" role="tab" aria-selected="false">Crossplot</button>
        <button class="mode-btn" data-mode="histogram" role="tab" aria-selected="false">Histogram</button>
      </div>
      <div class="toolbar-group" id="overlay-controls">
        <label class="pill"><input type="checkbox" id="check-normalize"> Norm [0,1]</label>
        <label class="pill"><input type="checkbox" id="check-log"> Log</label>
      </div>
      <div class="toolbar-group" id="crossplot-controls" style="display:none;">
        <span>X</span><select id="select-cp-x"></select>
        <span>Y</span><select id="select-cp-y"></select>
        <span>Color</span><select id="select-cp-color"></select>
        <label class="pill"><input type="checkbox" id="check-cp-regression" checked> Fit</label>
      </div>
      <div class="toolbar-group" id="histogram-controls" style="display:none;">
        <span>Var</span><select id="select-hist-var"></select>
        <select id="select-hist-bins">
          <option value="20">20 bins</option>
          <option value="30" selected>30 bins</option>
          <option value="50">50 bins</option>
          <option value="80">80 bins</option>
        </select>
      </div>
      <button id="btn-cursors">Cursors</button>
      <button id="btn-reset">Reset</button>
      <button id="btn-export-csv">CSV</button>
      <button id="btn-export-las">LAS</button>
      <button id="btn-export-png">PNG</button>
    </div>
  </header>
  <div id="error-banner"></div>
  <div class="main-layout">
    <aside class="sidebar">
      <div>
        <div class="section-title">Curves & Statistics</div>
        <div id="curve-list"></div>
      </div>
      <div id="well-meta-wrap" style="display:none;">
        <div class="section-title">Well & Parameters</div>
        <table class="meta-table"><tbody id="well-meta-list"></tbody></table>
      </div>
    </aside>
    <main class="canvas-column">
      <div id="cursor-hud"></div>
      <div id="canvas-wrap">
        <canvas id="plot-canvas"></canvas>
      </div>
    </main>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
