// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerUrdfToDae } from "../src/dae/index.js";
import { parseUrdf } from "../src/parser/index.js";

const ROBOT_XML = `<?xml version="1.0"?>
<robot name="arm">
  <link name="base"/>
  <link name="link1"/>
  <joint name="j1" type="revolute">
    <parent link="base"/>
    <child link="link1"/>
    <origin xyz="0 0 0.5"/>
    <axis xyz="0 0 1"/>
  </joint>
</robot>`;

describe("URDF DAE Lowering (@modelscript/urdf)", () => {
  it("should lower joints, generalized states, and link poses into DAEBuilder linear memory", () => {
    const robot = parseUrdf(ROBOT_XML);
    const dae = lowerUrdfToDae(robot);

    assert.ok(dae.varCount > 0, "Should define variables");
    assert.ok(dae.eqCount > 0, "Should define equations");

    // Check variables: j1.q, j1.qd, j1.tau, base.x, base.y, base.z, link1.x, link1.y, link1.z (total 9 vars)
    assert.ok(dae.varCount >= 9);

    // Each link has 3 kinematic equations (x, y, z) -> 2 links * 3 = 6 equations
    // j1 has 1 kinematic der(q)=qd and 1 dynamics equation M*der(qd) + D*qd + G = tau -> 2 equations
    // Total equations = 8
    assert.equal(dae.eqCount, 8);
  });

  it("should support non-linear gravity and linearized gravity option", () => {
    const robot = parseUrdf(ROBOT_XML);
    const daeNonlinear = lowerUrdfToDae(robot, undefined, { linearizeGravity: false });
    const daeLinear = lowerUrdfToDae(robot, undefined, { linearizeGravity: true });

    assert.equal(daeNonlinear.eqCount, 8);
    assert.equal(daeLinear.eqCount, 8);
  });
});
