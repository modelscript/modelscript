// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide-client — Geometrical Optics, Photonics & Beam Propagation Panel
 *
 * Provides interactive optical bench layout, ray-tracing, chromatic aberration, and spot diagram inspection:
 * - 2D optical bench cross-section with glass lenses, mirrors, and aperture stops
 * - Multi-wavelength Fraunhofer C, d, F ray bundle tracing with Sellmeier glass dispersion
 * - 2D geometric spot diagram at image plane with Airy disk reference
 * - Longitudinal chromatic focal shift and RMS spot radius metrics
 * - Optical physics linter: Total Internal Reflection trap (OPT1001), beam clipping/vignetting (OPT1002),
 *   unphysical refractive index (OPT1003), lens mechanical collision (OPT1004).
 */

import {
  lintOpticalSystem,
  parseOpticalSystem,
  renderOpticalBenchSvg,
  type OpticalSystemData,
  type OptLintDiagnostic,
} from "@modelscript/diagram/optical-bench";
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

export class OpticalBenchPanel extends BaseWebviewPanel {
  public static currentPanel: OpticalBenchPanel | undefined;
  public static readonly viewType = "modelscript.opticalBenchViewer";

  private readonly _client?: LanguageClient | undefined;
  public targetUri: string | undefined;

  private _showRays = true;
  private _showSpotDiagram = true;
  private _selectedWavelengthNm: number | undefined;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, targetUri?: string): void {
    const activeEditorDoc = vscode.window.activeTextEditor?.document;
    const resolvedUri =
      targetUri ??
      (activeEditorDoc && activeEditorDoc.uri.scheme !== "output" ? activeEditorDoc.uri.toString() : undefined);

    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (OpticalBenchPanel.currentPanel) {
      if (resolvedUri) {
        OpticalBenchPanel.currentPanel.targetUri = resolvedUri;
      }
      OpticalBenchPanel.currentPanel._panel.reveal(column);
      OpticalBenchPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(OpticalBenchPanel.viewType, "Optical Bench & Ray-Tracing", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
    });

    OpticalBenchPanel.currentPanel = new OpticalBenchPanel(panel, extensionUri, client, resolvedUri);
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
        OpticalBenchPanel.currentPanel = undefined;
      },
      null,
      this._disposables,
    );

    this._panel.webview.onDidReceiveMessage(
      (message: { command: string; showRays?: boolean; showSpotDiagram?: boolean; wavelengthNm?: number }) => {
        switch (message.command) {
          case "updateSettings": {
            if (typeof message.showRays === "boolean") this._showRays = message.showRays;
            if (typeof message.showSpotDiagram === "boolean") this._showSpotDiagram = message.showSpotDiagram;
            if (typeof message.wavelengthNm === "number") this._selectedWavelengthNm = message.wavelengthNm;
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
    const data = this._resolveOpticsData();
    this._panel.webview.html = this._getHtmlForWebview(data);
  }

  private _getHtmlForWebview(data: OpticalSystemData): string {
    const diagnostics = lintOpticalSystem(data);

    const svg = renderOpticalBenchSvg(data, {
      width: 960,
      height: 540,
      showRays: this._showRays,
      showSpotDiagram: this._showSpotDiagram,
      selectedWavelengthNm: this._selectedWavelengthNm,
    });

    let diagsHtml = "";
    if (diagnostics.length === 0) {
      diagsHtml = `<div class="diag-clean">✔ Optical Bench Validated: Paraxial rays converge, no TIR traps, refractive indices physical, and no mechanical lens collisions.</div>`;
    } else {
      diagsHtml = diagnostics
        .map(
          (d: OptLintDiagnostic) => `
        <div class="diag-item ${d.severity}">
          <span class="diag-badge">[${escapeXml(d.code)}]</span>
          <span class="diag-msg">${escapeXml(d.message)}</span>
        </div>`,
        )
        .join("");
    }

    const elementsTableRows = data.elements
      .map(
        (e) => `
        <tr>
          <td><strong>${escapeXml(e.id)}</strong></td>
          <td>${escapeXml(e.name)}</td>
          <td><span class="type-badge ${e.type}">${e.type}</span></td>
          <td>${e.positionZMm.toFixed(1)} mm</td>
          <td>${e.diameterMm.toFixed(1)} mm</td>
          <td>${e.radiusFrontMm ? e.radiusFrontMm.toFixed(1) + " mm" : "Flat"}</td>
          <td>${e.radiusBackMm ? e.radiusBackMm.toFixed(1) + " mm" : "Flat"}</td>
          <td>${e.glass ?? "Air"}</td>
        </tr>`,
      )
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
      background: #10b981;
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
    select {
      background: var(--vscode-dropdown-background, #3c3c3c);
      color: var(--vscode-dropdown-foreground, #fff);
      border: 1px solid var(--vscode-dropdown-border, #555);
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 0.85em;
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
    .type-badge {
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 0.75em;
      font-weight: 600;
      text-transform: capitalize;
    }
    .type-badge.lens {
      background: rgba(56, 189, 248, 0.2);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.4);
    }
    .type-badge.aperture_stop {
      background: rgba(245, 158, 11, 0.2);
      color: #f59e0b;
      border: 1px solid rgba(245, 158, 11, 0.4);
    }
    .type-badge.image_plane {
      background: rgba(236, 72, 153, 0.2);
      color: #ec4899;
      border: 1px solid rgba(236, 72, 153, 0.4);
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
    <span>Geometrical Optics &amp; Beam Propagation Inspector</span>
    <span class="badge">Zemax / Ray-Trace</span>
  </h2>

  <div class="toolbar">
    <div class="control-group">
      <input type="checkbox" id="checkRays" ${this._showRays ? "checked" : ""}>
      <label for="checkRays">Ray Bundles</label>
    </div>
    <div class="control-group">
      <input type="checkbox" id="checkSpot" ${this._showSpotDiagram ? "checked" : ""}>
      <label for="checkSpot">Spot Diagram</label>
    </div>
    <div class="control-group">
      <label for="waveSelect">Wavelength:</label>
      <select id="waveSelect">
        <option value="0" ${!this._selectedWavelengthNm ? "selected" : ""}>All (C, d, F lines)</option>
        <option value="656.3" ${this._selectedWavelengthNm === 656.3 ? "selected" : ""}>656.3 nm (Red C-line)</option>
        <option value="587.6" ${this._selectedWavelengthNm === 587.6 ? "selected" : ""}>587.6 nm (Green d-line)</option>
        <option value="486.1" ${this._selectedWavelengthNm === 486.1 ? "selected" : ""}>486.1 nm (Blue F-line)</option>
      </select>
    </div>
  </div>

  <div class="svg-container">
    ${svg}
  </div>

  <div class="info-card">
    <div class="info-title">Optical Bench Prescription (${data.elements.length} Optical Surfaces)</div>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Type</th>
          <th>Z Position</th>
          <th>Diameter</th>
          <th>Front Radius R₁</th>
          <th>Back Radius R₂</th>
          <th>Glass</th>
        </tr>
      </thead>
      <tbody>
        ${elementsTableRows}
      </tbody>
    </table>

    <div class="info-title">Optical System Performance &amp; Aberrations</div>
    <table>
      <thead>
        <tr>
          <th>Effective Focal Length (EFL)</th>
          <th>Numerical Aperture (NA)</th>
          <th>Chromatic Focal Shift (Δf)</th>
          <th>RMS Geometric Spot Radius</th>
          <th>Ray Count</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>${data.effectiveFocalLengthMm.toFixed(2)} mm</strong></td>
          <td>${data.numericalAperture}</td>
          <td>${data.chromaticShiftMm.toFixed(4)} mm</td>
          <td>${data.rmsSpotRadiusUm.toFixed(2)} µm</td>
          <td>${data.rays.length} rays</td>
        </tr>
      </tbody>
    </table>

    <div class="info-title">Geometrical Optics &amp; TIR Physics Diagnostics</div>
    ${diagsHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    ['checkRays', 'checkSpot'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        vscode.postMessage({
          command: 'updateSettings',
          showRays: document.getElementById('checkRays').checked,
          showSpotDiagram: document.getElementById('checkSpot').checked
        });
      });
    });

    document.getElementById('waveSelect').addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      vscode.postMessage({ command: 'updateSettings', wavelengthNm: val > 0 ? val : undefined });
    });
  </script>
</body>
</html>`;
  }

  private _resolveOpticsData(): OpticalSystemData {
    if (this.targetUri) {
      try {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.targetUri);
        if (doc) {
          return parseOpticalSystem(doc.getText());
        }
      } catch {
        // Fall back to synthetic data
      }
    }
    return parseOpticalSystem("");
  }
}

export class OpticalBenchEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.opticalBenchEditor";

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    _webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    OpticalBenchPanel.createOrShow(this.extensionUri, undefined, document.uri.toString());
  }
}
