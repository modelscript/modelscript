// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseSpice, solveAc, solveOp, solveTran } from "../src/index.js";

describe("SPICE Numerical Solvers (@modelscript/spice)", () => {
  describe("DC Operating Point Solver (.OP)", () => {
    it("should accurately solve a linear resistive voltage divider", () => {
      const netlist = `* Resistive Divider
V1 in 0 DC 10
R1 in mid 1k
R2 mid 0 1k
.OP
.END`;
      const circuit = parseSpice(netlist);
      const op = solveOp(circuit);

      assert.ok(op.converged, "Solver should converge for linear circuit");
      const vIn = op.nodeVoltages.get("IN");
      const vMid = op.nodeVoltages.get("MID");

      assert.ok(vIn !== undefined);
      assert.ok(vMid !== undefined);
      assert.strictEqual(Math.round(vIn * 1e4) / 1e4, 10.0);
      assert.strictEqual(Math.round(vMid * 1e4) / 1e4, 5.0);

      // Branch current for V1
      const iV1 = op.branchCurrents.get("V1");
      assert.ok(iV1 !== undefined);
      assert.strictEqual(Math.round(iV1 * 1e5) / 1e5, -0.005); // 5mA leaving positive terminal
    });

    it("should converge on a non-linear diode circuit using Newton-Raphson", () => {
      const netlist = `* Diode Circuit
V1 in 0 DC 5
R1 in anode 1k
D1 anode 0 1N4148
.MODEL 1N4148 D (IS=1e-14 N=1.0)
.OP
.END`;
      const circuit = parseSpice(netlist);
      const op = solveOp(circuit);

      assert.ok(op.converged, "Newton-Raphson should converge for diode circuit");
      const vAnode = op.nodeVoltages.get("ANODE");
      assert.ok(vAnode !== undefined);
      // Typical silicon diode drop at ~4.3mA: ~0.65V - 0.72V
      assert.ok(vAnode > 0.6 && vAnode < 0.75, `Expected diode voltage ~0.68V, got ${vAnode}`);
    });

    it("should resolve hierarchical subcircuit calls in DC operating point", () => {
      const netlist = `* Subcircuit Voltage Follower
V1 in 0 DC 3.3
X1 in out BUFFER
R_load out 0 10k

.SUBCKT BUFFER in_pin out_pin
  E1 out_pin 0 in_pin 0 1.0
.ENDS BUFFER

.OP
.END`;
      const circuit = parseSpice(netlist);
      const op = solveOp(circuit);

      assert.ok(op.converged);
      const vOut = op.nodeVoltages.get("OUT");
      assert.ok(vOut !== undefined);
      assert.strictEqual(Math.round(vOut * 1e4) / 1e4, 3.3);
    });
  });

  describe("Transient Solver (.TRAN)", () => {
    it("should simulate an RC step response matching the analytical exponential solution", () => {
      // R = 1k, C = 1uF => tau = R*C = 1ms
      // Step: V(t) = 5 * (1 - exp(-t / tau))
      const netlist = `* RC Step Response
V1 in 0 DC 5
R1 in out 1k
C1 out 0 1u
.TRAN 10u 4m UIC
.END`;
      const circuit = parseSpice(netlist);
      const tran = solveTran(circuit, { tstep: 1e-5, tstop: 4e-3, uic: true });

      assert.ok(tran.time.length > 50, "Should generate trajectory points");
      const outSignal = tran.nodeVoltages.get("OUT");
      assert.ok(outSignal);

      // Find sample near t = 1ms (1 time constant tau)
      const targetTime = 1e-3;
      let closestIdx = 0;
      let minDiff = 1e9;
      for (let i = 0; i < tran.time.length; i++) {
        const diff = Math.abs((tran.time[i] ?? 0) - targetTime);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }

      const vSim = outSignal[closestIdx] ?? 0;
      const vExact = 5.0 * (1.0 - Math.exp(-1.0)); // ~3.1606 V
      const relError = Math.abs(vSim - vExact) / vExact;

      assert.ok(
        relError < 0.01,
        `Expected <1% error vs analytical at t=tau, got error ${(relError * 100).toFixed(3)}% (vSim=${vSim}, vExact=${vExact})`,
      );
    });

    it("should simulate a sinusoidal source and voltage divider", () => {
      const netlist = `* Sine Wave Transient
V1 in 0 SINE(0 10 1k)
R1 in out 1k
R2 out 0 1k
.TRAN 10u 2m
.END`;
      const circuit = parseSpice(netlist);
      const tran = solveTran(circuit, { tstep: 1e-5, tstop: 2e-3 });

      const inSig = tran.nodeVoltages.get("IN");
      const outSig = tran.nodeVoltages.get("OUT");
      assert.ok(inSig && outSig);

      // Out signal should be exactly half of in signal at every point
      for (let i = 0; i < tran.time.length; i++) {
        const vIn = inSig[i] ?? 0;
        const vOut = outSig[i] ?? 0;
        assert.ok(Math.abs(vOut - vIn / 2) < 1e-6);
      }
    });

    it("should simulate a non-linear diode half-wave rectifier with RC load using inner Newton-Raphson", () => {
      const netlist = `* Half-Wave Diode Rectifier
V1 in 0 SINE(0 5 1k)
D1 in out 1N4148
R1 out 0 1k
C1 out 0 1u
.MODEL 1N4148 D (IS=1e-14 N=1.0)
.TRAN 10u 2m UIC
.END`;
      const circuit = parseSpice(netlist);
      const tran = solveTran(circuit, { tstep: 1e-5, tstop: 2e-3, uic: true });

      const outSig = tran.nodeVoltages.get("OUT");
      assert.ok(outSig && outSig.length > 50);

      let maxOut = -Infinity;
      let minOut = Infinity;
      for (const v of outSig) {
        if (v > maxOut) maxOut = v;
        if (v < minOut) minOut = v;
      }

      // Peak output should be ~ 5V - Vd (~4.1V to 4.5V) and never go significantly negative
      assert.ok(maxOut > 3.8 && maxOut < 4.6, `Expected rectified peak ~4.3V, got ${maxOut}`);
      assert.ok(minOut >= -0.05, `Expected rectified output >= -0.05V, got ${minOut}`);
    });
  });

  describe("AC Small-Signal Solver (.AC)", () => {
    it("should compute frequency response of a 1st-order RC low-pass filter with -3dB cutoff at 1kHz", () => {
      // R = 1k, C = 159.155nF => fc = 1 / (2*pi*R*C) = 1000 Hz
      const netlist = `* RC Low-Pass AC Sweep
V1 in 0 AC 1
R1 in out 1k
C1 out 0 159.155n
.AC DEC 10 10 100k
.END`;
      const circuit = parseSpice(netlist);
      const ac = solveAc(circuit);

      assert.ok(ac.frequency.length > 30, "Should generate AC frequency points");
      const outSig = ac.nodeVoltages.get("OUT");
      assert.ok(outSig);

      // Low frequency (f = 10 Hz): gain ~ 0 dB (1.0), phase ~ 0 deg
      const magLowDb = outSig.magnitudeDb[0] ?? -100;
      assert.ok(Math.abs(magLowDb) < 0.1, `Expected low-frequency gain ~0 dB, got ${magLowDb}`);

      // Find point closest to 1000 Hz (cutoff frequency)
      let cutoffIdx = 0;
      let minDiff = 1e9;
      for (let i = 0; i < ac.frequency.length; i++) {
        const diff = Math.abs((ac.frequency[i] ?? 0) - 1000);
        if (diff < minDiff) {
          minDiff = diff;
          cutoffIdx = i;
        }
      }

      const magCutoffDb = outSig.magnitudeDb[cutoffIdx] ?? -100;
      const phaseCutoff = outSig.phaseDeg[cutoffIdx] ?? 0;

      // At cutoff: -3.01 dB, -45 degrees
      assert.ok(Math.abs(magCutoffDb - -3.01) < 0.25, `Expected cutoff gain ~ -3.01 dB, got ${magCutoffDb}`);
      assert.ok(Math.abs(phaseCutoff - -45.0) < 2.0, `Expected cutoff phase ~ -45 deg, got ${phaseCutoff}`);

      // High frequency (100 kHz = 2 decades above cutoff): roll-off ~ -40 dB
      const magHighDb = outSig.magnitudeDb[outSig.magnitudeDb.length - 1] ?? 0;
      assert.ok(Math.abs(magHighDb - -40.0) < 1.0, `Expected high-frequency attenuation ~ -40 dB, got ${magHighDb}`);
    });

    it("should linearize a biased BJT common-emitter stage around .OP for small-signal .AC gain", () => {
      const netlist = `* Common-Emitter BJT Small-Signal AC Amplifier
VCC vcc 0 DC 12
VIN in 0 DC 1.45 AC 1
RB in base 10k
RC vcc col 2k
RE emit 0 500
CE emit 0 100u
Q1 col base emit NPN_AMP
.MODEL NPN_AMP NPN (IS=1e-14 BF=150)
.AC DEC 5 100 100k
.END`;
      const circuit = parseSpice(netlist);
      const op = solveOp(circuit);
      assert.ok(op.converged);
      const vColDc = op.nodeVoltages.get("COL") ?? 12;
      assert.ok(vColDc > 2.0 && vColDc < 11.0, `Expected active-region collector voltage, got ${vColDc}`);

      const ac = solveAc(circuit);
      const colSig = ac.nodeVoltages.get("COL");
      assert.ok(colSig);
      // At high frequency where CE bypasses RE, voltage gain |Vc/Vin| > 10 (> 20 dB) with ~180 deg phase inversion
      const lastIdx = colSig.magnitude.length - 1;
      const gainMag = colSig.magnitude[lastIdx] ?? 0;
      assert.ok(gainMag > 10.0, `Expected common-emitter AC voltage gain > 10 V/V, got ${gainMag}`);
    });
  });

  describe("Coupled Inductors (K) & Parameterized Subcircuit Expansion", () => {
    it("should simulate 1:2 step-up transformer using coupled inductors K1 L1 L2 0.999 in .TRAN and .AC", () => {
      const netlist = `* Coupled Inductor 1:2 Step-Up Transformer (L2/L1 = 4 => turns ratio = 2)
V1 pri 0 SINE(0 5 1k) AC 5
L1 pri 0 10m
L2 sec 0 40m
K1 L1 L2 0.999
Rload sec 0 10k
.TRAN 20u 2m UIC
.AC LIN 3 1k 2k
.END`;
      const circuit = parseSpice(netlist);
      const ac = solveAc(circuit);
      const secAc = ac.nodeVoltages.get("SEC");
      assert.ok(secAc);
      const acOutMag = secAc.magnitude[0] ?? 0;
      // Input AC = 5V, turns ratio sqrt(40m/10m) = 2 => secondary ~ 10V
      assert.ok(Math.abs(acOutMag - 10.0) < 0.2, `Expected AC secondary amplitude ~10V, got ${acOutMag}`);

      const tran = solveTran(circuit, { tstep: 20e-6, tstop: 2e-3, uic: true });
      const secTran = tran.nodeVoltages.get("SEC") ?? [];
      const maxSec = Math.max(...secTran);
      assert.ok(maxSec > 9.5 && maxSec < 10.5, `Expected transient secondary peak ~10V, got ${maxSec}`);
    });

    it("should expand parameterized .SUBCKT instances with parameter overrides", () => {
      const netlist = `* Parameterized Voltage Divider Subcircuit
V1 in 0 DC 12
X1 in out1 VDIV RTOP=3k RBOT=1k
X2 in out2 VDIV RTOP=1k RBOT=3k
.SUBCKT VDIV p_in p_out RTOP=1k RBOT=1k
R1 p_in p_out {RTOP}
R2 p_out 0 {RBOT}
.ENDS VDIV
.OP
.END`;
      const circuit = parseSpice(netlist);
      assert.ok(circuit.expandedComponents && circuit.expandedComponents.length === 5);
      const op = solveOp(circuit);
      assert.ok(op.converged);
      const vOut1 = op.nodeVoltages.get("OUT1") ?? 0;
      const vOut2 = op.nodeVoltages.get("OUT2") ?? 0;
      assert.ok(Math.abs(vOut1 - 3.0) < 1e-4, `Expected OUT1 = 3.0V, got ${vOut1}`);
      assert.ok(Math.abs(vOut2 - 9.0) < 1e-4, `Expected OUT2 = 9.0V, got ${vOut2}`);
    });
  });
});
