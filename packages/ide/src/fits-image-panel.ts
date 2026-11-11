// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide-client — FITS Astronomical Image Viewer Panel
 *
 * Provides interactive astronomical image inspection and aperture photometry for FITS files (.fits, .fit, .fts):
 * - 2D astronomical image display with non-linear contrast stretches (arcsinh, log, zscale, sqrt, linear)
 * - False-color scientific look-up tables (LUTs): Grayscale, Heat/Inferno, Viridis, Coolwarm, Magma
 * - Interactive target crosshairs with World Coordinate System (WCS) RA / Dec conversion
 * - Circular aperture photometry and Radial Point Spread Function (PSF) profile with FWHM measurement
 * - Astronomical header keywords inspector (OBJECT, TELESCOP, EXPTIME, FILTER, BITPIX) & astrometry linter
 */

import {
  computeAperturePhotometry,
  lintFitsImage,
  parseFits,
  renderFitsImageSvg,
  type FitsColormap,
  type FitsHdu,
  type FitsStretchType,
} from "@modelscript/diagram/fits-astro";
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

export class FitsImageViewerPanel extends BaseWebviewPanel {
  public static currentPanel: FitsImageViewerPanel | undefined;
  public static readonly viewType = "modelscript.fitsImageViewer";

  private readonly _client?: LanguageClient | undefined;
  public targetUri: string | undefined;

  private _stretch: FitsStretchType = "arcsinh";
  private _colormap: FitsColormap = "heat";
  private _targetCoord?: [number, number] | undefined;
  private _photometryRadius = 10;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, targetUri?: string): void {
    const activeEditorDoc = vscode.window.activeTextEditor?.document;
    const resolvedUri =
      targetUri ??
      (activeEditorDoc && activeEditorDoc.uri.scheme !== "output" ? activeEditorDoc.uri.toString() : undefined);

    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (FitsImageViewerPanel.currentPanel) {
      if (resolvedUri) {
        FitsImageViewerPanel.currentPanel.targetUri = resolvedUri;
      }
      FitsImageViewerPanel.currentPanel._panel.reveal(column);
      FitsImageViewerPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      FitsImageViewerPanel.viewType,
      "FITS Astronomical Image Viewer",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    FitsImageViewerPanel.currentPanel = new FitsImageViewerPanel(panel, extensionUri, client, resolvedUri);
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
        FitsImageViewerPanel.currentPanel = undefined;
      },
      null,
      this._disposables,
    );

    this._panel.webview.onDidReceiveMessage(
      (message: {
        command: string;
        stretch?: string;
        colormap?: string;
        targetCoord?: [number, number];
        photometryRadius?: number;
      }) => {
        switch (message.command) {
          case "updateSettings": {
            if (typeof message.stretch === "string") {
              this._stretch = message.stretch as FitsStretchType;
            }
            if (typeof message.colormap === "string") {
              this._colormap = message.colormap as FitsColormap;
            }
            if (Array.isArray(message.targetCoord) && message.targetCoord.length === 2) {
              this._targetCoord = [Number(message.targetCoord[0]), Number(message.targetCoord[1])];
            }
            if (typeof message.photometryRadius === "number") {
              this._photometryRadius = Math.max(3, Math.min(30, message.photometryRadius));
            }
            this.update();
            break;
          }
          case "refresh":
            this.update();
            break;
        }
      },
      null,
      this._disposables,
    );
  }

  public update(): void {
    this._panel.webview.html = this.getHtmlForWebview();
  }

  protected getHtmlForWebview(): string {
    const hdu = this._resolveFitsHdu();
    const targetX = this._targetCoord ? this._targetCoord[0] : Math.round(hdu.width / 2);
    const targetY = this._targetCoord ? this._targetCoord[1] : Math.round(hdu.height / 2);

    const photometry = computeAperturePhotometry(hdu.data, targetX, targetY, this._photometryRadius);
    const diagnostics = lintFitsImage(hdu);

    const svg = renderFitsImageSvg(hdu, {
      width: 920,
      height: 600,
      stretch: this._stretch,
      colormap: this._colormap,
      targetCoord: [targetX, targetY],
      photometryRadius: this._photometryRadius,
      darkMode: true,
    });

    const diagsHtml =
      diagnostics.length === 0
        ? `<div style="color: #3fb950; font-size: 12px; margin-top: 4px;">✓ FITS header integrity, WCS coordinates, and flux dynamic range verified.</div>`
        : diagnostics
            .map((d) => {
              const col = d.severity === "error" ? "#f85149" : "#d29922";
              const icon = d.severity === "error" ? "✖" : "⚠";
              return `<div style="color: ${col}; font-size: 11.5px; margin-top: 3px;"><strong>${icon} [${d.code}]</strong> ${escapeXml(d.message)}</div>`;
            })
            .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      background-color: var(--vscode-editor-background, #0c1017);
      color: var(--vscode-editor-foreground, #e6edf3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 16px;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px;
      margin-bottom: 12px;
      padding: 10px 14px;
      background: var(--vscode-sideBar-background, #161b22);
      border: 1px solid var(--vscode-panel-border, #30363d);
      border-radius: 6px;
    }
    .tool-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }
    select, input[type="number"], input[type="range"] {
      background: var(--vscode-input-background, #21262d);
      color: var(--vscode-input-foreground, #c9d1d9);
      border: 1px solid var(--vscode-input-border, #30363d);
      border-radius: 4px;
      padding: 3px 6px;
      font-size: 12px;
    }
    .canvas-container {
      display: flex;
      justify-content: center;
      background: #090d13;
      border: 1px solid var(--vscode-panel-border, #30363d);
      border-radius: 6px;
      padding: 12px;
      overflow: auto;
    }
    .info-card {
      margin-top: 14px;
      padding: 12px 16px;
      background: var(--vscode-sideBar-background, #161b22);
      border: 1px solid var(--vscode-panel-border, #30363d);
      border-radius: 6px;
    }
    .info-title {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .metrics-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 12px;
    }
    .metrics-table th, .metrics-table td {
      text-align: left;
      padding: 4px 8px;
      border-bottom: 1px solid var(--vscode-panel-border, #21262d);
    }
    .metrics-table th {
      color: var(--vscode-descriptionForeground, #8b949e);
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="tool-item">
      <span>Contrast Stretch:</span>
      <select id="stretchSelect">
        <option value="arcsinh" ${this._stretch === "arcsinh" ? "selected" : ""}>Arcsinh (Lupton)</option>
        <option value="log" ${this._stretch === "log" ? "selected" : ""}>Logarithmic</option>
        <option value="zscale" ${this._stretch === "zscale" ? "selected" : ""}>ZScale (IRAF/DS9)</option>
        <option value="sqrt" ${this._stretch === "sqrt" ? "selected" : ""}>Square Root</option>
        <option value="linear" ${this._stretch === "linear" ? "selected" : ""}>Linear</option>
      </select>
    </div>
    <div class="tool-item">
      <span>Colormap:</span>
      <select id="colormapSelect">
        <option value="heat" ${this._colormap === "heat" ? "selected" : ""}>Heat / Inferno</option>
        <option value="viridis" ${this._colormap === "viridis" ? "selected" : ""}>Viridis</option>
        <option value="coolwarm" ${this._colormap === "coolwarm" ? "selected" : ""}>Coolwarm</option>
        <option value="magma" ${this._colormap === "magma" ? "selected" : ""}>Magma</option>
        <option value="grayscale" ${this._colormap === "grayscale" ? "selected" : ""}>Grayscale</option>
      </select>
    </div>
    <div class="tool-item">
      <span>Target X:</span>
      <input type="number" id="targetXInput" value="${targetX}" min="0" max="${hdu.width - 1}" style="width: 50px;">
      <span>Y:</span>
      <input type="number" id="targetYInput" value="${targetY}" min="0" max="${hdu.height - 1}" style="width: 50px;">
    </div>
    <div class="tool-item">
      <span>Aperture:</span>
      <input type="range" id="radiusSlider" min="3" max="25" step="1" value="${this._photometryRadius}">
      <span id="radiusLabel">${this._photometryRadius} px</span>
    </div>
  </div>

  <div class="canvas-container">
    ${svg}
  </div>

  <div class="info-card">
    <div class="info-title">Observational Astrometry &amp; Aperture Photometry Readout</div>
    <table class="metrics-table">
      <thead>
        <tr>
          <th>Object</th>
          <th>Telescope / Instrument</th>
          <th>Dimensions</th>
          <th>Exp Time</th>
          <th>Target (X, Y)</th>
          <th>Peak Flux</th>
          <th>Sky Background</th>
          <th>Net Flux</th>
          <th>FWHM (PSF)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>${escapeXml(hdu.objectName ?? "Target")}</strong></td>
          <td><strong>${escapeXml(hdu.telescope ?? "Observatory")}</strong></td>
          <td><strong>${hdu.width} × ${hdu.height} px</strong></td>
          <td><strong>${hdu.expTime !== undefined ? `${hdu.expTime}s` : "--"}</strong></td>
          <td><strong>[${targetX}, ${targetY}]</strong></td>
          <td><strong>${photometry.peakFlux.toFixed(1)}</strong></td>
          <td><strong>${photometry.skyBackground.toFixed(1)}</strong></td>
          <td><strong>${photometry.netFlux.toFixed(1)}</strong></td>
          <td><strong>${photometry.fwhm} px</strong></td>
        </tr>
      </tbody>
    </table>

    <div class="info-title">FITS Quality &amp; WCS Verification</div>
    ${diagsHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('stretchSelect').addEventListener('change', (e) => {
      vscode.postMessage({ command: 'updateSettings', stretch: e.target.value });
    });

    document.getElementById('colormapSelect').addEventListener('change', (e) => {
      vscode.postMessage({ command: 'updateSettings', colormap: e.target.value });
    });

    const updateCoord = () => {
      const x = parseInt(document.getElementById('targetXInput').value, 10);
      const y = parseInt(document.getElementById('targetYInput').value, 10);
      vscode.postMessage({ command: 'updateSettings', targetCoord: [x, y] });
    };
    document.getElementById('targetXInput').addEventListener('change', updateCoord);
    document.getElementById('targetYInput').addEventListener('change', updateCoord);

    document.getElementById('radiusSlider').addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      document.getElementById('radiusLabel').innerText = val + ' px';
      vscode.postMessage({ command: 'updateSettings', photometryRadius: val });
    });
  </script>
</body>
</html>`;
  }

  private _resolveFitsHdu(): FitsHdu {
    if (this.targetUri) {
      try {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.targetUri);
        if (doc) {
          return parseFits(doc.getText());
        }
      } catch {
        // Fall back to synthetic data
      }
    }
    return parseFits("");
  }
}

export class FitsImageViewerEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.fitsImageEditor";

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    _webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    FitsImageViewerPanel.createOrShow(this.extensionUri, undefined, document.uri.toString());
  }
}
