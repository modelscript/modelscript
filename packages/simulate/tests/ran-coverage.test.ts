// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RAYTRACE_PROPAGATION_WGSL } from "../src/gpu/shaders/raytrace_propagation.wgsl.js";
import {
  RanCoverageSolver,
  type BaseStationSector,
  type CoverageGridBounds,
  type UrbanObstacle3D,
} from "../src/index.js";

describe("WebGPU 3D Urban Ray-Tracing & Cellular Coverage Suite", () => {
  it("WGSL shader contains valid compute entry point and uniform structs", () => {
    assert.ok(RAYTRACE_PROPAGATION_WGSL.includes("@compute @workgroup_size(16, 16)"));
    assert.ok(RAYTRACE_PROPAGATION_WGSL.includes("struct SimulationUniforms"));
    assert.ok(RAYTRACE_PROPAGATION_WGSL.includes("computeFspl"));
    assert.ok(RAYTRACE_PROPAGATION_WGSL.includes("computeKnifeEdgeLoss"));
  });

  it("calculates unoccluded line-of-sight (LOS) coverage and 3GPP antenna pattern", async () => {
    const bounds: CoverageGridBounds = {
      originX: 0,
      originY: 0,
      widthMeters: 400,
      heightMeters: 400,
      stepMeters: 20, // 20x20 grid = 400 points
      rxHeightMeters: 1.5,
    };

    const sector: BaseStationSector = {
      id: "SEC-NORTH",
      name: "Macro Site North Sector",
      position: [200, 200, 30], // Centered at (200, 200), height 30m AGL
      carrierFrequencyGhz: 3.5, // 3.5 GHz C-band
      eirpDbm: 58.0,
      azimuthDeg: 0.0, // Pointing East (along +X)
      downTiltDeg: 12.0, // Aligned with ~100m distance elevation angle
    };

    const solver = new RanCoverageSolver(bounds, []);
    assert.equal(solver.gridWidth, 20);
    assert.equal(solver.gridHeight, 20);
    assert.equal(solver.totalPoints, 400);

    const result = await solver.solveSector(sector, { forceCpu: true });

    assert.equal(result.sectorId, "SEC-NORTH");
    assert.equal(result.rsrpGrid.length, 400);
    assert.equal(result.backendUsed, "cpu");
    assert.equal(result.statistics.losAreaPercent, 100.0, "100% of points should be LOS in open terrain");

    // Symmetrically positioned points 110m East vs 110m West of tower
    const eastIdx = 10 * 20 + 15; // (x=15, y=10) -> 110m East of (200, 200)
    const westIdx = 10 * 20 + 4; // (x=4, y=10) -> 110m West of (200, 200)
    assert.ok(
      result.rsrpGrid[eastIdx]! > result.rsrpGrid[westIdx]!,
      `Main beam RSRP (${result.rsrpGrid[eastIdx]} dBm) should exceed backlobe (${result.rsrpGrid[westIdx]} dBm)`,
    );
    // The difference should be significant (over 20 dB front-to-back ratio)
    assert.ok(
      result.rsrpGrid[eastIdx]! - result.rsrpGrid[westIdx]! > 20.0,
      `Front-to-back difference should be >20 dB, got ${(result.rsrpGrid[eastIdx]! - result.rsrpGrid[westIdx]!).toFixed(1)} dB`,
    );
  });

  it("calculates building occlusion, rooftop knife-edge diffraction, and shadow loss", async () => {
    const bounds: CoverageGridBounds = {
      originX: 0,
      originY: 0,
      widthMeters: 500,
      heightMeters: 200,
      stepMeters: 10, // 50 x 20 = 1000 points
      rxHeightMeters: 1.5,
    };

    const sector: BaseStationSector = {
      id: "SEC-WEST",
      position: [50, 100, 25], // Tx at (50, 100), 25m high
      carrierFrequencyGhz: 3.5,
      eirpDbm: 56.0,
      azimuthDeg: 0.0, // Eastward along +X
      downTiltDeg: 2.0,
    };

    // A large 3D building located between x=150 and x=250, height 35m (higher than tower!)
    const building: UrbanObstacle3D = {
      id: "BLDG-SKYSCRAPER",
      name: "High-Rise Commercial Building",
      minX: 150,
      minY: 50,
      minZ: 0,
      maxX: 250,
      maxY: 150,
      maxZ: 35, // 35m AGL
    };

    const solver = new RanCoverageSolver(bounds, [building]);
    const result = await solver.solveSector(sector, { forceCpu: true });

    // Points directly behind the building (x=350, y=100) should be diffracted or in shadow
    const shadowIdx = 10 * 50 + 35; // y=10, x=35
    assert.ok(result.mechanismGrid[shadowIdx] === 2 || result.mechanismGrid[shadowIdx] === 3);
    assert.ok(result.statistics.diffractedAreaPercent > 0.0 || result.statistics.shadowAreaPercent > 0.0);
  });

  it("aggregates multi-sector composite coverage and resolves best-server handover", async () => {
    const bounds: CoverageGridBounds = {
      originX: 0,
      originY: 0,
      widthMeters: 300,
      heightMeters: 300,
      stepMeters: 15, // 20 x 20 = 400 points
      rxHeightMeters: 1.5,
    };

    // 3-sector tri-sector site at (150, 150)
    const sectors: BaseStationSector[] = [
      {
        id: "ALPHA-0DEG",
        position: [150, 150, 30],
        carrierFrequencyGhz: 3.5,
        eirpDbm: 58.0,
        azimuthDeg: 0.0, // North
        downTiltDeg: 3.0,
      },
      {
        id: "BETA-120DEG",
        position: [150, 150, 30],
        carrierFrequencyGhz: 3.5,
        eirpDbm: 58.0,
        azimuthDeg: 120.0, // Southeast
        downTiltDeg: 3.0,
      },
      {
        id: "GAMMA-240DEG",
        position: [150, 150, 30],
        carrierFrequencyGhz: 3.5,
        eirpDbm: 58.0,
        azimuthDeg: 240.0, // Southwest
        downTiltDeg: 3.0,
      },
    ];

    const solver = new RanCoverageSolver(bounds, []);
    const composite = await solver.solveMultiSector(sectors, { forceCpu: true });

    assert.equal(composite.totalSectors, 3);
    assert.equal(composite.bestServerGrid.length, 400);
    assert.ok(composite.bestServerGrid.includes("ALPHA-0DEG"));
    assert.ok(composite.bestServerGrid.includes("BETA-120DEG"));
    assert.ok(composite.bestServerGrid.includes("GAMMA-240DEG"));
    assert.ok(composite.overallCoveragePercentAboveMinus110Dbm > 90.0);
  });
});
