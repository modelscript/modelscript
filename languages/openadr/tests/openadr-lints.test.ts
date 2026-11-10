// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintOpenAdr } from "../src/lints/rules.js";
import { parseOpenAdr } from "../src/parser/openadr-parser.js";

const VALID_DECK = `
event "VALID_EVENT" {
  status: "active"
  signalType: "setpoint"

  interval {
    durationSeconds: 3600
    payload: 100.0
  }
}
`;

const NEGATIVE_DURATION_DECK = `
event "BAD_DURATION" {
  status: "active"
  signalType: "setpoint"

  interval {
    durationSeconds: -50
    payload: 100.0
  }
}
`;

const NEGATIVE_PAYLOAD_DECK = `
event "BAD_PAYLOAD" {
  status: "active"
  signalType: "setpoint"

  interval {
    durationSeconds: 3600
    payload: -25.0
  }
}
`;

describe("OpenADR Linter", () => {
  it("passes valid demand response event without diagnostics", () => {
    const deck = parseOpenAdr(VALID_DECK);
    const diags = lintOpenAdr(deck);
    assert.strictEqual(diags.length, 0);
  });

  it("errors on negative duration interval", () => {
    const deck = parseOpenAdr(NEGATIVE_DURATION_DECK);
    const diags = lintOpenAdr(deck);
    const err = diags.find((d) => d.code === 3001);
    assert.ok(err, "Should report M3001 negative duration error");
  });

  it("warns on negative setpoint payload", () => {
    const deck = parseOpenAdr(NEGATIVE_PAYLOAD_DECK);
    const diags = lintOpenAdr(deck);
    const w = diags.find((d) => d.code === 3002);
    assert.ok(w, "Should report M3002 negative signal payload warning");
  });
});
