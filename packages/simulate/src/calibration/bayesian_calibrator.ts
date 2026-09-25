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
  processNoiseVariance?: number; // Random walk drift (default: 1e-6)
  minBound?: number;
  maxBound?: number;
  unit?: string;
}

export interface BayesianCalibrationResult {
  parameterName: string;
  nominalValue: number;
  calibratedValue: number;
  stdDev: number;
  confidenceInterval95: [number, number];
  relativeChangePercent: number;
  unit?: string;
  rmse: number;
  ideSuggestion: string;
}

export interface CalibrationRunConfig {
  stateNames: string[];
  parameters: ParameterPrior[];
  initialState: number[];
  initialStateVariance?: number[];
  timeGrid: Float64Array;
  measuredTelemetry: Float64Array[]; // Array of M channels, each length N
  controlInputs?: Float64Array[]; // Optional input signals
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
    calibrationResults: BayesianCalibrationResult[],
  ): number {
    return bindTelemetryToSimulationThread(hypergraph, threadId, telemetryNodeId, simulationNodeId);
  }
}
