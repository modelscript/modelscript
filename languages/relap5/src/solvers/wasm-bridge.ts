// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly Bridge and Linear Memory Manager for RELAP5 Point Reactor Kinetics.
 *
 * Executes the 6-group delayed neutron precursor kinetics and thermal-hydraulic
 * feedback integration in zero-allocation WebAssembly linear memory.
 */

import type { DelayedNeutronGroup, Relap5Deck } from "../types.js";
import type { KineticsSimulationResult, KineticsSolverOptions, KineticsStepRecord } from "./point-kinetics-solver.js";
import { getPointKineticsWasmBinary } from "./wasm-binary.js";

export interface PointKineticsWasmExports {
  memory: WebAssembly.Memory;
  point_kinetics_get_scratch_base(): number;
  point_kinetics_get_trajectory_base(): number;
  point_kinetics_init(
    lambda: number,
    beta: number,
    p0: number,
    tfuel0: number,
    tmod0: number,
    cfuel: number,
    cmod: number,
    ua: number,
    alphaF: number,
    alphaM: number,
  ): void;
  point_kinetics_set_delayed_group(groupIndex: number, decay: number, fraction: number): void;
  point_kinetics_rk4_step(dt: number, rho: number): void;
  point_kinetics_simulate(
    duration: number,
    dt: number,
    extRho0: number,
    scramTime: number,
    sampleInterval: number,
  ): number;
  point_kinetics_get_peak_power_mw(): number;
  point_kinetics_get_peak_fuel_temp_k(): number;
  point_kinetics_get_final_power_mw(): number;
}

export class WasmPointKineticsBridge {
  private static instance: WasmPointKineticsBridge | null = null;
  private readonly exports: PointKineticsWasmExports;

  private constructor(wasmInstance: WebAssembly.Instance) {
    this.exports = wasmInstance.exports as unknown as PointKineticsWasmExports;
  }

  public static getInstance(): WasmPointKineticsBridge | null {
    if (WasmPointKineticsBridge.instance) {
      return WasmPointKineticsBridge.instance;
    }
    try {
      const bytes = getPointKineticsWasmBinary();
      const module = new WebAssembly.Module(bytes as unknown as BufferSource);
      const wasmInstance = new WebAssembly.Instance(module, {});
      WasmPointKineticsBridge.instance = new WasmPointKineticsBridge(wasmInstance);
      return WasmPointKineticsBridge.instance;
    } catch {
      return null;
    }
  }

  public simulate(deck: Relap5Deck, options?: KineticsSolverOptions): KineticsSimulationResult {
    const duration = options?.duration ?? 10.0;
    const dt = options?.stepSize ?? 0.001;
    const extRho0 = options?.externalReactivity ?? 0.0;
    const scramTime = options?.tripScramTime ?? 1e12; // Infinity in f64

    const kinetics = deck.kinetics ?? {
      promptGenerationTime: 2.0e-5,
      totalDelayedFraction: 0.0065,
      initialPower: 3000.0e6,
      delayedGroups: [
        { group: 1, decayConstant: 0.0124, fraction: 0.000215 },
        { group: 2, decayConstant: 0.0305, fraction: 0.001424 },
        { group: 3, decayConstant: 0.111, fraction: 0.001274 },
        { group: 4, decayConstant: 0.301, fraction: 0.002568 },
        { group: 5, decayConstant: 1.14, fraction: 0.000748 },
        { group: 6, decayConstant: 3.01, fraction: 0.000271 },
      ],
      fuelTempReactivityCoeff: -2.5e-5,
      moderatorTempReactivityCoeff: -1.0e-4,
    };

    const Lambda = kinetics.promptGenerationTime;
    const beta = kinetics.totalDelayedFraction;
    const P0 = kinetics.initialPower;
    const P0_MW = P0 / 1e6;

    const groups: DelayedNeutronGroup[] =
      kinetics.delayedGroups.length === 6
        ? kinetics.delayedGroups
        : [
            { group: 1, decayConstant: 0.0124, fraction: 0.000215 },
            { group: 2, decayConstant: 0.0305, fraction: 0.001424 },
            { group: 3, decayConstant: 0.111, fraction: 0.001274 },
            { group: 4, decayConstant: 0.301, fraction: 0.002568 },
            { group: 5, decayConstant: 1.14, fraction: 0.000748 },
            { group: 6, decayConstant: 3.01, fraction: 0.000271 },
          ];

    // Thermal hydraulics initial states
    const Tfuel0 = 850.0;
    const Tmod0 = 580.0;
    const Cfuel = 2.0e7;
    const Cmod = 4.0e7;
    const UA = P0 / (Tfuel0 - Tmod0);

    // 1. Set delayed groups
    for (let i = 0; i < 6; i++) {
      const g = groups[i]!;
      this.exports.point_kinetics_set_delayed_group(i, g.decayConstant, g.fraction);
    }

    // 2. Initialize parameters and initial state in WASM memory
    this.exports.point_kinetics_init(
      Lambda,
      beta,
      P0,
      Tfuel0,
      Tmod0,
      Cfuel,
      Cmod,
      UA,
      kinetics.fuelTempReactivityCoeff,
      kinetics.moderatorTempReactivityCoeff,
    );

    // 3. Run simulation loop inside WebAssembly
    const sampleInterval = 0.01;
    const sampleCount = this.exports.point_kinetics_simulate(duration, dt, extRho0, scramTime, sampleInterval);

    // 4. Read results directly from linear memory
    const trajectoryBase = this.exports.point_kinetics_get_trajectory_base();
    const memBuffer = this.exports.memory.buffer;
    const f64View = new Float64Array(memBuffer, trajectoryBase, sampleCount * 12);

    const trajectory: KineticsStepRecord[] = new Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const offset = i * 12;
      trajectory[i] = {
        time: f64View[offset + 0]!,
        powerNormalized: f64View[offset + 1]!,
        powerMegawatts: f64View[offset + 2]!,
        reactivityPcm: f64View[offset + 3]!,
        fuelTemperature: f64View[offset + 4]!,
        moderatorTemperature: f64View[offset + 5]!,
        precursors: [
          f64View[offset + 6]!,
          f64View[offset + 7]!,
          f64View[offset + 8]!,
          f64View[offset + 9]!,
          f64View[offset + 10]!,
          f64View[offset + 11]!,
        ],
      };
    }

    const peakPowerMW = this.exports.point_kinetics_get_peak_power_mw();
    const peakFuelTempK = this.exports.point_kinetics_get_peak_fuel_temp_k();
    const finalPowerMW = this.exports.point_kinetics_get_final_power_mw();

    return {
      totalDuration: duration,
      stepsCount: sampleCount,
      initialPowerMW: P0_MW,
      peakPowerMW,
      finalPowerMW,
      peakFuelTempK,
      trajectory,
    };
  }
}
