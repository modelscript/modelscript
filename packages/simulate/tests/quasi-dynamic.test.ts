// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import type { GenericPowerCase } from "../src/solvers/opf/types.js";
import {
  exportQdslSummary,
  runQuasiDynamicSimulation,
  type QdslBessConfig,
  type QdslProfile,
  type QdslTapChangerConfig,
} from "../src/solvers/powerflow/quasi-dynamic.js";

test("Quasi-Dynamic Simulation: 24-hour load and solar PV profile tracking", () => {
  // 3-bus transmission system:
  // Bus 1: Slack Generator
  // Bus 2: Solar PV generator + Battery
  // Bus 3: Industrial / Residential Load
  const testCase: GenericPowerCase = {
    header: { sbase: 100.0 },
    buses: new Map([
      [1, { i: 1, name: "GRID_SLACK", baseKv: 110, ide: 3, vm: 1.02, va: 0 }],
      [2, { i: 2, name: "PV_SOLAR_BUS", baseKv: 110, ide: 2, vm: 1.01, va: 0 }],
      [3, { i: 3, name: "LOAD_CENTER", baseKv: 110, ide: 1, vm: 1.00, va: 0 }],
    ]),
    loads: [
      { i: 3, pl: 80.0, ql: 30.0, status: 1 }, // 80 MW, 30 Mvar base load
    ],
    generators: [
      { i: 1, id: "G1", pg: 50.0, qg: 20.0, stat: 1 }, // Slack
      { i: 2, id: "PV1", pg: 60.0, qg: 0.0, stat: 1 }, // 60 MW Solar PV
    ],
    branches: [
      { i: 1, j: 2, ckt: "1", r: 0.02, x: 0.08, b: 0.02, rateA: 120.0, st: 1 },
      { i: 2, j: 3, ckt: "1", r: 0.03, x: 0.12, b: 0.03, rateA: 100.0, st: 1 },
      { i: 1, j: 3, ckt: "1", r: 0.025, x: 0.10, b: 0.025, rateA: 110.0, st: 1 },
    ],
  };

  // Typical diurnal residential load profile: low at night (0.5x), peak in evening (1.3x)
  const loadProfile: QdslProfile = {
    name: "DiurnalLoad",
    timePoints: [0, 4, 8, 12, 16, 19, 22, 24],
    values: [0.5, 0.45, 0.7, 0.85, 0.9, 1.3, 0.95, 0.55],
    interpolation: "linear",
  };

  // Solar PV Bell-curve: 0 at night, peak 1.0 at 12:00
  const solarProfile: QdslProfile = {
    name: "SolarIrradiance",
    timePoints: [0, 6, 9, 12, 15, 18, 20, 24],
    values: [0.0, 0.05, 0.6, 1.0, 0.7, 0.1, 0.0, 0.0],
    interpolation: "linear",
  };

  const genProfiles = new Map<string | number, QdslProfile>([
    ["2_PV1", solarProfile],
    [2, solarProfile],
  ]);

  const res = runQuasiDynamicSimulation(testCase, {
    timeStepHours: 1.0,
    durationHours: 24.0,
    defaultLoadProfile: loadProfile,
    generationProfiles: genProfiles,
  });

  assert.equal(res.steps.length, 24, "Must execute exactly 24 hourly time steps");
  assert.ok(res.totalEnergySuppliedMwh > 0, "Supplied energy must be positive");
  assert.ok(res.totalEnergyLossesMwh > 0, "Losses must be positive");
  assert.ok(res.lossPercentage > 0 && res.lossPercentage < 10.0, "Loss percentage must be realistic (< 10%)");

  // Step at 12:00 (peak solar) vs 19:00 (evening peak load with 0 solar)
  const stepNoon = res.steps[12]!;
  const stepEvening = res.steps[19]!;

  assert.ok(stepNoon.converged, "Noon step must converge");
  assert.ok(stepEvening.converged, "Evening peak step must converge");

  // At noon, solar injects ~60 MW at Bus 2, so Bus 3 voltage should be higher than at evening peak (104 MW load, 0 solar)
  const vNoon = stepNoon.busVoltages.get(3)!;
  const vEvening = stepEvening.busVoltages.get(3)!;
  assert.ok(
    vNoon > vEvening,
    `Bus 3 voltage at noon (${vNoon.toFixed(4)}) must be higher than at evening peak (${vEvening.toFixed(4)})`,
  );

  const report = exportQdslSummary(res);
  assert.ok(report.includes("QUASI-DYNAMIC TIME-SERIES SIMULATION"), "Report must include header");
  assert.ok(report.includes("Total Energy Supplied"), "Report must include energy totals");
});

test("Quasi-Dynamic Simulation: Battery (BESS) SoC tracking and peak-shaving", () => {
  const testCase: GenericPowerCase = {
    header: { sbase: 100.0 },
    buses: new Map([
      [1, { i: 1, name: "GRID", baseKv: 20, ide: 3, vm: 1.0, va: 0 }],
      [2, { i: 2, name: "MICROGRID", baseKv: 20, ide: 1, vm: 1.0, va: 0 }],
    ]),
    loads: [{ i: 2, pl: 20.0, ql: 5.0, status: 1 }],
    generators: [{ i: 1, id: "G1", pg: 20.0, qg: 5.0, stat: 1 }],
    branches: [{ i: 1, j: 2, ckt: "1", r: 0.05, x: 0.15, rateA: 30.0, st: 1 }],
  };

  // Schedule: Charge battery (+5 MW) between 1h and 4h, discharge (-5 MW) between 12h and 15h
  const batterySchedule: QdslProfile = {
    name: "BessSchedule",
    timePoints: [0, 1, 4, 5, 12, 15, 16, 24],
    values: [0, 5.0, 5.0, 0, -5.0, -5.0, 0, 0],
    interpolation: "step",
  };

  const battery: QdslBessConfig = {
    busNumber: 2,
    genId: "BATT1",
    ratedCapacityMwh: 40.0,
    maxChargePowerMw: 10.0,
    maxDischargePowerMw: 10.0,
    initialSoc: 0.40, // 40% initial charge
    chargeEfficiency: 0.95,
    dischargeEfficiency: 0.95,
    scheduleProfile: batterySchedule,
  };

  const res = runQuasiDynamicSimulation(testCase, {
    timeStepHours: 1.0,
    durationHours: 20.0,
    batteries: [battery],
  });

  const stepInitial = res.steps[0]!;
  const stepAfterCharge = res.steps[4]!;
  const stepAfterDischarge = res.steps[15]!;

  const socInit = stepInitial.bessStates![0]!.soc;
  const socCharged = stepAfterCharge.bessStates![0]!.soc;
  const socDischarged = stepAfterDischarge.bessStates![0]!.soc;

  assert.equal(socInit, 0.40, "Initial SoC must be 40%");
  assert.ok(socCharged > socInit, `SoC after charging (${socCharged.toFixed(3)}) must exceed initial (${socInit})`);
  assert.ok(
    socDischarged < socCharged,
    `SoC after discharge (${socDischarged.toFixed(3)}) must be lower than charged SoC (${socCharged.toFixed(3)})`,
  );
});

test("Quasi-Dynamic Simulation: Automatic On-Load Tap Changer (OLTC) voltage regulation", () => {
  const testCase: GenericPowerCase = {
    header: { sbase: 100.0 },
    buses: new Map([
      [1, { i: 1, name: "PRIMARY_HV", baseKv: 110, ide: 3, vm: 1.00, va: 0 }],
      [2, { i: 2, name: "SECONDARY_MV", baseKv: 20, ide: 1, vm: 0.94, va: 0 }],
    ]),
    loads: [
      { i: 2, pl: 40.0, ql: 20.0, status: 1 }, // Heavy load pulling secondary voltage down
    ],
    generators: [{ i: 1, id: "G1", pg: 40.0, qg: 20.0, stat: 1 }],
    branches: [],
    transformers: [
      { i: 1, j: 2, ckt: "1", r12: 0.01, x12: 0.10, rata1: 60.0, stat: 1 },
    ],
  };

  const tapChanger: QdslTapChangerConfig = {
    transformerIndex: 0,
    fromBus: 1,
    toBus: 2,
    controlledBus: 2,
    targetVoltagePu: 1.00,
    deadbandPu: 0.015,
    stepSizeRatio: 0.0125, // 1.25% per tap step
    minTapRatio: 0.85,
    maxTapRatio: 1.15,
  };

  // Run with OLTC enabled
  const resWithOltc = runQuasiDynamicSimulation(testCase, {
    timeSteps: [0],
    tapChangers: [tapChanger],
  });

  // Run without OLTC (fixed nominal tap 1.0)
  const resWithoutOltc = runQuasiDynamicSimulation(testCase, {
    timeSteps: [0],
  });

  const vSecondaryWithOltc = resWithOltc.steps[0]!.busVoltages.get(2)!;
  const vSecondaryNoOltc = resWithoutOltc.steps[0]!.busVoltages.get(2)!;
  const finalTap = resWithOltc.steps[0]!.tapPositions![0]!.tapRatio;

  assert.ok(finalTap < 1.0, `OLTC must step down tap ratio (${finalTap}) to boost secondary voltage`);
  assert.ok(
    vSecondaryWithOltc > vSecondaryNoOltc,
    `Regulated secondary voltage (${vSecondaryWithOltc.toFixed(4)}) must be higher than unregulated (${vSecondaryNoOltc.toFixed(4)})`,
  );
});
