// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cea — 1D Isentropic Rocket Nozzle Performance & CJ Detonation Solver.
 *
 * Computes chamber equilibrium (T_c, gamma, M_w), sonic throat (c*), supersonic/subsonic
 * nozzle exit stations (C_F, I_sp,vac, I_sp,sl, Mach), and Chapman-Jouguet detonation waves.
 */

import type {
  CeaDeck,
  CeaSolveResult,
  DetonationResult,
  EquilibriumState,
  RocketPerformanceResult,
  RocketStationResult,
} from "../types.js";
import {
  prepareReactantMixture,
  solveEquilibriumHP,
  solveEquilibriumSP,
  solveEquilibriumSV,
  solveEquilibriumTP,
  solveEquilibriumTV,
  solveEquilibriumUV,
  solveFrozenSP,
  type PreparedMixture,
} from "./equilibrium-solver.js";
import { G0_STANDARD, P_BAR_PA, P_STD_PA, R_UNIVERSAL } from "./thermo-db.js";

function expandIsentropic(
  mix: PreparedMixture,
  chamber: EquilibriumState,
  pressurePa: number,
  mode: "equilibrium" | "frozen",
  tGuessK: number,
): EquilibriumState {
  if (mode === "frozen") {
    return solveFrozenSP(mix, chamber.speciesMolesPerKg, pressurePa, chamber.entropyJKgK, tGuessK);
  }
  const warm = mix.species.map((sp) => chamber.speciesMolesPerKg[sp.name] ?? 1e-12);
  return solveEquilibriumSP(mix, pressurePa, chamber.entropyJKgK, tGuessK, warm);
}

/**
 * Solves 1D isentropic rocket nozzle performance (IAC) in equilibrium or frozen mode.
 */
export function solveRocketPerformance(
  mix: PreparedMixture,
  chamberPressurePa: number,
  options?: {
    mode?: "equilibrium" | "frozen" | undefined;
    supar?: number[] | undefined;
    subar?: number[] | undefined;
    piPeRatios?: number[] | undefined;
    tcEstK?: number | undefined;
  },
): RocketPerformanceResult {
  const mode = options?.mode ?? "equilibrium";
  const chamber = solveEquilibriumHP(mix, chamberPressurePa, mix.enthalpyJKg, options?.tcEstK ?? 3300.0);

  // 1. Find sonic throat pressure Pt where flow velocity u(Pt) == sonic velocity a(Pt)
  const g = chamber.gamma;
  const ptInit = chamberPressurePa * Math.pow(2.0 / (g + 1.0), g / (g - 1.0));
  let pLo = chamberPressurePa * 0.35;
  let pHi = chamberPressurePa * 0.72;
  let pThroat = Math.max(pLo, Math.min(pHi, ptInit));

  const evalStationAtP = (pPa: number, tGuess: number) => {
    const st = expandIsentropic(mix, chamber, pPa, mode, tGuess);
    const dh = Math.max(0.0, chamber.enthalpyJKg - st.enthalpyJKg);
    const vel = Math.sqrt(2.0 * dh);
    const mach = vel / st.sonicVelocityMS;
    return { st, vel, mach };
  };

  let throatEval = evalStationAtP(pThroat, chamber.temperatureK * 0.92);

  // Bisection on M(P) - 1 = 0: lower P -> higher Mach (> 1), higher P -> lower Mach (< 1)
  for (let iter = 0; iter < 40; iter++) {
    if (Math.abs(throatEval.mach - 1.0) < 1e-6) break;
    if (throatEval.mach > 1.0) {
      pLo = pThroat;
    } else {
      pHi = pThroat;
    }
    pThroat = 0.5 * (pLo + pHi);
    throatEval = evalStationAtP(pThroat, throatEval.st.temperatureK);
    if ((pHi - pLo) / chamberPressurePa < 1e-8) break;
  }

  const mdotPerAt = throatEval.st.densityKgM3 * throatEval.vel; // kg/(s*m^2)
  const cStarMS = chamberPressurePa / mdotPerAt;

  const makeStation = (
    station: "chamber" | "throat" | "exit",
    st: EquilibriumState,
    vel: number,
    areaRatio: number,
  ): RocketStationResult => {
    const mach = vel / st.sonicVelocityMS;
    // Ae / mdot = areaRatio / mdotPerAt
    const aePerMdot = areaRatio / mdotPerAt;
    const veVac = vel + st.pressurePa * aePerMdot;
    const veSl = Math.max(0.0, vel + (st.pressurePa - P_STD_PA) * aePerMdot);
    const ispVacS = veVac / G0_STANDARD;
    const ispSlS = veSl / G0_STANDARD;
    const cf = vel / cStarMS;
    const cfVac = veVac / cStarMS;
    return {
      station,
      state: st,
      areaRatio,
      mach,
      velocityMS: vel,
      cStarMS,
      cf,
      cfVac,
      ispVacS,
      ispSlS,
    };
  };

  const chamberStation = makeStation("chamber", chamber, 0.0, Infinity);
  const throatStation = makeStation("throat", throatEval.st, throatEval.vel, 1.0);

  const exits: RocketStationResult[] = [];
  const piPeList = options?.piPeRatios ?? [];
  const suparList = options?.supar ?? [];
  const subarList = options?.subar ?? [];

  // Process pi/pe exit stations
  for (const pipe of piPeList) {
    if (pipe <= 1.0) continue;
    const pExit = chamberPressurePa / pipe;
    const tGuess = chamber.temperatureK * Math.pow(1.0 / pipe, (g - 1.0) / g);
    const ev = evalStationAtP(pExit, Math.max(200.0, tGuess));
    const areaRatio = mdotPerAt / Math.max(1e-12, ev.st.densityKgM3 * ev.vel);
    exits.push(makeStation("exit", ev.st, ev.vel, areaRatio));
  }

  // Process supersonic area ratios (supar = Ae/At > 1, P_e < P_throat)
  for (const epsTarget of suparList) {
    if (epsTarget <= 1.0) continue;
    let lnPLo = Math.log(pThroat) - 18.0;
    let lnPHi = Math.log(pThroat) - 1e-5;
    let tGuess = throatEval.st.temperatureK * 0.5;
    let bestEv = throatEval;
    let bestEps = 1.0;

    for (let iter = 0; iter < 50; iter++) {
      const lnPMid = 0.5 * (lnPLo + lnPHi);
      const pMid = Math.exp(lnPMid);
      const ev = evalStationAtP(pMid, tGuess);
      tGuess = ev.st.temperatureK;
      const eps = mdotPerAt / Math.max(1e-18, ev.st.densityKgM3 * ev.vel);
      bestEv = ev;
      bestEps = eps;

      if (Math.abs(eps - epsTarget) / epsTarget < 1e-5) break;
      // Lower pressure -> larger supersonic area ratio
      if (eps > epsTarget) {
        lnPLo = lnPMid;
      } else {
        lnPHi = lnPMid;
      }
      if (lnPHi - lnPLo < 1e-8) break;
    }
    exits.push(makeStation("exit", bestEv.st, bestEv.vel, bestEps));
  }

  // Process subsonic area ratios (subar = A/At > 1, P_throat < P < P_c)
  for (const epsTarget of subarList) {
    if (epsTarget <= 1.0) continue;
    let pSubLo = pThroat + 1.0;
    let pSubHi = chamberPressurePa * 0.9999;
    let tGuess = throatEval.st.temperatureK * 1.02;
    let bestEv = throatEval;
    let bestEps = 1.0;

    for (let iter = 0; iter < 45; iter++) {
      const pMid = 0.5 * (pSubLo + pSubHi);
      const ev = evalStationAtP(pMid, tGuess);
      tGuess = ev.st.temperatureK;
      const eps = mdotPerAt / Math.max(1e-18, ev.st.densityKgM3 * ev.vel);
      bestEv = ev;
      bestEps = eps;

      if (Math.abs(eps - epsTarget) / epsTarget < 1e-5) break;
      // Higher pressure in subsonic branch -> lower velocity -> larger area ratio
      if (eps > epsTarget) {
        pSubHi = pMid;
      } else {
        pSubLo = pMid;
      }
      if ((pSubHi - pSubLo) / chamberPressurePa < 1e-8) break;
    }
    exits.push(makeStation("exit", bestEv.st, bestEv.vel, bestEps));
  }

  // Default exit if none specified: sea-level optimum expansion (P_e = 1 atm)
  if (exits.length === 0) {
    const pExit = Math.min(pThroat * 0.5, P_STD_PA);
    const tGuess = chamber.temperatureK * Math.pow(pExit / chamberPressurePa, (g - 1.0) / g);
    const ev = evalStationAtP(pExit, Math.max(250.0, tGuess));
    const areaRatio = mdotPerAt / Math.max(1e-12, ev.st.densityKgM3 * ev.vel);
    exits.push(makeStation("exit", ev.st, ev.vel, areaRatio));
  }

  const lastExit = exits[exits.length - 1] ?? throatStation;

  return {
    mode,
    ofRatio: mix.ofRatio,
    phi: mix.phi,
    chamber: chamberStation,
    throat: throatStation,
    exits,
    cStarMS,
    ispVacS: lastExit.ispVacS,
    ispSlS: lastExit.ispSlS,
    cfVac: lastExit.cfVac,
    cf: lastExit.cf,
  };
}

/**
 * Solves a 1D Chapman-Jouguet (CJ) detonation wave (`deton` problem).
 */
export function solveDetonationCJ(
  mix: PreparedMixture,
  p1Pa: number,
  t1K: number = mix.initialTempK,
): DetonationResult {
  const r1 = R_UNIVERSAL / mix.initialMolarMassKgMol;
  const rho1 = p1Pa / (r1 * t1K);
  const v1 = 1.0 / rho1;
  const h1 = mix.enthalpyJKg;

  // Solve Hugoniot T2 for a given pressure ratio rP = P2 / P1
  const solveHugoniotAtRP = (rP: number, tGuess: number) => {
    const p2 = p1Pa * rP;
    let tLo = 500.0;
    let tHi = 7000.0;
    let T = Math.max(tLo + 10, Math.min(tHi - 10, tGuess));
    let st = solveEquilibriumTP(mix, T, p2, false);

    for (let iter = 0; iter < 35; iter++) {
      const v2 = 1.0 / st.densityKgM3;
      const hug = st.enthalpyJKg - h1 - 0.5 * (p2 - p1Pa) * (v1 + v2);
      if (Math.abs(hug) < 50.0) break;
      if (hug < 0) tLo = Math.max(tLo, T);
      else tHi = Math.min(tHi, T);
      const tNext = 0.5 * (tLo + tHi);
      T = tNext;
      st = solveEquilibriumTP(mix, T, p2, false);
      if (tHi - tLo < 1e-2) break;
    }

    const fullSt = solveEquilibriumTP(mix, T, p2, true);
    const v2 = 1.0 / fullSt.densityKgM3;
    const denom = Math.max(1e-12, v1 - v2);
    const D = v1 * Math.sqrt(Math.max(1.0, (p2 - p1Pa) / denom));
    const u2 = D * (v2 / v1);
    const m2 = u2 / fullSt.sonicVelocityMS;
    return { st: fullSt, D, u2, m2 };
  };

  // Bisect on pressure ratio rP where M2 == 1.0 (CJ tangency condition)
  let rLo = 4.0;
  let rHi = 55.0;
  let best = solveHugoniotAtRP(18.0, 3200.0);
  let converged = false;

  for (let iter = 0; iter < 30; iter++) {
    const rMid = 0.5 * (rLo + rHi);
    best = solveHugoniotAtRP(rMid, best.st.temperatureK);
    if (Math.abs(best.m2 - 1.0) < 1e-4) {
      converged = true;
      break;
    }
    // Lower rP -> weak branch (M2 > 1); higher rP -> strong branch (M2 < 1)
    if (best.m2 > 1.0) {
      rLo = rMid;
    } else {
      rHi = rMid;
    }
    if (rHi - rLo < 1e-4) {
      converged = true;
      break;
    }
  }

  const a1 = Math.sqrt(1.4 * r1 * t1K);

  return {
    initialState: {
      temperatureK: t1K,
      pressurePa: p1Pa,
      densityKgM3: rho1,
      enthalpyJKg: h1,
      molarMassGMol: mix.initialMolarMassKgMol * 1000.0,
    },
    cjState: best.st,
    detonationVelocityMS: best.D,
    machCJ: best.D / a1,
    pressureRatio: best.st.pressurePa / p1Pa,
    temperatureRatio: best.st.temperatureK / t1K,
    densityRatio: best.st.densityKgM3 / rho1,
    converged,
  };
}

/**
 * Top-level solver dispatcher for a parsed `CeaDeck`.
 */
export function solveCeaDeck(deck: CeaDeck): CeaSolveResult {
  const mix = prepareReactantMixture(deck);
  const problemType = deck.problem.problemType ?? "hp";
  const pBar = deck.problem.pressuresBar[0] ?? 1.01325;
  const pPa = pBar * P_BAR_PA;
  const tK = deck.problem.temperaturesK[0] ?? 298.15;

  if (problemType === "rocket") {
    const mode = deck.problem.frozen && !deck.problem.equilibrium ? "frozen" : "equilibrium";
    const rocket = solveRocketPerformance(mix, pPa, {
      mode,
      supar: deck.problem.supar,
      subar: deck.problem.subar,
      piPeRatios: deck.problem.piPeRatios,
      tcEstK: deck.problem.tcEstK,
    });
    return {
      problemType,
      equilibrium: rocket.chamber.state,
      rocket,
    };
  }

  if (problemType === "deton" || problemType === "shock") {
    const detonation = solveDetonationCJ(mix, pPa, deck.problem.temperaturesK[0] ?? mix.initialTempK);
    return {
      problemType,
      equilibrium: detonation.cjState,
      detonation,
    };
  }

  if (problemType === "tp") {
    const equilibrium = solveEquilibriumTP(mix, tK, pPa, true);
    return { problemType, equilibrium };
  }

  if (problemType === "sp") {
    const ref = solveEquilibriumHP(mix, pPa, mix.enthalpyJKg);
    const equilibrium = solveEquilibriumSP(mix, pPa, ref.entropyJKgK, ref.temperatureK);
    return { problemType, equilibrium };
  }

  if (problemType === "tv") {
    const rho0 = pPa / ((R_UNIVERSAL / mix.initialMolarMassKgMol) * mix.initialTempK);
    const equilibrium = solveEquilibriumTV(mix, tK, rho0);
    return { problemType, equilibrium };
  }

  if (problemType === "uv") {
    const rho0 = pPa / ((R_UNIVERSAL / mix.initialMolarMassKgMol) * mix.initialTempK);
    const u0 = mix.enthalpyJKg - (R_UNIVERSAL / mix.initialMolarMassKgMol) * mix.initialTempK;
    const equilibrium = solveEquilibriumUV(mix, rho0, u0);
    return { problemType, equilibrium };
  }

  if (problemType === "sv") {
    const rho0 = pPa / ((R_UNIVERSAL / mix.initialMolarMassKgMol) * mix.initialTempK);
    const ref = solveEquilibriumTP(mix, mix.initialTempK, pPa, false);
    const equilibrium = solveEquilibriumSV(mix, rho0, ref.entropyJKgK);
    return { problemType, equilibrium };
  }

  // Default: HP adiabatic flame equilibrium
  const equilibrium = solveEquilibriumHP(mix, pPa, mix.enthalpyJKg, deck.problem.tcEstK ?? 3000.0);
  return { problemType: "hp", equilibrium };
}
