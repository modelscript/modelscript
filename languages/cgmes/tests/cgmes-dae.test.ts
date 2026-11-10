// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerPsseToDae, solvePowerFlow } from "@modelscript/psse";
import {
  cgmesToModelica,
  cgmesToPsse,
  parseCgmesRdf,
} from "../src/index.js";

const DAE_EQ_RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#">
  <cim:BaseVoltage rdf:ID="_bv110">
    <cim:BaseVoltage.nominalVoltage>110.0</cim:BaseVoltage.nominalVoltage>
  </cim:BaseVoltage>
  <cim:TopologicalNode rdf:ID="_b1">
    <cim:IdentifiedObject.name>BUS_1</cim:IdentifiedObject.name>
    <cim:TopologicalNode.BaseVoltage rdf:resource="#_bv110"/>
  </cim:TopologicalNode>
  <cim:TopologicalNode rdf:ID="_b2">
    <cim:IdentifiedObject.name>BUS_2</cim:IdentifiedObject.name>
    <cim:TopologicalNode.BaseVoltage rdf:resource="#_bv110"/>
  </cim:TopologicalNode>
  <cim:ACLineSegment rdf:ID="_l12">
    <cim:IdentifiedObject.name>LINE_1_2</cim:IdentifiedObject.name>
    <cim:ACLineSegment.r>0.01</cim:ACLineSegment.r>
    <cim:ACLineSegment.x>0.05</cim:ACLineSegment.x>
    <cim:ACLineSegment.bch>0.02</cim:ACLineSegment.bch>
  </cim:ACLineSegment>
  <cim:Terminal rdf:ID="_t1">
    <cim:Terminal.ConductingEquipment rdf:resource="#_l12"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_b1"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>
  <cim:Terminal rdf:ID="_t2">
    <cim:Terminal.ConductingEquipment rdf:resource="#_l12"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_b2"/>
    <cim:Terminal.sequenceNumber>2</cim:Terminal.sequenceNumber>
  </cim:Terminal>
  <cim:SynchronousMachine rdf:ID="_g1">
    <cim:IdentifiedObject.name>GEN_1</cim:IdentifiedObject.name>
    <cim:RotatingMachine.ratedS>100.0</cim:RotatingMachine.ratedS>
    <cim:SynchronousMachine.p>60.0</cim:SynchronousMachine.p>
    <cim:SynchronousMachine.q>15.0</cim:SynchronousMachine.q>
    <cim:SynchronousMachine.minP>10.0</cim:SynchronousMachine.minP>
    <cim:SynchronousMachine.maxP>90.0</cim:SynchronousMachine.maxP>
  </cim:SynchronousMachine>
  <cim:Terminal rdf:ID="_tg1">
    <cim:Terminal.ConductingEquipment rdf:resource="#_g1"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_b1"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>
  <cim:EnergyConsumer rdf:ID="_d2">
    <cim:IdentifiedObject.name>LOAD_2</cim:IdentifiedObject.name>
    <cim:EnergyConsumer.p>55.0</cim:EnergyConsumer.p>
    <cim:EnergyConsumer.q>18.0</cim:EnergyConsumer.q>
  </cim:EnergyConsumer>
  <cim:Terminal rdf:ID="_td2">
    <cim:Terminal.ConductingEquipment rdf:resource="#_d2"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_b2"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>
</rdf:RDF>`;

test("CGMES DAE & Power Flow: projects CGMES to PSS/E and lowers to DAE arena", () => {
  const model = parseCgmesRdf(DAE_EQ_RDF);
  const { psseCase } = cgmesToPsse(model);

  assert.equal(psseCase.buses.size, 2);
  assert.equal(psseCase.branches.length, 1);

  const pf = solvePowerFlow(psseCase, { algorithm: "nr" });
  assert.ok(pf.converged);

  const dae = lowerPsseToDae(psseCase);
  assert.ok(dae.variables().length >= 8);
  assert.ok(dae.equations().length >= 4);
});

test("CGMES Modelica Projection: generates OpenIPSL Modelica code with proper interconnects", () => {
  const model = parseCgmesRdf(DAE_EQ_RDF);
  const mo = cgmesToModelica(model, {
    packageName: "TestGrid",
    modelName: "TwoBusModel",
  });

  assert.ok(mo.includes("package TestGrid"));
  assert.ok(mo.includes("model TwoBusModel"));
  assert.ok(mo.includes("OpenIPSL.Electrical.Buses.Bus"));
  assert.ok(mo.includes("OpenIPSL.Electrical.Branches.Line"));
  assert.ok(mo.includes("connect("));
});
