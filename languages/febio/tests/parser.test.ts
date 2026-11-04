// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseFebio } from "../src/parser/index.js";

describe("FEBio 4.0 (.feb) & SOFA (.scn) Parser", () => {
  it("parses a complete FEBio 4.0 <febio_spec> soft-tissue biomechanics XML model", () => {
    const febXml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<febio_spec version="4.0">
  <Module type="solid"/>
  <Control>
    <analysis>STATIC</analysis>
    <time_steps>20</time_steps>
    <step_size>0.05</step_size>
  </Control>
  <Material>
    <material id="1" name="Myocardium" type="Mooney-Rivlin">
      <c1>2.5</c1>
      <c2>0.5</c2>
      <k>100.0</k>
      <density>1.06</density>
    </material>
  </Material>
  <Mesh>
    <Nodes name="TissueNodes">
      <node id="1">0.0, 0.0, 0.0</node>
      <node id="2">1.0, 0.0, 0.0</node>
      <node id="3">0.0, 1.0, 0.0</node>
      <node id="4">0.0, 0.0, 1.0</node>
    </Nodes>
    <Elements type="tet4" name="VentricleDomain">
      <elem id="1">1, 2, 3, 4</elem>
    </Elements>
    <NodeSet name="BaseNodes">
      <node id="1"/>
      <node id="2"/>
      <node id="3"/>
    </NodeSet>
    <NodeSet name="ApexNodes">
      <node id="4"/>
    </NodeSet>
    <Surface name="EpicardiumSurface">
      <tri3 id="1">1, 2, 3</tri3>
    </Surface>
  </Mesh>
  <MeshDomains>
    <SolidDomain name="VentricleDomain" mat="1"/>
  </MeshDomains>
  <Boundary>
    <bc name="FixBase" type="zero displacement" node_set="BaseNodes">
      <x_dof>1</x_dof>
      <y_dof>1</y_dof>
      <z_dof>1</z_dof>
    </bc>
    <bc name="StretchApex" type="prescribed displacement" node_set="ApexNodes">
      <dof>z</dof>
      <value>0.2</value>
    </bc>
  </Boundary>
  <Loads>
    <surface_load name="BloodPressure" type="pressure" surface="EpicardiumSurface">
      <pressure>12.0</pressure>
    </surface_load>
  </Loads>
</febio_spec>`;

    const doc = parseFebio(febXml);
    assert.strictEqual(doc.format, "feb");
    assert.strictEqual(doc.version, "4.0");
    assert.strictEqual(doc.control?.timeSteps, 20);
    assert.strictEqual(doc.control?.stepSize, 0.05);
    assert.strictEqual(doc.materials.length, 1);
    assert.strictEqual(doc.materials[0]?.c1, 2.5);
    assert.strictEqual(doc.materials[0]?.c2, 0.5);
    assert.strictEqual(doc.nodes.length, 4);
    assert.strictEqual(doc.elements.length, 1);
    assert.strictEqual(doc.elements[0]?.materialId, "1");
    assert.strictEqual(doc.nodeSets.length, 2);
    assert.strictEqual(doc.surfaces.length, 1);
    assert.strictEqual(doc.boundaryConditions.length, 2);
    assert.strictEqual(doc.loads.length, 1);
  });

  it("parses SOFA Framework (.scn) surgical scene graphs", () => {
    const scnXml = `<Node name="LiverSurgicalScene" dt="0.005">
  <Node name="LiverFEM">
    <MechanicalObject name="dofs" position="0 0 0  1 0 0  0 1 0  0 0 1" />
    <TetrahedronSetTopologyContainer name="topo" tetrahedra="0 1 2 3" />
    <TetrahedronFEMForceField name="FEM" youngModulus="3000" poissonRatio="0.45" />
    <FixedConstraint name="FixedBase" indices="0 1 2" />
  </Node>
</Node>`;

    const doc = parseFebio(scnXml);
    assert.strictEqual(doc.format, "scn");
    assert.strictEqual(doc.sofaNodes.length, 2);
    assert.strictEqual(doc.nodes.length, 4);
    assert.strictEqual(doc.elements.length, 1);
    assert.strictEqual(doc.materials.length, 1);
    assert.strictEqual(doc.materials[0]?.E, 3000);
    assert.strictEqual(doc.boundaryConditions.length, 1);
  });
});
