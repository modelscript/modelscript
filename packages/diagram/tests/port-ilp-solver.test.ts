// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { solvePortPlacements, type SolverEdge, type SolverNode } from "../src/port-ilp-solver.js";

describe("Global Port Constraint ILP Solver", () => {
  it("should assign ports to facing boundary sectors based on peer node geometry", () => {
    // Node A is to the left of Node B
    const nodes: SolverNode[] = [
      {
        id: "nodeA",
        x: 100,
        y: 100,
        width: 120,
        height: 80,
        ports: [{ id: "pA", nodeId: "nodeA" }],
      },
      {
        id: "nodeB",
        x: 400,
        y: 100,
        width: 120,
        height: 80,
        ports: [{ id: "pB", nodeId: "nodeB" }],
      },
    ];

    const edges: SolverEdge[] = [
      { sourceNodeId: "nodeA", sourcePortId: "pA", targetNodeId: "nodeB", targetPortId: "pB" },
    ];

    const result = solvePortPlacements(nodes, edges);

    const placeA = result.get("pA")!;
    const placeB = result.get("pB")!;

    assert.strictEqual(placeA.side, "right", "Port A should be assigned to right face");
    assert.strictEqual(placeB.side, "left", "Port B should be assigned to left face");
    assert.strictEqual(placeA.x, 100 + 120);
    assert.strictEqual(placeB.x, 400);
  });

  it("should enforce hard fixedSide constraints over geometric sectors", () => {
    // Node A is left of Node B, but pA explicitly has fixedSide: 'left'
    const nodes: SolverNode[] = [
      {
        id: "nodeA",
        x: 100,
        y: 100,
        width: 120,
        height: 80,
        ports: [{ id: "pA", nodeId: "nodeA", fixedSide: "left" }],
      },
      {
        id: "nodeB",
        x: 400,
        y: 100,
        width: 120,
        height: 80,
        ports: [{ id: "pB", nodeId: "nodeB" }],
      },
    ];

    const edges: SolverEdge[] = [
      { sourceNodeId: "nodeA", sourcePortId: "pA", targetNodeId: "nodeB", targetPortId: "pB" },
    ];

    const result = solvePortPlacements(nodes, edges);

    const placeA = result.get("pA")!;
    assert.strictEqual(placeA.side, "left", "Fixed side must be preserved");
    assert.strictEqual(placeA.x, 100);
  });

  it("should achieve collinear 0-bend alignment for horizontally adjacent blocks", () => {
    // Blocks A and B are side-by-side with slight vertical offset
    const nodes: SolverNode[] = [
      {
        id: "nodeA",
        x: 100,
        y: 100,
        width: 120,
        height: 100,
        ports: [{ id: "pA", nodeId: "nodeA" }],
      },
      {
        id: "nodeB",
        x: 400,
        y: 104, // 4px offset, well within default 8px snap tolerance
        width: 120,
        height: 100,
        ports: [{ id: "pB", nodeId: "nodeB" }],
      },
    ];

    const edges: SolverEdge[] = [
      { sourceNodeId: "nodeA", sourcePortId: "pA", targetNodeId: "nodeB", targetPortId: "pB" },
    ];

    const result = solvePortPlacements(nodes, edges);

    const placeA = result.get("pA")!;
    const placeB = result.get("pB")!;

    // Connected ports must snap to exact identical Y coordinates for a 0-bend horizontal connection
    assert.strictEqual(placeA.y, placeB.y, `Expected identical Y coordinates: ${placeA.y} vs ${placeB.y}`);
  });

  it("should re-order ports on a face to eliminate crossings", () => {
    // Node A (top-left) connected to Node B (top-right) and Node C (bottom-right)
    // Connections:
    //   pA1 -> connected to lower Node C (y=300)
    //   pA2 -> connected to upper Node B (y=100)
    // If unordered, pA1 and pA2 would cross each other.
    const nodes: SolverNode[] = [
      {
        id: "nodeA",
        x: 100,
        y: 100,
        width: 120,
        height: 200,
        ports: [
          { id: "pA1", nodeId: "nodeA" },
          { id: "pA2", nodeId: "nodeA" },
        ],
      },
      {
        id: "nodeB",
        x: 400,
        y: 80,
        width: 100,
        height: 60,
        ports: [{ id: "pB", nodeId: "nodeB" }],
      },
      {
        id: "nodeC",
        x: 400,
        y: 240,
        width: 100,
        height: 60,
        ports: [{ id: "pC", nodeId: "nodeC" }],
      },
    ];

    const edges: SolverEdge[] = [
      { sourceNodeId: "nodeA", sourcePortId: "pA1", targetNodeId: "nodeC", targetPortId: "pC" },
      { sourceNodeId: "nodeA", sourcePortId: "pA2", targetNodeId: "nodeB", targetPortId: "pB" },
    ];

    const result = solvePortPlacements(nodes, edges);

    const placeA1 = result.get("pA1")!;
    const placeA2 = result.get("pA2")!;

    // Since nodeB is higher than nodeC, port pA2 (connecting to B) must be placed higher than pA1 (connecting to C)
    assert.ok(placeA2.y < placeA1.y, `Expected pA2.y (${placeA2.y}) < pA1.y (${placeA1.y}) to prevent wire crossing!`);
  });

  it("should enforce minimum spacing and boundaries on multi-port faces", () => {
    const ports = [
      { id: "p1", nodeId: "nodeA" },
      { id: "p2", nodeId: "nodeA" },
      { id: "p3", nodeId: "nodeA" },
      { id: "p4", nodeId: "nodeA" },
    ];

    const nodes: SolverNode[] = [
      {
        id: "nodeA",
        x: 100,
        y: 100,
        width: 120,
        height: 120,
        ports,
      },
    ];

    const result = solvePortPlacements(nodes, [], { minSpacing: 20, margin: 15 });

    const yCoords = ports.map((p) => result.get(p.id)!.y).sort((a, b) => a - b);

    // Verify margins
    assert.ok(yCoords[0] >= 100 + 15, `Lowest port (${yCoords[0]}) must respect top margin`);
    assert.ok(yCoords[3] <= 100 + 120 - 15, `Highest port (${yCoords[3]}) must respect bottom margin`);

    // Verify minimum pitch spacing
    for (let i = 0; i < yCoords.length - 1; i++) {
      const dist = yCoords[i + 1] - yCoords[i];
      assert.ok(dist >= 19.5, `Spacing between adjacent ports must be >= 20px, got ${dist}px`);
    }
  });
});
