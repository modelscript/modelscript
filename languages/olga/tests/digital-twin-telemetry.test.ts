// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { OlgaDigitalTwinStreamer } from "../src/engine/digital-twin-streamer.js";

console.log("=== Testing Real-Time SCADA/DCS Digital Twin Telemetry Ingestion ===");

const streamer = new OlgaDigitalTwinStreamer({
  pressureResidualThresholdBar: 5.0,
  nudgingGain: 0.2,
});

// 1. Initial state
assert.strictEqual(streamer.getState().isConnected, false);
streamer.connect("mqtt://offshore-platform.subsea.net:1883");
assert.strictEqual(streamer.getState().isConnected, true);
console.log("✔ Connected to digital twin telemetry broker.");

// 2. Ingest nominal SCADA frame matching simulated physics
console.log("2. Ingesting nominal SCADA frame...");
const state1 = streamer.ingestTelemetry(
  {
    timestamp: Date.now(),
    tags: {
      inletPressureBar: 121.0,
      inletTemperatureC: 68.0,
      chokeOpeningFraction: 0.85,
      arrivalPressureBar: 35.2, // matches ~35.0 bar simulated
      arrivalTemperatureC: 22.0, // matches ~21.5 C simulated
    },
  },
  35.0e5, // 35.0 bar simulated
  294.65, // 21.5 C simulated
);

assert.strictEqual(state1.frameCount, 1);
assert.ok(
  state1.currentResidualBar < 1.0,
  `Residual should be small (got ${state1.currentResidualBar.toFixed(2)} bar)`,
);
assert.strictEqual(state1.isAnomalyDetected, false, "No anomaly should be detected under nominal conditions");
assert.strictEqual(state1.activeAlarms.length, 0);
console.log(`✔ Nominal frame verified (Residual: ${state1.currentResidualBar.toFixed(2)} bar).`);

// 3. Ingest off-spec frame with significant arrival pressure restriction
console.log("3. Ingesting off-spec SCADA frame with severe flow restriction...");
const state2 = streamer.ingestTelemetry(
  {
    timestamp: Date.now() + 1000,
    tags: {
      inletPressureBar: 122.0,
      chokeOpeningFraction: 0.85,
      arrivalPressureBar: 26.5, // 8.5 bar drop vs simulated 35 bar
      arrivalTemperatureC: 21.5,
    },
  },
  35.0e5,
  294.65,
);

assert.strictEqual(state2.isAnomalyDetected, true, "Anomaly must be flagged when residual exceeds 5.0 bar");
assert.strictEqual(state2.activeAlarms.length, 1);
const pAlarm = state2.activeAlarms[0]!;
assert.strictEqual(pAlarm.tag, "PT-201");
assert.ok(pAlarm.residual >= 8.0);
assert.ok(pAlarm.probableCause.includes("Hydrate agglomeration") || pAlarm.probableCause.includes("wax deposition"));
console.log(`✔ Discrepancy alarm detected: ${pAlarm.message}`);
console.log(`  Probable Cause: ${pAlarm.probableCause}`);

// 4. Ingest off-spec frame with subsea cooling anomaly
console.log("4. Ingesting thermal cooldown anomaly frame...");
const state3 = streamer.ingestTelemetry(
  {
    timestamp: Date.now() + 2000,
    tags: {
      arrivalPressureBar: 35.0,
      arrivalTemperatureC: 8.0, // 8.0 C vs simulated 21.5 C (delta 13.5 C)
    },
  },
  35.0e5,
  294.65,
);

assert.strictEqual(state3.isAnomalyDetected, true);
const tAlarm = state3.activeAlarms.find((a) => a.tag === "TT-202");
assert.ok(tAlarm, "Temperature anomaly alarm must be present");
assert.ok(tAlarm.probableCause.includes("insulation"));
console.log(`✔ Thermal discrepancy detected: ${tAlarm.message}`);

streamer.disconnect();
assert.strictEqual(streamer.getState().isConnected, false);
console.log("=== All Digital Twin Telemetry Tests Passed! ===");
