// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmtSolver, type EmtCircuitDefinition } from "../src/solvers/emt/index.js";

describe("sinusoidal current source", () => {
  const dt = 25e-6;
  const circuit: EmtCircuitDefinition = {
    buses: ["L"],
    rlc: [{ id: "Load", from: "L", to: "GND", r: 20 }],
    currentSources: [{ id: "I1", bus: "L", iPeakA: 10, freqHz: 60 }],
  };
  const res = new EmtSolver(circuit, { timeStepSec: dt, durationSec: 0.1, steadyStateInit: false }).solve();
  const v = res.busVoltages.get("L")!;

  it("develops v = I * R across a resistive load (200 V peak)", () => {
    let max = 0;
    for (const x of v) max = Math.max(max, Math.abs(x));
    assert.ok(Math.abs(max - 200) < 2, `peak ${max}`);
  });

  it("follows the injected waveform in phase", () => {
    const k = Math.round(0.004 / dt);
    const expected = 200 * Math.sin(2 * Math.PI * 60 * k * dt);
    assert.ok(Math.abs(v[k]! - expected) < 2, `${v[k]} vs ${expected}`);
  });
});
