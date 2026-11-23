// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Orbital solar, planetary albedo, and planetary IR heating flux solver.
 *
 * Implements standard spacecraft thermal environment formulations
 * (Gilmore, Spacecraft Thermal Control Handbook; NASA TRASYS Manual):
 *   - Planet angular half-angle rho = arcsin(R_p / (R_p + h))
 *   - Sphere-to-planet view factor F_sp = (1 - cos(rho)) / 2
 *   - Orbital eclipse fraction f_e(h, beta)
 *   - Direct solar, albedo, and planet-IR absorbed heat rates (W)
 */

import { computeSurfaceArea } from "../cad/index.js";
import type { TrasysDeck, TrasysOrbit, TrasysSurface } from "../types.js";

const DEG2RAD = Math.PI / 180;

const PLANET_RADII_KM: Record<string, number> = {
  EARTH: 6371.0,
  MOON: 1737.4,
  MARS: 3389.5,
  VENUS: 6051.8,
};

export interface SurfaceOrbitalFlux {
  surfaceId: string;
  areaM2: number;
  /** Absorbed direct solar heat rate (W), orbit-averaged. */
  qSolarW: number;
  /** Absorbed planetary albedo heat rate (W), orbit-averaged. */
  qAlbedoW: number;
  /** Absorbed planetary IR heat rate (W). */
  qPlanetIrW: number;
  /** Internal heat dissipation (W). */
  qInternalW: number;
  /** Total absorbed heat rate (W). */
  qTotalW: number;
}

export interface OrbitalFluxResult {
  planet: string;
  altitudeKm: number;
  betaDeg: number;
  /** Planet angular half-angle rho (rad). */
  planetHalfAngleRad: number;
  /** Sphere-to-planet view factor F_{s->p}. */
  planetViewFactor: number;
  /** Orbital eclipse fraction f_e in [0, 0.5]. */
  eclipseFraction: number;
  /** Orbital sunlit fraction (1 - f_e). */
  sunlitFraction: number;
  /** Per-surface absorbed heat loads. */
  surfaces: Record<string, SurfaceOrbitalFlux>;
}

/**
 * Computes the planet angular half-angle and sphere-to-planet view factor.
 */
export function computePlanetViewFactor(
  altitudeKm: number,
  planetRadiusKm: number = 6371.0,
): {
  halfAngleRad: number;
  viewFactor: number;
} {
  const r = planetRadiusKm + Math.max(0, altitudeKm);
  const sinRho = Math.min(1, planetRadiusKm / r);
  const halfAngleRad = Math.asin(sinRho);
  const cosRho = Math.sqrt(Math.max(0, 1 - sinRho * sinRho));
  const viewFactor = 0.5 * (1 - cosRho);
  return { halfAngleRad, viewFactor };
}

/**
 * Computes the circular-orbit eclipse fraction f_e for altitude h (km) and solar beta angle (deg).
 */
export function computeEclipseFraction(altitudeKm: number, betaDeg: number, planetRadiusKm: number = 6371.0): number {
  const r = planetRadiusKm + Math.max(0, altitudeKm);
  const betaRad = Math.abs(betaDeg) * DEG2RAD;
  const betaCrit = Math.asin(Math.min(1, planetRadiusKm / r));
  if (betaRad >= betaCrit) return 0;
  const num = Math.sqrt(Math.max(0, altitudeKm * altitudeKm + 2 * planetRadiusKm * altitudeKm));
  const den = r * Math.cos(betaRad);
  const ratio = Math.max(-1, Math.min(1, num / den));
  return Math.acos(ratio) / Math.PI;
}

function projectedSolarArea(surf: TrasysSurface, areaM2: number): number {
  switch (surf.kind) {
    case "SPHERE":
      // Projected area of a sphere is pi*R^2 = A/4
      return areaM2 * 0.25;
    case "CYLINDER":
      // Projected area of a cylinder side perpendicular to sun is 2*R*L = A/pi
      return areaM2 / Math.PI;
    default:
      // Planar surface illuminated on active face
      return areaM2;
  }
}

/**
 * Computes orbital environmental heating loads (solar, albedo, planet IR) for all active surfaces.
 */
export function computeOrbitalFluxes(deck: TrasysDeck, orbitOverride?: TrasysOrbit): OrbitalFluxResult {
  const orbit: TrasysOrbit = orbitOverride ??
    deck.orbit ?? {
      planet: "EARTH",
      altitudeKm: 400,
      betaDeg: 0,
      solarFlux: 1361.0,
      albedo: 0.3,
      planetIr: 237.0,
      planetRadiusKm: 6371.0,
    };

  const planetRadiusKm = orbit.planetRadiusKm ?? PLANET_RADII_KM[orbit.planet.toUpperCase()] ?? 6371.0;
  const { halfAngleRad, viewFactor } = computePlanetViewFactor(orbit.altitudeKm, planetRadiusKm);
  const eclipseFraction = computeEclipseFraction(orbit.altitudeKm, orbit.betaDeg, planetRadiusKm);
  const sunlitFraction = 1 - eclipseFraction;

  // Orbit-averaged albedo cosine weighting factor over sunlit hemisphere (~cos(beta)/pi or 0.5*cos(beta) on sunlit side)
  // Standard LEO orbit-averaged albedo factor for a sphere: a * S * F_sp * (cos(beta) / pi) * (pi/2) ->
  // Using Gilmore's standard orbit-average: q_alb_avg = alpha * a * S * F_sp * (1 - f_e) * cos(beta) * 0.5 (for sphere)
  const cosBeta = Math.max(0, Math.cos(orbit.betaDeg * DEG2RAD));

  const surfaces: Record<string, SurfaceOrbitalFlux> = {};
  for (const surf of deck.surfaces) {
    if (surf.active === "NONE") continue;
    const areaM2 = computeSurfaceArea(surf);
    const aProj = projectedSolarArea(surf, areaM2);
    const qSolarW = surf.prop.alpha * orbit.solarFlux * aProj * sunlitFraction;
    const qAlbedoW =
      surf.prop.alpha * orbit.albedo * orbit.solarFlux * viewFactor * areaM2 * sunlitFraction * cosBeta * 0.5;
    const qPlanetIrW = surf.prop.epsilon * orbit.planetIr * viewFactor * areaM2;
    const qInternalW = surf.internalHeatW ?? 0;
    const qTotalW = qSolarW + qAlbedoW + qPlanetIrW + qInternalW;

    surfaces[surf.id] = {
      surfaceId: surf.id,
      areaM2,
      qSolarW,
      qAlbedoW,
      qPlanetIrW,
      qInternalW,
      qTotalW,
    };
  }

  return {
    planet: orbit.planet,
    altitudeKm: orbit.altitudeKm,
    betaDeg: orbit.betaDeg,
    planetHalfAngleRad: halfAngleRad,
    planetViewFactor: viewFactor,
    eclipseFraction,
    sunlitFraction,
    surfaces,
  };
}
