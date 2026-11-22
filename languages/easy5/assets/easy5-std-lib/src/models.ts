// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript dynamic model runtime for `@modelscript/easy5-std-lib`.
 *
 * Uses a zero-GC 2048-byte aligned slot ABI matching `@modelscript/pslf-std-lib`:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — Easy5 parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — component I/O bus:
 *       IO[0] = u0 (primary input / P_in / altitude_m / V_in)
 *       IO[1] = u1 (secondary input / P_out / loadTorque / T_in)
 *       IO[2] = u2 (tertiary input / valveOpening / ctrl / T_up)
 *       IO[3] = u3 (fourth input / ambientTemp / refSignal)
 *       IO[4] = y0 (primary output / state / flowRate Q / massFlow / density rho / current)
 *       IO[5] = y1 (secondary output / pressure P / dP / torque / chokedFlag)
 *       IO[6] = y2 (tertiary output / temperature T / angularSpeed / lift)
 *       IO[7] = y3 (fourth output / speedOfSound a / drag / power)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `Easy5ArchetypeId` in easy5-std-schemas.ts)
const ARCH_GP_INTEGRATOR: i32 = 1;
const ARCH_GP_LAG: i32 = 2;
const ARCH_GP_LEAD_LAG: i32 = 3;
const ARCH_GP_GAIN: i32 = 4;
const ARCH_GP_SUMMER: i32 = 5;
const ARCH_GP_MULTIPLY: i32 = 6;
const ARCH_GP_DIVIDE: i32 = 7;
const ARCH_GP_TRANSFER_FN: i32 = 8;
const ARCH_GP_PID: i32 = 9;
const ARCH_GP_SWITCH: i32 = 10;
const ARCH_GP_LIMITER: i32 = 11;
const ARCH_GP_DEADBAND: i32 = 12;
const ARCH_GP_TABLE: i32 = 13;
const ARCH_GP_ANALYTIC_FN: i32 = 14;
const ARCH_GP_FUNC_GEN: i32 = 15;
const ARCH_GP_STEP: i32 = 16;
const ARCH_GP_SINE: i32 = 17;

const ARCH_HC_ORIFICE: i32 = 20;
const ARCH_HC_PIPE: i32 = 21;
const ARCH_HC_ACCUMULATOR: i32 = 22;
const ARCH_HC_PUMP: i32 = 23;
const ARCH_HC_VALVE: i32 = 24;
const ARCH_HC_CHECK_VALVE: i32 = 25;
const ARCH_HC_RELIEF_VALVE: i32 = 26;
const ARCH_HC_CAVITY: i32 = 27;

const ARCH_GD_VOLUME: i32 = 30;
const ARCH_GD_ORIFICE: i32 = 31;
const ARCH_GD_VALVE: i32 = 32;
const ARCH_GD_CHAMBER: i32 = 33;
const ARCH_GD_NOZZLE: i32 = 34;
const ARCH_GD_HEAT_EXCHANGER: i32 = 35;

const ARCH_EC_RESISTOR: i32 = 40;
const ARCH_EC_CAPACITOR: i32 = 41;
const ARCH_EC_INDUCTOR: i32 = 42;
const ARCH_EC_VOLTAGE_SOURCE: i32 = 43;
const ARCH_EC_DC_MOTOR: i32 = 44;
const ARCH_EC_INDUCTION_MOTOR: i32 = 45;
const ARCH_EC_INVERTER: i32 = 46;

const ARCH_AE_ATMOSPHERE: i32 = 50;
const ARCH_AE_RIGID_BODY: i32 = 51;
const ARCH_AE_AERODYNAMICS: i32 = 52;
const ARCH_AE_ENGINE: i32 = 53;
const ARCH_AE_ACTUATOR: i32 = 54;

const ARCH_VC_EVAPORATOR: i32 = 60;
const ARCH_VC_CONDENSER: i32 = 61;
const ARCH_VC_TXV: i32 = 62;
const ARCH_VC_COMPRESSOR: i32 = 63;

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
 * Helper for turbulent hydraulic orifice flow:
 * Q = Cd * A * sign(dP) * sqrt(2 * |dP| / rho) with optional laminar regularization below dpLin.
 */
@inline
function evalHydraulicOrificeFlow(cd: f64, area: f64, rho: f64, dP: f64, dpLin: f64): f64 {
  const safeRho = rho > 1.0 ? rho : 850.0;
  const absDp = Math.abs(dP);
  const sign: f64 = dP >= 0.0 ? 1.0 : -1.0;
  if (dpLin > 0.0 && absDp < dpLin) {
    const qLin = cd * area * Math.sqrt((2.0 * dpLin) / safeRho);
    return sign * qLin * (absDp / dpLin);
  }
  return sign * cd * area * Math.sqrt((2.0 * absDp) / safeRho);
}

/**
 * Helper for isentropic compressible gas orifice/nozzle mass flow (choked + subsonic).
 */
function evalCompressibleGasFlow(
  cd: f64,
  area: f64,
  gamma: f64,
  rGas: f64,
  pIn: f64,
  pOut: f64,
  tUp: f64,
): f64 {
  const g = gamma > 1.05 ? gamma : 1.4;
  const rg = rGas > 10.0 ? rGas : 287.05;
  const t = tUp > 10.0 ? tUp : 300.0;
  const dir: f64 = pIn >= pOut ? 1.0 : -1.0;
  const pUp = dir > 0.0 ? pIn : pOut;
  const pDn = dir > 0.0 ? pOut : pIn;
  if (pUp <= 1e-6 || area <= 0.0) return 0.0;

  const pr = clamp(pDn / pUp, 0.0, 1.0);
  const prCrit = Math.pow(2.0 / (g + 1.0), g / (g - 1.0));
  let psi: f64 = 0.0;
  if (pr <= prCrit) {
    psi = Math.sqrt(g) * Math.pow(2.0 / (g + 1.0), (g + 1.0) / (2.0 * (g - 1.0)));
  } else {
    const term = Math.pow(pr, 2.0 / g) - Math.pow(pr, (g + 1.0) / g);
    psi = term > 0.0 ? Math.sqrt(((2.0 * g) / (g - 1.0)) * term) : 0.0;
  }
  return dir * cd * area * (pUp / Math.sqrt(rg * t)) * psi;
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function easy5GetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

function getStateCount(archetypeId: i32): i32 {
  if (
    archetypeId == ARCH_GP_INTEGRATOR ||
    archetypeId == ARCH_GP_LAG ||
    archetypeId == ARCH_GP_LEAD_LAG ||
    archetypeId == ARCH_HC_PIPE ||
    archetypeId == ARCH_HC_ACCUMULATOR ||
    archetypeId == ARCH_HC_VALVE ||
    archetypeId == ARCH_HC_CAVITY ||
    archetypeId == ARCH_GD_HEAT_EXCHANGER ||
    archetypeId == ARCH_EC_CAPACITOR ||
    archetypeId == ARCH_EC_INDUCTOR ||
    archetypeId == ARCH_EC_INDUCTION_MOTOR ||
    archetypeId == ARCH_EC_INVERTER ||
    archetypeId == ARCH_AE_ENGINE ||
    archetypeId == ARCH_AE_ACTUATOR ||
    archetypeId == ARCH_VC_EVAPORATOR ||
    archetypeId == ARCH_VC_CONDENSER
  ) {
    return 1;
  }
  if (
    archetypeId == ARCH_GP_TRANSFER_FN ||
    archetypeId == ARCH_GP_PID ||
    archetypeId == ARCH_GD_VOLUME ||
    archetypeId == ARCH_GD_CHAMBER ||
    archetypeId == ARCH_EC_DC_MOTOR ||
    archetypeId == ARCH_AE_RIGID_BODY
  ) {
    return 2;
  }
  return 0;
}

/**
 * Initializes model states and evaluates initial outputs.
 * Returns the number of active dynamic states for the archetype.
 */
export function easy5ModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  for (let i = 0; i < 4; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }

  if (archetypeId == ARCH_GP_INTEGRATOR) {
    const s0 = getCon(slotPtr, conCount, 1, 0.0);
    const ul = getCon(slotPtr, conCount, 2, 1e9);
    const ll = getCon(slotPtr, conCount, 3, -1e9);
    const x0 = clamp(s0, ll, ul);
    setState(slotPtr, 0, x0);
    setIo(slotPtr, 4, x0);
    return 1;
  }
  if (archetypeId == ARCH_GP_LAG) {
    const s0 = getCon(slotPtr, conCount, 2, 0.0);
    setState(slotPtr, 0, s0);
    setIo(slotPtr, 4, s0);
    return 1;
  }
  if (archetypeId == ARCH_GP_LEAD_LAG) {
    const s0 = getCon(slotPtr, conCount, 3, 0.0);
    setState(slotPtr, 0, s0);
    setIo(slotPtr, 4, s0);
    return 1;
  }
  if (archetypeId == ARCH_GP_TRANSFER_FN) {
    const x0 = getCon(slotPtr, conCount, 3, 0.0);
    setState(slotPtr, 0, x0);
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 4, x0);
    return 2;
  }
  if (archetypeId == ARCH_GP_PID) {
    setState(slotPtr, 0, 0.0);
    setState(slotPtr, 1, getIo(slotPtr, 0));
    easy5ModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
    return 2;
  }
  if (archetypeId == ARCH_HC_ACCUMULATOR) {
    const p0 = getCon(slotPtr, conCount, 2, 1e7);
    setState(slotPtr, 0, p0);
    setIo(slotPtr, 4, p0);
    return 1;
  }
  if (archetypeId == ARCH_HC_CAVITY) {
    const p0 = getCon(slotPtr, conCount, 2, 1e6);
    setState(slotPtr, 0, p0);
    setIo(slotPtr, 4, p0);
    return 1;
  }
  if (archetypeId == ARCH_HC_VALVE) {
    const x0 = clamp(getIo(slotPtr, 2), 0.0, 1.0);
    setState(slotPtr, 0, x0);
    easy5ModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
    return 1;
  }
  if (archetypeId == ARCH_GD_VOLUME || archetypeId == ARCH_GD_CHAMBER) {
    const p0 = getCon(slotPtr, conCount, 3, 101325.0);
    const t0 = getCon(slotPtr, conCount, 4, 293.15);
    setState(slotPtr, 0, p0);
    setState(slotPtr, 1, t0);
    setIo(slotPtr, 4, p0);
    setIo(slotPtr, 6, t0);
    return 2;
  }
  if (archetypeId == ARCH_GD_HEAT_EXCHANGER) {
    const t0 = getCon(slotPtr, conCount, 2, 300.0);
    setState(slotPtr, 0, t0);
    setIo(slotPtr, 4, t0);
    return 1;
  }
  if (archetypeId == ARCH_EC_CAPACITOR) {
    const v0 = getCon(slotPtr, conCount, 1, 0.0);
    setState(slotPtr, 0, v0);
    setIo(slotPtr, 4, v0);
    return 1;
  }
  if (archetypeId == ARCH_EC_INDUCTOR) {
    const i0 = getCon(slotPtr, conCount, 2, 0.0);
    setState(slotPtr, 0, i0);
    setIo(slotPtr, 4, i0);
    return 1;
  }
  if (archetypeId == ARCH_AE_RIGID_BODY) {
    const v0 = getCon(slotPtr, conCount, 2, 0.0);
    const x0 = getCon(slotPtr, conCount, 3, 0.0);
    setState(slotPtr, 0, x0);
    setState(slotPtr, 1, v0);
    setIo(slotPtr, 4, x0);
    setIo(slotPtr, 5, v0);
    return 2;
  }
  if (archetypeId == ARCH_AE_ENGINE) {
    const tInit = getCon(slotPtr, conCount, 3, 0.0);
    setState(slotPtr, 0, tInit);
    setIo(slotPtr, 4, tInit);
    return 1;
  }
  if (archetypeId == ARCH_VC_EVAPORATOR) {
    const tSat = getCon(slotPtr, conCount, 2, 275.0);
    setState(slotPtr, 0, tSat);
    setIo(slotPtr, 4, tSat);
    return 1;
  }
  if (archetypeId == ARCH_VC_CONDENSER) {
    const t0 = getCon(slotPtr, conCount, 3, 318.15);
    setState(slotPtr, 0, t0);
    setIo(slotPtr, 4, t0);
    return 1;
  }

  easy5ModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
  return getStateCount(archetypeId);
}

/**
 * Evaluates cleanroom continuous-time state derivatives `dstate/dt` and algebraic outputs.
 */
export function easy5ModelEvalDerivatives(
  archetypeId: i32,
  t: f64,
  _dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const u0 = getIo(slotPtr, 0);
  const u1 = getIo(slotPtr, 1);
  const u2 = getIo(slotPtr, 2);
  const u3 = getIo(slotPtr, 3);

  // --- GP Library ---
  if (archetypeId == ARCH_GP_INTEGRATOR) {
    const gain = getCon(slotPtr, conCount, 0, 1.0);
    const ul = getCon(slotPtr, conCount, 2, 1e9);
    const ll = getCon(slotPtr, conCount, 3, -1e9);
    const x = clamp(getState(slotPtr, 0), ll, ul);
    let dx = gain * u0;
    if ((x >= ul && dx > 0.0) || (x <= ll && dx < 0.0)) dx = 0.0;
    setDState(slotPtr, 0, dx);
    setIo(slotPtr, 4, x);
    return;
  }
  if (archetypeId == ARCH_GP_LAG) {
    const gain = getCon(slotPtr, conCount, 0, 1.0);
    const tau = Math.max(1e-6, getCon(slotPtr, conCount, 1, 1.0));
    const x = getState(slotPtr, 0);
    setDState(slotPtr, 0, (gain * u0 - x) / tau);
    setIo(slotPtr, 4, x);
    return;
  }
  if (archetypeId == ARCH_GP_LEAD_LAG) {
    const gain = getCon(slotPtr, conCount, 0, 1.0);
    const tau1 = getCon(slotPtr, conCount, 1, 0.5);
    const tau2 = Math.max(1e-6, getCon(slotPtr, conCount, 2, 1.0));
    const x = getState(slotPtr, 0);
    const dx = (gain * u0 - x) / tau2;
    setDState(slotPtr, 0, dx);
    setIo(slotPtr, 4, x + tau1 * dx);
    return;
  }
  if (archetypeId == ARCH_GP_GAIN) {
    const k = getCon(slotPtr, conCount, 0, 1.0);
    const bias = getCon(slotPtr, conCount, 1, 0.0);
    setIo(slotPtr, 4, k * u0 + bias);
    return;
  }
  if (archetypeId == ARCH_GP_SUMMER) {
    const k1 = getCon(slotPtr, conCount, 0, 1.0);
    const k2 = getCon(slotPtr, conCount, 1, 1.0);
    const k3 = getCon(slotPtr, conCount, 2, 0.0);
    const k4 = getCon(slotPtr, conCount, 3, 0.0);
    setIo(slotPtr, 4, k1 * u0 + k2 * u1 + k3 * u2 + k4 * u3);
    return;
  }
  if (archetypeId == ARCH_GP_MULTIPLY) {
    const k = getCon(slotPtr, conCount, 0, 1.0);
    setIo(slotPtr, 4, k * u0 * u1);
    return;
  }
  if (archetypeId == ARCH_GP_DIVIDE) {
    const k = getCon(slotPtr, conCount, 0, 1.0);
    const eps = Math.max(1e-12, getCon(slotPtr, conCount, 1, 1e-9));
    const denom = Math.abs(u1) >= eps ? u1 : u1 >= 0.0 ? eps : -eps;
    setIo(slotPtr, 4, (k * u0) / denom);
    return;
  }
  if (archetypeId == ARCH_GP_TRANSFER_FN) {
    const k = getCon(slotPtr, conCount, 0, 1.0);
    const wn = Math.max(1e-3, getCon(slotPtr, conCount, 1, 10.0));
    const zeta = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.707));
    const x1 = getState(slotPtr, 0);
    const x2 = getState(slotPtr, 1);
    setDState(slotPtr, 0, x2);
    setDState(slotPtr, 1, wn * wn * (k * u0 - x1) - 2.0 * zeta * wn * x2);
    setIo(slotPtr, 4, x1);
    setIo(slotPtr, 5, x2);
    return;
  }
  if (archetypeId == ARCH_GP_PID) {
    const kp = getCon(slotPtr, conCount, 0, 1.0);
    const ki = getCon(slotPtr, conCount, 1, 0.5);
    const kd = getCon(slotPtr, conCount, 2, 0.0);
    const tf = Math.max(1e-4, getCon(slotPtr, conCount, 3, 0.05));
    const ul = getCon(slotPtr, conCount, 4, 1e6);
    const ll = getCon(slotPtr, conCount, 5, -1e6);
    const xi = getState(slotPtr, 0);
    const xd = getState(slotPtr, 1);
    const dXd = (u0 - xd) / tf;
    const yRaw = kp * u0 + xi + kd * dXd;
    const y = clamp(yRaw, ll, ul);
    const dXi = y == yRaw ? ki * u0 : 0.0;
    setDState(slotPtr, 0, dXi);
    setDState(slotPtr, 1, dXd);
    setIo(slotPtr, 4, y);
    return;
  }
  if (archetypeId == ARCH_GP_SWITCH) {
    const thr = getCon(slotPtr, conCount, 0, 0.0);
    setIo(slotPtr, 4, u2 >= thr ? u0 : u1);
    return;
  }
  if (archetypeId == ARCH_GP_LIMITER) {
    const ul = getCon(slotPtr, conCount, 0, 1.0);
    const ll = getCon(slotPtr, conCount, 1, -1.0);
    setIo(slotPtr, 4, clamp(u0, ll, ul));
    return;
  }
  if (archetypeId == ARCH_GP_DEADBAND) {
    const dbp = getCon(slotPtr, conCount, 0, 0.1);
    const dbn = getCon(slotPtr, conCount, 1, -0.1);
    const slope = getCon(slotPtr, conCount, 2, 1.0);
    let y: f64 = 0.0;
    if (u0 > dbp) y = slope * (u0 - dbp);
    else if (u0 < dbn) y = slope * (u0 - dbn);
    setIo(slotPtr, 4, y);
    return;
  }
  if (archetypeId == ARCH_GP_TABLE) {
    const x0 = getCon(slotPtr, conCount, 0, 0.0);
    const x1 = getCon(slotPtr, conCount, 1, 1.0);
    const y0 = getCon(slotPtr, conCount, 2, 0.0);
    const y1 = getCon(slotPtr, conCount, 3, 1.0);
    const span = Math.abs(x1 - x0) > 1e-12 ? x1 - x0 : 1.0;
    const frac = clamp((u0 - x0) / span, 0.0, 1.0);
    setIo(slotPtr, 4, y0 + frac * (y1 - y0));
    return;
  }
  if (archetypeId == ARCH_GP_ANALYTIC_FN) {
    const c0 = getCon(slotPtr, conCount, 0, 0.0);
    const c1 = getCon(slotPtr, conCount, 1, 1.0);
    const c2 = getCon(slotPtr, conCount, 2, 0.0);
    const c3 = getCon(slotPtr, conCount, 3, 0.0);
    setIo(slotPtr, 4, c0 + u0 * (c1 + u0 * (c2 + u0 * c3)));
    return;
  }
  if (archetypeId == ARCH_GP_FUNC_GEN) {
    const t0 = getCon(slotPtr, conCount, 0, 0.0);
    const slope = getCon(slotPtr, conCount, 1, 1.0);
    const bias = getCon(slotPtr, conCount, 2, 0.0);
    const maxVal = getCon(slotPtr, conCount, 3, 1e9);
    const y = t >= t0 ? Math.min(maxVal, bias + slope * (t - t0)) : bias;
    setIo(slotPtr, 4, y);
    return;
  }
  if (archetypeId == ARCH_GP_STEP) {
    const tStep = getCon(slotPtr, conCount, 0, 0.0);
    const v0 = getCon(slotPtr, conCount, 1, 0.0);
    const v1 = getCon(slotPtr, conCount, 2, 1.0);
    setIo(slotPtr, 4, t >= tStep ? v1 : v0);
    return;
  }
  if (archetypeId == ARCH_GP_SINE) {
    const amp = getCon(slotPtr, conCount, 0, 1.0);
    const omega = getCon(slotPtr, conCount, 1, 6.283185307);
    const phase = getCon(slotPtr, conCount, 2, 0.0);
    const bias = getCon(slotPtr, conCount, 3, 0.0);
    setIo(slotPtr, 4, bias + amp * Math.sin(omega * t + phase));
    return;
  }

  // --- HC Thermal Hydraulic Library ---
  if (archetypeId == ARCH_HC_ORIFICE) {
    const cd = getCon(slotPtr, conCount, 0, 0.61);
    const area = getCon(slotPtr, conCount, 1, 1e-4);
    const rho = getCon(slotPtr, conCount, 2, 850.0);
    const dpLin = getCon(slotPtr, conCount, 3, 1e3);
    const dP = u0 - u1;
    const q = evalHydraulicOrificeFlow(cd, area, rho, dP, dpLin);
    setIo(slotPtr, 4, q);
    setIo(slotPtr, 5, dP);
    return;
  }
  if (archetypeId == ARCH_HC_PIPE) {
    const length = Math.max(0.01, getCon(slotPtr, conCount, 0, 2.0));
    const diam = Math.max(1e-3, getCon(slotPtr, conCount, 1, 0.02));
    const rho = Math.max(1.0, getCon(slotPtr, conCount, 2, 850.0));
    const rf = Math.max(1.0, getCon(slotPtr, conCount, 3, 1e7));
    const area = 0.25 * Math.PI * diam * diam;
    const inertance = (rho * length) / area;
    const q = getState(slotPtr, 0);
    const dP = u0 - u1;
    setDState(slotPtr, 0, (dP - rf * q) / inertance);
    setIo(slotPtr, 4, q);
    return;
  }
  if (archetypeId == ARCH_HC_ACCUMULATOR || archetypeId == ARCH_HC_CAVITY) {
    const vol = Math.max(1e-6, getCon(slotPtr, conCount, 0, 0.005));
    const beta = Math.max(1e5, getCon(slotPtr, conCount, 1, 1.4e9));
    const p = Math.max(0.0, getState(slotPtr, 0));
    setDState(slotPtr, 0, (beta / vol) * (u0 - u1));
    setIo(slotPtr, 4, p);
    return;
  }
  if (archetypeId == ARCH_HC_PUMP) {
    const disp = getCon(slotPtr, conCount, 0, 5e-6);
    const cLeak = getCon(slotPtr, conCount, 1, 1e-12);
    const etaM = Math.max(0.1, getCon(slotPtr, conCount, 2, 0.92));
    const omega = u0;
    const dP = Math.max(0.0, u1);
    const q = Math.max(0.0, disp * omega - cLeak * dP);
    const torque = (disp * dP) / etaM;
    setIo(slotPtr, 4, q);
    setIo(slotPtr, 5, torque);
    return;
  }
  if (archetypeId == ARCH_HC_VALVE) {
    const cd = getCon(slotPtr, conCount, 0, 0.62);
    const areaMax = getCon(slotPtr, conCount, 1, 2e-4);
    const rho = getCon(slotPtr, conCount, 2, 850.0);
    const tauV = Math.max(1e-4, getCon(slotPtr, conCount, 3, 0.02));
    const xCmd = clamp(u2, 0.0, 1.0);
    const x = clamp(getState(slotPtr, 0), 0.0, 1.0);
    setDState(slotPtr, 0, (xCmd - x) / tauV);
    const q = evalHydraulicOrificeFlow(cd, areaMax * x, rho, u0 - u1, 1e3);
    setIo(slotPtr, 4, q);
    setIo(slotPtr, 5, x);
    return;
  }
  if (archetypeId == ARCH_HC_CHECK_VALVE) {
    const cd = getCon(slotPtr, conCount, 0, 0.65);
    const area = getCon(slotPtr, conCount, 1, 1.5e-4);
    const rho = getCon(slotPtr, conCount, 2, 850.0);
    const pCrack = getCon(slotPtr, conCount, 3, 5e4);
    const dP = u0 - u1;
    const q = dP > pCrack ? evalHydraulicOrificeFlow(cd, area, rho, dP - pCrack, 1e2) : 0.0;
    setIo(slotPtr, 4, q);
    return;
  }
  if (archetypeId == ARCH_HC_RELIEF_VALVE) {
    const pSet = getCon(slotPtr, conCount, 0, 2e7);
    const pFull = Math.max(pSet + 1e4, getCon(slotPtr, conCount, 1, 2.2e7));
    const cd = getCon(slotPtr, conCount, 2, 0.65);
    const areaMax = getCon(slotPtr, conCount, 3, 2e-4);
    const rho = getCon(slotPtr, conCount, 4, 850.0);
    const dP = u0 - u1;
    const frac = clamp((dP - pSet) / (pFull - pSet), 0.0, 1.0);
    const q = frac > 0.0 ? evalHydraulicOrificeFlow(cd, areaMax * frac, rho, dP, 1e2) : 0.0;
    setIo(slotPtr, 4, q);
    setIo(slotPtr, 5, frac);
    return;
  }

  // --- GD Gas Dynamics Library ---
  if (archetypeId == ARCH_GD_VOLUME || archetypeId == ARCH_GD_CHAMBER) {
    const vol = Math.max(1e-5, getCon(slotPtr, conCount, 0, 0.05));
    const rGas = Math.max(10.0, getCon(slotPtr, conCount, 1, 287.05));
    const gamma = Math.max(1.05, getCon(slotPtr, conCount, 2, 1.4));
    const tauTh = archetypeId == ARCH_GD_CHAMBER ? Math.max(0.05, getCon(slotPtr, conCount, 5, 5.0)) : 10.0;
    const p = Math.max(1.0, getState(slotPtr, 0));
    const temp = Math.max(10.0, getState(slotPtr, 1));
    const tAmb = u3 > 10.0 ? u3 : 300.0;
    setDState(slotPtr, 0, ((gamma * rGas * temp) / vol) * (u0 - u1));
    setDState(slotPtr, 1, (tAmb - temp) / tauTh);
    setIo(slotPtr, 4, p);
    setIo(slotPtr, 6, temp);
    return;
  }
  if (archetypeId == ARCH_GD_ORIFICE || archetypeId == ARCH_GD_NOZZLE) {
    const cd = getCon(slotPtr, conCount, 0, 0.85);
    const area = getCon(slotPtr, conCount, 1, 1e-4);
    const gamma = getCon(slotPtr, conCount, 2, 1.4);
    const rGas = getCon(slotPtr, conCount, 3, 287.05);
    const tUp = u2 > 10.0 ? u2 : getCon(slotPtr, conCount, 4, 300.0);
    const mDot = evalCompressibleGasFlow(cd, area, gamma, rGas, u0, u1, tUp);
    const pUp = Math.max(u0, u1);
    const pDn = Math.min(u0, u1);
    const prCrit = Math.pow(2.0 / (gamma + 1.0), gamma / (gamma - 1.0));
    const isChoked: f64 = pUp > 1e-6 && pDn / pUp <= prCrit ? 1.0 : 0.0;
    setIo(slotPtr, 4, mDot);
    setIo(slotPtr, 5, isChoked);
    return;
  }
  if (archetypeId == ARCH_GD_VALVE) {
    const cd = getCon(slotPtr, conCount, 0, 0.82);
    const areaMax = getCon(slotPtr, conCount, 1, 2e-4);
    const gamma = getCon(slotPtr, conCount, 2, 1.4);
    const rGas = getCon(slotPtr, conCount, 3, 287.05);
    const tUp = u3 > 10.0 ? u3 : getCon(slotPtr, conCount, 4, 300.0);
    const opening = clamp(u2, 0.0, 1.0);
    const mDot = evalCompressibleGasFlow(cd, areaMax * opening, gamma, rGas, u0, u1, tUp);
    setIo(slotPtr, 4, mDot);
    return;
  }
  if (archetypeId == ARCH_GD_HEAT_EXCHANGER) {
    const eps = clamp(getCon(slotPtr, conCount, 0, 0.75), 0.0, 1.0);
    const tau = Math.max(1e-3, getCon(slotPtr, conCount, 1, 2.0));
    const tOut = getState(slotPtr, 0);
    const tEq = u0 + eps * (u1 - u0);
    setDState(slotPtr, 0, (tEq - tOut) / tau);
    setIo(slotPtr, 4, tOut);
    return;
  }

  // --- EC Electric Systems Library ---
  if (archetypeId == ARCH_EC_RESISTOR) {
    const r = Math.max(1e-6, getCon(slotPtr, conCount, 0, 10.0));
    const i = (u0 - u1) / r;
    setIo(slotPtr, 4, i);
    setIo(slotPtr, 7, i * i * r);
    return;
  }
  if (archetypeId == ARCH_EC_CAPACITOR) {
    const c = Math.max(1e-9, getCon(slotPtr, conCount, 0, 1e-3));
    const rLeak = Math.max(1.0, getCon(slotPtr, conCount, 2, 1e9));
    const v = getState(slotPtr, 0);
    setDState(slotPtr, 0, (u0 - v / rLeak) / c);
    setIo(slotPtr, 4, v);
    return;
  }
  if (archetypeId == ARCH_EC_INDUCTOR) {
    const l = Math.max(1e-9, getCon(slotPtr, conCount, 0, 0.01));
    const r = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.1));
    const i = getState(slotPtr, 0);
    setDState(slotPtr, 0, (u0 - r * i) / l);
    setIo(slotPtr, 4, i);
    return;
  }
  if (archetypeId == ARCH_EC_VOLTAGE_SOURCE) {
    const vNom = getCon(slotPtr, conCount, 0, 28.0);
    const rS = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.05));
    const ampAc = getCon(slotPtr, conCount, 2, 0.0);
    const omega = getCon(slotPtr, conCount, 3, 376.991118);
    const vSrc = (u0 != 0.0 ? u0 : vNom) + ampAc * Math.sin(omega * t);
    const vTerm = vSrc - rS * u1;
    setIo(slotPtr, 4, vTerm);
    return;
  }
  if (archetypeId == ARCH_EC_DC_MOTOR) {
    const ra = Math.max(1e-4, getCon(slotPtr, conCount, 0, 1.0));
    const la = Math.max(1e-5, getCon(slotPtr, conCount, 1, 0.01));
    const kt = getCon(slotPtr, conCount, 2, 0.1);
    const ke = getCon(slotPtr, conCount, 3, 0.1);
    const j = Math.max(1e-6, getCon(slotPtr, conCount, 4, 0.002));
    const b = Math.max(0.0, getCon(slotPtr, conCount, 5, 0.001));
    const i = getState(slotPtr, 0);
    const w = getState(slotPtr, 1);
    setDState(slotPtr, 0, (u0 - ra * i - ke * w) / la);
    setDState(slotPtr, 1, (kt * i - b * w - u1) / j);
    setIo(slotPtr, 4, i);
    setIo(slotPtr, 5, kt * i);
    setIo(slotPtr, 6, w);
    return;
  }
  if (archetypeId == ARCH_EC_INDUCTION_MOTOR) {
    const wSync = Math.max(1.0, getCon(slotPtr, conCount, 0, 188.495559));
    const tMax = getCon(slotPtr, conCount, 1, 50.0);
    const sMax = Math.max(0.01, getCon(slotPtr, conCount, 2, 0.15));
    const j = Math.max(1e-5, getCon(slotPtr, conCount, 3, 0.05));
    const b = Math.max(0.0, getCon(slotPtr, conCount, 4, 0.01));
    const w = getState(slotPtr, 0);
    const vPu = u0 > 0.0 ? u0 : 1.0;
    const slip = (wSync - w) / wSync;
    const denom = slip / sMax + sMax / (Math.abs(slip) > 1e-4 ? slip : 1e-4);
    const tEm = Math.abs(slip) > 1e-4 ? (2.0 * tMax * vPu * vPu) / denom : 0.0;
    setDState(slotPtr, 0, (tEm - b * w - u1) / j);
    setIo(slotPtr, 4, w);
    setIo(slotPtr, 5, tEm);
    return;
  }
  if (archetypeId == ARCH_EC_INVERTER) {
    const eta = clamp(getCon(slotPtr, conCount, 0, 0.96), 0.1, 1.0);
    const tau = Math.max(1e-5, getCon(slotPtr, conCount, 1, 0.002));
    const vMax = getCon(slotPtr, conCount, 2, 600.0);
    const vOut = getState(slotPtr, 0);
    const vCmd = clamp(u0 * u1 * eta, -vMax, vMax);
    setDState(slotPtr, 0, (vCmd - vOut) / tau);
    setIo(slotPtr, 4, vOut);
    return;
  }

  // --- AE Aerospace Library ---
  if (archetypeId == ARCH_AE_ATMOSPHERE) {
    // US Standard Atmosphere 1976 / ISO 2533
    const t0 = getCon(slotPtr, conCount, 0, 288.15);
    const p0 = getCon(slotPtr, conCount, 1, 101325.0);
    const lapse = getCon(slotPtr, conCount, 2, 0.0065);
    const deltaT = getCon(slotPtr, conCount, 3, 0.0);
    const g0: f64 = 9.80665;
    const rAir: f64 = 287.05287;
    const gammaAir: f64 = 1.4;
    const h = Math.max(0.0, u0);

    let tIsa: f64 = t0;
    let p: f64 = p0;
    if (h <= 11000.0) {
      tIsa = t0 - lapse * h;
      p = p0 * Math.pow(tIsa / t0, g0 / (rAir * lapse));
    } else {
      const t11 = t0 - lapse * 11000.0;
      const p11 = p0 * Math.pow(t11 / t0, g0 / (rAir * lapse));
      tIsa = t11;
      p = p11 * Math.exp((-g0 * (h - 11000.0)) / (rAir * t11));
    }
    const temp = Math.max(50.0, tIsa + deltaT);
    const rho = p / (rAir * temp);
    const aSound = Math.sqrt(gammaAir * rAir * temp);
    setIo(slotPtr, 4, rho);
    setIo(slotPtr, 5, p);
    setIo(slotPtr, 6, temp);
    setIo(slotPtr, 7, aSound);
    return;
  }
  if (archetypeId == ARCH_AE_RIGID_BODY) {
    const mass = Math.max(1e-3, getCon(slotPtr, conCount, 0, 1000.0));
    const x = getState(slotPtr, 0);
    const v = getState(slotPtr, 1);
    setDState(slotPtr, 0, v);
    setDState(slotPtr, 1, u0 / mass);
    setIo(slotPtr, 4, x);
    setIo(slotPtr, 5, v);
    return;
  }
  if (archetypeId == ARCH_AE_AERODYNAMICS) {
    const sRef = getCon(slotPtr, conCount, 0, 16.2);
    const cl0 = getCon(slotPtr, conCount, 1, 0.25);
    const clAlpha = getCon(slotPtr, conCount, 2, 5.2);
    const cd0 = getCon(slotPtr, conCount, 3, 0.025);
    const kInd = getCon(slotPtr, conCount, 4, 0.045);
    const vAir = u0;
    const alpha = u1;
    const rho = u2 > 0.0 ? u2 : 1.225;
    const qDyn = 0.5 * rho * vAir * vAir;
    const cl = cl0 + clAlpha * alpha;
    const cd = cd0 + kInd * cl * cl;
    const lift = qDyn * sRef * cl;
    const drag = qDyn * sRef * cd;
    setIo(slotPtr, 4, lift);
    setIo(slotPtr, 5, drag);
    setIo(slotPtr, 6, qDyn);
    return;
  }
  if (archetypeId == ARCH_AE_ENGINE) {
    const tMax = getCon(slotPtr, conCount, 0, 50000.0);
    const tauE = Math.max(1e-3, getCon(slotPtr, conCount, 1, 0.8));
    const sfc = getCon(slotPtr, conCount, 2, 2e-5);
    const throttle = clamp(u0, 0.0, 1.0);
    const rhoRatio = u1 > 0.0 ? u1 / 1.225 : 1.0;
    const thrust = getState(slotPtr, 0);
    const tCmd = tMax * rhoRatio * throttle;
    setDState(slotPtr, 0, (tCmd - thrust) / tauE);
    setIo(slotPtr, 4, thrust);
    setIo(slotPtr, 5, thrust * sfc);
    return;
  }
  if (archetypeId == ARCH_AE_ACTUATOR) {
    const tau = Math.max(1e-4, getCon(slotPtr, conCount, 0, 0.05));
    const rateLim = Math.max(1e-3, getCon(slotPtr, conCount, 1, 1.0));
    const posMax = getCon(slotPtr, conCount, 2, 0.45);
    const posMin = getCon(slotPtr, conCount, 3, -0.45);
    const pos = clamp(getState(slotPtr, 0), posMin, posMax);
    const cmd = clamp(u0, posMin, posMax);
    const rate = clamp((cmd - pos) / tau, -rateLim, rateLim);
    setDState(slotPtr, 0, rate);
    setIo(slotPtr, 4, pos);
    return;
  }

  // --- VC Multiphase / Vapor Cycle Library ---
  if (archetypeId == ARCH_VC_EVAPORATOR) {
    const ua = Math.max(1.0, getCon(slotPtr, conCount, 0, 450.0));
    const tau = Math.max(0.05, getCon(slotPtr, conCount, 1, 4.0));
    const tEvap = getState(slotPtr, 0);
    const tAir = u0 > 50.0 ? u0 : 295.0;
    const qLoad = ua * (tAir - tEvap);
    setDState(slotPtr, 0, (tAir - tEvap - u1 / ua) / tau);
    setIo(slotPtr, 4, tEvap);
    setIo(slotPtr, 5, qLoad);
    return;
  }
  if (archetypeId == ARCH_VC_CONDENSER) {
    const ua = Math.max(1.0, getCon(slotPtr, conCount, 0, 550.0));
    const tau = Math.max(0.05, getCon(slotPtr, conCount, 1, 5.0));
    const tAmb = u1 > 50.0 ? u1 : getCon(slotPtr, conCount, 2, 308.15);
    const tCond = getState(slotPtr, 0);
    const qRej = ua * (tCond - tAmb);
    setDState(slotPtr, 0, (tAmb + u0 / ua - tCond) / tau);
    setIo(slotPtr, 4, tCond);
    setIo(slotPtr, 5, qRej);
    return;
  }
  if (archetypeId == ARCH_VC_TXV) {
    const cd = getCon(slotPtr, conCount, 0, 0.65);
    const areaMax = getCon(slotPtr, conCount, 1, 2e-5);
    const rhoL = Math.max(10.0, getCon(slotPtr, conCount, 2, 1150.0));
    const shSet = getCon(slotPtr, conCount, 3, 5.0);
    const kSh = getCon(slotPtr, conCount, 4, 0.1);
    const dP = Math.max(0.0, u0 - u1);
    const opening = clamp(0.5 + kSh * (u2 - shSet), 0.0, 1.0);
    const qVol = evalHydraulicOrificeFlow(cd, areaMax * opening, rhoL, dP, 1e2);
    setIo(slotPtr, 4, qVol * rhoL);
    setIo(slotPtr, 5, opening);
    return;
  }
  if (archetypeId == ARCH_VC_COMPRESSOR) {
    const disp = getCon(slotPtr, conCount, 0, 3e-5);
    const etaVol = clamp(getCon(slotPtr, conCount, 1, 0.85), 0.1, 1.0);
    const etaIs = clamp(getCon(slotPtr, conCount, 2, 0.78), 0.1, 1.0);
    const gamma = Math.max(1.05, getCon(slotPtr, conCount, 3, 1.18));
    const cpV = Math.max(100.0, getCon(slotPtr, conCount, 4, 900.0));
    const speedHz = Math.max(0.0, u0);
    const pSuc = Math.max(1e3, u1);
    const pDis = Math.max(pSuc, u2 > 0.0 ? u2 : pSuc * 3.0);
    const tSuc = u3 > 50.0 ? u3 : 280.0;
    const rhoSuc = pSuc / (81.5 * tSuc);
    const mDot = etaVol * rhoSuc * disp * speedHz;
    const pr = pDis / pSuc;
    const tDisIs = tSuc * Math.pow(pr, (gamma - 1.0) / gamma);
    const tDis = tSuc + (tDisIs - tSuc) / etaIs;
    const power = mDot * cpV * (tDis - tSuc);
    setIo(slotPtr, 4, mDot);
    setIo(slotPtr, 5, power);
    setIo(slotPtr, 6, tDis);
    return;
  }
}

/**
 * Advances a single Easy5 component slot by `dt` using 2nd-order Heun predictor-corrector integration.
 */
export function easy5ModelStep(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const nStates = getStateCount(archetypeId);
  if (nStates == 0) {
    easy5ModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
    return;
  }

  const y0_0 = getState(slotPtr, 0);
  const y0_1 = getState(slotPtr, 1);

  easy5ModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
  const k1_0 = getDState(slotPtr, 0);
  const k1_1 = getDState(slotPtr, 1);

  setState(slotPtr, 0, y0_0 + dt * k1_0);
  if (nStates > 1) setState(slotPtr, 1, y0_1 + dt * k1_1);

  easy5ModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
  const k2_0 = getDState(slotPtr, 0);
  const k2_1 = getDState(slotPtr, 1);

  setState(slotPtr, 0, y0_0 + 0.5 * dt * (k1_0 + k2_0));
  if (nStates > 1) setState(slotPtr, 1, y0_1 + 0.5 * dt * (k1_1 + k2_1));

  // Re-sync outputs after Heun corrector
  easy5ModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
}

/**
 * Computes max `|dstate/dt|` immediately after initialization to verify steady-state equilibrium.
 */
export function easy5ModelCheckFlatStart(archetypeId: i32, slotPtr: usize, conCount: i32): f64 {
  easy5ModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
  let maxRes: f64 = 0.0;
  for (let i = 0; i < 4; i++) {
    const d = Math.abs(getDState(slotPtr, i));
    if (d > maxRes) maxRes = d;
  }
  return maxRes;
}

/**
 * Batched zero-copy initialization across `count` component descriptors:
 * each descriptor is 16 bytes `{ archetypeId: i32, slotPtr: u32, reserved: i32, conCount: i32 }`.
 */
export function easy5BatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    easy5ModelInit(archetypeId, slotPtr, conCount);
  }
}

/**
 * Batched zero-copy Heun time-step across `count` component descriptors.
 */
export function easy5BatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    easy5ModelStep(archetypeId, t, dt, slotPtr, conCount);
  }
}
