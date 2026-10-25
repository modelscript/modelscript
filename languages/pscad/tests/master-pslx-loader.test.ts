// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAllMasterComponentSchemas,
  getMasterComponentSchema,
  getPscadPaletteCategories,
} from "../src/catalog/master-library-schemas.js";
import { getUserDefinitionForm } from "../src/model/definition-form.js";
import { clearPscadSources, registerMasterLibrary } from "../src/model/workspace-registry.js";

const sampleMasterPslx = `<?xml version="1.0" encoding="UTF-8"?>
<project name="master" version="5.1.0" type="library">
  <definitions>
    <Definition classid="UserCmpDefn" name="battery" id="1001">
      <form name="Battery Energy Storage System">
        <category name="Ratings" visible="true">
          <parameter name="Vnom" desc="Nominal Voltage" type="Real" unit="kV" min="0.1" max="100.0">
            <value><![CDATA[1.5]]></value>
          </parameter>
          <parameter name="CapAh" desc="Ampere-Hour Capacity" type="Real" unit="Ah" min="1.0">
            <value><![CDATA[500.0]]></value>
          </parameter>
          <parameter name="SoC0" desc="Initial State of Charge" type="Real" unit="pu" min="0.0" max="1.0">
            <value><![CDATA[0.85]]></value>
          </parameter>
        </category>
        <category name="Impedance" visible="true">
          <parameter name="R0" desc="Internal Resistance" type="Real" unit="ohm" min="0.0001">
            <value><![CDATA[0.02]]></value>
          </parameter>
        </category>
      </form>
      <graphics>
        <port name="pos" x="20" y="0" mode="3" dim="1" electype="1"/>
        <port name="neg" x="-20" y="0" mode="3" dim="1" electype="1"/>
        <port name="soc" x="0" y="-20" mode="2" dim="1" electype="0"/>
      </graphics>
      <script>
        <segment name="FlyBy">
          <FlyBy>
            <summary><![CDATA[Electrochemical Battery Energy Storage System (BESS) equivalent model.]]></summary>
          </FlyBy>
        </segment>
      </script>
    </Definition>

    <Definition classid="UserCmpDefn" name="rms3ph" id="1002">
      <form name="Three-Phase RMS Voltmeter">
        <category name="General" visible="true">
          <parameter name="Freq" desc="Nominal Frequency" type="Real" unit="Hz">
            <value><![CDATA[60.0]]></value>
          </parameter>
        </category>
      </form>
      <graphics>
        <port name="in" x="-20" y="0" mode="3" dim="3" electype="1"/>
        <port name="vrms" x="20" y="0" mode="2" dim="1" electype="0"/>
      </graphics>
      <script>
        <segment name="FlyBy">
          <FlyBy>
            <summary><![CDATA[Sliding 1-cycle RMS voltmeter for 3-phase circuits.]]></summary>
          </FlyBy>
        </segment>
      </script>
    </Definition>
  </definitions>
</project>`;

describe("PSCAD Local master.pslx Ingestion & Dynamic Catalog Suite", () => {
  it("ingests master.pslx and dynamically synthesizes component schemas", () => {
    clearPscadSources();
    registerMasterLibrary(sampleMasterPslx);

    // 1. Check getMasterComponentSchema for dynamic battery
    const batterySchema = getMasterComponentSchema("master:battery");
    assert.ok(batterySchema, "Battery schema should be dynamically synthesized");
    assert.equal(batterySchema.className, "master:battery");
    assert.equal(batterySchema.domain, "electrical");
    assert.equal(batterySchema.category, "Power Electronics, HVDC & FACTS");
    assert.ok(batterySchema.description.includes("Electrochemical Battery"));

    // Check ports
    assert.equal(batterySchema.ports.length, 3);
    const posPort = batterySchema.ports.find((p) => p.name === "pos");
    const socPort = batterySchema.ports.find((p) => p.name === "soc");
    assert.ok(posPort);
    assert.equal(posPort.kind, "electrical");
    assert.ok(socPort);
    assert.equal(socPort.kind, "signal");

    // Check parameters
    const vnomParam = batterySchema.parameters.find((p) => p.key === "Vnom");
    assert.ok(vnomParam);
    assert.equal(vnomParam.unit, "kV");
    assert.equal(vnomParam.defaultValue, 1.5);
    assert.equal(vnomParam.tab, "Ratings");

    // 2. Check getMasterComponentSchema for dynamic rms3ph
    const rmsSchema = getMasterComponentSchema("rms3ph");
    assert.ok(rmsSchema, "rms3ph schema should be dynamically synthesized");
    assert.equal(rmsSchema.className, "master:rms3ph");
    assert.equal(rmsSchema.category, "Meters, Probes & Buses");

    // 3. Check getUserDefinitionForm
    const form = getUserDefinitionForm("<dummy/>", "master:battery");
    assert.ok(form, "Should retrieve battery parameter form from master.pslx");
    assert.equal(form.title, "Battery Energy Storage System");
    assert.equal(form.categories.length, 2);

    // 4. Check getAllMasterComponentSchemas and palette
    const all = getAllMasterComponentSchemas();
    assert.ok(all.some((s) => s.className === "master:battery"));
    assert.ok(all.some((s) => s.className === "master:rms3ph"));

    const categories = getPscadPaletteCategories();
    const meterCat = categories.find((c) => c.name === "Meters, Probes & Buses");
    assert.ok(meterCat?.items.some((i) => i.className === "master:rms3ph"));
  });
});
