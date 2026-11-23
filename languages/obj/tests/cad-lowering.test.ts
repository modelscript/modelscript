// SPDX-License-Identifier: AGPL-3.0-or-later

import { SolidKind } from "@modelscript/cad";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerObjToCad } from "../src/cad/index.js";
import { objToDae } from "../src/dae/index.js";
import { parseObjWithMtl } from "../src/parser/index.js";

const UNIT_CUBE_OBJ = [
  "o UnitCube",
  "usemtl Aluminum",
  "v 0 0 0",
  "v 1 0 0",
  "v 1 1 0",
  "v 0 1 0",
  "v 0 0 1",
  "v 1 0 1",
  "v 1 1 1",
  "v 0 1 1",
  "f 1 4 3 2",
  "f 5 6 7 8",
  "f 1 2 6 5",
  "f 3 4 8 7",
  "f 1 5 8 4",
  "f 2 3 7 6",
].join("\n");

const ALUMINUM_MTL = ["newmtl Aluminum", "Kd 0.77 0.79 0.82", "d 1.0", "illum 2"].join("\n");

describe("CAD PolyhedronSolid & DAE Rigid-Body Lowering", () => {
  it("lowers a quad-face Wavefront OBJ cube into a 12-triangle PolyhedronSolid with MTL color", () => {
    const { obj } = parseObjWithMtl(UNIT_CUBE_OBJ, ALUMINUM_MTL);
    const cad = lowerObjToCad(obj);

    assert.equal(cad.solid.kind, SolidKind.Polyhedron);
    assert.equal(cad.solid.name, "UnitCube");
    assert.equal(cad.solid.points.length, 8);
    assert.equal(cad.solid.faces.length, 12);
    assert.equal(cad.triangleCount, 12);
    assert.equal(cad.assembly.parts.length, 1);
    assert.deepEqual(cad.solid.sourceMetadata?.color, [0.77, 0.79, 0.82, 1.0]);
  });

  it("lowers rigid-body mass, centroid, and inertia tensor of unit cube directly to DAEBuilder", () => {
    const { obj } = parseObjWithMtl(UNIT_CUBE_OBJ, ALUMINUM_MTL);
    const density = 2700.0;
    const res = objToDae(obj, { density, name: "CubeBody" });

    // Unit cube: V = 1.0 m^3, mass = 2700 kg, Ixx = Iyy = Izz = (1/6)*m*a^2 = 450 kg*m^2
    assert.ok(Math.abs(res.mass - 2700.0) < 1e-9, `expected mass 2700, got ${res.mass}`);
    const expectedInertia = (density * 1.0) / 6.0;
    assert.ok(Math.abs(res.inertia[0] - expectedInertia) < 1e-8);
    assert.ok(Math.abs(res.inertia[1] - expectedInertia) < 1e-8);
    assert.ok(Math.abs(res.inertia[2] - expectedInertia) < 1e-8);

    // DAEBuilder should contain parameters, 9 continuous states (x,y,z,vx,vy,vz,wx,wy,wz), and 9 equations
    assert.ok(res.dae.varCount >= 19, `expected >= 19 DAE variables, got ${res.dae.varCount}`);
    assert.equal(res.dae.eqCount, 9, "expected 9 6-DOF kinematic/dynamic equations");
  });
});
