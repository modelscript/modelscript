// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/relap5 — Pre-flight Nuclear Reactor Diagnostics Linter.
 *
 * Implements OpenModelica-style diagnostic codes (M8601 - M8610) for RELAP5 thermal-hydraulics.
 */

import { type DiagnosticItem, Relap5ErrorCode } from "../errors.js";
import type { Relap5Deck } from "../types.js";

export function lintRelap5(deck: Relap5Deck): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];

  // M8609: Time step bounds check
  for (const ts of deck.timeSteps) {
    if (ts.minDt > ts.maxDt) {
      diagnostics.push({
        code: Relap5ErrorCode.INVALID_TIME_STEP_BOUNDS.code,
        rule: Relap5ErrorCode.INVALID_TIME_STEP_BOUNDS.rule,
        severity: Relap5ErrorCode.INVALID_TIME_STEP_BOUNDS.severity,
        message: Relap5ErrorCode.INVALID_TIME_STEP_BOUNDS.message(ts.minDt, ts.maxDt),
      });
    }
  }

  // Volume checks
  for (const vol of deck.volumes.values()) {
    // M8610: Negative pressure state
    if (vol.initialPressure <= 0) {
      diagnostics.push({
        code: Relap5ErrorCode.NEGATIVE_PRESSURE_STATE.code,
        rule: Relap5ErrorCode.NEGATIVE_PRESSURE_STATE.rule,
        severity: Relap5ErrorCode.NEGATIVE_PRESSURE_STATE.severity,
        message: Relap5ErrorCode.NEGATIVE_PRESSURE_STATE.message(vol.id, vol.initialPressure),
        range: vol.range,
      });
    }

    // M8607: Adverse volume elevation change
    if (Math.abs(vol.elevationChange) > vol.length + 1e-4) {
      diagnostics.push({
        code: Relap5ErrorCode.ADVERSE_VOLUME_ELEVATION.code,
        rule: Relap5ErrorCode.ADVERSE_VOLUME_ELEVATION.rule,
        severity: Relap5ErrorCode.ADVERSE_VOLUME_ELEVATION.severity,
        message: Relap5ErrorCode.ADVERSE_VOLUME_ELEVATION.message(vol.id, vol.elevationChange, vol.length),
        range: vol.range,
      });
    }
  }

  // Junction checks
  for (const junc of deck.junctions.values()) {
    // M8601: Dangling volume connection
    if (junc.fromVolume !== 0 && !deck.volumes.has(junc.fromVolume)) {
      diagnostics.push({
        code: Relap5ErrorCode.DANGLING_VOLUME_CONNECTION.code,
        rule: Relap5ErrorCode.DANGLING_VOLUME_CONNECTION.rule,
        severity: Relap5ErrorCode.DANGLING_VOLUME_CONNECTION.severity,
        message: Relap5ErrorCode.DANGLING_VOLUME_CONNECTION.message(junc.id, junc.fromVolume, "from"),
        range: junc.range,
      });
    }
    if (junc.toVolume !== 0 && !deck.volumes.has(junc.toVolume)) {
      diagnostics.push({
        code: Relap5ErrorCode.DANGLING_VOLUME_CONNECTION.code,
        rule: Relap5ErrorCode.DANGLING_VOLUME_CONNECTION.rule,
        severity: Relap5ErrorCode.DANGLING_VOLUME_CONNECTION.severity,
        message: Relap5ErrorCode.DANGLING_VOLUME_CONNECTION.message(junc.id, junc.toVolume, "to"),
        range: junc.range,
      });
    }

    // M8608: Negative form loss coefficient
    if (junc.forwardLoss < 0 || junc.reverseLoss < 0) {
      diagnostics.push({
        code: Relap5ErrorCode.NEGATIVE_JUNCTION_LOSS_COEFFICIENT.code,
        rule: Relap5ErrorCode.NEGATIVE_JUNCTION_LOSS_COEFFICIENT.rule,
        severity: Relap5ErrorCode.NEGATIVE_JUNCTION_LOSS_COEFFICIENT.severity,
        message: Relap5ErrorCode.NEGATIVE_JUNCTION_LOSS_COEFFICIENT.message(
          junc.id,
          junc.forwardLoss,
          junc.reverseLoss,
        ),
        range: junc.range,
      });
    }

    // M8604: Sonic choked flow singularity
    if (junc.chokedFlowModel && junc.area < 1e-4 && junc.initialVaporVelocity > 300) {
      diagnostics.push({
        code: Relap5ErrorCode.SONIC_CHOKED_FLOW_SINGULARITY.code,
        rule: Relap5ErrorCode.SONIC_CHOKED_FLOW_SINGULARITY.rule,
        severity: Relap5ErrorCode.SONIC_CHOKED_FLOW_SINGULARITY.severity,
        message: Relap5ErrorCode.SONIC_CHOKED_FLOW_SINGULARITY.message(junc.id),
        range: junc.range,
      });
    }
  }

  // Heat structure checks
  for (const hs of deck.heatStructures.values()) {
    // M8603: Negative conductivity or heat capacity
    if (hs.thermalConductivity <= 0 || hs.volumetricHeatCapacity <= 0) {
      diagnostics.push({
        code: Relap5ErrorCode.NEGATIVE_HEAT_CAPACITY.code,
        rule: Relap5ErrorCode.NEGATIVE_HEAT_CAPACITY.rule,
        severity: Relap5ErrorCode.NEGATIVE_HEAT_CAPACITY.severity,
        message: Relap5ErrorCode.NEGATIVE_HEAT_CAPACITY.message(
          hs.id,
          hs.thermalConductivity,
          hs.volumetricHeatCapacity,
        ),
        range: hs.range,
      });
    }
  }

  // Trip checks
  for (const trip of deck.trips.values()) {
    // M8602: Unclosed trip logic cutset
    if (trip.isLogical && trip.childTripIds) {
      for (const childId of trip.childTripIds) {
        if (!deck.trips.has(childId)) {
          diagnostics.push({
            code: Relap5ErrorCode.UNCLOSED_TRIP_LOGIC_CUTSET.code,
            rule: Relap5ErrorCode.UNCLOSED_TRIP_LOGIC_CUTSET.rule,
            severity: Relap5ErrorCode.UNCLOSED_TRIP_LOGIC_CUTSET.severity,
            message: Relap5ErrorCode.UNCLOSED_TRIP_LOGIC_CUTSET.message(trip.id, childId),
            range: trip.range,
          });
        }
      }
    }
  }

  // Kinetics checks
  if (deck.kinetics) {
    // M8606: Prompt neutron lifetime
    if (deck.kinetics.promptGenerationTime <= 0) {
      diagnostics.push({
        code: Relap5ErrorCode.NEGATIVE_PROMPT_NEUTRON_LIFETIME.code,
        rule: Relap5ErrorCode.NEGATIVE_PROMPT_NEUTRON_LIFETIME.rule,
        severity: Relap5ErrorCode.NEGATIVE_PROMPT_NEUTRON_LIFETIME.severity,
        message: Relap5ErrorCode.NEGATIVE_PROMPT_NEUTRON_LIFETIME.message(deck.kinetics.promptGenerationTime),
        range: deck.kinetics.range,
      });
    }

    // M8605: Missing delayed precursor groups
    if (deck.kinetics.delayedGroups.length !== 6) {
      diagnostics.push({
        code: Relap5ErrorCode.MISSING_KINETICS_DELAYED_GROUPS.code,
        rule: Relap5ErrorCode.MISSING_KINETICS_DELAYED_GROUPS.rule,
        severity: Relap5ErrorCode.MISSING_KINETICS_DELAYED_GROUPS.severity,
        message: Relap5ErrorCode.MISSING_KINETICS_DELAYED_GROUPS.message(deck.kinetics.delayedGroups.length),
        range: deck.kinetics.range,
      });
    }
  }

  return diagnostics;
}
