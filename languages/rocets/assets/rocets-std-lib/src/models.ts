// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript rocket propulsion runtime for `@modelscript/rocets-std-lib`.
 *
 * Implements public Sutton / Huzel-Huang / NASA SP-1252 / NIST rocket propulsion physics
 * using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — ROCETS module parameters
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — fluid / mechanical / thermal I/O bus:
 *       IO[0]  = pIn (Pa)           IO[1]  = pOut (Pa)
 *       IO[2]  = tIn (K)            IO[3]  = tOut (K)
 *       IO[4]  = mdotIn (kg/s)      IO[5]  = mdotOut (kg/s)
 *       IO[6]  = mdotFuel (kg/s)    IO[7]  = speedRpm (rpm)
 *       IO[8]  = torqueNm (N.m)     IO[9]  = powerW (W)
 *       IO[10] = density (kg/m3)    IO[11] = enthalpy (J/kg)
 *       IO[12] = valveCmd (0..1)    IO[13] = thrustN (N)
 *       IO[14] = ispSec (s)         IO[15] = headM (m or PR)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

const G0: f64 = 9.80665;
const TWO_PI_OVER_60: f64 = 0.10471975511965977;
const P_REF_STD: f64 = 101325.0;

// Archetype IDs (must match `RocetsArchetypeId` in rocets-std-schemas.ts)
const ARCH_PUMP: i32 = 1;
const ARCH_TURBINE: i32 = 2;
const ARCH_INDUCER: i32 = 3;
const ARCH_SHAFT: i32 = 4;
const ARCH_GEARBOX: i32 = 5;

const ARCH_CHAMBER: i32 = 10;
const ARCH_PREBURNER: i32 = 11;
const ARCH_GASGEN: i32 = 12;
const ARCH_NOZZLE: i32 = 13;
const ARCH_INJECTOR: i32 = 14;
const ARCH_IGNITER: i32 = 15;

const ARCH_PIPE: i32 = 20;
const ARCH_VOLUME: i32 = 21;
const ARCH_VALVE: i32 = 22;
const ARCH_ORIFICE: i32 = 23;
const ARCH_CHECKVALVE: i32 = 24;
const ARCH_REGULATOR: i32 = 25;
const ARCH_SPLIT: i32 = 26;
const ARCH_JOIN: i32 = 27;
const ARCH_HEATX: i32 = 28;
const ARCH_COOLING_JACKET: i32 = 29;

const ARCH_TANK: i32 = 30;
const ARCH_PRESSURANT: i32 = 31;
const ARCH_ULLAGE: i32 = 32;

const ARCH_FLUID_LOX: i32 = 40;
const ARCH_FLUID_LH2: i32 = 41;
const ARCH_FLUID_RP1: i32 = 42;
const ARCH_FLUID_CH4: i32 = 43;
const ARCH_FLUID_N2O4: i32 = 44;
const ARCH_FLUID_MMH: i32 = 45;

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
 * Solves supersonic exit Mach number Me for area ratio eps = Ae/At via Newton-Raphson.
 */
function solveSupersonicMach(eps: f64, gamma: f64): f64 {
  if (eps <= 1.0001) return 1.0;
  const gp1 = gamma + 1.0;
  const gm1 = gamma - 1.0;
  const expVal = gp1 / (2.0 * gm1);
  let m: f64 = 1.5 + 0.5 * Math.log(eps);
  for (let i = 0; i < 8; i++) {
    const term = (2.0 / gp1) * (1.0 + 0.5 * gm1 * m * m);
    const fVal = (1.0 / m) * Math.pow(term, expVal) - eps;
    const dTermDm = (2.0 * gm1 / gp1) * m;
    const dfDm =
      (-1.0 / (m * m)) * Math.pow(term, expVal) +
      (1.0 / m) * expVal * Math.pow(term, expVal - 1.0) * dTermDm;
    if (Math.abs(dfDm) < 1e-12) break;
    const nextM = m - fVal / dfDm;
    m = nextM > 1.02 ? nextM : 1.02;
    if (Math.abs(fVal) < 1e-6) break;
  }
  return m;
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function rocetsGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Returns the number of active continuous states for a given ROCETS archetype.
 */
function stateCountForArchetype(archetypeId: i32): i32 {
  if (archetypeId == ARCH_SHAFT) return 1;
  if (archetypeId == ARCH_CHAMBER || archetypeId == ARCH_PREBURNER || archetypeId == ARCH_GASGEN) return 1;
  if (archetypeId == ARCH_PIPE || archetypeId == ARCH_VOLUME || archetypeId == ARCH_VALVE) return 1;
  if (archetypeId == ARCH_TANK || archetypeId == ARCH_PRESSURANT || archetypeId == ARCH_ULLAGE) return 2;
  return 0;
}

/**
 * Initializes rocket module dynamic states for flat-start steady-state equilibrium (`dstate/dt = 0`).
 * Returns the number of active dynamic states for the archetype.
 */
export function rocetsModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  for (let i = 0; i < 4; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }

  if (archetypeId == ARCH_SHAFT) {
    const rpm0 = getIo(slotPtr, 7) > 1.0 ? getIo(slotPtr, 7) : getCon(slotPtr, conCount, 0, 30000.0);
    setState(slotPtr, 0, rpm0 * TWO_PI_OVER_60);
    setIo(slotPtr, 7, rpm0);
    return 1;
  }

  if (archetypeId == ARCH_CHAMBER || archetypeId == ARCH_PREBURNER || archetypeId == ARCH_GASGEN) {
    const throatArea = Math.max(1e-6, getCon(slotPtr, conCount, 0, 0.045));
    const cstar = Math.max(100.0, getCon(slotPtr, conCount, 1, 2320.0));
    const cstarEff = clamp(getCon(slotPtr, conCount, 2, 0.98), 0.1, 1.0);
    const mdotTotal = Math.max(0.0, getIo(slotPtr, 4) + getIo(slotPtr, 6));
    const pc0 =
      mdotTotal > 1e-6
        ? (mdotTotal * cstar * cstarEff) / throatArea
        : getIo(slotPtr, 0) > 1e4
          ? getIo(slotPtr, 0)
          : 1.0e7;
    setState(slotPtr, 0, pc0);
    setIo(slotPtr, 1, pc0);
    setIo(slotPtr, 5, (pc0 * throatArea) / (cstar * cstarEff));
    return 1;
  }

  if (archetypeId == ARCH_PIPE) {
    const mdot0 = getIo(slotPtr, 4);
    setState(slotPtr, 0, mdot0);
    setIo(slotPtr, 5, mdot0);
    return 1;
  }

  if (archetypeId == ARCH_VOLUME) {
    const p0 = getIo(slotPtr, 0) > 1e3 ? getIo(slotPtr, 0) : getCon(slotPtr, conCount, 3, 1.0e7);
    setState(slotPtr, 0, p0);
    setIo(slotPtr, 1, p0);
    return 1;
  }

  if (archetypeId == ARCH_VALVE) {
    const initPos = clamp(getCon(slotPtr, conCount, 1, 1.0), 0.0, 1.0);
    const cmd = getIo(slotPtr, 12);
    const pos0 = cmd > 0.0 ? clamp(cmd, 0.0, 1.0) : initPos;
    setState(slotPtr, 0, pos0);
    setIo(slotPtr, 12, pos0);
    return 1;
  }

  if (archetypeId == ARCH_TANK) {
    const initMass = Math.max(1.0, getCon(slotPtr, conCount, 0, 50000.0));
    const pUll = Math.max(1e4, getCon(slotPtr, conCount, 1, 3.2e5));
    setState(slotPtr, 0, initMass);
    setState(slotPtr, 1, pUll);
    return 2;
  }

  if (archetypeId == ARCH_PRESSURANT) {
    const p0 = Math.max(1e4, getCon(slotPtr, conCount, 1, 3.1e7));
    const t0 = Math.max(50.0, getCon(slotPtr, conCount, 2, 293.0));
    setState(slotPtr, 0, p0);
    setState(slotPtr, 1, t0);
    return 2;
  }

  if (archetypeId == ARCH_ULLAGE) {
    const v0 = Math.max(0.01, getCon(slotPtr, conCount, 0, 4.0));
    const p0 = Math.max(1e4, getCon(slotPtr, conCount, 1, 3.2e5));
    setState(slotPtr, 0, p0);
    setState(slotPtr, 1, v0);
    return 2;
  }

  return 0;
}

/**
 * Evaluates cleanroom rocket propulsion physics and state derivatives for a single ROCETS archetype.
 */
export function rocetsModelEvalDerivatives(
  archetypeId: i32,
  _t: f64,
  _dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const pIn = getIo(slotPtr, 0);
  const pOutIn = getIo(slotPtr, 1);
  const tIn = getIo(slotPtr, 2) > 1.0 ? getIo(slotPtr, 2) : 90.2;
  const mdotIn = getIo(slotPtr, 4);
  const mdotFuel = getIo(slotPtr, 6);
  const speedRpm = getIo(slotPtr, 7);
  const rhoIo = getIo(slotPtr, 10);
  const valveCmd = clamp(getIo(slotPtr, 12), 0.0, 1.0);

  // ─── Turbomachinery ──────────────────────────────────────────────────────
  if (archetypeId == ARCH_PUMP || archetypeId == ARCH_INDUCER) {
    const designFlow = Math.max(1e-3, getCon(slotPtr, conCount, 0, 50.0));
    const designHead = Math.max(1.0, getCon(slotPtr, conCount, 1, archetypeId == ARCH_INDUCER ? 180.0 : 1500.0));
    const designRpm = Math.max(100.0, getCon(slotPtr, conCount, 2, 30000.0));
    const etaDes = clamp(getCon(slotPtr, conCount, 3, archetypeId == ARCH_INDUCER ? 0.68 : 0.78), 0.1, 0.98);
    const shutoffRatio = Math.max(1.05, getCon(slotPtr, conCount, 4, 1.25));
    const rhoDes = Math.max(1.0, getCon(slotPtr, conCount, 5, 1141.0));
    const rho = rhoIo > 1.0 ? rhoIo : rhoDes;
    const cp = Math.max(100.0, getCon(slotPtr, conCount, 6, 1699.0));

    const rpm = speedRpm > 1.0 ? speedRpm : designRpm;
    const nRatio = rpm / designRpm;
    const omega = Math.max(1.0, rpm * TWO_PI_OVER_60);

    // Dimensionless flow coefficient phi = (Q / Q_des) / (N / N_des)
    const qVol = Math.max(0.0, mdotIn) / rho;
    const qDes = designFlow / rhoDes;
    const phi = qVol / (qDes * Math.max(nRatio, 0.05));

    // 2D turbopump head coefficient map psi(phi): psi(0) = shutoffRatio, psi(1) = 1.0
    const dPsi = shutoffRatio - 1.0;
    const psi = clamp(shutoffRatio + 0.2 * dPsi * phi - 1.2 * dPsi * phi * phi, 0.05, shutoffRatio * 1.15);

    // 2D turbopump efficiency map eta(phi): peaks at design flow phi = 1.0
    const etaMap = clamp(etaDes * (1.0 - 0.65 * (phi - 1.0) * (phi - 1.0)), 0.15, 0.98);

    // Cavitation suction-specific-speed NPSH check (NASA SP-8107 / Huzel & Huang Ch. 6)
    // Available NPSH relative to cryogenic NBP vapor pressure (101.325 kPa)
    const pVapor = P_REF_STD;
    const npshAvail = Math.max(0.0, (pIn - pVapor) / (rho * G0));
    const ssSi = archetypeId == ARCH_INDUCER ? 16.0 : 13.5; // dimensionless SI suction specific speed
    const npshReq =
      qVol > 1e-6 ? Math.pow((omega * Math.sqrt(qVol)) / ssSi, 4.0 / 3.0) / G0 : 0.0;
    const cavFactor =
      npshReq > 1e-6 && npshAvail < npshReq
        ? clamp(Math.pow(npshAvail / npshReq, 1.5), 0.05, 1.0)
        : 1.0;

    const headM = designHead * nRatio * nRatio * psi * cavFactor;
    const dp = rho * G0 * headM;
    const pOut = pIn + dp;
    const pHyd = Math.max(0.0, mdotIn) * G0 * headM;
    const pShaft = pHyd / etaMap;
    const torque = pShaft / omega;
    const tOut = tIn + (G0 * headM * (1.0 - etaMap)) / (etaMap * cp);

    setIo(slotPtr, 1, pOut);
    setIo(slotPtr, 3, tOut);
    setIo(slotPtr, 5, mdotIn);
    setIo(slotPtr, 8, torque);
    setIo(slotPtr, 9, pShaft);
    setIo(slotPtr, 10, rho);
    setIo(slotPtr, 15, headM);
    return;
  }

  if (archetypeId == ARCH_TURBINE) {
    const prDesign = Math.max(1.05, getCon(slotPtr, conCount, 1, 1.85));
    const etaDes = clamp(getCon(slotPtr, conCount, 2, 0.82), 0.1, 0.98);
    const designRpm = Math.max(100.0, getCon(slotPtr, conCount, 3, 30000.0));
    const cpGas = Math.max(200.0, getCon(slotPtr, conCount, 4, 2800.0));
    const gamma = clamp(getCon(slotPtr, conCount, 5, 1.32), 1.05, 1.67);

    const pr = pOutIn > 1e3 && pIn > pOutIn ? pIn / pOutIn : prDesign;
    const exp = -(gamma - 1.0) / gamma;
    const prTerm = Math.max(1e-4, 1.0 - Math.pow(pr, exp));
    const prDesTerm = Math.max(1e-4, 1.0 - Math.pow(prDesign, exp));

    const rpm = speedRpm > 1.0 ? speedRpm : designRpm;
    const nRatio = rpm / designRpm;
    // Normalized blade-speed-to-spouting-velocity ratio U/C0 relative to design point
    const uOverC0 = nRatio / Math.sqrt(prTerm / prDesTerm);
    const etaMap = clamp(
      etaDes * (1.0 - 0.75 * (uOverC0 - 1.0) * (uOverC0 - 1.0) - 0.1 * (nRatio - 1.0) * (nRatio - 1.0)),
      0.15,
      0.98,
    );

    const dTIsen = tIn * prTerm;
    const dTActual = etaMap * dTIsen;
    const tOut = Math.max(50.0, tIn - dTActual);
    const powerW = Math.max(0.0, mdotIn) * cpGas * dTActual;
    const omega = Math.max(1.0, rpm * TWO_PI_OVER_60);
    const torque = powerW / omega;

    setIo(slotPtr, 1, pIn / pr);
    setIo(slotPtr, 3, tOut);
    setIo(slotPtr, 5, mdotIn);
    setIo(slotPtr, 8, torque);
    setIo(slotPtr, 9, powerW);
    setIo(slotPtr, 15, pr);
    return;
  }

  if (archetypeId == ARCH_SHAFT) {
    const inertia = Math.max(1e-4, getCon(slotPtr, conCount, 1, 0.08));
    const friction = Math.max(0.0, getCon(slotPtr, conCount, 2, 4.0));
    const omega = Math.max(1.0, getState(slotPtr, 0));
    const netTorque = getIo(slotPtr, 8);
    const dOmega = (netTorque - friction) / inertia;
    setDState(slotPtr, 0, dOmega);
    setIo(slotPtr, 7, omega / TWO_PI_OVER_60);
    setIo(slotPtr, 9, netTorque * omega);
    return;
  }

  if (archetypeId == ARCH_GEARBOX) {
    const ratio = Math.max(0.1, getCon(slotPtr, conCount, 0, 2.5));
    const eff = clamp(getCon(slotPtr, conCount, 1, 0.97), 0.1, 1.0);
    const torqueIn = getIo(slotPtr, 8);
    const powerIn = getIo(slotPtr, 9);
    setIo(slotPtr, 7, speedRpm / ratio);
    setIo(slotPtr, 8, torqueIn * ratio * eff);
    setIo(slotPtr, 9, powerIn * eff);
    return;
  }

  // ─── Combustion & Nozzle ─────────────────────────────────────────────────
  if (archetypeId == ARCH_CHAMBER || archetypeId == ARCH_PREBURNER || archetypeId == ARCH_GASGEN) {
    const throatArea = Math.max(1e-6, getCon(slotPtr, conCount, 0, 0.045));
    const cstar = Math.max(100.0, getCon(slotPtr, conCount, 1, 2320.0));
    const cstarEff = clamp(getCon(slotPtr, conCount, 2, 0.98), 0.1, 1.0);
    const volume = Math.max(1e-4, getCon(slotPtr, conCount, 3, 0.06));
    const rGas = Math.max(100.0, getCon(slotPtr, conCount, 4, 620.0));
    const tComb = Math.max(300.0, getCon(slotPtr, conCount, 5, 3450.0));
    const gamma = clamp(getCon(slotPtr, conCount, 6, 1.2), 1.05, 1.67);
    const eps = Math.max(1.0, getCon(slotPtr, conCount, 7, 35.0));

    const pc = Math.max(1e3, getState(slotPtr, 0));
    const cstarActual = cstar * cstarEff;
    const mdotTotal = Math.max(0.0, mdotIn + mdotFuel);
    const mdotOut = (pc * throatArea) / cstarActual;
    const dPcDt = ((rGas * tComb) / volume) * (mdotTotal - mdotOut);

    const me = solveSupersonicMach(eps, gamma);
    const peOverPc = Math.pow(1.0 + 0.5 * (gamma - 1.0) * me * me, -gamma / (gamma - 1.0));
    const gp1 = gamma + 1.0;
    const gm1 = gamma - 1.0;
    const cfVac =
      Math.sqrt(
        ((2.0 * gamma * gamma) / gm1) *
          Math.pow(2.0 / gp1, gp1 / gm1) *
          Math.max(0.0, 1.0 - Math.pow(peOverPc, gm1 / gamma)),
      ) +
      peOverPc * eps;
    const thrust = 0.98 * cfVac * pc * throatArea;
    const isp = mdotOut > 1e-6 ? thrust / (mdotOut * G0) : 0.0;

    setDState(slotPtr, 0, dPcDt);
    setIo(slotPtr, 1, pc);
    setIo(slotPtr, 3, tComb);
    setIo(slotPtr, 5, mdotOut);
    setIo(slotPtr, 13, thrust);
    setIo(slotPtr, 14, isp);
    return;
  }

  if (archetypeId == ARCH_NOZZLE) {
    const throatArea = Math.max(1e-6, getCon(slotPtr, conCount, 0, 0.045));
    const eps = Math.max(1.0, getCon(slotPtr, conCount, 1, 35.0));
    const cstar = Math.max(100.0, getCon(slotPtr, conCount, 2, 2320.0));
    const gamma = clamp(getCon(slotPtr, conCount, 3, 1.2), 1.05, 1.67);
    const cfEff = clamp(getCon(slotPtr, conCount, 4, 0.98), 0.1, 1.0);
    const pAmb = Math.max(0.0, pOutIn > 0.0 ? pOutIn : getCon(slotPtr, conCount, 5, P_REF_STD));

    const pc = Math.max(0.0, pIn);
    // Exact choked throat mass flow: mdot = Pc * At / c*
    const mdot = (pc * throatArea) / cstar;
    const me = solveSupersonicMach(eps, gamma);
    const gm1 = gamma - 1.0;
    const gp1 = gamma + 1.0;
    const tRatio = 1.0 / (1.0 + 0.5 * gm1 * me * me);
    const peOverPc = Math.pow(tRatio, gamma / gm1);
    const pe = pc * peOverPc;

    const cfIdeal =
      Math.sqrt(
        ((2.0 * gamma * gamma) / gm1) *
          Math.pow(2.0 / gp1, gp1 / gm1) *
          Math.max(0.0, 1.0 - Math.pow(peOverPc, gm1 / gamma)),
      ) +
      (pc > 1.0 ? ((pe - pAmb) / pc) * eps : 0.0);
    const cf = Math.max(0.0, cfEff * cfIdeal);
    const thrust = cf * pc * throatArea;
    const isp = mdot > 1e-6 ? thrust / (mdot * G0) : 0.0;

    setIo(slotPtr, 1, pe);
    setIo(slotPtr, 3, tIn * tRatio);
    setIo(slotPtr, 5, mdot);
    setIo(slotPtr, 13, thrust);
    setIo(slotPtr, 14, isp);
    setIo(slotPtr, 15, cf);
    return;
  }

  if (archetypeId == ARCH_INJECTOR) {
    const cdA = Math.max(1e-7, getCon(slotPtr, conCount, 0, 0.0018));
    const rho = rhoIo > 1.0 ? rhoIo : Math.max(1.0, getCon(slotPtr, conCount, 1, 1141.0));
    const dp = Math.max(0.0, pIn - pOutIn);
    const mdot = cdA * Math.sqrt(2.0 * rho * dp);
    setIo(slotPtr, 3, tIn);
    setIo(slotPtr, 5, mdot);
    setIo(slotPtr, 15, pOutIn > 1.0 ? dp / pOutIn : 0.0);
    return;
  }

  if (archetypeId == ARCH_IGNITER) {
    const pilotFlow = Math.max(0.0, getCon(slotPtr, conCount, 0, 0.25));
    const thermalPower = Math.max(0.0, getCon(slotPtr, conCount, 1, 2.5e6));
    const active = valveCmd > 0.5 ? 1.0 : 0.0;
    setIo(slotPtr, 5, active * pilotFlow);
    setIo(slotPtr, 9, active * thermalPower);
    setIo(slotPtr, 3, active > 0.5 ? 2400.0 : tIn);
    return;
  }

  // ─── Fluid Network & Valves ──────────────────────────────────────────────
  if (archetypeId == ARCH_PIPE) {
    const length = Math.max(0.01, getCon(slotPtr, conCount, 0, 2.0));
    const diam = Math.max(0.002, getCon(slotPtr, conCount, 1, 0.08));
    const fDarcy = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.02));
    const rho = rhoIo > 1.0 ? rhoIo : Math.max(1.0, getCon(slotPtr, conCount, 3, 1141.0));
    const kMinor = Math.max(0.0, getCon(slotPtr, conCount, 4, 0.5));

    const area = 0.25 * Math.PI * diam * diam;
    const mdot = getState(slotPtr, 0);
    const kTotal = fDarcy * (length / diam) + kMinor;
    const dpFric = (kTotal * mdot * Math.abs(mdot)) / (2.0 * rho * area * area);
    const dMdotDt = (area / length) * (pIn - pOutIn - dpFric);

    setDState(slotPtr, 0, dMdotDt);
    setIo(slotPtr, 3, tIn);
    setIo(slotPtr, 5, mdot);
    return;
  }

  if (archetypeId == ARCH_VOLUME) {
    const vol = Math.max(1e-5, getCon(slotPtr, conCount, 0, 0.015));
    const beta = Math.max(1e5, getCon(slotPtr, conCount, 1, 8.0e8));
    const rho = rhoIo > 1.0 ? rhoIo : Math.max(1.0, getCon(slotPtr, conCount, 2, 1141.0));
    const mdotOut = getIo(slotPtr, 5);
    const p = Math.max(1e3, getState(slotPtr, 0));
    const dPDt = (beta / (rho * vol)) * (mdotIn - mdotOut);
    setDState(slotPtr, 0, dPDt);
    setIo(slotPtr, 1, p);
    setIo(slotPtr, 3, tIn);
    return;
  }

  if (archetypeId == ARCH_VALVE) {
    const cdAMax = Math.max(1e-7, getCon(slotPtr, conCount, 0, 0.002));
    const tau = Math.max(0.005, getCon(slotPtr, conCount, 2, 0.15));
    const rho = rhoIo > 1.0 ? rhoIo : Math.max(1.0, getCon(slotPtr, conCount, 3, 1141.0));

    const pos = clamp(getState(slotPtr, 0), 0.0, 1.0);
    const dPosDt = (valveCmd - pos) / tau;
    const dp = pIn - pOutIn;
    const sign = dp >= 0.0 ? 1.0 : -1.0;
    const mdot = sign * cdAMax * pos * Math.sqrt(2.0 * rho * Math.abs(dp));

    setDState(slotPtr, 0, dPosDt);
    setIo(slotPtr, 3, tIn);
    setIo(slotPtr, 5, mdot);
    setIo(slotPtr, 15, pos);
    return;
  }

  if (archetypeId == ARCH_ORIFICE) {
    const cdA = Math.max(1e-7, getCon(slotPtr, conCount, 0, 0.0012));
    const rho = rhoIo > 1.0 ? rhoIo : Math.max(1.0, getCon(slotPtr, conCount, 1, 1141.0));
    const dp = pIn - pOutIn;
    const sign = dp >= 0.0 ? 1.0 : -1.0;
    const mdot = sign * cdA * Math.sqrt(2.0 * rho * Math.abs(dp));
    setIo(slotPtr, 3, tIn);
    setIo(slotPtr, 5, mdot);
    return;
  }

  if (archetypeId == ARCH_CHECKVALVE) {
    const cdA = Math.max(1e-7, getCon(slotPtr, conCount, 0, 0.0015));
    const pCrack = Math.max(0.0, getCon(slotPtr, conCount, 1, 35000.0));
    const rho = rhoIo > 1.0 ? rhoIo : Math.max(1.0, getCon(slotPtr, conCount, 2, 1141.0));
    const dpNet = pIn - pOutIn - pCrack;
    const mdot = dpNet > 0.0 ? cdA * Math.sqrt(2.0 * rho * dpNet) : 0.0;
    setIo(slotPtr, 3, tIn);
    setIo(slotPtr, 5, mdot);
    return;
  }

  if (archetypeId == ARCH_REGULATOR) {
    const pSet = Math.max(1e4, getCon(slotPtr, conCount, 0, 3.5e5));
    const cdAMax = Math.max(1e-7, getCon(slotPtr, conCount, 1, 0.0004));
    const droop = Math.max(1e-8, getCon(slotPtr, conCount, 2, 2.0e-5));
    const rho = rhoIo > 0.1 ? rhoIo : Math.max(0.1, getCon(slotPtr, conCount, 3, 4.5));

    const opening = clamp((pSet - pOutIn) * droop, 0.0, 1.0);
    const dp = Math.max(0.0, pIn - pOutIn);
    const mdot = cdAMax * opening * Math.sqrt(2.0 * rho * dp);
    setIo(slotPtr, 3, tIn);
    setIo(slotPtr, 5, mdot);
    setIo(slotPtr, 15, opening);
    return;
  }

  if (archetypeId == ARCH_SPLIT) {
    const frac = clamp(getCon(slotPtr, conCount, 0, 0.7), 0.0, 1.0);
    setIo(slotPtr, 1, pIn);
    setIo(slotPtr, 3, tIn);
    setIo(slotPtr, 5, mdotIn * frac);
    setIo(slotPtr, 6, mdotIn * (1.0 - frac));
    return;
  }

  if (archetypeId == ARCH_JOIN) {
    const cp1 = Math.max(100.0, getCon(slotPtr, conCount, 0, 1700.0));
    const cp2 = Math.max(100.0, getCon(slotPtr, conCount, 1, 1700.0));
    const t2 = getIo(slotPtr, 3) > 1.0 ? getIo(slotPtr, 3) : tIn;
    const mTotal = mdotIn + mdotFuel;
    const denom = Math.max(1e-6, mdotIn * cp1 + mdotFuel * cp2);
    const tMix = (mdotIn * cp1 * tIn + mdotFuel * cp2 * t2) / denom;
    setIo(slotPtr, 1, pIn);
    setIo(slotPtr, 3, tMix);
    setIo(slotPtr, 5, mTotal);
    return;
  }

  if (archetypeId == ARCH_HEATX) {
    const ua = Math.max(1.0, getCon(slotPtr, conCount, 0, 12000.0));
    const tHot = Math.max(50.0, getCon(slotPtr, conCount, 1, 850.0));
    const cpCold = Math.max(100.0, getCon(slotPtr, conCount, 2, 2400.0));
    const dpDesign = Math.max(0.0, getCon(slotPtr, conCount, 3, 1.5e5));
    const capRate = Math.max(1e-3, Math.abs(mdotIn) * cpCold);
    const ntu = ua / capRate;
    const eff = 1.0 - Math.exp(-ntu);
    const qW = eff * capRate * (tHot - tIn);
    setIo(slotPtr, 1, Math.max(0.0, pIn - dpDesign));
    setIo(slotPtr, 3, tIn + qW / capRate);
    setIo(slotPtr, 5, mdotIn);
    setIo(slotPtr, 9, qW);
    return;
  }

  if (archetypeId == ARCH_COOLING_JACKET) {
    const area = Math.max(0.01, getCon(slotPtr, conCount, 0, 1.5));
    const qFlux = Math.max(0.0, getCon(slotPtr, conCount, 1, 2.5e7));
    const cpCool = Math.max(100.0, getCon(slotPtr, conCount, 2, 14300.0));
    const dpNom = Math.max(0.0, getCon(slotPtr, conCount, 3, 1.8e6));
    const mDes = Math.max(0.1, getCon(slotPtr, conCount, 4, 25.0));

    const qTotal = qFlux * area;
    const mFlow = Math.max(0.1, Math.abs(mdotIn));
    const dp = dpNom * (mFlow / mDes) * (mFlow / mDes);
    setIo(slotPtr, 1, Math.max(0.0, pIn - dp));
    setIo(slotPtr, 3, tIn + qTotal / (mFlow * cpCool));
    setIo(slotPtr, 5, mdotIn);
    setIo(slotPtr, 9, qTotal);
    return;
  }

  // ─── Tanks & Pressurization ──────────────────────────────────────────────
  if (archetypeId == ARCH_TANK) {
    const rho = Math.max(1.0, getCon(slotPtr, conCount, 2, 1141.0));
    const crossArea = Math.max(0.1, getCon(slotPtr, conCount, 3, 10.0));
    const accelG = Math.max(0.0, getCon(slotPtr, conCount, 4, 1.0));
    const mProp = Math.max(0.0, getState(slotPtr, 0));
    const pUll = Math.max(1e3, getState(slotPtr, 1));
    const mdotOut = Math.max(0.0, getIo(slotPtr, 5));

    const height = mProp / (rho * crossArea);
    const pOut = pUll + rho * accelG * G0 * height;
    setDState(slotPtr, 0, mProp > 0.0 ? -mdotOut : 0.0);
    setDState(slotPtr, 1, 0.0);
    setIo(slotPtr, 1, pOut);
    setIo(slotPtr, 15, height);
    return;
  }

  if (archetypeId == ARCH_PRESSURANT) {
    const vol = Math.max(0.01, getCon(slotPtr, conCount, 0, 0.45));
    const rGas = Math.max(100.0, getCon(slotPtr, conCount, 3, 2077.0));
    const gamma = clamp(getCon(slotPtr, conCount, 4, 1.66), 1.05, 1.67);
    const p = Math.max(1e4, getState(slotPtr, 0));
    const temp = Math.max(50.0, getState(slotPtr, 1));
    const mdotOut = Math.max(0.0, getIo(slotPtr, 5));

    const dPDt = -((gamma * rGas * temp) / vol) * mdotOut;
    const dTDt = ((gamma - 1.0) / gamma) * (temp / p) * dPDt;
    setDState(slotPtr, 0, dPDt);
    setDState(slotPtr, 1, dTDt);
    setIo(slotPtr, 1, p);
    setIo(slotPtr, 3, temp);
    return;
  }

  if (archetypeId == ARCH_ULLAGE) {
    const tGas = Math.max(50.0, getCon(slotPtr, conCount, 2, 220.0));
    const rGas = Math.max(100.0, getCon(slotPtr, conCount, 3, 2077.0));
    const gamma = clamp(getCon(slotPtr, conCount, 4, 1.66), 1.05, 1.67);
    const rhoProp = Math.max(1.0, getCon(slotPtr, conCount, 5, 1141.0));
    const p = Math.max(1e3, getState(slotPtr, 0));
    const vUll = Math.max(0.01, getState(slotPtr, 1));
    const mdotPropOut = Math.max(0.0, getIo(slotPtr, 5));

    const dVdt = mdotPropOut / rhoProp;
    const dPdt = ((gamma * rGas * tGas) / vUll) * Math.max(0.0, mdotIn) - ((gamma * p) / vUll) * dVdt;
    setDState(slotPtr, 0, dPdt);
    setDState(slotPtr, 1, dVdt);
    setIo(slotPtr, 1, p);
    setIo(slotPtr, 3, tGas);
    return;
  }

  // ─── Propellant Property Tables (NIST / NASA Real-Fluid Cryogenic & Storable EOS) ──
  if (
    archetypeId == ARCH_FLUID_LOX ||
    archetypeId == ARCH_FLUID_LH2 ||
    archetypeId == ARCH_FLUID_RP1 ||
    archetypeId == ARCH_FLUID_CH4 ||
    archetypeId == ARCH_FLUID_N2O4 ||
    archetypeId == ARCH_FLUID_MMH
  ) {
    const tRef = getCon(slotPtr, conCount, 0, 90.19);
    const rhoRef = Math.max(1.0, getCon(slotPtr, conCount, 1, 1141.0));
    const cp = Math.max(100.0, getCon(slotPtr, conCount, 2, 1699.0));
    const alphaT = getCon(slotPtr, conCount, 3, 0.0043);
    const kappaP = Math.max(1e-12, getCon(slotPtr, conCount, 4, 1.5e-9));
    const hRef = getCon(slotPtr, conCount, 5, -133400.0);

    const pUse = pIn > 1e3 ? pIn : P_REF_STD;
    const tUse = getIo(slotPtr, 2) > 1.0 ? getIo(slotPtr, 2) : tRef;
    const dT = tUse - tRef;
    const dP = pUse - P_REF_STD;

    const isCryogenic =
      archetypeId == ARCH_FLUID_LOX ||
      archetypeId == ARCH_FLUID_LH2 ||
      archetypeId == ARCH_FLUID_CH4;

    let rho: f64;
    let bEff: f64;
    if (isCryogenic) {
      // Nonlinear Tait real-fluid cryogenic liquid EOS:
      // B(T) = (1 / kappa_P) * exp(-2.5 * alpha_T * dT), C_tait = 0.0894
      const cTait: f64 = 0.0894;
      const b0 = (1.0 / kappaP) * Math.exp(clamp(-2.5 * alphaT * dT, -2.5, 2.5));
      const rhoSat = rhoRef * Math.exp(clamp(-alphaT * dT - 0.5 * alphaT * alphaT * dT * dT, -1.5, 0.6));
      const pTerm = dP > 0.0 ? cTait * Math.log(1.0 + dP / (cTait * b0)) : dP / b0;
      const denom = clamp(1.0 - pTerm, 0.35, 2.5);
      rho = rhoSat / denom;
      bEff = b0 * (1.0 + Math.max(0.0, dP) / (cTait * b0));
    } else {
      const factor = clamp(1.0 - alphaT * dT + kappaP * dP, 0.15, 2.0);
      rho = rhoRef * factor;
      bEff = 1.0 / kappaP;
    }

    // Exact thermodynamic Maxwell relation: (dh/dP)_T = (1 - alpha_T * T) / rho
    const enthalpy = hRef + cp * dT + ((1.0 - alphaT * tUse) * dP) / rho;
    const soundSpeed = Math.sqrt(bEff / Math.max(1.0, rho));

    setIo(slotPtr, 1, pUse);
    setIo(slotPtr, 3, tUse);
    setIo(slotPtr, 5, mdotIn);
    setIo(slotPtr, 10, rho);
    setIo(slotPtr, 11, enthalpy);
    setIo(slotPtr, 15, soundSpeed);
    return;
  }
}

/**
 * Advances a ROCETS module by one Heun (RK2) step of size `dt`.
 */
export function rocetsModelStep(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const nStates = stateCountForArchetype(archetypeId);
  if (nStates == 0 || dt <= 0.0) {
    rocetsModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
    return;
  }

  const y0_0 = getState(slotPtr, 0);
  const y0_1 = getState(slotPtr, 1);

  rocetsModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
  const k1_0 = getDState(slotPtr, 0);
  const k1_1 = getDState(slotPtr, 1);

  setState(slotPtr, 0, y0_0 + dt * k1_0);
  if (nStates > 1) setState(slotPtr, 1, y0_1 + dt * k1_1);

  rocetsModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
  const k2_0 = getDState(slotPtr, 0);
  const k2_1 = getDState(slotPtr, 1);

  setState(slotPtr, 0, y0_0 + 0.5 * dt * (k1_0 + k2_0));
  if (nStates > 1) setState(slotPtr, 1, y0_1 + 0.5 * dt * (k1_1 + k2_1));

  // Re-sync outputs after Heun corrector
  rocetsModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
}

/**
 * Computes max `|dstate/dt|` immediately after initialization to verify flat-start equilibrium.
 */
export function rocetsModelCheckFlatStart(archetypeId: i32, slotPtr: usize, conCount: i32): f64 {
  rocetsModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
  const nStates = stateCountForArchetype(archetypeId);
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
export function rocetsBatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    rocetsModelInit(archetypeId, slotPtr, conCount);
  }
}

/**
 * Batched zero-copy Heun time-step across `count` model descriptors.
 */
export function rocetsBatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    rocetsModelStep(archetypeId, t, dt, slotPtr, conCount);
  }
}
