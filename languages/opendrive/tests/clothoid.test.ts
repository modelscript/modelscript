// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  evaluateClothoid,
  evaluateGeometry,
  integrateClothoidGL16,
  sampleRoadTrack,
  sampleRoadTrackFlat,
} from "../src/geometry/clothoid.js";
import type {
  OpenDriveArcGeometry,
  OpenDriveLineGeometry,
  OpenDriveRoad,
  OpenDriveSpiralGeometry,
} from "../src/types.js";

const dummyRange = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
  startOffset: 0,
  endOffset: 0,
};

describe("Analytical Clothoid & Geometry Kernel", () => {
  it("evaluates straight line geometry accurately", () => {
    const line: OpenDriveLineGeometry = {
      type: "line",
      s: 0.0,
      x: 100.0,
      y: 50.0,
      hdg: 0.0,
      length: 100.0,
      range: dummyRange,
    };

    const p0 = evaluateGeometry(line, 0.0);
    assert.strictEqual(p0.x, 100.0);
    assert.strictEqual(p0.y, 50.0);
    assert.strictEqual(p0.curvature, 0.0);

    const p50 = evaluateGeometry(line, 50.0);
    assert.strictEqual(p50.x, 150.0);
    assert.strictEqual(p50.y, 50.0);
  });

  it("evaluates circular arc geometry with constant curvature", () => {
    const arc: OpenDriveArcGeometry = {
      type: "arc",
      s: 0.0,
      x: 0.0,
      y: 0.0,
      hdg: 0.0,
      length: 50.0,
      curvature: 0.01, // Radius = 100m
      range: dummyRange,
    };

    const p = evaluateGeometry(arc, 50.0);
    assert.strictEqual(p.curvature, 0.01);
    // Heading at s=50 with curvature 0.01 is hdg0 + k*s = 0 + 0.5 = 0.5 rad
    assert(Math.abs(p.hdg - 0.5) < 1e-6);
    // x = R * sin(0.5) = 100 * sin(0.5) ~ 47.942m
    assert(Math.abs(p.x - 100 * Math.sin(0.5)) < 1e-4);
    // y = -R * (cos(0.5) - 1) = 100 * (1 - cos(0.5)) ~ 12.241m
    assert(Math.abs(p.y - 100 * (1 - Math.cos(0.5))) < 1e-4);
  });

  it("evaluates Euler spiral (clothoid) via Gauss-Legendre quadrature", () => {
    const spiral: OpenDriveSpiralGeometry = {
      type: "spiral",
      s: 0.0,
      x: 0.0,
      y: 0.0,
      hdg: 0.0,
      length: 100.0,
      curvStart: 0.0,
      curvEnd: 0.02,
      range: dummyRange,
    };

    const p0 = evaluateGeometry(spiral, 0.0);
    assert.strictEqual(p0.curvature, 0.0);
    assert.strictEqual(p0.x, 0.0);
    assert.strictEqual(p0.y, 0.0);

    const p100 = evaluateGeometry(spiral, 100.0);
    assert.strictEqual(p100.curvature, 0.02);
    // Heading at s=100 with linear curvature 0->0.02 is 0.5 * kDot * s^2 = 0.5 * 0.0002 * 10000 = 1.0 rad
    assert(Math.abs(p100.hdg - 1.0) < 1e-5);
    assert(p100.x > 0);
    assert(p100.y > 0);
  });

  it("samples 3D spatial track trajectory along complete road", () => {
    const road: OpenDriveRoad = {
      id: "R1",
      length: 200.0,
      junction: "-1",
      planView: [
        {
          type: "line",
          s: 0.0,
          x: 0.0,
          y: 0.0,
          hdg: 0.0,
          length: 100.0,
          range: dummyRange,
        },
        {
          type: "arc",
          s: 100.0,
          x: 100.0,
          y: 0.0,
          hdg: 0.0,
          length: 100.0,
          curvature: 0.01,
          range: dummyRange,
        },
      ],
      elevationProfile: [
        {
          s: 0.0,
          a: 5.0,
          b: 0.05,
          c: 0.0,
          d: 0.0,
          range: dummyRange,
        },
      ],
      lateralProfile: [
        {
          s: 0.0,
          a: 0.02,
          b: 0.0,
          c: 0.0,
          d: 0.0,
          range: dummyRange,
        },
      ],
      lanes: { laneSections: [] },
      signals: [],
      range: dummyRange,
    };

    const track = sampleRoadTrack(road, 50.0);
    assert.strictEqual(track.length, 5); // s = 0, 50, 100, 150, 200

    assert.strictEqual(track[0]!.s, 0.0);
    assert.strictEqual(track[0]!.z, 5.0);
    assert.strictEqual(track[0]!.roll, 0.02);

    assert.strictEqual(track[2]!.s, 100.0);
    // z at s=100 is 5.0 + 0.05*100 = 10.0m
    assert(Math.abs(track[2]!.z - 10.0) < 1e-4);
  });

  it("evaluates clothoid directly using vectorized GL16 quadrature", () => {
    const c = evaluateClothoid(10.0, 20.0, 0.5, 0.0, 0.01, 100.0, 100.0);
    assert.strictEqual(c.curvature, 0.01);
    assert(c.x > 10.0);
    assert(c.y > 20.0);

    const [x16, y16] = integrateClothoidGL16(10.0, 20.0, 0.5, 0.0, 0.0001, 100.0);
    assert(Math.abs(c.x - x16) < 1e-9);
    assert(Math.abs(c.y - y16) < 1e-9);
  });

  it("samples road trajectory into flat Float64Array with zero heap allocations", () => {
    const road: OpenDriveRoad = {
      id: "R_FLAT",
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
          type: "spiral",
          s: 50.0,
          x: 50.0,
          y: 0.0,
          hdg: 0.0,
          length: 50.0,
          curvStart: 0.0,
          curvEnd: 0.01,
          range: dummyRange,
        },
      ],
      elevationProfile: [],
      lateralProfile: [],
      lanes: { laneSections: [] },
      signals: [],
      range: dummyRange,
    };

    const flat = sampleRoadTrackFlat(road, 25.0);
    // Points at s = 0, 25, 50, 75, 100 -> 5 points * 8 entries = 40 floats
    assert.strictEqual(flat.length, 40);

    // Point 0 (s = 0): [s, x, y, z, hdg, curvature, roll, pitch]
    assert.strictEqual(flat[0], 0.0);
    assert.strictEqual(flat[1], 0.0); // x
    assert.strictEqual(flat[2], 0.0); // y

    // Point 2 (s = 50): line end
    assert.strictEqual(flat[16], 50.0); // s
    assert.strictEqual(flat[17], 50.0); // x

    // Point 4 (s = 100): spiral end
    assert.strictEqual(flat[32], 100.0); // s
    assert(flat[33]! > 50.0); // x advances
    assert.strictEqual(flat[37], 0.01); // curvature at end of spiral
  });
});
