// SPDX-License-Identifier: AGPL-3.0-or-later

export const OCTAGON_INF_I32: i32 = 0x3fffffff;

@inline
function satAddI32(a: i32, b: i32): i32 {
  let s: i64 = (a as i64) + (b as i64);
  if (s < (-OCTAGON_INF_I32 as i64)) return -OCTAGON_INF_I32;
  if (s > (OCTAGON_INF_I32 as i64)) return OCTAGON_INF_I32;
  return s as i32;
}

/**
 * High-performance WebAssembly Floyd-Warshall transitive closure + strong closure for Octagon DBM.
 * Uses hoisted row pointers and 4x unrolling with early-skip.
 */
export function octagon_close_i32(matrixPtr: usize, dim: i32): void {
  for (let k: i32 = 0; k < dim; k++) {
    let kRow = matrixPtr + (<usize>(k * dim) << 2);

    for (let i: i32 = 0; i < dim; i++) {
      let iRow = matrixPtr + (<usize>(i * dim) << 2);
      let ik = load<i32>(iRow + (<usize>k << 2));
      if (ik >= OCTAGON_INF_I32) continue; // Early-skip unreachable intermediate paths

      let j: i32 = 0;
      let dim4 = dim - 3;
      while (j < dim4) {
        let kj0 = load<i32>(kRow + (<usize>j << 2));
        let kj1 = load<i32>(kRow + (<usize>(j + 1) << 2));
        let kj2 = load<i32>(kRow + (<usize>(j + 2) << 2));
        let kj3 = load<i32>(kRow + (<usize>(j + 3) << 2));

        if (kj0 < OCTAGON_INF_I32) {
          let nb0 = satAddI32(ik, kj0);
          if (nb0 < load<i32>(iRow + (<usize>j << 2))) {
            store<i32>(iRow + (<usize>j << 2), nb0);
          }
        }
        if (kj1 < OCTAGON_INF_I32) {
          let nb1 = satAddI32(ik, kj1);
          if (nb1 < load<i32>(iRow + (<usize>(j + 1) << 2))) {
            store<i32>(iRow + (<usize>(j + 1) << 2), nb1);
          }
        }
        if (kj2 < OCTAGON_INF_I32) {
          let nb2 = satAddI32(ik, kj2);
          if (nb2 < load<i32>(iRow + (<usize>(j + 2) << 2))) {
            store<i32>(iRow + (<usize>(j + 2) << 2), nb2);
          }
        }
        if (kj3 < OCTAGON_INF_I32) {
          let nb3 = satAddI32(ik, kj3);
          if (nb3 < load<i32>(iRow + (<usize>(j + 3) << 2))) {
            store<i32>(iRow + (<usize>(j + 3) << 2), nb3);
          }
        }

        j += 4;
      }

      while (j < dim) {
        let kj = load<i32>(kRow + (<usize>j << 2));
        if (kj < OCTAGON_INF_I32) {
          let nb = satAddI32(ik, kj);
          if (nb < load<i32>(iRow + (<usize>j << 2))) {
            store<i32>(iRow + (<usize>j << 2), nb);
          }
        }
        j++;
      }
    }
  }

  // Tighten unary bounds: M[i, i ^ 1] = 2 * floor(M[i, i ^ 1] / 2)
  for (let i: i32 = 0; i < dim; i++) {
    let idx = matrixPtr + (<usize>(i * dim + (i ^ 1)) << 2);
    let u = load<i32>(idx);
    if (u < OCTAGON_INF_I32) {
      let tightened = (u >> 1) << 1;
      if (tightened < -OCTAGON_INF_I32) tightened = -OCTAGON_INF_I32;
      store<i32>(idx, tightened);
    }
  }

  // Strong closure: propagate unary bounds to all pairs
  for (let i: i32 = 0; i < dim; i++) {
    let iRow = matrixPtr + (<usize>(i * dim) << 2);
    let ui = load<i32>(iRow + (<usize>(i ^ 1) << 2));
    if (ui >= OCTAGON_INF_I32) continue;

    for (let j: i32 = 0; j < dim; j++) {
      let uj = load<i32>(matrixPtr + (<usize>((j ^ 1) * dim + j) << 2));
      if (uj < OCTAGON_INF_I32) {
        let sum64: i64 = (ui as i64) + (uj as i64);
        let half: i64 = sum64 >> 1;
        let strongBound: i32 = half < (-OCTAGON_INF_I32 as i64) ? -OCTAGON_INF_I32 : (half as i32);
        let ijPtr = iRow + (<usize>j << 2);
        if (strongBound < load<i32>(ijPtr)) {
          store<i32>(ijPtr, strongBound);
        }
      }
    }
  }
}

export const OCTAGON_INF_F64: f64 = 1e30;

@inline
function satAddF64(a: f64, b: f64): f64 {
  let s: f64 = a + b;
  if (s < -OCTAGON_INF_F64) return -OCTAGON_INF_F64;
  if (s > OCTAGON_INF_F64) return OCTAGON_INF_F64;
  return s;
}

/**
 * High-performance WebAssembly Floyd-Warshall transitive closure + strong closure for Float64 Octagon DBM.
 * Uses hoisted row pointers and 4x unrolling with early-skip.
 */
export function octagon_close_f64(matrixPtr: usize, dim: i32): void {
  for (let k: i32 = 0; k < dim; k++) {
    let kRow = matrixPtr + (<usize>(k * dim) << 3);

    for (let i: i32 = 0; i < dim; i++) {
      let iRow = matrixPtr + (<usize>(i * dim) << 3);
      let ik = load<f64>(iRow + (<usize>k << 3));
      if (ik >= OCTAGON_INF_F64) continue; // Early-skip unreachable intermediate paths

      let j: i32 = 0;
      let dim4 = dim - 3;
      while (j < dim4) {
        let kj0 = load<f64>(kRow + (<usize>j << 3));
        let kj1 = load<f64>(kRow + (<usize>(j + 1) << 3));
        let kj2 = load<f64>(kRow + (<usize>(j + 2) << 3));
        let kj3 = load<f64>(kRow + (<usize>(j + 3) << 3));

        if (kj0 < OCTAGON_INF_F64) {
          let nb0 = satAddF64(ik, kj0);
          if (nb0 < load<f64>(iRow + (<usize>j << 3))) {
            store<f64>(iRow + (<usize>j << 3), nb0);
          }
        }
        if (kj1 < OCTAGON_INF_F64) {
          let nb1 = satAddF64(ik, kj1);
          if (nb1 < load<f64>(iRow + (<usize>(j + 1) << 3))) {
            store<f64>(iRow + (<usize>(j + 1) << 3), nb1);
          }
        }
        if (kj2 < OCTAGON_INF_F64) {
          let nb2 = satAddF64(ik, kj2);
          if (nb2 < load<f64>(iRow + (<usize>(j + 2) << 3))) {
            store<f64>(iRow + (<usize>(j + 2) << 3), nb2);
          }
        }
        if (kj3 < OCTAGON_INF_F64) {
          let nb3 = satAddF64(ik, kj3);
          if (nb3 < load<f64>(iRow + (<usize>(j + 3) << 3))) {
            store<f64>(iRow + (<usize>(j + 3) << 3), nb3);
          }
        }

        j += 4;
      }

      while (j < dim) {
        let kj = load<f64>(kRow + (<usize>j << 3));
        if (kj < OCTAGON_INF_F64) {
          let nb = satAddF64(ik, kj);
          if (nb < load<f64>(iRow + (<usize>j << 3))) {
            store<f64>(iRow + (<usize>j << 3), nb);
          }
        }
        j++;
      }
    }
  }

  // Strong closure: propagate unary bounds to all pairs
  for (let i: i32 = 0; i < dim; i++) {
    let iRow = matrixPtr + (<usize>(i * dim) << 3);
    let ui = load<f64>(iRow + (<usize>(i ^ 1) << 3));
    if (ui >= OCTAGON_INF_F64) continue;

    for (let j: i32 = 0; j < dim; j++) {
      let uj = load<f64>(matrixPtr + (<usize>((j ^ 1) * dim + j) << 3));
      if (uj < OCTAGON_INF_F64) {
        let strongBound: f64 = (ui + uj) * 0.5;
        let ijPtr = iRow + (<usize>j << 3);
        if (strongBound < load<f64>(ijPtr)) {
          store<f64>(ijPtr, strongBound);
        }
      }
    }
  }
}
