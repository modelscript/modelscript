// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lowerOpenSimToDae } from "../src/dae/index.js";
import { parseOpenSim } from "../src/parser/index.js";
import {
  computeActivationDerivative,
  computeActiveForceLength,
  computeForceVelocity,
  computePassiveForceLength,
  simulateMuscleDynamics,
} from "../src/solvers/index.js";

const ELBOW_FLEXION_OSIM = `
<OpenSimDocument Version="40000">
  <Model name="elbow_flexion">
    <gravity>0 -9.80665 0</gravity>
    <BodySet>
      <Body name="forearm">
        <mass>1.5</mass>
        <mass_center>0 -0.15 0</mass_center>
        <inertia>0.02 0.002 0.02 0 0 0</inertia>
      </Body>
    </BodySet>
    <JointSet>
      <PinJoint name="elbow">
        <socket_parent_frame>ground</socket_parent_frame>
        <socket_child_frame>forearm</socket_child_frame>
        <coordinates>
          <Coordinate name="elbow_flex">
            <motion_type>rotational</motion_type>
            <default_value>0.2</default_value>
            <range>0.0 2.4</range>
            <clamped>true</clamped>
            <locked>false</locked>
          </Coordinate>
        </coordinates>
      </PinJoint>
    </JointSet>
    <ForceSet>
      <Thelen2003Muscle name="biceps">
        <max_isometric_force>800</max_isometric_force>
        <optimal_fiber_length>0.12</optimal_fiber_length>
        <tendon_slack_length>0.20</tendon_slack_length>
        <pennation_angle_at_optimal>0.1</pennation_angle_at_optimal>
        <activation_time_constant>0.01</activation_time_constant>
        <deactivation_time_constant>0.04</deactivation_time_constant>
        <max_contraction_velocity>10</max_contraction_velocity>
        <GeometryPath>
          <PathPointSet>
            <PathPoint name="p1">
              <socket_parent_frame>ground</socket_parent_frame>
              <location>0 0.25 0</location>
            </PathPoint>
            <PathPoint name="p2">
              <socket_parent_frame>forearm</socket_parent_frame>
              <location>0.04 -0.05 0</location>
            </PathPoint>
          </PathPointSet>
        </GeometryPath>
      </Thelen2003Muscle>
    </ForceSet>
  </Model>
</OpenSimDocument>
`;

describe("Hill-Type Muscle RK4 Solver & Linear-Memory DAE Lowering", () => {
  it("evaluates Hill activation, Gaussian active force-length, passive force-length, and force-velocity curves", () => {
    const daAct = computeActivationDerivative(0.1, 0.9, 0.01, 0.04);
    const daDeact = computeActivationDerivative(0.8, 0.1, 0.01, 0.04);
    assert(daAct > 0, "Excitation > activation should yield positive da/dt");
    assert(daDeact < 0, "Excitation < activation should yield negative da/dt");

    assert.strictEqual(computeActiveForceLength(1.0), 1.0);
    assert(computeActiveForceLength(0.7) < 1.0);
    assert.strictEqual(computePassiveForceLength(0.95), 0.0);
    assert(computePassiveForceLength(1.3) > 0.0);
    assert.strictEqual(computeForceVelocity(0.0), 1.0);
    assert(computeForceVelocity(-0.5) < 1.0);
    assert(computeForceVelocity(0.5) > 1.0);
  });

  it("simulates Hill-type muscle activation and coordinate trajectories via RK4", () => {
    const doc = parseOpenSim(ELBOW_FLEXION_OSIM);
    const res = simulateMuscleDynamics(doc, {
      duration: 0.2,
      dt: 0.01,
      excitations: { biceps: 0.95 },
    });

    assert.strictEqual(res.steps, 20);
    assert.strictEqual(res.time.length, 21);

    const bic = res.muscles["biceps"]!;
    assert(bic !== undefined);
    assert(bic.activation[bic.activation.length - 1]! > bic.activation[0]!);
    assert(bic.activeForce.some((f) => f > 0));

    const elbow = res.coordinates["elbow_flex"]!;
    assert(elbow !== undefined);
    assert.strictEqual(elbow.q[0], 0.2);
    assert(elbow.q.every((val) => val >= 0.0 && val <= 2.4));
  });

  it("lowers coordinates, speeds, muscle activations, fiber lengths, and Hill force balances to DAEBuilder", () => {
    const doc = parseOpenSim(ELBOW_FLEXION_OSIM);
    const dae = lowerOpenSimToDae(doc);
    assert(dae.getVarCount() >= 8);
    assert(dae.getEqCount() >= 8);
  });
});
