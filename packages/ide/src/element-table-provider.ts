// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Custom Editor Provider for General-Purpose SysML v2 Element Tables.
// Displays spreadsheet-style editable grids for Parts, Actions, Ports, States, and Attributes
// with in-cell autocompletion and bi-directional AST synchronization.

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export class ElementTableProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.elementTable";

  constructor(
    extensionUri: vscode.Uri,
    private readonly client: LanguageClient,
  ) {
    super(extensionUri);
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    this.configureWebview(webviewPanel);
    webviewPanel.webview.html = this.getHtmlShell(webviewPanel.webview, {
      scriptName: "element-table-webview.js",
      title: "SysML v2 Element Table",
    });

    let currentMetaclass = "part";
    const uri = document.uri.toString();

    // Fetch and send table data
    const sendData = async () => {
      try {
        const table = await this.client.sendRequest<unknown>("modelscript/getElementsTable", {
          uri,
          metaclass: currentMetaclass,
        });

        webviewPanel.webview.postMessage({
          type: "setData",
          table,
          metaclass: currentMetaclass,
        });
      } catch (e) {
        webviewPanel.webview.postMessage({
          type: "setError",
          message: `Failed to load element table: ${e}`,
        });
      }
    };

    sendData();

    // Listen for text document edits
    const changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        sendData();
      }
    });

    // Listen for semantic project tree updates
    const projectTreeListener = this.client.onNotification("modelscript/projectTreeChanged", () => {
      sendData();
    });

    // Handle messages from webview
    const msgListener = webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "ready":
          sendData();
          break;

        case "changeMetaclass":
          currentMetaclass = msg.metaclass ?? "part";
          sendData();
          break;

        case "refresh":
          sendData();
          break;

        case "goToSource": {
          const { startOffset, endOffset } = msg;
          try {
            const doc = await vscode.workspace.openTextDocument(document.uri);
            const startPos = doc.positionAt(startOffset ?? 0);
            const endPos = doc.positionAt(endOffset ?? startOffset ?? 0);
            vscode.window.showTextDocument(doc, {
              selection: new vscode.Range(startPos, endPos),
              viewColumn: vscode.ViewColumn.One,
            });
          } catch (e) {
            vscode.window.showErrorMessage(`Failed to open source: ${e}`);
          }
          break;
        }

        case "updateAttribute": {
          const { qualifiedName, attributeName, newValue } = msg;
          try {
            const res = await this.client.sendRequest<{ success: boolean; error?: string | undefined }>(
              "modelscript/updateElementAttribute",
              {
                uri,
                qualifiedName,
                attributeName,
                newValue,
              },
            );

            if (res.success) {
              sendData();
            } else {
              vscode.window.showErrorMessage(`Failed to update attribute: ${res.error}`);
            }
          } catch (e) {
            vscode.window.showErrorMessage(`Error updating attribute: ${e}`);
          }
          break;
        }

        case "getCompletions": {
          const { requestId, attributeName, prefix } = msg;
          try {
            const completions = await this.client.sendRequest<unknown[]>("modelscript/tableCellComplete", {
              uri,
              metaclass: currentMetaclass,
              attributeName,
              prefix,
            });
            webviewPanel.webview.postMessage({
              type: "completionResults",
              requestId,
              completions,
            });
          } catch {
            webviewPanel.webview.postMessage({
              type: "completionResults",
              requestId,
              completions: [],
            });
          }
          break;
        }

        case "validateCell": {
          const { requestId, attributeName, value } = msg;
          try {
            const res = await this.client.sendRequest<{ valid: boolean; error?: string | undefined }>(
              "modelscript/validateTableCell",
              {
                attributeName,
                value,
              },
            );
            webviewPanel.webview.postMessage({
              type: "validationResult",
              requestId,
              valid: res.valid,
              error: res.error,
            });
          } catch {
            webviewPanel.webview.postMessage({
              type: "validationResult",
              requestId,
              valid: true,
            });
          }
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      msgListener.dispose();
      changeListener.dispose();
      projectTreeListener.dispose();
    });
  }
}
