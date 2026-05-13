// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the uncertainty (Monte Carlo) webview panel lifecycle.
// Sends uncertainty requests to the LSP server.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export class UncertaintyPanel {
  static currentPanel: UncertaintyPanel | undefined;
  static readonly viewType = "modelscript.uncertainty";

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  public sourceUri?: string;
  private client?: LanguageClient;
  private disposables: vscode.Disposable[] = [];

  static createOrShow(extensionUri: vscode.Uri, client: LanguageClient, uri?: string) {
    const sourceUri = uri ?? vscode.window.activeTextEditor?.document.uri.toString();
    if (!sourceUri) {
      vscode.window.showWarningMessage("Open a Modelica file to run uncertainty analysis.");
      return;
    }

    if (UncertaintyPanel.currentPanel) {
      UncertaintyPanel.currentPanel.sourceUri = sourceUri;
      UncertaintyPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      UncertaintyPanel.viewType,
      "Uncertainty (Monte Carlo) Dashboard",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    UncertaintyPanel.currentPanel = new UncertaintyPanel(panel, extensionUri);
    UncertaintyPanel.currentPanel.client = client;
    UncertaintyPanel.currentPanel.sourceUri = sourceUri;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.panel.webview.html = this.getHtmlForWebview();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === "montecarloRequest") {
          try {
            if (!this.client) return;
            const result = await this.client.sendRequest("modelscript/montecarlo", {
              uri: this.sourceUri,
              numSamples: msg.payload.numSamples,
              confidenceLevel: msg.payload.confidenceLevel,
              method: msg.payload.method,
              parameters: msg.payload.parameters,
            });
            const isDark =
              vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
              vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
            this.panel.webview.postMessage({
              type: "montecarloResult",
              data: result,
              isDark,
            });
          } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Uncertainty analysis failed: ${errMsg}`);
            this.panel.webview.postMessage({ type: "montecarloError", error: errMsg });
          }
        }
      },
      null,
      this.disposables,
    );
  }

  private getHtmlForWebview(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "uncertaintyWebview.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Uncertainty Dashboard</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-foreground, #ccc);
      font-family: var(--vscode-font-family, system-ui, sans-serif);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose() {
    UncertaintyPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
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
