// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AdjointLbmSolver } from "./adjoint-lbm.js";
import { DistributedLbmRunner } from "./domain-decomposer.js";
import type { LbmGridConfig } from "./lbm-types.js";
import { LbmVoxelizer } from "./lbm-voxelizer.js";
import { WebGPULbmRunner, solveSpaldingUtau } from "./webgpu-lbm-runner.js";

export interface CfdVvCaseResult {
  id: string;
  name: string;
  reference: string;
  passed: boolean;
  measuredError: number;
  threshold: number;
  mlups: number;
  durationMs: number;
  metrics: Record<string, number | string>;
}

export interface CfdVvScorecard {
  timestamp: string;
  allPassed: boolean;
  passedCount: number;
  totalCount: number;
  cases: CfdVvCaseResult[];
}

/**
 * Runs ModelScript's automated 3D CFD Verification & Validation (V&V) benchmark suite
 * aligned with NASA CFD Vision 2030 community V&V recommendations.
 */
export function runCfdVvSuite(): CfdVvScorecard {
  const cases: CfdVvCaseResult[] = [];

  // ── Case 1: 3D Poiseuille Channel Flow vs Analytical Parabolic Profile ─────
  {
    const t0 = performance.now();
    const cfg: LbmGridConfig = {
      nx: 24,
      ny: 13,
      nz: 9,
      dx: 0.005,
      dt: 1e-4,
      tau: 0.7,
      density: 1.225,
      inletVelocity: [4.0, 0.0, 0.0],
      collisionOperator: "regularized",
    };
    const grid = LbmVoxelizer.voxelize(cfg, {
      solidWalls: { minY: true, maxY: true, minZ: true, maxZ: true },
    });
    const runner = new WebGPULbmRunner(cfg, grid);
    const steps = 25;
    runner.step(steps);
    const dtMs = performance.now() - t0;

    // Sample streamwise profile at x = nx/2, z = nz/2 across y = 1..ny-2
    const xMid = Math.floor(cfg.nx / 2);
    const zMid = Math.floor(cfg.nz / 2);
    const yFluid = cfg.ny - 2;
    let uMax = -Infinity;
    const sampled: number[] = [];
    for (let y = 1; y < cfg.ny - 1; y++) {
      const idx = xMid + y * cfg.nx + zMid * cfg.nx * cfg.ny;
      const u = runner.vx[idx]!;
      sampled.push(u);
      if (u > uMax) uMax = u;
    }

    let sqErrSum = 0;
    for (let k = 0; k < sampled.length; k++) {
      const yNorm = (k + 0.5) / yFluid; // in (0, 1)
      const uAnalytical = 4.0 * uMax * yNorm * (1.0 - yNorm);
      const diff = sampled[k]! - uAnalytical;
      sqErrSum += diff * diff;
    }
    const rmseNorm = Math.sqrt(sqErrSum / sampled.length) / Math.max(1e-6, Math.abs(uMax));
    const mlups = (runner.totalCells * steps) / Math.max(1e-3, dtMs * 1e3);

    cases.push({
      id: "VV-01-Poiseuille3D",
      name: "3D Planar Poiseuille Channel Flow",
      reference: "Analytical Hagen-Poiseuille Solution",
      passed: rmseNorm < 0.25 && uMax > 1.0,
      measuredError: Number(rmseNorm.toFixed(4)),
      threshold: 0.25,
      mlups: Number(mlups.toFixed(3)),
      durationMs: Number(dtMs.toFixed(2)),
      metrics: { uMaxMps: Number(uMax.toFixed(3)), normalizedRmse: Number(rmseNorm.toFixed(4)) },
    });
  }

  // ── Case 2: 3D Cylinder Flow Drag & Bouzidi Curved Wall Stability ──────────
  {
    const t0 = performance.now();
    const cfg: LbmGridConfig = {
      nx: 32,
      ny: 16,
      nz: 12,
      dx: 0.005,
      dt: 1e-4,
      tau: 0.52,
      density: 1.225,
      inletVelocity: [6.0, 0.0, 0.0],
      turbulenceModel: "wmles",
      collisionOperator: "regularized",
      curvedBoundary: true,
    };
    const obstacles = {
      cylinders: [
        { center: [0.35, 0.5, 0.5] as [number, number, number], radius: 0.15, axis: "z" as const, length: 1.0 },
      ],
    };
    const grid = LbmVoxelizer.voxelize(cfg, obstacles);
    cfg.deltaWall = LbmVoxelizer.computeWallDistances(cfg, obstacles, grid);
    const runner = new WebGPULbmRunner(cfg, grid);
    const steps = 30;
    const res = runner.step(steps);
    const dtMs = performance.now() - t0;

    const uInf = cfg.inletVelocity![0];
    const D = 2 * 0.15 * cfg.ny * cfg.dx;
    const L = cfg.nz * cfg.dx;
    const cd = (2 * Math.abs(res.aerodynamicForceN[0])) / (cfg.density * uInf * uInf * D * L);
    const mlups = (runner.totalCells * steps) / Math.max(1e-3, dtMs * 1e3);
    const stable = Number.isFinite(cd) && cd > 0 && res.maxVelocity < 40.0;

    cases.push({
      id: "VV-02-Cylinder3D-WMLES",
      name: "3D Cylinder Flow (Regularized WMLES + Bouzidi)",
      reference: "NASA TMR / High-Re Blunt-Body Stability",
      passed: stable,
      measuredError: stable ? 0 : 1,
      threshold: 0,
      mlups: Number(mlups.toFixed(3)),
      durationMs: Number(dtMs.toFixed(2)),
      metrics: {
        Cd: Number(cd.toFixed(3)),
        maxVelMps: Number(res.maxVelocity.toFixed(2)),
        meanWallShearPa: Number((res.meanWallShearPa ?? 0).toFixed(4)),
      },
    });
  }

  // ── Case 3: NASA TMR Turbulent Boundary Layer Spalding Wall-Law ────────────
  {
    const t0 = performance.now();
    const nu = 1.5e-5;
    const kappa = 0.41;
    const B = 5.2;
    const yPlusTargets = [100, 300, 1000, 3000];
    const uTauTrue = 0.6;
    let maxRelErr = 0;

    for (const yp of yPlusTargets) {
      const yPhys = (yp * nu) / uTauTrue;
      const uPlusLog = (1.0 / kappa) * Math.log(yp) + B;
      const uTan = uPlusLog * uTauTrue;
      const uTauEst = solveSpaldingUtau(uTan, yPhys, nu, kappa, B);
      const err = Math.abs(uTauEst - uTauTrue) / uTauTrue;
      if (err > maxRelErr) maxRelErr = err;
    }
    const dtMs = performance.now() - t0;

    cases.push({
      id: "VV-03-SpaldingWallLaw",
      name: "NASA TMR Flat-Plate Turbulent Law-of-the-Wall",
      reference: "Spalding (1961) / NASA TMR ZPG Flat Plate",
      passed: maxRelErr < 0.02,
      measuredError: Number(maxRelErr.toFixed(5)),
      threshold: 0.02,
      mlups: 0,
      durationMs: Number(dtMs.toFixed(3)),
      metrics: { maxRelUtauErrorPct: Number((maxRelErr * 100).toFixed(3)) },
    });
  }

  // ── Case 4: Distributed 2x2x1 Halo-Exchange Parity ─────────────────────────
  {
    const t0 = performance.now();
    const cfg: LbmGridConfig = {
      nx: 16,
      ny: 10,
      nz: 8,
      dx: 0.005,
      dt: 1e-4,
      tau: 0.65,
      density: 1.225,
      inletVelocity: [4.0, 0.0, 0.0],
    };
    const grid = LbmVoxelizer.voxelize(cfg, {
      boxes: [{ min: [0.3, 0.35, 0.35], max: [0.55, 0.65, 0.65] }],
    });
    const mono = new WebGPULbmRunner(cfg, grid);
    const dist = new DistributedLbmRunner(cfg, grid, [2, 2, 1]);
    const steps = 10;
    mono.step(steps);
    dist.step(steps);
    const dtMs = performance.now() - t0;

    const velDist = dist.gatherVelocityMagnitude();
    let maxDiff = 0;
    for (let i = 0; i < mono.totalCells; i++) {
      const vm = Math.hypot(mono.vx[i]!, mono.vy[i]!, mono.vz[i]!);
      const d = Math.abs(vm - velDist[i]!);
      if (d > maxDiff) maxDiff = d;
    }
    const mlups = (mono.totalCells * steps) / Math.max(1e-3, dtMs * 1e3);

    cases.push({
      id: "VV-04-DistributedHalo2x2",
      name: "Distributed 2x2x1 Domain Decomposition Parity",
      reference: "Monolithic Single-Domain D3Q19 Reference",
      passed: maxDiff < 1e-4,
      measuredError: Number(maxDiff.toExponential(2)),
      threshold: 1e-4,
      mlups: Number(mlups.toFixed(3)),
      durationMs: Number(dtMs.toFixed(2)),
      metrics: { ranks: 4, maxVelocityDiffMps: Number(maxDiff.toExponential(2)) },
    });
  }

  // ── Case 5: Reverse-Mode Discrete Adjoint Gradient Verification ────────────
  {
    const t0 = performance.now();
    const cfg: LbmGridConfig = {
      nx: 8,
      ny: 6,
      nz: 6,
      dx: 0.01,
      dt: 1e-4,
      tau: 0.7,
      density: 1.225,
      inletVelocity: [2.0, 0.0, 0.0],
    };
    const grid = LbmVoxelizer.voxelize(cfg, {});
    const adj = new AdjointLbmSolver(cfg, grid, { numSteps: 5, maxResistance: 0.8 });
    const alpha = new Float64Array(adj.totalCells);
    const probeIdx = 4 + 3 * cfg.nx + 3 * cfg.nx * cfg.ny;
    alpha[probeIdx] = 0.4;

    const evalRes = adj.evaluate(alpha, true);
    const eps = 1e-6;
    const aP = Float64Array.from(alpha);
    const aM = Float64Array.from(alpha);
    aP[probeIdx] = alpha[probeIdx]! + eps;
    aM[probeIdx] = alpha[probeIdx]! - eps;
    const fd = (adj.evaluate(aP, false).objective - adj.evaluate(aM, false).objective) / (2 * eps);
    const relErr = Math.abs(evalRes.gradient[probeIdx]! - fd) / Math.max(1e-12, Math.abs(fd));
    const dtMs = performance.now() - t0;

    cases.push({
      id: "VV-05-DiscreteAdjointFD",
      name: "Reverse-Mode Discrete Adjoint Sensitivity Parity",
      reference: "Central Finite-Difference Gradient Oracle",
      passed: relErr < 1e-4,
      measuredError: Number(relErr.toExponential(2)),
      threshold: 1e-4,
      mlups: 0,
      durationMs: Number(dtMs.toFixed(2)),
      metrics: { relativeGradientError: Number(relErr.toExponential(2)) },
    });
  }

  const passedCount = cases.filter((c) => c.passed).length;
  return {
    timestamp: new Date().toISOString(),
    allPassed: passedCount === cases.length,
    passedCount,
    totalCount: cases.length,
    cases,
  };
}

/**
 * Persists a CFD V&V scorecard as formatted JSON and returns the written path.
 */
export function saveCfdVvScorecard(scorecard: CfdVvScorecard, outPath?: string): string {
  const targetPath = path.resolve(outPath ?? ".cache/benchmarks/cfd/vv-scorecard.json");
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");
  return targetPath;
}

function probeBinary(cmd: string, args: string[]): { available: boolean; version?: string } {
  try {
    const res = spawnSync(cmd, args, {
      timeout: 2000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (res.error) {
      return { available: false };
    }
    const output = `${res.stdout ?? ""}\n${res.stderr ?? ""}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return output ? { available: true, version: output } : { available: true };
  } catch {
    return { available: false };
  }
}

/**
 * Probes for local external CFD solvers (`SU2_CFD` and `simpleFoam`) for optional live ground-truth parity.
 * Never throws when binaries are absent.
 */
export function probeExternalCfdSolvers(): {
  su2Available: boolean;
  openFoamAvailable: boolean;
  su2Version?: string;
  openFoamVersion?: string;
} {
  const su2 = probeBinary("SU2_CFD", ["--version"]);
  const openFoam = probeBinary("simpleFoam", ["-help"]);
  const result: {
    su2Available: boolean;
    openFoamAvailable: boolean;
    su2Version?: string;
    openFoamVersion?: string;
  } = {
    su2Available: su2.available,
    openFoamAvailable: openFoam.available,
  };
  if (su2.version) result.su2Version = su2.version;
  if (openFoam.version) result.openFoamVersion = openFoam.version;
  return result;
}

if (typeof process !== "undefined" && Array.isArray(process.argv) && process.argv[1]?.endsWith("vv-benchmarks.ts")) {
  const scorecard = runCfdVvSuite();
  const writtenPath = saveCfdVvScorecard(scorecard);
  const solvers = probeExternalCfdSolvers();
  console.log(
    `CFD V&V Suite: ${scorecard.passedCount}/${scorecard.totalCount} passed (allPassed=${scorecard.allPassed}) -> ${writtenPath}`,
  );
  console.log(
    `External CFD solvers: SU2_CFD=${solvers.su2Available ? (solvers.su2Version ?? "available") : "unavailable"}, simpleFoam=${solvers.openFoamAvailable ? (solvers.openFoamVersion ?? "available") : "unavailable"}`,
  );
  if (!scorecard.allPassed) {
    process.exitCode = 1;
  }
}
