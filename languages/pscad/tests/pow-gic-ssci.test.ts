// SPDX-License-Identifier: AGPL-3.0-or-later

import { calculateGic, parseRaw } from "@modelscript/psse";
import assert from "node:assert";
import test from "node:test";
import { runFrequencyScan, runPointOnWaveSweep, type EmtNetlist } from "../src/index.js";

test("PSCAD Point-on-Wave Parametric Sweep & Statistical Switching Overvoltage (SSOV)", () => {
  console.log("=== Testing Point-on-Wave (PoW) Parametric Sweep & SSOV ===");

  // Define a 230 kV test network with circuit breaker closing onto a 150 km transmission line
  const netlist: EmtNetlist = {
    nominalFrequencyHz: 60.0,
    buses: [
      { id: "SRC_BUS", baseKv: 230.0, connectedBranchIds: ["BRK_1"] },
      { id: "LINE_SEND", baseKv: 230.0, connectedBranchIds: ["BRK_1", "LINE_1"] },
      { id: "LINE_REC", baseKv: 230.0, connectedBranchIds: ["LINE_1"] },
    ],
    sources: [
      {
        id: "GRID_SRC",
        bus: "SRC_BUS",
        voltageKvLL: 230.0,
        frequencyHz: 60.0,
        phaseAngleDeg: 0.0,
        rSourceOhm: 0.8,
        lSourceHenry: 0.015,
      },
    ],
    branches: [
      {
        id: "BRK_1",
        fromBus: "SRC_BUS",
        toBus: "LINE_SEND",
        kind: "switch" as const,
        status: "open",
        rClosedOhm: 0.001,
        rOpenOhm: 1e6,
      },
      {
        id: "LINE_1",
        fromBus: "LINE_SEND",
        toBus: "LINE_REC",
        rOhm: 2.5,
        lHenry: 0.12,
        cFarad: 1.2e-6,
      },
    ],
  };

  const sweep = runPointOnWaveSweep(netlist, {
    breakerId: "BRK_1",
    numRuns: 20,
    durationSec: 0.04,
    timeStepSec: 50e-6,
    poleScatterSec: 0.001,
    monitoredBuses: ["LINE_REC"],
  });

  console.log(`   Point-on-Wave completed in ${sweep.wallClockTimeMs} ms (${sweep.totalRuns} runs).`);
  console.log(`   Mean Peak: ${sweep.meanPeakKv} kV, Min: ${sweep.minPeakKv} kV, Max: ${sweep.maxPeakKv} kV`);
  console.log(`   SSOV V_2% (98th percentile): ${sweep.ssovV2PercentKv} kV (${sweep.ssovV2PercentPu} p.u.)`);
  console.log(`   Histogram Bins (${sweep.histogram.length}):`);
  for (const bin of sweep.histogram) {
    if (bin.count > 0) {
      console.log(`     [${bin.binMinKv} - ${bin.binMaxKv} kV]: ${bin.count} runs (${bin.percent}%)`);
    }
  }

  assert.strictEqual(sweep.totalRuns, 20);
  assert.strictEqual(sweep.breakerId, "BRK_1");
  assert.ok(sweep.maxPeakKv >= sweep.meanPeakKv);
  assert.ok(sweep.meanPeakKv >= sweep.minPeakKv);
  assert.ok(sweep.ssovV2PercentKv >= sweep.meanPeakKv);
  assert.ok(sweep.ssovV2PercentPu > 0.5 && sweep.ssovV2PercentPu < 3.5);

  const totalPercent = sweep.histogram.reduce((acc, b) => acc + b.percent, 0.0);
  assert.ok(Math.abs(totalPercent - 100.0) < 1.0, `Histogram percentages should sum to 100%, got ${totalPercent}`);
});

test("PSCAD Subsynchronous Frequency Scanner (SSR & SSCI Negative Damping)", () => {
  console.log("=== Testing Frequency Scanner for SSR & SSCI Risk ===");

  // Define an IBR (wind farm) connected through a series-compensated transmission line
  // Resonant frequency f_res = 1 / (2*pi*sqrt(L*C)) ~ 30 Hz (subsynchronous)
  // At 30 Hz, L = 0.08 H, C = 350 uF -> f_res = 1 / (2*pi*sqrt(0.08 * 350e-6)) ~ 30.1 Hz
  const netlist: EmtNetlist = {
    nominalFrequencyHz: 60.0,
    buses: [
      { id: "GRID", baseKv: 230.0, connectedBranchIds: ["LINE_COMP"] },
      { id: "WIND_POI", baseKv: 230.0, connectedBranchIds: ["LINE_COMP"] },
    ],
    sources: [
      {
        id: "INFINITE_BUS",
        bus: "GRID",
        voltageKvLL: 230.0,
        frequencyHz: 60.0,
        phaseAngleDeg: 0.0,
        rSourceOhm: 0.5,
        lSourceHenry: 0.02,
      },
    ],
    branches: [
      {
        id: "LINE_COMP",
        fromBus: "GRID",
        toBus: "WIND_POI",
        rOhm: 0.8,
        lHenry: 0.06, // Total inductance 0.02 + 0.06 = 0.08 H
        cFarad: 350e-6, // Series compensation capacitor
      },
    ],
    fmuInstances: [
      {
        id: "TYPE4_WIND_IBR",
        busId: "WIND_POI",
        busConnection: "WIND_POI",
        fmuPath: "wind_inverter.fmu",
        ratedMva: 250.0,
        ratedKv: 230.0,
      },
    ],
  };

  const scan = runFrequencyScan(netlist, {
    busId: "WIND_POI",
    fMinHz: 5.0,
    fMaxHz: 90.0,
    fStepHz: 1.0,
    modelIbrControlInteraction: true,
  });

  console.log(`   Frequency scan completed in ${scan.wallClockTimeMs} ms (${scan.frequenciesHz.length} points).`);
  console.log(`   Resonance points detected: ${scan.resonancePoints.length}`);
  for (const pt of scan.resonancePoints) {
    console.log(
      `     f = ${pt.frequencyHz} Hz | R = ${pt.resistanceAtResonanceOhm} Ohm | Unstable: ${pt.isUnstable} | Growth: ${pt.growthRatePerSec} s^-1`,
    );
  }

  assert.ok(scan.resonancePoints.length >= 1, "Must detect series resonance crossover point");
  const subRes = scan.resonancePoints.find((p) => p.frequencyHz >= 20.0 && p.frequencyHz <= 45.0);
  assert.ok(subRes !== undefined, "Must detect subsynchronous resonance ~30 Hz");

  // SSCI risk verification: negative resistance at subsynchronous frequency
  assert.ok(scan.hasSsciRisk, "Must flag SSCI risk due to IBR control interaction negative damping");
  assert.ok(scan.minResistanceOhm < 0.0, `Min resistance must be negative, got ${scan.minResistanceOhm} Ohm`);
  assert.ok(subRes.isUnstable, "Subsynchronous mode must be flagged as unstable");
  assert.ok(subRes.growthRatePerSec !== undefined && subRes.growthRatePerSec > 0.0);
});

test("PSS/E Geomagnetically Induced Currents (GIC) & NERC TPL-007 Compliance Assessment", () => {
  console.log("=== Testing GIC Solver & NERC TPL-007 Assessment ===");

  const RAW_CASE = `0, 100.00, 33, 0, 1, 60.00 / PSS/E 4-Substation GIC Test Grid
CASE TITLE LINE 1
CASE TITLE LINE 2
    1, 'SUB_A_500   ', 500.000, 3, 1, 1, 1, 1.050,   0.000, 1.100, 0.900, 1.100, 0.900
    2, 'SUB_B_500   ', 500.000, 2, 1, 1, 1, 1.040,  -3.500, 1.100, 0.900, 1.100, 0.900
    3, 'SUB_C_500   ', 500.000, 1, 1, 1, 1, 1.020,  -6.200, 1.100, 0.900, 1.100, 0.900
    4, 'SUB_D_500   ', 500.000, 1, 1, 1, 1, 1.010,  -8.100, 1.100, 0.900, 1.100, 0.900
0 / END OF BUS DATA
    3, '1 ', 1, 1, 1,  400.00,  150.00,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
    4, '1 ', 1, 1, 1,  350.00,  120.00,   0.00,   0.00,   0.00,   0.00, 1, 1, 0
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
    1, '1 ', 500.00,  120.00,  400.00, -200.00, 1.050, 0, 600.00, 0.00, 0.05, 0.00, 0.00, 1.00, 1, 100.0, 600.0, 0.0, 1, 1.0
    2, '1 ', 300.00,   80.00,  250.00, -100.00, 1.040, 0, 400.00, 0.00, 0.05, 0.00, 0.00, 1.00, 1, 100.0, 400.0, 0.0, 1, 1.0
0 / END OF GENERATOR DATA
    1,     2, '1 ', 0.00800, 0.06500, 0.3500, 1500.0, 1600.0, 1800.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    2,     3, '1 ', 0.01200, 0.09500, 0.4500, 1500.0, 1600.0, 1800.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    3,     4, '1 ', 0.01500, 0.12000, 0.5500, 1500.0, 1600.0, 1800.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
    1,     4, '1 ', 0.02000, 0.16000, 0.7000, 1500.0, 1600.0, 1800.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
0 / END OF BRANCH DATA
    1,     2, 0, '1 ', 1, 1, 1, 0.0, 0.0, 2, 'T1_SUB_A_B  ', 1, 1, 1.0, 0.0, 0.08, 1000.0, 1.0, 0.0, 0.0, 1000.0, 1000.0, 1000.0, 0, 0, 1.1, 0.9, 1.1, 0.9, 33, 0, 0.0, 0.0, 0.0, 1.0, 0.0
    3,     4, 0, '1 ', 1, 1, 1, 0.0, 0.0, 2, 'T2_SUB_C_D  ', 1, 1, 1.0, 0.0, 0.08, 1000.0, 1.0, 0.0, 0.0, 1000.0, 1000.0, 1000.0, 0, 0, 1.1, 0.9, 1.1, 0.9, 33, 0, 0.0, 0.0, 0.0, 1.0, 0.0
0 / END OF TRANSFORMER DATA
0 / END OF AREA DATA
0 / END OF TWO-TERMINAL DC DATA
0 / END OF VSC DC DATA
0 / END OF SWITCHED SHUNT DATA
Q
`;

  const psCase = parseRaw(RAW_CASE);

  // 1. Moderate storm (1.0 V/km East)
  const gicModerate = calculateGic(psCase, {
    eEastVPerKm: 1.0,
    eNorthVPerKm: 0.0,
    tpl007ThresholdAmp: 75.0,
  });

  console.log(`   Moderate GMD (1.0 V/km):`);
  console.log(`     Total GIC Loss: ${gicModerate.totalSystemGicLossMvar} Mvar`);
  console.log(`     Max Effective GIC: ${gicModerate.maxTransformerEffectiveGicAmp} A/phase`);
  console.log(`     Compliant: ${gicModerate.summary.compliant}`);

  assert.ok(gicModerate.totalSystemGicLossMvar > 0.0);
  assert.ok(gicModerate.maxTransformerEffectiveGicAmp < 75.0);
  assert.strictEqual(gicModerate.summary.compliant, true);

  // 2. Severe 100-year benchmark storm (8.0 V/km East per NERC TPL-007)
  const gicSevere = calculateGic(psCase, {
    eEastVPerKm: 8.0,
    eNorthVPerKm: 2.0,
    tpl007ThresholdAmp: 75.0,
  });

  console.log(`   Severe 100-year GMD (8.0 V/km):`);
  console.log(`     Total GIC Loss: ${gicSevere.totalSystemGicLossMvar} Mvar`);
  console.log(`     Max Effective GIC: ${gicSevere.maxTransformerEffectiveGicAmp} A/phase`);
  console.log(`     TPL-007 Violations: ${gicSevere.tpl007ViolationsCount}`);
  console.log(`     Compliant: ${gicSevere.summary.compliant}`);
  console.log(`     Recommended Mitigations: ${gicSevere.summary.recommendedMitigation.join(" | ")}`);

  assert.ok(gicSevere.totalSystemGicLossMvar > gicModerate.totalSystemGicLossMvar * 5.0);
  assert.ok(gicSevere.maxTransformerEffectiveGicAmp >= 75.0);
  assert.strictEqual(gicSevere.summary.compliant, false);
  assert.ok(gicSevere.tpl007ViolationsCount > 0);
  assert.ok(gicSevere.summary.recommendedMitigation.length > 0);
});
