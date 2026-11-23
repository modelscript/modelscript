// SPDX-License-Identifier: AGPL-3.0-or-later

import { solveBufrMeteorology } from "../solver/meteo-qa.js";
import type { BufrMessage, BufrSoundingLevel, BufrStationSummary } from "../types.js";

export interface BufrSoundingDiagramData {
  title: string;
  station: BufrStationSummary | null;
  levels: BufrSoundingLevel[];
  edition: 3 | 4;
  subsetCount: number;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Extracts structured sounding & station-plot data from a parsed `BufrMessage`.
 */
export function buildBufrSoundingData(message: BufrMessage): BufrSoundingDiagramData {
  const sol = solveBufrMeteorology(message);
  return {
    title: message.name || "WMO BUFR Sounding",
    station: sol.stations[0] ?? null,
    levels: sol.soundingLevels,
    edition: message.section0.edition,
    subsetCount: message.subsets.length,
  };
}

/**
 * Renders a wind barb SVG group at (cx, cy) for meteorological wind direction (deg from north) and speed (m/s).
 */
function renderWindBarb(cx: number, cy: number, dirDeg: number, speedMs: number): string {
  const knots = speedMs * 1.94384;
  const shaftLen = 22;
  const rad = ((dirDeg - 90) * Math.PI) / 180;
  // Wind blows FROM dirDeg, so staff extends toward dirDeg
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const x2 = cx + dx * shaftLen;
  const y2 = cy + dy * shaftLen;
  // Perpendicular for barbs
  const px = -dy;
  const py = dx;

  const parts: string[] = [
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.2" fill="#e2e8f0"/>`,
    `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#e2e8f0" stroke-width="1.4"/>`,
  ];

  let rem = Math.round(knots / 5) * 5;
  let pos = shaftLen;
  while (rem >= 50 && pos > 6) {
    const bx1 = cx + dx * pos;
    const by1 = cy + dy * pos;
    const bx2 = cx + dx * (pos - 5);
    const by2 = cy + dy * (pos - 5);
    const tipX = bx1 + px * 8;
    const tipY = by1 + py * 8;
    parts.push(
      `<polygon points="${bx1.toFixed(1)},${by1.toFixed(1)} ${bx2.toFixed(1)},${by2.toFixed(1)} ${tipX.toFixed(1)},${tipY.toFixed(1)}" fill="#38bdf8"/>`,
    );
    pos -= 6;
    rem -= 50;
  }
  while (rem >= 10 && pos > 4) {
    const bx = cx + dx * pos;
    const by = cy + dy * pos;
    const tipX = bx + px * 8;
    const tipY = by + py * 8;
    parts.push(
      `<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${tipX.toFixed(1)}" y2="${tipY.toFixed(1)}" stroke="#e2e8f0" stroke-width="1.3"/>`,
    );
    pos -= 3.5;
    rem -= 10;
  }
  if (rem >= 5 && pos > 3) {
    const bx = cx + dx * pos;
    const by = cy + dy * pos;
    const tipX = bx + px * 4.5;
    const tipY = by + py * 4.5;
    parts.push(
      `<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${tipX.toFixed(1)}" y2="${tipY.toFixed(1)}" stroke="#e2e8f0" stroke-width="1.3"/>`,
    );
  }
  return parts.join("");
}

/**
 * Renders a pure SVG upper-air log-P vertical temperature/dewpoint sounding profile
 * together with a WMO station-plot inset card.
 */
export function renderBufrSoundingSvg(message: BufrMessage): string {
  const data = buildBufrSoundingData(message);
  const width = 760;
  const height = 460;

  // Plot area bounds (log-P vertical axis: 1050 hPa at bottom -> 100 hPa at top)
  const plotLeft = 72;
  const plotRight = 490;
  const plotTop = 52;
  const plotBottom = 408;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const pMaxHpa = 1050;
  const pMinHpa = 100;
  const logPMax = Math.log(pMaxHpa);
  const logPMin = Math.log(pMinHpa);

  const tMinC = -70;
  const tMaxC = 40;

  const pToY = (pPa: number): number => {
    const pHpa = Math.max(pMinHpa, Math.min(pMaxHpa, pPa / 100));
    const frac = (logPMax - Math.log(pHpa)) / (logPMax - logPMin);
    return plotBottom - frac * plotH;
  };

  const tToX = (tK: number): number => {
    const tC = tK - 273.15;
    const frac = (tC - tMinC) / (tMaxC - tMinC);
    return plotLeft + Math.max(0, Math.min(1, frac)) * plotW;
  };

  const elements: string[] = [];

  // Background & border
  elements.push(`<rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#0f172a"/>`);
  elements.push(
    `<text x="20" y="28" font-family="sans-serif" font-size="14" font-weight="700" fill="#f8fafc">${escapeXml(data.title)} — Upper-Air Sounding &amp; WMO Station Plot</text>`,
  );
  elements.push(
    `<text x="20" y="43" font-family="monospace" font-size="10.5" fill="#94a3b8">WMO BUFR Ed.${data.edition} · Subsets: ${data.subsetCount} · Levels: ${data.levels.length}</text>`,
  );

  // Sounding chart frame
  elements.push(
    `<rect x="${plotLeft}" y="${plotTop}" width="${plotW}" height="${plotH}" fill="#111c33" stroke="#334155" stroke-width="1"/>`,
  );

  // Horizontal isobars (1000, 850, 700, 500, 300, 200, 100 hPa)
  const isobars = [1000, 850, 700, 500, 300, 200, 100];
  for (const pHpa of isobars) {
    const y = pToY(pHpa * 100);
    elements.push(
      `<line x1="${plotLeft}" y1="${y.toFixed(1)}" x2="${plotRight}" y2="${y.toFixed(1)}" stroke="#1e293b" stroke-width="1"/>`,
    );
    elements.push(
      `<text x="${plotLeft - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-family="monospace" font-size="10" fill="#94a3b8">${pHpa}</text>`,
    );
  }
  elements.push(
    `<text x="22" y="${((plotTop + plotBottom) / 2).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#cbd5e1" transform="rotate(-90 22 ${((plotTop + plotBottom) / 2).toFixed(1)})">Pressure (hPa, log-P)</text>`,
  );

  // Vertical isotherms (-60, -40, -20, 0, 20, 40 C)
  const isotherms = [-60, -40, -20, 0, 20, 40];
  for (const tC of isotherms) {
    const x = tToX(tC + 273.15);
    const isZero = tC === 0;
    elements.push(
      `<line x1="${x.toFixed(1)}" y1="${plotTop}" x2="${x.toFixed(1)}" y2="${plotBottom}" stroke="${isZero ? "#38bdf8" : "#1e293b"}" stroke-width="${isZero ? "1.3" : "1"}" ${isZero ? 'stroke-dasharray="4 3"' : ""}/>`,
    );
    elements.push(
      `<text x="${x.toFixed(1)}" y="${plotBottom + 16}" text-anchor="middle" font-family="monospace" font-size="10" fill="#94a3b8">${tC}°C</text>`,
    );
  }
  elements.push(
    `<text x="${((plotLeft + plotRight) / 2).toFixed(1)}" y="${plotBottom + 34}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#cbd5e1">Temperature / Dewpoint (°C)</text>`,
  );

  // Plot Temperature (T) and Dewpoint (Td) profiles + Wind Barbs
  if (data.levels.length > 0) {
    const tPoints: string[] = [];
    const tdPoints: string[] = [];

    for (const lv of data.levels) {
      const y = pToY(lv.pressurePa);
      const tx = tToX(lv.temperatureK);
      tPoints.push(`${tx.toFixed(1)},${y.toFixed(1)}`);
      if (lv.dewpointK !== undefined) {
        const tdx = tToX(lv.dewpointK);
        tdPoints.push(`${tdx.toFixed(1)},${y.toFixed(1)}`);
      }
      if (lv.windDirectionDeg !== undefined && lv.windSpeedMs !== undefined) {
        elements.push(renderWindBarb(plotRight + 28, y, lv.windDirectionDeg, lv.windSpeedMs));
      }
    }

    if (tPoints.length >= 2) {
      elements.push(
        `<polyline points="${tPoints.join(" ")}" fill="none" stroke="#ef4444" stroke-width="2.4" stroke-linejoin="round"/>`,
      );
    }
    if (tdPoints.length >= 2) {
      elements.push(
        `<polyline points="${tdPoints.join(" ")}" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-dasharray="6 3" stroke-linejoin="round"/>`,
      );
    }

    // Level markers
    for (const lv of data.levels) {
      const y = pToY(lv.pressurePa);
      const tx = tToX(lv.temperatureK);
      elements.push(
        `<circle cx="${tx.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#ef4444" stroke="#0f172a" stroke-width="1"/>`,
      );
      if (lv.dewpointK !== undefined) {
        const tdx = tToX(lv.dewpointK);
        elements.push(
          `<circle cx="${tdx.toFixed(1)}" cy="${y.toFixed(1)}" r="2.8" fill="#38bdf8" stroke="#0f172a" stroke-width="1"/>`,
        );
      }
    }
  } else {
    elements.push(
      `<text x="${((plotLeft + plotRight) / 2).toFixed(1)}" y="${((plotTop + plotBottom) / 2).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#64748b">No multi-level sounding data — showing surface station plot</text>`,
    );
  }

  // Wind staff column label
  elements.push(
    `<text x="${plotRight + 28}" y="${plotTop - 8}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#94a3b8">Wind</text>`,
  );

  // Right-side WMO Station Plot Card
  const cardX = 556;
  const cardY = 52;
  const cardW = 188;
  const cardH = 356;
  elements.push(
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="6" fill="#111c33" stroke="#334155" stroke-width="1"/>`,
  );
  elements.push(
    `<text x="${cardX + cardW / 2}" y="${cardY + 22}" text-anchor="middle" font-family="sans-serif" font-size="11.5" font-weight="700" fill="#e2e8f0">WMO Station Model</text>`,
  );

  const st = data.station;
  const stCx = cardX + cardW / 2;
  const stCy = cardY + 108;

  // Station circle & wind barb
  elements.push(`<circle cx="${stCx}" cy="${stCy}" r="11" fill="#1e293b" stroke="#f8fafc" stroke-width="1.8"/>`);
  if (st?.windDirectionDeg !== undefined && st?.windSpeedMs !== undefined) {
    elements.push(renderWindBarb(stCx, stCy, st.windDirectionDeg, st.windSpeedMs));
  }

  // WMO standard quadrant labels around station circle:
  // Top-left: Dry-bulb T (°C), Bottom-left: Dewpoint Td (°C), Top-right: SLP (hPa), Bottom-right: Station ID
  const tStr = st?.temperatureK !== undefined ? `${(st.temperatureK - 273.15).toFixed(1)}°C` : "--";
  const tdStr = st?.dewpointK !== undefined ? `${(st.dewpointK - 273.15).toFixed(1)}°C` : "--";
  const pRef = st?.seaLevelPressurePa ?? st?.surfacePressurePa;
  const pStr = pRef !== undefined ? `${(pRef / 100).toFixed(1)} hPa` : "--";
  const rhStr = st?.relativeHumidityPct !== undefined ? `${st.relativeHumidityPct.toFixed(0)}%` : "--";

  elements.push(
    `<text x="${stCx - 20}" y="${stCy - 18}" text-anchor="end" font-family="monospace" font-size="11" font-weight="700" fill="#ef4444">${tStr}</text>`,
  );
  elements.push(
    `<text x="${stCx - 20}" y="${stCy + 26}" text-anchor="end" font-family="monospace" font-size="11" font-weight="700" fill="#38bdf8">${tdStr}</text>`,
  );
  elements.push(
    `<text x="${stCx + 20}" y="${stCy - 18}" text-anchor="start" font-family="monospace" font-size="10.5" fill="#c084fc">${pStr}</text>`,
  );
  elements.push(
    `<text x="${stCx + 20}" y="${stCy + 26}" text-anchor="start" font-family="monospace" font-size="10.5" fill="#34d399">RH ${rhStr}</text>`,
  );

  // Station metadata table inside card
  const metaY = cardY + 175;
  const metaRows: Array<[string, string]> = [
    ["Station", st?.stationId ?? "N/A"],
    ["Lat", st?.latitude !== undefined ? `${st.latitude.toFixed(3)}°` : "--"],
    ["Lon", st?.longitude !== undefined ? `${st.longitude.toFixed(3)}°` : "--"],
    ["Elev", st?.elevationM !== undefined ? `${st.elevationM.toFixed(0)} m` : "--"],
    [
      "Wind",
      st?.windSpeedMs !== undefined
        ? `${st.windDirectionDeg?.toFixed(0) ?? 0}° @ ${st.windSpeedMs.toFixed(1)} m/s`
        : "--",
    ],
    ["Precip", st?.precipitationMm !== undefined ? `${st.precipitationMm.toFixed(1)} mm` : "0.0 mm"],
  ];

  for (let i = 0; i < metaRows.length; i++) {
    const [k, v] = metaRows[i]!;
    const y = metaY + i * 22;
    elements.push(
      `<text x="${cardX + 12}" y="${y}" font-family="sans-serif" font-size="10" fill="#94a3b8">${escapeXml(k)}</text>`,
    );
    elements.push(
      `<text x="${cardX + cardW - 12}" y="${y}" text-anchor="end" font-family="monospace" font-size="10" fill="#f1f5f9">${escapeXml(v)}</text>`,
    );
  }

  // Legend
  const legY = cardY + cardH - 22;
  elements.push(
    `<line x1="${cardX + 14}" y1="${legY}" x2="${cardX + 34}" y2="${legY}" stroke="#ef4444" stroke-width="2.2"/>`,
  );
  elements.push(
    `<text x="${cardX + 39}" y="${legY + 3.5}" font-family="sans-serif" font-size="9.5" fill="#cbd5e1">Dry-Bulb T</text>`,
  );
  elements.push(
    `<line x1="${cardX + 104}" y1="${legY}" x2="${cardX + 124}" y2="${legY}" stroke="#38bdf8" stroke-width="2" stroke-dasharray="4 2"/>`,
  );
  elements.push(
    `<text x="${cardX + 129}" y="${legY + 3.5}" font-family="sans-serif" font-size="9.5" fill="#cbd5e1">Dewpoint</text>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${elements.join("")}</svg>`;
}
