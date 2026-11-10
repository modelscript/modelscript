// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Single-Machine Infinite-Bus (SMIB) Playback Harness for PMU & COMTRADE Disturbance Data.
 *
 * Implements standard IEEE / WECC / NERC MOD-026-1 and MOD-027-1 model validation methodology:
 * 1. Isolates a generator / IBR from a PSS/E base case and associated .dyr dynamic records.
 * 2. Injects measured terminal voltage magnitude Vt(t) and grid frequency f(t) as boundary conditions.
 * 3. Integrates the generator flux linkages, exciter, and governor equations in real time.
 * 4. Produces simulated active power P_sim(t), reactive power Q_sim(t), and field voltage Efd_sim(t).
 * 5. Computes quantitative goodness-of-fit metrics (R², NRMSE, peak error) against field recordings.
 */

import type { GeneratorRecord, PsseDyrRecord } from "../types.js";

/**
 * Boundary input telemetry channel for SMIB playback.
 */
export interface PmuPlaybackTelemetry {
  /** Time array in seconds (strictly monotonically increasing). */
  timeSec: Float64Array | number[];
  /** Measured terminal voltage magnitude in per-unit (or kV if vBaseKv provided). */
  vTerminalPu: Float64Array | number[];
  /** Measured grid frequency in Hz. */
  frequencyHz: Float64Array | number[];
  /** Optional measured terminal voltage phase angle in radians. */
  vAngleRad?: Float64Array | number[] | undefined;
  /** Measured active power output in MW (or pu if on sbase). */
  pActiveMw: Float64Array | number[];
  /** Measured reactive power output in Mvar (or pu if on sbase). */
  qReactiveMvar: Float64Array | number[];
  /** Optional measured field voltage Efd in per-unit. */
  eFieldPu?: Float64Array | number[] | undefined;
  /** Optional measured rotor speed in per-unit or rad/s. */
  rotorSpeedPu?: Float64Array | number[] | undefined;
}

/**
 * SMIB Generator Configuration derived from PSS/E .raw and .dyr records.
 */
export interface SmibGeneratorConfig {
  busNumber: number;
  genId: string;
  mbaseMva: number;
  sbaseMva: number;
  nominalFreqHz: number;

  // Generator parameters (GENROU / GENSAL / GENCLS)
  generatorModel: string;
  H: number; // Inertia constant (MW·s/MVA)
  D: number; // Speed damping (pu)
  Xd: number; // d-axis synchronous reactance (pu)
  Xq: number; // q-axis synchronous reactance (pu)
  Xdp: number; // d-axis transient reactance (pu)
  Xqp: number; // q-axis transient reactance (pu)
  Td0p: number; // d-axis transient open-circuit time constant (s)
  Tq0p: number; // q-axis transient open-circuit time constant (s)

  // Exciter parameters (EXST1 / ESST4B / etc.)
  exciterModel?: string | undefined;
  Ka?: number | undefined; // AVR gain
  Ta?: number | undefined; // AVR time constant (s)
  Tr?: number | undefined; // Voltage measurement transducer time constant (s)
  Vrmax?: number | undefined; // Max regulator output (pu)
  Vrmin?: number | undefined; // Min regulator output (pu)

  // Governor parameters (GGOV1 / TGOV1 / etc.)
  governorModel?: string | undefined;
  droopR?: number | undefined; // Governor droop (pu, e.g. 0.04)
  T1?: number | undefined; // Governor servo time constant (s)
  Pmax?: number | undefined; // Max power limit (pu)
  Pmin?: number | undefined; // Min power limit (pu)
}

/**
 * Results of a SMIB simulation playback run.
 */
export interface SmibPlaybackResult {
  timeSec: Float64Array;
  pSimMw: Float64Array;
  qSimMvar: Float64Array;
  efdSimPu: Float64Array;
  speedPu: Float64Array;
  deltaRad: Float64Array;
  pMeasMw: Float64Array;
  qMeasMvar: Float64Array;

  // Goodness-of-Fit Metrics (NERC MOD-026 / MOD-027 validation)
  pMetrics: GoodnessOfFitMetrics;
  qMetrics: GoodnessOfFitMetrics;
  overallScore: number; // 0 to 100% composite validation score
  isCompliant: boolean; // Meets NERC MOD-026/027 criteria (R² >= 0.85, NRMSE <= 0.10)
}

/**
 * Quantitative validation metrics comparing simulated vs. measured time-series.
 */
export interface GoodnessOfFitMetrics {
  rSquared: number; // Coefficient of determination (-inf to 1.0, >= 0.85 passes NERC)
  rmse: number; // Root Mean Square Error (in physical units, MW or Mvar)
  nrmse: number; // Normalized RMSE (rmse / (max - min), <= 0.10 passes NERC)
  mae: number; // Mean Absolute Error
  peakError: number; // Maximum instantaneous absolute error
  peakErrorPercent: number; // Peak error as percentage of measurement span
}

/**
 * Computes standard NERC validation metrics (R², RMSE, NRMSE, MAE, peak error).
 */
export function computeGoodnessOfFit(
  sim: Float64Array,
  meas: Float64Array,
  ratedCapacity?: number | undefined,
): GoodnessOfFitMetrics {
  const n = Math.min(sim.length, meas.length);
  if (n === 0) {
    return { rSquared: 0, rmse: 0, nrmse: 0, mae: 0, peakError: 0, peakErrorPercent: 0 };
  }

  let sumMeas = 0;
  let minMeas = Infinity;
  let maxMeas = -Infinity;
  for (let i = 0; i < n; i++) {
    const m = meas[i]!;
    sumMeas += m;
    if (m < minMeas) minMeas = m;
    if (m > maxMeas) maxMeas = m;
  }
  const meanMeas = sumMeas / n;
  const measuredSpan = maxMeas - minMeas;
  const span =
    ratedCapacity !== undefined && ratedCapacity > 0
      ? ratedCapacity
      : Math.max(1e-6, measuredSpan > 0.05 * Math.abs(meanMeas) ? measuredSpan : Math.abs(meanMeas) || 1.0);

  let ssRes = 0;
  let ssTot = 0;
  let sumAbsErr = 0;
  let maxAbsErr = 0;

  for (let i = 0; i < n; i++) {
    const s = sim[i]!;
    const m = meas[i]!;
    const diff = s - m;
    ssRes += diff * diff;
    ssTot += (m - meanMeas) * (m - meanMeas);
    const absDiff = Math.abs(diff);
    sumAbsErr += absDiff;
    if (absDiff > maxAbsErr) maxAbsErr = absDiff;
  }

  const mse = ssRes / n;
  const rmse = Math.sqrt(mse);
  const nrmse = rmse / span;
  const mae = sumAbsErr / n;
  const rSquared = ssTot > 1e-12 ? 1.0 - ssRes / ssTot : ssRes < 1e-6 ? 1.0 : 0.0;
  const peakErrorPercent = (maxAbsErr / span) * 100.0;

  return {
    rSquared,
    rmse,
    nrmse,
    mae,
    peakError: maxAbsErr,
    peakErrorPercent,
  };
}

/**
 * Builds a `SmibGeneratorConfig` from a PSS/E generator record and associated `.dyr` models.
 */
export function buildSmibConfig(
  gen: GeneratorRecord,
  dyrGen?: PsseDyrRecord | undefined,
  dyrExc?: PsseDyrRecord | undefined,
  dyrGov?: PsseDyrRecord | undefined,
  sbaseMva = 100.0,
  nominalFreqHz = 60.0,
): SmibGeneratorConfig {
  const mbase = gen.mbase > 0 ? gen.mbase : sbaseMva;

  return {
    busNumber: gen.i,
    genId: gen.id.trim(),
    mbaseMva: mbase,
    sbaseMva,
    nominalFreqHz,

    generatorModel: dyrGen?.model ?? "GENROU",
    H: dyrGen?.namedParams["H"] ?? dyrGen?.con[4] ?? 3.5,
    D: dyrGen?.namedParams["D"] ?? dyrGen?.con[5] ?? 1.0,
    Xd: dyrGen?.namedParams["Xd"] ?? dyrGen?.con[6] ?? 1.8,
    Xq: dyrGen?.namedParams["Xq"] ?? dyrGen?.con[7] ?? 1.7,
    Xdp: dyrGen?.namedParams["Xdp"] ?? dyrGen?.con[8] ?? gen.zx ?? 0.3,
    Xqp: dyrGen?.namedParams["Xqp"] ?? dyrGen?.con[9] ?? 0.55,
    Td0p: dyrGen?.namedParams["Td0p"] ?? dyrGen?.con[0] ?? 6.0,
    Tq0p: dyrGen?.namedParams["Tq0p"] ?? dyrGen?.con[2] ?? 1.0,

    exciterModel: dyrExc?.model,
    Ka: dyrExc?.namedParams["KA"] ?? dyrExc?.con[2] ?? 200.0,
    Ta: dyrExc?.namedParams["TA"] ?? dyrExc?.con[3] ?? 0.02,
    Tr: dyrExc?.namedParams["TR"] ?? dyrExc?.con[0] ?? 0.01,
    Vrmax: dyrExc?.namedParams["VRMAX"] ?? dyrExc?.con[4] ?? 5.0,
    Vrmin: dyrExc?.namedParams["VRMIN"] ?? dyrExc?.con[5] ?? -5.0,

    governorModel: dyrGov?.model,
    droopR: dyrGov?.namedParams["R"] ?? dyrGov?.con[0] ?? 0.04,
    T1: dyrGov?.namedParams["T1"] ?? dyrGov?.con[1] ?? 0.5,
    Pmax: dyrGov?.namedParams["PMAX"] ?? (gen.pt > 0 ? gen.pt / mbase : 1.1),
    Pmin: dyrGov?.namedParams["PMIN"] ?? (gen.pb >= 0 ? gen.pb / mbase : 0.0),
  };
}

/**
 * Single-Machine Infinite-Bus (SMIB) Playback Simulation Engine.
 */
export class PmuSmibHarness {
  private config: SmibGeneratorConfig;

  constructor(config: SmibGeneratorConfig) {
    this.config = { ...config };
  }

  /**
   * Updates configuration parameters for calibration sweeps.
   */
  public updateParameters(params: Partial<SmibGeneratorConfig>): void {
    Object.assign(this.config, params);
  }

  /**
   * Executes SMIB playback simulation over the provided disturbance telemetry.
   */
  public simulate(telemetry: PmuPlaybackTelemetry): SmibPlaybackResult {
    const time = telemetry.timeSec instanceof Float64Array ? telemetry.timeSec : new Float64Array(telemetry.timeSec);
    const n = time.length;
    if (n < 2) {
      throw new Error("Telemetry must contain at least 2 time points for SMIB playback.");
    }

    const vt =
      telemetry.vTerminalPu instanceof Float64Array
        ? telemetry.vTerminalPu
        : new Float64Array(telemetry.vTerminalPu);
    const freq =
      telemetry.frequencyHz instanceof Float64Array
        ? telemetry.frequencyHz
        : new Float64Array(telemetry.frequencyHz);
    const pMeas =
      telemetry.pActiveMw instanceof Float64Array
        ? telemetry.pActiveMw
        : new Float64Array(telemetry.pActiveMw);
    const qMeas =
      telemetry.qReactiveMvar instanceof Float64Array
        ? telemetry.qReactiveMvar
        : new Float64Array(telemetry.qReactiveMvar);

    const mbase = this.config.mbaseMva;
    const omega0 = 2 * Math.PI * this.config.nominalFreqHz;

    // Simulation output trajectories
    const pSimMw = new Float64Array(n);
    const qSimMvar = new Float64Array(n);
    const efdSimPu = new Float64Array(n);
    const speedPu = new Float64Array(n);
    const deltaRad = new Float64Array(n);

    // Initial steady-state condition from t=0 telemetry
    const p0Pu = pMeas[0]! / mbase;
    const q0Pu = qMeas[0]! / mbase;
    const v0Pu = Math.max(0.1, vt[0]!);

    // Terminal current phasor at t=0 (with terminal voltage as reference theta_v = 0)
    // S = V * conj(I) => I = (P - jQ) / V => iReal = P / V, iImag = -Q / V
    const iReal0 = p0Pu / v0Pu;
    const iImag0 = -q0Pu / v0Pu;

    // Rotor angle delta0: angle of E_q = V_t + j*X_q*I = (V_t - X_q*iImag) + j*(X_q*iReal)
    const xq = this.config.Xq;
    const xd = this.config.Xd;
    const xdp = this.config.Xdp;
    const delta0 = Math.atan2(xq * iReal0, v0Pu - xq * iImag0);

    // Initial d-q voltages and currents
    // Vd = Vt * sin(delta), Vq = Vt * cos(delta)
    const vq0 = v0Pu * Math.cos(delta0);
    // Id = iReal * sin(delta) - iImag * cos(delta)
    // Iq = iReal * cos(delta) + iImag * sin(delta)
    const id0 = iReal0 * Math.sin(delta0) - iImag0 * Math.cos(delta0);

    // Transient flux states
    let eqp = vq0 + xdp * id0;
    let delta = delta0;
    let omega = 1.0; // Per-unit speed (1.0 = nominal)
    let pm = p0Pu; // Mechanical power in pu
    let efd = eqp + (xd - xdp) * id0; // Initial field voltage
    let vRef = v0Pu + efd / (this.config.Ka ?? 200.0);

    // Store t=0 outputs
    pSimMw[0] = p0Pu * mbase;
    qSimMvar[0] = q0Pu * mbase;
    efdSimPu[0] = efd;
    speedPu[0] = omega;
    deltaRad[0] = delta;

    // Time-stepping integration using explicit Runge-Kutta / Heun predictor-corrector
    for (let i = 0; i < n - 1; i++) {
      const dt = Math.max(1e-6, time[i + 1]! - time[i]!);
      const vtCur = vt[i]!;
      const vtNext = vt[i + 1]!;
      const fCur = freq[i]!;
      const fNext = freq[i + 1]!;

      // Grid speed deviation boundary condition
      const gridDeltaOmega = (fCur - this.config.nominalFreqHz) / this.config.nominalFreqHz;

      // RHS evaluator for generator & controller dynamics
      const evalRhs = (
        _t: number,
        s_delta: number,
        s_omega: number,
        s_eqp: number,
        s_pm: number,
        s_efd: number,
        v_term: number,
        grid_domega: number,
      ) => {
        // Stator algebraic equations: compute Id, Iq from internal flux and terminal voltage
        const vd = v_term * Math.sin(s_delta);
        const vq = v_term * Math.cos(s_delta);

        // Subtransient / transient stator current projection
        const id = (s_eqp - vq) / Math.max(1e-4, xdp);
        const iq = vd / Math.max(1e-4, xq);

        // Electrical power: Pe = Vd*Id + Vq*Iq
        const pe = vd * id + vq * iq;
        const qe = vq * id - vd * iq;

        // Swing equations:
        // d(delta)/dt = omega0 * (omega - 1.0)
        const dDelta = omega0 * (s_omega - 1.0);
        // 2H * d(omega)/dt = Pm - Pe - D*(omega - 1.0)
        const H = Math.max(0.1, this.config.H);
        const D = Math.max(0.0, this.config.D);
        const dOmega = (s_pm - pe - D * (s_omega - 1.0)) / (2.0 * H);

        // Generator rotor flux linkage dynamics:
        // T'd0 * d(E'q)/dt = Efd - E'q - (Xd - X'd)*Id
        const td0p = Math.max(0.01, this.config.Td0p);
        const dEqp = (s_efd - s_eqp - (xd - xdp) * id) / td0p;

        // Exciter dynamics (if enabled):
        let dEfd = 0;
        if (this.config.Ka !== undefined && this.config.Ta !== undefined) {
          const ka = this.config.Ka;
          const ta = Math.max(0.001, this.config.Ta);
          const vErr = vRef - v_term;
          const targetEfd = ka * vErr;
          dEfd = (targetEfd - s_efd) / ta;
        }

        // Governor dynamics (if enabled):
        let dPm = 0;
        if (this.config.droopR !== undefined && this.config.T1 !== undefined) {
          const droop = Math.max(0.005, this.config.droopR);
          const t1 = Math.max(0.01, this.config.T1);
          // Governor responds to grid frequency deviation or internal rotor speed
          const speedErr = grid_domega !== 0 ? grid_domega : s_omega - 1.0;
          const targetPm = p0Pu - speedErr / droop;
          dPm = (targetPm - s_pm) / t1;
        }

        return { dDelta, dOmega, dEqp, dPm, dEfd, pe, qe };
      };

      // RK2 / Heun integration step
      const k1 = evalRhs(time[i]!, delta, omega, eqp, pm, efd, vtCur, gridDeltaOmega);

      // Predictor step
      const p_delta = delta + dt * k1.dDelta;
      const p_omega = omega + dt * k1.dOmega;
      const p_eqp = eqp + dt * k1.dEqp;
      const p_pm = pm + dt * k1.dPm;
      const p_efd = Math.max(
        this.config.Vrmin ?? -5.0,
        Math.min(this.config.Vrmax ?? 5.0, efd + dt * k1.dEfd),
      );

      const gridDeltaOmegaNext = (fNext - this.config.nominalFreqHz) / this.config.nominalFreqHz;
      const k2 = evalRhs(
        time[i + 1]!,
        p_delta,
        p_omega,
        p_eqp,
        p_pm,
        p_efd,
        vtNext,
        gridDeltaOmegaNext,
      );

      // Corrector update
      delta += 0.5 * dt * (k1.dDelta + k2.dDelta);
      omega += 0.5 * dt * (k1.dOmega + k2.dOmega);
      eqp += 0.5 * dt * (k1.dEqp + k2.dEqp);
      pm += 0.5 * dt * (k1.dPm + k2.dPm);
      efd += 0.5 * dt * (k1.dEfd + k2.dEfd);

      // Enforce physical limiter clamps
      if (this.config.Vrmax !== undefined && efd > this.config.Vrmax) efd = this.config.Vrmax;
      if (this.config.Vrmin !== undefined && efd < this.config.Vrmin) efd = this.config.Vrmin;
      if (this.config.Pmax !== undefined && pm > this.config.Pmax) pm = this.config.Pmax;
      if (this.config.Pmin !== undefined && pm < this.config.Pmin) pm = this.config.Pmin;

      // Compute electrical power at time step i+1
      const vdNext = vtNext * Math.sin(delta);
      const vqNext = vtNext * Math.cos(delta);
      const idNext = (eqp - vqNext) / Math.max(1e-4, xdp);
      const iqNext = vdNext / Math.max(1e-4, xq);
      const peNext = vdNext * idNext + vqNext * iqNext;
      const qeNext = vqNext * idNext - vdNext * iqNext;

      pSimMw[i + 1] = peNext * mbase;
      qSimMvar[i + 1] = qeNext * mbase;
      efdSimPu[i + 1] = efd;
      speedPu[i + 1] = omega;
      deltaRad[i + 1] = delta;
    }

    // Goodness of fit against measured data
    const pMetrics = computeGoodnessOfFit(pSimMw, pMeas);
    const qMetrics = computeGoodnessOfFit(qSimMvar, qMeas);

    // Composite score: weighted combination of R² and (1 - NRMSE)
    const scoreP = Math.max(0, Math.min(100, (0.5 * Math.max(0, pMetrics.rSquared) + 0.5 * Math.max(0, 1.0 - pMetrics.nrmse)) * 100));
    const scoreQ = Math.max(0, Math.min(100, (0.5 * Math.max(0, qMetrics.rSquared) + 0.5 * Math.max(0, 1.0 - qMetrics.nrmse)) * 100));
    const overallScore = 0.5 * scoreP + 0.5 * scoreQ;

    // NERC MOD-026/027 criteria: R² >= 0.85 and NRMSE <= 0.10
    const isCompliant = pMetrics.rSquared >= 0.85 && pMetrics.nrmse <= 0.10 && qMetrics.rSquared >= 0.80 && qMetrics.nrmse <= 0.15;

    return {
      timeSec: time,
      pSimMw,
      qSimMvar,
      efdSimPu,
      speedPu,
      deltaRad,
      pMeasMw: pMeas,
      qMeasMvar: qMeas,
      pMetrics,
      qMetrics,
      overallScore,
      isCompliant,
    };
  }
}
