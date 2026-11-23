// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { extractThreeMfCadComponents } from "../src/cad.js";

describe("3MF 3D CAD Component Extraction (extractThreeMfCadComponents)", () => {
  const medicalGuide3mf = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:medical="http://schemas.modelscript.org/3mf/medical/2026/01">
  <metadata name="Title">Patient_Mandible_Osteotomy_Guide</metadata>
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
      <medical:SurgicalGuide patientId="PT-2026-09" anatomicalSite="LeftMandible" wallThickness="2.2"
        material="Surgical Guide Resin" sterilization="Autoclave">
        <medical:OsteotomyPlane id="ProximalCut" origin="2 2 5" normal="1 0 0" slotWidth="1.2"/>
        <medical:DrillSleeve id="KWireSleeve1" entry="3 3 5" axis="0 0 1" innerDiameter="2.0"
          outerDiameter="4.4" wallThickness="1.2" length="10.0"/>
      </medical:SurgicalGuide>
    </object>
  </resources>
  <build>
    <item objectid="1" transform="1 0 0 0 1 0 0 0 1 15 0 0"/>
  </build>
</model>`;

  it("extracts mesh, drill sleeve, and osteotomy plane with build transform and basematerials color", () => {
    const components = extractThreeMfCadComponents(medicalGuide3mf);
    assert.strictEqual(components.length, 3);

    const meshComp = components.find((c) => c.name === "MandibleCuttingGuide");
    assert.ok(meshComp, "expected MandibleCuttingGuide mesh component");
    assert.strictEqual(meshComp.shapeType, "mesh");
    assert.strictEqual(meshComp.proceduralMesh.indices.length, 12); // 4 triangles * 3
    assert.strictEqual(meshComp.proceduralMesh.vertices.length, 36); // 12 vertices * 3
    assert.strictEqual(meshComp.proceduralMesh.normals.length, 36);

    // Build item translated +15 along X; check first vertex (0,0,0) -> (15, 0, 0) in Y-up
    assert.strictEqual(meshComp.proceduralMesh.vertices[0], 15);
    assert.strictEqual(meshComp.proceduralMesh.vertices[1], 0);
    assert.strictEqual(meshComp.proceduralMesh.vertices[2], 0);

    // Base material #E5C158 -> [229/255, 193/255, 88/255, 1]
    assert.ok(meshComp.proceduralMesh.color);
    assert(Math.abs(meshComp.proceduralMesh.color[0] - 229 / 255) < 1e-4);
    assert(Math.abs(meshComp.proceduralMesh.color[1] - 193 / 255) < 1e-4);
    assert(Math.abs(meshComp.proceduralMesh.color[2] - 88 / 255) < 1e-4);
    assert.strictEqual(meshComp.proceduralMesh.color[3], 1.0);

    const sleeveComp = components.find((c) => c.name === "DrillSleeve KWireSleeve1");
    assert.ok(sleeveComp, "expected DrillSleeve KWireSleeve1 component");
    assert.strictEqual(sleeveComp.shapeType, "drillsleeve");
    assert(sleeveComp.proceduralMesh.indices.length > 0);
    assert.strictEqual(sleeveComp.proceduralMesh.vertices.length, sleeveComp.proceduralMesh.normals.length);

    const planeComp = components.find((c) => c.name === "OsteotomyPlane ProximalCut");
    assert.ok(planeComp, "expected OsteotomyPlane ProximalCut component");
    assert.strictEqual(planeComp.shapeType, "osteotomyplane");
    assert.strictEqual(planeComp.proceduralMesh.indices.length, 36); // 6 faces * 2 tris * 3
    assert.ok(planeComp.proceduralMesh.color && planeComp.proceduralMesh.color[3] < 1.0);
  });

  it("returns empty array for empty or non-3MF input without throwing", () => {
    assert.deepStrictEqual(extractThreeMfCadComponents(""), []);
    assert.deepStrictEqual(extractThreeMfCadComponents("   "), []);
    assert.deepStrictEqual(extractThreeMfCadComponents("<broken"), []);
  });
});
