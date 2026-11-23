// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import { gcodeToDae, lowerGCodeToDae, simulateToolpath, toolpathToCad } from "../src/index.js";

test("G-code Toolpath Simulation: rapid, linear, arcs (I/J and R), dwell, subprograms, and canned drilling", () => {
  const program = [
    "O2000",
    "G21 G90 G17 G54",
    "T1 M06",
    "S10000 M03",
    "G00 X0 Y0 Z10",
    "G01 Z-2 F300",
    "G01 X40 Y0 F600",
    "G03 X40 Y20 R10",
    "G04 P1.5",
    "G00 Z10",
    "G81 X10 Y10 Z-10 R2 F200",
    "X20 Y10",
    "G80",
    "G28 Z0",
    "M30",
  ].join("\n");

  const summary = simulateToolpath(program, { rapidRateMmPerMin: 12000 });
  assert.equal(summary.programName, "O2000");
  assert.equal(summary.unitMode, "G21");
  assert.deepEqual(summary.toolChanges, [1]);
  assert.equal(summary.spindleRpmMax, 10000);
  assert.equal(summary.feedrateMaxMmPerMin, 600);
  assert.equal(summary.holeCount, 2);
  assert.ok(Math.abs(summary.dwellTimeSec - 1.5) < 1e-9);
  assert.ok(summary.cuttingLengthMm > 0);
  assert.ok(summary.rapidLengthMm > 0);
  assert.ok(summary.totalCycleTimeSec > 1.5);
  assert.equal(summary.finalPosition.z, 0);

  const arcSeg = summary.segments.find((s) => s.kind === "arc_ccw");
  assert.ok(arcSeg);
  assert.ok(Math.abs((arcSeg.radiusMm ?? 0) - 10) < 1e-6);
  assert.ok(Math.abs(arcSeg.lengthMm - Math.PI * 10) < 1e-6);
});

test("G-code CAD Lowering: toolpathToCad produces swept volume solids and machined stock assembly", () => {
  const program = [
    "O2001",
    "G21 G90 G17",
    "S12000 M03",
    "G00 X10 Y10 Z5",
    "G01 Z-4 F300",
    "G01 X50 Y10 F800",
    "G03 X50 Y30 I0 J10",
    "G01 X10 Y30",
    "G00 Z5",
    "M30",
  ].join("\n");

  const summary = simulateToolpath(program);
  const toolDiameterMm = 6.0;
  const cad = toolpathToCad(summary, {
    toolDiameterMm,
    arcSubdivisionsPerQuarter: 4,
    stock: { sizeX: 80, sizeY: 50, sizeZ: 20, originX: 0, originY: 0, originZ: -20 },
  });

  assert.equal(cad.assembly.name, "O2001_cad");
  assert.ok(cad.solids.length >= 10, `Expected >= 10 swept capsule solids, got ${cad.solids.length}`);
  assert.ok(cad.sweptSolid);
  assert.ok(cad.machinedStock);
  assert.equal(cad.assembly.parts.length, 2);

  // Estimated swept volume = pi * r^2 * cuttingLengthMm
  const expectedVol = Math.PI * (toolDiameterMm / 2) ** 2 * summary.cuttingLengthMm;
  assert.ok(Math.abs(cad.estimatedSweptVolumeMm3 - expectedVol) / expectedVol < 1e-9);
});

test("G-code DAE Lowering: gcodeToDae and lowerGCodeToDae build linear-memory machining physics arena", () => {
  const program = ["O2002", "G21 G90", "S9549 M03", "G00 X0 Y0 Z5", "G01 Z-5 F600", "G01 X100 Y0 F1200", "M30"].join(
    "\n",
  );

  const builder = new DAEBuilder(undefined, "O2002");
  const res = lowerGCodeToDae(builder, program, {
    toolPreset: "ENDMILL_CARBIDE_AL",
    spindleEfficiency: 0.85,
  });

  assert.equal(res.equationCount, 7);
  assert.equal(res.stateVarIndices.length, 2);
  assert.equal(builder.getEqCount(), 7);
  assert.ok(builder.getVarCount() >= 16);
  assert.ok(res.variableMap.has("mrr_mm3_s"));
  assert.ok(res.variableMap.has("cutting_power_w"));
  assert.ok(res.variableMap.has("spindle_torque_nm"));
  assert.ok(res.variableMap.has("removed_volume_mm3"));
  assert.ok(res.variableMap.has("cutting_energy_j"));

  // Sanity-check positive physics metrics
  assert.ok(res.metrics.mrrMm3PerSec > 0);
  assert.ok(res.metrics.cuttingPowerW > 0);
  assert.ok(res.metrics.spindlePowerW > res.metrics.cuttingPowerW);
  assert.ok(res.metrics.spindleTorqueNm > 0);
  assert.ok(res.metrics.totalRemovedVolumeMm3 > 0);
  assert.ok(res.metrics.totalCuttingEnergyJ > 0);

  // Convenience wrapper gcodeToDae
  const dae = gcodeToDae(program, { modelName: "PocketCut" });
  assert.equal(dae.getEqCount(), 7);
  assert.ok(dae.getVarCount() >= 16);
});
