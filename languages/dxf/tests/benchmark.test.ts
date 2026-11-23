// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeDxfGeometry,
  computeLwPolylineArea,
  computeLwPolylineLength,
  evaluateBulgeArc,
  expandDxfEntities,
  parseDxf,
} from "../src/index.js";

function assertRelErr(actual: number, expected: number, tolerance: number, label: string): void {
  const denom = Math.max(Math.abs(expected), 1);
  const relErr = Math.abs(actual - expected) / denom;
  assert.ok(
    relErr <= tolerance,
    `${label}: actual=${actual}, expected=${expected}, relErr=${relErr} > tolerance=${tolerance}`,
  );
}

/**
 * Builds a mechanical flange bracket DXF:
 * - Outer profile: W=120mm x H=80mm rounded rectangle with corner fillet radius R=10mm
 *   represented as a closed CCW LWPOLYLINE with 4 quarter-circle bulge segments (bulge = tan(pi/8)).
 * - Central bore: CIRCLE at (60, 40) with radius rBore=20mm.
 * - 4 corner bolt holes: BLOCK `M8_BOLT_HOLE` (CIRCLE r=4.5mm) instanced via 4 INSERTs at
 *   (15,15), (105,15), (105,65), (15,65).
 */
function buildFlangeBracketDxf(): string {
  const W = 120;
  const H = 80;
  const R = 10;
  const bulge90 = Math.tan(Math.PI / 8); // tan((pi/2)/4) for 90-deg CCW fillet

  return [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$ACADVER",
    "1",
    "AC1027",
    "9",
    "$INSUNITS",
    "70",
    "4",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "TABLES",
    "0",
    "TABLE",
    "2",
    "LAYER",
    "0",
    "LAYER",
    "2",
    "PROFILE",
    "62",
    "7",
    "6",
    "CONTINUOUS",
    "0",
    "LAYER",
    "2",
    "BORES",
    "62",
    "1",
    "6",
    "CONTINUOUS",
    "0",
    "ENDTAB",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "BLOCKS",
    "0",
    "BLOCK",
    "8",
    "0",
    "2",
    "M8_BOLT_HOLE",
    "10",
    "0",
    "20",
    "0",
    "30",
    "0",
    "0",
    "CIRCLE",
    "8",
    "BORES",
    "10",
    "0",
    "20",
    "0",
    "30",
    "0",
    "40",
    "4.5",
    "0",
    "ENDBLK",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    // Rounded-rectangle flange outline (CCW)
    "0",
    "LWPOLYLINE",
    "8",
    "PROFILE",
    "90",
    "8",
    "70",
    "1",
    "10",
    String(R),
    "20",
    "0",
    "42",
    "0",
    "10",
    String(W - R),
    "20",
    "0",
    "42",
    String(bulge90),
    "10",
    String(W),
    "20",
    String(R),
    "42",
    "0",
    "10",
    String(W),
    "20",
    String(H - R),
    "42",
    String(bulge90),
    "10",
    String(W - R),
    "20",
    String(H),
    "42",
    "0",
    "10",
    String(R),
    "20",
    String(H),
    "42",
    String(bulge90),
    "10",
    "0",
    "20",
    String(H - R),
    "42",
    "0",
    "10",
    "0",
    "20",
    String(R),
    "42",
    String(bulge90),
    // Central bore
    "0",
    "CIRCLE",
    "8",
    "BORES",
    "10",
    "60",
    "20",
    "40",
    "30",
    "0",
    "40",
    "20",
    // Four M8 bolt holes via INSERT
    "0",
    "INSERT",
    "8",
    "BORES",
    "2",
    "M8_BOLT_HOLE",
    "10",
    "15",
    "20",
    "15",
    "30",
    "0",
    "0",
    "INSERT",
    "8",
    "BORES",
    "2",
    "M8_BOLT_HOLE",
    "10",
    "105",
    "20",
    "15",
    "30",
    "0",
    "0",
    "INSERT",
    "8",
    "BORES",
    "2",
    "M8_BOLT_HOLE",
    "10",
    "105",
    "20",
    "65",
    "30",
    "0",
    "0",
    "INSERT",
    "8",
    "BORES",
    "2",
    "M8_BOLT_HOLE",
    "10",
    "15",
    "20",
    "65",
    "30",
    "0",
    "0",
    "ENDSEC",
    "0",
    "EOF",
  ].join("\n");
}

describe("DXF analytical geometry benchmarks", () => {
  it("matches analytical perimeter, area, and bounding box on mechanical flange bracket DXF", () => {
    const tolerance = 1e-9;
    const W = 120;
    const H = 80;
    const R = 10;
    const rBore = 20;
    const rBolt = 4.5;

    const doc = parseDxf(buildFlangeBracketDxf());
    const report = analyzeDxfGeometry(doc);

    // 1. Exact bounding box parity
    assertRelErr(report.boundingBox.minX, 0, tolerance, "bbox.minX");
    assertRelErr(report.boundingBox.minY, 0, tolerance, "bbox.minY");
    assertRelErr(report.boundingBox.maxX, W, tolerance, "bbox.maxX");
    assertRelErr(report.boundingBox.maxY, H, tolerance, "bbox.maxY");

    // 2. Exact perimeter parity:
    //    Rounded rectangle perimeter = 2*(W - 2R) + 2*(H - 2R) + 2*pi*R
    //    Central bore circumference  = 2*pi*rBore
    //    4 bolt hole circumferences  = 4 * 2*pi*rBolt
    const expectedOutlinePerim = 2 * (W - 2 * R) + 2 * (H - 2 * R) + 2 * Math.PI * R;
    const expectedTotalPath = expectedOutlinePerim + 2 * Math.PI * rBore + 4 * 2 * Math.PI * rBolt;
    assertRelErr(report.totalPathLength, expectedTotalPath, tolerance, "flange.totalPathLength");

    // 3. Exact enclosed area parity:
    //    Rounded rectangle area = W*H - (4 - pi)*R^2
    //    Bore + 4 bolt holes    = pi*rBore^2 + 4*pi*rBolt^2
    const expectedOuterArea = W * H - (4 - Math.PI) * R * R;
    const expectedHolesArea = Math.PI * rBore * rBore + 4 * Math.PI * rBolt * rBolt;
    const outerEntry = report.enclosedAreasByEntity.find((e) => e.type === "LWPOLYLINE");
    assert.ok(outerEntry);
    assertRelErr(outerEntry.area, expectedOuterArea, tolerance, "flange.outerArea");
    assertRelErr(
      report.totalEnclosedArea,
      expectedOuterArea + expectedHolesArea,
      tolerance,
      "flange.totalEnclosedArea",
    );
  });

  it("matches analytical LWPOLYLINE bulge arc length and circular segment area across sweep angles", () => {
    const tolerance = 1e-10;
    const testCases = [
      { label: "quarter-circle CCW", chord: 10, sweepRad: Math.PI / 2 },
      { label: "semicircle CCW", chord: 20, sweepRad: Math.PI },
      { label: "120-deg CW", chord: 15, sweepRad: -(2 * Math.PI) / 3 },
      { label: "270-deg CCW", chord: 12, sweepRad: (3 * Math.PI) / 2 },
    ];

    for (const tc of testCases) {
      const bulge = Math.tan(tc.sweepRad / 4);
      const absTheta = Math.abs(tc.sweepRad);
      const expectedRadius = tc.chord / (2 * Math.sin(absTheta / 2));
      const expectedArcLen = expectedRadius * absTheta;

      const arc = evaluateBulgeArc({ x: 0, y: 0 }, { x: tc.chord, y: 0 }, bulge);
      assert.ok(arc, `Expected non-null bulge arc for ${tc.label}`);
      assertRelErr(arc.radius, expectedRadius, tolerance, `${tc.label}.radius`);
      assertRelErr(arc.arcLength, expectedArcLen, tolerance, `${tc.label}.arcLength`);

      // Verify stadium (2 straight edges + 2 semicircular caps) via computeLwPolylineLength & Area
      const stadium = {
        type: "LWPOLYLINE" as const,
        layer: "0",
        line: 1,
        startOffset: 0,
        endOffset: 1,
        closed: true,
        elevation: 0,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 30, y: 0, bulge: 1 },
          { x: 30, y: 10, bulge: 0 },
          { x: 0, y: 10, bulge: 1 },
        ],
      };
      const expectedStadiumPerim = 2 * 30 + 2 * Math.PI * 5;
      const expectedStadiumArea = 30 * 10 + Math.PI * 25;
      assertRelErr(computeLwPolylineLength(stadium), expectedStadiumPerim, tolerance, "stadium.perimeter");
      assertRelErr(computeLwPolylineArea(stadium), expectedStadiumArea, tolerance, "stadium.area");
    }
  });

  it("matches analytical hierarchical nested INSERT transforms (base point, scale, rotation, translation)", () => {
    const tolerance = 1e-9;
    // Leaf block `SEG`: LINE from (2, 1, 0) to (6, 1, 0), base point (2, 1, 0) -> local vector (0,0)->(4,0)
    // Mid block `PAIR`: INSERT `SEG` at (10, 0) scaled 2x, rotated 90 deg CCW -> segment (10,0)->(10,8)
    // Top INSERT `PAIR`: at (5, 5), scaled 0.5x, rotated -90 deg (270 deg) ->
    //   (10,0) -> scale 0.5 -> (5,0) -> rot -90 -> (0,-5) -> + (5,5) = (5, 0)
    //   (10,8) -> scale 0.5 -> (5,4) -> rot -90 -> (4,-5) -> + (5,5) = (9, 0)
    const nestedDxf = [
      "0",
      "SECTION",
      "2",
      "BLOCKS",
      "0",
      "BLOCK",
      "2",
      "SEG",
      "10",
      "2",
      "20",
      "1",
      "30",
      "0",
      "0",
      "LINE",
      "8",
      "0",
      "10",
      "2",
      "20",
      "1",
      "30",
      "0",
      "11",
      "6",
      "21",
      "1",
      "31",
      "0",
      "0",
      "ENDBLK",
      "0",
      "BLOCK",
      "2",
      "PAIR",
      "10",
      "0",
      "20",
      "0",
      "30",
      "0",
      "0",
      "INSERT",
      "2",
      "SEG",
      "10",
      "10",
      "20",
      "0",
      "30",
      "0",
      "41",
      "2",
      "42",
      "2",
      "43",
      "1",
      "50",
      "90",
      "0",
      "ENDBLK",
      "0",
      "ENDSEC",
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "INSERT",
      "2",
      "PAIR",
      "10",
      "5",
      "20",
      "5",
      "30",
      "0",
      "41",
      "0.5",
      "42",
      "0.5",
      "43",
      "1",
      "50",
      "270",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n");

    const doc = parseDxf(nestedDxf);
    const flat = expandDxfEntities(doc);
    assert.equal(flat.length, 1);
    const line = flat[0];
    assert.equal(line?.type, "LINE");
    if (line?.type === "LINE") {
      assertRelErr(line.start.x, 5, tolerance, "nested.start.x");
      assert.ok(Math.abs(line.start.y) <= tolerance, `nested.start.y=${line.start.y}`);
      assertRelErr(line.end.x, 9, tolerance, "nested.end.x");
      assert.ok(Math.abs(line.end.y) <= tolerance, `nested.end.y=${line.end.y}`);
    }

    const report = analyzeDxfGeometry(doc);
    assertRelErr(report.totalPathLength, 4.0, tolerance, "nested.totalPathLength");
    assertRelErr(report.boundingBox.minX, 5.0, tolerance, "nested.bbox.minX");
    assertRelErr(report.boundingBox.maxX, 9.0, tolerance, "nested.bbox.maxX");
  });
});
