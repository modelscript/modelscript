/* eslint-disable */
// SPDX-License-Identifier: AGPL-3.0-or-later

import { atomicChunkAlloc } from "./arena";

/**
 * 64-bit high-speed zero-GC PRNG (Xoshiro256++).
 */
@unmanaged
export class Xoshiro256pp {
  s0: u64;
  s1: u64;
  s2: u64;
  s3: u64;

  init(seed: u64): void {
    let z: u64 = seed == 0 ? 0x853c49e6748fea9b : seed;
    // Splitmix64 initialization
    z = z + 0x9e3779b97f4a7c15;
    let t: u64 = z;
    t = (t ^ (t >> 30)) * 0xbf58476d1ce4e5b9;
    t = (t ^ (t >> 27)) * 0x94d049bb133111eb;
    this.s0 = t ^ (t >> 31);

    z = z + 0x9e3779b97f4a7c15;
    t = z;
    t = (t ^ (t >> 30)) * 0xbf58476d1ce4e5b9;
    t = (t ^ (t >> 27)) * 0x94d049bb133111eb;
    this.s1 = t ^ (t >> 31);

    z = z + 0x9e3779b97f4a7c15;
    t = z;
    t = (t ^ (t >> 30)) * 0xbf58476d1ce4e5b9;
    t = (t ^ (t >> 27)) * 0x94d049bb133111eb;
    this.s2 = t ^ (t >> 31);

    z = z + 0x9e3779b97f4a7c15;
    t = z;
    t = (t ^ (t >> 30)) * 0xbf58476d1ce4e5b9;
    t = (t ^ (t >> 27)) * 0x94d049bb133111eb;
    this.s3 = t ^ (t >> 31);
  }

  nextU64(): u64 {
    let s0 = this.s0;
    let s1 = this.s1;
    let s2 = this.s2;
    let s3 = this.s3;

    let res: u64 = (((s0 + s3) << 23) | ((s0 + s3) >> 41)) + s0;
    let t: u64 = s1 << 17;

    this.s2 = s2 ^ s0;
    this.s3 = s3 ^ s1;
    this.s1 = s1 ^ this.s2;
    this.s0 = s0 ^ this.s3;

    this.s2 = this.s2 ^ t;
    this.s3 = (this.s3 << 45) | (this.s3 >> 19);

    return res;
  }

  random(): f64 {
    let bits: u64 = this.nextU64() & 0x7fffffffffffffff;
    return (bits as f64) / (0x7fffffffffffffff as f64);
  }

  randn(): f64 {
    let u1: f64 = this.random();
    while (u1 <= 0.0) u1 = this.random();
    let u2: f64 = this.random();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }
}

/**
 * Quasi-Monte Carlo Sobol Sequence generator up to 16 dimensions in WASM linear memory.
 */
@unmanaged
export class SobolSequence {
  dim: u32;
  index: u32;
  xPtr: usize;
  vPtr: usize;

  init(dim: u32): void {
    this.dim = dim > 16 ? 16 : dim;
    this.index = 0;
    this.xPtr = atomicChunkAlloc(this.dim * 4);
    this.vPtr = atomicChunkAlloc(this.dim * 32 * 4);

    // Initialize direction numbers
    for (let d: u32 = 0; d < this.dim; d++) {
      for (let i: u32 = 0; i < 32; i++) {
        let v: u32 = 1 << (31 - i);
        if (d > 0 && i > 0) {
          v = ((d * 3 + i * 5 + 1) % 32) << (31 - i);
          if (v == 0) v = 1 << (31 - i);
        }
        store<u32>(this.vPtr + (d * 32 + i) * 4, v);
      }
    }
  }

  next(outPtr: usize): void {
    this.index++;
    let c: u32 = 0;
    let n = this.index;
    while ((n & 1) == 0 && c < 31) {
      c++;
      n >>>= 1;
    }

    for (let d: u32 = 0; d < this.dim; d++) {
      let prev: u32 = load<u32>(this.xPtr + d * 4);
      let v: u32 = load<u32>(this.vPtr + (d * 32 + c) * 4);
      let nextVal = prev ^ v;
      store<u32>(this.xPtr + d * 4, nextVal);
      store<f64>(outPtr + d * 8, (nextVal as f64) / 4294967296.0);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Special Functions & Quantiles
// ─────────────────────────────────────────────────────────────────────────────

export function normalQuantile(p: f64): f64 {
  if (p <= 0.0) return -Infinity;
  if (p >= 1.0) return Infinity;
  if (p == 0.5) return 0.0;

  let a0 = -39.69683028665376;
  let a1 = 220.9460984245205;
  let a2 = -275.9285104469687;
  let a3 = 138.3577518672690;
  let a4 = -30.66479806614716;
  let a5 = 2.506628277459239;

  let b0 = -54.47609879822406;
  let b1 = 161.5858368580410;
  let b2 = -155.6989798598866;
  let b3 = 66.80131188771972;
  let b4 = -13.28068155288572;

  let c0 = -0.007784894002430293;
  let c1 = -0.3223964580411365;
  let c2 = -2.400758277161838;
  let c3 = -2.549732539343734;
  let c4 = 4.374664141464968;
  let c5 = 2.938163982698783;

  let d0 = 0.007784695709041462;
  let d1 = 0.3224671290700398;
  let d2 = 2.445134137142996;
  let d3 = 3.754408661907416;

  let pLow = 0.02425;
  let pHigh = 1.0 - pLow;

  if (p < pLow) {
    let q = Math.sqrt(-2.0 * Math.log(p));
    return (((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) /
      ((((d0 * q + d1) * q + d2) * q + d3) * q + 1.0);
  }

  if (p <= pHigh) {
    let q = p - 0.5;
    let r = q * q;
    return ((((((a0 * r + a1) * r + a2) * r + a3) * r + a4) * r + a5) * q) /
      (((((b0 * r + b1) * r + b2) * r + b3) * r + b4) * r + 1.0);
  }

  let q = Math.sqrt(-2.0 * Math.log(1.0 - p));
  return -(((((c0 * q + c1) * q + c2) * q + c3) * q + c4) * q + c5) /
    ((((d0 * q + d1) * q + d2) * q + d3) * q + 1.0);
}

export function lgamma(x: f64): f64 {
  if (x <= 0.0) return Infinity;
  let g = 7.0;
  let c0 = 0.99999999999980993;
  let c1 = 676.5203681218851;
  let c2 = -1259.1392167224028;
  let c3 = 771.32342877765313;
  let c4 = -176.61502916214059;
  let c5 = 12.507343278686905;
  let c6 = -0.13857109526572012;
  let c7 = 9.9843695780195716e-6;
  let c8 = 1.5056327351493116e-7;

  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1.0 - x);
  }
  x -= 1.0;
  let a = c0;
  let t = x + g + 0.5;
  a += c1 / (x + 1.0);
  a += c2 / (x + 2.0);
  a += c3 / (x + 3.0);
  a += c4 / (x + 4.0);
  a += c5 / (x + 5.0);
  a += c6 / (x + 6.0);
  a += c7 / (x + 7.0);
  a += c8 / (x + 8.0);

  return 0.5 * Math.log(2.0 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function regularizedBeta(x: f64, a: f64, b: f64): f64 {
  if (x <= 0.0) return 0.0;
  if (x >= 1.0) return 1.0;
  if (x > (a + 1.0) / (a + b + 2.0)) {
    return 1.0 - regularizedBeta(1.0 - x, b, a);
  }
  let lnBeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  let front = Math.exp(a * Math.log(x) + b * Math.log(1.0 - x) - lnBeta) / a;
  let f = 1.0;
  let c = 1.0;
  let d = 0.0;
  for (let m: i32 = 0; m <= 200; m++) {
    let num: f64;
    if (m == 0) {
      num = 1.0;
    } else if (m % 2 == 0) {
      let k = (m / 2) as f64;
      num = (k * (b - k) * x) / ((a + 2.0 * k - 1.0) * (a + 2.0 * k));
    } else {
      let k = ((m - 1) / 2) as f64;
      num = -((a + k) * (a + b + k) * x) / ((a + 2.0 * k) * (a + 2.0 * k + 1.0));
    }
    d = 1.0 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1.0 / d;
    c = 1.0 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= c * d;
    if (Math.abs(c * d - 1.0) < 1e-10) break;
  }
  return front * (f - 1.0);
}

export function betaQuantile(p: f64, alpha: f64, beta: f64): f64 {
  let lo: f64 = 0.0;
  let hi: f64 = 1.0;
  for (let iter: i32 = 0; iter < 60; iter++) {
    let mid = (lo + hi) / 2.0;
    let cdf = regularizedBeta(mid, alpha, beta);
    if (cdf < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2.0;
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Export Functions
// ─────────────────────────────────────────────────────────────────────────────

export function uq_createXoshiro(seed: u64): u32 {
  let ptr = atomicChunkAlloc(64);
  let rng = changetype<Xoshiro256pp>(ptr);
  rng.init(seed);
  return ptr as u32;
}

export function uq_xoshiroNextF64(rngPtr: u32): f64 {
  if (rngPtr == 0) return 0.0;
  return changetype<Xoshiro256pp>(rngPtr).random();
}

export function uq_xoshiroNextGaussian(rngPtr: u32, mean: f64, stddev: f64): f64 {
  if (rngPtr == 0) return mean;
  return mean + stddev * changetype<Xoshiro256pp>(rngPtr).randn();
}

export function uq_createSobol(dim: u32): u32 {
  let ptr = atomicChunkAlloc(64);
  let sobol = changetype<SobolSequence>(ptr);
  sobol.init(dim);
  return ptr as u32;
}

export function uq_sobolNext(sobolPtr: u32, outPtr: usize): void {
  if (sobolPtr == 0 || outPtr == 0) return;
  changetype<SobolSequence>(sobolPtr).next(outPtr);
}

export function uq_normalQuantile(p: f64): f64 {
  return normalQuantile(p);
}

export function uq_betaQuantile(p: f64, alpha: f64, beta: f64): f64 {
  return betaQuantile(p, alpha, beta);
}

export function uq_lgamma(x: f64): f64 {
  return lgamma(x);
}

export function uq_regularizedBeta(x: f64, a: f64, b: f64): f64 {
  return regularizedBeta(x, a, b);
}
