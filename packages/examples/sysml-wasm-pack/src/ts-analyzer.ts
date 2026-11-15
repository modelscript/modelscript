// SPDX-License-Identifier: AGPL-3.0-or-later

import { ResultBuilder, hannWindow, rfft, type KernelInput } from "@modelscript/sdk";

/**
 * Sample TypeScript capability demonstrating `@modelscript/sdk` FFT,
 * KPI cards, and markdown artifacts inside an isolated Worker.
 * @sysml SpectrumCheck
 */
export function analyzeSpectrum(input: KernelInput) {
  const fundamentalHz = Number(input.parameters.fundamentalHz ?? 50);
  const sampleRateHz = Number(input.parameters.sampleRateHz ?? 1600);
  const n = 64;

  const samples = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRateHz;
    samples[i] = Math.sin(2 * Math.PI * fundamentalHz * t);
  }

  const windowed = hannWindow(samples);
  const spec = rfft(windowed);
  const freqs = spec.bins(sampleRateHz);

  let peakMag = 0;
  let peakFreqHz = 0;
  for (let k = 1; k < spec.magnitudes.length; k++) {
    const mag = spec.magnitudes[k] ?? 0;
    if (mag > peakMag) {
      peakMag = mag;
      peakFreqHz = freqs[k] ?? 0;
    }
  }

  const freqErrorHz = Math.abs(peakFreqHz - fundamentalHz);
  return new ResultBuilder("analyzeSpectrum")
    .metric("peakFreqHz", peakFreqHz)
    .metric("freqErrorHz", freqErrorHz)
    .kpiCards("spectrum-kpis", "Spectral Verification", [
      { label: "Peak Frequency", value: peakFreqHz.toFixed(1), unit: "Hz", status: "pass" },
      { label: "Peak Magnitude", value: peakMag.toFixed(3), status: "neutral" },
    ])
    .timeSeries("spectrum-plot", "Single-Sided Magnitude Spectrum", "Frequency (Hz)", "|X(f)|", [
      { name: "Magnitude", x: freqs, y: spec.magnitudes },
    ])
    .markdown("spectrum-note", "Notes", "Computed with `hannWindow` + `rfft` inside a Worker.")
    .summary(`Detected peak at ${peakFreqHz.toFixed(1)} Hz`)
    .build();
}
