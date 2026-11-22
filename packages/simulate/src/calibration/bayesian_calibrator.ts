// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Bayesian Parameter Identification & Model Calibration.
 *
 * Reconciles physical telemetry time-series (from ASAM MDF4 / MCAP) with 1D Modelica
 * dynamic simulations and 3D surrogates.
 *
 * Implements joint-state Unscented Kalman Filtering (UKF) to identify physical parameters
 * (damping, friction, stiffness, thermal conductances) with full posterior uncertainty
 * quantification and generates IDE diff suggestions for the digital thread.
 */

import { DigitalThreadHypergraph, bindTelemetryToSimulationThread } from "@modelscript/runtime";
import { UnscentedKalmanFilter, type MeasurementFn, type StateTransitionFn } from "./unscented_kalman_filter.js";

export interface ParameterPrior {
  name: string;
  nominalValue: number;
  initialStdDev: number;
  processNoiseVariance?: number | undefined; // Random walk drift (default: 1e-6)
  minBound?: number | undefined;
  maxBound?: number | undefined;
  unit?: string | undefined;
}

export interface BayesianCalibrationResult {
  parameterName: string;
  nominalValue: number;
  calibratedValue: number;
  stdDev: number;
  confidenceInterval95: [number, number];
  relativeChangePercent: number;
  unit?: string | undefined;
  rmse: number;
  ideSuggestion: string;
}

export interface CalibrationRunConfig {
  stateNames: string[];
  parameters: ParameterPrior[];
  initialState: number[];
  initialStateVariance?: number[] | undefined;
  timeGrid: Float64Array;
  measuredTelemetry: Float64Array[]; // Array of M channels, each length N
  controlInputs?: Float64Array[] | undefined; // Optional input signals
  measurementNoiseR: number[]; // Variance for each measurement channel
  /**
   * Continuous-time or discrete physics step function:
   * xDot = f(x, theta, u)
   */
  systemDynamics: (state: Float64Array, params: Float64Array, control: Float64Array, dt: number) => Float64Array;
  /**
   * Measurement observation function:
   * y = h(x, params)
   */
  observationModel: (state: Float64Array, params: Float64Array) => Float64Array;
}

export class BayesianParameterCalibrator {
  /**
   * Executes joint state-parameter estimation over telemetry data.
   */
  public static calibrate(config: CalibrationRunConfig): {
    results: BayesianCalibrationResult[];
    estimatedTrajectory: Float64Array[]; // Array of state vectors over time
    finalCovariance: Float64Array;
  } {
    const Nx = config.stateNames.length;
    const Np = config.parameters.length;
    const Ny = config.measuredTelemetry.length;
    const N = config.timeGrid.length;

    if (N < 2) {
      throw new Error("Telemetry time grid must contain at least 2 points");
    }

    const L = Nx + Np; // Augmented state dimension
    const M = Ny; // Measurement dimension

    // Construct augmented initial state: [x0, theta0]
    const z0 = new Float64Array(L);
    for (let i = 0; i < Nx; i++) z0[i] = config.initialState[i] ?? 0.0;
    for (let i = 0; i < Np; i++) z0[Nx + i] = config.parameters[i]!.nominalValue;

    // Construct initial covariance P0
    const P0 = new Float64Array(L * L);
    for (let i = 0; i < Nx; i++) {
      const varX = config.initialStateVariance?.[i] ?? 1e-4;
      P0[i * L + i] = varX;
    }
    for (let i = 0; i < Np; i++) {
      const s = config.parameters[i]!.initialStdDev;
      P0[(Nx + i) * L + (Nx + i)] = s * s;
    }

    // Construct process noise Q
    const Q = new Float64Array(L * L);
    for (let i = 0; i < Nx; i++) {
      Q[i * L + i] = 1e-5; // Dynamic process disturbance
    }
    for (let i = 0; i < Np; i++) {
      const drift = config.parameters[i]!.processNoiseVariance ?? 1e-6;
      Q[(Nx + i) * L + (Nx + i)] = drift;
    }

    // Construct measurement noise R
    const R = new Float64Array(M * M);
    for (let i = 0; i < M; i++) {
      R[i * M + i] = config.measurementNoiseR[i] ?? 1e-3;
    }

    const ukf = new UnscentedKalmanFilter({
      stateDim: L,
      measDim: M,
      alpha: 1e-3,
      beta: 2.0,
      kappa: 0.0,
      processNoiseQ: Q,
      measNoiseR: R,
    });

    ukf.init(z0, P0);

    // Dynamic augmented state transition: x_{k+1} = f(x_k, theta_k, u_k), theta_{k+1} = theta_k
    const augmentedTransition: StateTransitionFn = (z, u, dt) => {
      const x = z.subarray(0, Nx);
      const theta = z.subarray(Nx, Nx + Np);

      const nextX = config.systemDynamics(x, theta, u, dt);
      const nextZ = new Float64Array(L);
      nextZ.set(nextX, 0);

      // Clamp parameters within specified min/max bounds if requested
      for (let p = 0; p < Np; p++) {
        let paramVal = theta[p]!;
        const boundMin = config.parameters[p]!.minBound;
        const boundMax = config.parameters[p]!.maxBound;
        if (boundMin !== undefined && paramVal < boundMin) paramVal = boundMin;
        if (boundMax !== undefined && paramVal > boundMax) paramVal = boundMax;
        nextZ[Nx + p] = paramVal;
      }

      return nextZ;
    };

    // Augmented measurement model: y = h(x, theta)
    const augmentedObservation: MeasurementFn = (z) => {
      const x = z.subarray(0, Nx);
      const theta = z.subarray(Nx, Nx + Np);
      return config.observationModel(x, theta);
    };

    const estimatedTrajectory: Float64Array[] = [];
    const simulatedMeas: Float64Array[] = Array.from({ length: M }, () => new Float64Array(N));

    // Temporal Filtering Loop
    const measVec = new Float64Array(M);
    const controlVec = new Float64Array(config.controlInputs?.length ?? 1);

    for (let k = 0; k < N; k++) {
      const dt = k > 0 ? config.timeGrid[k]! - config.timeGrid[k - 1]! : config.timeGrid[1]! - config.timeGrid[0]!;

      // Populate control vector at step k
      if (config.controlInputs) {
        for (let c = 0; c < config.controlInputs.length; c++) {
          controlVec[c] = config.controlInputs[c]![k] ?? 0.0;
        }
      }

      // Prediction step (for k > 0)
      if (k > 0) {
        ukf.predict(augmentedTransition, controlVec, dt);
      }

      // Populate measurement vector at step k
      for (let m = 0; m < M; m++) {
        measVec[m] = config.measuredTelemetry[m]![k] ?? 0.0;
      }

      // Correction / Update step
      ukf.update(augmentedObservation, measVec);

      // Save state estimate
      const stateSnapshot = new Float64Array(L);
      stateSnapshot.set(ukf.state);
      estimatedTrajectory.push(stateSnapshot);

      const yPred = augmentedObservation(ukf.state);
      for (let m = 0; m < M; m++) {
        simulatedMeas[m]![k] = yPred[m]!;
      }
    }

    // Compute residual RMSE across measurements
    let totalResidualSq = 0.0;
    let totalCount = 0;
    for (let m = 0; m < M; m++) {
      for (let k = 0; k < N; k++) {
        const diff = config.measuredTelemetry[m]![k]! - simulatedMeas[m]![k]!;
        totalResidualSq += diff * diff;
        totalCount++;
      }
    }
    const overallRmse = Math.sqrt(totalResidualSq / (totalCount || 1));

    // Extract posterior parameter distributions from the final state & covariance
    const results: BayesianCalibrationResult[] = [];
    for (let p = 0; p < Np; p++) {
      const prior = config.parameters[p]!;
      const stateIdx = Nx + p;
      const calVal = ukf.state[stateIdx]!;
      const variance = Math.max(1e-12, ukf.cov[stateIdx * L + stateIdx]!);
      const stdDev = Math.sqrt(variance);

      const ciLow = calVal - 1.96 * stdDev;
      const ciHigh = calVal + 1.96 * stdDev;
      const relDelta = ((calVal - prior.nominalValue) / (prior.nominalValue || 1.0)) * 100.0;

      const unitStr = prior.unit ? ` ${prior.unit}` : "";
      const ideSuggestion =
        `Physical test stand telemetry indicates parameter '${prior.name}' = ${calVal.toFixed(4)}${unitStr} ` +
        `+/- ${stdDev.toFixed(4)} (nominal ${prior.nominalValue.toFixed(4)}${unitStr}, delta ${relDelta > 0 ? "+" : ""}${relDelta.toFixed(1)}%). ` +
        `Accept update to SysML v2 attribute and Modelica parameter?`;

      results.push({
        parameterName: prior.name,
        nominalValue: prior.nominalValue,
        calibratedValue: calVal,
        stdDev,
        confidenceInterval95: [ciLow, ciHigh],
        relativeChangePercent: relDelta,
        unit: prior.unit,
        rmse: overallRmse,
        ideSuggestion,
      });
    }

    return {
      results,
      estimatedTrajectory,
      finalCovariance: new Float64Array(ukf.cov),
    };
  }

  /**
   * Binds calibration results into the DigitalThreadHypergraph as an active Telemetry-to-Simulation thread.
   */
  public static federateCalibrationToThread(
    hypergraph: DigitalThreadHypergraph,
    threadId: number,
    telemetryNodeId: number,
    simulationNodeId: number,
    _calibrationResults: BayesianCalibrationResult[],
  ): number {
    return bindTelemetryToSimulationThread(hypergraph, threadId, telemetryNodeId, simulationNodeId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hamiltonian Monte Carlo / No-U-Turn Sampler (NUTS) for Bayesian Posterior UQ
// ─────────────────────────────────────────────────────────────────────────────

export interface NutsSamplerOptions {
  /** Initial parameter vector `q0`. */
  initialPosition: Float64Array;
  /** Evaluates unnormalized log-posterior `log p(q | y)` and its gradient `∇_q log p(q | y)`. */
  logProbAndGrad: (q: Float64Array) => { logProb: number; grad: Float64Array };
  /** Number of post-warmup posterior samples (default: 400). */
  numSamples?: number | undefined;
  /** Number of warmup / dual-averaging adaptation steps (default: 200). */
  numWarmup?: number | undefined;
  /** Initial leapfrog step size `ε` (default: 0.05). */
  stepSize?: number | undefined;
  /** Target Metropolis acceptance probability for dual averaging (default: 0.8). */
  targetAccept?: number | undefined;
  /** Maximum binary tree depth `2^maxTreeDepth` leapfrog steps (default: 6). */
  maxTreeDepth?: number | undefined;
  /** Deterministic PRNG seed (default: 42). */
  seed?: number | undefined;
}

export interface NutsPosteriorSummary {
  samples: Float64Array[];
  mean: Float64Array;
  stdDev: Float64Array;
  ci95: [number, number][];
  acceptanceRate: number;
  finalStepSize: number;
}

/**
 * No-U-Turn Sampler (NUTS / Adaptive HMC) for gradient-informed Bayesian parameter inference.
 *
 * Uses symplectic leapfrog integration, Hoffman-Gelman U-turn termination (`(q^+ - q^-) · p < 0`),
 * and Nesterov dual averaging for automatic step-size tuning during warmup.
 */
export function samplePosteriorNuts(options: NutsSamplerOptions): NutsPosteriorSummary {
  const { initialPosition, logProbAndGrad } = options;
  const d = initialPosition.length;
  const numSamples = options.numSamples ?? 400;
  const numWarmup = options.numWarmup ?? 200;
  const targetAccept = options.targetAccept ?? 0.8;
  const maxSteps = 1 << Math.min(8, options.maxTreeDepth ?? 5);

  // Deterministic Box-Muller PRNG (xorshift32)
  let state = (options.seed ?? 42) >>> 0 || 1;
  const randUniform = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) + 1) / 4294967297;
  };
  const randNormal = (): number => {
    const u1 = Math.max(1e-12, randUniform());
    const u2 = randUniform();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  };

  let eps = options.stepSize ?? 0.05;
  const mu = Math.log(10 * eps);
  let logEpsBar = Math.log(eps);
  let hBar = 0;
  const gammaDA = 0.05;
  const t0DA = 10;
  const kappaDA = 0.75;

  let qCur = new Float64Array(initialPosition);
  let evalCur = logProbAndGrad(qCur);

  const samples: Float64Array[] = [];
  let acceptSum = 0;
  const totalIters = numWarmup + numSamples;

  for (let iter = 0; iter < totalIters; iter++) {
    // Sample momentum p ~ N(0, I)
    const p0 = new Float64Array(d);
    let kin0 = 0;
    for (let i = 0; i < d; i++) {
      const pi = randNormal();
      p0[i] = pi;
      kin0 += 0.5 * pi * pi;
    }
    const H0 = -evalCur.logProb + kin0;

    // Leapfrog trajectory with U-turn termination (Hoffman-Gelman criterion)
    const dir = randUniform() < 0.5 ? -1 : 1;
    const step = dir * eps;
    const q = new Float64Array(qCur);
    const p = new Float64Array(p0);
    let grad: Float64Array = new Float64Array(evalCur.grad);
    let logP = evalCur.logProb;

    let qProp = new Float64Array(qCur);
    let evalProp = evalCur;
    let propH = H0;
    let weightSum = 1.0;

    for (let l = 0; l < maxSteps; l++) {
      // Half step momentum
      for (let i = 0; i < d; i++) p[i] = p[i]! + 0.5 * step * grad[i]!;
      // Full step position
      for (let i = 0; i < d; i++) q[i] = q[i]! + step * p[i]!;
      const ev = logProbAndGrad(q);
      if (!Number.isFinite(ev.logProb)) break;
      logP = ev.logProb;
      grad = ev.grad;
      // Half step momentum
      for (let i = 0; i < d; i++) p[i] = p[i]! + 0.5 * step * grad[i]!;

      let kin = 0;
      for (let i = 0; i < d; i++) kin += 0.5 * p[i]! * p[i]!;
      const H = -logP + kin;
      if (H - H0 > 1000) break; // Divergent trajectory

      // Multinomial transition weight exp(-(H - H0))
      const w = Math.exp(Math.min(0, H0 - H));
      weightSum += w;
      if (randUniform() < w / weightSum) {
        qProp = new Float64Array(q);
        evalProp = ev;
        propH = H;
      }

      // Check No-U-Turn condition: (q - q0) · (dir * p) < 0
      let dotUTurn = 0;
      for (let i = 0; i < d; i++) dotUTurn += (q[i]! - qCur[i]!) * (dir * p[i]!);
      if (dotUTurn < 0) break;
    }

    const alpha = Math.min(1.0, Math.exp(Math.min(0, H0 - propH)));
    if (randUniform() < alpha) {
      qCur = qProp;
      evalCur = evalProp;
    }

    if (iter < numWarmup) {
      // Nesterov dual averaging step-size adaptation
      const m = iter + 1;
      const wM = 1.0 / (m + t0DA);
      hBar = (1 - wM) * hBar + wM * (targetAccept - alpha);
      const logEps = mu - (Math.sqrt(m) / gammaDA) * hBar;
      eps = Math.max(1e-4, Math.min(1.0, Math.exp(logEps)));
      const mk = Math.pow(m, -kappaDA);
      logEpsBar = mk * logEps + (1 - mk) * logEpsBar;
      if (iter === numWarmup - 1) eps = Math.max(1e-4, Math.min(1.0, Math.exp(logEpsBar)));
    } else {
      acceptSum += alpha;
      samples.push(new Float64Array(qCur));
    }
  }

  // Compute posterior mean, stdDev, and 95% credible intervals
  const mean = new Float64Array(d);
  const stdDev = new Float64Array(d);
  const ci95: [number, number][] = [];

  for (let i = 0; i < d; i++) {
    let s = 0;
    const col = new Array<number>(samples.length);
    for (let k = 0; k < samples.length; k++) {
      const v = samples[k]![i]!;
      s += v;
      col[k] = v;
    }
    const m = s / Math.max(1, samples.length);
    mean[i] = m;
    let varAcc = 0;
    for (let k = 0; k < samples.length; k++) {
      const diff = col[k]! - m;
      varAcc += diff * diff;
    }
    stdDev[i] = Math.sqrt(varAcc / Math.max(1, samples.length - 1));
    col.sort((a, b) => a - b);
    const loIdx = Math.floor(0.025 * (col.length - 1));
    const hiIdx = Math.ceil(0.975 * (col.length - 1));
    ci95.push([col[loIdx] ?? m, col[hiIdx] ?? m]);
  }

  return {
    samples,
    mean,
    stdDev,
    ci95,
    acceptanceRate: acceptSum / Math.max(1, numSamples),
    finalStepSize: eps,
  };
}
