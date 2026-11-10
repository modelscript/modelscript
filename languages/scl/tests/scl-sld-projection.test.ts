// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSclXml } from "../src/parser/scl-parser.js";
import { sclToGridTopology } from "../src/projections/scl-to-grid.js";

describe("IEC 61850 Single-Line Diagram & Grid Topology Projection", () => {
  const substationSsd = `<?xml version="1.0" encoding="UTF-8"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B">
  <Header id="SSD_TOPOLOGY" version="1.0" revision="0"/>
  <Substation name="PARIS_NORD_400">
    <VoltageLevel name="400kV">
      <Voltage unit="V" multiplier="k">400.0</Voltage>
      <Bay name="BAY_LINE1">
        <ConductingEquipment name="CB_L1" type="CBR">
          <Terminal name="T1" connectivityNode="PARIS_NORD_400/400kV/BAY_LINE1/BUS1"/>
          <Terminal name="T2" connectivityNode="PARIS_NORD_400/400kV/BAY_LINE1/NODE_L1"/>
        </ConductingEquipment>
        <ConductingEquipment name="DS_L1" type="DIS">
          <Terminal name="T1" connectivityNode="PARIS_NORD_400/400kV/BAY_LINE1/NODE_L1"/>
          <Terminal name="T2" connectivityNode="PARIS_NORD_400/400kV/BAY_LINE1/LINE_OUT"/>
        </ConductingEquipment>
        <ConnectivityNode name="BUS1" pathName="PARIS_NORD_400/400kV/BAY_LINE1/BUS1"/>
        <ConnectivityNode name="NODE_L1" pathName="PARIS_NORD_400/400kV/BAY_LINE1/NODE_L1"/>
        <ConnectivityNode name="LINE_OUT" pathName="PARIS_NORD_400/400kV/BAY_LINE1/LINE_OUT"/>
      </Bay>
      <Bay name="BAY_TR1">
        <ConductingEquipment name="T1" type="PTR">
          <Terminal name="T1" connectivityNode="PARIS_NORD_400/400kV/BAY_TR1/BUS1"/>
          <Terminal name="T2" connectivityNode="PARIS_NORD_400/220kV/BAY_TR1/SEC_BUS"/>
        </ConductingEquipment>
      </Bay>
    </VoltageLevel>
  </Substation>
</SCL>`;

  it("should extract node-breaker electrical bus-branch topology from SCL", () => {
    const doc = parseSclXml(substationSsd);
    const topo = sclToGridTopology(doc);

    assert.equal(topo.substationName, "PARIS_NORD_400");
    assert.equal(topo.nodes.length, 3);
    assert.equal(topo.equipment.length, 3);
    assert.equal(topo.breakerCount, 1);
    assert.equal(topo.disconnectorCount, 1);
    assert.equal(topo.transformerCount, 1);

    const cb = topo.equipment.find((e) => e.name === "CB_L1");
    assert.ok(cb);
    assert.equal(cb.type, "CBR");
    assert.equal(cb.fromNode, "PARIS_NORD_400/400kV/BAY_LINE1/BUS1");
    assert.equal(cb.toNode, "PARIS_NORD_400/400kV/BAY_LINE1/NODE_L1");
    assert.equal(cb.voltageKv, 400.0);
  });
});
