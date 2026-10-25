// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { getNonce } from "../utils/nonce.js";
import type { HtmlShellOptions } from "./base-panel.js";

export { type HtmlShellOptions };

/**
 * Base class for all ModelScript custom text editor providers.
 * Encapsulates editor lifecycle, script permissions, secure CSP HTML shells,
 * and debounced document change subscriptions.
 */
export abstract class BaseCustomEditorProvider implements vscode.CustomTextEditorProvider {
  protected readonly context: vscode.ExtensionContext;
  protected readonly extensionUri: vscode.Uri;

  constructor(contextOrExtensionUri: vscode.ExtensionContext | vscode.Uri) {
    if ("extensionUri" in contextOrExtensionUri) {
      this.context = contextOrExtensionUri;
      this.extensionUri = contextOrExtensionUri.extensionUri;
    } else {
      this.context = { extensionUri: contextOrExtensionUri } as vscode.ExtensionContext;
      this.extensionUri = contextOrExtensionUri;
    }
  }

  public abstract resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
  ): Promise<void> | void;

  /**
   * Configures standard secure webview options with script execution and dist local root.
   */
  protected configureWebview(webviewPanel: vscode.WebviewPanel, additionalRoots?: vscode.Uri[]): void {
    const localResourceRoots = [vscode.Uri.joinPath(this.extensionUri, "dist"), ...(additionalRoots ?? [])];

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots,
    };
  }

  /**
   * Generates a CSP-compliant HTML shell for the custom editor webview.
   */
  protected getHtmlShell(webview: vscode.Webview, options: HtmlShellOptions): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", options.scriptName));
    const styleUri = options.styleName
      ? webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", options.styleName))
      : undefined;

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource} https: http: ws: wss: data: blob:; worker-src 'self' blob:;">
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

  /**
   * Subscribes to document changes with debouncing, calling the updater when the target document updates.
   */
  protected subscribeDocumentChanges(
    targetDoc: vscode.TextDocument,
    onChanged: () => void,
    debounceMs = 150,
  ): vscode.Disposable {
    let timer: ReturnType<typeof setTimeout> | undefined;

    return vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === targetDoc.uri.toString()) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => onChanged(), debounceMs);
      }
    });
  }
}
