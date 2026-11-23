// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/endf6 — Pure SVG Log-Log Neutron Cross-Section Plotter.
 *
 * Renders `sigma(E)` (barns) vs. incident neutron energy `E` (eV) on a logarithmic
 * decade grid for `MF=3` pointwise cross-sections (`MT=1, 2, 18, 102`, ...) with
 * optional `MF=2 MT=151` SLBW resonance reconstruction overlay.
 */

import { ENDF6_MT_DESCRIPTORS } from "../catalog/endf6-std-schemas.js";
import { evaluateTab1 } from "../solver/interpolation.js";
import { evaluateSlbwRange } from "../solver/resonance.js";
import type { Endf6Material, Endf6Tape } from "../types.js";

export interface Endf6PlotOptions {
  /** Plot SVG width in pixels (default: `780`). */
  width?: number | undefined;
  /** Plot SVG height in pixels (default: `440`). */
  height?: number | undefined;
  /** Optional MAT number to plot (defaults to first material in the tape). */
  mat?: number | undefined;
  /** Optional list of MT numbers to include (defaults to all MTs present in MF=3). */
  mts?: readonly number[] | undefined;
  /** Whether to overlay MF=2 MT=151 SLBW resonance total curve when present (default: `true`). */
  showResonances?: boolean | undefined;
  /** Theme color mode (`"dark"` | `"light"`, default: `"dark"`). */
  colorMode?: "dark" | "light" | undefined;
  /** Number of log-spaced sample points per curve (default: `160`). */
  samples?: number | undefined;
}

const FALLBACK_COLORS = ["#60a5fa", "#34d399", "#f43f5e", "#fbbf24", "#a78bfa", "#38bdf8", "#fb923c"];

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDecadeLabel(exp: number): string {
  if (exp === 0) return "1";
  if (exp === 1) return "10";
  if (exp === -1) return "0.1";
  return `10^${exp}`;
}

/**
 * Renders a pure SVG log-log neutron cross-section plot `sigma(E)` vs `E` for an `Endf6Tape` or `Endf6Material`.
 */
export function renderEndf6CrossSectionSvg(
  tapeOrMaterial: Endf6Tape | Endf6Material,
  options?: Endf6PlotOptions,
): string {
  const width = options?.width ?? 780;
  const height = options?.height ?? 440;
  const isLight = options?.colorMode === "light";
  const samples = Math.max(24, options?.samples ?? 160);
  const showResonances = options?.showResonances ?? true;

  let material: Endf6Material | undefined;
  if ("materials" in tapeOrMaterial) {
    material =
      options?.mat !== undefined
        ? tapeOrMaterial.materials.get(options.mat)
        : tapeOrMaterial.materials.values().next().value;
  } else {
    material = tapeOrMaterial;
  }

  const bg = isLight ? "#ffffff" : "#0b1120";
  const plotBg = isLight ? "#f8fafc" : "#0f172a";
  const gridColor = isLight ? "#e2e8f0" : "#1e293b";
  const axisColor = isLight ? "#475569" : "#94a3b8";
  const textColor = isLight ? "#0f172a" : "#e2e8f0";
  const subTextColor = isLight ? "#64748b" : "#94a3b8";

  if (!material || (material.crossSections.size === 0 && material.resonances.length === 0)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${bg}" rx="8"/>
  <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="${subTextColor}" font-family="sans-serif" font-size="14">No MF=3 cross-section or MF=2 resonance data available to plot.</text>
</svg>`;
  }

  const padLeft = 74;
  const padRight = 28;
  const padTop = 48;
  const padBottom = 64;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const mtFilter = options?.mts ? new Set(options.mts) : null;
  const sections = [...material.crossSections.values()]
    .filter((s) => (!mtFilter || mtFilter.has(s.mt)) && s.tab1.points.length > 0)
    .sort((a, b) => a.mt - b.mt);

  // Determine log10(E) and log10(sigma) bounds
  let minLogE = Number.POSITIVE_INFINITY;
  let maxLogE = Number.NEGATIVE_INFINITY;
  let minLogS = Number.POSITIVE_INFINITY;
  let maxLogS = Number.NEGATIVE_INFINITY;

  const series: Array<{
    label: string;
    mt: number;
    line: number;
    color: string;
    dashed?: boolean;
    points: Array<{ e: number; s: number }>;
  }> = [];

  for (let idx = 0; idx < sections.length; idx++) {
    const sec = sections[idx]!;
    const pts = sec.tab1.points;
    const eMin = Math.max(1e-10, pts[0]!.x);
    const eMax = Math.max(eMin * 10, pts[pts.length - 1]!.x);
    const logEMin = Math.log10(eMin);
    const logEMax = Math.log10(eMax);

    const sampled: Array<{ e: number; s: number }> = [];
    for (let i = 0; i <= samples; i++) {
      const logE = logEMin + ((logEMax - logEMin) * i) / samples;
      const e = Math.pow(10, logE);
      const s = evaluateTab1(sec.tab1, e);
      if (s > 1e-12) {
        sampled.push({ e, s });
        const ls = Math.log10(s);
        if (logE < minLogE) minLogE = logE;
        if (logE > maxLogE) maxLogE = logE;
        if (ls < minLogS) minLogS = ls;
        if (ls > maxLogS) maxLogS = ls;
      }
    }

    const desc = ENDF6_MT_DESCRIPTORS.get(sec.mt);
    const color = desc?.color ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]!;
    series.push({
      label: desc ? `MT=${sec.mt} ${desc.name}` : `MT=${sec.mt}`,
      mt: sec.mt,
      line: sec.line,
      color,
      points: sampled,
    });
  }

  // Optional SLBW resonance curve overlay from MF=2 MT=151
  if (showResonances && material.resonances.length > 0) {
    const range = material.resonances[0]!;
    if (range.resonances.length > 0) {
      const eMin = Math.max(1e-5, range.el > 0 ? range.el : 1e-5);
      const eMax = Math.max(eMin * 10, range.eh > eMin ? Math.min(range.eh, 1e4) : 1e3);
      const logEMin = Math.log10(eMin);
      const logEMax = Math.log10(eMax);
      const resPoints: Array<{ e: number; s: number }> = [];
      const resSamples = Math.max(samples, 200);
      for (let i = 0; i <= resSamples; i++) {
        const logE = logEMin + ((logEMax - logEMin) * i) / resSamples;
        const e = Math.pow(10, logE);
        const xs = evaluateSlbwRange(range, e);
        if (xs.total > 1e-12) {
          resPoints.push({ e, s: xs.total });
          const ls = Math.log10(xs.total);
          if (logE < minLogE) minLogE = logE;
          if (logE > maxLogE) maxLogE = logE;
          if (ls < minLogS) minLogS = ls;
          if (ls > maxLogS) maxLogS = ls;
        }
      }
      series.push({
        label: "MF=2 SLBW Total",
        mt: 151,
        line: range.line,
        color: "#a78bfa",
        dashed: true,
        points: resPoints,
      });
    }
  }

  if (!Number.isFinite(minLogE) || !Number.isFinite(minLogS)) {
    minLogE = -5;
    maxLogE = 7;
    minLogS = -2;
    maxLogS = 4;
  }

  const xDecMin = Math.floor(minLogE);
  const xDecMax = Math.ceil(maxLogE);
  const yDecMin = Math.floor(minLogS);
  const yDecMax = Math.ceil(maxLogS);
  const xSpan = Math.max(1, xDecMax - xDecMin);
  const ySpan = Math.max(1, yDecMax - yDecMin);

  const mapX = (e: number): number => padLeft + ((Math.log10(e) - xDecMin) / xSpan) * plotW;
  const mapY = (s: number): number => padTop + plotH - ((Math.log10(s) - yDecMin) / ySpan) * plotH;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-endf6-mat="${material.mat}">`,
  );
  out.push(`  <rect width="${width}" height="${height}" fill="${bg}" rx="8"/>`);
  out.push(
    `  <rect x="${padLeft}" y="${padTop}" width="${plotW}" height="${plotH}" fill="${plotBg}" stroke="${gridColor}" stroke-width="1"/>`,
  );

  // Title
  out.push(
    `  <text x="${padLeft}" y="28" fill="${textColor}" font-family="sans-serif" font-size="14" font-weight="600">${escapeXml(material.name)} Neutron Cross-Sections (MAT=${material.mat}, ZA=${Math.round(material.za)})</text>`,
  );

  // Vertical decade gridlines (Energy eV)
  const xStep = xSpan > 10 ? 2 : 1;
  for (let d = xDecMin; d <= xDecMax; d += xStep) {
    const x = padLeft + ((d - xDecMin) / xSpan) * plotW;
    out.push(
      `  <line x1="${x.toFixed(1)}" y1="${padTop}" x2="${x.toFixed(1)}" y2="${padTop + plotH}" stroke="${gridColor}" stroke-width="1"/>`,
    );
    out.push(
      `  <text x="${x.toFixed(1)}" y="${padTop + plotH + 18}" text-anchor="middle" fill="${subTextColor}" font-family="monospace" font-size="10">${formatDecadeLabel(d)}</text>`,
    );
  }

  // Horizontal decade gridlines (Cross-section barns)
  for (let d = yDecMin; d <= yDecMax; d++) {
    const y = padTop + plotH - ((d - yDecMin) / ySpan) * plotH;
    out.push(
      `  <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${padLeft + plotW}" y2="${y.toFixed(1)}" stroke="${gridColor}" stroke-width="1"/>`,
    );
    out.push(
      `  <text x="${padLeft - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" fill="${subTextColor}" font-family="monospace" font-size="10">${formatDecadeLabel(d)}</text>`,
    );
  }

  // Axis border & labels
  out.push(
    `  <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + plotH}" stroke="${axisColor}" stroke-width="1.2"/>`,
  );
  out.push(
    `  <line x1="${padLeft}" y1="${padTop + plotH}" x2="${padLeft + plotW}" y2="${padTop + plotH}" stroke="${axisColor}" stroke-width="1.2"/>`,
  );
  out.push(
    `  <text x="${padLeft + plotW / 2}" y="${height - 14}" text-anchor="middle" fill="${textColor}" font-family="sans-serif" font-size="11">Incident Neutron Energy E (eV) — log scale</text>`,
  );
  out.push(
    `  <text x="18" y="${padTop + plotH / 2}" text-anchor="middle" fill="${textColor}" font-family="sans-serif" font-size="11" transform="rotate(-90 18 ${padTop + plotH / 2})">Cross-Section σ(E) (barns) — log scale</text>`,
  );

  // Curves
  for (const s of series) {
    if (s.points.length < 2) continue;
    const dAttr = s.points
      .map((pt, idx) => `${idx === 0 ? "M" : "L"}${mapX(pt.e).toFixed(1)},${mapY(pt.s).toFixed(1)}`)
      .join(" ");
    const dash = s.dashed ? ` stroke-dasharray="5,3"` : "";
    out.push(
      `  <path d="${dAttr}" fill="none" stroke="${s.color}" stroke-width="2"${dash} data-line="${s.line}" data-mt="${s.mt}"/>`,
    );
  }

  // Legend (top-right inside plot)
  const legendW = 162;
  const legendH = 14 + series.length * 18;
  const legendX = padLeft + plotW - legendW - 10;
  const legendY = padTop + 10;
  out.push(
    `  <rect x="${legendX}" y="${legendY}" width="${legendW}" height="${legendH}" fill="${bg}" fill-opacity="0.88" stroke="${gridColor}" rx="4"/>`,
  );
  series.forEach((s, i) => {
    const ly = legendY + 18 + i * 18;
    const dash = s.dashed ? ` stroke-dasharray="4,2"` : "";
    out.push(
      `  <line x1="${legendX + 10}" y1="${ly - 3}" x2="${legendX + 28}" y2="${ly - 3}" stroke="${s.color}" stroke-width="2"${dash}/>`,
    );
    out.push(
      `  <text x="${legendX + 34}" y="${ly}" fill="${textColor}" font-family="sans-serif" font-size="10.5" data-line="${s.line}">${escapeXml(s.label)}</text>`,
    );
  });

  out.push("</svg>");
  return out.join("\n");
}
