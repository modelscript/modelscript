// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateLayoutDeltas,
  computeIncrementalStabilization,
  expandContainerQuadrant,
  type ContainerExpansion,
  type NodePosition,
} from "../src/incremental-layout.js";

describe("Incremental Layout & Anchor Stabilization Engine", () => {
  it("should preserve coordinates of existing nodes when adding a new node", () => {
    const existing: NodePosition[] = [
      { id: "A", x: 100, y: 100, width: 80, height: 40 },
      { id: "B", x: 300, y: 100, width: 80, height: 40 },
    ];

    // Incoming includes A, B, and a new node C connected to B
    const incoming: NodePosition[] = [
      { id: "A", x: 0, y: 0, width: 80, height: 40 },
      { id: "B", x: 0, y: 0, width: 80, height: 40 },
      { id: "C", x: 0, y: 0, width: 80, height: 40 },
    ];

    const edges = [{ source: "B", target: "C" }];

    const result = computeIncrementalStabilization(existing, incoming, edges);
    assert.strictEqual(result.length, 3);

    const resA = result.find((n) => n.id === "A")!;
    const resB = result.find((n) => n.id === "B")!;
    const resC = result.find((n) => n.id === "C")!;

    // Existing nodes A and B must remain at or near their original coordinates
    assert.strictEqual(resA.x, 100);
    assert.strictEqual(resA.y, 100);
    assert.strictEqual(resB.x, 300);
    assert.strictEqual(resB.y, 100);

    // New node C should be placed without overlapping A or B
    assert.ok(resC.x > 300, `Expected C.x (${resC.x}) to be placed to the right of B`);
  });

  it("should shift right-quadrant and bottom-quadrant nodes when expanding a container", () => {
    const nodes: NodePosition[] = [
      { id: "container", x: 100, y: 100, width: 200, height: 150 },
      { id: "child", x: 120, y: 140, width: 80, height: 40, parent: "container" },
      { id: "rightNeighbor", x: 350, y: 120, width: 80, height: 40 },
      { id: "bottomNeighbor", x: 150, y: 280, width: 80, height: 40 },
      { id: "leftStationary", x: 10, y: 120, width: 60, height: 40 },
    ];

    const expansion: ContainerExpansion = {
      id: "container",
      x: 100,
      y: 100,
      oldWidth: 200,
      oldHeight: 150,
      newWidth: 260, // +60px
      newHeight: 200, // +50px
    };

    const shifted = expandContainerQuadrant(nodes, expansion);

    const right = shifted.find((n) => n.id === "rightNeighbor")!;
    const bottom = shifted.find((n) => n.id === "bottomNeighbor")!;
    const left = shifted.find((n) => n.id === "leftStationary")!;

    // Right neighbor should shift +60px
    assert.strictEqual(right.x, 350 + 60);
    assert.strictEqual(right.y, 120);

    // Bottom neighbor should shift +50px
    assert.strictEqual(bottom.x, 150);
    assert.strictEqual(bottom.y, 280 + 50);

    // Left neighbor must remain stationary
    assert.strictEqual(left.x, 10);
    assert.strictEqual(left.y, 120);
  });

  it("should compute vector displacement deltas for transitions", () => {
    const source = [
      { id: "A", x: 100, y: 100 },
      { id: "B", x: 200, y: 200 },
    ];
    const target = [
      { id: "A", x: 100, y: 100 },
      { id: "B", x: 250, y: 210 },
    ];

    const deltas = calculateLayoutDeltas(source, target);
    assert.strictEqual(deltas.length, 2);

    const deltaA = deltas.find((d) => d.id === "A")!;
    const deltaB = deltas.find((d) => d.id === "B")!;

    assert.strictEqual(deltaA.dx, 0);
    assert.strictEqual(deltaA.dy, 0);

    assert.strictEqual(deltaB.dx, 50);
    assert.strictEqual(deltaB.dy, 10);
  });
});
