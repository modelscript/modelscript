// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide-client — CERN MAD-X Accelerator Lattice & Optics Panel
 *
 * Provides interactive accelerator optics and Twiss parameter visualization:
 * - Lattice magnet schematic badges (Dipoles, Quadrupoles, Sextupoles, Octupoles, RF Cavities, Drifts)
 * - Betatron amplitude functions beta_x(s) and beta_y(s)
 * - Horizontal dispersion function D_x(s)
 * - Relativistic beam envelopes sigma_x(s) and sigma_y(s) vs physical vacuum apertures
 * - Working point betatron tune resonance proximity and aperture breach diagnostics (HEP1001 - HEP1004)
 */

import {
  lintAcceleratorLattice,
  parseMadxLattice,
  renderAcceleratorLatticeSvg,
  type AcceleratorLatticeData,
  type LatticeLintDiagnostic,
} from "@modelscript/diagram/accelerator-lattice";
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

export class AcceleratorLatticePanel extends BaseWebviewPanel {
  public static currentPanel: AcceleratorLatticePanel | undefined;
  public static readonly viewType = "modelscript.acceleratorLatticeViewer";

  private readonly _client?: LanguageClient | undefined;
  public targetUri: string | undefined;

  private _showBeta = true;
  private _showDispersion = true;
  private _showEnvelope = true;
  private _showAperture = true;
  private _showBadges = true;
  private _energyOverride: number | undefined;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, targetUri?: string): void {
    const activeEditorDoc = vscode.window.activeTextEditor?.document;
    const resolvedUri =
      targetUri ??
      (activeEditorDoc && activeEditorDoc.uri.scheme !== "output" ? activeEditorDoc.uri.toString() : undefined);

    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (AcceleratorLatticePanel.currentPanel) {
      if (resolvedUri) {
        AcceleratorLatticePanel.currentPanel.targetUri = resolvedUri;
      }
      AcceleratorLatticePanel.currentPanel._panel.reveal(column);
      AcceleratorLatticePanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      AcceleratorLatticePanel.viewType,
      "Accelerator Lattice & Optics",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    AcceleratorLatticePanel.currentPanel = new AcceleratorLatticePanel(panel, extensionUri, client, resolvedUri);
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
        AcceleratorLatticePanel.currentPanel = undefined;
      },
      null,
      this._disposables,
    );

    this._panel.webview.onDidReceiveMessage(
      (message: {
        command: string;
        showBeta?: boolean;
        showDispersion?: boolean;
        showEnvelope?: boolean;
        showAperture?: boolean;
        showBadges?: boolean;
        energyOverride?: number;
      }) => {
        switch (message.command) {
          case "updateSettings": {
            if (typeof message.showBeta === "boolean") this._showBeta = message.showBeta;
            if (typeof message.showDispersion === "boolean") this._showDispersion = message.showDispersion;
            if (typeof message.showEnvelope === "boolean") this._showEnvelope = message.showEnvelope;
            if (typeof message.showAperture === "boolean") this._showAperture = message.showAperture;
            if (typeof message.showBadges === "boolean") this._showBadges = message.showBadges;
            if (typeof message.energyOverride === "number") this._energyOverride = message.energyOverride;
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
    const lattice = this._resolveLatticeData();
    if (this._energyOverride !== undefined && this._energyOverride > 0) {
      lattice.beam.energyGev = this._energyOverride;
    }
    this._panel.webview.html = this._getHtmlForWebview(lattice);
  }

  private _getHtmlForWebview(lattice: AcceleratorLatticeData): string {
    const diagnostics = lintAcceleratorLattice(lattice);

    const svg = renderAcceleratorLatticeSvg(lattice, {
      width: 900,
      height: 480,
      showBeta: this._showBeta,
      showDispersion: this._showDispersion,
      showEnvelope: this._showEnvelope,
      showAperture: this._showAperture,
      showBadges: this._showBadges,
    });

    let diagsHtml = "";
    if (diagnostics.length === 0) {
      diagsHtml = `<div class="diag-clean">✔ Accelerator Optics Validated: Working point stable, no aperture breaches or integer resonance proximity detected.</div>`;
    } else {
      diagsHtml = diagnostics
        .map(
          (d: LatticeLintDiagnostic) => `
        <div class="diag-item ${d.severity}">
          <span class="diag-badge">[${escapeXml(d.code)}]</span>
          <span class="diag-msg">${escapeXml(d.message)}</span>
        </div>`,
        )
        .join("");
    }

    let maxBetaX = 0;
    let maxBetaY = 0;
    let maxDx = 0;
    let maxSigmaX = 0;
    let maxSigmaY = 0;

    for (const pt of lattice.twiss) {
      if (pt.betaX > maxBetaX) maxBetaX = pt.betaX;
      if (pt.betaY > maxBetaY) maxBetaY = pt.betaY;
      if (Math.abs(pt.dispersionX) > maxDx) maxDx = Math.abs(pt.dispersionX);
      if (pt.envelopeX > maxSigmaX) maxSigmaX = pt.envelopeX;
      if (pt.envelopeY > maxSigmaY) maxSigmaY = pt.envelopeY;
    }

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
      background: #111827;
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
    <span>Accelerator Lattice &amp; Optics Inspector</span>
    <span class="badge">MAD-X / Twiss</span>
  </h2>

  <div class="toolbar">
    <div class="control-group">
      <input type="checkbox" id="checkBeta" ${this._showBeta ? "checked" : ""}>
      <label for="checkBeta">Beta Functions (&beta;<sub>x</sub>, &beta;<sub>y</sub>)</label>
    </div>
    <div class="control-group">
      <input type="checkbox" id="checkDispersion" ${this._showDispersion ? "checked" : ""}>
      <label for="checkDispersion">Dispersion (D<sub>x</sub>)</label>
    </div>
    <div class="control-group">
      <input type="checkbox" id="checkEnvelope" ${this._showEnvelope ? "checked" : ""}>
      <label for="checkEnvelope">Beam Envelope (&plusmn;&sigma;)</label>
    </div>
    <div class="control-group">
      <input type="checkbox" id="checkAperture" ${this._showAperture ? "checked" : ""}>
      <label for="checkAperture">Aperture Limit</label>
    </div>
    <div class="control-group">
      <input type="checkbox" id="checkBadges" ${this._showBadges ? "checked" : ""}>
      <label for="checkBadges">Magnet Badges</label>
    </div>
    <div class="control-group">
      <label for="energyInput">Energy (GeV):</label>
      <input type="number" id="energyInput" min="0.1" max="100000" step="0.5" value="${lattice.beam.energyGev}" style="width: 70px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #fff); border: 1px solid #555; padding: 2px 4px; border-radius: 3px;">
    </div>
  </div>

  <div class="svg-container">
    ${svg}
  </div>

  <div class="info-card">
    <div class="info-title">Lattice &amp; Beam Optics Parameters</div>
    <table>
      <thead>
        <tr>
          <th>Lattice Sequence</th>
          <th>Beam Particle</th>
          <th>Beam Energy</th>
          <th>Total Length</th>
          <th>Tune Q<sub>x</sub></th>
          <th>Tune Q<sub>y</sub></th>
          <th>Max &beta;<sub>x</sub>, &beta;<sub>y</sub></th>
          <th>Max D<sub>x</sub></th>
          <th>Max &sigma;<sub>x</sub>, &sigma;<sub>y</sub></th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>${escapeXml(lattice.title)}</strong></td>
          <td>${escapeXml(lattice.beam.particle)}</td>
          <td>${lattice.beam.energyGev.toFixed(2)} GeV</td>
          <td>${lattice.totalLength.toFixed(2)} m</td>
          <td>${lattice.tuneX.toFixed(3)}</td>
          <td>${lattice.tuneY.toFixed(3)}</td>
          <td>${maxBetaX.toFixed(2)} m, ${maxBetaY.toFixed(2)} m</td>
          <td>${maxDx.toFixed(3)} m</td>
          <td>${maxSigmaX.toFixed(2)} mm, ${maxSigmaY.toFixed(2)} mm</td>
        </tr>
      </tbody>
    </table>

    <div class="info-title">Accelerator Optics &amp; Resonance Diagnostics</div>
    ${diagsHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    ['checkBeta', 'checkDispersion', 'checkEnvelope', 'checkAperture', 'checkBadges'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        vscode.postMessage({
          command: 'updateSettings',
          showBeta: document.getElementById('checkBeta').checked,
          showDispersion: document.getElementById('checkDispersion').checked,
          showEnvelope: document.getElementById('checkEnvelope').checked,
          showAperture: document.getElementById('checkAperture').checked,
          showBadges: document.getElementById('checkBadges').checked
        });
      });
    });

    document.getElementById('energyInput').addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val > 0) {
        vscode.postMessage({ command: 'updateSettings', energyOverride: val });
      }
    });
  </script>
</body>
</html>`;
  }

  private _resolveLatticeData(): AcceleratorLatticeData {
    if (this.targetUri) {
      try {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.targetUri);
        if (doc) {
          return parseMadxLattice(doc.getText());
        }
      } catch {
        // Fall back to synthetic data
      }
    }
    return parseMadxLattice("");
  }
}

export class AcceleratorLatticeEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.acceleratorLatticeEditor";

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    _webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    AcceleratorLatticePanel.createOrShow(this.extensionUri, undefined, document.uri.toString());
  }
}
