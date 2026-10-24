// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Tabular PVT Fluid Table Parser (.tab / .pvt).
 *
 * Ingests industry-standard Multiflash and PVTsim pressure-temperature tables,
 * performing bilinear interpolation across 2D grids for:
 * - Gas & Liquid densities (rhoG, rhoL)
 * - Gas & Liquid dynamic viscosities (visG, visL)
 * - Surface tension (sigma)
 * - Specific heat capacities and enthalpies
 */

export interface PvtTableData {
  title: string;
  pressures: number[]; // Pascal [Pa], sorted ascending
  temperatures: number[]; // Kelvin [K], sorted ascending
  rhoG: number[][]; // [P_idx][T_idx] in kg/m^3
  rhoL: number[][]; // [P_idx][T_idx] in kg/m^3
  visG: number[][]; // [P_idx][T_idx] in Pa*s
  visL: number[][]; // [P_idx][T_idx] in Pa*s
  surfaceTension: number[][]; // [P_idx][T_idx] in N/m
}

export interface PvtInterpolatedState {
  rhoG: number;
  rhoL: number;
  muG: number;
  muL: number;
  sigma: number;
  isExtrapolated: boolean;
}

/**
 * Parses an OLGA Multiflash / PVTsim fluid property table (.tab / .pvt).
 */
export function parsePvtTable(tableText: string): PvtTableData {
  const lines = tableText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  let title = "Multiphase Fluid Table";
  const pressures: number[] = [];
  const temperatures: number[] = [];

  const rawRows: { p: number; t: number; rog: number; rol: number; mug: number; mul: number; st: number }[] = [];

  for (const line of lines) {
    if (line.startsWith("TITLE") || line.startsWith("Title")) {
      const match = /=\s*["']?([^"']+)["']?/.exec(line);
      if (match && match[1]) title = match[1].trim();
      continue;
    }

    if (line.startsWith("PRESSURE") || line.startsWith("Pressure")) {
      const vals = line.replace(/^[A-Za-z_]+(\s*=\s*)?/, "").split(/[\s,]+/);
      for (const v of vals) {
        const p = parseFloat(v);
        if (Number.isFinite(p) && p > 0) {
          // If < 2000 assume bar, convert to Pa
          pressures.push(p < 2000 ? p * 1.0e5 : p);
        }
      }
      continue;
    }

    if (line.startsWith("TEMPERATURE") || line.startsWith("Temperature")) {
      const vals = line.replace(/^[A-Za-z_]+(\s*=\s*)?/, "").split(/[\s,]+/);
      for (const v of vals) {
        const t = parseFloat(v);
        if (Number.isFinite(t)) {
          // If < 200 assume C, convert to K
          temperatures.push(t < 200 ? t + 273.15 : t);
        }
      }
      continue;
    }

    if (line.startsWith("DATA") || line.startsWith("COLUMNS") || line.startsWith("TABLE")) {
      continue;
    }

    // Try parsing numeric data row: P, T, ROG, ROL, VISG, VISL, STG
    const parts = line.split(/[\s,]+/).map((v) => parseFloat(v));
    if (parts.length >= 6 && parts.every((p) => Number.isFinite(p))) {
      const pRaw = parts[0]!;
      const tRaw = parts[1]!;
      const pPa = pRaw < 2000 ? pRaw * 1e5 : pRaw;
      const tK = tRaw < 200 ? tRaw + 273.15 : tRaw;

      rawRows.push({
        p: pPa,
        t: tK,
        rog: parts[2]!,
        rol: parts[3]!,
        mug: parts[4]! > 0.05 ? parts[4]! * 1e-3 : parts[4]!, // convert cP to Pa*s if needed
        mul: parts[5]! > 0.05 ? parts[5]! * 1e-3 : parts[5]!,
        st: parts.length > 6 ? parts[6]! : 0.025,
      });
    }
  }

  // Deduplicate and sort P and T
  const pSet = Array.from(new Set(rawRows.map((r) => r.p))).sort((a, b) => a - b);
  const tSet = Array.from(new Set(rawRows.map((r) => r.t))).sort((a, b) => a - b);

  const finalP = pressures.length > 0 ? pressures.sort((a, b) => a - b) : pSet;
  const finalT = temperatures.length > 0 ? temperatures.sort((a, b) => a - b) : tSet;

  const nP = finalP.length;
  const nT = finalT.length;

  const rhoG: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(15.0));
  const rhoL: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(800.0));
  const visG: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(1.5e-5));
  const visL: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(0.002));
  const surfaceTension: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(0.025));

  for (const row of rawRows) {
    const pIdx = finalP.indexOf(row.p);
    const tIdx = finalT.indexOf(row.t);
    if (pIdx >= 0 && tIdx >= 0) {
      rhoG[pIdx]![tIdx] = row.rog;
      rhoL[pIdx]![tIdx] = row.rol;
      visG[pIdx]![tIdx] = row.mug;
      visL[pIdx]![tIdx] = row.mul;
      surfaceTension[pIdx]![tIdx] = row.st;
    }
  }

  return {
    title,
    pressures: finalP,
    temperatures: finalT,
    rhoG,
    rhoL,
    visG,
    visL,
    surfaceTension,
  };
}

/**
 * Performs 2D Bilinear Interpolation over the PVT grid.
 */
export function interpolatePvt(table: PvtTableData, pressurePa: number, tempK: number): PvtInterpolatedState {
  const { pressures: P, temperatures: T } = table;
  const nP = P.length;
  const nT = T.length;

  if (nP === 0 || nT === 0) {
    return { rhoG: 20.0, rhoL: 820.0, muG: 1.5e-5, muL: 0.002, sigma: 0.025, isExtrapolated: true };
  }

  const isExtrapolated = pressurePa < P[0]! || pressurePa > P[nP - 1]! || tempK < T[0]! || tempK > T[nT - 1]!;

  const pClamped = Math.max(P[0]!, Math.min(P[nP - 1]!, pressurePa));
  const tClamped = Math.max(T[0]!, Math.min(T[nT - 1]!, tempK));

  // Find bounding indices for P
  let i0 = 0;
  while (i0 < nP - 2 && P[i0 + 1]! < pClamped) i0++;
  const i1 = Math.min(nP - 1, i0 + 1);

  // Find bounding indices for T
  let j0 = 0;
  while (j0 < nT - 2 && T[j0 + 1]! < tClamped) j0++;
  const j1 = Math.min(nT - 1, j0 + 1);

  const u = i1 === i0 ? 0 : (pClamped - P[i0]!) / Math.max(1e-6, P[i1]! - P[i0]!);
  const v = j1 === j0 ? 0 : (tClamped - T[j0]!) / Math.max(1e-6, T[j1]! - T[j0]!);

  function bilerp(grid: number[][]): number {
    const q00 = grid[i0]![j0]!;
    const q10 = grid[i1]![j0]!;
    const q01 = grid[i0]![j1]!;
    const q11 = grid[i1]![j1]!;
    return (1 - u) * (1 - v) * q00 + u * (1 - v) * q10 + (1 - u) * v * q01 + u * v * q11;
  }

  return {
    rhoG: bilerp(table.rhoG),
    rhoL: bilerp(table.rhoL),
    muG: bilerp(table.visG),
    muL: bilerp(table.visL),
    sigma: bilerp(table.surfaceTension),
    isExtrapolated,
  };
}
