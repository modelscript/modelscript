// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide-client — High-Energy Particle Collision Event & Dalitz Plot Panel
 *
 * Provides interactive high-energy particle physics event reconstruction and Dalitz phase space inspection:
 * - 2D Dalitz plot scatter view of 3-body decay kinematics (m_12^2 vs m_23^2)
 * - Kinematic boundary closed polygon (G-function phase space limits)
 * - Intermediate resonant decay state bands (Breit-Wigner lineshapes)
 * - 1D invariant mass projection histogram subplot
 * - Particle four-momentum and charge conservation linter (HEP2001 - HEP2004)
 */

import {
  computeDalitzKinematics,
  computeInvariantMassDistribution,
  lintParticleEvent,
  parseHepEvent,
  renderDalitzPlotSvg,
  type HepEvent,
  type Particle,
  type ParticleEventLintDiagnostic,
} from "@modelscript/diagram/hep-event";
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

export class HepEventViewerPanel extends BaseWebviewPanel {
  public static currentPanel: HepEventViewerPanel | undefined;
  public static readonly viewType = "modelscript.hepEventViewer";

  private readonly _client?: LanguageClient | undefined;
  public targetUri: string | undefined;

  private _showResonances = true;
  private _showBoundary = true;
  private _showHistogram = true;
  private _numPhaseSpaceEvents = 150;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, targetUri?: string): void {
    const activeEditorDoc = vscode.window.activeTextEditor?.document;
    const resolvedUri =
      targetUri ??
      (activeEditorDoc && activeEditorDoc.uri.scheme !== "output" ? activeEditorDoc.uri.toString() : undefined);

    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (HepEventViewerPanel.currentPanel) {
      if (resolvedUri) {
        HepEventViewerPanel.currentPanel.targetUri = resolvedUri;
      }
      HepEventViewerPanel.currentPanel._panel.reveal(column);
      HepEventViewerPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      HepEventViewerPanel.viewType,
      "Particle Event & Dalitz Kinematics",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    HepEventViewerPanel.currentPanel = new HepEventViewerPanel(panel, extensionUri, client, resolvedUri);
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
        HepEventViewerPanel.currentPanel = undefined;
      },
      null,
      this._disposables,
    );

    this._panel.webview.onDidReceiveMessage(
      (message: {
        command: string;
        showResonances?: boolean;
        showBoundary?: boolean;
        showHistogram?: boolean;
        numSamples?: number;
      }) => {
        switch (message.command) {
          case "updateSettings": {
            if (typeof message.showResonances === "boolean") this._showResonances = message.showResonances;
            if (typeof message.showBoundary === "boolean") this._showBoundary = message.showBoundary;
            if (typeof message.showHistogram === "boolean") this._showHistogram = message.showHistogram;
            if (typeof message.numSamples === "number") this._numPhaseSpaceEvents = message.numSamples;
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
    const event = this._resolveHepEventData();
    this._panel.webview.html = this._getHtmlForWebview(event);
  }

  private _getHtmlForWebview(event: HepEvent): string {
    const diagnostics = lintParticleEvent(event);

    // Identify mother and daughter particles for Dalitz plot
    let mother = event.particles.find((p) => p.status === "initial");
    const finalState = event.particles.filter((p) => p.status === "final");

    if (!mother && event.particles.length > 0) {
      mother = event.particles[0];
    }

    let defaultMother: Particle = {
      id: 1,
      name: "D0",
      pdgId: 421,
      charge: 0,
      px: 0,
      py: 0,
      pz: 0,
      energy: 1.8648,
      mass: 1.8648,
      status: "initial",
    };
    if (mother) {
      defaultMother = mother;
    }

    const daughters: [Particle, Particle, Particle] =
      finalState.length >= 3
        ? [finalState[0]!, finalState[1]!, finalState[2]!]
        : [
            {
              id: 2,
              name: "K-",
              pdgId: -321,
              charge: -1,
              px: -0.4,
              py: 0.2,
              pz: 0.2,
              energy: 0.7,
              mass: 0.4937,
              status: "final",
            },
            {
              id: 3,
              name: "pi+",
              pdgId: 211,
              charge: +1,
              px: 0.3,
              py: -0.3,
              pz: 0.1,
              energy: 0.6,
              mass: 0.1396,
              status: "final",
            },
            {
              id: 4,
              name: "pi0",
              pdgId: 111,
              charge: 0,
              px: 0.1,
              py: 0.1,
              pz: -0.3,
              energy: 0.5648,
              mass: 0.135,
              status: "final",
            },
          ];

    const dalitz = computeDalitzKinematics(defaultMother, daughters, this._numPhaseSpaceEvents);
    const m12Values = dalitz.events.map((e) => Math.sqrt(e.m12Sq));
    const hist = computeInvariantMassDistribution(m12Values, 20);

    const svg = renderDalitzPlotSvg(dalitz, hist, {
      width: 900,
      height: 520,
      showResonances: this._showResonances,
      showBoundary: this._showBoundary,
      showHistogram: this._showHistogram,
    });

    let diagsHtml = "";
    if (diagnostics.length === 0) {
      diagsHtml = `<div class="diag-clean">✔ Relativistic Conservation Validated: Four-momentum &Delta;P and electric charge &Delta;Q are strictly conserved with no tachyonic states.</div>`;
    } else {
      diagsHtml = diagnostics
        .map(
          (d: ParticleEventLintDiagnostic) => `
        <div class="diag-item ${d.severity}">
          <span class="diag-badge">[${escapeXml(d.code)}]</span>
          <span class="diag-msg">${escapeXml(d.message)}</span>
        </div>`,
        )
        .join("");
    }

    const rowsHtml = event.particles
      .map(
        (p) => `
        <tr>
          <td>${p.id}</td>
          <td><strong>${escapeXml(p.name)}</strong></td>
          <td>${p.pdgId}</td>
          <td>${p.charge >= 0 ? "+" + p.charge : p.charge}</td>
          <td>(${p.px.toFixed(3)}, ${p.py.toFixed(3)}, ${p.pz.toFixed(3)})</td>
          <td>${p.energy.toFixed(4)}</td>
          <td>${p.mass.toFixed(4)}</td>
          <td><span class="status-badge ${p.status}">${p.status}</span></td>
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
      background: #8b5cf6;
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
    .status-badge {
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.75em;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-badge.initial {
      background: #0284c7;
      color: #ffffff;
    }
    .status-badge.final {
      background: #10b981;
      color: #ffffff;
    }
    .status-badge.intermediate {
      background: #f59e0b;
      color: #ffffff;
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
    <span>Particle Event &amp; Dalitz Kinematics Inspector</span>
    <span class="badge">HepMC / PDG</span>
  </h2>

  <div class="toolbar">
    <div class="control-group">
      <input type="checkbox" id="checkResonances" ${this._showResonances ? "checked" : ""}>
      <label for="checkResonances">Resonance Bands (Breit-Wigner)</label>
    </div>
    <div class="control-group">
      <input type="checkbox" id="checkBoundary" ${this._showBoundary ? "checked" : ""}>
      <label for="checkBoundary">Kinematic Boundary</label>
    </div>
    <div class="control-group">
      <input type="checkbox" id="checkHistogram" ${this._showHistogram ? "checked" : ""}>
      <label for="checkHistogram">Invariant Mass Projection</label>
    </div>
    <div class="control-group">
      <label for="sampleSlider">Phase-Space Samples:</label>
      <input type="range" id="sampleSlider" min="50" max="500" step="25" value="${this._numPhaseSpaceEvents}">
      <span id="sampleLabel">${this._numPhaseSpaceEvents}</span>
    </div>
  </div>

  <div class="svg-container">
    ${svg}
  </div>

  <div class="info-card">
    <div class="info-title">Collision Record: Event #${event.eventId} &mdash; ${escapeXml(event.process)} (E<sub>CM</sub> = ${event.centerOfMassEnergyGev.toFixed(2)} GeV)</div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Particle</th>
          <th>PDG ID</th>
          <th>Charge (e)</th>
          <th>Momentum (px, py, pz) [GeV/c]</th>
          <th>Energy [GeV]</th>
          <th>Mass [GeV/c&sup2;]</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="info-title">Relativistic Conservation &amp; Mass Shell Diagnostics</div>
    ${diagsHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    ['checkResonances', 'checkBoundary', 'checkHistogram'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        vscode.postMessage({
          command: 'updateSettings',
          showResonances: document.getElementById('checkResonances').checked,
          showBoundary: document.getElementById('checkBoundary').checked,
          showHistogram: document.getElementById('checkHistogram').checked
        });
      });
    });

    document.getElementById('sampleSlider').addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      document.getElementById('sampleLabel').innerText = val;
      vscode.postMessage({ command: 'updateSettings', numSamples: val });
    });
  </script>
</body>
</html>`;
  }

  private _resolveHepEventData(): HepEvent {
    if (this.targetUri) {
      try {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.targetUri);
        if (doc) {
          return parseHepEvent(doc.getText());
        }
      } catch {
        // Fall back to synthetic data
      }
    }
    return parseHepEvent("");
  }
}

export class HepEventViewerEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.hepEventEditor";

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    _webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    HepEventViewerPanel.createOrShow(this.extensionUri, undefined, document.uri.toString());
  }
}
