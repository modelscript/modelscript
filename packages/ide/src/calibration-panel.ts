// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the calibration webview panel lifecycle.
// Sends calibration requests to the LSP server, receives live progress telemetry,
// and supports the "Extend Pattern" for persisting optimized parameters.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { BaseWebviewPanel } from "./webview/base-panel.js";
import { attachExtensionWebviewBridge } from "./webview/shared/extension-lsp-bridge.js";

export class CalibrationPanel extends BaseWebviewPanel {
  static currentPanel: CalibrationPanel | undefined;
  static readonly viewType = "modelscript.calibration";

  public sourceUri?: string | undefined;
  private client?: LanguageClient | undefined;
  private document?: vscode.TextDocument | undefined;

  static createOrShow(extensionUri: vscode.Uri, client: LanguageClient, uri?: string) {
    const activeDoc = vscode.window.activeTextEditor?.document;
    const sourceUri = uri ?? activeDoc?.uri.toString();
    if (!sourceUri) {
      vscode.window.showWarningMessage("Open a model file to run calibration.");
      return;
    }

    if (CalibrationPanel.currentPanel) {
      CalibrationPanel.currentPanel.sourceUri = sourceUri;
      CalibrationPanel.currentPanel.document = activeDoc;
      CalibrationPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
      void CalibrationPanel.currentPanel.syncDocument();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CalibrationPanel.viewType,
      "Calibration Dashboard",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    CalibrationPanel.currentPanel = new CalibrationPanel(panel, extensionUri, client, sourceUri, activeDoc);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client: LanguageClient,
    sourceUri: string,
    document?: vscode.TextDocument,
  ) {
    super(panel, extensionUri);
    this.client = client;
    this.sourceUri = sourceUri;
    this.document = document;

    this._panel.webview.html = this.getHtmlShell({
      title: "Calibration Dashboard",
      scriptName: "calibration-webview.js",
    });

    const bridgeSub = attachExtensionWebviewBridge(this._panel.webview, {
      client: this.client,
      getDocument: () => this.document ?? vscode.window.activeTextEditor?.document,
      title: "Calibration Dashboard",
      languageId: this.document?.languageId ?? "modelica",
      onUnhandledMessage: async (msg) => {
        if (msg.type === "ready") {
          await this.syncDocument();
        }
      },
    });
    this._disposables.push(bridgeSub);

    const editorSub = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document) {
        this.document = editor.document;
        this.sourceUri = editor.document.uri.toString();
        void this.syncDocument();
      }
    });
    this._disposables.push(editorSub);
  }

  private async syncDocument(): Promise<void> {
    if (!this.sourceUri) return;
    let doc = this.document;
    if (!doc) {
      try {
        doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(this.sourceUri));
        this.document = doc;
      } catch {
        // continue with URI only
      }
    }

    const projectFiles: Record<string, string> = {};
    if (doc?.uri) {
      try {
        const parentUri = vscode.Uri.joinPath(doc.uri, "..");
        const entries = await vscode.workspace.fs.readDirectory(parentUri);
        for (const [name, fileType] of entries) {
          if (fileType === vscode.FileType.File && /\.(csv|cfg|cff)$/i.test(name)) {
            try {
              const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(parentUri, name));
              projectFiles[name] = new TextDecoder().decode(raw);
            } catch {
              // ignore unreadable sibling files
            }
          }
        }
      } catch {
        // ignore directory listing failures on virtual URIs
      }
    }

    const activeFileName = this.sourceUri.split("/").pop() ?? "Main.mo";
    void this._panel.webview.postMessage({
      type: "syncCalibrationDocument",
      data: {
        documentUri: this.sourceUri,
        activeFileName,
        activeCode: doc?.getText() ?? "",
        projectFiles,
      },
    });
  }

  public override dispose(): void {
    CalibrationPanel.currentPanel = undefined;
    super.dispose();
  }
}
