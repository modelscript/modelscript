// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseCgmesRdf, processTopology } from "../src/index.js";

const TWO_ISLAND_EQ_RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#">
  <!-- Island 1 -->
  <cim:TopologicalNode rdf:ID="_node_A1">
    <cim:IdentifiedObject.name>BUS_A1</cim:IdentifiedObject.name>
  </cim:TopologicalNode>
  <cim:TopologicalNode rdf:ID="_node_A2">
    <cim:IdentifiedObject.name>BUS_A2</cim:IdentifiedObject.name>
  </cim:TopologicalNode>
  <cim:ACLineSegment rdf:ID="_line_A">
    <cim:IdentifiedObject.name>LINE_A</cim:IdentifiedObject.name>
    <cim:ACLineSegment.r>0.01</cim:ACLineSegment.r>
    <cim:ACLineSegment.x>0.05</cim:ACLineSegment.x>
  </cim:ACLineSegment>
  <cim:Terminal rdf:ID="_term_A1">
    <cim:Terminal.ConductingEquipment rdf:resource="#_line_A"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_A1"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>
  <cim:Terminal rdf:ID="_term_A2">
    <cim:Terminal.ConductingEquipment rdf:resource="#_line_A"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_A2"/>
    <cim:Terminal.sequenceNumber>2</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <!-- Island 2 (Disconnected from Island 1) -->
  <cim:TopologicalNode rdf:ID="_node_B1">
    <cim:IdentifiedObject.name>BUS_B1</cim:IdentifiedObject.name>
  </cim:TopologicalNode>
  <cim:TopologicalNode rdf:ID="_node_B2">
    <cim:IdentifiedObject.name>BUS_B2</cim:IdentifiedObject.name>
  </cim:TopologicalNode>
  <cim:ACLineSegment rdf:ID="_line_B">
    <cim:IdentifiedObject.name>LINE_B</cim:IdentifiedObject.name>
    <cim:ACLineSegment.r>0.02</cim:ACLineSegment.r>
    <cim:ACLineSegment.x>0.08</cim:ACLineSegment.x>
  </cim:ACLineSegment>
  <cim:Terminal rdf:ID="_term_B1">
    <cim:Terminal.ConductingEquipment rdf:resource="#_line_B"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_B1"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>
  <cim:Terminal rdf:ID="_term_B2">
    <cim:Terminal.ConductingEquipment rdf:resource="#_line_B"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_B2"/>
    <cim:Terminal.sequenceNumber>2</cim:Terminal.sequenceNumber>
  </cim:Terminal>
</rdf:RDF>`;

test("CGMES Topology: detects disjoint electrical islands via Union-Find algorithm", () => {
  const model = parseCgmesRdf(TWO_ISLAND_EQ_RDF);
  const topo = processTopology(model);

  assert.equal(topo.islandCount, 2, "Must detect exactly 2 disconnected electrical islands");
  assert.equal(topo.terminalToNode.get("_term_A1"), "_node_A1");
  assert.equal(topo.terminalToNode.get("_term_A2"), "_node_A2");
  assert.equal(topo.terminalToNode.get("_term_B1"), "_node_B1");
  assert.equal(topo.terminalToNode.get("_term_B2"), "_node_B2");
});
