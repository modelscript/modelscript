// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SIMA / SIMO / RIFLEX Visual Marine Modeling & Station-Keeping Custom Editor Provider.
 *
 * Provides a high-fidelity visual workspace for naval architects and offshore mooring engineers:
 *   1. Interactive 2D Catenary Sag Profile preview (water depth, touchdown point, fairlead tension).
 *   2. Overhead Polar Mooring Spread layout (vessel heading, watch circle, environmental vectors).
 *   3. Tabular Multi-Segment Line details (length, diameter, submerged weight, EA, MBL).
 *   4. DNV-OS-E301 / DNV-ST-0119 regulatory compliance evaluation with intact & damaged safety factors.
 *   5. Instant cross-domain projections to Modelica 3.x, FMI SystemStructure.ssd (SSP), and SysML v2.
 */

import { renderSimaCatenaryProfileSvg, renderSimaMooringSpreadSvg } from "@modelscript/diagram/sima-diagram-builder";
import {
  evaluateOffsetLimits,
  lintSimaProject,
  parseSimaFile,
  simaToModelica,
  simaToSsp,
  simaToSysml2,
  verifyDnvMooringCompliance,
  type DnvVerificationReport,
  type OffsetLimitReport,
  type SimaDiagnostic,
  type SimaModel,
} from "@modelscript/sima";
import * as vscode from "vscode";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export class SimaEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.simaEditor";

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.configureWebview(webviewPanel);

    let disposed = false;
    webviewPanel.webview.html = this.getHtmlForWebview();

    const updateWebview = () => {
      if (disposed) return;
      try {
        const text = document.getText();
        const model: SimaModel = parseSimaFile(text);
        const diags: SimaDiagnostic[] = lintSimaProject(model);
        const dnvReport: DnvVerificationReport = verifyDnvMooringCompliance(model);
        const offsetReport: OffsetLimitReport = evaluateOffsetLimits(model);
        const modelicaCode: string = simaToModelica(model);
        const sspCode: string = simaToSsp(model);
        const sysml2Code: string = simaToSysml2(model);

        // Generate Catenary Profile SVG for first active mooring line
        const firstLine = model.lines[0];
        const avgWeight = firstLine
          ? firstLine.segments.reduce((acc, s) => acc + s.submergedWeightPerMeter, 0) /
            Math.max(1, firstLine.segments.length)
          : 2500;

        const catenarySvg = renderSimaCatenaryProfileSvg({
          title: firstLine ? `Catenary Profile: ${firstLine.name}` : "Catenary Profile Preview",
          waterDepth: model.environment.waterDepth,
          horizontalSpan: firstLine
            ? Math.hypot(
                (firstLine.fairleadPosition?.[0] ?? 0) - firstLine.anchorPosition[0],
                (firstLine.fairleadPosition?.[1] ?? 0) - firstLine.anchorPosition[1],
              )
            : 800,
          lineLength: firstLine ? firstLine.totalLength : 850,
          submergedWeight: avgWeight,
          fairleadTotalTension: dnvReport.lines[0]?.tensionIntact ?? 5e5,
        });

        // Generate Polar Mooring Spread SVG
        const spreadSvg = renderSimaMooringSpreadSvg({
          title: "Overhead Mooring Spread & Watch Circle",
          waterDepth: model.environment.waterDepth,
          vesselName: model.vessels[0]?.name ?? "Floater Platform",
          watchCircleRadius: offsetReport.watchCircleRadiusMeters,
          vesselOffset: offsetReport.meanOffsetMeters,
          lines: model.lines.map((l, i) => ({
            id: l.id,
            name: l.name,
            fairleadPos: l.fairleadPosition,
            anchorPos: l.anchorPosition,
            tension: dnvReport.lines[i]?.tensionIntact,
            mbl: l.segments[0]?.mbl,
          })),
          environment: {
            waveDir: model.environment.wave.direction,
            waveHs: model.environment.wave.hs,
            windDir: model.environment.wind.direction,
            windSpeed: model.environment.wind.speed,
            currentDir: model.environment.current.direction,
            currentSpeed: model.environment.current.surfaceSpeed,
          },
        });

        webviewPanel.webview.postMessage({
          type: "update",
          title: model.title ?? model.vessels[0]?.name ?? "SIMA Offshore System",
          vesselCount: model.vessels.length,
          lineCount: model.lines.length,
          waterDepth: model.environment.waterDepth,
          vessel: model.vessels[0],
          lines: model.lines,
          environment: model.environment,
          catenarySvg,
          spreadSvg,
          diagnostics: diags,
          dnvReport,
          offsetReport,
          modelicaCode,
          sspCode,
          sysml2Code,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        webviewPanel.webview.postMessage({
          type: "error",
          message: `Failed to parse SIMA / SIMO model: ${message}`,
        });
      }
    };

    updateWebview();

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      changeSubscription.dispose();
    });
  }

  protected getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SIMA Offshore Custom Editor</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #0f172a;
      --card-border: #1e293b;
      --accent: #38bdf8;
      --accent-muted: #0284c7;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --success: #22c55e;
      --warning: #f59e0b;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      background: var(--card-bg);
      border-bottom: 1px solid var(--card-border);
      padding: 12px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    .header-title { display: flex; align-items: center; gap: 12px; }
    .header-title h1 { font-size: 16px; font-weight: 700; color: var(--text); }
    .badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.3);
    }
    .badge.success { background: rgba(34, 197, 94, 0.15); color: var(--success); border-color: var(--success); }
    .badge.danger { background: rgba(239, 68, 68, 0.15); color: var(--danger); border-color: var(--danger); }
    
    .nav-tabs {
      display: flex;
      gap: 4px;
      background: rgba(15, 23, 42, 0.6);
      padding: 4px 20px;
      border-bottom: 1px solid var(--card-border);
      flex-shrink: 0;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border-radius: 6px;
      transition: all 0.15s ease;
    }
    .tab-btn:hover { color: var(--text); background: rgba(255, 255, 255, 0.05); }
    .tab-btn.active { color: #ffffff; background: var(--accent-muted); }

    .content-area {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .tab-pane { display: none; flex-direction: column; gap: 20px; }
    .tab-pane.active { display: flex; }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .card-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-val { font-size: 22px; font-weight: 800; color: var(--text); }
    .stat-sub { font-size: 12px; color: var(--text-muted); }

    .svg-container {
      background: #0b1120;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 420px;
    }
    .svg-container svg { width: 100%; height: auto; max-height: 520px; }

    table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
    th {
      background: rgba(30, 41, 59, 0.5);
      color: var(--text-muted);
      padding: 10px 12px;
      font-weight: 600;
      border-bottom: 1px solid var(--card-border);
    }
    td { padding: 10px 12px; border-bottom: 1px solid rgba(30, 41, 59, 0.4); }
    tr:hover td { background: rgba(56, 189, 248, 0.04); }

    pre {
      background: #020617;
      border: 1px solid var(--card-border);
      padding: 16px;
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: #cbd5e1;
      overflow-x: auto;
      max-height: 450px;
    }
    .diag-banner {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid var(--danger);
      padding: 12px 16px;
      border-radius: 6px;
      color: #fca5a5;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-title">
      <h1 id="modelTitle">SIMA Offshore Mooring Studio</h1>
      <span id="dnvStatusBadge" class="badge">Checking...</span>
    </div>
    <div style="font-size: 12px; color: var(--text-muted);" id="headerMeta">Loading workspace...</div>
  </header>

  <nav class="nav-tabs">
    <button class="tab-btn active" onclick="showTab('tab-overview')">Overview &amp; Catenary</button>
    <button class="tab-btn" onclick="showTab('tab-spread')">Mooring Spread &amp; Excursion</button>
    <button class="tab-btn" onclick="showTab('tab-vessel')">Floater &amp; Hydrodynamics</button>
    <button class="tab-btn" onclick="showTab('tab-dnv')">DNV-OS-E301 Compliance</button>
    <button class="tab-btn" onclick="showTab('tab-projections')">Polyglot Projections</button>
  </nav>

  <div class="content-area">
    <!-- Diag Banner if errors exist -->
    <div id="diagBanner" style="display: none;" class="diag-banner"></div>

    <!-- TAB 1: Overview & Catenary Profile -->
    <div id="tab-overview" class="tab-pane active">
      <div class="grid-4">
        <div class="card">
          <div class="card-title">Water Depth</div>
          <div class="stat-val" id="cardDepth">200.0 m</div>
          <div class="stat-sub">Seabed to Mean Sea Level</div>
        </div>
        <div class="card">
          <div class="card-title">Spread Lines</div>
          <div class="stat-val" id="cardLines">3</div>
          <div class="stat-sub">Segmented Catenary Mooring</div>
        </div>
        <div class="card">
          <div class="card-title">Max Line Tension</div>
          <div class="stat-val" id="cardTension">-- kN</div>
          <div class="stat-sub">DNV Intact Design Tension</div>
        </div>
        <div class="card">
          <div class="card-title">Min Safety Factor</div>
          <div class="stat-val" id="cardMinSf">--</div>
          <div class="stat-sub">Target SF &ge; 1.67 (Intact)</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">2D Catenary Sag Profile Preview</div>
        <div class="svg-container" id="catenarySvgContainer">Loading catenary profile...</div>
      </div>
    </div>

    <!-- TAB 2: Mooring Spread & Polar Layout -->
    <div id="tab-spread" class="tab-pane">
      <div class="grid-2">
        <div class="card">
          <div class="card-title">Overhead Polar Mooring Spread</div>
          <div class="svg-container" id="spreadSvgContainer">Loading spread...</div>
        </div>
        <div class="card">
          <div class="card-title">Mooring Line Segment Schedule</div>
          <div style="overflow-x: auto;">
            <table id="linesTable">
              <thead>
                <tr>
                  <th>Line ID</th>
                  <th>Length (m)</th>
                  <th>Sub. Weight (N/m)</th>
                  <th>EA (N)</th>
                  <th>MBL (kN)</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 3: Floater & Hydrodynamics -->
    <div id="tab-vessel" class="tab-pane">
      <div class="grid-2">
        <div class="card">
          <div class="card-title">Floater Vessel 6-DOF Characteristics</div>
          <table id="vesselTable">
            <tbody></tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-title">Environmental Metocean Forcing</div>
          <table id="envTable">
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB 4: DNV Compliance -->
    <div id="tab-dnv" class="tab-pane">
      <div class="card">
        <div class="card-title">DNV-OS-E301 / DNV-ST-0119 Mooring Tension Safety Analysis</div>
        <div style="overflow-x: auto;">
          <table id="dnvTable">
            <thead>
              <tr>
                <th>Line</th>
                <th>MBL (kN)</th>
                <th>Intact Tension (kN)</th>
                <th>Intact SF</th>
                <th>Intact Status</th>
                <th>Damaged Tension (kN)</th>
                <th>Damaged SF</th>
                <th>Damaged Status</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB 5: Polyglot Projections -->
    <div id="tab-projections" class="tab-pane">
      <div class="card">
        <div class="card-title">Modelica 3.x MultiBody Model</div>
        <pre><code id="codeModelica">// Modelica projection code</code></pre>
      </div>
      <div class="card">
        <div class="card-title">SysML v2 Architecture &amp; Formal Constraints</div>
        <pre><code id="codeSysml">// SysML v2 projection code</code></pre>
      </div>
    </div>
  </div>

  <script>
    function showTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      event.target.classList.add('active');
      const pane = document.getElementById(tabId);
      if (pane) pane.classList.add('active');
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'error') {
        const b = document.getElementById('diagBanner');
        b.style.display = 'block';
        b.textContent = msg.message;
        return;
      }
      if (msg.type === 'update') {
        document.getElementById('modelTitle').textContent = msg.title;
        document.getElementById('headerMeta').textContent = 'Water Depth: ' + msg.waterDepth + 'm | ' + msg.lineCount + ' lines | Floater: ' + (msg.vessel ? msg.vessel.name : 'Vessel');

        // Update cards
        document.getElementById('cardDepth').textContent = msg.waterDepth.toFixed(1) + ' m';
        document.getElementById('cardLines').textContent = msg.lineCount;

        if (msg.dnvReport && msg.dnvReport.summary) {
          const sum = msg.dnvReport.summary;
          document.getElementById('cardMinSf').textContent = sum.minSafetyFactor.toFixed(2);
          const badge = document.getElementById('dnvStatusBadge');
          if (sum.allPassed) {
            badge.className = 'badge success';
            badge.textContent = 'DNV COMPLIANT';
          } else {
            badge.className = 'badge danger';
            badge.textContent = 'DNV NON-COMPLIANT';
          }
        }

        // SVGs
        if (msg.catenarySvg) {
          document.getElementById('catenarySvgContainer').innerHTML = msg.catenarySvg;
        }
        if (msg.spreadSvg) {
          document.getElementById('spreadSvgContainer').innerHTML = msg.spreadSvg;
        }

        // Lines table
        const tbodyLines = document.querySelector('#linesTable tbody');
        if (tbodyLines && msg.lines) {
          tbodyLines.innerHTML = msg.lines.map(l => {
            const seg = l.segments[0] || {};
            return '<tr>' +
              '<td><b>' + l.name + '</b></td>' +
              '<td>' + l.totalLength.toFixed(1) + '</td>' +
              '<td>' + (seg.submergedWeightPerMeter || 2500).toFixed(0) + '</td>' +
              '<td>' + (seg.axialStiffnessEA ? seg.axialStiffnessEA.toExponential(2) : '1.25e9') + '</td>' +
              '<td>' + (seg.mbl ? (seg.mbl / 1000).toFixed(0) : '18000') + '</td>' +
            '</tr>';
          }).join('');
        }

        // DNV table
        const tbodyDnv = document.querySelector('#dnvTable tbody');
        if (tbodyDnv && msg.dnvReport && msg.dnvReport.lines) {
          tbodyDnv.innerHTML = msg.dnvReport.lines.map(l => {
            return '<tr>' +
              '<td><b>' + l.lineName + '</b></td>' +
              '<td>' + (l.mbl / 1000).toFixed(0) + '</td>' +
              '<td>' + (l.tensionIntact / 1000).toFixed(0) + '</td>' +
              '<td><b>' + l.safetyFactorIntact.toFixed(2) + '</b></td>' +
              '<td><span class="badge ' + (l.passedIntact ? 'success' : 'danger') + '">' + (l.passedIntact ? 'PASS' : 'FAIL') + '</span></td>' +
              '<td>' + (l.tensionDamaged / 1000).toFixed(0) + '</td>' +
              '<td><b>' + l.safetyFactorDamaged.toFixed(2) + '</b></td>' +
              '<td><span class="badge ' + (l.passedDamaged ? 'success' : 'danger') + '">' + (l.passedDamaged ? 'PASS' : 'FAIL') + '</span></td>' +
            '</tr>';
          }).join('');
        }

        // Floater vessel table
        const tbodyVessel = document.querySelector('#vesselTable tbody');
        if (tbodyVessel && msg.vessel) {
          const v = msg.vessel;
          tbodyVessel.innerHTML = 
            '<tr><th>Vessel ID / Name</th><td>' + v.id + ' (' + v.name + ')</td></tr>' +
            '<tr><th>Structural Mass</th><td>' + (v.mass / 1000).toFixed(1) + ' tonnes</td></tr>' +
            '<tr><th>Displacement Volume</th><td>' + v.displacement.toFixed(1) + ' m³</td></tr>' +
            '<tr><th>Transverse GM (GMt)</th><td><b>' + v.gmTransverse.toFixed(2) + ' m</b></td></tr>' +
            '<tr><th>Longitudinal GM (GMl)</th><td><b>' + v.gmLongitudinal.toFixed(2) + ' m</b></td></tr>' +
            '<tr><th>Fairlead Attachments</th><td>' + (v.fairleads ? v.fairleads.length : 0) + ' points</td></tr>';
        }

        // Environment table
        const tbodyEnv = document.querySelector('#envTable tbody');
        if (tbodyEnv && msg.environment) {
          const e = msg.environment;
          tbodyEnv.innerHTML = 
            '<tr><th>Wave Spectrum</th><td>' + e.wave.spectrum.toUpperCase() + ' (Hs=' + e.wave.hs + 'm, Tp=' + e.wave.tp + 's, Dir=' + e.wave.direction + '°)</td></tr>' +
            '<tr><th>Mean Wind</th><td>' + e.wind.speed + ' m/s @ ' + e.wind.direction + '°</td></tr>' +
            '<tr><th>Surface Current</th><td>' + e.current.surfaceSpeed + ' m/s @ ' + e.current.direction + '°</td></tr>' +
            '<tr><th>Water Density</th><td>' + e.waterDensity + ' kg/m³</td></tr>' +
            '<tr><th>Seabed Friction</th><td>μ = ' + e.seabedFriction + '</td></tr>';
        }

        // Projections
        if (msg.modelicaCode) document.getElementById('codeModelica').textContent = msg.modelicaCode;
        if (msg.sysml2Code) document.getElementById('codeSysml').textContent = msg.sysml2Code;
      }
    });
  </script>
</body>
</html>`;
  }
}
