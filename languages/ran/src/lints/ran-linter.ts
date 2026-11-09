// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pre-flight static linter for microwave links and antenna radiation patterns.
 */

import { RanErrorCode } from "../errors.js";
import { evaluateFresnelClearance, type FresnelObstacleCheck } from "../solvers/fresnel.js";
import { solveMicrowaveLinkBudget } from "../solvers/itu-r-p530.js";
import type { AntennaPatternDeck, MicrowaveLink } from "../types.js";

export interface RanDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  targetId: string;
}

export function lintMicrowaveLink(link: MicrowaveLink, obstacles?: FresnelObstacleCheck[]): RanDiagnostic[] {
  const diags: RanDiagnostic[] = [];

  // R2003: Check FCC Part 101 EIRP limits
  // Max EIRP: +55.0 dBm for 6-11 GHz, +45.0 dBm for 18-23 GHz
  const maxEirpDbm = link.frequencyGhz <= 13.0 ? 55.0 : 45.0;
  const eirpDbm = link.txPowerDbm + link.txAntennaGainDbi - link.txFeederLossDb;
  if (eirpDbm > maxEirpDbm) {
    diags.push({
      code: RanErrorCode.FCC_EIRP_LIMIT_EXCEEDED.code,
      rule: RanErrorCode.FCC_EIRP_LIMIT_EXCEEDED.rule,
      severity: RanErrorCode.FCC_EIRP_LIMIT_EXCEEDED.severity,
      message: RanErrorCode.FCC_EIRP_LIMIT_EXCEEDED.message(link.id, eirpDbm.toFixed(1), maxEirpDbm.toFixed(1)),
      targetId: link.id,
    });
  }

  // R2002: Check rain fade and availability (< 99.999%)
  const budget = solveMicrowaveLinkBudget(link);
  if (budget.availabilityPercent < 99.999) {
    diags.push({
      code: RanErrorCode.LINK_AVAILABILITY_SUB_FIVE_NINES.code,
      rule: RanErrorCode.LINK_AVAILABILITY_SUB_FIVE_NINES.rule,
      severity: RanErrorCode.LINK_AVAILABILITY_SUB_FIVE_NINES.severity,
      message: RanErrorCode.LINK_AVAILABILITY_SUB_FIVE_NINES.message(
        link.id,
        budget.availabilityPercent.toFixed(4),
        budget.unavailabilityMinutesPerYear.toFixed(1),
      ),
      targetId: link.id,
    });
  }

  // R2001: Check Fresnel zone clearance if obstacles provided
  if (obstacles && obstacles.length > 0) {
    const clearance = evaluateFresnelClearance(
      link.pathLengthKm,
      link.frequencyGhz,
      30.0, // default 30m tower height
      30.0,
      obstacles,
    );

    if (clearance.minClearanceRatio < 0.6) {
      const distStr =
        clearance.worstObstacleDistanceKm !== undefined ? clearance.worstObstacleDistanceKm.toFixed(1) : "unknown";
      diags.push({
        code: RanErrorCode.FRESNEL_ZONE_OBSTRUCTION.code,
        rule: RanErrorCode.FRESNEL_ZONE_OBSTRUCTION.rule,
        severity: RanErrorCode.FRESNEL_ZONE_OBSTRUCTION.severity,
        message: RanErrorCode.FRESNEL_ZONE_OBSTRUCTION.message(
          link.id,
          distStr,
          clearance.minClearanceRatio.toFixed(2),
        ),
        targetId: link.id,
      });
    }
  }

  return diags;
}

export function lintAntennaPatternDeck(deck: AntennaPatternDeck): RanDiagnostic[] {
  const diags: RanDiagnostic[] = [];

  // R2005: Downtilt out of bounds
  if (deck.electricalDowntiltDeg < 0.0 || deck.electricalDowntiltDeg > 16.0) {
    diags.push({
      code: RanErrorCode.ANTENNA_DOWNTILT_OUT_OF_BOUNDS.code,
      rule: RanErrorCode.ANTENNA_DOWNTILT_OUT_OF_BOUNDS.rule,
      severity: RanErrorCode.ANTENNA_DOWNTILT_OUT_OF_BOUNDS.severity,
      message: RanErrorCode.ANTENNA_DOWNTILT_OUT_OF_BOUNDS.message(deck.name, deck.electricalDowntiltDeg.toFixed(1)),
      targetId: deck.name,
    });
  }

  return diags;
}
