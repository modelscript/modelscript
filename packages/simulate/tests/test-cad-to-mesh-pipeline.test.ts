// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import type { Tet4Mesh } from "../src/fea/tet4-types.js";
import { BoundaryLayerExtruder, MeshQualityAnalyzer, PatchClassifier, StepMesher } from "../src/meshing/index.js";

describe("Automated CAD-to-Mesh Discretization Pipeline", () => {
  describe("MeshQualityAnalyzer", () => {
    it("should compute positive scaled Jacobian and aspect ratio for standard tetrahedron", () => {
      // Regular right-angled tetrahedron
      // Nodes: (0,0,0), (1,0,0), (0,1,0), (0,0,1)
      const nodeCoords = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
      const elements = new Uint32Array([0, 1, 2, 3]);

      const mesh: Tet4Mesh = {
        nodeCoords,
        elements,
        numNodes: 4,
        numElements: 1,
        boundaryNodes: new Map(),
      };

      const metrics = MeshQualityAnalyzer.analyze(mesh);
      assert.strictEqual(metrics.numInvertedElements, 0, "Should have 0 inverted elements");
      assert.ok(metrics.minJacobian > 0.5, `Expected scaled Jacobian > 0.5, got ${metrics.minJacobian}`);
      assert.ok(metrics.maxAspectRatio < 2.5, `Expected aspect ratio < 2.5, got ${metrics.maxAspectRatio}`);
      assert.strictEqual(metrics.elementJacobians.length, 1);
    });

    it("should detect inverted elements with non-positive Jacobian", () => {
      // Swapping two vertices inverts the tetrahedron handedness
      const nodeCoords = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
      const elements = new Uint32Array([0, 2, 1, 3]); // Swapped 1 and 2

      const mesh: Tet4Mesh = {
        nodeCoords,
        elements,
        numNodes: 4,
        numElements: 1,
        boundaryNodes: new Map(),
      };

      const metrics = MeshQualityAnalyzer.analyze(mesh);
      assert.strictEqual(metrics.numInvertedElements, 1, "Should detect 1 inverted element");
      assert.ok(metrics.minJacobian < 0, "Jacobian must be negative for inverted element");
    });
  });

  describe("BoundaryLayerExtruder", () => {
    it("should extrude geometric inflation layers and decompose prisms into conformal tets", () => {
      // Flat square on z = 0, composed of 2 triangles
      // Vertices: (0,0,0), (1,0,0), (1,1,0), (0,1,0)
      const surfaceCoords = new Float32Array([
        0,
        0,
        0, // 0
        1,
        0,
        0, // 1
        1,
        1,
        0, // 2
        0,
        1,
        0, // 3
      ]);
      const surfaceTriangles = new Uint32Array([0, 1, 2, 0, 2, 3]);

      const result = BoundaryLayerExtruder.extrude(surfaceCoords, surfaceTriangles, {
        firstLayerHeight: 0.001, // 1mm
        numLayers: 3,
        growthRatio: 1.2,
      });

      // 4 base nodes * (3 layers + 1) = 16 nodes
      assert.strictEqual(result.numNodes, 16, "Expected 16 nodes total");
      // 2 triangles * 3 layers * 3 tets/prism = 18 tetrahedra
      assert.strictEqual(result.numElements, 18, "Expected 18 tets from 6 prisms");
      assert.strictEqual(result.elements.length, 18 * 4);

      // Verify layer heights along Z
      const nBase = 4;
      const z0 = result.nodeCoords[0 * 3 + 2];
      const z1 = result.nodeCoords[(1 * nBase + 0) * 3 + 2];
      const z2 = result.nodeCoords[(2 * nBase + 0) * 3 + 2];
      const z3 = result.nodeCoords[(3 * nBase + 0) * 3 + 2];

      assert.strictEqual(z0, 0.0, "Base layer at z=0");
      assert.ok(Math.abs(z1 - 0.001) < 1e-6, `Layer 1 at z=0.001, got ${z1}`);
      assert.ok(Math.abs(z2 - 0.0022) < 1e-6, `Layer 2 at z=0.0022, got ${z2}`);
      assert.ok(Math.abs(z3 - 0.00364) < 1e-6, `Layer 3 at z=0.00364, got ${z3}`);
    });
  });

  describe("PatchClassifier", () => {
    it("should classify planar boundary faces and construct node sets", () => {
      // 100mm x 20mm x 20mm box
      const box = StepMesher.createBoxSurface(0, 0, 0, 0.1, 0.02, 0.02);
      const patches = PatchClassifier.classify(box.vertices, box.indices, {
        toleranceFraction: 0.05,
        tags: {
          minZ: "FIXED_SUPPORT",
          maxZ: "LOAD_SURFACE",
          minX: "INLET",
          maxX: "OUTLET",
        },
      });

      assert.ok(patches.nodeSets.has("FIXED_SUPPORT"), "Should classify FIXED_SUPPORT at minZ");
      assert.ok(patches.nodeSets.has("LOAD_SURFACE"), "Should classify LOAD_SURFACE at maxZ");
      assert.ok(patches.nodeSets.has("INLET"), "Should classify INLET at minX");
      assert.ok(patches.nodeSets.has("OUTLET"), "Should classify OUTLET at maxX");

      assert.ok(patches.nodeSets.get("FIXED_SUPPORT")!.length > 0);
      assert.ok(Math.abs(patches.boundingBox.dimensions[0] - 0.1) < 1e-5);
      assert.ok(Math.abs(patches.boundingBox.dimensions[1] - 0.02) < 1e-5);
      assert.ok(Math.abs(patches.boundingBox.dimensions[2] - 0.02) < 1e-5);
    });
  });

  describe("StepMesher", () => {
    it("should mesh surface geometry into linear Tet4 and export valid CalculiX .inp", () => {
      const box = StepMesher.createBoxSurface(0, 0, 0, 0.05, 0.02, 0.02);
      const result = StepMesher.meshSurfaceToTetrahedra(box.vertices, box.indices, {
        resolution: 10,
        order: "linear",
      });

      assert.ok(result.mesh.numNodes > 0, "Should generate mesh nodes");
      assert.ok(result.mesh.numElements > 0, "Should generate tetrahedral elements");
      assert.strictEqual(result.quality.numInvertedElements, 0, "Should have 0 inverted elements");

      const inp = StepMesher.exportToCalculixInp(result.mesh, result.patches, {
        materialName: "ALUMINUM",
        youngsModulus: 70e9,
        poissonsRatio: 0.33,
      });

      assert.ok(inp.includes("*HEADING"), "Deck should contain *HEADING");
      assert.ok(inp.includes("*NODE"), "Deck should contain *NODE");
      assert.ok(inp.includes("*ELEMENT, TYPE=C3D4"), "Deck should contain linear C3D4 elements");
      assert.ok(inp.includes("*MATERIAL, NAME=ALUMINUM"), "Deck should contain material definition");
      assert.ok(inp.includes("*SOLID SECTION"), "Deck should contain solid section");
      assert.ok(inp.includes("*STEP"), "Deck should contain *STEP");
      assert.ok(inp.includes("*END STEP"), "Deck should end step cleanly");
    });

    it("should support quadratic Tet10 elevation and C3D10 export", () => {
      const box = StepMesher.createBoxSurface(0, 0, 0, 0.04, 0.02, 0.02);
      const result = StepMesher.meshSurfaceToTetrahedra(box.vertices, box.indices, {
        resolution: 8,
        order: "quadratic",
      });

      assert.strictEqual(result.mesh.nodesPerElement, 10, "Nodes per element should be 10 for Tet10");
      assert.strictEqual(result.mesh.elements.length, result.mesh.numElements * 10);

      const inp = StepMesher.exportToCalculixInp(result.mesh, result.patches);
      assert.ok(inp.includes("*ELEMENT, TYPE=C3D10"), "Deck should contain quadratic C3D10 elements");
    });

    it("should export valid SU2 CFD mesh format with markers", () => {
      const box = StepMesher.createBoxSurface(0, 0, 0, 0.04, 0.02, 0.02);
      const result = StepMesher.meshSurfaceToTetrahedra(box.vertices, box.indices, {
        resolution: 8,
        order: "linear",
      });

      const su2 = StepMesher.exportToSu2Mesh(result.mesh, result.patches);
      assert.ok(su2.startsWith("NDIME= 3"), "SU2 mesh should declare 3D dimension");
      assert.ok(su2.includes(`NELEM= ${result.mesh.numElements}`), "SU2 mesh should have NELEM header");
      assert.ok(su2.includes(`NPOIN= ${result.mesh.numNodes}`), "SU2 mesh should have NPOIN header");
      assert.ok(su2.includes("NMARK="), "SU2 mesh should declare boundary markers");
      assert.ok(su2.includes("MARKER_TAG="), "SU2 mesh should define marker tags");
    });

    it("should support end-to-end meshing with boundary layer inflation", () => {
      const box = StepMesher.createBoxSurface(0, 0, 0, 0.04, 0.02, 0.02);
      const result = StepMesher.meshSurfaceToTetrahedra(box.vertices, box.indices, {
        resolution: 8,
        inflation: {
          firstLayerHeight: 0.0005,
          numLayers: 2,
          growthRatio: 1.2,
          targetPatch: "FIXED_SUPPORT",
        },
      });

      assert.ok(result.inflationResult !== undefined, "Boundary layer inflation result should be present");
      assert.ok(result.inflationResult.numNodes > 0, "Inflation should generate layered nodes");
      assert.ok(result.inflationResult.numElements > 0, "Inflation should generate prism tetrahedra");
    });
  });
});
