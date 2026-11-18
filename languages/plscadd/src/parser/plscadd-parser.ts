// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plscadd — Parser & Sag-Tension / Electrical Impedance Helpers.
 */

import type { PlsCaddModel, PlsConductor, PlsSpan, PlsStructure, PlsTerrainPoint } from "../types.js";

function parseKv(tokens: string[]): Record<string, string> {
  const rec: Record<string, string> = {};
  for (const tok of tokens) {
    const eq = tok.indexOf("=");
    if (eq !== -1) rec[tok.slice(0, eq)] = tok.slice(eq + 1);
  }
  return rec;
}

export function computeSpanLengthM(s1: PlsStructure, s2: PlsStructure): number {
  const dx = s2.x - s1.x;
  const dy = s2.y - s1.y;
  const dxy = Math.hypot(dx, dy);
  return dxy > 0 ? dxy : Math.abs(s2.stationM - s1.stationM);
}

export function computeParabolicSagM(weightNPerM: number, spanLengthM: number, tensionN: number): number {
  if (tensionN <= 0 || spanLengthM <= 0) return 0;
  return (weightNPerM * spanLengthM * spanLengthM) / (8 * tensionN);
}

export function computeSpanImpedanceOhms(
  spanLengthM: number,
  conductor: PlsConductor,
  phaseSpacingM: number,
  frequencyHz: number,
): { rOhms: number; xOhms: number } {
  const lenKm = spanLengthM / 1000;
  const rOhms = conductor.rOhmPerKm * lenKm;
  const gmr = Math.max(1e-4, conductor.gmrM);
  const gmd = Math.max(gmr * 2, phaseSpacingM);
  const lPerM = 2e-7 * Math.log(gmd / gmr);
  const xOhms = 2 * Math.PI * frequencyHz * lPerM * spanLengthM;
  return { rOhms, xOhms };
}

export function parsePlsCadd(source: string): PlsCaddModel {
  let lineName = "TransmissionLine";
  let voltageKv = 230;
  let frequencyHz = 60;
  const structures: PlsStructure[] = [];
  const conductors: PlsConductor[] = [];
  const spans: PlsSpan[] = [];
  const terrainPoints: PlsTerrainPoint[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine
      .replace(/\/\/.*$/, "")
      .replace(/#.*$/, "")
      .trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const head = parts[0]?.toUpperCase();

    if (head === "LINE") {
      if (parts[1] && !parts[1].includes("=")) lineName = parts[1];
      const kv = parseKv(parts.slice(1));
      if (kv["voltage_kv"]) voltageKv = Number(kv["voltage_kv"]);
      if (kv["freq"]) frequencyHz = Number(kv["freq"]);
    } else if (head === "STRUCTURE" && parts[1]) {
      const kv = parseKv(parts.slice(2));
      structures.push({
        id: parts[1],
        stationM: Number(kv["station_m"] ?? 0),
        x: Number(kv["x"] ?? kv["station_m"] ?? 0),
        y: Number(kv["y"] ?? 0),
        zBaseM: Number(kv["z_base"] ?? 0),
        heightM: Number(kv["height_m"] ?? 25),
        phaseSpacingM: Number(kv["phase_spacing_m"] ?? 4.5),
      });
    } else if (head === "CONDUCTOR" && parts[1]) {
      const kv = parseKv(parts.slice(2));
      conductors.push({
        name: parts[1],
        weightNPerM: Number(kv["weight_n_per_m"] ?? 15.0),
        rOhmPerKm: Number(kv["r_ohm_per_km"] ?? 0.06),
        gmrM: Number(kv["gmr_m"] ?? 0.011),
        ratedTensionN: Number(kv["rated_tension_n"] ?? 120000),
      });
    } else if (head === "SPAN" && parts[1]) {
      const kv = parseKv(parts.slice(2));
      spans.push({
        id: parts[1],
        fromStructure: kv["from"] ?? "",
        toStructure: kv["to"] ?? "",
        conductor: kv["conductor"] ?? "",
        tensionN: Number(kv["tension_n"] ?? 25000),
        minClearanceM: Number(kv["min_clearance_m"] ?? 7.0),
      });
    } else if (head === "TERRAIN" && parts.length >= 4) {
      terrainPoints.push({
        x: Number(parts[1]),
        y: Number(parts[2]),
        z: Number(parts[3]),
        featureCode: parts[4],
      });
    } else if (/^[+-]?\d/.test(parts[0] ?? "") && parts.length >= 3) {
      terrainPoints.push({
        x: Number(parts[0]),
        y: Number(parts[1]),
        z: Number(parts[2]),
        featureCode: parts[3],
      });
    }
  }

  return {
    lineName,
    voltageKv,
    frequencyHz,
    structures,
    structureById: new Map(structures.map((s) => [s.id, s])),
    conductors,
    conductorByName: new Map(conductors.map((c) => [c.name, c])),
    spans,
    terrainPoints,
  };
}
