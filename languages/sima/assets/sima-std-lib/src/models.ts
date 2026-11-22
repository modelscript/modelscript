// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript marine & offshore model runtime for `@modelscript/sima-std-lib`.
 *
 * Implements public DNV-RP-C205 / Faltinsen / Morison / JONSWAP / NPD / PIANC mathematical
 * formulations for SINTEF SIMA (SIMO / RIFLEX) models using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — model parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — dynamic state vector
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — state derivatives / auxiliary
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — marine & hydrodynamic I/O bus:
 *       Inputs (IO[0..7]):
 *         IO[0] = displacement / span / deflection / depthZ (m or rad)
 *         IO[1] = bodyVelocity / approachVel / inflowVel (m/s or rad/s)
 *         IO[2] = bodyAccel / fluidVelocity (m/s^2 or m/s)
 *         IO[3] = fluidAccel / externalForce (m/s^2 or N)
 *         IO[4] = command / rpmFraction / curvature (dimensionless or 1/m)
 *         IO[5] = frequency omega (rad/s) or f (Hz)
 *         IO[6] = angle / azimuth / heading (rad)
 *         IO[7] = auxInput (m or N)
 *       Outputs (IO[8..15]):
 *         IO[8]  = primaryForce / primaryOutput (N, N*m, m^2*s/rad, m/s)
 *         IO[9]  = secondaryOutput (dragForce / horizontalTension / omegaP / thrustX / frictionForce)
 *         IO[10] = tertiaryOutput (inertiaForce / verticalTension / thrustY / moment)
 *         IO[11] = auxOutput1 (suspendedLength / displacement / utilization)
 *         IO[12] = auxOutput2 (groundedLength / velocity)
 *         IO[13] = auxOutput3
 *         IO[14] = auxOutput4
 *         IO[15] = statusFlag (0 = ok, 1 = limit/saturated)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `SimaArchetypeId` in sima-std-schemas.ts)
const ARCH_SIMO_BODY_6DOF: i32 = 1;
const ARCH_SIMO_MORISON_MEMBER: i32 = 2;
const ARCH_SIMO_HYDRO_STATIC: i32 = 3;
const ARCH_SIMO_WAVE_DRIFT_QTF: i32 = 4;
const ARCH_SIMO_ADDED_MASS_DAMPING: i32 = 5;

const ARCH_RIFLEX_CATENARY_LINE: i32 = 10;
const ARCH_RIFLEX_BAR_ELEMENT: i32 = 11;
const ARCH_RIFLEX_BEAM_RISER: i32 = 12;
const ARCH_RIFLEX_FLEX_JOINT: i32 = 13;
const ARCH_RIFLEX_BUOYANCY_MODULE: i32 = 14;
const ARCH_RIFLEX_SEABED_CONTACT: i32 = 15;

const ARCH_SIMO_FENDER: i32 = 20;
const ARCH_SIMO_THRUSTER: i32 = 21;
const ARCH_SIMO_WINCH: i32 = 22;
const ARCH_SIMO_HAWSER: i32 = 23;
const ARCH_SIMO_DP_CONTROLLER: i32 = 24;

const ARCH_ENV_JONSWAP_WAVE: i32 = 30;
const ARCH_ENV_PIERSON_MOSKOWITZ: i32 = 31;
const ARCH_ENV_NPD_WIND: i32 = 32;
const ARCH_ENV_CURRENT_PROFILE: i32 = 33;

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

@inline
function acoshSafe(y: f64): f64 {
  if (y <= 1.0) return 0.0;
  return Math.log(y + Math.sqrt(y * y - 1.0));
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function simaGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes model states for equilibrium/clean start.
 * Returns the number of active dynamic states for the archetype.
 */
export function simaModelInit(archetypeId: i32, slotPtr: usize, _conCount: i32): i32 {
  for (let i = 0; i < 8; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }
  for (let i = 8; i < 16; i++) {
    setIo(slotPtr, i, 0.0);
  }

  if (archetypeId == ARCH_SIMO_BODY_6DOF) {
    // State 0: surge position x (m), State 1: surge velocity v (m/s)
    setState(slotPtr, 0, getIo(slotPtr, 0));
    setState(slotPtr, 1, getIo(slotPtr, 1));
    return 2;
  }

  if (archetypeId == ARCH_SIMO_ADDED_MASS_DAMPING) {
    // State 0: radiation memory state
    setState(slotPtr, 0, 0.0);
    return 1;
  }

  if (archetypeId == ARCH_SIMO_DP_CONTROLLER) {
    // State 0: integral position error (m*s)
    setState(slotPtr, 0, 0.0);
    return 1;
  }

  return 0;
}

/**
 * Evaluates cleanroom physics for a single SIMA (SIMO / RIFLEX / Metocean) model archetype.
 */
export function simaModelEval(
  archetypeId: i32,
  _t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  setIo(slotPtr, 15, 0.0);

  // =========================================================================
  // 1. SIMO_MorisonMember — Morison Drag + Inertia Force (DNV-RP-C205 §6.2)
  // =========================================================================
  if (archetypeId == ARCH_SIMO_MORISON_MEMBER) {
    const D = Math.max(1e-4, getCon(slotPtr, conCount, 0, 1.2));
    const L = Math.max(0.0, getCon(slotPtr, conCount, 1, 20.0));
    const cd = getCon(slotPtr, conCount, 2, 1.05);
    const cm = getCon(slotPtr, conCount, 3, 2.0);
    const rho = Math.max(1.0, getCon(slotPtr, conCount, 4, 1025.0));

    const vBody = getIo(slotPtr, 1);
    const uFluid = getIo(slotPtr, 2);
    const aFluid = getIo(slotPtr, 3);
    const aBody = getIo(slotPtr, 7);

    const uRel = uFluid - vBody;
    const area = 0.25 * Math.PI * D * D;
    const fDrag = 0.5 * rho * cd * D * L * Math.abs(uRel) * uRel;
    const fInertia = rho * cm * area * L * aFluid - rho * (cm - 1.0) * area * L * aBody;
    const fTotal = fDrag + fInertia;

    setIo(slotPtr, 8, fTotal);
    setIo(slotPtr, 9, fDrag);
    setIo(slotPtr, 10, fInertia);
    return;
  }

  // =========================================================================
  // 2. RIFLEX_CatenaryLine — Inelastic Catenary Mooring Solver (Faltinsen §8.2)
  // =========================================================================
  if (archetypeId == ARCH_RIFLEX_CATENARY_LINE) {
    const w = Math.max(1e-3, getCon(slotPtr, conCount, 0, 1200.0));
    const L = Math.max(1.0, getCon(slotPtr, conCount, 1, 1200.0));
    const h = Math.max(0.1, getCon(slotPtr, conCount, 2, 300.0));
    const xParam = getCon(slotPtr, conCount, 3, 1080.0);
    const ea = Math.max(1e4, getCon(slotPtr, conCount, 4, 8.0e8));

    const xIn = getIo(slotPtr, 0);
    const X = xIn > 0.0 ? xIn : xParam;

    // Straight-line geometric distance from anchor to fairlead
    const straightDist = Math.sqrt(X * X + h * h);

    // Maximum horizontal span before full line lift-off (s = L -> a_lift = (L^2 - h^2) / (2*h))
    if (straightDist >= L) {
      // Taut / stretched regime
      const strain = (straightDist - L) / L;
      const tAxial = ea * strain + w * h;
      const tH = tAxial * (X / straightDist);
      const tV = tAxial * (h / straightDist);
      setIo(slotPtr, 8, tAxial);
      setIo(slotPtr, 9, tH);
      setIo(slotPtr, 10, tV);
      setIo(slotPtr, 11, L);
      setIo(slotPtr, 12, 0.0);
      setIo(slotPtr, 15, 1.0);
      return;
    }

    // Solve X(a) = L - sqrt(h^2 + 2*a*h) + a * acosh(1 + h/a) = X for catenary parameter a = T_H / w
    // X(a) is strictly monotonically increasing with a > 0.
    const aLift = (L * L - h * h) / (2.0 * h);
    const xLift = aLift * acoshSafe(1.0 + h / aLift);

    let a: f64;
    let s: f64;
    let lGrounded: f64;

    if (X <= xLift) {
      // Partial seabed contact regime: bisect + Newton-Raphson on a in (1e-4, aLift]
      let lo: f64 = 1e-4;
      let hi: f64 = aLift;
      a = 0.5 * (lo + hi);
      for (let iter = 0; iter < 64; iter++) {
        const sMid = Math.sqrt(h * h + 2.0 * a * h);
        const fMid = L - sMid + a * acoshSafe(1.0 + h / a) - X;
        if (Math.abs(fMid) < 1e-9) break;
        if (fMid < 0.0) {
          lo = a;
        } else {
          hi = a;
        }
        a = 0.5 * (lo + hi);
      }
      s = Math.sqrt(h * h + 2.0 * a * h);
      lGrounded = Math.max(0.0, L - s);
    } else {
      // Fully suspended catenary (no grounded length): solve 2*a*sinh(X/(2*a)) = sqrt(L^2 - h^2)
      const target = Math.sqrt(L * L - h * h);
      let lo: f64 = aLift;
      let hi: f64 = aLift * 1e4;
      a = lo * 2.0;
      for (let iter = 0; iter < 64; iter++) {
        const u = X / (2.0 * a);
        const sinhU = 0.5 * (Math.exp(u) - Math.exp(-u));
        const val = 2.0 * a * sinhU - target;
        if (Math.abs(val) < 1e-9) break;
        if (val > 0.0) {
          lo = a;
        } else {
          hi = a;
        }
        a = 0.5 * (lo + hi);
      }
      s = L;
      lGrounded = 0.0;
    }

    const tH = w * a;
    const tV = w * s;
    const tF = Math.sqrt(tH * tH + tV * tV);

    setIo(slotPtr, 8, tF);
    setIo(slotPtr, 9, tH);
    setIo(slotPtr, 10, tV);
    setIo(slotPtr, 11, s);
    setIo(slotPtr, 12, lGrounded);
    return;
  }

  // =========================================================================
  // 3. ENV_JONSWAPWave & ENV_PiersonMoskowitz — DNV-RP-C205 §3.5.5.1
  // =========================================================================
  if (archetypeId == ARCH_ENV_JONSWAP_WAVE || archetypeId == ARCH_ENV_PIERSON_MOSKOWITZ) {
    const hs = Math.max(0.0, getCon(slotPtr, conCount, 0, 4.5));
    const tp = Math.max(0.1, getCon(slotPtr, conCount, 1, 10.0));
    const gamma =
      archetypeId == ARCH_ENV_PIERSON_MOSKOWITZ ? 1.0 : Math.max(1.0, getCon(slotPtr, conCount, 2, 3.3));
    const sigmaA = archetypeId == ARCH_ENV_PIERSON_MOSKOWITZ ? 0.07 : getCon(slotPtr, conCount, 3, 0.07);
    const sigmaB = archetypeId == ARCH_ENV_PIERSON_MOSKOWITZ ? 0.09 : getCon(slotPtr, conCount, 4, 0.09);

    const omegaP = (2.0 * Math.PI) / tp;
    const omegaIn = getIo(slotPtr, 5);
    const omega = omegaIn > 1e-6 ? omegaIn : omegaP;

    const r = omega / omegaP;
    const r4 = r * r * r * r;
    const omega5 = omega * omega * omega * omega * omega;
    const omegaP4 = omegaP * omegaP * omegaP * omegaP;

    const sPm = (5.0 / 16.0) * hs * hs * (omegaP4 / omega5) * Math.exp(-1.25 / r4);
    const aGamma = 1.0 - 0.287 * Math.log(gamma);
    const sigma = omega <= omegaP ? sigmaA : sigmaB;
    const diff = (omega - omegaP) / (sigma * omegaP);
    const peakEnhancement = Math.pow(gamma, Math.exp(-0.5 * diff * diff));
    const sOmega = aGamma * sPm * peakEnhancement;

    setIo(slotPtr, 8, sOmega);
    setIo(slotPtr, 9, omegaP);
    setIo(slotPtr, 10, sPm);
    return;
  }

  // =========================================================================
  // 4. ENV_NPDWind — NPD / Frøya Offshore Wind Spectrum (DNV-RP-C205 §2.3.3.2)
  // =========================================================================
  if (archetypeId == ARCH_ENV_NPD_WIND) {
    const u0 = Math.max(0.1, getCon(slotPtr, conCount, 0, 25.0));
    const z = Math.max(1.0, getCon(slotPtr, conCount, 1, 10.0));
    const nExp = Math.max(0.1, getCon(slotPtr, conCount, 2, 0.468));

    const fIn = getIo(slotPtr, 5);
    const f = fIn > 1e-6 ? fIn : 0.01;

    const fTilde = 172.0 * f * Math.pow(z / 10.0, 2.0 / 3.0) * Math.pow(u0 / 10.0, -0.75);
    const num = 320.0 * Math.pow(u0 / 10.0, 2.0) * Math.pow(z / 10.0, 0.45);
    const den = Math.pow(1.0 + Math.pow(fTilde, nExp), 5.0 / (3.0 * nExp));
    const sU = num / den;

    // Mean wind speed at height z (NPD logarithmic profile)
    const cProfile = 0.0573 * Math.sqrt(1.0 + 0.15 * u0);
    const uZ = u0 * (1.0 + cProfile * Math.log(z / 10.0));

    setIo(slotPtr, 8, sU);
    setIo(slotPtr, 9, uZ);
    setIo(slotPtr, 10, fTilde);
    return;
  }

  // =========================================================================
  // 5. SIMO_Fender — Nonlinear Fender Compression Force (PIANC WG 33)
  // =========================================================================
  if (archetypeId == ARCH_SIMO_FENDER) {
    const k1 = getCon(slotPtr, conCount, 0, 4.0e5);
    const k2 = getCon(slotPtr, conCount, 1, 1.5e5);
    const k3 = getCon(slotPtr, conCount, 2, 8.0e4);
    const cDamp = getCon(slotPtr, conCount, 3, 6.0e4);
    const mu = getCon(slotPtr, conCount, 4, 0.2);
    const maxDefl = Math.max(0.05, getCon(slotPtr, conCount, 5, 1.8));

    const delta = getIo(slotPtr, 0);
    const vApproach = getIo(slotPtr, 1);

    if (delta <= 0.0) {
      setIo(slotPtr, 8, 0.0);
      setIo(slotPtr, 9, 0.0);
      setIo(slotPtr, 11, 0.0);
      return;
    }

    const dEff = Math.min(delta, maxDefl);
    const fElastic = k1 * dEff + k2 * dEff * dEff + k3 * dEff * dEff * dEff;
    const fDamp = vApproach > 0.0 ? cDamp * vApproach : 0.0;
    const fNormal = Math.max(0.0, fElastic + fDamp);
    const fFriction = mu * fNormal;

    setIo(slotPtr, 8, fNormal);
    setIo(slotPtr, 9, fFriction);
    setIo(slotPtr, 11, dEff / maxDefl);
    if (delta >= maxDefl) setIo(slotPtr, 15, 1.0);
    return;
  }

  // =========================================================================
  // 6. SIMO_Thruster — Bollard-Pull Azimuth Thruster Force (Fossen §12.3)
  // =========================================================================
  if (archetypeId == ARCH_SIMO_THRUSTER) {
    const tMax = Math.max(0.0, getCon(slotPtr, conCount, 0, 6.0e5));
    const kLoss = clamp(getCon(slotPtr, conCount, 1, 0.35), 0.0, 1.0);
    const vRef = Math.max(0.1, getCon(slotPtr, conCount, 2, 6.0));
    const azDefault = getCon(slotPtr, conCount, 3, 0.0);

    const vInflow = getIo(slotPtr, 1);
    const uCmd = clamp(getIo(slotPtr, 4), -1.0, 1.0);
    const azIn = getIo(slotPtr, 6);
    const az = azIn != 0.0 ? azIn : azDefault;

    const inflowFactor = Math.max(0.0, 1.0 - kLoss * (Math.abs(vInflow) / vRef));
    const thrust = tMax * uCmd * Math.abs(uCmd) * inflowFactor;
    const tx = thrust * Math.cos(az);
    const ty = thrust * Math.sin(az);

    setIo(slotPtr, 8, thrust);
    setIo(slotPtr, 9, tx);
    setIo(slotPtr, 10, ty);
    return;
  }

  // =========================================================================
  // 7. SIMO_Body6DOF — Surge 1-DOF reduced step of 6-DOF Cummins body
  // =========================================================================
  if (archetypeId == ARCH_SIMO_BODY_6DOF) {
    const m = Math.max(1.0, getCon(slotPtr, conCount, 0, 5.0e7));
    const aInf = Math.max(0.0, getCon(slotPtr, conCount, 1, 5.0e6));
    const bLin = getCon(slotPtr, conCount, 2, 2.0e5);
    const bQuad = getCon(slotPtr, conCount, 3, 5.0e4);
    const kRest = getCon(slotPtr, conCount, 4, 1.5e5);

    const fExt = getIo(slotPtr, 3);
    let x = getState(slotPtr, 0);
    let v = getState(slotPtr, 1);
    const acc = (fExt - bLin * v - bQuad * Math.abs(v) * v - kRest * x) / (m + aInf);
    if (dt > 0.0) {
      v += acc * dt;
      x += v * dt;
      setState(slotPtr, 0, x);
      setState(slotPtr, 1, v);
    }
    setDState(slotPtr, 0, v);
    setDState(slotPtr, 1, acc);
    setIo(slotPtr, 8, acc);
    setIo(slotPtr, 11, x);
    setIo(slotPtr, 12, v);
    return;
  }

  // =========================================================================
  // 8. SIMO_HydroStatic — Heave/Roll/Pitch Hydrostatic Restoring
  // =========================================================================
  if (archetypeId == ARCH_SIMO_HYDRO_STATIC) {
    const aw = getCon(slotPtr, conCount, 0, 3200.0);
    const vol = getCon(slotPtr, conCount, 1, 48000.0);
    const gmt = getCon(slotPtr, conCount, 2, 3.2);
    const gml = getCon(slotPtr, conCount, 3, 120.0);
    const rho = getCon(slotPtr, conCount, 4, 1025.0);
    const g = getCon(slotPtr, conCount, 5, 9.80665);

    const heave = getIo(slotPtr, 0);
    const roll = getIo(slotPtr, 6);
    const fHeave = -rho * g * aw * heave;
    const mRoll = -rho * g * vol * gmt * roll;
    const c55 = rho * g * vol * gml;

    setIo(slotPtr, 8, fHeave);
    setIo(slotPtr, 9, mRoll);
    setIo(slotPtr, 10, c55);
    return;
  }

  // =========================================================================
  // 9. SIMO_WaveDriftQTF — Mean Wave Drift Force
  // =========================================================================
  if (archetypeId == ARCH_SIMO_WAVE_DRIFT_QTF) {
    const qtf = getCon(slotPtr, conCount, 0, 1.2e5);
    const ampParam = getCon(slotPtr, conCount, 1, 2.0);
    const headingParam = getCon(slotPtr, conCount, 2, 0.0);
    const bDrift = getCon(slotPtr, conCount, 3, 1.5e4);

    const amp = getIo(slotPtr, 0) > 0.0 ? getIo(slotPtr, 0) : ampParam;
    const vBody = getIo(slotPtr, 1);
    const heading = getIo(slotPtr, 6) != 0.0 ? getIo(slotPtr, 6) : headingParam;

    const fMean = qtf * amp * amp;
    const fX = fMean * Math.cos(heading) - bDrift * vBody;
    const fY = fMean * Math.sin(heading);

    setIo(slotPtr, 8, fMean);
    setIo(slotPtr, 9, fX);
    setIo(slotPtr, 10, fY);
    return;
  }

  // =========================================================================
  // 10. SIMO_AddedMassDamping — Radiation Memory & Added Mass Force
  // =========================================================================
  if (archetypeId == ARCH_SIMO_ADDED_MASS_DAMPING) {
    const aInf = getCon(slotPtr, conCount, 0, 4.5e6);
    const bRad = getCon(slotPtr, conCount, 1, 3.5e5);
    const alpha = Math.max(1e-3, getCon(slotPtr, conCount, 2, 0.35));

    const vBody = getIo(slotPtr, 1);
    const aBody = getIo(slotPtr, 2);
    let mem = getState(slotPtr, 0);
    if (dt > 0.0) {
      mem += (-alpha * mem + bRad * vBody) * dt;
      setState(slotPtr, 0, mem);
    }
    const fRad = -aInf * aBody - mem;
    setIo(slotPtr, 8, fRad);
    setIo(slotPtr, 9, -aInf * aBody);
    setIo(slotPtr, 10, -mem);
    return;
  }

  // =========================================================================
  // 11. RIFLEX_BarElement — Tension-Only Bar Element
  // =========================================================================
  if (archetypeId == ARCH_RIFLEX_BAR_ELEMENT) {
    const l0 = Math.max(1e-3, getCon(slotPtr, conCount, 0, 50.0));
    const ea = getCon(slotPtr, conCount, 1, 5.0e8);
    const cDamp = getCon(slotPtr, conCount, 2, 1.0e5);
    const mbl = Math.max(1.0, getCon(slotPtr, conCount, 3, 1.2e7));

    const ext = getIo(slotPtr, 0);
    const extVel = getIo(slotPtr, 1);
    const tension = ext > 0.0 ? Math.max(0.0, (ea / l0) * ext + cDamp * extVel) : 0.0;
    setIo(slotPtr, 8, tension);
    setIo(slotPtr, 11, tension / mbl);
    if (tension >= mbl) setIo(slotPtr, 15, 1.0);
    return;
  }

  // =========================================================================
  // 12. RIFLEX_BeamRiser — Euler-Bernoulli Riser Bending & MBR
  // =========================================================================
  if (archetypeId == ARCH_RIFLEX_BEAM_RISER) {
    const ei = getCon(slotPtr, conCount, 0, 2.5e7);
    const ea = getCon(slotPtr, conCount, 1, 1.2e9);
    const mbr = Math.max(0.1, getCon(slotPtr, conCount, 3, 12.0));

    const strain = getIo(slotPtr, 0);
    const curvature = getIo(slotPtr, 4);
    const moment = ei * curvature;
    const axial = ea * strain;
    const mbrUtil = Math.abs(curvature) * mbr;

    setIo(slotPtr, 8, axial);
    setIo(slotPtr, 10, moment);
    setIo(slotPtr, 11, mbrUtil);
    if (mbrUtil > 1.0) setIo(slotPtr, 15, 1.0);
    return;
  }

  // =========================================================================
  // 13. RIFLEX_FlexJoint — Nonlinear Rotational Flex Joint
  // =========================================================================
  if (archetypeId == ARCH_RIFLEX_FLEX_JOINT) {
    const kTheta = getCon(slotPtr, conCount, 0, 1.5e6);
    const kCubic = getCon(slotPtr, conCount, 1, 2.0e7);
    const cTheta = getCon(slotPtr, conCount, 2, 5.0e4);
    const maxAng = Math.max(1e-3, getCon(slotPtr, conCount, 3, 0.1745));

    const theta = getIo(slotPtr, 0);
    const omega = getIo(slotPtr, 1);
    const moment = kTheta * theta + kCubic * theta * theta * theta + cTheta * omega;

    setIo(slotPtr, 8, moment);
    setIo(slotPtr, 11, Math.abs(theta) / maxAng);
    if (Math.abs(theta) >= maxAng) setIo(slotPtr, 15, 1.0);
    return;
  }

  // =========================================================================
  // 14. RIFLEX_BuoyancyModule — Net Upward Buoyancy Force
  // =========================================================================
  if (archetypeId == ARCH_RIFLEX_BUOYANCY_MODULE) {
    const d = getCon(slotPtr, conCount, 0, 1.1);
    const len = getCon(slotPtr, conCount, 1, 2.0);
    const dryMass = getCon(slotPtr, conCount, 2, 420.0);
    const rho = getCon(slotPtr, conCount, 3, 1025.0);

    const vol = 0.25 * Math.PI * d * d * len;
    const netBuoyancy = (rho * vol - dryMass) * 9.80665;
    setIo(slotPtr, 8, netBuoyancy);
    setIo(slotPtr, 9, vol);
    return;
  }

  // =========================================================================
  // 15. RIFLEX_SeabedContact — Elastic-Coulomb Seabed Contact
  // =========================================================================
  if (archetypeId == ARCH_RIFLEX_SEABED_CONTACT) {
    const kz = getCon(slotPtr, conCount, 0, 5.0e5);
    const cz = getCon(slotPtr, conCount, 1, 1.0e4);
    const muLat = getCon(slotPtr, conCount, 3, 0.6);
    const vReg = Math.max(1e-4, getCon(slotPtr, conCount, 4, 0.05));

    const pen = getIo(slotPtr, 0); // positive into seabed
    const vSlide = getIo(slotPtr, 1);
    const vPen = getIo(slotPtr, 2);

    if (pen <= 0.0) {
      setIo(slotPtr, 8, 0.0);
      setIo(slotPtr, 9, 0.0);
      return;
    }
    const fNormal = Math.max(0.0, kz * pen + cz * vPen);
    const fFriction = -muLat * fNormal * Math.tanh(vSlide / vReg);
    setIo(slotPtr, 8, fNormal);
    setIo(slotPtr, 9, fFriction);
    return;
  }

  // =========================================================================
  // 16. SIMO_Winch — Mooring / Crane Winch
  // =========================================================================
  if (archetypeId == ARCH_SIMO_WINCH) {
    const maxT = getCon(slotPtr, conCount, 0, 1.5e6);
    const kHaul = getCon(slotPtr, conCount, 1, 2.0e6);
    const cDrum = getCon(slotPtr, conCount, 2, 8.0e4);
    const tSet = getCon(slotPtr, conCount, 3, 4.0e5);

    const stretch = getIo(slotPtr, 0);
    const lineVel = getIo(slotPtr, 1);
    const rawT = Math.max(0.0, tSet + kHaul * stretch + cDrum * lineVel);
    const tOut = Math.min(rawT, maxT);

    setIo(slotPtr, 8, tOut);
    if (rawT >= maxT) setIo(slotPtr, 15, 1.0);
    return;
  }

  // =========================================================================
  // 17. SIMO_Hawser — Power-Law Synthetic Hawser
  // =========================================================================
  if (archetypeId == ARCH_SIMO_HAWSER) {
    const l0 = Math.max(0.1, getCon(slotPtr, conCount, 0, 80.0));
    const k = getCon(slotPtr, conCount, 1, 1.2e7);
    const p = Math.max(1.0, getCon(slotPtr, conCount, 2, 1.6));
    const cDamp = getCon(slotPtr, conCount, 3, 3.0e4);

    const ext = getIo(slotPtr, 0);
    const vel = getIo(slotPtr, 1);
    if (ext <= 0.0) {
      setIo(slotPtr, 8, 0.0);
      return;
    }
    const eps = ext / l0;
    const tOut = Math.max(0.0, k * Math.pow(eps, p) + cDamp * vel);
    setIo(slotPtr, 8, tOut);
    return;
  }

  // =========================================================================
  // 18. SIMO_DPController — PID Stationkeeping Controller
  // =========================================================================
  if (archetypeId == ARCH_SIMO_DP_CONTROLLER) {
    const kp = getCon(slotPtr, conCount, 0, 2.5e5);
    const ki = getCon(slotPtr, conCount, 1, 1.2e4);
    const kd = getCon(slotPtr, conCount, 2, 8.0e5);
    const fMax = Math.max(1.0, getCon(slotPtr, conCount, 3, 2.0e6));

    const posErr = getIo(slotPtr, 0); // x_ref - x
    const velErr = getIo(slotPtr, 1); // v_ref - v
    let intErr = getState(slotPtr, 0);
    if (dt > 0.0) {
      intErr += posErr * dt;
    }
    const rawF = kp * posErr + ki * intErr + kd * velErr;
    const cmdF = clamp(rawF, -fMax, fMax);
    if (Math.abs(rawF) < fMax && dt > 0.0) {
      setState(slotPtr, 0, intErr);
    } else if (Math.abs(rawF) >= fMax) {
      setIo(slotPtr, 15, 1.0);
    }
    setIo(slotPtr, 8, cmdF);
    return;
  }

  // =========================================================================
  // 19. ENV_CurrentProfile — Power-Law Tidal + Linear Wind Drift Current
  // =========================================================================
  if (archetypeId == ARCH_ENV_CURRENT_PROFILE) {
    const vSurf = getCon(slotPtr, conCount, 0, 1.2);
    const depth = Math.max(1.0, getCon(slotPtr, conCount, 1, 300.0));
    const alpha = Math.max(0.01, getCon(slotPtr, conCount, 2, 0.142857));
    const vWind = getCon(slotPtr, conCount, 3, 0.25);
    const z0 = Math.max(1.0, getCon(slotPtr, conCount, 4, 50.0));

    // zDepth: positive depth below mean sea level (0 at surface, depth at seabed)
    const zDepth = clamp(getIo(slotPtr, 0), 0.0, depth);
    const vTide = vSurf * Math.pow(Math.max(0.0, (depth - zDepth) / depth), alpha);
    const vDrift = zDepth < z0 ? vWind * ((z0 - zDepth) / z0) : 0.0;
    const vTotal = vTide + vDrift;

    setIo(slotPtr, 8, vTotal);
    setIo(slotPtr, 9, vTide);
    setIo(slotPtr, 10, vDrift);
    return;
  }
}
