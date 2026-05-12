// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Calibration Dashboard webview entry point.
// Renders a live cost-history chart, parameter trajectory, and final overlay.

declare const acquireVsCodeApi: () => { postMessage: (msg: Record<string, unknown>) => void };
const vscode = acquireVsCodeApi();

// ── State ──

interface ProgressPoint {
  iteration: number;
  cost: number;
  parameters: Record<string, number>;
}

interface CalibrationResultData {
  success: boolean;
  parameters: Record<string, number>;
  residual: number;
  iterations: number;
  simulated: { t: number[]; y: number[][]; states: string[] };
  costHistory: number[];
  error?: string;
}

let progressHistory: ProgressPoint[] = [];
let finalResult: CalibrationResultData | null = null;
let isDark = true;
let logScale = false;
let activeTab: "cost" | "params" | "overlay" = "cost";

// ── DOM Setup ──

const root = document.getElementById("root");
if (root) {
  root.innerHTML = `
    <div id="cal-layout" style="display: flex; width: 100vw; height: 100vh;">
      <div id="cal-sidebar" style="width: 300px; min-width: 200px; border-right: 1px solid var(--vscode-panel-border, #333); background: var(--vscode-sideBar-background, #252526); overflow-y: auto; display: flex; flex-direction: column;">
        <div style="padding: 12px 16px; font-size: 13px; font-weight: 600; border-bottom: 1px solid var(--vscode-panel-border, #333);">Calibration</div>
        <div style="padding: 8px 16px; font-size: 11px;">
          <label style="display:block;margin-bottom:4px">Measurement Data (CSV)</label>
          <textarea id="cal-csv" rows="5" style="width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);font-family:monospace;font-size:10px;" placeholder="time,x&#10;0,1.0&#10;1,0.37"></textarea>
        </div>
        <div style="padding: 4px 16px; font-size: 11px;">
          <label style="display:block;margin-bottom:4px">Parameters to Optimize (comma separated)</label>
          <input type="text" id="cal-params" style="width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);" placeholder="a, b">
        </div>
        <div style="padding: 4px 16px; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
          <label>Method</label>
          <select id="cal-method" style="width:80px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);">
            <option value="lm">LM</option>
            <option value="sqp">SQP</option>
          </select>
        </div>
        <div style="padding: 4px 16px; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
          <label>Max Iterations</label>
          <input type="number" id="cal-iters" value="100" style="width:80px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);">
        </div>
        <div style="padding: 12px 16px;">
          <button id="btn-calibrate" style="width:100%;padding:6px;background:var(--vscode-debugIcon-startForeground, #388a34);color:#fff;border:none;border-radius:2px;cursor:pointer;font-size:13px;font-weight:500;">Run Calibration</button>
        </div>
        <div id="cal-results" style="padding: 8px 16px; font-size: 11px; display: none;">
          <div style="font-weight: 600; margin-bottom: 4px;">Results</div>
          <div id="cal-results-body"></div>
          <button id="btn-save" style="width:100%;padding:4px;margin-top:8px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:2px;cursor:pointer;font-size:12px;">Save Result (Extend Pattern)</button>
        </div>
        <div id="cal-status" style="padding: 8px 16px; font-size: 11px; color: var(--vscode-descriptionForeground);"></div>
      </div>
      <div id="cal-main" style="flex: 1; display: flex; flex-direction: column; min-width: 0;">
        <div id="cal-tabs" style="display: flex; gap: 0; border-bottom: 1px solid var(--vscode-panel-border, #333);">
          <button class="cal-tab active" data-tab="cost" style="padding:8px 16px;border:none;border-bottom:2px solid var(--vscode-focusBorder);background:transparent;color:var(--vscode-foreground);cursor:pointer;font-size:12px;">Cost History</button>
          <button class="cal-tab" data-tab="params" style="padding:8px 16px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:12px;">Parameters</button>
          <button class="cal-tab" data-tab="overlay" style="padding:8px 16px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:12px;">Sim vs Measured</button>
          <div style="flex:1"></div>
          <label style="display:flex;align-items:center;padding:0 12px;font-size:11px;gap:4px;"><input type="checkbox" id="log-toggle"> Log Scale</label>
        </div>
        <div id="cal-chart-container" style="flex:1;position:relative;min-height:0;">
          <canvas id="cal-canvas" style="width:100%;height:100%;"></canvas>
          <div id="cal-placeholder" style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;opacity:0.5;font-size:14px;">Run calibration to see results</div>
        </div>
      </div>
    </div>
  `;

  // Wire up controls
  const btnCalibrate = document.getElementById("btn-calibrate");
  const btnSave = document.getElementById("btn-save");
  const logToggle = document.getElementById("log-toggle") as HTMLInputElement | null;

  if (btnCalibrate) {
    btnCalibrate.addEventListener("click", () => {
      const csvEl = document.getElementById("cal-csv") as HTMLTextAreaElement | null;
      const paramsEl = document.getElementById("cal-params") as HTMLInputElement | null;
      const methodEl = document.getElementById("cal-method") as HTMLSelectElement | null;
      const itersEl = document.getElementById("cal-iters") as HTMLInputElement | null;

      const csvData = csvEl?.value ?? "";
      const parameters = (paramsEl?.value ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const method = (methodEl?.value ?? "lm") as "lm" | "sqp";
      const maxIterations = parseInt(itersEl?.value ?? "100", 10) || 100;

      if (!csvData || parameters.length === 0) {
        setStatus("Please provide CSV data and parameter names.");
        return;
      }

      progressHistory = [];
      finalResult = null;
      setStatus("Calibrating...");

      vscode.postMessage({
        type: "calibrateRequest",
        payload: { csvData, parameters, method, maxIterations },
      });
    });
  }

  if (btnSave) {
    btnSave.addEventListener("click", () => {
      if (!finalResult) return;
      vscode.postMessage({
        type: "saveResultRequest",
        payload: {
          className: "Model",
          optimizedParameters: finalResult.parameters,
        },
      });
    });
  }

  if (logToggle) {
    logToggle.addEventListener("change", () => {
      logScale = logToggle.checked;
      renderChart();
    });
  }

  // Tab switching
  document.querySelectorAll(".cal-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeTab = (tab as HTMLElement).dataset.tab as "cost" | "params" | "overlay";
      document.querySelectorAll(".cal-tab").forEach((t) => {
        const el = t as HTMLElement;
        el.style.borderBottomColor = el.dataset.tab === activeTab ? "var(--vscode-focusBorder)" : "transparent";
        el.style.color =
          el.dataset.tab === activeTab ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)";
        el.classList.toggle("active", el.dataset.tab === activeTab);
      });
      renderChart();
    });
  });
}

// ── Message Handler ──

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "calibrationProgress") {
    const data = msg.data as ProgressPoint;
    progressHistory.push(data);
    setStatus(`Iteration ${data.iteration}: cost = ${data.cost.toExponential(4)}`);
    renderChart();
  } else if (msg.type === "calibrationResult") {
    isDark = msg.isDark ?? true;
    finalResult = msg.data as CalibrationResultData;
    setStatus(
      finalResult.success
        ? `Converged in ${finalResult.iterations} iterations. Residual: ${finalResult.residual.toExponential(4)}`
        : `Did not converge. Residual: ${finalResult.residual.toExponential(4)}`,
    );
    showResults();
    renderChart();
  } else if (msg.type === "calibrationError") {
    setStatus(`Error: ${msg.error}`);
  }
});

function setStatus(text: string): void {
  const el = document.getElementById("cal-status");
  if (el) el.textContent = text;
}

function showResults(): void {
  if (!finalResult) return;
  const section = document.getElementById("cal-results");
  const body = document.getElementById("cal-results-body");
  if (section) section.style.display = "block";
  if (body) {
    const params = finalResult.parameters;
    let html = `<div>Residual: <strong>${finalResult.residual.toExponential(4)}</strong></div>`;
    html += `<div>Iterations: <strong>${finalResult.iterations}</strong></div>`;
    html += `<div style="margin-top:4px;font-weight:600;">Optimal Parameters:</div>`;
    for (const [name, value] of Object.entries(params)) {
      html += `<div style="padding-left:8px;">${name} = ${value.toPrecision(6)}</div>`;
    }
    body.innerHTML = html;
  }
}

// ── Chart Rendering ──

function renderChart(): void {
  const canvas = document.getElementById("cal-canvas") as HTMLCanvasElement | null;
  const placeholder = document.getElementById("cal-placeholder");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const rect = canvas.parentElement?.getBoundingClientRect();
  if (!rect) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;

  const bg = isDark ? "#1e1e1e" : "#ffffff";
  const fg = isDark ? "#cccccc" : "#333333";
  const gridColor = isDark ? "#333333" : "#e0e0e0";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const margin = { top: 30, right: 20, bottom: 40, left: 60 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;

  if (plotW <= 0 || plotH <= 0) return;

  const hasData = progressHistory.length > 0 || finalResult !== null;
  if (placeholder) placeholder.style.display = hasData ? "none" : "flex";
  if (!hasData) return;

  if (activeTab === "cost") {
    renderCostChart(ctx, margin, plotW, plotH, fg, gridColor);
  } else if (activeTab === "params") {
    renderParamsChart(ctx, margin, plotW, plotH, fg, gridColor);
  } else if (activeTab === "overlay") {
    renderOverlayChart(ctx, margin, plotW, plotH, fg, gridColor);
  }
}

function renderCostChart(
  ctx: CanvasRenderingContext2D,
  margin: { top: number; right: number; bottom: number; left: number },
  plotW: number,
  plotH: number,
  fg: string,
  gridColor: string,
): void {
  const costData = finalResult?.costHistory ?? progressHistory.map((p) => p.cost);
  if (costData.length === 0) return;

  const values = costData.map((v) => {
    if (logScale) return v > 0 ? Math.log10(v) : Math.log10(1e-30);
    return v;
  });

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  // Grid
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 5; i++) {
    const y = margin.top + (plotH * i) / 5;
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + plotW, y);
    ctx.stroke();
  }

  // Axis labels
  ctx.fillStyle = fg;
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 5; i++) {
    const val = maxVal - (range * i) / 5;
    const y = margin.top + (plotH * i) / 5;
    ctx.fillText(val.toExponential(1), margin.left - 6, y + 3);
  }
  ctx.textAlign = "center";
  ctx.fillText(logScale ? "log₁₀(Cost)" : "Cost", margin.left + plotW / 2, margin.top - 10);

  // Plot line
  ctx.strokeStyle = "#4fc3f7";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < values.length; i++) {
    const x = margin.left + (i / Math.max(values.length - 1, 1)) * plotW;
    const y = margin.top + plotH - ((values[i] - minVal) / range) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // X axis label
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.fillText("Iteration", margin.left + plotW / 2, margin.top + plotH + 30);
}

function renderParamsChart(
  ctx: CanvasRenderingContext2D,
  margin: { top: number; right: number; bottom: number; left: number },
  plotW: number,
  plotH: number,
  fg: string,
  gridColor: string,
): void {
  if (progressHistory.length === 0) return;

  const paramNames = Object.keys(progressHistory[0].parameters);
  if (paramNames.length === 0) return;

  const colors = ["#4fc3f7", "#81c784", "#ffb74d", "#e57373", "#ba68c8", "#4db6ac"];

  // Collect all values to find range
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const pt of progressHistory) {
    for (const name of paramNames) {
      const v = pt.parameters[name] ?? 0;
      minVal = Math.min(minVal, v);
      maxVal = Math.max(maxVal, v);
    }
  }
  const range = maxVal - minVal || 1;

  // Grid
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 5; i++) {
    const y = margin.top + (plotH * i) / 5;
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + plotW, y);
    ctx.stroke();
  }

  // Plot each parameter
  for (let pi = 0; pi < paramNames.length; pi++) {
    const name = paramNames[pi];
    ctx.strokeStyle = colors[pi % colors.length];
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < progressHistory.length; i++) {
      const v = progressHistory[i].parameters[name] ?? 0;
      const x = margin.left + (i / Math.max(progressHistory.length - 1, 1)) * plotW;
      const y = margin.top + plotH - ((v - minVal) / range) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Legend
  ctx.font = "10px system-ui, sans-serif";
  for (let pi = 0; pi < paramNames.length; pi++) {
    const lx = margin.left + 10 + pi * 80;
    ctx.fillStyle = colors[pi % colors.length];
    ctx.fillRect(lx, margin.top + 5, 10, 3);
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.fillText(paramNames[pi], lx + 14, margin.top + 10);
  }
}

function renderOverlayChart(
  ctx: CanvasRenderingContext2D,
  margin: { top: number; right: number; bottom: number; left: number },
  plotW: number,
  plotH: number,
  fg: string,
  gridColor: string,
): void {
  if (!finalResult?.simulated) return;

  const { t, y, states } = finalResult.simulated;
  if (t.length === 0 || y.length === 0) return;

  // Find data range
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const row of y) {
    for (const v of row) {
      minVal = Math.min(minVal, v);
      maxVal = Math.max(maxVal, v);
    }
  }
  const range = maxVal - minVal || 1;
  const tMin = t[0] ?? 0;
  const tMax = t[t.length - 1] ?? 1;
  const tRange = tMax - tMin || 1;

  // Grid
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 5; i++) {
    const yPos = margin.top + (plotH * i) / 5;
    ctx.beginPath();
    ctx.moveTo(margin.left, yPos);
    ctx.lineTo(margin.left + plotW, yPos);
    ctx.stroke();
  }

  const colors = ["#4fc3f7", "#81c784", "#ffb74d", "#e57373"];

  // Plot simulated trajectories
  for (let si = 0; si < states.length && si < y[0].length; si++) {
    ctx.strokeStyle = colors[si % colors.length];
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < t.length; i++) {
      const x = margin.left + ((t[i] - tMin) / tRange) * plotW;
      const v = y[i]?.[si] ?? 0;
      const yPos = margin.top + plotH - ((v - minVal) / range) * plotH;
      if (i === 0) ctx.moveTo(x, yPos);
      else ctx.lineTo(x, yPos);
    }
    ctx.stroke();
  }

  // Legend
  ctx.font = "10px system-ui, sans-serif";
  for (let si = 0; si < states.length; si++) {
    const lx = margin.left + 10 + si * 100;
    ctx.fillStyle = colors[si % colors.length];
    ctx.fillRect(lx, margin.top + 5, 10, 3);
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.fillText(states[si], lx + 14, margin.top + 10);
  }

  // Axis labels
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.fillText("Time", margin.left + plotW / 2, margin.top + plotH + 30);
}

// Resize listener
window.addEventListener("resize", () => renderChart());

export {};
