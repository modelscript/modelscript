// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GpssErrorCode, lintGpssSource } from "../src/lints/index.js";

describe("GPSS Linter & Diagnostics (GPSS1001–GPSS5006)", () => {
  it("produces zero diagnostics for a valid barbershop model", () => {
    const valid = `
      GENERATE 18,6
      QUEUE    LINE
      SEIZE    JOE
      DEPART   LINE
      ADVANCE  16,4
      RELEASE  JOE
      TERMINATE 1
      START    100
      END
`;
    const diags = lintGpssSource(valid);
    assert.strictEqual(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("flags unmatched SEIZE/RELEASE (GPSS3001), QUEUE/DEPART (GPSS3002), and ENTER/LEAVE (GPSS3003)", () => {
    const badPairing = `
CHAIRS STORAGE 2
      GENERATE 10,2
      QUEUE    WAITQ
      SEIZE    BARBER1
      ENTER    CHAIRS,1
      ADVANCE  8,2
      TERMINATE 1
      START    50
`;
    const diags = lintGpssSource(badPairing);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has(GpssErrorCode.UNMATCHED_SEIZE_RELEASE.id));
    assert.ok(ids.has(GpssErrorCode.UNMATCHED_QUEUE_DEPART.id));
    assert.ok(ids.has(GpssErrorCode.UNMATCHED_ENTER_LEAVE.id));
  });

  it("flags undefined TRANSFER target (GPSS2002) and duplicate label (GPSS2001)", () => {
    const badLabels = `
      GENERATE 10,2
LOOP  SEIZE    MACH
      ADVANCE  5,1
LOOP  RELEASE  MACH
      TRANSFER ,NOWHERE
      TERMINATE 1
      START    20
`;
    const diags = lintGpssSource(badLabels);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has(GpssErrorCode.DUPLICATE_LABEL.id));
    assert.ok(ids.has(GpssErrorCode.UNDEFINED_TRANSFER_TARGET.id));
  });

  it("flags non-positive STORAGE capacity (GPSS4001) and missing START/TERMINATE (GPSS5001, GPSS5002)", () => {
    const badControl = `
ZERO  STORAGE 0
      GENERATE 10,2
      ENTER    ZERO,1
      LEAVE    ZERO,1
`;
    const diags = lintGpssSource(badControl);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has(GpssErrorCode.NON_POSITIVE_STORAGE_CAPACITY.id));
    assert.ok(ids.has(GpssErrorCode.MISSING_START.id));
    assert.ok(ids.has(GpssErrorCode.MISSING_TERMINATE.id));
  });

  it("flags syntax errors (GPSS1001), zero TERMINATE decrement (GPSS5004), and invalid TRANSFER probability (GPSS5005)", () => {
    const badOps = `
      GENERATE 10,2
      INVALID_BLK 5
      TRANSFER 1.5,DONE,DONE
DONE  TERMINATE 0
      START    10
`;
    const diags = lintGpssSource(badOps);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has(GpssErrorCode.SYNTAX_ERROR.id));
    assert.ok(ids.has(GpssErrorCode.ZERO_TERMINATE_DECREMENT.id));
    assert.ok(ids.has(GpssErrorCode.INVALID_TRANSFER_PROBABILITY.id));
  });
});
