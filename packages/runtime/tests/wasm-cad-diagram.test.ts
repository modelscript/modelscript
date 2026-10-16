// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CdclSatSolver } from "../src/formal/cdcl_sat.js";
import {
  alignPorts1DWasm,
  bspSplitPolygonWasm,
  compactTsm1DWasm,
  computeAabbDistanceWasm,
  computeEcadPointToPolygonDistWasm,
  computeEcadTracePairMinClearanceWasm,
  computeMeshPairMinClearanceWasm,
  computeTriTriMinDistanceSqWasm,
  getDefaultWasmExports,
  multiplyMat4Wasm,
  raycastBvhWasm,
  routeOrthogonalAStarWasm,
  SdpSolver,
  StateKind,
  WasmRtcStateMachine,
} from "../src/index.js";

describe("Native WebAssembly CAD (BSP/BVH/Clearance) & Diagram (Orthogonal A*) Kernels", () => {
  it("exports all CAD, Diagram, FEA, and Advanced Solver WASM entry points from release.wasm", () => {
    const wasm = getDefaultWasmExports();
    assert.ok(wasm, "WASM exports should be loaded");
    assert.equal(typeof wasm.cad_aabb_distance, "function");
    assert.equal(typeof wasm.cad_bvh_raycast, "function");
    assert.equal(typeof wasm.cad_tri_tri_min_distance_sq, "function");
    assert.equal(typeof wasm.cad_mesh_pair_min_clearance, "function");
    assert.equal(typeof wasm.cad_bsp_split_polygon, "function");
    assert.equal(typeof wasm.ecad_drc_trace_pair_min_clearance, "function");
    assert.equal(typeof wasm.ecad_drc_point_to_polygon_dist, "function");
    assert.equal(typeof wasm.scad_multiply_mat4, "function");
    assert.equal(typeof wasm.diagram_route_orthogonal_astar, "function");
    assert.equal(typeof wasm.diagram_tsm_compact_1d, "function");
    assert.equal(typeof wasm.diagram_port_align_1d, "function");
    assert.equal(typeof wasm.fea_compute_tet10_stiffness, "function");
    assert.equal(typeof wasm.fea_compute_corotational_rotation, "function");
    assert.equal(typeof wasm.fea_analyze_tet_mesh_quality, "function");
    assert.equal(typeof wasm.sdp_project_psd_cone, "function");
    assert.equal(typeof wasm.ukf_cholesky, "function");
    assert.equal(typeof wasm.ukf_generate_sigma_points, "function");
    assert.equal(typeof wasm.dde_hermite_interpolate, "function");
    assert.equal(typeof wasm.sde_euler_maruyama_step, "function");
    assert.equal(typeof wasm.statemachine_find_lca, "function");
    assert.equal(typeof wasm.fuml_step_petri_tokens, "function");
  });

  it("computes exact 3D AABB separation and penetration depth in WASM", () => {
    // Separated by 5 units along X
    const dSep = computeAabbDistanceWasm([0, 0, 0], [10, 10, 10], [15, 0, 0], [25, 10, 10]);
    assert.ok(Math.abs(dSep - 5.0) < 1e-9);

    // Overlapping by 3 units along Y
    const dPen = computeAabbDistanceWasm([0, 0, 0], [10, 10, 10], [0, 7, 0], [10, 17, 10]);
    assert.ok(Math.abs(dPen - -3.0) < 1e-9);
  });

  it("executes slab-method AABB raycasting in WASM", () => {
    // 2 boxes: [0,0,10..2,2,12] (id=10), [0,0,50..2,2,52] (id=20)
    const aabbs = new Float64Array([0, 0, 10, 2, 2, 12, 0, 0, 50, 2, 2, 52]);
    const ids = new Int32Array([10, 20]);

    const hit = raycastBvhWasm(aabbs, ids, [1, 1, 0], [0, 0, 1], 100);
    assert.ok(hit !== null);
    assert.equal(hit.id, 10);
    assert.ok(Math.abs(hit.distance - 10.0) < 1e-9);
    assert.deepEqual(hit.point, [1, 1, 10]);

    const miss = raycastBvhWasm(aabbs, ids, [1, 1, 0], [0, 0, -1], 100);
    assert.equal(miss, null);
  });

  it("computes triangle-triangle and mesh-pair minimum clearance in WASM", () => {
    const triA = new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const triB = new Float64Array([0, 0, 4, 1, 0, 4, 0, 1, 4]);
    const dSq = computeTriTriMinDistanceSqWasm(triA, triB);
    assert.ok(Math.abs(dSq - 16.0) < 1e-9);

    const clearance = computeMeshPairMinClearanceWasm(triA, triB, 0.0);
    assert.ok(Math.abs(clearance - 4.0) < 1e-9);
  });

  it("splits spanning 3D polygons across a BSP plane in WASM", () => {
    // Unit quad in XY plane (x in [-1, 1], y in [-1, 1], z=0) split by plane x = 0 (normal = [1,0,0], w = 0)
    const verts = new Float64Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    const split = bspSplitPolygonWasm(verts, [1, 0, 0], 0);
    assert.equal(split.classification, 3); // SPANNING
    assert.equal(split.front.length / 3, 4);
    assert.equal(split.back.length / 3, 4);
  });

  it("routes obstacle-avoiding orthogonal paths with binary-heap A* in WASM", () => {
    const cols = 10;
    const rows = 10;
    const grid = new Uint8Array(cols * rows);
    // Block vertical column x=5 for y=2..7
    for (let y = 2; y <= 7; y++) {
      grid[y * cols + 5] = 1;
    }

    const waypoints = routeOrthogonalAStarWasm({
      cols,
      rows,
      startX: 1,
      startY: 5,
      endX: 8,
      endY: 5,
      grid,
    });
    assert.ok(waypoints.length >= 4, `Expected detour with >= 4 waypoints, got ${waypoints.length}`);
    assert.deepEqual(waypoints[0], [1, 5]);
    assert.deepEqual(waypoints[waypoints.length - 1], [8, 5]);

    // Verify all segments are strictly orthogonal
    for (let i = 0; i < waypoints.length - 1; i++) {
      const dx = Math.abs(waypoints[i + 1]![0] - waypoints[i]![0]);
      const dy = Math.abs(waypoints[i + 1]![1] - waypoints[i]![1]);
      assert.ok(dx === 0 || dy === 0, "Segment must be strictly horizontal or vertical");
    }
  });

  it("evaluates ECAD 2D trace-to-trace and point-to-polygon clearance, SCAD mat4, TSM 1D compaction, and port alignment in WASM", () => {
    // Parallel horizontal traces y=0 and y=2.0 with widths 0.4 and 0.6 -> edge clearance = 2.0 - 0.5*(0.4+0.6) = 1.5
    const t1 = new Float64Array([0, 0, 10, 0]);
    const t2 = new Float64Array([0, 2, 10, 2]);
    const clr = computeEcadTracePairMinClearanceWasm(t1, 0.4, t2, 0.6);
    assert.ok(Math.abs(clr - 1.5) < 1e-9);

    // Point (5,5) inside [0,0..10,10] square -> 0; point (12,5) outside -> 2
    const poly = new Float64Array([0, 0, 10, 0, 10, 10, 0, 10]);
    assert.equal(computeEcadPointToPolygonDistWasm(5, 5, poly), 0.0);
    assert.ok(Math.abs(computeEcadPointToPolygonDistWasm(12, 5, poly) - 2.0) < 1e-9);

    // 4x4 affine matrix multiplication
    const mA = new Float64Array([1, 0, 0, 3, 0, 1, 0, 4, 0, 0, 1, 5, 0, 0, 0, 1]);
    const mB = new Float64Array([2, 0, 0, 1, 0, 2, 0, 2, 0, 0, 2, 3, 0, 0, 0, 1]);
    const mC = multiplyMat4Wasm(mA, mB);
    assert.equal(mC[3], 4); // 1*1 + 3*1
    assert.equal(mC[7], 6); // 1*2 + 4*1
    assert.equal(mC[11], 8); // 1*3 + 5*1

    // TSM 1D coordinate compaction
    const { compacted, span } = compactTsm1DWasm(new Int32Array([20, 5, 20, 100]));
    assert.equal(span, 3);
    assert.deepEqual(Array.from(compacted), [1, 0, 1, 2]);

    // 1D port alignment with minSpacing=10 in [10, 90]
    const aligned = alignPorts1DWasm(new Float64Array([48, 50, 52]), 10, 10, 90);
    assert.ok(aligned[1]! - aligned[0]! >= 10 - 1e-9);
    assert.ok(aligned[2]! - aligned[1]! >= 10 - 1e-9);

    // SDP PSD cone projection in WASM
    const proj = SdpSolver.projectPsdCone(
      [
        [2, 0],
        [0, -1],
      ],
      0.0,
    );
    assert.ok(Math.abs(proj[0]![0]! - 2.0) < 1e-9);
    assert.ok(Math.abs(proj[1]![1]! - 0.0) < 1e-9);

    // CDCL SAT solver in WASM
    const sat = new CdclSatSolver();
    sat.addClause([1, 2]);
    sat.addClause([-1, 2]);
    const satRes = sat.solve();
    assert.equal(satRes.status, "SAT");
    assert.equal(satRes.model?.get(2), true);

    // StateMachine LCA in WASM
    const sm = new WasmRtcStateMachine();
    const topInit = sm.addState("TopInit", StateKind.Initial);
    const root = sm.addState("Root", StateKind.Composite);
    const sA = sm.addState("A", StateKind.Simple, { parentId: root });
    const sB = sm.addState("B", StateKind.Simple, { parentId: root });
    const sInit = sm.addState("Init", StateKind.Initial, { parentId: root });
    sm.addTransition(topInit, root);
    sm.addTransition(sInit, sA);
    sm.addTransition(sA, sB, { trigger: "go" });
    sm.init();
    sm.postEvent("go");
    const stepRes = sm.step();
    assert.ok(stepRes.activeStateNames.includes("B"));
  });
});
