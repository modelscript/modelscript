// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeDxfGeometry,
  evaluateBulgeArc,
  expandDxfEntities,
  lowerDxfToCad,
  parseDxf,
  sampleBulgeArc,
  triangulate3DFace,
} from "../src/index.js";

const CAD_DXF = [
  "0",
  "SECTION",
  "2",
  "BLOCKS",
  "0",
  "BLOCK",
  "2",
  "PIN",
  "10",
  "0",
  "20",
  "0",
  "30",
  "0",
  "0",
  "CIRCLE",
  "8",
  "PINS",
  "10",
  "0",
  "20",
  "0",
  "30",
  "0",
  "40",
  "3.0",
  "0",
  "ENDBLK",
  "0",
  "ENDSEC",
  "0",
  "SECTION",
  "2",
  "ENTITIES",
  "0",
  "LWPOLYLINE",
  "8",
  "PLATE",
  "70",
  "1",
  "38",
  "0.0",
  "10",
  "0",
  "20",
  "0",
  "10",
  "40",
  "20",
  "0",
  "10",
  "40",
  "20",
  "20",
  "10",
  "0",
  "20",
  "20",
  "0",
  "INSERT",
  "8",
  "PINS",
  "2",
  "PIN",
  "10",
  "10",
  "20",
  "10",
  "30",
  "0",
  "41",
  "1",
  "42",
  "1",
  "43",
  "1",
  "50",
  "0",
  "0",
  "3DFACE",
  "8",
  "MESH",
  "10",
  "0",
  "20",
  "0",
  "30",
  "10",
  "11",
  "40",
  "21",
  "0",
  "31",
  "10",
  "12",
  "40",
  "22",
  "20",
  "32",
  "10",
  "13",
  "0",
  "23",
  "20",
  "33",
  "10",
  "0",
  "ENDSEC",
  "0",
  "EOF",
].join("\n");

describe("DXF CAD & geometry lowering", () => {
  it("evaluates exact bulge arc geometry and samples intermediate points", () => {
    const arc = evaluateBulgeArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 1.0);
    assert.ok(arc);
    assert.ok(Math.abs(arc.radius - 5.0) < 1e-9);
    assert.ok(Math.abs(arc.center.x - 5.0) < 1e-9);
    assert.ok(Math.abs(arc.center.y - 0.0) < 1e-9);
    assert.ok(Math.abs(arc.arcLength - Math.PI * 5.0) < 1e-9);

    const sampled = sampleBulgeArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 1.0, 16);
    assert.equal(sampled.length, 9);
    assert.ok(Math.abs((sampled[4]?.y ?? 0) + 5.0) < 1e-9);
  });

  it("triangulates planar quad 3DFACE into two triangles with exact area", () => {
    const tris = triangulate3DFace({
      type: "3DFACE",
      layer: "MESH",
      line: 1,
      startOffset: 0,
      endOffset: 1,
      invisibleEdgeFlags: 0,
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 5, z: 0 },
        { x: 0, y: 5, z: 0 },
      ],
    });
    assert.equal(tris.length, 2);
    const totalArea = tris.reduce((acc, t) => acc + t.area, 0);
    assert.ok(Math.abs(totalArea - 50.0) < 1e-9);
  });

  it("expands INSERT blocks and computes geometry report metrics", () => {
    const doc = parseDxf(CAD_DXF);
    const flat = expandDxfEntities(doc);
    assert.equal(flat.length, 3);
    assert.deepEqual(
      flat.map((e) => e.type),
      ["LWPOLYLINE", "CIRCLE", "3DFACE"],
    );

    const report = analyzeDxfGeometry(doc);
    assert.equal(report.boundingBox.minX, 0);
    assert.equal(report.boundingBox.maxX, 40);
    assert.equal(report.boundingBox.minY, 0);
    assert.equal(report.boundingBox.maxY, 20);
    assert.equal(report.boundingBox.minZ, 0);
    assert.equal(report.boundingBox.maxZ, 10);

    // 40x20 rectangle (800) + radius-3 circle (9*pi)
    const expectedArea = 800 + Math.PI * 9;
    assert.ok(Math.abs(report.totalEnclosedArea - expectedArea) < 1e-6);
    assert.equal(report.meshTriangles.length, 2);
    assert.ok(Math.abs(report.totalMeshSurfaceArea - 800) < 1e-6);
  });

  it("lowers LWPOLYLINE, CIRCLE, and 3DFACE into @modelscript/cad Assembly solids", () => {
    const doc = parseDxf(CAD_DXF);
    const lowered = lowerDxfToCad(doc, {
      assemblyName: "BracketAssembly",
      extrusionHeight: 8,
      arcSegments: 24,
    });
    assert.equal(lowered.assembly.name, "BracketAssembly");
    assert.equal(lowered.solids.length, 3);
    assert.equal(lowered.assembly.parts.length, 3);
  });
});
