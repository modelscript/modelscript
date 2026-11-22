// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript multiphase model runtime for `@modelscript/olga-std-lib`.
 *
 * Implements standardized public multiphase pipeline correlations and equipment models
 * (Zuber-Findlay 1965 Drift-Flux, Beggs-Brill 1973, Taitel-Dukler 1976, Perkins 1993 Choke,
 * Standing 1947 Black-Oil PVT, Peng-Robinson 1976 EOS, Sloan-Koh Hydrate, and radial heat
 * transfer) using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — model parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — fluid/thermal/control I/O bus:
 *       Inputs:
 *         IO[0] = pressureIn (Pa)
 *         IO[1] = pressureOut (Pa)
 *         IO[2] = temperatureIn (K)
 *         IO[3] = temperatureAmb (K)
 *         IO[4] = massFlowIn (kg/s)
 *         IO[5] = jGas (m/s)
 *         IO[6] = jLiq (m/s)
 *         IO[7] = opening / controlRef (0..1 or Pa)
 *       Outputs:
 *         IO[8]  = voidFraction (0..1)
 *         IO[9]  = pressureDrop (Pa or Pa/m; negative for pressure boost)
 *         IO[10] = massFlowOut (kg/s)
 *         IO[11] = heatFlux (W)
 *         IO[12] = solutionGor (scf/STB) / zFactor / pHydrateEq (Pa)
 *         IO[13] = oilFvf (bbl/STB) / mixtureDensity (kg/m3) / regimeCode
 *         IO[14] = temperatureOut (K) / subcoolingMargin (K)
 *         IO[15] = controlOut (0..1) / pigPosition (m)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

const G_ACCEL: f64 = 9.80665;
const R_UNIV: f64 = 8.314462618;

// Archetype IDs (must match `OlgaArchetypeId` in olga-std-schemas.ts)
const ARCH_VALVE: i32 = 1;
const ARCH_CHOKE: i32 = 2;
const ARCH_PUMP: i32 = 3;
const ARCH_COMPRESSOR: i32 = 4;
const ARCH_SEPARATOR: i32 = 5;
const ARCH_HEATEXCHANGER: i32 = 6;
const ARCH_WELL: i32 = 7;
const ARCH_SOURCE: i32 = 8;
const ARCH_LEAK: i32 = 9;
const ARCH_PIG: i32 = 10;
const ARCH_PID_CONTROLLER: i32 = 11;
const ARCH_ESD_VALVE: i32 = 12;

const ARCH_FLOW_DRIFT_FLUX: i32 = 20;
const ARCH_FLOW_BEGGS_BRILL: i32 = 21;
const ARCH_FLOW_TAITEL_DUKLER: i32 = 22;
const ARCH_PVT_BLACK_OIL: i32 = 30;
const ARCH_PVT_COMPOSITIONAL_PR: i32 = 31;
const ARCH_PVT_HYDRATE_CURVE: i32 = 32;
const ARCH_WALL_INSULATED: i32 = 40;
const ARCH_WALL_BURIED: i32 = 41;

@inline
function clamp(x: f64, lo: f64, hi: f64): f64 {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_STATE + (<usize>idx << 3));
}

@inline
function setState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_STATE + (<usize>idx << 3), v);
}

@inline
function setDState(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3), v);
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

/**
 * Swamee-Jain explicit approximation to Colebrook-White Darcy friction factor.
 */
@inline
function darcyFrictionFactor(re: f64, relRough: f64): f64 {
  if (re <= 1e-9) return 0.02;
  if (re < 2300.0) return 64.0 / re;
  const term = relRough / 3.7 + 5.74 / Math.pow(re, 0.9);
  const log10Term = Math.log(term) / Math.LN10;
  return 0.25 / (log10Term * log10Term);
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function olgaGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes model states for steady-state / initial conditions.
 * Returns the number of active dynamic states for the archetype.
 */
export function olgaModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  for (let i: i32 = 0; i < 8; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }

  if (archetypeId == ARCH_SEPARATOR) {
    const level0 = clamp(getCon(slotPtr, conCount, 2, 0.45), 0.0, 1.0);
    setState(slotPtr, 0, level0);
    return 1;
  }

  if (archetypeId == ARCH_PIG) {
    setState(slotPtr, 0, 0.0); // pig position [m]
    setState(slotPtr, 1, 0.0); // pig velocity [m/s]
    setIo(slotPtr, 15, 0.0);
    return 2;
  }

  if (archetypeId == ARCH_PID_CONTROLLER) {
    const u0 = clamp(getIo(slotPtr, 7), 0.0, 1.0);
    setState(slotPtr, 0, u0); // integral accumulator
    setState(slotPtr, 1, 0.0); // previous error
    setIo(slotPtr, 15, u0);
    return 2;
  }

  if (archetypeId == ARCH_ESD_VALVE) {
    setState(slotPtr, 0, 1.0); // fully open prior to trip
    setIo(slotPtr, 15, 1.0);
    return 1;
  }

  return 0;
}

/**
 * Evaluates cleanroom OLGA equipment or multiphase correlation kernel for a single slot.
 */
export function olgaModelEval(
  archetypeId: i32,
  _t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const pIn = Math.max(1.0, getIo(slotPtr, 0));
  const pOut = Math.max(0.0, getIo(slotPtr, 1));
  const tIn = getIo(slotPtr, 2) > 1.0 ? getIo(slotPtr, 2) : 300.0;
  const tAmb = getIo(slotPtr, 3) > 1.0 ? getIo(slotPtr, 3) : 280.0;
  const mIn = Math.max(0.0, getIo(slotPtr, 4));
  const jGas = Math.max(0.0, getIo(slotPtr, 5));
  const jLiq = Math.max(0.0, getIo(slotPtr, 6));
  const opening = getIo(slotPtr, 7);

  // ── 1. Zuber-Findlay Drift-Flux Kernel ─────────────────────────────────────
  if (archetypeId == ARCH_FLOW_DRIFT_FLUX) {
    const c0 = Math.max(0.5, getCon(slotPtr, conCount, 0, 1.2));
    const vgj = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.35));
    const d = Math.max(1e-3, getCon(slotPtr, conCount, 2, 0.25));
    const theta = getCon(slotPtr, conCount, 3, 0.0);
    const rhoG = Math.max(0.1, getCon(slotPtr, conCount, 4, 45.0));
    const rhoL = Math.max(100.0, getCon(slotPtr, conCount, 5, 820.0));
    const eps = Math.max(1e-7, getCon(slotPtr, conCount, 6, 4.5e-5));

    const jm = jGas + jLiq;
    const denom = c0 * jm + vgj;
    const alpha = denom > 1e-12 ? clamp(jGas / denom, 0.0, 1.0) : 0.0;
    const rhoMix = alpha * rhoG + (1.0 - alpha) * rhoL;
    const muMix = alpha * 1.5e-5 + (1.0 - alpha) * 1.2e-3;
    const re = (rhoMix * jm * d) / Math.max(1e-9, muMix);
    const f = darcyFrictionFactor(re, eps / d);
    const dpDxFric = (f * rhoMix * jm * jm) / (2.0 * d);
    const dpDxGrav = rhoMix * G_ACCEL * Math.sin(theta);

    setIo(slotPtr, 8, alpha);
    setIo(slotPtr, 9, dpDxFric + dpDxGrav);
    setIo(slotPtr, 10, rhoMix * jm * 0.25 * Math.PI * d * d);
    setIo(slotPtr, 13, rhoMix);
    setIo(slotPtr, 14, tIn);
    return;
  }

  // ── 2. Beggs-Brill (1973) Inclined Two-Phase Flow Kernel ───────────────────
  if (archetypeId == ARCH_FLOW_BEGGS_BRILL) {
    const d = Math.max(1e-3, getCon(slotPtr, conCount, 0, 0.25));
    const theta = getCon(slotPtr, conCount, 1, 0.0);
    const rhoG = Math.max(0.1, getCon(slotPtr, conCount, 2, 45.0));
    const rhoL = Math.max(100.0, getCon(slotPtr, conCount, 3, 820.0));
    const muG = Math.max(1e-6, getCon(slotPtr, conCount, 4, 1.5e-5));
    const muL = Math.max(1e-6, getCon(slotPtr, conCount, 5, 1.2e-3));
    const eps = Math.max(1e-7, getCon(slotPtr, conCount, 6, 4.5e-5));

    const jm = Math.max(1e-6, jGas + jLiq);
    const lambdaL = clamp(jLiq / jm, 1e-6, 1.0);
    const nFr = (jm * jm) / (G_ACCEL * d);

    // Beggs-Brill regime boundaries
    const l1 = 316.0 * Math.pow(lambdaL, 0.302);
    const l2 = 0.0009252 * Math.pow(lambdaL, -2.4684);
    const l3 = 0.1 * Math.pow(lambdaL, -1.4516);
    const l4 = 0.5 * Math.pow(lambdaL, -6.738);

    // Horizontal liquid holdup H_L(0)
    let a: f64 = 0.845;
    let b: f64 = 0.5351;
    let c: f64 = 0.0173;
    if ((lambdaL < 0.01 && nFr < l1) || (lambdaL >= 0.01 && nFr < l2)) {
      // Segregated
      a = 0.98;
      b = 0.4846;
      c = 0.0868;
    } else if ((lambdaL < 0.4 && nFr >= l1) || (lambdaL >= 0.4 && nFr > l4)) {
      // Distributed
      a = 1.065;
      b = 0.5824;
      c = 0.0609;
    } else if (lambdaL >= 0.01 && nFr >= l2 && nFr <= l3) {
      // Transition: blend segregated & intermittent
      a = 0.91;
      b = 0.51;
      c = 0.05;
    }

    let hl0 = (a * Math.pow(lambdaL, b)) / Math.pow(Math.max(1e-6, nFr), c);
    hl0 = clamp(Math.max(hl0, lambdaL), lambdaL, 1.0);

    // Inclination correction factor psi
    let psi: f64 = 1.0;
    if (Math.abs(theta) > 1e-6 && lambdaL < 0.999) {
      const nLv = jLiq * Math.pow(rhoL / (G_ACCEL * 0.025), 0.25);
      const cIncl = Math.max(0.0, (1.0 - lambdaL) * Math.log(0.011 * Math.pow(Math.max(1e-4, nLv), 3.539) / (Math.pow(lambdaL, 3.768) * Math.pow(Math.max(1e-4, nFr), 1.614))));
      const sin18 = Math.sin(1.8 * theta);
      psi = 1.0 + cIncl * (sin18 - (1.0 / 3.0) * sin18 * sin18 * sin18);
    }
    const hl = clamp(hl0 * psi, lambdaL, 1.0);
    const alpha = 1.0 - hl;

    // Two-phase friction multiplier
    const rhoNs = lambdaL * rhoL + (1.0 - lambdaL) * rhoG;
    const muNs = lambdaL * muL + (1.0 - lambdaL) * muG;
    const reNs = (rhoNs * jm * d) / Math.max(1e-9, muNs);
    const fNs = darcyFrictionFactor(reNs, eps / d);

    const y = lambdaL / Math.max(1e-6, hl * hl);
    let s: f64 = 0.0;
    if (y > 1.0 && y < 1.2) {
      s = Math.log(2.2 * y - 1.2);
    } else if (y > 0.0) {
      const lny = Math.log(y);
      const denomS = -0.0523 + 3.182 * lny - 0.8725 * lny * lny + 0.01853 * lny * lny * lny * lny;
      s = Math.abs(denomS) > 1e-6 ? clamp(lny / denomS, -2.0, 4.0) : 0.0;
    }
    const fTp = fNs * Math.exp(s);
    const rhoS = hl * rhoL + alpha * rhoG;
    const dpDxFric = (fTp * rhoNs * jm * jm) / (2.0 * d);
    const dpDxGrav = rhoS * G_ACCEL * Math.sin(theta);

    setIo(slotPtr, 8, alpha);
    setIo(slotPtr, 9, dpDxFric + dpDxGrav);
    setIo(slotPtr, 10, rhoNs * jm * 0.25 * Math.PI * d * d);
    setIo(slotPtr, 13, rhoS);
    setIo(slotPtr, 14, tIn);
    return;
  }

  // ── 3. Taitel-Dukler (1976) Mechanistic Flow Regime Kernel ─────────────────
  if (archetypeId == ARCH_FLOW_TAITEL_DUKLER) {
    const d = Math.max(1e-3, getCon(slotPtr, conCount, 0, 0.25));
    const theta = getCon(slotPtr, conCount, 1, 0.0);
    const rhoG = Math.max(0.1, getCon(slotPtr, conCount, 2, 45.0));
    const rhoL = Math.max(100.0, getCon(slotPtr, conCount, 3, 820.0));
    const muG = Math.max(1e-6, getCon(slotPtr, conCount, 4, 1.5e-5));
    const muL = Math.max(1e-6, getCon(slotPtr, conCount, 5, 1.2e-3));

    const reL = (rhoL * Math.max(1e-6, jLiq) * d) / muL;
    const reG = (rhoG * Math.max(1e-6, jGas) * d) / muG;
    const fL = darcyFrictionFactor(reL, 1e-4);
    const fG = darcyFrictionFactor(reG, 1e-4);
    const dpL = (fL * rhoL * jLiq * jLiq) / (2.0 * d);
    const dpG = (fG * rhoG * jGas * jGas) / (2.0 * d);
    const xLM = dpG > 1e-12 ? Math.sqrt(dpL / dpG) : 100.0;

    // Lockhart-Martinelli void fraction & Taitel-Dukler F parameter
    const hl = clamp(1.0 / (1.0 + 1.0 / Math.max(1e-4, Math.pow(xLM, 0.8))), 0.0, 1.0);
    const alpha = 1.0 - hl;
    const fCrit = Math.sqrt(rhoG / Math.max(1.0, rhoL - rhoG)) * (jGas / Math.sqrt(d * G_ACCEL * Math.max(0.1, Math.cos(theta))));

    // Regime code: 1=Stratified, 2=Intermittent/Slug, 3=Annular, 4=Dispersed Bubble
    let regime: f64 = 1.0;
    if (fCrit > 0.5 && xLM < 1.6) {
      regime = 3.0; // Annular
    } else if (fCrit > 0.35 && xLM >= 1.6) {
      regime = 2.0; // Intermittent / Slug
    } else if (jLiq > 2.5 && alpha < 0.3) {
      regime = 4.0; // Dispersed Bubble
    }

    const rhoMix = alpha * rhoG + hl * rhoL;
    const dpDx = dpL + dpG + 2.0 * Math.sqrt(dpL * dpG) + rhoMix * G_ACCEL * Math.sin(theta);

    setIo(slotPtr, 8, alpha);
    setIo(slotPtr, 9, dpDx);
    setIo(slotPtr, 13, regime);
    setIo(slotPtr, 14, tIn);
    return;
  }

  // ── 4. Perkins (1993) Multiphase Choke ─────────────────────────────────────
  if (archetypeId == ARCH_CHOKE) {
    const d = Math.max(1e-4, getCon(slotPtr, conCount, 0, 0.05));
    const cd = Math.max(0.1, getCon(slotPtr, conCount, 1, 0.826));
    const rhoMix = Math.max(1.0, getCon(slotPtr, conCount, 2, 500.0));
    const k = clamp(getCon(slotPtr, conCount, 3, 1.25), 1.05, 1.67);
    const open = clamp(opening, 0.0, 1.0);

    const area = open * 0.25 * Math.PI * d * d;
    const yCrit = Math.pow(2.0 / (k + 1.0), k / (k - 1.0));
    const pr = clamp(pOut / pIn, 0.0, 1.0);
    const yEff = pr < yCrit ? yCrit : pr;
    const dpEff = Math.max(0.0, pIn * (1.0 - yEff));
    const mDot = cd * area * Math.sqrt(2.0 * rhoMix * dpEff);

    setIo(slotPtr, 9, Math.max(0.0, pIn - pOut));
    setIo(slotPtr, 10, mDot);
    setIo(slotPtr, 14, tIn);
    return;
  }

  // ── 5. Pipeline Control Valve ──────────────────────────────────────────────
  if (archetypeId == ARCH_VALVE) {
    const d = Math.max(1e-4, getCon(slotPtr, conCount, 0, 0.15));
    const cd = Math.max(0.1, getCon(slotPtr, conCount, 1, 0.84));
    const rhoMix = Math.max(1.0, getCon(slotPtr, conCount, 2, 650.0));
    const openMin = getCon(slotPtr, conCount, 3, 0.0);
    const openMax = getCon(slotPtr, conCount, 4, 1.0);
    const open = clamp(opening, openMin, openMax);

    const area = open * 0.25 * Math.PI * d * d;
    const dp = Math.max(0.0, pIn - pOut);
    const mDot = cd * area * Math.sqrt(2.0 * rhoMix * dp);

    setIo(slotPtr, 9, dp);
    setIo(slotPtr, 10, mDot);
    setIo(slotPtr, 14, tIn);
    return;
  }

  // ── 6. Emergency Shutdown (ESD) Valve ──────────────────────────────────────
  if (archetypeId == ARCH_ESD_VALVE) {
    const d = Math.max(1e-4, getCon(slotPtr, conCount, 0, 0.25));
    const cd = Math.max(0.1, getCon(slotPtr, conCount, 1, 0.85));
    const closeTime = Math.max(0.1, getCon(slotPtr, conCount, 2, 15.0));
    const rhoMix = Math.max(1.0, getCon(slotPtr, conCount, 3, 650.0));

    let currentOpen = getState(slotPtr, 0);
    const targetOpen = clamp(opening, 0.0, 1.0);
    if (dt > 0.0) {
      const maxStep = dt / closeTime;
      if (targetOpen < currentOpen) {
        currentOpen = Math.max(targetOpen, currentOpen - maxStep);
      } else {
        currentOpen = Math.min(targetOpen, currentOpen + maxStep);
      }
      setState(slotPtr, 0, currentOpen);
    }
    const area = currentOpen * 0.25 * Math.PI * d * d;
    const dp = Math.max(0.0, pIn - pOut);
    const mDot = cd * area * Math.sqrt(2.0 * rhoMix * dp);

    setIo(slotPtr, 9, dp);
    setIo(slotPtr, 10, mDot);
    setIo(slotPtr, 15, currentOpen);
    return;
  }

  // ── 7. Multiphase Booster Pump ─────────────────────────────────────────────
  if (archetypeId == ARCH_PUMP) {
    const ratedHead = Math.max(0.0, getCon(slotPtr, conCount, 0, 250.0));
    const ratedFlow = Math.max(1e-4, getCon(slotPtr, conCount, 1, 0.12));
    const eff = clamp(getCon(slotPtr, conCount, 2, 0.75), 0.1, 0.99);
    const rhoLiq = Math.max(100.0, getCon(slotPtr, conCount, 3, 850.0));
    const gvfLimit = clamp(getCon(slotPtr, conCount, 4, 0.25), 0.01, 0.95);

    const speedRatio = clamp(opening > 0.0 ? opening : 1.0, 0.0, 1.5);
    const jm = jGas + jLiq;
    const gvf = jm > 1e-9 ? clamp(jGas / jm, 0.0, 1.0) : 0.0;
    const qVol = mIn / rhoLiq;
    const flowRatio = qVol / ratedFlow;
    // Parabolic head curve degraded by Turpin gas-void-fraction factor
    const gvfFactor = gvf >= gvfLimit ? 0.0 : 1.0 - (gvf / gvfLimit) * (gvf / gvfLimit);
    const head = Math.max(0.0, ratedHead * speedRatio * speedRatio * (1.15 - 0.15 * flowRatio * flowRatio) * gvfFactor);
    const dpBoost = rhoLiq * G_ACCEL * head;
    const dTemp = (G_ACCEL * head * (1.0 - eff)) / (eff * 2200.0);

    setIo(slotPtr, 8, gvf);
    setIo(slotPtr, 9, -dpBoost);
    setIo(slotPtr, 10, mIn);
    setIo(slotPtr, 14, tIn + dTemp);
    return;
  }

  // ── 8. Polytropic Gas Compressor ───────────────────────────────────────────
  if (archetypeId == ARCH_COMPRESSOR) {
    const rp = Math.max(1.0, getCon(slotPtr, conCount, 0, 2.2));
    const etaP = clamp(getCon(slotPtr, conCount, 1, 0.78), 0.2, 0.99);
    const k = clamp(getCon(slotPtr, conCount, 2, 1.28), 1.05, 1.67);

    const speedRatio = clamp(opening > 0.0 ? opening : 1.0, 0.1, 1.5);
    const rpEff = 1.0 + (rp - 1.0) * speedRatio * speedRatio;
    const pDisch = pIn * rpEff;
    const tDisch = tIn * Math.pow(rpEff, (k - 1.0) / (k * etaP));

    setIo(slotPtr, 9, -(pDisch - pIn));
    setIo(slotPtr, 10, mIn);
    setIo(slotPtr, 14, tDisch);
    return;
  }

  // ── 9. Multiphase Gravity Separator ────────────────────────────────────────
  if (archetypeId == ARCH_SEPARATOR) {
    const sepEff = clamp(getCon(slotPtr, conCount, 1, 0.98), 0.5, 1.0);
    const dpVessel = Math.max(0.0, getCon(slotPtr, conCount, 3, 5000.0));
    const jm = jGas + jLiq;
    const alphaIn = jm > 1e-9 ? clamp(jGas / jm, 0.0, 1.0) : 0.5;
    const alphaOut = clamp(alphaIn * sepEff, 0.0, 1.0);

    setIo(slotPtr, 8, alphaOut);
    setIo(slotPtr, 9, dpVessel);
    setIo(slotPtr, 10, mIn);
    setIo(slotPtr, 14, tIn);
    return;
  }

  // ── 10. Pipeline Heat Exchanger: Q = U * A * (T - T_amb) ──────────────────
  if (archetypeId == ARCH_HEATEXCHANGER) {
    const u = Math.max(0.0, getCon(slotPtr, conCount, 0, 450.0));
    const area = Math.max(0.0, getCon(slotPtr, conCount, 1, 120.0));
    const cp = Math.max(100.0, getCon(slotPtr, conCount, 2, 2200.0));
    const dpHx = Math.max(0.0, getCon(slotPtr, conCount, 3, 15000.0));

    const qHeat = u * area * (tIn - tAmb);
    let tOut = tIn;
    if (mIn > 1e-6) {
      tOut = tIn - qHeat / (mIn * cp);
      // Prevent unphysical temperature crossover past ambient
      if (tIn > tAmb && tOut < tAmb) tOut = tAmb;
      if (tIn < tAmb && tOut > tAmb) tOut = tAmb;
    }

    setIo(slotPtr, 9, dpHx);
    setIo(slotPtr, 10, mIn);
    setIo(slotPtr, 11, qHeat);
    setIo(slotPtr, 14, tOut);
    return;
  }

  // ── 11. Production Wellbore IPR (Linear PI / Vogel) ────────────────────────
  if (archetypeId == ARCH_WELL) {
    const pRes = Math.max(1.0, getCon(slotPtr, conCount, 0, 2.5e7));
    const pBub = Math.max(1.0, getCon(slotPtr, conCount, 1, 1.8e7));
    const pi = Math.max(0.0, getCon(slotPtr, conCount, 2, 2.5e-6));
    const pWf = Math.min(pIn, pRes);

    let mOut: f64 = 0.0;
    if (pWf >= pBub) {
      mOut = pi * (pRes - pWf);
    } else {
      const qBub = pi * Math.max(0.0, pRes - pBub);
      const qVogelMax = (pi * pBub) / 1.8;
      const ratio = pWf / pBub;
      mOut = qBub + qVogelMax * (1.0 - 0.2 * ratio - 0.8 * ratio * ratio);
    }

    setIo(slotPtr, 9, pRes - pWf);
    setIo(slotPtr, 10, Math.max(0.0, mOut));
    setIo(slotPtr, 14, tIn);
    return;
  }

  // ── 12. Multiphase Mass Source ─────────────────────────────────────────────
  if (archetypeId == ARCH_SOURCE) {
    const mRate = Math.max(0.0, getCon(slotPtr, conCount, 0, 45.0));
    const gasFrac = clamp(getCon(slotPtr, conCount, 1, 0.15), 0.0, 1.0);
    const tSrc = Math.max(100.0, getCon(slotPtr, conCount, 2, 343.15));

    setIo(slotPtr, 8, gasFrac);
    setIo(slotPtr, 10, mRate);
    setIo(slotPtr, 14, tSrc);
    return;
  }

  // ── 13. Pipeline Leak / Orifice Discharge ──────────────────────────────────
  if (archetypeId == ARCH_LEAK) {
    const dHole = Math.max(1e-4, getCon(slotPtr, conCount, 0, 0.02));
    const cd = Math.max(0.1, getCon(slotPtr, conCount, 1, 0.62));
    const rhoMix = Math.max(1.0, getCon(slotPtr, conCount, 2, 700.0));
    const area = 0.25 * Math.PI * dHole * dHole;
    const dp = Math.max(0.0, pIn - pOut);
    const mLeak = cd * area * Math.sqrt(2.0 * rhoMix * dp);

    setIo(slotPtr, 9, dp);
    setIo(slotPtr, 10, mLeak);
    return;
  }

  // ── 14. Pipeline Pig Tracker ───────────────────────────────────────────────
  if (archetypeId == ARCH_PIG) {
    const bypass = clamp(getCon(slotPtr, conCount, 1, 0.05), 0.0, 0.5);
    const dpFric = Math.max(0.0, getCon(slotPtr, conCount, 2, 25000.0));
    const vPig = Math.max(0.0, (jGas + jLiq) * (1.0 - bypass));
    let pos = getState(slotPtr, 0);
    if (dt > 0.0) {
      pos += vPig * dt;
      setState(slotPtr, 0, pos);
      setState(slotPtr, 1, vPig);
    }

    setIo(slotPtr, 9, dpFric);
    setIo(slotPtr, 15, pos);
    return;
  }

  // ── 15. PID Process / Anti-Slug Controller ─────────────────────────────────
  if (archetypeId == ARCH_PID_CONTROLLER) {
    const kp = getCon(slotPtr, conCount, 0, 1.5);
    const ti = Math.max(0.1, getCon(slotPtr, conCount, 1, 20.0));
    const td = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.5));
    const sp = getCon(slotPtr, conCount, 3, 5.0e6);
    const uMin = getCon(slotPtr, conCount, 4, 0.05);
    const uMax = getCon(slotPtr, conCount, 5, 1.0);

    // Normalized pressure error (process variable = pIn)
    const err = (pIn - sp) / Math.max(1.0, Math.abs(sp));
    let integral = getState(slotPtr, 0);
    const prevErr = getState(slotPtr, 1);
    const deriv = dt > 1e-9 ? (err - prevErr) / dt : 0.0;
    if (dt > 0.0) {
      integral = clamp(integral + (kp / ti) * err * dt, uMin, uMax);
      setState(slotPtr, 0, integral);
      setState(slotPtr, 1, err);
    }
    const u = clamp(integral + kp * (err + td * deriv), uMin, uMax);
    setIo(slotPtr, 15, u);
    return;
  }

  // ── 16. Standing (1947) Black-Oil PVT Correlation ──────────────────────────
  if (archetypeId == ARCH_PVT_BLACK_OIL) {
    const api = clamp(getCon(slotPtr, conCount, 0, 35.0), 10.0, 65.0);
    const gammaG = clamp(getCon(slotPtr, conCount, 1, 0.72), 0.55, 1.4);

    const pPsia = pIn / 6894.757293;
    const tF = (tIn - 273.15) * 1.8 + 32.0;
    const gammaO = 141.5 / (131.5 + api);

    // Standing (1947) solution gas-oil ratio Rs [scf/STB]
    const xTerm = (pPsia / 18.2 + 1.4) * Math.pow(10.0, 0.0125 * api - 0.00091 * tF);
    const rs = gammaG * Math.pow(Math.max(0.0, xTerm), 1.2048);

    // Standing (1947) oil formation volume factor Bo [bbl/STB]
    const fBo = rs * Math.sqrt(gammaG / gammaO) + 1.25 * tF;
    const bo = 0.9759 + 0.00012 * Math.pow(Math.max(0.0, fBo), 1.2);

    setIo(slotPtr, 12, rs);
    setIo(slotPtr, 13, bo);
    setIo(slotPtr, 14, tIn);
    return;
  }

  // ── 17. Peng-Robinson (1976) Compositional Cubic EOS ───────────────────────
  if (archetypeId == ARCH_PVT_COMPOSITIONAL_PR) {
    const tc = Math.max(10.0, getCon(slotPtr, conCount, 0, 190.56));
    const pc = Math.max(1e4, getCon(slotPtr, conCount, 1, 4.599e6));
    const omega = getCon(slotPtr, conCount, 2, 0.0115);
    const mw = Math.max(1e-3, getCon(slotPtr, conCount, 3, 0.01604));

    const tr = tIn / tc;
    const kappa = 0.37464 + 1.54226 * omega - 0.26992 * omega * omega;
    const alphaSqrt = 1.0 + kappa * (1.0 - Math.sqrt(Math.max(1e-6, tr)));
    const aCrit = (0.45724 * R_UNIV * R_UNIV * tc * tc) / pc;
    const bCov = (0.0778 * R_UNIV * tc) / pc;
    const aT = aCrit * alphaSqrt * alphaSqrt;

    const A = (aT * pIn) / (R_UNIV * R_UNIV * tIn * tIn);
    const B = (bCov * pIn) / (R_UNIV * tIn);

    // Newton-Raphson for vapor compressibility root Z of:
    // Z^3 - (1 - B) Z^2 + (A - 3 B^2 - 2 B) Z - (A B - B^2 - B^3) = 0
    const c2 = -(1.0 - B);
    const c1 = A - 3.0 * B * B - 2.0 * B;
    const c0 = -(A * B - B * B - B * B * B);
    let z: f64 = 1.0;
    for (let iter: i32 = 0; iter < 12; iter++) {
      const f = ((z + c2) * z + c1) * z + c0;
      const df = (3.0 * z + 2.0 * c2) * z + c1;
      if (Math.abs(df) < 1e-12) break;
      z = clamp(z - f / df, B + 1e-4, 4.0);
    }
    const rho = (pIn * mw) / Math.max(1e-9, z * R_UNIV * tIn);

    setIo(slotPtr, 12, z);
    setIo(slotPtr, 13, rho);
    setIo(slotPtr, 14, tIn);
    return;
  }

  // ── 18. Gas Hydrate Equilibrium Curve + Hammerschmidt Inhibition ───────────
  if (archetypeId == ARCH_PVT_HYDRATE_CURVE) {
    const aCoeff = getCon(slotPtr, conCount, 0, -10.5);
    const bCoeff = getCon(slotPtr, conCount, 1, 0.095);
    const tRef = getCon(slotPtr, conCount, 2, 273.15);
    const wPct = clamp(getCon(slotPtr, conCount, 3, 0.0), 0.0, 80.0);
    const kH = getCon(slotPtr, conCount, 4, 2200.0);
    const mInh = Math.max(1.0, getCon(slotPtr, conCount, 5, 62.07));

    const dTInh = wPct > 0.0 ? (kH * wPct) / (mInh * (100.0 - wPct)) : 0.0;
    const tEff = tIn + dTInh;
    const pHydPa = Math.exp(aCoeff + bCoeff * tEff) * 1.0e5;
    // Equilibrium hydrate formation temperature at operating pressure pIn
    const tHydEq = (Math.log(Math.max(1e-6, pIn / 1.0e5)) - aCoeff) / Math.max(1e-6, bCoeff) - dTInh;
    const subcooling = tHydEq - tIn; // positive => inside hydrate formation region

    setIo(slotPtr, 12, pHydPa);
    setIo(slotPtr, 14, subcooling);
    return;
  }

  // ── 19. Insulated Pipe Radial Heat Transfer: Q = U * A * (T - T_amb) ──────
  if (archetypeId == ARCH_WALL_INSULATED) {
    const dIn = Math.max(1e-3, getCon(slotPtr, conCount, 0, 0.25));
    const tIns = Math.max(1e-4, getCon(slotPtr, conCount, 1, 0.05));
    const kIns = Math.max(1e-3, getCon(slotPtr, conCount, 2, 0.16));
    const hAmb = Math.max(1e-2, getCon(slotPtr, conCount, 3, 500.0));
    const len = Math.max(1e-3, getCon(slotPtr, conCount, 4, 1000.0));
    const cp = Math.max(100.0, getCon(slotPtr, conCount, 5, 2200.0));

    const rIn = 0.5 * dIn;
    const rOut = rIn + tIns;
    // Overall U referenced to inner pipe surface area A = pi * dIn * len
    const rCond = (rIn * Math.log(rOut / rIn)) / kIns;
    const rConv = rIn / (rOut * hAmb);
    const uInner = 1.0 / (rCond + rConv);
    const area = Math.PI * dIn * len;
    const qHeat = uInner * area * (tIn - tAmb);
    const tOut = mIn > 1e-6 ? tIn - qHeat / (mIn * cp) : tAmb;

    setIo(slotPtr, 11, qHeat);
    setIo(slotPtr, 13, uInner);
    setIo(slotPtr, 14, tOut);
    return;
  }

  // ── 20. Buried Pipeline Thermal Wall (Shape Factor) ────────────────────────
  if (archetypeId == ARCH_WALL_BURIED) {
    const dOut = Math.max(1e-3, getCon(slotPtr, conCount, 0, 0.3));
    const depth = Math.max(dOut, getCon(slotPtr, conCount, 1, 1.5));
    const kSoil = Math.max(1e-3, getCon(slotPtr, conCount, 2, 1.2));
    const len = Math.max(1e-3, getCon(slotPtr, conCount, 3, 1000.0));
    const cp = Math.max(100.0, getCon(slotPtr, conCount, 4, 2200.0));

    const ratio = (2.0 * depth) / dOut;
    const acoshVal = Math.log(ratio + Math.sqrt(Math.max(0.0, ratio * ratio - 1.0)));
    const shapeFactor = (2.0 * Math.PI * len) / Math.max(1e-6, acoshVal);
    const qHeat = kSoil * shapeFactor * (tIn - tAmb);
    const tOut = mIn > 1e-6 ? tIn - qHeat / (mIn * cp) : tAmb;

    setIo(slotPtr, 11, qHeat);
    setIo(slotPtr, 13, (kSoil * shapeFactor) / (Math.PI * dOut * len));
    setIo(slotPtr, 14, tOut);
  }
}
