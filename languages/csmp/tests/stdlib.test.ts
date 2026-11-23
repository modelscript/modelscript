// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CSMP_BLOCK_SPECS,
  getCsmpSchemasFromLibraries,
  instantiateCsmpWasmBlock,
  lookupCsmpBlockSchema,
  registerBuiltInCsmpLibrarySync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/csmp-std-lib");

describe("@modelscript/csmp — Cleanroom Standard Library (@modelscript/csmp-std-lib)", () => {
  it("loads @modelscript/csmp-std-lib via modelscript.yaml with all 12 blocks, SVG icons, and runtime.wasm", async () => {
    const manifestPath = path.join(STD_LIB_DIR, "modelscript.yaml");
    assert.ok(fs.existsSync(manifestPath), "Expected csmp-std-lib/modelscript.yaml");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/csmp-std-lib");
    assert.equal(pkg.manifest.language, "csmp");
    assert.equal(pkg.symbols.length, 12);
    assert.equal(pkg.diagrams.length, 12);
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm");

    for (const diag of pkg.diagrams) {
      assert.ok(diag.svg && diag.svg.startsWith("<svg"), `Expected SVG icon for ${diag.namePath}`);
      assert.ok(diag.ports.length >= 2, `Expected ports for ${diag.namePath}`);
    }
    for (const sym of pkg.symbols) {
      const prov = (sym.metadata as Record<string, unknown> | undefined)?.["provenance"];
      assert.ok(typeof prov === "string" && prov.includes("IBM"), `Expected IBM provenance for ${sym.namePath}`);
    }
  });

  it("supports zero-I/O sync registration and case-insensitive block & alias lookup", () => {
    registerBuiltInCsmpLibrarySync();
    const schemas = getCsmpSchemasFromLibraries();
    assert.ok(schemas.length >= CSMP_BLOCK_SPECS.length);

    const expectedBlocks = [
      "INTGRL",
      "DERIV",
      "DELAY",
      "ZHOLD",
      "REALPL",
      "CMPXPL",
      "LEDLAG",
      "HYSTRS",
      "LIMIT",
      "DEADSP",
      "AFGEN",
      "NLFGEN",
    ];
    for (const b of expectedBlocks) {
      assert.equal(lookupCsmpBlockSchema(b)?.name, b, `Expected schema lookup for ${b}`);
    }
    assert.equal(lookupCsmpBlockSchema("first_order_lag")?.name, "REALPL");
    assert.equal(lookupCsmpBlockSchema("saturation")?.name, "LIMIT");
    assert.equal(lookupCsmpBlockSchema("deadzone")?.name, "DEADSP");
  });

  it("executes INTGRL, REALPL, LIMIT, DEADSP, and AFGEN in compiled runtime.wasm", () => {
    // 1. INTGRL: integrate constant 2.0 from IC = 1.0 over 10 steps of dt = 0.1 -> y = 3.0
    const intgrl = instantiateCsmpWasmBlock("INTGRL", [1.0]);
    assert.ok(intgrl);
    intgrl.init();
    let out = { y: 0, dy: 0 };
    for (let i = 0; i < 10; i++) {
      out = intgrl.step(i * 0.1, 0.1, 2.0);
    }
    assert.ok(Math.abs(out.y - 3.0) < 1e-9, `Expected INTGRL y=3.0, got ${out.y}`);

    // 2. REALPL: 1st-order lag (tau = 1.0, IC = 0.0) step response at t = 1.0 -> 1 - e^-1
    const realpl = instantiateCsmpWasmBlock("REALPL", [0.0, 1.0]);
    assert.ok(realpl);
    realpl.init();
    for (let i = 0; i < 100; i++) {
      out = realpl.step(i * 0.01, 0.01, 1.0);
    }
    const expectedLag = 1.0 - Math.exp(-1.0);
    assert.ok(Math.abs(out.y - expectedLag) < 1e-6, `Expected REALPL y=${expectedLag}, got ${out.y}`);

    // 3. LIMIT: clamp to [-1, 2]
    const limit = instantiateCsmpWasmBlock("LIMIT", [-1.0, 2.0]);
    assert.ok(limit);
    limit.init();
    assert.equal(limit.step(0, 0.01, 5.0).y, 2.0);
    assert.equal(limit.step(0, 0.01, -3.0).y, -1.0);
    assert.equal(limit.step(0, 0.01, 0.5).y, 0.5);

    // 4. DEADSP: dead zone [-1, 1]
    const deadsp = instantiateCsmpWasmBlock("DEADSP", [-1.0, 1.0]);
    assert.ok(deadsp);
    deadsp.init();
    assert.equal(deadsp.step(0, 0.01, 0.5).y, 0.0);
    assert.equal(deadsp.step(0, 0.01, 2.5).y, 1.5);
    assert.equal(deadsp.step(0, 0.01, -2.5).y, -1.5);

    // 5. AFGEN: linear table (0, 0), (1, 10), (2, 30) evaluated at x = 1.5 -> 20
    const afgen = instantiateCsmpWasmBlock("AFGEN", [3, 0, 0, 1, 10, 2, 30]);
    assert.ok(afgen);
    afgen.init();
    assert.ok(Math.abs(afgen.step(0, 0.01, 1.5).y - 20.0) < 1e-9);
  });
});
