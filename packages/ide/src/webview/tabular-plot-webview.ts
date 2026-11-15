// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic Indexed Dataset Webview (Canvas2D)
 *
 * Powers TabularPlotEditorProvider for `.las` (Log ASCII Standard) well logs and
 * numeric `.csv` time/depth/frequency datasets using the unified `@modelscript/simulate/charts`
 * `CanvasPlotController` engine.
 */

import {
  CanvasPlotController,
  type ChartViewMode,
  computeVariableStats,
  type IndexedDataset,
  type TrackConfig,
} from "@modelscript/simulate/charts";

interface LasMetaSummary {
  version: string;
  wrap: boolean;
  well: { mnemonic: string; unit: string; value: string; description: string }[];
  parameters: { mnemonic: string; unit: string; value: string; description: string }[];
}

interface DatasetMessage {
  type: "datasetData" | "themeChange" | "error";
  dataset?: IndexedDataset;
  format?: "las" | "csv";
  fileName?: string;
  lasMeta?: LasMetaSummary;
  parseError?: string;
  isDark?: boolean;
  message?: string;
}

const PALETTE = ["#38bdf8", "#22c55e", "#f59e0b", "#ec4899", "#a855f7", "#06b6d4", "#f97316", "#ef4444"];

const vscodeApi = (window as typeof window & { acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void } })
  .acquireVsCodeApi
  ? (window as typeof window & { acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void } }).acquireVsCodeApi!()
  : null;

const canvas = document.getElementById("plot-canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const canvasWrap = document.getElementById("canvas-wrap")!;
const titleEl = document.getElementById("header-filename")!;
const formatBadgeEl = document.getElementById("badge-format")!;
const metaBadgeEl = document.getElementById("badge-meta")!;
const errorBannerEl = document.getElementById("error-banner")!;
const curveListEl = document.getElementById("curve-list")!;
const wellMetaWrapEl = document.getElementById("well-meta-wrap")!;
const wellMetaListEl = document.getElementById("well-meta-list")!;
const cursorHudEl = document.getElementById("cursor-hud")!;

const modeGroupEl = document.getElementById("mode-group")!;
const overlayControlsEl = document.getElementById("overlay-controls")!;
const crossplotControlsEl = document.getElementById("crossplot-controls")!;
const histogramControlsEl = document.getElementById("histogram-controls")!;

const checkNormalize = document.getElementById("check-normalize") as HTMLInputElement;
const checkLogScale = document.getElementById("check-log") as HTMLInputElement;
const selectCpX = document.getElementById("select-cp-x") as HTMLSelectElement;
const selectCpY = document.getElementById("select-cp-y") as HTMLSelectElement;
const selectCpColor = document.getElementById("select-cp-color") as HTMLSelectElement;
const checkCpReg = document.getElementById("check-cp-regression") as HTMLInputElement;
const selectHistVar = document.getElementById("select-hist-var") as HTMLSelectElement;
const selectHistBins = document.getElementById("select-hist-bins") as HTMLSelectElement;

const btnCursors = document.getElementById("btn-cursors")!;
const btnReset = document.getElementById("btn-reset")!;
const btnExportCsv = document.getElementById("btn-export-csv")!;
const btnExportLas = document.getElementById("btn-export-las")!;
const btnExportPng = document.getElementById("btn-export-png")!;

let dataset: IndexedDataset | null = null;
let viewMode: ChartViewMode = "overlay";
let isDark = true;
let cursorMode = false;
const hiddenCurves = new Set<string>();
const controller = new CanvasPlotController({ mode: "overlay", isDark: true });
let dragState = { active: false, startX: 0, startY: 0, curX: 0, curY: 0 };

function fmtNum(val: number): string {
  if (!Number.isFinite(val)) return "N/A";
  const abs = Math.abs(val);
  if (abs === 0) return "0";
  if (abs >= 1e5 || abs < 1e-3) return val.toExponential(3);
  return val.toFixed(3);
}

function buildTracks(): TrackConfig[] | undefined {
  if (!dataset) return undefined;
  const visible = dataset.series.filter((s) => !hiddenCurves.has(s.name));
  const pool = visible.length > 0 ? visible : dataset.series.slice(0, 4);
  if (pool.length === 0) return undefined;
  const count = Math.min(4, pool.length);
  const tracks: TrackConfig[] = Array.from({ length: count }, (_, i) => ({
    id: `track_${i + 1}`,
    seriesNames: [],
  }));
  pool.forEach((s, i) => {
    tracks[i % count]!.seriesNames.push(s.name);
  });
  return tracks;
}

function syncConfig(): void {
  const names = dataset ? dataset.series.map((s) => s.name) : [];
  controller.updateConfig({
    mode: viewMode,
    isDark,
    cursorMode,
    overlay: {
      normalize: checkNormalize.checked,
      logScale: checkLogScale.checked,
      visibleSeries: dataset ? dataset.series.filter((s) => !hiddenCurves.has(s.name)).map((s) => s.name) : [],
    },
    tracks: buildTracks(),
    crossplot: {
      xSeries: selectCpX.value || names[0] || "",
      ySeries: selectCpY.value || names[1] || names[0] || "",
      colorSeries: selectCpColor.value || undefined,
      showRegression: checkCpReg.checked,
    },
    histogram: {
      seriesName: selectHistVar.value || names[0] || "",
      binCount: Math.max(5, Number(selectHistBins.value) || 30),
    },
  });
}

function updateCursorHud(): void {
  const cursors = controller.getState().cursors;
  if (!cursorMode || (cursors.c1 === null && cursors.c2 === null)) {
    cursorHudEl.style.display = "none";
    return;
  }
  cursorHudEl.style.display = "flex";
  const parts: string[] = [];
  if (cursors.c1 !== null && cursors.c1 !== undefined) parts.push(`C1: ${fmtNum(cursors.c1)}`);
  if (cursors.c2 !== null && cursors.c2 !== undefined) parts.push(`C2: ${fmtNum(cursors.c2)}`);
  if (cursors.c1 !== null && cursors.c1 !== undefined && cursors.c2 !== null && cursors.c2 !== undefined) {
    parts.push(`Δ = ${fmtNum(cursors.c2 - cursors.c1)}`);
  }
  cursorHudEl.textContent = parts.join("   |   ");
}

function redraw(): void {
  if (!dataset || !canvas || !canvasWrap) return;
  const rect = canvasWrap.getBoundingClientRect();
  const w = Math.max(120, Math.floor(rect.width));
  const h = Math.max(160, Math.floor(rect.height));
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  syncConfig();
  const selBox =
    dragState.active && Math.abs(dragState.curX - dragState.startX) > 4
      ? { startPx: dragState.startX, endPx: dragState.curX }
      : undefined;
  controller.render(ctx, w, h, dpr, selBox);
  updateCursorHud();
}

function setMode(mode: ChartViewMode): void {
  viewMode = mode;
  modeGroupEl.querySelectorAll("button.mode-btn").forEach((btn) => {
    const active = btn.getAttribute("data-mode") === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  overlayControlsEl.style.display = mode === "overlay" ? "inline-flex" : "none";
  crossplotControlsEl.style.display = mode === "crossplot" ? "inline-flex" : "none";
  histogramControlsEl.style.display = mode === "histogram" ? "inline-flex" : "none";
  redraw();
}

function populateSelectors(names: string[]): void {
  const fill = (sel: HTMLSelectElement, idx: number, allowEmpty = false) => {
    sel.innerHTML = allowEmpty ? '<option value="">None</option>' : "";
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
    if (!allowEmpty && names.length > 0) {
      sel.value = names[Math.min(idx, names.length - 1)]!;
    } else if (allowEmpty) {
      sel.value = "";
    }
  };
  fill(selectCpX, 0);
  fill(selectCpY, 1);
  fill(selectCpColor, 2, true);
  fill(selectHistVar, 0);
}

function renderSidebar(): void {
  if (!dataset) return;
  curveListEl.innerHTML = "";
  const stats = computeVariableStats(dataset);
  const statsByName = new Map(stats.map((s) => [s.name, s]));

  dataset.series.forEach((s, idx) => {
    const color = PALETTE[idx % PALETTE.length]!;
    const st = statsByName.get(s.name);
    const row = document.createElement("label");
    row.className = "curve-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !hiddenCurves.has(s.name);
    cb.addEventListener("change", () => {
      if (cb.checked) hiddenCurves.delete(s.name);
      else hiddenCurves.add(s.name);
      redraw();
    });

    const swatch = document.createElement("span");
    swatch.className = "curve-swatch";
    swatch.style.backgroundColor = color;

    const info = document.createElement("div");
    info.className = "curve-info";

    const head = document.createElement("div");
    head.className = "curve-name";
    head.textContent = s.unit ? `${s.name} (${s.unit})` : s.name;

    const meta = document.createElement("div");
    meta.className = "curve-stats";
    meta.textContent = st
      ? `min ${fmtNum(st.min)} · p50 ${fmtNum(st.p50)} · max ${fmtNum(st.max)}`
      : `${s.values.length} samples`;

    info.appendChild(head);
    info.appendChild(meta);
    row.appendChild(cb);
    row.appendChild(swatch);
    row.appendChild(info);
    curveListEl.appendChild(row);
  });
}

function renderLasMeta(lasMeta?: LasMetaSummary): void {
  if (!lasMeta || (lasMeta.well.length === 0 && lasMeta.parameters.length === 0)) {
    wellMetaWrapEl.style.display = "none";
    return;
  }
  wellMetaWrapEl.style.display = "block";
  wellMetaListEl.innerHTML = "";
  const entries = [...lasMeta.well.slice(0, 14), ...lasMeta.parameters.slice(0, 8)];
  for (const item of entries) {
    const tr = document.createElement("tr");
    const tdKey = document.createElement("td");
    tdKey.textContent = item.unit ? `${item.mnemonic} (${item.unit})` : item.mnemonic;
    const tdVal = document.createElement("td");
    tdVal.textContent = item.value;
    tdVal.title = item.description || item.value;
    tr.appendChild(tdKey);
    tr.appendChild(tdVal);
    wellMetaListEl.appendChild(tr);
  }
}

modeGroupEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement | null)?.closest("button.mode-btn");
  const mode = btn?.getAttribute("data-mode") as ChartViewMode | null;
  if (mode) setMode(mode);
});

[checkNormalize, checkLogScale, selectCpX, selectCpY, selectCpColor, checkCpReg, selectHistVar, selectHistBins].forEach(
  (el) => {
    el.addEventListener("change", () => redraw());
  },
);

btnCursors.addEventListener("click", () => {
  cursorMode = !cursorMode;
  btnCursors.classList.toggle("active", cursorMode);
  canvasWrap.style.cursor = cursorMode ? "crosshair" : "default";
  redraw();
});

btnReset.addEventListener("click", () => {
  controller.resetZoom();
  redraw();
});

btnExportCsv.addEventListener("click", () => {
  vscodeApi?.postMessage({ type: "exportCsv" });
});

btnExportLas.addEventListener("click", () => {
  vscodeApi?.postMessage({ type: "exportLas" });
});

btnExportPng.addEventListener("click", () => {
  if (!canvas) return;
  const link = document.createElement("a");
  link.download = `${(dataset?.title || "dataset").replace(/\s+/g, "_")}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
});

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !dataset) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  if (cursorMode) {
    if (controller.placeCursorAtPixel(mx, my) !== null) {
      redraw();
    }
    return;
  }
  dragState = { active: true, startX: mx, startY: my, curX: mx, curY: my };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragState.active) return;
  const rect = canvas.getBoundingClientRect();
  dragState.curX = e.clientX - rect.left;
  dragState.curY = e.clientY - rect.top;
  redraw();
});

canvas.addEventListener("pointerup", (e) => {
  if (!dragState.active) return;
  const { startX, startY, curX, curY } = dragState;
  dragState.active = false;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    // Ignore capture release errors
  }
  controller.zoomToPixelRange(startX, curX, startY, curY);
  redraw();
});

canvas.addEventListener("dblclick", () => {
  controller.resetZoom();
  redraw();
});

if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => redraw()).observe(canvasWrap);
}

window.addEventListener("message", (event) => {
  const msg = event.data as DatasetMessage | undefined;
  if (!msg) return;

  if (msg.type === "themeChange" && typeof msg.isDark === "boolean") {
    isDark = msg.isDark;
    redraw();
    return;
  }

  if (msg.type === "error") {
    errorBannerEl.style.display = "block";
    errorBannerEl.textContent = msg.message || "Failed to parse tabular dataset.";
    return;
  }

  if (msg.type === "datasetData" && msg.dataset) {
    dataset = msg.dataset;
    isDark = msg.isDark ?? true;
    hiddenCurves.clear();
    controller.setDataset(dataset);

    titleEl.textContent = msg.fileName || dataset.title || "Tabular Dataset";
    formatBadgeEl.textContent = (msg.format || dataset.sourceFormat || "DATA").toUpperCase();
    const minIdx = dataset.indexValues[0] ?? 0;
    const maxIdx = dataset.indexValues[dataset.indexValues.length - 1] ?? 0;
    const unitSuffix = dataset.indexAxis.unit ? ` ${dataset.indexAxis.unit}` : "";
    metaBadgeEl.textContent = `${fmtNum(minIdx)}–${fmtNum(maxIdx)}${unitSuffix} · ${dataset.indexValues.length} samples · ${dataset.series.length} series`;

    if (msg.parseError) {
      errorBannerEl.style.display = "block";
      errorBannerEl.textContent = msg.parseError;
    } else {
      errorBannerEl.style.display = "none";
    }

    // Default to Multi-Track when viewing depth/well-log data, Overlay otherwise
    const defaultMode: ChartViewMode = msg.format === "las" || dataset.indexAxis.inverted ? "multitrack" : "overlay";
    const seriesNames = dataset.series.map((s) => s.name);
    dataset.series.forEach((s, i) => {
      if (i >= 8) hiddenCurves.add(s.name);
    });

    populateSelectors(seriesNames);
    renderSidebar();
    renderLasMeta(msg.lasMeta);
    setMode(defaultMode);
  }
});

vscodeApi?.postMessage({ type: "ready" });
