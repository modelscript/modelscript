// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { dxfLanguage } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

const SAMPLE_DXF = [
  "0",
  "SECTION",
  "2",
  "HEADER",
  "9",
  "$ACADVER",
  "1",
  "AC1027",
  "9",
  "$INSUNITS",
  "70",
  "4",
  "0",
  "ENDSEC",
  "0",
  "SECTION",
  "2",
  "TABLES",
  "0",
  "TABLE",
  "2",
  "LAYER",
  "70",
  "1",
  "0",
  "LAYER",
  "2",
  "OUTLINE",
  "70",
  "0",
  "62",
  "7",
  "6",
  "CONTINUOUS",
  "0",
  "ENDTAB",
  "0",
  "ENDSEC",
  "0",
  "SECTION",
  "2",
  "BLOCKS",
  "0",
  "BLOCK",
  "8",
  "0",
  "2",
  "HOLE_BLK",
  "70",
  "0",
  "10",
  "0.0",
  "20",
  "0.0",
  "30",
  "0.0",
  "0",
  "CIRCLE",
  "8",
  "OUTLINE",
  "10",
  "0.0",
  "20",
  "0.0",
  "40",
  "5.0",
  "0",
  "ENDBLK",
  "0",
  "ENDSEC",
  "0",
  "SECTION",
  "2",
  "ENTITIES",
  "0",
  "LINE",
  "8",
  "OUTLINE",
  "10",
  "0.0",
  "20",
  "0.0",
  "11",
  "50.0",
  "21",
  "0.0",
  "0",
  "LWPOLYLINE",
  "8",
  "OUTLINE",
  "90",
  "3",
  "70",
  "1",
  "10",
  "0.0",
  "20",
  "0.0",
  "10",
  "20.0",
  "20",
  "0.0",
  "10",
  "10.0",
  "20",
  "15.0",
  "0",
  "POLYLINE",
  "8",
  "OUTLINE",
  "70",
  "1",
  "0",
  "VERTEX",
  "10",
  "0.0",
  "20",
  "0.0",
  "0",
  "VERTEX",
  "10",
  "10.0",
  "20",
  "0.0",
  "0",
  "SEQEND",
  "0",
  "INSERT",
  "8",
  "OUTLINE",
  "2",
  "HOLE_BLK",
  "10",
  "25.0",
  "20",
  "10.0",
  "0",
  "ENDSEC",
  "0",
  "EOF",
].join("\n");

describe("DXF DSL grammar & WASM GLR parser", () => {
  it("declares Beta maturity and .dxf extension on dxfLanguage", () => {
    assert.equal(dxfLanguage.name, "dxf");
    assert.equal(dxfLanguage.maturity, "beta");
    assert.deepEqual(dxfLanguage.fileExtensions, [".dxf"]);
    assert.ok(dxfLanguage.indexing);
    assert.ok(dxfLanguage.errorCodes);
  });

  it("parses a multi-section DXF drawing with native parser.wasm without syntax errors", async () => {
    assert.ok(fs.existsSync(wasmPath), `Expected parser.wasm at ${wasmPath}`);
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);

    const tree = parser.parse(SAMPLE_DXF);
    assert.ok(tree);
    assert.equal(tree.rootNode.type, "Document");
    assert.equal(tree.rootNode.hasError, false);

    const sectionTypes = tree.rootNode.namedChildren.map((n) => n.type);
    assert.ok(sectionTypes.includes("Section"));
    assert.ok(sectionTypes.includes("EofMarker"));
  });

  it("detects syntax errors on invalid DXF tokens via parser.wasm", async () => {
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);

    const broken = "0\nSECTION\n2\nUNKNOWN_SECTION_XYZ\n@@@\n";
    const tree = parser.parse(broken);
    assert.ok(tree);
    assert.equal(tree.rootNode.hasError, true);
  });
});
