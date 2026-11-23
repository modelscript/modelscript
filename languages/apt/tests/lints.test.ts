// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintApt } from "../src/index.js";

test("APT Lints: valid complete APT program produces zero diagnostics", () => {
  const valid = [
    "PARTNO CLEAN CONTOUR",
    "UNITS / INCHES",
    "INTOL / 0.001",
    "OUTTOL / 0.001",
    "CUTTER / 0.5",
    "SPINDL / 1800, CLW",
    "FEDRAT / 12.0",
    "SETPT = POINT / -1, -1, 0",
    "P1 = POINT / 0, 0, 0",
    "P2 = POINT / 4, 0, 0",
    "P3 = POINT / 4, 3, 0",
    "L1 = LINE / P1, P2",
    "L2 = LINE / P2, P3",
    "PL1 = PLANE / 0, 0, 1, 0",
    "FROM / SETPT",
    "GO / TO, L1, TO, PL1, TO, L2",
    "GORGT / L1, PAST, L2",
    "FINI",
  ].join("\n");

  const diags = lintApt(valid);
  assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
});

test("APT Lints: detects APT1001, APT2001, APT2002, APT3001-APT3003, APT4001-APT4002, APT5002-APT5003", () => {
  const faulty = [
    "PARTNO FAULTY PROGRAM",
    "INTOL / 0",
    "OUTTOL / -0.01",
    "SPINDL / 250000, CLW",
    "FEDRAT / -5",
    "P1 = POINT / 0, 0, 0",
    "P1 = POINT / 1, 1, 0",
    "L1 = LINE / P1, P_MISSING",
    "GOTO / P1",
    "CUTTER / 0",
    "BAD_STMT",
  ].join("\n");

  const diags = lintApt(faulty);
  const ids = new Set(diags.map((d) => d.id));

  assert.ok(ids.has("APT1001"), "Expected APT1001 syntax error");
  assert.ok(ids.has("APT2001"), "Expected APT2001 duplicate geometry label");
  assert.ok(ids.has("APT2002"), "Expected APT2002 undefined geometry ref");
  assert.ok(ids.has("APT3001"), "Expected APT3001 invalid cutter diameter");
  assert.ok(ids.has("APT3002"), "Expected APT3002 invalid feed rate");
  assert.ok(ids.has("APT3003"), "Expected APT3003 invalid spindle RPM");
  assert.ok(ids.has("APT4001"), "Expected APT4001 motion before FROM");
  assert.ok(ids.has("APT4002"), "Expected APT4002 motion before CUTTER");
  assert.ok(ids.has("APT5002"), "Expected APT5002 missing FINI");
  assert.ok(ids.has("APT5003"), "Expected APT5003 non-positive tolerance");
});

test("APT Lints: detects geometric solver errors APT5001 (parallel lines) and APT5004 (degenerate geometry)", () => {
  const parallelProg = [
    "PARTNO PARALLEL LINES",
    "CUTTER / 0.5",
    "SPINDL / 1200, CLW",
    "FEDRAT / 10",
    "P1 = POINT / 0, 0, 0",
    "P2 = POINT / 5, 0, 0",
    "P3 = POINT / 0, 2, 0",
    "P4 = POINT / 5, 2, 0",
    "L1 = LINE / P1, P2",
    "L2 = LINE / P3, P4",
    "LDEG = LINE / P1, P1",
    "PL1 = PLANE / 0, 0, 1, 0",
    "FROM / 0, -1, 0",
    "GO / TO, L1, TO, PL1",
    "GORGT / L1, PAST, L2",
    "FINI",
  ].join("\n");

  const diags = lintApt(parallelProg);
  const ids = new Set(diags.map((d) => d.id));
  assert.ok(ids.has("APT5001"), "Expected APT5001 parallel non-intersecting lines");
  assert.ok(ids.has("APT5004"), "Expected APT5004 degenerate line");
});
