// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — Atmospheric Physics & Synoptic Meteorology Diagnostics.
 *
 * Implements analytical barometric hypsometric thickness, hydrostatic pressure,
 * Coriolis parameter, and mid-latitude geostrophic wind diagnostics.
 */

import type { GribGeostrophicWindResult, GribGridDefinitionSection, GribHypsometricResult } from "../types.js";
import { getGdsLatitudes, getGdsLongitudes } from "./packing.js";

/** Specific gas constant for dry air R_d (J / (kg * K)). */
export const R_DRY_AIR = 287.058;

/** Standard gravitational acceleration g_0 (m / s^2). */
export const STANDARD_GRAVITY = 9.80665;

/** Earth's sidereal angular rotation rate Omega (rad / s). */
export const EARTH_OMEGA = 7.2921159e-5;

/** Mean Earth radius R_E (m). */
export const EARTH_RADIUS = 6_371_000;

/**
 * Computes Coriolis parameter f = 2 * Omega * sin(latDeg) in rad/s.
 */
export function computeCoriolisParameter(latDeg: number): number {
  return 2 * EARTH_OMEGA * Math.sin((latDeg * Math.PI) / 180);
}

/**
 * Computes hypsometric geopotential layer thickness between two pressure surfaces:
 *   Delta Z = (R_d * T_mean / g_0) * ln(pBottomPa / pTopPa)
 */
export function computeHypsometricThickness(
  meanTemperatureK: number,
  pBottomPa: number,
  pTopPa: number,
): GribHypsometricResult {
  if (pBottomPa <= 0 || pTopPa <= 0) {
    throw new Error("Pressures pBottomPa and pTopPa must be strictly positive.");
  }
  const scaleHeightMeters = (R_DRY_AIR * meanTemperatureK) / STANDARD_GRAVITY;
  const thicknessMeters = scaleHeightMeters * Math.log(pBottomPa / pTopPa);
  return {
    thicknessMeters,
    meanTemperatureK,
    pBottomPa,
    pTopPa,
    scaleHeightMeters,
  };
}

/**
 * Computes isothermal barometric hydrostatic pressure at altitude z (meters):
 *   p(z) = p0 * exp(-g_0 * z / (R_d * T_mean))
 */
export function computeBarometricPressure(p0Pa: number, heightMeters: number, meanTemperatureK: number): number {
  const scaleHeight = (R_DRY_AIR * meanTemperatureK) / STANDARD_GRAVITY;
  return p0Pa * Math.exp(-heightMeters / scaleHeight);
}

/**
 * Computes geostrophic wind components from horizontal geopotential height gradients
 * (dZ/dx, dZ/dy in m/m) at latitude `latDeg`:
 *   u_g = -(g_0 / f) * (dZ / dy)
 *   v_g =  (g_0 / f) * (dZ / dx)
 */
export function computeGeostrophicWindFromGradient(
  dZdx: number,
  dZdy: number,
  latDeg: number,
): GribGeostrophicWindResult {
  const f = computeCoriolisParameter(latDeg);
  if (Math.abs(f) < 1e-8) {
    return { u: 0, v: 0, speed: 0, directionDeg: 0, coriolisF: f };
  }
  const u = -(STANDARD_GRAVITY / f) * dZdy;
  const v = (STANDARD_GRAVITY / f) * dZdx;
  const speed = Math.hypot(u, v);
  // Meteorological wind direction: degrees clockwise from North that the wind blows FROM
  const dirRad = Math.atan2(-u, -v);
  const directionDeg = ((dirRad * 180) / Math.PI + 360) % 360;
  return { u, v, speed, directionDeg, coriolisF: f };
}

/**
 * Computes geostrophic wind at grid cell `(j, i)` from a 2D geopotential height field `zValues`
 * on a regular Lat/Lon grid (`gds`) using centered (or one-sided boundary) finite differences.
 */
export function computeGeostrophicWindAtGridPoint(
  zValues: readonly number[],
  gds: GribGridDefinitionSection,
  j: number,
  i: number,
): GribGeostrophicWindResult {
  const lats = getGdsLatitudes(gds);
  const lons = getGdsLongitudes(gds);
  const latDeg = lats[j] ?? 0;
  const latRad = (latDeg * Math.PI) / 180;
  const deg2rad = Math.PI / 180;

  // Meridional finite difference dZ / dy (northward positive)
  const jPrev = Math.max(0, j - 1);
  const jNext = Math.min(gds.nj - 1, j + 1);
  const dLatRad = (lats[jNext]! - lats[jPrev]! || 1e-6) * deg2rad;
  const dy = EARTH_RADIUS * dLatRad;
  const dZdy = (zValues[jNext * gds.ni + i]! - zValues[jPrev * gds.ni + i]!) / dy;

  // Zonal finite difference dZ / dx (eastward positive)
  const iPrev = Math.max(0, i - 1);
  const iNext = Math.min(gds.ni - 1, i + 1);
  const dLonRad = (lons[iNext]! - lons[iPrev]! || 1e-6) * deg2rad;
  const cosLat = Math.max(1e-4, Math.cos(latRad));
  const dx = EARTH_RADIUS * cosLat * dLonRad;
  const dZdx = (zValues[j * gds.ni + iNext]! - zValues[j * gds.ni + iPrev]!) / dx;

  return computeGeostrophicWindFromGradient(dZdx, dZdy, latDeg);
}

/**
 * Computes geostrophic wind fields `(u, v)` across an entire geopotential height grid.
 */
export function computeGeostrophicWindField(
  zValues: readonly number[],
  gds: GribGridDefinitionSection,
): { u: number[]; v: number[]; speed: number[] } {
  const n = gds.ni * gds.nj;
  const u = new Array<number>(n).fill(0);
  const v = new Array<number>(n).fill(0);
  const speed = new Array<number>(n).fill(0);
  if (zValues.length !== n || gds.ni < 2 || gds.nj < 2) {
    return { u, v, speed };
  }
  for (let j = 0; j < gds.nj; j++) {
    for (let i = 0; i < gds.ni; i++) {
      const idx = j * gds.ni + i;
      const res = computeGeostrophicWindAtGridPoint(zValues, gds, j, i);
      u[idx] = res.u;
      v[idx] = res.v;
      speed[idx] = res.speed;
    }
  }
  return { u, v, speed };
}
