// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseDicomRt } from "../src/parser/index.js";

describe("DICOM-RT XML, DICOM PS3.18 JSON, and DSL Parser", () => {
  it("parses complete DICOM-RT XML treatment plan with RTSTRUCT, RTPLAN, RTDOSE, and exact source ranges", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DicomRtPlan
  planId="PROSTATE-VMAT-01"
  planLabel="Prostate_78Gy_39Fx"
  patientId="PT-10492"
  frameOfReferenceUid="1.2.840.10008.5.1.4.1.1.481.3.100"
  structFrameOfReferenceUid="1.2.840.10008.5.1.4.1.1.481.3.100"
  doseFrameOfReferenceUid="1.2.840.10008.5.1.4.1.1.481.3.100"
  prescribedDoseGy="78.0"
  fractions="39"
>
  <StructureSet frameOfReferenceUid="1.2.840.10008.5.1.4.1.1.481.3.100">
    <ROI roiNumber="1" name="PTV_78" interpretedType="PTV" volumeCc="115.4" color="255,40,40">
      <Contour z="-10.0" geometricType="CLOSED_PLANAR" points="-20,-20,-10; 20,-20,-10; 20,20,-10; -20,20,-10" />
      <Contour z="0.0" geometricType="CLOSED_PLANAR" points="-22,-22,0; 22,-22,0; 22,22,0; -22,22,0" />
    </ROI>
    <ROI roiNumber="2" name="Rectum" interpretedType="ORGAN" volumeCc="64.2" maxDoseLimitGy="75.0" meanDoseLimitGy="50.0">
      <Contour z="0.0" geometricType="CLOSED_PLANAR" points="-15,-45,0; 15,-45,0; 15,-25,0; -15,-25,0" />
    </ROI>
  </StructureSet>
  <BeamSequence>
    <Beam beamNumber="1" name="Arc1_CW" modality="PHOTON" treatmentDeliveryType="TREATMENT" energyMeV="6.0" metersetMu="320.0" doseRateMuPerMin="600.0">
      <ControlPoint index="0" cumulativeMetersetWeight="0.0" gantryAngleDeg="181.0" collimatorAngleDeg="15.0" couchAngleDeg="0.0" jawX_mm="-45,45" jawY_mm="-45,45">
        <MLCLeafPair pairIndex="1" bankA_mm="-22.0" bankB_mm="22.0" />
        <MLCLeafPair pairIndex="2" bankA_mm="-25.0" bankB_mm="25.0" />
      </ControlPoint>
      <ControlPoint index="1" cumulativeMetersetWeight="0.5" gantryAngleDeg="0.0" collimatorAngleDeg="15.0" couchAngleDeg="0.0" jawX_mm="-45,45" jawY_mm="-45,45">
        <MLCLeafPair pairIndex="1" bankA_mm="-18.0" bankB_mm="18.0" />
        <MLCLeafPair pairIndex="2" bankA_mm="-20.0" bankB_mm="20.0" />
      </ControlPoint>
      <ControlPoint index="2" cumulativeMetersetWeight="1.0" gantryAngleDeg="179.0" collimatorAngleDeg="15.0" couchAngleDeg="0.0" jawX_mm="-45,45" jawY_mm="-45,45">
        <MLCLeafPair pairIndex="1" bankA_mm="-20.0" bankB_mm="20.0" />
        <MLCLeafPair pairIndex="2" bankA_mm="-22.0" bankB_mm="22.0" />
      </ControlPoint>
    </Beam>
  </BeamSequence>
  <DoseDistribution frameOfReferenceUid="1.2.840.10008.5.1.4.1.1.481.3.100">
    <DVH roiNumber="1" roiName="PTV_78" d98Gy="75.2" d95Gy="76.5" d50Gy="78.4" d2Gy="80.8" meanDoseGy="78.3" maxDoseGy="81.6" minDoseGy="73.5" v20GyPercent="100.0">
      <DoseBin doseGy="0.0" volumePercent="100.0" />
      <DoseBin doseGy="75.2" volumePercent="98.0" />
      <DoseBin doseGy="76.5" volumePercent="95.0" />
      <DoseBin doseGy="78.4" volumePercent="50.0" />
      <DoseBin doseGy="80.8" volumePercent="2.0" />
      <DoseBin doseGy="81.6" volumePercent="0.0" />
    </DVH>
    <DVH roiNumber="2" roiName="Rectum" d98Gy="12.0" d95Gy="15.0" d50Gy="38.0" d2Gy="71.0" meanDoseGy="41.2" maxDoseGy="73.5" minDoseGy="8.0" v20GyPercent="72.0" />
  </DoseDistribution>
</DicomRtPlan>`;

    const doc = parseDicomRt(xml, "file:///prostate.dcm.xml");
    assert.strictEqual(doc.planId, "PROSTATE-VMAT-01");
    assert.strictEqual(doc.planLabel, "Prostate_78Gy_39Fx");
    assert.strictEqual(doc.patientId, "PT-10492");
    assert.strictEqual(doc.prescribedDoseGy, 78.0);
    assert.strictEqual(doc.fractions, 39);
    assert.strictEqual(doc.uri, "file:///prostate.dcm.xml");

    assert.strictEqual(doc.structures.length, 2);
    const ptv = doc.structures[0]!;
    assert.strictEqual(ptv.roiNumber, 1);
    assert.strictEqual(ptv.name, "PTV_78");
    assert.strictEqual(ptv.interpretedType, "PTV");
    assert.strictEqual(ptv.volumeCc, 115.4);
    assert.deepStrictEqual(ptv.color, [255, 40, 40]);
    assert.strictEqual(ptv.contours.length, 2);
    assert.strictEqual(ptv.contours[0]?.points.length, 4);
    assert.strictEqual(ptv.range.startLine, 13);

    const rectum = doc.structures[1]!;
    assert.strictEqual(rectum.interpretedType, "ORGAN");
    assert.strictEqual(rectum.maxDoseLimitGy, 75.0);
    assert.strictEqual(rectum.meanDoseLimitGy, 50.0);

    assert.strictEqual(doc.beams.length, 1);
    const beam = doc.beams[0]!;
    assert.strictEqual(beam.beamNumber, 1);
    assert.strictEqual(beam.name, "Arc1_CW");
    assert.strictEqual(beam.modality, "PHOTON");
    assert.strictEqual(beam.energyMeV, 6.0);
    assert.strictEqual(beam.metersetMu, 320.0);
    assert.strictEqual(beam.controlPoints.length, 3);
    assert.strictEqual(beam.controlPoints[0]?.mlcLeaves.length, 2);
    assert.deepStrictEqual(beam.controlPoints[0]?.jawX_mm, [-45, 45]);

    assert.strictEqual(doc.dvhs.length, 2);
    assert.strictEqual(doc.dvhs[0]?.d95Gy, 76.5);
    assert.strictEqual(doc.dvhs[1]?.maxDoseGy, 73.5);
  });

  it("parses DICOM PS3.18 tag-keyed JSON and direct JSON representations", () => {
    const ps318Json = JSON.stringify({
      "00100020": { vr: "LO", Value: ["PT-PS318"] },
      "00200052": { vr: "UI", Value: ["1.2.840.10008.999"] },
      "300A0002": { vr: "SH", Value: ["SBRT_Lung_54Gy"] },
      "300A0003": { vr: "LO", Value: ["LUNG-SBRT-01"] },
      "300A0010": {
        vr: "SQ",
        Value: [{ "300A0026": { vr: "DS", Value: [54.0] } }],
      },
      "300A0070": {
        vr: "SQ",
        Value: [
          {
            "300A0078": { vr: "IS", Value: [3] },
            "300C0004": {
              vr: "SQ",
              Value: [
                {
                  "300C0006": { vr: "IS", Value: [1] },
                  "300A0086": { vr: "DS", Value: [1800.0] },
                },
              ],
            },
          },
        ],
      },
      "30060020": {
        vr: "SQ",
        Value: [
          {
            "30060022": { vr: "IS", Value: [1] },
            "30060026": { vr: "LO", Value: ["PTV_Lung"] },
            "3006002C": { vr: "DS", Value: [28.5] },
          },
        ],
      },
      "30060039": {
        vr: "SQ",
        Value: [
          {
            "30060084": { vr: "IS", Value: [1] },
            "3006002A": { vr: "IS", Value: [255, 0, 0] },
            "30060040": {
              vr: "SQ",
              Value: [
                {
                  "30060042": { vr: "CS", Value: ["CLOSED_PLANAR"] },
                  "30060050": { vr: "DS", Value: [-10, -10, 5, 10, -10, 5, 10, 10, 5, -10, 10, 5] },
                },
              ],
            },
          },
        ],
      },
      "30060080": {
        vr: "SQ",
        Value: [
          {
            "30060084": { vr: "IS", Value: [1] },
            "300600A4": { vr: "CS", Value: ["PTV"] },
          },
        ],
      },
      "300A00B0": {
        vr: "SQ",
        Value: [
          {
            "300A00C0": { vr: "IS", Value: [1] },
            "300A00C2": { vr: "LO", Value: ["FFF_Beam_1"] },
            "300A00C6": { vr: "CS", Value: ["PHOTON"] },
            "300A00CE": { vr: "CS", Value: ["TREATMENT"] },
            "300A010E": { vr: "DS", Value: [1.0] },
            "300A0111": {
              vr: "SQ",
              Value: [
                {
                  "300A0112": { vr: "IS", Value: [0] },
                  "300A0114": { vr: "DS", Value: [10.0] },
                  "300A0115": { vr: "DS", Value: [1400.0] },
                  "300A011E": { vr: "DS", Value: [0.0] },
                  "300A0120": { vr: "DS", Value: [0.0] },
                  "300A0122": { vr: "DS", Value: [0.0] },
                  "300A0134": { vr: "DS", Value: [0.0] },
                  "300A011A": {
                    vr: "SQ",
                    Value: [
                      { "300A00B8": { vr: "CS", Value: ["ASYMX"] }, "300A011C": { vr: "DS", Value: [-20, 20] } },
                      {
                        "300A00B8": { vr: "CS", Value: ["MLCX"] },
                        "300A011C": { vr: "DS", Value: [-15, -15, 15, 15] },
                      },
                    ],
                  },
                },
                {
                  "300A0112": { vr: "IS", Value: [1] },
                  "300A011E": { vr: "DS", Value: [90.0] },
                  "300A0134": { vr: "DS", Value: [1.0] },
                },
              ],
            },
          },
        ],
      },
    });

    const doc = parseDicomRt(ps318Json);
    assert.strictEqual(doc.planId, "LUNG-SBRT-01");
    assert.strictEqual(doc.planLabel, "SBRT_Lung_54Gy");
    assert.strictEqual(doc.patientId, "PT-PS318");
    assert.strictEqual(doc.prescribedDoseGy, 54.0);
    assert.strictEqual(doc.fractions, 3);
    assert.strictEqual(doc.structures.length, 1);
    assert.strictEqual(doc.structures[0]?.interpretedType, "PTV");
    assert.strictEqual(doc.structures[0]?.contours[0]?.points.length, 4);
    assert.strictEqual(doc.beams.length, 1);
    assert.strictEqual(doc.beams[0]?.metersetMu, 1800.0);
    assert.strictEqual(doc.beams[0]?.energyMeV, 10.0);
    assert.strictEqual(doc.beams[0]?.controlPoints[0]?.mlcLeaves.length, 2);

    // Direct JSON round-trip
    const roundTrip = parseDicomRt(JSON.stringify(doc));
    assert.strictEqual(roundTrip.planId, doc.planId);
    assert.strictEqual(roundTrip.structures.length, 1);
    assert.strictEqual(roundTrip.beams.length, 1);
  });
});
