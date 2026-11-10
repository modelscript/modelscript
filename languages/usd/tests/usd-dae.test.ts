// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerUsdToDae, parseUsd } from "../src/index.js";

const TWO_DOF_MANIPULATOR = `#usda 1.0
(
    defaultPrim = "TwoDofArm"
    upAxis = "Z"
)

def Xform "TwoDofArm" {
    def Xform "link0" ( prepend apiSchemas = ["PhysicsRigidBodyAPI"] ) {
        float physics:mass = 8.0
        float3 physics:diagonalInertia = (0.8, 0.8, 0.4)
    }

    def Xform "link1" ( prepend apiSchemas = ["PhysicsRigidBodyAPI"] ) {
        float physics:mass = 4.0
        float3 physics:diagonalInertia = (0.4, 0.4, 0.2)
    }

    def Xform "link2" ( prepend apiSchemas = ["PhysicsRigidBodyAPI"] ) {
        float physics:mass = 2.0
        float3 physics:diagonalInertia = (0.2, 0.2, 0.1)
    }

    def PhysicsRevoluteJoint "j1" {
        rel physics:body0 = </TwoDofArm/link0>
        rel physics:body1 = </TwoDofArm/link1>
        uniform token physics:axis = "Z"
    }

    def PhysicsRevoluteJoint "j2" {
        rel physics:body0 = </TwoDofArm/link1>
        rel physics:body1 = </TwoDofArm/link2>
        uniform token physics:axis = "Y"
    }
}
`;

test("OpenUSD DAE Lowering — lowers multi-DOF serial manipulator into DAE arena", () => {
  const stage = parseUsd(TWO_DOF_MANIPULATOR);
  const dae = lowerUsdToDae(stage);

  // 2 joints * 3 vars + 3 bodies * 3 vars = 6 + 9 = 15 vars
  assert.strictEqual(dae.varCount, 15);
  // 2 joints * 2 eqs + 3 bodies * 3 eqs = 4 + 9 = 13 eqs
  assert.strictEqual(dae.eqCount, 13);

  const varNames = Array.from({ length: dae.varCount }, (_, i) => dae.getVarName(i));
  assert.ok(varNames.includes("j1.q"));
  assert.ok(varNames.includes("j1.qd"));
  assert.ok(varNames.includes("j1.tau"));
  assert.ok(varNames.includes("j2.q"));
  assert.ok(varNames.includes("j2.qd"));
  assert.ok(varNames.includes("j2.tau"));
  assert.ok(varNames.includes("link0.x"));
  assert.ok(varNames.includes("link1.y"));
  assert.ok(varNames.includes("link2.z"));
});

test("OpenUSD DAE Lowering — handles prismatic joint dynamics", () => {
  const prismaticUsd = `#usda 1.0
def Xform "Gantry" {
    def Xform "slider" ( prepend apiSchemas = ["PhysicsRigidBodyAPI"] ) {
        float physics:mass = 25.0
    }
    def PhysicsPrismaticJoint "j_slide" {
        rel physics:body0 = </Gantry>
        rel physics:body1 = </Gantry/slider>
        uniform token physics:axis = "X"
    }
}
`;
  const stage = parseUsd(prismaticUsd);
  const dae = lowerUsdToDae(stage);

  const varNames = Array.from({ length: dae.varCount }, (_, i) => dae.getVarName(i));
  assert.ok(varNames.includes("j_slide.q"));
  assert.ok(varNames.includes("j_slide.qd"));
  assert.ok(varNames.includes("j_slide.tau"));
});
