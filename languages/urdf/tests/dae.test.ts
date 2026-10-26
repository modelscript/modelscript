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

    // Check variables: j1.q, j1.qd, j1.tau, base.x, link1.x
    assert.ok(dae.varCount >= 8);
  });
});
