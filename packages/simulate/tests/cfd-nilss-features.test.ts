// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { FLOW_FEATURES_CUDA_FP64, FLOW_FEATURES_WGSL, extractFlowFeatures } from "../src/cfd/flow-features.js";
import { NilssAdjointSolver } from "../src/cfd/nilss-adjoint.js";

console.log("=== Testing WS-F: NILSS Chaotic Adjoint + Flow Features ===");

// ============================================================================
// 1. NILSS Chaotic Unsteady Adjoint on Lorenz-63
// ============================================================================
{
  const sigma = 10.0;
  const beta = 8.0 / 3.0;
  const rho0 = 28.0;
  const dt = 0.01;

  const lorenzRhs = (u: Float64Array, rho: number): Float64Array => {
    const x = u[0]!;
    const y = u[1]!;
    const z = u[2]!;
    return Float64Array.from([sigma * (y - x), x * (rho - z) - y, x * y - beta * z]);
  };

  // Classic 4th-order Runge-Kutta step map for Lorenz-63
  const lorenzStep = (u: Float64Array, rho: number): Float64Array => {
    const k1 = lorenzRhs(u, rho);
    const u2 = Float64Array.from([u[0]! + 0.5 * dt * k1[0]!, u[1]! + 0.5 * dt * k1[1]!, u[2]! + 0.5 * dt * k1[2]!]);
    const k2 = lorenzRhs(u2, rho);
    const u3 = Float64Array.from([u[0]! + 0.5 * dt * k2[0]!, u[1]! + 0.5 * dt * k2[1]!, u[2]! + 0.5 * dt * k2[2]!]);
    const k3 = lorenzRhs(u3, rho);
    const u4 = Float64Array.from([u[0]! + dt * k3[0]!, u[1]! + dt * k3[1]!, u[2]! + dt * k3[2]!]);
    const k4 = lorenzRhs(u4, rho);
    return Float64Array.from([
      u[0]! + (dt / 6) * (k1[0]! + 2 * k2[0]! + 2 * k3[0]! + k4[0]!),
      u[1]! + (dt / 6) * (k1[1]! + 2 * k2[1]! + 2 * k3[1]! + k4[1]!),
      u[2]! + (dt / 6) * (k1[2]! + 2 * k2[2]! + 2 * k3[2]! + k4[2]!),
    ]);
  };

  const solver = new NilssAdjointSolver(
    {
      step: lorenzStep,
      objective: (u) => u[2]!, // J = z, analytical d<z>/drho ~ 0.96 - 1.02
      flowDirection: lorenzRhs,
    },
    {
      numSegments: 150,
      stepsPerSegment: 20, // Delta T = 0.2, total T = 30.0
      dt,
      numHomogeneous: 1, // Lorenz-63 has 1 positive Lyapunov exponent (neutral mode projected out)
      spinupSteps: 1000,
      projectOrthogonalToFlow: true,
      seed: 12345,
    },
  );

  const initialState = Float64Array.from([1.0, 1.0, 20.0]);
  const nilssRes = solver.solve(initialState, rho0);
  const unshadowedRes = solver.solveUnshadowed(initialState, rho0);

  console.log(
    `[NILSS Lorenz-63] d<z>/drho = ${nilssRes.sensitivity.toFixed(4)} (expected ~0.96-1.02), ` +
      `<z> = ${nilssRes.meanObjective.toFixed(3)}, lambda_1 = ${nilssRes.lyapunovExponents[0]!.toFixed(4)}, ` +
      `max||a|| = ${nilssRes.maxWeightNorm.toFixed(3)}, contRes = ${nilssRes.continuityResidual.toExponential(2)}`,
  );
  console.log(
    `[Unshadowed Lorenz-63] d<z>/drho = ${unshadowedRes.sensitivity.toExponential(3)}, ` +
      `max||v|| = ${unshadowedRes.maxTangentNorm.toExponential(3)}`,
  );

  assert.ok(
    Number.isFinite(nilssRes.sensitivity) && nilssRes.sensitivity >= 0.7 && nilssRes.sensitivity <= 1.3,
    `Expected NILSS sensitivity in [0.7, 1.3], got ${nilssRes.sensitivity}`,
  );
  assert.ok(
    nilssRes.lyapunovExponents[0]! > 0.6 && nilssRes.lyapunovExponents[0]! < 1.2,
    `Expected Lorenz-63 leading Lyapunov exponent near 0.906, got ${nilssRes.lyapunovExponents[0]}`,
  );
  assert.ok(
    nilssRes.continuityResidual < 1e-8,
    `Expected tight segment continuity residual < 1e-8, got ${nilssRes.continuityResidual}`,
  );
  assert.ok(
    Math.abs(unshadowedRes.sensitivity) > 1e6,
    `Expected unshadowed tangent sensitivity to explode > 1e6, got ${unshadowedRes.sensitivity}`,
  );
  assert.ok(
    unshadowedRes.maxTangentNorm > 1e6,
    `Expected unshadowed tangent norm to explode > 1e6, got ${unshadowedRes.maxTangentNorm}`,
  );
  console.log("  [PASS] NILSS Lorenz-63 chaotic sensitivity & Lyapunov exponent verified.");
}

// ============================================================================
// 2. 3D Flow Feature Extraction (Lamb-Oseen Vortex + Compression Shock + Shear)
// ============================================================================
let lambOseenGrid: {
  nx: number;
  ny: number;
  nz: number;
  dx: number;
  vx: Float64Array;
  vy: Float64Array;
  vz: Float64Array;
  features: ReturnType<typeof extractFlowFeatures>;
};

{
  // 2a. 3D Lamb-Oseen vortex along Z axis
  const nx = 17;
  const ny = 17;
  const nz = 5;
  const dx = 0.1;
  const n = nx * ny * nz;
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const vz = new Float64Array(n);

  const cx = 0.5 * (nx - 1) * dx;
  const cy = 0.5 * (ny - 1) * dx;
  const gamma = 2.0 * Math.PI;
  const rc = 0.35;

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = (z * ny + y) * nx + x;
        const rx = x * dx - cx;
        const ry = y * dx - cy;
        const r2 = rx * rx + ry * ry;
        if (r2 > 1e-12) {
          const factor = (gamma / (2 * Math.PI * r2)) * (1 - Math.exp(-r2 / (rc * rc)));
          vx[idx] = -factor * ry;
          vy[idx] = factor * rx;
        }
      }
    }
  }

  const features = extractFlowFeatures(nx, ny, nz, dx, vx, vy, vz);
  lambOseenGrid = { nx, ny, nz, dx, vx, vy, vz, features };

  const coreIdx = (Math.floor(nz / 2) * ny + Math.floor(ny / 2)) * nx + Math.floor(nx / 2);
  const qCore = features.qCriterion[coreIdx]!;
  const l2Core = features.lambda2[coreIdx]!;
  const vortCore = features.vorticityMagnitude[coreIdx]!;
  const ducrosCore = features.ducrosSensor[coreIdx]!;

  console.log(
    `[Lamb-Oseen Vortex Core] Q = ${qCore.toFixed(4)} (> 0), lambda_2 = ${l2Core.toFixed(4)} (< 0), ` +
      `|omega| = ${vortCore.toFixed(4)}, Ducros = ${ducrosCore.toExponential(2)}`,
  );

  assert.ok(qCore > 1.0, `Expected positive Q-criterion at Lamb-Oseen vortex core, got ${qCore}`);
  assert.ok(l2Core < -1.0, `Expected negative lambda_2 at Lamb-Oseen vortex core, got ${l2Core}`);
  assert.ok(vortCore > 1.0, `Expected strong vorticity at vortex core, got ${vortCore}`);
  assert.ok(ducrosCore < 0.05, `Expected Ducros sensor < 0.05 in incompressible vortex, got ${ducrosCore}`);

  // 2b. 1D Compression Shock (smooth tanh profile along X)
  const snx = 31;
  const sny = 5;
  const snz = 5;
  const sdx = 0.05;
  const sn = snx * sny * snz;
  const svx = new Float64Array(sn);
  const svy = new Float64Array(sn);
  const svz = new Float64Array(sn);
  const srho = new Float64Array(sn);
  const x0 = 0.5 * (snx - 1) * sdx;
  const delta = 0.08;

  for (let z = 0; z < snz; z++) {
    for (let y = 0; y < sny; y++) {
      for (let x = 0; x < snx; x++) {
        const idx = (z * sny + y) * snx + x;
        const xi = (x * sdx - x0) / delta;
        const t = Math.tanh(xi);
        svx[idx] = 2.0 - 0.75 * (1 + t); // decelerates from 2.0 -> 0.5 across shock
        srho[idx] = 1.0 + 1.5 * (1 + t); // compresses from 1.0 -> 4.0 across shock
      }
    }
  }

  const shockFeat = extractFlowFeatures(snx, sny, snz, sdx, svx, svy, svz, srho);
  const shockCenterIdx = (2 * sny + 2) * snx + Math.floor(snx / 2);
  const ducrosShock = shockFeat.ducrosSensor[shockCenterIdx]!;
  const divShock = shockFeat.divergence[shockCenterIdx]!;
  const gradRhoShock = shockFeat.densityGradientMagnitude![shockCenterIdx]!;

  console.log(
    `[1D Compression Shock] Ducros = ${ducrosShock.toFixed(6)} (> 0.95), ` +
      `div(u) = ${divShock.toFixed(4)} (< 0), |grad(rho)| = ${gradRhoShock.toFixed(4)}`,
  );

  assert.ok(ducrosShock > 0.95, `Expected Ducros sensor > 0.95 at shock, got ${ducrosShock}`);
  assert.ok(divShock < -1.0, `Expected negative divergence at compression shock, got ${divShock}`);
  assert.ok(gradRhoShock > 1.0, `Expected strong density gradient at shock, got ${gradRhoShock}`);

  // 2c. Pure Shear Flow (vx = gamma * y)
  const pnx = 7;
  const pny = 7;
  const pnz = 3;
  const pn = pnx * pny * pnz;
  const pvx = new Float64Array(pn);
  const pvy = new Float64Array(pn);
  const pvz = new Float64Array(pn);
  const shearRate = 4.0;
  for (let z = 0; z < pnz; z++) {
    for (let y = 0; y < pny; y++) {
      for (let x = 0; x < pnx; x++) {
        pvx[(z * pny + y) * pnx + x] = shearRate * (y * dx);
      }
    }
  }
  const shearFeat = extractFlowFeatures(pnx, pny, pnz, dx, pvx, pvy, pvz);
  const shearCenterIdx = (1 * pny + 3) * pnx + 3;
  const ducrosShear = shearFeat.ducrosSensor[shearCenterIdx]!;
  console.log(
    `[Pure Shear Flow] Ducros = ${ducrosShear.toExponential(2)} (< 0.05), ` +
      `|omega| = ${shearFeat.vorticityMagnitude[shearCenterIdx]!.toFixed(4)} (expected ${shearRate})`,
  );
  assert.ok(ducrosShear < 0.05, `Expected Ducros sensor < 0.05 in pure shear, got ${ducrosShear}`);
  assert.ok(
    Math.abs(shearFeat.vorticityMagnitude[shearCenterIdx]! - shearRate) < 1e-10,
    `Expected vorticity magnitude = ${shearRate}, got ${shearFeat.vorticityMagnitude[shearCenterIdx]}`,
  );

  // 2d. Verify WGSL and CUDA FP64 kernel sources
  assert.ok(
    FLOW_FEATURES_WGSL.includes("@compute") &&
      FLOW_FEATURES_WGSL.includes("q_criterion") &&
      FLOW_FEATURES_WGSL.includes("ducros_sensor"),
    "FLOW_FEATURES_WGSL must contain compute entry point, Q-criterion, and Ducros sensor",
  );
  assert.ok(
    FLOW_FEATURES_CUDA_FP64.includes("__global__") &&
      FLOW_FEATURES_CUDA_FP64.includes("double") &&
      FLOW_FEATURES_CUDA_FP64.includes("sym3x3_lambda2_fp64"),
    "FLOW_FEATURES_CUDA_FP64 must contain FP64 CUDA global kernel and lambda_2 helper",
  );
  console.log("  [PASS] 3D flow feature extraction & GPU kernel sources verified.");
}

console.log("All WS-F tests (NILSS Adjoint, 3D Flow Features) passed!");
