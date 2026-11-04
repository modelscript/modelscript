// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseOpenSim } from "../src/parser/index.js";
import { openSimToModelica, openSimToUrdf } from "../src/projections/index.js";

const SAMPLE_OSIM = `
<OpenSimDocument Version="40000">
  <Model name="leg_model">
    <gravity>0 -9.81 0</gravity>
    <BodySet>
      <Body name="thigh">
        <mass>8.5</mass>
        <mass_center>0 -0.2 0</mass_center>
        <inertia>0.12 0.03 0.12 0 0 0</inertia>
      </Body>
    </BodySet>
    <JointSet>
      <PinJoint name="hip_joint">
        <socket_parent_frame>ground</socket_parent_frame>
        <socket_child_frame>thigh</socket_child_frame>
        <location_in_parent>0 0.9 0</location_in_parent>
        <orientation_in_parent>0 0 0</orientation_in_parent>
        <coordinates>
          <Coordinate name="hip_flexion">
            <motion_type>rotational</motion_type>
            <default_value>0.15</default_value>
            <range>-0.5 2.0</range>
          </Coordinate>
        </coordinates>
      </PinJoint>
    </JointSet>
    <ForceSet>
      <Thelen2003Muscle name="iliopsoas">
        <max_isometric_force>1200</max_isometric_force>
        <optimal_fiber_length>0.10</optimal_fiber_length>
        <tendon_slack_length>0.14</tendon_slack_length>
        <pennation_angle_at_optimal>0.14</pennation_angle_at_optimal>
        <GeometryPath>
          <PathPointSet>
            <PathPoint name="p1"><socket_parent_frame>ground</socket_parent_frame><location>0 0.95 0</location></PathPoint>
            <PathPoint name="p2"><socket_parent_frame>thigh</socket_parent_frame><location>0.03 -0.1 0</location></PathPoint>
          </PathPointSet>
        </GeometryPath>
      </Thelen2003Muscle>
    </ForceSet>
  </Model>
</OpenSimDocument>
`;

describe("OpenSim Projections (Modelica 3.x & URDF)", () => {
  it("projects OpenSim document to a Modelica 3.x musculoskeletal model", () => {
    const doc = parseOpenSim(SAMPLE_OSIM);
    const mo = openSimToModelica(doc);
    assert(mo.includes("model leg_model"));
    assert(mo.includes("parameter Real mass_thigh"));
    assert(mo.includes('parameter Real F_max_iliopsoas(unit="N") = 1200;'));
    assert(mo.includes("der(a_iliopsoas)"));
    assert(mo.includes("der(q_hip_flexion) = u_hip_flexion;"));
    assert(mo.includes("end leg_model;"));
  });

  it("projects OpenSim document to a valid URDF <robot> XML description", () => {
    const doc = parseOpenSim(SAMPLE_OSIM);
    const urdf = openSimToUrdf(doc);
    assert(urdf.includes('<robot name="leg_model">'));
    assert(urdf.includes('<link name="ground"/>'));
    assert(urdf.includes('<link name="thigh">'));
    assert(urdf.includes('<mass value="8.5"/>'));
    assert(urdf.includes('<joint name="hip_joint" type="revolute">'));
    assert(urdf.includes('<parent link="ground"/>'));
    assert(urdf.includes('<child link="thigh"/>'));
    assert(urdf.includes('<limit lower="-0.5" upper="2"'));
    assert(urdf.includes("</robot>"));
  });
});
