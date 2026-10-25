// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Branched Networks, IPR, Machinery, and Flow Assurance Test Suite.
 *
 * Validates:
 * 1. Wellbore Inflow Performance Relationship (IPR): Linear PI, Vogel, Fetkovich
 * 2. Rotating Machinery: Multiphase booster pump with GVF degradation and centrifugal compressor
 * 3. Wax deposition layer growth and sand critical transport velocity
 * 4. Branched gathering network simulation: 2 wells merging at subsea manifold into riser
 * 5. Pre-flight linter rules M7009 (Wax Risk) and M7010 (Sand Hazard)
 * 6. Polyglot SysML v2 projection and formal flow assurance verification
 */

import assert from "node:assert";
import {
  evaluateCompressorBoost,
  evaluatePumpBoost,
  evaluateSandTransport,
  evaluateWaxDeposition,
  evaluateWellIpr,
  lintOlgaModel,
  olgaToSysml2,
  simulateOlgaNetwork,
  stepWellInflow,
  verifyFlowAssuranceTrajectory,
  type OlgaCompressor,
  type OlgaIpr,
  type OlgaModel,
  type OlgaPump,
} from "../src/index.js";

console.log("=== Testing OLGA Network, IPR, Machinery, and Flow Assurance Subsystem ===");

// ---------------------------------------------------------------------------
// 1. Wellbore Inflow Performance Relationship (IPR)
// ---------------------------------------------------------------------------
console.log("1. Testing Wellbore IPR Deliverability (Vogel, Linear PI, Fetkovich)...");

const vogelIpr: OlgaIpr = {
  type: "VOGEL",
  reservoirPressure: 250.0e5, // 250 bar
  reservoirTemperature: 360.15, // 87 C
  bubblePointPressure: 220.0e5, // 220 bar
  maxLiquidRate: 50.0, // kg/s
  gasMassFraction: 0.2,
  waterCut: 0.15,
};

// Check maximum flow rate at zero flowing pressure
const vogelWideOpen = evaluateWellIpr(vogelIpr, 0.0);
assert.ok(Math.abs(vogelWideOpen.totalMassRate - 50.0) < 0.1, "Vogel rate at P_wf=0 should equal q_max");

// Check shut-in at reservoir pressure
const vogelShutIn = evaluateWellIpr(vogelIpr, 250.0e5);
assert.strictEqual(vogelShutIn.totalMassRate, 0.0, "Rate must be zero when P_wf = P_res");
assert.strictEqual(vogelShutIn.drawdownPa, 0.0);

// Check intermediate operating drawdown
const vogelFlowing = evaluateWellIpr(vogelIpr, 180.0e5); // 180 bar
assert.ok(vogelFlowing.totalMassRate > 20.0 && vogelFlowing.totalMassRate < 45.0);
assert.ok(vogelFlowing.gasMassRate > 0 && vogelFlowing.liquidMassRate > 0);

// Check under-relaxation stepping
const steppedRate = stepWellInflow(30.0, vogelIpr, 180.0e5, 0.4);
assert.ok(steppedRate > 25.0 && steppedRate < 40.0);
console.log(
  `✔ Vogel IPR verified: q_max=${vogelWideOpen.totalMassRate.toFixed(1)} kg/s, ` +
    `q(180 bar)=${vogelFlowing.totalMassRate.toFixed(1)} kg/s, q(shut-in)=${vogelShutIn.totalMassRate.toFixed(1)} kg/s!`,
);

// ---------------------------------------------------------------------------
// 2. Rotating Machinery: Multiphase Pumps & Gas Compressors
// ---------------------------------------------------------------------------
console.log("2. Testing Rotating Machinery Dynamics (Pumps & Compressors)...");

const boosterPump: OlgaPump = {
  name: "SUBSEA_ESP_1",
  position: 500,
  type: "ESP",
  ratedHead: 350.0, // 350 m head
  ratedFlowRate: 0.045, // m^3/s
  speedRpm: 3500,
  ratedPowerKw: 450,
  gasVoidFractionLimit: 0.25,
};

// Liquid single-phase boost
const pumpLiquid = evaluatePumpBoost(boosterPump, 820.0, 0.02, 0.035);
assert.ok(pumpLiquid.pressureBoostPa > 2.0e6, "Pump should provide over 20 bar boost in liquid");
assert.strictEqual(pumpLiquid.isGasLocked, false);

// Free gas degradation boost
const pumpGas = evaluatePumpBoost(boosterPump, 500.0, 0.4, 0.035);
assert.ok(pumpGas.pressureBoostPa < pumpLiquid.pressureBoostPa, "Head must degrade under free gas");
assert.strictEqual(pumpGas.isGasLocked, true);
console.log(
  `✔ Multiphase pump verified: DeltaP(liq)=${(pumpLiquid.pressureBoostPa / 1e5).toFixed(1)} bar, ` +
    `DeltaP(gvf=0.4)=${(pumpGas.pressureBoostPa / 1e5).toFixed(1)} bar (gasLocked=${pumpGas.isGasLocked})!`,
);

// Centrifugal Gas Compressor
const compressor: OlgaCompressor = {
  name: "TOPSIDE_COMP_1",
  position: 2500,
  type: "CENTRIFUGAL",
  pressureRatio: 2.2, // 2.2:1 compression ratio
  polytropicEfficiency: 0.78,
  ratedPowerKw: 1500,
  antiSurgeMargin: 0.15,
};

const compPerf = evaluateCompressorBoost(compressor, 35.0e5, 305.15, 8.5);
assert.ok(Math.abs(compPerf.dischargePressurePa - 35.0e5 * 2.2) < 1.0);
assert.ok(compPerf.dischargeTemperatureK > 305.15, "Compressor discharge temperature must rise");
assert.ok(compPerf.powerConsumedKw > 200, "Power consumed must be positive");
assert.strictEqual(compPerf.isSurging, false);
console.log(
  `✔ Gas compressor verified: P_in=35 bar -> P_out=${(compPerf.dischargePressurePa / 1e5).toFixed(1)} bar, ` +
    `T_out=${(compPerf.dischargeTemperatureK - 273.15).toFixed(1)} C, Power=${compPerf.powerConsumedKw.toFixed(0)} kW!`,
);

// ---------------------------------------------------------------------------
// 3. Wax Deposition & Sand Transport Screening
// ---------------------------------------------------------------------------
console.log("3. Testing Wax Deposition Kinetics & Sand Transport Limits...");

// Wax deposition below cloud point
const waxDep = evaluateWaxDeposition(
  { cloudPointTemp: 308.15 }, // 35 C WAT
  300.15, // 27 C bulk
  278.15, // 5 C wall
  0.25,
  1.5,
  0.003,
  820.0,
  0.0,
  3600, // 1 hour
);
assert.strictEqual(waxDep.isDepositing, true);
assert.ok(waxDep.depositionRateMetersPerSec > 0);
assert.ok(waxDep.waxThicknessMeters > 0);
assert.ok(waxDep.effectiveDiameter < 0.25);

// Wax deposition above cloud point
const waxSafe = evaluateWaxDeposition(
  { cloudPointTemp: 308.15 },
  330.15,
  315.15, // 42 C wall > 35 C WAT
  0.25,
  1.5,
  0.003,
  820.0,
  0.0,
  3600,
);
assert.strictEqual(waxSafe.isDepositing, false);
assert.strictEqual(waxSafe.waxThicknessMeters, 0.0);
console.log(
  `✔ Wax deposition verified: rate=${(waxDep.depositionRateMetersPerSec * 1e6).toFixed(3)} um/s, ` +
    `1-hr layer=${(waxDep.waxThicknessMeters * 1000).toFixed(3)} mm (isDepositing=${waxDep.isDepositing})!`,
);

// Sand transport critical velocity
const sandSlow = evaluateSandTransport({ sandMassRate: 0.15 }, 0.2, 850.0, 0.002, 600.0, 0.25);
assert.strictEqual(sandSlow.isDroppingOut, true, "Low velocity (0.20 m/s) should trigger sand dropout");
assert.strictEqual(sandSlow.isEroding, false);

const sandFast = evaluateSandTransport({ sandMassRate: 0.15 }, 22.0, 850.0, 0.002, 45.0, 0.25);
assert.strictEqual(sandFast.isDroppingOut, false);
assert.strictEqual(sandFast.isEroding, true, "High velocity (22 m/s) should trigger sand erosion");
console.log(
  `✔ Sand limits verified: v_dep=${sandSlow.criticalDepositionVelocity.toFixed(2)} m/s, ` +
    `v_erosion=${sandFast.erosionalVelocityLimit.toFixed(2)} m/s!`,
);

// ---------------------------------------------------------------------------
// 4. Branched Gathering Network Simulation
// ---------------------------------------------------------------------------
console.log("4. Testing Multi-Flowpath Branched Gathering Network Simulation...");

const gatheringNetwork: OlgaModel = {
  title: "Subsea Gathering Network with Manifold Junction",
  startTime: 0,
  endTime: 30,
  minDt: 0.1,
  maxDt: 1.0,
  flowpaths: [
    // Branch 1: Well A Tieback
    {
      name: "TIEBACK_A",
      pipes: [{ label: "PA_1", length: 800, diameter: 0.2, elevation: -10, roughness: 4.5e-5, discretization: 4 }],
      valves: [{ name: "CHOKE_A", position: 800, diameter: 0.08, opening: 0.8, cd: 0.84 }],
      sources: [],
      controllers: [],
      ipr: {
        type: "VOGEL",
        reservoirPressure: 220.0e5,
        reservoirTemperature: 355.15,
        maxLiquidRate: 25.0,
        gasMassFraction: 0.25,
        waterCut: 0.1,
      },
    },
    // Branch 2: Well B Tieback
    {
      name: "TIEBACK_B",
      pipes: [{ label: "PB_1", length: 1200, diameter: 0.2, elevation: -15, roughness: 4.5e-5, discretization: 4 }],
      valves: [{ name: "CHOKE_B", position: 1200, diameter: 0.08, opening: 0.75, cd: 0.84 }],
      sources: [],
      controllers: [],
      ipr: {
        type: "LINEAR_PI",
        reservoirPressure: 240.0e5,
        reservoirTemperature: 360.15,
        productivityIndex: 3.5e-5,
        gasMassFraction: 0.2,
        waterCut: 0.15,
      },
    },
    // Main Common Riser (feeds from manifold to topside separator)
    {
      name: "MAIN_RISER",
      pipes: [{ label: "PR_1", length: 1500, diameter: 0.28, elevation: 350, roughness: 4.5e-5, discretization: 5 }],
      valves: [{ name: "TOPSIDE_CHOKE", position: 1500, diameter: 0.15, opening: 0.9, cd: 0.84 }],
      sources: [],
      controllers: [],
      pumps: [boosterPump],
      waxConfig: { cloudPointTemp: 305.15 },
      sandConfig: { sandMassRate: 0.05 },
    },
  ],
  nodes: [
    // Feeder outlets and Riser inlet all link at MANIFOLD_JUNCTION
    { name: "MANIFOLD_JUNCTION", type: "INTERNAL", flowpath: "TIEBACK_A", boundaryPosition: 1.0 },
    { name: "MANIFOLD_JUNCTION", type: "INTERNAL", flowpath: "TIEBACK_B", boundaryPosition: 1.0 },
    { name: "MANIFOLD_JUNCTION", type: "INTERNAL", flowpath: "MAIN_RISER", boundaryPosition: 0.0 },
    { name: "TOP_SEPARATOR", type: "SEPARATOR", flowpath: "MAIN_RISER", boundaryPosition: 1.0, pressure: 30.0e5 },
  ],
};

const netResult = simulateOlgaNetwork(gatheringNetwork, {
  durationSeconds: 20,
  timeStepSeconds: 1.0,
});

assert.ok(netResult.times.length === 21);
assert.ok(netResult.flowpathResults["TIEBACK_A"] != null);
assert.ok(netResult.flowpathResults["TIEBACK_B"] != null);
assert.ok(netResult.flowpathResults["MAIN_RISER"] != null);

// Check mass delivery across manifold junction
const rateA = netResult.flowpathResults["TIEBACK_A"]!.trends.arrivalLiquidMassRate[20]!;
const rateB = netResult.flowpathResults["TIEBACK_B"]!.trends.arrivalLiquidMassRate[20]!;
const rateRiser = netResult.flowpathResults["MAIN_RISER"]!.trends.arrivalLiquidMassRate[20]!;
assert.ok(rateA > 0 && rateB > 0 && rateRiser > 0);
assert.ok(netResult.totalProductionRateKgS[20]! > 0);
console.log(
  `✔ Network simulation complete: Well A=${rateA.toFixed(1)} kg/s, Well B=${rateB.toFixed(1)} kg/s -> ` +
    `Main Riser=${rateRiser.toFixed(1)} kg/s!`,
);

// ---------------------------------------------------------------------------
// 5. Pre-Flight Linter Rules M7009 & M7010
// ---------------------------------------------------------------------------
console.log("5. Testing Pre-Flight Linter Rules M7009 & M7010...");

const uninsulatedWaxModel: OlgaModel = {
  ...gatheringNetwork,
  flowpaths: [
    {
      ...gatheringNetwork.flowpaths[2]!,
      heatTransfer: {
        type: "WATER",
        ambientTemperature: 277.15, // 4 C seawater
        ambientHeatTransferCoeff: 250,
        layers: [], // uninsulated
      },
      waxConfig: { cloudPointTemp: 310.15 }, // 37 C WAT
    },
  ],
};

const waxDiags = lintOlgaModel(uninsulatedWaxModel);
const m7009 = waxDiags.find((d) => d.code === "M7009");
assert.ok(m7009, "M7009 should trigger on uninsulated pipe in cold seawater below WAT");
console.log(`✔ Linter detected M7009: "${m7009.message}"`);

const sandModel: OlgaModel = {
  ...gatheringNetwork,
  flowpaths: [
    {
      ...gatheringNetwork.flowpaths[2]!,
      sources: [
        { name: "S1", position: 0, totalMassRate: 3.0, gasMassFraction: 0.1, waterCut: 0.05, temperature: 320 },
      ],
      sandConfig: { sandMassRate: 0.25 },
    },
  ],
};

const sandDiags = lintOlgaModel(sandModel);
const m7010 = sandDiags.find((d) => d.code === "M7010");
assert.ok(m7010, "M7010 should trigger on low velocity sand settling risk");
console.log(`✔ Linter detected M7010: "${m7010.message}"`);

// ---------------------------------------------------------------------------
// 6. SysML v2 Projection & Flow Assurance Verification
// ---------------------------------------------------------------------------
console.log("6. Testing SysML v2 Projection with Machinery & Flow Assurance Verifier...");

const sysmlCode = olgaToSysml2(gatheringNetwork, {
  limits: {
    cloudPointTemp: 305.15,
  },
});
assert.ok(sysmlCode.includes("part SUBSEA_ESP_1"), "SysML v2 must project booster pump part");
assert.ok(sysmlCode.includes("requirement def WaxAvoidanceRequirement"), "SysML v2 must project wax requirement");
console.log("✔ SysML v2 generated with machinery parts and wax avoidance requirements!");

// Flow assurance trajectory verification with wax check
const faResult = verifyFlowAssuranceTrajectory(netResult.flowpathResults["MAIN_RISER"]!, {
  maop: 250.0e5,
  hydrateMarginKelvin: 2.0,
  slugCatcherLiquidCapacity: 120.0,
  minGasVelocity: 1.0,
  cloudPointTemp: 305.15,
  minWaxMarginKelvin: 2.0,
});
assert.ok(faResult.checks.hydrateAvoidance != null);
assert.ok(faResult.checks.waxAvoidance != null);
console.log(
  `✔ Flow assurance verification complete: passed=${faResult.passed}, ` +
    `waxPassed=${faResult.checks.waxAvoidance?.passed}!`,
);

console.log("=== All OLGA Network, IPR, Machinery, and Flow Assurance Tests Passed! ===");
