// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — 1D Radial Cylindrical Soil Thermal Conduction Mesh.
 *
 * Implements transient radial heat diffusion through multi-layer soil shells
 * surrounding buried gas and liquid pipelines, modeling thermal inertia,
 * seasonal ground temperature variations, and pipeline cooldown during shutdowns.
 */

import type { LpsPipe } from "../../types.js";

export interface SoilProperties {
  thermalConductivity: number; // W/(m*K), typically 1.2 - 2.0
  density: number; // kg/m3, typically 1600 - 2000
  specificHeat: number; // J/(kg*K), typically 1000 - 1500
}

export interface SoilProfileState {
  pipeName: string;
  burialDepthM: number;
  shellRadiiM: number[]; // Radii of concentric soil boundaries (r_0, r_1, ..., r_N)
  shellTempsK: number[]; // Temperature of each concentric soil shell
  fluidTempK: number;
  ambientGroundTempK: number;
  heatLossRateWattsPerM: number; // Current heat flux from fluid to soil (W/m)
}

export class SoilThermalEngine {
  public static readonly DEFAULT_SOIL: SoilProperties = {
    thermalConductivity: 1.5, // W/(m*K)
    density: 1800.0, // kg/m3
    specificHeat: 1200.0, // J/(kg*K)
  };

  /**
   * Initializes a 10-layer concentric radial cylindrical mesh around a buried pipe.
   */
  static createInitialSoilProfile(
    pipe: LpsPipe,
    burialDepthM = 1.5,
    initialFluidTempK = 313.15, // 40 deg C
    ambientGroundTempK = 283.15, // 10 deg C
    numShells = 10,
  ): SoilProfileState {
    const rInner = pipe.diameter / 2.0;
    const wallThick = pipe.wallThickness ?? 0.0127;
    const r0 = rInner + wallThick; // Pipe outer radius
    const rInf = Math.max(3.0, 10.0 * r0); // Thermal far field boundary

    const shellRadiiM: number[] = [];
    const shellTempsK: number[] = [];

    // Logarithmic / geometric radial discretization
    for (let k = 0; k <= numShells; k++) {
      const frac = k / numShells;
      const r = r0 * Math.pow(rInf / r0, frac);
      shellRadiiM.push(r);
      // Wall interface temperature is slightly below fluid temperature due to internal convective film resistance
      const deltaTFilm = Math.min(2.0, (initialFluidTempK - ambientGroundTempK) * 0.05);
      const tWall = initialFluidTempK - deltaTFilm;
      const tInit = tWall - frac * (tWall - ambientGroundTempK);
      shellTempsK.push(tInit);
    }

    return {
      pipeName: pipe.name,
      burialDepthM,
      shellRadiiM,
      shellTempsK,
      fluidTempK: initialFluidTempK,
      ambientGroundTempK,
      heatLossRateWattsPerM: 0.0,
    };
  }

  /**
   * Advances the radial finite-difference soil temperature mesh by one timestep dt.
   */
  static advanceTimeStep(
    state: SoilProfileState,
    pipe: LpsPipe,
    fluidTempK: number,
    dtSeconds: number,
    ambientGroundTempK?: number,
    soilProps = SoilThermalEngine.DEFAULT_SOIL,
  ): SoilProfileState {
    const ambientT = ambientGroundTempK ?? state.ambientGroundTempK;
    const numShells = state.shellTempsK.length - 1;
    const nextTemps = [...state.shellTempsK];

    const rInner = pipe.diameter / 2.0;
    const rOuter = state.shellRadiiM[0] ?? rInner * 1.05;
    const kSteel = 45.0; // Carbon steel thermal conductivity (W/m*K)
    const hInternal = 500.0; // Fluid-to-wall convective heat transfer coefficient (W/m2*K)

    // Overall thermal resistance between fluid and innermost soil interface r0 (per meter length)
    // R_pipe = 1 / (2 * pi * r_i * h_i) + ln(r_o / r_i) / (2 * pi * k_steel)
    const rConv = 1.0 / (2.0 * Math.PI * rInner * hInternal);
    const rCondPipe = Math.log(rOuter / rInner) / (2.0 * Math.PI * kSteel);
    const uPipePerM = 1.0 / (rConv + rCondPipe);

    // Heat flux into innermost soil node 0
    const t0 = state.shellTempsK[0] ?? ambientT;
    const qInWatts = uPipePerM * (fluidTempK - t0);

    // Finite difference update for each soil shell
    for (let k = 0; k < numShells; k++) {
      const rK = state.shellRadiiM[k] ?? rOuter;
      const rKPlus = state.shellRadiiM[k + 1] ?? rK + 0.1;
      const tK = state.shellTempsK[k] ?? ambientT;
      const tKPlus = state.shellTempsK[k + 1] ?? ambientT;

      // Shell volume per meter: pi * (r_{k+1}^2 - r_k^2)
      const shellVol = Math.PI * (Math.pow(rKPlus, 2) - Math.pow(rK, 2));
      const heatCap = shellVol * soilProps.density * soilProps.specificHeat;

      // Conductive heat flux between shell k and shell k+1
      const qCondToNext = ((2.0 * Math.PI * soilProps.thermalConductivity) / Math.log(rKPlus / rK)) * (tK - tKPlus);

      if (k === 0) {
        // Node 0 receives qInWatts and loses qCondToNext
        const netQ = qInWatts - qCondToNext;
        nextTemps[k] = tK + (netQ / heatCap) * dtSeconds;
      } else {
        // Node k receives from k-1 and loses to k+1
        const rKMinus = state.shellRadiiM[k - 1] ?? rInner;
        const tKMinus = state.shellTempsK[k - 1] ?? ambientT;
        const qCondFromPrev =
          ((2.0 * Math.PI * soilProps.thermalConductivity) / Math.log(rK / rKMinus)) * (tKMinus - tK);
        const netQ = qCondFromPrev - qCondToNext;
        nextTemps[k] = tK + (netQ / heatCap) * dtSeconds;
      }
    }

    // Outer boundary condition: clamped to ambient far-field temperature
    nextTemps[numShells] = ambientT;

    return {
      pipeName: state.pipeName,
      burialDepthM: state.burialDepthM,
      shellRadiiM: state.shellRadiiM,
      shellTempsK: nextTemps,
      fluidTempK,
      ambientGroundTempK: ambientT,
      heatLossRateWattsPerM: qInWatts,
    };
  }

  /**
   * Simulates a pipeline shutdown cooldown over a period of hours or days,
   * calculating fluid and radial ground temperature decay.
   */
  static simulateCooldown(
    pipe: LpsPipe,
    durationHours: number,
    initialFluidTempK = 313.15,
    ambientGroundTempK = 283.15,
    fluidDensityKgM3 = 850.0,
    fluidCpJkgK = 2000.0,
    dtSeconds = 60.0,
  ): {
    timesHours: number[];
    fluidTempsK: number[];
    innerSoilTempsK: number[];
    outerSoilTempsK: number[];
  } {
    let state = this.createInitialSoilProfile(pipe, 1.5, initialFluidTempK, ambientGroundTempK);
    const pipeVolPerM = (Math.PI * Math.pow(pipe.diameter, 2)) / 4.0;
    const fluidHeatCapPerM = pipeVolPerM * fluidDensityKgM3 * fluidCpJkgK;

    const totalSteps = Math.floor((durationHours * 3600) / dtSeconds);
    const recordInterval = Math.max(1, Math.floor(totalSteps / 100));

    const timesHours: number[] = [];
    const fluidTempsK: number[] = [];
    const innerSoilTempsK: number[] = [];
    const outerSoilTempsK: number[] = [];

    let currentFluidT = initialFluidTempK;

    for (let step = 0; step <= totalSteps; step++) {
      const tHours = (step * dtSeconds) / 3600.0;

      if (step % recordInterval === 0 || step === totalSteps) {
        timesHours.push(tHours);
        fluidTempsK.push(currentFluidT);
        innerSoilTempsK.push(state.shellTempsK[0] ?? ambientGroundTempK);
        outerSoilTempsK.push(state.shellTempsK[state.shellTempsK.length - 1] ?? ambientGroundTempK);
      }

      // Step soil diffusion
      state = this.advanceTimeStep(state, pipe, currentFluidT, dtSeconds, ambientGroundTempK);

      // Fluid cools by losing heat to inner soil wall
      const dQFluid = state.heatLossRateWattsPerM * dtSeconds;
      currentFluidT -= dQFluid / Math.max(100.0, fluidHeatCapPerM);
    }

    return {
      timesHours,
      fluidTempsK,
      innerSoilTempsK,
      outerSoilTempsK,
    };
  }
}
