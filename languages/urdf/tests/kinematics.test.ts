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

  it("should satisfy RNEA vs ABA dynamics consistency (forward and inverse equivalence)", () => {
    const robot = parseUrdf(ROBOT_DECK);
    const q = new Map([
      ["joint_1", 0.3],
      ["joint_2", -0.5],
    ]);
    const qd = new Map([
      ["joint_1", 1.2],
      ["joint_2", -0.8],
    ]);
    const qdd = new Map([
      ["joint_1", 2.5],
      ["joint_2", -1.5],
    ]);

    // Compute inverse dynamics torques using RNEA
    const rnea = computeInverseDynamicsRnea(robot, q, qd, qdd, 9.80665);

    // Feed computed torques into ABA forward dynamics
    const aba = computeForwardDynamicsAba(robot, q, qd, rnea.jointTorques, 9.80665);

    const qdd1_recovered = aba.jointAccelerations.get("joint_1")!;
    const qdd2_recovered = aba.jointAccelerations.get("joint_2")!;

    assert.ok(Math.abs(qdd1_recovered - 2.5) < 1e-3, `Expected joint_1 qdd ~ 2.5, got ${qdd1_recovered}`);
    assert.ok(Math.abs(qdd2_recovered - -1.5) < 1e-3, `Expected joint_2 qdd ~ -1.5, got ${qdd2_recovered}`);
  });

  it("should account for joint.origin.rpy rotation, inertial COM offset, and off-diagonal inertia products in RNEA and ABA", () => {
    const rpyComUrdf = `<?xml version="1.0"?>
<robot name="rpy_com_pendulum">
  <link name="base_link">
    <inertial><mass value="10.0"/><inertia ixx="1" iyy="1" izz="1"/></inertial>
  </link>
  <link name="arm_link">
    <inertial>
      <origin xyz="0.5 0 0" rpy="0 0 0"/>
      <mass value="2.0"/>
      <inertia ixx="0.05" iyy="0.08" izz="0.10" ixy="0.005" ixz="0.002" iyz="0.001"/>
    </inertial>
  </link>
  <joint name="shoulder" type="revolute">
    <parent link="base_link"/><child link="arm_link"/>
    <origin xyz="0 0 1.0" rpy="1.5707963267948966 0 0"/>
    <axis xyz="0 0 1"/>
  </joint>
</robot>`;
    const robot = parseUrdf(rpyComUrdf);
    const q = new Map([["shoulder", 0.2]]);
    const qd = new Map([["shoulder", 0.7]]);
    const qdd = new Map([["shoulder", 1.4]]);

    const rnea = computeInverseDynamicsRnea(robot, q, qd, qdd, 9.80665);
    const tauShoulder = rnea.jointTorques.get("shoulder")!;
    // With 90 deg roll RPY and 0.5m COM offset, gravity and parallel-axis inertia produce significant torque (> 5 N*m)
    assert.ok(Math.abs(tauShoulder) > 5.0, `Expected gravity + inertia torque > 5 N*m, got ${tauShoulder}`);

    const aba = computeForwardDynamicsAba(robot, q, qd, rnea.jointTorques, 9.80665);
    const qddRecovered = aba.jointAccelerations.get("shoulder")!;
    assert.ok(
      Math.abs(qddRecovered - 1.4) < 1e-5,
      `Expected RNEA-ABA equivalence with RPY + COM offset (1.4 vs ${qddRecovered})`,
    );
  });
});
