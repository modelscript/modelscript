// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Simulation results chart webview.
// Receives simulation data via postMessage and renders a time-series chart
// using Canvas2D with VS Code theme-aware colors.
//
// Supports two modes:
// 1. Batch mode: static data from a completed simulation
// 2. Live mode: streaming data from MQTT broker via WebSocket

import { lttbDecimate } from "../utils/lttb.js";

interface SimulationData {
  t: number[];
  y: number[][];
  states: string[];
  sweepResults?: { value: number; y: number[][] }[];
}

/** Per-variable statistics from Monte Carlo analysis */
interface MCVariableStats {
  mean: number[];
  stddev: number[];
  ciLo: number[];
  ciHi: number[];
  percentiles: Record<string, number[]>;
}

interface MonteCarloData {
  t: number[];
  statistics: Record<string, MCVariableStats>;
  numSamples: number;
  convergence: { coeffOfVariation: number; effectiveSampleSize: number };
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
let currentMCData: MonteCarloData | null = null;
let isDark = true;
const hiddenVars = new Set<string>();
const seenVars = new Set<string>();

/** Verification limit line overlay */
interface VerificationLimit {
  /** The variable name this limit applies to (e.g., "T") */
  variable: string;
  /** The y-value of the horizontal limit line */
  value: number;
  /** Human-readable label (e.g., "max: 85.0 °C") */
  label: string;
  /** Whether the constraint was violated */
  violated: boolean;
}
let currentLimits: VerificationLimit[] = [];

// ── Live mode state ──
let isLiveMode = false;
let livePaused = false;
let liveWs: WebSocket | null = null;
const RING_BUFFER_SIZE = 500;

/** Ring buffer per variable for live mode */
interface LiveBuffer {
  times: number[];
  values: Map<string, number[]>; // variable name → value ring buffer
  head: number; // next write position
  count: number; // current count (up to RING_BUFFER_SIZE)
  variableNames: string[];
}

let liveBuffer: LiveBuffer | null = null;
let animFrameId: number | null = null;

/* eslint-disable @typescript-eslint/no-non-null-assertion */
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const treeViewEl = document.getElementById("tree-view")!;
const placeholderEl = document.getElementById("placeholder")!;
const tooltipEl = document.getElementById("tooltip")!;
const containerEl = document.getElementById("chart-container")!;
const toolbarEl = document.getElementById("toolbar")!;
const liveStatusEl = document.getElementById("live-status")!;
const liveStatusTextEl = document.getElementById("live-status-text")!;
const btnPause = document.getElementById("btn-pause")!;
const btnClear = document.getElementById("btn-clear")!;
const btn3dAnimation = document.getElementById("btn-3d-animation")!;
const btnResetView = document.getElementById("btn-reset-view")!;
const checkboxSmooth = document.getElementById("checkbox-smooth") as HTMLInputElement;
const selectXAxis = document.getElementById("select-xaxis") as HTMLSelectElement | null;
const checkboxNormalize = document.getElementById("checkbox-normalize") as HTMLInputElement | null;
const checkboxDualY = document.getElementById("checkbox-dual-y") as HTMLInputElement | null;
const btnExportCsv = document.getElementById("btn-export-csv");
const btnExportPng = document.getElementById("btn-export-png");
const btnCopyCsv = document.getElementById("btn-copy-csv");
const btnToggleCursors = document.getElementById("btn-toggle-cursors");
const btnPinRun = document.getElementById("btn-pin-run");
const cursorHudEl = document.getElementById("cursor-hud");

let isNormalized = false;
let isDualY = false;
let selectedXVar = "__time__";
let cursorsEnabled = false;
let cursorA: number | null = null;
let cursorB: number | null = null;
let draggingCursor: "A" | "B" | null = null;
let pinnedRun: SimulationData | null = null;

function escapeHtmlSim(unsafe: string): string {
  if (!unsafe) return "";
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const vscodeApi = (window as typeof window & { acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void } })
  .acquireVsCodeApi
  ? (window as typeof window & { acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void } }).acquireVsCodeApi!()
  : null;

// Settings & Parameters DOM elements
const paramsSection = document.getElementById("params-section")!;
const settingsSection = document.getElementById("settings-section")!;
const parametersView = document.getElementById("parameters-view")!;
const btnSimulate = document.getElementById("btn-simulate")!;
const tStartInput = document.getElementById("st-start") as HTMLInputElement;
const tStopInput = document.getElementById("st-stop") as HTMLInputElement;
const intervalInput = document.getElementById("st-interval") as HTMLInputElement;
const toleranceInput = document.getElementById("st-tolerance") as HTMLInputElement;

// Upgraded Settings & Solver elements
const stPreset = document.getElementById("st-preset") as HTMLSelectElement | null;
const stSolver = document.getElementById("st-solver") as HTMLSelectElement | null;
const stRtol = document.getElementById("st-rtol") as HTMLInputElement | null;
const stAtol = document.getElementById("st-atol") as HTMLInputElement | null;
const stMaxStep = document.getElementById("st-max-step") as HTMLInputElement | null;
const stIntervals = document.getElementById("st-intervals") as HTMLInputElement | null;
const stSteadyState = document.getElementById("st-steady-state") as HTMLInputElement | null;
const simTelemetryEl = document.getElementById("sim-telemetry");

// Variable search & bulk actions
const varSearchInput = document.getElementById("var-search") as HTMLInputElement | null;
const btnClearVarSearch = document.getElementById("btn-clear-var-search");
const btnVarsAll = document.getElementById("btn-vars-all");
const btnVarsNone = document.getElementById("btn-vars-none");
const btnVarsInvert = document.getElementById("btn-vars-invert");
const btnVarsStates = document.getElementById("btn-vars-states");
const varCountBadge = document.getElementById("var-count-badge");

// Parameter search & reset
const paramSearchInput = document.getElementById("param-search") as HTMLInputElement | null;
const btnClearParamSearch = document.getElementById("btn-clear-param-search");
const btnResetAllParams = document.getElementById("btn-reset-all-params");
const paramModifiedBadge = document.getElementById("param-modified-badge");

let currentParameters: Record<string, HTMLInputElement> = {};
const defaultParameters = new Map<string, number>();
const customRightVars = new Set<string>();
/* eslint-enable @typescript-eslint/no-non-null-assertion */

let currentInterpolation = "smooth";
checkboxSmooth?.addEventListener("change", (e) => {
  currentInterpolation = (e.target as HTMLInputElement).checked ? "smooth" : "linear";
  if (isLiveMode) {
    drawLive();
  } else {
    draw();
  }
});

// Setup accordion toggles for sidebar sections
document.querySelectorAll(".sidebar-header").forEach((header) => {
  header.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".header-actions")) return;
    header.parentElement?.classList.toggle("collapsed");
  });
});

// ── Viewport Panning & Zooming ──
let customBounds: { tMin: number; tMax: number; yMin: number; yMax: number } | null = null;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let baseBounds: { tMin: number; tMax: number; yMin: number; yMax: number } | null = null;
let hoverIndex: number | null = null;

function getPlotMargin(): { top: number; right: number; bottom: number; left: number } {
  const isDualActive = isDualY && !isNormalized;
  const activeVars = currentData ? currentData.states.filter((s) => !hiddenVars.has(s)) : [];
  const rightVarsCount = isDualActive && activeVars.length >= 2 ? activeVars.length - 1 : 0;
  return {
    top: 16,
    right: rightVarsCount > 0 ? 64 : 24,
    bottom: 40,
    left: 64,
  };
}

function calculateDefaultBounds(): { tMin: number; tMax: number; yMin: number; yMax: number } | null {
  if (isLiveMode && liveBuffer && liveBuffer.count > 0) {
    const times = liveBuffer.times;
    const tMin = times[0];
    const tMax = times[times.length - 1];
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const [name, vals] of liveBuffer.values) {
      if (hiddenVars.has(name)) continue;
      for (const v of vals) {
        if (isFinite(v)) {
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
    }
    if (!isFinite(yMin) || !isFinite(yMax)) {
      yMin = 0;
      yMax = 1;
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const yPad = (yMax - yMin) * 0.05;
    return { tMin, tMax, yMin: yMin - yPad, yMax: yMax + yPad };
  } else if (!isLiveMode && currentData && currentData.t.length > 0) {
    const { t, y, states, sweepResults } = currentData;
    let tMin = t[0];
    let tMax = t[t.length - 1];

    const xVarIdx = selectedXVar !== "__time__" ? states.indexOf(selectedXVar) : -1;
    if (xVarIdx >= 0) {
      tMin = Infinity;
      tMax = -Infinity;
      for (let i = 0; i < t.length; i++) {
        const xv = y[i]?.[xVarIdx];
        if (xv !== undefined && isFinite(xv)) {
          if (xv < tMin) tMin = xv;
          if (xv > tMax) tMax = xv;
        }
      }
      if (!isFinite(tMin) || !isFinite(tMax)) {
        tMin = 0;
        tMax = 1;
      }
      if (tMin === tMax) {
        tMin -= 1;
        tMax += 1;
      }
      const xPad = (tMax - tMin) * 0.05;
      tMin -= xPad;
      tMax += xPad;
    }

    if (isNormalized) {
      return { tMin, tMax, yMin: -0.05, yMax: 1.05 };
    }

    let yMin = Infinity;
    let yMax = -Infinity;
    for (let vi = 0; vi < states.length; vi++) {
      if (hiddenVars.has(states[vi])) continue;
      for (let i = 0; i < t.length; i++) {
        if (sweepResults) {
          for (const sweepResult of sweepResults) {
            const v = sweepResult.y[i]?.[vi];
            if (v !== undefined && isFinite(v)) {
              if (v < yMin) yMin = v;
              if (v > yMax) yMax = v;
            }
          }
        } else {
          const v = y[i]?.[vi];
          if (v !== undefined && isFinite(v)) {
            if (v < yMin) yMin = v;
            if (v > yMax) yMax = v;
          }
        }
      }
    }
    // Include MC fan-chart extents in bounds
    if (currentMCData) {
      for (const state of states) {
        if (hiddenVars.has(state)) continue;
        const stats = currentMCData.statistics[state];
        if (!stats) continue;
        const loArr = stats.percentiles.p5 || stats.ciLo;
        const hiArr = stats.percentiles.p95 || stats.ciHi;
        if (loArr)
          for (const v of loArr) {
            if (isFinite(v) && v < yMin) yMin = v;
          }
        if (hiArr)
          for (const v of hiArr) {
            if (isFinite(v) && v > yMax) yMax = v;
          }
      }
    }
    if (!isFinite(yMin) || !isFinite(yMax)) {
      yMin = 0;
      yMax = 1;
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const yPad = (yMax - yMin) * 0.05;
    return { tMin, tMax, yMin: yMin - yPad, yMax: yMax + yPad };
  }
  return null;
}

// ── Toolbar buttons ──

btnPause?.addEventListener("click", () => {
  livePaused = !livePaused;
  if (btnPause) btnPause.textContent = livePaused ? "▶ Resume" : "⏸ Pause";
});

btnClear?.addEventListener("click", () => {
  if (liveBuffer) {
    liveBuffer.times = [];
    liveBuffer.values = new Map();
    for (const name of liveBuffer.variableNames) {
      liveBuffer.values.set(name, []);
    }
    liveBuffer.head = 0;
    liveBuffer.count = 0;
  }
});

btnResetView?.addEventListener("click", () => {
  customBounds = null;
  if (isLiveMode) drawLive();
  else draw();
});

btn3dAnimation?.addEventListener("click", () => {
  if (currentData && vscodeApi) {
    vscodeApi.postMessage({
      type: "open3dAnimation",
      payload: {
        simulationData: currentData,
      },
    });
  }
});

function exportCsv() {
  if (!currentData || currentData.t.length === 0) return;
  const { t, y, states } = currentData;
  const visibleIndices: number[] = [];
  for (let vi = 0; vi < states.length; vi++) {
    if (!hiddenVars.has(states[vi])) visibleIndices.push(vi);
  }
  const headers = ["time", ...visibleIndices.map((vi) => states[vi])];
  const rows: string[] = [headers.join(",")];
  for (let i = 0; i < t.length; i++) {
    const rowVals = [t[i].toString()];
    for (const vi of visibleIndices) {
      const val = y[i]?.[vi];
      rowVals.push(val !== undefined && isFinite(val) ? val.toString() : "");
    }
    rows.push(rowVals.join(","));
  }
  const csvContent = rows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `simulation_data_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportPng() {
  if (!currentData || currentData.t.length === 0) return;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const expCtx = exportCanvas.getContext("2d");
  if (!expCtx) return;
  expCtx.fillStyle = isDark ? "#1e1e1e" : "#ffffff";
  expCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  expCtx.drawImage(canvas, 0, 0);

  const dataUrl = exportCanvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `simulation_chart_${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function copyCsvToClipboard(btn: HTMLElement) {
  if (!currentData || currentData.t.length === 0) return;
  const { t, y, states } = currentData;
  const visibleIndices: number[] = [];
  for (let vi = 0; vi < states.length; vi++) {
    if (!hiddenVars.has(states[vi])) visibleIndices.push(vi);
  }
  const headers = ["time", ...visibleIndices.map((vi) => states[vi])];
  const rows: string[] = [headers.join("\t")];
  for (let i = 0; i < t.length; i++) {
    const rowVals = [t[i].toString()];
    for (const vi of visibleIndices) {
      const val = y[i]?.[vi];
      rowVals.push(val !== undefined && isFinite(val) ? val.toString() : "");
    }
    rows.push(rowVals.join("\t"));
  }
  const tsvContent = rows.join("\n");
  try {
    await navigator.clipboard.writeText(tsvContent);
    const orig = btn.textContent;
    btn.textContent = "✓ Copied!";
    setTimeout(() => {
      btn.textContent = orig;
    }, 1500);
  } catch (err) {
    console.error("Failed to copy data:", err);
  }
}

btnExportCsv?.addEventListener("click", () => {
  exportCsv();
});

btnExportPng?.addEventListener("click", () => {
  exportPng();
});

btnCopyCsv?.addEventListener("click", () => {
  if (btnCopyCsv) copyCsvToClipboard(btnCopyCsv);
});

btnToggleCursors?.addEventListener("click", () => {
  cursorsEnabled = !cursorsEnabled;
  if (cursorsEnabled) {
    const bounds = customBounds || calculateDefaultBounds() || { tMin: 0, tMax: 1, yMin: 0, yMax: 1 };
    const tSpan = bounds.tMax - bounds.tMin;
    if (cursorA === null || cursorB === null) {
      cursorA = bounds.tMin + 0.25 * tSpan;
      cursorB = bounds.tMin + 0.75 * tSpan;
    }
    btnToggleCursors.classList.add("active");
    btnToggleCursors.style.background = "var(--vscode-button-secondaryBackground, #3a3d41)";
    btnToggleCursors.style.borderColor = "#38bdf8";
  } else {
    btnToggleCursors.classList.remove("active");
    btnToggleCursors.style.background = "";
    btnToggleCursors.style.borderColor = "";
  }
  if (isLiveMode) drawLive();
  else draw();
});

btnPinRun?.addEventListener("click", () => {
  if (!pinnedRun && currentData) {
    pinnedRun = {
      t: [...currentData.t],
      y: currentData.y.map((row) => [...row]),
      states: [...currentData.states],
    };
    btnPinRun.textContent = "📍 Unpin";
    btnPinRun.classList.add("active");
    btnPinRun.style.background = "var(--vscode-button-secondaryBackground, #3a3d41)";
    btnPinRun.style.borderColor = "#f59e0b";
  } else {
    pinnedRun = null;
    btnPinRun.textContent = "📌 Pin Run";
    btnPinRun.classList.remove("active");
    btnPinRun.style.background = "";
    btnPinRun.style.borderColor = "";
  }
  if (isLiveMode) drawLive();
  else draw();
});

selectXAxis?.addEventListener("change", () => {
  if (selectXAxis) selectedXVar = selectXAxis.value;
  customBounds = null;
  draw();
});

checkboxNormalize?.addEventListener("change", () => {
  isNormalized = !!checkboxNormalize?.checked;
  if (isNormalized && checkboxDualY) {
    checkboxDualY.checked = false;
    isDualY = false;
  }
  customBounds = null;
  draw();
});

checkboxDualY?.addEventListener("change", () => {
  isDualY = !!checkboxDualY?.checked;
  if (isDualY && checkboxNormalize) {
    checkboxNormalize.checked = false;
    isNormalized = false;
  }
  customBounds = null;
  draw();
});

// Handle messages from extension
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "simulationData") {
    // Batch mode
    isLiveMode = false;
    currentData = msg.data;
    isDark = msg.isDark;

    const hadNoVisible = msg.data.states.every((state: string) => hiddenVars.has(state));
    msg.data.states.forEach((state: string, idx: number) => {
      if (!seenVars.has(state)) {
        seenVars.add(state);
        if (idx < 5) {
          hiddenVars.delete(state);
        } else {
          hiddenVars.add(state);
        }
      }
    });
    if (hadNoVisible && msg.data.states.length > 0) {
      for (let i = 0; i < Math.min(5, msg.data.states.length); i++) {
        hiddenVars.delete(msg.data.states[i]);
      }
    }

    placeholderEl.style.display = "none";
    containerEl.style.display = "flex";
    toolbarEl.classList.add("visible");
    toolbarEl.classList.remove("live-mode");
    stopLiveLoop();
    buildTreeView(msg.data.states);

    // Populate X-Axis selector for Phase Portrait
    if (selectXAxis && msg.data.states) {
      const currentVal = selectXAxis.value;
      selectXAxis.innerHTML = '<option value="__time__">Time (s)</option>';
      msg.data.states.forEach((s: string) => {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        selectXAxis.appendChild(opt);
      });
      if (msg.data.states.includes(currentVal)) {
        selectXAxis.value = currentVal;
      } else {
        selectXAxis.value = "__time__";
      }
      selectedXVar = selectXAxis.value;
    }

    // Detect Multi-Body simulation
    const isMultiBody = msg.data.states.some((s: string) => /\.frame_[ab]\.r_0\[1\]$/.test(s));
    if (isMultiBody) {
      btn3dAnimation.style.display = "inline-block";
    } else {
      btn3dAnimation.style.display = "none";
    }

    // Fill in Parameters with rich sliders, reset, and sweep controls
    if (msg.data.parameters && msg.data.parameters.length > 0) {
      paramsSection.style.display = "flex";
      parametersView.innerHTML = "";
      currentParameters = {};
      defaultParameters.clear();

      msg.data.parameters.forEach(
        (p: {
          name: string;
          description?: string;
          defaultValue: number;
          type: string;
          unit?: string;
          min?: number;
          max?: number;
        }) => {
          defaultParameters.set(p.name, p.defaultValue);
          const item = document.createElement("div");
          item.className = "param-item";
          item.setAttribute("data-param-name", p.name);

          // Header
          const header = document.createElement("div");
          header.className = "param-item-header";

          const label = document.createElement("div");
          label.className = "param-label";
          label.title = p.description || `${p.name} (default: ${p.defaultValue}${p.unit ? " " + p.unit : ""})`;

          const dot = document.createElement("span");
          dot.className = "param-dot";
          dot.style.display = "none";

          const nameSpan = document.createElement("span");
          nameSpan.textContent = p.name + (p.unit ? ` [${p.unit}]` : "");

          label.appendChild(dot);
          label.appendChild(nameSpan);

          const actions = document.createElement("div");
          actions.className = "param-actions";

          const resetBtn = document.createElement("button");
          resetBtn.className = "param-action-btn";
          resetBtn.textContent = "↺";
          resetBtn.title = `Reset ${p.name} to default (${p.defaultValue})`;

          const sweepBtn = document.createElement("button");
          sweepBtn.className = "param-action-btn";
          sweepBtn.textContent = "⚡";
          sweepBtn.title = `Configure parametric sweep for ${p.name}`;

          actions.appendChild(resetBtn);
          actions.appendChild(sweepBtn);
          header.appendChild(label);
          header.appendChild(actions);

          // Controls (Slider + Number Input)
          const controls = document.createElement("div");
          controls.className = "param-controls";

          const input = document.createElement("input");
          input.type = "number";
          input.step = "any";
          input.className = "param-input";
          input.value = typeof p.defaultValue === "number" ? p.defaultValue.toString() : "";

          // Calculate slider bounds
          let sMin = p.min !== undefined ? p.min : p.defaultValue !== 0 ? Math.min(0, p.defaultValue * 0.5) : -10;
          let sMax =
            p.max !== undefined
              ? p.max
              : p.defaultValue !== 0
                ? Math.max(p.defaultValue * 2, Math.abs(p.defaultValue) * 2)
                : 10;
          if (sMin === sMax) {
            sMin -= 1;
            sMax += 1;
          }

          const slider = document.createElement("input");
          slider.type = "range";
          slider.className = "param-slider";
          slider.min = sMin.toString();
          slider.max = sMax.toString();
          slider.step = ((sMax - sMin) / 100).toString();
          slider.value = p.defaultValue.toString();

          controls.appendChild(slider);
          controls.appendChild(input);

          // Sweep Drawer
          const sweepPanel = document.createElement("div");
          sweepPanel.className = "param-sweep-panel";
          sweepPanel.style.display = "none";

          const defVal = typeof p.defaultValue === "number" ? p.defaultValue : 1;
          const swStart = defVal * 0.8;
          const swEnd = defVal * 1.2;

          sweepPanel.innerHTML = `
            <div class="param-sweep-row">
              <label>Min</label>
              <input type="number" class="sweep-start" step="any" value="${swStart.toFixed(2)}">
              <label>Max</label>
              <input type="number" class="sweep-end" step="any" value="${swEnd.toFixed(2)}">
            </div>
            <div class="param-sweep-row">
              <label>Steps</label>
              <input type="number" class="sweep-steps" step="1" min="2" max="50" value="5">
              <button class="btn-run-sweep">Run Sweep</button>
            </div>
          `;

          const updateModifiedState = () => {
            const currentVal = parseFloat(input.value);
            const isMod = !isNaN(currentVal) && currentVal !== p.defaultValue;
            dot.style.display = isMod ? "inline-block" : "none";
            updateParamModifiedBadge();
          };

          slider.addEventListener("input", () => {
            input.value = slider.value;
            updateModifiedState();
          });

          input.addEventListener("input", () => {
            const val = parseFloat(input.value);
            if (!isNaN(val)) {
              if (val < parseFloat(slider.min)) slider.min = (val * 0.8).toString();
              if (val > parseFloat(slider.max)) slider.max = (val * 1.2).toString();
              slider.value = input.value;
            }
            updateModifiedState();
          });

          resetBtn.addEventListener("click", () => {
            input.value = p.defaultValue.toString();
            slider.value = p.defaultValue.toString();
            updateModifiedState();
          });

          sweepBtn.addEventListener("click", () => {
            const isHidden = sweepPanel.style.display === "none";
            sweepPanel.style.display = isHidden ? "flex" : "none";
            sweepBtn.style.color = isHidden ? "var(--vscode-button-background, #0e639c)" : "";
          });

          sweepPanel.querySelector(".btn-run-sweep")?.addEventListener("click", () => {
            const startVal = parseFloat((sweepPanel.querySelector(".sweep-start") as HTMLInputElement).value);
            const endVal = parseFloat((sweepPanel.querySelector(".sweep-end") as HTMLInputElement).value);
            const stepsVal = parseInt((sweepPanel.querySelector(".sweep-steps") as HTMLInputElement).value, 10) || 5;

            triggerSimulation({
              parameterName: p.name,
              start: isNaN(startVal) ? defVal * 0.8 : startVal,
              end: isNaN(endVal) ? defVal * 1.2 : endVal,
              steps: stepsVal,
            });
          });

          item.appendChild(header);
          item.appendChild(controls);
          item.appendChild(sweepPanel);
          parametersView.appendChild(item);
          currentParameters[p.name] = input;
        },
      );
      updateParamModifiedBadge();
    } else {
      paramsSection.style.display = "none";
    }

    // Fill in Experiment Settings
    settingsSection.style.display = "flex";
    const exp = msg.data.experiment || {};
    tStartInput.value = (exp.startTime ?? 0).toString();
    tStopInput.value = (exp.stopTime ?? 10).toString();
    intervalInput.value = (exp.interval ?? ((exp.stopTime ?? 10) - (exp.startTime ?? 0)) / 500).toString();
    toleranceInput.value = (exp.tolerance ?? 1e-4).toString();
    if (stRtol && !stRtol.value) stRtol.value = (exp.tolerance ?? 1e-4).toString();
    if (stAtol && !stAtol.value) stAtol.value = "1e-6";

    // Update telemetry display if available
    btnSimulate?.classList.remove("loading");
    if (msg.data.telemetry && simTelemetryEl) {
      simTelemetryEl.style.display = "block";
      simTelemetryEl.textContent = `✓ ${msg.data.telemetry.executionTimeMs}ms • ${msg.data.telemetry.stepCount} steps`;
    }

    updateVarCountBadge();

    currentMCData = null; // Clear old MC data on new simulation
    currentLimits = []; // Clear old verification limits

    draw();
    requestAnimationFrame(() => draw());
    setTimeout(() => draw(), 50);
  } else if (msg.type === "surrogateTrainingProgress") {
    const progressEl = document.getElementById("surrogate-progress");
    const progressBar = document.getElementById("surrogate-progress-bar");
    const statusText = document.getElementById("surrogate-status");
    const resultsEl = document.getElementById("surrogate-results");

    if (progressEl && progressBar && statusText && resultsEl) {
      progressEl.style.display = "block";
      resultsEl.style.display = "none";
      progressBar.style.width = `${msg.progress}%`;
      statusText.textContent = `${Math.round(msg.progress)}% - ${msg.message}`;
    }
  } else if (msg.type === "surrogateTrainingComplete") {
    const progressEl = document.getElementById("surrogate-progress");
    const resultsEl = document.getElementById("surrogate-results");
    const r2El = document.getElementById("surrogate-r2");
    const mseEl = document.getElementById("surrogate-mse");

    if (progressEl && resultsEl && r2El && mseEl) {
      progressEl.style.display = "none";
      resultsEl.style.display = "block";
      r2El.textContent = msg.metrics.r2.toFixed(4);
      mseEl.textContent = msg.metrics.trainMSE.toExponential(4);
    }
  } else if (msg.type === "surrogateTrainingError") {
    const progressEl = document.getElementById("surrogate-progress");
    const statusText = document.getElementById("surrogate-status");

    if (progressEl && statusText) {
      statusText.textContent = `Error: ${msg.error}`;
      const progressBar = document.getElementById("surrogate-progress-bar");
      if (progressBar) progressBar.style.background = "var(--vscode-testing-iconFailed)";
    }
  } else if (msg.type === "monteCarloData") {
    // Monte Carlo uncertainty results → fan chart
    isLiveMode = false;
    isDark = msg.isDark;
    const mc = msg.data;

    currentMCData = {
      t: mc.t,
      statistics: mc.statistics,
      numSamples: mc.numSamples,
      convergence: mc.convergence,
    };

    // Build simulation-like data using mean values
    const varNames = Object.keys(mc.statistics);
    const nT = mc.t.length;
    const yMatrix: number[][] = [];
    for (let i = 0; i < nT; i++) {
      const row: number[] = [];
      for (const name of varNames) {
        row.push(mc.statistics[name].mean[i] ?? 0);
      }
      yMatrix.push(row);
    }

    currentData = {
      t: mc.t,
      y: yMatrix,
      states: varNames,
    };

    const hadNoVisibleMC = varNames.every((state: string) => hiddenVars.has(state));
    varNames.forEach((state: string, idx: number) => {
      if (!seenVars.has(state)) {
        seenVars.add(state);
        if (idx < 5) {
          hiddenVars.delete(state);
        } else {
          hiddenVars.add(state);
        }
      }
    });
    if (hadNoVisibleMC && varNames.length > 0) {
      for (let i = 0; i < Math.min(5, varNames.length); i++) {
        hiddenVars.delete(varNames[i]);
      }
    }

    placeholderEl.style.display = "none";
    containerEl.style.display = "flex";
    toolbarEl.classList.add("visible");
    toolbarEl.classList.remove("live-mode");
    stopLiveLoop();
    buildTreeView(varNames);

    draw();
  } else if (msg.type === "liveMode") {
    // Live MQTT streaming mode
    isLiveMode = true;
    isDark = msg.isDark;
    currentData = null;

    placeholderEl.style.display = "none";
    containerEl.style.display = "flex";
    toolbarEl.classList.add("visible", "live-mode");
    connectMqttWs(
      msg.mqttWsUrl as string,
      msg.sessionId as string | undefined,
      msg.participantId as string | undefined,
    );
  } else if (msg.type === "liveLocalMode") {
    // Live mode via extension host postMessage (browser-local broker)
    isLiveMode = true;
    isDark = msg.isDark;
    currentData = null;

    placeholderEl.style.display = "none";
    containerEl.style.display = "flex";
    toolbarEl.classList.add("visible", "live-mode");
    setLiveStatus("connected", "Local mode");
    // Initialize empty live buffer (no WebSocket needed)
    liveBuffer = {
      times: [],
      values: new Map(),
      head: 0,
      count: 0,
      variableNames: [],
    };
    startLiveLoop();
  } else if (msg.type === "liveDataPoint") {
    // Data point from extension host (browser-local broker relay)
    if (isLiveMode && liveBuffer && !livePaused) {
      const variable = msg.variable as string;
      const time = msg.time as number;
      const value = msg.value as number;
      addLivePoint(variable, time, value);
    }
  } else if (msg.type === "verificationLimits") {
    // Verification limit lines from the extension host
    currentLimits = (msg.limits as VerificationLimit[]) || [];
    // Redraw to show/update limit lines
    if (currentData) draw();
    else if (isLiveMode && liveBuffer) drawLive();
  }
});

// Resize handling
const resizeObserver = new ResizeObserver(() => {
  if (currentData || (isLiveMode && liveBuffer)) draw();
});
resizeObserver.observe(containerEl); // Observe the chart container instead of canvas directly

function updateParamModifiedBadge() {
  if (!paramModifiedBadge) return;
  let modCount = 0;
  for (const [name, input] of Object.entries(currentParameters)) {
    const val = parseFloat(input.value);
    const def = defaultParameters.get(name);
    if (!isNaN(val) && def !== undefined && val !== def) {
      modCount++;
    }
  }
  if (modCount > 0) {
    paramModifiedBadge.style.display = "inline-block";
    paramModifiedBadge.textContent = `${modCount} modified`;
  } else {
    paramModifiedBadge.style.display = "none";
  }
}

function updateVarCountBadge() {
  if (!varCountBadge || !currentData) return;
  const total = currentData.states.length;
  const active = total - hiddenVars.size;
  varCountBadge.textContent = `${active}/${total}`;
}

function filterVariables(query: string) {
  const q = query.trim().toLowerCase();
  if (btnClearVarSearch) {
    btnClearVarSearch.style.display = q ? "block" : "none";
  }

  const nodes = treeViewEl.querySelectorAll("li.tree-node");
  if (!q) {
    nodes.forEach((n) => {
      (n as HTMLElement).style.display = "";
    });
    return;
  }

  nodes.forEach((n) => {
    const item = n.querySelector(":scope > .tree-item");
    const label = item?.querySelector(".tree-label")?.textContent?.toLowerCase() || "";
    const title = (item?.querySelector(".tree-label") as HTMLElement)?.title?.toLowerCase() || "";
    const isMatch = label.includes(q) || title.includes(q);

    if (!n.querySelector("ul.tree-children")) {
      (n as HTMLElement).style.display = isMatch ? "" : "none";
    }
  });

  nodes.forEach((n) => {
    const childrenUl = n.querySelector(":scope > ul.tree-children");
    if (childrenUl) {
      const visibleChildren = childrenUl.querySelectorAll("li.tree-node:not([style*='display: none'])");
      if (visibleChildren.length > 0) {
        (n as HTMLElement).style.display = "";
        childrenUl.classList.add("expanded");
        n.querySelector(":scope > .tree-item > .tree-caret")?.classList.add("expanded");
      } else {
        (n as HTMLElement).style.display = "none";
      }
    }
  });
}

function filterParameters(query: string) {
  const q = query.trim().toLowerCase();
  if (btnClearParamSearch) {
    btnClearParamSearch.style.display = q ? "block" : "none";
  }
  const items = parametersView.querySelectorAll(".param-item");
  items.forEach((item) => {
    const name = item.getAttribute("data-param-name")?.toLowerCase() || "";
    const label = item.querySelector(".param-label")?.textContent?.toLowerCase() || "";
    if (!q || name.includes(q) || label.includes(q)) {
      item.classList.remove("hidden");
    } else {
      item.classList.add("hidden");
    }
  });
}

// Preset handler
stPreset?.addEventListener("change", () => {
  const preset = stPreset.value;
  const start = parseFloat(tStartInput.value) || 0;
  const stop = parseFloat(tStopInput.value) || 10;
  const span = Math.max(0.001, stop - start);

  if (preset === "standard") {
    if (stSolver) stSolver.value = "dopri5";
    intervalInput.value = (span / 500).toString();
    toleranceInput.value = "1e-4";
    if (stRtol) stRtol.value = "1e-4";
    if (stAtol) stAtol.value = "1e-6";
    if (stSteadyState) stSteadyState.checked = false;
  } else if (preset === "fast") {
    if (stSolver) stSolver.value = "rk4";
    intervalInput.value = (span / 250).toString();
    toleranceInput.value = "1e-3";
    if (stRtol) stRtol.value = "1e-3";
    if (stAtol) stAtol.value = "1e-4";
    if (stSteadyState) stSteadyState.checked = false;
  } else if (preset === "high-accuracy") {
    if (stSolver) stSolver.value = "dopri5";
    intervalInput.value = (span / 2000).toString();
    toleranceInput.value = "1e-7";
    if (stRtol) stRtol.value = "1e-7";
    if (stAtol) stAtol.value = "1e-8";
    if (stSteadyState) stSteadyState.checked = false;
  } else if (preset === "stiff") {
    if (stSolver) stSolver.value = "cvode";
    intervalInput.value = (span / 500).toString();
    toleranceInput.value = "1e-5";
    if (stRtol) stRtol.value = "1e-5";
    if (stAtol) stAtol.value = "1e-7";
    if (stSteadyState) stSteadyState.checked = false;
  } else if (preset === "steady-state") {
    if (stSolver) stSolver.value = "dopri5";
    if (stSteadyState) stSteadyState.checked = true;
  }
});

// Variable filter & search listeners
varSearchInput?.addEventListener("input", (e) => {
  filterVariables((e.target as HTMLInputElement).value);
});
btnClearVarSearch?.addEventListener("click", () => {
  if (varSearchInput) varSearchInput.value = "";
  filterVariables("");
});

btnVarsAll?.addEventListener("click", () => {
  hiddenVars.clear();
  treeViewEl.querySelectorAll("input.tree-checkbox").forEach((cb) => {
    (cb as HTMLInputElement).checked = true;
  });
  updateVarCountBadge();
  customBounds = null;
  draw();
});

btnVarsNone?.addEventListener("click", () => {
  currentData?.states.forEach((s) => hiddenVars.add(s));
  treeViewEl.querySelectorAll("input.tree-checkbox").forEach((cb) => {
    (cb as HTMLInputElement).checked = false;
  });
  updateVarCountBadge();
  customBounds = null;
  draw();
});

btnVarsInvert?.addEventListener("click", () => {
  currentData?.states.forEach((s) => {
    if (hiddenVars.has(s)) hiddenVars.delete(s);
    else hiddenVars.add(s);
  });
  treeViewEl.querySelectorAll("input.tree-checkbox").forEach((cb) => {
    const li = cb.closest("li");
    const label = li?.querySelector(".tree-label") as HTMLElement | null;
    const name = label?.title || label?.textContent || "";
    if (name) (cb as HTMLInputElement).checked = !hiddenVars.has(name);
  });
  updateVarCountBadge();
  customBounds = null;
  draw();
});

btnVarsStates?.addEventListener("click", () => {
  hiddenVars.clear();
  currentData?.states.forEach((s) => {
    const isState = s.startsWith("der(") || s.includes("der");
    if (!isState) hiddenVars.add(s);
  });
  treeViewEl.querySelectorAll("input.tree-checkbox").forEach((cb) => {
    const li = cb.closest("li");
    const label = li?.querySelector(".tree-label") as HTMLElement | null;
    const name = label?.title || label?.textContent || "";
    if (name) (cb as HTMLInputElement).checked = !hiddenVars.has(name);
  });
  updateVarCountBadge();
  customBounds = null;
  draw();
});

// Parameter search & reset all listeners
paramSearchInput?.addEventListener("input", (e) => {
  filterParameters((e.target as HTMLInputElement).value);
});
btnClearParamSearch?.addEventListener("click", () => {
  if (paramSearchInput) paramSearchInput.value = "";
  filterParameters("");
});
btnResetAllParams?.addEventListener("click", () => {
  for (const [name, input] of Object.entries(currentParameters)) {
    const def = defaultParameters.get(name);
    if (def !== undefined) {
      input.value = def.toString();
      const item = input.closest(".param-item");
      const slider = item?.querySelector(".param-slider") as HTMLInputElement | null;
      if (slider) slider.value = def.toString();
      const dot = item?.querySelector(".param-dot") as HTMLElement | null;
      if (dot) dot.style.display = "none";
    }
  }
  updateParamModifiedBadge();
});

function triggerSimulation(sweepConfig?: { parameterName: string; start: number; end: number; steps: number }) {
  if (!vscodeApi) return;
  const parameterOverrides: Record<string, number> = {};
  for (const [name, input] of Object.entries(currentParameters)) {
    if (input.value !== "") {
      const val = parseFloat(input.value);
      const def = defaultParameters.get(name);
      if (!isNaN(val) && val !== def) {
        parameterOverrides[name] = val;
      }
    }
  }

  const solverVal = stSolver?.value || "dopri5";
  const rtolVal = stRtol?.value
    ? parseFloat(stRtol.value)
    : toleranceInput.value
      ? parseFloat(toleranceInput.value)
      : undefined;
  const atolVal = stAtol?.value ? parseFloat(stAtol.value) : undefined;
  const intervalsVal = stIntervals?.value ? parseInt(stIntervals.value, 10) : undefined;
  const maxStepVal = stMaxStep?.value ? parseFloat(stMaxStep.value) : undefined;
  const steadyStateVal = stSteadyState?.checked ?? false;

  btnSimulate.classList.add("loading");
  if (simTelemetryEl) {
    simTelemetryEl.style.display = "block";
    simTelemetryEl.textContent = "Simulating...";
  }

  vscodeApi.postMessage({
    type: "simulateRequest",
    payload: {
      startTime: tStartInput.value ? parseFloat(tStartInput.value) : undefined,
      stopTime: tStopInput.value ? parseFloat(tStopInput.value) : undefined,
      interval: intervalInput.value ? parseFloat(intervalInput.value) : undefined,
      tolerance: toleranceInput.value ? parseFloat(toleranceInput.value) : undefined,
      solver: solverVal,
      rtol: rtolVal,
      atol: atolVal,
      numberOfIntervals: intervalsVal,
      maxStep: maxStepVal,
      steadyStateOnly: steadyStateVal,
      parameterOverrides,
      sweepConfig,
    },
  });
}

btnSimulate?.addEventListener("click", () => {
  triggerSimulation();
});

// Keyboard shortcut (Ctrl+Enter / Cmd+Enter)
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    triggerSimulation();
  }
});

// Surrogate logic removed

// ── Chart Interaction Events ──

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (!currentData && (!isLiveMode || !liveBuffer)) return;

  const rect = canvas.getBoundingClientRect();
  const margin = getPlotMargin();
  const plotW = rect.width - margin.left - margin.right;
  const plotH = rect.height - margin.top - margin.bottom;

  let bounds = customBounds;
  if (!bounds) {
    bounds = calculateDefaultBounds();
    if (!bounds) return;
  }

  const x = e.clientX - rect.left - margin.left;
  const y = e.clientY - rect.top - margin.top;

  // Only zoom if hovering within plot rect
  if (x < 0 || x > plotW || y < 0 || y > plotH) return;

  const rx = x / plotW;
  const ry = 1 - y / plotH;

  const tRange = bounds.tMax - bounds.tMin;
  const yRange = bounds.yMax - bounds.yMin;

  const tPointer = bounds.tMin + rx * tRange;
  const yPointer = bounds.yMin + ry * yRange;

  const zoomFactor = Math.pow(1.001, e.deltaY);

  const newTRange = tRange * zoomFactor;
  const newYRange = yRange * zoomFactor;

  if (newTRange < 1e-12 || newYRange < 1e-12) return;

  customBounds = {
    tMin: tPointer - rx * newTRange,
    tMax: tPointer + (1 - rx) * newTRange,
    yMin: yPointer - ry * newYRange,
    yMax: yPointer + (1 - ry) * newYRange,
  };

  if (isLiveMode) drawLive();
  else draw();
});

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;

  const rect = canvas.getBoundingClientRect();
  const margin = getPlotMargin();
  const plotW = rect.width - margin.left - margin.right;
  const mx = e.clientX - rect.left;

  // Check if clicking near Cursor A or Cursor B
  if (cursorsEnabled && cursorA !== null && cursorB !== null && currentData && currentData.t.length > 0 && plotW > 0) {
    const bounds = customBounds || calculateDefaultBounds() || { tMin: 0, tMax: 1, yMin: 0, yMax: 1 };
    const { tMin, tMax } = bounds;
    const xScale = (v: number) => margin.left + ((v - tMin) / (tMax - tMin || 1)) * plotW;
    const xPosA = xScale(cursorA);
    const xPosB = xScale(cursorB);

    const distA = Math.abs(mx - xPosA);
    const distB = Math.abs(mx - xPosB);
    const hitThreshold = 14;

    if (distA <= hitThreshold && distA <= distB) {
      draggingCursor = "A";
      canvas.setPointerCapture(e.pointerId);
      return;
    } else if (distB <= hitThreshold) {
      draggingCursor = "B";
      canvas.setPointerCapture(e.pointerId);
      return;
    }
  }

  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;

  baseBounds = customBounds || calculateDefaultBounds();
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const margin = getPlotMargin();
  const plotW = rect.width - margin.left - margin.right;
  const plotH = rect.height - margin.top - margin.bottom;
  if (plotW <= 0 || plotH <= 0) return;

  if (draggingCursor) {
    const bounds = customBounds || calculateDefaultBounds() || { tMin: 0, tMax: 1, yMin: 0, yMax: 1 };
    const { tMin, tMax } = bounds;
    const mx = e.clientX - rect.left;
    const rx = Math.max(0, Math.min(1, (mx - margin.left) / plotW));
    const newVal = tMin + rx * (tMax - tMin);

    if (draggingCursor === "A") {
      cursorA = newVal;
    } else if (draggingCursor === "B") {
      cursorB = newVal;
    }
    if (isLiveMode) drawLive();
    else draw();
    return;
  }

  if (isDragging && baseBounds) {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    const tRange = baseBounds.tMax - baseBounds.tMin;
    const yRange = baseBounds.yMax - baseBounds.yMin;

    const dt = -(dx / plotW) * tRange;
    const dyScaled = (dy / plotH) * yRange;

    customBounds = {
      tMin: baseBounds.tMin + dt,
      tMax: baseBounds.tMax + dt,
      yMin: baseBounds.yMin + dyScaled,
      yMax: baseBounds.yMax + dyScaled,
    };

    if (isLiveMode) drawLive();
    else draw();
    return;
  }

  if (cursorsEnabled && cursorA !== null && cursorB !== null) {
    const bounds = customBounds || calculateDefaultBounds() || { tMin: 0, tMax: 1, yMin: 0, yMax: 1 };
    const { tMin, tMax } = bounds;
    const xScale = (v: number) => margin.left + ((v - tMin) / (tMax - tMin || 1)) * plotW;
    const mx = e.clientX - rect.left;
    const distA = Math.abs(mx - xScale(cursorA));
    const distB = Math.abs(mx - xScale(cursorB));
    if (distA <= 12 || distB <= 12) {
      canvas.style.cursor = "col-resize";
    } else {
      canvas.style.cursor = "crosshair";
    }
  }
});

canvas.addEventListener("pointerup", (e) => {
  if (draggingCursor) {
    draggingCursor = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (isLiveMode) drawLive();
    else draw();
    return;
  }
  isDragging = false;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch (_) {}
});
canvas.addEventListener("pointercancel", (e) => {
  if (draggingCursor) {
    draggingCursor = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (isLiveMode) drawLive();
    else draw();
    return;
  }
  isDragging = false;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch (_) {}
});

// ── Live mode: MQTT over WebSocket ──

function setLiveStatus(state: "disconnected" | "connecting" | "connected" | "error", text: string): void {
  liveStatusEl.className = `status-indicator ${state}`;
  liveStatusTextEl.textContent = text;
}

function connectMqttWs(wsUrl: string, sessionId?: string, participantId?: string): void {
  // Close existing connection
  if (liveWs) {
    liveWs.close();
    liveWs = null;
  }

  setLiveStatus("connecting", "Connecting…");

  // Initialize empty live buffer
  liveBuffer = {
    times: [],
    values: new Map(),
    head: 0,
    count: 0,
    variableNames: [],
  };

  // Connect via simple WebSocket — the MQTT broker exposes a WebSocket interface on port 9001
  // We use the raw MQTT protocol over WebSocket
  try {
    const ws = new WebSocket(wsUrl, "mqtt");
    ws.binaryType = "arraybuffer";
    liveWs = ws;

    ws.onopen = () => {
      setLiveStatus("connecting", "Authenticating…");
      // Send MQTT CONNECT packet
      sendMqttConnect(ws);
    };

    ws.onmessage = (event) => {
      handleMqttPacket(event.data as ArrayBuffer, sessionId, participantId);
    };

    ws.onerror = () => {
      setLiveStatus("error", "Connection error");
    };

    ws.onclose = () => {
      setLiveStatus("disconnected", "Disconnected");
      stopLiveLoop();
    };
  } catch (e) {
    setLiveStatus("error", `Failed: ${e}`);
  }
}

// ── Minimal MQTT Protocol Handling ──
// We implement just enough MQTT 3.1.1 protocol to CONNECT, SUBSCRIBE, and receive PUBLISH

function sendMqttConnect(ws: WebSocket): void {
  const clientId = `vscode-sim-${Math.random().toString(36).slice(2, 8)}`;
  const clientIdBytes = new TextEncoder().encode(clientId);

  // CONNECT packet
  const protocolName = new TextEncoder().encode("MQTT");
  const remainingLength =
    2 +
    protocolName.length + // protocol name (length-prefixed)
    1 + // protocol level (4 = 3.1.1)
    1 + // connect flags
    2 + // keep alive
    2 +
    clientIdBytes.length; // client ID (length-prefixed)

  const buf = new Uint8Array(2 + remainingLength);
  let pos = 0;

  // Fixed header: CONNECT (0x10)
  buf[pos++] = 0x10;
  buf[pos++] = remainingLength;

  // Protocol name
  buf[pos++] = 0;
  buf[pos++] = protocolName.length;
  buf.set(protocolName, pos);
  pos += protocolName.length;

  // Protocol level: 4 (MQTT 3.1.1)
  buf[pos++] = 4;

  // Connect flags: Clean Session
  buf[pos++] = 0x02;

  // Keep alive: 60 seconds
  buf[pos++] = 0;
  buf[pos++] = 60;

  // Client ID
  buf[pos++] = (clientIdBytes.length >> 8) & 0xff;
  buf[pos++] = clientIdBytes.length & 0xff;
  buf.set(clientIdBytes, pos);

  ws.send(buf.buffer);
}

function sendMqttSubscribe(ws: WebSocket, topic: string): void {
  const topicBytes = new TextEncoder().encode(topic);
  const remainingLength = 2 + 2 + topicBytes.length + 1; // packet ID + topic + QoS

  const buf = new Uint8Array(2 + remainingLength);
  let pos = 0;

  // Fixed header: SUBSCRIBE (0x82)
  buf[pos++] = 0x82;
  buf[pos++] = remainingLength;

  // Packet Identifier
  buf[pos++] = 0;
  buf[pos++] = 1;

  // Topic filter
  buf[pos++] = (topicBytes.length >> 8) & 0xff;
  buf[pos++] = topicBytes.length & 0xff;
  buf.set(topicBytes, pos);
  pos += topicBytes.length;

  // QoS: 0
  buf[pos] = 0;

  ws.send(buf.buffer);
}

function handleMqttPacket(data: ArrayBuffer, sessionId?: string, participantId?: string): void {
  const view = new Uint8Array(data);
  if (view.length === 0) return;

  const packetType = (view[0] >> 4) & 0x0f;

  switch (packetType) {
    case 2: {
      // CONNACK
      setLiveStatus("connected", "Connected");

      // Subscribe to variable data topics
      if (liveWs) {
        if (sessionId && participantId) {
          // Subscribe to a specific participant
          sendMqttSubscribe(liveWs, `modelscript/site/+/area/+/line/${sessionId}/cell/${participantId}/data/#`);
        } else if (sessionId) {
          // Subscribe to all participants in a session
          sendMqttSubscribe(liveWs, `modelscript/site/+/area/+/line/${sessionId}/cell/+/data/#`);
        } else {
          // Subscribe to all data topics
          sendMqttSubscribe(liveWs, "modelscript/site/+/area/+/line/+/cell/+/data/#");
        }
      }

      // Start the animation loop
      startLiveLoop();
      break;
    }

    case 3: {
      // PUBLISH
      const buf = view;
      let pos = 1;

      // Decode remaining length
      let remaining = 0;
      let multiplier = 1;
      let byte: number;
      do {
        byte = buf[pos++];
        remaining += (byte & 0x7f) * multiplier;
        multiplier *= 128;
      } while (byte & 0x80);

      // Topic length
      const topicLen = (buf[pos] << 8) | buf[pos + 1];
      pos += 2;

      // Topic
      const topicBytes = buf.slice(pos, pos + topicLen);
      const topic = new TextDecoder().decode(topicBytes);
      pos += topicLen;

      // Payload
      const payloadBytes = buf.slice(pos, pos + remaining - 2 - topicLen);
      const payload = new TextDecoder().decode(payloadBytes);

      handleLiveData(topic, payload);
      break;
    }

    case 13: {
      // PINGRESP — send PINGREQ periodically
      break;
    }
  }
}

function handleLiveData(topic: string, payload: string): void {
  if (!liveBuffer) return;

  // Parse topic: .../cell/{participantId}/data/{variableName}
  const dataMatch = topic.match(/\/cell\/([^/]+)\/data\/(.+)$/);
  if (!dataMatch?.[1] || !dataMatch[2]) return;

  const participantId = dataMatch[1];
  const variableName = dataMatch[2];

  if (variableName === "_batch") {
    // Batched update — JSON object of { variable: value }
    try {
      const batch = JSON.parse(payload) as Record<string, number>;
      const now = performance.now() / 1000; // use browser time as x-axis
      for (const [name, value] of Object.entries(batch)) {
        const key = `${participantId}/${name}`;
        addLivePoint(key, now, value);
      }
    } catch {
      // Malformed batch
    }
  } else {
    const value = parseFloat(payload);
    if (!isNaN(value)) {
      const key = `${participantId}/${variableName}`;
      const now = performance.now() / 1000;
      addLivePoint(key, now, value);
    }
  }
}

function addLivePoint(variableKey: string, time: number, value: number): void {
  if (!liveBuffer) return;

  // Register new variable if needed
  if (!liveBuffer.values.has(variableKey)) {
    liveBuffer.variableNames.push(variableKey);
    liveBuffer.values.set(variableKey, []);
    if (!seenVars.has(variableKey)) {
      if (seenVars.size < 5) {
        hiddenVars.delete(variableKey);
      } else {
        hiddenVars.add(variableKey);
      }
      seenVars.add(variableKey);
    }
    // Rebuild tree
    buildTreeView(liveBuffer.variableNames);
  }

  // Add time point
  liveBuffer.times.push(time);

  // Add value to the variable's ring buffer
  const vals = liveBuffer.values.get(variableKey);
  if (!vals) return;
  vals.push(value);

  // Fill other variables with NaN at this time step (if they didn't publish)
  for (const [key, arr] of liveBuffer.values) {
    if (key !== variableKey && arr.length < liveBuffer.times.length) {
      arr.push(NaN);
    }
  }

  // Trim ring buffer
  while (liveBuffer.times.length > RING_BUFFER_SIZE) {
    liveBuffer.times.shift();
    for (const [, arr] of liveBuffer.values) {
      arr.shift();
    }
  }

  liveBuffer.count = liveBuffer.times.length;
}

// ── Live animation loop ──

function startLiveLoop(): void {
  if (animFrameId !== null) return;
  const loop = () => {
    if (!livePaused) drawLive();
    animFrameId = requestAnimationFrame(loop);
  };
  animFrameId = requestAnimationFrame(loop);
}

function stopLiveLoop(): void {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

// ── Tree View ──

interface TreeNode {
  name: string;
  fullName: string;
  children: Map<string, TreeNode>;
  isVariable: boolean;
  colorIndex?: number;
}

function buildTreeView(variables: string[]): void {
  const root: TreeNode = { name: "", fullName: "", children: new Map(), isVariable: false };

  variables.forEach((variable, i) => {
    const isDer = variable.startsWith("der(") && variable.endsWith(")");
    const innerVar = isDer ? variable.slice(4, -1) : variable;
    const originalParts = innerVar.split(".");

    let current = root;
    let prefix = "";

    for (let j = 0; j < originalParts.length; j++) {
      const isLeaf = j === originalParts.length - 1;
      const basePart = originalParts[j];

      const part = isLeaf && isDer ? `der(${basePart})` : basePart;
      prefix = prefix ? `${prefix}.${basePart}` : basePart;
      const fullName = isLeaf ? variable : prefix;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullName: fullName,
          children: new Map(),
          isVariable: isLeaf,
          colorIndex: isLeaf ? i : undefined,
        });
      }
      current = current.children.get(part) as TreeNode;
    }
  });

  treeViewEl.innerHTML = "";

  function renderNode(node: TreeNode, parentEl: HTMLElement) {
    const li = document.createElement("li");
    li.className = "tree-node";

    const item = document.createElement("div");
    item.className = "tree-item";

    const hasChildren = node.children.size > 0;
    const caret = document.createElement("span");
    caret.className = "tree-caret " + (hasChildren ? "expanded" : "empty");
    item.appendChild(caret);

    if (node.isVariable) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "tree-checkbox";
      checkbox.checked = !hiddenVars.has(node.fullName);

      const swatch = document.createElement("div");
      swatch.style.width = "10px";
      swatch.style.height = "10px";
      swatch.style.borderRadius = "2px";
      swatch.style.marginRight = "6px";
      if (node.colorIndex !== undefined) {
        swatch.style.background = COLORS[node.colorIndex % COLORS.length];
      }

      item.appendChild(checkbox);
      item.appendChild(swatch);

      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
        if (checkbox.checked) {
          hiddenVars.delete(node.fullName);
        } else {
          hiddenVars.add(node.fullName);
        }
        customBounds = null;
        if (isLiveMode) drawLive();
        else draw();
      });

      // Clicking the row toggles the checkbox
      item.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).tagName !== "INPUT") {
          checkbox.click();
        }
      });
    }

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = node.name;
    label.title = node.fullName;
    item.appendChild(label);

    if (node.isVariable && currentData) {
      const actions = document.createElement("div");
      actions.className = "tree-item-actions";

      // Show final value pill if available
      const vi = currentData.states.indexOf(node.fullName);
      if (vi >= 0 && currentData.y.length > 0) {
        const lastVal = currentData.y[currentData.y.length - 1]?.[vi];
        if (lastVal !== undefined && isFinite(lastVal)) {
          const stat = document.createElement("span");
          stat.className = "var-stat-pill";
          stat.textContent =
            Math.abs(lastVal) >= 1000 || (Math.abs(lastVal) < 0.01 && lastVal !== 0)
              ? lastVal.toExponential(2)
              : lastVal.toFixed(2);
          actions.appendChild(stat);
        }
      }

      // Axis routing pill (L / R)
      const axisPill = document.createElement("span");
      axisPill.className = "axis-pill" + (customRightVars.has(node.fullName) ? " right" : "");
      axisPill.textContent = customRightVars.has(node.fullName) ? "R" : "L";
      axisPill.title = "Toggle Primary (Left) or Secondary (Right) Y-Axis";
      axisPill.addEventListener("click", (e) => {
        e.stopPropagation();
        if (customRightVars.has(node.fullName)) {
          customRightVars.delete(node.fullName);
          axisPill.className = "axis-pill";
          axisPill.textContent = "L";
        } else {
          customRightVars.add(node.fullName);
          axisPill.className = "axis-pill right";
          axisPill.textContent = "R";
          if (!isDualY && checkboxDualY) {
            checkboxDualY.checked = true;
            isDualY = true;
            if (checkboxNormalize) {
              checkboxNormalize.checked = false;
              isNormalized = false;
            }
          }
        }
        customBounds = null;
        draw();
      });
      actions.appendChild(axisPill);
      item.appendChild(actions);
    }

    li.appendChild(item);

    if (hasChildren) {
      const childrenUl = document.createElement("ul");
      childrenUl.className = "tree-children expanded";

      item.addEventListener("click", (e) => {
        if (node.isVariable && (e.target as HTMLElement).tagName === "INPUT") return;
        const isExpanded = childrenUl.classList.contains("expanded");
        if (isExpanded) {
          childrenUl.classList.remove("expanded");
          caret.classList.remove("expanded");
        } else {
          childrenUl.classList.add("expanded");
          caret.classList.add("expanded");
        }
      });

      const childNodes = Array.from(node.children.values()).sort((a, b) => {
        if (a.children.size > 0 && b.children.size === 0) return -1;
        if (a.children.size === 0 && b.children.size > 0) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const child of childNodes) {
        renderNode(child, childrenUl);
      }
      li.appendChild(childrenUl);
    }

    parentEl.appendChild(li);
  }

  const sortedRoots = Array.from(root.children.values()).sort((a, b) => {
    if (a.children.size > 0 && b.children.size === 0) return -1;
    if (a.children.size === 0 && b.children.size > 0) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const child of sortedRoots) {
    renderNode(child, treeViewEl);
  }
}

// ── Live drawing ──

function drawLive(): void {
  if (!liveBuffer || liveBuffer.count === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;

  const fgColor = isDark ? "#ccc" : "#333";
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const axisColor = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";

  const margin = { top: 16, right: 24, bottom: 40, left: 64 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;

  if (plotW <= 0 || plotH <= 0) return;

  const times = liveBuffer.times;
  const bounds = customBounds || calculateDefaultBounds() || { tMin: 0, tMax: 1, yMin: 0, yMax: 1 };
  const { tMin, tMax, yMin, yMax } = bounds;

  const xScale = (v: number) => margin.left + ((v - tMin) / (tMax - tMin || 1)) * plotW;
  const yScale = (v: number) => margin.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  ctx.clearRect(0, 0, w, h);

  // Grid
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
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top + plotH);
  ctx.stroke();

  // Labels
  ctx.fillStyle = fgColor;
  ctx.font = "11px var(--vscode-editor-font-family, monospace)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const xt of xTicks) ctx.fillText(formatTick(xt), xScale(xt), margin.top + plotH + 6);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const yt of yTicks) ctx.fillText(formatTick(yt), margin.left - 6, yScale(yt));

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "12px var(--vscode-font-family, sans-serif)";
  ctx.fillText("Time (s)", margin.left + plotW / 2, margin.top + plotH + 24);

  // Clip
  ctx.save();
  ctx.beginPath();
  ctx.rect(margin.left, margin.top, plotW, plotH);
  ctx.clip();

  // Draw lines
  let vi = 0;
  for (const [name, vals] of liveBuffer.values) {
    if (hiddenVars.has(name)) {
      vi++;
      continue;
    }

    ctx.strokeStyle = COLORS[vi % COLORS.length];
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();

    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < vals.length; i++) {
      const val = vals[i];
      if (!isFinite(val)) continue;
      pts.push({ x: xScale(times[i]), y: yScale(val) });
    }

    if (currentInterpolation === "smooth") {
      drawSmoothSpline(ctx, pts);
    } else {
      let prevPy = 0;
      let started = false;
      for (const pt of pts) {
        if (!started) {
          ctx.moveTo(pt.x, pt.y);
          started = true;
        } else {
          if (currentInterpolation === "step-after") {
            ctx.lineTo(pt.x, prevPy);
          }
          ctx.lineTo(pt.x, pt.y);
        }
        prevPy = pt.y;
      }
    }
    ctx.stroke();
    vi++;
  }

  ctx.restore();
}

// ── Helpers ──

/** Convert a hex color like "#0969da" to "rgba(9, 105, 218, alpha)" */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawSmoothSpline(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) return;

  const tension = 0.25;
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];

    if (Math.abs(p2.x - p1.x) < 0.1) {
      ctx.lineTo(p2.x, p2.y);
      continue;
    }

    let p0 = i > 0 ? pts[i - 1] : p1;
    if (Math.abs(p1.x - p0.x) < 0.1) p0 = p1;

    let p3 = i < pts.length - 2 ? pts[i + 2] : p2;
    if (Math.abs(p3.x - p2.x) < 0.1) p3 = p2;

    const t1x = (p2.x - p0.x) * tension;
    const t1y = (p2.y - p0.y) * tension;
    const t2x = (p3.x - p1.x) * tension;
    const t2y = (p3.y - p1.y) * tension;

    ctx.bezierCurveTo(p1.x + t1x / 3, p1.y + t1y / 3, p2.x - t2x / 3, p2.y - t2y / 3, p2.x, p2.y);
  }
}

// ── Batch mode drawing ──

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
  const margin = getPlotMargin();
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;

  if (plotW <= 0 || plotH <= 0) return;

  // Data ranges
  const { t, y, states } = currentData;
  const isDualActive = isDualY && !isNormalized;
  const activeVars = states.filter((s) => !hiddenVars.has(s));
  const leftVars: string[] = [];
  const rightVars: string[] = [];
  if (isDualActive) {
    if (customRightVars.size > 0) {
      for (const s of activeVars) {
        if (customRightVars.has(s)) rightVars.push(s);
        else leftVars.push(s);
      }
      if (leftVars.length === 0 && rightVars.length > 0) {
        leftVars.push(rightVars.shift()!);
      }
    } else if (activeVars.length >= 2) {
      leftVars.push(activeVars[0]);
      for (let i = 1; i < activeVars.length; i++) {
        rightVars.push(activeVars[i]);
      }
    } else {
      leftVars.push(...activeVars);
    }
  } else {
    leftVars.push(...activeVars);
  }

  const bounds = customBounds || calculateDefaultBounds() || { tMin: 0, tMax: 1, yMin: 0, yMax: 1 };
  const { tMin, tMax, yMin, yMax } = bounds;

  let yMinLeft = yMin;
  let yMaxLeft = yMax;
  let yMinRight = yMin;
  let yMaxRight = yMax;

  if (isDualActive && rightVars.length > 0) {
    let rMin = Infinity;
    let rMax = -Infinity;
    let lMin = Infinity;
    let lMax = -Infinity;
    for (let i = 0; i < t.length; i++) {
      for (const rv of rightVars) {
        const vi = states.indexOf(rv);
        const val = y[i]?.[vi];
        if (val !== undefined && isFinite(val)) {
          if (val < rMin) rMin = val;
          if (val > rMax) rMax = val;
        }
      }
      for (const lv of leftVars) {
        const vi = states.indexOf(lv);
        const val = y[i]?.[vi];
        if (val !== undefined && isFinite(val)) {
          if (val < lMin) lMin = val;
          if (val > lMax) lMax = val;
        }
      }
    }
    if (isFinite(lMin) && isFinite(lMax)) {
      if (lMin === lMax) {
        lMin -= 1;
        lMax += 1;
      }
      const pad = (lMax - lMin) * 0.05;
      yMinLeft = lMin - pad;
      yMaxLeft = lMax + pad;
    }
    if (isFinite(rMin) && isFinite(rMax)) {
      if (rMin === rMax) {
        rMin -= 1;
        rMax += 1;
      }
      const pad = (rMax - rMin) * 0.05;
      yMinRight = rMin - pad;
      yMaxRight = rMax + pad;
    }
  }

  // Precompute normalization min/max per variable
  const varMinMax: { min: number; max: number }[] = [];
  if (isNormalized) {
    for (let vi = 0; vi < states.length; vi++) {
      let vMin = Infinity;
      let vMax = -Infinity;
      for (let i = 0; i < t.length; i++) {
        const val = y[i]?.[vi];
        if (val !== undefined && isFinite(val)) {
          if (val < vMin) vMin = val;
          if (val > vMax) vMax = val;
        }
      }
      if (!isFinite(vMin) || !isFinite(vMax)) {
        vMin = 0;
        vMax = 1;
      }
      if (vMin === vMax) {
        vMin -= 1;
        vMax += 1;
      }
      varMinMax.push({ min: vMin, max: vMax });
    }
  }

  // Coordinate transforms
  const xVarIdx = selectedXVar !== "__time__" ? states.indexOf(selectedXVar) : -1;
  const xScale = (v: number) => margin.left + ((v - tMin) / (tMax - tMin || 1)) * plotW;
  const yScaleLeft = (v: number) => margin.top + plotH - ((v - yMinLeft) / (yMaxLeft - yMinLeft || 1)) * plotH;
  const yScaleRight = (v: number) => margin.top + plotH - ((v - yMinRight) / (yMaxRight - yMinRight || 1)) * plotH;
  const yScaleNorm = (v: number) => margin.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const getPtX = (i: number) => {
    if (xVarIdx >= 0) {
      const xv = y[i]?.[xVarIdx];
      return xScale(xv !== undefined && isFinite(xv) ? xv : 0);
    }
    return xScale(t[i]);
  };

  const getPtY = (vi: number, val: number) => {
    if (isNormalized) {
      const mm = varMinMax[vi];
      const norm = mm ? (val - mm.min) / (mm.max - mm.min || 1) : 0;
      return yScaleNorm(norm);
    }
    if (isDualActive && rightVars.includes(states[vi])) {
      return yScaleRight(val);
    }
    return yScaleLeft(val);
  };

  // Clear
  ctx.clearRect(0, 0, w, h);

  const xTicks = niceTicksFor(tMin, tMax, 8);
  const yTicks = isNormalized ? [0, 0.25, 0.5, 0.75, 1.0] : niceTicksFor(yMinLeft, yMaxLeft, 6);

  // Standard Grid lines
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;

  ctx.beginPath();
  for (const xt of xTicks) {
    const x = xScale(xt);
    ctx.moveTo(x, margin.top);
    ctx.lineTo(x, margin.top + plotH);
  }
  for (const yt of yTicks) {
    const yy = isNormalized ? yScaleNorm(yt) : yScaleLeft(yt);
    ctx.moveTo(margin.left, yy);
    ctx.lineTo(margin.left + plotW, yy);
  }
  ctx.stroke();

  // Main Axes (Left and Bottom)
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top + plotH);
  ctx.stroke();

  // Tick labels (Bottom X)
  ctx.fillStyle = fgColor;
  ctx.font = "11px var(--vscode-editor-font-family, monospace)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const xt of xTicks) {
    ctx.fillText(formatTick(xt), xScale(xt), margin.top + plotH + 6);
  }

  // Tick labels (Left Y)
  const leftColor =
    isDualActive && leftVars.length === 1 ? COLORS[states.indexOf(leftVars[0]) % COLORS.length] : fgColor;
  ctx.fillStyle = leftColor;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const yt of yTicks) {
    const yy = isNormalized ? yScaleNorm(yt) : yScaleLeft(yt);
    const label = isNormalized ? `${Math.round(yt * 100)}%` : formatTick(yt);
    ctx.fillText(label, margin.left - 6, yy);
  }

  // Right Y Axis (Dual Mode)
  if (isDualActive && rightVars.length > 0) {
    const yTicksRight = niceTicksFor(yMinRight, yMaxRight, 6);
    const rightColor = rightVars.length === 1 ? COLORS[states.indexOf(rightVars[0]) % COLORS.length] : fgColor;

    ctx.strokeStyle = rightColor;
    ctx.beginPath();
    ctx.moveTo(margin.left + plotW, margin.top);
    ctx.lineTo(margin.left + plotW, margin.top + plotH);
    for (const yt of yTicksRight) {
      const yy = yScaleRight(yt);
      ctx.moveTo(margin.left + plotW, yy);
      ctx.lineTo(margin.left + plotW + 4, yy);
    }
    ctx.stroke();

    ctx.fillStyle = rightColor;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const yt of yTicksRight) {
      ctx.fillText(formatTick(yt), margin.left + plotW + 7, yScaleRight(yt));
    }

    if (rightVars.length === 1) {
      ctx.save();
      ctx.translate(margin.left + plotW + 50, margin.top + plotH / 2);
      ctx.rotate(Math.PI / 2);
      ctx.font = "11px var(--vscode-font-family, sans-serif)";
      ctx.textAlign = "center";
      ctx.fillText(rightVars[0], 0, 0);
      ctx.restore();
    }
  }

  // Left Y axis label
  ctx.fillStyle = leftColor;
  ctx.save();
  ctx.translate(14, margin.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = "11px var(--vscode-font-family, sans-serif)";
  ctx.textAlign = "center";
  if (isNormalized) {
    ctx.fillText("Normalized (0–100%)", 0, 0);
  } else if (isDualActive && leftVars.length === 1) {
    ctx.fillText(leftVars[0], 0, 0);
  }
  ctx.restore();

  // X axis label
  ctx.fillStyle = fgColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "12px var(--vscode-font-family, sans-serif)";
  ctx.fillText(xVarIdx >= 0 ? states[xVarIdx] : "Time (s)", margin.left + plotW / 2, margin.top + plotH + 24);

  // Clip to plot area
  ctx.save();
  ctx.beginPath();
  ctx.rect(margin.left, margin.top, plotW, plotH);
  ctx.clip();

  // ── Fan-chart bands (Monte Carlo percentile shading) ──
  if (currentMCData && currentMCData.t.length > 0) {
    const mcT = currentMCData.t;
    for (let vi = 0; vi < states.length; vi++) {
      if (hiddenVars.has(states[vi])) continue;
      const stats = currentMCData.statistics[states[vi]];
      if (!stats) continue;

      const color = COLORS[vi % COLORS.length];

      // Draw bands from widest (lightest) to narrowest (darkest)
      const bands: { lo: number[]; hi: number[]; alpha: number }[] = [];

      // Band 1: p5 to p95 (lightest)
      if (stats.percentiles.p5 && stats.percentiles.p95) {
        bands.push({ lo: stats.percentiles.p5, hi: stats.percentiles.p95, alpha: 0.1 });
      }
      // Band 2: p25 to p75
      if (stats.percentiles.p25 && stats.percentiles.p75) {
        bands.push({ lo: stats.percentiles.p25, hi: stats.percentiles.p75, alpha: 0.18 });
      }
      // Band 3: confidence interval (darkest shading)
      if (stats.ciLo && stats.ciHi) {
        bands.push({ lo: stats.ciLo, hi: stats.ciHi, alpha: 0.28 });
      }

      for (const band of bands) {
        ctx.fillStyle = hexToRgba(color, band.alpha);
        ctx.beginPath();
        // Upper boundary (left to right)
        let started = false;
        for (let i = 0; i < mcT.length; i++) {
          const hi = band.hi[i];
          if (hi === undefined || !isFinite(hi)) continue;
          const x = xScale(mcT[i]);
          const y = getPtY(vi, hi);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        // Lower boundary (right to left)
        for (let i = mcT.length - 1; i >= 0; i--) {
          const lo = band.lo[i];
          if (lo === undefined || !isFinite(lo)) continue;
          ctx.lineTo(xScale(mcT[i]), getPtY(vi, lo));
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // ── Pinned Run Baseline (Ghost Curves) ──
  if (pinnedRun && pinnedRun.t.length > 0) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.45;

    for (let vi = 0; vi < pinnedRun.states.length; vi++) {
      const sName = pinnedRun.states[vi];
      if (hiddenVars.has(sName)) continue;
      const curIdx = states.indexOf(sName);
      const color = COLORS[(curIdx >= 0 ? curIdx : vi) % COLORS.length];
      ctx.strokeStyle = color;
      ctx.beginPath();

      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < pinnedRun.t.length; i++) {
        const val = pinnedRun.y[i]?.[vi];
        if (val === undefined || !isFinite(val)) continue;
        const ptX = xVarIdx >= 0 ? xScale(pinnedRun.y[i]?.[xVarIdx] ?? 0) : xScale(pinnedRun.t[i]);
        const ptY = getPtY(curIdx >= 0 ? curIdx : vi, val);
        pts.push({ x: ptX, y: ptY });
      }

      const drawPts = pts.length > 2000 ? lttbDecimate(pts, 1500) : pts;
      if (currentInterpolation === "smooth") {
        drawSmoothSpline(ctx, drawPts);
      } else {
        let started = false;
        for (const pt of drawPts) {
          if (!started) {
            ctx.moveTo(pt.x, pt.y);
            started = true;
          } else {
            ctx.lineTo(pt.x, pt.y);
          }
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Draw lines
  const { sweepResults } = currentData;
  const sweepCount = sweepResults ? sweepResults.length : 1;
  for (let vi = 0; vi < states.length; vi++) {
    if (hiddenVars.has(states[vi])) continue;

    for (let si = 0; si < sweepCount; si++) {
      ctx.strokeStyle = COLORS[(vi * sweepCount + si) % COLORS.length];
      ctx.lineWidth = currentMCData ? 2.0 : 1.5;
      ctx.lineJoin = "round";
      ctx.beginPath();

      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < t.length; i++) {
        const val = sweepResults ? sweepResults[si].y[i]?.[vi] : y[i]?.[vi];
        if (val === undefined || !isFinite(val)) continue;
        pts.push({ x: getPtX(i), y: getPtY(vi, val) });
      }

      const drawPts = pts.length > 2000 ? lttbDecimate(pts, 1500) : pts;

      if (currentInterpolation === "smooth") {
        drawSmoothSpline(ctx, drawPts);
      } else {
        let prevPy = 0;
        let started = false;
        for (const pt of drawPts) {
          if (!started) {
            ctx.moveTo(pt.x, pt.y);
            started = true;
          } else {
            if (currentInterpolation === "step-after") {
              ctx.lineTo(pt.x, prevPy);
            }
            ctx.lineTo(pt.x, pt.y);
          }
          prevPy = pt.y;
        }
      }
      ctx.stroke();

      if (xVarIdx >= 0 && pts.length > 0) {
        // Start marker (green dot)
        ctx.fillStyle = "#3fb950";
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, 4, 0, Math.PI * 2);
        ctx.fill();

        // End marker (red square)
        const lastPt = pts[pts.length - 1];
        ctx.fillStyle = "#f85149";
        ctx.fillRect(lastPt.x - 3, lastPt.y - 3, 6, 6);
      }
    }
  }

  ctx.restore();

  // ── Verification limit lines ──
  if (currentLimits.length > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(margin.left, margin.top, plotW, plotH);
    ctx.clip();

    for (const limit of currentLimits) {
      const limitVi = states.indexOf(limit.variable);
      const ly = limitVi >= 0 ? getPtY(limitVi, limit.value) : yScaleLeft(limit.value);
      // Only draw if the line is within the visible plot area
      if (ly >= margin.top && ly <= margin.top + plotH) {
        // Dashed red line
        ctx.strokeStyle = limit.violated ? "#f14c4c" : "#3fb950";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(margin.left, ly);
        ctx.lineTo(margin.left + plotW, ly);
        ctx.stroke();
        ctx.setLineDash([]);

        // Shaded violation region (above the limit line for max constraints)
        if (limit.violated) {
          ctx.fillStyle = isDark ? "rgba(241, 76, 76, 0.06)" : "rgba(241, 76, 76, 0.08)";
          ctx.fillRect(margin.left, margin.top, plotW, ly - margin.top);
        }

        // Label at the right edge
        ctx.font = "bold 11px var(--vscode-editor-font-family, monospace)";
        ctx.fillStyle = limit.violated ? "#f14c4c" : "#3fb950";
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(limit.label, margin.left + plotW - 4, ly - 3);
      }
    }

    ctx.restore();
  }

  // Draw hover tracer
  if (hoverIndex !== null && hoverIndex < t.length) {
    const hx = getPtX(hoverIndex);

    // Vertical line
    ctx.strokeStyle = axisColor;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, margin.top);
    ctx.lineTo(hx, margin.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Circles
    for (let vi = 0; vi < states.length; vi++) {
      if (hiddenVars.has(states[vi])) continue;
      const val = y[hoverIndex]?.[vi];
      if (val === undefined || !isFinite(val)) continue;

      const hy = getPtY(vi, val);
      if (hy >= margin.top && hy <= margin.top + plotH) {
        ctx.fillStyle = isDark ? "#2d2d2d" : "#ffffff";
        ctx.strokeStyle = COLORS[vi % COLORS.length];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // ── Measurement Cursors (A & B) and HUD Calculation ──
  if (cursorsEnabled && cursorA !== null && cursorB !== null) {
    const xPosA = xScale(cursorA);
    const xPosB = xScale(cursorB);

    ctx.save();
    // 1. Shaded region between Cursor A and Cursor B
    const leftX = Math.max(margin.left, Math.min(xPosA, xPosB));
    const rightX = Math.min(margin.left + plotW, Math.max(xPosA, xPosB));
    if (rightX > leftX) {
      ctx.fillStyle = isDark ? "rgba(56, 189, 248, 0.08)" : "rgba(14, 165, 233, 0.09)";
      ctx.fillRect(leftX, margin.top, rightX - leftX, plotH);
    }

    // 2. Cursor A (Cyan #38bdf8)
    if (xPosA >= margin.left && xPosA <= margin.left + plotW) {
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(xPosA, margin.top);
      ctx.lineTo(xPosA, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Badge A at top
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(xPosA - 10, margin.top, 20, 16);
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("A", xPosA, margin.top + 8);
    }

    // 3. Cursor B (Amber #f59e0b)
    if (xPosB >= margin.left && xPosB <= margin.left + plotW) {
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(xPosB, margin.top);
      ctx.lineTo(xPosB, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Badge B at top
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(xPosB - 10, margin.top, 20, 16);
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("B", xPosB, margin.top + 8);
    }

    // 4. Horizontal delta span arrow/line between cursors
    if (Math.abs(xPosB - xPosA) > 28) {
      const spanY = margin.top + plotH - 18;
      ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xPosA, spanY);
      ctx.lineTo(xPosB, spanY);
      ctx.stroke();
      // Arrow ticks
      ctx.beginPath();
      ctx.moveTo(xPosA, spanY - 3);
      ctx.lineTo(xPosA, spanY + 3);
      ctx.moveTo(xPosB, spanY - 3);
      ctx.lineTo(xPosB, spanY + 3);
      ctx.stroke();
    }
    ctx.restore();

    // 5. Compute HUD values and update #cursor-hud
    if (cursorHudEl) {
      const dt = Math.abs(cursorB - cursorA);
      const freq = dt > 1e-9 ? 1 / dt : 0;

      // Find nearest indices in currentData
      const xVarIdx = selectedXVar !== "__time__" ? states.indexOf(selectedXVar) : -1;
      let idxA = 0;
      let minDA = Infinity;
      let idxB = 0;
      let minDB = Infinity;

      for (let i = 0; i < t.length; i++) {
        const xVal = xVarIdx >= 0 ? (y[i]?.[xVarIdx] ?? 0) : t[i];
        const dA = Math.abs(xVal - cursorA);
        if (dA < minDA) {
          minDA = dA;
          idxA = i;
        }
        const dB = Math.abs(xVal - cursorB);
        if (dB < minDB) {
          minDB = dB;
          idxB = i;
        }
      }

      // Primary visible variable
      const primaryVar = activeVars.length > 0 ? activeVars[0] : states[0] || "";
      const primaryVi = states.indexOf(primaryVar);
      const valA = primaryVi >= 0 ? y[idxA]?.[primaryVi] : undefined;
      const valB = primaryVi >= 0 ? y[idxB]?.[primaryVi] : undefined;
      const dy = valA !== undefined && valB !== undefined ? valB - valA : 0;
      const slope = dt > 1e-9 ? dy / dt : 0;
      const xLabel = xVarIdx >= 0 ? states[xVarIdx] : "t";

      cursorHudEl.innerHTML = `
        <div class="hud-metric">
          <span class="hud-label">Δ${escapeHtmlSim(xLabel)}</span>
          <span class="hud-value">${formatTick(dt)}${xVarIdx < 0 ? "s" : ""}</span>
        </div>
        ${
          xVarIdx < 0
            ? `
        <div class="hud-metric">
          <span class="hud-label">Freq (1/Δt)</span>
          <span class="hud-value">${formatTick(freq)} Hz</span>
        </div>`
            : ""
        }
        <div class="hud-metric">
          <span class="hud-label">${escapeHtmlSim(primaryVar)}(A)</span>
          <span class="hud-value" style="color:#38bdf8;">${valA !== undefined ? formatTick(valA) : "N/A"}</span>
        </div>
        <div class="hud-metric">
          <span class="hud-label">${escapeHtmlSim(primaryVar)}(B)</span>
          <span class="hud-value" style="color:#f59e0b;">${valB !== undefined ? formatTick(valB) : "N/A"}</span>
        </div>
        <div class="hud-metric">
          <span class="hud-label">Δ${escapeHtmlSim(primaryVar)}</span>
          <span class="hud-value">${formatTick(dy)}</span>
        </div>
        <div class="hud-metric">
          <span class="hud-label">Slope (Δy/Δx)</span>
          <span class="hud-value">${formatTick(slope)}</span>
        </div>
      `;
      cursorHudEl.classList.add("visible");
    }
  } else {
    if (cursorHudEl) {
      cursorHudEl.classList.remove("visible");
    }
  }
}

// Tooltip on mousemove
canvas.addEventListener("mousemove", (e) => {
  if (draggingCursor !== null) {
    tooltipEl.style.display = "none";
    return;
  }
  if (!currentData || currentData.t.length === 0) return;

  const rect = canvas.getBoundingClientRect();
  const margin = getPlotMargin();
  const plotW = rect.width - margin.left - margin.right;
  const plotH = rect.height - margin.top - margin.bottom;
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (mx < margin.left || mx > margin.left + plotW || my < margin.top || my > margin.top + plotH) {
    tooltipEl.style.display = "none";
    if (hoverIndex !== null) {
      hoverIndex = null;
      draw();
    }
    return;
  }

  const { t, y, states } = currentData;
  const bounds = customBounds || calculateDefaultBounds() || { tMin: t[0], tMax: t[t.length - 1], yMin: 0, yMax: 1 };
  const { tMin, tMax } = bounds;

  const xVarIdx = selectedXVar !== "__time__" ? states.indexOf(selectedXVar) : -1;
  const xValFromMouse = tMin + ((mx - margin.left) / plotW) * (tMax - tMin);

  // Find nearest index
  let closest = 0;
  let minDist = Infinity;
  for (let i = 0; i < t.length; i++) {
    const curX = xVarIdx >= 0 ? (y[i]?.[xVarIdx] ?? 0) : t[i];
    const d = Math.abs(curX - xValFromMouse);
    if (d < minDist) {
      minDist = d;
      closest = i;
    }
  }

  let html = "";
  if (xVarIdx >= 0) {
    const curXVal = y[closest]?.[xVarIdx];
    html = `<div style="margin-bottom:4px;font-weight:600">t = ${t[closest].toFixed(4)}s &nbsp;|&nbsp; ${escapeHtmlSim(states[xVarIdx])} = ${curXVal !== undefined ? curXVal.toFixed(4) : "N/A"}</div>`;
  } else {
    html = `<div style="margin-bottom:4px;font-weight:600">t = ${t[closest].toFixed(4)}s</div>`;
  }

  const { sweepResults } = currentData;
  const sweepCount = sweepResults ? sweepResults.length : 1;
  const isDualActive = isDualY && !isNormalized;
  const activeVars = states.filter((s) => !hiddenVars.has(s));
  const rightVars = isDualActive
    ? customRightVars.size > 0
      ? activeVars.filter((s) => customRightVars.has(s))
      : activeVars.length >= 2
        ? activeVars.slice(1)
        : []
    : [];

  for (let vi = 0; vi < states.length; vi++) {
    if (hiddenVars.has(states[vi])) continue;

    for (let si = 0; si < sweepCount; si++) {
      const val = sweepResults ? sweepResults[si].y[closest]?.[vi] : y[closest]?.[vi];
      const color = COLORS[(vi * sweepCount + si) % COLORS.length];
      const baseName = escapeHtmlSim(states[vi]);
      const safeName = sweepResults ? `${baseName} (${escapeHtmlSim(String(sweepResults[si].value))})` : baseName;

      let axisBadge = "";
      if (isDualActive) {
        axisBadge = rightVars.includes(states[vi])
          ? ' <span style="opacity:0.6;font-size:10px;">[Right]</span>'
          : ' <span style="opacity:0.6;font-size:10px;">[Left]</span>';
      }

      html += `<div><span style="color:${color}">●</span> ${safeName}${axisBadge}: ${val !== undefined ? val.toFixed(6) : "N/A"}`;

      // Add MC uncertainty info
      if (currentMCData && !sweepResults) {
        const stats = currentMCData.statistics[states[vi]];
        if (stats && stats.stddev[closest] !== undefined) {
          const sd = stats.stddev[closest];
          const ciLo = stats.ciLo[closest];
          const ciHi = stats.ciHi[closest];
          html += `<br><span style="opacity:0.7;font-size:11px;margin-left:16px">σ=${sd.toFixed(4)} CI=[${ciLo.toFixed(4)}, ${ciHi.toFixed(4)}]</span>`;
        }
      }
      html += `</div>`;
    }
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

  if (hoverIndex !== closest) {
    hoverIndex = closest;
    draw();
  }
});

canvas.addEventListener("mouseleave", () => {
  tooltipEl.style.display = "none";
  if (hoverIndex !== null) {
    hoverIndex = null;
    draw();
  }
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

if (vscodeApi) {
  vscodeApi.postMessage({ type: "ready" });
}

export { lttbDecimate };
