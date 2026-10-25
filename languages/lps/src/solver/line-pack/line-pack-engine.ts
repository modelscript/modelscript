// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Line Pack Analytics & Storage Inventory Engine.
 *
 * Computes network line pack mass, deliverable line pack reserves above contractual
 * minimum delivery pressures, draft rates during peak-shaving, and hydrogen blending impacts.
 */

import type { LpsModel, LpsSteadyResult } from "../../types.js";

export interface LinePackAnalysis {
  totalLinePackKg: number;
  totalLinePackSm3: number;
  totalEnergyStoredGWh: number;
  deliverableLinePackSm3: number;
  exhaustionTimeHours: number; // buffer time before minimum delivery pressure is breached
  hydrogenVolumePercent: number;
  energyDensityMJperSm3: number;
}

export class LinePackEngine {
  /**
   * Evaluates comprehensive line pack inventory and storage reserves for a solved steady state.
   */
  static analyze(model: LpsModel, steadyResult: LpsSteadyResult): LinePackAnalysis {
    const comp = model.gasComposition ?? {
      methane: 0.92,
      ethane: 0.04,
      propane: 0.015,
      nButane: 0.005,
      iButane: 0.005,
      pentanes: 0.002,
      hexanePlus: 0.001,
      nitrogen: 0.008,
      carbonDioxide: 0.004,
      hydrogen: 0.0,
      grossHeatingValue: 38.8,
      standardDensity: 0.77,
    };

    const h2Frac = comp.hydrogen ?? 0;
    // Energy density: Natural gas ~38 MJ/Sm3, Pure H2 ~12.7 MJ/Sm3
    const ghv = (1 - h2Frac) * (comp.grossHeatingValue ?? 38.8) + h2Frac * 12.7;

    const totalSm3 = steadyResult.totalLinePackSm3;
    const totalEnergyJoules = totalSm3 * (ghv * 1e6); // MJ to J
    const totalEnergyGWh = totalEnergyJoules / 3.6e12; // Joules to GWh

    // Estimate Deliverable Line Pack above minimum contractual delivery pressure
    let deliverableSm3 = 0;
    for (const pipe of model.pipes) {
      const pState = steadyResult.pipeStates[pipe.name];
      if (!pState) continue;

      const toNode = model.nodes.find((n) => n.name === pipe.toNode);
      const minDeliveryP = toNode?.minDeliveryPressure ?? 30e5; // default 30 bar

      const currentP = pState.outletPressure;
      if (currentP > minDeliveryP) {
        // Fractional deliverable margin
        const marginFrac = Math.max(0, (currentP - minDeliveryP) / currentP);
        deliverableSm3 += pState.linePackSm3 * marginFrac;
      }
    }

    // Peak shaving buffer exhaustion time:
    // If delivery flow > supply flow, compute how long deliverable line pack lasts
    let netWithdrawalKgPerSec = 0;
    for (const n of model.nodes) {
      if (n.type === "DELIVERY" && n.flowRate != null) {
        netWithdrawalKgPerSec += n.flowRate;
      } else if (n.type === "SUPPLY" && n.flowRate != null) {
        netWithdrawalKgPerSec -= n.flowRate;
      }
    }

    const stdDensity = comp.standardDensity ?? 0.77;
    const netWithdrawalSm3PerSec = netWithdrawalKgPerSec / stdDensity;

    let exhaustionTimeHours = 999.0;
    if (netWithdrawalSm3PerSec > 0) {
      exhaustionTimeHours = deliverableSm3 / netWithdrawalSm3PerSec / 3600;
    }

    return {
      totalLinePackKg: steadyResult.totalLinePackKg,
      totalLinePackSm3: totalSm3,
      totalEnergyStoredGWh: totalEnergyGWh,
      deliverableLinePackSm3: deliverableSm3,
      exhaustionTimeHours: Math.max(0, exhaustionTimeHours),
      hydrogenVolumePercent: h2Frac * 100,
      energyDensityMJperSm3: ghv,
    };
  }
}
