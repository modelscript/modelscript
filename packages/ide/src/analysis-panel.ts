// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages analysis webview panels for BLT matrix and class hierarchy visualizations.
// Sends analytical RPC requests to the LSP server and displays results as interactive views.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { getNonce } from "./utils/nonce.js";
import { attachExtensionWebviewBridge } from "./webview/shared/extension-lsp-bridge.js";

interface BltAnalysisResult {
  className: string;
  variables: string[];
  equations: string[];
  algebraicLoops: { variables: string[]; equations: string[] }[];
  equationCount: number;
  unknownCount: number;
}

interface BltWebviewPayload {
  sourceCode: string;
  flattenedCode?: string | undefined;
  className?: string | undefined;
  documentUri: string;
}

interface ClassHierarchyNode {
  name: string;
  kind: string;
  description: string | null;
  children: ClassHierarchyNode[];
}

interface ComponentTreeNode {
  name: string;
  typeName: string;
  kind: string;
  variability: string | null;
  causality: string | null;
  description: string | null;
  children: ComponentTreeNode[];
}

export class AnalysisPanel {
  static bltPanel: AnalysisPanel | undefined;
  static hierarchyPanel: AnalysisPanel | undefined;
  static componentTreePanel: AnalysisPanel | undefined;
  static readonly viewType = "modelscript.analysis";

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private latestBltPayload: BltWebviewPayload | undefined;

  static async createOrShowBlt(extensionUri: vscode.Uri, client: LanguageClient) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Open a model file to analyze the equation system.");
      return;
    }

    const document = editor.document;
    const uri = document.uri.toString();
    const sourceCode = document.getText();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Analyzing equation system…",
        cancellable: false,
      },
      async () => {
        let className: string | undefined;
        let flattenedCode: string | undefined;

        try {
          const result: BltAnalysisResult | null = await client.sendRequest("modelscript/analyzeBlt", { uri });
          if (result?.className) className = result.className;
        } catch {
          // Fall back to direct source BLT analysis in BltVisualizer
        }

        try {
          const flatRes = await client.sendRequest<{ flattened?: string; code?: string } | string>(
            "modelscript/flatten",
            { uri },
          );
          const text =
            typeof flatRes === "string"
              ? flatRes
              : typeof flatRes?.flattened === "string"
                ? flatRes.flattened
                : typeof flatRes?.code === "string"
                  ? flatRes.code
                  : undefined;
          if (text && text.trim().length > 0) {
            flattenedCode = text;
          }
        } catch {
          // Flattening is optional; BltVisualizer handles source equations directly
        }

        const payload: BltWebviewPayload = {
          sourceCode,
          ...(flattenedCode ? { flattenedCode } : {}),
          ...(className ? { className } : {}),
          documentUri: uri,
        };

        if (AnalysisPanel.bltPanel) {
          AnalysisPanel.bltPanel.panel.title = `BLT: ${className ?? document.uri.path.split("/").pop() ?? "Model"}`;
          AnalysisPanel.bltPanel.panel.reveal(vscode.ViewColumn.Beside);
          AnalysisPanel.bltPanel.postBltModelData(payload);
          return;
        }

        const panel = vscode.window.createWebviewPanel(
          AnalysisPanel.viewType,
          `BLT: ${className ?? document.uri.path.split("/").pop() ?? "Model"}`,
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
          },
        );

        AnalysisPanel.bltPanel = new AnalysisPanel(panel, extensionUri, "blt", client, document);
        AnalysisPanel.bltPanel.postBltModelData(payload);
      },
    );
  }

  static async createOrShowHierarchy(extensionUri: vscode.Uri, client: LanguageClient) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Open a model file to view class hierarchy.");
      return;
    }

    const uri = editor.document.uri.toString();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Loading class hierarchy…",
        cancellable: false,
      },
      async () => {
        const result: ClassHierarchyNode | null = await client.sendRequest("modelscript/getClassHierarchy", { uri });

        if (!result) {
          vscode.window.showInformationMessage("No class hierarchy available for this file.");
          return;
        }

        if (AnalysisPanel.hierarchyPanel) {
          AnalysisPanel.hierarchyPanel.panel.reveal(vscode.ViewColumn.Beside);
          AnalysisPanel.hierarchyPanel.postHierarchyData(result);
          return;
        }

        const panel = vscode.window.createWebviewPanel(
          AnalysisPanel.viewType,
          `Hierarchy: ${result.name}`,
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
          },
        );

        AnalysisPanel.hierarchyPanel = new AnalysisPanel(panel, extensionUri, "hierarchy");
        AnalysisPanel.hierarchyPanel.postHierarchyData(result);
      },
    );
  }

  static async createOrShowComponentTree(extensionUri: vscode.Uri, client: LanguageClient) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Open a model file to view component tree.");
      return;
    }

    const uri = editor.document.uri.toString();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Loading component tree…",
        cancellable: false,
      },
      async () => {
        const result: ComponentTreeNode | null = await client.sendRequest("modelscript/getComponentTree", { uri });

        if (!result) {
          vscode.window.showInformationMessage("No component tree available for this file.");
          return;
        }

        if (AnalysisPanel.componentTreePanel) {
          AnalysisPanel.componentTreePanel.panel.reveal(vscode.ViewColumn.Beside);
          AnalysisPanel.componentTreePanel.postComponentTreeData(result);
          return;
        }

        const panel = vscode.window.createWebviewPanel(
          AnalysisPanel.viewType,
          `Components: ${result.name}`,
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
          },
        );

        AnalysisPanel.componentTreePanel = new AnalysisPanel(panel, extensionUri, "componentTree");
        AnalysisPanel.componentTreePanel.postComponentTreeData(result);
      },
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly mode: "blt" | "hierarchy" | "componentTree",
    client?: LanguageClient,
    document?: vscode.TextDocument,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.panel.webview.html = this.mode === "blt" ? this.getBltWebviewHtml() : this.getHtmlForWebview();
    if (this.mode === "blt") {
      const bridgeSub = attachExtensionWebviewBridge(this.panel.webview, {
        client,
        getDocument: () => document,
        title: this.panel.title,
        languageId: document?.languageId ?? "modelica",
        onUnhandledMessage: (msg) => {
          if (msg.type === "ready" && this.latestBltPayload) {
            void this.panel.webview.postMessage({ type: "bltModelData", data: this.latestBltPayload });
          }
        },
      });
      this.disposables.push(bridgeSub);
    }
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private postBltModelData(data: BltWebviewPayload) {
    this.latestBltPayload = data;
    void this.panel.webview.postMessage({ type: "bltModelData", data });
  }

  private getBltWebviewHtml(): string {
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "blt-webview.js"));
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.panel.webview.cspSource} data: blob:; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${this.panel.webview.cspSource} https: http: data: blob:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BLT Structural Analysis</title>
  <style>
    html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--vscode-editor-background, #0d1117); color: var(--vscode-editor-foreground, #c9d1d9); }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private postHierarchyData(data: ClassHierarchyNode) {
    const isDark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    this.panel.webview.postMessage({ type: "hierarchyData", data, isDark });
  }

  private postComponentTreeData(data: ComponentTreeNode) {
    const isDark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    this.panel.webview.postMessage({ type: "componentTreeData", data, isDark });
  }

  private getHtmlForWebview(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "analysis-webview.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self' ${webview.cspSource} http: https: ws: wss: data: blob:;">
  <title>Analysis</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: 13px;
      color: var(--vscode-foreground, #ccc);
      background: var(--vscode-editor-background, #1e1e1e);
      overflow: auto;
      padding: 16px;
    }
    h2 {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--vscode-foreground);
    }
    .stats {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .stat-card {
      padding: 10px 16px;
      border-radius: 6px;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      min-width: 100px;
    }
    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 2px;
    }
    .stat-value {
      font-size: 20px;
      font-weight: 700;
    }
    .stat-value.warning { color: #e2b340; }
    .stat-value.success { color: #2da44e; }

    /* BLT Matrix */
    #blt-container { overflow: auto; }
    .matrix-wrapper {
      display: inline-block;
      position: relative;
    }
    table.matrix {
      border-collapse: collapse;
      font-size: 11px;
    }
    table.matrix th {
      padding: 2px 6px;
      font-weight: 500;
      color: var(--vscode-descriptionForeground, #888);
      white-space: nowrap;
      max-width: 80px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    table.matrix th.col-header {
      writing-mode: vertical-rl;
      text-orientation: mixed;
      transform: rotate(180deg);
      height: 80px;
      vertical-align: bottom;
      padding: 4px 2px;
    }
    table.matrix td {
      width: 18px;
      height: 18px;
      border: 1px solid var(--vscode-editorWidget-border, #333);
      text-align: center;
      cursor: default;
    }
    table.matrix td.filled {
      background: var(--vscode-button-background, #0e639c);
    }
    table.matrix td.loop {
      background: #e2b340;
    }
    table.matrix td:hover {
      outline: 2px solid var(--vscode-focusBorder, #007acc);
      outline-offset: -2px;
    }
    #tooltip {
      position: fixed;
      display: none;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 12px;
      pointer-events: none;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      max-width: 300px;
    }

    /* Hierarchy Tree */
    .tree-node {
      padding: 3px 0;
    }
    .tree-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .tree-row:hover {
      background: var(--vscode-list-hoverBackground, #2a2d2e);
    }
    .tree-icon {
      font-size: 14px;
      flex-shrink: 0;
      width: 18px;
      text-align: center;
    }
    .tree-name {
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .tree-kind {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background, #333);
    }
    .tree-desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tree-children {
      margin-left: 20px;
      border-left: 1px solid var(--vscode-editorWidget-border, #333);
      padding-left: 8px;
    }
    .tree-toggle {
      cursor: pointer;
      user-select: none;
      width: 16px;
      text-align: center;
      flex-shrink: 0;
    }
    .tree-extends-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground, #666);
      margin: 4px 0 2px 0;
    }

    #placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      opacity: 0.6;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div id="content"></div>
  <div id="tooltip"></div>
  <div id="placeholder">Waiting for analysis data…</div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose() {
    if (this.mode === "blt") {
      AnalysisPanel.bltPanel = undefined;
    } else if (this.mode === "hierarchy") {
      AnalysisPanel.hierarchyPanel = undefined;
    } else {
      AnalysisPanel.componentTreePanel = undefined;
    }
    this.panel.dispose();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) x.dispose();
    }
  }
}
