// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOpenAdr } from "../src/parser/openadr-parser.js";
import { evaluateCurtailment } from "../src/solver/curtailment-evaluator.js";

const SCHEDULE_TEST_DECK = `
program "Emergency_Load_Shed" {
  event "EVENT_GRID_ALERT" {
    status: "active"
    signalType: "setpoint"
    targetVenId: "VEN-DEPOT-1"

    interval {
      durationSeconds: 3600
      payload: 80.0
    }

    interval {
      durationSeconds: 1800
      payload: 40.0
    }
  }
}
`;

describe("OpenADR Curtailment Evaluator", () => {
  it("evaluates time-series curtailment schedule from intervals", () => {
    const deck = parseOpenAdr(SCHEDULE_TEST_DECK);
    const schedule = evaluateCurtailment(deck, "VEN-DEPOT-1");

    assert.strictEqual(schedule.length, 2);
    assert.strictEqual(schedule[0]?.timeSeconds, 0);
    assert.strictEqual(schedule[0]?.activeLimitKW, 80.0);
    assert.strictEqual(schedule[1]?.timeSeconds, 3600);
    assert.strictEqual(schedule[1]?.activeLimitKW, 40.0);
  });
});
