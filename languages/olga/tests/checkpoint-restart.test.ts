// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  deserializeCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  serializeCheckpoint,
} from "../src/engine/checkpoint.js";
import { parseOlga } from "../src/parser/index.js";
import { simulateDriftFlux } from "../src/solver/drift-flux-dae.js";
import type { OlgaCheckpointState } from "../src/types.js";

console.log("=== Testing OLGA State Checkpointing & Warm Restart Engine (.rst) ===");

const testModelOpi = `<?xml version="1.0" encoding="utf-8"?>
<Model Name="Subsea Tieback Riser System" StartTime="0" EndTime="3600" MinDt="0.1" MaxDt="1.0">
  <Flowpath Name="FLOWLINE_01">
    <Pipe Name="SEABED_LINE" Length="3500.0" Diameter="0.254" Elevation="-80.0" Roughness="0.000045" Discretization="12" />
    <Pipe Name="CATENARY_RISER" Length="950.0" Diameter="0.254" Elevation="180.0" Roughness="0.000045" Discretization="8" />
    <Valve Name="TOPSIDE_CHOKE" Position="4450.0" Diameter="0.15" Opening="0.80" Cd="0.84" />
    <Source Name="WELL_MANIFOLD" Position="0.0" TotalMassRate="34.0" GasMassFraction="0.22" WaterCut="0.06" Pressure="15000000" Temperature="340.15" />
  </Flowpath>
  <Node Name="WELLHEAD" Type="MASS_SOURCE" Flowpath="FLOWLINE_01" Fraction="0.0" Pressure="15000000" Temperature="340.15" MassRate="34.0" />
  <Node Name="PLATFORM" Type="SEPARATOR" Flowpath="FLOWLINE_01" Fraction="1.0" Pressure="3000000" Temperature="293.15" />
</Model>`;

const tempDir = path.resolve(process.cwd(), "data/test-checkpoint");
fs.mkdirSync(tempDir, { recursive: true });

// -----------------------------------------------------------------------------
// 1. Checkpoint Codec & File I/O
// -----------------------------------------------------------------------------
console.log("1. Testing Checkpoint Codec serialization & file roundtrip...");
const mockState: OlgaCheckpointState = {
  version: "1.0",
  timestamp: new Date().toISOString(),
  simulatedTime: 1200.0,
  modelTitle: "Subsea Tieback Riser System",
  gridCells: [
    {
      x: 100.0,
      pressurePa: 120e5,
      temperatureK: 335.15,
      liquidHoldup: 0.65,
      gasHoldup: 0.35,
      liquidVelocityMps: 1.45,
      gasVelocityMps: 3.2,
      dropletFraction: 0.12,
    },
    {
      x: 500.0,
      pressurePa: 95e5,
      temperatureK: 320.15,
      liquidHoldup: 0.55,
      gasHoldup: 0.45,
      liquidVelocityMps: 1.85,
      gasVelocityMps: 4.1,
      dropletFraction: 0.18,
    },
  ],
  pigStates: [
    {
      name: "CLEANING_PIG_01",
      position: 1500.0,
      velocity: 8.5,
      sweptVolume: 12.4,
      isStuck: false,
    },
  ],
  slugStates: [
    {
      id: 1,
      tailX: 800.0,
      frontX: 845.0,
      length: 45.0,
      velocity: 3.2,
    },
  ],
  controllers: [
    {
      name: "CHOKE_PID",
      integralState: 14.2,
      lastOutput: 0.75,
    },
  ],
};

const jsonStr = serializeCheckpoint(mockState);
assert.ok(jsonStr.includes('"version": "1.0"'));
assert.ok(jsonStr.includes('"simulatedTime": 1200'));

const parsedState = deserializeCheckpoint(jsonStr);
assert.strictEqual(parsedState.simulatedTime, 1200.0);
assert.strictEqual(parsedState.gridCells.length, 2);
assert.strictEqual(parsedState.pigStates?.[0]?.position, 1500.0);

const testRstPath = path.join(tempDir, "sample_state.rst");
saveCheckpoint(mockState, testRstPath);
assert.ok(fs.existsSync(testRstPath), "Checkpoint file must be written to disk");

const loadedState = loadCheckpoint(testRstPath);
assert.strictEqual(loadedState.simulatedTime, 1200.0);
assert.strictEqual(loadedState.gridCells[0]?.pressurePa, 120e5);
console.log("✔ Checkpoint Codec & File I/O verified!");

// -----------------------------------------------------------------------------
// 2. Full Simulation Warm Restart Verification
// -----------------------------------------------------------------------------
console.log("2. Testing Continuous Run vs Checkpointed Warm Restart continuity...");
const model = parseOlga(testModelOpi);

// A. Continuous Run from t=0 to t=60s
const continuousResult = simulateDriftFlux(model, {
  durationSeconds: 60.0,
  timeStepSeconds: 1.0,
});
const contFinalInletP = continuousResult.trends.inletPressure[continuousResult.trends.inletPressure.length - 1]!;
const contFinalArrivalP = continuousResult.trends.arrivalPressure[continuousResult.trends.arrivalPressure.length - 1]!;
const contFinalProfile = continuousResult.profiles[continuousResult.profiles.length - 1]!;

// B. First Leg: t=0 to t=30s, capturing checkpoint at t=30s
let checkpointAt30s: OlgaCheckpointState | undefined;
const leg1Result = simulateDriftFlux(model, {
  durationSeconds: 30.0,
  timeStepSeconds: 1.0,
  onCheckpoint: (cp) => {
    checkpointAt30s = cp;
  },
});
assert.ok(checkpointAt30s, "Checkpoint at t=30s must be captured");
assert.strictEqual(checkpointAt30s.simulatedTime, 30.0);
assert.ok(checkpointAt30s.gridCells.length > 0);

// C. Second Leg: Warm restart from t=30s to t=60s using checkpoint
const leg2Result = simulateDriftFlux(model, {
  durationSeconds: 30.0,
  timeStepSeconds: 1.0,
  initialCheckpoint: checkpointAt30s,
});

assert.strictEqual(leg2Result.times[0], 30.0, "Restarted run must start at checkpoint time");
assert.strictEqual(leg2Result.times[leg2Result.times.length - 1], 60.0, "Restarted run must reach t=60s");

const restartedFinalInletP = leg2Result.trends.inletPressure[leg2Result.trends.inletPressure.length - 1]!;
const restartedFinalArrivalP = leg2Result.trends.arrivalPressure[leg2Result.trends.arrivalPressure.length - 1]!;
const restartedFinalProfile = leg2Result.profiles[leg2Result.profiles.length - 1]!;

const relDiffInletP = Math.abs(restartedFinalInletP - contFinalInletP) / contFinalInletP;
const relDiffArrivalP = Math.abs(restartedFinalArrivalP - contFinalArrivalP) / contFinalArrivalP;

console.log(`   Continuous final P_inlet : ${(contFinalInletP / 1e5).toFixed(2)} bar`);
console.log(
  `   Restarted  final P_inlet : ${(restartedFinalInletP / 1e5).toFixed(2)} bar (rel err: ${(relDiffInletP * 100).toFixed(3)}%)`,
);
console.log(`   Continuous final P_arriv : ${(contFinalArrivalP / 1e5).toFixed(2)} bar`);
console.log(
  `   Restarted  final P_arriv : ${(restartedFinalArrivalP / 1e5).toFixed(2)} bar (rel err: ${(relDiffArrivalP * 100).toFixed(3)}%)`,
);

assert.ok(
  relDiffInletP < 0.005,
  `Inlet pressure relative error must be < 0.5%, got ${(relDiffInletP * 100).toFixed(3)}%`,
);
assert.ok(
  relDiffArrivalP < 0.005,
  `Arrival pressure relative error must be < 0.5%, got ${(relDiffArrivalP * 100).toFixed(3)}%`,
);

// Profile holdup check
let maxHoldupDiff = 0.0;
for (let i = 0; i < contFinalProfile.liquidHoldup.length; i++) {
  const diff = Math.abs(contFinalProfile.liquidHoldup[i]! - restartedFinalProfile.liquidHoldup[i]!);
  if (diff > maxHoldupDiff) maxHoldupDiff = diff;
}
assert.ok(maxHoldupDiff < 0.01, `Max liquid holdup difference must be < 0.01, got ${maxHoldupDiff.toFixed(4)}`);
console.log(
  `✔ Warm restart verified with seamless trajectory continuity (max holdup diff: ${maxHoldupDiff.toFixed(4)})!`,
);

// -----------------------------------------------------------------------------
// 3. Periodic Checkpoint Emission
// -----------------------------------------------------------------------------
console.log("3. Testing periodic checkpoint emission (interval = 10s)...");
const capturedCheckpoints: OlgaCheckpointState[] = [];
simulateDriftFlux(model, {
  durationSeconds: 40.0,
  timeStepSeconds: 1.0,
  checkpointIntervalSeconds: 10.0,
  onCheckpoint: (cp) => {
    capturedCheckpoints.push(cp);
  },
});

assert.ok(capturedCheckpoints.length >= 4, `Expected at least 4 checkpoints, got ${capturedCheckpoints.length}`);
assert.ok(capturedCheckpoints.some((cp) => Math.abs(cp.simulatedTime - 10.0) < 0.5));
assert.ok(capturedCheckpoints.some((cp) => Math.abs(cp.simulatedTime - 20.0) < 0.5));
assert.ok(capturedCheckpoints.some((cp) => Math.abs(cp.simulatedTime - 30.0) < 0.5));
assert.ok(capturedCheckpoints.some((cp) => Math.abs(cp.simulatedTime - 40.0) < 0.5));
console.log(`✔ Emitted ${capturedCheckpoints.length} periodic checkpoints cleanly!`);

// Cleanup temp test artifacts
fs.rmSync(tempDir, { recursive: true, force: true });

console.log("=== All OLGA State Checkpointing & Warm Restart Tests Passed! ===");
