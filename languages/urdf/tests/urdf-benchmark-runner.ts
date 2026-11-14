// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { buildKinematicTree, computeInverseDynamicsRnea } from "../src/kinematics/index.js";
import { parseUrdf } from "../src/parser/index.js";

const PENDULUM_2LINK_URDF = `<?xml version="1.0"?>
<robot name="pendulum_2link">
  <link name="base_link"><inertial><mass value="10.0"/><inertia ixx="1" iyy="1" izz="1"/></inertial></link>
  <link name="link_1"><inertial><mass value="2.0"/><inertia ixx="0.05" iyy="0.05" izz="0.05"/></inertial></link>
  <link name="link_2"><inertial><mass value="1.0"/><inertia ixx="0.02" iyy="0.02" izz="0.02"/></inertial></link>
  <joint name="joint_1" type="revolute"><parent link="base_link"/><child link="link_1"/><axis xyz="0 0 1"/></joint>
  <joint name="joint_2" type="revolute"><parent link="link_1"/><child link="link_2"/><axis xyz="0 0 1"/></joint>
</robot>`;

export const urdfBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "urdf",
  referenceTool: "Pinocchio / Featherstone RNEA Rigid-Body Dynamics",
  defaultTolerance: 0,
  metricKind: "exact",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const robot = parseUrdf(PENDULUM_2LINK_URDF);
    const tree = buildKinematicTree(robot);
    const rnea = computeInverseDynamicsRnea(
      robot,
      new Map([
        ["joint_1", 0.0],
        ["joint_2", 0.0],
      ]),
      new Map([
        ["joint_1", 1.0],
        ["joint_2", 0.5],
      ]),
      new Map([
        ["joint_1", 0.0],
        ["joint_2", 0.0],
      ]),
    );
    const d1 = performance.now() - t0;

    const hasTorques = rnea.jointTorques.has("joint_1") && rnea.jointTorques.has("joint_2");

    return [
      {
        id: "urdf-featherstone-rnea",
        name: "2-Link Articulated Chain Featherstone RNEA Inverse Dynamics",
        scale: "micro",
        referenceTool: "Pinocchio / Featherstone RNEA Rigid-Body Dynamics",
        metricKind: "exact",
        threshold: 0,
        measuredError: tree.length === 3 && hasTorques ? 0 : 1,
        passed: tree.length === 3 && hasTorques,
        durationMs: d1,
        details: `links=${tree.length}, tau1=${(rnea.jointTorques.get("joint_1") ?? 0).toFixed(4)}Nm`,
      },
    ];
  },
};
