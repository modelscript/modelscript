// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  createStandardDistributionFeeder,
  runWaterEnergyCoSimulation,
  solveForwardBackwardSweep,
} from "../src/index.js";

console.log("=== Testing Water-Energy Nexus Dynamic Co-Simulation Orchestrator ===");

// -----------------------------------------------------------------------------
// 1. Forward-Backward Sweep (FBS) Distribution Power Flow Solver
// -----------------------------------------------------------------------------
console.log("1. Testing solveForwardBackwardSweep()...");
const feeder = createStandardDistributionFeeder();

const baselineLoads = new Map<string | number, { pKw: number; qKvar: number }>([
  ["Bus_0", { pKw: 0, qKvar: 0 }],
  ["Bus_1", { pKw: 450, qKvar: 150 }],
  ["Bus_2", { pKw: 600, qKvar: 200 }],
  ["Bus_3", { pKw: 100, qKvar: 30 }],
]);

const vBaseline = solveForwardBackwardSweep(feeder, baselineLoads);

const v0 = vBaseline.get("Bus_0")?.vmPu ?? 0;
const v1 = vBaseline.get("Bus_1")?.vmPu ?? 0;
const v2 = vBaseline.get("Bus_2")?.vmPu ?? 0;
const v3 = vBaseline.get("Bus_3")?.vmPu ?? 0;

console.log(
  `   Voltages: Bus_0=${v0.toFixed(4)}, Bus_1=${v1.toFixed(4)}, Bus_2=${v2.toFixed(4)}, Bus_3=${v3.toFixed(4)}`,
);

assert.ok(Math.abs(v0 - 1.02) < 1e-4, "Substation voltage must match specified 1.02 pu");
assert.ok(v0 > v1, "Bus 0 voltage must be higher than downstream Bus 1");
assert.ok(v1 > v2, "Bus 1 voltage must be higher than downstream Bus 2");
assert.ok(v2 > v3, "Bus 2 voltage must be higher than end-of-feeder Bus 3");
assert.ok(v3 > 0.9 && v3 < 1.02, `Feeder voltage should remain within reasonable limits, got ${v3}`);

// Test with heavy pumping load added to Bus 3
const heavyLoads = new Map<string | number, { pKw: number; qKvar: number }>([
  ["Bus_0", { pKw: 0, qKvar: 0 }],
  ["Bus_1", { pKw: 450, qKvar: 150 }],
  ["Bus_2", { pKw: 600, qKvar: 200 }],
  ["Bus_3", { pKw: 1200, qKvar: 580 }], // Heavy industrial pumping station
]);

const vHeavy = solveForwardBackwardSweep(feeder, heavyLoads);
const v3Heavy = vHeavy.get("Bus_3")?.vmPu ?? 0;
console.log(`   Heavy pumping at Bus 3: V_3 dropped from ${v3.toFixed(4)} to ${v3Heavy.toFixed(4)} pu`);
assert.ok(v3Heavy < v3, "Heavy pumping load must induce additional voltage drop at Bus 3");

// -----------------------------------------------------------------------------
// 2. Full 24-Hour Dynamic Co-Simulation Execution
// -----------------------------------------------------------------------------
console.log("2. Testing runWaterEnergyCoSimulation()...");

const simResult = await runWaterEnergyCoSimulation({
  durationHours: 24.0,
  dtMinutes: 60.0,
  feeder,
  couplings: [
    {
      pumpId: "PUMP-1",
      feederBusId: "Bus_3",
      motorRatedPowerKw: 150.0,
      motorEfficiency: 0.93,
      pumpEfficiency: 0.84,
      powerFactor: 0.88,
      vfdEquipped: false,
      headCurveCoeffH0: 68.0,
      headCurveCoeffR: 0.0018,
    },
  ],
  touTariff: {
    offPeakPriceUsdPerKwh: 0.09,
    peakPriceUsdPerKwh: 0.32,
    peakHoursStart: 12,
    peakHoursEnd: 18,
    demandChargeUsdPerKw: 14.5,
  },
});

console.log(`   ${simResult.summary}`);
assert.strictEqual(simResult.totalMacroSteps, 24, "24 hourly macro-steps expected");
assert.ok(simResult.totalEnergyConsumedKwh > 0, "Pumping energy consumed must be positive");
assert.ok(simResult.totalEnergyCostUsd > 0, "Energy cost must be positive");
assert.ok(simResult.peakElectricDemandKw > 500, "Peak feeder demand must exceed baseline");
assert.ok(simResult.minFeederVoltagePu > 0.85, "Feeder voltage should not collapse completely");
assert.ok(simResult.totalWaterPumpedM3 > 0, "Total water pumped must be positive");

// Verify peak hour tariff switching
const hour2Record = simResult.records[2]; // 02:00 (off-peak)
const hour14Record = simResult.records[14]; // 14:00 (peak)

assert.strictEqual(hour2Record?.isPeakHour, false);
assert.strictEqual(hour2Record?.electricityPriceUsdPerKwh, 0.09);

assert.strictEqual(hour14Record?.isPeakHour, true);
assert.strictEqual(hour14Record?.electricityPriceUsdPerKwh, 0.32);

// Verify tank mass balance telemetry
assert.ok(simResult.records[0]?.tanks.length ?? 0 > 0, "Tank telemetry must be tracked");
const finalTank = simResult.records[23]?.tanks[0];
assert.ok(finalTank && finalTank.levelMeters > 0, "Final tank water level must be positive");

console.log("=== All Water-Energy Co-Simulation tests PASSED cleanly! ===");
