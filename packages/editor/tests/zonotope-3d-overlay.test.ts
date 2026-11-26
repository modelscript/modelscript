// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCadGhostShellSpecs,
  buildSymmetryCouplingPair,
  buildWamReachabilityTubeRings,
  inferWamWaypointsFromSpecs,
  type WamTrajectoryWaypoint,
} from "../src/workbench/util/zonotope-3d-geometry.js";
import {
  createInitialZonotopeWorkbenchState,
  parseLinearConstraintExpression,
} from "../src/workbench/util/zonotope-workbench-state.js";

function assertClose(actual: number, expected: number, eps = 1e-9, label?: string): void {
  assert.ok(Math.abs(actual - expected) <= eps, `${label ?? "value"}: expected ${expected}, got ${actual}`);
}

describe("zonotope-3d-geometry: buildCadGhostShellSpecs", () => {
  it("computes exact innerScale, outerScale, and probeScale interpolation at xi = -1, 0, +0.5, +1", () => {
    const components = [
      {
        name: "housing_box",
        cad: { position: [1, 2, 3] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
        sourceMetadata: { dimensions: [2, 1, 0.5] as [number, number, number], primitiveType: "box" },
      },
      {
        name: "drive_shaft",
        cad: { position: [4, 0, 0] as [number, number, number] },
        shapeType: "cylinder",
      },
      {
        name: "bearing_ball",
        cad: { position: [0, 5, 0] as [number, number, number] },
        shapeType: "sphere",
      },
    ];

    const hypergraph = {
      spans: [
        { groupId: 7, relTypeId: 6, relSign: 1, symbolName: "housing_box", text: "housing_box" },
        { groupId: 3, relTypeId: 1, relSign: 1, symbolName: "drive_shaft", text: "drive_shaft" },
      ],
    };

    const xiCases: Array<{ xi: number; expectedProbe: number }> = [
      { xi: -1, expectedProbe: 0.9 },
      { xi: 0, expectedProbe: 1.0 },
      { xi: 0.5, expectedProbe: 1.05 },
      { xi: 1, expectedProbe: 1.1 },
    ];

    for (const { xi, expectedProbe } of xiCases) {
      const state = createInitialZonotopeWorkbenchState();
      state.budgets.cadToleranceFraction = 0.05;
      state.stressScale = 2.0; // effectiveEps = 0.10
      state.xiByGroupId = { 7: xi, 3: xi };

      const specs = buildCadGhostShellSpecs(components, hypergraph, state);
      assert.equal(specs.length, 3);

      const housing = specs[0]!;
      assert.equal(housing.componentName, "housing_box");
      assert.equal(housing.groupId, 7);
      assert.equal(housing.shapeKind, "box");
      assert.deepEqual(housing.position, [1, 2, 3]);
      assert.deepEqual(housing.dimensions, [2, 1, 0.5]);
      assertClose(housing.epsilon3d, 0.1);
      assertClose(housing.xiValue, xi);

      for (let axis = 0; axis < 3; axis++) {
        assertClose(housing.innerScale[axis]!, 0.9, 1e-9, `innerScale[${axis}]`);
        assertClose(housing.outerScale[axis]!, 1.1, 1e-9, `outerScale[${axis}]`);
        assertClose(housing.probeScale[axis]!, expectedProbe, 1e-9, `probeScale[${axis}] at xi=${xi}`);
      }

      const shaft = specs[1]!;
      assert.equal(shaft.groupId, 3);
      assert.equal(shaft.shapeKind, "cylinder");

      const ball = specs[2]!;
      assert.equal(ball.groupId, 3); // deterministic 1-based fallback index i + 1 = 3
      assert.equal(ball.shapeKind, "sphere");
    }
  });

  it("clamps effectiveEps <= 0.85 and innerScale >= 0.1 under extreme stressScale", () => {
    const state = createInitialZonotopeWorkbenchState();
    state.budgets.cadToleranceFraction = 0.5;
    state.stressScale = 4.0; // raw 2.0 -> clamped to 0.85
    state.xiByGroupId = { 1: -1 };

    const specs = buildCadGhostShellSpecs([{ name: "bracket" }], null, state);
    assert.equal(specs.length, 1);
    const spec = specs[0]!;
    assertClose(spec.epsilon3d, 0.85);
    assertClose(spec.innerScale[0], 0.15);
    assertClose(spec.outerScale[0], 1.85);
    assertClose(spec.probeScale[0], 0.15);
    assert.ok(spec.innerScale[0] >= 0.1);
  });

  it("flags isViolating when component is in violatingComponentNames or breaches a linear constraint", () => {
    const state = createInitialZonotopeWorkbenchState();
    state.budgets.cadToleranceFraction = 0.1;
    state.stressScale = 1.5; // effectiveEps = 0.15
    state.xiByGroupId = { 1: -1, 2: 0 };

    const wallConstraint = parseLinearConstraintExpression("wall_thickness >= 1.9", "3d");
    assert.ok(wallConstraint);
    state.constraints = [wallConstraint];

    const components = [
      {
        name: "flange_a",
        sourceMetadata: { dimensions: [2.0, 2.0, 0.5] as [number, number, number], parameterName: "wall_thickness" },
      },
      {
        name: "flange_b",
        sourceMetadata: { dimensions: [2.0, 2.0, 0.5] as [number, number, number] },
      },
      {
        name: "flange_c",
        sourceMetadata: { dimensions: [2.0, 2.0, 0.5] as [number, number, number] },
      },
    ];

    // flange_a nominal=2.0 * innerFactor=0.85 => 1.7 < 1.9 (constraint violation)
    // flange_b is explicitly flagged in violatingComponentNames
    // flange_c is healthy
    const specs = buildCadGhostShellSpecs(components, null, state, new Set(["flange_b"]));
    assert.equal(specs[0]!.isViolating, true);
    assert.ok(specs[0]!.violationReason?.includes("wall_thickness >= 1.9"));

    assert.equal(specs[1]!.isViolating, true);
    assert.ok(specs[1]!.violationReason);

    assert.equal(specs[2]!.isViolating, false);
    assert.equal(specs[2]!.violationReason, undefined);
  });

  it("locks component tolerances to zero when a groupId=0 pending override is present", () => {
    const state = createInitialZonotopeWorkbenchState();
    state.budgets.cadToleranceFraction = 0.08;
    state.stressScale = 2.0;
    state.pendingOverrides = [
      {
        id: "lock-base",
        symbolName: "datum_plate",
        groupId: 0,
        relTypeId: 0,
        relSign: 0,
        modality: "3d",
      },
    ];

    const specs = buildCadGhostShellSpecs([{ name: "datum_plate" }], null, state);
    assert.equal(specs[0]!.groupId, 0);
    assertClose(specs[0]!.epsilon3d, 0);
    assert.deepEqual(specs[0]!.innerScale, [1, 1, 1]);
    assert.deepEqual(specs[0]!.outerScale, [1, 1, 1]);
    assert.deepEqual(specs[0]!.probeScale, [1, 1, 1]);
  });
});

describe("zonotope-3d-geometry: buildSymmetryCouplingPair", () => {
  it("emits matching +1 signs for positive symmetry coupling without caliper constraint", () => {
    const result = buildSymmetryCouplingPair("left_strut", "right_strut", 1, 4);

    assert.equal(result.overrides.length, 2);
    assert.equal(result.clearanceConstraint, undefined);

    const [ovA, ovB] = result.overrides;
    assert.equal(ovA!.symbolName, "left_strut");
    assert.equal(ovA!.groupId, 4);
    assert.equal(ovA!.relTypeId, 1);
    assert.equal(ovA!.relSign, 1);
    assert.equal(ovA!.modality, "3d");

    assert.equal(ovB!.symbolName, "right_strut");
    assert.equal(ovB!.groupId, 4);
    assert.equal(ovB!.relTypeId, 1);
    assert.equal(ovB!.relSign, 1);
    assert.equal(ovB!.modality, "3d");
  });

  it("emits opposite signs for -1 mirrored symmetry plus clearance caliper constraint", () => {
    const result = buildSymmetryCouplingPair("left_flap", "right_flap", -1, 5, { minGap: 1.25 });

    assert.equal(result.overrides.length, 2);
    const [ovA, ovB] = result.overrides;
    assert.equal(ovA!.symbolName, "left_flap");
    assert.equal(ovA!.relSign, 1);
    assert.equal(ovA!.relTypeId, 1);
    assert.equal(ovA!.groupId, 5);
    assert.equal(ovA!.modality, "3d");

    assert.equal(ovB!.symbolName, "right_flap");
    assert.equal(ovB!.relSign, -1);
    assert.equal(ovB!.relTypeId, 2);
    assert.equal(ovB!.groupId, 5);
    assert.equal(ovB!.modality, "3d");

    assert.ok(result.clearanceConstraint);
    assert.equal(result.clearanceConstraint.sense, ">=");
    assertClose(result.clearanceConstraint.rhs, 1.25);
    assert.equal(result.clearanceConstraint.modality, "3d");
    assert.deepEqual(result.clearanceConstraint.coeffs, { left_flap: 1, right_flap: -1 });
    assert.equal(result.clearanceConstraint.expression, "left_flap - right_flap >= 1.25");
  });
});

describe("zonotope-3d-geometry: buildWamReachabilityTubeRings", () => {
  it("builds valid finite vertices and triangle indices scaled by stressScale", () => {
    const waypoints: WamTrajectoryWaypoint[] = [
      { position: [0, 0, 0], radius: 0.2, groupId: 1 },
      { position: [1, 0.5, 0], radius: 0.25, groupId: 2 },
      { position: [2, 1.0, 0.8], radius: 0.3, groupId: 3 },
      { position: [2.5, 2.0, 1.2], radius: 0.18, groupId: 4 },
    ];

    const radialSegments = 12;
    const baseTube = buildWamReachabilityTubeRings(waypoints, 1.0, radialSegments);
    const stressedTube = buildWamReachabilityTubeRings(waypoints, 2.0, radialSegments);
    const clampedTube = buildWamReachabilityTubeRings(waypoints, 0.02, radialSegments);

    const expectedVertexCount = waypoints.length * radialSegments;
    const expectedIndexCount = (waypoints.length - 1) * radialSegments * 6;

    assert.equal(baseTube.centers.length, waypoints.length);
    assert.equal(baseTube.radii.length, waypoints.length);
    assert.equal(baseTube.vertices.length, expectedVertexCount * 3);
    assert.equal(baseTube.indices.length, expectedIndexCount);

    // Verify all vertices are finite and every vertex lies at the expected radial distance from its ring center
    for (let i = 0; i < waypoints.length; i++) {
      assertClose(baseTube.radii[i]!, waypoints[i]!.radius, 1e-9);
      assertClose(stressedTube.radii[i]!, waypoints[i]!.radius * 2.0, 1e-9);
      assertClose(clampedTube.radii[i]!, waypoints[i]!.radius * 0.15, 1e-9);

      const cx = baseTube.centers[i]![0];
      const cy = baseTube.centers[i]![1];
      const cz = baseTube.centers[i]![2];
      for (let j = 0; j < radialSegments; j++) {
        const vIdx = (i * radialSegments + j) * 3;
        const vx = stressedTube.vertices[vIdx]!;
        const vy = stressedTube.vertices[vIdx + 1]!;
        const vz = stressedTube.vertices[vIdx + 2]!;
        assert.ok(Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz));
        const dist = Math.hypot(vx - cx, vy - cy, vz - cz);
        assertClose(dist, stressedTube.radii[i]!, 1e-6, `ring ${i} vertex ${j} radius`);
      }
    }

    // Verify all triangle indices are valid integer vertex indices
    for (const idx of baseTube.indices) {
      assert.ok(Number.isInteger(idx));
      assert.ok(idx >= 0 && idx < expectedVertexCount, `index ${idx} out of range`);
    }
  });

  it("returns empty geometry when fewer than 2 waypoints are provided and infers robotics waypoints", () => {
    const empty = buildWamReachabilityTubeRings([{ position: [0, 0, 0], radius: 0.2, groupId: 1 }], 1.0);
    assert.equal(empty.vertices.length, 0);
    assert.equal(empty.indices.length, 0);

    const state = createInitialZonotopeWorkbenchState();
    const specs = buildCadGhostShellSpecs(
      [
        { name: "base_link", cad: { position: [0, 0, 0] } },
        { name: "shoulder_joint", cad: { position: [0, 1, 0] } },
        { name: "wrist_effector", cad: { position: [1, 1.5, 0] } },
      ],
      null,
      state,
    );
    const inferred = inferWamWaypointsFromSpecs(specs);
    assert.equal(inferred.length, 3);
    assert.deepEqual(inferred[0]!.position, [0, 0, 0]);
    assert.deepEqual(inferred[2]!.position, [1, 1.5, 0]);
  });
});
