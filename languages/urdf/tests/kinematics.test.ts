// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildKinematicTree, computeForwardDynamicsAba, computeInverseDynamicsRnea } from "../src/kinematics/index.js";
import { parseUrdf } from "../src/parser/index.js";

const ROBOT_DECK = `<?xml version="1.0"?>
<robot name="pendulum_2link">
  <link name="base_link">
    <inertial><mass value="10.0"/><inertia ixx="1" iyy="1" izz="1"/></inertial>
  </link>
  <link name="link_1">
    <inertial><mass value="2.0"/><inertia ixx="0.05" iyy="0.05" izz="0.05"/></inertial>
  </link>
  <link name="link_2">
    <inertial><mass value="1.0"/><inertia ixx="0.02" iyy="0.02" izz="0.02"/></inertial>
  </link>
  <joint name="joint_1" type="revolute">
    <parent link="base_link"/><child link="link_1"/>
    <axis xyz="0 0 1"/>
  </joint>
  <joint name="joint_2" type="revolute">
    <parent link="link_1"/><child link="link_2"/>
    <axis xyz="0 0 1"/>
  </joint>
</robot>`;

describe("URDF Kinematics & Featherstone Algorithms (@modelscript/urdf)", () => {
  it("should build topological kinematic tree starting from root base_link", () => {
    const robot = parseUrdf(ROBOT_DECK);
    const tree = buildKinematicTree(robot);
    assert.equal(tree.length, 3);
    assert.equal(tree[0]?.name, "base_link");
    assert.equal(tree[0]?.parentName, null);
    assert.equal(tree[1]?.name, "link_1");
    assert.equal(tree[1]?.parentName, "base_link");
    assert.equal(tree[2]?.name, "link_2");
    assert.equal(tree[2]?.parentName, "link_1");
  });

  it("should compute inverse dynamics using RNEA", () => {
    const robot = parseUrdf(ROBOT_DECK);
    const q = new Map([
      ["joint_1", 0.0],
      ["joint_2", 0.0],
    ]);
    const qd = new Map([
      ["joint_1", 1.0],
      ["joint_2", 0.5],
    ]);
    const qdd = new Map([
      ["joint_1", 0.0],
      ["joint_2", 0.0],
    ]);

    const rnea = computeInverseDynamicsRnea(robot, q, qd, qdd);
    assert.ok(rnea.jointTorques.has("joint_1"));
    assert.ok(rnea.jointTorques.has("joint_2"));
  });

  it("should compute forward dynamics using ABA", () => {
    const robot = parseUrdf(ROBOT_DECK);
    const q = new Map([
      ["joint_1", 0.0],
      ["joint_2", 0.0],
    ]);
    const qd = new Map([
      ["joint_1", 0.0],
      ["joint_2", 0.0],
    ]);
    const tau = new Map([
      ["joint_1", 5.0],
      ["joint_2", 2.0],
    ]);

    const aba = computeForwardDynamicsAba(robot, q, qd, tau);
    assert.ok(aba.jointAccelerations.has("joint_1"));
    assert.ok(aba.jointAccelerations.has("joint_2"));
    const a1 = aba.jointAccelerations.get("joint_1")!;
    assert.ok(a1 > 0, `Expected positive joint_1 acceleration under positive torque, got ${a1}`);
  });
});
