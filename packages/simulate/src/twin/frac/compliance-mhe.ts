// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/twin/frac — Online Fracture Compliance MHE Estimator.
 *
 * Implements:
 * 1. Moving Horizon Estimation (MHE) over rolling telemetry windows [t - W, t].
 * 2. Simultaneous bound-constrained L-BFGS-B estimation of:
 *    - Dynamic fracture compliance C_f (m³/Pa)
 *    - Minimum in-situ closure stress sigma_min (Pa)
 *    - Near-wellbore tortuosity coefficient K_tort (Pa / (m³/s)²)
 * 3. Regularization against prior formation geomechanics.
 */

import { lbfgsbSolve, type LbfgsbOptions, type LbfgsbResult } from "../../optimizer/solvers/lbfgsb.js";
import { calculateCarterLeakoffRate } from "./fracture-compliance.js";

export interface MheTelemetryWindowSample {
  timeSeconds: number;
  bhtpPascals: number;
  slurryRateM3PerSec: number;
  perfFrictionPascals: number;
}

export interface FractureMheOptions {
  /** Prior estimate of minimum horizontal closure stress sigma_min (Pa). */
  priorClosureStressPascals: number;
  /** Prior estimate of fracture compliance C_f (m³/Pa, default ~ 1e-4). */
  priorCompliance?: number | undefined;
  /** Prior estimate of tortuosity coefficient K_tort (Pa / (m³/s)², default ~ 2.0e7). */
  priorTortuosity?: number | undefined;
  /** Carter leak-off coefficient C_L (m/s^0.5, default: 2.5e-4). */
  carterCoeff?: number | undefined;
  /** Estimated fracture area (m², default: 2000.0). */
  fractureAreaM2?: number | undefined;
  /** Regularization penalty lambda for deviation from priors (default: 1e-3). */
  regularizationLambda?: number | undefined;
  /** L-BFGS-B optimizer options override. */
  optimizerOptions?: LbfgsbOptions | undefined;
}

export interface FractureMheResult {
  converged: boolean;
  iterations: number;
  calibratedComplianceM3PerPa: number;
  calibratedClosureStressPa: number;
  calibratedTortuosity: number;
  residualRmsPascals: number;
  cost: number;
  lbfgsResult: LbfgsbResult;
}

/**
 * Runs Moving Horizon Estimation over a rolling window of telemetry samples.
 *
 * State vector to calibrate:
 *   x[0] = ln(C_f)            (log compliance to guarantee positivity)
 *   x[1] = sigma_min / 1e6    (closure stress in MPa)
 *   x[2] = K_tort / 1e6       (tortuosity in MPa/(m³/s)²)
 */
export function estimateFractureParametersMhe(
  windowSamples: MheTelemetryWindowSample[],
  options: FractureMheOptions,
): FractureMheResult {
  const k = windowSamples.length;
  if (k < 3) {
    const defaultCf = options.priorCompliance ?? 1.0e-4;
    return {
      converged: false,
      iterations: 0,
      calibratedComplianceM3PerPa: defaultCf,
      calibratedClosureStressPa: options.priorClosureStressPascals,
      calibratedTortuosity: options.priorTortuosity ?? 2.0e7,
      residualRmsPascals: 0.0,
      cost: 0.0,
      lbfgsResult: {
        x: new Float64Array([Math.log(defaultCf), options.priorClosureStressPascals / 1e6, 20.0]),
        cost: 0.0,
        grad: new Float64Array(3),
        iterations: 0,
        converged: false,
        costHistory: [],
        message: "Insufficient window samples (< 3)",
      },
    };
  }

  const cl = options.carterCoeff ?? 2.5e-4;
  const area = options.fractureAreaM2 ?? 2000.0;
  const lambda = options.regularizationLambda ?? 1.0e-3;

  // Priors in normalized optimization variables
  const priorLogCf = Math.log(Math.max(1e-9, options.priorCompliance ?? 1.0e-4));
  const priorSigmaMpa = options.priorClosureStressPascals / 1.0e6;
  const priorTortMpa = (options.priorTortuosity ?? 2.0e7) / 1.0e6;

  const x0 = new Float64Array([priorLogCf, priorSigmaMpa, priorTortMpa]);

  // Parameter bounds:
  // C_f: 1e-8 to 1e-1 m³/Pa  -->  ln(C_f): [-18.42, -2.30]
  // sigma_min: 10 MPa to 150 MPa
  // K_tort: 0 to 200 MPa / (m³/s)²
  const lb = new Float64Array([-18.42, 10.0, 0.0]);
  const ub = new Float64Array([-2.3, 150.0, 200.0]);

  // Objective function & finite difference gradient
  const evalCostAndGrad = (x: Float64Array): { cost: number; grad: Float64Array } => {
    const cf = Math.exp(x[0]!);
    const sigmaPa = x[1]! * 1.0e6;
    const tort = x[2]! * 1.0e6;

    // Simulate forward across window to compute predicted BHTP
    let sumSqErr = 0.0;
    let netPressure = 1e5; // Initial seed net pressure ~0.1 MPa

    for (let i = 0; i < k; i++) {
      const sample = windowSamples[i]!;
      const dt = i === 0 ? 1.0 : Math.max(0.1, sample.timeSeconds - windowSamples[i - 1]!.timeSeconds);

      const qIn = sample.slurryRateM3PerSec;
      const qLeak = calculateCarterLeakoffRate(cl, area, sample.timeSeconds);
      const netFlow = Math.max(0.0, qIn - qLeak);

      // dP_net/dt = netFlow / C_f
      netPressure = Math.max(1e4, netPressure + (netFlow / cf) * dt);

      // Predicted BHTP = sigma_min + dP_perf + dP_tort + P_net
      const dPTort = tort * qIn * qIn;
      const bhtpModel = sigmaPa + sample.perfFrictionPascals + dPTort + netPressure;

      const err = (sample.bhtpPascals - bhtpModel) / 1.0e6; // in MPa
      sumSqErr += err * err;
    }

    // Regularization penalties against priors
    const regCf = lambda * Math.pow(x[0]! - priorLogCf, 2.0);
    const regSigma = lambda * Math.pow(x[1]! - priorSigmaMpa, 2.0);
    const regTort = lambda * Math.pow(x[2]! - priorTortMpa, 2.0);

    const totalCost = 0.5 * (sumSqErr / k) + regCf + regSigma + regTort;

    // Finite difference gradient for 3 parameters
    const eps = 1e-5;
    const grad = new Float64Array(3);
    for (let p = 0; p < 3; p++) {
      const xPlus = new Float64Array(x);
      xPlus[p] = xPlus[p]! + eps;

      const cfP = Math.exp(xPlus[0]!);
      const sigmaP = xPlus[1]! * 1.0e6;
      const tortP = xPlus[2]! * 1.0e6;

      let sumSqErrP = 0.0;
      let netPressureP = 1e5;
      for (let i = 0; i < k; i++) {
        const sample = windowSamples[i]!;
        const dt = i === 0 ? 1.0 : Math.max(0.1, sample.timeSeconds - windowSamples[i - 1]!.timeSeconds);
        const qIn = sample.slurryRateM3PerSec;
        const qLeak = calculateCarterLeakoffRate(cl, area, sample.timeSeconds);
        const netFlow = Math.max(0.0, qIn - qLeak);
        netPressureP = Math.max(1e4, netPressureP + (netFlow / cfP) * dt);
        const dPTort = tortP * qIn * qIn;
        const bhtpModel = sigmaP + sample.perfFrictionPascals + dPTort + netPressureP;
        const err = (sample.bhtpPascals - bhtpModel) / 1.0e6;
        sumSqErrP += err * err;
      }
      const costP =
        0.5 * (sumSqErrP / k) +
        lambda * Math.pow(xPlus[0]! - priorLogCf, 2.0) +
        lambda * Math.pow(xPlus[1]! - priorSigmaMpa, 2.0) +
        lambda * Math.pow(xPlus[2]! - priorTortMpa, 2.0);

      grad[p] = (costP - totalCost) / eps;
    }

    return { cost: totalCost, grad };
  };

  const lbfgsOptions: LbfgsbOptions = {
    maxIterations: options.optimizerOptions?.maxIterations ?? 40,
    tolerance: options.optimizerOptions?.tolerance ?? 1e-4,
    m: 5,
  };

  const optRes = lbfgsbSolve(x0, evalCostAndGrad, lb, ub, lbfgsOptions);

  const calibratedCf = Math.exp(optRes.x[0]!);
  const calibratedSigma = optRes.x[1]! * 1.0e6;
  const calibratedTort = optRes.x[2]! * 1.0e6;

  // Compute final RMS error in Pascals
  const rmsPa = Math.sqrt(2.0 * optRes.cost) * 1.0e6;

  return {
    converged: optRes.converged,
    iterations: optRes.iterations,
    calibratedComplianceM3PerPa: calibratedCf,
    calibratedClosureStressPa: calibratedSigma,
    calibratedTortuosity: calibratedTort,
    residualRmsPascals: rmsPa,
    cost: optRes.cost,
    lbfgsResult: optRes,
  };
}
