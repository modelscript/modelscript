// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintQifDocument } from "../src/lints/index.js";
import { parseQif } from "../src/parser/index.js";
import {
  buildQif3dMbdScene,
  reconcileStepWithQif,
  synthesizeQifFromStep,
  synthesizeStepAp242FromQif,
} from "../src/step-bridge/index.js";

describe("STEP AP242 to QIF 3.0 Bridge & Reconciliation", () => {
  const sampleStep = `
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('STEP AP242 Model'),'2;1');
ENDSEC;
DATA;
#10 = PLANE('DatumFaceA', #11);
#101 = ADVANCED_FACE('DatumFaceA_Adv', (#12), #10, .T.);
#20 = CYLINDRICAL_SURFACE('MainBoreCyl', #21, 12.5);
#105 = ADVANCED_FACE('MainBoreFace', (#22), #20, .T.);
#30 = SPHERICAL_SURFACE('BallSocket', #31, 8.0);
#200 = DATUM('A', #101);
#210 = FLATNESS_TOLERANCE('BaseFlatness', 0.01, #101);
#220 = POSITION_TOLERANCE('MainBorePos', 0.04, #105);
ENDSEC;
END-ISO-10303-21;
  `;

  it("reconciles valid STEP entity references and emits M8109 on missing STEP entity IDs", () => {
    const qifDsl = `
      QIF 3.0.0
      FEATURE F1 Plane "DatumPlane" step="#101" points=4
      FEATURE F2 Cylinder "MainBore" size=25.0 step="#105" points=6
      FEATURE F3 Sphere "MissingSphere" size=16.0 step="#999" points=5
    `;
    const doc = parseQif(qifDsl);
    const res = reconcileStepWithQif(sampleStep, doc);

    assert.strictEqual(res.matchedFeatures.length, 2);
    assert(res.matchedFeatures.every((m) => m.geometryCompatible));
    assert.strictEqual(res.unresolvedFeatures.length, 1);
    assert.strictEqual(res.unresolvedFeatures[0]?.stepEntityId, "#999");

    assert.strictEqual(res.diagnostics.length, 1);
    assert.strictEqual(res.diagnostics[0]?.code, "M8109");
    assert(res.diagnostics[0]?.message.includes("#999"));
  });

  it("synthesizes a valid QIF 3.0 document from STEP AP242 entities", () => {
    const synthesized = synthesizeQifFromStep(sampleStep);
    assert(synthesized.features.length >= 3);

    const cylFeat = synthesized.features.find((f) => f.featureType === "Cylinder");
    assert(cylFeat !== undefined);
    // Radius 12.5 in STEP -> Diameter 25.0 in QIF
    assert.strictEqual(cylFeat.nominalSize, 25.0);

    assert(synthesized.characteristics.length >= 2);
    const diags = lintQifDocument(synthesized);
    assert.strictEqual(diags.length, 0);
  });

  it("synthesizes companion STEP AP242 B-Rep and 3D MBD scene with non-overlapping callouts and CMM hits", () => {
    const qifXml = `<?xml version="1.0" encoding="UTF-8"?>
<QIFDocument versionQIF="3.0.0" qpId="f47ac10b-58cc-4372-a567-0e02b2c3d479">
  <DatumDefinitions>
    <DatumDefinition id="D_A"><DatumLabel>A</DatumLabel><FeatureNominalIds><Id>F_ROOT_BASE</Id></FeatureNominalIds></DatumDefinition>
    <DatumDefinition id="D_B"><DatumLabel>B</DatumLabel><FeatureNominalIds><Id>F_COOLING_BORE</Id></FeatureNominalIds></DatumDefinition>
  </DatumDefinitions>
  <FeatureNominals>
    <PlaneFeatureNominal id="F_ROOT_BASE">
      <Name>FirTreePlatformDatumPlaneA</Name>
      <Location>0.0 0.0 0.0</Location>
      <Normal>0.0 0.0 1.0</Normal>
      <StepEntityId>#101</StepEntityId>
      <ProbingPoints>9</ProbingPoints>
    </PlaneFeatureNominal>
    <CylinderFeatureNominal id="F_COOLING_BORE">
      <Name>RootInternalCoolingBoreB</Name>
      <Diameter>12.000</Diameter>
      <Location>24.0 0.0 15.0</Location>
      <AxisVector>0.0 0.0 1.0</AxisVector>
      <StepEntityId>#108</StepEntityId>
      <ProbingPoints>12</ProbingPoints>
    </CylinderFeatureNominal>
  </FeatureNominals>
  <CharacteristicNominals>
    <FlatnessCharacteristicNominal id="CHAR_FLAT_A" balloonNumber="1">
      <Name>PlatformBase_Flatness</Name>
      <ToleranceValue>0.025</ToleranceValue>
      <FeatureNominalIds><Id>F_ROOT_BASE</Id></FeatureNominalIds>
    </FlatnessCharacteristicNominal>
    <PositionCharacteristicNominal id="CHAR_POS_BORE" balloonNumber="2">
      <Name>CoolingBore_TruePosition</Name>
      <ToleranceValue>0.050</ToleranceValue>
      <DiametricalZone>true</DiametricalZone>
      <MaterialCondition>MMC</MaterialCondition>
      <DatumReferenceFrame>
        <DatumReference precedence="1"><DatumLabel>A</DatumLabel></DatumReference>
      </DatumReferenceFrame>
      <FeatureNominalIds><Id>F_COOLING_BORE</Id></FeatureNominalIds>
    </PositionCharacteristicNominal>
  </CharacteristicNominals>
  <Results>
    <GeometricCharacteristicActual id="ACT_01" characteristicNominalId="CHAR_FLAT_A" partSerialNumber="SN-01">
      <MeasuredValue>0.009</MeasuredValue>
      <Status>PASS</Status>
    </GeometricCharacteristicActual>
    <GeometricCharacteristicActual id="ACT_02" characteristicNominalId="CHAR_POS_BORE" partSerialNumber="SN-01">
      <MeasuredValue>0.034</MeasuredValue>
      <ActualFeatureSize>12.012</ActualFeatureSize>
      <Status>PASS</Status>
    </GeometricCharacteristicActual>
  </Results>
</QIFDocument>`;

    const doc = parseQif(qifXml);
    const stepAp242 = synthesizeStepAp242FromQif(doc);
    assert(stepAp242.includes("#101 = ADVANCED_FACE"));
    assert(stepAp242.includes("#108 = ADVANCED_FACE"));

    const scene = buildQif3dMbdScene(doc);
    assert.strictEqual(scene.reconciliation.unresolvedFeatures.length, 0);
    assert.strictEqual(scene.reconciliation.matchedFeatures.length, 2);
    // 2 feature topology meshes; no fabricated body envelope without a paired STEP
    assert.strictEqual(scene.meshes.length, 2);
    assert(!scene.meshes.some((m) => m.isBodyEnvelope));
    assert.strictEqual(scene.geometry, "none");
    assert.strictEqual(scene.probeHits.length, 21); // 9 + 12 probe hits
    assert.strictEqual(scene.callouts.length, 2);
    assert.strictEqual(scene.datumBadges.length, 2);

    // Ensure 3D callout positions are spatially separated
    const c0 = scene.callouts[0]!.calloutPosition;
    const c1 = scene.callouts[1]!.calloutPosition;
    const dist = Math.hypot(c0[0] - c1[0], c0[1] - c1[1], c0[2] - c1[2]);
    assert(dist > 15, `Expected callouts to be spatially separated, got dist=${dist}`);
  });

  it("reconciles features by semantic name when stepEntityId is absent or renumbered", () => {
    const qifDsl = `
      QIF 3.0.0
      FEATURE F1 Plane "DatumFaceA" points=4
      FEATURE F2 Cylinder "MainBore" size=25.0 points=6
    `;
    const doc = parseQif(qifDsl);
    const res = reconcileStepWithQif(sampleStep, doc);

    assert.strictEqual(res.matchedFeatures.length, 2);
    assert.strictEqual(res.unresolvedFeatures.length, 0);
    assert.strictEqual(res.matchedFeatures[0]?.matchType, "semanticName");
    assert.strictEqual(res.matchedFeatures[1]?.matchType, "semanticName");
    assert.strictEqual(res.matchedFeatures[1]?.stepEntityId, "#105");
  });

  it("reconciles features by spatial nearest-neighbor proximity", () => {
    const stepWithPoints = `
ISO-10303-21;
DATA;
#1 = CARTESIAN_POINT('Pt1', (10.0, 20.0, 30.0));
#2 = CYLINDRICAL_SURFACE('Hole1', #1, 5.0);
#3 = ADVANCED_FACE('Face1', (#4), #2, .T.);
ENDSEC;
END-ISO-10303-21;
    `;
    const qifXml = `<?xml version="1.0" encoding="UTF-8"?>
<QIFDocument versionQIF="3.0.0" qpId="11111111-2222-3333-4444-555555555555">
  <FeatureNominals>
    <CylinderFeatureNominal id="F_CYL">
      <Name>UnmatchedNameBore</Name>
      <Diameter>10.0</Diameter>
      <Location>10.5 20.2 29.8</Location>
      <AxisVector>0.0 0.0 1.0</AxisVector>
    </CylinderFeatureNominal>
  </FeatureNominals>
</QIFDocument>`;
    const doc = parseQif(qifXml);
    const res = reconcileStepWithQif(stepWithPoints, doc);

    assert.strictEqual(res.matchedFeatures.length, 1);
    assert.strictEqual(res.matchedFeatures[0]?.matchType, "spatialProximity");
    assert.strictEqual(res.matchedFeatures[0]?.stepEntityId, "#3");
  });
});
