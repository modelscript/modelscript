// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure SVG Visualization for @modelscript/nmea0183:
 * - 2D GPS Ground-Track Map (`renderNmea0183TrackSvg`)
 * - Polar Satellite Skyplot from GSV azimuth/elevation/SNR (`renderNmea0183SkyplotSvg`)
 * - Combined Dual-Panel View (`renderNmea0183Svg`)
 */

import { parseNmea0183 } from "../parser/index.js";
import { solveNmeaTrack } from "../solver/index.js";
import type { Nmea0183Document, NmeaSatelliteInfo, NmeaTrackSolution } from "../types.js";

export interface NmeaSvgOptions {
  width?: number;
  height?: number;
  title?: string;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function snrColor(snr?: number): string {
  if (snr === undefined || snr <= 0) return "#64748b"; // untracked / gray
  if (snr >= 38) return "#22c55e"; // strong green
  if (snr >= 28) return "#38bdf8"; // good cyan
  if (snr >= 18) return "#f59e0b"; // moderate amber
  return "#ef4444"; // weak red
}

function constellationStroke(talker: string): string {
  switch (talker) {
    case "GP":
      return "#e0f2fe";
    case "GL":
      return "#fde68a";
    case "GA":
      return "#ddd6fe";
    case "GB":
    case "BD":
      return "#fecaca";
    default:
      return "#f8fafc";
  }
}

function buildTrackGroup(
  track: NmeaTrackSolution,
  ox: number,
  oy: number,
  w: number,
  h: number,
  title: string,
): string {
  const padL = 46;
  const padR = 20;
  const padT = 34;
  const padB = 34;
  const plotW = Math.max(40, w - padL - padR);
  const plotH = Math.max(40, h - padT - padB);

  const parts: string[] = [];
  parts.push(`<g transform="translate(${ox},${oy})">`);
  parts.push(
    `<rect x="0" y="0" width="${w}" height="${h}" rx="8" fill="#0f172a" stroke="#1e293b" stroke-width="1.2"/>`,
  );
  parts.push(
    `<text x="14" y="21" font-family="ui-monospace, SFMono-Regular, monospace" font-size="12" font-weight="600" fill="#e2e8f0">${escapeXml(title)}</text>`,
  );

  // Plot frame
  parts.push(
    `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#020617" stroke="#334155" stroke-width="1"/>`,
  );

  if (track.epochs.length === 0 || !track.bounds) {
    parts.push(
      `<text x="${padL + plotW / 2}" y="${padT + plotH / 2}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#64748b">No valid GPS fixes (GGA / RMC)</text>`,
    );
    parts.push(`</g>`);
    return parts.join("\n");
  }

  const { minE, maxE, minN, maxN } = track.bounds;
  const rawSpanE = maxE - minE;
  const rawSpanN = maxN - minN;
  const span = Math.max(rawSpanE, rawSpanN, 10);
  const padSpan = span * 1.18;
  const midE = (minE + maxE) * 0.5;
  const midN = (minN + maxN) * 0.5;

  const scale = Math.min(plotW / padSpan, plotH / padSpan);
  const cx = padL + plotW * 0.5;
  const cy = padT + plotH * 0.5;

  const toX = (e: number) => cx + (e - midE) * scale;
  const toY = (n: number) => cy - (n - midN) * scale;

  // Grid lines (4x4)
  for (let i = 1; i <= 3; i++) {
    const gx = padL + (plotW * i) / 4;
    const gy = padT + (plotH * i) / 4;
    parts.push(
      `<line x1="${gx.toFixed(1)}" y1="${padT}" x2="${gx.toFixed(1)}" y2="${padT + plotH}" stroke="#1e293b" stroke-dasharray="3,3"/>`,
    );
    parts.push(
      `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${padL + plotW}" y2="${gy.toFixed(1)}" stroke="#1e293b" stroke-dasharray="3,3"/>`,
    );
  }

  // Axis labels (East / North meters)
  parts.push(
    `<text x="${padL + plotW / 2}" y="${h - 10}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10" fill="#94a3b8">East (m) · Total ${track.totalDistanceVincentyM.toFixed(1)} m</text>`,
  );
  parts.push(
    `<text x="14" y="${padT + plotH / 2}" text-anchor="middle" transform="rotate(-90 14 ${padT + plotH / 2})" font-family="ui-monospace, monospace" font-size="10" fill="#94a3b8">North (m)</text>`,
  );

  // Polyline track
  const polyPts = track.epochs.map((ep) => `${toX(ep.enu.e).toFixed(2)},${toY(ep.enu.n).toFixed(2)}`).join(" ");
  if (track.epochs.length > 1) {
    parts.push(
      `<polyline points="${polyPts}" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }

  // Waypoint markers with data-line for reveal-line interactivity
  for (let i = 0; i < track.epochs.length; i++) {
    const ep = track.epochs[i]!;
    const px = toX(ep.enu.e);
    const py = toY(ep.enu.n);
    const isStart = i === 0;
    const isEnd = i === track.epochs.length - 1;
    const fill = isStart ? "#22c55e" : isEnd ? "#f43f5e" : ep.hdop !== undefined && ep.hdop > 5 ? "#f59e0b" : "#38bdf8";
    const r = isStart || isEnd ? 5.2 : 3.2;
    parts.push(
      `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${r}" fill="${fill}" stroke="#020617" stroke-width="1.2" data-line="${ep.line}"><title>Epoch ${ep.index} (${ep.latDeg.toFixed(5)}, ${ep.lonDeg.toFixed(5)})</title></circle>`,
    );
  }

  // Start/End legend
  parts.push(
    `<text x="${padL + plotW - 4}" y="21" text-anchor="end" font-family="ui-monospace, monospace" font-size="10" fill="#94a3b8">${track.epochs.length} fixes · ${track.meanSpeedKnots.toFixed(1)} kn</text>`,
  );

  parts.push(`</g>`);
  return parts.join("\n");
}

function buildSkyplotGroup(
  satellites: NmeaSatelliteInfo[],
  ox: number,
  oy: number,
  w: number,
  h: number,
  title: string,
): string {
  const cx = w * 0.5;
  const cy = h * 0.52;
  const radius = Math.max(40, Math.min(w, h) * 0.36);

  const parts: string[] = [];
  parts.push(`<g transform="translate(${ox},${oy})">`);
  parts.push(
    `<rect x="0" y="0" width="${w}" height="${h}" rx="8" fill="#0f172a" stroke="#1e293b" stroke-width="1.2"/>`,
  );
  parts.push(
    `<text x="14" y="21" font-family="ui-monospace, SFMono-Regular, monospace" font-size="12" font-weight="600" fill="#e2e8f0">${escapeXml(title)}</text>`,
  );
  parts.push(
    `<text x="${w - 14}" y="21" text-anchor="end" font-family="ui-monospace, monospace" font-size="10" fill="#94a3b8">${satellites.length} SVs</text>`,
  );

  // Elevation rings: 0 deg (outer), 30 deg, 60 deg
  for (const elev of [0, 30, 60]) {
    const r = radius * ((90 - elev) / 90);
    parts.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${elev === 0 ? "#020617" : "none"}" stroke="#334155" stroke-width="${elev === 0 ? "1.3" : "0.9"}" stroke-dasharray="${elev === 0 ? "" : "3,3"}"/>`,
    );
    if (elev > 0) {
      parts.push(
        `<text x="${(cx + 3).toFixed(1)}" y="${(cy - r + 10).toFixed(1)}" font-family="ui-monospace, monospace" font-size="8.5" fill="#64748b">${elev}°</text>`,
      );
    }
  }

  // Cardinal axes (N-S, E-W)
  parts.push(
    `<line x1="${cx.toFixed(1)}" y1="${(cy - radius).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(cy + radius).toFixed(1)}" stroke="#1e293b" stroke-width="1"/>`,
  );
  parts.push(
    `<line x1="${(cx - radius).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(cx + radius).toFixed(1)}" y2="${cy.toFixed(1)}" stroke="#1e293b" stroke-width="1"/>`,
  );

  // Compass labels
  parts.push(
    `<text x="${cx.toFixed(1)}" y="${(cy - radius - 6).toFixed(1)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="#38bdf8">N</text>`,
  );
  parts.push(
    `<text x="${cx.toFixed(1)}" y="${(cy + radius + 14).toFixed(1)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10" fill="#94a3b8">S</text>`,
  );
  parts.push(
    `<text x="${(cx + radius + 10).toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10" fill="#94a3b8">E</text>`,
  );
  parts.push(
    `<text x="${(cx - radius - 10).toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10" fill="#94a3b8">W</text>`,
  );

  if (satellites.length === 0) {
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#64748b">No GSV satellites</text>`,
    );
  } else {
    for (const sat of satellites) {
      if (sat.elevationDeg === undefined || sat.azimuthDeg === undefined) continue;
      const el = Math.max(0, Math.min(90, sat.elevationDeg));
      const azRad = (sat.azimuthDeg * Math.PI) / 180;
      const r = radius * ((90 - el) / 90);
      const sx = cx + r * Math.sin(azRad);
      const sy = cy - r * Math.cos(azRad);
      const fill = snrColor(sat.snrDbHz);
      const stroke = constellationStroke(sat.talker);

      parts.push(
        `<g data-line="${sat.line}">` +
          `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="10" fill="${fill}" fill-opacity="0.88" stroke="${stroke}" stroke-width="1.4"/>` +
          `<text x="${sx.toFixed(1)}" y="${(sy + 3.2).toFixed(1)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="8.5" font-weight="700" fill="#020617">${sat.prn}</text>` +
          `<title>${sat.talker} PRN ${sat.prn} · El ${el.toFixed(0)}° Az ${sat.azimuthDeg.toFixed(0)}° SNR ${sat.snrDbHz ?? "—"} dB-Hz</title>` +
          `</g>`,
      );
    }
  }

  // SNR Legend
  parts.push(
    `<text x="${w * 0.5}" y="${h - 10}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="9" fill="#94a3b8">SNR: ≥38 Green · ≥28 Cyan · ≥18 Amber · &lt;18 Red</text>`,
  );

  parts.push(`</g>`);
  return parts.join("\n");
}

/**
 * Renders a standalone pure SVG 2D GPS ground-track map.
 */
export function renderNmea0183TrackSvg(docOrSource: Nmea0183Document | string, options: NmeaSvgOptions = {}): string {
  const width = options.width ?? 540;
  const height = options.height ?? 380;
  const track = solveNmeaTrack(docOrSource);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    buildTrackGroup(track, 0, 0, width, height, options.title ?? "2D GPS Ground Track (Local ENU)"),
    `</svg>`,
  ].join("\n");
}

/**
 * Renders a standalone pure SVG polar satellite skyplot from `GSV` sentences.
 */
export function renderNmea0183SkyplotSvg(docOrSource: Nmea0183Document | string, options: NmeaSvgOptions = {}): string {
  const width = options.width ?? 380;
  const height = options.height ?? 380;
  const doc = typeof docOrSource === "string" ? parseNmea0183(docOrSource) : docOrSource;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    buildSkyplotGroup(doc.satellites, 0, 0, width, height, options.title ?? "GNSS Satellite Skyplot (GSV)"),
    `</svg>`,
  ].join("\n");
}

/**
 * Renders a combined dual-panel pure SVG with the 2D GPS ground-track map (left)
 * and polar GNSS satellite skyplot (right).
 */
export function renderNmea0183Svg(docOrSource: Nmea0183Document | string, options: NmeaSvgOptions = {}): string {
  const width = options.width ?? 880;
  const height = options.height ?? 400;
  const gap = 12;
  const leftW = Math.round((width - gap) * 0.58);
  const rightW = width - gap - leftW;

  const doc = typeof docOrSource === "string" ? parseNmea0183(docOrSource) : docOrSource;
  const track = solveNmeaTrack(doc);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    buildTrackGroup(track, 0, 0, leftW, height, options.title ?? "2D GPS Ground Track (Local ENU)"),
    buildSkyplotGroup(doc.satellites, leftW + gap, 0, rightW, height, "GNSS Satellite Skyplot (GSV)"),
    `</svg>`,
  ].join("\n");
}
