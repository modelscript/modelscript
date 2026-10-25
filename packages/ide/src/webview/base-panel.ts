// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { getNonce } from "../utils/nonce.js";

export interface HtmlShellOptions {
  title: string;
  scriptName: string;
  styleName?: string | undefined;
  injectedGlobalJs?: string | undefined;
  rootId?: string | undefined;
  bodyClass?: string | undefined;
  extraMetaTags?: string | undefined;
}

/**
 * Base class for all ModelScript webview panels.
 * Encapsulates panel lifecycle, resource resolution, CSP nonce injection,
 * and standard theme-aware HTML scaffolding.
 */
export abstract class BaseWebviewPanel {
  protected readonly _panel: vscode.WebviewPanel;
  protected readonly _extensionUri: vscode.Uri;
  protected _disposables: vscode.Disposable[] = [];

  protected constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  /**
   * Disposes the panel and all tracked event subscriptions, timers, and listeners.
   */
  public dispose(): void {
    this._panel.dispose();
    while (this._disposables.length) {
      const item = this._disposables.pop();
      if (item) {
        item.dispose();
      }
    }
  }

  /**
   * Generates a secure, CSP-compliant HTML shell for the webview.
   */
  protected getHtmlShell(options: HtmlShellOptions): string {
    const scriptUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", options.scriptName),
    );
    const styleUri = options.styleName
      ? this._panel.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "dist", options.styleName))
      : undefined;

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this._panel.webview.cspSource} data: blob:; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${this._panel.webview.cspSource} https: http: ws: wss: data: blob:; worker-src 'self' blob:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.title}</title>
  ${styleUri ? `<link rel="stylesheet" href="${styleUri}">` : ""}
  ${options.extraMetaTags ?? ""}
</head>
<body class="${options.bodyClass ?? "vscode-dark"}">
  <div id="${options.rootId ?? "root"}"></div>
  ${options.injectedGlobalJs ? `<script nonce="${nonce}">${options.injectedGlobalJs}</script>` : ""}
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
