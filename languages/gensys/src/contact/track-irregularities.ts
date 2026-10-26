// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Power Spectral Density (PSD) Track Irregularity Synthesizer.
 *
 * Implements:
 * - ERRI / ORE B176 European standard track irregularity PSD formulations
 *   (High Quality, Low Quality, High Speed).
 * - US Federal Railroad Administration (FRA) Track Classes 1 through 6.
 * - Spectral representation method (superposition of random spatial harmonics).
 * - Deterministic PRNG seeded generation for repeatable simulation and testing.
 * - GENSYS/SIMPACK (.trax / .geom) export formatting.
 */

import type { TrackGeometry, TrackIrregularityPoint } from "../types.js";

export type TrackStandard = "ERRI_B176" | "FRA";

export type TrackQualityLevel =
  | "high"
  | "low"
  | "high_speed"
  | "fra_class_1"
  | "fra_class_2"
  | "fra_class_3"
  | "fra_class_4"
  | "fra_class_5"
  | "fra_class_6";

export interface TrackPsdSpecification {
  standard: TrackStandard;
  quality: TrackQualityLevel;
  lengthMeters: number; // e.g. 500 m
  spatialStepMeters?: number | undefined; // e.g. 0.25 m (default 0.25 m)
  minWavelengthMeters?: number | undefined; // e.g. 1.0 m (default 1.0 m)
  maxWavelengthMeters?: number | undefined; // e.g. 100.0 m (default 100.0 m)
  nominalGaugeMeters?: number | undefined; // nominal track gauge (default 1.435 m)
  randomSeed?: number | undefined; // PRNG seed for deterministic synthesis (default 42)
  trackName?: string | undefined;
  baseCurvature?: number | undefined; // Optional constant horizontal curvature 1/R [1/m]
  baseCant?: number | undefined; // Optional constant superelevation [rad]
}

/**
 * Simple 32-bit deterministic Mulberry32 PRNG.
 */
function createMulberry32(seed: number): () => number {
  let state = seed | 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Calculates ERRI B176 PSD value for a given spatial frequency Omega [rad/m].
 */
export function calculateErriB176Psd(
  omega: number,
  component: "vertical" | "alignment" | "crosslevel" | "gauge",
  quality: "high" | "low" | "high_speed" = "high",
  halfGauge: number = 0.75,
): number {
  if (omega <= 1e-6) return 0;

  const omegaC = 0.8246; // rad/m
  const omegaR = 0.0206; // rad/m
  const omegaS = 0.438; // rad/m

  let Av: number;
  let Aa: number;
  let Ag: number;

  switch (quality) {
    case "low":
      Av = 1.08e-6;
      Aa = 0.6125e-6;
      Ag = 0.3e-6;
      break;
    case "high_speed":
      Av = 0.15e-6;
      Aa = 0.075e-6;
      Ag = 0.03e-6;
      break;
    case "high":
    default:
      Av = 0.4032e-6;
      Aa = 0.2119e-6;
      Ag = 0.1e-6;
      break;
  }

  const omega2 = omega * omega;
  const omegaC2 = omegaC * omegaC;
  const omegaR2 = omegaR * omegaR;
  const omegaS2 = omegaS * omegaS;

  const denBase = (omega2 + omegaR2) * (omega2 + omegaC2);

  if (component === "vertical") {
    return (Av * omegaC2) / denBase;
  } else if (component === "alignment") {
    return (Aa * omegaC2) / denBase;
  } else if (component === "gauge") {
    return (Ag * omegaC2) / denBase;
  } else {
    // Crosslevel (roll angle in rad)
    const b0Sq = halfGauge * halfGauge;
    return (Av * omegaC2 * omega2) / (b0Sq * denBase * (omega2 + omegaS2));
  }
}

/**
 * Calculates FRA Track Class PSD value for a given spatial frequency Omega [rad/m].
 */
export function calculateFraPsd(
  omega: number,
  component: "vertical" | "alignment",
  fraClass: 1 | 2 | 3 | 4 | 5 | 6 = 6,
): number {
  if (omega <= 1e-6) return 0;

  const omegaS = 0.6046; // rad/m

  // Coefficients Av and Aa for FRA classes 1 to 6 [m rad]
  const coefficients: Record<number, { Av: number; Aa: number }> = {
    6: { Av: 0.0372e-6, Aa: 0.0339e-6 },
    5: { Av: 0.0744e-6, Aa: 0.0678e-6 },
    4: { Av: 0.149e-6, Aa: 0.136e-6 },
    3: { Av: 0.298e-6, Aa: 0.271e-6 },
    2: { Av: 0.596e-6, Aa: 0.542e-6 },
    1: { Av: 1.192e-6, Aa: 1.084e-6 },
  };

  const c = coefficients[fraClass] ?? coefficients[6]!;
  const omega2 = omega * omega;
  const omegaS2 = omegaS * omegaS;

  const A = component === "vertical" ? c.Av : c.Aa;
  return (A * omegaS2) / (omega2 * (omega2 + omegaS2));
}

/**
 * Synthesizes a full multi-channel stochastic track geometry from standard PSD specifications.
 */
export function generatePsdTrackIrregularity(spec: TrackPsdSpecification): TrackGeometry {
  const lengthMeters = Math.max(10.0, spec.lengthMeters);
  const dx = spec.spatialStepMeters ?? 0.25;
  const lambdaMin = Math.max(0.5, spec.minWavelengthMeters ?? 1.0);
  const lambdaMax = Math.min(200.0, spec.maxWavelengthMeters ?? 100.0);
  const nominalGauge = spec.nominalGaugeMeters ?? 1.435;
  const halfGauge = nominalGauge / 2;
  const seed = spec.randomSeed ?? 42;
  const baseCurvature = spec.baseCurvature ?? 0.0;
  const baseCant = spec.baseCant ?? 0.0;

  const prng = createMulberry32(seed);

  const numPoints = Math.round(lengthMeters / dx) + 1;
  const distances = new Float64Array(numPoints);
  for (let i = 0; i < numPoints; i++) {
    distances[i] = i * dx;
  }

  // Harmonic discretization
  const omegaMin = (2 * Math.PI) / lambdaMax;
  const omegaMax = (2 * Math.PI) / lambdaMin;
  const numHarmonics = 128;
  const dOmega = (omegaMax - omegaMin) / numHarmonics;

  const omegaK = new Float64Array(numHarmonics);
  const ampV = new Float64Array(numHarmonics);
  const ampA = new Float64Array(numHarmonics);
  const ampC = new Float64Array(numHarmonics);
  const ampG = new Float64Array(numHarmonics);

  const phaseV = new Float64Array(numHarmonics);
  const phaseA = new Float64Array(numHarmonics);
  const phaseC = new Float64Array(numHarmonics);
  const phaseG = new Float64Array(numHarmonics);

  for (let k = 0; k < numHarmonics; k++) {
    const om = omegaMin + (k + 0.5) * dOmega;
    omegaK[k] = om;

    let psdV = 0;
    let psdA = 0;
    let psdC = 0;
    let psdG = 0;

    if (spec.standard === "FRA") {
      const classNum = parseInt(spec.quality.replace("fra_class_", ""), 10) || 6;
      psdV = calculateFraPsd(om, "vertical", classNum as any);
      psdA = calculateFraPsd(om, "alignment", classNum as any);
      // Derive cant from alignment/vertical standard ratios
      psdC = (psdV * (om * om)) / (halfGauge * halfGauge * 2.0);
      psdG = psdA * 0.3;
    } else {
      const erriQual = spec.quality === "low" ? "low" : spec.quality === "high_speed" ? "high_speed" : "high";
      psdV = calculateErriB176Psd(om, "vertical", erriQual, halfGauge);
      psdA = calculateErriB176Psd(om, "alignment", erriQual, halfGauge);
      psdC = calculateErriB176Psd(om, "crosslevel", erriQual, halfGauge);
      psdG = calculateErriB176Psd(om, "gauge", erriQual, halfGauge);
    }

    ampV[k] = Math.sqrt(2.0 * psdV * dOmega);
    ampA[k] = Math.sqrt(2.0 * psdA * dOmega);
    ampC[k] = Math.sqrt(2.0 * psdC * dOmega);
    ampG[k] = Math.sqrt(2.0 * psdG * dOmega);

    phaseV[k] = prng() * 2 * Math.PI;
    phaseA[k] = prng() * 2 * Math.PI;
    phaseC[k] = prng() * 2 * Math.PI;
    phaseG[k] = prng() * 2 * Math.PI;
  }

  const points: TrackIrregularityPoint[] = new Array(numPoints);

  for (let i = 0; i < numPoints; i++) {
    const x = distances[i]!;

    let zVert = 0.0;
    let yAlign = 0.0;
    let cantIrreg = 0.0;
    let gaugeIrreg = 0.0;

    for (let k = 0; k < numHarmonics; k++) {
      const om = omegaK[k]!;
      zVert += ampV[k]! * Math.cos(om * x + phaseV[k]!);
      yAlign += ampA[k]! * Math.cos(om * x + phaseA[k]!);
      cantIrreg += ampC[k]! * Math.cos(om * x + phaseC[k]!);
      gaugeIrreg += ampG[k]! * Math.cos(om * x + phaseG[k]!);
    }

    const totalCant = baseCant + cantIrreg;

    // Centerline to left/right rails conversion:
    // Left rail vertical: z_left = z_vert + halfGauge * cant
    // Right rail vertical: z_right = z_vert - halfGauge * cant
    // Left rail lateral: y_left = y_align + 0.5 * deltaGauge
    // Right rail lateral: y_right = y_align - 0.5 * deltaGauge
    const vertL = zVert + halfGauge * totalCant;
    const vertR = zVert - halfGauge * totalCant;
    const alignL = yAlign + 0.5 * gaugeIrreg;
    const alignR = yAlign - 0.5 * gaugeIrreg;

    points[i] = {
      distance: x,
      alignmentLeft: alignL,
      alignmentRight: alignR,
      verticalLeft: vertL,
      verticalRight: vertR,
      cant: totalCant,
      curvature: baseCurvature,
    };
  }

  return {
    name: spec.trackName ?? `${spec.standard}_${spec.quality}_${lengthMeters}m`,
    nominalGauge,
    points,
  };
}

/**
 * Serializes TrackGeometry to GENSYS/SIMPACK .trax / .geom tabular text file format.
 */
export function exportTrackGeometryToTrax(track: TrackGeometry): string {
  const lines: string[] = [];
  lines.push(`# GENSYS/SIMPACK Track Irregularity Profile: ${track.name}`);
  lines.push(`# Nominal Gauge: ${track.nominalGauge.toFixed(4)} m`);
  lines.push(`# Distance[m]  Alignment_L[m]  Alignment_R[m]  Vertical_L[m]  Vertical_R[m]  Cant[rad]  Curvature[1/m]`);

  for (const pt of track.points) {
    const d = pt.distance.toFixed(3);
    const al = pt.alignmentLeft.toExponential(6);
    const ar = pt.alignmentRight.toExponential(6);
    const vl = pt.verticalLeft.toExponential(6);
    const vr = pt.verticalRight.toExponential(6);
    const cant = pt.cant.toExponential(6);
    const curv = pt.curvature.toExponential(6);
    lines.push(`${d}  ${al}  ${ar}  ${vl}  ${vr}  ${cant}  ${curv}`);
  }

  return lines.join("\n") + "\n";
}
