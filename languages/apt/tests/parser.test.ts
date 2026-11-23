// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseAptProgram } from "../src/index.js";

test("APT Parser: parses header directives, geometry definitions, continuous-path motion, and FINI", () => {
  const source = [
    "$$ MIT APT III Sample Contour Program",
    "PARTNO BRACKET CONTOUR 1961",
    "MACHIN / MILL, 1",
    "UNITS / INCHES",
    "INTOL / 0.0005",
    "OUTTOL / 0.001",
    "CUTTER / 0.5",
    "SPINDL / 1800, CLW",
    "FEDRAT / 12.0",
    "COOLNT / FLOOD",
    "SETPT = POINT / -1.0, -1.0, 0.0",
    "P1 = POINT / 0.0, 0.0, 0.0",
    "P2 = POINT / 4.0, 0.0, 0.0",
    "P3 = POINT / 4.0, 3.0, 0.0",
    "P4 = POINT / 0.0, 3.0, 0.0",
    "L1 = LINE / P1, P2",
    "L2 = LINE / P2, P3",
    "L3 = LINE / P3, P4",
    "L4 = LINE / P4, P1",
    "PL1 = PLANE / 0, 0, 1, 0",
    "C1 = CIRCLE / CENTER, P2, $",
    "              RADIUS, 0.75",
    "PAT1 = PATERN / LINEAR, P1, P2, 4",
    "FROM / SETPT",
    "RAPID",
    "GOTO / P1",
    "GO / TO, L1, TO, PL1, TO, L4",
    "GORGT / L1, PAST, L2",
    "GOLFT / L2, PAST, L3",
    "GOLFT / L3, PAST, L4",
    "GOLFT / L4, PAST, L1",
    "GODLTA / 0.0, 0.0, 1.0",
    "COOLNT / OFF",
    "SPINDL / OFF",
    "FINI",
  ].join("\n");

  const prog = parseAptProgram(source);
  assert.equal(prog.parseErrors.length, 0);
  assert.equal(prog.partno, "BRACKET CONTOUR 1961");
  assert.equal(prog.machin, "MILL, 1");
  assert.equal(prog.units, "INCHES");
  assert.equal(prog.intol, 0.0005);
  assert.equal(prog.outtol, 0.001);
  assert.equal(prog.hasFini, true);

  // Verify geometries including multi-line `$` continuation for C1
  assert.equal(prog.geometries.size, 12);
  const c1 = prog.geometries.get("C1");
  assert.ok(c1);
  assert.equal(c1.geometryKind, "CIRCLE");
  assert.deepEqual(c1.args, ["CENTER", "P2", "RADIUS", "0.75"]);
  assert.equal(c1.endLine, c1.line + 1);

  const pat1 = prog.geometries.get("PAT1");
  assert.ok(pat1);
  assert.equal(pat1.geometryKind, "PATERN");
  assert.deepEqual(pat1.args, ["LINEAR", "P1", "P2", "4"]);

  const motionStmts = prog.statements.filter((s) => s.stmtKind === "motion");
  assert.equal(motionStmts.length, 8);
  assert.equal(motionStmts[0]?.keyword, "FROM");
  assert.equal(motionStmts[1]?.keyword, "GOTO");
  assert.equal(motionStmts[2]?.keyword, "GO");
  assert.equal(motionStmts[7]?.keyword, "GODLTA");
});

test("APT Parser: supports metric units (MM) and parenthesized nested arguments", () => {
  const source = [
    "PARTNO METRIC PLATE",
    "UNITS / MM",
    "CUTTER / 10.0",
    "FROM / 0, 0, 10",
    "GOTO / (POINT / 25, 15, 0)",
    "FINI",
  ].join("\n");

  const prog = parseAptProgram(source);
  assert.equal(prog.parseErrors.length, 0);
  assert.equal(prog.units, "MM");
  const gotoStmt = prog.statements.find((s) => s.stmtKind === "motion" && s.keyword === "GOTO");
  assert.ok(gotoStmt);
  assert.deepEqual(gotoStmt.args, ["(POINT / 25, 15, 0)"]);
});

test("APT Parser: reports structured parse errors for invalid syntax and unknown keywords", () => {
  const source = [
    "PARTNO BAD PROGRAM",
    "UNITS / FURLONGS",
    "X1 = HYPERBOLA / 1, 2, 3",
    "FOOBAR / 1, 2",
    "GARBAGE STATEMENT",
    "FINI",
  ].join("\n");

  const prog = parseAptProgram(source);
  assert.equal(prog.parseErrors.length, 4);
  assert.ok(prog.parseErrors[0]?.message.includes("Unknown UNITS"));
  assert.ok(prog.parseErrors[1]?.message.includes("Unknown geometry type"));
  assert.ok(prog.parseErrors[2]?.message.includes("Unrecognized APT keyword"));
  assert.ok(prog.parseErrors[3]?.message.includes("Unrecognized APT statement"));
});
