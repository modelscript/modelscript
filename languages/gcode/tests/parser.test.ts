// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGCodeExpression, normalizeGMCode, parseGCode } from "../src/index.js";

test("G-code Parser: normalizeGMCode canonicalizes ISO 6983 G/M words", () => {
  assert.equal(normalizeGMCode("g", 0), "G00");
  assert.equal(normalizeGMCode("G", 1), "G01");
  assert.equal(normalizeGMCode("G", 21), "G21");
  assert.equal(normalizeGMCode("m", 3), "M03");
  assert.equal(normalizeGMCode("M", 30), "M30");
  assert.equal(normalizeGMCode("G", 54.1), "G54.1");
  assert.equal(normalizeGMCode("G", Number.NaN), "G?");
});

test("G-code Parser: parses header, tape markers, line numbers, comments, and modal words", () => {
  const source = [
    "%",
    "O1001 (POCKET DEMO)",
    "N10 G21 G90 G17 G54 ; Metric absolute XY",
    "N20 T1 M6",
    "N30 S12000 M3",
    "N40 G0 X0 Y0 Z10",
    "/N50 G0 Z5 (optional block delete)",
    "N60 G1 Z-2 F400",
    "N70 X50 Y25",
    "N80 M30",
    "%",
  ].join("\n");

  const prog = parseGCode(source);
  assert.equal(prog.parseErrors.length, 0);
  assert.equal(prog.programNumber, 1001);
  assert.equal(prog.name, "O1001");
  assert.ok(prog.blocks.length >= 9);

  // Tape markers
  assert.equal(prog.blocks[0]?.isTapeMarker, true);
  assert.equal(prog.blocks[prog.blocks.length - 1]?.isTapeMarker, true);

  // Line 3: N10 G21 G90 G17 G54 ; Metric absolute XY
  const b10 = prog.blocks.find((b) => b.lineNumber === 10);
  assert.ok(b10);
  assert.deepEqual(b10.gCodes, ["G21", "G90", "G17", "G54"]);
  assert.equal(b10.comments.length, 1);
  assert.equal(b10.comments[0]?.kind, "semicolon");

  // Line 4: T1 M6 -> M06
  const b20 = prog.blocks.find((b) => b.lineNumber === 20);
  assert.ok(b20);
  assert.deepEqual(b20.mCodes, ["M06"]);
  assert.equal(b20.words.find((w) => w.letter === "T")?.value, 1);

  // Optional block delete
  const b50 = prog.blocks.find((b) => b.lineNumber === 50);
  assert.ok(b50);
  assert.equal(b50.blockDelete, true);

  // Comments collected across program
  assert.ok(prog.comments.length >= 3);
  assert.equal(prog.comments[0]?.kind, "paren");
});

test("G-code Parser: evaluates RS-274 # parameters and bracketed math expressions", () => {
  const params = new Map<number, number>([
    [100, 10],
    [101, 20],
  ]);

  assert.equal(evaluateGCodeExpression("#100 + #101 * 2", params), 50);
  assert.equal(evaluateGCodeExpression("[#100 + #101] * 2", params), 60);
  assert.ok(Math.abs(evaluateGCodeExpression("SIN[30]", params) - 0.5) < 1e-12);
  assert.ok(Math.abs(evaluateGCodeExpression("COS[60]", params) - 0.5) < 1e-12);
  assert.ok(Math.abs(evaluateGCodeExpression("TAN[45]", params) - 1.0) < 1e-12);
  assert.equal(evaluateGCodeExpression("SQRT[81]", params), 9);
  assert.equal(evaluateGCodeExpression("ABS[-12.5]", params), 12.5);
  assert.equal(evaluateGCodeExpression("ROUND[3.6]", params), 4);
  assert.equal(evaluateGCodeExpression("FIX[-3.7]", params), -3);
  assert.equal(evaluateGCodeExpression("FUP[3.1]", params), 4);
  assert.equal(evaluateGCodeExpression("17 MOD 5", params), 2);
  assert.ok(Number.isNaN(evaluateGCodeExpression("10 / 0", params)));

  const programSrc = [
    "O1002",
    "#100 = 25.0",
    "#101 = [#100 * 2 + 5]",
    "G21 G90",
    "S8000 M03",
    "G01 X#101 Y[SQRT[144] + #100] F600",
    "M30",
  ].join("\n");

  const prog = parseGCode(programSrc);
  assert.equal(prog.parseErrors.length, 0);
  assert.equal(prog.parameters.get(100), 25);
  assert.equal(prog.parameters.get(101), 55);

  const moveBlock = prog.blocks.find((b) => b.gCodes.includes("G01"));
  assert.ok(moveBlock);
  assert.equal(moveBlock.words.find((w) => w.letter === "X")?.value, 55);
  assert.equal(moveBlock.words.find((w) => w.letter === "Y")?.value, 37);
});

test("G-code Parser: extracts subprograms (Oxxxx ... M99) and records M98 calls", () => {
  const source = [
    "O1000 (MAIN)",
    "G21 G90",
    "S6000 M03",
    "G00 Z10",
    "M98 P2000 L2",
    "M30",
    "O2000 (STEP SUB)",
    "G91",
    "G01 X10 F500",
    "G90",
    "M99",
  ].join("\n");

  const prog = parseGCode(source);
  assert.equal(prog.parseErrors.length, 0);
  assert.equal(prog.programNumber, 1000);
  assert.equal(prog.subprograms.size, 1);

  const sub = prog.subprograms.get(2000);
  assert.ok(sub);
  assert.equal(sub.name, "O2000");
  assert.equal(sub.programNumber, 2000);
  assert.ok(sub.blocks.some((b) => b.mCodes.includes("M99")));
});

test("G-code Parser: recovers from syntax errors and populates parseErrors", () => {
  const badSource = ["O1003", "G21 G90", "G01 X[10 + 5 F300", "G01 @123 Y20", "M30"].join("\n");

  const prog = parseGCode(badSource);
  assert.ok(prog.parseErrors.length >= 2, `Expected >= 2 parse errors, got ${prog.parseErrors.length}`);
  assert.ok(prog.blocks.length >= 4);
});
