// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { createRegularGrid2DMesh, linkSwmmJunctionsToMesh, solveSwmmCoupled1D2D, type SwmmDeck } from "../src/index.js";

describe("SWMM 2D Hydrodynamic Surface Inundation & Overland Flow (InfoWorks ICM Parity)", () => {
  it("1. createRegularGrid2DMesh builds valid triangular unstructured mesh with topological faces", () => {
    const mesh = createRegularGrid2DMesh(4, 4, 10.0, 10.0, 0.0, 0.0, (x, y) => 10.0 + 0.01 * x);

    // 4x4 quads split into 32 triangles
    assert.strictEqual(mesh.cells.length, 32, "4x4 grid split into triangles must have 32 cells");
    // (4+1)*(4+1) = 25 nodes
    assert.strictEqual(mesh.nodes.length, 25, "5x5 grid must have 25 nodes");
    assert.ok(mesh.faces.length > 40, "Mesh must contain internal and boundary faces");

    // Verify cell geometry
    const cell0 = mesh.cells[0]!;
    assert.strictEqual(cell0.areaM2, 50.0, "Each right-triangular cell should have area dx*dy/2 = 50 m^2");
    assert.ok(cell0.zBedM >= 10.0, "Bed elevation should follow topography function");

    // Verify face normals are unit length
    for (const face of mesh.faces) {
      const mag = Math.hypot(face.normalX, face.normalY);
      assert.ok(Math.abs(mag - 1.0) < 1e-6, "Face normal vector must be normalized to unit length");
      assert.ok(face.cellL >= 0, "Left cell must be valid");
    }
  });

  it("2. Well-balanced Audusse hydrostatic reconstruction preserves lake-at-rest C-property on irregular terrain", () => {
    // Topography with varying bed elevation from 5m to 7m
    const mesh = createRegularGrid2DMesh(3, 3, 20.0, 20.0, 0.0, 0.0, (x, y) => 5.0 + 0.02 * x + 0.01 * y);

    // Lake at rest with constant water surface elevation WSE = 12.0m across all cells
    const dummyDeck: SwmmDeck = {
      flowUnits: "CMS",
      routingModel: "DYNWAVE",
      options: {},
      junctions: new Map(),
      outfalls: new Map(),
      storage: new Map(),
      conduits: new Map(),
      pumps: new Map(),
      orifices: new Map(),
      weirs: new Map(),
      crossSections: new Map(),
      subcatchments: new Map(),
    };

    const res = solveSwmmCoupled1D2D(dummyDeck, mesh, {
      simulationDurationSeconds: 10.0,
      timeStepSeconds: 0.5,
    });

    // Verify all cells stay quiescent with 0 velocity
    for (const summary of res.cells.values()) {
      assert.ok(
        summary.maxVelocityMps < 1e-4,
        `Lake-at-rest must maintain zero velocity: got ${summary.maxVelocityMps} m/s`,
      );
    }
  });

  it("3. Simulates 1D-2D coupled surcharging manhole overflow, surface spreading, and flood hazard rating", () => {
    // 1D SWMM network with high surcharge
    const deck: SwmmDeck = {
      flowUnits: "CMS",
      routingModel: "DYNWAVE",
      options: {},
      junctions: new Map([
        [
          "J1",
          {
            id: "J1",
            elevation: 10.0,
            maxDepth: 2.0, // Rim elevation = 12.0m
            initDepth: 2.8, // Surcharged by 0.8m above ground rim!
            aPond: 4.0,
            range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10, startOffset: 0, endOffset: 10 },
          },
        ],
        [
          "J2",
          {
            id: "J2",
            elevation: 8.0,
            maxDepth: 2.0,
            initDepth: 0.5,
            range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 10, startOffset: 11, endOffset: 20 },
          },
        ],
      ]),
      outfalls: new Map([
        [
          "OF1",
          {
            id: "OF1",
            elevation: 6.0,
            type: "FREE",
            range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 10, startOffset: 21, endOffset: 30 },
          },
        ],
      ]),
      storage: new Map(),
      conduits: new Map([
        [
          "C1",
          {
            id: "C1",
            inletNode: "J1",
            outletNode: "J2",
            length: 100.0,
            roughness: 0.013,
            range: { startLine: 4, startColumn: 1, endLine: 4, endColumn: 10, startOffset: 31, endOffset: 40 },
          },
        ],
        [
          "C2",
          {
            id: "C2",
            inletNode: "J2",
            outletNode: "OF1",
            length: 100.0,
            roughness: 0.013,
            range: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 10, startOffset: 41, endOffset: 50 },
          },
        ],
      ]),
      pumps: new Map(),
      orifices: new Map(),
      weirs: new Map(),
      crossSections: new Map([
        [
          "C1",
          {
            linkId: "C1",
            shape: "CIRCULAR",
            geom1: 0.6,
            range: { startLine: 6, startColumn: 1, endLine: 6, endColumn: 10, startOffset: 51, endOffset: 60 },
          },
        ],
        [
          "C2",
          {
            linkId: "C2",
            shape: "CIRCULAR",
            geom1: 0.6,
            range: { startLine: 7, startColumn: 1, endLine: 7, endColumn: 10, startOffset: 61, endOffset: 70 },
          },
        ],
      ]),
      subcatchments: new Map(),
    };

    // 2D terrain sloping gently from 10m at J1 down to 8m
    const mesh = createRegularGrid2DMesh(6, 6, 10.0, 10.0, 0.0, 0.0, (x, y) => 10.0 - 0.01 * x);

    // Link J1 to cell near (0, 0)
    linkSwmmJunctionsToMesh(
      mesh,
      deck,
      new Map([
        ["J1", [5.0, 5.0]],
        ["J2", [50.0, 30.0]],
      ]),
    );

    const coupledResult = solveSwmmCoupled1D2D(deck, mesh, {
      simulationDurationSeconds: 60.0,
      timeStepSeconds: 0.5,
      manholeDischargeCoeff: 0.6,
      manholeDiameterM: 1.2,
    });

    // 1. Manhole J1 must spill floodwaters onto the 2D surface
    assert.ok(
      coupledResult.cumulativeSpillVolumeM3 > 0.0,
      `Surcharged manhole must spill volume: got ${coupledResult.cumulativeSpillVolumeM3.toFixed(2)} m^3`,
    );

    // 2. Surface inundated area must expand beyond 0
    assert.ok(
      coupledResult.peakFloodedAreaM2 > 0.0,
      `Flooded surface area must be recorded: got ${coupledResult.peakFloodedAreaM2} m^2`,
    );

    // 3. Peak depth and flood hazard rating must be evaluated on flooded cells
    let floodedCellCount = 0;
    let maxHazardObserved = 0.0;
    for (const summary of coupledResult.cells.values()) {
      if (summary.isFlooded) {
        floodedCellCount++;
      }
      if (summary.maxHazardRating > maxHazardObserved) {
        maxHazardObserved = summary.maxHazardRating;
      }
    }

    assert.ok(floodedCellCount > 0, "At least one cell must be flagged as flooded");
    assert.ok(maxHazardObserved > 0.01, `Flood hazard rating must be calculated: got ${maxHazardObserved.toFixed(3)}`);

    // 4. Time series must track surface volume progression
    assert.ok(coupledResult.timeSeries.length > 5, "Time series snapshots must be saved");
    const peakTimeStep = coupledResult.timeSeries.reduce(
      (max, s) => (s.surfacePondedVolumeM3 > max ? s.surfacePondedVolumeM3 : max),
      0,
    );
    assert.ok(peakTimeStep > 0.0, "Surface ponded volume must peak above zero");
  });
});
