// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildCaeSimulationModel, evaluateCaeReadiness } from "@modelscript/cad-viewer/CaeSimulationTree";
import {
  computeRk4Streamlines,
  computeVtkFieldSummary,
  sampleScientificColormap,
  sampleVtkCutLine,
} from "@modelscript/cad-viewer/VtkRenderer";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractTetBoundaryFaces,
  generateFluidEnclosureMesh,
  generateLocalTetMesh,
  runLocalCfdStudy,
  runLocalFeaStudy,
} from "../../../packages/editor/src/workbench/util/cae-local-runner";

describe("CaeSimulationTree — buildCaeSimulationModel", () => {
  it("extracts SimScale-style tree sections from a CalculiX/Abaqus FEA .inp deck", () => {
    const inp = `*HEADING
Thermal & Structural Bracket
*NODE
1, 0.0, 0.0, 0.0
2, 10.0, 0.0, 0.0
3, 10.0, 10.0, 0.0
*ELEMENT, TYPE=C3D8, ELSET=EALL
1, 1, 2, 3, 1, 2, 3, 1, 2
*MATERIAL, NAME=Al6061_T6
*ELASTIC
68900.0, 0.33
*TIE, NAME=Housing_Contact
*INITIAL CONDITIONS, TYPE=TEMPERATURE
NALL, 293.15
*STEP
*HEAT TRANSFER
*BOUNDARY, NSET=FIX_BASE
1, 1, 3, 0.0
*CLOAD
2, 2, -1500.0
*END STEP`;

    const model = buildCaeSimulationModel(inp, [{ name: "Housing.step", watertight: true, faces: 24 }]);
    assert.strictEqual(model.dialect, "fea");
    assert.strictEqual(model.studyTitle, "Thermal Analysis");
    assert.strictEqual(model.geometries.length, 1);
    assert.strictEqual(model.contacts.length, 1);
    assert.strictEqual(model.materials[0]?.label, "Al6061_T6");
    assert.strictEqual(model.initialConditions[0]?.label, "Initial TEMPERATURE");
    assert.strictEqual(model.boundaryConditions.length, 2);
    assert.strictEqual(model.boundaryConditions[0]?.targetSet, "FIX_BASE");
    assert.strictEqual(model.mesh.nodeCount, 3);
    assert.strictEqual(model.mesh.elementCount, 1);
    assert.strictEqual(model.statuses.materials, "ok");
    assert.strictEqual(model.statuses.initialConditions, "ok");
    assert.strictEqual(model.statuses.boundaryConditions, "ok");
    assert.strictEqual(model.statuses.mesh, "ok");
  });

  it("extracts CFD initial conditions, markers, numerics, and control from an SU2 .cfg deck", () => {
    const cfg = `SOLVER= RANS
KIND_TURB_MODEL= SST
MACH_NUMBER= 0.78
REYNOLDS_NUMBER= 6.5e6
FREESTREAM_TEMPERATURE= 288.15
MARKER_EULER= ( airfoil )
MARKER_FAR= ( farfield )
CFL_NUMBER= 5.0
ITER= 500`;

    const model = buildCaeSimulationModel(cfg);
    assert.strictEqual(model.dialect, "cfd");
    assert.strictEqual(model.studyTitle, "Compressible Flow Analysis");
    assert.strictEqual(model.initialConditions.length, 3);
    assert.strictEqual(model.boundaryConditions.length, 2);
    assert.strictEqual(model.boundaryConditions[0]?.targetSet, "airfoil");
    assert.strictEqual(model.numerics.length, 3);
    assert.strictEqual(model.simulationControl[0]?.label, "ITER");
    assert.strictEqual(model.statuses.initialConditions, "ok");
    assert.strictEqual(model.statuses.boundaryConditions, "ok");
  });

  it("executes browser-local FEA Tet4 solve and returns stress/displacement + convergence logs", async () => {
    const inp = `*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
3, 0.0, 1.0, 0.0
4, 0.0, 0.0, 1.0
*ELEMENT, TYPE=C3D4, ELSET=EALL
1, 1, 2, 3, 4
*MATERIAL, NAME=Al6061
*ELASTIC
68900.0e6, 0.33
*BOUNDARY
1, 1, 3, 0.0
2, 1, 3, 0.0
3, 1, 3, 0.0
*CLOAD
4, 3, -1000.0`;

    const res = await runLocalFeaStudy(inp, "run-1", "Run 1");
    assert.strictEqual(res.runEntry.status, "finished");
    assert.ok(res.maxStressMpa > 0);
    assert.ok(res.runEntry.residuals && res.runEntry.residuals.length > 0);
    assert.ok(res.runEntry.logLines && res.runEntry.logLines.length > 0);
    const feaVtk = new TextDecoder().decode(res.vtkBuffer);
    assert.ok(feaVtk.includes('Name="Von Mises Stress"'));
    assert.ok(feaVtk.includes('Name="Displacement"'));
  });

  it("generates an in-browser Tet4 mesh and quality metrics via generateLocalTetMesh", () => {
    const meshRes = generateLocalTetMesh("coarse", [1.0, 0.5, 0.5]);
    assert.ok(meshRes.nodeCount > 0);
    assert.ok(meshRes.elementCount > 0);
    assert.ok(Number.isFinite(meshRes.maxAspectRatio) && meshRes.maxAspectRatio > 0);
    assert.ok(Number.isFinite(meshRes.minQuality));
    const vtkText = new TextDecoder().decode(meshRes.vtkBuffer);
    assert.ok(vtkText.includes("<VTKFile"));
  });

  it("generates a surface-conforming Tet4 mesh from an arbitrary closed surface mesh", () => {
    const vertices = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
    const indices = [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ];
    const meshRes = generateLocalTetMesh("coarse", [1, 1, 1], { vertices, indices });
    assert.ok(meshRes.nodeCount > 0);
    assert.ok(meshRes.elementCount > 0);
  });

  it("executes browser-local D3Q19 LBM CFD solve and encodes VTK PolyData with Velocity & Pressure", async () => {
    const cfg = `SOLVER= RANS
MACH_NUMBER= 0.1
REYNOLDS_NUMBER= 100.0`;

    const res = await runLocalCfdStudy(cfg, "run-1", "Run 1", undefined, 8);
    assert.strictEqual(res.runEntry.status, "finished");
    const vtkText = new TextDecoder().decode(res.vtkBuffer);
    assert.ok(vtkText.includes("<VTKFile"));
    assert.ok(vtkText.includes('Name="Velocity"'));
    assert.ok(vtkText.includes('Name="Pressure"'));
    assert.ok(res.runEntry.residuals && res.runEntry.residuals.length > 0);

    const cutSamples = sampleVtkCutLine(res.vtkBuffer, "Velocity", "x", 8);
    assert.ok(cutSamples.length > 0);
    assert.ok(cutSamples.every((p) => Number.isFinite(p.s) && Number.isFinite(p.value)));
  });

  it("integrates 3D RK4 streamlines through a vector field", () => {
    const coords = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
    const vecs = [1, 0.2, 0, 1, 0.2, 0, 1, 0.2, 0, 1, 0.2, 0, 1, 0.2, 0, 1, 0.2, 0, 1, 0.2, 0, 1, 0.2, 0];
    const geom = computeRk4Streamlines(coords, vecs, 8, 3, 4, 6);
    assert.ok(geom !== null);
    const posAttr = geom.getAttribute("position");
    assert.ok(posAttr && posAttr.count >= 2);
    geom.dispose();
  });

  it("subtracts a solid obstacle from a wind-tunnel box via generateFluidEnclosureMesh", () => {
    const verts = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
    const inds = [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ];
    const enc = generateFluidEnclosureMesh({ vertices: verts, indices: inds }, 1.5);
    assert.ok(enc.polygonCount >= 6);
    assert.ok(enc.vertices.length > 0 && enc.indices.length > 0);
    assert.ok(enc.bounds.min[0] < 0 && enc.bounds.max[0] > 1);
  });

  it("emits CHT Temperature and logs honest notice for unsupported Multiphase VOF in runLocalCfdStudy", async () => {
    const cfg = `SOLVER= RANS
CHT= YES
MULTIPHASE= VOF`;
    const res = await runLocalCfdStudy(cfg, "run-cht", "CHT Run", undefined, 8);
    const vtkText = new TextDecoder().decode(res.vtkBuffer);
    assert.ok(vtkText.includes('Name="Temperature"'));
    assert.ok(!vtkText.includes('Name="Phase Fraction"'), "must not fabricate synthetic Phase Fraction");
    assert.ok(res.runEntry.logLines?.some((l) => l.includes("Multiphase/VOF is not yet solved")));
  });

  it("evaluateCaeReadiness detects missing FEA setup items and passes complete studies", () => {
    const incomplete = buildCaeSimulationModel("*MATERIAL, NAME=Al6061\n*ELASTIC\n68900, 0.33\n");
    const badReport = evaluateCaeReadiness(incomplete);
    assert.strictEqual(badReport.ready, false);
    assert.ok(badReport.errorCount >= 2, "expected missing mesh and BC errors");

    const complete = buildCaeSimulationModel(`*NODE
1, 0, 0, 0
2, 1, 0, 0
3, 0, 1, 0
4, 0, 0, 1
*ELEMENT, TYPE=C3D4
1, 1, 2, 3, 4
*MATERIAL, NAME=Al6061
*ELASTIC
68900e6, 0.33
*BOUNDARY
1, 1, 3, 0.0
*CLOAD
4, 3, -1000.0`);
    const okReport = evaluateCaeReadiness(complete);
    assert.strictEqual(okReport.ready, true);
    assert.strictEqual(okReport.errorCount, 0);
  });

  it("persists generated Tet4 mesh (with Element Quality) directly into runLocalFeaStudy", async () => {
    const meshRes = generateLocalTetMesh("coarse", [1.0, 0.5, 0.5]);
    const meshVtk = new TextDecoder().decode(meshRes.vtkBuffer);
    assert.ok(meshVtk.includes('Name="Element Quality"'), "expected real Element Quality DataArray in mesh VTK");
    assert.ok(meshRes.nodeCoords.length === meshRes.nodeCount * 3);
    assert.ok(meshRes.elements.length === meshRes.elementCount * 4);

    const deckWithoutMesh = `*MATERIAL, NAME=Al6061
*ELASTIC
68900e6, 0.33`;
    const feaRes = await runLocalFeaStudy(deckWithoutMesh, "run-mesh", "Persisted Mesh Run", undefined, {
      generatedMesh: {
        nodeCoords: meshRes.nodeCoords,
        elements: meshRes.elements,
        numNodes: meshRes.nodeCount,
        numElements: meshRes.elementCount,
      },
    });
    assert.strictEqual(feaRes.runEntry.status, "finished");
    assert.ok(feaRes.maxStressMpa > 0);
    assert.ok(feaRes.runEntry.logLines?.some((l) => l.includes("Bound persisted in-browser Tet4 mesh")));
  });

  it("extractTetBoundaryFaces removes shared internal faces between adjacent tetrahedra", () => {
    // Two tetrahedra sharing face (0, 1, 2): tet0 = (0,1,2,3), tet1 = (0,2,1,4)
    // Total faces = 8, shared internal face = 2 occurrences => 6 outer boundary faces (18 indices)
    const elems = new Uint32Array([0, 1, 2, 3, 0, 2, 1, 4]);
    const skin = extractTetBoundaryFaces(elems, 2);
    assert.strictEqual(skin.length, 6 * 3, "expected 6 outer boundary triangles (18 indices)");
  });

  it("sampleScientificColormap and computeVtkFieldSummary compute valid RGB and surface integrals", async () => {
    for (const cm of ["turbo", "viridis", "plasma", "coolwarm"] as const) {
      const [r, g, b] = sampleScientificColormap(0.5, cm);
      assert.ok(r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1, `invalid RGB for ${cm}`);
    }

    // Unit square [0,1]^2 (2 triangles, total area = 1.0) with uniform scalar field = 10.0 => integral = 10.0, mean = 10.0
    const vtk = `<?xml version="1.0"?>
<VTKFile type="PolyData" version="0.1">
  <PolyData>
    <Piece NumberOfPoints="4" NumberOfPolys="2">
      <PointData Scalars="Pressure">
        <DataArray type="Float32" Name="Pressure" NumberOfComponents="1" format="ascii">10 10 10 10</DataArray>
      </PointData>
      <Points>
        <DataArray type="Float32" NumberOfComponents="3" format="ascii">0 0 0 1 0 0 1 1 0 0 1 0</DataArray>
      </Points>
      <Polys>
        <DataArray type="Int32" Name="connectivity" format="ascii">0 1 2 0 2 3</DataArray>
        <DataArray type="Int32" Name="offsets" format="ascii">3 6</DataArray>
      </Polys>
    </Piece>
  </PolyData>
</VTKFile>`;
    const summary = computeVtkFieldSummary(new TextEncoder().encode(vtk), "Pressure");
    assert.ok(summary !== null);
    assert.ok(Math.abs(summary.totalArea - 1.0) < 1e-6);
    assert.ok(Math.abs(summary.surfaceIntegral - 10.0) < 1e-6);
    assert.ok(Math.abs(summary.areaWeightedMean - 10.0) < 1e-6);
    assert.strictEqual(summary.triangleCount, 2);
  });
});
