// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the Custom Text Editor representing the Modelica Diagram View.
// Communicates with the LSP server via the LanguageClient to get diagram data,
// and posts it to the webview for X6 rendering.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export class DiagramEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "modelscript.diagram";

  private readonly activeWebviews = new Set<vscode.WebviewPanel>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: LanguageClient,
  ) {
    context.subscriptions.push(
      vscode.commands.registerCommand("modelscript.autoLayout", () => {
        for (const panel of this.activeWebviews) {
          if (panel.active) {
            panel.webview.postMessage({ type: "autoLayout" });
          }
        }
      }),
    );
  }

  /** Post a message to all active diagram webviews */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public postToActiveWebviews(message: any): void {
    for (const panel of this.activeWebviews) {
      panel.webview.postMessage(message);
    }
  }
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    };

    this.activeWebviews.add(webviewPanel);
    webviewPanel.onDidDispose(() => {
      this.activeWebviews.delete(webviewPanel);
    });

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    let isDiagramUpdate = false;
    let updateTimeout: ReturnType<typeof setTimeout> | null = null;
    let diagramRequestNonce = 0;
    const uriString = document.uri.toString();

    const debouncedUpdate = () => {
      if (updateTimeout) clearTimeout(updateTimeout);
      updateTimeout = setTimeout(() => {
        diagramRequestNonce++;
        const currentNonce = diagramRequestNonce;
        this.requestDiagramData(webviewPanel, uriString, {
          isCanceled: () => diagramRequestNonce !== currentNonce,
        });
      }, 500);
    };

    const applyTextEdits = async (uri: string, edits: vscode.TextEdit[]) => {
      const workspaceEdit = new vscode.WorkspaceEdit();
      const parsedUri = vscode.Uri.parse(uri);
      for (const edit of edits) {
        workspaceEdit.replace(parsedUri, edit.range, edit.newText);
      }
      // Apply the edit without saving the file so the CustomEditor tracks dirty state
      await vscode.workspace.applyEdit(workspaceEdit);
    };

    // Listen for messages from the webview (diagram mutations)
    webviewPanel.webview.onDidReceiveMessage(
      async (message) => {
        try {
          let lspMethod: string | undefined;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let lspParams: any;

          switch (message.type) {
            case "move":
              lspMethod = "modelscript/updatePlacement";
              lspParams = { uri: uriString, items: message.items };
              break;
            case "resize":
              lspMethod = "modelscript/updatePlacement";
              lspParams = {
                uri: uriString,
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
              lspParams = { uri: uriString, source: message.source, target: message.target, points: message.points };
              break;
            case "edgeMove":
              lspMethod = "modelscript/updateEdgePoints";
              lspParams = { uri: uriString, edges: message.edges };
              break;
            case "deleteEdge":
              lspMethod = "modelscript/removeConnect";
              lspParams = { uri: uriString, source: message.source, target: message.target };
              break;
            case "deleteComponents":
              lspMethod = "modelscript/deleteComponents";
              lspParams = { uri: uriString, names: message.names };
              break;
            case "drop":
              lspMethod = "modelscript/addComponent";
              lspParams = { uri: uriString, className: message.className, x: message.x, y: message.y };
              break;
            case "updateName":
              lspMethod = "modelscript/updateComponentName";
              lspParams = { uri: uriString, oldName: message.oldName, newName: message.newName };
              break;
            case "updateDescription":
              lspMethod = "modelscript/updateComponentDescription";
              lspParams = { uri: uriString, name: message.name, description: message.description };
              break;
            case "updateParameter":
              lspMethod = "modelscript/updateComponentParameter";
              lspParams = { uri: uriString, name: message.name, parameter: message.parameter, value: message.value };
              break;
            case "undo": {
              // Standard undo command applies to the document representing this custom editor
              await vscode.commands.executeCommand("undo");
              debouncedUpdate();
              break;
            }
            case "redo": {
              await vscode.commands.executeCommand("redo");
              debouncedUpdate();
              break;
            }
          }

          if (lspMethod) {
            diagramRequestNonce++; // Cancel incoming stale diagramData
            isDiagramUpdate = true;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const edits: any[] = await this.client.sendRequest(lspMethod, lspParams);
            if (edits && edits.length > 0) {
              await applyTextEdits(uriString, edits);
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
      undefined,
      this.context.subscriptions,
    );

    // Watch for text document changes to re-render the diagram if the source changes externally
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && !isDiagramUpdate) {
        debouncedUpdate();
      }
    });

    // Make sure we get rid of the listener when our editor is closed.
    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });

    // Initial load
    debouncedUpdate();
  }

  private async requestDiagramData(
    webviewPanel: vscode.WebviewPanel,
    uri: string,
    cancelToken?: { isCanceled: () => boolean },
  ) {
    try {
      const data = await this.client.sendRequest("modelscript/getDiagramData", { uri });
      if (cancelToken?.isCanceled()) return;
      if (data) {
        const isDark =
          vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
          vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
        webviewPanel.webview.postMessage({ type: "diagramData", data, isDark });
      } else {
        webviewPanel.webview.postMessage({ type: "empty" });
      }
    } catch (e) {
      if (cancelToken?.isCanceled()) return;
      console.error("[diagram] Failed to get diagram data:", e);
      webviewPanel.webview.postMessage({ type: "error", message: String(e) });
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "diagramWebview.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data: ${webview.cspSource}; font-src ${webview.cspSource}; connect-src ${webview.cspSource};">
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

    @keyframes drop-placeholder-pulse {
      0%, 100% { opacity: 0.6; transform: scale(1); }
      50% { opacity: 0.9; transform: scale(1.04); }
    }
    @keyframes drop-placeholder-appear {
      0% { opacity: 0; transform: scale(0.3); }
      50% { opacity: 1; transform: scale(1.15); }
      70% { transform: scale(0.92); }
      100% { opacity: 1; transform: scale(1); }
    }

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
    /* Modern VS Code UI scrolling */
    #properties-panel > .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    /* Simple form UI */
    .prop-group {
      margin-bottom: 12px;
    }
    .prop-label {
      display: block;
      margin-bottom: 4px;
      font-weight: 600;
      opacity: 0.8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .prop-input {
      width: 100%;
      box-sizing: border-box;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 4px 6px;
      font-family: inherit;
      font-size: 13px;
    }
    .prop-input:focus {
      outline: 1px solid var(--vscode-focusBorder, #007fd4);
      outline-offset: -1px;
    }
    select.prop-input {
      appearance: none;
    }
  </style>
</head>
<body>
  <div id="container"></div>
  <div id="placeholder">Loading diagram...</div>
  <div id="spinner"></div>

  <div id="properties-panel">
    <div style="padding: 12px 16px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); display: flex; align-items: center; justify-content: space-between;">
      <span id="properties-title" style="font-weight: 600; font-size: 11px; text-transform: uppercase; color: var(--vscode-sideBarTitle-foreground);">Properties</span>
    </div>
    <div class="panel-body" id="properties-content">
      <!-- injected dynamically -->
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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
