// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeOrthogonalRoute, segmentIntersectsRect, type PointLike, type RectLike } from "../src/port-router.js";

describe("Port-Aware Orthogonal Router with Obstacle Avoidance", () => {
  it("should accurately detect segment-rectangle intersection", () => {
    const rect: RectLike = { x: 50, y: 50, width: 100, height: 100 };

    // Direct intersection through center
    const p1: PointLike = { x: 0, y: 100 };
    const p2: PointLike = { x: 200, y: 100 };
    assert.strictEqual(segmentIntersectsRect(p1, p2, rect, 0), true);

    // Segment entirely above
    const pAbove1: PointLike = { x: 0, y: 30 };
    const pAbove2: PointLike = { x: 200, y: 30 };
    assert.strictEqual(segmentIntersectsRect(pAbove1, pAbove2, rect, 0), false);

    // Segment near border respects padding
    const pNear1: PointLike = { x: 0, y: 45 };
    const pNear2: PointLike = { x: 200, y: 45 };
    assert.strictEqual(segmentIntersectsRect(pNear1, pNear2, rect, 10), true);
    assert.strictEqual(segmentIntersectsRect(pNear1, pNear2, rect, 2), false);
  });

  it("should return empty waypoints for unblocked direct horizontal connections", () => {
    const source: PointLike = { x: 20, y: 50 };
    const target: PointLike = { x: 100, y: 50 };
    const obstacles: RectLike[] = [{ x: 50, y: 100, width: 40, height: 40 }]; // obstacle is far away

    const waypoints = computeOrthogonalRoute(source, target, obstacles);
    assert.deepStrictEqual(waypoints, []);
  });

  it("should compute orthogonal detour around an intermediate obstacle block", () => {
    const source: PointLike = { x: 20, y: 100 };
    const target: PointLike = { x: 200, y: 100 };
    // Obstacle squarely in between source and target
    const obstacles: RectLike[] = [{ x: 80, y: 80, width: 40, height: 40 }];

    const waypoints = computeOrthogonalRoute(source, target, obstacles, { padding: 8 });
    assert.ok(waypoints.length >= 2, "Expected at least 2 waypoints for detour");

    // Waypoints must route orthogonally around the obstacle
    for (let i = 0; i < waypoints.length - 1; i++) {
      const pA = waypoints[i];
      const pB = waypoints[i + 1];
      const isOrthogonal = Math.abs(pA.x - pB.x) < 0.001 || Math.abs(pA.y - pB.y) < 0.001;
      assert.ok(isOrthogonal, `Segment from (${pA.x},${pA.y}) to (${pB.x},${pB.y}) must be orthogonal`);
    }

    // Verify none of the route segments intersect the obstacle
    const allPoints = [source, ...waypoints, target];
    for (let i = 0; i < allPoints.length - 1; i++) {
      assert.strictEqual(
        segmentIntersectsRect(allPoints[i], allPoints[i + 1], obstacles[0], 0),
        false,
        `Segment ${i} collided with obstacle`,
      );
    }
  });

  it("should compute standard 2-bend orthogonal route between offset ports", () => {
    const source: PointLike = { x: 20, y: 50 };
    const target: PointLike = { x: 120, y: 150 };
    const waypoints = computeOrthogonalRoute(source, target, []);

    assert.strictEqual(waypoints.length, 2);
    // Source -> (midX, 50) -> (midX, 150) -> Target
    assert.strictEqual(waypoints[0].y, source.y);
    assert.strictEqual(waypoints[1].y, target.y);
    assert.strictEqual(waypoints[0].x, waypoints[1].x);
  });
});
