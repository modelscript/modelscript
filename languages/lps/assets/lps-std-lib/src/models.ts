// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript hydraulic & thermodynamic runtime for `@modelscript/lps-std-lib`.
 *
 * Implements standardized public pipeline engineering formulations (Weymouth / Darcy-Weisbach,
 * Swamee-Jain friction, polytropic centrifugal & reciprocating compression, Joukowsky
 * water-hammer surge, AGA-8 / Papay & Peng-Robinson compressibility Z(P,T), and pressure
 * regulator clamping) using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — internal state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives / residuals
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — hydraulic & thermodynamic I/O bus:
 *       IO[0]  = pinPa (Pa)             IO[8]  = headM (m)
 *       IO[1]  = tinK (K)               IO[9]  = zFactor (1)
 *       IO[2]  = massFlowKgS (kg/s)     IO[10] = densityKgM3 (kg/m3)
 *       IO[3]  = deltaVelocityMs (m/s)  IO[11] = velocityMs (m/s)
 *       IO[4]  = poutPa (Pa)            IO[12] = surgeDeltaPPa (Pa)
 *       IO[5]  = toutK (K)              IO[13] = waveSpeedMs (m/s)
 *       IO[6]  = deltaPPa (Pa)          IO[14] = pressureRatio (1)
 *       IO[7]  = powerW (W)             IO[15] = opening (0..1)
 */

import {
  evalAga8CompressibilityZ,
  evalPengRobinsonZ,
} from "../../../../../packages/runtime/assembly/physics/thermo-eos";

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

const R_UNIVERSAL: f64 = 8314.462618; // J / (kmol * K)
const GRAVITY: f64 = 9.80665; // m / s^2

// Archetype IDs (must match `LpsArchetypeId` in lps-std-schemas.ts)
const ARCH_PIPE_GAS: i32 = 1;
const ARCH_PIPE_LIQUID: i32 = 2;
const ARCH_COMPRESSOR_CENTRIFUGAL: i32 = 10;
const ARCH_COMPRESSOR_RECIP: i32 = 11;
const ARCH_PUMP_CENTRIFUGAL: i32 = 12;
const ARCH_REGULATOR_PRESSURE: i32 = 20;
const ARCH_VALVE_CONTROL: i32 = 21;
const ARCH_VALVE_CHECK: i32 = 22;
const ARCH_VALVE_BLOCK: i32 = 23;
const ARCH_HEATER_GAS: i32 = 30;
const ARCH_COOLER_GAS: i32 = 31;
const ARCH_TANK_STORAGE: i32 = 40;
const ARCH_SURGE_VESSEL: i32 = 41;
const ARCH_SUPPLY_NODE: i32 = 50;
const ARCH_DELIVERY_NODE: i32 = 51;
const ARCH_EOS_AGA8: i32 = 60;
const ARCH_EOS_GERG2008: i32 = 61;
const ARCH_EOS_PENG_ROBINSON: i32 = 62;
const ARCH_LIQUID_CRUDE: i32 = 70;
const ARCH_LIQUID_DIESEL: i32 = 71;
const ARCH_LIQUID_GASOLINE: i32 = 72;
const ARCH_LIQUID_WATER: i32 = 73;

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
 * Darcy-Weisbach friction factor via laminar 64/Re or Swamee-Jain explicit turbulent formula.
 */
@inline
function darcyFrictionFactor(re: f64, roughnessM: f64, diameterM: f64): f64 {
  const reAbs = Math.abs(re);
  if (reAbs < 1e-3) return 0.02;
  if (reAbs < 2300.0) return clamp(64.0 / reAbs, 0.005, 1.0);
  const relRough = Math.max(0.0, roughnessM) / Math.max(1e-4, diameterM);
  const arg = relRough / 3.7 + 5.74 / Math.pow(reAbs, 0.9);
  const denom = Math.log10(Math.max(1e-12, arg));
  return clamp(0.25 / (denom * denom), 0.005, 0.2);
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function lpsGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes model states for steady-state hydraulic/thermodynamic evaluation.
 * Returns the number of active states for the archetype.
 */
export function lpsModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  const pin = getIo(slotPtr, 0) > 1e3 ? getIo(slotPtr, 0) : 5.0e6;
  const tin = getIo(slotPtr, 1) > 100.0 ? getIo(slotPtr, 1) : 288.15;

  setState(slotPtr, 0, pin);
  setState(slotPtr, 1, tin);
  setState(slotPtr, 2, getIo(slotPtr, 2));
  setDState(slotPtr, 0, 0.0);
  setDState(slotPtr, 1, 0.0);

  if (archetypeId == ARCH_TANK_STORAGE) {
    const level = getCon(slotPtr, conCount, 1, 12.0);
    setState(slotPtr, 3, level);
    return 4;
  }
  if (archetypeId == ARCH_SURGE_VESSEL) {
    const vGas = getCon(slotPtr, conCount, 1, 12.0);
    const pPre = getCon(slotPtr, conCount, 2, 3.5e6);
    setState(slotPtr, 3, vGas);
    setState(slotPtr, 4, pPre);
    return 5;
  }
  return 3;
}

/**
 * Evaluates cleanroom hydraulic or thermodynamic equations for the specified LPS archetype.
 * Populates `IO[4..15]` in-place and returns 0 on success.
 */
export function lpsModelEval(archetypeId: i32, _t: f64, _dt: f64, slotPtr: usize, conCount: i32): i32 {
  const pin = getIo(slotPtr, 0) > 1e3 ? getIo(slotPtr, 0) : 5.0e6;
  const tin = getIo(slotPtr, 1) > 100.0 ? getIo(slotPtr, 1) : 288.15;
  const mDot = getIo(slotPtr, 2);
  const deltaVIn = getIo(slotPtr, 3);
  const openingIn = getIo(slotPtr, 15);

  // ── 1. Compressible Gas Pipe (Weymouth / Darcy-Weisbach) ───────────────────────────────────
  if (archetypeId == ARCH_PIPE_GAS) {
    const length = Math.max(1.0, getCon(slotPtr, conCount, 0, 10000.0));
    const diameter = Math.max(0.01, getCon(slotPtr, conCount, 1, 0.5));
    const roughness = Math.max(1e-7, getCon(slotPtr, conCount, 2, 4.5e-5));
    const dz = getCon(slotPtr, conCount, 3, 0.0);
    const molarMass = Math.max(2.0, getCon(slotPtr, conCount, 4, 17.4));
    const zParam = getCon(slotPtr, conCount, 5, 0.0);
    const eff = clamp(getCon(slotPtr, conCount, 6, 0.95), 0.1, 1.0);
    const visc = Math.max(1e-7, getCon(slotPtr, conCount, 7, 1.15e-5));

    const z = zParam > 0.05 ? zParam : evalAga8CompressibilityZ(pin * 1e-6, tin, molarMass / 28.9647, 0.01, 0.015, 0.0);
    const rSpec = R_UNIVERSAL / molarMass;
    const rho = (pin * molarMass) / (z * R_UNIVERSAL * tin);
    const area = 0.25 * Math.PI * diameter * diameter;
    const vel = mDot / (Math.max(1e-6, rho) * area);
    const re = (Math.max(1e-6, rho) * Math.abs(vel) * diameter) / visc;
    const f = darcyFrictionFactor(re, roughness, diameter);

    // Steady-state compressible momentum balance: Pin^2 - Pout^2 = f*L*m*|m|*Z*R_spec*T / (D*A^2*eff^2)
    const fricP2 = (f * length * mDot * Math.abs(mDot) * z * rSpec * tin) / (diameter * area * area * eff * eff);
    const elevP2 = 2.0 * pin * pin * ((GRAVITY * dz) / (z * rSpec * tin));
    const pout2 = Math.max(0.0, pin * pin - fricP2 - elevP2);
    const pout = Math.sqrt(pout2);
    const dp = pin - pout;
    const aGas = Math.sqrt(1.3 * z * rSpec * tin);

    setIo(slotPtr, 4, pout);
    setIo(slotPtr, 5, tin);
    setIo(slotPtr, 6, dp);
    setIo(slotPtr, 7, 0.0);
    setIo(slotPtr, 8, dp / (Math.max(1e-6, rho) * GRAVITY));
    setIo(slotPtr, 9, z);
    setIo(slotPtr, 10, rho);
    setIo(slotPtr, 11, vel);
    setIo(slotPtr, 12, rho * aGas * Math.abs(deltaVIn != 0.0 ? deltaVIn : vel));
    setIo(slotPtr, 13, aGas);
    setIo(slotPtr, 14, pout / pin);
    setState(slotPtr, 0, pout);
    return 0;
  }

  // ── 2. Liquid Pipe (Darcy-Weisbach + Korteweg-Moens + Joukowsky Water-Hammer Surge) ────────
  if (archetypeId == ARCH_PIPE_LIQUID) {
    const length = Math.max(1.0, getCon(slotPtr, conCount, 0, 10000.0));
    const diameter = Math.max(0.01, getCon(slotPtr, conCount, 1, 0.5));
    const roughness = Math.max(1e-7, getCon(slotPtr, conCount, 2, 4.5e-5));
    const wallThick = Math.max(0.001, getCon(slotPtr, conCount, 3, 0.012));
    const dz = getCon(slotPtr, conCount, 4, 0.0);
    const rho = Math.max(100.0, getCon(slotPtr, conCount, 5, 850.0));
    const visc = Math.max(1e-6, getCon(slotPtr, conCount, 6, 0.005));
    const bulkMod = Math.max(1e7, getCon(slotPtr, conCount, 7, 1.5e9));
    const elasticMod = Math.max(1e9, getCon(slotPtr, conCount, 8, 2.07e11));

    const area = 0.25 * Math.PI * diameter * diameter;
    const vel = mDot / (rho * area);
    const re = (rho * Math.abs(vel) * diameter) / visc;
    const f = darcyFrictionFactor(re, roughness, diameter);

    const dpFric = f * (length / diameter) * 0.5 * rho * vel * Math.abs(vel);
    const dpElev = rho * GRAVITY * dz;
    const dp = dpFric + dpElev;
    const pout = Math.max(0.0, pin - dp);

    // Korteweg-Moens acoustic wave speed a = sqrt((K / rho) / (1 + (K/E)*(D/e)))
    const waveSpeed = Math.sqrt(bulkMod / rho / (1.0 + (bulkMod / elasticMod) * (diameter / wallThick)));
    // Joukowsky water-hammer surge: DeltaP = rho * a * |Delta v|
    const dvEff = deltaVIn != 0.0 ? Math.abs(deltaVIn) : Math.abs(vel);
    const surgeDp = rho * waveSpeed * dvEff;

    setIo(slotPtr, 4, pout);
    setIo(slotPtr, 5, tin);
    setIo(slotPtr, 6, dp);
    setIo(slotPtr, 7, 0.0);
    setIo(slotPtr, 8, dp / (rho * GRAVITY));
    setIo(slotPtr, 9, 1.0);
    setIo(slotPtr, 10, rho);
    setIo(slotPtr, 11, vel);
    setIo(slotPtr, 12, surgeDp);
    setIo(slotPtr, 13, waveSpeed);
    setIo(slotPtr, 14, pout / pin);
    setState(slotPtr, 0, pout);
    return 0;
  }

  // ── 3. Centrifugal & Reciprocating Gas Compressors (Polytropic Head & Shaft Power) ─────────
  if (archetypeId == ARCH_COMPRESSOR_CENTRIFUGAL || archetypeId == ARCH_COMPRESSOR_RECIP) {
    const rTarget = Math.max(1.0, getCon(slotPtr, conCount, 0, archetypeId == ARCH_COMPRESSOR_RECIP ? 1.8 : 1.5));
    const etaP = clamp(getCon(slotPtr, conCount, 1, archetypeId == ARCH_COMPRESSOR_RECIP ? 0.88 : 0.82), 0.2, 0.99);
    const gamma = clamp(getCon(slotPtr, conCount, 2, 1.3), 1.05, 1.67);
    const molarMass = Math.max(2.0, getCon(slotPtr, conCount, 3, 17.4));
    const maxPowerW = Math.max(1e3, getCon(slotPtr, conCount, 4, 2.5e7));
    const maxRatio = archetypeId == ARCH_COMPRESSOR_CENTRIFUGAL ? Math.max(1.0, getCon(slotPtr, conCount, 5, 2.2)) : 4.0;
    const zParam = getCon(slotPtr, conCount, 6, 0.88);

    const ratio = Math.min(rTarget, maxRatio);
    const z = zParam > 0.05 ? zParam : evalAga8CompressibilityZ(pin * 1e-6, tin, molarMass / 28.9647, 0.01, 0.015, 0.0);
    const rSpec = R_UNIVERSAL / molarMass;

    // Polytropic exponent: (n - 1) / n = (gamma - 1) / (gamma * etaP)
    const expN = (gamma - 1.0) / (gamma * etaP);
    const rPow = Math.pow(ratio, expN);
    const polyHeadJKg = (z * rSpec * tin * (rPow - 1.0)) / expN;
    const headM = polyHeadJKg / GRAVITY;
    const rawPowerW = (Math.max(0.0, mDot) * polyHeadJKg) / etaP;
    const shaftPowerW = Math.min(rawPowerW, maxPowerW);
    const pout = pin * ratio;
    const tout = tin * rPow;
    const rhoOut = (pout * molarMass) / (z * R_UNIVERSAL * tout);

    setIo(slotPtr, 4, pout);
    setIo(slotPtr, 5, tout);
    setIo(slotPtr, 6, pout - pin);
    setIo(slotPtr, 7, shaftPowerW);
    setIo(slotPtr, 8, headM);
    setIo(slotPtr, 9, z);
    setIo(slotPtr, 10, rhoOut);
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, 0.0);
    setIo(slotPtr, 13, Math.sqrt(gamma * z * rSpec * tout));
    setIo(slotPtr, 14, ratio);
    return 0;
  }

  // ── 4. Centrifugal Liquid Booster Pump ─────────────────────────────────────────────────────
  if (archetypeId == ARCH_PUMP_CENTRIFUGAL) {
    const hRated = Math.max(1.0, getCon(slotPtr, conCount, 0, 120.0));
    const qRated = Math.max(1e-4, getCon(slotPtr, conCount, 1, 0.5));
    const eta = clamp(getCon(slotPtr, conCount, 2, 0.8), 0.1, 0.98);
    const rho = Math.max(100.0, getCon(slotPtr, conCount, 3, 850.0));
    const shutoffRatio = Math.max(1.0, getCon(slotPtr, conCount, 4, 1.25));
    const speedRatio = Math.max(0.0, getCon(slotPtr, conCount, 5, 1.0));

    const qVol = Math.max(0.0, mDot) / rho;
    const hShutoff = hRated * shutoffRatio * speedRatio * speedRatio;
    const qEff = qRated * Math.max(0.05, speedRatio);
    const qNorm = qVol / qEff;
    const headM = Math.max(0.0, hShutoff - (hShutoff - hRated * speedRatio * speedRatio) * qNorm * qNorm);
    const dp = rho * GRAVITY * headM;
    const pout = pin + dp;
    const powerW = (rho * GRAVITY * qVol * headM) / eta;

    setIo(slotPtr, 4, pout);
    setIo(slotPtr, 5, tin);
    setIo(slotPtr, 6, dp);
    setIo(slotPtr, 7, powerW);
    setIo(slotPtr, 8, headM);
    setIo(slotPtr, 9, 1.0);
    setIo(slotPtr, 10, rho);
    setIo(slotPtr, 14, pout / pin);
    return 0;
  }

  // ── 5. Pressure Regulator (Downstream Pressure Clamping + Joule-Thomson Cooling) ───────────
  if (archetypeId == ARCH_REGULATOR_PRESSURE) {
    const pSet = Math.max(1e4, getCon(slotPtr, conCount, 0, 4.0e6));
    const jtCoeff = getCon(slotPtr, conCount, 2, 4.5e-6);

    // Regulator clamps outlet pressure to setpoint (cannot boost pressure above inlet)
    const pout = pin > pSet ? pSet : pin;
    const dp = pin - pout;
    const tout = Math.max(150.0, tin - jtCoeff * dp);

    setIo(slotPtr, 4, pout);
    setIo(slotPtr, 5, tout);
    setIo(slotPtr, 6, dp);
    setIo(slotPtr, 7, 0.0);
    setIo(slotPtr, 14, pout / pin);
    return 0;
  }

  // ── 6. Control, Check & Block Valves (ISA Cv) ──────────────────────────────────────────────
  if (archetypeId == ARCH_VALVE_CONTROL || archetypeId == ARCH_VALVE_CHECK || archetypeId == ARCH_VALVE_BLOCK) {
    const cv = Math.max(1.0, getCon(slotPtr, conCount, 0, 1200.0));
    let opening = openingIn > 0.0 ? clamp(openingIn, 0.0, 1.0) : clamp(getCon(slotPtr, conCount, 1, 1.0), 0.0, 1.0);
    const rho = Math.max(1.0, getCon(slotPtr, conCount, 2, 50.0));

    if (archetypeId == ARCH_VALVE_CHECK) {
      opening = mDot >= 0.0 ? 1.0 : 0.0;
    }

    if (opening <= 1e-6) {
      setIo(slotPtr, 4, 0.0);
      setIo(slotPtr, 5, tin);
      setIo(slotPtr, 6, pin);
      setIo(slotPtr, 14, 0.0);
      setIo(slotPtr, 15, 0.0);
      return 0;
    }

    // Kv (m3/h at 1 bar) ~= 0.865 * Cv; SI flow coeff C_si = Kv / 3600 / sqrt(1e5 / 1000)
    const kv = 0.865 * cv * opening;
    const cSi = kv / 3600.0 / 10.0;
    const qVol = mDot / rho;
    const dp = (rho * qVol * Math.abs(qVol)) / (cSi * cSi * 1000.0);
    const pout = Math.max(0.0, pin - dp);

    setIo(slotPtr, 4, pout);
    setIo(slotPtr, 5, tin);
    setIo(slotPtr, 6, dp);
    setIo(slotPtr, 10, rho);
    setIo(slotPtr, 14, pout / pin);
    setIo(slotPtr, 15, opening);
    return 0;
  }

  // ── 7. Gas Heater & Aftercooler ────────────────────────────────────────────────────────────
  if (archetypeId == ARCH_HEATER_GAS || archetypeId == ARCH_COOLER_GAS) {
    const tTarget = Math.max(200.0, getCon(slotPtr, conCount, 0, archetypeId == ARCH_HEATER_GAS ? 313.15 : 308.15));
    const cp = Math.max(500.0, getCon(slotPtr, conCount, 1, 2200.0));
    const dp = Math.max(0.0, getCon(slotPtr, conCount, 2, 20000.0));

    const pout = Math.max(0.0, pin - dp);
    const dutyW = mDot * cp * (tTarget - tin);

    setIo(slotPtr, 4, pout);
    setIo(slotPtr, 5, tTarget);
    setIo(slotPtr, 6, dp);
    setIo(slotPtr, 7, dutyW);
    setIo(slotPtr, 14, pout / pin);
    return 0;
  }

  // ── 8. Storage Tank & Gas-Cushioned Surge Vessel ───────────────────────────────────────────
  if (archetypeId == ARCH_TANK_STORAGE) {
    const level = Math.max(0.0, getCon(slotPtr, conCount, 1, 12.0));
    const rho = Math.max(100.0, getCon(slotPtr, conCount, 3, 850.0));
    const pHead = Math.max(0.0, getCon(slotPtr, conCount, 4, 101325.0));
    const pout = pHead + rho * GRAVITY * level;

    setIo(slotPtr, 4, pout);
    setIo(slotPtr, 5, tin);
    setIo(slotPtr, 6, pout - pHead);
    setIo(slotPtr, 8, level);
    setIo(slotPtr, 10, rho);
    return 0;
  }

  if (archetypeId == ARCH_SURGE_VESSEL) {
    const vGas0 = Math.max(0.1, getCon(slotPtr, conCount, 1, 12.0));
    const pPre = Math.max(1e5, getCon(slotPtr, conCount, 2, 3.5e6));
    const nPoly = clamp(getCon(slotPtr, conCount, 3, 1.2), 1.0, 1.6);
    const vGasCur = Math.max(0.05 * vGas0, getState(slotPtr, 3));
    const pCushion = pPre * Math.pow(vGas0 / vGasCur, nPoly);

    setIo(slotPtr, 4, pCushion);
    setIo(slotPtr, 5, tin);
    setIo(slotPtr, 6, pin - pCushion);
    setIo(slotPtr, 14, pCushion / pin);
    return 0;
  }

  // ── 9. Supply & Delivery Boundary Nodes ────────────────────────────────────────────────────
  if (archetypeId == ARCH_SUPPLY_NODE) {
    const pSet = Math.max(1e4, getCon(slotPtr, conCount, 0, 7.0e6));
    const tSet = Math.max(150.0, getCon(slotPtr, conCount, 1, 288.15));
    setIo(slotPtr, 4, pSet);
    setIo(slotPtr, 5, tSet);
    setIo(slotPtr, 6, 0.0);
    setIo(slotPtr, 14, 1.0);
    return 0;
  }

  if (archetypeId == ARCH_DELIVERY_NODE) {
    const pMin = Math.max(1e4, getCon(slotPtr, conCount, 0, 3.0e6));
    const pout = Math.max(pin, pMin);
    setIo(slotPtr, 4, pout);
    setIo(slotPtr, 5, tin);
    setIo(slotPtr, 6, pin - pout);
    setIo(slotPtr, 14, pout / pin);
    return 0;
  }

  // ── 10. Gas Equations of State (AGA-8 / GERG-2008 / Peng-Robinson) ─────────────────────────
  if (archetypeId == ARCH_EOS_AGA8 || archetypeId == ARCH_EOS_GERG2008 || archetypeId == ARCH_EOS_PENG_ROBINSON) {
    const molarMass = Math.max(2.0, getCon(slotPtr, conCount, 0, 17.4));
    const pCrit = Math.max(1e5, getCon(slotPtr, conCount, 1, 4.64e6));
    const tCrit = Math.max(50.0, getCon(slotPtr, conCount, 2, 205.0));
    let z: f64 = 1.0;
    let gamma: f64 = 1.3;
    let effMolarMass = molarMass;

    const sg = molarMass / 28.9647;
    if (archetypeId == ARCH_EOS_PENG_ROBINSON) {
      const omega = getCon(slotPtr, conCount, 3, 0.0115);
      gamma = clamp(getCon(slotPtr, conCount, 4, 1.31), 1.05, 1.67);
      z = clamp(evalPengRobinsonZ(tin, pin, tCrit, pCrit, omega), 0.15, 2.5);
    } else if (archetypeId == ARCH_EOS_GERG2008) {
      const h2Frac = clamp(getCon(slotPtr, conCount, 3, 0.0), 0.0, 1.0);
      gamma = clamp(getCon(slotPtr, conCount, 4, 1.31), 1.05, 1.67);
      effMolarMass = molarMass * (1.0 - h2Frac) + 2.016 * h2Frac;
      z = evalAga8CompressibilityZ(pin * 1e-6, tin, sg, 0.01, 0.015, h2Frac);
    } else {
      gamma = clamp(getCon(slotPtr, conCount, 3, 1.3), 1.05, 1.67);
      const xCo2 = clamp(getCon(slotPtr, conCount, 4, 0.01), 0.0, 0.5);
      const xN2 = clamp(getCon(slotPtr, conCount, 5, 0.015), 0.0, 0.5);
      const xH2 = clamp(getCon(slotPtr, conCount, 6, 0.0), 0.0, 1.0);
      z = evalAga8CompressibilityZ(pin * 1e-6, tin, sg, xCo2, xN2, xH2);
    }

    const rSpec = R_UNIVERSAL / effMolarMass;
    const rho = (pin * effMolarMass) / (z * R_UNIVERSAL * tin);
    const waveSpeed = Math.sqrt(gamma * z * rSpec * tin);

    setIo(slotPtr, 4, pin);
    setIo(slotPtr, 5, tin);
    setIo(slotPtr, 6, 0.0);
    setIo(slotPtr, 9, z);
    setIo(slotPtr, 10, rho);
    setIo(slotPtr, 13, waveSpeed);
    setIo(slotPtr, 14, 1.0);
    return 0;
  }

  // ── 11. Liquid Fluid Property Standards (Crude / Diesel / Gasoline / Water) ────────────────
  if (
    archetypeId == ARCH_LIQUID_CRUDE ||
    archetypeId == ARCH_LIQUID_DIESEL ||
    archetypeId == ARCH_LIQUID_GASOLINE ||
    archetypeId == ARCH_LIQUID_WATER
  ) {
    const rho0 = Math.max(400.0, getCon(slotPtr, conCount, 0, 860.0));
    const bulkMod = Math.max(1e8, getCon(slotPtr, conCount, 1, 1.5e9));
    const beta = Math.max(0.0, getCon(slotPtr, conCount, 2, 7.8e-4));

    const rho = Math.max(300.0, rho0 * (1.0 - beta * (tin - 288.15) + (pin - 101325.0) / bulkMod));
    const waveSpeed = Math.sqrt(bulkMod / rho);

    setIo(slotPtr, 4, pin);
    setIo(slotPtr, 5, tin);
    setIo(slotPtr, 6, 0.0);
    setIo(slotPtr, 9, 1.0);
    setIo(slotPtr, 10, rho);
    setIo(slotPtr, 13, waveSpeed);
    setIo(slotPtr, 14, 1.0);
    return 0;
  }

  return -1;
}
