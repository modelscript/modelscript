// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { febioLanguage, resolveFebioInScope } from "../src/index.js";

describe("FEBio & SOFA Multi-File Workspace Index", () => {
  it("indexes materials, node sets, boundary conditions, and SOFA nodes across files", () => {
    const ws = new UnifiedWorkspace(febioLanguage);
    const febUri = "file:///heart.feb";
    const scnUri = "file:///liver.scn";

    ws.setDocument(
      febUri,
      `
      FEBIO 4.0 title="Heart"
      MATERIAL id=1 name="Myocardium" type="Mooney-Rivlin" c1=2.0 c2=0.5 k=50.0
      NODE id=1 x=0 y=0 z=0
      NODESET name="BaseSet" nodes=1
      BC id=BC1 name="FixBase" node_set="BaseSet" type="fix"
    `,
    );

    ws.setDocument(
      scnUri,
      `<Node name="LiverScene">
  <Node name="Parenchyma">
    <MechanicalObject name="DOFs" position="0 0 0 1 0 0 0 1 0 0 0 1" />
    <TetrahedronFEMForceField name="LiverFEM" youngModulus="2500" poissonRatio="0.45" />
    <FixedConstraint name="Fix" indices="0" />
  </Node>
</Node>`,
    );

    assert.strictEqual(ws.fileCount, 2);
    assert(ws.hasDocument(febUri));
    assert(ws.hasDocument(scnUri));

    const foundMat = ws.findSymbolsByName("Myocardium");
    assert.strictEqual(foundMat.length, 1);
    assert.strictEqual(foundMat[0]?.ruleName, "febio_material");

    const foundNode = ws.findSymbolsByName("Parenchyma");
    assert.strictEqual(foundNode.length, 1);
    const parentId = foundNode[0]!.id;

    const childFf = resolveFebioInScope(ws, "LiverFEM", parentId, scnUri);
    assert(childFf !== null);
    assert.strictEqual(childFf.ruleName, "sofa_forcefield");

    ws.clear();
    assert.strictEqual(ws.fileCount, 0);
  });
});
