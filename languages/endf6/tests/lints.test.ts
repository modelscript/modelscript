// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateReferenceEndf6Tape } from "../src/catalog/reference-tapes.js";
import { lintEndf6Source } from "../src/lints/index.js";
import { formatEndfCard, formatEndfTextCard } from "../src/parser/endf-float.js";

describe("ENDF-6 Linter & Diagnostics (ENDF1001–ENDF5006)", () => {
  it("produces zero diagnostics on clean reference tapes (H-1, B-10, U-235, U-238, Pu-239)", () => {
    for (const sym of ["H-1", "B-10", "U-235", "U-238", "Pu-239"]) {
      const tape = generateReferenceEndf6Tape(sym);
      const diags = lintEndf6Source(tape);
      assert.equal(
        diags.length,
        0,
        `Expected 0 diagnostics for ${sym}, got: ${diags.map((d) => `${d.id}: ${d.message}`).join("; ")}`,
      );
    }
  });

  it("detects card-length error (ENDF1001) and missing SEND/FEND/MEND/TEND (ENDF1002–ENDF1005)", () => {
    const badTape = [
      formatEndfTextCard("TEST TAPE", 1, 0, 0, 0) + "EXTRA_OVERFLOW_CHARS",
      formatEndfCard([92235, 233.025, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], 9228, 3, 1, 1),
      formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 1 }, { int: 2 }], 9228, 3, 1, 2),
      formatEndfCard([{ int: 2 }, { int: 2 }], 9228, 3, 1, 3),
      formatEndfCard([0.0253, 10.0, 1.0, 5.0], 9228, 3, 1, 4),
    ].join("\n");

    const ids = new Set(lintEndf6Source(badTape).map((d) => d.id));
    assert.ok(ids.has("ENDF1001"), "Expected ENDF1001 card length error");
    assert.ok(ids.has("ENDF1002"), "Expected ENDF1002 missing SEND");
    assert.ok(ids.has("ENDF1003"), "Expected ENDF1003 missing FEND");
    assert.ok(ids.has("ENDF1004"), "Expected ENDF1004 missing MEND");
    assert.ok(ids.has("ENDF1005"), "Expected ENDF1005 missing TEND");
  });

  it("detects invalid MF (ENDF2002), non-monotonic energy (ENDF3001), negative sigma (ENDF3002), and invalid INT (ENDF3003)", () => {
    const badTape = [
      formatEndfTextCard("BAD MF3 TAPE", 1, 0, 0, 0),
      formatEndfCard([1001, 0.999, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], 125, 99, 1, 1),
      formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], 125, 99, 0, 99999),
      formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], 125, 0, 0, 0),
      formatEndfCard([1001, 0.999, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], 125, 3, 2, 1),
      formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 1 }, { int: 3 }], 125, 3, 2, 2),
      formatEndfCard([{ int: 3 }, { int: 9 }], 125, 3, 2, 3), // INT=9 invalid
      formatEndfCard([1.0, 20.0, 0.5, -3.0, 2.0, 15.0], 125, 3, 2, 4), // non-monotonic 0.5 < 1.0 and negative -3.0
      formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], 125, 3, 0, 99999),
      formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], 125, 0, 0, 0),
      formatEndfCard([], 0, 0, 0, 0),
      formatEndfCard([], -1, 0, 0, 0),
    ].join("\n");

    const ids = new Set(lintEndf6Source(badTape).map((d) => d.id));
    assert.ok(ids.has("ENDF2002"), "Expected ENDF2002 invalid MF=99");
    assert.ok(ids.has("ENDF3001"), "Expected ENDF3001 non-monotonic energy grid");
    assert.ok(ids.has("ENDF3002"), "Expected ENDF3002 negative cross-section");
    assert.ok(ids.has("ENDF3003"), "Expected ENDF3003 invalid INT=9");
  });

  it("detects MT=1 total < partial sum warning (ENDF4001) and invalid ZA/AWR (ENDF5001, ENDF5002)", () => {
    const badTape = [
      formatEndfTextCard("CONSISTENCY TEST", 1, 0, 0, 0),
      // Invalid ZA = -5, invalid AWR = 0
      formatEndfCard([-5, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], 500, 3, 1, 1),
      formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 1 }, { int: 2 }], 500, 3, 1, 2),
      formatEndfCard([{ int: 2 }, { int: 2 }], 500, 3, 1, 3),
      formatEndfCard([0.0253, 10.0, 1.0, 5.0], 500, 3, 1, 4), // total = 10 b
      formatEndfCard([], 500, 3, 0, 99999),
      formatEndfCard([-5, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], 500, 3, 2, 1),
      formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 1 }, { int: 2 }], 500, 3, 2, 2),
      formatEndfCard([{ int: 2 }, { int: 2 }], 500, 3, 2, 3),
      formatEndfCard([0.0253, 15.0, 1.0, 8.0], 500, 3, 2, 4), // elastic = 15 b > total 10 b!
      formatEndfCard([], 500, 3, 0, 99999),
      formatEndfCard([], 500, 0, 0, 0),
      formatEndfCard([], 0, 0, 0, 0),
      formatEndfCard([], -1, 0, 0, 0),
    ].join("\n");

    const diags = lintEndf6Source(badTape);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("ENDF4001"), "Expected ENDF4001 total < partial sum warning");
    assert.ok(ids.has("ENDF5001"), "Expected ENDF5001 invalid ZA");
    assert.ok(ids.has("ENDF5002"), "Expected ENDF5002 invalid AWR <= 0");
    const totalWarn = diags.find((d) => d.id === "ENDF4001");
    assert.equal(totalWarn?.severity, "warning");
  });
});
