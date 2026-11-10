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
export function runPointOnWaveSweep(netlist: EmtNetlist, options: PointOnWaveOptions = {}): PointOnWaveSweepResult {
  const t0 = performance.now();
  const numRuns = options.numRuns ?? 50;
  const f0 = options.nominalFrequencyHz ?? netlist.nominalFrequencyHz ?? 60.0;
  const tPeriod = 1.0 / f0;
  const poleScatter = options.poleScatterSec ?? 0.001; // 1 ms
  const durationSec = options.durationSec ?? 0.05;
  const dt = options.timeStepSec ?? 25e-6;

  // Locate target circuit breaker or default to first switch
  const switches = (netlist.branches ?? []).filter((b: any) => b.kind === "switch");
  const targetSw = options.breakerId ? switches.find((s: any) => s.id === options.breakerId) : switches[0];

  const breakerId = targetSw?.id ?? "BRK_1";

  // Derive base peak kV from first source or default
  const baseKvLL =
    (netlist.sources?.[0]?.vPeakKv
      ? (netlist.sources[0].vPeakKv * Math.sqrt(3.0)) / Math.SQRT2
      : (netlist.sources?.[0] as any)?.voltageKvLL) ?? 230.0;
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
    const clonedBranches = (netlist.branches ?? []).map((br: any) => {
      if (br.id === breakerId) {
        return {
          ...br,
          status: "open",
          initialClosed: false,
          closeTimeSec: Math.min(tA, tB, tC),
          poleCloseTimesSec: [tA, tB, tC],
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
