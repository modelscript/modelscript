// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkLvsNetlistEquivalence,
  delaunayTriangulate2D,
  evaluateNurbsCurve,
  routePcbTraceAStar,
  solveFabrikIk,
} from "../src/index.js";

describe("Phase 4 & 7: Computational Geometry, FABRIK IK, EDA VF2 LVS & A* PCB Routing", () => {
  it("triangulates a unit square into 2 Delaunay triangles and evaluates a quadratic NURBS arc", () => {
    const tris = delaunayTriangulate2D([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    assert.equal(tris.length, 2);

    // Exact 90-degree circular arc as quadratic rational Bezier (weights [1, sqrt(2)/2, 1])
    const mid = evaluateNurbsCurve(
      [
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      [1, Math.SQRT1_2, 1],
      [0, 0, 0, 1, 1, 1],
      2,
      0.5,
    );
    assert.ok(Math.abs(Math.hypot(mid.x, mid.y) - 1.0) < 1e-10);
  });

  it("solves 3D serial manipulator Inverse Kinematics via FABRIK", () => {
    const ik = solveFabrikIk(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      { x: 1, y: 1, z: 0 },
    );
    assert.equal(ik.reached, true);
    assert.ok(ik.residualDistance < 1e-3);
  });

  it("verifies LVS netlist equivalence via VF2 isomorphism and routes PCB traces around obstacles", () => {
    const schematic = [
      { id: "R1", kind: "resistor", pins: ["VIN", "MID"] },
      { id: "C1", kind: "capacitor", pins: ["MID", "GND"] },
    ];
    const layoutRenamed = [
      { id: "C_lay", kind: "capacitor", pins: ["N_center", "N_gnd"] },
      { id: "R_lay", kind: "resistor", pins: ["N_in", "N_center"] },
    ];
    const lvsOk = checkLvsNetlistEquivalence(schematic, layoutRenamed);
    assert.equal(lvsOk.equivalent, true);

    const layoutBug = [
      { id: "C_lay", kind: "inductor", pins: ["N_center", "N_gnd"] },
      { id: "R_lay", kind: "resistor", pins: ["N_in", "N_center"] },
    ];
    const lvsBad = checkLvsNetlistEquivalence(schematic, layoutBug);
    assert.equal(lvsBad.equivalent, false);

    // 5x5 grid with wall at x=2, y=0..3 => must route around y=4
    const blocked = new Uint8Array(25);
    for (let y = 0; y <= 3; y++) blocked[y * 5 + 2] = 1;
    const route = routePcbTraceAStar(5, 5, { x: 0, y: 0 }, { x: 4, y: 0 }, blocked);
    assert.equal(route.routed, true);
    assert.equal(route.length, 12);
  });
});
