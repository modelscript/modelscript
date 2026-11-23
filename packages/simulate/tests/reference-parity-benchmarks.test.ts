// SPDX-License-Identifier: AGPL-3.0-or-later

import { dinicMaxFlow, featherstonePlanarRnea, fft, lintMacromodelPassivity } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySosFilter,
  balancedTruncation,
  buildDvhCurveChartData,
  buildHankelSingularValuesChartData,
  buildPcbRouteOverlay,
  buildPsdChartData,
  buildSpectrogramChartData,
  buildTrajectoryTubeOverlay,
  designButterworth,
  solveMmcQueue,
  stft,
  WebGPUDoseTransportRunner,
  WebGPUFdtd3DRunner,
  WebGPUSimpFilterRunner,
  welchPsd,
} from "../src/index.js";

describe("Reference-Parity Verification, WebGPU Host Runners, IDE Viz Adapters & LSP Diagnostics", () => {
  it("satisfies Parseval's Theorem on FFT and -3 dB cutoff on 4th-order Butterworth (SciPy parity)", () => {
    const N = 256;
    const x = Float64Array.from({ length: N }, (_, n) => Math.sin(0.2 * n) + 0.3 * Math.cos(0.7 * n));
    let timeEnergy = 0;
    for (let i = 0; i < N; i++) timeEnergy += x[i]! * x[i]!;
    const { re, im } = fft(x);
    let freqEnergy = 0;
    for (let k = 0; k < N; k++) freqEnergy += (re[k]! * re[k]! + im[k]! * im[k]!) / N;
    assert.ok(Math.abs(timeEnergy - freqEnergy) < 1e-9, `Parseval mismatch: ${timeEnergy} vs ${freqEnergy}`);

    // 4th-order Butterworth at cutoff fc = 20 Hz, fs = 400 Hz -> gain at fc ≈ 1/sqrt(2) ≈ 0.7071
    const fs = 400;
    const fc = 20;
    const sos = designButterworth(4, fc, fs, "lowpass");
    const tone = Float64Array.from({ length: 800 }, (_, n) => Math.sin((2 * Math.PI * fc * n) / fs));
    const out = applySosFilter(tone, sos);
    let rms = 0;
    for (let i = 400; i < 800; i++) rms += out[i]! * out[i]!;
    const amp = Math.sqrt((2 * rms) / 400);
    assert.ok(Math.abs(amp - Math.SQRT1_2) < 0.03, `Expected ~0.7071 at -3dB cutoff, got ${amp}`);
  });

  it("matches analytical 2-link Featherstone gravity torque (Pinocchio parity) and M/M/2 Erlang-C + Max-Flow/Min-Cut duality", () => {
    // Two horizontal 1m links (m1=2, lc1=0.5; m2=3, lc2=0.5), g=10:
    // tau2 = m2*g*lc2 = 3*10*0.5 = 15
    // tau1 = m1*g*lc1 + m2*g*(L1 + lc2) = 2*10*0.5 + 3*10*1.5 = 10 + 45 = 55
    const tau = featherstonePlanarRnea(
      [
        { length: 1, comOffset: 0.5, mass: 2, inertia: 0.1 },
        { length: 1, comOffset: 0.5, mass: 3, inertia: 0.1 },
      ],
      [0, 0],
      [0, 0],
      [0, 0],
      10.0,
    );
    assert.ok(Math.abs(tau[1]! - 15.0) < 1e-10);
    assert.ok(Math.abs(tau[0]! - 55.0) < 1e-10);

    // Exact M/M/2 with lambda=2, mu=2 => a=1, rho=0.5, P0 = 1/(1 + 1 + 1/(2*0.5)) = 1/3, P_wait = 1/3
    const mm2 = solveMmcQueue(2, 2, 2);
    assert.ok(Math.abs(mm2.probWait - 1 / 3) < 1e-10);

    // Max-Flow == Min-Cut capacity
    const edges = [
      { from: 0, to: 1, capacity: 10 },
      { from: 0, to: 2, capacity: 5 },
      { from: 1, to: 3, capacity: 4 },
      { from: 2, to: 3, capacity: 8 },
      { from: 1, to: 2, capacity: 2 },
    ];
    const mf = dinicMaxFlow(4, edges, 0, 3);
    let minCutCap = 0;
    for (const e of edges) {
      if (mf.minCutReachable[e.from] && !mf.minCutReachable[e.to]) minCutCap += e.capacity;
    }
    assert.equal(mf.maxFlow, minCutCap);
  });

  it("runs WebGPU host pipeline runners (CPU fallback), IDE visualization adapters, and LSP diagnostic mapping", async () => {
    const simpRunner = new WebGPUSimpFilterRunner();
    const simpInfo = await simpRunner.init(null);
    assert.equal(simpInfo.backend, "cpu");
    const filt = await simpRunner.filter(new Float32Array(12).fill(0.5), new Float32Array(12).fill(-1.0), 4, 3, 1.5);
    assert.equal(filt.dcn.length, 12);

    const fdtdRunner = new WebGPUFdtd3DRunner();
    await fdtdRunner.init(null);
    const ez = new Float32Array(27);
    const hx = new Float32Array(27);
    const hy = new Float32Array(27);
    hy[13] = 1.0;
    fdtdRunner.stepElectricFieldCpu(ez, hx, hy, new Float32Array(27).fill(1.0), 3, 3, 3, 0.5);
    assert.notEqual(ez[13], 0);

    const doseRunner = new WebGPUDoseTransportRunner();
    await doseRunner.init(null);
    const dose = await doseRunner.computeDose(
      [6, 6, 6],
      [5, 5, 5],
      [{ originMm: [15, 15, 0], direction: [0, 0, 1], doseAtDmaxGy: 2.0, sigmaMm: 10 }],
    );
    assert.ok(dose.maxDoseGy > 1.0);

    // IDE visualization payloads
    const sig = Float64Array.from({ length: 128 }, (_, n) => Math.sin(0.4 * n));
    const psdChart = buildPsdChartData(welchPsd(sig, 100, { segmentLength: 64 }));
    assert.equal(psdChart.kind, "line-chart");
    const specChart = buildSpectrogramChartData(stft(sig, 100, 32, 16));
    assert.equal(specChart.kind, "spectrogram");
    const mor = balancedTruncation(
      [
        [-1, 0],
        [0, -10],
      ],
      [[1], [1]],
      [[1, 0.2]],
      [[0]],
      1,
    );
    const hsvChart = buildHankelSingularValuesChartData(mor);
    assert.equal(hsvChart.logY, true);
    const dvhChart = buildDvhCurveChartData(dose.doseGy, new Uint8Array(dose.doseGy.length).fill(1));
    assert.equal(dvhChart.series[0]!.y[0], 100);
    const tube = buildTrajectoryTubeOverlay(
      [
        [0, 0, 0],
        [1, 1, 0],
      ],
      0.25,
    );
    assert.equal(tube.kind, "trajectory-tube-3d");
    const pcb = buildPcbRouteOverlay([
      {
        netId: "VCC",
        points: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
        ],
      },
    ]);
    assert.equal(pcb.kind, "pcb-route-2d");

    const domainDiags = lintMacromodelPassivity({
      id: "s2p_port1",
      kind: "scattering",
      frequenciesHz: [1e9],
      values: [1.08],
    });
    assert.equal(domainDiags.length, 1);
    assert.equal(domainDiags[0]!.code, "M5102");
  });
});
