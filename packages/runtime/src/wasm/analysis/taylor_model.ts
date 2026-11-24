// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Taylor Model Multivariate Polynomial Multiplication & Truncation Kernel.
 * Computes (P_a(x) + I_a) * (P_b(x) + I_b) truncated to total degree `maxOrder`,
 * accumulating all truncated higher-order terms + cross-remainder terms into the
 * sound interval remainder [outRemLo, outRemHi] over the unit box [-1, 1]^d.
 */

/**
 * Multiplies two sparse multivariate polynomials A and B over [-1, 1]^dim.
 * Exponents packed as u8[nTerms * dim], coefficients as f64[nTerms].
 * Writes merged output terms (up to `maxOutTerms`) into `outExpPtr` and `outCoefPtr`,
 * and writes [remLo, remHi] into `outRemPtr` (2 x f64).
 * Returns number of output terms written.
 */
export function tm_mulTruncate(
  dim: i32,
  maxOrder: i32,
  nA: i32,
  expAPtr: usize,
  coefAPtr: usize,
  remALo: f64,
  remAHi: f64,
  nB: i32,
  expBPtr: usize,
  coefBPtr: usize,
  remBLo: f64,
  remBHi: f64,
  outExpPtr: usize,
  outCoefPtr: usize,
  maxOutTerms: i32,
  outRemPtr: usize,
): i32 {
  let outCount: i32 = 0;
  let truncRad: f64 = 0.0;

  // Compute polynomial range bounds over [-1, 1]^dim: |P_a| <= sum|c_i|, |P_b| <= sum|c_j|
  let boundA: f64 = 0.0;
  for (let i: i32 = 0; i < nA; i++) boundA += Math.abs(load<f64>(coefAPtr + (<usize>i << 3)));
  let boundB: f64 = 0.0;
  for (let j: i32 = 0; j < nB; j++) boundB += Math.abs(load<f64>(coefBPtr + (<usize>j << 3)));

  const tmpExp = heap.alloc(<usize>(dim > 0 ? dim : 1));

  for (let i: i32 = 0; i < nA; i++) {
    const ca = load<f64>(coefAPtr + (<usize>i << 3));
    if (ca == 0.0) continue;
    const eaOff = expAPtr + <usize>(i * dim);

    for (let j: i32 = 0; j < nB; j++) {
      const cb = load<f64>(coefBPtr + (<usize>j << 3));
      if (cb == 0.0) continue;
      const ebOff = expBPtr + <usize>(j * dim);
      const prod = ca * cb;

      let deg: i32 = 0;
      for (let d: i32 = 0; d < dim; d++) {
        const e = <i32>load<u8>(eaOff + <usize>d) + <i32>load<u8>(ebOff + <usize>d);
        store<u8>(tmpExp + <usize>d, <u8>e);
        deg += e;
      }

      if (deg > maxOrder) {
        truncRad += Math.abs(prod);
        continue;
      }

      // Linear search for matching exponent in output (small truncated polynomial)
      let found: i32 = -1;
      for (let k: i32 = 0; k < outCount; k++) {
        const ekOff = outExpPtr + <usize>(k * dim);
        let eq = true;
        for (let d: i32 = 0; d < dim; d++) {
          if (load<u8>(ekOff + <usize>d) != load<u8>(tmpExp + <usize>d)) {
            eq = false;
            break;
          }
        }
        if (eq) {
          found = k;
          break;
        }
      }

      if (found >= 0) {
        const cOff = outCoefPtr + (<usize>found << 3);
        store<f64>(cOff, load<f64>(cOff) + prod);
      } else if (outCount < maxOutTerms) {
        memory.copy(outExpPtr + <usize>(outCount * dim), tmpExp, <usize>dim);
        store<f64>(outCoefPtr + (<usize>outCount << 3), prod);
        outCount++;
      } else {
        truncRad += Math.abs(prod);
      }
    }
  }

  heap.free(tmpExp);

  // Cross remainder bounds: P_a * I_b + P_b * I_a + I_a * I_b + [-truncRad, +truncRad]
  const absRemA = Math.max(Math.abs(remALo), Math.abs(remAHi));
  const absRemB = Math.max(Math.abs(remBLo), Math.abs(remBHi));
  const crossRad = boundA * absRemB + boundB * absRemA;

  const p1 = remALo * remBLo;
  const p2 = remALo * remBHi;
  const p3 = remAHi * remBLo;
  const p4 = remAHi * remBHi;
  const iiLo = Math.min(Math.min(p1, p2), Math.min(p3, p4));
  const iiHi = Math.max(Math.max(p1, p2), Math.max(p3, p4));

  store<f64>(outRemPtr, iiLo - crossRad - truncRad);
  store<f64>(outRemPtr + 8, iiHi + crossRad + truncRad);
  return outCount;
}

@inline
function tmNextUp(x: f64): f64 {
  if (isNaN(x) || x == Infinity) return x;
  if (x == 0.0) return reinterpret<f64>(1 as u64);
  const bits = reinterpret<u64>(x);
  return reinterpret<f64>(x > 0.0 ? bits + 1 : bits - 1);
}

@inline
function tmNextDown(x: f64): f64 {
  if (isNaN(x) || x == -Infinity) return x;
  if (x == 0.0) return reinterpret<f64>(0x8000000000000001 as u64);
  const bits = reinterpret<u64>(x);
  return reinterpret<f64>(x > 0.0 ? bits - 1 : bits + 1);
}

@inline
function tmAddUp(a: f64, b: f64): f64 {
  return tmNextUp(a + b);
}

@inline
function tmAddDown(a: f64, b: f64): f64 {
  return tmNextDown(a + b);
}

@inline
function tmSubDown(a: f64, b: f64): f64 {
  return tmNextDown(a - b);
}

@inline
function tmPowIntLo(lo: f64, hi: f64, exp: i32): f64 {
  if (exp == 0) return 1.0;
  if (exp == 1) return lo;
  if ((exp & 1) == 0) {
    if (lo <= 0.0 && hi >= 0.0) return 0.0;
    const a = Math.abs(lo);
    const b = Math.abs(hi);
    const m = a < b ? a : b;
    return tmNextDown(Math.pow(m, exp as f64));
  }
  return tmNextDown(Math.pow(lo, exp as f64));
}

@inline
function tmPowIntHi(lo: f64, hi: f64, exp: i32): f64 {
  if (exp == 0) return 1.0;
  if (exp == 1) return hi;
  if ((exp & 1) == 0) {
    const a = Math.abs(lo);
    const b = Math.abs(hi);
    const m = a > b ? a : b;
    return tmNextUp(Math.pow(m, exp as f64));
  }
  return tmNextUp(Math.pow(hi, exp as f64));
}

/**
 * Rigorous outward-rounded dense mulTable multiplication of two same-order Taylor Models
 * in WebAssembly linear memory.
 *
 * - M: total monomials in basis
 * - numVars: number of variables
 * - coeffsAPtr, coeffsBPtr: f64[M] input polynomial coefficients
 * - mulTablePtr: i32[M * M] precomputed product monomial index (-1 if truncated)
 * - monoAbsMaxPtr: f64[M] precomputed max(|lo|, |hi|) for each monomial over domain
 * - exponentsPtr: i32[M * numVars] monomial exponent table
 * - domLoPtr, domHiPtr: f64[numVars] domain intervals
 * - outCoeffsPtr: f64[M] output polynomial coefficients (zeroed by kernel)
 * - outExcessPtr: f64[2] output excess remainder [lo, hi] including truncated terms and FP rounding error
 */
export function tm_mulDenseRigorous(
  M: i32,
  numVars: i32,
  coeffsAPtr: usize,
  coeffsBPtr: usize,
  mulTablePtr: usize,
  monoAbsMaxPtr: usize,
  exponentsPtr: usize,
  domLoPtr: usize,
  domHiPtr: usize,
  outCoeffsPtr: usize,
  outExcessPtr: usize,
): void {
  for (let k: i32 = 0; k < M; k++) {
    store<f64>(outCoeffsPtr + (<usize>k << 3), 0.0);
  }

  let excessLo: f64 = 0.0;
  let excessHi: f64 = 0.0;
  let fpErrAcc: f64 = 0.0;

  for (let i: i32 = 0; i < M; i++) {
    const c1 = load<f64>(coeffsAPtr + (<usize>i << 3));
    if (c1 == 0.0) continue;
    const rowOff = i * M;
    const exp1Off = i * numVars;

    for (let j: i32 = 0; j < M; j++) {
      const c2 = load<f64>(coeffsBPtr + (<usize>j << 3));
      if (c2 == 0.0) continue;

      const coeff = c1 * c2;
      const absCoeff = Math.abs(coeff);
      const mulUlp: f64 = absCoeff > 0.0 && isFinite(absCoeff) ? tmNextUp(absCoeff) - absCoeff : 0.0;
      const k = load<i32>(mulTablePtr + (<usize>(rowOff + j) << 2));

      if (k >= 0) {
        const addr = outCoeffsPtr + (<usize>k << 3);
        const prev = load<f64>(addr);
        const next = prev + coeff;
        store<f64>(addr, next);
        let addErr: f64 = 0.0;
        if (prev != 0.0) {
          const d1 = tmAddUp(prev, coeff) - next;
          const d2 = next - tmAddDown(prev, coeff);
          addErr = d1 > d2 ? d1 : d2;
        }
        const totalErr = tmAddUp(mulUlp, addErr);
        if (totalErr > 0.0) {
          const mAbs = load<f64>(monoAbsMaxPtr + (<usize>k << 3));
          fpErrAcc = tmAddUp(fpErrAcc, tmNextUp(totalErr * mAbs));
        }
      } else {
        // Compute outward-rounded interval enclosure of monomial product over domain
        const exp2Off = j * numVars;
        let mLo: f64 = 1.0;
        let mHi: f64 = 1.0;
        for (let v: i32 = 0; v < numVars; v++) {
          const e =
            load<i32>(exponentsPtr + (<usize>(exp1Off + v) << 2)) +
            load<i32>(exponentsPtr + (<usize>(exp2Off + v) << 2));
          if (e == 0) continue;
          const dLo = load<f64>(domLoPtr + (<usize>v << 3));
          const dHi = load<f64>(domHiPtr + (<usize>v << 3));
          const pLo = tmPowIntLo(dLo, dHi, e);
          const pHi = tmPowIntHi(dLo, dHi, e);
          const q1 = mLo * pLo;
          const q2 = mLo * pHi;
          const q3 = mHi * pLo;
          const q4 = mHi * pHi;
          mLo = tmNextDown(Math.min(Math.min(q1, q2), Math.min(q3, q4)));
          mHi = tmNextUp(Math.max(Math.max(q1, q2), Math.max(q3, q4)));
        }

        const cLo = mulUlp > 0.0 ? tmSubDown(coeff, mulUlp) : coeff;
        const cHi = mulUlp > 0.0 ? tmAddUp(coeff, mulUlp) : coeff;
        const t1 = mLo * cLo;
        const t2 = mLo * cHi;
        const t3 = mHi * cLo;
        const t4 = mHi * cHi;
        const termLo = tmNextDown(Math.min(Math.min(t1, t2), Math.min(t3, t4)));
        const termHi = tmNextUp(Math.max(Math.max(t1, t2), Math.max(t3, t4)));
        excessLo = tmAddDown(excessLo, termLo);
        excessHi = tmAddUp(excessHi, termHi);
      }
    }
  }

  if (fpErrAcc > 0.0) {
    excessLo = tmAddDown(excessLo, -fpErrAcc);
    excessHi = tmAddUp(excessHi, fpErrAcc);
  }

  store<f64>(outExcessPtr, excessLo);
  store<f64>(outExcessPtr + 8, excessHi);
}

