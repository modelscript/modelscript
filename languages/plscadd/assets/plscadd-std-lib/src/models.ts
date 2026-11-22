// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript structural & thermal-mechanical runtime for `@modelscript/plscadd-std-lib`.
 *
 * Implements standardized transmission line physics (exact hyperbolic catenary sag/arc length,
 * ruling-span thermal-elastic state-change equation, NESC C2 / IEC 60826 resultant unit loads,
 * and IEEE Std 738 steady-state ampacity / conductor temperature) using a zero-GC 2048-byte
 * aligned slot ABI:
 *   - `0x000..0x07F` (128 B):  `META[32]`   (`i32`)
 *   - `0x080..0x57F` (1280 B): `CON[160]`   (`f64`) — component parameter vector
 *   - `0x580..0x67F` (256 B):  `STATE[32]`  (`f64`) — reference state vector
 *   - `0x680..0x77F` (256 B):  `WORK[32]`   (`f64`) — scratch workspace
 *   - `0x780..0x7FF` (128 B):  `IO[16]`     (`f64`) — input/output bus:
 *       Inputs:
 *         IO[0] = spanM (m)
 *         IO[1] = horizontalTensionN (N)
 *         IO[2] = unitWeightNPerM (N/m) — conductor applied weight or bare weight for load case
 *         IO[3] = conductorDiamM (m)
 *         IO[4] = ambientTempC (degC)
 *         IO[5] = operatingCurrentA (A)
 *         IO[6] = windSpeedMs (m/s) — IEEE 738 convection wind or insulator wind load
 *         IO[7] = lineAngleDeg (deg)
 *       Outputs:
 *         IO[8]  = sagM (m) [or momentKnM / swingDeg / wIce]
 *         IO[9]  = arcLengthM (m) [or verticalUnitLoadNPerM]
 *         IO[10] = maxTensionN (N) [or horizontalWindUnitLoadNPerM / forceN]
 *         IO[11] = resultantUnitWeightNPerM (N/m)
 *         IO[12] = stateChangeTensionN (N) [or iceUnitWeightNPerM]
 *         IO[13] = ampacityA (A) [or factoredResultantUnitWeightNPerM]
 *         IO[14] = conductorTempC (degC) [or designTempC]
 *         IO[15] = utilizationRatio (-)
 */

const OFF_CON: usize = 0x080;
const OFF_STATE: usize = 0x580;
const OFF_IO: usize = 0x780;

// Archetype IDs (must match `PlsCaddArchetypeId` in plscadd-std-schemas.ts)
const ARCH_CONDUCTOR_ACSR: i32 = 1;
const ARCH_CONDUCTOR_AAAC: i32 = 2;
const ARCH_CONDUCTOR_ACSS: i32 = 3;
const ARCH_CONDUCTOR_OPGW: i32 = 4;
const ARCH_STRUCTURE_LATTICE: i32 = 10;
const ARCH_STRUCTURE_TUBULAR: i32 = 11;
const ARCH_STRUCTURE_HFRAME: i32 = 12;
const ARCH_INSULATOR_SUSPENSION: i32 = 20;
const ARCH_INSULATOR_DEADEND: i32 = 21;
const ARCH_INSULATOR_VSTRING: i32 = 22;
const ARCH_LOAD_NESC: i32 = 30;
const ARCH_LOAD_IEC: i32 = 31;

const GRAVITY: f64 = 9.80665;
const AIR_DENSITY_STD: f64 = 1.225;

@inline
function cosh(x: f64): f64 {
  const e = Math.exp(x);
  return 0.5 * (e + 1.0 / e);
}

@inline
function sinh(x: f64): f64 {
  const e = Math.exp(x);
  return 0.5 * (e - 1.0 / e);
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
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

@inline
function isConductor(archetypeId: i32): bool {
  return (
    archetypeId == ARCH_CONDUCTOR_ACSR ||
    archetypeId == ARCH_CONDUCTOR_AAAC ||
    archetypeId == ARCH_CONDUCTOR_ACSS ||
    archetypeId == ARCH_CONDUCTOR_OPGW
  );
}

@inline
function isStructure(archetypeId: i32): bool {
  return (
    archetypeId == ARCH_STRUCTURE_LATTICE ||
    archetypeId == ARCH_STRUCTURE_TUBULAR ||
    archetypeId == ARCH_STRUCTURE_HFRAME
  );
}

@inline
function isInsulator(archetypeId: i32): bool {
  return (
    archetypeId == ARCH_INSULATOR_SUSPENSION ||
    archetypeId == ARCH_INSULATOR_DEADEND ||
    archetypeId == ARCH_INSULATOR_VSTRING
  );
}

/**
 * Evaluates a 4th-order PLS-CADD `.wir` stress-strain polynomial:
 *   sigma(eps) = a0 + a1*eps + a2*eps^2 + a3*eps^3 + a4*eps^4  (Pa)
 */
export function plsEvalStressStrainPoly(
  eps: f64,
  a0: f64,
  a1: f64,
  a2: f64,
  a3: f64,
  a4: f64,
): f64 {
  return a0 + eps * (a1 + eps * (a2 + eps * (a3 + eps * a4)));
}

/**
 * Inverts the 4th-order stress-strain polynomial `sigma(eps) = targetSigma` for strain `eps`
 * via safeguarded Newton-Raphson.
 */
function invertStressStrainPoly(
  targetSigmaPa: f64,
  a0: f64,
  a1: f64,
  a2: f64,
  a3: f64,
  a4: f64,
): f64 {
  const eNom = Math.max(1e9, a1);
  let eps = Math.max(0.0, (targetSigmaPa - a0) / eNom);
  for (let iter = 0; iter < 30; iter++) {
    const f = plsEvalStressStrainPoly(eps, a0, a1, a2, a3, a4) - targetSigmaPa;
    const df = Math.max(
      0.1 * eNom,
      a1 + eps * (2.0 * a2 + eps * (3.0 * a3 + eps * 4.0 * a4)),
    );
    const step = f / df;
    eps -= step;
    if (eps < 0.0) eps = 0.0;
    if (eps > 0.05) eps = 0.05;
    if (Math.abs(step) <= 1e-12) break;
  }
  return eps;
}

/**
 * Solves ruling-span sag-tension state-change using 4th-order stress-strain & creep polynomials:
 *   w2^2*S^2/(24*H2^2) - eps2(H2/A) - alpha*(T2 - T1) - epsCreep
 *     = w1^2*S^2/(24*H1^2) - eps1(H1/A)
 * where `eps1` uses the initial stress-strain polynomial and `eps2` uses either initial (mode 1)
 * or final after-creep (mode 2) 4th-order stress-strain polynomial.
 */
function solvePolyStateChangeTension(
  h1: f64,
  w1: f64,
  t1: f64,
  w2: f64,
  t2: f64,
  spanM: f64,
  areaM2: f64,
  alpha: f64,
  epsCreep: f64,
  a0Init: f64,
  a1Init: f64,
  a2Init: f64,
  a3Init: f64,
  a4Init: f64,
  a0Tgt: f64,
  a1Tgt: f64,
  a2Tgt: f64,
  a3Tgt: f64,
  a4Tgt: f64,
): f64 {
  const s2 = spanM * spanM;
  const eps1 = invertStressStrainPoly(h1 / areaM2, a0Init, a1Init, a2Init, a3Init, a4Init);
  const rhs = (s2 * w1 * w1) / (24.0 * h1 * h1) - eps1 + alpha * (t2 - t1) + epsCreep;

  // Monotone decreasing function g(H) = (S^2 * w2^2)/(24*H^2) - eps2(H/A) - rhs = 0
  let lo: f64 = 100.0;
  let hi: f64 = Math.max(h1 * 4.0, 5.0e6);
  for (let iter = 0; iter < 60; iter++) {
    const mid = 0.5 * (lo + hi);
    const eps2 = invertStressStrainPoly(mid / areaM2, a0Tgt, a1Tgt, a2Tgt, a3Tgt, a4Tgt);
    const g = (s2 * w2 * w2) / (24.0 * mid * mid) - eps2 - rhs;
    if (g > 0.0) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo <= 1e-6 * Math.max(1.0, mid)) break;
  }
  return 0.5 * (lo + hi);
}

/**
 * Solves the ruling-span thermal-elastic state-change cubic equation:
 *   H2^3 + A * H2^2 - B = 0
 * where:
 *   A = (E * Area * S^2 * w1^2) / (24 * H1^2) - H1 + E * Area * alpha * (T2 - T1)
 *   B = (E * Area * S^2 * w2^2) / 24
 */
function solveStateChangeTension(
  h1: f64,
  w1: f64,
  t1: f64,
  w2: f64,
  t2: f64,
  spanM: f64,
  ea: f64,
  alpha: f64,
): f64 {
  const s2 = spanM * spanM;
  const aCoeff = (ea * s2 * w1 * w1) / (24.0 * h1 * h1) - h1 + ea * alpha * (t2 - t1);
  const bCoeff = (ea * s2 * w2 * w2) / 24.0;
  if (bCoeff <= 0.0) return h1;

  let h = Math.max(h1, Math.cbrt(bCoeff));
  if (aCoeff < 0.0) {
    h = Math.max(h, -aCoeff + 10.0);
  }
  for (let iter = 0; iter < 40; iter++) {
    const f = h * h * (h + aCoeff) - bCoeff;
    const df = h * (3.0 * h + 2.0 * aCoeff);
    if (Math.abs(df) < 1e-12) break;
    const step = f / df;
    h -= step;
    if (h < 1.0) h = 1.0;
    if (Math.abs(step) <= 1e-9 * h) break;
  }
  return h;
}

/**
 * IEEE Std 738 steady-state net heat dissipation `qc + qr - qs` (W/m) at conductor temp `tc`.
 */
function ieee738NetHeatWPerM(d: f64, tc: f64, ta: f64, windSpeedMs: f64): f64 {
  const dt = tc - ta;
  const tFilm = 0.5 * (tc + ta);
  const kf = 2.424e-2 + 7.477e-5 * tFilm - 4.407e-9 * tFilm * tFilm;
  const muF = (1.458e-6 * Math.pow(tFilm + 273.0, 1.5)) / (tFilm + 383.4);
  const rhoF = 1.293 / (1.0 + 0.00367 * tFilm);

  let qc: f64 = 0.0;
  if (dt > 0.0) {
    const nRe = (d * rhoF * Math.max(0.0, windSpeedMs)) / muF;
    const qc1 = (1.01 + 1.35 * Math.pow(nRe, 0.52)) * kf * dt;
    const qc2 = 0.754 * Math.pow(nRe, 0.6) * kf * dt;
    const qcn = 3.645 * Math.sqrt(rhoF) * Math.pow(d, 0.75) * Math.pow(dt, 1.25);
    const qForced = qc1 > qc2 ? qc1 : qc2;
    qc = qcn > qForced ? qcn : qForced;
  }

  const emissivity: f64 = 0.5;
  const absorptivity: f64 = 0.5;
  const tck = (tc + 273.0) * 0.01;
  const tak = (ta + 273.0) * 0.01;
  const qr = 17.8 * d * emissivity * (tck * tck * tck * tck - tak * tak * tak * tak);
  const qs = absorptivity * 1000.0 * d;

  return qc + qr - qs;
}

/**
 * Conductor AC resistance per meter at temperature `tc` (ohm/m).
 */
@inline
function conductorResistanceOhmPerM(r25OhmPerKm: f64, r75OhmPerKm: f64, tc: f64): f64 {
  const rKm = r25OhmPerKm + ((r75OhmPerKm - r25OhmPerKm) / 50.0) * (tc - 25.0);
  return Math.max(1e-7, rKm * 1e-3);
}

/**
 * Solves IEEE Std 738 steady-state conductor temperature `tc` (degC) for operating current `iAmps`.
 */
function solveIeee738Temp(
  d: f64,
  ta: f64,
  windSpeedMs: f64,
  r25OhmPerKm: f64,
  r75OhmPerKm: f64,
  iAmps: f64,
): f64 {
  const i2 = iAmps * iAmps;
  let lo = ta;
  let hi = ta + 350.0;
  for (let iter = 0; iter < 40; iter++) {
    const mid = 0.5 * (lo + hi);
    const r = conductorResistanceOhmPerM(r25OhmPerKm, r75OhmPerKm, mid);
    const balance = ieee738NetHeatWPerM(d, mid, ta, windSpeedMs) - i2 * r;
    if (balance < 0.0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return 0.5 * (lo + hi);
}

/**
 * Returns first safe 64-byte-aligned linear-memory offset above AssemblyScript's static data.
 */
export function plsGetArenaBase(): usize {
  return (__heap_base + 63) & ~(<usize>63);
}

/**
 * Initializes model reference state from `CON` and `IO`.
 * Returns the number of active state entries stored in `STATE`.
 */
export function plsModelInit(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  if (isConductor(archetypeId)) {
    const wBare = getCon(slotPtr, conCount, 2, 15.965);
    const rtsN = getCon(slotPtr, conCount, 3, 140100.0);
    const span0 = getIo(slotPtr, 0) > 1e-6 ? getIo(slotPtr, 0) : 300.0;
    const h0 = getIo(slotPtr, 1) > 1e-6 ? getIo(slotPtr, 1) : 0.2 * rtsN;
    const w0 = getIo(slotPtr, 2) > 1e-6 ? getIo(slotPtr, 2) : wBare;
    const tRaw = getIo(slotPtr, 4);
    const t0 = isNaN(tRaw) ? 15.0 : tRaw;
    setState(slotPtr, 0, h0);
    setState(slotPtr, 1, w0);
    setState(slotPtr, 2, t0);
    setState(slotPtr, 3, span0);
    return 4;
  }

  if (isStructure(archetypeId)) {
    const heightM = getCon(slotPtr, conCount, 0, 30.0);
    const capKnM = getCon(slotPtr, conCount, 5, 2500.0);
    setState(slotPtr, 0, heightM);
    setState(slotPtr, 1, capKnM);
    return 2;
  }

  if (isInsulator(archetypeId)) {
    const lenM = getCon(slotPtr, conCount, 0, 2.35);
    const smlN = getCon(slotPtr, conCount, 1, 120000.0);
    setState(slotPtr, 0, lenM);
    setState(slotPtr, 1, smlN);
    return 2;
  }

  if (archetypeId == ARCH_LOAD_NESC || archetypeId == ARCH_LOAD_IEC) {
    const tIce = getCon(slotPtr, conCount, 0, 0.0);
    const pWind = getCon(slotPtr, conCount, 1, 191.52);
    const tempC = getCon(slotPtr, conCount, 4, -17.8);
    setState(slotPtr, 0, tIce);
    setState(slotPtr, 1, pWind);
    setState(slotPtr, 2, tempC);
    return 3;
  }

  return 0;
}

/**
 * Evaluates exact catenary sag/tension/arc-length, ruling-span state-change, IEEE 738 ampacity,
 * NESC/IEC weather resultant unit load, or structure/insulator utilization.
 * Returns 0 on success, -1 on unknown archetype.
 */
export function plsModelEval(archetypeId: i32, slotPtr: usize, conCount: i32): i32 {
  if (isConductor(archetypeId)) {
    const d = getCon(slotPtr, conCount, 0, 0.02814);
    const areaM2 = getCon(slotPtr, conCount, 1, 4.684e-4);
    const wBare = getCon(slotPtr, conCount, 2, 15.965);
    const rtsN = getCon(slotPtr, conCount, 3, 140100.0);
    const modulusPa = getCon(slotPtr, conCount, 4, 7.58e10);
    const alpha = getCon(slotPtr, conCount, 5, 1.91e-5);
    const r25 = getCon(slotPtr, conCount, 6, 0.07283);
    const r75 = getCon(slotPtr, conCount, 7, 0.08688);
    const maxTempC = getCon(slotPtr, conCount, 9, 75.0);

    const spanM = getIo(slotPtr, 0) > 1e-6 ? getIo(slotPtr, 0) : (getState(slotPtr, 3) > 1e-6 ? getState(slotPtr, 3) : 300.0);
    const hIn = getIo(slotPtr, 1);
    const wIn = getIo(slotPtr, 2);
    const w2 = wIn > 1e-6 ? wIn : wBare;
    const tIn = getIo(slotPtr, 4);
    const ta = isNaN(tIn) ? 25.0 : tIn;
    const iOp = getIo(slotPtr, 5);
    const windSpeed = getIo(slotPtr, 6) > 1e-6 ? getIo(slotPtr, 6) : 0.61;

    const hRef = getState(slotPtr, 0);
    const wRef = getState(slotPtr, 1);
    const tRef = getState(slotPtr, 2);

    // Stress-strain polynomial mode via IO[7]:
    //   0 = classical linear Hookean ruling-span (default)
    //   1 = 4th-order initial stress-strain polynomial sigma_init(eps)
    //   2 = 4th-order final (after-creep) stress-strain polynomial sigma_final(eps) + eps_creep
    const ssMode = <i32>Math.round(getIo(slotPtr, 7));

    let h2: f64;
    if (ssMode == 1 || ssMode == 2) {
      const h1 = hRef > 1e-6 ? hRef : (hIn > 1e-6 ? hIn : 0.2 * rtsN);
      const w1 = wRef > 1e-6 ? wRef : wBare;
      const t1 = hRef > 1e-6 ? tRef : ta;

      // Default ASTM B232 / B399 / B856 4th-order stress-strain polynomial coefficients (Pa)
      // sigma(eps) = a0 + a1*eps + a2*eps^2 + a3*eps^3 + a4*eps^4
      const eInitDef =
        archetypeId == ARCH_CONDUCTOR_ACSS
          ? modulusPa * 0.85
          : archetypeId == ARCH_CONDUCTOR_AAAC
            ? modulusPa * 0.92
            : modulusPa * 0.9;
      const a0Init = getCon(slotPtr, conCount, 10, 0.0);
      const a1Init = getCon(slotPtr, conCount, 11, eInitDef);
      const a2Init = getCon(slotPtr, conCount, 12, -2.2e12);
      const a3Init = getCon(slotPtr, conCount, 13, 1.8e14);
      const a4Init = getCon(slotPtr, conCount, 14, -6.0e15);

      const a0Fin = getCon(slotPtr, conCount, 15, 0.0);
      const a1Fin = getCon(slotPtr, conCount, 16, modulusPa);
      const a2Fin = getCon(slotPtr, conCount, 17, -0.6e12);
      const a3Fin = getCon(slotPtr, conCount, 18, 0.4e14);
      const a4Fin = getCon(slotPtr, conCount, 19, -1.0e15);

      const defaultCreep =
        archetypeId == ARCH_CONDUCTOR_ACSS
          ? 1.5e-4
          : archetypeId == ARCH_CONDUCTOR_AAAC
            ? 6.0e-4
            : 4.5e-4;
      const epsCreep = ssMode == 2 ? getCon(slotPtr, conCount, 20, defaultCreep) : 0.0;

      h2 = solvePolyStateChangeTension(
        h1,
        w1,
        t1,
        w2,
        ta,
        spanM,
        areaM2,
        alpha,
        epsCreep,
        a0Init,
        a1Init,
        a2Init,
        a3Init,
        a4Init,
        ssMode == 2 ? a0Fin : a0Init,
        ssMode == 2 ? a1Fin : a1Init,
        ssMode == 2 ? a2Fin : a2Init,
        ssMode == 2 ? a3Fin : a3Init,
        ssMode == 2 ? a4Fin : a4Init,
      );
    } else if (
      hRef > 1e-6 &&
      wRef > 1e-6 &&
      (Math.abs(w2 - wRef) > 1e-9 || Math.abs(ta - tRef) > 1e-9)
    ) {
      h2 = solveStateChangeTension(hRef, wRef, tRef, w2, ta, spanM, modulusPa * areaM2, alpha);
    } else {
      h2 = hIn > 1e-6 ? hIn : (hRef > 1e-6 ? hRef : 0.2 * rtsN);
    }

    // Exact hyperbolic catenary formulas:
    //   D = (H / w) * (cosh(w * S / (2 * H)) - 1)
    //   L = (2 * H / w) * sinh(w * S / (2 * H))
    //   Tmax = H * cosh(w * S / (2 * H))
    const u = (w2 * spanM) / (2.0 * h2);
    const cu = cosh(u);
    const su = sinh(u);
    const sagM = (h2 / w2) * (cu - 1.0);
    const arcLenM = ((2.0 * h2) / w2) * su;
    const maxTensionN = h2 * cu;

    // IEEE Std 738 steady-state ampacity at maxTempC & conductor temperature for operatingCurrentA
    const netHeatMax = ieee738NetHeatWPerM(d, maxTempC, ta, windSpeed);
    const rMax = conductorResistanceOhmPerM(r25, r75, maxTempC);
    const ampacityA = netHeatMax > 0.0 ? Math.sqrt(netHeatMax / rMax) : 0.0;
    const condTempC = iOp > 0.0 ? solveIeee738Temp(d, ta, windSpeed, r25, r75, iOp) : ta;
    const util = rtsN > 0.0 ? maxTensionN / rtsN : 0.0;

    setIo(slotPtr, 8, sagM);
    setIo(slotPtr, 9, arcLenM);
    setIo(slotPtr, 10, maxTensionN);
    setIo(slotPtr, 11, w2);
    setIo(slotPtr, 12, h2);
    setIo(slotPtr, 13, ampacityA);
    setIo(slotPtr, 14, condTempC);
    setIo(slotPtr, 15, util);
    return 0;
  }

  if (archetypeId == ARCH_LOAD_NESC || archetypeId == ARCH_LOAD_IEC) {
    const tIce = getCon(slotPtr, conCount, 0, 0.0);
    const pWindParam = getCon(slotPtr, conCount, 1, 0.0);
    const vWindParam = getCon(slotPtr, conCount, 2, 17.68);
    const kNesc = getCon(slotPtr, conCount, 3, 0.0);
    const tempC = getCon(slotPtr, conCount, 4, -17.8);
    const rhoIce = getCon(slotPtr, conCount, 5, archetypeId == ARCH_LOAD_IEC ? 900.0 : 913.0);
    const ovfV = getCon(slotPtr, conCount, 6, 1.0);
    const ovfT = getCon(slotPtr, conCount, 7, 1.0);

    const wBare = getIo(slotPtr, 2) > 1e-6 ? getIo(slotPtr, 2) : 15.965;
    const diamM = getIo(slotPtr, 3) > 1e-6 ? getIo(slotPtr, 3) : 0.02814;

    const pWind = pWindParam > 0.0 ? pWindParam : 0.5 * AIR_DENSITY_STD * vWindParam * vWindParam;
    const wIce = rhoIce * GRAVITY * Math.PI * tIce * (diamM + tIce);
    const wVert = wBare + wIce;
    const wWind = pWind * (diamM + 2.0 * tIce);

    // NESC C2 / IEC 60826 resultant unit load:
    //   w_r = sqrt((w_c + w_ice)^2 + w_wind^2) + k_NESC
    const wResultant = Math.sqrt(wVert * wVert + wWind * wWind) + kNesc;
    const wFactored =
      Math.sqrt(ovfV * wVert * (ovfV * wVert) + ovfT * wWind * (ovfT * wWind)) + kNesc;

    setIo(slotPtr, 8, wIce);
    setIo(slotPtr, 9, wVert);
    setIo(slotPtr, 10, wWind);
    setIo(slotPtr, 11, wResultant);
    setIo(slotPtr, 12, wIce);
    setIo(slotPtr, 13, wFactored);
    setIo(slotPtr, 14, tempC);
    setIo(slotPtr, 15, wBare > 0.0 ? wResultant / wBare : 1.0);
    return 0;
  }

  if (isStructure(archetypeId)) {
    const heightM = getCon(slotPtr, conCount, 0, 32.0);
    const capKnM = getCon(slotPtr, conCount, 5, 2800.0);
    const spanM = getIo(slotPtr, 0) > 1e-6 ? getIo(slotPtr, 0) : 300.0;
    const hTensionN = getIo(slotPtr, 1) > 1e-6 ? getIo(slotPtr, 1) : 28000.0;
    const wWind = getIo(slotPtr, 2) > 1e-6 ? getIo(slotPtr, 2) : 10.0;
    const angleDeg = getIo(slotPtr, 7) > 0.0 ? getIo(slotPtr, 7) : 0.0;

    const halfRad = 0.5 * angleDeg * (Math.PI / 180.0);
    const transverseForceN = 3.0 * (wWind * spanM + 2.0 * hTensionN * Math.sin(halfRad));
    const overturningMomentKnM = (transverseForceN * 0.85 * heightM) * 1e-3;
    const util = capKnM > 0.0 ? overturningMomentKnM / capKnM : 0.0;

    setIo(slotPtr, 8, overturningMomentKnM);
    setIo(slotPtr, 9, spanM);
    setIo(slotPtr, 10, transverseForceN);
    setIo(slotPtr, 11, wWind);
    setIo(slotPtr, 12, hTensionN);
    setIo(slotPtr, 13, capKnM);
    setIo(slotPtr, 14, angleDeg);
    setIo(slotPtr, 15, util);
    return 0;
  }

  if (isInsulator(archetypeId)) {
    const smlN = getCon(slotPtr, conCount, 1, 120000.0);
    const weightN = getCon(slotPtr, conCount, 2, 950.0);
    const spanM = getIo(slotPtr, 0) > 1e-6 ? getIo(slotPtr, 0) : 300.0;
    const hTensionN = getIo(slotPtr, 1) > 1e-6 ? getIo(slotPtr, 1) : 28000.0;
    const wVert = getIo(slotPtr, 2) > 1e-6 ? getIo(slotPtr, 2) : 16.0;
    const wWind = getIo(slotPtr, 6) > 0.0 ? getIo(slotPtr, 6) : 10.0;
    const angleDeg = getIo(slotPtr, 7) > 0.0 ? getIo(slotPtr, 7) : 0.0;

    const halfRad = 0.5 * angleDeg * (Math.PI / 180.0);
    const fv = wVert * spanM + 0.5 * weightN;
    const fh = wWind * spanM + 2.0 * hTensionN * Math.sin(halfRad);

    let swingDeg: f64 = 0.0;
    let tensionN: f64 = 0.0;
    if (archetypeId == ARCH_INSULATOR_SUSPENSION) {
      swingDeg = Math.atan2(fh, fv) * (180.0 / Math.PI);
      tensionN = Math.sqrt(fv * fv + fh * fh);
    } else if (archetypeId == ARCH_INSULATOR_DEADEND) {
      swingDeg = 0.0;
      tensionN = hTensionN;
    } else {
      // V-string (90 deg included angle, 45 deg legs)
      swingDeg = 0.0;
      tensionN = (fv + fh) / Math.SQRT2;
    }

    const util = smlN > 0.0 ? tensionN / smlN : 0.0;
    setIo(slotPtr, 8, swingDeg);
    setIo(slotPtr, 9, fv);
    setIo(slotPtr, 10, tensionN);
    setIo(slotPtr, 11, fh);
    setIo(slotPtr, 12, smlN);
    setIo(slotPtr, 13, 0.0);
    setIo(slotPtr, 14, 0.0);
    setIo(slotPtr, 15, util);
    return 0;
  }

  return -1;
}
