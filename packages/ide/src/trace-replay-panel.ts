// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";

export interface ReplaySignalPoint {
  time: number;
  value: number;
}

export interface ReplayTraceData {
  id: string;
  source: "bmc" | "ic3" | "falsification" | "flowpipe_escape";
  status: "FALSIFIED" | "UNSAT" | "CERTIFIED_SAFE";
  times: number[];
  continuousSignals: Record<string, number[]>;
  discreteSignals?: Record<string, (string | number | boolean)[]>;
  violatingTimeIndex?: number;
  violatingProperty?: string;
  parameters?: Record<string, number>;
  nominalSignals?: Record<string, number[]>;
  divergenceTime?: number;
  divergingVariable?: string;
}

export class TraceReplayPanel {
  public static currentPanel: TraceReplayPanel | undefined;
  public static readonly viewType = "modelscript.traceReplay";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _client?: LanguageClient;
  private _disposables: vscode.Disposable[] = [];
  private _currentTrace?: ReplayTraceData;

  public static createOrShow(extensionUri: vscode.Uri, client?: LanguageClient, trace?: ReplayTraceData) {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (TraceReplayPanel.currentPanel) {
      TraceReplayPanel.currentPanel._panel.reveal(column);
      if (trace) {
        TraceReplayPanel.currentPanel.loadTrace(trace);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      TraceReplayPanel.viewType,
      "Formal Trace & Counterexample Replayer",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    TraceReplayPanel.currentPanel = new TraceReplayPanel(panel, extensionUri, client, trace);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client?: LanguageClient,
    initialTrace?: ReplayTraceData,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._client = client;
    this._currentTrace = initialTrace ?? this._getSampleTrace();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = this._getHtmlForWebview();

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case "ready":
            this._sendTraceToWebview();
            break;

          case "requestDiff": {
            if (this._client && this._currentTrace) {
              try {
                const diffResult = await this._client.sendRequest<any>("modelscript/getCounterexampleDiff", {
                  counterexample: this._currentTrace,
                });
                if (diffResult?.success) {
                  this._panel.webview.postMessage({
                    type: "diffData",
                    divergenceTime: diffResult.divergenceTime,
                    divergingVariable: diffResult.divergingVariable,
                    diffSignals: diffResult.diffSignals,
                    nominalSignals: diffResult.syncedNom?.continuousSignals,
                  });
                }
              } catch (e) {
                vscode.window.showErrorMessage(`Failed to calculate trace diff: ${e}`);
              }
            }
            break;
          }

          case "tokenStep": {
            // Scrubbing token position - navigate editor if target source position available
            if (msg.uri) {
              const docUri = vscode.Uri.parse(msg.uri);
              const doc = await vscode.workspace.openTextDocument(docUri);
              const line = Math.max(0, (msg.line || 1) - 1);
              const col = Math.max(0, (msg.column || 1) - 1);
              const pos = new vscode.Position(line, col);
              vscode.window.showTextDocument(doc, {
                selection: new vscode.Range(pos, pos),
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true,
              });
            }
            break;
          }

          case "exportVcd": {
            const vcdText = this._generateVcd(this._currentTrace);
            const doc = await vscode.workspace.openTextDocument({
              content: vcdText,
              language: "vcd",
            });
            vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
            vscode.window.showInformationMessage("Generated IEEE 1364 VCD Waveform dump.");
            break;
          }

          case "exportCsv": {
            const csvText = this._generateCsv(this._currentTrace);
            const doc = await vscode.workspace.openTextDocument({
              content: csvText,
              language: "csv",
            });
            vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
            vscode.window.showInformationMessage("Exported trace CSV.");
            break;
          }
        }
      },
      null,
      this._disposables,
    );
  }

  public loadTrace(trace: ReplayTraceData): void {
    this._currentTrace = trace;
    this._sendTraceToWebview();
  }

  private _sendTraceToWebview(): void {
    if (this._currentTrace) {
      this._panel.webview.postMessage({
        type: "loadTrace",
        trace: this._currentTrace,
      });
    }
  }

  private _getSampleTrace(): ReplayTraceData {
    const times: number[] = [];
    const speedCex: number[] = [];
    const speedNom: number[] = [];
    const pressureCex: number[] = [];
    const pressureNom: number[] = [];
    const modeState: string[] = [];

    const numPoints = 80;
    const dt = 0.05;

    for (let i = 0; i < numPoints; i++) {
      const t = Number((i * dt).toFixed(2));
      times.push(t);

      // Nominal speed accelerates then caps safely at 45 m/s
      const nomSpd = 10 + 35 * (1 - Math.exp(-t / 1.5));
      speedNom.push(Number(nomSpd.toFixed(2)));

      // Violating speed runaway past t = 2.1s
      let cexSpd = nomSpd;
      if (t >= 1.8) {
        cexSpd = nomSpd + 20 * Math.pow(t - 1.8, 1.4);
      }
      speedCex.push(Number(cexSpd.toFixed(2)));

      // Pressure signal
      const nomP = 1.0 + 0.3 * Math.sin(t * 2);
      pressureNom.push(Number(nomP.toFixed(2)));
      pressureCex.push(Number((nomP + (t >= 2.0 ? 0.6 : 0)).toFixed(2)));

      // State mode
      if (t < 1.0) {
        modeState.push("STARTUP");
      } else if (t < 2.2) {
        modeState.push("ACCELERATING");
      } else {
        modeState.push(cexSpd > 60 ? "OVERSPEED_TRIP" : "CRUISE");
      }
    }

    return {
      id: "trace-cex-overspeed-01",
      source: "falsification",
      status: "FALSIFIED",
      times,
      continuousSignals: {
        speed: speedCex,
        pressure: pressureCex,
      },
      nominalSignals: {
        speed: speedNom,
        pressure: pressureNom,
      },
      discreteSignals: {
        mode: modeState,
      },
      violatingTimeIndex: 44, // t = 2.20s
      violatingProperty: "MaxSpeedLimit (speed <= 60.0 m/s)",
      divergenceTime: 1.8,
      divergingVariable: "speed",
      parameters: { kp: 1.85, mass: 1250, dragCoeff: 0.28 },
    };
  }

  private _generateVcd(trace?: ReplayTraceData): string {
    if (!trace) return "";
    const lines: string[] = [];
    lines.push("$date\n  " + new Date().toISOString() + "\n$end");
    lines.push("$version\n  ModelScript Formal Verification VCD Generator\n$end");
    lines.push("$timescale 1us $end");
    lines.push("$scope module Counterexample $end");

    const varKeys = Object.keys(trace.continuousSignals);
    varKeys.forEach((key, idx) => {
      const id = String.fromCharCode(33 + idx);
      lines.push(`$var real 64 ${id} ${key} $end`);
    });
    lines.push("$upscope $end");
    lines.push("$enddefinitions $end");
    lines.push("$dumpvars");

    trace.times.forEach((t, tIdx) => {
      lines.push(`#${Math.round(t * 1e6)}`);
      varKeys.forEach((key, kIdx) => {
        const id = String.fromCharCode(33 + kIdx);
        const val = trace.continuousSignals[key]?.[tIdx] ?? 0;
        lines.push(`r${val} ${id}`);
      });
    });

    return lines.join("\n");
  }

  private _generateCsv(trace?: ReplayTraceData): string {
    if (!trace) return "";
    const contKeys = Object.keys(trace.continuousSignals);
    const discKeys = trace.discreteSignals ? Object.keys(trace.discreteSignals) : [];
    const headers = ["time", ...contKeys, ...discKeys];

    const rows = [headers.join(",")];
    for (let i = 0; i < trace.times.length; i++) {
      const row = [trace.times[i]];
      for (const k of contKeys) row.push(trace.continuousSignals[k]?.[i] ?? "");
      for (const k of discKeys) row.push(trace.discreteSignals?.[k]?.[i] ?? "");
      rows.push(row.join(","));
    }
    return rows.join("\n");
  }

  public dispose() {
    TraceReplayPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  private _getHtmlForWebview(): string {
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Formal Trace & Counterexample Replayer</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #cccccc);
      --card-bg: var(--vscode-sideBar-background, #252526);
      --border: var(--vscode-panel-border, #3c3c3c);
      --accent: var(--vscode-button-background, #0e639c);
      --falsified: #f44336;
      --safe: #4caf50;
      --nominal: #00bcd4;
      --diverge: #ff9800;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      background-color: var(--bg);
      color: var(--fg);
      overflow-x: auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 16px;
    }
    .title-area h2 {
      margin: 0 0 4px 0;
      font-size: 1.25rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badges {
      display: flex;
      gap: 8px;
      font-size: 0.8rem;
    }
    .badge {
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .badge-falsified { background: rgba(244, 67, 54, 0.15); color: var(--falsified); border: 1px solid var(--falsified); }
    .badge-safe { background: rgba(76, 175, 80, 0.15); color: var(--safe); border: 1px solid var(--safe); }
    .badge-diverge { background: rgba(255, 152, 0, 0.15); color: var(--diverge); border: 1px solid var(--diverge); }

    .actions { display: flex; gap: 8px; }
    button {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: none;
      border-radius: 4px;
      padding: 6px 12px;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    button.secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
    }

    /* Scrubber Controls Bar */
    .scrubber-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 18px;
      margin-bottom: 16px;
    }
    .scrubber-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .time-readout {
      font-size: 1.15rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .controls-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .slider-container {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
    }
    input[type="range"] {
      flex: 1;
      height: 6px;
      accent-color: var(--accent);
      cursor: pointer;
    }

    /* Diff Inspector Banner */
    .diff-banner {
      background: rgba(255, 152, 0, 0.1);
      border: 1px solid var(--diverge);
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .diff-banner.safe {
      background: rgba(76, 175, 80, 0.1);
      border-color: var(--safe);
    }

    /* Canvas / Waveform view */
    .canvas-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      position: relative;
    }
    canvas {
      width: 100%;
      height: 380px;
      display: block;
    }

    .legend {
      display: flex;
      gap: 16px;
      margin-top: 10px;
      font-size: 0.85rem;
      align-items: center;
    }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    .line-indicator { width: 18px; height: 3px; border-radius: 2px; }

    /* Values readout grid */
    .values-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .value-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 14px;
    }
    .value-card .v-title { font-size: 0.8rem; opacity: 0.75; text-transform: uppercase; }
    .value-card .v-val { font-size: 1.2rem; font-weight: 600; margin-top: 4px; font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>

  <header>
    <div class="title-area">
      <h2>⏱️ Formal Trace & Counterexample Replayer</h2>
      <div class="badges">
        <span class="badge badge-falsified" id="status-badge">FALSIFIED</span>
        <span class="badge" style="background: rgba(255,255,255,0.06); border: 1px solid var(--border);" id="source-badge">falsification</span>
        <span class="badge badge-diverge" id="violation-badge">Violating: MaxSpeedLimit</span>
      </div>
    </div>
    <div class="actions">
      <button class="secondary" id="btn-export-vcd">💾 Export VCD</button>
      <button class="secondary" id="btn-export-csv">📊 Export CSV</button>
    </div>
  </header>

  <!-- Divergence Alert Banner -->
  <div class="diff-banner" id="diff-banner">
    <div>
      <strong>⚠️ Divergence Detected:</strong> Signal <code id="diverge-var">speed</code> diverged from nominal trajectory at <strong id="diverge-time">t = 1.80s</strong>.
    </div>
    <button class="secondary" style="padding: 4px 10px; font-size: 0.8rem;" id="btn-jump-diverge">🎯 Jump to Divergence</button>
  </div>

  <!-- Scrubber Card -->
  <div class="scrubber-card">
    <div class="scrubber-header">
      <div class="controls-row">
        <button id="btn-play-pause">▶ Play</button>
        <button class="secondary" id="btn-step-back">⏪ -0.05s</button>
        <button class="secondary" id="btn-step-fwd">⏩ +0.05s</button>
        <button class="secondary" id="btn-reset">⏹ Reset</button>
        <button class="secondary" style="color: var(--falsified); border-color: var(--falsified);" id="btn-jump-violation">💥 Jump to Violation</button>
      </div>
      <div class="time-readout">
        t = <span id="time-val">0.00</span>s / <span id="time-max">4.00</span>s
      </div>
    </div>
    <div class="slider-container">
      <span>0.0s</span>
      <input type="range" id="time-slider" min="0" max="100" value="0" step="1">
      <span id="label-tmax">4.0s</span>
    </div>
  </div>

  <!-- Waveform Canvas -->
  <div class="canvas-container">
    <canvas id="waveform-canvas"></canvas>
    <div class="legend">
      <div class="legend-item"><div class="line-indicator" style="background: var(--falsified);"></div> Counterexample Trace</div>
      <div class="legend-item"><div class="line-indicator" style="background: var(--nominal);"></div> Nominal Safe Trajectory</div>
      <div class="legend-item"><div class="dot" style="background: var(--diverge);"></div> Divergence Point</div>
      <div class="legend-item"><div class="line-indicator" style="background: rgba(255, 0, 0, 0.8); width: 2px;"></div> Violation Time</div>
    </div>
  </div>

  <!-- Live Value Readouts -->
  <div class="values-grid" id="readout-grid">
    <!-- Populated dynamically -->
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let currentTrace = null;
    let isPlaying = false;
    let playInterval = null;
    let currentIndex = 0;

    const canvas = document.getElementById('waveform-canvas');
    const ctx = canvas.getContext('2d');

    const slider = document.getElementById('time-slider');
    const timeVal = document.getElementById('time-val');
    const timeMax = document.getElementById('time-max');
    const labelTmax = document.getElementById('label-tmax');
    const btnPlay = document.getElementById('btn-play-pause');

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'loadTrace') {
        currentTrace = msg.trace;
        setupTraceView();
      }
    });

    function setupTraceView() {
      if (!currentTrace || !currentTrace.times) return;

      const n = currentTrace.times.length;
      slider.max = (n - 1).toString();
      slider.value = "0";
      currentIndex = 0;

      const tEnd = currentTrace.times[n - 1].toFixed(2);
      timeMax.textContent = tEnd;
      labelTmax.textContent = tEnd + 's';

      document.getElementById('status-badge').textContent = currentTrace.status;
      document.getElementById('source-badge').textContent = currentTrace.source;
      if (currentTrace.violatingProperty) {
        document.getElementById('violation-badge').textContent = 'Violating: ' + currentTrace.violatingProperty;
      }

      if (currentTrace.divergenceTime !== undefined) {
        document.getElementById('diverge-var').textContent = currentTrace.divergingVariable || 'state';
        document.getElementById('diverge-time').textContent = 't = ' + currentTrace.divergenceTime.toFixed(2) + 's';
      }

      resizeCanvas();
      drawWaveform();
      updateReadouts();
    }

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    window.addEventListener('resize', () => {
      resizeCanvas();
      drawWaveform();
    });

    function drawWaveform() {
      if (!currentTrace || !currentTrace.times) return;

      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;

      ctx.clearRect(0, 0, W, H);

      const times = currentTrace.times;
      const tMin = times[0];
      const tMax = times[times.length - 1];

      const contSignals = currentTrace.continuousSignals;
      const keys = Object.keys(contSignals);
      if (keys.length === 0) return;

      const primaryKey = currentTrace.divergingVariable && contSignals[currentTrace.divergingVariable] 
        ? currentTrace.divergingVariable 
        : keys[0];

      const cexVals = contSignals[primaryKey] || [];
      const nomVals = (currentTrace.nominalSignals && currentTrace.nominalSignals[primaryKey]) || [];

      // Determine Y scale
      const allVals = [...cexVals, ...nomVals];
      let yMin = Math.min(...allVals);
      let yMax = Math.max(...allVals);
      const pad = (yMax - yMin) * 0.15 || 1.0;
      yMin -= pad;
      yMax += pad;

      const toX = (t) => 40 + ((t - tMin) / (tMax - tMin)) * (W - 60);
      const toY = (v) => (H - 30) - ((v - yMin) / (yMax - yMin)) * (H - 60);

      // Grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const y = toY(yMin + (i / 5) * (yMax - yMin));
        ctx.beginPath();
        ctx.moveTo(40, y);
        ctx.lineTo(W - 20, y);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '10px sans-serif';
        ctx.fillText((yMin + (i / 5) * (yMax - yMin)).toFixed(1), 5, y + 3);
      }

      // 1. Draw Nominal safe curve (Cyan)
      if (nomVals.length > 0) {
        ctx.strokeStyle = '#00bcd4';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        for (let i = 0; i < times.length; i++) {
          const x = toX(times[i]);
          const y = toY(nomVals[i]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 2. Draw Violating Counterexample curve (Red)
      ctx.strokeStyle = '#f44336';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < times.length; i++) {
        const x = toX(times[i]);
        const y = toY(cexVals[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // 3. Mark Violation Point line
      if (currentTrace.violatingTimeIndex !== undefined) {
        const vTime = times[currentTrace.violatingTimeIndex];
        const vx = toX(vTime);
        ctx.strokeStyle = 'rgba(244, 67, 54, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(vx, 10);
        ctx.lineTo(vx, H - 30);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#f44336';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('💥 Violation', vx + 6, 25);
      }

      // 4. Mark Divergence Point
      if (currentTrace.divergenceTime !== undefined) {
        const dx = toX(currentTrace.divergenceTime);
        ctx.fillStyle = '#ff9800';
        ctx.beginPath();
        ctx.arc(dx, toY(cexVals[Math.floor(currentIndex)]), 6, 0, Math.PI * 2);
        ctx.fill();
      }

      // 5. Active Cursor Line
      const curTime = times[currentIndex];
      const curX = toX(curTime);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(curX, 10);
      ctx.lineTo(curX, H - 30);
      ctx.stroke();

      // Circle at current value
      const curVal = cexVals[currentIndex];
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(curX, toY(curVal), 5, 0, Math.PI * 2);
      ctx.fill();
    }

    function updateReadouts() {
      if (!currentTrace) return;
      const t = currentTrace.times[currentIndex];
      timeVal.textContent = t.toFixed(2);

      const grid = document.getElementById('readout-grid');
      grid.innerHTML = '';

      // Continuous signals
      for (const [key, vals] of Object.entries(currentTrace.continuousSignals)) {
        const val = vals[currentIndex];
        const nomVal = currentTrace.nominalSignals ? currentTrace.nominalSignals[key]?.[currentIndex] : undefined;

        const card = document.createElement('div');
        card.className = 'value-card';
        card.innerHTML = \`
          <div class="v-title">\${key}</div>
          <div class="v-val" style="color: \${nomVal !== undefined && Math.abs(val - nomVal) > 0.5 ? 'var(--falsified)' : 'inherit'}">
            \${val.toFixed(2)}
            \${nomVal !== undefined ? '<span style="font-size: 0.8rem; opacity: 0.6; margin-left: 6px;">(nom: ' + nomVal.toFixed(2) + ')</span>' : ''}
          </div>
        \`;
        grid.appendChild(card);
      }

      // Discrete signals
      if (currentTrace.discreteSignals) {
        for (const [key, vals] of Object.entries(currentTrace.discreteSignals)) {
          const val = vals[currentIndex];
          const card = document.createElement('div');
          card.className = 'value-card';
          card.innerHTML = \`
            <div class="v-title">\${key} [state]</div>
            <div class="v-val" style="color: var(--nominal);">\${val}</div>
          \`;
          grid.appendChild(card);
        }
      }

      // Send token stepping event
      vscode.postMessage({
        type: 'tokenStep',
        time: t,
        values: currentTrace.continuousSignals,
      });
    }

    slider.addEventListener('input', () => {
      currentIndex = parseInt(slider.value, 10);
      drawWaveform();
      updateReadouts();
    });

    btnPlay.addEventListener('click', () => {
      if (isPlaying) {
        pause();
      } else {
        play();
      }
    });

    function play() {
      isPlaying = true;
      btnPlay.textContent = '⏸ Pause';
      playInterval = setInterval(() => {
        if (!currentTrace) return;
        if (currentIndex < currentTrace.times.length - 1) {
          currentIndex++;
          slider.value = currentIndex.toString();
          drawWaveform();
          updateReadouts();
        } else {
          pause();
        }
      }, 60);
    }

    function pause() {
      isPlaying = false;
      btnPlay.textContent = '▶ Play';
      if (playInterval) {
        clearInterval(playInterval);
        playInterval = null;
      }
    }

    document.getElementById('btn-step-fwd').addEventListener('click', () => {
      if (!currentTrace) return;
      if (currentIndex < currentTrace.times.length - 1) {
        currentIndex++;
        slider.value = currentIndex.toString();
        drawWaveform();
        updateReadouts();
      }
    });

    document.getElementById('btn-step-back').addEventListener('click', () => {
      if (!currentTrace) return;
      if (currentIndex > 0) {
        currentIndex--;
        slider.value = currentIndex.toString();
        drawWaveform();
        updateReadouts();
      }
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
      currentIndex = 0;
      slider.value = '0';
      drawWaveform();
      updateReadouts();
    });

    document.getElementById('btn-jump-violation').addEventListener('click', () => {
      if (currentTrace && currentTrace.violatingTimeIndex !== undefined) {
        currentIndex = currentTrace.violatingTimeIndex;
        slider.value = currentIndex.toString();
        drawWaveform();
        updateReadouts();
      }
    });

    document.getElementById('btn-jump-diverge').addEventListener('click', () => {
      if (currentTrace && currentTrace.divergenceTime !== undefined) {
        const dIdx = currentTrace.times.findIndex(t => t >= currentTrace.divergenceTime - 1e-3);
        if (dIdx >= 0) {
          currentIndex = dIdx;
          slider.value = currentIndex.toString();
          drawWaveform();
          updateReadouts();
        }
      }
    });

    document.getElementById('btn-export-vcd').addEventListener('click', () => {
      vscode.postMessage({ type: 'exportVcd' });
    });

    document.getElementById('btn-export-csv').addEventListener('click', () => {
      vscode.postMessage({ type: 'exportCsv' });
    });

    // Notify extension ready
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
