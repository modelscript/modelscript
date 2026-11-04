// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/dicom-rt — Linear-Memory DAEBuilder Lowering for Linac Kinematics & Radiobiology.
 *
 * Lowers DICOM-RT treatment plans directly into ModelScript's linear-memory DAEBuilder:
 *   1. Linac gantry angle and collimator rotation ODEs: der(gantry_angle), der(collimator_angle)
 *   2. Multileaf Collimator (MLC) effective aperture area and beam dose-rate equations
 *   3. Cumulative dose delivery state equation: der(cumulative_dose_Gy) = total_dose_rate_Gy_per_s
 *   4. Linear-Quadratic (LQ) clonogenic cell survival kinetics ODEs:
 *      der(S_roi) = -(alpha + 2 * beta * cumulative_dose_Gy) * total_dose_rate_Gy_per_s * S_roi
 */

import { BinOp, Causality, DAEBuilder, EqKind, StringInterner, Variability, VarType } from "@modelscript/runtime";
import type { DicomRtDocument, RtBeam } from "../types.js";

export interface DicomRtDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
  leafWidthMm?: number | undefined;
  alphaTumorPerGy?: number | undefined;
  betaTumorPerGy2?: number | undefined;
}

export function lowerDicomRtToDae(doc: DicomRtDocument, options?: DicomRtDaeOptions): DAEBuilder {
  const modelName = sanitizeIdent(options?.modelName ?? (doc.planLabel || doc.planId || "DicomRtTreatmentPlan"));
  const interner = new StringInterner();
  const dae = options?.builder ?? new DAEBuilder(interner, modelName);

  const leafWidthMm = options?.leafWidthMm ?? 5.0;
  const alphaTumor = options?.alphaTumorPerGy ?? 0.3;
  const betaTumor = options?.betaTumorPerGy2 ?? 0.03;

  const addAdd = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Add, a, b);
  const addMul = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Mul, a, b);
  const addDiv = (a: number, b: number): number => dae.addBinaryExpr(BinOp.Div, a, b);

  // 1. Plan-level prescription and radiobiological parameters
  const rxVar = dae.addVariable(
    "prescribed_dose_Gy",
    VarType.Real,
    Variability.Parameter,
    Causality.Local,
    doc.prescribedDoseGy,
  );
  dae.addEquation(EqKind.Simple, dae.addName(rxVar), dae.addRealLiteral(doc.prescribedDoseGy));

  const fracVar = dae.addVariable("fractions", VarType.Real, Variability.Parameter, Causality.Local, doc.fractions);
  dae.addEquation(EqKind.Simple, dae.addName(fracVar), dae.addRealLiteral(doc.fractions));

  const alphaVar = dae.addVariable(
    "alpha_tumor_per_Gy",
    VarType.Real,
    Variability.Parameter,
    Causality.Local,
    alphaTumor,
  );
  dae.addEquation(EqKind.Simple, dae.addName(alphaVar), dae.addRealLiteral(alphaTumor));

  const betaVar = dae.addVariable(
    "beta_tumor_per_Gy2",
    VarType.Real,
    Variability.Parameter,
    Causality.Local,
    betaTumor,
  );
  dae.addEquation(EqKind.Simple, dae.addName(betaVar), dae.addRealLiteral(betaTumor));

  // 2. Per-beam linac kinematics (gantry, collimator, MLC aperture area, beam dose rate)
  let netDoseRateExpr: number | null = null;

  for (const beam of doc.beams) {
    const bPrefix = `beam_${beam.beamNumber}`;

    const energyVar = dae.addVariable(
      `${bPrefix}_energy_MeV`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      beam.energyMeV,
    );
    dae.addEquation(EqKind.Simple, dae.addName(energyVar), dae.addRealLiteral(beam.energyMeV));

    const muVar = dae.addVariable(
      `${bPrefix}_meterset_MU`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      beam.metersetMu,
    );
    dae.addEquation(EqKind.Simple, dae.addName(muVar), dae.addRealLiteral(beam.metersetMu));

    const drMuMinVar = dae.addVariable(
      `${bPrefix}_dose_rate_MU_per_min`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      beam.doseRateMuPerMin,
    );
    dae.addEquation(EqKind.Simple, dae.addName(drMuMinVar), dae.addRealLiteral(beam.doseRateMuPerMin));

    const kinematics = computeBeamKinematics(beam, leafWidthMm);

    // Gantry angle state variable & ODE: der(beam_k_gantry_angle_deg) = omega_gantry
    const gantryVar = dae.addVariable(
      `${bPrefix}_gantry_angle_deg`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      kinematics.initialGantryDeg,
    );
    dae.addEquation(EqKind.Simple, dae.addDer(gantryVar), dae.addRealLiteral(kinematics.gantrySpeedDegPerSec));

    // Collimator angle state variable & ODE: der(beam_k_collimator_angle_deg) = omega_collimator
    const collVar = dae.addVariable(
      `${bPrefix}_collimator_angle_deg`,
      VarType.Real,
      Variability.Continuous,
      Causality.Local,
      kinematics.initialCollimatorDeg,
    );
    dae.addEquation(EqKind.Simple, dae.addDer(collVar), dae.addRealLiteral(kinematics.collimatorSpeedDegPerSec));

    // MLC effective aperture area (mm^2)
    const apertureVar = dae.addVariable(
      `${bPrefix}_mlc_aperture_mm2`,
      VarType.Real,
      Variability.Continuous,
      Causality.Output,
      kinematics.meanApertureAreaMm2,
    );
    dae.addEquation(EqKind.Simple, dae.addName(apertureVar), dae.addRealLiteral(kinematics.meanApertureAreaMm2));

    // Instantaneous beam dose rate (Gy/s): (doseRateMuPerMin / 60.0) * 0.01 Gy/MU
    const beamDoseRateVar = dae.addVariable(
      `${bPrefix}_dose_rate_Gy_per_s`,
      VarType.Real,
      Variability.Continuous,
      Causality.Output,
      0.0,
    );
    const rateExpr =
      beam.treatmentDeliveryType === "TREATMENT" && beam.metersetMu > 0
        ? addMul(addDiv(dae.addName(drMuMinVar), dae.addRealLiteral(60.0)), dae.addRealLiteral(0.01))
        : dae.addRealLiteral(0.0);
    dae.addEquation(EqKind.Simple, dae.addName(beamDoseRateVar), rateExpr);

    if (beam.treatmentDeliveryType === "TREATMENT") {
      netDoseRateExpr =
        netDoseRateExpr === null ? dae.addName(beamDoseRateVar) : addAdd(netDoseRateExpr, dae.addName(beamDoseRateVar));
    }
  }

  // 3. Total dose rate and cumulative dose state ODE
  const totalDoseRateVar = dae.addVariable(
    "total_dose_rate_Gy_per_s",
    VarType.Real,
    Variability.Continuous,
    Causality.Output,
    0.1,
  );
  dae.addEquation(
    EqKind.Simple,
    dae.addName(totalDoseRateVar),
    netDoseRateExpr !== null ? netDoseRateExpr : dae.addRealLiteral(0.1),
  );

  const cumDoseVar = dae.addVariable("cumulative_dose_Gy", VarType.Real, Variability.Continuous, Causality.Output, 0.0);
  dae.addEquation(EqKind.Simple, dae.addDer(cumDoseVar), dae.addName(totalDoseRateVar));

  // 4. Linear-Quadratic (LQ) Cell Survival ODE:
  //    der(surviving_fraction_S) = -(alpha + 2 * beta * cumulative_dose_Gy) * total_dose_rate_Gy_per_s * surviving_fraction_S
  const survivalVar = dae.addVariable(
    "surviving_fraction_S",
    VarType.Real,
    Variability.Continuous,
    Causality.Output,
    1.0,
  );
  const twoBetaDose = addMul(addMul(dae.addRealLiteral(2.0), dae.addName(betaVar)), dae.addName(cumDoseVar));
  const alphaPlusTwoBetaDose = addAdd(dae.addName(alphaVar), twoBetaDose);
  const hazardRate = addMul(alphaPlusTwoBetaDose, dae.addName(totalDoseRateVar));
  const survivalRhs = dae.addNegateExpr(addMul(hazardRate, dae.addName(survivalVar)));
  dae.addEquation(EqKind.Simple, dae.addDer(survivalVar), survivalRhs);

  // Also emit per-ROI LQ survival state variables for target structures
  for (const roi of doc.structures) {
    if (roi.interpretedType === "PTV" || roi.interpretedType === "CTV" || roi.interpretedType === "GTV") {
      const roiIdent = sanitizeIdent(roi.name);
      const roiSurvivalVar = dae.addVariable(
        `S_${roiIdent}`,
        VarType.Real,
        Variability.Continuous,
        Causality.Output,
        1.0,
      );
      const roiRhs = dae.addNegateExpr(addMul(hazardRate, dae.addName(roiSurvivalVar)));
      dae.addEquation(EqKind.Simple, dae.addDer(roiSurvivalVar), roiRhs);
    }
  }

  return dae;
}

function computeBeamKinematics(
  beam: RtBeam,
  leafWidthMm: number,
): {
  initialGantryDeg: number;
  gantrySpeedDegPerSec: number;
  initialCollimatorDeg: number;
  collimatorSpeedDegPerSec: number;
  meanApertureAreaMm2: number;
} {
  const cps = beam.controlPoints;
  if (cps.length === 0) {
    return {
      initialGantryDeg: 0,
      gantrySpeedDegPerSec: 0,
      initialCollimatorDeg: 0,
      collimatorSpeedDegPerSec: 0,
      meanApertureAreaMm2: 10000.0,
    };
  }

  const first = cps[0]!;
  const last = cps[cps.length - 1]!;
  const deliveryTimeSec =
    beam.doseRateMuPerMin > 0 && beam.metersetMu > 0 ? (beam.metersetMu / beam.doseRateMuPerMin) * 60.0 : 10.0;

  const gantryDelta = last.gantryAngleDeg - first.gantryAngleDeg;
  const collDelta = last.collimatorAngleDeg - first.collimatorAngleDeg;
  const gantrySpeedDegPerSec = deliveryTimeSec > 0 ? gantryDelta / deliveryTimeSec : 0;
  const collimatorSpeedDegPerSec = deliveryTimeSec > 0 ? collDelta / deliveryTimeSec : 0;

  let areaSum = 0;
  for (const cp of cps) {
    if (cp.mlcLeaves.length > 0) {
      let cpArea = 0;
      for (const leaf of cp.mlcLeaves) {
        const gap = Math.max(0, leaf.bankB_mm - leaf.bankA_mm);
        cpArea += gap * leafWidthMm;
      }
      areaSum += cpArea;
    } else {
      const dx = Math.max(0, cp.jawX_mm[1] - cp.jawX_mm[0]);
      const dy = Math.max(0, cp.jawY_mm[1] - cp.jawY_mm[0]);
      areaSum += dx * dy;
    }
  }

  return {
    initialGantryDeg: first.gantryAngleDeg,
    gantrySpeedDegPerSec: Math.round(gantrySpeedDegPerSec * 10000) / 10000,
    initialCollimatorDeg: first.collimatorAngleDeg,
    collimatorSpeedDegPerSec: Math.round(collimatorSpeedDegPerSec * 10000) / 10000,
    meanApertureAreaMm2: Math.round((areaSum / cps.length) * 10000) / 10000,
  };
}

function sanitizeIdent(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned || "DicomRtModel";
}
