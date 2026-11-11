// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide-client — Water & Hydraulic Network Visual Diff Panel
 *
 * Provides visual diff comparison for EPANET and SWMM hydraulic distribution models (.inp):
 * - Semantic network diff computing added (green), deleted (red), and modified (amber) nodes & links
 * - Delta metrics: pipe diameter modifications, roughness shifts, and pressure/velocity variations
 * - Interactive Git-like review summary card with network statistics
 */

import {
  diffEpanetNetworks,
  renderEpanetDiffSvg,
  type EpanetModelLike,
  type EpanetNetworkDiff,
} from "@modelscript/diagram/water-network-diff";
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

export class WaterDiffPanel extends BaseWebviewPanel {
  public static currentPanel: WaterDiffPanel | undefined;
  public static readonly viewType = "modelscript.waterDiffViewer";

  private readonly _client?: LanguageClient | undefined;
  public targetUri: string | undefined;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, targetUri?: string): void {
    const activeEditorDoc = vscode.window.activeTextEditor?.document;
    const resolvedUri =
      targetUri ??
      (activeEditorDoc && activeEditorDoc.uri.scheme !== "output" ? activeEditorDoc.uri.toString() : undefined);

    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (WaterDiffPanel.currentPanel) {
      if (resolvedUri) {
        WaterDiffPanel.currentPanel.targetUri = resolvedUri;
      }
      WaterDiffPanel.currentPanel._panel.reveal(column);
      WaterDiffPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(WaterDiffPanel.viewType, "Water Network Diff Viewer", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    WaterDiffPanel.currentPanel = new WaterDiffPanel(panel, extensionUri, client, resolvedUri);
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
    this.update();
  }

  public override dispose(): void {
    WaterDiffPanel.currentPanel = undefined;
    super.dispose();
  }

  public update(): void {
    const baseModel: EpanetModelLike = {
      title: "Base Drinking Water Distribution Network",
      junctions: [
        { id: "J1", elevation: 120, demand: 15, pressure: 42, x: 100, y: 150 },
        { id: "J2", elevation: 115, demand: 25, pressure: 38, x: 250, y: 150 },
        { id: "J3", elevation: 110, demand: 20, pressure: 35, x: 400, y: 150 },
        { id: "J4_Old", elevation: 108, demand: 10, pressure: 33, x: 250, y: 300 },
      ],
      reservoirs: [{ id: "R1", totalHead: 150, x: 100, y: 50 }],
      tanks: [],
      pipes: [
        { id: "P1", node1: "R1", node2: "J1", length: 500, diameter: 300, roughness: 120, flow: 70, velocity: 1.2 },
        { id: "P2", node1: "J1", node2: "J2", length: 600, diameter: 200, roughness: 100, flow: 55, velocity: 1.4 },
        { id: "P3", node1: "J2", node2: "J3", length: 600, diameter: 150, roughness: 90, flow: 20, velocity: 0.9 },
        {
          id: "P4_Old",
          node1: "J2",
          node2: "J4_Old",
          length: 450,
          diameter: 150,
          roughness: 80,
          flow: 10,
          velocity: 0.6,
        },
      ],
      pumps: [],
      valves: [],
    };

    const targetModel: EpanetModelLike = {
      title: "Upgraded Network with Looped Transmission",
      junctions: [
        { id: "J1", elevation: 120, demand: 15, pressure: 44, x: 100, y: 150 },
        { id: "J2", elevation: 115, demand: 25, pressure: 41, x: 250, y: 150 },
        { id: "J3", elevation: 110, demand: 20, pressure: 39, x: 400, y: 150 },
        { id: "J5_New", elevation: 105, demand: 30, pressure: 36, x: 400, y: 300 }, // Added
      ],
      reservoirs: [{ id: "R1", totalHead: 150, x: 100, y: 50 }],
      tanks: [{ id: "T1_New", elevation: 135, initLevel: 5, maxLevel: 10, diameter: 20, x: 550, y: 300 }], // Added Tank
      pipes: [
        { id: "P1", node1: "R1", node2: "J1", length: 500, diameter: 350, roughness: 130, flow: 90, velocity: 1.3 }, // Modified diameter
        { id: "P2", node1: "J1", node2: "J2", length: 600, diameter: 250, roughness: 120, flow: 75, velocity: 1.5 }, // Modified diameter
        { id: "P3", node1: "J2", node2: "J3", length: 600, diameter: 200, roughness: 110, flow: 35, velocity: 1.1 }, // Modified diameter
        {
          id: "P5_Loop",
          node1: "J3",
          node2: "J5_New",
          length: 500,
          diameter: 200,
          roughness: 120,
          flow: 25,
          velocity: 0.8,
        }, // Added Loop
        {
          id: "P6_Feed",
          node1: "J5_New",
          node2: "T1_New",
          length: 400,
          diameter: 200,
          roughness: 120,
          flow: 20,
          velocity: 0.7,
        }, // Added Pipe
      ],
      pumps: [],
      valves: [],
    };

    const diff = diffEpanetNetworks(baseModel, targetModel);
    const svg = renderEpanetDiffSvg(diff, { theme: "dark", width: 900, height: 500 });

    this._panel.webview.html = this._getHtmlForWebview(diff, svg);
  }

  private _getHtmlForWebview(diff: EpanetNetworkDiff, svgMarkup: string): string {
    const stats = diff.stats;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Water Network Diff Visualizer</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --added: #238636;
      --deleted: #da3633;
      --modified: #d29922;
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
    .stats-bar {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .badge-added { background: rgba(35, 134, 54, 0.2); color: #3fb950; border: 1px solid var(--added); }
    .badge-deleted { background: rgba(218, 54, 51, 0.2); color: #f85149; border: 1px solid var(--deleted); }
    .badge-modified { background: rgba(210, 153, 34, 0.2); color: #d29922; border: 1px solid var(--modified); }
    .controls-grid {
      display: grid;
      grid-template-columns: 2.2fr 1fr;
      gap: 16px;
    }
    .diff-card {
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
      width: 50%;
    }
    label {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h2>Water Network Semantic Diff Review</h2>
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 2px;">
        ${escapeXml(diff.baseModel.title || "Base Model")} → ${escapeXml(diff.targetModel.title || "Target Model")}
      </div>
    </div>
    <div class="stats-bar">
      <span class="badge badge-added">+${stats.addedNodes + stats.addedLinks} Added</span>
      <span class="badge badge-deleted">-${stats.deletedNodes + stats.deletedLinks} Removed</span>
      <span class="badge badge-modified">~${stats.modifiedNodes + stats.modifiedLinks} Modified</span>
    </div>
  </div>

  <div class="controls-grid">
    <div class="diff-card">
      ${svgMarkup}
    </div>

    <div class="params-card">
      <label>Hydraulic Impact Metrics</label>
      <table class="info-table">
        <tr>
          <td>Added Junctions/Tanks</td>
          <td style="color: #3fb950; font-weight: 600;">+${stats.addedNodes}</td>
        </tr>
        <tr>
          <td>Removed Nodes</td>
          <td style="color: #f85149; font-weight: 600;">-${stats.deletedNodes}</td>
        </tr>
        <tr>
          <td>Added Pipes/Conduits</td>
          <td style="color: #3fb950; font-weight: 600;">+${stats.addedLinks}</td>
        </tr>
        <tr>
          <td>Removed Pipes</td>
          <td style="color: #f85149; font-weight: 600;">-${stats.deletedLinks}</td>
        </tr>
        <tr>
          <td>Modified Diameter / Roughness</td>
          <td style="color: #d29922; font-weight: 600;">${stats.modifiedLinks} links</td>
        </tr>
        <tr>
          <td>Max Pressure Delta (ΔP)</td>
          <td>${stats.maxPressureDeltaM.toFixed(2)} m</td>
        </tr>
        <tr>
          <td>Max Velocity Delta (Δv)</td>
          <td>${stats.maxVelocityDeltaMs.toFixed(2)} m/s</td>
        </tr>
      </table>

      <div style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.4; margin-top: 8px;">
        💡 Git-style color highlighting: <strong>Green</strong> lines denote newly laid transmission mains; <strong>Amber</strong> lines denote diameter capacity enlargements; <strong>Red dashed</strong> lines denote decommissioned pipes.
      </div>
    </div>
  </div>
</body>
</html>`;
  }
}

export class WaterDiffEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.waterDiffEditor";

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    _webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    WaterDiffPanel.createOrShow(this.extensionUri, undefined, document.uri.toString());
  }
}
