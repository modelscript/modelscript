// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 3D Antenna radiation gain envelope synthesizer and interpolator.
 * Implements 3GPP TR 38.901 / ITU-R F.1336 orthogonal pattern combination.
 */

import type { AntennaCut, AntennaPatternDeck } from "../types.js";

export function normalizeAngle360(angleDeg: number): number {
  let a = angleDeg % 360;
  if (a < 0) a += 360;
  return a;
}

export function normalizeAngle180(angleDeg: number): number {
  let a = (angleDeg + 180) % 360;
  if (a < 0) a += 360;
  return a - 180;
}

export function interpolateCut(cut: AntennaCut, angleDeg: number): number {
  if (cut.points.length === 0) return 0;
  if (cut.points.length === 1) return cut.points[0]?.attenuationDb ?? 0;

  const target = normalizeAngle360(angleDeg);

  // Sort points by angle if not already sorted
  const pts = cut.points;
  let lowerIdx = 0;
  let upperIdx = pts.length - 1;

  // Find surrounding points
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    if (pt && pt.angleDeg <= target) {
      lowerIdx = i;
    }
    if (pt && pt.angleDeg >= target) {
      upperIdx = i;
      break;
    }
  }

  const pLower = pts[lowerIdx];
  const pUpper = pts[upperIdx];
  if (!pLower || !pUpper) return 0;

  if (lowerIdx === upperIdx) {
    return pLower.attenuationDb;
  }

  const deltaAngle = pUpper.angleDeg - pLower.angleDeg;
  if (deltaAngle === 0) return pLower.attenuationDb;

  const ratio = (target - pLower.angleDeg) / deltaAngle;
  return pLower.attenuationDb + ratio * (pUpper.attenuationDb - pLower.attenuationDb);
}

export function interpolateAntennaGain(
  deck: AntennaPatternDeck,
  azimuthDeg: number,
  elevationDeg: number,
  additionalDowntiltDeg = 0.0,
): number {
  const totalTilt = deck.electricalDowntiltDeg + deck.mechanicalTiltDeg + additionalDowntiltDeg;
  const effectiveElevation = elevationDeg - totalTilt;

  let hLoss = 0.0;
  if (deck.horizontalCut) {
    hLoss = interpolateCut(deck.horizontalCut, azimuthDeg);
  }

  let vLoss = 0.0;
  if (deck.verticalCut) {
    // Vertical cuts are usually indexed 0 deg at horizon or boresight
    const vAngle = normalizeAngle360(effectiveElevation);
    vLoss = interpolateCut(deck.verticalCut, vAngle);
  }

  // 3GPP 38.901 3D combination formula: A(phi, theta) = -min(-(A_H + A_V), A_max)
  const maxAttenuation = deck.frontToBackRatioDb || 30.0;
  const combinedAttenuation = Math.min(hLoss + vLoss, maxAttenuation);

  return deck.peakGainDbi - combinedAttenuation;
}
