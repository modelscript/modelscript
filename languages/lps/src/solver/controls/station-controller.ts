// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Station Supervisory Multi-Variable PID Override Controller.
 *
 * Implements SCADA station automation with discrete velocity PID control loops,
 * anti-windup tracking, and min/max auctioneering override selector gates for:
 *   - Discharge pressure control & high-pressure override
 *   - Suction pressure low override (cavitation & surge prevention)
 *   - Driver shaft power limiter override
 *   - Throughput flow dispatch control
 */

export interface PidConfig {
  kp: number; // Proportional gain
  ki: number; // Integral gain (1/s)
  kd?: number | undefined; // Derivative gain (s)
  outputMin: number; // e.g. min RPM
  outputMax: number; // e.g. max RPM
}

export interface PidState {
  integral: number;
  prevError: number;
  lastOutput: number;
}

export interface StationControlSetpoints {
  dischargePressureSetpointPa?: number | undefined;
  maxDischargePressurePa?: number | undefined; // MAOP safety override limit
  minSuctionPressurePa?: number | undefined; // Low suction floor
  maxPowerWatts?: number | undefined; // Driver rating limit
  targetFlowKgS?: number | undefined;
}

export interface StationProcessVariables {
  suctionPressurePa: number;
  dischargePressurePa: number;
  massFlowKgS: number;
  shaftPowerWatts: number;
  currentSpeedRpm: number;
}

export type ControllingVariable = "DISCHARGE_PRESSURE" | "SUCTION_OVERRIDE" | "POWER_LIMIT" | "FLOW_CONTROL" | "MANUAL";

export interface StationControllerStates {
  discharge: PidState;
  suction: PidState;
  power: PidState;
  flow: PidState;
  [key: string]: PidState | undefined;
}

export interface StationControllerOutputs {
  discharge: number;
  suction: number;
  power: number;
  flow?: number | undefined;
  [key: string]: number | undefined;
}

export interface StationControllerOutput {
  commandedSpeedRpm: number;
  controllingVariable: ControllingVariable;
  overrideActive: boolean;
  controllerOutputs: StationControllerOutputs;
  states: StationControllerStates;
}

export class StationSupervisoryController {
  private static stepPid(error: number, state: PidState, config: PidConfig, dt: number, isFrozen = false): number {
    const pTerm = config.kp * error;
    if (!isFrozen) {
      state.integral += config.ki * error * dt;
      // Clamp integral
      state.integral = Math.max(config.outputMin, Math.min(config.outputMax, state.integral));
    }
    const dTerm = config.kd ? (config.kd * (error - state.prevError)) / Math.max(1e-4, dt) : 0.0;
    state.prevError = error;

    const rawOutput = pTerm + state.integral + dTerm;
    const clampedOutput = Math.max(config.outputMin, Math.min(config.outputMax, rawOutput));
    state.lastOutput = clampedOutput;
    return clampedOutput;
  }

  /**
   * Executes one discrete supervisory control cycle across all competing
   * station loops and arbitrates the controlling output via min/max auctioneering.
   */
  static step(
    pv: StationProcessVariables,
    setpoints: StationControlSetpoints,
    dtSeconds = 1.0,
    prevStates?: StationControllerStates | undefined,
    baseRatedRpm = 10000,
    minRpm = 6000,
    maxRpm = 11000,
  ): StationControllerOutput {
    const states: StationControllerStates = {
      discharge: prevStates?.discharge ?? { integral: baseRatedRpm, prevError: 0, lastOutput: baseRatedRpm },
      suction: prevStates?.suction ?? { integral: maxRpm, prevError: 0, lastOutput: maxRpm },
      power: prevStates?.power ?? { integral: maxRpm, prevError: 0, lastOutput: maxRpm },
      flow: prevStates?.flow ?? { integral: baseRatedRpm, prevError: 0, lastOutput: baseRatedRpm },
    };

    const speedConfig: PidConfig = {
      kp: 0.0005,
      ki: 0.0001,
      kd: 0.00005,
      outputMin: minRpm,
      outputMax: maxRpm,
    };

    const controllerOutputs: StationControllerOutputs = {
      discharge: baseRatedRpm,
      suction: maxRpm,
      power: maxRpm,
    };

    // 1. Discharge Pressure Loop (Reverse Acting: P_meas > P_set => decrease speed)
    const targetPd = setpoints.dischargePressureSetpointPa ?? setpoints.maxDischargePressurePa ?? 80e5;
    const errPd = targetPd - pv.dischargePressurePa; // Positive when below setpoint (need more speed)
    controllerOutputs.discharge = this.stepPid(errPd, states.discharge, speedConfig, dtSeconds);

    // 2. Low Suction Override Loop (Direct Acting: P_suction < P_min => decrease speed to restore suction)
    const minPs = setpoints.minSuctionPressurePa ?? 20e5;
    const errPs = pv.suctionPressurePa - minPs; // Negative when below floor (need to drop speed)
    // Scaled so output only drops when approaching or below floor
    const suctionSpeedRequest = minRpm + Math.max(0, Math.min(maxRpm - minRpm, (errPs / 5e5) * (maxRpm - minRpm)));
    controllerOutputs.suction = suctionSpeedRequest;

    // 3. Driver Power Limiter Loop (Reverse Acting: Power > Max => decrease speed)
    const maxPower = setpoints.maxPowerWatts ?? 15e6;
    const errPower = maxPower - pv.shaftPowerWatts; // Negative when overloaded
    const powerSpeedRequest = errPower < 0 ? Math.max(minRpm, pv.currentSpeedRpm - 200.0) : maxRpm;
    controllerOutputs.power = powerSpeedRequest;

    // 4. Low-Select (MIN) Auctioneering Gate
    let selectedSpeed = controllerOutputs.discharge;
    let controllingVar: ControllingVariable = "DISCHARGE_PRESSURE";

    if (controllerOutputs.suction < selectedSpeed) {
      selectedSpeed = controllerOutputs.suction;
      controllingVar = "SUCTION_OVERRIDE";
    }

    if (controllerOutputs.power < selectedSpeed) {
      selectedSpeed = controllerOutputs.power;
      controllingVar = "POWER_LIMIT";
    }

    // 5. Anti-Windup Tracking: Synchronize non-controlling integrators with active output
    if (controllingVar !== "DISCHARGE_PRESSURE") {
      states.discharge.integral = selectedSpeed;
    }

    const overrideActive = controllingVar !== "DISCHARGE_PRESSURE";

    return {
      commandedSpeedRpm: selectedSpeed,
      controllingVariable: controllingVar,
      overrideActive,
      controllerOutputs,
      states,
    };
  }
}
