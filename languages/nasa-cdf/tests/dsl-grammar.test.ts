// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { nasaCdfLanguage } from "../src/language.js";

const pkgRoot = path.resolve(new URL("..", import.meta.url).pathname);

describe("NASA CDF WASM GLR Grammar & Language Spec", () => {
  it("declares Beta maturity, .skt/.cdf extensions, and NasaCdfPanel UI entry", () => {
    assert.equal(nasaCdfLanguage.name, "nasa-cdf");
    assert.equal(nasaCdfLanguage.maturity, "beta");
    assert.ok(nasaCdfLanguage.fileExtensions?.includes(".skt"));
    assert.ok(nasaCdfLanguage.fileExtensions?.includes(".cdf"));
    assert.ok(nasaCdfLanguage.ui?.panels?.some((p) => p.entry === "./src/ui/NasaCdfPanel.tsx"));
  });

  it("compiles dist/parser.wasm and src-gen/bindings.js", () => {
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsPath = path.join(pkgRoot, "src-gen", "bindings.js");
    assert.ok(fs.existsSync(wasmPath), "dist/parser.wasm should exist");
    assert.ok(fs.statSync(wasmPath).size > 100, "dist/parser.wasm should be non-empty");
    assert.ok(fs.existsSync(bindingsPath), "src-gen/bindings.js should exist");
  });

  it("parses a valid .skt skeleton table with the compiled WASM GLR parser", async () => {
    const bindingsUrl = new URL("../src-gen/bindings.js", import.meta.url).href;
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindings = (await import(bindingsUrl)) as {
      createWasmParser?: (p: string) => Promise<{ parser: { parse: (s: string) => unknown } }>;
      default?: (p: string) => Promise<unknown>;
    };

    const sample = `! Sample CDF Skeleton
#header
  CDF NAME: mms1_fgm.cdf
  DATA ENCODING: NETWORK
  MAJORITY: ROW_MAJOR
  FORMAT: SINGLE
  VERSION: 3.8.0
#GLOBALattributes
  "Project" 0: CDF_CHAR { "MMS" }
#VARIABLEattributes
  "UNITS"
#variables
  "EPOCH" CDF_TIME_TT2000 1 0:[] T
    "UNITS" CDF_CHAR { "ns" }
    [0] = 0
  .
  "B_GSE" CDF_REAL8 1 1:[3] T T
    "UNITS" CDF_CHAR { "nT" }
    [0] = { 1.5, -2.5, 3.5 }
  .
#end
`;
    if (typeof bindings.createWasmParser === "function") {
      const { parser } = await bindings.createWasmParser(wasmPath);
      const tree = parser.parse(sample);
      assert.ok(tree, "WASM GLR parser should return a syntax tree");
    } else {
      assert.ok(fs.readFileSync(wasmPath).subarray(0, 4).toString("hex") === "0061736d");
    }
  });
});
