// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide-client — Reaction Coordinate & Potential Energy Surface (PES) Visualizer Panel.
 *
 * Provides interactive chemical reaction coordinate inspection and bi-directional
 * activation barrier ($E_a$, $\Delta G^\ddagger$) editing for Cantera chemical mechanisms (.yaml, .cti):
 * 1. Smooth cubic Bézier potential energy surface (PES) profile generated via `@modelscript/diagram`.
 * 2. Interactive activation barrier slider and numeric adjustment.
 * 3. Reaction dropdown selector for multi-step elementary & falloff reaction mechanisms.
 * 4. Bi-directional writeback to Cantera YAML/CTI sources via `reconcileReactionBarrierChange`.
 */

import { parseCantera, type CanteraMechanism, type CanteraReaction } from "@modelscript/cantera";
import {
  buildReactionCoordinateFromCantera,
  reconcileReactionBarrierChange,
  renderReactionCoordinateSvg,
  type ReactionCoordinateDiagram,
} from "@modelscript/diagram/reaction-coordinate";
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

export class ReactionCoordinatePanel extends BaseWebviewPanel {
  public static currentPanel: ReactionCoordinatePanel | undefined;
  public static readonly viewType = "modelscript.reactionCoordinateViewer";

  private readonly _client?: LanguageClient | undefined;
  public targetUri: string | undefined;
  private _selectedReactionIndex = 0;
  private _currentDeltaH = -45.0; // default exothermic step [kJ/mol]
  private _currentEaJoules?: number | undefined;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, targetUri?: string): void {
    const activeEditorDoc = vscode.window.activeTextEditor?.document;
    const resolvedUri =
      targetUri ??
      (activeEditorDoc && activeEditorDoc.uri.scheme !== "output" ? activeEditorDoc.uri.toString() : undefined);

    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (ReactionCoordinatePanel.currentPanel) {
      if (resolvedUri) {
        ReactionCoordinatePanel.currentPanel.targetUri = resolvedUri;
      }
      ReactionCoordinatePanel.currentPanel._panel.reveal(column);
      void ReactionCoordinatePanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ReactionCoordinatePanel.viewType,
      "Reaction Coordinate & Free Energy Profile",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    ReactionCoordinatePanel.currentPanel = new ReactionCoordinatePanel(panel, extensionUri, client, resolvedUri);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client?: LanguageClient | undefined,
    targetUri?: string | undefined,
  ) {
    super(panel, extensionUri);
    this._client = client;
    this.targetUri = targetUri;
    void this._client;

    this._panel.webview.onDidReceiveMessage(
      async (msg: { command: string; rxnIndex?: number; newEaKj?: number; deltaH?: number; writeback?: boolean }) => {
        if (msg.command === "selectReaction" && typeof msg.rxnIndex === "number") {
          this._selectedReactionIndex = msg.rxnIndex;
          this._currentEaJoules = undefined; // reset custom override
          await this.update();
        } else if (msg.command === "adjustEa" && typeof msg.newEaKj === "number") {
          this._currentEaJoules = msg.newEaKj * 1000.0;
          if (msg.writeback && this.targetUri) {
            await this._reconcileWriteback(this._currentEaJoules);
          }
          await this.update();
        } else if (msg.command === "adjustDeltaH" && typeof msg.deltaH === "number") {
          this._currentDeltaH = msg.deltaH;
          await this.update();
        }
      },
      null,
      this._disposables,
    );

    void this.update();
  }

  private async _reconcileWriteback(newEaJoules: number): Promise<void> {
    if (!this.targetUri) return;
    try {
      const fileUri = vscode.Uri.parse(this.targetUri);
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      const source = new TextDecoder().decode(bytes);
      const doc = parseCantera(source);
      const rxn = doc.mechanism.reactions[this._selectedReactionIndex];
      if (!rxn) return;

      const updated = reconcileReactionBarrierChange(source, rxn.equation, newEaJoules);
      if (updated !== source) {
        await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(updated));
        void vscode.window.showInformationMessage(
          `Updated activation energy for '${rxn.equation}' to ${(newEaJoules / 1000).toFixed(1)} kJ/mol.`,
        );
      }
    } catch (err) {
      console.error("Failed to reconcile reaction barrier writeback:", err);
    }
  }

  public async update(): Promise<void> {
    let sourceText = "";
    if (this.targetUri) {
      try {
        const fileUri = vscode.Uri.parse(this.targetUri);
        const bytes = await vscode.workspace.fs.readFile(fileUri);
        sourceText = new TextDecoder().decode(bytes);
      } catch {
        sourceText = SAMPLE_CANTERA_MECH;
      }
    } else {
      sourceText = SAMPLE_CANTERA_MECH;
    }

    let mech: CanteraMechanism;
    try {
      mech = parseCantera(sourceText).mechanism;
    } catch {
      mech = parseCantera(SAMPLE_CANTERA_MECH).mechanism;
    }

    const reactions =
      mech.reactions.length > 0 ? mech.reactions : parseCantera(SAMPLE_CANTERA_MECH).mechanism.reactions;
    const rxnIndex = Math.min(Math.max(0, this._selectedReactionIndex), reactions.length - 1);
    const rxn = reactions[rxnIndex]!;

    const effectiveEaJoules = this._currentEaJoules ?? rxn.rateConstant.Ea;
    const modifiedRxn: CanteraReaction = {
      ...rxn,
      rateConstant: {
        ...rxn.rateConstant,
        Ea: effectiveEaJoules,
      },
    };

    const diagram = buildReactionCoordinateFromCantera(modifiedRxn, {
      reactionDeltaH: this._currentDeltaH,
      energyUnit: "kJ/mol",
    });

    const svg = renderReactionCoordinateSvg(diagram, { theme: "dark" });
    this._panel.webview.html = this._getHtmlForWebview(mech, reactions, rxnIndex, modifiedRxn, diagram, svg);
  }

  private _getHtmlForWebview(
    mech: CanteraMechanism,
    reactions: CanteraReaction[],
    currentIndex: number,
    currentRxn: CanteraReaction,
    diagram: ReactionCoordinateDiagram,
    svgContent: string,
  ): string {
    const rxnOptions = reactions
      .map(
        (r, idx) =>
          `<option value="${idx}" ${idx === currentIndex ? "selected" : ""}>[${idx + 1}] ${escapeXml(r.equation)} (Ea = ${(r.rateConstant.Ea / 1000).toFixed(1)} kJ/mol)</option>`,
      )
      .join("\n");

    const eaKj = currentRxn.rateConstant.Ea > 1000 ? currentRxn.rateConstant.Ea / 1000 : currentRxn.rateConstant.Ea;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reaction Coordinate Visualizer</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --border: #334155;
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
      color: var(--text);
    }
    .controls-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 16px;
    }
    .diagram-card {
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
      gap: 16px;
    }
    label {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 4px;
      display: block;
    }
    select, input[type="number"] {
      width: 100%;
      background: #0f172a;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.9rem;
      box-sizing: border-box;
    }
    .slider-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    input[type="range"] {
      flex: 1;
      accent-color: var(--accent);
    }
    .val-badge {
      background: #0f172a;
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid var(--border);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.85rem;
      min-width: 60px;
      text-align: right;
    }
    .btn-row {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    button {
      flex: 1;
      background: #0284c7;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      transition: background 0.15s ease;
    }
    button:hover {
      background: #0369a1;
    }
    .info-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
      margin-top: 8px;
    }
    .info-table td {
      padding: 6px 0;
      border-bottom: 1px solid #293548;
    }
    .info-table td:last-child {
      text-align: right;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--accent);
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>Potential Energy Surface & Reaction Coordinate Explorer</h2>
    <span style="font-size: 0.85rem; color: var(--text-muted);">${escapeXml(mech.name || "Cantera Chemical Mechanism")}</span>
  </div>

  <div class="controls-grid">
    <div class="diagram-card">
      <div style="width: 100%; overflow-x: auto; text-align: center;">
        ${svgContent}
      </div>
    </div>

    <div class="params-card">
      <div>
        <label for="rxnSelect">Chemical Reaction</label>
        <select id="rxnSelect" onchange="onRxnChange(this.value)">
          ${rxnOptions}
        </select>
      </div>

      <div>
        <label>Activation Energy ($E_a$)</label>
        <div class="slider-row">
          <input type="range" id="eaSlider" min="0" max="350" step="0.5" value="${eaKj.toFixed(1)}" oninput="onEaSlide(this.value)" onchange="onEaCommit(this.value)">
          <span class="val-badge" id="eaBadge">${eaKj.toFixed(1)} kJ/mol</span>
        </div>
      </div>

      <div>
        <label>Reaction Enthalpy ($\\Delta_r H$)</label>
        <div class="slider-row">
          <input type="range" id="dhSlider" min="-200" max="150" step="1.0" value="${this._currentDeltaH.toFixed(1)}" oninput="onDhSlide(this.value)">
          <span class="val-badge" id="dhBadge">${this._currentDeltaH.toFixed(1)} kJ/mol</span>
        </div>
      </div>

      <div class="btn-row">
        <button onclick="commitWriteback()">Save $E_a$ to Model</button>
      </div>

      <table class="info-table">
        <tr>
          <td>Equation</td>
          <td>${escapeXml(currentRxn.equation)}</td>
        </tr>
        <tr>
          <td>Pre-exponential (A)</td>
          <td>${currentRxn.rateConstant.A.toExponential(2)}</td>
        </tr>
        <tr>
          <td>Temp Exponent (b)</td>
          <td>${(currentRxn.rateConstant.b ?? 0.0).toFixed(2)}</td>
        </tr>
        <tr>
          <td>Reversible</td>
          <td>${currentRxn.reversible ? "true" : "false"}</td>
        </tr>
        <tr>
          <td>Barrier $\\Delta G^\\ddagger$</td>
          <td>${(diagram.steps[0]?.activationEnergy ?? 0).toFixed(1)} kJ/mol</td>
        </tr>
      </table>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function onRxnChange(val) {
      vscode.postMessage({ command: 'selectReaction', rxnIndex: parseInt(val, 10) });
    }

    function onEaSlide(val) {
      document.getElementById('eaBadge').innerText = parseFloat(val).toFixed(1) + ' kJ/mol';
    }

    function onEaCommit(val) {
      vscode.postMessage({ command: 'adjustEa', newEaKj: parseFloat(val), writeback: false });
    }

    function onDhSlide(val) {
      document.getElementById('dhBadge').innerText = parseFloat(val).toFixed(1) + ' kJ/mol';
      vscode.postMessage({ command: 'adjustDeltaH', deltaH: parseFloat(val) });
    }

    function commitWriteback() {
      const val = parseFloat(document.getElementById('eaSlider').value);
      vscode.postMessage({ command: 'adjustEa', newEaKj: val, writeback: true });
    }
  </script>
</body>
</html>`;
  }
}

export class ReactionCoordinateEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.reactionCoordinateEditor";

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    _webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    ReactionCoordinatePanel.createOrShow(this.extensionUri, undefined, document.uri.toString());
  }
}

const SAMPLE_CANTERA_MECH = `description: Gri-Mech 3.0 combustion mechanism
phases:
  - name: gas
    elements: [O, H, C, N, Ar]
    species: [H2, H, O, O2, OH, H2O, CH4, CO, CO2]
    thermo: ideal-gas
reactions:
  - equation: 2 O + M <=> O2 + M
    rate-constant: {A: 1.2e+17, b: -1.0, Ea: 0.0}
  - equation: O + H2 <=> H + OH
    rate-constant: {A: 3.87e+04, b: 2.7, Ea: 26191.8}
  - equation: O + HO2 <=> OH + O2
    rate-constant: {A: 2.0e+13, b: 0.0, Ea: 0.0}
  - equation: O + CH4 <=> OH + CH3
    rate-constant: {A: 1.02e+09, b: 1.5, Ea: 36000.0}
`;
