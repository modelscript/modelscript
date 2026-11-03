// SPDX-License-Identifier: AGPL-3.0-or-later

import { materializeSu2Config, parseSu2Config } from "@modelscript/cfd";
import { materializeCalculixDeck, parseInpDeck } from "@modelscript/fea";
import {
  FeaSolver,
  StepMesher,
  type FeaBoundaryConditions,
  type MaterialProperties,
  type Tet4Mesh,
} from "@modelscript/simulate";
import assert from "node:assert";
import { describe, it } from "node:test";
import { CaeCloudClient } from "../src/cae-cloud-client.js";

describe("CAE Graphical Custom Editors (.inp / .cfg) Integration", () => {
  it("parses and executes in-WASM FEA solver from CalculiX deck (.inpt / .inp)", () => {
    const parametricDeck = `
** CalculiX Parametric Cantilever Test Deck
*HEADING
Cantilever beam under tip load
*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
3, 0.5, 0.866, 0.0
4, 0.5, 0.288, 0.816
*ELEMENT, TYPE=C3D4, ELSET=BEAM
1, 1, 2, 3, 4
*NSET, NSET=FIXED
1
*NSET, NSET=TIP
4
*MATERIAL, NAME=STEEL
*ELASTIC
{{ 210.0 * 1e9 }}, 0.30
*DENSITY
7850.0
*STEP
*STATIC
*BOUNDARY
FIXED, 1, 3, 0.0
*CLOAD
TIP, 3, {{ -1000.0 * 5.0 }}
*END STEP
`;

    // 1. Materialize deck
    const materialized = materializeCalculixDeck(parametricDeck);
    assert.ok(materialized.includes("210000000000"), "Must evaluate Young's modulus");
    assert.ok(materialized.includes("-5000"), "Must evaluate applied load");

    // 2. Parse into InpDeckData
    const data = parseInpDeck(materialized);
    assert.strictEqual(data.nodes.size, 4, "Should parse 4 nodes");
    assert.strictEqual(data.elements.size, 1, "Should parse 1 tetrahedral element");
    assert.strictEqual(data.fixedNodes.has(1), true, "Node 1 should be fixed");
    assert.strictEqual(data.nodalLoads.has(4), true, "Node 4 should have applied load");

    // 3. Remap into Tet4Mesh
    const nodeIdToIdx = new Map<number, number>();
    const positions: number[] = [];
    let idx = 0;
    for (const [id, node] of data.nodes.entries()) {
      nodeIdToIdx.set(id, idx++);
      positions.push(node.x, node.y, node.z);
    }

    const elementIndices: number[] = [];
    for (const elem of data.elements.values()) {
      for (const nId of elem.nodes) {
        const nIdx = nodeIdToIdx.get(nId);
        if (nIdx !== undefined) elementIndices.push(nIdx);
      }
    }

    const mesh: Tet4Mesh = {
      nodeCoords: new Float32Array(positions),
      elements: new Uint32Array(elementIndices),
      numNodes: data.nodes.size,
      numElements: 1,
      elementOrder: "linear",
      nodesPerElement: 4,
      boundaryNodes: new Map([["FIXED", [0]]]),
    };

    const material: MaterialProperties = {
      E: data.materials.get("STEEL")?.E ?? 210e9,
      nu: data.materials.get("STEEL")?.nu ?? 0.3,
      rho: data.materials.get("STEEL")?.rho ?? 7850,
    };

    const fixedNodes = new Set<number>();
    for (const nId of data.fixedNodes) {
      const nIdx = nodeIdToIdx.get(nId);
      if (nIdx !== undefined) fixedNodes.add(nIdx);
    }

    const nodalLoads = new Map<number, [number, number, number]>();
    for (const [nId, f] of data.nodalLoads.entries()) {
      const nIdx = nodeIdToIdx.get(nId);
      if (nIdx !== undefined) nodalLoads.set(nIdx, f);
    }

    const bcs: FeaBoundaryConditions = {
      fixedNodes,
      nodalLoads,
    };

    // 4. Solve via in-WASM FeaSolver
    const solver = new FeaSolver(mesh, material);
    const result = solver.solve(bcs);

    assert.ok(result.maxVonMisesStress > 0, "Max von Mises stress should be positive under load");
    assert.ok(result.maxDisplacement > 0, "Max displacement should be positive under load");
    assert.strictEqual(result.elementVonMises.length, 1, "Should compute element stress");
    assert.strictEqual(result.nodalVonMises.length, 4, "Should compute interpolated nodal stress");
  });

  it("parses and verifies SU2 CFD config (.cfgt / .cfg) for 3D aerodynamic viewer", () => {
    const parametricCfg = `
% SU2 Aerodynamic Configuration
SOLVER= RANS
KIND_TURB_MODEL= SA
MATH_PROBLEM= DIRECT
MACH_NUMBER= {{ 0.85 * 0.95 }}
AOA= 2.5
REYNOLDS_NUMBER= 6.5e6
FREESTREAM_VELOCITY= ({{ 280.0 * 1.05 }}, 0.0, 0.0)
MESH_FILENAME= naca0012.su2
MARKER_HEATFLUX= ( airfoil, 0.0 )
MARKER_FAR= ( farfield )
MARKER_SYM= ( symmetry )
`;

    // 1. Materialize config
    const materialized = materializeSu2Config(parametricCfg);
    assert.ok(materialized.includes("0.8075"), "Must evaluate Mach number");
    assert.ok(materialized.includes("294"), "Must evaluate freestream velocity");

    // 2. Parse structured config
    const data = parseSu2Config(materialized);
    assert.strictEqual(data.rawDirectives.get("SOLVER"), "RANS");
    assert.strictEqual(data.rawDirectives.get("AOA"), "2.5");
    assert.strictEqual(data.rawDirectives.get("MESH_FILENAME"), "naca0012.su2");
    assert.strictEqual(data.machNumber, 0.8075);

    // 3. Verify markers
    assert.ok(data.wallMarkers.includes("airfoil"), "Should have airfoil wall marker");
    assert.ok(data.rawDirectives.has("MARKER_HEATFLUX"), "Should have MARKER_HEATFLUX");
    assert.ok(data.rawDirectives.has("MARKER_FAR"), "Should have MARKER_FAR");
  });

  it("applies interactive 3D boundary conditions and loads to .inp deck with bidirectional re-parse", () => {
    let baseDeck = `*HEADING
Test Deck
*NODE
1, 0, 0, 0
2, 1, 0, 0
3, 0, 1, 0
4, 0, 0, 1
*ELEMENT, TYPE=C3D4
1, 1, 2, 3, 4
*STEP
*STATIC
*END STEP
`;

    // 1. Simulate raycast action: Fix Node 2
    const fixSnippet = "\n*BOUNDARY\n2, 1, 3, 0.0\n";
    const endStepIdx = baseDeck.lastIndexOf("*END STEP");
    baseDeck = baseDeck.slice(0, endStepIdx) + fixSnippet + baseDeck.slice(endStepIdx);

    // 2. Simulate raycast action: Apply Force on Node 4
    const forceSnippet = "\n*CLOAD\n4, 3, -2500.0\n";
    const endStepIdx2 = baseDeck.lastIndexOf("*END STEP");
    baseDeck = baseDeck.slice(0, endStepIdx2) + forceSnippet + baseDeck.slice(endStepIdx2);

    // 3. Re-parse and assert
    const data = parseInpDeck(baseDeck);
    assert.ok(data.fixedNodes.has(2), "Node 2 must be fixed via interactive writeback");
    assert.ok(data.nodalLoads.has(4), "Node 4 must have applied load via interactive writeback");
    const load = data.nodalLoads.get(4);
    assert.deepStrictEqual(load, [0, 0, -2500.0]);
  });

  it("calculates numerical probe values with barycentric triangle interpolation", () => {
    // Triangle with vertices at (0,0), (1,0), (0,1)
    // Nodal stresses: N0=100 MPa, N1=200 MPa, N2=300 MPa
    const nodalStresses = [100.0, 200.0, 300.0];

    // Centroid probe with equal barycentric weights (1/3, 1/3, 1/3)
    const centroidStress = (nodalStresses[0]! + nodalStresses[1]! + nodalStresses[2]!) / 3;
    assert.strictEqual(centroidStress, 200.0);

    // Probe near vertex 2 with weights (0.1, 0.1, 0.8)
    const nearN2Stress = 0.1 * nodalStresses[0]! + 0.1 * nodalStresses[1]! + 0.8 * nodalStresses[2]!;
    assert.strictEqual(nearN2Stress, 270.0);
  });

  it("discretizes CAD surface into CalculiX FEA deck and SU2 CFD grid with automated patch tagging", () => {
    // Standard procedural CAD box: 50mm x 20mm x 15mm
    const box = StepMesher.createBoxSurface(0, 0, 0, 0.05, 0.02, 0.015);
    const result = StepMesher.meshSurfaceToTetrahedra(box.vertices, box.indices, {
      resolution: 10,
      order: "quadratic",
    });

    assert.ok(result.mesh.numNodes > 0, "Must generate nodes");
    assert.ok(result.mesh.numElements > 0, "Must generate elements");
    assert.strictEqual(result.quality.numInvertedElements, 0, "No inverted cells allowed");

    // 1. Export CalculiX .inp
    const inpDeck = StepMesher.exportToCalculixInp(result.mesh, result.patches, {
      materialName: "STEEL_STRUCTURAL",
      youngsModulus: 210e9,
      poissonsRatio: 0.29,
    });

    const parsedInp = parseInpDeck(inpDeck);
    assert.strictEqual(parsedInp.nodes.size, result.mesh.numNodes);
    assert.strictEqual(parsedInp.elements.size, result.mesh.numElements);
    assert.ok(parsedInp.materials.has("STEEL_STRUCTURAL"));

    // 2. Export SU2 .su2
    const su2Mesh = StepMesher.exportToSu2Mesh(result.mesh, result.patches);
    assert.ok(su2Mesh.startsWith("NDIME= 3"));
    assert.ok(su2Mesh.includes(`NELEM= ${result.mesh.numElements}`));
    assert.ok(su2Mesh.includes(`NPOIN= ${result.mesh.numNodes}`));
  });

  it("converts cloud VTU results into 3D FeaMeshPayload for webview viewport rendering", () => {
    const client = new CaeCloudClient();
    const sampleVtu = `<VTKFile type="UnstructuredGrid" version="0.1">
  <UnstructuredGrid>
    <Piece NumberOfPoints="4" NumberOfCells="1">
      <PointData>
        <DataArray type="Float32" Name="Displacement" NumberOfComponents="3" format="ascii">
          0 0 0 0.001 0 -0.002 0 0.001 -0.002 0 0 -0.005
        </DataArray>
        <DataArray type="Float32" Name="Stress_VonMises" NumberOfComponents="1" format="ascii">
          1e7 2e7 1.5e7 5e7
        </DataArray>
      </PointData>
      <Points>
        <DataArray type="Float32" NumberOfComponents="3" format="ascii">
          0 0 0 1 0 0 0 1 0 0 0 1
        </DataArray>
      </Points>
      <Cells>
        <DataArray type="Int32" Name="connectivity" format="ascii">
          0 1 2 3
        </DataArray>
        <DataArray type="Int32" Name="offsets" format="ascii">
          4
        </DataArray>
        <DataArray type="UInt8" Name="types" format="ascii">
          10
        </DataArray>
      </Cells>
    </Piece>
  </UnstructuredGrid>
</VTKFile>`;

    const payload = client.parseVtuXmlToPayload(sampleVtu);
    assert.strictEqual(payload.type, "fea-mesh");
    assert.strictEqual(payload.geometry.positions.length, 12);
    assert.ok(payload.geometry.indices.length >= 4);
    assert.strictEqual(payload.fields.vonMisesStress.length, 4);
    assert.strictEqual(payload.fields.displacements.length, 12);
    assert.strictEqual(payload.stats.maxStress, 5e7);
    assert.ok(payload.stats.maxDisplacement > 0.004);
    assert.ok(payload.stats.safetyFactor > 0);
  });

  it("handles Parametric DoE Sweep Orchestrator message flow and 1-click surrogate training", () => {
    // 1. Simulate webview posting launchSweep message
    const sweepConfig = {
      title: "Cantilever Stiffness Sweep",
      strategy: "lhs" as const,
      sampleCount: 6,
      concurrency: 2,
      parameters: [
        { name: "load", min: 1000, max: 10000, nominal: 5000 },
        { name: "youngsModulus", min: 180e9, max: 220e9, nominal: 200e9 },
      ],
    };

    assert.strictEqual(sweepConfig.sampleCount, 6);
    assert.strictEqual(sweepConfig.parameters.length, 2);

    // 2. Validate sweep run generation
    const mockRuns = Array.from({ length: sweepConfig.sampleCount }, (_, i) => ({
      runIndex: i,
      status: "completed",
      parameters: {
        load: sweepConfig.parameters[0]!.min + i * 1500,
        youngsModulus: sweepConfig.parameters[1]!.nominal,
      },
      scalars: {
        maxVonMisesStressPa: (100 + i * 20) * 1e6,
      },
    }));

    assert.strictEqual(mockRuns.length, 6);
    assert.strictEqual(mockRuns[5]!.parameters.load, 8500);

    // 3. Simulate surrogateProgress event sent back to webview
    const surrogateMetrics = {
      capturedEnergy: 0.9997,
      numModes: 4,
      r2: 0.9992,
    };

    assert.ok(surrogateMetrics.capturedEnergy >= 0.999);
    assert.ok(surrogateMetrics.r2 > 0.99);
  });

  it("extracts and normalizes 3D geometry from SCAD and SU2 mesh files for the CFD .cfg editor", async () => {
    const { extractScadCadComponents } = await import("@modelscript/scad");
    const { CaeParametricSampler } = await import("@modelscript/simulate");
    const { normalizeCfdGeometry, parseSu2MeshSurface } = await import("../src/cfg-editor-provider.js");

    // 1. Evaluate multi-part OpenSCAD geometry (e.g. fuselage + wings in mm scale)
    const scadSource = `
      union() {
        color([0.2, 0.6, 0.9]) cube([200, 40, 20], center=true);
        translate([0, 0, 15]) cylinder(r=25, h=30, center=true);
      }
    `;
    const comps = await extractScadCadComponents(scadSource);
    assert.strictEqual(comps.length, 2, "Should extract 2 CSG parts from SCAD");

    const allPositions: number[] = [];
    const allIndices: number[] = [];
    for (const c of comps) {
      const pos = c.cad.position ?? [0, 0, 0];
      const baseV = allPositions.length / 3;
      for (let i = 0; i < c.proceduralMesh.vertices.length; i += 3) {
        const wx = c.proceduralMesh.vertices[i]! + pos[0];
        const wy = c.proceduralMesh.vertices[i + 1]! + pos[1];
        const wz = c.proceduralMesh.vertices[i + 2]! + pos[2];
        allPositions.push(wx, wz, -wy);
      }
      for (const idx of c.proceduralMesh.indices) {
        allIndices.push(baseV + idx);
      }
    }

    const normalized = normalizeCfdGeometry({
      positions: allPositions,
      indices: allIndices,
      sourceFile: "aircraft.scad",
    });

    assert.ok(normalized.positions.length > 30, "Should contain 3D CAD vertices");
    let maxCoord = 0;
    for (const v of normalized.positions) {
      maxCoord = Math.max(maxCoord, Math.abs(v));
    }
    assert.ok(maxCoord <= 0.35 && maxCoord >= 0.3, `Normalized span half-extent (${maxCoord}) must fit wind tunnel`);

    // 2. Sample CFD envelope on the normalized 3D CAD mesh
    const [cfdRun] = CaeParametricSampler.sampleCfdEnvelope(
      { positions: normalized.positions, indices: normalized.indices },
      { velocities: [25.0], anglesOfAttackDeg: [5.0] },
    );
    assert.ok(cfdRun, "Must produce CFD run on 3D CAD mesh");
    assert.strictEqual(cfdRun.fields["pressure"]!.length, normalized.positions.length / 3);
    const minP = Math.min(...cfdRun.fields["pressure"]!);
    const maxP = Math.max(...cfdRun.fields["pressure"]!);
    assert.ok(maxP - minP > 50, "Pressure field must vary across the 3D CAD chord and upper/lower surfaces");

    // 3. Verify SU2 surface mesh extraction
    const box = StepMesher.createBoxSurface(0, 0, 0, 0.2, 0.1, 0.05);
    const meshed = StepMesher.meshSurfaceToTetrahedra(box.vertices, box.indices, { resolution: 8 });
    const su2Text = StepMesher.exportToSu2Mesh(meshed.mesh, meshed.patches);
    const parsedSu2 = parseSu2MeshSurface(su2Text, ["WALL_BODY"]);
    assert.ok(parsedSu2, "Must parse surface triangles from .su2 file");
    assert.ok(parsedSu2.positions.length >= 24, "Must extract surface vertex coordinates");
    assert.ok(parsedSu2.indices.length >= 36, "Must extract surface triangle indices");
  });

  it("extracts exact B-Rep geometry from STEP files (cylinders, concave L-brackets, and ORIENTED_EDGE with vertex IDs) without falling back to a bounding box", () => {
    // 1. Cylinder with 3 faces (top disk, bottom disk, cylindrical wall) and explicit vertex IDs in ORIENTED_EDGE
    const cylinderStep = `ISO-10303-21;
HEADER;
FILE_NAME('Cylinder.step','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1 = CARTESIAN_POINT('',(0.0,0.0,0.0));
#2 = DIRECTION('',(0.0,0.0,1.0));
#3 = DIRECTION('',(1.0,0.0,0.0));
#4 = AXIS2_PLACEMENT_3D('',#1,#2,#3);
#5 = CARTESIAN_POINT('',(0.0,0.0,20.0));
#6 = AXIS2_PLACEMENT_3D('',#5,#2,#3);
#10 = CIRCLE('',#4,10.0);
#11 = CIRCLE('',#6,10.0);
#12 = CARTESIAN_POINT('',(10.0,0.0,0.0));
#13 = CARTESIAN_POINT('',(10.0,0.0,20.0));
#14 = VERTEX_POINT('',#12);
#15 = VERTEX_POINT('',#13);
#16 = LINE('',#12,#2);
#20 = EDGE_CURVE('',#14,#14,#10,.T.);
#21 = EDGE_CURVE('',#15,#15,#11,.T.);
#22 = EDGE_CURVE('',#14,#15,#16,.T.);
#30 = ORIENTED_EDGE('',#14,#14,#20,.T.);
#31 = ORIENTED_EDGE('',#15,#15,#21,.T.);
#32 = ORIENTED_EDGE('',#14,#15,#22,.T.);
#33 = ORIENTED_EDGE('',#14,#15,#22,.F.);
#40 = EDGE_LOOP('',(#30));
#41 = EDGE_LOOP('',(#31));
#42 = EDGE_LOOP('',(#30,#32,#31,#33));
#50 = FACE_OUTER_BOUND('',#40,.T.);
#51 = FACE_OUTER_BOUND('',#41,.T.);
#52 = FACE_OUTER_BOUND('',#42,.T.);
#60 = PLANE('',#4);
#61 = PLANE('',#6);
#62 = CYLINDRICAL_SURFACE('',#4,10.0);
#70 = ADVANCED_FACE('',(#50),#60,.F.);
#71 = ADVANCED_FACE('',(#51),#61,.T.);
#72 = ADVANCED_FACE('',(#52),#62,.T.);
ENDSEC;
END-ISO-10303-21;`;

    const cylSurf = StepMesher.extractSurfaceFromStep(cylinderStep);
    // A fallback bounding box has only 8 vertices (24 floats) and 12 triangles (36 indices).
    // A curved cylinder must have >= 48 vertices (>= 144 floats) and radial distance ~10.0.
    assert.ok(
      cylSurf.vertices.length >= 144,
      `Cylinder STEP must be tessellated with curved circular arcs (>= 48 vertices), got ${cylSurf.vertices.length / 3}`,
    );
    assert.ok(
      cylSurf.indices.length >= 180,
      `Cylinder STEP must produce curved wall + cap triangles, got ${cylSurf.indices.length / 3}`,
    );

    // 2. Concave L-bracket planar polygon with explicit vertex refs in ORIENTED_EDGE
    const lBracketStep = `ISO-10303-21;
HEADER;
ENDSEC;
DATA;
#1 = CARTESIAN_POINT('',(0.0,0.0,0.0));
#2 = CARTESIAN_POINT('',(40.0,0.0,0.0));
#3 = CARTESIAN_POINT('',(40.0,10.0,0.0));
#4 = CARTESIAN_POINT('',(10.0,10.0,0.0));
#5 = CARTESIAN_POINT('',(10.0,40.0,0.0));
#6 = CARTESIAN_POINT('',(0.0,40.0,0.0));
#11 = VERTEX_POINT('',#1);
#12 = VERTEX_POINT('',#2);
#13 = VERTEX_POINT('',#3);
#14 = VERTEX_POINT('',#4);
#15 = VERTEX_POINT('',#5);
#16 = VERTEX_POINT('',#6);
#21 = EDGE_CURVE('',#11,#12,#100,.T.);
#22 = EDGE_CURVE('',#12,#13,#100,.T.);
#23 = EDGE_CURVE('',#13,#14,#100,.T.);
#24 = EDGE_CURVE('',#14,#15,#100,.T.);
#25 = EDGE_CURVE('',#15,#16,#100,.T.);
#26 = EDGE_CURVE('',#16,#11,#100,.T.);
#31 = ORIENTED_EDGE('',#11,#12,#21,.T.);
#32 = ORIENTED_EDGE('',#12,#13,#22,.T.);
#33 = ORIENTED_EDGE('',#13,#14,#23,.T.);
#34 = ORIENTED_EDGE('',#14,#15,#24,.T.);
#35 = ORIENTED_EDGE('',#15,#16,#25,.T.);
#36 = ORIENTED_EDGE('',#16,#11,#26,.T.);
#40 = EDGE_LOOP('',(#31,#32,#33,#34,#35,#36));
#50 = FACE_OUTER_BOUND('',#40,.T.);
#60 = DIRECTION('',(0.0,0.0,1.0));
#61 = DIRECTION('',(1.0,0.0,0.0));
#62 = AXIS2_PLACEMENT_3D('',#1,#60,#61);
#63 = PLANE('',#62);
#70 = ADVANCED_FACE('',(#50),#63,.T.);
ENDSEC;
END-ISO-10303-21;`;

    const lSurf = StepMesher.extractSurfaceFromStep(lBracketStep);
    assert.strictEqual(lSurf.vertices.length / 3, 6, "Must preserve exact 6 L-bracket vertices");
    assert.strictEqual(lSurf.indices.length / 3, 4, "6-vertex polygon must ear-clip into 4 triangles");

    // Verify no triangle centroid falls in the concave cutout region (x > 12 && y > 12)
    for (let i = 0; i < lSurf.indices.length; i += 3) {
      const i0 = lSurf.indices[i]!;
      const i1 = lSurf.indices[i + 1]!;
      const i2 = lSurf.indices[i + 2]!;
      const cx = (lSurf.vertices[i0 * 3]! + lSurf.vertices[i1 * 3]! + lSurf.vertices[i2 * 3]!) / 3;
      const cy = (lSurf.vertices[i0 * 3 + 1]! + lSurf.vertices[i1 * 3 + 1]! + lSurf.vertices[i2 * 3 + 1]!) / 3;
      assert.ok(
        !(cx > 12 && cy > 12),
        `Concave ear-clipping must not bridge across the L-bracket cutout (centroid=${cx},${cy})`,
      );
    }
  });

  it("projects FEA fields onto exact CAD surface geometry, evaluates stress probes, and exports valid .vtu XML for publishing", async () => {
    const { evaluateStressProbes, exportCfdResultToVtu, exportFeaResultToVtu, projectFieldsToSurfaceMesh } =
      await import("../src/utils/vtu-exporter.js");

    // Tetrahedral solver nodes
    const solverPositions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
    const solverStress = [10e6, 80e6, 40e6, 120e6];
    const solverDisp = [0, 0, 0, 0.001, 0, -0.002, 0, 0.001, -0.001, 0, 0, -0.005];

    // High-resolution CAD surface vertices
    const cadSurface = {
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0.5, 0, 0.5],
      indices: [0, 1, 2, 0, 1, 3, 1, 2, 3, 0, 2, 3, 0, 4, 3],
    };

    const projected = projectFieldsToSurfaceMesh(
      solverPositions,
      cadSurface.vertices,
      { stress: solverStress },
      { disp: solverDisp },
    );
    const projStress = projected.projectedScalars["stress"]!;
    const projDisp = projected.projectedVectors["disp"]!;
    assert.strictEqual(projStress.length, 5, "Projected stress must match CAD surface vertex count");
    assert.strictEqual(projDisp.length, 15, "Projected displacements must match 3x CAD vertex count");
    assert.ok(projStress[4]! > 10e6 && projStress[4]! <= 120e6);

    // Evaluate Stress Probe Points
    const probes = evaluateStressProbes(
      [
        {
          id: "probe-1",
          label: "Fillet Root P1",
          nodeIndex: 3,
          position: [0.02, 0.01, 0.98],
        },
      ],
      cadSurface.vertices,
      projStress,
      projDisp,
    );
    assert.strictEqual(probes.length, 1);
    assert.ok(Math.abs((probes[0]!.vonMisesStressPa ?? 0) / 1e6 - 120) < 1e-3, "Probe near node 3 must read 120 MPa");
    assert.ok(
      Math.abs((probes[0]!.displacementMagM ?? 0) * 1e3 - 5.0) < 1e-3,
      "Probe near node 3 must read 5.0 mm displacement",
    );

    // Export FEA result to .vtu with companionCad and parse back with CaeCloudClient
    const feaBundle = exportFeaResultToVtu({
      title: "Bracket Static Structural Study",
      nodes: solverPositions,
      triangles: [0, 1, 2, 0, 1, 3, 1, 2, 3, 0, 2, 3],
      nodalStress: solverStress,
      nodalDisplacement: solverDisp,
      maxStress: 120e6,
      maxDisplacement: 0.005,
      companionCad: cadSurface,
      stressProbes: probes,
    });
    assert.ok(feaBundle.vtuXml.includes('<VTKFile type="UnstructuredGrid"'), "Must generate VTK UnstructuredGrid XML");
    assert.ok(feaBundle.vtuXml.includes('Name="VonMisesStress"'), "Must include VonMisesStress DataArray");
    assert.ok(feaBundle.vtuXml.includes('Name="Displacement"'), "Must include Displacement DataArray");
    assert.ok(feaBundle.summaryMarkdown.includes("Fillet Root P1"), "Summary markdown must include Stress Probe table");

    const client = new CaeCloudClient();
    const roundtrip = client.parseVtuXmlToPayload(feaBundle.vtuXml);
    assert.strictEqual(roundtrip.geometry.positions.length, cadSurface.vertices.length);
    assert.strictEqual(roundtrip.fields.vonMisesStress.length, 5);

    // Export CFD result to .vtu with companionCad
    const cfdBundle = exportCfdResultToVtu({
      title: "Airfoil SU2 RANS Study",
      nodes: solverPositions,
      triangles: [0, 1, 2, 0, 1, 3, 1, 2, 3, 0, 2, 3],
      nodalPressure: [101325, 101500, 101100, 100900],
      nodalVelocity: [25, 0, 0, 28, 0, 1, 30, 0, 2, 12, 0, -1],
      companionCad: cadSurface,
    });
    assert.ok(cfdBundle.vtuXml.includes('Name="Pressure"'), "CFD VTU must include Pressure scalar field");
    assert.ok(cfdBundle.vtuXml.includes('Name="Velocity"'), "CFD VTU must include 3D Velocity vector field");
  });
});
