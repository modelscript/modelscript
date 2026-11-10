// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseCgmesFiles, parseCgmesRdf } from "../src/index.js";

const SAMPLE_EQ_RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#">
  <cim:Substation rdf:ID="_sub1">
    <cim:IdentifiedObject.name>Alpha Substation</cim:IdentifiedObject.name>
  </cim:Substation>
  <cim:BaseVoltage rdf:ID="_bv220">
    <cim:BaseVoltage.nominalVoltage>220.0</cim:BaseVoltage.nominalVoltage>
  </cim:BaseVoltage>
  <cim:VoltageLevel rdf:ID="_vl1">
    <cim:IdentifiedObject.name>Alpha 220kV</cim:IdentifiedObject.name>
    <cim:VoltageLevel.BaseVoltage rdf:resource="#_bv220"/>
    <cim:VoltageLevel.Substation rdf:resource="#_sub1"/>
    <cim:VoltageLevel.lowVoltageLimit>200.0</cim:VoltageLevel.lowVoltageLimit>
    <cim:VoltageLevel.highVoltageLimit>240.0</cim:VoltageLevel.highVoltageLimit>
  </cim:VoltageLevel>
  <cim:TopologicalNode rdf:ID="_node1">
    <cim:IdentifiedObject.name>BUS_ALPHA</cim:IdentifiedObject.name>
    <cim:TopologicalNode.BaseVoltage rdf:resource="#_bv220"/>
    <cim:TopologicalNode.ConnectivityNodeContainer rdf:resource="#_vl1"/>
  </cim:TopologicalNode>
  <cim:SynchronousMachine rdf:ID="_gen1">
    <cim:IdentifiedObject.name>GEN_ALPHA</cim:IdentifiedObject.name>
    <cim:RotatingMachine.ratedS>200.0</cim:RotatingMachine.ratedS>
    <cim:SynchronousMachine.p>100.0</cim:SynchronousMachine.p>
    <cim:SynchronousMachine.q>20.0</cim:SynchronousMachine.q>
    <cim:SynchronousMachine.minP>10.0</cim:SynchronousMachine.minP>
    <cim:SynchronousMachine.maxP>180.0</cim:SynchronousMachine.maxP>
  </cim:SynchronousMachine>
  <cim:Terminal rdf:ID="_term_gen1">
    <cim:IdentifiedObject.name>Gen_T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_gen1"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node1"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>
</rdf:RDF>`;

const SAMPLE_SSH_RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#">
  <cim:SynchronousMachine rdf:about="#_gen1">
    <cim:RotatingMachine.p>120.0</cim:RotatingMachine.p>
    <cim:RotatingMachine.q>25.0</cim:RotatingMachine.q>
  </cim:SynchronousMachine>
</rdf:RDF>`;

test("CGMES Parser: parses CIM/XML RDF equipment profile into structured CgmesModel", () => {
  const model = parseCgmesRdf(SAMPLE_EQ_RDF);

  assert.equal(model.substations.size, 1);
  assert.equal(model.voltageLevels.size, 1);
  assert.equal(model.nodes.size, 1);
  assert.equal(model.generators.size, 1);
  assert.equal(model.terminals.size, 1);

  const sub = model.substations.get("_sub1");
  assert.ok(sub);
  assert.equal(sub.name, "Alpha Substation");

  const vl = model.voltageLevels.get("_vl1");
  assert.ok(vl);
  assert.equal(vl.baseVoltageKv, 220.0);

  const gen = model.generators.get("_gen1");
  assert.ok(gen);
  assert.equal(gen.pMw, 100.0);
  assert.equal(gen.qMvar, 20.0);
});

test("CGMES Parser: multi-profile ingestion merges SSH steady-state hypothesis into EQ model", () => {
  const model = parseCgmesFiles([SAMPLE_EQ_RDF, SAMPLE_SSH_RDF]);

  const gen = model.generators.get("_gen1");
  assert.ok(gen);
  assert.equal(gen.pMw, 120.0, "SSH must override active power dispatch");
  assert.equal(gen.qMvar, 25.0, "SSH must override reactive power dispatch");
});
