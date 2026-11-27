// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Canvas2D rendering routines for the Simulation Results webview:
// - Live streaming waveform rendering
// - Batch overlay, phase portrait, dual-Y, normalized rendering
// - Reachability flowpipe bands & status callouts
// - Monte Carlo fan-chart bands
// - Pinned run ghost curves, verification limits, hover tracer, measurement cursors & HUD

import {
  drawSmoothSpline,
  escapeHtmlSim,
  formatTick,
  hexToRgba,
  lttbDecimate,
  niceTicksFor,
  type PlotBounds,
} from "./simulation-signal-utils.js";
import {
  COLORS,
  getReachabilityProfileForVar,
  type LiveBuffer,
  type MonteCarloData,
  type PinnedRun,
  type PlotMargin,
  type ReachabilityData,
  type SimulationData,
  type VerificationLimit,
} from "./simulation-types.js";

export interface DrawLiveChartParams {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  liveBuffer: LiveBuffer | null;
  isDark: boolean;
  hiddenVars: Set<string>;
  customBounds: PlotBounds | null;
  defaultBounds: PlotBounds | null;
  interpolation: string;
}

export function drawLiveChart(params: DrawLiveChartParams): void {
  const { canvas, ctx, liveBuffer, isDark, hiddenVars, customBounds, defaultBounds, interpolation } = params;
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
  const bounds = customBounds || defaultBounds || { tMin: 0, tMax: 1, yMin: 0, yMax: 1 };
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

    if (interpolation === "smooth") {
      drawSmoothSpline(ctx, pts);
    } else {
      let prevPy = 0;
      let started = false;
      for (const pt of pts) {
        if (!started) {
          ctx.moveTo(pt.x, pt.y);
          started = true;
        } else {
          if (interpolation === "step-after") {
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

export interface DrawBatchOverlayParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  currentData: SimulationData;
  currentMCData: MonteCarloData | null;
  currentReachabilityData: ReachabilityData | null;
  currentLimits: VerificationLimit[];
  pinnedRuns: PinnedRun[];
  hiddenVars: Set<string>;
  customRightVars: Set<string>;
  isDark: boolean;
  isNormalized: boolean;
  isDualY: boolean;
  selectedXVar: string;
  interpolation: string;
  margin: PlotMargin;
  customBounds: PlotBounds | null;
  defaultBounds: PlotBounds | null;
  hoverIndex: number | null;
  cursorsEnabled: boolean;
  cursorA: number | null;
  cursorB: number | null;
  cursorHudEl: HTMLElement | null;
}

export function drawBatchOverlayChart(params: DrawBatchOverlayParams): void {
  const {
    ctx,
    width: w,
    height: h,
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
    interpolation,
    margin,
    customBounds,
    defaultBounds,
    hoverIndex,
    cursorsEnabled,
    cursorA,
    cursorB,
    cursorHudEl,
  } = params;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Colors
  const fgColor = isDark ? "#ccc" : "#333";
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const axisColor = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";

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

  const bounds = customBounds || defaultBounds || { tMin: 0, tMax: 1, yMin: 0, yMax: 1 };
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

  // ── Multi-Domain Reachability Flowpipe Bands ──
  if (currentReachabilityData && currentReachabilityData.t.length > 0 && selectedXVar === "__time__") {
    const reachT = currentReachabilityData.t;
    const reachVarsToDraw = activeVars.length > 0 ? activeVars : [currentReachabilityData.variable];

    for (const vName of reachVarsToDraw) {
      const profile = getReachabilityProfileForVar(currentReachabilityData, vName);
      if (!profile || profile.envelopes.length === 0) continue;
      const vi = Math.max(0, states.indexOf(vName));

      const sortedEnvelopes = [...profile.envelopes].sort((a, b) => {
        const order: Record<string, number> = { interval: 0, octagon: 1, affine: 2, zonotope: 3 };
        return (order[a.kind] ?? 0) - (order[b.kind] ?? 0);
      });

      for (const env of sortedEnvelopes) {
        const fill = env.fillColor || (isDark ? "rgba(34, 197, 94, 0.2)" : "rgba(34, 197, 94, 0.15)");
        ctx.fillStyle = fill;
        ctx.beginPath();

        let started = false;
        for (let i = 0; i < reachT.length; i++) {
          const hi = env.hi[i];
          if (hi === undefined || !isFinite(hi)) continue;
          const x = xScale(reachT[i]);
          const py = getPtY(vi, hi);
          if (!started) {
            ctx.moveTo(x, py);
            started = true;
          } else {
            ctx.lineTo(x, py);
          }
        }
        for (let i = reachT.length - 1; i >= 0; i--) {
          const lo = env.lo[i];
          if (lo === undefined || !isFinite(lo)) continue;
          ctx.lineTo(xScale(reachT[i]), getPtY(vi, lo));
        }
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = env.color;
        ctx.lineWidth = env.lineWidth ?? 1.2;
        if (env.borderDash) ctx.setLineDash(env.borderDash);
        else ctx.setLineDash([]);

        ctx.beginPath();
        started = false;
        for (let i = 0; i < reachT.length; i++) {
          const hi = env.hi[i];
          if (hi === undefined || !isFinite(hi)) continue;
          const x = xScale(reachT[i]);
          const py = getPtY(vi, hi);
          if (!started) {
            ctx.moveTo(x, py);
            started = true;
          } else {
            ctx.lineTo(x, py);
          }
        }
        ctx.stroke();

        ctx.beginPath();
        started = false;
        for (let i = 0; i < reachT.length; i++) {
          const lo = env.lo[i];
          if (lo === undefined || !isFinite(lo)) continue;
          const x = xScale(reachT[i]);
          const py = getPtY(vi, lo);
          if (!started) {
            ctx.moveTo(x, py);
            started = true;
          } else {
            ctx.lineTo(x, py);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    const zeroY = yScaleLeft(0.0);
    if (zeroY >= margin.top && zeroY <= margin.top + plotH) {
      ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.25)" : "rgba(0, 0, 0, 0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin.left, zeroY);
      ctx.lineTo(margin.left + plotW, zeroY);
      ctx.stroke();
    }
  }

  // ── Fan-chart bands (Monte Carlo percentile shading) ──
  if (currentMCData && currentMCData.t.length > 0) {
    const mcT = currentMCData.t;
    for (let vi = 0; vi < states.length; vi++) {
      if (hiddenVars.has(states[vi])) continue;
      const stats = currentMCData.statistics[states[vi]];
      if (!stats) continue;

      const color = COLORS[vi % COLORS.length];
      const bands: { lo: number[]; hi: number[]; alpha: number }[] = [];

      if (stats.percentiles.p5 && stats.percentiles.p95) {
        bands.push({ lo: stats.percentiles.p5, hi: stats.percentiles.p95, alpha: 0.1 });
      }
      if (stats.percentiles.p25 && stats.percentiles.p75) {
        bands.push({ lo: stats.percentiles.p25, hi: stats.percentiles.p75, alpha: 0.18 });
      }
      if (stats.ciLo && stats.ciHi) {
        bands.push({ lo: stats.ciLo, hi: stats.ciHi, alpha: 0.28 });
      }

      for (const band of bands) {
        ctx.fillStyle = hexToRgba(color, band.alpha);
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < mcT.length; i++) {
          const hi = band.hi[i];
          if (hi === undefined || !isFinite(hi)) continue;
          const x = xScale(mcT[i]);
          const py = getPtY(vi, hi);
          if (!started) {
            ctx.moveTo(x, py);
            started = true;
          } else {
            ctx.lineTo(x, py);
          }
        }
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

  // ── Pinned Run Baselines (Ghost Curves) ──
  const GHOST_DASHES: number[][] = [
    [4, 4],
    [8, 3],
    [2, 3],
    [10, 3, 2, 3],
  ];
  for (let ri = 0; ri < pinnedRuns.length; ri++) {
    const pinnedRun = pinnedRuns[ri].data;
    if (!pinnedRuns[ri].visible || pinnedRun.t.length === 0) continue;
    ctx.save();
    ctx.setLineDash(GHOST_DASHES[ri % GHOST_DASHES.length]);
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
      if (interpolation === "smooth") {
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

      if (interpolation === "smooth") {
        drawSmoothSpline(ctx, drawPts);
      } else {
        let prevPy = 0;
        let started = false;
        for (const pt of drawPts) {
          if (!started) {
            ctx.moveTo(pt.x, pt.y);
            started = true;
          } else {
            if (interpolation === "step-after") {
              ctx.lineTo(pt.x, prevPy);
            }
            ctx.lineTo(pt.x, pt.y);
          }
          prevPy = pt.y;
        }
      }
      ctx.stroke();

      if (xVarIdx >= 0 && pts.length > 0) {
        ctx.fillStyle = "#3fb950";
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, 4, 0, Math.PI * 2);
        ctx.fill();

        const lastPt = pts[pts.length - 1];
        ctx.fillStyle = "#f85149";
        ctx.fillRect(lastPt.x - 3, lastPt.y - 3, 6, 6);
      }
    }
  }

  ctx.restore();

  // ── Verification limit lines ──
  const effectiveLimits: VerificationLimit[] = [...currentLimits];
  if (currentReachabilityData) {
    const reachVarsForLimits = activeVars.length > 0 ? activeVars : [currentReachabilityData.variable];
    for (const vName of reachVarsForLimits) {
      const profile = getReachabilityProfileForVar(currentReachabilityData, vName);
      if (profile && profile.requirementLimit !== undefined && isFinite(profile.requirementLimit)) {
        const exists = effectiveLimits.some(
          (l) => l.variable === vName && Math.abs(l.value - profile.requirementLimit!) < 1e-9,
        );
        if (!exists) {
          effectiveLimits.push({
            variable: vName,
            value: profile.requirementLimit,
            label: profile.requirementLabel || `Limit (${vName}): ${profile.requirementLimit}`,
            violated: !profile.isCertifiedSafe,
            direction: profile.requirementDirection ?? "max",
          });
        }
      }
    }
  }

  if (effectiveLimits.length > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(margin.left, margin.top, plotW, plotH);
    ctx.clip();

    for (const limit of effectiveLimits) {
      const limitVi = states.indexOf(limit.variable);
      if (limitVi >= 0 && hiddenVars.has(limit.variable)) continue;
      const ly = limitVi >= 0 ? getPtY(limitVi, limit.value) : yScaleLeft(limit.value);
      if (ly >= margin.top && ly <= margin.top + plotH) {
        ctx.strokeStyle = limit.violated ? "#f14c4c" : "#3fb950";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(margin.left, ly);
        ctx.lineTo(margin.left + plotW, ly);
        ctx.stroke();
        ctx.setLineDash([]);

        if (limit.violated) {
          ctx.fillStyle = isDark ? "rgba(241, 76, 76, 0.06)" : "rgba(241, 76, 76, 0.08)";
          if (limit.direction === "min") {
            ctx.fillRect(margin.left, ly, plotW, margin.top + plotH - ly);
          } else {
            ctx.fillRect(margin.left, margin.top, plotW, ly - margin.top);
          }
        }

        ctx.font = "bold 11px var(--vscode-editor-font-family, monospace)";
        ctx.fillStyle = limit.violated ? "#f14c4c" : "#3fb950";
        ctx.textAlign = "right";
        ctx.textBaseline = limit.direction === "min" ? "top" : "bottom";
        ctx.fillText(limit.label, margin.left + plotW - 4, limit.direction === "min" ? ly + 3 : ly - 3);
      }
    }

    ctx.restore();
  }

  // Draw Reachability Status Callouts
  if (currentReachabilityData) {
    const badgesToDraw: { text: string; kind: "pass" | "warn" | "fail" }[] = [];
    const reachVarsForBadges = activeVars.length > 0 ? activeVars : [currentReachabilityData.variable];
    for (const vName of reachVarsForBadges) {
      const profile = getReachabilityProfileForVar(currentReachabilityData, vName);
      if (profile?.statusBadges) {
        for (const b of profile.statusBadges) {
          badgesToDraw.push(b);
        }
      }
    }
    if (badgesToDraw.length === 0 && currentReachabilityData.statusBadges) {
      badgesToDraw.push(...currentReachabilityData.statusBadges);
    }

    let badgeY = margin.top + 16;
    for (const badge of badgesToDraw.slice(0, 6)) {
      ctx.save();
      ctx.font = "bold 11px var(--vscode-editor-font-family, monospace)";
      const textWidth = ctx.measureText(badge.text).width;
      const padX = 8;
      const badgeX = margin.left + 16;

      ctx.fillStyle =
        badge.kind === "pass"
          ? "rgba(34, 197, 94, 0.18)"
          : badge.kind === "warn"
            ? "rgba(245, 158, 11, 0.18)"
            : "rgba(239, 68, 68, 0.18)";
      ctx.strokeStyle = badge.kind === "pass" ? "#22c55e" : badge.kind === "warn" ? "#f59e0b" : "#ef4444";
      ctx.lineWidth = 1;

      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(badgeX, badgeY - 12, textWidth + padX * 2, 22, 4);
      } else {
        ctx.rect(badgeX, badgeY - 12, textWidth + padX * 2, 22);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = badge.kind === "pass" ? "#22c55e" : badge.kind === "warn" ? "#f59e0b" : "#ef4444";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(badge.text, badgeX + padX, badgeY - 1);
      ctx.restore();

      badgeY += 28;
    }
  }

  // Draw hover tracer
  if (hoverIndex !== null && hoverIndex < t.length) {
    const hx = getPtX(hoverIndex);

    ctx.strokeStyle = axisColor;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, margin.top);
    ctx.lineTo(hx, margin.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

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
    const leftX = Math.max(margin.left, Math.min(xPosA, xPosB));
    const rightX = Math.min(margin.left + plotW, Math.max(xPosA, xPosB));
    if (rightX > leftX) {
      ctx.fillStyle = isDark ? "rgba(56, 189, 248, 0.08)" : "rgba(14, 165, 233, 0.09)";
      ctx.fillRect(leftX, margin.top, rightX - leftX, plotH);
    }

    if (xPosA >= margin.left && xPosA <= margin.left + plotW) {
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(xPosA, margin.top);
      ctx.lineTo(xPosA, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(xPosA - 10, margin.top, 20, 16);
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("A", xPosA, margin.top + 8);
    }

    if (xPosB >= margin.left && xPosB <= margin.left + plotW) {
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(xPosB, margin.top);
      ctx.lineTo(xPosB, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(xPosB - 10, margin.top, 20, 16);
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("B", xPosB, margin.top + 8);
    }

    if (Math.abs(xPosB - xPosA) > 28) {
      const spanY = margin.top + plotH - 18;
      ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xPosA, spanY);
      ctx.lineTo(xPosB, spanY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xPosA, spanY - 3);
      ctx.lineTo(xPosA, spanY + 3);
      ctx.moveTo(xPosB, spanY - 3);
      ctx.lineTo(xPosB, spanY + 3);
      ctx.stroke();
    }
    ctx.restore();

    if (cursorHudEl) {
      const dt = Math.abs(cursorB - cursorA);
      const freq = dt > 1e-9 ? 1 / dt : 0;

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
  } else if (cursorHudEl) {
    cursorHudEl.classList.remove("visible");
  }
}

export interface HoverTooltipParams {
  currentData: SimulationData;
  currentMCData: MonteCarloData | null;
  closest: number;
  selectedXVar: string;
  isDualY: boolean;
  isNormalized: boolean;
  hiddenVars: Set<string>;
  customRightVars: Set<string>;
}

export function buildHoverTooltipHtml(params: HoverTooltipParams): string {
  const { currentData, currentMCData, closest, selectedXVar, isDualY, isNormalized, hiddenVars, customRightVars } =
    params;
  const { t, y, states, sweepResults } = currentData;
  const xVarIdx = selectedXVar !== "__time__" ? states.indexOf(selectedXVar) : -1;

  let html = "";
  if (xVarIdx >= 0) {
    const curXVal = y[closest]?.[xVarIdx];
    html = `<div style="margin-bottom:4px;font-weight:600">t = ${t[closest].toFixed(4)}s &nbsp;|&nbsp; ${escapeHtmlSim(states[xVarIdx])} = ${curXVal !== undefined ? curXVal.toFixed(4) : "N/A"}</div>`;
  } else {
    html = `<div style="margin-bottom:4px;font-weight:600">t = ${t[closest].toFixed(4)}s</div>`;
  }

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

  return html;
}
