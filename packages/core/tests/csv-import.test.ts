import CSV from "@modelscript/csv/parser";
import Modelica from "@modelscript/modelica/parser";
import { promises as fs } from "fs";
import { join } from "path";
import Parser from "tree-sitter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Context } from "../src/compiler/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

// Register parsers
const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

const csvParser = new Parser();
csvParser.setLanguage(CSV);
Context.registerParser(".csv", csvParser);

describe("CSV to Tree-Sitter & Salsa Parser Migration", () => {
  const tempDir = join(__dirname, "csv_test_temp");

  beforeAll(async () => {
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

  afterAll(async () => {
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
    expect(list.some((uri) => uri.endsWith("package.mo"))).toBe(true);
    expect(list.some((uri) => uri.endsWith("testdata.csv"))).toBe(true);
    expect(list.some((uri) => uri.endsWith("ModelUsingCsv.mo"))).toBe(true);

    // Flatten using the target arena-native pipeline
    const arena = ctx.flattenArena("ModelUsingCsv") || ctx.flattenArena("csv_test_temp.ModelUsingCsv");
    expect(arena).not.toBeNull();
    if (!arena) throw new Error("Arena is null");

    // Spot-check variables and values
    // r = testdata.numRows (should be 3)
    const rIdx = arena.getVarIdxByName("r");
    expect(rIdx).toBeGreaterThanOrEqual(0);
    expect(arena.getVarStartValue(rIdx)).toBe(3);

    // c = testdata.numCols (should be 3)
    const cIdx = arena.getVarIdxByName("c");
    expect(cIdx).toBeGreaterThanOrEqual(0);
    expect(arena.getVarStartValue(cIdx)).toBe(3);

    // Let's check how arrays are represented
    for (let i = 1; i <= 3; i++) {
      const xIdx = arena.getVarIdxByName(`x_val[${i}]`);
      expect(xIdx).toBeGreaterThanOrEqual(0);
      expect(arena.getVarStartValue(xIdx)).toBe(i);

      const yIdx = arena.getVarIdxByName(`y_val[${i}]`);
      expect(yIdx).toBeGreaterThanOrEqual(0);
      expect(arena.getVarStartValue(yIdx)).toBe(i * 2);
    }
  });
});
