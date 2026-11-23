// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime for `@modelscript/gams-std-lib`.
 *
 * Implements GAMS intrinsic set/math operators (`sum`, `prod`, `smin`, `smax`,
 * `ord`, `card`, `sameas`) and classic GAMSlib archetype cost evaluators (`trnsport`,
 * `diet`, `blend`) in zero-GC WebAssembly linear memory.
 */

// Intrinsic set / math operators over an f64 buffer at `ptr` of length `len`
export function gams_sum(ptr: usize, len: i32): f64 {
  let acc: f64 = 0.0;
  for (let i: i32 = 0; i < len; i++) {
    acc += load<f64>(ptr + (<usize>i << 3));
  }
  return acc;
}

export function gams_prod(ptr: usize, len: i32): f64 {
  if (len <= 0) return 1.0;
  let acc: f64 = 1.0;
  for (let i: i32 = 0; i < len; i++) {
    acc *= load<f64>(ptr + (<usize>i << 3));
  }
  return acc;
}

export function gams_smin(ptr: usize, len: i32): f64 {
  if (len <= 0) return 0.0;
  let best: f64 = load<f64>(ptr);
  for (let i: i32 = 1; i < len; i++) {
    const v: f64 = load<f64>(ptr + (<usize>i << 3));
    if (v < best) best = v;
  }
  return best;
}

export function gams_smax(ptr: usize, len: i32): f64 {
  if (len <= 0) return 0.0;
  let best: f64 = load<f64>(ptr);
  for (let i: i32 = 1; i < len; i++) {
    const v: f64 = load<f64>(ptr + (<usize>i << 3));
    if (v > best) best = v;
  }
  return best;
}

export function gams_ord(zeroBasedIndex: i32): i32 {
  return zeroBasedIndex >= 0 ? zeroBasedIndex + 1 : 0;
}

export function gams_card(count: i32): i32 {
  return count > 0 ? count : 0;
}

export function gams_sameas(a: i32, b: i32): i32 {
  return a == b ? 1 : 0;
}

// Classic GAMSlib archetype objective evaluators
export function gams_trnsport_cost(
  freight: f64,
  x_s_ny: f64,
  x_s_ch: f64,
  x_s_to: f64,
  x_sd_ny: f64,
  x_sd_ch: f64,
  x_sd_to: f64,
): f64 {
  const scale: f64 = freight / 1000.0;
  return (
    scale *
    (2.5 * x_s_ny + 1.7 * x_s_ch + 1.8 * x_s_to + 2.5 * x_sd_ny + 1.8 * x_sd_ch + 1.4 * x_sd_to)
  );
}

export function gams_diet_cost(c0: f64, x0: f64, c1: f64, x1: f64, c2: f64, x2: f64): f64 {
  return c0 * x0 + c1 * x1 + c2 * x2;
}

export function gams_blend_cost(c0: f64, x0: f64, c1: f64, x1: f64): f64 {
  return c0 * x0 + c1 * x1;
}
