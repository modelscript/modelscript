// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript thermal-hydraulics & reactor kinetics runtime for
 * `@modelscript/relap5-std-lib`.
 *
 * Uses a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — component parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector (up to 32 states)
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — thermal-hydraulics & kinetics I/O bus:
 *       IO[0]  = pressure (Pa)          IO[1]  = pressure2 (Pa)
 *       IO[2]  = temperature (K)        IO[3]  = massFlow (kg/s)
 *       IO[4]  = voidFraction (0..1)    IO[5]  = reactivity (dk/k)
 *       IO[6]  = power (W)              IO[7]  = htc (W/(m^2*K))
 *       IO[8]  = qFlux (W/m^2)          IO[9]  = tSat (K)
 *       IO[10] = reynolds (-)           IO[11] = prandtl (-)
 *       IO[12] = kFluid (W/(m*K))       IO[13] = dHyd (m)
 *       IO[14] = decayFraction (-)      IO[15] = aux (stemPos / head / etc.)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `Relap5ArchetypeId` in relap5-std-schemas.ts)
const ARCH_HYDRO_VOLUME: i32 = 1;
const ARCH_HYDRO_TMDPVOL: i32 = 2;
const ARCH_HYDRO_ACCUM: i32 = 3;
const ARCH_HYDRO_PRIZER: i32 = 4;
const ARCH_HYDRO_SEPARATOR: i32 = 5;

const ARCH_JUNCTION_ORIFICE: i32 = 10;
const ARCH_VALVE_TRIP: i32 = 11;
const ARCH_VALVE_MOTOR: i32 = 12;
const ARCH_VALVE_CHECK: i32 = 13;
const ARCH_VALVE_RELIEF: i32 = 14;

const ARCH_PUMP_CENTRIFUGAL: i32 = 20;
const ARCH_TURBINE_STAGE: i32 = 21;

const ARCH_HTSTR_FUEL_ROD: i32 = 30;
const ARCH_HTSTR_SG_TUBE: i32 = 31;

const ARCH_CORR_DITTUS_BOELTER: i32 = 40;
const ARCH_CORR_CHEN_BOILING: i32 = 41;
const ARCH_CORR_ZUBER_CHF: i32 = 42;
const ARCH_CORR_GROENEVELD_CHF: i32 = 43;

const ARCH_POINT_KINETICS_6G: i32 = 50;
const ARCH_DECAY_HEAT_ANS79: i32 = 51;
const ARCH_STEAM_IAPWS_IF97: i32 = 52;

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
function getDState(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_DSTATE + (<usize>idx << 3));
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
 * Exact IAPWS-IF97 Region 4 backward saturation temperature T_sat(P) in Kelvin.
 * Valid for 611.213 Pa <= P <= 22.064 MPa (Wagner et al., 2000, Eq. 31).
 */
function iapws97TsatFromPressure(pressurePa: f64): f64 {
  const pClamped = clamp(pressurePa, 611.213, 22.064e6);
  const pMpa = pClamped * 1e-6;
  const beta = Math.pow(pMpa, 0.25);
  const beta2 = beta * beta;

  const n1: f64 = 0.11670521452767e4;
  const n2: f64 = -0.72421316703206e6;
  const n3: f64 = -0.17073846940092e2;
  const n4: f64 = 0.12020824702470e5;
  const n5: f64 = -0.32325550322333e7;
  const n6: f64 = 0.14915108613530e2;
  const n7: f64 = -0.48232657361591e4;
  const n8: f64 = 0.40511340542057e6;
  const n9: f64 = -0.23855557567849;
  const n10: f64 = 0.65017534844798e3;

  const E = beta2 + n3 * beta + n6;
  const F = n1 * beta2 + n4 * beta + n7;
  const G = n2 * beta2 + n5 * beta + n8;

  const D = (2.0 * G) / (-F - Math.sqrt(F * F - 4.0 * E * G));
  const disc = (n10 + D) * (n10 + D) - 4.0 * (n9 + n10 * D);
  return 0.5 * (n10 + D - Math.sqrt(disc > 0.0 ? disc : 0.0));
}

/**
 * Homogeneous equilibrium / isentropic choked orifice flow (kg/s).
 */
function evalChokedOrificeFlow(
  p1: f64,
  p2: f64,
  area: f64,
  cd: f64,
  kLoss: f64,
  gamma: f64,
  rho: f64,
  stemFraction: f64,
): f64 {
  if (stemFraction <= 1e-9 || area <= 0.0) return 0.0;
  const aEff = area * clamp(stemFraction, 0.0, 1.0);
  const dp = p1 - p2;
  const sign: f64 = dp >= 0.0 ? 1.0 : -1.0;
  const pHi = dp >= 0.0 ? p1 : p2;
  const pLo = dp >= 0.0 ? p2 : p1;
  if (pHi <= 1.0) return 0.0;

  const g = Math.max(1.05, gamma);
  const critRatio = Math.pow(2.0 / (g + 1.0), g / (g - 1.0));
  const pRatio = pLo / pHi;

  if (pRatio <= critRatio) {
    // Choked (critical) flow limit
    const critFactor = Math.pow(2.0 / (g + 1.0), (g + 1.0) / (g - 1.0));
    const mChoked = cd * aEff * Math.sqrt(Math.max(0.0, g * rho * pHi * critFactor));
    return sign * mChoked;
  }

  // Unchoked incompressible / orifice flow with form loss K
  const kEff = Math.max(1.0, 1.0 + Math.max(0.0, kLoss));
  const mUnchoked = (cd * aEff / Math.sqrt(kEff)) * Math.sqrt(Math.max(0.0, 2.0 * rho * Math.abs(dp)));
  return sign * mUnchoked;
}

/**
 * ANS-5.1-1979 9-group U-235 thermal fission decay heat fraction P_d(t) / P_0
 * for shutdown time `tSec >= 0` after irradiation duration `tOpSec > 0`.
 */
function evalAns79DecayFraction(tSec: f64, tOpSec: f64): f64 {
  const t = tSec > 0.0 ? tSec : 0.0;
  const tOp = tOpSec > 1.0 ? tOpSec : 3.1536e7;

  // Exponential terms calibrated to ANSI/ANS-5.1-1979 U-235 thermal fission curve:
  // t=1s ~ 6.1%, t=10s ~ 4.7%, t=100s ~ 3.1%, t=3600s ~ 1.3%, t=86400s ~ 0.5%
  let sum: f64 = 0.0;
  sum += 0.0155 * Math.exp(-1.5 * t) * (1.0 - Math.exp(-1.5 * tOp));
  sum += 0.0145 * Math.exp(-0.22 * t) * (1.0 - Math.exp(-0.22 * tOp));
  sum += 0.0135 * Math.exp(-0.040 * t) * (1.0 - Math.exp(-0.040 * tOp));
  sum += 0.0115 * Math.exp(-0.0075 * t) * (1.0 - Math.exp(-0.0075 * tOp));
  sum += 0.0095 * Math.exp(-0.0013 * t) * (1.0 - Math.exp(-0.0013 * tOp));
  sum += 0.0068 * Math.exp(-2.1e-4 * t) * (1.0 - Math.exp(-2.1e-4 * tOp));
  sum += 0.0048 * Math.exp(-3.2e-5 * t) * (1.0 - Math.exp(-3.2e-5 * tOp));
  sum += 0.0030 * Math.exp(-4.2e-6 * t) * (1.0 - Math.exp(-4.2e-6 * tOp));
  sum += 0.0014 * Math.exp(-3.5e-7 * t) * (1.0 - Math.exp(-3.5e-7 * tOp));
  return sum;
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function r5GetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Returns the number of active dynamic states for a given RELAP5 archetype.
 */
function activeStateCount(archetypeId: i32): i32 {
  if (archetypeId == ARCH_POINT_KINETICS_6G) return 7; // n + C1..C6
  if (
    archetypeId == ARCH_HYDRO_VOLUME ||
    archetypeId == ARCH_HYDRO_ACCUM ||
    archetypeId == ARCH_HYDRO_PRIZER
  ) {
    return 2; // P, T
  }
  if (archetypeId == ARCH_HTSTR_FUEL_ROD || archetypeId == ARCH_HTSTR_SG_TUBE) {
    return 1; // T_wall
  }
  if (archetypeId == ARCH_VALVE_MOTOR) {
    return 1; // stemPosition
  }
  return 0;
}

/**
 * Initializes model states for steady-state equilibrium (`dstate/dt = 0`).
 * Returns the number of active dynamic states for the archetype.
 */
export function r5ModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  for (let i = 0; i < 8; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }

  if (archetypeId == ARCH_POINT_KINETICS_6G) {
    // State 0: P(t) (W), States 1..6: scaled precursor concentrations C_i(t)
    const lambdaGen = Math.max(1e-7, getCon(slotPtr, conCount, 0, 2.0e-5));
    const p0Con = getCon(slotPtr, conCount, 1, 3.0e9);
    const p0Io = getIo(slotPtr, 6);
    const p0 = p0Io > 0.0 ? p0Io : p0Con;

    setState(slotPtr, 0, p0);
    for (let g = 0; g < 6; g++) {
      const betaG = getCon(slotPtr, conCount, 2 + g, 0.001);
      const lamG = Math.max(1e-6, getCon(slotPtr, conCount, 8 + g, 0.1));
      // Steady-state equilibrium: dC_i/dt = (beta_i / Lambda) * P - lambda_i * C_i = 0
      setState(slotPtr, 1 + g, (betaG / (lambdaGen * lamG)) * p0);
    }
    setIo(slotPtr, 6, p0);
    return 7;
  }

  if (
    archetypeId == ARCH_HYDRO_VOLUME ||
    archetypeId == ARCH_HYDRO_ACCUM ||
    archetypeId == ARCH_HYDRO_PRIZER
  ) {
    const p0 = getIo(slotPtr, 0) > 1.0 ? getIo(slotPtr, 0) : getCon(slotPtr, conCount, 6, 15.5e6);
    const t0 = getIo(slotPtr, 2) > 1.0 ? getIo(slotPtr, 2) : getCon(slotPtr, conCount, 7, 573.15);
    setState(slotPtr, 0, p0);
    setState(slotPtr, 1, t0);
    setIo(slotPtr, 0, p0);
    setIo(slotPtr, 2, t0);
    setIo(slotPtr, 9, iapws97TsatFromPressure(p0));
    return 2;
  }

  if (archetypeId == ARCH_HTSTR_FUEL_ROD || archetypeId == ARCH_HTSTR_SG_TUBE) {
    const t0 = getIo(slotPtr, 2) > 1.0 ? getIo(slotPtr, 2) : 600.0;
    setState(slotPtr, 0, t0);
    return 1;
  }

  if (archetypeId == ARCH_VALVE_MOTOR) {
    const stem0 = clamp(getCon(slotPtr, conCount, 6, 1.0), 0.0, 1.0);
    setState(slotPtr, 0, stem0);
    setIo(slotPtr, 15, stem0);
    return 1;
  }

  // Algebraic models: evaluate immediately at t = 0
  r5ModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
  return 0;
}

/**
 * Evaluates cleanroom continuous-time state derivatives `dstate/dt` and algebraic outputs.
 */
export function r5ModelEvalDerivatives(
  archetypeId: i32,
  t: f64,
  _dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  if (archetypeId == ARCH_POINT_KINETICS_6G) {
    const lambdaGen = Math.max(1e-7, getCon(slotPtr, conCount, 0, 2.0e-5));
    const rho = getIo(slotPtr, 5);
    const n = getState(slotPtr, 0);

    let betaTotal: f64 = 0.0;
    let delayedSource: f64 = 0.0;
    for (let g = 0; g < 6; g++) {
      const betaG = getCon(slotPtr, conCount, 2 + g, 0.001);
      const lamG = Math.max(1e-6, getCon(slotPtr, conCount, 8 + g, 0.1));
      const cG = getState(slotPtr, 1 + g);
      betaTotal += betaG;
      delayedSource += lamG * cG;
      setDState(slotPtr, 1 + g, (betaG / lambdaGen) * n - lamG * cG);
    }

    const dnDt = ((rho - betaTotal) / lambdaGen) * n + delayedSource;
    setDState(slotPtr, 0, dnDt);
    setIo(slotPtr, 6, n);
    return;
  }

  if (archetypeId == ARCH_DECAY_HEAT_ANS79) {
    const p0 = getIo(slotPtr, 6) > 0.0 ? getIo(slotPtr, 6) : getCon(slotPtr, conCount, 0, 3.0e9);
    const tOp = getCon(slotPtr, conCount, 1, 3.1536e7);
    const mult = Math.max(0.0, getCon(slotPtr, conCount, 2, 1.0));
    const frac = mult * evalAns79DecayFraction(t, tOp);
    setIo(slotPtr, 14, frac);
    setIo(slotPtr, 6, p0 * frac);
    return;
  }

  if (archetypeId == ARCH_STEAM_IAPWS_IF97) {
    const p = getIo(slotPtr, 0) > 1.0 ? getIo(slotPtr, 0) : 101325.0;
    const tSat = iapws97TsatFromPressure(p);
    setIo(slotPtr, 9, tSat);
    return;
  }

  if (archetypeId == ARCH_CORR_DITTUS_BOELTER) {
    const c = getCon(slotPtr, conCount, 0, 0.023);
    const reExp = getCon(slotPtr, conCount, 1, 0.8);
    const prExp = getCon(slotPtr, conCount, 2, 0.4);
    const re = Math.max(1.0, getIo(slotPtr, 10));
    const pr = Math.max(1e-4, getIo(slotPtr, 11));
    const kFluid = Math.max(1e-4, getIo(slotPtr, 12));
    const dHyd = Math.max(1e-5, getIo(slotPtr, 13));

    const nu = c * Math.pow(re, reExp) * Math.pow(pr, prExp);
    const htc = (nu * kFluid) / dHyd;
    setIo(slotPtr, 7, htc);
    setIo(slotPtr, 15, nu);
    return;
  }

  if (archetypeId == ARCH_CORR_CHEN_BOILING) {
    const fFactor = Math.max(1.0, getCon(slotPtr, conCount, 0, 2.35));
    const sFactor = clamp(getCon(slotPtr, conCount, 1, 0.5), 0.0, 1.0);
    const hMic = Math.max(0.0, getCon(slotPtr, conCount, 2, 1.5e4));
    const dT = Math.max(0.0, getCon(slotPtr, conCount, 3, 10.0));

    const re = Math.max(1.0, getIo(slotPtr, 10));
    const pr = Math.max(1e-4, getIo(slotPtr, 11));
    const kFluid = Math.max(1e-4, getIo(slotPtr, 12));
    const dHyd = Math.max(1e-5, getIo(slotPtr, 13));

    const hMac = (0.023 * Math.pow(re, 0.8) * Math.pow(pr, 0.4) * kFluid) / dHyd;
    const hTotal = fFactor * hMac + sFactor * hMic;
    setIo(slotPtr, 7, hTotal);
    setIo(slotPtr, 8, hTotal * dT);
    return;
  }

  if (archetypeId == ARCH_CORR_ZUBER_CHF) {
    const cZ = getCon(slotPtr, conCount, 0, 0.131);
    const hfg = Math.max(0.0, getCon(slotPtr, conCount, 1, 2.257e6));
    const rhoL = Math.max(1.0, getCon(slotPtr, conCount, 2, 958.4));
    const rhoV = Math.max(1e-4, getCon(slotPtr, conCount, 3, 0.598));
    const sigma = Math.max(1e-5, getCon(slotPtr, conCount, 4, 0.0589));
    const g = Math.max(0.1, getCon(slotPtr, conCount, 5, 9.80665));

    const deltaRho = Math.max(0.0, rhoL - rhoV);
    const qChf = cZ * hfg * Math.sqrt(rhoV) * Math.pow(sigma * g * deltaRho, 0.25);
    setIo(slotPtr, 8, qChf);
    return;
  }

  if (archetypeId == ARCH_CORR_GROENEVELD_CHF) {
    const qRef = Math.max(0.0, getCon(slotPtr, conCount, 0, 2.5e6));
    const dRef = Math.max(1e-4, getCon(slotPtr, conCount, 1, 0.008));
    const dExp = getCon(slotPtr, conCount, 2, 0.5);
    const xSlope = getCon(slotPtr, conCount, 3, 1.8);
    const dHyd = getIo(slotPtr, 13) > 1e-5 ? getIo(slotPtr, 13) : dRef;
    const quality = clamp(getIo(slotPtr, 4), -0.3, 0.95);

    const diamFactor = Math.pow(dRef / dHyd, dExp);
    const qualFactor = Math.max(0.05, 1.0 - xSlope * Math.max(0.0, quality));
    setIo(slotPtr, 8, qRef * diamFactor * qualFactor);
    return;
  }

  if (
    archetypeId == ARCH_JUNCTION_ORIFICE ||
    archetypeId == ARCH_VALVE_TRIP ||
    archetypeId == ARCH_VALVE_MOTOR ||
    archetypeId == ARCH_VALVE_CHECK ||
    archetypeId == ARCH_VALVE_RELIEF
  ) {
    const p1 = getIo(slotPtr, 0);
    const p2 = getIo(slotPtr, 1);
    const area = getCon(slotPtr, conCount, 0, 0.1);
    const kFwd = getCon(slotPtr, conCount, 1, 0.5);
    const kRev = getCon(slotPtr, conCount, 2, 1.0);
    const cd = getCon(slotPtr, conCount, 3, 0.85);
    const gamma = getCon(slotPtr, conCount, 4, 1.3);
    const rho = Math.max(1.0, getCon(slotPtr, conCount, 5, 720.0));
    const kLoss = p1 >= p2 ? kFwd : kRev;

    let stem: f64 = 1.0;
    if (archetypeId == ARCH_VALVE_TRIP) {
      stem = clamp(getCon(slotPtr, conCount, 6, 1.0), 0.0, 1.0);
    } else if (archetypeId == ARCH_VALVE_MOTOR) {
      const targetStem = clamp(getCon(slotPtr, conCount, 6, 1.0), 0.0, 1.0);
      const rate = Math.max(0.0, getCon(slotPtr, conCount, 7, 0.1));
      stem = clamp(getState(slotPtr, 0), 0.0, 1.0);
      const diff = targetStem - stem;
      if (Math.abs(diff) > 1e-6) {
        setDState(slotPtr, 0, diff > 0.0 ? rate : -rate);
      } else {
        setDState(slotPtr, 0, 0.0);
      }
    } else if (archetypeId == ARCH_VALVE_CHECK) {
      const crackDp = getCon(slotPtr, conCount, 6, 5000.0);
      stem = p1 - p2 > crackDp ? 1.0 : 0.0;
    } else if (archetypeId == ARCH_VALVE_RELIEF) {
      const pSet = getCon(slotPtr, conCount, 6, 16.2e6);
      const pFull = Math.max(pSet + 1e3, getCon(slotPtr, conCount, 7, 16.7e6));
      stem = clamp((p1 - pSet) / (pFull - pSet), 0.0, 1.0);
    }

    const mDot = evalChokedOrificeFlow(p1, p2, area, cd, kLoss, gamma, rho, stem);
    setIo(slotPtr, 3, mDot);
    setIo(slotPtr, 15, stem);
    return;
  }

  if (archetypeId == ARCH_PUMP_CENTRIFUGAL) {
    const hRated = getCon(slotPtr, conCount, 0, 85.0);
    const qRated = Math.max(1e-3, getCon(slotPtr, conCount, 1, 5.5));
    const rho = Math.max(1.0, getCon(slotPtr, conCount, 4, 730.0));
    const mDot = getIo(slotPtr, 3);
    const phi = clamp(mDot / (rho * qRated), 0.0, 2.0);
    // Parabolic homologous head curve: H / H_R = 1.3 - 0.1 * phi - 0.2 * phi^2
    const head = Math.max(0.0, hRated * (1.3 - 0.1 * phi - 0.2 * phi * phi));
    const dpPump = rho * 9.80665 * head;
    setIo(slotPtr, 1, getIo(slotPtr, 0) + dpPump);
    setIo(slotPtr, 15, head);
    return;
  }

  if (archetypeId == ARCH_TURBINE_STAGE) {
    const eta = clamp(getCon(slotPtr, conCount, 0, 0.86), 0.0, 1.0);
    const dhS = Math.max(0.0, getCon(slotPtr, conCount, 2, 3.2e5));
    const mDot = Math.max(0.0, getIo(slotPtr, 3));
    setIo(slotPtr, 6, eta * mDot * dhS);
    return;
  }

  if (archetypeId == ARCH_HTSTR_FUEL_ROD || archetypeId == ARCH_HTSTR_SG_TUBE) {
    const cTh = Math.max(1.0, getCon(slotPtr, conCount, 3, 2.5e3));
    const area = Math.max(1e-4, getCon(slotPtr, conCount, 5, 0.109));
    const tFluid = getIo(slotPtr, 2) > 1.0 ? getIo(slotPtr, 2) : 573.15;
    const qGen = getIo(slotPtr, 6);
    const htc = getIo(slotPtr, 7) > 0.0 ? getIo(slotPtr, 7) : 2.5e4;
    const tWall = getState(slotPtr, 0);

    const qConv = htc * area * (tWall - tFluid);
    setDState(slotPtr, 0, (qGen - qConv) / cTh);
    setIo(slotPtr, 8, qConv / area);
    setIo(slotPtr, 15, tWall);
    return;
  }

  if (
    archetypeId == ARCH_HYDRO_VOLUME ||
    archetypeId == ARCH_HYDRO_ACCUM ||
    archetypeId == ARCH_HYDRO_PRIZER
  ) {
    const vol = Math.max(1e-3, getCon(slotPtr, conCount, 2, 1.0));
    const mDotNet = getIo(slotPtr, 3);
    const qNet = getIo(slotPtr, 6);
    const p = getState(slotPtr, 0);
    const temp = getState(slotPtr, 1);

    // Lumped compressible volume pressure & temperature response
    const bulkModulus: f64 = 1.0e8;
    const rhoCp: f64 = 3.5e6;
    setDState(slotPtr, 0, (bulkModulus / (720.0 * vol)) * mDotNet);
    setDState(slotPtr, 1, qNet / (rhoCp * vol));
    setIo(slotPtr, 0, p);
    setIo(slotPtr, 2, temp);
    setIo(slotPtr, 9, iapws97TsatFromPressure(p));
    return;
  }

  if (archetypeId == ARCH_HYDRO_TMDPVOL) {
    const pBnd = getCon(slotPtr, conCount, 0, 15.5e6);
    const tBnd = getCon(slotPtr, conCount, 1, 565.0);
    const xBnd = getCon(slotPtr, conCount, 2, 0.0);
    setIo(slotPtr, 0, pBnd);
    setIo(slotPtr, 2, tBnd);
    setIo(slotPtr, 4, xBnd);
    setIo(slotPtr, 9, iapws97TsatFromPressure(pBnd));
    return;
  }

  if (archetypeId == ARCH_HYDRO_SEPARATOR) {
    const carryOver = clamp(getCon(slotPtr, conCount, 1, 0.0025), 0.0, 0.5);
    const alphaIn = clamp(getIo(slotPtr, 4), 0.0, 1.0);
    setIo(slotPtr, 15, alphaIn > 0.0 ? 1.0 - carryOver : 0.0);
    return;
  }
}

/**
 * Advances a RELAP5 component slot by `dt` seconds using 2nd-order Heun (RK2) integration
 * with automatic sub-stepping for stiff 6-group point reactor kinetics.
 */
export function r5ModelStep(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const nStates = activeStateCount(archetypeId);
  if (nStates == 0 || dt <= 0.0) {
    r5ModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
    return;
  }

  // Determine sub-steps for stability on stiff prompt neutron dynamics
  let nSub: i32 = 1;
  if (archetypeId == ARCH_POINT_KINETICS_6G) {
    const lambdaGen = Math.max(1e-7, getCon(slotPtr, conCount, 0, 2.0e-5));
    const rho = getIo(slotPtr, 5);
    const maxRate = (Math.abs(rho) + 0.01) / lambdaGen;
    const req = <i32>Math.ceil((dt * maxRate) / 0.4);
    if (req > 1) nSub = req < 4000 ? req : 4000;
  }

  const h = dt / (<f64>nSub);
  let tCur = t;

  for (let sub = 0; sub < nSub; sub++) {
    // Save y0 (up to 7 states)
    const y0_0 = getState(slotPtr, 0);
    const y0_1 = nStates > 1 ? getState(slotPtr, 1) : 0.0;
    const y0_2 = nStates > 2 ? getState(slotPtr, 2) : 0.0;
    const y0_3 = nStates > 3 ? getState(slotPtr, 3) : 0.0;
    const y0_4 = nStates > 4 ? getState(slotPtr, 4) : 0.0;
    const y0_5 = nStates > 5 ? getState(slotPtr, 5) : 0.0;
    const y0_6 = nStates > 6 ? getState(slotPtr, 6) : 0.0;

    r5ModelEvalDerivatives(archetypeId, tCur, h, slotPtr, conCount);
    const k1_0 = getDState(slotPtr, 0);
    const k1_1 = nStates > 1 ? getDState(slotPtr, 1) : 0.0;
    const k1_2 = nStates > 2 ? getDState(slotPtr, 2) : 0.0;
    const k1_3 = nStates > 3 ? getDState(slotPtr, 3) : 0.0;
    const k1_4 = nStates > 4 ? getDState(slotPtr, 4) : 0.0;
    const k1_5 = nStates > 5 ? getDState(slotPtr, 5) : 0.0;
    const k1_6 = nStates > 6 ? getDState(slotPtr, 6) : 0.0;

    // Predictor step
    setState(slotPtr, 0, y0_0 + h * k1_0);
    if (nStates > 1) setState(slotPtr, 1, y0_1 + h * k1_1);
    if (nStates > 2) setState(slotPtr, 2, y0_2 + h * k1_2);
    if (nStates > 3) setState(slotPtr, 3, y0_3 + h * k1_3);
    if (nStates > 4) setState(slotPtr, 4, y0_4 + h * k1_4);
    if (nStates > 5) setState(slotPtr, 5, y0_5 + h * k1_5);
    if (nStates > 6) setState(slotPtr, 6, y0_6 + h * k1_6);

    r5ModelEvalDerivatives(archetypeId, tCur + h, h, slotPtr, conCount);
    const k2_0 = getDState(slotPtr, 0);
    const k2_1 = nStates > 1 ? getDState(slotPtr, 1) : 0.0;
    const k2_2 = nStates > 2 ? getDState(slotPtr, 2) : 0.0;
    const k2_3 = nStates > 3 ? getDState(slotPtr, 3) : 0.0;
    const k2_4 = nStates > 4 ? getDState(slotPtr, 4) : 0.0;
    const k2_5 = nStates > 5 ? getDState(slotPtr, 5) : 0.0;
    const k2_6 = nStates > 6 ? getDState(slotPtr, 6) : 0.0;

    // Heun corrector step
    setState(slotPtr, 0, y0_0 + 0.5 * h * (k1_0 + k2_0));
    if (nStates > 1) setState(slotPtr, 1, y0_1 + 0.5 * h * (k1_1 + k2_1));
    if (nStates > 2) setState(slotPtr, 2, y0_2 + 0.5 * h * (k1_2 + k2_2));
    if (nStates > 3) setState(slotPtr, 3, y0_3 + 0.5 * h * (k1_3 + k2_3));
    if (nStates > 4) setState(slotPtr, 4, y0_4 + 0.5 * h * (k1_4 + k2_4));
    if (nStates > 5) setState(slotPtr, 5, y0_5 + 0.5 * h * (k1_5 + k2_5));
    if (nStates > 6) setState(slotPtr, 6, y0_6 + 0.5 * h * (k1_6 + k2_6));

    tCur += h;
  }

  // Re-sync outputs at end of step
  r5ModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
}

/**
 * Computes max `|dstate/dt|` immediately after initialization to verify flat-start equilibrium.
 */
export function r5ModelCheckFlatStart(archetypeId: i32, slotPtr: usize, conCount: i32): f64 {
  r5ModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
  const nStates = activeStateCount(archetypeId);
  let maxRes: f64 = 0.0;
  for (let i = 0; i < nStates; i++) {
    const d = Math.abs(getDState(slotPtr, i));
    if (d > maxRes) maxRes = d;
  }
  return maxRes;
}

/**
 * Batched zero-copy initialization across `count` model descriptors:
 * each descriptor is 16 bytes `{ archetypeId: i32, slotPtr: u32, reserved: i32, conCount: i32 }`.
 */
export function r5BatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    r5ModelInit(archetypeId, slotPtr, conCount);
  }
}

/**
 * Batched zero-copy Heun time-step across `count` model descriptors.
 */
export function r5BatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    r5ModelStep(archetypeId, t, dt, slotPtr, conCount);
  }
}
