// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DiagramMethods,
  type ComponentPropertyData,
  type DiagramApplyEditsResult,
  type DiagramEditAction,
  type DiagramPalette,
} from "@modelscript/diagram/protocol";
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
  private editSeq = 0;
  private activeDiagramType: string | undefined;
  private activeClassName: string | undefined;

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
          await this.syncPalette();
          return;
        }
        if (msg.type === "closeSpatialStage") {
          this.dispose();
          return;
        }
        if (msg.type === "applyDiagramActions" && Array.isArray(msg["actions"])) {
          await this.applyDiagramActions(msg["actions"] as DiagramEditAction[]);
          return;
        }
        if (msg.type === "undo") {
          await vscode.commands.executeCommand("undo");
          return;
        }
        if (msg.type === "redo") {
          await vscode.commands.executeCommand("redo");
          return;
        }
        if (msg.type === "getProperties" && typeof msg["componentName"] === "string") {
          await this.fetchComponentProperties(msg["componentName"]);
          return;
        }
        if (msg.type === "changeDiagramType" && typeof msg["diagramType"] === "string") {
          this.activeDiagramType = msg["diagramType"];
          await this.syncDiagram();
          return;
        }
        if (msg.type === "drillDown" && typeof msg["nodeId"] === "string" && this.client) {
          try {
            const res = await this.client.sendRequest<{
              targetUri?: string;
              targetClassName?: string;
            } | null>(DiagramMethods.drillDown, {
              uri: this.document.uri.toString(),
              nodeId: msg["nodeId"],
              componentName: msg["nodeId"],
            });
            if (res?.targetClassName) {
              this.activeClassName = res.targetClassName;
              await this.syncDiagram();
            } else if (res?.targetUri) {
              const targetDoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(res.targetUri));
              this.document = targetDoc;
              this.activeClassName = undefined;
              await this.syncDiagram();
              await this.syncPalette();
            }
          } catch {
            // ignore drill-down errors for leaf components
          }
          return;
        }
        if (msg.type === "revealSource" && typeof msg["nodeId"] === "string") {
          const text = this.document.getText();
          const idx = text.indexOf(msg["nodeId"]);
          if (idx >= 0) {
            const pos = this.document.positionAt(idx);
            const editor = await vscode.window.showTextDocument(this.document, vscode.ViewColumn.One, true);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          }
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

  private async readSidecarContent(): Promise<string | undefined> {
    const base = this.document.uri.toString();
    const candidates = [`${base}.layout.json`, `${base}.layout`];
    for (const candidate of candidates) {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(candidate));
        return new TextDecoder().decode(bytes);
      } catch {
        // sidecar does not exist
      }
    }
    return undefined;
  }

  private async syncPalette(): Promise<void> {
    if (!this.client) return;
    try {
      const palette = await this.client.sendRequest<DiagramPalette | null>(DiagramMethods.getPalette, {
        uri: this.document.uri.toString(),
      });
      if (palette) {
        void this._panel.webview.postMessage({ type: "spatialPalette", palette });
      }
    } catch {
      // fallback to default stockroom catalog
    }
  }

  private async fetchComponentProperties(componentName: string): Promise<void> {
    if (!this.client) return;
    try {
      const props = await this.client.sendRequest<ComponentPropertyData | null>(DiagramMethods.getComponentProperties, {
        uri: this.document.uri.toString(),
        componentName,
        ...(this.activeClassName ? { className: this.activeClassName } : {}),
      });
      void this._panel.webview.postMessage({
        type: "spatialComponentProperties",
        componentName,
        properties: props,
      });
    } catch {
      // ignore property lookup errors
    }
  }

  private async syncDiagram(): Promise<void> {
    const uri = this.document.uri.toString();
    const title = this.document.uri.path.split("/").pop() ?? "Model";
    let diagramData:
      | {
          nodes?: unknown[];
          edges?: unknown[];
          availableViews?: { id: string; label: string }[];
        }
      | undefined;

    if (this.client) {
      try {
        const sidecarContent = await this.readSidecarContent();
        const res = await this.client.sendRequest<{
          nodes?: unknown[];
          edges?: unknown[];
          availableViews?: { id: string; label: string }[];
        }>(DiagramMethods.getData, {
          uri,
          documentText: this.document.getText(),
          ...(this.activeClassName ? { className: this.activeClassName } : {}),
          ...(this.activeDiagramType ? { diagramType: this.activeDiagramType } : {}),
          ...(sidecarContent ? { sidecarContent } : {}),
        });
        if (res && (Array.isArray(res.nodes) || Array.isArray(res.edges))) {
          diagramData = res;
        }
      } catch {
        // Fallback to empty diagram nodes; source code still renders in VR code panel
      }
    }

    const diagnostics = vscode.languages.getDiagnostics(this.document.uri).map((d) => ({
      severity:
        d.severity === vscode.DiagnosticSeverity.Error
          ? ("error" as const)
          : d.severity === vscode.DiagnosticSeverity.Warning
            ? ("warning" as const)
            : ("info" as const),
      line: d.range.start.line + 1,
      message: d.message,
    }));

    void this._panel.webview.postMessage({
      type: "spatialDiagramData",
      data: {
        title,
        languageId: this.document.languageId || "modelica",
        diagramType: this.activeDiagramType,
        sourceCode: this.document.getText(),
        documentUri: uri,
        diagramData,
        diagnostics,
      },
    });
  }

  private async applyDiagramActions(actions: DiagramEditAction[]): Promise<void> {
    if (!this.client || actions.length === 0) return;
    try {
      const response = await this.client.sendRequest<DiagramApplyEditsResult | null>(DiagramMethods.applyEdits, {
        uri: this.document.uri.toString(),
        seq: ++this.editSeq,
        ...(this.activeClassName ? { className: this.activeClassName } : {}),
        ...(this.activeDiagramType ? { diagramType: this.activeDiagramType } : {}),
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

      if (response?.sidecarUri && typeof response.sidecarContent === "string") {
        const sidecarUri = vscode.Uri.parse(response.sidecarUri);
        await vscode.workspace.fs.writeFile(sidecarUri, new TextEncoder().encode(response.sidecarContent));
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
