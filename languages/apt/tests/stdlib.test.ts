// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAptCleanroomSchemas,
  ensureBuiltInAptLibraryRegistered,
  getAptSchemasFromLibraries,
  getAptStdLibWasmBytes,
  lookupAptModelSchema,
} from "../src/index.js";

test("APT Stdlib: registers @modelscript/apt-std-lib in globalLibraryRegistry", () => {
  ensureBuiltInAptLibraryRegistered();
  const pkgs = globalLibraryRegistry.getPackagesForLanguage("apt");
  assert.ok(pkgs.length >= 1, "Expected at least one registered apt library package");

  const pkg = pkgs[0]!;
  assert.ok(pkg.symbols.length >= 15, `Expected >= 15 symbols, got ${pkg.symbols.length}`);
  assert.ok(pkg.diagrams.length >= 15);
  assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 100, "Expected non-empty runtime.wasm bytes");

  const schemas = getAptSchemasFromLibraries();
  const built = buildAptCleanroomSchemas();
  assert.equal(schemas.length, built.length);
});

test("APT Stdlib: lookupAptModelSchema resolves canonical names, aliases, and APT. prefixes", () => {
  const pt = lookupAptModelSchema("POINT");
  assert.ok(pt);
  assert.equal(pt.name, "POINT");
  assert.equal(pt.category, "Analytic Geometry");

  const alias = lookupAptModelSchema("goleft");
  assert.ok(alias);
  assert.equal(alias.name, "GOLFT");

  const prefixed = lookupAptModelSchema("APT.CUTTER");
  assert.ok(prefixed);
  assert.equal(prefixed.name, "CUTTER");

  assert.equal(lookupAptModelSchema("NONEXISTENT_ENTITY"), undefined);
});

test("APT Stdlib: WASM runtime kernels execute analytic geometry and machining physics", async () => {
  const wasmBytes = getAptStdLibWasmBytes();
  const { instance } = await WebAssembly.instantiate(wasmBytes);
  const exports = instance.exports as {
    memory: WebAssembly.Memory;
    aptIntersectLines2D: (
      a1: number,
      b1: number,
      c1: number,
      a2: number,
      b2: number,
      c2: number,
      slotPtr: number,
    ) => number;
    aptSignedDistPointLine: (a: number, b: number, c: number, px: number, py: number) => number;
    aptEffectiveArcRadius: (rFillet: number, rCutter: number, side: number) => number;
    aptCuttingPowerWatts: (kc: number, ap: number, ae: number, vf: number) => number;
    aptSpindleTorqueNm: (p: number, rpm: number) => number;
    aptEvalKernel: (archId: number, p0: number, p1: number, p2: number, p3: number) => number;
  };

  // Line 1: y = 2 (0*x + 1*y - 2 = 0), Line 2: x = 3 (1*x + 0*y - 3 = 0) -> (3, 2)
  const slotPtr = 4096;
  const ok = exports.aptIntersectLines2D(0, 1, -2, 1, 0, -3, slotPtr);
  assert.equal(ok, 1);
  const outView = new Float64Array(exports.memory.buffer, slotPtr + 0x100, 2);
  assert.ok(Math.abs(outView[0]! - 3.0) < 1e-9);
  assert.ok(Math.abs(outView[1]! - 2.0) < 1e-9);

  // Parallel lines return 0
  assert.equal(exports.aptIntersectLines2D(0, 1, -2, 0, 1, -5, slotPtr), 0);

  // Signed distance: line y = 0 (a=0, b=1, c=0), point (5, 7) -> 7
  assert.ok(Math.abs(exports.aptSignedDistPointLine(0, 1, 0, 5, 7) - 7.0) < 1e-9);

  // Effective arc radius
  assert.equal(exports.aptEffectiveArcRadius(10, 3, 1), 13);
  assert.equal(exports.aptEffectiveArcRadius(10, 3, -1), 7);
  assert.equal(exports.aptEffectiveArcRadius(2, 5, -1), -1);

  // Cutting power & torque
  const pW = exports.aptCuttingPowerWatts(700, 5, 8, 600);
  assert.ok(Math.abs(pW - 280.0) < 1e-9);
  const tNm = exports.aptSpindleTorqueNm(280.0, 6000);
  assert.ok(Math.abs(tNm - 280.0 / ((2 * Math.PI * 6000) / 60)) < 1e-9);

  // Generic eval kernel
  assert.ok(Math.abs(exports.aptEvalKernel(10, 700, 5, 8, 600) - 280.0) < 1e-9);
  assert.ok(Math.abs(exports.aptEvalKernel(24, 120, 600, 100, 10000) - 12.6) < 1e-9);
});
