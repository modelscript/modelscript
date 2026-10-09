// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AnimationController,
  getUnitScaleFactor,
  quaternionFromAxisAngle,
  quaternionFromEuler,
  quaternionFromMatrix3x3,
  quaternionSlerp,
  quaternionToEuler,
} from "../src/index.js";

describe("CAD Kinematics & Spatial Orientation Solvers", () => {
  it("converts 3×3 identity matrix to identity quaternion", () => {
    const identity3x3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const q = quaternionFromMatrix3x3(identity3x3, false);
    assert.ok(Math.abs(q[0]) < 1e-6);
    assert.ok(Math.abs(q[1]) < 1e-6);
    assert.ok(Math.abs(q[2]) < 1e-6);
    assert.ok(Math.abs(q[3] - 1.0) < 1e-6);
  });

  it("correctly handles Modelica MultiBody R.T transpose matrix for 90-degree Z rotation", () => {
    // 90 deg rotation around Z:
    // R = [ 0, -1, 0;
    //       1,  0, 0;
    //       0,  0, 1 ]
    // Modelica R.T = transpose of R:
    // R.T = [  0, 1, 0;
    //         -1, 0, 0;
    //          0, 0, 1 ]
    const rtMatrix = [0, 1, 0, -1, 0, 0, 0, 0, 1];
    const q = quaternionFromMatrix3x3(rtMatrix, true);

    // Expected quaternion for +90 deg around Z: [0, 0, sin(45°), cos(45°)] = [0, 0, 0.7071, 0.7071]
    assert.ok(Math.abs(q[0]) < 1e-4);
    assert.ok(Math.abs(q[1]) < 1e-4);
    assert.ok(Math.abs(q[2] - Math.SQRT1_2) < 1e-4);
    assert.ok(Math.abs(q[3] - Math.SQRT1_2) < 1e-4);
  });

  it("performs Euler angle to quaternion and back round-trip", () => {
    const roll = 30; // deg
    const pitch = 45; // deg
    const yaw = 60; // deg

    const q = quaternionFromEuler(roll, pitch, yaw, "XYZ", true);
    const euler = quaternionToEuler(q, "XYZ", true);

    assert.ok(Math.abs(euler[0] - roll) < 1e-4);
    assert.ok(Math.abs(euler[1] - pitch) < 1e-4);
    assert.ok(Math.abs(euler[2] - yaw) < 1e-4);
  });

  it("interpolates orientations smoothly via quaternion SLERP", () => {
    const q0 = quaternionFromAxisAngle([0, 0, 1], 0, true);
    const q1 = quaternionFromAxisAngle([0, 0, 1], 90, true);

    const mid = quaternionSlerp(q0, q1, 0.5);
    const eulerMid = quaternionToEuler(mid, "XYZ", true);

    assert.ok(Math.abs(eulerMid[2] - 45) < 1e-4);
  });

  it("computes physical unit scaling factors accurately", () => {
    assert.equal(getUnitScaleFactor("m", "mm"), 1000);
    assert.equal(getUnitScaleFactor("mm", "m"), 0.001);
    assert.equal(getUnitScaleFactor("cm", "m"), 0.01);
    assert.ok(Math.abs(getUnitScaleFactor("rad", "deg") - 57.2957795) < 1e-4);
    assert.ok(Math.abs(getUnitScaleFactor("rpm", "rad/s") - 0.1047197) < 1e-4);
  });
});

describe("Unified Animation Controller", () => {
  it("manages time-series replay with dynamic translation and unit scaling", () => {
    const ctrl = new AnimationController();

    ctrl.setBindings([
      {
        componentName: "Chassis",
        bindings: [
          { property: "position", index: 0, variable: "pos_x", unit: "m", scaleFactor: 1000 }, // m to mm
          { property: "position", index: 1, variable: "pos_y", unit: "m", scaleFactor: 1000 },
          { property: "position", index: 2, variable: "pos_z", unit: "m", scaleFactor: 1000 },
        ],
      },
    ]);

    ctrl.setDefault("Chassis", {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });

    const t = [0.0, 1.0, 2.0];
    const y = [
      [0.0, 0.0, 0.0],
      [1.0, 2.0, 0.5],
      [2.0, 4.0, 1.0],
    ];
    const states = ["pos_x", "pos_y", "pos_z"];

    ctrl.loadTimeseries(t, y, states);
    assert.equal(ctrl.hasData, true);
    assert.equal(ctrl.startTime, 0.0);
    assert.equal(ctrl.stopTime, 2.0);

    // Initial time t=0
    let tf = ctrl.getTransform("Chassis");
    assert.deepEqual(tf.position, [0, 0, 0]);

    // Scrub to t=1.0s
    ctrl.seek(1.0);
    tf = ctrl.getTransform("Chassis");
    assert.deepEqual(tf.position, [1000, 2000, 500]);

    // Interpolate midpoint t=0.5s
    ctrl.seek(0.5);
    tf = ctrl.getTransform("Chassis");
    assert.deepEqual(tf.position, [500, 1000, 250]);
  });

  it("handles live co-simulation streaming batches and volumetric deformation", () => {
    const ctrl = new AnimationController();

    ctrl.setBindings([
      {
        componentName: "SoftHeart",
        bindings: [{ property: "position", index: 0, variable: "r_x" }],
        deformationConfig: {
          mode: "volume_radial",
          volumeVariable: "heart_volume",
          referenceVolume: 1.0,
        },
      },
    ]);

    ctrl.setDefault("SoftHeart", {
      position: [0, 0, 0],
      scale: [1, 1, 1],
    });

    ctrl.goLive();
    assert.equal(ctrl.mode, "live");

    // Push live co-simulation step at t=0.1s: Volume expands to 8.0 (radial scale should be cbrt(8) = 2.0)
    ctrl.pushLiveBatch(
      {
        r_x: 25.0,
        heart_volume: 8.0,
      },
      0.1,
    );

    assert.equal(ctrl.currentTime, 0.1);
    const tf = ctrl.getTransform("SoftHeart");
    assert.equal(tf.position[0], 25.0);
    assert.ok(Math.abs(tf.scale[0] - 2.0) < 1e-5);
    assert.ok(Math.abs(tf.scale[1] - 2.0) < 1e-5);
    assert.ok(Math.abs(tf.scale[2] - 2.0) < 1e-5);
  });

  it("advances playback clock in playing mode and notifies subscribers", () => {
    const ctrl = new AnimationController();
    let stateUpdates = 0;
    ctrl.onStateChange(() => {
      stateUpdates++;
    });

    ctrl.loadTimeseries([0, 10], [[0], [10]], ["x"]);
    ctrl.play();
    assert.equal(ctrl.mode, "playing");

    ctrl.tick(0.5); // dt = 0.5s
    assert.ok(Math.abs(ctrl.currentTime - 0.5) < 1e-4);

    ctrl.pause();
    assert.equal(ctrl.mode, "paused");
    assert.ok(stateUpdates >= 2);
  });
});
