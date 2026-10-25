// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ContactTableEntry {
  lateralDisplacement: number; // y [mm]
  rollingRadiusRight: number; // r_r [m]
  rollingRadiusLeft: number; // r_l [m]
  contactAngleRight: number; // gamma_r [rad]
  contactAngleLeft: number; // gamma_l [rad]
}

export interface ProfileAnalysisResult {
  deltaR: number; // rolling radius difference r_r - r_l [m]
  equivalentConicity: number; // lambda [-]
}

/**
 * Parses wheel-rail profile contact table files (.wheel, .rail, .prof).
 * Evaluates rolling radius difference and linear equivalent conicity lambda:
 *   lambda = (r_r - r_l) / (2 * y)
 */
export function evaluateEquivalentConicity(
  table: ContactTableEntry[],
  evalDisplacementMm: number = 3.0,
  nominalWheelRadius: number = 0.46,
): ProfileAnalysisResult {
  if (table.length === 0 || evalDisplacementMm === 0) {
    return { deltaR: 0, equivalentConicity: 0.05 };
  }

  // Find surrounding points for linear interpolation
  const sorted = [...table].sort((a, b) => a.lateralDisplacement - b.lateralDisplacement);
  let rRight = nominalWheelRadius;
  let rLeft = nominalWheelRadius;

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i]!;
    const next = sorted[i + 1]!;
    if (evalDisplacementMm >= cur.lateralDisplacement && evalDisplacementMm <= next.lateralDisplacement) {
      const alpha =
        (evalDisplacementMm - cur.lateralDisplacement) / (next.lateralDisplacement - cur.lateralDisplacement);
      rRight = cur.rollingRadiusRight + alpha * (next.rollingRadiusRight - cur.rollingRadiusRight);
      rLeft = cur.rollingRadiusLeft + alpha * (next.rollingRadiusLeft - cur.rollingRadiusLeft);
      break;
    }
  }

  const deltaR = rRight - rLeft;
  const dyMeters = Math.abs(evalDisplacementMm * 1e-3);
  const equivalentConicity = dyMeters > 0 ? Math.abs(deltaR) / (2 * dyMeters) : 0.05;

  return {
    deltaR,
    equivalentConicity,
  };
}
