// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUrdf } from "../src/parser/index.js";

const TWO_LINK_ROBOT = `<?xml version="1.0"?>
<robot name="planar_2r">
  <link name="base_link">
    <inertial>
      <mass value="5.0"/>
      <origin xyz="0 0 0.1" rpy="0 0 0"/>
      <inertia ixx="0.05" ixy="0" ixz="0" iyy="0.05" iyz="0" izz="0.08"/>
    </inertial>
    <visual>
      <geometry>
        <cylinder length="0.2" radius="0.1"/>
      </geometry>
    </visual>
  </link>

  <link name="link_1">
    <inertial>
      <mass value="2.5"/>
      <origin xyz="0.25 0 0" rpy="0 0 0"/>
      <inertia ixx="0.01" ixy="0" ixz="0" iyy="0.05" iyz="0" izz="0.05"/>
    </inertial>
    <visual>
      <geometry>
        <box size="0.5 0.08 0.08"/>
      </geometry>
    </visual>
  </link>

  <link name="link_2">
    <inertial>
      <mass value="1.5"/>
      <origin xyz="0.2 0 0" rpy="0 0 0"/>
      <inertia ixx="0.005" ixy="0" ixz="0" iyy="0.03" iyz="0" izz="0.03"/>
    </inertial>
  </link>

  <joint name="joint_1" type="revolute">
    <parent link="base_link"/>
    <child link="link_1"/>
    <origin xyz="0 0 0.2" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14159" upper="3.14159" effort="50.0" velocity="2.0"/>
    <dynamics damping="0.1" friction="0.05"/>
  </joint>

  <joint name="joint_2" type="revolute">
    <parent link="link_1"/>
    <child link="link_2"/>
    <origin xyz="0.5 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-2.5" upper="2.5" effort="30.0" velocity="3.0"/>
    <dynamics damping="0.05" friction="0.02"/>
  </joint>
</robot>
`;

describe("URDF Parser (@modelscript/urdf)", () => {
  it("should parse robot name, links, and joints correctly", () => {
    const robot = parseUrdf(TWO_LINK_ROBOT);
    assert.equal(robot.name, "planar_2r");
    assert.equal(robot.links.size, 3);
    assert.equal(robot.joints.size, 2);

    const base = robot.links.get("base_link");
    assert.ok(base);
    assert.equal(base.inertial?.mass, 5.0);
    assert.equal(base.visuals.length, 1);
    assert.equal(base.visuals[0]?.geometry.type, "cylinder");

    const j1 = robot.joints.get("joint_1");
    assert.ok(j1);
    assert.equal(j1.type, "revolute");
    assert.equal(j1.parentLink, "base_link");
    assert.equal(j1.childLink, "link_1");
    assert.equal(j1.axis.z, 1);
    assert.equal(j1.limits?.effort, 50.0);
    assert.equal(j1.dynamics?.damping, 0.1);
  });

  it("should expand Xacro properties and macros", () => {
    const XACRO_ROBOT = `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="xacro_bot">
  <xacro:property name="arm_mass" value="4.2"/>
  <link name="base_link">
    <inertial>
      <mass value="\${arm_mass}"/>
      <inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/>
    </inertial>
  </link>
</robot>`;
    const robot = parseUrdf(XACRO_ROBOT);
    assert.equal(robot.name, "xacro_bot");
    const base = robot.links.get("base_link");
    assert.ok(base);
    assert.equal(base.inertial?.mass, 4.2);
  });
});
