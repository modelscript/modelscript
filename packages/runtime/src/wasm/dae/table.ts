// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript 1D Table Linear Interpolation Kernel in WebAssembly linear memory.
 * Operates on a flat row-major f64[nRows * nCols] table where column 0 is the
 * monotonically non-decreasing abscissa.
 */
export function table_interpolate1D(
  tablePtr: usize,
  nRows: i32,
  nCols: i32,
  colIdx: i32,
  u: f64,
): f64 {
  if (nRows <= 0 || nCols <= 0 || colIdx < 0 || colIdx >= nCols) return 0.0;
  if (nRows == 1) {
    return load<f64>(tablePtr + (<usize>colIdx << 3));
  }

  const firstX = load<f64>(tablePtr);
  if (u <= firstX) {
    return load<f64>(tablePtr + (<usize>colIdx << 3));
  }

  const lastRowOff = (<usize>(nRows - 1) * <usize>nCols);
  const lastX = load<f64>(tablePtr + (lastRowOff << 3));
  if (u >= lastX) {
    return load<f64>(tablePtr + ((lastRowOff + <usize>colIdx) << 3));
  }

  let lo: i32 = 0;
  let hi: i32 = nRows - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    const midX = load<f64>(tablePtr + ((<usize>mid * <usize>nCols) << 3));
    if (midX <= u) lo = mid;
    else hi = mid;
  }

  while (hi < nRows - 1 && load<f64>(tablePtr + ((<usize>hi * <usize>nCols) << 3)) <= u) {
    lo = hi;
    hi++;
  }

  const loOff = <usize>lo * <usize>nCols;
  const hiOff = <usize>hi * <usize>nCols;
  const x0 = load<f64>(tablePtr + (loOff << 3));
  const x1 = load<f64>(tablePtr + (hiOff << 3));
  const y0 = load<f64>(tablePtr + ((loOff + <usize>colIdx) << 3));
  const y1 = load<f64>(tablePtr + ((hiOff + <usize>colIdx) << 3));

  if (Math.abs(x1 - x0) < 1e-15) return y1;
  const t = (u - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}
