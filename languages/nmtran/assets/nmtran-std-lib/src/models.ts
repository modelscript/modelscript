// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript pharmacometric runtime for `@modelscript/nmtran-std-lib`.
 *
 * Implements closed-form analytical and numerical PK/PD formulations for NONMEM / PREDPP
 * subroutines (ADVAN1-ADVAN13, TRANS1-TRANS6, PRED_EMAX, PRED_INDIRECT_RESP, PRED_TMDD,
 * ERROR_PROP/ADD/COMB) using a zero-GC 2048-byte aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — PK/PD parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — compartment amounts / derived micro-rates
 *   - `0x680..0x77F` (256 B):  `DSTATE[32]` (`f64`) — compartment derivatives / aux
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — I/O bus:
 *       IO[0]  = time (h)
 *       IO[1]  = dose (mg)
 *       IO[2]  = rate (mg/h; 0 = IV/oral bolus, >0 = zero-order infusion)
 *       IO[3]  = conc (mg/L; central concentration C(t), or input C for PD models)
 *       IO[4]  = amountCentral (mg)
 *       IO[5]  = amountDepot (mg)
 *       IO[6]  = amountPeriph1 (mg)
 *       IO[7]  = amountPeriph2 (mg)
 *       IO[8]  = effect (PD response E(t) or R(t))
 *       IO[9]  = ipred (individual prediction F)
 *       IO[10] = dv (observed/simulated Y with residual error)
 *       IO[11] = eps1 (residual error draw 1)
 *       IO[12] = eps2 (residual error draw 2)
 *       IO[13] = dt (ODE step size for numerical ADVANs, default 0.01 h)
 *       IO[14] = aux0
 *       IO[15] = aux1
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_DSTATE: usize = 0x680;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `NmtranArchetypeId` in nmtran-std-schemas.ts)
const ARCH_ADVAN1: i32 = 1;
const ARCH_ADVAN2: i32 = 2;
const ARCH_ADVAN3: i32 = 3;
const ARCH_ADVAN4: i32 = 4;
const ARCH_ADVAN5: i32 = 5;
const ARCH_ADVAN6: i32 = 6;
const ARCH_ADVAN7: i32 = 7;
const ARCH_ADVAN8: i32 = 8;
const ARCH_ADVAN9: i32 = 9;
const ARCH_ADVAN10: i32 = 10;
const ARCH_ADVAN11: i32 = 11;
const ARCH_ADVAN12: i32 = 12;
const ARCH_ADVAN13: i32 = 13;

const ARCH_TRANS1: i32 = 21;
const ARCH_TRANS2: i32 = 22;
const ARCH_TRANS3: i32 = 23;
const ARCH_TRANS4: i32 = 24;
const ARCH_TRANS5: i32 = 25;
const ARCH_TRANS6: i32 = 26;

const ARCH_PRED_EMAX: i32 = 31;
const ARCH_PRED_INDIRECT_RESP: i32 = 32;
const ARCH_PRED_TMDD: i32 = 33;

const ARCH_ERROR_PROP: i32 = 41;
const ARCH_ERROR_ADD: i32 = 42;
const ARCH_ERROR_COMB: i32 = 43;

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
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function nmGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes compartment amounts / baseline states for a given NMTRAN archetype.
 * Returns the number of active state variables.
 */
export function nmModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  const dose = getIo(slotPtr, 1);
  const rate = getIo(slotPtr, 2);

  for (let i = 0; i < 8; i++) {
    setState(slotPtr, i, 0.0);
    setDState(slotPtr, i, 0.0);
  }

  if (archetypeId == ARCH_ADVAN1) {
    const v = Math.max(1e-9, getCon(slotPtr, conCount, 1, 50.0));
    const f1 = getCon(slotPtr, conCount, 2, 1.0);
    const a1 = rate > 0.0 ? 0.0 : f1 * dose;
    const c = a1 / v;
    setState(slotPtr, 0, a1);
    setIo(slotPtr, 3, c);
    setIo(slotPtr, 4, a1);
    setIo(slotPtr, 9, c);
    return 1;
  }

  if (archetypeId == ARCH_ADVAN2) {
    const f1 = getCon(slotPtr, conCount, 3, 1.0);
    const aDepot = f1 * dose;
    setState(slotPtr, 0, aDepot);
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 3, 0.0);
    setIo(slotPtr, 4, 0.0);
    setIo(slotPtr, 5, aDepot);
    setIo(slotPtr, 9, 0.0);
    return 2;
  }

  if (archetypeId == ARCH_ADVAN3) {
    const v1 = Math.max(1e-9, getCon(slotPtr, conCount, 1, 20.0));
    const f1 = getCon(slotPtr, conCount, 4, 1.0);
    const a1 = rate > 0.0 ? 0.0 : f1 * dose;
    const c = a1 / v1;
    setState(slotPtr, 0, a1);
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 3, c);
    setIo(slotPtr, 4, a1);
    setIo(slotPtr, 6, 0.0);
    setIo(slotPtr, 9, c);
    return 2;
  }

  if (archetypeId == ARCH_ADVAN4) {
    const f1 = getCon(slotPtr, conCount, 5, 1.0);
    const aDepot = f1 * dose;
    setState(slotPtr, 0, aDepot);
    setState(slotPtr, 1, 0.0);
    setState(slotPtr, 2, 0.0);
    setIo(slotPtr, 3, 0.0);
    setIo(slotPtr, 4, 0.0);
    setIo(slotPtr, 5, aDepot);
    setIo(slotPtr, 6, 0.0);
    setIo(slotPtr, 9, 0.0);
    return 3;
  }

  if (archetypeId == ARCH_ADVAN10) {
    const v = Math.max(1e-9, getCon(slotPtr, conCount, 2, 20.0));
    const f1 = getCon(slotPtr, conCount, 3, 1.0);
    const a1 = rate > 0.0 ? 0.0 : f1 * dose;
    const c = a1 / v;
    setState(slotPtr, 0, a1);
    setIo(slotPtr, 3, c);
    setIo(slotPtr, 4, a1);
    setIo(slotPtr, 9, c);
    return 1;
  }

  if (archetypeId == ARCH_ADVAN11) {
    const v1 = Math.max(1e-9, getCon(slotPtr, conCount, 1, 15.0));
    const f1 = getCon(slotPtr, conCount, 6, 1.0);
    const a1 = rate > 0.0 ? 0.0 : f1 * dose;
    const c = a1 / v1;
    setState(slotPtr, 0, a1);
    setState(slotPtr, 1, 0.0);
    setState(slotPtr, 2, 0.0);
    setIo(slotPtr, 3, c);
    setIo(slotPtr, 4, a1);
    setIo(slotPtr, 6, 0.0);
    setIo(slotPtr, 7, 0.0);
    setIo(slotPtr, 9, c);
    return 3;
  }

  if (archetypeId == ARCH_ADVAN12) {
    const f1 = getCon(slotPtr, conCount, 7, 1.0);
    const aDepot = f1 * dose;
    setState(slotPtr, 0, aDepot);
    setState(slotPtr, 1, 0.0);
    setState(slotPtr, 2, 0.0);
    setState(slotPtr, 3, 0.0);
    setIo(slotPtr, 3, 0.0);
    setIo(slotPtr, 4, 0.0);
    setIo(slotPtr, 5, aDepot);
    setIo(slotPtr, 6, 0.0);
    setIo(slotPtr, 7, 0.0);
    setIo(slotPtr, 9, 0.0);
    return 4;
  }

  if (archetypeId == ARCH_PRED_INDIRECT_RESP) {
    const kin = getCon(slotPtr, conCount, 0, 10.0);
    const kout = Math.max(1e-9, getCon(slotPtr, conCount, 1, 0.5));
    const r0 = kin / kout;
    setState(slotPtr, 0, r0);
    setIo(slotPtr, 8, r0);
    setIo(slotPtr, 9, r0);
    return 1;
  }

  if (archetypeId == ARCH_PRED_TMDD) {
    const v = Math.max(1e-9, getCon(slotPtr, conCount, 1, 3.0));
    const c0 = dose / v;
    setState(slotPtr, 0, dose);
    setIo(slotPtr, 3, c0);
    setIo(slotPtr, 4, dose);
    setIo(slotPtr, 9, c0);
    return 1;
  }

  if (archetypeId == ARCH_PRED_EMAX) {
    const e0 = getCon(slotPtr, conCount, 0, 0.0);
    setIo(slotPtr, 8, e0);
    setIo(slotPtr, 9, e0);
    return 0;
  }

  if (
    archetypeId == ARCH_ADVAN5 ||
    archetypeId == ARCH_ADVAN6 ||
    archetypeId == ARCH_ADVAN7 ||
    archetypeId == ARCH_ADVAN8 ||
    archetypeId == ARCH_ADVAN9 ||
    archetypeId == ARCH_ADVAN13
  ) {
    const v1 = Math.max(1e-9, getCon(slotPtr, conCount, 3, 20.0));
    setState(slotPtr, 0, dose);
    setState(slotPtr, 1, 0.0);
    setIo(slotPtr, 3, dose / v1);
    setIo(slotPtr, 4, dose);
    setIo(slotPtr, 9, dose / v1);
    return 2;
  }

  return 0;
}

/**
 * Solves a 3-compartment mammillary characteristic cubic:
 *   lambda^3 - a2 * lambda^2 + a1 * lambda - a0 = 0
 * via exact trigonometric Cardano roots (all 3 roots are real and positive).
 * Stores roots in STATE[4], STATE[5], STATE[6].
 */
function solve3CptCubic(
  slotPtr: usize,
  k10: f64,
  k12: f64,
  k21: f64,
  k13: f64,
  k31: f64,
): void {
  const a2 = k10 + k12 + k21 + k13 + k31;
  const a1 = k10 * (k21 + k31) + k21 * k31 + k12 * k31 + k13 * k21;
  const a0 = k10 * k21 * k31;

  const p = a1 - (a2 * a2) / 3.0;
  const q = (2.0 * a2 * a2 * a2) / 27.0 - (a2 * a1) / 3.0 + a0;
  const r = Math.sqrt(Math.max(1e-18, -p / 3.0));
  const cosArg = clamp(-q / (2.0 * r * r * r), -1.0, 1.0);
  const phi = Math.acos(cosArg);
  const shift = a2 / 3.0;
  const twoPi3: f64 = (2.0 * Math.PI) / 3.0;

  const l1 = shift + 2.0 * r * Math.cos(phi / 3.0);
  const l2 = shift + 2.0 * r * Math.cos(phi / 3.0 + twoPi3);
  const l3 = shift + 2.0 * r * Math.cos(phi / 3.0 + 2.0 * twoPi3);

  setState(slotPtr, 4, l1);
  setState(slotPtr, 5, l2);
  setState(slotPtr, 6, l3);
}

/**
 * Evaluates a cleanroom NONMEM / PREDPP archetype at time `t` (hours).
 * Returns the primary scalar output (concentration C(t) for ADVANs, effect E for PD,
 * Y for ERROR blocks, elimination rate K for TRANS translators).
 */
export function nmModelEval(
  archetypeId: i32,
  t: f64,
  slotPtr: usize,
  conCount: i32,
): f64 {
  const time = t >= 0.0 ? t : 0.0;
  const dose = getIo(slotPtr, 1);
  const rate = getIo(slotPtr, 2);
  setIo(slotPtr, 0, time);

  // === ADVAN1: 1-Compartment IV Bolus / Zero-Order Infusion ===
  if (archetypeId == ARCH_ADVAN1) {
    const cl = Math.max(0.0, getCon(slotPtr, conCount, 0, 5.0));
    const v = Math.max(1e-9, getCon(slotPtr, conCount, 1, 50.0));
    const f1 = getCon(slotPtr, conCount, 2, 1.0);
    const k = cl / v;

    let a1: f64;
    if (rate > 0.0 && dose > 0.0) {
      const tInf = dose / rate;
      if (k > 1e-12) {
        if (time <= tInf) {
          a1 = ((f1 * rate) / k) * (1.0 - Math.exp(-k * time));
        } else {
          a1 = ((f1 * rate) / k) * (1.0 - Math.exp(-k * tInf)) * Math.exp(-k * (time - tInf));
        }
      } else {
        a1 = f1 * rate * Math.min(time, tInf);
      }
    } else {
      a1 = f1 * dose * Math.exp(-k * time);
    }

    const c = a1 / v;
    setState(slotPtr, 0, a1);
    setDState(slotPtr, 0, -k * a1);
    setIo(slotPtr, 3, c);
    setIo(slotPtr, 4, a1);
    setIo(slotPtr, 9, c);
    return c;
  }

  // === ADVAN2: 1-Compartment First-Order Oral Absorption (Bateman Equation) ===
  if (archetypeId == ARCH_ADVAN2) {
    const cl = Math.max(0.0, getCon(slotPtr, conCount, 0, 5.0));
    const v = Math.max(1e-9, getCon(slotPtr, conCount, 1, 50.0));
    const ka = Math.max(1e-9, getCon(slotPtr, conCount, 2, 1.2));
    const f1 = getCon(slotPtr, conCount, 3, 1.0);
    const alag = Math.max(0.0, getCon(slotPtr, conCount, 4, 0.0));

    const k = cl / v;
    const te = time - alag;
    if (te <= 0.0) {
      const aDep = f1 * dose;
      setState(slotPtr, 0, aDep);
      setState(slotPtr, 1, 0.0);
      setIo(slotPtr, 3, 0.0);
      setIo(slotPtr, 4, 0.0);
      setIo(slotPtr, 5, aDep);
      setIo(slotPtr, 9, 0.0);
      return 0.0;
    }

    const aDepot = f1 * dose * Math.exp(-ka * te);
    let aCentral: f64;
    if (Math.abs(ka - k) > 1e-9) {
      aCentral = ((f1 * dose * ka) / (ka - k)) * (Math.exp(-k * te) - Math.exp(-ka * te));
    } else {
      aCentral = f1 * dose * k * te * Math.exp(-k * te);
    }
    const c = aCentral / v;

    setState(slotPtr, 0, aDepot);
    setState(slotPtr, 1, aCentral);
    setDState(slotPtr, 0, -ka * aDepot);
    setDState(slotPtr, 1, ka * aDepot - k * aCentral);
    setIo(slotPtr, 3, c);
    setIo(slotPtr, 4, aCentral);
    setIo(slotPtr, 5, aDepot);
    setIo(slotPtr, 9, c);
    return c;
  }

  // === ADVAN3: 2-Compartment IV Biexponential ===
  if (archetypeId == ARCH_ADVAN3) {
    const cl = Math.max(0.0, getCon(slotPtr, conCount, 0, 5.0));
    const v1 = Math.max(1e-9, getCon(slotPtr, conCount, 1, 20.0));
    const q = Math.max(0.0, getCon(slotPtr, conCount, 2, 10.0));
    const v2 = Math.max(1e-9, getCon(slotPtr, conCount, 3, 40.0));
    const f1 = getCon(slotPtr, conCount, 4, 1.0);

    const k10 = cl / v1;
    const k12 = q / v1;
    const k21 = q / v2;

    const sum = k10 + k12 + k21;
    const prod = k10 * k21;
    const disc = Math.sqrt(Math.max(0.0, sum * sum - 4.0 * prod));
    const alpha = 0.5 * (sum + disc);
    const beta = 0.5 * (sum - disc);
    const diff = Math.max(1e-12, alpha - beta);

    const eAlpha = Math.exp(-alpha * time);
    const eBeta = Math.exp(-beta * time);

    const coefA = (alpha - k21) / diff;
    const coefB = (k21 - beta) / diff;

    const a1 = f1 * dose * (coefA * eAlpha + coefB * eBeta);
    const a2 = f1 * dose * (k12 / diff) * (eBeta - eAlpha);
    const c = a1 / v1;

    setState(slotPtr, 0, a1);
    setState(slotPtr, 1, a2);
    setIo(slotPtr, 3, c);
    setIo(slotPtr, 4, a1);
    setIo(slotPtr, 6, a2);
    setIo(slotPtr, 9, c);
    return c;
  }

  // === ADVAN4: 2-Compartment First-Order Oral (Triexponential) ===
  if (archetypeId == ARCH_ADVAN4) {
    const cl = Math.max(0.0, getCon(slotPtr, conCount, 0, 5.0));
    const v2 = Math.max(1e-9, getCon(slotPtr, conCount, 1, 20.0));
    const q = Math.max(0.0, getCon(slotPtr, conCount, 2, 10.0));
    const v3 = Math.max(1e-9, getCon(slotPtr, conCount, 3, 40.0));
    const ka = Math.max(1e-9, getCon(slotPtr, conCount, 4, 1.2));
    const f1 = getCon(slotPtr, conCount, 5, 1.0);
    const alag = Math.max(0.0, getCon(slotPtr, conCount, 6, 0.0));

    const te = time - alag;
    if (te <= 0.0) {
      const aDep = f1 * dose;
      setState(slotPtr, 0, aDep);
      setState(slotPtr, 1, 0.0);
      setState(slotPtr, 2, 0.0);
      setIo(slotPtr, 3, 0.0);
      setIo(slotPtr, 4, 0.0);
      setIo(slotPtr, 5, aDep);
      setIo(slotPtr, 6, 0.0);
      setIo(slotPtr, 9, 0.0);
      return 0.0;
    }

    const k20 = cl / v2;
    const k23 = q / v2;
    const k32 = q / v3;

    const sum = k20 + k23 + k32;
    const prod = k20 * k32;
    const disc = Math.sqrt(Math.max(0.0, sum * sum - 4.0 * prod));
    const alpha = 0.5 * (sum + disc);
    const beta = 0.5 * (sum - disc);

    const eAlpha = Math.exp(-alpha * te);
    const eBeta = Math.exp(-beta * te);
    const eKa = Math.exp(-ka * te);

    const dAlpha = (ka - alpha) * (beta - alpha);
    const dBeta = (ka - beta) * (alpha - beta);
    const dKa = (alpha - ka) * (beta - ka);

    const aDepot = f1 * dose * eKa;
    let aCentral: f64 = 0.0;
    let aPeriph: f64 = 0.0;
    if (Math.abs(dAlpha) > 1e-12 && Math.abs(dBeta) > 1e-12 && Math.abs(dKa) > 1e-12) {
      aCentral =
        f1 *
        dose *
        ka *
        (((k32 - alpha) / dAlpha) * eAlpha +
          ((k32 - beta) / dBeta) * eBeta +
          ((k32 - ka) / dKa) * eKa);
      aPeriph =
        f1 *
        dose *
        ka *
        k23 *
        (eAlpha / dAlpha + eBeta / dBeta + eKa / dKa);
    }
    const c = aCentral / v2;

    setState(slotPtr, 0, aDepot);
    setState(slotPtr, 1, aCentral);
    setState(slotPtr, 2, aPeriph);
    setIo(slotPtr, 3, c);
    setIo(slotPtr, 4, aCentral);
    setIo(slotPtr, 5, aDepot);
    setIo(slotPtr, 6, aPeriph);
    setIo(slotPtr, 9, c);
    return c;
  }

  // === ADVAN10: 1-Compartment Michaelis-Menten Saturable Elimination (Heun RK2) ===
  if (archetypeId == ARCH_ADVAN10) {
    const vm = Math.max(0.0, getCon(slotPtr, conCount, 0, 50.0));
    const km = Math.max(1e-9, getCon(slotPtr, conCount, 1, 10.0));
    const v = Math.max(1e-9, getCon(slotPtr, conCount, 2, 20.0));
    const f1 = getCon(slotPtr, conCount, 3, 1.0);

    const kmV = km * v;
    const isInf = rate > 0.0 && dose > 0.0;
    const tInf = isInf ? dose / rate : 0.0;
    let a = isInf ? 0.0 : f1 * dose;

    if (time > 0.0) {
      const dtReq = getIo(slotPtr, 13);
      const hMax = dtReq > 1e-6 && dtReq < 0.1 ? dtReq : 0.01;
      const steps = <i32>Math.ceil(time / hMax);
      const h = time / <f64>steps;

      for (let i = 0; i < steps; i++) {
        const t0 = <f64>i * h;
        const t1 = t0 + h;
        const rin0 = isInf && t0 < tInf ? f1 * rate : 0.0;
        const rin1 = isInf && t1 < tInf ? f1 * rate : 0.0;

        const aPos0 = a > 0.0 ? a : 0.0;
        const k1 = rin0 - (vm * aPos0) / (kmV + aPos0);
        const aPred = aPos0 + h * k1;
        const aPos1 = aPred > 0.0 ? aPred : 0.0;
        const k2 = rin1 - (vm * aPos1) / (kmV + aPos1);
        a = aPos0 + 0.5 * h * (k1 + k2);
        if (a < 0.0) a = 0.0;
      }
    }

    const c = a / v;
    setState(slotPtr, 0, a);
    setDState(slotPtr, 0, -(vm * a) / (kmV + a));
    setIo(slotPtr, 3, c);
    setIo(slotPtr, 4, a);
    setIo(slotPtr, 9, c);
    return c;
  }

  // === ADVAN11: 3-Compartment Linear IV (Triexponential) ===
  if (archetypeId == ARCH_ADVAN11) {
    const cl = Math.max(0.0, getCon(slotPtr, conCount, 0, 5.0));
    const v1 = Math.max(1e-9, getCon(slotPtr, conCount, 1, 15.0));
    const q2 = Math.max(0.0, getCon(slotPtr, conCount, 2, 10.0));
    const v2 = Math.max(1e-9, getCon(slotPtr, conCount, 3, 30.0));
    const q3 = Math.max(0.0, getCon(slotPtr, conCount, 4, 2.0));
    const v3 = Math.max(1e-9, getCon(slotPtr, conCount, 5, 80.0));
    const f1 = getCon(slotPtr, conCount, 6, 1.0);

    const k10 = cl / v1;
    const k12 = q2 / v1;
    const k21 = q2 / v2;
    const k13 = q3 / v1;
    const k31 = q3 / v3;

    solve3CptCubic(slotPtr, k10, k12, k21, k13, k31);
    const l1 = load<f64>(slotPtr + OFF_STATE + (4 << 3));
    const l2 = load<f64>(slotPtr + OFF_STATE + (5 << 3));
    const l3 = load<f64>(slotPtr + OFF_STATE + (6 << 3));

    const d1 = (l2 - l1) * (l3 - l1);
    const d2 = (l1 - l2) * (l3 - l2);
    const d3 = (l1 - l3) * (l2 - l3);

    const e1 = Math.exp(-l1 * time);
    const e2 = Math.exp(-l2 * time);
    const e3 = Math.exp(-l3 * time);

    const c1 = ((k21 - l1) * (k31 - l1)) / d1;
    const c2 = ((k21 - l2) * (k31 - l2)) / d2;
    const c3 = ((k21 - l3) * (k31 - l3)) / d3;

    const a1 = f1 * dose * (c1 * e1 + c2 * e2 + c3 * e3);
    const a2 = f1 * dose * k12 * (((k31 - l1) / d1) * e1 + ((k31 - l2) / d2) * e2 + ((k31 - l3) / d3) * e3);
    const a3 = f1 * dose * k13 * (((k21 - l1) / d1) * e1 + ((k21 - l2) / d2) * e2 + ((k21 - l3) / d3) * e3);
    const c = a1 / v1;

    setState(slotPtr, 0, a1);
    setState(slotPtr, 1, a2);
    setState(slotPtr, 2, a3);
    setIo(slotPtr, 3, c);
    setIo(slotPtr, 4, a1);
    setIo(slotPtr, 6, a2);
    setIo(slotPtr, 7, a3);
    setIo(slotPtr, 9, c);
    return c;
  }

  // === ADVAN12: 3-Compartment First-Order Oral (Tetraexponential) ===
  if (archetypeId == ARCH_ADVAN12) {
    const cl = Math.max(0.0, getCon(slotPtr, conCount, 0, 5.0));
    const v2 = Math.max(1e-9, getCon(slotPtr, conCount, 1, 15.0));
    const q3 = Math.max(0.0, getCon(slotPtr, conCount, 2, 10.0));
    const v3 = Math.max(1e-9, getCon(slotPtr, conCount, 3, 30.0));
    const q4 = Math.max(0.0, getCon(slotPtr, conCount, 4, 2.0));
    const v4 = Math.max(1e-9, getCon(slotPtr, conCount, 5, 80.0));
    const ka = Math.max(1e-9, getCon(slotPtr, conCount, 6, 1.2));
    const f1 = getCon(slotPtr, conCount, 7, 1.0);
    const alag = Math.max(0.0, getCon(slotPtr, conCount, 8, 0.0));

    const te = time - alag;
    if (te <= 0.0) {
      const aDep = f1 * dose;
      setState(slotPtr, 0, aDep);
      setState(slotPtr, 1, 0.0);
      setState(slotPtr, 2, 0.0);
      setState(slotPtr, 3, 0.0);
      setIo(slotPtr, 3, 0.0);
      setIo(slotPtr, 4, 0.0);
      setIo(slotPtr, 5, aDep);
      setIo(slotPtr, 9, 0.0);
      return 0.0;
    }

    const k20 = cl / v2;
    const k23 = q3 / v2;
    const k32 = q3 / v3;
    const k24 = q4 / v2;
    const k42 = q4 / v4;

    solve3CptCubic(slotPtr, k20, k23, k32, k24, k42);
    const l1 = load<f64>(slotPtr + OFF_STATE + (4 << 3));
    const l2 = load<f64>(slotPtr + OFF_STATE + (5 << 3));
    const l3 = load<f64>(slotPtr + OFF_STATE + (6 << 3));

    const e1 = Math.exp(-l1 * te);
    const e2 = Math.exp(-l2 * te);
    const e3 = Math.exp(-l3 * te);
    const eKa = Math.exp(-ka * te);

    const d1 = (ka - l1) * (l2 - l1) * (l3 - l1);
    const d2 = (ka - l2) * (l1 - l2) * (l3 - l2);
    const d3 = (ka - l3) * (l1 - l3) * (l2 - l3);
    const dKa = (l1 - ka) * (l2 - ka) * (l3 - ka);

    const aDepot = f1 * dose * eKa;
    const aCentral =
      f1 *
      dose *
      ka *
      ((((k32 - l1) * (k42 - l1)) / d1) * e1 +
        (((k32 - l2) * (k42 - l2)) / d2) * e2 +
        (((k32 - l3) * (k42 - l3)) / d3) * e3 +
        (((k32 - ka) * (k42 - ka)) / dKa) * eKa);
    const c = aCentral / v2;

    setState(slotPtr, 0, aDepot);
    setState(slotPtr, 1, aCentral);
    setIo(slotPtr, 3, c);
    setIo(slotPtr, 4, aCentral);
    setIo(slotPtr, 5, aDepot);
    setIo(slotPtr, 9, c);
    return c;
  }

  // === General Linear / Nonlinear ODE ADVANs (ADVAN5-9, ADVAN13) ===
  if (
    archetypeId == ARCH_ADVAN5 ||
    archetypeId == ARCH_ADVAN6 ||
    archetypeId == ARCH_ADVAN7 ||
    archetypeId == ARCH_ADVAN8 ||
    archetypeId == ARCH_ADVAN9 ||
    archetypeId == ARCH_ADVAN13
  ) {
    const k10 = Math.max(0.0, getCon(slotPtr, conCount, 0, 0.1));
    const k12 = Math.max(0.0, getCon(slotPtr, conCount, 1, 0.5));
    const k21 = Math.max(0.0, getCon(slotPtr, conCount, 2, 0.25));
    const v1 = Math.max(1e-9, getCon(slotPtr, conCount, 3, 20.0));

    let a1 = dose;
    let a2: f64 = 0.0;
    if (time > 0.0) {
      const steps = <i32>Math.ceil(time / 0.01);
      const h = time / <f64>steps;
      for (let i = 0; i < steps; i++) {
        const da1 = -(k10 + k12) * a1 + k21 * a2;
        const da2 = k12 * a1 - k21 * a2;
        const p1 = a1 + h * da1;
        const p2 = a2 + h * da2;
        const da1p = -(k10 + k12) * p1 + k21 * p2;
        const da2p = k12 * p1 - k21 * p2;
        a1 += 0.5 * h * (da1 + da1p);
        a2 += 0.5 * h * (da2 + da2p);
      }
    }
    const c = a1 / v1;
    setState(slotPtr, 0, a1);
    setState(slotPtr, 1, a2);
    setIo(slotPtr, 3, c);
    setIo(slotPtr, 4, a1);
    setIo(slotPtr, 6, a2);
    setIo(slotPtr, 9, c);
    return c;
  }

  // === Parameterization Translators (TRANS1-TRANS6) ===
  if (archetypeId == ARCH_TRANS1) {
    const k = getCon(slotPtr, conCount, 0, 0.1);
    const k12 = getCon(slotPtr, conCount, 1, 0.5);
    const k21 = getCon(slotPtr, conCount, 2, 0.25);
    setState(slotPtr, 0, k);
    setState(slotPtr, 1, k12);
    setState(slotPtr, 2, k21);
    setIo(slotPtr, 15, k);
    return k;
  }

  if (archetypeId == ARCH_TRANS2) {
    const cl = getCon(slotPtr, conCount, 0, 5.0);
    const v = Math.max(1e-9, getCon(slotPtr, conCount, 1, 50.0));
    const k = cl / v;
    setState(slotPtr, 0, k);
    setIo(slotPtr, 15, k);
    return k;
  }

  if (archetypeId == ARCH_TRANS3) {
    const cl = getCon(slotPtr, conCount, 0, 5.0);
    const v = Math.max(1e-9, getCon(slotPtr, conCount, 1, 20.0));
    const q = getCon(slotPtr, conCount, 2, 10.0);
    const vss = Math.max(v + 1e-9, getCon(slotPtr, conCount, 3, 60.0));
    const k = cl / v;
    const k12 = q / v;
    const k21 = q / (vss - v);
    setState(slotPtr, 0, k);
    setState(slotPtr, 1, k12);
    setState(slotPtr, 2, k21);
    setIo(slotPtr, 15, k);
    return k;
  }

  if (archetypeId == ARCH_TRANS4) {
    const cl = getCon(slotPtr, conCount, 0, 5.0);
    const v1 = Math.max(1e-9, getCon(slotPtr, conCount, 1, 20.0));
    const q = getCon(slotPtr, conCount, 2, 10.0);
    const v2 = Math.max(1e-9, getCon(slotPtr, conCount, 3, 40.0));
    const k = cl / v1;
    const k12 = q / v1;
    const k21 = q / v2;
    setState(slotPtr, 0, k);
    setState(slotPtr, 1, k12);
    setState(slotPtr, 2, k21);
    setIo(slotPtr, 15, k);
    return k;
  }

  if (archetypeId == ARCH_TRANS5) {
    const aob = Math.max(1e-9, getCon(slotPtr, conCount, 0, 1.5));
    const alpha = getCon(slotPtr, conCount, 1, 0.8);
    const beta = getCon(slotPtr, conCount, 2, 0.08);
    const k21 = (aob * beta + alpha) / (aob + 1.0);
    const k = (alpha * beta) / Math.max(1e-9, k21);
    const k12 = alpha + beta - k21 - k;
    setState(slotPtr, 0, k);
    setState(slotPtr, 1, k12);
    setState(slotPtr, 2, k21);
    setIo(slotPtr, 15, k);
    return k;
  }

  if (archetypeId == ARCH_TRANS6) {
    const alpha = getCon(slotPtr, conCount, 0, 0.8);
    const beta = getCon(slotPtr, conCount, 1, 0.08);
    const k21 = Math.max(1e-9, getCon(slotPtr, conCount, 2, 0.25));
    const k = (alpha * beta) / k21;
    const k12 = alpha + beta - k21 - k;
    setState(slotPtr, 0, k);
    setState(slotPtr, 1, k12);
    setState(slotPtr, 2, k21);
    setIo(slotPtr, 15, k);
    return k;
  }

  // === PRED_EMAX: Direct Hill / Sigmoidal Emax PD Model ===
  if (archetypeId == ARCH_PRED_EMAX) {
    const e0 = getCon(slotPtr, conCount, 0, 0.0);
    const emax = getCon(slotPtr, conCount, 1, 100.0);
    const ec50 = Math.max(1e-12, getCon(slotPtr, conCount, 2, 10.0));
    const gamma = Math.max(1e-6, getCon(slotPtr, conCount, 3, 1.0));
    const conc = Math.max(0.0, getIo(slotPtr, 3));

    let effect = e0;
    if (conc > 0.0) {
      const cPow = Math.pow(conc, gamma);
      const ecPow = Math.pow(ec50, gamma);
      effect = e0 + (emax * cPow) / (ecPow + cPow);
    }
    setIo(slotPtr, 8, effect);
    setIo(slotPtr, 9, effect);
    return effect;
  }

  // === PRED_INDIRECT_RESP: Indirect Response Turnover Model (Type I Inhibition of Kin) ===
  if (archetypeId == ARCH_PRED_INDIRECT_RESP) {
    const kin = getCon(slotPtr, conCount, 0, 10.0);
    const kout = Math.max(1e-9, getCon(slotPtr, conCount, 1, 0.5));
    const imax = clamp(getCon(slotPtr, conCount, 2, 0.9), 0.0, 1.0);
    const ic50 = Math.max(1e-12, getCon(slotPtr, conCount, 3, 10.0));
    const gamma = Math.max(1e-6, getCon(slotPtr, conCount, 4, 1.0));
    const conc = Math.max(0.0, getIo(slotPtr, 3));

    const r0 = kin / kout;
    let inhib: f64 = 0.0;
    if (conc > 0.0) {
      const cPow = Math.pow(conc, gamma);
      const icPow = Math.pow(ic50, gamma);
      inhib = (imax * cPow) / (icPow + cPow);
    }
    const rSs = (kin * (1.0 - inhib)) / kout;
    const r = rSs + (r0 - rSs) * Math.exp(-kout * time);
    setState(slotPtr, 0, r);
    setIo(slotPtr, 8, r);
    setIo(slotPtr, 9, r);
    return r;
  }

  // === PRED_TMDD: Target-Mediated Drug Disposition (QSS Heun RK2) ===
  if (archetypeId == ARCH_PRED_TMDD) {
    const cl = Math.max(0.0, getCon(slotPtr, conCount, 0, 0.3));
    const v = Math.max(1e-9, getCon(slotPtr, conCount, 1, 3.0));
    const r0 = Math.max(0.0, getCon(slotPtr, conCount, 2, 10.0));
    const kint = Math.max(0.0, getCon(slotPtr, conCount, 3, 0.1));
    const kss = Math.max(1e-9, getCon(slotPtr, conCount, 4, 1.0));

    const kel = cl / v;
    let c = dose / v;
    if (time > 0.0) {
      const steps = <i32>Math.ceil(time / 0.01);
      const h = time / <f64>steps;
      for (let i = 0; i < steps; i++) {
        const c0 = c > 0.0 ? c : 0.0;
        const k1 = -kel * c0 - (kint * r0 * c0) / (kss + c0);
        const cPred = c0 + h * k1;
        const c1 = cPred > 0.0 ? cPred : 0.0;
        const k2 = -kel * c1 - (kint * r0 * c1) / (kss + c1);
        c = c0 + 0.5 * h * (k1 + k2);
        if (c < 0.0) c = 0.0;
      }
    }
    setState(slotPtr, 0, c * v);
    setIo(slotPtr, 3, c);
    setIo(slotPtr, 4, c * v);
    setIo(slotPtr, 9, c);
    return c;
  }

  // === Residual Error Models (ERROR_PROP, ERROR_ADD, ERROR_COMB) ===
  if (archetypeId == ARCH_ERROR_PROP) {
    const f = getIo(slotPtr, 9) != 0.0 ? getIo(slotPtr, 9) : getIo(slotPtr, 3);
    const eps1 = getIo(slotPtr, 11);
    const y = f * (1.0 + eps1);
    setIo(slotPtr, 10, y);
    return y;
  }

  if (archetypeId == ARCH_ERROR_ADD) {
    const f = getIo(slotPtr, 9) != 0.0 ? getIo(slotPtr, 9) : getIo(slotPtr, 3);
    const eps1 = getIo(slotPtr, 11);
    const y = f + eps1;
    setIo(slotPtr, 10, y);
    return y;
  }

  if (archetypeId == ARCH_ERROR_COMB) {
    const f = getIo(slotPtr, 9) != 0.0 ? getIo(slotPtr, 9) : getIo(slotPtr, 3);
    const eps1 = getIo(slotPtr, 11);
    const eps2 = getIo(slotPtr, 12);
    const y = f * (1.0 + eps1) + eps2;
    setIo(slotPtr, 10, y);
    return y;
  }

  return 0.0;
}
