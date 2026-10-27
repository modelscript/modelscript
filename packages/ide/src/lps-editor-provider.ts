// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * LPS / PipelineStudio (TGNET & TLNET) Visual Custom Editor Provider.
 *
 * Provides a high-fidelity visual workspace for gas & liquid transmission pipeline engineers:
 *   1. Interactive P&ID Network Schematic with pressure gradient heatmaps and compressor/pump stations.
 *   2. Hydraulic Gradient Profile P(x) along pipeline chainage vs MAOP safety envelope.
 *   3. Real-time Line Pack Storage analytics: deliverable energy buffer (GWh), MMSm³, and exhaustion timeline.
 *   4. ASME B31.8 / B31.4 design compliance verification and pre-flight safety diagnostics (M8001–M8012).
 *   5. Instant cross-language projection to formal SysML v2 specifications.
 */

import {
  renderCompressorMapSvg,
  renderLpsPressureProfileSvg,
  renderLpsSchematicSvg,
} from "@modelscript/diagram/lps-diagram-builder";
import {
  LinePackEngine,
  lintLpsModel,
  parseLps,
  PipelineVerifier,
  projectLpsToSysml2,
  SteadyNetworkSolver,
  type LinePackAnalysis,
  type LpsDiagnostic,
  type LpsModel,
  type LpsSteadyResult,
  type PipelineVerificationReport,
} from "@modelscript/lps";
import * as vscode from "vscode";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export class LpsEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.lpsEditor";

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,

    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.configureWebview(webviewPanel);

    let disposed = false;
    webviewPanel.webview.html = this.getHtmlForWebview();

    const updateWebview = () => {
      if (disposed) return;
      try {
        const text = document.getText();
        const model: LpsModel = parseLps(text);
        const diags: LpsDiagnostic[] = lintLpsModel(model);
        const steady: LpsSteadyResult = SteadyNetworkSolver.solve(model);
        const linePack: LinePackAnalysis = LinePackEngine.analyze(model, steady);
        const report: PipelineVerificationReport = PipelineVerifier.verifySteady(model, steady);
        const sysml2Code: string = projectLpsToSysml2(model);
        const schematicSvg: string = renderLpsSchematicSvg(model, steady);
        const profileSvg: string = renderLpsPressureProfileSvg(model, steady);
        const firstComp = model.compressors[0];
        const compressorMapSvg: string = firstComp
          ? renderCompressorMapSvg(firstComp.name, firstComp.maxPower / 1000, firstComp.maxSpeed ?? 9500)
          : "";

        webviewPanel.webview.postMessage({
          type: "update",
          id: model.id,
          title: model.title,
          simType: model.type,
          nodeCount: model.nodes.length,
          pipeCount: model.pipes.length,
          compressorCount: model.compressors.length,
          pumpCount: model.pumps.length,
          schematicSvg,
          profileSvg,
          compressorMapSvg,
          diagnostics: diags,
          verification: report,
          linePack,
          sysml2Code,
          nodes: model.nodes,
          pipes: model.pipes,
          pipeStates: steady.pipeStates,
          nodeStates: steady.nodeStates,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        webviewPanel.webview.postMessage({
          type: "error",
          message: `Failed to parse PipelineStudio model: ${message}`,
        });
      }
    };

    // Initial render
    updateWebview();

    // Re-render when document changes
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    // Handle messages from the webview
    const msgSubscription = webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "ready":
          updateWebview();
          break;

        case "exportSvg": {
          try {
            const model = parseLps(document.getText());
            const steady = SteadyNetworkSolver.solve(model);
            const svgContent = renderLpsSchematicSvg(model, steady);
            const uri = await vscode.window.showSaveDialog({
              filters: { "SVG Images": ["svg"] },
              defaultUri: vscode.Uri.file(`${model.title.replace(/\s+/g, "_").toLowerCase()}_schematic.svg`),
            });
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, Buffer.from(svgContent, "utf8"));
              void vscode.window.showInformationMessage(`Exported schematic SVG to ${uri.fsPath}`);
            }
          } catch (err: unknown) {
            void vscode.window.showErrorMessage(`Failed to export SVG: ${String(err)}`);
          }
          break;
        }

        case "exportSysml2": {
          try {
            const model = parseLps(document.getText());
            const sysmlContent = projectLpsToSysml2(model);
            const uri = await vscode.window.showSaveDialog({
              filters: { "SysML v2 Files": ["sysml"] },
              defaultUri: vscode.Uri.file(`${model.title.replace(/\s+/g, "_").toLowerCase()}.sysml`),
            });
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, Buffer.from(sysmlContent, "utf8"));
              void vscode.window.showInformationMessage(`Exported SysML v2 to ${uri.fsPath}`);
            }
          } catch (err: unknown) {
            void vscode.window.showErrorMessage(`Failed to export SysML v2: ${String(err)}`);
          }
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      changeSubscription.dispose();
      msgSubscription.dispose();
    });
  }

  private getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' 'unsafe-eval' https:; connect-src https: http: ws: wss:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PipelineStudio Visual Workspace</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #151d2f;
      --border: #23314d;
      --accent: #06b6d4;
      --accent-glow: rgba(6, 182, 212, 0.25);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      padding: 16px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 12px;
    }
    .title-group h1 { font-size: 18px; font-weight: 700; color: #fff; }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--accent);
      margin-left: 8px;
    }
    .actions { display: flex; gap: 8px; }
    button {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    button:hover {
      background: var(--border);
      border-color: var(--accent);
      color: #fff;
    }
    .tabs {
      display: flex;
      gap: 6px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 6px;
    }
    .tab {
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      background: transparent;
      border: none;
    }
    .tab.active {
      color: #fff;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-bottom: 2px solid var(--accent);
    }
    .content-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }
    .tab-panel {
      display: none;
      height: 100%;
      width: 100%;
      overflow: auto;
    }
    .tab-panel.active { display: flex; flex-direction: column; }
    .svg-container {
      flex: 1;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #080c14;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: auto;
    }
    .svg-container svg { width: 100%; height: 100%; max-height: 100%; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }
    .kpi-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; }
    .kpi-value { font-size: 22px; font-weight: 700; color: #fff; margin-top: 4px; }
    .kpi-sub { font-size: 11px; color: var(--accent); margin-top: 4px; }
    .code-box {
      background: #080c14;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      font-family: "JetBrains Mono", Consolas, Menlo, monospace;
      font-size: 12px;
      color: #e2e8f0;
      white-space: pre-wrap;
      overflow: auto;
      flex: 1;
    }
    .diag-banner {
      padding: 8px 12px;
      border-radius: 6px;
      margin-bottom: 10px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .diag-banner.error { background: rgba(239, 68, 68, 0.15); border: 1px solid var(--danger); color: #fca5a5; }
    .diag-banner.warning { background: rgba(245, 158, 11, 0.15); border: 1px solid var(--warning); color: #fde68a; }
    .diag-banner.clean { background: rgba(16, 185, 129, 0.15); border: 1px solid var(--success); color: #a7f3d0; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: #1a233a; color: var(--text-muted); font-weight: 600; text-transform: uppercase; font-size: 10px; }
    tr:hover { background: rgba(255, 255, 255, 0.02); }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <span id="title">PipelineStudio Network</span>
      <span id="simTypeBadge" class="badge">TGNET</span>
      <span id="assetBadge" class="badge">0 Pipes</span>
    </div>
    <div class="actions">
      <button id="btnExportSvg">Export SVG</button>
      <button id="btnExportSysml2">Export SysML v2</button>
    </div>
  </div>

  <div id="diagnosticsBanner"></div>

  <div class="tabs">
    <button class="tab active" data-tab="schematic">Network Schematic</button>
    <button class="tab" data-tab="profile">Hydraulic Profile P(x)</button>
    <button class="tab" data-tab="machinery">Machinery & Curves</button>
    <button class="tab" data-tab="linepack">Line Pack & Storage</button>
    <button class="tab" data-tab="compliance">ASME Safety Compliance</button>
    <button class="tab" data-tab="sysml2">SysML v2 Specification</button>
  </div>

  <div class="content-area">
    <!-- Tab 1: Schematic View -->
    <div id="tab-schematic" class="tab-panel active">
      <div id="schematicSvgBox" class="svg-container"></div>
    </div>

    <!-- Tab 2: Profile View -->
    <div id="tab-profile" class="tab-panel">
      <div id="profileSvgBox" class="svg-container"></div>
    </div>

    <!-- Tab 6: Machinery Performance Curves -->
    <div id="tab-machinery" class="tab-panel">
      <div id="machinerySvgBox" class="svg-container"></div>
    </div>

    <!-- Tab 3: Line Pack Storage -->
    <div id="tab-linepack" class="tab-panel">
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Total Line Pack Inventory</div>
          <div id="lpTotalSm3" class="kpi-value">0.0 MMSm³</div>
          <div id="lpTotalKg" class="kpi-sub">0 Tonnes</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Deliverable Line Pack</div>
          <div id="lpDeliverableSm3" class="kpi-value">0.0 MMSm³</div>
          <div class="kpi-sub">Above Minimum Contractual Pressure</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Stored Energy Equivalent</div>
          <div id="lpEnergyGwh" class="kpi-value">0.0 GWh</div>
          <div id="lpH2Frac" class="kpi-sub">H₂ Blend: 0.0%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Storage Depletion Buffer</div>
          <div id="lpExhaustion" class="kpi-value">> 48 Hours</div>
          <div class="kpi-sub">Peak Shaving Security Margin</div>
        </div>
      </div>
      <div style="flex: 1; overflow: auto; background: var(--card-bg); border-radius: 8px; border: 1px solid var(--border); padding: 12px;">
        <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">Pipeline Segment Inventory Details</h3>
        <table id="pipeTable">
          <thead>
            <tr>
              <th>Pipe</th>
              <th>From</th>
              <th>To</th>
              <th>Diameter</th>
              <th>Length</th>
              <th>Inlet P</th>
              <th>Outlet P</th>
              <th>Flow</th>
              <th>Velocity</th>
              <th>Inventory</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <!-- Tab 4: ASME Safety Compliance -->
    <div id="tab-compliance" class="tab-panel">
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Safety Status</div>
          <div id="verStatus" class="kpi-value" style="color: var(--success);">PASSED</div>
          <div id="verChecks" class="kpi-sub">0 Checks Executed</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Max Observed Pressure</div>
          <div id="verMaxP" class="kpi-value">0.0 bar</div>
          <div class="kpi-sub">ASME B31.8 / B31.4 MAOP</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Min City Gate Delivery</div>
          <div id="verMinP" class="kpi-value">0.0 bar</div>
          <div class="kpi-sub">Contractual Floor Limit</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Peak Flow Velocity</div>
          <div id="verMaxVel" class="kpi-value">0.0 m/s</div>
          <div class="kpi-sub">API RP 14E Erosional Limit</div>
        </div>
      </div>
      <div style="flex: 1; overflow: auto; background: var(--card-bg); border-radius: 8px; border: 1px solid var(--border); padding: 12px;">
        <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">Design Margin Violations & Linter Warnings</h3>
        <div id="violationsList"></div>
      </div>
    </div>

    <!-- Tab 5: SysML v2 Projection -->
    <div id="tab-sysml2" class="tab-panel">
      <div id="sysmlCodeBox" class="code-box"></div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // Tab switching
    document.querySelectorAll(".tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        const panel = document.getElementById("tab-" + tab.dataset.tab);
        if (panel) panel.classList.add("active");
      });
    });

    document.getElementById("btnExportSvg").addEventListener("click", () => {
      vscode.postMessage({ type: "exportSvg" });
    });
    document.getElementById("btnExportSysml2").addEventListener("click", () => {
      vscode.postMessage({ type: "exportSysml2" });
    });

    window.addEventListener("message", event => {
      const msg = event.data;
      if (msg.type === "update") {
        document.getElementById("title").textContent = msg.title || msg.id;
        document.getElementById("simTypeBadge").textContent = msg.simType;
        document.getElementById("assetBadge").textContent = \`\${msg.pipeCount} Pipes | \${msg.nodeCount} Nodes | \${msg.compressorCount} Comps\`;

        // SVGs
        document.getElementById("schematicSvgBox").innerHTML = msg.schematicSvg;
        document.getElementById("profileSvgBox").innerHTML = msg.profileSvg;
        if (msg.compressorMapSvg && document.getElementById("machinerySvgBox")) {
          document.getElementById("machinerySvgBox").innerHTML = msg.compressorMapSvg;
        }

        // Line Pack
        if (msg.linePack) {
          const mmsm3 = (msg.linePack.totalLinePackSm3 / 1e6).toFixed(2);
          const delMmsm3 = (msg.linePack.deliverableLinePackSm3 / 1e6).toFixed(2);
          document.getElementById("lpTotalSm3").textContent = \`\${mmsm3} MMSm³\`;
          document.getElementById("lpTotalKg").textContent = \`\${(msg.linePack.totalLinePackKg / 1000).toFixed(0)} Metric Tonnes\`;
          document.getElementById("lpDeliverableSm3").textContent = \`\${delMmsm3} MMSm³\`;
          document.getElementById("lpEnergyGwh").textContent = \`\${msg.linePack.totalEnergyStoredGWh.toFixed(1)} GWh\`;
          document.getElementById("lpH2Frac").textContent = \`H₂ Blend: \${(msg.linePack.hydrogenVolumePercent).toFixed(1)}%\`;
          document.getElementById("lpExhaustion").textContent = \`\${msg.linePack.exhaustionTimeHours.toFixed(1)} Hours\`;
        }

        // Pipe table
        const tbody = document.querySelector("#pipeTable tbody");
        tbody.innerHTML = "";
        for (const p of msg.pipes || []) {
          const st = (msg.pipeStates && msg.pipeStates[p.name]) || {};
          const row = document.createElement("tr");
          row.innerHTML = \`
            <td style="font-weight: 600; color: #fff;">\${p.name}</td>
            <td>\${p.fromNode}</td>
            <td>\${p.toNode}</td>
            <td>\${Math.round(p.diameter * 1000)} mm</td>
            <td>\${(p.length / 1000).toFixed(1)} km</td>
            <td>\${(st.inletPressure ? st.inletPressure / 1e5 : 0).toFixed(1)} bar</td>
            <td>\${(st.outletPressure ? st.outletPressure / 1e5 : 0).toFixed(1)} bar</td>
            <td>\${(st.massFlow || 0).toFixed(1)} kg/s</td>
            <td>\${(st.velocity || 0).toFixed(1)} m/s</td>
            <td>\${(st.linePackKg ? st.linePackKg / 1000 : 0).toFixed(1)} t</td>
          \`;
          tbody.appendChild(row);
        }

        // Verification & Compliance
        if (msg.verification) {
          const v = msg.verification;
          const statusEl = document.getElementById("verStatus");
          statusEl.textContent = v.passed ? "PASSED" : "VIOLATIONS DETECTED";
          statusEl.style.color = v.passed ? "var(--success)" : "var(--danger)";
          document.getElementById("verChecks").textContent = \`\${v.totalChecks} Safety Checks Evaluated\`;
          document.getElementById("verMaxP").textContent = \`\${v.summary.maxObservedPressureBar.toFixed(1)} bar\`;
          document.getElementById("verMinP").textContent = \`\${v.summary.minDeliveryPressureBar.toFixed(1)} bar\`;
          document.getElementById("verMaxVel").textContent = \`\${v.summary.maxVelocityMps.toFixed(1)} m/s\`;

          const vList = document.getElementById("violationsList");
          vList.innerHTML = "";
          if (v.violations && v.violations.length > 0) {
            for (const viol of v.violations) {
              const div = document.createElement("div");
              div.className = "diag-banner error";
              div.textContent = \`[ASME \${viol.criterion}] \${viol.message}\`;
              vList.appendChild(div);
            }
          } else {
            const div = document.createElement("div");
            div.className = "diag-banner clean";
            div.textContent = "✔ Fully compliant with ASME B31.8 / B31.4 MAOP ratings and delivery pressure commitments.";
            vList.appendChild(div);
          }
        }

        // Diagnostics Banner
        const banner = document.getElementById("diagnosticsBanner");
        banner.innerHTML = "";
        const diags = msg.diagnostics || [];
        if (diags.length > 0) {
          for (const d of diags) {
            const div = document.createElement("div");
            div.className = "diag-banner " + (d.severity === "error" ? "error" : "warning");
            div.textContent = \`[\${d.code}] \${d.message}\`;
            banner.appendChild(div);
          }
        }

        // SysML v2
        document.getElementById("sysmlCodeBox").textContent = msg.sysml2Code || "// No SysML v2 projection available";
      }
    });

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
  }
}
