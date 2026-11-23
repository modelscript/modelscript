// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript geophysical runtime for `@modelscript/segy-std-lib`.
 *
 * Implements standard seismic wavelet synthesis (Ricker, Ormsby, Klauder) and
 * Normal Moveout (NMO) traveltime physics in WebAssembly linear memory.
 */

const PI: f64 = 3.14159265358979323846;

/**
 * Evaluates a zero-phase Ricker wavelet at time offset tau (seconds) and dominant frequency f0 (Hz).
 */
export function evalRicker(tau: f64, f0Hz: f64): f64 {
  const a = PI * PI * f0Hz * f0Hz * tau * tau;
  return (1.0 - 2.0 * a) * Math.exp(-a);
}

function sinc2(f: f64, tau: f64): f64 {
  const x = PI * f * tau;
  if (Math.abs(x) < 1e-12) return f * f;
  const s = Math.sin(x) / x;
  return f * f * s * s;
}

/**
 * Evaluates an unnormalized zero-phase Ormsby wavelet at time offset tau (seconds).
 */
export function evalOrmsby(tau: f64, f1Hz: f64, f2Hz: f64, f3Hz: f64, f4Hz: f64): f64 {
  const dHi = f4Hz - f3Hz > 1e-9 ? f4Hz - f3Hz : 1e-9;
  const dLo = f2Hz - f1Hz > 1e-9 ? f2Hz - f1Hz : 1e-9;
  const hi = (sinc2(f4Hz, tau) - sinc2(f3Hz, tau)) / dHi;
  const lo = (sinc2(f2Hz, tau) - sinc2(f1Hz, tau)) / dLo;
  return PI * (hi - lo);
}

/**
 * Evaluates a zero-phase Klauder autocorrelation wavelet at time offset tau (seconds).
 */
export function evalKlauder(tau: f64, fLowHz: f64, fHighHz: f64, sweepLenSec: f64): f64 {
  const absTau = Math.abs(tau);
  if (absTau >= sweepLenSec) return 0.0;
  const fMid = 0.5 * (fLowHz + fHighHz);
  const k = (fHighHz - fLowHz) / (sweepLenSec > 1e-9 ? sweepLenSec : 1e-9);
  const arg = PI * k * tau * (sweepLenSec - absTau);
  const env = Math.abs(arg) < 1e-12 ? 1.0 : Math.sin(arg) / arg;
  return env * Math.cos(2.0 * PI * fMid * tau);
}

/**
 * Computes hyperbolic Normal Moveout (NMO) traveltime: t(x) = sqrt(t0^2 + x^2 / v^2).
 */
export function nmoTime(t0Sec: f64, offsetM: f64, velocityMps: f64): f64 {
  const v = velocityMps > 1e-9 ? velocityMps : 1e-9;
  const r = offsetM / v;
  return Math.sqrt(t0Sec * t0Sec + r * r);
}
