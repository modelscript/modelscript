// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Exact IBM System/360 32-bit hexadecimal floating-point ↔ IEEE-754 float32 codec
 * for SEG-Y Sample Format Code 1.
 *
 * IBM 32-bit float layout (big-endian):
 *   Bit 31     : sign s (0 = positive, 1 = negative)
 *   Bits 30..24: 7-bit base-16 exponent e (excess-64 bias, exp16 = e - 64)
 *   Bits 23..0 : 24-bit unsigned fractional mantissa f (value = f / 2^24)
 *
 *   value = (-1)^s * (f / 2^24) * 16^(e - 64)
 */

const TWO_POW_24 = 16777216; // 2^24

/**
 * Decodes a 32-bit unsigned integer holding an IBM System/360 float into a JS number (IEEE-754).
 */
export function ibmFloatToIeee(ibmBits: number): number {
  const u = ibmBits >>> 0;
  const fraction = u & 0x00ffffff;
  if (fraction === 0) return 0;

  const sign = u >>> 31 !== 0 ? -1 : 1;
  const exponent16 = ((u >>> 24) & 0x7f) - 64;
  return sign * (fraction / TWO_POW_24) * Math.pow(16, exponent16);
}

/**
 * Encodes an IEEE-754 floating-point number into a 32-bit unsigned integer in IBM System/360 format.
 */
export function ieeeToIbmFloat(value: number): number {
  if (value === 0 || Number.isNaN(value)) return 0;

  const signBit = value < 0 ? 0x80000000 : 0;
  const abs = Math.abs(value);

  if (!Number.isFinite(abs)) {
    return (signBit | 0x7fffffff) >>> 0;
  }

  // Find base-16 exponent exp16 such that abs / 16^exp16 is in [1/16, 1)
  const exp2 = Math.floor(Math.log2(abs));
  let exp16 = Math.floor(exp2 / 4) + 1;
  let mantissa = Math.round(abs * Math.pow(2, 24 - 4 * exp16));

  // Normalize if rounding carried into bit 24
  while (mantissa >= TWO_POW_24) {
    mantissa = Math.round(mantissa / 16);
    exp16++;
  }
  while (mantissa > 0 && mantissa < 0x100000) {
    mantissa <<= 4;
    exp16--;
  }

  const biasedExp = exp16 + 64;
  if (biasedExp < 0) {
    return 0; // Underflow to zero
  }
  if (biasedExp > 127) {
    return (signBit | 0x7fffffff) >>> 0; // Overflow clamp
  }

  return (signBit | ((biasedExp & 0x7f) << 24) | (mantissa & 0x00ffffff)) >>> 0;
}

/**
 * Decodes `count` big-endian IBM 32-bit floats from a DataView starting at `byteOffset`.
 */
export function decodeIbmFloatArray(view: DataView, byteOffset: number, count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = ibmFloatToIeee(view.getUint32(byteOffset + i * 4, false));
  }
  return out;
}

/**
 * Encodes a Float32Array (or number[]) into big-endian IBM 32-bit floats in a DataView.
 */
export function encodeIbmFloatArray(samples: ArrayLike<number>, view: DataView, byteOffset: number): void {
  for (let i = 0; i < samples.length; i++) {
    view.setUint32(byteOffset + i * 4, ieeeToIbmFloat(samples[i]!), false);
  }
}
