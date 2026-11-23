// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { ihexLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("@modelscript/ihex WASM GLR Grammar Suite", () => {
  it("exports ihexLanguage metadata, extensions, and IhexPanel registration", () => {
    assert.equal(ihexLanguage.name, "ihex");
    assert.equal(ihexLanguage.maturity, "beta");
    assert.ok(ihexLanguage.fileExtensions.includes(".hex"));
    assert.ok(ihexLanguage.fileExtensions.includes(".ihx"));
    assert.ok(ihexLanguage.fileExtensions.includes(".ihex"));
    assert.equal(ihexLanguage.ui?.panels?.[0]?.id, "ihexEditor");
    assert.equal(ihexLanguage.ui?.panels?.[0]?.entry, "./src/ui/IhexPanel.tsx");
  });

  it("loads dist/parser.wasm and parses I32HEX records with zero syntax errors", async () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist after build");

    const { parser } = await createWasmParser(wasmPath);
    const sample = [
      ":020000040800F2",
      ":1000000000500020ED000008F5000008F70000082B",
      ":04000005080000ED02",
      ":00000001FF",
    ].join("\n");

    const tree = parser.parse(sample);
    assert.ok(tree, "WASM GLR parser should return a CST");
    assert.equal(
      tree.rootNode.hasError,
      false,
      `Valid Intel HEX should parse without CST errors: ${tree.rootNode.toString()}`,
    );
  });
});
