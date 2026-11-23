// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildIgesFile, formatIgesLine, IgesErrorCode, lintIges } from "../src/index.js";

describe("@modelscript/iges — IGES 5.3 Linter (IGES1001–IGES5006)", () => {
  it("reports zero diagnostics on a valid IGES 5.3 file", () => {
    const valid = buildIgesFile({
      unitFlag: 2,
      entities: [
        { entityType: 110, label: "L1", params: [0, 0, 0, 10, 0, 0] },
        { entityType: 100, label: "A1", params: [0, 0, 0, 5, 0, 0, 5] },
      ],
    });
    const diags = lintIges(valid);
    assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects column width / syntax errors (IGES1001) and out-of-order sections (IGES1003)", () => {
    const bad = [
      "Too short line",
      formatIgesLine("1H,,1H;,4HTEST;", "G", 1),
      formatIgesLine("Start after Global", "S", 1),
    ].join("\n");
    const diags = lintIges(bad);
    assert.ok(diags.some((d) => d.id === IgesErrorCode.SYNTAX_COLUMN_WIDTH.id));
    assert.ok(diags.some((d) => d.id === IgesErrorCode.INVALID_SECTION_ORDER.id));
  });

  it("detects missing mandatory sections (IGES2001–IGES2005)", () => {
    const empty = formatIgesLine("Only start section", "S", 1);
    const diags = lintIges(empty);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has(IgesErrorCode.MISSING_GLOBAL_SECTION.id));
    assert.ok(ids.has(IgesErrorCode.MISSING_DIRECTORY_SECTION.id));
    assert.ok(ids.has(IgesErrorCode.MISSING_PARAMETER_SECTION.id));
    assert.ok(ids.has(IgesErrorCode.MISSING_TERMINATE_SECTION.id));
  });

  it("detects mismatched Terminate section counts (IGES2006)", () => {
    const valid = buildIgesFile({
      entities: [{ entityType: 110, params: [0, 0, 0, 1, 0, 0] }],
    });
    const broken = valid.replace("D0000002", "D0000099");
    const diags = lintIges(broken);
    assert.ok(diags.some((d) => d.id === IgesErrorCode.MISMATCHED_TERMINATE_COUNTS.id));
  });

  it("detects invalid DE pointers (IGES3001), incomplete DE records (IGES3002), and invalid unit flag (IGES4001)", () => {
    const badUnitAndPtr = buildIgesFile({
      unitFlag: 99,
      entities: [{ entityType: 110, transformMatrixPointer: 42, params: [0, 0, 0, 1, 0, 0] }],
    });
    const diags = lintIges(badUnitAndPtr);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has(IgesErrorCode.INVALID_UNIT_FLAG.id));
    assert.ok(ids.has(IgesErrorCode.INVALID_DE_POINTER.id));

    // Drop the second DE line to trigger IGES3002
    const lines = buildIgesFile({
      entities: [{ entityType: 110, params: [0, 0, 0, 1, 0, 0] }],
    }).split("\n");
    const incomplete = lines
      .filter((l) => !(l.length === 80 && l[72] === "D" && l.slice(73, 80).trim() === "2"))
      .join("\n");
    const diags2 = lintIges(incomplete);
    assert.ok(diags2.some((d) => d.id === IgesErrorCode.INCOMPLETE_DE_RECORD.id));
  });

  it("detects degenerate line (IGES5001), degenerate/inconsistent arc (IGES5002), and singular transform (IGES5005)", () => {
    const iges = buildIgesFile({
      entities: [
        { entityType: 110, params: [1, 2, 3, 1, 2, 3] }, // zero-length line
        { entityType: 100, params: [0, 0, 0, 0, 0, 0, 0] }, // zero-radius arc
        { entityType: 100, params: [0, 0, 0, 1, 0, 5, 0] }, // mismatched radii
        { entityType: 124, params: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0] }, // singular det=0
      ],
    });
    const diags = lintIges(iges);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has(IgesErrorCode.DEGENERATE_ZERO_LENGTH_LINE.id));
    assert.ok(ids.has(IgesErrorCode.DEGENERATE_ZERO_RADIUS_ARC.id));
    assert.ok(ids.has(IgesErrorCode.SINGULAR_TRANSFORM_MATRIX.id));
  });

  it("detects non-monotonic NURBS knots (IGES5003), invalid NURBS weights (IGES5004), and invalid B-Rep shell pointer (IGES5006)", () => {
    const iges = buildIgesFile({
      entities: [
        // Non-monotonic knots + non-positive weight
        {
          entityType: 126,
          params: [2, 2, 1, 0, 0, 0, 0, 0, 0.8, 0.2, 1, 1, 1, -0.5, 1, 0, 0, 0, 1, 1, 0, 2, 0, 0, 0, 1, 0, 0, 1],
        },
        // Invalid shell pointer in Type 186
        {
          entityType: 186,
          params: [999, 1, 0],
        },
      ],
    });
    const diags = lintIges(iges);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has(IgesErrorCode.NON_MONOTONIC_NURBS_KNOTS.id));
    assert.ok(ids.has(IgesErrorCode.INVALID_NURBS_WEIGHTS.id));
    assert.ok(ids.has(IgesErrorCode.INVALID_BREP_REFERENCE.id));
  });
});
