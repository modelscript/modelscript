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
});
