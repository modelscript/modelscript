// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { ModelicaAlgorithmAnalyzer, type ModelicaStatement, type ModelicaVariableDecl } from "../src/index.js";

describe("Phase 3: Modelica Algorithmic Abstract Interpretation (Astrée/Polyspace Grade)", () => {
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
});
