// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import { getScadDependencies, resolveScadVisibleSymbol, scadLanguage } from "../src/index.js";

const libraryScad = `
// Reusable hardware library
length = 50;
width = 20;

function bolt_radius(diam) = diam / 2;

module mounting_bracket(hole_d = 4) {
    difference() {
        cube([length, width, 5]);
        translate([length/2, width/2, -1])
            cylinder(r = bolt_radius(hole_d), h = 7);
    }
}
`;

const mainScad = `
// Main chassis assembly
use <lib.scad>
include <constants.scad>

chassis_height = 80;

module main_chassis() {
    mounting_bracket(hole_d = 5);
}
`;

const constantsScad = `
clearance = 0.5;
wall_thickness = 2.0;
`;

test("OpenSCAD UnifiedWorkspace: Indexes declarations, includes, and uses", () => {
  const ws = new UnifiedWorkspace(scadLanguage);
  assert.equal(ws.fileCount, 0);

  // Index library file
  ws.setDocument("file:///workspace/lib.scad", libraryScad);
  assert.equal(ws.fileCount, 1);
  const libIdx = ws.getFileIndex("file:///workspace/lib.scad");
  assert.ok(libIdx);
  assert.ok(libIdx.byName.has("mounting_bracket"));
  assert.ok(libIdx.byName.has("bolt_radius"));
  assert.ok(libIdx.byName.has("length"));
  assert.ok(libIdx.byName.has("width"));

  // Index constants file
  ws.setDocument("file:///workspace/constants.scad", constantsScad);
  assert.equal(ws.fileCount, 2);

  // Index main file
  ws.setDocument("file:///workspace/main.scad", mainScad);
  assert.equal(ws.fileCount, 3);
  const mainIdx = ws.getFileIndex("file:///workspace/main.scad");
  assert.ok(mainIdx);
  assert.ok(mainIdx.byName.has("main_chassis"));
  assert.ok(mainIdx.byName.has("chassis_height"));

  // Verify dependencies
  const deps = getScadDependencies(ws, "file:///workspace/main.scad");
  assert.equal(deps.length, 2);
  assert.equal(deps[0]?.type, "use");
  assert.equal(deps[0]?.targetPath, "lib.scad");
  assert.equal(deps[1]?.type, "include");
  assert.equal(deps[1]?.targetPath, "constants.scad");

  // Verify symbol visibility resolution
  // 1. From use <lib.scad>: mounting_bracket and bolt_radius are visible
  const resolvedMod = resolveScadVisibleSymbol(ws, "mounting_bracket", "file:///workspace/main.scad");
  assert.ok(resolvedMod);
  assert.equal(resolvedMod.name, "mounting_bracket");
  assert.equal(resolvedMod.kind, "Module");

  const resolvedFn = resolveScadVisibleSymbol(ws, "bolt_radius", "file:///workspace/main.scad");
  assert.ok(resolvedFn);
  assert.equal(resolvedFn.name, "bolt_radius");
  assert.equal(resolvedFn.kind, "Function");

  // 2. From use <lib.scad>: variables (length, width) are NOT visible via 'use'
  const invisibleVar = resolveScadVisibleSymbol(ws, "length", "file:///workspace/main.scad");
  assert.equal(invisibleVar, undefined);

  // 3. From include <constants.scad>: variables ARE visible via 'include'
  const visibleConst = resolveScadVisibleSymbol(ws, "clearance", "file:///workspace/main.scad");
  assert.ok(visibleConst);
  assert.equal(visibleConst.name, "clearance");
  assert.equal(visibleConst.kind, "Variable");

  // Verify unified symbol index
  const unified = ws.getIndex();
  assert.ok(unified.byName.has("mounting_bracket"));
  assert.ok(unified.byName.has("main_chassis"));
  assert.ok(unified.byName.has("clearance"));
  assert.ok(unified.symbols.size >= 8);
});
