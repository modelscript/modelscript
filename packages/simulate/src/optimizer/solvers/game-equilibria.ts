// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Algorithmic Game Theory & Transactive Market Clearing.
 *
 * Provides:
 *   1. Bimatrix Nash Equilibrium solver (support enumeration for exact mixed/pure Nash equilibria)
 *   2. Double-Auction Uniform-Price / LMP Market Clearing (for `opf`, `openadr`, transactive grids)
 */

import { solveDenseLinear } from "@modelscript/runtime";

export interface NashEquilibrium {
  readonly strategyA: number[];
  readonly strategyB: number[];
  readonly payoffA: number;
  readonly payoffB: number;
}

/**
 * Computes a Nash Equilibrium for a 2-player bimatrix game (payoffA, payoffB) via
 * exact support enumeration (pure equilibria first, then equal-size mixed supports).
 */
export function solveBimatrixNash(
  payoffA: readonly (readonly number[])[],
  payoffB: readonly (readonly number[])[],
): NashEquilibrium | null {
  const m = payoffA.length;
  const n = payoffA[0]!.length;

  // 1. Check pure strategy Nash equilibria
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let bestA = true;
      for (let i2 = 0; i2 < m; i2++) {
        if (payoffA[i2]![j]! > payoffA[i]![j]! + 1e-9) {
          bestA = false;
          break;
        }
      }
      if (!bestA) continue;
      let bestB = true;
      for (let j2 = 0; j2 < n; j2++) {
        if (payoffB[i]![j2]! > payoffB[i]![j]! + 1e-9) {
          bestB = false;
          break;
        }
      }
      if (bestB) {
        const sA = new Array<number>(m).fill(0);
        const sB = new Array<number>(n).fill(0);
        sA[i] = 1;
        sB[j] = 1;
        return { strategyA: sA, strategyB: sB, payoffA: payoffA[i]![j]!, payoffB: payoffB[i]![j]! };
      }
    }
  }

  // 2. Mixed support enumeration (k = 2 .. min(m, n))
  const subsets = (len: number, k: number): number[][] => {
    const out: number[][] = [];
    const cur: number[] = [];
    const dfs = (start: number): void => {
      if (cur.length === k) {
        out.push([...cur]);
        return;
      }
      for (let i = start; i <= len - (k - cur.length); i++) {
        cur.push(i);
        dfs(i + 1);
        cur.pop();
      }
    };
    dfs(0);
    return out;
  };

  for (let k = 2; k <= Math.min(m, n, 6); k++) {
    const supAs = subsets(m, k);
    const supBs = subsets(n, k);
    for (const sA of supAs) {
      for (const sB of supBs) {
        // Solve indifference for player B's probabilities y over sB:
        //   sum_{j in sB} A[i][j] y_j = vA for i in sA, sum y_j = 1
        const dim = k + 1;
        const matB = new Float64Array(dim * dim);
        const rhsB = new Float64Array(dim);
        for (let r = 0; r < k; r++) {
          for (let c = 0; c < k; c++) matB[r * dim + c] = payoffA[sA[r]!]![sB[c]!]!;
          matB[r * dim + k] = -1.0;
        }
        for (let c = 0; c < k; c++) matB[k * dim + c] = 1.0;
        rhsB[k] = 1.0;
        const solY = solveDenseLinear(matB, rhsB, dim);
        const vA = solY[k]!;

        // Solve indifference for player A's probabilities x over sA:
        const matA = new Float64Array(dim * dim);
        const rhsA = new Float64Array(dim);
        for (let r = 0; r < k; r++) {
          for (let c = 0; c < k; c++) matA[r * dim + c] = payoffB[sA[c]!]![sB[r]!]!;
          matA[r * dim + k] = -1.0;
        }
        for (let c = 0; c < k; c++) matA[k * dim + c] = 1.0;
        rhsA[k] = 1.0;
        const solX = solveDenseLinear(matA, rhsA, dim);
        const vB = solX[k]!;

        let valid = true;
        for (let c = 0; c < k; c++) {
          if (solX[c]! < -1e-7 || solY[c]! < -1e-7) valid = false;
        }
        if (!valid) continue;

        const stratA = new Array<number>(m).fill(0);
        const stratB = new Array<number>(n).fill(0);
        for (let c = 0; c < k; c++) {
          stratA[sA[c]!] = Math.max(0, solX[c]!);
          stratB[sB[c]!] = Math.max(0, solY[c]!);
        }

        // Verify no profitable unilateral deviation
        for (let i = 0; i < m; i++) {
          let expA = 0;
          for (let j = 0; j < n; j++) expA += payoffA[i]![j]! * stratB[j]!;
          if (expA > vA + 1e-6) {
            valid = false;
            break;
          }
        }
        for (let j = 0; j < n && valid; j++) {
          let expB = 0;
          for (let i = 0; i < m; i++) expB += stratA[i]! * payoffB[i]![j]!;
          if (expB > vB + 1e-6) {
            valid = false;
            break;
          }
        }
        if (valid) {
          return { strategyA: stratA, strategyB: stratB, payoffA: vA, payoffB: vB };
        }
      }
    }
  }

  return null;
}

export interface MarketBid {
  readonly id: string;
  readonly side: "buy" | "sell";
  readonly price: number;
  readonly quantity: number;
}

export interface MarketClearingResult {
  readonly clearingPrice: number;
  readonly clearedVolume: number;
  readonly socialWelfare: number;
  readonly dispatches: Record<string, number>;
}

/**
 * Uniform-Price Double-Auction Market Clearing (merit-order supply/demand intersection).
 */
export function clearDoubleAuction(bids: readonly MarketBid[]): MarketClearingResult {
  const buys = bids.filter((b) => b.side === "buy").sort((a, b) => b.price - a.price);
  const sells = bids.filter((b) => b.side === "sell").sort((a, b) => a.price - b.price);
  const dispatches: Record<string, number> = {};
  for (const b of bids) dispatches[b.id] = 0;

  let bi = 0;
  let si = 0;
  let remBuy = buys[0]?.quantity ?? 0;
  let remSell = sells[0]?.quantity ?? 0;
  let clearedVolume = 0;
  let socialWelfare = 0;
  let lastBuyPrice = 0;
  let lastSellPrice = 0;

  while (bi < buys.length && si < sells.length) {
    const buy = buys[bi]!;
    const sell = sells[si]!;
    if (buy.price < sell.price) break;

    const qty = Math.min(remBuy, remSell);
    if (qty > 0) {
      dispatches[buy.id] = (dispatches[buy.id] ?? 0) + qty;
      dispatches[sell.id] = (dispatches[sell.id] ?? 0) + qty;
      clearedVolume += qty;
      socialWelfare += qty * (buy.price - sell.price);
      lastBuyPrice = buy.price;
      lastSellPrice = sell.price;
    }
    remBuy -= qty;
    remSell -= qty;
    if (remBuy <= 1e-12) {
      bi++;
      remBuy = buys[bi]?.quantity ?? 0;
    }
    if (remSell <= 1e-12) {
      si++;
      remSell = sells[si]?.quantity ?? 0;
    }
  }

  const clearingPrice = clearedVolume > 0 ? 0.5 * (lastBuyPrice + lastSellPrice) : 0;
  return { clearingPrice, clearedVolume, socialWelfare, dispatches };
}
