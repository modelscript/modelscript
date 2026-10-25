// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Autonomous Field History Matching & Parameter Tuning Engine.
 *
 * Automatically calibrates multiphase flowline model parameters (pipe roughness,
 * overall heat transfer coefficient U, choke Cd, and wellhead productivity)
 * to match measured SCADA telemetry / test separator observations.
 */

import { simulateDriftFlux } from "../solver/drift-flux-dae.js";
import type { OlgaModel, OlgaSimulationResult } from "../types.js";

export type TunableParameter = "roughness" | "heat-transfer" | "choke-cd" | "well-rate";

export interface OlgaObservationData {
  times: number[];
  inletPressurePa?: number[] | undefined;
  arrivalPressurePa?: number[] | undefined;
  arrivalTemperatureK?: number[] | undefined;
  arrivalLiquidRateKgS?: number[] | undefined;
}

export interface OlgaTuningOptions {
  parameters?: TunableParameter[] | undefined;
  maxEvaluations?: number | undefined;
  tolerance?: number | undefined;
  weights?:
    | {
        pressure?: number | undefined;
        temperature?: number | undefined;
        rate?: number | undefined;
      }
    | undefined;
  durationSeconds?: number | undefined;
  timeStepSeconds?: number | undefined;
}

export interface ParameterCalibrationResult {
  name: TunableParameter;
  initialValue: number;
  calibratedValue: number;
  unit: string;
  shiftPercent: number;
}

export interface OlgaTuningResult {
  success: boolean;
  evaluations: number;
  initialObjective: number;
  finalObjective: number;
  improvementPercent: number;
  calibratedParameters: ParameterCalibrationResult[];
  calibratedModel: OlgaModel;
  metrics: {
    pressureR2: number;
    pressureRmseBar: number;
    temperatureR2: number;
    temperatureRmseK: number;
  };
  markdownReport: string;
}

/**
 * Parses observation telemetry from a standard CSV string.
 * Supports headers: TIME, PT_INLET, PT_OUTLET / PT_ARRIVAL, TM_OUTLET, QLT / MASS_RATE.
 */
export function parseObservationCsv(csvText: string): OlgaObservationData {
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("Telemetry CSV must contain a header row and at least one data row.");
  }

  const rawHeaders = lines[0]!.split(",").map((h) => h.trim().toUpperCase());
  const colTime = rawHeaders.findIndex((h) => h.includes("TIME"));
  const colPInlet = rawHeaders.findIndex(
    (h) => (h.includes("INLET") || h.includes("WELL")) && (h.includes("P") || h.includes("PRES")),
  );
  const colPArrival = rawHeaders.findIndex(
    (h) =>
      (h.includes("OUTLET") || h.includes("ARRIV") || h.includes("SEP")) && (h.includes("P") || h.includes("PRES")),
  );
  const colTArrival = rawHeaders.findIndex((h) => h.includes("TM") || h.includes("TEMP"));
  const colRate = rawHeaders.findIndex((h) => h.includes("QLT") || h.includes("RATE") || h.includes("MASS"));

  const times: number[] = [];
  const inletP: number[] = [];
  const arrivalP: number[] = [];
  const arrivalT: number[] = [];
  const arrivalRate: number[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(",").map((v) => parseFloat(v.trim()));
    const t = colTime >= 0 ? parts[colTime]! : i * 1.0;
    times.push(t);

    if (colPInlet >= 0 && Number.isFinite(parts[colPInlet]!)) {
      const v = parts[colPInlet]!;
      inletP.push(v < 1000 ? v * 1e5 : v); // bar to Pa heuristic
    }
    if (colPArrival >= 0 && Number.isFinite(parts[colPArrival]!)) {
      const v = parts[colPArrival]!;
      arrivalP.push(v < 1000 ? v * 1e5 : v);
    }
    if (colTArrival >= 0 && Number.isFinite(parts[colTArrival]!)) {
      const v = parts[colTArrival]!;
      arrivalT.push(v < 150 ? v + 273.15 : v); // C to K heuristic
    }
    if (colRate >= 0 && Number.isFinite(parts[colRate]!)) {
      arrivalRate.push(parts[colRate]!);
    }
  }

  return {
    times,
    inletPressurePa: inletP.length === times.length ? inletP : undefined,
    arrivalPressurePa: arrivalP.length === times.length ? arrivalP : undefined,
    arrivalTemperatureK: arrivalT.length === times.length ? arrivalT : undefined,
    arrivalLiquidRateKgS: arrivalRate.length === times.length ? arrivalRate : undefined,
  };
}

/**
 * Deep clones an OlgaModel.
 */
function cloneModel(model: OlgaModel): OlgaModel {
  return JSON.parse(JSON.stringify(model));
}

/**
 * Autonomous Parameter Tuning & History Matching Engine.
 */
export function calibrateOlgaModel(
  baseModel: OlgaModel,
  observations: OlgaObservationData,
  options: OlgaTuningOptions = {},
): OlgaTuningResult {
  const targetParams: TunableParameter[] =
    options.parameters && options.parameters.length > 0
      ? options.parameters
      : ["roughness", "heat-transfer", "choke-cd"];

  const maxEvals = options.maxEvaluations ?? 50;
  const tol = options.tolerance ?? 1e-5;
  const wP = options.weights?.pressure ?? 1.0;
  const wT = options.weights?.temperature ?? 0.5;
  const wQ = options.weights?.rate ?? 0.2;

  const simDuration =
    options.durationSeconds ??
    Math.max(10, observations.times[observations.times.length - 1]! - observations.times[0]!);
  const simDt = options.timeStepSeconds ?? 1.0;

  // Extract initial baseline values
  const flowpath = baseModel.flowpaths[0]!;
  const initRoughness = flowpath.pipes[0]?.roughness ?? 4.5e-5;
  const initHamb = flowpath.heatTransfer?.ambientHeatTransferCoeff ?? 250.0;
  const initCd = flowpath.valves[0]?.cd ?? 0.84;
  const initRate =
    flowpath.sources[0]?.totalMassRate ?? baseModel.nodes.find((n) => n.massRate != null)?.massRate ?? 35.0;

  // Normalization scaling vectors: theta = [x_1, x_2, ...] scaled around 1.0
  const paramKeys = [...targetParams];
  const D = paramKeys.length;
  let theta = new Float64Array(D).fill(1.0); // 1.0 = baseline multiplier

  // Bounds on multipliers
  const bounds: { min: number; max: number }[] = paramKeys.map((p) => {
    switch (p) {
      case "roughness":
        return { min: 0.05, max: 20.0 }; // 0.05x to 20x pipe roughness
      case "heat-transfer":
        return { min: 0.1, max: 10.0 }; // 0.1x to 10x heat transfer coefficient
      case "choke-cd":
        return { min: 0.2, max: 3.0 }; // Choke Cd multiplier
      case "well-rate":
        return { min: 0.2, max: 5.0 }; // Source mass rate multiplier
    }
  });

  function applyParameters(model: OlgaModel, x: Float64Array): void {
    const fp = model.flowpaths[0]!;
    for (let i = 0; i < D; i++) {
      const p = paramKeys[i]!;
      const mult = Math.max(bounds[i]!.min, Math.min(bounds[i]!.max, x[i]!));
      switch (p) {
        case "roughness":
          for (const pipe of fp.pipes) {
            pipe.roughness = initRoughness * mult;
          }
          break;
        case "heat-transfer":
          if (fp.heatTransfer) {
            fp.heatTransfer.ambientHeatTransferCoeff = initHamb * mult;
            for (const layer of fp.heatTransfer.layers) {
              layer.conductivity = layer.conductivity / mult; // Effective U scaling
            }
          }
          break;
        case "choke-cd":
          if (fp.valves.length > 0) {
            fp.valves[0]!.cd = Math.max(0.1, Math.min(1.2, initCd * mult));
          }
          break;
        case "well-rate":
          if (fp.sources.length > 0) {
            fp.sources[0]!.totalMassRate = initRate * mult;
          }
          for (const node of model.nodes) {
            if (node.massRate != null) node.massRate = initRate * mult;
          }
          break;
      }
    }
  }

  function evaluateObjective(x: Float64Array): { obj: number; simResult: OlgaSimulationResult } {
    // Penalty for bound violations
    let penalty = 0.0;
    for (let i = 0; i < D; i++) {
      if (x[i]! < bounds[i]!.min) penalty += 1e4 * Math.pow(bounds[i]!.min - x[i]!, 2);
      if (x[i]! > bounds[i]!.max) penalty += 1e4 * Math.pow(x[i]! - bounds[i]!.max, 2);
    }

    const testModel = cloneModel(baseModel);
    applyParameters(testModel, x);

    const sim = simulateDriftFlux(testModel, {
      durationSeconds: simDuration,
      timeStepSeconds: simDt,
    });

    let sse = 0.0;
    let count = 0;

    // Compare inlet and arrival pressure trajectories
    if (observations.inletPressurePa && observations.inletPressurePa.length > 0) {
      for (let k = 0; k < observations.times.length; k++) {
        const obsP = observations.inletPressurePa[k]!;
        const simIdx = Math.min(sim.trends.inletPressure.length - 1, Math.floor(k));
        const simP = sim.trends.inletPressure[simIdx]!;
        sse += wP * Math.pow((simP - obsP) / 1e5, 2); // Error in bar^2
        count++;
      }
    }

    if (observations.arrivalPressurePa && observations.arrivalPressurePa.length > 0) {
      for (let k = 0; k < observations.times.length; k++) {
        const obsP = observations.arrivalPressurePa[k]!;
        const simIdx = Math.min(sim.trends.arrivalPressure.length - 1, Math.floor(k));
        const simP = sim.trends.arrivalPressure[simIdx]!;
        sse += wP * Math.pow((simP - obsP) / 1e5, 2);
        count++;
      }
    }

    // Compare temperature
    if (observations.arrivalTemperatureK && observations.arrivalTemperatureK.length > 0) {
      for (let k = 0; k < observations.times.length; k++) {
        const obsT = observations.arrivalTemperatureK[k]!;
        const simIdx = Math.min(sim.trends.arrivalTemperature.length - 1, Math.floor(k));
        const simT = sim.trends.arrivalTemperature[simIdx]!;
        sse += wT * Math.pow((simT - obsT) / 5.0, 2); // Normalized by 5 K
        count++;
      }
    }

    // Compare liquid rate
    if (observations.arrivalLiquidRateKgS && observations.arrivalLiquidRateKgS.length > 0) {
      for (let k = 0; k < observations.times.length; k++) {
        const obsQ = observations.arrivalLiquidRateKgS[k]!;
        const simIdx = Math.min(sim.trends.arrivalLiquidMassRate.length - 1, Math.floor(k));
        const simQ = sim.trends.arrivalLiquidMassRate[simIdx]!;
        sse += wQ * Math.pow((simQ - obsQ) / 5.0, 2);
        count++;
      }
    }

    const obj = (count > 0 ? sse / count : sse) + penalty;
    return { obj, simResult: sim };
  }

  // Baseline evaluation
  const initialEval = evaluateObjective(theta);
  const initialObj = initialEval.obj;

  // Bound-constrained Nelder-Mead Simplex Optimization
  const simplex: { x: Float64Array; obj: number }[] = [];
  simplex.push({ x: new Float64Array(theta), obj: initialObj });

  for (let i = 0; i < D; i++) {
    const xPerturb = new Float64Array(theta);
    xPerturb[i] = xPerturb[i]! * 1.5;
    simplex.push({ x: xPerturb, obj: evaluateObjective(xPerturb).obj });
  }

  let evalCount = D + 1;
  const alpha = 1.0;
  const gamma = 2.0;
  const rho = 0.5;
  const sigma = 0.5;

  while (evalCount < maxEvals) {
    simplex.sort((a, b) => a.obj - b.obj);
    const best = simplex[0]!;
    const worst = simplex[simplex.length - 1]!;

    if (Math.abs(worst.obj - best.obj) < tol) break;

    // Centroid of D best points
    const centroid = new Float64Array(D);
    for (let i = 0; i < D; i++) {
      const pt = simplex[i]!;
      for (let d = 0; d < D; d++) {
        const val = pt.x[d] ?? 1.0;
        centroid[d] = (centroid[d] ?? 0.0) + val / D;
      }
    }

    // Reflection
    const xr = new Float64Array(D);
    for (let d = 0; d < D; d++) {
      xr[d] = centroid[d]! + alpha * (centroid[d]! - worst.x[d]!);
    }
    const rEval = evaluateObjective(xr);
    evalCount++;

    if (rEval.obj < simplex[D - 1]!.obj && rEval.obj >= best.obj) {
      simplex[D] = { x: xr, obj: rEval.obj };
      continue;
    }

    // Expansion
    if (rEval.obj < best.obj) {
      const xe = new Float64Array(D);
      for (let d = 0; d < D; d++) {
        xe[d] = centroid[d]! + gamma * (xr[d]! - centroid[d]!);
      }
      const eEval = evaluateObjective(xe);
      evalCount++;
      simplex[D] = eEval.obj < rEval.obj ? { x: xe, obj: eEval.obj } : { x: xr, obj: rEval.obj };
      continue;
    }

    // Contraction
    const xc = new Float64Array(D);
    for (let d = 0; d < D; d++) {
      xc[d] = centroid[d]! + rho * (worst.x[d]! - centroid[d]!);
    }
    const cEval = evaluateObjective(xc);
    evalCount++;
    if (cEval.obj < worst.obj) {
      simplex[D] = { x: xc, obj: cEval.obj };
      continue;
    }

    // Shrink
    for (let i = 1; i <= D; i++) {
      for (let d = 0; d < D; d++) {
        simplex[i]!.x[d] = best.x[d]! + sigma * (simplex[i]!.x[d]! - best.x[d]!);
      }
      simplex[i]!.obj = evaluateObjective(simplex[i]!.x).obj;
      evalCount++;
    }
  }

  simplex.sort((a, b) => a.obj - b.obj);
  const bestSol = simplex[0]!;
  const finalEval = evaluateObjective(bestSol.x);

  // Build calibrated model
  const calibratedModel = cloneModel(baseModel);
  applyParameters(calibratedModel, bestSol.x);

  // Compute calibration results and metrics
  const calibratedParams: ParameterCalibrationResult[] = [];
  for (let i = 0; i < D; i++) {
    const p = paramKeys[i]!;
    const mult = bestSol.x[i]!;
    let initVal = 0;
    let calVal = 0;
    let unit = "";
    switch (p) {
      case "roughness":
        initVal = initRoughness;
        calVal = initRoughness * mult;
        unit = "m";
        break;
      case "heat-transfer":
        initVal = initHamb;
        calVal = initHamb * mult;
        unit = "W/m²K";
        break;
      case "choke-cd":
        initVal = initCd;
        calVal = initCd * mult;
        unit = "[-]";
        break;
      case "well-rate":
        initVal = initRate;
        calVal = initRate * mult;
        unit = "kg/s";
        break;
    }
    const shift = ((calVal - initVal) / initVal) * 100.0;
    calibratedParams.push({
      name: p,
      initialValue: initVal,
      calibratedValue: calVal,
      unit,
      shiftPercent: shift,
    });
  }

  // Calculate R2 and RMSE
  let pRmse = 0.0;
  let pR2 = 1.0;
  if (observations.inletPressurePa && observations.inletPressurePa.length > 0) {
    let sumSqErr = 0.0;
    let sumSqTot = 0.0;
    const meanObs = observations.inletPressurePa.reduce((a, b) => a + b, 0) / observations.inletPressurePa.length;
    for (let k = 0; k < observations.inletPressurePa.length; k++) {
      const obs = observations.inletPressurePa[k]!;
      const simP = finalEval.simResult.trends.inletPressure[k] ?? obs;
      sumSqErr += Math.pow(simP - obs, 2);
      sumSqTot += Math.pow(obs - meanObs, 2);
    }
    pRmse = Math.sqrt(sumSqErr / observations.inletPressurePa.length) / 1e5; // bar
    pR2 = sumSqTot > 1e-6 ? Math.max(0.0, 1.0 - sumSqErr / sumSqTot) : 1.0;
  }

  let tRmse = 0.0;
  let tR2 = 1.0;
  if (observations.arrivalTemperatureK && observations.arrivalTemperatureK.length > 0) {
    let sumSqErr = 0.0;
    let sumSqTot = 0.0;
    const meanObs =
      observations.arrivalTemperatureK.reduce((a, b) => a + b, 0) / observations.arrivalTemperatureK.length;
    for (let k = 0; k < observations.arrivalTemperatureK.length; k++) {
      const obs = observations.arrivalTemperatureK[k]!;
      const simT = finalEval.simResult.trends.arrivalTemperature[k] ?? obs;
      sumSqErr += Math.pow(simT - obs, 2);
      sumSqTot += Math.pow(obs - meanObs, 2);
    }
    tRmse = Math.sqrt(sumSqErr / observations.arrivalTemperatureK.length); // K
    tR2 = sumSqTot > 1e-6 ? Math.max(0.0, 1.0 - sumSqErr / sumSqTot) : 1.0;
  }

  const improvement = initialObj > 1e-6 ? ((initialObj - bestSol.obj) / initialObj) * 100.0 : 0.0;

  // Build Markdown Report
  const reportLines: string[] = [
    `# Flowline History Matching & Parameter Calibration Report`,
    ``,
    `**Model Title:** \`${baseModel.title}\`  `,
    `**Optimization Engine:** Bound-Constrained Nelder-Mead Simplex  `,
    `**Evaluations:** ${evalCount} iterations  `,
    `**Objective Value:** ${initialObj.toFixed(4)} → ${bestSol.obj.toFixed(4)} (${improvement.toFixed(1)}% reduction)  `,
    ``,
    `## Calibrated Parameter Set`,
    ``,
    `| Parameter | Baseline Value | Calibrated Value | Unit | Parameter Shift |`,
    `| :--- | :---: | :---: | :---: | :---: |`,
  ];

  for (const cp of calibratedParams) {
    const shiftStr = (cp.shiftPercent >= 0 ? "+" : "") + cp.shiftPercent.toFixed(1) + "%";
    reportLines.push(
      `| \`${cp.name}\` | ${cp.initialValue.toExponential(3)} | **${cp.calibratedValue.toExponential(3)}** | ${cp.unit} | ${shiftStr} |`,
    );
  }

  reportLines.push(``);
  reportLines.push(`## Statistical Goodness-of-Fit`);
  reportLines.push(``);
  reportLines.push(`- **Inlet Pressure RMSE:** ${pRmse.toFixed(3)} bar ($R^2 = ${(pR2 * 100).toFixed(2)}\\%$)`);
  reportLines.push(`- **Arrival Temperature RMSE:** ${tRmse.toFixed(3)} K ($R^2 = ${(tR2 * 100).toFixed(2)}\\%$)`);
  reportLines.push(``);
  reportLines.push(`*Generated autonomously by @modelscript/olga tuning engine.*`);

  return {
    success: bestSol.obj <= initialObj,
    evaluations: evalCount,
    initialObjective: initialObj,
    finalObjective: bestSol.obj,
    improvementPercent: improvement,
    calibratedParameters: calibratedParams,
    calibratedModel,
    metrics: {
      pressureR2: pR2,
      pressureRmseBar: pRmse,
      temperatureR2: tR2,
      temperatureRmseK: tRmse,
    },
    markdownReport: reportLines.join("\n"),
  };
}
