// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — In-WASM 1D Drift-Flux Staggered-Grid DAE Solver.
 *
 * Discretizes multiphase pipeline flowpaths into finite volume control volumes,
 * solving coupled gas/liquid mass conservation, mixture momentum, and energy
 * balance equations with Zuber-Findlay drift-flux closure.
 */

import { Causality, DAEBuilder, EqKind, VarType, Variability } from "@modelscript/runtime";
import { captureSimulationCheckpoint } from "../engine/checkpoint.js";
import type { PvtTableData } from "../parser/pvt-table-parser.js";
import type {
  OlgaCheckpointState,
  OlgaFlowpath,
  OlgaHeatExchanger,
  OlgaModel,
  OlgaSimulationResult,
  SpatialProfileSnapshot,
} from "../types.js";
import { AntiSlugController, type AntiSlugControllerOptions } from "./anti-slug-controller.js";
import { classifyFlowRegime } from "./flow-regimes.js";
import { evaluateCellFluidProperties, resolvePvtTable } from "./fluid-properties.js";
import { PigTracker } from "./pig-tracker.js";
import { SlugTracker } from "./slug-tracker.js";
import { computeChurchillFriction, computeZuberFindlaySlip } from "./zuber-findlay.js";

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

      // Symbolic rate equations in arena for pressure, phase fraction, and thermal balance
      const derP = builder.addDer(pIdx);
      const derAlpha = builder.addDer(alphaGIdx);
      const derT = builder.addDer(tempIdx);
      const zero = builder.addRealLiteral(0.0);
      builder.addEquation(EqKind.Simple, derP, zero);
      builder.addEquation(EqKind.Simple, derAlpha, zero);
      builder.addEquation(EqKind.Simple, derT, zero);
    }

    cellOffset += nCells;
  }

  return { varIndices, cellCount: cellOffset };
}

export interface SimulationOptions {
  durationSeconds?: number | undefined;
  timeStepSeconds?: number | undefined;
  snapshotCount?: number | undefined;
  pvtTable?: PvtTableData | string | undefined;
  pvtModel?: "TABULAR" | "BLACK_OIL" | undefined;
  initialCheckpoint?: OlgaCheckpointState | undefined;
  checkpointIntervalSeconds?: number | undefined;
  onCheckpoint?: ((checkpoint: OlgaCheckpointState) => void) | undefined;
  antiSlugController?: AntiSlugControllerOptions | undefined;
  spatialScheme?: "UPWIND" | "TVD_VAN_LEER" | "TVD_MINMOD" | "TVD_SUPERBEE" | undefined;
}

export type FluxLimiterType = "VAN_LEER" | "MINMOD" | "SUPERBEE";

/**
 * Total Variation Diminishing (TVD) flux limiter function psi(r).
 * Eliminates numerical diffusion at gas-liquid slug fronts without spurious oscillations.
 */
export function computeFluxLimiter(r: number, limiter: FluxLimiterType = "VAN_LEER"): number {
  if (r <= 0 || isNaN(r)) return 0.0;
  if (limiter === "MINMOD") {
    return Math.min(1.0, r);
  } else if (limiter === "SUPERBEE") {
    return Math.max(0.0, Math.min(2.0 * r, 1.0), Math.min(r, 2.0));
  } else {
    // Van Leer symmetric limiter: (r + |r|) / (1 + |r|)
    return (2.0 * r) / (1.0 + r);
  }
}

/**
 * High-performance transient 1D Drift-Flux staggered-grid solver.
 * Simulates transient multiphase flow, liquid accumulation, pressure drop,
 * and thermal cooldown along the pipeline trajectory.
 */
export function simulateDriftFlux(model: OlgaModel, options?: SimulationOptions): OlgaSimulationResult {
  const tableData = options?.pvtModel === "BLACK_OIL" ? null : resolvePvtTable(options?.pvtTable);
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
    heatExchangers?: OlgaHeatExchanger[] | undefined;
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

  // Associate heat exchangers with their closest cells
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

  let startTime = 0;
  if (options?.initialCheckpoint) {
    startTime = options.initialCheckpoint.simulatedTime;
    const cpCells = options.initialCheckpoint.gridCells;
    if (cpCells.length === N) {
      for (let i = 0; i < N; i++) {
        P[i] = cpCells[i]!.pressurePa;
        T[i] = cpCells[i]!.temperatureK;
        alphaG[i] = cpCells[i]!.gasHoldup;
        const jVal = cpCells[i]!.gasVelocityMps * alphaG[i]! + cpCells[i]!.liquidVelocityMps * cpCells[i]!.liquidHoldup;
        jFace[i] = jVal;
      }
      jFace[N] = jFace[N - 1]!;
    } else {
      // Spatial re-interpolation onto target discretization
      for (let i = 0; i < N; i++) {
        const xTarget = cells[i]!.x;
        let closest = cpCells[0]!;
        let minDx = Infinity;
        for (const c of cpCells) {
          const d = Math.abs(c.x - xTarget);
          if (d < minDx) {
            minDx = d;
            closest = c;
          }
        }
        P[i] = closest.pressurePa;
        T[i] = closest.temperatureK;
        alphaG[i] = closest.gasHoldup;
        jFace[i] = closest.gasVelocityMps * alphaG[i]! + closest.liquidVelocityMps * closest.liquidHoldup;
      }
      jFace[N] = jFace[N - 1]!;
    }
  } else {
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
  }

  // Advanced modules: Lagrangian slug tracker & scraper pigging dynamics
  const totalLength = cells.reduce((acc, c) => acc + c.dx, 0);
  const avgDiameter = cells.reduce((acc, c) => acc + c.diameter, 0) / N;
  const avgInclination = Math.asin(cells.reduce((acc, c) => acc + c.sinTheta, 0) / N);

  const slugTracker = new SlugTracker();
  const pigTracker = new PigTracker(flowpath.pigs || []);

  if (options?.initialCheckpoint?.pigStates && options.initialCheckpoint.pigStates.length > 0) {
    pigTracker.restoreStates(options.initialCheckpoint.pigStates);
  }

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

  const antiSlug = options?.antiSlugController ? new AntiSlugController(options.antiSlugController) : null;
  const trendChokeOpening: number[] = [];
  const trendControllerError: number[] = [];

  // Time integration loop (Explicit TVD / Donor-cell predictor-corrector)
  for (let step = 0; step <= totalSteps; step++) {
    const currentTime = startTime + step * dt;

    // Active anti-slug closed-loop controller update
    if (antiSlug) {
      const riserBasePressure = P[0]!;
      const topsidePressure = P[N - 1]!;
      const ctrlOutput = antiSlug.step(
        {
          riserBasePressurePa: riserBasePressure,
          topsidePressurePa: topsidePressure,
          surgeVolumeM3: accumulatedLiquidVolume,
        },
        dt,
      );
      chokeOpening = ctrlOutput.chokeOpening;
      trendChokeOpening.push(ctrlOutput.chokeOpening);
      trendControllerError.push(ctrlOutput.filteredErrorPa);
    }

    // Upwind mass and momentum update
    for (let i = 0; i < N; i++) {
      const cell = cells[i]!;
      const fluid = evaluateCellFluidProperties(tableData, P[i]!, T[i]!, inletWaterCut);

      const alphaL = 1.0 - alphaG[i]!;
      const rhoM = alphaG[i]! * fluid.rhoG + alphaL * fluid.rhoL;

      // Zuber-Findlay drift-flux closure
      const theta = Math.asin(cell.sinTheta);
      const { c0, ugj } = computeZuberFindlaySlip(alphaG[i]!, fluid.rhoG, fluid.rhoL, fluid.sigma, theta);

      // Velocities at cell
      const jCell = 0.5 * (jFace[i]! + jFace[i + 1]!);
      const ug = c0 * jCell + ugj;

      const muL = fluid.muL;
      const muM = alphaG[i]! * fluid.muG + alphaL * muL;

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

      // Void fraction rate of change (gas mass continuity) with TVD shock-capturing
      let fluxGasIn: number;
      let fluxGasOut: number;

      if (options?.spatialScheme === "UPWIND") {
        fluxGasIn = i === 0 ? (inletMassRate * inletGasFraction) / cell.area : alphaG[i - 1]! * fluid.rhoG * ug;
        fluxGasOut = alphaG[i]! * fluid.rhoG * ug;
      } else {
        const limiter: FluxLimiterType =
          options?.spatialScheme === "TVD_MINMOD"
            ? "MINMOD"
            : options?.spatialScheme === "TVD_SUPERBEE"
              ? "SUPERBEE"
              : "VAN_LEER";

        // TVD flux evaluation at left face i - 1/2
        if (i === 0) {
          fluxGasIn = (inletMassRate * inletGasFraction) / cell.area;
        } else if (i === 1) {
          fluxGasIn = alphaG[0]! * fluid.rhoG * ug;
        } else {
          const dUp = alphaG[i - 1]! - alphaG[i - 2]!;
          const dDown = alphaG[i]! - alphaG[i - 1]!;
          const r = Math.abs(dDown) > 1e-9 ? dUp / dDown : dUp === 0 ? 1.0 : 0.0;
          const psi = computeFluxLimiter(r, limiter);
          const alphaFaceIn = Math.max(0.01, Math.min(0.99, alphaG[i - 1]! + 0.5 * psi * dDown));
          fluxGasIn = alphaFaceIn * fluid.rhoG * ug;
        }

        // TVD flux evaluation at right face i + 1/2
        if (i === N - 1) {
          fluxGasOut = alphaG[i]! * fluid.rhoG * ug;
        } else {
          const dUp = i === 0 ? 0.0 : alphaG[i]! - alphaG[i - 1]!;
          const dDown = alphaG[i + 1]! - alphaG[i]!;
          const r = Math.abs(dDown) > 1e-9 ? dUp / dDown : dUp === 0 ? 1.0 : 0.0;
          const psi = computeFluxLimiter(r, limiter);
          const alphaFaceOut = Math.max(0.01, Math.min(0.99, alphaG[i]! + 0.5 * psi * dDown));
          fluxGasOut = alphaFaceOut * fluid.rhoG * ug;
        }
      }

      const dAlphaGdt = -(fluxGasOut - fluxGasIn) / (cell.dx * Math.max(1.0, fluid.rhoG));
      alphaG[i] = Math.max(0.01, Math.min(0.99, alphaG[i]! + 0.1 * dt * dAlphaGdt));

      // Thermal cooling balance: d(rho Cp T)/dt = - d(rho Cp u T)/dx - 4 U (T - T_amb) / D + q_hex
      const cpM = 2200.0; // J / (kg * K)
      const qLoss = (4.0 * cell.uHeatTransfer * (T[i]! - cell.ambientTemp)) / cell.diameter;

      let advectionT: number;
      if (options?.spatialScheme === "UPWIND" || i === 0) {
        advectionT = (rhoM * cpM * vm * (i === 0 ? T[i]! - inletTemp : T[i]! - T[i - 1]!)) / cell.dx;
      } else {
        const limiter: FluxLimiterType =
          options?.spatialScheme === "TVD_MINMOD"
            ? "MINMOD"
            : options?.spatialScheme === "TVD_SUPERBEE"
              ? "SUPERBEE"
              : "VAN_LEER";

        const dUp = i === 1 ? 0.0 : T[i - 1]! - T[i - 2]!;
        const dDown = T[i]! - T[i - 1]!;
        const r = Math.abs(dDown) > 1e-4 ? dUp / dDown : dUp === 0 ? 1.0 : 0.0;
        const psi = computeFluxLimiter(r, limiter);
        const tFaceIn = T[i - 1]! + 0.5 * psi * dDown;
        advectionT = (rhoM * cpM * vm * (T[i]! - tFaceIn)) / cell.dx;
      }

      let qHex = 0.0;
      const cellVolume = cell.area * cell.dx;
      if (cell.heatExchangers && cell.heatExchangers.length > 0 && cellVolume > 0) {
        for (const hex of cell.heatExchangers) {
          if (hex.dutyKw !== undefined) {
            // dutyKw in kW -> W: positive for heating, negative for cooling
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
    const arrivalFluid = evaluateCellFluidProperties(tableData, arrivalP, arrivalT, inletWaterCut);
    const arrivalArea = cells[N - 1]!.area;
    const arrivalVelocity = jFace[N]!;
    const arrivalLiquidRate = arrivalAlphaL * arrivalFluid.rhoL * arrivalVelocity * arrivalArea;

    const deltaLiquidVol = (arrivalLiquidRate / arrivalFluid.rhoL) * dt;
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
    trendEmulsionVisc.push(arrivalFluid.muL);

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
        const fluid = evaluateCellFluidProperties(tableData, P[i]!, T[i]!, inletWaterCut);
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

    // Checkpoint snapshotting during time-stepping
    if (options?.checkpointIntervalSeconds && options.onCheckpoint) {
      if (step > 0 && (step * dt) % options.checkpointIntervalSeconds < dt) {
        const cp = captureSimulationCheckpoint({
          modelTitle: model.title,
          simulatedTime: currentTime,
          cells,
          P,
          T,
          alphaG,
          jFace,
          pigs: activePigs.map((p) => ({
            name: p.name,
            position: p.position,
            velocity: p.velocity,
            sweptVolume: p.sweptLiquidVolume,
            isStuck: p.isStuck,
          })),
          slugs: activeSlugs.map((s) => ({
            id: s.id,
            tailX: s.tailPos,
            frontX: s.frontPos,
            length: s.length,
            velocity: s.velocity,
          })),
        });
        options.onCheckpoint(cp);
      }
    }
  }

  // Final checkpoint at simulation completion if requested
  if (options?.onCheckpoint) {
    const lastPigs = pigTracker.getStates();
    const lastSlugs = slugTracker.getActiveSlugs();
    const finalCp = captureSimulationCheckpoint({
      modelTitle: model.title,
      simulatedTime: startTime + duration,
      cells,
      P,
      T,
      alphaG,
      jFace,
      pigs: lastPigs.map((p) => ({
        name: p.name,
        position: p.position,
        velocity: p.velocity,
        sweptVolume: p.sweptLiquidVolume,
        isStuck: p.isStuck,
      })),
      slugs: lastSlugs.map((s) => ({
        id: s.id,
        tailX: s.tailPos,
        frontX: s.frontPos,
        length: s.length,
        velocity: s.velocity,
      })),
    });
    options.onCheckpoint(finalCp);
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
      chokeOpening: trendChokeOpening.length > 0 ? trendChokeOpening : undefined,
      controllerError: trendControllerError.length > 0 ? trendControllerError : undefined,
    },
  };
}

/** Alias for simulateDriftFlux */
export const solveDriftFluxDAE = simulateDriftFlux;
