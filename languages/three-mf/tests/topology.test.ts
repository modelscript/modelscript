// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseThreeMf } from "../src/parser/index.js";
import { lowerThreeMfToDae, verifyMeshTopology } from "../src/topology/index.js";

describe("3MF 2-Manifold Topology Engine & DAE Lowering", () => {
  const tetraXml = `<model unit="millimeter">
    <resources>
      <object id="1" name="TetraGuide" type="model" material="Ti-6Al-4V" wallThickness="2.0">
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
        <medical:SurgicalGuide patientId="PT-10" wallThickness="2.0" material="Ti-6Al-4V">
          <medical:DrillSleeve id="Sleeve1" entry="2 2 2" axis="0 0 1" innerDiameter="2.5" outerDiameter="4.5" wallThickness="1.0"/>
        </medical:SurgicalGuide>
      </object>
    </resources>
    <build>
      <item objectid="1"/>
    </build>
  </model>`;

  it("computes Euler characteristic chi = V - E + F = 2, signed volume, surface area, and AABB", () => {
    const doc = parseThreeMf(tetraXml);
    const topo = verifyMeshTopology(doc);
    assert.strictEqual(topo.vertexCount, 4);
    assert.strictEqual(topo.edgeCount, 6);
    assert.strictEqual(topo.faceCount, 4);
    assert.strictEqual(topo.eulerCharacteristic, 2);
    assert.strictEqual(topo.genus, 0);
    assert.strictEqual(topo.isWatertightManifold, true);
    assert(Math.abs(topo.signedVolumeMm3 - 1000.0 / 6.0) < 1e-3);
    assert(topo.surfaceAreaMm2 > 150.0);
    assert.deepStrictEqual(topo.boundingBox.size, [10, 10, 10]);
  });

  it("lowers 3MF mesh topology and surgical guide parameters to DAEBuilder", () => {
    const doc = parseThreeMf(tetraXml);
    const arena = lowerThreeMfToDae(doc);
    assert(arena.getVarCount() >= 4);
    assert(arena.getEqCount() >= 4);
  });
});
