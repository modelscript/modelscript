// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ISO 2631-1 & EN 12299 Railway Passenger Ride Comfort & Health Assessment Engine.
 *
 * Implements:
 * - Sperling's ride index Wz for railway vehicles.
 * - ISO 2631-1 frequency weighting filters:
 *     - Wk for vertical vibration (0.4 Hz - 100 Hz, peak sensitivity 4-12.5 Hz)
 *     - Wd for lateral & longitudinal vibration (0.4 Hz - 100 Hz, peak sensitivity 0.5-2 Hz)
 *     - Wb for seated person spine vibration
 * - EN 12299 Mean Comfort Index (N_MV) with standard comfort scale classification.
 * - Vibration Dose Value (VDV) and Crest Factor metrics.
 */

export interface Iso2631AxisAssessment {
  rmsUnweighted: number; // Raw unweighted RMS acceleration [m/s^2]
  rmsWeighted: number; // Frequency-weighted RMS acceleration [m/s^2]
  peakWeighted: number; // Peak frequency-weighted acceleration [m/s^2]
  crestFactor: number; // Peak / RMS ratio
  vdv: number; // Vibration Dose Value [m/s^1.75]
  percentile95: number; // 95th percentile weighted acceleration [m/s^2]
  sperlingWz: number; // Sperling ride index Wz
}

export type En12299ComfortRating = "Very Good" | "Good" | "Medium" | "Poor" | "Very Poor";

export interface En12299ComfortReport {
  nmv: number; // Mean comfort index N_MV = 6 * sqrt(awx_95^2 + awy_95^2 + awz_95^2)
  comfortRating: En12299ComfortRating;
  description: string;
}

export interface Iso2631Assessment {
  durationSec: number;
  sampleCount: number;
  vertical: Iso2631AxisAssessment;
  lateral: Iso2631AxisAssessment;
  longitudinal?: Iso2631AxisAssessment | undefined;
  en12299: En12299ComfortReport;
}

/**
 * Calculates Sperling's ride comfort index Wz for railway vehicles:
 *   Wz = (a^3 * B(f)^3)^{1/10} = (a * B(f))^0.3
 * where:
 *   a = acceleration amplitude [cm/s^2]
 *   f = frequency [Hz]
 *   B(f) = frequency weighting factor for human sensitivity
 */
export function calculateSperlingRideIndex(
  accelerationMPerS2: number,
  frequencyHz: number,
  direction: "vertical" | "horizontal" = "vertical",
): number {
  if (accelerationMPerS2 <= 0 || frequencyHz <= 0) return 1.0;

  // Convert m/s^2 to cm/s^2
  const a = accelerationMPerS2 * 100;
  const f = frequencyHz;

  // Frequency weighting factor B(f) per Sperling
  let B: number;
  if (direction === "vertical") {
    if (f < 0.5) B = 0;
    else if (f <= 5.9) B = 0.588 * Math.sqrt(1.911 * f * f + 0.25 * (f * f - 1) * (f * f - 1));
    else if (f <= 20) B = (1 / f) * 1.911 * Math.sqrt(2 * f);
    else B = 125 / (f * f);
  } else {
    // Horizontal weighting
    if (f < 0.5) B = 0;
    else if (f <= 5.4) B = 0.743 * Math.sqrt(1.911 * f * f + 0.25 * (f * f - 1) * (f * f - 1));
    else if (f <= 26) B = (1 / f) * 2.5 * Math.sqrt(2 * f);
    else B = 100 / (f * f);
  }

  // Wz = 0.896 * (a^3 * B^3)^(1/10) (standard formula scaling)
  const wz = 0.896 * Math.pow(Math.max(1e-9, a * B), 0.3);
  return Math.max(1.0, wz);
}

/**
 * Evaluates the exact continuous ISO 2631-1 & ISO 8041 frequency weighting factor |H(j*2*pi*f)|.
 *
 * @param frequencyHz Frequency in Hz.
 * @param filter Weighting filter: "Wk" (vertical), "Wd" (lateral/longitudinal), "Wb" (seat back).
 */
export function getIso2631WeightingFactor(frequencyHz: number, filter: "Wk" | "Wd" | "Wb" = "Wk"): number {
  if (frequencyHz <= 0.01) return 0.0;
  const f = frequencyHz;
  const omega = 2 * Math.PI * f;

  // Band-limiting filter: 0.4 Hz to 100 Hz (f1 = 0.4, f2 = 100)
  const w1 = 2 * Math.PI * 0.4;
  const w2 = 2 * Math.PI * 100.0;

  const w1_4 = Math.pow(w1, 4);
  const w2_4 = Math.pow(w2, 4);
  const w_4 = Math.pow(omega, 4);

  const hb = ((omega * omega) / Math.sqrt(w1_4 + w_4)) * ((w2 * w2) / Math.sqrt(w2_4 + w_4));

  if (filter === "Wk" || filter === "Wb") {
    // Vertical filter Wk:
    // Transition: f3 = 12.5 Hz, f4 = 12.5 Hz, Q4 = 0.63
    const w3 = 2 * Math.PI * 12.5;
    const w4 = 2 * Math.PI * 12.5;
    const q4 = 0.63;

    const numV = Math.sqrt(omega * omega + w3 * w3) / w3;
    const denV = Math.sqrt(Math.pow(w4 * w4 - omega * omega, 2) + Math.pow((omega * w4) / q4, 2));
    const hv = (numV * (w4 * w4)) / denV;

    // Upward step: f5 = 2.37 Hz, Q5 = 0.91; f6 = 3.3 Hz, Q6 = 0.91
    const w5 = 2 * Math.PI * 2.37;
    const q5 = 0.91;
    const w6 = 2 * Math.PI * 3.3;
    const q6 = 0.91;

    const numS = Math.sqrt(Math.pow(w5 * w5 - omega * omega, 2) + Math.pow((omega * w5) / q5, 2));
    const denS = Math.sqrt(Math.pow(w6 * w6 - omega * omega, 2) + Math.pow((omega * w6) / q6, 2));
    const hs = numS / denS;

    return hb * hv * hs;
  } else {
    // Horizontal / Lateral filter Wd:
    // Transition: f3 = 2.0 Hz, f4 = 2.0 Hz, Q4 = 0.63
    const w3 = 2 * Math.PI * 2.0;
    const w4 = 2 * Math.PI * 2.0;
    const q4 = 0.63;

    const numV = Math.sqrt(omega * omega + w3 * w3) / w3;
    const denV = Math.sqrt(Math.pow(w4 * w4 - omega * omega, 2) + Math.pow((omega * w4) / q4, 2));
    const hv = (numV * (w4 * w4)) / denV;

    return hb * hv;
  }
}

/**
 * Radix-2 Cooley-Tukey FFT implementation.
 */
function nextPowerOfTwo(val: number): number {
  let p = 1;
  while (p < val) p <<= 1;
  return p;
}

function fftRadix2(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tempR = re[i]!;
      re[i] = re[j]!;
      re[j] = tempR;
      const tempI = im[i]!;
      im[i] = im[j]!;
      im[j] = tempI;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angleStep = ((inverse ? 2.0 : -2.0) * Math.PI) / len;
    const wStepR = Math.cos(angleStep);
    const wStepI = Math.sin(angleStep);

    for (let i = 0; i < n; i += len) {
      let wR = 1.0;
      let wI = 0.0;
      for (let k = 0; k < halfLen; k++) {
        const uR = re[i + k]!;
        const uI = im[i + k]!;
        const pos = i + k + halfLen;
        const vR = re[pos]! * wR - im[pos]! * wI;
        const vI = re[pos]! * wI + im[pos]! * wR;

        re[i + k] = uR + vR;
        im[i + k] = uI + vI;
        re[pos] = uR - vR;
        im[pos] = uI - vI;

        const nextWR = wR * wStepR - wI * wStepI;
        const nextWI = wR * wStepI + wI * wStepR;
        wR = nextWR;
        wI = nextWI;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! / n;
      im[i] = im[i]! / n;
    }
  }
}

/**
 * Applies ISO 2631-1 zero-phase frequency weighting filter (Wk or Wd) to an acceleration time-series.
 */
export function applyIso2631Filter(
  timeSec: Float64Array,
  acceleration: Float64Array,
  filter: "Wk" | "Wd" | "Wb" = "Wk",
): Float64Array {
  const n = acceleration.length;
  if (n < 4) {
    return new Float64Array(acceleration);
  }

  const dt = (timeSec[n - 1]! - timeSec[0]!) / (n - 1);
  const nFft = nextPowerOfTwo(n);
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);

  // Copy acceleration into real array, window padding with end values
  for (let i = 0; i < n; i++) {
    re[i] = acceleration[i]!;
  }
  const padVal = acceleration[n - 1]!;
  for (let i = n; i < nFft; i++) {
    re[i] = padVal;
  }

  fftRadix2(re, im, false);

  const half = nFft >> 1;
  for (let k = 0; k <= half; k++) {
    const freq = k / (nFft * dt);
    const weight = getIso2631WeightingFactor(freq, filter);

    re[k] = re[k]! * weight;
    im[k] = im[k]! * weight;

    if (k > 0 && k < half) {
      const symm = nFft - k;
      re[symm] = re[symm]! * weight;
      im[symm] = im[symm]! * weight;
    }
  }

  fftRadix2(re, im, true);

  const filtered = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    filtered[i] = re[i]!;
  }
  return filtered;
}

function calculateRms(arr: Float64Array): number {
  if (arr.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]!;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / arr.length);
}

function calculatePercentile95(arr: Float64Array): number {
  if (arr.length === 0) return 0;
  const absValues = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    absValues[i] = Math.abs(arr[i]!);
  }
  absValues.sort();
  const idx = Math.min(arr.length - 1, Math.floor(0.95 * arr.length));
  return absValues[idx]!;
}

function calculateVdv(arr: Float64Array, dt: number): number {
  if (arr.length === 0) return 0;
  let sum4 = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]!;
    sum4 += v * v * v * v;
  }
  return Math.pow(sum4 * dt, 0.25);
}

function calculateAxisAssessment(
  timeSec: Float64Array,
  rawAccel: Float64Array,
  filter: "Wk" | "Wd",
): Iso2631AxisAssessment {
  const n = timeSec.length;
  const dt = n > 1 ? (timeSec[n - 1]! - timeSec[0]!) / (n - 1) : 0.01;

  const rmsUnweighted = calculateRms(rawAccel);
  const weighted = applyIso2631Filter(timeSec, rawAccel, filter);
  const rmsWeighted = calculateRms(weighted);

  let peakWeighted = 0;
  for (let i = 0; i < n; i++) {
    const absVal = Math.abs(weighted[i]!);
    if (absVal > peakWeighted) peakWeighted = absVal;
  }

  const crestFactor = rmsWeighted > 1e-6 ? peakWeighted / rmsWeighted : 1.0;
  const vdv = calculateVdv(weighted, dt);
  const percentile95 = calculatePercentile95(weighted);

  // Sperling's Wz from weighted RMS acceleration: Wz = 0.896 * (a_cm/s^2 * 1.0)^0.3
  const aCm = rmsWeighted * 100.0;
  const sperlingWz = aCm > 0.001 ? 0.896 * Math.pow(aCm, 0.3) : 1.0;

  return {
    rmsUnweighted,
    rmsWeighted,
    peakWeighted,
    crestFactor,
    vdv,
    percentile95,
    sperlingWz: Math.max(1.0, sperlingWz),
  };
}

/**
 * Evaluates EN 12299 Mean Comfort Index N_MV and comfort rating from 95th percentile weighted accelerations.
 */
export function classifyEn12299Comfort(nmv: number): {
  comfortRating: En12299ComfortRating;
  description: string;
} {
  if (nmv < 1.5) {
    return { comfortRating: "Very Good", description: "Very comfortable; imperceptible vibration." };
  } else if (nmv < 2.5) {
    return { comfortRating: "Good", description: "Comfortable; vibrations barely noticeable." };
  } else if (nmv < 3.5) {
    return { comfortRating: "Medium", description: "Moderate comfort; vibrations clearly perceptible." };
  } else if (nmv < 4.5) {
    return { comfortRating: "Poor", description: "Uncomfortable; prolonged travel causes fatigue." };
  } else {
    return { comfortRating: "Very Poor", description: "Very uncomfortable; unacceptable vibration levels." };
  }
}

/**
 * Full ISO 2631-1 and EN 12299 Ride Comfort and Vibration Health Assessment.
 *
 * @param timeSec Time vector in seconds.
 * @param accelerations Multi-axis accelerations: vertical (Z), lateral (Y), optional longitudinal (X).
 */
export function evaluateIso2631RideComfort(
  timeSec: Float64Array,
  accelerations: {
    vertical: Float64Array;
    lateral: Float64Array;
    longitudinal?: Float64Array | undefined;
  },
): Iso2631Assessment {
  const n = timeSec.length;
  const durationSec = n > 1 ? timeSec[n - 1]! - timeSec[0]! : 0;

  const vertical = calculateAxisAssessment(timeSec, accelerations.vertical, "Wk");
  const lateral = calculateAxisAssessment(timeSec, accelerations.lateral, "Wd");

  let longitudinal: Iso2631AxisAssessment | undefined;
  let ax95Sq = 0;

  if (accelerations.longitudinal && accelerations.longitudinal.length === n) {
    longitudinal = calculateAxisAssessment(timeSec, accelerations.longitudinal, "Wd");
    ax95Sq = longitudinal.percentile95 * longitudinal.percentile95;
  }

  const ay95Sq = lateral.percentile95 * lateral.percentile95;
  const az95Sq = vertical.percentile95 * vertical.percentile95;

  // EN 12299 Mean Comfort Index: N_MV = 6 * sqrt(ax_95^2 + ay_95^2 + az_95^2)
  const nmv = 6.0 * Math.sqrt(ax95Sq + ay95Sq + az95Sq);
  const ratingInfo = classifyEn12299Comfort(nmv);

  return {
    durationSec,
    sampleCount: n,
    vertical,
    lateral,
    longitudinal,
    en12299: {
      nmv,
      comfortRating: ratingInfo.comfortRating,
      description: ratingInfo.description,
    },
  };
}
