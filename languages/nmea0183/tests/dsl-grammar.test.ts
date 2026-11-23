// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { nmea0183Language } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

describe("@modelscript/nmea0183 WASM GLR DSL Grammar Suite", () => {
  it("defines declarative NMEA 0183 language spec with UI panel metadata", () => {
    assert.strictEqual(nmea0183Language.name, "nmea0183");
    assert.strictEqual(nmea0183Language.maturity, "beta");
    assert.ok(nmea0183Language.fileExtensions?.includes(".nmea"));
    assert.ok(nmea0183Language.ui?.panels?.some((p) => p.entry.includes("Nmea0183Panel.tsx")));
    assert.ok(nmea0183Language.rules["Stream"]);
    assert.ok(nmea0183Language.rules["Sentence"]);
    assert.ok(nmea0183Language.rules["SentenceHeader"]);
    assert.ok(nmea0183Language.rules["Checksum"]);
  });

  it("compiles NMEA 0183 grammar via buildParser into AssemblyScript GLR kernel and JS wrapper", () => {
    const result = buildParser(nmea0183Language);
    assert.ok(result, "buildParser should return compilation result");
    assert.ok(result.assemblyScriptFiles.length > 0, "Should emit AssemblyScript files");
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile && parserFile.content.length > 0, "Should generate parser.ts");
    assert.ok(result.javascriptWrapper && result.javascriptWrapper.js.length > 0, "Should generate JS wrapper");
  });

  it("materializes dist/parser.wasm and src-gen/bindings.{js,d.ts}", () => {
    assert.ok(fs.existsSync(path.join(pkgRoot, "dist", "parser.wasm")), "dist/parser.wasm should exist");
    assert.ok(fs.existsSync(path.join(pkgRoot, "src-gen", "bindings.js")), "src-gen/bindings.js should exist");
    assert.ok(fs.existsSync(path.join(pkgRoot, "src-gen", "bindings.d.ts")), "src-gen/bindings.d.ts should exist");
  });
});
