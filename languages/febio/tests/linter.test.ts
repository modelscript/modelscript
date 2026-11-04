// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintFebioDocument } from "../src/lints/index.js";
import { parseFebio } from "../src/parser/index.js";

describe("FEBio & SOFA Biomechanics Semantic Linter (M9401–M9410)", () => {
  it("emits M9401 on non-physical elastic or hyperelastic material constants", () => {
    const dsl = `
      FEBIO 4.0 title="BadMatModel"
      MATERIAL id=1 name="BadElastic" type="isotropic elastic" E=-500 v=0.55 density=-1.0
      MATERIAL id=2 name="BadMooney" type="Mooney-Rivlin" c1=0.2 c2=-0.5 k=-10
      NODE id=1 x=0 y=0 z=0
      NODESET name="FixSet" nodes=1
      BC id=BC1 node_set="FixSet" type="fix"
    `;
    const doc = parseFebio(dsl);
    const diags = lintFebioDocument(doc);
    const m9401 = diags.filter((d) => d.code === "M9401");
    assert(m9401.length >= 4);
  });

  it("emits M9402 on inverted tet4 or hex8 element with non-positive Jacobian determinant", () => {
    const dsl = `
      FEBIO 4.0 title="InvertedTetModel"
      MATERIAL id=1 name="Tissue" type="neo-Hookean" E=1000 v=0.45
      NODE id=1 x=0 y=0 z=0
      NODE id=2 x=1 y=0 z=0
      NODE id=3 x=0 y=1 z=0
      NODE id=4 x=0 y=0 z=-1
      ELEMENT id=1 type=tet4 mat=1 nodes=1,2,3,4
      NODESET name="FixSet" nodes=1,2,3
      BC id=BC1 node_set="FixSet" type="fix"
    `;
    const doc = parseFebio(dsl);
    const diags = lintFebioDocument(doc);
    assert(diags.some((d) => d.code === "M9402"));
  });

  it("emits M9403 on unresolved node ID, NodeSet, or Surface reference", () => {
    const dsl = `
      FEBIO 4.0 title="UnresolvedRefs"
      MATERIAL id=1 name="Tissue" type="neo-Hookean" E=1000 v=0.45
      NODE id=1 x=0 y=0 z=0
      ELEMENT id=1 type=tet4 mat=1 nodes=1,99,100,101
      BC id=BC1 node_set="MissingNodeSet" type="fix"
      LOAD id=L1 surface="MissingSurface" value=10.0
    `;
    const doc = parseFebio(dsl);
    const diags = lintFebioDocument(doc);
    const m9403 = diags.filter((d) => d.code === "M9403");
    assert(m9403.length >= 3);
  });

  it("emits M9404 when model has no fixed or prescribed displacement boundary conditions", () => {
    const dsl = `
      FEBIO 4.0 title="UnconstrainedTissue"
      MATERIAL id=1 name="Tissue" type="neo-Hookean" E=1000 v=0.45
      NODE id=1 x=0 y=0 z=0
      NODE id=2 x=1 y=0 z=0
      NODE id=3 x=0 y=1 z=0
      NODE id=4 x=0 y=0 z=1
      ELEMENT id=1 type=tet4 mat=1 nodes=1,2,3,4
    `;
    const doc = parseFebio(dsl);
    const diags = lintFebioDocument(doc);
    assert(diags.some((d) => d.code === "M9404"));
  });

  it("emits M9405 on invalid biphasic hydraulic permeability or solid volume fraction", () => {
    const dsl = `
      FEBIO 4.0 title="BadBiphasic"
      MATERIAL id=1 name="Cartilage" type="biphasic" E=500 v=0.3 perm=-0.002 phi0=1.2
      NODE id=1 x=0 y=0 z=0
      NODESET name="FixSet" nodes=1
      BC id=BC1 node_set="FixSet" type="fix"
    `;
    const doc = parseFebio(dsl);
    const diags = lintFebioDocument(doc);
    const m9405 = diags.filter((d) => d.code === "M9405");
    assert.strictEqual(m9405.length, 2);
  });

  it("emits M9406 on invalid <Control> time_steps or step_size", () => {
    const dsl = `
      FEBIO 4.0 title="BadStepper"
      CONTROL analysis=STATIC steps=0 dt=-0.05
      NODE id=1 x=0 y=0 z=0
      NODESET name="FixSet" nodes=1
      BC id=BC1 node_set="FixSet" type="fix"
    `;
    const doc = parseFebio(dsl);
    const diags = lintFebioDocument(doc);
    assert(diags.some((d) => d.code === "M9406"));
  });

  it("emits M9407 on unresolved material ID in SolidDomain or Element", () => {
    const dsl = `
      FEBIO 4.0 title="MissingMat"
      NODE id=1 x=0 y=0 z=0
      NODE id=2 x=1 y=0 z=0
      NODE id=3 x=0 y=1 z=0
      NODE id=4 x=0 y=0 z=1
      ELEMENT id=1 type=tet4 mat=99 nodes=1,2,3,4
      DOMAIN name="SolidDom" mat=88
      NODESET name="FixSet" nodes=1
      BC id=BC1 node_set="FixSet" type="fix"
    `;
    const doc = parseFebio(dsl);
    const diags = lintFebioDocument(doc);
    const m9407 = diags.filter((d) => d.code === "M9407");
    assert.strictEqual(m9407.length, 2);
  });

  it("emits M9408 on invalid contact penalty factor or empty contact surface", () => {
    const dsl = `
      FEBIO 4.0 title="BadContact"
      NODE id=1 x=0 y=0 z=0
      NODE id=2 x=1 y=0 z=0
      NODE id=3 x=0 y=1 z=0
      SURFACE name="EmptySurf"
      SURFACE name="ValidSurf" nodes=1,2,3
      NODESET name="FixSet" nodes=1
      BC id=BC1 node_set="FixSet" type="fix"
      CONTACT id=C1 name="CartilageContact" primary="EmptySurf" secondary="ValidSurf" penalty=-10.0
    `;
    const doc = parseFebio(dsl);
    const diags = lintFebioDocument(doc);
    const m9408 = diags.filter((d) => d.code === "M9408");
    assert(m9408.length >= 2);
  });

  it("emits M9409 when SOFA <Node> has TetrahedronFEMForceField without <MechanicalObject>", () => {
    const scn = `<Node name="Root">
  <Node name="BrokenOrganNode">
    <TetrahedronFEMForceField name="FEM" youngModulus="2000" poissonRatio="0.4" />
    <FixedConstraint name="Fix" indices="0" />
  </Node>
</Node>`;
    const doc = parseFebio(scn);
    const diags = lintFebioDocument(doc);
    assert(diags.some((d) => d.code === "M9409"));
  });

  it("emits M9410 on duplicate node, element, or material IDs", () => {
    const dsl = `
      FEBIO 4.0 title="Duplicates"
      MATERIAL id=1 name="MatA" E=1000 v=0.3
      MATERIAL id=1 name="MatB" E=2000 v=0.3
      NODE id=1 x=0 y=0 z=0
      NODE id=1 x=1 y=0 z=0
      NODE id=2 x=0 y=1 z=0
      NODE id=3 x=0 y=0 z=1
      ELEMENT id=10 type=tet4 mat=1 nodes=1,2,3,1
      ELEMENT id=10 type=tet4 mat=1 nodes=1,2,3,1
      NODESET name="FixSet" nodes=1
      BC id=BC1 node_set="FixSet" type="fix"
    `;
    const doc = parseFebio(dsl);
    const diags = lintFebioDocument(doc);
    const m9410 = diags.filter((d) => d.code === "M9410");
    assert.strictEqual(m9410.length, 3);
  });
});
