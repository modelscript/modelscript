// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { gcodeIndexing, gcodeLanguage } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

test("G-code DSL Language: metadata, file extensions, and beta maturity", () => {
  assert.equal(gcodeLanguage.name, "gcode");
  assert.equal(gcodeLanguage.maturity, "beta");
  assert.ok(gcodeLanguage.fileExtensions.includes(".nc"));
  assert.ok(gcodeLanguage.fileExtensions.includes(".gcode"));
  assert.ok(gcodeLanguage.fileExtensions.includes(".ngc"));
  assert.ok(gcodeLanguage.errorCodes);
  assert.ok(gcodeLanguage.indexing);
});

test("G-code WASM GLR Parser: parses complete CNC programs without syntax errors", async () => {
  assert.ok(fs.existsSync(wasmPath), `Expected parser.wasm at ${wasmPath}`);
  const wasmBytes = fs.readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes);

  const sampleProgram = [
    "%",
    "O1010 (3-AXIS POCKET & ARC)",
    "N10 G21 G90 G17 G54",
    "#100 = 20.0",
    "#101 = [#100 + 5.0 * SIN[30]]",
    "N20 T1 M06",
    "N30 S10000 M03",
    "N40 G00 X0 Y0 Z10",
    "N50 G01 Z-3 F300",
    "N60 G01 X#101 Y0 F600",
    "N70 G02 X25 Y25 I0 J25",
    "N80 G81 X10 Y10 Z-12 R2 F180",
    "N90 G80",
    "N100 M05 ; stop spindle",
    "N110 M30",
    "%",
  ].join("\n");

  const tree = parser.parse(sampleProgram);
  assert.ok(tree);
  assert.equal(tree.rootNode.hasError, false, "Expected zero GLR syntax errors for valid RS-274 program");
  assert.ok(tree.rootNode.text.includes("O1010"));
});

test("G-code Indexing: canIndex and UnifiedWorkspace symbol extraction", () => {
  assert.equal(gcodeIndexing.canIndex("part.nc", ""), true);
  assert.equal(gcodeIndexing.canIndex("part.gcode", ""), true);
  assert.equal(gcodeIndexing.canIndex("part.txt", "O1000\nG01 X10 F100\nM30"), true);
  assert.equal(gcodeIndexing.canIndex("notes.txt", "hello world"), false);

  const ws = new UnifiedWorkspace();
  ws.registerLanguage(gcodeLanguage);

  const source = [
    "O4200",
    "G21 G90",
    "T1 M06",
    "S8000 M03",
    "M98 P4201 L2",
    "T2 M06",
    "M30",
    "O4201",
    "G01 X10 F400",
    "M99",
  ].join("\n");

  ws.setDocument("file:///workspace/bracket.nc", source);

  const symbols = ws.findSymbolsByName("O4200");
  assert.ok(symbols.length >= 1, "Expected root program symbol O4200");
  assert.equal(symbols[0]?.kind, "Package");

  const subSymbols = ws.findSymbolsByName("O4201");
  assert.ok(subSymbols.length >= 1, "Expected subprogram symbol O4201");
  assert.equal(subSymbols[0]?.kind, "Function");

  const toolSymbols = ws.findSymbolsByName("T1");
  assert.ok(toolSymbols.length >= 1, "Expected tool symbol T1");
});
