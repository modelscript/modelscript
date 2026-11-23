// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript severe-accident physics runtime for `@modelscript/melcor-std-lib`.
 *
 * Uses a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — I/O bus:
 *       IO[0] = pressure1 (Pa)       IO[1] = pressure2 (Pa)
 *       IO[2] = temperature (K)      IO[3] = massFlow (kg/s)
 *       IO[4] = h2Mass (kg)          IO[5] = qOxidation (W)
 *       IO[6] = power (W)            IO[7] = rho (kg/m^3)
 *       IO[8] = cp (J/(kg*K))        IO[9] = kThermal (W/(m*K))
 *       IO[10] = x1 / abscissa       IO[11] = x2
 *       IO[12] = yOut                IO[13] = aerosolAirborne (kg)
 *       IO[14] = decayFraction       IO[15] = aux
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs matching `MelcorArchetypeId` in melcor-std-schemas.ts
const ARCH_CVH_VOLUME: i32 = 1;
const ARCH_CVH_TMDP: i32 = 2;
const ARCH_FL_PATH: i32 = 10;
const ARCH_FL_VALVE: i32 = 11;
const ARCH_HS_SLAB: i32 = 20;
const ARCH_COR_CELL: i32 = 30;
const ARCH_COR_OX_UH: i32 = 31;
const ARCH_COR_DECAY_ANS: i32 = 32;
const ARCH_RN1_AEROSOL: i32 = 40;
const ARCH_CF_FUNC: i32 = 50;
const ARCH_TF_TABLE: i32 = 51;
const ARCH_MP_UO2: i32 = 60;
const ARCH_MP_ZIRCALOY4: i32 = 61;
const ARCH_MP_SS304: i32 = 62;
const ARCH_NCG_H2: i32 = 70;
const ARCH_NCG_N2: i32 = 71;
const ARCH_NCG_H2O: i32 = 72;

// Stoichiometric H2 mass per kg Zr oxidized: 2 * M_H2 / M_Zr = 4.03176 / 91.224
const H2_PER_ZR: f64 = 0.044196264140905894;

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

export function melGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

function activeStateCount(archetypeId: i32): i32 {
  if (archetypeId == ARCH_CVH_VOLUME) return 2; // mass, internal energy
  if (archetypeId == ARCH_HS_SLAB) return 1; // T_hs
  if (archetypeId == ARCH_COR_CELL) return 1; // T_cor
  if (archetypeId == ARCH_COR_OX_UH) return 1; // w^2 (kg^2/m^4)
  if (archetypeId == ARCH_RN1_AEROSOL) return 2; // m_fuel, m_airborne
  return 0;
}

export function melModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  for (let i = 0; i < 4; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }

  if (archetypeId == ARCH_CVH_VOLUME) {
    const vol = Math.max(1e-4, getCon(slotPtr, conCount, 0, 100.0));
    const p0 = Math.max(1.0, getCon(slotPtr, conCount, 1, 1.55e7));
    const t0 = Math.max(10.0, getCon(slotPtr, conCount, 2, 580.0));
    const rGas = Math.max(1.0, getCon(slotPtr, conCount, 3, 461.52));
    const cv = Math.max(1.0, getCon(slotPtr, conCount, 4, 1500.0));
    const m0 = (p0 * vol) / (rGas * t0);
    const u0 = m0 * cv * t0;
    setState(slotPtr, 0, m0);
    setState(slotPtr, 1, u0);
    setIo(slotPtr, 0, p0);
    setIo(slotPtr, 2, t0);
    setIo(slotPtr, 7, m0 / vol);
    return 2;
  }

  if (archetypeId == ARCH_HS_SLAB) {
    const t0 = getCon(slotPtr, conCount, 5, 560.0);
    setState(slotPtr, 0, t0);
    setIo(slotPtr, 2, t0);
    return 1;
  }

  if (archetypeId == ARCH_COR_CELL) {
    const t0 = getCon(slotPtr, conCount, 3, 600.0);
    setState(slotPtr, 0, t0);
    setIo(slotPtr, 2, t0);
    return 1;
  }

  if (archetypeId == ARCH_COR_OX_UH) {
    setState(slotPtr, 0, 0.0); // w^2 = 0
    setIo(slotPtr, 4, 0.0);
    setIo(slotPtr, 5, 0.0);
    return 1;
  }

  if (archetypeId == ARCH_RN1_AEROSOL) {
    const mInit = Math.max(0.0, getCon(slotPtr, conCount, 0, 100.0));
    setState(slotPtr, 0, mInit);
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 13, 0.0);
    return 2;
  }

  melModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
  return 0;
}

export function melModelEvalDerivatives(
  archetypeId: i32,
  t: f64,
  _dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  if (archetypeId == ARCH_CVH_VOLUME) {
    const vol = Math.max(1e-4, getCon(slotPtr, conCount, 0, 100.0));
    const rGas = Math.max(1.0, getCon(slotPtr, conCount, 3, 461.52));
    const cv = Math.max(1.0, getCon(slotPtr, conCount, 4, 1500.0));
    const m = Math.max(1e-9, getState(slotPtr, 0));
    const u = Math.max(1e-9, getState(slotPtr, 1));
    const temp = u / (m * cv);
    const p = (m * rGas * temp) / vol;
    const mDotNet = getIo(slotPtr, 3);
    const qNet = getIo(slotPtr, 6);
    setDState(slotPtr, 0, mDotNet);
    setDState(slotPtr, 1, qNet + mDotNet * (cv + rGas) * temp);
    setIo(slotPtr, 0, p);
    setIo(slotPtr, 2, temp);
    setIo(slotPtr, 7, m / vol);
    return;
  }

  if (archetypeId == ARCH_CVH_TMDP) {
    setIo(slotPtr, 0, getCon(slotPtr, conCount, 0, 101325.0));
    setIo(slotPtr, 2, getCon(slotPtr, conCount, 1, 300.0));
    return;
  }

  if (archetypeId == ARCH_FL_PATH || archetypeId == ARCH_FL_VALVE) {
    const p1 = getIo(slotPtr, 0);
    const p2 = getIo(slotPtr, 1);
    const rho = Math.max(0.01, getIo(slotPtr, 7) > 0.0 ? getIo(slotPtr, 7) : 10.0);
    const area = Math.max(0.0, getCon(slotPtr, conCount, 0, 0.1));
    const kFwd = Math.max(0.0, getCon(slotPtr, conCount, archetypeId == ARCH_FL_PATH ? 2 : 1, 1.5));
    const cd = clamp(getCon(slotPtr, conCount, 4, 0.85), 0.0, 1.0);
    let openFrac: f64 = 1.0;
    if (archetypeId == ARCH_FL_PATH) {
      openFrac = clamp(getCon(slotPtr, conCount, 5, 1.0), 0.0, 1.0);
    } else {
      const pSet = getCon(slotPtr, conCount, 2, 16.2e6);
      const pFull = Math.max(pSet + 1e3, getCon(slotPtr, conCount, 3, 16.7e6));
      openFrac = clamp((p1 - pSet) / (pFull - pSet), 0.0, 1.0);
    }
    const dp = p1 - p2;
    const sign: f64 = dp >= 0.0 ? 1.0 : -1.0;
    const kEff = Math.max(1.0, 1.0 + kFwd);
    const mDot = sign * ((cd * area * openFrac) / Math.sqrt(kEff)) * Math.sqrt(2.0 * rho * Math.abs(dp));
    setIo(slotPtr, 3, mDot);
    setIo(slotPtr, 15, openFrac);
    return;
  }

  if (archetypeId == ARCH_HS_SLAB) {
    const mass = Math.max(1e-3, getCon(slotPtr, conCount, 0, 5000.0));
    const cp = Math.max(1.0, getCon(slotPtr, conCount, 1, 500.0));
    const area = Math.max(0.0, getCon(slotPtr, conCount, 2, 50.0));
    const htcL = Math.max(0.0, getCon(slotPtr, conCount, 3, 500.0));
    const tFluid = getIo(slotPtr, 10) > 1.0 ? getIo(slotPtr, 10) : 550.0;
    const qSrc = getIo(slotPtr, 6);
    const tWall = getState(slotPtr, 0);
    const qConv = htcL * area * (tWall - tFluid);
    setDState(slotPtr, 0, (qSrc - qConv) / (mass * cp));
    setIo(slotPtr, 2, tWall);
    return;
  }

  if (archetypeId == ARCH_COR_CELL) {
    const mass = Math.max(1e-3, getCon(slotPtr, conCount, 0, 80000.0));
    const cp = Math.max(1.0, getCon(slotPtr, conCount, 1, 350.0));
    const qDecay = getCon(slotPtr, conCount, 2, 3.0e7);
    const htcCool = Math.max(0.0, getCon(slotPtr, conCount, 4, 0.0));
    const areaCool = Math.max(0.0, getCon(slotPtr, conCount, 5, 1000.0));
    const tCool = getIo(slotPtr, 10) > 1.0 ? getIo(slotPtr, 10) : 580.0;
    const qOx = getIo(slotPtr, 5);
    const tCor = getState(slotPtr, 0);
    const qConv = htcCool * areaCool * (tCor - tCool);
    setDState(slotPtr, 0, (qDecay + qOx - qConv) / (mass * cp));
    setIo(slotPtr, 2, tCor);
    return;
  }

  if (archetypeId == ARCH_COR_OX_UH) {
    const aLow = getCon(slotPtr, conCount, 0, 29.6);
    const eLow = getCon(slotPtr, conCount, 1, 16820.0);
    const aHigh = getCon(slotPtr, conCount, 2, 87.9);
    const eHigh = getCon(slotPtr, conCount, 3, 16610.0);
    const area = Math.max(0.0, getCon(slotPtr, conCount, 4, 4500.0));
    const deltaH = Math.max(0.0, getCon(slotPtr, conCount, 5, 6.45e6));
    const temp = Math.max(300.0, getIo(slotPtr, 2));
    const kPar = temp < 1853.0 ? aLow * Math.exp(-eLow / temp) : aHigh * Math.exp(-eHigh / temp);
    // State 0 is w^2 (kg^2/m^4), so d(w^2)/dt = kPar
    setDState(slotPtr, 0, kPar);
    const wSq = Math.max(0.0, getState(slotPtr, 0));
    const w = Math.sqrt(wSq);
    const mZrOx = area * w;
    const mH2 = mZrOx * H2_PER_ZR;
    const dwDt = w > 1e-9 ? kPar / (2.0 * w) : 0.0;
    setIo(slotPtr, 4, mH2);
    setIo(slotPtr, 5, area * dwDt * deltaH);
    setIo(slotPtr, 15, mZrOx);
    return;
  }

  if (archetypeId == ARCH_COR_DECAY_ANS) {
    const pRated = Math.max(0.0, getCon(slotPtr, conCount, 0, 3.0e9));
    const tOp = Math.max(1.0, getCon(slotPtr, conCount, 1, 3.1536e7));
    const mult = Math.max(0.0, getCon(slotPtr, conCount, 2, 1.0));
    const ts = t > 0.0 ? t : 0.0;
    let sum: f64 = 0.0;
    sum += 0.0155 * Math.exp(-1.5 * ts) * (1.0 - Math.exp(-1.5 * tOp));
    sum += 0.0145 * Math.exp(-0.22 * ts) * (1.0 - Math.exp(-0.22 * tOp));
    sum += 0.0135 * Math.exp(-0.04 * ts) * (1.0 - Math.exp(-0.04 * tOp));
    sum += 0.0115 * Math.exp(-0.0075 * ts) * (1.0 - Math.exp(-0.0075 * tOp));
    sum += 0.0095 * Math.exp(-0.0013 * ts) * (1.0 - Math.exp(-0.0013 * tOp));
    sum += 0.0068 * Math.exp(-2.1e-4 * ts) * (1.0 - Math.exp(-2.1e-4 * tOp));
    sum += 0.0048 * Math.exp(-3.2e-5 * ts) * (1.0 - Math.exp(-3.2e-5 * tOp));
    sum += 0.003 * Math.exp(-4.2e-6 * ts) * (1.0 - Math.exp(-4.2e-6 * tOp));
    sum += 0.0014 * Math.exp(-3.5e-7 * ts) * (1.0 - Math.exp(-3.5e-7 * tOp));
    const frac = mult * sum;
    setIo(slotPtr, 14, frac);
    setIo(slotPtr, 6, pRated * frac);
    return;
  }

  if (archetypeId == ARCH_RN1_AEROSOL) {
    const kRel = Math.max(0.0, getCon(slotPtr, conCount, 1, 1.0e-4));
    const kSet = Math.max(0.0, getCon(slotPtr, conCount, 2, 5.0e-5));
    const mFuel = Math.max(0.0, getState(slotPtr, 0));
    const mAir = Math.max(0.0, getState(slotPtr, 1));
    const relRate = kRel * mFuel;
    const setRate = kSet * mAir;
    setDState(slotPtr, 0, -relRate);
    setDState(slotPtr, 1, relRate - setRate);
    setIo(slotPtr, 13, mAir);
    return;
  }

  if (archetypeId == ARCH_CF_FUNC) {
    const scale = getCon(slotPtr, conCount, 0, 1.0);
    const add = getCon(slotPtr, conCount, 1, 0.0);
    const w1 = getCon(slotPtr, conCount, 2, 1.0);
    const w2 = getCon(slotPtr, conCount, 3, 0.0);
    const x1 = getIo(slotPtr, 10);
    const x2 = getIo(slotPtr, 11);
    setIo(slotPtr, 12, scale * (w1 * x1 + w2 * x2) + add);
    return;
  }

  if (archetypeId == ARCH_TF_TABLE) {
    const scale = getCon(slotPtr, conCount, 0, 1.0);
    const add = getCon(slotPtr, conCount, 1, 0.0);
    const x0 = getCon(slotPtr, conCount, 2, 0.0);
    const y0 = getCon(slotPtr, conCount, 3, 0.0);
    const x1 = getCon(slotPtr, conCount, 4, 100.0);
    const y1 = getCon(slotPtr, conCount, 5, 1.0);
    const x = getIo(slotPtr, 10);
    const frac = Math.abs(x1 - x0) > 1e-12 ? clamp((x - x0) / (x1 - x0), 0.0, 1.0) : 0.0;
    setIo(slotPtr, 12, scale * (y0 + frac * (y1 - y0)) + add);
    return;
  }

  if (archetypeId == ARCH_MP_UO2 || archetypeId == ARCH_MP_ZIRCALOY4 || archetypeId == ARCH_MP_SS304) {
    setIo(slotPtr, 7, getCon(slotPtr, conCount, 0, 7930.0));
    setIo(slotPtr, 8, getCon(slotPtr, conCount, 1, 500.0));
    setIo(slotPtr, 9, getCon(slotPtr, conCount, 2, 18.0));
    setIo(slotPtr, 15, getCon(slotPtr, conCount, 3, 1700.0));
    return;
  }

  if (archetypeId == ARCH_NCG_H2 || archetypeId == ARCH_NCG_N2 || archetypeId == ARCH_NCG_H2O) {
    const rSpec = Math.max(1.0, getCon(slotPtr, conCount, 1, 461.52));
    const cp = Math.max(1.0, getCon(slotPtr, conCount, 2, 2080.0));
    const p = getIo(slotPtr, 0) > 1.0 ? getIo(slotPtr, 0) : 101325.0;
    const temp = getIo(slotPtr, 2) > 10.0 ? getIo(slotPtr, 2) : 300.0;
    setIo(slotPtr, 7, p / (rSpec * temp));
    setIo(slotPtr, 8, cp);
    setIo(slotPtr, 15, getCon(slotPtr, conCount, 3, 1.4));
    return;
  }
}

export function melModelStep(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const nStates = activeStateCount(archetypeId);
  if (nStates == 0 || dt <= 0.0) {
    melModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
    return;
  }

  const y0_0 = getState(slotPtr, 0);
  const y0_1 = nStates > 1 ? getState(slotPtr, 1) : 0.0;

  melModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
  const k1_0 = getDState(slotPtr, 0);
  const k1_1 = nStates > 1 ? getDState(slotPtr, 1) : 0.0;

  setState(slotPtr, 0, y0_0 + dt * k1_0);
  if (nStates > 1) setState(slotPtr, 1, y0_1 + dt * k1_1);

  melModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
  const k2_0 = getDState(slotPtr, 0);
  const k2_1 = nStates > 1 ? getDState(slotPtr, 1) : 0.0;

  setState(slotPtr, 0, y0_0 + 0.5 * dt * (k1_0 + k2_0));
  if (nStates > 1) setState(slotPtr, 1, y0_1 + 0.5 * dt * (k1_1 + k2_1));

  melModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
}

export function melModelCheckFlatStart(archetypeId: i32, slotPtr: usize, conCount: i32): f64 {
  melModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
  const nStates = activeStateCount(archetypeId);
  let maxRes: f64 = 0.0;
  for (let i = 0; i < nStates; i++) {
    const d = Math.abs(getDState(slotPtr, i));
    if (d > maxRes) maxRes = d;
  }
  return maxRes;
}

export function melBatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    melModelInit(archetypeId, slotPtr, conCount);
  }
}

export function melBatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    melModelStep(archetypeId, t, dt, slotPtr, conCount);
  }
}
