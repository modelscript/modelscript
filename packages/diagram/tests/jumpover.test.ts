// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { computeJumpoverPath } from "../src/port-router.js";

describe("Jumpover Bridge Crossings", () => {
  it("generates straight line path when no obstacles cross", () => {
    const points = [
      { x: 0, y: 100 },
      { x: 200, y: 100 },
    ];
    const path = computeJumpoverPath(points, []);
    assert.strictEqual(path, "M 0 100 L 200 100");
  });

  it("inserts semicircular bridge arc hopping upward over perpendicular crossing", () => {
    const points = [
      { x: 0, y: 100 },
      { x: 200, y: 100 },
    ];
    // Vertical line crossing at x = 100, extending from y=50 to y=150
    const obstacles = [{ p1: { x: 100, y: 50 }, p2: { x: 100, y: 150 } }];
    const path = computeJumpoverPath(points, obstacles, { radius: 5 });

    // Should draw to x=95, arc to x=105, and finish at x=200
    assert.ok(path.includes("L 95 100"), "Must draw line up to arc start");
    assert.ok(path.includes("A 5 5 0 0 1 105 100"), "Must draw semicircular jumpover arc");
    assert.ok(path.endsWith("L 200 100"), "Must terminate at target point");
  });

  it("handles right-to-left direction of travel", () => {
    const points = [
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ];
    const obstacles = [{ p1: { x: 100, y: 50 }, p2: { x: 100, y: 150 } }];
    const path = computeJumpoverPath(points, obstacles, { radius: 5 });

    assert.ok(path.includes("L 105 100"), "Must approach crossing from right");
    assert.ok(path.includes("A 5 5 0 0 0 95 100"), "Must jumpover with counter-clockwise sweep");
    assert.ok(path.endsWith("L 0 100"), "Must terminate at target point");
  });

  it("inserts semicircular bridge arc hopping rightward over perpendicular crossing on vertical wire (top-to-bottom)", () => {
    const points = [
      { x: 100, y: 0 },
      { x: 100, y: 200 },
    ];
    // Horizontal line crossing at y = 100, extending from x=50 to x=150
    const obstacles = [{ p1: { x: 50, y: 100 }, p2: { x: 150, y: 100 } }];
    const path = computeJumpoverPath(points, obstacles, { radius: 5 });

    assert.ok(path.includes("L 100 95"), "Must draw line up to vertical arc start");
    assert.ok(path.includes("A 5 5 0 0 1 100 105"), "Must draw semicircular jumpover arc hopping right");
    assert.ok(path.endsWith("L 100 200"), "Must terminate at target point");
  });

  it("handles bottom-to-top direction of travel on vertical wire", () => {
    const points = [
      { x: 100, y: 200 },
      { x: 100, y: 0 },
    ];
    const obstacles = [{ p1: { x: 50, y: 100 }, p2: { x: 150, y: 100 } }];
    const path = computeJumpoverPath(points, obstacles, { radius: 5 });

    assert.ok(path.includes("L 100 105"), "Must approach crossing from bottom");
    assert.ok(path.includes("A 5 5 0 0 0 100 95"), "Must draw semicircular jumpover arc hopping right");
    assert.ok(path.endsWith("L 100 0"), "Must terminate at target point");
  });

  it("supports downward hop sweep on horizontal segments and leftward hop sweep on vertical segments", () => {
    const pointsH = [
      { x: 0, y: 100 },
      { x: 200, y: 100 },
    ];
    const obsH = [{ p1: { x: 100, y: 50 }, p2: { x: 100, y: 150 } }];
    const pathH = computeJumpoverPath(pointsH, obsH, { radius: 5, horizontalHop: "down" });
    assert.ok(pathH.includes("A 5 5 0 0 0 105 100"), "Sweep 0 must hop downward");

    const pointsV = [
      { x: 100, y: 0 },
      { x: 100, y: 200 },
    ];
    const obsV = [{ p1: { x: 50, y: 100 }, p2: { x: 150, y: 100 } }];
    const pathV = computeJumpoverPath(pointsV, obsV, { radius: 5, verticalHop: "left" });
    assert.ok(pathV.includes("A 5 5 0 0 0 100 105"), "Sweep 0 must hop leftward");
  });

  it("respects axis constraint options ('horizontal' vs 'vertical')", () => {
    const pointsV = [
      { x: 100, y: 0 },
      { x: 100, y: 200 },
    ];
    const obsV = [{ p1: { x: 50, y: 100 }, p2: { x: 150, y: 100 } }];
    const pathOnlyHoriz = computeJumpoverPath(pointsV, obsV, { radius: 5, axis: "horizontal" });
    assert.strictEqual(pathOnlyHoriz, "M 100 0 L 100 200", "Vertical wire must not jump when axis is 'horizontal'");

    const pointsH = [
      { x: 0, y: 100 },
      { x: 200, y: 100 },
    ];
    const obsH = [{ p1: { x: 100, y: 50 }, p2: { x: 100, y: 150 } }];
    const pathOnlyVert = computeJumpoverPath(pointsH, obsH, { radius: 5, axis: "vertical" });
    assert.strictEqual(pathOnlyVert, "M 0 100 L 200 100", "Horizontal wire must not jump when axis is 'vertical'");
  });

  it("suppresses jumpover at coordinates matching a connected solder dot junction", () => {
    const points = [
      { x: 0, y: 100 },
      { x: 200, y: 100 },
    ];
    const obstacles = [{ p1: { x: 100, y: 50 }, p2: { x: 100, y: 150 } }];
    const solderDots = [{ x: 100, y: 100 }];
    const path = computeJumpoverPath(points, obstacles, { radius: 5, solderDots });
    assert.strictEqual(path, "M 0 100 L 200 100", "Must not render jumpover over a solder dot junction");
  });

  it("suppresses jumpover when obstacle belongs to the same electrical net (netId)", () => {
    const points = [
      { x: 0, y: 100 },
      { x: 200, y: 100 },
    ];
    const obstacles = [{ p1: { x: 100, y: 50 }, p2: { x: 100, y: 150 }, netId: "net_VCC" }];
    const path = computeJumpoverPath(points, obstacles, { radius: 5, netId: "net_VCC" });
    assert.strictEqual(path, "M 0 100 L 200 100", "Wires belonging to the same net must not jump over each other");
  });

  it("suppresses jumpover when obstacle belongs to self (edgeId)", () => {
    const points = [
      { x: 0, y: 100 },
      { x: 200, y: 100 },
    ];
    const obstacles = [{ p1: { x: 100, y: 50 }, p2: { x: 100, y: 150 }, edgeId: "edge_self" }];
    const path = computeJumpoverPath(points, obstacles, { radius: 5, edgeId: "edge_self" });
    assert.strictEqual(path, "M 0 100 L 200 100", "Self-segments must not create jumpovers");
  });

  it("avoids duplicate collisions: vertical wire does not hop over horizontal obstacle if obstacle has jumpover", () => {
    const points = [
      { x: 100, y: 0 },
      { x: 100, y: 200 },
    ];
    const obstacles = [{ p1: { x: 50, y: 100 }, p2: { x: 150, y: 100 }, hasJumpover: true }];
    const path = computeJumpoverPath(points, obstacles, { radius: 5, axis: "both" });
    assert.strictEqual(path, "M 100 0 L 100 200", "Vertical wire must yield hop priority to horizontal jumpover wire");
  });

  it("filters out overlapping arcs when two crossings are closer than 2 * radius", () => {
    const points = [
      { x: 0, y: 100 },
      { x: 300, y: 100 },
    ];
    const obstacles = [
      { p1: { x: 100, y: 50 }, p2: { x: 100, y: 150 } },
      { p1: { x: 104, y: 50 }, p2: { x: 104, y: 150 } }, // only 4px away (< 2 * 5 = 10px)
      { p1: { x: 200, y: 50 }, p2: { x: 200, y: 150 } }, // 96px away (valid)
    ];
    const path = computeJumpoverPath(points, obstacles, { radius: 5 });
    const arcMatches = path.match(/A 5 5/g);
    assert.strictEqual(arcMatches?.length, 2, "Only 2 arcs rendered, suppressing overlapping second crossing");
  });

  it("renders jumpover bridges correctly on an L-shaped multi-segment route", () => {
    const points = [
      { x: 0, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 200 },
    ];
    const obstacles = [
      { p1: { x: 50, y: 0 }, p2: { x: 50, y: 100 } }, // crosses horizontal segment at x=50, y=50
      { p1: { x: 50, y: 150 }, p2: { x: 150, y: 150 } }, // crosses vertical segment at x=100, y=150
    ];
    const path = computeJumpoverPath(points, obstacles, { radius: 5 });

    assert.ok(path.includes("L 45 50"), "Horizontal segment reaches first arc start");
    assert.ok(path.includes("A 5 5 0 0 1 55 50"), "Horizontal arc hops up");
    assert.ok(path.includes("L 100 50"), "Reaches L-corner");
    assert.ok(path.includes("L 100 145"), "Vertical segment reaches second arc start");
    assert.ok(path.includes("A 5 5 0 0 1 100 155"), "Vertical arc hops right");
    assert.ok(path.endsWith("L 100 200"), "Terminates at destination");
  });
});
