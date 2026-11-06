// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { solvePowerFlow } from "@modelscript/psse";
import { solveAcOpf, solveDcOpf } from "@modelscript/simulate/opf";
import {
  cgmesToModelica,
  cgmesToPsse,
  lintCgmesModel,
  parseCgmesFiles,
  parseCgmesRdf,
  processTopology,
} from "../src/index.js";

const sampleMicroGridEqRdf = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#">

  <cim:Substation rdf:ID="_sub1">
    <cim:IdentifiedObject.name>North Substation</cim:IdentifiedObject.name>
  </cim:Substation>

  <cim:Substation rdf:ID="_sub2">
    <cim:IdentifiedObject.name>South Substation</cim:IdentifiedObject.name>
  </cim:Substation>

  <cim:BaseVoltage rdf:ID="_bv400">
    <cim:BaseVoltage.nominalVoltage>400.0</cim:BaseVoltage.nominalVoltage>
  </cim:BaseVoltage>

  <cim:VoltageLevel rdf:ID="_vl1">
    <cim:IdentifiedObject.name>North 400kV</cim:IdentifiedObject.name>
    <cim:VoltageLevel.BaseVoltage rdf:resource="#_bv400"/>
    <cim:VoltageLevel.Substation rdf:resource="#_sub1"/>
    <cim:VoltageLevel.lowVoltageLimit>380.0</cim:VoltageLevel.lowVoltageLimit>
    <cim:VoltageLevel.highVoltageLimit>420.0</cim:VoltageLevel.highVoltageLimit>
  </cim:VoltageLevel>

  <cim:VoltageLevel rdf:ID="_vl2">
    <cim:IdentifiedObject.name>South 400kV</cim:IdentifiedObject.name>
    <cim:VoltageLevel.BaseVoltage rdf:resource="#_bv400"/>
    <cim:VoltageLevel.Substation rdf:resource="#_sub2"/>
    <cim:VoltageLevel.lowVoltageLimit>380.0</cim:VoltageLevel.lowVoltageLimit>
    <cim:VoltageLevel.highVoltageLimit>420.0</cim:VoltageLevel.highVoltageLimit>
  </cim:VoltageLevel>

  <cim:TopologicalNode rdf:ID="_node1">
    <cim:IdentifiedObject.name>BUS_1</cim:IdentifiedObject.name>
    <cim:TopologicalNode.BaseVoltage rdf:resource="#_bv400"/>
    <cim:TopologicalNode.ConnectivityNodeContainer rdf:resource="#_vl1"/>
  </cim:TopologicalNode>

  <cim:TopologicalNode rdf:ID="_node2">
    <cim:IdentifiedObject.name>BUS_2</cim:IdentifiedObject.name>
    <cim:TopologicalNode.BaseVoltage rdf:resource="#_bv400"/>
    <cim:TopologicalNode.ConnectivityNodeContainer rdf:resource="#_vl2"/>
  </cim:TopologicalNode>

  <cim:ACLineSegment rdf:ID="_line1">
    <cim:IdentifiedObject.name>Intertie_1_2</cim:IdentifiedObject.name>
    <cim:ACLineSegment.r>0.02</cim:ACLineSegment.r>
    <cim:ACLineSegment.x>0.08</cim:ACLineSegment.x>
    <cim:ACLineSegment.bch>0.04</cim:ACLineSegment.bch>
    <cim:ACLineSegment.length>50.0</cim:ACLineSegment.length>
    <cim:ACLineSegment.ratedCurrent>1500.0</cim:ACLineSegment.ratedCurrent>
  </cim:ACLineSegment>

  <cim:Terminal rdf:ID="_term1">
    <cim:IdentifiedObject.name>Line_T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_line1"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node1"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <cim:Terminal rdf:ID="_term2">
    <cim:IdentifiedObject.name>Line_T2</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_line1"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node2"/>
    <cim:Terminal.sequenceNumber>2</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <cim:SynchronousMachine rdf:ID="_gen1">
    <cim:IdentifiedObject.name>HYDRO_GEN_1</cim:IdentifiedObject.name>
    <cim:RotatingMachine.ratedS>300.0</cim:RotatingMachine.ratedS>
    <cim:SynchronousMachine.p>150.0</cim:SynchronousMachine.p>
    <cim:SynchronousMachine.q>30.0</cim:SynchronousMachine.q>
    <cim:SynchronousMachine.minP>20.0</cim:SynchronousMachine.minP>
    <cim:SynchronousMachine.maxP>250.0</cim:SynchronousMachine.maxP>
    <cim:SynchronousMachine.minQ>-100.0</cim:SynchronousMachine.minQ>
    <cim:SynchronousMachine.maxQ>150.0</cim:SynchronousMachine.maxQ>
  </cim:SynchronousMachine>

  <cim:Terminal rdf:ID="_term_gen1">
    <cim:IdentifiedObject.name>Gen_T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_gen1"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node1"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <cim:EnergyConsumer rdf:ID="_load1">
    <cim:IdentifiedObject.name>CITY_LOAD_2</cim:IdentifiedObject.name>
    <cim:EnergyConsumer.p>120.0</cim:EnergyConsumer.p>
    <cim:EnergyConsumer.q>40.0</cim:EnergyConsumer.q>
  </cim:EnergyConsumer>

  <cim:Terminal rdf:ID="_term_load1">
    <cim:IdentifiedObject.name>Load_T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_load1"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node2"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <cim:LinearShuntCompensator rdf:ID="_shunt1">
    <cim:IdentifiedObject.name>CAP_BANK_2</cim:IdentifiedObject.name>
    <cim:LinearShuntCompensator.bPerSection>0.0001</cim:LinearShuntCompensator.bPerSection>
    <cim:LinearShuntCompensator.sections>1</cim:LinearShuntCompensator.sections>
  </cim:LinearShuntCompensator>

  <cim:Terminal rdf:ID="_term_shunt1">
    <cim:IdentifiedObject.name>Shunt_T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_shunt1"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node2"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>
</rdf:RDF>`;

const sampleSshRdf = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#">

  <cim:SynchronousMachine rdf:about="#_gen1">
    <cim:RotatingMachine.p>140.0</cim:RotatingMachine.p>
    <cim:RotatingMachine.q>25.0</cim:RotatingMachine.q>
  </cim:SynchronousMachine>

  <cim:EnergyConsumer rdf:about="#_load1">
    <cim:EnergyConsumer.p>130.0</cim:EnergyConsumer.p>
    <cim:EnergyConsumer.q>45.0</cim:EnergyConsumer.q>
  </cim:EnergyConsumer>
</rdf:RDF>`;

test("CGMES parser loads EQ and SSH profiles accurately", () => {
  const model = parseCgmesFiles([sampleMicroGridEqRdf, sampleSshRdf]);

  assert.equal(model.substations.size, 2);
  assert.equal(model.voltageLevels.size, 2);
  assert.equal(model.nodes.size, 2);
  assert.equal(model.lines.size, 1);
  assert.equal(model.generators.size, 1);
  assert.equal(model.loads.size, 1);

  // SSH updated generator p from 150.0 to 140.0
  const gen = model.generators.get("_gen1");
  assert.ok(gen);
  assert.equal(gen.pMw, 140.0);
  assert.equal(gen.qMvar, 25.0);

  // SSH updated load p from 120.0 to 130.0
  const load = model.loads.get("_load1");
  assert.ok(load);
  assert.equal(load.pMw, 130.0);
});

test("CGMES topology processor correctly associates terminals and detects single island", () => {
  const model = parseCgmesRdf(sampleMicroGridEqRdf);
  const topo = processTopology(model);

  assert.equal(topo.islandCount, 1);
  assert.equal(topo.terminalToNode.get("_term1"), "_node1");
  assert.equal(topo.terminalToNode.get("_term2"), "_node2");
  assert.equal(topo.terminalToNode.get("_term_gen1"), "_node1");
  assert.equal(topo.terminalToNode.get("_term_load1"), "_node2");
});

test("CGMES to PSS/E projection solves AC power flow and AC-OPF", () => {
  const model = parseCgmesFiles([sampleMicroGridEqRdf, sampleSshRdf]);
  const { psseCase } = cgmesToPsse(model);

  assert.equal(psseCase.buses.size, 2);
  assert.equal(psseCase.branches.length, 1);
  assert.equal(psseCase.generators.length, 1);
  assert.equal(psseCase.loads.length, 1);

  // Solve AC Power Flow
  const pf = solvePowerFlow(psseCase, { algorithm: "nr", maxIterations: 20 });
  assert.ok(pf.converged, "AC power flow must converge on CGMES case");
  assert.equal(pf.buses.length, 2);

  // Solve DC-OPF
  const dcOpf = solveDcOpf(psseCase);
  assert.equal(dcOpf.status, "OPTIMAL", "DC-OPF must converge on CGMES case");
  assert.ok(dcOpf.totalGenMw >= dcOpf.totalLoadMw);

  // Solve AC-OPF
  const acOpf = solveAcOpf(psseCase);
  assert.equal(acOpf.status, "OPTIMAL", "AC-OPF must converge on CGMES case");
  assert.ok(acOpf.totalLossMw >= 0);
});

test("CGMES to Modelica projection emits valid OpenIPSL model code", () => {
  const model = parseCgmesRdf(sampleMicroGridEqRdf);
  const moCode = cgmesToModelica(model, {
    packageName: "EuropeanMicroGrid",
    modelName: "TwoBusCase",
  });

  assert.ok(moCode.includes("package EuropeanMicroGrid"));
  assert.ok(moCode.includes("model TwoBusCase"));
  assert.ok(moCode.includes("OpenIPSL.Electrical.Buses.Bus"));
  assert.ok(moCode.includes("OpenIPSL.Electrical.Branches.Line"));
  assert.ok(moCode.includes("OpenIPSL.Electrical.Machines.PSSE.GENSAL"));
  assert.ok(moCode.includes("OpenIPSL.Electrical.Loads.PSSE.Load"));
  assert.ok(moCode.includes("connect("));
});

test("CGMES static linter detects violations C1002, C1004, C1006", () => {
  const badModel = parseCgmesRdf(sampleMicroGridEqRdf);

  // Introduce orphan terminal
  badModel.terminals.set("_orphan", {
    mRID: "_orphan",
    name: "Orphan_T",
    conductingEquipmentId: "_non_existent_line",
    sequenceNumber: 1,
  });

  // Introduce invalid voltage level
  badModel.voltageLevels.set("_bad_vl", {
    mRID: "_bad_vl",
    name: "Bad_VL",
    baseVoltageKv: -10,
  });

  // Introduce generator limit inversion
  const g = badModel.generators.get("_gen1")!;
  g.minPMw = 300;
  g.maxPMw = 100;

  const diags = lintCgmesModel(badModel);
  const codes = diags.map((d) => d.code);

  assert.ok(codes.includes("C1002"), "Should detect C1002 orphan terminal");
  assert.ok(codes.includes("C1004"), "Should detect C1004 invalid voltage level");
  assert.ok(codes.includes("C1006"), "Should detect C1006 generator limit inversion");
});
