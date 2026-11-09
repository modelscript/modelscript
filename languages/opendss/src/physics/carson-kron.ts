// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DssDeck, DssLineGeometry, DssLineSpacing, DssWireData } from "../types.js";

export interface ComplexMatrix {
  r: number[][];
  x: number[][];
}

/**
 * Computes primitive line series impedance matrix using Carson's earth-return equations:
 *   Z_ii = (r_i + Delta r) + j (omega * mu_0 / (2 * pi)) * ln(D_e / GMR_i)
 *   Z_ij = Delta r + j (omega * mu_0 / (2 * pi)) * ln(D_e / d_ij)
 *
 * @param spacing - Physical conductor coordinate layout (x, y).
 * @param wires - Physical conductor properties (AC resistance, GMR).
 * @param f - System frequency in Hz (default: 60).
 * @param rho - Earth resistivity in Ohm-meters (default: 100).
 */
export function computeCarsonImpedance(
  spacing: DssLineSpacing,
  wires: DssWireData[],
  f = 60,
  rho = 100,
): ComplexMatrix {
  const n = Math.min(spacing.nconds, wires.length);
  const r: number[][] = Array.from({ length: n }, () => new Float64Array(n) as unknown as number[]);
  const x: number[][] = Array.from({ length: n }, () => new Float64Array(n) as unknown as number[]);

  // Carson correction factor Delta r = pi^2 * f * 1e-4 / pi = 9.8696e-4 * f (Ohms/km)
  const deltaR = 9.8696e-4 * f;
  // Carson depth of equivalent earth return D_e = 658.87 * sqrt(rho / f) (meters)
  const dEarth = 658.87 * Math.sqrt(Math.max(1.0, rho) / Math.max(1.0, f));
  // omega * mu_0 / (2 * pi) in Ohms/km = 2 * pi * f * 2e-4
  const omegaMu = 2 * Math.PI * f * 2e-4;

  for (let i = 0; i < n; i++) {
    const wireI = wires[i];
    const xi = spacing.x[i] ?? 0;
    const yi = spacing.y[i] ?? 10;
    const gmrI = Math.max(1e-4, wireI?.gmrac ?? 0.005);
    const rAcI = wireI?.rdac ?? 0.1;

    // Self-impedance
    const rRowI = r[i];
    const xRowI = x[i];
    if (rRowI && xRowI) {
      rRowI[i] = rAcI + deltaR;
      xRowI[i] = omegaMu * Math.log(Math.max(10.0, dEarth) / gmrI);
    }

    // Mutual impedance
    for (let j = 0; j < i; j++) {
      const xj = spacing.x[j] ?? 0;
      const yj = spacing.y[j] ?? 10;
      const dx = xi - xj;
      const dy = yi - yj;
      const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));

      const rMut = deltaR;
      const xMut = omegaMu * Math.log(Math.max(10.0, dEarth) / dist);

      const rRowJ = r[j];
      const xRowJ = x[j];
      if (rRowI && xRowI && rRowJ && xRowJ) {
        rRowI[j] = rMut;
        xRowI[j] = xMut;
        rRowJ[i] = rMut;
        xRowJ[i] = xMut;
      }
    }
  }

  return { r, x };
}

/**
 * Eliminates ground and neutral conductors via Kron reduction:
 *   Z_new = Z_pp - Z_pn * (Z_nn)^(-1) * Z_np
 *
 * @param zPrim - Full primitive complex impedance matrix.
 * @param nPhases - Target number of active phase conductors.
 */
export function kronReduce(zPrim: ComplexMatrix, nPhases: number): ComplexMatrix {
  let { r, x } = zPrim;
  let curN = r.length;

  // Reduce one neutral conductor at a time from last conductor down to nPhases
  while (curN > nPhases) {
    const k = curN - 1;
    const rKk = r[k]?.[k] ?? 1.0;
    const xKk = x[k]?.[k] ?? 1.0;
    const denom = rKk * rKk + xKk * xKk;
    if (denom < 1e-12) break;

    const newR: number[][] = Array.from({ length: k }, () => new Float64Array(k) as unknown as number[]);
    const newX: number[][] = Array.from({ length: k }, () => new Float64Array(k) as unknown as number[]);

    for (let i = 0; i < k; i++) {
      const rIk = r[i]?.[k] ?? 0;
      const xIk = x[i]?.[k] ?? 0;

      for (let j = 0; j < k; j++) {
        const rKj = r[k]?.[j] ?? 0;
        const xKj = x[k]?.[j] ?? 0;

        // Numerator = (rIk + j xIk) * (rKj + j xKj)
        const numR = rIk * rKj - xIk * xKj;
        const numX = rIk * xKj + xIk * rKj;

        // Quotient = Numerator / (rKk + j xKk) = Numerator * (rKk - j xKk) / denom
        const redR = (numR * rKk + numX * xKk) / denom;
        const redX = (numX * rKk - numR * xKk) / denom;

        const rowR = newR[i];
        const rowX = newX[i];
        if (rowR && rowX) {
          rowR[j] = (r[i]?.[j] ?? 0) - redR;
          rowX[j] = (x[i]?.[j] ?? 0) - redX;
        }
      }
    }

    r = newR;
    x = newX;
    curN = k;
  }

  return { r, x };
}

/**
 * Synthesizes line resistance and reactance matrices from physical LineGeometry and LineSpacing.
 */
export function synthesizeLineGeometry(
  geom: DssLineGeometry,
  deck: DssDeck,
): { rmatrix: number[][]; xmatrix: number[][] } {
  const spacing = deck.lineSpacings?.get(geom.spacing);
  const defaultSpacing: DssLineSpacing = {
    name: geom.spacing,
    nconds: geom.nconds,
    nphases: geom.nphases,
    x: [0, 0.75, 1.5, 0.75],
    y: [10, 10, 10, 8.5],
    range: geom.range,
  };
  const actualSpacing = spacing ?? defaultSpacing;

  const wireList: DssWireData[] = [];
  for (const wireName of geom.wires) {
    const wire = deck.wireData?.get(wireName) ?? {
      name: wireName,
      diam: 0.015,
      rdac: 0.18,
      gmrac: 0.004,
      range: geom.range,
    };
    wireList.push(wire);
  }

  const prim = computeCarsonImpedance(actualSpacing, wireList);
  const reduced = geom.reduce ? kronReduce(prim, geom.nphases) : prim;

  return {
    rmatrix: reduced.r,
    xmatrix: reduced.x,
  };
}
