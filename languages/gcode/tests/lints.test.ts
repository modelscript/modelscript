// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { GCodeErrorCode, lintGCode } from "../src/index.js";

test("G-code Lints: clean valid program produces zero diagnostics", () => {
  const cleanProgram = [
    "%",
    "O1000 (CLEAN PROGRAM)",
    "G21 G90 G17 G54",
    "T1 M06",
    "S10000 M03",
    "G00 X0 Y0 Z10",
    "G01 Z-2 F300",
    "G01 X40 F800",
    "G02 X60 Y20 I0 J20",
    "G00 Z10",
    "M05",
    "M30",
    "%",
  ].join("\n");

  const diags = lintGCode(cleanProgram);
  assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
});

test("G-code Lints: GC1001 syntax error and GC2001 undefined subprogram", () => {
  const syntaxSrc = "O1001\nG21 G90\nG01 X[10 + 5 F200\nM30";
  const syntaxDiags = lintGCode(syntaxSrc);
  assert.ok(syntaxDiags.some((d) => d.id === GCodeErrorCode.SYNTAX_ERROR.id));

  const subSrc = "O1002\nG21 G90\nS6000 M03\nM98 P9999\nM30";
  const subDiags = lintGCode(subSrc);
  assert.ok(subDiags.some((d) => d.id === GCodeErrorCode.UNDEFINED_SUBPROGRAM.id));
});

test("G-code Lints: GC3001 zero feedrate and GC3002 spindle stopped during cutting", () => {
  const noFeedSrc = "O1003\nG21 G90\nS8000 M03\nG01 X20 Y0\nM30";
  const noFeedDiags = lintGCode(noFeedSrc);
  assert.ok(noFeedDiags.some((d) => d.id === GCodeErrorCode.ZERO_FEEDRATE_CUTTING.id));

  const stoppedSpindleSrc = "O1004\nG21 G90\nG01 X20 Y0 F500\nM30";
  const stoppedDiags = lintGCode(stoppedSpindleSrc);
  assert.ok(stoppedDiags.some((d) => d.id === GCodeErrorCode.SPINDLE_STOPPED_CUTTING.id));
});

test("G-code Lints: GC4001 invalid arc geometry (missing IJK/R, radius mismatch, R too small)", () => {
  const missingParams = "O1005\nG21 G90\nS8000 M03\nG00 X0 Y0\nG02 X10 Y10 F400\nM30";
  assert.ok(lintGCode(missingParams).some((d) => d.id === GCodeErrorCode.INVALID_ARC_GEOMETRY.id));

  const radiusMismatch = "O1006\nG21 G90\nS8000 M03\nG00 X0 Y0\nG02 X20 Y0 I5 J0 F400\nM30";
  assert.ok(lintGCode(radiusMismatch).some((d) => d.id === GCodeErrorCode.INVALID_ARC_GEOMETRY.id));

  const rTooSmall = "O1007\nG21 G90\nS8000 M03\nG00 X0 Y0\nG03 X30 Y0 R5 F400\nM30";
  assert.ok(lintGCode(rTooSmall).some((d) => d.id === GCodeErrorCode.INVALID_ARC_GEOMETRY.id));
});

test("G-code Lints: GC4002 conflicting modal G-codes in same block", () => {
  const conflictSrc = "O1008\nG20 G21\nG00 G01 X10 F300\nS6000 M03\nM30";
  const diags = lintGCode(conflictSrc).filter((d) => d.id === GCodeErrorCode.CONFLICTING_MODAL_GCODES.id);
  assert.ok(diags.length >= 2, `Expected >= 2 modal conflicts, got ${diags.length}`);
});

test("G-code Lints: GC5001 rapid plunge, GC5002 missing end, GC5003 missing S, GC5004 canned cycle, GC5005 comp, GC5006 duplicate word", () => {
  const rapidPlunge = "O1009\nG21 G90\nG00 Z10\nG00 Z-5\nM30";
  assert.ok(lintGCode(rapidPlunge).some((d) => d.id === GCodeErrorCode.RAPID_PLUNGE_COLLISION.id));

  const noEnd = "O1010\nG21 G90\nS6000 M03\nG01 X10 F400";
  assert.ok(lintGCode(noEnd).some((d) => d.id === GCodeErrorCode.MISSING_PROGRAM_END.id));

  const noSpindleSpeed = "O1011\nG21 G90\nM03\nM30";
  assert.ok(lintGCode(noSpindleSpeed).some((d) => d.id === GCodeErrorCode.MISSING_SPINDLE_SPEED.id));

  const badG83 = "O1012\nG21 G90\nS4000 M03\nG83 X10 Y10 Z-20 R2 F150\nG80\nM30";
  assert.ok(lintGCode(badG83).some((d) => d.id === GCodeErrorCode.INVALID_CANNED_CYCLE_PARAMS.id));

  const unbalancedComp = "O1013\nG21 G90\nS8000 M03\nG41 D1\nG01 X20 F500\nM30";
  assert.ok(lintGCode(unbalancedComp).some((d) => d.id === GCodeErrorCode.UNBALANCED_CUTTER_COMP.id));

  const dupWord = "O1014\nG21 G90\nS8000 M03\nG01 X10 X20 F500\nM30";
  assert.ok(lintGCode(dupWord).some((d) => d.id === GCodeErrorCode.DUPLICATE_WORD_IN_BLOCK.id));
});
