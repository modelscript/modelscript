// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  evaluateClothoid,
  evaluateElevation,
  evaluateGeometry,
  evaluateSpiral,
  evaluateSuperelevation,
  sampleRoadPose,
  sampleRoadTrack,
  worldToFrenet,
} from "../src/geometry/clothoid.js";
import type {
  OpenDriveArcGeometry,
  OpenDriveElevationRecord,
  OpenDriveLineGeometry,
  OpenDriveRange,
  OpenDriveRoad,
  OpenDriveSpiralGeometry,
  OpenDriveSuperelevationRecord,
} from "../src/types.js";

const dummyRange: OpenDriveRange = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 10,
  startOffset: 0,
  endOffset: 50,
};

describe("OpenDRIVE Analytical Geometry & Fresnel Clothoid Kernel", () => {
  it("evaluates straight line geometry accurately", () => {
    const line: OpenDriveLineGeometry = {
      type: "line",
      s: 0.0,
      x: 100.0,
      y: 200.0,
      hdg: 0.0, // pointing East (+X)
      length: 50.0,
      range: dummyRange,
    };

    const res0 = evaluateGeometry(line, 0.0);
    assert.strictEqual(res0.x, 100.0);
    assert.strictEqual(res0.y, 200.0);
    assert.strictEqual(res0.hdg, 0.0);
    assert.strictEqual(res0.curvature, 0.0);

    const res50 = evaluateGeometry(line, 50.0);
    assert.strictEqual(res50.x, 150.0);
    assert.strictEqual(res50.y, 200.0);
    assert.strictEqual(res50.hdg, 0.0);
    assert.strictEqual(res50.curvature, 0.0);
  });

  it("evaluates circular arc geometry with exact radius", () => {
    const R = 100.0;
    const k = 1.0 / R; // curvature 0.01 1/m
    const arc: OpenDriveArcGeometry = {
      type: "arc",
      s: 0.0,
      x: 0.0,
      y: 0.0,
      hdg: 0.0,
      length: (Math.PI / 2) * R, // quarter circle = 50 * pi
      curvature: k,
      range: dummyRange,
    };

    const res = evaluateGeometry(arc, arc.length);
    // After 90 degree left turn of radius 100m starting at (0,0) facing +X:
    // center is at (0, 100), end is at (100, 100), heading is pi/2
    assert(Math.abs(res.x - 100.0) < 1e-4, `Expected x ~ 100, got ${res.x}`);
    assert(Math.abs(res.y - 100.0) < 1e-4, `Expected y ~ 100, got ${res.y}`);
    assert(Math.abs(res.hdg - Math.PI / 2) < 1e-4, `Expected hdg ~ pi/2, got ${res.hdg}`);
    assert.strictEqual(res.curvature, k);
  });

  it("integrates Euler spiral (clothoid) via 16-point Gauss-Legendre quadrature", () => {
    const spiral: OpenDriveSpiralGeometry = {
      type: "spiral",
      s: 0.0,
      x: 0.0,
      y: 0.0,
      hdg: 0.0,
      length: 50.0,
      curvStart: 0.0,
      curvEnd: 0.02, // linearly increasing curvature
      range: dummyRange,
    };

    const resMid = evaluateGeometry(spiral, 25.0);
    assert.strictEqual(resMid.curvature, 0.01);
    assert(resMid.x > 0);
    assert(resMid.y > 0);

    const resEnd = evaluateGeometry(spiral, 50.0);
    assert.strictEqual(resEnd.curvature, 0.02);
    // Heading at end = hdg0 + 0.5 * kDot * L^2 = 0.5 * (0.02/50) * 2500 = 0.5 rad
    assert(Math.abs(resEnd.hdg - 0.5) < 1e-4, `Expected hdg ~ 0.5 rad, got ${resEnd.hdg}`);
  });

  it("evaluates polynomial elevation profile z(s), slope, and pitch", () => {
    const elevRecords: OpenDriveElevationRecord[] = [
      {
        s: 0.0,
        a: 10.0, // base elevation 10m
        b: 0.05, // 5% grade slope
        c: 0.0,
        d: 0.0,
        range: dummyRange,
      },
    ];

    const elev0 = evaluateElevation(elevRecords, 0.0);
    assert.strictEqual(elev0.z, 10.0);
    assert.strictEqual(elev0.slope, 0.05);
    assert(Math.abs(elev0.pitch - Math.atan(0.05)) < 1e-6);

    const elev100 = evaluateElevation(elevRecords, 100.0);
    assert.strictEqual(elev100.z, 15.0); // 10 + 0.05 * 100
    assert.strictEqual(elev100.slope, 0.05);
  });

  it("evaluates superelevation (cross-fall banking angle)", () => {
    const seRecords: OpenDriveSuperelevationRecord[] = [
      {
        s: 0.0,
        a: 0.02, // 2% crossfall (~0.02 rad)
        b: 0.0004,
        c: 0.0,
        d: 0.0,
        range: dummyRange,
      },
    ];

    const se0 = evaluateSuperelevation(seRecords, 0.0);
    assert.strictEqual(se0, 0.02);

    const se50 = evaluateSuperelevation(seRecords, 50.0);
    assert.strictEqual(se50, 0.04);
  });

  it("samples 3D spatial track trajectory along composite road", () => {
    const road: OpenDriveRoad = {
      id: "road_1",
      length: 100.0,
      junction: "-1",
      planView: [
        {
          type: "line",
          s: 0.0,
          x: 0.0,
          y: 0.0,
          hdg: 0.0,
          length: 50.0,
          range: dummyRange,
        },
        {
          type: "arc",
          s: 50.0,
          x: 50.0,
          y: 0.0,
          hdg: 0.0,
          length: 50.0,
          curvature: 0.01,
          range: dummyRange,
        },
      ],
      elevationProfile: [
        {
          s: 0.0,
          a: 5.0,
          b: 0.02,
          c: 0.0,
          d: 0.0,
          range: dummyRange,
        },
      ],
      lateralProfile: [],
      lanes: {
        laneSections: [
          {
            s: 0.0,
            leftLanes: [],
            centerLane: { id: 0, type: "none", widthRecords: [], range: dummyRange },
            rightLanes: [
              {
                id: -1,
                type: "driving",
                widthRecords: [{ sOffset: 0.0, a: 3.5, b: 0, c: 0, d: 0 }],
                range: dummyRange,
              },
            ],
            range: dummyRange,
          },
        ],
      },
      signals: [],
      range: dummyRange,
    };

    const points = sampleRoadTrack(road, 10.0);
    assert(points.length >= 10);
    assert.strictEqual(points[0]!.s, 0.0);
    assert.strictEqual(points[0]!.x, 0.0);
    assert.strictEqual(points[0]!.z, 5.0);

    const last = points[points.length - 1]!;
    assert(Math.abs(last.s - 100.0) < 1e-4);
    assert(last.x > 50.0);
    assert(last.y > 0.0);
    assert(last.z > 6.9);
  });

  it("evaluates 8-point Gauss-Legendre clothoid quadrature (evaluateSpiral) and sampleRoadPose with lateral banking", () => {
    const gl8 = evaluateSpiral(0.0, 0.0, 0.0, 0.0, 0.02, 50.0, 35.0);
    const gl16 = evaluateClothoid(0.0, 0.0, 0.0, 0.0, 0.02, 50.0, 35.0);
    assert(Math.abs(gl8.x - gl16.x) < 1e-5);
    assert(Math.abs(gl8.y - gl16.y) < 1e-5);
    assert(Math.abs(gl8.hdg - gl16.hdg) < 1e-12);
    assert(Math.abs(gl8.curvature - gl16.curvature) < 1e-12);

    const road: OpenDriveRoad = {
      id: "R_Spiral",
      name: "SpiralRoad",
      length: 100.0,
      junction: "-1",
      planView: [
        {
          type: "spiral",
          s: 0.0,
          x: 0.0,
          y: 0.0,
          hdg: 0.0,
          length: 100.0,
          curvStart: 0.0,
          curvEnd: 0.01,
          range: dummyRange,
        },
      ],
      elevationProfile: [{ s: 0.0, a: 10.0, b: 0.05, c: 0.001, d: 0.0, range: dummyRange }],
      lateralProfile: [{ s: 0.0, a: 0.1, b: 0.0, c: 0.0, d: 0.0, range: dummyRange }],
      lanes: [
        {
          s: 0.0,
          leftLanes: [
            { id: 1, type: "driving", widths: [{ sOffset: 0, a: 3.5, b: 0, c: 0, d: 0 }], range: dummyRange },
          ],
          centerLane: { id: 0, type: "none", widths: [], range: dummyRange },
          rightLanes: [
            { id: -1, type: "driving", widths: [{ sOffset: 0, a: 3.5, b: 0, c: 0, d: 0 }], range: dummyRange },
          ],
          range: dummyRange,
        },
      ],
      signals: [],
      range: dummyRange,
    };

    // Sample pose at s = 40.0, lateral offset t = -1.75 (center of right lane -1)
    const poseCenter = sampleRoadPose(road, 40.0, 0.0);
    const poseOffset = sampleRoadPose(road, 40.0, -1.75);
    assert(Math.abs(poseCenter.z - (10.0 + 0.05 * 40 + 0.001 * 1600)) < 1e-9);
    assert(Math.abs(poseOffset.z - (poseCenter.z - 1.75 * Math.sin(0.1))) < 1e-9);

    // Project offset world point back to Frenet coordinates via Newton-Raphson
    const xWorld = poseCenter.x - -1.75 * Math.sin(poseCenter.hdg);
    const yWorld = poseCenter.y + -1.75 * Math.cos(poseCenter.hdg);
    const frenet = worldToFrenet(road, xWorld, yWorld);
    assert.strictEqual(frenet.roadId, "R_Spiral");
    assert(Math.abs(frenet.s - 40.0) < 1e-5, `Expected s ~ 40.0, got ${frenet.s}`);
    assert(Math.abs(frenet.t - -1.75) < 1e-5, `Expected t ~ -1.75, got ${frenet.t}`);
    assert.strictEqual(frenet.laneId, -1);
  });
});
