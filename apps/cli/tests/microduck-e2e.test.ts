// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildRobotAnimationBindings } from "@modelscript/cad";
import { generateFmu, generateFmuCSources } from "@modelscript/exchange";
import { initBltWasm } from "@modelscript/runtime";
import {
  importONNXToROM,
  SampledPolicyController,
  simulateArena,
  type OnnxGraphExport,
  type PeriodicCallback,
} from "@modelscript/simulate";
import {
  coupleElectroThermalDrivetrains,
  lowerUrdfToDae,
  parseMjcf,
  renderUrdfIsometric3DSvg,
} from "@modelscript/urdf";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const MICRODUCK_MJCF = `
<mujoco model="microduck_e2e">
  <compiler angle="degree"/>
  <default>
    <joint damping="0.08" frictionloss="0.015"/>
    <geom condim="3" friction="1.0 0.005 0.0001" solref="0.015 1.2" solimp="0.9 0.95 0.001"/>
    <position kp="1.5"/>
  </default>
  <worldbody>
    <geom name="floor" type="plane" size="10 10 0.1"/>
    <body name="trunk" pos="0 0 0.118">
      <freejoint name="root_free"/>
      <inertial pos="0 0 0" mass="0.457" diaginertia="0.003 0.003 0.002"/>
      <site name="imu_site" pos="0 0 0.02"/>
      <body name="left_leg" pos="0 0.04 -0.04">
        <joint name="left_hip_pitch" type="hinge" axis="0 1 0" range="-60 60"/>
        <inertial pos="0 0 -0.03" mass="0.14" diaginertia="0.0004 0.0004 0.0002"/>
        <geom name="left_sole" type="box" pos="0 0 -0.0702" size="0.03 0.02 0.005"/>
      </body>
      <body name="right_leg" pos="0 -0.04 -0.04">
        <joint name="right_hip_pitch" type="hinge" axis="0 1 0" range="-60 60"/>
        <inertial pos="0 0 -0.03" mass="0.14" diaginertia="0.0004 0.0004 0.0002"/>
        <geom name="right_sole" type="box" pos="0 0 -0.0702" size="0.03 0.02 0.005"/>
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
  </sensor>
</mujoco>
`;

function makePolicyOnnx(): OnnxGraphExport {
  return {
    modelFormat: "ONNX-v1.14",
    graph: {
      name: "WalkingPolicy",
      inputs: [{ name: "obs", dims: [1, 4] }],
      outputs: [{ name: "action", dims: [1, 2] }],
      initializers: [
        { name: "w1", dims: [2, 4], data: [0.2, 0.0, -0.1, 0.0, 0.0, 0.2, 0.0, -0.1] },
        { name: "b1", dims: [2], data: [0.0, 0.0] },
        { name: "ln_g", dims: [2], data: [1.0, 1.0] },
        { name: "ln_b", dims: [2], data: [0.0, 0.0] },
        { name: "w2", dims: [2, 2], data: [0.15, 0.0, 0.0, 0.15] },
        { name: "b2", dims: [2], data: [0.05, -0.05] },
        { name: "clip_min", dims: [1], data: [-0.5] },
        { name: "clip_max", dims: [1], data: [0.5] },
      ],
      nodes: [
        { opType: "Gemm", inputs: ["obs", "w1", "b1"], outputs: ["h1"], name: "fc1" },
        { opType: "LayerNormalization", inputs: ["h1", "ln_g", "ln_b"], outputs: ["n1"], name: "ln1" },
        { opType: "Elu", inputs: ["n1"], outputs: ["a1"], name: "act1" },
        { opType: "Gemm", inputs: ["a1", "w2", "b2"], outputs: ["raw"], name: "fc2" },
        { opType: "Clip", inputs: ["raw", "clip_min", "clip_max"], outputs: ["action"], name: "clip1" },
      ],
    },
  };
}

describe("MicroDuck End-to-End Polyglot Drop, Policy Loop & FMU Export", () => {
  it("should simulate 2.8 mm drop with soft contact, coupled 2S battery sag, servo heating, and 50 Hz RL policy", async () => {
    await initBltWasm();
    const robot = parseMjcf(MICRODUCK_MJCF);
    const dae = lowerUrdfToDae(robot);

    coupleElectroThermalDrivetrains(
      dae,
      [
        { jointName: "left_hip_pitch", kp: 1.5, kv: 0.05 },
        { jointName: "right_hip_pitch", kp: 1.5, kv: 0.05 },
      ],
      { useBattery: true, useThermal: true, batteryVoc: 7.4, batteryRint: 0.07 },
    );

    const rom = importONNXToROM(makePolicyOnnx());
    const policy = new SampledPolicyController(rom, {
      name: "WalkingPolicy",
      samplePeriod: 0.02,
      commandDelay: 0.0225,
      actionScale: 1.0,
      actionOffset: [0.0, 0.0],
    });

    const policyCb: PeriodicCallback = {
      type: "periodic",
      interval: 0.02,
      affect: (t, y, controls) => {
        const obs = [y[0] ?? 0, y[1] ?? 0, y[2] ?? 0, y[3] ?? 0];
        const cmd = policy.step(t, obs);
        controls.reinit("left_hip_pitch.q_target", cmd[0] ?? 0);
        controls.reinit("right_hip_pitch.q_target", cmd[1] ?? 0);
      },
    };

    const res = simulateArena(dae, {
      startTime: 0.0,
      stopTime: 0.25,
      step: 0.002,
      solver: "rk4",
      callbacks: [policyCb],
    });

    assert.ok(res.t.length > 50, `Expected >50 simulation time points, got ${res.t.length}`);
    const zIdx = res.states.indexOf("trunk.z");
    const vzIdx = res.states.indexOf("trunk.vz");
    const tempIdx = res.states.indexOf("left_hip_pitch.T_winding");
    const lqStateIdx = res.states.indexOf("left_hip_pitch.q");
    assert.notEqual(zIdx, -1, `Missing trunk.z in states: ${res.states.join(", ")}`);
    assert.notEqual(vzIdx, -1);
    assert.notEqual(tempIdx, -1);
    assert.notEqual(lqStateIdx, -1);

    const zTrace = res.y.map((row) => row[zIdx]!);
    const lqTrace = res.y.map((row) => row[lqStateIdx]!);
    const tempTrace = res.y.map((row) => row[tempIdx]!);

    // Trunk should drop onto the soft soles and stay bounded & finite
    const minZ = Math.min(...zTrace);
    const finalZ = zTrace[zTrace.length - 1]!;
    assert.ok(Number.isFinite(finalZ) && finalZ > 0.09 && finalZ < 0.13, `Unexpected final trunk.z=${finalZ}`);
    assert.ok(minZ < zTrace[0]!, "Trunk should dip under gravity on touchdown");

    // Joint should swing smoothly toward the 50 Hz delayed RL policy target
    const maxAbsQ = Math.max(...lqTrace.map(Math.abs));
    assert.ok(maxAbsQ > 0.05, `Expected joint motion under RL policy, got maxAbsQ=${maxAbsQ}`);

    // Winding temperature should rise above ambient 298.15K due to copper & friction losses
    const maxTemp = Math.max(...tempTrace);
    assert.ok(Number.isFinite(maxTemp) && maxTemp > 298.15, `Expected winding heating > 298.15K, got ${maxTemp}`);

    // Standalone FMU 2.0/3.0 C99 export of the coupled MJCF + contact + electro-thermal plant
    const fmuOpts = { modelIdentifier: "DuckPlant", guid: "{12345678-1234-4321-8765-123456789abc}" };
    const fmuResult = generateFmu(dae, fmuOpts);
    assert.ok(fmuResult.modelDescriptionXml.includes('modelName="DuckPlant"'));
    const cSources = generateFmuCSources(dae, fmuResult, fmuOpts);
    assert.ok(cSources.modelC.length > 500, "Expected generated C99 FMU model.c source");
    assert.ok(cSources.fmi2FunctionsC.length > 500, "Expected generated fmi2Functions.c source");
    assert.ok(cSources.fmi3FunctionsC.length > 500, "Expected generated fmi3Functions.c source");

    // 3D isometric SVG & CAD AnimationBindings
    const svg = renderUrdfIsometric3DSvg(robot);
    assert.ok(svg.includes("<svg"));
    const bindings = buildRobotAnimationBindings({
      linkNames: ["trunk", "left_leg", "right_leg"],
      contactNames: ["left_leg_left_sole_pt0"],
      servoJointNames: ["left_hip_pitch"],
    });
    assert.equal(bindings.length, 5);
  });
});
