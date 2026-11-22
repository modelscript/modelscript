// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript multibody element runtime for `@modelscript/simpack-std-lib`.
 *
 * Uses a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `PARAM[160]` (`f64`) — SIMPACK element parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — internal dynamic states (hydromount, PID, TF, hysteresis)
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — kinematic inputs & force/moment outputs:
 *       Inputs:
 *         IO[0] = disp (m or rad) | longitudinal creepage xi_x | longitudinal slip ratio kappa | control input u | track distance s
 *         IO[1] = vel (m/s or rad/s) | lateral creepage xi_y | tire slip angle alpha (rad) | lateral offset y
 *         IO[2] = normalLoad Fn / Fz (N)
 *         IO[3] = spin creepage phi (1/m) | camber angle gamma (rad) | control setpoint r
 *         IO[4] = forwardSpeed v0 (m/s) | lateral displacement dy (m)
 *         IO[5] = vertical displacement dz (m)
 *         IO[6] = aux4
 *         IO[7] = aux5
 *       Outputs:
 *         IO[8]  = fx (N) — primary / longitudinal force or control output y
 *         IO[9]  = fy (N) — lateral force
 *         IO[10] = fz (N) — vertical / normal force
 *         IO[11] = tx (N*m) — roll / axial torque
 *         IO[12] = ty (N*m) — pitch torque
 *         IO[13] = tz (N*m) — yaw / self-aligning / spin moment
 *         IO[14] = stiffnessEff (N/m or N/rad) — instantaneous effective tangent stiffness
 *         IO[15] = powerLoss (W) — instantaneous dissipated / slip power
 */

const OFF_PARAM: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `SimpackArchetypeId` in simpack-std-schemas.ts)
const ARCH_PTP_SPRING_DAMPER: i32 = 1;
const ARCH_CMP_BUSHING: i32 = 2;
const ARCH_CMP_BUMPSTOP: i32 = 3;
const ARCH_CMP_FRICTION: i32 = 4;
const ARCH_CMP_HYDROMOUNT: i32 = 5;
const ARCH_CMP_AIR_SPRING: i32 = 6;
const ARCH_GEAR_MESH: i32 = 7;
const ARCH_BEARING_ROLLER: i32 = 8;

const ARCH_JOINT_REVOLUTE: i32 = 20;
const ARCH_JOINT_PRISMATIC: i32 = 21;
const ARCH_JOINT_SPHERICAL: i32 = 22;
const ARCH_JOINT_UNIVERSAL: i32 = 23;
const ARCH_JOINT_CYLINDRICAL: i32 = 24;
const ARCH_JOINT_PLANAR: i32 = 25;
const ARCH_JOINT_GENERAL6DOF: i32 = 26;
const ARCH_JOINT_TRACK: i32 = 27;

const ARCH_WHEELRAIL_KALKER: i32 = 40;
const ARCH_WHEELRAIL_POLACH: i32 = 41;
const ARCH_TRACK_UIC60: i32 = 42;
const ARCH_WHEEL_S1002: i32 = 43;
const ARCH_TRACK_IRREGULARITY: i32 = 44;

const ARCH_TIRE_PACEJKA_MF: i32 = 60;
const ARCH_TIRE_FTIRE_SIMPLE: i32 = 61;
const ARCH_CTRL_PID: i32 = 70;
const ARCH_CTRL_TRANSFER_FCN: i32 = 71;
const ARCH_CTRL_LOOKUP1D: i32 = 72;

@inline
function clamp(x: f64, lo: f64, hi: f64): f64 {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

@inline
function smoothTanh(x: f64): f64 {
  if (x > 20.0) return 1.0;
  if (x < -20.0) return -1.0;
  const e2 = Math.exp(2.0 * x);
  return (e2 - 1.0) / (e2 + 1.0);
}

@inline
function getParam(slotPtr: usize, paramCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= paramCount) return fallback;
  const v = load<f64>(slotPtr + OFF_PARAM + (<usize>idx << 3));
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

@inline
function clearOutputs(slotPtr: usize): void {
  for (let i = 8; i < 16; i++) {
    setIo(slotPtr, i, 0.0);
  }
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function simpackGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes internal dynamic states for a SIMPACK element slot.
 * Returns the number of active internal states for the archetype.
 */
export function simpackModelInit(archetypeId: i32, slotPtr: usize, paramCount: i32): i32 {
  clearOutputs(slotPtr);
  for (let i = 0; i < 8; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }

  if (archetypeId == ARCH_CMP_HYDROMOUNT) {
    // State 0: fluid inertia track displacement xf, State 1: fluid velocity vf
    const x0 = getIo(slotPtr, 0);
    setState(slotPtr, 0, x0);
    setState(slotPtr, 1, 0.0);
    return 2;
  }

  if (archetypeId == ARCH_CTRL_PID) {
    // State 0: integral error, State 1: previous error
    setState(slotPtr, 0, 0.0);
    setState(slotPtr, 1, 0.0);
    return 2;
  }

  if (archetypeId == ARCH_CTRL_TRANSFER_FCN) {
    // State 0: filter output y
    const y0 = getParam(slotPtr, paramCount, 2, 0.0);
    setState(slotPtr, 0, y0);
    setIo(slotPtr, 8, y0);
    return 1;
  }

  return 0;
}

/**
 * Evaluates cleanroom SIMPACK element constitutive forces, moments, and internal states.
 */
export function simpackModelEval(
  archetypeId: i32,
  _t: f64,
  dt: f64,
  slotPtr: usize,
  paramCount: i32,
): void {
  clearOutputs(slotPtr);

  const disp = getIo(slotPtr, 0);
  const vel = getIo(slotPtr, 1);
  const normalLoad = getIo(slotPtr, 2);
  const aux1 = getIo(slotPtr, 3);
  const aux2 = getIo(slotPtr, 4);
  const aux3 = getIo(slotPtr, 5);

  // -------------------------------------------------------------------------
  // 1. Point-to-Point Spring-Damper ($F_PtP_SpringDamper)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_PTP_SPRING_DAMPER) {
    const k = getParam(slotPtr, paramCount, 0, 25000.0);
    const c = getParam(slotPtr, paramCount, 1, 1500.0);
    const l0 = getParam(slotPtr, paramCount, 2, 0.0);
    const f0 = getParam(slotPtr, paramCount, 3, 0.0);
    const k3 = getParam(slotPtr, paramCount, 4, 0.0);

    const dx = disp - l0;
    const fx = f0 + k * dx + k3 * dx * dx * dx + c * vel;
    const kEff = k + 3.0 * k3 * dx * dx;
    setIo(slotPtr, 8, fx);
    setIo(slotPtr, 14, kEff);
    setIo(slotPtr, 15, c * vel * vel);
    return;
  }

  // -------------------------------------------------------------------------
  // 2. 6-DOF Elastomer Bushing ($F_Cmp_Bushing)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_CMP_BUSHING) {
    const kx = getParam(slotPtr, paramCount, 0, 1.5e6);
    const ky = getParam(slotPtr, paramCount, 1, 1.5e6);
    const kz = getParam(slotPtr, paramCount, 2, 3.0e6);
    const cx = getParam(slotPtr, paramCount, 3, 2500.0);
    const fMaxHyst = getParam(slotPtr, paramCount, 6, 1200.0);
    const x2Hyst = Math.max(1e-6, getParam(slotPtr, paramCount, 7, 0.002));

    // Berg friction hysteresis contribution along primary axis
    const fHyst = (fMaxHyst * disp) / (x2Hyst + Math.abs(disp));
    const fx = kx * disp + cx * vel + fHyst;
    const fy = ky * aux2;
    const fz = kz * aux3;
    setIo(slotPtr, 8, fx);
    setIo(slotPtr, 9, fy);
    setIo(slotPtr, 10, fz);
    setIo(slotPtr, 14, kx + (fMaxHyst * x2Hyst) / ((x2Hyst + Math.abs(disp)) * (x2Hyst + Math.abs(disp))));
    setIo(slotPtr, 15, cx * vel * vel);
    return;
  }

  // -------------------------------------------------------------------------
  // 3. Nonlinear Progressive Bumpstop ($F_Cmp_Bumpstop)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_CMP_BUMPSTOP) {
    const clearance = Math.max(0.0, getParam(slotPtr, paramCount, 0, 0.03));
    const kLin = Math.max(0.0, getParam(slotPtr, paramCount, 1, 5.0e4));
    const kExp = Math.max(0.0, getParam(slotPtr, paramCount, 2, 2.5e7));
    const expN = Math.max(1.0, getParam(slotPtr, paramCount, 3, 2.5));
    const c = Math.max(0.0, getParam(slotPtr, paramCount, 4, 3000.0));

    const pen = disp - clearance;
    if (pen <= 0.0) {
      setIo(slotPtr, 8, 0.0);
      setIo(slotPtr, 14, 0.0);
      setIo(slotPtr, 15, 0.0);
      return;
    }

    const fElastic = kLin * pen + kExp * Math.pow(pen, expN);
    const fDamp = vel >= 0.0 ? c * vel : 0.25 * c * vel;
    const fx = Math.max(0.0, fElastic + fDamp);
    const kEff = kLin + kExp * expN * Math.pow(pen, expN - 1.0);
    setIo(slotPtr, 8, fx);
    setIo(slotPtr, 14, kEff);
    setIo(slotPtr, 15, Math.max(0.0, fDamp * vel));
    return;
  }

  // -------------------------------------------------------------------------
  // 4. Stribeck Dry Friction ($F_Cmp_Friction)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_CMP_FRICTION) {
    const muS = Math.max(0.0, getParam(slotPtr, paramCount, 0, 0.35));
    const muK = Math.max(0.0, getParam(slotPtr, paramCount, 1, 0.25));
    const vStribeck = Math.max(1e-6, getParam(slotPtr, paramCount, 2, 0.05));
    const cVisc = Math.max(0.0, getParam(slotPtr, paramCount, 3, 50.0));
    const vEps = Math.max(1e-6, getParam(slotPtr, paramCount, 4, 0.005));

    const fn = Math.max(0.0, normalLoad);
    const absV = Math.abs(vel);
    const ratio = absV / vStribeck;
    const muEff = muK + (muS - muK) * Math.exp(-(ratio * ratio));
    const sgn = smoothTanh(vel / vEps);
    const fx = -(muEff * fn * sgn + cVisc * vel);

    setIo(slotPtr, 8, fx);
    setIo(slotPtr, 10, fn);
    setIo(slotPtr, 14, muEff);
    setIo(slotPtr, 15, Math.abs(fx * vel));
    return;
  }

  // -------------------------------------------------------------------------
  // 5. Hydraulic Mount ($F_Cmp_Hydromount)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_CMP_HYDROMOUNT) {
    const kMain = getParam(slotPtr, paramCount, 0, 1.8e5);
    const cMain = getParam(slotPtr, paramCount, 1, 450.0);
    const kBulge = getParam(slotPtr, paramCount, 2, 4.5e5);
    const mFluid = Math.max(0.1, getParam(slotPtr, paramCount, 3, 12.0));
    const cTrack = Math.max(1.0, getParam(slotPtr, paramCount, 4, 600.0));

    let xf = getState(slotPtr, 0);
    let vf = getState(slotPtr, 1);
    const af = (kBulge * (disp - xf) - cTrack * vf) / mFluid;
    setDState(slotPtr, 0, vf);
    setDState(slotPtr, 1, af);

    if (dt > 0.0) {
      vf += dt * af;
      xf += dt * vf;
      setState(slotPtr, 0, xf);
      setState(slotPtr, 1, vf);
    }

    const fx = kMain * disp + cMain * vel + kBulge * (disp - xf);
    setIo(slotPtr, 8, fx);
    setIo(slotPtr, 14, kMain + kBulge);
    setIo(slotPtr, 15, cMain * vel * vel + cTrack * vf * vf);
    return;
  }

  // -------------------------------------------------------------------------
  // 6. Polytropic Pneumatic Air Spring ($F_Cmp_AirSpring)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_CMP_AIR_SPRING) {
    const p0 = Math.max(0.0, getParam(slotPtr, paramCount, 0, 4.5e5));
    const pAtm = Math.max(1.0e4, getParam(slotPtr, paramCount, 1, 1.01325e5));
    const area = Math.max(1e-4, getParam(slotPtr, paramCount, 2, 0.2));
    const vol0 = Math.max(1e-4, getParam(slotPtr, paramCount, 3, 0.04));
    const gamma = clamp(getParam(slotPtr, paramCount, 4, 1.38), 1.0, 1.67);
    const cOrifice = Math.max(0.0, getParam(slotPtr, paramCount, 5, 8000.0));

    // Positive disp = compression reducing gas volume V = V0 - A*disp
    const vol = Math.max(0.1 * vol0, vol0 - area * disp);
    const pAbs = (p0 + pAtm) * Math.pow(vol0 / vol, gamma);
    const fGas = (pAbs - pAtm) * area;
    const fDamp = cOrifice * vel;
    const fx = fGas + fDamp;
    const kEff = (gamma * pAbs * area * area) / vol;

    setIo(slotPtr, 8, fx);
    setIo(slotPtr, 14, kEff);
    setIo(slotPtr, 15, cOrifice * vel * vel);
    return;
  }

  // -------------------------------------------------------------------------
  // 7. Involute Gear Pair Mesh ($F_Gear_Mesh)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_GEAR_MESH) {
    const kMesh = Math.max(0.0, getParam(slotPtr, paramCount, 0, 2.5e8));
    const cMesh = Math.max(0.0, getParam(slotPtr, paramCount, 1, 1.5e4));
    const backlash = Math.max(0.0, getParam(slotPtr, paramCount, 2, 1.0e-4));
    const rBase = Math.max(1e-3, getParam(slotPtr, paramCount, 3, 0.08));

    let fx: f64 = 0.0;
    let kEff: f64 = 0.0;
    if (disp > backlash) {
      fx = kMesh * (disp - backlash) + cMesh * vel;
      kEff = kMesh;
    } else if (disp < -backlash) {
      fx = kMesh * (disp + backlash) + cMesh * vel;
      kEff = kMesh;
    }
    setIo(slotPtr, 8, fx);
    setIo(slotPtr, 11, fx * rBase);
    setIo(slotPtr, 14, kEff);
    setIo(slotPtr, 15, kEff > 0.0 ? cMesh * vel * vel : 0.0);
    return;
  }

  // -------------------------------------------------------------------------
  // 8. Hertzian Rolling-Element Bearing ($F_Bearing_Roller)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_BEARING_ROLLER) {
    const kHertz = Math.max(0.0, getParam(slotPtr, paramCount, 0, 1.2e10));
    const clearance = Math.max(0.0, getParam(slotPtr, paramCount, 1, 2.0e-5));
    const cDamp = Math.max(0.0, getParam(slotPtr, paramCount, 2, 2500.0));
    const expN = Math.max(1.0, getParam(slotPtr, paramCount, 3, 1.5));

    const absDisp = Math.abs(disp);
    const pen = absDisp - clearance;
    if (pen <= 0.0) {
      setIo(slotPtr, 8, cDamp * vel);
      return;
    }
    const sgn: f64 = disp >= 0.0 ? 1.0 : -1.0;
    const fx = sgn * kHertz * Math.pow(pen, expN) + cDamp * vel;
    const kEff = kHertz * expN * Math.pow(pen, expN - 1.0);
    setIo(slotPtr, 8, fx);
    setIo(slotPtr, 14, kEff);
    setIo(slotPtr, 15, cDamp * vel * vel);
    return;
  }

  // -------------------------------------------------------------------------
  // 9. Polach Nonlinear Wheel-Rail Creep Force ($R_WheelRail_Polach)
  //    Polach (1999, 2005) fast wheel-rail traction/curving creep law
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_WHEELRAIL_POLACH) {
    const mu0 = Math.max(0.01, getParam(slotPtr, paramCount, 0, 0.4));
    const A = clamp(getParam(slotPtr, paramCount, 1, 0.4), 0.05, 1.0);
    const B = Math.max(0.0, getParam(slotPtr, paramCount, 2, 0.6));
    const kA = Math.max(0.05, getParam(slotPtr, paramCount, 3, 1.0));
    const kS = Math.max(0.05, getParam(slotPtr, paramCount, 4, 0.4));
    const a = Math.max(1e-4, getParam(slotPtr, paramCount, 5, 0.0065));
    const b = Math.max(1e-4, getParam(slotPtr, paramCount, 6, 0.0045));
    const G = Math.max(1e9, getParam(slotPtr, paramCount, 7, 8.1e10));
    const c11 = Math.max(0.5, getParam(slotPtr, paramCount, 8, 4.12));
    const c22 = Math.max(0.5, getParam(slotPtr, paramCount, 9, 3.67));

    const xiX = disp;
    const xiY = vel;
    const fn = Math.max(0.0, normalLoad);
    const phi = aux1;
    const v0 = Math.max(0.1, aux2 > 0.0 ? aux2 : 20.0);

    setIo(slotPtr, 10, fn);
    const s = Math.sqrt(xiX * xiX + xiY * xiY);
    if (fn <= 0.0 || s <= 1e-12) {
      setIo(slotPtr, 13, -0.1 * a * fn * phi);
      return;
    }

    const w = s * v0;
    const mu = mu0 * ((1.0 - A) * Math.exp(-B * w) + A);
    const cMean = G * a * b * 0.5 * (c11 + c22);
    const eps = ((2.0 / 3.0) * cMean * s) / Math.max(1.0, mu * fn);
    const kAEps = kA * eps;
    const fMag = ((2.0 * mu * fn) / Math.PI) * (kAEps / (1.0 + kAEps * kAEps) + Math.atan(kS * eps));

    const fx = -fMag * (xiX / s);
    const fy = -fMag * (xiY / s);
    const tz = -0.1 * a * fn * phi;

    setIo(slotPtr, 8, fx);
    setIo(slotPtr, 9, fy);
    setIo(slotPtr, 13, tz);
    setIo(slotPtr, 14, cMean);
    setIo(slotPtr, 15, fMag * w);
    return;
  }

  // -------------------------------------------------------------------------
  // 10. Kalker Linear / Saturated Wheel-Rail Creep Contact ($R_WheelRail_Kalker)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_WHEELRAIL_KALKER) {
    const mu = Math.max(0.01, getParam(slotPtr, paramCount, 0, 0.35));
    const a = Math.max(1e-4, getParam(slotPtr, paramCount, 1, 0.006));
    const b = Math.max(1e-4, getParam(slotPtr, paramCount, 2, 0.0045));
    const G = Math.max(1e9, getParam(slotPtr, paramCount, 3, 8.1e10));
    const c11 = getParam(slotPtr, paramCount, 4, 4.12);
    const c22 = getParam(slotPtr, paramCount, 5, 3.67);
    const c23 = getParam(slotPtr, paramCount, 6, 1.47);
    const c33 = getParam(slotPtr, paramCount, 7, 1.19);

    const xiX = disp;
    const xiY = vel;
    const fn = Math.max(0.0, normalLoad);
    const phi = aux1;
    const v0 = Math.max(0.1, aux2 > 0.0 ? aux2 : 20.0);

    const ab = a * b;
    let fx = -G * ab * c11 * xiX;
    let fy = -G * ab * (c22 * xiY + Math.sqrt(ab) * c23 * phi);
    const tz = -G * ab * ab * c33 * phi;

    // Vermeulen-Johnson / Coulomb saturation at mu * fn
    const fLin = Math.sqrt(fx * fx + fy * fy);
    const fMax = mu * fn;
    if (fLin > 1e-12 && fMax > 0.0) {
      const u = fLin / fMax;
      const scale = u < 3.0 ? (u - (u * u) / 3.0 + (u * u * u) / 27.0) / u : 1.0 / u;
      fx *= scale;
      fy *= scale;
    } else if (fMax <= 0.0) {
      fx = 0.0;
      fy = 0.0;
    }

    setIo(slotPtr, 8, fx);
    setIo(slotPtr, 9, fy);
    setIo(slotPtr, 10, fn);
    setIo(slotPtr, 13, tz);
    setIo(slotPtr, 14, G * ab * c11);
    setIo(slotPtr, 15, (Math.abs(fx * xiX) + Math.abs(fy * xiY)) * v0);
    return;
  }

  // -------------------------------------------------------------------------
  // 11. Rail & Wheel Profiles and Track Irregularity
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_TRACK_UIC60) {
    const rCrown = Math.max(0.05, getParam(slotPtr, paramCount, 0, 0.3));
    const incl = getParam(slotPtr, paramCount, 3, 0.025);
    const y = disp;
    // Parabolic crown profile height z(y) with rail cant
    const z = -(y * y) / (2.0 * rCrown) + incl * y;
    setIo(slotPtr, 10, z);
    setIo(slotPtr, 14, 1.0 / rCrown);
    return;
  }

  if (archetypeId == ARCH_WHEEL_S1002) {
    const rNom = Math.max(0.1, getParam(slotPtr, paramCount, 0, 0.46));
    const conicity = getParam(slotPtr, paramCount, 1, 0.12);
    const y = disp;
    // Rolling radius delta_r(y) ~ lambda_e * y
    const rRoll = rNom + conicity * y;
    setIo(slotPtr, 10, rRoll);
    setIo(slotPtr, 14, conicity);
    return;
  }

  if (archetypeId == ARCH_TRACK_IRREGULARITY) {
    const av = getParam(slotPtr, paramCount, 0, 4.032e-7);
    const aa = getParam(slotPtr, paramCount, 1, 2.119e-7);
    const ampScale = getParam(slotPtr, paramCount, 4, 1.0);
    const s = disp;
    const zIrreg = ampScale * Math.sqrt(av) * (2.5 * Math.sin(0.25 * s) + 1.2 * Math.sin(0.73 * s + 1.1));
    const yIrreg = ampScale * Math.sqrt(aa) * (2.2 * Math.sin(0.19 * s + 0.4) + 1.0 * Math.sin(0.61 * s + 2.3));
    setIo(slotPtr, 9, yIrreg);
    setIo(slotPtr, 10, zIrreg);
    return;
  }

  // -------------------------------------------------------------------------
  // 12. Pacejka Magic Formula Tire ($T_Pacejka_MF)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_TIRE_PACEJKA_MF) {
    const Bx = getParam(slotPtr, paramCount, 0, 10.0);
    const Cx = getParam(slotPtr, paramCount, 1, 1.65);
    const Dx = getParam(slotPtr, paramCount, 2, 1.05);
    const Ex = getParam(slotPtr, paramCount, 3, 0.97);
    const By = getParam(slotPtr, paramCount, 4, 8.5);
    const Cy = getParam(slotPtr, paramCount, 5, 1.3);
    const Dy = getParam(slotPtr, paramCount, 6, 1.0);
    const Ey = getParam(slotPtr, paramCount, 7, -1.6);
    const rEff = Math.max(0.1, getParam(slotPtr, paramCount, 9, 0.315));

    const kappa = disp; // longitudinal slip ratio
    const alpha = vel; // slip angle (rad)
    const fz = Math.max(0.0, normalLoad);
    const v0 = Math.max(0.1, aux2 > 0.0 ? aux2 : 20.0);

    const bxK = Bx * kappa;
    let fx = fz * Dx * Math.sin(Cx * Math.atan(bxK - Ex * (bxK - Math.atan(bxK))));

    const byA = By * alpha;
    let fy = -fz * Dy * Math.sin(Cy * Math.atan(byA - Ey * (byA - Math.atan(byA))));

    // Combined-slip friction ellipse enforcement
    const fMax = fz * Math.max(Dx, Dy);
    const fComb = Math.sqrt(fx * fx + fy * fy);
    if (fComb > fMax && fComb > 1e-12) {
      const scale = fMax / fComb;
      fx *= scale;
      fy *= scale;
    }

    // Pneumatic trail self-aligning torque Mz
    const tz = -0.04 * rEff * fy;
    const cAlpha = fz * By * Cy * Dy;

    setIo(slotPtr, 8, fx);
    setIo(slotPtr, 9, fy);
    setIo(slotPtr, 10, fz);
    setIo(slotPtr, 13, tz);
    setIo(slotPtr, 14, cAlpha);
    setIo(slotPtr, 15, Math.abs(fx * kappa * v0) + Math.abs(fy * Math.sin(alpha) * v0));
    return;
  }

  // -------------------------------------------------------------------------
  // 13. Simplified Flexible-Ring Tire ($T_FTire_Simple)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_TIRE_FTIRE_SIMPLE) {
    const kVert = Math.max(0.0, getParam(slotPtr, paramCount, 0, 2.2e5));
    const cVert = Math.max(0.0, getParam(slotPtr, paramCount, 1, 150.0));
    const muPeak = Math.max(0.05, getParam(slotPtr, paramCount, 3, 1.0));
    const cSlip = Math.max(0.0, getParam(slotPtr, paramCount, 4, 6.5e4));

    const defl = Math.max(0.0, disp);
    const fz = Math.max(0.0, normalLoad > 0.0 ? normalLoad : kVert * defl + cVert * vel);
    const alpha = aux1;
    const fyLin = -cSlip * alpha;
    const fMax = muPeak * fz;
    const fy = fMax > 0.0 ? fMax * smoothTanh(fyLin / fMax) : 0.0;

    setIo(slotPtr, 9, fy);
    setIo(slotPtr, 10, fz);
    setIo(slotPtr, 14, kVert);
    return;
  }

  // -------------------------------------------------------------------------
  // 14. Joint Penalty / Constraint Stabilization ($J_*)
  // -------------------------------------------------------------------------
  if (archetypeId >= ARCH_JOINT_REVOLUTE && archetypeId <= ARCH_JOINT_TRACK) {
    if (archetypeId == ARCH_JOINT_GENERAL6DOF) {
      const kPen = getParam(slotPtr, paramCount, 0, 0.0);
      const cPen = getParam(slotPtr, paramCount, 1, 0.0);
      setIo(slotPtr, 8, -(kPen * disp + cPen * vel));
      setIo(slotPtr, 14, kPen);
      return;
    }
    if (archetypeId == ARCH_JOINT_TRACK) {
      const cant = getParam(slotPtr, paramCount, 1, 0.0);
      const gauge = Math.max(0.5, getParam(slotPtr, paramCount, 0, 1.435));
      const rollAngle = Math.asin(clamp(cant / gauge, -0.5, 0.5));
      setIo(slotPtr, 11, rollAngle);
      return;
    }
    const kPen = getParam(slotPtr, paramCount, 0, 1.0e8);
    const cPen = getParam(slotPtr, paramCount, 1, 1.0e5);
    const fx = -(kPen * disp + cPen * vel);
    setIo(slotPtr, 8, fx);
    setIo(slotPtr, 14, kPen);
    setIo(slotPtr, 15, cPen * vel * vel);
    return;
  }

  // -------------------------------------------------------------------------
  // 15. Control Elements ($C_PID, $C_TransferFcn, $C_Lookup1D)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_CTRL_PID) {
    const kp = getParam(slotPtr, paramCount, 0, 10.0);
    const ki = getParam(slotPtr, paramCount, 1, 2.0);
    const kd = getParam(slotPtr, paramCount, 2, 0.5);
    const uMin = getParam(slotPtr, paramCount, 3, -1.0e6);
    const uMax = getParam(slotPtr, paramCount, 4, 1.0e6);

    const err = aux1 - disp; // setpoint - measurement (or direct error when aux1=0)
    let integ = getState(slotPtr, 0);
    const prevErr = getState(slotPtr, 1);
    const deriv = dt > 1e-12 ? (err - prevErr) / dt : 0.0;
    if (dt > 0.0) {
      integ += err * dt;
      setState(slotPtr, 0, integ);
      setState(slotPtr, 1, err);
    }
    const y = clamp(kp * err + ki * integ + kd * deriv, uMin, uMax);
    setIo(slotPtr, 8, y);
    return;
  }

  if (archetypeId == ARCH_CTRL_TRANSFER_FCN) {
    const gain = getParam(slotPtr, paramCount, 0, 1.0);
    const tau = Math.max(1e-6, getParam(slotPtr, paramCount, 1, 0.1));
    let y = getState(slotPtr, 0);
    const dy = (gain * disp - y) / tau;
    setDState(slotPtr, 0, dy);
    if (dt > 0.0) {
      y += dt * dy;
      setState(slotPtr, 0, y);
    }
    setIo(slotPtr, 8, y);
    return;
  }

  if (archetypeId == ARCH_CTRL_LOOKUP1D) {
    const x0 = getParam(slotPtr, paramCount, 0, -1.0);
    const y0 = getParam(slotPtr, paramCount, 1, -1.0);
    const x1 = getParam(slotPtr, paramCount, 2, 0.0);
    const y1 = getParam(slotPtr, paramCount, 3, 0.0);
    const x2 = getParam(slotPtr, paramCount, 4, 1.0);
    const y2 = getParam(slotPtr, paramCount, 5, 1.0);

    let y: f64;
    if (disp <= x0) {
      y = y0;
    } else if (disp <= x1) {
      const denom = x1 - x0;
      y = Math.abs(denom) > 1e-12 ? y0 + ((y1 - y0) * (disp - x0)) / denom : y0;
    } else if (disp <= x2) {
      const denom = x2 - x1;
      y = Math.abs(denom) > 1e-12 ? y1 + ((y2 - y1) * (disp - x1)) / denom : y1;
    } else {
      y = y2;
    }
    setIo(slotPtr, 8, y);
    return;
  }
}
