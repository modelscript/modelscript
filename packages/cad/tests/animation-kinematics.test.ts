// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AnimationController,
  getUnitScaleFactor,
  quaternionFromAxisAngle,
  quaternionFromDirections,
  quaternionFromEuler,
  quaternionFromMatrix3x3,
  quaternionSlerp,
  quaternionToEuler,
  rotateVectorByQuaternion,
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

  it("constructs right-handed orthonormal frame quaternion from MSL lengthDirection and widthDirection", () => {
    // Default lengthDirection = [1, 0, 0], widthDirection = [0, 1, 0] -> identity
    const qIdentity = quaternionFromDirections([1, 0, 0], [0, 1, 0]);
    assert.ok(Math.abs(qIdentity[0]) < 1e-6);
    assert.ok(Math.abs(qIdentity[1]) < 1e-6);
    assert.ok(Math.abs(qIdentity[2]) < 1e-6);
    assert.ok(Math.abs(qIdentity[3] - 1.0) < 1e-6);

    // lengthDirection along +Y ([0, 1, 0]), widthDirection along -X ([-1, 0, 0]) -> +90 deg Z rotation
    const qRotZ = quaternionFromDirections([0, 1, 0], [-1, 0, 0]);
    const rotatedEx = rotateVectorByQuaternion([1, 0, 0], qRotZ);
    assert.ok(Math.abs(rotatedEx[0] - 0) < 1e-5);
    assert.ok(Math.abs(rotatedEx[1] - 1) < 1e-5);
    assert.ok(Math.abs(rotatedEx[2] - 0) < 1e-5);

    // Degenerate parallel lengthDirection and widthDirection falls back cleanly without NaN
    const qParallel = quaternionFromDirections([0, 1, 0], [0, 2, 0]);
    const rotatedParallel = rotateVectorByQuaternion([1, 0, 0], qParallel);
    assert.ok(Math.abs(rotatedParallel[1] - 1) < 1e-5);
  });

  it("evaluates MSL Visualizers.Advanced.Shape and Vector local frame offsets, directions, and headAtOrigin", () => {
    const ctrl = new AnimationController();

    ctrl.setBindings([
      {
        componentName: "rev.cylinder",
        bindings: [
          { property: "position", index: 0, variable: "rev.cylinder.r[1]" },
          { property: "position", index: 1, variable: "rev.cylinder.r[2]" },
          { property: "position", index: 2, variable: "rev.cylinder.r[3]" },
          { property: "lengthDirection", index: 0, variable: "rev.cylinder.lengthDirection[1]" },
          { property: "lengthDirection", index: 1, variable: "rev.cylinder.lengthDirection[2]" },
          { property: "lengthDirection", index: 2, variable: "rev.cylinder.lengthDirection[3]" },
        ],
        defaults: {
          position: [1, 2, 3],
          shapeOffset: [0, 0, -0.25],
          lengthDirection: [0, 0, 1],
          widthDirection: [1, 0, 0],
          scale: [0.5, 0.1, 0.1],
        },
      },
      {
        componentName: "forceArrow",
        bindings: [
          { property: "vectorCoordinates", index: 0, variable: "forceArrow.coordinates[1]" },
          { property: "vectorCoordinates", index: 1, variable: "forceArrow.coordinates[2]" },
          { property: "vectorCoordinates", index: 2, variable: "forceArrow.coordinates[3]" },
        ],
        defaults: {
          position: [0, 0, 0],
          shapeOffset: [0, 0, 0],
          vectorCoordinates: [2, 0, 0],
          headAtOrigin: true,
          scale: [2, 0.05, 0.05],
        },
      },
    ]);

    const t = [0.0, 1.0];
    const y = [
      [1.0, 2.0, 3.0, 0.0, 0.0, 1.0, 2.0, 0.0, 0.0],
      [2.0, 2.0, 3.0, 0.0, 1.0, 0.0, 0.0, 4.0, 0.0],
    ];
    const states = [
      "rev.cylinder.r[1]",
      "rev.cylinder.r[2]",
      "rev.cylinder.r[3]",
      "rev.cylinder.lengthDirection[1]",
      "rev.cylinder.lengthDirection[2]",
      "rev.cylinder.lengthDirection[3]",
      "forceArrow.coordinates[1]",
      "forceArrow.coordinates[2]",
      "forceArrow.coordinates[3]",
    ];

    ctrl.loadTimeseries(t, y, states);
    ctrl.seek(0.0);

    // At t=0: cylinder is at r=[1,2,3] + r_shape=[0,0,-0.25] = [1, 2, 2.75], pointing along +Z
    const cyl0 = ctrl.getTransform("rev.cylinder");
    assert.ok(Math.abs(cyl0.position[0] - 1.0) < 1e-5);
    assert.ok(Math.abs(cyl0.position[1] - 2.0) < 1e-5);
    assert.ok(Math.abs(cyl0.position[2] - 2.75) < 1e-5);
    const cylDir0 = rotateVectorByQuaternion([1, 0, 0], cyl0.quaternion!);
    assert.ok(Math.abs(cylDir0[2] - 1.0) < 1e-5);

    // At t=0: forceArrow has coordinates=[2,0,0] with headAtOrigin=true -> origin shifted to [-2, 0, 0], length=2
    const arrow0 = ctrl.getTransform("forceArrow");
    assert.ok(Math.abs(arrow0.position[0] - -2.0) < 1e-5);
    assert.ok(Math.abs(arrow0.scale[0] - 2.0) < 1e-5);

    // At t=1: forceArrow has coordinates=[0,4,0] with headAtOrigin=true -> origin shifted to [0, -4, 0], length=4
    ctrl.seek(1.0);
    const arrow1 = ctrl.getTransform("forceArrow");
    assert.ok(Math.abs(arrow1.position[1] - -4.0) < 1e-5);
    assert.ok(Math.abs(arrow1.scale[0] - 4.0) < 1e-5);
  });
});
