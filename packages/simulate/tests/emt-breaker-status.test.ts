// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmtSolver, type EmtCircuitDefinition } from "../src/solvers/emt/index.js";

describe("breaker_status actuator", () => {
  const dt = 25e-6;
  const circuit: EmtCircuitDefinition = {
    buses: ["S", "L"],
    breakers: [{ id: "BRK", from: "S", to: "L", closedInitially: true, rClosedOhm: 1e-3, rOpenOhm: 1e6 }],
    rlc: [{ id: "Load", from: "L", to: "GND", r: 20 }],
    sources: [{ id: "G", bus: "S", vPeakKv: 1, freqHz: 60 }],
    csmfBlocks: [
      { id: "T", kind: "tbreakn", params: { INIT: 1, NUMS: 2, TO1: 0.03, TO2: 0.06 } },
      {
        id: "BRK_status",
        kind: "sum",
        inputs: ["T"],
        params: {},
        actuator: { type: "breaker_status", targetId: "BRK" },
      },
    ],
  };
  const res = new EmtSolver(circuit, { timeStepSec: dt, durationSec: 0.1, steadyStateInit: true }).solve();
  const i = res.branchCurrents.get("BRK")!;
  const peak = (t0: number, t1: number): number => {
    let m = 0;
    for (let k = Math.round(t0 / dt); k < Math.round(t1 / dt); k++) m = Math.max(m, Math.abs(i[k]!));
    return m;
  };

  it("conducts before the first operation", () => {
    assert.ok(peak(0.005, 0.025) > 10, `peak ${peak(0.005, 0.025)}`);
  });

  it("interrupts after TO1 (status 1 = open)", () => {
    assert.ok(peak(0.045, 0.058) < 1, `peak ${peak(0.045, 0.058)}`);
  });

  it("recloses after TO2 (status back to 0)", () => {
    assert.ok(peak(0.075, 0.1) > 10, `peak ${peak(0.075, 0.1)}`);
  });
});
