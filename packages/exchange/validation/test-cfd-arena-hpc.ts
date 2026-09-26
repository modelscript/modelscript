// SPDX-License-Identifier: AGPL-3.0-or-later

import { LbmCoSimParticipant } from "@modelscript/exchange/cosim";
import assert from "node:assert";
import { CfdFieldArena, LBM_D3Q19_WGSL, LbmVoxelizer, WebGPULbmRunner, type LbmGridConfig } from "../src/cfd/index.js";

console.log("=== Testing HPC CFD Arena, SoA Memory Coalescing & Binary Streaming ===");

// 1. Test CfdFieldArena Structure-of-Arrays Layout & Alignment
{
  const config: LbmGridConfig = {
    nx: 16,
    ny: 8,
    nz: 8,
    dx: 0.01,
    dt: 1e-4,
    tau: 0.6,
    density: 1.225,
    inletVelocity: [2.0, 0.0, 0.0],
  };

  const arena = new CfdFieldArena(config);
  assert.strictEqual(arena.totalCells, 16 * 8 * 8);
  assert.strictEqual(arena.qDirections, 19);

  // Check SoA stride: cell c in direction q is at index q * totalCells + c
  const cellIdx = 42;
  const qDir = 5;
  const expectedSoAIdx = 5 * arena.totalCells + 42;
  assert.strictEqual(arena.getSoAIndex(cellIdx, qDir), expectedSoAIdx);

  // Verify memory coalescing: consecutive cells in direction q are adjacent floats
  const idx1 = arena.getSoAIndex(0, qDir);
  const idx2 = arena.getSoAIndex(1, qDir);
  assert.strictEqual(idx2 - idx1, 1, "Consecutive cells must be adjacent for warp memory coalescing");

  // Verify equilibrium initialization
  const rho0 = arena.rho[cellIdx];
  assert.strictEqual(rho0, 1.0, "Initial density must be 1.0");

  const vx0 = arena.vx[cellIdx];
  assert.ok(Math.abs(vx0 - 2.0) < 1e-5, `Inlet velocity must be initialized to 2.0, got ${vx0}`);

  console.log("  ✓ CfdFieldArena SoA layout verified with contiguous warp coalescing.");
}

// 2. Test WGSL Compute Shader Integrity
{
  assert.ok(LBM_D3Q19_WGSL.includes("@compute @workgroup_size(8, 8, 4)"), "WGSL must have 256-thread workgroup");
  assert.ok(LBM_D3Q19_WGSL.includes("cs_lbm_step"), "WGSL must define cs_lbm_step entry point");
  assert.ok(LBM_D3Q19_WGSL.includes("useBouzidi"), "WGSL must handle Bouzidi curved boundary interpolation");
  assert.ok(LBM_D3Q19_WGSL.includes("useLES"), "WGSL must support Smagorinsky LES turbulence");
  console.log("  ✓ WGSL D3Q19 compute shader validated.");
}

// 3. Test WebGPULbmRunner with Arena Backing
{
  const config: LbmGridConfig = {
    nx: 24,
    ny: 12,
    nz: 12,
    dx: 0.005,
    dt: 1e-4,
    tau: 0.65,
    density: 1.225,
    inletVelocity: [4.0, 0.0, 0.0],
  };

  const cellGrid = LbmVoxelizer.voxelize(config, {
    boxes: [{ min: [0.3, 0.3, 0.3], max: [0.6, 0.7, 0.7] }],
  });

  const arena = new CfdFieldArena(config, cellGrid);
  const runner = new WebGPULbmRunner(config, cellGrid, arena);

  assert.strictEqual(runner.arena, arena, "Runner must use provided CfdFieldArena");
  const stepRes = runner.step(5);
  assert.ok(stepRes.maxVelocity > 0, "Velocity must advance");
  assert.ok(Number.isFinite(stepRes.aerodynamicForceN[0]), "Drag force must be finite");
  console.log(
    `  ✓ WebGPULbmRunner executed 5 steps with SoA arena. Drag Fx=${stepRes.aerodynamicForceN[0].toFixed(5)}N`,
  );
}

// 4. Test Zero-Copy Binary Payload Streaming
{
  const config: LbmGridConfig = {
    nx: 16,
    ny: 8,
    nz: 8,
    dx: 0.01,
    dt: 1e-4,
    tau: 0.6,
    density: 1.225,
  };

  const participant = new LbmCoSimParticipant("test-cfd", "TestCFD", { config });
  await participant.doStep(0, 1e-4);

  const payload = participant.getMeshPayload();
  assert.ok(payload.geometry.positions instanceof Float32Array, "positions must be Float32Array");
  assert.ok(payload.geometry.indices instanceof Uint32Array, "indices must be Uint32Array");
  assert.ok(payload.fields.velocityMagnitude instanceof Float32Array, "velocityMagnitude must be Float32Array");

  const binBuffer = participant.getBinaryMeshPayload();
  assert.ok(binBuffer instanceof ArrayBuffer, "Binary payload must be an ArrayBuffer");
  assert.ok(binBuffer.byteLength > 40, "Binary payload must contain header + field buffers");

  const view = new DataView(binBuffer);
  const magic = view.getUint32(0, true);
  assert.strictEqual(magic, 0x4c424d31, "Magic must be 'LBM1' (0x4C424D31)");

  const vertCount = view.getUint32(32, true);
  const idxCount = view.getUint32(36, true);
  assert.strictEqual(vertCount, payload.geometry.positions.length / 3);
  assert.strictEqual(idxCount, payload.geometry.indices.length);

  console.log(
    `  ✓ Zero-copy binary mesh payload generated: ${binBuffer.byteLength} bytes, ${vertCount} vertices, ${idxCount} indices.`,
  );
}

console.log("All HPC CFD Arena & Binary Streaming tests passed successfully!");
