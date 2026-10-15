// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Multi-Rate Co-Simulation Orchestrator.
 *
 * Coordinates multi-rate coupling between microsecond electromagnetic transient
 * (EMT) companion solvers (Delta t_fast = 10-50 us) and millisecond continuous
 * mechanical, thermal, and supervisory controllers (Delta t_slow = 1-10 ms).
 *
 * Mathematical Principles:
 * 1. Fast-to-Slow Decimation (Power & RMS Filtering):
 *    V_rms = sqrt( 1/T * integral_{t-T}^t v(tau)^2 d tau )
 *    P_avg = 1/T * integral_{t-T}^t v(tau) * i(tau) d tau
 *    Q_avg = sqrt( max(0, (V_rms * I_rms)^2 - P_avg^2) )
 *
 * 2. Slow-to-Fast Interpolation:
 *    u(t) = u(t_k) + ((t - t_k) / Delta t_slow) * (u(t_{k+1}) - u(t_k))
 *    Prevents discrete step discontinuities from exciting numerical LC chatter.
 */

export interface MultiRateCosimOptions {
  dtFastSec: number; // e.g. 20e-6 s (20 us)
  dtSlowSec: number; // e.g. 1e-3 s (1 ms)
  gridFrequencyHz?: number | undefined; // 50 or 60 Hz
}

export interface MacroStepSnapshot {
  timeSec: number;
  fastSubSteps: number;
  vRms: number;
  iRms: number;
  activePowerMw: number;
  reactivePowerMvar: number;
  slowOutputs: Record<string, number>;
}

export type SlowSystemStepFn = (
  time: number,
  inputs: { vRms: number; iRms: number; pMw: number; qMvar: number },
) => Record<string, number>;

export interface FmuCoSimSlave {
  id: string;
  setReal(inputs: Record<string, number>): void;
  doStep(currentCommunicationPoint: number, communicationStepSize: number): boolean;
  getReal(outputNames: string[]): Record<string, number>;
}

export class MultiRateCosimOrchestrator {
  public readonly dtFast: number;
  public readonly dtSlow: number;
  public readonly subStepsPerMacro: number;
  public readonly windowSizeSamples: number;

  private currentTime = 0;
  // Circular buffers for true RMS and power calculation over 1 AC period
  private vSquaredBuffer: Float64Array;
  private iSquaredBuffer: Float64Array;
  private pBuffer: Float64Array;
  private bufferIdx = 0;
  private sumVSquared = 0;
  private sumISquared = 0;
  private sumP = 0;

  // Slow control inputs interpolated into fast steps
  private currentSlowOutputs: Record<string, number> = {};
  private nextSlowOutputs: Record<string, number> = {};

  constructor(options: MultiRateCosimOptions) {
    this.dtFast = options.dtFastSec;
    this.dtSlow = options.dtSlowSec;
    this.subStepsPerMacro = Math.max(1, Math.round(this.dtSlow / this.dtFast));

    const freq = options.gridFrequencyHz ?? 60.0;
    const periodSec = 1.0 / freq;
    this.windowSizeSamples = Math.max(2, Math.round(periodSec / this.dtFast));

    this.vSquaredBuffer = new Float64Array(this.windowSizeSamples);
    this.iSquaredBuffer = new Float64Array(this.windowSizeSamples);
    this.pBuffer = new Float64Array(this.windowSizeSamples);
  }

  /**
   * Ingests a single microsecond fast EMT voltage and current sample.
   * Updates sliding RMS and power estimators with O(1) computational cost.
   */
  ingestFastSample(
    vInstantaneous: number,
    iInstantaneous: number,
  ): {
    vRms: number;
    iRms: number;
    pMw: number;
    qMvar: number;
  } {
    const v2 = vInstantaneous * vInstantaneous;
    const i2 = iInstantaneous * iInstantaneous;
    const pInst = vInstantaneous * iInstantaneous;

    // Subtract oldest sample in window
    this.sumVSquared -= this.vSquaredBuffer[this.bufferIdx]!;
    this.sumISquared -= this.iSquaredBuffer[this.bufferIdx]!;
    this.sumP -= this.pBuffer[this.bufferIdx]!;

    // Add newest sample
    this.sumVSquared += v2;
    this.sumISquared += i2;
    this.sumP += pInst;

    this.vSquaredBuffer[this.bufferIdx] = v2;
    this.iSquaredBuffer[this.bufferIdx] = i2;
    this.pBuffer[this.bufferIdx] = pInst;

    this.bufferIdx = (this.bufferIdx + 1) % this.windowSizeSamples;

    // Periodically recompute exact sums once per AC cycle to prevent floating-point drift
    if (this.bufferIdx === 0) {
      let sv = 0;
      let si = 0;
      let sp = 0;
      for (let k = 0; k < this.windowSizeSamples; k++) {
        sv += this.vSquaredBuffer[k]!;
        si += this.iSquaredBuffer[k]!;
        sp += this.pBuffer[k]!;
      }
      this.sumVSquared = sv;
      this.sumISquared = si;
      this.sumP = sp;
    }

    const n = this.windowSizeSamples;
    const vRms = Math.sqrt(Math.max(0, this.sumVSquared / n));
    const iRms = Math.sqrt(Math.max(0, this.sumISquared / n));
    const pAvg = this.sumP / n;
    const sApparent = vRms * iRms;
    const qAvg = Math.sqrt(Math.max(0, sApparent * sApparent - pAvg * pAvg));

    return {
      vRms,
      iRms,
      pMw: pAvg * 1e-6,
      qMvar: qAvg * 1e-6,
    };
  }

  /**
   * Linearly interpolates a slow scalar variable at sub-step index k (0 <= k < subStepsPerMacro).
   */
  interpolateSlowSignal(key: string, subStepIdx: number): number {
    const v0 = this.currentSlowOutputs[key] ?? 0;
    const v1 = this.nextSlowOutputs[key] ?? v0;
    const fraction = subStepIdx / this.subStepsPerMacro;
    return v0 + fraction * (v1 - v0);
  }

  /**
   * Advances one macro-step of co-simulation duration dtSlow:
   * 1. Evaluates slow subsystem using filtered RMS/Power from previous window
   * 2. Loops through N microsecond sub-steps
   * 3. Collects macro snapshot
   */
  stepMacro(
    stepFastFn: (t: number, slowInputs: Record<string, number>) => { v: number; i: number },
    stepSlowFn: SlowSystemStepFn,
  ): MacroStepSnapshot {
    // Current filtered state
    const n = this.windowSizeSamples;
    const vRms = Math.sqrt(Math.max(0, this.sumVSquared / n));
    const iRms = Math.sqrt(Math.max(0, this.sumISquared / n));
    const pMw = (this.sumP / n) * 1e-6;
    const sApparent = vRms * iRms * 1e-6;
    const qMvar = Math.sqrt(Math.max(0, sApparent * sApparent - pMw * pMw));

    // Evaluate slow participant
    this.currentSlowOutputs = { ...this.nextSlowOutputs };
    this.nextSlowOutputs = stepSlowFn(this.currentTime + this.dtSlow, {
      vRms,
      iRms,
      pMw,
      qMvar,
    });

    // Run N microsecond fast sub-steps
    let lastVRms = vRms;
    let lastIRms = iRms;
    let lastPMw = pMw;
    let lastQMvar = qMvar;

    for (let k = 0; k < this.subStepsPerMacro; k++) {
      const tFast = this.currentTime + k * this.dtFast;

      // Build interpolated input vector for fast step
      const interpolatedInputs: Record<string, number> = {};
      for (const key of Object.keys(this.nextSlowOutputs)) {
        interpolatedInputs[key] = this.interpolateSlowSignal(key, k);
      }

      // Step fast EMT
      const { v, i } = stepFastFn(tFast, interpolatedInputs);
      const metrics = this.ingestFastSample(v, i);
      lastVRms = metrics.vRms;
      lastIRms = metrics.iRms;
      lastPMw = metrics.pMw;
      lastQMvar = metrics.qMvar;
    }

    this.currentTime += this.dtSlow;

    return {
      timeSec: this.currentTime,
      fastSubSteps: this.subStepsPerMacro,
      vRms: lastVRms,
      iRms: lastIRms,
      activePowerMw: lastPMw,
      reactivePowerMvar: lastQMvar,
      slowOutputs: { ...this.nextSlowOutputs },
    };
  }

  /**
   * Advances one macro-step using a standard FMI 2.0/3.0 Co-Simulation slave instance (`FmuCoSimSlave`)
   * with linear sub-cycle boundary interpolation between the slow FMU communication step (`dtSlow`)
   * and the fast microsecond EMT step (`dtFast`).
   */
  stepMacroWithFmu(
    stepFastFn: (t: number, slowInputs: Record<string, number>) => { v: number; i: number },
    fmuSlave: FmuCoSimSlave,
    outputNames: string[] = ["pSetpointMw", "qSetpointMvar", "iInjected"],
  ): MacroStepSnapshot {
    return this.stepMacro(stepFastFn, (tNext, inputs) => {
      fmuSlave.setReal(inputs);
      fmuSlave.doStep(tNext - this.dtSlow, this.dtSlow);
      return fmuSlave.getReal(outputNames);
    });
  }
}
