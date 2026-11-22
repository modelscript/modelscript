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
