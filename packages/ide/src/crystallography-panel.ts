// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide-client — Crystallography & Materials Structure Visualizer Panel
 *
 * Provides interactive crystallographic unit cell and powder diffraction inspection for CIF files (.cif):
 * - 3D depth-sorted unit cell wireframe with CPK-colored atomic spheres and coordinate axes
 * - Interactive camera rotation sliders (azimuth & elevation)
 * - Supercell expansion controls (1x1x1 to 2x2x2)
 * - Miller index plane (hkl) slicing with translucent plane polygon
 * - Simulated Powder X-ray Diffraction (PXRD) Bragg peaks and continuous profile
 * - Crystallographic parameters inspector (a, b, c, alpha, beta, gamma, V_cell) & materials linter
 */

import {
  lintCrystalStructure,
  parseCif,
  renderCrystalUnitCellSvg,
  renderPxrdSvg,
  simulatePxrd,
  type CrystalStructure,
  type MillerPlane,
} from "@modelscript/diagram/crystallography";
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

export class CrystallographyPanel extends BaseWebviewPanel {
  public static currentPanel: CrystallographyPanel | undefined;
  public static readonly viewType = "modelscript.crystallographyViewer";

  private readonly _client?: LanguageClient | undefined;
  public targetUri: string | undefined;

  private _azimuthDeg = 35;
  private _elevationDeg = 25;
  private _supercell: [number, number, number] = [1, 1, 1];
  private _millerPlane: MillerPlane | undefined = { h: 1, k: 1, l: 1 };
  private _activeTab: "unitcell" | "pxrd" = "unitcell";

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, targetUri?: string): void {
    const activeEditorDoc = vscode.window.activeTextEditor?.document;
    const resolvedUri =
      targetUri ??
      (activeEditorDoc && activeEditorDoc.uri.scheme !== "output" ? activeEditorDoc.uri.toString() : undefined);

    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (CrystallographyPanel.currentPanel) {
      if (resolvedUri) {
        CrystallographyPanel.currentPanel.targetUri = resolvedUri;
      }
      CrystallographyPanel.currentPanel._panel.reveal(column);
      CrystallographyPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CrystallographyPanel.viewType,
      "Crystallography & Materials Viewer",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    CrystallographyPanel.currentPanel = new CrystallographyPanel(panel, extensionUri, client, resolvedUri);
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
        azimuth?: string;
        elevation?: string;
        supercell?: string;
        h?: string;
        k?: string;
        l?: string;
        tab?: "unitcell" | "pxrd";
      }) => {
        switch (message.command) {
          case "setCamera":
            if (message.azimuth) this._azimuthDeg = parseFloat(message.azimuth);
            if (message.elevation) this._elevationDeg = parseFloat(message.elevation);
            this.update();
            break;
          case "setSupercell": {
            const sc = message.supercell === "2" ? 2 : 1;
            this._supercell = [sc, sc, sc];
            this.update();
            break;
          }
          case "setMillerPlane": {
            const h = parseInt(message.h ?? "1", 10) || 0;
            const k = parseInt(message.k ?? "1", 10) || 0;
            const l = parseInt(message.l ?? "1", 10) || 0;
            this._millerPlane = h === 0 && k === 0 && l === 0 ? undefined : { h, k, l };
            this.update();
            break;
          }
          case "switchTab":
            if (message.tab) this._activeTab = message.tab;
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
    CrystallographyPanel.currentPanel = undefined;
    super.dispose();
  }

  public update(): void {
    let sourceText = SAMPLE_NACL_CIF;

    if (this.targetUri) {
      const parsedUri = vscode.Uri.parse(this.targetUri);
      const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === parsedUri.toString());
      if (openDoc) {
        sourceText = openDoc.getText();
      }
    }

    let structure: CrystalStructure;
    try {
      structure = parseCif(sourceText);
    } catch {
      structure = parseCif(SAMPLE_NACL_CIF);
    }

    const diagnostics = lintCrystalStructure(structure);
    const unitCellSvg = renderCrystalUnitCellSvg(structure, {
      azimuthDeg: this._azimuthDeg,
      elevationDeg: this._elevationDeg,
      supercell: this._supercell,
      millerPlane: this._millerPlane,
      darkMode: true,
    });

    const pxrdPeaks = simulatePxrd(structure, { wavelengthAngstrom: 1.5406 });
    const pxrdSvg = renderPxrdSvg(pxrdPeaks, { darkMode: true });

    this._panel.webview.html = this._getHtmlForWebview(structure, unitCellSvg, pxrdSvg, diagnostics);
  }

  private _getHtmlForWebview(
    structure: CrystalStructure,
    unitCellSvg: string,
    pxrdSvg: string,
    diagnostics: ReturnType<typeof lintCrystalStructure>,
  ): string {
    const cell = structure.cell;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Crystallography & Materials Visualizer</title>
  <style>
    :root {
      --bg: #0a0f1d;
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
    .tab-bar {
      display: flex;
      gap: 8px;
    }
    .tab-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
    }
    .tab-btn.active {
      background: var(--accent);
      color: #0f172a;
      border-color: var(--accent);
      font-weight: 600;
    }
    .controls-grid {
      display: grid;
      grid-template-columns: 2.2fr 1fr;
      gap: 16px;
    }
    .vis-card {
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
    .hkl-inputs {
      display: flex;
      gap: 8px;
    }
    .hkl-inputs input {
      width: 48px;
      background: #060910;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px;
      border-radius: 6px;
      text-align: center;
      font-family: monospace;
      font-weight: bold;
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
      <h2>Crystallography & Materials Structure Visualizer</h2>
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 2px;">
        ${escapeXml(structure.name)} — Space Group: <code>${escapeXml(structure.spaceGroup)}</code> | Formula: ${escapeXml(structure.formula)}
      </div>
    </div>
    <div class="tab-bar">
      <button class="tab-btn ${this._activeTab === "unitcell" ? "active" : ""}" onclick="onTabClick('unitcell')">3D Unit Cell</button>
      <button class="tab-btn ${this._activeTab === "pxrd" ? "active" : ""}" onclick="onTabClick('pxrd')">Powder XRD Pattern</button>
    </div>
  </div>

  <div class="controls-grid">
    <div class="vis-card">
      ${this._activeTab === "unitcell" ? unitCellSvg : pxrdSvg}
    </div>

    <div class="params-card">
      ${
        this._activeTab === "unitcell"
          ? `
        <div style="display: flex; flex-direction: column;">
          <label>Camera Azimuth (Yaw)</label>
          <div class="slider-row">
            <input type="range" min="0" max="360" step="5" value="${this._azimuthDeg}" oninput="onAzimSlide(this.value)" onchange="onAzimCommit(this.value)">
            <span class="val-badge" id="azimBadge">${this._azimuthDeg}°</span>
          </div>
        </div>

        <div style="display: flex; flex-direction: column;">
          <label>Camera Elevation (Pitch)</label>
          <div class="slider-row">
            <input type="range" min="-90" max="90" step="5" value="${this._elevationDeg}" oninput="onElevSlide(this.value)" onchange="onElevCommit(this.value)">
            <span class="val-badge" id="elevBadge">${this._elevationDeg}°</span>
          </div>
        </div>

        <div style="display: flex; flex-direction: column;">
          <label>Miller Index Plane (h k l)</label>
          <div class="hkl-inputs">
            <input type="number" id="hInput" value="${this._millerPlane?.h ?? 1}" min="-3" max="3" onchange="onHklCommit()">
            <input type="number" id="kInput" value="${this._millerPlane?.k ?? 1}" min="-3" max="3" onchange="onHklCommit()">
            <input type="number" id="lInput" value="${this._millerPlane?.l ?? 1}" min="-3" max="3" onchange="onHklCommit()">
          </div>
        </div>
      `
          : `
        <div style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.4;">
          Powder X-ray Diffraction pattern simulated using <strong>Bragg's Law</strong> ($\\lambda = 2d \\sin\\theta$) with Cu K$\\alpha$ radiation ($\\lambda = 1.5406\\text{ Å}$). Peak heights include Lorentz-polarization factor and structure factor approximations.
        </div>
      `
      }

      <table class="info-table">
        <tr>
          <td>Lattice Constants</td>
          <td>a=${cell.a.toFixed(2)} Å, b=${cell.b.toFixed(2)} Å, c=${cell.c.toFixed(2)} Å</td>
        </tr>
        <tr>
          <td>Lattice Angles</td>
          <td>α=${cell.alpha.toFixed(1)}°, β=${cell.beta.toFixed(1)}°, γ=${cell.gamma.toFixed(1)}°</td>
        </tr>
        <tr>
          <td>Unit Cell Volume (V)</td>
          <td><strong>${cell.volume.toFixed(2)} Å³</strong></td>
        </tr>
        <tr>
          <td>Asymmetric Unit Atoms</td>
          <td>${structure.atoms.length} atoms</td>
        </tr>
        <tr>
          <td>Space Group</td>
          <td><code>${escapeXml(structure.spaceGroup)}</code></td>
        </tr>
      </table>

      ${
        diagnostics.length > 0
          ? `<div>
              <label>Crystallographic Linter Diagnostics</label>
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
              ✓ Valid unit cell and space group geometry with zero atomic steric clashes.
            </div>`
      }
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function onTabClick(tab) {
      vscode.postMessage({ command: 'switchTab', tab: tab });
    }

    function onAzimSlide(val) {
      document.getElementById('azimBadge').innerText = val + '°';
    }

    function onAzimCommit(val) {
      vscode.postMessage({ command: 'setCamera', azimuth: val });
    }

    function onElevSlide(val) {
      document.getElementById('elevBadge').innerText = val + '°';
    }

    function onElevCommit(val) {
      vscode.postMessage({ command: 'setCamera', elevation: val });
    }

    function onHklCommit() {
      const h = document.getElementById('hInput').value;
      const k = document.getElementById('kInput').value;
      const l = document.getElementById('lInput').value;
      vscode.postMessage({ command: 'setMillerPlane', h, k, l });
    }
  </script>
</body>
</html>`;
  }
}

export class CrystallographyEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.crystallographyEditor";

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    _webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    CrystallographyPanel.createOrShow(this.extensionUri, undefined, document.uri.toString());
  }
}

const SAMPLE_NACL_CIF = `data_NaCl
_chemical_name_systematic 'Sodium Chloride'
_chemical_formula_sum 'Cl Na'
_symmetry_space_group_name_H-M 'F m -3 m'
_cell_length_a 5.6402
_cell_length_b 5.6402
_cell_length_c 5.6402
_cell_angle_alpha 90.00
_cell_angle_beta 90.00
_cell_angle_gamma 90.00

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Na1 Na 0.0000 0.0000 0.0000
Na2 Na 0.5000 0.5000 0.0000
Na3 Na 0.5000 0.0000 0.5000
Na4 Na 0.0000 0.5000 0.5000
Cl1 Cl 0.5000 0.0000 0.0000
Cl2 Cl 0.0000 0.5000 0.0000
Cl3 Cl 0.0000 0.0000 0.5000
Cl4 Cl 0.5000 0.5000 0.5000
`;
