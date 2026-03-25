// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the diagram webview panel lifecycle.
// Communicates with the LSP server via the LanguageClient to get diagram data,
// and posts it to the webview for X6 rendering.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export class DiagramPanel {
  static currentPanel: DiagramPanel | undefined;
  static readonly viewType = "modelscript.diagram";

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly client: LanguageClient;
  private disposables: vscode.Disposable[] = [];
  private currentDocUri: string | undefined;
  private updateTimeout: ReturnType<typeof setTimeout> | null = null;

  get sourceUri(): string | undefined {
    return this.currentDocUri;
  }

  static createOrShow(extensionUri: vscode.Uri, client: LanguageClient) {
    // If we already have a panel, reveal it
    if (DiagramPanel.currentPanel) {
      DiagramPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      DiagramPanel.currentPanel.update();
      return;
    }

    // Create a new panel
    const panel = vscode.window.createWebviewPanel(
      DiagramPanel.viewType,
      "Modelica Diagram",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    DiagramPanel.currentPanel = new DiagramPanel(panel, extensionUri, client);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: LanguageClient) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.client = client;

    // Set the webview's HTML content
    this.panel.webview.html = this.getHtmlForWebview();

    // Listen for when the panel is disposed
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Flag to suppress diagram re-render when the edit originated from the diagram
    let isDiagramUpdate = false;

    // Listen for messages from the webview (diagram mutations)
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        if (!this.currentDocUri) return;
        const uri = this.currentDocUri;

        try {
          let lspMethod: string | undefined;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let lspParams: any;

          switch (message.type) {
            case "move":
              lspMethod = "modelscript/updatePlacement";
              lspParams = { uri, items: message.items };
              break;
            case "resize":
              lspMethod = "modelscript/updatePlacement";
              lspParams = {
                uri,
                items: [
                  {
                    name: message.name,
                    x: message.x,
                    y: message.y,
                    width: message.width,
                    height: message.height,
                    rotation: message.rotation,
                    edges: message.edges,
                  },
                ],
              };
              break;
            case "connect":
              lspMethod = "modelscript/addConnect";
              lspParams = { uri, source: message.source, target: message.target, points: message.points };
              break;
            case "edgeMove":
              lspMethod = "modelscript/updateEdgePoints";
              lspParams = { uri, edges: message.edges };
              break;
            case "deleteEdge":
              lspMethod = "modelscript/removeConnect";
              lspParams = { uri, source: message.source, target: message.target };
              break;
            case "deleteComponents":
              lspMethod = "modelscript/deleteComponents";
              lspParams = { uri, names: message.names };
              break;
            case "drop":
              lspMethod = "modelscript/addComponent";
              lspParams = { uri, className: message.className, x: message.x, y: message.y };
              break;
            case "updateName":
              lspMethod = "modelscript/updateComponentName";
              lspParams = { uri, oldName: message.oldName, newName: message.newName };
              break;
            case "updateDescription":
              lspMethod = "modelscript/updateComponentDescription";
              lspParams = { uri, name: message.name, description: message.description };
              break;
            case "updateParameter":
              lspMethod = "modelscript/updateComponentParameter";
              lspParams = { uri, name: message.name, parameter: message.parameter, value: message.value };
              break;
            case "undo": {
              const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri);
              if (editor) {
                await vscode.window.showTextDocument(editor.document, {
                  viewColumn: editor.viewColumn,
                  preserveFocus: false,
                });
                await vscode.commands.executeCommand("undo");
                this.panel.reveal(vscode.ViewColumn.Beside, false);
                this.debouncedUpdate(uri);
              }
              break;
            }
            case "redo": {
              const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri);
              if (editor) {
                await vscode.window.showTextDocument(editor.document, {
                  viewColumn: editor.viewColumn,
                  preserveFocus: false,
                });
                await vscode.commands.executeCommand("redo");
                this.panel.reveal(vscode.ViewColumn.Beside, false);
                this.debouncedUpdate(uri);
              }
              break;
            }
          }

          if (lspMethod) {
            isDiagramUpdate = true;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const edits: any[] = await this.client.sendRequest(lspMethod, lspParams);
            if (edits && edits.length > 0) {
              await this.applyTextEdits(uri, edits);
            }
            // Reset flag after a short delay to allow the document change event to fire
            setTimeout(() => {
              isDiagramUpdate = false;
            }, 100);
          }
        } catch (e) {
          console.error("[diagram] Error applying diagram edit:", e);
          isDiagramUpdate = false;
        }
      },
      null,
      this.disposables,
    );

    // Update diagram when active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document.languageId === "modelica") {
          this.debouncedUpdate(editor.document.uri.toString());
        }
      }),
    );

    // Update diagram when document content changes (but not from diagram edits)
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId === "modelica" && !isDiagramUpdate) {
          this.debouncedUpdate(event.document.uri.toString());
        }
      }),
    );

    // Initial update
    this.update();
  }

  private debouncedUpdate(uri: string) {
    if (this.updateTimeout) clearTimeout(this.updateTimeout);
    this.updateTimeout = setTimeout(() => {
      this.currentDocUri = uri;
      this.requestDiagramData(uri);
    }, 500);
  }

  async update() {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.languageId === "modelica") {
      this.currentDocUri = editor.document.uri.toString();
      await this.requestDiagramData(this.currentDocUri);
    }
  }

  private async requestDiagramData(uri: string) {
    try {
      const data = await this.client.sendRequest("modelscript/getDiagramData", { uri });
      if (data) {
        // Detect VS Code theme type
        const isDark =
          vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
          vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
        this.panel.webview.postMessage({ type: "diagramData", data, isDark });
      } else {
        this.panel.webview.postMessage({ type: "empty" });
      }
    } catch (e) {
      console.error("[diagram] Failed to get diagram data:", e);
      this.panel.webview.postMessage({ type: "error", message: String(e) });
    }
  }

  private getHtmlForWebview(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "diagramWebview.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data: ${webview.cspSource}; font-src ${webview.cspSource};">
  <title>Modelica Diagram</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
    }
    #container {
      width: 100%;
      height: 100%;
    }
    #placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      color: var(--vscode-foreground, #ccc);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 14px;
      opacity: 0.6;
    }
    #spinner {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 36px;
      height: 36px;
      margin: -18px 0 0 -18px;
      border: 3px solid var(--vscode-editorGutter-background, rgba(128,128,128,0.2));
      border-top-color: var(--vscode-foreground, #ccc);
      border-radius: 50%;
      animation: diagram-spin 0.7s linear infinite;
      display: none;
      z-index: 1000;
    }
    @keyframes diagram-spin { to { transform: rotate(360deg); } }

    #properties-panel {
      position: absolute;
      top: 0;
      right: -320px;
      width: 320px;
      height: 100vh;
      background: var(--vscode-sideBar-background, #252526);
      border-left: 1px solid var(--vscode-sideBarSectionHeader-border, #454545);
      color: var(--vscode-foreground, #ccc);
      transition: right 0.2s ease-in-out;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      z-index: 500;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 13px;
    }
    #properties-panel.open {
      right: 0;
    }
    #properties-header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545);
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
      text-transform: uppercase;
      font-size: 11px;
      color: var(--vscode-sideBarTitle-foreground, #ccc);
    }
    #properties-close {
      cursor: pointer;
      opacity: 0.7;
    }
    #properties-close:hover {
      opacity: 1;
    }
    #properties-content {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    }
    .prop-group {
      margin-bottom: 16px;
    }
    .prop-label {
      display: block;
      margin-bottom: 6px;
      color: var(--vscode-descriptionForeground, #888);
    }
    .prop-input {
      width: 100%;
      box-sizing: border-box;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 6px 8px;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .prop-input:focus {
      outline: 1px solid var(--vscode-focusBorder, #007fd4);
      outline-offset: -1px;
      border-color: transparent;
    }
    .prop-input.error {
      outline: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-inputValidation-errorForeground, #ccc);
    }
  </style>
</head>
<body>
  <div id="container"></div>
  <div id="placeholder">Open a Modelica file with diagram annotations</div>
  <div id="spinner"></div>
  <div id="properties-panel">
    <div id="properties-header">
      <span id="properties-title">Properties</span>
      <span id="properties-close">✕</span>
    </div>
    <div id="properties-content"></div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Apply LSP TextEdit[] to the document via workspace.applyEdit().
   * LSP positions are 0-indexed; VS Code positions are also 0-indexed.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async applyTextEdits(uri: string, edits: any[]) {
    const docUri = vscode.Uri.parse(uri);
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of edits) {
      const range = new vscode.Range(
        edit.range.start.line,
        edit.range.start.character,
        edit.range.end.line,
        edit.range.end.character,
      );
      workspaceEdit.replace(docUri, range, edit.newText);
    }
    await vscode.workspace.applyEdit(workspaceEdit);
  }

  dispose() {
    DiagramPanel.currentPanel = undefined;
    this.panel.dispose();
    if (this.updateTimeout) clearTimeout(this.updateTimeout);
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) x.dispose();
    }
  }
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
