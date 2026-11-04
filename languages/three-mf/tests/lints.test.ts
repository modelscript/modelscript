// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintThreeMfDocument, ThreeMfErrorCode } from "../src/lints/index.js";
import { parseThreeMf } from "../src/parser/index.js";

describe("3MF Medical/Healthcare Semantic Linter (M9701–M9710)", () => {
  it("passes a valid watertight 2-manifold surgical guide with zero diagnostics", () => {
    const validXml = `<model unit="millimeter">
      <resources>
        <object id="1" name="CranialImplant" type="model" material="PEEK" wallThickness="2.0">
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
          <medical:SurgicalGuide patientId="PT-01" wallThickness="2.0" material="PEEK">
            <medical:OsteotomyPlane id="CutA" origin="0 0 5" normal="0 0 1"/>
            <medical:DrillSleeve id="SleeveA" entry="2 2 5" axis="0 0 1" innerDiameter="2.0" outerDiameter="4.0" wallThickness="1.0"/>
          </medical:SurgicalGuide>
        </object>
      </resources>
      <build>
        <item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
      </build>
    </model>`;

    const doc = parseThreeMf(validXml);
    const diags = lintThreeMfDocument(doc);
    assert.strictEqual(diags.length, 0);
  });

  it("detects M9701 (non-manifold edge), M9702 (degenerate triangle), M9703 (negative volume), and M9709 (out-of-bounds vertex)", () => {
    // Inverted tetrahedron with missing face (open boundary) + degenerate triangle + out-of-bounds triangle
    const badMeshXml = `<model unit="millimeter">
      <resources>
        <object id="1" name="InvertedTetra" type="model" material="Ti-6Al-4V" wallThickness="1.5">
          <mesh>
            <vertices>
              <vertex x="0" y="0" z="0"/>
              <vertex x="10" y="0" z="0"/>
              <vertex x="0" y="10" z="0"/>
              <vertex x="0" y="0" z="10"/>
            </vertices>
            <triangles>
              <triangle v1="0" v2="1" v3="2"/>
              <triangle v1="0" v2="3" v3="1"/>
              <triangle v1="0" v2="2" v3="3"/>
              <triangle v1="1" v2="1" v3="2"/>
            </triangles>
          </mesh>
        </object>
        <object id="2" name="OutOfBoundsMesh" type="model" material="Ti-6Al-4V" wallThickness="1.5">
          <mesh>
            <vertices>
              <vertex x="0" y="0" z="0"/>
              <vertex x="1" y="0" z="0"/>
              <vertex x="0" y="1" z="0"/>
            </vertices>
            <triangles>
              <triangle v1="0" v2="1" v3="99"/>
            </triangles>
          </mesh>
        </object>
      </resources>
      <build>
        <item objectid="1"/>
      </build>
    </model>`;

    const doc = parseThreeMf(badMeshXml);
    const diags = lintThreeMfDocument(doc);
    const codes = new Set(diags.map((d) => d.code));
    assert(codes.has(ThreeMfErrorCode.NON_MANIFOLD_EDGE.code));
    assert(codes.has(ThreeMfErrorCode.DEGENERATE_TRIANGLE.code));
    assert(codes.has(ThreeMfErrorCode.NEGATIVE_MESH_VOLUME.code));
    assert(codes.has(ThreeMfErrorCode.OUT_OF_BOUNDS_VERTEX_INDEX.code));
  });

  it("detects M9704 (unresolved build object), M9705 (wall thickness < 0.8mm), M9706 (zero axis), M9707 (non-biocompatible material), M9708 (singular transform), and M9710 (duplicate object ID)", () => {
    const clinicalViolationsXml = `<model unit="millimeter">
      <resources>
        <object id="1" name="ThinSurgicalGuide" type="model" material="StandardPLA" wallThickness="0.4">
          <medical:SurgicalGuide patientId="PT-02" wallThickness="0.4" material="StandardPLA">
            <medical:OsteotomyPlane id="ZeroNormalPlane" origin="0 0 0" normal="0 0 0"/>
            <medical:DrillSleeve id="ThinSleeve" entry="0 0 0" axis="0 0 0" innerDiameter="2.0" outerDiameter="2.8" wallThickness="0.4"/>
          </medical:SurgicalGuide>
        </object>
        <object id="1" name="DuplicateIdObj" type="model" material="Ti-6Al-4V">
        </object>
      </resources>
      <build>
        <item objectid="999" transform="0 0 0 0 1 0 0 0 1 0 0 0"/>
      </build>
    </model>`;

    const doc = parseThreeMf(clinicalViolationsXml);
    const diags = lintThreeMfDocument(doc);
    const codes = new Set(diags.map((d) => d.code));
    assert(codes.has(ThreeMfErrorCode.UNRESOLVED_BUILD_OBJECT.code));
    assert(codes.has(ThreeMfErrorCode.WALL_THICKNESS_VIOLATION.code));
    assert(codes.has(ThreeMfErrorCode.INVALID_OSTEOTOMY_GUIDE_AXIS.code));
    assert(codes.has(ThreeMfErrorCode.MISSING_BIOCOMPATIBLE_MATERIAL.code));
    assert(codes.has(ThreeMfErrorCode.SINGULAR_ITEM_TRANSFORM.code));
    assert(codes.has(ThreeMfErrorCode.DUPLICATE_OBJECT_ID.code));
  });
});
