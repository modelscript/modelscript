// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUrdf } from "../src/parser/index.js";
import { urdfToAdams, urdfToCadShapes, urdfToModelica, urdfToSimpack } from "../src/projections/index.js";

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
});
