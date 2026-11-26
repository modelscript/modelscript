// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { BaseWebviewPanel } from "./webview/base-panel.js";
import { attachExtensionWebviewBridge } from "./webview/shared/extension-lsp-bridge.js";

interface CadComponentEntry {
  name?: string | undefined;
  proceduralMesh?: unknown;
  cad?: string | Record<string, unknown> | undefined;
  defaults?: Record<string, unknown> | undefined;
  sourceMetadata?:
    | {
        startOffset?: number | undefined;
        endOffset?: number | undefined;
        primitiveStartOffset?: number | undefined;
        primitiveEndOffset?: number | undefined;
      }
    | undefined;
}

interface LspPositionLike {
  line: number;
  character: number;
}

interface LspRangeLike {
  start: LspPositionLike;
  end: LspPositionLike;
}

interface LspDocumentSymbolLike {
  name?: string | undefined;
  range?: LspRangeLike | undefined;
  selectionRange?: LspRangeLike | undefined;
  location?: { range?: LspRangeLike | undefined } | undefined;
  children?: LspDocumentSymbolLike[] | undefined;
}

const CAE_DECK_KEYWORDS = ["*NODE", "*ELEMENT", "*STEP", "*BOUNDARY", "*CLOAD", "*MATERIAL"];

function hasCaeDeckKeyword(text: string): boolean {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trimStart().toUpperCase();
    if (!trimmed.startsWith("*")) continue;
    for (const kw of CAE_DECK_KEYWORDS) {
      if (trimmed.startsWith(kw)) {
        const nextChar = trimmed.charAt(kw.length);
        if (!nextChar || nextChar === "," || nextChar === " " || nextChar === "\t") {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Extracts a quoted `uri="..."` value from a serialized CAD annotation string without regex.
 */
function extractQuotedCadUri(cadText: string): string | undefined {
  let idx = 0;
  while (idx < cadText.length) {
    const found = cadText.indexOf("uri", idx);
    if (found === -1) return undefined;
    const prev = found > 0 ? cadText.charCodeAt(found - 1) : 0;
    const prevIsIdent =
      (prev >= 65 && prev <= 90) || (prev >= 97 && prev <= 122) || (prev >= 48 && prev <= 57) || prev === 95;
    let pos = found + 3;
    if (!prevIsIdent) {
      while (
        pos < cadText.length &&
        (cadText[pos] === " " || cadText[pos] === "\t" || cadText[pos] === "\r" || cadText[pos] === "\n")
      ) {
        pos++;
      }
      if (cadText[pos] === "=") {
        pos++;
        while (
          pos < cadText.length &&
          (cadText[pos] === " " || cadText[pos] === "\t" || cadText[pos] === "\r" || cadText[pos] === "\n")
        ) {
          pos++;
        }
        if (cadText[pos] === '"') {
          const endQuote = cadText.indexOf('"', pos + 1);
          if (endQuote > pos + 1) {
            return cadText.slice(pos + 1, endQuote);
          }
        }
      }
    }
    idx = found + 3;
  }
  return undefined;
}

function findDocumentSymbolRange(
  symbols: readonly LspDocumentSymbolLike[],
  componentName: string,
  leaf: string,
): LspRangeLike | undefined {
  let leafFallback: LspRangeLike | undefined;

  const visit = (list: readonly LspDocumentSymbolLike[], prefix: string): LspRangeLike | undefined => {
    for (const sym of list) {
      const symName = sym.name ?? "";
      const qualified = prefix && symName ? `${prefix}.${symName}` : symName;
      const symRange = sym.selectionRange ?? sym.range ?? sym.location?.range;
      if (symRange && (symName === componentName || qualified === componentName)) {
        return symRange;
      }
      if (symRange && !leafFallback && symName === leaf) {
        leafFallback = symRange;
      }
      if (Array.isArray(sym.children) && sym.children.length > 0) {
        const nested = visit(sym.children, qualified);
        if (nested) return nested;
      }
    }
    return undefined;
  };

  return visit(symbols, "") ?? leafFallback;
}

/**
 * Manages the interactive 3D CAD & Multi-Body Webview Panel in VS Code.
 *
 * Queries CAD component geometry from the LSP server (`modelscript/getCadComponents`),
 * streams batch or live co-simulation state trajectories and FEA stress payloads to the
 * 3D viewport, and writes interactive gizmo transforms and CAD variable bindings back
 * into OpenSCAD (`.scad`) and Modelica (`.mo`) source documents.
 */
export class CadViewerPanel extends BaseWebviewPanel {
  /** Singleton instance of the currently open CAD viewer panel, if any. */
  public static currentPanel: CadViewerPanel | undefined;
  /** VS Code webview view type identifier for the 3D CAD viewer. */
  public static readonly viewType = "modelscript.cadViewer";

  /** Active LSP language client used to request CAD component meshes and listen for AST updates. */
  private readonly _client: LanguageClient;
  /** Last known target CAD/modeling document URI (persisted when focus moves to webview/diagram tabs). */
  private _targetDocumentUri: string | undefined;
  /** Suppresses self-induced doc-change / projectTreeChanged echo updates right after panel writebacks. */
  private _suppressDocSyncUntil = 0;
  /** Optional pre-evaluated CAD components provided on panel creation. */
  private _initialComponents: CadComponentEntry[] | undefined;
  /** Most recently resolved CAD components from LSP / local evaluation. */
  private _lastComponents: CadComponentEntry[] = [];

  /**
   * Creates a new 3D CAD Viewer webview panel beside the active editor, or reveals
   * and refreshes the existing singleton panel.
   *
   * @param extensionUri - Base URI of the IDE extension.
   * @param client - Active LSP `LanguageClient`.
   * @param initialFocusPart - Optional part identifier to focus on open.
   * @param targetUri - Optional document URI to bind the viewer to before focus shifts to the webview.
   * @param initialComponents - Optional pre-evaluated CAD component list.
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    client: LanguageClient,
    initialFocusPart?: string,
    targetUri?: string,
    initialComponents?: unknown[],
  ) {
    const activeEditorDoc = vscode.window.activeTextEditor?.document;
    const resolvedUri =
      targetUri ??
      (activeEditorDoc && activeEditorDoc.uri.scheme !== "output" ? activeEditorDoc.uri.toString() : undefined);
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (CadViewerPanel.currentPanel) {
      if (resolvedUri) {
        CadViewerPanel.currentPanel._targetDocumentUri = resolvedUri;
      }
      if (Array.isArray(initialComponents) && initialComponents.length > 0) {
        CadViewerPanel.currentPanel._initialComponents = initialComponents as {
          proceduralMesh?: unknown;
          cad?: string | Record<string, unknown> | undefined;
        }[];
        CadViewerPanel.currentPanel._panel.webview.postMessage({
          type: "cadComponents",
          data: initialComponents,
        });
      }
      CadViewerPanel.currentPanel._panel.reveal(column);
      void CadViewerPanel.currentPanel.update();
      if (initialFocusPart) {
        CadViewerPanel.currentPanel.focusPart(initialFocusPart);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(CadViewerPanel.viewType, "3D CAD Viewer", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist"), vscode.Uri.joinPath(extensionUri, "images")],
    });

    CadViewerPanel.currentPanel = new CadViewerPanel(
      panel,
      extensionUri,
      client,
      resolvedUri,
      initialComponents as
        { proceduralMesh?: unknown; cad?: string | Record<string, unknown> | undefined }[] | undefined,
    );
    if (initialFocusPart) {
      CadViewerPanel.currentPanel.focusPart(initialFocusPart);
    }
  }

  /**
   * Initializes the CAD viewer panel, wires up webview message handlers for gizmo and binding
   * writebacks, and subscribes to editor and workspace change events.
   */
  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client: LanguageClient,
    targetDocumentUri?: string,
    initialComponents?: { proceduralMesh?: unknown; cad?: string | Record<string, unknown> | undefined }[],
  ) {
    super(panel, extensionUri);
    this._client = client;
    this._targetDocumentUri = targetDocumentUri;
    this._initialComponents = initialComponents;

    const bridgeSub = attachExtensionWebviewBridge(this._panel.webview, {
      client: this._client,
      getDocument: () => this._resolveTargetDocument(),
      title: "3D CAD Viewer",
      languageId: "cad",
      onUnhandledMessage: async (message) => {
        switch (message.type) {
          case "ready":
            if (this._initialComponents && this._initialComponents.length > 0) {
              this._panel.webview.postMessage({ type: "cadComponents", data: this._initialComponents });
            }
            await this.update();
            break;
          case "select":
            await this.handleSelectComponent((message as { name?: string | null }).name);
            break;
          case "commitGizmoDelta":
            await this.handleCommitGizmoDelta(
              message["payload"] as Parameters<CadViewerPanel["handleCommitGizmoDelta"]>[0],
            );
            break;
          case "commitDimensionDelta":
            await this.handleCommitDimensionDelta(
              message["payload"] as Parameters<CadViewerPanel["handleCommitDimensionDelta"]>[0],
            );
            break;
          case "commitFaceTag":
            await this.handleCommitFaceTag(message["payload"] as Parameters<CadViewerPanel["handleCommitFaceTag"]>[0]);
            break;
          case "commitAssemblyJoint":
            await this.handleCommitAssemblyJoint(
              message["payload"] as Parameters<CadViewerPanel["handleCommitAssemblyJoint"]>[0],
            );
            break;
          case "commitCadBinding":
            await this.handleCommitCadBinding(
              message["payload"] as Parameters<CadViewerPanel["handleCommitCadBinding"]>[0],
            );
            break;
          case "insertCaeSnippet":
            if (typeof message["snippet"] === "string") {
              await this.handleInsertCaeSnippet(message["snippet"]);
            }
            break;
        }
      },
    });
    this._disposables.push(bridgeSub);

    const cadBaseUri = this._panel.webview
      .asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "images", "cad"))
      .toString();
    this._panel.webview.html = this.getHtmlShell({
      title: "3D CAD Viewer",
      scriptName: "cad-webview.js",
      injectedGlobalJs: `window.__CAD_ASSET_BASE_URL__ = "${cadBaseUri}";`,
    });

    // Watch for active editor changes to auto-update CAD viewer
    vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        if (editor?.document && editor.document.uri.scheme !== "output") {
          this._targetDocumentUri = editor.document.uri.toString();
          void this.update();
        }
      },
      null,
      this._disposables,
    );

    let cadUpdateTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedUpdate = () => {
      if (Date.now() < this._suppressDocSyncUntil) return;
      if (cadUpdateTimer) clearTimeout(cadUpdateTimer);
      cadUpdateTimer = setTimeout(() => {
        cadUpdateTimer = null;
        if (Date.now() < this._suppressDocSyncUntil) return;
        void this.update();
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
        if (Date.now() < this._suppressDocSyncUntil) return;
        const targetDoc = this._resolveTargetDocument();
        if (
          e.document === vscode.window.activeTextEditor?.document ||
          (targetDoc && e.document.uri.toString() === targetDoc.uri.toString())
        ) {
          debouncedUpdate();
        }
      },
      null,
      this._disposables,
    );

    // Listen for LSP compilation complete so we update when the AST is ready
    const treeSub = this._client.onNotification("modelscript/projectTreeChanged", () => {
      if (Date.now() < this._suppressDocSyncUntil) return;
      debouncedUpdate();
    });
    if (treeSub && typeof treeSub.dispose === "function") {
      this._disposables.push(treeSub);
    }
  }

  /**
   * Resolves the target text document for CAD extraction and writeback, falling back to
   * `_targetDocumentUri`, visible editors, or open `.scad`/`.mo` workspace documents when
   * the webview or a custom diagram editor currently holds focus.
   */
  private _resolveTargetDocument(): vscode.TextDocument | undefined {
    const activeDoc = vscode.window.activeTextEditor?.document;
    if (activeDoc && activeDoc.uri.scheme !== "output") {
      this._targetDocumentUri = activeDoc.uri.toString();
      return activeDoc;
    }

    if (this._targetDocumentUri) {
      const matched = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this._targetDocumentUri);
      if (matched && matched.uri.scheme !== "output") {
        return matched;
      }
    }

    const activeTabInput = vscode.window.tabGroups?.activeTabGroup?.activeTab?.input as
      { uri?: vscode.Uri | undefined } | undefined;
    if (activeTabInput?.uri) {
      const tabUriStr = activeTabInput.uri.toString();
      const matched = vscode.workspace.textDocuments.find((d) => d.uri.toString() === tabUriStr);
      if (matched && matched.uri.scheme !== "output") {
        this._targetDocumentUri = tabUriStr;
        return matched;
      }
    }

    for (const ed of vscode.window.visibleTextEditors) {
      if (
        ed.document.uri.scheme !== "output" &&
        /\.(scad|mo|sysml|sysml2|3mf|usd|usda|usdc|fea|inp|cfd)$/i.test(ed.document.uri.path)
      ) {
        this._targetDocumentUri = ed.document.uri.toString();
        return ed.document;
      }
    }

    const openCadDoc =
      vscode.workspace.textDocuments.find(
        (d) =>
          d.uri.scheme !== "output" && (d.languageId === "scad" || /\.(scad|3mf|usd|usda|usdc)$/i.test(d.uri.path)),
      ) ??
      vscode.workspace.textDocuments.find(
        (d) => d.uri.scheme !== "output" && (d.languageId === "modelica" || /\.(mo|fea|inp|cfd)$/i.test(d.uri.path)),
      );
    if (openCadDoc) {
      this._targetDocumentUri = openCadDoc.uri.toString();
      return openCadDoc;
    }

    return undefined;
  }

  /**
   * Queries the LSP server for CAD components in the active document, resolves relative
   * binary glTF asset URIs into base64 data URIs, and posts the component list to the webview.
   */
  public async update() {
    const doc = this._resolveTargetDocument();
    if (!doc || doc.uri.scheme === "output") {
      if (this._initialComponents && this._initialComponents.length > 0) {
        this._panel.webview.postMessage({ type: "cadComponents", data: this._initialComponents });
      }
      return;
    }

    const uri = doc.uri.toString();
    const documentText = doc.getText();
    const isScad = doc.languageId === "scad" || /\.scad$/i.test(doc.uri.path);
    const isCaeDoc =
      doc.languageId === "fea" ||
      doc.languageId === "cfd" ||
      /\.(fea|inp|cfd|foam)$/i.test(doc.uri.path) ||
      hasCaeDeckKeyword(documentText);

    try {
      let cadComponents: CadComponentEntry[] = [];

      if (this._client && typeof this._client.sendRequest === "function") {
        try {
          const lspComps = await this._client.sendRequest<CadComponentEntry[]>("modelscript/getCadComponents", {
            uri,
            documentText,
          });
          if (Array.isArray(lspComps)) {
            cadComponents = lspComps;
          }
        } catch (err) {
          console.warn("[CAD Viewer] LSP getCadComponents failed, trying local fallback:", err);
        }
      }

      // Direct in-extension fallback for OpenSCAD (.scad) documents if LSP parser was still warming up
      if (isScad && cadComponents.length === 0 && documentText.trim().length > 0) {
        try {
          const { getScadParser, extractScadCadComponents } = await import("@modelscript/scad");
          let wasmBytes: Uint8Array | undefined;
          try {
            const wasmUri = vscode.Uri.joinPath(this._extensionUri, "dist", "scad.wasm");
            wasmBytes = await vscode.workspace.fs.readFile(wasmUri);
          } catch {
            // Node fallback
          }
          await getScadParser(wasmBytes);
          const localComps = await extractScadCadComponents(documentText, undefined, uri);
          if (Array.isArray(localComps) && localComps.length > 0) {
            cadComponents = localComps as unknown as CadComponentEntry[];
          }
        } catch (scadErr) {
          console.warn("[CAD Viewer] Direct SCAD component evaluation failed:", scadErr);
        }
      }

      if (cadComponents.length === 0 && this._initialComponents && this._initialComponents.length > 0) {
        cadComponents = this._initialComponents;
      }

      const documentUri = vscode.Uri.parse(uri);
      for (const comp of cadComponents) {
        if (comp.proceduralMesh) continue;
        const cadUri =
          (comp.cad && typeof comp.cad === "object" && typeof comp.cad["uri"] === "string"
            ? comp.cad["uri"]
            : undefined) ??
          (typeof comp.defaults?.["uri"] === "string" ? comp.defaults["uri"] : undefined) ??
          (typeof comp.cad === "string" ? extractQuotedCadUri(comp.cad) : undefined);

        if (cadUri && !cadUri.includes("://") && !cadUri.startsWith("data:") && !cadUri.startsWith("#")) {
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
            if (typeof comp.cad === "string") {
              comp.cad = comp.cad.replace(cadUri, dataUri);
            } else if (comp.cad && typeof comp.cad === "object") {
              comp.cad["uri"] = dataUri;
            }
            if (comp.defaults && typeof comp.defaults["uri"] === "string") {
              comp.defaults["uri"] = dataUri;
            }
          } catch (e) {
            console.warn("[CAD Viewer] Could not read local CAD file:", fileUri.toString(), e);
          }
        }
      }

      this._lastComponents = cadComponents;

      this._panel.webview.postMessage({
        type: "sourceContext",
        data: {
          sourceCode: documentText,
          caeSourceCode: isCaeDoc ? documentText : undefined,
          languageId: doc.languageId,
          documentUri: uri,
        },
      });
      this._panel.webview.postMessage({ type: "cadComponents", data: cadComponents });

      if (this._client && typeof this._client.sendRequest === "function") {
        try {
          const overlay = await this._client.sendRequest<unknown>("modelscript/getVerification3DOverlay", {
            uri,
          });
          if (overlay) {
            this.sendVerificationOverlay(overlay);
          }
        } catch {
          // Optional formal verification overlay
        }
      }
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
   * Push ISO 23952 QIF MBD GD&T Feature Control Frame callouts, CMM probe points,
   * and dimensional deviation heatmap overlays to the 3D CAD viewport.
   */
  public sendQifInspectionOverlay(payload: unknown): void {
    this._panel.webview.postMessage({
      type: "QIF_INSPECTION_OVERLAY",
      data: payload,
    });
  }

  /**
   * Push 3D formal verification overlay payload (reachability flowpipes, dynamic clearance vectors, barrier shells)
   */
  public sendVerificationOverlay(payload: unknown): void {
    this._panel.webview.postMessage({
      type: "VERIFICATION_OVERLAY",
      data: payload,
    });
  }

  /**
   * Focus a formal verification counterexample / violation in the 3D viewport.
   */
  public focusViolationIn3D(options: { time?: number; lhsName?: string; contractId?: string }): void {
    this._panel.webview.postMessage({
      type: "FOCUS_VIOLATION_3D",
      time: options.time,
      lhsName: options.lhsName,
      contractId: options.contractId,
    });
    if (options.lhsName) {
      this.focusPart(options.lhsName);
    }
  }

  /**
   * Push a raw VTK ASCII/binary buffer for unified VtkRenderer visualization in the 3D viewport.
   */
  public sendVtkBuffer(buffer: Uint8Array): void {
    this._panel.webview.postMessage({
      type: "VTK_BUFFER",
      data: { buffer: Array.from(buffer) },
    });
  }

  /**
   * Push a SampledTelemetryFrame to overlay Ansatz's SimulatorTelemetryHud inside the 3D viewport.
   */
  public sendTelemetryFrame(frame: unknown): void {
    this._panel.webview.postMessage({
      type: "TELEMETRY_FRAME",
      data: frame,
    });
  }

  /**
   * Push a POD-Galerkin reduced-order surrogate payload to open the 60 FPS SurrogateLiveExplorer.
   */
  public sendSurrogatePayload(payload: unknown, modelName?: string): void {
    this._panel.webview.postMessage({
      type: "SURROGATE_PAYLOAD",
      data: { payload, modelName },
    });
  }

  /**
   * Appends a CAE deck keyword snippet emitted by CaeSimulationTree to the active document.
   */
  public async handleInsertCaeSnippet(snippet: string): Promise<void> {
    if (!snippet) return;
    const doc = this._resolveTargetDocument();
    if (!doc) return;
    const source = doc.getText();
    const insertion = source.endsWith("\n") ? `${snippet}\n` : `\n${snippet}\n`;
    const endPos = doc.positionAt(source.length);
    this._suppressDocSyncUntil = Date.now() + 500;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, endPos, insertion);
    await vscode.workspace.applyEdit(edit);
    await this.update();
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
    const doc = this._resolveTargetDocument();
    if (!doc) return;

    const source = doc.getText();
    const { componentName, mode = "translate", newPosition, newRotation, newScale, sourceMetadata } = payload;

    // 1. OpenSCAD document writeback
    if (doc.languageId === "scad" || doc.fileName.endsWith(".scad")) {
      try {
        const { getScadParser, ScadPatcher } = await import("@modelscript/scad");
        let wasmBytes: Uint8Array | undefined;
        try {
          const wasmUri = vscode.Uri.joinPath(this._extensionUri, "dist", "scad.wasm");
          const read = await vscode.workspace.fs.readFile(wasmUri);
          if (read && read.byteLength > 0) {
            wasmBytes = read;
          }
        } catch {
          // Node fallback
        }
        const parser = await getScadParser(wasmBytes);
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

        if (patchRes?.locked) {
          const reason = patchRes.lockReason ?? "Transform expression is locked (multi-variable or non-affine).";
          void this._panel.webview.postMessage({
            type: "writebackLocked",
            componentName,
            reason,
          });
          void vscode.window.showWarningMessage(reason);
          await this.update();
          return;
        }

        if (patchRes) {
          this._suppressDocSyncUntil = Date.now() + 500;
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

      const { patchModelicaCadAnnotation } = await import("@modelscript/cad");
      const patch = patchModelicaCadAnnotation(source, componentName, {
        [propName]: vec,
      });

      if (patch.updatedSource !== source && patch.replacedRange) {
        this._suppressDocSyncUntil = Date.now() + 500;
        const edit = new vscode.WorkspaceEdit();
        const startPos = doc.positionAt(patch.replacedRange.start);
        const endPos = doc.positionAt(patch.replacedRange.end);
        edit.replace(doc.uri, new vscode.Range(startPos, endPos), patch.newText ?? patch.updatedSource);
        await vscode.workspace.applyEdit(edit);
        await this.update();
      }
    }
  }

  /**
   * Applies direct dimension dragging writebacks (width, height, radius) to the active editor document.
   */
  public async handleCommitDimensionDelta(payload: {
    componentName: string;
    dimensionIndex: number;
    newValue: number;
    primitiveType?: string | undefined;
    sourceMetadata?:
      | {
          parameterName?: string | undefined;
          dimensionParams?: [string | undefined, string | undefined, string | undefined] | undefined;
          dimensions?: [number, number, number] | undefined;
          primitiveStartOffset?: number | undefined;
          primitiveEndOffset?: number | undefined;
        }
      | undefined;
  }): Promise<void> {
    if (!payload) return;
    const doc = this._resolveTargetDocument();
    if (!doc) return;

    const source = doc.getText();
    const { dimensionIndex, newValue, primitiveType, sourceMetadata } = payload;

    if (doc.languageId === "scad" || doc.fileName.endsWith(".scad")) {
      try {
        const { getScadParser, ScadPatcher } = await import("@modelscript/scad");
        let wasmBytes: Uint8Array | undefined;
        try {
          const wasmUri = vscode.Uri.joinPath(this._extensionUri, "dist", "scad.wasm");
          const read = await vscode.workspace.fs.readFile(wasmUri);
          if (read && read.byteLength > 0) wasmBytes = read;
        } catch {
          // Node fallback
        }
        const parser = await getScadParser(wasmBytes);
        const tree = parser.parse(source);
        if (!tree) return;

        const targetRange =
          sourceMetadata?.primitiveStartOffset !== undefined && sourceMetadata?.primitiveEndOffset !== undefined
            ? { startOffset: sourceMetadata.primitiveStartOffset, endOffset: sourceMetadata.primitiveEndOffset }
            : undefined;

        const paramName = sourceMetadata?.dimensionParams?.[dimensionIndex] ?? sourceMetadata?.parameterName;

        const patchRes = ScadPatcher.patchPrimitiveDimension(
          source,
          tree.rootNode,
          dimensionIndex,
          newValue,
          targetRange,
          paramName,
          primitiveType,
        );

        if (patchRes?.locked) {
          const reason =
            patchRes.lockReason ?? "Dimension expression is locked (multi-variable or non-affine). Edit in source.";
          void this._panel.webview.postMessage({
            type: "writebackLocked",
            componentName: payload.componentName,
            reason,
          });
          void vscode.window.showWarningMessage(reason);
          await this.update();
          return;
        }

        if (patchRes) {
          this._suppressDocSyncUntil = Date.now() + 500;
          const edit = new vscode.WorkspaceEdit();
          const startPos = doc.positionAt(patchRes.replacedRange.startOffset);
          const endPos = doc.positionAt(patchRes.replacedRange.endOffset);
          edit.replace(doc.uri, new vscode.Range(startPos, endPos), patchRes.newValue);
          await vscode.workspace.applyEdit(edit);
          await this.update();
        }
      } catch (err) {
        console.warn("[CAD Viewer] Failed to patch OpenSCAD dimension:", err);
      }
    }
  }

  /**
   * Applies 3D face boundary condition or port tagging writeback to the active editor document.
   */
  public async handleCommitFaceTag(payload: {
    componentName: string;
    portName: string;
    portType?: string | undefined;
    normal?: [number, number, number] | undefined;
    worldPos?: [number, number, number] | undefined;
    sourceMetadata?:
      | {
          primitiveStartOffset?: number | undefined;
          primitiveEndOffset?: number | undefined;
          startOffset?: number | undefined;
          endOffset?: number | undefined;
        }
      | undefined;
  }): Promise<void> {
    if (!payload) return;
    const doc = this._resolveTargetDocument();
    if (!doc) return;

    const source = doc.getText();
    const { componentName, portName, portType = "fixed_support", normal, worldPos, sourceMetadata } = payload;

    // 1. OpenSCAD document: wrap solid with tag_port("name", "type", normal) { ... }
    if (doc.languageId === "scad" || doc.fileName.endsWith(".scad")) {
      try {
        const { ScadPatcher } = await import("@modelscript/scad");
        const startOffset = sourceMetadata?.primitiveStartOffset ?? sourceMetadata?.startOffset;
        const endOffset = sourceMetadata?.primitiveEndOffset ?? sourceMetadata?.endOffset;

        if (startOffset !== undefined && endOffset !== undefined && endOffset > startOffset) {
          const patchRes = ScadPatcher.wrapSolidWithTagPort(
            source,
            { startOffset, endOffset },
            portName,
            portType,
            normal,
          );

          this._suppressDocSyncUntil = Date.now() + 500;
          const edit = new vscode.WorkspaceEdit();
          const startPos = doc.positionAt(patchRes.replacedRange.startOffset);
          const endPos = doc.positionAt(patchRes.replacedRange.endOffset);
          edit.replace(doc.uri, new vscode.Range(startPos, endPos), patchRes.newValue);
          await vscode.workspace.applyEdit(edit);
          await this.update();
        }
      } catch (err) {
        console.warn("[CAD Viewer] Failed to patch OpenSCAD tag_port:", err);
      }
    }

    // 2. Modelica document: inject CADPort annotation
    if (doc.languageId === "modelica" || doc.fileName.endsWith(".mo")) {
      try {
        const { patchModelicaCadPortAnnotation } = await import("@modelscript/cad");
        const patch = patchModelicaCadPortAnnotation(source, componentName, {
          feature: portName,
          offsetPosition: worldPos,
        });

        if (patch.updatedSource !== source && patch.replacedRange) {
          this._suppressDocSyncUntil = Date.now() + 500;
          const edit = new vscode.WorkspaceEdit();
          const startPos = doc.positionAt(patch.replacedRange.start);
          const endPos = doc.positionAt(patch.replacedRange.end);
          edit.replace(doc.uri, new vscode.Range(startPos, endPos), patch.newText ?? patch.updatedSource);
          await vscode.workspace.applyEdit(edit);
          await this.update();
        }
      } catch (err) {
        console.warn("[CAD Viewer] Failed to patch Modelica CADPort annotation:", err);
      }
    }
  }

  /**
   * Synthesizes and applies a Modelica MultiBody Joint or OpenSCAD assembly mate
   * between two parts/frames in the active document.
   */
  public async handleCommitAssemblyJoint(payload: {
    jointName: string;
    jointType: "Revolute" | "Prismatic" | "Cylindrical" | "Spherical" | "Fixed";
    partA: string;
    frameA?: string | undefined;
    partB: string;
    frameB?: string | undefined;
    axis?: [number, number, number] | undefined;
    phi_offset?: number | undefined;
    s_offset?: number | undefined;
  }): Promise<void> {
    if (!payload) return;
    const doc = this._resolveTargetDocument();
    if (!doc) return;

    const source = doc.getText();
    const isModelica = doc.languageId === "modelica" || doc.fileName.endsWith(".mo");

    if (isModelica) {
      try {
        const { patchModelicaAssemblyJoint } = await import("@modelscript/cad");
        const patch = patchModelicaAssemblyJoint(source, payload);
        if (patch.updatedSource !== source) {
          this._suppressDocSyncUntil = Date.now() + 500;
          const edit = new vscode.WorkspaceEdit();
          if (patch.replacedRange) {
            const startPos = doc.positionAt(patch.replacedRange.start);
            const endPos = doc.positionAt(patch.replacedRange.end);
            edit.replace(doc.uri, new vscode.Range(startPos, endPos), patch.newText ?? patch.updatedSource);
          } else {
            edit.replace(
              doc.uri,
              new vscode.Range(doc.positionAt(0), doc.positionAt(source.length)),
              patch.updatedSource,
            );
          }
          await vscode.workspace.applyEdit(edit);
          await this.update();
        }
      } catch (err) {
        console.warn("[CAD Viewer] Failed to patch Modelica assembly joint:", err);
      }
    }
  }

  /**
   * Applies dynamic CAD simulation bindings writeback atomically to the active editor document.
   */
  public async handleCommitCadBinding(payload: {
    componentName: string;
    bindings: Parameters<typeof import("@modelscript/cad").patchModelicaCadAnnotation>[2]["bindings"];
    uri?: string | undefined;
  }): Promise<void> {
    if (!payload) return;
    const doc = this._resolveTargetDocument();
    if (!doc) return;

    const source = doc.getText();
    const { componentName, bindings, uri } = payload;

    if (doc.languageId === "modelica" || doc.fileName.endsWith(".mo")) {
      const { patchModelicaCadAnnotation } = await import("@modelscript/cad");
      const patch = patchModelicaCadAnnotation(source, componentName, {
        bindings,
        uri,
      });

      if (patch.updatedSource !== source && patch.replacedRange) {
        this._suppressDocSyncUntil = Date.now() + 500;
        const edit = new vscode.WorkspaceEdit();
        const startPos = doc.positionAt(patch.replacedRange.start);
        const endPos = doc.positionAt(patch.replacedRange.end);
        edit.replace(doc.uri, new vscode.Range(startPos, endPos), patch.newText ?? patch.updatedSource);
        await vscode.workspace.applyEdit(edit);
        await this.update();
      }
    }
  }

  /**
   * Reveals and highlights a component selected in the 3D CAD viewport inside its source editor
   * using LSP `textDocument/documentSymbol` ranges (or cached CAD component CST offsets).
   */
  private async handleSelectComponent(componentName?: string | null): Promise<void> {
    if (!componentName) return;
    const doc = this._resolveTargetDocument();
    if (!doc) return;

    const leaf = componentName.split(".").pop() || componentName;
    let range: vscode.Range | undefined;

    if (this._client && typeof this._client.sendRequest === "function") {
      try {
        const symbols = await this._client.sendRequest<LspDocumentSymbolLike[] | null>("textDocument/documentSymbol", {
          textDocument: { uri: doc.uri.toString() },
        });
        if (Array.isArray(symbols) && symbols.length > 0) {
          const matchedRange = findDocumentSymbolRange(symbols, componentName, leaf);
          if (matchedRange) {
            range = new vscode.Range(
              new vscode.Position(matchedRange.start.line, matchedRange.start.character),
              new vscode.Position(matchedRange.end.line, matchedRange.end.character),
            );
          }
        }
      } catch {
        // Fall through to cached CST sourceMetadata offsets
      }
    }

    if (!range) {
      const matchedComp =
        this._lastComponents.find((c) => c.name === componentName) ??
        this._lastComponents.find((c) => c.name === leaf || c.name?.split(".").pop() === leaf);
      const startOffset = matchedComp?.sourceMetadata?.primitiveStartOffset ?? matchedComp?.sourceMetadata?.startOffset;
      const endOffset = matchedComp?.sourceMetadata?.primitiveEndOffset ?? matchedComp?.sourceMetadata?.endOffset;
      if (typeof startOffset === "number" && typeof endOffset === "number" && endOffset >= startOffset) {
        range = new vscode.Range(doc.positionAt(startOffset), doc.positionAt(endOffset));
      }
    }

    if (!range) return;

    const editor =
      vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === doc.uri.toString()) ??
      (await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false }));
    if (editor) {
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
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
  public override dispose(): void {
    CadViewerPanel.currentPanel = undefined;
    super.dispose();
  }
}
