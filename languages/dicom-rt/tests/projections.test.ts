// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseDicomRt } from "../src/parser/index.js";
import { dicomRtToScad, dicomRtToSysML2 } from "../src/projections/index.js";

describe("DICOM-RT Cross-Language Projections (OpenSCAD & SysML v2)", () => {
  const sampleXml = `
    <DicomRtPlan planId="SRS-BRAIN-01" planLabel="Brain_SRS_20Gy" patientId="PT-SRS" prescribedDoseGy="20.0" fractions="1">
      <StructureSet>
        <ROI roiNumber="1" name="PTV_Met" interpretedType="PTV" volumeCc="4.2" color="255,0,0">
          <Contour z="10.0" geometricType="CLOSED_PLANAR" points="-8,-8,10; 8,-8,10; 8,8,10; -8,8,10" />
          <Contour z="12.0" geometricType="CLOSED_PLANAR" points="-6,-6,12; 6,-6,12; 6,6,12; -6,6,12" />
        </ROI>
        <ROI roiNumber="2" name="Brainstem" interpretedType="ORGAN" volumeCc="25.0" maxDoseLimitGy="15.0" meanDoseLimitGy="8.0">
          <Contour z="10.0" geometricType="CLOSED_PLANAR" points="-15,-30,10; 15,-30,10; 0,-15,10" />
        </ROI>
      </StructureSet>
      <BeamSequence>
        <Beam beamNumber="1" name="SRS_Arc1" modality="PHOTON" treatmentDeliveryType="TREATMENT" energyMeV="6.0" metersetMu="2400.0" doseRateMuPerMin="1400.0">
          <ControlPoint index="0" cumulativeMetersetWeight="0.0" gantryAngleDeg="30.0" collimatorAngleDeg="45.0" couchAngleDeg="0.0" jawX_mm="-15,15" jawY_mm="-15,15" />
          <ControlPoint index="1" cumulativeMetersetWeight="1.0" gantryAngleDeg="150.0" collimatorAngleDeg="45.0" couchAngleDeg="0.0" jawX_mm="-15,15" jawY_mm="-15,15" />
        </Beam>
      </BeamSequence>
      <DoseDistribution>
        <DVH roiNumber="1" roiName="PTV_Met" d98Gy="19.2" d95Gy="19.6" d50Gy="21.5" d2Gy="24.0" meanDoseGy="21.4" maxDoseGy="24.5" minDoseGy="18.8" v20GyPercent="92.0" />
        <DVH roiNumber="2" roiName="Brainstem" d98Gy="0.5" d95Gy="1.0" d50Gy="3.2" d2Gy="10.5" meanDoseGy="3.8" maxDoseGy="11.8" minDoseGy="0.2" v20GyPercent="0.0" />
      </DoseDistribution>
    </DicomRtPlan>
  `;

  it("projects RTSTRUCT contours and RTPLAN beam cones to OpenSCAD 3D CSG", () => {
    const doc = parseDicomRt(sampleXml);
    const scad = dicomRtToScad(doc);

    assert(scad.includes("module roi_1_PTV_Met()"));
    assert(scad.includes("module roi_2_Brainstem()"));
    assert(scad.includes("linear_extrude(height = 2.00) polygon(points = [[-8, -8], [8, -8], [8, 8], [-8, 8]]);"));
    assert(scad.includes("module beam_1_SRS_Arc1()"));
    assert(scad.includes("roi_1_PTV_Met();"));
    assert(scad.includes("beam_1_SRS_Arc1();"));
  });

  it("projects clinical dose constraints and radiobiological BED/EQD2 to SysML v2 requirements", () => {
    const doc = parseDicomRt(sampleXml);
    const sysml = dicomRtToSysML2(doc);

    assert(sysml.includes("package Brain_SRS_20Gy {"));
    assert(sysml.includes("part def ROI_PTV_Met {"));
    assert(sysml.includes("part def Beam_1_SRS_Arc1 {"));
    assert(sysml.includes("requirement def PrescriptionDoseRequirement {"));
    assert(sysml.includes("attribute prescriptionBedGy = 60;"));
    assert(sysml.includes("requirement def Brainstem_DoseConstraintRequirement {"));
    assert(sysml.includes("attribute maxDoseLimitGy = 15;"));
    assert(sysml.includes("verification def RadiotherapyPlanVerification {"));
    assert(sysml.includes("verify requirement verify_prescription : PrescriptionDoseRequirement;"));
  });
});
