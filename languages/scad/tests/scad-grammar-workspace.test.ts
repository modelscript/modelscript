// SPDX-License-Identifier: AGPL-3.0-or-later

import { SolidKind } from "@modelscript/cad";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileScadToSolid, evaluateScad, getScadParser, lintScad, ScadWorkspaceIndex } from "../src/index.js";

describe("OpenSCAD WASM GLR Grammar & Cross-File Workspace Resolution", () => {
  it("parses hull, minkowski, rotate_extrude, multmatrix, offset, let, list comprehensions, operator modules, and include/use in WASM GLR parser", async () => {
    const parser = await getScadParser();
    const source = `
include <common/dims.scad>
use <parts/brackets.scad>

base_r = let(a = 6, b = a * 2) b + 3;
radii = [for (i = [0 : 1 : 4]) if (i != 2) i * 5 + base_r];

module ring_array(count = 4, rad = 20) {
  for (i = [0 : count - 1]) {
    rotate([0, 0, i * 90]) translate([rad, 0, 0]) children();
  }
}

hull() {
  sphere(r = base_r);
  translate([30, 0, 0]) sphere(r = 5);
}

minkowski() {
  cube([20, 20, 4], center = true);
  cylinder(h = 2, r = 2);
}

rotate_extrude(angle = 360)
  translate([15, 0, 0])
    offset(r = 1)
      circle(r = 4);

multmatrix([[1, 0, 0, 10], [0, 1, 0, 5], [0, 0, 1, 0], [0, 0, 0, 1]])
  ring_array(4, 20)
    cylinder(h = 8, r = 3);
`;
    const tree = parser.parse(source);
    assert.ok(tree, "Expected WASM GLR parser to return a syntax tree");
    const hasErr =
      typeof tree.rootNode.hasError === "function"
        ? (tree.rootNode.hasError as () => boolean)()
        : Boolean(tree.rootNode.hasError);
    assert.equal(hasErr, false, "Expected zero syntax errors in upgraded OpenSCAD grammar");

    const solid = await compileScadToSolid(source);
    assert.ok(solid, "Expected compileScadToSolid to produce a CSG solid from WASM CST");
    assert.equal(solid.kind, SolidKind.Union);
  });

  it("evaluates cross-file include <...> and use <...> via ScadWorkspaceIndex", async () => {
    const ws = new ScadWorkspaceIndex();

    ws.indexFile(
      "file:///workspace/defs/constants.scad",
      `
wall_thickness = 4;
flange_radius = 18;
function bolt_circle(r) = r * 0.75;
`,
    );

    ws.indexFile(
      "file:///workspace/lib/mounts.scad",
      `
secret_internal_var = 999;
function double_val(x) = x * 2;
module boss_ring(r = 15, h = 6) {
  difference() {
    cylinder(h = h, r = r);
    cylinder(h = h + 2, r = r * 0.5);
  }
  children();
}
`,
    );

    const mainSource = `
include <../defs/constants.scad>
use <../lib/mounts.scad>

computed_r = bolt_circle(flange_radius) + double_val(wall_thickness);

boss_ring(r = computed_r, h = wall_thickness)
  translate([computed_r, 0, 0])
    sphere(r = 2);
`;

    const evalRes = evaluateScad(mainSource, {
      workspaceIndex: ws,
      uri: "file:///workspace/assemblies/main.scad",
    });

    assert.equal(evalRes.variables["wall_thickness"], 4);
    assert.equal(evalRes.variables["flange_radius"], 18);
    assert.equal(evalRes.variables["computed_r"], 18 * 0.75 + 8);
    assert.equal(
      "secret_internal_var" in evalRes.variables,
      false,
      "use <...> must not leak top-level variables into caller scope",
    );
    assert.ok(evalRes.solid, "Expected evaluated solid from cross-file module and included variables");

    const wasmSolid = await compileScadToSolid(mainSource, {
      workspaceIndex: ws,
      uri: "file:///workspace/assemblies/main.scad",
    });
    assert.ok(wasmSolid, "Expected compileScadToSolid to resolve cross-file modules/functions/variables");
  });

  it("lints cross-file include/use symbols and LetExpression / ListComprehension scopes without false positives", async () => {
    const ws = new ScadWorkspaceIndex();

    ws.indexFile(
      "file:///project/shared/config.scad",
      `
plate_w = 40;
plate_h = 25;
bad_thickness = -3;
`,
    );

    ws.indexFile(
      "file:///project/shared/fasteners.scad",
      `
private_fastener_scale = 2;
function m_hole_radius(m_size) = m_size / 2;
module countersunk_bolt(d, length = 12) {
  cylinder(h = length, r = d / 2);
}
`,
    );

    const validSource = `
include <shared/config.scad>
use <shared/fasteners.scad>

hole_r = let(base = m_hole_radius(6), clearance = 0.4) base + clearance;
offsets = [for (idx = [0 : 3]) if (idx > 0) idx * plate_w];

countersunk_bolt(d = hole_r * 2, length = 16)
  cube([plate_w, plate_h, 5]);
`;

    const validDiags = await lintScad(validSource, {
      workspaceIndex: ws,
      uri: "file:///project/main.scad",
    });
    assert.equal(
      validDiags.length,
      0,
      `Expected zero lint diagnostics on valid cross-file SCAD, got: ${JSON.stringify(validDiags)}`,
    );

    const invalidSource = `
include <shared/config.scad>
use <shared/fasteners.scad>

// 1. Referencing a variable from a 'use'd file should trigger SCAD_UNDEFINED_VARIABLE
leaked = private_fastener_scale + 1;

// 2. Passing unknown named parameter to imported module should trigger SCAD_UNKNOWN_PARAMETER
countersunk_bolt(d = 6, wrong_param = 10);

// 3. Using an included negative constant in cube dimension should trigger SCAD_INVALID_DIMENSION
cube([plate_w, plate_h, bad_thickness]);
`;

    const invalidDiags = await lintScad(invalidSource, {
      workspaceIndex: ws,
      uri: "file:///project/main.scad",
    });
    const codes = invalidDiags.map((d) => d.code);
    assert.ok(
      codes.includes("SCAD_UNDEFINED_VARIABLE"),
      "Expected SCAD_UNDEFINED_VARIABLE for variable from use<> file",
    );
    assert.ok(
      codes.includes("SCAD_UNKNOWN_PARAMETER"),
      "Expected SCAD_UNKNOWN_PARAMETER for wrong named arg on imported module",
    );
    assert.ok(
      codes.includes("SCAD_INVALID_DIMENSION"),
      "Expected SCAD_INVALID_DIMENSION from constant-folded included variable",
    );
  });
});
