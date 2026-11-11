// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide-client — Computational Neuroscience & Electrophysiology Visualizer Panel.
 *
 * Provides interactive membrane circuit visualization and live action potential
 * oscilloscope simulation for NEURON NMODL (.mod) mechanisms:
 * 1. Lipid bilayer membrane equivalent circuit (Cm, Nav, Kv, Leak conductances).
 * 2. Real-time Hodgkin-Huxley action potential oscilloscope (Vm(t)).
 * 3. Dynamic current-clamp electrode slider (I_inj: 0–50 nA).
 * 4. Phase-plane limit cycle trajectory (Vm vs m gating variable).
 */

import {
  buildDefaultNeuronMorphology,
  renderMorphologicalCableSvg,
  renderPhasePlaneSvg,
} from "@modelscript/diagram/nmodl";
import { parseNmodl, solveNmodlActionPotential, type NmodlDocument, type NmodlSimResult } from "@modelscript/nmodl";
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

export class ElectrophysiologyPanel extends BaseWebviewPanel {
  public static currentPanel: ElectrophysiologyPanel | undefined;
  public static readonly viewType = "modelscript.electrophysiologyViewer";

  private readonly _client?: LanguageClient | undefined;
  public targetUri: string | undefined;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, targetUri?: string): void {
    const activeEditorDoc = vscode.window.activeTextEditor?.document;
    const resolvedUri =
      targetUri ??
      (activeEditorDoc && activeEditorDoc.uri.scheme !== "output" ? activeEditorDoc.uri.toString() : undefined);

    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (ElectrophysiologyPanel.currentPanel) {
      if (resolvedUri) {
        ElectrophysiologyPanel.currentPanel.targetUri = resolvedUri;
      }
      ElectrophysiologyPanel.currentPanel._panel.reveal(column);
      void ElectrophysiologyPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      ElectrophysiologyPanel.viewType,
      "Electrophysiology & Membrane Circuit Visualizer",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    ElectrophysiologyPanel.currentPanel = new ElectrophysiologyPanel(panel, extensionUri, client, resolvedUri);
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
      async (msg: { command: string; injAmp?: number }) => {
        if (msg.command === "reSimulate" && typeof msg.injAmp === "number") {
          await this.updateWithAmp(msg.injAmp);
        }
      },
      null,
      this._disposables,
    );

    void this.update();
  }

  public async update(): Promise<void> {
    await this.updateWithAmp(10.0);
  }

  public async updateWithAmp(injAmp: number): Promise<void> {
    let sourceText = "";
    if (this.targetUri) {
      try {
        const fileUri = vscode.Uri.parse(this.targetUri);
        const bytes = await vscode.workspace.fs.readFile(fileUri);
        sourceText = new TextDecoder().decode(bytes);
      } catch {
        sourceText = SAMPLE_NMODL_HH;
      }
    } else {
      sourceText = SAMPLE_NMODL_HH;
    }

    let doc: NmodlDocument;
    try {
      doc = parseNmodl(sourceText);
    } catch {
      doc = parseNmodl(SAMPLE_NMODL_HH);
    }

    const sim = solveNmodlActionPotential(doc, {
      tEnd: 25.0,
      dt: 0.05,
      stimAmp: injAmp,
      vInit: -65.0,
    });

    this._panel.webview.html = this.renderHtml(doc, sim, injAmp);
  }

  private renderHtml(doc: NmodlDocument, sim: NmodlSimResult, injAmp: number): string {
    return renderElectrophysiologyHtml(doc, sim, injAmp);
  }
}

export function renderElectrophysiologyHtml(doc: NmodlDocument, sim: NmodlSimResult, injAmp: number): string {
  const mechanismName = doc.model.suffix || "HodgkinHuxley";
  const title = doc.model.title || `${mechanismName} Electrophysiology`;
  const peakVm = sim.vPeak;
  const firingRate = sim.firingRateHz;

  const cable = buildDefaultNeuronMorphology(mechanismName, { injAmp, somaVm: peakVm });
  const cableSvg = renderMorphologicalCableSvg(cable, { theme: "dark" });
  const phaseSvg = renderPhasePlaneSvg({ times: sim.time, vm: sim.v, m: sim.states["m"] }, { theme: "dark" });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeXml(title)}</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --border: #1f2937;
      --text: #f9fafb;
      --muted: #9ca3af;
      --accent: #38bdf8;
      --na: #f59e0b;
      --k: #8b5cf6;
      --leak: #10b981;
    }
    body {
      margin: 0;
      padding: 14px;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      height: 100vh;
      box-sizing: border-box;
      gap: 10px;
      overflow: hidden;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
      flex-shrink: 0;
    }
    h1 {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      color: var(--accent);
    }
    .metrics {
      display: flex;
      gap: 12px;
      font-size: 11.5px;
    }
    .metric-badge {
      background: var(--card-bg);
      border: 1px solid var(--border);
      padding: 3px 8px;
      border-radius: 6px;
      font-weight: 600;
    }
    .tab-bar {
      display: flex;
      gap: 6px;
    }
    .tab-btn {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--muted);
      padding: 4px 10px;
      border-radius: 5px;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .tab-btn:hover { color: var(--text); border-color: #374151; }
    .tab-btn.active { background: #0284c7; color: #fff; border-color: #38bdf8; }
    .controls-bar {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 8px 12px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 11.5px;
      flex-shrink: 0;
    }
    .control-group {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }
    input[type=range] {
      flex: 1;
      accent-color: var(--accent);
      cursor: pointer;
    }
    .btn {
      background: #1f2937;
      border: 1px solid #374151;
      color: var(--text);
      padding: 4px 10px;
      border-radius: 5px;
      font-size: 11px;
      cursor: pointer;
      font-weight: 600;
    }
    .btn:hover { background: #374151; }
    .btn.active { background: #0284c7; color: #fff; }
    .view-content {
      flex: 1;
      min-height: 0;
      position: relative;
    }
    .view-panel {
      position: absolute;
      inset: 0;
      display: none;
    }
    .view-panel.active {
      display: flex;
    }
    .main-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr 1fr;
      gap: 10px;
      width: 100%;
      height: 100%;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .card-title {
      padding: 6px 10px;
      font-size: 11.5px;
      font-weight: 700;
      border-bottom: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.02);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    canvas {
      flex: 1;
      width: 100%;
      height: 100%;
    }
    .svg-container {
      flex: 1;
      width: 100%;
      height: 100%;
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #090d16;
    }
    .svg-container svg {
      max-width: 100%;
      max-height: 100%;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeXml(title)}</h1>
      <div style="font-size: 11px; color: var(--muted); margin-top: 2px;">NEURON Mechanism: <code>${escapeXml(mechanismName)}</code></div>
    </div>
    <div class="tab-bar">
      <button class="tab-btn active" id="tab-grid" onclick="switchView('grid')">All-in-One Grid</button>
      <button class="tab-btn" id="tab-cable" onclick="switchView('cable')">Morphological Cable</button>
      <button class="tab-btn" id="tab-oscilloscope" onclick="switchView('oscilloscope')">Oscilloscope</button>
      <button class="tab-btn" id="tab-phase" onclick="switchView('phase')">Phase Portrait</button>
    </div>
    <div class="metrics">
      <div class="metric-badge">Peak Vm: <span style="color: var(--accent);">${peakVm.toFixed(1)} mV</span></div>
      <div class="metric-badge">Rate: <span style="color: #10b981;">${firingRate.toFixed(1)} Hz</span></div>
      <div class="metric-badge">Channels: <span style="color: #f59e0b;">${doc.model.parameters.length}</span></div>
    </div>
  </header>

  <div class="controls-bar">
    <div class="control-group">
      <label><b>Current Clamp (I_inj):</b> <span id="amp-val">${injAmp.toFixed(1)}</span> nA</label>
      <input type="range" id="amp-slider" min="0" max="50" step="0.5" value="${injAmp}">
    </div>
    <div class="control-group">
      <button class="btn" id="btn-play">▶ Play</button>
      <label><b>Time Scrub:</b> <span id="time-val">0.0</span> ms</label>
      <input type="range" id="time-slider" min="0" max="${sim.time[sim.time.length - 1] ?? 25}" step="0.05" value="0">
    </div>
    <div style="display: flex; gap: 4px;">
      <button class="btn active" id="btn-mode-m">Vm vs m</button>
      <button class="btn" id="btn-mode-dvdt">Vm vs dVm/dt</button>
    </div>
  </div>

  <div class="view-content">
    <!-- View 1: All-In-One Grid -->
    <div class="view-panel active" id="panel-grid">
      <div class="main-grid">
        <div class="card">
          <div class="card-title">Membrane Lipid Bilayer Equivalent Circuit</div>
          <canvas id="circuit-canvas"></canvas>
        </div>
        <div class="card">
          <div class="card-title">Action Potential Oscilloscope: Vm(t)</div>
          <canvas id="vm-canvas"></canvas>
        </div>
        <div class="card">
          <div class="card-title">Gating Variables Dynamics: m(t), h(t), n(t)</div>
          <canvas id="gating-canvas"></canvas>
        </div>
        <div class="card">
          <div class="card-title">
            <span id="phase-title">Phase Plane: Vm vs m Activation</span>
          </div>
          <canvas id="phase-canvas"></canvas>
        </div>
      </div>
    </div>

    <!-- View 2: Dedicated Morphological Cable Visualizer -->
    <div class="view-panel" id="panel-cable">
      <div class="card" style="width: 100%; height: 100%;">
        <div class="card-title">
          <span>Multi-Compartment Cable Neuron Arborization (Soma, AIS, Axon, Dendrites)</span>
          <span style="font-size: 10.5px; color: var(--muted);">Live Channel Badges (Nav, Kv, Cav, Leak)</span>
        </div>
        <div class="svg-container" id="cable-svg-container">
          ${cableSvg}
        </div>
      </div>
    </div>

    <!-- View 3: Dedicated Full-Screen Oscilloscope Dual-Trace -->
    <div class="view-panel" id="panel-oscilloscope">
      <div class="card" style="width: 100%; height: 100%;">
        <div class="card-title">Dual-Trace Action Potential Oscilloscope with Live Time Scrubbing</div>
        <canvas id="vm-full-canvas"></canvas>
      </div>
    </div>

    <!-- View 4: Dedicated Publication Phase Portrait -->
    <div class="view-panel" id="panel-phase">
      <div class="card" style="width: 100%; height: 100%;">
        <div class="card-title">
          <span>Limit Cycle Phase Portrait with Flow Direction &amp; Fixed Points</span>
          <span style="font-size: 10.5px; color: var(--muted);">Publication Vector SVG</span>
        </div>
        <div class="svg-container" id="phase-svg-container">
          ${phaseSvg}
        </div>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const simTimes = ${JSON.stringify(sim.time)};
    const simVm = ${JSON.stringify(sim.v)};
    const simM = ${JSON.stringify(sim.states["m"] ?? [])};
    const simH = ${JSON.stringify(sim.states["h"] ?? [])};
    const simN = ${JSON.stringify(sim.states["n"] ?? [])};

    let currentTime = 0.0;
    let isPlaying = false;
    let animHandle = null;
    let phaseMode = "m"; // "m" or "dvdt"
    let currentView = "grid";

    // Tab Switcher
    function switchView(view) {
      currentView = view;
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".view-panel").forEach(p => p.classList.remove("active"));
      document.getElementById("tab-" + view).classList.add("active");
      document.getElementById("panel-" + view).classList.add("active");
      renderAll();
    }
    window.switchView = switchView;

    // Phase Mode Switcher
    document.getElementById("btn-mode-m").addEventListener("click", () => {
      phaseMode = "m";
      document.getElementById("btn-mode-m").classList.add("active");
      document.getElementById("btn-mode-dvdt").classList.remove("active");
      document.getElementById("phase-title").textContent = "Phase Plane: Vm vs m Activation";
      renderAll();
    });
    document.getElementById("btn-mode-dvdt").addEventListener("click", () => {
      phaseMode = "dvdt";
      document.getElementById("btn-mode-dvdt").classList.add("active");
      document.getElementById("btn-mode-m").classList.remove("active");
      document.getElementById("phase-title").textContent = "Phase Portrait: Vm vs dVm/dt";
      renderAll();
    });

    // Current clamp injection slider
    const ampSlider = document.getElementById("amp-slider");
    const ampVal = document.getElementById("amp-val");
    ampSlider.addEventListener("input", (e) => {
      ampVal.textContent = parseFloat(e.target.value).toFixed(1);
    });
    ampSlider.addEventListener("change", (e) => {
      vscode.postMessage({
        command: "reSimulate",
        injAmp: parseFloat(e.target.value),
      });
    });

    // Time scrubber
    const timeSlider = document.getElementById("time-slider");
    const timeVal = document.getElementById("time-val");
    const playBtn = document.getElementById("btn-play");

    timeSlider.addEventListener("input", (e) => {
      currentTime = parseFloat(e.target.value);
      timeVal.textContent = currentTime.toFixed(2);
      renderAll();
    });

    playBtn.addEventListener("click", () => {
      isPlaying = !isPlaying;
      playBtn.textContent = isPlaying ? "⏸ Pause" : "▶ Play";
      playBtn.classList.toggle("active", isPlaying);
      if (isPlaying) {
        animateTimeline();
      } else if (animHandle) {
        cancelAnimationFrame(animHandle);
      }
    });

    function animateTimeline() {
      if (!isPlaying) return;
      const maxT = simTimes[simTimes.length - 1] || 25.0;
      currentTime += 0.1;
      if (currentTime > maxT) currentTime = 0.0;
      timeSlider.value = currentTime;
      timeVal.textContent = currentTime.toFixed(2);
      renderAll();
      animHandle = requestAnimationFrame(animateTimeline);
    }

    // Helper: auto-resize canvas
    function setupCanvas(id) {
      const c = document.getElementById(id);
      if (!c || c.clientWidth === 0 || c.clientHeight === 0) return null;
      c.width = c.clientWidth * window.devicePixelRatio;
      c.height = c.clientHeight * window.devicePixelRatio;
      const ctx = c.getContext("2d");
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      return { c, ctx, w: c.clientWidth, h: c.clientHeight };
    }

    // 1. Draw Membrane Circuit
    function drawCircuit() {
      const res = setupCanvas("circuit-canvas");
      if (!res) return;
      const { ctx, w, h } = res;
      ctx.clearRect(0, 0, w, h);

      // Rails
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(30, 40); ctx.lineTo(w - 30, 40);
      ctx.stroke();

      ctx.strokeStyle = "#64748b";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(30, h - 30); ctx.lineTo(w - 30, h - 30);
      ctx.stroke();

      ctx.fillStyle = "#38bdf8";
      ctx.font = "bold 10px system-ui";
      ctx.fillText("Intracellular (Vm)", 32, 30);

      ctx.fillStyle = "#64748b";
      ctx.fillText("Extracellular (0 mV)", 32, h - 14);

      // Channels
      const branches = [
        { name: "Cm (1 µF)", color: "#38bdf8", isCap: true },
        { name: "Nav Channel", color: "#f59e0b" },
        { name: "Kv Channel", color: "#8b5cf6" },
        { name: "Leak Channel", color: "#10b981" },
      ];

      const step = (w - 80) / branches.length;
      branches.forEach((b, i) => {
        const x = 50 + i * step + step / 2;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 40); ctx.lineTo(x, 65);
        ctx.stroke();

        ctx.fillStyle = "#1e293b";
        ctx.strokeStyle = b.color;
        ctx.fillRect(x - 35, 65, 70, 45);
        ctx.strokeRect(x - 35, 65, 70, 45);

        ctx.fillStyle = "#f8fafc";
        ctx.font = "9px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(b.name, x, 92);

        ctx.strokeStyle = b.color;
        ctx.beginPath();
        ctx.moveTo(x, 110); ctx.lineTo(x, h - 30);
        ctx.stroke();
      });
    }

    // 2. Draw Vm(t) Oscilloscope
    function drawVmOnCanvas(canvasId) {
      const res = setupCanvas(canvasId);
      if (!res || simTimes.length < 2) return;
      const { ctx, w, h } = res;

      const minT = simTimes[0], maxT = simTimes[simTimes.length - 1];
      const minV = -85, maxV = 50;

      const toX = (t) => ((t - minT) / (maxT - minT)) * (w - 55) + 45;
      const toY = (v) => h - 25 - ((v - minV) / (maxV - minV)) * (h - 45);

      // Grid
      ctx.strokeStyle = "#1f2937";
      ctx.lineWidth = 1;
      for (let v = -80; v <= 40; v += 20) {
        const y = toY(v);
        ctx.beginPath(); ctx.moveTo(45, y); ctx.lineTo(w - 10, y); ctx.stroke();
        ctx.fillStyle = "#6b7280";
        ctx.font = "9px system-ui";
        ctx.textAlign = "right";
        ctx.fillText(v + "mV", 40, y + 3);
      }

      // Threshold line (-55 mV)
      const yThresh = toY(-55);
      ctx.strokeStyle = "rgba(245, 158, 11, 0.4)";
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(45, yThresh); ctx.lineTo(w - 10, yThresh); ctx.stroke();
      ctx.setLineDash([]);

      // Trace Vm(t)
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      simTimes.forEach((t, i) => {
        const x = toX(t);
        const y = toY(simVm[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Scrubber vertical indicator
      if (currentTime >= minT && currentTime <= maxT) {
        const sx = toX(currentTime);
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.beginPath(); ctx.moveTo(sx, 10); ctx.lineTo(sx, h - 25); ctx.stroke();
        ctx.setLineDash([]);

        // Interpolate current Vm
        const curIdx = Math.max(0, Math.min(simTimes.length - 1, Math.floor(((currentTime - minT) / (maxT - minT)) * (simTimes.length - 1))));
        const curVm = simVm[curIdx] ?? -65;
        const sy = toY(curVm);

        ctx.beginPath();
        ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "#f59e0b";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = "#f59e0b";
        ctx.font = "bold 9px system-ui";
        ctx.textAlign = "left";
        ctx.fillText(curVm.toFixed(1) + " mV", sx + 6, sy - 4);
      }
    }

    // 3. Draw Gating Variables
    function drawGating() {
      const res = setupCanvas("gating-canvas");
      if (!res || simTimes.length < 2) return;
      const { ctx, w, h } = res;

      const minT = simTimes[0], maxT = simTimes[simTimes.length - 1];
      const toX = (t) => ((t - minT) / (maxT - minT)) * (w - 45) + 35;
      const toY = (val) => h - 25 - val * (h - 45);

      const series = [
        { data: simM, color: "#f59e0b", label: "m (Na act)" },
        { data: simH, color: "#ec4899", label: "h (Na inact)" },
        { data: simN, color: "#8b5cf6", label: "n (K act)" },
      ];

      series.forEach((s) => {
        if (!s.data || s.data.length === 0) return;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        simTimes.forEach((t, i) => {
          const x = toX(t);
          const y = toY(s.data[i]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });

      // Scrubber line
      if (currentTime >= minT && currentTime <= maxT) {
        const sx = toX(currentTime);
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.beginPath(); ctx.moveTo(sx, 10); ctx.lineTo(sx, h - 25); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 4. Draw Phase Plane
    function drawPhaseOnCanvas(canvasId) {
      const res = setupCanvas(canvasId);
      if (!res || simVm.length < 2) return;
      const { ctx, w, h } = res;

      const minV = -85, maxV = 50;
      const toX = (v) => ((v - minV) / (maxV - minV)) * (w - 55) + 40;

      let yVals = [];
      let minY = 0, maxY = 1;
      if (phaseMode === "m") {
        yVals = simM;
        minY = 0; maxY = 1;
      } else {
        // dVm/dt
        yVals = [];
        for (let i = 0; i < simVm.length; i++) {
          if (i === 0) yVals.push((simVm[1] - simVm[0]) / (simTimes[1] - simTimes[0] || 0.05));
          else yVals.push((simVm[i] - simVm[i - 1]) / (simTimes[i] - simTimes[i - 1] || 0.05));
        }
        minY = Math.min(...yVals) - 10;
        maxY = Math.max(...yVals) + 10;
      }

      const toY = (y) => h - 25 - ((y - minY) / (maxY - minY || 1)) * (h - 45);

      // Grid
      ctx.strokeStyle = "#1f2937";
      ctx.lineWidth = 1;
      for (let v = -80; v <= 40; v += 20) {
        const x = toX(v);
        ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, h - 25); ctx.stroke();
      }

      // Threshold line
      const xThresh = toX(-55);
      ctx.strokeStyle = "rgba(245, 158, 11, 0.5)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(xThresh, 10); ctx.lineTo(xThresh, h - 25); ctx.stroke();
      ctx.setLineDash([]);

      // Trajectory Limit Cycle
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      simVm.forEach((v, i) => {
        const x = toX(v);
        const y = toY(yVals[i] ?? 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Current scrub point on limit cycle
      const curIdx = Math.max(0, Math.min(simTimes.length - 1, Math.floor(((currentTime - simTimes[0]) / (simTimes[simTimes.length - 1] - simTimes[0] || 1)) * (simTimes.length - 1))));
      const curV = simVm[curIdx] ?? -65;
      const curY = yVals[curIdx] ?? 0;
      const px = toX(curV);
      const py = toY(curY);

      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = "#10b981";
      ctx.font = "9px system-ui";
      ctx.fillText("Limit Cycle Orbit", w - 85, 20);
    }

    function renderAll() {
      if (currentView === "grid") {
        drawCircuit();
        drawVmOnCanvas("vm-canvas");
        drawGating();
        drawPhaseOnCanvas("phase-canvas");
      } else if (currentView === "oscilloscope") {
        drawVmOnCanvas("vm-full-canvas");
      } else if (currentView === "phase") {
        drawPhaseOnCanvas("phase-full-canvas");
      }
    }

    window.addEventListener("resize", renderAll);
    setTimeout(renderAll, 50);
  </script>
</body>
</html>`;
}

export class NmodlEditorProvider extends BaseCustomEditorProvider {
  public static readonly viewType = "modelscript.nmodlEditor";

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    _webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    ElectrophysiologyPanel.createOrShow(this.extensionUri, undefined, document.uri.toString());
  }
}

const SAMPLE_NMODL_HH = `TITLE Squid axon Hodgkin-Huxley model
NEURON {
  SUFFIX hh
  USEION na READ ena WRITE ina
  USEION k READ ek WRITE ik
  NONSPECIFIC_CURRENT il
  RANGE gnabar, gkbar, gl, el
}

PARAMETER {
  gnabar = 0.12 (mho/cm2)
  gkbar = 0.036 (mho/cm2)
  gl = 0.0003 (mho/cm2)
  ena = 50.0 (mV)
  ek = -77.0 (mV)
  el = -54.3 (mV)
}

STATE {
  m
  h
  n
}

BREAKPOINT {
  SOLVE states METHOD cnexp
  ina = gnabar * m^3 * h * (v - ena)
  ik = gkbar * n^4 * (v - ek)
  il = gl * (v - el)
}

DERIVATIVE states {
  m' = (minf - m) / mtau
  h' = (hinf - h) / htau
  n' = (ninf - n) / ntau
}
`;
