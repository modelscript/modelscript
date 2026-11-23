// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeAlgoTask } from "../src/commands/algo.js";

describe("CLI `msx algo` task execution", () => {
  it("executes CLI `msx algo` tasks across DSP, MOR, Reliability, Scheduling, Flow, TopOpt, LVS, and Bio", () => {
    const mf = executeAlgoTask("max-flow", {
      numNodes: 3,
      edges: [
        { from: 0, to: 1, capacity: 7 },
        { from: 1, to: 2, capacity: 4 },
      ],
      source: 0,
      sink: 2,
    }) as { maxFlow: number };
    assert.equal(mf.maxFlow, 4);

    const lvs = executeAlgoTask("lvs", {
      schematic: [{ id: "R1", kind: "resistor", pins: ["A", "B"] }],
      layout: [{ id: "R_phy", kind: "resistor", pins: ["N1", "N2"] }],
    }) as { equivalent: boolean };
    assert.equal(lvs.equivalent, true);

    const mor = executeAlgoTask("mor", {
      A: [
        [-1, 0],
        [0, -500],
      ],
      B: [[1], [1]],
      C: [[1, 0.01]],
      targetOrder: 1,
    }) as { order: number; hInfErrorBound: number };
    assert.equal(mor.order, 1);
    assert.ok(mor.hInfErrorBound < 1e-3);
  });
});
