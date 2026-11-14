// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared Statistical Benchmark Comparison Helper for PSCAD EMT Benchmarks.
 *
 * Computes RMSE, NRMSE %, Theil's Inequality Coefficient (TIC), and Theil's
 * 1961 inequality decomposition (Um, Us, Uc) only against a caller-supplied
 * external reference trajectory and timing baseline. When no external reference
 * is provided, returns `parityStatus: "UNVERIFIED"` with `null` comparison
 * scalars rather than synthesizing artificial trajectories or speedup multipliers.
 */

export type SotaParityStatus = "PASS" | "WARN" | "FAIL" | "UNVERIFIED";

export interface SotaComparisonOptions {
  referenceTrace?: Float64Array | number[] | undefined;
  referenceWallClockMs?: number | undefined;
  referenceTool?: string | undefined;
}

export interface SotaComparisonMetrics {
  sotaTool: string;
  sotaWallClockMs: number | null;
  speedupFactor: number | null;
  discrepancyRmse: number | null;
  discrepancyNrmsePct: number | null;
  theilTic: number | null;
  theilUm: number | null;
  theilUs: number | null;
  theilUc: number | null;
  parityStatus: SotaParityStatus;
}

export function computeSotaComparison(
  simulatedCurve: Float64Array | number[],
  wallClockMs: number,
  options: SotaComparisonOptions | undefined,
  config: {
    normalizationSpan: number;
    nrmsePassLimitPct: number;
    ticPassLimit: number;
  },
): SotaComparisonMetrics {
  const sotaWallClockMs =
    options?.referenceWallClockMs !== undefined &&
    Number.isFinite(options.referenceWallClockMs) &&
    options.referenceWallClockMs > 0
      ? options.referenceWallClockMs
      : null;
  const speedupFactor =
    sotaWallClockMs !== null && wallClockMs > 0 && Number.isFinite(wallClockMs) ? sotaWallClockMs / wallClockMs : null;

  const refTrace = options?.referenceTrace;
  const n = refTrace ? Math.min(simulatedCurve.length, refTrace.length) : 0;

  if (!refTrace || n === 0) {
    return {
      sotaTool: options?.referenceTool ?? "None (no external reference provided)",
      sotaWallClockMs,
      speedupFactor,
      discrepancyRmse: null,
      discrepancyNrmsePct: null,
      theilTic: null,
      theilUm: null,
      theilUs: null,
      theilUc: null,
      parityStatus: "UNVERIFIED",
    };
  }

  let sumSim = 0;
  let sumRef = 0;
  for (let i = 0; i < n; i++) {
    sumSim += simulatedCurve[i]!;
    sumRef += refTrace[i]!;
  }
  const meanSim = sumSim / n;
  const meanRef = sumRef / n;

  let sumSqErr = 0;
  let sumSimSq = 0;
  let sumRefSq = 0;
  let varSimAcc = 0;
  let varRefAcc = 0;
  let covAcc = 0;

  for (let i = 0; i < n; i++) {
    const s = simulatedCurve[i]!;
    const r = refTrace[i]!;
    const err = s - r;
    sumSqErr += err * err;
    sumSimSq += s * s;
    sumRefSq += r * r;

    const ds = s - meanSim;
    const dr = r - meanRef;
    varSimAcc += ds * ds;
    varRefAcc += dr * dr;
    covAcc += ds * dr;
  }

  const mse = sumSqErr / n;
  const rmse = Math.sqrt(mse);
  const span = config.normalizationSpan > 0 ? config.normalizationSpan : 1.0;
  const nrmsePct = (rmse / span) * 100.0;
  const denomTic = Math.sqrt(sumSimSq / n) + Math.sqrt(sumRefSq / n);
  const theilTic = denomTic > 1e-12 ? rmse / denomTic : 0.0;

  const sigmaSim = Math.sqrt(varSimAcc / n);
  const sigmaRef = Math.sqrt(varRefAcc / n);
  const pearsonR = sigmaSim > 1e-12 && sigmaRef > 1e-12 ? covAcc / (n * sigmaSim * sigmaRef) : 1.0;

  let theilUm = 0;
  let theilUs = 0;
  let theilUc = 1.0;
  if (mse > 1e-15) {
    theilUm = ((meanSim - meanRef) * (meanSim - meanRef)) / mse;
    theilUs = ((sigmaSim - sigmaRef) * (sigmaSim - sigmaRef)) / mse;
    theilUc = (2.0 * (1.0 - Math.min(1.0, Math.max(-1.0, pearsonR))) * sigmaSim * sigmaRef) / mse;
    const sum = theilUm + theilUs + theilUc;
    if (sum > 1e-12) {
      theilUm /= sum;
      theilUs /= sum;
      theilUc /= sum;
    }
  }

  const parityStatus: SotaParityStatus =
    nrmsePct <= config.nrmsePassLimitPct && theilTic <= config.ticPassLimit
      ? "PASS"
      : nrmsePct <= config.nrmsePassLimitPct * 2 && theilTic <= config.ticPassLimit * 2
        ? "WARN"
        : "FAIL";

  return {
    sotaTool: options?.referenceTool ?? "External Reference Trace",
    sotaWallClockMs,
    speedupFactor,
    discrepancyRmse: rmse,
    discrepancyNrmsePct: nrmsePct,
    theilTic,
    theilUm,
    theilUs,
    theilUc,
    parityStatus,
  };
}
