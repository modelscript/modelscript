// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the optimization webview panel lifecycle.
// Sends optimization requests to the LSP server.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { BaseWebviewPanel } from "./webview/base-panel.js";
import { attachExtensionWebviewBridge } from "./webview/shared/extension-lsp-bridge.js";

export class OptimizationPanel extends BaseWebviewPanel {
  static currentPanel: OptimizationPanel | undefined;
  static readonly viewType = "modelscript.optimization";

  public sourceUri?: string | undefined;
  private dialect = "modelica";
  private client?: LanguageClient | undefined;

  static createOrShow(extensionUri: vscode.Uri, client: LanguageClient, uri?: string) {
    const activeDoc = vscode.window.activeTextEditor?.document;
    const sourceUri = uri ?? activeDoc?.uri.toString();
    const dialect = activeDoc?.languageId || "modelica";
    if (!sourceUri) {
      vscode.window.showWarningMessage("Open a Modelica file to run optimization.");
      return;
    }

    if (OptimizationPanel.currentPanel) {
      OptimizationPanel.currentPanel.sourceUri = sourceUri;
      OptimizationPanel.currentPanel.dialect = dialect;
      OptimizationPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
      OptimizationPanel.currentPanel.syncDocument();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      OptimizationPanel.viewType,
      "Optimization, UQ & Surrogates",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    OptimizationPanel.currentPanel = new OptimizationPanel(panel, extensionUri, client, sourceUri, dialect);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client: LanguageClient,
    sourceUri: string,
    dialect: string,
  ) {
    super(panel, extensionUri);
    this.client = client;
    this.sourceUri = sourceUri;
    this.dialect = dialect;

    this._panel.webview.html = this.getHtmlShell({
      title: "Optimization, UQ & Surrogates",
      scriptName: "optimization-webview.js",
    });

    const bridgeSub = attachExtensionWebviewBridge(this._panel.webview, {
      client: this.client,
      getDocument: () => vscode.window.activeTextEditor?.document,
      title: "Optimization, UQ & Surrogates",
      languageId: this.dialect,
      onUnhandledMessage: (msg) => {
        if (msg.type === "ready") {
          this.syncDocument();
        }
      },
    });
    this._disposables.push(bridgeSub);

    const editorSub = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document) {
        this.sourceUri = editor.document.uri.toString();
        this.dialect = editor.document.languageId || "modelica";
        this.syncDocument();
      }
    });
    this._disposables.push(editorSub);
  }

  private syncDocument(): void {
    if (!this.sourceUri) return;
    void this._panel.webview.postMessage({
      type: "syncOptimizationDocument",
      data: {
        documentUri: this.sourceUri,
        dialect: this.dialect,
      },
    });
  }

  public override dispose(): void {
    OptimizationPanel.currentPanel = undefined;
    super.dispose();
  }
}
