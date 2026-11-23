// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMtl, parseObj, parseObjWithMtl } from "../src/parser/index.js";

describe("Wavefront OBJ & MTL Parsers", () => {
  it("parses vertices, texcoords, normals, param vertices, objects, groups, and smoothing", () => {
    const src = [
      "# Sample Wavefront OBJ",
      "mtllib materials.mtl",
      "o Bracket",
      "g Base SideA",
      "usemtl Aluminum",
      "s 1",
      "v 0 0 0",
      "v 1 0 0 1.0",
      "v 1 1 0",
      "v 0 1 0",
      "vt 0.0 0.0",
      "vt 1.0 0.0 0.0",
      "vt 1.0 1.0",
      "vt 0.0 1.0",
      "vn 0 0 1",
      "vp 0.5 0.5",
      "f 1/1/1 2/2/1 3/3/1 4/4/1",
      "s off",
      "l 1/1 2/2 3/3",
      "p 1 2 3 4",
    ].join("\n");

    const doc = parseObj(src);
    assert.equal(doc.errors.length, 0);
    assert.equal(doc.vertices.length, 4);
    assert.equal(doc.vertices[1]?.w, 1.0);
    assert.equal(doc.texCoords.length, 4);
    assert.equal(doc.normals.length, 1);
    assert.equal(doc.paramVertices.length, 1);
    assert.equal(doc.objects.length, 1);
    assert.equal(doc.objects[0]?.name, "Bracket");
    assert.equal(doc.groups.length, 2);
    assert.deepEqual(doc.mtlLibs, ["materials.mtl"]);
    assert.equal(doc.faces.length, 1);
    assert.equal(doc.faces[0]?.vertices.length, 4);
    assert.equal(doc.faces[0]?.smoothingGroup, 1);
    assert.equal(doc.faces[0]?.materialName, "Aluminum");
    assert.equal(doc.polylines.length, 1);
    assert.equal(doc.polylines[0]?.vertices.length, 3);
    assert.equal(doc.points.length, 1);
    assert.equal(doc.points[0]?.vertices.length, 4);
  });

  it("supports all face index formats: v, v/vt, v//vn, v/vt/vn and negative relative indices", () => {
    const src = [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "vt 0 0",
      "vt 1 0",
      "vt 0 1",
      "vn 0 0 1",
      "f 1 2 3",
      "f 1/1 2/2 3/3",
      "f 1//1 2//1 3//1",
      "f 1/1/1 2/2/1 3/3/1",
      "f -3/-3/-1 -2/-2/-1 -1/-1/-1",
    ].join("\n");

    const doc = parseObj(src);
    assert.equal(doc.errors.length, 0);
    assert.equal(doc.faces.length, 5);

    // Positive v/vt/vn
    const fPos = doc.faces[3]!;
    assert.deepEqual(
      fPos.vertices.map((r) => [r.v, r.vt, r.vn]),
      [
        [0, 0, 0],
        [1, 1, 0],
        [2, 2, 0],
      ],
    );

    // Negative relative indices resolve identically
    const fNeg = doc.faces[4]!;
    assert.deepEqual(
      fNeg.vertices.map((r) => [r.v, r.vt, r.vn]),
      [
        [0, 0, 0],
        [1, 1, 0],
        [2, 2, 0],
      ],
    );
  });

  it("supports backslash line continuations", () => {
    const src = ["v 0 0 0", "v 1 0 0", "v 1 1 0", "v 0 1 0", "f 1 2 \\", "  3 4"].join("\n");

    const doc = parseObj(src);
    assert.equal(doc.errors.length, 0);
    assert.equal(doc.faces.length, 1);
    assert.equal(doc.faces[0]?.vertices.length, 4);
  });

  it("parses companion Wavefront MTL libraries with Ka, Kd, Ks, Ke, Ns, d, Tr, Ni, illum", () => {
    const mtlSrc = [
      "# Engineering materials",
      "newmtl Copper",
      "Ka 0.22 0.11 0.07",
      "Kd 0.85 0.45 0.30",
      "Ks 0.95 0.64 0.54",
      "Ke 0.0 0.0 0.0",
      "Ns 200.0",
      "d 1.0",
      "Ni 1.10",
      "illum 2",
      "map_Kd copper_albedo.png",
      "",
      "newmtl Glass",
      "Kd 0.88 0.95 0.98",
      "Tr 0.75",
      "Ni 1.52",
      "illum 4",
    ].join("\n");

    const mtl = parseMtl(mtlSrc);
    assert.equal(mtl.errors.length, 0);
    assert.equal(mtl.materials.size, 2);

    const copper = mtl.materials.get("Copper")!;
    assert.deepEqual(copper.Kd, [0.85, 0.45, 0.3]);
    assert.equal(copper.Ns, 200);
    assert.equal(copper.d, 1.0);
    assert.equal(copper.Ni, 1.1);
    assert.equal(copper.illum, 2);
    assert.equal(copper.mapKd, "copper_albedo.png");

    const glass = mtl.materials.get("Glass")!;
    assert.ok(Math.abs((glass.d ?? 0) - 0.25) < 1e-12);
    assert.equal(glass.Tr, 0.75);
    assert.equal(glass.illum, 4);

    const { obj } = parseObjWithMtl("v 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl Copper\nf 1 2 3\n", mtlSrc);
    assert.equal(obj.materials?.get("Copper")?.illum, 2);
  });
});
