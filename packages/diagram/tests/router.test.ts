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
  countPolylineWireCrossings,
  extractEdgePruneOptions,
  findInternalChannelRoute,
  getNodeBBox,
  getPortOutwardNormal,
  healOrthogonalVertices,
  portOrthogonalRouter,
  pruneIntermediateVertices,
  pruneOrthogonalLoops,
  regularizeOrthogonalPolyline,
  resolveNodePortWorldPoint,
  routeOrthogonalGridAStar,
  segmentIntersectsRect,
  simplifyCollinearPoints,
  translateConnectedEdgeStubs,
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

  it("should simplify collinear intermediate points and remove duplicates", () => {
    // 3 collinear horizontal points + duplicate + 90 deg corner + collinear vertical
    const points: PointLike[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 0.2 }, // duplicate / jitter
      { x: 100, y: 50 },
      { x: 100, y: 100 },
    ];

    const simplified = simplifyCollinearPoints(points, 1.0);
    assert.deepStrictEqual(simplified, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  it("should regularize near-orthogonal polyline steps into strict Manhattan segments", () => {
    const rawPoints: PointLike[] = [
      { x: 10, y: 20 },
      { x: 80, y: 22 }, // off-axis by 2px -> should snap to y: 20
      { x: 80, y: 150 },
      { x: 198, y: 150 },
    ];

    const regularized = regularizeOrthogonalPolyline(rawPoints, 5, 1.0);
    assert.strictEqual(regularized[0].y, 20);
    assert.strictEqual(regularized[1].y, 20);
    assert.strictEqual(regularized[1].x, 80);
    assert.strictEqual(regularized[2].y, 150);
  });

  it("should translate connected edge stubs when a source node moves", () => {
    // Mock Graph and Edge
    let currentVertices = [
      { x: 150, y: 100 },
      { x: 150, y: 200 },
    ];

    const mockEdge = {
      isEdge: () => true,
      getSourceCellId: () => "nodeA",
      getTargetCellId: () => "nodeB",
      getSourcePoint: () => ({ x: 100, y: 100 }),
      getTargetPoint: () => ({ x: 300, y: 200 }),
      getVertices: () => currentVertices,
      setVertices: (verts: PointLike[]) => {
        currentVertices = verts;
      },
    };

    const mockGraph = {
      getConnectedEdges: () => [mockEdge],
    };

    const mockNode = { id: "nodeA", isNode: () => true };

    // Move nodeA downwards by dx = 0, dy = 30
    translateConnectedEdgeStubs(mockGraph as any, mockNode as any, 0, 30);

    // Departure stub was horizontal (from x=100 to x=150 at y=100).
    // Moving source node by dy=30 should translate v0.y by 30 (to y=130),
    // keeping the horizontal stub horizontal and leaving vertical trunk at x=150.
    assert.strictEqual(currentVertices[0].x, 150);
    assert.strictEqual(currentVertices[0].y, 130);
    assert.strictEqual(currentVertices[1].x, 150);
    assert.strictEqual(currentVertices[1].y, 200);
  });

  it("should not flip vertical stub orientation when a dragged port crosses v0", () => {
    // Models RLC C.n at (20, 10) connected via v0=(20, 30), v1=(-70, 30) to V.n at (-70, 10)
    let srcPt = { x: 20, y: 10 };
    let currentVertices = [
      { x: 20, y: 30 },
      { x: -70, y: 30 },
    ];

    const mockEdge = {
      isEdge: () => true,
      getSourceCellId: () => "C",
      getTargetCellId: () => "V",
      getSourcePoint: () => srcPt,
      getTargetPoint: () => ({ x: -70, y: 10 }),
      getVertices: () => currentVertices,
      setVertices: (verts: PointLike[]) => {
        currentVertices = verts;
      },
    };

    const mockGraph = {
      getConnectedEdges: () => [mockEdge],
    };
    const mockNode = { id: "C", isNode: () => true };

    // Step 1: drag C down by dy=20 so C.n lands exactly on v0=(20, 30)
    srcPt = { x: 20, y: 30 };
    translateConnectedEdgeStubs(mockGraph as any, mockNode as any, 0, 20);
    assert.deepStrictEqual(currentVertices, [
      { x: 20, y: 30 },
      { x: -70, y: 30 },
    ]);

    // Step 2: drag C right by dx=15 and down by dy=10 while passing through y=30
    srcPt = { x: 35, y: 40 };
    translateConnectedEdgeStubs(mockGraph as any, mockNode as any, 15, 10);
    // Vertical stub must remain vertical (v0.x translates to 35, v0.y stays on the y=30 horizontal trunk)
    assert.deepStrictEqual(currentVertices, [
      { x: 35, y: 30 },
      { x: -70, y: 30 },
    ]);
  });

  it("should preserve 1-vertex L-bend orientation when port crosses vertex coordinate", () => {
    // HV L-bend: source (20, 40) -> v0 (60, 40) -> target (60, 100)
    let srcPt = { x: 20, y: 40 };
    let currentVertices = [{ x: 60, y: 40 }];

    const mockEdge = {
      isEdge: () => true,
      getSourceCellId: () => "L",
      getTargetCellId: () => "C",
      getSourcePoint: () => srcPt,
      getTargetPoint: () => ({ x: 60, y: 100 }),
      getVertices: () => currentVertices,
      setVertices: (verts: PointLike[]) => {
        currentVertices = verts;
      },
    };

    const mockGraph = {
      getConnectedEdges: () => [mockEdge],
    };
    const mockNode = { id: "L", isNode: () => true };

    // Move L to x=60 (so prevSrcX reaches v0.x) and up by dy=-10
    srcPt = { x: 60, y: 30 };
    translateConnectedEdgeStubs(mockGraph as any, mockNode as any, 40, -10);
    // Move L further right by dx=10 and up by dy=-5 from x=60 (where prevSrcX === v0.x)
    srcPt = { x: 70, y: 25 };
    translateConnectedEdgeStubs(mockGraph as any, mockNode as any, 10, -5);

    // Since target leg is vertical at x=60, source leg is horizontal and v0 must stay at x=60, y=25
    assert.deepStrictEqual(currentVertices, [{ x: 60, y: 25 }]);
  });

  it("should compute accurate outward port normals for rotated and unrotated Modelica components", () => {
    // Resistor R in RLC.mo: 20x20 node rotated by -270 deg (equivalent to +90 deg in X6)
    // p is at local (0, 10), n is at local (20, 10)
    const mockR = {
      id: "R",
      getPosition: () => ({ x: 50, y: -10 }),
      getSize: () => ({ width: 20, height: 20 }),
      getAngle: () => -270,
      getPortProp: (portId: string) => (portId === "p" ? { args: { x: 0, y: 10 } } : { args: { x: 20, y: 10 } }),
    };

    const normP = getPortOutwardNormal(mockR, "p");
    const normN = getPortOutwardNormal(mockR, "n");
    assert.deepStrictEqual(normP, { nx: 0, ny: -1, side: "top" });
    assert.deepStrictEqual(normN, { nx: 0, ny: 1, side: "bottom" });

    // Inductor L in RLC.mo: 20x20 node unrotated (0 deg)
    const mockL = {
      id: "L",
      getPosition: () => ({ x: -10, y: -50 }),
      getSize: () => ({ width: 20, height: 20 }),
      getAngle: () => 0,
      getPortProp: (portId: string) => (portId === "p" ? { args: { x: 0, y: 10 } } : { args: { x: 20, y: 10 } }),
    };
    assert.deepStrictEqual(getPortOutwardNormal(mockL, "p"), { nx: -1, ny: 0, side: "left" });
    assert.deepStrictEqual(getPortOutwardNormal(mockL, "n"), { nx: 1, ny: 0, side: "right" });
  });

  it("should inject an orthogonal Z-dogleg when a 0-vertex straight edge (ground.p) is dragged off-axis", () => {
    // Models connect(Vb.n, ground.p) in RLC.mo where Vb.n is at (-70, 50) (bottom) and ground.p moves to (-10, 70) (top)
    let currentVertices: PointLike[] = [];
    const nodeVb = {
      id: "Vb",
      isNode: () => true,
      getPosition: () => ({ x: -80, y: 30 }),
      getSize: () => ({ width: 20, height: 20 }),
      getAngle: () => -270,
      getPortProp: (p: string) => (p === "n" ? { args: { x: 20, y: 10 } } : { args: { x: 0, y: 10 } }),
    };
    const nodeGround = {
      id: "ground",
      isNode: () => true,
      getPosition: () => ({ x: -20, y: 70 }),
      getSize: () => ({ width: 20, height: 20 }),
      getAngle: () => 0,
      getPortProp: () => ({ args: { x: 10, y: 0 } }),
    };

    const mockEdge = {
      id: "e_ground",
      isEdge: () => true,
      getSourceCellId: () => "Vb",
      getTargetCellId: () => "ground",
      getSourcePortId: () => "n",
      getTargetPortId: () => "p",
      getSourcePoint: () => ({ x: -70, y: 50 }),
      getTargetPoint: () => ({ x: -10, y: 70 }),
      getVertices: () => currentVertices,
      setVertices: (verts: PointLike[]) => {
        currentVertices = verts;
      },
    };

    const mockGraph = {
      getConnectedEdges: () => [mockEdge],
      getCellById: (id: string) => (id === "Vb" ? nodeVb : nodeGround),
      getNodes: () => [nodeVb, nodeGround],
    };

    translateConnectedEdgeStubs(mockGraph as any, nodeGround as any, 60, 40);

    assert.ok(currentVertices.length >= 2, "0-vertex off-axis wire must receive orthogonal bend vertices");
    const fullPath = [{ x: -70, y: 50 }, ...currentVertices, { x: -10, y: 70 }];
    for (let i = 0; i < fullPath.length - 1; i++) {
      const a = fullPath[i]!;
      const b = fullPath[i + 1]!;
      assert.ok(
        Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1,
        `Segment ${i} (${a.x},${a.y})->(${b.x},${b.y}) must be strictly orthogonal, never diagonal`,
      );
    }
  });

  it("should push the shared bottom trunk downward when C is dragged past the ground rail in RLC.mo", () => {
    // C is dragged down so C.p=(20,30) and C.n=(20,50), crossing the y=30 rail connected to Vb.n=(-70,10) and R.n=(60,10)
    let cToVbVerts: PointLike[] = [
      { x: 20, y: 30 },
      { x: -70, y: 30 },
    ];
    let rToVbVerts: PointLike[] = [
      { x: 60, y: 30 },
      { x: -70, y: 30 },
    ];

    const makeRotatedPassivesNode = (id: string, x: number, y: number) => ({
      id,
      isNode: () => true,
      getPosition: () => ({ x, y }),
      getSize: () => ({ width: 20, height: 20 }),
      getAngle: () => -270,
      getPortProp: (portId: string) => (portId === "p" ? { args: { x: 0, y: 10 } } : { args: { x: 20, y: 10 } }),
    });

    const nodeC = makeRotatedPassivesNode("C", 10, 30); // C.p=(20,30), C.n=(20,50)
    const nodeR = makeRotatedPassivesNode("R", 50, -10); // R.p=(60,-10), R.n=(60,10)
    const nodeVb = makeRotatedPassivesNode("Vb", -80, -10); // Vb.p=(-70,-10), Vb.n=(-70,10)

    const edgeCToVb = {
      id: "e_c_vb",
      isEdge: () => true,
      getSourceCellId: () => "C",
      getTargetCellId: () => "Vb",
      getSourcePortId: () => "n",
      getTargetPortId: () => "n",
      getSourcePoint: () => ({ x: 20, y: 50 }),
      getTargetPoint: () => ({ x: -70, y: 10 }),
      getVertices: () => cToVbVerts,
      setVertices: (verts: PointLike[]) => {
        cToVbVerts = verts;
      },
    };

    const edgeRToVb = {
      id: "e_r_vb",
      isEdge: () => true,
      getSourceCellId: () => "R",
      getTargetCellId: () => "Vb",
      getSourcePortId: () => "n",
      getTargetPortId: () => "n",
      getSourcePoint: () => ({ x: 60, y: 10 }),
      getTargetPoint: () => ({ x: -70, y: 10 }),
      getVertices: () => rToVbVerts,
      setVertices: (verts: PointLike[]) => {
        rToVbVerts = verts;
      },
    };

    const nodesMap: Record<string, any> = { C: nodeC, R: nodeR, Vb: nodeVb };
    const mockGraph = {
      getConnectedEdges: () => [edgeCToVb],
      getEdges: () => [edgeCToVb, edgeRToVb],
      getCellById: (id: string) => nodesMap[id],
      getNodes: () => [nodeC, nodeR, nodeVb],
    };

    translateConnectedEdgeStubs(mockGraph as any, nodeC as any, 0, 40);

    // Trunk must be pushed down below C.n (y=50) to y=60 so the wire exits downward from C.n
    assert.strictEqual(cToVbVerts[0]!.y, 60);
    assert.strictEqual(cToVbVerts[1]!.y, 60);
    // Coincident net trunk on R.n -> Vb.n must also slide down to y=60
    assert.strictEqual(rToVbVerts[0]!.y, 60);
    assert.strictEqual(rToVbVerts[1]!.y, 60);
  });

  it("should re-route around L when C is dragged left of L to prevent backward port exit and self-impalement", () => {
    // L is at (-10,-50) (L.p=(-10,-40) left, L.n=(10,-40) right)
    // C is dragged left of L to (-80,-10) (C.p=(-70,-10) top, C.n=(-70,10) bottom)
    let lToCVerts: PointLike[] = [{ x: 20, y: -40 }];

    const nodeL = {
      id: "L",
      isNode: () => true,
      getPosition: () => ({ x: -10, y: -50 }),
      getSize: () => ({ width: 20, height: 20 }),
      getAngle: () => 0,
      getPortProp: (p: string) => (p === "p" ? { args: { x: 0, y: 10 } } : { args: { x: 20, y: 10 } }),
    };
    const nodeC = {
      id: "C",
      isNode: () => true,
      getPosition: () => ({ x: -80, y: -10 }),
      getSize: () => ({ width: 20, height: 20 }),
      getAngle: () => -270,
      getPortProp: (p: string) => (p === "p" ? { args: { x: 0, y: 10 } } : { args: { x: 20, y: 10 } }),
    };

    const edgeLToC = {
      id: "e_l_c",
      isEdge: () => true,
      getSourceCellId: () => "L",
      getTargetCellId: () => "C",
      getSourcePortId: () => "n",
      getTargetPortId: () => "p",
      getSourcePoint: () => ({ x: 10, y: -40 }),
      getTargetPoint: () => ({ x: -70, y: -10 }),
      getVertices: () => lToCVerts,
      setVertices: (verts: PointLike[]) => {
        lToCVerts = verts;
      },
    };

    const mockGraph = {
      getConnectedEdges: () => [edgeLToC],
      getCellById: (id: string) => (id === "L" ? nodeL : nodeC),
      getNodes: () => [nodeL, nodeC],
    };

    translateConnectedEdgeStubs(mockGraph as any, nodeC as any, -90, 0);

    // First vertex must exit L.n (10, -40) to the RIGHT (x > 10), never leftward through L's body!
    assert.ok(lToCVerts.length >= 2, "Must re-route with a multi-bend detour around L");
    assert.ok(lToCVerts[0]!.x > 10, `Expected first vertex x > 10 (exiting right from L.n), got ${lToCVerts[0]!.x}`);
    // Last vertex must enter C.p (-70, -10) from the TOP (y < -10)
    const lastV = lToCVerts[lToCVerts.length - 1]!;
    assert.ok(lastV.y < -10, `Expected last vertex y < -10 (entering top of C.p), got ${lastV.y}`);
  });

  it("simplifyCollinearPoints should preserve 90-degree corners on short jogs (<= tolerance)", () => {
    // A 1px vertical step between two horizontal segments: (0,0) -> (50,0) -> (50,1) -> (100,1)
    // Deleting (50,0) or (50,1) would create a diagonal segment!
    const shortJog: PointLike[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 1 },
      { x: 100, y: 1 },
    ];
    const simplified = simplifyCollinearPoints(shortJog, 1.5);
    assert.strictEqual(simplified.length, 4, "Must preserve both 90-degree corners on short jog");
    for (let i = 0; i < simplified.length - 1; i++) {
      const a = simplified[i]!;
      const b = simplified[i + 1]!;
      assert.ok(
        Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6,
        `Segment ${i} must remain strictly axis-aligned`,
      );
    }
  });

  it("regularizeOrthogonalPolyline should never mutate pinned source/target endpoints", () => {
    const source: PointLike = { x: 10, y: 40 };
    const target: PointLike = { x: 100, y: 80.7 };
    const poly: PointLike[] = [source, { x: 50, y: 40 }, { x: 50, y: 80 }, target];
    const reg = regularizeOrthogonalPolyline(poly);

    // Pinned endpoints must be exact
    assert.deepStrictEqual(reg[0], source);
    assert.deepStrictEqual(reg[reg.length - 1], target);

    // Every segment in regularized polyline must be strictly orthogonal
    for (let i = 0; i < reg.length - 1; i++) {
      const a = reg[i]!;
      const b = reg[i + 1]!;
      assert.ok(
        Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6,
        `Segment ${i} (${a.x},${a.y})->(${b.x},${b.y}) must be strictly orthogonal`,
      );
    }
  });

  it("healOrthogonalVertices should eliminate terminal micro-diagonals and diagonal interior segments", () => {
    // Case 1: Port at y=40.6 while saved annotation vertex is at y=40
    const src1: PointLike = { x: 10, y: 40.6 };
    const tgt1: PointLike = { x: 90, y: 10.2 };
    const rawVerts1: PointLike[] = [
      { x: 50, y: 40 },
      { x: 50, y: 10 },
    ];
    const healed1 = healOrthogonalVertices(src1, tgt1, rawVerts1);
    const full1 = [src1, ...healed1, tgt1];
    for (let i = 0; i < full1.length - 1; i++) {
      const a = full1[i]!;
      const b = full1[i + 1]!;
      assert.ok(
        Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6,
        `Case 1 segment ${i} (${a.x},${a.y})->(${b.x},${b.y}) must be strictly orthogonal`,
      );
    }

    // Case 2: 0 intermediate vertices with 0.8px vertical port offset
    const src2: PointLike = { x: 20, y: 50 };
    const tgt2: PointLike = { x: 120, y: 50.8 };
    const healed2 = healOrthogonalVertices(src2, tgt2, []);
    assert.strictEqual(healed2.length, 2, "Must insert 2 orthogonal Z-bend vertices for off-axis 0-vertex wire");
    const full2 = [src2, ...healed2, tgt2];
    for (let i = 0; i < full2.length - 1; i++) {
      const a = full2[i]!;
      const b = full2[i + 1]!;
      assert.ok(
        Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6,
        `Case 2 segment ${i} (${a.x},${a.y})->(${b.x},${b.y}) must be strictly orthogonal`,
      );
    }

    // Case 3: portOrthogonalRouter heals explicit vertices using edgeView endpoints
    const routerVerts = portOrthogonalRouter(rawVerts1, {}, { sourcePoint: src1, targetPoint: tgt1 });
    const full3 = [src1, ...routerVerts, tgt1];
    for (let i = 0; i < full3.length - 1; i++) {
      const a = full3[i]!;
      const b = full3[i + 1]!;
      assert.ok(
        Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6,
        `Case 3 segment ${i} (${a.x},${a.y})->(${b.x},${b.y}) must be strictly orthogonal`,
      );
    }
  });

  it("routeOrthogonalGridAStar should navigate around obstacle cells in pure TypeScript mode", () => {
    const cols = 20;
    const rows = 20;
    const grid = new Uint8Array(cols * rows);

    // Place an obstacle block from (8, 5) to (12, 15)
    for (let x = 8; x <= 12; x++) {
      for (let y = 5; y <= 15; y++) {
        grid[y * cols + x] = 1;
      }
    }

    const startX = 5;
    const startY = 10;
    const endX = 15;
    const endY = 10;

    const waypoints = routeOrthogonalGridAStar({
      cols,
      rows,
      startX,
      startY,
      endX,
      endY,
      grid,
    });

    assert.ok(waypoints.length >= 2, "Expected detour waypoints around obstacle");
    // Verify none of the waypoints land inside the obstacle [8..12, 5..15]
    for (const [wx, wy] of waypoints) {
      const inObstacle = wx >= 8 && wx <= 12 && wy >= 5 && wy <= 15;
      assert.strictEqual(inObstacle, false, `Waypoint (${wx}, ${wy}) collided with obstacle`);
    }
  });

  it("should transform port outward normals and world coordinates under 90, 180, 270 degree rotation and flipping", () => {
    // Mock an RLC component (e.g. Inductor) at (100, 100) with size 60x40
    let nodeAngle = 0;
    let nodeData: Record<string, unknown> = {};
    const mockNode: any = {
      id: "L1",
      getPosition: () => ({ x: 100, y: 100 }),
      getSize: () => ({ width: 60, height: 40 }),
      getAngle: () => nodeAngle,
      getData: () => nodeData,
      getPorts: () => [{ id: "p" }, { id: "n" }],
      getPortProp: (portId: string, prop: string) => {
        if (prop === "args") {
          return portId === "p" ? { x: 0, y: 20 } : { x: 60, y: 20 };
        }
        if (prop === "group") {
          return portId === "p" ? "left" : "right";
        }
        return undefined;
      },
    };

    // 0 degrees: p is at left (100, 120), normal points left; n is at right (160, 120), normal points right
    nodeAngle = 0;
    const p0 = resolveNodePortWorldPoint(mockNode, "p");
    const n0 = resolveNodePortWorldPoint(mockNode, "n");
    assert.deepStrictEqual(p0, { x: 100, y: 120 });
    assert.deepStrictEqual(n0, { x: 160, y: 120 });
    assert.strictEqual(getPortOutwardNormal(mockNode, "p", p0)?.side, "left");
    assert.strictEqual(getPortOutwardNormal(mockNode, "n", n0)?.side, "right");

    // 180 degrees: p moves to (160, 120) and points right; n moves to (100, 120) and points left
    nodeAngle = 180;
    const p180 = resolveNodePortWorldPoint(mockNode, "p");
    const n180 = resolveNodePortWorldPoint(mockNode, "n");
    assert.deepStrictEqual(p180, { x: 160, y: 120 });
    assert.deepStrictEqual(n180, { x: 100, y: 120 });
    assert.strictEqual(getPortOutwardNormal(mockNode, "p", p180)?.side, "right");
    assert.strictEqual(getPortOutwardNormal(mockNode, "n", n180)?.side, "left");

    // 90 degrees: p rotates clockwise by 90 deg relative to center (130, 120) -> (130, 90) or (130, 150)
    // dx = 0 - 30 = -30, dy = 20 - 20 = 0. Rotated 90 deg: dx' = 0, dy' = -30 * sin(90) = -30 (or +30 in screen coords)
    // Let's verify standard clockwise screen-space rotation:
    nodeAngle = 90;
    const p90 = resolveNodePortWorldPoint(mockNode, "p");
    assert.strictEqual(p90?.x, 130);
    assert.strictEqual(p90?.y, 90);
    assert.strictEqual(getPortOutwardNormal(mockNode, "p", p90)?.side, "top");

    // 270 degrees
    nodeAngle = 270;
    const p270 = resolveNodePortWorldPoint(mockNode, "p");
    assert.strictEqual(p270?.x, 130);
    assert.strictEqual(p270?.y, 150);
    assert.strictEqual(getPortOutwardNormal(mockNode, "p", p270)?.side, "bottom");

    // Horizontal Flip: flipX = true at 0 deg
    nodeAngle = 0;
    nodeData = { flipX: true };
    const pFlipX = resolveNodePortWorldPoint(mockNode, "p");
    const nFlipX = resolveNodePortWorldPoint(mockNode, "n");
    assert.deepStrictEqual(pFlipX, { x: 160, y: 120 });
    assert.deepStrictEqual(nFlipX, { x: 100, y: 120 });
    assert.strictEqual(getPortOutwardNormal(mockNode, "p", pFlipX)?.side, "right");
    assert.strictEqual(getPortOutwardNormal(mockNode, "n", nFlipX)?.side, "left");
  });

  it("should route orthogonal edge around rotated component without impalement or cutting through the body", () => {
    // Component at (100, 100) with size 60x40, rotated 180 degrees
    const mockNode: any = {
      id: "L1",
      getPosition: () => ({ x: 100, y: 100 }),
      getSize: () => ({ width: 60, height: 40 }),
      getAngle: () => 180,
      getData: () => ({}),
      getPorts: () => [{ id: "p" }],
      getPortProp: () => ({ x: 0, y: 20 }),
    };

    const sourcePoint = { x: 50, y: 120 }; // External node to the left
    const targetPoint = resolveNodePortWorldPoint(mockNode, "p")!; // Rotated port at (160, 120)
    assert.deepStrictEqual(targetPoint, { x: 160, y: 120 });

    const targetSide = getPortOutwardNormal(mockNode, "p", targetPoint)?.side;
    assert.strictEqual(targetSide, "right", "Port p normal at 180 deg must point right (outward)");

    const compBox = getNodeBBox(mockNode)!;
    const obstacles: RectLike[] = [compBox];

    const route = computeOrthogonalRoute(sourcePoint, targetPoint, obstacles, {
      sourceSide: "left",
      targetSide,
      targetBox: compBox,
    });

    const fullPath = [sourcePoint, ...route, targetPoint];

    // Verify the route does not penetrate the component body (100 <= x <= 160, 100 <= y <= 140)
    for (let i = 0; i < fullPath.length - 1; i++) {
      const a = fullPath[i]!;
      const b = fullPath[i + 1]!;

      // Midpoints of horizontal segments crossing through the center of the component must not exist
      if (Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.y - 120) < 1e-6) {
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        const cutsThroughBody = minX < 130 && maxX > 130;
        assert.strictEqual(cutsThroughBody, false, "Wire must not cut straight through the component center");
      }
    }
  });

  it("collapses L-wires into straight 0-bend wires when L aligns with top-facing ports Vb.p and C.p without disturbing C-R", () => {
    let lY = -20; // L.p=(-10,-10), L.n=(10,-10) aligned with Vb.p=(-70,-10) and C.p=(20,-10)
    let vbToLVerts: PointLike[] = [{ x: -70, y: -40 }];
    let lToCVerts: PointLike[] = [{ x: 20, y: -40 }];
    let cToRVerts: PointLike[] = [
      { x: 20, y: -10 },
      { x: 60, y: -10 },
    ];

    const nodeVb = {
      id: "Vb",
      isNode: () => true,
      getPosition: () => ({ x: -80, y: -10 }),
      getSize: () => ({ width: 20, height: 20 }),
      getAngle: () => -270,
      getPortProp: (p: string) => (p === "p" ? { args: { x: 0, y: 10 } } : { args: { x: 20, y: 10 } }),
    };
    const nodeL = {
      id: "L",
      isNode: () => true,
      getPosition: () => ({ x: -10, y: lY }),
      getSize: () => ({ width: 20, height: 20 }),
      getAngle: () => 0,
      getPortProp: (p: string) => (p === "p" ? { args: { x: 0, y: 10 } } : { args: { x: 20, y: 10 } }),
    };
    const nodeC = {
      id: "C",
      isNode: () => true,
      getPosition: () => ({ x: 10, y: -10 }),
      getSize: () => ({ width: 20, height: 20 }),
      getAngle: () => -270,
      getPortProp: (p: string) => (p === "p" ? { args: { x: 0, y: 10 } } : { args: { x: 20, y: 10 } }),
    };
    const nodeR = {
      id: "R",
      isNode: () => true,
      getPosition: () => ({ x: 50, y: -10 }),
      getSize: () => ({ width: 20, height: 20 }),
      getAngle: () => -270,
      getPortProp: (p: string) => (p === "p" ? { args: { x: 0, y: 10 } } : { args: { x: 20, y: 10 } }),
    };

    const edgeVbToL = {
      id: "e_vb_l",
      isEdge: () => true,
      getSourceCellId: () => "Vb",
      getTargetCellId: () => "L",
      getSourcePortId: () => "p",
      getTargetPortId: () => "p",
      getSourcePoint: () => ({ x: -70, y: -10 }),
      getTargetPoint: () => ({ x: -10, y: lY + 10 }),
      getVertices: () => vbToLVerts,
      setVertices: (v: PointLike[]) => {
        vbToLVerts = v;
      },
    };
    const edgeLToC = {
      id: "e_l_c",
      isEdge: () => true,
      getSourceCellId: () => "L",
      getTargetCellId: () => "C",
      getSourcePortId: () => "n",
      getTargetPortId: () => "p",
      getSourcePoint: () => ({ x: 10, y: lY + 10 }),
      getTargetPoint: () => ({ x: 20, y: -10 }),
      getVertices: () => lToCVerts,
      setVertices: (v: PointLike[]) => {
        lToCVerts = v;
      },
    };
    const edgeCToR = {
      id: "e_c_r",
      isEdge: () => true,
      getSourceCellId: () => "C",
      getTargetCellId: () => "R",
      getSourcePortId: () => "p",
      getTargetPortId: () => "p",
      getSourcePoint: () => ({ x: 20, y: -10 }),
      getTargetPoint: () => ({ x: 60, y: -10 }),
      getVertices: () => cToRVerts,
      setVertices: (v: PointLike[]) => {
        cToRVerts = v;
      },
    };

    const nodesMap: Record<string, any> = { Vb: nodeVb, L: nodeL, C: nodeC, R: nodeR };
    const mockGraph = {
      getConnectedEdges: () => [edgeVbToL, edgeLToC],
      getEdges: () => [edgeVbToL, edgeLToC, edgeCToR],
      getCellById: (id: string) => nodesMap[id],
      getNodes: () => [nodeVb, nodeL, nodeC, nodeR],
    };

    // Step 1: Drag L down by dy=+30 from y=-50 to y=-20 so L.p and L.n align horizontally with Vb.p and C.p at y=-10
    translateConnectedEdgeStubs(mockGraph as any, nodeL as any, 0, 30);

    assert.deepStrictEqual(vbToLVerts, [], "Vb.p -> L.p must collapse into a 0-bend straight horizontal wire");
    assert.deepStrictEqual(lToCVerts, [], "L.n -> C.p must collapse into a 0-bend straight horizontal wire");
    assert.deepStrictEqual(
      cToRVerts,
      [
        { x: 20, y: -10 },
        { x: 60, y: -10 },
      ],
      "Unconnected C -> R wire must not be disturbed when dragging L",
    );

    // Step 2: Drag L back up by dy=-30 to y=-50; perpendicular port normals reconstruct clean 1-bend L-corners
    lY = -50;
    translateConnectedEdgeStubs(mockGraph as any, nodeL as any, 0, -30);
    assert.deepStrictEqual(vbToLVerts, [{ x: -70, y: -40 }]);
    assert.deepStrictEqual(lToCVerts, [{ x: 20, y: -40 }]);
  });

  it("translateConnectedEdgeStubs automatically reroutes when a wire is dragged into a third-party obstacle", () => {
    // Node A at x=0, y=-60 (size 40x40). Port p at (40, 20), right normal
    // Node B at x=200, y=0 (size 40x40). Port p at (200, 20), left normal
    // Intermediate obstacle node at x=90, y=0 (size 40x40).
    let aY = -60;
    const nodeA: any = {
      id: "nodeA",
      getPosition: () => ({ x: 0, y: aY }),
      getSize: () => ({ width: 40, height: 40 }),
      getBBox: () => ({ x: 0, y: aY, width: 40, height: 40 }),
      getPortProp: () => ({ side: "right", args: { x: 40, y: 20 } }),
    };

    const nodeB: any = {
      id: "nodeB",
      getPosition: () => ({ x: 200, y: 0 }),
      getSize: () => ({ width: 40, height: 40 }),
      getBBox: () => ({ x: 200, y: 0, width: 40, height: 40 }),
      getPortProp: () => ({ side: "left", args: { x: 0, y: 20 } }),
    };

    const nodeObstacle: any = {
      id: "nodeObs",
      getPosition: () => ({ x: 90, y: 0 }),
      getSize: () => ({ width: 40, height: 40 }),
      getBBox: () => ({ x: 90, y: 0, width: 40, height: 40 }),
    };

    let edgeVerts: PointLike[] = [
      { x: 50, y: -40 },
      { x: 50, y: 20 },
      { x: 190, y: 20 },
    ];
    const edge: any = {
      id: "edgeAB",
      isEdge: () => true,
      getSourceCellId: () => "nodeA",
      getTargetCellId: () => "nodeB",
      getSource: () => ({ cell: "nodeA", port: "p" }),
      getTarget: () => ({ cell: "nodeB", port: "p" }),
      getSourceCell: () => nodeA,
      getTargetCell: () => nodeB,
      getSourcePortId: () => "p",
      getTargetPortId: () => "p",
      getSourcePoint: () => ({ x: 40, y: aY + 20 }),
      getTargetPoint: () => ({ x: 200, y: 20 }),
      getVertices: () => edgeVerts,
      setVertices: (v: PointLike[]) => {
        edgeVerts = v;
      },
    };

    const mockGraph: any = {
      getConnectedEdges: () => [edge],
      getEdges: () => [edge],
      getCellById: (id: string) => {
        if (id === "nodeA") return nodeA;
        if (id === "nodeB") return nodeB;
        if (id === "nodeObs") return nodeObstacle;
        return null;
      },
      getNodes: () => [nodeA, nodeB, nodeObstacle],
    };

    // Drag nodeA down by dy=+60 so it aligns horizontally with nodeB at y=0.
    // If third-party obstacles were ignored, it would collapse into a straight line slicing through nodeObstacle!
    aY = 0;
    translateConnectedEdgeStubs(mockGraph as any, nodeA as any, 0, 60);

    // Must have routed around nodeObstacle (not a straight line through x=90..130 at y=20)
    assert.ok(edgeVerts.length > 0, "Must not collapse into straight line across obstacle");
    const fullPoly = [{ x: 40, y: 20 }, ...edgeVerts, { x: 200, y: 20 }];
    for (let i = 0; i < fullPoly.length - 1; i++) {
      assert.ok(
        !segmentIntersectsRect(fullPoly[i]!, fullPoly[i + 1]!, { x: 90, y: 0, width: 40, height: 40 }, 4),
        "Route must not intersect the third-party obstacle",
      );
    }
  });

  it("pruneOrthogonalLoops eliminates redundant loops/reversals while preserving obstacle detours", () => {
    // 1. Redundant 5-bend S-hook/loop is pruned into fewer segments
    const convolutedPath: PointLike[] = [
      { x: 151, y: 225 },
      { x: 199, y: 225 },
      { x: 199, y: 121 },
      { x: 143, y: 121 },
      { x: 143, y: 192 },
      { x: 267, y: 192 },
      { x: 267, y: 128 },
      { x: 275, y: 128 },
    ];
    const pruned = pruneOrthogonalLoops(convolutedPath, {
      sourceNormal: { nx: 1, ny: 0, side: "right" },
      targetNormal: { nx: -1, ny: 0, side: "left" },
    });
    assert.ok(pruned.length < convolutedPath.length, "Convoluted path must have fewer vertices after pruning");
    assert.strictEqual(pruned[0]!.x, 151);
    assert.strictEqual(pruned[0]!.y, 225);
    assert.strictEqual(pruned[pruned.length - 1]!.x, 275);
    assert.strictEqual(pruned[pruned.length - 1]!.y, 128);

    // 2. Legitimate detour around an intermediate obstacle is NOT shortcut
    const obstacleRoute: PointLike[] = [
      { x: 0, y: 50 },
      { x: 30, y: 50 },
      { x: 30, y: 10 },
      { x: 70, y: 10 },
      { x: 70, y: 50 },
      { x: 100, y: 50 },
    ];
    const obstacle: RectLike = { x: 40, y: 30, width: 20, height: 40 };
    const preserved = pruneOrthogonalLoops(obstacleRoute, { obstacles: [obstacle] });
    assert.deepStrictEqual(preserved, obstacleRoute, "Detour around obstacle must not be shortcut through obstacle");
  });

  it("connecting CriticalDamping1 to Derivative1 generates a clean 2-bend orthogonal route without loops", () => {
    const sourcePoint: PointLike = { x: 151, y: 225 };
    const targetPoint: PointLike = { x: 275, y: 134 };

    const sourceBox: RectLike = { x: 71, y: 184, width: 80, height: 80 };
    const targetBox: RectLike = { x: 275, y: 88, width: 80, height: 80 };

    const route = computeOrthogonalRoute(sourcePoint, targetPoint, [], {
      sourceSide: "right",
      targetSide: "left",
      sourceBox,
      targetBox,
    });

    // Must be a standard 2-bend orthogonal Z-step (at most 2 intermediate vertices)
    assert.ok(route.length <= 2, `Expected at most 2 bends, got ${route.length}: ${JSON.stringify(route)}`);
    assert.strictEqual(route.length, 2);

    // First bend departs horizontally to the right from source port (x > 151, y = 225)
    assert.ok(route[0]!.x > sourcePoint.x, "First bend must step right out of source port");
    assert.strictEqual(route[0]!.y, sourcePoint.y, "First bend must match source Y");

    // Second bend arrives horizontally into target port from the left (x < 275, y = 134)
    assert.strictEqual(route[1]!.x, route[0]!.x, "Intermediate vertical trunk must connect both bends");
    assert.strictEqual(route[1]!.y, targetPoint.y, "Second bend must match target Y");

    // The intermediate vertical trunk MUST be centered in the corridor (midX = 210)
    // rather than hugging the target port at x = 265 (which would slice through input port arrowheads)
    assert.strictEqual(route[0]!.x, 210, "Trunk must be centered at midX = 210 between stubs");
  });

  it("opposing vertical ports generate a centered horizontal trunk without hugging port edges", () => {
    const sourcePoint: PointLike = { x: 100, y: 150 };
    const targetPoint: PointLike = { x: 250, y: 350 };
    const sourceBox: RectLike = { x: 60, y: 70, width: 80, height: 80 };
    const targetBox: RectLike = { x: 210, y: 350, width: 80, height: 80 };

    const route = computeOrthogonalRoute(sourcePoint, targetPoint, [], {
      sourceSide: "bottom",
      targetSide: "top",
      sourceBox,
      targetBox,
    });

    assert.strictEqual(route.length, 2, "Must be a 2-bend orthogonal route");
    assert.strictEqual(route[0]!.x, sourcePoint.x, "First bend drops down from source port");
    assert.strictEqual(route[1]!.x, targetPoint.x, "Second bend aligns with target port X");
    assert.strictEqual(route[0]!.y, route[1]!.y, "Horizontal trunk must connect both bends");
    // Midpoint Y = (160 + 340) / 2 = 250
    assert.strictEqual(route[0]!.y, 250, "Horizontal trunk must be centered at midY = 250");
  });

  it("parallel edge staggering offsets trunk routes between the same component pair", () => {
    const sourcePoint: PointLike = { x: 100, y: 100 };
    const targetPoint: PointLike = { x: 300, y: 200 };

    const route0 = computeOrthogonalRoute(sourcePoint, targetPoint, [], {
      sourceSide: "right",
      targetSide: "left",
      parallelIndex: 0,
      parallelCount: 2,
    });

    const route1 = computeOrthogonalRoute(sourcePoint, targetPoint, [], {
      sourceSide: "right",
      targetSide: "left",
      parallelIndex: 1,
      parallelCount: 2,
    });

    assert.strictEqual(route0.length, 2);
    assert.strictEqual(route1.length, 2);
    // Parallel index 0 vs 1 should have different trunk X coordinates to prevent wire overlap
    assert.notStrictEqual(route0[0]!.x, route1[0]!.x, "Parallel edges must not share the exact same trunk coordinate");
  });

  it("resolveNodePortWorldPoint and getPortOutwardNormal support percentage coordinate strings", () => {
    const node: any = {
      id: "comp1",
      x: 100,
      y: 200,
      width: 80,
      height: 60,
      getPosition: () => ({ x: 100, y: 200 }),
      getSize: () => ({ width: 80, height: 60 }),
      getBBox: () => ({ x: 100, y: 200, width: 80, height: 60 }),
      getPorts: () => [
        { id: "p_right", args: { x: "100%", y: "50%" } },
        { id: "p_top", args: { x: "50%", y: "0%" } },
        { id: "p_left", args: { x: "0%", y: "50%" } },
        { id: "p_bottom", args: { x: "50%", y: "100%" } },
      ],
      getPortProp: (portId: string) => {
        if (portId === "p_right") return { args: { x: "100%", y: "50%" } };
        if (portId === "p_top") return { args: { x: "50%", y: "0%" } };
        if (portId === "p_left") return { args: { x: "0%", y: "50%" } };
        if (portId === "p_bottom") return { args: { x: "50%", y: "100%" } };
        return null;
      },
    };

    // Right port: x = 100 + 80 = 180, y = 200 + 30 = 230, normal side = right
    const ptRight = resolveNodePortWorldPoint(node, "p_right");
    assert.deepStrictEqual(ptRight, { x: 180, y: 230 });
    const normRight = getPortOutwardNormal(node, "p_right");
    assert.strictEqual(normRight?.side, "right");

    // Top port: x = 100 + 40 = 140, y = 200 + 0 = 200, normal side = top
    const ptTop = resolveNodePortWorldPoint(node, "p_top");
    assert.deepStrictEqual(ptTop, { x: 140, y: 200 });
    const normTop = getPortOutwardNormal(node, "p_top");
    assert.strictEqual(normTop?.side, "top");

    // Left port: x = 100, y = 230, normal side = left
    const ptLeft = resolveNodePortWorldPoint(node, "p_left");
    assert.deepStrictEqual(ptLeft, { x: 100, y: 230 });
    const normLeft = getPortOutwardNormal(node, "p_left");
    assert.strictEqual(normLeft?.side, "left");

    // Bottom port: x = 140, y = 260, normal side = bottom
    const ptBottom = resolveNodePortWorldPoint(node, "p_bottom");
    assert.deepStrictEqual(ptBottom, { x: 140, y: 260 });
    const normBottom = getPortOutwardNormal(node, "p_bottom");
    assert.strictEqual(normBottom?.side, "bottom");
  });

  it("countPolylineWireCrossings detects Manhattan segment intersections and collinear overlaps", () => {
    const existing: PointLike[][] = [
      // Vertical wire at x=50, y from 0 to 100
      [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
      // Horizontal wire at y=200, x from 20 to 120
      [
        { x: 20, y: 200 },
        { x: 120, y: 200 },
      ],
    ];

    // Horizontal candidate crossing the vertical wire at (50, 40)
    const candCrossing: PointLike[] = [
      { x: 10, y: 40 },
      { x: 90, y: 40 },
    ];
    const statsCrossing = countPolylineWireCrossings(candCrossing, existing);
    assert.strictEqual(statsCrossing.crossings, 1, "Must detect 1 crossing");
    assert.strictEqual(statsCrossing.overlaps, 0, "No collinear overlap");

    // Horizontal candidate that does not cross either wire
    const candClear: PointLike[] = [
      { x: 60, y: 40 },
      { x: 90, y: 40 },
    ];
    const statsClear = countPolylineWireCrossings(candClear, existing);
    assert.strictEqual(statsClear.crossings, 0, "Must detect 0 crossings");
    assert.strictEqual(statsClear.overlaps, 0, "Must detect 0 overlaps");

    // Collinear horizontal wire overlapping with the wire at y=200
    const candOverlap: PointLike[] = [
      { x: 50, y: 200 },
      { x: 150, y: 200 },
    ];
    const statsOverlap = countPolylineWireCrossings(candOverlap, existing);
    assert.strictEqual(statsOverlap.overlaps, 1, "Must detect collinear overlap");
  });

  it("computeOrthogonalRoute chooses crossing-free candidate when existingWires are provided", () => {
    // Source at (0, 0), Target at (100, 100)
    // Candidate 1 (HV): (0, 0) -> (100, 0) -> (100, 100)
    // Candidate 2 (VH): (0, 0) -> (0, 100) -> (100, 100)
    // Vertical existing wire at x=50 from y=-20 to y=40 blocks Candidate 1's horizontal leg
    const existing: PointLike[][] = [
      [
        { x: 50, y: -20 },
        { x: 50, y: 40 },
      ],
    ];

    const route = computeOrthogonalRoute({ x: 0, y: 0 }, { x: 100, y: 100 }, [], {
      existingWires: existing,
    });

    // Without existingWires, default routeA would be [{ x: 50, y: 0 }, { x: 50, y: 100 }]
    // which overlaps with the vertical wire at x=50.
    // With existingWires, routeB [{ x: 0, y: 50 }, { x: 100, y: 50 }] is chosen to avoid the overlap.
    assert.deepStrictEqual(
      route,
      [
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ],
      "Must choose crossing- and overlap-free routeB over routeA",
    );
  });

  it("computeOrthogonalRoute with port outward normals chooses candidate with lowest wire crossings", () => {
    // Source port at (0, 0) facing right; target port at (100, 100) facing top
    // Existing wire crosses the top corridor at y=0 (x=50, y from -20 to 30)
    const existing: PointLike[][] = [
      [
        { x: 50, y: -20 },
        { x: 50, y: 30 },
      ],
    ];

    const route = computeOrthogonalRoute({ x: 0, y: 0 }, { x: 100, y: 100 }, [], {
      sourceSide: "right",
      targetSide: "top",
      existingWires: existing,
    });

    // The route must not cross the vertical wire at x=50, y in [-20, 30]
    for (let i = 0; i < route.length - 1; i++) {
      assert.strictEqual(
        countPolylineWireCrossings([route[i]!, route[i + 1]!], existing).crossings,
        0,
        "Intermediate route segment must not cross existing wire",
      );
    }
  });

  it("findInternalChannelRoute selects wire-free corridor when multiple corridors exist", () => {
    // Two corridors at y=100 and y=200 between three stacked blocks
    const obstacles: RectLike[] = [
      { x: 50, y: 0, width: 100, height: 80 },
      { x: 50, y: 120, width: 100, height: 60 },
      { x: 50, y: 220, width: 100, height: 80 },
    ];
    const source: PointLike = { x: 20, y: 150 };
    const target: PointLike = { x: 180, y: 150 };

    // Place an existing wire completely blocking the top corridor at y=100
    const existing: PointLike[][] = [
      [
        { x: 100, y: 85 },
        { x: 100, y: 115 },
      ],
    ];

    const route = findInternalChannelRoute(source, target, obstacles, 10, 35, existing);
    assert.ok(route, "Expected to find internal channel route");
    // Verify that the route avoided the top corridor wire
    const stats = countPolylineWireCrossings(route, existing);
    assert.strictEqual(stats.crossings, 0, "Channel route must not cross existing wire in blocked corridor");
    assert.strictEqual(stats.overlaps, 0, "Channel route must not overlap existing wire in blocked corridor");
  });

  it("preserves C-bend feedback detour around CriticalDamping1 & CriticalDamping2 without collapsing or rerouting existing wire", () => {
    // Exact geometry from Untitled feedback model:
    // CriticalDamping2 centered at (-85, 6) => bbox x: -95..-75, y: -4..16; u=(-97, 6) left, y=(-73, 6) right
    // CriticalDamping1 centered at (-13, 6) => bbox x: -23..-3,  y: -4..16; u=(-25, 6) left, y=(-1, 6)  right
    const boxCD2: RectLike = { x: -95, y: -4, width: 20, height: 20 };
    const boxCD1: RectLike = { x: -23, y: -4, width: 20, height: 20 };
    const obstacles: RectLike[] = [boxCD2, boxCD1];

    const makeBlockNode = (id: string, box: RectLike, uPt: PointLike, yPt: PointLike) => ({
      id,
      isNode: () => true,
      getPosition: () => ({ x: box.x, y: box.y }),
      getSize: () => ({ width: box.width, height: box.height }),
      getAngle: () => 0,
      getData: () => ({}),
      getPorts: () => [{ id: "u" }, { id: "y" }],
      getPortProp: (portId: string, prop?: string) => {
        const local = portId === "u" ? { x: uPt.x - box.x, y: uPt.y - box.y } : { x: yPt.x - box.x, y: yPt.y - box.y };
        if (prop === "args") return local;
        if (prop === "group") return portId === "u" ? "left" : "right";
        return { args: local };
      },
    });

    const nodeCD2 = makeBlockNode("CriticalDamping2", boxCD2, { x: -97, y: 6 }, { x: -73, y: 6 });
    const nodeCD1 = makeBlockNode("CriticalDamping1", boxCD1, { x: -25, y: 6 }, { x: -1, y: 6 });

    // Existing straight connection: CriticalDamping1.u (-25, 6) <-> CriticalDamping2.y (-73, 6)
    const existingEdgeVerts: PointLike[] = [];
    const edgeForward: any = {
      id: "edge_forward",
      isEdge: () => true,
      getSourceCellId: () => "CriticalDamping1",
      getTargetCellId: () => "CriticalDamping2",
      getSourcePortId: () => "u",
      getTargetPortId: () => "y",
      getSourcePoint: () => ({ x: -25, y: 6 }),
      getTargetPoint: () => ({ x: -73, y: 6 }),
      getVertices: () => existingEdgeVerts,
    };

    // Second feedback connection: CriticalDamping1.y (-1, 6) -> CriticalDamping2.u (-97, 6)
    const srcFeedback: PointLike = { x: -1, y: 6 };
    const tgtFeedback: PointLike = { x: -97, y: 6 };
    const edgeFeedback: any = {
      id: "edge_feedback",
      isEdge: () => true,
      getSourceCellId: () => "CriticalDamping1",
      getTargetCellId: () => "CriticalDamping2",
      getSourcePortId: () => "y",
      getTargetPortId: () => "u",
      getSourcePoint: () => srcFeedback,
      getTargetPoint: () => tgtFeedback,
      getVertices: () => [],
    };

    const mockGraph: any = {
      getNodes: () => [nodeCD2, nodeCD1],
      getEdges: () => [edgeForward, edgeFeedback],
      getCellById: (id: string) => (id === "CriticalDamping1" ? nodeCD1 : id === "CriticalDamping2" ? nodeCD2 : null),
    };

    const rawDetour = computeOrthogonalRoute(srcFeedback, tgtFeedback, obstacles, {
      padding: 10,
      sourceSide: "right",
      targetSide: "left",
      sourceBox: boxCD1,
      targetBox: boxCD2,
      existingWires: [
        [
          { x: -25, y: 6 },
          { x: -73, y: 6 },
        ],
      ],
    });

    assert.ok(rawDetour.length >= 4, `Expected 4-bend C-detour around both blocks, got ${JSON.stringify(rawDetour)}`);

    // Pruning intermediate vertices with full obstacle + port-normal awareness MUST preserve the C-detour
    const pruneOpts = extractEdgePruneOptions(mockGraph, edgeFeedback, srcFeedback, tgtFeedback);
    const pruned = pruneIntermediateVertices(srcFeedback, tgtFeedback, rawDetour, pruneOpts);
    assert.ok(
      pruned.length >= 4,
      `pruneIntermediateVertices must never collapse C-bend around obstacles into 0 vertices, got ${JSON.stringify(pruned)}`,
    );

    // Every segment of [srcFeedback, ...pruned, tgtFeedback] must avoid impaling either component interior
    const fullFeedbackPath = [srcFeedback, ...pruned, tgtFeedback];
    for (let i = 0; i < fullFeedbackPath.length - 1; i++) {
      assert.strictEqual(
        segmentIntersectsRect(fullFeedbackPath[i]!, fullFeedbackPath[i + 1]!, boxCD1, -1),
        false,
        `Segment ${i} impaled CriticalDamping1`,
      );
      assert.strictEqual(
        segmentIntersectsRect(fullFeedbackPath[i]!, fullFeedbackPath[i + 1]!, boxCD2, -1),
        false,
        `Segment ${i} impaled CriticalDamping2`,
      );
    }

    // Calling portOrthogonalRouter on explicit manual/saved C-bend vertices must ALSO preserve all 4 bends
    const routerPreserved = portOrthogonalRouter(
      pruned,
      { padding: 10 },
      {
        cell: edgeFeedback,
        sourcePoint: srcFeedback,
        targetPoint: tgtFeedback,
        graph: mockGraph,
      },
    );
    assert.strictEqual(routerPreserved.length, pruned.length, "portOrthogonalRouter must preserve explicit C-bend");

    // Existing forward connection must remain straight (0 bends) even if routed alongside edgeFeedback,
    // because edgeFeedback uses ports (y -> u) rather than duplicate parallel ports (u -> y)!
    const forwardRouted = portOrthogonalRouter(
      [],
      { padding: 10 },
      {
        cell: edgeForward,
        sourcePoint: { x: -25, y: 6 },
        targetPoint: { x: -73, y: 6 },
        graph: mockGraph,
      },
    );
    assert.deepStrictEqual(
      forwardRouted,
      [],
      "Existing straight connection on distinct ports (u->y vs y->u) must stay straight with 0 bends",
    );
  });

  it("produces strictly orthogonal waypoints with zero crooked/diagonal segments during live connection dragging", () => {
    const srcPortPoint = { x: 280, y: 230 };
    const staleTargetPoint = { x: 240, y: 560 }; // Previous frame mouse position
    const currentMousePoint = { x: 350, y: 760 }; // Current frame mouse position

    const mockSourceNode: any = {
      id: "PartialCompositeStep1",
      getBBox: () => ({ x: 280, y: 180, width: 100, height: 100 }),
      getPorts: () => [{ id: "in", args: { x: 0, y: 50 } }],
      getSize: () => ({ width: 100, height: 100 }),
      getPosition: () => ({ x: 280, y: 180 }),
    };

    const mockGraph: any = {
      getNodes: () => [mockSourceNode],
      getEdges: () => [],
      getCellById: (id: string) => (id === "PartialCompositeStep1" ? mockSourceNode : null),
    };

    const edgeViewLiveDrag: any = {
      sourceAnchor: srcPortPoint,
      targetAnchor: currentMousePoint,
      sourcePoint: srcPortPoint,
      targetPoint: staleTargetPoint, // Stale point from previous render frame
      graph: mockGraph,
      cell: {
        getSource: () => ({ cell: "PartialCompositeStep1", port: "in" }),
        getTarget: () => currentMousePoint,
        getSourceCell: () => mockSourceNode,
        getTargetCell: () => null,
      },
    };

    const waypoints = portOrthogonalRouter([], {}, edgeViewLiveDrag);
    const full = [srcPortPoint, ...waypoints, currentMousePoint];

    // Verify all consecutive segments are strictly horizontal or vertical
    assert.ok(full.length >= 2, "Path must contain at least source and target");
    for (let i = 0; i < full.length - 1; i++) {
      const p1 = full[i]!;
      const p2 = full[i + 1]!;
      const isHorizontal = Math.abs(p1.y - p2.y) < 0.1;
      const isVertical = Math.abs(p1.x - p2.x) < 0.1;
      assert.ok(
        isHorizontal || isVertical,
        `Segment ${i} from (${p1.x}, ${p1.y}) to (${p2.x}, ${p2.y}) is crooked/diagonal! Must be strictly 0° or 90°`,
      );
    }
  });
});
