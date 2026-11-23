// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fits — World Coordinate System (WCS) Astrometry Solver.
 *
 * Implements Calabretta & Greisen (2002) A&A 395, 1077–1122 (FITS WCS Paper II)
 * forward and inverse celestial spherical projections:
 * - `TAN` (Gnomonic / Tangent plane)
 * - `SIN` (Slant orthographic)
 * - `ARC` (Zenithal equidistant)
 *
 * Supports both full 2x2 `CD1_1`..`CD2_2` matrices and `CDELT1`/`CDELT2` + `PC`/`CROTA2`
 * linear transformations, converting 1-based FITS pixels `(x, y)` <-> J2000 `(RA, Dec)` in degrees.
 */

import type { CelestialCoord, FitsHeader, FitsWcsParams, PixelCoord, WcsProjectionType } from "../types.js";

const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;

/** Normalizes an angle in degrees to `[0, 360)`. */
export function normalizeRaDeg(raDeg: number): number {
  const m = raDeg % 360.0;
  return m < 0 ? m + 360.0 : m;
}

/**
 * Extracts WCS parameters from a parsed `FitsHeader`, returning `undefined` if incomplete.
 */
export function extractWcsFromHeader(header: FitsHeader): FitsWcsParams | undefined {
  const ctype1 = header.keywords["CTYPE1"]?.value;
  const ctype2 = header.keywords["CTYPE2"]?.value;
  const crpix1 = header.keywords["CRPIX1"]?.value;
  const crpix2 = header.keywords["CRPIX2"]?.value;
  const crval1 = header.keywords["CRVAL1"]?.value;
  const crval2 = header.keywords["CRVAL2"]?.value;

  if (
    typeof ctype1 !== "string" ||
    typeof ctype2 !== "string" ||
    typeof crpix1 !== "number" ||
    typeof crpix2 !== "number" ||
    typeof crval1 !== "number" ||
    typeof crval2 !== "number"
  ) {
    return undefined;
  }

  const projCode = ctype1.trim().slice(-3).toUpperCase();
  if (projCode !== "TAN" && projCode !== "SIN" && projCode !== "ARC") {
    return undefined;
  }

  let cd1_1: number;
  let cd1_2: number;
  let cd2_1: number;
  let cd2_2: number;

  const hCd11 = header.keywords["CD1_1"]?.value;
  const hCd22 = header.keywords["CD2_2"]?.value;
  if (typeof hCd11 === "number" && typeof hCd22 === "number") {
    cd1_1 = hCd11;
    cd1_2 = typeof header.keywords["CD1_2"]?.value === "number" ? header.keywords["CD1_2"]!.value : 0.0;
    cd2_1 = typeof header.keywords["CD2_1"]?.value === "number" ? header.keywords["CD2_1"]!.value : 0.0;
    cd2_2 = hCd22;
  } else {
    const cdelt1 = header.keywords["CDELT1"]?.value;
    const cdelt2 = header.keywords["CDELT2"]?.value;
    if (typeof cdelt1 !== "number" || typeof cdelt2 !== "number") {
      return undefined;
    }
    const crota2 = typeof header.keywords["CROTA2"]?.value === "number" ? header.keywords["CROTA2"]!.value : 0.0;
    const cosR = Math.cos(crota2 * DEG2RAD);
    const sinR = Math.sin(crota2 * DEG2RAD);
    const pc11 = typeof header.keywords["PC1_1"]?.value === "number" ? header.keywords["PC1_1"]!.value : cosR;
    const pc12 = typeof header.keywords["PC1_2"]?.value === "number" ? header.keywords["PC1_2"]!.value : -sinR;
    const pc21 = typeof header.keywords["PC2_1"]?.value === "number" ? header.keywords["PC2_1"]!.value : sinR;
    const pc22 = typeof header.keywords["PC2_2"]?.value === "number" ? header.keywords["PC2_2"]!.value : cosR;
    cd1_1 = cdelt1 * pc11;
    cd1_2 = cdelt1 * pc12;
    cd2_1 = cdelt2 * pc21;
    cd2_2 = cdelt2 * pc22;
  }

  const lonpole = typeof header.keywords["LONPOLE"]?.value === "number" ? header.keywords["LONPOLE"]!.value : 180.0;
  const latpole = typeof header.keywords["LATPOLE"]?.value === "number" ? header.keywords["LATPOLE"]!.value : 0.0;
  const equinox = typeof header.keywords["EQUINOX"]?.value === "number" ? header.keywords["EQUINOX"]!.value : 2000.0;

  return {
    ctype1: ctype1.trim(),
    ctype2: ctype2.trim(),
    projection: projCode as WcsProjectionType,
    crpix1,
    crpix2,
    crval1,
    crval2,
    cd1_1,
    cd1_2,
    cd2_1,
    cd2_2,
    lonpole,
    latpole,
    equinox,
  };
}

/**
 * Forward WCS transform: converts 1-based FITS pixel `(x, y)` to celestial J2000 `(RA, Dec)` in degrees.
 */
export function pixelToWorld(wcs: FitsWcsParams, pixel: PixelCoord): CelestialCoord {
  const dx = pixel.x - wcs.crpix1;
  const dy = pixel.y - wcs.crpix2;

  // Intermediate world coordinates (projection plane, degrees)
  const u = wcs.cd1_1 * dx + wcs.cd1_2 * dy;
  const v = wcs.cd2_1 * dx + wcs.cd2_2 * dy;

  const rDeg = Math.hypot(u, v);
  // Native longitude phi (rad): x_proj = R * sin(phi), y_proj = -R * cos(phi)
  const phi = rDeg === 0 ? 0.0 : Math.atan2(u, -v);

  // Native latitude theta (rad)
  let theta: number;
  switch (wcs.projection) {
    case "TAN":
      theta = rDeg === 0 ? Math.PI / 2.0 : Math.atan2(RAD2DEG, rDeg);
      break;
    case "SIN": {
      const ratio = rDeg * DEG2RAD;
      if (ratio > 1.0) {
        throw new RangeError(`SIN projection radius ${rDeg} deg exceeds hemisphere horizon (180/pi deg).`);
      }
      theta = Math.acos(Math.min(1.0, Math.max(0.0, ratio)));
      break;
    }
    case "ARC":
      theta = Math.PI / 2.0 - rDeg * DEG2RAD;
      break;
  }

  // Spherical rotation from native (phi, theta) to celestial (alpha, delta)
  const alpha0 = wcs.crval1 * DEG2RAD;
  const delta0 = wcs.crval2 * DEG2RAD;
  const phiP = (wcs.lonpole ?? 180.0) * DEG2RAD;

  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  const sinD0 = Math.sin(delta0);
  const cosD0 = Math.cos(delta0);
  const dPhi = phi - phiP;
  const sinDPhi = Math.sin(dPhi);
  const cosDPhi = Math.cos(dPhi);

  const sinDec = Math.max(-1.0, Math.min(1.0, sinTheta * sinD0 + cosTheta * cosD0 * cosDPhi));
  const dec = Math.asin(sinDec);

  const yNum = -cosTheta * sinDPhi;
  const xDen = sinTheta * cosD0 - cosTheta * sinD0 * cosDPhi;
  const alpha = alpha0 + Math.atan2(yNum, xDen);

  return {
    raDeg: normalizeRaDeg(alpha * RAD2DEG),
    decDeg: dec * RAD2DEG,
  };
}

/**
 * Inverse WCS transform: converts celestial J2000 `(RA, Dec)` in degrees to 1-based FITS pixel `(x, y)`.
 */
export function worldToPixel(wcs: FitsWcsParams, sky: CelestialCoord): PixelCoord {
  const alpha = sky.raDeg * DEG2RAD;
  const delta = sky.decDeg * DEG2RAD;
  const alpha0 = wcs.crval1 * DEG2RAD;
  const delta0 = wcs.crval2 * DEG2RAD;
  const phiP = (wcs.lonpole ?? 180.0) * DEG2RAD;

  const dAlpha = alpha - alpha0;
  const sinD = Math.sin(delta);
  const cosD = Math.cos(delta);
  const sinD0 = Math.sin(delta0);
  const cosD0 = Math.cos(delta0);
  const sinDA = Math.sin(dAlpha);
  const cosDA = Math.cos(dAlpha);

  // Spherical rotation from celestial (alpha, delta) to native (phi, theta)
  // Using numerically stable Vincenty-form atan2(sinTheta, cosTheta) to avoid asin loss near zenith
  const yNum = -cosD * sinDA;
  const xDen = sinD * cosD0 - cosD * sinD0 * cosDA;
  const cosTheta = Math.hypot(yNum, xDen);
  const sinTheta = sinD * sinD0 + cosD * cosD0 * cosDA;
  const phi = phiP + Math.atan2(yNum, xDen);

  // Native projection radius R_theta (deg)
  let rDeg: number;
  switch (wcs.projection) {
    case "TAN":
      if (sinTheta <= 0) {
        throw new RangeError("Target celestial coordinate is behind the TAN tangent hemisphere.");
      }
      rDeg = RAD2DEG * (cosTheta / sinTheta);
      break;
    case "SIN":
      if (sinTheta < 0) {
        throw new RangeError("Target celestial coordinate is on the far side of the SIN orthographic sphere.");
      }
      rDeg = RAD2DEG * cosTheta;
      break;
    case "ARC":
      rDeg = RAD2DEG * Math.atan2(cosTheta, sinTheta);
      break;
  }

  const u = rDeg * Math.sin(phi);
  const v = -rDeg * Math.cos(phi);

  const det = wcs.cd1_1 * wcs.cd2_2 - wcs.cd1_2 * wcs.cd2_1;
  if (Math.abs(det) < 1e-30) {
    throw new RangeError("Singular WCS CD matrix (determinant is zero).");
  }

  const dx = (wcs.cd2_2 * u - wcs.cd1_2 * v) / det;
  const dy = (-wcs.cd2_1 * u + wcs.cd1_1 * v) / det;

  return {
    x: wcs.crpix1 + dx,
    y: wcs.crpix2 + dy,
  };
}

/**
 * Exact great-circle angular separation between two celestial coordinates in degrees,
 * using the numerically stable Vincenty spherical formula (accurate down to sub-microarcsecond).
 */
export function angularSeparationDeg(c1: CelestialCoord, c2: CelestialCoord): number {
  const a1 = c1.raDeg * DEG2RAD;
  const d1 = c1.decDeg * DEG2RAD;
  const a2 = c2.raDeg * DEG2RAD;
  const d2 = c2.decDeg * DEG2RAD;

  const da = a2 - a1;
  const cosD1 = Math.cos(d1);
  const sinD1 = Math.sin(d1);
  const cosD2 = Math.cos(d2);
  const sinD2 = Math.sin(d2);
  const cosDa = Math.cos(da);
  const sinDa = Math.sin(da);

  const t1 = cosD2 * sinDa;
  const t2 = cosD1 * sinD2 - sinD1 * cosD2 * cosDa;
  const num = Math.hypot(t1, t2);
  const den = sinD1 * sinD2 + cosD1 * cosD2 * cosDa;

  return Math.atan2(num, den) * RAD2DEG;
}
