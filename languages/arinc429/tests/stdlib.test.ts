// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARINC429_STANDARD_LABELS,
  buildArinc429CleanroomSchemas,
  getArinc429StdLibWasmBytes,
  lookupStandardArinc429Label,
} from "../src/catalog/index.js";

describe("ARINC 429 Cleanroom Standard Equipment Library", () => {
  it("contains standard ADC (203/205/206/211), IRS (310/311/314/324/325), and LRRA (164) labels", () => {
    const required = ["203", "205", "206", "211", "310", "311", "314", "324", "325", "164"];
    for (const oct of required) {
      const spec = lookupStandardArinc429Label(oct);
      assert.ok(spec, `Expected standard label ${oct} in cleanroom stdlib`);
      assert.strictEqual(spec.labelOctal, oct);
    }
    assert.ok(ARINC429_STANDARD_LABELS.length >= 10);
  });

  it("builds CleanroomModelSchema[] with valid SVG block icons and compiled WASM runtime bytes", () => {
    const schemas = buildArinc429CleanroomSchemas();
    assert.strictEqual(schemas.length, ARINC429_STANDARD_LABELS.length);
    for (const schema of schemas) {
      assert.ok(schema.namePath.startsWith("arinc429:"));
      assert.ok(schema.svg.startsWith("<svg") && schema.svg.endsWith("</svg>"));
      assert.ok(schema.ports.length >= 2);
      assert.ok(schema.parameters.length >= 4);
    }

    const wasmBytes = getArinc429StdLibWasmBytes();
    assert.ok(wasmBytes instanceof Uint8Array);
    assert.ok(wasmBytes.byteLength > 8, "Compiled stdlib runtime.wasm should be non-empty");
    // Check WASM magic header \0asm
    assert.strictEqual(wasmBytes[0], 0x00);
    assert.strictEqual(wasmBytes[1], 0x61);
    assert.strictEqual(wasmBytes[2], 0x73);
    assert.strictEqual(wasmBytes[3], 0x6d);
  });
});
