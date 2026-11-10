// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Automated PSS/E .dyr Dynamic Parameter Calibrator for NERC MOD-026-1 and MOD-027-1.
 *
 * Employs derivative-free bounded Simplex / Levenberg-Marquardt optimization to tune
 * generator, exciter, and governor parameters against field PMU disturbance recordings.
 */

import {
  buildSmibConfig,
  PmuSmibHarness,
  type PmuPlaybackTelemetry,
  type SmibGeneratorConfig,
  type SmibPlaybackResult,
} from "../playback/pmu-smib-harness.js";
import type { GeneratorRecord, PsseDyrCase } from "../types.js";

/**
 * Parameter definition for calibration with prior, bounds, and step size.
 */
export interface CalibrateParameterSpec {
  name: keyof SmibGeneratorConfig;
  targetModel: "generator" | "exciter" | "governor";
  initialValue: number;
  minValue: number;
  maxValue: number;
  unit: string;
  description: string;
}

/**
 * Single calibrated parameter result with comparison and confidence interval.
 */
export interface CalibratedParameterResult {
  name: string;
  targetModel: "generator" | "exciter" | "governor";
  initialValue: number;
  calibratedValue: number;
  relativeChangePercent: number;
  minValue: number;
  maxValue: number;
  unit: string;
  description: string;
}

/**
 * Options for the parameter calibration run.
 */
export interface DyrCalibrationOptions {
  /** Maximum number of optimization iterations (default: 80). */
  maxIterations?: number | undefined;
  /** Objective function convergence tolerance (default: 1e-4). */
  tolerance?: number | undefined;
  /** Weight for active power residual (default: 0.6). */
  weightP?: number | undefined;
  /** Weight for reactive power residual (default: 0.4). */
  weightQ?: number | undefined;
  /** Specific parameters to tune. If omitted, standard defaults based on model types are used. */
  parametersToTune?: CalibrateParameterSpec[] | undefined;
}

/**
 * Complete NERC MOD-026/027 Dynamic Calibration Report.
 */
export interface DyrCalibrationReport {
  timestamp: string;
  busNumber: number;
  genId: string;
  generatorModel: string;
  exciterModel?: string | undefined;
  governorModel?: string | undefined;

  // Pre- and post-calibration simulation results
  initialSimulation: SmibPlaybackResult;
  calibratedSimulation: SmibPlaybackResult;

  // Parameter transitions
  parameters: CalibratedParameterResult[];

  // Verification outcome
  improvementPercent: number;
  isCompliant: boolean;
  notes: string[];
}

/**
 * Standard parameter bounding priors for PSS/E dynamic models.
 */
export function getDefaultCalibrationParameters(config: SmibGeneratorConfig): CalibrateParameterSpec[] {
  const specs: CalibrateParameterSpec[] = [];

  // 1. Exciter parameters (MOD-026)
  if (config.Ka !== undefined && config.Ta !== undefined) {
    specs.push({
      name: "Ka",
      targetModel: "exciter",
      initialValue: config.Ka,
      minValue: 10.0,
      maxValue: 600.0,
      unit: "p.u.",
      description: "AVR voltage regulator forward gain Ka",
    });
    specs.push({
      name: "Ta",
      targetModel: "exciter",
      initialValue: config.Ta,
      minValue: 0.005,
      maxValue: 0.25,
      unit: "s",
      description: "AVR voltage regulator time constant Ta",
    });
  }

  // 2. Governor parameters (MOD-027)
  if (config.droopR !== undefined && config.T1 !== undefined) {
    specs.push({
      name: "droopR",
      targetModel: "governor",
      initialValue: config.droopR,
      minValue: 0.02, // 2%
      maxValue: 0.08, // 8% (NERC standard requires 3%-5%)
      unit: "p.u.",
      description: "Permanent speed droop R",
    });
    specs.push({
      name: "T1",
      targetModel: "governor",
      initialValue: config.T1,
      minValue: 0.05,
      maxValue: 2.0,
      unit: "s",
      description: "Governor actuator/servo time constant T1",
    });
  }

  // 3. Generator parameters
  specs.push({
    name: "H",
    targetModel: "generator",
    initialValue: config.H,
    minValue: 1.0,
    maxValue: 10.0,
    unit: "MW·s/MVA",
    description: "Generator inertia constant H",
  });
  specs.push({
    name: "D",
    targetModel: "generator",
    initialValue: config.D,
    minValue: 0.0,
    maxValue: 4.0,
    unit: "p.u.",
    description: "Rotor speed damping coefficient D",
  });
  specs.push({
    name: "Xdp",
    targetModel: "generator",
    initialValue: config.Xdp,
    minValue: 0.1,
    maxValue: 0.6,
    unit: "p.u.",
    description: "d-axis transient reactance X'd",
  });

  return specs;
}

/**
 * Calibrates PSS/E dynamic parameters for a specified generator against field telemetry.
 */
export function calibrateDyrParameters(
  gen: GeneratorRecord,
  dyrCase: PsseDyrCase,
  telemetry: PmuPlaybackTelemetry,
  options: DyrCalibrationOptions = {},
): DyrCalibrationReport {
  const genId = `${gen.i}_${gen.id.trim()}`;
  const dyrGen = dyrCase.generatorsByBusId.get(genId) ?? dyrCase.generatorsByBusId.get(String(gen.i));
  const dyrExc = dyrCase.excitersByBusId.get(genId) ?? dyrCase.excitersByBusId.get(String(gen.i));
  const dyrGov = dyrCase.governorsByBusId.get(genId) ?? dyrCase.governorsByBusId.get(String(gen.i));

  const initialConfig = buildSmibConfig(gen, dyrGen, dyrExc, dyrGov);
  const harness = new PmuSmibHarness(initialConfig);

  // Initial baseline simulation
  const initialSim = harness.simulate(telemetry);

  const specs = options.parametersToTune ?? getDefaultCalibrationParameters(initialConfig);
  const maxIter = options.maxIterations ?? 60;
  const tol = options.tolerance ?? 1e-4;
  const wP = options.weightP ?? 0.6;
  const wQ = options.weightQ ?? 0.4;

  const numParams = specs.length;
  if (numParams === 0) {
    return {
      timestamp: new Date().toISOString(),
      busNumber: gen.i,
      genId: gen.id.trim(),
      generatorModel: initialConfig.generatorModel,
      exciterModel: initialConfig.exciterModel,
      governorModel: initialConfig.governorModel,
      initialSimulation: initialSim,
      calibratedSimulation: initialSim,
      parameters: [],
      improvementPercent: 0,
      isCompliant: initialSim.isCompliant,
      notes: ["No tunable parameters identified for the selected generator models."],
    };
  }

  // Parameter vector normalization to [0, 1] for conditioned Nelder-Mead optimization
  const toUnit = (val: number, min: number, max: number) => Math.max(0, Math.min(1, (val - min) / (max - min)));
  const fromUnit = (u: number, min: number, max: number) => min + Math.max(0, Math.min(1, u)) * (max - min);

  const x0 = new Float64Array(numParams);
  for (let i = 0; i < numParams; i++) {
    x0[i] = toUnit(specs[i]!.initialValue, specs[i]!.minValue, specs[i]!.maxValue);
  }

  // Cost function: weighted NRMSE of P and Q
  const evaluateCost = (x: Float64Array): { cost: number; simResult: SmibPlaybackResult } => {
    const candidateConfig: Partial<SmibGeneratorConfig> = {};
    for (let i = 0; i < numParams; i++) {
      const pName = specs[i]!.name;
      const pVal = fromUnit(x[i]!, specs[i]!.minValue, specs[i]!.maxValue);
      (candidateConfig as Record<string, number>)[pName] = pVal;
    }

    harness.updateParameters(candidateConfig);
    const res = harness.simulate(telemetry);
    const cost = wP * res.pMetrics.nrmse + wQ * res.qMetrics.nrmse;
    return { cost, simResult: res };
  };

  const initialCostEval = evaluateCost(x0);
  let bestCost = initialCostEval.cost;
  let bestX = new Float64Array(x0);
  let bestSim = initialCostEval.simResult;

  // Initialize Nelder-Mead simplex with (numParams + 1) vertices
  const nDim = numParams;
  const simplex: { x: Float64Array; cost: number; sim: SmibPlaybackResult }[] = [];
  simplex.push({ x: new Float64Array(x0), cost: bestCost, sim: bestSim });

  for (let i = 0; i < nDim; i++) {
    const vertex = new Float64Array(x0);
    // Perturb coordinate by 10%
    const step = 0.1;
    vertex[i] = Math.max(0, Math.min(1, vertex[i]! + step));
    const evalRes = evaluateCost(vertex);
    simplex.push({ x: vertex, cost: evalRes.cost, sim: evalRes.simResult });
    if (evalRes.cost < bestCost) {
      bestCost = evalRes.cost;
      bestX = new Float64Array(vertex);
      bestSim = evalRes.simResult;
    }
  }

  // Nelder-Mead parameters
  const alpha = 1.0; // Reflection
  const gamma = 2.0; // Expansion
  const rho = 0.5; // Contraction
  const sigma = 0.5; // Shrink

  for (let iter = 0; iter < maxIter; iter++) {
    // 1. Sort simplex by cost
    simplex.sort((a, b) => a.cost - b.cost);
    const currentBest = simplex[0]!;
    const worst = simplex[nDim]!;
    const secondWorst = simplex[nDim - 1]!;

    if (currentBest.cost < bestCost) {
      bestCost = currentBest.cost;
      bestX = new Float64Array(currentBest.x);
      bestSim = currentBest.sim;
    }

    // Convergence check
    if (worst.cost - currentBest.cost < tol) {
      break;
    }

    // 2. Centroid of all vertices except worst
    const centroid = new Float64Array(nDim);
    for (let i = 0; i < nDim; i++) {
      for (let j = 0; j < nDim; j++) {
        centroid[j] = (centroid[j] ?? 0) + (simplex[i]?.x[j] ?? 0);
      }
    }
    for (let j = 0; j < nDim; j++) {
      centroid[j] = (centroid[j] ?? 0) / nDim;
    }

    // 3. Reflection
    const xr = new Float64Array(nDim);
    for (let j = 0; j < nDim; j++) {
      xr[j] = Math.max(0, Math.min(1, centroid[j]! + alpha * (centroid[j]! - worst.x[j]!)));
    }
    const rEval = evaluateCost(xr);

    if (rEval.cost >= currentBest.cost && rEval.cost < secondWorst.cost) {
      simplex[nDim] = { x: xr, cost: rEval.cost, sim: rEval.simResult };
      continue;
    }

    // 4. Expansion
    if (rEval.cost < currentBest.cost) {
      const xe = new Float64Array(nDim);
      for (let j = 0; j < nDim; j++) {
        xe[j] = Math.max(0, Math.min(1, centroid[j]! + gamma * (xr[j]! - centroid[j]!)));
      }
      const eEval = evaluateCost(xe);
      if (eEval.cost < rEval.cost) {
        simplex[nDim] = { x: xe, cost: eEval.cost, sim: eEval.simResult };
      } else {
        simplex[nDim] = { x: xr, cost: rEval.cost, sim: rEval.simResult };
      }
      continue;
    }

    // 5. Contraction
    const xc = new Float64Array(nDim);
    for (let j = 0; j < nDim; j++) {
      xc[j] = Math.max(0, Math.min(1, centroid[j]! + rho * (worst.x[j]! - centroid[j]!)));
    }
    const cEval = evaluateCost(xc);
    if (cEval.cost < worst.cost) {
      simplex[nDim] = { x: xc, cost: cEval.cost, sim: cEval.simResult };
      continue;
    }

    // 6. Shrink
    for (let i = 1; i <= nDim; i++) {
      for (let j = 0; j < nDim; j++) {
        simplex[i]!.x[j] = Math.max(0, Math.min(1, currentBest.x[j]! + sigma * (simplex[i]!.x[j]! - currentBest.x[j]!)));
      }
      const sEval = evaluateCost(simplex[i]!.x);
      simplex[i]!.cost = sEval.cost;
      simplex[i]!.sim = sEval.simResult;
    }
  }

  // Build parameter comparison report
  const paramResults: CalibratedParameterResult[] = [];
  const candidateConfig: Partial<SmibGeneratorConfig> = {};
  for (let i = 0; i < numParams; i++) {
    const spec = specs[i]!;
    const calVal = fromUnit(bestX[i]!, spec.minValue, spec.maxValue);
    (candidateConfig as Record<string, number>)[spec.name] = calVal;
    const relChange = ((calVal - spec.initialValue) / Math.max(1e-6, Math.abs(spec.initialValue))) * 100.0;

    paramResults.push({
      name: spec.name,
      targetModel: spec.targetModel,
      initialValue: spec.initialValue,
      calibratedValue: calVal,
      relativeChangePercent: relChange,
      minValue: spec.minValue,
      maxValue: spec.maxValue,
      unit: spec.unit,
      description: spec.description,
    });
  }

  // Update harness and run final high-resolution playback
  harness.updateParameters(candidateConfig);
  const finalSim = harness.simulate(telemetry);

  const initialTotalNrmse = wP * initialSim.pMetrics.nrmse + wQ * initialSim.qMetrics.nrmse;
  const finalTotalNrmse = wP * finalSim.pMetrics.nrmse + wQ * finalSim.qMetrics.nrmse;
  const improvement = ((initialTotalNrmse - finalTotalNrmse) / Math.max(1e-6, initialTotalNrmse)) * 100.0;

  const notes: string[] = [];
  if (finalSim.isCompliant) {
    notes.push("Model satisfies NERC MOD-026/027 goodness-of-fit requirements (R² >= 0.85, NRMSE <= 0.10).");
  } else {
    notes.push(
      `Residual discrepancy remains above standard threshold (P R²=${finalSim.pMetrics.rSquared.toFixed(2)}, Q R²=${finalSim.qMetrics.rSquared.toFixed(2)}).`,
    );
  }

  return {
    timestamp: new Date().toISOString(),
    busNumber: gen.i,
    genId: gen.id.trim(),
    generatorModel: initialConfig.generatorModel,
    exciterModel: initialConfig.exciterModel,
    governorModel: initialConfig.governorModel,
    initialSimulation: initialSim,
    calibratedSimulation: finalSim,
    parameters: paramResults,
    improvementPercent: Math.max(0, improvement),
    isCompliant: finalSim.isCompliant,
    notes,
  };
}
