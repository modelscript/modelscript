// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmtSolver, type EmtCircuitDefinition } from "../src/solvers/emt/index.js";

describe("peswitch diode", () => {
  const dt = 25e-6;
  const circuit: EmtCircuitDefinition = {
    buses: ["S", "L"],
    breakers: [{ id: "D1", from: "S", to: "L", closedInitially: true, rClosedOhm: 1e-3, rOpenOhm: 1e6, diode: true }],
    rlc: [{ id: "Load", from: "L", to: "GND", r: 20 }],
    sources: [{ id: "G", bus: "S", vPeakKv: 1, freqHz: 60 }],
  };
  const res = new EmtSolver(circuit, { timeStepSec: dt, durationSec: 0.1, steadyStateInit: false }).solve();
  const i = res.branchCurrents.get("D1")!;

  it("conducts in the forward half-cycle", () => {
    let max = 0;
    for (let k = Math.round(0.05 / dt); k < i.length; k++) max = Math.max(max, i[k]!);
    assert.ok(max > 10, `max ${max}`);
  });

  it("blocks reverse current (half-wave rectification)", () => {
    let min = 0;
    for (let k = Math.round(0.05 / dt); k < i.length; k++) min = Math.min(min, i[k]!);
    assert.ok(min > -5, `min ${min}`);
  });
});
