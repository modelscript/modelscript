// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintUsdStage, parseUsd } from "../src/index.js";

test("OpenUSD Linter — valid stage passes without diagnostics", () => {
  const cleanUsd = `#usda 1.0
(
    defaultPrim = "Assembly"
    upAxis = "Z"
)
def Xform "Assembly" {
    def Xform "body" ( prepend apiSchemas = ["PhysicsRigidBodyAPI"] ) {
        float physics:mass = 5.0
        float3 physics:diagonalInertia = (0.5, 0.5, 0.2)
    }
}
`;
  const diags = lintUsdStage(parseUsd(cleanUsd));
  assert.strictEqual(diags.length, 0);
});

test("OpenUSD Linter — detects invalid upAxis (USD1003)", () => {
  const badAxis = `#usda 1.0
(
    upAxis = "X"
)
def Xform "World" {}
`;
  const diags = lintUsdStage(parseUsd(badAxis));
  assert.ok(diags.some((d) => d.code === "USD1003"));
});

test("OpenUSD Linter — detects negative mass and inertia (USD1004, USD1005)", () => {
  const badPhysics = `#usda 1.0
def Xform "BadBody" ( prepend apiSchemas = ["PhysicsRigidBodyAPI"] ) {
    float physics:mass = -2.5
    float3 physics:diagonalInertia = (1.0, -0.5, 1.0)
}
`;
  const diags = lintUsdStage(parseUsd(badPhysics));
  assert.ok(diags.some((d) => d.code === "USD1004"));
  assert.ok(diags.some((d) => d.code === "USD1005"));
});

test("OpenUSD Linter — detects dangling relationship target (USD1002)", () => {
  const dangling = `#usda 1.0
def Xform "Mechanism" {
    def PhysicsRevoluteJoint "j1" {
        rel physics:body0 = </Mechanism/missing_prim>
        rel physics:body1 = </Mechanism/other_missing>
    }
}
`;
  const diags = lintUsdStage(parseUsd(dangling));
  assert.ok(diags.filter((d) => d.code === "USD1002").length >= 2);
});

test("OpenUSD Linter — detects inverted joint limits and invalid axis (USD1006, USD1007)", () => {
  const badJoint = `#usda 1.0
def Xform "Mechanism" {
    def Xform "b1" {}
    def Xform "b2" {}
    def PhysicsRevoluteJoint "j_err" {
        rel physics:body0 = </Mechanism/b1>
        rel physics:body1 = </Mechanism/b2>
        uniform token physics:axis = "W"
        float physics:lowerLimit = 3.14
        float physics:upperLimit = -3.14
    }
}
`;
  const diags = lintUsdStage(parseUsd(badJoint));
  assert.ok(diags.some((d) => d.code === "USD1006"));
  assert.ok(diags.some((d) => d.code === "USD1007"));
});
