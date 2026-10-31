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
  getPortOutwardNormal,
  healOrthogonalVertices,
  portOrthogonalRouter,
  regularizeOrthogonalPolyline,
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
});
