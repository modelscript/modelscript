// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Linear-Memory Kernels for Overhead Multiconductor Transmission
 * Line Constants Program (LCP).
 *
 * Implements zero-GC, flat linear-memory kernels for:
 * - Deri-Tevan-Semlyen (1981) homogeneous & 2-layer complex earth penetration depth (`lc_earth_penetration_depth`)
 * - Carson / Deri-Semlyen earth-return impedance & Maxwell potential matrix assembly (`lc_assemble_carson_maxwell`)
 * - In-place complex & real Kron ground-wire reduction (`lc_kron_reduce_complex`, `lc_kron_reduce_real`)
 * - Real Gauss-Jordan matrix inversion with partial pivoting (`lc_invert_real_matrix`)
 * - Phase transposition & Fortescue positive/zero-sequence modal decomposition (`lc_sequence_and_wave_props`)
 * - Fused end-to-end multiconductor line constants solver (`lc_compute_multiconductor`)
 */

const LC_MU0: f64 = 4.0 * Math.PI * 1e-7; // H/m
const LC_EPS0: f64 = 8.854187817e-12; // F/m
const LC_TWO_PI: f64 = 2.0 * Math.PI;
const LC_HALF_PI: f64 = 0.5 * Math.PI;

/**
 * Computes complex earth-return penetration depth `p(omega) = pRe + j*pIm` (meters)
 * for homogeneous or 2-layer stratified soil using Deri-Tevan-Semlyen (1981).
 *
 * Output layout:
 * - `outPtr`: `f64[2]` -> `[pRe, pIm]`
 */
export function lc_earth_penetration_depth(
  omega: f64,
  mu0: f64,
  rhoHomogeneous: f64,
  useTwoLayer: i32,
  rhoUpper: f64,
  rhoLower: f64,
  upperDepthM: f64,
  outPtr: usize,
): void {
  if (useTwoLayer == 0) {
    const deltaEarth = Math.sqrt((2.0 * rhoHomogeneous) / (omega * mu0));
    store<f64>(outPtr, 0.5 * deltaEarth);
    store<f64>(outPtr + 8, -0.5 * deltaEarth);
    return;
  }

  const rho1 = Math.max(0.1, rhoUpper);
  const rho2 = Math.max(0.1, rhoLower);
  const h1 = Math.max(0.01, upperDepthM);

  const delta1 = Math.sqrt((2.0 * rho1) / (omega * mu0));
  const delta2 = Math.sqrt((2.0 * rho2) / (omega * mu0));

  const p1Re = 0.5 * delta1;
  const p1Im = -0.5 * delta1;
  const p2Re = 0.5 * delta2;
  const p2Im = -0.5 * delta2;

  const a = h1 / delta1;
  let thRe: f64;
  let thIm: f64;
  if (a > 20.0) {
    thRe = 1.0;
    thIm = 0.0;
  } else {
    const twoA = 2.0 * a;
    const denom = Math.cosh(twoA) + Math.cos(twoA);
    thRe = Math.sinh(twoA) / denom;
    thIm = Math.sin(twoA) / denom;
  }

  const numRe = p1Re * thRe - p1Im * thIm + p2Re;
  const numIm = p1Re * thIm + p1Im * thRe + p2Im;
  const denRe = p1Re + (p2Re * thRe - p2Im * thIm);
  const denIm = p1Im + (p2Re * thIm + p2Im * thRe);
  const denMag2 = Math.max(1e-30, denRe * denRe + denIm * denIm);
  const ratRe = (numRe * denRe + numIm * denIm) / denMag2;
  const ratIm = (numIm * denRe - numRe * denIm) / denMag2;

  store<f64>(outPtr, p1Re * ratRe - p1Im * ratIm);
  store<f64>(outPtr + 8, p1Re * ratIm + p1Im * ratRe);
}

/**
 * Assembles the `m x m` Carson / Deri-Semlyen complex series impedance matrix
 * `Z(omega) = zRe + j*zIm` (Ohm/km) and real Maxwell potential coefficient matrix
 * `P` (km/F) for `m` ordered conductors.
 *
 * Input layout:
 * - `condDataPtr`: `f64[5 * m]` -> `[xM, yEffM, rEqM, gmrEqM, rDcBundleOhmPerKm]` per conductor
 *
 * Output layout:
 * - `zReOutPtr`, `zImOutPtr`, `pMatOutPtr`: `f64[m * m]` row-major
 */
export function lc_assemble_carson_maxwell(
  m: i32,
  condDataPtr: usize,
  omega: f64,
  pRe: f64,
  pIm: f64,
  zReOutPtr: usize,
  zImOutPtr: usize,
  pMatOutPtr: usize,
): void {
  if (m <= 0) return;

  const kMagFactor = (omega * LC_MU0 * 1000.0) / LC_TWO_PI; // Ohm/km scale
  const kPotFactor = 1.0 / (LC_TWO_PI * LC_EPS0 * 1000.0); // km/F scale

  for (let i: i32 = 0; i < m; i++) {
    const iBase = (<usize>(i * 5)) << 3;
    const xi = load<f64>(condDataPtr + iBase);
    const yi = load<f64>(condDataPtr + iBase + 8);
    const rEqi = load<f64>(condDataPtr + iBase + 16);
    const gmrEqi = load<f64>(condDataPtr + iBase + 24);
    const rDci = load<f64>(condDataPtr + iBase + 32);

    // Skin-effect internal conductor resistance (Bessel approximation)
    const rhoCond = rDci * Math.PI * rEqi * rEqi * 1e-3;
    const deltaCond = Math.sqrt((2.0 * Math.max(1e-10, rhoCond)) / (omega * LC_MU0));
    const xiSkin = rEqi / (Math.SQRT2 * deltaCond);
    let rInt: f64;
    if (xiSkin < 1.5) {
      const xi2 = xiSkin * xiSkin;
      rInt = rDci * (1.0 + (xi2 * xi2) / 3.0);
    } else {
      rInt = rDci * (xiSkin / Math.SQRT2 + 0.25);
    }

    // Self impedance Z_ii with complex ground return depth (2*(y_i + p)) / gmr_i
    const numSelfRe = (2.0 * (yi + pRe)) / gmrEqi;
    const numSelfIm = (2.0 * pIm) / gmrEqi;
    const lnSelfRe = Math.log(Math.hypot(numSelfRe, numSelfIm));
    const lnSelfIm = Math.atan2(numSelfIm, numSelfRe);

    const iiOff = (<usize>(i * m + i)) << 3;
    store<f64>(zReOutPtr + iiOff, rInt - kMagFactor * lnSelfIm);
    store<f64>(zImOutPtr + iiOff, kMagFactor * lnSelfRe);

    // Maxwell self potential coefficient P_ii
    store<f64>(pMatOutPtr + iiOff, kPotFactor * Math.log((2.0 * yi) / rEqi));

    for (let k: i32 = i + 1; k < m; k++) {
      const kBase = (<usize>(k * 5)) << 3;
      const xk = load<f64>(condDataPtr + kBase);
      const yk = load<f64>(condDataPtr + kBase + 8);
      const dx = xi - xk;
      const dy = yi - yk;
      const dDirect = Math.max(1e-3, Math.hypot(dx, dy));

      // Complex image distance sqrt(dx^2 + (y_i + y_k + 2*p)^2)
      const hSumRe = yi + yk + 2.0 * pRe;
      const hSumIm = 2.0 * pIm;
      const sqRe = dx * dx + hSumRe * hSumRe - hSumIm * hSumIm;
      const sqIm = 2.0 * hSumRe * hSumIm;
      const dImgMag = Math.sqrt(Math.hypot(sqRe, sqIm));
      const dImgAng = 0.5 * Math.atan2(sqIm, sqRe);

      const lnMutRe = Math.log(dImgMag / dDirect);
      const lnMutIm = dImgAng;

      const zMutRe = -kMagFactor * lnMutIm;
      const zMutIm = kMagFactor * lnMutRe;

      const ikOff = (<usize>(i * m + k)) << 3;
      const kiOff = (<usize>(k * m + i)) << 3;
      store<f64>(zReOutPtr + ikOff, zMutRe);
      store<f64>(zImOutPtr + ikOff, zMutIm);
      store<f64>(zReOutPtr + kiOff, zMutRe);
      store<f64>(zImOutPtr + kiOff, zMutIm);

      const dRealImage = Math.hypot(dx, yi + yk);
      const pMut = kPotFactor * Math.log(dRealImage / dDirect);
      store<f64>(pMatOutPtr + ikOff, pMut);
      store<f64>(pMatOutPtr + kiOff, pMut);
    }
  }
}

/**
 * Eliminates the last `m - targetN` conductors from a complex `m x m` matrix
 * `(zRePtr, zImPtr)` via in-place Kron reduction, then compacts the resulting
 * `targetN x targetN` row-major matrix to the front of `(zRePtr, zImPtr)`.
 */
export function lc_kron_reduce_complex(
  zRePtr: usize,
  zImPtr: usize,
  m: i32,
  targetN: i32,
): void {
  if (m <= targetN || targetN <= 0) return;

  for (let curM: i32 = m; curM > targetN; curM--) {
    const g = curM - 1;
    const ggOff = (<usize>(g * m + g)) << 3;
    const zggRe = load<f64>(zRePtr + ggOff);
    const zggIm = load<f64>(zImPtr + ggOff);
    const denom = Math.max(1e-18, zggRe * zggRe + zggIm * zggIm);
    const invDenom = 1.0 / denom;

    for (let i: i32 = 0; i < g; i++) {
      const igOff = (<usize>(i * m + g)) << 3;
      const zigRe = load<f64>(zRePtr + igOff);
      const zigIm = load<f64>(zImPtr + igOff);

      for (let k: i32 = 0; k < g; k++) {
        const gkOff = (<usize>(g * m + k)) << 3;
        const zgkRe = load<f64>(zRePtr + gkOff);
        const zgkIm = load<f64>(zImPtr + gkOff);

        const prodRe = zigRe * zgkRe - zigIm * zgkIm;
        const prodIm = zigRe * zgkIm + zigIm * zgkRe;
        const quotRe = (prodRe * zggRe + prodIm * zggIm) * invDenom;
        const quotIm = (prodIm * zggRe - prodRe * zggIm) * invDenom;

        const ikOff = (<usize>(i * m + k)) << 3;
        store<f64>(zRePtr + ikOff, load<f64>(zRePtr + ikOff) - quotRe);
        store<f64>(zImPtr + ikOff, load<f64>(zImPtr + ikOff) - quotIm);
      }
    }
  }

  // Compact top-left targetN x targetN from leading dimension m to targetN
  for (let i: i32 = 0; i < targetN; i++) {
    for (let k: i32 = 0; k < targetN; k++) {
      const srcOff = (<usize>(i * m + k)) << 3;
      const dstOff = (<usize>(i * targetN + k)) << 3;
      store<f64>(zRePtr + dstOff, load<f64>(zRePtr + srcOff));
      store<f64>(zImPtr + dstOff, load<f64>(zImPtr + srcOff));
    }
  }
}

/**
 * Eliminates the last `m - targetN` conductors from a real `m x m` matrix
 * `pMatPtr` via in-place Kron reduction, then compacts the resulting
 * `targetN x targetN` row-major matrix to the front of `pMatPtr`.
 */
export function lc_kron_reduce_real(
  pMatPtr: usize,
  m: i32,
  targetN: i32,
): void {
  if (m <= targetN || targetN <= 0) return;

  for (let curM: i32 = m; curM > targetN; curM--) {
    const g = curM - 1;
    const ggOff = (<usize>(g * m + g)) << 3;
    const rawPgg = load<f64>(pMatPtr + ggOff);
    const pgg = Math.abs(rawPgg) > 1e-18 ? rawPgg : 1e-18;
    const invPgg = 1.0 / pgg;

    for (let i: i32 = 0; i < g; i++) {
      const pig = load<f64>(pMatPtr + ((<usize>(i * m + g)) << 3));
      const factor = pig * invPgg;
      for (let k: i32 = 0; k < g; k++) {
        const pgk = load<f64>(pMatPtr + ((<usize>(g * m + k)) << 3));
        const ikOff = (<usize>(i * m + k)) << 3;
        store<f64>(pMatPtr + ikOff, load<f64>(pMatPtr + ikOff) - factor * pgk);
      }
    }
  }

  // Compact top-left targetN x targetN from leading dimension m to targetN
  for (let i: i32 = 0; i < targetN; i++) {
    for (let k: i32 = 0; k < targetN; k++) {
      const srcOff = (<usize>(i * m + k)) << 3;
      const dstOff = (<usize>(i * targetN + k)) << 3;
      store<f64>(pMatPtr + dstOff, load<f64>(pMatPtr + srcOff));
    }
  }
}

/**
 * Inverts a real `n x n` matrix `aPtr` into `invOutPtr` using Gauss-Jordan
 * elimination with partial pivoting.
 *
 * Scratch layout:
 * - `augScratchPtr`: `f64[n * 2 * n]`
 */
export function lc_invert_real_matrix(
  aPtr: usize,
  invOutPtr: usize,
  augScratchPtr: usize,
  n: i32,
): void {
  if (n <= 0) return;

  const w = 2 * n;
  memory.fill(augScratchPtr, 0, (<usize>(n * w)) << 3);

  for (let r: i32 = 0; r < n; r++) {
    for (let c: i32 = 0; c < n; c++) {
      const val = load<f64>(aPtr + ((<usize>(r * n + c)) << 3));
      store<f64>(augScratchPtr + ((<usize>(r * w + c)) << 3), val);
    }
    store<f64>(augScratchPtr + ((<usize>(r * w + (n + r))) << 3), 1.0);
  }

  for (let i: i32 = 0; i < n; i++) {
    let piv = i;
    let maxV = Math.abs(load<f64>(augScratchPtr + ((<usize>(i * w + i)) << 3)));
    for (let r: i32 = i + 1; r < n; r++) {
      const v = Math.abs(load<f64>(augScratchPtr + ((<usize>(r * w + i)) << 3)));
      if (v > maxV) {
        maxV = v;
        piv = r;
      }
    }
    if (piv != i) {
      for (let c: i32 = 0; c < w; c++) {
        const iOff = (<usize>(i * w + c)) << 3;
        const pOff = (<usize>(piv * w + c)) << 3;
        const tmp = load<f64>(augScratchPtr + iOff);
        store<f64>(augScratchPtr + iOff, load<f64>(augScratchPtr + pOff));
        store<f64>(augScratchPtr + pOff, tmp);
      }
    }

    const rawDiag = load<f64>(augScratchPtr + ((<usize>(i * w + i)) << 3));
    const diag = Math.abs(rawDiag) > 1e-18 ? rawDiag : 1e-18;
    const invDiag = 1.0 / diag;
    for (let c: i32 = 0; c < w; c++) {
      const off = (<usize>(i * w + c)) << 3;
      store<f64>(augScratchPtr + off, load<f64>(augScratchPtr + off) * invDiag);
    }

    for (let r: i32 = 0; r < n; r++) {
      if (r == i) continue;
      const factor = load<f64>(augScratchPtr + ((<usize>(r * w + i)) << 3));
      for (let c: i32 = 0; c < w; c++) {
        const rOff = (<usize>(r * w + c)) << 3;
        const iOff = (<usize>(i * w + c)) << 3;
        store<f64>(
          augScratchPtr + rOff,
          load<f64>(augScratchPtr + rOff) - factor * load<f64>(augScratchPtr + iOff),
        );
      }
    }
  }

  for (let r: i32 = 0; r < n; r++) {
    for (let c: i32 = 0; c < n; c++) {
      const srcOff = (<usize>(r * w + (n + c))) << 3;
      const dstOff = (<usize>(r * n + c)) << 3;
      store<f64>(invOutPtr + dstOff, load<f64>(augScratchPtr + srcOff));
    }
  }
}

/**
 * Applies optional ideal 3-phase transposition, converts reactive impedance to
 * inductance `L_abc = Z_im / omega`, and computes Fortescue positive-sequence
 * and zero-sequence modal & wave propagation parameters.
 *
 * Input/Output layout:
 * - `zRePtr`, `zImPtr`, `cPhasePtr`: `f64[9]` (3x3 row-major; symmetrized in-place if `transposed != 0`)
 * - `lPhaseOutPtr`: `f64[9]` (3x3 row-major `L_abc` in H/km)
 * - `seqOutPtr`: `f64[12]` -> `[r1, l1, c1, zc1, v1, alpha1, r0, l0, c0, zc0, v0, alpha0]`
 */
export function lc_sequence_and_wave_props(
  zRePtr: usize,
  zImPtr: usize,
  cPhasePtr: usize,
  omega: f64,
  transposed: i32,
  lPhaseOutPtr: usize,
  seqOutPtr: usize,
): void {
  const zsRe = (load<f64>(zRePtr) + load<f64>(zRePtr + 32) + load<f64>(zRePtr + 64)) / 3.0;
  const zsIm = (load<f64>(zImPtr) + load<f64>(zImPtr + 32) + load<f64>(zImPtr + 64)) / 3.0;
  const zmRe = (load<f64>(zRePtr + 8) + load<f64>(zRePtr + 16) + load<f64>(zRePtr + 40)) / 3.0;
  const zmIm = (load<f64>(zImPtr + 8) + load<f64>(zImPtr + 16) + load<f64>(zImPtr + 40)) / 3.0;

  const cs = (load<f64>(cPhasePtr) + load<f64>(cPhasePtr + 32) + load<f64>(cPhasePtr + 64)) / 3.0;
  const cm = (load<f64>(cPhasePtr + 8) + load<f64>(cPhasePtr + 16) + load<f64>(cPhasePtr + 40)) / 3.0;

  if (transposed != 0) {
    for (let r: i32 = 0; r < 3; r++) {
      for (let c: i32 = 0; c < 3; c++) {
        const off = (<usize>(r * 3 + c)) << 3;
        const isDiag = r == c;
        store<f64>(zRePtr + off, isDiag ? zsRe : zmRe);
        store<f64>(zImPtr + off, isDiag ? zsIm : zmIm);
        store<f64>(cPhasePtr + off, isDiag ? cs : cm);
      }
    }
  }

  const invOmega = 1.0 / omega;
  for (let i: i32 = 0; i < 9; i++) {
    const off = (<usize>i) << 3;
    store<f64>(lPhaseOutPtr + off, load<f64>(zImPtr + off) * invOmega);
  }

  // Positive-sequence (Z1 = Zs - Zm, C1 = Cs - Cm)
  const r1 = Math.max(1e-6, zsRe - zmRe);
  const x1 = Math.max(1e-6, zsIm - zmIm);
  const l1 = x1 * invOmega;
  const c1 = Math.max(1e-12, cs - cm);

  // Zero-sequence (Z0 = Zs + 2*Zm, C0 = Cs + 2*Cm)
  const r0 = Math.max(1e-6, zsRe + 2.0 * zmRe);
  const x0 = Math.max(1e-6, zsIm + 2.0 * zmIm);
  const l0 = x0 * invOmega;
  const c0 = Math.max(1e-12, cs + 2.0 * cm);

  // Positive-sequence wave propagation properties
  const z1Mag = Math.hypot(r1, x1);
  const z1Ang = Math.atan2(x1, r1);
  const y1Mag = omega * c1;
  const g1Mag = Math.sqrt(z1Mag * y1Mag);
  const g1Ang = 0.5 * (z1Ang + LC_HALF_PI);
  const alpha1 = g1Mag * Math.cos(g1Ang);
  const beta1 = g1Mag * Math.sin(g1Ang);
  const zc1 = Math.sqrt(z1Mag / Math.max(1e-18, y1Mag));
  const v1 = beta1 > 1e-12 ? omega / beta1 : 299792.0;

  // Zero-sequence wave propagation properties
  const z0Mag = Math.hypot(r0, x0);
  const z0Ang = Math.atan2(x0, r0);
  const y0Mag = omega * c0;
  const g0Mag = Math.sqrt(z0Mag * y0Mag);
  const g0Ang = 0.5 * (z0Ang + LC_HALF_PI);
  const alpha0 = g0Mag * Math.cos(g0Ang);
  const beta0 = g0Mag * Math.sin(g0Ang);
  const zc0 = Math.sqrt(z0Mag / Math.max(1e-18, y0Mag));
  const v0 = beta0 > 1e-12 ? omega / beta0 : 299792.0;

  store<f64>(seqOutPtr, r1);
  store<f64>(seqOutPtr + 8, l1);
  store<f64>(seqOutPtr + 16, c1);
  store<f64>(seqOutPtr + 24, zc1);
  store<f64>(seqOutPtr + 32, v1);
  store<f64>(seqOutPtr + 40, alpha1);
  store<f64>(seqOutPtr + 48, r0);
  store<f64>(seqOutPtr + 56, l0);
  store<f64>(seqOutPtr + 64, c0);
  store<f64>(seqOutPtr + 72, zc0);
  store<f64>(seqOutPtr + 80, v0);
  store<f64>(seqOutPtr + 88, alpha0);
}

/**
 * Fused end-to-end multiconductor overhead line constants kernel.
 *
 * Executes:
 * 1. Deri-Tevan-Semlyen complex earth penetration depth
 * 2. Carson / Maxwell `m x m` matrix assembly
 * 3. Kron reduction of shield wires (`m -> 3`)
 * 4. 3x3 Maxwell potential matrix inversion (`C_abc = P_abc^-1`)
 * 5. Phase transposition + Fortescue positive/zero-sequence wave decomposition
 *
 * Layout:
 * - `condDataPtr`: `f64[5 * m]` -> `[xM, yEffM, rEqM, gmrEqM, rDcBundleOhmPerKm]`
 * - `rPhaseOutPtr`, `lPhaseOutPtr`, `cPhaseOutPtr`: `f64[9]`
 * - `seqOutPtr`: `f64[12]` -> `[r1, l1, c1, zc1, v1, alpha1, r0, l0, c0, zc0, v0, alpha0]`
 * - `scratchF64Ptr`: `f64[3 * m * m + 20]`
 *
 * Returns `1` on success, `0` if `m < 3`.
 */
export function lc_compute_multiconductor(
  m: i32,
  condDataPtr: usize,
  freqHz: f64,
  rhoHomogeneous: f64,
  useTwoLayer: i32,
  rhoUpper: f64,
  rhoLower: f64,
  upperDepthM: f64,
  transposed: i32,
  rPhaseOutPtr: usize,
  lPhaseOutPtr: usize,
  cPhaseOutPtr: usize,
  seqOutPtr: usize,
  scratchF64Ptr: usize,
): i32 {
  if (m < 3) return 0;

  const f = Math.max(1e-3, freqHz);
  const omega = LC_TWO_PI * f;
  const rhoSoil = Math.max(0.1, rhoHomogeneous);

  const mmBytes = (<usize>(m * m)) << 3;
  const zRePtr = scratchF64Ptr;
  const zImPtr = zRePtr + mmBytes;
  const pMatPtr = zImPtr + mmBytes;
  const augPtr = pMatPtr + mmBytes; // 3 * 6 = 18 f64s (144 bytes)
  const pDepthPtr = augPtr + 144; // 2 f64s (16 bytes)

  lc_earth_penetration_depth(omega, LC_MU0, rhoSoil, useTwoLayer, rhoUpper, rhoLower, upperDepthM, pDepthPtr);
  const pRe = load<f64>(pDepthPtr);
  const pIm = load<f64>(pDepthPtr + 8);

  lc_assemble_carson_maxwell(m, condDataPtr, omega, pRe, pIm, zRePtr, zImPtr, pMatPtr);

  if (m > 3) {
    lc_kron_reduce_complex(zRePtr, zImPtr, m, 3);
    lc_kron_reduce_real(pMatPtr, m, 3);
  }

  lc_invert_real_matrix(pMatPtr, cPhaseOutPtr, augPtr, 3);
  memory.copy(rPhaseOutPtr, zRePtr, 72);

  lc_sequence_and_wave_props(rPhaseOutPtr, zImPtr, cPhaseOutPtr, omega, transposed, lPhaseOutPtr, seqOutPtr);

  return 1;
}
