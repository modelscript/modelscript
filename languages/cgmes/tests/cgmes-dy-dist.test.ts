// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { cgmesToOpenDss, cgmesToPsse, parseCgmesRdf } from "../src/index.js";

test("CGMES parser captures IEC 61970-457 DY and IEC 61968 ACLineSegmentPhase records", () => {
  const rdf = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/CIM100#">
  <cim:TopologicalNode rdf:ID="_TN1">
    <cim:IdentifiedObject.name>BUS_1</cim:IdentifiedObject.name>
  </cim:TopologicalNode>
  <cim:TopologicalNode rdf:ID="_TN2">
    <cim:IdentifiedObject.name>BUS_2</cim:IdentifiedObject.name>
  </cim:TopologicalNode>
  <cim:ACLineSegment rdf:ID="_LINE_1">
    <cim:IdentifiedObject.name>L1</cim:IdentifiedObject.name>
    <cim:ACLineSegment.r>0.02</cim:ACLineSegment.r>
    <cim:ACLineSegment.x>0.15</cim:ACLineSegment.x>
    <cim:Conductor.length>12</cim:Conductor.length>
  </cim:ACLineSegment>
  <cim:Terminal rdf:ID="_T1">
    <cim:Terminal.ConductingEquipment rdf:resource="#_LINE_1" />
    <cim:Terminal.TopologicalNode rdf:resource="#_TN1" />
  </cim:Terminal>
  <cim:Terminal rdf:ID="_T2">
    <cim:Terminal.ConductingEquipment rdf:resource="#_LINE_1" />
    <cim:Terminal.TopologicalNode rdf:resource="#_TN2" />
  </cim:Terminal>
  <cim:SynchronousMachineTimeConstantReactance rdf:ID="_SM_DY_1">
    <cim:IdentifiedObject.name>GEN1_DY</cim:IdentifiedObject.name>
    <cim:RotatingMachineDynamics.SynchronousMachine rdf:resource="#_GEN1" />
    <cim:RotatingMachineDynamics.inertia>4.5</cim:RotatingMachineDynamics.inertia>
    <cim:SynchronousMachineTimeConstantReactance.xDirectTrans>0.25</cim:SynchronousMachineTimeConstantReactance.xDirectTrans>
  </cim:SynchronousMachineTimeConstantReactance>
  <cim:ACLineSegmentPhase rdf:ID="_LINE_PH_A">
    <cim:IdentifiedObject.name>L1_A</cim:IdentifiedObject.name>
    <cim:ACLineSegmentPhase.ACLineSegment rdf:resource="#_LINE_1" />
    <cim:ACLineSegmentPhase.phase>A</cim:ACLineSegmentPhase.phase>
  </cim:ACLineSegmentPhase>
</rdf:RDF>`;

  const model = parseCgmesRdf(rdf);
  assert.strictEqual(model.dynamicModels?.size, 1);
  const dy = model.dynamicModels?.get("_SM_DY_1");
  assert.strictEqual(dy?.profileClass, "SynchronousMachineTimeConstantReactance");
  assert.strictEqual(dy?.targetEquipmentId, "_GEN1");
  assert.strictEqual(dy?.parameters["inertia"], 4.5);
  assert.strictEqual(dy?.parameters["xDirectTrans"], 0.25);

  assert.strictEqual(model.linePhases?.size, 1);
  const ph = model.linePhases?.get("_LINE_PH_A");
  assert.strictEqual(ph?.acLineSegmentId, "_LINE_1");
  assert.strictEqual(ph?.phase, "A");

  const { psseCase } = cgmesToPsse(model);
  assert.ok(psseCase.dyr);
  assert.strictEqual(psseCase.dyr.records.length, 1);
  assert.strictEqual(psseCase.dyr.records[0]?.model, "GENROU");

  const dss = cgmesToOpenDss(model);
  assert.ok(dss.includes("New Line.L1 phases=1"));
});
