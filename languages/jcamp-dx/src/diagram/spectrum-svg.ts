// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure SVG Analytical Spectrum Renderer for `@modelscript/jcamp-dx`.
 *
 * Supports:
 * - Reversed X-axis for IR (wavenumber cm^-1) and NMR (chemical shift ppm)
 * - Ascending X-axis for Mass Spectra (m/z), UV/Vis (nm), and Raman
 * - Stick-plot rendering for Mass Spectra / Peak Tables, continuous polyline for XYDATA
 * - Live Absorbance <-> Transmittance Y-axis conversion toggle
 * - Annotated spectral peak markers with wavenumber/ppm & IR functional group labels
 */

import { matchIrFunctionalGroup } from "../catalog/jcamp-dx-std-schemas.js";
import { parseJcampDx } from "../parser/jcamp-parser.js";
import { convertSpectrumY, findSpectralPeaks } from "../solver/spectroscopy.js";
import type { JcampBlock, JcampDataPoint, JcampDocument, SpectralPeak } from "../types.js";

export type SpectrumYDisplayMode = "native" | "absorbance" | "transmittance";

export interface SpectrumSvgOptions {
  width?: number;
  height?: number;
  yMode?: SpectrumYDisplayMode;
  reverseX?: boolean;
  showPeaks?: boolean;
  maxAnnotatedPeaks?: number;
  colorMode?: "dark" | "light";
  title?: string;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function detectNativeYMode(yUnits?: string): "absorbance" | "transmittance" | "percent-transmittance" | "other" {
  const u = (yUnits ?? "").toUpperCase();
  if (u.includes("ABSORB")) return "absorbance";
  if (u.includes("%T") || u.includes("PERCENT")) return "percent-transmittance";
  if (u.includes("TRANS")) return "transmittance";
  return "other";
}

function shouldReverseX(block: JcampBlock, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  const dt = (block.dataType ?? "").toUpperCase();
  const xu = (block.xUnits ?? "").toUpperCase();
  if (dt.includes("INFRARED") || dt.includes("IR") || dt.includes("NMR")) return true;
  if (xu.includes("1/CM") || xu.includes("CM-1") || xu.includes("PPM")) return true;
  return false;
}

function isStickPlot(block: JcampBlock): boolean {
  const dt = (block.dataType ?? "").toUpperCase();
  if (dt.includes("MASS")) return true;
  return block.points.length === 0 && block.peakTable.length > 0;
}

/**
 * Renders a JCAMP-DX spectrum as a standalone, responsive SVG string.
 */
export function renderJcampDxSpectrumSvg(
  input: string | JcampDocument | JcampBlock,
  options: SpectrumSvgOptions = {},
): string {
  const block: JcampBlock | null =
    typeof input === "string" ? parseJcampDx(input).primary : "blocks" in input ? input.primary : input;

  const width = options.width ?? 760;
  const height = options.height ?? 380;
  const isDark = (options.colorMode ?? "dark") === "dark";

  const bg = isDark ? "#0f172a" : "#ffffff";
  const plotBg = isDark ? "#111827" : "#f8fafc";
  const gridColor = isDark ? "#1e293b" : "#e2e8f0";
  const axisColor = isDark ? "#64748b" : "#475569";
  const textColor = isDark ? "#e2e8f0" : "#0f172a";
  const mutedText = isDark ? "#94a3b8" : "#64748b";
  const traceColor = isDark ? "#38bdf8" : "#0284c7";
  const peakColor = isDark ? "#f59e0b" : "#d97706";

  if (!block || (block.points.length === 0 && block.peakTable.length === 0)) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" fill="${bg}" rx="8"/>` +
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="${mutedText}">No spectral data available</text>` +
      `</svg>`
    );
  }

  const rawPoints = block.points.length > 0 ? block.points : block.peakTable;
  const nativeY = detectNativeYMode(block.yUnits);
  const yMode = options.yMode ?? "native";

  let displayPoints: JcampDataPoint[] = rawPoints;
  let yLabel = block.yUnits || block.yLabel || "Intensity";
  let effectiveYKind: "absorbance" | "transmittance" | "other" =
    nativeY === "absorbance" ? "absorbance" : nativeY === "other" ? "other" : "transmittance";

  if (yMode !== "native" && nativeY !== "other") {
    if (yMode === "absorbance") {
      displayPoints = convertSpectrumY(rawPoints, nativeY, "absorbance");
      yLabel = "ABSORBANCE (AU)";
      effectiveYKind = "absorbance";
    } else if (yMode === "transmittance") {
      displayPoints = convertSpectrumY(rawPoints, nativeY, "transmittance");
      yLabel = "TRANSMITTANCE";
      effectiveYKind = "transmittance";
    }
  }

  const reverseX = shouldReverseX(block, options.reverseX);
  const stick = isStickPlot(block);
  const showPeaks = options.showPeaks ?? true;
  const maxAnnotated = options.maxAnnotatedPeaks ?? 8;

  const padL = 68;
  const padR = 28;
  const padT = 44;
  const padB = 54;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of displayPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX === maxX) {
    minX -= 1;
    maxX += 1;
  }
  if (stick) {
    minY = Math.min(0, minY);
  }
  const ySpan = maxY - minY || 1;
  const yLo = stick ? minY : minY - ySpan * 0.08;
  const yHi = maxY + ySpan * 0.14;

  const mapX = (x: number): number => {
    const frac = (x - minX) / (maxX - minX);
    return padL + (reverseX ? 1 - frac : frac) * plotW;
  };
  const mapY = (y: number): number => {
    const frac = (y - yLo) / (yHi - yLo);
    return padT + (1 - frac) * plotH;
  };

  // Detect peaks for annotation
  const isIr =
    (block.dataType ?? "").toUpperCase().includes("INFRARED") || (block.xUnits ?? "").toUpperCase().includes("1/CM");
  let peaks: SpectralPeak[] = [];
  if (showPeaks) {
    if (stick) {
      peaks = [...displayPoints]
        .map((p, idx) => ({ index: idx, x: p.x, y: p.y, prominence: p.y, kind: "maximum" as const }))
        .sort((a, b) => b.y - a.y)
        .slice(0, maxAnnotated);
    } else {
      const peakMode = effectiveYKind === "transmittance" ? "minima" : "maxima";
      peaks = findSpectralPeaks(displayPoints, {
        mode: peakMode,
        minProminence: ySpan * 0.06,
        minDistance: Math.max(2, Math.floor(displayPoints.length / 25)),
      })
        .sort((a, b) => b.prominence - a.prominence)
        .slice(0, maxAnnotated);
    }
  }

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-reverse-x="${reverseX}" data-y-mode="${yMode}">`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="${bg}" rx="8"/>`);
  parts.push(
    `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="${plotBg}" stroke="${axisColor}" stroke-width="1"/>`,
  );

  // Title
  const titleText = options.title ?? block.title ?? "JCAMP-DX Spectrum";
  const subtitle = [block.dataType, reverseX ? "Reversed Axis" : ""].filter(Boolean).join(" · ");
  parts.push(
    `<text x="${padL}" y="24" font-family="sans-serif" font-size="13" font-weight="600" fill="${textColor}">${escapeXml(titleText)}</text>`,
  );
  if (subtitle) {
    parts.push(
      `<text x="${width - padR}" y="24" text-anchor="end" font-family="monospace" font-size="10.5" fill="${mutedText}">${escapeXml(subtitle)}</text>`,
    );
  }

  // Grid & X ticks (6 ticks)
  const xTicks = 6;
  for (let i = 0; i <= xTicks; i++) {
    const frac = i / xTicks;
    const xVal = reverseX ? maxX - frac * (maxX - minX) : minX + frac * (maxX - minX);
    const sx = padL + frac * plotW;
    parts.push(
      `<line x1="${sx.toFixed(1)}" y1="${padT}" x2="${sx.toFixed(1)}" y2="${padT + plotH}" stroke="${gridColor}" stroke-width="1"/>`,
    );
    parts.push(
      `<line x1="${sx.toFixed(1)}" y1="${padT + plotH}" x2="${sx.toFixed(1)}" y2="${padT + plotH + 5}" stroke="${axisColor}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${sx.toFixed(1)}" y="${padT + plotH + 18}" text-anchor="middle" font-family="monospace" font-size="10" fill="${mutedText}">${xVal.toFixed(maxX - minX < 20 ? 2 : 0)}</text>`,
    );
  }

  // Grid & Y ticks (5 ticks)
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const frac = i / yTicks;
    const yVal = yLo + frac * (yHi - yLo);
    const sy = padT + (1 - frac) * plotH;
    parts.push(
      `<line x1="${padL}" y1="${sy.toFixed(1)}" x2="${padL + plotW}" y2="${sy.toFixed(1)}" stroke="${gridColor}" stroke-width="1"/>`,
    );
    parts.push(
      `<line x1="${padL - 5}" y1="${sy.toFixed(1)}" x2="${padL}" y2="${sy.toFixed(1)}" stroke="${axisColor}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${padL - 8}" y="${(sy + 3.5).toFixed(1)}" text-anchor="end" font-family="monospace" font-size="10" fill="${mutedText}">${yVal.toFixed(2)}</text>`,
    );
  }

  // Axis labels
  const xLabel = block.xUnits || block.xLabel || "X";
  parts.push(
    `<text x="${padL + plotW / 2}" y="${height - 12}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${textColor}">${escapeXml(xLabel)}</text>`,
  );
  parts.push(
    `<text x="18" y="${padT + plotH / 2}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="${textColor}" transform="rotate(-90 18 ${padT + plotH / 2})">${escapeXml(yLabel)}</text>`,
  );

  // Spectrum trace
  if (stick) {
    const yZero = mapY(0);
    for (const p of displayPoints) {
      const sx = mapX(p.x);
      const sy = mapY(p.y);
      parts.push(
        `<line x1="${sx.toFixed(1)}" y1="${yZero.toFixed(1)}" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${traceColor}" stroke-width="1.8"/>`,
      );
    }
  } else {
    const sorted = [...displayPoints].sort((a, b) => a.x - b.x);
    const polyPts = sorted.map((p) => `${mapX(p.x).toFixed(1)},${mapY(p.y).toFixed(1)}`).join(" ");
    parts.push(
      `<polyline fill="none" stroke="${traceColor}" stroke-width="1.8" stroke-linejoin="round" points="${polyPts}"/>`,
    );
  }

  // Peak annotations
  for (const pk of peaks) {
    const sx = mapX(pk.x);
    const sy = mapY(pk.y);
    const fg = isIr ? matchIrFunctionalGroup(pk.x) : undefined;
    const xFmt = pk.x >= 100 ? pk.x.toFixed(0) : pk.x.toFixed(2);
    const labelText = fg ? `${xFmt} (${fg.bond})` : xFmt;
    const isMin = pk.kind === "minimum";
    const labelY = isMin ? Math.min(padT + plotH - 6, sy + 16) : Math.max(padT + 12, sy - 10);

    parts.push(
      `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="3.2" fill="${peakColor}" stroke="${bg}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${sx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="9.5" font-weight="600" fill="${peakColor}">${escapeXml(labelText)}</text>`,
    );
  }

  parts.push("</svg>");
  return parts.join("");
}
