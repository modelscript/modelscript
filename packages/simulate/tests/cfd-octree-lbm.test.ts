// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LbmCellType, LbmVoxelizer, type LbmGridConfig } from "../src/cfd/index.js";
import { OctreeLbmRunner, computeAcousticFineTau, computePhysicalViscosity } from "../src/cfd/octree-lbm-runner.js";

console.log("=== Testing WS-C: 2-Level Octree LBM & Native FP64 CUDA/HIP LBM Kernel ===");

// 1. Acoustic scaling viscosity invariance unit check
{
  const dxC = 0.005;
  const dtC = 1e-4;
  const tauC = 0.62;
  const tauF = computeAcousticFineTau(tauC);
  const nuC = computePhysicalViscosity(tauC, dxC, dtC);
  const nuF = computePhysicalViscosity(tauF, dxC * 0.5, dtC * 0.5);

  assert.ok(Math.abs(tauF - (0.5 + 2.0 * (tauC - 0.5))) < 1e-12, `Unexpected tau_f: ${tauF}`);
  assert.ok(Math.abs(nuF - nuC) / nuC < 1e-12, `Viscosity mismatch: nu_c=${nuC}, nu_f=${nuF}`);
  console.log(
    `  ✓ Acoustic scaling verified: tau_c=${tauC} -> tau_f=${tauF.toFixed(4)}, nu_c=${nuC.toExponential(4)} === nu_f=${nuF.toExponential(4)} m^2/s`,
  );
}

// 2. 2-level OctreeLbmRunner around a cylinder obstacle over 20 coarse (= 40 fine) steps
{
  const config: LbmGridConfig = {
    nx: 32,
    ny: 16,
    nz: 16,
    dx: 0.005,
    dt: 5e-5,
    tau: 0.65,
    density: 1.225,
    inletVelocity: [1.5, 0.0, 0.0],
    turbulenceModel: "smagorinsky_les",
    collisionOperator: "regularized",
    smagorinskyConstant: 0.14,
  };

  const cylCenter: [number, number, number] = [0.35, 0.5, 0.5];
  const cylRadius = 0.14;
  const obstacles = {
    cylinders: [{ center: cylCenter, radius: cylRadius, axis: "z" as const, length: 1.0 }],
  };
  const coarseGrid = LbmVoxelizer.voxelize(config, obstacles);

  // Fine-resolution exact cylinder classifier for the 2x refined patch
  const fineClassifier = (nxFrac: number, nyFrac: number, _nzFrac: number): LbmCellType => {
    const dxNorm = nxFrac - cylCenter[0];
    const dyNorm = (nyFrac - cylCenter[1]) * (config.ny / config.nx);
    const r = Math.hypot(dxNorm, dyNorm);
    if (r <= cylRadius * (config.ny / config.nx)) {
      return LbmCellType.ObstacleSolid;
    }
    return LbmCellType.Fluid;
  };

  const octree = new OctreeLbmRunner(config, coarseGrid, {
    refineFraction: 0.12,
    fineCellClassifier: fineClassifier,
  });

  const res = octree.step(20);

  // (a) Viscosity invariance & mass conservation
  const viscRelErr = Math.abs(res.fineViscosity - res.coarseViscosity) / res.coarseViscosity;
  assert.strictEqual(res.coarseSteps, 20, `Expected 20 coarse steps, got ${res.coarseSteps}`);
  assert.strictEqual(res.fineSteps, 40, `Expected 40 fine sub-steps, got ${res.fineSteps}`);
  assert.ok(viscRelErr < 1e-12, `Viscosity not invariant: nu_c=${res.coarseViscosity}, nu_f=${res.fineViscosity}`);
  assert.ok(
    res.massConservationError < 0.01,
    `Mass conservation drift exceeded 1%: ${(res.massConservationError * 100).toFixed(4)}%`,
  );

  // (b) Active cell count < 40% of equivalent uniform fine grid
  assert.ok(
    res.compressionRatio < 0.4,
    `Expected compressionRatio < 0.4, got ${res.compressionRatio.toFixed(4)} (${res.activeCellCount}/${res.equivalentUniformFineCells})`,
  );

  // (c) Finite positive drag force & bounded velocity
  const dragX = res.aerodynamicForceN[0];
  assert.ok(Number.isFinite(dragX) && dragX > 0, `Expected finite positive drag force Fx > 0, got ${dragX}`);
  assert.ok(
    Number.isFinite(res.maxVelocity) && res.maxVelocity > 0 && res.maxVelocity < 25.0,
    `Velocity out of bounds: ${res.maxVelocity}`,
  );

  // Verify solution-driven vorticity AMR map is 2:1 balanced
  const vortMap = octree.computeVorticityRefinementMap(0.15);
  assert.ok(vortMap.isBalanced2To1, "Octree vorticity refinement map must satisfy 2:1 balance");

  console.log(
    `  ✓ 2-level Octree LBM (20 coarse / 40 fine steps): ` +
      `Fx=${dragX.toFixed(5)} N, maxVel=${res.maxVelocity.toFixed(3)} m/s, ` +
      `massDrift=${(res.massConservationError * 100).toFixed(4)}%, ` +
      `activeCells=${res.activeCellCount}/${res.equivalentUniformFineCells} (${(res.compressionRatio * 100).toFixed(1)}%)`,
  );

  octree.destroy();
}

// 3. Verify native FP64 CUDA/HIP kernel file exists and exports required kernels
{
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const kernelPath = path.resolve(__dirname, "../../native/src/kernels/cfd_lbm_fp64.cu");
  assert.ok(fs.existsSync(kernelPath), `Expected native FP64 LBM kernel at ${kernelPath}`);

  const src = fs.readFileSync(kernelPath, "utf8");
  assert.ok(src.includes('extern "C" __global__ void lbm_d3q19_wmles_fp64'), "Missing lbm_d3q19_wmles_fp64");
  assert.ok(src.includes('extern "C" __global__ void lbm_d3q7_thermal_fp64'), "Missing lbm_d3q7_thermal_fp64");
  assert.ok(src.includes('extern "C" __global__ void lbm_pack_halo5_fp64'), "Missing lbm_pack_halo5_fp64");
  assert.ok(src.includes('extern "C" __global__ void lbm_unpack_halo5_fp64'), "Missing lbm_unpack_halo5_fp64");
  assert.ok(src.includes("solve_spalding_utau_fp64"), "Missing Spalding WMLES FP64 solver");
  console.log(`  ✓ Native FP64 CUDA/HIP kernel verified at ${kernelPath}`);
}

console.log("All WS-C Octree LBM & Native FP64 CUDA/HIP kernel tests passed!");
