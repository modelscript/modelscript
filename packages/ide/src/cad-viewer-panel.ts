// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

/**
 * Manages the interactive 3D CAD & Multi-Body Webview Panel in VS Code.
 *
 * Queries CAD component geometry from the LSP server (`modelscript/getCadComponents`),
 * streams batch or live co-simulation state trajectories and FEA stress payloads to the
 * 3D viewport, and writes interactive gizmo transforms and CAD variable bindings back
 * into OpenSCAD (`.scad`) and Modelica (`.mo`) source documents.
 */
export class CadViewerPanel {
  /** Singleton instance of the currently open CAD viewer panel, if any. */
  public static currentPanel: CadViewerPanel | undefined;
  /** VS Code webview view type identifier for the 3D CAD viewer. */
  public static readonly viewType = "modelscript.cadViewer";

  /** Underlying VS Code webview panel host. */
  private readonly _panel: vscode.WebviewPanel;
  /** Root URI of the extension used to resolve bundled scripts and CAD assets. */
  private readonly _extensionUri: vscode.Uri;
  /** Active LSP language client used to request CAD component meshes and listen for AST updates. */
  private readonly _client: LanguageClient;
  /** Subscriptions and timers disposed when the panel closes. */
  private _disposables: vscode.Disposable[] = [];

  /**
   * Creates a new 3D CAD Viewer webview panel beside the active editor, or reveals
   * and refreshes the existing singleton panel.
   *
   * @param extensionUri - Base URI of the IDE extension.
   * @param client - Active LSP `LanguageClient`.
   */
  public static createOrShow(extensionUri: vscode.Uri, client: LanguageClient) {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (CadViewerPanel.currentPanel) {
      CadViewerPanel.currentPanel._panel.reveal(column);
      CadViewerPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(CadViewerPanel.viewType, "3D CAD Viewer", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist"), vscode.Uri.joinPath(extensionUri, "images")],
    });

    CadViewerPanel.currentPanel = new CadViewerPanel(panel, extensionUri, client);
  }

  /**
   * Initializes the CAD viewer panel, wires up webview message handlers for gizmo and binding
   * writebacks, and subscribes to editor and workspace change events.
   */
  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: LanguageClient) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._client = client;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case "ready":
            this.update();
            break;
          case "select":
            break;
          case "commitGizmoDelta":
            this.handleCommitGizmoDelta(message.payload);
            break;
          case "commitCadBinding":
            this.handleCommitCadBinding(message.payload);
            break;
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    // Watch for active editor changes to auto-update CAD viewer
    vscode.window.onDidChangeActiveTextEditor(
      () => {
        if (vscode.window.activeTextEditor?.document) {
          this.update();
        }
      },
      null,
      this._disposables,
    );

    let cadUpdateTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedUpdate = () => {
      if (cadUpdateTimer) clearTimeout(cadUpdateTimer);
      cadUpdateTimer = setTimeout(() => {
        cadUpdateTimer = null;
        this.update();
      }, 250);
    };
    this._disposables.push({
      dispose: () => {
        if (cadUpdateTimer) {
          clearTimeout(cadUpdateTimer);
          cadUpdateTimer = null;
        }
      },
    });

    vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document === vscode.window.activeTextEditor?.document) {
          debouncedUpdate();
        }
      },
      null,
      this._disposables,
    );

    // Listen for LSP compilation complete so we update when the AST is ready
    const treeSub = this._client.onNotification("modelscript/projectTreeChanged", () => {
      debouncedUpdate();
    });
    if (treeSub && typeof treeSub.dispose === "function") {
      this._disposables.push(treeSub);
    }
  }

  /**
   * Queries the LSP server for CAD components in the active document, resolves relative
   * binary glTF asset URIs into base64 data URIs, and posts the component list to the webview.
   */
  public async update() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme === "output") {
      return;
    }

    const uri = editor.document.uri.toString();
    try {
      // Send a custom request to the language server to get the cad components
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cadComponents = await this._client.sendRequest<any[]>("modelscript/getCadComponents", { uri });

      const documentUri = vscode.Uri.parse(uri);
      for (const comp of cadComponents) {
        if (comp.proceduralMesh) continue;
        if (typeof comp.cad === "string") {
          const match = comp.cad.match(/uri\s*=\s*"([^"]+)"/);
          if (match) {
            const cadUri = match[1];
            if (!cadUri.includes("://") && !cadUri.startsWith("data:") && !cadUri.startsWith("#")) {
              const fileUri = vscode.Uri.joinPath(documentUri, "..", cadUri);
              try {
                const data = await vscode.workspace.fs.readFile(fileUri);
                const bytes = new Uint8Array(data);
                let binary = "";
                for (let i = 0; i < bytes.byteLength; i++) {
                  binary += String.fromCharCode(bytes[i]!);
                }
                const b64 = btoa(binary);
                const dataUri = `data:model/gltf-binary;base64,${b64}`;
                comp.cad = comp.cad.replace(cadUri, dataUri);
              } catch (e) {
                console.warn("[CAD Viewer] Could not read local CAD file:", fileUri.toString(), e);
              }
            }
          }
        }
      }

      this._panel.webview.postMessage({ type: "cadComponents", data: cadComponents });
    } catch (e) {
      console.warn("[CAD Viewer] Failed to get CAD components:", e);
    }
  }

  /**
   * Send simulation results to the webview for animation replay.
   *
   * @param t - Array of time points
   * @param y - 2D array of variable values (y[timeIndex][varIndex])
   * @param states - Array of variable names (matching y columns)
   */
  public sendSimulationData(t: number[], y: number[][], states: string[]): void {
    this._panel.webview.postMessage({
      type: "simulationData",
      data: { t, y, states },
    });
  }

  /**
   * Push live cosimulation variable values to the webview for real-time animation.
   *
   * @param values - Map of variable name → value
   * @param time - Current simulation time
   */
  public sendLiveValues(values: Record<string, number>, time: number): void {
    this._panel.webview.postMessage({
      type: "liveValues",
      data: { values, time },
    });
  }

  /**
   * Push live FEA structural frame data to the webview for real-time stress & deformation rendering.
   */
  public sendFeaPayload(payload: unknown): void {
    this._panel.webview.postMessage({
      type: "FEA_PAYLOAD",
      data: payload,
    });
  }

  /**
   * Posts an arbitrary message payload directly to the underlying CAD webview.
   */
  public postMessage(msg: unknown): void {
    this._panel.webview.postMessage(msg);
  }

  /**
   * Applies viewport gizmo drag writebacks atomically to the active editor document.
   */
  public async handleCommitGizmoDelta(payload: {
    componentName: string;
    mode?: "translate" | "rotate" | "scale" | undefined;
    delta: [number, number, number];
    newPosition: [number, number, number];
    newRotation?: [number, number, number] | undefined;
    newScale?: [number, number, number] | undefined;
    sourceMetadata?:
      | {
          parameterName?: string | undefined;
          dimensionParams?: [string | undefined, string | undefined, string | undefined] | undefined;
          dimensions?: [number, number, number] | undefined;
          transformMethod?: string | undefined;
          argIndex?: number | undefined;
          startOffset?: number | undefined;
          endOffset?: number | undefined;
          primitiveStartOffset?: number | undefined;
          primitiveEndOffset?: number | undefined;
          translateRange?: { startOffset: number; endOffset: number } | undefined;
          rotateRange?: { startOffset: number; endOffset: number } | undefined;
          scaleRange?: { startOffset: number; endOffset: number } | undefined;
          translation?: [number, number, number] | undefined;
          rotation?: [number, number, number] | undefined;
          scale?: [number, number, number] | undefined;
        }
      | undefined;
  }): Promise<void> {
    if (!payload) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const doc = editor.document;
    const source = doc.getText();
    const { componentName, mode = "translate", newPosition, newRotation, newScale, sourceMetadata } = payload;

    // 1. OpenSCAD document writeback
    if (doc.languageId === "scad" || doc.fileName.endsWith(".scad")) {
      try {
        const { getScadParser, ScadPatcher } = await import("@modelscript/scad");
        const parser = await getScadParser();
        const tree = parser.parse(source);
        if (!tree) return;

        let patchRes = null;

        if (mode === "scale") {
          const scaleFactors = newScale ?? [1, 1, 1];
          // Check if any scaled axis is bound to a named dimension parameter
          const dimParams = sourceMetadata?.dimensionParams;
          const dims = sourceMetadata?.dimensions;
          if (dimParams && dims) {
            for (let axis = 0; axis < 3; axis++) {
              const paramName = dimParams[axis];
              const baseDim = dims[axis];
              if (paramName && baseDim !== undefined && Math.abs(scaleFactors[axis]! - 1) > 1e-3) {
                const newDimVal = Number((baseDim * scaleFactors[axis]!).toFixed(4));
                patchRes = ScadPatcher.patchVariable(source, tree.rootNode, paramName, newDimVal);
                if (patchRes) break;
              }
            }
          }
          if (!patchRes) {
            const baseScale = sourceMetadata?.scale ?? [1, 1, 1];
            const targetScale: [number, number, number] = [
              Number((baseScale[0] * scaleFactors[0]).toFixed(4)),
              Number((baseScale[1] * scaleFactors[1]).toFixed(4)),
              Number((baseScale[2] * scaleFactors[2]).toFixed(4)),
            ];
            patchRes = ScadPatcher.patchOrInsertTransform(source, tree.rootNode, "scale", targetScale, sourceMetadata);
          }
        } else if (mode === "rotate") {
          const targetRot = newRotation ?? [0, 0, 0];
          patchRes = ScadPatcher.patchOrInsertTransform(source, tree.rootNode, "rotate", targetRot, sourceMetadata);
        } else {
          // mode === "translate"
          if (
            sourceMetadata?.translateRange ||
            sourceMetadata?.primitiveStartOffset !== undefined ||
            sourceMetadata?.transformMethod === "translate"
          ) {
            patchRes = ScadPatcher.patchOrInsertTransform(
              source,
              tree.rootNode,
              "translate",
              newPosition,
              sourceMetadata,
            );
          } else if (sourceMetadata?.parameterName) {
            patchRes = ScadPatcher.patchVariable(source, tree.rootNode, sourceMetadata.parameterName, newPosition[0]);
          } else {
            patchRes = ScadPatcher.patchOrInsertTransform(
              source,
              tree.rootNode,
              "translate",
              newPosition,
              sourceMetadata,
            );
          }
        }

        if (patchRes) {
          const edit = new vscode.WorkspaceEdit();
          const startPos = doc.positionAt(patchRes.replacedRange.startOffset);
          const endPos = doc.positionAt(patchRes.replacedRange.endOffset);
          edit.replace(doc.uri, new vscode.Range(startPos, endPos), patchRes.newValue);
          await vscode.workspace.applyEdit(edit);
          await this.update();
          return;
        }
      } catch (e) {
        console.warn("[CAD Viewer] Failed to patch OpenSCAD source:", e);
      }
    }

    // 2. Modelica document writeback (annotation CAD(..., position/rotation/scale={...}))
    if (doc.languageId === "modelica" || doc.fileName.endsWith(".mo")) {
      const propName = mode === "rotate" ? "rotation" : mode === "scale" ? "scale" : "position";
      const vec =
        mode === "rotate" ? (newRotation ?? [0, 0, 0]) : mode === "scale" ? (newScale ?? [1, 1, 1]) : newPosition;
      const newCoords = `${vec[0].toFixed(2)}, ${vec[1].toFixed(2)}, ${vec[2].toFixed(2)}`;

      const compRegex = new RegExp(
        `(${componentName}\\b[\\s\\S]*?annotation\\([\\s\\S]*?CAD\\([^)]*?${propName}\\s*=\\s*\\{)[^}]*(\\}[\\s\\S]*?\\))`,
      );
      const match = compRegex.exec(source);
      if (match) {
        const edit = new vscode.WorkspaceEdit();
        const startIdx = match.index + match[1]!.length;
        const endIdx = startIdx + match[0].length - match[1]!.length - match[2]!.length;
        const startPos = doc.positionAt(startIdx);
        const endPos = doc.positionAt(endIdx);
        edit.replace(doc.uri, new vscode.Range(startPos, endPos), newCoords);
        await vscode.workspace.applyEdit(edit);
      } else {
        // Insert property into existing CAD(...) annotation if not present yet
        const cadInsertRegex = new RegExp(`(${componentName}\\b[\\s\\S]*?annotation\\([\\s\\S]*?CAD\\([^)]*)(\\))`);
        const insertMatch = cadInsertRegex.exec(source);
        if (insertMatch) {
          const edit = new vscode.WorkspaceEdit();
          const insertIdx = insertMatch.index + insertMatch[1]!.length;
          const pos = doc.positionAt(insertIdx);
          edit.insert(doc.uri, pos, `, ${propName}={${newCoords}}`);
          await vscode.workspace.applyEdit(edit);
        }
      }
    }
  }

  /**
   * Applies dynamic CAD simulation bindings writeback atomically to the active editor document.
   */
  public async handleCommitCadBinding(payload: {
    componentName: string;
    bindings: any[];
    uri?: string | undefined;
  }): Promise<void> {
    if (!payload) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const doc = editor.document;
    const source = doc.getText();
    const { componentName, bindings, uri } = payload;

    if (doc.languageId === "modelica" || doc.fileName.endsWith(".mo")) {
      const { patchModelicaCadAnnotation } = await import("@modelscript/cad");
      const patch = patchModelicaCadAnnotation(source, componentName, {
        bindings,
        uri,
      });

      if (patch.updatedSource !== source && patch.replacedRange) {
        const edit = new vscode.WorkspaceEdit();
        const startPos = doc.positionAt(patch.replacedRange.start);
        const endPos = doc.positionAt(patch.replacedRange.end);
        edit.replace(doc.uri, new vscode.Range(startPos, endPos), patch.newText ?? patch.updatedSource);
        await vscode.workspace.applyEdit(edit);
      }
    }
  }

  /**
   * Instructs the 3D viewport camera to focus and highlight a specific named CAD part.
   *
   * @param partName - Component or part identifier to focus.
   */
  public focusPart(partName: string) {
    this._panel.webview.postMessage({
      type: "focusPart",
      partName,
    });
  }

  /**
   * Reveals the CAD webview panel in the given editor column.
   */
  public reveal(column?: vscode.ViewColumn) {
    this._panel.reveal(column);
  }

  /**
   * Disposes the webview panel and all registered event listeners and timers.
   */
  public dispose() {
    CadViewerPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  /**
   * Generates the HTML document shell for the 3D CAD viewer webview with a strict Content Security Policy.
   */
  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "dist", "cad-webview.js"));
    const cadBaseUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "images", "cad")).toString();
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource} https: http: ws: wss: data: blob:; worker-src 'self' blob:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>3D CAD Viewer</title>
</head>
<body class="vscode-dark">
    <div id="root"></div>
    <script nonce="${nonce}">
      window.__CAD_ASSET_BASE_URL__ = "${cadBaseUri}";
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/**
 * Generates a random 32-character alphanumeric cryptographic nonce for webview script tags.
 */
function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
