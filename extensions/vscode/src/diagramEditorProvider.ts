// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the Custom Text Editor representing the Modelica Diagram View.
// Communicates with the LSP server via the LanguageClient to get diagram data,
// and posts it to the webview for X6 rendering.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

// Method constants from the unified Diagram API protocol
const DiagramMethods = {
  getData: "modelscript/diagram.getData",
  applyEdits: "modelscript/diagram.applyEdits",
  getComponentProperties: "modelscript/diagram.getComponentProperties",
} as const;

export class DiagramEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "modelscript.diagram";

  public readonly activeWebviews = new Set<vscode.WebviewPanel>();

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

    // Tracks the kind of edit that was just applied to the document.
    let pendingRenderHint: "none" | "immediate" | "debounced" | null = null;
    let updateTimeout: ReturnType<typeof setTimeout> | null = null;
    let diagramRequestNonce = 0;
    const uriString = document.uri.toString();
    let currentDiagramType = "All";
    let diagramEditQueue = Promise.resolve();
    let isSpatialEditPending = false;

    /** Immediately request fresh diagram data (cancels any pending debounced request). */
    const immediateUpdate = () => {
      if (updateTimeout) clearTimeout(updateTimeout);
      updateTimeout = null;
      diagramRequestNonce++;
      const currentNonce = diagramRequestNonce;
      webviewPanel.webview.postMessage({ type: "loading" });
      this.requestDiagramData(webviewPanel, uriString, currentDiagramType, {
        isCanceled: () => diagramRequestNonce !== currentNonce,
      });
    };

    /** Request diagram data after a debounce (for external text changes like user typing). */
    const debouncedUpdate = () => {
      if (updateTimeout) clearTimeout(updateTimeout);
      updateTimeout = setTimeout(() => {
        diagramRequestNonce++;
        const currentNonce = diagramRequestNonce;
        webviewPanel.webview.postMessage({ type: "loading" });
        this.requestDiagramData(webviewPanel, uriString, currentDiagramType, {
          isCanceled: () => diagramRequestNonce !== currentNonce,
        });
      }, 200);
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
      (message) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let actions: any[] | undefined;

          switch (message.type) {
            case "move":
              actions = [{ type: "move", items: message.items }];
              break;
            case "resize":
              actions = [
                {
                  type: "resize",
                  item: {
                    name: message.name,
                    x: message.x,
                    y: message.y,
                    width: message.width,
                    height: message.height,
                    rotation: message.rotation,
                    edges: message.edges,
                  },
                },
              ];
              break;
            case "connect":
              actions = [{ type: "connect", source: message.source, target: message.target, points: message.points }];
              break;
            case "edgeMove":
              actions = [{ type: "moveEdge", edges: message.edges }];
              break;
            case "deleteEdge":
              actions = [{ type: "disconnect", source: message.source, target: message.target }];
              break;
            case "deleteComponents":
              actions = [{ type: "deleteComponents", names: message.names }];
              break;
            case "drop":
              actions = [{ type: "addComponent", className: message.className, x: message.x, y: message.y }];
              break;
            case "updateName":
              actions = [{ type: "updateName", oldName: message.oldName, newName: message.newName }];
              break;
            case "updateDescription":
              actions = [{ type: "updateDescription", name: message.name, description: message.description }];
              break;
            case "updateParameter":
              actions = [
                { type: "updateParameter", name: message.name, parameter: message.parameter, value: message.value },
              ];
              break;
            case "diagramEdit":
              // Direct batch from the webview (already in actions format)
              actions = message.actions;
              webviewPanel.webview.postMessage({ type: "loading" }); // Show spinner immediately
              break;
            case "changeDiagramType": {
              currentDiagramType = message.diagramType;
              immediateUpdate();
              break;
            }
            case "undo": {
              vscode.commands.executeCommand("undo").then(() => immediateUpdate());
              break;
            }
            case "redo": {
              vscode.commands.executeCommand("redo").then(() => immediateUpdate());
              break;
            }
            case "getProperties": {
              // On-demand property loading: fetch expensive data (parameters, docs, icon)
              // only when the user clicks a component node
              this.client
                .sendRequest(DiagramMethods.getComponentProperties, {
                  uri: uriString,
                  componentName: message.componentName,
                })
                .then((props) => {
                  webviewPanel.webview.postMessage({
                    type: "componentProperties",
                    componentName: message.componentName,
                    properties: props,
                  });
                })
                .catch((e) => {
                  console.error("[diagram] Error fetching component properties:", e);
                  webviewPanel.webview.postMessage({
                    type: "componentProperties",
                    componentName: message.componentName,
                    properties: null,
                  });
                });
              break;
            }
            case "error":
              vscode.window.showInformationMessage(message.message);
              break;
          }

          if (actions) {
            console.log("[diagramEditorProvider] received actions from webview:", actions);
            diagramRequestNonce++; // Cancel incoming stale diagramData
            diagramEditQueue = diagramEditQueue
              .then(async () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const response: any = await this.client.sendRequest(DiagramMethods.applyEdits, {
                  uri: uriString,
                  seq: 1,
                  actions,
                });

                console.log("[diagramEditorProvider] applyEdits LSP response:", response);

                if (response && response.edits && response.edits.length > 0) {
                  pendingRenderHint = response.renderHint;
                  await applyTextEdits(uriString, response.edits);
                  // Wait briefly to allow the document change event to fire and propagate to LSP
                  await new Promise((resolve) => setTimeout(resolve, 50));

                  // If the document change event didn't fire (e.g. text didn't change despite edits)
                  if (pendingRenderHint !== null) {
                    const hint = pendingRenderHint;
                    pendingRenderHint = null;
                    if (hint === "immediate") immediateUpdate();
                    else if (hint === "debounced") debouncedUpdate();
                    else webviewPanel.webview.postMessage({ type: "stopLoading" });
                  }
                } else {
                  // No edits generated or response was null.
                  // We must trigger an update to clear the loading spinner which was shown when the request was canceled.
                  if (response?.renderHint === "immediate") immediateUpdate();
                  else if (response?.renderHint === "debounced") debouncedUpdate();
                  else webviewPanel.webview.postMessage({ type: "stopLoading" });
                }
              })
              .catch((e) => {
                console.error("[diagram] Error applying diagram edit:", e);
                pendingRenderHint = null;
                webviewPanel.webview.postMessage({ type: "stopLoading" }); // Always recover
              });
          }
        } catch (e) {
          console.error("[diagram] Message handler error:", e);
          pendingRenderHint = null;
        }
      },
      undefined,
      this.context.subscriptions,
    );

    // React to text document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;

      const hint = pendingRenderHint;
      pendingRenderHint = null; // Consume the flag

      if (hint === "none") {
        // Spatial edit — no re-render needed natively.
        // We set this flag to skip the subsequent projectTreeChanged event
        // and hide the spinner once the semantic pipeline has completed validating the edit.
        isSpatialEditPending = true;
        return;
      }

      isSpatialEditPending = false;

      if (hint === "immediate") {
        // Semantic edit — immediate refresh
        immediateUpdate();
        return;
      }
      if (hint === "debounced") {
        debouncedUpdate();
        return;
      }
      // External change — debounced refresh
      debouncedUpdate();
    });

    // React to semantic pipeline completions from the language server
    const projectTreeListener = this.client.onNotification("modelscript/projectTreeChanged", () => {
      if (isSpatialEditPending) {
        isSpatialEditPending = false;
        webviewPanel.webview.postMessage({ type: "stopLoading" }); // Hide spinner when edit finishes
        return;
      }
      debouncedUpdate();
    });

    // Make sure we get rid of the listeners when our editor is closed.
    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      projectTreeListener.dispose();
    });

    // Initial load
    debouncedUpdate();
  }

  private async requestDiagramData(
    webviewPanel: vscode.WebviewPanel,
    uri: string,
    diagramType: string,
    cancelToken?: { isCanceled: () => boolean },
  ) {
    try {
      const data = await this.client.sendRequest(DiagramMethods.getData, { uri, diagramType });
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
    #toolbar {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 100;
      display: flex;
      gap: 8px;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-widget-border, #454545);
      border-radius: 4px;
      padding: 4px 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 12px;
      align-items: center;
    }
    #toolbar select {
      background: var(--vscode-dropdown-background, #3c3c3c);
      color: var(--vscode-dropdown-foreground, #f0f0f0);
      border: 1px solid var(--vscode-dropdown-border, #3c3c3c);
      border-radius: 2px;
      padding: 2px 4px;
      font-size: 12px;
      outline: none;
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
    .prop-icon-wrapper svg, .prop-icon-wrapper img, .prop-icon-wrapper image {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
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
  <div id="toolbar">
    <span>Diagram View:</span>
    <select id="diagramTypeSelect">
      <option value="All">All (Flat Canvas)</option>
      <option value="BDD">BDD (Block Definition)</option>
      <option value="IBD">IBD (Internal Block)</option>
      <option value="StateMachine">State Machine</option>
    </select>
  </div>
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
