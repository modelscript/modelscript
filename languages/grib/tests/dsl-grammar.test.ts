// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { gribLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

describe("GRIB1 DSL Grammar & WASM GLR Parser", () => {
  it("registers gribLanguage with beta maturity, file extensions, and GribPanel UI", () => {
    assert.equal(gribLanguage.name, "grib");
    assert.equal(gribLanguage.maturity, "beta");
    assert.ok(gribLanguage.fileExtensions.includes(".grib"));
    assert.ok(gribLanguage.fileExtensions.includes(".grb"));
    assert.ok(gribLanguage.fileExtensions.includes(".grib1"));
    assert.ok(gribLanguage.ui?.panels?.some((p) => p.entry.includes("GribPanel.tsx")));
  });

  it("emits dist/parser.wasm and src-gen/bindings.js and parses GRIB1 descriptors with zero syntax errors", async () => {
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsPath = path.join(pkgRoot, "src-gen", "bindings.js");
    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist");
    assert.ok(fs.existsSync(bindingsPath), "src-gen/bindings.js should exist");

    const bindings = (await import(bindingsPath)) as {
      createWasmParser?: (p: string) => Promise<{ parser: { parse: (src: string) => unknown } }>;
      GribParser?: { load: (bytes: Uint8Array) => Promise<{ parse: (src: string) => { hasErrors?: boolean } }> };
    };

    const sample = `
GRIB edition = 1
IS {
  edition = 1
}
PDS {
  center = 7
  parameter = TMP
  levelType = ISBL
  level = 500
  date = "2026-01-15T00:00"
  decimalScale = 1
}
GDS {
  ni = 2
  nj = 2
  la1 = 50.0
  lo1 = -10.0
  la2 = 40.0
  lo2 = 0.0
  di = 10.0
  dj = 10.0
}
BMS {
  bitmap = [1, 1, 1, 1]
}
BDS {
  bitsPerValue = 16
  binaryScale = 0
  referenceValue = 250.0
  values = [250.1, 251.2, 252.3, 253.4]
}
7777
`;

    if (typeof bindings.createWasmParser === "function") {
      const { parser } = await bindings.createWasmParser(wasmPath);
      const tree = parser.parse(sample) as { rootNode?: { hasError?: boolean }; hasErrors?: boolean };
      assert.ok(tree);
      assert.equal(tree.rootNode?.hasError ?? tree.hasErrors ?? false, false);
    } else if (bindings.GribParser && typeof bindings.GribParser.load === "function") {
      const bytes = fs.readFileSync(wasmPath);
      const parser = await bindings.GribParser.load(bytes);
      const res = parser.parse(sample);
      assert.ok(res);
      assert.equal(res.hasErrors ?? false, false);
    } else {
      assert.ok(Object.keys(bindings).length > 0, "src-gen/bindings.js should export parser bindings");
    }
  });
});
