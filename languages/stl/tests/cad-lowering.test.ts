// SPDX-License-Identifier: AGPL-3.0-or-later

import { SolidKind } from "@modelscript/cad";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOctahedronStl,
  buildUnitCubeStl,
  cadSolidToStl,
  computeStlMassProperties,
  stlToCadSolid,
  stlToDae,
  stlToObj,
  stlToStep,
  stlToSvg,
} from "../src/index.js";

describe("@modelscript/stl — CAD Lowering, DAE Rigid-Body & Polyglot Projections", () => {
  it("lowers a unit cube STL to @modelscript/cad PolyhedronSolid with 8 welded vertices and 12 faces", () => {
    const cube = buildUnitCubeStl(1.0, "UnitCube");
    const solid = stlToCadSolid(cube);

    assert.equal(solid.kind, SolidKind.Polyhedron);
    assert.equal(solid.name, "UnitCube");
    assert.equal(solid.points.length, 8);
    assert.equal(solid.faces.length, 12);

    const roundTripped = cadSolidToStl(solid);
    const props = computeStlMassProperties(roundTripped);
    assert.ok(Math.abs(props.volume - 1.0) < 1e-12);
  });

  it("lowers STL rigid-body mass, centroid, and inertia tensor directly into DAEBuilder", () => {
    const cube = buildUnitCubeStl(2.0, "SteelCube");
    const dae = stlToDae(cube, { density: 7850 });

    assert.ok(dae.lookupVariable("mass") >= 0);
    assert.ok(dae.lookupVariable("volume") >= 0);
    assert.ok(dae.lookupVariable("Ixx") >= 0);
    assert.ok(dae.lookupVariable("px") >= 0);
    assert.ok(dae.lookupVariable("wx") >= 0);
    assert.ok(dae.eqCount >= 9, `Expected >= 9 rigid-body equations, got ${dae.eqCount}`);
  });

  it("projects STL meshes to Wavefront OBJ, ISO 10303-21 STEP, and SVG", () => {
    const oct = buildOctahedronStl(1.0, "Octa");

    const obj = stlToObj(oct);
    assert.ok(obj.includes("o Octa"));
    assert.equal(obj.split("\n").filter((l) => l.startsWith("v ")).length, 6);
    assert.equal(obj.split("\n").filter((l) => l.startsWith("f ")).length, 8);

    const step = stlToStep(oct);
    assert.ok(step.includes("ISO-10303-21;"));
    assert.ok(step.includes("END-ISO-10303-21;"));

    const svg = stlToSvg(oct, { view: "iso", wireframe: true });
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.includes('data-stl-view="iso"'));
    assert.ok(svg.includes('data-wireframe="true"'));
  });
});
