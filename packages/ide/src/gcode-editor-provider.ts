// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export class GCodeEditorProvider extends BaseCustomEditorProvider {
  static readonly viewType = "modelscript.gcodeViewer";

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,

    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.configureWebview(webviewPanel);

    let disposed = false;
    webviewPanel.webview.html = this.getHtmlShell(webviewPanel.webview, {
      title: "GCode Viewer",
      scriptName: "gcode-webview.js",
    });

    const loadGCode = async () => {
      if (disposed) return;
      try {
        const text = document.getText();
        if (!disposed) {
          webviewPanel.webview.postMessage({ type: "gcodeData", data: text });
        }
      } catch (e) {
        console.warn("[GCode Editor] Failed to get GCode:", e);
      }
    };

    const msgSubscription = webviewPanel.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case "ready":
          loadGCode();
          break;
      }
    });

    const changeSubscription = this.subscribeDocumentChanges(document, () => {
      loadGCode();
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      msgSubscription.dispose();
      changeSubscription.dispose();
    });
  }
}
