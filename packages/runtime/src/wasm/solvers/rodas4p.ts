// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RODAS4P: 6-Stage 4th-Order L-Stable Rosenbrock-W Stiff DAE Solver in Native WebAssembly Linear Memory.
 *
 * Implements Steinebach's 4th-order Rosenbrock formulation with single LU factorization per step,
 * zero heap allocations, and 4th-order continuous dense output polynomial interpolation.
 */

import { DaeBuilder } from "../dae/builder";
import { UnmanagedFloat64Array, DenseMatrixView } from "../core/array";
import { luFactor, luSolve } from "./matrix";
import { computeDerivatives, solveAlgebraicConstraints } from "./integrators";

export const RODAS4P_GAMMA: f64 = 0.25;

const C2: f64 = 0.75;
const C3: f64 = 0.21;
const C4: f64 = 0.63;

const A21: f64 = 3.0;
const A31: f64 = 1.831036793486759;
const A32: f64 = 0.4955183967433795;
const A41: f64 = 2.304376582692669;
const A42: f64 = -0.05249275245743001;
const A43: f64 = -1.176798761832782;
const A51: f64 = -7.170454962423024;
const A52: f64 = -4.741636671481785;
const A53: f64 = -16.31002631330971;
const A54: f64 = -1.062004044111401;

const C21: f64 = -12.0;
const C31: f64 = -8.791795173947035;
const C32: f64 = -2.207865586973518;
const C41: f64 = 10.81793056857153;
const C42: f64 = 6.780270611428266;
const C43: f64 = 19.5348594464241;
const C51: f64 = 34.19095006749676;
const C52: f64 = 15.49671153725963;
const C53: f64 = 54.7476087596413;
const C54: f64 = 14.16005392148534;
const C61: f64 = 34.62605830930532;
const C62: f64 = 15.30084976114473;
const C63: f64 = 56.99955578662667;
const C64: f64 = 18.40807009793095;
const C65: f64 = -5.714285714285717;

const D1: f64 = 0.25;
const D2: f64 = -0.5;
const D3: f64 = -0.023504;
const D4: f64 = -0.0362;

// Dense output polynomial constants
const D21: f64 = 25.09876703708589;
const D22: f64 = 11.62013104361867;
const D23: f64 = 28.49148307714626;
const D24: f64 = -5.664021568594133;
const D25: f64 = 0.0;
const D31: f64 = 1.638054557396973;
const D32: f64 = -0.7373619806678748;
const D33: f64 = 8.47791821923899;
const D34: f64 = 15.9925314877952;
const D35: f64 = -1.882352941176471;

/**
 * Advances the DAE system by one time step dt using the 6-stage Rodas-4P Rosenbrock method.
 */
export function stepRodas4P(
  dae: DaeBuilder,
  varValuesPtr: u32,
  scratchPtr: u32,
  dt: f64,
  atol: f64 = 1e-6,
  rtol: f64 = 1e-6
): bool {
  let numVars = dae.varCount;
  if (numVars == 0) return true;

  let k1Ptr = scratchPtr;
  let k2Ptr = k1Ptr + numVars * 8;
  let k3Ptr = k2Ptr + numVars * 8;
  let k4Ptr = k3Ptr + numVars * 8;
  let k5Ptr = k4Ptr + numVars * 8;
  let k6Ptr = k5Ptr + numVars * 8;
  let f0Ptr = k6Ptr + numVars * 8;
  let fStagePtr = f0Ptr + numVars * 8;
  let yStagePtr = fStagePtr + numVars * 8;
  let yNewPtr = yStagePtr + numVars * 8;
  let rhsPtr = yNewPtr + numVars * 8;
  let wMatPtr = rhsPtr + numVars * 8;
  let pivPtr = wMatPtr + numVars * numVars * 8;
  let pivSize = (numVars * 4 + 7) & ~7;
  let scalePtr = pivPtr + pivSize;
  let luScratchPtr = scalePtr + numVars * 8;

  let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr as usize);
  let k1 = changetype<UnmanagedFloat64Array>(k1Ptr as usize);
  let k2 = changetype<UnmanagedFloat64Array>(k2Ptr as usize);
  let k3 = changetype<UnmanagedFloat64Array>(k3Ptr as usize);
  let k4 = changetype<UnmanagedFloat64Array>(k4Ptr as usize);
  let k5 = changetype<UnmanagedFloat64Array>(k5Ptr as usize);
  let k6 = changetype<UnmanagedFloat64Array>(k6Ptr as usize);
  let f0 = changetype<UnmanagedFloat64Array>(f0Ptr as usize);
  let fStage = changetype<UnmanagedFloat64Array>(fStagePtr as usize);
  let yStage = changetype<UnmanagedFloat64Array>(yStagePtr as usize);
  let yNew = changetype<UnmanagedFloat64Array>(yNewPtr as usize);
  let rhs = changetype<UnmanagedFloat64Array>(rhsPtr as usize);
  let wMat = DenseMatrixView.at(wMatPtr as usize, numVars, numVars);

  // 1. Initial f0 = f(t, y0)
  computeDerivatives(dae, varValuesPtr, f0Ptr);

  // 2. Numerical Jacobian & W = fac * I - J with fac = 1 / (gamma * dt)
  let fac: f64 = 1.0 / (RODAS4P_GAMMA * dt);
  let invH: f64 = 1.0 / dt;
  let eps: f64 = 1e-8;

  for (let j: u32 = 0; j < numVars; j++) {
    let yOrig = varValues[j];
    varValues[j] = yOrig + eps;
    computeDerivatives(dae, varValuesPtr, fStagePtr);
    varValues[j] = yOrig; // restore

    for (let i: u32 = 0; i < numVars; i++) {
      let J_ij = (fStage[i] - f0[i]) / eps;
      let identity: f64 = i == j ? fac : 0.0;
      wMat.set(i, j, identity - J_ij);
    }
  }

  // 3. LU factorize W
  if (!luFactor(wMatPtr, pivPtr, scalePtr, numVars)) {
    return false;
  }

  // ── Stage 1: W * k1 = f0 ──
  for (let i: u32 = 0; i < numVars; i++) {
    k1[i] = f0[i];
  }
  luSolve(wMatPtr, pivPtr, scalePtr, k1Ptr, luScratchPtr, numVars);

  // ── Stage 2: y_stage = y0 + A21 * k1 ──
  for (let i: u32 = 0; i < numVars; i++) {
    yStage[i] = varValues[i] + A21 * k1[i];
  }
  computeDerivatives(dae, yStagePtr, fStagePtr);

  // rhs2 = fStage + C21 * invH * k1
  for (let i: u32 = 0; i < numVars; i++) {
    k2[i] = fStage[i] + C21 * invH * k1[i];
  }
  luSolve(wMatPtr, pivPtr, scalePtr, k2Ptr, luScratchPtr, numVars);

  // ── Stage 3: y_stage = y0 + A31 * k1 + A32 * k2 ──
  for (let i: u32 = 0; i < numVars; i++) {
    yStage[i] = varValues[i] + A31 * k1[i] + A32 * k2[i];
  }
  computeDerivatives(dae, yStagePtr, fStagePtr);

  // rhs3 = fStage + invH * (C31 * k1 + C32 * k2)
  for (let i: u32 = 0; i < numVars; i++) {
    k3[i] = fStage[i] + invH * (C31 * k1[i] + C32 * k2[i]);
  }
  luSolve(wMatPtr, pivPtr, scalePtr, k3Ptr, luScratchPtr, numVars);

  // ── Stage 4: y_stage = y0 + A41 * k1 + A42 * k2 + A43 * k3 ──
  for (let i: u32 = 0; i < numVars; i++) {
    yStage[i] = varValues[i] + A41 * k1[i] + A42 * k2[i] + A43 * k3[i];
  }
  computeDerivatives(dae, yStagePtr, fStagePtr);

  // rhs4 = fStage + invH * (C41 * k1 + C42 * k2 + C43 * k3)
  for (let i: u32 = 0; i < numVars; i++) {
    k4[i] = fStage[i] + invH * (C41 * k1[i] + C42 * k2[i] + C43 * k3[i]);
  }
  luSolve(wMatPtr, pivPtr, scalePtr, k4Ptr, luScratchPtr, numVars);

  // ── Stage 5: y5 = y0 + A51*k1 + A52*k2 + A53*k3 + A54*k4 ──
  for (let i: u32 = 0; i < numVars; i++) {
    yStage[i] = varValues[i] + A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i];
  }
  computeDerivatives(dae, yStagePtr, fStagePtr);

  // rhs5 = fStage + invH * (C51 * k1 + C52 * k2 + C53 * k3 + C54 * k4)
  for (let i: u32 = 0; i < numVars; i++) {
    k5[i] = fStage[i] + invH * (C51 * k1[i] + C52 * k2[i] + C53 * k3[i] + C54 * k4[i]);
  }
  luSolve(wMatPtr, pivPtr, scalePtr, k5Ptr, luScratchPtr, numVars);

  // y_embedded = yStage + k5 (3rd-order embedded solution)
  for (let i: u32 = 0; i < numVars; i++) {
    yStage[i] = yStage[i] + k5[i];
  }
  computeDerivatives(dae, yStagePtr, fStagePtr);

  // ── Stage 6: Error estimation stage ──
  // rhs6 = fStage + invH * (C61*k1 + C62*k2 + C63*k3 + C64*k4 + C65*k5)
  for (let i: u32 = 0; i < numVars; i++) {
    k6[i] = fStage[i] + invH * (C61 * k1[i] + C62 * k2[i] + C63 * k3[i] + C64 * k4[i] + C65 * k5[i]);
  }
  luSolve(wMatPtr, pivPtr, scalePtr, k6Ptr, luScratchPtr, numVars);

  // 4th-Order solution: yNew = y_embedded + k6
  for (let i: u32 = 0; i < numVars; i++) {
    yNew[i] = yStage[i] + k6[i];
  }

  // Error estimate is directly k6
  let maxErrNorm: f64 = 0.0;
  for (let i: u32 = 0; i < numVars; i++) {
    let y0 = varValues[i];
    let y1 = yNew[i];
    let absY0 = Math.abs(y0);
    let absY1 = Math.abs(y1);
    let maxY = absY0 > absY1 ? absY0 : absY1;
    let sc = atol + rtol * maxY;
    if (sc < 1e-15) sc = 1e-15;
    let scaledErr = Math.abs(k6[i]) / sc;
    if (scaledErr > maxErrNorm) maxErrNorm = scaledErr;
  }

  if (maxErrNorm <= 1.0) {
    for (let i: u32 = 0; i < numVars; i++) {
      varValues[i] = yNew[i];
    }
    solveAlgebraicConstraints(dae, varValuesPtr);
    return true;
  }

  return false;
}

/**
 * 4th-order continuous polynomial dense output interpolation.
 */
export function interpolateRodas4P(
  tInterp: f64,
  t0: f64,
  dt: f64,
  y0Ptr: u32,
  kStagesPtr: u32,
  outPtr: u32,
  numVars: u32
): void {
  let theta: f64 = (tInterp - t0) / dt;
  let theta2: f64 = theta * theta;
  let theta3: f64 = theta2 * theta;

  let b1 = theta + theta2 * (-D21 - D31) + theta3 * D31;
  let b2 = theta2 * (-D22 - D32) + theta3 * D32;
  let b3 = theta2 * (-D23 - D33) + theta3 * D33;
  let b4 = theta2 * (-D24 - D34) + theta3 * D34;
  let b5 = theta2 * (-D25 - D35) + theta3 * D35;

  let y0 = changetype<UnmanagedFloat64Array>(y0Ptr as usize);
  let k1 = changetype<UnmanagedFloat64Array>(kStagesPtr as usize);
  let k2 = changetype<UnmanagedFloat64Array>((kStagesPtr + numVars * 8) as usize);
  let k3 = changetype<UnmanagedFloat64Array>((kStagesPtr + numVars * 16) as usize);
  let k4 = changetype<UnmanagedFloat64Array>((kStagesPtr + numVars * 24) as usize);
  let k5 = changetype<UnmanagedFloat64Array>((kStagesPtr + numVars * 32) as usize);
  let out = changetype<UnmanagedFloat64Array>(outPtr as usize);

  for (let i: u32 = 0; i < numVars; i++) {
    out[i] = y0[i] + b1 * k1[i] + b2 * k2[i] + b3 * k3[i] + b4 * k4[i] + b5 * k5[i];
  }
}

// ── WebAssembly FFI Exports ──

export function sim_stepRodas4P(
  daePtr: u32,
  varValuesPtr: u32,
  scratchPtr: u32,
  dt: f64,
  atol: f64,
  rtol: f64
): bool {
  return stepRodas4P(changetype<DaeBuilder>(daePtr), varValuesPtr, scratchPtr, dt, atol, rtol);
}

export function sim_interpolateRodas4P(
  tInterp: f64,
  t0: f64,
  dt: f64,
  y0Ptr: u32,
  kStagesPtr: u32,
  outPtr: u32,
  numVars: u32
): void {
  interpolateRodas4P(tInterp, t0, dt, y0Ptr, kStagesPtr, outPtr, numVars);
}
