// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintBufr } from "../src/index.js";

describe("@modelscript/bufr Linter (BUFR1001–BUFR5006)", () => {
  it("reports zero diagnostics on a valid BUFR message", () => {
    const valid = `
BUFR EDITION 4
SECTION 1
  CENTRE = 7
  YEAR = 2026
  MONTH = 6
  DAY = 15
SECTION 3
  SUBSETS = 1
  0-01-001
  0-12-101
  0-12-103
  0-13-003
SECTION 4
  SUBSET 1:
    0-01-001 = 72
    0-12-101 = 290.00
    0-12-103 = 284.00
    0-13-003 = 70
7777
`;
    const diags = lintBufr(valid);
    assert.equal(diags.length, 0);
  });

  it("detects missing magic header (BUFR1001) and missing 7777 (BUFR1002)", () => {
    const bad = `
SECTION 3
  SUBSETS = 1
  0-01-001
SECTION 4
  SUBSET 1:
    0-01-001 = 72
`;
    const diags = lintBufr(bad);
    assert.ok(diags.some((d) => d.code === "BUFR1001"));
    assert.ok(diags.some((d) => d.code === "BUFR1002"));
  });

  it("detects invalid F/X/Y ranges (BUFR2001–BUFR2003) and unknown descriptor (BUFR3001)", () => {
    const bad = `
BUFR EDITION 4
SECTION 3
  SUBSETS = 0
  5-01-001
  0-70-001
  0-01-300
  0-63-250
7777
`;
    const diags = lintBufr(bad);
    assert.ok(diags.some((d) => d.code === "BUFR2001"));
    assert.ok(diags.some((d) => d.code === "BUFR2002"));
    assert.ok(diags.some((d) => d.code === "BUFR2003"));
    assert.ok(diags.some((d) => d.code === "BUFR3001"));
  });

  it("detects subset count mismatch (BUFR4001) and delayed replication error (BUFR4002)", () => {
    const bad = `
BUFR EDITION 4
SECTION 3
  SUBSETS = 2
  1-01-000
  0-12-101
SECTION 4
  SUBSET 1:
    0-12-101 = 288.15
7777
`;
    const diags = lintBufr(bad);
    assert.ok(diags.some((d) => d.code === "BUFR4001"));
    assert.ok(diags.some((d) => d.code === "BUFR4002"));
  });

  it("detects physical meteorological range violations (BUFR5001–BUFR5006)", () => {
    const bad = `
BUFR EDITION 4
SECTION 3
  SUBSETS = 1
  0-05-001
  0-10-004
  0-12-101
  0-12-103
  0-13-003
  0-11-001
SECTION 4
  SUBSET 1:
    0-05-001 = 95.0
    0-10-004 = 150000
    0-12-101 = 120.0
    0-12-103 = 295.0
    0-13-003 = 115
    0-11-001 = 420
7777
`;
    const diags = lintBufr(bad);
    assert.ok(diags.some((d) => d.code === "BUFR5001"));
    assert.ok(diags.some((d) => d.code === "BUFR5002"));
    assert.ok(diags.some((d) => d.code === "BUFR5003"));
    assert.ok(diags.some((d) => d.code === "BUFR5004"));
    assert.ok(diags.some((d) => d.code === "BUFR5005"));
    assert.ok(diags.some((d) => d.code === "BUFR5006"));
  });
});
