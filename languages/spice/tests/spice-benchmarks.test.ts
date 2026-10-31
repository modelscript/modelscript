// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSpice, solveAc, solveOp, solveTran } from "../src/index.js";

describe("languages/spice: Berkeley SPICE3f5 & ngspice Reference Benchmarks", () => {
  describe("Benchmark 1: 2nd-Order Series RLC Resonant Bandpass Tank", () => {
    // R = 10 ohm, L = 1 mH (1e-3), C = 100 nF (1e-7)
    // f0 = 1 / (2 * pi * sqrt(L * C)) = 1 / (2 * pi * sqrt(1e-10)) = 1 / (2 * pi * 1e-5) = 15915.49 Hz
    // Q = omega0 * L / R = (2 * pi * 15915.49 * 1e-3) / 10 = 10.0
    const netlist = `* Series RLC Bandpass Resonant Tank
V1 in 0 AC 1
L1 in n1 1m
C1 n1 out 100n
R1 out 0 50
.AC LIN 1000 10k 25k
.END`;

    it("identifies peak resonance at 15.9 kHz and 0-degree phase crossing", () => {
      const circuit = parseSpice(netlist);
      const ac = solveAc(circuit);

      const outSig = ac.nodeVoltages.get("OUT");
      assert.ok(outSig);

      // Find peak magnitude
      let maxMag = -1;
      let peakFreq = 0;
      let peakPhase = 0;
      for (let i = 0; i < ac.frequency.length; i++) {
        const mag = outSig.magnitude[i] ?? 0;
        if (mag > maxMag) {
          maxMag = mag;
          peakFreq = ac.frequency[i] ?? 0;
          peakPhase = outSig.phaseDeg[i] ?? 0;
        }
      }

      // Expected resonance f0 ~ 15915 Hz
      const relFreqError = Math.abs(peakFreq - 15915.5) / 15915.5;
      assert.ok(
        relFreqError < 0.015,
        `Expected resonant peak near 15915 Hz, got ${peakFreq.toFixed(1)} Hz (error ${(relFreqError * 100).toFixed(2)}%)`,
      );

      // At peak, circuit impedance is purely resistive R1 + R_meas (dominated by R_meas divider)
      assert.ok(maxMag > 0.95, `Expected near unity transmission at resonance, got ${maxMag.toFixed(3)}`);
      assert.ok(Math.abs(peakPhase) < 10.0, `Expected phase near 0 deg at resonance, got ${peakPhase.toFixed(1)} deg`);
    });
  });

  describe("Benchmark 2: Closed-Loop Non-Inverting Op-Amp Stage (Gain = 11)", () => {
    // Op-Amp model using VCVS (E-element) with open-loop gain Aol = 100,000
    // Non-inverting feedback: Rf = 10k, Rin = 1k => Ideal Closed Loop Gain = 1 + Rf/Rin = 11.0
    const netlist = `* Non-Inverting Op-Amp Stage (Av = 11)
V_IN in 0 DC 0.5 SINE(0 0.5 1k) AC 1.0
* Op-Amp Macromodel (in_pos in_neg out 0 Aol)
E_OP out 0 in neg 100000
R_F out neg 10k
R_IN neg 0 1k
R_LOAD out 0 50k
.OP
.TRAN 10u 2m
.END`;

    it("verifies DC closed-loop gain Av = 11.000 within 0.01% precision", () => {
      const circuit = parseSpice(netlist);
      const op = solveOp(circuit);
      assert.ok(op.converged);

      const vIn = op.nodeVoltages.get("IN") ?? 0;
      const vOut = op.nodeVoltages.get("OUT") ?? 0;
      const gain = vOut / vIn;

      // Closed loop with Aol=1e5: G = 11 / (1 + 11/1e5) = 10.9988
      assert.ok(Math.abs(gain - 11.0) < 0.01, `Expected closed-loop voltage gain ~11.0, got ${gain.toFixed(4)}`);
    });

    it("verifies transient sine amplification without distortion", () => {
      const circuit = parseSpice(netlist);
      const tran = solveTran(circuit, { tstep: 10e-6, tstop: 2e-3 });

      const inSig = tran.nodeVoltages.get("IN") ?? [];
      const outSig = tran.nodeVoltages.get("OUT") ?? [];
      assert.ok(inSig.length > 50);

      // Verify that outSig(t) = 11.0 * inSig(t) at all sample points
      let maxError = 0;
      for (let i = 0; i < inSig.length; i++) {
        const expected = (inSig[i] ?? 0) * 11.0;
        const actual = outSig[i] ?? 0;
        const err = Math.abs(actual - expected);
        if (err > maxError) maxError = err;
      }

      assert.ok(
        maxError < 0.01,
        `Max error between simulated output and exact 11x input is ${maxError.toFixed(5)}V (must be < 0.01V)`,
      );
    });
  });

  describe("Benchmark 3: 3rd-Order Butterworth Low-Pass LC Ladder Filter", () => {
    // Normalized 1 rad/s 3rd-order Butterworth: C1 = 1F, L2 = 2H, C3 = 1F, R_term = 1 ohm
    // Scaled for fc = 10 kHz (omega_c = 2*pi*10000 = 62831.85 rad/s), R_0 = 50 ohm:
    // C1 = C3 = 1 / (50 * omega_c) = 318.31 nF
    // L2 = (2 * 50) / omega_c = 1.5915 mH
    const netlist = `* 3rd-Order Butterworth LC Ladder (fc = 10 kHz, R0 = 50 ohm)
V1 in 0 AC 1.0
RS in n1 50
C1 n1 0 318.31n
L2 n1 n2 1.5915m
C3 n2 0 318.31n
RL n2 0 50
.AC DEC 20 1k 100k
.END`;

    it("verifies -3dB passband edge at 10 kHz and -60dB/decade stopband rolloff", () => {
      const circuit = parseSpice(netlist);
      const ac = solveAc(circuit);

      const n2Sig = ac.nodeVoltages.get("N2");
      assert.ok(n2Sig);

      // Terminated ladder DC passband gain: Vout/Vin = RL / (RS + RL) = 50 / 100 = 0.5 (-6.02 dB)
      const dcGain = n2Sig.magnitude[0] ?? 0;
      assert.ok(Math.abs(dcGain - 0.5) < 0.02, `Expected passband gain ~0.5, got ${dcGain.toFixed(3)}`);

      // Find closest frequency point to 10 kHz
      let cutoffIdx = 0;
      let minDiff = 1e9;
      for (let i = 0; i < ac.frequency.length; i++) {
        const diff = Math.abs((ac.frequency[i] ?? 0) - 10000);
        if (diff < minDiff) {
          minDiff = diff;
          cutoffIdx = i;
        }
      }

      // At fc, gain must be 3 dB below passband: 0.5 * 1/sqrt(2) = 0.3535
      const cutoffGain = n2Sig.magnitude[cutoffIdx] ?? 0;
      const expectedCutoffGain = 0.5 / Math.SQRT2;
      assert.ok(
        Math.abs(cutoffGain - expectedCutoffGain) < 0.025,
        `Expected gain ~${expectedCutoffGain.toFixed(3)} at 10 kHz, got ${cutoffGain.toFixed(3)}`,
      );

      // At 100 kHz (1 decade above fc), a 3-pole filter rolls off by 60 dB (gain * 10^-3)
      const stopbandGain = n2Sig.magnitude[n2Sig.magnitude.length - 1] ?? 0;
      assert.ok(stopbandGain < 0.005, `Expected stopband gain < 0.005 at 100 kHz, got ${stopbandGain.toFixed(5)}`);
    });
  });

  describe("Benchmark 4: Lumped LC Transmission Delay Line", () => {
    // 5-stage LC lumped delay line: L = 10 uH, C = 100 pF per stage
    // Stage delay td = sqrt(L * C) = sqrt(10e-6 * 100e-12) = 31.62 ns
    // Total delay for 5 stages = ~158 ns
    const netlist = `* 5-Stage LC Delay Line
V1 in 0 PULSE(0 5 0 10n 10n 500n 1u)
RS in n1 316.2
L1 n1 n2 10u
C1 n2 0 100p
L2 n2 n3 10u
C2 n3 0 100p
L3 n3 n4 10u
C3 n4 0 100p
L4 n4 n5 10u
C4 n5 0 100p
L5 n5 out 10u
C5 out 0 100p
RL out 0 316.2
.TRAN 2n 800n UIC
.END`;

    it("verifies finite electromagnetic propagation delay across 5 LC stages", () => {
      const circuit = parseSpice(netlist);
      const tran = solveTran(circuit, { tstep: 2e-9, tstop: 800e-9, uic: true });

      const inSig = tran.nodeVoltages.get("IN") ?? [];
      const outSig = tran.nodeVoltages.get("OUT") ?? [];
      assert.ok(inSig.length > 100);

      // Find time where input rises past 2.5V (50% threshold)
      let tIn50 = 0;
      for (let i = 0; i < tran.time.length; i++) {
        if ((inSig[i] ?? 0) >= 2.5) {
          tIn50 = tran.time[i] ?? 0;
          break;
        }
      }

      // Find time where output rises past 1.25V (50% of matched terminated voltage 2.5V)
      let tOut50 = 0;
      for (let i = 0; i < tran.time.length; i++) {
        if ((outSig[i] ?? 0) >= 1.25) {
          tOut50 = tran.time[i] ?? 0;
          break;
        }
      }

      const measuredDelayNs = (tOut50 - tIn50) * 1e9;
      // Theoretical delay: 5 * 31.62 ns ~ 158 ns (+ rise time fraction)
      assert.ok(
        measuredDelayNs > 100 && measuredDelayNs < 250,
        `Expected propagation delay between 100ns and 250ns, got ${measuredDelayNs.toFixed(1)} ns`,
      );
    });
  });
});
