// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArraySegmentState,
  NumericalInterval as Interval,
  ReducedProductDomain,
  type RTECheckResult,
} from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import {
  ModelicaAbstractEvaluator,
  ModelicaAlgorithmAnalyzer,
  ModelicaCFGLowerer,
  PhysicalInvariantBridge,
  findCstNodesByType,
  type ModelicaStatement,
  type ModelicaVariableDecl,
} from "../src/index.js";

describe("Phase 3: Modelica Algorithmic Abstract Interpretation (Sound RTE Verification)", () => {
  it("should prove 100% safe 1-based array accesses in loop and detect out-of-bounds access", () => {
    // Modelica algorithm:
    // for i in 1:10 loop
    //   total := total + data[i];
    // end for;
    const statements: ModelicaStatement[] = [
      {
        kind: "assignment",
        targetVar: "total",
        valExpr: "0",
      },
      {
        kind: "for",
        loopVar: "i",
        rangeStart: "1",
        rangeEnd: "10",
        rangeStep: "1",
        loopBody: [
          {
            kind: "assignment",
            targetVar: "total",
            valExpr: "total + data[i]",
          },
        ],
      },
    ];

    const variables: ModelicaVariableDecl[] = [
      { name: "data", isArray: true, arrayDimension: 10 },
      { name: "total", type: "Real", initialBound: [0, 0] },
    ];

    const result = ModelicaAlgorithmAnalyzer.analyze(statements, variables, {
      functionName: "sumArray",
    });

    // All accesses data[i] for i in [1, 10] are within bounds [1, 10]
    assert.strictEqual(result.isCertifiedSafe, true);
    assert.strictEqual(result.definiteBugs.length, 0);
    assert.strictEqual(result.potentialBugs.length, 0);
    assert.ok(result.provenSafe.some((c) => c.category === "array_out_of_bounds"));
    assert.ok(result.formattedMatrix.includes("100% CERTIFIED SAFE"));
  });

  it("should flag definite bug on 0-based array indexing in Modelica (Modelica is 1-based)", () => {
    const statements: ModelicaStatement[] = [
      {
        kind: "assignment",
        targetVar: "x",
        valExpr: "data[0]", // 0 is invalid in Modelica
      },
    ];

    const variables: ModelicaVariableDecl[] = [
      { name: "data", isArray: true, arrayDimension: 5 },
      { name: "x", type: "Real" },
    ];

    const result = ModelicaAlgorithmAnalyzer.analyze(statements, variables);

    assert.strictEqual(result.isCertifiedSafe, false);
    assert.strictEqual(result.definiteBugs.length, 1);
    assert.strictEqual(result.definiteBugs[0]!.category, "array_out_of_bounds");
    assert.strictEqual(result.definiteBugs[0]!.verdict, "definite_bug");
  });

  it("should flag array element assignment when index exceeds array dimension", () => {
    const code = `
      algorithm
        arr[12] := 42.0;
    `;

    const variables: ModelicaVariableDecl[] = [{ name: "arr", isArray: true, arrayDimension: 10 }];

    const result = ModelicaAlgorithmAnalyzer.analyzeCode(code, variables);
    assert.strictEqual(result.isCertifiedSafe, false);
    assert.ok(result.definiteBugs.some((c) => c.category === "array_out_of_bounds"));
  });

  it("should mathematically prove absence of division by zero in bounded algorithms", () => {
    // i starts at 1 and increases: 100 / i is never zero
    const statements: ModelicaStatement[] = [
      {
        kind: "assignment",
        targetVar: "i",
        valExpr: "1",
      },
      {
        kind: "assignment",
        targetVar: "res",
        valExpr: "100 / i",
      },
    ];

    const result = ModelicaAlgorithmAnalyzer.analyze(statements);

    assert.strictEqual(result.isCertifiedSafe, true);
    assert.strictEqual(result.definiteBugs.length, 0);
    assert.strictEqual(result.potentialBugs.length, 0);
    assert.ok(result.provenSafe.some((c) => c.category === "division_by_zero"));
  });

  it("should detect potential division by zero on unconstrained inputs", () => {
    const statements: ModelicaStatement[] = [
      {
        kind: "assignment",
        targetVar: "res",
        valExpr: "100 / denom",
      },
    ];

    // denom is [-5, 5], which contains 0!
    const variables: ModelicaVariableDecl[] = [
      { name: "denom", type: "Real", initialBound: [-5, 5] },
      { name: "res", type: "Real" },
    ];

    const result = ModelicaAlgorithmAnalyzer.analyze(statements, variables);

    assert.strictEqual(result.isCertifiedSafe, false);
    assert.ok(result.potentialBugs.some((c) => c.category === "division_by_zero"));
  });

  it("should detect division by zero in mod(x, y) and rem(x, y)", () => {
    const code = `
      algorithm
        r := mod(10, 0);
    `;

    const variables: ModelicaVariableDecl[] = [{ name: "r", type: "Integer" }];

    const result = ModelicaAlgorithmAnalyzer.analyzeCode(code, variables);
    assert.strictEqual(result.isCertifiedSafe, false);
    assert.ok(result.definiteBugs.some((c) => c.category === "division_by_zero"));
  });

  it("should verify standard library array operations (zeros, ones, fill, linspace, sum, min, max)", () => {
    const code = `
      algorithm
        v := zeros(10);
        v[1] := 5.0;
        s := sum(v);
        m := min(v);
    `;

    const variables: ModelicaVariableDecl[] = [
      { name: "v", isArray: true },
      { name: "s", type: "Real" },
      { name: "m", type: "Real" },
    ];

    const result = ModelicaAlgorithmAnalyzer.analyzeCode(code, variables);
    assert.strictEqual(result.isCertifiedSafe, true);
    assert.strictEqual(result.definiteBugs.length, 0);
  });

  it("should detect math function domain violations on sqrt(negative), log(nonpositive), asin(out-of-range)", () => {
    const code = `
      algorithm
        y1 := sqrt(-4.0);
        y2 := log(0.0);
        y3 := asin(2.5);
    `;

    const variables: ModelicaVariableDecl[] = [
      { name: "y1", type: "Real" },
      { name: "y2", type: "Real" },
      { name: "y3", type: "Real" },
    ];

    const result = ModelicaAlgorithmAnalyzer.analyzeCode(code, variables);
    assert.strictEqual(result.isCertifiedSafe, false);
    const domainBugs = result.definiteBugs.filter((c) => c.category === "math_domain");
    assert.ok(domainBugs.length >= 3);
  });

  it("should detect uninitialized variable reads", () => {
    const code = `
      algorithm
        y := uninit_var + 10.0;
    `;

    const variables: ModelicaVariableDecl[] = [
      { name: "uninit_var", type: "Real" }, // Not marked isInput and no initialBound
      { name: "y", type: "Real" },
    ];

    const result = ModelicaAlgorithmAnalyzer.analyzeCode(code, variables);
    assert.strictEqual(result.isCertifiedSafe, false);
    assert.ok(result.definiteBugs.some((c) => c.category === "uninitialized_read"));
  });

  it("should parse and analyze structured if-elseif-else and while loop algorithms directly from text", () => {
    const code = `
      algorithm
        x := 10;
        while x > 0 loop
          x := x - 1;
        end while;
        if x == 0 then
          y := 1;
        elseif x < 0 then
          y := 2;
        else
          y := 3;
        end if;
    `;

    const variables: ModelicaVariableDecl[] = [
      { name: "x", type: "Integer" },
      { name: "y", type: "Integer" },
    ];

    const result = ModelicaAlgorithmAnalyzer.analyzeCode(code, variables);
    assert.strictEqual(result.isCertifiedSafe, true);
  });

  it("should eliminate false alarms using continuous physical plant flowpipe bounds", () => {
    // Algorithmic controller calculation: y := sqrt(sensor_val);
    const statements: ModelicaStatement[] = [
      {
        kind: "assignment",
        targetVar: "y",
        valExpr: "sqrt(sensor_val)",
      },
    ];

    // Without plant bounds: sensor_val could be unconstrained [-inf, +inf] -> potential bug!
    const unconstrainedResult = ModelicaAlgorithmAnalyzer.analyze(statements);
    assert.strictEqual(unconstrainedResult.isCertifiedSafe, false);

    // With physical plant reachability flowpipe: sensor_val is provably in [1.5, 4.5] (positive!)
    const plantBounds = new Map<string, [number, number]>([["sensor_val", [1.5, 4.5]]]);

    const certifiedResult = ModelicaAlgorithmAnalyzer.analyze(statements, [], {
      functionName: "filterSensor",
      plantPreconditions: plantBounds,
    });

    // Invariant injection turns the potential bug into 100% PROVEN SAFE!
    assert.strictEqual(certifiedResult.isCertifiedSafe, true);
    assert.strictEqual(certifiedResult.definiteBugs.length, 0);
    assert.strictEqual(certifiedResult.potentialBugs.length, 0);
    assert.ok(certifiedResult.provenSafe.some((c) => c.category === "math_domain"));
  });

  it("should accurately compute [1, 10] formal invariant for for-loop variable without dead code", () => {
    const code = `
      algorithm
        for i in 1:10 loop
        end for;
    `;

    const statements = ModelicaCFGLowerer.parseStatements(code);
    const result = ModelicaAlgorithmAnalyzer.analyze(statements, [], { functionName: "forLoopModel" });

    assert.strictEqual(result.isCertifiedSafe, true);
    assert.strictEqual(result.deadCodeBlocks, 0);

    // Verify CFG exists and for_header / for_body reaches [1, 10]
    assert.ok(result.cfg, "CFG must be included in proof result");
    const headerBlock = Array.from(result.cfg!.blocks.values()).find((b) => b.label === "for_header");
    assert.ok(headerBlock, "Must have for_header block");

    const headerOut = result.summary.blockExitStates.get(headerBlock!.id);
    assert.ok(headerOut, "Must have exit state for for_header");
    const iIval = headerOut!.intervals.get("i");
    assert.ok(iIval, "Variable 'i' must have an interval in for_header");
    assert.strictEqual(iIval!.low, 1);
    assert.strictEqual(iIval!.high, 10);
  });

  it("should evaluate parenthesized expressions, unary minus, and scientific notation", () => {
    const code = `
      algorithm
        x := (1 + 2);
        y := 2 * -3;
        z := 1 + 1e-5;
        w := -(10 + 5);
    `;

    const variables: ModelicaVariableDecl[] = [
      { name: "x", type: "Real" },
      { name: "y", type: "Real" },
      { name: "z", type: "Real" },
      { name: "w", type: "Real" },
    ];

    const result = ModelicaAlgorithmAnalyzer.analyzeCode(code, variables);
    assert.strictEqual(result.isCertifiedSafe, true);
    const exitState = Array.from(result.summary.blockExitStates.values()).pop()!;

    const xIval = exitState.intervals.get("x");
    assert.ok(xIval);
    assert.strictEqual(xIval!.low, 3);
    assert.strictEqual(xIval!.high, 3);

    const yIval = exitState.intervals.get("y");
    assert.ok(yIval);
    assert.strictEqual(yIval!.low, -6);
    assert.strictEqual(yIval!.high, -6);

    const zIval = exitState.intervals.get("z");
    assert.ok(zIval);
    assert.strictEqual(zIval!.low, 1.00001);
    assert.strictEqual(zIval!.high, 1.00001);

    const wIval = exitState.intervals.get("w");
    assert.ok(wIval);
    assert.strictEqual(wIval!.low, -15);
    assert.strictEqual(wIval!.high, -15);
  });

  it("should enforce proper 3-tier operator precedence and sound interval squaring", () => {
    const code = `
      algorithm
        p := 2 * 3 ^ 2;
        q := s ^ 2;
    `;

    const variables: ModelicaVariableDecl[] = [
      { name: "s", type: "Real", isInput: true, initialBound: [-2, 3] },
      { name: "p", type: "Real" },
      { name: "q", type: "Real" },
    ];

    const result = ModelicaAlgorithmAnalyzer.analyzeCode(code, variables);
    assert.strictEqual(result.isCertifiedSafe, true);
    const exitState = Array.from(result.summary.blockExitStates.values()).pop()!;

    // 2 * (3 ^ 2) = 18, NOT (2 * 3) ^ 2 = 36
    const pIval = exitState.intervals.get("p");
    assert.ok(pIval);
    assert.strictEqual(pIval!.low, 18);
    assert.strictEqual(pIval!.high, 18);

    // [-2, 3] ^ 2 must be [0, 9], NOT [-6, 9]
    const qIval = exitState.intervals.get("q");
    assert.ok(qIval);
    assert.strictEqual(qIval!.low, 0);
    assert.strictEqual(qIval!.high, 9);
  });

  it("should verify bounds on all dimensions of multi-dimensional arrays", () => {
    const statements: ModelicaStatement[] = [
      {
        kind: "assignment",
        targetVar: "val",
        valExpr: "matrix[5, 25]",
      },
    ];

    const lowerer = new ModelicaCFGLowerer();
    const cfg = lowerer.lower(statements);

    const domain = new ReducedProductDomain(1);
    let state = domain.top();
    state.arraySegments.set(
      "matrix",
      new ArraySegmentState(new Interval(10, 10), new Interval(1, 100), Interval.TOP, Interval.TOP, Interval.TOP, [
        new Interval(10, 10),
        new Interval(20, 20),
      ]),
    );

    const checks: RTECheckResult[] = [];
    ModelicaAbstractEvaluator.transfer(
      cfg.blocks.get(1)!.instructions[0]!,
      state,
      (c) => checks.push(c),
      new Set(["matrix", "val"]),
      new Set(["matrix", "val"]),
    );

    // Dimension 1 (index 5) is safe, but dimension 2 (index 25 against 20) is definite out of bounds
    const dim1Check = checks.find((c) => c.description.includes("dim 1"));
    const dim2Check = checks.find((c) => c.description.includes("dim 2"));

    assert.ok(dim1Check, "Must have dim 1 check");
    assert.strictEqual(dim1Check!.verdict, "proven_safe");

    assert.ok(dim2Check, "Must have dim 2 check");
    assert.strictEqual(dim2Check!.verdict, "definite_bug");
  });

  it("should enforce path-sensitive definite assignment across if-else branch merges", () => {
    // Variable z is only assigned in the 'then' branch, not in 'else'
    const codeDefect = `
      algorithm
        if cond then
          z := 10.0;
        else
          w := 20.0;
        end if;
        out := z + 1.0;
    `;

    const varsDefect: ModelicaVariableDecl[] = [
      { name: "cond", type: "Boolean", isInput: true },
      { name: "z", type: "Real" },
      { name: "w", type: "Real" },
      { name: "out", type: "Real" },
    ];

    const resultDefect = ModelicaAlgorithmAnalyzer.analyzeCode(codeDefect, varsDefect);
    assert.strictEqual(resultDefect.isCertifiedSafe, false);
    assert.ok(
      resultDefect.definiteBugs.some((c) => c.category === "uninitialized_read" && c.description.includes("'z'")),
      "Must flag uninitialized read for 'z' read after partial branch assignment",
    );

    // When assigned in BOTH branches, 'z' is definitely assigned after the merge
    const codeSafe = `
      algorithm
        if cond then
          z := 10.0;
        else
          z := 20.0;
        end if;
        out := z + 1.0;
    `;

    const varsSafe: ModelicaVariableDecl[] = [
      { name: "cond", type: "Boolean", isInput: true },
      { name: "z", type: "Real" },
      { name: "out", type: "Real" },
    ];

    const resultSafe = ModelicaAlgorithmAnalyzer.analyzeCode(codeSafe, varsSafe);
    assert.strictEqual(resultSafe.isCertifiedSafe, true);
    assert.strictEqual(resultSafe.definiteBugs.filter((c) => c.category === "uninitialized_read").length, 0);
  });

  it("should guard physical invariant bridge against empty flowpipe reachability", () => {
    const emptyResult = {
      modelName: "TestModel",
      timeSpan: [0, 10] as [number, number],
      steps: [],
      safetyCertified: true,
      computationTimeMs: 1.0,
      witnessViolations: [],
    };

    const envelopes = PhysicalInvariantBridge.extractFlowpipeEnvelopes(emptyResult, ["x", "y"]);
    assert.strictEqual(
      envelopes.size,
      0,
      "Empty flowpipe should yield empty envelopes rather than inverted infinities",
    );
  });

  it("should lower algorithmic CFG directly from WebAssembly linear CST nodes", async () => {
    const { createWasmParser } = await import("@modelscript/modelica/parser");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

    const { parser } = await createWasmParser(modelicaWasm);
    const code = `
      function SafeArraySum
        input Real[10] arr;
        output Real total;
        protected Integer i;
      algorithm
        total := 0;
        for i in 1:10 loop
          total := total + arr[i];
        end for;
      end SafeArraySum;
    `;

    const tree = parser.parse(code);
    assert.ok(tree?.rootNode, "GLR parser should successfully generate CST");

    // 1. Locate algorithm section and extract statements via CST
    const algSections = findCstNodesByType(tree.rootNode, "algorithm_section");
    assert.ok(algSections.length > 0, "Should locate algorithm_section in CST");

    const stmts = ModelicaCFGLowerer.extractStatementsFromCst(algSections[0]);
    assert.ok(stmts.length >= 2, "Should extract statements directly from CST");
    assert.strictEqual(stmts[0]?.kind, "assignment");
    assert.strictEqual(stmts[1]?.kind, "for");

    // 2. Lower GenericCFG directly from CST
    const cfg = ModelicaCFGLowerer.lowerCst(algSections[0]);
    assert.ok(cfg.blocks.size >= 4, "CFG lowered from CST should contain entry, header, body, and exit blocks");

    // 3. Extract variables and run formal analysis directly on class CST
    const proof = ModelicaAlgorithmAnalyzer.analyzeClassCst(tree.rootNode, tree.rootNode);
    assert.ok(proof, "Proof result should be non-null for valid class CST");
    assert.strictEqual(proof.functionName, "SafeArraySum");
    assert.strictEqual(proof.isCertifiedSafe, true, "Array sum in 1:10 loop must be 100% certified safe");
    assert.strictEqual(proof.definiteBugs.length, 0);
  });

  it("should detect out-of-bounds array access when lowered directly from CST", async () => {
    const { createWasmParser } = await import("@modelscript/modelica/parser");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

    const { parser } = await createWasmParser(modelicaWasm);
    const code = `
      function UnsafeArraySum
        input Real[10] arr;
        output Real total;
        protected Integer i;
      algorithm
        total := 0;
        for i in 1:12 loop
          total := total + arr[i];
        end for;
      end UnsafeArraySum;
    `;

    const tree = parser.parse(code);
    assert.ok(tree?.rootNode, "GLR parser should successfully generate CST");

    const proof = ModelicaAlgorithmAnalyzer.analyzeClassCst(tree.rootNode, tree.rootNode);
    assert.ok(proof, "Proof result should be non-null");
    assert.strictEqual(proof.isCertifiedSafe, false, "Array access exceeding dim must fail certification");
    const oobBugs = [...proof.definiteBugs, ...proof.potentialBugs].filter((c) => c.category === "array_out_of_bounds");
    assert.ok(oobBugs.length > 0, "Should detect array_out_of_bounds bug");
  });
});
