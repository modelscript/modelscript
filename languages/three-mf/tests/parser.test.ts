// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseThreeMf } from "../src/parser/index.js";

describe("ISO/ASTM 52915 3MF & Medical Extension Parser", () => {
  const valid3mfXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:medical="http://schemas.modelscript.org/3mf/medical/2026/01">
  <metadata name="Title">Patient_Mandible_Osteotomy_Guide</metadata>
  <metadata name="Designer">Dr. CranioMaxillo</metadata>
  <resources>
    <basematerials id="10">
      <base name="Surgical Guide Resin" displaycolor="#E5C158"/>
      <base name="Ti-6Al-4V" displaycolor="#C0C0C0"/>
    </basematerials>
    <object id="1" name="MandibleCuttingGuide" type="model" pid="10" pindex="0" wallThickness="2.2">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="10" y="0" z="0"/>
          <vertex x="0" y="10" z="0"/>
          <vertex x="0" y="0" z="10"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="2" v3="1"/>
          <triangle v1="0" v2="1" v3="3"/>
          <triangle v1="0" v2="3" v3="2"/>
          <triangle v1="1" v2="2" v3="3"/>
        </triangles>
      </mesh>
      <medical:SurgicalGuide patientId="PT-2026-09" anatomicalSite="LeftMandible" wallThickness="2.2" material="Surgical Guide Resin" sterilization="Autoclave">
        <medical:OsteotomyPlane id="ProximalCut" origin="2 2 5" normal="1 0 0" slotWidth="1.2"/>
        <medical:DrillSleeve id="KWireSleeve1" entry="3 3 5" axis="0 0 1" innerDiameter="2.0" outerDiameter="4.4" wallThickness="1.2" length="10.0"/>
      </medical:SurgicalGuide>
    </object>
  </resources>
  <build>
    <item objectid="1" transform="1 0 0 0 1 0 0 0 1 15 20 0" partnumber="GUIDE-MAND-01"/>
  </build>
</model>`;

  it("parses 3MF XML model, mesh vertices/triangles, base materials, surgical guide specs, and build items", () => {
    const doc = parseThreeMf(valid3mfXml, "file:///mandible_guide.3mf");
    assert.strictEqual(doc.unit, "millimeter");
    assert.strictEqual(doc.metadata["Title"], "Patient_Mandible_Osteotomy_Guide");
    assert.strictEqual(doc.baseMaterialGroups.length, 1);
    assert.strictEqual(doc.baseMaterialGroups[0]?.materials.length, 2);
    assert.strictEqual(doc.baseMaterialGroups[0]?.materials[0]?.name, "Surgical Guide Resin");

    assert.strictEqual(doc.objects.length, 1);
    const obj = doc.objects[0]!;
    assert.strictEqual(obj.id, "1");
    assert.strictEqual(obj.name, "MandibleCuttingGuide");
    assert.strictEqual(obj.materialName, "Surgical Guide Resin");
    assert.strictEqual(obj.wallThicknessMm, 2.2);
    assert.strictEqual(obj.mesh?.vertices.length, 4);
    assert.strictEqual(obj.mesh?.triangles.length, 4);

    assert(obj.surgicalGuide !== undefined);
    assert.strictEqual(obj.surgicalGuide?.patientId, "PT-2026-09");
    assert.strictEqual(obj.surgicalGuide?.osteotomyPlanes.length, 1);
    assert.deepStrictEqual(obj.surgicalGuide?.osteotomyPlanes[0]?.normal, [1, 0, 0]);
    assert.strictEqual(obj.surgicalGuide?.drillSleeves.length, 1);
    assert.strictEqual(obj.surgicalGuide?.drillSleeves[0]?.innerDiameterMm, 2.0);
    assert.strictEqual(obj.surgicalGuide?.drillSleeves[0]?.wallThicknessMm, 1.2);

    assert.strictEqual(doc.buildItems.length, 1);
    assert.strictEqual(doc.buildItems[0]?.objectId, "1");
    assert.strictEqual(doc.buildItems[0]?.partNumber, "GUIDE-MAND-01");
    assert.strictEqual(doc.buildItems[0]?.transform?.length, 12);

    // JSON round-trip
    const roundTrip = parseThreeMf(JSON.stringify(doc));
    assert.strictEqual(roundTrip.objects.length, 1);
    assert.strictEqual(roundTrip.objects[0]?.mesh?.triangles.length, 4);
  });
});
