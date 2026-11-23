// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fits — Astronomical Image Statistics, Aperture Photometry & Radiative Physics.
 *
 * Provides:
 * - Mean, median, standard deviation, and iterative sigma-clipped background RMS
 * - Circular aperture photometry with annular sky background subtraction
 * - Instrumental / AB magnitude calibration
 * - Planck blackbody spectral radiance B_lambda(T), B_nu(T), and Stefan-Boltzmann flux
 * - Synthetic 2D Gaussian PSF image generator for verification & benchmarking
 */

import type { AperturePhotometryResult, ImageStatistics } from "../types.js";

/** Planck constant (J s). */
export const H_PLANCK = 6.62607015e-34;
/** Speed of light in vacuum (m / s). */
export const C_LIGHT = 2.99792458e8;
/** Boltzmann constant (J / K). */
export const K_BOLTZMANN = 1.380649e-23;
/** Stefan-Boltzmann constant (W m^-2 K^-4). */
export const SIGMA_SB = 5.670374419e-8;

/**
 * Computes descriptive and iterative sigma-clipped statistics for a 1D/2D FITS image buffer.
 */
export function computeImageStatistics(
  data: Float64Array | number[],
  sigmaClip = 3.0,
  maxIterations = 5,
): ImageStatistics {
  const finite: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (Number.isFinite(v)) finite.push(v);
  }

  if (finite.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      stdDev: 0,
      clippedMean: 0,
      clippedRms: 0,
      clippedCount: 0,
    };
  }

  const sorted = [...finite].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0]!;
  const max = sorted[count - 1]!;
  const mid = Math.floor(count / 2);
  const median = count % 2 === 1 ? sorted[mid]! : 0.5 * (sorted[mid - 1]! + sorted[mid]!);

  let sum = 0;
  for (let i = 0; i < count; i++) sum += sorted[i]!;
  const mean = sum / count;

  let varSum = 0;
  for (let i = 0; i < count; i++) {
    const d = sorted[i]! - mean;
    varSum += d * d;
  }
  const stdDev = Math.sqrt(varSum / count);

  // Iterative sigma clipping
  let clipped = sorted;
  let clippedMean = mean;
  let clippedRms = stdDev;

  for (let iter = 0; iter < maxIterations; iter++) {
    if (clippedRms === 0 || clipped.length < 3) break;
    const lo = clippedMean - sigmaClip * clippedRms;
    const hi = clippedMean + sigmaClip * clippedRms;
    const next = clipped.filter((v) => v >= lo && v <= hi);
    if (next.length === clipped.length || next.length === 0) break;
    clipped = next;

    let cSum = 0;
    for (let i = 0; i < clipped.length; i++) cSum += clipped[i]!;
    clippedMean = cSum / clipped.length;

    let cVar = 0;
    for (let i = 0; i < clipped.length; i++) {
      const d = clipped[i]! - clippedMean;
      cVar += d * d;
    }
    clippedRms = Math.sqrt(cVar / clipped.length);
  }

  return {
    count,
    min,
    max,
    mean,
    median,
    stdDev,
    clippedMean,
    clippedRms,
    clippedCount: clipped.length,
  };
}

/**
 * Performs circular aperture photometry with annular sky subtraction on a 2D image.
 * Pixel centers are indexed in 0-based coordinates `(x, y)` where `x in [0, width-1]`, `y in [0, height-1]`.
 */
export function aperturePhotometry(
  data: Float64Array | number[],
  width: number,
  height: number,
  cx: number,
  cy: number,
  apertureRadius: number,
  skyInnerRadius?: number,
  skyOuterRadius?: number,
  zeroPoint = 25.0,
): AperturePhotometryResult {
  const rAp2 = apertureRadius * apertureRadius;
  const rIn = skyInnerRadius ?? apertureRadius * 1.5;
  const rOut = skyOuterRadius ?? apertureRadius * 2.5;
  const rIn2 = rIn * rIn;
  const rOut2 = rOut * rOut;

  let grossFlux = 0;
  let aperturePixels = 0;
  const skySamples: number[] = [];

  const xMin = Math.max(0, Math.floor(cx - rOut - 1));
  const xMax = Math.min(width - 1, Math.ceil(cx + rOut + 1));
  const yMin = Math.max(0, Math.floor(cy - rOut - 1));
  const yMax = Math.min(height - 1, Math.ceil(cy + rOut + 1));

  for (let y = yMin; y <= yMax; y++) {
    const dy = y - cy;
    const rowOff = y * width;
    for (let x = xMin; x <= xMax; x++) {
      const dx = x - cx;
      const dist2 = dx * dx + dy * dy;
      const val = data[rowOff + x]!;
      if (!Number.isFinite(val)) continue;
      if (dist2 <= rAp2) {
        grossFlux += val;
        aperturePixels++;
      } else if (dist2 >= rIn2 && dist2 <= rOut2) {
        skySamples.push(val);
      }
    }
  }

  const skyStats = computeImageStatistics(skySamples, 3.0, 5);
  const skyPerPixel = skySamples.length > 0 ? skyStats.clippedMean : 0;
  const skyRms = skySamples.length > 0 ? skyStats.clippedRms : 0;
  const netFlux = grossFlux - skyPerPixel * aperturePixels;

  const noise = Math.sqrt(Math.max(0, netFlux) + aperturePixels * skyRms * skyRms);
  const snr = noise > 0 ? netFlux / noise : 0;
  const magnitude = netFlux > 0 ? fluxToMagnitude(netFlux, zeroPoint) : Number.POSITIVE_INFINITY;

  return {
    cx,
    cy,
    apertureRadius,
    skyInnerRadius: rIn,
    skyOuterRadius: rOut,
    grossFlux,
    netFlux,
    skyPerPixel,
    skyRms,
    aperturePixels,
    skyPixels: skySamples.length,
    snr,
    magnitude,
  };
}

/**
 * Converts a positive linear flux to astronomical magnitude: `m = zeroPoint - 2.5 * log10(flux)`.
 */
export function fluxToMagnitude(flux: number, zeroPoint = 0.0): number {
  if (flux <= 0) {
    throw new RangeError("Flux must be strictly positive to compute magnitude.");
  }
  return zeroPoint - 2.5 * Math.log10(flux);
}

/**
 * Converts astronomical magnitude to linear flux: `F = 10^(-0.4 * (m - zeroPoint))`.
 */
export function magnitudeToFlux(magnitude: number, zeroPoint = 0.0): number {
  return Math.pow(10.0, -0.4 * (magnitude - zeroPoint));
}

/**
 * Computes AB magnitude from spectral flux density `fNuJy` in Janskys (1 Jy = 10^-26 W m^-2 Hz^-1).
 * Standard AB zero point: `m_AB = -2.5 * log10(f_nu / 3631 Jy)`.
 */
export function janskyToAbMagnitude(fNuJy: number): number {
  if (fNuJy <= 0) {
    throw new RangeError("Flux density in Janskys must be strictly positive.");
  }
  return -2.5 * Math.log10(fNuJy / 3631.0);
}

/**
 * Planck blackbody spectral radiance `B_lambda(T)` in `W sr^-1 m^-3` at wavelength `lambdaMeters` (m)
 * and temperature `temperatureK` (K).
 */
export function planckRadianceWavelength(lambdaMeters: number, temperatureK: number): number {
  if (lambdaMeters <= 0 || temperatureK <= 0) {
    throw new RangeError("Wavelength and temperature must be strictly positive.");
  }
  const exponent = (H_PLANCK * C_LIGHT) / (lambdaMeters * K_BOLTZMANN * temperatureK);
  const c1 = 2.0 * H_PLANCK * C_LIGHT * C_LIGHT;
  return c1 / (Math.pow(lambdaMeters, 5) * Math.expm1(exponent));
}

/**
 * Planck blackbody spectral radiance `B_nu(T)` in `W sr^-1 m^-2 Hz^-1` at frequency `freqHz` (Hz)
 * and temperature `temperatureK` (K).
 */
export function planckRadianceFrequency(freqHz: number, temperatureK: number): number {
  if (freqHz <= 0 || temperatureK <= 0) {
    throw new RangeError("Frequency and temperature must be strictly positive.");
  }
  const exponent = (H_PLANCK * freqHz) / (K_BOLTZMANN * temperatureK);
  const c1 = (2.0 * H_PLANCK * Math.pow(freqHz, 3)) / (C_LIGHT * C_LIGHT);
  return c1 / Math.expm1(exponent);
}

/**
 * Stefan-Boltzmann bolometric surface flux `F = sigma * T^4` in `W m^-2`.
 */
export function stefanBoltzmannFlux(temperatureK: number): number {
  if (temperatureK < 0) {
    throw new RangeError("Temperature must be non-negative.");
  }
  const t2 = temperatureK * temperatureK;
  return SIGMA_SB * t2 * t2;
}

/**
 * Generates a synthetic 2D Gaussian Point Spread Function (PSF) image with optional flat sky background.
 * Total integrated continuous flux of the 2D Gaussian is `totalFlux`:
 *   `I(x, y) = skyLevel + (totalFlux / (2 * pi * sigma^2)) * exp(-((x - cx)^2 + (y - cy)^2) / (2 * sigma^2))`
 */
export function generateGaussianPsfImage(
  width: number,
  height: number,
  cx: number,
  cy: number,
  sigma: number,
  totalFlux: number,
  skyLevel = 0.0,
): Float64Array {
  const out = new Float64Array(width * height);
  const norm = totalFlux / (2.0 * Math.PI * sigma * sigma);
  const inv2Sigma2 = 1.0 / (2.0 * sigma * sigma);

  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      out[rowOff + x] = skyLevel + norm * Math.exp(-(dx * dx + dy * dy) * inv2Sigma2);
    }
  }
  return out;
}
