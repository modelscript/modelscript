// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure SVG visualizations for `@modelscript/arinc429`:
 *  - `renderArinc429WordSvg`: 32-bit ARINC 429 word bit-field diagram (Parity/SSM/Data/SDI/Label)
 *  - `renderArinc429PfdSvg`: Primary Flight Display (PFD) artificial horizon, airspeed, altitude, heading
 *  - `renderArinc429Svg`: Combined avionics dashboard SVG (PFD + 32-bit word inspector + bus utilization)
 */

import { decodeArinc429Word } from "../parser/codec.js";
import { analyzeBusUtilization, decodeFlightState } from "../solver/index.js";
import type { Arinc429Document, Arinc429FlightState, Arinc429LabelDef, DecodedArinc429Word } from "../types.js";

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Renders a pure SVG 32-bit ARINC 429 word bit-field diagram showing bits 32 down to 1:
 * Parity (32), SSM (31..30), Data (29..11), SDI (10..9), and bit-reversed Octal Label (8..1).
 */
export function renderArinc429WordSvg(
  wordOrDecoded: number | DecodedArinc429Word,
  labelDef?: Partial<Arinc429LabelDef>,
): string {
  const d = typeof wordOrDecoded === "number" ? decodeArinc429Word(wordOrDecoded, labelDef) : wordOrDecoded;
  const width = 820;
  const height = 175;
  const cellW = 24;
  const startX = 26;
  const bitY = 58;
  const cellH = 32;

  const bits: string[] = [];
  for (let bitNum = 32; bitNum >= 1; bitNum--) {
    const col = 32 - bitNum;
    const x = startX + col * cellW;
    const bitVal = (d.rawWord >>> (bitNum - 1)) & 1;

    let fill = "#1e293b";
    let stroke = "#475569";
    if (bitNum === 32) {
      fill = d.parityValid ? "#14532d" : "#7f1d1d";
      stroke = d.parityValid ? "#4ade80" : "#f87171";
    } else if (bitNum >= 30) {
      fill = "#3b0764";
      stroke = "#c084fc";
    } else if (bitNum >= 11) {
      fill = "#0c4a6e";
      stroke = "#38bdf8";
    } else if (bitNum >= 9) {
      fill = "#422006";
      stroke = "#facc15";
    } else {
      fill = "#1e3a5f";
      stroke = "#60a5fa";
    }

    bits.push(
      `<rect x="${x}" y="${bitY}" width="${cellW - 2}" height="${cellH}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
      `<text x="${x + (cellW - 2) / 2}" y="${bitY - 5}" text-anchor="middle" font-family="monospace" font-size="8" fill="#94a3b8">${bitNum}</text>`,
      `<text x="${x + (cellW - 2) / 2}" y="${bitY + 21}" text-anchor="middle" font-family="monospace" font-size="13" font-weight="bold" fill="#f8fafc">${bitVal}</text>`,
    );
  }

  // Field bracket spans
  const spans: Array<{ label: string; fromCol: number; toCol: number; color: string }> = [
    {
      label: `P (${d.parityValid ? "ODD OK" : "ERR"})`,
      fromCol: 0,
      toCol: 0,
      color: d.parityValid ? "#4ade80" : "#f87171",
    },
    { label: `SSM ${d.ssm.toString(2).padStart(2, "0")}`, fromCol: 1, toCol: 2, color: "#c084fc" },
    {
      label: `DATA 19-bit (${d.encoding}) = ${d.engineeringValue.toFixed(3)} ${d.units}`,
      fromCol: 3,
      toCol: 21,
      color: "#38bdf8",
    },
    { label: `SDI ${d.sdi.toString(2).padStart(2, "0")}`, fromCol: 22, toCol: 23, color: "#facc15" },
    {
      label: `LABEL ${d.labelOctal}o (wire 0x${d.wireLabelByte.toString(16).toUpperCase().padStart(2, "0")})`,
      fromCol: 24,
      toCol: 31,
      color: "#60a5fa",
    },
  ];

  const brackets = spans
    .map((s) => {
      const x1 = startX + s.fromCol * cellW + 2;
      const x2 = startX + (s.toCol + 1) * cellW - 4;
      const mid = (x1 + x2) / 2;
      return (
        `<path d="M ${x1} ${bitY + cellH + 8} L ${x1} ${bitY + cellH + 16} L ${x2} ${bitY + cellH + 16} L ${x2} ${bitY + cellH + 8}" fill="none" stroke="${s.color}" stroke-width="1.4"/>` +
        `<text x="${mid}" y="${bitY + cellH + 31}" text-anchor="middle" font-family="monospace" font-size="9.5" fill="${s.color}">${escapeXml(s.label)}</text>`
      );
    })
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>` +
    `<text x="26" y="24" font-family="monospace" font-size="13" font-weight="bold" fill="#f8fafc">ARINC 429 32-Bit Word: ${escapeXml(d.rawHex)}  [${escapeXml(d.labelOctal)} ${escapeXml(d.labelName)}]</text>` +
    `<text x="${width - 26}" y="24" text-anchor="end" font-family="monospace" font-size="11" fill="${d.parityValid ? "#4ade80" : "#f87171"}">${d.parityValid ? "PARITY: ODD OK" : "PARITY: ERROR"} | SSM: ${escapeXml(d.ssmMeaning)}</text>` +
    bits.join("") +
    brackets +
    `<text x="26" y="${height - 14}" font-family="monospace" font-size="9.5" fill="#94a3b8">Bit 32 = Odd Parity | Bits 31-30 = SSM | Bits 29-11 = 19-bit Payload | Bits 10-9 = SDI | Bits 8-1 = Bit-Reversed Octal Label</text>` +
    `</svg>`
  );
}

/**
 * Renders a pure SVG Primary Flight Display (PFD) with artificial horizon (pitch/roll),
 * airspeed tape (left), altitude tape (right), and heading compass strip (bottom).
 */
export function renderArinc429PfdSvg(flight: Arinc429FlightState): string {
  const width = 520;
  const height = 340;
  const cx = 260;
  const cy = 152;
  const pitchPxPerDeg = 4.0;
  const pitchOffset = Math.max(-90, Math.min(90, flight.pitchDeg)) * pitchPxPerDeg;
  const rollDeg = Math.max(-90, Math.min(90, flight.rollDeg));

  // Pitch ladder ticks (-20 to +20 deg in 5 deg steps)
  const ladderLines: string[] = [];
  for (let deg = -20; deg <= 20; deg += 5) {
    if (deg === 0) continue;
    const y = cy - deg * pitchPxPerDeg + pitchOffset;
    const halfW = deg % 10 === 0 ? 34 : 18;
    ladderLines.push(
      `<line x1="${cx - halfW}" y1="${y}" x2="${cx + halfW}" y2="${y}" stroke="#f8fafc" stroke-width="1.4" opacity="0.85"/>`,
    );
    if (deg % 10 === 0) {
      ladderLines.push(
        `<text x="${cx - halfW - 6}" y="${y + 3}" text-anchor="end" font-family="monospace" font-size="9" fill="#f8fafc">${deg}</text>`,
        `<text x="${cx + halfW + 6}" y="${y + 3}" text-anchor="start" font-family="monospace" font-size="9" fill="#f8fafc">${deg}</text>`,
      );
    }
  }

  const hdgNorm = ((flight.headingDeg % 360) + 360) % 360;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<defs>` +
    `<clipPath id="pfd-horizon-clip"><rect x="125" y="34" width="270" height="236" rx="14"/></clipPath>` +
    `</defs>` +
    `<rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#090d16" stroke="#1e293b" stroke-width="1.5"/>` +
    // Artificial horizon sky + ground
    `<g clip-path="url(#pfd-horizon-clip)">` +
    `<g transform="rotate(${(-rollDeg).toFixed(2)} ${cx} ${cy})">` +
    `<rect x="-120" y="${cy - 400 + pitchOffset}" width="760" height="400" fill="#0369a1"/>` +
    `<rect x="-120" y="${cy + pitchOffset}" width="760" height="400" fill="#78350f"/>` +
    `<line x1="-120" y1="${cy + pitchOffset}" x2="640" y2="${cy + pitchOffset}" stroke="#f8fafc" stroke-width="2"/>` +
    ladderLines.join("") +
    `</g>` +
    `</g>` +
    `<rect x="125" y="34" width="270" height="236" rx="14" fill="none" stroke="#334155" stroke-width="1.8"/>` +
    // Fixed aircraft boresight reference
    `<path d="M ${cx - 48} ${cy} L ${cx - 14} ${cy} L ${cx - 14} ${cy + 8} M ${cx + 48} ${cy} L ${cx + 14} ${cy} L ${cx + 14} ${cy + 8}" fill="none" stroke="#facc15" stroke-width="3"/>` +
    `<rect x="${cx - 3}" y="${cy - 3}" width="6" height="6" fill="#facc15"/>` +
    // Attitude readout banner
    `<text x="${cx}" y="22" text-anchor="middle" font-family="monospace" font-size="11" fill="#e2e8f0">PITCH ${flight.pitchDeg.toFixed(1)}° | ROLL ${flight.rollDeg.toFixed(1)}° | TAT ${flight.totalAirTempC.toFixed(1)}°C</text>` +
    // Airspeed Tape (left)
    `<rect x="16" y="34" width="94" height="236" rx="6" fill="#111827" stroke="#334155" stroke-width="1.4"/>` +
    `<text x="63" y="52" text-anchor="middle" font-family="monospace" font-size="9.5" fill="#94a3b8">IAS (KT)</text>` +
    `<rect x="22" y="${cy - 18}" width="82" height="36" rx="4" fill="#0f172a" stroke="#38bdf8" stroke-width="1.6"/>` +
    `<text x="63" y="${cy + 6}" text-anchor="middle" font-family="monospace" font-size="16" font-weight="bold" fill="#38bdf8">${Math.round(flight.airspeedKt)}</text>` +
    `<text x="63" y="256" text-anchor="middle" font-family="monospace" font-size="10.5" fill="#34d399">M ${flight.mach.toFixed(3)}</text>` +
    // Altitude Tape (right)
    `<rect x="410" y="34" width="94" height="236" rx="6" fill="#111827" stroke="#334155" stroke-width="1.4"/>` +
    `<text x="457" y="52" text-anchor="middle" font-family="monospace" font-size="9.5" fill="#94a3b8">ALT (FT)</text>` +
    `<rect x="416" y="${cy - 18}" width="82" height="36" rx="4" fill="#0f172a" stroke="#4ade80" stroke-width="1.6"/>` +
    `<text x="457" y="${cy + 6}" text-anchor="middle" font-family="monospace" font-size="15" font-weight="bold" fill="#4ade80">${Math.round(flight.altitudeFt)}</text>` +
    `<text x="457" y="256" text-anchor="middle" font-family="monospace" font-size="10" fill="#fbbf24">RA ${Math.round(flight.radioAltFt)} ft</text>` +
    // Heading strip (bottom)
    `<rect x="125" y="282" width="270" height="42" rx="6" fill="#111827" stroke="#334155" stroke-width="1.4"/>` +
    `<text x="${cx}" y="298" text-anchor="middle" font-family="monospace" font-size="9.5" fill="#94a3b8">TRUE HEADING</text>` +
    `<text x="${cx}" y="316" text-anchor="middle" font-family="monospace" font-size="15" font-weight="bold" fill="#f8fafc">${Math.round(hdgNorm).toString().padStart(3, "0")}°</text>` +
    `<text x="16" y="308" font-family="monospace" font-size="9" fill="#94a3b8">LAT ${flight.latitudeDeg.toFixed(3)}°</text>` +
    `<text x="504" y="308" text-anchor="end" font-family="monospace" font-size="9" fill="#94a3b8">LON ${flight.longitudeDeg.toFixed(3)}°</text>` +
    `</svg>`
  );
}

export interface RenderArinc429SvgOptions {
  selectedFrameIndex?: number;
}

/**
 * Renders a combined pure SVG avionics dashboard:
 *  - Top: Primary Flight Display (PFD) + Bus Utilization summary panel
 *  - Bottom: 32-bit ARINC 429 Word bit-field diagram for the selected (or latest) frame
 */
export function renderArinc429Svg(doc: Arinc429Document, options?: RenderArinc429SvgOptions): string {
  const flight = decodeFlightState(doc);
  const util = analyzeBusUtilization(doc);
  const frameIdx =
    options?.selectedFrameIndex !== undefined &&
    options.selectedFrameIndex >= 0 &&
    options.selectedFrameIndex < flight.decodedFrames.length
      ? options.selectedFrameIndex
      : Math.max(0, flight.decodedFrames.length - 1);

  const selectedWord = flight.decodedFrames[frameIdx]?.word ?? decodeArinc429Word(0x800000c1);

  const width = 840;
  const height = 560;
  const pfdSvg = renderArinc429PfdSvg(flight);
  const wordSvg = renderArinc429WordSvg(selectedWord);
  const utilBarW = Math.min(240, Math.max(0, (util.utilizationPct / 100) * 240));
  const utilColor = util.overloaded ? "#ef4444" : util.utilizationPct > 80 ? "#f59e0b" : "#22c55e";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#020617"/>` +
    `<g transform="translate(10, 12)">${pfdSvg}</g>` +
    // Bus utilization side card
    `<g transform="translate(544, 12)">` +
    `<rect x="0" y="0" width="286" height="340" rx="10" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>` +
    `<text x="16" y="28" font-family="monospace" font-size="13" font-weight="bold" fill="#f8fafc">BUS: ${escapeXml(doc.busName)}</text>` +
    `<text x="16" y="50" font-family="monospace" font-size="11" fill="#38bdf8">RATE: ${util.rate} (${(util.bitRateBps / 1000).toFixed(1)} kbps)</text>` +
    `<text x="16" y="72" font-family="monospace" font-size="10.5" fill="#94a3b8">Word Slot: 36 bits (${(util.wordDurationSec * 1000).toFixed(2)} ms)</text>` +
    `<text x="16" y="92" font-family="monospace" font-size="10.5" fill="#94a3b8">Max Throughput: ${util.maxWordsPerSec.toFixed(1)} w/s</text>` +
    `<text x="16" y="112" font-family="monospace" font-size="10.5" fill="#94a3b8">Scheduled Rate: ${util.scheduledWordsPerSec.toFixed(1)} w/s</text>` +
    `<text x="16" y="142" font-family="monospace" font-size="11" font-weight="bold" fill="${utilColor}">Utilization: ${util.utilizationPct.toFixed(1)}%</text>` +
    `<rect x="16" y="152" width="240" height="14" rx="4" fill="#1e293b"/>` +
    `<rect x="16" y="152" width="${utilBarW.toFixed(1)}" height="14" rx="4" fill="${utilColor}"/>` +
    `<text x="16" y="186" font-family="monospace" font-size="10.5" fill="#cbd5e1">Timing Margin: ${util.timingMarginPct.toFixed(1)}%</text>` +
    `<text x="16" y="214" font-family="monospace" font-size="10.5" fill="#cbd5e1">Declared Labels: ${doc.labels.length}</text>` +
    `<text x="16" y="234" font-family="monospace" font-size="10.5" fill="#cbd5e1">Trace Frames: ${doc.frames.length}</text>` +
    `<text x="16" y="264" font-family="monospace" font-size="10" fill="#94a3b8">Selected Frame #${frameIdx + 1}: ${escapeXml(selectedWord.rawHex)}</text>` +
    `<text x="16" y="284" font-family="monospace" font-size="10" fill="#38bdf8">${escapeXml(selectedWord.labelOctal)} ${escapeXml(selectedWord.labelName)} = ${selectedWord.engineeringValue.toFixed(2)} ${escapeXml(selectedWord.units)}</text>` +
    `</g>` +
    // Bottom 32-bit word bit-field diagram
    `<g transform="translate(10, 368)">${wordSvg}</g>` +
    `</svg>`
  );
}
