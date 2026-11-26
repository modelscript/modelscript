// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { BaseWebviewPanel } from "./webview/base-panel.js";
import { attachExtensionWebviewBridge } from "./webview/shared/extension-lsp-bridge.js";

/**
 * Polyglot Domain Inspector panel hosting `@modelscript/editor`'s shared
 * `PolyglotDomainPanel` (PowerGrid/PSS/E, PSCAD LCP/Scripts/Sweeps, DAE Advanced,
 * Requirements/Ontology Seasonal Matrix, Automation/PLCopen, Biochem, CAE Continuum,
 * Multibody, Open-Channel Hydraulics, Thermo-Fluid, Transit Cockpit, and CSV viewer).
 */
export class DomainInspectorPanel extends BaseWebviewPanel {
  public static currentPanel: DomainInspectorPanel | undefined;
  public static readonly viewType = "modelscript.domainInspector";

  private document: vscode.TextDocument | undefined;
  private readonly client?: LanguageClient | undefined;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, document?: vscode.TextDocument): void {
    const activeDoc = document ?? vscode.window.activeTextEditor?.document;
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (DomainInspectorPanel.currentPanel) {
      DomainInspectorPanel.currentPanel.document = activeDoc;
      DomainInspectorPanel.currentPanel._panel.reveal(column);
      void DomainInspectorPanel.currentPanel.syncDocument();
      return;
    }

    const panel = vscode.window.createWebviewPanel(DomainInspectorPanel.viewType, "Polyglot Domain Inspector", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
    });

    DomainInspectorPanel.currentPanel = new DomainInspectorPanel(panel, extensionUri, client, activeDoc);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client?: LanguageClient,
    document?: vscode.TextDocument,
  ) {
    super(panel, extensionUri);
    this.client = client;
    this.document = document;

    this._panel.webview.html = this.getHtmlShell({
      title: "Polyglot Domain Inspector",
      scriptName: "domain-inspector-webview.js",
    });

    const bridgeSub = attachExtensionWebviewBridge(this._panel.webview, {
      client: this.client,
      getDocument: () => this.document ?? vscode.window.activeTextEditor?.document,
      title: "Polyglot Domain Inspector",
      languageId: this.document?.languageId,
      onUnhandledMessage: async (msg) => {
        if (msg.type === "ready") {
          await this.syncDocument();
        }
      },
    });
    this._disposables.push(bridgeSub);

    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document) {
          this.document = editor.document;
          void this.syncDocument();
        }
      }),
    );

    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((ev) => {
        if (this.document && ev.document.uri.toString() === this.document.uri.toString()) {
          void this.syncDocument();
        }
      }),
    );
  }

  private async syncDocument(): Promise<void> {
    const doc = this.document ?? vscode.window.activeTextEditor?.document;
    if (!doc) return;

    const projectFiles: Record<string, string> = {};
    for (const openDoc of vscode.workspace.textDocuments ?? []) {
      const name = openDoc.uri.path.split("/").pop();
      if (name) {
        projectFiles[name] = openDoc.getText();
      }
    }

    let documentSymbols: unknown[] | undefined;
    if (this.client) {
      try {
        const res = await this.client.sendRequest<unknown[]>("textDocument/documentSymbol", {
          textDocument: { uri: doc.uri.toString() },
        });
        if (Array.isArray(res)) {
          documentSymbols = res;
        }
      } catch {
        // document symbols are optional
      }
    }

    const activeFileName = doc.uri.path.split("/").pop() ?? "Untitled";
    this._panel.title = `Inspector: ${activeFileName}`;
    void this._panel.webview.postMessage({
      type: "syncDomainInspector",
      data: {
        documentUri: doc.uri.toString(),
        activeFileName,
        dialect: doc.languageId || "modelica",
        code: doc.getText(),
        projectFiles,
        documentSymbols,
      },
    });
  }

  public override dispose(): void {
    DomainInspectorPanel.currentPanel = undefined;
    super.dispose();
  }
}
