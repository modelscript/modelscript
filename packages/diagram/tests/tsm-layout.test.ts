// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyTsmOrthogonalLayout } from "../src/tsm-layout.js";

describe("Native Topology-Shape-Metrics (TSM) Orthogonal Layout Engine", () => {
  it("should handle empty and single-node graphs gracefully", () => {
    const emptyResult = applyTsmOrthogonalLayout({ nodes: [], edges: [] });
    assert.deepStrictEqual(emptyResult, { nodes: [], edges: [] });

    const singleNode = [{ id: "n1", width: 100, height: 60 }];
    const singleResult = applyTsmOrthogonalLayout({ nodes: singleNode, edges: [] });
    assert.strictEqual(singleResult.nodes.length, 1);
    assert.strictEqual(singleResult.nodes[0].id, "n1");
    assert.strictEqual(typeof singleResult.nodes[0].x, "number");
    assert.strictEqual(typeof singleResult.nodes[0].y, "number");
  });

  it("should arrange connected nodes on an orthogonal grid without overlaps", () => {
    const nodes = [
      { id: "sensor", width: 100, height: 50 },
      { id: "controller", width: 120, height: 60 },
      { id: "actuator", width: 100, height: 50 },
    ];
    const edges = [
      { source: "sensor", target: "controller" },
      { source: "controller", target: "actuator" },
    ];

    const result = applyTsmOrthogonalLayout({ nodes, edges }, { defaultDirection: "LR" });
    assert.strictEqual(result.nodes.length, 3);

    const s = result.nodes.find((n) => n.id === "sensor")!;
    const c = result.nodes.find((n) => n.id === "controller")!;
    const a = result.nodes.find((n) => n.id === "actuator")!;

    // In LR direction, sensor should be to the left of controller, and controller to the left of actuator
    assert.ok(s.x! < c.x!, `Expected sensor.x (${s.x}) < controller.x (${c.x})`);
    assert.ok(c.x! < a.x!, `Expected controller.x (${c.x}) < actuator.x (${a.x})`);

    // Verify no bounding box overlaps between any pair of nodes
    for (let i = 0; i < result.nodes.length; i++) {
      for (let j = i + 1; j < result.nodes.length; j++) {
        const n1 = result.nodes[i];
        const n2 = result.nodes[j];
        const overlapX = n1.x! < n2.x! + n2.width && n1.x! + n1.width > n2.x!;
        const overlapY = n1.y! < n2.y! + n2.height && n1.y! + n1.height > n2.y!;
        assert.ok(!(overlapX && overlapY), `Nodes ${n1.id} and ${n2.id} overlap!`);
      }
    }
  });

  it("should handle cyclic graphs without infinite loops", () => {
    const nodes = [
      { id: "A", width: 80, height: 40 },
      { id: "B", width: 80, height: 40 },
      { id: "C", width: 80, height: 40 },
    ];
    // Feedback loop: A -> B -> C -> A
    const edges = [
      { source: "A", target: "B" },
      { source: "B", target: "C" },
      { source: "C", target: "A" },
    ];

    const result = applyTsmOrthogonalLayout({ nodes, edges });
    assert.strictEqual(result.nodes.length, 3);
    for (const node of result.nodes) {
      assert.ok(Number.isFinite(node.x));
      assert.ok(Number.isFinite(node.y));
    }
  });

  it("should compute orthogonal waypoints for edges requiring bends", () => {
    const nodes = [
      { id: "src", width: 80, height: 40 },
      { id: "dst1", width: 80, height: 40 },
      { id: "dst2", width: 80, height: 40 },
    ];
    const edges = [
      { source: "src", target: "dst1" },
      { source: "src", target: "dst2" },
    ];

    const result = applyTsmOrthogonalLayout({ nodes, edges });
    assert.strictEqual(result.edges.length, 2);
    for (const edge of result.edges) {
      assert.ok(Array.isArray(edge.vertices));
      for (const pt of edge.vertices!) {
        assert.ok(Number.isFinite(pt.x));
        assert.ok(Number.isFinite(pt.y));
      }
    }
  });
});
