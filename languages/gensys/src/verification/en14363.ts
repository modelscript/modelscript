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
 * Validates railway running dynamics according to standard EN 14363 / UIC 518.
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
