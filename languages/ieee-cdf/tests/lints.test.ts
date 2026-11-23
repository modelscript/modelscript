// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IEEE_14_BUS_CDF, IEEE_5_BUS_CDF } from "../src/catalog/ieee-cdf-std-schemas.js";
import { IeeeCdfErrorCode, lintIeeeCdf } from "../src/lints/index.js";
import { parseIeeeCdf } from "../src/parser/index.js";

describe("@modelscript/ieee-cdf Lints & Diagnostics (CDF1001-CDF5006)", () => {
  it("reports zero diagnostics on valid IEEE 5-bus and IEEE 14-bus decks", () => {
    assert.strictEqual(lintIeeeCdf(parseIeeeCdf(IEEE_5_BUS_CDF)).length, 0);
    assert.strictEqual(lintIeeeCdf(parseIeeeCdf(IEEE_14_BUS_CDF)).length, 0);
  });

  it("detects CDF1001 syntax error, CDF1002 missing title/MVA base, CDF1003 missing END OF DATA, and CDF5006 zero MVA base", () => {
    const bad = `BUS DATA FOLLOWS
BAD_BUS_LINE
1 "Slack" 1 1 3 1.0 0.0 0 0 0 0 138 1.0 0 0 0 0 0
-999
BRANCH DATA FOLLOWS
-999
`;
    const diags = lintIeeeCdf(parseIeeeCdf(bad));
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has(IeeeCdfErrorCode.SYNTAX_ERROR.code));
    assert.ok(codes.has(IeeeCdfErrorCode.MISSING_TITLE_OR_MVA_BASE.code));
    assert.ok(codes.has(IeeeCdfErrorCode.MISSING_END_OF_DATA.code));
    assert.ok(codes.has(IeeeCdfErrorCode.ZERO_MVA_BASE.code));
  });

  it("detects CDF2001 duplicate bus, CDF2002 undefined branch bus, CDF3001 self-loop, and CDF3002 zero impedance", () => {
    const deck = `01/01/73 TEST 100.0 1973 S TOPOLOGY_ERRORS
BUS DATA FOLLOWS
1 "Slack" 1 1 3 1.02 0.0 0 0 0 0 138 1.02 0 0 0 0 0
1 "DupBus" 1 1 0 1.00 0.0 10 5 0 0 138 0 0 0 0 0 0
2 "Load" 1 1 0 1.00 0.0 20 5 0 0 138 0 0 0 0 0 0
-999
BRANCH DATA FOLLOWS
1 2 1 1 1 0 0.0 0.0 0.0
1 1 1 1 2 0 0.01 0.05 0.0
1 99 1 1 1 0 0.02 0.08 0.0
-999
END OF DATA
`;
    const diags = lintIeeeCdf(parseIeeeCdf(deck));
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has(IeeeCdfErrorCode.DUPLICATE_BUS_NUMBER.code));
    assert.ok(codes.has(IeeeCdfErrorCode.UNDEFINED_BRANCH_BUS.code));
    assert.ok(codes.has(IeeeCdfErrorCode.SELF_LOOP_BRANCH.code));
    assert.ok(codes.has(IeeeCdfErrorCode.ZERO_IMPEDANCE_BRANCH.code));
  });

  it("detects CDF4001 missing slack bus and CDF4002 multiple slack buses", () => {
    const noSlack = `01/01/73 TEST 100.0 1973 S NO_SLACK
BUS DATA FOLLOWS
1 "Bus1" 1 1 2 1.00 0.0 0 0 50 0 138 1.0 50 -50 0 0 0
2 "Bus2" 1 1 0 1.00 0.0 50 10 0 0 138 0 0 0 0 0 0
-999
BRANCH DATA FOLLOWS
1 2 1 1 1 0 0.01 0.05 0.0
-999
END OF DATA
`;
    assert.ok(lintIeeeCdf(parseIeeeCdf(noSlack)).some((d) => d.code === IeeeCdfErrorCode.MISSING_SLACK_BUS.code));

    const multiSlack = `01/01/73 TEST 100.0 1973 S MULTI_SLACK
BUS DATA FOLLOWS
1 "Slack1" 1 1 3 1.02 0.0 0 0 50 0 138 1.02 0 0 0 0 0
2 "Slack2" 1 1 3 1.01 0.0 50 10 0 0 138 1.01 0 0 0 0 0
-999
BRANCH DATA FOLLOWS
1 2 1 1 1 0 0.01 0.05 0.0
-999
END OF DATA
`;
    const multiDiags = lintIeeeCdf(parseIeeeCdf(multiSlack));
    const multiSlackDiag = multiDiags.find((d) => d.code === IeeeCdfErrorCode.MULTIPLE_SLACK_BUSES.code);
    assert.ok(multiSlackDiag);
    assert.strictEqual(multiSlackDiag.severity, "warning");
  });

  it("detects CDF5001 voltage out of bounds, CDF5002 inverted PV Qlim, CDF5003 disconnected island, CDF5004 negative R, CDF5005 invalid tap", () => {
    const deck = `01/01/73 TEST 100.0 1973 S ELECTRICAL_CHECKS
BUS DATA FOLLOWS
1 "Slack" 1 1 3 1.05 0.0 0 0 50 0 138 1.05 0 0 0 0 0
2 "PV_Bad" 1 1 2 1.35 0.0 10 5 30 0 138 1.35 10.0 40.0 0 0 0
3 "Island" 1 1 0 0.70 0.0 15 5 0 0 138 0 0 0 0 0 0
-999
BRANCH DATA FOLLOWS
1 2 1 1 1 1 -0.01 0.08 0.0 0 0 0 0 0 1.75 0.0
-999
END OF DATA
`;
    const diags = lintIeeeCdf(parseIeeeCdf(deck));
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has(IeeeCdfErrorCode.VOLTAGE_OUT_OF_BOUNDS.code));
    assert.ok(codes.has(IeeeCdfErrorCode.PV_QLIM_INVERTED.code));
    assert.ok(codes.has(IeeeCdfErrorCode.DISCONNECTED_ISLAND_BUS.code));
    assert.ok(codes.has(IeeeCdfErrorCode.NEGATIVE_BRANCH_RESISTANCE.code));
    assert.ok(codes.has(IeeeCdfErrorCode.INVALID_TAP_RATIO.code));
  });
});
