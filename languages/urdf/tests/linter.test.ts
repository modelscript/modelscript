// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintUrdfRobot } from "../src/lints/index.js";
import { parseUrdf } from "../src/parser/index.js";

describe("URDF Linter Rules (@modelscript/urdf)", () => {
  it("M7501: should detect dangling parent link", () => {
    const xml = `<?xml version="1.0"?>
<robot name="dangling">
  <link name="link_1"/>
  <joint name="j1" type="revolute">
    <parent link="non_existent"/>
    <child link="link_1"/>
  </joint>
</robot>`;
    const robot = parseUrdf(xml);
    const diags = lintUrdfRobot(robot);
    const m7501 = diags.find((d) => d.code === "M7501");
    assert.ok(m7501, "Should flag missing parent link");
  });

  it("M7508: should detect inverted joint limits (lower > upper)", () => {
    const xml = `<?xml version="1.0"?>
<robot name="inverted_limits">
  <link name="base"/>
  <link name="arm"/>
  <joint name="j1" type="revolute">
    <parent link="base"/>
    <child link="arm"/>
    <limit lower="2.0" upper="1.0" effort="10" velocity="1"/>
  </joint>
</robot>`;
    const robot = parseUrdf(xml);
    const diags = lintUrdfRobot(robot);
    const m7508 = diags.find((d) => d.code === "M7508");
    assert.ok(m7508, "Should flag inverted joint limits");
  });

  it("M7507: should detect zero joint axis vector", () => {
    const xml = `<?xml version="1.0"?>
<robot name="zero_axis">
  <link name="base"/>
  <link name="arm"/>
  <joint name="j1" type="revolute">
    <parent link="base"/>
    <child link="arm"/>
    <axis xyz="0 0 0"/>
    <limit lower="-1" upper="1" effort="10" velocity="1"/>
  </joint>
</robot>`;
    const robot = parseUrdf(xml);
    const diags = lintUrdfRobot(robot);
    const m7507 = diags.find((d) => d.code === "M7507");
    assert.ok(m7507, "Should flag zero joint axis");
  });
});
