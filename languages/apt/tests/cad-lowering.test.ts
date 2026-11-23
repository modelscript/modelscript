// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import { aptToDae, lowerAptToCad, lowerAptToDae, parseAptProgram, solveAptToClData } from "../src/index.js";

test("APT CAD Lowering: lowers rectangular contour with fillet arc into swept CSG Assembly", () => {
  const source = [
    "PARTNO FILLETED BRACKET",
    "UNITS / MM",
    "CUTTER / 10.0",
    "SPINDL / 6000, CLW",
    "FEDRAT / 600.0",
    "SETPT = POINT / -15, -15, 0",
    "P1 = POINT / 0, 0, 0",
    "P2 = POINT / 60, 0, 0",
    "P3 = POINT / 60, 40, 0",
    "P4 = POINT / 0, 40, 0",
    "L1 = LINE / P1, P2",
    "L2 = LINE / P2, P3",
    "L3 = LINE / P3, P4",
    "L4 = LINE / P4, P1",
    "C1 = CIRCLE / 50, 10, 0, 10",
    "PL1 = PLANE / 0, 0, 1, 0",
    "FROM / SETPT",
    "GO / TO, L1, TO, PL1, TO, L4",
    "GORGT / L1, TANTO, C1",
    "GOFWD / C1, TANTO, L2",
    "GOLFT / L2, PAST, L3",
    "GOLFT / L3, PAST, L4",
    "GOLFT / L4, PAST, L1",
    "FINI",
  ].join("\n");

  const prog = parseAptProgram(source);
  const clData = solveAptToClData(prog);
  assert.equal(clData.errors.length, 0);
  assert.ok(clData.records.some((r) => r.kind === "ARC_CCW" || r.kind === "ARC_CW"));

  const cad = lowerAptToCad(clData, { axialDepth: 8.0, arcSubdivisionsPerQuadrant: 6 });
  assert.equal(cad.assembly.name, "FILLETED BRACKET");
  assert.ok(cad.sweptSegmentCount >= 5);
  assert.ok(cad.assembly.parts.length >= 10);
  assert.ok(cad.estimatedRemovedVolume > 0);
  assert.ok(cad.bounds.max[0] > cad.bounds.min[0]);
  assert.ok(cad.bounds.max[1] > cad.bounds.min[1]);
  assert.ok(cad.bounds.max[2] - cad.bounds.min[2] >= 8.0 - 1e-6);
});

test("APT DAE Lowering: lowers machining physics and ODE states into linear-memory DAEBuilder", () => {
  const source = [
    "PARTNO DAE TEST",
    "UNITS / MM",
    "CUTTER / 12.0",
    "SPINDL / 4000, CLW",
    "FEDRAT / 480.0",
    "FROM / 0, 0, 10",
    "GOTO / 100, 0, 0",
    "FINI",
  ].join("\n");

  const builder = new DAEBuilder(undefined, "AptPhysics");
  const result = lowerAptToDae(builder, source, {
    axialDepthMm: 4.0,
    radialWidthMm: 6.0,
    specificCuttingEnergyNmm2: 750.0,
    spindleEfficiency: 0.85,
  });

  assert.equal(result.equationCount, 8);
  assert.equal(result.stateVarIndices.length, 3);
  assert.ok(result.variableMap.has("mrr_mm3_s"));
  assert.ok(result.variableMap.has("cutting_power_w"));
  assert.ok(result.variableMap.has("spindle_torque_nm"));
  assert.ok(result.variableMap.has("removed_volume_mm3"));
  assert.ok(result.variableMap.has("cutting_energy_j"));
  assert.ok(result.variableMap.has("feed_progress_mm"));
  assert.ok(result.metrics.cuttingPowerW > 0);
  assert.ok(result.metrics.spindleTorqueNm > 0);

  const dae = aptToDae(source);
  assert.ok(dae.varCount >= 18);
  assert.equal(dae.eqCount, 8);
});
