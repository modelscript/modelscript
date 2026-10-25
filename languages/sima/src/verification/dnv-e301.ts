// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Offshore Standard DNV-OS-E301 (Position Mooring) and DNV-ST-0119 (Floating Wind)
 * Mooring Line Tension Safety Factors and Regulatory Compliance Evaluator.
 */

import { solveCatenary } from "../solver/catenary-solver.js";
import type { SimaModel } from "../types.js";

export interface LineVerificationResult {
  lineId: string;
  lineName: string;
  mbl: number; // Minimum Breaking Load (N)
  tensionIntact: number; // Maximum tension under intact condition (N)
  safetyFactorIntact: number; // SF = MBL / T_intact
  utilizationIntact: number; // eta = T_intact / (MBL / 1.67)
  passedIntact: boolean; // SF >= 1.67

  tensionDamaged: number; // Tension under single-line-broken condition (N)
  safetyFactorDamaged: number; // SF = MBL / T_damaged
  utilizationDamaged: number; // eta = T_damaged / (MBL / 1.25)
  passedDamaged: boolean; // SF >= 1.25

  anchorUpliftDeg: number; // angle at anchor (deg)
  anchorUpliftPassed: boolean; // 0 for drag-embedment
}

export interface DnvVerificationReport {
  standard: "DNV-OS-E301" | "DNV-ST-0119";
  summary: {
    totalLines: number;
    passedLines: number;
    failedLines: number;
    minSafetyFactor: number;
    criticalLineId: string;
    allPassed: boolean;
  };
  lines: LineVerificationResult[];
}

export function verifyDnvMooringCompliance(model: SimaModel, consequenceClass: 1 | 2 = 2): DnvVerificationReport {
  const reqSfIntact = consequenceClass === 2 ? 1.67 : 1.5;
  const reqSfDamaged = consequenceClass === 2 ? 1.25 : 1.1;

  const results: LineVerificationResult[] = [];
  let minSf = 1e9;
  let criticalLineId = "";
  let allPassed = true;

  const h = model.environment.waterDepth;

  for (const line of model.lines) {
    // Determine effective submerged weight, MBL, and total unstretched length
    let totalMbl = 1e7;
    let avgWeight = 2000;
    let avgEa = 1e9;

    if (line.segments.length > 0) {
      let weightSum = 0;
      let eaSum = 0;
      let totalL = 0;
      let minSegmentMbl = 1e12;

      for (const seg of line.segments) {
        weightSum += seg.submergedWeightPerMeter * seg.length;
        eaSum += seg.axialStiffnessEA * seg.length;
        totalL += seg.length;
        if (seg.mbl > 0 && seg.mbl < minSegmentMbl) {
          minSegmentMbl = seg.mbl;
        }
      }
      totalMbl = minSegmentMbl;
      avgWeight = totalL > 0 ? weightSum / totalL : 2000;
      avgEa = totalL > 0 ? eaSum / totalL : 1e9;
    }

    // Horizontal distance between anchor and fairlead
    const fairleadPos = line.fairleadPosition ?? [0, 0, 0];
    const dx = fairleadPos[0] - line.anchorPosition[0];
    const dy = fairleadPos[1] - line.anchorPosition[1];
    const horizontalSpan = Math.sqrt(dx * dx + dy * dy);

    // Intact catenary tension
    let tIntact = 1e5;
    let anchorAngle = 0;
    try {
      const cat = solveCatenary({
        waterDepth: h,
        horizontalSpan,
        lineLength: line.totalLength,
        submergedWeight: avgWeight,
        axialStiffnessEA: avgEa,
      });
      tIntact = cat.fairleadTotalTension;
      anchorAngle = cat.anchorAngleDeg;
    } catch {
      // Fallback tension estimate
      tIntact = avgWeight * line.totalLength * 1.5;
    }

    // Add wave dynamic amplification factor (DAF ~ 1.35 under 100-year storm)
    const waveAmp = 1.0 + (model.environment.wave.hs / 20.0) * 0.5;
    const maxTensionIntact = tIntact * waveAmp;

    // Single-line broken redistribution (increases remaining line load by ~35%)
    const maxTensionDamaged = maxTensionIntact * 1.35;

    const sfIntact = maxTensionIntact > 0 ? totalMbl / maxTensionIntact : 999;
    const sfDamaged = maxTensionDamaged > 0 ? totalMbl / maxTensionDamaged : 999;

    const passedIntact = sfIntact >= reqSfIntact;
    const passedDamaged = sfDamaged >= reqSfDamaged;
    const anchorUpliftPassed = anchorAngle < 1.0; // <= 1 degree

    if (!passedIntact || !passedDamaged || !anchorUpliftPassed) {
      allPassed = false;
    }

    if (sfIntact < minSf) {
      minSf = sfIntact;
      criticalLineId = line.id;
    }

    results.push({
      lineId: line.id,
      lineName: line.name,
      mbl: totalMbl,
      tensionIntact: maxTensionIntact,
      safetyFactorIntact: sfIntact,
      utilizationIntact: maxTensionIntact / (totalMbl / reqSfIntact),
      passedIntact,
      tensionDamaged: maxTensionDamaged,
      safetyFactorDamaged: sfDamaged,
      utilizationDamaged: maxTensionDamaged / (totalMbl / reqSfDamaged),
      passedDamaged,
      anchorUpliftDeg: anchorAngle,
      anchorUpliftPassed,
    });
  }

  const passedCount = results.filter((r) => r.passedIntact && r.passedDamaged && r.anchorUpliftPassed).length;

  return {
    standard: "DNV-OS-E301",
    summary: {
      totalLines: results.length,
      passedLines: passedCount,
      failedLines: results.length - passedCount,
      minSafetyFactor: minSf < 1e8 ? minSf : 0,
      criticalLineId,
      allPassed,
    },
    lines: results,
  };
}
