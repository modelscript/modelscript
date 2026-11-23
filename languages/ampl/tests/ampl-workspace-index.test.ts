// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { amplLanguage, getAmplData, getAmplModel } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

const SAMPLE_MOD = `# Production planning model
set PRODUCTS;
param profit {PRODUCTS} >= 0;
var produce {p in PRODUCTS} >= 0;
maximize TotalProfit: sum {p in PRODUCTS} profit[p] * produce[p];
subject to Capacity: sum {p in PRODUCTS} produce[p] <= 100;
`;

const SAMPLE_DAT = `set PRODUCTS := A B C;
param profit := A 10 B 20 C 30;
`;

describe("AMPL UnifiedWorkspace CST-First Indexing", () => {
  it("indexes .mod and .dat declarations with exact CST spans and fieldRanges", async () => {
    const { parser } = await createWasmParser(fs.readFileSync(wasmPath));
    const modTree = parser.parse(SAMPLE_MOD);
    const datTree = parser.parse(SAMPLE_DAT);
    assert.ok(modTree?.rootNode);
    assert.equal(modTree.rootNode.hasError, false);
    assert.ok(datTree?.rootNode);
    assert.equal(datTree.rootNode.hasError, false);

    const ws = new UnifiedWorkspace(amplLanguage);
    ws.indexDocumentText("file:///workspace/prod.mod", SAMPLE_MOD, "ampl", modTree);
    ws.indexDocumentText("file:///workspace/prod.dat", SAMPLE_DAT, "ampl", datTree);

    assert.ok(getAmplModel(ws, "file:///workspace/prod.mod"));
    assert.ok(getAmplData(ws, "file:///workspace/prod.dat"));

    const modIdx = ws.getFileIndex("file:///workspace/prod.mod")!;
    for (const symName of ["PRODUCTS", "profit", "produce", "TotalProfit", "Capacity"]) {
      const sym = Array.from(modIdx.symbols.values()).find((s) => s.name === symName);
      assert.ok(sym, `Expected symbol '${symName}' in .mod index`);
      const nameRange = sym.fieldRanges?.["name"];
      assert.ok(nameRange, `Expected fieldRanges.name on '${symName}'`);
      assert.equal(SAMPLE_MOD.slice(nameRange.startOffset, nameRange.endOffset), symName);
      assert.ok(sym.endOffset > sym.startOffset);
    }

    const datIdx = ws.getFileIndex("file:///workspace/prod.dat")!;
    for (const symName of ["PRODUCTS", "profit"]) {
      const sym = Array.from(datIdx.symbols.values()).find((s) => s.name === symName);
      assert.ok(sym, `Expected symbol '${symName}' in .dat index`);
      const nameRange = sym.fieldRanges?.["name"];
      assert.ok(nameRange, `Expected fieldRanges.name on '${symName}'`);
      assert.equal(SAMPLE_DAT.slice(nameRange.startOffset, nameRange.endOffset), symName);
    }
  });

  it("falls back gracefully when no CST is passed or CST has errors", () => {
    const ws = new UnifiedWorkspace(amplLanguage);
    ws.setDocument("file:///workspace/plain.mod", SAMPLE_MOD);
    const plainIdx = ws.getFileIndex("file:///workspace/plain.mod")!;
    assert.ok(plainIdx.byName.has("PRODUCTS"));
    assert.ok(plainIdx.byName.has("TotalProfit"));

    const errorTree = { rootNode: { type: "Document", hasError: true, children: [] } };
    ws.indexDocumentText("file:///workspace/err.mod", SAMPLE_MOD, "ampl", errorTree);
    const errIdx = ws.getFileIndex("file:///workspace/err.mod")!;
    assert.ok(errIdx.byName.has("Capacity"));
  });
});
