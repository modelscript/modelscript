// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildRobotAnimationBindings, parseObjMesh, parseStlMesh } from "@modelscript/cad";
import { ActivationKind, DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateROM,
  importONNXToArenaNeuralBlock,
  importONNXToROM,
  lowerSampledPolicyToDae,
  SampledPolicyController,
  type OnnxGraphExport,
} from "../src/surrogates/index.js";

function makeSyntheticRlPolicyOnnx(op: "Elu" | "SiLU"): OnnxGraphExport {
  const nodes: OnnxGraphExport["graph"]["nodes"] = [
    { opType: "Gemm", inputs: ["obs", "w1", "b1"], outputs: ["h1"], name: "fc1" },
    ...(op === "Elu"
      ? [{ opType: "Elu" as const, inputs: ["h1"], outputs: ["a1"], name: "act1" }]
      : [
          { opType: "Sigmoid" as const, inputs: ["h1"], outputs: ["s1"], name: "sig1" },
          { opType: "Mul" as const, inputs: ["h1", "s1"], outputs: ["a1"], name: "mul1" },
        ]),
    { opType: "Gemm", inputs: ["a1", "w2", "b2"], outputs: ["action"], name: "fc2" },
  ];

  return {
    modelFormat: "ONNX-v1.14",
    graph: {
      name: "WalkingPolicy",
      inputs: [{ name: "obs", dims: [1, 3] }],
      outputs: [{ name: "action", dims: [1, 2] }],
      initializers: [
        { name: "w1", dims: [2, 3], data: [1.0, 0.0, -0.5, 0.0, 1.0, 0.5] },
        { name: "b1", dims: [2], data: [0.0, -0.5] },
        { name: "w2", dims: [2, 2], data: [0.5, 0.0, 0.0, 0.5] },
        { name: "b2", dims: [2], data: [0.1, -0.1] },
      ],
      nodes,
    },
  };
}

describe("MicroDuck Polyglot RL Policy, Sampled Delay & 3D Mesh Integration", () => {
  it("should import ONNX RL actor graphs with Elu and Sigmoid+Mul (SiLU) activations", () => {
    const eluRom = importONNXToROM(makeSyntheticRlPolicyOnnx("Elu"));
    assert.equal(eluRom.weights.type, "mlp");
    assert.equal(eluRom.weights.layerActivations?.[0], "elu");

    const eluOut = evaluateROM(eluRom, [1.0, -1.0, 0.0]);
    // h1 = [1.0, -1.5] -> elu = [1.0, exp(-1.5)-1] -> out = [0.5*1 + 0.1, 0.5*(exp(-1.5)-1) - 0.1]
    assert.ok(Math.abs(eluOut[0]! - 0.6) < 1e-9);
    assert.ok(Math.abs(eluOut[1]! - (0.5 * (Math.exp(-1.5) - 1) - 0.1)) < 1e-9);

    const siluBlock = importONNXToArenaNeuralBlock(makeSyntheticRlPolicyOnnx("SiLU"), "WalkingPolicy");
    assert.equal(siluBlock.activation, ActivationKind.SiLU);
    assert.equal(siluBlock.inDim, 3);
    assert.equal(siluBlock.outDim, 2);
  });

  it("should execute 50 Hz Zero-Order Hold with 22.5 ms command delay", () => {
    const rom = importONNXToROM(makeSyntheticRlPolicyOnnx("Elu"));
    const ctrl = new SampledPolicyController(rom, {
      name: "WalkingPolicy",
      samplePeriod: 0.02, // 50 Hz
      commandDelay: 0.0225, // 22.5 ms
      actionScale: 0.5,
      actionOffset: [0.1, -0.2],
    });

    // Sample at t=0.0s: command is delayed by 22.5 ms, so at t=0.0s and t=0.01s it still holds initial offset
    const cmdAt0ms = ctrl.step(0.0, [1.0, 0.0, 0.0]);
    assert.deepEqual(cmdAt0ms, [0.1, -0.2]);

    const cmdAt10ms = ctrl.step(0.01, [0.0, 0.0, 0.0]);
    assert.deepEqual(cmdAt10ms, [0.1, -0.2]);

    // At t=0.025s, t - delay = 0.0025s >= 0.0 -> first policy sample from t=0.0 takes effect!
    const cmdAt25ms = ctrl.step(0.025, [0.0, 0.0, 0.0]);
    assert.notDeepEqual(cmdAt25ms, [0.1, -0.2]);

    // Lower into DAEBuilder
    const dae = new DAEBuilder(undefined, "PolicyTest");
    for (const v of ["obs_0", "obs_1", "obs_2"]) {
      dae.addVariable(v, 0, 0, 1, 0.0);
    }
    const block = importONNXToArenaNeuralBlock(makeSyntheticRlPolicyOnnx("Elu"), "WalkingPolicy");
    lowerSampledPolicyToDae(dae, block, {
      name: "WalkingPolicy",
      samplePeriod: 0.02,
      commandDelay: 0.0225,
      inputVarNames: ["obs_0", "obs_1", "obs_2"],
      outputVarNames: ["left_hip_pitch.q_target", "right_hip_pitch.q_target"],
      actionScale: 0.5,
      actionOffset: 0.0,
    });
    assert.notEqual(dae.getVarIdxByName("WalkingPolicy.samplePeriod"), -1);
    assert.notEqual(dae.getVarIdxByName("left_hip_pitch.q_target"), -1);
  });

  it("should parse STL/OBJ meshes and build 3D AnimationBindings with force & thermal overlays", () => {
    const asciiStl = `solid tri
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid tri`;
    const stl = parseStlMesh(asciiStl);
    assert.equal(stl.vertices.length, 9);
    assert.equal(stl.indices.length, 3);

    const obj = parseObjMesh("v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1\n");
    assert.equal(obj.vertices.length, 9);

    const bindings = buildRobotAnimationBindings({
      linkNames: ["trunk", "left_hip"],
      contactNames: ["left_sole_pt0"],
      servoJointNames: ["left_hip_pitch"],
    });
    assert.equal(bindings.length, 4);
    assert.equal(bindings[2]?.bindings[0]?.property, "vectorCoordinates");
    assert.equal(bindings[3]?.bindings[0]?.property, "color");
  });
});
