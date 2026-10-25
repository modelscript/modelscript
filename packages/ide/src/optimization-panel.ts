// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the optimization webview panel lifecycle.
// Sends optimization requests to the LSP server.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { BaseWebviewPanel } from "./webview/base-panel.js";

export class OptimizationPanel extends BaseWebviewPanel {
  static currentPanel: OptimizationPanel | undefined;
  static readonly viewType = "modelscript.optimization";

  public sourceUri?: string | undefined;
  private client?: LanguageClient | undefined;

  static createOrShow(extensionUri: vscode.Uri, client: LanguageClient, uri?: string) {
    const sourceUri = uri ?? vscode.window.activeTextEditor?.document.uri.toString();
    if (!sourceUri) {
      vscode.window.showWarningMessage("Open a Modelica file to run optimization.");
      return;
    }

    if (OptimizationPanel.currentPanel) {
      OptimizationPanel.currentPanel.sourceUri = sourceUri;
      OptimizationPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      OptimizationPanel.viewType,
      "Optimization Dashboard",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    OptimizationPanel.currentPanel = new OptimizationPanel(panel, extensionUri, client, sourceUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: LanguageClient, sourceUri: string) {
    super(panel, extensionUri);
    this.client = client;
    this.sourceUri = sourceUri;

    this._panel.webview.html = this.getHtmlShell({
      title: "Optimization Dashboard",
      scriptName: "optimization-webview.js",
    });

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === "optimizeRequest") {
          try {
            if (!this.client) return;
            const result = await this.client.sendRequest("modelscript/optimizeModel", {
              uri: this.sourceUri,
              objective: msg.payload.objective,
              controls: msg.payload.controls,
              tolerance: msg.payload.tolerance,
              maxIterations: msg.payload.maxIterations,
              constraintsUri: msg.payload.constraintsUri ?? msg.payload.sysmlUri,
              constraintsFilter: msg.payload.constraintsFilter ?? msg.payload.sysmlFilter,
              sysmlUri: msg.payload.constraintsUri ?? msg.payload.sysmlUri,
              sysmlFilter: msg.payload.constraintsFilter ?? msg.payload.sysmlFilter,
            });
            const isDark =
              vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
              vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
            this._panel.webview.postMessage({
              type: "optimizationResult",
              data: result,
              isDark,
            });
          } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Optimization failed: ${errMsg}`);
            this._panel.webview.postMessage({ type: "optimizationError", error: errMsg });
          }
        }
      },
      null,
      this._disposables,
    );
  }

  public override dispose(): void {
    OptimizationPanel.currentPanel = undefined;
    super.dispose();
  }
}
