// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseFebio } from "../src/parser/index.js";
import { lowerFebioToDae, solveHyperelasticMechanics } from "../src/solver/index.js";

describe("FEBio Hyperelastic / Mooney-Rivlin Mechanics Solver & DAE Lowering", () => {
  const sampleDsl = `
    FEBIO 4.0 title="UniaxialSoftTissue"
    MATERIAL id=1 name="ArterialWall" type="Mooney-Rivlin" c1=10.0 c2=2.0 k=500.0 perm=0.005 phi0=0.25
    NODE id=1 x=0.0 y=0.0 z=0.0
    NODE id=2 x=1.0 y=0.0 z=0.0
    NODE id=3 x=0.0 y=1.0 z=0.0
    NODE id=4 x=0.0 y=0.0 z=1.0
    ELEMENT id=1 type=tet4 mat=1 nodes=1,2,3,4
    NODESET name="Bottom" nodes=1,2,3
    NODESET name="Top" nodes=4
    BC id=BC1 node_set="Bottom" type="fix"
    BC id=BC2 node_set="Top" type="prescribed displacement" dofs=z value=0.25
  `;

  it("evaluates Mooney-Rivlin strain energy W, Cauchy stress σ, Darcy flux, and element volume", () => {
    const doc = parseFebio(sampleDsl);
    const res = solveHyperelasticMechanics(doc);

    // Volume of unit right tetrahedron = 1/6
    assert(Math.abs(res.totalVolume - 1.0 / 6.0) < 1e-9);
    assert.strictEqual(res.invertedElementCount, 0);

    const mat = res.materials[0]!;
    // Stretch lambda1 = 1 + 0.25 / 1.0 = 1.25
    assert(Math.abs(mat.principalStretches[0] - 1.25) < 1e-9);
    assert(mat.strainEnergyDensityW > 0);
    assert(mat.cauchyStress[0] > 0);
    assert(mat.vonMisesStress > 0);
    assert(mat.darcyFluidFlux !== undefined && mat.darcyFluidFlux > 0);

    // Node 4 is at z=1.0, prescribed uz = 0.25, nodes 1..3 are fixed (u = 0)
    const n1 = res.nodalDisplacements.find((n) => n.nodeId === "1")!;
    const n4 = res.nodalDisplacements.find((n) => n.nodeId === "4")!;
    assert.strictEqual(n1.magnitude, 0);
    assert(Math.abs(n4.uz - 0.25) < 1e-9);
  });

  it("lowers FEBio constitutive equations into linear-memory DAEBuilder arena", () => {
    const doc = parseFebio(sampleDsl);
    const arena = lowerFebioToDae(doc);
    assert(arena.getVarCount() >= 8);
    assert(arena.getEqCount() >= 8);
  });
});
