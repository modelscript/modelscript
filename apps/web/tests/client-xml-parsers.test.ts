// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePscadClient } from "../src/components/artifacts/pscad-client-parser.js";
import { parseSsdClientModel } from "../src/components/artifacts/ssp-client-parser.js";

describe("Web Client XML CST Parsers (PSCAD & SSP)", () => {
  it("parses PSCAD XML with nested elements, CDATA stickies, and bus/wire parameters without regex corruption", () => {
    const pscadXml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="TestGrid">
  <schematic>
    <User id="u_gen1" defn="source_3p" x="120" y="150" orient="0">
      <param name="Name" value="HydroGen"/>
      <param name="V_base" value="13.8"/>
    </User>
    <User id="u_xfmr" defn="xfmr-3p2w" x="300" y="150">
      <param name="Name" value="GSU_1"/>
      <param name="MVA" value="100"/>
    </User>
    <Bus id="b_13kv" name="Bus_13kV" vbase="13.8" x="200" y="150" length="120"/>
    <Wire id="w_1" x="120" y="150">
      <Vertex x="0" y="0"/>
      <Vertex x="80" y="0"/>
    </Wire>
    <Sticky id="s_note" x="50" y="50" w="300" h="40">
      <![CDATA[Primary GSU Interconnect & Protection Zone]]>
    </Sticky>
  </schematic>
  <paramlist name="Settings">
    <param name="time_step" value="20.0"/>
  </paramlist>
</project>`;

    const result = parsePscadClient(pscadXml);

    assert.strictEqual(result.componentCount, 2);
    assert.strictEqual(result.components[0]?.id, "u_gen1");
    assert.strictEqual(result.components[0]?.instanceName, "HydroGen");
    assert.strictEqual(result.components[0]?.parameters["V_base"], "13.8");

    assert.strictEqual(result.busCount, 1);
    assert.strictEqual(result.buses[0]?.id, "b_13kv");
    assert.strictEqual(result.buses[0]?.voltageBaseKv, 13.8);

    assert.strictEqual(result.wires.length, 1);
    assert.strictEqual(result.wires[0]?.vertices.length, 2);
    assert.strictEqual(result.wires[0]?.vertices[0]?.x, 120);
    assert.strictEqual(result.wires[0]?.vertices[1]?.x, 200);

    assert.strictEqual(result.stickies.length, 1);
    assert.strictEqual(result.stickies[0]?.text, "Primary GSU Interconnect & Protection Zone");

    assert.strictEqual(result.transformerCount, 1);
    assert.strictEqual(result.timeStepUs, 20.0);
  });

  it("parses SSP .ssd XML with namespaces, connectors, and connections without regex heuristics", () => {
    const ssdXml = `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription" xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon" version="1.0" name="DualChassisDrive">
  <ssd:System name="PowertrainSystem">
    <ssd:Elements>
      <ssd:Component name="Battery" source="resources/Battery.fmu" type="application/x-fmu-sharedlibrary">
        <ssd:Connectors>
          <ssd:Connector name="P_out_W" kind="output">
            <ssc:Real unit="W"/>
          </ssd:Connector>
          <ssd:Connector name="T_cell_K" kind="output">
            <ssc:Real unit="K"/>
          </ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="Inverter" source="resources/Inverter.fmu">
        <ssd:Connectors>
          <ssd:Connector name="P_in_W" kind="input">
            <ssc:Real unit="W"/>
          </ssd:Connector>
          <ssd:Connector name="Torque_Nm" kind="output">
            <ssc:Real unit="N.m"/>
          </ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
    </ssd:Elements>
    <ssd:Connections>
      <ssd:Connection startElement="Battery" startConnector="P_out_W" endElement="Inverter" endConnector="P_in_W"/>
  </ssd:System>
  <ssd:DefaultExperiment startTime="0.0" stopTime="120.0" stepSize="0.001" algorithm="CoSimulation-Master"/>
</ssd:SystemStructureDescription>`;
    const result = parseSsdClientModel(ssdXml, {});

    assert.strictEqual(result.systemName, "PowertrainSystem");
    assert.strictEqual(result.sspVersion, "1.0");
    assert.strictEqual(result.startTime, 0.0);
    assert.strictEqual(result.stopTime, 120.0);
    assert.strictEqual(result.communicationStepMs, 1.0);
    assert.strictEqual(result.masterAlgorithm, "CoSimulation-Master");

    assert.strictEqual(result.fmus.length, 2);
    assert.strictEqual(result.fmus[0]?.name, "Battery");
    assert.strictEqual(result.fmus[0]?.ports?.length, 2);
    assert.strictEqual(result.fmus[0]?.ports?.[0]?.unit, "W");

    assert.strictEqual(result.connections.length, 1);
    assert.strictEqual(result.connections[0]?.startElement, "Battery");
    assert.strictEqual(result.connections[0]?.startConnector, "P_out_W");
    assert.strictEqual(result.connections[0]?.endElement, "Inverter");
    assert.strictEqual(result.connections[0]?.endConnector, "P_in_W");
    assert.strictEqual(result.connections[0]?.unit, "W");
  });
});
