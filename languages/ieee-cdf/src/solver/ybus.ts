// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IeeeCdfNetwork } from "../types.js";

export interface SparseYEntry {
  col: number;
  g: number;
  b: number;
}

export interface YBusMatrix {
  size: number;
  /** Bus numbers in matrix row/column order. */
  busNumbers: number[];
  /** Map from IEEE CDF bus number to 0-based matrix index. */
  busIndexByNumber: Map<number, number>;
  /** Dense row-major conductance matrix G (size * size). */
  g: Float64Array;
  /** Dense row-major susceptance matrix B (size * size). */
  b: Float64Array;
  /** Sparse adjacency list per row (only non-zero entries). */
  rows: SparseYEntry[][];
}

/**
 * Builds the complex nodal admittance matrix `Y_bus = G + jB` for an IEEE CDF / BPA IPF network.
 * Models nominal-pi transmission lines, off-nominal tap-changing transformers, phase shifters,
 * and nodal shunt admittances.
 */
export function buildYBus(network: IeeeCdfNetwork): YBusMatrix {
  const n = network.buses.length;
  const busNumbers: number[] = [];
  const busIndexByNumber = new Map<number, number>();

  for (let i = 0; i < n; i++) {
    const bus = network.buses[i]!;
    busNumbers.push(bus.busNumber);
    busIndexByNumber.set(bus.busNumber, i);
  }

  const g = new Float64Array(n * n);
  const b = new Float64Array(n * n);

  // Nodal shunt admittances
  for (let i = 0; i < n; i++) {
    const bus = network.buses[i]!;
    const ii = i * n + i;
    g[ii] = g[ii]! + bus.shuntG;
    b[ii] = b[ii]! + bus.shuntB;
  }

  // Branch pi-models with off-nominal tap and phase shift
  for (const br of network.branches) {
    const f = busIndexByNumber.get(br.fromBus);
    const t = busIndexByNumber.get(br.toBus);
    if (f === undefined || t === undefined || f === t) continue;

    const denom = br.r * br.r + br.x * br.x;
    if (denom < 1e-18) continue;

    const gs = br.r / denom;
    const bs = -br.x / denom;
    const bcHalf = 0.5 * br.b;

    const a = br.tapRatio > 0 ? br.tapRatio : 1.0;
    const a2 = a * a;
    const phi = (br.phaseShiftDeg * Math.PI) / 180.0;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    const ff = f * n + f;
    const tt = t * n + t;
    const ft = f * n + t;
    const tf = t * n + f;

    // Y_ff += (y_s + j B/2) / a^2
    g[ff] = g[ff]! + gs / a2;
    b[ff] = b[ff]! + (bs + bcHalf) / a2;

    // Y_tt += y_s + j B/2
    g[tt] = g[tt]! + gs;
    b[tt] = b[tt]! + bs + bcHalf;

    // Y_ft -= y_s / (a * e^{-j*phi}) = y_s * (cos(phi) + j*sin(phi)) / a
    g[ft] = g[ft]! - (gs * cosPhi - bs * sinPhi) / a;
    b[ft] = b[ft]! - (gs * sinPhi + bs * cosPhi) / a;

    // Y_tf -= y_s / (a * e^{+j*phi}) = y_s * (cos(phi) - j*sin(phi)) / a
    g[tf] = g[tf]! - (gs * cosPhi + bs * sinPhi) / a;
    b[tf] = b[tf]! - (-gs * sinPhi + bs * cosPhi) / a;
  }

  // Build sparse row lists for fast O(nnz) residual evaluation
  const rows: SparseYEntry[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const row = rows[i]!;
    for (let j = 0; j < n; j++) {
      const gij = g[i * n + j]!;
      const bij = b[i * n + j]!;
      if (Math.abs(gij) > 1e-15 || Math.abs(bij) > 1e-15) {
        row.push({ col: j, g: gij, b: bij });
      }
    }
  }

  return {
    size: n,
    busNumbers,
    busIndexByNumber,
    g,
    b,
    rows,
  };
}
