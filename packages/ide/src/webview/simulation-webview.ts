// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Simulation results chart webview.
// Receives simulation data via postMessage and renders a time-series chart
// using Canvas2D with VS Code theme-aware colors.
//
// Supports two modes:
// 1. Batch mode: static data from a completed simulation
// 2. Live mode: streaming data from MQTT broker via WebSocket

import {
  CanvasPlotController,
  simulationToDataset,
  type ChartViewMode,
  type IndexedDataset,
  type TrackConfig,
} from "@modelscript/simulate/charts";
import {
  mountSimulationReactPanels,
  type MountedSimulationReactPanels,
  type WaterComplianceReport,
} from "./simulation-results-webview.js";
import {
  buildHoverTooltipHtml,
  drawBatchOverlayChart,
  drawLiveChart,
} from "./simulation/simulation-canvas-renderer.js";
import {
  copySimulationTsvToClipboard,
  exportCanvasPng,
  exportSimulationComtrade,
  exportSimulationCsv,
  exportSimulationJson,
  exportSimulationParquet,
  exportSimulationPscadOut,
  exportSimulationPscadPsout,
} from "./simulation/simulation-export-utils.js";
import {
  buildLiveSubscriptionTopic,
  buildMqttConnectPacket,
  buildMqttSubscribePacket,
  decodeMqttPacket,
  parseLiveDataTopic,
} from "./simulation/simulation-mqtt-protocol.js";
import { calculateDefaultPlotBounds, lttbDecimate } from "./simulation/simulation-signal-utils.js";
import {
  applySolverPresetDom,
  buildVariableTreeDom,
  filterParametersDom,
  filterVariablesDom,
  populateAnalysisSelectorsDom,
  populateXAxisSelectorDom,
  renderParametersDom,
  renderRunChipsDom,
  renderStatsDrawerDom,
  syncSolverFromExperimentDom,
} from "./simulation/simulation-toolbar-dom.js";
import {
  getReachabilityProfileForVar as lookupReachabilityProfile,
  type LiveBuffer,
  type MonteCarloData,
  type PinnedRun,
  type ReachabilityData,
  type SimulationData,
  type VariableReachabilityProfile,
  type VerificationLimit,
} from "./simulation/simulation-types.js";

let currentData: SimulationData | null = null;
let currentMCData: MonteCarloData | null = null;
let currentReachabilityData: ReachabilityData | null = null;

function getReachabilityProfileForVar(varName: string): VariableReachabilityProfile | undefined {
  return lookupReachabilityProfile(currentReachabilityData, varName);
}

let isDark = true;
const hiddenVars = new Set<string>();
const seenVars = new Set<string>();
let currentLimits: VerificationLimit[] = [];

// ── Live mode state ──
let isLiveMode = false;
let livePaused = false;
let liveWs: WebSocket | null = null;
const RING_BUFFER_SIZE = 500;

let liveBuffer: LiveBuffer | null = null;
let animFrameId: number | null = null;

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
const btnExportJson = document.getElementById("btn-export-json");
const btnExportParquet = document.getElementById("btn-export-parquet");
const btnExportComtrade = document.getElementById("btn-export-comtrade");
const btnExportOut = document.getElementById("btn-export-out");
const btnExportPsout = document.getElementById("btn-export-psout");
const btnExportPng = document.getElementById("btn-export-png");
const btnCopyCsv = document.getElementById("btn-copy-csv");
const btnToggleCursors = document.getElementById("btn-toggle-cursors");
const btnPinRun = document.getElementById("btn-pin-run");
const btnCompareBaseline = document.getElementById("btn-compare-baseline");
const btnToggleStats = document.getElementById("btn-toggle-stats");
const statsDrawerEl = document.getElementById("stats-drawer");
const studioResultsContainerEl = document.getElementById("studio-results-container");
const phasorFftContainerEl = document.getElementById("phasor-fft-container");
const ieee2800ContainerEl = document.getElementById("ieee2800-container");
const cursorHudEl = document.getElementById("cursor-hud");
const viewModeGroupEl = document.getElementById("view-mode-group");
const overlayControlsEl = document.getElementById("overlay-controls");
const crossplotControlsEl = document.getElementById("crossplot-controls");
const histogramControlsEl = document.getElementById("histogram-controls");
const selectCpX = document.getElementById("select-cp-x") as HTMLSelectElement | null;
const selectCpY = document.getElementById("select-cp-y") as HTMLSelectElement | null;
const selectCpColor = document.getElementById("select-cp-color") as HTMLSelectElement | null;
const checkboxCpRegression = document.getElementById("checkbox-cp-regression") as HTMLInputElement | null;
const selectHistVar = document.getElementById("select-hist-var") as HTMLSelectElement | null;
const selectHistBins = document.getElementById("select-hist-bins") as HTMLSelectElement | null;

let isNormalized = false;
let isDualY = false;
let selectedXVar = "__time__";
let cursorsEnabled = false;
let showStatsDrawer = false;
let isComparingBaseline = false;
let reactPanels: MountedSimulationReactPanels | null = null;
let latestComplianceReport: unknown = undefined;
let latestWaterCompliance: WaterComplianceReport | undefined = undefined;
let cursorA: number | null = null;
let cursorB: number | null = null;
let draggingCursor: "A" | "B" | null = null;
let pinnedRuns: PinnedRun[] = [];
let pinnedRunSeq = 0;

let viewMode: ChartViewMode = "overlay";
const canvasPlotCtrl = new CanvasPlotController({ mode: "multitrack", isDark: true });
let cachedDataset: IndexedDataset | null = null;
let cachedDatasetSource: SimulationData | null = null;
let canvasDrag: { active: boolean; startX: number; startY: number; curX: number; curY: number } = {
  active: false,
  startX: 0,
  startY: 0,
  curX: 0,
  curY: 0,
};

function getSimDataset(): IndexedDataset | null {
  if (!currentData || currentData.t.length === 0) return null;
  if (cachedDatasetSource !== currentData || !cachedDataset) {
    cachedDataset = simulationToDataset({
      t: currentData.t,
      y: currentData.y,
      states: currentData.states,
      variableMetadata: currentData.variableMetadata,
      title: currentData.projectName,
    });
    cachedDatasetSource = currentData;
    canvasPlotCtrl.setDataset(cachedDataset);
  }
  return cachedDataset;
}

function buildActiveTracks(dataset: IndexedDataset): TrackConfig[] | undefined {
  const visible = dataset.series.filter((s) => !hiddenVars.has(s.name));
  const pool = visible.length > 0 ? visible : dataset.series.slice(0, 4);
  if (pool.length === 0) return undefined;
  const trackCount = Math.min(4, pool.length);
  const tracks: TrackConfig[] = Array.from({ length: trackCount }, (_, i) => ({
    id: `track_${i + 1}`,
    seriesNames: [],
  }));
  pool.forEach((s, idx) => {
    tracks[idx % trackCount]!.seriesNames.push(s.name);
  });
  return tracks;
}

function syncCanvasPlotConfig(): void {
  const ds = getSimDataset();
  const seriesNames = ds ? ds.series.map((s) => s.name) : [];
  const xVar = selectCpX?.value || seriesNames[0] || "time";
  const yVar = selectCpY?.value || seriesNames[1] || seriesNames[0] || "time";
  const colorVar = selectCpColor?.value || undefined;
  const histVar = selectHistVar?.value || seriesNames[0] || "";
  const bins = Math.max(5, Number(selectHistBins?.value ?? "30") || 30);

  canvasPlotCtrl.updateConfig({
    mode: viewMode,
    isDark,
    cursorMode: cursorsEnabled,
    tracks: ds ? buildActiveTracks(ds) : undefined,
    crossplot: {
      xSeries: xVar,
      ySeries: yVar,
      colorSeries: colorVar,
      showRegression: checkboxCpRegression?.checked ?? true,
    },
    histogram: {
      seriesName: histVar,
      binCount: bins,
    },
  });
}

function populateAnalysisSelectors(states: string[]): void {
  populateAnalysisSelectorsDom({ selectCpX, selectCpY, selectCpColor, selectHistVar }, states);
}

function setViewMode(mode: ChartViewMode): void {
  viewMode = mode;
  viewModeGroupEl?.querySelectorAll("button.mode-tab").forEach((btn) => {
    const active = btn.getAttribute("data-mode") === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  if (overlayControlsEl) overlayControlsEl.style.display = mode === "overlay" ? "" : "none";
  if (btnPinRun) btnPinRun.style.display = mode === "overlay" ? "" : "none";
  if (crossplotControlsEl) crossplotControlsEl.style.display = mode === "crossplot" ? "inline-flex" : "none";
  if (histogramControlsEl) histogramControlsEl.style.display = mode === "histogram" ? "inline-flex" : "none";
  if (cursorHudEl && mode !== "overlay") cursorHudEl.style.display = "none";
  tooltipEl.style.display = "none";
  syncCanvasPlotConfig();
  redrawChart();
}

viewModeGroupEl?.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement | null)?.closest("button.mode-tab");
  const mode = target?.getAttribute("data-mode") as ChartViewMode | null;
  if (mode) setViewMode(mode);
});

const simViewTabsEl = document.getElementById("sim-view-tabs");
simViewTabsEl?.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement | null)?.closest("button.sim-view-tab") as HTMLElement | null;
  const tabId = btn?.getAttribute("data-sim-tab");
  if (!tabId) return;
  simViewTabsEl.querySelectorAll("button.sim-view-tab").forEach((b) => {
    const active = b === btn;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".sim-tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `sim-tab-${tabId}`);
  });
  if (tabId === "waveforms") {
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }
});

[selectCpX, selectCpY, selectCpColor, checkboxCpRegression, selectHistVar, selectHistBins].forEach((el) => {
  el?.addEventListener("change", () => {
    syncCanvasPlotConfig();
    if (viewMode !== "overlay") redrawChart();
  });
});

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

let currentInterpolation = "smooth";
checkboxSmooth?.addEventListener("change", (e) => {
  currentInterpolation = (e.target as HTMLInputElement).checked ? "smooth" : "linear";
  if (isLiveMode) {
    drawLive();
  } else {
    draw();
  }
});

// ── Sidebar State Persistence & Accordion Toggles ──
const sidebarEl = document.getElementById("sidebar");
try {
  const savedWidth = localStorage.getItem("modelscript.sim_sidebar_width");
  if (savedWidth && sidebarEl) {
    sidebarEl.style.width = savedWidth;
  }
  const collapsed = JSON.parse(localStorage.getItem("modelscript.sim_sidebar_collapsed") || "[]");
  if (Array.isArray(collapsed)) {
    collapsed.forEach((id: string) => {
      document.getElementById(id)?.classList.add("collapsed");
    });
  }
} catch {
  // Ignore storage errors in sandboxed webview contexts
}

if (sidebarEl && typeof ResizeObserver !== "undefined") {
  let saveTimer: number | null = null;
  new ResizeObserver(() => {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        if (sidebarEl.style.width) {
          localStorage.setItem("modelscript.sim_sidebar_width", sidebarEl.style.width);
        }
      } catch {
        // Ignore storage errors in sandboxed webview contexts
      }
    }, 200);
  }).observe(sidebarEl);
}

// Setup accordion toggles for sidebar sections
document.querySelectorAll(".sidebar-header").forEach((header) => {
  header.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".header-actions")) return;
    const parent = header.parentElement;
    if (!parent) return;
    parent.classList.toggle("collapsed");
    try {
      const collapsedIds: string[] = [];
      document.querySelectorAll(".sidebar-section.collapsed").forEach((s) => {
        if (s.id) collapsedIds.push(s.id);
      });
      localStorage.setItem("modelscript.sim_sidebar_collapsed", JSON.stringify(collapsedIds));
    } catch {
      // Ignore storage errors in sandboxed webview contexts
    }
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
  return calculateDefaultPlotBounds({
    isLiveMode,
    liveBuffer,
    currentData,
    hiddenVars,
    selectedXVar,
    isNormalized,
    hasReachabilityData: currentReachabilityData !== null,
    getReachabilityProfileForVar,
    currentMCData,
  });
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
  canvasPlotCtrl.resetZoom();
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

btnExportCsv?.addEventListener("click", () => {
  exportSimulationCsv(currentData, hiddenVars);
});

btnExportJson?.addEventListener("click", () => {
  exportSimulationJson(currentData, hiddenVars, vscodeApi);
});

btnExportParquet?.addEventListener("click", () => {
  exportSimulationParquet(currentData, hiddenVars, vscodeApi);
});

btnExportComtrade?.addEventListener("click", () => {
  exportSimulationComtrade(currentData);
});

btnExportOut?.addEventListener("click", () => {
  exportSimulationPscadOut(currentData);
});

btnExportPsout?.addEventListener("click", () => {
  exportSimulationPscadPsout(currentData, vscodeApi);
});

btnExportPng?.addEventListener("click", () => {
  exportCanvasPng(currentData, canvas, isDark);
});

btnCopyCsv?.addEventListener("click", () => {
  if (btnCopyCsv) void copySimulationTsvToClipboard(currentData, hiddenVars, btnCopyCsv);
});

// Export dropdown menu
const exportMenuWrap = document.getElementById("export-menu-wrap");
const btnExportMenu = document.getElementById("btn-export-menu");
const setExportMenuOpen = (open: boolean) => {
  exportMenuWrap?.classList.toggle("open", open);
  btnExportMenu?.setAttribute("aria-expanded", String(open));
};
btnExportMenu?.addEventListener("click", (e) => {
  e.stopPropagation();
  setExportMenuOpen(!exportMenuWrap?.classList.contains("open"));
});
document.getElementById("export-menu")?.addEventListener("click", (e) => {
  const item = (e.target as HTMLElement).closest("button");
  if (!item) return;
  setTimeout(() => setExportMenuOpen(false), item.id === "btn-copy-csv" ? 900 : 0);
});
document.addEventListener("click", (e) => {
  if (exportMenuWrap && !exportMenuWrap.contains(e.target as Node)) setExportMenuOpen(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setExportMenuOpen(false);
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
  syncCanvasPlotConfig();
  if (isLiveMode) drawLive();
  else draw();
});

const runsBarEl = document.getElementById("runs-bar");

function redrawChart() {
  if (isLiveMode) drawLive();
  else draw();
}

function renderRunChips() {
  renderRunChipsDom({
    runsBarEl,
    pinnedRuns,
    onRemoveRun: (runId) => {
      pinnedRuns = pinnedRuns.filter((r) => r.id !== runId);
      renderRunChips();
      redrawChart();
    },
    onChange: () => {
      redrawChart();
    },
  });
}

function renderStatsDrawer() {
  renderStatsDrawerDom({
    statsDrawerEl,
    btnToggleStats,
    showStatsDrawer,
    currentData,
    isComparingBaseline,
    pinnedRuns,
    hiddenVars,
  });
}

function syncReactPanels() {
  if (!studioResultsContainerEl && !phasorFftContainerEl && !ieee2800ContainerEl) return;
  if (!reactPanels) {
    reactPanels = mountSimulationReactPanels({
      studioEl: studioResultsContainerEl,
      phasorFftEl: phasorFftContainerEl,
      complianceEl: ieee2800ContainerEl,
    });
  }
  const rows: Record<string, number | string>[] = [];
  const variables = currentData?.states ?? [];
  if (currentData && currentData.t.length > 0) {
    const { t, y, states } = currentData;
    for (let i = 0; i < t.length; i++) {
      const row: Record<string, number | string> = { time: t[i] };
      for (let vi = 0; vi < states.length; vi++) {
        const val = y[i]?.[vi];
        if (val !== undefined) row[states[vi]] = val;
      }
      rows.push(row);
    }
  }
  reactPanels.update({
    data: rows,
    variables,
    sweepResults: currentData?.sweepResults,
    complianceReport: currentData?.complianceReport ?? latestComplianceReport,
    waterCompliance: currentData?.waterCompliance ?? latestWaterCompliance,
    pscadExports: currentData?.pscadExports,
    modelName: currentData?.projectName,
    colorMode: isDark ? "dark" : "light",
  });
}

btnPinRun?.addEventListener("click", () => {
  if (!currentData) return;
  pinnedRunSeq++;
  pinnedRuns.push({
    id: pinnedRunSeq,
    name: pinnedRuns.length === 0 ? "Baseline" : `Run ${pinnedRunSeq}`,
    visible: true,
    data: {
      t: [...currentData.t],
      y: currentData.y.map((row) => [...row]),
      states: [...currentData.states],
    },
  });
  isComparingBaseline = true;
  btnCompareBaseline?.classList.add("active");
  renderRunChips();
  renderStatsDrawer();
  redrawChart();
});

btnCompareBaseline?.addEventListener("click", () => {
  if (pinnedRuns.length === 0 && currentData) {
    pinnedRunSeq++;
    pinnedRuns.push({
      id: pinnedRunSeq,
      name: "Baseline",
      visible: true,
      data: {
        t: [...currentData.t],
        y: currentData.y.map((row) => [...row]),
        states: [...currentData.states],
      },
    });
    isComparingBaseline = true;
  } else {
    isComparingBaseline = !isComparingBaseline;
    for (const run of pinnedRuns) {
      run.visible = isComparingBaseline;
    }
  }
  btnCompareBaseline.classList.toggle("active", isComparingBaseline);
  renderRunChips();
  renderStatsDrawer();
  redrawChart();
});

btnToggleStats?.addEventListener("click", () => {
  showStatsDrawer = !showStatsDrawer;
  renderStatsDrawer();
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
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
  if (msg.type === "syncTheme" || msg.type === "hostConfig") {
    if (msg.colorMode === "dark" || msg.colorMode === "light") {
      isDark = msg.colorMode === "dark";
      syncCanvasPlotConfig();
      syncReactPanels();
      redrawChart();
    }
    return;
  }
  if (msg.type === "complianceReport" && msg.report) {
    if (msg.kind === "water") {
      latestWaterCompliance = msg.report as WaterComplianceReport;
      if (currentData) currentData.waterCompliance = latestWaterCompliance;
    } else {
      latestComplianceReport = msg.report;
      if (currentData) currentData.complianceReport = latestComplianceReport;
    }
    syncReactPanels();
    return;
  }
  if (msg.type === "simulationData") {
    // Batch mode
    isLiveMode = false;
    currentData = msg.data;
    isDark = msg.isDark;
    if (msg.data.complianceReport) latestComplianceReport = msg.data.complianceReport;
    if (msg.data.waterCompliance) latestWaterCompliance = msg.data.waterCompliance;

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
    renderStatsDrawer();
    syncReactPanels();

    // Populate X-Axis selector for Phase Portrait
    if (msg.data.states) {
      selectedXVar = populateXAxisSelectorDom(selectXAxis, msg.data.states);
      populateAnalysisSelectors(msg.data.states);
    }
    cachedDatasetSource = null;
    syncCanvasPlotConfig();

    // Detect Multi-Body or 3D Visualizer simulation
    const isMultiBody = msg.data.states.some(
      (s: string) =>
        /\.(?:frame_[ab]\.r_0\[1\]|R\.T\[1,1\]|(?:r|r_0|r_shape|lengthDirection|widthDirection|coordinates)\[1\]|(?:shape|cylinder|sphere|box|arrow|arrowLine|arrowHead|cone|pipe|beam|gearwheel|spring|torus|surface|wheel|rim|tire|line)\.(?:r|r_0|coordinates|length)\b)/.test(
          s,
        ) ||
        /^(?:r|r_0|r_shape|coordinates)\[1\]$/.test(s) ||
        /^R\.T\[1,1\]$/.test(s),
    );
    if (isMultiBody) {
      btn3dAnimation.style.display = "inline-block";
    } else {
      btn3dAnimation.style.display = "none";
    }

    if (btnExportComtrade) {
      btnExportComtrade.style.display = msg.data.comtrade ? "inline-block" : "none";
    }
    if (btnExportOut) {
      btnExportOut.style.display = msg.data.pscadOut ? "inline-block" : "none";
    }
    if (btnExportPsout) {
      btnExportPsout.style.display = msg.data.pscadPsout ? "inline-block" : "none";
    }

    // Fill in Parameters with rich sliders, reset, and sweep controls
    if (msg.data.parameters && msg.data.parameters.length > 0) {
      currentParameters = renderParametersDom({
        parameters: msg.data.parameters,
        paramsSection,
        parametersView,
        defaultParameters,
        includeSweep: true,
        onModifiedChange: updateParamModifiedBadge,
        onRunSweep: (sweepConfig) => triggerSimulation(sweepConfig),
      });
    } else {
      paramsSection.style.display = "none";
    }

    // Fill in Experiment Settings
    settingsSection.style.display = "flex";
    const exp = msg.data.experiment || {};
    tStartInput.value = (exp.startTime ?? 0).toString();
    tStopInput.value = (exp.stopTime ?? 1).toString();
    intervalInput.value = (exp.interval ?? ((exp.stopTime ?? 1) - (exp.startTime ?? 0)) / 500).toString();
    toleranceInput.value = (exp.tolerance ?? 1e-4).toString();
    if (stRtol && !stRtol.value) stRtol.value = (exp.tolerance ?? 1e-4).toString();
    if (stAtol && !stAtol.value) stAtol.value = "1e-6";

    syncSolverFromExperimentDom(stSolver, stPreset, exp.solver);

    // Update telemetry display if available
    btnSimulate?.classList.remove("loading");
    if (msg.data.telemetry && simTelemetryEl) {
      simTelemetryEl.style.display = "block";
      simTelemetryEl.textContent = `✓ ${msg.data.telemetry.executionTimeMs}ms • ${msg.data.telemetry.stepCount} steps`;
    }

    updateVarCountBadge();

    currentMCData = null; // Clear old MC data on new simulation
    currentReachabilityData = null; // Clear old reachability data on normal simulation
    currentLimits = []; // Clear old verification limits
    customBounds = null;

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
  } else if (msg.type === "reachabilityData") {
    isLiveMode = false;
    isDark = msg.isDark;
    const reach = msg.data as ReachabilityData;
    const wasReachability = currentReachabilityData !== null;
    const prevStatesKey = currentData ? currentData.states.join(",") : "";
    currentReachabilityData = reach;
    currentMCData = null;

    const varName = reach.variable || "v";
    const nT = reach.t.length;
    let states: string[];
    let yMatrix: number[][];

    if (reach.states && reach.states.length > 0 && reach.y && reach.y.length === nT) {
      states = reach.states;
      yMatrix = reach.y;
    } else if (reach.variables && Object.keys(reach.variables).length > 0) {
      states = Object.keys(reach.variables);
      yMatrix = new Array(nT);
      for (let i = 0; i < nT; i++) {
        yMatrix[i] = states.map((s) => reach.variables?.[s]?.nominalTrajectory[i] ?? 0);
      }
    } else {
      states = [varName];
      yMatrix = new Array(nT);
      for (let i = 0; i < nT; i++) {
        yMatrix[i] = [reach.nominalTrajectory[i] ?? 0];
      }
    }

    currentData = {
      t: reach.t,
      y: yMatrix,
      states,
    };

    const sameModelInReachMode =
      wasReachability && prevStatesKey === states.join(",") && states.some((s) => !hiddenVars.has(s));

    if (!sameModelInReachMode) {
      hiddenVars.clear();
      for (const s of states) {
        seenVars.add(s);
        if (s !== varName) {
          hiddenVars.add(s);
        }
      }
      if (hiddenVars.size === states.length && states.length > 0) {
        hiddenVars.delete(states[0]);
      }
    }

    customBounds = null;

    // Populate X-Axis selector for Phase Portrait
    selectedXVar = populateXAxisSelectorDom(selectXAxis, states);

    // Populate Parameters if included in reachability payload
    if (reach.parameters) {
      currentParameters = renderParametersDom({
        parameters: reach.parameters,
        paramsSection,
        parametersView,
        defaultParameters,
        includeSweep: false,
        onModifiedChange: updateParamModifiedBadge,
      });
    }

    // Populate Experiment Settings if included
    if (reach.experiment) {
      settingsSection.style.display = "flex";
      const exp = reach.experiment;
      tStartInput.value = (exp.startTime ?? 0).toString();
      tStopInput.value = (exp.stopTime ?? reach.t[reach.t.length - 1] ?? 10).toString();
      intervalInput.value = (exp.interval ?? ((exp.stopTime ?? 10) - (exp.startTime ?? 0)) / 500).toString();
      toleranceInput.value = (exp.tolerance ?? 1e-4).toString();
      if (stRtol && !stRtol.value) stRtol.value = (exp.tolerance ?? 1e-4).toString();
      if (stAtol && !stAtol.value) stAtol.value = "1e-6";
    }

    btnSimulate?.classList.remove("loading");
    if (reach.telemetry && simTelemetryEl) {
      simTelemetryEl.style.display = "block";
      simTelemetryEl.textContent = `✓ ${reach.telemetry.executionTimeMs}ms • ${reach.telemetry.stepCount} steps (Reachability)`;
    }

    placeholderEl.style.display = "none";
    containerEl.style.display = "flex";
    toolbarEl.classList.add("visible");
    toolbarEl.classList.remove("live-mode");
    stopLiveLoop();
    buildTreeView(states);
    updateVarCountBadge();

    draw();
    requestAnimationFrame(() => draw());
    setTimeout(() => draw(), 50);
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
  filterVariablesDom(treeViewEl, btnClearVarSearch, query);
}

function filterParameters(query: string) {
  filterParametersDom(parametersView, btnClearParamSearch, query);
}

// Preset handler
stPreset?.addEventListener("change", () => {
  applySolverPresetDom({
    preset: stPreset.value,
    tStartInput,
    tStopInput,
    intervalInput,
    toleranceInput,
    stSolver,
    stRtol,
    stAtol,
    stSteadyState,
  });
});

// Solver change listener: sync preset when user manually selects a solver
stSolver?.addEventListener("change", () => {
  if (stPreset) {
    if (
      stSolver.value === "dopri5" &&
      (stPreset.value === "standard" || stPreset.value === "high-accuracy" || stPreset.value === "steady-state")
    )
      return;
    if (stSolver.value === "rk4" && stPreset.value === "fast") return;
    if (stSolver.value === "cvode" && stPreset.value === "stiff") return;
    if (stSolver.value === "dommel" && stPreset.value === "emt") return;
    stPreset.value = "custom";
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
      reachabilityMode: currentReachabilityData !== null,
    },
  });
}

btnSimulate?.addEventListener("click", () => {
  triggerSimulation();
});

document.getElementById("btn-empty-simulate")?.addEventListener("click", () => {
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
  if (!isLiveMode && viewMode !== "overlay") return;

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
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (!isLiveMode && viewMode !== "overlay" && currentData && currentData.t.length > 0) {
    if (cursorsEnabled) {
      const placed = canvasPlotCtrl.placeCursorAtPixel(mx, my);
      if (placed !== null) {
        draw();
      }
      return;
    }
    canvasDrag = { active: true, startX: mx, startY: my, curX: mx, curY: my };
    canvas.setPointerCapture(e.pointerId);
    return;
  }

  const margin = getPlotMargin();
  const plotW = rect.width - margin.left - margin.right;

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
  if (!isLiveMode && viewMode !== "overlay") {
    if (canvasDrag.active) {
      canvasDrag.curX = e.clientX - rect.left;
      canvasDrag.curY = e.clientY - rect.top;
      draw();
    } else {
      canvas.style.cursor = cursorsEnabled ? "crosshair" : "default";
    }
    return;
  }

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
  if (canvasDrag.active) {
    const { startX, startY, curX, curY } = canvasDrag;
    canvasDrag.active = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer may already have been released
    }
    canvasPlotCtrl.zoomToPixelRange(startX, curX, startY, curY);
    draw();
    return;
  }
  if (draggingCursor) {
    draggingCursor = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer may already have been released
    }
    if (isLiveMode) drawLive();
    else draw();
    return;
  }
  isDragging = false;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    // Pointer may already have been released
  }
});
canvas.addEventListener("pointercancel", (e) => {
  if (canvasDrag.active) {
    canvasDrag.active = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer may already have been released
    }
    draw();
    return;
  }
  if (draggingCursor) {
    draggingCursor = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer may already have been released
    }
    if (isLiveMode) drawLive();
    else draw();
    return;
  }
  isDragging = false;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    // Pointer may already have been released
  }
});

canvas.addEventListener("dblclick", () => {
  if (!isLiveMode && viewMode !== "overlay") {
    canvasPlotCtrl.resetZoom();
    draw();
  }
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
  ws.send(buildMqttConnectPacket());
}

function sendMqttSubscribe(ws: WebSocket, topic: string): void {
  ws.send(buildMqttSubscribePacket(topic));
}

function handleMqttPacket(data: ArrayBuffer, sessionId?: string, participantId?: string): void {
  const packet = decodeMqttPacket(data);
  if (!packet) return;

  switch (packet.type) {
    case "connack": {
      setLiveStatus("connected", "Connected");
      if (liveWs) {
        sendMqttSubscribe(liveWs, buildLiveSubscriptionTopic(sessionId, participantId));
      }
      startLiveLoop();
      break;
    }
    case "publish": {
      handleLiveData(packet.topic, packet.payload);
      break;
    }
    case "pingresp":
    case "other":
      break;
  }
}

function handleLiveData(topic: string, payload: string): void {
  if (!liveBuffer) return;

  const parsed = parseLiveDataTopic(topic);
  if (!parsed) return;

  const { participantId, variableName } = parsed;

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

function buildTreeView(variables: string[]): void {
  buildVariableTreeDom({
    treeViewEl,
    variables,
    currentData,
    hiddenVars,
    customRightVars,
    onToggleVisibility: () => {
      updateVarCountBadge();
      customBounds = null;
      redrawChart();
    },
    onEnableDualY: () => {
      if (!isDualY && checkboxDualY) {
        checkboxDualY.checked = true;
        isDualY = true;
        if (checkboxNormalize) {
          checkboxNormalize.checked = false;
          isNormalized = false;
        }
      }
    },
    onAxisChanged: () => {
      customBounds = null;
      draw();
    },
  });
}

// ── Live drawing ──

function drawLive(): void {
  drawLiveChart({
    canvas,
    ctx,
    liveBuffer,
    isDark,
    hiddenVars,
    customBounds,
    defaultBounds: calculateDefaultBounds(),
    interpolation: currentInterpolation,
  });
}

// ── Batch mode drawing ──

function draw() {
  if (!currentData || currentData.t.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;

  if (!isLiveMode && viewMode !== "overlay") {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    syncCanvasPlotConfig();
    const selBox =
      canvasDrag.active && Math.abs(canvasDrag.curX - canvasDrag.startX) > 4
        ? { startPx: canvasDrag.startX, endPx: canvasDrag.curX }
        : undefined;
    canvasPlotCtrl.render(ctx, Math.max(100, rect.width), Math.max(120, rect.height), dpr, selBox);
    return;
  }

  drawBatchOverlayChart({
    ctx,
    width: rect.width,
    height: rect.height,
    dpr,
    currentData,
    currentMCData,
    currentReachabilityData,
    currentLimits,
    pinnedRuns,
    hiddenVars,
    customRightVars,
    isDark,
    isNormalized,
    isDualY,
    selectedXVar,
    interpolation: currentInterpolation,
    margin: getPlotMargin(),
    customBounds,
    defaultBounds: calculateDefaultBounds(),
    hoverIndex,
    cursorsEnabled,
    cursorA,
    cursorB,
    cursorHudEl,
  });
}

// Tooltip on mousemove
canvas.addEventListener("mousemove", (e) => {
  if (draggingCursor !== null || (!isLiveMode && viewMode !== "overlay")) {
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

  tooltipEl.innerHTML = buildHoverTooltipHtml({
    currentData,
    currentMCData,
    closest,
    selectedXVar,
    isDualY,
    isNormalized,
    hiddenVars,
    customRightVars,
  });
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

if (vscodeApi) {
  vscodeApi.postMessage({ type: "ready" });
}

export { lttbDecimate };
