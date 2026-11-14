// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import {
  computeMarkerGlobalPosition,
  evaluateJointResidual,
  rotationMatrixTaitBryan,
} from "../src/kinematics/adams-kinematics.js";
import { parseAdams } from "../src/parser/adams-parser.js";
import type { Vector3D } from "../src/types.js";

export const adamsBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "adams",
  referenceTool: "MSC Adams / Analytical 3D Rigid-Body Kinematics",
  defaultTolerance: 1e-9,
  metricKind: "residual",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const deck = `
PART/1, GROUND
PART/2, MASS=1.0, IP=0.1, 0.1, 0.1
MARKER/1, PART=1, QP=0.0, 0.0, 0.0
MARKER/2, PART=2, QP=0.0, 0.0, 0.0
JOINT/1, SPHERICAL, I=1, J=2
`;
    const dataset = parseAdams(deck);
    const joint = dataset.joints.get(1);
    const partPositions = new Map<string | number, Vector3D>([
      [1, { x: 0, y: 0, z: 0 }],
      [2, { x: 0, y: 0, z: 0 }],
    ]);
    const residual = joint ? evaluateJointResidual(joint, dataset, partPositions, new Map()) : [1, 1, 1];
    const maxRes = Math.max(...residual.map((v) => Math.abs(v)));
    const d1 = performance.now() - t0;

    const t1 = performance.now();
    const marker = {
      id: 1,
      name: "marker_1",
      partId: 2,
      position: { x: 0.5, y: 0.0, z: 0.0 },
      orientation: { x: 0, y: 0, z: 0 },
      useEuler: false,
    };
    const glob = computeMarkerGlobalPosition(
      marker,
      { x: 10.0, y: 5.0, z: 2.0 },
      rotationMatrixTaitBryan(0, 0, Math.PI / 2),
    );
    const err2 = Math.max(Math.abs(glob.x - 10.0), Math.abs(glob.y - 5.5), Math.abs(glob.z - 2.0));
    const d2 = performance.now() - t1;

    return [
      {
        id: "adams-spherical-joint-residual",
        name: "Spherical Joint Kinematic Constraint Residual",
        scale: "micro",
        referenceTool: "MSC Adams / Analytical 3D Rigid-Body Kinematics",
        metricKind: "residual",
        threshold: 1e-9,
        measuredError: maxRes,
        passed: Boolean(joint) && maxRes < 1e-9,
        durationMs: d1,
        details: `max|Phi|=${maxRes.toExponential(2)}`,
      },
      {
        id: "adams-marker-se3-transform",
        name: "Tait-Bryan 1-2-3 Marker Global SE(3) Transform",
        scale: "micro",
        referenceTool: "MSC Adams / Analytical 3D Rigid-Body Kinematics",
        metricKind: "residual",
        threshold: 1e-9,
        measuredError: err2,
        passed: err2 < 1e-9,
        durationMs: d2,
        details: `glob=(${glob.x.toFixed(2)}, ${glob.y.toFixed(2)}, ${glob.z.toFixed(2)})`,
      },
    ];
  },
};
