// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Branched Gathering Network Dynamic Solver.
 *
 * Simulates arbitrary multi-flowpath gathering systems:
 * 1. Resolves subsea manifold and tee junction topologies
 * 2. Solves coupled pressure and mass continuity across merging flowpaths
 * 3. Integrates wellbore IPR deliverability (Vogel / Fetkovich / PI)
 * 4. Models in-line booster pumps and gas compressors
 * 5. Tracks wax layer deposition and sand dropout across all network branches
 */

import type {
  OlgaFlowpath,
  OlgaHeatExchanger,
  OlgaModel,
  OlgaSimulationResult,
  SpatialProfileSnapshot,
} from "../types.js";
import type { SimulationOptions } from "./drift-flux-dae.js";
import { classifyFlowRegime } from "./flow-regimes.js";
import { evaluateCellFluidProperties, resolvePvtTable } from "./fluid-properties.js";
import { evaluateCompressorBoost, evaluatePumpBoost } from "./machinery.js";
import { PigTracker } from "./pig-tracker.js";
import { SlugTracker } from "./slug-tracker.js";
import { evaluateSandTransport, evaluateWaxDeposition } from "./wax-and-sand.js";
import { stepWellInflow } from "./wellbore-ipr.js";
import { computeChurchillFriction, computeZuberFindlaySlip } from "./zuber-findlay.js";

export interface NetworkSimulationResult {
  times: number[];
  flowpathResults: Record<string, OlgaSimulationResult>;
  junctionPressures: Record<string, number[]>;
  totalProductionRateKgS: number[];
  totalLiquidSurgeVolumeM3: number[];
  totalMachineryPowerKw: number[];
}

interface InternalGridCell {
  x: number;
  dx: number;
  diameter: number;
  area: number;
  roughness: number;
  sinTheta: number;
  uHeatTransfer: number;
  ambientTemp: number;
  heatExchangers?: OlgaHeatExchanger[] | undefined;
}

interface FlowpathState {
  flowpath: OlgaFlowpath;
  cells: InternalGridCell[];
  P: Float64Array;
  T: Float64Array;
  alphaG: Float64Array;
  jFace: Float64Array;
  waxThickness: Float64Array;
  inletMassRate: number;
  inletGasFraction: number;
  inletWaterCut: number;
  inletTemp: number;
  outletPressure: number;
  slugTracker: SlugTracker;
  pigTracker: PigTracker;
  accumulatedLiquidVolume: number;
  peakLiquidSurgeVolume: number;
}

/**
 * Discretizes a flowpath into finite volume cells.
 */
function discretizeFlowpath(flowpath: OlgaFlowpath): InternalGridCell[] {
  const cells: InternalGridCell[] = [];
  let currentX = 0;

  for (const pipe of flowpath.pipes) {
    const nCells = Math.max(2, pipe.discretization);
    const dx = pipe.length / nCells;
    const diameter = Math.max(0.05, pipe.diameter);
    const area = 0.25 * Math.PI * diameter * diameter;
    const hyp = Math.sqrt(pipe.length * pipe.length + pipe.elevation * pipe.elevation);
    const sinTheta = hyp > 0 ? pipe.elevation / hyp : 0;

    let uHeatTransfer = 15.0;
    let ambientTemp = 277.15;
    if (flowpath.heatTransfer) {
      ambientTemp = flowpath.heatTransfer.ambientTemperature;
      if (flowpath.heatTransfer.layers.length > 0) {
        let rTotal = 1.0 / flowpath.heatTransfer.ambientHeatTransferCoeff;
        for (const layer of flowpath.heatTransfer.layers) {
          rTotal += layer.thickness / Math.max(0.01, layer.conductivity);
        }
        uHeatTransfer = 1.0 / rTotal;
      }
    }

    for (let c = 0; c < nCells; c++) {
      cells.push({
        x: currentX + 0.5 * dx,
        dx,
        diameter,
        area,
        roughness: pipe.roughness,
        sinTheta,
        uHeatTransfer,
        ambientTemp,
      });
      currentX += dx;
    }
  }

  // Associate heat exchangers with closest cell
  if (flowpath.heatExchangers && flowpath.heatExchangers.length > 0 && cells.length > 0) {
    for (const hex of flowpath.heatExchangers) {
      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < cells.length; i++) {
        const diff = Math.abs(cells[i]!.x - hex.position);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }
      if (!cells[closestIdx]!.heatExchangers) {
        cells[closestIdx]!.heatExchangers = [];
      }
      cells[closestIdx]!.heatExchangers!.push(hex);
    }
  }

  return cells;
}

/**
 * Simulates a complex branched gathering network model.
 */
export function simulateOlgaNetwork(model: OlgaModel, options?: SimulationOptions): NetworkSimulationResult {
  const duration = options?.durationSeconds ?? Math.min(model.endTime - model.startTime, 3600);
  const dt = options?.timeStepSeconds ?? Math.max(0.1, Math.min(model.maxDt, 1.0));
  const totalSteps = Math.max(1, Math.floor(duration / dt));
  const snapshotCount = options?.snapshotCount ?? 20;
  const snapshotInterval = Math.max(1, Math.floor(totalSteps / snapshotCount));

  const tableData = options?.pvtModel === "BLACK_OIL" ? null : resolvePvtTable(options?.pvtTable);

  // Initialize state per flowpath
  const states: Map<string, FlowpathState> = new Map();

  for (const fp of model.flowpaths) {
    const cells = discretizeFlowpath(fp);
    const N = cells.length;

    let inletMassRate = 30.0;
    let inletGasFraction = 0.25;
    let inletWaterCut = 0.05;
    let inletTemp = 340.15;
    let outletPressure = 35.0e5;

    // Check sources
    if (fp.sources.length > 0) {
      const src = fp.sources[0]!;
      inletMassRate = src.totalMassRate;
      inletGasFraction = src.gasMassFraction;
      inletWaterCut = src.waterCut;
      inletTemp = src.temperature;
    }

    // Check IPR initial delivery
    if (fp.ipr) {
      inletGasFraction = fp.ipr.gasMassFraction;
      inletWaterCut = fp.ipr.waterCut;
      inletTemp = fp.ipr.reservoirTemperature;
    }

    // Check connected nodes
    for (const node of model.nodes) {
      if (node.flowpath === fp.name) {
        if (node.boundaryPosition <= 0.05) {
          if (node.massRate != null) inletMassRate = node.massRate;
          if (node.gasMassFraction != null) inletGasFraction = node.gasMassFraction;
          if (node.waterCut != null) inletWaterCut = node.waterCut;
          if (node.temperature != null) inletTemp = node.temperature;
        } else if (node.boundaryPosition >= 0.95) {
          if (node.pressure != null) outletPressure = node.pressure;
        }
      }
    }

    const P = new Float64Array(N);
    const T = new Float64Array(N);
    const alphaG = new Float64Array(N);
    const jFace = new Float64Array(N + 1);
    const waxThickness = new Float64Array(N);

    for (let i = 0; i < N; i++) {
      const frac = i / N;
      P[i] = outletPressure + (1.0 - frac) * 30.0e5;
      T[i] = inletTemp - frac * (inletTemp - cells[i]!.ambientTemp) * 0.4;
      alphaG[i] = Math.max(0.05, Math.min(0.9, inletGasFraction * 2.0));
    }
    for (let i = 0; i <= N; i++) {
      jFace[i] = inletMassRate / (cells[0]!.area * 700.0);
    }

    states.set(fp.name, {
      flowpath: fp,
      cells,
      P,
      T,
      alphaG,
      jFace,
      waxThickness,
      inletMassRate,
      inletGasFraction,
      inletWaterCut,
      inletTemp,
      outletPressure,
      slugTracker: new SlugTracker(),
      pigTracker: new PigTracker(fp.pigs || []),
      accumulatedLiquidVolume: 0.0,
      peakLiquidSurgeVolume: 0.0,
    });
  }

  // Telemetry trackers
  const times: number[] = [];
  const junctionPressures: Record<string, number[]> = {};
  const totalProductionRateKgS: number[] = [];
  const totalLiquidSurgeVolumeM3: number[] = [];
  const totalMachineryPowerKw: number[] = [];

  const perFpSnapshots: Record<string, SpatialProfileSnapshot[]> = {};
  const perFpTrends: Record<string, any> = {};

  for (const fp of model.flowpaths) {
    perFpSnapshots[fp.name] = [];
    perFpTrends[fp.name] = {
      inletPressure: [],
      arrivalPressure: [],
      arrivalTemperature: [],
      arrivalLiquidHoldup: [],
      arrivalLiquidMassRate: [],
      accumulatedLiquidVolume: [],
      peakLiquidSurgeVolume: 0,
      meanSlugLength: [],
      slugFrequency: [],
      activeSlugsCount: [],
      pigPosition: [],
      pigVelocity: [],
      emulsionViscosity: [],
      maxWaxThickness: [],
      pumpHeadDeltaP: [],
      compressorDischargeP: [],
    };
  }

  // Identify junction nodes connecting flowpaths
  const internalJunctions = model.nodes.filter((n) => n.type === "INTERNAL");

  // Main time-stepping loop
  for (let step = 0; step <= totalSteps; step++) {
    const currentTime = step * dt;
    let stepTotalProduction = 0;
    let stepTotalLiquidSurge = 0;
    let stepTotalMachineryPower = 0;

    // 1. Manifold Junction Sync: Balance pressures and mass fluxes across merging branches
    for (const junction of internalJunctions) {
      // Find all flowpaths terminating at this junction (inflow to junction)
      const feedingStates = Array.from(states.values()).filter((st) =>
        model.nodes.some(
          (n) => n.name === junction.name && n.flowpath === st.flowpath.name && n.boundaryPosition >= 0.95,
        ),
      );

      // Find flowpath(s) starting from this junction (outflow from junction)
      const downstreamStates = Array.from(states.values()).filter((st) =>
        model.nodes.some(
          (n) => n.name === junction.name && n.flowpath === st.flowpath.name && n.boundaryPosition <= 0.05,
        ),
      );

      if (feedingStates.length > 0 && downstreamStates.length > 0) {
        let sumMassRate = 0;
        let sumGasRate = 0;
        let sumWaterRate = 0;
        let sumEnthalpyTemp = 0;
        let avgArrivalP = 0;

        for (const feed of feedingStates) {
          const N_f = feed.cells.length;
          const pArr = feed.P[N_f - 1]!;
          avgArrivalP += pArr;

          const rhoM = feed.alphaG[N_f - 1]! * 30.0 + (1.0 - feed.alphaG[N_f - 1]!) * 800.0;
          const rate = Math.abs(feed.jFace[N_f]!) * feed.cells[N_f - 1]!.area * rhoM;
          sumMassRate += rate;
          sumGasRate += rate * feed.inletGasFraction;
          sumWaterRate += rate * (1.0 - feed.inletGasFraction) * feed.inletWaterCut;
          sumEnthalpyTemp += rate * feed.T[N_f - 1]!;
        }

        avgArrivalP /= feedingStates.length;
        const netMassRate = Math.max(0.1, sumMassRate);
        const netGasFraction = Math.max(0.01, Math.min(0.99, sumGasRate / netMassRate));
        const netLiquidRate = Math.max(0.01, netMassRate - sumGasRate);
        const netWaterCut = Math.max(0.0, Math.min(1.0, sumWaterRate / netLiquidRate));
        const netTemp = sumEnthalpyTemp / netMassRate;

        // Propagate merged properties into downstream flowpaths
        for (const down of downstreamStates) {
          down.inletMassRate = netMassRate;
          down.inletGasFraction = netGasFraction;
          down.inletWaterCut = netWaterCut;
          down.inletTemp = netTemp;
        }

        if (!junctionPressures[junction.name]) junctionPressures[junction.name] = [];
        junctionPressures[junction.name]!.push(avgArrivalP);
      }
    }

    // 2. Solve 1D Drift-Flux for each individual flowpath
    for (const [fpName, state] of states.entries()) {
      const { flowpath, cells, P, T, alphaG, jFace, waxThickness } = state;
      const N = cells.length;

      // Dynamic Wellbore IPR Inflow Stepping
      if (flowpath.ipr) {
        state.inletMassRate = stepWellInflow(state.inletMassRate, flowpath.ipr, P[0]!, 0.25);
      }

      // Step cells in flowpath
      let stepMaxWax = 0;
      let stepPumpDeltaP = 0;
      let stepCompDischargeP = 0;

      for (let i = 0; i < N; i++) {
        const cell = cells[i]!;
        const fluid = evaluateCellFluidProperties(tableData, P[i]!, T[i]!, state.inletWaterCut);

        const alphaL = 1.0 - alphaG[i]!;
        const rhoM = alphaG[i]! * fluid.rhoG + alphaL * fluid.rhoL;

        const theta = Math.asin(cell.sinTheta);
        const { c0, ugj } = computeZuberFindlaySlip(alphaG[i]!, fluid.rhoG, fluid.rhoL, fluid.sigma, theta);

        const jCell = 0.5 * (jFace[i]! + jFace[i + 1]!);
        const ug = c0 * jCell + ugj;
        const muL = fluid.muL;
        const muM = alphaG[i]! * fluid.muG + alphaL * muL;

        // Check for pumps at this cell location
        if (flowpath.pumps) {
          for (const pump of flowpath.pumps) {
            if (Math.abs(cell.x - pump.position) <= cell.dx) {
              const pumpPerf = evaluatePumpBoost(pump, rhoM, alphaG[i]!, jCell * cell.area);
              stepPumpDeltaP += pumpPerf.pressureBoostPa;
              stepTotalMachineryPower += pumpPerf.powerConsumedKw;
            }
          }
        }

        // Check for compressors at this cell location
        if (flowpath.compressors) {
          for (const comp of flowpath.compressors) {
            if (Math.abs(cell.x - comp.position) <= cell.dx) {
              const compPerf = evaluateCompressorBoost(
                comp,
                P[i]!,
                T[i]!,
                alphaG[i]! * rhoM * Math.abs(jCell) * cell.area,
              );
              stepCompDischargeP = compPerf.dischargePressurePa;
              stepTotalMachineryPower += compPerf.powerConsumedKw;
            }
          }
        }

        // Friction and gravity gradients
        const vm = Math.abs(jCell);
        const re = (rhoM * vm * cell.diameter) / Math.max(1e-6, muM);
        const f = computeChurchillFriction(re, cell.roughness, cell.diameter);
        const frictionGrad = (2.0 * f * rhoM * vm * jCell) / cell.diameter;
        const gravityGrad = rhoM * 9.80665 * cell.sinTheta;

        if (i < N - 1) {
          const dxFace = 0.5 * (cell.dx + cells[i + 1]!.dx);
          const dPdx = frictionGrad + gravityGrad;
          P[i] = P[i + 1]! + dPdx * dxFace - stepPumpDeltaP * 0.05;
        } else {
          P[i] = state.outletPressure;
        }

        // Void fraction update
        const fluxGasIn =
          i === 0 ? (state.inletMassRate * state.inletGasFraction) / cell.area : alphaG[i - 1]! * fluid.rhoG * ug;
        const fluxGasOut = alphaG[i]! * fluid.rhoG * ug;
        const dAlphaGdt = -(fluxGasOut - fluxGasIn) / (cell.dx * Math.max(1.0, fluid.rhoG));
        alphaG[i] = Math.max(0.01, Math.min(0.99, alphaG[i]! + 0.1 * dt * dAlphaGdt));

        // Temperature cooldown & heat exchanger thermal duty
        const cpM = 2200.0;
        const qLoss = (4.0 * cell.uHeatTransfer * (T[i]! - cell.ambientTemp)) / cell.diameter;
        const advectionT = (rhoM * cpM * vm * (i === 0 ? T[i]! - state.inletTemp : T[i]! - T[i - 1]!)) / cell.dx;

        let qHex = 0.0;
        const cellVolume = cell.area * cell.dx;
        if (cell.heatExchangers && cell.heatExchangers.length > 0 && cellVolume > 0) {
          for (const hex of cell.heatExchangers) {
            if (hex.dutyKw !== undefined) {
              qHex += (hex.dutyKw * 1000.0) / cellVolume;
            } else if (hex.overallUa !== undefined) {
              const tSecondary = hex.ambientTemperature ?? cell.ambientTemp;
              qHex += (hex.overallUa * (tSecondary - T[i]!)) / cellVolume;
            } else if (hex.targetTemperature !== undefined) {
              const tauHex = Math.max(0.1, dt * 2.0);
              qHex += (rhoM * cpM * (hex.targetTemperature - T[i]!)) / tauHex;
            }
          }
        }

        const dTdt = -(advectionT + qLoss - qHex) / (rhoM * cpM);
        const isActivelyCooled = cell.heatExchangers?.some(
          (h) =>
            (h.dutyKw !== undefined && h.dutyKw < 0) ||
            (h.targetTemperature !== undefined && h.targetTemperature < cell.ambientTemp) ||
            (h.ambientTemperature !== undefined && h.ambientTemperature < cell.ambientTemp),
        );
        const minTempAllowed = isActivelyCooled ? 180.0 : cell.ambientTemp;
        T[i] = Math.max(minTempAllowed, T[i]! + dt * dTdt);

        // Wax layer growth
        if (flowpath.waxConfig) {
          const waxResult = evaluateWaxDeposition(
            flowpath.waxConfig,
            T[i]!,
            cell.ambientTemp,
            cell.diameter,
            jCell,
            muM,
            rhoM,
            waxThickness[i]!,
            dt,
          );
          waxThickness[i] = waxResult.waxThicknessMeters;
          if (waxThickness[i]! > stepMaxWax) stepMaxWax = waxThickness[i]!;
        }
      }

      // Arrival telemetry
      const arrivalP = P[N - 1]!;
      const arrivalT = T[N - 1]!;
      const arrivalAlphaL = 1.0 - alphaG[N - 1]!;
      const arrivalFluid = evaluateCellFluidProperties(tableData, arrivalP, arrivalT, state.inletWaterCut);
      const arrivalArea = cells[N - 1]!.area;
      const arrivalLiquidRate = arrivalAlphaL * arrivalFluid.rhoL * Math.abs(jFace[N]!) * arrivalArea;

      state.accumulatedLiquidVolume += (arrivalLiquidRate / arrivalFluid.rhoL) * dt;
      if (state.accumulatedLiquidVolume > state.peakLiquidSurgeVolume) {
        state.peakLiquidSurgeVolume = state.accumulatedLiquidVolume;
      }

      stepTotalProduction +=
        Math.abs(jFace[N]!) * arrivalArea * (alphaG[N - 1]! * arrivalFluid.rhoG + arrivalAlphaL * arrivalFluid.rhoL);
      stepTotalLiquidSurge += state.accumulatedLiquidVolume;

      // Record trends
      const tr = perFpTrends[fpName]!;
      tr.inletPressure.push(P[0]!);
      tr.arrivalPressure.push(arrivalP);
      tr.arrivalTemperature.push(arrivalT);
      tr.arrivalLiquidHoldup.push(arrivalAlphaL);
      tr.arrivalLiquidMassRate.push(arrivalLiquidRate);
      tr.accumulatedLiquidVolume.push(state.accumulatedLiquidVolume);
      tr.peakLiquidSurgeVolume = state.peakLiquidSurgeVolume;
      tr.maxWaxThickness.push(stepMaxWax);
      tr.pumpHeadDeltaP.push(stepPumpDeltaP);
      tr.compressorDischargeP.push(stepCompDischargeP);

      // Record spatial snapshot
      if (step % snapshotInterval === 0 || step === totalSteps) {
        const xArr: number[] = [];
        const elevArr: number[] = [];
        const pArr: number[] = [];
        const tArr: number[] = [];
        const holdupArr: number[] = [];
        const ugArr: number[] = [];
        const ulArr: number[] = [];
        const regArr: string[] = [];
        const waxArr: number[] = [];
        const sandRiskArr: boolean[] = [];

        for (let i = 0; i < N; i++) {
          const cell = cells[i]!;
          const fluid = evaluateCellFluidProperties(tableData, P[i]!, T[i]!, state.inletWaterCut);
          const theta = Math.asin(cell.sinTheta);
          const { c0, ugj } = computeZuberFindlaySlip(alphaG[i]!, fluid.rhoG, fluid.rhoL, fluid.sigma, theta);
          const jVal = 0.5 * (jFace[i]! + jFace[i + 1]!);
          const ug = c0 * jVal + ugj;
          const al = 1.0 - alphaG[i]!;
          const ul = al > 0.01 ? (jVal - alphaG[i]! * ug) / al : jVal;

          const reg = classifyFlowRegime({
            diameter: cell.diameter,
            inclinationRad: theta,
            superficialGasVelocity: Math.max(0.01, alphaG[i]! * ug),
            superficialLiquidVelocity: Math.max(0.01, al * Math.abs(ul)),
            rhoGas: fluid.rhoG,
            rhoLiquid: fluid.rhoL,
            muGas: fluid.muG,
            muLiquid: fluid.muL,
            roughness: cell.roughness,
          });

          const sandRes = evaluateSandTransport(
            flowpath.sandConfig,
            jVal,
            fluid.rhoL,
            fluid.muL,
            alphaG[i]! * fluid.rhoG + al * fluid.rhoL,
            cell.diameter,
          );

          xArr.push(cell.x);
          elevArr.push(cell.x * cell.sinTheta);
          pArr.push(P[i]!);
          tArr.push(T[i]!);
          holdupArr.push(al);
          ugArr.push(ug);
          ulArr.push(ul);
          regArr.push(reg.regime);
          waxArr.push(waxThickness[i]!);
          sandRiskArr.push(sandRes.isDroppingOut);
        }

        perFpSnapshots[fpName]!.push({
          time: currentTime,
          x: xArr,
          elevation: elevArr,
          pressure: pArr,
          temperature: tArr,
          liquidHoldup: holdupArr,
          gasVelocity: ugArr,
          liquidVelocity: ulArr,
          flowRegimes: regArr,
          waxThickness: waxArr,
          sandDropoutRisk: sandRiskArr,
        });
      }
    }

    times.push(currentTime);
    totalProductionRateKgS.push(stepTotalProduction);
    totalLiquidSurgeVolumeM3.push(stepTotalLiquidSurge);
    totalMachineryPowerKw.push(stepTotalMachineryPower);
  }

  const flowpathResults: Record<string, OlgaSimulationResult> = {};
  for (const fp of model.flowpaths) {
    flowpathResults[fp.name] = {
      times,
      profiles: perFpSnapshots[fp.name]!,
      trends: perFpTrends[fp.name]!,
    };
  }

  return {
    times,
    flowpathResults,
    junctionPressures,
    totalProductionRateKgS,
    totalLiquidSurgeVolumeM3,
    totalMachineryPowerKw,
  };
}
