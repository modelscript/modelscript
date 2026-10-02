// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly Zero-GC Vectorized Signal Temporal Logic (STL) Quantitative Monitor.
 *
 * Implements Lemire monotonic sliding-window deque in linear memory for Always[a, b]
 * and Eventually[a, b] operators, and running prefix-min acceleration for Until[a, b].
 */

export function stl_eval_always(
  timePtr: usize,
  valPtr: usize,
  n: i32,
  a: f64,
  b: f64,
  outPtr: usize,
): void {
  if (n <= 0) return;

  let right: i32 = 0;
  let deque = new Int32Array(n);
  let head: i32 = 0;
  let tail: i32 = 0;

  for (let i: i32 = 0; i < n; i++) {
    let t = load<f64>(timePtr + (<usize>i << 3));
    let tMin = t + a;
    let tMax = t + b;

    while (right < n && load<f64>(timePtr + (<usize>right << 3)) <= tMax) {
      let v = load<f64>(valPtr + (<usize>right << 3));
      while (tail > head && load<f64>(valPtr + (<usize>deque[tail - 1] << 3)) >= v) {
        tail--;
      }
      deque[tail++] = right;
      right++;
    }

    while (head < tail && load<f64>(timePtr + (<usize>deque[head] << 3)) < tMin) {
      head++;
    }

    let minVal = head < tail
      ? load<f64>(valPtr + (<usize>deque[head] << 3))
      : load<f64>(valPtr + (<usize>(n - 1) << 3));

    store<f64>(outPtr + (<usize>i << 3), minVal);
  }
}

export function stl_eval_eventually(
  timePtr: usize,
  valPtr: usize,
  n: i32,
  a: f64,
  b: f64,
  outPtr: usize,
): void {
  if (n <= 0) return;

  let right: i32 = 0;
  let deque = new Int32Array(n);
  let head: i32 = 0;
  let tail: i32 = 0;

  for (let i: i32 = 0; i < n; i++) {
    let t = load<f64>(timePtr + (<usize>i << 3));
    let tMin = t + a;
    let tMax = t + b;

    while (right < n && load<f64>(timePtr + (<usize>right << 3)) <= tMax) {
      let v = load<f64>(valPtr + (<usize>right << 3));
      while (tail > head && load<f64>(valPtr + (<usize>deque[tail - 1] << 3)) <= v) {
        tail--;
      }
      deque[tail++] = right;
      right++;
    }

    while (head < tail && load<f64>(timePtr + (<usize>deque[head] << 3)) < tMin) {
      head++;
    }

    let maxVal = head < tail
      ? load<f64>(valPtr + (<usize>deque[head] << 3))
      : load<f64>(valPtr + (<usize>(n - 1) << 3));

    store<f64>(outPtr + (<usize>i << 3), maxVal);
  }
}

export function stl_eval_until(
  timePtr: usize,
  lPtr: usize,
  rPtr: usize,
  n: i32,
  a: f64,
  b: f64,
  outPtr: usize,
): void {
  if (n <= 0) return;

  for (let i: i32 = 0; i < n; i++) {
    let t = load<f64>(timePtr + (<usize>i << 3));
    let tMin = t + a;
    let tMax = t + b;
    let maxUntil = f64.NEGATIVE_INFINITY;
    let minL = f64.POSITIVE_INFINITY;

    let j: i32 = i;
    while (j < n && load<f64>(timePtr + (<usize>j << 3)) < tMin) {
      let lv = load<f64>(lPtr + (<usize>j << 3));
      if (lv < minL) minL = lv;
      j++;
    }

    while (j < n && load<f64>(timePtr + (<usize>j << 3)) <= tMax) {
      let lv = load<f64>(lPtr + (<usize>j << 3));
      if (lv < minL) minL = lv;
      let rv = load<f64>(rPtr + (<usize>j << 3));
      let candidate = Math.min(rv, minL);
      if (candidate > maxUntil) maxUntil = candidate;
      j++;
    }

    store<f64>(outPtr + (<usize>i << 3), maxUntil);
  }
}
