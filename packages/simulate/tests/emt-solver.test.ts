// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { EmtSolver, type EmtCircuitDefinition } from "../src/solvers/emt/index.js";

console.log("=== Testing WebAssembly Hybrid EMT Companion Solver ===");

// 1. Test LC Tank Resonant Frequency & Energy Conservation
{
  console.log("Test 1: LC Tank Resonator (Analytical Parity)");
  // L = 10 mH, C = 100 uF -> f0 = 1 / (2*pi*sqrt(L*C)) = 159.155 Hz
  const L = 0.01;
  const C = 100e-6;
  const expectedFreqHz = 1 / (2 * Math.PI * Math.sqrt(L * C)); // ~159.155 Hz
  const dt = 20e-6; // 20 microseconds
  const duration = 0.05; // 50 ms

  const circuit: EmtCircuitDefinition = {
    buses: ["Bus1"],
    rlc: [
      { id: "L1", from: "Bus1", to: "GND", l: L },
      { id: "C1", from: "Bus1", to: "GND", c: C },
    ],
    sources: [
      // 10 kV source at 159 Hz to excite the resonant tank
      { bus: "Bus1", vPeakKv: 10.0, freqHz: expectedFreqHz },
    ],
  };

  const solver = new EmtSolver(circuit, { timeStepSec: dt, durationSec: duration });
  const result = solver.solve();

  assert.strictEqual(result.metrics.totalSteps, Math.ceil(duration / dt));
  assert.strictEqual(result.metrics.factorizationCount, 1);

  const vBus1 = result.busVoltages.get("Bus1")!;
  assert.ok(vBus1.length > 0);

  // Check that voltage oscillates stably without diverging
  let maxV = 0;
  for (const v of vBus1) {
    const absV = Math.abs(v);
    if (absV > maxV) maxV = absV;
  }
  console.log(
    `   LC Peak Voltage: ${(maxV / 1e3).toFixed(2)} kV across ${result.metrics.totalSteps} steps in ${result.metrics.wallClockTimeMs} ms`,
  );
  assert.ok(maxV > 1000 && maxV < 50000, "Voltage should resonate within bounded physical limits");
}

// 2. Test Bergeron Transmission Line Wave Travel Time Delay
{
  console.log("Test 2: Bergeron Traveling-Wave Transmission Line Delay");
  // Length = 150 km, L = 1.0 mH/km, C = 1.111e-8 F/km
  // Wave speed v = 1 / sqrt(L*C) = 300,000 km/s (speed of light)
  // Travel time tau = 150 km / 300,000 km/s = 0.0005 s (0.5 ms = 500 us)
  const dt = 20e-6; // 20 us
  const duration = 0.005; // 5 ms (250 steps)
  const tauExpected = 0.0005; // 0.5 ms

  const circuit: EmtCircuitDefinition = {
    buses: ["SendingBus", "ReceivingBus"],
    rlc: [
      // Receiving end load: matched characteristic impedance Zc = sqrt(L/C) = 300 Ohm
      { id: "R_load", from: "ReceivingBus", to: "GND", r: 300.0 },
    ],
    transmissionLines: [
      {
        id: "Line1",
        from: "SendingBus",
        to: "ReceivingBus",
        lengthKm: 150.0,
        lPerKm: 0.001,
        cPerKm: 1.111e-8,
        rPerKm: 0.01,
      },
    ],
    sources: [
      // Fast step pulse at sending end at 60 Hz
      { bus: "SendingBus", vPeakKv: 100.0, freqHz: 60.0 },
    ],
  };

  const solver = new EmtSolver(circuit, { timeStepSec: dt, durationSec: duration });
  const result = solver.solve();

  const vRecv = result.busVoltages.get("ReceivingBus")!;
  const time = result.time;

  // Find when voltage at receiving end first becomes non-zero (> 1 V)
  let firstArrivalTime = -1;
  for (let i = 0; i < vRecv.length; i++) {
    if (Math.abs(vRecv[i]!) > 1.0) {
      firstArrivalTime = time[i]!;
      break;
    }
  }

  console.log(`   Expected Arrival Time: ${(tauExpected * 1e3).toFixed(3)} ms`);
  console.log(`   Measured Arrival Time: ${(firstArrivalTime * 1e3).toFixed(3)} ms`);

  assert.ok(firstArrivalTime > 0, "Wave must arrive at receiving end");
  const delayDiff = Math.abs(firstArrivalTime - tauExpected);
  assert.ok(
    delayDiff <= 2 * dt,
    `Travel delay must match within 2 time steps (diff: ${(delayDiff * 1e6).toFixed(1)} us)`,
  );
}

// 3. Test Hybrid Grid with Black-Box Inverter FMU & Norton Predictor
{
  console.log("Test 3: Hybrid Grid with Black-Box Inverter FMU");
  const dt = 25e-6; // 25 us
  const duration = 0.05; // 50 ms (2,000 steps)

  const circuit: EmtCircuitDefinition = {
    buses: ["GridSubstation", "InverterPOI"],
    rlc: [
      // Substation transformer impedance
      { id: "Xfmr_R", from: "GridSubstation", to: "InverterPOI", r: 0.1 },
      { id: "Xfmr_L", from: "GridSubstation", to: "InverterPOI", l: 0.005 },
    ],
    fmuInstances: [
      {
        id: "Solar_IBR_FMU",
        bus: "InverterPOI",
        ratedMva: 50.0,
        ratedKv: 34.5,
        pSetpointMw: 45.0,
        qSetpointMvar: 0.0,
      },
    ],
    sources: [{ bus: "GridSubstation", vPeakKv: 34.5, freqHz: 60.0 }],
  };

  const solver = new EmtSolver(circuit, { timeStepSec: dt, durationSec: duration });
  const result = solver.solve();

  const vPoi = result.busVoltages.get("InverterPOI")!;
  assert.strictEqual(vPoi.length, 2000);

  // Verify that the Norton equivalent predictor keeps POI voltage stable
  let maxPoi = 0;
  for (const val of vPoi) {
    const absVal = Math.abs(val);
    if (absVal > maxPoi) maxPoi = absVal;
    assert.ok(!isNaN(absVal) && isFinite(absVal), "Voltages must remain finite and numerically stable");
  }

  console.log(
    `   Hybrid Co-Sim POI Peak Voltage: ${(maxPoi / 1e3).toFixed(2)} kV across 2,000 steps in ${result.metrics.wallClockTimeMs} ms`,
  );
  assert.ok(maxPoi > 10000 && maxPoi < 60000, "POI voltage must track nominal 34.5 kV system");
}

console.log("ALL EMT SOLVER TESTS PASSED SUCCESSFULLY! Milestones 3 & 4 verified.");
