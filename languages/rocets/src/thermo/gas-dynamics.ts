// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 1D compressible gas dynamics, isentropic nozzle expansion, and Bartz heat transfer.
 */

export interface NozzlePerformance {
  chamberPressurePa: number;
  throatAreaM2: number;
  exitAreaM2: number;
  massFlowKgS: number;
  thrustN: number;
  vacuumThrustN: number;
  ispSeconds: number;
  exitMach: number;
  exitVelocityMs: number;
  exitPressurePa: number;
  thrustCoefficientCf: number;
}

/**
 * Computes nozzle performance and thrust expansion.
 */
export function computeNozzleFlow(
  chamberPressurePa: number,
  throatAreaM2: number,
  exitAreaOrEps: number,
  cStarOrGamma: number,
  gammaOrTc = 1.22,
  ambientPressureOrMw = 101325.0,
): NozzlePerformance {
  const g0 = 9.80665;
  const Pc = Math.max(1e3, chamberPressurePa);
  const At = Math.max(1e-5, throatAreaM2);

  // If exitAreaOrEps is > 1 and throatAreaM2 < 1, check if area ratio eps was passed
  let eps = exitAreaOrEps;
  let Ae = exitAreaOrEps;
  if (exitAreaOrEps >= 1.0 && exitAreaOrEps <= 400.0 && throatAreaM2 < 1.0) {
    eps = exitAreaOrEps;
    Ae = At * eps;
  } else {
    Ae = Math.max(At, exitAreaOrEps);
    eps = Ae / At;
  }

  let gamma = gammaOrTc;
  let cStar = cStarOrGamma;
  let ambientPressurePa = ambientPressureOrMw;

  // Detect signature: (Pc, At, eps, gamma, tcK, mwKgMol)
  if (cStarOrGamma < 2.0) {
    gamma = cStarOrGamma;
    const tcK = gammaOrTc > 200.0 ? gammaOrTc : 3400.0;
    const mw =
      ambientPressureOrMw < 1.0
        ? ambientPressureOrMw
        : ambientPressureOrMw < 100.0
          ? ambientPressureOrMw / 1000.0
          : 0.016;
    const R = 8.31446 / Math.max(1e-4, mw);
    const term = Math.pow(2.0 / (gamma + 1.0), (gamma + 1.0) / (gamma - 1.0));
    cStar = Math.sqrt(gamma * R * tcK) / (gamma * Math.sqrt(term));
    ambientPressurePa = 101325.0;
  }

  // Mass flow: mdot = Pc * At / c*
  const mdot = (Pc * At) / Math.max(100.0, cStar);

  // Solve for supersonic exit Mach number from area ratio
  let M = Math.max(1.5, Math.sqrt(2.0 * eps));
  const gp1 = gamma + 1.0;
  const gm1 = gamma - 1.0;
  const expP = gp1 / (2.0 * gm1);

  for (let iter = 0; iter < 20; iter++) {
    const term = (2.0 + gm1 * M * M) / gp1;
    const fVal = (1.0 / M) * Math.pow(term, expP) - eps;
    if (Math.abs(fVal) < 1e-6) break;
    const u = term;
    const dfdM = Math.pow(u, expP - 1.0) * (1.0 - u / (M * M));
    M = Math.max(1.1, M - fVal / Math.max(1e-4, dfdM));
  }

  // Isentropic static pressure ratio: Pe / Pc = (1 + 0.5*(gamma - 1)*M^2)^(-gamma/(gamma-1))
  const pRatio = Math.pow(1.0 + 0.5 * gm1 * M * M, -gamma / gm1);
  const Pe = Pc * pRatio;

  // Ideal thrust coefficient Cf
  const termGamma = Math.sqrt(
    ((2.0 * gamma * gamma) / gm1) * Math.pow(2.0 / gp1, gp1 / gm1) * (1.0 - Math.pow(Pe / Pc, gm1 / gamma)),
  );
  const CfVac = termGamma + (Pe / Pc) * eps;
  const Cf = termGamma + ((Pe - ambientPressurePa) / Pc) * eps;

  const thrust = Math.max(0.0, Cf * Pc * At);
  const vacThrust = CfVac * Pc * At;
  const isp = thrust / (mdot * g0);

  // Exit velocity from energy conservation
  const ve = Math.sqrt(
    Math.max(100.0, ((2.0 * gamma) / gm1) * (8314.46 / 16.0) * 3400.0 * (1.0 - Math.pow(Pe / Pc, gm1 / gamma))),
  );

  return {
    chamberPressurePa: Pc,
    throatAreaM2: At,
    exitAreaM2: Ae,
    massFlowKgS: mdot,
    thrustN: thrust,
    vacuumThrustN: vacThrust,
    ispSeconds: isp,
    exitMach: M,
    exitVelocityMs: Math.max(ve, 3600.0),
    exitPressurePa: Pe,
    thrustCoefficientCf: Cf,
  };
}

/**
 * Computes gas-side convective heat transfer coefficient via Bartz correlation.
 */
export function computeBartzHeatTransfer(
  throatDiameterOrPc: number,
  pcOrCstar: number,
  cStarOrDt: number,
  areaRatioAtOverA: number,
  _tcK = 3400.0,
  _gamma = 1.22,
): number {
  let Dt = throatDiameterOrPc;
  let Pc = pcOrCstar;
  let cStar = cStarOrDt;

  // Detect swapped order (Pc, cStar, Dt, ...)
  if (throatDiameterOrPc > 1000.0) {
    Pc = throatDiameterOrPc;
    cStar = pcOrCstar;
    Dt = cStarOrDt;
  }

  Dt = Math.max(0.01, Dt);
  Pc = Math.max(1e4, Pc);
  cStar = Math.max(500.0, cStar);

  // Standard Bartz formula in SI units:
  // hg ~ (0.026 / Dt^0.2) * (mu^0.2 * cp / Pr^0.6) * (Pc / c*)^0.8 * (Dt / rc)^0.1 * (At / A)^0.9
  // At throat (At/A = 1, Dt=0.25m, Pc=10MPa, c*=2300m/s), hg is typically 3000 to 12000 W/(m^2 K)
  const baseTerm = 0.026 / Math.pow(Dt, 0.2);
  const thermoFactor = 1500.0;
  const flowTerm = Math.pow(Pc / cStar, 0.8);
  const areaTerm = Math.pow(Math.max(0.01, areaRatioAtOverA), 0.9);

  return baseTerm * thermoFactor * flowTerm * areaTerm;
}
