// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { aptIndexing, aptLanguage } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

test("APT DSL Language: metadata, file extensions, and beta maturity", () => {
  assert.equal(aptLanguage.name, "apt");
  assert.equal(aptLanguage.maturity, "beta");
  assert.ok(aptLanguage.fileExtensions.includes(".apt"));
  assert.ok(aptLanguage.fileExtensions.includes(".aptsource"));
  assert.ok(aptLanguage.fileExtensions.includes(".cls"));
  assert.ok(aptLanguage.errorCodes);
  assert.ok(aptLanguage.indexing);
});

test("APT WASM GLR Parser: parses complete APT part program without syntax errors", async () => {
  assert.ok(fs.existsSync(wasmPath), `Expected parser.wasm at ${wasmPath}`);
  const wasmBytes = fs.readFileSync(wasmPath);
  const { parser } = await createWasmParser(wasmBytes);

  const sampleProgram = [
    "$$ MIT APT III Contour Benchmark",
    "PARTNO TEST PLATE 101",
    "MACHIN / MILL, 1",
    "UNITS / INCHES",
    "INTOL / 0.001",
    "OUTTOL / 0.001",
    "CUTTER / 0.5",
    "SPINDL / 1500, CLW",
    "FEDRAT / 10.0",
    "COOLNT / ON",
    "SETPT = POINT / -1.0, -1.0, 0.0",
    "P1 = POINT / 0.0, 0.0, 0.0",
    "P2 = POINT / 5.0, 0.0, 0.0",
    "P3 = POINT / 5.0, 4.0, 0.0",
    "L1 = LINE / P1, P2",
    "L2 = LINE / P2, P3",
    "C1 = CIRCLE / CENTER, P2, $",
    "              RADIUS, 0.5",
    "PL1 = PLANE / 0, 0, 1, 0",
    "FROM / SETPT",
    "RAPID",
    "GO / TO, L1, TO, PL1, TO, L2",
    "GORGT / L1, TANTO, C1",
    "GOFWD / C1, TANTO, L2",
    "GOLFT / L2, PAST, L1",
    "GOTO / (POINT / 0, 0, 1)",
    "FINI",
  ].join("\n");

  const tree = parser.parse(sampleProgram);
  assert.ok(tree);
  assert.equal(tree.rootNode.hasError, false, "Expected zero GLR syntax errors for valid APT program");
  assert.ok(tree.rootNode.text.includes("PARTNO"));
  assert.ok(tree.rootNode.text.includes("FINI"));
});

test("APT Indexing: canIndex and UnifiedWorkspace symbol extraction", () => {
  assert.equal(aptIndexing.canIndex("bracket.apt", ""), true);
  assert.equal(aptIndexing.canIndex("bracket.aptsource", ""), true);
  assert.equal(aptIndexing.canIndex("bracket.cls", ""), true);
  assert.equal(aptIndexing.canIndex("part.txt", "PARTNO DEMO\nP1 = POINT / 0, 0, 0\nFINI"), true);
  assert.equal(aptIndexing.canIndex("notes.txt", "just plain text"), false);

  const ws = new UnifiedWorkspace();
  ws.registerLanguage(aptLanguage);

  const source = [
    "PARTNO HOUSING_CAP",
    "UNITS / MM",
    "CUTTER / 10.0",
    "P1 = POINT / 0, 0, 0",
    "P2 = POINT / 50, 0, 0",
    "L1 = LINE / P1, P2",
    "C1 = CIRCLE / CENTER, P2, RADIUS, 10",
    "FROM / P1",
    "GOTO / P2",
    "FINI",
  ].join("\n");

  ws.indexDocumentText("file:///workspace/housing.apt", source);

  const rootSymbols = ws.findSymbolsByName("HOUSING_CAP");
  assert.ok(rootSymbols.length >= 1, "Expected root program symbol HOUSING_CAP");
  assert.equal(rootSymbols[0]?.kind, "Package");

  const p1Syms = ws.findSymbolsByName("P1");
  assert.ok(p1Syms.length >= 1, "Expected geometry symbol P1");
  assert.equal(p1Syms[0]?.kind, "Variable");

  const c1Syms = ws.findSymbolsByName("C1");
  assert.ok(c1Syms.length >= 1, "Expected geometry symbol C1");

  const cutterSyms = ws.findSymbolsByName("CUTTER_1");
  assert.ok(cutterSyms.length >= 1, "Expected CUTTER_1 setup symbol");
});
