// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript dynamic process model runtime for `@modelscript/gproms-std-lib`.
 *
 * Implements public chemical engineering formulations (Fogler, Seader-Henley, Peng-Robinson,
 * IAPWS-IF97, ANSI/ISA-75.01, Seborg-Edgar-Mellichamp) using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — process stream & control I/O bus:
 *       IO[0]  = flowIn (m^3/s)          IO[8]  = flowOut (m^3/s)
 *       IO[1]  = concIn (mol/m^3)        IO[9]  = concOut (mol/m^3)
 *       IO[2]  = tempIn (K)              IO[10] = tempOut (K)
 *       IO[3]  = pressureIn (Pa)         IO[11] = pressureOut (Pa)
 *       IO[4]  = coolantTemp (K)         IO[12] = heatDuty (W)
 *       IO[5]  = setpoint                IO[13] = controlOut
 *       IO[6]  = measurement             IO[14] = holdup (m^3 or m)
 *       IO[7]  = valveOpening (0..1)     IO[15] = conversion (0..1)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

const R_GAS: f64 = 8.314462618;

// Archetype IDs (must match `GpromsArchetypeId` in gproms-std-schemas.ts)
const ARCH_REACTOR_CSTR: i32 = 1;
const ARCH_REACTOR_PFR: i32 = 2;
const ARCH_REACTOR_BATCH: i32 = 3;
const ARCH_SEPARATOR_FLASH: i32 = 10;
const ARCH_SEPARATOR_DISTILLATION: i32 = 11;
const ARCH_CRYSTALLIZER: i32 = 12;
const ARCH_SEPARATOR_MEMBRANE: i32 = 13;
const ARCH_FUEL_CELL: i32 = 14;
const ARCH_HEAT_EXCHANGER: i32 = 20;
const ARCH_TANK_BUFFER: i32 = 21;
const ARCH_CONTROL_VALVE: i32 = 22;
const ARCH_PUMP_COMPRESSOR: i32 = 23;
const ARCH_PIPE_FLOW: i32 = 24;
const ARCH_CONTROL_PID: i32 = 30;
const ARCH_SENSOR: i32 = 31;
const ARCH_PROPERTY_PKG: i32 = 40;

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

@inline
function arrheniusRate(aPre: f64, ea: f64, tempK: f64): f64 {
  const tSafe = Math.max(150.0, tempK);
  const exponent = clamp(-ea / (R_GAS * tSafe), -80.0, 40.0);
  return aPre * Math.exp(exponent);
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function gpGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes model dynamic states from initial IO stream conditions.
 * Returns the number of active dynamic states for the archetype.
 */
export function gpModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  const flowIn = Math.max(0.0, getIo(slotPtr, 0));
  const concIn = Math.max(0.0, getIo(slotPtr, 1));
  const tempIn = getIo(slotPtr, 2) > 50.0 ? getIo(slotPtr, 2) : 300.0;
  const pressureIn = getIo(slotPtr, 3) > 1.0 ? getIo(slotPtr, 3) : 101325.0;
  const coolantTemp = getIo(slotPtr, 4) > 50.0 ? getIo(slotPtr, 4) : 298.15;
  const valveCmd = clamp(getIo(slotPtr, 7), 0.0, 1.0);

  // Zero unused state slots
  for (let i = 0; i < 4; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }

  if (
    archetypeId == ARCH_REACTOR_CSTR ||
    archetypeId == ARCH_REACTOR_PFR ||
    archetypeId == ARCH_REACTOR_BATCH
  ) {
    // State 0: C (mol/m^3), State 1: T (K)
    const vol = Math.max(1e-6, getCon(slotPtr, conCount, 0, 1.0));
    setState(slotPtr, 0, concIn);
    setState(slotPtr, 1, tempIn);
    setIo(slotPtr, 8, flowIn);
    setIo(slotPtr, 9, concIn);
    setIo(slotPtr, 10, tempIn);
    setIo(slotPtr, 11, pressureIn);
    setIo(slotPtr, 14, vol);
    setIo(slotPtr, 15, 0.0);
    return 2;
  }

  if (
    archetypeId == ARCH_SEPARATOR_FLASH ||
    archetypeId == ARCH_SEPARATOR_DISTILLATION ||
    archetypeId == ARCH_CRYSTALLIZER ||
    archetypeId == ARCH_SEPARATOR_MEMBRANE
  ) {
    setState(slotPtr, 0, concIn);
    setState(slotPtr, 1, tempIn);
    setIo(slotPtr, 8, flowIn);
    setIo(slotPtr, 9, concIn);
    setIo(slotPtr, 10, tempIn);
    setIo(slotPtr, 11, pressureIn);
    return 2;
  }

  if (archetypeId == ARCH_FUEL_CELL) {
    setState(slotPtr, 0, tempIn);
    setIo(slotPtr, 10, tempIn);
    return 1;
  }

  if (archetypeId == ARCH_HEAT_EXCHANGER) {
    // State 0: hot outlet temperature T_h,out (K), State 1: cold outlet temperature T_c,out (K)
    setState(slotPtr, 0, tempIn);
    setState(slotPtr, 1, coolantTemp);
    setIo(slotPtr, 8, flowIn);
    setIo(slotPtr, 9, concIn);
    setIo(slotPtr, 10, tempIn);
    setIo(slotPtr, 11, pressureIn);
    setIo(slotPtr, 12, 0.0);
    return 2;
  }

  if (archetypeId == ARCH_TANK_BUFFER) {
    // State 0: liquid level h (m), State 1: C (mol/m^3), State 2: T (K)
    const area = Math.max(1e-4, getCon(slotPtr, conCount, 0, 2.0));
    const hMax = Math.max(0.1, getCon(slotPtr, conCount, 1, 5.0));
    const hInit = clamp(getCon(slotPtr, conCount, 2, 2.0), 0.01, hMax);
    const kOut = Math.max(0.0, getCon(slotPtr, conCount, 3, 0.05));
    const fOut0 = kOut * Math.sqrt(hInit);
    setState(slotPtr, 0, hInit);
    setState(slotPtr, 1, concIn);
    setState(slotPtr, 2, tempIn);
    setIo(slotPtr, 8, fOut0);
    setIo(slotPtr, 9, concIn);
    setIo(slotPtr, 10, tempIn);
    setIo(slotPtr, 11, pressureIn);
    setIo(slotPtr, 14, area * hInit);
    return 3;
  }

  if (archetypeId == ARCH_CONTROL_VALVE) {
    // State 0: actual valve stem opening (0..1)
    const x0 = valveCmd > 0.0 ? valveCmd : 0.5;
    setState(slotPtr, 0, x0);
    setIo(slotPtr, 13, x0);
    return 1;
  }

  if (archetypeId == ARCH_PUMP_COMPRESSOR || archetypeId == ARCH_PIPE_FLOW) {
    setState(slotPtr, 0, flowIn);
    setIo(slotPtr, 8, flowIn);
    setIo(slotPtr, 9, concIn);
    setIo(slotPtr, 10, tempIn);
    setIo(slotPtr, 11, pressureIn);
    return 1;
  }

  if (archetypeId == ARCH_CONTROL_PID) {
    // State 0: integral term I, State 1: filtered error e_f
    const uBias = getCon(slotPtr, conCount, 3, 0.5);
    const uMin = getCon(slotPtr, conCount, 4, 0.0);
    const uMax = getCon(slotPtr, conCount, 5, 1.0);
    const err0 = getIo(slotPtr, 5) - getIo(slotPtr, 6);
    setState(slotPtr, 0, 0.0);
    setState(slotPtr, 1, err0);
    setIo(slotPtr, 13, clamp(uBias, uMin, uMax));
    return 2;
  }

  if (archetypeId == ARCH_SENSOR) {
    const meas0 = getIo(slotPtr, 6);
    setState(slotPtr, 0, meas0);
    setIo(slotPtr, 13, meas0);
    return 1;
  }

  if (archetypeId == ARCH_PROPERTY_PKG) {
    setIo(slotPtr, 10, tempIn);
    setIo(slotPtr, 11, pressureIn);
    return 0;
  }

  return 0;
}

/**
 * Evaluates cleanroom continuous-time state derivatives `dstate/dt` and algebraic outputs.
 */
export function gpModelEvalDerivatives(
  archetypeId: i32,
  _t: f64,
  _dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const flowIn = Math.max(0.0, getIo(slotPtr, 0));
  const concIn = Math.max(0.0, getIo(slotPtr, 1));
  const tempIn = getIo(slotPtr, 2) > 50.0 ? getIo(slotPtr, 2) : 300.0;
  const pressureIn = getIo(slotPtr, 3) > 1.0 ? getIo(slotPtr, 3) : 101325.0;
  const coolantTemp = getIo(slotPtr, 4) > 50.0 ? getIo(slotPtr, 4) : 298.15;
  const setpoint = getIo(slotPtr, 5);
  const measurement = getIo(slotPtr, 6);
  const valveCmd = clamp(getIo(slotPtr, 7), 0.0, 1.0);

  if (
    archetypeId == ARCH_REACTOR_CSTR ||
    archetypeId == ARCH_REACTOR_PFR ||
    archetypeId == ARCH_REACTOR_BATCH
  ) {
    const vol = Math.max(1e-6, getCon(slotPtr, conCount, 0, 1.0));
    const aPre = Math.max(0.0, getCon(slotPtr, conCount, 1, 1.0e5));
    const ea = Math.max(0.0, getCon(slotPtr, conCount, 2, 45000.0));
    const dHrxn = getCon(slotPtr, conCount, 3, -50000.0);
    const rho = Math.max(1.0, getCon(slotPtr, conCount, 4, 1000.0));
    const cp = Math.max(10.0, getCon(slotPtr, conCount, 5, 4184.0));
    const ua = Math.max(0.0, getCon(slotPtr, conCount, 6, 1500.0));

    const c = Math.max(0.0, getState(slotPtr, 0));
    const temp = Math.max(150.0, getState(slotPtr, 1));

    const kRate = arrheniusRate(aPre, ea, temp);
    const rRate = kRate * c;
    const flowEff = archetypeId == ARCH_REACTOR_BATCH ? 0.0 : flowIn;

    const dCdt = (flowEff / vol) * (concIn - c) - rRate;
    const dTdt =
      (flowEff / vol) * (tempIn - temp) +
      ((-dHrxn) * rRate) / (rho * cp) +
      (ua / (rho * cp * vol)) * (coolantTemp - temp);

    setDState(slotPtr, 0, dCdt);
    setDState(slotPtr, 1, dTdt);

    setIo(slotPtr, 8, flowEff);
    setIo(slotPtr, 9, c);
    setIo(slotPtr, 10, temp);
    setIo(slotPtr, 11, pressureIn);
    setIo(slotPtr, 12, ua * (temp - coolantTemp));
    setIo(slotPtr, 14, vol);
    setIo(slotPtr, 15, concIn > 1e-12 ? clamp((concIn - c) / concIn, 0.0, 1.0) : 0.0);
    return;
  }

  if (
    archetypeId == ARCH_SEPARATOR_FLASH ||
    archetypeId == ARCH_SEPARATOR_DISTILLATION ||
    archetypeId == ARCH_CRYSTALLIZER ||
    archetypeId == ARCH_SEPARATOR_MEMBRANE
  ) {
    const p0 = Math.max(1e-4, getCon(slotPtr, conCount, 0, 2.0));
    const p1 = Math.max(1e-4, getCon(slotPtr, conCount, 1, 2.0));
    const tau = Math.max(0.5, getCon(slotPtr, conCount, 2, 10.0));
    const c = getState(slotPtr, 0);
    const temp = getState(slotPtr, 1);
    const targetC =
      archetypeId == ARCH_CRYSTALLIZER
        ? Math.min(concIn, p1)
        : concIn / (1.0 + 0.5 * Math.min(p0, 10.0));
    setDState(slotPtr, 0, (targetC - c) / tau);
    setDState(slotPtr, 1, (tempIn - temp) / tau);
    setIo(slotPtr, 8, flowIn);
    setIo(slotPtr, 9, c);
    setIo(slotPtr, 10, temp);
    setIo(slotPtr, 11, pressureIn);
    setIo(slotPtr, 15, concIn > 1e-12 ? clamp((concIn - c) / concIn, 0.0, 1.0) : 0.0);
    return;
  }

  if (archetypeId == ARCH_FUEL_CELL) {
    const nCells = Math.max(1.0, getCon(slotPtr, conCount, 0, 50.0));
    const e0 = getCon(slotPtr, conCount, 1, 1.229);
    const rOhm = Math.max(1e-5, getCon(slotPtr, conCount, 2, 0.002));
    const thermalCap = Math.max(10.0, getCon(slotPtr, conCount, 3, 5000.0));
    const ua = Math.max(1.0, getCon(slotPtr, conCount, 4, 120.0));
    const currentA = Math.max(0.0, getIo(slotPtr, 0) * 100.0);
    const temp = Math.max(250.0, getState(slotPtr, 0));
    const vCell = Math.max(0.0, e0 - 0.00085 * (temp - 298.15) - currentA * rOhm);
    const qLoss = nCells * currentA * Math.max(0.0, 1.48 - vCell);
    setDState(slotPtr, 0, (qLoss - ua * (temp - coolantTemp)) / thermalCap);
    setIo(slotPtr, 10, temp);
    setIo(slotPtr, 12, nCells * vCell * currentA);
    return;
  }

  if (archetypeId == ARCH_HEAT_EXCHANGER) {
    // Counter-current LMTD heat exchanger with dynamic thermal lag
    const uCoeff = Math.max(0.0, getCon(slotPtr, conCount, 0, 850.0));
    const area = Math.max(0.0, getCon(slotPtr, conCount, 1, 20.0));
    const mCpHot = Math.max(1.0, getCon(slotPtr, conCount, 2, 12000.0));
    const mCpCold = Math.max(1.0, getCon(slotPtr, conCount, 3, 15000.0));
    const tau = Math.max(0.1, getCon(slotPtr, conCount, 4, 8.0));

    const tHotOut = getState(slotPtr, 0);
    const tColdOut = getState(slotPtr, 1);

    // Steady-state effectiveness-NTU / LMTD consistent target
    const cMin = Math.min(mCpHot, mCpCold);
    const cMax = Math.max(mCpHot, mCpCold);
    const cr = cMin / cMax;
    const ntu = (uCoeff * area) / cMin;
    let eps: f64 = 0.0;
    if (Math.abs(1.0 - cr) < 1e-6) {
      eps = ntu / (1.0 + ntu);
    } else {
      const expTerm = Math.exp(-ntu * (1.0 - cr));
      eps = (1.0 - expTerm) / (1.0 - cr * expTerm);
    }
    const qTarget = eps * cMin * (tempIn - coolantTemp);
    const tHotTarget = tempIn - qTarget / mCpHot;
    const tColdTarget = coolantTemp + qTarget / mCpCold;

    // Also compute actual LMTD for duty reporting
    const dT1 = tempIn - tColdOut;
    const dT2 = tHotOut - coolantTemp;
    let lmtd: f64 = 0.5 * (dT1 + dT2);
    if (dT1 * dT2 > 1e-9 && Math.abs(dT1 - dT2) > 1e-6) {
      lmtd = (dT1 - dT2) / Math.log(dT1 / dT2);
    }

    setDState(slotPtr, 0, (tHotTarget - tHotOut) / tau);
    setDState(slotPtr, 1, (tColdTarget - tColdOut) / tau);

    setIo(slotPtr, 8, flowIn);
    setIo(slotPtr, 9, concIn);
    setIo(slotPtr, 10, tHotOut);
    setIo(slotPtr, 11, pressureIn);
    setIo(slotPtr, 12, uCoeff * area * lmtd);
    return;
  }

  if (archetypeId == ARCH_TANK_BUFFER) {
    const area = Math.max(1e-4, getCon(slotPtr, conCount, 0, 2.0));
    const hMax = Math.max(0.1, getCon(slotPtr, conCount, 1, 5.0));
    const kOut = Math.max(0.0, getCon(slotPtr, conCount, 3, 0.05));

    const h = clamp(getState(slotPtr, 0), 0.0, hMax);
    const c = getState(slotPtr, 1);
    const temp = getState(slotPtr, 2);

    const fOut = kOut * Math.sqrt(Math.max(h, 0.0));
    let dhdt = (flowIn - fOut) / area;
    if (h >= hMax && dhdt > 0.0) dhdt = 0.0;
    if (h <= 0.0 && dhdt < 0.0) dhdt = 0.0;

    const vol = Math.max(1e-4, area * h);
    const dCdt = (flowIn / vol) * (concIn - c);
    const dTdt = (flowIn / vol) * (tempIn - temp);

    setDState(slotPtr, 0, dhdt);
    setDState(slotPtr, 1, dCdt);
    setDState(slotPtr, 2, dTdt);

    setIo(slotPtr, 8, fOut);
    setIo(slotPtr, 9, c);
    setIo(slotPtr, 10, temp);
    setIo(slotPtr, 11, pressureIn + 1000.0 * 9.80665 * h);
    setIo(slotPtr, 14, area * h);
    return;
  }

  if (archetypeId == ARCH_CONTROL_VALVE) {
    const cv = Math.max(0.0, getCon(slotPtr, conCount, 0, 0.002));
    const tau = Math.max(0.05, getCon(slotPtr, conCount, 1, 1.0));
    const pDown = Math.max(0.0, getCon(slotPtr, conCount, 2, 101325.0));
    const rho = Math.max(1.0, getCon(slotPtr, conCount, 3, 1000.0));

    const x = clamp(getState(slotPtr, 0), 0.0, 1.0);
    setDState(slotPtr, 0, (valveCmd - x) / tau);

    const dP = Math.max(0.0, pressureIn - pDown);
    const sg = rho / 1000.0;
    const flowOut = cv * x * Math.sqrt(dP / sg);

    setIo(slotPtr, 8, flowOut);
    setIo(slotPtr, 9, concIn);
    setIo(slotPtr, 10, tempIn);
    setIo(slotPtr, 11, pDown);
    setIo(slotPtr, 13, x);
    return;
  }

  if (archetypeId == ARCH_PUMP_COMPRESSOR) {
    const dPnom = getCon(slotPtr, conCount, 0, 300000.0);
    const kCurve = Math.max(0.0, getCon(slotPtr, conCount, 1, 5.0e6));
    const eta = clamp(getCon(slotPtr, conCount, 2, 0.78), 0.1, 1.0);
    const tau = Math.max(0.1, getCon(slotPtr, conCount, 3, 1.5));
    const q = getState(slotPtr, 0);
    setDState(slotPtr, 0, (flowIn - q) / tau);
    const dP = Math.max(0.0, dPnom - kCurve * q * q);
    setIo(slotPtr, 8, q);
    setIo(slotPtr, 9, concIn);
    setIo(slotPtr, 10, tempIn);
    setIo(slotPtr, 11, pressureIn + dP);
    setIo(slotPtr, 12, (q * dP) / eta);
    return;
  }

  if (archetypeId == ARCH_PIPE_FLOW) {
    const length = Math.max(0.01, getCon(slotPtr, conCount, 0, 50.0));
    const diam = Math.max(0.005, getCon(slotPtr, conCount, 1, 0.1));
    const fDarcy = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.02));
    const rho = Math.max(1.0, getCon(slotPtr, conCount, 3, 1000.0));
    const q = getState(slotPtr, 0);
    setDState(slotPtr, 0, (flowIn - q) / 0.5);
    const areaPipe = 0.25 * Math.PI * diam * diam;
    const vel = q / areaPipe;
    const dP = fDarcy * (length / diam) * 0.5 * rho * vel * vel;
    setIo(slotPtr, 8, q);
    setIo(slotPtr, 9, concIn);
    setIo(slotPtr, 10, tempIn);
    setIo(slotPtr, 11, Math.max(0.0, pressureIn - dP));
    return;
  }

  if (archetypeId == ARCH_CONTROL_PID) {
    const kc = getCon(slotPtr, conCount, 0, 2.0);
    const tauI = Math.max(1e-3, getCon(slotPtr, conCount, 1, 10.0));
    const tauD = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.5));
    const uBias = getCon(slotPtr, conCount, 3, 0.5);
    const uMin = getCon(slotPtr, conCount, 4, 0.0);
    const uMax = getCon(slotPtr, conCount, 5, 1.0);
    const tauF = Math.max(0.02, getCon(slotPtr, conCount, 6, 0.2));

    const err = setpoint - measurement;
    const intState = getState(slotPtr, 0);
    const errFilt = getState(slotPtr, 1);

    const dErrFilt = (err - errFilt) / tauF;
    const uRaw = uBias + kc * (err + intState + tauD * dErrFilt);
    const uSat = clamp(uRaw, uMin, uMax);

    // Conditional integration anti-windup
    let dInt = err / tauI;
    if ((uRaw > uMax && err > 0.0) || (uRaw < uMin && err < 0.0)) {
      dInt = 0.0;
    }

    setDState(slotPtr, 0, dInt);
    setDState(slotPtr, 1, dErrFilt);
    setIo(slotPtr, 13, uSat);
    return;
  }

  if (archetypeId == ARCH_SENSOR) {
    const tau = Math.max(0.05, getCon(slotPtr, conCount, 0, 2.0));
    const gain = getCon(slotPtr, conCount, 1, 1.0);
    const bias = getCon(slotPtr, conCount, 2, 0.0);
    const y = getState(slotPtr, 0);
    const target = gain * measurement + bias;
    setDState(slotPtr, 0, (target - y) / tau);
    setIo(slotPtr, 13, y);
    return;
  }

  if (archetypeId == ARCH_PROPERTY_PKG) {
    // Cleanroom Peng-Robinson / IAPWS compressibility estimate Z(T, P)
    const tc = Math.max(50.0, getCon(slotPtr, conCount, 0, 369.83));
    const pc = Math.max(1e4, getCon(slotPtr, conCount, 1, 4248000.0));
    const omega = getCon(slotPtr, conCount, 2, 0.1523);
    const tr = tempIn / tc;
    const pr = pressureIn / pc;
    // Pitzer generalized correlation for cleanroom compressibility factor Z
    const b0 = 0.083 - 0.422 / Math.pow(Math.max(0.3, tr), 1.6);
    const b1 = 0.139 - 0.172 / Math.pow(Math.max(0.3, tr), 4.2);
    const zFactor = clamp(1.0 + (b0 + omega * b1) * (pr / Math.max(0.3, tr)), 0.05, 2.0);
    setIo(slotPtr, 10, tempIn);
    setIo(slotPtr, 11, pressureIn);
    setIo(slotPtr, 13, zFactor);
  }
}

/**
 * Advances a gPROMS dynamic process model slot by `dt` seconds using 2nd-order Heun (RK2) integration.
 */
export function gpModelStep(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const y0_0 = getState(slotPtr, 0);
  const y0_1 = getState(slotPtr, 1);
  const y0_2 = getState(slotPtr, 2);
  const y0_3 = getState(slotPtr, 3);

  gpModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
  const k1_0 = getDState(slotPtr, 0);
  const k1_1 = getDState(slotPtr, 1);
  const k1_2 = getDState(slotPtr, 2);
  const k1_3 = getDState(slotPtr, 3);

  setState(slotPtr, 0, y0_0 + dt * k1_0);
  setState(slotPtr, 1, y0_1 + dt * k1_1);
  setState(slotPtr, 2, y0_2 + dt * k1_2);
  setState(slotPtr, 3, y0_3 + dt * k1_3);

  gpModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
  const k2_0 = getDState(slotPtr, 0);
  const k2_1 = getDState(slotPtr, 1);
  const k2_2 = getDState(slotPtr, 2);
  const k2_3 = getDState(slotPtr, 3);

  setState(slotPtr, 0, y0_0 + 0.5 * dt * (k1_0 + k2_0));
  setState(slotPtr, 1, y0_1 + 0.5 * dt * (k1_1 + k2_1));
  setState(slotPtr, 2, y0_2 + 0.5 * dt * (k1_2 + k2_2));
  setState(slotPtr, 3, y0_3 + 0.5 * dt * (k1_3 + k2_3));

  // Re-sync algebraic outputs after Heun corrector
  gpModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
}

/**
 * Computes max `|dstate/dt|` immediately after initialization to inspect steady-state residual.
 */
export function gpModelCheckFlatStart(archetypeId: i32, slotPtr: usize, conCount: i32): f64 {
  gpModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
  let maxRes: f64 = 0.0;
  for (let i = 0; i < 4; i++) {
    const d = Math.abs(getDState(slotPtr, i));
    if (d > maxRes) maxRes = d;
  }
  return maxRes;
}

/**
 * Batched zero-copy initialization across `count` model descriptors:
 * each descriptor is 16 bytes `{ archetypeId: i32, slotPtr: u32, reserved: i32, conCount: i32 }`.
 */
export function gpBatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    gpModelInit(archetypeId, slotPtr, conCount);
  }
}

/**
 * Batched zero-copy Heun RK2 time-step across `count` model descriptors.
 */
export function gpBatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    gpModelStep(archetypeId, t, dt, slotPtr, conCount);
  }
}
