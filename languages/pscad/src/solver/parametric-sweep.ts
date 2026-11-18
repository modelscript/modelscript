// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Parametric Point-on-Wave (PoW) & Statistical Switching Overvoltage (SSOV) Engine
 *
 * Simulates breaker closing, reclosing, and fault inception across 360-degree point-on-wave
 * angles with independent Gaussian pole scatter (std dev sigma = 1-2 ms per IEC 60071 / IEEE C37.011).
 * Computes statistical cumulative distribution function (CDF), 2% switching overvoltage (V_2%),
 * and overvoltage histograms.
 */

import type { EmtNetlist } from "../types.js";
import { EmtSolver } from "./emt-solver.js";

export interface PointOnWaveOptions {
  /** Target circuit breaker component ID to sweep. */
  breakerId?: string | undefined;
  /** Number of statistical closing angles to sample (default: 50). */
  numRuns?: number | undefined;
  /** Breaker pole closing time standard deviation in seconds (default: 0.001 s = 1 ms). */
  poleScatterSec?: number | undefined;
  /** Nominal system frequency in Hz (default: 60.0). */
  nominalFrequencyHz?: number | undefined;
  /** Simulation duration per run in seconds (default: 0.05 s = 50 ms). */
  durationSec?: number | undefined;
  /** Simulation time step in seconds (default: 20e-6 s = 20 us). */
  timeStepSec?: number | undefined;
  /** Base peak phase voltage in kV used for per-unit calculations (default: derived or 187.8 kV). */
  basePeakKv?: number | undefined;
  /** Specific bus IDs to monitor for maximum transient overvoltage. */
  monitoredBuses?: string[] | undefined;
}

export interface PointOnWaveRunRecord {
  runIndex: number;
  closingAngleDeg: number;
  poleClosingTimesSec: { a: number; b: number; c: number };
  maxPeakKv: number;
  maxPeakPu: number;
  peakBusId: string;
}

export interface SsovHistogramBin {
  binMinKv: number;
  binMaxKv: number;
  count: number;
  percent: number;
}

export interface PointOnWaveSweepResult {
  totalRuns: number;
  breakerId: string;
  meanPeakKv: number;
  maxPeakKv: number;
  minPeakKv: number;
  /** 2% statistical switching overvoltage (98th percentile) per IEC 60071 / IEEE C37. */
  ssovV2PercentKv: number;
  ssovV2PercentPu: number;
  runs: PointOnWaveRunRecord[];
  histogram: SsovHistogramBin[];
  wallClockTimeMs: number;
}

/**
 * Standard Box-Muller transform for Gaussian random numbers.
 */
function gaussianRandom(mean = 0.0, stdDev = 1.0): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdDev;
}

/**
 * Executes a statistical Point-on-Wave breaker closing sweep and computes SSOV metrics.
 */
export function runPointOnWaveSweep(
  netlistInput: EmtNetlist | import("./emt-solver.js").EmtNetlistInput,
  options: PointOnWaveOptions = {},
): PointOnWaveSweepResult {
  const netlist = netlistInput as EmtNetlist;
  const t0 = performance.now();
  const numRuns = options.numRuns ?? 50;
  const f0 = options.nominalFrequencyHz ?? netlist.nominalFrequencyHz ?? 60.0;
  const tPeriod = 1.0 / f0;
  const poleScatter = options.poleScatterSec ?? 0.001; // 1 ms
  const durationSec = options.durationSec ?? 0.05;
  const dt = options.timeStepSec ?? 25e-6;

  // Locate target circuit breaker or default to first switch
  const switches = (netlist.branches ?? []).filter((b) => b.kind === "switch");
  const targetSw = options.breakerId ? switches.find((s) => s.id === options.breakerId) : switches[0];

  const breakerId = targetSw?.id ?? "BRK_1";

  // Derive base peak kV from first source or default
  const firstSource = netlist.sources?.[0];
  const srcCompat = firstSource as unknown as { voltageKvLL?: number; voltageKv?: number } | undefined;
  const baseKvLL =
    (firstSource?.vPeakKv
      ? (firstSource.vPeakKv * Math.sqrt(3.0)) / Math.SQRT2
      : (srcCompat?.voltageKvLL ?? srcCompat?.voltageKv)) ?? 230.0;
  const basePeakKv = options.basePeakKv ?? (baseKvLL * Math.SQRT2) / Math.sqrt(3.0);

  const runs: PointOnWaveRunRecord[] = [];
  const baseCloseTime = 0.01; // 10 ms nominal closing point

  for (let r = 0; r < numRuns; r++) {
    // Uniformly distributed electrical angle 0 to 360 degrees
    const angleDeg = (r * 360.0) / numRuns;
    const angleRad = (angleDeg * Math.PI) / 180.0;
    const angleDelaySec = (angleRad / (2.0 * Math.PI)) * tPeriod;

    // Independent Gaussian pole scatter around the target angle
    const tA = baseCloseTime + angleDelaySec + gaussianRandom(0.0, poleScatter);
    const tB = baseCloseTime + angleDelaySec + gaussianRandom(0.0, poleScatter);
    const tC = baseCloseTime + angleDelaySec + gaussianRandom(0.0, poleScatter);

    // Deep clone netlist for this individual run
    const clonedBranches = (netlist.branches ?? []).map((br) => {
      if (br.id === breakerId) {
        return {
          ...br,
          status: "open" as const,
          initialClosed: false,
          closeTimeSec: Math.min(tA, tB, tC),
          poleCloseTimesSec: { a: tA, b: tB, c: tC },
          openTimeSec: 1e9,
        };
      }
      return { ...br };
    });

    const runNetlist: EmtNetlist = {
      ...netlist,
      branches: clonedBranches,
    };

    const solver = new EmtSolver(runNetlist, {
      durationSec,
      timeStepSec: dt,
      enableCda: true,
      enableSwitchingInterpolation: true,
    });

    const traj = solver.solve();

    // Inspect peak overvoltage across monitored buses
    let maxRunPeakVolts = 0.0;
    let peakBus = "";

    const candidateBuses =
      options.monitoredBuses && options.monitoredBuses.length > 0
        ? options.monitoredBuses
        : Array.from(traj.busPhaseVoltages.keys());

    for (const bId of candidateBuses) {
      const pv = traj.busPhaseVoltages.get(bId);
      if (pv) {
        for (let i = 0; i < pv.a.length; i++) {
          const va = Math.abs(pv.a[i]!);
          const vb = Math.abs(pv.b[i]!);
          const vc = Math.abs(pv.c[i]!);
          const pk = Math.max(va, vb, vc);
          if (pk > maxRunPeakVolts) {
            maxRunPeakVolts = pk;
            peakBus = bId;
          }
        }
      }
    }

    const maxPeakKv = maxRunPeakVolts * 1e-3;
    const maxPeakPu = basePeakKv > 0 ? maxPeakKv / basePeakKv : 1.0;

    runs.push({
      runIndex: r + 1,
      closingAngleDeg: Number(angleDeg.toFixed(1)),
      poleClosingTimesSec: {
        a: Number(tA.toFixed(6)),
        b: Number(tB.toFixed(6)),
        c: Number(tC.toFixed(6)),
      },
      maxPeakKv: Number(maxPeakKv.toFixed(2)),
      maxPeakPu: Number(maxPeakPu.toFixed(3)),
      peakBusId: peakBus,
    });
  }

  // Statistical calculations
  const sortedPeaks = [...runs].map((r) => r.maxPeakKv).sort((a, b) => a - b);
  const minPeakKv = sortedPeaks[0] ?? 0.0;
  const maxPeakKv = sortedPeaks[sortedPeaks.length - 1] ?? 0.0;
  const sumPeakKv = sortedPeaks.reduce((a, b) => a + b, 0.0);
  const meanPeakKv = Number((sumPeakKv / sortedPeaks.length).toFixed(2));

  // V_2%: 98th percentile (2% probability of being exceeded)
  const idx2Percent = Math.min(sortedPeaks.length - 1, Math.floor(sortedPeaks.length * 0.98));
  const ssovV2PercentKv = Number(sortedPeaks[idx2Percent]!.toFixed(2));
  const ssovV2PercentPu = Number((ssovV2PercentKv / basePeakKv).toFixed(3));

  // 10-bin histogram of overvoltages
  const numBins = 10;
  const binWidth = Math.max(1.0, (maxPeakKv - minPeakKv) / numBins);
  const histogram: SsovHistogramBin[] = [];

  for (let b = 0; b < numBins; b++) {
    const binMin = minPeakKv + b * binWidth;
    const binMax = b === numBins - 1 ? maxPeakKv + 0.01 : binMin + binWidth;
    const count = sortedPeaks.filter((p) => p >= binMin && (b === numBins - 1 ? p <= binMax : p < binMax)).length;
    histogram.push({
      binMinKv: Number(binMin.toFixed(2)),
      binMaxKv: Number(binMax.toFixed(2)),
      count,
      percent: Number(((count / sortedPeaks.length) * 100.0).toFixed(1)),
    });
  }

  const wallClockTimeMs = performance.now() - t0;

  return {
    totalRuns: runs.length,
    breakerId,
    meanPeakKv,
    maxPeakKv,
    minPeakKv,
    ssovV2PercentKv,
    ssovV2PercentPu,
    runs,
    histogram,
    wallClockTimeMs: Number(wallClockTimeMs.toFixed(1)),
  };
}

export interface MultipleRunParameterSpec {
  /** Component or branch/source ID whose parameter is swept. */
  targetId: string;
  /** Parameter property to vary (`r`, `l`, `c`, `vPeakKv`, `phaseDeg`, `startSec`, or component param name). */
  paramName: string;
  min: number;
  max: number;
  distribution?: "uniform" | "normal" | "grid" | undefined;
}

export interface MultipleRunOptions {
  /** Number of MRUN sweep executions (default: 20 or MRUN block `NR`/`NumRuns`). */
  numRuns?: number | undefined;
  /** Explicit parameters to vary across runs; auto-discovers `<User defn="master:mrun">` or switches/sources if omitted. */
  parameters?: MultipleRunParameterSpec[] | undefined;
  /** Simulation duration per run in seconds (default: 0.05 s). */
  durationSec?: number | undefined;
  /** Simulation time step in seconds (default: 50e-6 s). */
  timeStepSec?: number | undefined;
  /** Deterministic LCG seed for repeatable statistical runs (default: 2026). */
  seed?: number | undefined;
}

export interface MultipleRunSample {
  runIndex: number;
  parameters: Record<string, number>;
  maxPeakKv: number;
  maxCurrentAmp: number;
  peakBusId: string;
}

export interface MultipleRunSweepResult {
  totalRuns: number;
  parameterSpecs: MultipleRunParameterSpec[];
  meanPeakKv: number;
  maxPeakKv: number;
  minPeakKv: number;
  stdDevPeakKv: number;
  p98PeakKv: number;
  worstRunIndex: number;
  runs: MultipleRunSample[];
  wallClockTimeMs: number;
}

function seededUniform(state: { s: number }): number {
  state.s = (Math.imul(1664525, state.s) + 1013904223) >>> 0;
  return state.s / 4294967296;
}

/**
 * Executes a PSCAD Multiple-Run (`master:mrun`) parametric or statistical Monte-Carlo EMT sweep
 * across the netlist, varying component/branch/source/fault parameters and aggregating peak
 * overvoltage & overcurrent envelope statistics.
 */
export function runMultipleRunSweep(
  netlistInput: EmtNetlist | import("./emt-solver.js").EmtNetlistInput,
  options: MultipleRunOptions = {},
): MultipleRunSweepResult {
  const netlist = netlistInput as EmtNetlist;
  const t0 = performance.now();
  const numRuns = Math.max(1, Math.min(500, Math.trunc(options.numRuns ?? 20)));
  const durationSec = options.durationSec ?? 0.05;
  const timeStepSec = options.timeStepSec ?? 50e-6;
  const prng = { s: (options.seed ?? 2026) >>> 0 };

  let specs = options.parameters ? [...options.parameters] : [];
  if (specs.length === 0) {
    if (netlist.faults && netlist.faults.length > 0) {
      const f = netlist.faults[0]!;
      specs.push({
        targetId: f.id,
        paramName: "startSec",
        min: Math.max(0, f.startSec),
        max: Math.max(f.startSec + 0.001, f.startSec + 1.0 / (netlist.nominalFrequencyHz || 60.0)),
        distribution: "grid",
      });
    } else if (netlist.sources.length > 0) {
      const s = netlist.sources[0]!;
      specs.push({
        targetId: s.id,
        paramName: "phaseDeg",
        min: 0,
        max: 360,
        distribution: "grid",
      });
    } else if (netlist.branches.length > 0) {
      const b = netlist.branches[0]!;
      const r0 = Math.max(0.01, b.resistanceOhm || 1.0);
      specs.push({
        targetId: b.id,
        paramName: "resistanceOhm",
        min: r0 * 0.8,
        max: r0 * 1.2,
        distribution: "uniform",
      });
    }
  }

  const runs: MultipleRunSample[] = [];
  for (let r = 0; r < numRuns; r++) {
    const sampleParams: Record<string, number> = {};
    const cloned: EmtNetlist = {
      ...netlist,
      branches: netlist.branches.map((b) => ({ ...b })),
      sources: netlist.sources.map((s) => ({ ...s })),
      faults: netlist.faults ? netlist.faults.map((f) => ({ ...f })) : undefined,
    };

    const frac = numRuns > 1 ? r / (numRuns - 1) : 0.5;
    for (const sp of specs) {
      let val: number;
      if (sp.distribution === "grid") {
        val = sp.min + frac * (sp.max - sp.min);
      } else if (sp.distribution === "normal") {
        const u1 = Math.max(1e-9, seededUniform(prng));
        const u2 = seededUniform(prng);
        const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        const mu = 0.5 * (sp.min + sp.max);
        const sigma = Math.max(1e-12, (sp.max - sp.min) / 6.0);
        val = Math.min(sp.max, Math.max(sp.min, mu + z * sigma));
      } else {
        val = sp.min + seededUniform(prng) * (sp.max - sp.min);
      }
      sampleParams[`${sp.targetId}.${sp.paramName}`] = Number(val.toFixed(6));

      const br = cloned.branches.find((b) => b.id === sp.targetId);
      if (br) {
        if (sp.paramName === "r" || sp.paramName === "resistanceOhm") br.resistanceOhm = val;
        else if (sp.paramName === "l" || sp.paramName === "inductanceH") br.inductanceH = val;
        else if (sp.paramName === "c" || sp.paramName === "capacitanceF") br.capacitanceF = val;
      }
      const src = cloned.sources.find((s) => s.id === sp.targetId);
      if (src) {
        if (sp.paramName === "vPeakKv" || sp.paramName === "vmKv") src.vPeakKv = val;
        else if (sp.paramName === "phaseDeg") src.phaseRad = (val * Math.PI) / 180.0;
        else if (sp.paramName === "phaseRad") src.phaseRad = val;
        else if (sp.paramName === "rSourceOhm") src.rSourceOhm = val;
      }
      const flt = cloned.faults?.find((f) => f.id === sp.targetId);
      if (flt) {
        if (sp.paramName === "startSec") {
          const dur = Math.max(1e-4, flt.endSec - flt.startSec);
          flt.startSec = val;
          flt.endSec = val + dur;
        } else if (sp.paramName === "rFaultOhm") {
          flt.rFaultOhm = val;
        }
      }
    }

    const res = new EmtSolver(cloned, {
      timeStepSec,
      durationSec,
      nominalFrequencyHz: cloned.nominalFrequencyHz || 60.0,
      enableCda: true,
    }).solve();

    let maxV = 0;
    let peakBus = "";
    for (const [bId, arr] of res.busVoltages) {
      for (let i = 0; i < arr.length; i++) {
        const av = Math.abs(arr[i]!);
        if (av > maxV) {
          maxV = av;
          peakBus = bId;
        }
      }
    }
    let maxI = 0;
    for (const arr of res.branchCurrents.values()) {
      for (let i = 0; i < arr.length; i++) {
        const ai = Math.abs(arr[i]!);
        if (ai > maxI) maxI = ai;
      }
    }

    runs.push({
      runIndex: r + 1,
      parameters: sampleParams,
      maxPeakKv: Number((maxV * 1e-3).toFixed(4)),
      maxCurrentAmp: Number(maxI.toFixed(3)),
      peakBusId: peakBus,
    });
  }

  const peaks = runs.map((x) => x.maxPeakKv);
  const sorted = [...peaks].sort((a, b) => a - b);
  const minPeakKv = sorted[0] ?? 0;
  const maxPeakKv = sorted[sorted.length - 1] ?? 0;
  const mean = peaks.reduce((a, b) => a + b, 0) / Math.max(1, peaks.length);
  const variance = peaks.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, peaks.length);
  const stdDevPeakKv = Number(Math.sqrt(variance).toFixed(4));
  const p98Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98));
  const p98PeakKv = sorted[p98Idx] ?? maxPeakKv;
  let worstRunIndex = 1;
  for (const run of runs) {
    if (run.maxPeakKv >= maxPeakKv) {
      worstRunIndex = run.runIndex;
      break;
    }
  }

  return {
    totalRuns: runs.length,
    parameterSpecs: specs,
    meanPeakKv: Number(mean.toFixed(4)),
    maxPeakKv,
    minPeakKv,
    stdDevPeakKv,
    p98PeakKv,
    worstRunIndex,
    runs,
    wallClockTimeMs: Number((performance.now() - t0).toFixed(1)),
  };
}
