// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime (AssemblyScript WASM) — Zero-Allocation Linear-Memory Radix-2 FFT/IFFT
 * & SIMP Sensitivity Filter Kernels.
 *
 * Operates directly on linear memory pointers (`rePtr`, `imPtr`, `xPtr`, `dcPtr`, `dcnPtr`)
 * for high-throughput spectral and topology-optimization workloads.
 */

/**
 * In-place Radix-2 Cooley-Tukey FFT (`inverse == 0`) or IFFT (`inverse != 0`)
 * operating directly on f64 linear memory buffers `rePtr` and `imPtr` of length `n` (power of 2).
 */
export function wasmFftRadix2(rePtr: usize, imPtr: usize, n: i32, inverse: i32): void {
  if (n <= 1) return;

  // Bit-reversal permutation
  let j: i32 = 0;
  for (let i: i32 = 1; i < n; i++) {
    let bit: i32 = n >> 1;
    while ((j & bit) != 0) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const iOff = (<usize>i) << 3;
      const jOff = (<usize>j) << 3;
      const tr = load<f64>(rePtr + iOff);
      store<f64>(rePtr + iOff, load<f64>(rePtr + jOff));
      store<f64>(rePtr + jOff, tr);
      const ti = load<f64>(imPtr + iOff);
      store<f64>(imPtr + iOff, load<f64>(imPtr + jOff));
      store<f64>(imPtr + jOff, ti);
    }
  }

  const sign: f64 = inverse != 0 ? 1.0 : -1.0;
  for (let len: i32 = 2; len <= n; len <<= 1) {
    const half: i32 = len >> 1;
    const angle: f64 = (sign * 2.0 * Math.PI) / <f64>len;
    const wLenRe: f64 = Math.cos(angle);
    const wLenIm: f64 = Math.sin(angle);
    for (let i: i32 = 0; i < n; i += len) {
      let wRe: f64 = 1.0;
      let wIm: f64 = 0.0;
      for (let k: i32 = 0; k < half; k++) {
        const uOff = (<usize>(i + k)) << 3;
        const vOff = (<usize>(i + k + half)) << 3;
        const vr = load<f64>(rePtr + vOff);
        const vi = load<f64>(imPtr + vOff);
        const tRe = vr * wRe - vi * wIm;
        const tIm = vr * wIm + vi * wRe;
        const ur = load<f64>(rePtr + uOff);
        const ui = load<f64>(imPtr + uOff);
        store<f64>(rePtr + uOff, ur + tRe);
        store<f64>(imPtr + uOff, ui + tIm);
        store<f64>(rePtr + vOff, ur - tRe);
        store<f64>(imPtr + vOff, ui - tIm);
        const nextWRe = wRe * wLenRe - wIm * wLenIm;
        wIm = wRe * wLenIm + wIm * wLenRe;
        wRe = nextWRe;
      }
    }
  }

  if (inverse != 0) {
    const invN: f64 = 1.0 / <f64>n;
    for (let i: i32 = 0; i < n; i++) {
      const off = (<usize>i) << 3;
      store<f64>(rePtr + off, load<f64>(rePtr + off) * invN);
      store<f64>(imPtr + off, load<f64>(imPtr + off) * invN);
    }
  }
}

/**
 * Linear-memory 2D SIMP sensitivity filter kernel.
 */
export function wasmSimpSensitivityFilter(
  xPtr: usize,
  dcPtr: usize,
  dcnPtr: usize,
  nelx: i32,
  nely: i32,
  rmin: f64,
): void {
  const rCeil: i32 = <i32>Math.ceil(rmin);
  for (let ex: i32 = 0; ex < nelx; ex++) {
    for (let ey: i32 = 0; ey < nely; ey++) {
      let sumW: f64 = 0.0;
      let sumVal: f64 = 0.0;
      const iMin: i32 = ex - rCeil > 0 ? ex - rCeil : 0;
      const iMax: i32 = ex + rCeil < nelx - 1 ? ex + rCeil : nelx - 1;
      const jMin: i32 = ey - rCeil > 0 ? ey - rCeil : 0;
      const jMax: i32 = ey + rCeil < nely - 1 ? ey + rCeil : nely - 1;
      for (let ix: i32 = iMin; ix <= iMax; ix++) {
        for (let iy: i32 = jMin; iy <= jMax; iy++) {
          const dx = <f64>(ex - ix);
          const dy = <f64>(ey - iy);
          const fac = rmin - Math.sqrt(dx * dx + dy * dy);
          if (fac > 0.0) {
            const nOff = (<usize>(ix * nely + iy)) << 3;
            sumW += fac;
            sumVal += fac * load<f64>(xPtr + nOff) * load<f64>(dcPtr + nOff);
          }
        }
      }
      const eOff = (<usize>(ex * nely + ey)) << 3;
      const denom = load<f64>(xPtr + eOff) * sumW;
      store<f64>(dcnPtr + eOff, sumVal / (denom > 1e-12 ? denom : 1e-12));
    }
  }
}
