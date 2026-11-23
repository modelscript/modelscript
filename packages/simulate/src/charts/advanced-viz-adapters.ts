// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — IDE / Webview Visualization Adapters for Advanced Algorithm Domains.
 *
 * Produces JSON-serializable chart, heatmap, and 3D/2D overlay payloads consumed by
 * `@modelscript/ide` webviews and `apps/web`:
 *   - Welch PSD & STFT Spectrogram heatmaps
 *   - Balanced Truncation Hankel Singular Value decay curves
 *   - Radiation Oncology cumulative Dose-Volume Histogram (DVH) curves
 *   - 3D Trajectory Safety Tubes & 2D Routed PCB Net overlays
 */

import type { StftResult, WelchPsdResult } from "../dsp/spectral.js";
import type { ReducedLtiModel } from "../surrogates/system-mor.js";

export interface LineChartPayload {
  readonly kind: "line-chart";
  readonly title: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly logY?: boolean | undefined;
  readonly series: ReadonlyArray<{ readonly name: string; readonly x: number[]; readonly y: number[] }>;
}

export interface SpectrogramPayload {
  readonly kind: "spectrogram";
  readonly title: string;
  readonly times: number[];
  readonly frequenciesHz: number[];
  /** Magnitude in dB [frameIdx][freqBinIdx]. */
  readonly magnitudesDb: number[][];
}

export interface TrajectoryTubeOverlayPayload {
  readonly kind: "trajectory-tube-3d";
  readonly waypoints: Array<[number, number, number]>;
  readonly tubeRadius: number;
  readonly color: string;
}

export interface PcbRouteOverlayPayload {
  readonly kind: "pcb-route-2d";
  readonly nets: Array<{
    readonly netId: string;
    readonly points: Array<{ x: number; y: number }>;
    readonly color: string;
  }>;
}

export function buildPsdChartData(psd: WelchPsdResult, title = "Welch Power Spectral Density"): LineChartPayload {
  return {
    kind: "line-chart",
    title,
    xLabel: "Frequency (Hz)",
    yLabel: "PSD (dB/Hz)",
    series: [
      {
        name: "PSD",
        x: Array.from(psd.frequenciesHz),
        y: Array.from(psd.psd, (v) => 10 * Math.log10(Math.max(1e-20, v))),
      },
    ],
  };
}

export function buildSpectrogramChartData(stftRes: StftResult, title = "STFT Spectrogram"): SpectrogramPayload {
  return {
    kind: "spectrogram",
    title,
    times: Array.from(stftRes.times),
    frequenciesHz: Array.from(stftRes.frequenciesHz),
    magnitudesDb: stftRes.magnitudes.map((frame) => Array.from(frame, (v) => 20 * Math.log10(Math.max(1e-12, v)))),
  };
}

export function buildHankelSingularValuesChartData(mor: ReducedLtiModel): LineChartPayload {
  return {
    kind: "line-chart",
    title: `Hankel Singular Values (r=${mor.order}, H∞ bound=${mor.hInfErrorBound.toExponential(2)})`,
    xLabel: "State Index",
    yLabel: "Singular Value σ_k",
    logY: true,
    series: [
      {
        name: "HSV",
        x: mor.hankelSingularValues.map((_, i) => i + 1),
        y: [...mor.hankelSingularValues],
      },
    ],
  };
}

export function buildDvhCurveChartData(
  doseGy: Float64Array,
  roiMask: Uint8Array,
  roiName = "PTV",
  numBins = 50,
): LineChartPayload {
  const vals: number[] = [];
  let maxD = 0;
  for (let i = 0; i < doseGy.length; i++) {
    if (roiMask[i]) {
      const d = doseGy[i]!;
      vals.push(d);
      if (d > maxD) maxD = d;
    }
  }
  const x: number[] = [];
  const y: number[] = [];
  const total = Math.max(1, vals.length);
  for (let b = 0; b <= numBins; b++) {
    const threshold = (b / numBins) * Math.max(1e-6, maxD);
    let count = 0;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i]! >= threshold) count++;
    }
    x.push(threshold);
    y.push((100.0 * count) / total);
  }
  return {
    kind: "line-chart",
    title: `Cumulative DVH — ${roiName}`,
    xLabel: "Dose (Gy)",
    yLabel: "Volume (%)",
    series: [{ name: roiName, x, y }],
  };
}

export function buildTrajectoryTubeOverlay(
  waypoints: readonly (readonly number[])[],
  tubeRadius: number,
  color = "#22c55e",
): TrajectoryTubeOverlayPayload {
  return {
    kind: "trajectory-tube-3d",
    waypoints: waypoints.map((w) => [w[0] ?? 0, w[1] ?? 0, w[2] ?? 0]),
    tubeRadius,
    color,
  };
}

export function buildPcbRouteOverlay(
  nets: readonly {
    readonly netId: string;
    readonly points: readonly { x: number; y: number }[];
    readonly color?: string;
  }[],
): PcbRouteOverlayPayload {
  const palette = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6"];
  return {
    kind: "pcb-route-2d",
    nets: nets.map((n, i) => ({
      netId: n.netId,
      points: n.points.map((p) => ({ x: p.x, y: p.y })),
      color: n.color ?? palette[i % palette.length]!,
    })),
  };
}
