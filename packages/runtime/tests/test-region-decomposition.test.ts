// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RegionDecomposer, type NonlinearConstraint, type RegionBranchInput } from "../src/formal/region_decomposer.js";

describe("Native Symbolic Region Decomposition Engine (Imandra Parity)", () => {
  it("decomposes 1D continuous state space into mutually disjoint, exhaustive regions", () => {
    // Branch condition: x <= 0
    const condition: NonlinearConstraint = {
      expr: { kind: "var", name: "x" },
      rel: "<=",
      rhs: 0,
    };

    const res = RegionDecomposer.decompose([condition], {
      domainBounds: new Map([["x", [-100, 100]]]),
    });

    assert.strictEqual(res.totalRegions, 2, "Should partition into exactly 2 regions (x <= 0 and x > 0)");
    assert.strictEqual(res.isDisjoint, true, "Regions must be mutually disjoint");
    assert.strictEqual(res.isExhaustive, true, "Regions must be exhaustive");

    const r1 = res.regions[0]!;
    const r2 = res.regions[1]!;

    // r1 should be in negative domain, r2 in positive domain
    assert.ok(r1.interiorWitness["x"]! <= 0.05, `r1 witness ${r1.interiorWitness["x"]} should be <= 0`);
    assert.ok(r2.interiorWitness["x"]! >= -0.05, `r2 witness ${r2.interiorWitness["x"]} should be >= 0`);

    // Frontier edge should connect r1 and r2 across x <= 0
    assert.strictEqual(res.frontierEdges.length, 1, "Should discover 1 shared frontier boundary");
    const edge = res.frontierEdges[0]!;
    assert.strictEqual(edge.sourceRegion, r1.id);
    assert.strictEqual(edge.targetRegion, r2.id);
    assert.ok(edge.sharedFacet.includes("x"), "Shared facet should mention variable x");
  });

  it("decomposes multi-variable 2D state space into quadrant regions", () => {
    // Conditions: x <= 50, y <= 30
    const conditions: NonlinearConstraint[] = [
      { expr: { kind: "var", name: "x" }, rel: "<=", rhs: 50 },
      { expr: { kind: "var", name: "y" }, rel: "<=", rhs: 30 },
    ];

    const res = RegionDecomposer.decompose(conditions, {
      domainBounds: new Map([
        ["x", [0, 100]],
        ["y", [0, 60]],
      ]),
    });

    assert.strictEqual(res.totalRegions, 4, "Should partition 2D domain into 4 disjoint regions");
    assert.strictEqual(res.isDisjoint, true);
    assert.strictEqual(res.isExhaustive, true);

    // Each region should have valid 2D interior witness
    for (const r of res.regions) {
      assert.ok(r.interiorWitness["x"] !== undefined);
      assert.ok(r.interiorWitness["y"] !== undefined);
      assert.ok(r.interiorWitness["x"] >= 0 && r.interiorWitness["x"] <= 100);
      assert.ok(r.interiorWitness["y"] >= 0 && r.interiorWitness["y"] <= 60);
    }

    // Should discover adjacent frontier boundaries
    assert.ok(res.frontierEdges.length >= 2, "Should discover multiple frontier boundaries");
  });

  it("decomposes piecewise branches and prunes contradictory dead paths", () => {
    const branches: RegionBranchInput[] = [
      {
        id: "r_idle",
        constraints: [{ expr: { kind: "var", name: "speed" }, rel: "<=", rhs: 5 }],
        terminalValue: "idle_mode",
      },
      {
        id: "r_cruise",
        constraints: [
          { expr: { kind: "var", name: "speed" }, rel: ">=", rhs: 5 },
          { expr: { kind: "var", name: "speed" }, rel: "<=", rhs: 80 },
        ],
        terminalValue: "cruise_mode",
      },
      {
        id: "r_boost",
        constraints: [{ expr: { kind: "var", name: "speed" }, rel: ">=", rhs: 80 }],
        terminalValue: "boost_mode",
      },
      {
        id: "r_dead",
        constraints: [
          { expr: { kind: "var", name: "speed" }, rel: ">=", rhs: 120 },
          { expr: { kind: "var", name: "speed" }, rel: "<=", rhs: 20 }, // UNSAT: contradiction!
        ],
        terminalValue: "dead_mode",
      },
    ];

    const res = RegionDecomposer.decomposeBranches(branches, {
      domainBounds: new Map([["speed", [0, 150]]]),
    });

    // Dead branch should be pruned
    assert.strictEqual(res.totalRegions, 3, "Should retain 3 valid regions and prune the dead branch");
    assert.ok(!res.regions.some((r) => r.id === "r_dead"), "Dead region must be pruned");

    const idle = res.regions.find((r) => r.id === "r_idle")!;
    assert.strictEqual(idle.terminalValue, "idle_mode");
    assert.ok(idle.interiorWitness["speed"]! <= 5.01);

    const boost = res.regions.find((r) => r.id === "r_boost")!;
    assert.strictEqual(boost.terminalValue, "boost_mode");
    assert.ok(boost.interiorWitness["speed"]! >= 79.99);
  });
});
