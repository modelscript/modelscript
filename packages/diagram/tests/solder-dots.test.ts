// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { computeSolderDots, solderDotToDiagramNode } from "../src/solder-dots.js";

test("Topological Solder Dot Junction Engine", async (t) => {
  await t.test("should detect T-junction between an edge endpoint and another edge segment", () => {
    // Edge 1: horizontal line from (0, 50) to (100, 50)
    // Edge 2: vertical line from (50, 50) to (50, 100) meeting edge 1 at (50, 50)
    const edges = [
      {
        id: "e1",
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
        color: "#0000ff",
      },
      {
        id: "e2",
        points: [
          { x: 50, y: 50 },
          { x: 50, y: 100 },
        ],
        color: "#0000ff",
      },
    ];

    const dots = computeSolderDots(edges);
    assert.strictEqual(dots.length, 1);
    assert.strictEqual(dots[0].x, 50);
    assert.strictEqual(dots[0].y, 50);
    assert.strictEqual(dots[0].id, "solder_dot_e1_e2");
  });

  await t.test("should not create solder dots for parallel or disjoint edges", () => {
    const edges = [
      {
        id: "e1",
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      },
      {
        id: "e2",
        points: [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
      },
    ];

    const dots = computeSolderDots(edges);
    assert.strictEqual(dots.length, 0);
  });

  await t.test("should convert solder dot to valid X6 DiagramNode", () => {
    const dot = {
      id: "solder_dot_1_2",
      x: 100,
      y: 200,
      color: "#ff0000",
      edgeIds: ["1", "2"] as [string, string],
    };

    const node = solderDotToDiagramNode(dot);
    assert.strictEqual(node.id, "solder_dot_1_2");
    assert.strictEqual(node.shape, "circle");
    assert.strictEqual(node.width, 3);
    assert.strictEqual(node.height, 3);
    assert.strictEqual(node.x, 98.5);
    assert.strictEqual(node.y, 198.5);
    assert.strictEqual((node.attrs as any)?.body?.fill, "#ff0000");
  });
});
