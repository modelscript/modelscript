// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — AWWA M36 Standard Water Audit & Leakage Assessment Engine.
 *
 * Implements standard International Water Association (IWA) and American Water Works
 * Association (AWWA M36) water balance reconciliation and performance indicators:
 * - Current Annual Real Losses (CARL)
 * - Unavoidable Annual Real Losses (UARL)
 * - Infrastructure Leakage Index (ILI = CARL / UARL)
 * - Water Loss Grading (Band A, B, C, D) and financial valuation of non-revenue water.
 */

import type { EpanetNetwork } from "../types.js";
import { solveHydraulics } from "./todini-ggm.js";

export interface AwwaM36AuditInput {
  systemInputVolumeM3Year: number;
  billedMeteredM3Year: number;
  billedUnmeteredM3Year?: number | undefined;
  unbilledMeteredM3Year?: number | undefined;
  unbilledUnmeteredM3Year?: number | undefined;
  serviceConnectionsCount?: number | undefined; // Nc
  avgCustomerServiceLineLenM?: number | undefined; // Lp (m)
  unitCostProductionPerM3?: number | undefined; // Variable cost of water ($/m3)
  retailWaterRatePerM3?: number | undefined; // Retail rate ($/m3)
}

export type WaterLossBand = "A" | "B" | "C" | "D";

export interface AwwaM36AuditResult {
  systemInputVolumeM3Year: number;
  authorizedConsumptionM3Year: number;
  waterLossesM3Year: number;
  apparentLossesM3Year: number;
  realLossesM3Year: number;
  nonRevenueWaterM3Year: number;
  nonRevenueWaterPct: number;
  carlM3Year: number;
  uarlM3Year: number;
  ili: number;
  performanceBand: WaterLossBand;
  financialImpact: {
    realLossCostUsd: number;
    apparentLossRevenueLostUsd: number;
    totalAnnualLossUsd: number;
  };
  networkStats: {
    totalMainsLengthKm: number;
    avgSystemPressureM: number;
    serviceConnectionsCount: number;
  };
}

/**
 * Conducts a full AWWA M36 Water Audit by combining network topology hydraulics
 * with utility metering and production volumes.
 */
export function performAwwaM36WaterAudit(net: EpanetNetwork, auditInput: AwwaM36AuditInput): AwwaM36AuditResult {
  // 1. Calculate mains length from network pipes
  let totalLengthM = 0.0;
  for (const p of net.pipes) {
    totalLengthM += p.length;
  }
  const LmKm = totalLengthM / 1000.0;

  // 2. Solve baseline hydraulics to obtain average system pressure head P_avg [m]
  const hyd = solveHydraulics(net);
  let sumPressure = 0.0;
  let countPressure = 0;
  for (const junc of net.junctions) {
    const p = hyd.nodePressures.get(junc.id) ?? 0.0;
    sumPressure += Math.max(0.0, p);
    countPressure++;
  }
  const Pavg = countPressure > 0 ? sumPressure / countPressure : 35.0; // default 35m head (~50 psi)

  // 3. Service connections Nc and customer line length Lp
  const Nc = auditInput.serviceConnectionsCount ?? Math.max(10, net.junctions.length * 25);
  const avgLpM = auditInput.avgCustomerServiceLineLenM ?? 15.0;
  const LpKm = (Nc * avgLpM) / 1000.0;

  // 4. Water Balance reconciliation (m3/year)
  const SIV = auditInput.systemInputVolumeM3Year;
  const billedMetered = auditInput.billedMeteredM3Year;
  const billedUnmetered = auditInput.billedUnmeteredM3Year ?? 0.0;
  const unbilledMetered = auditInput.unbilledMeteredM3Year ?? SIV * 0.01;
  const unbilledUnmetered = auditInput.unbilledUnmeteredM3Year ?? SIV * 0.015;

  const revenueWater = billedMetered + billedUnmetered;
  const authorizedConsumption = revenueWater + unbilledMetered + unbilledUnmetered;
  const totalLosses = Math.max(0.0, SIV - authorizedConsumption);

  // Apparent losses: customer meter under-registration + unauthorized theft + data errors (~2% SIV standard)
  const apparentLosses = Math.min(totalLosses * 0.3, SIV * 0.025);
  const realLosses = Math.max(0.0, totalLosses - apparentLosses);
  const nonRevenueWater = SIV - revenueWater;
  const nonRevenuePct = SIV > 0 ? (nonRevenueWater / SIV) * 100.0 : 0.0;

  // 5. Unavoidable Annual Real Losses (UARL): Standard IWA/AWWA M36 formula
  // UARL (L/day) = (18 * Lm + 0.8 * Nc + 25 * Lp) * Pavg
  const uarlLitersPerDay = (18.0 * LmKm + 0.8 * Nc + 25.0 * LpKm) * Pavg;
  const uarlM3Year = (uarlLitersPerDay * 365.25) / 1000.0;

  // Current Annual Real Losses (CARL)
  const carlM3Year = realLosses;

  // Infrastructure Leakage Index (ILI = CARL / UARL)
  const rawIli = uarlM3Year > 0 ? carlM3Year / uarlM3Year : 1.0;
  const ili = Math.max(0.5, Math.round(rawIli * 100.0) / 100.0);

  // Performance Band assignment
  let band: WaterLossBand = "B";
  if (ili < 2.0) band = "A";
  else if (ili < 4.0) band = "B";
  else if (ili < 8.0) band = "C";
  else band = "D";

  // Financial impact
  const unitProd = auditInput.unitCostProductionPerM3 ?? 0.45; // $/m3
  const retailRate = auditInput.retailWaterRatePerM3 ?? 1.85; // $/m3
  const realLossCost = realLosses * unitProd;
  const apparentLossRev = apparentLosses * retailRate;

  return {
    systemInputVolumeM3Year: SIV,
    authorizedConsumptionM3Year: authorizedConsumption,
    waterLossesM3Year: totalLosses,
    apparentLossesM3Year: apparentLosses,
    realLossesM3Year: realLosses,
    nonRevenueWaterM3Year: nonRevenueWater,
    nonRevenueWaterPct: Math.round(nonRevenuePct * 10.0) / 10.0,
    carlM3Year,
    uarlM3Year: Math.round(uarlM3Year),
    ili,
    performanceBand: band,
    financialImpact: {
      realLossCostUsd: Math.round(realLossCost),
      apparentLossRevenueLostUsd: Math.round(apparentLossRev),
      totalAnnualLossUsd: Math.round(realLossCost + apparentLossRev),
    },
    networkStats: {
      totalMainsLengthKm: Math.round(LmKm * 100.0) / 100.0,
      avgSystemPressureM: Math.round(Pavg * 10.0) / 10.0,
      serviceConnectionsCount: Nc,
    },
  };
}
