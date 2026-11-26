// SPDX-License-Identifier: AGPL-3.0-or-later

import { DiagramMethods, type DiagramEditAction } from "@modelscript/diagram/protocol";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { BaseWebviewPanel } from "./webview/base-panel.js";
import { attachExtensionWebviewBridge } from "./webview/shared/extension-lsp-bridge.js";

/**
 * 3D / VR Spatial Diagram Stage panel powered by `@modelscript/editor`'s
 * `EngineeringRotunda` + `SpatialDiagramStage` + `MatrixStockroom3D`.
 * Works for any Modelica or polyglot engineering file (not limited to `.mscanvas`).
 */
export class SpatialDiagramPanel extends BaseWebviewPanel {
  public static currentPanel: SpatialDiagramPanel | undefined;
  public static readonly viewType = "modelscript.spatialDiagram3D";

  private readonly client?: LanguageClient | undefined;
  private document: vscode.TextDocument;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, document?: vscode.TextDocument): void {
    const activeDoc = document ?? vscode.window.activeTextEditor?.document;
    if (!activeDoc) {
      vscode.window.showWarningMessage("Open a model file to launch the 3D Spatial Diagram Stage.");
      return;
    }

    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
    const title = activeDoc.uri.path.split("/").pop() ?? "Spatial Diagram 3D";

    if (SpatialDiagramPanel.currentPanel) {
      SpatialDiagramPanel.currentPanel.document = activeDoc;
      SpatialDiagramPanel.currentPanel._panel.title = `3D Stage: ${title}`;
      SpatialDiagramPanel.currentPanel._panel.reveal(column);
      void SpatialDiagramPanel.currentPanel.syncDiagram();
      return;
    }

    const panel = vscode.window.createWebviewPanel(SpatialDiagramPanel.viewType, `3D Stage: ${title}`, column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
    });

    SpatialDiagramPanel.currentPanel = new SpatialDiagramPanel(panel, extensionUri, client, activeDoc);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client: LanguageClient | undefined,
    document: vscode.TextDocument,
  ) {
    super(panel, extensionUri);
    this.client = client;
    this.document = document;

    this._panel.webview.html = this.getHtmlShell({
      title: `3D Stage: ${document.uri.path.split("/").pop() ?? "Model"}`,
      scriptName: "spatial-diagram-webview.js",
    });

    const bridgeSub = attachExtensionWebviewBridge(this._panel.webview, {
      client: this.client,
      getDocument: () => this.document,
      title: document.uri.path.split("/").pop() ?? "Spatial Diagram",
      languageId: document.languageId,
      onUnhandledMessage: async (msg) => {
        if (msg.type === "ready") {
          await this.syncDiagram();
          return;
        }
        if (msg.type === "closeSpatialStage") {
          this.dispose();
          return;
        }
        if (msg.type === "applyDiagramActions" && Array.isArray(msg["actions"])) {
          await this.applyDiagramActions(msg["actions"] as DiagramEditAction[]);
        }
      },
    });
    this._disposables.push(bridgeSub);

    const docSub = vscode.workspace.onDidChangeTextDocument((ev) => {
      if (ev.document.uri.toString() === this.document.uri.toString()) {
        void this.syncDiagram();
      }
    });
    this._disposables.push(docSub);
  }

  private async syncDiagram(): Promise<void> {
    const uri = this.document.uri.toString();
    const title = this.document.uri.path.split("/").pop() ?? "Model";
    let diagramData: { nodes?: unknown[]; edges?: unknown[] } | undefined;

    if (this.client) {
      try {
        const res = await this.client.sendRequest<{ nodes?: unknown[]; edges?: unknown[] }>(DiagramMethods.getData, {
          uri,
        });
        if (res && (Array.isArray(res.nodes) || Array.isArray(res.edges))) {
          diagramData = res;
        }
      } catch {
        // Fallback to empty diagram nodes; source code still renders in VR code panel
      }
    }

    void this._panel.webview.postMessage({
      type: "spatialDiagramData",
      data: {
        title,
        languageId: this.document.languageId || "modelica",
        sourceCode: this.document.getText(),
        documentUri: uri,
        diagramData,
      },
    });
  }

  private async applyDiagramActions(actions: DiagramEditAction[]): Promise<void> {
    if (!this.client || actions.length === 0) return;
    try {
      const response = await this.client.sendRequest<{
        edits?: Array<{
          range: { start: { line: number; character: number }; end: { line: number; character: number } };
          newText: string;
        }>;
      }>(DiagramMethods.applyEdits, {
        uri: this.document.uri.toString(),
        actions,
      });

      if (response?.edits && response.edits.length > 0) {
        const wsEdit = new vscode.WorkspaceEdit();
        for (const edit of response.edits) {
          const range = new vscode.Range(
            new vscode.Position(edit.range.start.line, edit.range.start.character),
            new vscode.Position(edit.range.end.line, edit.range.end.character),
          );
          wsEdit.replace(this.document.uri, range, edit.newText);
        }
        await vscode.workspace.applyEdit(wsEdit);
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to apply 3D spatial diagram edit: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  public override dispose(): void {
    SpatialDiagramPanel.currentPanel = undefined;
    super.dispose();
  }
}
