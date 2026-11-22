// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript thermodynamic & electrification runtime for `@modelscript/gtsuite-std-lib`.
 *
 * Uses a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — GT-SUITE template parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — inter-component I/O bus:
 *       IO[0]  = pIn (Pa)
 *       IO[1]  = tIn (K)
 *       IO[2]  = pOut (Pa)
 *       IO[3]  = tOut (K)
 *       IO[4]  = massFlow (kg/s)
 *       IO[5]  = crankAngleDeg (deg)
 *       IO[6]  = burnFraction (0..1)
 *       IO[7]  = heatTransferCoeff (W/(m^2*K))
 *       IO[8]  = powerW (W)
 *       IO[9]  = speedRpm (rpm)
 *       IO[10] = qHeatW (W)
 *       IO[11] = tempK (K)
 *       IO[12] = currentA (A, positive = discharge)
 *       IO[13] = voltageV (V)
 *       IO[14] = soc (0..1)
 *       IO[15] = auxOut (burn rate, pressure drop, or specific enthalpy change)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `GtSuiteArchetypeId` in gtsuite-std-schemas.ts)
const ARCH_PIPE_1D: i32 = 1;
const ARCH_FLOW_SPLIT: i32 = 2;
const ARCH_ORIFICE_FLOW: i32 = 3;
const ARCH_ENVIRONMENT_BC: i32 = 4;
const ARCH_ENG_CYLINDER: i32 = 10;
const ARCH_COMB_WIEBE: i32 = 11;
const ARCH_HEAT_TR_WOSCHNI: i32 = 12;
const ARCH_COMPRESSOR: i32 = 20;
const ARCH_TURBINE: i32 = 21;
const ARCH_SHAFT_TURBO: i32 = 22;
const ARCH_INJECTOR: i32 = 23;
const ARCH_HEAT_EXCHANGER: i32 = 30;
const ARCH_THERMAL_MASS: i32 = 31;
const ARCH_BATTERY_THEVENIN: i32 = 40;
const ARCH_ELECTRIC_MOTOR: i32 = 41;
const ARCH_INVERTER: i32 = 42;
const ARCH_COOLANT_PUMP: i32 = 43;
const ARCH_FLUID_PROPS: i32 = 50;

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
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function gtGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes GT-SUITE component states for steady-state / initial conditions.
 * Returns the number of active dynamic states for the archetype.
 */
export function gtModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  for (let i = 0; i < 4; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }

  const pIn = getIo(slotPtr, 0) > 1.0 ? getIo(slotPtr, 0) : 101325.0;
  const tIn = getIo(slotPtr, 1) > 1.0 ? getIo(slotPtr, 1) : 300.0;

  if (archetypeId == ARCH_PIPE_1D) {
    // 1D Finite-Volume Euler wave-action discretization: N = 8 cells x 3 conserved vars (rho, rho*u, rho*E)
    const diam = Math.max(1e-4, getCon(slotPtr, conCount, 0, 0.05));
    const area = 0.25 * Math.PI * diam * diam;
    const gamma: f64 = 1.4;
    const rGas: f64 = 287.05;
    const rho0 = pIn / (rGas * tIn);
    const mdot0 = getIo(slotPtr, 4);
    const u0 = mdot0 / (rho0 * area);
    const mom0 = rho0 * u0;
    const e0 = pIn / (gamma - 1.0) + 0.5 * rho0 * u0 * u0;

    for (let c: i32 = 0; c < 8; c++) {
      setState(slotPtr, c * 3 + 0, rho0);
      setState(slotPtr, c * 3 + 1, mom0);
      setState(slotPtr, c * 3 + 2, e0);
      setDState(slotPtr, c * 3 + 0, 0.0);
      setDState(slotPtr, c * 3 + 1, 0.0);
      setDState(slotPtr, c * 3 + 2, 0.0);
    }
    setIo(slotPtr, 2, pIn);
    setIo(slotPtr, 3, tIn);
    setIo(slotPtr, 15, pIn);
    return 24;
  }

  if (archetypeId == ARCH_FLOW_SPLIT) {
    // State 0: P (Pa), State 1: T (K)
    const p0 = getCon(slotPtr, conCount, 1, pIn);
    const t0 = getCon(slotPtr, conCount, 2, tIn);
    setState(slotPtr, 0, p0);
    setState(slotPtr, 1, t0);
    setIo(slotPtr, 2, p0);
    setIo(slotPtr, 3, t0);
    return 2;
  }

  if (archetypeId == ARCH_ENG_CYLINDER) {
    // State 0: P_cyl (Pa), State 1: T_cyl (K)
    setState(slotPtr, 0, pIn);
    setState(slotPtr, 1, tIn);
    return 2;
  }

  if (archetypeId == ARCH_SHAFT_TURBO) {
    // State 0: omega (rad/s)
    const rpm0 = getIo(slotPtr, 9) > 1.0 ? getIo(slotPtr, 9) : getCon(slotPtr, conCount, 1, 80000.0);
    const omega0 = (rpm0 * 2.0 * Math.PI) / 60.0;
    setState(slotPtr, 0, omega0);
    setIo(slotPtr, 9, rpm0);
    return 1;
  }

  if (archetypeId == ARCH_THERMAL_MASS) {
    // State 0: T (K)
    const t0 = getCon(slotPtr, conCount, 2, 300.0);
    setState(slotPtr, 0, t0);
    setIo(slotPtr, 11, t0);
    setIo(slotPtr, 3, t0);
    return 1;
  }

  if (archetypeId == ARCH_BATTERY_THEVENIN) {
    // State 0: SoC (0..1), State 1: vRc (V)
    const soc0 = clamp(getCon(slotPtr, conCount, 5, 0.8), 0.0, 1.0);
    const vNom = getCon(slotPtr, conCount, 1, 350.0);
    const vOc = vNom * (0.88 + 0.2 * soc0);
    setState(slotPtr, 0, soc0);
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 13, vOc);
    setIo(slotPtr, 14, soc0);
    return 2;
  }

  return 0;
}

/**
 * Evaluates cleanroom continuous-time derivatives `dstate/dt` and algebraic outputs for a GT-SUITE archetype.
 */
export function gtModelEvalDerivatives(
  archetypeId: i32,
  _t: f64,
  _dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const pIn = getIo(slotPtr, 0) > 1.0 ? getIo(slotPtr, 0) : 101325.0;
  const tIn = getIo(slotPtr, 1) > 1.0 ? getIo(slotPtr, 1) : 300.0;
  const pOutRaw = getIo(slotPtr, 2);
  const pOut = pOutRaw > 1.0 ? pOutRaw : 101325.0;
  const mdotIn = getIo(slotPtr, 4);

  // 1. Wiebe combustion burn fraction: x_b(theta) = 1 - exp(-a * ((theta - theta0) / dTheta)^(m + 1))
  if (archetypeId == ARCH_COMB_WIEBE) {
    const theta0 = getCon(slotPtr, conCount, 0, -10.0);
    const dTheta = Math.max(1e-3, getCon(slotPtr, conCount, 1, 50.0));
    const m = Math.max(0.0, getCon(slotPtr, conCount, 2, 2.0));
    const a = Math.max(0.0, getCon(slotPtr, conCount, 3, 5.0));
    const theta = getIo(slotPtr, 5);

    if (theta <= theta0) {
      setIo(slotPtr, 6, 0.0);
      setIo(slotPtr, 15, 0.0);
    } else {
      const u = (theta - theta0) / dTheta;
      const exponent = -a * Math.pow(u, m + 1.0);
      const expTerm = Math.exp(exponent);
      const xb = clamp(1.0 - expTerm, 0.0, 1.0);
      const dxb = ((a * (m + 1.0)) / dTheta) * Math.pow(u, m) * expTerm;
      setIo(slotPtr, 6, xb);
      setIo(slotPtr, 15, dxb);
    }
    return;
  }

  // 2. Isentropic compressible orifice flow (subsonic & choked regimes)
  if (archetypeId == ARCH_ORIFICE_FLOW) {
    const diam = Math.max(1e-4, getCon(slotPtr, conCount, 0, 0.04));
    const cd = clamp(getCon(slotPtr, conCount, 1, 0.85), 0.0, 2.0);
    const gamma = Math.max(1.05, getCon(slotPtr, conCount, 2, 1.4));
    const rGas = Math.max(50.0, getCon(slotPtr, conCount, 3, 287.05));
    const openFrac = clamp(getCon(slotPtr, conCount, 4, 1.0), 0.0, 1.0);

    const area = 0.25 * Math.PI * diam * diam * openFrac;
    const sign: f64 = pIn >= pOut ? 1.0 : -1.0;
    const pUp = sign > 0.0 ? pIn : pOut;
    const pDn = sign > 0.0 ? pOut : pIn;
    const tUp = tIn;

    let mdot: f64 = 0.0;
    if (pUp > pDn && area > 0.0) {
      const pr = pDn / pUp;
      const gm1 = gamma - 1.0;
      const gp1 = gamma + 1.0;
      const pCrit = Math.pow(2.0 / gp1, gamma / gm1);
      const coeff = (cd * area * pUp) / Math.sqrt(rGas * tUp);
      if (pr <= pCrit) {
        // Choked (sonic) flow
        mdot = coeff * Math.sqrt(gamma * Math.pow(2.0 / gp1, gp1 / gm1));
      } else {
        // Subsonic isentropic flow
        const term = Math.pow(pr, 2.0 / gamma) - Math.pow(pr, gp1 / gamma);
        mdot = term > 0.0 ? coeff * Math.sqrt(((2.0 * gamma) / gm1) * term) : 0.0;
      }
    }
    setIo(slotPtr, 4, sign * mdot);
    setIo(slotPtr, 3, tUp);
    setIo(slotPtr, 15, pIn - pOut);
    return;
  }

  // 3. Compressor with 2D corrected-speed / pressure-ratio efficiency map
  if (archetypeId == ARCH_COMPRESSOR) {
    const prParam = Math.max(1.001, getCon(slotPtr, conCount, 0, 2.0));
    const etaDes = clamp(getCon(slotPtr, conCount, 1, 0.75), 0.1, 1.0);
    const gamma = Math.max(1.05, getCon(slotPtr, conCount, 2, 1.4));
    const cp = Math.max(100.0, getCon(slotPtr, conCount, 3, 1005.0));
    const designMassFlow = Math.max(1e-6, getCon(slotPtr, conCount, 4, 0.15));
    const mdot = mdotIn > 1e-9 ? mdotIn : designMassFlow;

    const pr = pOutRaw > pIn ? pOutRaw / pIn : prParam;
    const rpmIn = getIo(slotPtr, 9);
    const nDes: f64 = 100000.0;
    const nCorrNorm = rpmIn > 1.0 ? (rpmIn * Math.sqrt(300.0 / tIn)) / nDes : 1.0;
    const prNorm = (pr - 1.0) / Math.max(0.05, prParam - 1.0);
    const mCorr = mdot * (Math.sqrt(tIn / 300.0) / (pIn / 100000.0));
    const mCorrNorm = mCorr / designMassFlow;

    // 2D elliptic compressor map efficiency island centered on design ridge PR_opt ~ N_corr^2
    const dN = nCorrNorm - 1.0;
    const dPr = prNorm - nCorrNorm * nCorrNorm;
    const dM = mCorrNorm - nCorrNorm;
    const etaMap = clamp(etaDes * Math.exp(-0.45 * dN * dN - 0.35 * dPr * dPr - 0.2 * dM * dM), 0.25, 0.95);

    const t2s = tIn * Math.pow(pr, (gamma - 1.0) / gamma);
    const t2 = tIn + (t2s - tIn) / etaMap;
    const deltaH = cp * (t2 - tIn);
    const powerW = mdot * deltaH;

    setIo(slotPtr, 2, pIn * pr);
    setIo(slotPtr, 3, t2);
    setIo(slotPtr, 8, powerW);
    setIo(slotPtr, 15, deltaH);
    return;
  }

  // 4. Turbine with 2D corrected-speed / expansion-ratio efficiency map
  if (archetypeId == ARCH_TURBINE) {
    const erParam = Math.max(1.001, getCon(slotPtr, conCount, 0, 2.0));
    const etaDes = clamp(getCon(slotPtr, conCount, 1, 0.72), 0.1, 1.0);
    const gamma = Math.max(1.05, getCon(slotPtr, conCount, 2, 1.34));
    const cp = Math.max(100.0, getCon(slotPtr, conCount, 3, 1150.0));
    const mdot = mdotIn > 1e-9 ? mdotIn : getCon(slotPtr, conCount, 4, 0.15);

    const er = pOutRaw > 1.0 && pIn > pOutRaw ? pIn / pOutRaw : erParam;
    const exp = -(gamma - 1.0) / gamma;
    const erTerm = Math.max(1e-4, 1.0 - Math.pow(er, exp));
    const erDesTerm = Math.max(1e-4, 1.0 - Math.pow(erParam, exp));

    const rpmIn = getIo(slotPtr, 9);
    const nDes: f64 = 100000.0;
    const nCorrNorm = rpmIn > 1.0 ? (rpmIn * Math.sqrt(300.0 / tIn)) / nDes : 1.0;
    // Normalized blade-speed ratio U/C0 relative to design point
    const uOverC0 = nCorrNorm / Math.sqrt(erTerm / erDesTerm);
    const etaMap = clamp(
      etaDes * (1.0 - 0.65 * (uOverC0 - 1.0) * (uOverC0 - 1.0) - 0.15 * (nCorrNorm - 1.0) * (nCorrNorm - 1.0)),
      0.2,
      0.95,
    );

    const t2s = tIn * Math.pow(er, exp);
    const t2 = tIn - etaMap * (tIn - t2s);
    const deltaH = cp * (tIn - t2);
    const powerW = mdot * deltaH;

    setIo(slotPtr, 2, pIn / er);
    setIo(slotPtr, 3, t2);
    setIo(slotPtr, 8, powerW);
    setIo(slotPtr, 15, deltaH);
    return;
  }

  // 5. Woschni convective heat transfer coefficient (Heywood Eq. 12.18)
  if (archetypeId == ARCH_HEAT_TR_WOSCHNI) {
    const bore = Math.max(0.01, getCon(slotPtr, conCount, 0, 0.086));
    const stroke = Math.max(0.01, getCon(slotPtr, conCount, 1, 0.086));
    const tWall = Math.max(200.0, getCon(slotPtr, conCount, 2, 450.0));
    const c1 = Math.max(0.1, getCon(slotPtr, conCount, 3, 2.28));
    const mult = Math.max(0.0, getCon(slotPtr, conCount, 4, 1.0));

    const rpm = getIo(slotPtr, 9) > 1.0 ? getIo(slotPtr, 9) : 2000.0;
    const meanPistonSpeed = 2.0 * stroke * (rpm / 60.0);
    const w = Math.max(0.1, c1 * meanPistonSpeed);
    const pKpa = pIn * 1e-3;
    const hc =
      3.26 *
      Math.pow(bore, -0.2) *
      Math.pow(pKpa, 0.8) *
      Math.pow(tIn, -0.55) *
      Math.pow(w, 0.8) *
      mult;
    const area = Math.PI * bore * stroke;
    const qHeat = hc * area * (tIn - tWall);

    setIo(slotPtr, 7, hc);
    setIo(slotPtr, 10, qHeat);
    return;
  }

  // 6. 1st-order lumped thermal mass: m * cp * dT/dt = Q_in - hA * (T - T_amb)
  if (archetypeId == ARCH_THERMAL_MASS) {
    const mass = Math.max(1e-4, getCon(slotPtr, conCount, 0, 10.0));
    const cp = Math.max(1.0, getCon(slotPtr, conCount, 1, 500.0));
    const hA = Math.max(0.0, getCon(slotPtr, conCount, 3, 5.0));
    const tAmb = getCon(slotPtr, conCount, 4, 300.0);
    const qIn = getIo(slotPtr, 10);

    const temp = getState(slotPtr, 0);
    const dTdt = (qIn - hA * (temp - tAmb)) / (mass * cp);
    setDState(slotPtr, 0, dTdt);
    setIo(slotPtr, 11, temp);
    setIo(slotPtr, 3, temp);
    return;
  }

  // 7. Thévenin equivalent-circuit battery (R0 + R1||C1) with Coulomb-counting SoC
  if (archetypeId == ARCH_BATTERY_THEVENIN) {
    const capAh = Math.max(1e-3, getCon(slotPtr, conCount, 0, 60.0));
    const vNom = Math.max(1.0, getCon(slotPtr, conCount, 1, 350.0));
    const r0 = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.05));
    const r1 = Math.max(1e-6, getCon(slotPtr, conCount, 3, 0.02));
    const c1 = Math.max(1e-3, getCon(slotPtr, conCount, 4, 1000.0));

    const currentA = getIo(slotPtr, 12); // positive = discharge
    const soc = clamp(getState(slotPtr, 0), 0.0, 1.0);
    const vRc = getState(slotPtr, 1);

    const dSocDt = -currentA / (capAh * 3600.0);
    const dVRcDt = currentA / c1 - vRc / (r1 * c1);
    const vOc = vNom * (0.88 + 0.2 * soc);
    const vTerm = vOc - currentA * r0 - vRc;

    setDState(slotPtr, 0, dSocDt);
    setDState(slotPtr, 1, dVRcDt);
    setIo(slotPtr, 13, vTerm);
    setIo(slotPtr, 14, soc);
    setIo(slotPtr, 8, vTerm * currentA);
    return;
  }

  // 8. 1D Finite-Volume Euler Wave-Action Pipe (N = 8 cells, HLL Riemann flux)
  if (archetypeId == ARCH_PIPE_1D) {
    const diam = Math.max(1e-4, getCon(slotPtr, conCount, 0, 0.05));
    const length = Math.max(1e-4, getCon(slotPtr, conCount, 1, 0.5));
    const fDarcy = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.02));
    const area = 0.25 * Math.PI * diam * diam;
    const dx = length / 8.0;
    const gamma: f64 = 1.4;
    const gm1: f64 = gamma - 1.0;
    const rGas: f64 = 287.05;

    // Left boundary ghost cell (subsonic pressure/temperature inlet)
    const rhoC0 = Math.max(1e-5, getState(slotPtr, 0));
    const uC0 = getState(slotPtr, 1) / rhoC0;
    const rhoL = Math.max(1e-5, pIn / (rGas * tIn));
    const uL = Math.abs(mdotIn) > 1e-9 ? mdotIn / (rhoL * area) : uC0;
    const mL = rhoL * uL;
    const eL = pIn / gm1 + 0.5 * rhoL * uL * uL;

    // Right boundary ghost cell (subsonic pressure outlet)
    const rhoC7 = Math.max(1e-5, getState(slotPtr, 21));
    const mC7 = getState(slotPtr, 22);
    const eC7 = getState(slotPtr, 23);
    const uC7 = mC7 / rhoC7;
    const pC7 = Math.max(100.0, gm1 * (eC7 - 0.5 * mC7 * uC7));
    const pR = pOutRaw > 1.0 ? pOutRaw : 101325.0;
    const rhoR = Math.max(1e-5, rhoC7 * Math.pow(pR / pC7, 1.0 / gamma));
    const uR = uC7;
    const mR = rhoR * uR;
    const eR = pR / gm1 + 0.5 * rhoR * uR * uR;

    // Zero cell derivatives before accumulating HLL interface fluxes
    for (let c: i32 = 0; c < 24; c++) {
      setDState(slotPtr, c, 0.0);
    }

    // Loop over all 9 interfaces (face 0 = L|0, faces 1..7 = internal, face 8 = 7|R)
    for (let face: i32 = 0; face <= 8; face++) {
      let r1: f64;
      let m1: f64;
      let e1: f64;
      if (face == 0) {
        r1 = rhoL;
        m1 = mL;
        e1 = eL;
      } else {
        const idxL = (face - 1) * 3;
        r1 = Math.max(1e-5, getState(slotPtr, idxL + 0));
        m1 = getState(slotPtr, idxL + 1);
        e1 = getState(slotPtr, idxL + 2);
      }

      let r2: f64;
      let m2: f64;
      let e2: f64;
      if (face == 8) {
        r2 = rhoR;
        m2 = mR;
        e2 = eR;
      } else {
        const idxR = face * 3;
        r2 = Math.max(1e-5, getState(slotPtr, idxR + 0));
        m2 = getState(slotPtr, idxR + 1);
        e2 = getState(slotPtr, idxR + 2);
      }

      const u1 = m1 / r1;
      const p1 = Math.max(100.0, gm1 * (e1 - 0.5 * m1 * u1));
      const c1 = Math.sqrt((gamma * p1) / r1);

      const u2 = m2 / r2;
      const p2 = Math.max(100.0, gm1 * (e2 - 0.5 * m2 * u2));
      const c2 = Math.sqrt((gamma * p2) / r2);

      // Physical Euler fluxes
      const f1_0 = m1;
      const f1_1 = m1 * u1 + p1;
      const f1_2 = u1 * (e1 + p1);

      const f2_0 = m2;
      const f2_1 = m2 * u2 + p2;
      const f2_2 = u2 * (e2 + p2);

      // HLL approximate Riemann solver wave speeds
      const sL = Math.min(u1 - c1, u2 - c2);
      const sR = Math.max(u1 + c1, u2 + c2);

      let fh0: f64;
      let fh1: f64;
      let fh2: f64;
      if (sL >= 0.0) {
        fh0 = f1_0;
        fh1 = f1_1;
        fh2 = f1_2;
      } else if (sR <= 0.0) {
        fh0 = f2_0;
        fh1 = f2_1;
        fh2 = f2_2;
      } else {
        const invDen = 1.0 / Math.max(1e-9, sR - sL);
        fh0 = (sR * f1_0 - sL * f2_0 + sL * sR * (r2 - r1)) * invDen;
        fh1 = (sR * f1_1 - sL * f2_1 + sL * sR * (m2 - m1)) * invDen;
        fh2 = (sR * f1_2 - sL * f2_2 + sL * sR * (e2 - e1)) * invDen;
      }

      const invDx = 1.0 / dx;
      if (face > 0) {
        const idxL = (face - 1) * 3;
        setDState(slotPtr, idxL + 0, getDState(slotPtr, idxL + 0) - fh0 * invDx);
        setDState(slotPtr, idxL + 1, getDState(slotPtr, idxL + 1) - fh1 * invDx);
        setDState(slotPtr, idxL + 2, getDState(slotPtr, idxL + 2) - fh2 * invDx);
      }
      if (face < 8) {
        const idxR = face * 3;
        setDState(slotPtr, idxR + 0, getDState(slotPtr, idxR + 0) + fh0 * invDx);
        setDState(slotPtr, idxR + 1, getDState(slotPtr, idxR + 1) + fh1 * invDx);
        setDState(slotPtr, idxR + 2, getDState(slotPtr, idxR + 2) + fh2 * invDx);
      }
    }

    // Add Darcy-Weisbach wall friction source term to momentum equation in each cell
    for (let c: i32 = 0; c < 8; c++) {
      const idx = c * 3;
      const rc = Math.max(1e-5, getState(slotPtr, idx + 0));
      const mc = getState(slotPtr, idx + 1);
      const uc = mc / rc;
      const sFric = -(fDarcy / (2.0 * diam)) * rc * uc * Math.abs(uc);
      setDState(slotPtr, idx + 1, getDState(slotPtr, idx + 1) + sFric);
    }

    // Read midpoint cell (cell 3) and outlet cell (cell 7) pressures & temperatures
    const rhoMid = Math.max(1e-5, getState(slotPtr, 9));
    const mMid = getState(slotPtr, 10);
    const eMid = getState(slotPtr, 11);
    const uMid = mMid / rhoMid;
    const pMid = Math.max(100.0, gm1 * (eMid - 0.5 * mMid * uMid));

    const tOutCell = pC7 / (rhoC7 * rGas);
    setIo(slotPtr, 2, pC7);
    setIo(slotPtr, 3, tOutCell);
    setIo(slotPtr, 4, mC7 * area);
    setIo(slotPtr, 15, pMid);
    return;
  }

  // 9. 0D Flow Split / Plenum
  if (archetypeId == ARCH_FLOW_SPLIT) {
    const vol = Math.max(1e-6, getCon(slotPtr, conCount, 0, 0.002));
    const gamma = Math.max(1.05, getCon(slotPtr, conCount, 3, 1.4));
    const rGas = Math.max(50.0, getCon(slotPtr, conCount, 4, 287.05));
    const p = getState(slotPtr, 0);
    const temp = getState(slotPtr, 1);
    const dPdt = ((gamma * rGas * temp) / vol) * mdotIn;
    setDState(slotPtr, 0, dPdt);
    setDState(slotPtr, 1, 0.0);
    setIo(slotPtr, 2, p);
    setIo(slotPtr, 3, temp);
    return;
  }

  // 10. Ambient Environment Boundary
  if (archetypeId == ARCH_ENVIRONMENT_BC) {
    const pEnv = getCon(slotPtr, conCount, 0, 101325.0);
    const tEnv = getCon(slotPtr, conCount, 1, 298.15);
    setIo(slotPtr, 2, pEnv);
    setIo(slotPtr, 3, tEnv);
    return;
  }

  // 11. Engine Cylinder (slider-crank instantaneous volume & polytropic pressure)
  if (archetypeId == ARCH_ENG_CYLINDER) {
    const bore = Math.max(0.01, getCon(slotPtr, conCount, 0, 0.086));
    const stroke = Math.max(0.01, getCon(slotPtr, conCount, 1, 0.086));
    const conRod = Math.max(stroke, getCon(slotPtr, conCount, 2, 0.145));
    const cr = Math.max(2.0, getCon(slotPtr, conCount, 3, 10.5));
    const gamma = Math.max(1.05, getCon(slotPtr, conCount, 4, 1.35));

    const thetaRad = (getIo(slotPtr, 5) * Math.PI) / 180.0;
    const aCrank = 0.5 * stroke;
    const vDisp = 0.25 * Math.PI * bore * bore * stroke;
    const vClear = vDisp / (cr - 1.0);
    const sPos = aCrank * Math.cos(thetaRad) + Math.sqrt(conRod * conRod - aCrank * aCrank * Math.sin(thetaRad) * Math.sin(thetaRad));
    const distFromTdc = aCrank + conRod - sPos;
    const vol = vClear + 0.25 * Math.PI * bore * bore * distFromTdc;
    const pPoly = pIn * Math.pow((vClear + vDisp) / vol, gamma);
    setIo(slotPtr, 2, pPoly);
    setIo(slotPtr, 15, vol);
    return;
  }

  // 12. Turbocharger Rotor Shaft
  if (archetypeId == ARCH_SHAFT_TURBO) {
    const inertia = Math.max(1e-7, getCon(slotPtr, conCount, 0, 3.5e-5));
    const bFric = Math.max(0.0, getCon(slotPtr, conCount, 2, 1.0e-5));
    const omega = Math.max(1.0, getState(slotPtr, 0));
    const pNet = getIo(slotPtr, 8);
    const dOmegaDt = (pNet / omega - bFric * omega) / inertia;
    setDState(slotPtr, 0, dOmegaDt);
    setIo(slotPtr, 9, (omega * 60.0) / (2.0 * Math.PI));
    return;
  }

  // 13. Sequential Fuel Injector
  if (archetypeId == ARCH_INJECTOR) {
    const afr = Math.max(1.0, getCon(slotPtr, conCount, 0, 14.7));
    const lhv = Math.max(1.0, getCon(slotPtr, conCount, 1, 4.4e7));
    const mFuel = mdotIn / afr;
    setIo(slotPtr, 10, mFuel * lhv);
    setIo(slotPtr, 15, mFuel);
    return;
  }

  // 14. Effectiveness-NTU Heat Exchanger
  if (archetypeId == ARCH_HEAT_EXCHANGER) {
    const eps = clamp(getCon(slotPtr, conCount, 0, 0.8), 0.0, 1.0);
    const tCool = getCon(slotPtr, conCount, 1, 320.0);
    const cp = Math.max(100.0, getCon(slotPtr, conCount, 2, 1005.0));
    const kDp = Math.max(0.0, getCon(slotPtr, conCount, 3, 5000.0));
    const tOut = tIn - eps * (tIn - tCool);
    const dp = kDp * mdotIn * mdotIn;
    setIo(slotPtr, 2, Math.max(1.0, pIn - dp));
    setIo(slotPtr, 3, tOut);
    setIo(slotPtr, 10, mdotIn * cp * (tIn - tOut));
    setIo(slotPtr, 15, dp);
    return;
  }

  // 15. Electric Motor
  if (archetypeId == ARCH_ELECTRIC_MOTOR) {
    const maxP = Math.max(1.0, getCon(slotPtr, conCount, 0, 150000.0));
    const eta = clamp(getCon(slotPtr, conCount, 1, 0.94), 0.1, 1.0);
    const pCmd = clamp(getIo(slotPtr, 8), -maxP, maxP);
    const pLoss = Math.abs(pCmd) * (1.0 / eta - 1.0);
    setIo(slotPtr, 10, pLoss);
    setIo(slotPtr, 15, pCmd * eta);
    return;
  }

  // 16. DC/AC Inverter
  if (archetypeId == ARCH_INVERTER) {
    const eta = clamp(getCon(slotPtr, conCount, 0, 0.97), 0.1, 1.0);
    const idleLoss = Math.max(0.0, getCon(slotPtr, conCount, 2, 50.0));
    const pInW = getIo(slotPtr, 8);
    const pLoss = Math.abs(pInW) * (1.0 - eta) + idleLoss;
    setIo(slotPtr, 10, pLoss);
    setIo(slotPtr, 15, pInW - pLoss);
    return;
  }

  // 17. Centrifugal Coolant Pump (affinity laws)
  if (archetypeId == ARCH_COOLANT_PUMP) {
    const nRef = Math.max(1.0, getCon(slotPtr, conCount, 0, 3000.0));
    const mRef = Math.max(0.0, getCon(slotPtr, conCount, 1, 1.5));
    const dpRef = Math.max(0.0, getCon(slotPtr, conCount, 2, 80000.0));
    const eta = clamp(getCon(slotPtr, conCount, 3, 0.7), 0.1, 1.0);
    const rho = Math.max(1.0, getCon(slotPtr, conCount, 4, 1030.0));
    const rpm = getIo(slotPtr, 9) > 0.0 ? getIo(slotPtr, 9) : nRef;
    const ratio = rpm / nRef;
    const mdot = mRef * ratio;
    const dp = dpRef * ratio * ratio;
    const pHyd = (mdot / rho) * dp;
    setIo(slotPtr, 4, mdot);
    setIo(slotPtr, 2, pIn + dp);
    setIo(slotPtr, 8, pHyd / eta);
    setIo(slotPtr, 15, dp);
    return;
  }

  // 18. Fluid Properties (NASA-9 linearized cp & density)
  if (archetypeId == ARCH_FLUID_PROPS) {
    const rGas = Math.max(1.0, getCon(slotPtr, conCount, 0, 287.05));
    const cpRef = Math.max(100.0, getCon(slotPtr, conCount, 1, 1005.0));
    const slope = getCon(slotPtr, conCount, 3, 0.12);
    const cp = cpRef + slope * (tIn - 300.0);
    const rho = pIn / (rGas * tIn);
    setIo(slotPtr, 15, cp);
    setIo(slotPtr, 4, rho);
  }
}

/**
 * Advances a GT-SUITE component slot by `dt` seconds.
 * Uses CFL-substepped 1D Finite-Volume HLL integration for `ARCH_PIPE_1D` (24 conserved states),
 * and 2nd-order Heun integration for lumped ODE archetypes.
 */
export function gtModelStep(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  if (archetypeId == ARCH_PIPE_1D) {
    if (dt <= 0.0) {
      gtModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
      return;
    }
    // Preserve caller boundary conditions across substeps (eval overwrites IO[2..4] with outlet cell values)
    const pOutBc = getIo(slotPtr, 2);
    const mdotBc = getIo(slotPtr, 4);
    const length = Math.max(1e-4, getCon(slotPtr, conCount, 1, 0.5));
    const dx = length / 8.0;
    const gamma: f64 = 1.4;
    const gm1: f64 = gamma - 1.0;

    // Compute maximum acoustic wave speed |u| + c across cells for CFL stability (CFL <= 0.4)
    let maxWave: f64 = 350.0;
    for (let c: i32 = 0; c < 8; c++) {
      const idx = c * 3;
      const rc = Math.max(1e-5, getState(slotPtr, idx + 0));
      const mc = getState(slotPtr, idx + 1);
      const ec = getState(slotPtr, idx + 2);
      const uc = mc / rc;
      const pc = Math.max(100.0, gm1 * (ec - 0.5 * mc * uc));
      const cc = Math.sqrt((gamma * pc) / rc);
      const w = Math.abs(uc) + cc;
      if (w > maxWave) maxWave = w;
    }
    const dtCfl = (0.35 * dx) / maxWave;
    let nSub = <i32>Math.ceil(dt / dtCfl);
    if (nSub < 1) nSub = 1;
    if (nSub > 250) nSub = 250;
    const subDt = dt / (<f64>nSub);

    for (let s: i32 = 0; s < nSub; s++) {
      setIo(slotPtr, 2, pOutBc);
      setIo(slotPtr, 4, mdotBc);
      gtModelEvalDerivatives(archetypeId, t + (<f64>s) * subDt, subDt, slotPtr, conCount);
      for (let k: i32 = 0; k < 24; k++) {
        let nextVal = getState(slotPtr, k) + subDt * getDState(slotPtr, k);
        // Enforce positive density and total energy
        if (k % 3 == 0 && nextVal < 1e-5) nextVal = 1e-5;
        if (k % 3 == 2 && nextVal < 100.0) nextVal = 100.0;
        setState(slotPtr, k, nextVal);
      }
    }
    // Final output sync
    setIo(slotPtr, 2, pOutBc);
    setIo(slotPtr, 4, mdotBc);
    gtModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
    return;
  }

  const y0_0 = getState(slotPtr, 0);
  const y0_1 = getState(slotPtr, 1);
  const y0_2 = getState(slotPtr, 2);
  const y0_3 = getState(slotPtr, 3);

  gtModelEvalDerivatives(archetypeId, t, dt, slotPtr, conCount);
  const k1_0 = getDState(slotPtr, 0);
  const k1_1 = getDState(slotPtr, 1);
  const k1_2 = getDState(slotPtr, 2);
  const k1_3 = getDState(slotPtr, 3);

  setState(slotPtr, 0, y0_0 + dt * k1_0);
  setState(slotPtr, 1, y0_1 + dt * k1_1);
  setState(slotPtr, 2, y0_2 + dt * k1_2);
  setState(slotPtr, 3, y0_3 + dt * k1_3);

  gtModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
  const k2_0 = getDState(slotPtr, 0);
  const k2_1 = getDState(slotPtr, 1);
  const k2_2 = getDState(slotPtr, 2);
  const k2_3 = getDState(slotPtr, 3);

  setState(slotPtr, 0, y0_0 + 0.5 * dt * (k1_0 + k2_0));
  setState(slotPtr, 1, y0_1 + 0.5 * dt * (k1_1 + k2_1));
  setState(slotPtr, 2, y0_2 + 0.5 * dt * (k1_2 + k2_2));
  setState(slotPtr, 3, y0_3 + 0.5 * dt * (k1_3 + k2_3));

  // Re-sync outputs after Heun corrector
  gtModelEvalDerivatives(archetypeId, t + dt, dt, slotPtr, conCount);
}

/**
 * Computes max `|dstate/dt|` immediately after initialization to verify equilibrium.
 */
export function gtModelCheckFlatStart(archetypeId: i32, slotPtr: usize, conCount: i32): f64 {
  gtModelEvalDerivatives(archetypeId, 0.0, 0.01, slotPtr, conCount);
  const nCheck: i32 = archetypeId == ARCH_PIPE_1D ? 24 : 4;
  let maxRes: f64 = 0.0;
  for (let i: i32 = 0; i < nCheck; i++) {
    const d = Math.abs(getDState(slotPtr, i));
    if (d > maxRes) maxRes = d;
  }
  return maxRes;
}

/**
 * Batched zero-copy initialization across `count` model descriptors:
 * each descriptor is 16 bytes `{ archetypeId: i32, slotPtr: u32, reserved: i32, conCount: i32 }`.
 */
export function gtBatchInit(count: i32, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    gtModelInit(archetypeId, slotPtr, conCount);
  }
}

/**
 * Batched zero-copy Heun time-step across `count` model descriptors.
 */
export function gtBatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const conCount = load<i32>(entry + 12);
    gtModelStep(archetypeId, t, dt, slotPtr, conCount);
  }
}
