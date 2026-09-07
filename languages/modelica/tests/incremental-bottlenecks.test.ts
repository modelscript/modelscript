import { createWasmParser } from "@modelscript/modelica/parser";
import { ExprKind, initBltWasm, performBltTransformationArena } from "@modelscript/runtime";
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
  console.log("=== Running Incremental Bottlenecks Test Suite ===");
  const fs = new NodeFileSystem();
  await initBltWasm();

  // --------------------------------------------------------------------------
  // Test 1: Stable SymbolId Recycling & Query Memo Retention
  // --------------------------------------------------------------------------
  {
    console.log("Test 1: Stable SymbolId Recycling Across File Edits...");
    const ctx = new Context(fs);
    const uri = "file:///test/MultiClass.mo";

    const src1 = `model Alpha
  Real x;
equation
  x = 1.0;
end Alpha;

model Beta
  Real y;
equation
  y = 2.0;
end Beta;`;

    ctx.load(src1, uri);
    const qe = (ctx as any).queryEngine;
    const betaSyms1 = qe.index.byName.get("Beta");
    assert(betaSyms1 && betaSyms1.length > 0, "Beta must be indexed");
    const betaId1 = betaSyms1[0];

    // Pre-evaluate instantiate query on Beta to populate Salsa memo
    const betaElems1 = qe.fetch("instantiate", betaId1);
    assert(Array.isArray(betaElems1) && betaElems1.length === 1, "Beta must have 1 element");

    // Modify ONLY model Alpha in the same file
    const src2 = `model Alpha
  Real x;
equation
  x = 99.0;
end Alpha;

model Beta
  Real y;
equation
  y = 2.0;
end Beta;`;

    ctx.load(src2, uri);
    const betaSyms2 = qe.index.byName.get("Beta");
    assert(betaSyms2 && betaSyms2.length > 0, "Beta must still be indexed");
    const betaId2 = betaSyms2[0];

    assert.strictEqual(betaId2, betaId1, "Beta's SymbolId must be recycled and stable across document edits");

    // Check that Beta's instantiate memo is still verified and cached without re-running
    const betaElems2 = qe.fetch("instantiate", betaId2);
    assert.strictEqual(betaElems2, betaElems1, "Beta's instantiate memo must be retained across Alpha edit");
    console.log("  ✓ Test 1 passed: SymbolId recycling & Salsa memo preservation verified!");
  }

  // --------------------------------------------------------------------------
  // Test 2: Targeted Parameter Constant Folding Latency & Correctness
  // --------------------------------------------------------------------------
  {
    console.log("Test 2: Targeted Parameter Dependency Folding...");
    const ctx = new Context(fs);
    const uri = "file:///test/ParamFold.mo";

    const src1 = `model ParamFold
  parameter Real p = 5.0;
  parameter Real q = 10.0;
  Real a;
  Real b;
  Real c;
equation
  a = p * 2.0;
  b = q * 3.0;
  c = a + b;
end ParamFold;`;

    ctx.load(src1, uri);
    const dae1 = ctx.flattenArena("ParamFold", undefined, uri);
    assert(dae1 !== null, "Initial flatten must succeed");

    const aIdx = dae1.lookupVariable("a");
    const bIdx = dae1.lookupVariable("b");
    assert(aIdx >= 0 && bIdx >= 0);

    // Modify parameter p from 5.0 to 20.0
    const src2 = `model ParamFold
  parameter Real p = 20.0;
  parameter Real q = 10.0;
  Real a;
  Real b;
  Real c;
equation
  a = p * 2.0;
  b = q * 3.0;
  c = a + b;
end ParamFold;`;

    const t0 = performance.now();
    ctx.load(src2, uri);
    const dae2 = ctx.flattenArena("ParamFold", undefined, uri);
    const elapsed = performance.now() - t0;
    console.log(`  -> Parameter patch and targeted folding took: ${elapsed.toFixed(3)} ms`);

    assert(dae2 !== null, "Patched flatten must succeed");
    const pIdx = dae2.lookupVariable("p");
    assert.strictEqual(dae2.getVarStartValue(pIdx), 20.0, "p start value must be updated to 20.0");

    // Equation for 'a' (a = p * 2.0) should have folded RHS to 40.0
    const aEqRhs = dae2.getEqRhs(0);
    assert.strictEqual(dae2.getExprKind(aEqRhs), ExprKind.RealLiteral, "a RHS must be folded RealLiteral");
    assert.strictEqual(dae2.getExprRealValue(aEqRhs), 40.0, "a RHS value must be 40.0");

    // Equation for 'b' should remain 30.0
    const bEqRhs = dae2.getEqRhs(1);
    assert.strictEqual(dae2.getExprKind(bEqRhs), ExprKind.RealLiteral, "b RHS must be folded RealLiteral");
    assert.strictEqual(dae2.getExprRealValue(bEqRhs), 30.0, "b RHS value must be 30.0");

    console.log("  ✓ Test 2 passed: Targeted parameter dependency folding verified!");
  }

  // --------------------------------------------------------------------------
  // Test 3: BLT Causal Invariance Cache
  // --------------------------------------------------------------------------
  {
    console.log("Test 3: BLT Causal Invariance Cache...");
    const ctx = new Context(fs);
    const uri = "file:///test/BltTest.mo";

    const src1 = `model BltTest
  Real x;
  Real y;
equation
  x = 2.0 * y;
  y = 3.0;
end BltTest;`;

    ctx.load(src1, uri);
    const dae1 = ctx.flattenArena("BltTest", undefined, uri);
    assert(dae1 !== null, "Initial flatten must succeed");

    const bltResult1 = performBltTransformationArena(dae1);
    assert(bltResult1.blocks.length > 0, "BLT must decompose into blocks");
    assert((dae1 as any).cachedBlt, "DAEBuilder must store cachedBlt");

    // Call BLT again on unchanged DAE -> must return cached object in O(1)
    const t0 = performance.now();
    const bltResult2 = performBltTransformationArena(dae1);
    const cacheHitTime = performance.now() - t0;
    console.log(`  -> BLT cache hit took: ${cacheHitTime.toFixed(4)} ms`);
    assert.strictEqual(bltResult2, (dae1 as any).cachedBlt, "Subsequent BLT must return cached object directly");

    // Modify equation coefficients (non-structural edit)
    const src2 = `model BltTest
  Real x;
  Real y;
equation
  x = 10.0 * y;
  y = 3.0;
end BltTest;`;

    ctx.load(src2, uri);
    const dae2 = ctx.flattenArena("BltTest", undefined, uri);
    assert(dae2 !== null, "Patched flatten must succeed");

    // Verify cached BLT is preserved since equation variables (x, y) didn't change
    const bltResult3 = performBltTransformationArena(dae2);
    assert.strictEqual(bltResult3.sortedEquations.length, bltResult1.sortedEquations.length);
    assert.deepStrictEqual(bltResult3.blocks, bltResult1.blocks, "Causal block structure must be identical");

    console.log("  ✓ Test 3 passed: BLT causal invariance caching verified!");
  }

  // --------------------------------------------------------------------------
  // Test 4: Cross-Model Scoped Cache Isolation
  // --------------------------------------------------------------------------
  {
    console.log("Test 4: Cross-Model Scoped Cache Isolation...");
    const ctx = new Context(fs);
    const uriA = "file:///test/ModelA.mo";
    const uriB = "file:///test/ModelB.mo";

    const srcA1 = `model ModelA
  Real a;
equation
  a = 1.0;
end ModelA;`;

    const srcB = `model ModelB
  Real b;
equation
  b = 2.0;
end ModelB;`;

    ctx.load(srcA1, uriA);
    ctx.load(srcB, uriB);

    const daeA1 = ctx.flattenArena("ModelA", undefined, uriA);
    const daeB1 = ctx.flattenArena("ModelB", undefined, uriB);
    assert(daeA1 !== null && daeB1 !== null);

    const ws = (ctx as any).workspaceIndex;
    const revA1 = ws.getFileStructuralRevision(uriA);
    const revB1 = ws.getFileStructuralRevision(uriB);

    const bCacheEntryBefore = (ctx as any)._daeBodyCache?.get(`${uriB}:ModelB`);
    assert(bCacheEntryBefore, "ModelB must have cached bodySnapshot");

    // Perform a structural edit on ModelA: add a new variable and equation
    const srcA2 = `model ModelA
  Real a;
  Real a2;
equation
  a = 1.0;
  a2 = 5.0;
end ModelA;`;

    ctx.load(srcA2, uriA);

    // Verify file-scoped structural revision
    const revA2 = ws.getFileStructuralRevision(uriA);
    const revB2 = ws.getFileStructuralRevision(uriB);
    assert(revA2 > revA1, "ModelA file structural revision must have advanced");
    assert.strictEqual(revB2, revB1, "ModelB file structural revision must remain unchanged");

    // Flatten ModelB -> must hit cache in O(1) without re-flattening!
    const t0 = performance.now();
    const daeB2 = ctx.flattenArena("ModelB", undefined, uriB);
    const bElapsed = performance.now() - t0;
    console.log(`  -> ModelB cache hit took: ${bElapsed.toFixed(4)} ms`);

    const bCacheEntryAfter = (ctx as any)._daeBodyCache?.get(`${uriB}:ModelB`);
    assert.strictEqual(
      bCacheEntryAfter.builder,
      bCacheEntryBefore.builder,
      "ModelB bodySnapshot must remain untouched in cache despite structural change in ModelA",
    );
    assert.strictEqual(daeB2?.varCount, 1, "ModelB must still have 1 variable");
    console.log("  ✓ Test 4 passed: Cross-model cache isolation verified!");
  }

  console.log("=== All Incremental Bottlenecks Tests Passed Successfully! ===");
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
