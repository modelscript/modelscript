// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Liquid Hydraulic Properties & Joukowsky Wave Speed Model.
 */

import type { LiquidProduct } from "../../types.js";

export class LiquidProperties {
  /**
   * Evaluates pressure- and temperature-dependent density for a liquid product.
   * rho(P, T) = rho0 * [1 + (P - P0)/K - beta * (T - T0)]
   */
  static getDensity(product: LiquidProduct, pPa: number, tK: number, p0 = 1.01325e5, t0 = 288.15): number {
    const k = product.bulkModulus > 0 ? product.bulkModulus : 1.4e9; // Pa
    const beta = 0.00085; // thermal expansion 1/K
    const dp = pPa - p0;
    const dt = tK - t0;
    return product.densityAtRef * (1 + dp / k - beta * dt);
  }

  /**
   * Calculates Joukowsky acoustic pressure wave speed (speed of sound in pipeline liquid).
   * a = sqrt( (K/rho) / (1 + (K/E)*(D/e)*c1) )
   * @param k Fluid bulk modulus (Pa)
   * @param rho Fluid density (kg/m3)
   * @param d Pipe inner diameter (m)
   * @param e Pipe wall thickness (m)
   * @param youngsModulus Steel Young's Modulus (default 206 GPa)
   */
  static getWaveSpeed(k: number, rho: number, d: number, e: number, youngsModulus = 206e9): number {
    const pipeElasticityFactor = (k / youngsModulus) * (d / Math.max(0.005, e));
    const effectiveBulkModulus = k / (1 + pipeElasticityFactor);
    return Math.sqrt(effectiveBulkModulus / rho);
  }
}
