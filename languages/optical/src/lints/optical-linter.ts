// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pre-flight static linter for optical transport networks and OTDR traces.
 */

import { OpticalErrorCode } from "../errors.js";
import { solveChannelTransmission } from "../solvers/osnr-solver.js";
import type { SorDocument } from "../sor/sor-types.js";
import type { OpticalTopology } from "../types.js";

export interface OpticalDiagnostic {
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  targetId: string;
}

export function lintOpticalTopology(topo: OpticalTopology): OpticalDiagnostic[] {
  const diags: OpticalDiagnostic[] = [];

  // Check 1: Multi-span transmission GSNR and Chromatic Dispersion
  for (const channel of topo.channels.values()) {
    const metrics = solveChannelTransmission(topo, channel);

    // T1001: OSNR Margin Exhausted
    if (metrics.gsnrDb < channel.requiredOsnrDb) {
      diags.push({
        code: OpticalErrorCode.OSNR_MARGIN_EXHAUSTED.code,
        rule: OpticalErrorCode.OSNR_MARGIN_EXHAUSTED.rule,
        severity: OpticalErrorCode.OSNR_MARGIN_EXHAUSTED.severity,
        message: OpticalErrorCode.OSNR_MARGIN_EXHAUSTED.message(
          channel.id,
          metrics.gsnrDb.toFixed(2),
          channel.requiredOsnrDb.toFixed(2),
        ),
        targetId: channel.id,
      });
    }

    // T1005: Uncompensated Chromatic Dispersion (limit: 50,000 ps/nm)
    const maxDspDispersion = 50000.0;
    if (Math.abs(metrics.accumulatedDispersionPsPerNm) > maxDspDispersion) {
      diags.push({
        code: OpticalErrorCode.UNCOMPENSATED_CHROMATIC_DISPERSION.code,
        rule: OpticalErrorCode.UNCOMPENSATED_CHROMATIC_DISPERSION.rule,
        severity: OpticalErrorCode.UNCOMPENSATED_CHROMATIC_DISPERSION.severity,
        message: OpticalErrorCode.UNCOMPENSATED_CHROMATIC_DISPERSION.message(
          channel.id,
          metrics.accumulatedDispersionPsPerNm.toFixed(1),
          maxDspDispersion.toFixed(1),
        ),
        targetId: channel.id,
      });
    }
  }

  // Check 2: Spans & Amplifier input powers
  for (const span of topo.spans.values()) {
    // T1003: Non-linear launch power threshold
    const spanChannels = Array.from(topo.channels.values()).filter((c) => c.pathSpanIds.includes(span.id));
    let totalLaunchWatts = 0.0;
    for (const ch of spanChannels) {
      totalLaunchWatts += Math.pow(10, (ch.launchPowerDbm - 30) / 10);
    }
    const totalLaunchDbm = totalLaunchWatts > 0 ? 10 * Math.log10(totalLaunchWatts) + 30 : -Infinity;
    const nonlinearThresholdDbm = 18.0; // Total fiber launch power threshold

    if (totalLaunchDbm > nonlinearThresholdDbm) {
      diags.push({
        code: OpticalErrorCode.NONLINEAR_POWER_THRESHOLD_EXCEEDED.code,
        rule: OpticalErrorCode.NONLINEAR_POWER_THRESHOLD_EXCEEDED.rule,
        severity: OpticalErrorCode.NONLINEAR_POWER_THRESHOLD_EXCEEDED.severity,
        message: OpticalErrorCode.NONLINEAR_POWER_THRESHOLD_EXCEEDED.message(
          span.id,
          totalLaunchDbm.toFixed(1),
          nonlinearThresholdDbm.toFixed(1),
        ),
        targetId: span.id,
      });
    }

    // T1002: EDFA Input Power Underflow
    for (const amp of span.amplifiers) {
      // Estimate input power at amp after span loss
      const spanLoss = span.lengthKm * span.attenuationDbPerKm;
      const ampInputDbm = totalLaunchDbm - spanLoss;
      const minSensitivityDbm = -30.0;

      if (totalLaunchWatts > 0 && ampInputDbm < minSensitivityDbm) {
        diags.push({
          code: OpticalErrorCode.EDFA_INPUT_POWER_UNDERFLOW.code,
          rule: OpticalErrorCode.EDFA_INPUT_POWER_UNDERFLOW.rule,
          severity: OpticalErrorCode.EDFA_INPUT_POWER_UNDERFLOW.severity,
          message: OpticalErrorCode.EDFA_INPUT_POWER_UNDERFLOW.message(
            amp.id,
            ampInputDbm.toFixed(1),
            minSensitivityDbm.toFixed(1),
          ),
          targetId: amp.id,
        });
      }
    }
  }

  // Check 3: ROADM Add/Drop Contention (T1004)
  for (const node of topo.nodes.values()) {
    for (const srg of node.srgs) {
      if (!srg.isContentionless) {
        // Collect channels dropping or adding at this node
        const nodeChannels = Array.from(topo.channels.values()).filter(
          (c) => c.sourceNodeId === node.id || c.destinationNodeId === node.id,
        );

        const freqMap = new Map<number, string>();
        for (const ch of nodeChannels) {
          const existing = freqMap.get(ch.centerFrequencyThz);
          if (existing) {
            diags.push({
              code: OpticalErrorCode.ROADM_COLORLESS_CONTENTION.code,
              rule: OpticalErrorCode.ROADM_COLORLESS_CONTENTION.rule,
              severity: OpticalErrorCode.ROADM_COLORLESS_CONTENTION.severity,
              message: OpticalErrorCode.ROADM_COLORLESS_CONTENTION.message(
                node.id,
                srg.srgNumber,
                ch.centerFrequencyThz.toFixed(2),
                existing,
                ch.id,
              ),
              targetId: node.id,
            });
          } else {
            freqMap.set(ch.centerFrequencyThz, ch.id);
          }
        }
      }
    }
  }

  return diags;
}

export function lintSorDocument(doc: SorDocument, maxAllowableSpliceLossDb = 0.5): OpticalDiagnostic[] {
  const diags: OpticalDiagnostic[] = [];

  for (const ev of doc.keyEvents) {
    // T1006: High loss event
    if (ev.eventType === "non-reflective" && ev.eventLossDb > maxAllowableSpliceLossDb) {
      diags.push({
        code: OpticalErrorCode.OTDR_HIGH_LOSS_EVENT.code,
        rule: OpticalErrorCode.OTDR_HIGH_LOSS_EVENT.rule,
        severity: OpticalErrorCode.OTDR_HIGH_LOSS_EVENT.severity,
        message: OpticalErrorCode.OTDR_HIGH_LOSS_EVENT.message(
          ev.eventNumber,
          ev.distanceMeters,
          ev.eventLossDb.toFixed(2),
          maxAllowableSpliceLossDb.toFixed(2),
        ),
        targetId: `Event_${ev.eventNumber}`,
      });
    }
  }

  return diags;
}
