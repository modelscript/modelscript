// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUrdf } from "../src/parser/index.js";
import {
  urdfToAdams,
  urdfToCadShapes,
  urdfToModelica,
  urdfToSimpack,
  urdfToUsd,
  urdfToUsdz,
} from "../src/projections/index.js";

const ROBOT_XML = `<?xml version="1.0"?>
<robot name="scara">
  <link name="base_link">
    <visual>
      <geometry><cylinder radius="0.1" length="0.2"/></geometry>
    </visual>
  </link>
  <link name="link_1">
    <visual>
      <geometry><box size="0.5 0.1 0.1"/></geometry>
    </visual>
  </link>
  <joint name="j1" type="revolute">
    <parent link="base_link"/>
    <child link="link_1"/>
    <origin xyz="0 0 0.3"/>
    <axis xyz="0 0 1"/>
  </joint>
</robot>`;

describe("URDF Projections (@modelscript/urdf)", () => {
  it("should project to Modelica.Mechanics.MultiBody model", () => {
    const robot = parseUrdf(ROBOT_XML);
    const mo = urdfToModelica(robot);
    assert.ok(mo.includes("model scara"));
    assert.ok(mo.includes("MultiBody.World world"));
    assert.ok(mo.includes("Joints.Revolute j1"));
  });

  it("should project to MSC Adams dataset", () => {
    const robot = parseUrdf(ROBOT_XML);
    const adm = urdfToAdams(robot);
    assert.ok(adm.parts.size >= 2);
    assert.ok(adm.joints.size >= 1);
  });

  it("should project to SIMPACK model", () => {
    const robot = parseUrdf(ROBOT_XML);
    const spck = urdfToSimpack(robot);
    assert.ok(spck.bodies.size >= 2);
    assert.ok(spck.joints.size >= 1);
  });

  it("should project to 3D CAD Shapes", () => {
    const robot = parseUrdf(ROBOT_XML);
    const shapes = urdfToCadShapes(robot);
    assert.ok(shapes.length >= 2);
    assert.equal(shapes[0]?.type, "cylinder");
    assert.equal(shapes[1]?.type, "box");
  });

  it("should project to OpenUSD with UsdPhysics and animated trajectory", () => {
    const robot = parseUrdf(ROBOT_XML);
    const usda = urdfToUsd(robot, {
      stageName: "ScaraRobot",
      trajectory: {
        times: [0.0, 0.5, 1.0],
        jointPositions: {
          j1: [0.0, 0.785, 1.57],
        },
      },
    });

    assert.ok(usda.startsWith("#usda 1.0"));
    assert.ok(usda.includes('defaultPrim = "ScaraRobot"'));
    assert.ok(usda.includes('def Xform "base_link"'));
    assert.ok(usda.includes('prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]'));
    assert.ok(usda.includes('def PhysicsRevoluteJoint "j1"'));
    assert.ok(usda.includes("rel physics:body0 = </ScaraRobot/base_link>"));
    assert.ok(usda.includes("rel physics:body1 = </ScaraRobot/link_1>"));
    assert.ok(usda.includes('uniform token physics:axis = "Z"'));
    assert.ok(usda.includes("double3 xformOp:translate.timeSamples = {"));
    assert.ok(usda.includes("quatf xformOp:orient.timeSamples = {"));
  });

  it("should project to 64-byte aligned USDZ package", () => {
    const robot = parseUrdf(ROBOT_XML);
    const usdz = urdfToUsdz(robot, { stageName: "ScaraPackage" });
    assert.ok(usdz instanceof Uint8Array);
    assert.ok(usdz.length > 200);

    const view = new DataView(usdz.buffer, usdz.byteOffset, usdz.byteLength);
    assert.equal(view.getUint32(0, true), 0x04034b50); // ZIP LFH signature

    const fileNameLen = view.getUint16(26, true);
    const extraLen = view.getUint16(28, true);
    const dataOffset = 30 + fileNameLen + extraLen;

    assert.equal(dataOffset % 64, 0, "USDZ payload MUST be aligned to a 64-byte boundary");
  });
});
