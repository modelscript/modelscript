// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeOrthogonalRoute,
  computeSmoothBezierPath,
  computeStemLines,
  segmentIntersectsRect,
  type PointLike,
  type RectLike,
} from "../src/port-router.js";

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

  it("should compute boundary stem lines for internal ports", () => {
    const node = { id: "node1", x: 100, y: 100, width: 200, height: 100 };
    const ports = [
      { id: "p_left", x: 100, y: 150 }, // On left perimeter: no stem line
      { id: "p_internal_left", x: 120, y: 150 }, // Inside near left: stem to left (x=100)
      { id: "p_internal_top", x: 200, y: 110, side: "top" as const }, // Inside near top: stem to top (y=100)
      { id: "p_internal_bottom", x: 200, y: 180, side: "bottom" as const }, // Inside near bottom: stem to bottom (y=200)
      { id: "p_internal_right", x: 280, y: 150 }, // Inside near right: stem to right (x=300)
    ];

    const stems = computeStemLines(node, ports);
    assert.strictEqual(stems.length, 4);

    const leftStem = stems.find((s) => s.portId === "p_internal_left");
    assert.ok(leftStem);
    assert.strictEqual(leftStem.side, "left");
    assert.strictEqual(leftStem.end.x, 100);
    assert.strictEqual(leftStem.end.y, 150);

    const topStem = stems.find((s) => s.portId === "p_internal_top");
    assert.ok(topStem);
    assert.strictEqual(topStem.side, "top");
    assert.strictEqual(topStem.end.x, 200);
    assert.strictEqual(topStem.end.y, 100);

    const bottomStem = stems.find((s) => s.portId === "p_internal_bottom");
    assert.ok(bottomStem);
    assert.strictEqual(bottomStem.side, "bottom");
    assert.strictEqual(bottomStem.end.x, 200);
    assert.strictEqual(bottomStem.end.y, 200);

    const rightStem = stems.find((s) => s.portId === "p_internal_right");
    assert.ok(rightStem);
    assert.strictEqual(rightStem.side, "right");
    assert.strictEqual(rightStem.end.x, 300);
    assert.strictEqual(rightStem.end.y, 150);
  });

  it("should compute smooth Catmull-Rom cubic Bezier SVG spline path", () => {
    // 0 or 1 point returns empty string or initial move
    assert.strictEqual(computeSmoothBezierPath([]), "");
    assert.strictEqual(computeSmoothBezierPath([{ x: 10, y: 10 }]), "M 10 10");

    // 2 points returns smooth cubic bezier S-curve with port-tangent control points
    const linePath = computeSmoothBezierPath([
      { x: 10, y: 10 },
      { x: 100, y: 50 },
    ]);
    assert.strictEqual(linePath, "M 10 10 C 55 10, 55 50, 100 50");

    // 4 points returns cubic Bezier with control points
    const splinePath = computeSmoothBezierPath([
      { x: 0, y: 0 },
      { x: 50, y: 100 },
      { x: 100, y: 50 },
      { x: 200, y: 150 },
    ]);
    assert.ok(splinePath.startsWith("M 0 0"), "Path must start at first point");
    assert.ok(splinePath.includes(" C "), "Spline must contain cubic Bezier command");
    const segments = splinePath.split(" C ");
    assert.strictEqual(segments.length, 4, "Must contain 3 cubic Bezier segments");
  });
});
