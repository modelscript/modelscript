// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintOpenSimDocument } from "../src/lints/index.js";
import { parseOpenSim } from "../src/parser/index.js";

describe("OpenSim Musculoskeletal Semantic Linter (M9101–M9110)", () => {
  it("emits M9101 on unresolved body frame in Joint, Marker, WrapObject, or Muscle PathPoint", () => {
    const xml = `
      <OpenSimDocument Version="40000">
        <Model name="bad_frames">
          <BodySet>
            <Body name="femur"><mass>9.3</mass><inertia>0.1 0.1 0.1 0 0 0</inertia></Body>
          </BodySet>
          <JointSet>
            <PinJoint name="hip">
              <socket_parent_frame>ground</socket_parent_frame>
              <socket_child_frame>missing_body</socket_child_frame>
            </PinJoint>
          </JointSet>
          <MarkerSet>
            <Marker name="mk1"><socket_parent_frame>ghost_frame</socket_parent_frame></Marker>
          </MarkerSet>
          <WrapObjectSet>
            <WrapSphere name="wrap1"><socket_parent_frame>ghost_wrap_body</socket_parent_frame><radius>0.03</radius></WrapSphere>
          </WrapObjectSet>
          <ForceSet>
            <Thelen2003Muscle name="m1">
              <PathPointSet>
                <PathPoint name="p1"><socket_parent_frame>ground</socket_parent_frame></PathPoint>
                <PathPoint name="p2"><socket_parent_frame>ghost_muscle_body</socket_parent_frame></PathPoint>
              </PathPointSet>
            </Thelen2003Muscle>
          </ForceSet>
        </Model>
      </OpenSimDocument>
    `;
    const diags = lintOpenSimDocument(parseOpenSim(xml));
    const m9101 = diags.filter((d) => d.code === "M9101");
    assert.strictEqual(m9101.length, 4);
  });

  it("emits M9102 when a Body has non-positive mass or principal inertia", () => {
    const xml = `
      <OpenSimDocument Version="40000">
        <Model name="bad_mass">
          <BodySet>
            <Body name="zero_mass_body"><mass>0</mass><inertia>0.1 0.1 0.1 0 0 0</inertia></Body>
            <Body name="bad_inertia_body"><mass>5.0</mass><inertia>0.1 -0.02 0.1 0 0 0</inertia></Body>
          </BodySet>
        </Model>
      </OpenSimDocument>
    `;
    const diags = lintOpenSimDocument(parseOpenSim(xml));
    const m9102 = diags.filter((d) => d.code === "M9102");
    assert.strictEqual(m9102.length, 2);
  });

  it("emits M9103 when kinematic joint graph contains a cycle or multiple parent joints without ConstraintSet", () => {
    const xml = `
      <OpenSimDocument Version="40000">
        <Model name="cyclic_tree">
          <BodySet>
            <Body name="b1"><mass>1</mass><inertia>1 1 1 0 0 0</inertia></Body>
            <Body name="b2"><mass>1</mass><inertia>1 1 1 0 0 0</inertia></Body>
          </BodySet>
          <JointSet>
            <PinJoint name="j1"><socket_parent_frame>b1</socket_parent_frame><socket_child_frame>b2</socket_child_frame></PinJoint>
            <PinJoint name="j2"><socket_parent_frame>b2</socket_parent_frame><socket_child_frame>b1</socket_child_frame></PinJoint>
          </JointSet>
        </Model>
      </OpenSimDocument>
    `;
    const diags = lintOpenSimDocument(parseOpenSim(xml));
    assert(diags.some((d) => d.code === "M9103"));
  });

  it("emits M9104 when coordinate rangeMin >= rangeMax or defaultValue is outside range", () => {
    const xml = `
      <OpenSimDocument Version="40000">
        <Model name="bad_coords">
          <BodySet>
            <Body name="tibia"><mass>3.7</mass><inertia>0.05 0.05 0.05 0 0 0</inertia></Body>
          </BodySet>
          <JointSet>
            <PinJoint name="knee">
              <socket_parent_frame>ground</socket_parent_frame>
              <socket_child_frame>tibia</socket_child_frame>
              <coordinates>
                <Coordinate name="knee_angle">
                  <default_value>3.5</default_value>
                  <range>-1.5 1.5</range>
                </Coordinate>
              </coordinates>
            </PinJoint>
          </JointSet>
        </Model>
      </OpenSimDocument>
    `;
    const diags = lintOpenSimDocument(parseOpenSim(xml));
    assert(diags.some((d) => d.code === "M9104"));
  });

  it("emits M9105, M9106, M9107, M9108, M9109, and M9110 for muscle & duplicate component errors", () => {
    const xml = `
      <OpenSimDocument Version="40000">
        <Model name="muscle_checks">
          <BodySet>
            <Body name="femur"><mass>9.0</mass><inertia>0.1 0.1 0.1 0 0 0</inertia></Body>
            <Body name="femur"><mass>9.0</mass><inertia>0.1 0.1 0.1 0 0 0</inertia></Body>
          </BodySet>
          <ForceSet>
            <Millard2012EquilibriumMuscle name="rect_fem">
              <max_isometric_force>-100</max_isometric_force>
              <optimal_fiber_length>0.1</optimal_fiber_length>
              <tendon_slack_length>0.2</tendon_slack_length>
              <pennation_angle_at_optimal>1.65</pennation_angle_at_optimal>
              <activation_time_constant>0.08</activation_time_constant>
              <deactivation_time_constant>0.02</deactivation_time_constant>
              <GeometryPath>
                <PathPointSet>
                  <PathPoint name="p1"><socket_parent_frame>femur</socket_parent_frame></PathPoint>
                  <PathPoint name="p2"><socket_parent_frame>femur</socket_parent_frame></PathPoint>
                </PathPointSet>
                <PathWrapSet>
                  <PathWrap><wrap_object>MissingPatellaWrap</wrap_object></PathWrap>
                </PathWrapSet>
              </GeometryPath>
            </Millard2012EquilibriumMuscle>
          </ForceSet>
        </Model>
      </OpenSimDocument>
    `;
    const diags = lintOpenSimDocument(parseOpenSim(xml));
    const codes = new Set(diags.map((d) => d.code));
    assert(codes.has("M9105"), "Expected M9105 for negative max_isometric_force");
    assert(codes.has("M9106"), "Expected M9106 for pennationAngleAtOptimal >= pi/2");
    assert(codes.has("M9107"), "Expected M9107 for all path points on same body");
    assert(codes.has("M9108"), "Expected M9108 for unresolved WrapObject");
    assert(codes.has("M9109"), "Expected M9109 for tau_act > tau_deact");
    assert(codes.has("M9110"), "Expected M9110 for duplicate body name");
  });
});
