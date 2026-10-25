// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Formal Pipeline Verification & Safety Gate Engine.
 *
 * Verifies hydraulic simulation results against ASME B31.8 / B31.4 MAOP ratings,
 * contractual city gate delivery pressures, and erosional velocity guidelines.
 */

import type { LpsModel, LpsSteadyResult } from "../types.js";

export interface VerificationViolation {
  criterion: string;
  target: string;
  observedValue: number;
  limitValue: number;
  unit: string;
  message: string;
}

export interface PipelineVerificationReport {
  passed: boolean;
  totalChecks: number;
  violations: VerificationViolation[];
  summary: {
    maxObservedPressureBar: number;
    minDeliveryPressureBar: number;
    maxVelocityMps: number;
    totalLinePackSm3: number;
  };
}

export class PipelineVerifier {
  /**
   * Verifies a steady-state hydraulic solution against all pipeline design rules.
   */
  static verifySteady(model: LpsModel, steady: LpsSteadyResult): PipelineVerificationReport {
    const violations: VerificationViolation[] = [];
    let maxObservedP = 0;
    let minDeliveryP = 999e5;
    let maxVel = 0;

    // 1. MAOP Verification
    for (const pipe of model.pipes) {
      const pState = steady.pipeStates[pipe.name];
      if (!pState) continue;

      const peakP = Math.max(pState.inletPressure, pState.outletPressure);
      if (peakP > maxObservedP) maxObservedP = peakP;

      if (peakP > pipe.maop * 1.001) {
        violations.push({
          criterion: "MAOP_INTEGRITY",
          target: pipe.name,
          observedValue: peakP / 1e5,
          limitValue: pipe.maop / 1e5,
          unit: "bar",
          message: `Pipe '${pipe.name}' operating pressure (${(peakP / 1e5).toFixed(1)} bar) exceeds MAOP rating (${(pipe.maop / 1e5).toFixed(1)} bar).`,
        });
      }

      if (pState.velocity > maxVel) maxVel = pState.velocity;
      if (pState.velocity > 20.0) {
        violations.push({
          criterion: "EROSIONAL_VELOCITY",
          target: pipe.name,
          observedValue: pState.velocity,
          limitValue: 20.0,
          unit: "m/s",
          message: `Pipe '${pipe.name}' gas velocity (${pState.velocity.toFixed(1)} m/s) exceeds API RP 14E guideline (20.0 m/s).`,
        });
      }
    }

    // 2. Minimum Delivery Pressure Verification
    for (const node of model.nodes) {
      if (node.type === "DELIVERY") {
        const nState = steady.nodeStates[node.name];
        if (!nState) continue;

        const actualP = nState.pressure;
        if (actualP < minDeliveryP) minDeliveryP = actualP;

        const minRequired = node.minDeliveryPressure ?? 30e5; // default 30 bar
        if (actualP < minRequired) {
          violations.push({
            criterion: "MIN_DELIVERY_PRESSURE",
            target: node.name,
            observedValue: actualP / 1e5,
            limitValue: minRequired / 1e5,
            unit: "bar",
            message: `Delivery node '${node.name}' pressure (${(actualP / 1e5).toFixed(1)} bar) is below contractual minimum (${(minRequired / 1e5).toFixed(1)} bar).`,
          });
        }
      }
    }

    const totalChecks = model.pipes.length * 2 + model.nodes.filter((n) => n.type === "DELIVERY").length;

    return {
      passed: violations.length === 0,
      totalChecks,
      violations,
      summary: {
        maxObservedPressureBar: maxObservedP / 1e5,
        minDeliveryPressureBar: minDeliveryP < 999e5 ? minDeliveryP / 1e5 : 0,
        maxVelocityMps: maxVel,
        totalLinePackSm3: steady.totalLinePackSm3,
      },
    };
  }
}
