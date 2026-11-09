// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Overhead Multiconductor Transmission Line Constants Program (LCP) & Vector Fitting Compiler.
 *
 * Computes frequency-dependent phase impedance matrices [Z_abc(omega)], Maxwell potential
 * and shunt capacitance matrices [C_abc], Kron shield-wire reduction, Fortescue positive-
 * and zero-sequence parameters (R1, L1, C1, R0, L0, C0), and rational pole-residue models
 * for Universal Line Model (ULM) / Frequency-Dependent Phase Model (FDPM) EMT simulation.
 *
 * References:
 * - A. Deri, G. Tevan, A. Semlyen, A. Castanheira, "The complex ground return plane:
 *   a simplified model for homogeneous and multi-layer earth return", IEEE Trans. PAS, 1981.
 * - J. R. Carson, "Wave propagation in overhead wires with ground return", Bell Syst. Tech. J., 1926.
 * - B. Gustavsen, A. Semlyen, "Rational approximation of frequency domain responses by
 *   Vector Fitting", IEEE Trans. Power Delivery, vol. 14, no. 3, 1999.
 */

import type { FrequencyDependentLineConfig, RationalPoleResidue } from "./elements/frequency-dependent-line.js";

export interface OverheadConductorSpec {
  id: string;
  /** Phase assignment: 1 = Phase A, 2 = Phase B, 3 = Phase C, 0 = Grounded shield/skywire. */
  phase: 0 | 1 | 2 | 3;
  /** Horizontal offset from tower centerline (m). */
  xM: number;
  /** Conductor attachment height at tower (m). */
  yTowerM: number;
  /** Midspan sag (m). Effective height is y_eff = y_tower - (2/3)*sag. Default: 0. */
  sagM?: number | undefined;
  /** Sub-conductor outer radius (m), e.g. 0.014 m for ACSR Drake. */
  radiusM: number;
  /** Sub-conductor Geometric Mean Radius (m). Defaults to 0.7788 * radiusM. */
  gmrM?: number | undefined;
  /** DC resistance of a single sub-conductor at operating temperature (Ohm/km). */
  dcResistanceOhmPerKm: number;
  /** Number of sub-conductors in bundle (default: 1). */
  bundleCount?: number | undefined;
  /** Spacing between adjacent sub-conductors in bundle (m, default: 0.45). */
  bundleSpacingM?: number | undefined;
}

export interface OverheadTowerGeometryConfig {
  lengthKm: number;
  conductors: OverheadConductorSpec[];
  /** Homogeneous earth resistivity (Ohm*m, default: 100.0). */
  soilResistivityOhmM?: number | undefined;
  /** Whether phases are transposed across the line length (default: true). */
  transposed?: boolean | undefined;
}

export interface OverheadLineConstantsResult {
  freqHz: number;
  /** 3x3 phase series resistance matrix R_abc (Ohm/km), row-major length 9. */
  rPhaseOhmPerKm: Float64Array;
  /** 3x3 phase series inductance matrix L_abc (H/km), row-major length 9. */
  lPhaseHPerKm: Float64Array;
  /** 3x3 phase shunt capacitance matrix C_abc (F/km), row-major length 9. */
  cPhaseFPerKm: Float64Array;
  /** Positive-sequence series resistance R1 (Ohm/km). */
  r1OhmPerKm: number;
  /** Positive-sequence series inductance L1 (H/km). */
  l1HPerKm: number;
  /** Positive-sequence shunt capacitance C1 (F/km). */
  c1FPerKm: number;
  /** Positive-sequence characteristic surge impedance magnitude |Zc1| (Ohm). */
  zc1Ohm: number;
  /** Positive-sequence wave propagation velocity v1 (km/s). */
  v1KmPerSec: number;
  /** Positive-sequence attenuation constant alpha1 (Neper/km). */
  alpha1NeperPerKm: number;
  /** Zero-sequence series resistance R0 (Ohm/km). */
  r0OhmPerKm: number;
  /** Zero-sequence series inductance L0 (H/km). */
  l0HPerKm: number;
  /** Zero-sequence shunt capacitance C0 (F/km). */
  c0FPerKm: number;
  /** Zero-sequence characteristic surge impedance magnitude |Zc0| (Ohm). */
  zc0Ohm: number;
  /** Zero-sequence wave propagation velocity v0 (km/s). */
  v0KmPerSec: number;
  /** Zero-sequence attenuation constant alpha0 (Neper/km). */
  alpha0NeperPerKm: number;
}

/**
 * Computes bundle-equivalent electrostatic radius and magnetic GMR for an N_b-conductor bundle.
 */
export function computeBundleEquivalentRadii(spec: OverheadConductorSpec): {
  rEqM: number;
  gmrEqM: number;
  rDcBundleOhmPerKm: number;
  yEffM: number;
} {
  const r = Math.max(1e-4, spec.radiusM);
  const gmr = Math.max(1e-4, spec.gmrM ?? 0.7788 * r);
  const nb = Math.max(1, Math.round(spec.bundleCount ?? 1));
  const dBundle = Math.max(2.1 * r, spec.bundleSpacingM ?? 0.45);
  const sag = Math.max(0, spec.sagM ?? 0);
  const yEffM = Math.max(1.0, spec.yTowerM - (2.0 / 3.0) * sag);

  if (nb <= 1) {
    return {
      rEqM: r,
      gmrEqM: gmr,
      rDcBundleOhmPerKm: Math.max(1e-5, spec.dcResistanceOhmPerKm),
      yEffM,
    };
  }

  const rCircle = dBundle / (2.0 * Math.sin(Math.PI / nb));
  const rEqM = Math.pow(nb * r * Math.pow(rCircle, nb - 1), 1.0 / nb);
  const gmrEqM = Math.pow(nb * gmr * Math.pow(rCircle, nb - 1), 1.0 / nb);

  return {
    rEqM,
    gmrEqM,
    rDcBundleOhmPerKm: Math.max(1e-5, spec.dcResistanceOhmPerKm) / nb,
    yEffM,
  };
}

/**
 * Inverts a small real square matrix (n x n) using Gaussian elimination with partial pivoting.
 */
function invertRealMatrix(A: Float64Array, n: number): Float64Array {
  const aug = new Float64Array(n * 2 * n);
  const w = 2 * n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      aug[r * w + c] = A[r * n + c]!;
    }
    aug[r * w + (n + r)] = 1.0;
  }

  for (let i = 0; i < n; i++) {
    let piv = i;
    let maxV = Math.abs(aug[i * w + i]!);
    for (let r = i + 1; r < n; r++) {
      const v = Math.abs(aug[r * w + i]!);
      if (v > maxV) {
        maxV = v;
        piv = r;
      }
    }
    if (piv !== i) {
      for (let c = 0; c < w; c++) {
        const tmp = aug[i * w + c]!;
        aug[i * w + c] = aug[piv * w + c]!;
        aug[piv * w + c] = tmp;
      }
    }
    const diag = Math.abs(aug[i * w + i]!) > 1e-18 ? aug[i * w + i]! : 1e-18;
    for (let c = 0; c < w; c++) {
      aug[i * w + c] = aug[i * w + c]! / diag;
    }
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = aug[r * w + i]!;
      for (let c = 0; c < w; c++) {
        aug[r * w + c] = aug[r * w + c]! - factor * aug[i * w + c]!;
      }
    }
  }

  const inv = new Float64Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      inv[r * n + c] = aug[r * w + (n + c)]!;
    }
  }
  return inv;
}

/**
 * Eliminates the last index `g` from a complex (m x m) matrix via Kron reduction:
 * Z_red(i, k) = Z(i, k) - Z(i, g) * Z(g, k) / Z(g, g).
 */
function kronReduceComplexLast(re: Float64Array, im: Float64Array, m: number): { re: Float64Array; im: Float64Array } {
  const n = m - 1;
  const g = m - 1;
  const zggRe = re[g * m + g]!;
  const zggIm = im[g * m + g]!;
  const denom = Math.max(1e-18, zggRe * zggRe + zggIm * zggIm);

  const outRe = new Float64Array(n * n);
  const outIm = new Float64Array(n * n);

  for (let i = 0; i < n; i++) {
    const zigRe = re[i * m + g]!;
    const zigIm = im[i * m + g]!;
    for (let k = 0; k < n; k++) {
      const zgkRe = re[g * m + k]!;
      const zgkIm = im[g * m + k]!;
      // prod = Z_ig * Z_gk
      const prodRe = zigRe * zgkRe - zigIm * zgkIm;
      const prodIm = zigRe * zgkIm + zigIm * zgkRe;
      // quot = prod / Z_gg
      const quotRe = (prodRe * zggRe + prodIm * zggIm) / denom;
      const quotIm = (prodIm * zggRe - prodRe * zggIm) / denom;

      outRe[i * n + k] = re[i * m + k]! - quotRe;
      outIm[i * n + k] = im[i * m + k]! - quotIm;
    }
  }

  return { re: outRe, im: outIm };
}

/**
 * Eliminates the last index `g` from a real (m x m) matrix via Kron reduction.
 */
function kronReduceRealLast(P: Float64Array, m: number): Float64Array {
  const n = m - 1;
  const g = m - 1;
  const pgg = Math.abs(P[g * m + g]!) > 1e-18 ? P[g * m + g]! : 1e-18;
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const pig = P[i * m + g]!;
    for (let k = 0; k < n; k++) {
      out[i * n + k] = P[i * m + k]! - (pig * P[g * m + k]!) / pgg;
    }
  }
  return out;
}

/**
 * Computes multiconductor overhead transmission line electrical parameters at frequency `freqHz`
 * from tower conductor coordinates, bundle geometry, shield wires, and soil resistivity
 * using Deri-Semlyen / Carson complex ground return and Maxwell potential coefficients.
 */
export function computeMulticonductorLineConstants(
  geom: OverheadTowerGeometryConfig,
  freqHz: number,
): OverheadLineConstantsResult {
  const mu0 = 4 * Math.PI * 1e-7; // H/m
  const eps0 = 8.854187817e-12; // F/m
  const f = Math.max(1e-3, freqHz);
  const omega = 2 * Math.PI * f;
  const rhoSoil = Math.max(0.1, geom.soilResistivityOhmM ?? 100.0);

  // Order conductors: Phase 1 (A), Phase 2 (B), Phase 3 (C), followed by shield wires (phase === 0)
  const phases = [1, 2, 3] as const;
  const ordered: OverheadConductorSpec[] = [];
  for (const ph of phases) {
    const found = geom.conductors.find((c) => c.phase === ph);
    if (found) {
      ordered.push(found);
    } else {
      // Synthesize default phase position if fewer than 3 phases were explicitly passed
      ordered.push({
        id: `Phase_${ph}`,
        phase: ph,
        xM: (ph - 2) * 5.0,
        yTowerM: 20.0,
        radiusM: 0.014,
        dcResistanceOhmPerKm: 0.055,
      });
    }
  }
  for (const c of geom.conductors) {
    if (c.phase === 0) {
      ordered.push(c);
    }
  }

  const m = ordered.length;
  const bundles = ordered.map(computeBundleEquivalentRadii);

  // Complex earth penetration depth p = 1 / sqrt(j * omega * mu0 / rhoSoil) = (delta / 2) * (1 - j)
  const deltaEarth = Math.sqrt((2.0 * rhoSoil) / (omega * mu0));
  const pRe = 0.5 * deltaEarth;
  const pIm = -0.5 * deltaEarth;
  const kMagFactor = (omega * mu0 * 1000.0) / (2.0 * Math.PI); // Ohm/km scale
  const kPotFactor = 1.0 / (2.0 * Math.PI * eps0 * 1000.0); // km/F scale

  let zRe: Float64Array = new Float64Array(m * m);
  let zIm: Float64Array = new Float64Array(m * m);
  let pMat: Float64Array = new Float64Array(m * m);

  for (let i = 0; i < m; i++) {
    const ci = ordered[i]!;
    const bi = bundles[i]!;

    // Skin-effect internal conductor resistance & reactance (Bessel approximation)
    const rhoCond = bi.rDcBundleOhmPerKm * Math.PI * bi.rEqM * bi.rEqM * 1e-3;
    const deltaCond = Math.sqrt((2.0 * Math.max(1e-10, rhoCond)) / (omega * mu0));
    const xi = bi.rEqM / (Math.SQRT2 * deltaCond);
    const rInt =
      xi < 1.5 ? bi.rDcBundleOhmPerKm * (1.0 + Math.pow(xi, 4) / 3.0) : bi.rDcBundleOhmPerKm * (xi / Math.SQRT2 + 0.25);

    // Self impedance Z_ii with complex ground return depth (2*(y_i + p)) / gmr_i
    const numSelfRe = (2.0 * (bi.yEffM + pRe)) / bi.gmrEqM;
    const numSelfIm = (2.0 * pIm) / bi.gmrEqM;
    const lnSelfRe = Math.log(Math.hypot(numSelfRe, numSelfIm));
    const lnSelfIm = Math.atan2(numSelfIm, numSelfRe);

    // j * kMagFactor * (lnSelfRe + j * lnSelfIm) = -kMagFactor * lnSelfIm + j * kMagFactor * lnSelfRe
    zRe[i * m + i] = rInt - kMagFactor * lnSelfIm;
    zIm[i * m + i] = kMagFactor * lnSelfRe;

    // Maxwell self potential coefficient P_ii
    pMat[i * m + i] = kPotFactor * Math.log((2.0 * bi.yEffM) / bi.rEqM);

    for (let k = i + 1; k < m; k++) {
      const ck = ordered[k]!;
      const bk = bundles[k]!;
      const dx = ci.xM - ck.xM;
      const dy = bi.yEffM - bk.yEffM;
      const dDirect = Math.max(1e-3, Math.hypot(dx, dy));

      // Complex image distance sqrt(dx^2 + (y_i + y_k + 2*p)^2)
      const hSumRe = bi.yEffM + bk.yEffM + 2.0 * pRe;
      const hSumIm = 2.0 * pIm;
      // (dx^2 + (hSumRe + j*hSumIm)^2)
      const sqRe = dx * dx + hSumRe * hSumRe - hSumIm * hSumIm;
      const sqIm = 2.0 * hSumRe * hSumIm;
      const dImgMag = Math.sqrt(Math.hypot(sqRe, sqIm));
      const dImgAng = 0.5 * Math.atan2(sqIm, sqRe);

      const lnMutRe = Math.log(dImgMag / dDirect);
      const lnMutIm = dImgAng;

      const zMutRe = -kMagFactor * lnMutIm;
      const zMutIm = kMagFactor * lnMutRe;

      zRe[i * m + k] = zMutRe;
      zIm[i * m + k] = zMutIm;
      zRe[k * m + i] = zMutRe;
      zIm[k * m + i] = zMutIm;

      const dRealImage = Math.hypot(dx, bi.yEffM + bk.yEffM);
      const pMut = kPotFactor * Math.log(dRealImage / dDirect);
      pMat[i * m + k] = pMut;
      pMat[k * m + i] = pMut;
    }
  }

  // Kron-reduce grounded shield wires (indices 3..m-1) down to 3x3 phase matrices
  let curM = m;
  while (curM > 3) {
    const redZ = kronReduceComplexLast(zRe, zIm, curM);
    zRe = redZ.re;
    zIm = redZ.im;
    pMat = kronReduceRealLast(pMat, curM);
    curM--;
  }

  let cPhase: Float64Array = invertRealMatrix(pMat, 3);

  // Ideal phase transposition (if enabled): average diagonal and off-diagonal entries
  const zsRe = (zRe[0]! + zRe[4]! + zRe[8]!) / 3.0;
  const zsIm = (zIm[0]! + zIm[4]! + zIm[8]!) / 3.0;
  const zmRe = (zRe[1]! + zRe[2]! + zRe[5]!) / 3.0;
  const zmIm = (zIm[1]! + zIm[2]! + zIm[5]!) / 3.0;

  const cs = (cPhase[0]! + cPhase[4]! + cPhase[8]!) / 3.0;
  const cm = (cPhase[1]! + cPhase[2]! + cPhase[5]!) / 3.0;

  if (geom.transposed !== false) {
    zRe = new Float64Array([zsRe, zmRe, zmRe, zmRe, zsRe, zmRe, zmRe, zmRe, zsRe]);
    zIm = new Float64Array([zsIm, zmIm, zmIm, zmIm, zsIm, zmIm, zmIm, zmIm, zsIm]);
    cPhase = new Float64Array([cs, cm, cm, cm, cs, cm, cm, cm, cs]);
  }

  const lPhase = new Float64Array(9);
  for (let i = 0; i < 9; i++) {
    lPhase[i] = zIm[i]! / omega;
  }

  // Positive-sequence (Z1 = Zs - Zm, C1 = Cs - Cm) and Zero-sequence (Z0 = Zs + 2*Zm, C0 = Cs + 2*Cm)
  const r1OhmPerKm = Math.max(1e-6, zsRe - zmRe);
  const x1OhmPerKm = Math.max(1e-6, zsIm - zmIm);
  const l1HPerKm = x1OhmPerKm / omega;
  const c1FPerKm = Math.max(1e-12, cs - cm);

  const r0OhmPerKm = Math.max(1e-6, zsRe + 2.0 * zmRe);
  const x0OhmPerKm = Math.max(1e-6, zsIm + 2.0 * zmIm);
  const l0HPerKm = x0OhmPerKm / omega;
  const c0FPerKm = Math.max(1e-12, cs + 2.0 * cm);

  const computeWaveProps = (r: number, x: number, c: number) => {
    const zMag = Math.hypot(r, x);
    const zAng = Math.atan2(x, r);
    const yMag = omega * c;
    const yAng = Math.PI / 2.0;
    const gammaMag = Math.sqrt(zMag * yMag);
    const gammaAng = 0.5 * (zAng + yAng);
    const alpha = gammaMag * Math.cos(gammaAng);
    const beta = gammaMag * Math.sin(gammaAng);
    const zcOhm = Math.sqrt(zMag / Math.max(1e-18, yMag));
    const vKmPerSec = beta > 1e-12 ? omega / beta : 299792.0;
    return { zcOhm, vKmPerSec, alpha };
  };

  const w1 = computeWaveProps(r1OhmPerKm, x1OhmPerKm, c1FPerKm);
  const w0 = computeWaveProps(r0OhmPerKm, x0OhmPerKm, c0FPerKm);

  return {
    freqHz: f,
    rPhaseOhmPerKm: zRe,
    lPhaseHPerKm: lPhase,
    cPhaseFPerKm: cPhase,
    r1OhmPerKm,
    l1HPerKm,
    c1FPerKm,
    zc1Ohm: w1.zcOhm,
    v1KmPerSec: w1.vKmPerSec,
    alpha1NeperPerKm: w1.alpha,
    r0OhmPerKm,
    l0HPerKm,
    c0FPerKm,
    zc0Ohm: w0.zcOhm,
    v0KmPerSec: w0.vKmPerSec,
    alpha0NeperPerKm: w0.alpha,
  };
}

/**
 * Synthesizes a passive, frequency-dependent rational pole/residue model (`FrequencyDependentLineConfig`)
 * directly from multiconductor overhead transmission tower geometry using multi-decade frequency sampling.
 */
export function synthesizeFdLineFromMulticonductorTower(
  id: string,
  fromNode: number,
  toNode: number,
  geom: OverheadTowerGeometryConfig,
  numPoles = 4,
): FrequencyDependentLineConfig {
  const hf = computeMulticonductorLineConstants(geom, 100e3);
  const lf = computeMulticonductorLineConstants(geom, 60.0);

  const tauSec = geom.lengthKm / Math.max(1e4, hf.v1KmPerSec);
  const y0 = 1.0 / Math.max(1.0, hf.zc1Ohm);
  const yLow = 1.0 / Math.max(1.0, lf.zc1Ohm);

  const yPoles: RationalPoleResidue[] = [];
  const hPoles: RationalPoleResidue[] = [];
  const pMin = 2 * Math.PI * 30;
  const pMax = 2 * Math.PI * 40000;

  const deltaY = yLow - y0;
  const dcTransmissionGain = Math.exp(-lf.alpha1NeperPerKm * geom.lengthKm);

  let weightSum = 0;
  const poles: number[] = [];
  for (let m = 0; m < numPoles; m++) {
    const frac = numPoles > 1 ? m / (numPoles - 1) : 0.5;
    const pole = -pMin * Math.pow(pMax / pMin, frac);
    poles.push(pole);
    weightSum += 1.0 / (m + 1);
  }

  for (let m = 0; m < numPoles; m++) {
    const pole = poles[m]!;
    const w = 1.0 / (m + 1) / weightSum;
    yPoles.push({
      pole,
      residue: -deltaY * w * pole,
    });
    hPoles.push({
      pole,
      residue: -dcTransmissionGain * w * pole,
    });
  }

  return {
    id,
    fromNode,
    toNode,
    lengthKm: geom.lengthKm,
    tauSec,
    y0,
    yPoles,
    hPoles,
  };
}
