// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript spectroscopy runtime for `@modelscript/jcamp-dx-std-lib`.
 *
 * Implements IUPAC Beer-Lambert optical absorption and Lorentzian/Gaussian line shapes
 * using the standard 2048-byte aligned slot ABI:
 *   - `0x080..0x57F`: `CON[160]` (`f64`) — parameters [center, width, amplitude, eps, pathLength]
 *   - `0x780..0x7FF`: `IO[16]`   (`f64`) — IO[0] = x, IO[1] = absorbance, IO[2] = transmittance
 */

const OFF_CON: usize = 0x080;
const OFF_IO: usize = 0x780;

const LN10: f64 = 2.302585092994046;

@inline
function getCon(slotPtr: usize, conCount: i32, idx: i32, fallback: f64): f64 {
  if (idx >= conCount) return fallback;
  const v = load<f64>(slotPtr + OFF_CON + (<usize>idx << 3));
  return isNaN(v) ? fallback : v;
}

@inline
function getIo(slotPtr: usize, idx: i32): f64 {
  return load<f64>(slotPtr + OFF_IO + (<usize>idx << 3));
}

@inline
function setIo(slotPtr: usize, idx: i32, v: f64): void {
  store<f64>(slotPtr + OFF_IO + (<usize>idx << 3), v);
}

/**
 * Evaluates Beer-Lambert absorbance `A = -log10(T)`.
 */
export function beerLambertAbsorbance(transmittance: f64): f64 {
  const t = transmittance < 1e-12 ? 1e-12 : transmittance;
  return -Math.log(t) / LN10;
}

/**
 * Evaluates Beer-Lambert transmittance `T = 10^(-A)`.
 */
export function beerLambertTransmittance(absorbance: f64): f64 {
  return Math.exp(-absorbance * LN10);
}

/**
 * Evaluates a Lorentzian absorption line shape `A * g^2 / ((x - x0)^2 + g^2)`.
 */
export function evalLorentzian(x: f64, center: f64, amplitude: f64, gamma: f64): f64 {
  const dx = x - center;
  const g2 = gamma * gamma;
  return (amplitude * g2) / (dx * dx + g2);
}

/**
 * Evaluates a Gaussian absorption line shape `A * exp(-(x - x0)^2 / (2 * sigma^2))`.
 */
export function evalGaussian(x: f64, center: f64, amplitude: f64, sigma: f64): f64 {
  const d = (x - center) / sigma;
  return amplitude * Math.exp(-0.5 * d * d);
}

/**
 * Slot-ABI entry point evaluating a spectral band at `IO[0] = x`, writing
 * `IO[1] = absorbance` and `IO[2] = transmittance`.
 */
export function jcampDxEvalBand(archetypeId: i32, slotPtr: usize, conCount: i32): void {
  const x = getIo(slotPtr, 0);
  const center = getCon(slotPtr, conCount, 0, 1715.0);
  const width = getCon(slotPtr, conCount, 1, 20.0);
  const amplitude = getCon(slotPtr, conCount, 2, 1.0);

  // Archetype 10 (broad O-H) uses Gaussian; sharp vibrational/NMR bands use Lorentzian
  const absorbance =
    archetypeId == 10
      ? evalGaussian(x, center, amplitude, width)
      : evalLorentzian(x, center, amplitude, width);

  setIo(slotPtr, 1, absorbance);
  setIo(slotPtr, 2, beerLambertTransmittance(absorbance));
}
