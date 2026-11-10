// SPDX-License-Identifier: AGPL-3.0-or-later

import type { HecRasCrossSection, HecRasGeometry, HecRasProfileResult } from "../types.js";

const GRAVITY = 9.80665; // m/s^2

export interface HydraulicProperties {
  area: number;
  wettedPerimeter: number;
  hydraulicRadius: number;
  topWidth: number;
  hydraulicDepth: number;
  invertElevation: number;
}

/**
 * Computes open-channel geometric properties (Area, Wetted Perimeter, Hydraulic Radius)
 * for a cross-section at a specified water surface elevation (WSEL).
 */
export function computeSectionProperties(cs: HecRasCrossSection, wsel: number): HydraulicProperties {
  const pts = cs.stationElevations;
  if (pts.length < 2) {
    return {
      area: 0,
      wettedPerimeter: 0,
      hydraulicRadius: 0,
      topWidth: 0,
      hydraulicDepth: 0,
      invertElevation: 0,
    };
  }

  let minZ = Infinity;
  for (const p of pts) {
    if (p.elevation < minZ) minZ = p.elevation;
  }

  if (wsel <= minZ) {
    return {
      area: 0,
      wettedPerimeter: 0,
      hydraulicRadius: 0,
      topWidth: 0,
      hydraulicDepth: 0,
      invertElevation: minZ,
    };
  }

  let totalArea = 0;
  let totalPerimeter = 0;
  let topWidth = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const x1 = pts[i]!.station;
    const z1 = pts[i]!.elevation;
    const x2 = pts[i + 1]!.station;
    const z2 = pts[i + 1]!.elevation;
    const dx = x2 - x1;
    if (dx <= 0) continue;

    // Both points submerged
    if (z1 <= wsel && z2 <= wsel) {
      const d1 = wsel - z1;
      const d2 = wsel - z2;
      totalArea += dx * 0.5 * (d1 + d2);
      totalPerimeter += Math.sqrt(dx * dx + (z2 - z1) * (z2 - z1));
      topWidth += dx;
    }
    // Left submerged, right above water surface
    else if (z1 <= wsel && z2 > wsel) {
      const frac = (wsel - z1) / (z2 - z1);
      const subDx = dx * frac;
      const d1 = wsel - z1;
      totalArea += subDx * 0.5 * d1;
      totalPerimeter += Math.sqrt(subDx * subDx + d1 * d1);
      topWidth += subDx;
    }
    // Right submerged, left above water surface
    else if (z1 > wsel && z2 <= wsel) {
      const frac = (wsel - z2) / (z1 - z2);
      const subDx = dx * frac;
      const d2 = wsel - z2;
      totalArea += subDx * 0.5 * d2;
      totalPerimeter += Math.sqrt(subDx * subDx + d2 * d2);
      topWidth += subDx;
    }
  }

  const hydraulicRadius = totalPerimeter > 0 ? totalArea / totalPerimeter : 0;
  const hydraulicDepth = topWidth > 0 ? totalArea / topWidth : 0;

  return {
    area: totalArea,
    wettedPerimeter: totalPerimeter,
    hydraulicRadius,
    topWidth,
    hydraulicDepth,
    invertElevation: minZ,
  };
}

export interface SteadySolveOptions {
  discharge: number; // m^3/s
  downstreamWsel?: number | undefined;
  frictionSlope?: number | undefined; // for normal depth BC (default 0.001)
  tolerance?: number | undefined; // m (default 0.001)
  maxIterations?: number | undefined; // default 50
}

/**
 * Computes normal depth for a cross-section using Manning's equation:
 * Q = (1/n) * A * R^(2/3) * S_0^(1/2)
 */
export function computeNormalDepth(cs: HecRasCrossSection, discharge: number, slope: number): number {
  const n = cs.manning.channel;
  const pts = cs.stationElevations;
  let minZ = Infinity;
  for (const p of pts) {
    if (p.elevation < minZ) minZ = p.elevation;
  }

  let low = minZ + 0.01;
  let high = minZ + 50.0;

  for (let iter = 0; iter < 40; iter++) {
    const mid = 0.5 * (low + high);
    const props = computeSectionProperties(cs, mid);
    if (props.area <= 0) {
      low = mid;
      continue;
    }
    const qCalc = (1.0 / n) * props.area * Math.pow(props.hydraulicRadius, 2 / 3) * Math.sqrt(Math.max(slope, 1e-6));
    if (qCalc < discharge) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return 0.5 * (low + high);
}

/**
 * Solves 1D subcritical steady-state water surface profiles using the Standard Step Method.
 */
export function solveWaterSurfaceProfile(geom: HecRasGeometry, options: SteadySolveOptions): HecRasProfileResult[] {
  const { discharge, tolerance = 0.001, maxIterations = 50 } = options;
  const slope = options.frictionSlope ?? 0.001;

  if (geom.crossSections.length === 0) return [];

  // Group cross-sections by river reach and sort descending by station (HEC-RAS standard: upstream -> downstream)
  const sorted = [...geom.crossSections].sort((a, b) => b.station - a.station);
  const results: HecRasProfileResult[] = [];

  // Start from downstream (lowest station)
  const dsIdx = sorted.length - 1;
  const dsCs = sorted[dsIdx]!;

  const dsWsel =
    options.downstreamWsel !== undefined ? options.downstreamWsel : computeNormalDepth(dsCs, discharge, slope);

  const dsProps = computeSectionProperties(dsCs, dsWsel);
  const dsVel = dsProps.area > 0 ? discharge / dsProps.area : 0;
  const dsHv = (dsVel * dsVel) / (2 * GRAVITY);
  const dsEgl = dsWsel + dsHv;
  const dsFr = dsProps.hydraulicDepth > 0 ? dsVel / Math.sqrt(GRAVITY * dsProps.hydraulicDepth) : 0;
  const dsSf =
    dsProps.hydraulicRadius > 0
      ? (Math.pow(dsCs.manning.channel, 2) * dsVel * Math.abs(dsVel)) / Math.pow(dsProps.hydraulicRadius, 4 / 3)
      : 0;

  results[dsIdx] = {
    river: dsCs.river,
    reach: dsCs.reach,
    station: dsCs.station,
    waterSurfaceElevation: dsWsel,
    energyGradeLine: dsEgl,
    velocity: dsVel,
    froudeNumber: dsFr,
    flowArea: dsProps.area,
    hydraulicRadius: dsProps.hydraulicRadius,
    frictionSlope: dsSf,
  };

  // Step upstream from dsIdx - 1 down to 0
  for (let i = dsIdx - 1; i >= 0; i--) {
    const cs1 = sorted[i + 1]!; // downstream section
    const res1 = results[i + 1]!;
    const cs2 = sorted[i]!; // upstream section

    const dx = cs2.reachLengths.channel || Math.abs(cs2.station - cs1.station) || 100;

    // Initial estimate for upstream WSEL: downstream WSEL + bed elevation diff
    let low = cs2.stationElevations.reduce((min, p) => Math.min(min, p.elevation), Infinity) + 0.01;
    let high = res1.waterSurfaceElevation + dx * slope * 5.0 + 10.0;
    let wsel2 = Math.max(low, res1.waterSurfaceElevation);

    for (let iter = 0; iter < maxIterations; iter++) {
      const props2 = computeSectionProperties(cs2, wsel2);
      if (props2.area <= 0) {
        wsel2 += 0.5;
        continue;
      }
      const v2 = discharge / props2.area;
      const hv2 = (v2 * v2) / (2 * GRAVITY);
      const egl2 = wsel2 + hv2;

      const sf2 =
        props2.hydraulicRadius > 0
          ? (Math.pow(cs2.manning.channel, 2) * v2 * Math.abs(v2)) / Math.pow(props2.hydraulicRadius, 4 / 3)
          : 0;

      // Friction loss and expansion/contraction loss
      const sfAvg = 0.5 * (res1.frictionSlope + sf2);
      const hf = sfAvg * dx;

      const cCoeff = v2 > res1.velocity ? cs2.contractionCoefficient : cs2.expansionCoefficient;
      const ho = cCoeff * Math.abs(hv2 - (res1.energyGradeLine - res1.waterSurfaceElevation));

      const targetEgl = res1.energyGradeLine + hf + ho;
      const diff = egl2 - targetEgl;

      if (Math.abs(diff) < tolerance) {
        break;
      }

      // Adjust wsel2
      if (diff > 0) {
        high = wsel2;
      } else {
        low = wsel2;
      }
      wsel2 = 0.5 * (low + high);
    }

    const finalProps = computeSectionProperties(cs2, wsel2);
    const finalVel = finalProps.area > 0 ? discharge / finalProps.area : 0;
    const finalHv = (finalVel * finalVel) / (2 * GRAVITY);
    const finalEgl = wsel2 + finalHv;
    const finalFr = finalProps.hydraulicDepth > 0 ? finalVel / Math.sqrt(GRAVITY * finalProps.hydraulicDepth) : 0;
    const finalSf =
      finalProps.hydraulicRadius > 0
        ? (Math.pow(cs2.manning.channel, 2) * finalVel * Math.abs(finalVel)) / Math.pow(finalProps.hydraulicRadius, 4 / 3)
        : 0;

    results[i] = {
      river: cs2.river,
      reach: cs2.reach,
      station: cs2.station,
      waterSurfaceElevation: wsel2,
      energyGradeLine: finalEgl,
      velocity: finalVel,
      froudeNumber: finalFr,
      flowArea: finalProps.area,
      hydraulicRadius: finalProps.hydraulicRadius,
      frictionSlope: finalSf,
    };
  }

  return results;
}
