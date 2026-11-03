// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseQif } from "../src/parser/index.js";

describe("QIF 3.0 XML, Declarative DSL, and JSON Parser", () => {
  it("parses standard ISO 23952 / ANSI DMSC QIF 3.0 XML document with exact source ranges", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<QIFDocument versionQIF="3.0.0" qpId="a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d">
  <Header>
    <Author><Name>Dr. Metrology</Name></Author>
    <Application><Name>ModelScript QIF Suite</Name></Application>
    <FileUnits>
      <PrimaryUnits>
        <LinearUnit><UnitName>mm</UnitName></LinearUnit>
      </PrimaryUnits>
    </FileUnits>
  </Header>
  <DatumDefinitions>
    <DatumDefinition id="D1" qpId="10000000-0000-4000-8000-000000000001">
      <DatumLabel>A</DatumLabel>
      <FeatureNominalIds><Id>F1</Id></FeatureNominalIds>
    </DatumDefinition>
    <DatumDefinition id="D2" label="B" featureId="F2"/>
  </DatumDefinitions>
  <FeatureNominals>
    <PlaneFeatureNominal id="F1" qpId="20000000-0000-4000-8000-000000000001">
      <Name>PrimaryBasePlane</Name>
      <Location>0 0 0</Location>
      <Normal>0 0 1</Normal>
      <StepEntityId>#101</StepEntityId>
      <ProbingPoints>4</ProbingPoints>
    </PlaneFeatureNominal>
    <CylinderFeatureNominal id="F2" qpId="20000000-0000-4000-8000-000000000002">
      <Name>CenterBore</Name>
      <Diameter>25.0</Diameter>
      <Location>50 25 0</Location>
      <AxisVector>0 0 1</AxisVector>
      <StepEntityId>#105</StepEntityId>
      <ProbingPoints>8</ProbingPoints>
    </CylinderFeatureNominal>
  </FeatureNominals>
  <CharacteristicNominals>
    <PositionCharacteristicNominal id="C1" qpId="30000000-0000-4000-8000-000000000001" balloonNumber="10">
      <Name>CenterBore_Position</Name>
      <ToleranceValue>0.05</ToleranceValue>
      <DiametricalZone>true</DiametricalZone>
      <MaterialCondition>MMC</MaterialCondition>
      <DatumReferenceFrame>
        <DatumReference precedence="1"><DatumLabel>A</DatumLabel></DatumReference>
        <DatumReference precedence="2"><DatumLabel>B</DatumLabel><MaterialCondition>MMC</MaterialCondition></DatumReference>
      </DatumReferenceFrame>
      <CompositeLowerTier toleranceZone="0.015" materialCondition="MMC">
        <DatumReference><DatumLabel>A</DatumLabel></DatumReference>
      </CompositeLowerTier>
      <FeatureNominalIds><Id>F2</Id></FeatureNominalIds>
      <MeasurementDeviceId>CMM1</MeasurementDeviceId>
    </PositionCharacteristicNominal>
  </CharacteristicNominals>
  <MeasurementResources>
    <MeasurementDevice id="CMM1" deviceType="CMM">
      <Name>Zeiss_Contura</Name>
      <CalibrationUncertainty>0.0015</CalibrationUncertainty>
    </MeasurementDevice>
  </MeasurementResources>
  <Rules minTurRatio="4.0">
    <FeatureRule featureType="Plane" minPoints="4"/>
    <FeatureRule featureType="Cylinder" minPoints="6"/>
  </Rules>
  <Plan>
    <PlanStep id="S1" stepNumber="1" featureId="F2" characteristicId="C1" deviceId="CMM1" probingPointCount="8"/>
  </Plan>
  <Results>
    <GeometricCharacteristicActual id="ACT1" characteristicNominalId="C1" partSerialNumber="SN-101">
      <MeasuredValue>0.06</MeasuredValue>
      <ActualFeatureSize>25.03</ActualFeatureSize>
      <DeviationVector>0.04 0.0447 0.0</DeviationVector>
      <Status>PASS</Status>
    </GeometricCharacteristicActual>
  </Results>
</QIFDocument>`;

    const doc = parseQif(xml, "file:///part.qif");
    assert.strictEqual(doc.version, "3.0.0");
    assert.strictEqual(doc.qpId, "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
    assert.strictEqual(doc.header.author, "Dr. Metrology");
    assert.strictEqual(doc.header.application, "ModelScript QIF Suite");
    assert.strictEqual(doc.header.fileUnits, "mm");

    assert.strictEqual(doc.datumDefinitions.length, 2);
    assert.strictEqual(doc.datumDefinitions[0]?.label, "A");
    assert.strictEqual(doc.datumDefinitions[0]?.featureId, "F1");
    assert.strictEqual(doc.datumDefinitions[0]?.range.startLine, 13);

    assert.strictEqual(doc.features.length, 2);
    const f1 = doc.features[0]!;
    assert.strictEqual(f1.featureType, "Plane");
    assert.strictEqual(f1.isFeatureOfSize, false);
    assert.strictEqual(f1.stepEntityId, "#101");
    assert.deepStrictEqual(f1.normal, [0, 0, 1]);

    const f2 = doc.features[1]!;
    assert.strictEqual(f2.featureType, "Cylinder");
    assert.strictEqual(f2.isFeatureOfSize, true);
    assert.strictEqual(f2.nominalSize, 25.0);
    assert.strictEqual(f2.probingPoints, 8);

    assert.strictEqual(doc.characteristics.length, 1);
    const c1 = doc.characteristics[0]!;
    assert.strictEqual(c1.gdtType, "Position");
    assert.strictEqual(c1.balloonNumber, 10);
    assert.strictEqual(c1.toleranceZone, 0.05);
    assert.strictEqual(c1.isDiametrical, true);
    assert.strictEqual(c1.materialCondition, "MMC");
    assert.strictEqual(c1.datumReferences.length, 2);
    assert.strictEqual(c1.datumReferences[1]?.datumLabel, "B");
    assert.strictEqual(c1.datumReferences[1]?.materialCondition, "MMC");
    assert(c1.compositeLowerTier !== undefined);
    assert.strictEqual(c1.compositeLowerTier?.toleranceZone, 0.015);
    assert.deepStrictEqual(c1.compositeLowerTier?.datumReferences, ["A"]);

    assert.strictEqual(doc.devices.length, 1);
    assert.strictEqual(doc.devices[0]?.calibrationUncertainty, 0.0015);
    assert.strictEqual(doc.rules.minPointsPerFeature["Cylinder"], 6);
    assert.strictEqual(doc.planSteps.length, 1);
    assert.strictEqual(doc.actuals.length, 1);
    assert.strictEqual(doc.actuals[0]?.actualFeatureSize, 25.03);
    assert.deepStrictEqual(doc.actuals[0]?.deviationVector, [0.04, 0.0447, 0.0]);
  });

  it("parses concise declarative QIF DSL and JSON representations", () => {
    const dsl = `
      QIF 3.0.0 qpId="f0e1d2c3-b4a5-4678-9101-112131415161"
      HEADER author="AeroQuality" application="MSX-QIF" units="mm" partName="TurbineHousing"
      DATUM A id=D1 feature=F_PLANE
      DATUM B id=D2 feature=F_BORE
      FEATURE F_PLANE Plane "MountingFace" step="#20" points=4 location=(0,0,0) normal=(0,0,1)
      FEATURE F_BORE Cylinder "PilotBore" size=40.0 upperSizeTol=0.04 lowerSizeTol=0.0 step="#25" points=8 internal=true
      DEVICE CMM_MAIN CMM "Hexagon_Global" uncertainty=0.0012
      RULE minTur=4.0 Plane=4 Cylinder=6
      CHARACTERISTIC C_POS Position "PilotBore_Pos" balloon=1 zone=0.04 diametrical=true material=MMC datums=[A,B(MMC)] features=[F_BORE] device=CMM_MAIN composite=(zone=0.015, material=MMC, datums=[A])
      STEP S1 step=1 feature=F_BORE characteristic=C_POS device=CMM_MAIN points=8
      ACTUAL ACT1 characteristic=C_POS serial="SN-500" value=0.055 actualSize=40.02 status=PASS deviation=(0.03,0.046,0)
    `;

    const doc = parseQif(dsl);
    assert.strictEqual(doc.header.partName, "TurbineHousing");
    assert.strictEqual(doc.datumDefinitions.length, 2);
    assert.strictEqual(doc.features.length, 2);
    assert.strictEqual(doc.features[1]?.nominalSize, 40.0);
    assert.strictEqual(doc.characteristics[0]?.compositeLowerTier?.toleranceZone, 0.015);
    assert.strictEqual(doc.actuals[0]?.measuredValue, 0.055);
    assert.strictEqual(doc.actuals[0]?.actualFeatureSize, 40.02);

    // Round-trip via JSON representation
    const jsonDoc = parseQif(JSON.stringify(doc));
    assert.strictEqual(jsonDoc.qpId, doc.qpId);
    assert.strictEqual(jsonDoc.features.length, 2);
    assert.strictEqual(jsonDoc.characteristics.length, 1);
  });
});
