// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { BaseWebviewPanel } from "./webview/base-panel.js";

/**
 * V&V Dashboard panel — displays requirement verification results from
 * simulation runs in a rich, sortable table with pass/fail/pending status.
 *
 * Deep-links back to the simulation results panel when a failure is clicked.
 */
export class VerificationPanel extends BaseWebviewPanel {
  public static currentPanel: VerificationPanel | undefined;
  public static readonly viewType = "modelscript.verificationDashboard";

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly client: LanguageClient,
  ) {
    super(panel, extensionUri);

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case "runVerification": {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
              vscode.window.showWarningMessage("Open a file first.");
              return;
            }
            const uri = editor.document.uri.toString();
            this._panel.webview.postMessage({ type: "verificationStarted" });
            try {
              await this.client.sendRequest("modelscript/runVerification", { uri });
              // Fetch updated requirements to refresh statuses
              const requirements = await this.client.sendRequest<unknown>("modelscript/getRequirements", { uri });
              let unifiedReport = null;
              try {
                unifiedReport = await this.client.sendRequest<any>("modelscript/verifyAll", {
                  uri,
                  options: { all: true },
                });
              } catch {}
              this._panel.webview.postMessage({
                type: "verificationComplete",
                requirements,
                unifiedReport,
              });
            } catch (e) {
              this._panel.webview.postMessage({
                type: "verificationError",
                message: `${e}`,
              });
            }
            break;
          }

          case "runB2B": {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
              vscode.window.showWarningMessage("Open a model file first.");
              return;
            }
            const uri = editor.document.uri.toString();
            this._panel.webview.postMessage({ type: "verificationStarted" });
            try {
              const b2bResult = await this.client.sendRequest<any>("modelscript/verifyB2B", {
                uri,
                format: "dhf",
              });
              this._panel.webview.postMessage({ type: "b2bComplete", b2bResult });
            } catch (e) {
              this._panel.webview.postMessage({
                type: "verificationError",
                message: `${e}`,
              });
            }
            break;
          }

          case "exportDhf": {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
              vscode.window.showWarningMessage("Open a model file first.");
              return;
            }
            const uri = editor.document.uri.toString();
            try {
              const b2bResult = await this.client.sendRequest<any>("modelscript/verifyB2B", {
                uri,
                format: "dhf",
              });
              if (b2bResult?.formattedOutput) {
                const doc = await vscode.workspace.openTextDocument({
                  content: b2bResult.formattedOutput,
                  language: "markdown",
                });
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
              } else {
                vscode.window.showWarningMessage("No DHF markdown generated.");
              }
            } catch (e: any) {
              vscode.window.showErrorMessage(`Export DHF failed: ${e.message}`);
            }
            break;
          }

          case "openSimulation":
            vscode.commands.executeCommand("modelscript.runSimulation");
            break;

          case "goToSource": {
            const docUri = vscode.Uri.parse(msg.uri);
            const doc = await vscode.workspace.openTextDocument(docUri);
            const startPos = doc.positionAt(msg.startOffset);
            const endPos = doc.positionAt(msg.endOffset);
            vscode.window.showTextDocument(doc, {
              selection: new vscode.Range(startPos, endPos),
              viewColumn: vscode.ViewColumn.One,
            });
            break;
          }
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.html = this.getHtmlShell({
      scriptName: "verification-webview.js",
      title: "V&V Dashboard",
    });
  }

  public static createOrShow(extensionUri: vscode.Uri, client: LanguageClient): void {
    const column = vscode.ViewColumn.Beside;

    if (VerificationPanel.currentPanel) {
      VerificationPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(VerificationPanel.viewType, "V&V Dashboard", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
    });

    VerificationPanel.currentPanel = new VerificationPanel(panel, extensionUri, client);
  }

  public override dispose(): void {
    VerificationPanel.currentPanel = undefined;
    super.dispose();
  }
}
