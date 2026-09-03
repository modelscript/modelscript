import CSV from "@modelscript/csv/parser";
import { createWasmParser } from "@modelscript/language";
import assert from "node:assert";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import Parser from "tree-sitter";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Register parsers
const modelicaWasm = join(__dirname, "../dist/parser.wasm");
const { parser: modelicaParser } = await createWasmParser(modelicaWasm);
Context.registerParser(".mo", modelicaParser as any);

const csvParser = new Parser();
csvParser.setLanguage(CSV);
Context.registerParser(".csv", csvParser as any);

describe("CSV to Tree-Sitter & Salsa Parser Migration", () => {
  const tempDir = join(__dirname, "csv_test_temp");

  before(async () => {
    // Create temp directory and files
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(
      join(tempDir, "package.mo"),
      `package csv_test_temp
end csv_test_temp;
`,
    );
    await fs.writeFile(
      join(tempDir, "testdata.csv"),
      `time,x,y
0.0,1.0,2.0
1.0,2.0,4.0
2.0,3.0,6.0
`,
    );
    await fs.writeFile(
      join(tempDir, "ModelUsingCsv.mo"),
      `model ModelUsingCsv
  parameter Integer r = testdata.numRows;
  parameter Integer c = testdata.numCols;
  parameter Real x_val[3] = testdata.x;
  parameter Real y_val[3] = testdata.y;
end ModelUsingCsv;
`,
    );
  });

  after(async () => {
    // Clean up temporary files
    try {
      await fs.unlink(join(tempDir, "package.mo"));
      await fs.unlink(join(tempDir, "testdata.csv"));
      await fs.unlink(join(tempDir, "ModelUsingCsv.mo"));
      await fs.rmdir(tempDir);
    } catch {
      // Ignore
    }
  });

  it("should successfully index and flatten CSV data virtual symbols in a Modelica model", async () => {
    const ctx = new Context(new NodeFileSystem());
    await ctx.addLibrary(tempDir);

    // Verify workspace index has the classes
    const list = Array.from(ctx.workspaceIndex.uris);
    assert.strictEqual(
      list.some((uri) => uri.endsWith("package.mo")),
      true,
    );
    assert.strictEqual(
      list.some((uri) => uri.endsWith("testdata.csv")),
      true,
    );
    assert.strictEqual(
      list.some((uri) => uri.endsWith("ModelUsingCsv.mo")),
      true,
    );

    // Flatten using the target arena-native pipeline
    const arena = ctx.flattenArena("ModelUsingCsv") || ctx.flattenArena("csv_test_temp.ModelUsingCsv");
    assert.ok(arena !== null);
    if (!arena) throw new Error("Arena is null");

    // Spot-check variables and values
    // r = testdata.numRows (should be 3)
    const rIdx = arena.getVarIdxByName("r");
    assert.ok(rIdx >= 0);
    assert.strictEqual(arena.getVarStartValue(rIdx), 3);

    // c = testdata.numCols (should be 3)
    const cIdx = arena.getVarIdxByName("c");
    assert.ok(cIdx >= 0);
    assert.strictEqual(arena.getVarStartValue(cIdx), 3);

    // Let's check how arrays are represented
    for (let i = 1; i <= 3; i++) {
      const xIdx = arena.getVarIdxByName(`x_val[${i}]`);
      assert.ok(xIdx >= 0);
      assert.strictEqual(arena.getVarStartValue(xIdx), i);

      const yIdx = arena.getVarIdxByName(`y_val[${i}]`);
      assert.ok(yIdx >= 0);
      assert.strictEqual(arena.getVarStartValue(yIdx), i * 2);
    }
  });
});
