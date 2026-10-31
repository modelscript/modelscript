// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Manages the Custom Text Editor representing the Modelica Diagram View.
// Communicates with the LSP server via the LanguageClient to get diagram data,
// and posts it to the webview for X6 rendering.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { getNonce } from "./utils/nonce.js";

/** JSON-RPC method constants for the unified Diagram API protocol. */
const DiagramMethods = {
  getData: "modelscript/diagram.getData",
  applyEdits: "modelscript/diagram.applyEdits",
  getComponentProperties: "modelscript/diagram.getComponentProperties",
} as const;

/**
 * Custom text editor provider that renders interactive graphical schematic diagrams
 * (Modelica, SysML v2, SSP, PSCAD) synchronized bi-directionally with source text.
 */
export class DiagramEditorProvider implements vscode.CustomTextEditorProvider {
  /** Custom editor view type identifier registered with VS Code. */
  public static readonly viewType = "modelscript.diagram";

  /** Set of currently open diagram webview panels across the workspace. */
  public readonly activeWebviews = new Set<vscode.WebviewPanel>();
  /** Optional callback invoked when a document is opened in the diagram editor. */
  public onDidOpenDocument?: ((uri: string) => void) | undefined;

  /** Singleton instance of the provider */
  public static instance: DiagramEditorProvider | undefined;

  /** Post simulation telemetry data to all active diagram webviews for a URI */

  public static postSimulationData(uri: string, simData: unknown): void {
    if (!DiagramEditorProvider.instance) return;
    DiagramEditorProvider.instance.postToActiveWebviews({
      type: "simulationData",
      uri,
      data: simData,
    });
  }

  /**
   * Initializes the diagram editor provider and registers the `modelscript.autoLayout` command.
   */
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: LanguageClient,
  ) {
    DiagramEditorProvider.instance = this;
    context.subscriptions.push(
      vscode.commands.registerCommand("modelscript.autoLayout", () => {
        for (const panel of this.activeWebviews) {
          if (panel.active) {
            panel.webview.postMessage({ type: "autoLayout" });
          }
        }
      }),
    );
  }

  /** Post a message to all active diagram webviews */

  public postToActiveWebviews(message: unknown): void {
    for (const panel of this.activeWebviews) {
      panel.webview.postMessage(message);
    }
  }

  /** Post a message to all active diagram webviews except the sender */

  public postToActiveWebviewsExcept(sourcePanel: vscode.WebviewPanel, message: unknown): void {
    for (const panel of this.activeWebviews) {
      if (panel !== sourcePanel) {
        panel.webview.postMessage(message);
      }
    }
  }

  /**
   * Resolves a custom text editor by binding the webview lifecycle, message handlers,
   * and incremental document synchronization to the backing `vscode.TextDocument`.
   */
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,

    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    };

    this.activeWebviews.add(webviewPanel);
    webviewPanel.onDidDispose(() => {
      this.activeWebviews.delete(webviewPanel);
    });

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    // Tracks the kind of edit that was just applied to the document.
    let pendingRenderHint: "none" | "immediate" | "debounced" | null = null;
    let updateTimeout: ReturnType<typeof setTimeout> | null = null;
    let diagramRequestNonce = 0;
    const uriString = document.uri.toString();
    this.onDidOpenDocument?.(uriString);
    const languageId =
      document.languageId && document.languageId !== "" ? document.languageId : uriString.split(".").pop() || "generic";
    let currentDiagramType = "All";
    let currentClassName: string | undefined = undefined;
    let diagramEditQueue = Promise.resolve();
    let isSpatialEditPending = false;
    let lastOptimisticEditTime = 0;
    let isAddComponentPending = false;
    let hasRenderedDiagramOnce = false;
    // True when a text-change-triggered update has been scheduled (debounced or immediate).
    // Prevents projectTreeChanged from scheduling a redundant second rebuild.
    let textChangeUpdatePending = false;

    /** Immediately request fresh diagram data (cancels any pending debounced request). */
    const immediateUpdate = (showLoading = false) => {
      if (updateTimeout) clearTimeout(updateTimeout);
      updateTimeout = null;
      textChangeUpdatePending = false;
      diagramRequestNonce++;
      const currentNonce = diagramRequestNonce;
      if (showLoading || !hasRenderedDiagramOnce) {
        webviewPanel.webview.postMessage({ type: "loading" });
      }
      this.requestDiagramData(
        webviewPanel,
        uriString,
        currentDiagramType,
        currentClassName,
        { isCanceled: () => diagramRequestNonce !== currentNonce },
        () => {
          hasRenderedDiagramOnce = true;
        },
      );
    };

    /** Request diagram data after a debounce (for external text changes like user typing). */
    const debouncedUpdate = (delayMs = 500, showLoading = false) => {
      if (updateTimeout) clearTimeout(updateTimeout);
      updateTimeout = setTimeout(() => {
        textChangeUpdatePending = false;
        diagramRequestNonce++;
        const currentNonce = diagramRequestNonce;
        if (showLoading || !hasRenderedDiagramOnce) {
          webviewPanel.webview.postMessage({ type: "loading" });
        }
        this.requestDiagramData(
          webviewPanel,
          uriString,
          currentDiagramType,
          currentClassName,
          { isCanceled: () => diagramRequestNonce !== currentNonce },
          () => {
            hasRenderedDiagramOnce = true;
          },
        );
      }, delayMs);
    };

    const applyTextEdits = async (uri: string, edits: vscode.TextEdit[]) => {
      const workspaceEdit = new vscode.WorkspaceEdit();
      const parsedUri = vscode.Uri.parse(uri);
      for (const edit of edits) {
        workspaceEdit.replace(parsedUri, edit.range, edit.newText);
      }
      // Apply the edit without saving the file so the CustomEditor tracks dirty state
      await vscode.workspace.applyEdit(workspaceEdit);
    };

    /**
     * Wait for the next `onDidChangeTextDocument` event for our document,
     * with a safety timeout. Replaces the old `setTimeout(50)` hack.
     *
     * Returns a promise that resolves once the change event fires (and
     * the `pendingRenderHint` is consumed by the change handler), or
     * after `timeoutMs` if the event never fires (e.g., text didn't
     * actually change despite edits, or the event was dropped).
     */
    let pendingDocChangeResolve: (() => void) | null = null;
    const waitForDocumentChange = (timeoutMs = 200): Promise<void> => {
      return new Promise<void>((resolve) => {
        pendingDocChangeResolve = resolve;
        setTimeout(() => {
          // Safety: if the event hasn't fired by now, resolve anyway
          if (pendingDocChangeResolve === resolve) {
            pendingDocChangeResolve = null;
            resolve();
          }
        }, timeoutMs);
      });
    };

    // Listen for messages from the webview (diagram mutations)
    webviewPanel.webview.onDidReceiveMessage(
      (message) => {
        try {
          let actions: ({ type: string } & Record<string, unknown>)[] | undefined;

          switch (message.type) {
            case "move":
              actions = [{ type: "move", items: message.items }];
              break;
            case "resize":
              actions = [
                {
                  type: "resize",
                  item: {
                    name: message.name,
                    x: message.x,
                    y: message.y,
                    width: message.width,
                    height: message.height,
                    rotation: message.rotation,
                    edges: message.edges,
                  },
                },
              ];
              break;
            case "connect":
              actions = [{ type: "connect", source: message.source, target: message.target, points: message.points }];
              break;
            case "reconnect":
              actions = [
                {
                  type: "reconnect",
                  oldSource: message.oldSource,
                  oldTarget: message.oldTarget,
                  newSource: message.newSource,
                  newTarget: message.newTarget,
                  points: message.points,
                },
              ];
              break;
            case "moveEdge":
            case "edgeMove":
              actions = [{ type: "moveEdge", edges: message.edges }];
              break;
            case "disconnect":
            case "deleteEdge":
              actions = [{ type: "disconnect", source: message.source, target: message.target }];
              break;
            case "deleteComponents":
              actions = [{ type: "deleteComponents", names: message.names }];
              break;
            case "drop":
            case "addComponent":
              actions = [{ type: "addComponent", className: message.className, x: message.x, y: message.y }];
              isAddComponentPending = true;
              break;
            case "updateName":
              actions = [{ type: "updateName", oldName: message.oldName, newName: message.newName }];
              break;
            case "updateDescription":
              actions = [{ type: "updateDescription", name: message.name, description: message.description }];
              break;
            case "updateParameter":
              actions = [
                { type: "updateParameter", name: message.name, parameter: message.parameter, value: message.value },
              ];
              break;
            case "updateProperty":
              actions = [
                {
                  type: "updateProperty",
                  name: message.name,
                  key: message.key,
                  value: message.value,
                  previousValue: message.previousValue,
                },
              ];
              break;
            case "rotate":
              actions = [{ type: "rotate", item: { name: message.name, rotation: message.rotation } }];
              break;
            case "toggleDisable":
              actions = [{ type: "toggleDisable", name: message.name, disabled: message.disabled }];
              break;
            case "toggleBreakerState":
              actions = [
                {
                  type: "updateParameter",
                  name: message.name,
                  parameter: "Status",
                  value: message.targetStatus,
                },
              ];
              vscode.commands.executeCommand("modelscript.diagram.simulate", document.uri);
              break;
            case "openLineGeometryEditor":
              vscode.commands.executeCommand("modelscript.openLineGeometryEditor", {
                uri: document.uri.toString(),
                componentName: message.name,
                defn: message.defn,
                params: message.parameters,
              });
              break;
            case "applyLineParameters":
              if (message.params && message.componentName) {
                actions = [
                  {
                    type: "updateParameter",
                    name: message.componentName,
                    parameter: "R",
                    value: message.params.R.toFixed(5),
                  },
                  {
                    type: "updateParameter",
                    name: message.componentName,
                    parameter: "L",
                    value: message.params.L.toFixed(6),
                  },
                  {
                    type: "updateParameter",
                    name: message.componentName,
                    parameter: "C",
                    value: message.params.C.toExponential(4),
                  },
                  {
                    type: "updateParameter",
                    name: message.componentName,
                    parameter: "length",
                    value: message.params.length.toFixed(1),
                  },
                ];
              }
              break;
            case "runSimulation":
              vscode.commands.executeCommand("modelscript.diagram.simulate", document.uri);
              break;
            case "diagramEdit": {
              // Direct batch from the webview (already in actions format)
              actions = message.actions;
              const isOptimistic = actions?.every(
                (a) =>
                  a.type === "move" ||
                  a.type === "resize" ||
                  a.type === "rotate" ||
                  a.type === "toggleDisable" ||
                  a.type === "moveEdge" ||
                  a.type === "updateParameter" ||
                  a.type === "updateProperty",
              );
              if (!isOptimistic) {
                const hasLocalPlaceholder = actions?.some((a) => a.type === "addComponent");
                if (hasLocalPlaceholder) {
                  isAddComponentPending = true;
                } else {
                  webviewPanel.webview.postMessage({ type: "loading" }); // Show spinner only for semantic/structural edits
                }
              }
              break;
            }
            case "changeDiagramType": {
              currentDiagramType = message.diagramType;
              immediateUpdate(true);
              break;
            }
            case "collabMessage": {
              this.postToActiveWebviewsExcept(webviewPanel, {
                type: "collabMessage",
                data: message.data,
              });
              break;
            }
            case "undo": {
              vscode.commands.executeCommand("undo").then(() => immediateUpdate(false));
              break;
            }
            case "redo": {
              vscode.commands.executeCommand("redo").then(() => immediateUpdate(false));
              break;
            }
            case "getProperties": {
              // On-demand property loading: fetch expensive data (parameters, docs, icon)
              // only when the user clicks a component node
              this.client
                .sendRequest(DiagramMethods.getComponentProperties, {
                  uri: uriString,
                  componentName: message.componentName,
                })
                .then((props) => {
                  webviewPanel.webview.postMessage({
                    type: "componentProperties",
                    componentName: message.componentName,
                    properties: props,
                  });
                })
                .catch((e) => {
                  console.error("[diagram] Error fetching component properties:", e);
                  webviewPanel.webview.postMessage({
                    type: "componentProperties",
                    componentName: message.componentName,
                    properties: null,
                  });
                });
              break;
            }
            case "error":
              vscode.window.showInformationMessage(message.message);
              break;
            case "revealSource": {
              // Reveal the source location of a diagram element in the text editor.
              // The message contains byte offsets — we convert to Position using the document.
              const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uriString);
              if (doc && typeof message.startOffset === "number") {
                const startPos = doc.positionAt(message.startOffset);
                const endPos = doc.positionAt(message.endOffset ?? message.startOffset);
                const selection = new vscode.Range(startPos, endPos);
                const visibleEditor = vscode.window.visibleTextEditors.find(
                  (e) => e.document.uri.toString() === uriString,
                );
                // Only sync the selection when the source is already visible; a click on the
                // diagram must never open or split a new code editor.
                if (visibleEditor) {
                  visibleEditor.selection = new vscode.Selection(startPos, endPos);
                  visibleEditor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                }
              }
              break;
            }
            case "navigateTo": {
              // Cross-diagram navigation: switch diagram type and optionally focus a class / sub-module.
              // E.g., double-click a StateDefinition in BDD → open StateMachine diagram,
              // or click 'More on Passive Elements' in PSCAD library → drill down into Passive sub-module.
              if (message.className !== undefined) {
                currentClassName = message.className;
              }
              if (message.diagramType) {
                currentDiagramType = message.diagramType;
                // Update the diagram type dropdown in the webview
                webviewPanel.webview.postMessage({
                  type: "setDiagramType",
                  diagramType: message.diagramType,
                });
              }
              immediateUpdate();
              break;
            }
          }

          if (actions) {
            console.log("[diagramEditorProvider] received actions from webview:", actions);

            // Determine if this is a purely spatial edit (move/resize/edgeMove)
            // or a parameter-only edit (updateParameter). These don't change the
            // model topology — only annotation coordinates or modification values
            // change. They can be applied optimistically without showing a spinner
            // or triggering a diagram re-render.
            const isOptimisticOnly = actions.every(
              (a) =>
                a.type === "move" ||
                a.type === "resize" ||
                a.type === "rotate" ||
                a.type === "toggleDisable" ||
                a.type === "moveEdge" ||
                a.type === "updateParameter" ||
                a.type === "updateProperty",
            );

            interface ApplyEditsResponse {
              sidecarUri?: string | undefined;
              sidecarContent?: string | undefined;
              edits?: vscode.TextEdit[] | undefined;
              renderHint?: "none" | "immediate" | "debounced" | null | undefined;
            }

            if (isOptimisticOnly) {
              // ── Optimistic path: silent text update, no spinner, no re-render ──
              diagramEditQueue = diagramEditQueue
                .then(async () => {
                  const response = await this.client.sendRequest<ApplyEditsResponse | null>(DiagramMethods.applyEdits, {
                    uri: uriString,
                    seq: 1,
                    actions,
                  });

                  if (response?.sidecarUri && typeof response.sidecarContent === "string") {
                    try {
                      const sidecarUri = vscode.Uri.parse(response.sidecarUri);
                      await vscode.workspace.fs.writeFile(
                        sidecarUri,
                        new TextEncoder().encode(response.sidecarContent),
                      );
                    } catch (e) {
                      console.error("[diagram] Error writing sidecar layout:", e);
                    }
                  }

                  if (response?.edits && response.edits.length > 0) {
                    // Mark as optimistic so onDidChangeTextDocument skips re-render
                    pendingRenderHint = "none";
                    lastOptimisticEditTime = Date.now();
                    await applyTextEdits(uriString, response.edits);
                    // Wait for the document change event to fire and consume the hint
                    await waitForDocumentChange();
                    // Consume the hint if the change event didn't fire
                    if (pendingRenderHint !== null) {
                      pendingRenderHint = null;
                      isSpatialEditPending = true;
                      lastOptimisticEditTime = Date.now();
                    }
                  }
                })
                .catch((e) => {
                  console.error("[diagram] Error applying optimistic edit:", e);
                  pendingRenderHint = null;
                });
            } else {
              // ── Semantic path: full re-render cycle with spinner ──
              diagramRequestNonce++; // Cancel incoming stale diagramData
              if (actions.some((a) => a.type === "addComponent")) {
                isAddComponentPending = true;
              }
              diagramEditQueue = diagramEditQueue
                .then(async () => {
                  const response = await this.client.sendRequest<ApplyEditsResponse | null>(DiagramMethods.applyEdits, {
                    uri: uriString,
                    seq: 1,
                    actions,
                  });

                  console.log("[diagramEditorProvider] applyEdits LSP response:", response);

                  if (response?.sidecarUri && typeof response.sidecarContent === "string") {
                    try {
                      const sidecarUri = vscode.Uri.parse(response.sidecarUri);
                      await vscode.workspace.fs.writeFile(
                        sidecarUri,
                        new TextEncoder().encode(response.sidecarContent),
                      );
                    } catch (e) {
                      console.error("[diagram] Error writing sidecar layout:", e);
                    }
                  }

                  if (response && response.edits && response.edits.length > 0) {
                    pendingRenderHint = response.renderHint ?? null;
                    await applyTextEdits(uriString, response.edits);
                    // Wait for the document change event to fire and consume the render hint
                    await waitForDocumentChange();

                    // If the document change event didn't fire (e.g. text didn't change despite edits)
                    if (pendingRenderHint !== null) {
                      const hint = pendingRenderHint;
                      pendingRenderHint = null;
                      const showLoading = !isAddComponentPending;
                      isAddComponentPending = false;
                      if (hint === "immediate") immediateUpdate(showLoading);
                      else if (hint === "debounced") debouncedUpdate();
                      else webviewPanel.webview.postMessage({ type: "stopLoading" });
                    }
                  } else {
                    // No edits generated or response was null.
                    // We must trigger an update to clear the loading spinner which was shown when the request was canceled.
                    const showLoading = !isAddComponentPending;
                    isAddComponentPending = false;
                    if (response?.renderHint === "immediate") immediateUpdate(showLoading);
                    else if (response?.renderHint === "debounced") debouncedUpdate();
                    else webviewPanel.webview.postMessage({ type: "stopLoading" });
                  }
                })
                .catch((e) => {
                  console.error("[diagram] Error applying diagram edit:", e);
                  pendingRenderHint = null;
                  webviewPanel.webview.postMessage({ type: "stopLoading" }); // Always recover
                });
            }
          }
        } catch (e) {
          console.error("[diagram] Message handler error:", e);
          pendingRenderHint = null;
        }
      },
      undefined,
      this.context.subscriptions,
    );

    // React to text document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;

      const hint = pendingRenderHint;
      pendingRenderHint = null; // Consume the flag

      // Signal the waitForDocumentChange() promise that the event has fired
      if (pendingDocChangeResolve) {
        const resolve = pendingDocChangeResolve;
        pendingDocChangeResolve = null;
        resolve();
      }

      if (hint === "none") {
        // Spatial edit — no re-render needed natively.
        // We set this flag to skip the subsequent projectTreeChanged event
        // and hide the spinner once the semantic pipeline has completed validating the edit.
        isSpatialEditPending = true;
        lastOptimisticEditTime = Date.now();
        return;
      }

      isSpatialEditPending = false;

      if (hint === "immediate") {
        // Semantic edit — immediate refresh without full-page spinner if in-place bounce placeholder is active
        const hasPlaceholder = isAddComponentPending;
        isAddComponentPending = false;
        immediateUpdate(!hasPlaceholder);
        return;
      }
      if (hint === "debounced") {
        textChangeUpdatePending = true;
        debouncedUpdate();
        return;
      }
      // External change (user typing) — debounced refresh.
      // Mark that a text-change update is pending so projectTreeChanged
      // doesn't schedule a redundant second rebuild.
      lastOptimisticEditTime = 0;
      textChangeUpdatePending = true;
      debouncedUpdate();
    });

    // React to semantic pipeline completions from the language server
    const projectTreeListener = this.client.onNotification("modelscript/projectTreeChanged", () => {
      if (isSpatialEditPending || (lastOptimisticEditTime > 0 && Date.now() - lastOptimisticEditTime < 800)) {
        isSpatialEditPending = false;
        webviewPanel.webview.postMessage({ type: "stopLoading" }); // Hide spinner when edit finishes
        return;
      }
      // Skip if a text-change-triggered update is already pending —
      // it will fire soon and produce the same result without double work.
      if (textChangeUpdatePending) return;
      debouncedUpdate(100, false);
    });

    // Make sure we get rid of the listeners when our editor is closed.
    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      projectTreeListener.dispose();
    });

    // Initial load
    // Tell the webview the document language (enables diagram features/palette)
    webviewPanel.webview.postMessage({ type: "setLanguage", language: languageId });
    debouncedUpdate(50, true);
  }

  /**
   * Requests diagram layout and schematic data from the language server (reading any `.layout` sidecar file)
   * and posts the resulting diagram payload to the webview.
   */
  private async requestDiagramData(
    webviewPanel: vscode.WebviewPanel,
    uri: string,
    diagramType: string,
    className?: string,
    cancelToken?: { isCanceled: () => boolean },
    onSuccess?: () => void,
  ) {
    try {
      let sidecarContent: string | undefined;
      const candidates = [`${uri}.layout`];
      const lastDot = uri.lastIndexOf(".");
      if (lastDot !== -1) {
        candidates.push(`${uri.substring(0, lastDot)}.layout`);
      }
      for (const candidate of candidates) {
        try {
          const sidecarUri = vscode.Uri.parse(candidate);
          const bytes = await vscode.workspace.fs.readFile(sidecarUri);
          sidecarContent = new TextDecoder().decode(bytes);
          if (sidecarContent) break;
        } catch {
          // ignore if file doesn't exist
        }
      }

      const data = await this.client.sendRequest<{ isLoading?: boolean | undefined } & Record<string, unknown>>(
        DiagramMethods.getData,
        {
          uri,
          diagramType,
          className,
          sidecarContent,
        },
      );
      if (cancelToken?.isCanceled()) return;
      if (data) {
        if (data.isLoading) {
          webviewPanel.webview.postMessage({ type: "loading" });
          setTimeout(() => {
            if (!cancelToken?.isCanceled()) {
              this.requestDiagramData(webviewPanel, uri, diagramType, className, cancelToken);
            }
          }, 1500);
          return;
        }
        const isDark =
          vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
          vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
        webviewPanel.webview.postMessage({ type: "diagramData", data, isDark, className });
        onSuccess?.();
      } else {
        webviewPanel.webview.postMessage({ type: "empty" });
      }
    } catch (e) {
      if (cancelToken?.isCanceled()) return;
      console.error("[diagram] Failed to get diagram data:", e);
      webviewPanel.webview.postMessage({ type: "error", message: String(e) });
    }
  }

  /**
   * Generates the HTML document and CSP headers for the interactive diagram webview.
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "diagram.js"))
      .with({ query: `v=${Date.now()}` });
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data: ${webview.cspSource}; font-src ${webview.cspSource}; connect-src ${webview.cspSource};">
  <title>Modelica Diagram</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
    }
    #container {
      width: 100%;
      height: 100%;
    }
    #placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      color: var(--vscode-foreground, #ccc);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 14px;
      opacity: 0.6;
    }
    #spinner {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 36px;
      height: 36px;
      margin: -18px 0 0 -18px;
      border: 3px solid var(--vscode-editorGutter-background, rgba(128,128,128,0.2));
      border-top-color: var(--vscode-foreground, #ccc);
      border-radius: 50%;
      animation: diagram-spin 0.7s linear infinite;
      display: none;
      z-index: 1000;
    }
    #toolbar {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 100;
      display: flex;
      gap: 8px;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-widget-border, #454545);
      border-radius: 4px;
      padding: 4px 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 12px;
      align-items: center;
    }
    #toolbar select {
      background: var(--vscode-dropdown-background, #3c3c3c);
      color: var(--vscode-dropdown-foreground, #f0f0f0);
      border: 1px solid var(--vscode-dropdown-border, #3c3c3c);
      border-radius: 2px;
      padding: 2px 4px;
      font-size: 12px;
      outline: none;
    }
    #breadcrumb-bar {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 100;
      display: none;
      align-items: center;
      gap: 6px;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-widget-border, #454545);
      border-radius: 4px;
      padding: 4px 10px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 12px;
      color: var(--vscode-foreground, #ccc);
    }
    .breadcrumb-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      color: var(--vscode-textLink-foreground, #38bdf8);
      font-weight: 500;
      user-select: none;
    }
    .breadcrumb-item:hover {
      text-decoration: underline;
    }
    .breadcrumb-item.active {
      color: var(--vscode-foreground, #ccc);
      font-weight: 600;
      cursor: default;
      text-decoration: none;
    }
    .breadcrumb-separator {
      opacity: 0.5;
      font-size: 10px;
    }
    .breadcrumb-back-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      padding: 2px 8px;
      margin-left: 8px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    .breadcrumb-back-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
    @keyframes diagram-spin { to { transform: rotate(360deg); } }

    @keyframes drop-placeholder-pulse {
      0%, 100% { opacity: 0.6; transform: scale(1); }
      50% { opacity: 0.9; transform: scale(1.04); }
    }
    @keyframes drop-placeholder-bounce {
      0% { opacity: 0; transform: scale(0.2); }
      40% { opacity: 1; transform: scale(1.18); }
      65% { transform: scale(0.92); }
      85% { transform: scale(1.04); }
      100% { opacity: 1; transform: scale(1); }
    }
    @keyframes drop-placeholder-appear {
      0% { opacity: 0; transform: scale(0.2); }
      40% { opacity: 1; transform: scale(1.18); }
      65% { transform: scale(0.92); }
      85% { transform: scale(1.04); }
      100% { opacity: 1; transform: scale(1); }
    }

    #properties-panel {
      position: absolute;
      top: 0;
      right: -320px;
      width: 320px;
      height: 100vh;
      background: var(--vscode-sideBar-background, #252526);
      border-left: 1px solid var(--vscode-sideBarSectionHeader-border, #454545);
      color: var(--vscode-foreground, #ccc);
      transition: right 0.2s ease-in-out;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      z-index: 500;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 13px;
    }
    #properties-panel.open {
      right: 0;
    }
    .prop-icon-wrapper svg, .prop-icon-wrapper img, .prop-icon-wrapper image {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    /* Modern VS Code UI scrolling */
    #properties-panel > .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    /* Simple form UI */
    .prop-group {
      margin-bottom: 12px;
    }
    .prop-label {
      display: block;
      margin-bottom: 4px;
      font-weight: 600;
      opacity: 0.8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .prop-input {
      width: 100%;
      box-sizing: border-box;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 4px 6px;
      font-family: inherit;
      font-size: 13px;
    }
    .prop-input:focus {
      outline: 1px solid var(--vscode-focusBorder, #007fd4);
      outline-offset: -1px;
    }
    select.prop-input {
      appearance: none;
    }

    /* Floating Canvas HUD */
    #canvas-hud {
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 150;
      display: none;
      align-items: center;
      gap: 3px;
      background: var(--vscode-editorWidget-background, rgba(30, 41, 59, 0.9));
      border: 1px solid var(--vscode-widget-border, #334155);
      border-radius: 6px;
      padding: 3px 6px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 11px;
      backdrop-filter: blur(8px);
      user-select: none;
    }
    .hud-btn {
      background: transparent;
      color: var(--vscode-foreground, #cbd5e1);
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 3px 7px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
    }
    .hud-btn:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
      color: #fff;
    }
    .hud-btn.active {
      background: var(--vscode-button-background, #0284c7);
      color: var(--vscode-button-foreground, #fff);
    }
    .hud-btn-accent {
      background: rgba(16, 185, 129, 0.2);
      border-color: rgba(16, 185, 129, 0.4);
      color: #34d399;
    }
    .hud-btn-accent:hover {
      background: rgba(16, 185, 129, 0.4);
      color: #6ee7b7;
    }
    .hud-divider {
      width: 1px;
      height: 16px;
      background: var(--vscode-widget-border, #475569);
      margin: 0 3px;
    }

    /* Diagram Context Menu */
    #diagram-context-menu {
      position: absolute;
      z-index: 1000;
      display: none;
      min-width: 190px;
      background: var(--vscode-menu-background, #1e293b);
      color: var(--vscode-menu-foreground, #e2e8f0);
      border: 1px solid var(--vscode-menu-border, #334155);
      border-radius: 6px;
      padding: 4px 0;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 12px;
      user-select: none;
    }
    .context-menu-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      cursor: pointer;
      gap: 12px;
    }
    .context-menu-item:hover {
      background: var(--vscode-menu-selectionBackground, #0284c7);
      color: var(--vscode-menu-selectionForeground, #fff);
    }
    .context-menu-item .shortcut {
      opacity: 0.6;
      font-size: 10px;
      font-family: monospace;
    }
    .context-menu-divider {
      height: 1px;
      background: var(--vscode-menu-separatorBackground, #334155);
      margin: 4px 0;
    }

    /* Spotlight Omni-Insert Popover */
    #spotlight-omni-insert {
      position: absolute;
      z-index: 950;
      display: none;
      width: 300px;
      background: var(--vscode-editorWidget-background, #1e293b);
      border: 1px solid var(--vscode-focusBorder, #0284c7);
      border-radius: 8px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
      overflow: hidden;
      font-family: var(--vscode-font-family, sans-serif);
    }
    #spotlight-input {
      width: 100%;
      box-sizing: border-box;
      background: transparent;
      border: none;
      border-bottom: 1px solid var(--vscode-widget-border, #334155);
      padding: 8px 12px;
      font-size: 13px;
      color: var(--vscode-input-foreground, #fff);
      outline: none;
    }
    #spotlight-results {
      max-height: 220px;
      overflow-y: auto;
      padding: 4px 0;
    }
    .spotlight-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 12px;
      color: var(--vscode-foreground, #cbd5e1);
    }
    .spotlight-item:hover, .spotlight-item.selected {
      background: var(--vscode-list-activeSelectionBackground, #0284c7);
      color: #fff;
    }
    .spotlight-badge {
      font-size: 10px;
      opacity: 0.7;
      padding: 1px 4px;
      border-radius: 3px;
      background: rgba(255,255,255,0.1);
    }

    /* Wire Probe Tooltip */
    #wire-probe-tooltip {
      position: absolute;
      z-index: 800;
      display: none;
      pointer-events: none;
      background: rgba(15, 23, 42, 0.92);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.4);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 11px;
      font-family: monospace;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(6px);
      max-width: 240px;
    }

    /* Pinned Sparkline Scope Cards */
    #pinned-scopes-container {
      position: absolute;
      top: 60px;
      right: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      z-index: 700;
      pointer-events: none;
      max-height: calc(100vh - 80px);
      overflow-y: auto;
    }
    .pinned-scope-card {
      pointer-events: auto;
      width: 280px;
      background: rgba(15, 23, 42, 0.94);
      border: 1px solid rgba(56, 189, 248, 0.4);
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(6px);
      overflow: hidden;
      font-family: var(--vscode-font-family, sans-serif);
    }
    .scope-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: rgba(30, 41, 59, 0.85);
      border-bottom: 1px solid rgba(51, 65, 85, 0.8);
      font-size: 11px;
      font-weight: 600;
      color: #f8fafc;
    }
    .scope-close-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 0 2px;
    }
    .scope-close-btn:hover {
      color: #f87171;
    }
    .scope-body {
      padding: 8px 10px;
    }
    .scope-metrics {
      display: flex;
      gap: 8px;
      font-family: monospace;
      font-size: 10px;
      color: #94a3b8;
      margin-bottom: 6px;
    }
  </style>
</head>
<body>
  <div id="canvas-hud" class="canvas-hud" style="display: none;">
    <button id="hud-select" class="hud-btn active" title="Select Tool (V)">↖</button>
    <div class="hud-divider"></div>
    <button id="hud-wire" class="hud-btn" title="Orthogonal Wire Tool (W)">⚡ Wire</button>
    <button id="hud-gnd" class="hud-btn" title="Insert Ground (G)">⏚ Gnd</button>
    <button id="hud-bus" class="hud-btn" title="Insert Busbar (B)">━ Bus</button>
    <button id="hud-breaker" class="hud-btn" title="Insert Breaker (K)">⎎ Brk</button>
    <button id="hud-resistor" class="hud-btn" title="Insert Resistor (R)">〰 R</button>
    <div class="hud-divider"></div>
    <button id="hud-omni" class="hud-btn" title="Search Component (Shift+A / Tab)">🔍 Search</button>
    <button id="hud-run" class="hud-btn hud-btn-accent" title="Run EMT Simulation (F5)">▶ Run</button>
  </div>
  <div id="diagram-context-menu"></div>
  <div id="spotlight-omni-insert">
    <input id="spotlight-input" type="text" placeholder="Search PSCAD components... (↵ to drop)" autocomplete="off" />
    <div id="spotlight-results"></div>
  </div>
  <div id="wire-probe-tooltip"></div>
  <div id="pinned-scopes-container"></div>
  <div id="toolbar" style="display: none;">
    <span>Diagram View:</span>
    <select id="diagramTypeSelect">
      <option value="All">All (Flat Canvas)</option>
      <option value="BDD">BDD (Block Definition)</option>
      <option value="IBD">IBD (Internal Block)</option>
      <option value="StateMachine">State Machine</option>
      <option value="Activity">Activity</option>
      <option value="UseCase">Use Case</option>
      <option value="Requirement">Requirement</option>
      <option value="Parametric">Parametric</option>
      <option value="Sequence">Sequence</option>
      <option value="Package">Package</option>
    </select>
  </div>
  <div id="breadcrumb-bar" style="display: none;"></div>
  <div id="container"></div>
  <div id="placeholder">Loading diagram...</div>
  <div id="spinner"></div>

  <div id="properties-panel">
    <div style="padding: 12px 16px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #454545); display: flex; align-items: center; justify-content: space-between;">
      <span id="properties-title" style="font-weight: 600; font-size: 11px; text-transform: uppercase; color: var(--vscode-sideBarTitle-foreground);">Properties</span>
    </div>
    <div class="panel-body" id="properties-content">
      <!-- injected dynamically -->
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
