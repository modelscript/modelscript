// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure SVG Polar GNSS Constellation Skyplot & Pseudorange Residual Bar Chart
 * for `@modelscript/rinex`.
 */

import type { RinexPositionSolution, SatelliteGeometryInfo } from "../types.js";

export interface RinexSkyplotOptions {
  width?: number | undefined;
  height?: number | undefined;
  title?: string | undefined;
  darkMode?: boolean | undefined;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function satColor(prn: string): string {
  const sys = prn[0]?.toUpperCase() ?? "G";
  switch (sys) {
    case "G":
      return "#38bdf8"; // GPS sky blue
    case "R":
      return "#fb923c"; // GLONASS orange
    case "E":
      return "#a78bfa"; // Galileo violet
    case "C":
      return "#34d399"; // BeiDou emerald
    default:
      return "#f472b6";
  }
}

/**
 * Renders a pure SVG polar GNSS constellation skyplot (0/30/60 deg elevation rings,
 * N/E/S/W compass, satellite PRN positions) alongside a pseudorange residual bar chart.
 */
export function renderRinexSkyplotSvg(
  input: RinexPositionSolution | SatelliteGeometryInfo[],
  options: RinexSkyplotOptions = {},
): string {
  const width = options.width ?? 760;
  const height = options.height ?? 380;
  const dark = options.darkMode ?? true;
  const title = options.title ?? "GNSS Constellation Skyplot & Pseudorange Residuals";

  const satellites = Array.isArray(input) ? input : input.satellites;
  const dop = Array.isArray(input) ? undefined : input.dop;

  const bg = dark ? "#0f172a" : "#ffffff";
  const panelBg = dark ? "#1e293b" : "#f8fafc";
  const gridStroke = dark ? "#334155" : "#cbd5e1";
  const textPrimary = dark ? "#f8fafc" : "#0f172a";
  const textMuted = dark ? "#94a3b8" : "#475569";

  // Left half: Polar Skyplot
  const cx = 190;
  const cy = 205;
  const radius = 132;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(title)}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="${bg}"/>`,
    `<text x="20" y="28" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="${textPrimary}">${escapeXml(title)}</text>`,
  ];

  if (dop && Number.isFinite(dop.gdop)) {
    const dopSummary = `GDOP ${dop.gdop.toFixed(2)} · PDOP ${dop.pdop.toFixed(2)} · HDOP ${dop.hdop.toFixed(2)} · VDOP ${dop.vdop.toFixed(2)}`;
    parts.push(
      `<text x="${width - 20}" y="28" text-anchor="end" font-family="monospace" font-size="11" fill="${textMuted}">${escapeXml(dopSummary)}</text>`,
    );
  }

  // Skyplot background & elevation rings (0°, 30°, 60°)
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${panelBg}" stroke="${gridStroke}" stroke-width="1.5"/>`,
  );
  for (const elev of [30, 60]) {
    const r = radius * ((90 - elev) / 90);
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${gridStroke}" stroke-width="1" stroke-dasharray="4 3"/>`,
    );
    parts.push(
      `<text x="${(cx + 4).toFixed(1)}" y="${(cy - r + 12).toFixed(1)}" font-family="monospace" font-size="9.5" fill="${textMuted}">${elev}°</text>`,
    );
  }

  // Azimuth spokes every 45°
  for (let az = 0; az < 360; az += 45) {
    const rad = ((az - 90) * Math.PI) / 180;
    const x2 = cx + radius * Math.cos(rad);
    const y2 = cy + radius * Math.sin(rad);
    parts.push(
      `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${gridStroke}" stroke-width="0.8"/>`,
    );
  }

  // Cardinal labels
  parts.push(
    `<text x="${cx}" y="${cy - radius - 8}" text-anchor="middle" font-family="monospace" font-size="11" font-weight="700" fill="${textPrimary}">N</text>`,
    `<text x="${cx + radius + 12}" y="${cy + 4}" text-anchor="middle" font-family="monospace" font-size="11" font-weight="700" fill="${textPrimary}">E</text>`,
    `<text x="${cx}" y="${cy + radius + 16}" text-anchor="middle" font-family="monospace" font-size="11" font-weight="700" fill="${textPrimary}">S</text>`,
    `<text x="${cx - radius - 12}" y="${cy + 4}" text-anchor="middle" font-family="monospace" font-size="11" font-weight="700" fill="${textPrimary}">W</text>`,
  );

  // Plot satellites on polar skyplot
  for (const sat of satellites) {
    const clampedEl = Math.max(0, Math.min(90, sat.elevationDeg));
    const r = radius * ((90 - clampedEl) / 90);
    const rad = ((sat.azimuthDeg - 90) * Math.PI) / 180;
    const sx = cx + r * Math.cos(rad);
    const sy = cy + r * Math.sin(rad);
    const col = satColor(sat.prn);
    parts.push(
      `<g data-prn="${escapeXml(sat.prn)}">` +
        `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="10" fill="${col}" fill-opacity="0.22" stroke="${col}" stroke-width="1.6"/>` +
        `<text x="${sx.toFixed(1)}" y="${(sy + 3.2).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="700" fill="${textPrimary}">${escapeXml(sat.prn)}</text>` +
        `</g>`,
    );
  }

  // Right half: Pseudorange Residual Bar Chart
  const chartX = 395;
  const chartY = 64;
  const chartW = width - chartX - 24;
  const chartH = height - chartY - 40;
  const zeroY = chartY + chartH / 2;

  parts.push(
    `<rect x="${chartX}" y="${chartY}" width="${chartW}" height="${chartH}" rx="8" fill="${panelBg}" stroke="${gridStroke}" stroke-width="1"/>`,
    `<text x="${chartX + 12}" y="${chartY + 18}" font-family="system-ui, sans-serif" font-size="11.5" font-weight="600" fill="${textPrimary}">Pseudorange Post-Fit Residuals (m)</text>`,
    `<line x1="${chartX + 36}" y1="${zeroY.toFixed(1)}" x2="${chartX + chartW - 14}" y2="${zeroY.toFixed(1)}" stroke="${gridStroke}" stroke-width="1.2"/>`,
    `<text x="${chartX + 30}" y="${(zeroY + 3).toFixed(1)}" text-anchor="end" font-family="monospace" font-size="9" fill="${textMuted}">0</text>`,
  );

  if (satellites.length > 0) {
    const maxAbsRes = Math.max(
      1e-3,
      ...satellites.map((s) => (Number.isFinite(s.residualM) ? Math.abs(s.residualM) : 0)),
    );
    const halfPlotH = chartH / 2 - 34;
    const plotLeft = chartX + 44;
    const plotW = chartW - 60;
    const slotW = plotW / satellites.length;
    const barW = Math.max(10, Math.min(34, slotW * 0.62));

    parts.push(
      `<text x="${chartX + 30}" y="${(zeroY - halfPlotH + 4).toFixed(1)}" text-anchor="end" font-family="monospace" font-size="8.5" fill="${textMuted}">+${maxAbsRes.toExponential(1)}</text>`,
      `<text x="${chartX + 30}" y="${(zeroY + halfPlotH + 4).toFixed(1)}" text-anchor="end" font-family="monospace" font-size="8.5" fill="${textMuted}">-${maxAbsRes.toExponential(1)}</text>`,
    );

    satellites.forEach((sat, idx) => {
      const res = Number.isFinite(sat.residualM) ? sat.residualM : 0;
      const barH = Math.max(2, (Math.abs(res) / maxAbsRes) * halfPlotH);
      const bx = plotLeft + idx * slotW + (slotW - barW) / 2;
      const by = res >= 0 ? zeroY - barH : zeroY;
      const fill = res >= 0 ? "#38bdf8" : "#f97316";
      parts.push(
        `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="3" fill="${fill}"/>`,
        `<text x="${(bx + barW / 2).toFixed(1)}" y="${(chartY + chartH - 8).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="9" fill="${textMuted}">${escapeXml(sat.prn)}</text>`,
      );
    });
  } else {
    parts.push(
      `<text x="${(chartX + chartW / 2).toFixed(1)}" y="${(zeroY + 4).toFixed(1)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="${textMuted}">No satellite residuals available</text>`,
    );
  }

  parts.push("</svg>");
  return parts.join("");
}
