// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildKinematicTree,
  computeForwardDynamicsAba,
  computeForwardKinematics,
  computeInverseDynamicsRnea,
} from "../src/kinematics/index.js";
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

  it("should compute forward kinematics 3D link positions and orientations", () => {
    const robot = parseUrdf(ROBOT_DECK);
    const posesZero = computeForwardKinematics(
      robot,
      new Map([
        ["joint_1", 0],
        ["joint_2", 0],
      ]),
    );
    assert.equal(posesZero.size, 3);
    assert.ok(posesZero.has("base_link"));
    assert.ok(posesZero.has("link_1"));
    assert.ok(posesZero.has("link_2"));

    const posesRotated = computeForwardKinematics(robot, new Map([["joint_1", Math.PI / 2]]));
    const link1 = posesRotated.get("link_1")!;
    assert.ok(link1.rotation[0] !== undefined);
  });

  it("should interpolate joint positions smoothly across time intervals and generate Cartesian toolpath traces", async () => {
    const { interpolateJointTrajectory, generateToolpathTrace } = await import("../src/kinematics/trajectory.js");
    const robot = parseUrdf(ROBOT_DECK);

    const traj = {
      times: [0.0, 1.0, 2.0],
      jointPositions: {
        joint_1: [0.0, 1.57, 3.14],
        joint_2: [0.0, -0.5, 0.0],
      },
    };

    // t = 0.5 (midpoint between 0 and 1)
    const qMid = interpolateJointTrajectory(traj, 0.5);
    const q1 = qMid.get("joint_1")!;
    assert.ok(q1 > 0.6 && q1 < 0.9, `Expected smoothed midpoint q1 ~ 0.785, got ${q1}`);

    // Toolpath trace
    const trace = generateToolpathTrace(robot, traj, "link_2", 20);
    assert.equal(trace.linkName, "link_2");
    assert.ok(trace.points.length >= 20);
    // Each point should have 3 coordinates [x, y, z]
    for (const pt of trace.points) {
      assert.equal(pt.length, 3);
      assert.ok(Number.isFinite(pt[0]));
      assert.ok(Number.isFinite(pt[1]));
      assert.ok(Number.isFinite(pt[2]));
    }
  });

  it("should compute 3D visual/collision poses and live Digital Twin telemetry (velocity, gripper opening, clearance)", async () => {
    const {
      computeRobotVisualAndCollisionPoses,
      computeLiveDigitalTwinTelemetry,
      interpolateJointTrajectory,
    } = await import("../src/kinematics/trajectory.js");

    const cellUrdf = `<?xml version="1.0"?>
<robot name="test_cell">
  <link name="base_link">
    <inertial><mass value="2.0"/><inertia ixx="0.01" iyy="0.01" izz="0.01"/></inertial>
    <visual name="ur3e_base"><geometry><mesh filename="package://ur_description/meshes/ur3e/visual/base.dae"/></geometry></visual>
    <collision><geometry><cylinder radius="0.06" length="0.1"/></geometry></collision>
  </link>
  <link name="tool0_gripper">
    <inertial><mass value="0.5"/><inertia ixx="0.002" iyy="0.002" izz="0.002"/></inertial>
    <visual name="robotiq_gripper"><geometry><mesh filename="package://robotiq_description/meshes/visual/hande.dae"/></geometry></visual>
    <collision><geometry><box size="0.06 0.08 0.1"/></geometry></collision>
  </link>
  <joint name="shoulder_pan_joint" type="revolute">
    <parent link="base_link"/><child link="tool0_gripper"/>
    <origin xyz="0 0 0.25" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
  </joint>
</robot>`;

    const robot = parseUrdf(cellUrdf);
    const traj = {
      times: [0.0, 2.0, 4.0],
      jointPositions: {
        shoulder_pan_joint: [0.0, 1.2, 1.2],
      },
    };
    const qMap = interpolateJointTrajectory(traj, 1.0);
    const poses = computeForwardKinematics(robot, qMap);
    const { visuals, collisions } = computeRobotVisualAndCollisionPoses(robot, poses);

    assert.equal(visuals.length, 2);
    assert.equal(collisions.length, 2);
    assert.equal(visuals[0]?.visualName, "ur3e_base");
    assert.equal(visuals[1]?.visualName, "robotiq_gripper");

    const telemetry = computeLiveDigitalTwinTelemetry(robot, traj, 1.0, qMap, poses, [
      {
        id: "reactor",
        name: "Heated Reactor",
        type: "reactor_mixer",
        position: [0.22, 0.0, 0.2],
        dimensions: [0.2, 0.2, 0.2],
      },
    ]);

    assert.ok(telemetry.maxJointSpeedDegPerSec > 10, "Expected non-zero joint angular velocity during motion");
    assert.equal(telemetry.gripperOpeningMm, 110);
    assert.equal(telemetry.gripperStateLabel, "Open");
    assert.ok(telemetry.clearance.minDistanceMm > 0);
  });

  it("should infer link geometry for arbitrary package:// mesh URDFs, synthesize default trajectories, and compute standalone clearance without phantom obstacles", async () => {
    const {
      computeRobotVisualAndCollisionPoses,
      computeLiveDigitalTwinTelemetry,
      generateDefaultKinematicDemoTrajectory,
      interpolateJointTrajectory,
    } = await import("../src/kinematics/trajectory.js");

    const genericRosUrdf = `<?xml version="1.0"?>
<robot name="franka_panda_generic">
  <link name="panda_link0">
    <visual><geometry><mesh filename="package://franka_description/meshes/visual/link0.dae"/></geometry></visual>
  </link>
  <link name="panda_link1">
    <visual><geometry><mesh filename="package://franka_description/meshes/visual/link1.dae"/></geometry></visual>
  </link>
  <link name="panda_link2">
    <visual><geometry><mesh filename="package://franka_description/meshes/visual/link2.dae"/></geometry></visual>
    <collision><geometry><cylinder radius="0.06" length="0.316"/></geometry></collision>
  </link>
  <joint name="panda_joint1" type="revolute">
    <parent link="panda_link0"/><child link="panda_link1"/>
    <origin xyz="0 0 0.333" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-2.8973" upper="2.8973" effort="87" velocity="2.175"/>
  </joint>
  <joint name="panda_joint2" type="revolute">
    <parent link="panda_link1"/><child link="panda_link2"/>
    <origin xyz="0 0 0.316" rpy="-1.5708 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-1.7628" upper="1.7628" effort="87" velocity="2.175"/>
  </joint>
</robot>`;

    const robot = parseUrdf(genericRosUrdf);
    const { trajectory, programSteps } = generateDefaultKinematicDemoTrajectory(robot);
    assert.equal(trajectory.times.length, 9, "Expected synthesized demo trajectory time series");
    assert.equal(programSteps.length, 4, "Expected 4 synthesized kinematic demo program steps");

    const qMap = interpolateJointTrajectory(trajectory, 2.0);
    const poses = computeForwardKinematics(robot, qMap);
    const { visuals } = computeRobotVisualAndCollisionPoses(robot, poses);

    assert.equal(visuals.length, 3);
    // panda_link0 has no collision, so its mesh visual should be inferred from child joint bone (length 0.333)
    const link0Vis = visuals.find((v) => v.linkName === "panda_link0")!;
    assert.equal(link0Vis.geometry.type, "cylinder");
    assert.ok(Math.abs((link0Vis.geometry.length ?? 0) - 0.333) < 0.01);

    // panda_link2 has a collision cylinder, so its mesh visual should inherit the collision cylinder (length 0.316)
    const link2Vis = visuals.find((v) => v.linkName === "panda_link2")!;
    assert.equal(link2Vis.geometry.type, "cylinder");
    assert.ok(Math.abs((link2Vis.geometry.length ?? 0) - 0.316) < 0.01);

    // Standalone telemetry with no environment and no gripper
    const telemetry = computeLiveDigitalTwinTelemetry(robot, trajectory, 2.0, qMap, poses, []);
    assert.equal(telemetry.hasGripper, false);
    assert.ok((telemetry.tcpSpeedMmPerSec ?? 0) > 0, "Expected positive TCP speed during motion");
    assert.ok(
      !telemetry.clearance.nearestObstacleName.includes("Heated Reactor"),
      `Expected self/ground clearance rather than phantom obstacle, got ${telemetry.clearance.nearestObstacleName}`,
    );
  });
});

