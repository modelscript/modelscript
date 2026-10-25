// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Peng-Robinson Cubic Equation of State.
 *
 * Implements analytical cubic polynomial solving for density, compressibility Z,
 * and phase state for general hydrocarbon systems and dense-phase CO2 pipelines.
 */

const R_GAS = 8.314462618; // J/(mol*K)

export interface CubicEosResult {
  zFactor: number;
  massDensity: number; // kg/m3
  speedOfSound: number; // m/s
  phase: "GAS" | "LIQUID" | "SUPERCRITICAL";
}

export class PengRobinsonEos {
  /**
   * Evaluates Peng-Robinson EOS for a single-phase fluid or pseudo-component.
   * @param pPa Pressure in Pa
   * @param tK Temperature in Kelvin
   * @param tc Critical temperature in Kelvin (default 190.56 K for CH4)
   * @param pc Critical pressure in Pa (default 45.99e5 Pa for CH4)
   * @param omega Acentric factor (default 0.011 for CH4)
   * @param molarMass Molar mass in kg/mol (default 0.01604 kg/mol)
   */
  static evaluate(
    pPa: number,
    tK: number,
    tc = 190.56,
    pc = 45.99e5,
    omega = 0.011,
    molarMass = 0.01604,
  ): CubicEosResult {
    const tr = tK / tc;
    // PR parameters
    const m = 0.37464 + 1.54226 * omega - 0.26992 * omega ** 2;
    const alpha = (1 + m * (1 - Math.sqrt(tr))) ** 2;

    const a = ((0.45724 * (R_GAS * tc) ** 2) / pc) * alpha;
    const b = (0.0778 * R_GAS * tc) / pc;

    const A = (a * pPa) / (R_GAS * tK) ** 2;
    const B = (b * pPa) / (R_GAS * tK);

    // Cubic polynomial in Z: Z^3 - (1 - B)*Z^2 + (A - 2*B - 3*B^2)*Z - (A*B - B^2 - B^3) = 0
    const a2 = -(1 - B);
    const a1 = A - 2 * B - 3 * B ** 2;
    const a0 = -(A * B - B ** 2 - B ** 3);

    const roots = this.solveCubic(a2, a1, a0);
    // Filter real positive roots > B
    const validRoots = roots.filter((z) => z > B && Number.isFinite(z));
    const zFactor = validRoots.length > 0 ? Math.max(...validRoots) : 1.0;

    const molarDensityM3 = pPa / (zFactor * R_GAS * tK);
    const massDensity = molarDensityM3 * molarMass;

    let phase: "GAS" | "LIQUID" | "SUPERCRITICAL" = "GAS";
    if (tK > tc && pPa > pc) phase = "SUPERCRITICAL";
    else if (zFactor < 0.3) phase = "LIQUID";

    const gamma = 1.3;
    const speedOfSound = Math.sqrt(Math.max(100, (gamma * zFactor * R_GAS * tK) / molarMass));

    return {
      zFactor,
      massDensity,
      speedOfSound,
      phase,
    };
  }

  /** Solves depressed cubic equation x^3 + a2*x^2 + a1*x + a0 = 0 via Cardano method. */
  private static solveCubic(a2: number, a1: number, a0: number): number[] {
    const p = a1 - a2 ** 2 / 3;
    const q = (2 * a2 ** 3) / 27 - (a2 * a1) / 3 + a0;

    const discriminant = q ** 2 / 4 + p ** 3 / 27;
    const shift = -a2 / 3;

    if (discriminant > 1e-12) {
      // 1 real root
      const u = Math.cbrt(-q / 2 + Math.sqrt(discriminant));
      const v = Math.cbrt(-q / 2 - Math.sqrt(discriminant));
      return [u + v + shift];
    } else if (Math.abs(discriminant) <= 1e-12) {
      // 2 or 3 real roots (multiple)
      const u = Math.cbrt(-q / 2);
      return [2 * u + shift, -u + shift];
    } else {
      // 3 distinct real roots
      const r = Math.sqrt(-(p ** 3) / 27);
      const phi = Math.acos(Math.max(-1, Math.min(1, -q / (2 * r))));
      const root1 = 2 * Math.cbrt(r) * Math.cos(phi / 3) + shift;
      const root2 = 2 * Math.cbrt(r) * Math.cos((phi + 2 * Math.PI) / 3) + shift;
      const root3 = 2 * Math.cbrt(r) * Math.cos((phi + 4 * Math.PI) / 3) + shift;
      return [root1, root2, root3];
    }
  }
}
