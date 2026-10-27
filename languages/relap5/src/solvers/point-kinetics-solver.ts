// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/relap5 — Reactor Point Kinetics (PKE) & Core Thermal Hydraulics Solver.
 *
 * Implements 6-group delayed neutron precursor point kinetics coupled with Doppler fuel
 * feedback and moderator thermal-hydraulic temperature feedback.
 */

import type { DelayedNeutronGroup, Relap5Deck } from "../types.js";
import { WasmPointKineticsBridge } from "./wasm-bridge.js";

export interface KineticsSolverOptions {
  duration?: number | undefined; // transient duration (s), default 10.0
  stepSize?: number | undefined; // integration step (s), default 0.001
  externalReactivity?: number | undefined; // initial external reactivity insertion ($ or dk/k)
  tripScramTime?: number | undefined; // time to initiate SCRAM shutdown (s)
}

export interface KineticsStepRecord {
  time: number;
  powerNormalized: number; // n / n0
  powerMegawatts: number; // MWth
  reactivityPcm: number; // pcm (10^-5 dk/k)
  fuelTemperature: number; // K
  moderatorTemperature: number; // K
  precursors: number[]; // 6 groups
}

export interface KineticsSimulationResult {
  totalDuration: number;
  stepsCount: number;
  initialPowerMW: number;
  peakPowerMW: number;
  finalPowerMW: number;
  peakFuelTempK: number;
  trajectory: KineticsStepRecord[];
}

export function solvePointKinetics(deck: Relap5Deck, options?: KineticsSolverOptions): KineticsSimulationResult {
  const wasmBridge = WasmPointKineticsBridge.getInstance();
  if (wasmBridge) {
    try {
      return wasmBridge.simulate(deck, options);
    } catch {
      // Fall through to pure TS implementation if WASM throws
    }
  }

  const duration = options?.duration ?? 10.0;
  const dt = options?.stepSize ?? 0.001;
  const extRho0 = options?.externalReactivity ?? 0.0;
  const scramTime = options?.tripScramTime ?? Infinity;

  const kinetics = deck.kinetics ?? {
    promptGenerationTime: 2.0e-5,
    totalDelayedFraction: 0.0065,
    initialPower: 3000.0e6, // 3000 MWth
    delayedGroups: [
      { group: 1, decayConstant: 0.0124, fraction: 0.000215 },
      { group: 2, decayConstant: 0.0305, fraction: 0.001424 },
      { group: 3, decayConstant: 0.111, fraction: 0.001274 },
      { group: 4, decayConstant: 0.301, fraction: 0.002568 },
      { group: 5, decayConstant: 1.14, fraction: 0.000748 },
      { group: 6, decayConstant: 3.01, fraction: 0.000271 },
    ],
    fuelTempReactivityCoeff: -2.5e-5, // -2.5 pcm / K
    moderatorTempReactivityCoeff: -1.0e-4, // -10 pcm / K
  };

  const Lambda = kinetics.promptGenerationTime;
  const beta = kinetics.totalDelayedFraction;
  const P0 = kinetics.initialPower; // Watts
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

  // Steady-state initial condition: n(0) = 1.0, C_i(0) = beta_i / (Lambda * lambda_i) * n(0)
  let n = 1.0;
  const C = groups.map((g) => g.fraction / (Lambda * g.decayConstant));

  // Thermal hydraulics initial states
  let Tfuel = 850.0; // K
  let Tmod = 580.0; // K
  const Tfuel0 = Tfuel;
  const Tmod0 = Tmod;

  const Cfuel = 2.0e7; // Fuel heat capacity (J/K)
  const Cmod = 4.0e7; // Coolant heat capacity (J/K)
  const UA = P0 / (Tfuel0 - Tmod0); // Heat transfer conductance

  const trajectory: KineticsStepRecord[] = [];
  let peakPowerMW = P0_MW;
  let peakFuelTemp = Tfuel;

  const totalSteps = Math.ceil(duration / dt);

  for (let step = 0; step <= totalSteps; step++) {
    const t = step * dt;

    // Reactivity calculation: rho = ext + scram + Doppler + MTC
    let rho = extRho0;
    if (t >= scramTime) {
      rho -= 0.05; // -5000 pcm negative SCRAM insertion
    }
    const deltaTfuel = Tfuel - Tfuel0;
    const deltaTmod = Tmod - Tmod0;
    rho += kinetics.fuelTempReactivityCoeff * deltaTfuel;
    rho += kinetics.moderatorTempReactivityCoeff * deltaTmod;

    const currentPowerMW = n * P0_MW;
    if (currentPowerMW > peakPowerMW) peakPowerMW = currentPowerMW;
    if (Tfuel > peakFuelTemp) peakFuelTemp = Tfuel;

    // Record sample (sample every 10 steps to keep trajectory manageable)
    if (step % Math.max(1, Math.floor(0.01 / dt)) === 0 || step === totalSteps) {
      trajectory.push({
        time: t,
        powerNormalized: n,
        powerMegawatts: currentPowerMW,
        reactivityPcm: rho * 1e5,
        fuelTemperature: Tfuel,
        moderatorTemperature: Tmod,
        precursors: [...C],
      });
    }

    // Advance ODEs using RK4
    // State vector: y = [n, C1..C6, Tfuel, Tmod]
    const deriv = (curN: number, curC: number[], curTf: number, curTm: number, curRho: number) => {
      let sumDecay = 0;
      for (let i = 0; i < 6; i++) {
        sumDecay += (groups[i]?.decayConstant ?? 0) * (curC[i] ?? 0);
      }
      const dn = ((curRho - beta) / Lambda) * curN + sumDecay;
      const dC = groups.map((g, i) => (g.fraction / Lambda) * curN - g.decayConstant * (curC[i] ?? 0));
      const qTrans = UA * (curTf - curTm);
      const dTf = (P0 * curN - qTrans) / Cfuel;
      const dTm = (qTrans - P0 * curN * 0.95) / Cmod;
      return { dn, dC, dTf, dTm };
    };

    // k1
    const k1 = deriv(n, C, Tfuel, Tmod, rho);

    // k2
    const n2 = Math.max(0, n + 0.5 * dt * k1.dn);
    const C2 = C.map((c, i) => Math.max(0, c + 0.5 * dt * (k1.dC[i] ?? 0)));
    const Tf2 = Tfuel + 0.5 * dt * k1.dTf;
    const Tm2 = Tmod + 0.5 * dt * k1.dTm;
    const k2 = deriv(n2, C2, Tf2, Tm2, rho);

    // k3
    const n3 = Math.max(0, n + 0.5 * dt * k2.dn);
    const C3 = C.map((c, i) => Math.max(0, c + 0.5 * dt * (k2.dC[i] ?? 0)));
    const Tf3 = Tfuel + 0.5 * dt * k2.dTf;
    const Tm3 = Tmod + 0.5 * dt * k2.dTm;
    const k3 = deriv(n3, C3, Tf3, Tm3, rho);

    // k4
    const n4 = Math.max(0, n + dt * k3.dn);
    const C4 = C.map((c, i) => Math.max(0, c + dt * (k3.dC[i] ?? 0)));
    const Tf4 = Tfuel + dt * k3.dTf;
    const Tm4 = Tmod + dt * k3.dTm;
    const k4 = deriv(n4, C4, Tf4, Tm4, rho);

    // Update state
    n = Math.max(0, n + (dt / 6) * (k1.dn + 2 * k2.dn + 2 * k3.dn + k4.dn));
    for (let i = 0; i < 6; i++) {
      C[i] = Math.max(
        0,
        (C[i] ?? 0) + (dt / 6) * ((k1.dC[i] ?? 0) + 2 * (k2.dC[i] ?? 0) + 2 * (k3.dC[i] ?? 0) + (k4.dC[i] ?? 0)),
      );
    }
    Tfuel = Tfuel + (dt / 6) * (k1.dTf + 2 * k2.dTf + 2 * k3.dTf + k4.dTf);
    Tmod = Tmod + (dt / 6) * (k1.dTm + 2 * k2.dTm + 2 * k3.dTm + k4.dTm);
  }

  return {
    totalDuration: duration,
    stepsCount: trajectory.length,
    initialPowerMW: P0_MW,
    peakPowerMW,
    finalPowerMW: n * P0_MW,
    peakFuelTempK: peakFuelTemp,
    trajectory,
  };
}
