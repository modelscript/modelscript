// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { DicomRtErrorCode, lintDicomRtDocument } from "../src/lints/index.js";
import { parseDicomRt } from "../src/parser/index.js";

const VALID_PLAN_XML = `
<DicomRtPlan
  planId="VALID-01"
  planLabel="Valid_IMRT"
  patientId="PT-001"
  frameOfReferenceUid="1.2.840.10008.1.1"
  structFrameOfReferenceUid="1.2.840.10008.1.1"
  doseFrameOfReferenceUid="1.2.840.10008.1.1"
  prescribedDoseGy="60.0"
  fractions="30"
>
  <StructureSet>
    <ROI roiNumber="1" name="PTV_60" interpretedType="PTV" volumeCc="100.0">
      <Contour z="0.0" geometricType="CLOSED_PLANAR" points="-20,-20,0; 20,-20,0; 20,20,0; -20,20,0" />
    </ROI>
    <ROI roiNumber="2" name="SpinalCord" interpretedType="ORGAN" volumeCc="25.0" maxDoseLimitGy="45.0" meanDoseLimitGy="25.0">
      <Contour z="0.0" geometricType="CLOSED_PLANAR" points="-5,-40,0; 5,-40,0; 0,-30,0" />
    </ROI>
  </StructureSet>
  <BeamSequence>
    <Beam beamNumber="1" name="B1" modality="PHOTON" treatmentDeliveryType="TREATMENT" energyMeV="6.0" metersetMu="200.0" doseRateMuPerMin="600.0">
      <ControlPoint index="0" cumulativeMetersetWeight="0.0" gantryAngleDeg="0.0" collimatorAngleDeg="0.0" couchAngleDeg="0.0" jawX_mm="-40,40" jawY_mm="-40,40">
        <MLCLeafPair pairIndex="1" bankA_mm="-20.0" bankB_mm="20.0" />
      </ControlPoint>
      <ControlPoint index="1" cumulativeMetersetWeight="1.0" gantryAngleDeg="45.0" collimatorAngleDeg="0.0" couchAngleDeg="0.0" jawX_mm="-40,40" jawY_mm="-40,40">
        <MLCLeafPair pairIndex="1" bankA_mm="-15.0" bankB_mm="15.0" />
      </ControlPoint>
    </Beam>
  </BeamSequence>
  <DoseDistribution>
    <DVH roiNumber="1" roiName="PTV_60" d98Gy="57.5" d95Gy="58.2" d50Gy="60.1" d2Gy="62.0" meanDoseGy="60.0" maxDoseGy="62.5" minDoseGy="56.0" v20GyPercent="100.0" />
    <DVH roiNumber="2" roiName="SpinalCord" d98Gy="2.0" d95Gy="4.0" d50Gy="15.0" d2Gy="38.0" meanDoseGy="16.0" maxDoseGy="40.0" minDoseGy="1.0" v20GyPercent="25.0" />
  </DoseDistribution>
</DicomRtPlan>
`;

describe("DICOM-RT Clinical Physics & QUANTEC Linter (M9201–M9210)", () => {
  it("produces zero diagnostics for a valid clinical DICOM-RT plan", () => {
    const doc = parseDicomRt(VALID_PLAN_XML);
    const diags = lintDicomRtDocument(doc);
    assert.strictEqual(diags.length, 0);
  });

  it("detects M9201 (dicom-rt-missing-target-volume) when no PTV/CTV/GTV is present", () => {
    const xml = `
      <DicomRtPlan planId="P1" planLabel="NoTargetPlan" prescribedDoseGy="60" fractions="30">
        <StructureSet>
          <ROI roiNumber="1" name="Body" interpretedType="EXTERNAL" volumeCc="5000" />
          <ROI roiNumber="2" name="Parotid" interpretedType="ORGAN" volumeCc="30" />
        </StructureSet>
      </DicomRtPlan>
    `;
    const diags = lintDicomRtDocument(parseDicomRt(xml));
    assert(diags.some((d) => d.code === DicomRtErrorCode.MISSING_TARGET_VOLUME.code));
  });

  it("detects M9202 (dicom-rt-mlc-leaf-overlap) when MLC gap < 0.5 mm or bankA > bankB", () => {
    const xml = `
      <DicomRtPlan planId="P2" planLabel="MlcOverlap">
        <StructureSet><ROI roiNumber="1" name="PTV" interpretedType="PTV" volumeCc="100" /></StructureSet>
        <BeamSequence>
          <Beam beamNumber="1" name="B1" modality="PHOTON" treatmentDeliveryType="TREATMENT" energyMeV="6" metersetMu="100" doseRateMuPerMin="600">
            <ControlPoint index="0" cumulativeMetersetWeight="0.0" gantryAngleDeg="0" collimatorAngleDeg="0" couchAngleDeg="0">
              <MLCLeafPair pairIndex="1" bankA_mm="5.0" bankB_mm="5.2" />
            </ControlPoint>
            <ControlPoint index="1" cumulativeMetersetWeight="1.0" gantryAngleDeg="0" collimatorAngleDeg="0" couchAngleDeg="0">
              <MLCLeafPair pairIndex="1" bankA_mm="-10.0" bankB_mm="10.0" />
            </ControlPoint>
          </Beam>
        </BeamSequence>
      </DicomRtPlan>
    `;
    const diags = lintDicomRtDocument(parseDicomRt(xml));
    assert(diags.some((d) => d.code === DicomRtErrorCode.MLC_LEAF_OVERLAP.code));
  });

  it("detects M9203 (dicom-rt-mlc-speed-exceeded) when leaf travel speed exceeds 25.0 mm/s", () => {
    // 10 MU at 600 MU/min => 1.0 sec delivery; leaf moves from -30 mm to +10 mm = 40 mm in 1.0 s => 40 mm/s > 25 mm/s
    const xml = `
      <DicomRtPlan planId="P3" planLabel="MlcFast">
        <StructureSet><ROI roiNumber="1" name="PTV" interpretedType="PTV" volumeCc="100" /></StructureSet>
        <BeamSequence>
          <Beam beamNumber="1" name="B1" modality="PHOTON" treatmentDeliveryType="TREATMENT" energyMeV="6" metersetMu="10" doseRateMuPerMin="600">
            <ControlPoint index="0" cumulativeMetersetWeight="0.0" gantryAngleDeg="0" collimatorAngleDeg="0" couchAngleDeg="0">
              <MLCLeafPair pairIndex="1" bankA_mm="-30.0" bankB_mm="30.0" />
            </ControlPoint>
            <ControlPoint index="1" cumulativeMetersetWeight="1.0" gantryAngleDeg="10" collimatorAngleDeg="0" couchAngleDeg="0">
              <MLCLeafPair pairIndex="1" bankA_mm="10.0" bankB_mm="30.0" />
            </ControlPoint>
          </Beam>
        </BeamSequence>
      </DicomRtPlan>
    `;
    const diags = lintDicomRtDocument(parseDicomRt(xml));
    assert(diags.some((d) => d.code === DicomRtErrorCode.MLC_SPEED_EXCEEDED.code));
  });

  it("detects M9204 (dicom-rt-gantry-couch-collision) for non-coplanar couch and lateral gantry", () => {
    const xml = `
      <DicomRtPlan planId="P4" planLabel="CollisionPlan">
        <StructureSet><ROI roiNumber="1" name="PTV" interpretedType="PTV" volumeCc="100" /></StructureSet>
        <BeamSequence>
          <Beam beamNumber="1" name="NonCoplanarBeam" modality="PHOTON" treatmentDeliveryType="TREATMENT" energyMeV="6" metersetMu="100" doseRateMuPerMin="600">
            <ControlPoint index="0" cumulativeMetersetWeight="0.0" gantryAngleDeg="90.0" collimatorAngleDeg="0.0" couchAngleDeg="35.0" />
            <ControlPoint index="1" cumulativeMetersetWeight="1.0" gantryAngleDeg="95.0" collimatorAngleDeg="0.0" couchAngleDeg="35.0" />
          </Beam>
        </BeamSequence>
      </DicomRtPlan>
    `;
    const diags = lintDicomRtDocument(parseDicomRt(xml));
    assert(diags.some((d) => d.code === DicomRtErrorCode.GANTRY_COUCH_COLLISION.code));
  });

  it("detects M9205 (dicom-rt-oar-dose-constraint-violated) when ORGAN DVH exceeds QUANTEC limit", () => {
    const xml = `
      <DicomRtPlan planId="P5" planLabel="OarOverdose" prescribedDoseGy="60" fractions="30">
        <StructureSet>
          <ROI roiNumber="1" name="PTV" interpretedType="PTV" volumeCc="100" />
          <ROI roiNumber="2" name="SpinalCord" interpretedType="ORGAN" volumeCc="20" maxDoseLimitGy="45.0" meanDoseLimitGy="25.0" />
        </StructureSet>
        <DoseDistribution>
          <DVH roiNumber="2" roiName="SpinalCord" d98Gy="10" d95Gy="12" d50Gy="28" d2Gy="48" meanDoseGy="29.5" maxDoseGy="49.2" minDoseGy="5" v20GyPercent="60" />
        </DoseDistribution>
      </DicomRtPlan>
    `;
    const diags = lintDicomRtDocument(parseDicomRt(xml));
    const m9205 = diags.filter((d) => d.code === DicomRtErrorCode.OAR_DOSE_CONSTRAINT_VIOLATED.code);
    assert.strictEqual(m9205.length, 2); // Both maxDoseLimitGy and meanDoseLimitGy violated
  });

  it("detects M9206 (dicom-rt-non-monotonic-cum-meterset) for non-monotonic or unnormalized weights", () => {
    const xml = `
      <DicomRtPlan planId="P6" planLabel="NonMonotonicWeights">
        <StructureSet><ROI roiNumber="1" name="PTV" interpretedType="PTV" volumeCc="100" /></StructureSet>
        <BeamSequence>
          <Beam beamNumber="1" name="B1" modality="PHOTON" treatmentDeliveryType="TREATMENT" energyMeV="6" metersetMu="100" doseRateMuPerMin="600">
            <ControlPoint index="0" cumulativeMetersetWeight="0.0" gantryAngleDeg="0" collimatorAngleDeg="0" couchAngleDeg="0" />
            <ControlPoint index="1" cumulativeMetersetWeight="0.7" gantryAngleDeg="20" collimatorAngleDeg="0" couchAngleDeg="0" />
            <ControlPoint index="2" cumulativeMetersetWeight="0.5" gantryAngleDeg="40" collimatorAngleDeg="0" couchAngleDeg="0" />
            <ControlPoint index="3" cumulativeMetersetWeight="1.0" gantryAngleDeg="60" collimatorAngleDeg="0" couchAngleDeg="0" />
          </Beam>
        </BeamSequence>
      </DicomRtPlan>
    `;
    const diags = lintDicomRtDocument(parseDicomRt(xml));
    assert(diags.some((d) => d.code === DicomRtErrorCode.NON_MONOTONIC_CUM_METERSET.code));
  });

  it("detects M9207 (dicom-rt-unclosed-roi-contour) when CLOSED_PLANAR slice has < 3 points", () => {
    const xml = `
      <DicomRtPlan planId="P7" planLabel="DegenerateContour">
        <StructureSet>
          <ROI roiNumber="1" name="PTV" interpretedType="PTV" volumeCc="100">
            <Contour z="5.0" geometricType="CLOSED_PLANAR" points="0,0,5; 10,10,5" />
          </ROI>
        </StructureSet>
      </DicomRtPlan>
    `;
    const diags = lintDicomRtDocument(parseDicomRt(xml));
    assert(diags.some((d) => d.code === DicomRtErrorCode.UNCLOSED_ROI_CONTOUR.code));
  });

  it("detects M9208 (dicom-rt-unresolved-frame-of-reference) when RTSTRUCT or RTDOSE UID mismatches plan", () => {
    const xml = `
      <DicomRtPlan
        planId="P8"
        planLabel="MismatchedFoR"
        frameOfReferenceUid="1.2.840.10008.100"
        structFrameOfReferenceUid="1.2.840.10008.200"
        doseFrameOfReferenceUid="1.2.840.10008.300"
      >
        <StructureSet><ROI roiNumber="1" name="PTV" interpretedType="PTV" volumeCc="100" /></StructureSet>
      </DicomRtPlan>
    `;
    const diags = lintDicomRtDocument(parseDicomRt(xml));
    const m9208 = diags.filter((d) => d.code === DicomRtErrorCode.UNRESOLVED_FRAME_OF_REFERENCE.code);
    assert.strictEqual(m9208.length, 2);
  });

  it("detects M9209 (dicom-rt-invalid-beam-meterset) when TREATMENT beam has metersetMu <= 0 or energyMeV <= 0", () => {
    const xml = `
      <DicomRtPlan planId="P9" planLabel="ZeroMuBeam">
        <StructureSet><ROI roiNumber="1" name="PTV" interpretedType="PTV" volumeCc="100" /></StructureSet>
        <BeamSequence>
          <Beam beamNumber="1" name="ZeroMU" modality="PHOTON" treatmentDeliveryType="TREATMENT" energyMeV="6.0" metersetMu="0.0" doseRateMuPerMin="600" />
        </BeamSequence>
      </DicomRtPlan>
    `;
    const diags = lintDicomRtDocument(parseDicomRt(xml));
    assert(diags.some((d) => d.code === DicomRtErrorCode.INVALID_BEAM_METERSET.code));
  });

  it("detects M9210 (dicom-rt-ptv-underdosage) when PTV D95% < 95% of prescribedDoseGy", () => {
    const xml = `
      <DicomRtPlan planId="P10" planLabel="UnderdosedPtv" prescribedDoseGy="70.0" fractions="35">
        <StructureSet>
          <ROI roiNumber="1" name="PTV_70" interpretedType="PTV" volumeCc="120" />
        </StructureSet>
        <DoseDistribution>
          <DVH roiNumber="1" roiName="PTV_70" d98Gy="60.0" d95Gy="63.0" d50Gy="69.5" d2Gy="72.0" meanDoseGy="69.0" maxDoseGy="73.0" minDoseGy="58.0" v20GyPercent="100.0" />
        </DoseDistribution>
      </DicomRtPlan>
    `;
    const diags = lintDicomRtDocument(parseDicomRt(xml));
    const m9210 = diags.find((d) => d.code === DicomRtErrorCode.PTV_UNDERDOSAGE.code);
    assert(m9210 !== undefined);
    assert.strictEqual(m9210.severity, "warning");
  });
});
