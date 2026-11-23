// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — Pure SVG Multi-Channel Space-Physics Time-Series Strip-Chart Viewer.
 */

import { cdfEpochToIso, parseTimeValueToCdfEpoch } from "../solver/epoch.js";
import { analyzeNasaCdfTelemetry } from "../solver/statistics.js";
import type { CdfDocument } from "../types.js";

export interface StripChartOptions {
  /** SVG width in pixels (default: 820). */
  width?: number | undefined;
  /** Height per channel track in pixels (default: 108). */
  trackHeight?: number | undefined;
  /** Optional channel name filter (if omitted, all plottable channels are rendered). */
  channels?: string[] | undefined;
  /** Optional title override. */
  title?: string | undefined;
}

interface PlottableChannel {
  name: string;
  units: string;
  values: number[];
  color: string;
  line: number;
}

const CHANNEL_PALETTE = [
  "#38bdf8", // sky
  "#34d399", // emerald
  "#fbbf24", // amber
  "#f472b6", // pink
  "#a78bfa", // violet
  "#fb7185", // rose
  "#2dd4bf", // teal
];

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function extractPlottableChannels(doc: CdfDocument, filter?: string[]): PlottableChannel[] {
  const epochVar = doc.variables.find(
    (v) => v.dataType === "CDF_EPOCH" || v.dataType === "CDF_TIME_TT2000" || v.name.toUpperCase() === "EPOCH",
  );

  const channels: PlottableChannel[] = [];
  let colorIdx = 0;

  for (const v of doc.variables) {
    if (v === epochVar) continue;
    if (v.dataType === "CDF_CHAR" || v.dataType === "CDF_UCHAR") continue;
    const units = String(v.attributes["UNITS"]?.values[0] ?? "");
    const fillValRaw = v.attributes["FILLVAL"]?.values[0];
    const fillVal = fillValRaw !== undefined ? Number(fillValRaw) : undefined;

    const is3Vec =
      (v.numDims === 1 && v.dimSizes[0] === 3) || v.values.some((rec) => Array.isArray(rec) && rec.length === 3);

    if (is3Vec) {
      const labels = ["x", "y", "z"];
      const comps: [number[], number[], number[]] = [[], [], []];
      const mags: number[] = [];
      for (const rec of v.values) {
        if (Array.isArray(rec) && rec.length >= 3) {
          const x = Number(rec[0]);
          const y = Number(rec[1]);
          const z = Number(rec[2]);
          comps[0].push(x);
          comps[1].push(y);
          comps[2].push(z);
          mags.push(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? Math.hypot(x, y, z) : Number.NaN);
        }
      }
      for (let c = 0; c < 3; c++) {
        const name = `${v.name}_${labels[c]}`;
        if (!filter || filter.includes(name) || filter.includes(v.name)) {
          channels.push({
            name,
            units,
            values: comps[c]!.map((n) =>
              fillVal !== undefined && Math.abs(n - fillVal) < 1e-6 * Math.abs(fillVal) ? Number.NaN : n,
            ),
            color: CHANNEL_PALETTE[colorIdx++ % CHANNEL_PALETTE.length]!,
            line: v.line,
          });
        }
      }
      if (v.name.toUpperCase().startsWith("B") || units.toLowerCase() === "nt") {
        const magName = `|${v.name}|`;
        if (!filter || filter.includes(magName) || filter.includes(v.name)) {
          channels.push({
            name: magName,
            units,
            values: mags,
            color: "#f8fafc",
            line: v.line,
          });
        }
      }
    } else {
      const vals: number[] = [];
      for (const rec of v.values) {
        const n = typeof rec === "number" ? rec : Number(rec);
        if (
          fillVal !== undefined &&
          Number.isFinite(n) &&
          Math.abs(n - fillVal) <= Math.max(1e-6 * Math.abs(fillVal), 1e-12)
        ) {
          vals.push(Number.NaN);
        } else {
          vals.push(n);
        }
      }
      if (!filter || filter.includes(v.name)) {
        channels.push({
          name: v.name,
          units,
          values: vals,
          color: CHANNEL_PALETTE[colorIdx++ % CHANNEL_PALETTE.length]!,
          line: v.line,
        });
      }
    }
  }

  return channels;
}

/**
 * Renders a deterministic multi-channel SVG time-series strip chart for a `CdfDocument`.
 */
export function renderNasaCdfStripChartSvg(doc: CdfDocument, options: StripChartOptions = {}): string {
  const width = options.width ?? 820;
  const trackHeight = options.trackHeight ?? 108;
  const channels = extractPlottableChannels(doc, options.channels);
  const summary = analyzeNasaCdfTelemetry(doc);

  const marginLeft = 74;
  const marginRight = 24;
  const headerHeight = 44;
  const footerHeight = 36;
  const trackGap = 14;
  const plotWidth = Math.max(200, width - marginLeft - marginRight);

  const trackCount = Math.max(1, channels.length);
  const height = headerHeight + trackCount * (trackHeight + trackGap) + footerHeight;

  // Extract epoch ticks
  const epochVar = doc.variables.find(
    (v) => v.dataType === "CDF_EPOCH" || v.dataType === "CDF_TIME_TT2000" || v.name.toUpperCase() === "EPOCH",
  );
  const epochs: number[] = [];
  if (epochVar) {
    for (const rec of epochVar.values) {
      if (typeof rec === "number" || typeof rec === "string") {
        const ms = parseTimeValueToCdfEpoch(rec, epochVar.dataType);
        if (ms !== undefined) epochs.push(ms);
      }
    }
  }

  const title = options.title ?? doc.header.fileName ?? "NASA CDF Telemetry Strip Chart";
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(title)}">`,
  );
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#0f172a" rx="6"/>`);

  // Header
  parts.push(
    `<text x="${marginLeft}" y="22" font-family="monospace" font-size="13" font-weight="bold" fill="#f8fafc">${escapeXml(title)}</text>`,
  );
  const subParts: string[] = [
    `CDF ${doc.formatVersion}`,
    doc.header.majority,
    `${summary.recordCount} records`,
    `${channels.length} channels`,
  ];
  if (summary.startIso && summary.stopIso) {
    subParts.push(`${summary.startIso.slice(0, 19)}Z .. ${summary.stopIso.slice(11, 19)}Z`);
  }
  parts.push(
    `<text x="${marginLeft}" y="36" font-family="monospace" font-size="10" fill="#94a3b8">${escapeXml(subParts.join(" · "))}</text>`,
  );

  if (channels.length === 0) {
    parts.push(
      `<rect x="${marginLeft}" y="${headerHeight}" width="${plotWidth}" height="${trackHeight}" fill="#1e293b" stroke="#334155" rx="4"/>`,
    );
    parts.push(
      `<text x="${marginLeft + plotWidth / 2}" y="${headerHeight + trackHeight / 2}" text-anchor="middle" font-family="monospace" font-size="12" fill="#94a3b8">No numeric time-series channels with data records.</text>`,
    );
  } else {
    for (let tIdx = 0; tIdx < channels.length; tIdx++) {
      const ch = channels[tIdx]!;
      const top = headerHeight + tIdx * (trackHeight + trackGap);
      const bottom = top + trackHeight;

      parts.push(`<g data-channel="${escapeXml(ch.name)}" data-line="${ch.line}">`);
      parts.push(
        `<rect x="${marginLeft}" y="${top}" width="${plotWidth}" height="${trackHeight}" fill="#1e293b" stroke="#334155" stroke-width="1" rx="4"/>`,
      );

      // Horizontal gridlines
      for (let g = 1; g <= 3; g++) {
        const gy = top + (trackHeight * g) / 4;
        parts.push(
          `<line x1="${marginLeft}" y1="${gy.toFixed(1)}" x2="${marginLeft + plotWidth}" y2="${gy.toFixed(1)}" stroke="#334155" stroke-dasharray="3,3" stroke-width="0.7"/>`,
        );
      }

      const finiteVals = ch.values.filter(Number.isFinite);
      let minVal = finiteVals.length > 0 ? Math.min(...finiteVals) : 0;
      let maxVal = finiteVals.length > 0 ? Math.max(...finiteVals) : 1;
      if (Math.abs(maxVal - minVal) < 1e-12) {
        minVal -= 1;
        maxVal += 1;
      } else {
        const pad = (maxVal - minVal) * 0.08;
        minVal -= pad;
        maxVal += pad;
      }

      // Y-axis labels
      parts.push(
        `<text x="${marginLeft - 6}" y="${top + 12}" text-anchor="end" font-family="monospace" font-size="9" fill="#94a3b8">${maxVal.toPrecision(4)}</text>`,
      );
      parts.push(
        `<text x="${marginLeft - 6}" y="${bottom - 4}" text-anchor="end" font-family="monospace" font-size="9" fill="#94a3b8">${minVal.toPrecision(4)}</text>`,
      );

      // Channel label badge
      const chLabel = ch.units ? `${ch.name} (${ch.units})` : ch.name;
      parts.push(
        `<text x="${marginLeft + 8}" y="${top + 14}" font-family="monospace" font-size="10.5" font-weight="bold" fill="${ch.color}">${escapeXml(chLabel)}</text>`,
      );

      // Polyline trace
      if (ch.values.length > 0) {
        const n = ch.values.length;
        const tMin = epochs.length === n && n > 1 ? epochs[0]! : 0;
        const tMax = epochs.length === n && n > 1 ? epochs[n - 1]! : Math.max(1, n - 1);
        const tSpan = Math.max(1e-9, tMax - tMin);

        const segs: string[] = [];
        let currentPts: string[] = [];

        for (let i = 0; i < n; i++) {
          const val = ch.values[i]!;
          if (!Number.isFinite(val)) {
            if (currentPts.length > 0) {
              segs.push(currentPts.join(" "));
              currentPts = [];
            }
            continue;
          }
          const t = epochs.length === n && n > 1 ? epochs[i]! : i;
          const x = marginLeft + 4 + ((t - tMin) / tSpan) * (plotWidth - 8);
          const y = bottom - 6 - ((val - minVal) / (maxVal - minVal)) * (trackHeight - 24);
          currentPts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
        if (currentPts.length > 0) segs.push(currentPts.join(" "));

        for (const pts of segs) {
          parts.push(
            `<polyline fill="none" stroke="${ch.color}" stroke-width="1.8" stroke-linejoin="round" points="${pts}"/>`,
          );
        }

        // Sample dots if sparse (<= 32 points)
        if (n <= 32) {
          for (let i = 0; i < n; i++) {
            const val = ch.values[i]!;
            if (!Number.isFinite(val)) continue;
            const t = epochs.length === n && n > 1 ? epochs[i]! : i;
            const x = marginLeft + 4 + ((t - tMin) / tSpan) * (plotWidth - 8);
            const y = bottom - 6 - ((val - minVal) / (maxVal - minVal)) * (trackHeight - 24);
            parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${ch.color}"/>`);
          }
        }
      }

      parts.push(`</g>`);
    }
  }

  // X-axis epoch ticks at bottom
  const axisY = height - footerHeight + 14;
  const tickCount = Math.min(5, Math.max(2, epochs.length));
  for (let k = 0; k < tickCount; k++) {
    const frac = k / Math.max(1, tickCount - 1);
    const x = marginLeft + 4 + frac * (plotWidth - 8);
    let label = `rec ${Math.round(frac * Math.max(0, summary.recordCount - 1))}`;
    if (epochs.length >= 2) {
      const ms = epochs[0]! + frac * (epochs[epochs.length - 1]! - epochs[0]!);
      label = cdfEpochToIso(ms).slice(11, 19) + "Z";
    } else if (epochs.length === 1) {
      label = cdfEpochToIso(epochs[0]!).slice(11, 19) + "Z";
    }
    const anchor = k === 0 ? "start" : k === tickCount - 1 ? "end" : "middle";
    parts.push(
      `<text x="${x.toFixed(1)}" y="${axisY}" text-anchor="${anchor}" font-family="monospace" font-size="9.5" fill="#94a3b8">${escapeXml(label)}</text>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}
