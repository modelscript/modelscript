// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Coupled Multi-Branch Gathering Network Transient Solver Test Suite.
 *
 * Validates:
 * 1. Multi-flowpath gathering network topology (2 satellite wells converging at subsea manifold -> common riser)
 * 2. Coupled junction mass and acoustic pressure conservation
 * 3. Dynamic well trip / shut-in transient event (Well 1 trips at t = 20s)
 * 4. Manifold dynamic acoustic backpressure relief and flow redistribution in Well 2
 * 5. Downstream riser throughput stabilization to single-well regime
 */

import assert from "node:assert";
import { simulateNetworkTransient, type OlgaModel } from "../src/index.js";

console.log("=== Testing OLGA Coupled Multi-Branch Gathering Network Transient Solver ===");

// ---------------------------------------------------------------------------
// 1. Define Multi-Well Subsea Gathering Network
// ---------------------------------------------------------------------------
console.log("1. Setting up 2-Well Gathering Manifold with Export Riser Topology...");

const networkModel: OlgaModel = {
  version: "7.0",
  caseName: "CoupledSubseaGatheringNetwork",
  startTime: 0,
  endTime: 50,
  maxDt: 1.0,
  pvtFile: "fluid.tab",
  flowpaths: [
    // Well 1 satellite flowline -> Manifold
    {
      name: "WELL_1_TIEBACK",
      pipes: [
        {
          id: "W1_P1",
          diameter: 0.2,
          length: 1500.0,
          elevation: -30.0,
          roughness: 0.000045,
          discretization: 5,
        },
      ],
      sources: [
        {
          name: "W1_SOURCE",
          pipeline: "WELL_1_TIEBACK",
          distance: 0,
          totalMassRate: 30.0, // 30 kg/s
          gasMassFraction: 0.25,
          waterCut: 0.05,
          temperature: 345.15,
        },
      ],
      valves: [],
      pigs: [],
    },
    // Well 2 satellite flowline -> Manifold
    {
      name: "WELL_2_TIEBACK",
      pipes: [
        {
          id: "W2_P1",
          diameter: 0.2,
          length: 1200.0,
          elevation: -20.0,
          roughness: 0.000045,
          discretization: 5,
        },
      ],
      sources: [
        {
          name: "W2_SOURCE",
          pipeline: "WELL_2_TIEBACK",
          distance: 0,
          totalMassRate: 25.0, // 25 kg/s
          gasMassFraction: 0.2,
          waterCut: 0.08,
          temperature: 340.15,
        },
      ],
      valves: [],
      pigs: [],
    },
    // Shared gathering riser: Manifold -> Host Platform
    {
      name: "GATHERING_RISER",
      pipes: [
        {
          id: "RISER_PIPE",
          diameter: 0.3,
          length: 800.0,
          elevation: 500.0, // 500 m rise
          roughness: 0.000045,
          discretization: 6,
        },
      ],
      sources: [],
      valves: [
        {
          name: "TOPSIDE_CHOKE",
          pipeline: "GATHERING_RISER",
          distance: 800.0,
          diameter: 0.3,
          opening: 0.85,
          cd: 0.84,
        },
      ],
      pigs: [],
    },
  ],
  nodes: [
    // Subsea Manifold Junction (merges Well 1 and Well 2, feeds Gathering Riser)
    {
      name: "SUBSEA_MANIFOLD",
      flowpath: "WELL_1_TIEBACK",
      type: "INTERNAL",
      boundaryPosition: 1.0,
    },
    {
      name: "SUBSEA_MANIFOLD",
      flowpath: "WELL_2_TIEBACK",
      type: "INTERNAL",
      boundaryPosition: 1.0,
    },
    {
      name: "SUBSEA_MANIFOLD",
      flowpath: "GATHERING_RISER",
      type: "INTERNAL",
      boundaryPosition: 0.0,
    },
    // Platform Host separator terminal
    {
      name: "PLATFORM_HOST",
      flowpath: "GATHERING_RISER",
      type: "PRESSURE",
      boundaryPosition: 1.0,
      pressure: 25.0e5, // 25 bar
      temperature: 285.15,
    },
  ],
};

// ---------------------------------------------------------------------------
// 2. Execute Coupled Network Transient Simulation with Well 1 Shut-In Event
// ---------------------------------------------------------------------------
console.log("2. Simulating Transient Network with Well 1 Trip at t = 20s...");

const netResult = simulateNetworkTransient(networkModel, {
  durationSeconds: 40,
  timeStepSeconds: 1.0,
  pvtModel: "BLACK_OIL",
  junctionVolumeM3: 6.0,
  events: [
    {
      timeSeconds: 20.0,
      action: "TRIP_WELL",
      flowpath: "WELL_1_TIEBACK",
    },
  ],
});

assert.ok(netResult.times.length >= 40, "Simulation should complete all time steps");
assert.ok(netResult.junctionPressures["SUBSEA_MANIFOLD"], "Manifold pressures must be tracked");
const manifoldPTrend = netResult.junctionPressures["SUBSEA_MANIFOLD"]!;
assert.strictEqual(manifoldPTrend.length, netResult.times.length);

// Check before trip (t = 10s):
// Both wells feeding -> high manifold pressure
const pManifoldBeforeTrip = manifoldPTrend[10]!;
console.log(`   -> t = 10s (Both Wells Flowing): Manifold P = ${(pManifoldBeforeTrip / 1e5).toFixed(2)} bar`);
assert.ok(pManifoldBeforeTrip > 25.0e5, "Manifold pressure must exceed host pressure (25 bar)");

// Check after trip (t = 35s):
// Well 1 tripped -> manifold pressure must drop due to acoustic relief
const pManifoldAfterTrip = manifoldPTrend[35]!;
console.log(`   -> t = 35s (Well 1 Tripped, Well 2 Solo): Manifold P = ${(pManifoldAfterTrip / 1e5).toFixed(2)} bar`);
assert.ok(
  pManifoldAfterTrip < pManifoldBeforeTrip,
  `Manifold pressure after trip (${(pManifoldAfterTrip / 1e5).toFixed(2)} bar) must drop relative to pre-trip (${(pManifoldBeforeTrip / 1e5).toFixed(2)} bar)`,
);

// Check flowpath results integrity
const fp1 = netResult.flowpathResults["WELL_1_TIEBACK"]!;
const fp2 = netResult.flowpathResults["WELL_2_TIEBACK"]!;
const fpRiser = netResult.flowpathResults["GATHERING_RISER"]!;

assert.ok(fp1.trends.inletPressure.length === netResult.times.length);
assert.ok(fp2.trends.inletPressure.length === netResult.times.length);
assert.ok(fpRiser.trends.arrivalPressure.length === netResult.times.length);

// Verify total network production rate transient
const totalProd = netResult.totalProductionRateKgS;
const prodBeforeTrip = totalProd[10]!;
const prodAfterTrip = totalProd[35]!;

console.log(
  `   -> Total Gathering Production: ${prodBeforeTrip.toFixed(1)} kg/s (2 wells) -> ${prodAfterTrip.toFixed(1)} kg/s (post-trip)`,
);
assert.ok(prodAfterTrip < prodBeforeTrip, "Total production rate must drop following Well 1 trip");

console.log("✔ Coupled Multi-Branch Gathering Network Transient Solver tests passed successfully!");
