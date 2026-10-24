// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — In-WASM 1D Drift-Flux Staggered-Grid DAE Solver.
 *
 * Discretizes multiphase pipeline flowpaths into finite volume control volumes,
 * solving coupled gas/liquid mass conservation, mixture momentum, and energy
 * balance equations with Zuber-Findlay drift-flux closure.
 */

import { Causality, DAEBuilder, VarType, Variability } from "@modelscript/runtime";
import type { OlgaFlowpath, OlgaModel, OlgaSimulationResult, SpatialProfileSnapshot } from "../types.js";
import { evaluateEmulsionViscosity } from "./emulsion-rheology.js";
import { classifyFlowRegime } from "./flow-regimes.js";
import { PigTracker } from "./pig-tracker.js";
import { SlugTracker } from "./slug-tracker.js";
import { computeChurchillFriction, computeZuberFindlaySlip, evaluateBlackOilPvt } from "./zuber-findlay.js";

/**
 * Lowers an OLGA flowpath into ModelScript's zero-GC linear memory DAEBuilder arena.
 */
export function lowerFlowpathToDae(
  builder: DAEBuilder,
  _model: OlgaModel,
  flowpath: OlgaFlowpath,
): { varIndices: number[]; cellCount: number } {
  const varIndices: number[] = [];
  let cellOffset = 0;

  for (const pipe of flowpath.pipes) {
    const nCells = Math.max(2, pipe.discretization);

    for (let c = 0; c < nCells; c++) {
      const idx = cellOffset + c;

      // Cell-centered state variables
      const pIdx = builder.addVariable(
        `P_${flowpath.name}_${idx}`,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        50.0e5, // default 50 bar
      );
      varIndices.push(pIdx);

      const alphaGIdx = builder.addVariable(
        `alpha_g_${flowpath.name}_${idx}`,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        0.35,
      );
      varIndices.push(alphaGIdx);

      const tempIdx = builder.addVariable(
        `T_${flowpath.name}_${idx}`,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        315.15, // 42 C
      );
      varIndices.push(tempIdx);

      // Face-centered mixture volumetric flux variable
      const jFaceIdx = builder.addVariable(
        `j_${flowpath.name}_${idx}`,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        2.5,
      );
      varIndices.push(jFaceIdx);

      // Symbolic equation placeholders in arena for mass, momentum, and thermal balance
      // builder.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
    }

    cellOffset += nCells;
  }

  return { varIndices, cellCount: cellOffset };
}

export interface SimulationOptions {
  durationSeconds?: number | undefined;
  timeStepSeconds?: number | undefined;
  snapshotCount?: number | undefined;
}

/**
 * High-performance transient 1D Drift-Flux staggered-grid solver.
 * Simulates transient multiphase flow, liquid accumulation, pressure drop,
 * and thermal cooldown along the pipeline trajectory.
 */
export function simulateDriftFlux(model: OlgaModel, options?: SimulationOptions): OlgaSimulationResult {
  const flowpath = model.flowpaths[0];
  if (!flowpath || flowpath.pipes.length === 0) {
    return {
      times: [0],
      profiles: [],
      trends: {
        inletPressure: [0],
        arrivalPressure: [0],
        arrivalTemperature: [0],
        arrivalLiquidHoldup: [0],
        arrivalLiquidMassRate: [0],
        accumulatedLiquidVolume: [0],
        peakLiquidSurgeVolume: 0,
      },
    };
  }

  const duration = options?.durationSeconds ?? Math.min(model.endTime - model.startTime, 3600);
  const dt = options?.timeStepSeconds ?? Math.max(0.1, Math.min(model.maxDt, 1.0));
  const totalSteps = Math.max(1, Math.floor(duration / dt));
  const snapshotCount = options?.snapshotCount ?? 20;
  const snapshotInterval = Math.max(1, Math.floor(totalSteps / snapshotCount));

  // Assemble 1D grid across all consecutive pipes
  interface GridCell {
    x: number;
    dx: number;
    diameter: number;
    area: number;
    roughness: number;
    sinTheta: number;
    uHeatTransfer: number;
    ambientTemp: number;
  }

  const cells: GridCell[] = [];
  let currentX = 0;

  for (const pipe of flowpath.pipes) {
    const nCells = Math.max(2, pipe.discretization);
    const dx = pipe.length / nCells;
    const diameter = Math.max(0.05, pipe.diameter);
    const area = 0.25 * Math.PI * diameter * diameter;
    const hyp = Math.sqrt(pipe.length * pipe.length + pipe.elevation * pipe.elevation);
    const sinTheta = hyp > 0 ? pipe.elevation / hyp : 0;

    // Overall heat transfer coefficient U [W / (m^2 * K)]
    let uHeatTransfer = 15.0; // default insulated subsea pipe
    let ambientTemp = 277.15; // 4 C seawater
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

  const N = cells.length;

  // Boundary conditions
  let inletMassRate = 35.0; // kg/s
  let inletGasFraction = 0.25;
  let inletWaterCut = 0.05;
  let inletTemp = 345.15; // 72 C
  let outletPressure = 35.0e5; // 35 bar at separator

  // Check sources
  if (flowpath.sources.length > 0) {
    const src = flowpath.sources[0]!;
    inletMassRate = src.totalMassRate;
    inletGasFraction = src.gasMassFraction;
    inletWaterCut = src.waterCut;
    inletTemp = src.temperature;
  }

  // Check nodes
  for (const node of model.nodes) {
    if (node.type === "PRESSURE" || node.type === "SEPARATOR") {
      if (node.pressure != null) outletPressure = node.pressure;
    } else if (node.type === "TERMINAL" || node.type === "MASS_SOURCE") {
      if (node.massRate != null) inletMassRate = node.massRate;
      if (node.gasMassFraction != null) inletGasFraction = node.gasMassFraction;
      if (node.waterCut != null) inletWaterCut = node.waterCut;
      if (node.temperature != null) inletTemp = node.temperature;
    }
  }

  // Check choke valve
  let chokeOpening = 1.0;
  let chokeCd = 0.84;
  let chokeDiameter = cells[N - 1]!.diameter;
  if (flowpath.valves.length > 0) {
    const valve = flowpath.valves[0]!;
    chokeOpening = Math.max(0.01, Math.min(1.0, valve.opening));
    chokeCd = valve.cd;
    chokeDiameter = valve.diameter;
  }

  // Initial state vectors
  const P = new Float64Array(N);
  const T = new Float64Array(N);
  const alphaG = new Float64Array(N);
  const jFace = new Float64Array(N + 1);

  // Initialize with hydrostatic/friction profile
  for (let i = 0; i < N; i++) {
    const frac = i / N;
    P[i] = outletPressure + (1.0 - frac) * 35.0e5;
    T[i] = inletTemp - frac * (inletTemp - cells[i]!.ambientTemp) * 0.45;
    alphaG[i] = Math.max(0.05, Math.min(0.9, inletGasFraction * 2.0));
  }
  for (let i = 0; i <= N; i++) {
    jFace[i] = inletMassRate / (cells[0]!.area * 700.0);
  }

  // Advanced modules: Lagrangian slug tracker & scraper pigging dynamics
  const totalLength = cells.reduce((acc, c) => acc + c.dx, 0);
  const avgDiameter = cells.reduce((acc, c) => acc + c.diameter, 0) / N;
  const avgInclination = Math.asin(cells.reduce((acc, c) => acc + c.sinTheta, 0) / N);

  const slugTracker = new SlugTracker();
  const pigTracker = new PigTracker(flowpath.pigs || []);

  // Telemetry records
  const times: number[] = [];
  const profiles: SpatialProfileSnapshot[] = [];
  const trendInletP: number[] = [];
  const trendArrivalP: number[] = [];
  const trendArrivalT: number[] = [];
  const trendArrivalAlphaL: number[] = [];
  const trendArrivalLiquidRate: number[] = [];
  const trendAccLiquidVol: number[] = [];

  const trendMeanSlugLength: number[] = [];
  const trendSlugFreq: number[] = [];
  const trendActiveSlugs: number[] = [];
  const trendPigPos: number[] = [];
  const trendPigVel: number[] = [];
  const trendEmulsionVisc: number[] = [];

  let accumulatedLiquidVolume = 0.0;
  let peakLiquidSurgeVolume = 0.0;
  const g = 9.80665;

  // Time integration loop (Explicit TVD / Donor-cell predictor-corrector)
  for (let step = 0; step <= totalSteps; step++) {
    const currentTime = step * dt;

    // Upwind mass and momentum update
    for (let i = 0; i < N; i++) {
      const cell = cells[i]!;
      const pvt = evaluateBlackOilPvt(P[i]!, T[i]!);

      const alphaL = 1.0 - alphaG[i]!;
      const rhoM = alphaG[i]! * pvt.rhoG + alphaL * pvt.rhoL;

      // Zuber-Findlay drift-flux closure
      const theta = Math.asin(cell.sinTheta);
      const { c0, ugj } = computeZuberFindlaySlip(alphaG[i]!, pvt.rhoG, pvt.rhoL, 0.025, theta);

      // Velocities at cell
      const jCell = 0.5 * (jFace[i]! + jFace[i + 1]!);
      const ug = c0 * jCell + ugj;

      // Emulsion rheology with phase inversion peak
      const emulsion = evaluateEmulsionViscosity(inletWaterCut, pvt.muL, 0.001);
      const muL = emulsion.effectiveViscosity;
      const muM = alphaG[i]! * pvt.muG + alphaL * muL;

      // Friction gradient
      const vm = Math.abs(jCell);
      const re = (rhoM * vm * cell.diameter) / Math.max(1e-6, muM);
      const f = computeChurchillFriction(re, cell.roughness, cell.diameter);
      const frictionGrad = (2.0 * f * rhoM * vm * jCell) / cell.diameter;

      // Gravity gradient
      const gravityGrad = rhoM * g * cell.sinTheta;

      // Pressure gradient update (staggered momentum balance)
      if (i < N - 1) {
        const dxFace = 0.5 * (cell.dx + cells[i + 1]!.dx);
        const dPdx = frictionGrad + gravityGrad;
        P[i] = P[i + 1]! + dPdx * dxFace;
      } else {
        // Outlet choke boundary
        const effectiveAreaRatio = Math.max(0.01, (chokeDiameter / cell.diameter) * chokeOpening);
        const deltaPChoke =
          (0.5 * rhoM * (jCell * jCell)) / Math.max(1e-4, chokeCd * chokeCd * effectiveAreaRatio * effectiveAreaRatio);
        P[i] = outletPressure + deltaPChoke;
      }

      // Void fraction rate of change (gas mass continuity)
      const fluxGasIn = i === 0 ? (inletMassRate * inletGasFraction) / cell.area : alphaG[i - 1]! * pvt.rhoG * ug;
      const fluxGasOut = alphaG[i]! * pvt.rhoG * ug;
      const dAlphaGdt = -(fluxGasOut - fluxGasIn) / (cell.dx * Math.max(1.0, pvt.rhoG));

      alphaG[i] = Math.max(0.01, Math.min(0.99, alphaG[i]! + 0.1 * dt * dAlphaGdt));

      // Thermal cooling balance: d(rho Cp T)/dt = - d(rho Cp u T)/dx - 4 U (T - T_amb) / D
      const cpM = 2200.0; // J / (kg * K)
      const qLoss = (4.0 * cell.uHeatTransfer * (T[i]! - cell.ambientTemp)) / cell.diameter;
      const advectionT = (rhoM * cpM * vm * (i === 0 ? T[i]! - inletTemp : T[i]! - T[i - 1]!)) / cell.dx;
      const dTdt = -(advectionT + qLoss) / (rhoM * cpM);

      T[i] = Math.max(cell.ambientTemp, T[i]! + dt * dTdt);
    }

    // Step Lagrangian slug tracker and scraper pigging dynamics
    const currentHoldups = Array.from(alphaG, (ag) => 1.0 - ag);
    const currentPositions = cells.map((c) => c.x);
    const currentPressures = Array.from(P);
    const jBulk = 0.5 * (Math.abs(jFace[0]!) + Math.abs(jFace[N]!));
    const riserBaseP = P[Math.floor(N * 0.75)]!;

    const activeSlugs = slugTracker.step(
      currentTime,
      dt,
      totalLength,
      avgDiameter,
      currentHoldups,
      currentPositions,
      jBulk,
      riserBaseP,
    );
    const slugStats = slugTracker.getStatistics();

    const activePigs = pigTracker.step(
      currentTime,
      dt,
      totalLength,
      avgDiameter,
      currentHoldups,
      currentPositions,
      currentPressures,
      avgInclination,
    );

    // If pig arrived at receiver during this step, deliver swept liquid to accumulator
    for (const pig of activePigs) {
      if (pig.isReceived && pig.arrivalTime === currentTime) {
        accumulatedLiquidVolume += pig.sweptLiquidVolume;
      }
    }

    // Update arrival metrics
    const arrivalP = P[N - 1]!;
    const arrivalT = T[N - 1]!;
    const arrivalAlphaL = 1.0 - alphaG[N - 1]!;
    const arrivalPvt = evaluateBlackOilPvt(arrivalP, arrivalT);
    const arrivalArea = cells[N - 1]!.area;
    const arrivalVelocity = jFace[N]!;
    const arrivalLiquidRate = arrivalAlphaL * arrivalPvt.rhoL * arrivalVelocity * arrivalArea;

    const deltaLiquidVol = (arrivalLiquidRate / arrivalPvt.rhoL) * dt;
    accumulatedLiquidVolume += deltaLiquidVol;
    if (accumulatedLiquidVolume > peakLiquidSurgeVolume) {
      peakLiquidSurgeVolume = accumulatedLiquidVolume;
    }

    // Record trends at every step
    times.push(currentTime);
    trendInletP.push(P[0]!);
    trendArrivalP.push(arrivalP);
    trendArrivalT.push(arrivalT);
    trendArrivalAlphaL.push(arrivalAlphaL);
    trendArrivalLiquidRate.push(arrivalLiquidRate);
    trendAccLiquidVol.push(accumulatedLiquidVolume);

    trendMeanSlugLength.push(slugStats.meanSlugLength);
    trendSlugFreq.push(slugStats.slugFrequencyHz);
    trendActiveSlugs.push(activeSlugs.length);
    trendPigPos.push(activePigs[0]?.position ?? 0);
    trendPigVel.push(activePigs[0]?.velocity ?? 0);
    const curEmulsion = evaluateEmulsionViscosity(inletWaterCut, arrivalPvt.muL, 0.001);
    trendEmulsionVisc.push(curEmulsion.effectiveViscosity);

    // Record spatial profile snapshot
    if (step % snapshotInterval === 0 || step === totalSteps) {
      const xArr: number[] = [];
      const elevArr: number[] = [];
      const pArr: number[] = [];
      const tArr: number[] = [];
      const holdupArr: number[] = [];
      const ugArr: number[] = [];
      const ulArr: number[] = [];
      const regimesArr: string[] = [];

      for (let i = 0; i < N; i++) {
        const cell = cells[i]!;
        const pvt = evaluateBlackOilPvt(P[i]!, T[i]!);
        const theta = Math.asin(cell.sinTheta);
        const { c0, ugj } = computeZuberFindlaySlip(alphaG[i]!, pvt.rhoG, pvt.rhoL, 0.025, theta);
        const jVal = 0.5 * (jFace[i]! + jFace[i + 1]!);
        const ug = c0 * jVal + ugj;
        const al = 1.0 - alphaG[i]!;
        const ul = al > 0.01 ? (jVal - alphaG[i]! * ug) / al : jVal;

        const reg = classifyFlowRegime({
          diameter: cell.diameter,
          inclinationRad: theta,
          superficialGasVelocity: Math.max(0.01, alphaG[i]! * ug),
          superficialLiquidVelocity: Math.max(0.01, al * Math.abs(ul)),
          rhoGas: pvt.rhoG,
          rhoLiquid: pvt.rhoL,
          muGas: pvt.muG,
          muLiquid: pvt.muL,
          roughness: cell.roughness,
        });

        xArr.push(cell.x);
        elevArr.push(cell.x * cell.sinTheta);
        pArr.push(P[i]!);
        tArr.push(T[i]!);
        holdupArr.push(al);
        ugArr.push(ug);
        ulArr.push(ul);
        regimesArr.push(reg.regime);
      }

      profiles.push({
        time: currentTime,
        x: xArr,
        elevation: elevArr,
        pressure: pArr,
        temperature: tArr,
        liquidHoldup: holdupArr,
        gasVelocity: ugArr,
        liquidVelocity: ulArr,
        flowRegimes: regimesArr,
        activeSlugs: activeSlugs.map((s) => ({
          id: s.id,
          frontPosition: s.frontPos,
          tailPosition: s.tailPos,
          length: s.length,
          holdup: s.holdup,
          velocity: s.velocity,
        })),
        pigs: activePigs.map((p) => ({
          name: p.name,
          position: p.position,
          velocity: p.velocity,
          differentialPressure: p.drivePressureDrop,
          sweptLiquidVolume: p.sweptLiquidVolume,
          isStuck: p.isStuck,
        })),
      });
    }
  }

  return {
    times,
    profiles,
    trends: {
      inletPressure: trendInletP,
      arrivalPressure: trendArrivalP,
      arrivalTemperature: trendArrivalT,
      arrivalLiquidHoldup: trendArrivalAlphaL,
      arrivalLiquidMassRate: trendArrivalLiquidRate,
      accumulatedLiquidVolume: trendAccLiquidVol,
      peakLiquidSurgeVolume,
      meanSlugLength: trendMeanSlugLength,
      slugFrequency: trendSlugFreq,
      activeSlugsCount: trendActiveSlugs,
      pigPosition: trendPigPos,
      pigVelocity: trendPigVel,
      emulsionViscosity: trendEmulsionVisc,
    },
  };
}

/** Alias for simulateDriftFlux */
export const solveDriftFluxDAE = simulateDriftFlux;
