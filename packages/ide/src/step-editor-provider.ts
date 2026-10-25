// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export class StepEditorProvider extends BaseCustomEditorProvider {
  static readonly viewType = "modelscript.stepEditor";

  constructor(
    context: vscode.ExtensionContext,
    private readonly _client: LanguageClient,
  ) {
    super(context);
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.configureWebview(webviewPanel);

    let disposed = false;
    webviewPanel.webview.html = this.getHtmlShell(webviewPanel.webview, {
      title: "3D CAD Viewer (STEP)",
      scriptName: "step-webview.js",
    });

    const loadMeshes = async (retries = 3, delayMs = 500) => {
      if (disposed) return;
      try {
        webviewPanel.webview.postMessage({ type: "setLoading", data: true });
        const stepMeshes = await this._client.sendRequest<unknown[]>("modelscript/getStepMeshes", {
          uri: document.uri.toString(),
          documentText: document.getText(),
        });

        if (!disposed) {
          webviewPanel.webview.postMessage({ type: "stepMeshes", data: stepMeshes });
          webviewPanel.webview.postMessage({ type: "setLoading", data: false });
        }

        // If no meshes loaded and we have retries left, wait and try again
        // (LSP may still be parsing the STEP file)
        if ((!stepMeshes || (stepMeshes as unknown[]).length === 0) && retries > 0 && !disposed) {
          setTimeout(() => loadMeshes(retries - 1, delayMs * 2), delayMs);
        }
      } catch (e) {
        console.warn("[STEP Editor] Failed to get STEP meshes:", e);
        if (!disposed) {
          webviewPanel.webview.postMessage({ type: "setLoading", data: false });
        }
        if (retries > 0 && !disposed) {
          setTimeout(() => loadMeshes(retries - 1, delayMs * 2), delayMs);
        }
      }
    };

    const msgSubscription = webviewPanel.webview.onDidReceiveMessage((message) => {
      switch (message.type || message.command) {
        case "ready":
          loadMeshes();
          break;
        case "cadFeatureSelected":
          vscode.window.showInformationMessage(`Selected CAD Feature ID: ${message.id}`);
          break;
        case "generateMultiBody":
          vscode.commands.executeCommand("modelscript.generateMultiBody");
          break;
      }
    });

    // When the LSP finishes indexing anything, reload meshes in case our STEP file was just processed
    const treeSubscription = this._client.onNotification("modelscript/projectTreeChanged", () => {
      loadMeshes(1, 0); // No retries needed here, it's already an update
    });

    const changeSubscription = this.subscribeDocumentChanges(document, () => {
      loadMeshes(1, 0);
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      msgSubscription.dispose();
      treeSubscription.dispose();
      changeSubscription.dispose();
    });
  }
}
