// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createCanonicalPolyglotDemoBoard,
  deserializeCanvasDocument,
  exportCanvasToSspXml,
  serializeCanvasDocument,
  type CanvasDocument,
} from "@modelscript/canvas";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { openExternalVrRotunda } from "./vr-handoff.js";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

/**
 * VS Code / Ansatz Studio Custom Editor for `.mscanvas` Polyglot Infinite Spatial Canvas files.
 *
 * Keeps the underlying `.mscanvas` JSON TextDocument bidirectionally synchronized
 * with the interactive SpatialCanvas webview and supports exporting FMI topologies to `.ssd` (SSP 1.0).
 */
export class CanvasEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.spatialCanvas";

  constructor(
    context: vscode.ExtensionContext,
    private readonly _client?: LanguageClient,
  ) {
    super(context);
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.configureWebview(webviewPanel);

    webviewPanel.webview.html = this.getHtmlShell(webviewPanel.webview, {
      title: "Polyglot Spatial Canvas",
      scriptName: "canvas-webview.js",
    });

    const parseCurrentDocument = (): CanvasDocument => {
      const raw = document.getText().trim();
      if (!raw) {
        return createCanonicalPolyglotDemoBoard();
      }
      try {
        return deserializeCanvasDocument(raw);
      } catch {
        return createCanonicalPolyglotDemoBoard();
      }
    };

    const pushDocumentToWebview = () => {
      const board = parseCurrentDocument();
      void webviewPanel.webview.postMessage({ type: "loadDocument", document: board });
    };

    const docChangeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        pushDocumentToWebview();
      }
    });

    const threadSub = this._client?.onNotification("modelscript/threadStatusChanged", (event) => {
      void webviewPanel.webview.postMessage({ type: "threadStatusChanged", event });
    });

    const msgSub = webviewPanel.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
      switch (msg["type"]) {
        case "ready": {
          pushDocumentToWebview();
          break;
        }
        case "saveDocument": {
          const nextDoc = msg["document"] as CanvasDocument | undefined;
          if (!nextDoc) break;
          const serialized = serializeCanvasDocument(nextDoc);
          if (serialized === document.getText()) break;

          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
          edit.replace(document.uri, fullRange, serialized);
          await vscode.workspace.applyEdit(edit);
          break;
        }
        case "exportSsp": {
          const board = parseCurrentDocument();
          const xml = exportCanvasToSspXml(board);
          const targetUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`${board.id}.ssd`),
            filters: { "SSP System Structure Description": ["ssd", "xml"] },
          });
          if (targetUri) {
            await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(xml));
            vscode.window.showInformationMessage(`Exported SSP 1.0 topology to ${targetUri.fsPath}`);
          }
          break;
        }
        case "openArtifact": {
          const artifactUri = msg["artifactUri"];
          if (typeof artifactUri === "string" && vscode.workspace.workspaceFolders?.[0]) {
            const fullUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, artifactUri);
            try {
              const textDoc = await vscode.workspace.openTextDocument(fullUri);
              await vscode.window.showTextDocument(textDoc, { viewColumn: vscode.ViewColumn.Beside });
            } catch {
              vscode.window.showWarningMessage(`Could not open artifact '${artifactUri}'.`);
            }
          }
          break;
        }
        case "surfaceModeChanged": {
          if (msg["mode"] === "webxr-vr") {
            const board = (msg["document"] as CanvasDocument | undefined) ?? parseCurrentDocument();
            const environment = typeof msg["environment"] === "string" ? msg["environment"] : "dark-lab";
            await openExternalVrRotunda({
              mode: "webxr-vr",
              environment,
              boardJson: serializeCanvasDocument(board),
              title: typeof msg["title"] === "string" ? msg["title"] : board.name,
              artifactUri: document.uri.toString(),
            });
          }
          break;
        }
        case "openInVr": {
          const board = (msg["document"] as CanvasDocument | undefined) ?? parseCurrentDocument();
          const environment = typeof msg["environment"] === "string" ? msg["environment"] : "dark-lab";
          const activeModelIndex = typeof msg["activeModelIndex"] === "number" ? msg["activeModelIndex"] : undefined;
          await openExternalVrRotunda({
            mode: "webxr-vr",
            environment,
            boardJson: serializeCanvasDocument(board),
            title: typeof msg["title"] === "string" ? msg["title"] : board.name,
            artifactUri: typeof msg["artifactUri"] === "string" ? msg["artifactUri"] : document.uri.toString(),
            activeModelIndex,
          });
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      docChangeSub.dispose();
      threadSub?.dispose();
      msgSub.dispose();
    });
  }
}
