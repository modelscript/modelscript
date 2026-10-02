// SPDX-License-Identifier: AGPL-3.0-or-later

export const OCTAGON_INF_I32: i32 = 1000000000;

/**
 * High-performance WebAssembly Floyd-Warshall transitive closure for Octagon DBM.
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
          let nb0 = ik + kj0;
          if (nb0 < load<i32>(iRow + (<usize>j << 2))) {
            store<i32>(iRow + (<usize>j << 2), nb0);
          }
        }
        if (kj1 < OCTAGON_INF_I32) {
          let nb1 = ik + kj1;
          if (nb1 < load<i32>(iRow + (<usize>(j + 1) << 2))) {
            store<i32>(iRow + (<usize>(j + 1) << 2), nb1);
          }
        }
        if (kj2 < OCTAGON_INF_I32) {
          let nb2 = ik + kj2;
          if (nb2 < load<i32>(iRow + (<usize>(j + 2) << 2))) {
            store<i32>(iRow + (<usize>(j + 2) << 2), nb2);
          }
        }
        if (kj3 < OCTAGON_INF_I32) {
          let nb3 = ik + kj3;
          if (nb3 < load<i32>(iRow + (<usize>(j + 3) << 2))) {
            store<i32>(iRow + (<usize>(j + 3) << 2), nb3);
          }
        }

        j += 4;
      }

      while (j < dim) {
        let kj = load<i32>(kRow + (<usize>j << 2));
        if (kj < OCTAGON_INF_I32) {
          let nb = ik + kj;
          if (nb < load<i32>(iRow + (<usize>j << 2))) {
            store<i32>(iRow + (<usize>j << 2), nb);
          }
        }
        j++;
      }
    }
  }
}
