// SPDX-License-Identifier: AGPL-3.0-or-later

import { createIsolatedWasmInstance, globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGdsiiCleanroomSchemas,
  ensureBuiltInGdsiiLibraryRegistered,
  getGdsiiSchemasFromLibraries,
  getGdsiiStdLibWasmBytes,
  lookupGdsiiSchema,
} from "../src/catalog/index.js";

describe("GDSII Cleanroom CMOS Standard Library (@modelscript/gdsii-std-lib)", () => {
  it("registers CMOS foundry layers (NWELL..METAL2) and standard cells (INV, NAND2)", () => {
    ensureBuiltInGdsiiLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("gdsii");
    assert.ok(pkgs.length >= 1, "gdsii-std-lib must be registered");

    const schemas = getGdsiiSchemasFromLibraries();
    const expectedNames = ["NWELL", "ACTIVE", "POLY", "CONTACT", "METAL1", "VIA1", "METAL2", "INV", "NAND2"];
    for (const name of expectedNames) {
      const found = lookupGdsiiSchema(name);
      assert.ok(found, `Expected cleanroom schema '${name}'`);
      assert.ok(found.svg && found.svg.includes("<svg"), `Expected SVG icon for '${name}'`);
    }
    assert.equal(schemas.length, buildGdsiiCleanroomSchemas().length);
  });

  it("instantiates and executes AssemblyScript WASM parasitic & DRC kernels", () => {
    const wasmBytes = getGdsiiStdLibWasmBytes();
    assert.ok(wasmBytes.length > 0, "runtime.wasm bytes must be non-empty");

    const instance = createIsolatedWasmInstance(wasmBytes);
    assert.ok(instance, "WASM instance must initialize");
    const exports = instance.exports as Record<string, (...args: number[]) => number>;

    // Metal 1: Rs = 0.08 Ohm/sq, L = 100 um, W = 0.5 um => R = 16 Ohms
    const r = exports["gdsiiSheetResistance"]!(0.08, 100.0, 0.5);
    assert.ok(Math.abs(r - 16.0) < 1e-9);

    // Cap: Ca = 0.035 fF/um^2 * 50 um^2 + Cf = 0.045 fF/um * 201 um = 1.75 + 9.045 = 10.795 fF
    const c = exports["gdsiiInterconnectCapFf"]!(0.035, 0.045, 50.0, 201.0);
    assert.ok(Math.abs(c - 10.795) < 1e-9);

    // Elmore delay: 0.5 * 16 * 10.795 * 1e-3 = 0.08636 ps
    const tau = exports["gdsiiElmoreDelayPs"]!(r, c);
    assert.ok(Math.abs(tau - 0.08636) < 1e-9);

    // DRC checks
    assert.equal(exports["gdsiiCheckMinWidth"]!(0.24, 0.24), 1);
    assert.equal(exports["gdsiiCheckMinWidth"]!(0.18, 0.24), 0);
    assert.equal(exports["gdsiiCheckMinSpacing"]!(0.3, 0.24), 1);
    assert.equal(exports["gdsiiCheckMinSpacing"]!(0.2, 0.24), 0);
  });
});
