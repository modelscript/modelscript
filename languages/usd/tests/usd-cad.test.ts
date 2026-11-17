// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { extractUsdCadComponents, lintUsdStage, parseUsd } from "../src/index.js";

test("extractUsdCadComponents tessellates Mesh, Cube, Sphere, Cylinder, Cone, Capsule with transforms", () => {
  const usda = `#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 1.0
    upAxis = "Z"
)

def Xform "World"
{
    def Mesh "Quad"
    {
        float3[] points = [(-0.5, -0.5, 0.0), (0.5, -0.5, 0.0), (0.5, 0.5, 0.0), (-0.5, 0.5, 0.0)]
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        color3f[] primvars:displayColor = [(0.2, 0.6, 1.0)]
    }

    def Xform "Moved"
    {
        double3 xformOp:translate = (1.0, 2.0, 3.0)
        uniform token[] xformOpOrder = ["xformOp:translate"]

        def Cube "Box"
        {
            double size = 2.0
            color3f[] primvars:displayColor = [(0.9, 0.3, 0.1)]
        }

        def Sphere "Ball"
        {
            double radius = 0.5
        }

        def Cylinder "Post"
        {
            double radius = 0.25
            double height = 1.5
            uniform token axis = "Z"
        }

        def Cone "Tip"
        {
            double radius = 0.2
            double height = 0.4
        }

        def Capsule "Link"
        {
            double radius = 0.1
            double height = 0.5
        }
    }
}
`;

  const comps = extractUsdCadComponents(usda);
  assert.equal(comps.length, 6);

  const quad = comps[0]!;
  assert.equal(quad.name, "/World/Quad");
  assert.equal(quad.shapeType, "mesh");
  assert.deepEqual(quad.proceduralMesh.color, [0.2, 0.6, 1.0, 1.0]);
  assert.equal(quad.proceduralMesh.indices.length, 6); // 1 quad = 2 triangles

  const box = comps[1]!;
  assert.equal(box.name, "/World/Moved/Box");
  assert.equal(box.shapeType, "cube");
  assert.deepEqual(box.proceduralMesh.color, [0.9, 0.3, 0.1, 1.0]);
  assert.equal(box.proceduralMesh.indices.length, 36); // 6 faces * 2 tris * 3 indices
  // Check Z-up (1, 2, 3) -> Y-up (1, 3, -2) center of cube
  let sumX = 0,
    sumY = 0,
    sumZ = 0;
  const count = box.proceduralMesh.vertices.length / 3;
  for (let i = 0; i < box.proceduralMesh.vertices.length; i += 3) {
    sumX += box.proceduralMesh.vertices[i]!;
    sumY += box.proceduralMesh.vertices[i + 1]!;
    sumZ += box.proceduralMesh.vertices[i + 2]!;
  }
  assert.ok(Math.abs(sumX / count - 1.0) < 1e-6);
  assert.ok(Math.abs(sumY / count - 3.0) < 1e-6);
  assert.ok(Math.abs(sumZ / count - -2.0) < 1e-6);
});

test("extractUsdCadComponents produces 5 valid 3D meshes and 0 lints for DigitalTwinCell", () => {
  const digitalTwin = `#usda 1.0
(
    defaultPrim = "DigitalTwinCell"
    metersPerUnit = 1.0
    upAxis = "Z"
)

def Xform "DigitalTwinCell" (
    kind = "assembly"
)
{
    def Xform "BasePedestal" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
    )
    {
        bool physics:rigidBodyEnabled = true
        float physics:mass = 24.0
        float3 physics:diagonalInertia = (1.8, 1.8, 0.9)

        def Cylinder "Plinth"
        {
            double radius = 0.45
            double height = 0.25
            uniform token axis = "Z"
            double3 xformOp:translate = (0.0, 0.0, 0.125)
            uniform token[] xformOpOrder = ["xformOp:translate"]
            color3f[] primvars:displayColor = [(0.18, 0.22, 0.28)]
        }

        def Cylinder "Column"
        {
            double radius = 0.16
            double height = 0.70
            uniform token axis = "Z"
            double3 xformOp:translate = (0.0, 0.0, 0.60)
            uniform token[] xformOpOrder = ["xformOp:translate"]
            color3f[] primvars:displayColor = [(0.24, 0.56, 0.88)]
        }
    }

    def Xform "ShoulderLink" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
    )
    {
        bool physics:rigidBodyEnabled = true
        float physics:mass = 8.5
        float3 physics:diagonalInertia = (0.6, 0.6, 0.25)
        double3 xformOp:translate = (0.0, 0.0, 1.0)
        float3 xformOp:rotateXYZ = (0.0, 28.0, 0.0)
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateXYZ"]

        def Sphere "ShoulderJoint"
        {
            double radius = 0.19
            color3f[] primvars:displayColor = [(0.92, 0.58, 0.16)]
        }

        def Cube "UpperArm"
        {
            double size = 1.0
            double3 xformOp:translate = (0.45, 0.0, 0.0)
            double3 xformOp:scale = (0.90, 0.16, 0.16)
            uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]
            color3f[] primvars:displayColor = [(0.24, 0.56, 0.88)]
        }

        def Sphere "WristEndEffector"
        {
            double radius = 0.13
            double3 xformOp:translate = (0.95, 0.0, 0.0)
            uniform token[] xformOpOrder = ["xformOp:translate"]
            color3f[] primvars:displayColor = [(0.22, 0.78, 0.52)]
        }
    }

    def PhysicsRevoluteJoint "ShoulderRevolute"
    {
        rel physics:body0 = </DigitalTwinCell/BasePedestal>
        rel physics:body1 = </DigitalTwinCell/ShoulderLink>
        uniform token physics:axis = "Y"
        float physics:lowerLimit = -2.35619
        float physics:upperLimit = 2.35619
    }
}
`;

  const stage = parseUsd(digitalTwin);
  const diags = lintUsdStage(stage);
  assert.equal(diags.length, 0);

  const comps = extractUsdCadComponents(digitalTwin);
  assert.equal(comps.length, 5);
  for (const c of comps) {
    assert.ok(c.proceduralMesh.vertices.length > 0);
    assert.ok(c.proceduralMesh.indices.length > 0);
    assert.equal(c.proceduralMesh.normals.length, c.proceduralMesh.vertices.length);
  }
});
