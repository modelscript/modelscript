// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGCodeCleanroomSchemas,
  ensureBuiltInGCodeLibraryRegistered,
  getGCodeSchemasFromLibraries,
  instantiateGCodeWasmModel,
  lookupGCodeSchema,
} from "../src/index.js";

test("G-code Stdlib: registers @modelscript/gcode-std-lib in globalLibraryRegistry", () => {
  ensureBuiltInGCodeLibraryRegistered();
  const pkgs = globalLibraryRegistry.getPackagesForLanguage("gcode");
  assert.ok(pkgs.length >= 1, "Expected at least one registered gcode library package");

  const pkg = pkgs[0]!;
  assert.ok(pkg.symbols.length >= 15, `Expected >= 15 symbols, got ${pkg.symbols.length}`);
  assert.ok(pkg.diagrams.length >= 15);
  assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 100, "Expected non-empty runtime.wasm bytes");

  const schemas = getGCodeSchemasFromLibraries();
  const built = buildGCodeCleanroomSchemas();
  assert.equal(schemas.length, built.length);
});

test("G-code Stdlib: lookupGCodeSchema resolves canonical codes, aliases, and gcode. prefixes", () => {
  const g01 = lookupGCodeSchema("G01");
  assert.ok(g01);
  assert.equal(g01.name, "G01");

  const g1Alias = lookupGCodeSchema("g1");
  assert.ok(g1Alias);
  assert.equal(g1Alias.name, "G01");

  const prefixed = lookupGCodeSchema("gcode.G83");
  assert.ok(prefixed);
  assert.equal(prefixed.name, "G83");

  const preset = lookupGCodeSchema("ENDMILL_CARBIDE_AL");
  assert.ok(preset);
  assert.equal(preset.category, "Cutting Tool Presets");
  assert.ok(preset.parameters.length >= 5);

  assert.equal(lookupGCodeSchema("NONEXISTENT_CODE"), undefined);
});

test("G-code Stdlib: WASM runtime kernel executes motion and cutting tool preset archetypes", () => {
  // G02 circular arc: F=400, R=25, sweep=90 deg, dZ=0
  const g02 = instantiateGCodeWasmModel("G02");
  assert.ok(g02);
  const arcOut = g02.step([400, 25, 90, 0]);
  const expArcLen = 25 * (Math.PI / 2);
  assert.ok(Math.abs(arcOut.pathLengthMm - expArcLen) < 1e-6);
  assert.ok(Math.abs(arcOut.cycleTimeSec - (expArcLen / 400) * 60) < 1e-6);

  // G04 dwell: P=2.5s
  const g04 = instantiateGCodeWasmModel("G04");
  assert.ok(g04);
  const dwellOut = g04.step([2.5]);
  assert.equal(dwellOut.pathLengthMm, 0);
  assert.equal(dwellOut.cycleTimeSec, 2.5);

  // ENDMILL_CARBIDE_AL: D=10, z=3, Vc=300, fz=0.06, kc=700, ap=5, ae=5
  const mill = instantiateGCodeWasmModel("ENDMILL_CARBIDE_AL");
  assert.ok(mill);
  const millOut = mill.step([10, 3, 300, 0.06, 700, 5, 5], 1.0);
  const expRpm = (1000 * 300) / (Math.PI * 10);
  const expFeed = expRpm * 3 * 0.06;
  const expMrr = (5 * 5 * expFeed) / 60;
  const expPower = 700 * expMrr * 1e-3;
  assert.ok(Math.abs(millOut.spindleRpm - expRpm) / expRpm < 1e-6);
  assert.ok(Math.abs(millOut.feedrateMmPerMin - expFeed) / expFeed < 1e-6);
  assert.ok(Math.abs(millOut.mrrMm3PerSec - expMrr) / expMrr < 1e-6);
  assert.ok(Math.abs(millOut.cuttingPowerW - expPower) / expPower < 1e-6);
  assert.ok(millOut.spindleTorqueNm > 0);

  // DRILL_CARBIDE_STEEL
  const drill = instantiateGCodeWasmModel("DRILL_CARBIDE_STEEL");
  assert.ok(drill);
  const drillOut = drill.step();
  assert.ok(drillOut.spindleRpm > 0);
  assert.ok(drillOut.mrrMm3PerSec > 0);
  assert.ok(drillOut.cuttingPowerW > 0);
});
