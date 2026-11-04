// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  DicomRtWorkspaceIndex,
  dicomRtLanguage,
  executeDicomRtAction,
  getDicomRtCompletions,
  getDicomRtDefinition,
  getDicomRtDocumentSymbols,
  getDicomRtHover,
  validateDicomRt,
} from "../src/index.js";

describe("DICOM-RT Workspace Indexer, LSP Services, and Language Definition", () => {
  const planXml = `<DicomRtPlan planId="LSP-PLAN-01" planLabel="Thorax_IMRT" patientId="PT-88" prescribedDoseGy="60.0" fractions="30">
  <StructureSet>
    <ROI roiNumber="1" name="PTV_60" interpretedType="PTV" volumeCc="180.0">
      <Contour z="0.0" geometricType="CLOSED_PLANAR" points="-25,-25,0; 25,-25,0; 25,25,0; -25,25,0" />
    </ROI>
    <ROI roiNumber="2" name="Lung_Total" interpretedType="ORGAN" volumeCc="3200.0" meanDoseLimitGy="20.0">
      <Contour z="0.0" geometricType="CLOSED_PLANAR" points="-100,-80,0; 100,-80,0; 100,80,0; -100,80,0" />
    </ROI>
  </StructureSet>
  <BeamSequence>
    <Beam beamNumber="1" name="Anterior_Field" modality="PHOTON" treatmentDeliveryType="TREATMENT" energyMeV="6.0" metersetMu="180.0" doseRateMuPerMin="600.0">
      <ControlPoint index="0" cumulativeMetersetWeight="0.0" gantryAngleDeg="0.0" collimatorAngleDeg="0.0" couchAngleDeg="0.0">
        <MLCLeafPair pairIndex="1" bankA_mm="-25.0" bankB_mm="25.0" />
      </ControlPoint>
      <ControlPoint index="1" cumulativeMetersetWeight="1.0" gantryAngleDeg="0.0" collimatorAngleDeg="0.0" couchAngleDeg="0.0">
        <MLCLeafPair pairIndex="1" bankA_mm="-25.0" bankB_mm="25.0" />
      </ControlPoint>
    </Beam>
  </BeamSequence>
  <DoseDistribution>
    <DVH roiNumber="1" roiName="PTV_60" d98Gy="57.8" d95Gy="58.6" d50Gy="60.2" d2Gy="62.1" meanDoseGy="60.1" maxDoseGy="62.9" minDoseGy="56.5" v20GyPercent="100.0" />
    <DVH roiNumber="2" roiName="Lung_Total" d98Gy="1.0" d95Gy="2.0" d50Gy="12.0" d2Gy="55.0" meanDoseGy="14.5" maxDoseGy="58.0" minDoseGy="0.5" v20GyPercent="22.0" />
  </DoseDistribution>
</DicomRtPlan>`;

  it("indexes multi-file symbols in DicomRtWorkspaceIndex", () => {
    const uri = "file:///thorax.dcm.xml";
    const index = new DicomRtWorkspaceIndex();
    index.register(uri);
    assert.strictEqual(index.has(uri), true);

    const fileIdx = index.indexFile(uri, planXml);
    assert(fileIdx.symbols.size >= 6);
    assert.strictEqual(index.fileCount, 1);

    const ptvMatches = index.findByName("PTV_60");
    assert.strictEqual(ptvMatches.length, 1);
    assert.strictEqual(ptvMatches[0]?.ruleName, "dicom_rt_roi");

    const beamSym = index.resolveInScope("Anterior_Field", null, uri);
    assert(beamSym !== null);
    assert.strictEqual(beamSym.ruleName, "dicom_rt_beam");

    const cpSym = index.resolveInScope("CP_0", beamSym.id, uri);
    assert(cpSym !== null);
    assert.strictEqual(cpSym.ruleName, "dicom_rt_control_point");

    index.reindexDocument(uri, () => ({ text: planXml }));
    assert(index.version >= 2);
    assert.strictEqual(index.getAllFiles().length, 1);
    assert(index.getAllSymbols(uri).length >= 6);

    index.clear();
    assert.strictEqual(index.fileCount, 0);
  });

  it("provides LSP diagnostics, document symbols, hover cards, completions, go-to-definition, and actions", async () => {
    const diags = validateDicomRt(planXml);
    assert.strictEqual(diags.length, 0);

    const symbols = getDicomRtDocumentSymbols(planXml);
    assert.strictEqual(symbols.length, 5); // 2 ROIs + 1 Beam + 2 DVHs

    const roiOffset = planXml.indexOf('name="PTV_60"');
    const hover = getDicomRtHover(planXml, roiOffset);
    assert(hover !== null);
    assert(hover.contents.value.includes("PTV_60"));
    assert(hover.contents.value.includes("EQD"));

    const dvhOffset = planXml.indexOf('<DVH roiNumber="1"');
    const defLoc = getDicomRtDefinition(planXml, dvhOffset, "file:///thorax.dcm.xml");
    assert(defLoc !== null);
    assert.strictEqual(defLoc.uri, "file:///thorax.dcm.xml");

    const completions = getDicomRtCompletions(planXml);
    assert(completions.some((c) => c.label === "PTV_60"));
    assert(completions.some((c) => c.label === "Anterior_Field"));

    const dosimetry = await executeDicomRtAction("dicom_rt_dosimetry", planXml);
    assert.strictEqual(dosimetry.prescribedDoseGy, 60.0);

    const daeRes = await executeDicomRtAction("dicom_rt_to_dae", planXml);
    assert(daeRes.variableCount > 0);
    assert(daeRes.equationCount > 0);

    const scad = await executeDicomRtAction("dicom_rt_to_scad", planXml);
    assert(scad.includes("roi_1_PTV_60"));

    const sysml = await executeDicomRtAction("dicom_rt_to_sysml2", planXml);
    assert(sysml.includes("package Thorax_IMRT"));

    assert.strictEqual(dicomRtLanguage.name, "dicom-rt");
    assert((dicomRtLanguage.actions?.length ?? 0) >= 5);
  });
});
