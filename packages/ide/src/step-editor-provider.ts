// SPDX-License-Identifier: AGPL-3.0-or-later

import { extractStepGdtOverlay } from "@modelscript/cad";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import type { StepCompilationService, StepOverlayPayload } from "./services/step-compilation-service.js";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export interface StepEditorClient {
  sendRequest<R = unknown>(method: string, params?: unknown): Promise<R>;
  onNotification(type: string, handler: (...args: unknown[]) => void): vscode.Disposable;
}

export class StepEditorProvider extends BaseCustomEditorProvider {
  static readonly viewType = "modelscript.stepEditor";

  constructor(
    context: vscode.ExtensionContext,
    private readonly _client: LanguageClient | StepEditorClient,
    private readonly _compilationService?: StepCompilationService,
  ) {
    super(context);
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.configureWebview(webviewPanel);

    let disposed = false;
    let lastRenderedStepText: string | undefined;
    const docUriKey = document.uri.toString();
    const openViewerRegistration = this._compilationService?.registerOpenStepViewer(document.uri);

    webviewPanel.webview.html = this.getHtmlShell(webviewPanel.webview, {
      title: "3D CAD Viewer (STEP)",
      scriptName: "step-webview.js",
    });

    const resolveOverlay = async (stepText: string): Promise<StepOverlayPayload> => {
      if (this._compilationService) {
        return this._compilationService.resolveStepOverlay(document.uri, stepText);
      }
      return {
        compiledFromOptionA: false,
        stepUri: docUriKey,
        gdtOverlay: extractStepGdtOverlay(stepText),
        spools: [],
      };
    };

    const loadMeshes = async (retries = 3, delayMs = 500, stepTextOverride?: string, force = false): Promise<void> => {
      if (disposed) return;
      const stepText = stepTextOverride ?? document.getText();
      if (!force && stepTextOverride !== undefined && lastRenderedStepText === stepText) {
        return;
      }
      lastRenderedStepText = stepText;

      try {
        webviewPanel.webview.postMessage({ type: "setLoading", data: true });
        const [stepMeshes, overlay] = await Promise.all([
          (this._client as StepEditorClient).sendRequest<unknown[]>("modelscript/getStepMeshes", {
            uri: docUriKey,
            documentText: stepText,
          }),
          resolveOverlay(stepText),
        ]);

        if (!disposed) {
          webviewPanel.webview.postMessage({ type: "stepMeshes", data: stepMeshes });
          webviewPanel.webview.postMessage({ type: "stepOverlay", data: overlay });
          webviewPanel.webview.postMessage({ type: "setLoading", data: false });
        }

        // If no meshes loaded and we have retries left, wait and try again
        // (LSP may still be parsing the STEP file)
        if ((!stepMeshes || stepMeshes.length === 0) && retries > 0 && !disposed) {
          setTimeout(() => void loadMeshes(retries - 1, delayMs * 2, stepTextOverride, true), delayMs);
        }
      } catch (e) {
        console.warn("[STEP Editor] Failed to get STEP meshes:", e);
        if (!disposed) {
          try {
            const fallbackOverlay = await resolveOverlay(stepText);
            webviewPanel.webview.postMessage({ type: "stepOverlay", data: fallbackOverlay });
          } catch {
            // ignore overlay fallback failure
          }
          webviewPanel.webview.postMessage({ type: "setLoading", data: false });
        }
        if (retries > 0 && !disposed) {
          setTimeout(() => void loadMeshes(retries - 1, delayMs * 2, stepTextOverride, true), delayMs);
        }
      }
    };

    const msgSubscription = webviewPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type || message.command) {
        case "ready":
          await loadMeshes(3, 500, undefined, true);
          break;
        case "openSource": {
          let targetUri: vscode.Uri | undefined =
            typeof message.uri === "string" && message.uri ? vscode.Uri.parse(message.uri) : undefined;
          if (!targetUri && this._compilationService) {
            const pair = await this._compilationService.resolvePairedStepSources(document.uri);
            targetUri = message.role === "qif" ? pair.qifUri : message.role === "mo" ? pair.modelicaUri : pair.scadUri;
          }
          if (targetUri) {
            const sourceDoc = await vscode.workspace.openTextDocument(targetUri);
            await vscode.window.showTextDocument(sourceDoc, { preview: false });
          }
          break;
        }
        case "recompileStep": {
          if (!this._compilationService) break;
          webviewPanel.webview.postMessage({ type: "setLoading", data: true });
          const compiled = await this._compilationService.compileStepFromUri(document.uri);
          if (!compiled && !disposed) {
            webviewPanel.webview.postMessage({ type: "setLoading", data: false });
          }
          break;
        }
        case "cadFeatureSelected":
          vscode.window.showInformationMessage(`Selected CAD Feature ID: ${message.id}`);
          break;
        case "generateMultiBody":
          vscode.commands.executeCommand("modelscript.generateMultiBody", document.uri);
          break;
        case "generateFeaMesh":
          vscode.commands.executeCommand("modelscript.generateFeaMesh", document.uri);
          break;
        case "generateCfdMesh":
          vscode.commands.executeCommand("modelscript.generateCfdMesh", document.uri);
          break;
      }
    });

    // When the LSP finishes indexing anything, reload meshes in case our STEP file was just processed
    const treeSubscription = this._client.onNotification("modelscript/projectTreeChanged", () => {
      void loadMeshes(1, 0, undefined, true);
    });

    const changeSubscription = this.subscribeDocumentChanges(document, () => {
      const nextText = document.getText();
      if (lastRenderedStepText === nextText) return;
      void loadMeshes(1, 0, nextText, true);
    });

    const compileSubscription = this._compilationService?.onDidCompileStep((meta) => {
      if (meta.stepUri === docUriKey || vscode.Uri.parse(meta.stepUri).path === document.uri.path) {
        void loadMeshes(1, 0, meta.stepText, true);
      }
    });

    const overlaySubscription = this._compilationService?.onDidRefreshOverlay((overlay) => {
      if (
        !disposed &&
        (overlay.stepUri === docUriKey || vscode.Uri.parse(overlay.stepUri).path === document.uri.path)
      ) {
        webviewPanel.webview.postMessage({ type: "stepOverlay", data: overlay });
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      msgSubscription.dispose();
      treeSubscription.dispose();
      changeSubscription.dispose();
      compileSubscription?.dispose();
      overlaySubscription?.dispose();
      openViewerRegistration?.dispose();
    });
  }
}
