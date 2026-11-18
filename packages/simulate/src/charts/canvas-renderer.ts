// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  computeHistogram,
  computeLinearRegression,
  computeVariableStats,
  isValidSample,
  sliceDatasetByRange,
  transformSeriesValue,
} from "./analytics.js";
import type {
  CanvasRenderOptions,
  CanvasRenderResult,
  CrossplotConfig,
  OverlayConfig,
  PlotRect,
  RenderedTrackGeometry,
  TrackConfig,
} from "./canvas-types.js";
import { lttbDecimate } from "./downsample.js";
import { resolveChartTheme, type ChartTheme } from "./theme.js";
import type { AxisScale, IndexedDataset, SeriesDescriptor } from "./types.js";

/** Minimal Canvas2D context subset required by the renderer (compatible with `CanvasRenderingContext2D`). */
export interface Canvas2DContextLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fill(): void;
  stroke(): void;
  setLineDash(segments: number[]): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
}

const RESISTIVITY_RE = /^(RT|RES|ILD|ILM|LLD|LLS|MSFL|RDEP|RMED|RSHAL)/i;
const FONT_SANS = "11px Inter, -apple-system, BlinkMacSystemFont, sans-serif";
const FONT_MONO = "10.5px 'JetBrains Mono', ui-monospace, monospace";

function formatTick(val: number): string {
  if (!Number.isFinite(val)) return "";
  const abs = Math.abs(val);
  if (abs === 0) return "0";
  if (abs >= 1e5 || abs < 1e-3) return val.toExponential(2);
  if (abs >= 100) return val.toFixed(1);
  if (abs >= 1) return val.toFixed(2);
  return val.toPrecision(3);
}

function niceTicks(min: number, max: number, targetCount = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (Math.abs(max - min) <= 1e-12) return [min];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const stepRaw = (hi - lo) / Math.max(1, targetCount);
  const mag = Math.pow(10, Math.floor(Math.log10(stepRaw)));
  const norm = stepRaw / mag;
  const niceNorm = norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10;
  const step = niceNorm * mag;
  const start = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= hi + step * 1e-6; v += step) {
    ticks.push(v);
    if (ticks.length > 32) break;
  }
  return ticks;
}

function computeSeriesBounds(values: number[], scale: AxisScale, nullValue?: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isValidSample(v, nullValue)) continue;
    if (scale === "log" && v <= 0) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return scale === "log" ? [0.1, 100] : [0, 1];
  }
  if (Math.abs(max - min) <= 1e-12) {
    if (scale === "log") return [min * 0.5, min * 2];
    const pad = Math.abs(min) > 1e-6 ? Math.abs(min) * 0.1 : 1;
    return [min - pad, max + pad];
  }
  return [min, max];
}

function mapToRange(
  val: number,
  lo: number,
  hi: number,
  outStart: number,
  outEnd: number,
  scale: AxisScale,
): number | null {
  if (!Number.isFinite(val)) return null;
  if (scale === "log") {
    if (val <= 0 || lo <= 0 || hi <= 0) return null;
    const lMin = Math.log10(lo);
    const lMax = Math.log10(hi);
    const span = Math.abs(lMax - lMin) > 1e-12 ? lMax - lMin : 1;
    const t = (Math.log10(val) - lMin) / span;
    return outStart + t * (outEnd - outStart);
  }
  const span = Math.abs(hi - lo) > 1e-12 ? hi - lo : 1;
  const t = (val - lo) / span;
  return outStart + t * (outEnd - outStart);
}

function colorRamp(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  // Cyan -> Green -> Amber -> Crimson
  const stops: [number, number, number][] = [
    [6, 182, 212],
    [16, 185, 129],
    [245, 158, 11],
    [239, 68, 68],
  ];
  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const a = stops[idx]!;
  const b = stops[idx + 1]!;
  const r = Math.round(a[0] + (b[0] - a[0]) * frac);
  const g = Math.round(a[1] + (b[1] - a[1]) * frac);
  const bl = Math.round(a[2] + (b[2] - a[2]) * frac);
  return `rgb(${r}, ${g}, ${bl})`;
}

function getIndexBounds(
  dataset: IndexedDataset,
  viewport?: { minIndex?: number | undefined; maxIndex?: number | undefined },
): [number, number] {
  let dMin = Infinity;
  let dMax = -Infinity;
  for (let i = 0; i < dataset.indexValues.length; i++) {
    const v = dataset.indexValues[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < dMin) dMin = v;
    if (v > dMax) dMax = v;
  }
  if (!Number.isFinite(dMin) || !Number.isFinite(dMax)) {
    dMin = 0;
    dMax = 1;
  }
  const lo = viewport?.minIndex ?? dMin;
  const hi = viewport?.maxIndex ?? dMax;
  if (Math.abs(hi - lo) <= 1e-12) return [lo - 0.5, hi + 0.5];
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

function drawCenteredMessage(ctx: Canvas2DContextLike, rect: PlotRect, theme: ChartTheme, msg: string): void {
  ctx.fillStyle = theme.textMuted;
  ctx.font = FONT_SANS;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(msg, rect.x + rect.width * 0.5, rect.y + rect.height * 0.5);
}

function bucketMinMaxPoints(pts: { x: number; y: number }[], maxBuckets: number): { x: number; y: number }[] {
  const n = pts.length;
  if (n <= maxBuckets * 2 || maxBuckets < 16) return pts;
  const xMin = pts[0]!.x;
  const xMax = pts[n - 1]!.x;
  if (!(xMax > xMin)) return lttbDecimate(pts, 1500);
  const out: { x: number; y: number }[] = [pts[0]!];
  const invSpan = maxBuckets / (xMax - xMin);
  let curBucket = -1;
  let bMinPt: { x: number; y: number } | null = null;
  let bMaxPt: { x: number; y: number } | null = null;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const b = Math.min(maxBuckets - 1, Math.max(0, Math.floor((p.x - xMin) * invSpan)));
    if (b !== curBucket) {
      if (bMinPt && bMaxPt) {
        if (bMinPt.x <= bMaxPt.x) {
          out.push(bMinPt);
          if (bMaxPt !== bMinPt) out.push(bMaxPt);
        } else {
          out.push(bMaxPt);
          out.push(bMinPt);
        }
      }
      curBucket = b;
      bMinPt = p;
      bMaxPt = p;
    } else {
      if (p.y < bMinPt!.y) bMinPt = p;
      if (p.y > bMaxPt!.y) bMaxPt = p;
    }
  }
  if (bMinPt && bMaxPt) {
    if (bMinPt.x <= bMaxPt.x) {
      out.push(bMinPt);
      if (bMaxPt !== bMinPt) out.push(bMaxPt);
    } else {
      out.push(bMaxPt);
      out.push(bMinPt);
    }
  }
  if (out[out.length - 1] !== pts[n - 1]) out.push(pts[n - 1]!);
  return out;
}

function drawSeriesPolyline(
  ctx: Canvas2DContextLike,
  pts: { x: number; y: number }[],
  color: string,
  lineWidth = 1.8,
  plotWidthPx = 800,
): void {
  if (pts.length === 0) return;
  const decimated = pts.length > 3500 ? bucketMinMaxPoints(pts, Math.max(400, Math.ceil(plotWidthPx * 1.5))) : pts;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let i = 0; i < decimated.length; i++) {
    const p = decimated[i]!;
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function renderOverlayChart(
  ctx: Canvas2DContextLike,
  dataset: IndexedDataset,
  options: CanvasRenderOptions,
  theme: ChartTheme,
): CanvasRenderResult {
  const cfg: OverlayConfig = options.overlay ?? {};
  const visibleSet = cfg.visibleSeries ? new Set(cfg.visibleSeries) : null;
  const rightSet = new Set(cfg.rightAxisSeries ?? []);

  const [xMin, xMax] = getIndexBounds(dataset, options.viewport);
  const sliced = sliceDatasetByRange(dataset, xMin, xMax);
  const activeSeries = sliced.series.filter((s) => !visibleSet || visibleSet.has(s.name));
  const leftSeries = activeSeries.filter((s) => !rightSet.has(s.name));
  const rightSeries = activeSeries.filter((s) => rightSet.has(s.name));
  const hasRightAxis = rightSeries.length > 0 && leftSeries.length > 0;

  const rect: PlotRect = {
    x: 58,
    y: 26,
    width: Math.max(40, options.width - (hasRightAxis ? 116 : 78)),
    height: Math.max(40, options.height - 62),
  };

  const stats = computeVariableStats(sliced, {
    seriesNames: activeSeries.map((s) => s.name),
  });

  if (activeSeries.length === 0 || sliced.indexValues.length === 0) {
    drawCenteredMessage(ctx, rect, theme, "No plottable series in current range.");
    return { mode: "overlay", plotRect: rect, indexBounds: { min: xMin, max: xMax }, stats };
  }

  const normalize = Boolean(cfg.normalize);
  const logScale = Boolean(cfg.logScale);
  const scale: AxisScale = logScale ? "log" : "linear";
  const nullVal = dataset.indexAxis.nullValue;
  const invertedX = cfg.invertedIndex ?? Boolean(dataset.indexAxis.inverted);

  const boundsByName = new Map<string, { min: number; span: number }>();
  for (const st of stats) {
    boundsByName.set(st.name, { min: st.min, span: Math.max(1e-12, st.max - st.min) });
  }

  const computeGroupBounds = (group: SeriesDescriptor[], explicitRange?: [number, number]): [number, number] => {
    if (normalize) return [logScale ? 1e-4 : 0, 1];
    if (
      explicitRange &&
      Number.isFinite(explicitRange[0]) &&
      Number.isFinite(explicitRange[1]) &&
      explicitRange[1] > explicitRange[0]
    ) {
      return explicitRange;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of group) {
      for (let i = 0; i < s.values.length; i++) {
        const v = transformSeriesValue(s.values[i], { logScale, nullValue: nullVal });
        if (v === null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      return logScale ? [0.1, 10] : [0, 1];
    }
    if (Math.abs(hi - lo) <= 1e-12) {
      const pad = Math.abs(lo) > 1e-6 ? Math.abs(lo) * 0.1 : 1;
      return [logScale ? Math.max(1e-6, lo * 0.5) : lo - pad, logScale ? hi * 2 : hi + pad];
    }
    return [lo, hi];
  };

  let [yMin, yMax] = computeGroupBounds(hasRightAxis ? leftSeries : activeSeries, cfg.yRange);
  if (!normalize && options.viewport?.minValue !== undefined && options.viewport?.maxValue !== undefined) {
    yMin = options.viewport.minValue;
    yMax = options.viewport.maxValue;
  }
  const [ryMin, ryMax] = hasRightAxis ? computeGroupBounds(rightSeries, cfg.rightYRange) : [0, 1];

  // Grid & axes
  const xTicks = niceTicks(xMin, xMax, 6);
  const yTicks = niceTicks(yMin, yMax, 5);
  const ryTicks = hasRightAxis ? niceTicks(ryMin, ryMax, 5) : [];

  ctx.font = FONT_MONO;
  ctx.lineWidth = 1;

  for (const xt of xTicks) {
    const px = mapToRange(
      xt,
      xMin,
      xMax,
      invertedX ? rect.x + rect.width : rect.x,
      invertedX ? rect.x : rect.x + rect.width,
      "linear",
    );
    if (px === null) continue;
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(px, rect.y);
    ctx.lineTo(px, rect.y + rect.height);
    ctx.stroke();

    ctx.fillStyle = theme.textMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(formatTick(xt), px, rect.y + rect.height + 6);
  }

  for (const yt of yTicks) {
    const py = mapToRange(yt, yMin, yMax, rect.y + rect.height, rect.y, scale);
    if (py === null) continue;
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(rect.x, py);
    ctx.lineTo(rect.x + rect.width, py);
    ctx.stroke();

    ctx.fillStyle = theme.textMuted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatTick(yt), rect.x - 6, py);
  }

  if (hasRightAxis) {
    ctx.fillStyle = theme.palette[leftSeries.length % theme.palette.length] ?? theme.textMuted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const ryt of ryTicks) {
      const py = mapToRange(ryt, ryMin, ryMax, rect.y + rect.height, rect.y, scale);
      if (py === null) continue;
      ctx.fillText(formatTick(ryt), rect.x + rect.width + 6, py);
    }
    if (cfg.rightYTitle) {
      ctx.font = FONT_SANS;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(cfg.rightYTitle, rect.x + rect.width + 52, rect.y - 4);
      ctx.font = FONT_MONO;
    }
  }
  if (cfg.yTitle) {
    ctx.fillStyle = theme.textMuted;
    ctx.font = FONT_SANS;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(cfg.yTitle, rect.x, rect.y - 4);
    ctx.font = FONT_MONO;
  }

  // Axis frame & label
  ctx.strokeStyle = theme.axis;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  const xTitle = `${dataset.indexAxis.label}${dataset.indexAxis.unit ? ` (${dataset.indexAxis.unit})` : ""}`;
  ctx.fillStyle = theme.textMuted;
  ctx.font = FONT_SANS;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(xTitle, rect.x + rect.width * 0.5, options.height - 4);

  // Clip plot area and draw series
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();

  if (options.selectionBox) {
    const sx = Math.min(options.selectionBox.startPx, options.selectionBox.endPx);
    const sw = Math.abs(options.selectionBox.endPx - options.selectionBox.startPx);
    ctx.fillStyle = theme.selectionFill;
    ctx.fillRect(sx, rect.y, sw, rect.height);
  }

  activeSeries.forEach((s, idx) => {
    const color = cfg.seriesColors?.[s.name] ?? theme.palette[idx % theme.palette.length]!;
    const normBounds = normalize ? boundsByName.get(s.name) : undefined;
    const useRight = hasRightAxis && rightSet.has(s.name);
    const sYMin = useRight ? ryMin : yMin;
    const sYMax = useRight ? ryMax : yMax;
    let segment: { x: number; y: number }[] = [];

    for (let i = 0; i < sliced.indexValues.length; i++) {
      const ix = sliced.indexValues[i]!;
      const val = transformSeriesValue(s.values[i], {
        normalize: normBounds,
        logScale,
        nullValue: nullVal,
      });
      const px = mapToRange(
        ix,
        xMin,
        xMax,
        invertedX ? rect.x + rect.width : rect.x,
        invertedX ? rect.x : rect.x + rect.width,
        "linear",
      );
      const py = val !== null ? mapToRange(val, sYMin, sYMax, rect.y + rect.height, rect.y, scale) : null;

      if (px === null || py === null) {
        if (segment.length > 0) {
          drawSeriesPolyline(ctx, segment, color, 1.8, rect.width);
          segment = [];
        }
        continue;
      }
      segment.push({ x: px, y: py });
    }
    if (segment.length > 0) drawSeriesPolyline(ctx, segment, color, 1.8, rect.width);
  });

  // Dual vertical cursors
  const drawCursor = (cVal: number | null | undefined, color: string, label: string) => {
    if (cVal === null || cVal === undefined || !Number.isFinite(cVal)) return;
    const px = mapToRange(
      cVal,
      xMin,
      xMax,
      invertedX ? rect.x + rect.width : rect.x,
      invertedX ? rect.x : rect.x + rect.width,
      "linear",
    );
    if (px === null || px < rect.x || px > rect.x + rect.width) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px, rect.y);
    ctx.lineTo(px, rect.y + rect.height);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = FONT_MONO;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`${label}:${formatTick(cVal)}`, px + 4, rect.y + 4);
    ctx.restore();
  };

  drawCursor(options.cursors?.c1, theme.cursor1, "C1");
  drawCursor(options.cursors?.c2, theme.cursor2, "C2");

  ctx.restore();

  return { mode: "overlay", plotRect: rect, indexBounds: { min: xMin, max: xMax }, stats };
}

function buildDefaultTracks(series: SeriesDescriptor[]): TrackConfig[] {
  if (series.length === 0) return [];
  const maxTracks = Math.min(4, series.length);
  const tracks: TrackConfig[] = Array.from({ length: maxTracks }, (_, i) => ({
    id: `track_${i + 1}`,
    seriesNames: [],
  }));
  series.forEach((s, idx) => {
    const t = tracks[idx % maxTracks]!;
    t.seriesNames.push(s.name);
    if (RESISTIVITY_RE.test(s.name)) {
      t.scale = "log";
    }
  });
  return tracks;
}

function renderMultiTrackChart(
  ctx: Canvas2DContextLike,
  dataset: IndexedDataset,
  options: CanvasRenderOptions,
  theme: ChartTheme,
): CanvasRenderResult {
  const headerH = 44;
  const leftAxisW = 64;
  const trackGap = 8;
  const plotRect: PlotRect = {
    x: leftAxisW,
    y: headerH + 6,
    width: Math.max(40, options.width - leftAxisW - 14),
    height: Math.max(40, options.height - headerH - 22),
  };

  const [yMin, yMax] = getIndexBounds(dataset, options.viewport);
  const sliced = sliceDatasetByRange(dataset, yMin, yMax);
  const stats = computeVariableStats(sliced);
  const tracksCfg = options.tracks && options.tracks.length > 0 ? options.tracks : buildDefaultTracks(sliced.series);

  if (tracksCfg.length === 0 || sliced.indexValues.length === 0) {
    drawCenteredMessage(ctx, plotRect, theme, "No tracks or series available.");
    return { mode: "multitrack", plotRect, indexBounds: { min: yMin, max: yMax }, stats };
  }

  const invertedY = dataset.indexAxis.inverted ?? true;
  const yOutStart = invertedY ? plotRect.y : plotRect.y + plotRect.height;
  const yOutEnd = invertedY ? plotRect.y + plotRect.height : plotRect.y;

  // Shared vertical index axis ticks
  const yTicks = niceTicks(yMin, yMax, 7);
  ctx.font = FONT_MONO;
  ctx.lineWidth = 1;
  for (const yt of yTicks) {
    const py = mapToRange(yt, yMin, yMax, yOutStart, yOutEnd, "linear");
    if (py === null) continue;
    ctx.fillStyle = theme.textMuted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatTick(yt), plotRect.x - 6, py);
  }

  // Vertical axis header
  const idxHeader = `${dataset.indexAxis.label}${dataset.indexAxis.unit ? ` (${dataset.indexAxis.unit})` : ""}`;
  ctx.fillStyle = theme.text;
  ctx.font = FONT_SANS;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(idxHeader, plotRect.x - 6, headerH * 0.5);

  const trackCount = tracksCfg.length;
  const trackWidth = Math.max(30, (plotRect.width - trackGap * (trackCount - 1)) / trackCount);
  const seriesByName = new Map(sliced.series.map((s) => [s.name, s]));
  const trackGeometries: RenderedTrackGeometry[] = [];
  const nullVal = dataset.indexAxis.nullValue;
  let colorCounter = 0;

  for (let tIdx = 0; tIdx < trackCount; tIdx++) {
    const tr = tracksCfg[tIdx]!;
    const tx = plotRect.x + tIdx * (trackWidth + trackGap);
    const scale: AxisScale = tr.scale ?? "linear";
    trackGeometries.push({ id: tr.id, x: tx, width: trackWidth, series: tr.seriesNames });

    // Track header box
    ctx.fillStyle = theme.panelBg;
    ctx.fillRect(tx, 6, trackWidth, headerH - 4);
    ctx.strokeStyle = theme.axis;
    ctx.strokeRect(tx, 6, trackWidth, headerH - 4);

    // Track body background & grid
    ctx.strokeStyle = theme.axis;
    ctx.strokeRect(tx, plotRect.y, trackWidth, plotRect.height);

    for (const yt of yTicks) {
      const py = mapToRange(yt, yMin, yMax, yOutStart, yOutEnd, "linear");
      if (py === null) continue;
      ctx.strokeStyle = theme.grid;
      ctx.beginPath();
      ctx.moveTo(tx, py);
      ctx.lineTo(tx + trackWidth, py);
      ctx.stroke();
    }

    // Vertical grid lines inside track
    for (let g = 1; g < 4; g++) {
      const gx = tx + (trackWidth * g) / 4;
      ctx.strokeStyle = theme.grid;
      ctx.beginPath();
      ctx.moveTo(gx, plotRect.y);
      ctx.lineTo(gx, plotRect.y + plotRect.height);
      ctx.stroke();
    }

    // Determine track X bounds across its series
    let xLo = tr.min ?? Infinity;
    let xHi = tr.max ?? -Infinity;
    if (!Number.isFinite(xLo) || !Number.isFinite(xHi)) {
      for (const sName of tr.seriesNames) {
        const ser = seriesByName.get(sName);
        if (!ser) continue;
        const [sLo, sHi] = computeSeriesBounds(ser.values, scale, nullVal);
        if (!Number.isFinite(tr.min ?? NaN)) xLo = Math.min(xLo, sLo);
        if (!Number.isFinite(tr.max ?? NaN)) xHi = Math.max(xHi, sHi);
      }
      if (!Number.isFinite(xLo) || !Number.isFinite(xHi)) {
        xLo = scale === "log" ? 0.1 : 0;
        xHi = scale === "log" ? 100 : 1;
      }
    }

    // Header labels
    ctx.font = FONT_SANS;
    ctx.fillStyle = theme.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const headerLabel = tr.title ?? tr.seriesNames.join(" / ");
    ctx.fillText(headerLabel, tx + trackWidth * 0.5, 10, trackWidth - 8);

    ctx.font = FONT_MONO;
    ctx.fillStyle = theme.textMuted;
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    ctx.fillText(formatTick(xLo), tx + 4, headerH - 1);
    ctx.textAlign = "right";
    ctx.fillText(formatTick(xHi), tx + trackWidth - 4, headerH - 1);
    if (scale === "log") {
      ctx.textAlign = "center";
      ctx.fillText("log", tx + trackWidth * 0.5, headerH - 1);
    }

    // Clip track interior and plot curves
    ctx.save();
    ctx.beginPath();
    ctx.rect(tx, plotRect.y, trackWidth, plotRect.height);
    ctx.clip();

    for (const sName of tr.seriesNames) {
      const ser = seriesByName.get(sName);
      if (!ser) continue;
      const color = theme.palette[colorCounter % theme.palette.length]!;
      colorCounter++;
      let segment: { x: number; y: number }[] = [];

      for (let i = 0; i < sliced.indexValues.length; i++) {
        const iv = sliced.indexValues[i]!;
        const val = ser.values[i];
        const py = mapToRange(iv, yMin, yMax, yOutStart, yOutEnd, "linear");
        const px =
          val !== undefined && isValidSample(val, nullVal)
            ? mapToRange(val, xLo, xHi, tx + 2, tx + trackWidth - 2, scale)
            : null;
        if (px === null || py === null) {
          if (segment.length > 0) {
            drawSeriesPolyline(ctx, segment, color);
            segment = [];
          }
          continue;
        }
        segment.push({ x: px, y: py });
      }
      if (segment.length > 0) drawSeriesPolyline(ctx, segment, color);
    }

    ctx.restore();
  }

  // Synchronized horizontal cursors across all tracks
  const drawHorizontalCursor = (cVal: number | null | undefined, color: string, label: string) => {
    if (cVal === null || cVal === undefined || !Number.isFinite(cVal)) return;
    const py = mapToRange(cVal, yMin, yMax, yOutStart, yOutEnd, "linear");
    if (py === null || py < plotRect.y || py > plotRect.y + plotRect.height) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(plotRect.x, py);
    ctx.lineTo(plotRect.x + plotRect.width, py);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = FONT_MONO;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${label}:${formatTick(cVal)}`, plotRect.x + 4, py - 2);
    ctx.restore();
  };

  drawHorizontalCursor(options.cursors?.c1, theme.cursor1, "C1");
  drawHorizontalCursor(options.cursors?.c2, theme.cursor2, "C2");

  return {
    mode: "multitrack",
    plotRect,
    indexBounds: { min: yMin, max: yMax },
    stats,
    tracks: trackGeometries,
  };
}

function renderCrossplotChart(
  ctx: Canvas2DContextLike,
  dataset: IndexedDataset,
  options: CanvasRenderOptions,
  theme: ChartTheme,
): CanvasRenderResult {
  const rect: PlotRect = {
    x: 62,
    y: 26,
    width: Math.max(40, options.width - 96),
    height: Math.max(40, options.height - 66),
  };

  const [idxMin, idxMax] = getIndexBounds(dataset, options.viewport);
  const sliced = sliceDatasetByRange(dataset, idxMin, idxMax);
  const defaultX = sliced.series[0]?.name ?? dataset.indexAxis.key;
  const defaultY = sliced.series[1]?.name ?? sliced.series[0]?.name ?? dataset.indexAxis.key;
  const cfg: CrossplotConfig = options.crossplot ?? {
    xSeries: defaultX,
    ySeries: defaultY,
    showRegression: true,
  };

  const getValues = (name: string): number[] | null => {
    if (name === dataset.indexAxis.key) return sliced.indexValues;
    return sliced.series.find((s) => s.name === name)?.values ?? null;
  };

  const xVals = getValues(cfg.xSeries);
  const yVals = getValues(cfg.ySeries);
  const cVals = cfg.colorSeries ? getValues(cfg.colorSeries) : null;

  if (!xVals || !yVals || sliced.indexValues.length === 0) {
    drawCenteredMessage(ctx, rect, theme, "Select X and Y series for crossplot.");
    return { mode: "crossplot", plotRect: rect, indexBounds: { min: idxMin, max: idxMax }, regression: null };
  }

  const nullVal = dataset.indexAxis.nullValue;
  const [xMin, xMax] = computeSeriesBounds(xVals, "linear", nullVal);
  const [yMin, yMax] = computeSeriesBounds(yVals, "linear", nullVal);
  const [cMin, cMax] = cVals ? computeSeriesBounds(cVals, "linear", nullVal) : [0, 1];
  const cSpan = Math.abs(cMax - cMin) > 1e-12 ? cMax - cMin : 1;

  // Grid & axes
  const xTicks = niceTicks(xMin, xMax, 5);
  const yTicks = niceTicks(yMin, yMax, 5);
  ctx.font = FONT_MONO;
  ctx.lineWidth = 1;

  for (const xt of xTicks) {
    const px = mapToRange(xt, xMin, xMax, rect.x, rect.x + rect.width, "linear");
    if (px === null) continue;
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(px, rect.y);
    ctx.lineTo(px, rect.y + rect.height);
    ctx.stroke();
    ctx.fillStyle = theme.textMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(formatTick(xt), px, rect.y + rect.height + 6);
  }
  for (const yt of yTicks) {
    const py = mapToRange(yt, yMin, yMax, rect.y + rect.height, rect.y, "linear");
    if (py === null) continue;
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(rect.x, py);
    ctx.lineTo(rect.x + rect.width, py);
    ctx.stroke();
    ctx.fillStyle = theme.textMuted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatTick(yt), rect.x - 6, py);
  }

  ctx.strokeStyle = theme.axis;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

  ctx.fillStyle = theme.textMuted;
  ctx.font = FONT_SANS;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(cfg.xSeries, rect.x + rect.width * 0.5, options.height - 4);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`${cfg.ySeries} vs ${cfg.xSeries}`, rect.x, 6);

  // Scatter points
  const radius = cfg.pointRadius ?? 3;
  const maxPoints = Math.min(xVals.length, yVals.length);
  const step = maxPoints > 6000 ? Math.ceil(maxPoints / 6000) : 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();

  for (let i = 0; i < maxPoints; i += step) {
    const xv = xVals[i];
    const yv = yVals[i];
    if (!isValidSample(xv, nullVal) || !isValidSample(yv, nullVal)) continue;
    const px = mapToRange(xv, xMin, xMax, rect.x, rect.x + rect.width, "linear");
    const py = mapToRange(yv, yMin, yMax, rect.y + rect.height, rect.y, "linear");
    if (px === null || py === null) continue;

    let fill = theme.palette[0]!;
    if (cVals) {
      const cv = cVals[i];
      if (isValidSample(cv, nullVal)) {
        fill = colorRamp((cv - cMin) / cSpan);
      }
    }
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const regression = cfg.showRegression !== false ? computeLinearRegression(xVals, yVals, nullVal) : null;
  if (regression) {
    const yAtMin = regression.slope * xMin + regression.intercept;
    const yAtMax = regression.slope * xMax + regression.intercept;
    const p1x = mapToRange(xMin, xMin, xMax, rect.x, rect.x + rect.width, "linear");
    const p1y = mapToRange(yAtMin, yMin, yMax, rect.y + rect.height, rect.y, "linear");
    const p2x = mapToRange(xMax, xMin, xMax, rect.x, rect.x + rect.width, "linear");
    const p2y = mapToRange(yAtMax, yMin, yMax, rect.y + rect.height, rect.y, "linear");
    if (p1x !== null && p1y !== null && p2x !== null && p2y !== null) {
      ctx.strokeStyle = theme.regressionLine;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(p1x, p1y);
      ctx.lineTo(p2x, p2y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ctx.restore();

  if (regression) {
    ctx.fillStyle = theme.text;
    ctx.font = FONT_MONO;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(
      `y = ${formatTick(regression.slope)}x + ${formatTick(regression.intercept)}  R²=${regression.r2.toFixed(3)}`,
      rect.x + rect.width,
      6,
    );
  }

  return { mode: "crossplot", plotRect: rect, indexBounds: { min: idxMin, max: idxMax }, regression };
}

function renderHistogramChart(
  ctx: Canvas2DContextLike,
  dataset: IndexedDataset,
  options: CanvasRenderOptions,
  theme: ChartTheme,
): CanvasRenderResult {
  const rect: PlotRect = {
    x: 56,
    y: 28,
    width: Math.max(40, options.width - 76),
    height: Math.max(40, options.height - 64),
  };

  const [idxMin, idxMax] = getIndexBounds(dataset, options.viewport);
  const sliced = sliceDatasetByRange(dataset, idxMin, idxMax);
  const targetName = options.histogram?.seriesName ?? sliced.series[0]?.name ?? "";
  const series = sliced.series.find((s) => s.name === targetName) ?? sliced.series[0];

  if (!series || sliced.indexValues.length === 0) {
    drawCenteredMessage(ctx, rect, theme, "No series available for histogram.");
    return { mode: "histogram", plotRect: rect, indexBounds: { min: idxMin, max: idxMax } };
  }

  const nullVal = dataset.indexAxis.nullValue;
  const histogram = computeHistogram(series.values, {
    binCount: options.histogram?.binCount,
    nullValue: nullVal,
  });
  const stats = computeVariableStats(sliced, { seriesNames: [series.name] });

  if (histogram.totalCount === 0 || histogram.bins.length === 0) {
    drawCenteredMessage(ctx, rect, theme, `No valid samples for '${series.name}'.`);
    return { mode: "histogram", plotRect: rect, indexBounds: { min: idxMin, max: idxMax }, histogram, stats };
  }

  const maxCount = Math.max(1, ...histogram.bins.map((b) => b.count));
  const yTicks = niceTicks(0, maxCount, 5);
  ctx.font = FONT_MONO;
  ctx.lineWidth = 1;

  for (const yt of yTicks) {
    const py = mapToRange(yt, 0, maxCount, rect.y + rect.height, rect.y, "linear");
    if (py === null) continue;
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(rect.x, py);
    ctx.lineTo(rect.x + rect.width, py);
    ctx.stroke();
    ctx.fillStyle = theme.textMuted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.round(yt)), rect.x - 6, py);
  }

  const barW = rect.width / histogram.bins.length;
  for (let i = 0; i < histogram.bins.length; i++) {
    const bin = histogram.bins[i]!;
    const h = (bin.count / maxCount) * rect.height;
    const bx = rect.x + i * barW + 1;
    const by = rect.y + rect.height - h;
    ctx.fillStyle = theme.histogramBar;
    ctx.fillRect(bx, by, Math.max(1, barW - 2), h);
    ctx.strokeStyle = theme.histogramBorder;
    ctx.strokeRect(bx, by, Math.max(1, barW - 2), h);
  }

  // X axis labels
  const xTicks = niceTicks(histogram.min, histogram.max, 5);
  for (const xt of xTicks) {
    const px = mapToRange(xt, histogram.min, histogram.max, rect.x, rect.x + rect.width, "linear");
    if (px === null) continue;
    ctx.fillStyle = theme.textMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(formatTick(xt), px, rect.y + rect.height + 6);
  }

  ctx.strokeStyle = theme.axis;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

  const st = stats[0];
  ctx.fillStyle = theme.text;
  ctx.font = FONT_SANS;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`${series.name}${series.unit ? ` (${series.unit})` : ""} Histogram`, rect.x, 6);

  if (st) {
    ctx.fillStyle = theme.textMuted;
    ctx.font = FONT_MONO;
    ctx.textAlign = "right";
    ctx.fillText(
      `n=${st.count}  mean=${formatTick(st.mean)}  p50=${formatTick(st.p50)}  std=${formatTick(st.stddev)}`,
      rect.x + rect.width,
      6,
    );
  }

  ctx.fillStyle = theme.textMuted;
  ctx.font = FONT_SANS;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(series.name, rect.x + rect.width * 0.5, options.height - 4);

  return { mode: "histogram", plotRect: rect, indexBounds: { min: idxMin, max: idxMax }, histogram, stats };
}

/**
 * Renders any `IndexedDataset` into a Canvas2D context across 4 generic visualization modes:
 * `"overlay"`, `"multitrack"`, `"crossplot"`, and `"histogram"`.
 */
export function renderDatasetCanvas(
  ctx: Canvas2DContextLike,
  dataset: IndexedDataset,
  options: CanvasRenderOptions,
): CanvasRenderResult {
  const dpr = options.dpr ?? 1;
  const theme = resolveChartTheme(options.isDark ?? true, options.theme);

  ctx.save();
  if (dpr !== 1) ctx.scale(dpr, dpr);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, options.width, options.height);

  let result: CanvasRenderResult;
  switch (options.mode) {
    case "multitrack":
      result = renderMultiTrackChart(ctx, dataset, options, theme);
      break;
    case "crossplot":
      result = renderCrossplotChart(ctx, dataset, options, theme);
      break;
    case "histogram":
      result = renderHistogramChart(ctx, dataset, options, theme);
      break;
    case "overlay":
    default:
      result = renderOverlayChart(ctx, dataset, options, theme);
      break;
  }

  ctx.restore();
  return result;
}
