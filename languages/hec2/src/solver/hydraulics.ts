// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Hec2CrossSection, Hec2StationElevation, Hec2UnitSystem } from "../types.js";

/** US Customary gravitational acceleration (ft/s^2) */
export const GRAVITY_US = 32.174;
/** SI gravitational acceleration (m/s^2) */
export const GRAVITY_SI = 9.80665;
/** Manning's equation conversion factor phi for US Customary units */
export const MANNING_PHI_US = 1.486;
/** Manning's equation conversion factor phi for SI units */
export const MANNING_PHI_SI = 1.0;

export function getUnitConstants(units: Hec2UnitSystem): { g: number; phi: number } {
  return units === "SI" ? { g: GRAVITY_SI, phi: MANNING_PHI_SI } : { g: GRAVITY_US, phi: MANNING_PHI_US };
}

export interface SubdivisionHydraulics {
  area: number;
  wettedPerimeter: number;
  hydraulicRadius: number;
  topWidth: number;
  conveyance: number;
}

export interface SectionHydraulics {
  wsel: number;
  invertElevation: number;
  depth: number;
  area: number;
  wettedPerimeter: number;
  hydraulicRadius: number;
  topWidth: number;
  hydraulicDepth: number;
  conveyance: number;
  alpha: number;
  lob: SubdivisionHydraulics;
  channel: SubdivisionHydraulics;
  rob: SubdivisionHydraulics;
}

function emptySubdivision(): SubdivisionHydraulics {
  return { area: 0, wettedPerimeter: 0, hydraulicRadius: 0, topWidth: 0, conveyance: 0 };
}

/**
 * Integrates area, wetted perimeter, and top width over a single straight segment `(x1,z1)->(x2,z2)`
 * submerged below `wsel`.
 */
function accumulateSegment(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  wsel: number,
  target: SubdivisionHydraulics,
): void {
  const dx = x2 - x1;
  if (dx < 0) return;

  if (dx === 0) {
    // Vertical wall (e.g., rectangular channel side wall): contributes to wetted perimeter only
    const lo = Math.min(z1, z2);
    const hi = Math.max(z1, z2);
    if (wsel > lo) {
      target.wettedPerimeter += Math.min(wsel, hi) - lo;
    }
    return;
  }

  if (z1 <= wsel && z2 <= wsel) {
    const d1 = wsel - z1;
    const d2 = wsel - z2;
    target.area += 0.5 * (d1 + d2) * dx;
    target.wettedPerimeter += Math.hypot(dx, z2 - z1);
    target.topWidth += dx;
  } else if (z1 <= wsel && z2 > wsel) {
    const frac = (wsel - z1) / (z2 - z1);
    const subDx = dx * frac;
    const d1 = wsel - z1;
    target.area += 0.5 * d1 * subDx;
    target.wettedPerimeter += Math.hypot(subDx, d1);
    target.topWidth += subDx;
  } else if (z1 > wsel && z2 <= wsel) {
    const frac = (wsel - z2) / (z1 - z2);
    const subDx = dx * frac;
    const d2 = wsel - z2;
    target.area += 0.5 * d2 * subDx;
    target.wettedPerimeter += Math.hypot(subDx, d2);
    target.topWidth += subDx;
  }
}

/**
 * Inserts interpolated vertices at bank stations `stchl` and `stchr` so that every segment
 * lies cleanly within LOB, Main Channel, or ROB.
 */
function splitPointsAtBanks(pts: Hec2StationElevation[], stchl: number, stchr: number): Hec2StationElevation[] {
  const out: Hec2StationElevation[] = [];
  const cuts = [stchl, stchr].sort((a, b) => a - b);

  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i]!;
    out.push(p1);
    if (i + 1 < pts.length) {
      const p2 = pts[i + 1]!;
      const dx = p2.station - p1.station;
      if (dx > 0) {
        for (const c of cuts) {
          if (c > p1.station && c < p2.station) {
            const frac = (c - p1.station) / dx;
            const z = p1.elevation + frac * (p2.elevation - p1.elevation);
            out.push({ station: c, elevation: z });
          }
        }
      }
    }
  }
  return out;
}

function finalizeSubdivision(sub: SubdivisionHydraulics, n: number, phi: number): void {
  if (sub.area > 0 && sub.wettedPerimeter > 0 && n > 0) {
    sub.hydraulicRadius = sub.area / sub.wettedPerimeter;
    sub.conveyance = (phi / n) * sub.area * Math.pow(sub.hydraulicRadius, 2 / 3);
  } else {
    sub.hydraulicRadius = 0;
    sub.conveyance = 0;
  }
}

/**
 * Computes subdivided Manning conveyance (`K = (phi/n) * A * R^(2/3)`), composite area,
 * hydraulic radius, top width, and kinetic energy correction factor `alpha` for a HEC-2 cross-section.
 */
export function computeSectionHydraulics(
  xs: Hec2CrossSection,
  wsel: number,
  units: Hec2UnitSystem = "US",
): SectionHydraulics {
  const { phi } = getUnitConstants(units);
  const pts = xs.grPoints;

  const lob = emptySubdivision();
  const channel = emptySubdivision();
  const rob = emptySubdivision();

  if (pts.length < 2) {
    return {
      wsel,
      invertElevation: 0,
      depth: 0,
      area: 0,
      wettedPerimeter: 0,
      hydraulicRadius: 0,
      topWidth: 0,
      hydraulicDepth: 0,
      conveyance: 0,
      alpha: 1.0,
      lob,
      channel,
      rob,
    };
  }

  let minZ = Infinity;
  for (const p of pts) {
    if (p.elevation < minZ) minZ = p.elevation;
  }

  if (wsel <= minZ) {
    return {
      wsel,
      invertElevation: minZ,
      depth: 0,
      area: 0,
      wettedPerimeter: 0,
      hydraulicRadius: 0,
      topWidth: 0,
      hydraulicDepth: 0,
      conveyance: 0,
      alpha: 1.0,
      lob,
      channel,
      rob,
    };
  }

  const split = splitPointsAtBanks(pts, xs.stchl, xs.stchr);

  for (let i = 0; i < split.length - 1; i++) {
    const p1 = split[i]!;
    const p2 = split[i + 1]!;
    const midSta = 0.5 * (p1.station + p2.station);

    if (midSta < xs.stchl - 1e-12) {
      accumulateSegment(p1.station, p1.elevation, p2.station, p2.elevation, wsel, lob);
    } else if (midSta > xs.stchr + 1e-12) {
      accumulateSegment(p1.station, p1.elevation, p2.station, p2.elevation, wsel, rob);
    } else {
      accumulateSegment(p1.station, p1.elevation, p2.station, p2.elevation, wsel, channel);
    }
  }

  finalizeSubdivision(lob, xs.manning.left, phi);
  finalizeSubdivision(channel, xs.manning.channel, phi);
  finalizeSubdivision(rob, xs.manning.right, phi);

  const area = lob.area + channel.area + rob.area;
  const wettedPerimeter = lob.wettedPerimeter + channel.wettedPerimeter + rob.wettedPerimeter;
  const topWidth = lob.topWidth + channel.topWidth + rob.topWidth;
  const conveyance = lob.conveyance + channel.conveyance + rob.conveyance;
  const hydraulicRadius = wettedPerimeter > 0 ? area / wettedPerimeter : 0;
  const hydraulicDepth = topWidth > 0 ? area / topWidth : 0;

  // Coriolis velocity weighting coefficient: alpha = A_t^2 * sum(K_j^3 / A_j^2) / K_t^3
  let alpha = 1.0;
  if (area > 0 && conveyance > 0) {
    let sumTerm = 0;
    for (const sub of [lob, channel, rob]) {
      if (sub.area > 0 && sub.conveyance > 0) {
        sumTerm += Math.pow(sub.conveyance, 3) / (sub.area * sub.area);
      }
    }
    const rawAlpha = (area * area * sumTerm) / Math.pow(conveyance, 3);
    if (Number.isFinite(rawAlpha) && rawAlpha >= 1.0) {
      alpha = rawAlpha;
    }
  }

  return {
    wsel,
    invertElevation: minZ,
    depth: wsel - minZ,
    area,
    wettedPerimeter,
    hydraulicRadius,
    topWidth,
    hydraulicDepth,
    conveyance,
    alpha,
    lob,
    channel,
    rob,
  };
}

/**
 * Computes Froude number `Fr = V / sqrt(g * D / alpha)`.
 */
export function computeFroudeNumber(discharge: number, hyd: SectionHydraulics, units: Hec2UnitSystem = "US"): number {
  if (hyd.area <= 0 || hyd.hydraulicDepth <= 0) return 0;
  const { g } = getUnitConstants(units);
  const velocity = discharge / hyd.area;
  return velocity / Math.sqrt((g * hyd.hydraulicDepth) / Math.max(hyd.alpha, 1.0));
}

/**
 * Computes Manning normal water surface elevation `WSE_n` solving `K(WSE_n) * sqrt(S_0) = Q`.
 */
export function computeNormalWsel(
  xs: Hec2CrossSection,
  discharge: number,
  slope: number,
  units: Hec2UnitSystem = "US",
): number {
  const minZ = xs.grPoints.reduce((m, p) => Math.min(m, p.elevation), Infinity);
  if (!Number.isFinite(minZ) || discharge <= 0 || slope <= 0) return Number.isFinite(minZ) ? minZ : 0;

  const targetK = discharge / Math.sqrt(slope);

  // Bracket upper bound
  let lo = minZ + 1e-7;
  let hi = minZ + 1.0;
  for (let i = 0; i < 40; i++) {
    const h = computeSectionHydraulics(xs, hi, units);
    if (h.conveyance >= targetK) break;
    hi = minZ + (hi - minZ) * 2.0;
  }

  // High-precision bisection (64 iterations -> ~1e-16 relative precision)
  for (let iter = 0; iter < 64; iter++) {
    const mid = 0.5 * (lo + hi);
    const h = computeSectionHydraulics(xs, mid, units);
    if (h.conveyance < targetK) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (Math.abs(hi - lo) < 1e-12) break;
  }

  return 0.5 * (lo + hi);
}

/**
 * Computes critical water surface elevation `WSE_c` where `Fr = 1` (minimizing specific energy).
 * For a rectangular channel of width `B`, `y_c = (q^2 / g)^(1/3)`.
 */
export function computeCriticalWsel(xs: Hec2CrossSection, discharge: number, units: Hec2UnitSystem = "US"): number {
  const minZ = xs.grPoints.reduce((m, p) => Math.min(m, p.elevation), Infinity);
  if (!Number.isFinite(minZ) || discharge <= 0) return Number.isFinite(minZ) ? minZ : 0;

  // Bracket Fr > 1 at lo and Fr < 1 at hi
  let lo = minZ + 1e-7;
  let hi = minZ + 1.0;
  for (let i = 0; i < 40; i++) {
    const h = computeSectionHydraulics(xs, hi, units);
    const fr = computeFroudeNumber(discharge, h, units);
    if (fr <= 1.0 && h.area > 0) break;
    hi = minZ + (hi - minZ) * 2.0;
  }

  for (let iter = 0; iter < 64; iter++) {
    const mid = 0.5 * (lo + hi);
    const h = computeSectionHydraulics(xs, mid, units);
    const fr = computeFroudeNumber(discharge, h, units);
    if (fr > 1.0) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (Math.abs(hi - lo) < 1e-12) break;
  }

  return 0.5 * (lo + hi);
}
