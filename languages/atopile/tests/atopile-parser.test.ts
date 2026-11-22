// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseAtoPhysicalValue, parseAtopile } from "../src/parser/atopile-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("@modelscript/atopile — Parser & Physical Units", () => {
  it("parses SI physical values, tolerances, and ranges accurately", () => {
    const r = parseAtoPhysicalValue("10kohm +/- 1%")!;
    assert.strictEqual(r.nominal, 10_000);
    assert.strictEqual(r.unit, "ohm");
    assert.strictEqual(r.tolerancePct, 1);
    assert.strictEqual(r.min, 9900);
    assert.strictEqual(r.max, 10100);

    const v = parseAtoPhysicalValue("3.3V to 3.6V")!;
    assert.strictEqual(v.min, 3.3);
    assert.strictEqual(v.max, 3.6);
    assert.strictEqual(v.unit, "V");

    const c = parseAtoPhysicalValue("100nF")!;
    assert(Math.abs(c.nominal - 1e-7) < 1e-15);
    assert.strictEqual(c.unit, "F");
  });

  it("parses .ato imports, modules, instances, ~ / ~> connections, assignments, and asserts", () => {
    const file = parseAtopile(`
from "generics/resistors.ato" import Resistor

module VoltageDivider:
    signal v_in
    signal v_out
    signal gnd

    r_top = new Resistor
    r_bot = new Resistor
    r_top.resistance = 10kohm +/- 1%
    r_bot.resistance = 10kohm +/- 1%

    v_in ~> r_top ~> v_out
    v_out ~> r_bot ~> gnd

    assert r_top.resistance within 9.5kohm to 10.5kohm
`);
    assert.strictEqual(file.diagnostics.length, 0);
    assert.strictEqual(file.imports.length, 1);
    assert.strictEqual(file.blocks.length, 1);
    const mod = file.blocks[0]!;
    assert.strictEqual(mod.name, "VoltageDivider");
    assert.strictEqual(mod.instances.length, 2);
    assert.strictEqual(mod.connections.length, 2);
    assert.strictEqual(mod.assignments.length, 2);
    assert.strictEqual(mod.assertions.length, 1);
  });

  it("ships a compiled native WebAssembly GLR parser (dist/parser.wasm)", () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    assert(fs.existsSync(wasmPath), "Expected dist/parser.wasm to exist");
    assert(fs.statSync(wasmPath).size > 0);
  });
});
