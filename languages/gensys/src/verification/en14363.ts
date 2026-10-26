// SPDX-License-Identifier: AGPL-3.0-or-later

export interface En14363AssessmentInput {
  lateralForceY: number; // Y [kN]
  verticalForceQ: number; // Q [kN]
  nominalAxleLoadQ0: number; // 2*Q0 in kN (axle load)
}

export interface En14363AssessmentResult {
  yOverQ: number;
  derailmentRiskPassed: boolean; // Y/Q <= 0.8
  prudhommeLimitPassed: boolean; // Y <= 10 + 2*Q0/3
  prudhommeLimit: number; // kN
}

/**
 * Validates instantaneous railway running dynamics according to standard EN 14363 / UIC 518.
 */
export function evaluateEn14363(input: En14363AssessmentInput): En14363AssessmentResult {
  const { lateralForceY, verticalForceQ, nominalAxleLoadQ0 } = input;
  const yOverQ = verticalForceQ > 0 ? Math.abs(lateralForceY) / verticalForceQ : Infinity;
  const derailmentRiskPassed = yOverQ <= 0.8;

  // Prud'homme lateral track shifting force limit: B_lim = 10 + (2/3) * Q0 (where Q0 is per wheel/axle)
  const prudhommeLimit = 10 + (2 / 3) * (nominalAxleLoadQ0 / 2);
  const prudhommeLimitPassed = Math.abs(lateralForceY) <= prudhommeLimit;

  return {
    yOverQ,
    derailmentRiskPassed,
    prudhommeLimitPassed,
    prudhommeLimit,
  };
}

/**
 * Standard test zone classification per EN 14363 / UIC 518 section 5.4.
 */
export type En14363TestZoneType =
  | "Zone1_Tangent" // R >= 2500 m (or tangent)
  | "Zone2_LargeCurve" // 600 m <= R < 2500 m
  | "Zone3_SmallCurve" // 400 m <= R < 600 m
  | "Zone4_VerySmallCurve"; // 250 m <= R < 400 m

export interface En14363TrajectoryInput {
  /** Distance along track in meters (monotonic). */
  distanceM: ArrayLike<number>;
  /** Lateral guiding force on left wheel in kN (Y_left). */
  lateralForceYLeftKn: ArrayLike<number>;
  /** Lateral guiding force on right wheel in kN (Y_right). */
  lateralForceYRightKn: ArrayLike<number>;
  /** Vertical wheel force on left wheel in kN (Q_left). */
  verticalForceQLeftKn: ArrayLike<number>;
  /** Vertical wheel force on right wheel in kN (Q_right). */
  verticalForceQRightKn: ArrayLike<number>;
  /** Nominal static axle load 2*Q0 in kN (e.g. 200 kN for 20-tonne axle). */
  nominalAxleLoadQ0Kn: number;
  /** Optional local track curve radius in meters (0 or Infinity for tangent). */
  curveRadiusM?: ArrayLike<number> | undefined;
  /** Optional cant deficiency in mm. */
  cantDeficiencyMm?: ArrayLike<number> | undefined;
  /** Sliding window length in meters (default 2.0 m per EN 14363 §5.3.2.2). */
  slidingWindowM?: number | undefined;
  /** Flange angle in degrees (default 70 deg for S1002 / UIC 60 profile). */
  wheelFlangeAngleDeg?: number | undefined;
  /** Wheel-rail friction coefficient mu (default 0.36 per standard). */
  frictionCoefficient?: number | undefined;
  /** Quasi-static lateral guiding force limit in kN (default: 60.0 kN). */
  quasiStaticGuidingForceLimitKn?: number | undefined;
}

export interface En14363ZoneEvaluation {
  zone: En14363TestZoneType;
  sampleCount: number;
  trackLengthM: number;
  meanYOverQ: number;
  stdYOverQ: number;
  /** Estimated maximum value at 99.85% level (mean + 3.0 * std) per EN 14363 §5.5. */
  estimatedMaxYOverQ: number;
  meanPrudhommeYKn: number;
  stdPrudhommeYKn: number;
  estimatedMaxPrudhommeYKn: number;
  quasiStaticGuidingForceKn: number;
  derailmentPassed: boolean;
  trackShiftPassed: boolean;
  quasiStaticPassed: boolean;
  zonePassed: boolean;
}

export interface En14363TrajectoryAssessment {
  distanceM: Float64Array;
  slidingYOverQLeft: Float64Array;
  slidingYOverQRight: Float64Array;
  slidingPrudhommeForceKn: Float64Array;
  quasiStaticGuidingForceKn: Float64Array;
  maxInstantYOverQ: number;
  maxSlidingYOverQ: number;
  nadalLimit: number;
  derailmentPassed: boolean;
  maxPrudhommeForceKn: number;
  prudhommeLimitKn: number;
  trackShiftPassed: boolean;
  maxQuasiStaticGuidingForceKn: number;
  quasiStaticLimitKn: number;
  quasiStaticPassed: boolean;
  zones: En14363ZoneEvaluation[];
  overallPassed: boolean;
}

/**
 * Computes Nadal derailment limit: (tan(delta) - mu) / (1 + mu * tan(delta)).
 */
export function calculateNadalLimit(flangeAngleDeg: number = 70.0, mu: number = 0.36): number {
  const deltaRad = (flangeAngleDeg * Math.PI) / 180.0;
  const tanDelta = Math.tan(deltaRad);
  const numerator = tanDelta - mu;
  const denominator = 1.0 + mu * tanDelta;
  return Math.max(0.4, Math.min(1.2, numerator / denominator));
}

/**
 * Evaluates full time/distance-domain railway vehicle running dynamics according to EN 14363 / UIC 518.
 *
 * Implements:
 * 1. 2.0-meter sliding distance window integration for derailment quotient (Y/Q)_2m
 * 2. Total lateral axle force evaluation (Prud'homme limit B_lim = 10 + (2/3) * Q0)
 * 3. Quasi-static lateral guiding force Y_qst evaluation across curves
 * 4. Test zone segmentation (Zones 1-4) with 99.85% normal quantile estimation (x_max = mean + 3*std)
 */
export function evaluateEn14363Trajectory(input: En14363TrajectoryInput): En14363TrajectoryAssessment {
  const n = input.distanceM.length;
  if (n === 0) {
    throw new Error("Cannot evaluate EN 14363 on an empty trajectory.");
  }

  const windowLen = input.slidingWindowM && input.slidingWindowM > 0 ? input.slidingWindowM : 2.0;
  const halfWin = windowLen / 2.0;
  const q0 = input.nominalAxleLoadQ0Kn / 2.0; // wheel nominal load
  const prudhommeLimitKn = 10.0 + (2.0 / 3.0) * q0;
  const quasiStaticLimitKn = input.quasiStaticGuidingForceLimitKn ?? 60.0;
  const nadalLimit = calculateNadalLimit(input.wheelFlangeAngleDeg ?? 70.0, input.frictionCoefficient ?? 0.36);

  const dist = new Float64Array(n);
  const slidingYQLeft = new Float64Array(n);
  const slidingYQRight = new Float64Array(n);
  const slidingPrudhomme = new Float64Array(n);
  const slidingYQMaxPerPoint = new Float64Array(n);
  const quasiStaticY = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    dist[i] = input.distanceM[i]!;
  }

  // Pre-calculate cumulative trapezoidal integrals over distance
  // for Y_l, Q_l, Y_r, Q_r, and (Y_l + Y_r)
  const cumDist = new Float64Array(n);
  const cumYl = new Float64Array(n);
  const cumQl = new Float64Array(n);
  const cumYr = new Float64Array(n);
  const cumQr = new Float64Array(n);
  const cumYTotal = new Float64Array(n);

  for (let i = 1; i < n; i++) {
    const ds = Math.max(1e-6, dist[i]! - dist[i - 1]!);
    cumDist[i] = cumDist[i - 1]! + ds;
    cumYl[i] =
      cumYl[i - 1]! +
      0.5 * (Math.abs(input.lateralForceYLeftKn[i]!) + Math.abs(input.lateralForceYLeftKn[i - 1]!)) * ds;
    cumQl[i] =
      cumQl[i - 1]! +
      0.5 * (Math.max(1.0, input.verticalForceQLeftKn[i]!) + Math.max(1.0, input.verticalForceQLeftKn[i - 1]!)) * ds;
    cumYr[i] =
      cumYr[i - 1]! +
      0.5 * (Math.abs(input.lateralForceYRightKn[i]!) + Math.abs(input.lateralForceYRightKn[i - 1]!)) * ds;
    cumQr[i] =
      cumQr[i - 1]! +
      0.5 * (Math.max(1.0, input.verticalForceQRightKn[i]!) + Math.max(1.0, input.verticalForceQRightKn[i - 1]!)) * ds;
    const yTotCurr = Math.abs(input.lateralForceYLeftKn[i]! + input.lateralForceYRightKn[i]!);
    const yTotPrev = Math.abs(input.lateralForceYLeftKn[i - 1]! + input.lateralForceYRightKn[i - 1]!);
    cumYTotal[i] = cumYTotal[i - 1]! + 0.5 * (yTotCurr + yTotPrev) * ds;
  }

  // Evaluate 2.0 m sliding window averages
  let leftPtr = 0;
  let rightPtr = 0;
  let maxInstantYOverQ = 0.0;
  let maxSlidingYOverQ = 0.0;
  let maxPrudhommeForceKn = 0.0;
  let maxQuasiStaticYKn = 0.0;

  for (let i = 0; i < n; i++) {
    const sCenter = dist[i]!;
    const sStart = sCenter - halfWin;
    const sEnd = sCenter + halfWin;

    while (leftPtr < n - 1 && dist[leftPtr + 1]! < sStart) leftPtr++;
    while (rightPtr < n - 1 && dist[rightPtr]! < sEnd) rightPtr++;

    const actualDs = Math.max(1e-4, dist[rightPtr]! - dist[leftPtr]!);
    const avgYl = (cumYl[rightPtr]! - cumYl[leftPtr]!) / actualDs;
    const avgQl = Math.max(1.0, (cumQl[rightPtr]! - cumQl[leftPtr]!) / actualDs);
    const avgYr = (cumYr[rightPtr]! - cumYr[leftPtr]!) / actualDs;
    const avgQr = Math.max(1.0, (cumQr[rightPtr]! - cumQr[leftPtr]!) / actualDs);
    const avgYTot = (cumYTotal[rightPtr]! - cumYTotal[leftPtr]!) / actualDs;

    const yqL = avgYl / avgQl;
    const yqR = avgYr / avgQr;

    slidingYQLeft[i] = yqL;
    slidingYQRight[i] = yqR;
    slidingPrudhomme[i] = avgYTot;
    slidingYQMaxPerPoint[i] = Math.max(yqL, yqR);

    // Quasi-static lateral force on outer wheel: (sliding average over curve)
    quasiStaticY[i] = Math.max(avgYl, avgYr);

    const instYqL = Math.abs(input.lateralForceYLeftKn[i]!) / Math.max(1.0, input.verticalForceQLeftKn[i]!);
    const instYqR = Math.abs(input.lateralForceYRightKn[i]!) / Math.max(1.0, input.verticalForceQRightKn[i]!);
    const instMax = Math.max(instYqL, instYqR);

    if (instMax > maxInstantYOverQ) maxInstantYOverQ = instMax;
    if (yqL > maxSlidingYOverQ) maxSlidingYOverQ = yqL;
    if (yqR > maxSlidingYOverQ) maxSlidingYOverQ = yqR;
    if (avgYTot > maxPrudhommeForceKn) maxPrudhommeForceKn = avgYTot;
    if (quasiStaticY[i]! > maxQuasiStaticYKn) maxQuasiStaticYKn = quasiStaticY[i]!;
  }

  // Classify points into EN 14363 Test Zones and calculate 99.85% quantiles
  const zoneMap: Record<En14363TestZoneType, { yq: number[]; prud: number[]; qst: number[]; dists: number[] }> = {
    Zone1_Tangent: { yq: [], prud: [], qst: [], dists: [] },
    Zone2_LargeCurve: { yq: [], prud: [], qst: [], dists: [] },
    Zone3_SmallCurve: { yq: [], prud: [], qst: [], dists: [] },
    Zone4_VerySmallCurve: { yq: [], prud: [], qst: [], dists: [] },
  };

  for (let i = 0; i < n; i++) {
    const r = input.curveRadiusM ? Math.abs(input.curveRadiusM[i] ?? 0) : 0;
    let zone: En14363TestZoneType = "Zone1_Tangent";
    if (r <= 0 || r >= 2500) {
      zone = "Zone1_Tangent";
    } else if (r >= 600) {
      zone = "Zone2_LargeCurve";
    } else if (r >= 400) {
      zone = "Zone3_SmallCurve";
    } else {
      zone = "Zone4_VerySmallCurve";
    }

    const bucket = zoneMap[zone];
    bucket.yq.push(slidingYQMaxPerPoint[i]!);
    bucket.prud.push(slidingPrudhomme[i]!);
    bucket.qst.push(quasiStaticY[i]!);
    bucket.dists.push(dist[i]!);
  }

  const zoneEvaluations: En14363ZoneEvaluation[] = [];

  for (const [zoneKey, data] of Object.entries(zoneMap) as [
    En14363TestZoneType,
    (typeof zoneMap)[En14363TestZoneType],
  ][]) {
    const count = data.yq.length;
    if (count === 0) continue;

    const trackLength = data.dists.length > 1 ? Math.max(0, data.dists[data.dists.length - 1]! - data.dists[0]!) : 0;

    // Mean and standard deviation for Y/Q
    const meanYQ = data.yq.reduce((acc, v) => acc + v, 0) / count;
    const varYQ = data.yq.reduce((acc, v) => acc + (v - meanYQ) ** 2, 0) / Math.max(1, count - 1);
    const stdYQ = Math.sqrt(varYQ);
    // EN 14363 §5.5 statistical evaluation: x_est = mean + 3.0 * std (99.85 percentile)
    const estimatedMaxYQ = meanYQ + 3.0 * stdYQ;

    // Mean and standard deviation for Prud'homme lateral force
    const meanPrud = data.prud.reduce((acc, v) => acc + v, 0) / count;
    const varPrud = data.prud.reduce((acc, v) => acc + (v - meanPrud) ** 2, 0) / Math.max(1, count - 1);
    const stdPrud = Math.sqrt(varPrud);
    const estimatedMaxPrud = meanPrud + 3.0 * stdPrud;

    // Quasi-static lateral guiding force: 50th percentile (mean in curve)
    const quasiStaticGuidingForceKn = data.qst.reduce((acc, v) => acc + v, 0) / count;

    const derailmentPassed = estimatedMaxYQ <= nadalLimit && Math.max(...data.yq) <= nadalLimit;
    const trackShiftPassed = estimatedMaxPrud <= prudhommeLimitKn;
    const quasiStaticPassed = quasiStaticGuidingForceKn <= quasiStaticLimitKn;
    const zonePassed = derailmentPassed && trackShiftPassed && quasiStaticPassed;

    zoneEvaluations.push({
      zone: zoneKey,
      sampleCount: count,
      trackLengthM: trackLength,
      meanYOverQ: meanYQ,
      stdYOverQ: stdYQ,
      estimatedMaxYOverQ: estimatedMaxYQ,
      meanPrudhommeYKn: meanPrud,
      stdPrudhommeYKn: stdPrud,
      estimatedMaxPrudhommeYKn: estimatedMaxPrud,
      quasiStaticGuidingForceKn,
      derailmentPassed,
      trackShiftPassed,
      quasiStaticPassed,
      zonePassed,
    });
  }

  const derailmentPassed = maxSlidingYOverQ <= nadalLimit;
  const trackShiftPassed = maxPrudhommeForceKn <= prudhommeLimitKn;
  const quasiStaticPassed = maxQuasiStaticYKn <= quasiStaticLimitKn;
  const overallPassed =
    derailmentPassed && trackShiftPassed && quasiStaticPassed && zoneEvaluations.every((z) => z.zonePassed);

  return {
    distanceM: dist,
    slidingYOverQLeft: slidingYQLeft,
    slidingYOverQRight: slidingYQRight,
    slidingPrudhommeForceKn: slidingPrudhomme,
    quasiStaticGuidingForceKn: quasiStaticY,
    maxInstantYOverQ,
    maxSlidingYOverQ,
    nadalLimit,
    derailmentPassed,
    maxPrudhommeForceKn,
    prudhommeLimitKn,
    trackShiftPassed,
    maxQuasiStaticGuidingForceKn: maxQuasiStaticYKn,
    quasiStaticLimitKn,
    quasiStaticPassed,
    zones: zoneEvaluations,
    overallPassed,
  };
}
