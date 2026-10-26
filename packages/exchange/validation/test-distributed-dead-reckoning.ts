// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DeadReckoningBuffer, NetworkTimeSynchronizer, type TimeSyncSample } from "../src/cosim/index.js";

describe("Distributed Time Synchronization & Dead-Reckoning Tests", () => {
  it("calculates clock offset and round-trip time via PTP 4-timestamp exchange", () => {
    const sync = new NetworkTimeSynchronizer({ emaAlpha: 0.5 });

    // Scenario: Remote participant clock is ahead by 150 ms
    // Network one-way latency is 20 ms in each direction (RTT = 40 ms)
    // Master sends at t1 = 1000 ms
    // Remote receives at t2 = 1000 + 20 + 150 = 1170 ms
    // Remote processes for 5 ms, sends reply at t3 = 1175 ms
    // Master receives at t4 = 1175 + 20 - 150 = 1045 ms (master local time: 1000 + 20 + 5 + 20 = 1045 ms)
    const sample1: TimeSyncSample = {
      t1: 1000,
      t2: 1170,
      t3: 1175,
      t4: 1045,
    };

    const metrics1 = sync.recordSample("edge_node_1", sample1);

    // RTT = (t4 - t1) - (t3 - t2) = (1045 - 1000) - (1175 - 1170) = 45 - 5 = 40 ms
    assert.strictEqual(metrics1.roundTripTimeMs, 40);
    // Offset = ((t2 - t1) + (t3 - t4)) / 2 = ((1170 - 1000) + (1175 - 1045)) / 2 = (170 + 130) / 2 = 150 ms
    assert.strictEqual(metrics1.clockOffsetMs, 150);
    assert.strictEqual(metrics1.filteredRttMs, 40);
    assert.strictEqual(metrics1.filteredOffsetMs, 150);

    // Timestamp conversion: remote timestamp 1200 ms should map to local 1200 - 150 = 1050 ms
    const localTime = sync.remoteToLocalTimeMs("edge_node_1", 1200);
    assert.strictEqual(localTime, 1050);
  });

  it("applies exponential moving average (EMA) smoothing across multiple sync samples", () => {
    const sync = new NetworkTimeSynchronizer({ emaAlpha: 0.2 });

    // Initial baseline: RTT = 50ms, Offset = 100ms
    sync.recordSample("edge_node_1", { t1: 100, t2: 225, t3: 230, t4: 155 });

    // Second sample with momentary network jitter: RTT = 80ms, Offset = 100ms
    const m2 = sync.recordSample("edge_node_1", { t1: 200, t2: 340, t3: 345, t4: 285 });

    // Filtered RTT should be smoothed: 0.8 * 50 + 0.2 * 80 = 40 + 16 = 56 ms
    assert.ok(Math.abs(m2.filteredRttMs - 56.0) < 1e-4);
    assert.ok(Math.abs(m2.filteredOffsetMs - 100.0) < 1e-4);
  });

  it("extrapolates missing values via Hermite dead-reckoning when packets drop", () => {
    const dr = new DeadReckoningBuffer({ maxConsecutiveExtrapolations: 3 });

    // Trajectory: y(t) = 5.0 * t + 10.0 (constant speed 5 m/s)
    // Step 0: t = 0.0, y = 10.0
    dr.recordValue("motor", "speed", 0.0, 10.0);
    // Step 1: t = 0.1, y = 10.5
    dr.recordValue("motor", "speed", 0.1, 10.5);
    // Step 2: t = 0.2, y = 11.0
    dr.recordValue("motor", "speed", 0.2, 11.0);

    // On-time check at t = 0.2
    const resExact = dr.getOrExtrapolate("motor", "speed", 0.2);
    assert.strictEqual(resExact.wasExtrapolated, false);
    assert.strictEqual(resExact.consecutiveSteps, 0);
    assert.strictEqual(resExact.value, 11.0);

    // Missing packet at t = 0.3 -> Dead-reckoning extrapolation
    const resExtrap1 = dr.getOrExtrapolate("motor", "speed", 0.3);
    assert.strictEqual(resExtrap1.wasExtrapolated, true);
    assert.strictEqual(resExtrap1.consecutiveSteps, 1);
    assert.strictEqual(resExtrap1.canContinue, true);
    // Linear trajectory tangent extrapolation: 11.0 + 5.0 * 0.1 = 11.5
    assert.ok(Math.abs(resExtrap1.value - 11.5) < 1e-4, `Expected 11.5, got ${resExtrap1.value}`);

    // Missing packet at t = 0.4 -> Second consecutive extrapolation
    const resExtrap2 = dr.getOrExtrapolate("motor", "speed", 0.4);
    assert.strictEqual(resExtrap2.consecutiveSteps, 2);
    assert.strictEqual(resExtrap2.canContinue, true);
    assert.ok(Math.abs(resExtrap2.value - 12.0) < 1e-4);

    // Compute drift when delayed actual value (11.52) arrives for t = 0.3
    const drift = dr.computeDrift("motor", "speed", 0.3, 11.52);
    assert.ok(Math.abs(drift - 0.02) < 1e-4, `Drift should be 0.02, got ${drift}`);
  });

  it("enforces maximum consecutive extrapolation limits to prevent unbounded drift", () => {
    const dr = new DeadReckoningBuffer({ maxConsecutiveExtrapolations: 2 });

    dr.recordValue("sensor", "temp", 0.0, 20.0);
    dr.recordValue("sensor", "temp", 1.0, 21.0);

    // 1st dropped step: allowed
    const s1 = dr.getOrExtrapolate("sensor", "temp", 2.0);
    assert.strictEqual(s1.canContinue, true);

    // 2nd dropped step: allowed
    const s2 = dr.getOrExtrapolate("sensor", "temp", 3.0);
    assert.strictEqual(s2.canContinue, true);

    // 3rd dropped step: exceeds limit of 2 -> must flag canContinue = false
    const s3 = dr.getOrExtrapolate("sensor", "temp", 4.0);
    assert.strictEqual(s3.consecutiveSteps, 3);
    assert.strictEqual(s3.canContinue, false, "Must signal orchestrator to pause or degrade");

    // Packet arrives -> resets counter
    dr.recordValue("sensor", "temp", 4.0, 24.1);
    const s4 = dr.getOrExtrapolate("sensor", "temp", 4.0);
    assert.strictEqual(s4.wasExtrapolated, false);
    assert.strictEqual(s4.consecutiveSteps, 0);
    assert.strictEqual(s4.canContinue, true);
  });
});
