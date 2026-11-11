// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide-client — Tokamak Plasma Physics & Fusion Equilibrium Panel
 *
 * Provides interactive MHD equilibrium reconstruction and poloidal cross-section inspection for G-EQDSK files (.eqdsk, .geqdsk):
 * - 2D poloidal cross-section SVG with nested magnetic flux surfaces psi(R, Z)
 * - Vacuum vessel limiter wall, magnetic axis, separatrix, and X-point null
 * - Interactive flux surface count and component visibility toggles
 * - Safety factor q(psi_N) and plasma pressure p(psi_N) radial profile subplots
 * - Equilibrium shaping parameters (R0, a, kappa, delta, beta_T, beta_N, q0, q95) & Kruskal-Shafranov stability linter
 */

import {
  computeEquilibriumMetrics,
  lintTokamakEquilibrium,
  parseGeqdsk,
  renderTokamakEquilibriumSvg,
  type GeqdskData,
} from "@modelscript/diagram/plasma-fusion";
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

export class TokamakEquilibriumPanel extends BaseWebviewPanel {
  public static currentPanel: TokamakEquilibriumPanel | undefined;
  public static readonly viewType = "modelscript.tokamakEquilibriumViewer";

  private readonly _client?: LanguageClient | undefined;
  public targetUri: string | undefined;

  private _numFluxSurfaces = 10;
  private _showProfiles = true;
  private _showLimiter = true;
  private _showSeparatrix = true;
  private _showXPoint = true;
  private _showMagneticAxis = true;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, targetUri?: string): void {
    const activeEditorDoc = vscode.window.activeTextEditor?.document;
    const resolvedUri =
      targetUri ??
      (activeEditorDoc && activeEditorDoc.uri.scheme !== "output" ? activeEditorDoc.uri.toString() : undefined);

    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (TokamakEquilibriumPanel.currentPanel) {
      if (resolvedUri) {
        TokamakEquilibriumPanel.currentPanel.targetUri = resolvedUri;
      }
      TokamakEquilibriumPanel.currentPanel._panel.reveal(column);
      TokamakEquilibriumPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      TokamakEquilibriumPanel.viewType,
      "Tokamak Plasma Equilibrium",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    TokamakEquilibriumPanel.currentPanel = new TokamakEquilibriumPanel(panel, extensionUri, client, resolvedUri);
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
        TokamakEquilibriumPanel.currentPanel = undefined;
      },
      null,
      this._disposables,
    );

    this._panel.webview.onDidReceiveMessage(
      (message: {
        command: string;
        numFluxSurfaces?: number;
        showProfiles?: boolean;
        showLimiter?: boolean;
        showSeparatrix?: boolean;
        showXPoint?: boolean;
        showMagneticAxis?: boolean;
      }) => {
        switch (message.command) {
          case "updateSettings": {
            if (typeof message.numFluxSurfaces === "number") {
              this._numFluxSurfaces = Math.max(3, Math.min(25, message.numFluxSurfaces));
            }
            if (typeof message.showProfiles === "boolean") {
              this._showProfiles = message.showProfiles;
            }
            if (typeof message.showLimiter === "boolean") {
              this._showLimiter = message.showLimiter;
            }
            if (typeof message.showSeparatrix === "boolean") {
              this._showSeparatrix = message.showSeparatrix;
            }
            if (typeof message.showXPoint === "boolean") {
              this._showXPoint = message.showXPoint;
            }
            if (typeof message.showMagneticAxis === "boolean") {
              this._showMagneticAxis = message.showMagneticAxis;
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
    const data = this._resolveGeqdskData();
    const metrics = computeEquilibriumMetrics(data);
    const diagnostics = lintTokamakEquilibrium(data);

    const svg = renderTokamakEquilibriumSvg(data, {
      width: 920,
      height: 600,
      numFluxSurfaces: this._numFluxSurfaces,
      showProfiles: this._showProfiles,
      showLimiter: this._showLimiter,
      showSeparatrix: this._showSeparatrix,
      showXPoint: this._showXPoint,
      showMagneticAxis: this._showMagneticAxis,
      darkMode: true,
    });

    const diagsHtml =
      diagnostics.length === 0
        ? `<div style="color: #3fb950; font-size: 12px; margin-top: 4px;">✓ All MHD stability invariants, Kruskal-Shafranov limits, and boundary conditions satisfied.</div>`
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
    .tool-item label {
      cursor: pointer;
    }
    .tool-item input[type="range"] {
      cursor: pointer;
      width: 90px;
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
      <span>Flux Surfaces:</span>
      <input type="range" id="fluxSlider" min="4" max="20" step="1" value="${this._numFluxSurfaces}">
      <span id="fluxLabel">${this._numFluxSurfaces}</span>
    </div>
    <div class="tool-item">
      <input type="checkbox" id="checkProfiles" ${this._showProfiles ? "checked" : ""}>
      <label for="checkProfiles">Profiles</label>
    </div>
    <div class="tool-item">
      <input type="checkbox" id="checkLimiter" ${this._showLimiter ? "checked" : ""}>
      <label for="checkLimiter">Limiter Wall</label>
    </div>
    <div class="tool-item">
      <input type="checkbox" id="checkSeparatrix" ${this._showSeparatrix ? "checked" : ""}>
      <label for="checkSeparatrix">Separatrix</label>
    </div>
    <div class="tool-item">
      <input type="checkbox" id="checkXPoint" ${this._showXPoint ? "checked" : ""}>
      <label for="checkXPoint">X-Point</label>
    </div>
    <div class="tool-item">
      <input type="checkbox" id="checkAxis" ${this._showMagneticAxis ? "checked" : ""}>
      <label for="checkAxis">Magnetic Axis</label>
    </div>
  </div>

  <div class="canvas-container">
    ${svg}
  </div>

  <div class="info-card">
    <div class="info-title">Equilibrium Scalars &amp; Shaping Parameters</div>
    <table class="metrics-table">
      <thead>
        <tr>
          <th>Major Radius R₀</th>
          <th>Minor Radius a</th>
          <th>Aspect Ratio A</th>
          <th>Elongation κ</th>
          <th>Triangularity δ</th>
          <th>Plasma Current Iₚ</th>
          <th>Toroidal Field B₀</th>
          <th>q₀ (Axis)</th>
          <th>q₉₅ (Edge)</th>
          <th>β_N</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>${metrics.majorRadiusR0.toFixed(2)} m</strong></td>
          <td><strong>${metrics.minorRadiusA.toFixed(2)} m</strong></td>
          <td><strong>${metrics.aspectRatio.toFixed(2)}</strong></td>
          <td><strong>${metrics.elongation.toFixed(2)}</strong></td>
          <td><strong>${metrics.triangularityAvg.toFixed(2)}</strong></td>
          <td><strong>${metrics.plasmaCurrentMA.toFixed(2)} MA</strong></td>
          <td><strong>${metrics.toroidalFieldT.toFixed(2)} T</strong></td>
          <td><strong>${metrics.q0.toFixed(2)}</strong></td>
          <td><strong>${metrics.q95.toFixed(2)}</strong></td>
          <td><strong>${metrics.normalizedBeta.toFixed(2)}</strong></td>
        </tr>
      </tbody>
    </table>

    <div class="info-title">MHD Stability &amp; Kruskal-Shafranov Diagnostics</div>
    ${diagsHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('fluxSlider').addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      document.getElementById('fluxLabel').innerText = val;
      vscode.postMessage({ command: 'updateSettings', numFluxSurfaces: val });
    });

    ['checkProfiles', 'checkLimiter', 'checkSeparatrix', 'checkXPoint', 'checkAxis'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        vscode.postMessage({
          command: 'updateSettings',
          showProfiles: document.getElementById('checkProfiles').checked,
          showLimiter: document.getElementById('checkLimiter').checked,
          showSeparatrix: document.getElementById('checkSeparatrix').checked,
          showXPoint: document.getElementById('checkXPoint').checked,
          showMagneticAxis: document.getElementById('checkAxis').checked
        });
      });
    });
  </script>
</body>
</html>`;
  }

  private _resolveGeqdskData(): GeqdskData {
    if (this.targetUri) {
      try {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.targetUri);
        if (doc) {
          return parseGeqdsk(doc.getText());
        }
      } catch {
        // Fall back to synthetic data
      }
    }
    return parseGeqdsk("");
  }
}

export class TokamakEquilibriumEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.tokamakEquilibriumEditor";

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    _webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    TokamakEquilibriumPanel.createOrShow(this.extensionUri, undefined, document.uri.toString());
  }
}
