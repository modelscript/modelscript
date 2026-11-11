// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import {
  executeThreeMfAction,
  getThreeMfCompletions,
  getThreeMfDefinition,
  getThreeMfDocumentSymbols,
  getThreeMfHover,
  resolveThreeMfInScope,
  threeMfLanguage,
  validateThreeMf,
} from "../src/index.js";

describe("3MF LSP Service & UnifiedWorkspace", () => {
  const sampleXml = `<model unit="millimeter">
    <resources>
      <basematerials id="5">
        <base name="PEEK" displaycolor="#D8C8B8"/>
      </basematerials>
      <object id="1" name="OrbitalFloorImplant" type="model" pid="5" pindex="0" wallThickness="1.5">
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
        <medical:SurgicalGuide patientId="PT-88" wallThickness="1.5" material="PEEK">
          <medical:DrillSleeve id="ScrewHole1" entry="2 2 0" axis="0 0 1" innerDiameter="1.6" outerDiameter="3.6" wallThickness="1.0"/>
        </medical:SurgicalGuide>
      </object>
    </resources>
    <build>
      <item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
    </build>
  </model>`;

  it("indexes symbols in UnifiedWorkspace and resolves across scope", () => {
    const ws = new UnifiedWorkspace(threeMfLanguage);
    const uri = "file:///orbital.3mf";
    ws.setDocument(uri, sampleXml);
    assert.strictEqual(ws.fileCount, 1);
    assert(ws.hasDocument(uri));

    const found = ws.findSymbolsByName("OrbitalFloorImplant");
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0]?.kind, "Component");

    const sleeve = resolveThreeMfInScope(ws, "ScrewHole1", found[0]!.id, uri);
    assert(sleeve !== null);
    assert.strictEqual(sleeve.namePath, "OrbitalFloorImplant.ScrewHole1");
  });

  it("provides LSP diagnostics, symbols, hover cards, completions, definition, and actions", async () => {
    assert.strictEqual(threeMfLanguage.name, "three-mf");
    assert(threeMfLanguage.fileExtensions.includes(".3mf"));

    const diags = validateThreeMf(sampleXml);
    assert.strictEqual(diags.length, 0);

    const symbols = getThreeMfDocumentSymbols(sampleXml);
    assert.strictEqual(symbols.length, 2);

    const hover = getThreeMfHover(sampleXml, sampleXml.indexOf("OrbitalFloorImplant"));
    assert(hover !== null);
    assert(hover.contents.value.includes("2-Manifold Watertight"));

    const def = getThreeMfDefinition(sampleXml, sampleXml.indexOf('objectid="1"'), "file:///orbital.3mf");
    assert(def !== null);
    assert.strictEqual(def.range.start.line, 5);

    const completions = getThreeMfCompletions(sampleXml);
    assert(completions.some((c) => c.label === "Ti-6Al-4V"));

    const topoRes = await executeThreeMfAction("three_mf_topology", sampleXml);
    assert.strictEqual(topoRes.eulerCharacteristic, 2);
  });
});
