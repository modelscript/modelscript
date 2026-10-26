// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerSimpackToDae, type SimpackModel } from "../src/index.js";

describe("SIMPACK Multibody Dynamics — Baumgarte Constraint Stabilization", () => {
  it("should formulate Baumgarte stabilizing joint penalty forces and residual equations", () => {
    const model: SimpackModel = {
      name: "StabilizedPendulum",
      bodies: new Map([
        [
          "PendulumArm",
          {
            id: "PendulumArm",
            name: "PendulumArm",
            mass: 5.0,
            inertia: { ixx: 0.1, iyy: 0.1, izz: 0.1 },
            markers: ["PinPoint"],
          },
        ],
      ]),
      markers: new Map([
        [
          "PinPoint",
          {
            id: "PinPoint",
            bodyId: "PendulumArm",
            position: { x: 0.0, y: 0.0, z: 0.5 },
            rotation: { alpha: 0, beta: 0, gamma: 0 },
          },
        ],
        [
          "GroundOrigin",
          {
            id: "GroundOrigin",
            bodyId: "$inertial",
            position: { x: 0.0, y: 0.0, z: 0.0 },
            rotation: { alpha: 0, beta: 0, gamma: 0 },
          },
        ],
      ]),
      joints: new Map([
        [
          "PivotJoint",
          {
            id: "PivotJoint",
            name: "PivotJoint",
            type: "revolute",
            fromMarker: "GroundOrigin",
            toMarker: "PinPoint",
          },
        ],
      ]),
      forces: new Map(),
    };

    // 1. Lower with default algebraic constraints
    const daeClassic = lowerSimpackToDae(model, undefined, { stabilization: "algebraic" });
    assert.ok(daeClassic.eqCount > 0);

    // 2. Lower with Baumgarte stabilization (omega_n = 40 rad/s)
    const daeBaumgarte = lowerSimpackToDae(model, undefined, {
      stabilization: "baumgarte",
      baumgarteOmega: 40.0,
    });

    assert.ok(daeBaumgarte.eqCount > 0);

    // Verify residual variables exist in linear memory DAE arena
    const resX = daeBaumgarte.lookupVariable("PivotJoint.residual_x");
    const resY = daeBaumgarte.lookupVariable("PivotJoint.residual_y");
    const resZ = daeBaumgarte.lookupVariable("PivotJoint.residual_z");

    assert.ok(resX >= 0, "PivotJoint.residual_x variable must be indexed in DAE");
    assert.ok(resY >= 0, "PivotJoint.residual_y variable must be indexed in DAE");
    assert.ok(resZ >= 0, "PivotJoint.residual_z variable must be indexed in DAE");

    // 1 body: 6 kinematics + 3 translational Newton + 3 rotational Euler = 12 equations
    // + 3 Baumgarte joint residual equations = 15 equations
    assert.ok(daeBaumgarte.eqCount >= 15, `Expected >= 15 equations, got ${daeBaumgarte.eqCount}`);
  });
});
