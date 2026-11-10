// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Advanced Parity Verification Suite (Phases 4, 5 & 6)
 *
 * Verifies:
 * 1. Phase 4: Binary ASL .nl (b3) serializer & reader, binary solution reader
 * 2. Phase 5: In-Memory Native C / FFI Solver Bridges (HiGHS, Gurobi, Mosek, CSC Matrix)
 * 3. Phase 6: Extended Connectors (SQLite & Excel), Interactive REPL Shell, Metamodeling & Linting (M9511, M9512)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import {
  AmplErrorCode,
  AmplRepl,
  buildNativeCscMatrix,
  instantiateAmpl,
  lintAmpl,
  parseAmplData,
  parseAmplModel,
  probeNativeSolverLibrary,
  readAmplTable,
  readBinaryNlProblem,
  readBinarySolResult,
  solveAmpl,
  solveWithNativeFfi,
  writeAmplTable,
  writeBinaryNlProblem,
} from "../src/index.js";

describe("languages/ampl: Phase 4 — Binary ASL .nl (b3) Serializer & Reader", () => {
  it("serializes and deserializes an optimization problem in binary ASL (b3) format without precision loss", () => {
    const modSrc = `
      var x >= 0, <= 10;
      var y >= 1.5, <= 8.5;
      var z binary;

      minimize Cost: 3.5 * x + 2.25 * y - 5.0 * z;

      subject to Con1: x + 2 * y + 3 * z <= 25.5;
      subject to Con2: 2 * x - y >= 1.0;
    `;
    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model);

    // 1. Serialize to binary ASL bytes
    const binaryNl = writeBinaryNlProblem(problem);
    assert.ok(binaryNl instanceof Uint8Array, "Must return a Uint8Array byte stream");
    assert.ok(binaryNl.length > 50, "Binary NL stream must contain header and problem segments");

    // Check magic bytes in header: b3 0 0 0
    const headerStr = Buffer.from(binaryNl.subarray(0, 100)).toString("latin1");
    assert.ok(headerStr.startsWith("b3"), "Binary NL header must start with magic 'b3'");

    // 2. Read back using binary ASL reader
    const restored = readBinaryNlProblem(binaryNl);
    assert.ok(restored.name);
    assert.equal(restored.variables.length, 3);
    assert.equal(restored.constraints.length, 2);
    assert.equal(restored.objective.direction, "minimize");

    // Verify variable bounds
    const varX = restored.variables[0]!;
    assert.equal(varX.name, "x1");
    assert.equal(varX.lb, 0);
    assert.equal(varX.ub, 10);

    const varY = restored.variables[1]!;
    assert.equal(varY.name, "x2");
    assert.equal(varY.lb, 1.5);
    assert.equal(varY.ub, 8.5);

    const varZ = restored.variables[2]!;
    assert.equal(varZ.name, "x3");
    assert.equal(varZ.type, "binary");
    assert.equal(varZ.lb, 0);
    assert.equal(varZ.ub, 1);

    // Verify objective linear terms
    const x1Obj = restored.objective.expr.linearTerms.find((t) => t.varId === 0);
    const x2Obj = restored.objective.expr.linearTerms.find((t) => t.varId === 1);
    const x3Obj = restored.objective.expr.linearTerms.find((t) => t.varId === 2);
    assert.equal(x1Obj?.coeff, 3.5);
    assert.equal(x2Obj?.coeff, 2.25);
    assert.equal(x3Obj?.coeff, -5.0);

    // Verify constraints
    const con1 = restored.constraints[0]!;
    assert.equal(con1.ub, 25.5);
    const c1x1 = con1.expr.linearTerms.find((t) => t.varId === 0);
    const c1x2 = con1.expr.linearTerms.find((t) => t.varId === 1);
    const c1x3 = con1.expr.linearTerms.find((t) => t.varId === 2);
    assert.equal(c1x1?.coeff, 1);
    assert.equal(c1x2?.coeff, 2);
    assert.equal(c1x3?.coeff, 3);

    const con2 = restored.constraints[1]!;
    assert.equal(con2.lb, 1.0);
    const c2x1 = con2.expr.linearTerms.find((t) => t.varId === 0);
    const c2x2 = con2.expr.linearTerms.find((t) => t.varId === 1);
    assert.equal(c2x1?.coeff, 2);
    assert.equal(c2x2?.coeff, -1);
  });

  it("reads binary .sol solution files", () => {
    // Construct a synthetic binary solution file
    const msg = "Optimal solution found\n";
    const headerBytes = Buffer.from(msg, "utf-8");

    const duals = new Float64Array([1.5]);
    const primals = new Float64Array([10.0, 20.0]);

    const dualBuf = Buffer.from(duals.buffer, duals.byteOffset, duals.byteLength);
    const primBuf = Buffer.from(primals.buffer, primals.byteOffset, primals.byteLength);

    const solBytes = Buffer.concat([headerBytes, dualBuf, primBuf]);

    const solResult = readBinarySolResult(new Uint8Array(solBytes), 2, 1);
    assert.equal(solResult.message, "Optimal solution found");
    assert.equal(solResult.primalValues[0], 10.0);
    assert.equal(solResult.primalValues[1], 20.0);
    assert.equal(solResult.dualValues[0], 1.5);
  });
});

describe("languages/ampl: Phase 5 — In-Memory Native C / FFI Solver Bridges", () => {
  it("probes system paths for HiGHS, Gurobi, and MOSEK dynamic libraries", () => {
    const highsProbe = probeNativeSolverLibrary("highs");
    assert.equal(highsProbe.solver, "highs");
    assert.equal(typeof highsProbe.available, "boolean");

    const gurobiProbe = probeNativeSolverLibrary("gurobi");
    assert.equal(gurobiProbe.solver, "gurobi");
    assert.equal(typeof gurobiProbe.available, "boolean");

    const mosekProbe = probeNativeSolverLibrary("mosek");
    assert.equal(mosekProbe.solver, "mosek");
    assert.equal(typeof mosekProbe.available, "boolean");
  });

  it("assembles zero-copy Compressed Sparse Column (CSC) matrices for native solver consumption", () => {
    const modSrc = `
      var x1 >= 0;
      var x2 >= 0;
      var x3 >= 0;

      minimize obj: 2*x1 + 3*x2 + 4*x3;

      subject to c1: x1 + x2 <= 10;
      subject to c2: 2*x1 + 3*x3 <= 20;
      subject to c3: x2 + x3 >= 5;
    `;
    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model);

    const csc = buildNativeCscMatrix(problem);
    assert.equal(csc.numRows, 3);
    assert.equal(csc.numCols, 3);
    assert.equal(csc.colPointers.length, 4); // numCols + 1

    assert.equal(csc.colPointers[0], 0);
    assert.equal(csc.colPointers[3], csc.values.length);
    assert.equal(csc.rowIndices.length, csc.values.length);

    // Check col 0 (x1): appears in c1 (row 0, coeff 1) and c2 (row 1, coeff 2)
    const col0Count = csc.colPointers[1]! - csc.colPointers[0]!;
    assert.equal(col0Count, 2);
    assert.equal(csc.rowIndices[csc.colPointers[0]!], 0);
    assert.equal(csc.values[csc.colPointers[0]!], 1);
    assert.equal(csc.rowIndices[csc.colPointers[0]! + 1], 1);
    assert.equal(csc.values[csc.colPointers[0]! + 1], 2);
  });

  it("falls back gracefully when native solver dynamic libraries are not installed", async () => {
    const modSrc = `
      var x >= 0;
      minimize obj: x;
      subject to c1: x >= 5;
    `;
    const model = parseAmplModel(modSrc);
    const problem = instantiateAmpl(model);

    // solveWithNativeFfi throws an informative error or returns result if library is missing
    try {
      const nativeRes = await solveWithNativeFfi(problem, "gurobi");
      assert.ok(nativeRes.status === "OPTIMAL");
    } catch (err: any) {
      assert.ok(
        err.message.includes("not found") ||
          err.message.includes("Gurobi") ||
          err.message.includes("libgurobi"),
      );
    }

    // solveAmpl with solver: "gurobi" gracefully falls back to built-in solvers
    const res = await solveAmpl(problem, { solver: "gurobi" });
    assert.equal(res.status, "OPTIMAL");
    assert.equal(res.variables["x"], 5);
  });
});

describe("languages/ampl: Phase 6 — Extended Connectors, Interactive REPL & Metamodeling", () => {
  it("reads and writes declarative AMPL tables using native SQLite database driver", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ampl-sqlite-test-"));
    const dbFile = "test_data.db";

    try {
      const modSrc = `
        set Products;
        param cost {Products};
        param stock {Products};

        table ProductsTable "SQLITE" "${dbFile}": [Products] -> Products, cost, stock;
      `;
      const model = parseAmplModel(modSrc);
      const data = {
        sets: new Map([["Products", ["Apples", "Bananas", "Cherries"]]]),
        params: new Map([
          [
            "cost",
            new Map([
              ["Apples", 1.5],
              ["Bananas", 0.75],
              ["Cherries", 3.0],
            ]),
          ],
          [
            "stock",
            new Map([
              ["Apples", 100],
              ["Bananas", 250],
              ["Cherries", 50],
            ]),
          ],
        ]),
      };

      const tableDecl = model.tables!.get("ProductsTable")!;

      // 1. Write table to SQLite DB
      writeAmplTable(tableDecl, model, data, undefined, { baseDir: tmpDir });
      assert.ok(fs.existsSync(path.join(tmpDir, dbFile)), "SQLite database file must be created");

      // 2. Read table back from SQLite DB into fresh data container
      const freshData = {
        sets: new Map(),
        params: new Map(),
      };
      readAmplTable(tableDecl, freshData, { baseDir: tmpDir });

      const products = freshData.sets.get("Products");
      assert.deepEqual(products, ["Apples", "Bananas", "Cherries"]);

      const costMap = freshData.params.get("cost");
      assert.equal(costMap?.get("Apples"), 1.5);
      assert.equal(costMap?.get("Bananas"), 0.75);
      assert.equal(costMap?.get("Cherries"), 3.0);

      const stockMap = freshData.params.get("stock");
      assert.equal(stockMap?.get("Apples"), 100);
      assert.equal(stockMap?.get("Bananas"), 250);
      assert.equal(stockMap?.get("Cherries"), 50);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reads and writes declarative AMPL tables using Microsoft Excel (.xlsx) driver", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ampl-excel-test-"));
    const xlsxFile = "foods.xlsx";

    try {
      const modSrc = `
        set Foods;
        param calories {Foods};
        param protein {Foods};

        table FoodsTable "EXCEL" "${xlsxFile}": [Foods] -> Foods, calories, protein;
      `;
      const model = parseAmplModel(modSrc);
      const data = {
        sets: new Map([["Foods", ["Oats", "Eggs", "Milk"]]]),
        params: new Map([
          [
            "calories",
            new Map([
              ["Oats", 389],
              ["Eggs", 155],
              ["Milk", 42],
            ]),
          ],
          [
            "protein",
            new Map([
              ["Oats", 16.9],
              ["Eggs", 13.0],
              ["Milk", 3.4],
            ]),
          ],
        ]),
      };

      const tableDecl = model.tables!.get("FoodsTable")!;

      // 1. Write table to Excel .xlsx
      writeAmplTable(tableDecl, model, data, undefined, { baseDir: tmpDir });
      assert.ok(fs.existsSync(path.join(tmpDir, xlsxFile)), "Excel .xlsx file must be created");

      // 2. Read table back from Excel .xlsx into fresh data container
      const freshData = {
        sets: new Map(),
        params: new Map(),
      };
      readAmplTable(tableDecl, freshData, { baseDir: tmpDir });

      const foods = freshData.sets.get("Foods");
      assert.deepEqual(foods, ["Oats", "Eggs", "Milk"]);

      const caloriesMap = freshData.params.get("calories");
      assert.equal(caloriesMap?.get("Oats"), 389);
      assert.equal(caloriesMap?.get("Eggs"), 155);
      assert.equal(caloriesMap?.get("Milk"), 42);

      const proteinMap = freshData.params.get("protein");
      assert.equal(proteinMap?.get("Oats"), 16.9);
      assert.equal(proteinMap?.get("Eggs"), 13.0);
      assert.equal(proteinMap?.get("Milk"), 3.4);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("provides tab auto-completion and multi-line statement execution in AmplRepl", async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    let capturedOutput = "";
    outStream.on("data", (chunk) => {
      capturedOutput += chunk.toString("utf-8");
    });

    const repl = new AmplRepl({
      input: inStream,
      output: outStream,
      banner: false,
    });

    // 1. Test auto-completion
    const [kwMatches] = repl.completer("mi");
    assert.ok(kwMatches.includes("minimize"), "Must complete 'minimize'");

    const [dotMatches] = repl.completer(".v");
    assert.ok(dotMatches.includes(".vars"), "Must complete '.vars'");

    // 2. Run REPL in background
    const replPromise = repl.run();

    // 3. Send multi-line statements followed by solve and dot commands
    inStream.write("var x >= 0;\n");
    inStream.write("var y >= 0;\n");
    inStream.write("minimize TotalCost:\n");
    inStream.write("  2 * x + 3 * y;\n");
    inStream.write("subject to Demand:\n");
    inStream.write("  x + y >= 10;\n");
    inStream.write("solve;\n");
    inStream.write(".vars\n");
    inStream.write(".cons\n");
    inStream.write(".obj\n");
    inStream.write(".reset\n");
    inStream.write(".exit\n");
    inStream.end();

    await replPromise;

    // Verify session state and solve
    assert.ok(
      capturedOutput.includes("OPTIMAL") || capturedOutput.includes("TotalCost"),
      "REPL output must contain solution",
    );
    assert.ok(capturedOutput.includes("Session reset."), "REPL must process .reset meta command");
  });

  it("lints set arity mismatch (dimen k) and subset relation violations (within)", () => {
    // 1. Arity mismatch test: dimen 2 declared, 1D data provided
    const modArity = `
      set Pairs dimen 2;
    `;
    const datArity = `
      set Pairs := A B C;
    `;
    const model1 = parseAmplModel(modArity);
    const data1 = parseAmplData(datArity);
    const diags1 = lintAmpl(model1, data1);

    const arityError = diags1.find((d) => d.code === AmplErrorCode.SET_ARITY_MISMATCH.code);
    assert.ok(arityError, "Must detect M9511 set-arity-mismatch");
    assert.equal(arityError.rule, "set-arity-mismatch");
    assert.ok(arityError.message.includes("dimen 2"));

    // 2. Subset relation violation test: within clause
    const modWithin = `
      set Parent;
      set Children within Parent;
    `;
    const datWithin = `
      set Parent := A B C;
      set Children := A D;
    `;
    const model2 = parseAmplModel(modWithin);
    const data2 = parseAmplData(datWithin);
    const diags2 = lintAmpl(model2, data2);

    const subsetError = diags2.find((d) => d.code === AmplErrorCode.SUBSET_RELATION_VIOLATION.code);
    assert.ok(subsetError, "Must detect M9512 subset-relation-violation");
    assert.equal(subsetError.rule, "subset-relation-violation");
    assert.ok(subsetError.message.includes("Children"));
    assert.ok(subsetError.message.includes("Parent"));
    assert.ok(subsetError.message.includes("D"));
  });
});
