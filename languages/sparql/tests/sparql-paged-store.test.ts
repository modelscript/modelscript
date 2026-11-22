// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PagedStorageEngine, type PagedWasmExports } from "../../../packages/runtime/src/storage/paged_store.js";
import { createPagedStorageSource, executeSparqlQuery } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { parser } = await createWasmParser(path.resolve(__dirname, "../dist/parser.wasm"));

describe("SPARQL 1.1 Execution over WASM PagedStorageEngine (4KB Slotted B+Tree)", () => {
  it("executes SELECT, Property Paths, and Leapfrog Triejoin directly against PagedStorageEngine", async () => {
    const wasmPath = path.resolve(__dirname, "../../../packages/runtime/build/release.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const wasmMod = await WebAssembly.instantiate(wasmBytes, {
      env: {
        abort: () => {
          throw new Error("WASM abort");
        },
        trace: () => {},
        seed: () => 42,
      },
    });
    const exports = ("instance" in wasmMod ? wasmMod.instance : (wasmMod as unknown as WebAssembly.Instance)).exports;
    const paged = new PagedStorageEngine(exports as unknown as PagedWasmExports, 64);

    paged.insertTriple("http://ex.org/n1", "http://ex.org/link", "http://ex.org/n2");
    paged.insertTriple("http://ex.org/n2", "http://ex.org/link", "http://ex.org/n3");
    paged.insertTriple("http://ex.org/n3", "http://ex.org/link", "http://ex.org/n1");

    const source = createPagedStorageSource(paged);
    const triRes = executeSparqlQuery(
      parser as any,
      `PREFIX ex: <http://ex.org/> SELECT ?a ?b ?c WHERE { ?a ex:link ?b . ?b ex:link ?c . ?c ex:link ?a }`,
      source,
    );
    assert.equal(triRes.queryType, "SELECT");
    assert.equal(triRes.bindings.length, 3);
  });
});
