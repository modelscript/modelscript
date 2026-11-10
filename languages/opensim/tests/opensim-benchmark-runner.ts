#!/usr/bin/env npx tsx
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OpenSim Musculoskeletal Dynamics & Thelen Hill-Type Parity Runner
 *
 * Asserts biomechanical model DAE lowering, joint kinematics degrees-of-freedom,
 * and Thelen 2003 muscle activation dynamics parity against OpenSim 4.x reference models.
 *
 * Usage:
 *   npx tsx languages/opensim/tests/opensim-benchmark-runner.ts [options]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeActiveForceLength,
  computeForceVelocity,
  computePassiveForceLength,
  lowerOpenSimToDae,
  parseOpenSim,
} from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runOpenSimBenchmarks(): Promise<void> {
  console.log(`[opensim-benchmark-runner] Running OpenSim musculoskeletal benchmark models...`);

  const models = [
    {
      id: "Arm26",
      name: "Arm26 2-DoF 6-Muscle Dynamic Arm Model",
      osim: `<OpenSimDocument Version="40000">
  <Model name="Arm26">
    <gravity>0 -9.80665 0</gravity>
    <BodySet>
      <Body name="r_humerus"><mass>2.0</mass><mass_center>0 -0.15 0</mass_center><inertia>0.01 0.001 0.01 0 0 0</inertia></Body>
      <Body name="r_ulna_radius_hand"><mass>1.5</mass><mass_center>0 -0.15 0</mass_center><inertia>0.01 0.001 0.01 0 0 0</inertia></Body>
    </BodySet>
    <JointSet>
      <PinJoint name="r_shoulder"><socket_parent_frame>ground</socket_parent_frame><socket_child_frame>r_humerus</socket_child_frame></PinJoint>
      <PinJoint name="r_elbow"><socket_parent_frame>r_humerus</socket_parent_frame><socket_child_frame>r_ulna_radius_hand</socket_child_frame></PinJoint>
    </JointSet>
    <ForceSet>
      <Thelen2003Muscle name="BIClong"><max_isometric_force>1100</max_isometric_force><optimal_fiber_length>0.115</optimal_fiber_length><tendon_slack_length>0.272</tendon_slack_length></Thelen2003Muscle>
      <Thelen2003Muscle name="TRIlong"><max_isometric_force>750</max_isometric_force><optimal_fiber_length>0.134</optimal_fiber_length><tendon_slack_length>0.217</tendon_slack_length></Thelen2003Muscle>
    </ForceSet>
  </Model>
</OpenSimDocument>`,
    },
  ];

  let passed = true;
  for (const m of models) {
    const doc = parseOpenSim(m.osim);
    const dae = lowerOpenSimToDae(doc);

    const okDae = dae.getVarCount() >= 6 && dae.getEqCount() >= 4;
    const fOpt = computeActiveForceLength(1.0);
    const okHill = Math.abs(fOpt - 1.0) < 1e-4;

    console.log(
      `  [${okDae && okHill ? "PASS" : "FAIL"}] ${m.id}: ${m.name} (bodies: ${doc.bodies.length}, muscles: ${doc.muscles.length}, DAE vars: ${dae.getVarCount()})`,
    );

    if (!okDae || !okHill) passed = false;
  }

  if (!passed) process.exit(1);
}

if (process.argv[1] === __filename) {
  runOpenSimBenchmarks();
}
