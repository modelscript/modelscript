// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide-client — Neuroscience, Neural Electrophysiology & Spike Raster Panel
 *
 * Provides interactive multi-channel neural electrophysiology inspection, spike raster plots, and PSTH analysis:
 * - 2D multi-unit action potential spike raster plot with stimulus event markers
 * - Population peristimulus time histogram (PSTH) firing rate analyzer with adjustable bin widths
 * - Multi-channel continuous Local Field Potential (LFP) oscilloscope
 * - Signal integrity diagnostics (sampling jitter, voltage saturation, dead electrode, refractory violation)
 */

import {
  computePsth,
  lintNeuralRecording,
  parseNeuralRecording,
  renderNeuralSpikeSvg,
  type NeuralRecordingData,
  type NeuroLintDiagnostic,
} from "@modelscript/diagram/neural-spike";
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

export class NeuralSpikeViewerPanel extends BaseWebviewPanel {
  public static currentPanel: NeuralSpikeViewerPanel | undefined;
  public static readonly viewType = "modelscript.neuralSpikeViewer";

  private readonly _client?: LanguageClient | undefined;
  public targetUri: string | undefined;

  private _showLfp = true;
  private _showPsth = true;
  private _showStimuli = true;
  private _binWidthSec = 0.05;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, targetUri?: string): void {
    const activeEditorDoc = vscode.window.activeTextEditor?.document;
    const resolvedUri =
      targetUri ??
      (activeEditorDoc && activeEditorDoc.uri.scheme !== "output" ? activeEditorDoc.uri.toString() : undefined);

    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (NeuralSpikeViewerPanel.currentPanel) {
      if (resolvedUri) {
        NeuralSpikeViewerPanel.currentPanel.targetUri = resolvedUri;
      }
      NeuralSpikeViewerPanel.currentPanel._panel.reveal(column);
      NeuralSpikeViewerPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      NeuralSpikeViewerPanel.viewType,
      "Neural Spike Electrophysiology",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    NeuralSpikeViewerPanel.currentPanel = new NeuralSpikeViewerPanel(panel, extensionUri, client, resolvedUri);
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

    this.update();

    this._panel.onDidDispose(
      () => {
        NeuralSpikeViewerPanel.currentPanel = undefined;
      },
      null,
      this._disposables,
    );

    this._panel.webview.onDidReceiveMessage(
      (message: {
        command: string;
        showLfp?: boolean;
        showPsth?: boolean;
        showStimuli?: boolean;
        binWidthSec?: number;
      }) => {
        switch (message.command) {
          case "updateSettings": {
            if (typeof message.showLfp === "boolean") this._showLfp = message.showLfp;
            if (typeof message.showPsth === "boolean") this._showPsth = message.showPsth;
            if (typeof message.showStimuli === "boolean") this._showStimuli = message.showStimuli;
            if (typeof message.binWidthSec === "number") this._binWidthSec = message.binWidthSec;
            this.update();
            break;
          }
        }
      },
      null,
      this._disposables,
    );
  }

  public update(): void {
    const data = this._resolveNeuralData();
    this._panel.webview.html = this._getHtmlForWebview(data);
  }

  private _getHtmlForWebview(data: NeuralRecordingData): string {
    const diagnostics = lintNeuralRecording(data);
    const psth = computePsth(data.units, data.durationSeconds, this._binWidthSec);

    const svg = renderNeuralSpikeSvg(data, psth, {
      width: 960,
      height: 600,
      showLfp: this._showLfp,
      showPsth: this._showPsth,
      showStimuli: this._showStimuli,
      binWidthSec: this._binWidthSec,
    });

    let diagsHtml = "";
    if (diagnostics.length === 0) {
      diagsHtml = `<div class="diag-clean">✔ Neural Signal Integrity Validated: Sampling rates uniform, no amplifier rail saturation, no dead electrodes, and refractory periods respected.</div>`;
    } else {
      diagsHtml = diagnostics
        .map(
          (d: NeuroLintDiagnostic) => `
        <div class="diag-item ${d.severity}">
          <span class="diag-badge">[${escapeXml(d.code)}]</span>
          <span class="diag-msg">${escapeXml(d.message)}</span>
        </div>`,
        )
        .join("");
    }

    const unitsTableRows = data.units
      .map(
        (u) => `
        <tr>
          <td><strong>Unit #${u.unitId}</strong></td>
          <td>${escapeXml(u.channelId)}</td>
          <td><span class="cell-badge ${u.cellType ?? "unclassified"}">${u.cellType ?? "unclassified"}</span></td>
          <td>${u.spikeTimesSeconds.length} spikes</td>
          <td>${(u.meanFiringRateHz ?? u.spikeTimesSeconds.length / (data.durationSeconds || 1)).toFixed(1)} Hz</td>
        </tr>`,
      )
      .join("");

    const channelsTableRows = data.channels
      .map((ch) => {
        let minV = Infinity,
          maxV = -Infinity;
        for (const v of ch.samples) {
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
        const vpp = minV !== Infinity ? maxV - minV : 0;
        return `
        <tr>
          <td><strong>${escapeXml(ch.id)}</strong></td>
          <td>${escapeXml(ch.label)}</td>
          <td>${escapeXml(ch.brainRegion)}</td>
          <td>${ch.samplingRateHz} Hz</td>
          <td>${ch.samples.length}</td>
          <td>${vpp.toFixed(1)} µV</td>
        </tr>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      margin: 0;
      padding: 16px;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      background-color: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #cccccc);
    }
    h2 {
      margin-top: 0;
      font-size: 1.15em;
      color: var(--vscode-foreground, #ffffff);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badge {
      font-size: 0.75em;
      padding: 2px 6px;
      border-radius: 3px;
      background: #0284c7;
      color: #fff;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px;
      margin-bottom: 12px;
      padding: 10px 14px;
      background: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-widget-border, #333333);
      border-radius: 6px;
    }
    .control-group {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85em;
    }
    .control-group label {
      cursor: pointer;
    }
    .svg-container {
      background: #0c1017;
      border: 1px solid var(--vscode-widget-border, #374151);
      border-radius: 6px;
      padding: 12px;
      display: flex;
      justify-content: center;
      overflow-x: auto;
    }
    .info-card {
      margin-top: 14px;
      padding: 14px;
      background: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-widget-border, #333333);
      border-radius: 6px;
    }
    .info-title {
      font-weight: 600;
      margin-bottom: 8px;
      font-size: 0.9em;
      color: var(--vscode-foreground, #ffffff);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82em;
      margin-bottom: 12px;
    }
    th, td {
      text-align: left;
      padding: 5px 8px;
      border-bottom: 1px solid var(--vscode-widget-border, #333333);
    }
    th {
      color: #94a3b8;
    }
    .cell-badge {
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 0.75em;
      font-weight: 600;
      text-transform: capitalize;
    }
    .cell-badge.pyramidal {
      background: rgba(56, 189, 248, 0.2);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.4);
    }
    .cell-badge.interneuron {
      background: rgba(251, 146, 60, 0.2);
      color: #fb923c;
      border: 1px solid rgba(251, 146, 60, 0.4);
    }
    .cell-badge.unclassified {
      background: rgba(168, 85, 247, 0.2);
      color: #c084fc;
      border: 1px solid rgba(168, 85, 247, 0.4);
    }
    .diag-clean {
      color: #4ade80;
      font-size: 0.85em;
      padding: 8px 12px;
      background: rgba(74, 222, 128, 0.1);
      border-radius: 4px;
      border: 1px solid rgba(74, 222, 128, 0.2);
    }
    .diag-item {
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 0.82em;
      margin-bottom: 6px;
      display: flex;
      gap: 8px;
    }
    .diag-item.warning {
      background: rgba(250, 204, 21, 0.12);
      border: 1px solid rgba(250, 204, 21, 0.3);
      color: #fde047;
    }
    .diag-item.error {
      background: rgba(248, 113, 113, 0.12);
      border: 1px solid rgba(248, 113, 113, 0.3);
      color: #fca5a5;
    }
    .diag-badge {
      font-family: monospace;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <h2>
    <span>Neural Electrophysiology &amp; Spike Raster Inspector</span>
    <span class="badge">NWB / Neuropixels</span>
  </h2>

  <div class="toolbar">
    <div class="control-group">
      <input type="checkbox" id="checkPsth" ${this._showPsth ? "checked" : ""}>
      <label for="checkPsth">PSTH Firing Rate</label>
    </div>
    <div class="control-group">
      <input type="checkbox" id="checkLfp" ${this._showLfp ? "checked" : ""}>
      <label for="checkLfp">LFP Oscilloscope</label>
    </div>
    <div class="control-group">
      <input type="checkbox" id="checkStimuli" ${this._showStimuli ? "checked" : ""}>
      <label for="checkStimuli">Stimulus Markers</label>
    </div>
    <div class="control-group">
      <label for="binSlider">Bin Width (ms):</label>
      <input type="range" id="binSlider" min="10" max="200" step="10" value="${Math.round(this._binWidthSec * 1000)}">
      <span id="binLabel">${Math.round(this._binWidthSec * 1000)} ms</span>
    </div>
  </div>

  <div class="svg-container">
    ${svg}
  </div>

  <div class="info-card">
    <div class="info-title">Sorted Multi-Unit Activity (${data.units.length} Units &bull; ${psth.totalSpikes} Total Action Potentials)</div>
    <table>
      <thead>
        <tr>
          <th>Unit ID</th>
          <th>Electrode</th>
          <th>Cell Type</th>
          <th>Spike Count</th>
          <th>Mean Firing Rate</th>
        </tr>
      </thead>
      <tbody>
        ${unitsTableRows}
      </tbody>
    </table>

    <div class="info-title">Recording Channels &amp; Field Potentials (${data.channels.length} Channels)</div>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Label</th>
          <th>Brain Region</th>
          <th>Sampling Rate</th>
          <th>Samples</th>
          <th>Peak-to-Peak</th>
        </tr>
      </thead>
      <tbody>
        ${channelsTableRows}
      </tbody>
    </table>

    <div class="info-title">Physiological Signal Integrity &amp; Sorting Diagnostics</div>
    ${diagsHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    ['checkPsth', 'checkLfp', 'checkStimuli'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        vscode.postMessage({
          command: 'updateSettings',
          showPsth: document.getElementById('checkPsth').checked,
          showLfp: document.getElementById('checkLfp').checked,
          showStimuli: document.getElementById('checkStimuli').checked
        });
      });
    });

    document.getElementById('binSlider').addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      document.getElementById('binLabel').innerText = val + ' ms';
      vscode.postMessage({ command: 'updateSettings', binWidthSec: val / 1000.0 });
    });
  </script>
</body>
</html>`;
  }

  private _resolveNeuralData(): NeuralRecordingData {
    if (this.targetUri) {
      try {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.targetUri);
        if (doc) {
          return parseNeuralRecording(doc.getText());
        }
      } catch {
        // Fall back to synthetic data
      }
    }
    return parseNeuralRecording("");
  }
}

export class NeuralSpikeViewerEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.neuralSpikeEditor";

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    _webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    NeuralSpikeViewerPanel.createOrShow(this.extensionUri, undefined, document.uri.toString());
  }
}
