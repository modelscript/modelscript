// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseOpenSim } from "../src/parser/index.js";

const ARM26_OSIM_4X = `<?xml version="1.0" encoding="UTF-8" ?>
<OpenSimDocument Version="40000">
  <Model name="arm26">
    <gravity>0 -9.80665 0</gravity>
    <BodySet>
      <objects>
        <Body name="humerus">
          <mass>1.86457</mass>
          <mass_center>0 -0.180496 0</mass_center>
          <inertia>0.01481 0.004551 0.013193 0 0 0</inertia>
        </Body>
        <Body name="radius_ulna">
          <mass>1.534315</mass>
          <mass_center>0 -0.181479 0</mass_center>
          <inertia>0.019281 0.001571 0.020062 0 0 0</inertia>
        </Body>
      </objects>
    </BodySet>
    <JointSet>
      <objects>
        <PinJoint name="r_shoulder">
          <socket_parent_frame>ground_offset</socket_parent_frame>
          <socket_child_frame>humerus_offset</socket_child_frame>
          <frames>
            <PhysicalOffsetFrame name="ground_offset">
              <socket_parent>/ground</socket_parent>
              <translation>-0.017545 -0.007 0.17</translation>
              <orientation>0 0 0</orientation>
            </PhysicalOffsetFrame>
            <PhysicalOffsetFrame name="humerus_offset">
              <socket_parent>/bodyset/humerus</socket_parent>
              <translation>0 0 0</translation>
              <orientation>0 0 0</orientation>
            </PhysicalOffsetFrame>
          </frames>
          <coordinates>
            <Coordinate name="r_shoulder_elev">
              <motion_type>rotational</motion_type>
              <default_value>0.1</default_value>
              <range>-1.57079633 3.14159265</range>
              <clamped>true</clamped>
              <locked>false</locked>
            </Coordinate>
          </coordinates>
        </PinJoint>
        <PinJoint name="r_elbow">
          <socket_parent_frame>humerus</socket_parent_frame>
          <socket_child_frame>radius_ulna</socket_child_frame>
          <location_in_parent>0.0061 -0.2904 -0.0123</location_in_parent>
          <orientation_in_parent>0 0 0</orientation_in_parent>
          <CoordinateSet>
            <objects>
              <Coordinate name="r_elbow_flex">
                <motion_type>rotational</motion_type>
                <default_value>0.5</default_value>
                <range>0 2.26892803</range>
                <clamped>true</clamped>
                <locked>false</locked>
              </Coordinate>
            </objects>
          </CoordinateSet>
        </PinJoint>
      </objects>
    </JointSet>
    <ForceSet>
      <objects>
        <Thelen2003Muscle name="BIClong">
          <max_isometric_force>624.3</max_isometric_force>
          <optimal_fiber_length>0.1157</optimal_fiber_length>
          <tendon_slack_length>0.2723</tendon_slack_length>
          <pennation_angle_at_optimal>0.0</pennation_angle_at_optimal>
          <activation_time_constant>0.01</activation_time_constant>
          <deactivation_time_constant>0.04</deactivation_time_constant>
          <max_contraction_velocity>10.0</max_contraction_velocity>
          <GeometryPath>
            <PathPointSet>
              <objects>
                <PathPoint name="BIClong-P1">
                  <socket_parent_frame>/ground</socket_parent_frame>
                  <location>-0.03123 0.01023 0.1478</location>
                </PathPoint>
                <PathPoint name="BIClong-P2">
                  <socket_parent_frame>/bodyset/radius_ulna</socket_parent_frame>
                  <location>0.00751 -0.04839 0.02179</location>
                </PathPoint>
              </objects>
            </PathPointSet>
            <PathWrapSet>
              <objects>
                <PathWrap>
                  <wrap_object>HumerusHeadWrap</wrap_object>
                </PathWrap>
              </objects>
            </PathWrapSet>
          </GeometryPath>
        </Thelen2003Muscle>
      </objects>
    </ForceSet>
    <MarkerSet>
      <objects>
        <Marker name="r_acromion">
          <socket_parent_frame>/bodyset/humerus</socket_parent_frame>
          <location>-0.02 0.01 0.15</location>
        </Marker>
      </objects>
    </MarkerSet>
    <WrapObjectSet>
      <objects>
        <WrapCylinder name="HumerusHeadWrap">
          <socket_parent_frame>humerus</socket_parent_frame>
          <radius>0.025</radius>
          <length>0.08</length>
        </WrapCylinder>
      </objects>
    </WrapObjectSet>
    <ConstraintSet>
      <objects>
        <PointConstraint name="wrist_guide">
          <socket_body_1>ground</socket_body_1>
          <socket_body_2>radius_ulna</socket_body_2>
        </PointConstraint>
      </objects>
    </ConstraintSet>
  </Model>
</OpenSimDocument>`;

describe("OpenSim 3.x / 4.x (.osim) XML Parser", () => {
  it("parses OpenSim 4.x musculoskeletal model with PhysicalOffsetFrames, muscles, markers, wrap objects, and constraints", () => {
    const doc = parseOpenSim(ARM26_OSIM_4X, "file:///arm26.osim");
    assert.strictEqual(doc.modelName, "arm26");
    assert.strictEqual(doc.version, "40000");
    assert.strictEqual(doc.uri, "file:///arm26.osim");
    assert.deepStrictEqual(doc.gravity, [0, -9.80665, 0]);

    assert.strictEqual(doc.bodies.length, 2);
    const humerus = doc.bodies[0]!;
    assert.strictEqual(humerus.name, "humerus");
    assert.strictEqual(humerus.mass, 1.86457);
    assert.deepStrictEqual(humerus.massCenter, [0, -0.180496, 0]);
    assert.deepStrictEqual(humerus.inertia, [0.01481, 0.004551, 0.013193, 0, 0, 0]);
    assert(humerus.range.startLine >= 1);
    assert(humerus.range.endOffset > humerus.range.startOffset);

    assert.strictEqual(doc.joints.length, 2);
    const shoulder = doc.joints[0]!;
    assert.strictEqual(shoulder.name, "r_shoulder");
    assert.strictEqual(shoulder.jointType, "PinJoint");
    assert.strictEqual(shoulder.parentFrame, "/ground");
    assert.strictEqual(shoulder.childFrame, "humerus");
    assert.deepStrictEqual(shoulder.locationInParent, [-0.017545, -0.007, 0.17]);
    assert.strictEqual(shoulder.coordinates.length, 1);
    assert.strictEqual(shoulder.coordinates[0]!.name, "r_shoulder_elev");
    assert.strictEqual(shoulder.coordinates[0]!.defaultValue, 0.1);
    assert.strictEqual(shoulder.coordinates[0]!.clamped, true);

    assert.strictEqual(doc.muscles.length, 1);
    const bic = doc.muscles[0]!;
    assert.strictEqual(bic.name, "BIClong");
    assert.strictEqual(bic.muscleType, "Thelen2003Muscle");
    assert.strictEqual(bic.maxIsometricForce, 624.3);
    assert.strictEqual(bic.optimalFiberLength, 0.1157);
    assert.strictEqual(bic.tendonSlackLength, 0.2723);
    assert.strictEqual(bic.pathPoints.length, 2);
    assert.strictEqual(bic.pathPoints[0]!.bodyFrame, "/ground");
    assert.strictEqual(bic.pathPoints[1]!.bodyFrame, "radius_ulna");
    assert.deepStrictEqual(bic.wrapObjects, ["HumerusHeadWrap"]);

    assert.strictEqual(doc.markers.length, 1);
    assert.strictEqual(doc.markers[0]!.name, "r_acromion");
    assert.strictEqual(doc.markers[0]!.bodyFrame, "humerus");

    assert.strictEqual(doc.wrapObjects.length, 1);
    assert.strictEqual(doc.wrapObjects[0]!.name, "HumerusHeadWrap");
    assert.strictEqual(doc.wrapObjects[0]!.radius, 0.025);

    assert.strictEqual(doc.constraints.length, 1);
    assert.strictEqual(doc.constraints[0]!.name, "wrist_guide");
    assert.strictEqual(doc.constraints[0]!.constraintType, "PointConstraint");
  });

  it("parses OpenSim 3.x XML syntax (inertia_xx, parent_body, embedded Body Joint)", () => {
    const osim3x = `
      <OpenSimDocument Version="30000">
        <Model name="gait_3x">
          <BodySet>
            <objects>
              <Body name="pelvis">
                <mass>11.777</mass>
                <mass_center>-0.0707 0 0</mass_center>
                <inertia_xx>0.1028</inertia_xx>
                <inertia_yy>0.0871</inertia_yy>
                <inertia_zz>0.0579</inertia_zz>
                <Joint>
                  <FreeJoint name="ground_pelvis">
                    <parent_body>ground</parent_body>
                    <location_in_parent>0 0.95 0</location_in_parent>
                    <CoordinateSet>
                      <objects>
                        <Coordinate name="pelvis_tilt">
                          <motion_type>rotational</motion_type>
                          <default_value>0</default_value>
                          <range>-1.57 1.57</range>
                        </Coordinate>
                      </objects>
                    </CoordinateSet>
                  </FreeJoint>
                </Joint>
              </Body>
            </objects>
          </BodySet>
        </Model>
      </OpenSimDocument>
    `;
    const doc = parseOpenSim(osim3x);
    assert.strictEqual(doc.version, "30000");
    assert.strictEqual(doc.bodies.length, 1);
    assert.deepStrictEqual(doc.bodies[0]!.inertia, [0.1028, 0.0871, 0.0579, 0, 0, 0]);
    assert.strictEqual(doc.joints.length, 1);
    assert.strictEqual(doc.joints[0]!.name, "ground_pelvis");
    assert.strictEqual(doc.joints[0]!.parentFrame, "ground");
    assert.strictEqual(doc.joints[0]!.childFrame, "pelvis");
  });
});
