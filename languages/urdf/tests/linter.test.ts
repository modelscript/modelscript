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

  it("M7506, M7509, M7510 & M7512: detects massless links, negative mass, triangle inequality violations, and missing collision geometry", () => {
    const xml = `<?xml version="1.0"?>
<robot name="mass_and_geom">
  <link name="massless_link">
    <visual>
      <geometry><box size="1 1 1"/></geometry>
    </visual>
  </link>
  <link name="neg_mass_link">
    <inertial>
      <mass value="-2.5"/>
      <inertia ixx="1.0" ixy="0" ixz="0" iyy="1.0" iyz="0" izz="5.0"/>
    </inertial>
  </link>
  <joint name="j1" type="fixed">
    <parent link="massless_link"/>
    <child link="neg_mass_link"/>
  </joint>
</robot>`;
    const robot = parseUrdf(xml);
    const diags = lintUrdfRobot(robot);
    assert.ok(diags.some((d) => d.code === "M7506"), "Should emit M7506 for massless link");
    assert.ok(diags.some((d) => d.code === "M7509"), "Should emit M7509 for negative link mass");
    assert.ok(diags.some((d) => d.code === "M7510"), "Should emit M7510 for inertia triangle inequality violation");
    assert.ok(diags.some((d) => d.code === "M7512"), "Should emit M7512 for visual link without collision envelope");
  });

  it("M7508, M7511, M7513 & M7514: detects continuous joint limits, mimic joint cycles, unresolved child links, and duplicate joint names", () => {
    const xml = `<?xml version="1.0"?>
<robot name="joint_checks">
  <link name="base">
    <inertial>
      <mass value="1.0"/>
      <inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/>
    </inertial>
  </link>
  <link name="wheel">
    <inertial>
      <mass value="1.0"/>
      <inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/>
    </inertial>
  </link>
  <joint name="j_cont" type="continuous">
    <parent link="base"/>
    <child link="wheel"/>
    <limit lower="-1.0" upper="1.0" effort="10" velocity="5"/>
    <mimic joint="j_dup"/>
  </joint>
  <joint name="j_dup" type="revolute">
    <parent link="base"/>
    <child link="missing_child"/>
    <limit lower="-1.0" upper="1.0" effort="10" velocity="5"/>
  </joint>
  <joint name="j_dup" type="revolute">
    <parent link="base"/>
    <child link="missing_child"/>
    <limit lower="-1.0" upper="1.0" effort="10" velocity="5"/>
    <mimic joint="j_cont"/>
  </joint>
</robot>`;
    const robot = parseUrdf(xml);
    const diags = lintUrdfRobot(robot);
    assert.ok(
      diags.some((d) => d.code === "M7508" && d.message.includes("continuous")),
      "Should emit M7508 for continuous joint with limits",
    );
    assert.ok(diags.some((d) => d.code === "M7511"), "Should emit M7511 for mimic joint cycle");
    assert.ok(diags.some((d) => d.code === "M7513"), "Should emit M7513 for unresolved child link");
    assert.ok(diags.some((d) => d.code === "M7514"), "Should emit M7514 for duplicate joint name");
  });
});

