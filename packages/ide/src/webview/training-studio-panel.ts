// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide-client — Dynamic-m Training Studio Panel Provider.
 *
 * Exposes the ModelScript Dynamic-m Zonotope Training Studio inside VS Code via both
 * a sidebar `WebviewViewProvider` and an optional pop-out `WebviewPanel`:
 *
 *   1. 4-Gate RLVR Reward Sliders (Gate 1 GLR Syntax, Gate 2 QUDV Units, Gate 3 SMT,
 *      Gate 4 DAE Balance, plus Physics Sim, CAD Clearance, and Zonotope Contraction).
 *   2. Live `group_id` Relational Hypergraph Editor Overlay Toggle (`modelscript.trainingStudio.toggleGroupIdOverlay`)
 *      backed by the `modelscript/getRelationalHypergraph` LSP request.
 *   3. Test-Time Compute Dial (`m = 0 <-> 32`) & epistemic spread threshold (`retrievalTau`).
 *   4. DiskANN Vector-Memory Query Bridge (`POST /api/v1/memory/query`) for hybrid & latent retrieval.
 */

import type { MemoryQueryRequest, MemoryQueryResponse, RelationalHypergraphRecord } from "@modelscript/runtime";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import { getNonce } from "../utils/nonce.js";
import { attachExtensionWebviewBridge } from "./shared/extension-lsp-bridge.js";

// ─────────────────────────────────────────────────────────────────────────────
// State & Message Contracts
// ─────────────────────────────────────────────────────────────────────────────

export interface RlvrRewardWeights {
  gate1Syntax: number;
  gate2Units: number;
  gate3Smt: number;
  gate4Dae: number;
  physicsSim: number;
  cadClearance: number;
  zonotopeContraction: number;
}

export interface TrainingStudioState {
  computeDialM: number;
  mCapMax: number;
  retrievalTau: number;
  groupIdOverlayEnabled: boolean;
  rewardWeights: RlvrRewardWeights;
  embedderId: string;
  activeUri?: string | undefined;
  activeDialect?: string | undefined;
  activeMInit?: number | undefined;
  activeGroupCount?: number | undefined;
  diskAnnOnline: boolean;
}

export interface TrainingStudioDiskAnnResult extends MemoryQueryResponse {
  online: boolean;
  error?: string | undefined;
}

export interface GroupIdOverlayResult {
  enabled: boolean;
  record?: RelationalHypergraphRecord | undefined;
  error?: string | undefined;
}

export type TrainingStudioInboundMessage =
  | { type: "ready" }
  | { type: "setComputeDialM"; value: number; retrievalTau?: number | undefined }
  | { type: "updateRewardWeights"; weights: Partial<RlvrRewardWeights> }
  | { type: "toggleGroupIdOverlay"; enabled?: boolean | undefined }
  | { type: "refreshHypergraph" }
  | {
      type: "queryDiskAnn";
      mode?: "hybrid" | "latent" | undefined;
      textQuery?: string | undefined;
      latentVector?: number[] | undefined;
      embedderId?: string | undefined;
      topK?: number | undefined;
      includeSocialPosts?: boolean | undefined;
      dialects?: string[] | undefined;
      packagePins?: Record<string, string> | undefined;
    };

export const DEFAULT_RLVR_REWARD_WEIGHTS: RlvrRewardWeights = {
  gate1Syntax: 1.0,
  gate2Units: 1.5,
  gate3Smt: 2.0,
  gate4Dae: 2.5,
  physicsSim: 2.0,
  cadClearance: 1.0,
  zonotopeContraction: 0.75,
};

export const TRAINING_STUDIO_COMMANDS = {
  open: "modelscript.trainingStudio.open",
  toggleGroupIdOverlay: "modelscript.trainingStudio.toggleGroupIdOverlay",
  setComputeDialM: "modelscript.trainingStudio.setComputeDialM",
  queryDiskAnn: "modelscript.trainingStudio.queryDiskAnn",
} as const;

const GROUP_OVERLAY_PALETTE = [
  "rgba(56, 189, 248, 0.24)", // sky
  "rgba(168, 85, 247, 0.24)", // purple
  "rgba(52, 211, 153, 0.24)", // emerald
  "rgba(251, 191, 36, 0.24)", // amber
  "rgba(244, 114, 182, 0.24)", // pink
  "rgba(96, 165, 250, 0.24)", // blue
  "rgba(248, 113, 113, 0.24)", // rose
  "rgba(45, 212, 191, 0.24)", // teal
];

const GROUP_BORDER_PALETTE = ["#38bdf8", "#a855f7", "#34d399", "#fbbf24", "#f472b6", "#60a5fa", "#f87171", "#2dd4bf"];

function clampComputeDialM(value: number, maxM = 32): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maxM, Math.round(value)));
}

function clampWeight(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(10, Number(value.toFixed(2))));
}

// ─────────────────────────────────────────────────────────────────────────────
// TrainingStudioPanelProvider
// ─────────────────────────────────────────────────────────────────────────────

/**
 * VS Code `WebviewViewProvider` & pop-out `WebviewPanel` controller for the
 * Dynamic-m Relational Zonotope Training Studio.
 */
export class TrainingStudioPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "modelscript.trainingStudio";
  public static readonly commands = TRAINING_STUDIO_COMMANDS;

  private _view?: vscode.WebviewView | undefined;
  private _panel?: vscode.WebviewPanel | undefined;
  private _disposables: vscode.Disposable[] = [];
  private _groupDecorations = new Map<number, vscode.TextEditorDecorationType>();
  private _lockedDecoration?: vscode.TextEditorDecorationType | undefined;
  private _lastRecord?: RelationalHypergraphRecord | undefined;

  private _state: TrainingStudioState;
  private readonly _apiBaseUrl: string;
  private readonly _onDidChangeState = new vscode.EventEmitter<TrainingStudioState>();
  public readonly onDidChangeState = this._onDidChangeState.event;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _client?: LanguageClient | undefined,
    initialState?: Partial<TrainingStudioState>,
  ) {
    const cfg = vscode.workspace.getConfiguration("modelscript.cloud");
    const configuredUrl = cfg.get<string>("apiUrl");
    this._apiBaseUrl = (configuredUrl || "http://localhost:3000/api/v1").replace(/\/+$/, "");

    this._state = {
      computeDialM: clampComputeDialM(initialState?.computeDialM ?? 16, 32),
      mCapMax: 32,
      retrievalTau: initialState?.retrievalTau ?? 0.35,
      groupIdOverlayEnabled: initialState?.groupIdOverlayEnabled ?? false,
      rewardWeights: {
        ...DEFAULT_RLVR_REWARD_WEIGHTS,
        ...(initialState?.rewardWeights ?? {}),
      },
      embedderId: initialState?.embedderId ?? "ansatz-embed-v1",
      diskAnnOnline: false,
    };

    // Keep group_id decorations synchronized as the user switches files
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        if (this._state.groupIdOverlayEnabled) {
          void this.refreshActiveEditorOverlay();
        }
      }),
    );
  }

  /**
   * Registers the sidebar `WebviewViewProvider` and all Training Studio commands
   * on the VS Code extension context.
   */
  public static register(context: vscode.ExtensionContext, client?: LanguageClient): TrainingStudioPanelProvider {
    const provider = new TrainingStudioPanelProvider(context.extensionUri, client);

    const win = vscode.window as unknown as {
      registerWebviewViewProvider?: (
        viewId: string,
        p: vscode.WebviewViewProvider,
        options?: { webviewOptions?: { retainContextWhenHidden?: boolean } },
      ) => vscode.Disposable;
    };

    if (typeof win.registerWebviewViewProvider === "function") {
      context.subscriptions.push(
        win.registerWebviewViewProvider(TrainingStudioPanelProvider.viewType, provider, {
          webviewOptions: { retainContextWhenHidden: true },
        }),
      );
    }

    context.subscriptions.push(
      vscode.commands.registerCommand(TRAINING_STUDIO_COMMANDS.open, () => {
        provider.openPanel();
      }),
      vscode.commands.registerCommand(TRAINING_STUDIO_COMMANDS.toggleGroupIdOverlay, async (force?: boolean) => {
        return provider.toggleGroupIdOverlay(force);
      }),
      vscode.commands.registerCommand(TRAINING_STUDIO_COMMANDS.setComputeDialM, (m?: number, tau?: number) => {
        if (typeof m === "number") {
          provider.setComputeDialM(m, tau);
        }
      }),
      vscode.commands.registerCommand(
        TRAINING_STUDIO_COMMANDS.queryDiskAnn,
        async (req?: Partial<MemoryQueryRequest>) => {
          return provider.queryDiskAnn(req ?? {});
        },
      ),
      provider,
    );

    return provider;
  }

  /** Returns a defensive copy of the current Training Studio state. */
  public getState(): TrainingStudioState {
    return {
      ...this._state,
      rewardWeights: { ...this._state.rewardWeights },
    };
  }

  /** `vscode.WebviewViewProvider` entry point for sidebar rendering. */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, "dist")],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    const msgDisposable = webviewView.webview.onDidReceiveMessage((msg: TrainingStudioInboundMessage) => {
      void this._handleMessage(msg);
    });
    this._disposables.push(msgDisposable);

    webviewView.onDidDispose(() => {
      this._view = undefined;
    });

    this._postState();
  }

  /** Opens or reveals the full Training Studio (shared `@modelscript/editor` React UI) as an editor-area `WebviewPanel`. */
  public openPanel(column?: vscode.ViewColumn): vscode.WebviewPanel {
    const targetColumn = column ?? (vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One);

    if (this._panel) {
      this._panel.reveal(targetColumn);
      this._postState();
      this._postActiveDocumentToPanel();
      return this._panel;
    }

    const panel = vscode.window.createWebviewPanel(
      TrainingStudioPanelProvider.viewType,
      "Dynamic-m Training Studio",
      targetColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, "dist")],
      },
    );

    this._panel = panel;
    panel.webview.html = this._getSharedReactPanelHtml(panel.webview);

    const bridgeDisp = attachExtensionWebviewBridge(panel.webview, {
      client: this._client,
      getDocument: () => vscode.window.activeTextEditor?.document,
      title: "Dynamic-m Training Studio",
      onUnhandledMessage: async (msg) => {
        if (msg.type === "ready") {
          this._postState();
          this._postActiveDocumentToPanel();
          return;
        }
        await this._handleMessage(msg as TrainingStudioInboundMessage);
      },
    });
    this._disposables.push(bridgeDisp);

    const editorSyncDisp = vscode.window.onDidChangeActiveTextEditor(() => {
      this._postActiveDocumentToPanel();
    });
    this._disposables.push(editorSyncDisp);

    panel.onDidDispose(() => {
      this._panel = undefined;
    });

    this._postState();
    this._postActiveDocumentToPanel();
    return panel;
  }

  private _postActiveDocumentToPanel(): void {
    if (!this._panel) return;
    const doc = vscode.window.activeTextEditor?.document;
    void this._panel.webview.postMessage({
      type: "studioDocumentSync",
      data: {
        documentUri: doc?.uri.toString() ?? this._state.activeUri ?? "",
        dialect: doc?.languageId ?? this._state.activeDialect ?? "modelica",
        sourceCode: doc?.getText() ?? "",
        groupIdOverlayEnabled: this._state.groupIdOverlayEnabled,
        computeDialM: this._state.computeDialM,
      },
    });
  }

  private _getSharedReactPanelHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "training-studio-webview.js"),
    );
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource} https: http: data: blob:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dynamic-m Training Studio</title>
  <style>
    html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--vscode-editor-background, #0d1117); color: var(--vscode-editor-foreground, #c9d1d9); }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /** Updates the $m = 0 \leftrightarrow 32$ Test-Time Compute Dial and optional `retrievalTau`. */
  public setComputeDialM(m: number, retrievalTau?: number): void {
    this._state.computeDialM = clampComputeDialM(m, this._state.mCapMax);
    if (typeof retrievalTau === "number" && Number.isFinite(retrievalTau)) {
      this._state.retrievalTau = Math.max(0.01, Math.min(2.0, Number(retrievalTau.toFixed(3))));
    }
    this._onDidChangeState.fire(this.getState());
    this._postState();
  }

  /** Updates the 4-Gate RLVR + physics/CAD/zonotope reward weights. */
  public updateRewardWeights(weights: Partial<RlvrRewardWeights>): void {
    const cur = this._state.rewardWeights;
    this._state.rewardWeights = {
      gate1Syntax: clampWeight(weights.gate1Syntax ?? cur.gate1Syntax, cur.gate1Syntax),
      gate2Units: clampWeight(weights.gate2Units ?? cur.gate2Units, cur.gate2Units),
      gate3Smt: clampWeight(weights.gate3Smt ?? cur.gate3Smt, cur.gate3Smt),
      gate4Dae: clampWeight(weights.gate4Dae ?? cur.gate4Dae, cur.gate4Dae),
      physicsSim: clampWeight(weights.physicsSim ?? cur.physicsSim, cur.physicsSim),
      cadClearance: clampWeight(weights.cadClearance ?? cur.cadClearance, cur.cadClearance),
      zonotopeContraction: clampWeight(weights.zonotopeContraction ?? cur.zonotopeContraction, cur.zonotopeContraction),
    };
    this._onDidChangeState.fire(this.getState());
    this._postState();
  }

  /**
   * Toggles the live `group_id` relational hypergraph overlay in the active VS Code text editor.
   */
  public async toggleGroupIdOverlay(forceState?: boolean): Promise<GroupIdOverlayResult> {
    const nextEnabled = forceState !== undefined ? forceState : !this._state.groupIdOverlayEnabled;
    this._state.groupIdOverlayEnabled = nextEnabled;

    if (!nextEnabled) {
      this._clearEditorDecorations();
      this._onDidChangeState.fire(this.getState());
      this._postState();
      this._postMessage({ type: "hypergraphOverlayCleared" });
      return { enabled: false };
    }

    try {
      const record = await this.refreshActiveEditorOverlay();
      this._onDidChangeState.fire(this.getState());
      this._postState();
      return { enabled: true, record };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this._postMessage({ type: "hypergraphError", error: errMsg });
      return { enabled: true, error: errMsg };
    }
  }

  /**
   * Requests `modelscript/getRelationalHypergraph` from the LSP server for the active editor
   * and applies color-coded per-`group_id` token decorations.
   */
  public async refreshActiveEditorOverlay(): Promise<RelationalHypergraphRecord | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }

    const uri = editor.document.uri.toString();
    const dialect = editor.document.languageId || "modelica";
    this._state.activeUri = uri;
    this._state.activeDialect = dialect;

    if (!this._client) {
      this._postMessage({
        type: "hypergraphError",
        error: "Language server client is not attached; unable to fetch relational hypergraph.",
      });
      return undefined;
    }

    const resp = await this._client.sendRequest<{
      success: boolean;
      record?: RelationalHypergraphRecord;
      error?: string;
    }>("modelscript/getRelationalHypergraph", {
      uri,
      dialect,
    });

    if (!resp?.success || !resp.record) {
      throw new Error(resp?.error || "Failed to retrieve relational hypergraph from LSP.");
    }

    const record = resp.record;
    this._lastRecord = record;
    this._state.activeMInit = record.mInit;
    this._state.activeGroupCount = record.groups.length;

    if (this._state.groupIdOverlayEnabled) {
      this._applyEditorDecorations(editor, record);
    }

    this._postMessage({
      type: "hypergraphLoaded",
      uri,
      dialect: record.dialect,
      mInit: record.mInit,
      tokenCount: record.tokenIds.length,
      groups: record.groups,
    });

    return record;
  }

  /**
   * Queries the decoupled DiskANN vector-memory endpoint (`POST /api/v1/memory/query`)
   * in either hybrid text+semver or latent `W_q h_t + b_q` mode.
   */
  public async queryDiskAnn(request: Partial<MemoryQueryRequest>): Promise<TrainingStudioDiskAnnResult> {
    const mode = request.mode === "latent" ? "latent" : "hybrid";
    const embedderId = request.embedderId ?? this._state.embedderId;
    this._state.embedderId = embedderId;

    const payload: MemoryQueryRequest = {
      mode,
      embedderId,
      topK: request.topK ?? 8,
      includeSocialPosts: request.includeSocialPosts ?? true,
      ...(mode === "hybrid" ? { textQuery: request.textQuery ?? "" } : {}),
      ...(mode === "latent" ? { latentVector: request.latentVector ?? [] } : {}),
      ...(request.dialects ? { dialects: request.dialects } : {}),
      ...(request.packagePins ? { packagePins: request.packagePins } : {}),
    };

    try {
      const res = await fetch(`${this._apiBaseUrl}/memory/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        const result: TrainingStudioDiskAnnResult = {
          backend: "diskann",
          embedderId,
          latencyMs: 0,
          chunks: [],
          online: false,
          error: `DiskANN query failed (${res.status}): ${errText}`,
        };
        this._state.diskAnnOnline = false;
        this._postMessage({ type: "diskAnnResult", result });
        return result;
      }

      const data = (await res.json()) as MemoryQueryResponse;
      const result: TrainingStudioDiskAnnResult = {
        backend: "diskann",
        embedderId: data.embedderId ?? embedderId,
        latencyMs: data.latencyMs ?? 0,
        chunks: Array.isArray(data.chunks) ? data.chunks : [],
        online: true,
      };
      this._state.diskAnnOnline = true;
      this._postMessage({ type: "diskAnnResult", result });
      return result;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const result: TrainingStudioDiskAnnResult = {
        backend: "diskann",
        embedderId,
        latencyMs: 0,
        chunks: [],
        online: false,
        error: `DiskANN bridge offline (${this._apiBaseUrl}/memory/query): ${errMsg}`,
      };
      this._state.diskAnnOnline = false;
      this._postMessage({ type: "diskAnnResult", result });
      return result;
    }
  }

  public dispose(): void {
    this._clearEditorDecorations();
    this._onDidChangeState.dispose();
    if (this._panel) {
      this._panel.dispose();
      this._panel = undefined;
    }
    while (this._disposables.length > 0) {
      this._disposables.pop()?.dispose();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal Webview & Decoration Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private async _handleMessage(msg: TrainingStudioInboundMessage): Promise<void> {
    switch (msg.type) {
      case "ready": {
        this._postState();
        if (this._lastRecord) {
          this._postMessage({
            type: "hypergraphLoaded",
            uri: this._lastRecord.uri,
            dialect: this._lastRecord.dialect,
            mInit: this._lastRecord.mInit,
            tokenCount: this._lastRecord.tokenIds.length,
            groups: this._lastRecord.groups,
          });
        }
        break;
      }
      case "setComputeDialM": {
        this.setComputeDialM(msg.value, msg.retrievalTau);
        break;
      }
      case "updateRewardWeights": {
        this.updateRewardWeights(msg.weights);
        break;
      }
      case "toggleGroupIdOverlay": {
        await this.toggleGroupIdOverlay(msg.enabled);
        break;
      }
      case "refreshHypergraph": {
        try {
          await this.refreshActiveEditorOverlay();
          this._postState();
        } catch (err: unknown) {
          this._postMessage({
            type: "hypergraphError",
            error: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
      case "queryDiskAnn": {
        await this.queryDiskAnn({
          ...(msg.mode !== undefined ? { mode: msg.mode } : {}),
          textQuery: msg.textQuery,
          latentVector: msg.latentVector,
          embedderId: msg.embedderId,
          topK: msg.topK,
          includeSocialPosts: msg.includeSocialPosts,
          dialects: msg.dialects,
          packagePins: msg.packagePins,
        });
        break;
      }
    }
  }

  private _postState(): void {
    this._postMessage({ type: "stateSync", state: this.getState() });
  }

  private _postMessage(payload: Record<string, unknown>): void {
    if (this._view) {
      void this._view.webview.postMessage(payload);
    }
    if (this._panel) {
      void this._panel.webview.postMessage(payload);
    }
  }

  private _applyEditorDecorations(editor: vscode.TextEditor, record: RelationalHypergraphRecord): void {
    this._clearEditorDecorations();

    const createDeco = (
      vscode.window as unknown as {
        createTextEditorDecorationType?: (opts: vscode.DecorationRenderOptions) => vscode.TextEditorDecorationType;
      }
    ).createTextEditorDecorationType;

    if (typeof createDeco !== "function" || typeof editor.setDecorations !== "function") {
      return;
    }

    const byGroup = new Map<number, vscode.DecorationOptions[]>();
    const lockedRanges: vscode.DecorationOptions[] = [];

    for (const span of record.spans) {
      const range = new vscode.Range(
        Math.max(0, span.startLine - 1),
        Math.max(0, span.startColumn - 1),
        Math.max(0, span.endLine - 1),
        Math.max(0, span.endColumn - 1),
      );
      const hoverText =
        span.groupId === 0
          ? `group_id = 0 (locked syntax/invariant token)`
          : `group_id = ${span.groupId} (ε_${span.groupId}) | relType=${span.relTypeId} | sign=${span.relSign}${span.symbolName ? ` | symbol=${span.symbolName}` : ""}`;

      if (span.groupId === 0) {
        lockedRanges.push({ range, hoverMessage: hoverText });
      } else {
        const list = byGroup.get(span.groupId) ?? [];
        list.push({ range, hoverMessage: hoverText });
        byGroup.set(span.groupId, list);
      }
    }

    this._lockedDecoration = createDeco({
      opacity: "0.85",
      borderWidth: "0 0 1px 0",
      borderStyle: "dotted",
      borderColor: "rgba(148, 163, 184, 0.35)",
    });
    editor.setDecorations(this._lockedDecoration, lockedRanges);

    for (const [groupId, options] of byGroup) {
      const paletteIdx = (groupId - 1) % GROUP_OVERLAY_PALETTE.length;
      const bgColor = GROUP_OVERLAY_PALETTE[paletteIdx] ?? "rgba(56, 189, 248, 0.24)";
      const borderColor = GROUP_BORDER_PALETTE[paletteIdx] ?? "#38bdf8";
      const deco = createDeco({
        backgroundColor: bgColor,
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor,
        borderRadius: "2px",
      });
      this._groupDecorations.set(groupId, deco);
      editor.setDecorations(deco, options);
    }
  }

  private _clearEditorDecorations(): void {
    for (const deco of this._groupDecorations.values()) {
      deco.dispose();
    }
    this._groupDecorations.clear();
    if (this._lockedDecoration) {
      this._lockedDecoration.dispose();
      this._lockedDecoration = undefined;
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    const initialJson = JSON.stringify(this.getState()).replace(/</g, "\\u003c");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dynamic-m Training Studio</title>
  <style>
    :root {
      color-scheme: light dark;
      --border: var(--vscode-panel-border, rgba(128,128,128,0.28));
      --bg-card: var(--vscode-sideBar-background, rgba(128,128,128,0.08));
      --accent: var(--vscode-button-background, #0e639c);
      --accent-fg: var(--vscode-button-foreground, #ffffff);
      --muted: var(--vscode-descriptionForeground, #9ca3af);
    }
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .card {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      background: var(--bg-card);
    }
    h2 {
      margin: 0 0 8px 0;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: 6px 0;
    }
    .slider-label {
      flex: 1;
      font-size: 12px;
    }
    .slider-val {
      width: 44px;
      text-align: right;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    input[type="range"] {
      width: 110px;
      accent-color: var(--accent);
    }
    input[type="text"], select {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--border));
      border-radius: 4px;
      padding: 4px 6px;
      font-size: 12px;
    }
    button {
      background: var(--accent);
      color: var(--accent-fg);
      border: none;
      border-radius: 4px;
      padding: 5px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.22));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    }
    .pill-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 6px;
    }
    .badge {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 999px;
      border: 1px solid var(--border);
      color: var(--muted);
    }
    .chunk-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 8px;
      max-height: 220px;
      overflow-y: auto;
    }
    .chunk {
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 12px;
    }
    .chunk-meta {
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .muted {
      color: var(--muted);
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>
      <span>Test-Time Compute Dial (m = 0 &harr; 32)</span>
      <span id="dialBadge" class="badge">m = 16</span>
    </h2>
    <div class="row">
      <label class="slider-label" for="computeDialSlider">Active Zonotope Generators (m)</label>
      <input id="computeDialSlider" type="range" min="0" max="32" step="1" value="16" />
      <span id="computeDialVal" class="slider-val">16</span>
    </div>
    <div class="row">
      <label class="slider-label" for="tauSlider">Retrieval Threshold (&Delta;<sub>t</sub> &gt; &tau;)</label>
      <input id="tauSlider" type="range" min="0.05" max="1.5" step="0.05" value="0.35" />
      <span id="tauVal" class="slider-val">0.35</span>
    </div>
    <div class="pill-row">
      <button type="button" class="secondary" data-preset-m="0">m=0 Fast Point</button>
      <button type="button" class="secondary" data-preset-m="8">m=8 Balanced</button>
      <button type="button" class="secondary" data-preset-m="16">m=16 Certified</button>
      <button type="button" class="secondary" data-preset-m="32">m=32 Max</button>
    </div>
  </div>

  <div class="card">
    <h2>
      <span>4-Gate RLVR Reward Weights</span>
      <span id="weightSumBadge" class="badge">sum 10.75</span>
    </h2>
    <div id="rewardSliders"></div>
  </div>

  <div class="card">
    <h2>
      <span>Relational Hypergraph group_id Overlay</span>
      <span id="overlayBadge" class="badge">OFF</span>
    </h2>
    <div class="row">
      <button id="toggleOverlayBtn" type="button">Toggle group_id Overlay</button>
      <button id="refreshHypergraphBtn" type="button" class="secondary">Refresh Active File</button>
    </div>
    <div id="hypergraphStatus" class="muted">Inspect co-referent &epsilon;<sub>k</sub> generator groups in the active editor.</div>
    <div id="groupList" class="pill-row"></div>
  </div>

  <div class="card">
    <h2>
      <span>DiskANN Vector Memory Bridge</span>
      <span id="diskAnnBadge" class="badge">Idle</span>
    </h2>
    <div class="row">
      <select id="diskAnnMode">
        <option value="hybrid">Hybrid Text + Semver</option>
        <option value="latent">Latent W_q Projection</option>
      </select>
      <input id="embedderIdInput" type="text" value="ansatz-embed-v1" style="flex:1;" placeholder="embedderId" />
    </div>
    <div class="row">
      <input id="diskAnnQueryInput" type="text" style="flex:1;" placeholder="Query verified symbols, OWL2 axioms, or fixes..." />
      <button id="diskAnnQueryBtn" type="button">Query</button>
    </div>
    <div id="diskAnnStatus" class="muted"></div>
    <div id="diskAnnResults" class="chunk-list"></div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let state = ${initialJson};

    const SLIDER_SPECS = [
      { key: "gate1Syntax", label: "Gate 1: GLR Syntax" },
      { key: "gate2Units", label: "Gate 2: QUDV Units" },
      { key: "gate3Smt", label: "Gate 3: SMT Feasibility" },
      { key: "gate4Dae", label: "Gate 4: DAE Balance" },
      { key: "physicsSim", label: "Physics Simulation" },
      { key: "cadClearance", label: "CAD Clearance" },
      { key: "zonotopeContraction", label: "Zonotope Contraction" }
    ];

    const rewardSlidersEl = document.getElementById("rewardSliders");
    for (const spec of SLIDER_SPECS) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML =
        '<label class="slider-label">' + spec.label + '</label>' +
        '<input type="range" min="0" max="5" step="0.25" data-weight-key="' + spec.key + '" />' +
        '<span class="slider-val" id="val_' + spec.key + '"></span>';
      rewardSlidersEl.appendChild(row);
    }

    function renderState() {
      const dialSlider = document.getElementById("computeDialSlider");
      const tauSlider = document.getElementById("tauSlider");
      dialSlider.value = String(state.computeDialM);
      document.getElementById("computeDialVal").textContent = String(state.computeDialM);
      document.getElementById("dialBadge").textContent = "m = " + state.computeDialM;
      tauSlider.value = String(state.retrievalTau);
      document.getElementById("tauVal").textContent = Number(state.retrievalTau).toFixed(2);

      let sum = 0;
      for (const spec of SLIDER_SPECS) {
        const val = Number(state.rewardWeights[spec.key] ?? 0);
        sum += val;
        const input = rewardSlidersEl.querySelector('input[data-weight-key="' + spec.key + '"]');
        if (input) input.value = String(val);
        const valEl = document.getElementById("val_" + spec.key);
        if (valEl) valEl.textContent = val.toFixed(2);
      }
      document.getElementById("weightSumBadge").textContent = "sum " + sum.toFixed(2);
      document.getElementById("overlayBadge").textContent = state.groupIdOverlayEnabled ? "ON" : "OFF";
      document.getElementById("embedderIdInput").value = state.embedderId || "ansatz-embed-v1";
    }

    document.getElementById("computeDialSlider").addEventListener("input", (e) => {
      const val = Number(e.target.value);
      vscode.postMessage({ type: "setComputeDialM", value: val });
    });

    document.getElementById("tauSlider").addEventListener("input", (e) => {
      const tau = Number(e.target.value);
      vscode.postMessage({ type: "setComputeDialM", value: state.computeDialM, retrievalTau: tau });
    });

    document.querySelectorAll("button[data-preset-m]").forEach((btn) => {
      btn.addEventListener("click", () => {
        vscode.postMessage({ type: "setComputeDialM", value: Number(btn.getAttribute("data-preset-m")) });
      });
    });

    rewardSlidersEl.addEventListener("input", (e) => {
      const key = e.target.getAttribute("data-weight-key");
      if (!key) return;
      const weights = {};
      weights[key] = Number(e.target.value);
      vscode.postMessage({ type: "updateRewardWeights", weights });
    });

    document.getElementById("toggleOverlayBtn").addEventListener("click", () => {
      vscode.postMessage({ type: "toggleGroupIdOverlay" });
    });

    document.getElementById("refreshHypergraphBtn").addEventListener("click", () => {
      vscode.postMessage({ type: "refreshHypergraph" });
    });

    document.getElementById("diskAnnQueryBtn").addEventListener("click", () => {
      const mode = document.getElementById("diskAnnMode").value;
      const textQuery = document.getElementById("diskAnnQueryInput").value;
      const embedderId = document.getElementById("embedderIdInput").value;
      document.getElementById("diskAnnBadge").textContent = "Querying...";
      vscode.postMessage({ type: "queryDiskAnn", mode, textQuery, embedderId, topK: 8 });
    });

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "stateSync") {
        state = msg.state;
        renderState();
      } else if (msg.type === "hypergraphLoaded") {
        document.getElementById("hypergraphStatus").textContent =
          "m_init=" + msg.mInit + " | tokens=" + msg.tokenCount + " | dialect=" + msg.dialect;
        const groupList = document.getElementById("groupList");
        groupList.innerHTML = "";
        for (const g of (msg.groups || [])) {
          const pill = document.createElement("span");
          pill.className = "badge";
          pill.textContent = "ε_" + g.groupId + ": " + g.label + " (" + g.tokenCount + ")";
          groupList.appendChild(pill);
        }
      } else if (msg.type === "hypergraphError") {
        document.getElementById("hypergraphStatus").textContent = "Overlay error: " + msg.error;
      } else if (msg.type === "diskAnnResult") {
        const res = msg.result;
        document.getElementById("diskAnnBadge").textContent = res.online ? ("OK " + res.latencyMs + "ms") : "Offline";
        document.getElementById("diskAnnStatus").textContent = res.error ? res.error : ("Returned " + res.chunks.length + " chunk(s).");
        const container = document.getElementById("diskAnnResults");
        container.innerHTML = "";
        for (const c of (res.chunks || [])) {
          const div = document.createElement("div");
          div.className = "chunk";
          const meta = document.createElement("div");
          meta.className = "chunk-meta";
          meta.textContent = (c.formalVerified ? "[VERIFIED] " : "") + c.sourceKind + " | score=" + Number(c.score).toFixed(3);
          const body = document.createElement("div");
          body.textContent = c.content;
          div.appendChild(meta);
          div.appendChild(body);
          container.appendChild(div);
        }
      }
    });

    renderState();
    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
  }
}
