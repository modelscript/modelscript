// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for Pixar OpenUSD 3D Robotic Articulated Arm & UsdPhysics Kinematics (Benchmark 44).
 *
 * Evaluates:
 * 1. OpenUSD ASCII (.usda) scenegraph parsing: metadata, prim hierarchies, Xforms, meshes, API schemas.
 * 2. UsdPhysics validation: PhysicsRigidBodyAPI, PhysicsMassAPI, inertia tensors, revolute joint limits.
 * 3. Time-sampled kinematic trajectory resolution.
 * 4. Zero-overhead DAE linear memory arena lowering: generalized coordinates q, velocities qd,
 *    actuator efforts tau, and equations of motion.
 */

import assert from "node:assert/strict";
import {
  parseUsd,
  lintUsdStage,
  lowerUsdToDae,
  type UsdStage,
  type UsdDiagnostic,
} from "../src/index.js";

export const ROBOTIC_ARM_USD_BENCHMARK = `#usda 1.0
(
    defaultPrim = "IndustrialRobot"
    metersPerUnit = 1.0
    upAxis = "Z"
)

def Xform "IndustrialRobot" (
    kind = "assembly"
)
{
    def Xform "base_link" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
    )
    {
        bool physics:rigidBodyEnabled = true
        float physics:mass = 12.0
        float3 physics:diagonalInertia = (1.2, 1.2, 0.6)

        def Cube "visual_base"
        {
            double size = 1.0
            double3 xformOp:scale = (0.3, 0.3, 0.6)
            uniform token[] xformOpOrder = ["xformOp:scale"]
        }
    }

    def Xform "shoulder_link" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
    )
    {
        bool physics:rigidBodyEnabled = true
        float physics:mass = 5.0
        float3 physics:diagonalInertia = (0.5, 0.5, 0.2)

        double3 xformOp:translate.timeSamples = {
            0.0: (0.0, 0.0, 0.6),
            1.0: (0.1, 0.0, 0.7),
        }
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }

    def PhysicsRevoluteJoint "j_shoulder"
    {
        rel physics:body0 = </IndustrialRobot/base_link>
        rel physics:body1 = </IndustrialRobot/shoulder_link>
        uniform token physics:axis = "Z"
        float physics:lowerLimit = -3.14159
        float physics:upperLimit = 3.14159
    }
}
`;

export interface UsdBenchmarkMetrics {
  defaultPrim: string;
  upAxis: string;
  metersPerUnit: number;
  primCount: number;
  rigidBodyCount: number;
  jointCount: number;
  jointAxis: string;
  totalMassKg: number;
  diagnosticsCount: number;
  daeVarCount: number;
  daeEqCount: number;
  isMechanicallyBalanced: boolean;
}

export function runUsdBenchmark(src = ROBOTIC_ARM_USD_BENCHMARK): UsdBenchmarkMetrics {
  const stage: UsdStage = parseUsd(src);
  assert.equal(stage.metadata.defaultPrim, "IndustrialRobot");
  assert.equal(stage.metadata.upAxis, "Z");
  assert.equal(stage.metadata.metersPerUnit, 1.0);

  const diagnostics: UsdDiagnostic[] = lintUsdStage(stage);
  assert.equal(diagnostics.length, 0, "Benchmark OpenUSD stage must produce zero linter diagnostics");

  let rigidBodyCount = 0;
  let totalMass = 0;
  let jointCount = 0;
  let jointAxis = "Z";

  for (const prim of stage.prims.values()) {
    if (prim.apiSchemas.includes("PhysicsRigidBodyAPI") || prim.typeName === "PhysicsRigidBody") {
      rigidBodyCount++;
      const massAttr = prim.attributes.get("physics:mass");
      if (typeof massAttr?.value === "number") {
        totalMass += massAttr.value;
      }
    }
    if (prim.typeName.includes("Joint")) {
      jointCount++;
      const axisAttr = prim.attributes.get("physics:axis");
      if (typeof axisAttr?.value === "string") {
        jointAxis = axisAttr.value.replace(/['"]/g, "");
      }
    }
  }

  const dae = lowerUsdToDae(stage);
  const daeVarCount = dae.varCount;
  const daeEqCount = dae.eqCount;

  return {
    defaultPrim: stage.metadata.defaultPrim ?? "",
    upAxis: stage.metadata.upAxis ?? "Z",
    metersPerUnit: stage.metadata.metersPerUnit ?? 1.0,
    primCount: stage.prims.size,
    rigidBodyCount,
    jointCount,
    jointAxis,
    totalMassKg: totalMass,
    diagnosticsCount: diagnostics.length,
    daeVarCount,
    daeEqCount,
    isMechanicallyBalanced: daeVarCount >= daeEqCount,
  };
}
