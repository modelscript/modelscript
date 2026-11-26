// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { BaseWebviewPanel } from "./webview/base-panel.js";
import { attachExtensionWebviewBridge } from "./webview/shared/extension-lsp-bridge.js";

/**
 * Unified Requirements, Traceability Matrix (RTM), and Assume/Guarantee Contracts panel.
 * Mounts `@modelscript/editor`'s shared `AnsatzRtmContractsPanel` inside VS Code.
 */
export class RtmContractsPanel extends BaseWebviewPanel {
  public static currentPanel: RtmContractsPanel | undefined;
  public static readonly viewType = "modelscript.rtmContracts";

  private document: vscode.TextDocument | undefined;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, document?: vscode.TextDocument): void {
    const activeDoc = document ?? vscode.window.activeTextEditor?.document;
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (RtmContractsPanel.currentPanel) {
      RtmContractsPanel.currentPanel.setDocument(activeDoc);
      RtmContractsPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      RtmContractsPanel.viewType,
      "Requirements, RTM & Contracts",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    RtmContractsPanel.currentPanel = new RtmContractsPanel(panel, extensionUri, client, activeDoc);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client?: LanguageClient,
    document?: vscode.TextDocument,
  ) {
    super(panel, extensionUri);
    this.document = document;

    this._panel.webview.html = this.getHtmlShell({
      title: "Requirements, RTM & Contracts",
      scriptName: "rtm-contracts-webview.js",
    });

    const bridgeSub = attachExtensionWebviewBridge(this._panel.webview, {
      client,
      getDocument: () => this.document,
      title: "Requirements, RTM & Contracts",
      languageId: this.document?.languageId,
      onUnhandledMessage: (msg) => {
        if (msg.type === "ready") {
          this.syncDocument();
        }
      },
    });
    this._disposables.push(bridgeSub);

    const editorSub = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document) {
        this.setDocument(editor.document);
      }
    });
    this._disposables.push(editorSub);
  }

  public setDocument(document?: vscode.TextDocument): void {
    this.document = document;
    this.syncDocument();
  }

  private syncDocument(): void {
    if (!this.document) return;
    void this._panel.webview.postMessage({
      type: "syncDocument",
      documentUri: this.document.uri.toString(),
    });
  }

  public override dispose(): void {
    RtmContractsPanel.currentPanel = undefined;
    super.dispose();
  }
}
