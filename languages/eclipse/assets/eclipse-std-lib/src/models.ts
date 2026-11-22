// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript reservoir physics runtime for `@modelscript/eclipse-std-lib`.
 *
 * Implements public-literature formulations for SLB ECLIPSE / OPM Flow reservoir models
 * (Peaceman 1978/1983, Corey 1954, Stone 1970/1973, Leverett 1941, Fetkovich 1971,
 * Carter-Tracy 1960, Standing 1947, Peng-Robinson 1976, Soave-Redlich-Kwong 1972)
 * using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — ECLIPSE keyword parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — internal state (e.g., We, pAq, tCum)
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state rates / increments
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — I/O bus:
 *       Inputs:
 *         IO[0] = pressure (psia), IO[1] = temperature (degF), IO[2] = sw (0..1),
 *         IO[3] = sg (0..1), IO[4] = bhp (psia), IO[5] = dt (days),
 *         IO[6] = mobility (1/(cP*rb/stb)), IO[7] = rateIn (stb/d)
 *       Outputs:
 *         IO[8] = out0, IO[9] = out1, IO[10] = out2, IO[11] = out3
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `EclipseArchetypeId` in eclipse-std-schemas.ts)
const ARCH_PVTO_LIVE_OIL: i32 = 10;
const ARCH_PVDO_DEAD_OIL: i32 = 11;
const ARCH_PVTG_WET_GAS: i32 = 12;
const ARCH_PVDG_DRY_GAS: i32 = 13;
const ARCH_PVTW_WATER: i32 = 14;
const ARCH_EOS_PR_COMP: i32 = 15;
const ARCH_EOS_SRK_COMP: i32 = 16;
const ARCH_ROCK_COMPRESS: i32 = 17;

const ARCH_SWOF_COREY: i32 = 20;
const ARCH_SGOF_COREY: i32 = 21;
const ARCH_STONE1_3PHASE: i32 = 22;
const ARCH_STONE2_3PHASE: i32 = 23;
const ARCH_PC_LEVERETT_J: i32 = 24;

const ARCH_WELSPECS_PROD: i32 = 30;
const ARCH_WELSPECS_INJ: i32 = 31;
const ARCH_COMPDAT_PEACEMAN: i32 = 32;
const ARCH_VFPPROD_LIFT: i32 = 33;
const ARCH_MSWELL_SEGMENT: i32 = 34;
const ARCH_AQUFETP_FETKOVICH: i32 = 35;
const ARCH_AQUTAB_CARTER_TRACY: i32 = 36;

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
 * Piecewise-linear interpolation helper over a 4-column table stored in `CON` starting at `baseIdx`.
 * Each row `i` occupies `[baseIdx + 4*i + 0 .. +3]` = `[x_i, y1_i, y2_i, y3_i]` with ascending `x_i`.
 * Writes interpolated `(y1, y2, y3)` to `IO[8..10]` and returns the clamped interpolation coordinate.
 */
function interpTable4Col(
  slotPtr: usize,
  conCount: i32,
  baseIdx: i32,
  nRows: i32,
  x: f64,
): void {
  const xFirst = getCon(slotPtr, conCount, baseIdx, 0.0);
  const lastBase = baseIdx + (nRows - 1) * 4;
  const xLast = getCon(slotPtr, conCount, lastBase, xFirst);

  if (x <= xFirst) {
    setIo(slotPtr, 8, getCon(slotPtr, conCount, baseIdx + 1, 0.0));
    setIo(slotPtr, 9, getCon(slotPtr, conCount, baseIdx + 2, 0.0));
    setIo(slotPtr, 10, getCon(slotPtr, conCount, baseIdx + 3, 0.0));
    return;
  }
  if (x >= xLast) {
    setIo(slotPtr, 8, getCon(slotPtr, conCount, lastBase + 1, 0.0));
    setIo(slotPtr, 9, getCon(slotPtr, conCount, lastBase + 2, 0.0));
    setIo(slotPtr, 10, getCon(slotPtr, conCount, lastBase + 3, 0.0));
    return;
  }

  for (let i: i32 = 0; i < nRows - 1; i++) {
    const r0 = baseIdx + i * 4;
    const r1 = r0 + 4;
    const x0 = getCon(slotPtr, conCount, r0, 0.0);
    const x1 = getCon(slotPtr, conCount, r1, x0);
    if (x <= x1 || i == nRows - 2) {
      const span = x1 - x0;
      const w = span > 1e-12 ? clamp((x - x0) / span, 0.0, 1.0) : 0.0;
      const y1 = getCon(slotPtr, conCount, r0 + 1, 0.0) + w * (getCon(slotPtr, conCount, r1 + 1, 0.0) - getCon(slotPtr, conCount, r0 + 1, 0.0));
      const y2 = getCon(slotPtr, conCount, r0 + 2, 0.0) + w * (getCon(slotPtr, conCount, r1 + 2, 0.0) - getCon(slotPtr, conCount, r0 + 2, 0.0));
      const y3 = getCon(slotPtr, conCount, r0 + 3, 0.0) + w * (getCon(slotPtr, conCount, r1 + 3, 0.0) - getCon(slotPtr, conCount, r0 + 3, 0.0));
      setIo(slotPtr, 8, y1);
      setIo(slotPtr, 9, y2);
      setIo(slotPtr, 10, y3);
      return;
    }
  }
}

/**
 * Finds lower bracket index and weight `w in [0, 1]` on a 1D ascending axis in `CON[axisBase .. axisBase + len - 1]`.
 * Packs `idx` into the integer part and `w` via out-helper `findAxisWeight`.
 */
@inline
function findAxisIdx(slotPtr: usize, conCount: i32, axisBase: i32, len: i32, x: f64): i32 {
  if (len <= 1) return 0;
  const x0 = getCon(slotPtr, conCount, axisBase, 0.0);
  if (x <= x0) return 0;
  const xLast = getCon(slotPtr, conCount, axisBase + len - 1, x0);
  if (x >= xLast) return len - 2;
  for (let i: i32 = 0; i < len - 1; i++) {
    const hi = getCon(slotPtr, conCount, axisBase + i + 1, x0);
    if (x <= hi) return i;
  }
  return len - 2;
}

@inline
function axisWeight(slotPtr: usize, conCount: i32, axisBase: i32, idx: i32, x: f64): f64 {
  const lo = getCon(slotPtr, conCount, axisBase + idx, 0.0);
  const hi = getCon(slotPtr, conCount, axisBase + idx + 1, lo);
  const span = hi - lo;
  return span > 1e-12 ? clamp((x - lo) / span, 0.0, 1.0) : 0.0;
}

/**
 * Solves cubic equation Z^3 + c2*Z^2 + c1*Z + c0 = 0 via Newton-Raphson from vapor/liquid initial guesses
 * and returns the largest physically valid real root (Z > bFactor).
 */
function solveCubicZ(c2: f64, c1: f64, c0: f64, bFactor: f64): f64 {
  let z: f64 = 1.0;
  for (let iter: i32 = 0; iter < 30; iter++) {
    const f = ((z + c2) * z + c1) * z + c0;
    const df = (3.0 * z + 2.0 * c2) * z + c1;
    if (Math.abs(df) < 1e-12) break;
    const dz = f / df;
    z -= dz;
    if (Math.abs(dz) < 1e-10) break;
  }
  if (z <= bFactor || isNaN(z)) {
    z = Math.max(bFactor + 0.05, 0.85);
  }
  return z;
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function eclGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes model state vector for the specified ECLIPSE archetype.
 * Returns the number of active internal states.
 */
export function eclModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  if (archetypeId == ARCH_AQUFETP_FETKOVICH) {
    const pInit = getCon(slotPtr, conCount, 0, 4000.0);
    setState(slotPtr, 0, 0.0); // We (cumulative influx, stb)
    setState(slotPtr, 1, pInit); // pAq (current aquifer pressure, psia)
    setDState(slotPtr, 0, 0.0);
    return 2;
  }

  if (archetypeId == ARCH_AQUTAB_CARTER_TRACY) {
    const pInit = getCon(slotPtr, conCount, 0, 4000.0);
    setState(slotPtr, 0, 0.0); // We (cumulative influx, stb)
    setState(slotPtr, 1, 0.0); // tCum (elapsed time, days)
    setState(slotPtr, 2, pInit); // pInit cached
    setDState(slotPtr, 0, 0.0);
    return 3;
  }

  // Stateless algebraic PVT, SCAL, and well models
  setState(slotPtr, 0, 0.0);
  setDState(slotPtr, 0, 0.0);
  return 0;
}

/**
 * Evaluates the cleanroom ECLIPSE reservoir physics kernel for a single archetype slot.
 * Returns 0 on success, -1 if archetypeId is unknown.
 */
export function eclModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  const pressure = getIo(slotPtr, 0) > 1e-6 ? getIo(slotPtr, 0) : 3000.0;
  const tempF = getIo(slotPtr, 1) > -400.0 ? getIo(slotPtr, 1) : 180.0;
  const sw = clamp(getIo(slotPtr, 2), 0.0, 1.0);
  const sg = clamp(getIo(slotPtr, 3), 0.0, 1.0);
  const bhp = getIo(slotPtr, 4);
  const dt = getIo(slotPtr, 5);
  const mobility = getIo(slotPtr, 6) > 0.0 ? getIo(slotPtr, 6) : 1.0;
  const rateIn = getIo(slotPtr, 7);

  // =========================================================================
  // 1. PVT & EOS Models
  // =========================================================================
  if (archetypeId == ARCH_PVTO_LIVE_OIL) {
    // Tabulated PVTO piecewise-linear interpolation when CON[5] = nRows >= 2:
    //   CON[2] = pb (psia), CON[3] = co (1/psi), CON[5] = nRows (<= 32), CON[6] = cmu (1/psi)
    //   CON[7 + 4*i + 0..3] = [P_i, Rs_i, Bo_i, muO_i] (ascending P_i)
    const pb = Math.max(14.7, getCon(slotPtr, conCount, 2, 2500.0));
    const co = Math.max(0.0, getCon(slotPtr, conCount, 3, 1.5e-5));
    const nRowsRaw = <i32>Math.floor(getCon(slotPtr, conCount, 5, 0.0));
    if (nRowsRaw >= 2 && conCount >= 7 + nRowsRaw * 4) {
      const nRows = nRowsRaw > 32 ? 32 : nRowsRaw;
      const cmu = Math.max(0.0, getCon(slotPtr, conCount, 6, 0.0));
      const pSat = pressure < pb ? pressure : pb;
      interpTable4Col(slotPtr, conCount, 7, nRows, pSat);
      const rs = getIo(slotPtr, 8);
      const boSat = getIo(slotPtr, 9);
      const muSat = getIo(slotPtr, 10);
      const dpOver = pressure > pb ? pressure - pb : 0.0;
      const bo = dpOver > 0.0 ? boSat * Math.exp(-co * dpOver) : boSat;
      const muO = dpOver > 0.0 ? muSat * (1.0 + cmu * dpOver) : muSat;
      setIo(slotPtr, 8, rs);
      setIo(slotPtr, 9, bo);
      setIo(slotPtr, 10, muO);
      setIo(slotPtr, 11, pb);
      return 0;
    }

    // Standing (1947) live-oil Rs(P) and Bo(P) + Beggs-Robinson live-oil viscosity
    const api = getCon(slotPtr, conCount, 0, 35.0);
    const gammaG = Math.max(0.5, getCon(slotPtr, conCount, 1, 0.75));
    const muDead = Math.max(0.05, getCon(slotPtr, conCount, 4, 2.0));

    const pSat = pressure < pb ? pressure : pb;
    const xg = 0.0125 * api - 0.00091 * tempF;
    const base = (pSat / 18.2 + 1.4) * Math.pow(10.0, xg);
    const rs = gammaG * Math.pow(Math.max(0.0, base), 1.2048);

    const gammaO = 141.5 / (131.5 + api);
    const fStanding = rs * Math.sqrt(gammaG / gammaO) + 1.25 * tempF;
    const boSat = 0.9759 + 0.00012 * Math.pow(Math.max(0.0, fStanding), 1.2);
    const bo = pressure > pb ? boSat * Math.exp(-co * (pressure - pb)) : boSat;

    const aVisc = 10.715 * Math.pow(rs + 100.0, -0.515);
    const bVisc = 5.44 * Math.pow(rs + 150.0, -0.338);
    const muO = aVisc * Math.pow(muDead, bVisc);

    setIo(slotPtr, 8, rs);
    setIo(slotPtr, 9, bo);
    setIo(slotPtr, 10, muO);
    setIo(slotPtr, 11, pb);
    return 0;
  }

  if (archetypeId == ARCH_PVDO_DEAD_OIL) {
    const pRef = getCon(slotPtr, conCount, 0, 14.7);
    const boRef = getCon(slotPtr, conCount, 1, 1.05);
    const co = getCon(slotPtr, conCount, 2, 1.2e-5);
    const muRef = getCon(slotPtr, conCount, 3, 1.8);
    const cmu = getCon(slotPtr, conCount, 4, 1.0e-5);
    const dp = pressure - pRef;
    const bo = boRef * Math.exp(-co * dp);
    const muO = muRef * Math.exp(cmu * dp);
    setIo(slotPtr, 8, bo);
    setIo(slotPtr, 9, muO);
    setIo(slotPtr, 10, 0.0);
    setIo(slotPtr, 11, co);
    return 0;
  }

  if (archetypeId == ARCH_PVTG_WET_GAS) {
    const gammaG = Math.max(0.5, getCon(slotPtr, conCount, 0, 0.72));
    const pDew = Math.max(100.0, getCon(slotPtr, conCount, 1, 3200.0));
    const rvMax = Math.max(0.0, getCon(slotPtr, conCount, 2, 5.0e-5));
    const tempR = tempF + 459.67;
    const pPc = 756.8 - 131.0 * gammaG - 3.6 * gammaG * gammaG;
    const tPc = 169.2 + 349.5 * gammaG - 74.0 * gammaG * gammaG;
    const pPr = pressure / Math.max(1.0, pPc);
    const tPr = tempR / Math.max(1.0, tPc);
    // Papay Z-factor
    const z = clamp(1.0 - (3.52 * pPr) / Math.pow(10.0, 0.9813 * tPr) + (0.274 * pPr * pPr) / Math.pow(10.0, 0.8157 * tPr), 0.2, 2.5);
    // Bg in rb/scf
    const bg = 0.005035 * z * tempR / pressure;
    const rv = pressure < pDew ? rvMax * (pressure / pDew) : rvMax;
    const muG = 0.012 + 4.5e-6 * pressure;
    setIo(slotPtr, 8, bg);
    setIo(slotPtr, 9, muG);
    setIo(slotPtr, 10, rv);
    setIo(slotPtr, 11, z);
    return 0;
  }

  if (archetypeId == ARCH_PVDG_DRY_GAS) {
    const pPc = Math.max(100.0, getCon(slotPtr, conCount, 1, 670.0));
    const tPc = Math.max(100.0, getCon(slotPtr, conCount, 2, 375.0));
    const muRef = Math.max(0.005, getCon(slotPtr, conCount, 3, 0.018));
    const tempR = tempF + 459.67;
    const pPr = pressure / pPc;
    const tPr = tempR / tPc;
    const z = clamp(1.0 - (3.52 * pPr) / Math.pow(10.0, 0.9813 * tPr) + (0.274 * pPr * pPr) / Math.pow(10.0, 0.8157 * tPr), 0.2, 2.5);
    const bg = 0.005035 * z * tempR / pressure;
    const muG = muRef * (1.0 + 0.0002 * pressure);
    setIo(slotPtr, 8, bg);
    setIo(slotPtr, 9, muG);
    setIo(slotPtr, 10, z);
    setIo(slotPtr, 11, pPr);
    return 0;
  }

  if (archetypeId == ARCH_PVTW_WATER) {
    const pRef = getCon(slotPtr, conCount, 0, 3000.0);
    const bwRef = getCon(slotPtr, conCount, 1, 1.02);
    const cw = getCon(slotPtr, conCount, 2, 3.0e-6);
    const muwRef = getCon(slotPtr, conCount, 3, 0.5);
    const cmu = getCon(slotPtr, conCount, 4, 0.0);
    const x = cw * (pressure - pRef);
    const bw = bwRef / (1.0 + x + 0.5 * x * x);
    const y = cmu * (pressure - pRef);
    const muw = muwRef / (1.0 + y + 0.5 * y * y);
    setIo(slotPtr, 8, bw);
    setIo(slotPtr, 9, muw);
    setIo(slotPtr, 10, cw);
    setIo(slotPtr, 11, 0.0);
    return 0;
  }

  if (archetypeId == ARCH_EOS_PR_COMP) {
    // Peng-Robinson (1976) cubic EOS
    const pc = Math.max(10.0, getCon(slotPtr, conCount, 0, 667.8));
    const tc = Math.max(50.0, getCon(slotPtr, conCount, 1, 343.0));
    const omega = getCon(slotPtr, conCount, 2, 0.0115);
    const tempR = tempF + 459.67;
    const tr = tempR / tc;
    const pr = pressure / pc;
    const kappa = 0.37464 + 1.54226 * omega - 0.26992 * omega * omega;
    const alphaRoot = 1.0 + kappa * (1.0 - Math.sqrt(Math.max(1e-6, tr)));
    const alpha = alphaRoot * alphaRoot;
    const aDim = 0.45724 * alpha * pr / (tr * tr);
    const bDim = 0.07780 * pr / tr;
    // Z^3 - (1 - B) Z^2 + (A - 3 B^2 - 2 B) Z - (A B - B^2 - B^3) = 0
    const c2 = -(1.0 - bDim);
    const c1 = aDim - 3.0 * bDim * bDim - 2.0 * bDim;
    const c0 = -(aDim * bDim - bDim * bDim - bDim * bDim * bDim);
    const z = solveCubicZ(c2, c1, c0, bDim);
    setIo(slotPtr, 8, z);
    setIo(slotPtr, 9, aDim);
    setIo(slotPtr, 10, bDim);
    setIo(slotPtr, 11, alpha);
    return 0;
  }

  if (archetypeId == ARCH_EOS_SRK_COMP) {
    // Soave-Redlich-Kwong (1972) cubic EOS
    const pc = Math.max(10.0, getCon(slotPtr, conCount, 0, 667.8));
    const tc = Math.max(50.0, getCon(slotPtr, conCount, 1, 343.0));
    const omega = getCon(slotPtr, conCount, 2, 0.0115);
    const tempR = tempF + 459.67;
    const tr = tempR / tc;
    const pr = pressure / pc;
    const mSrk = 0.480 + 1.574 * omega - 0.176 * omega * omega;
    const alphaRoot = 1.0 + mSrk * (1.0 - Math.sqrt(Math.max(1e-6, tr)));
    const alpha = alphaRoot * alphaRoot;
    const aDim = 0.42748 * alpha * pr / (tr * tr);
    const bDim = 0.08664 * pr / tr;
    // Z^3 - Z^2 + (A - B - B^2) Z - A B = 0
    const c2 = -1.0;
    const c1 = aDim - bDim - bDim * bDim;
    const c0 = -(aDim * bDim);
    const z = solveCubicZ(c2, c1, c0, bDim);
    setIo(slotPtr, 8, z);
    setIo(slotPtr, 9, aDim);
    setIo(slotPtr, 10, bDim);
    setIo(slotPtr, 11, alpha);
    return 0;
  }

  if (archetypeId == ARCH_ROCK_COMPRESS) {
    const pRef = getCon(slotPtr, conCount, 0, 3000.0);
    const cr = getCon(slotPtr, conCount, 1, 4.0e-6);
    const poroRef = getCon(slotPtr, conCount, 2, 0.2);
    const pvMult = Math.exp(cr * (pressure - pRef));
    const poro = poroRef * pvMult;
    setIo(slotPtr, 8, pvMult);
    setIo(slotPtr, 9, poro);
    setIo(slotPtr, 10, cr);
    setIo(slotPtr, 11, 0.0);
    return 0;
  }

  // =========================================================================
  // 2. Relative Permeability & SCAL
  // =========================================================================
  if (archetypeId == ARCH_SWOF_COREY) {
    // Tabulated SWOF piecewise-linear interpolation when CON[7] = nRows >= 2:
    //   CON[8 + 4*i + 0..3] = [Sw_i, krw_i, krow_i, Pcow_i] (ascending Sw_i)
    const nRowsRaw = <i32>Math.floor(getCon(slotPtr, conCount, 7, 0.0));
    if (nRowsRaw >= 2 && conCount >= 8 + nRowsRaw * 4) {
      const nRows = nRowsRaw > 32 ? 32 : nRowsRaw;
      interpTable4Col(slotPtr, conCount, 8, nRows, sw);
      const swMin = getCon(slotPtr, conCount, 8, 0.0);
      const swMax = getCon(slotPtr, conCount, 8 + (nRows - 1) * 4, 1.0);
      const se = clamp((sw - swMin) / Math.max(1e-6, swMax - swMin), 0.0, 1.0);
      setIo(slotPtr, 11, se);
      return 0;
    }

    // Corey (1954) oil-water relative permeability
    const swc = getCon(slotPtr, conCount, 0, 0.2);
    const sor = getCon(slotPtr, conCount, 1, 0.2);
    const krwMax = getCon(slotPtr, conCount, 2, 0.8);
    const kroMax = getCon(slotPtr, conCount, 3, 1.0);
    const nw = Math.max(0.1, getCon(slotPtr, conCount, 4, 2.0));
    const no = Math.max(0.1, getCon(slotPtr, conCount, 5, 2.0));
    const pcMax = getCon(slotPtr, conCount, 6, 10.0);

    const denom = Math.max(1e-6, 1.0 - swc - sor);
    const se = clamp((sw - swc) / denom, 0.0, 1.0);
    const krw = krwMax * Math.pow(se, nw);
    const krow = kroMax * Math.pow(1.0 - se, no);
    const pcow = pcMax * (1.0 - se) * (1.0 - se);

    setIo(slotPtr, 8, krw);
    setIo(slotPtr, 9, krow);
    setIo(slotPtr, 10, pcow);
    setIo(slotPtr, 11, se);
    return 0;
  }

  if (archetypeId == ARCH_SGOF_COREY) {
    // Tabulated SGOF piecewise-linear interpolation when CON[8] = nRows >= 2:
    //   CON[9 + 4*i + 0..3] = [Sg_i, krg_i, krog_i, Pcog_i] (ascending Sg_i)
    const nRowsRaw = <i32>Math.floor(getCon(slotPtr, conCount, 8, 0.0));
    if (nRowsRaw >= 2 && conCount >= 9 + nRowsRaw * 4) {
      const nRows = nRowsRaw > 32 ? 32 : nRowsRaw;
      interpTable4Col(slotPtr, conCount, 9, nRows, sg);
      const sgMin = getCon(slotPtr, conCount, 9, 0.0);
      const sgMax = getCon(slotPtr, conCount, 9 + (nRows - 1) * 4, 1.0);
      const sgEff = clamp((sg - sgMin) / Math.max(1e-6, sgMax - sgMin), 0.0, 1.0);
      setIo(slotPtr, 11, sgEff);
      return 0;
    }

    const sgc = getCon(slotPtr, conCount, 0, 0.05);
    const sorg = getCon(slotPtr, conCount, 1, 0.15);
    const swc = getCon(slotPtr, conCount, 2, 0.2);
    const krgMax = getCon(slotPtr, conCount, 3, 0.9);
    const kroMax = getCon(slotPtr, conCount, 4, 1.0);
    const ng = Math.max(0.1, getCon(slotPtr, conCount, 5, 2.0));
    const nog = Math.max(0.1, getCon(slotPtr, conCount, 6, 2.5));
    const pcMax = getCon(slotPtr, conCount, 7, 5.0);

    const denom = Math.max(1e-6, 1.0 - swc - sorg - sgc);
    const sgEff = clamp((sg - sgc) / denom, 0.0, 1.0);
    const krg = krgMax * Math.pow(sgEff, ng);
    const krog = kroMax * Math.pow(1.0 - sgEff, nog);
    const pcog = pcMax * sgEff * sgEff;

    setIo(slotPtr, 8, krg);
    setIo(slotPtr, 9, krog);
    setIo(slotPtr, 10, pcog);
    setIo(slotPtr, 11, sgEff);
    return 0;
  }

  if (archetypeId == ARCH_STONE1_3PHASE) {
    // Stone I (1970) 3-phase oil relative permeability
    const swc = getCon(slotPtr, conCount, 0, 0.2);
    const sorw = getCon(slotPtr, conCount, 1, 0.2);
    const sgc = getCon(slotPtr, conCount, 2, 0.05);
    const sorg = getCon(slotPtr, conCount, 3, 0.15);
    const krocw = Math.max(1e-6, getCon(slotPtr, conCount, 4, 1.0));
    const now = Math.max(0.1, getCon(slotPtr, conCount, 5, 2.0));
    const nog = Math.max(0.1, getCon(slotPtr, conCount, 6, 2.0));

    const so = clamp(1.0 - sw - sg, 0.0, 1.0);
    const som = Math.min(sorw, sorg);
    const denom = Math.max(1e-6, 1.0 - swc - som);
    const soStar = clamp((so - som) / denom, 0.0, 1.0);
    const swStar = clamp((sw - swc) / denom, 0.0, 1.0);
    const sgStar = clamp(sg / denom, 0.0, 1.0);

    const seW = clamp((sw - swc) / Math.max(1e-6, 1.0 - swc - sorw), 0.0, 1.0);
    const krow = krocw * Math.pow(1.0 - seW, now);
    const seG = clamp((sg - sgc) / Math.max(1e-6, 1.0 - swc - sorg - sgc), 0.0, 1.0);
    const krog = krocw * Math.pow(1.0 - seG, nog);

    const betaW = krow / Math.max(1e-6, krocw * (1.0 - swStar));
    const betaG = krog / Math.max(1e-6, krocw * (1.0 - sgStar));
    const kro = clamp(soStar * betaW * betaG * krocw, 0.0, krocw);

    setIo(slotPtr, 8, kro);
    setIo(slotPtr, 9, krow);
    setIo(slotPtr, 10, krog);
    setIo(slotPtr, 11, so);
    return 0;
  }

  if (archetypeId == ARCH_STONE2_3PHASE) {
    // Stone II (1973) 3-phase oil relative permeability
    const swc = getCon(slotPtr, conCount, 0, 0.2);
    const sor = getCon(slotPtr, conCount, 1, 0.2);
    const sgc = getCon(slotPtr, conCount, 2, 0.05);
    const krwMax = getCon(slotPtr, conCount, 3, 0.8);
    const krgMax = getCon(slotPtr, conCount, 4, 0.9);
    const krocw = Math.max(1e-6, getCon(slotPtr, conCount, 5, 1.0));
    const nw = Math.max(0.1, getCon(slotPtr, conCount, 6, 2.0));
    const ng = Math.max(0.1, getCon(slotPtr, conCount, 7, 2.0));
    const now = Math.max(0.1, getCon(slotPtr, conCount, 8, 2.0));
    const nog = Math.max(0.1, getCon(slotPtr, conCount, 9, 2.0));

    const seW = clamp((sw - swc) / Math.max(1e-6, 1.0 - swc - sor), 0.0, 1.0);
    const krw = krwMax * Math.pow(seW, nw);
    const krow = krocw * Math.pow(1.0 - seW, now);

    const seG = clamp((sg - sgc) / Math.max(1e-6, 1.0 - swc - sor - sgc), 0.0, 1.0);
    const krg = krgMax * Math.pow(seG, ng);
    const krog = krocw * Math.pow(1.0 - seG, nog);

    const kroRaw = krocw * ((krow / krocw + krw) * (krog / krocw + krg) - (krw + krg));
    const kro = clamp(kroRaw, 0.0, krocw);
    const so = clamp(1.0 - sw - sg, 0.0, 1.0);

    setIo(slotPtr, 8, kro);
    setIo(slotPtr, 9, krw);
    setIo(slotPtr, 10, krg);
    setIo(slotPtr, 11, so);
    return 0;
  }

  if (archetypeId == ARCH_PC_LEVERETT_J) {
    // Leverett (1941) J-function capillary pressure scaling
    const sigma = getCon(slotPtr, conCount, 0, 30.0);
    const cosTheta = getCon(slotPtr, conCount, 1, 1.0);
    const poro = Math.max(1e-4, getCon(slotPtr, conCount, 2, 0.2));
    const perm = Math.max(1e-4, getCon(slotPtr, conCount, 3, 100.0));
    const swc = getCon(slotPtr, conCount, 4, 0.2);
    const jScale = getCon(slotPtr, conCount, 5, 0.5);
    const jExp = Math.max(0.1, getCon(slotPtr, conCount, 6, 1.5));

    const se = clamp((sw - swc) / Math.max(1e-6, 1.0 - swc), 1e-4, 1.0);
    const jVal = jScale * Math.pow(se, -jExp);
    // Field conversion factor: 0.21645 converts dyn/cm * sqrt(1/mD) to psi
    const pc = 0.21645 * sigma * cosTheta * Math.sqrt(poro / perm) * jVal;

    setIo(slotPtr, 8, pc);
    setIo(slotPtr, 9, jVal);
    setIo(slotPtr, 10, se);
    setIo(slotPtr, 11, 0.0);
    return 0;
  }

  // =========================================================================
  // 3. Wells & Aquifers
  // =========================================================================
  if (archetypeId == ARCH_WELSPECS_PROD) {
    const targetRate = Math.max(0.0, getCon(slotPtr, conCount, 0, 2000.0));
    const bhpMin = Math.max(0.0, getCon(slotPtr, conCount, 1, 1500.0));
    const wi = Math.max(0.0, getCon(slotPtr, conCount, 2, 10.0));

    const maxPotential = Math.max(0.0, wi * mobility * (pressure - bhpMin));
    const actualRate = targetRate < maxPotential ? targetRate : maxPotential;
    const effBhp = wi * mobility > 1e-12 ? pressure - actualRate / (wi * mobility) : bhpMin;

    setIo(slotPtr, 8, actualRate);
    setIo(slotPtr, 9, effBhp);
    setIo(slotPtr, 10, maxPotential);
    setIo(slotPtr, 11, actualRate < targetRate ? 1.0 : 0.0); // 1 = BHP-constrained
    return 0;
  }

  if (archetypeId == ARCH_WELSPECS_INJ) {
    const targetRate = Math.max(0.0, getCon(slotPtr, conCount, 0, 2500.0));
    const bhpMax = Math.max(0.0, getCon(slotPtr, conCount, 1, 5000.0));
    const wi = Math.max(0.0, getCon(slotPtr, conCount, 2, 10.0));

    const maxPotential = Math.max(0.0, wi * mobility * (bhpMax - pressure));
    const actualRate = targetRate < maxPotential ? targetRate : maxPotential;
    const effBhp = wi * mobility > 1e-12 ? pressure + actualRate / (wi * mobility) : bhpMax;

    setIo(slotPtr, 8, actualRate);
    setIo(slotPtr, 9, effBhp);
    setIo(slotPtr, 10, maxPotential);
    setIo(slotPtr, 11, actualRate < targetRate ? 1.0 : 0.0); // 1 = BHP-constrained
    return 0;
  }

  if (archetypeId == ARCH_COMPDAT_PEACEMAN) {
    // Peaceman (1978, 1983) anisotropic well productivity index:
    //   r_o = 0.28 * sqrt(sqrt(ky/kx)*dx^2 + sqrt(kx/ky)*dy^2) / ((ky/kx)^(1/4) + (kx/ky)^(1/4))
    //   WI  = unitFactor * 2 * pi * sqrt(kx * ky) * h / (ln(r_o / r_w) + s)
    const kx = Math.max(1e-6, getCon(slotPtr, conCount, 0, 100.0));
    const ky = Math.max(1e-6, getCon(slotPtr, conCount, 1, 100.0));
    const h = Math.max(1e-6, getCon(slotPtr, conCount, 2, 50.0));
    const dx = Math.max(1e-6, getCon(slotPtr, conCount, 3, 100.0));
    const dy = Math.max(1e-6, getCon(slotPtr, conCount, 4, 100.0));
    const rw = Math.max(1e-6, getCon(slotPtr, conCount, 5, 0.25));
    const skin = getCon(slotPtr, conCount, 6, 0.0);
    const unitFactor = getCon(slotPtr, conCount, 7, 1.0);

    const kRatioYX = Math.sqrt(ky / kx);
    const kRatioXY = Math.sqrt(kx / ky);
    const roNum = 0.28 * Math.sqrt(kRatioYX * dx * dx + kRatioXY * dy * dy);
    const roDen = Math.sqrt(kRatioYX) + Math.sqrt(kRatioXY);
    const ro = Math.max(rw * 1.01, roNum / roDen);

    const kEff = Math.sqrt(kx * ky);
    const denom = Math.max(1e-6, Math.log(ro / rw) + skin);
    const wi = (unitFactor * 2.0 * Math.PI * kEff * h) / denom;
    const qRate = wi * mobility * (pressure - bhp);

    setIo(slotPtr, 8, wi);
    setIo(slotPtr, 9, ro);
    setIo(slotPtr, 10, qRate);
    setIo(slotPtr, 11, kEff);
    return 0;
  }

  if (archetypeId == ARCH_VFPPROD_LIFT) {
    // 2D Tabulated VFPPROD bilinear BHP(rate, THP) lookup when CON[4]=nRate >= 2 and CON[5]=nThp >= 2:
    //   CON[6 .. 6+nRate-1]                   = ascending rate axis Q
    //   CON[6+nRate .. 6+nRate+nThp-1]        = ascending THP axis
    //   CON[6+nRate+nThp .. +nRate*nThp-1]    = BHP[iThp * nRate + iRate]
    const nRate = <i32>Math.floor(getCon(slotPtr, conCount, 4, 0.0));
    const nThp = <i32>Math.floor(getCon(slotPtr, conCount, 5, 0.0));
    if (nRate >= 2 && nThp >= 2 && conCount >= 6 + nRate + nThp + nRate * nThp) {
      const qAxis = 6;
      const thpAxis = 6 + nRate;
      const bhpGrid = thpAxis + nThp;
      const q = Math.max(0.0, rateIn);
      const thpIn = pressure;

      const iq = findAxisIdx(slotPtr, conCount, qAxis, nRate, q);
      const it = findAxisIdx(slotPtr, conCount, thpAxis, nThp, thpIn);
      const wq = axisWeight(slotPtr, conCount, qAxis, iq, q);
      const wt = axisWeight(slotPtr, conCount, thpAxis, it, thpIn);

      const b00 = getCon(slotPtr, conCount, bhpGrid + it * nRate + iq, 0.0);
      const b01 = getCon(slotPtr, conCount, bhpGrid + it * nRate + iq + 1, b00);
      const b10 = getCon(slotPtr, conCount, bhpGrid + (it + 1) * nRate + iq, b00);
      const b11 = getCon(slotPtr, conCount, bhpGrid + (it + 1) * nRate + iq + 1, b00);

      const row0 = b00 + wq * (b01 - b00);
      const row1 = b10 + wq * (b11 - b10);
      const reqBhp = row0 + wt * (row1 - row0);

      const dq = Math.max(1e-12, getCon(slotPtr, conCount, qAxis + iq + 1, 1.0) - getCon(slotPtr, conCount, qAxis + iq, 0.0));
      const dBhpDq = ((1.0 - wt) * (b01 - b00) + wt * (b11 - b10)) / dq;

      setIo(slotPtr, 8, thpIn);
      setIo(slotPtr, 9, reqBhp);
      setIo(slotPtr, 10, reqBhp - thpIn);
      setIo(slotPtr, 11, dBhpDq);
      return 0;
    }

    const depth = Math.max(0.0, getCon(slotPtr, conCount, 0, 8000.0));
    const gradHydro = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.35));
    const fricCoeff = Math.max(0.0, getCon(slotPtr, conCount, 2, 1.5e-5));
    const thpMin = Math.max(14.7, getCon(slotPtr, conCount, 3, 150.0));

    const q = Math.max(0.0, rateIn);
    const dpHydro = gradHydro * depth;
    const dpFric = fricCoeff * q * q;
    const thp = Math.max(thpMin, bhp - dpHydro - dpFric);
    const reqBhp = thpMin + dpHydro + dpFric;

    setIo(slotPtr, 8, thp);
    setIo(slotPtr, 9, reqBhp);
    setIo(slotPtr, 10, dpHydro);
    setIo(slotPtr, 11, dpFric);
    return 0;
  }

  if (archetypeId == ARCH_MSWELL_SEGMENT) {
    const segLen = Math.max(0.0, getCon(slotPtr, conCount, 0, 500.0));
    const segDz = getCon(slotPtr, conCount, 1, 400.0);
    const diam = Math.max(0.05, getCon(slotPtr, conCount, 2, 0.35));
    const rough = Math.max(1e-6, getCon(slotPtr, conCount, 3, 1.0e-4));
    const rhoMix = Math.max(1.0, getCon(slotPtr, conCount, 4, 45.0));

    // Hydrostatic drop (psi): rho (lb/ft3) * dz (ft) / 144
    const dpHydro = (rhoMix * segDz) / 144.0;
    // Velocity (ft/s) from rateIn (stb/d): 1 stb/d = 5.615 / 86400 ft3/s
    const area = 0.25 * Math.PI * diam * diam;
    const vel = (Math.abs(rateIn) * 5.615 / 86400.0) / area;
    // Haaland turbulent friction factor approximation
    const fDarcy = Math.pow(-1.8 * Math.log10(Math.pow(rough / (3.7 * diam), 1.11) + 1e-5), -2.0);
    // Darcy-Weisbach drop (psi): f * (L/D) * rho * v^2 / (2 * gc * 144)
    const dpFric = (fDarcy * (segLen / diam) * rhoMix * vel * vel) / (2.0 * 32.174 * 144.0);
    const dpTotal = dpHydro + dpFric;

    setIo(slotPtr, 8, dpTotal);
    setIo(slotPtr, 9, dpHydro);
    setIo(slotPtr, 10, dpFric);
    setIo(slotPtr, 11, vel);
    return 0;
  }

  if (archetypeId == ARCH_AQUFETP_FETKOVICH) {
    // Fetkovich (1971) pseudo-steady-state analytical aquifer
    const pInit = Math.max(1.0, getCon(slotPtr, conCount, 0, 4000.0));
    const wei = Math.max(1.0, getCon(slotPtr, conCount, 1, 1.0e8));
    const jProd = Math.max(0.0, getCon(slotPtr, conCount, 2, 200.0));

    let we = getState(slotPtr, 0);
    let pAq = getState(slotPtr, 1);
    if (pAq <= 0.0) pAq = pInit;

    let dWe: f64 = 0.0;
    let qAq: f64 = 0.0;
    if (dt > 0.0) {
      const expTerm = Math.exp((-jProd * pInit * dt) / wei);
      dWe = (wei / pInit) * (pAq - pressure) * (1.0 - expTerm);
      we += dWe;
      pAq = pInit * (1.0 - we / wei);
      qAq = dWe / dt;
      setState(slotPtr, 0, we);
      setState(slotPtr, 1, pAq);
      setDState(slotPtr, 0, qAq);
    } else {
      qAq = jProd * (pAq - pressure);
      setDState(slotPtr, 0, qAq);
    }

    setIo(slotPtr, 8, qAq);
    setIo(slotPtr, 9, we);
    setIo(slotPtr, 10, pAq);
    setIo(slotPtr, 11, dWe);
    return 0;
  }

  if (archetypeId == ARCH_AQUTAB_CARTER_TRACY) {
    // Carter-Tracy (1960) analytical radial aquifer
    const pInit = Math.max(1.0, getCon(slotPtr, conCount, 0, 4000.0));
    const bConst = Math.max(0.0, getCon(slotPtr, conCount, 1, 5000.0));
    const timeConst = Math.max(1e-6, getCon(slotPtr, conCount, 2, 0.05));

    let we = getState(slotPtr, 0);
    let tCum = getState(slotPtr, 1);
    const dtPos = dt > 0.0 ? dt : 1.0;
    const tPrev = tCum;
    tCum += dtPos;

    const td = Math.max(1e-4, timeConst * tCum);
    const tdPrev = timeConst * tPrev;
    // Infinite-acting radial dimensionless pressure approximation:
    // P_D(t_D) = 0.5 * ln(1 + 2.2458 * t_D), dP_D/dt_D = 1.1229 / (1 + 2.2458 * t_D)
    const pd = 0.5 * Math.log(1.0 + 2.2458 * td);
    const dPdDtd = 1.1229 / (1.0 + 2.2458 * td);
    const dp = pInit - pressure;
    const denom = Math.max(1e-6, pd - tdPrev * dPdDtd);
    const dWe = ((bConst * dp - we * dPdDtd) / denom) * (td - tdPrev);
    we += dWe;
    const qAq = dWe / dtPos;

    setState(slotPtr, 0, we);
    setState(slotPtr, 1, tCum);
    setDState(slotPtr, 0, qAq);

    setIo(slotPtr, 8, qAq);
    setIo(slotPtr, 9, we);
    setIo(slotPtr, 10, pd);
    setIo(slotPtr, 11, td);
    return 0;
  }

  return -1;
}
