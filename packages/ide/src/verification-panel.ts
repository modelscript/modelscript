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
              let unifiedReport: unknown = null;
              try {
                unifiedReport = await this.client.sendRequest<unknown>("modelscript/verifyAll", {
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
              const b2bResult = await this.client.sendRequest<unknown>("modelscript/verifyB2B", {
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

          case "openLocation": {
            if (typeof msg.uri === "string" && msg.uri.length > 0) {
              try {
                const targetUri = msg.uri.includes("://") ? vscode.Uri.parse(msg.uri) : vscode.Uri.file(msg.uri);
                const doc = await vscode.workspace.openTextDocument(targetUri);
                const line = Math.max(0, Number(msg.line ?? 1) - 1);
                const col = Math.max(0, Number(msg.column ?? 1) - 1);
                const pos = new vscode.Position(line, col);
                await vscode.window.showTextDocument(doc, {
                  selection: new vscode.Range(pos, pos),
                  preserveFocus: false,
                });
              } catch {
                // Ignore unopenable location
              }
            }
            break;
          }

          case "applyDigitalThreadSync": {
            const edits: Array<{
              uri?: string;
              line?: number;
              startOffset?: number;
              endOffset?: number;
              newText: string;
            }> = Array.isArray(msg.suggestedEdits) ? msg.suggestedEdits : [];
            if (edits.length > 0) {
              const wsEdit = new vscode.WorkspaceEdit();
              for (const se of edits) {
                if (!se.uri) continue;
                try {
                  const targetUri = se.uri.includes("://") ? vscode.Uri.parse(se.uri) : vscode.Uri.file(se.uri);
                  const doc = await vscode.workspace.openTextDocument(targetUri);
                  let range: vscode.Range | undefined;
                  if (se.startOffset !== undefined && se.endOffset !== undefined) {
                    range = new vscode.Range(doc.positionAt(se.startOffset), doc.positionAt(se.endOffset));
                  } else {
                    const zeroLine = Math.max(0, (se.line ?? 1) - 1);
                    const lineText = doc.lineAt(Math.min(zeroLine, doc.lineCount - 1)).text;
                    const mVal = /(=|:=)\s*([-+]?[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?)/.exec(lineText);
                    if (mVal && mVal.index !== undefined) {
                      const colStart = lineText.indexOf(mVal[2]!, mVal.index);
                      range = new vscode.Range(zeroLine, colStart, zeroLine, colStart + mVal[2]!.length);
                    }
                  }
                  if (range) {
                    wsEdit.replace(targetUri, range, se.newText);
                  }
                } catch {
                  // Ignore unreadable URI
                }
              }
              const applied = await vscode.workspace.applyEdit(wsEdit);
              if (applied) {
                await vscode.workspace.saveAll(false);
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor) {
                  const uri = activeEditor.document.uri.toString();
                  const requirements = await this.client.sendRequest<unknown>("modelscript/getRequirements", { uri });
                  const unifiedReport = await this.client.sendRequest<unknown>("modelscript/verifyAll", {
                    uri,
                    options: { all: true },
                  });
                  this._panel.webview.postMessage({ type: "verificationComplete", requirements, unifiedReport });
                }
              }
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
              const b2bResult = await this.client.sendRequest<{ formattedOutput?: string | undefined }>(
                "modelscript/verifyB2B",
                {
                  uri,
                  format: "dhf",
                },
              );
              if (b2bResult?.formattedOutput) {
                const doc = await vscode.workspace.openTextDocument({
                  content: b2bResult.formattedOutput,
                  language: "markdown",
                });
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
              } else {
                vscode.window.showWarningMessage("No DHF markdown generated.");
              }
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : String(e);
              vscode.window.showErrorMessage(`Export DHF failed: ${message}`);
            }
            break;
          }

          case "openSimulation":
            vscode.commands.executeCommand("modelscript.runSimulation");
            break;

          case "focusViolationIn3D": {
            vscode.commands.executeCommand("modelscript.focusViolationIn3D", {
              contractId: msg.contractId,
              time: msg.time,
              lhsName: msg.lhsName,
            });
            break;
          }

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

  public postUnifiedReport(unifiedReport: unknown, requirements: unknown = []): void {
    this._panel.webview.postMessage({
      type: "verificationComplete",
      requirements,
      unifiedReport,
    });
  }

  public override dispose(): void {
    VerificationPanel.currentPanel = undefined;
    super.dispose();
  }
}
