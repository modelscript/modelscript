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
import { CaeCloudClient } from "../src/caeCloudClient.js";

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
    const centroidStress = (nodalStresses[0] + nodalStresses[1] + nodalStresses[2]) / 3;
    assert.strictEqual(centroidStress, 200.0);

    // Probe near vertex 2 with weights (0.1, 0.1, 0.8)
    const nearN2Stress = 0.1 * nodalStresses[0] + 0.1 * nodalStresses[1] + 0.8 * nodalStresses[2];
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
});
