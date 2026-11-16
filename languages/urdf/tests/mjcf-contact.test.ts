// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coupleElectroThermalDrivetrains, extractContactPointsFromRobot, lowerUrdfToDae } from "../src/dae/index.js";
import { isMjcfXml, parseMjcf } from "../src/parser/index.js";

const MICRODUCK_MJCF = `
<mujoco model="microduck_test">
  <compiler angle="degree" meshdir="meshes/"/>
  <default>
    <joint damping="0.05" frictionloss="0.015"/>
    <geom condim="3" friction="1.0 0.005 0.0001" solref="0.02 1.0" solimp="0.9 0.95 0.001"/>
    <position kp="0.589"/>
  </default>
  <asset>
    <mesh name="trunk_mesh" file="trunk.stl" scale="1 1 1"/>
  </asset>
  <worldbody>
    <geom name="floor" type="plane" size="10 10 0.1"/>
    <body name="trunk" pos="0 0 0.12">
      <freejoint name="root_free"/>
      <inertial pos="0 0 0" mass="0.45" diaginertia="0.002 0.002 0.001"/>
      <geom name="trunk_vis" type="mesh" mesh="trunk_mesh" contype="0" conaffinity="0"/>
      <site name="imu_site" pos="0 0 0.02"/>
      <body name="left_hip" pos="0 0.04 -0.04">
        <joint name="left_hip_pitch" type="hinge" axis="0 1 0" range="-60 60"/>
        <inertial pos="0 0 -0.03" mass="0.14" diaginertia="0.0002 0.0002 0.0001"/>
        <geom name="left_sole" type="box" pos="0 0 -0.075" size="0.03 0.02 0.005"/>
      </body>
      <body name="right_hip" pos="0 -0.04 -0.04">
        <joint name="right_hip_pitch" type="hinge" axis="0 1 0" range="-60 60"/>
        <inertial pos="0 0 -0.03" mass="0.14" diaginertia="0.0002 0.0002 0.0001"/>
        <geom name="right_sole" type="box" pos="0 0 -0.075" size="0.03 0.02 0.005"/>
      </body>
    </body>
  </worldbody>
  <actuator>
    <position name="act_l_hip" joint="left_hip_pitch"/>
    <position name="act_r_hip" joint="right_hip_pitch"/>
  </actuator>
  <sensor>
    <accelerometer name="imu_accel" site="imu_site"/>
    <gyro name="imu_gyro" site="imu_site"/>
    <framequat name="imu_quat" site="imu_site"/>
    <jointpos name="l_hip_pos" joint="left_hip_pitch"/>
  </sensor>
</mujoco>
`;

describe("MJCF Parser, 6-DOF Floating Base, Contact & Electro-Thermal Coupling", () => {
  it("should parse MJCF defaults, freejoint, contact geoms, actuators, and sensors", () => {
    assert.equal(isMjcfXml(MICRODUCK_MJCF), true);
    const robot = parseMjcf(MICRODUCK_MJCF);

    assert.equal(robot.name, "microduck_test");
    assert.equal(robot.links.has("trunk"), true);
    assert.equal(robot.links.has("left_hip"), true);
    assert.equal(robot.links.has("right_hip"), true);

    const rootJoint = robot.joints.get("root_free");
    assert.equal(rootJoint?.type, "floating");

    const lHip = robot.joints.get("left_hip_pitch");
    assert.equal(lHip?.type, "revolute");
    assert.ok(Math.abs((lHip?.limits?.upper ?? 0) - Math.PI / 3) < 1e-6);
    assert.equal(lHip?.dynamics?.damping, 0.05);

    assert.equal(robot.actuators?.length, 2);
    assert.equal(robot.actuators?.[0]?.kp, 0.589);
    assert.equal(robot.sensors?.length, 4);

    const contactPts = extractContactPointsFromRobot(robot);
    // 2 sole boxes * 4 bottom corners = 8 contact points
    assert.equal(contactPts.length, 8);
    assert.deepEqual(contactPts[0]?.contact?.solref, [0.02, 1.0]);
  });

  it("should lower 6-DOF floating base + 8 soft contact points + electro-thermal drivetrains into DAEBuilder", () => {
    const robot = parseMjcf(MICRODUCK_MJCF);
    const dae = lowerUrdfToDae(robot);

    // Check 6-DOF floating base quaternion & IMU variables
    assert.notEqual(dae.getVarIdxByName("trunk.qw"), -1);
    assert.notEqual(dae.getVarIdxByName("imu_gyro.x"), -1);
    assert.notEqual(dae.getVarIdxByName("imu_accel.z"), -1);
    assert.notEqual(dae.getVarIdxByName("imu_quat.qw"), -1);
    assert.notEqual(dae.getVarIdxByName("l_hip_pos.value"), -1);

    // Check contact force variables
    assert.notEqual(dae.getVarIdxByName("left_hip_left_sole_pt0.fn"), -1);

    // Couple electro-thermal PositionServo + shared 2S battery bus
    coupleElectroThermalDrivetrains(
      dae,
      [
        { jointName: "left_hip_pitch", kp: 0.589 },
        { jointName: "right_hip_pitch", kp: 0.589 },
      ],
      { useBattery: true, useThermal: true },
    );

    assert.notEqual(dae.getVarIdxByName("battery.V_bus"), -1);
    assert.notEqual(dae.getVarIdxByName("battery.I_total"), -1);
    assert.notEqual(dae.getVarIdxByName("left_hip_pitch.T_winding"), -1);
    assert.ok(dae.eqCount > 50, `Expected >50 coupled DAE equations, got ${dae.eqCount}`);
  });
});
