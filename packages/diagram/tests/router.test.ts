// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignChannelTracks,
  computeBusBundle,
  computeFilletedOrthogonalPath,
  computeOrthogonalRoute,
  computePortStub,
  computeSmoothBezierPath,
  computeStemLines,
  findInternalChannelRoute,
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

  it("should compute staggered parallel routes for bus connections to avoid line overlap", () => {
    const source: PointLike = { x: 20, y: 50 };
    const target: PointLike = { x: 120, y: 150 };

    const route1 = computeOrthogonalRoute(source, target, [], { parallelIndex: 0, channelSpacing: 10 });
    const route2 = computeOrthogonalRoute(source, target, [], { parallelIndex: 1, channelSpacing: 10 });
    const route3 = computeOrthogonalRoute(source, target, [], { parallelIndex: 2, channelSpacing: 10 });

    assert.strictEqual(route1.length, 2);
    assert.strictEqual(route2.length, 2);
    assert.strictEqual(route3.length, 2);

    // Mid-points must be separated by channelSpacing
    assert.notStrictEqual(route1[0].x, route2[0].x, "Parallel routes must not overlap on x-axis");
    assert.notStrictEqual(route2[0].x, route3[0].x, "Parallel routes must not overlap on x-axis");
  });

  it("should evaluate 4-way detours and choose the non-colliding channel", () => {
    const source: PointLike = { x: 50, y: 100 };
    const target: PointLike = { x: 250, y: 100 };
    // Obstacle blocking the direct center
    const obstacles: RectLike[] = [{ x: 100, y: 80, width: 80, height: 40 }];

    const route = computeOrthogonalRoute(source, target, obstacles, { padding: 10 });
    assert.ok(route.length >= 2, "Must produce detour route");

    // Verify all segments avoid the obstacle
    const all = [source, ...route, target];
    for (let i = 0; i < all.length - 1; i++) {
      assert.strictEqual(
        segmentIntersectsRect(all[i], all[i + 1], obstacles[0], 0),
        false,
        `Segment ${i} intersected obstacle`,
      );
    }
  });

  it("should route through internal corridor channels between two blocks using A* channel router", () => {
    // Two blocks with an internal channel corridor between y=80 and y=120
    const obstacles: RectLike[] = [
      { x: 60, y: 20, width: 50, height: 60 },
      { x: 60, y: 120, width: 50, height: 60 },
    ];
    const source: PointLike = { x: 20, y: 100 };
    const target: PointLike = { x: 180, y: 100 };

    const route = findInternalChannelRoute(source, target, obstacles);
    assert.ok(route, "Expected to find internal channel route");
    assert.strictEqual(route[0].x, 20);
    assert.strictEqual(route[route.length - 1].x, 180);

    // Route should navigate cleanly through the corridor (around y=100) without colliding
    for (let i = 0; i < route.length - 1; i++) {
      for (const obs of obstacles) {
        assert.strictEqual(
          segmentIntersectsRect(route[i], route[i + 1], obs, 0),
          false,
          `Segment ${i} collided with obstacle`,
        );
      }
    }
  });

  it("should compute perpendicular port departure stubs and stagger coplanar ports", () => {
    const portA: PointLike = { x: 100, y: 50 };
    const stub0 = computePortStub(portA, "right", 0, 14);
    const stub1 = computePortStub(portA, "right", 1, 14);
    const stub2 = computePortStub(portA, "right", 2, 14);

    assert.strictEqual(stub0.side, "right");
    assert.strictEqual(stub0.stubPoint.x, 114); // 100 + 14
    assert.strictEqual(stub1.stubPoint.x, 120); // 100 + 14 + 6
    assert.strictEqual(stub2.stubPoint.x, 126); // 100 + 14 + 12

    const stubLeft = computePortStub(portA, "left", 0, 15);
    assert.strictEqual(stubLeft.stubPoint.x, 85); // 100 - 15

    const stubTop = computePortStub(portA, "top", 0, 15);
    assert.strictEqual(stubTop.stubPoint.y, 35); // 50 - 15
  });

  it("should assign non-overlapping channel tracks via Left-Edge algorithm", () => {
    const segments = [
      { id: "s1", start: 10, end: 100 },
      { id: "s2", start: 50, end: 150 }, // Overlaps with s1 -> track 1
      { id: "s3", start: 110, end: 200 }, // Disjoint from s1 -> can reuse track 0
    ];

    const assignments = assignChannelTracks(segments, 10, 4);
    assert.strictEqual(assignments.length, 3);

    const a1 = assignments.find((a) => a.item.id === "s1");
    const a2 = assignments.find((a) => a.item.id === "s2");
    const a3 = assignments.find((a) => a.item.id === "s3");

    assert.ok(a1 && a2 && a3);
    assert.strictEqual(a1.track, 0);
    assert.strictEqual(a2.track, 1);
    assert.strictEqual(a3.track, 0); // Reused track 0 because 110 >= 100 + 4
    assert.strictEqual(a1.totalTracks, 2);
  });

  it("should aggregate parallel signals into a bus bundle with trunk and breakout stems", () => {
    const connections = [
      { edgeId: "e1", source: { x: 50, y: 100 }, target: { x: 200, y: 100 } },
      { edgeId: "e2", source: { x: 50, y: 120 }, target: { x: 200, y: 120 } },
      { edgeId: "e3", source: { x: 50, y: 140 }, target: { x: 200, y: 140 } },
    ];

    const bundle = computeBusBundle("nodeA", "nodeB", connections, { channelAxis: "x", trunkCoord: 120 });
    assert.strictEqual(bundle.edgeIds.length, 3);
    assert.strictEqual(bundle.trunk[0].y, 120);
    assert.strictEqual(bundle.trunk[1].y, 120);
    assert.strictEqual(bundle.stems.length, 3);

    const stem1 = bundle.stems.find((s) => s.edgeId === "e1");
    assert.ok(stem1);
    assert.strictEqual(stem1.sourceStem[0].y, 100);
    assert.strictEqual(stem1.sourceStem[1].y, 120); // Connects to trunk
  });

  it("should compute smooth rounded corner fillets on orthogonal routes", () => {
    const waypoints: PointLike[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];

    const filletedPath = computeFilletedOrthogonalPath(waypoints, 10);
    assert.ok(filletedPath.startsWith("M 0 0"));
    assert.ok(filletedPath.includes("Q 100 0"), "Should contain quadratic Bezier fillet at corner");
    assert.ok(filletedPath.endsWith("L 100 100"));
  });
});
