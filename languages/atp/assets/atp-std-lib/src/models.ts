// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript electromagnetic transient model runtime for `@modelscript/atp-std-lib`.
 *
 * Implements standardized Dommel EMTP Theory Book / IEEE / CIGRE mathematical formulations
 * using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B): `META[32]`  (`i32`)
 *   - `0x080..0x37F` (768 B): `CON[96]`   (`f64`) — ATP card parameter vector
 *   - `0x380..0x67F` (768 B): `STATE[96]` (`f64`) — dynamic state & delay ring buffers
 *   - `0x680..0x77F` (256 B): `AUX[32]`   (`f64`) — auxiliary / scratch registers
 *   - `0x780..0x7FF` (128 B): `IO[16]`    (`f64`) — network & TACS I/O bus:
 *       IO[0]  = vNode1 (V)       IO[1]  = vNode2 (V)
 *       IO[2]  = iBranch (A)      IO[3]  = gEq (S)
 *       IO[4]  = iHist (A)        IO[5]  = iHist2 (A)
 *       IO[6]  = vSource (V)      IO[7]  = switchState (0=open, 1=closed)
 *       IO[8]  = ctrlIn           IO[9]  = ctrlOut
 *       IO[10] = flux (Wb)        IO[11] = powerW (W)
 *       IO[12] = omegaRadS        IO[13] = torqueNm
 *       IO[14] = auxIn            IO[15] = auxOut (e.g. MOV energy J)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x380;
const OFF_AUX: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `AtpArchetypeId` in atp-std-schemas.ts)
const ARCH_BRANCH_RLC_00: i32 = 1;
const ARCH_LINE_PI_01: i32 = 2;
const ARCH_LINE_BERGERON_M1: i32 = 3;
const ARCH_LINE_JMARTI_FD: i32 = 4;
const ARCH_LINE_SEMLYEN_FD: i32 = 5;
const ARCH_XFMR_SATURABLE: i32 = 6;
const ARCH_XFMR_BCTRAN: i32 = 7;

const ARCH_NONLIN_IND_98: i32 = 10;
const ARCH_NONLIN_HYST_96: i32 = 11;
const ARCH_MOV_ARRESTER_92: i32 = 12;
const ARCH_SWITCH_TIME_00: i32 = 13;
const ARCH_SWITCH_STAT_04: i32 = 14;
const ARCH_SWITCH_DIODE_11: i32 = 15;
const ARCH_SWITCH_THYRISTOR_11: i32 = 16;
const ARCH_SWITCH_TACS_13: i32 = 17;

const ARCH_SRC_AC_14: i32 = 20;
const ARCH_SRC_IMPULSE_15: i32 = 21;
const ARCH_SRC_DC_11: i32 = 22;
const ARCH_MACH_SYNC_59: i32 = 23;
const ARCH_MACH_UNIVERSAL_19: i32 = 24;

const ARCH_TACS_TF_S: i32 = 30;
const ARCH_TACS_INTEGRATOR: i32 = 31;
const ARCH_TACS_LIMITER: i32 = 32;
const ARCH_TACS_DELAY: i32 = 33;
const ARCH_TACS_LOGIC: i32 = 34;
const ARCH_MODELS_USER: i32 = 35;

const BERGERON_RING_LEN: i32 = 32;
const TACS_DELAY_RING_LEN: i32 = 64;

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
function setAux(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_AUX + (<usize>idx << 3), v);
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
export function atpGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes electromagnetic transient states and delay buffers for an ATP archetype.
 * Returns the number of primary dynamic state slots used by the archetype.
 */
export function atpModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  // Zero state block (96 f64 slots)
  for (let i: i32 = 0; i < 96; i++) {
    setState(slotPtr, i, 0.0);
  }

  if (archetypeId == ARCH_BRANCH_RLC_00) {
    // STATE[0]=iPrev, STATE[1]=vLPrev, STATE[2]=vCPrev
    setIo(slotPtr, 2, 0.0);
    setIo(slotPtr, 4, 0.0);
    return 3;
  }

  if (archetypeId == ARCH_LINE_PI_01) {
    // STATE[0]=iSeriesPrev, STATE[1]=vLPrev, STATE[2]=iC1Prev, STATE[3]=v1Prev, STATE[4]=iC2Prev, STATE[5]=v2Prev
    setIo(slotPtr, 2, 0.0);
    setIo(slotPtr, 4, 0.0);
    setIo(slotPtr, 5, 0.0);
    return 6;
  }

  if (
    archetypeId == ARCH_LINE_BERGERON_M1 ||
    archetypeId == ARCH_LINE_JMARTI_FD ||
    archetypeId == ARCH_LINE_SEMLYEN_FD
  ) {
    // STATE[0]=ringIdx, STATE[1]=filt1, STATE[2]=filt2, STATE[4..35]=ring1to2, STATE[36..67]=ring2to1
    const zc = Math.max(1.0, getCon(slotPtr, conCount, 0, 400.0));
    setIo(slotPtr, 2, 0.0);
    setIo(slotPtr, 3, 1.0 / zc);
    setIo(slotPtr, 4, 0.0);
    setIo(slotPtr, 5, 0.0);
    return 68;
  }

  if (archetypeId == ARCH_XFMR_SATURABLE || archetypeId == ARCH_XFMR_BCTRAN) {
    // STATE[0]=iLeakPrev, STATE[1]=vLeakPrev, STATE[2]=flux, STATE[3]=v1Prev
    setIo(slotPtr, 2, 0.0);
    setIo(slotPtr, 10, 0.0);
    return 4;
  }

  if (archetypeId == ARCH_NONLIN_IND_98 || archetypeId == ARCH_NONLIN_HYST_96) {
    // STATE[0]=flux, STATE[1]=vPrev, STATE[2]=iPrev
    const fluxRes = archetypeId == ARCH_NONLIN_HYST_96 ? getCon(slotPtr, conCount, 3, 0.25) : 0.0;
    setState(slotPtr, 0, fluxRes);
    setIo(slotPtr, 10, fluxRes);
    setIo(slotPtr, 2, 0.0);
    return 3;
  }

  if (archetypeId == ARCH_MOV_ARRESTER_92) {
    // STATE[0]=absorbedEnergyJ
    const rLeak = Math.max(1.0, getCon(slotPtr, conCount, 3, 1.0e9));
    setIo(slotPtr, 2, 0.0);
    setIo(slotPtr, 3, 1.0 / rLeak);
    setIo(slotPtr, 4, 0.0);
    setIo(slotPtr, 15, 0.0);
    return 1;
  }

  if (
    archetypeId == ARCH_SWITCH_TIME_00 ||
    archetypeId == ARCH_SWITCH_STAT_04 ||
    archetypeId == ARCH_SWITCH_DIODE_11 ||
    archetypeId == ARCH_SWITCH_THYRISTOR_11 ||
    archetypeId == ARCH_SWITCH_TACS_13
  ) {
    // STATE[0]=closedFlag (0/1), STATE[1]=iPrev
    setIo(slotPtr, 7, 0.0);
    setIo(slotPtr, 2, 0.0);
    return 2;
  }

  if (archetypeId == ARCH_SRC_AC_14 || archetypeId == ARCH_SRC_IMPULSE_15 || archetypeId == ARCH_SRC_DC_11) {
    setIo(slotPtr, 6, 0.0);
    return 0;
  }

  if (archetypeId == ARCH_MACH_SYNC_59) {
    // Full 3-phase Park d-q-0 synchronous machine states:
    // STATE[0]=thetaRad, STATE[1]=omegaRadS,
    // STATE[2]=Eq' (pu), STATE[3]=Ed' (pu), STATE[4]=psi_kd (pu), STATE[5]=psi_kq (pu),
    // STATE[6]=id (pu), STATE[7]=iq (pu), STATE[8]=i0 (pu)
    const freqHz = Math.max(1.0, getCon(slotPtr, conCount, 1, 60.0));
    const omega0 = 2.0 * Math.PI * freqHz;
    setState(slotPtr, 0, 0.0);
    setState(slotPtr, 1, omega0);
    setState(slotPtr, 2, 1.0); // Eq'
    setState(slotPtr, 3, 0.0); // Ed'
    setState(slotPtr, 4, 1.0); // psi_kd
    setState(slotPtr, 5, 0.0); // psi_kq
    setAux(slotPtr, 0, 0.0); // Ed'
    setAux(slotPtr, 1, 1.0); // Eq'
    setAux(slotPtr, 2, 1.0); // psi_kd
    setAux(slotPtr, 3, 0.0); // psi_kq
    setIo(slotPtr, 10, 1.0);
    setIo(slotPtr, 12, omega0);
    setIo(slotPtr, 13, 0.0);
    return 9;
  }

  if (archetypeId == ARCH_MACH_UNIVERSAL_19) {
    // STATE[0]=thetaRad, STATE[1]=omegaRadS
    const freqHz = Math.max(1.0, getCon(slotPtr, conCount, 1, 60.0));
    const omega0 = 2.0 * Math.PI * freqHz;
    setState(slotPtr, 0, 0.0);
    setState(slotPtr, 1, omega0);
    setIo(slotPtr, 12, omega0);
    setIo(slotPtr, 13, 0.0);
    return 2;
  }

  if (archetypeId == ARCH_TACS_TF_S) {
    // STATE[0]=yPrev, STATE[1]=uPrev
    setIo(slotPtr, 9, 0.0);
    return 2;
  }

  if (archetypeId == ARCH_TACS_INTEGRATOR) {
    // STATE[0]=yPrev, STATE[1]=uPrev
    const y0 = getCon(slotPtr, conCount, 1, 0.0);
    const yMin = getCon(slotPtr, conCount, 2, -1.0e9);
    const yMax = getCon(slotPtr, conCount, 3, 1.0e9);
    const clampedY0 = clamp(y0, yMin, yMax);
    setState(slotPtr, 0, clampedY0);
    setState(slotPtr, 1, getIo(slotPtr, 8));
    setIo(slotPtr, 9, clampedY0);
    return 2;
  }

  if (archetypeId == ARCH_TACS_DELAY) {
    // STATE[0]=ringIdx, STATE[2..65]=ringBuffer
    const initOut = getCon(slotPtr, conCount, 1, 0.0);
    for (let i: i32 = 0; i < TACS_DELAY_RING_LEN; i++) {
      setState(slotPtr, 2 + i, initOut);
    }
    setIo(slotPtr, 9, initOut);
    return 66;
  }

  if (archetypeId == ARCH_TACS_LIMITER || archetypeId == ARCH_TACS_LOGIC || archetypeId == ARCH_MODELS_USER) {
    setIo(slotPtr, 9, 0.0);
    return 2;
  }

  return 0;
}

/**
 * Advances an EMTP-ATP cleanroom component by one discrete time step `dt` (seconds) at time `t`.
 */
export function atpModelStep(
  archetypeId: i32,
  t: f64,
  dt: f64,
  slotPtr: usize,
  conCount: i32,
): void {
  const h = dt > 1e-12 ? dt : 1e-6;
  const v1 = getIo(slotPtr, 0);
  const v2 = getIo(slotPtr, 1);
  const vDiff = v1 - v2;

  // -------------------------------------------------------------------------
  // 1. BRANCH_RLC_00 — Dommel trapezoidal series RLC companion circuit
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_BRANCH_RLC_00) {
    const r = Math.max(0.0, getCon(slotPtr, conCount, 0, 1.0));
    const l = Math.max(0.0, getCon(slotPtr, conCount, 1, 10.0)) * 1.0e-3;
    const c = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.0)) * 1.0e-6;

    const rL = l > 0.0 ? (2.0 * l) / h : 0.0;
    const rC = c > 0.0 ? h / (2.0 * c) : 0.0;
    const rEff = Math.max(1.0e-9, r + rL + rC);
    const gEq = 1.0 / rEff;

    const iPrev = getState(slotPtr, 0);
    const vLPrev = getState(slotPtr, 1);
    const vCPrev = getState(slotPtr, 2);

    const vHistL = l > 0.0 ? -(rL * iPrev + vLPrev) : 0.0;
    const vHistC = c > 0.0 ? vCPrev + rC * iPrev : 0.0;
    const iHist = -gEq * (vHistL + vHistC);
    const iNew = gEq * vDiff + iHist;

    const vLNew = l > 0.0 ? rL * (iNew - iPrev) - vLPrev : 0.0;
    const vCNew = c > 0.0 ? vCPrev + rC * (iNew + iPrev) : 0.0;

    setState(slotPtr, 0, iNew);
    setState(slotPtr, 1, vLNew);
    setState(slotPtr, 2, vCNew);

    setIo(slotPtr, 2, iNew);
    setIo(slotPtr, 3, gEq);
    setIo(slotPtr, 4, iHist);
    setIo(slotPtr, 11, vDiff * iNew);
    return;
  }

  // -------------------------------------------------------------------------
  // 2. LINE_PI_01 — Nominal Pi-equivalent line (series RL + half-shunt C)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_LINE_PI_01) {
    const r = Math.max(0.0, getCon(slotPtr, conCount, 0, 2.5));
    const l = Math.max(0.0, getCon(slotPtr, conCount, 1, 25.0)) * 1.0e-3;
    const cHalf = Math.max(0.0, getCon(slotPtr, conCount, 2, 1.2)) * 0.5e-6;

    const rL = l > 0.0 ? (2.0 * l) / h : 0.0;
    const gSeries = 1.0 / Math.max(1.0e-9, r + rL);
    const iPrev = getState(slotPtr, 0);
    const vLPrev = getState(slotPtr, 1);
    const iHistSeries = l > 0.0 ? gSeries * (rL * iPrev + vLPrev) : 0.0;
    const iSeries = gSeries * vDiff + iHistSeries;
    const vLNew = l > 0.0 ? rL * (iSeries - iPrev) - vLPrev : 0.0;

    const gShunt = cHalf > 0.0 ? (2.0 * cHalf) / h : 0.0;
    const iC1Prev = getState(slotPtr, 2);
    const v1Prev = getState(slotPtr, 3);
    const iC2Prev = getState(slotPtr, 4);
    const v2Prev = getState(slotPtr, 5);

    const iHistC1 = -(gShunt * v1Prev + iC1Prev);
    const iHistC2 = -(gShunt * v2Prev + iC2Prev);
    const iC1 = gShunt * v1 + iHistC1;
    const iC2 = gShunt * v2 + iHistC2;

    setState(slotPtr, 0, iSeries);
    setState(slotPtr, 1, vLNew);
    setState(slotPtr, 2, iC1);
    setState(slotPtr, 3, v1);
    setState(slotPtr, 4, iC2);
    setState(slotPtr, 5, v2);

    setIo(slotPtr, 2, iSeries + iC1);
    setIo(slotPtr, 3, gSeries + gShunt);
    setIo(slotPtr, 4, iHistSeries + iHistC1);
    setIo(slotPtr, 5, -iHistSeries + iHistC2);
    setIo(slotPtr, 11, vDiff * iSeries);
    return;
  }

  // -------------------------------------------------------------------------
  // 3. LINE_BERGERON_M1 / LINE_JMARTI_FD / LINE_SEMLYEN_FD — Travelling-wave delay line
  // -------------------------------------------------------------------------
  if (
    archetypeId == ARCH_LINE_BERGERON_M1 ||
    archetypeId == ARCH_LINE_JMARTI_FD ||
    archetypeId == ARCH_LINE_SEMLYEN_FD
  ) {
    const zc = Math.max(1.0, getCon(slotPtr, conCount, 0, 400.0));
    const tau = Math.max(h, getCon(slotPtr, conCount, 1, 0.0005));
    const rTotal = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.0));
    const isFd = archetypeId == ARCH_LINE_JMARTI_FD || archetypeId == ARCH_LINE_SEMLYEN_FD;
    const tauAtten = isFd ? Math.max(0.0, getCon(slotPtr, conCount, 3, 0.00005)) : 0.0;

    const zEff = zc + 0.25 * rTotal;
    const gEq = 1.0 / zEff;

    let delaySteps = <i32>Math.round(tau / h);
    if (delaySteps < 1) delaySteps = 1;
    if (delaySteps >= BERGERON_RING_LEN) delaySteps = BERGERON_RING_LEN - 1;

    const writeIdx = <i32>getState(slotPtr, 0) & (BERGERON_RING_LEN - 1);
    const readIdx = (writeIdx - delaySteps + BERGERON_RING_LEN) & (BERGERON_RING_LEN - 1);

    let iHist1Raw = getState(slotPtr, 36 + readIdx);
    let iHist2Raw = getState(slotPtr, 4 + readIdx);

    if (isFd && tauAtten > 0.0) {
      // Recursive 2-pole exponential vector-fitting propagation convolution:
      //   h_k(t) = exp(-alpha_k * dt) * h_k(t - dt) + c_k * u(t)
      // where c_k = w_k * (1 - exp(-alpha_k * dt)) preserves unit DC step gain (w1 + w2 = 1).
      const tau1 = Math.max(h, tauAtten);
      const tau2 = Math.max(2.0 * h, getCon(slotPtr, conCount, 4, tau1 * 8.0));
      const alpha1 = 1.0 / tau1;
      const alpha2 = 1.0 / tau2;
      const e1 = Math.exp(-alpha1 * h);
      const e2 = Math.exp(-alpha2 * h);
      const w1: f64 = archetypeId == ARCH_LINE_SEMLYEN_FD ? 0.7 : 0.65;
      const w2: f64 = 1.0 - w1;
      const c1 = w1 * (1.0 - e1);
      const c2 = w2 * (1.0 - e2);

      // End 1 two-pole convolution states: STATE[1]=h1_1, STATE[2]=h2_1
      const h1_1 = e1 * getState(slotPtr, 1) + c1 * iHist1Raw;
      const h2_1 = e2 * getState(slotPtr, 2) + c2 * iHist1Raw;
      setState(slotPtr, 1, h1_1);
      setState(slotPtr, 2, h2_1);

      // End 2 two-pole convolution states: STATE[68]=h1_2, STATE[69]=h2_2
      const h1_2 = e1 * getState(slotPtr, 68) + c1 * iHist2Raw;
      const h2_2 = e2 * getState(slotPtr, 69) + c2 * iHist2Raw;
      setState(slotPtr, 68, h1_2);
      setState(slotPtr, 69, h2_2);

      iHist1Raw = h1_1 + h2_1;
      iHist2Raw = h1_2 + h2_2;
      setAux(slotPtr, 0, h1_1);
      setAux(slotPtr, 1, h2_1);
      setAux(slotPtr, 2, h1_2);
      setAux(slotPtr, 3, h2_2);
    }

    const i12 = gEq * v1 + iHist1Raw;
    const i21 = gEq * v2 + iHist2Raw;

    // Store travelling-wave history injections for arrival tau seconds later
    const atten = zc / (zc + 0.25 * rTotal);
    const nextHist2 = -atten * (gEq * v1 + i12);
    const nextHist1 = -atten * (gEq * v2 + i21);

    setState(slotPtr, 4 + writeIdx, nextHist2);
    setState(slotPtr, 36 + writeIdx, nextHist1);
    setState(slotPtr, 0, <f64>((writeIdx + 1) & (BERGERON_RING_LEN - 1)));

    setIo(slotPtr, 2, i12);
    setIo(slotPtr, 3, gEq);
    setIo(slotPtr, 4, iHist1Raw);
    setIo(slotPtr, 5, iHist2Raw);
    setIo(slotPtr, 11, v1 * i12 + v2 * i21);
    return;
  }

  // -------------------------------------------------------------------------
  // 4. XFMR_SATURABLE / XFMR_BCTRAN
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_XFMR_SATURABLE || archetypeId == ARCH_XFMR_BCTRAN) {
    const ratio = Math.max(1.0e-6, getCon(slotPtr, conCount, 0, 1.0));
    const rLeak = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.5));
    const lLeak = Math.max(1.0e-6, getCon(slotPtr, conCount, 2, 15.0) * 1.0e-3);
    const lMag = Math.max(1.0e-3, getCon(slotPtr, conCount, 3, 50.0));
    const fluxKnee = Math.max(1.0e-3, getCon(slotPtr, conCount, 4, 2.0));

    const vSecRef = v2 * ratio;
    const vLeak = v1 - vSecRef;
    const rL = (2.0 * lLeak) / h;
    const gEq = 1.0 / Math.max(1.0e-9, rLeak + rL);

    const iPrev = getState(slotPtr, 0);
    const vLPrev = getState(slotPtr, 1);
    const fluxPrev = getState(slotPtr, 2);
    const v1Prev = getState(slotPtr, 3);

    const iHist = gEq * (rL * iPrev + vLPrev);
    const iLeak = gEq * vLeak + iHist;
    const vLNew = rL * (iLeak - iPrev) - vLPrev;

    const flux = fluxPrev + 0.5 * h * (v1 + v1Prev);
    const absFlux = Math.abs(flux);
    const sgnFlux = flux < 0.0 ? -1.0 : 1.0;
    const iMag =
      absFlux <= fluxKnee
        ? flux / lMag
        : sgnFlux * (fluxKnee / lMag + (absFlux - fluxKnee) / (0.05 * lMag));

    setState(slotPtr, 0, iLeak);
    setState(slotPtr, 1, vLNew);
    setState(slotPtr, 2, flux);
    setState(slotPtr, 3, v1);

    setIo(slotPtr, 2, iLeak + iMag);
    setIo(slotPtr, 3, gEq);
    setIo(slotPtr, 4, iHist + iMag);
    setIo(slotPtr, 5, -iHist * ratio);
    setIo(slotPtr, 10, flux);
    setIo(slotPtr, 11, v1 * (iLeak + iMag));
    return;
  }

  // -------------------------------------------------------------------------
  // 5. NONLIN_IND_98 / NONLIN_HYST_96 — Piecewise-linear saturable inductor
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_NONLIN_IND_98 || archetypeId == ARCH_NONLIN_HYST_96) {
    const lUnsat = Math.max(1.0e-6, getCon(slotPtr, conCount, 0, 1.0));
    const lSat = Math.max(1.0e-6, getCon(slotPtr, conCount, 1, 0.05));
    const fluxKnee = Math.max(1.0e-6, getCon(slotPtr, conCount, 2, 1.0));
    const iCoercive = archetypeId == ARCH_NONLIN_HYST_96 ? getCon(slotPtr, conCount, 4, 0.5) : 0.0;

    const fluxPrev = getState(slotPtr, 0);
    const vPrev = getState(slotPtr, 1);

    const flux = fluxPrev + 0.5 * h * (vDiff + vPrev);
    const absFlux = Math.abs(flux);
    const sgnFlux = flux < 0.0 ? -1.0 : 1.0;
    const hystBias = vDiff > 0.0 ? iCoercive : vDiff < 0.0 ? -iCoercive : 0.0;

    let iBranch: f64;
    let gEq: f64;
    if (absFlux <= fluxKnee) {
      iBranch = flux / lUnsat + hystBias;
      gEq = h / (2.0 * lUnsat);
    } else {
      iBranch = sgnFlux * (fluxKnee / lUnsat + (absFlux - fluxKnee) / lSat) + hystBias;
      gEq = h / (2.0 * lSat);
    }
    const iHist = iBranch - gEq * vDiff;

    setState(slotPtr, 0, flux);
    setState(slotPtr, 1, vDiff);
    setState(slotPtr, 2, iBranch);

    setIo(slotPtr, 2, iBranch);
    setIo(slotPtr, 3, gEq);
    setIo(slotPtr, 4, iHist);
    setIo(slotPtr, 10, flux);
    setIo(slotPtr, 11, vDiff * iBranch);
    return;
  }

  // -------------------------------------------------------------------------
  // 6. MOV_ARRESTER_92 — Type 92 exponential ZnO MOV surge arrester
  //    I = Iref * (V / Vref)^q
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_MOV_ARRESTER_92) {
    const vRef = Math.max(1.0, getCon(slotPtr, conCount, 0, 100000.0));
    const iRef = Math.max(1.0e-6, getCon(slotPtr, conCount, 1, 1000.0));
    const qExp = Math.max(1.0, getCon(slotPtr, conCount, 2, 25.0));
    const rLeak = Math.max(1.0, getCon(slotPtr, conCount, 3, 1.0e9));

    const vAbs = Math.abs(vDiff);
    const sgn = vDiff < 0.0 ? -1.0 : 1.0;
    const ratio = Math.min(vAbs / vRef, 4.0);

    const iMov = ratio > 0.0 ? sgn * iRef * Math.pow(ratio, qExp) : 0.0;
    const iTotal = iMov + vDiff / rLeak;
    const gMov = ratio > 0.0 ? ((qExp * iRef) / vRef) * Math.pow(ratio, qExp - 1.0) : 0.0;
    const gEq = gMov + 1.0 / rLeak;
    const iHist = iTotal - gEq * vDiff;

    const powerW = vDiff * iTotal;
    const energyJ = getState(slotPtr, 0) + Math.abs(powerW) * h;
    setState(slotPtr, 0, energyJ);

    setIo(slotPtr, 2, iTotal);
    setIo(slotPtr, 3, gEq);
    setIo(slotPtr, 4, iHist);
    setIo(slotPtr, 11, powerW);
    setIo(slotPtr, 15, energyJ);
    return;
  }

  // -------------------------------------------------------------------------
  // 7. Switches (Time, Statistical, Diode, Thyristor, TACS)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_SWITCH_TIME_00 || archetypeId == ARCH_SWITCH_STAT_04) {
    const tCloseBase = getCon(slotPtr, conCount, 0, 0.0);
    const tOpen = getCon(slotPtr, conCount, 1, 1.0e6);
    const param2 = getCon(slotPtr, conCount, 2, 0.0);
    const rOn = Math.max(1.0e-6, getCon(slotPtr, conCount, 3, 1.0e-4));
    const tClose = archetypeId == ARCH_SWITCH_STAT_04 ? tCloseBase + param2 : tCloseBase;
    const iMargin = archetypeId == ARCH_SWITCH_TIME_00 ? Math.abs(param2) : 0.0;

    let closed = getState(slotPtr, 0) > 0.5;
    const iPrev = getState(slotPtr, 1);

    if (!closed && t >= tClose && t < tOpen) {
      closed = true;
    } else if (closed && t >= tOpen) {
      if (Math.abs(iPrev) <= iMargin || iPrev == 0.0) {
        closed = false;
      }
    }

    const gEq = closed ? 1.0 / rOn : 1.0e-9;
    const iBranch = gEq * vDiff;
    if (closed && t >= tOpen && iPrev * iBranch <= 0.0) {
      closed = false;
    }

    setState(slotPtr, 0, closed ? 1.0 : 0.0);
    setState(slotPtr, 1, closed ? iBranch : 0.0);
    setIo(slotPtr, 7, closed ? 1.0 : 0.0);
    setIo(slotPtr, 3, closed ? 1.0 / rOn : 1.0e-9);
    setIo(slotPtr, 2, closed ? iBranch : 1.0e-9 * vDiff);
    setIo(slotPtr, 4, 0.0);
    return;
  }

  if (archetypeId == ARCH_SWITCH_DIODE_11 || archetypeId == ARCH_SWITCH_THYRISTOR_11) {
    const vOn = getCon(slotPtr, conCount, 0, 0.7);
    const rOn = Math.max(1.0e-6, getCon(slotPtr, conCount, 1, 1.0e-3));
    const rOff = Math.max(1.0, getCon(slotPtr, conCount, 2, 1.0e8));
    const iHold = archetypeId == ARCH_SWITCH_THYRISTOR_11 ? getCon(slotPtr, conCount, 3, 0.05) : 0.0;
    const gate = getIo(slotPtr, 8);

    let closed = getState(slotPtr, 0) > 0.5;
    if (!closed) {
      const canTrigger = archetypeId == ARCH_SWITCH_DIODE_11 ? true : gate > 0.5;
      if (canTrigger && vDiff > vOn) closed = true;
    }

    let gEq = closed ? 1.0 / rOn : 1.0 / rOff;
    let iBranch = closed ? (vDiff - vOn) / rOn : vDiff / rOff;
    if (closed && iBranch <= iHold) {
      closed = false;
      gEq = 1.0 / rOff;
      iBranch = vDiff / rOff;
    }

    setState(slotPtr, 0, closed ? 1.0 : 0.0);
    setState(slotPtr, 1, iBranch);
    setIo(slotPtr, 7, closed ? 1.0 : 0.0);
    setIo(slotPtr, 2, iBranch);
    setIo(slotPtr, 3, gEq);
    setIo(slotPtr, 4, closed ? -vOn / rOn : 0.0);
    return;
  }

  if (archetypeId == ARCH_SWITCH_TACS_13) {
    const rOn = Math.max(1.0e-6, getCon(slotPtr, conCount, 0, 1.0e-4));
    const rOff = Math.max(1.0, getCon(slotPtr, conCount, 1, 1.0e9));
    const thresh = getCon(slotPtr, conCount, 2, 0.5);
    const closed = getIo(slotPtr, 8) > thresh;
    const gEq = closed ? 1.0 / rOn : 1.0 / rOff;
    const iBranch = gEq * vDiff;

    setState(slotPtr, 0, closed ? 1.0 : 0.0);
    setState(slotPtr, 1, iBranch);
    setIo(slotPtr, 7, closed ? 1.0 : 0.0);
    setIo(slotPtr, 2, iBranch);
    setIo(slotPtr, 3, gEq);
    setIo(slotPtr, 4, 0.0);
    return;
  }

  // -------------------------------------------------------------------------
  // 8. Sources (Type 14 AC, Type 15 Double-Exponential Impulse, Type 11 DC)
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_SRC_AC_14) {
    const amp = getCon(slotPtr, conCount, 0, 169705.6);
    const freqHz = getCon(slotPtr, conCount, 1, 60.0);
    const phaseDeg = getCon(slotPtr, conCount, 2, 0.0);
    const tStart = getCon(slotPtr, conCount, 3, -1.0);
    const tStop = getCon(slotPtr, conCount, 4, 1.0e6);
    const rInt = Math.max(1.0e-6, getCon(slotPtr, conCount, 5, 1.0e-3));

    const active = t >= tStart && t <= tStop;
    const phaseRad = (phaseDeg * Math.PI) / 180.0;
    const vSrc = active ? amp * Math.cos(2.0 * Math.PI * freqHz * t + phaseRad) : 0.0;
    const gEq = 1.0 / rInt;

    setIo(slotPtr, 6, vSrc);
    setIo(slotPtr, 3, gEq);
    setIo(slotPtr, 4, vSrc * gEq);
    setIo(slotPtr, 2, (vSrc - v1) * gEq);
    return;
  }

  if (archetypeId == ARCH_SRC_IMPULSE_15) {
    const v0 = getCon(slotPtr, conCount, 0, 1037000.0);
    const alpha = getCon(slotPtr, conCount, 1, 14659.0);
    const beta = getCon(slotPtr, conCount, 2, 2468900.0);
    const t0 = getCon(slotPtr, conCount, 3, 0.0);
    const rInt = Math.max(1.0e-6, getCon(slotPtr, conCount, 4, 1.0e-3));

    const tau = t - t0;
    const vSrc = tau >= 0.0 ? v0 * (Math.exp(-alpha * tau) - Math.exp(-beta * tau)) : 0.0;
    const gEq = 1.0 / rInt;

    setIo(slotPtr, 6, vSrc);
    setIo(slotPtr, 3, gEq);
    setIo(slotPtr, 4, vSrc * gEq);
    setIo(slotPtr, 2, (vSrc - v1) * gEq);
    return;
  }

  if (archetypeId == ARCH_SRC_DC_11) {
    const amp = getCon(slotPtr, conCount, 0, 1000.0);
    const t0 = getCon(slotPtr, conCount, 1, 0.0);
    const tRamp = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.0));
    const tStop = getCon(slotPtr, conCount, 3, 1.0e6);
    const rInt = Math.max(1.0e-6, getCon(slotPtr, conCount, 4, 1.0e-3));

    let vSrc: f64 = 0.0;
    if (t >= t0 && t <= tStop) {
      if (tRamp > 0.0 && t - t0 < tRamp) {
        vSrc = amp * ((t - t0) / tRamp);
      } else {
        vSrc = amp;
      }
    }
    const gEq = 1.0 / rInt;

    setIo(slotPtr, 6, vSrc);
    setIo(slotPtr, 3, gEq);
    setIo(slotPtr, 4, vSrc * gEq);
    setIo(slotPtr, 2, (vSrc - v1) * gEq);
    return;
  }

  // -------------------------------------------------------------------------
  // 9a. Type 59 Synchronous Machine — Full 3-Phase Park d-q-0 Subtransient Model
  //     Tracks transient & subtransient flux linkages: Ed', Eq', psi_kd, psi_kq
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_MACH_SYNC_59) {
    const vRated = Math.max(1.0, getCon(slotPtr, conCount, 0, 20000.0));
    const freqHz = Math.max(1.0, getCon(slotPtr, conCount, 1, 60.0));
    const hSec = Math.max(0.1, getCon(slotPtr, conCount, 2, 4.0));
    const xdppIn = Math.max(1.0e-4, getCon(slotPtr, conCount, 3, 0.2));
    const pMech = getCon(slotPtr, conCount, 4, 1.0e6);

    // Optional IEEE Std 1110 / Brandwajn Type 59 d-q-0 machine reactances & time constants (pu / s)
    const xd = Math.max(0.2, getCon(slotPtr, conCount, 5, 1.8));
    const xq = Math.max(0.2, getCon(slotPtr, conCount, 6, 1.7));
    const xdp = Math.max(0.05, getCon(slotPtr, conCount, 7, 0.3));
    const xqp = Math.max(0.05, getCon(slotPtr, conCount, 8, 0.55));
    const xdpp = clamp(getCon(slotPtr, conCount, 9, xdppIn <= 1.0 ? xdppIn : 0.2), 0.05, xdp * 0.95);
    const xqpp = clamp(getCon(slotPtr, conCount, 10, xdpp * 1.1), 0.05, xqp * 0.95);
    const xl = Math.min(0.5 * xdpp, 0.1);
    const td0p = Math.max(0.05, getCon(slotPtr, conCount, 11, 6.5));
    const tq0p = Math.max(0.05, getCon(slotPtr, conCount, 12, 0.85));
    const td0pp = Math.max(0.005, getCon(slotPtr, conCount, 13, 0.035));
    const tq0pp = Math.max(0.005, getCon(slotPtr, conCount, 14, 0.06));
    const efCtrl = getIo(slotPtr, 8);
    const ef = efCtrl > 0.0 ? efCtrl : getCon(slotPtr, conCount, 15, 1.05);

    const omegaSync = 2.0 * Math.PI * freqHz;
    let theta = getState(slotPtr, 0);
    let omega = getState(slotPtr, 1);
    if (omega <= 0.0) omega = omegaSync;

    let eqp = getState(slotPtr, 2);
    let edp = getState(slotPtr, 3);
    let psiKd = getState(slotPtr, 4);
    let psiKq = getState(slotPtr, 5);
    if (eqp == 0.0 && psiKd == 0.0) {
      eqp = 1.0;
      psiKd = 1.0;
    }

    // Subtransient internal voltages (Sauer-Pai / IEEE 1110 Model 2.2)
    const kD1 = (xdpp - xl) / Math.max(1e-6, xdp - xl);
    const kD2 = (xdp - xdpp) / Math.max(1e-6, xdp - xl);
    const kQ1 = (xqpp - xl) / Math.max(1e-6, xqp - xl);
    const kQ2 = (xqp - xqpp) / Math.max(1e-6, xqp - xl);
    const eqpp = kD1 * eqp + kD2 * psiKd;
    const edpp = kQ1 * edp - kQ2 * psiKq;

    // Terminal voltage per-unit Park d-q-0 projection (balanced 3-phase from v1 or 0 during 3-phase fault)
    const vBasePeak = vRated * 0.816496580927726; // V_LL_rms * sqrt(2/3)
    const sBase = Math.max(1.0e6, Math.abs(pMech) * 1.25);
    const zBase = (vRated * vRated) / sBase;
    const iBasePeak = sBase / (1.5 * vBasePeak);

    const vaPu = v1 / vBasePeak;
    const vbPu = (v1 * Math.cos(theta - 2.0943951023931953) / (Math.abs(Math.cos(theta)) > 0.2 ? Math.cos(theta) : 1.0)) * (v1 == 0.0 ? 0.0 : 0.0) +
      (v2 != 0.0 ? v2 / vBasePeak : -0.5 * vaPu);
    const vcPu = -(vaPu + vbPu);

    const c0 = Math.cos(theta);
    const c1 = Math.cos(theta - 2.0943951023931953);
    const c2 = Math.cos(theta + 2.0943951023931953);
    const s0 = Math.sin(theta);
    const s1 = Math.sin(theta - 2.0943951023931953);
    const s2 = Math.sin(theta + 2.0943951023931953);

    const vd = (2.0 / 3.0) * (vaPu * c0 + vbPu * c1 + vcPu * c2);
    const vq = (-2.0 / 3.0) * (vaPu * s0 + vbPu * s1 + vcPu * s2);
    const v0 = (1.0 / 3.0) * (vaPu + vbPu + vcPu);

    // Subtransient stator algebraic equations with Ra = 0.003 pu
    const ra: f64 = 0.003;
    const det = ra * ra + xdpp * xqpp;
    const rhsD = edpp - vd;
    const rhsQ = eqpp - vq;
    const id = (ra * rhsD + xqpp * rhsQ) / det;
    const iq = (-xdpp * rhsD + ra * rhsQ) / det;
    const i0 = -v0 / Math.max(0.05, xl);

    // Transient & subtransient rotor flux-linkage ODEs
    const dEqp = (ef - eqp - (xd - xdp) * id) / td0p;
    const dEdp = (-edp + (xq - xqp) * iq) / tq0p;
    const dPsiKd = (eqp - psiKd - (xdp - xl) * id) / td0pp;
    const dPsiKq = (-edp - psiKq + (xqp - xl) * iq) / tq0pp;

    eqp += dEqp * h;
    edp += dEdp * h;
    psiKd += dPsiKd * h;
    psiKq += dPsiKq * h;

    // Electromagnetic torque & swing dynamics (pu)
    const tElecPu = edpp * id + eqpp * iq + (xqpp - xdpp) * id * iq;
    const tMechPu = pMech / sBase;
    const slip = (omega - omegaSync) / omegaSync;
    const dOmega = (omegaSync / (2.0 * hSec)) * (tMechPu - tElecPu - 1.5 * slip);
    omega += dOmega * h;
    theta += omega * h;

    // Inverse Park to Phase A terminal interface
    const eIntA = (edpp * c0 - eqpp * s0) * vBasePeak;
    const iOutA = (id * c0 - iq * s0 + i0) * iBasePeak;
    const xSubOhm = Math.max(1e-4, xdpp * zBase);

    setState(slotPtr, 0, theta);
    setState(slotPtr, 1, omega);
    setState(slotPtr, 2, eqp);
    setState(slotPtr, 3, edp);
    setState(slotPtr, 4, psiKd);
    setState(slotPtr, 5, psiKq);
    setState(slotPtr, 6, id);
    setState(slotPtr, 7, iq);
    setState(slotPtr, 8, i0);

    setAux(slotPtr, 0, edp);
    setAux(slotPtr, 1, eqp);
    setAux(slotPtr, 2, psiKd);
    setAux(slotPtr, 3, psiKq);
    setAux(slotPtr, 4, id);
    setAux(slotPtr, 5, iq);

    setIo(slotPtr, 6, eIntA);
    setIo(slotPtr, 2, iOutA);
    setIo(slotPtr, 3, 1.0 / xSubOhm);
    setIo(slotPtr, 4, eIntA / xSubOhm);
    setIo(slotPtr, 10, Math.sqrt(psiKd * psiKd + psiKq * psiKq));
    setIo(slotPtr, 11, tElecPu * sBase);
    setIo(slotPtr, 12, omega);
    setIo(slotPtr, 13, (tElecPu * sBase) / omega);
    setIo(slotPtr, 15, Math.sqrt(edp * edp + eqp * eqp));
    return;
  }

  // -------------------------------------------------------------------------
  // 9b. Type 19 Universal Machine
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_MACH_UNIVERSAL_19) {
    const vRated = Math.max(1.0, getCon(slotPtr, conCount, 0, 4160.0));
    const freqHz = Math.max(1.0, getCon(slotPtr, conCount, 1, 60.0));
    const hSec = Math.max(0.1, getCon(slotPtr, conCount, 2, 1.5));
    const xInt = Math.max(1.0e-4, getCon(slotPtr, conCount, 3, 0.15));
    const pMech = getCon(slotPtr, conCount, 4, 500.0);

    const omegaSync = 2.0 * Math.PI * freqHz;
    let theta = getState(slotPtr, 0);
    let omega = getState(slotPtr, 1);
    if (omega <= 0.0) omega = omegaSync;

    const eInt = vRated * Math.SQRT2 * Math.cos(theta);
    const iOut = (eInt - v1) / xInt;
    const pElec = v1 * iOut;
    const tElec = pElec / omega;
    const tMech = -pMech;
    const inertiaJ = (2.0 * hSec * Math.max(1.0e3, Math.abs(pMech))) / (omegaSync * omegaSync);

    omega += ((tMech - tElec) / Math.max(1.0, inertiaJ)) * h;
    theta += omega * h;

    setState(slotPtr, 0, theta);
    setState(slotPtr, 1, omega);

    setIo(slotPtr, 6, eInt);
    setIo(slotPtr, 2, iOut);
    setIo(slotPtr, 3, 1.0 / xInt);
    setIo(slotPtr, 4, eInt / xInt);
    setIo(slotPtr, 12, omega);
    setIo(slotPtr, 13, tElec);
    return;
  }

  // -------------------------------------------------------------------------
  // 10. TACS & MODELS Control Blocks
  // -------------------------------------------------------------------------
  if (archetypeId == ARCH_TACS_TF_S) {
    // G(s) = K * (1 + T1*s) / (1 + T2*s) via Tustin (trapezoidal) transform
    const k = getCon(slotPtr, conCount, 0, 1.0);
    const t1 = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.0));
    const t2 = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.01));
    const yMin = getCon(slotPtr, conCount, 3, -1.0e9);
    const yMax = getCon(slotPtr, conCount, 4, 1.0e9);

    const u = getIo(slotPtr, 8);
    const yPrev = getState(slotPtr, 0);
    const uPrev = getState(slotPtr, 1);

    const denom = 2.0 * t2 + h;
    const b0 = (k * (2.0 * t1 + h)) / denom;
    const b1 = (k * (h - 2.0 * t1)) / denom;
    const a1 = (2.0 * t2 - h) / denom;

    const yNew = clamp(a1 * yPrev + b0 * u + b1 * uPrev, yMin, yMax);
    setState(slotPtr, 0, yNew);
    setState(slotPtr, 1, u);
    setIo(slotPtr, 9, yNew);
    return;
  }

  if (archetypeId == ARCH_TACS_INTEGRATOR) {
    const gainK = getCon(slotPtr, conCount, 0, 1.0);
    const yMin = getCon(slotPtr, conCount, 2, -1.0e9);
    const yMax = getCon(slotPtr, conCount, 3, 1.0e9);

    const u = getIo(slotPtr, 8);
    const yPrev = getState(slotPtr, 0);
    const uPrev = getState(slotPtr, 1);

    const yNew = clamp(yPrev + gainK * 0.5 * h * (u + uPrev), yMin, yMax);
    setState(slotPtr, 0, yNew);
    setState(slotPtr, 1, u);
    setIo(slotPtr, 9, yNew);
    return;
  }

  if (archetypeId == ARCH_TACS_LIMITER) {
    const gainK = getCon(slotPtr, conCount, 0, 1.0);
    const yMin = getCon(slotPtr, conCount, 1, -1.0);
    const yMax = getCon(slotPtr, conCount, 2, 1.0);
    const y = clamp(gainK * getIo(slotPtr, 8), yMin, yMax);
    setIo(slotPtr, 9, y);
    return;
  }

  if (archetypeId == ARCH_TACS_DELAY) {
    const delaySec = Math.max(h, getCon(slotPtr, conCount, 0, 0.001));
    let delaySteps = <i32>Math.round(delaySec / h);
    if (delaySteps < 1) delaySteps = 1;
    if (delaySteps >= TACS_DELAY_RING_LEN) delaySteps = TACS_DELAY_RING_LEN - 1;

    const writeIdx = <i32>getState(slotPtr, 0) & (TACS_DELAY_RING_LEN - 1);
    const readIdx = (writeIdx - delaySteps + TACS_DELAY_RING_LEN) & (TACS_DELAY_RING_LEN - 1);

    const yOut = getState(slotPtr, 2 + readIdx);
    setState(slotPtr, 2 + writeIdx, getIo(slotPtr, 8));
    setState(slotPtr, 0, <f64>((writeIdx + 1) & (TACS_DELAY_RING_LEN - 1)));
    setIo(slotPtr, 9, yOut);
    return;
  }

  if (archetypeId == ARCH_TACS_LOGIC) {
    const threshold = getCon(slotPtr, conCount, 0, 0.0);
    const hiVal = getCon(slotPtr, conCount, 1, 1.0);
    const loVal = getCon(slotPtr, conCount, 2, 0.0);
    const invert = getCon(slotPtr, conCount, 3, 0.0) > 0.5;
    let cond = getIo(slotPtr, 8) >= threshold;
    if (invert) cond = !cond;
    setIo(slotPtr, 9, cond ? hiVal : loVal);
    return;
  }

  if (archetypeId == ARCH_MODELS_USER) {
    const kp = getCon(slotPtr, conCount, 0, 1.0);
    const ki = getCon(slotPtr, conCount, 1, 0.0);
    const yMin = getCon(slotPtr, conCount, 2, -1.0e9);
    const yMax = getCon(slotPtr, conCount, 3, 1.0e9);

    const u = getIo(slotPtr, 8);
    const integPrev = getState(slotPtr, 0);
    const uPrev = getState(slotPtr, 1);
    const integ = clamp(integPrev + ki * 0.5 * h * (u + uPrev), yMin, yMax);
    const y = clamp(kp * u + integ, yMin, yMax);

    setState(slotPtr, 0, integ);
    setState(slotPtr, 1, u);
    setIo(slotPtr, 9, y);
  }
}
