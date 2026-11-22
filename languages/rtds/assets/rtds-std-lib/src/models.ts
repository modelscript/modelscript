// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript EMT real-time runtime for `@modelscript/rtds-std-lib`.
 *
 * Implements standardized Dommel/EMTP/IEEE/IEC mathematical formulations for RTDS / RSCAD
 * Master Component Library models at 50 µs (and substep) EMT timesteps using a zero-GC
 * 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B): `META[32]`   (`i32`)
 *   - `0x080..0x37F` (768 B): `PARAM[96]`  (`f64`) — component parameters
 *   - `0x380..0x67F` (768 B): `STATE[96]`  (`f64`) — companion history, delay buffers, integrators
 *   - `0x680..0x7FF` (384 B): `IO[48]`     (`f64`) — EMT terminal & control I/O channels:
 *       IO[0]=va, IO[1]=vb, IO[2]=vc, IO[3]=ia, IO[4]=ib, IO[5]=ic,
 *       IO[6]=vdc, IO[7]=idc, IO[8]=vd, IO[9]=vq, IO[10]=v0,
 *       IO[11]=theta, IO[12]=omega, IO[13]=freqHz, IO[14]=ref, IO[15]=meas,
 *       IO[16]=ctrlOut, IO[17]=trip, IO[18]=gEq, IO[19]=iHist,
 *       IO[20]=pOut, IO[21]=qOut, IO[22]=va2, IO[23]=ia2
 */

const OFF_PARAM: usize = 0x080;
const OFF_STATE: usize = 0x380;
const OFF_IO: usize = 0x680;

const TWO_PI: f64 = 2.0 * Math.PI;
const TWO_PI_3: f64 = (2.0 * Math.PI) / 3.0;
const SQRT2_OVER_SQRT3: f64 = 0.816496580927726; // sqrt(2/3)

// Archetype IDs (must match `RtdsArchetypeId` in rtds-std-schemas.ts)
const ARCH_SOURCE_3P: i32 = 1;
const ARCH_SOURCE_DC: i32 = 2;
const ARCH_SYNC_MACH: i32 = 3;
const ARCH_IND_MACH: i32 = 4;
const ARCH_PMSG_MACH: i32 = 5;
const ARCH_RLC_BRANCH: i32 = 10;
const ARCH_BERGERON_LINE: i32 = 11;
const ARCH_FD_LINE: i32 = 12;
const ARCH_XFMR_2W: i32 = 13;
const ARCH_XFMR_3W: i32 = 14;
const ARCH_SURGE_ARRESTER: i32 = 15;
const ARCH_BREAKER: i32 = 16;
const ARCH_FAULT: i32 = 17;
const ARCH_VSC_2LVL: i32 = 20;
const ARCH_VSC_3LVL_NPC: i32 = 21;
const ARCH_MMC_SUBSTEP: i32 = 22;
const ARCH_DCDC_BUCK_BOOST: i32 = 23;
const ARCH_PV_ARRAY: i32 = 24;
const ARCH_BESS_PACK: i32 = 25;
const ARCH_PI_CTRL: i32 = 30;
const ARCH_LEAD_LAG: i32 = 31;
const ARCH_PLL_SRF: i32 = 32;
const ARCH_ABC_DQ0: i32 = 33;
const ARCH_DQ0_ABC: i32 = 34;
const ARCH_PWM_GEN: i32 = 35;
const ARCH_RMS_METER: i32 = 36;
const ARCH_OC_50_51: i32 = 40;
const ARCH_DIST_21: i32 = 41;
const ARCH_DIFF_87: i32 = 42;
const ARCH_FREQ_81: i32 = 43;

@inline
function clamp(x: f64, lo: f64, hi: f64): f64 {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

@inline
function wrapAngle(theta: f64): f64 {
  let a = theta % TWO_PI;
  if (a < 0.0) a += TWO_PI;
  return a;
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
export function rtdsGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes EMT component state slots prior to time-domain stepping.
 * Returns the number of primary state variables initialized.
 */
export function rtdsModelInit(archetypeId: i32, slotPtr: usize, paramCount: i32): i32 {
  // Zero primary state block (96 f64)
  for (let i: i32 = 0; i < 96; i++) {
    setState(slotPtr, i, 0.0);
  }

  if (archetypeId == ARCH_SOURCE_3P) {
    const freqHz = getParam(slotPtr, paramCount, 1, 60.0);
    const phaseRad = (getParam(slotPtr, paramCount, 2, 0.0) * Math.PI) / 180.0;
    setState(slotPtr, 0, wrapAngle(phaseRad));
    setIo(slotPtr, 11, wrapAngle(phaseRad));
    setIo(slotPtr, 12, TWO_PI * freqHz);
    setIo(slotPtr, 13, freqHz);
    return 1;
  }

  if (archetypeId == ARCH_SOURCE_DC) {
    const vdc = getParam(slotPtr, paramCount, 0, 1000.0);
    const rSrc = Math.max(1e-6, getParam(slotPtr, paramCount, 1, 0.01));
    setIo(slotPtr, 6, vdc);
    setIo(slotPtr, 18, 1.0 / rSrc);
    setIo(slotPtr, 19, vdc / rSrc);
    return 1;
  }

  if (archetypeId == ARCH_SYNC_MACH || archetypeId == ARCH_IND_MACH || archetypeId == ARCH_PMSG_MACH) {
    const freqHz = getParam(slotPtr, paramCount, archetypeId == ARCH_PMSG_MACH ? 1 : 2, 60.0);
    setState(slotPtr, 0, 0.0); // rotor angle delta / theta
    setState(slotPtr, 1, 0.0); // speed deviation dw (pu) or slip
    setState(slotPtr, 2, 1.0); // internal emf eqp (pu)
    setIo(slotPtr, 12, TWO_PI * freqHz);
    setIo(slotPtr, 13, freqHz);
    return 3;
  }

  if (archetypeId == ARCH_RLC_BRANCH || archetypeId == ARCH_XFMR_2W || archetypeId == ARCH_XFMR_3W) {
    // STATE[0]=iPrev, STATE[1]=vLPrev, STATE[2]=vCPrev
    setIo(slotPtr, 3, 0.0);
    setIo(slotPtr, 19, 0.0);
    return 3;
  }

  if (archetypeId == ARCH_BERGERON_LINE || archetypeId == ARCH_FD_LINE) {
    const zc = Math.max(1.0, getParam(slotPtr, paramCount, 0, 300.0));
    const rTot = Math.max(0.0, getParam(slotPtr, paramCount, 2, 2.0));
    const zEff = zc + 0.25 * rTot;
    setIo(slotPtr, 18, 1.0 / zEff);
    setIo(slotPtr, 19, 0.0);
    return 65;
  }

  if (archetypeId == ARCH_BREAKER) {
    const closed = getParam(slotPtr, paramCount, 2, 1.0) >= 0.5 ? 1.0 : 0.0;
    setState(slotPtr, 0, closed);
    setIo(slotPtr, 17, closed);
    return 1;
  }

  if (archetypeId == ARCH_BESS_PACK) {
    const socInit = clamp(getParam(slotPtr, paramCount, 3, 0.5), 0.0, 1.0);
    setState(slotPtr, 0, socInit);
    setIo(slotPtr, 16, socInit);
    return 1;
  }

  if (archetypeId == ARCH_PLL_SRF) {
    const freqNom = getParam(slotPtr, paramCount, 0, 60.0);
    const omegaNom = TWO_PI * freqNom;
    setState(slotPtr, 0, 0.0); // theta
    setState(slotPtr, 1, 0.0); // PI integrator
    setState(slotPtr, 2, 0.0); // prev vq
    setIo(slotPtr, 11, 0.0);
    setIo(slotPtr, 12, omegaNom);
    setIo(slotPtr, 13, freqNom);
    return 3;
  }

  if (archetypeId == ARCH_OC_50_51 || archetypeId == ARCH_DIST_21 || archetypeId == ARCH_DIFF_87 || archetypeId == ARCH_FREQ_81) {
    setState(slotPtr, 0, 0.0); // timer / integrator
    setState(slotPtr, 1, 0.0); // latched trip
    setIo(slotPtr, 17, 0.0);
    return 2;
  }

  return 2;
}

/**
 * Helper: Dommel trapezoidal companion-circuit step for a series R-L-C branch.
 */
@inline
function stepDommelRlc(slotPtr: usize, dt: f64, r: f64, l: f64, c: f64, vDiff: f64): void {
  const iPrev = getState(slotPtr, 0);
  const vLPrev = getState(slotPtr, 1);
  const vCPrev = getState(slotPtr, 2);

  const rL = l > 0.0 ? (2.0 * l) / dt : 0.0;
  const rC = c > 0.0 ? dt / (2.0 * c) : 0.0;
  const rEq = Math.max(1e-9, r + rL + rC);
  const gEq = 1.0 / rEq;

  const vHist = (rL - rC) * iPrev + (l > 0.0 ? vLPrev : 0.0) - (c > 0.0 ? vCPrev : 0.0);
  const iHist = gEq * vHist;
  const iNow = gEq * vDiff + iHist;

  const vLNow = l > 0.0 ? rL * (iNow - iPrev) - vLPrev : 0.0;
  const vCNow = c > 0.0 ? vCPrev + rC * (iNow + iPrev) : 0.0;

  setState(slotPtr, 0, iNow);
  setState(slotPtr, 1, vLNow);
  setState(slotPtr, 2, vCNow);
  setIo(slotPtr, 3, iNow);
  setIo(slotPtr, 18, gEq);
  setIo(slotPtr, 19, iHist);
}

/**
 * Advances a single RTDS EMT component by one discrete timestep `dt` (typically 50e-6 s).
 */
export function rtdsModelStep(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  paramCount: i32,
): void {
  const hDt = dt > 1e-9 ? dt : 50e-6;

  // ── 1. Three-Phase AC Voltage Source ───────────────────────────────────────
  if (archetypeId == ARCH_SOURCE_3P) {
    const vllRms = getParam(slotPtr, paramCount, 0, 230000.0);
    const freqHz = getParam(slotPtr, paramCount, 1, 60.0);
    const phaseRad = (getParam(slotPtr, paramCount, 2, 0.0) * Math.PI) / 180.0;
    const rSrc = Math.max(1e-6, getParam(slotPtr, paramCount, 3, 0.5));
    const lSrc = Math.max(0.0, getParam(slotPtr, paramCount, 4, 0.005));

    const vPeak = vllRms * SQRT2_OVER_SQRT3;
    const omega = TWO_PI * freqHz;
    const theta = wrapAngle(omega * t + phaseRad);

    const va = vPeak * Math.cos(theta);
    const vb = vPeak * Math.cos(theta - TWO_PI_3);
    const vc = vPeak * Math.cos(theta + TWO_PI_3);
    const gEq = 1.0 / (rSrc + (2.0 * lSrc) / hDt);

    setState(slotPtr, 0, theta);
    setIo(slotPtr, 0, va);
    setIo(slotPtr, 1, vb);
    setIo(slotPtr, 2, vc);
    setIo(slotPtr, 11, theta);
    setIo(slotPtr, 12, omega);
    setIo(slotPtr, 13, freqHz);
    setIo(slotPtr, 18, gEq);
    setIo(slotPtr, 19, gEq * va);
    return;
  }

  // ── 2. DC Voltage Source ───────────────────────────────────────────────────
  if (archetypeId == ARCH_SOURCE_DC) {
    const vdc = getParam(slotPtr, paramCount, 0, 1000.0);
    const rSrc = Math.max(1e-6, getParam(slotPtr, paramCount, 1, 0.01));
    const vTerm = getIo(slotPtr, 6);
    const gEq = 1.0 / rSrc;
    setIo(slotPtr, 7, (vdc - vTerm) * gEq);
    setIo(slotPtr, 18, gEq);
    setIo(slotPtr, 19, vdc * gEq);
    return;
  }

  // ── 3. Rotating Machines (Sync / Ind / PMSG) ───────────────────────────────
  if (archetypeId == ARCH_SYNC_MACH || archetypeId == ARCH_IND_MACH || archetypeId == ARCH_PMSG_MACH) {
    const freqHz = getParam(slotPtr, paramCount, archetypeId == ARCH_PMSG_MACH ? 1 : 2, 60.0);
    const omegaBase = TWO_PI * freqHz;
    const hConst = Math.max(0.2, getParam(slotPtr, paramCount, archetypeId == ARCH_PMSG_MACH ? 5 : 3, 3.5));
    const xEq = Math.max(0.05, getParam(slotPtr, paramCount, archetypeId == ARCH_SYNC_MACH ? 5 : 6, 0.3));
    const pMech = getIo(slotPtr, 14);
    const vTerm = getIo(slotPtr, 0) > 1e-6 ? getIo(slotPtr, 0) : 1.0;

    let delta = getState(slotPtr, 0);
    let dw = getState(slotPtr, 1);
    const eqp = getState(slotPtr, 2) > 0.1 ? getState(slotPtr, 2) : 1.0;

    const pelec = ((eqp * vTerm) / xEq) * Math.sin(delta);
    const dDw = (pMech - pelec - 1.5 * dw) / (2.0 * hConst);
    dw += dDw * hDt;
    delta += omegaBase * dw * hDt;

    setState(slotPtr, 0, delta);
    setState(slotPtr, 1, dw);
    setIo(slotPtr, 11, wrapAngle(delta));
    setIo(slotPtr, 12, omegaBase * (1.0 + dw));
    setIo(slotPtr, 13, freqHz * (1.0 + dw));
    setIo(slotPtr, 20, pelec);
    return;
  }

  // ── 4. Dommel Trapezoidal RLC Branch ───────────────────────────────────────
  if (archetypeId == ARCH_RLC_BRANCH) {
    const r = Math.max(0.0, getParam(slotPtr, paramCount, 0, 1.0));
    const l = Math.max(0.0, getParam(slotPtr, paramCount, 1, 0.01));
    const c = Math.max(0.0, getParam(slotPtr, paramCount, 2, 0.0));
    const vDiff = getIo(slotPtr, 0) - getIo(slotPtr, 1);
    stepDommelRlc(slotPtr, hDt, r, l, c, vDiff);
    return;
  }

  // ── 5. Bergeron & Frequency-Dependent Travelling-Wave Line ─────────────────
  if (archetypeId == ARCH_BERGERON_LINE || archetypeId == ARCH_FD_LINE) {
    const zc = Math.max(1.0, getParam(slotPtr, paramCount, 0, 300.0));
    const tau = Math.max(hDt, getParam(slotPtr, paramCount, 1, 500e-6));
    const rTotal = Math.max(0.0, getParam(slotPtr, paramCount, 2, 2.0));
    const damp = archetypeId == ARCH_FD_LINE ? clamp(1.0 - getParam(slotPtr, paramCount, 3, 0.02), 0.5, 1.0) : 1.0;

    const zEff = zc + 0.25 * rTotal;
    const gEq = 1.0 / zEff;
    const lossK = (zc - 0.25 * rTotal) / zEff;

    let delaySteps = <i32>Math.round(tau / hDt);
    if (delaySteps < 1) delaySteps = 1;
    if (delaySteps > 32) delaySteps = 32;

    const head = <i32>getState(slotPtr, 0);
    const readIdx = (head + 32 - delaySteps) & 31;

    // Delayed history currents from ring buffers: STATE[16..47] = hK, STATE[48..79] = hM
    const iHistK = getState(slotPtr, 16 + readIdx);
    const iHistM = getState(slotPtr, 48 + readIdx);

    const vk = getIo(slotPtr, 0);
    const vm = getIo(slotPtr, 22);

    const ik = gEq * vk + iHistK;
    const im = gEq * vm + iHistM;

    // Launch new travelling waves into ring buffer
    const newHK = damp * (-gEq * vm - lossK * im);
    const newHM = damp * (-gEq * vk - lossK * ik);
    setState(slotPtr, 16 + head, newHK);
    setState(slotPtr, 48 + head, newHM);
    setState(slotPtr, 0, <f64>((head + 1) & 31));

    setIo(slotPtr, 3, ik);
    setIo(slotPtr, 23, im);
    setIo(slotPtr, 18, gEq);
    setIo(slotPtr, 19, iHistK);
    return;
  }

  // ── 6. 2W & 3W Transformers ────────────────────────────────────────────────
  if (archetypeId == ARCH_XFMR_2W || archetypeId == ARCH_XFMR_3W) {
    const turns = Math.max(1e-3, getParam(slotPtr, paramCount, 0, 1.0));
    const rLeak = Math.max(1e-4, getParam(slotPtr, paramCount, archetypeId == ARCH_XFMR_2W ? 1 : 2, 0.5));
    const lLeak = Math.max(1e-6, getParam(slotPtr, paramCount, archetypeId == ARCH_XFMR_2W ? 2 : 3, 0.015));
    const vPrimary = getIo(slotPtr, 0);
    const vSecReferred = getIo(slotPtr, 22) * turns;
    stepDommelRlc(slotPtr, hDt, rLeak, lLeak, 0.0, vPrimary - vSecReferred);
    setIo(slotPtr, 23, -getIo(slotPtr, 3) * turns);
    return;
  }

  // ── 7. ZnO Surge Arrester (MOV) ────────────────────────────────────────────
  if (archetypeId == ARCH_SURGE_ARRESTER) {
    const vRef = Math.max(1.0, getParam(slotPtr, paramCount, 0, 250000.0));
    const iRef = Math.max(1e-3, getParam(slotPtr, paramCount, 1, 1000.0));
    const alpha = clamp(getParam(slotPtr, paramCount, 2, 20.0), 1.0, 40.0);
    const v = getIo(slotPtr, 0);
    const absRatio = Math.min(2.0, Math.abs(v) / vRef);
    const sign: f64 = v >= 0.0 ? 1.0 : -1.0;
    const iArrester = sign * iRef * Math.pow(absRatio, alpha);
    const gEq = absRatio > 1e-6 ? (alpha * Math.abs(iArrester)) / Math.abs(v) : 1e-9;
    setIo(slotPtr, 3, iArrester);
    setIo(slotPtr, 18, gEq);
    setIo(slotPtr, 19, iArrester - gEq * v);
    return;
  }

  // ── 8. Circuit Breaker & Fault Switch ──────────────────────────────────────
  if (archetypeId == ARCH_BREAKER) {
    const rOn = Math.max(1e-6, getParam(slotPtr, paramCount, 0, 0.001));
    const rOff = Math.max(1.0, getParam(slotPtr, paramCount, 1, 1e6));
    const cmdClose = getIo(slotPtr, 14) >= 0.5 ? 1.0 : 0.0;
    let closed = getState(slotPtr, 0);
    const iPrev = getState(slotPtr, 1);
    const vDiff = getIo(slotPtr, 0) - getIo(slotPtr, 1);

    if (cmdClose > 0.5) {
      closed = 1.0;
    } else if (closed > 0.5) {
      // Zero-crossing current interruption
      const iTent = vDiff / rOn;
      if (iPrev * iTent <= 0.0 || Math.abs(iTent) < 1e-3) {
        closed = 0.0;
      }
    }

    const rNow = closed > 0.5 ? rOn : rOff;
    const gEq = 1.0 / rNow;
    const iNow = vDiff * gEq;
    setState(slotPtr, 0, closed);
    setState(slotPtr, 1, iNow);
    setIo(slotPtr, 3, iNow);
    setIo(slotPtr, 17, closed);
    setIo(slotPtr, 18, gEq);
    return;
  }

  if (archetypeId == ARCH_FAULT) {
    const rFault = Math.max(1e-6, getParam(slotPtr, paramCount, 0, 0.01));
    const rOff = Math.max(1.0, getParam(slotPtr, paramCount, 1, 1e6));
    const tOn = getParam(slotPtr, paramCount, 2, 0.1);
    const tOff = getParam(slotPtr, paramCount, 3, 0.2);
    const active = t >= tOn && t < tOff;
    const gEq = 1.0 / (active ? rFault : rOff);
    setIo(slotPtr, 3, getIo(slotPtr, 0) * gEq);
    setIo(slotPtr, 17, active ? 1.0 : 0.0);
    setIo(slotPtr, 18, gEq);
    return;
  }

  // ── 9. Power Electronics / Substep (VSC 2L, 3L NPC, MMC) ───────────────────
  if (archetypeId == ARCH_VSC_2LVL || archetypeId == ARCH_VSC_3LVL_NPC || archetypeId == ARCH_MMC_SUBSTEP) {
    const vdcNom = Math.max(10.0, getParam(slotPtr, paramCount, 0, 1200.0));
    const rFilt = Math.max(1e-4, getParam(slotPtr, paramCount, archetypeId == ARCH_MMC_SUBSTEP ? 2 : 1, 0.05));
    const lFilt = Math.max(1e-5, getParam(slotPtr, paramCount, archetypeId == ARCH_MMC_SUBSTEP ? 3 : 2, 0.002));
    const vdc = getIo(slotPtr, 6) > 1.0 ? getIo(slotPtr, 6) : vdcNom;
    const mRef = clamp(getIo(slotPtr, 14), -1.0, 1.0);
    const vConv = 0.5 * mRef * vdc;
    const vGrid = getIo(slotPtr, 0);

    stepDommelRlc(slotPtr, hDt, rFilt, lFilt, 0.0, vConv - vGrid);
    const ia = getIo(slotPtr, 3);
    const pAc = vConv * ia;
    setIo(slotPtr, 7, pAc / vdc);
    setIo(slotPtr, 16, vConv);
    setIo(slotPtr, 20, pAc);
    return;
  }

  if (archetypeId == ARCH_DCDC_BUCK_BOOST) {
    const vHigh = getIo(slotPtr, 6) > 1.0 ? getIo(slotPtr, 6) : getParam(slotPtr, paramCount, 0, 1000.0);
    const lInd = Math.max(1e-5, getParam(slotPtr, paramCount, 1, 0.002));
    const rInd = Math.max(1e-4, getParam(slotPtr, paramCount, 2, 0.02));
    const duty = clamp(getIo(slotPtr, 14), 0.05, 0.95);
    const vLow = getIo(slotPtr, 0);
    stepDommelRlc(slotPtr, hDt, rInd, lInd, 0.0, duty * vHigh - vLow);
    setIo(slotPtr, 7, duty * getIo(slotPtr, 3));
    return;
  }

  if (archetypeId == ARCH_PV_ARRAY) {
    const vOc = Math.max(10.0, getParam(slotPtr, paramCount, 0, 850.0));
    const iSc = Math.max(0.1, getParam(slotPtr, paramCount, 1, 500.0));
    const irr = Math.max(0.0, getParam(slotPtr, paramCount, 2, 1000.0));
    const vdc = clamp(getIo(slotPtr, 6), 0.0, vOc);
    const iPh = iSc * (irr / 1000.0);
    const kShape: f64 = 12.0;
    const iPv = Math.max(0.0, iPh * (1.0 - (Math.exp(kShape * (vdc / vOc - 1.0)) - Math.exp(-kShape)) / (1.0 - Math.exp(-kShape))));
    setIo(slotPtr, 7, iPv);
    setIo(slotPtr, 20, vdc * iPv);
    return;
  }

  if (archetypeId == ARCH_BESS_PACK) {
    const vNom = Math.max(10.0, getParam(slotPtr, paramCount, 0, 1000.0));
    const capAs = Math.max(1.0, getParam(slotPtr, paramCount, 1, 2000.0) * 3600.0);
    const rInt = Math.max(1e-4, getParam(slotPtr, paramCount, 2, 0.015));
    let soc = getState(slotPtr, 0);
    const iDc = getIo(slotPtr, 7); // positive = discharging
    soc = clamp(soc - (iDc * hDt) / capAs, 0.0, 1.0);
    const vOc = vNom * (0.9 + 0.2 * soc);
    const vTerm = vOc - iDc * rInt;
    setState(slotPtr, 0, soc);
    setIo(slotPtr, 6, vTerm);
    setIo(slotPtr, 16, soc);
    setIo(slotPtr, 20, vTerm * iDc);
    return;
  }

  // ── 10. Controls & Transforms ──────────────────────────────────────────────
  if (archetypeId == ARCH_PI_CTRL) {
    const kp = getParam(slotPtr, paramCount, 0, 1.0);
    const ki = getParam(slotPtr, paramCount, 1, 10.0);
    const yMin = getParam(slotPtr, paramCount, 2, -1.0);
    const yMax = getParam(slotPtr, paramCount, 3, 1.0);

    const err = getIo(slotPtr, 14) - getIo(slotPtr, 15);
    const xIntPrev = getState(slotPtr, 0);
    const errPrev = getState(slotPtr, 1);

    const xInt = clamp(xIntPrev + 0.5 * ki * hDt * (err + errPrev), yMin, yMax);
    const yOut = clamp(kp * err + xInt, yMin, yMax);

    setState(slotPtr, 0, xInt);
    setState(slotPtr, 1, err);
    setIo(slotPtr, 16, yOut);
    return;
  }

  if (archetypeId == ARCH_LEAD_LAG) {
    const gain = getParam(slotPtr, paramCount, 0, 1.0);
    const t1 = Math.max(0.0, getParam(slotPtr, paramCount, 1, 0.1));
    const t2 = Math.max(1e-6, getParam(slotPtr, paramCount, 2, 0.02));
    const u = getIo(slotPtr, 15);
    const uPrev = getState(slotPtr, 0);
    const yPrev = getState(slotPtr, 1);

    const a0 = 2.0 * t2 + hDt;
    const a1 = hDt - 2.0 * t2;
    const b0 = gain * (2.0 * t1 + hDt);
    const b1 = gain * (hDt - 2.0 * t1);
    const y = (b0 * u + b1 * uPrev - a1 * yPrev) / a0;

    setState(slotPtr, 0, u);
    setState(slotPtr, 1, y);
    setIo(slotPtr, 16, y);
    return;
  }

  if (archetypeId == ARCH_PLL_SRF) {
    const freqNom = getParam(slotPtr, paramCount, 0, 60.0);
    const kp = getParam(slotPtr, paramCount, 1, 120.0);
    const ki = getParam(slotPtr, paramCount, 2, 3600.0);
    const vNom = Math.max(1e-6, getParam(slotPtr, paramCount, 3, 1.0));
    const omegaNom = TWO_PI * freqNom;

    const va = getIo(slotPtr, 0);
    const vb = getIo(slotPtr, 1);
    const vc = getIo(slotPtr, 2);

    let theta = getState(slotPtr, 0);
    let xInt = getState(slotPtr, 1);
    const vqPrev = getState(slotPtr, 2);

    // Park transform at current PLL angle
    const c0 = Math.cos(theta);
    const c1 = Math.cos(theta - TWO_PI_3);
    const c2 = Math.cos(theta + TWO_PI_3);
    const s0 = Math.sin(theta);
    const s1 = Math.sin(theta - TWO_PI_3);
    const s2 = Math.sin(theta + TWO_PI_3);

    const vd = (2.0 / 3.0) * (va * c0 + vb * c1 + vc * c2);
    const vq = (-2.0 / 3.0) * (va * s0 + vb * s1 + vc * s2);
    const v0 = (1.0 / 3.0) * (va + vb + vc);

    const err = vq / vNom;
    xInt = clamp(xInt + 0.5 * ki * hDt * (err + vqPrev), -omegaNom * 0.5, omegaNom * 0.5);
    const omega = omegaNom + kp * err + xInt;
    theta = wrapAngle(theta + omega * hDt);

    setState(slotPtr, 0, theta);
    setState(slotPtr, 1, xInt);
    setState(slotPtr, 2, err);

    setIo(slotPtr, 8, vd);
    setIo(slotPtr, 9, vq);
    setIo(slotPtr, 10, v0);
    setIo(slotPtr, 11, theta);
    setIo(slotPtr, 12, omega);
    setIo(slotPtr, 13, omega / TWO_PI);
    return;
  }

  if (archetypeId == ARCH_ABC_DQ0) {
    const offset = getParam(slotPtr, paramCount, 0, 0.0);
    const theta = getIo(slotPtr, 11) + offset;
    const va = getIo(slotPtr, 0);
    const vb = getIo(slotPtr, 1);
    const vc = getIo(slotPtr, 2);

    const vd =
      (2.0 / 3.0) * (va * Math.cos(theta) + vb * Math.cos(theta - TWO_PI_3) + vc * Math.cos(theta + TWO_PI_3));
    const vq =
      (-2.0 / 3.0) * (va * Math.sin(theta) + vb * Math.sin(theta - TWO_PI_3) + vc * Math.sin(theta + TWO_PI_3));
    const v0 = (1.0 / 3.0) * (va + vb + vc);

    setIo(slotPtr, 8, vd);
    setIo(slotPtr, 9, vq);
    setIo(slotPtr, 10, v0);
    return;
  }

  if (archetypeId == ARCH_DQ0_ABC) {
    const offset = getParam(slotPtr, paramCount, 0, 0.0);
    const theta = getIo(slotPtr, 11) + offset;
    const vd = getIo(slotPtr, 8);
    const vq = getIo(slotPtr, 9);
    const v0 = getIo(slotPtr, 10);

    const va = vd * Math.cos(theta) - vq * Math.sin(theta) + v0;
    const vb = vd * Math.cos(theta - TWO_PI_3) - vq * Math.sin(theta - TWO_PI_3) + v0;
    const vc = vd * Math.cos(theta + TWO_PI_3) - vq * Math.sin(theta + TWO_PI_3) + v0;

    setIo(slotPtr, 0, va);
    setIo(slotPtr, 1, vb);
    setIo(slotPtr, 2, vc);
    return;
  }

  if (archetypeId == ARCH_PWM_GEN) {
    const fCar = Math.max(1.0, getParam(slotPtr, paramCount, 0, 2000.0));
    const vCar = Math.max(1e-6, getParam(slotPtr, paramCount, 1, 1.0));
    const phase = (t * fCar) % 1.0;
    const tri = phase < 0.5 ? vCar * (4.0 * phase - 1.0) : vCar * (3.0 - 4.0 * phase);
    const gate = getIo(slotPtr, 14) >= tri ? 1.0 : 0.0;
    setIo(slotPtr, 16, gate);
    return;
  }

  if (archetypeId == ARCH_RMS_METER) {
    const tau = Math.max(hDt, getParam(slotPtr, paramCount, 1, 1.0 / 60.0));
    const x = getIo(slotPtr, 15);
    let ms = getState(slotPtr, 0);
    const alpha = hDt / (tau + hDt);
    ms = ms + alpha * (x * x - ms);
    setState(slotPtr, 0, ms);
    setIo(slotPtr, 16, Math.sqrt(Math.max(0.0, ms)));
    return;
  }

  // ── 11. Protection Relays (50/51, 21, 87, 81) ──────────────────────────────
  if (archetypeId == ARCH_OC_50_51) {
    const iPickup = Math.max(1e-6, getParam(slotPtr, paramCount, 0, 1.2));
    const tds = Math.max(0.01, getParam(slotPtr, paramCount, 1, 0.5));
    const iInst = Math.max(iPickup, getParam(slotPtr, paramCount, 2, 5.0));
    const curveA = getParam(slotPtr, paramCount, 3, 19.61);
    const curveB = getParam(slotPtr, paramCount, 4, 0.491);
    const curveP = getParam(slotPtr, paramCount, 5, 2.0);

    const iMag = Math.abs(getIo(slotPtr, 15));
    let accum = getState(slotPtr, 0);
    let tripped = getState(slotPtr, 1);

    if (iMag >= iInst) {
      tripped = 1.0;
    } else if (iMag > iPickup) {
      const m = iMag / iPickup;
      const denom = Math.max(1e-6, Math.pow(m, curveP) - 1.0);
      const tOp = tds * (curveA / denom + curveB);
      accum += hDt / Math.max(1e-6, tOp);
      if (accum >= 1.0) {
        tripped = 1.0;
      }
    } else if (tripped < 0.5) {
      accum = Math.max(0.0, accum - hDt * 2.0);
    }

    setState(slotPtr, 0, accum);
    setState(slotPtr, 1, tripped);
    setIo(slotPtr, 16, accum);
    setIo(slotPtr, 17, tripped);
    return;
  }

  if (archetypeId == ARCH_DIST_21) {
    const zReach = Math.max(1e-3, getParam(slotPtr, paramCount, 0, 10.0));
    const tDelay = Math.max(0.0, getParam(slotPtr, paramCount, 1, 0.02));
    const vMag = Math.abs(getIo(slotPtr, 0));
    const iMag = Math.abs(getIo(slotPtr, 3));
    let timer = getState(slotPtr, 0);
    let tripped = getState(slotPtr, 1);
    if (iMag > 1e-6 && vMag / iMag <= zReach) {
      timer += hDt;
      if (timer >= tDelay) tripped = 1.0;
    } else if (tripped < 0.5) {
      timer = 0.0;
    }
    setState(slotPtr, 0, timer);
    setState(slotPtr, 1, tripped);
    setIo(slotPtr, 17, tripped);
    return;
  }

  if (archetypeId == ARCH_DIFF_87) {
    const iPickup = Math.max(1e-6, getParam(slotPtr, paramCount, 0, 0.3));
    const slope = Math.max(0.0, getParam(slotPtr, paramCount, 1, 0.25));
    const tDelay = Math.max(0.0, getParam(slotPtr, paramCount, 2, 0.01));
    const i1 = getIo(slotPtr, 3);
    const i2 = getIo(slotPtr, 23);
    const iDiff = Math.abs(i1 + i2);
    const iRest = 0.5 * (Math.abs(i1) + Math.abs(i2));
    let timer = getState(slotPtr, 0);
    let tripped = getState(slotPtr, 1);
    if (iDiff > iPickup && iDiff > slope * iRest) {
      timer += hDt;
      if (timer >= tDelay) tripped = 1.0;
    } else if (tripped < 0.5) {
      timer = 0.0;
    }
    setState(slotPtr, 0, timer);
    setState(slotPtr, 1, tripped);
    setIo(slotPtr, 17, tripped);
    return;
  }

  if (archetypeId == ARCH_FREQ_81) {
    const fLow = getParam(slotPtr, paramCount, 0, 59.3);
    const fHigh = getParam(slotPtr, paramCount, 1, 60.7);
    const tDelay = Math.max(0.0, getParam(slotPtr, paramCount, 2, 0.1));
    const freqHz = getIo(slotPtr, 13);
    let timer = getState(slotPtr, 0);
    let tripped = getState(slotPtr, 1);
    if (freqHz < fLow || freqHz > fHigh) {
      timer += hDt;
      if (timer >= tDelay) tripped = 1.0;
    } else if (tripped < 0.5) {
      timer = 0.0;
    }
    setState(slotPtr, 0, timer);
    setState(slotPtr, 1, tripped);
    setIo(slotPtr, 17, tripped);
    return;
  }
}

/**
 * Batched zero-copy initialization across `count` EMT component descriptors:
 * each descriptor is 16 bytes `{ archetypeId: i32, slotPtr: u32, reserved: i32, paramCount: i32 }`.
 */
export function rtdsBatchInit(count: i32, tablePtr: usize): void {
  for (let i: i32 = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const paramCount = load<i32>(entry + 12);
    rtdsModelInit(archetypeId, slotPtr, paramCount);
  }
}

/**
 * Batched zero-copy EMT time-step across `count` component descriptors.
 */
export function rtdsBatchStep(count: i32, t: f64, dt: f64, tablePtr: usize): void {
  for (let i: i32 = 0; i < count; i++) {
    const entry = tablePtr + (<usize>i << 4);
    const archetypeId = load<i32>(entry + 0);
    const slotPtr = <usize>load<u32>(entry + 4);
    const paramCount = load<i32>(entry + 12);
    rtdsModelStep(archetypeId, t, dt, slotPtr, paramCount);
  }
}
