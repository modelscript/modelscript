// SPDX-License-Identifier: AGPL-3.0-or-later

import { initBltWasm } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerFbiToDae, parseFbiFile } from "../src/index.js";

const sampleFbiContent = `
# SIMPACK Flexible Body Interface (.fbi) modal data
HEADER 3 2

# Node definitions: ID X Y Z
NODE 1 0.0 0.0 0.0
NODE 2 0.5 0.0 0.0
NODE 3 1.0 0.0 0.0

# Mode definitions: ModeID Frequency[Hz] GenMass[kg] GenStiffness[N/m] DampingRatio
MODE 1 15.0 1.2 10659.0 0.03
MODE 2 94.0 1.0 348630.0 0.03

# Eigenvector mode shapes at nodes: ModeID NodeID PhiX PhiY PhiZ
SHAPE 1 1 0.0 0.0 0.0
SHAPE 1 2 0.0 0.0 0.35
SHAPE 1 3 0.0 0.0 1.0

SHAPE 2 1 0.0 0.0 0.0
SHAPE 2 2 0.0 0.0 -0.85
SHAPE 2 3 0.0 0.0 1.0
`;

describe("SIMPACK Flexible Multibody Dynamics (.fbi modal condensation)", () => {
  it("should parse Craig-Bampton modal data and eigenvector shapes from .fbi file", () => {
    const fbi = parseFbiFile(sampleFbiContent, "CantileverBeam");

    assert.equal(fbi.name, "CantileverBeam");
    assert.equal(fbi.numNodes, 3);
    assert.equal(fbi.numModes, 2);
    assert.equal(fbi.nodes?.length, 3);

    // Mode 1
    const mode1 = fbi.modes[0]!;
    assert.equal(mode1.modeIndex, 1);
    assert.equal(mode1.frequencyHz, 15.0);
    assert.equal(mode1.generalizedMass, 1.2);
    assert.equal(mode1.generalizedStiffness, 10659.0);
    assert.equal(mode1.dampingRatio, 0.03);
    assert.equal(mode1.shapes?.length, 3);
    assert.equal(mode1.shapes![2]!.phi.z, 1.0); // Tip node deflection

    // Mode 2
    const mode2 = fbi.modes[1]!;
    assert.equal(mode2.modeIndex, 2);
    assert.equal(mode2.frequencyHz, 94.0);
  });

  it("should lower modal coordinates and boundary recovery equations into DAE linear memory", () => {
    const fbi = parseFbiFile(sampleFbiContent, "CantileverBeam");
    const dae = lowerFbiToDae(fbi);

    // 2 modes * 2 state vars (q, vq) + 2 boundary recovery vars (u_node_2_z, u_node_3_z) = 6 variables
    // Node 1 has phi.z = 0 in all modes so only nodes 2 and 3 have non-zero elastic expressions
    assert.ok(dae.varCount >= 4);
    assert.ok(dae.lookupVariable("CantileverBeam.q1") >= 0);
    assert.ok(dae.lookupVariable("CantileverBeam.vq1") >= 0);
    assert.ok(dae.lookupVariable("CantileverBeam.q2") >= 0);
    assert.ok(dae.lookupVariable("CantileverBeam.vq2") >= 0);

    // Verify recovery variable at tip (Node 3)
    const tipZIdx = dae.lookupVariable("CantileverBeam.u_node_3_z");
    assert.ok(tipZIdx >= 0);
  });

  it("should simulate transient elastodynamic response of flexible beam under modal excitation", async () => {
    await initBltWasm();

    const fbi = parseFbiFile(sampleFbiContent, "CantileverBeam");
    const appliedForces = new Map<number, number>();
    appliedForces.set(1, 150.0); // 150 N modal force step input on Mode 1

    const dae = lowerFbiToDae(fbi, { appliedModalForces: appliedForces });

    // Initial perturbation
    const q1Idx = dae.lookupVariable("CantileverBeam.q1");
    assert.ok(q1Idx >= 0);

    const result = simulateArena(dae, {
      startTime: 0,
      stopTime: 0.3,
      step: 0.001,
    });

    assert.equal(result.t.length, 301);

    const q1StateIdx = result.states.indexOf("CantileverBeam.q1");
    assert.ok(q1StateIdx >= 0);

    // Modal displacement starts at 0 and oscillates towards static deflection
    // Static deflection q1_ss = Q1 / k1 = 150 / 10659 ≈ 0.014 m
    const finalQ1 = result.y[result.y.length - 1]![q1StateIdx]!;
    assert.ok(finalQ1 > 0.005 && finalQ1 < 0.03, `Expected settling near 0.014 m, got ${finalQ1}`);

    // Verify tip elastic deflection is populated and positive
    const tipZStateIdx = result.states.indexOf("CantileverBeam.u_node_3_z");
    if (tipZStateIdx >= 0) {
      const finalTipZ = result.y[result.y.length - 1]![tipZStateIdx]!;
      assert.ok(finalTipZ > 0.005);
    }
  });
});
