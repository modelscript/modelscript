// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Sum-of-Squares (SOS) & Stochastic Barrier Certification Kernels:
 * - Rigorous outward-rounded interval Cholesky PSD certification (`sos_certifyPsdInterval`)
 * - Lyapunov drift dissipation Q = -(A^T P + P A) (`sos_lyapunovDrift`)
 */

@inline
function sosNextUp(x: f64): f64 {
  if (isNaN(x) || x == Infinity) return x;
  if (x == 0.0) return reinterpret<f64>(1 as u64);
  const bits = reinterpret<u64>(x);
  return reinterpret<f64>(x > 0.0 ? bits + 1 : bits - 1);
}

@inline
function sosNextDown(x: f64): f64 {
  if (isNaN(x) || x == -Infinity) return x;
  if (x == 0.0) return reinterpret<f64>(0x8000000000000001 as u64);
  const bits = reinterpret<u64>(x);
  return reinterpret<f64>(x > 0.0 ? bits - 1 : bits + 1);
}

/**
 * Rigorous outward-rounded interval Cholesky factorization of (M - margin * I).
 * - mPtr: row-major f64[n * n] symmetric matrix M
 * - n: matrix dimension
 * - margin: diagonal shift margin
 * - lLoPtr, lHiPtr: scratch f64[n * n] interval Cholesky factor buffers
 * - outMinPivotPtr: output f64[1] minimum diagonal pivot lower bound
 * Returns 1 if strictly positive definite (certified), 0 otherwise.
 */
export function sos_certifyPsdInterval(
  mPtr: usize,
  n: i32,
  margin: f64,
  lLoPtr: usize,
  lHiPtr: usize,
  outMinPivotPtr: usize,
): i32 {
  if (n <= 0) {
    store<f64>(outMinPivotPtr, Infinity);
    return 1;
  }

  const nn = <usize>(n * n);
  memory.fill(lLoPtr, 0, nn << 3);
  memory.fill(lHiPtr, 0, nn << 3);

  let minPivotLo: f64 = Infinity;

  for (let i: i32 = 0; i < n; i++) {
    const rowI = i * n;
    for (let j: i32 = 0; j <= i; j++) {
      const rowJ = j * n;
      const mij = 0.5 * (
        load<f64>(mPtr + (<usize>(rowI + j) << 3)) +
        load<f64>(mPtr + (<usize>(rowJ + i) << 3))
      );

      let sumLo: f64 = mij;
      let sumHi: f64 = mij;

      if (i == j && margin != 0.0) {
        sumLo = sosNextDown(sumLo - margin);
        sumHi = sosNextUp(sumHi - margin);
      }

      for (let k: i32 = 0; k < j; k++) {
        const aLo = load<f64>(lLoPtr + (<usize>(rowI + k) << 3));
        const aHi = load<f64>(lHiPtr + (<usize>(rowI + k) << 3));
        const bLo = load<f64>(lLoPtr + (<usize>(rowJ + k) << 3));
        const bHi = load<f64>(lHiPtr + (<usize>(rowJ + k) << 3));

        const p1 = aLo * bLo;
        const p2 = aLo * bHi;
        const p3 = aHi * bLo;
        const p4 = aHi * bHi;
        const prodLo = sosNextDown(Math.min(Math.min(p1, p2), Math.min(p3, p4)));
        const prodHi = sosNextUp(Math.max(Math.max(p1, p2), Math.max(p3, p4)));

        sumLo = sosNextDown(sumLo - prodHi);
        sumHi = sosNextUp(sumHi - prodLo);
      }

      if (i == j) {
        if (!isFinite(sumLo) || sumLo <= 0.0) {
          store<f64>(outMinPivotPtr, sumLo);
          return 0;
        }
        const diagLo = sosNextDown(Math.sqrt(sumLo));
        const diagHi = sosNextUp(Math.sqrt(sumHi));
        if (!isFinite(diagLo) || diagLo <= 0.0) {
          store<f64>(outMinPivotPtr, diagLo);
          return 0;
        }
        store<f64>(lLoPtr + (<usize>(rowI + i) << 3), diagLo);
        store<f64>(lHiPtr + (<usize>(rowI + i) << 3), diagHi);
        if (diagLo < minPivotLo) minPivotLo = diagLo;
      } else {
        const ljjLo = load<f64>(lLoPtr + (<usize>(rowJ + j) << 3));
        const ljjHi = load<f64>(lHiPtr + (<usize>(rowJ + j) << 3));
        if (ljjLo <= 0.0) {
          store<f64>(outMinPivotPtr, 0.0);
          return 0;
        }
        const invLo = sosNextDown(1.0 / ljjHi);
        const invHi = sosNextUp(1.0 / ljjLo);

        const q1 = sumLo * invLo;
        const q2 = sumLo * invHi;
        const q3 = sumHi * invLo;
        const q4 = sumHi * invHi;
        store<f64>(lLoPtr + (<usize>(rowI + j) << 3), sosNextDown(Math.min(Math.min(q1, q2), Math.min(q3, q4))));
        store<f64>(lHiPtr + (<usize>(rowI + j) << 3), sosNextUp(Math.max(Math.max(q1, q2), Math.max(q3, q4))));
      }
    }
  }

  store<f64>(outMinPivotPtr, minPivotLo);
  return 1;
}

/**
 * Computes Lyapunov drift dissipation matrix Q = -(A^T * P + P * A) in linear memory.
 */
export function sos_lyapunovDrift(
  aPtr: usize,
  pPtr: usize,
  n: i32,
  outQPtr: usize,
): void {
  for (let i: i32 = 0; i < n; i++) {
    const rowI = i * n;
    for (let j: i32 = 0; j < n; j++) {
      let sum: f64 = 0.0;
      for (let k: i32 = 0; k < n; k++) {
        const rowK = k * n;
        sum +=
          load<f64>(aPtr + (<usize>(rowK + i) << 3)) * load<f64>(pPtr + (<usize>(rowK + j) << 3)) +
          load<f64>(pPtr + (<usize>(rowI + k) << 3)) * load<f64>(aPtr + (<usize>(rowK + j) << 3));
      }
      store<f64>(outQPtr + (<usize>(rowI + j) << 3), -sum);
    }
  }
}
