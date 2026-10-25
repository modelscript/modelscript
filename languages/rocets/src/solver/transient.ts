// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dynamic Transient Integrator for NASA ROCETS Engine Models.
 *
 * Integrates non-linear continuous ODE states:
 * - Chamber filling/purging dynamics (dPc/dt)
 * - Turbopump rotor spinup/spindown (dOmega/dt)
 * - Regenerative cooling channel wall heat soaking (dTw/dt)
 * across ignition start transients, throttle adjustments, and shutdowns.
 */

import { evaluateCombustion, evaluateNozzlePerformance } from "../thermo/index.js";
import type { RocetsEngineModel } from "../types.js";

export interface RocetsTransientPoint {
  time: number;
  pcPa: number;
  speedRpm: number;
  thrustN: number;
  wallTempK: number;
  mdotKgS: number;
}

export interface RocetsTransientResult {
  times: number[];
  pcPa: number[];
  speedRpm: number[];
  thrustN: number[];
  wallTempK: number[];
  mdotKgS: number[];
  points: RocetsTransientPoint[];
}

export function simulateRocetsTransient(
  model: RocetsEngineModel,
  options: {
    tStart?: number;
    tEnd?: number;
    dt?: number;
    valveOpenTime?: number;
  } = {},
): RocetsTransientResult {
  const tStart = options.tStart ?? 0.0;
  const tEnd = options.tEnd ?? 2.0; // 2-second ignition & ramp transient
  const dt = options.dt ?? 0.005; // 5 ms step
  const valveOpenTime = options.valveOpenTime ?? 0.2; // 200 ms valve ramp

  // Locate primary chamber
  const chamber = Array.from(model.components.values()).find((c) => {
    const t = c.type.toUpperCase();
    return t === "CHAMBER" || t === "TC" || t === "COMBUSTOR";
  });

  const targetPc = typeof chamber?.parameters["PC"] === "number" ? chamber.parameters["PC"] : 7.0e6;
  const targetRpm = 32000.0;
  const at = typeof chamber?.parameters["AT"] === "number" ? chamber.parameters["AT"] : 0.005;
  const eps = typeof chamber?.parameters["EPS"] === "number" ? chamber.parameters["EPS"] : 40.0;

  const cea = evaluateCombustion("LOX", "LH2", 6.0, targetPc);
  const ae = at * eps;
  const nozzle = evaluateNozzlePerformance(targetPc, at, ae, cea.cStarMS, cea.gamma);

  // Initial state conditions
  let pc = chamber?.initialStates["PC"] ?? 101325.0; // Starts at ambient
  let rpm = 0.0; // Stationary rotor
  let tw = chamber?.initialStates["T_WALL"] ?? 300.0; // Ambient wall temperature

  const times: number[] = [];
  const pcArr: number[] = [];
  const rpmArr: number[] = [];
  const thrustArr: number[] = [];
  const twArr: number[] = [];
  const mdotArr: number[] = [];
  const points: RocetsTransientPoint[] = [];

  const steps = Math.ceil((tEnd - tStart) / dt);
  let t = tStart;

  for (let step = 0; step <= steps; step++) {
    // Valve opening profile (sigmoidal ramp from 0 to 1)
    const valvePos = Math.min(1.0, Math.max(0.0, (t - 0.05) / Math.max(1e-3, valveOpenTime)));

    // Steady state target at this valve position
    const pcEquil = 101325.0 + (targetPc - 101325.0) * valvePos;
    const rpmEquil = targetRpm * Math.sqrt(valvePos);

    // ODE derivatives
    // dPc/dt = (pcEquil - pc) / tau_pc
    const tauPc = 0.04; // 40 ms acoustic filling time
    const dPc_dt = (pcEquil - pc) / tauPc;

    // dRpm/dt = (rpmEquil - rpm) / tau_rpm
    const tauRpm = 0.15; // 150 ms rotor inertia time constant
    const dRpm_dt = (rpmEquil - rpm) / tauRpm;

    // dTw/dt: wall heating towards steady-state temperature
    const targetTw = 300.0 + (650.0 - 300.0) * (pc / targetPc);
    const tauTw = 0.4; // 400 ms wall thermal inertia
    const dTw_dt = (targetTw - tw) / tauTw;

    // Current mass flow and thrust
    const currentMdot = (pc * at) / cea.cStarMS;
    const currentThrust = valvePos <= 0 ? 0.0 : Math.max(0.0, nozzle.thrustN * (pc / targetPc));

    times.push(t);
    pcArr.push(pc);
    rpmArr.push(rpm);
    thrustArr.push(currentThrust);
    twArr.push(tw);
    mdotArr.push(currentMdot);

    points.push({
      time: t,
      pcPa: pc,
      speedRpm: rpm,
      thrustN: currentThrust,
      wallTempK: tw,
      mdotKgS: currentMdot,
    });

    // Euler integration step
    pc += dPc_dt * dt;
    rpm += dRpm_dt * dt;
    tw += dTw_dt * dt;
    t += dt;
  }

  return {
    times,
    pcPa: pcArr,
    speedRpm: rpmArr,
    thrustN: thrustArr,
    wallTempK: twArr,
    mdotKgS: mdotArr,
    points,
  };
}
