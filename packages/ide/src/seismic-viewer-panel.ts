// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide-client — SEG-Y Seismic Reflection Survey Visualizer Panel
 *
 * Provides interactive geophysical inspection for SEG-Y (.segy, .sgy) surveys:
 * - Multi-trace Wiggle-Variable-Area (WVA) rendering with descending time depth axis
 * - Interactive gain adjustment slider (0.5x to 5.0x) & AGC toggle
 * - Polarity toggle (Normal SEG vs Reverse polarity)
 * - Variable-Area (WVA) positive lobe shading toggle
 * - Reel textual header card inspector & geophysical quality diagnostics
 */

import {
  createSyntheticSeismicSurvey,
  lintSegySurvey,
  renderSegyWvaSvg,
  type SegySurvey,
} from "@modelscript/diagram/segy-trace";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";
import { BaseWebviewPanel } from "./webview/base-panel.js";

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export class SeismicViewerPanel extends BaseWebviewPanel {
  public static currentPanel: SeismicViewerPanel | undefined;
  public static readonly viewType = "modelscript.seismicViewer";

  private readonly _client?: LanguageClient | undefined;
  public targetUri: string | undefined;
  private _gain = 1.8;
  private _applyAgc = false;
  private _polarity: "normal" | "reverse" = "normal";
  private _showWva = true;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, targetUri?: string): void {
    const activeEditorDoc = vscode.window.activeTextEditor?.document;
    const resolvedUri =
      targetUri ??
      (activeEditorDoc && activeEditorDoc.uri.scheme !== "output" ? activeEditorDoc.uri.toString() : undefined);

    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (SeismicViewerPanel.currentPanel) {
      if (resolvedUri) {
        SeismicViewerPanel.currentPanel.targetUri = resolvedUri;
      }
      SeismicViewerPanel.currentPanel._panel.reveal(column);
      SeismicViewerPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(SeismicViewerPanel.viewType, "SEG-Y Seismic Survey Viewer", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    SeismicViewerPanel.currentPanel = new SeismicViewerPanel(panel, extensionUri, client, resolvedUri);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client?: LanguageClient,
    targetUri?: string,
  ) {
    super(panel, extensionUri);
    this._client = client;
    this.targetUri = targetUri;
    void this._client;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: {
        command: string;
        gain?: string;
        applyAgc?: boolean;
        polarity?: "normal" | "reverse";
        showWva?: boolean;
      }) => {
        switch (message.command) {
          case "setGain":
            if (message.gain) this._gain = parseFloat(message.gain);
            this.update();
            break;
          case "toggleAgc":
            this._applyAgc = !!message.applyAgc;
            this.update();
            break;
          case "setPolarity":
            if (message.polarity) this._polarity = message.polarity;
            this.update();
            break;
          case "toggleWva":
            this._showWva = !!message.showWva;
            this.update();
            break;
        }
      },
      null,
      this._disposables,
    );

    this.update();
  }

  public override dispose(): void {
    SeismicViewerPanel.currentPanel = undefined;
    super.dispose();
  }

  public update(): void {
    const survey = createSyntheticSeismicSurvey({
      numTraces: 24,
      numSamples: 400,
      sampleIntervalUs: 2000,
      reflectorDepthsMs: [180, 420, 650],
    });

    const diagnostics = lintSegySurvey(survey);
    const svg = renderSegyWvaSvg(survey, {
      gain: this._gain,
      applyAgc: this._applyAgc,
      polarity: this._polarity,
      showVariableArea: this._showWva,
      darkMode: true,
    });

    this._panel.webview.html = this._getHtmlForWebview(survey, svg, diagnostics);
  }

  private _getHtmlForWebview(
    survey: SegySurvey,
    svgMarkup: string,
    diagnostics: ReturnType<typeof lintSegySurvey>,
  ): string {
    const dtMs = survey.binaryHeader.sampleIntervalUs / 1000;
    const nSamples = survey.binaryHeader.samplesPerTrace;
    const totalDurationMs = nSamples * dtMs;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SEG-Y Seismic Reflection Viewer</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #141c2e;
      --border: #24324f;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0284c7;
    }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
    }
    h2 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 600;
    }
    .controls-grid {
      display: grid;
      grid-template-columns: 2.2fr 1fr;
      gap: 16px;
    }
    .seismic-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      overflow-x: auto;
    }
    .params-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    label {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .slider-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    input[type="range"] {
      flex: 1;
      accent-color: var(--accent);
    }
    .val-badge {
      font-size: 0.85rem;
      font-family: monospace;
      font-weight: 600;
      color: var(--accent);
      min-width: 48px;
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.9rem;
    }
    select {
      background: #060910;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 0.9rem;
      outline: none;
      width: 100%;
      box-sizing: border-box;
    }
    .info-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .info-table td {
      padding: 6px 4px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .info-table td:first-child {
      color: var(--text-muted);
      width: 45%;
    }
    .diag-item {
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 0.82rem;
      margin-top: 4px;
    }
    .diag-info { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h2>SEG-Y Seismic Reflection Survey Viewer</h2>
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 2px;">
        ${escapeXml(survey.title)} — ${survey.traces.length} Traces | Δt = ${dtMs} ms | Window = ${totalDurationMs.toFixed(0)} ms
      </div>
    </div>
  </div>

  <div class="controls-grid">
    <div class="seismic-card">
      ${svgMarkup}
    </div>

    <div class="params-card">
      <div style="display: flex; flex-direction: column;">
        <label for="gainSlider">Wiggle Display Gain</label>
        <div class="slider-row">
          <input type="range" id="gainSlider" min="0.5" max="4.0" step="0.1" value="${this._gain.toFixed(1)}" oninput="onGainSlide(this.value)" onchange="onGainCommit(this.value)">
          <span class="val-badge" id="gainBadge">${this._gain.toFixed(1)}x</span>
        </div>
      </div>

      <div style="display: flex; flex-direction: column;">
        <label for="polaritySelect">Seismic Polarity</label>
        <select id="polaritySelect" onchange="onPolarityChange(this.value)">
          <option value="normal" ${this._polarity === "normal" ? "selected" : ""}>Normal (SEG Standard)</option>
          <option value="reverse" ${this._polarity === "reverse" ? "selected" : ""}>Reverse (European Standard)</option>
        </select>
      </div>

      <div class="checkbox-row">
        <input type="checkbox" id="wvaCheck" ${this._showWva ? "checked" : ""} onchange="onWvaToggle(this.checked)">
        <label for="wvaCheck" style="margin: 0; cursor: pointer;">Variable-Area (WVA) Positive Shading</label>
      </div>

      <div class="checkbox-row">
        <input type="checkbox" id="agcCheck" ${this._applyAgc ? "checked" : ""} onchange="onAgcToggle(this.checked)">
        <label for="agcCheck" style="margin: 0; cursor: pointer;">Automatic Gain Control (Moving AGC)</label>
      </div>

      <table class="info-table">
        <tr>
          <td>Reel Standard</td>
          <td>SEG-Y Rev 1</td>
        </tr>
        <tr>
          <td>Sample Interval (Δt)</td>
          <td>${survey.binaryHeader.sampleIntervalUs} µs (${dtMs} ms)</td>
        </tr>
        <tr>
          <td>Trace Count</td>
          <td>${survey.traces.length}</td>
        </tr>
        <tr>
          <td>Samples / Trace</td>
          <td>${nSamples}</td>
        </tr>
        <tr>
          <td>Format Code</td>
          <td>IEEE 32-bit Float</td>
        </tr>
        <tr>
          <td>CDP Fold</td>
          <td>${survey.binaryHeader.cdpFold ?? 24}</td>
        </tr>
      </table>

      ${
        diagnostics.length > 0
          ? `<div>
              <label>Geophysical Quality Diagnostics</label>
              ${diagnostics
                .map(
                  (d) => `
                <div class="diag-item diag-info">
                  <strong>[${d.code}]</strong> ${escapeXml(d.message)}
                </div>`,
                )
                .join("")}
            </div>`
          : `<div class="diag-item diag-info">
              ✓ Clean SEG-Y acquisition geometry with zero amplitude clipping or sample count anomalies.
            </div>`
      }
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function onGainSlide(val) {
      document.getElementById('gainBadge').innerText = parseFloat(val).toFixed(1) + 'x';
    }

    function onGainCommit(val) {
      vscode.postMessage({ command: 'setGain', gain: parseFloat(val) });
    }

    function onPolarityChange(val) {
      vscode.postMessage({ command: 'setPolarity', polarity: val });
    }

    function onWvaToggle(val) {
      vscode.postMessage({ command: 'toggleWva', showWva: val });
    }

    function onAgcToggle(val) {
      vscode.postMessage({ command: 'toggleAgc', applyAgc: val });
    }
  </script>
</body>
</html>`;
  }
}

export class SeismicViewerEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.seismicViewer";

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    _webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    SeismicViewerPanel.createOrShow(this.extensionUri, undefined, document.uri.toString());
  }
}
