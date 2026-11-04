// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/dicom-rt — Clinical Radiotherapy Dosimetry & Radiobiology Engine.
 *
 * Computes cumulative Dose-Volume Histogram (DVH) statistics (D98%, D95%, D50%, D2%, V20Gy),
 * ICRU Report 83 Homogeneity Index (HI), RTOG & Paddick Conformity Index (CI),
 * Linear-Quadratic (LQ) Biologically Effective Dose (BED), and Equivalent Dose in
 * 2 Gy fractions (EQD2).
 */

import { computeMetricsFromBins, interpolateVolumeAtDose } from "../parser/index.js";
import type { DicomRtDocument, RoiInterpretedType, RtRoiDvh, RtRoiStructure } from "../types.js";

export interface DicomRtDosimetryOptions {
  alphaBetaTumorGy?: number | undefined;
  alphaBetaOarGy?: number | undefined;
}

export interface RtRoiDosimetryReport {
  roiNumber: number;
  roiName: string;
  interpretedType: RoiInterpretedType;
  volumeCc: number;
  d98Gy: number;
  d95Gy: number;
  d50Gy: number;
  d2Gy: number;
  meanDoseGy: number;
  maxDoseGy: number;
  minDoseGy: number;
  v20GyPercent: number;
  homogeneityIndex: number;
  conformityIndex: number;
  paddickConformityIndex: number;
  alphaBetaGy: number;
  bedGy: number;
  eqd2Gy: number;
  withinConstraints: boolean;
}

export interface DicomRtDosimetrySummary {
  planId: string;
  planLabel: string;
  prescribedDoseGy: number;
  fractions: number;
  dosePerFractionGy: number;
  prescriptionBedGy: number;
  prescriptionEqd2Gy: number;
  homogeneityIndex: number;
  conformityIndex: number;
  paddickConformityIndex: number;
  totalMetersetMu: number;
  totalDeliveryTimeSec: number;
  roiReports: RtRoiDosimetryReport[];
}

/**
 * Computes Linear-Quadratic Biologically Effective Dose:
 *   BED = n * d * (1 + d / (alpha/beta)) = D * (1 + (D / n) / (alpha/beta))
 */
export function computeBiologicallyEffectiveDose(totalDoseGy: number, fractions: number, alphaBetaGy = 10.0): number {
  if (totalDoseGy <= 0 || fractions <= 0 || alphaBetaGy <= 0) return 0;
  const d = totalDoseGy / fractions;
  return round4(totalDoseGy * (1.0 + d / alphaBetaGy));
}

/**
 * Computes Equivalent Dose in 2 Gy fractions:
 *   EQD2 = BED / (1 + 2 / (alpha/beta)) = D * (d + alpha/beta) / (2 + alpha/beta)
 */
export function computeEqd2(totalDoseGy: number, fractions: number, alphaBetaGy = 10.0): number {
  if (totalDoseGy <= 0 || fractions <= 0 || alphaBetaGy <= 0) return 0;
  const bed = computeBiologicallyEffectiveDose(totalDoseGy, fractions, alphaBetaGy);
  return round4(bed / (1.0 + 2.0 / alphaBetaGy));
}

/**
 * Computes ICRU Report 83 Homogeneity Index:
 *   HI = (D2% - D98%) / D50%
 */
export function computeHomogeneityIndex(d2Gy: number, d98Gy: number, d50Gy: number): number {
  if (d50Gy <= 0) return 0;
  return round4((d2Gy - d98Gy) / d50Gy);
}

/**
 * Computes RTOG Conformity Index (CI = PIV / TV) and Paddick Conformity Index
 * (CI_Paddick = (TV_PIV)^2 / (TV * PIV)).
 */
export function computeConformityIndex(
  targetVolumeCoveredCc: number,
  targetVolumeCc: number,
  prescriptionIsodoseVolumeCc?: number,
): { rtogCi: number; paddickCi: number } {
  if (targetVolumeCc <= 0) {
    return { rtogCi: 0, paddickCi: 0 };
  }
  const covered = Math.max(0, Math.min(targetVolumeCc, targetVolumeCoveredCc));
  const piv =
    prescriptionIsodoseVolumeCc !== undefined && prescriptionIsodoseVolumeCc > 0
      ? prescriptionIsodoseVolumeCc
      : covered;
  const rtogCi = round4(piv / targetVolumeCc);
  const paddickCi = piv > 0 ? round4((covered * covered) / (targetVolumeCc * piv)) : 0;
  return { rtogCi, paddickCi };
}

/**
 * Evaluates full clinical dosimetry and radiobiological indices for a DICOM-RT document.
 */
export function evaluateDicomRtDosimetry(
  doc: DicomRtDocument,
  options?: DicomRtDosimetryOptions,
): DicomRtDosimetrySummary {
  const alphaBetaTumor = options?.alphaBetaTumorGy ?? 10.0;
  const alphaBetaOar = options?.alphaBetaOarGy ?? 3.0;
  const fractions = Math.max(1, doc.fractions);
  const rxDose = Math.max(0, doc.prescribedDoseGy);
  const dosePerFractionGy = round4(rxDose / fractions);

  const prescriptionBedGy = computeBiologicallyEffectiveDose(rxDose, fractions, alphaBetaTumor);
  const prescriptionEqd2Gy = computeEqd2(rxDose, fractions, alphaBetaTumor);

  const structByNumber = new Map<number, RtRoiStructure>();
  const structByName = new Map<string, RtRoiStructure>();
  for (const s of doc.structures) {
    structByNumber.set(s.roiNumber, s);
    structByName.set(s.name.toLowerCase(), s);
  }

  const dvhByNumber = new Map<number, RtRoiDvh>();
  for (const d of doc.dvhs) {
    dvhByNumber.set(d.roiNumber, d);
  }

  // Ensure every DVH is evaluated, as well as structures with DVHs
  const roiReports: RtRoiDosimetryReport[] = [];
  let primaryTargetReport: RtRoiDosimetryReport | undefined;

  for (const dvh of doc.dvhs) {
    const struct = structByNumber.get(dvh.roiNumber) ?? structByName.get(dvh.roiName.toLowerCase());
    const interpretedType: RoiInterpretedType =
      struct?.interpretedType ?? (dvh.roiName.toUpperCase().includes("PTV") ? "PTV" : "ORGAN");
    const volumeCc = struct?.volumeCc ?? 100.0;

    const binMetrics = dvh.bins.length > 0 ? computeMetricsFromBins(dvh.bins) : undefined;
    const d98Gy = dvh.d98Gy > 0 ? dvh.d98Gy : (binMetrics?.d98Gy ?? 0);
    const d95Gy = dvh.d95Gy > 0 ? dvh.d95Gy : (binMetrics?.d95Gy ?? 0);
    const d50Gy = dvh.d50Gy > 0 ? dvh.d50Gy : (binMetrics?.d50Gy ?? 0);
    const d2Gy = dvh.d2Gy > 0 ? dvh.d2Gy : (binMetrics?.d2Gy ?? 0);
    const meanDoseGy = dvh.meanDoseGy > 0 ? dvh.meanDoseGy : (binMetrics?.meanDoseGy ?? d50Gy);
    const maxDoseGy = dvh.maxDoseGy > 0 ? dvh.maxDoseGy : (binMetrics?.maxDoseGy ?? d2Gy);
    const minDoseGy = dvh.minDoseGy > 0 ? dvh.minDoseGy : (binMetrics?.minDoseGy ?? d98Gy);
    const v20GyPercent = dvh.v20GyPercent > 0 ? dvh.v20GyPercent : (binMetrics?.v20GyPercent ?? 0);

    const isTarget = interpretedType === "PTV" || interpretedType === "CTV" || interpretedType === "GTV";
    const alphaBetaGy = isTarget ? alphaBetaTumor : alphaBetaOar;

    const homogeneityIndex = computeHomogeneityIndex(d2Gy, d98Gy, d50Gy);

    // Estimate covered target volume at 95% prescription isodose
    let coverageFraction = 0.95;
    if (rxDose > 0) {
      if (dvh.bins.length > 1) {
        const sorted = [...dvh.bins].sort((a, b) => a.doseGy - b.doseGy);
        coverageFraction = interpolateVolumeAtDose(sorted, 0.95 * rxDose) / 100.0;
      } else {
        coverageFraction = Math.min(1.0, Math.max(0.0, (d95Gy / rxDose) * 0.98));
      }
    }
    const coveredVolCc = volumeCc * coverageFraction;
    // Estimate prescription isodose volume (PIV) including small normal-tissue spill
    const spillFactor = d2Gy > rxDose && rxDose > 0 ? Math.max(1.0, d2Gy / rxDose) : 1.02;
    const pivCc = isTarget ? coveredVolCc * spillFactor : coveredVolCc;
    const { rtogCi, paddickCi } = isTarget
      ? computeConformityIndex(coveredVolCc, volumeCc, pivCc)
      : { rtogCi: 0, paddickCi: 0 };

    const refDoseForBed = isTarget ? (d50Gy > 0 ? d50Gy : meanDoseGy) : meanDoseGy;
    const bedGy = computeBiologicallyEffectiveDose(refDoseForBed, fractions, alphaBetaGy);
    const eqd2Gy = computeEqd2(refDoseForBed, fractions, alphaBetaGy);

    let withinConstraints = true;
    if (struct?.maxDoseLimitGy !== undefined && maxDoseGy > struct.maxDoseLimitGy + 1e-6) {
      withinConstraints = false;
    }
    if (struct?.meanDoseLimitGy !== undefined && meanDoseGy > struct.meanDoseLimitGy + 1e-6) {
      withinConstraints = false;
    }
    if (interpretedType === "PTV" && rxDose > 0 && d95Gy < 0.95 * rxDose - 1e-6) {
      withinConstraints = false;
    }

    const report: RtRoiDosimetryReport = {
      roiNumber: dvh.roiNumber,
      roiName: struct?.name ?? dvh.roiName,
      interpretedType,
      volumeCc,
      d98Gy,
      d95Gy,
      d50Gy,
      d2Gy,
      meanDoseGy,
      maxDoseGy,
      minDoseGy,
      v20GyPercent,
      homogeneityIndex,
      conformityIndex: rtogCi,
      paddickConformityIndex: paddickCi,
      alphaBetaGy,
      bedGy,
      eqd2Gy,
      withinConstraints,
    };

    roiReports.push(report);
    if (!primaryTargetReport && interpretedType === "PTV") {
      primaryTargetReport = report;
    } else if (!primaryTargetReport && isTarget) {
      primaryTargetReport = report;
    }
  }

  let totalMetersetMu = 0;
  let totalDeliveryTimeSec = 0;
  for (const b of doc.beams) {
    if (b.treatmentDeliveryType === "TREATMENT" && b.metersetMu > 0) {
      totalMetersetMu += b.metersetMu;
      const ratePerMin = b.doseRateMuPerMin > 0 ? b.doseRateMuPerMin : 600.0;
      totalDeliveryTimeSec += (b.metersetMu / ratePerMin) * 60.0;
    }
  }

  return {
    planId: doc.planId,
    planLabel: doc.planLabel,
    prescribedDoseGy: rxDose,
    fractions,
    dosePerFractionGy,
    prescriptionBedGy,
    prescriptionEqd2Gy,
    homogeneityIndex: primaryTargetReport?.homogeneityIndex ?? 0,
    conformityIndex: primaryTargetReport?.conformityIndex ?? 1.0,
    paddickConformityIndex: primaryTargetReport?.paddickConformityIndex ?? 1.0,
    totalMetersetMu: round4(totalMetersetMu),
    totalDeliveryTimeSec: round4(totalDeliveryTimeSec),
    roiReports,
  };
}

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}
