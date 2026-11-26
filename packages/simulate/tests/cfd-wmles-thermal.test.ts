// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  LBM_D3Q19_WGSL,
  LBM_THERMAL_D3Q7_WGSL,
  LbmVoxelizer,
  WebGPULbmRunner,
  solveSpaldingUtau,
  type LbmGridConfig,
} from "../src/cfd/index.js";

console.log("=== Testing Workstream 2: WMLES, Regularized Collision, Thermal D3Q7 & Atomic WGSL ===");

// 1. Verify WGSL shader contains atomic drag reduction, WMLES, regularized collision & thermal D3Q7 entry point
{
  assert.ok(LBM_D3Q19_WGSL.includes("array<atomic<i32>>"), "WGSL must use atomic<i32> for dragOutput");
  assert.ok(LBM_D3Q19_WGSL.includes("atomicAdd(&dragOutput[0]"), "WGSL must accumulate drag atomically");
  assert.ok(LBM_D3Q19_WGSL.includes("solve_spalding_utau"), "WGSL must define solve_spalding_utau for WMLES");
  assert.ok(
    LBM_D3Q19_WGSL.includes("useRegularized"),
    "WGSL must support useRegularized uniform for Hermite regularized collision",
  );
  assert.ok(LBM_D3Q19_WGSL.includes("useWMLES"), "WGSL must support useWMLES uniform for wall-modeled LES");
  assert.ok(LBM_THERMAL_D3Q7_WGSL.includes("cs_lbm_thermal_step"), "Thermal WGSL must define cs_lbm_thermal_step");
  console.log("  ✓ WGSL atomic drag reduction, WMLES, regularized collision & D3Q7 thermal shader verified.");
}

// 2. Verify Spalding universal law-of-the-wall solver accuracy in viscous sublayer and log-law region
{
  const nu = 1.5e-5; // air kinematic viscosity m^2/s
  const kappa = 0.41;
  const B = 5.2;

  // Log-law test: target u_tau = 0.5 m/s at y = 0.005 m -> y+ = 166.7
  const yLog = 0.005;
  const uTauTarget = 0.5;
  const yPlusTarget = (uTauTarget * yLog) / nu;
  const uPlusLog = (1.0 / kappa) * Math.log(yPlusTarget) + B;
  const uTanLog = uPlusLog * uTauTarget;

  const uTauSolved = solveSpaldingUtau(uTanLog, yLog, nu, kappa, B);
  const relErr = Math.abs(uTauSolved - uTauTarget) / uTauTarget;
  console.log(
    `  Spalding log-law check (y+=${yPlusTarget.toFixed(1)}): u_tau=${uTauSolved.toFixed(4)} vs ${uTauTarget} (err=${(relErr * 100).toFixed(2)}%)`,
  );
  assert.ok(relErr < 0.02, `Spalding u_tau error too high: ${(relErr * 100).toFixed(2)}%`);
}

// 3. WMLES + Regularized Collision + D3Q7 Thermal Transport around heated cylinder
{
  const config: LbmGridConfig = {
    nx: 32,
    ny: 16,
    nz: 16,
    dx: 0.005,
    dt: 1e-4,
    tau: 0.505, // High-Re regime (Re ~ 1e4)
    density: 1.225,
    inletVelocity: [8.0, 0.0, 0.0],
    turbulenceModel: "wmles",
    collisionOperator: "regularized",
    smagorinskyConstant: 0.14,
    curvedBoundary: true,
    thermal: {
      enabled: true,
      prandtl: 0.71,
      ambientTempK: 300.0,
      wallTempK: 400.0,
    },
  };

  const obstacles = {
    cylinders: [
      { center: [0.35, 0.5, 0.5] as [number, number, number], radius: 0.15, axis: "z" as const, length: 1.0 },
    ],
  };
  const grid = LbmVoxelizer.voxelize(config, obstacles);
  config.deltaWall = LbmVoxelizer.computeWallDistances(config, obstacles, grid);

  const runner = new WebGPULbmRunner(config, grid);
  const res = runner.step(40);

  assert.ok(Number.isFinite(res.aerodynamicForceN[0]), "Drag force must be finite");
  assert.ok(res.maxVelocity > 0 && res.maxVelocity < 40.0, `Velocity unbounded: ${res.maxVelocity}`);
  assert.ok(
    res.meanWallShearPa !== undefined && res.meanWallShearPa > 0,
    `Expected positive WMLES wall shear, got ${res.meanWallShearPa}`,
  );
  assert.ok(
    res.meanWallTemperatureK !== undefined && res.meanWallTemperatureK > 300.0 && res.meanWallTemperatureK <= 400.0,
    `Expected heated boundary layer temperature in (300, 400] K, got ${res.meanWallTemperatureK}`,
  );
  console.log(
    `  ✓ WMLES + Regularized + Thermal D3Q7 (40 steps): Fx=${res.aerodynamicForceN[0].toFixed(4)}N, tau_w=${res.meanWallShearPa.toFixed(4)} Pa, T_wall_adj=${res.meanWallTemperatureK.toFixed(2)} K`,
  );
}

console.log("All Workstream 2 WMLES & Thermal LBM tests passed!");
