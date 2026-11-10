// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for ENTSO-E CGMES (Common Grid Model Exchange Standard v2.4.15 / v3.0).
 *
 * Evaluates:
 * 1. European cross-border transmission corridor CIM/XML RDF ingestion (EQ + SSH profiles)
 * 2. Node-breaker and bus-branch topology processing and electrical island detection
 * 3. AC power flow simulation and Newton-Raphson convergence
 * 4. DAE arena lowering for algebraic power balance equations
 * 5. OpenIPSL Modelica projection for dynamic power grid simulation
 */

import assert from "node:assert/strict";
import { lowerPsseToDae, solvePowerFlow } from "@modelscript/psse";
import {
  cgmesToModelica,
  cgmesToPsse,
  lintCgmesModel,
  parseCgmesFiles,
  processTopology,
  type CgmesModel,
} from "../src/index.js";

export const CGMES_ENTSOE_CORRIDOR_EQ_RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#">

  <!-- Substations -->
  <cim:Substation rdf:ID="_sub_north">
    <cim:IdentifiedObject.name>North Hydro Substation</cim:IdentifiedObject.name>
  </cim:Substation>

  <cim:Substation rdf:ID="_sub_central">
    <cim:IdentifiedObject.name>Central Hub Substation</cim:IdentifiedObject.name>
  </cim:Substation>

  <cim:Substation rdf:ID="_sub_south">
    <cim:IdentifiedObject.name>South Industrial Substation</cim:IdentifiedObject.name>
  </cim:Substation>

  <!-- Base Voltage 400 kV -->
  <cim:BaseVoltage rdf:ID="_bv400">
    <cim:BaseVoltage.nominalVoltage>400.0</cim:BaseVoltage.nominalVoltage>
  </cim:BaseVoltage>

  <!-- Voltage Levels -->
  <cim:VoltageLevel rdf:ID="_vl_north">
    <cim:IdentifiedObject.name>North 400kV</cim:IdentifiedObject.name>
    <cim:VoltageLevel.BaseVoltage rdf:resource="#_bv400"/>
    <cim:VoltageLevel.Substation rdf:resource="#_sub_north"/>
    <cim:VoltageLevel.lowVoltageLimit>380.0</cim:VoltageLevel.lowVoltageLimit>
    <cim:VoltageLevel.highVoltageLimit>420.0</cim:VoltageLevel.highVoltageLimit>
  </cim:VoltageLevel>

  <cim:VoltageLevel rdf:ID="_vl_central">
    <cim:IdentifiedObject.name>Central 400kV</cim:IdentifiedObject.name>
    <cim:VoltageLevel.BaseVoltage rdf:resource="#_bv400"/>
    <cim:VoltageLevel.Substation rdf:resource="#_sub_central"/>
    <cim:VoltageLevel.lowVoltageLimit>380.0</cim:VoltageLevel.lowVoltageLimit>
    <cim:VoltageLevel.highVoltageLimit>420.0</cim:VoltageLevel.highVoltageLimit>
  </cim:VoltageLevel>

  <cim:VoltageLevel rdf:ID="_vl_south">
    <cim:IdentifiedObject.name>South 400kV</cim:IdentifiedObject.name>
    <cim:VoltageLevel.BaseVoltage rdf:resource="#_bv400"/>
    <cim:VoltageLevel.Substation rdf:resource="#_sub_south"/>
    <cim:VoltageLevel.lowVoltageLimit>380.0</cim:VoltageLevel.lowVoltageLimit>
    <cim:VoltageLevel.highVoltageLimit>420.0</cim:VoltageLevel.highVoltageLimit>
  </cim:VoltageLevel>

  <!-- Topological Nodes (Buses) -->
  <cim:TopologicalNode rdf:ID="_node_bus1">
    <cim:IdentifiedObject.name>BUS_NORTH_400</cim:IdentifiedObject.name>
    <cim:TopologicalNode.BaseVoltage rdf:resource="#_bv400"/>
    <cim:TopologicalNode.ConnectivityNodeContainer rdf:resource="#_vl_north"/>
  </cim:TopologicalNode>

  <cim:TopologicalNode rdf:ID="_node_bus2">
    <cim:IdentifiedObject.name>BUS_CENTRAL_400</cim:IdentifiedObject.name>
    <cim:TopologicalNode.BaseVoltage rdf:resource="#_bv400"/>
    <cim:TopologicalNode.ConnectivityNodeContainer rdf:resource="#_vl_central"/>
  </cim:TopologicalNode>

  <cim:TopologicalNode rdf:ID="_node_bus3">
    <cim:IdentifiedObject.name>BUS_SOUTH_400</cim:IdentifiedObject.name>
    <cim:TopologicalNode.BaseVoltage rdf:resource="#_bv400"/>
    <cim:TopologicalNode.ConnectivityNodeContainer rdf:resource="#_vl_south"/>
  </cim:TopologicalNode>

  <!-- 400 kV Transmission Lines -->
  <!-- Line 1: North to Central (80 km) -->
  <cim:ACLineSegment rdf:ID="_line_nc">
    <cim:IdentifiedObject.name>TIE_NORTH_CENTRAL</cim:IdentifiedObject.name>
    <cim:ACLineSegment.r>0.015</cim:ACLineSegment.r>
    <cim:ACLineSegment.x>0.060</cim:ACLineSegment.x>
    <cim:ACLineSegment.bch>0.050</cim:ACLineSegment.bch>
    <cim:ACLineSegment.length>80.0</cim:ACLineSegment.length>
    <cim:ACLineSegment.ratedCurrent>2000.0</cim:ACLineSegment.ratedCurrent>
  </cim:ACLineSegment>

  <cim:Terminal rdf:ID="_term_nc1">
    <cim:IdentifiedObject.name>LineNC_T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_line_nc"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_bus1"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <cim:Terminal rdf:ID="_term_nc2">
    <cim:IdentifiedObject.name>LineNC_T2</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_line_nc"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_bus2"/>
    <cim:Terminal.sequenceNumber>2</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <!-- Line 2: Central to South (100 km) -->
  <cim:ACLineSegment rdf:ID="_line_cs">
    <cim:IdentifiedObject.name>TIE_CENTRAL_SOUTH</cim:IdentifiedObject.name>
    <cim:ACLineSegment.r>0.020</cim:ACLineSegment.r>
    <cim:ACLineSegment.x>0.075</cim:ACLineSegment.x>
    <cim:ACLineSegment.bch>0.065</cim:ACLineSegment.bch>
    <cim:ACLineSegment.length>100.0</cim:ACLineSegment.length>
    <cim:ACLineSegment.ratedCurrent>2000.0</cim:ACLineSegment.ratedCurrent>
  </cim:ACLineSegment>

  <cim:Terminal rdf:ID="_term_cs1">
    <cim:IdentifiedObject.name>LineCS_T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_line_cs"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_bus2"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <cim:Terminal rdf:ID="_term_cs2">
    <cim:IdentifiedObject.name>LineCS_T2</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_line_cs"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_bus3"/>
    <cim:Terminal.sequenceNumber>2</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <!-- Line 3: North to South bypass (160 km) -->
  <cim:ACLineSegment rdf:ID="_line_ns">
    <cim:IdentifiedObject.name>TIE_NORTH_SOUTH_BYPASS</cim:IdentifiedObject.name>
    <cim:ACLineSegment.r>0.032</cim:ACLineSegment.r>
    <cim:ACLineSegment.x>0.120</cim:ACLineSegment.x>
    <cim:ACLineSegment.bch>0.090</cim:ACLineSegment.bch>
    <cim:ACLineSegment.length>160.0</cim:ACLineSegment.length>
    <cim:ACLineSegment.ratedCurrent>1800.0</cim:ACLineSegment.ratedCurrent>
  </cim:ACLineSegment>

  <cim:Terminal rdf:ID="_term_ns1">
    <cim:IdentifiedObject.name>LineNS_T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_line_ns"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_bus1"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <cim:Terminal rdf:ID="_term_ns2">
    <cim:IdentifiedObject.name>LineNS_T2</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_line_ns"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_bus3"/>
    <cim:Terminal.sequenceNumber>2</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <!-- Generators -->
  <!-- Hydro Generator at North Bus (Slack/Base) -->
  <cim:SynchronousMachine rdf:ID="_gen_north">
    <cim:IdentifiedObject.name>HYDRO_GEN_NORTH</cim:IdentifiedObject.name>
    <cim:RotatingMachine.ratedS>800.0</cim:RotatingMachine.ratedS>
    <cim:SynchronousMachine.p>450.0</cim:SynchronousMachine.p>
    <cim:SynchronousMachine.q>50.0</cim:SynchronousMachine.q>
    <cim:SynchronousMachine.minP>50.0</cim:SynchronousMachine.minP>
    <cim:SynchronousMachine.maxP>750.0</cim:SynchronousMachine.maxP>
    <cim:SynchronousMachine.minQ>-250.0</cim:SynchronousMachine.minQ>
    <cim:SynchronousMachine.maxQ>350.0</cim:SynchronousMachine.maxQ>
  </cim:SynchronousMachine>

  <cim:Terminal rdf:ID="_term_gen_north">
    <cim:IdentifiedObject.name>GenNorth_T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_gen_north"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_bus1"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <!-- Thermal Generator at Central Bus -->
  <cim:SynchronousMachine rdf:ID="_gen_central">
    <cim:IdentifiedObject.name>CCGT_GEN_CENTRAL</cim:IdentifiedObject.name>
    <cim:RotatingMachine.ratedS>500.0</cim:RotatingMachine.ratedS>
    <cim:SynchronousMachine.p>300.0</cim:SynchronousMachine.p>
    <cim:SynchronousMachine.q>30.0</cim:SynchronousMachine.q>
    <cim:SynchronousMachine.minP>40.0</cim:SynchronousMachine.minP>
    <cim:SynchronousMachine.maxP>480.0</cim:SynchronousMachine.maxP>
    <cim:SynchronousMachine.minQ>-150.0</cim:SynchronousMachine.minQ>
    <cim:SynchronousMachine.maxQ>200.0</cim:SynchronousMachine.maxQ>
  </cim:SynchronousMachine>

  <cim:Terminal rdf:ID="_term_gen_central">
    <cim:IdentifiedObject.name>GenCentral_T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_gen_central"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_bus2"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <!-- Loads -->
  <!-- Central Urban Load -->
  <cim:EnergyConsumer rdf:ID="_load_central">
    <cim:IdentifiedObject.name>CENTRAL_URBAN_LOAD</cim:IdentifiedObject.name>
    <cim:EnergyConsumer.p>350.0</cim:EnergyConsumer.p>
    <cim:EnergyConsumer.q>100.0</cim:EnergyConsumer.q>
  </cim:EnergyConsumer>

  <cim:Terminal rdf:ID="_term_load_central">
    <cim:IdentifiedObject.name>LoadCentral_T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_load_central"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_bus2"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <!-- South Industrial Center Load -->
  <cim:EnergyConsumer rdf:ID="_load_south">
    <cim:IdentifiedObject.name>SOUTH_HEAVY_INDUSTRY</cim:IdentifiedObject.name>
    <cim:EnergyConsumer.p>380.0</cim:EnergyConsumer.p>
    <cim:EnergyConsumer.q>120.0</cim:EnergyConsumer.q>
  </cim:EnergyConsumer>

  <cim:Terminal rdf:ID="_term_load_south">
    <cim:IdentifiedObject.name>LoadSouth_T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_load_south"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_bus3"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>

  <!-- Shunt Capacitor at South Bus for Voltage Support -->
  <cim:LinearShuntCompensator rdf:ID="_shunt_south">
    <cim:IdentifiedObject.name>SOUTH_CAP_BANK_50MVAR</cim:IdentifiedObject.name>
    <cim:LinearShuntCompensator.bPerSection>0.0003</cim:LinearShuntCompensator.bPerSection>
    <cim:LinearShuntCompensator.sections>1</cim:LinearShuntCompensator.sections>
  </cim:LinearShuntCompensator>

  <cim:Terminal rdf:ID="_term_shunt_south">
    <cim:IdentifiedObject.name>ShuntSouth_T1</cim:IdentifiedObject.name>
    <cim:Terminal.ConductingEquipment rdf:resource="#_shunt_south"/>
    <cim:Terminal.TopologicalNode rdf:resource="#_node_bus3"/>
    <cim:Terminal.sequenceNumber>1</cim:Terminal.sequenceNumber>
  </cim:Terminal>
</rdf:RDF>`;

export const CGMES_ENTSOE_CORRIDOR_SSH_RDF = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#">

  <!-- Operational dispatch hypothesis for peak hours -->
  <cim:SynchronousMachine rdf:about="#_gen_north">
    <cim:RotatingMachine.p>460.0</cim:RotatingMachine.p>
    <cim:RotatingMachine.q>60.0</cim:RotatingMachine.q>
  </cim:SynchronousMachine>

  <cim:SynchronousMachine rdf:about="#_gen_central">
    <cim:RotatingMachine.p>310.0</cim:RotatingMachine.p>
    <cim:RotatingMachine.q>40.0</cim:RotatingMachine.q>
  </cim:SynchronousMachine>

  <cim:EnergyConsumer rdf:about="#_load_central">
    <cim:EnergyConsumer.p>360.0</cim:EnergyConsumer.p>
    <cim:EnergyConsumer.q>110.0</cim:EnergyConsumer.q>
  </cim:EnergyConsumer>

  <cim:EnergyConsumer rdf:about="#_load_south">
    <cim:EnergyConsumer.p>390.0</cim:EnergyConsumer.p>
    <cim:EnergyConsumer.q>125.0</cim:EnergyConsumer.q>
  </cim:EnergyConsumer>
</rdf:RDF>`;

export interface CgmesBenchmarkMetrics {
  substationsCount: number;
  nodesCount: number;
  linesCount: number;
  generatorsCount: number;
  loadsCount: number;
  totalGenerationMw: number;
  totalLoadMw: number;
  powerFlowConverged: boolean;
  daeVarCount: number;
  daeEqCount: number;
  modelicaLines: number;
}

export function runCgmesBenchmark(
  eqRdf = CGMES_ENTSOE_CORRIDOR_EQ_RDF,
  sshRdf = CGMES_ENTSOE_CORRIDOR_SSH_RDF,
): CgmesBenchmarkMetrics {
  // 1. Ingest multi-profile CGMES CIM/XML RDF (EQ + SSH)
  const model: CgmesModel = parseCgmesFiles([eqRdf, sshRdf]);

  assert.equal(model.substations.size, 3, "Expected 3 substations (North, Central, South)");
  assert.equal(model.nodes.size, 3, "Expected 3 topological nodes (400 kV)");
  assert.equal(model.lines.size, 3, "Expected 3 transmission line segments");
  assert.equal(model.generators.size, 2, "Expected 2 synchronous machines");
  assert.equal(model.loads.size, 2, "Expected 2 energy consumers");

  // Verify SSH dispatch overrides
  const genNorth = model.generators.get("_gen_north");
  assert.ok(genNorth);
  assert.equal(genNorth.pMw, 460.0, "SSH must override North hydro dispatch to 460 MW");

  const loadSouth = model.loads.get("_load_south");
  assert.ok(loadSouth);
  assert.equal(loadSouth.pMw, 390.0, "SSH must override South load to 390 MW");

  // 2. Topology processor: verify single connected electrical island
  const topo = processTopology(model);
  assert.equal(topo.islandCount, 1, "Expected single synchronized electrical island");
  assert.equal(topo.terminalToNode.size, model.terminals.size, "All terminals must be associated with nodes");

  // 3. Pre-flight CGMES static linting
  const diags = lintCgmesModel(model);
  assert.equal(diags.length, 0, "Benchmark corridor must pass all CGMES static lint checks");

  // 4. Project to PSS/E and solve AC Power Flow
  const { psseCase } = cgmesToPsse(model);
  assert.equal(psseCase.buses.size, 3);
  assert.equal(psseCase.branches.length, 3);
  assert.equal(psseCase.generators.length, 2);
  assert.equal(psseCase.loads.length, 2);

  const pf = solvePowerFlow(psseCase, { algorithm: "nr", maxIterations: 20 });
  assert.ok(pf.converged, "AC Newton-Raphson power flow must converge on CGMES case");

  // 5. Lower to DAE arena
  const dae = lowerPsseToDae(psseCase);
  assert.ok(dae.variables().length >= 10, "Expected >= 10 variables in DAE arena");
  assert.ok(dae.equations().length >= 6, "Expected >= 6 power balance equations in DAE arena");

  // 6. Project to OpenIPSL Modelica
  const moCode = cgmesToModelica(model, {
    packageName: "ENTSOE_TransmissionCorridor",
    modelName: "ThreeBus400kVIntertie",
  });
  assert.ok(moCode.includes("package ENTSOE_TransmissionCorridor"));
  assert.ok(moCode.includes("model ThreeBus400kVIntertie"));
  assert.ok(moCode.includes("OpenIPSL.Electrical.Branches.Line"));
  const moLines = moCode.split("\n").length;

  const totalGen = Array.from(model.generators.values()).reduce((sum, g) => sum + g.pMw, 0);
  const totalLoad = Array.from(model.loads.values()).reduce((sum, l) => sum + l.pMw, 0);

  return {
    substationsCount: model.substations.size,
    nodesCount: model.nodes.size,
    linesCount: model.lines.size,
    generatorsCount: model.generators.size,
    loadsCount: model.loads.size,
    totalGenerationMw: totalGen,
    totalLoadMw: totalLoad,
    powerFlowConverged: pf.converged,
    daeVarCount: dae.variables().length,
    daeEqCount: dae.equations().length,
    modelicaLines: moLines,
  };
}
