// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Simulation results chart webview.
// Receives simulation data via postMessage and renders a time-series chart
// using Canvas2D with VS Code theme-aware colors.

interface SimulationData {
  t: number[];
  y: number[][];
  states: string[];
}

const COLORS = [
  "#0969da",
  "#2da44e",
  "#bf3989",
  "#db6d28",
  "#8250df",
  "#218bff",
  "#a371f7",
  "#3fb950",
  "#e34c26",
  "#f0883e",
  "#56d364",
  "#79c0ff",
  "#d2a8ff",
  "#ffa657",
];

let currentData: SimulationData | null = null;
let isDark = true;
const hiddenVars = new Set<string>();

/* eslint-disable @typescript-eslint/no-non-null-assertion */
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const legendEl = document.getElementById("legend")!;
const placeholderEl = document.getElementById("placeholder")!;
const tooltipEl = document.getElementById("tooltip")!;
const containerEl = document.getElementById("chart-container")!;
/* eslint-enable @typescript-eslint/no-non-null-assertion */

// Handle messages from extension
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "simulationData") {
    currentData = msg.data;
    isDark = msg.isDark;
    hiddenVars.clear();
    placeholderEl.style.display = "none";
    containerEl.style.display = "flex";
    buildLegend();
    draw();
  }
});

// Resize handling
const resizeObserver = new ResizeObserver(() => {
  if (currentData) draw();
});
resizeObserver.observe(canvas);

function buildLegend() {
  if (!currentData) return;
  legendEl.innerHTML = "";
  currentData.states.forEach((name, i) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.dataset.var = name;

    const swatch = document.createElement("div");
    swatch.className = "legend-swatch";
    swatch.style.background = COLORS[i % COLORS.length];

    const label = document.createElement("span");
    label.textContent = name;

    item.appendChild(swatch);
    item.appendChild(label);

    item.addEventListener("click", () => {
      if (hiddenVars.has(name)) {
        hiddenVars.delete(name);
        item.classList.remove("hidden");
      } else {
        hiddenVars.add(name);
        item.classList.add("hidden");
      }
      draw();
    });

    legendEl.appendChild(item);
  });
}

function draw() {
  if (!currentData || currentData.t.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;

  // Colors
  const fgColor = isDark ? "#ccc" : "#333";
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const axisColor = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";

  // Margins
  const margin = { top: 16, right: 24, bottom: 40, left: 64 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;

  if (plotW <= 0 || plotH <= 0) return;

  // Data ranges
  const { t, y, states } = currentData;
  const tMin = t[0];
  const tMax = t[t.length - 1];

  let yMin = Infinity;
  let yMax = -Infinity;
  for (let vi = 0; vi < states.length; vi++) {
    if (hiddenVars.has(states[vi])) continue;
    for (let i = 0; i < t.length; i++) {
      const v = y[i]?.[vi];
      if (v !== undefined && isFinite(v)) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
  }

  // Handle case where all vars are hidden or flat
  if (!isFinite(yMin) || !isFinite(yMax)) {
    yMin = 0;
    yMax = 1;
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }

  // Add 5% padding
  const yPad = (yMax - yMin) * 0.05;
  yMin -= yPad;
  yMax += yPad;

  // Coordinate transform
  const xScale = (v: number) => margin.left + ((v - tMin) / (tMax - tMin)) * plotW;
  const yScale = (v: number) => margin.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // Clear
  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  const xTicks = niceTicksFor(tMin, tMax, 8);
  const yTicks = niceTicksFor(yMin, yMax, 6);

  ctx.beginPath();
  for (const xt of xTicks) {
    const x = xScale(xt);
    ctx.moveTo(x, margin.top);
    ctx.lineTo(x, margin.top + plotH);
  }
  for (const yt of yTicks) {
    const yy = yScale(yt);
    ctx.moveTo(margin.left, yy);
    ctx.lineTo(margin.left + plotW, yy);
  }
  ctx.stroke();

  // Axes
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top + plotH);
  ctx.stroke();

  // Tick labels
  ctx.fillStyle = fgColor;
  ctx.font = "11px var(--vscode-editor-font-family, monospace)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const xt of xTicks) {
    ctx.fillText(formatTick(xt), xScale(xt), margin.top + plotH + 6);
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const yt of yTicks) {
    ctx.fillText(formatTick(yt), margin.left - 6, yScale(yt));
  }

  // X axis label
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "12px var(--vscode-font-family, sans-serif)";
  ctx.fillText("Time (s)", margin.left + plotW / 2, margin.top + plotH + 24);

  // Clip to plot area
  ctx.save();
  ctx.beginPath();
  ctx.rect(margin.left, margin.top, plotW, plotH);
  ctx.clip();

  // Draw lines
  for (let vi = 0; vi < states.length; vi++) {
    if (hiddenVars.has(states[vi])) continue;

    ctx.strokeStyle = COLORS[vi % COLORS.length];
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();

    let started = false;
    for (let i = 0; i < t.length; i++) {
      const val = y[i]?.[vi];
      if (val === undefined || !isFinite(val)) continue;
      const px = xScale(t[i]);
      const py = yScale(val);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  }

  ctx.restore();
}

// Tooltip on mousemove
canvas.addEventListener("mousemove", (e) => {
  if (!currentData || currentData.t.length === 0) return;

  const rect = canvas.getBoundingClientRect();
  const margin = { top: 16, right: 24, bottom: 40, left: 64 };
  const plotW = rect.width - margin.left - margin.right;
  const plotH = rect.height - margin.top - margin.bottom;
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (mx < margin.left || mx > margin.left + plotW || my < margin.top || my > margin.top + plotH) {
    tooltipEl.style.display = "none";
    return;
  }

  const { t, y, states } = currentData;
  const tMin = t[0];
  const tMax = t[t.length - 1];
  const tVal = tMin + ((mx - margin.left) / plotW) * (tMax - tMin);

  // Find nearest time index
  let closest = 0;
  let minDist = Infinity;
  for (let i = 0; i < t.length; i++) {
    const d = Math.abs(t[i] - tVal);
    if (d < minDist) {
      minDist = d;
      closest = i;
    }
  }

  let html = `<div style="margin-bottom:4px;font-weight:600">t = ${t[closest].toFixed(4)}s</div>`;
  for (let vi = 0; vi < states.length; vi++) {
    if (hiddenVars.has(states[vi])) continue;
    const val = y[closest]?.[vi];
    const color = COLORS[vi % COLORS.length];
    html += `<div><span style="color:${color}">●</span> ${states[vi]}: ${val !== undefined ? val.toFixed(6) : "N/A"}</div>`;
  }

  tooltipEl.innerHTML = html;
  tooltipEl.style.display = "block";

  // Position tooltip
  let tx = e.clientX - rect.left + 12;
  let ty = e.clientY - rect.top - 12;
  const tw = tooltipEl.offsetWidth;
  const th = tooltipEl.offsetHeight;
  if (tx + tw > rect.width - 8) tx = e.clientX - rect.left - tw - 12;
  if (ty + th > rect.height - 8) ty = e.clientY - rect.top - th - 12;
  tooltipEl.style.left = tx + "px";
  tooltipEl.style.top = ty + "px";
});

canvas.addEventListener("mouseleave", () => {
  tooltipEl.style.display = "none";
});

// Utility: nice tick values
function niceTicksFor(min: number, max: number, targetCount: number): number[] {
  const range = max - min;
  if (range <= 0) return [min];
  const rawStep = range / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / mag;

  let niceStep: number;
  if (normalized <= 1.5) niceStep = 1;
  else if (normalized <= 3) niceStep = 2;
  else if (normalized <= 7) niceStep = 5;
  else niceStep = 10;
  niceStep *= mag;

  const ticks: number[] = [];
  const start = Math.ceil(min / niceStep) * niceStep;
  for (let v = start; v <= max + niceStep * 0.01; v += niceStep) {
    ticks.push(v);
  }
  return ticks;
}

function formatTick(v: number): string {
  if (Math.abs(v) < 1e-10) return "0";
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) {
    return v.toExponential(1);
  }
  // Remove trailing zeros
  return parseFloat(v.toPrecision(4)).toString();
}
