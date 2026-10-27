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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' 'unsafe-eval' https:; connect-src https: http: ws: wss:;">
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
    .btn-ctrl {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .btn-ctrl:hover { background: rgba(56, 189, 248, 0.2); border-color: var(--accent); color: #fff; }
    .speed-selector { display: flex; background: rgba(15, 23, 42, 0.8); border: 1px solid var(--card-border); border-radius: 6px; padding: 2px; }
    .btn-speed {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border-radius: 4px;
    }
    .btn-speed.active { background: var(--accent-muted); color: #fff; }
    .hud-telemetry {
      position: absolute;
      top: 14px;
      left: 14px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 8px;
      padding: 12px 16px;
      width: 320px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      z-index: 10;
    }
    .hud-title {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.8px;
      color: var(--accent);
      margin-bottom: 8px;
      border-bottom: 1px solid rgba(56, 189, 248, 0.15);
      padding-bottom: 4px;
    }
    .hud-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 12px;
    }
    .hud-item { display: flex; flex-direction: column; }
    .hud-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; }
    .hud-val { font-size: 13px; font-weight: 700; color: #fff; font-family: ui-monospace, SFMono-Regular, monospace; }
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
    <button class="tab-btn" onclick="showTab('tab-3d')">🌊 3D Ocean &amp; 6-DOF Floater</button>
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

    <!-- TAB 3: 3D Ocean & 6-DOF Floater Dynamic Simulation -->
    <div id="tab-3d" class="tab-pane" style="position: relative;">
      <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px; padding: 8px 16px; flex-wrap: wrap; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <button id="btnPlayPause" class="btn-ctrl" onclick="togglePlayPause()">⏸ Pause</button>
          <button id="btnReset" class="btn-ctrl" onclick="resetSimTime()">🔄 Reset</button>
          <div class="speed-selector">
            <button class="btn-speed active" onclick="setSpeed(1)">1x</button>
            <button class="btn-speed" onclick="setSpeed(2)">2x</button>
            <button class="btn-speed" onclick="setSpeed(5)">5x</button>
          </div>
          <span id="simTimeReadout" style="font-family: monospace; font-size: 12px; color: var(--text-muted); margin-left: 8px;">Time: 0.0 s</span>
        </div>
        
        <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
          <label style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
            <span>Hs:</span>
            <input type="range" id="sliderHs" min="1" max="18" step="0.5" value="8.0" oninput="updateWaveParam()" style="width: 70px;">
            <span id="valHs" style="font-family: monospace; color: var(--accent); width: 34px;">8.0m</span>
          </label>
          <label style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
            <span>Tp:</span>
            <input type="range" id="sliderTp" min="5" max="22" step="0.5" value="12.5" oninput="updateWaveParam()" style="width: 70px;">
            <span id="valTp" style="font-family: monospace; color: var(--accent); width: 38px;">12.5s</span>
          </label>
          <label style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
            <span>Dir:</span>
            <input type="range" id="sliderDir" min="0" max="360" step="15" value="0" oninput="updateWaveParam()" style="width: 60px;">
            <span id="valDir" style="font-family: monospace; color: var(--accent); width: 32px;">0°</span>
          </label>
        </div>

        <div style="display: flex; align-items: center; gap: 4px;">
          <button class="btn-ctrl" onclick="setCameraPreset('orbit')">🎥 Orbit</button>
          <button class="btn-ctrl" onclick="setCameraPreset('top')">⬇ Top</button>
          <button class="btn-ctrl" onclick="setCameraPreset('side')">➡ Side</button>
          <button class="btn-ctrl" onclick="setCameraPreset('bow')">⛵ Bow</button>
        </div>
      </div>

      <div style="position: relative; width: 100%; height: 560px; background: #030712; border: 1px solid var(--card-border); border-radius: 8px; overflow: hidden; box-shadow: inset 0 2px 8px rgba(0,0,0,0.6);">
        <canvas id="sima-3d-canvas" style="width: 100%; height: 100%; display: block;"></canvas>
        <div id="hudTelemetry" class="hud-telemetry">
          <div class="hud-title">6-DOF DYNAMIC MOTION TELEMETRY</div>
          <div class="hud-grid">
            <div class="hud-item">
              <span class="hud-label">Wave Elev (&eta;)</span>
              <span id="hudEta" class="hud-val">0.00 m</span>
            </div>
            <div class="hud-item">
              <span class="hud-label">Heave (Z)</span>
              <span id="hudHeave" class="hud-val">0.00 m</span>
            </div>
            <div class="hud-item">
              <span class="hud-label">Roll (&phi;)</span>
              <span id="hudRoll" class="hud-val">0.00&deg;</span>
            </div>
            <div class="hud-item">
              <span class="hud-label">Pitch (&theta;)</span>
              <span id="hudPitch" class="hud-val">0.00&deg;</span>
            </div>
            <div class="hud-item">
              <span class="hud-label">Surge (X)</span>
              <span id="hudSurge" class="hud-val">0.00 m</span>
            </div>
            <div class="hud-item">
              <span class="hud-label">Sway (Y)</span>
              <span id="hudSway" class="hud-val">0.00 m</span>
            </div>
            <div class="hud-item">
              <span class="hud-label">Max Line Tension</span>
              <span id="hudMaxTension" class="hud-val">0 kN</span>
            </div>
            <div class="hud-item">
              <span class="hud-label">Dynamic SF</span>
              <span id="hudDynamicSf" class="hud-val">--</span>
            </div>
            <div class="hud-item" style="grid-column: span 2; display: flex; flex-direction: row; justify-content: space-between; align-items: center; border-top: 1px solid rgba(56, 189, 248, 0.15); padding-top: 4px; margin-top: 2px;">
              <span class="hud-label">Station Keeping</span>
              <span id="hudStation" class="hud-val" style="color: var(--success); font-size: 11px;">INTACT &amp; SECURE</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 4: Floater & Hydrodynamics -->
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

    <!-- TAB 5: DNV Compliance -->
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

    <!-- TAB 6: Polyglot Projections -->
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
    var gl = null;
    var glInitialized = false;
    var simRunning = true;
    var simSpeed = 1;
    var simTime = 0.0;
    var lastTime = 0.0;
    var canvas = null;
    var glProgram = null;
    var attribs = {};
    var uniforms = {};
    
    var simHs = 8.0;
    var simTp = 12.5;
    var simDir = 0.0;
    var simWaterDepth = 200.0;
    var simLines = [];
    var simVessel = null;

    var cam = {
      azim: 45 * Math.PI / 180,
      elev: 25 * Math.PI / 180,
      dist: 350,
      target: [0, 0, -20]
    };

    var isMouseDown = false;
    var mouseButton = 0;
    var lastMouseX = 0;
    var lastMouseY = 0;

    var oceanMesh = {
      vbo: null, nbo: null, cbo: null, ibo: null,
      indexCount: 0, nX: 32, nY: 32, width: 520, height: 520,
      posArray: null, normArray: null, colArray: null
    };

    var floaterBuffers = { vbo: null, nbo: null, cbo: null, ibo: null, indexCount: 0 };
    var seabedBuffers = { vbo: null, vertexCount: 0 };
    var mooringBuffers = { vbo: null, cbo: null };

    function showTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-pane').forEach(function(p) { p.classList.remove('active'); });
      if (window.event && window.event.target) window.event.target.classList.add('active');
      var pane = document.getElementById(tabId);
      if (pane) pane.classList.add('active');
      if (tabId === 'tab-3d') {
        onTab3dActivated();
      }
    }

    function onTab3dActivated() {
      if (!glInitialized) {
        initSima3D();
      } else {
        resizeCanvas();
      }
    }

    function updateWaveParam() {
      var elHs = document.getElementById('sliderHs');
      var elTp = document.getElementById('sliderTp');
      var elDir = document.getElementById('sliderDir');
      if (elHs) simHs = parseFloat(elHs.value) || 8.0;
      if (elTp) simTp = parseFloat(elTp.value) || 12.5;
      if (elDir) simDir = parseFloat(elDir.value) || 0.0;
      var vHs = document.getElementById('valHs');
      var vTp = document.getElementById('valTp');
      var vDir = document.getElementById('valDir');
      if (vHs) vHs.textContent = simHs.toFixed(1) + 'm';
      if (vTp) vTp.textContent = simTp.toFixed(1) + 's';
      if (vDir) vDir.textContent = simDir.toFixed(0) + '°';
    }

    function togglePlayPause() {
      simRunning = !simRunning;
      var btn = document.getElementById('btnPlayPause');
      if (btn) btn.textContent = simRunning ? '⏸ Pause' : '▶ Play';
    }

    function resetSimTime() {
      simTime = 0.0;
      var readout = document.getElementById('simTimeReadout');
      if (readout) readout.textContent = 'Time: 0.0 s';
    }

    function setSpeed(sp) {
      simSpeed = sp;
      document.querySelectorAll('.btn-speed').forEach(function(b) {
        b.classList.remove('active');
        if (b.textContent === sp + 'x') b.classList.add('active');
      });
    }

    function setCameraPreset(p) {
      if (p === 'orbit') {
        cam.azim = 45 * Math.PI / 180; cam.elev = 25 * Math.PI / 180; cam.dist = 350; cam.target = [0, 0, -20];
      } else if (p === 'top') {
        cam.azim = 0; cam.elev = 88 * Math.PI / 180; cam.dist = 450; cam.target = [0, 0, -20];
      } else if (p === 'side') {
        cam.azim = 90 * Math.PI / 180; cam.elev = 8 * Math.PI / 180; cam.dist = 280; cam.target = [0, 0, -10];
      } else if (p === 'bow') {
        cam.azim = 180 * Math.PI / 180; cam.elev = 15 * Math.PI / 180; cam.dist = 260; cam.target = [0, 0, -10];
      }
    }

    // 4x4 Matrix math routines
    function mat4Create() {
      return new Float32Array([1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1]);
    }

    function mat4Perspective(fovy, aspect, near, far) {
      var out = new Float32Array(16);
      var f = 1.0 / Math.tan(fovy / 2.0);
      out[0] = f / aspect;
      out[5] = f;
      out[10] = (far + near) / (near - far);
      out[11] = -1.0;
      out[14] = (2.0 * far * near) / (near - far);
      return out;
    }

    function mat4LookAt(eye, center, up) {
      var out = new Float32Array(16);
      var z0 = eye[0] - center[0];
      var z1 = eye[1] - center[1];
      var z2 = eye[2] - center[2];
      var len = 1.0 / Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2);
      z0 *= len; z1 *= len; z2 *= len;
      var x0 = up[1] * z2 - up[2] * z1;
      var x1 = up[2] * z0 - up[0] * z2;
      var x2 = up[0] * z1 - up[1] * z0;
      len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
      if (!len) { x0 = 0; x1 = 0; x2 = 0; } else { len = 1.0 / len; x0 *= len; x1 *= len; x2 *= len; }
      var y0 = z1 * x2 - z2 * x1;
      var y1 = z2 * x0 - z0 * x2;
      var y2 = z0 * x1 - z1 * x0;
      out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
      out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
      out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
      out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
      out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
      out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
      out[15] = 1;
      return out;
    }

    function mat4Translate(out, a, v) {
      var x = v[0], y = v[1], z = v[2];
      for (var i = 0; i < 12; i++) out[i] = a[i];
      out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
      out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
      out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
      out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
      return out;
    }

    function mat4RotateX(out, a, rad) {
      var s = Math.sin(rad), c = Math.cos(rad);
      var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      out[4] = a10 * c + a20 * s;
      out[5] = a11 * c + a21 * s;
      out[6] = a12 * c + a22 * s;
      out[7] = a13 * c + a23 * s;
      out[8] = a20 * c - a10 * s;
      out[9] = a21 * c - a11 * s;
      out[10] = a22 * c - a12 * s;
      out[11] = a23 * c - a13 * s;
      return out;
    }

    function mat4RotateY(out, a, rad) {
      var s = Math.sin(rad), c = Math.cos(rad);
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      out[0] = a00 * c - a20 * s;
      out[1] = a01 * c - a21 * s;
      out[2] = a02 * c - a22 * s;
      out[3] = a03 * c - a23 * s;
      out[8] = a00 * s + a20 * c;
      out[9] = a01 * s + a21 * c;
      out[10] = a02 * s + a22 * c;
      out[11] = a03 * s + a23 * c;
      return out;
    }

    function mat4RotateZ(out, a, rad) {
      var s = Math.sin(rad), c = Math.cos(rad);
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      out[0] = a00 * c + a10 * s;
      out[1] = a01 * c + a11 * s;
      out[2] = a02 * c + a12 * s;
      out[3] = a03 * c + a13 * s;
      out[4] = a10 * c - a00 * s;
      out[5] = a11 * c - a01 * s;
      out[6] = a12 * c - a02 * s;
      out[7] = a13 * c - a03 * s;
      return out;
    }

    // Geometry Generation Primitives
    function createPrism(cx, cy, zMin, zMax, radius, sides, r, g, b) {
      var positions = [];
      var normals = [];
      var colors = [];
      var indices = [];
      var angleStep = (Math.PI * 2) / sides;
      
      for (var i = 0; i < sides; i++) {
        var a1 = i * angleStep;
        var a2 = ((i + 1) % sides) * angleStep;
        var x1 = cx + Math.cos(a1) * radius;
        var y1 = cy + Math.sin(a1) * radius;
        var x2 = cx + Math.cos(a2) * radius;
        var y2 = cy + Math.sin(a2) * radius;
        var nx = Math.cos((a1 + a2) * 0.5);
        var ny = Math.sin((a1 + a2) * 0.5);
        
        var baseIdx = positions.length / 3;
        positions.push(x1, y1, zMin,  x2, y2, zMin,  x2, y2, zMax,  x1, y1, zMax);
        normals.push(nx, ny, 0,  nx, ny, 0,  nx, ny, 0,  nx, ny, 0);
        colors.push(r, g, b, 1,  r, g, b, 1,  r, g, b, 1,  r, g, b, 1);
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2,  baseIdx, baseIdx + 2, baseIdx + 3);
      }
      
      // Bottom Cap
      var botCenterIdx = positions.length / 3;
      positions.push(cx, cy, zMin);
      normals.push(0, 0, -1);
      colors.push(r * 0.8, g * 0.8, b * 0.8, 1);
      for (var i = 0; i < sides; i++) {
        var a = i * angleStep;
        positions.push(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, zMin);
        normals.push(0, 0, -1);
        colors.push(r * 0.8, g * 0.8, b * 0.8, 1);
      }
      for (var i = 0; i < sides; i++) {
        indices.push(botCenterIdx, botCenterIdx + 1 + ((i + 1) % sides), botCenterIdx + 1 + i);
      }
      
      // Top Cap
      var topCenterIdx = positions.length / 3;
      positions.push(cx, cy, zMax);
      normals.push(0, 0, 1);
      colors.push(r * 1.1, g * 1.1, b * 1.1, 1);
      for (var i = 0; i < sides; i++) {
        var a = i * angleStep;
        positions.push(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, zMax);
        normals.push(0, 0, 1);
        colors.push(r * 1.1, g * 1.1, b * 1.1, 1);
      }
      for (var i = 0; i < sides; i++) {
        indices.push(topCenterIdx, topCenterIdx + 1 + i, topCenterIdx + 1 + ((i + 1) % sides));
      }
      
      return { positions: positions, normals: normals, colors: colors, indices: indices };
    }

    function createBox(x1, y1, z1, x2, y2, z2, width, height, r, g, b) {
      var dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-4) return { positions: [], normals: [], colors: [], indices: [] };
      var dirX = dx / len, dirY = dy / len, dirZ = dz / len;
      var perpX = -dirY, perpY = dirX, perpZ = 0;
      var pLen = Math.sqrt(perpX * perpX + perpY * perpY);
      if (pLen > 1e-4) { perpX /= pLen; perpY /= pLen; } else { perpX = 1; perpY = 0; }
      var upX = dirY * perpZ - dirZ * perpY;
      var upY = dirZ * perpX - dirX * perpZ;
      var upZ = dirX * perpY - dirY * perpX;
      
      var hw = width * 0.5;
      var hh = height * 0.5;
      
      var corners = [
        [x1 - perpX * hw - upX * hh, y1 - perpY * hw - upY * hh, z1 - perpZ * hw - upZ * hh],
        [x1 + perpX * hw - upX * hh, y1 + perpY * hw - upY * hh, z1 + perpZ * hw - upZ * hh],
        [x1 + perpX * hw + upX * hh, y1 + perpY * hw + upY * hh, z1 + perpZ * hw + upZ * hh],
        [x1 - perpX * hw + upX * hh, y1 - perpY * hw + upY * hh, z1 - perpZ * hw + upZ * hh],
        [x2 - perpX * hw - upX * hh, y2 - perpY * hw - upY * hh, z2 - perpZ * hw - upZ * hh],
        [x2 + perpX * hw - upX * hh, y2 + perpY * hw - upY * hh, z2 + perpZ * hw - upZ * hh],
        [x2 + perpX * hw + upX * hh, y2 + perpY * hw + upY * hh, z2 + perpZ * hw + upZ * hh],
        [x2 - perpX * hw + upX * hh, y2 - perpY * hw + upY * hh, z2 - perpZ * hw - upZ * hh]
      ];
      
      var faces = [
        [0, 1, 2, 3, -dirX, -dirY, -dirZ],
        [5, 4, 7, 6, dirX, dirY, dirZ],
        [0, 4, 5, 1, -upX, -upY, -upZ],
        [2, 6, 7, 3, upX, upY, upZ],
        [1, 5, 6, 2, perpX, perpY, perpZ],
        [4, 0, 3, 7, -perpX, -perpY, -perpZ]
      ];
      
      var positions = [], normals = [], colors = [], indices = [];
      for (var f = 0; f < faces.length; f++) {
        var face = faces[f];
        var baseIdx = positions.length / 3;
        var nx = face[4], ny = face[5], nz = face[6];
        for (var v = 0; v < 4; v++) {
          var c = corners[face[v]];
          positions.push(c[0], c[1], c[2]);
          normals.push(nx, ny, nz);
          colors.push(r, g, b, 1);
        }
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
      }
      return { positions: positions, normals: normals, colors: colors, indices: indices };
    }

    function mergeGeometries(list) {
      var pos = [], norm = [], col = [], idx = [];
      for (var i = 0; i < list.length; i++) {
        var g = list[i];
        var base = pos.length / 3;
        for (var j = 0; j < g.positions.length; j++) pos.push(g.positions[j]);
        for (var j = 0; j < g.normals.length; j++) norm.push(g.normals[j]);
        for (var j = 0; j < g.colors.length; j++) col.push(g.colors[j]);
        for (var j = 0; j < g.indices.length; j++) idx.push(g.indices[j] + base);
      }
      return { positions: pos, normals: norm, colors: col, indices: idx };
    }

    function compileShader(targetGl, type, source) {
      var s = targetGl.createShader(type);
      targetGl.shaderSource(s, source);
      targetGl.compileShader(s);
      if (!targetGl.getShaderParameter(s, targetGl.COMPILE_STATUS)) {
        console.error('Shader compilation error: ' + targetGl.getShaderInfoLog(s));
        targetGl.deleteShader(s);
        return null;
      }
      return s;
    }

    function initSima3D() {
      canvas = document.getElementById('sima-3d-canvas');
      if (!canvas) return;
      try {
        gl = canvas.getContext('webgl', { antialias: true, alpha: false }) || canvas.getContext('experimental-webgl');
      } catch (e) {
        gl = null;
      }
      if (!gl) {
        var p = canvas.parentElement;
        if (p) {
          p.innerHTML = '<div style="color: #94a3b8; padding: 40px; text-align: center; font-size: 13px;">WebGL hardware acceleration is not active in this environment.</div>';
        }
        return;
      }
      glInitialized = true;
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      var vsSource = [
        'attribute vec3 aPosition;',
        'attribute vec3 aNormal;',
        'attribute vec4 aColor;',
        'uniform mat4 uProjection;',
        'uniform mat4 uView;',
        'uniform mat4 uModel;',
        'uniform vec3 uLightDir;',
        'uniform vec4 uBaseColor;',
        'uniform float uUseAttrColor;',
        'varying vec4 vColor;',
        'varying float vDepth;',
        'void main() {',
        '  vec4 worldPos = uModel * vec4(aPosition, 1.0);',
        '  gl_Position = uProjection * uView * worldPos;',
        '  vec3 worldNormal = normalize((uModel * vec4(aNormal, 0.0)).xyz);',
        '  float diff = max(dot(worldNormal, uLightDir), 0.0);',
        '  float ambient = 0.38;',
        '  float light = clamp(ambient + diff * 0.62, 0.0, 1.0);',
        '  vec4 col = mix(uBaseColor, aColor, uUseAttrColor);',
        '  vColor = vec4(col.rgb * light, col.a);',
        '  vDepth = gl_Position.z / gl_Position.w;',
        '}'
      ].join('\n');

      var fsSource = [
        'precision mediump float;',
        'varying vec4 vColor;',
        'varying float vDepth;',
        'void main() {',
        '  float fog = clamp((vDepth - 0.75) / 0.25, 0.0, 0.85);',
        '  vec3 fogColor = vec3(0.012, 0.027, 0.07);',
        '  gl_FragColor = vec4(mix(vColor.rgb, fogColor, fog), vColor.a);',
        '}'
      ].join('\n');

      var vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
      var fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
      if (!vs || !fs) return;

      glProgram = gl.createProgram();
      gl.attachShader(glProgram, vs);
      gl.attachShader(glProgram, fs);
      gl.linkProgram(glProgram);

      attribs = {
        position: gl.getAttribLocation(glProgram, 'aPosition'),
        normal: gl.getAttribLocation(glProgram, 'aNormal'),
        color: gl.getAttribLocation(glProgram, 'aColor')
      };
      uniforms = {
        projection: gl.getUniformLocation(glProgram, 'uProjection'),
        view: gl.getUniformLocation(glProgram, 'uView'),
        model: gl.getUniformLocation(glProgram, 'uModel'),
        lightDir: gl.getUniformLocation(glProgram, 'uLightDir'),
        baseColor: gl.getUniformLocation(glProgram, 'uBaseColor'),
        useAttrColor: gl.getUniformLocation(glProgram, 'uUseAttrColor')
      };

      initOceanBuffers();
      initFloaterBuffers();
      initSeabedBuffers();
      initMooringBuffers();

      setupMouseControls();
      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);

      lastTime = performance.now();
      requestAnimationFrame(simTick);
    }

    function setupMouseControls() {
      if (!canvas) return;
      canvas.addEventListener('mousedown', function(e) {
        isMouseDown = true;
        mouseButton = e.button;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
      });
      window.addEventListener('mouseup', function() { isMouseDown = false; });
      window.addEventListener('mousemove', function(e) {
        if (!isMouseDown) return;
        var dx = e.clientX - lastMouseX;
        var dy = e.clientY - lastMouseY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        if (mouseButton === 0 && !e.shiftKey) {
          cam.azim -= dx * 0.008;
          cam.elev += dy * 0.008;
          var minElev = 0.03;
          var maxElev = Math.PI * 0.49;
          if (cam.elev < minElev) cam.elev = minElev;
          if (cam.elev > maxElev) cam.elev = maxElev;
        } else {
          var sinA = Math.sin(cam.azim);
          var cosA = Math.cos(cam.azim);
          var panSpeed = cam.dist * 0.0015;
          cam.target[0] -= (dx * cosA + dy * sinA) * panSpeed;
          cam.target[1] -= (dx * sinA - dy * cosA) * panSpeed;
        }
      });
      canvas.addEventListener('wheel', function(e) {
        e.preventDefault();
        cam.dist += e.deltaY * 0.35;
        if (cam.dist < 50) cam.dist = 50;
        if (cam.dist > 1200) cam.dist = 1200;
      }, { passive: false });
    }

    function resizeCanvas() {
      if (!canvas || !gl) return;
      var rect = canvas.getBoundingClientRect();
      var width = rect.width || 800;
      var height = rect.height || 560;
      var dpr = window.devicePixelRatio || 1;
      var dw = Math.floor(width * dpr);
      var dh = Math.floor(height * dpr);
      if (canvas.width !== dw || canvas.height !== dh) {
        canvas.width = dw;
        canvas.height = dh;
        gl.viewport(0, 0, dw, dh);
      }
    }

    function initOceanBuffers() {
      var nX = oceanMesh.nX;
      var nY = oceanMesh.nY;
      var vertCount = (nX + 1) * (nY + 1);
      oceanMesh.posArray = new Float32Array(vertCount * 3);
      oceanMesh.normArray = new Float32Array(vertCount * 3);
      oceanMesh.colArray = new Float32Array(vertCount * 4);

      var indices = [];
      for (var j = 0; j < nY; j++) {
        for (var i = 0; i < nX; i++) {
          var row1 = j * (nX + 1);
          var row2 = (j + 1) * (nX + 1);
          indices.push(row1 + i, row2 + i, row1 + i + 1);
          indices.push(row1 + i + 1, row2 + i, row2 + i + 1);
        }
      }
      oceanMesh.indexCount = indices.length;

      oceanMesh.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, oceanMesh.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, oceanMesh.posArray, gl.DYNAMIC_DRAW);

      oceanMesh.nbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, oceanMesh.nbo);
      gl.bufferData(gl.ARRAY_BUFFER, oceanMesh.normArray, gl.DYNAMIC_DRAW);

      oceanMesh.cbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, oceanMesh.cbo);
      gl.bufferData(gl.ARRAY_BUFFER, oceanMesh.colArray, gl.DYNAMIC_DRAW);

      oceanMesh.ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, oceanMesh.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    }

    function initFloaterBuffers() {
      var parts = [];
      var numCols = (simVessel && simVessel.fairleads && simVessel.fairleads.length >= 3)
        ? simVessel.fairleads.length
        : 3;
      var draftM = (simVessel && simVessel.draft > 2) ? simVessel.draft : 20.0;
      var rOuter = (simVessel && simVessel.lengthBetweenPerpendiculars > 20)
        ? Math.min(70.0, Math.max(25.0, simVessel.lengthBetweenPerpendiculars * 0.45))
        : 40.0;
      var colRadius = Math.max(3.5, Math.min(9.0, rOuter * 0.15));
      var outerCols = [];

      for (var i = 0; i < numCols; i++) {
        var fl = (simVessel && simVessel.fairleads && simVessel.fairleads[i]) ? simVessel.fairleads[i] : null;
        var ang = (2 * Math.PI * i) / numCols;
        var cx = (fl && typeof fl.x === 'number' && (Math.abs(fl.x) > 5 || Math.abs(fl.y) > 5)) ? fl.x : rOuter * Math.cos(ang);
        var cy = (fl && typeof fl.y === 'number' && (Math.abs(fl.x) > 5 || Math.abs(fl.y) > 5)) ? fl.y : rOuter * Math.sin(ang);
        outerCols.push({ x: cx, y: cy });

        // Submerged column hull (dark marine blue/slate)
        parts.push(createPrism(cx, cy, -draftM, 0, colRadius, 12, 0.16, 0.22, 0.32));
        // Topside column (canary yellow)
        parts.push(createPrism(cx, cy, 0, 12, colRadius, 12, 0.96, 0.72, 0.12));
      }

      // Center Column
      parts.push(createPrism(0, 0, -draftM * 0.75, 0, colRadius * 0.85, 12, 0.16, 0.22, 0.32));
      parts.push(createPrism(0, 0, 0, 12, colRadius * 0.85, 12, 0.96, 0.72, 0.12));

      // Keel pontoons between outer columns
      for (var i = 0; i < numCols; i++) {
        var c1 = outerCols[i];
        var c2 = outerCols[(i + 1) % numCols];
        parts.push(createBox(c1.x, c1.y, -16, c2.x, c2.y, -16, 5.5, 4.5, 0.16, 0.22, 0.32));
        // Radial braces to center
        parts.push(createBox(0, 0, -16, c1.x, c1.y, -16, 4.0, 4.0, 0.16, 0.22, 0.32));
        // Upper deck trusses
        parts.push(createBox(c1.x, c1.y, 11, c2.x, c2.y, 11, 2.5, 2.5, 0.96, 0.72, 0.12));
      }

      // Wind Turbine Tower / Superstructure on center column
      parts.push(createPrism(0, 0, 12, 65, 2.4, 10, 0.92, 0.94, 0.97));
      // Nacelle
      parts.push(createBox(-4, 0, 66, 4, 0, 66, 3.2, 3.2, 0.88, 0.90, 0.94));
      // Rotor Blades
      parts.push(createBox(4, 0, 66, 4, 0, 104, 0.8, 1.6, 0.98, 0.98, 0.99));
      parts.push(createBox(4, 0, 66, 4, -33, 47, 0.8, 1.6, 0.98, 0.98, 0.99));
      parts.push(createBox(4, 0, 66, 4, 33, 47, 0.8, 1.6, 0.98, 0.98, 0.99));

      var merged = mergeGeometries(parts);
      floaterBuffers.indexCount = merged.indices.length;

      floaterBuffers.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, floaterBuffers.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(merged.positions), gl.STATIC_DRAW);

      floaterBuffers.nbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, floaterBuffers.nbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(merged.normals), gl.STATIC_DRAW);

      floaterBuffers.cbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, floaterBuffers.cbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(merged.colors), gl.STATIC_DRAW);

      floaterBuffers.ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, floaterBuffers.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(merged.indices), gl.STATIC_DRAW);
    }

    function initSeabedBuffers() {
      var lines = [];
      var span = 320;
      var step = 40;
      var z = -simWaterDepth;

      for (var x = -span; x <= span; x += step) {
        lines.push(x, -span, z,  x, span, z);
      }
      for (var y = -span; y <= span; y += step) {
        lines.push(-span, y, z,  span, y, z);
      }
      seabedBuffers.vertexCount = lines.length / 3;

      if (!seabedBuffers.vbo) seabedBuffers.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, seabedBuffers.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STATIC_DRAW);
    }

    function initMooringBuffers() {
      mooringBuffers.vbo = gl.createBuffer();
      mooringBuffers.cbo = gl.createBuffer();
    }

    function simTick(timestamp) {
      requestAnimationFrame(simTick);
      if (!glInitialized || !gl) return;
      var pane3d = document.getElementById('tab-3d');
      if (!pane3d || !pane3d.classList.contains('active')) return;

      var dt = (timestamp - lastTime) * 0.001;
      lastTime = timestamp;
      if (dt > 0.1) dt = 0.1;
      if (simRunning) {
        simTime += dt * simSpeed;
        var readout = document.getElementById('simTimeReadout');
        if (readout) readout.textContent = 'Time: ' + simTime.toFixed(1) + ' s';
      }

      renderScene(simTime);
    }

    function renderScene(t) {
      gl.clearColor(0.012, 0.027, 0.07, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(glProgram);

      var aspect = canvas.width / canvas.height;
      var pMatrix = mat4Perspective(45 * Math.PI / 180, aspect, 1.0, 3000.0);
      var eyeX = cam.target[0] + cam.dist * Math.cos(cam.elev) * Math.sin(cam.azim);
      var eyeY = cam.target[1] - cam.dist * Math.cos(cam.elev) * Math.cos(cam.azim);
      var eyeZ = cam.target[2] + cam.dist * Math.sin(cam.elev);
      var vMatrix = mat4LookAt([eyeX, eyeY, eyeZ], cam.target, [0, 0, 1]);

      gl.uniformMatrix4fv(uniforms.projection, false, pMatrix);
      gl.uniformMatrix4fv(uniforms.view, false, vMatrix);

      var lx = 0.5, ly = -0.6, lz = 0.65;
      var llen = Math.sqrt(lx * lx + ly * ly + lz * lz);
      gl.uniform3f(uniforms.lightDir, lx / llen, ly / llen, lz / llen);

      drawSeabed();

      var wp = (2.0 * Math.PI) / simTp;
      var dirRad = (simDir * Math.PI) / 180.0;
      var freqs = [0.75 * wp, 0.9 * wp, 1.0 * wp, 1.15 * wp, 1.3 * wp];
      var amps = [0.15 * (simHs * 0.5), 0.3 * (simHs * 0.5), 0.45 * (simHs * 0.5), 0.25 * (simHs * 0.5), 0.1 * (simHs * 0.5)];
      var phases = [0.12, 1.45, 2.84, 4.15, 5.32];
      var dirOffsets = [-0.18, -0.06, 0.0, 0.06, 0.18];

      var eta0 = 0.0;
      var slopeX = 0.0;
      var slopeY = 0.0;
      for (var k = 0; k < 5; k++) {
        var wk = freqs[k];
        var kn = (wk * wk) / 9.81;
        var betaK = dirRad + dirOffsets[k];
        var kx = kn * Math.cos(betaK);
        var ky = kn * Math.sin(betaK);
        var arg = -wk * t + phases[k];
        eta0 += amps[k] * Math.cos(arg);
        slopeX += -amps[k] * kx * Math.sin(arg);
        slopeY += -amps[k] * ky * Math.sin(arg);
      }

      var raoHeave = 0.72 / Math.sqrt(1.0 + Math.pow((simTp - 17.5) / 5.0, 2));
      var heave = raoHeave * eta0;
      var pitch = (slopeX * 180.0 / Math.PI) * 0.8 * Math.cos(dirRad) + 0.12 * Math.sin(wp * t);
      var roll = (slopeY * 180.0 / Math.PI) * 0.8 * Math.sin(dirRad) + 0.12 * Math.cos(wp * t);
      var surge = 0.3 * simHs * Math.cos(dirRad) * Math.sin(wp * t - 0.7);
      var sway = 0.3 * simHs * Math.sin(dirRad) * Math.sin(wp * t - 0.7);
      var yaw = 0.05 * roll * Math.sin(2.0 * dirRad);

      updateAndDrawOcean(t, freqs, amps, phases, dirRad, dirOffsets);

      var mFloater = mat4Create();
      mat4Translate(mFloater, mFloater, [surge, sway, heave]);
      mat4RotateZ(mFloater, mFloater, yaw * Math.PI / 180.0);
      mat4RotateY(mFloater, mFloater, pitch * Math.PI / 180.0);
      mat4RotateX(mFloater, mFloater, roll * Math.PI / 180.0);

      drawFloater(mFloater);

      var maxTension = updateAndDrawMooringLines(mFloater, simWaterDepth);

      updateHudTelemetry(eta0, heave, roll, pitch, surge, sway, maxTension);
    }

    function drawSeabed() {
      var mIdentity = mat4Create();
      gl.uniformMatrix4fv(uniforms.model, false, mIdentity);
      gl.uniform1f(uniforms.useAttrColor, 0.0);
      gl.uniform4f(uniforms.baseColor, 0.08, 0.15, 0.25, 0.6);

      gl.bindBuffer(gl.ARRAY_BUFFER, seabedBuffers.vbo);
      gl.enableVertexAttribArray(attribs.position);
      gl.vertexAttribPointer(attribs.position, 3, gl.FLOAT, false, 0, 0);

      gl.disableVertexAttribArray(attribs.normal);
      gl.vertexAttrib3f(attribs.normal, 0, 0, 1);

      gl.drawArrays(gl.LINES, 0, seabedBuffers.vertexCount);
    }

    function updateAndDrawOcean(t, freqs, amps, phases, dirRad, dirOffsets) {
      var nX = oceanMesh.nX;
      var nY = oceanMesh.nY;
      var w = oceanMesh.width;
      var h = oceanMesh.height;
      var dx = w / nX;
      var dy = h / nY;

      var positions = oceanMesh.posArray;
      var normals = oceanMesh.normArray;
      var colors = oceanMesh.colArray;

      var ptr = 0;
      var nptr = 0;
      var cptr = 0;

      for (var j = 0; j <= nY; j++) {
        var y = -h * 0.5 + j * dy;
        for (var i = 0; i <= nX; i++) {
          var x = -w * 0.5 + i * dx;
          
          var eta = 0.0;
          var sx = 0.0;
          var sy = 0.0;
          for (var k = 0; k < 5; k++) {
            var wk = freqs[k];
            var kn = (wk * wk) / 9.81;
            var betaK = dirRad + dirOffsets[k];
            var kx = kn * Math.cos(betaK);
            var ky = kn * Math.sin(betaK);
            var arg = kx * x + ky * y - wk * t + phases[k];
            eta += amps[k] * Math.cos(arg);
            sx += -amps[k] * kx * Math.sin(arg);
            sy += -amps[k] * ky * Math.sin(arg);
          }

          positions[ptr] = x;
          positions[ptr + 1] = y;
          positions[ptr + 2] = eta;
          ptr += 3;

          var nx = -sx, ny = -sy, nz = 1.0;
          var invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
          normals[nptr] = nx * invLen;
          normals[nptr + 1] = ny * invLen;
          normals[nptr + 2] = nz * invLen;
          nptr += 3;

          var crestFrac = (eta + simHs * 0.5) / Math.max(simHs, 1.0);
          if (crestFrac < 0.0) crestFrac = 0.0;
          if (crestFrac > 1.0) crestFrac = 1.0;
          
          colors[cptr] = 0.05 + 0.17 * crestFrac;
          colors[cptr + 1] = 0.15 + 0.59 * crestFrac;
          colors[cptr + 2] = 0.32 + 0.65 * crestFrac;
          colors[cptr + 3] = 0.92;
          cptr += 4;
        }
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, oceanMesh.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
      gl.enableVertexAttribArray(attribs.position);
      gl.vertexAttribPointer(attribs.position, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, oceanMesh.nbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, normals);
      gl.enableVertexAttribArray(attribs.normal);
      gl.vertexAttribPointer(attribs.normal, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, oceanMesh.cbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors);
      gl.enableVertexAttribArray(attribs.color);
      gl.vertexAttribPointer(attribs.color, 4, gl.FLOAT, false, 0, 0);

      var mIdentity = mat4Create();
      gl.uniformMatrix4fv(uniforms.model, false, mIdentity);
      gl.uniform1f(uniforms.useAttrColor, 1.0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, oceanMesh.ibo);
      gl.drawElements(gl.TRIANGLES, oceanMesh.indexCount, gl.UNSIGNED_SHORT, 0);

      gl.disableVertexAttribArray(attribs.color);
    }

    function drawFloater(mFloater) {
      gl.uniformMatrix4fv(uniforms.model, false, mFloater);
      gl.uniform1f(uniforms.useAttrColor, 1.0);

      gl.bindBuffer(gl.ARRAY_BUFFER, floaterBuffers.vbo);
      gl.enableVertexAttribArray(attribs.position);
      gl.vertexAttribPointer(attribs.position, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, floaterBuffers.nbo);
      gl.enableVertexAttribArray(attribs.normal);
      gl.vertexAttribPointer(attribs.normal, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, floaterBuffers.cbo);
      gl.enableVertexAttribArray(attribs.color);
      gl.vertexAttribPointer(attribs.color, 4, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, floaterBuffers.ibo);
      gl.drawElements(gl.TRIANGLES, floaterBuffers.indexCount, gl.UNSIGNED_SHORT, 0);

      gl.disableVertexAttribArray(attribs.color);
    }

    function updateAndDrawMooringLines(mFloater, depth) {
      var numLines = (simLines && simLines.length > 0) ? simLines.length : 3;
      var rFairlead = (simVessel && simVessel.lengthBetweenPerpendiculars > 20)
        ? Math.min(70.0, Math.max(25.0, simVessel.lengthBetweenPerpendiculars * 0.45))
        : 40.0;
      var zFairlead = (simVessel && simVessel.draft > 2) ? -simVessel.draft * 0.7 : -14.0;
      var rAnchorDefault = Math.max(180.0, depth * 2.2);
      var maxTen = 0.0;

      var lineVerts = [];
      var lineCols = [];

      for (var i = 0; i < numLines; i++) {
        var lineObj = (simLines && simLines[i]) ? simLines[i] : null;
        var fl = (simVessel && simVessel.fairleads && simVessel.fairleads[i]) ? simVessel.fairleads[i] : null;
        var ang = (lineObj && typeof lineObj.azimuthDeg === 'number')
          ? (lineObj.azimuthDeg * Math.PI) / 180.0
          : (2.0 * Math.PI * i) / numLines;
        var fbx = (fl && typeof fl.x === 'number' && (Math.abs(fl.x) > 5 || Math.abs(fl.y) > 5)) ? fl.x : rFairlead * Math.cos(ang);
        var fby = (fl && typeof fl.y === 'number' && (Math.abs(fl.x) > 5 || Math.abs(fl.y) > 5)) ? fl.y : rFairlead * Math.sin(ang);
        var fbz = (fl && typeof fl.z === 'number') ? fl.z : zFairlead;

        var fwx = mFloater[0] * fbx + mFloater[4] * fby + mFloater[8] * fbz + mFloater[12];
        var fwy = mFloater[1] * fbx + mFloater[5] * fby + mFloater[9] * fbz + mFloater[13];
        var fwz = mFloater[2] * fbx + mFloater[6] * fby + mFloater[10] * fbz + mFloater[14];

        var rAnchor = (lineObj && lineObj.anchorRadius > 50) ? lineObj.anchorRadius : rAnchorDefault;
        var ax = (lineObj && lineObj.anchorPosition && typeof lineObj.anchorPosition.x === 'number')
          ? lineObj.anchorPosition.x
          : rAnchor * Math.cos(ang);
        var ay = (lineObj && lineObj.anchorPosition && typeof lineObj.anchorPosition.y === 'number')
          ? lineObj.anchorPosition.y
          : rAnchor * Math.sin(ang);
        var az = -depth;

        var horizDist = Math.sqrt((fwx - ax) * (fwx - ax) + (fwy - ay) * (fwy - ay));
        var nomSpan = Math.max(40.0, Math.sqrt(ax * ax + ay * ay) - Math.sqrt(fbx * fbx + fby * fby));
        var deltaExcursion = horizDist - nomSpan;
        var basePretension = (lineObj && lineObj.pretensionKn > 0) ? lineObj.pretensionKn : 1250.0;
        var tension = Math.max(50.0, basePretension + deltaExcursion * 38.5);
        if (tension > maxTen) maxTen = tension;

        var mblLimit = (lineObj && lineObj.mblKn > 0) ? lineObj.mblKn * 0.6 : 2400.0;
        var cr = 0.13, cg = 0.77, cb = 0.37;
        if (tension >= mblLimit) {
          cr = 0.94; cg = 0.27; cb = 0.27;
        } else if (tension >= mblLimit * 0.75) {
          cr = 0.96; cg = 0.62; cb = 0.04;
        }

        var segs = 24;
        var sag = Math.max(3.0, (depth * 0.38) * (1.0 - Math.min(deltaExcursion / 40.0, 0.7)));
        for (var s = 0; s < segs; s++) {
          var s0 = s / segs;
          var s1 = (s + 1) / segs;
          
          var p0x = ax + (fwx - ax) * s0;
          var p0y = ay + (fwy - ay) * s0;
          var p0z = az + (fwz - az) * s0 - sag * 4.0 * s0 * (1.0 - s0);

          var p1x = ax + (fwx - ax) * s1;
          var p1y = ay + (fwy - ay) * s1;
          var p1z = az + (fwz - az) * s1 - sag * 4.0 * s1 * (1.0 - s1);

          lineVerts.push(p0x, p0y, p0z, p1x, p1y, p1z);
          lineCols.push(cr, cg, cb, 1.0, cr, cg, cb, 1.0);
        }
      }

      var mIdentity = mat4Create();
      gl.uniformMatrix4fv(uniforms.model, false, mIdentity);
      gl.uniform1f(uniforms.useAttrColor, 1.0);

      gl.bindBuffer(gl.ARRAY_BUFFER, mooringBuffers.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineVerts), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(attribs.position);
      gl.vertexAttribPointer(attribs.position, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, mooringBuffers.cbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineCols), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(attribs.color);
      gl.vertexAttribPointer(attribs.color, 4, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.LINES, 0, lineVerts.length / 3);

      gl.disableVertexAttribArray(attribs.color);
      return maxTen;
    }

    function updateHudTelemetry(eta0, heave, roll, pitch, surge, sway, maxTension) {
      var elEta = document.getElementById('hudEta');
      if (elEta) elEta.textContent = (eta0 >= 0 ? '+' : '') + eta0.toFixed(2) + ' m';
      var elHeave = document.getElementById('hudHeave');
      if (elHeave) elHeave.textContent = (heave >= 0 ? '+' : '') + heave.toFixed(2) + ' m';
      var elRoll = document.getElementById('hudRoll');
      if (elRoll) elRoll.textContent = roll.toFixed(2) + '°';
      var elPitch = document.getElementById('hudPitch');
      if (elPitch) elPitch.textContent = pitch.toFixed(2) + '°';
      var elSurge = document.getElementById('hudSurge');
      if (elSurge) elSurge.textContent = (surge >= 0 ? '+' : '') + surge.toFixed(2) + ' m';
      var elSway = document.getElementById('hudSway');
      if (elSway) elSway.textContent = (sway >= 0 ? '+' : '') + sway.toFixed(2) + ' m';
      var elTension = document.getElementById('hudMaxTension');
      if (elTension) elTension.textContent = maxTension.toFixed(0) + ' kN';
      
      var dynamicSf = maxTension > 0 ? (18000.0 / maxTension) : 10.0;
      var elSf = document.getElementById('hudDynamicSf');
      if (elSf) elSf.textContent = dynamicSf.toFixed(2);
      
      var elStation = document.getElementById('hudStation');
      if (elStation) {
        if (dynamicSf >= 1.67) {
          elStation.style.color = 'var(--success)';
          elStation.textContent = 'INTACT & SECURE';
        } else {
          elStation.style.color = 'var(--danger)';
          elStation.textContent = 'DNV WARNING: HIGH TENSION';
        }
      }
    }

    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (msg.type === 'error') {
        var b = document.getElementById('diagBanner');
        if (b) {
          b.style.display = 'block';
          b.textContent = msg.message;
        }
        return;
      }
      if (msg.type === 'update') {
        var titleEl = document.getElementById('modelTitle');
        if (titleEl) titleEl.textContent = msg.title;
        var metaEl = document.getElementById('headerMeta');
        if (metaEl) {
          metaEl.textContent = 'Water Depth: ' + msg.waterDepth + 'm | ' + msg.lineCount + ' lines | Floater: ' + (msg.vessel ? msg.vessel.name : 'Vessel');
        }

        // Update cards
        var cd = document.getElementById('cardDepth');
        if (cd) cd.textContent = msg.waterDepth.toFixed(1) + ' m';
        var cl = document.getElementById('cardLines');
        if (cl) cl.textContent = msg.lineCount;

        if (msg.dnvReport && msg.dnvReport.summary) {
          var sum = msg.dnvReport.summary;
          var cmsf = document.getElementById('cardMinSf');
          if (cmsf) cmsf.textContent = sum.minSafetyFactor.toFixed(2);
          var badge = document.getElementById('dnvStatusBadge');
          if (badge) {
            if (sum.allPassed) {
              badge.className = 'badge success';
              badge.textContent = 'DNV COMPLIANT';
            } else {
              badge.className = 'badge danger';
              badge.textContent = 'DNV NON-COMPLIANT';
            }
          }
        }

        // Update SVGs
        if (msg.catenarySvg) {
          var catContainer = document.getElementById('catenarySvgContainer');
          if (catContainer) catContainer.innerHTML = msg.catenarySvg;
        }
        if (msg.spreadSvg) {
          var sprContainer = document.getElementById('spreadSvgContainer');
          if (sprContainer) sprContainer.innerHTML = msg.spreadSvg;
        }

        // Lines table
        var tbodyLines = document.querySelector('#linesTable tbody');
        if (tbodyLines && msg.lines) {
          tbodyLines.innerHTML = msg.lines.map(function(l) {
            var seg = l.segments[0] || {};
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
        var tbodyDnv = document.querySelector('#dnvTable tbody');
        if (tbodyDnv && msg.dnvReport && msg.dnvReport.lines) {
          tbodyDnv.innerHTML = msg.dnvReport.lines.map(function(l) {
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
        var tbodyVessel = document.querySelector('#vesselTable tbody');
        if (tbodyVessel && msg.vessel) {
          var v = msg.vessel;
          tbodyVessel.innerHTML = 
            '<tr><th>Vessel ID / Name</th><td>' + v.id + ' (' + v.name + ')</td></tr>' +
            '<tr><th>Structural Mass</th><td>' + (v.mass / 1000).toFixed(1) + ' tonnes</td></tr>' +
            '<tr><th>Displacement Volume</th><td>' + v.displacement.toFixed(1) + ' m³</td></tr>' +
            '<tr><th>Transverse GM (GMt)</th><td><b>' + v.gmTransverse.toFixed(2) + ' m</b></td></tr>' +
            '<tr><th>Longitudinal GM (GMl)</th><td><b>' + v.gmLongitudinal.toFixed(2) + ' m</b></td></tr>' +
            '<tr><th>Fairlead Attachments</th><td>' + (v.fairleads ? v.fairleads.length : 0) + ' points</td></tr>';
        }

        // Environment table
        var tbodyEnv = document.querySelector('#envTable tbody');
        if (tbodyEnv && msg.environment) {
          var e = msg.environment;
          tbodyEnv.innerHTML = 
            '<tr><th>Wave Spectrum</th><td>' + e.wave.spectrum.toUpperCase() + ' (Hs=' + e.wave.hs + 'm, Tp=' + e.wave.tp + 's, Dir=' + e.wave.direction + '°)</td></tr>' +
            '<tr><th>Mean Wind</th><td>' + e.wind.speed + ' m/s @ ' + e.wind.direction + '°</td></tr>' +
            '<tr><th>Surface Current</th><td>' + e.current.surfaceSpeed + ' m/s @ ' + e.current.direction + '°</td></tr>' +
            '<tr><th>Water Density</th><td>' + e.waterDensity + ' kg/m³</td></tr>' +
            '<tr><th>Seabed Friction</th><td>μ = ' + e.seabedFriction + '</td></tr>';

          if (e.wave) {
            simHs = e.wave.hs || 8.0;
            simTp = e.wave.tp || 12.5;
            simDir = e.wave.direction || 0.0;
            var sHs = document.getElementById('sliderHs');
            if (sHs) sHs.value = simHs;
            var sTp = document.getElementById('sliderTp');
            if (sTp) sTp.value = simTp;
            var sDir = document.getElementById('sliderDir');
            if (sDir) sDir.value = simDir;
            updateWaveParam();
          }
        }

        if (msg.waterDepth) {
          simWaterDepth = msg.waterDepth;
          if (glInitialized) initSeabedBuffers();
        }
        if (msg.lines) simLines = msg.lines;
        if (msg.vessel) {
          simVessel = msg.vessel;
          if (glInitialized) initFloaterBuffers();
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
