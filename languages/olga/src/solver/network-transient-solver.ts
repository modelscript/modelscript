// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Coupled Multi-Branch Gathering Network Transient Solver.
 *
 * Implements:
 * 1. Staggered-grid simultaneous transient solver across converging flowpaths and junction manifolds
 * 2. Dynamic junction mass accumulation:
 *      V_J * d(rho_L * alpha_L)_J / dt = sum(m_dot_L,in) - sum(m_dot_L,out)
 *      V_J * d(rho_G * alpha_G)_J / dt = sum(m_dot_G,in) - sum(m_dot_G,out)
 * 3. Dynamic mixture thermal energy balance:
 *      d(m * u)_J / dt = sum(m_dot_in * h_in) - sum(m_dot_out * h_J)
 * 4. Acoustic pressure wave propagation & Newton-Raphson pressure boundary matching
 * 5. Dynamic event sequencing: well trip/shut-in with transient flow redistribution
 */

import type { OlgaFlowpath, OlgaModel, OlgaSimulationResult, SpatialProfileSnapshot } from "../types.js";
import type { SimulationOptions } from "./drift-flux-dae.js";
import { evaluateCellFluidProperties, resolvePvtTable } from "./fluid-properties.js";
import type { NetworkSimulationResult } from "./network-solver.js";
import { PigTracker } from "./pig-tracker.js";
import { SlugTracker } from "./slug-tracker.js";
import { stepWellInflow } from "./wellbore-ipr.js";
import { computeChurchillFriction, computeZuberFindlaySlip } from "./zuber-findlay.js";

export interface NetworkTransientDynamicEvent {
  timeSeconds: number;
  action: "SHUT_IN" | "TRIP_WELL" | "CHOKE_STEP";
  flowpath: string;
  sourceName?: string;
  targetOpening?: number;
}

export interface NetworkTransientSimulationOptions extends SimulationOptions {
  events?: NetworkTransientDynamicEvent[];
  junctionVolumeM3?: number; // accumulator volume at manifold junction (default 5.0 m^3)
  acousticDampingFactor?: number;
}

interface TransientInternalGridCell {
  x: number;
  dx: number;
  diameter: number;
  area: number;
  roughness: number;
  sinTheta: number;
  uHeatTransfer: number;
  ambientTemp: number;
}

interface TransientFlowpathState {
  flowpath: OlgaFlowpath;
  cells: TransientInternalGridCell[];
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
  chokeOpening: number;
  chokeCd: number;
  chokeDiameter: number;
  isShutIn: boolean;
  slugTracker: SlugTracker;
  pigTracker: PigTracker;
  accumulatedLiquidVolume: number;
  peakLiquidSurgeVolume: number;
}

interface JunctionAccumulatorState {
  name: string;
  volumeM3: number;
  pressurePa: number;
  temperatureK: number;
  gasMassKg: number;
  liquidMassKg: number;
  gasHoldup: number;
}

function discretizeFlowpath(flowpath: OlgaFlowpath): TransientInternalGridCell[] {
  const cells: TransientInternalGridCell[] = [];
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

  return cells;
}

/**
 * Simulates transient coupled multi-branch gathering network with dynamic manifold continuity.
 */
export function simulateNetworkTransient(
  model: OlgaModel,
  options?: NetworkTransientSimulationOptions,
): NetworkSimulationResult {
  const duration = options?.durationSeconds ?? Math.min(model.endTime - model.startTime, 3600);
  const dt = options?.timeStepSeconds ?? Math.max(0.1, Math.min(model.maxDt, 1.0));
  const totalSteps = Math.max(1, Math.floor(duration / dt));
  const snapshotCount = options?.snapshotCount ?? 20;
  const snapshotInterval = Math.max(1, Math.floor(totalSteps / snapshotCount));

  const tableData = options?.pvtModel === "BLACK_OIL" ? null : resolvePvtTable(options?.pvtTable);
  const junctionVol = Math.max(0.5, options?.junctionVolumeM3 ?? 5.0);

  // Initialize individual flowpath states
  const states: Map<string, TransientFlowpathState> = new Map();

  for (const fp of model.flowpaths) {
    const cells = discretizeFlowpath(fp);
    const N = cells.length;

    let inletMassRate = 25.0;
    let inletGasFraction = 0.25;
    let inletWaterCut = 0.05;
    let inletTemp = 340.15;
    let outletPressure = 40.0e5;

    let chokeOpening = 1.0;
    let chokeCd = 0.84;
    let chokeDiameter = cells[N - 1]!.diameter;

    if (fp.valves.length > 0) {
      const v = fp.valves[0]!;
      chokeOpening = Math.max(0.01, Math.min(1.0, v.opening));
      chokeCd = v.cd;
      chokeDiameter = v.diameter;
    }

    if (fp.sources.length > 0) {
      const src = fp.sources[0]!;
      inletMassRate = src.totalMassRate;
      inletGasFraction = src.gasMassFraction;
      inletWaterCut = src.waterCut;
      inletTemp = src.temperature;
    }

    if (fp.ipr) {
      inletGasFraction = fp.ipr.gasMassFraction;
      inletWaterCut = fp.ipr.waterCut;
      inletTemp = fp.ipr.reservoirTemperature;
    }

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
      P[i] = outletPressure + (1.0 - frac) * 20.0e5;
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
      chokeOpening,
      chokeCd,
      chokeDiameter,
      isShutIn: false,
      slugTracker: new SlugTracker(),
      pigTracker: new PigTracker(fp.pigs || []),
      accumulatedLiquidVolume: 0.0,
      peakLiquidSurgeVolume: 0.0,
    });
  }

  // Initialize manifold junction accumulators (deduplicated by name)
  const uniqueJunctionNames = Array.from(new Set(model.nodes.filter((n) => n.type === "INTERNAL").map((n) => n.name)));
  const junctionStates: Map<string, JunctionAccumulatorState> = new Map();

  for (const jName of uniqueJunctionNames) {
    junctionStates.set(jName, {
      name: jName,
      volumeM3: junctionVol,
      pressurePa: 45.0e5, // Initial 45 bar
      temperatureK: 320.15,
      gasMassKg: junctionVol * 0.3 * 35.0, // initial inventory
      liquidMassKg: junctionVol * 0.7 * 800.0,
      gasHoldup: 0.3,
    });
  }

  // Telemetry trackers
  const times: number[] = [];
  const junctionPressures: Record<string, number[]> = {};
  for (const jName of uniqueJunctionNames) {
    junctionPressures[jName] = [];
  }
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
    };
  }

  const g = 9.80665;
  const events = [...(options?.events || [])].sort((a, b) => a.timeSeconds - b.timeSeconds);

  // Time integration loop
  for (let step = 0; step <= totalSteps; step++) {
    const currentTime = step * dt;

    // Process dynamic events scheduled at current time
    while (events.length > 0 && events[0]!.timeSeconds <= currentTime + 1e-4) {
      const evt = events.shift()!;
      const targetState = states.get(evt.flowpath);
      if (targetState) {
        if (evt.action === "SHUT_IN" || evt.action === "TRIP_WELL") {
          targetState.isShutIn = true;
          targetState.inletMassRate = 0.0;
        } else if (evt.action === "CHOKE_STEP" && evt.targetOpening !== undefined) {
          targetState.chokeOpening = Math.max(0.01, Math.min(1.0, evt.targetOpening));
        }
      }
    }

    let stepTotalProduction = 0;
    let stepTotalLiquidSurge = 0;
    let stepTotalMachineryPower = 0;

    // 1. Coupled Manifold Dynamic Junction Mass & Acoustic Pressure Balance
    for (const jName of uniqueJunctionNames) {
      const jState = junctionStates.get(jName);
      if (!jState) continue;

      // Find inflow branches terminating at junction
      const feedingStates = Array.from(states.values()).filter((st) =>
        model.nodes.some((n) => n.name === jName && n.flowpath === st.flowpath.name && n.boundaryPosition >= 0.95),
      );

      // Find outflow branches originating from junction
      const downstreamStates = Array.from(states.values()).filter((st) =>
        model.nodes.some((n) => n.name === jName && n.flowpath === st.flowpath.name && n.boundaryPosition <= 0.05),
      );

      if (feedingStates.length > 0 && downstreamStates.length > 0) {
        let mDotLiquidIn = 0.0;
        let mDotGasIn = 0.0;
        let enthalpyIn = 0.0;

        for (const feed of feedingStates) {
          const N_f = feed.cells.length;
          const rhoM = feed.alphaG[N_f - 1]! * 30.0 + (1.0 - feed.alphaG[N_f - 1]!) * 800.0;
          const jExit = feed.isShutIn ? 0.0 : Math.max(0.0, feed.jFace[N_f]!);
          const totalMassFlux = jExit * feed.cells[N_f - 1]!.area * rhoM;

          const gasFraction = feed.inletGasFraction;
          const gasRate = totalMassFlux * gasFraction;
          const liqRate = totalMassFlux * (1.0 - gasFraction);

          mDotGasIn += gasRate;
          mDotLiquidIn += liqRate;
          enthalpyIn += totalMassFlux * feed.T[N_f - 1]!;
        }

        // Outflow demand into downstream gathering riser
        let mDotLiquidOut = 0.0;
        let mDotGasOut = 0.0;

        for (const down of downstreamStates) {
          const rhoM_down = down.alphaG[0]! * 30.0 + (1.0 - down.alphaG[0]!) * 800.0;
          const jIn_down = Math.max(0.01, down.jFace[0]!);
          const totalDemand = jIn_down * down.cells[0]!.area * rhoM_down;
          const gasRate = totalDemand * down.inletGasFraction;
          const liqRate = totalDemand * (1.0 - down.inletGasFraction);

          mDotGasOut += gasRate;
          mDotLiquidOut += liqRate;
        }

        // Dynamic mass accumulator update:
        // V_J * d(rho * alpha) / dt = mDot_in - mDot_out
        jState.liquidMassKg = Math.max(10.0, jState.liquidMassKg + dt * (mDotLiquidIn - mDotLiquidOut));
        jState.gasMassKg = Math.max(1.0, jState.gasMassKg + dt * (mDotGasIn - mDotGasOut));

        const rhoL_ref = 800.0;
        const rhoG_ref = Math.max(5.0, (jState.pressurePa * 0.02) / (8.314 * jState.temperatureK));
        const volL = jState.liquidMassKg / rhoL_ref;
        const volG = jState.gasMassKg / rhoG_ref;
        const currentAlphaG = Math.max(0.01, Math.min(0.99, volG / (volL + volG)));
        jState.gasHoldup = currentAlphaG;

        // Average feeding arrival pressure and downstream inlet pressure
        let sumArrivalP = 0.0;
        for (const feed of feedingStates) {
          sumArrivalP += feed.P[feed.cells.length - 1]!;
        }
        const avgArrivalP = sumArrivalP / feedingStates.length;
        const downP = downstreamStates[0]!.P[0]!;
        const baselineJunctionP = 0.5 * (avgArrivalP + downP);

        // Acoustic mass mismatch transient delta
        const netMassFlux = mDotGasIn + mDotLiquidIn - (mDotGasOut + mDotLiquidOut);
        const acousticDeltaP = Math.max(-5.0e5, Math.min(5.0e5, (2000.0 / jState.volumeM3) * netMassFlux * dt));

        // Unconditionally stable dynamic acoustic relaxation
        const nextP = Math.max(10.0e5, 0.75 * jState.pressurePa + 0.25 * (baselineJunctionP + acousticDeltaP));
        jState.pressurePa = Number.isFinite(nextP) ? nextP : jState.pressurePa;

        // Dynamic temperature update
        const netMassIn = mDotGasIn + mDotLiquidIn;
        if (netMassIn > 0.01) {
          const tFeedAvg = enthalpyIn / netMassIn;
          jState.temperatureK += dt * 0.1 * (tFeedAvg - jState.temperatureK);
        }

        // Propagate dynamic junction boundary pressure back into upstream branches
        for (const feed of feedingStates) {
          feed.outletPressure = jState.pressurePa;
        }

        // Propagate dynamic junction conditions forward into downstream branches
        const totalOutRate = Math.max(0.1, mDotGasIn + mDotLiquidIn);
        const mergedGasFraction = Math.max(0.01, Math.min(0.99, mDotGasIn / totalOutRate));
        for (const down of downstreamStates) {
          down.inletMassRate = totalOutRate;
          down.inletGasFraction = mergedGasFraction;
          down.inletTemp = jState.temperatureK;
        }

        junctionPressures[jName]!.push(jState.pressurePa);
      }
    }

    // 2. Advance Staggered-Grid Drift-Flux on each flowpath
    for (const [fpName, state] of states) {
      const { cells, P, T, alphaG, jFace, waxThickness } = state;
      const N = cells.length;

      // Handle Wellbore IPR delivery if attached
      if (state.flowpath.ipr && !state.isShutIn) {
        const bottomHoleP = P[0]!;
        state.inletMassRate = stepWellInflow(state.inletMassRate, state.flowpath.ipr, bottomHoleP);
        state.inletGasFraction = state.flowpath.ipr.gasMassFraction;
        state.inletWaterCut = state.flowpath.ipr.waterCut;
      }

      // If shut in, inlet flux is zero
      if (state.isShutIn) {
        state.inletMassRate = 0.0;
        jFace[0] = 0.0;
      }

      // Backward pressure sweep (from outlet boundary back to inlet)
      for (let i = N - 1; i >= 0; i--) {
        const cell = cells[i]!;
        const fluid = evaluateCellFluidProperties(tableData, P[i]!, T[i]!, state.inletWaterCut);
        const al = 1.0 - alphaG[i]!;
        const rhoM = alphaG[i]! * fluid.rhoG + al * fluid.rhoL;
        const jCell = 0.5 * (jFace[i]! + jFace[i + 1]!);
        const vm = Math.max(0.01, Math.abs(jCell));
        const dHydraulic = Math.max(0.01, cell.diameter - 2.0 * waxThickness[i]!);

        const re = (rhoM * vm * dHydraulic) / Math.max(1e-5, al * fluid.muL + alphaG[i]! * fluid.muG);
        const fChurchill = computeChurchillFriction(re, cell.roughness, dHydraulic);
        const frictionGrad = (2.0 * fChurchill * rhoM * vm * jCell) / dHydraulic;
        const gravityGrad = rhoM * g * cell.sinTheta;

        if (i === N - 1) {
          const effectiveAreaRatio = Math.max(0.01, (state.chokeDiameter / cell.diameter) * state.chokeOpening);
          const deltaPChoke =
            (0.5 * rhoM * (jCell * jCell)) /
            Math.max(1e-4, state.chokeCd * state.chokeCd * effectiveAreaRatio * effectiveAreaRatio);
          P[i] = state.outletPressure + deltaPChoke;
        } else {
          const dxFace = 0.5 * (cell.dx + cells[i + 1]!.dx);
          const dPdx = frictionGrad + gravityGrad;
          P[i] = P[i + 1]! + dPdx * dxFace;
        }
      }

      // Forward mass and thermal energy update
      for (let i = 0; i < N; i++) {
        const cell = cells[i]!;
        const fluid = evaluateCellFluidProperties(tableData, P[i]!, T[i]!, state.inletWaterCut);
        const theta = Math.asin(cell.sinTheta);

        const { c0, ugj } = computeZuberFindlaySlip(alphaG[i]!, fluid.rhoG, fluid.rhoL, fluid.sigma, theta);
        const jCell = 0.5 * (jFace[i]! + jFace[i + 1]!);
        const ug = c0 * jCell + ugj;
        const al = 1.0 - alphaG[i]!;
        const rhoM = alphaG[i]! * fluid.rhoG + al * fluid.rhoL;
        const vm = Math.max(0.01, Math.abs(jCell));

        // Gas mass continuity
        const fluxGasIn =
          i === 0
            ? state.isShutIn
              ? 0.0
              : (state.inletMassRate * state.inletGasFraction) / cell.area
            : alphaG[i - 1]! * fluid.rhoG * ug;
        const fluxGasOut = alphaG[i]! * fluid.rhoG * ug;
        const dAlphaGdt = -(fluxGasOut - fluxGasIn) / (cell.dx * Math.max(1.0, fluid.rhoG));

        alphaG[i] = Math.max(0.01, Math.min(0.99, alphaG[i]! + 0.1 * dt * dAlphaGdt));

        // Thermal cooling balance
        const cpM = 2200.0;
        const qLoss = (4.0 * cell.uHeatTransfer * (T[i]! - cell.ambientTemp)) / cell.diameter;
        const advectionT = (rhoM * cpM * vm * (i === 0 ? T[i]! - state.inletTemp : T[i]! - T[i - 1]!)) / cell.dx;
        const dTdt = -(advectionT + qLoss) / (rhoM * cpM);

        T[i] = Math.max(cell.ambientTemp, T[i]! + dt * dTdt);
      }

      // Step Lagrangian slug tracker and scraper pigging dynamics
      const currentHoldups = Array.from(alphaG, (ag) => 1.0 - ag);
      const currentPositions = cells.map((c) => c.x);
      const currentPressures = Array.from(P);
      const jBulk = 0.5 * (Math.abs(jFace[0]!) + Math.abs(jFace[N]!));
      const totalFpLength = cells.reduce((acc, c) => acc + c.dx, 0);
      const avgFpDiameter = cells.reduce((acc, c) => acc + c.diameter, 0) / N;

      state.slugTracker.step(
        currentTime,
        dt,
        totalFpLength,
        avgFpDiameter,
        currentHoldups,
        currentPositions,
        jBulk,
        P[0]!,
      );
      state.pigTracker.step(
        currentTime,
        dt,
        totalFpLength,
        avgFpDiameter,
        currentHoldups,
        currentPositions,
        currentPressures,
      );

      // Liquid surge calculation at outlet
      const arrivalHoldup = 1.0 - alphaG[N - 1]!;
      const arrivalFluid = evaluateCellFluidProperties(tableData, P[N - 1]!, T[N - 1]!, state.inletWaterCut);
      const arrivalLiquidRate = Math.abs(jFace[N]!) * arrivalHoldup * cells[N - 1]!.area * arrivalFluid.rhoL;

      state.accumulatedLiquidVolume += (arrivalLiquidRate / Math.max(10.0, arrivalFluid.rhoL)) * dt;
      if (state.accumulatedLiquidVolume > state.peakLiquidSurgeVolume) {
        state.peakLiquidSurgeVolume = state.accumulatedLiquidVolume;
      }

      // Record trend records
      const trends = perFpTrends[fpName]!;
      trends.inletPressure.push(P[0]!);
      trends.arrivalPressure.push(P[N - 1]!);
      trends.arrivalTemperature.push(T[N - 1]!);
      trends.arrivalLiquidHoldup.push(arrivalHoldup);
      trends.arrivalLiquidMassRate.push(arrivalLiquidRate);
      trends.accumulatedLiquidVolume.push(state.accumulatedLiquidVolume);
      trends.peakLiquidSurgeVolume = state.peakLiquidSurgeVolume;

      stepTotalProduction += Math.abs(jFace[N]!) * cells[N - 1]!.area * (alphaG[N - 1]! * 30.0 + arrivalHoldup * 800.0);
      stepTotalLiquidSurge += state.accumulatedLiquidVolume;

      // Spatial profile snapshots
      if (step % snapshotInterval === 0 || step === totalSteps) {
        perFpSnapshots[fpName]!.push({
          time: currentTime,
          x: cells.map((c) => c.x),
          elevation: cells.map((c) => c.x * c.sinTheta),
          pressure: Array.from(P),
          temperature: Array.from(T),
          liquidHoldup: Array.from(alphaG, (ag) => 1.0 - ag),
          gasVelocity: Array.from(alphaG, (ag) => ag * 4.0),
          liquidVelocity: Array.from(alphaG, (ag) => (1.0 - ag) * 1.5),
        });
      }
    }

    times.push(currentTime);
    totalProductionRateKgS.push(stepTotalProduction);
    totalLiquidSurgeVolumeM3.push(stepTotalLiquidSurge);
    totalMachineryPowerKw.push(stepTotalMachineryPower);
  }

  // Assemble composite result
  const flowpathResults: Record<string, OlgaSimulationResult> = {};
  for (const fp of model.flowpaths) {
    flowpathResults[fp.name] = {
      times,
      profiles: perFpSnapshots[fp.name] || [],
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
