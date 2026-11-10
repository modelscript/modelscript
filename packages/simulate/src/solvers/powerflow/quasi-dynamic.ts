// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/powerflow — Quasi-Dynamic Simulation (QDSL / Time-Series) Engine.
 *
 * Implements DIgSILENT PowerFactory ComQdsl parity:
 * - 24-hour and multi-day time-series AC power flow with solar PV and wind generation profiles
 * - Time-varying load profiles (active and reactive power multipliers)
 * - Battery Energy Storage System (BESS) charge/discharge scheduling and State of Charge (SoC) tracking
 * - Automatic On-Load Tap Changer (OLTC) voltage regulation and deadband stepping
 * - Aggregate energy metrics: MWh delivered, MWh losses, voltage envelope, and peak branch loading
 */

import { solveLinearSystemSparse } from "../sparse-solver-bridge.js";
import type { GenericPowerCase } from "../opf/types.js";

/**
 * Normalized or physical time-series profile for load or generation.
 */
export interface QdslProfile {
  name: string;
  /** Time points in hours or seconds (must be monotonically increasing). */
  timePoints: number[];
  /** Values at corresponding time points (e.g. per-unit multipliers or MW). */
  values: number[];
  /** Interpolation mode (default: 'linear'). */
  interpolation?: "linear" | "step" | undefined;
}

/**
 * Battery Energy Storage System (BESS) configuration and state.
 */
export interface QdslBessConfig {
  busNumber: number;
  genId: string;
  /** Rated energy capacity in MWh. */
  ratedCapacityMwh: number;
  /** Maximum continuous charge power in MW (positive). */
  maxChargePowerMw: number;
  /** Maximum continuous discharge power in MW (positive). */
  maxDischargePowerMw: number;
  /** Initial State of Charge (0.0 to 1.0). */
  initialSoc: number;
  /** Minimum allowable SoC (default: 0.10). */
  minSoc?: number | undefined;
  /** Maximum allowable SoC (default: 0.90). */
  maxSoc?: number | undefined;
  /** One-way charging round-trip efficiency (default: 0.95). */
  chargeEfficiency?: number | undefined;
  /** One-way discharging round-trip efficiency (default: 0.95). */
  dischargeEfficiency?: number | undefined;
  /** Schedule profile (positive MW = charging from grid, negative MW = discharging to grid). */
  scheduleProfile?: QdslProfile | undefined;
}

/**
 * On-Load Tap Changer (OLTC) configuration for automatic transformer voltage control.
 */
export interface QdslTapChangerConfig {
  transformerIndex: number;
  fromBus: number;
  toBus: number;
  /** Controlled bus number (default: toBus). */
  controlledBus: number;
  /** Target voltage setpoint in per-unit (default: 1.00 p.u.). */
  targetVoltagePu: number;
  /** Voltage control deadband in per-unit (default: 0.015 p.u. = ±1.5%). */
  deadbandPu: number;
  /** Tap step size in per-unit ratio (default: 0.00625 = 5/8%). */
  stepSizeRatio: number;
  /** Minimum allowable off-nominal tap ratio (default: 0.90). */
  minTapRatio: number;
  /** Maximum allowable off-nominal tap ratio (default: 1.10). */
  maxTapRatio: number;
}

/**
 * Options for the Quasi-Dynamic Simulation run.
 */
export interface QdslOptions {
  /** Time step duration in hours (default: 1.0 hr). */
  timeStepHours?: number | undefined;
  /** Simulation duration in hours or array of explicit evaluation timestamps in hours. */
  durationHours?: number | undefined;
  /** Explicit time steps in hours (overrides durationHours if provided). */
  timeSteps?: number[] | undefined;
  /** Default load scaling profile if specific load profile not mapped. */
  defaultLoadProfile?: QdslProfile | undefined;
  /** Specific load scaling profile mapped by busNumber or `bus_loadId`. */
  loadProfiles?: Map<string | number, QdslProfile> | undefined;
  /** Generator generation profiles mapped by busNumber or `bus_genId` (e.g. PV / Wind). */
  generationProfiles?: Map<string | number, QdslProfile> | undefined;
  /** Battery energy storage systems to simulate. */
  batteries?: QdslBessConfig[] | undefined;
  /** Active transformer tap changers. */
  tapChangers?: QdslTapChangerConfig[] | undefined;
  /** Maximum Newton-Raphson power flow iterations per time step (default: 30). */
  maxIterations?: number | undefined;
  /** Newton-Raphson active/reactive mismatch convergence tolerance in per-unit (default: 1e-4). */
  tolerance?: number | undefined;
}

/**
 * Single time-step solution state.
 */
export interface QdslStepResult {
  stepIndex: number;
  timeHours: number;
  converged: boolean;
  iterations: number;
  busVoltages: Map<number, number>;
  busAnglesRad: Map<number, number>;
  branchLoadingsPercent: number[];
  totalGenActiveMw: number;
  totalGenReactiveMvar: number;
  totalLoadActiveMw: number;
  totalLoadReactiveMvar: number;
  totalLossesActiveMw: number;
  totalLossesReactiveMvar: number;
  bessStates?: Array<{
    busNumber: number;
    genId: string;
    soc: number;
    powerMw: number;
  }> | undefined;
  tapPositions?: Array<{
    transformerIndex: number;
    tapRatio: number;
  }> | undefined;
}

/**
 * Complete Quasi-Dynamic Simulation results over the full time horizon.
 */
export interface QdslResult {
  steps: QdslStepResult[];
  timeStepsHours: number[];
  totalEnergySuppliedMwh: number;
  totalEnergyLossesMwh: number;
  lossPercentage: number;
  minVoltagePu: number;
  minVoltageBus: number;
  minVoltageTimeHours: number;
  maxVoltagePu: number;
  maxVoltageBus: number;
  maxVoltageTimeHours: number;
  maxBranchLoadingPercent: number;
  maxLoadingBranchIndex: number;
  maxLoadingTimeHours: number;
}

/**
 * Evaluates a QdslProfile at an arbitrary timestamp via linear or step interpolation.
 */
export function evaluateProfile(profile: QdslProfile, t: number): number {
  const pts = profile.timePoints;
  const vals = profile.values;
  const n = pts.length;
  if (n === 0) return 1.0;
  if (n === 1 || t <= pts[0]!) return vals[0]!;
  if (t >= pts[n - 1]!) return vals[n - 1]!;

  let low = 0;
  let high = n - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (pts[mid]! <= t) {
      if (mid === n - 1 || pts[mid + 1]! > t) {
        low = mid;
        break;
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const i = Math.max(0, Math.min(n - 2, low));
  if (profile.interpolation === "step") {
    return vals[i]!;
  }
  const t0 = pts[i]!;
  const t1 = pts[i + 1]!;
  const dt = t1 - t0;
  const frac = dt > 1e-9 ? (t - t0) / dt : 0;
  return vals[i]! + frac * (vals[i + 1]! - vals[i]!);
}

/**
 * Executes a Quasi-Dynamic (time-series) power flow simulation on a GenericPowerCase.
 */
export function runQuasiDynamicSimulation(
  baseCase: GenericPowerCase,
  options: QdslOptions = {},
): QdslResult {
  const sbase = baseCase.header.sbase > 0 ? baseCase.header.sbase : 100.0;
  const dt = options.timeStepHours ?? 1.0;
  const maxIter = options.maxIterations ?? 30;
  const tol = options.tolerance ?? 1e-4;

  // Determine time horizon steps
  let timeSteps: number[] = [];
  if (options.timeSteps && options.timeSteps.length > 0) {
    timeSteps = options.timeSteps;
  } else {
    const dur = options.durationHours ?? 24.0;
    const numSteps = Math.max(1, Math.round(dur / dt));
    for (let k = 0; k < numSteps; k++) {
      timeSteps.push(k * dt);
    }
  }

  // Map buses
  const busNumbers = Array.from(baseCase.buses.keys()).sort((a, b) => a - b);
  const N = busNumbers.length;
  const busIdxMap = new Map<number, number>();
  let slackIdx = 0;

  for (let i = 0; i < N; i++) {
    const bNum = busNumbers[i]!;
    busIdxMap.set(bNum, i);
    const b = baseCase.buses.get(bNum);
    if (b && (b.ide === 3 || b.ide === 4)) {
      slackIdx = i;
    }
  }

  // Identify PV buses (generators with ide === 2 and non-slack)
  const isPvBus = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const b = baseCase.buses.get(busNumbers[i]!);
    if (i !== slackIdx && b && b.ide === 2) {
      isPvBus[i] = 1;
    }
  }

  // Index maps for Newton-Raphson unknowns
  const nonSlackIndices: number[] = [];
  const pqIndices: number[] = [];
  const busToPIdx = new Int32Array(N).fill(-1);
  const busToQIdx = new Int32Array(N).fill(-1);

  for (let i = 0; i < N; i++) {
    if (i !== slackIdx) {
      busToPIdx[i] = nonSlackIndices.length;
      nonSlackIndices.push(i);
    }
    if (i !== slackIdx && !isPvBus[i]) {
      busToQIdx[i] = pqIndices.length;
      pqIndices.push(i);
    }
  }

  const nP = nonSlackIndices.length;
  const nQ = pqIndices.length;
  const nVars = nP + nQ;

  // Map generators
  const baseGens = baseCase.generators.map((g) => ({
    busNumber: g.i,
    id: g.id,
    busIdx: busIdxMap.get(g.i) ?? 0,
    pgBaseMw: g.pg,
    qgBaseMvar: g.qg,
    stat: g.stat ?? 1,
  }));

  // Map loads
  const baseLoads = baseCase.loads.map((l) => ({
    busNumber: l.i,
    busIdx: busIdxMap.get(l.i) ?? 0,
    plBaseMw: l.pl,
    qlBaseMvar: l.ql,
    status: l.status ?? 1,
  }));

  // Initialize BESS state trackers
  interface BessRuntimeState {
    config: QdslBessConfig;
    soc: number;
    currentPowerMw: number;
  }
  const bessStates: BessRuntimeState[] = (options.batteries ?? []).map((b) => ({
    config: b,
    soc: Math.max(0, Math.min(1.0, b.initialSoc)),
    currentPowerMw: 0.0,
  }));

  // Initialize Tap Changer states
  interface TapChangerRuntimeState {
    config: QdslTapChangerConfig;
    currentTapRatio: number;
  }
  const tapStates: TapChangerRuntimeState[] = (options.tapChangers ?? []).map((tc) => ({
    config: tc,
    currentTapRatio: 1.0,
  }));

  const branches = baseCase.branches;
  const transformers = baseCase.transformers ?? [];

  // Helper to build Ybus with current tap changer positions
  function buildYbus(taps: TapChangerRuntimeState[]): { Gbus: Float64Array; Bbus: Float64Array } {
    const Gbus = new Float64Array(N * N);
    const Bbus = new Float64Array(N * N);

    for (const br of branches) {
      if ((br.st ?? 1) === 0) continue;
      const fromIdx = busIdxMap.get(br.i);
      const toIdx = busIdxMap.get(br.j);
      if (fromIdx === undefined || toIdx === undefined) continue;

      const r = br.r;
      const x = br.x;
      const bShunt = (br.b ?? 0) / 2.0;
      const z2 = r * r + x * x;
      if (z2 < 1e-12) continue;

      const gSeries = r / z2;
      const bSeries = -x / z2;

      const f_t = fromIdx * N + toIdx;
      const t_f = toIdx * N + fromIdx;
      const f_f = fromIdx * N + fromIdx;
      const t_t = toIdx * N + toIdx;

      Gbus[f_t] = (Gbus[f_t] ?? 0) - gSeries;
      Bbus[f_t] = (Bbus[f_t] ?? 0) - bSeries;
      Gbus[t_f] = (Gbus[t_f] ?? 0) - gSeries;
      Bbus[t_f] = (Bbus[t_f] ?? 0) - bSeries;

      Gbus[f_f] = (Gbus[f_f] ?? 0) + gSeries;
      Bbus[f_f] = (Bbus[f_f] ?? 0) + bSeries + bShunt;
      Gbus[t_t] = (Gbus[t_t] ?? 0) + gSeries;
      Bbus[t_t] = (Bbus[t_t] ?? 0) + bSeries + bShunt;
    }

    for (let trIdx = 0; trIdx < transformers.length; trIdx++) {
      const tr = transformers[trIdx]!;
      if ((tr.stat ?? 1) === 0) continue;
      const fromIdx = busIdxMap.get(tr.i);
      const toIdx = busIdxMap.get(tr.j);
      if (fromIdx === undefined || toIdx === undefined) continue;

      const r = tr.r12;
      const x = tr.x12;
      const z2 = r * r + x * x;
      if (z2 < 1e-12) continue;

      const gSeries = r / z2;
      const bSeries = -x / z2;

      const tc = taps.find((t) => t.config.transformerIndex === trIdx);
      const tapRatio = tc ? tc.currentTapRatio : 1.0;
      const a2 = tapRatio * tapRatio;

      const f_t = fromIdx * N + toIdx;
      const t_f = toIdx * N + fromIdx;
      const f_f = fromIdx * N + fromIdx;
      const t_t = toIdx * N + toIdx;

      Gbus[f_t] = (Gbus[f_t] ?? 0) - gSeries / tapRatio;
      Bbus[f_t] = (Bbus[f_t] ?? 0) - bSeries / tapRatio;
      Gbus[t_f] = (Gbus[t_f] ?? 0) - gSeries / tapRatio;
      Bbus[t_f] = (Bbus[t_f] ?? 0) - bSeries / tapRatio;

      Gbus[f_f] = (Gbus[f_f] ?? 0) + gSeries / a2;
      Bbus[f_f] = (Bbus[f_f] ?? 0) + bSeries / a2;
      Gbus[t_t] = (Gbus[t_t] ?? 0) + gSeries;
      Bbus[t_t] = (Bbus[t_t] ?? 0) + bSeries;
    }

    return { Gbus, Bbus };
  }

  const stepResults: QdslStepResult[] = [];
  let totalEnergySuppliedMwh = 0.0;
  let totalEnergyLossesMwh = 0.0;
  let minV = 999.0;
  let minVBus = 1;
  let minVTime = 0.0;
  let maxV = -999.0;
  let maxVBus = 1;
  let maxVTime = 0.0;
  let maxLoadingPct = 0.0;
  let maxLoadingBranch = 0;
  let maxLoadingTime = 0.0;

  // Base voltages
  const Vm = new Float64Array(N);
  const Va = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const b = baseCase.buses.get(busNumbers[i]!);
    Vm[i] = b?.vm && b.vm > 0.5 ? b.vm : 1.0;
    Va[i] = b?.va ? (b.va * Math.PI) / 180.0 : 0.0;
  }

  // ── Main Time Stepping Loop ──
  for (let stepIdx = 0; stepIdx < timeSteps.length; stepIdx++) {
    const tHours = timeSteps[stepIdx]!;

    // 1. Update Load active & reactive powers for time t
    const PloadMw = new Float64Array(N);
    const QloadMvar = new Float64Array(N);

    for (const load of baseLoads) {
      if (load.status === 0) continue;
      const specificProf =
        options.loadProfiles?.get(load.busNumber) ??
        options.loadProfiles?.get(String(load.busNumber));
      const prof = specificProf ?? options.defaultLoadProfile;
      const mult = prof ? evaluateProfile(prof, tHours) : 1.0;

      PloadMw[load.busIdx] = (PloadMw[load.busIdx] ?? 0) + load.plBaseMw * mult;
      QloadMvar[load.busIdx] = (QloadMvar[load.busIdx] ?? 0) + load.qlBaseMvar * mult;
    }

    // 2. Update Battery dispatch and SoC
    for (const bess of bessStates) {
      let desiredMw = 0;
      if (bess.config.scheduleProfile) {
        desiredMw = evaluateProfile(bess.config.scheduleProfile, tHours);
      }

      const etaChg = bess.config.chargeEfficiency ?? 0.95;
      const etaDis = bess.config.dischargeEfficiency ?? 0.95;
      const minSoc = bess.config.minSoc ?? 0.10;
      const maxSoc = bess.config.maxSoc ?? 0.90;
      const capMwh = bess.config.ratedCapacityMwh;

      let actualMw = 0;
      if (desiredMw > 0) {
        // Charging: acts as additional load
        const maxChgLimit = Math.min(bess.config.maxChargePowerMw, desiredMw);
        const energySpaceMwh = (maxSoc - bess.soc) * capMwh;
        const maxPossibleMw = dt > 0 ? energySpaceMwh / (etaChg * dt) : 0;
        actualMw = Math.max(0, Math.min(maxChgLimit, maxPossibleMw));
        bess.soc += (actualMw * etaChg * dt) / capMwh;
        const bIdx = busIdxMap.get(bess.config.busNumber);
        if (bIdx !== undefined) PloadMw[bIdx] = (PloadMw[bIdx] ?? 0) + actualMw;
      } else if (desiredMw < 0) {
        // Discharging: reduces load
        const reqDisMw = Math.abs(desiredMw);
        const maxDisLimit = Math.min(bess.config.maxDischargePowerMw, reqDisMw);
        const energyAvailableMwh = (bess.soc - minSoc) * capMwh;
        const maxPossibleMw = dt > 0 ? (energyAvailableMwh * etaDis) / dt : 0;
        actualMw = -Math.max(0, Math.min(maxDisLimit, maxPossibleMw));
        bess.soc -= ((Math.abs(actualMw) / etaDis) * dt) / capMwh;
        const bIdx = busIdxMap.get(bess.config.busNumber);
        if (bIdx !== undefined) PloadMw[bIdx] = (PloadMw[bIdx] ?? 0) + actualMw;
      }
      bess.currentPowerMw = actualMw;
      bess.soc = Math.max(0, Math.min(1.0, bess.soc));
    }

    // 3. Update Generator active powers
    const PgenMw = new Float64Array(N);
    const QgenMvar = new Float64Array(N);
    for (const gen of baseGens) {
      if (gen.stat === 0) continue;
      const genKey = `${gen.busNumber}_${gen.id.trim()}`;
      const prof =
        options.generationProfiles?.get(genKey) ??
        options.generationProfiles?.get(gen.busNumber);
      const mult = prof ? evaluateProfile(prof, tHours) : 1.0;

      // Slack generator power is solved by load flow, others follow profile
      if (gen.busIdx !== slackIdx) {
        PgenMw[gen.busIdx] = (PgenMw[gen.busIdx] ?? 0) + gen.pgBaseMw * mult;
        QgenMvar[gen.busIdx] = (QgenMvar[gen.busIdx] ?? 0) + gen.qgBaseMvar;
      }
    }

    // 4. Power flow solve with OLTC loop
    let converged = false;
    let nrIter = 0;
    const Pcalc = new Float64Array(N);
    const Qcalc = new Float64Array(N);

    for (let oltcIter = 0; oltcIter < 5; oltcIter++) {
      const { Gbus, Bbus } = buildYbus(tapStates);

      for (nrIter = 0; nrIter < maxIter; nrIter++) {
        Pcalc.fill(0);
        Qcalc.fill(0);

        for (let i = 0; i < N; i++) {
          const vi = Vm[i]!;
          for (let k = 0; k < N; k++) {
            const vk = Vm[k]!;
            const th = Va[i]! - Va[k]!;
            const g = Gbus[i * N + k]!;
            const b = Bbus[i * N + k]!;
            const cosTh = Math.cos(th);
            const sinTh = Math.sin(th);
            Pcalc[i] = (Pcalc[i] ?? 0) + vi * vk * (g * cosTh + b * sinTh);
            Qcalc[i] = (Qcalc[i] ?? 0) + vi * vk * (g * sinTh - b * cosTh);
          }
        }

        // Active power mismatch dP (in per-unit) for all non-slack buses
        const dP = new Float64Array(nP);
        let maxMismatch = 0;
        for (let r = 0; r < nP; r++) {
          const i = nonSlackIndices[r]!;
          const pNetPu = (PgenMw[i]! - PloadMw[i]!) / sbase;
          dP[r] = pNetPu - Pcalc[i]!;
          maxMismatch = Math.max(maxMismatch, Math.abs(dP[r]!));
        }

        // Reactive power mismatch dQ (in per-unit) for PQ buses
        const dQ = new Float64Array(nQ);
        for (let r = 0; r < nQ; r++) {
          const i = pqIndices[r]!;
          const qNetPu = (QgenMvar[i]! - QloadMvar[i]!) / sbase;
          dQ[r] = qNetPu - Qcalc[i]!;
          maxMismatch = Math.max(maxMismatch, Math.abs(dQ[r]!));
        }

        if (maxMismatch < tol) {
          converged = true;
          break;
        }

        // Build Jacobian:
        // [ dP/dVa (nP x nP)   dP/dVm (nP x nQ) ]
        // [ dQ/dVa (nQ x nP)   dQ/dVm (nQ x nQ) ]
        const Jac = new Float64Array(nVars * nVars);
        const rhs = new Float64Array(nVars);

        for (let r = 0; r < nP; r++) rhs[r] = dP[r]!;
        for (let r = 0; r < nQ; r++) rhs[nP + r] = dQ[r]!;

        // 1. dP / dVa (nP x nP)
        for (let r = 0; r < nP; r++) {
          const i = nonSlackIndices[r]!;
          const vi = Vm[i]!;
          for (let c = 0; c < nP; c++) {
            const k = nonSlackIndices[c]!;
            if (i === k) {
              Jac[r * nVars + c] = -Qcalc[i]! - vi * vi * Bbus[i * N + i]!;
            } else {
              const th = Va[i]! - Va[k]!;
              const g = Gbus[i * N + k]!;
              const b = Bbus[i * N + k]!;
              Jac[r * nVars + c] = vi * Vm[k]! * (g * Math.sin(th) - b * Math.cos(th));
            }
          }
        }

        // 2. dP / dVm (nP x nQ)
        for (let r = 0; r < nP; r++) {
          const i = nonSlackIndices[r]!;
          const vi = Vm[i]!;
          for (let c = 0; c < nQ; c++) {
            const k = pqIndices[c]!;
            const col = nP + c;
            if (i === k) {
              Jac[r * nVars + col] = Pcalc[i]! / vi + vi * Gbus[i * N + i]!;
            } else {
              const th = Va[i]! - Va[k]!;
              const g = Gbus[i * N + k]!;
              const b = Bbus[i * N + k]!;
              Jac[r * nVars + col] = vi * (g * Math.cos(th) + b * Math.sin(th));
            }
          }
        }

        // 3. dQ / dVa (nQ x nP)
        for (let r = 0; r < nQ; r++) {
          const i = pqIndices[r]!;
          const row = nP + r;
          const vi = Vm[i]!;
          for (let c = 0; c < nP; c++) {
            const k = nonSlackIndices[c]!;
            if (i === k) {
              Jac[row * nVars + c] = Pcalc[i]! - vi * vi * Gbus[i * N + i]!;
            } else {
              const th = Va[i]! - Va[k]!;
              const g = Gbus[i * N + k]!;
              const b = Bbus[i * N + k]!;
              Jac[row * nVars + c] = -vi * Vm[k]! * (g * Math.cos(th) + b * Math.sin(th));
            }
          }
        }

        // 4. dQ / dVm (nQ x nQ)
        for (let r = 0; r < nQ; r++) {
          const i = pqIndices[r]!;
          const row = nP + r;
          const vi = Vm[i]!;
          for (let c = 0; c < nQ; c++) {
            const k = pqIndices[c]!;
            const col = nP + c;
            if (i === k) {
              Jac[row * nVars + col] = Qcalc[i]! / vi - vi * Bbus[i * N + i]!;
            } else {
              const th = Va[i]! - Va[k]!;
              const g = Gbus[i * N + k]!;
              const b = Bbus[i * N + k]!;
              Jac[row * nVars + col] = vi * (g * Math.sin(th) - b * Math.cos(th));
            }
          }
        }

        // Solve Jac * delta = rhs in-place
        if (!solveLinearSystemSparse(Jac, rhs, nVars)) break;

        for (let r = 0; r < nP; r++) {
          const idx = nonSlackIndices[r]!;
          Va[idx] = (Va[idx] ?? 0) + (rhs[r] ?? 0);
        }
        for (let r = 0; r < nQ; r++) {
          const k = pqIndices[r]!;
          const newV = (Vm[k] ?? 1.0) + (rhs[nP + r] ?? 0);
          Vm[k] = Math.max(0.5, Math.min(1.5, newV));
        }
      }

      // Check OLTC tap changes
      let tapChanged = false;
      for (const tap of tapStates) {
        const cBusIdx = busIdxMap.get(tap.config.controlledBus);
        if (cBusIdx === undefined) continue;
        const vAct = Vm[cBusIdx]!;
        const vSet = tap.config.targetVoltagePu;
        const db = tap.config.deadbandPu;
        const step = tap.config.stepSizeRatio;

        if (vAct < vSet - db && tap.currentTapRatio > tap.config.minTapRatio) {
          tap.currentTapRatio = Math.max(tap.config.minTapRatio, tap.currentTapRatio - step);
          tapChanged = true;
        } else if (vAct > vSet + db && tap.currentTapRatio < tap.config.maxTapRatio) {
          tap.currentTapRatio = Math.min(tap.config.maxTapRatio, tap.currentTapRatio + step);
          tapChanged = true;
        }
      }

      if (!tapChanged) break;
    }

    // 5. Compute branch flows and losses
    const branchLoadings: number[] = [];
    let stepLossMw = 0.0;
    let stepLossMvar = 0.0;

    for (let brIdx = 0; brIdx < branches.length; brIdx++) {
      const br = branches[brIdx]!;
      const fromIdx = busIdxMap.get(br.i);
      const toIdx = busIdxMap.get(br.j);
      if (fromIdx === undefined || toIdx === undefined) {
        branchLoadings.push(0);
        continue;
      }

      const vf = Vm[fromIdx]!;
      const vt = Vm[toIdx]!;
      const th_ft = Va[fromIdx]! - Va[toIdx]!;
      const r = br.r;
      const x = br.x;
      const z2 = r * r + x * x;
      const g = r / z2;
      const b = -x / z2;
      const bShunt = (br.b ?? 0) / 2.0;

      const pFrom = (vf * vf * g - vf * vt * (g * Math.cos(th_ft) + b * Math.sin(th_ft))) * sbase;
      const qFrom = (-vf * vf * (b + bShunt) - vf * vt * (g * Math.sin(th_ft) - b * Math.cos(th_ft))) * sbase;

      const pTo = (vt * vt * g - vt * vf * (g * Math.cos(-th_ft) + b * Math.sin(-th_ft))) * sbase;
      const qTo = (-vt * vt * (b + bShunt) - vt * vf * (g * Math.sin(-th_ft) - b * Math.cos(-th_ft))) * sbase;

      const pLoss = Math.max(0, pFrom + pTo);
      const qLoss = qFrom + qTo;
      stepLossMw += pLoss;
      stepLossMvar += qLoss;

      const sMva = Math.sqrt(pFrom * pFrom + qFrom * qFrom);
      const rateA = br.rateA && br.rateA > 0 ? br.rateA : (br.ratea && br.ratea > 0 ? br.ratea : sbase);
      const loadingPct = (sMva / rateA) * 100.0;
      branchLoadings.push(loadingPct);

      if (loadingPct > maxLoadingPct) {
        maxLoadingPct = loadingPct;
        maxLoadingBranch = brIdx;
        maxLoadingTime = tHours;
      }
    }

    // Transformer losses
    for (const tr of transformers) {
      const fromIdx = busIdxMap.get(tr.i);
      const toIdx = busIdxMap.get(tr.j);
      if (fromIdx === undefined || toIdx === undefined) continue;

      const vf = Vm[fromIdx]!;
      const vt = Vm[toIdx]!;
      const th_ft = Va[fromIdx]! - Va[toIdx]!;
      const r = tr.r12;
      const x = tr.x12;
      const z2 = r * r + x * x;
      const g = r / z2;
      const b = -x / z2;

      const pFrom = (vf * vf * g - vf * vt * (g * Math.cos(th_ft) + b * Math.sin(th_ft))) * sbase;
      const qFrom = (-vf * vf * b - vf * vt * (g * Math.sin(th_ft) - b * Math.cos(th_ft))) * sbase;
      const pTo = (vt * vt * g - vt * vf * (g * Math.cos(-th_ft) + b * Math.sin(-th_ft))) * sbase;
      const qTo = (-vt * vt * b - vt * vf * (g * Math.sin(-th_ft) - b * Math.cos(-th_ft))) * sbase;

      stepLossMw += Math.max(0, pFrom + pTo);
      stepLossMvar += qFrom + qTo;
    }

    // Totals
    let totLoadMw = 0;
    let totLoadMvar = 0;
    for (let i = 0; i < N; i++) {
      totLoadMw += PloadMw[i]!;
      totLoadMvar += QloadMvar[i]!;
    }
    const totGenMw = totLoadMw + stepLossMw;
    const totGenMvar = totLoadMvar + stepLossMvar;

    totalEnergySuppliedMwh += totGenMw * dt;
    totalEnergyLossesMwh += stepLossMw * dt;

    const busVMap = new Map<number, number>();
    const busVaMap = new Map<number, number>();
    for (let i = 0; i < N; i++) {
      const bNum = busNumbers[i]!;
      const v = Vm[i]!;
      busVMap.set(bNum, v);
      busVaMap.set(bNum, Va[i]!);

      if (v < minV) {
        minV = v;
        minVBus = bNum;
        minVTime = tHours;
      }
      if (v > maxV) {
        maxV = v;
        maxVBus = bNum;
        maxVTime = tHours;
      }
    }

    stepResults.push({
      stepIndex: stepIdx,
      timeHours: tHours,
      converged,
      iterations: nrIter,
      busVoltages: busVMap,
      busAnglesRad: busVaMap,
      branchLoadingsPercent: branchLoadings,
      totalGenActiveMw: totGenMw,
      totalGenReactiveMvar: totGenMvar,
      totalLoadActiveMw: totLoadMw,
      totalLoadReactiveMvar: totLoadMvar,
      totalLossesActiveMw: stepLossMw,
      totalLossesReactiveMvar: stepLossMvar,
      bessStates: bessStates.map((b) => ({
        busNumber: b.config.busNumber,
        genId: b.config.genId,
        soc: b.soc,
        powerMw: b.currentPowerMw,
      })),
      tapPositions: tapStates.map((t) => ({
        transformerIndex: t.config.transformerIndex,
        tapRatio: t.currentTapRatio,
      })),
    });
  }

  const lossPct =
    totalEnergySuppliedMwh > 0 ? (totalEnergyLossesMwh / totalEnergySuppliedMwh) * 100.0 : 0.0;

  return {
    steps: stepResults,
    timeStepsHours: timeSteps,
    totalEnergySuppliedMwh,
    totalEnergyLossesMwh,
    lossPercentage: lossPct,
    minVoltagePu: minV,
    minVoltageBus: minVBus,
    minVoltageTimeHours: minVTime,
    maxVoltagePu: maxV,
    maxVoltageBus: maxVBus,
    maxVoltageTimeHours: maxVTime,
    maxBranchLoadingPercent: maxLoadingPct,
    maxLoadingBranchIndex: maxLoadingBranch,
    maxLoadingTimeHours: maxLoadingTime,
  };
}

/**
 * Formats a comprehensive text summary of the Quasi-Dynamic simulation run.
 */
export function exportQdslSummary(res: QdslResult): string {
  const lines: string[] = [];
  lines.push("================================================================================");
  lines.push("          QUASI-DYNAMIC TIME-SERIES SIMULATION (QDSL) REPORT                    ");
  lines.push("================================================================================");
  lines.push(`Total Evaluation Time Steps:      ${res.steps.length}`);
  lines.push(
    `Time Horizon:                     0.0h to ${res.timeStepsHours[res.timeStepsHours.length - 1]?.toFixed(1)}h`,
  );
  lines.push(`Total Energy Supplied:            ${res.totalEnergySuppliedMwh.toFixed(2)} MWh`);
  lines.push(
    `Total Active Energy Losses:       ${res.totalEnergyLossesMwh.toFixed(2)} MWh (${res.lossPercentage.toFixed(2)}%)`,
  );
  lines.push("--------------------------------------------------------------------------------");
  lines.push("CRITICAL OPERATING BOUNDARIES:");
  lines.push(
    `  Minimum Voltage:                ${res.minVoltagePu.toFixed(4)} p.u. (Bus ${res.minVoltageBus} at t=${res.minVoltageTimeHours.toFixed(1)}h)`,
  );
  lines.push(
    `  Maximum Voltage:                ${res.maxVoltagePu.toFixed(4)} p.u. (Bus ${res.maxVoltageBus} at t=${res.maxVoltageTimeHours.toFixed(1)}h)`,
  );
  lines.push(
    `  Peak Branch Loading:            ${res.maxBranchLoadingPercent.toFixed(1)}% (Branch #${res.maxLoadingBranchIndex} at t=${res.maxLoadingTimeHours.toFixed(1)}h)`,
  );
  lines.push("================================================================================");
  return lines.join("\n");
}
