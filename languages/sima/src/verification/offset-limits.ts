// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Watch Circle, Vessel Excursion, Fairlead Angles, and Touchdown Envelope Verifier.
 *
 * Verifies offshore floater station keeping against DNV-OS-E301 and DNV-ST-0119:
 *   1. Floater horizontal offset vs allowable watch circle / riser top-end excursion limit.
 *   2. Fairlead angular envelopes (bending declination angle limits).
 *   3. Touchdown zone envelope (ensures touchdown point does not migrate into anchor, maintaining 0 deg uplift).
 */

import { solveCatenary } from "../solver/catenary-solver.js";
import type { SimaModel } from "../types.js";

export interface LineOffsetCheck {
  lineId: string;
  lineName: string;
  fairleadAngleDeg: number;
  fairleadAnglePassed: boolean;
  touchdownDistanceToAnchor: number; // meters from TDP to anchor (grounded length)
  touchdownPassed: boolean;
  anchorUpliftDeg: number;
  anchorUpliftPassed: boolean;
}

export interface OffsetLimitReport {
  vesselId: string;
  vesselName: string;
  waterDepth: number;
  watchCircleRadiusMeters: number;
  meanOffsetMeters: { x: number; y: number; total: number };
  excursionUtilization: number; // offset / watchCircleRadius
  excursionPassed: boolean;
  lines: LineOffsetCheck[];
  allPassed: boolean;
  summary: string;
}

export interface OffsetLimitOptions {
  maxOffsetPercentWaterDepth?: number; // e.g. 8.0% for intact, 12.0% for damaged
  maxFairleadAngleDeg?: number; // e.g. 75 degrees max declination
  minGroundedLengthMeters?: number; // minimum line on seabed before anchor (default 30m)
}

export function evaluateOffsetLimits(model: SimaModel, options: OffsetLimitOptions = {}): OffsetLimitReport {
  const maxOffsetPercent = options.maxOffsetPercentWaterDepth ?? 8.0;
  const maxFairleadAngle = options.maxFairleadAngleDeg ?? 75.0;
  const minGroundedLength = options.minGroundedLengthMeters ?? 30.0;

  const waterDepth = model.environment.waterDepth;
  const watchCircleRadius = (waterDepth * maxOffsetPercent) / 100;

  const vessel = model.vessels[0] ?? {
    id: "vessel_1",
    name: "Offshore Floater",
    mass: 1e7,
    displacement: 1e4,
    cg: [0, 0, 0] as [number, number, number],
    radiiOfGyration: [30, 30, 35] as [number, number, number],
    massMatrix: [],
    hydrostaticMatrix: [],
    linearDamping: [],
    quadraticDamping: [],
    gmTransverse: 2.5,
    gmLongitudinal: 3.0,
    fairleads: [],
  };

  // Estimate steady horizontal environmental force vector (wave drift + wind + current)
  const env = model.environment;
  const waveHeadingRad = (env.wave.direction * Math.PI) / 180;
  const windHeadingRad = (env.wind.direction * Math.PI) / 180;
  const currHeadingRad = (env.current.direction * Math.PI) / 180;

  // Wave drift ~ 0.5 * rho * g * R^2 * Hs^2
  const fWave = 0.5 * env.waterDensity * 9.81 * 0.04 * Math.pow(env.wave.hs, 2) * 50.0;
  // Wind force ~ 0.5 * rho_air * Cd * A * Vw^2
  const fWind = 0.5 * 1.225 * 1.0 * 800.0 * Math.pow(env.wind.speed, 2);
  // Current force ~ 0.5 * rho_water * Cd * A * Vc^2
  const fCurr = 0.5 * env.waterDensity * 0.8 * 600.0 * Math.pow(env.current.surfaceSpeed, 2);

  const fxTotal =
    fWave * Math.cos(waveHeadingRad) + fWind * Math.cos(windHeadingRad) + fCurr * Math.cos(currHeadingRad);
  const fyTotal =
    fWave * Math.sin(waveHeadingRad) + fWind * Math.sin(windHeadingRad) + fCurr * Math.sin(currHeadingRad);

  const totalEnvForce = Math.hypot(fxTotal, fyTotal);

  // Estimate mooring spread restoring stiffness (N/m)
  let spreadStiffness = 0;
  for (const line of model.lines) {
    const avgEa = line.segments.reduce((acc, s) => acc + s.axialStiffnessEA, 0) / Math.max(1, line.segments.length);
    spreadStiffness += (avgEa / Math.max(10, line.totalLength)) * 0.05;
  }
  spreadStiffness = Math.max(50000, spreadStiffness);

  // Mean offset
  const meanTotalOffset = Math.min(watchCircleRadius * 1.5, totalEnvForce / spreadStiffness);
  const offsetAngle = Math.atan2(fyTotal, fxTotal);
  const offsetX = meanTotalOffset * Math.cos(offsetAngle);
  const offsetY = meanTotalOffset * Math.sin(offsetAngle);

  const excursionUtilization = meanTotalOffset / Math.max(0.1, watchCircleRadius);
  const excursionPassed = excursionUtilization <= 1.0;

  const lineChecks: LineOffsetCheck[] = [];
  let allLinesPassed = true;

  for (const line of model.lines) {
    const fairleadPos = line.fairleadPosition ?? [0, 0, 0];
    const anchorPos = line.anchorPosition;

    // Displaced fairlead position
    const displacedFairleadX = (fairleadPos[0] ?? 0) + offsetX;
    const displacedFairleadY = (fairleadPos[1] ?? 0) + offsetY;
    const anchorX = anchorPos[0] ?? 0;
    const anchorY = anchorPos[1] ?? 0;
    const span = Math.hypot(displacedFairleadX - anchorX, displacedFairleadY - anchorY);

    const avgWeight =
      line.segments.reduce((acc, s) => acc + s.submergedWeightPerMeter, 0) / Math.max(1, line.segments.length);
    const avgEa = line.segments.reduce((acc, s) => acc + s.axialStiffnessEA, 0) / Math.max(1, line.segments.length);

    const cat = solveCatenary({
      waterDepth,
      horizontalSpan: span,
      lineLength: line.totalLength,
      submergedWeight: avgWeight,
      axialStiffnessEA: avgEa,
    });

    const fairleadAngleDeg = cat.fairleadAngleDeg;
    const fairleadAnglePassed = fairleadAngleDeg <= maxFairleadAngle;

    const groundedLen = cat.groundedLength;
    const touchdownPassed = groundedLen >= minGroundedLength;

    const anchorUpliftPassed = cat.anchorAngleDeg === 0;

    const linePassed = fairleadAnglePassed && touchdownPassed && anchorUpliftPassed;
    if (!linePassed) {
      allLinesPassed = false;
    }

    lineChecks.push({
      lineId: line.id,
      lineName: line.name,
      fairleadAngleDeg,
      fairleadAnglePassed,
      touchdownDistanceToAnchor: groundedLen,
      touchdownPassed,
      anchorUpliftDeg: cat.anchorAngleDeg,
      anchorUpliftPassed,
    });
  }

  const allPassed = excursionPassed && allLinesPassed;
  const summary = allPassed
    ? `Excursion & Offset Envelope OK: Mean offset = ${meanTotalOffset.toFixed(2)}m (${(excursionUtilization * 100).toFixed(1)}% of watch circle ${watchCircleRadius.toFixed(1)}m). All ${lineChecks.length} lines clear.`
    : `Excursion/Envelope Exceeded: Mean offset = ${meanTotalOffset.toFixed(2)}m (${(excursionUtilization * 100).toFixed(1)}% of watch circle ${watchCircleRadius.toFixed(1)}m), Excursion passed: ${excursionPassed}, Line clearances passed: ${allLinesPassed}.`;

  return {
    vesselId: vessel.id,
    vesselName: vessel.name,
    waterDepth,
    watchCircleRadiusMeters: watchCircleRadius,
    meanOffsetMeters: { x: offsetX, y: offsetY, total: meanTotalOffset },
    excursionUtilization,
    excursionPassed,
    lines: lineChecks,
    allPassed,
    summary,
  };
}
