// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { BaseWebviewPanel } from "./webview/base-panel.js";
import { attachExtensionWebviewBridge } from "./webview/shared/extension-lsp-bridge.js";

/**
 * Full-featured Ansatz AI Copilot panel inside VS Code.
 * Mounts `@modelscript/editor`'s shared `AnsatzAiPanel` (multi-task history,
 * WebLLM / Prompt API / Ollama / BYOK providers, inline undoable code diffs,
 * DiskANN memory provenance, and compute dial) alongside VS Code's native
 * `@modelscript` chat participant.
 */
export class AiCopilotPanel extends BaseWebviewPanel {
  public static currentPanel: AiCopilotPanel | undefined;
  public static readonly viewType = "modelscript.ansatzCopilot";

  private document: vscode.TextDocument | undefined;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient): void {
    const activeDoc = vscode.window.activeTextEditor?.document;
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (AiCopilotPanel.currentPanel) {
      AiCopilotPanel.currentPanel.document = activeDoc;
      AiCopilotPanel.currentPanel._panel.reveal(column);
      AiCopilotPanel.currentPanel.syncContext();
      return;
    }

    const panel = vscode.window.createWebviewPanel(AiCopilotPanel.viewType, "Ansatz AI Copilot", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
    });

    AiCopilotPanel.currentPanel = new AiCopilotPanel(panel, extensionUri, client, activeDoc);
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
      title: "Ansatz AI Copilot",
      scriptName: "ai-copilot-webview.js",
    });

    const bridgeSub = attachExtensionWebviewBridge(this._panel.webview, {
      client,
      getDocument: () => this.document ?? vscode.window.activeTextEditor?.document,
      title: "Ansatz AI Copilot",
      languageId: this.document?.languageId,
      onUnhandledMessage: async (msg) => {
        if (msg.type === "ready") {
          this.syncContext();
          return;
        }
        if (msg.type === "closeCopilot") {
          this.dispose();
          return;
        }
        if (msg.type === "switchView" && typeof msg["view"] === "string") {
          const view = msg["view"];
          if (view === "3d") {
            await vscode.commands.executeCommand("modelscript.openSpatialDiagram3D");
          } else if (view === "simulation") {
            await vscode.commands.executeCommand("modelscript.runSimulation");
          } else if (view === "diagram" && this.document) {
            await vscode.commands.executeCommand("vscode.openWith", this.document.uri, "modelscript.diagram");
          }
        }
      },
    });
    this._disposables.push(bridgeSub);

    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document) {
          this.document = editor.document;
          this.syncContext();
        }
      }),
    );

    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((ev) => {
        if (this.document && ev.document.uri.toString() === this.document.uri.toString()) {
          this.syncContext();
        }
      }),
    );
  }

  private syncContext(): void {
    const doc = this.document ?? vscode.window.activeTextEditor?.document;
    if (!doc) return;
    const rawDiags = vscode.languages.getDiagnostics(doc.uri) ?? [];
    const diagnostics = rawDiags.map((d) => ({
      severity:
        d.severity === vscode.DiagnosticSeverity.Error
          ? "error"
          : d.severity === vscode.DiagnosticSeverity.Warning
            ? "warning"
            : "info",
      message: d.message,
      line: d.range.start.line + 1,
      column: d.range.start.character + 1,
    }));

    void this._panel.webview.postMessage({
      type: "syncCopilotContext",
      data: {
        documentUri: doc.uri.toString(),
        fileName: doc.uri.path.split("/").pop() ?? "Untitled.mo",
        dialect: doc.languageId || "modelica",
        code: doc.getText(),
        diagnostics,
      },
    });
  }

  public override dispose(): void {
    AiCopilotPanel.currentPanel = undefined;
    super.dispose();
  }
}
