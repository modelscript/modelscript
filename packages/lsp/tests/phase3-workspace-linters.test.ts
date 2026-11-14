// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";

import { lintAmplWorkspace } from "../../../languages/ampl/dist/src/index.js";
import { lintCWorkspace } from "../../../languages/c/dist/src/index.js";
import { lintFortranWorkspace } from "../../../languages/fortran/dist/src/index.js";
import { lintScadWorkspace } from "../../../languages/scad/dist/src/index.js";
import { lintUrdfWorkspace } from "../../../languages/urdf/dist/src/index.js";
import { lintUsdWorkspace } from "../../../languages/usd/dist/src/index.js";

test("Phase 3: USD workspace linter resolves @layer@ arcs and detects cycles", () => {
  const root = `#usda 1.0\n(\n  subLayers = [@sub.usda@]\n)\ndef Xform "World" {}\n`;
  const sub = `#usda 1.0\ndef Sphere "Ball" {}\n`;
  assert.equal(
    lintUsdWorkspace(
      new Map([
        ["root.usda", root],
        ["sub.usda", sub],
      ]),
      "root.usda",
    ).filter((d) => d.code.startsWith("US30")).length,
    0,
  );

  const bad = `#usda 1.0\n(\n  subLayers = [@missing.usda@]\n)\ndef Xform "World" {}\n`;
  assert.ok(
    lintUsdWorkspace(new Map([["root.usda", bad]]), "root.usda").some((d) => d.rule === "unresolved-usd-layer"),
  );
});

test("Phase 3: URDF workspace linter resolves xacro:include and mesh assets", () => {
  const urdfOk = `<robot name="arm"><xacro:include filename="macros.xacro"/><link name="base"><visual><geometry><mesh filename="package://pkg/meshes/base.stl"/></geometry></visual></link></robot>`;
  const ok = new Map([
    ["robot.urdf", urdfOk],
    ["macros.xacro", `<robot xmlns:xacro="http://www.ros.org/wiki/xacro"/>`],
    ["meshes/base.stl", "solid base\nendsolid base\n"],
  ]);
  assert.equal(lintUrdfWorkspace(ok, "robot.urdf").filter((d) => d.code.startsWith("UR30")).length, 0);

  const bad = new Map([["robot.urdf", urdfOk]]);
  const diags = lintUrdfWorkspace(bad, "robot.urdf");
  assert.ok(diags.some((d) => d.rule === "unresolved-xacro-include"));
  assert.ok(diags.some((d) => d.rule === "unresolved-urdf-asset"));
});

test("Phase 3: OpenSCAD workspace linter resolves include/use and detects cycles", async () => {
  const main = `include <lib.scad>\ncube([10, 10, 10]);\n`;
  const lib = `module helper() { sphere(5); }\n`;
  assert.equal(
    (
      await lintScadWorkspace(
        new Map([
          ["main.scad", main],
          ["lib.scad", lib],
        ]),
        "main.scad",
      )
    ).filter((d) => d.code.startsWith("SCAD30")).length,
    0,
  );

  const bad = `include <missing.scad>\ncube([10, 10, 10]);\n`;
  assert.ok(
    (await lintScadWorkspace(new Map([["main.scad", bad]]), "main.scad")).some(
      (d) => d.rule === "unresolved-scad-include",
    ),
  );
});

test("Phase 3: C workspace linter resolves local #include headers", () => {
  const cSrc = `#include <math.h>\n#include "ctrl.h"\ndouble step(double x) { return x * 2.0; }\n`;
  const ok = new Map([
    ["ctrl.c", cSrc],
    ["ctrl.h", "double step(double x);\n"],
  ]);
  assert.equal(lintCWorkspace(ok, "ctrl.c").filter((d) => d.code.startsWith("C30")).length, 0);

  const bad = new Map([["ctrl.c", cSrc]]);
  assert.ok(lintCWorkspace(bad, "ctrl.c").some((d) => d.rule === "unresolved-c-include"));
});

test("Phase 3: Fortran workspace linter resolves USE modules and INCLUDE files", () => {
  const main = `PROGRAM main\n  USE physics_mod\n  IMPLICIT NONE\nEND PROGRAM main\n`;
  const mod = `MODULE physics_mod\n  IMPLICIT NONE\nEND MODULE physics_mod\n`;
  assert.equal(
    lintFortranWorkspace(
      new Map([
        ["main.f90", main],
        ["physics.f90", mod],
      ]),
      "main.f90",
    ).filter((d) => d.code.startsWith("F30")).length,
    0,
  );

  const bad = new Map([["main.f90", main]]);
  assert.ok(lintFortranWorkspace(bad, "main.f90").some((d) => d.rule === "unresolved-fortran-module"));
});

test("Phase 3: AMPL workspace linter cross-checks .dat and .run against .mod", () => {
  const mod = `set PROD;\nparam cost {PROD};\nvar x {PROD} >= 0;\nminimize obj: sum {p in PROD} cost[p] * x[p];\n`;
  const datOk = `set PROD := A B;\nparam cost := A 10 B 20;\n`;
  const runOk = `model model.mod;\ndata data.dat;\nsolve;\n`;
  assert.equal(
    lintAmplWorkspace(
      new Map([
        ["model.mod", mod],
        ["data.dat", datOk],
        ["run.run", runOk],
      ]),
    ).filter((d) => d.code.startsWith("AMPL30")).length,
    0,
  );

  const datBad = `param undeclared_param := 5;\n`;
  const runBad = `model missing.mod;\n`;
  const diags = lintAmplWorkspace(
    new Map([
      ["model.mod", mod],
      ["data.dat", datBad],
      ["run.run", runBad],
    ]),
  );
  assert.ok(diags.some((d) => d.rule === "undeclared-ampl-dat-symbol"));
  assert.ok(diags.some((d) => d.rule === "unresolved-ampl-run-target"));
});
