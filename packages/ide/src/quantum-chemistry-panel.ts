// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide-client — Quantum Chemistry & Molecular Spectroscopy Panel
 *
 * Provides interactive quantum chemistry inspection, 3D molecular visualization, and vibrational spectroscopy:
 * - Gaussian (.gjf, .com) and ORCA (.inp) deck parsing with Cartesian and Z-matrix coordinates
 * - 3D molecular structure with normal mode vibrational displacement vectors
 * - Interactive Infrared (IR) and Raman vibrational absorption spectrum (IUPAC 4000 -> 400 cm^-1)
 * - Normal mode selector and peak frequency assignment
 * - Fundamental quantum chemistry physical linter (spin parity, steric collision, basis set, gimbal lock)
 */

import {
  computeVibrationalSpectrum,
  lintQuantumChemistry,
  parseGaussianDeck,
  renderQuantumChemistrySvg,
  type QCLintDiagnostic,
  type QuantumChemistryData,
} from "@modelscript/diagram/quantum-chemistry";
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

export class QuantumChemistryPanel extends BaseWebviewPanel {
  public static currentPanel: QuantumChemistryPanel | undefined;
  public static readonly viewType = "modelscript.quantumChemistryViewer";

  private readonly _client?: LanguageClient | undefined;
  public targetUri: string | undefined;

  private _selectedMode = 1;
  private _showVectors = true;
  private _showSpectrum = true;
  private _spectrumType: "ir" | "raman" = "ir";

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, targetUri?: string): void {
    const activeEditorDoc = vscode.window.activeTextEditor?.document;
    const resolvedUri =
      targetUri ??
      (activeEditorDoc && activeEditorDoc.uri.scheme !== "output" ? activeEditorDoc.uri.toString() : undefined);

    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (QuantumChemistryPanel.currentPanel) {
      if (resolvedUri) {
        QuantumChemistryPanel.currentPanel.targetUri = resolvedUri;
      }
      QuantumChemistryPanel.currentPanel._panel.reveal(column);
      QuantumChemistryPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      QuantumChemistryPanel.viewType,
      "Quantum Chemistry & Spectroscopy",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    QuantumChemistryPanel.currentPanel = new QuantumChemistryPanel(panel, extensionUri, client, resolvedUri);
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
        QuantumChemistryPanel.currentPanel = undefined;
      },
      null,
      this._disposables,
    );

    this._panel.webview.onDidReceiveMessage(
      (message: {
        command: string;
        selectedMode?: number;
        showVectors?: boolean;
        showSpectrum?: boolean;
        spectrumType?: "ir" | "raman";
      }) => {
        switch (message.command) {
          case "updateSettings": {
            if (typeof message.selectedMode === "number") this._selectedMode = message.selectedMode;
            if (typeof message.showVectors === "boolean") this._showVectors = message.showVectors;
            if (typeof message.showSpectrum === "boolean") this._showSpectrum = message.showSpectrum;
            if (message.spectrumType === "ir" || message.spectrumType === "raman")
              this._spectrumType = message.spectrumType;
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
    const data = this._resolveGaussianData();
    this._panel.webview.html = this._getHtmlForWebview(data);
  }

  private _getHtmlForWebview(data: QuantumChemistryData): string {
    const diagnostics = lintQuantumChemistry(data);
    const spectrum = computeVibrationalSpectrum(data.normalModes);

    const svg = renderQuantumChemistrySvg(data, spectrum, {
      width: 960,
      height: 520,
      selectedMode: this._selectedMode,
      showVectors: this._showVectors,
      showSpectrum: this._showSpectrum,
      spectrumType: this._spectrumType,
    });

    let diagsHtml = "";
    if (diagnostics.length === 0) {
      diagsHtml = `<div class="diag-clean">✔ Electronic &amp; Vibrational Structure Validated: Spin multiplicity matches electron parity, no steric clashes, and basis set is complete.</div>`;
    } else {
      diagsHtml = diagnostics
        .map(
          (d: QCLintDiagnostic) => `
        <div class="diag-item ${d.severity}">
          <span class="diag-badge">[${escapeXml(d.code)}]</span>
          <span class="diag-msg">${escapeXml(d.message)}</span>
        </div>`,
        )
        .join("");
    }

    const modeOptionsHtml = data.normalModes
      .map(
        (m) =>
          `<option value="${m.modeNumber}" ${m.modeNumber === this._selectedMode ? "selected" : ""}>Mode #${m.modeNumber}: ${m.frequencyCm1.toFixed(1)} cm⁻¹ (IR: ${m.irIntensityKmPerMol.toFixed(1)} km/mol)</option>`,
      )
      .join("");

    const modesTableRows = data.normalModes
      .map(
        (m) => `
        <tr class="${m.modeNumber === this._selectedMode ? "selected-row" : ""}">
          <td><strong>#${m.modeNumber}</strong></td>
          <td>${m.frequencyCm1.toFixed(1)} cm⁻¹</td>
          <td>${m.irIntensityKmPerMol.toFixed(2)} km/mol</td>
          <td>${(m.ramanActivityA4Amu ?? 0).toFixed(2)} Å⁴/amu</td>
          <td><span class="sym-badge">${m.symmetry ?? "A"}</span></td>
        </tr>`,
      )
      .join("");

    const atomRows = data.atoms
      .map(
        (a) => `
        <tr>
          <td>${a.index}</td>
          <td><strong>${escapeXml(a.symbol)}</strong></td>
          <td>${a.atomicNumber}</td>
          <td>${a.x.toFixed(4)}</td>
          <td>${a.y.toFixed(4)}</td>
          <td>${a.z.toFixed(4)}</td>
          <td>${a.mass.toFixed(3)}</td>
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
      background: #ec4899;
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
    .selected-row {
      background: rgba(56, 189, 248, 0.15);
    }
    .sym-badge {
      background: #475569;
      color: #fff;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 0.75em;
      font-family: monospace;
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
    <span>Quantum Chemistry &amp; Vibrational Spectroscopy</span>
    <span class="badge">Gaussian / ORCA</span>
  </h2>

  <div class="toolbar">
    <div class="control-group">
      <label for="modeSelect">Active Mode:</label>
      <select id="modeSelect">
        ${modeOptionsHtml}
      </select>
    </div>
    <div class="control-group">
      <input type="checkbox" id="checkVectors" ${this._showVectors ? "checked" : ""}>
      <label for="checkVectors">Displacement Vectors</label>
    </div>
    <div class="control-group">
      <input type="checkbox" id="checkSpectrum" ${this._showSpectrum ? "checked" : ""}>
      <label for="checkSpectrum">Spectrum Subplot</label>
    </div>
    <div class="control-group">
      <label for="specTypeSelect">Type:</label>
      <select id="specTypeSelect">
        <option value="ir" ${this._spectrumType === "ir" ? "selected" : ""}>Infrared (IR)</option>
        <option value="raman" ${this._spectrumType === "raman" ? "selected" : ""}>Raman Activity</option>
      </select>
    </div>
  </div>

  <div class="svg-container">
    ${svg}
  </div>

  <div class="info-card">
    <div class="info-title">Vibrational Normal Modes (Harmonic Frequencies)</div>
    <table>
      <thead>
        <tr>
          <th>Mode</th>
          <th>Frequency ν̃</th>
          <th>IR Intensity</th>
          <th>Raman Activity</th>
          <th>Symmetry</th>
        </tr>
      </thead>
      <tbody>
        ${modesTableRows}
      </tbody>
    </table>

    <div class="info-title">Molecular Geometry (${data.atoms.length} Atoms &bull; ${escapeXml(data.method ?? "DFT")}/${escapeXml(data.basisSet ?? "Def2")})</div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Symbol</th>
          <th>Atomic No.</th>
          <th>X (Å)</th>
          <th>Y (Å)</th>
          <th>Z (Å)</th>
          <th>Mass (amu)</th>
        </tr>
      </thead>
      <tbody>
        ${atomRows}
      </tbody>
    </table>

    <div class="info-title">Electronic Structure &amp; Quantum Physics Diagnostics</div>
    ${diagsHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('modeSelect').addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      vscode.postMessage({ command: 'updateSettings', selectedMode: val });
    });

    document.getElementById('specTypeSelect').addEventListener('change', (e) => {
      const val = e.target.value;
      vscode.postMessage({ command: 'updateSettings', spectrumType: val });
    });

    ['checkVectors', 'checkSpectrum'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        vscode.postMessage({
          command: 'updateSettings',
          showVectors: document.getElementById('checkVectors').checked,
          showSpectrum: document.getElementById('checkSpectrum').checked
        });
      });
    });
  </script>
</body>
</html>`;
  }

  private _resolveGaussianData(): QuantumChemistryData {
    if (this.targetUri) {
      try {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.targetUri);
        if (doc) {
          return parseGaussianDeck(doc.getText());
        }
      } catch {
        // Fall back to synthetic data
      }
    }
    return parseGaussianDeck("");
  }
}

export class QuantumChemistryEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.quantumChemistryEditor";

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    _webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    QuantumChemistryPanel.createOrShow(this.extensionUri, undefined, document.uri.toString());
  }
}
