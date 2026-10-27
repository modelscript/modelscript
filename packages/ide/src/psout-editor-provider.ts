// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PSCAD V5+ *.psout Binary Waveform Interactive Custom Editor Provider.
 *
 * Provides a dedicated visual waveform analysis studio for power system engineers:
 *   1. Slotted-page binary decoding via @modelscript/pscad AssemblyScript WASM kernel.
 *   2. Interactive high-performance canvas waveform viewer with zoom, pan, and HUD.
 *   3. Dual measurement cursors with live delta-t, frequency (1/dt), delta-y, and slope calculation.
 *   4. Multi-channel signal drawer with search filter, group filtering, and color badges.
 *   5. Quick-export actions to CSV and IEEE C37.111 COMTRADE (.cfg + .dat).
 */

import { emtResultToComtrade, readPscadPsout, writeComtrade, type PscadPsoutDocument } from "@modelscript/pscad";
import * as vscode from "vscode";

export class PsoutCustomDocument implements vscode.CustomDocument {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly bytes: Uint8Array,
    public readonly psoutDoc: PscadPsoutDocument,
  ) {}

  public dispose(): void {}
}

export class PsoutEditorProvider implements vscode.CustomReadonlyEditorProvider<PsoutCustomDocument> {
  public static readonly viewType = "modelscript.psoutViewer";

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async openCustomDocument(uri: vscode.Uri): Promise<PsoutCustomDocument> {
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch (e) {
      console.warn(`[psout-editor] Failed to read ${uri.toString()}:`, e);
      bytes = new Uint8Array(0);
    }

    const doc = readPscadPsout(bytes);
    return new PsoutCustomDocument(uri, bytes, doc);
  }

  public async resolveCustomEditor(
    document: PsoutCustomDocument,
    webviewPanel: vscode.WebviewPanel,

    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    };

    let disposed = false;
    webviewPanel.webview.html = this.getHtmlForWebview();

    const postData = () => {
      if (disposed) return;
      const doc = document.psoutDoc;
      const run0 = doc.run(0);
      const traces = Array.from(run0.traces.values());
      const sim = doc.toSimulationResult(0);
      const timeArr = Array.from(sim.time);

      webviewPanel.webview.postMessage({
        type: "init",
        header: {
          version: doc.header.version,
          pageCount: doc.header.pageCount,
          pageSize: doc.header.pageSize,
          createdOn: doc.header.createdOn.toISOString(),
          guid: doc.header.guid,
          filename: document.uri.path.split("/").pop() ?? "waveform.psout",
        },
        time: timeArr,
        channels: traces.map((t) => ({
          id: t.id,
          name: t.name || `Channel_${t.id}`,
          unit: t.unit || "",
          group: t.group || "Traces",
          min: Number.isFinite(t.min) ? t.min : 0,
          max: Number.isFinite(t.max) ? t.max : 0,
          samples: Array.from(t.values),
        })),
      });
    };

    const msgSubscription = webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "ready":
          postData();
          break;

        case "exportCsv": {
          const defaultUri = vscode.Uri.file(document.uri.fsPath.replace(/\.psout$/i, ".csv") || "export.csv");
          const saveUri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { "CSV (Comma-Separated Values)": ["csv"] },
          });
          if (saveUri && msg.csv) {
            await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(msg.csv));
            vscode.window.showInformationMessage(`Exported CSV to ${saveUri.path.split("/").pop()}`);
          }
          break;
        }

        case "exportComtrade": {
          try {
            const sim = document.psoutDoc.toSimulationResult(0);
            const baseName =
              document.uri.path
                .split("/")
                .pop()
                ?.replace(/\.psout$/i, "") ?? "msx_psout";
            const rec = emtResultToComtrade(sim, baseName, "MSX_PSOUT");
            const comtrade = writeComtrade(rec);

            const folderUri = vscode.Uri.file(document.uri.fsPath.substring(0, document.uri.fsPath.lastIndexOf("/")));
            const cfgUri = vscode.Uri.joinPath(folderUri, `${baseName}.cfg`);
            const datUri = vscode.Uri.joinPath(folderUri, `${baseName}.dat`);

            await vscode.workspace.fs.writeFile(cfgUri, new TextEncoder().encode(comtrade.cfg));
            await vscode.workspace.fs.writeFile(datUri, new TextEncoder().encode(comtrade.dat));

            vscode.window.showInformationMessage(`Exported COMTRADE: ${baseName}.cfg & ${baseName}.dat`);
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`Failed to export COMTRADE: ${message}`);
          }
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      msgSubscription.dispose();
    });

    postData();
  }

  private getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' 'unsafe-eval' https:; connect-src https: http: ws: wss:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PSCAD PSOUT Waveform Studio</title>
  <style>
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --border: #30363d;
      --text-main: #c9d1d9;
      --text-dim: #8b949e;
      --accent: #58a6ff;
      --accent-hover: #1f6feb;
      --success: #238636;
      --warning: #d29922;
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg-primary);
      color: var(--text-main);
      font-family: var(--font-family);
      font-size: 12px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      user-select: none;
    }
    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      gap: 12px;
    }
    .header-info { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .header-title { font-size: 14px; font-weight: 600; color: #fff; display: flex; align-items: center; gap: 6px; }
    .badge {
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 11px;
      color: var(--accent);
      font-family: ui-monospace, monospace;
    }
    .header-actions { display: flex; gap: 8px; align-items: center; }
    button {
      background: var(--bg-tertiary);
      color: var(--text-main);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s ease;
    }
    button:hover { background: var(--accent); color: #fff; border-color: var(--accent); }
    button.active { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 600; }
    .main-layout {
      display: flex;
      flex: 1;
      height: calc(100vh - 45px);
      overflow: hidden;
    }
    .sidebar {
      width: 280px;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .sidebar-header {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .search-box {
      width: 100%;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 8px;
      color: var(--text-main);
      font-size: 11px;
      outline: none;
    }
    .search-box:focus { border-color: var(--accent); }
    .channel-list {
      flex: 1;
      overflow-y: auto;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .channel-item {
      display: flex;
      align-items: center;
      padding: 5px 8px;
      border-radius: 4px;
      gap: 8px;
      cursor: pointer;
      background: transparent;
      transition: background 0.1s;
    }
    .channel-item:hover { background: var(--bg-tertiary); }
    .channel-item input { cursor: pointer; accent-color: var(--accent); }
    .color-chip {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .channel-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11px;
    }
    .channel-unit {
      color: var(--text-dim);
      font-size: 10px;
      margin-left: 4px;
    }
    .chart-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--bg-primary);
      position: relative;
    }
    .hud-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 14px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      font-size: 11px;
      color: var(--text-dim);
      font-family: ui-monospace, monospace;
    }
    .hud-metrics { display: flex; gap: 16px; align-items: center; color: var(--accent); }
    .canvas-wrapper {
      flex: 1;
      position: relative;
      width: 100%;
      height: 100%;
    }
    canvas {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: block;
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <div class="header-info">
      <div class="header-title">⚡ PSCAD PSOUT Waveform Studio</div>
      <span class="badge" id="badge-filename">Loading...</span>
      <span class="badge" id="badge-version">V1</span>
      <span class="badge" id="badge-pages">0 pages</span>
      <span class="badge" id="badge-samples">0 samples</span>
    </div>
    <div class="header-actions">
      <button id="btn-toggle-cursors" title="Toggle Measurement Cursors">📏 Cursors</button>
      <button id="btn-toggle-normalized" title="Normalize Channels (0-100%)">% Norm</button>
      <button id="btn-reset-zoom" title="Reset Zoom / Fit All">⌂ Fit</button>
      <button id="btn-export-csv" title="Export Channels to CSV">📥 CSV</button>
      <button id="btn-export-comtrade" title="Export to IEEE C37.111 COMTRADE">⚡ COMTRADE</button>
    </div>
  </div>

  <div class="main-layout">
    <div class="sidebar">
      <div class="sidebar-header">
        <input type="text" id="input-search" class="search-box" placeholder="Filter channels (e.g. Bus, Line, V, I)..." />
        <div style="display: flex; justify-content: space-between;">
          <button id="btn-select-all" style="padding: 2px 6px; font-size: 10px;">Select All</button>
          <button id="btn-deselect-all" style="padding: 2px 6px; font-size: 10px;">Clear All</button>
        </div>
      </div>
      <div class="channel-list" id="channel-list"></div>
    </div>

    <div class="chart-container">
      <div class="hud-bar" id="hud-bar">
        <span id="hud-status">PSCAD V5 Waveform Loaded</span>
        <div class="hud-metrics" id="hud-metrics" style="display: none;">
          <span>Δt: <b id="val-dt">0.00 ms</b></span>
          <span>f: <b id="val-freq">0.00 Hz</b></span>
          <span>Δy: <b id="val-dy">0.00</b></span>
          <span>dy/dt: <b id="val-slope">0.00</b></span>
        </div>
      </div>
      <div class="canvas-wrapper" id="canvas-wrapper">
        <canvas id="waveform-canvas"></canvas>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const COLORS = [
      "#58a6ff", "#3fb950", "#d29922", "#f85149", "#a371f7",
      "#2ea043", "#db6d28", "#79c0ff", "#56d364", "#e3b341"
    ];

    let headerData = null;
    let timeVector = [];
    let channels = [];
    let activeChannelIds = new Set();
    let cursorsEnabled = false;
    let normalized = false;
    let cursor1X = null;
    let cursor2X = null;
    let zoomMinX = null;
    let zoomMaxX = null;

    const canvas = document.getElementById("waveform-canvas");
    const ctx = canvas.getContext("2d");
    const channelListEl = document.getElementById("channel-list");
    const searchInput = document.getElementById("input-search");

    // Initialize Webview
    vscode.postMessage({ type: "ready" });

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "init") {
        headerData = msg.header;
        timeVector = msg.time || [];
        channels = msg.channels || [];

        document.getElementById("badge-filename").textContent = headerData.filename;
        document.getElementById("badge-version").textContent = "V" + headerData.version;
        document.getElementById("badge-pages").textContent = headerData.pageCount + " pages";
        document.getElementById("badge-samples").textContent = timeVector.length + " samples";

        // Default to active first 5 channels
        activeChannelIds.clear();
        channels.slice(0, 5).forEach(ch => activeChannelIds.add(ch.id));

        renderChannelList();
        resetZoom();
        renderChart();
      }
    });

    function renderChannelList() {
      channelListEl.innerHTML = "";
      const filter = (searchInput.value || "").toLowerCase();

      channels.forEach((ch, idx) => {
        if (filter && !ch.name.toLowerCase().includes(filter) && !ch.group.toLowerCase().includes(filter)) {
          return;
        }

        const item = document.createElement("div");
        item.className = "channel-item";
        const color = COLORS[idx % COLORS.length];

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = activeChannelIds.has(ch.id);
        cb.addEventListener("change", () => {
          if (cb.checked) activeChannelIds.add(ch.id);
          else activeChannelIds.delete(ch.id);
          renderChart();
        });

        const chip = document.createElement("div");
        chip.className = "color-chip";
        chip.style.background = color;

        const label = document.createElement("span");
        label.className = "channel-label";
        label.textContent = ch.name;
        if (ch.unit) {
          const u = document.createElement("span");
          u.className = "channel-unit";
          u.textContent = "(" + ch.unit + ")";
          label.appendChild(u);
        }

        item.appendChild(cb);
        item.appendChild(chip);
        item.appendChild(label);
        channelListEl.appendChild(item);
      });
    }

    searchInput.addEventListener("input", () => renderChannelList());

    document.getElementById("btn-select-all").addEventListener("click", () => {
      channels.forEach(ch => activeChannelIds.add(ch.id));
      renderChannelList();
      renderChart();
    });

    document.getElementById("btn-deselect-all").addEventListener("click", () => {
      activeChannelIds.clear();
      renderChannelList();
      renderChart();
    });

    document.getElementById("btn-toggle-cursors").addEventListener("click", (e) => {
      cursorsEnabled = !cursorsEnabled;
      e.target.classList.toggle("active", cursorsEnabled);
      document.getElementById("hud-metrics").style.display = cursorsEnabled ? "flex" : "none";
      if (cursorsEnabled && cursor1X === null) {
        cursor1X = zoomMinX + (zoomMaxX - zoomMinX) * 0.25;
        cursor2X = zoomMinX + (zoomMaxX - zoomMinX) * 0.75;
      }
      renderChart();
    });

    document.getElementById("btn-toggle-normalized").addEventListener("click", (e) => {
      normalized = !normalized;
      e.target.classList.toggle("active", normalized);
      renderChart();
    });

    function resetZoom() {
      zoomMinX = timeVector.length > 0 ? timeVector[0] : 0;
      zoomMaxX = timeVector.length > 0 ? timeVector[timeVector.length - 1] : 1;
    }

    document.getElementById("btn-reset-zoom").addEventListener("click", () => {
      resetZoom();
      renderChart();
    });

    document.getElementById("btn-export-csv").addEventListener("click", () => {
      const activeChs = channels.filter(c => activeChannelIds.has(c.id));
      const header = ["Time (s)", ...activeChs.map(c => c.unit ? c.name + " (" + c.unit + ")" : c.name)].join(",");
      const rows = [header];
      for (let i = 0; i < timeVector.length; i++) {
        const line = [timeVector[i].toFixed(6), ...activeChs.map(c => c.samples[i] !== undefined ? c.samples[i].toFixed(6) : "0.0")];
        rows.push(line.join(","));
      }
      vscode.postMessage({ type: "exportCsv", csv: rows.join("\\n") });
    });

    document.getElementById("btn-export-comtrade").addEventListener("click", () => {
      vscode.postMessage({ type: "exportComtrade" });
    });

    // High-performance canvas chart rendering
    function renderChart() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.parentElement.clientWidth;
      const h = canvas.parentElement.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);

      // Background
      ctx.fillStyle = "#0d1117";
      ctx.fillRect(0, 0, w, h);

      const padL = 60, padR = 30, padT = 30, padB = 40;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;

      if (plotW <= 0 || plotH <= 0 || timeVector.length === 0) return;

      const activeChs = channels.filter(c => activeChannelIds.has(c.id));

      let minY = Infinity, maxY = -Infinity;
      if (normalized) {
        minY = 0; maxY = 100;
      } else {
        activeChs.forEach(c => {
          if (c.min < minY) minY = c.min;
          if (c.max > maxY) maxY = c.max;
        });
        if (minY === Infinity) { minY = -1; maxY = 1; }
        if (minY === maxY) { minY -= 1; maxY += 1; }
      }

      // Grid
      ctx.strokeStyle = "#21262d";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= 5; i++) {
        const x = padL + (i / 5) * plotW;
        ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH);
      }
      for (let j = 0; j <= 4; j++) {
        const y = padT + (j / 4) * plotH;
        ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y);
      }
      ctx.stroke();

      // Axes Labels & Numbers
      ctx.fillStyle = "#8b949e";
      ctx.font = "10px ui-monospace, monospace";
      for (let i = 0; i <= 5; i++) {
        const valX = zoomMinX + (i / 5) * (zoomMaxX - zoomMinX);
        const x = padL + (i / 5) * plotW;
        ctx.fillText(valX.toFixed(3) + "s", x - 15, padT + plotH + 18);
      }
      for (let j = 0; j <= 4; j++) {
        const valY = maxY - (j / 4) * (maxY - minY);
        const y = padT + (j / 4) * plotH;
        ctx.fillText(valY.toFixed(1), 10, y + 4);
      }

      // Draw series
      const toX = (tx) => padL + ((tx - zoomMinX) / (zoomMaxX - zoomMinX || 1)) * plotW;
      const toY = (ty) => padT + plotH - ((ty - minY) / (maxY - minY || 1)) * plotH;

      activeChs.forEach((ch) => {
        const chIdx = channels.findIndex(c => c.id === ch.id);
        const col = COLORS[chIdx % COLORS.length];

        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        let started = false;
        const step = Math.max(1, Math.floor(timeVector.length / 3000));
        for (let i = 0; i < timeVector.length; i += step) {
          const tx = timeVector[i];
          if (tx < zoomMinX && i + step < timeVector.length && timeVector[i + step] < zoomMinX) continue;
          if (tx > zoomMaxX) break;

          let val = ch.samples[i] || 0;
          if (normalized) {
            const span = (ch.max - ch.min) || 1;
            val = ((val - ch.min) / span) * 100;
          }

          const px = toX(tx);
          const py = toY(val);

          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      });

      // Measurement Cursors
      if (cursorsEnabled && cursor1X !== null && cursor2X !== null) {
        const c1ScreenX = toX(cursor1X);
        const c2ScreenX = toX(cursor2X);

        ctx.strokeStyle = "#58a6ff";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(c1ScreenX, padT); ctx.lineTo(c1ScreenX, padT + plotH);
        ctx.moveTo(c2ScreenX, padT); ctx.lineTo(c2ScreenX, padT + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Metrics update
        const dt = Math.abs(cursor2X - cursor1X);
        const freq = dt > 1e-9 ? 1 / dt : 0;
        document.getElementById("val-dt").textContent = (dt * 1e3).toFixed(2) + " ms";
        document.getElementById("val-freq").textContent = freq.toFixed(1) + " Hz";

        if (activeChs.length > 0) {
          const primary = activeChs[0];
          const interpolate = (targetX) => {
            for (let i = 0; i < timeVector.length - 1; i++) {
              if (targetX >= timeVector[i] && targetX <= timeVector[i+1]) {
                const t = (targetX - timeVector[i]) / (timeVector[i+1] - timeVector[i] || 1);
                return primary.samples[i] + t * (primary.samples[i+1] - primary.samples[i]);
              }
            }
            return primary.samples[0] || 0;
          };
          const y1 = interpolate(Math.min(cursor1X, cursor2X));
          const y2 = interpolate(Math.max(cursor1X, cursor2X));
          const dy = y2 - y1;
          const slope = dt > 1e-9 ? dy / dt : 0;
          document.getElementById("val-dy").textContent = dy.toFixed(3) + (primary.unit ? " " + primary.unit : "");
          document.getElementById("val-slope").textContent = slope.toFixed(1) + "/s";
        }
      }
    }

    // Zoom interaction
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - 60;
      const plotW = rect.width - 90;
      if (plotW <= 0) return;

      const frac = Math.max(0, Math.min(1, mouseX / plotW));
      const curX = zoomMinX + frac * (zoomMaxX - zoomMinX);
      const zoomFactor = e.deltaY < 0 ? 0.8 : 1.25;

      const newSpan = (zoomMaxX - zoomMinX) * zoomFactor;
      zoomMinX = curX - frac * newSpan;
      zoomMaxX = curX + (1 - frac) * newSpan;
      renderChart();
    });

    window.addEventListener("resize", () => renderChart());
  </script>
</body>
</html>`;
  }
}
