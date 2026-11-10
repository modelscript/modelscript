// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  type HarmonicSystemSpec,
  runFrequencyScan,
  solveHarmonicPowerFlow,
} from "../src/solvers/powerflow/harmonics-solver.js";

test("runFrequencyScan: detects parallel resonance peak from capacitor bank", () => {
  // Simple 2-bus system: Bus 0 (Source) to Bus 1 (Load with capacitor bank)
  // Inductive line L and parallel capacitor C form a parallel LC tank with resonance peak
  const system: HarmonicSystemSpec = {
    numBuses: 2,
    baseFreqHz: 50.0,
    branches: [
      {
        fromBus: 0,
        toBus: 1,
        r1: 0.05,
        x1: 0.50, // inductive reactance at 50 Hz
      },
    ],
    shunts: [
      {
        busIndex: 1,
        bShunt: 0.02, // capacitive susceptance at 50 Hz: resonance around h ≈ sqrt(1 / (X_L * B_C)) = sqrt(1 / 0.01) = 10 (500 Hz)
      },
    ],
    injections: [],
  };

  const { scanPoints, resonances } = runFrequencyScan(system, 1, {
    startHarmonic: 1.0,
    endHarmonic: 25.0,
    stepHarmonic: 0.5,
  });

  assert.ok(scanPoints.length > 20);
  assert.ok(resonances.length >= 1, "Must detect parallel resonance peak");

  const primaryRes = resonances[0]!;
  assert.strictEqual(primaryRes.type, "parallel");
  // Expected harmonic order near ~7 - 12
  assert.ok(
    primaryRes.harmonicOrder >= 6 && primaryRes.harmonicOrder <= 14,
    `Resonance harmonic order ${primaryRes.harmonicOrder} should be near ~10`,
  );
  assert.ok(primaryRes.peakImpedance > 1.0, "Impedance at resonance should be amplified");
});

test("solveHarmonicPowerFlow: solves 5th and 7th harmonic voltages and evaluates THD", () => {
  // 3-bus network with a 6-pulse converter injecting 5th and 7th harmonic currents at Bus 2
  const system: HarmonicSystemSpec = {
    numBuses: 3,
    baseFreqHz: 50.0,
    branches: [
      { fromBus: 0, toBus: 1, r1: 0.02, x1: 0.10 },
      { fromBus: 1, toBus: 2, r1: 0.03, x1: 0.15 },
    ],
    injections: [
      { busIndex: 2, harmonicOrder: 5, currentMag: 0.08 }, // 8% 5th harmonic current
      { busIndex: 2, harmonicOrder: 7, currentMag: 0.04 }, // 4% 7th harmonic current
    ],
    fundamentalVoltages: [1.0, 0.99, 0.98],
  };

  const result = solveHarmonicPowerFlow(system, {
    thdLimitPercent: 5.0,
    ihdLimitPercent: 3.0,
  });

  assert.strictEqual(result.buses.length, 3);
  assert.strictEqual(result.totalHarmonicOrdersAnalyzed, 2);

  // Bus 2 (at the converter injection) should have the highest THD
  const bus2 = result.buses[2]!;
  assert.ok(bus2.thdPercent > 0, "Bus 2 THD should be positive");
  assert.ok(bus2.harmonicVoltages.has(5), "Bus 2 should have 5th harmonic voltage");
  assert.ok(bus2.harmonicVoltages.has(7), "Bus 2 should have 7th harmonic voltage");

  // Bus 0 (stiff source) should have lower THD than Bus 2
  const bus0 = result.buses[0]!;
  assert.ok(bus2.thdPercent > bus0.thdPercent, "Converter bus THD should be higher than source bus");
});
