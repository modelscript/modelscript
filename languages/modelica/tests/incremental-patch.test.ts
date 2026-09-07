import { createWasmParser } from "@modelscript/modelica/parser";
import { ExprKind } from "@modelscript/runtime";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(modelicaWasm);
Context.registerParser(".mo", parser as any);

async function runTests() {
  console.log("=== Running Incremental DAE Patching Tests ===");
  const fs = new NodeFileSystem();

  // --------------------------------------------------------------------------
  // Test 1: Isolated Equation Edit
  // --------------------------------------------------------------------------
  {
    console.log("Test 1: Isolated Equation Edit...");
    const ctx = new Context(fs);
    const uri = "file:///test/Cascade.mo";

    const src1 = `model Cascade
  Real x(start = 1.0);
  Real y;
equation
  der(x) = -1.0 * x;
  y = 2.0 * x;
end Cascade;`;

    ctx.load(src1, uri);
    const dae1 = ctx.flattenArena("Cascade", undefined, uri);
    assert(dae1 !== null, "Initial flatten must succeed");
    assert.strictEqual(dae1.eqCount, 2, "Must have 2 equations");

    // Check equation 1 (y = 2.0 * x)
    const eq1Rhs = dae1.getEqRhs(1);
    assert(eq1Rhs >= 0, "Equation 1 RHS must exist");

    // Edit equation 1: y = 5.0 * x;
    const src2 = `model Cascade
  Real x(start = 1.0);
  Real y;
equation
  der(x) = -1.0 * x;
  y = 5.0 * x;
end Cascade;`;

    const t0 = performance.now();
    ctx.load(src2, uri);
    const dae2 = ctx.flattenArena("Cascade", undefined, uri);
    const elapsed = performance.now() - t0;
    console.log(`  -> Incremental re-flatten took: ${elapsed.toFixed(3)} ms`);

    assert(dae2 !== null, "Patched flatten must succeed");
    assert.strictEqual(dae2.eqCount, 2, "Must still have 2 equations");

    const newRhs = dae2.getEqRhs(1);
    assert(newRhs >= 0, "New RHS must exist");
    const leftChild = dae2.getExprLeft(newRhs);
    assert.strictEqual(dae2.getExprKind(leftChild), ExprKind.RealLiteral, "LHS of binary expr must be RealLiteral");
    assert.strictEqual(dae2.getExprRealValue(leftChild), 5.0, "Real literal must be 5.0");
    console.log("  ✓ Test 1 passed!");
  }

  // --------------------------------------------------------------------------
  // Test 2: Parameter Value Edit & In-Place Folding
  // --------------------------------------------------------------------------
  {
    console.log("Test 2: Parameter Value Edit...");
    const ctx = new Context(fs);
    const uri = "file:///test/ParamTest.mo";

    const src1 = `model ParamTest
  parameter Real a = 1.0;
  Real x;
equation
  x = a + 2.0;
end ParamTest;`;

    ctx.load(src1, uri);
    const dae1 = ctx.flattenArena("ParamTest", undefined, uri);
    assert(dae1 !== null, "Initial flatten must succeed");

    const src2 = `model ParamTest
  parameter Real a = 10.0;
  Real x;
equation
  x = a + 2.0;
end ParamTest;`;

    const t0 = performance.now();
    ctx.load(src2, uri);
    const dae2 = ctx.flattenArena("ParamTest", undefined, uri);
    const elapsed = performance.now() - t0;
    console.log(`  -> Parameter patch took: ${elapsed.toFixed(3)} ms`);

    assert(dae2 !== null, "Patched flatten must succeed");
    const aIdx = dae2.lookupVariable("a");
    assert(aIdx >= 0, "Variable 'a' must exist");
    assert.strictEqual(dae2.getVarStartValue(aIdx), 10.0, "Parameter 'a' start value must be 10.0");
    console.log("  ✓ Test 2 passed!");
  }

  // --------------------------------------------------------------------------
  // Test 3: Global State Modifier Edit on Arrays
  // --------------------------------------------------------------------------
  {
    console.log("Test 3: Global State Modifier Edit on Arrays...");
    const ctx = new Context(fs);
    const uri = "file:///test/ArrayTest.mo";

    const src1 = `model ArrayTest
  Real x[10](start = zeros(10));
equation
  for i in 1:10 loop
    der(x[i]) = -x[i];
  end for;
end ArrayTest;`;

    ctx.load(src1, uri);
    const dae1 = ctx.flattenArena("ArrayTest", undefined, uri);
    assert(dae1 !== null, "Initial flatten must succeed");
    assert.strictEqual(dae1.varCount, 10, "Must have 10 variables");

    const src2 = `model ArrayTest
  Real x[10](start = ones(10));
equation
  for i in 1:10 loop
    der(x[i]) = -x[i];
  end for;
end ArrayTest;`;

    const t0 = performance.now();
    ctx.load(src2, uri);
    const dae2 = ctx.flattenArena("ArrayTest", undefined, uri);
    const elapsed = performance.now() - t0;
    console.log(`  -> Array modifier patch took: ${elapsed.toFixed(3)} ms`);

    assert(dae2 !== null, "Patched flatten must succeed");
    for (let i = 0; i < 10; i++) {
      const attrExpr = dae2.getVarAttr(i, "start");
      assert(attrExpr >= 0, `Variable x[${i + 1}] must have start attribute`);
      assert.strictEqual(dae2.getExprRealValue(attrExpr), 1.0, `Start attribute must be 1.0`);
    }
    console.log("  ✓ Test 3 passed!");
  }

  // --------------------------------------------------------------------------
  // Test 4: Structural Fallback
  // --------------------------------------------------------------------------
  {
    console.log("Test 4: Structural Fallback on component addition...");
    const ctx = new Context(fs);
    const uri = "file:///test/FallbackTest.mo";

    const src1 = `model FallbackTest
  Real x;
equation
  x = 1.0;
end FallbackTest;`;

    ctx.load(src1, uri);
    const dae1 = ctx.flattenArena("FallbackTest", undefined, uri);
    assert(dae1 !== null, "Initial flatten must succeed");
    assert.strictEqual(dae1.varCount, 1, "Must have 1 variable");
    assert.strictEqual(dae1.eqCount, 1, "Must have 1 equation");

    // Add a new variable and equation
    const src2 = `model FallbackTest
  Real x;
  Real y;
equation
  x = 1.0;
  y = 2.0;
end FallbackTest;`;

    ctx.load(src2, uri);
    const dae2 = ctx.flattenArena("FallbackTest", undefined, uri);
    assert(dae2 !== null, "Fallback flatten must succeed");
    assert.strictEqual(dae2.varCount, 2, "Must now have 2 variables");
    assert.strictEqual(dae2.eqCount, 2, "Must now have 2 equations");
    console.log("  ✓ Test 4 passed!");
  }

  // --------------------------------------------------------------------------
  // Test 5: Scalarized Equation Patching
  // --------------------------------------------------------------------------
  {
    console.log("Test 5: Scalarized Equation Patching...");
    const ctx = new Context(fs);
    const uri = "file:///test/ArrayEqPatch.mo";

    const src1 = `model ArrayEqPatch
  Real x[2];
equation
  x[1] = 1.0;
  x[2] = 2.0;
end ArrayEqPatch;`;

    ctx.load(src1, uri);
    const dae1 = ctx.flattenArena("ArrayEqPatch", undefined, uri);
    assert(dae1 !== null, "Initial flatten must succeed");
    assert.strictEqual(dae1.varCount, 2, "Must have 2 scalarized variables");
    assert.strictEqual(dae1.eqCount, 2, "Must have 2 scalarized equations");

    // Check source ranges exist on scalarized equations
    const range0 = dae1.getEqSourceRange(0);
    const range1 = dae1.getEqSourceRange(1);
    assert(range0 !== undefined, "Equation 0 must have source range");
    assert(range1 !== undefined, "Equation 1 must have source range");

    // Edit equation 2: x[2] = 42.0;
    const src2 = `model ArrayEqPatch
  Real x[2];
equation
  x[1] = 1.0;
  x[2] = 42.0;
end ArrayEqPatch;`;

    const t0 = performance.now();
    ctx.load(src2, uri);
    const dae2 = ctx.flattenArena("ArrayEqPatch", undefined, uri);
    const elapsed = performance.now() - t0;
    console.log(`  -> Scalarized array equation patch took: ${elapsed.toFixed(3)} ms`);

    assert(dae2 !== null, "Patched flatten must succeed");
    assert.strictEqual(dae2.eqCount, 2, "Must still have 2 equations");
    const eq1Rhs = dae2.getEqRhs(1);
    assert.strictEqual(dae2.getExprKind(eq1Rhs), ExprKind.RealLiteral, "RHS must be RealLiteral");
    assert.strictEqual(dae2.getExprRealValue(eq1Rhs), 42.0, "Equation 2 RHS must be updated to 42.0");
    console.log("  ✓ Test 5 passed: Scalarized equation patching verified!");
  }

  // --------------------------------------------------------------------------
  // Test 6: Multi-Hunk Non-Adjacent Equation Patching
  // --------------------------------------------------------------------------
  {
    console.log("Test 6: Multi-Hunk Non-Adjacent Equation Patching...");
    const ctx = new Context(fs);
    const uri = "file:///test/MultiHunk.mo";

    const src1 = `model MultiHunk
  Real a;
  Real b;
  Real c;
equation
  a = 1.0;
  b = 2.0;
  c = 3.0;
end MultiHunk;`;

    ctx.load(src1, uri);
    const dae1 = ctx.flattenArena("MultiHunk", undefined, uri);
    assert(dae1 !== null, "Initial flatten must succeed");
    assert.strictEqual(dae1.eqCount, 3, "Must have 3 equations");

    // Edit equation 'a' and equation 'c' simultaneously, leaving 'b' untouched
    const src2 = `model MultiHunk
  Real a;
  Real b;
  Real c;
equation
  a = 100.0;
  b = 2.0;
  c = 300.0;
end MultiHunk;`;

    const t0 = performance.now();
    ctx.load(src2, uri);
    const dae2 = ctx.flattenArena("MultiHunk", undefined, uri);
    const elapsed = performance.now() - t0;
    console.log(`  -> Multi-hunk patch took: ${elapsed.toFixed(3)} ms`);

    assert(dae2 !== null, "Multi-hunk patched flatten must succeed");
    assert.strictEqual(dae2.eqCount, 3, "Must still have 3 equations");

    const aRhs = dae2.getEqRhs(0);
    assert.strictEqual(dae2.getExprKind(aRhs), ExprKind.RealLiteral);
    assert.strictEqual(dae2.getExprRealValue(aRhs), 100.0, "Equation a RHS must be 100.0");

    const bRhs = dae2.getEqRhs(1);
    assert.strictEqual(dae2.getExprKind(bRhs), ExprKind.RealLiteral);
    assert.strictEqual(dae2.getExprRealValue(bRhs), 2.0, "Equation b RHS must be 2.0");

    const cRhs = dae2.getEqRhs(2);
    assert.strictEqual(dae2.getExprKind(cRhs), ExprKind.RealLiteral);
    assert.strictEqual(dae2.getExprRealValue(cRhs), 300.0, "Equation c RHS must be 300.0");
    console.log("  ✓ Test 6 passed: Multi-hunk non-adjacent equation patching verified!");
  }

  console.log("=== All Incremental DAE Patching Tests Passed Successfully! ===");
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
