// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/melcor — Cross-Language Projection to US NRC RELAP5-3D Card Deck.
 */

import type { MelcorDeck } from "../types.js";

function padCard(num: number): string {
  return String(num).padStart(7, "0");
}

function sanitizeRelapName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "_");
  return cleaned.length > 0 ? cleaned.slice(0, 16) : "COMP";
}

export function melcorToRelap5(deck: MelcorDeck): string {
  const lines: string[] = [];

  lines.push(`* Projected from Sandia MELCOR Deck: ${deck.title}`);
  lines.push(`= ${deck.title}`);
  lines.push("0000100 new transnt");
  lines.push("0000101 run");
  lines.push("0000102 si si");

  const tEnd = deck.exec.tEnd > deck.exec.tStart ? deck.exec.tEnd : 100.0;
  const dtMin = deck.exec.dtMin > 0 ? deck.exec.dtMin : 1.0e-5;
  const dtMax = deck.exec.dtMax > 0 ? deck.exec.dtMax : 0.1;
  lines.push(`0000201 ${tEnd.toExponential(3)} ${dtMin.toExponential(3)} ${dtMax.toExponential(3)} 00003 10 100 1000`);
  lines.push("*");

  // Map MELCOR CV IDs to RELAP5 3-digit component numbers (101..199)
  const cvToRelap = new Map<number, number>();
  let nextVolNum = 101;
  for (const cv of deck.controlVolumes.values()) {
    const r5Num = cv.id >= 100 && cv.id <= 999 ? cv.id : nextVolNum++;
    cvToRelap.set(cv.id, r5Num);
    const compType = cv.cvType === "TIME_INDEPENDENT" ? "tmdpvol" : "snglvol";
    const height = Math.max(0.1, cv.height);
    const area = Math.max(1e-4, cv.volume / height);
    lines.push(`* MELCOR CV ${cv.id}: ${cv.name}`);
    lines.push(`${padCard(r5Num * 10000)} ${sanitizeRelapName(cv.name)} ${compType}`);
    lines.push(
      `${padCard(r5Num * 10000 + 101)} ${area.toExponential(4)} ${height.toExponential(4)} ${cv.volume.toExponential(4)} 0.0 90.0 ${height.toExponential(4)} 0.0 0.0 00`,
    );
    lines.push(`${padCard(r5Num * 10000 + 200)} 3 ${cv.pressure.toExponential(4)} ${cv.temperature.toFixed(2)}`);
  }

  lines.push("*");

  // Map MELCOR FL Flow Paths to RELAP5 single junctions (201..299)
  let nextJuncNum = 201;
  for (const fl of deck.flowPaths.values()) {
    const r5Junc = fl.id >= 200 && fl.id <= 999 && !cvToRelap.has(fl.id) ? fl.id : nextJuncNum++;
    const fromVol = (cvToRelap.get(fl.fromCv) ?? fl.fromCv) * 1000000 + 10000;
    const toVol = (cvToRelap.get(fl.toCv) ?? fl.toCv) * 1000000 + 10000;
    lines.push(`* MELCOR FL ${fl.id}: ${fl.name}`);
    lines.push(`${padCard(r5Junc * 10000)} ${sanitizeRelapName(fl.name)} sngljun`);
    lines.push(
      `${padCard(r5Junc * 10000 + 101)} ${fromVol} ${toVol} ${fl.area.toExponential(4)} ${fl.forwardLoss.toFixed(3)} ${fl.reverseLoss.toFixed(3)} 000000`,
    );
    lines.push(`${padCard(r5Junc * 10000 + 201)} 0 ${fl.initialFlow.toExponential(4)} 0.0 0.0`);
  }

  // Map MELCOR HS Heat Structures to RELAP5 heat structure cards (1xxx0000)
  let hsIdx = 1;
  for (const hs of deck.heatStructures.values()) {
    const base = 1000 + hsIdx++;
    const geomCode = hs.geometry === "CYLINDRICAL" ? 2 : hs.geometry === "SPHERICAL" ? 3 : 1;
    lines.push(`* MELCOR HS ${hs.id}: ${hs.name}`);
    lines.push(`${base}0000 1 5 ${geomCode} 0 0.0`);
    lines.push(`${base}0100 0 1`);
    lines.push(`${base}0101 4 ${hs.thickness.toExponential(4)}`);
    lines.push(`${base}0400 0 ${hs.initialTemperature.toFixed(2)}`);
  }

  lines.push(".");
  return lines.join("\n") + "\n";
}
