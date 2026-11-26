// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  CartesianDomainDecomposer,
  DistributedLbmRunner,
  IpcSlurmHaloTransport,
  LBM_HALO_PACK_WGSL,
  LbmVoxelizer,
  WebGPULbmRunner,
  type LbmGridConfig,
} from "../src/cfd/index.js";

console.log("=== Testing Workstream 3: Multi-GPU / Distributed Domain Decomposition & Halo Exchange ===");

// 1. Verify WGSL halo pack kernel and 3D partitioning invariants
{
  assert.ok(LBM_HALO_PACK_WGSL.includes("cs_pack_halo_x"), "Halo WGSL must define cs_pack_halo_x");
  const parts = CartesianDomainDecomposer.decompose(24, 16, 12, 2, 2, 1);
  assert.strictEqual(parts.length, 4);
  let totalInterior = 0;
  for (const p of parts) {
    totalInterior += p.interiorSize[0] * p.interiorSize[1] * p.interiorSize[2];
  }
  assert.strictEqual(totalInterior, 24 * 16 * 12, "Sum of subdomain interior cells must equal global cells");
  console.log("  ✓ CartesianDomainDecomposer 2x2x1 partition invariants & WGSL halo kernel verified.");
}

// 2. Compare 2x1x1 and 2x2x1 DistributedLbmRunner against monolithic WebGPULbmRunner
const sharedConfig: LbmGridConfig = {
  nx: 24,
  ny: 12,
  nz: 12,
  dx: 0.005,
  dt: 1e-4,
  tau: 0.65,
  density: 1.225,
  inletVelocity: [4.0, 0.0, 0.0],
};

const sharedGrid = LbmVoxelizer.voxelize(sharedConfig, {
  boxes: [{ min: [0.3, 0.35, 0.35], max: [0.55, 0.65, 0.65] }],
});

{
  const mono = new WebGPULbmRunner(sharedConfig, sharedGrid);
  const dist2x1 = new DistributedLbmRunner(sharedConfig, sharedGrid, [2, 1, 1]);
  const dist2x2 = new DistributedLbmRunner(sharedConfig, sharedGrid, [2, 2, 1]);

  const monoRes = mono.step(15);
  const res2x1 = dist2x1.step(15);
  const res2x2 = dist2x2.step(15);

  const vel2x1 = dist2x1.gatherVelocityMagnitude();
  const vel2x2 = dist2x2.gatherVelocityMagnitude();

  let maxDiff2x1 = 0;
  let maxDiff2x2 = 0;
  for (let i = 0; i < mono.totalCells; i++) {
    const vMono = Math.hypot(mono.vx[i]!, mono.vy[i]!, mono.vz[i]!);
    const d1 = Math.abs(vMono - vel2x1[i]!);
    const d2 = Math.abs(vMono - vel2x2[i]!);
    if (d1 > maxDiff2x1) maxDiff2x1 = d1;
    if (d2 > maxDiff2x2) maxDiff2x2 = d2;
  }

  console.log(
    `  2x1x1 parity (15 steps): maxVelDiff=${maxDiff2x1.toExponential(2)} m/s, maxVel=${res2x1.maxVelocity.toFixed(3)} vs mono=${monoRes.maxVelocity.toFixed(3)}`,
  );
  console.log(
    `  2x2x1 parity (15 steps): maxVelDiff=${maxDiff2x2.toExponential(2)} m/s, maxVel=${res2x2.maxVelocity.toFixed(3)} vs mono=${monoRes.maxVelocity.toFixed(3)}`,
  );

  assert.ok(maxDiff2x1 < 1e-4, `2x1x1 distributed velocity diverged from monolithic: ${maxDiff2x1}`);
  assert.ok(maxDiff2x2 < 0.05, `2x2x1 distributed velocity diverged from monolithic: ${maxDiff2x2}`);
  assert.ok(Number.isFinite(res2x1.aerodynamicForceN[0]), "2x1x1 drag force must be finite");
  assert.ok(Number.isFinite(res2x2.aerodynamicForceN[0]), "2x2x1 drag force must be finite");
  console.log("  ✓ DistributedLbmRunner 2x1x1 and 2x2x1 halo-exchange parity verified!");
}

// 3. Verify compactFivePop on 2x1x1 reduces halo bytes by >70% with < 1e-4 m/s parity
{
  const mono = new WebGPULbmRunner(sharedConfig, sharedGrid);
  const fullDist = new DistributedLbmRunner(sharedConfig, sharedGrid, [2, 1, 1], undefined, {
    compactFivePop: false,
  });
  const compactDist = new DistributedLbmRunner(sharedConfig, sharedGrid, [2, 1, 1], undefined, {
    compactFivePop: true,
  });

  mono.step(15);
  fullDist.step(15);
  compactDist.step(15);

  const fullBytes = fullDist.getLastHaloBytesTransferred();
  const compactBytes = compactDist.getLastHaloBytesTransferred();
  const reductionPct = ((fullBytes - compactBytes) / fullBytes) * 100;

  const velCompact = compactDist.gatherVelocityMagnitude();
  let maxDiffCompact = 0;
  for (let i = 0; i < mono.totalCells; i++) {
    const vMono = Math.hypot(mono.vx[i]!, mono.vy[i]!, mono.vz[i]!);
    const diff = Math.abs(vMono - velCompact[i]!);
    if (diff > maxDiffCompact) maxDiffCompact = diff;
  }

  console.log(
    `  compactFivePop 2x1x1 (15 steps): bytes=${compactBytes} vs full=${fullBytes} (${reductionPct.toFixed(1)}% reduction), maxVelDiff=${maxDiffCompact.toExponential(2)} m/s`,
  );

  assert.ok(fullBytes > 0, "Full 19-pop halo bytes must be > 0");
  assert.ok(compactBytes > 0, "Compact 5-pop halo bytes must be > 0");
  assert.ok(reductionPct > 70, `Expected >70% halo byte reduction, got ${reductionPct.toFixed(2)}%`);
  assert.ok(maxDiffCompact < 1e-4, `compactFivePop velocity diverged from monolithic: ${maxDiffCompact}`);
  console.log("  ✓ compactFivePop bandwidth reduction (>70%) and <1e-4 m/s velocity parity verified!");
}

// 4. Verify async stepParallel(10) matches monolithic WebGPULbmRunner within < 1e-4 m/s
{
  const mono = new WebGPULbmRunner(sharedConfig, sharedGrid);
  const distParallel = new DistributedLbmRunner(sharedConfig, sharedGrid, [2, 1, 1], undefined, {
    compactFivePop: true,
  });

  mono.step(10);
  const parallelRes = await distParallel.stepParallel(10);
  const velParallel = distParallel.gatherVelocityMagnitude();

  let maxDiffParallel = 0;
  for (let i = 0; i < mono.totalCells; i++) {
    const vMono = Math.hypot(mono.vx[i]!, mono.vy[i]!, mono.vz[i]!);
    const diff = Math.abs(vMono - velParallel[i]!);
    if (diff > maxDiffParallel) maxDiffParallel = diff;
  }

  console.log(
    `  stepParallel 2x1x1 (10 steps): maxVelDiff=${maxDiffParallel.toExponential(2)} m/s, maxVel=${parallelRes.maxVelocity.toFixed(3)}`,
  );
  assert.ok(maxDiffParallel < 1e-4, `stepParallel velocity diverged from monolithic: ${maxDiffParallel}`);
  assert.ok(Number.isFinite(parallelRes.aerodynamicForceN[0]), "stepParallel drag force must be finite");
  console.log("  ✓ stepParallel(10) <1e-4 m/s velocity parity verified!");
}

// 5. Verify IpcSlurmHaloTransport achieves < 1e-4 m/s parity vs monolithic runner
{
  const ipcDir = path.resolve(process.cwd(), ".cache/test-halo-ipc");
  fs.rmSync(ipcDir, { recursive: true, force: true });
  try {
    const mono = new WebGPULbmRunner(sharedConfig, sharedGrid);
    const ipcTransport = new IpcSlurmHaloTransport(ipcDir);
    const distIpc = new DistributedLbmRunner(sharedConfig, sharedGrid, [2, 1, 1], ipcTransport, {
      compactFivePop: true,
    });

    mono.step(10);
    const ipcRes = distIpc.step(10);
    const velIpc = distIpc.gatherVelocityMagnitude();

    let maxDiffIpc = 0;
    for (let i = 0; i < mono.totalCells; i++) {
      const vMono = Math.hypot(mono.vx[i]!, mono.vy[i]!, mono.vz[i]!);
      const diff = Math.abs(vMono - velIpc[i]!);
      if (diff > maxDiffIpc) maxDiffIpc = diff;
    }

    console.log(
      `  IpcSlurmHaloTransport 2x1x1 (10 steps): maxVelDiff=${maxDiffIpc.toExponential(2)} m/s, bytes=${distIpc.getLastHaloBytesTransferred()}, maxVel=${ipcRes.maxVelocity.toFixed(3)}`,
    );
    assert.ok(maxDiffIpc < 1e-4, `IpcSlurmHaloTransport velocity diverged from monolithic: ${maxDiffIpc}`);
    assert.ok(Number.isFinite(ipcRes.aerodynamicForceN[0]), "IpcSlurmHaloTransport drag force must be finite");
    console.log("  ✓ IpcSlurmHaloTransport <1e-4 m/s velocity parity verified!");
  } finally {
    fs.rmSync(ipcDir, { recursive: true, force: true });
  }
}

console.log("All Workstream 3 Distributed Domain Decomposition tests passed!");
