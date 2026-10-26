// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AnimationController } from "../src/animation-controller.js";

describe("CAD & Multibody Real-Time Dynamic Modal Mesh Morphing", () => {
  it("should calculate linear modal displacements u_j = sum(Phi_{j,i} * q_i(t))", () => {
    const ctrl = new AnimationController();

    // 4 FEA nodes with 3 DOF each (12 floats per mode)
    const mode1 = new Float32Array([
      0.0,
      0.0,
      0.0, // Node 0: clamped root (0 displacement)
      0.0,
      0.0,
      0.1, // Node 1: tip deflection +0.1m
      0.0,
      0.0,
      0.4, // Node 2: tip deflection +0.4m
      0.0,
      0.0,
      1.0, // Node 3: tip deflection +1.0m
    ]);

    const mode2 = new Float32Array([
      0.0,
      0.0,
      0.0, // Node 0
      0.0,
      0.05,
      0.0, // Node 1: lateral bending +0.05m
      0.0,
      -0.02,
      0.0, // Node 2
      0.0,
      0.3,
      0.0, // Node 3: lateral bending +0.3m
    ]);

    ctrl.setBindings([
      {
        componentName: "cantilever",
        bindings: [
          { property: "position", index: 0, variable: "cantilever.x" },
          { property: "position", index: 1, variable: "cantilever.y" },
          { property: "position", index: 2, variable: "cantilever.z" },
        ],
        deformation: {
          mode: "modal",
          modalVariables: ["cantilever.q1", "cantilever.q2"],
          modeShapes: [mode1, mode2],
        },
      },
    ]);

    // Live streaming mode with modal coordinates: q1 = 0.05, q2 = 0.20
    ctrl.pushLiveBatch(
      new Map([
        ["cantilever.x", 0.0],
        ["cantilever.y", 0.0],
        ["cantilever.z", 0.0],
        ["cantilever.q1", 0.05],
        ["cantilever.q2", 0.2],
      ]),
      0.15,
    );
    ctrl.goLive();

    const disp = ctrl.getModalDisplacements("cantilever", 4);
    assert.ok(disp);
    assert.equal(disp.length, 12);

    // Node 0: clamped root (0, 0, 0)
    assert.equal(disp[0], 0.0);
    assert.equal(disp[1], 0.0);
    assert.equal(disp[2], 0.0);

    // Node 1:
    // dy = mode2[4] * q2 = 0.05 * 0.20 = 0.010
    // dz = mode1[5] * q1 = 0.1 * 0.05 = 0.005
    assert.equal(disp[3], 0.0);
    assert.ok(Math.abs(disp[4]! - 0.01) < 1e-6);
    assert.ok(Math.abs(disp[5]! - 0.005) < 1e-6);

    // Node 3 (tip):
    // dy = mode2[10] * q2 = 0.3 * 0.20 = 0.060
    // dz = mode1[11] * q1 = 1.0 * 0.05 = 0.050
    assert.equal(disp[9], 0.0);
    assert.ok(Math.abs(disp[10]! - 0.06) < 1e-6);
    assert.ok(Math.abs(disp[11]! - 0.05) < 1e-6);
  });

  it("should map mesh vertices to FEA nodes using nodeMap", () => {
    const ctrl = new AnimationController();

    const mode1 = new Float32Array([
      0.0,
      0.0,
      0.0, // Node 0
      0.0,
      0.0,
      0.5, // Node 1
    ]);

    // Mesh has 3 vertices: vertex 0 -> Node 0, vertex 1 -> Node 1, vertex 2 -> Node 1
    const nodeMap = new Uint32Array([0, 1, 1]);

    ctrl.setBindings([
      {
        componentName: "flex_link",
        bindings: [],
        deformation: {
          mode: "modal",
          modalVariables: ["q1"],
          modeShapes: [mode1],
          nodeMap,
        },
      },
    ]);

    ctrl.pushLiveBatch(new Map([["q1", 0.1]]), 0.0);
    ctrl.goLive();

    const disp = ctrl.getModalDisplacements("flex_link", 3);
    assert.ok(disp);
    assert.equal(disp.length, 9); // 3 vertices * 3

    // Vertex 0 -> Node 0 (0, 0, 0)
    assert.equal(disp[2], 0.0);

    // Vertex 1 -> Node 1 (dz = 0.5 * 0.1 = 0.05)
    assert.ok(Math.abs(disp[5]! - 0.05) < 1e-6);

    // Vertex 2 -> Node 1 (dz = 0.5 * 0.1 = 0.05)
    assert.ok(Math.abs(disp[8]! - 0.05) < 1e-6);
  });

  it("should return null when modal deformation is not configured", () => {
    const ctrl = new AnimationController();
    assert.equal(ctrl.getModalDisplacements("unknown"), null);
  });
});
