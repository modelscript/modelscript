// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseThreeMf } from "../src/parser/index.js";
import { threeMfToScad, threeMfToStep } from "../src/projections/index.js";

describe("3MF Projections to ISO 10303-21 STEP AP242 and OpenSCAD", () => {
  const sampleDoc = parseThreeMf(`<model unit="millimeter">
    <metadata name="Title">TibialCuttingJig</metadata>
    <resources>
      <object id="1" name="TibialGuide" type="model" material="Ti-6Al-4V" wallThickness="2.0">
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
        <medical:SurgicalGuide patientId="PT-55" wallThickness="2.0" material="Ti-6Al-4V">
          <medical:DrillSleeve id="PinSleeve1" entry="3 3 0" axis="0 0 1" innerDiameter="2.0" outerDiameter="4.0" wallThickness="1.0"/>
        </medical:SurgicalGuide>
      </object>
    </resources>
    <build><item objectid="1"/></build>
  </model>`);

  it("projects 3MF mesh to ISO 10303-21 STEP AP242 CLOSED_SHELL", () => {
    const step = threeMfToStep(sampleDoc);
    assert(step.startsWith("ISO-10303-21;"));
    assert(step.includes("AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF"));
    assert(step.includes("CARTESIAN_POINT('V_0',(0,0,0));"));
    assert(step.includes("CLOSED_SHELL('TibialGuide_Shell'"));
    assert(step.includes("FACETED_BREP('TibialGuide'"));
  });

  it("projects 3MF mesh and surgical drill sleeves to OpenSCAD polyhedron CSG", () => {
    const scad = threeMfToScad(sampleDoc);
    assert(scad.includes("module ThreeMF_TibialGuide()"));
    assert(scad.includes("polyhedron(points = [[0, 0, 0], [10, 0, 0]"));
    assert(scad.includes("Drill Sleeve: PinSleeve1"));
  });
});
