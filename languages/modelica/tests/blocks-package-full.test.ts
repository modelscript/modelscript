// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasmPath = path.resolve(__dirname, "../dist/parser.wasm");

describe("Modelica.Blocks Package Indexing and Loading", async () => {
  it("parses and indexes Modelica.Blocks package from standard library", async () => {
    const { parser } = await createWasmParser(modelicaWasmPath);
    Context.registerParser(".mo", parser);

    const filePath = path.resolve(
      __dirname,
      "../../../data/libraries/Modelica/4.1.0/extracted/Modelica/Blocks/package.mo",
    );
    if (!fs.existsSync(filePath)) {
      return; // Skip if local MSL data not extracted
    }

    const source = fs.readFileSync(filePath, "utf-8");
    const nfs = new NodeFileSystem();
    const context = new Context(nfs);

    const tree = context.parse(".mo", source);
    assert.ok(tree.rootNode, "Parser should produce a valid rootNode");
    assert.strictEqual(tree.rootNode.type, "source_file");
    assert.ok(tree.rootNode.namedChildren.length > 0, "Root node should have named children");

    const blocksDir = path.dirname(filePath);
    await context.addLibrary(blocksDir);

    const symbols = context.queryEngine.index;
    assert.ok(symbols.symbols.size > 0, "Symbols index should contain declarations from Blocks");

    const continuousFound = Array.from(symbols.symbols.values()).some(
      (s) => s.name?.includes("Continuous") || s.name?.includes("Filter") || s.name?.includes("PID"),
    );
    assert.ok(continuousFound, "Should find Blocks package symbols in index");
  });
});
