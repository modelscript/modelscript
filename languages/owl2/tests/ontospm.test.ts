// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeSurgicalWorkflow,
  lintOntoSpmProcedure,
  ontoSpmToOwl2Functional,
  parseOntoSpm,
} from "../src/profiles/ontospm.js";

describe("OntoSPM Surgical Process Modeling Profile (M9901–M9910)", () => {
  const VALID_LAP_CHOLE = `
<SurgicalProcedure id="LapChole_01" name="Laparoscopic Cholecystectomy" iri="http://ontospm.org/lap/cholecystectomy">
  <Phase id="P_Prep" name="Preparation & Trocar Placement" category="Preparation" next="P_Calot" />
  <Phase id="P_Calot" name="Calot Triangle Dissection" category="Dissection" next="P_ClipCut" />
  <Phase id="P_ClipCut" name="Clipping and Division" category="Resection" next="P_Close" />
  <Phase id="P_Close" name="Hemostasis and Closure" category="Closure" next="" />

  <Instrument id="Hook_1" name="L-Hook Electrocautery" category="MonopolarHook" energy="Monopolar" />
  <Instrument id="Clip_1" name="Hem-o-lok Clip Applier" category="ClipApplier" energy="Mechanical" />
  <Instrument id="Sciss_1" name="Laparoscopic Scissors" category="Scissors" energy="Mechanical" />
  <Instrument id="Driver_1" name="Robotic Needle Driver" category="NeedleDriver" energy="Mechanical" />

  <AnatomicalStructure id="HepatocysticTriangle" name="Hepatocystic Triangle" tissueType="ConnectiveTissue" critical="false" />
  <AnatomicalStructure id="CysticDuct" name="Cystic Duct" tissueType="BileDuct" critical="true" />
  <AnatomicalStructure id="CysticArtery" name="Cystic Artery" tissueType="Artery" critical="true" />
  <AnatomicalStructure id="Fascia" name="Abdominal Fascia" tissueType="ConnectiveTissue" critical="false" />

  <SafetyCheckpoint id="CriticalViewOfSafety" name="Strasberg Critical View of Safety" phaseId="P_Calot" stepOrder="2" verified="true" targets="CysticDuct,CysticArtery" />

  <Step id="S1_Dissect" phaseId="P_Calot" order="1" action="Dissection" instrument="Hook_1" target="HepatocysticTriangle" durationSec="420" autonomyLevel="1" />
  <Step id="S2_ClipDuct" phaseId="P_ClipCut" order="3" action="Clipping" instrument="Clip_1" target="CysticDuct" durationSec="45" requiresCheckpoint="CriticalViewOfSafety" autonomyLevel="2" />
  <Step id="S3_CutDuct" phaseId="P_ClipCut" order="4" action="Transection" instrument="Sciss_1" target="CysticDuct" durationSec="30" requiresCheckpoint="CriticalViewOfSafety" autonomyLevel="2" />
  <Step id="S4_Close" phaseId="P_Close" order="5" action="Closure" instrument="Driver_1" target="Fascia" durationSec="180" autonomyLevel="3" />
</SurgicalProcedure>
`;

  it("parses valid laparoscopic cholecystectomy workflow with zero lint errors", () => {
    const proc = parseOntoSpm(VALID_LAP_CHOLE, "file:///lap_chole.xml");
    assert.equal(proc.id, "LapChole_01");
    assert.equal(proc.phases.length, 4);
    assert.equal(proc.steps.length, 4);
    assert.equal(proc.instruments.length, 4);
    assert.equal(proc.structures.length, 4);
    assert.equal(proc.checkpoints.length, 1);

    const diags = lintOntoSpmProcedure(proc);
    assert.equal(diags.length, 0);

    const summary = analyzeSurgicalWorkflow(proc);
    assert.equal(summary.totalExpectedDurationSec, 675);
    assert.equal(summary.verifiedCheckpointCount, 1);
    assert.equal(summary.maxAutonomyLevel, 3);

    const owlText = ontoSpmToOwl2Functional(proc);
    assert.ok(owlText.includes("Ontology(<http://ontospm.org/lap/cholecystectomy>"));
    assert.ok(owlText.includes("ClassAssertion(spm:ClippingAction :S2_ClipDuct)"));
  });

  it("detects M9901–M9910 surgical workflow safety & ontology diagnostics", () => {
    const INVALID_PROC = `
<SurgicalProcedure id="Unsafe_Proc" name="Unsafe Procedure">
  <Phase id="P1" category="Dissection" next="P2" />
  <Phase id="P2" category="Resection" next="P1" />
  <Phase id="P_Orphan" category="Preparation" next="" />
  <Phase id="P1" category="Dissection" next="" />

  <Instrument id="Hook_Mono" category="MonopolarHook" energy="Monopolar" />
  <Instrument id="Endo_Cam" category="Endoscope" energy="Optical" />

  <AnatomicalStructure id="CysticArtery" tissueType="Artery" critical="true" />
  <AnatomicalStructure id="RecurrentLaryngealNerve" tissueType="Nerve" critical="true" />

  <SafetyCheckpoint id="CriticalViewOfSafety" phaseId="P1" stepOrder="1" verified="false" targets="CysticArtery" />

  <Step id="Step_NoCVS" phaseId="P2" order="2" action="Transection" instrument="Endo_Cam" target="CysticArtery" durationSec="0" requiresCheckpoint="CriticalViewOfSafety" />
  <Step id="Step_ThermalNerve" phaseId="P1" order="3" action="Dissection" instrument="Hook_Mono" target="RecurrentLaryngealNerve" durationSec="20" proximityMm="1.5" />
  <Step id="Step_MissingRefs" phaseId="P1" order="4" action="Dissection" instrument="GhostInstrument" target="GhostOrgan" durationSec="15" />
</SurgicalProcedure>
`;
    const proc = parseOntoSpm(INVALID_PROC);
    const diags = lintOntoSpmProcedure(proc);
    const codes = new Set(diags.map((d) => d.code));

    assert.ok(codes.has("M9901"), "Expected M9901 for unverified Critical View of Safety");
    assert.ok(codes.has("M9902"), "Expected M9902 for Endoscope used in Transection");
    assert.ok(codes.has("M9903"), "Expected M9903 for P1 <-> P2 phase transition cycle");
    assert.ok(codes.has("M9904"), "Expected M9904 for unresolved GhostOrgan");
    assert.ok(codes.has("M9905"), "Expected M9905 for unresolved GhostInstrument");
    assert.ok(codes.has("M9906"), "Expected M9906 for missing Hemostasis/Closure phase");
    assert.ok(codes.has("M9907"), "Expected M9907 for monopolar cautery at 1.5 mm from nerve");
    assert.ok(codes.has("M9908"), "Expected M9908 for non-positive durationSec=0");
    assert.ok(codes.has("M9909"), "Expected M9909 for unreachable P_Orphan phase");
    assert.ok(codes.has("M9910"), "Expected M9910 for duplicate P1 phase ID");
  });
});
