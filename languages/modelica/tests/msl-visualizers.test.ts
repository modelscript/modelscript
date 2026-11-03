// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import nodeFs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import {
  createMslGridSurfaceMesh,
  createMslPipeSurfaceMesh,
  createMslRectangleSurfaceMesh,
  createMslShapeMesh,
  createMslTorusMesh,
  extractArenaVisualizers,
  extractModelicaCadComponents,
} from "../src/extensions/cad.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(modelicaWasm);
Context.registerParser(".mo", parser as any);

describe("Modelica.Mechanics.MultiBody.Visualizers Extraction & Procedural Meshes", () => {
  it("generates canonical MSL unit meshes for all standard ShapeType primitives and Surfaces", () => {
    const shapeTypes = [
      "box",
      "sphere",
      "cylinder",
      "pipecylinder",
      "cone",
      "pipe",
      "beam",
      "gearwheel",
      "spring",
      "arrow",
      "doublearrow",
    ];

    for (const st of shapeTypes) {
      const mesh = createMslShapeMesh(st, st === "gearwheel" ? 16 : st === "spring" ? 6 : 0.5, [0.2, 0.5, 0.8], 0.15);
      assert.ok(mesh.vertices.length > 0, `Expected vertices for shapeType=${st}`);
      assert.equal(mesh.vertices.length, mesh.normals.length, `Normals length mismatch for shapeType=${st}`);
      assert.ok(mesh.indices.length > 0, `Expected triangle indices for shapeType=${st}`);
      assert.equal(mesh.indices.length % 3, 0, `Indices must be multiple of 3 for shapeType=${st}`);
      assert.deepEqual(mesh.color, [0.2, 0.5, 0.8, 1.0]);
    }

    const torus = createMslTorusMesh(0.2, 0.05, 0, Math.PI * 2, 16, 8, [0.1, 0.1, 0.1]);
    assert.ok(torus.vertices.length > 0);
    assert.equal(torus.indices.length % 3, 0);

    const rect = createMslRectangleSurfaceMesh(0.5, 0.3, 4, 4, [0.3, 0.6, 0.9]);
    assert.equal(rect.vertices.length, 4 * 4 * 3);
    assert.equal(rect.indices.length, 3 * 3 * 6);

    const pipeSurf = createMslPipeSurfaceMesh(1.0, 0.1, 8, 8, [0.8, 0.2, 0.2]);
    assert.equal(pipeSurf.vertices.length, 8 * 8 * 3);
    assert.equal(pipeSurf.indices.length, 7 * 7 * 6);

    const gridSurf = createMslGridSurfaceMesh(4, 4, [0.4, 0.7, 0.4]);
    assert.equal(gridSurf.vertices.length, 4 * 4 * 3);
    assert.equal(gridSurf.indices.length, 3 * 3 * 6);
  });

  it("automatically extracts Shape, Vector, and Surface visualizers from flattened Modelica models", async () => {
    const fs = new NodeFileSystem();
    const context = new Context(fs);

    const tempFile = path.join(__dirname, "TempVisualizersTest.mo");
    nodeFs.writeFileSync(
      tempFile,
      `
      package TempVisualizersTest
        model Shape
          parameter String shapeType = "box";
          input Real R_T[3, 3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
          input Real r[3] = {0, 0, 0};
          input Real r_shape[3] = {0, 0, 0};
          input Real lengthDirection[3] = {1, 0, 0};
          input Real widthDirection[3] = {0, 1, 0};
          input Real length = 1.0;
          input Real width = 0.2;
          input Real height = 0.2;
          input Real extra = 0.0;
          input Real color[3] = {0, 128, 255};
          input Real specularCoefficient = 0.7;
        end Shape;

        model Vector
          input Real R_T[3, 3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
          input Real r[3] = {0, 0, 0};
          input Real r_shape[3] = {0, 0, 0};
          input Real coordinates[3] = {1, 0, 0};
          input Real color[3] = {255, 0, 0};
          input Real specularCoefficient = 0.7;
          parameter Boolean quantity = true;
          parameter Boolean headAtOrigin = false;
          parameter Boolean twoHeadedArrow = false;
        end Vector;

        model Torus
          parameter Real ri = 0.5;
          parameter Real ro = 0.1;
          parameter Boolean opening = false;
          parameter Real startAngle = 0.0;
          parameter Real stopAngle = 6.283185307179586;
          parameter Integer nu = 16;
          parameter Integer nv = 8;
          parameter Boolean multiColoredSurface = false;
          input Real R_T[3, 3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
          input Real r_0[3] = {1.0, 2.0, 3.0};
          input Real color[3] = {255, 128, 0};
          input Real specularCoefficient = 0.7;
          input Real transparency = 0.0;
        end Torus;

        model RectangleSurface
          parameter Real length = 2.0;
          parameter Real width = 1.5;
          parameter Integer nu = 2;
          parameter Integer nv = 2;
          parameter Boolean multiColoredSurface = false;
          input Real R_T[3, 3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
          input Real r_0[3] = {0.0, 0.0, -0.5};
          input Real color[3] = {0, 200, 100};
          input Real specularCoefficient = 0.5;
          input Real transparency = 0.25;
        end RectangleSurface;

        model MultiBodyScene
          Real frame_r_0[3](each start = 0);
          Shape boxVis(
            shapeType = "box",
            r_shape = {0.1, 0.2, 0.3},
            lengthDirection = {0, 1, 0},
            widthDirection = {-1, 0, 0},
            length = 1.5,
            width = 0.4,
            height = 0.2,
            color = {255, 0, 0}
          );
          Shape springVis(
            shapeType = "spring",
            width = 0.1,
            height = 0.02,
            extra = 8,
            color = {100, 100, 100}
          );
          Shape gearVis(
            shapeType = "gearwheel",
            length = 0.05,
            width = 0.4,
            height = 0.4,
            extra = 12
          );
          Shape externalMesh(
            shapeType = "modelica://MyLib/Resources/Shapes/chassis.stl",
            length = 1.0,
            width = 1.0,
            height = 1.0
          );
          Vector forceVec(
            coordinates = {0, 3.0, 4.0},
            headAtOrigin = true,
            color = {0, 255, 0}
          );
          Torus wheelTire(ri = 0.3, ro = 0.08);
          RectangleSurface floorRect(length = 4.0, width = 3.0);
        equation
          der(frame_r_0[1]) = 1.0;
          der(frame_r_0[2]) = 0.5;
          der(frame_r_0[3]) = 0.0;
          boxVis.r[1] = frame_r_0[1];
          boxVis.r[2] = frame_r_0[2];
          boxVis.r[3] = frame_r_0[3];
          springVis.length = 0.5 + 0.1 * frame_r_0[1];
        end MultiBodyScene;
      end TempVisualizersTest;
      `,
    );

    try {
      await context.addLibrary(tempFile);
      const arena = context.flattenArena("TempVisualizersTest.MultiBodyScene", undefined, undefined, {
        foldConstants: false,
        eliminateAliases: false,
      });
      assert.ok(arena, "Expected flattened arena");

      const visualizers = extractArenaVisualizers(arena);
      const byName = new Map(visualizers.map((v) => [v.name, v]));

      // 1. Box visualizer with r_shape, lengthDirection=[0,1,0], widthDirection=[-1,0,0], and alias bindings to frame_r_0
      const boxVis = byName.get("boxVis");
      assert.ok(boxVis, "Expected boxVis to be extracted");
      assert.equal(boxVis.shapeType, "box");
      assert.ok(boxVis.proceduralMesh);
      assert.deepEqual(boxVis.defaults?.scale, [1.5, 0.4, 0.2]);
      assert.deepEqual(boxVis.defaults?.shapeOffset, [0.1, 0.2, 0.3]);
      assert.deepEqual(boxVis.defaults?.lengthDirection, [0, 1, 0]);
      assert.deepEqual(boxVis.defaults?.widthDirection, [-1, 0, 0]);
      assert.ok(boxVis.cad.includes("position={0.1, 0.2, 0.3}"));
      // Check that alias equation boxVis.r[1] = frame_r_0[1] bound both boxVis.r[1] and frame_r_0[1]
      const pos0Vars = boxVis.dynamicBindings
        ?.filter((b) => b.property === "position" && b.index === 0)
        .map((b) => b.variable);
      assert.ok(pos0Vars?.includes("boxVis.r[1]"));
      assert.ok(pos0Vars?.includes("frame_r_0[1]"));

      // 2. Spring visualizer: Y and Z scale both use coil width (0.1), while height (0.02) sets wire diameter
      const springVis = byName.get("springVis");
      assert.ok(springVis, "Expected springVis to be extracted");
      assert.equal(springVis.shapeType, "spring");
      assert.equal(springVis.defaults?.scale?.[1], 0.1);
      assert.equal(springVis.defaults?.scale?.[2], 0.1);

      // 3. Gearwheel visualizer
      const gearVis = byName.get("gearVis");
      assert.ok(gearVis, "Expected gearVis to be extracted");
      assert.equal(gearVis.shapeType, "gearwheel");
      assert.ok((gearVis.proceduralMesh?.vertices.length ?? 0) > 100);

      // 4. External mesh URI visualizer ("modelica://...")
      const externalMesh = byName.get("externalMesh");
      assert.ok(externalMesh, "Expected externalMesh to be extracted");
      assert.ok(externalMesh.cad.includes('uri="modelica://MyLib/Resources/Shapes/chassis.stl"'));
      assert.equal(externalMesh.proceduralMesh, undefined);

      // 5. Vector visualizer with coordinates={0, 3, 4} (length = 5) and headAtOrigin=true
      const forceVec = byName.get("forceVec");
      assert.ok(forceVec, "Expected forceVec to be extracted");
      assert.equal(forceVec.shapeType, "vector");
      assert.equal(forceVec.defaults?.headAtOrigin, true);
      assert.ok(Math.abs((forceVec.defaults?.scale?.[0] ?? 0) - 5.0) < 1e-5);
      // With headAtOrigin=true, origin in CAD string is shifted by -coordinates = [0, -3, -4]
      assert.ok(forceVec.cad.includes("position={0, -3, -4}"));

      // 6. Torus surface visualizer
      const wheelTire = byName.get("wheelTire");
      assert.ok(wheelTire, "Expected wheelTire to be extracted");
      assert.equal(wheelTire.shapeType, "torus");
      assert.deepEqual(wheelTire.defaults?.position, [1.0, 2.0, 3.0]);
      assert.ok((wheelTire.proceduralMesh?.vertices.length ?? 0) > 0);

      // 7. Rectangle surface visualizer with transparency
      const floorRect = byName.get("floorRect");
      assert.ok(floorRect, "Expected floorRect to be extracted");
      assert.equal(floorRect.shapeType, "rectangle");
      assert.deepEqual(floorRect.defaults?.position, [0.0, 0.0, -0.5]);
      assert.ok(Math.abs((floorRect.proceduralMesh?.color?.[3] ?? 1.0) - 0.75) < 1e-5);

      // 8. Also verify extractModelicaCadComponents end-to-end
      const allCad = extractModelicaCadComponents(context, "TempVisualizersTest.MultiBodyScene");
      assert.equal(allCad.length, 7);
    } finally {
      nodeFs.rmSync(tempFile, { force: true });
    }
  });
});
