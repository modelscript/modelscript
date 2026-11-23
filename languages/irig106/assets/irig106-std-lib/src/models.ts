// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime for `@modelscript/irig106-std-lib`.
 *
 * Implements zero-allocation IRIG 106 Chapter 9 PCM frame rate calculations,
 * Horner-form polynomial engineering-unit calibration, and optimal sync word lookup.
 */

export const SYNC_16_EB90: u32 = 0xeb90;
export const SYNC_24_FAF320: u32 = 0xfaf320;
export const SYNC_32_FE6B2840: u32 = 0xfe6b2840;

/**
 * Computes PCM minor frame rate (Hz) = bitRateBps / bitsPerMinorFrame.
 */
export function irig106MinorFrameRate(bitRateBps: f64, bitsPerMinorFrame: f64): f64 {
  if (bitsPerMinorFrame <= 0.0) return 0.0;
  return bitRateBps / bitsPerMinorFrame;
}

/**
 * Computes PCM major frame rate (Hz) = minorFrameRate / minorFramesPerMajorFrame.
 */
export function irig106MajorFrameRate(bitRateBps: f64, bitsPerMinorFrame: f64, minorFramesPerMajorFrame: f64): f64 {
  if (bitsPerMinorFrame <= 0.0 || minorFramesPerMajorFrame <= 0.0) return 0.0;
  return bitRateBps / (bitsPerMinorFrame * minorFramesPerMajorFrame);
}

/**
 * Evaluates a degree-n polynomial calibration y = c0 + c1*x + ... + cn*x^n using Horner's method.
 * Coefficients are stored as contiguous f64 values starting at `coeffPtr`.
 */
export function irig106EvalPoly(coeffPtr: usize, count: i32, x: f64): f64 {
  if (count <= 0) return x;
  let acc: f64 = 0.0;
  for (let k = count - 1; k >= 0; k--) {
    const c = load<f64>(coeffPtr + (<usize>k << 3));
    acc = acc * x + c;
  }
  return acc;
}

/**
 * Returns the standard IRIG 106 Appendix C sync word for 16, 24, or 32 bits (0 otherwise).
 */
export function irig106StandardSyncWord(bits: i32): u32 {
  if (bits == 16) return SYNC_16_EB90;
  if (bits == 24) return SYNC_24_FAF320;
  if (bits == 32) return SYNC_32_FE6B2840;
  return 0;
}
