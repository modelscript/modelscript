// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lowerDicomRtToDae } from "../src/dae/index.js";
import {
  computeBiologicallyEffectiveDose,
  computeConformityIndex,
  computeEqd2,
  computeHomogeneityIndex,
  evaluateDicomRtDosimetry,
} from "../src/dosimetry/index.js";
import { parseDicomRt } from "../src/parser/index.js";

describe("DICOM-RT Clinical Dosimetry (DVH, BED, EQD2, CI, HI) & DAEBuilder Lowering", () => {
  it("computes BED, EQD2, Homogeneity Index (HI), and Conformity Index (CI) accurately", () => {
    // 60 Gy in 30 fractions (2 Gy/fx) with alpha/beta = 10 Gy:
    // BED = 60 * (1 + 2/10) = 72.0 Gy
    // EQD2 = 72 / (1 + 2/10) = 60.0 Gy
    const bed60 = computeBiologicallyEffectiveDose(60.0, 30, 10.0);
    const eqd2_60 = computeEqd2(60.0, 30, 10.0);
    assert.strictEqual(bed60, 72.0);
    assert.strictEqual(eqd2_60, 60.0);

    // Hypofractionated SBRT: 54 Gy in 3 fractions (18 Gy/fx) with alpha/beta = 10 Gy:
    // BED = 54 * (1 + 18/10) = 54 * 2.8 = 151.2 Gy
    // EQD2 = 151.2 / 1.2 = 126.0 Gy
    const bedSbrt = computeBiologicallyEffectiveDose(54.0, 3, 10.0);
    const eqd2Sbrt = computeEqd2(54.0, 3, 10.0);
    assert.strictEqual(bedSbrt, 151.2);
    assert.strictEqual(eqd2Sbrt, 126.0);

    // ICRU 83 HI = (D2% - D98%) / D50% = (63 - 57) / 60 = 0.1
    const hi = computeHomogeneityIndex(63.0, 57.0, 60.0);
    assert.strictEqual(hi, 0.1);

    // Conformity index
    const ci = computeConformityIndex(95.0, 100.0, 100.0);
    assert.strictEqual(ci.rtogCi, 1.0);
    assert.strictEqual(ci.paddickCi, 0.9025);
  });

  it("evaluates full document dosimetry and lowers linac + LQ survival ODEs into DAEBuilder", () => {
    const xml = `
      <DicomRtPlan planId="HN-IMRT-70" planLabel="HeadNeck_70Gy" patientId="PT-70" prescribedDoseGy="70.0" fractions="35">
        <StructureSet>
          <ROI roiNumber="1" name="PTV_70" interpretedType="PTV" volumeCc="140.0" />
          <ROI roiNumber="2" name="Parotid_L" interpretedType="ORGAN" volumeCc="28.0" meanDoseLimitGy="26.0" />
        </StructureSet>
        <BeamSequence>
          <Beam beamNumber="1" name="IMRT_B1" modality="PHOTON" treatmentDeliveryType="TREATMENT" energyMeV="6.0" metersetMu="300.0" doseRateMuPerMin="600.0">
            <ControlPoint index="0" cumulativeMetersetWeight="0.0" gantryAngleDeg="0.0" collimatorAngleDeg="10.0" couchAngleDeg="0.0">
              <MLCLeafPair pairIndex="1" bankA_mm="-20.0" bankB_mm="20.0" />
              <MLCLeafPair pairIndex="2" bankA_mm="-15.0" bankB_mm="15.0" />
            </ControlPoint>
            <ControlPoint index="1" cumulativeMetersetWeight="1.0" gantryAngleDeg="60.0" collimatorAngleDeg="20.0" couchAngleDeg="0.0">
              <MLCLeafPair pairIndex="1" bankA_mm="-10.0" bankB_mm="10.0" />
              <MLCLeafPair pairIndex="2" bankA_mm="-15.0" bankB_mm="15.0" />
            </ControlPoint>
          </Beam>
        </BeamSequence>
        <DoseDistribution>
          <DVH roiNumber="1" roiName="PTV_70" d98Gy="67.2" d95Gy="68.5" d50Gy="70.0" d2Gy="72.8" meanDoseGy="70.1" maxDoseGy="73.5" minDoseGy="65.0" v20GyPercent="100.0" />
          <DVH roiNumber="2" roiName="Parotid_L" d98Gy="4.0" d95Gy="6.0" d50Gy="18.0" d2Gy="42.0" meanDoseGy="21.0" maxDoseGy="45.0" minDoseGy="2.0" v20GyPercent="44.0" />
        </DoseDistribution>
      </DicomRtPlan>
    `;

    const doc = parseDicomRt(xml);
    const summary = evaluateDicomRtDosimetry(doc);

    assert.strictEqual(summary.dosePerFractionGy, 2.0);
    assert.strictEqual(summary.prescriptionBedGy, 84.0);
    assert.strictEqual(summary.prescriptionEqd2Gy, 70.0);
    assert.strictEqual(summary.homogeneityIndex, 0.08);
    assert.strictEqual(summary.totalMetersetMu, 300.0);
    assert.strictEqual(summary.totalDeliveryTimeSec, 30.0);
    assert.strictEqual(summary.roiReports.length, 2);
    assert.strictEqual(summary.roiReports[0]?.withinConstraints, true);
    assert.strictEqual(summary.roiReports[1]?.withinConstraints, true);

    // Lower to DAEBuilder
    const dae = lowerDicomRtToDae(doc);
    assert(dae.getVarCount() >= 14);
    assert(dae.getEqCount() >= 14);
  });
});
