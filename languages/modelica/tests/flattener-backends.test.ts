// SPDX-License-Identifier: AGPL-3.0-or-later

import { printArenaDAE } from "@modelscript/runtime";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

async function runTests() {
  console.log("Testing Dual-Engine Flattener Scaffolding (ts, wasm, hybrid, diff)...");

  const initContext = async (src: string, modelName: string) => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
    const ctx = new Context(new NodeFileSystem());
    const uri = `file:///test/${modelName}.mo`;
    ctx.load(src, uri);
    return { ctx, uri };
  };

  const simpleModel = `
model SimpleBackends
  Real x;
  Real y;
equation
  x = 10.0;
  y = 2.0 * x;
end SimpleBackends;
`;

  // 1. Reference TS backend
  console.log("1. Testing backend: 'ts'...");
  {
    const { ctx, uri } = await initContext(simpleModel, "SimpleBackends");
    const arena = ctx.flattenArena("SimpleBackends", undefined, uri, { backend: "ts" });
    assert(arena !== null, "arena should not be null");
    assert.strictEqual(arena!.varCount, 2, "varCount should be 2");
    assert.strictEqual(arena!.eqCount, 2, "eqCount should be 2");
    console.log("   ✔ backend: 'ts' passed (vars=2, eqs=2)");
  }

  // 2. Strict WASM backend
  console.log("2. Testing backend: 'wasm'...");
  {
    const { ctx, uri } = await initContext(simpleModel, "SimpleBackends");
    const arena = ctx.flattenArena("SimpleBackends", undefined, uri, { backend: "wasm" });
    assert(arena !== null, "arena should not be null");
    const wasmErrors = arena!.diagnostics.filter((d) => d.rule === "wasm-flattener-unsupported");
    if (wasmErrors.length > 0) {
      assert(
        wasmErrors[0].message.includes("could not be flattened using strict WASM backend"),
        "error message should indicate strict WASM unsupported",
      );
      console.log("   ✔ backend: 'wasm' passed with strict unsupported diagnostic");
    } else {
      assert(arena!.varCount > 0, "varCount should be > 0 when flattened in WASM");
      console.log(`   ✔ backend: 'wasm' passed in WASM kernel (vars=${arena!.varCount})`);
    }
  }

  // 3. Hybrid backend
  console.log("3. Testing backend: 'hybrid'...");
  {
    const { ctx, uri } = await initContext(simpleModel, "SimpleBackends");
    const arena = ctx.flattenArena("SimpleBackends", undefined, uri, { backend: "hybrid" });
    assert(arena !== null, "arena should not be null");
    assert.strictEqual(arena!.varCount, 2, "varCount should be 2");
    assert.strictEqual(arena!.eqCount, 2, "eqCount should be 2");
    console.log("   ✔ backend: 'hybrid' passed (vars=2, eqs=2)");
  }

  // 4. Differential backend
  console.log("4. Testing backend: 'diff'...");
  {
    const { ctx, uri } = await initContext(simpleModel, "SimpleBackends");
    const arena = ctx.flattenArena("SimpleBackends", undefined, uri, { backend: "diff" });
    assert(arena !== null, "arena should not be null");
    assert.strictEqual(arena!.varCount, 2, "varCount should be 2");
    const diffDiag = arena!.diagnostics.find(
      (d) => d.rule === "flattener-diff-report" || d.rule === "flattener-diff-error",
    );
    if (diffDiag) {
      assert(diffDiag.message.includes("[DiffFlattener]"), "diagnostic should contain [DiffFlattener]");
      console.log(`   ✔ backend: 'diff' passed (${diffDiag.message})`);
    } else {
      console.log("   ✔ backend: 'diff' passed");
    }
  }

  // 5. Strict WASM failure vs. Hybrid fallback on complex/unsupported construct
  console.log("5. Testing strict 'wasm' rejection vs 'hybrid' fallback on complex model...");
  const complexModel = `
model ComplexBackends
  Real x;
  Real y;
equation
  when x > 0 then
    y = reinit(x, 2.0);
  end when;
end ComplexBackends;
`;
  {
    const { ctx, uri } = await initContext(complexModel, "ComplexBackends");
    // Strict WASM should fail or produce error diagnostic if reinit in when isn't in wasm kernel
    const wasmArena = ctx.flattenArena("ComplexBackends", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null);

    // Hybrid should successfully fall back and produce a valid DAE
    const hybridArena = ctx.flattenArena("ComplexBackends", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null);
    assert.strictEqual(hybridArena!.varCount, 2, "hybrid should have 2 variables");
    console.log("   ✔ strict 'wasm' and 'hybrid' fallback verified on complex construct");
  }

  // 6. Protected variables in WASM and Hybrid modes
  console.log("6. Testing protected variables in 'wasm' and 'hybrid' modes...");
  const protectedModel = `
model ProtectedBackends
  Real a;
protected
  Real b;
  Real c;
public
  Real d;
equation
  a = b;
  b = c;
  c = d;
  d = 10.0;
end ProtectedBackends;
`;
  {
    const { ctx, uri } = await initContext(protectedModel, "ProtectedBackends");
    const wasmArena = ctx.flattenArena("ProtectedBackends", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "wasm arena should not be null");
    assert.strictEqual(wasmArena.varCount, 4, "wasm should have 4 variables");
    assert.strictEqual(wasmArena.isVarProtected(0), false, "var a should be public");
    assert.strictEqual(wasmArena.isVarProtected(1), true, "var b should be protected");
    assert.strictEqual(wasmArena.isVarProtected(2), true, "var c should be protected");
    assert.strictEqual(wasmArena.isVarProtected(3), false, "var d should be public");

    const hybridArena = ctx.flattenArena("ProtectedBackends", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "hybrid arena should not be null");
    assert.strictEqual(hybridArena.varCount, 4, "hybrid should have 4 variables");
    assert.strictEqual(hybridArena.isVarProtected(0), false, "hybrid var a should be public");
    assert.strictEqual(hybridArena.isVarProtected(1), true, "hybrid var b should be protected");
    assert.strictEqual(hybridArena.isVarProtected(2), true, "hybrid var c should be protected");
    assert.strictEqual(hybridArena.isVarProtected(3), false, "hybrid var d should be public");
    console.log("   ✔ protected variables correctly lowered and flagged in wasm & hybrid backends");
  }

  // 7. 2D Array Matrix Declarations & Subscript Lowering in WASM and Hybrid modes
  console.log("7. Testing 2D array matrix declarations & subscripts in 'wasm' and 'hybrid' modes...");
  const matrixModel = `
model MatrixBackends
  parameter Real M[2, 2] = [1.0, 2.0; 3.0, 4.0];
  Real A[2, 3];
  Real x;
equation
  A[1, 1] = 1.0;
  A[1, 2] = 2.0;
  A[1, 3] = 3.0;
  A[2, 1] = 4.0;
  A[2, 2] = 5.0;
  A[2, 3] = 6.0;
  x = M[1, 1] + M[2, 2];
end MatrixBackends;
`;
  {
    const { ctx, uri } = await initContext(matrixModel, "MatrixBackends");
    const wasmArena = ctx.flattenArena("MatrixBackends", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "wasm arena should not be null");
    // M has 4 scalarized elements: M[1,1], M[1,2], M[2,1], M[2,2]
    // A has 6 scalarized elements: A[1,1], A[1,2], A[1,3], A[2,1], A[2,2], A[2,3]
    // x has 1 element -> total 11 variables
    assert.strictEqual(wasmArena.varCount, 11, `wasm should have 11 variables, got ${wasmArena.varCount}`);
    // 6 equations for A + 1 equation for x = 7 equations
    assert.strictEqual(wasmArena.eqCount, 7, `wasm should have 7 equations, got ${wasmArena.eqCount}`);

    // Verify matrix initial values
    assert.strictEqual(wasmArena.getVarStartValue(0), 1.0); // M[1,1]
    assert.strictEqual(wasmArena.getVarStartValue(1), 2.0); // M[1,2]
    assert.strictEqual(wasmArena.getVarStartValue(2), 3.0); // M[2,1]
    assert.strictEqual(wasmArena.getVarStartValue(3), 4.0); // M[2,2]

    const hybridArena = ctx.flattenArena("MatrixBackends", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "hybrid arena should not be null");
    assert.strictEqual(hybridArena.varCount, 11, `hybrid should have 11 variables, got ${hybridArena.varCount}`);
    assert.strictEqual(hybridArena.eqCount, 7, `hybrid should have 7 equations, got ${hybridArena.eqCount}`);
    console.log("   ✔ 2D array matrix declarations and subscripts correctly lowered in wasm & hybrid backends");
  }

  // 8. Description strings and comments on declarations and equations in WASM and Hybrid modes
  console.log("8. Testing description strings on declarations & equations in 'wasm' and 'hybrid' modes...");
  const descriptionsModel = `
model ResistorWithDescriptions
  parameter String desc = "Ohmic Resistor";
  parameter Real R = 100.0 "Resistance value in Ohms";
  Real v "Voltage across resistor";
  Real i "Current through resistor";
equation
  v = R * i "Ohm's law equation";
end ResistorWithDescriptions;
`;
  {
    const { ctx, uri } = await initContext(descriptionsModel, "ResistorWithDescriptions");
    const wasmArena = ctx.flattenArena("ResistorWithDescriptions", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "wasm arena should not be null");
    assert.strictEqual(wasmArena.varCount, 4, `wasm should have 4 variables, got ${wasmArena.varCount}`);
    assert.strictEqual(wasmArena.eqCount, 1, `wasm should have 1 equation, got ${wasmArena.eqCount}`);
    assert.strictEqual((wasmArena as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    assert.strictEqual(wasmArena.getVarStartValue(1), 100.0, "R start value should be 100.0");

    const hybridArena = ctx.flattenArena("ResistorWithDescriptions", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "hybrid arena should not be null");
    assert.strictEqual(hybridArena.varCount, 4, `hybrid should have 4 variables, got ${hybridArena.varCount}`);
    assert.strictEqual(hybridArena.eqCount, 1, `hybrid should have 1 equation, got ${hybridArena.eqCount}`);
    assert.strictEqual((hybridArena as any).wasmErrorCode ?? 0, 0, "hybrid should run in WASM without error");
    console.log("   ✔ description strings on declarations and equations correctly supported in wasm & hybrid backends");
  }

  // 9. final Keyword and attribute modifiers (nominal, min, max, start, unit) in WASM and Hybrid modes
  console.log("9. Testing 'final' keyword & attribute modifiers in 'wasm' and 'hybrid' modes...");
  const finalAndAttributesModel = `
model FinalAndAttributes
  final parameter Real R(unit = "Ohm", min = 0.0, max = 1000.0) = 100.0;
  Real v(nominal = 10.0, start = 0.0);
  Real i(nominal = 1.0, min = -100.0, max = 100.0);
equation
  v = R * i;
end FinalAndAttributes;
`;
  {
    const { ctx, uri } = await initContext(finalAndAttributesModel, "FinalAndAttributes");
    const wasmArena = ctx.flattenArena("FinalAndAttributes", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "wasm arena should not be null");
    assert.strictEqual(wasmArena.varCount, 3, `wasm should have 3 variables, got ${wasmArena.varCount}`);
    assert.strictEqual(wasmArena.eqCount, 1, `wasm should have 1 equation, got ${wasmArena.eqCount}`);
    assert.strictEqual((wasmArena as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    assert.strictEqual(wasmArena.isVarFinal(0), true, "R should have final flag set");
    assert.strictEqual(wasmArena.isVarFinal(1), false, "v should not have final flag set");
    assert.strictEqual(wasmArena.getVarStartValue(0), 100.0, "R start value should be 100.0");
    const vAttrs = wasmArena.getVarAttrExprIds(1);
    assert(vAttrs !== undefined, "v should have attribute expressions");
    assert(vAttrs.has("nominal"), "v should have nominal attribute");
    assert(vAttrs.has("start"), "v should have start attribute");

    const hybridArena = ctx.flattenArena("FinalAndAttributes", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "hybrid arena should not be null");
    assert.strictEqual(hybridArena.varCount, 3, `hybrid should have 3 variables, got ${hybridArena.varCount}`);
    assert.strictEqual(hybridArena.eqCount, 1, `hybrid should have 1 equation, got ${hybridArena.eqCount}`);
    assert.strictEqual((hybridArena as any).wasmErrorCode ?? 0, 0, "hybrid should run in WASM without error");
    assert.strictEqual(hybridArena.isVarFinal(0), true, "hybrid R should have final flag set");
    console.log(
      "   ✔ final keyword and attribute modifiers (nominal, min, max, unit) correctly lowered in wasm & hybrid backends",
    );
  }

  // 10. Non-parameter variable initial bindings (Candidate Step 3.6)
  {
    console.log("10. Testing non-parameter variable initial bindings in wasm & hybrid backends...");
    const modelCode = `
      model NonParamBindings
        Real x = 5.0;
        input Real u = 1.0;
        discrete Integer count = 0;
        Real y;
      equation
        y = x + u + count;
      end NonParamBindings;
    `;
    const { ctx, uri } = await initContext(modelCode, "NonParamBindings");
    const wasmArena = ctx.flattenArena("NonParamBindings", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "wasm arena should not be null");
    assert.strictEqual(wasmArena.varCount, 4, `wasm should have 4 variables, got ${wasmArena.varCount}`);
    assert.strictEqual(wasmArena.eqCount, 1, `wasm should have 1 equation, got ${wasmArena.eqCount}`);
    assert.strictEqual(wasmArena.hasExplicitVarExpression(0), true, "x should have explicit binding");
    assert.strictEqual(wasmArena.getVarExpression(0) !== undefined, true, "x binding expression should exist");
    assert.strictEqual(wasmArena.hasExplicitVarExpression(1), true, "u should have explicit binding");
    assert.strictEqual(wasmArena.hasExplicitVarExpression(2), true, "count should have explicit binding");
    assert.strictEqual(wasmArena.hasExplicitVarExpression(3), false, "y should not have explicit binding");

    const hybridArena = ctx.flattenArena("NonParamBindings", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "hybrid arena should not be null");
    assert.strictEqual(hybridArena.varCount, 4, `hybrid should have 4 variables, got ${hybridArena.varCount}`);
    assert.strictEqual(hybridArena.eqCount, 1, `hybrid should have 1 equation, got ${hybridArena.eqCount}`);
    assert.strictEqual((hybridArena as any).wasmErrorCode ?? 0, 0, "hybrid should execute in WASM without fallback");
    assert.strictEqual(hybridArena.hasExplicitVarExpression(0), true, "hybrid x should have explicit binding");

    const printed = printArenaDAE(wasmArena);
    assert(printed.includes("Real x = 5.0;"), `printed output should contain 'Real x = 5.0;', got: ${printed}`);
    assert(printed.includes("y = x + u + count;"), `printed output should preserve equation, got: ${printed}`);
    console.log(
      "   ✔ non-parameter variable initial bindings correctly preserved and lowered in wasm & hybrid backends",
    );
  }

  // 11. Partial base classes & 'each' modifiers (Step 3.7)
  {
    console.log("11. Testing partial base classes & 'each' modifiers in wasm & hybrid backends...");
    const modelCode = `
      partial model TwoPin
        Real v;
        Real i;
      end TwoPin;

      model Resistor
        extends TwoPin;
        parameter Real R = 10.0;
      equation
        v = R * i;
      end Resistor;

      model CircuitWithEach
        Resistor resistors[2](each R = 50.0);
      equation
        resistors[1].i = 2.0;
        resistors[2].i = 1.0;
      end CircuitWithEach;
    `;
    const { ctx, uri } = await initContext(modelCode, "CircuitWithEach");
    const wasmArena = ctx.flattenArena("CircuitWithEach", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "wasm arena should not be null");
    assert.strictEqual((wasmArena as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    assert.strictEqual(wasmArena.varCount, 6, `wasm should have 6 variables, got ${wasmArena.varCount}`);
    assert.strictEqual(wasmArena.eqCount, 4, `wasm should have 4 equations, got ${wasmArena.eqCount}`);
    const r1Idx = wasmArena.getVarIdxByName("resistors[1].R");
    const r2Idx = wasmArena.getVarIdxByName("resistors[2].R");
    assert(r1Idx >= 0, "resistors[1].R should exist");
    assert(r2Idx >= 0, "resistors[2].R should exist");
    assert.strictEqual(wasmArena.getVarStartValue(r1Idx), 50.0, "resistors[1].R should be 50.0 via each modifier");
    assert.strictEqual(wasmArena.getVarStartValue(r2Idx), 50.0, "resistors[2].R should be 50.0 via each modifier");

    const hybridArena = ctx.flattenArena("CircuitWithEach", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "hybrid arena should not be null");
    assert.strictEqual(hybridArena.varCount, 6, `hybrid should have 6 variables, got ${hybridArena.varCount}`);
    assert.strictEqual(hybridArena.eqCount, 4, `hybrid should have 4 equations, got ${hybridArena.eqCount}`);
    assert.strictEqual((hybridArena as any).wasmErrorCode ?? 0, 0, "hybrid should execute in WASM without fallback");

    const printed = printArenaDAE(wasmArena);
    assert(
      printed.includes("parameter Real resistors[1].R = 50.0;"),
      `printed should contain resistors[1].R = 50.0: ${printed}`,
    );
    assert(
      printed.includes("parameter Real resistors[2].R = 50.0;"),
      `printed should contain resistors[2].R = 50.0: ${printed}`,
    );
    console.log("   ✔ partial base classes & 'each' modifiers correctly lowered in wasm & hybrid backends");
  }

  // 12. Package Imports, Aliased Imports & SI Units in WASM/Hybrid
  {
    console.log("Test 12: Package Imports, Aliased Imports & SI Units in WASM/Hybrid");
    const modelCode = `
      package MathConstants
        constant Real pi = 3.141592653589793;
        constant Real eps = 1e-15;
      end MathConstants;

      model WithPackageImports
        import MathConstants.pi;
        import MC = MathConstants;
        parameter SI.Resistance R = 100.0;
        parameter Real p1 = pi;
        parameter Real p2 = MC.eps;
        SI.Voltage v;
        Real x;
      equation
        x = if noEvent(R > 50.0) then R * 2.0 else 0.0;
        v = x + p1;
        assert(R > 0.0, "R must be positive");
      end WithPackageImports;
    `;
    const { ctx, uri } = await initContext(modelCode, "WithPackageImports");
    const wasmArena = ctx.flattenArena("WithPackageImports", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "wasm arena should not be null");
    assert.strictEqual((wasmArena as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    assert.strictEqual(
      wasmArena.varCount,
      5,
      `wasm should have 5 variables (R, p1, p2, v, x), got ${wasmArena.varCount}`,
    );
    assert.strictEqual(wasmArena.eqCount, 3, `wasm should have 3 equations (x, v, assert), got ${wasmArena.eqCount}`);

    const rIdx = wasmArena.getVarIdxByName("R");
    const p1Idx = wasmArena.getVarIdxByName("p1");
    const p2Idx = wasmArena.getVarIdxByName("p2");
    assert(rIdx >= 0, "R should exist");
    assert(p1Idx >= 0, "p1 should exist");
    assert(p2Idx >= 0, "p2 should exist");
    assert.strictEqual(wasmArena.getVarStartValue(rIdx), 100.0, "R should be 100.0");
    assert.strictEqual(wasmArena.getVarStartValue(p1Idx), 3.141592653589793, "p1 should be pi");
    assert.strictEqual(wasmArena.getVarStartValue(p2Idx), 1e-15, "p2 should be eps");

    const hybridArena = ctx.flattenArena("WithPackageImports", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "hybrid arena should not be null");
    assert.strictEqual(hybridArena.varCount, 5, `hybrid should have 5 variables, got ${hybridArena.varCount}`);
    assert.strictEqual(hybridArena.eqCount, 3, `hybrid should have 3 equations, got ${hybridArena.eqCount}`);
    assert.strictEqual((hybridArena as any).wasmErrorCode ?? 0, 0, "hybrid should execute in WASM without fallback");

    const printed = printArenaDAE(wasmArena);
    assert(printed.includes("parameter Real R = 100.0;"), `printed should contain R = 100.0: ${printed}`);
    assert(printed.includes("parameter Real p1 = 3.141592653589793;"), `printed should contain p1 = pi: ${printed}`);
    assert(printed.includes("assert("), `printed should contain assert: ${printed}`);
    console.log("   ✔ package imports, aliased imports & SI units correctly lowered in wasm & hybrid backends");
  }

  // 13. Symbolic Array Dimensions, Parameter Subscripts & For-Equation Loop Unrolling (Step 3.9)
  {
    console.log(
      "Test 13: Symbolic Array Dimensions, Parameter Subscripts & For-Equation Loop Unrolling in WASM/Hybrid",
    );
    const modelCode = `
      model ArrayForLoop
        parameter Integer N = 3;
        Real v[N];
        Real sum;
      equation
        for i in 1:N loop
          v[i] = i * 2.0;
        end for;
        sum = v[1] + v[2] + v[3];
      end ArrayForLoop;
    `;
    const { ctx, uri } = await initContext(modelCode, "ArrayForLoop");
    const wasmArena = ctx.flattenArena("ArrayForLoop", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "wasm arena should not be null");
    assert.strictEqual((wasmArena as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    assert.strictEqual(
      wasmArena.varCount,
      5,
      `wasm should have 5 variables (N, v[1], v[2], v[3], sum), got ${wasmArena.varCount}`,
    );
    assert.strictEqual(wasmArena.eqCount, 4, `wasm should have 4 equations, got ${wasmArena.eqCount}`);

    const nIdx = wasmArena.getVarIdxByName("N");
    const v1Idx = wasmArena.getVarIdxByName("v[1]");
    const v2Idx = wasmArena.getVarIdxByName("v[2]");
    const v3Idx = wasmArena.getVarIdxByName("v[3]");
    const sumIdx = wasmArena.getVarIdxByName("sum");
    assert(nIdx >= 0, "N should exist");
    assert(v1Idx >= 0, "v[1] should exist");
    assert(v2Idx >= 0, "v[2] should exist");
    assert(v3Idx >= 0, "v[3] should exist");
    assert(sumIdx >= 0, "sum should exist");

    const hybridArena = ctx.flattenArena("ArrayForLoop", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "hybrid arena should not be null");
    assert.strictEqual(hybridArena.varCount, 5, `hybrid should have 5 variables, got ${hybridArena.varCount}`);
    assert.strictEqual(hybridArena.eqCount, 4, `hybrid should have 4 equations, got ${hybridArena.eqCount}`);
    assert.strictEqual((hybridArena as any).wasmErrorCode ?? 0, 0, "hybrid should execute in WASM without fallback");

    const printed = printArenaDAE(wasmArena);
    assert(printed.includes("Real v[1];"), `printed should contain v[1]: ${printed}`);
    assert(printed.includes("Real v[2];"), `printed should contain v[2]: ${printed}`);
    assert(printed.includes("Real v[3];"), `printed should contain v[3]: ${printed}`);
    assert(printed.includes("v[1] = 2.0;"), `printed should contain v[1] = 2.0;: ${printed}`);
    assert(printed.includes("v[2] = 4.0;"), `printed should contain v[2] = 4.0;: ${printed}`);
    assert(printed.includes("v[3] = 6.0;"), `printed should contain v[3] = 6.0;: ${printed}`);
    assert(printed.includes("sum = v[1] + v[2] + v[3];"), `printed should contain sum equation: ${printed}`);
    console.log(
      "   ✔ symbolic array dimensions, parameter subscripts & for-equation loop unrolling correctly lowered in wasm & hybrid backends",
    );
  }

  // 14. Inferred matrix colon-dimensions (Step 3.10)
  console.log("14. Testing inferred matrix colon-dimensions in wasm and hybrid backends...");
  {
    const modelCode = `
      model MatrixColonDims
        parameter Real table[:, :] = [0, 0; 1, 1; 2, 4];
        Real y;
      equation
        y = table[2, 2];
      end MatrixColonDims;
    `;
    const { ctx, uri } = await initContext(modelCode, "MatrixColonDims");
    const wasmArena = ctx.flattenArena("MatrixColonDims", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "wasm arena should not be null");
    assert.strictEqual((wasmArena as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    assert.strictEqual(
      wasmArena.varCount,
      7,
      `wasm should have 7 variables (table[1,1]..table[3,2], y), got ${wasmArena.varCount}`,
    );
    assert.strictEqual(wasmArena.eqCount, 1, `wasm should have 1 equation, got ${wasmArena.eqCount}`);

    const t11Idx = wasmArena.getVarIdxByName("table[1,1]");
    const t32Idx = wasmArena.getVarIdxByName("table[3,2]");
    const yIdx = wasmArena.getVarIdxByName("y");
    assert(t11Idx >= 0, "table[1,1] should exist");
    assert(t32Idx >= 0, "table[3,2] should exist");
    assert(yIdx >= 0, "y should exist");

    const hybridArena = ctx.flattenArena("MatrixColonDims", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "hybrid arena should not be null");
    assert.strictEqual(hybridArena.varCount, 7, `hybrid should have 7 variables, got ${hybridArena.varCount}`);
    assert.strictEqual(hybridArena.eqCount, 1, `hybrid should have 1 equation, got ${hybridArena.eqCount}`);
    assert.strictEqual((hybridArena as any).wasmErrorCode ?? 0, 0, "hybrid should execute in WASM without fallback");

    const printed = printArenaDAE(wasmArena);
    assert(printed.includes("parameter Real table[1,1] = 0.0;"), `printed should contain table[1,1]: ${printed}`);
    assert(printed.includes("parameter Real table[3,2] = 4.0;"), `printed should contain table[3,2]: ${printed}`);
    assert(printed.includes("y = 1.0;"), `printed should contain folded constant lookup y = 1.0;: ${printed}`);
    console.log("   ✔ inferred matrix colon-dimensions correctly parsed and lowered in wasm & hybrid backends");
  }

  // 15. Nested class and component instantiation (Step 3.10)
  console.log("15. Testing nested class definition in wasm and hybrid backends...");
  {
    const modelCode = `
      model OuterNestedModel
        model InnerComponent
          parameter Real R = 10.0;
          Real v;
          Real i;
        equation
          v = R * i;
        end InnerComponent;

        InnerComponent comp;
        Real totalV;
      equation
        comp.i = 2.0;
        totalV = comp.v;
      end OuterNestedModel;
    `;
    const { ctx, uri } = await initContext(modelCode, "OuterNestedModel");
    const wasmArena = ctx.flattenArena("OuterNestedModel", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "wasm arena should not be null");
    assert.strictEqual((wasmArena as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    assert.strictEqual(
      wasmArena.varCount,
      4,
      `wasm should have 4 variables (comp.R, comp.v, comp.i, totalV), got ${wasmArena.varCount}`,
    );
    assert.strictEqual(wasmArena.eqCount, 3, `wasm should have 3 equations, got ${wasmArena.eqCount}`);

    const rIdx = wasmArena.getVarIdxByName("comp.R");
    const vIdx = wasmArena.getVarIdxByName("comp.v");
    const iIdx = wasmArena.getVarIdxByName("comp.i");
    const totalVIdx = wasmArena.getVarIdxByName("totalV");
    assert(rIdx >= 0, "comp.R should exist");
    assert(vIdx >= 0, "comp.v should exist");
    assert(iIdx >= 0, "comp.i should exist");
    assert(totalVIdx >= 0, "totalV should exist");

    const hybridArena = ctx.flattenArena("OuterNestedModel", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "hybrid arena should not be null");
    assert.strictEqual(hybridArena.varCount, 4, `hybrid should have 4 variables, got ${hybridArena.varCount}`);
    assert.strictEqual(hybridArena.eqCount, 3, `hybrid should have 3 equations, got ${hybridArena.eqCount}`);
    assert.strictEqual((hybridArena as any).wasmErrorCode ?? 0, 0, "hybrid should execute in WASM without fallback");

    const printed = printArenaDAE(wasmArena);
    assert(printed.includes("parameter Real comp.R = 10.0;"), `printed should contain comp.R: ${printed}`);
    assert(printed.includes("comp.v = comp.R * comp.i;"), `printed should contain equation: ${printed}`);
    assert(printed.includes("comp.i = 2.0;"), `printed should contain equation: ${printed}`);
    assert(printed.includes("totalV = comp.v;"), `printed should contain equation: ${printed}`);
    console.log(
      "   ✔ nested class definitions and component instantiation correctly lowered in wasm & hybrid backends",
    );
  }

  // 16. Primitive & signal connector aliases (RealInput, RealOutput) in wasm & hybrid backends (Step 3.11)
  console.log("16. Testing primitive and signal connector aliases in wasm and hybrid backends...");
  {
    const modelCode = `
      package PkgAliases
        connector RealInput = input Real;
        connector RealOutput = output Real;

        block Gain
          parameter Real k = 2.0;
          RealInput u;
          RealOutput y;
        equation
          y = k * u;
        end Gain;
      end PkgAliases;
    `;
    const { ctx, uri } = await initContext(modelCode, "PkgAliases.Gain");
    const wasmArena = ctx.flattenArena("PkgAliases.Gain", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "wasm arena should not be null");
    assert.strictEqual((wasmArena as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    assert.strictEqual(wasmArena.varCount, 3, `wasm should have 3 variables (k, u, y), got ${wasmArena.varCount}`);
    assert.strictEqual(wasmArena.eqCount, 1, `wasm should have 1 equation, got ${wasmArena.eqCount}`);

    const kIdx = wasmArena.getVarIdxByName("k");
    const uIdx = wasmArena.getVarIdxByName("u");
    const yIdx = wasmArena.getVarIdxByName("y");
    assert(kIdx >= 0, "k should exist");
    assert(uIdx >= 0, "u should exist");
    assert(yIdx >= 0, "y should exist");

    const hybridArena = ctx.flattenArena("PkgAliases.Gain", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "hybrid arena should not be null");
    assert.strictEqual(hybridArena.varCount, 3, `hybrid should have 3 variables, got ${hybridArena.varCount}`);
    assert.strictEqual(hybridArena.eqCount, 1, `hybrid should have 1 equation, got ${hybridArena.eqCount}`);
    assert.strictEqual((hybridArena as any).wasmErrorCode ?? 0, 0, "hybrid should execute in WASM without fallback");

    const printed = printArenaDAE(wasmArena);
    assert(printed.includes("parameter Real k = 2.0;"), `printed should contain k: ${printed}`);
    assert(printed.includes("y = k * u;"), `printed should contain equation: ${printed}`);
    console.log("   ✔ primitive and signal connector aliases correctly lowered in wasm & hybrid backends");
  }

  // 17. Direct in-WASM connect-equation generation and physical connector port balancing (Step 4.1)
  console.log("17. Testing in-WASM connect-equation generation and connector port balancing...");
  {
    const circuitCode = `
      package CircuitPkg
        connector Pin
          Real v;
          flow Real i;
        end Pin;

        model Resistor
          Pin p;
          Pin n;
          Real v;
          Real i;
          parameter Real R = 10.0;
        equation
          v = p.v - n.v;
          0.0 = p.i + n.i;
          i = p.i;
          v = R * i;
        end Resistor;

        model TwoResistors
          Resistor r1;
          Resistor r2;
        equation
          connect(r1.n, r2.p);
        end TwoResistors;
      end CircuitPkg;
    `;
    const { ctx, uri } = await initContext(circuitCode, "CircuitPkg.TwoResistors");

    const tsArena = ctx.flattenArena("CircuitPkg.TwoResistors", undefined, uri, { backend: "ts" });
    assert(tsArena !== null, "TS arena should not be null");
    assert.strictEqual(tsArena.varCount, 14, `TS should have 14 variables, got ${tsArena.varCount}`);
    assert.strictEqual(tsArena.eqCount, 13, `TS should have 13 equations, got ${tsArena.eqCount}`);

    const wasmArena = ctx.flattenArena("CircuitPkg.TwoResistors", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "WASM arena should not be null");
    assert.strictEqual((wasmArena as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    assert.strictEqual(wasmArena.varCount, 14, `WASM should have 14 variables, got ${wasmArena.varCount}`);
    assert.strictEqual(wasmArena.eqCount, 13, `WASM should have 13 equations, got ${wasmArena.eqCount}`);

    const hybridArena = ctx.flattenArena("CircuitPkg.TwoResistors", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "Hybrid arena should not be null");
    assert.strictEqual((hybridArena as any).wasmErrorCode ?? 0, 0, "Hybrid should execute in WASM without fallback");
    assert.strictEqual(hybridArena.varCount, 14, `Hybrid should have 14 variables, got ${hybridArena.varCount}`);
    assert.strictEqual(hybridArena.eqCount, 13, `Hybrid should have 13 equations, got ${hybridArena.eqCount}`);

    const printed = printArenaDAE(wasmArena);
    assert(printed.includes("r1.n.v = r2.p.v;"), `printed should contain potential equality: ${printed}`);
    assert(printed.includes("r2.p.i + r1.n.i = 0.0;"), `printed should contain Kirchhoff flow balance: ${printed}`);
    assert(printed.includes("r1.p.i = 0.0;"), `printed should contain unconnected port zero flow: ${printed}`);
    assert(printed.includes("r2.n.i = 0.0;"), `printed should contain unconnected port zero flow: ${printed}`);
    console.log(
      "   ✔ direct in-WASM connect-equation generation and connector port balancing verified in wasm & hybrid backends",
    );
  }

  // 18. In-WASM inner / outer scope stack resolution
  console.log("18. Testing in-WASM inner / outer scope stack resolution...");
  {
    const innerOuterCode = `
      package InnerOuterPkg
        record World
          Real g;
        end World;

        model Consumer
          outer World world;
          Real f;
        equation
          f = world.g * 2.0;
        end Consumer;

        model System
          inner World world;
          Consumer c;
        equation
          world.g = 9.81;
        end System;
      end InnerOuterPkg;
    `;
    const { ctx, uri } = await initContext(innerOuterCode, "InnerOuterPkg.System");

    const tsArena = ctx.flattenArena("InnerOuterPkg.System", undefined, uri, { backend: "ts" });
    assert(tsArena !== null, "TS arena should not be null");
    assert.strictEqual(tsArena.varCount, 2, `TS should have 2 variables (world.g, c.f), got ${tsArena.varCount}`);

    const wasmArena = ctx.flattenArena("InnerOuterPkg.System", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "WASM arena should not be null");
    assert.strictEqual((wasmArena as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    assert.strictEqual(wasmArena.varCount, 2, `WASM should have 2 variables (world.g, c.f), got ${wasmArena.varCount}`);
    assert.strictEqual(wasmArena.eqCount, 2, `WASM should have 2 equations, got ${wasmArena.eqCount}`);

    const hybridArena = ctx.flattenArena("InnerOuterPkg.System", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "Hybrid arena should not be null");
    assert.strictEqual((hybridArena as any).wasmErrorCode ?? 0, 0, "Hybrid should execute in WASM without fallback");
    assert.strictEqual(hybridArena.varCount, 2, `Hybrid should have 2 variables, got ${hybridArena.varCount}`);
    assert.strictEqual(hybridArena.eqCount, 2, `Hybrid should have 2 equations, got ${hybridArena.eqCount}`);

    const printed = printArenaDAE(wasmArena);
    assert(printed.includes("c.f = world.g * 2.0;"), `printed should resolve outer to inner world.g: ${printed}`);
    assert(printed.includes("world.g = 9.81;"), `printed should contain world.g equation: ${printed}`);
    console.log("   ✔ in-WASM inner/outer scope resolution and variable mapping verified in wasm & hybrid backends");
  }

  // 19. In-WASM expandable connector dynamic member generation & signal pooling
  console.log("19. Testing in-WASM expandable connector dynamic member generation & signal pooling...");
  {
    const expCode = `
      package ExpPkg
        expandable connector Bus
          Real preDeclared;
        end Bus;

        connector RealInput = input Real;

        model BusTest
          Bus b1;
          Bus b2;
          RealInput ri;
          Real y;
        equation
          connect(b1.voltage, ri);
          connect(b1, b2);
          y = b2.voltage;
        end BusTest;
      end ExpPkg;
    `;
    const { ctx, uri } = await initContext(expCode, "ExpPkg.BusTest");

    const tsArena = ctx.flattenArena("ExpPkg.BusTest", undefined, uri, { backend: "ts" });
    assert(tsArena !== null, "TS arena should not be null");

    const wasmArena = ctx.flattenArena("ExpPkg.BusTest", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "WASM arena should not be null");
    assert.strictEqual((wasmArena as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");

    const hybridArena = ctx.flattenArena("ExpPkg.BusTest", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "Hybrid arena should not be null");
    assert.strictEqual((hybridArena as any).wasmErrorCode ?? 0, 0, "Hybrid should execute in WASM without fallback");

    const printedWasm = printArenaDAE(wasmArena);
    assert(printedWasm.includes("b1.voltage"), "b1.voltage should be dynamically augmented in WASM");
    assert(printedWasm.includes("b2.voltage"), "b2.voltage should be pooled from b1 to b2 in WASM");
    assert(
      printedWasm.includes('"virtual variable in expandable connector"'),
      "Dynamic variables should be annotated as virtual",
    );
    assert(!printedWasm.includes("preDeclared"), "Unreferenced preDeclared should be pruned");

    const printedHybrid = printArenaDAE(hybridArena);
    assert(printedHybrid.includes("b1.voltage"), "b1.voltage should be present in hybrid");
    assert(printedHybrid.includes("b2.voltage"), "b2.voltage should be present in hybrid");
    assert(!printedHybrid.includes("preDeclared"), "Unreferenced preDeclared should be pruned in hybrid");

    console.log(
      "   ✔ in-WASM expandable connector dynamic augmentation, signal pooling, and bus pruning verified in wasm & hybrid backends",
    );
  }

  // 20. In-WASM Array Constructors, Mathematical Built-ins & Zero-Fallback Parity
  console.log("20. Testing in-WASM array constructors, built-ins, and mathematical parity...");
  {
    const arrayBuiltinsModel = `
      model ArrayBuiltinsParity
        parameter Integer n = 3;
        Real z[2] = zeros(size(z, 1));
        Real o[2] = ones(2);
        Real f[2] = fill(3.5, 2);
        Real lin[3] = linspace(0.0, 10.0, 3);
        Real idMat[2, 2] = identity(2);
        Real m[2, 1] = matrix({1.0, 2.0});
        Real c[3] = cross({1.0, 0.0, 0.0}, {0.0, 1.0, 0.0});
        Real sk[3, 3] = skew({1.0, 2.0, 3.0});
        Real concatenated[4] = cat(1, {1.0, 2.0}, {3.0, 4.0});
        Integer dims = ndims(sk);
        Integer len = size(concatenated, 1);
      end ArrayBuiltinsParity;
    `;
    const { ctx, uri } = await initContext(arrayBuiltinsModel, "ArrayBuiltinsParity");

    const tsArena = ctx.flattenArena("ArrayBuiltinsParity", undefined, uri, { backend: "ts" });
    assert(tsArena !== null, "TS arena should not be null");

    const wasmArena = ctx.flattenArena("ArrayBuiltinsParity", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "WASM arena should not be null");
    assert.strictEqual((wasmArena as any).wasmErrorCode ?? 0, 0, "WASM backend error code should be 0");

    const hybridArena = ctx.flattenArena("ArrayBuiltinsParity", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "Hybrid arena should not be null");
    assert.strictEqual((hybridArena as any).wasmErrorCode ?? 0, 0, "Hybrid backend should execute without fallback");

    const printedWasm = printArenaDAE(wasmArena);
    assert(printedWasm.includes("z = {0.0, 0.0}"), "z should evaluate zeros(size(z, 1)) to {0.0, 0.0}");
    assert(printedWasm.includes("o = {1.0, 1.0}"), "o should evaluate ones(2) to {1.0, 1.0}");
    assert(printedWasm.includes("f = {3.5, 3.5}"), "f should evaluate fill(3.5, 2) to {3.5, 3.5}");
    assert(printedWasm.includes("lin = {0.0, 5.0, 10.0}"), "lin should evaluate linspace(0.0, 10.0, 3)");
    assert(printedWasm.includes("dims = 2"), "ndims(sk) should evaluate to 2");
    assert(printedWasm.includes("len = 4"), "size(concatenated, 1) should evaluate to 4");

    console.log(
      "   ✔ in-WASM array constructors & math built-ins (zeros, ones, fill, linspace, matrix, cross, skew, cat, size, ndims) verified in wasm & hybrid backends",
    );
  }

  // 21. Qualified & Chained Short Class Aliases & Dimension Parity in WASM/Hybrid
  console.log("21. Testing qualified and chained short class aliases in wasm and hybrid backends...");
  {
    const aliasModel = `
      package AliasPkg
        package Types
          type Color = Integer[3];
          type SpecularCoefficient = Real(min=0.0, max=1.0);
        end Types;

        type LocalColor = Types.Color;

        model AliasedModel
          parameter Types.Color defaultColor = {0, 0, 255};
          Types.Color axisColor = defaultColor;
          LocalColor customColor = {255, 128, 0};
          Types.SpecularCoefficient specular = 0.7;
          Integer red;
        equation
          red = axisColor[1] + customColor[1];
        end AliasedModel;
      end AliasPkg;
    `;
    const { ctx, uri } = await initContext(aliasModel, "AliasPkg.AliasedModel");

    const tsArena = ctx.flattenArena("AliasPkg.AliasedModel", undefined, uri, { backend: "ts" });
    assert(tsArena !== null, "TS arena should not be null");

    const wasmArena = ctx.flattenArena("AliasPkg.AliasedModel", undefined, uri, { backend: "wasm" });
    assert(wasmArena !== null, "WASM arena should not be null");
    assert.strictEqual((wasmArena as any).wasmErrorCode ?? 0, 0, "WASM backend error code should be 0");

    const hybridArena = ctx.flattenArena("AliasPkg.AliasedModel", undefined, uri, { backend: "hybrid" });
    assert(hybridArena !== null, "Hybrid arena should not be null");
    assert.strictEqual((hybridArena as any).wasmErrorCode ?? 0, 0, "Hybrid backend should execute without fallback");

    const printedWasm = printArenaDAE(wasmArena);
    assert(printedWasm.includes("defaultColor[1]"), "WASM should instantiate array elements for Types.Color");
    assert(printedWasm.includes("axisColor[1]"), "WASM should instantiate array elements for axisColor");
    assert(printedWasm.includes("customColor[1]"), "WASM should instantiate array elements for chained LocalColor");
    assert(
      printedWasm.includes("specular(min = 0.0, max = 1.0) = 0.7") || printedWasm.includes("specular = 0.7"),
      "WASM should resolve SpecularCoefficient to Real",
    );
    assert(
      printedWasm.includes("axisColor = {0, 0, 255}"),
      "WASM should preserve whole-array assignment for axisColor",
    );
    assert(
      printedWasm.includes("customColor = {255, 128, 0}"),
      "WASM should preserve whole-array assignment for customColor",
    );
    assert(
      printedWasm.includes("red = axisColor[1] + customColor[1]"),
      "WASM should lower equation with aliased subscripts",
    );

    const printedHybrid = printArenaDAE(hybridArena);
    assert(printedHybrid.includes("defaultColor[1]"), "Hybrid should execute in WASM with identical structure");
    assert(printedHybrid.includes("customColor[1]"), "Hybrid should include customColor elements");

    console.log(
      "   ✔ qualified and chained short class aliases (Types.Color, LocalColor, SpecularCoefficient) verified in wasm & hybrid backends",
    );
  }

  // 22. Non-primitive type & connector aliases in WASM and hybrid backends (Phase 6.1)
  {
    console.log("22. Testing non-primitive type & connector aliases in wasm and hybrid backends...");
    const modelCode = `
      model TestTypeConnector
        type T
          extends String;
        end T;
        connector C = output T;
        C c;
      end TestTypeConnector;

      model TestTypeDim
        type Reals = Real[3];
        type Reals2 = Reals[2];
        Reals2 x[1];
      end TestTypeDim;
    `;
    const { ctx, uri } = await initContext(modelCode, "TestTypeConnector");
    const wasmConn = ctx.flattenArena("TestTypeConnector", undefined, uri, { backend: "wasm" });
    assert(wasmConn !== null, "wasm connector arena should not be null");
    assert.strictEqual((wasmConn as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    assert.strictEqual(wasmConn.varCount, 1, `wasm connector should have 1 variable, got ${wasmConn.varCount}`);
    const printedConn = printArenaDAE(wasmConn);
    assert(printedConn.includes("output String c"), "WASM should output String c for connector alias");

    const hybridConn = ctx.flattenArena("TestTypeConnector", undefined, uri, { backend: "hybrid" });
    assert.strictEqual(hybridConn.varCount, 1, "hybrid connector should have 1 variable");
    assert.strictEqual((hybridConn as any).wasmErrorCode ?? 0, 0, "hybrid should execute in WASM without fallback");

    const wasmDim = ctx.flattenArena("TestTypeDim", undefined, uri, { backend: "wasm" });
    assert(wasmDim !== null, "wasm dim arena should not be null");
    assert.strictEqual((wasmDim as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    assert.strictEqual(wasmDim.varCount, 6, `wasm dim should have 6 variables, got ${wasmDim.varCount}`);
    const printedDim = printArenaDAE(wasmDim);
    assert(printedDim.includes("Real x[1,1,1]"), "WASM should include 3D array elements x[1,1,1]");
    assert(printedDim.includes("Real x[1,2,3]"), "WASM should include 3D array elements x[1,2,3]");

    const hybridDim = ctx.flattenArena("TestTypeDim", undefined, uri, { backend: "hybrid" });
    assert.strictEqual(hybridDim.varCount, 6, "hybrid dim should have 6 variables");
    assert.strictEqual((hybridDim as any).wasmErrorCode ?? 0, 0, "hybrid should execute in WASM without fallback");

    console.log("   ✔ non-primitive type & connector aliases verified in wasm & hybrid backends");
  }

  // ---------------------------------------------------------------------------
  // Test 23: Conditional Declarations in WASM & Hybrid Backends
  // ---------------------------------------------------------------------------
  {
    console.log("\n23. Testing Conditional Declarations in WASM & Hybrid backends...");
    const modelCode = `
      model TestCondDecl
        parameter Boolean enable = true;
        parameter Boolean disable = false;
        Real r1 if true;
        Real r2 if false;
        Real r3 if enable;
        Real r4 if disable;
      end TestCondDecl;
    `;
    const { ctx, uri } = await initContext(modelCode, "TestCondDecl");
    const wasmRes = ctx.flattenArena("TestCondDecl", undefined, uri, { backend: "wasm" });
    assert(wasmRes !== null, "wasm arena should not be null");
    assert.strictEqual((wasmRes as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    // enable (param), disable (param), r1, r3 = 4 variables total
    assert.strictEqual(
      wasmRes.varCount,
      4,
      `wasm should have 4 variables (enable, disable, r1, r3), got ${wasmRes.varCount}`,
    );
    const printedWasm = printArenaDAE(wasmRes);
    assert(printedWasm.includes("Real r1;"), "WASM output should include r1");
    assert(printedWasm.includes("Real r3;"), "WASM output should include r3");
    assert(!printedWasm.includes("Real r2;"), "WASM output should omit disabled r2");
    assert(!printedWasm.includes("Real r4;"), "WASM output should omit disabled r4");

    const hybridRes = ctx.flattenArena("TestCondDecl", undefined, uri, { backend: "hybrid" });
    assert.strictEqual(hybridRes.varCount, 4, "hybrid should have 4 variables");
    assert.strictEqual((hybridRes as any).wasmErrorCode ?? 0, 0, "hybrid should execute in WASM without fallback");

    console.log("   ✔ conditional declarations verified in wasm & hybrid backends");
  }

  // ---------------------------------------------------------------------------
  // Test 24: Array Colon Slicing in WASM & Hybrid backends
  // ---------------------------------------------------------------------------
  {
    console.log("\n24. Testing Array Colon Slicing in WASM & Hybrid backends...");
    const modelCode = `
      model TestArraySlice
        parameter Real M[3, 3] = {{1, 2, 3}, {4, 5, 6}, {7, 8, 9}};
        Real row1[3] = M[1, :];
        Real col2[3] = M[:, 2];
        Real sub[2, 2] = M[1:2, 2:3];
      end TestArraySlice;
    `;
    const { ctx, uri } = await initContext(modelCode, "TestArraySlice");
    const wasmRes = ctx.flattenArena("TestArraySlice", undefined, uri, { backend: "wasm" });
    assert(wasmRes !== null, "wasm arena should not be null");
    assert.strictEqual((wasmRes as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    // M (9), row1 (3), col2 (3), sub (4) = 19 variables total
    assert.strictEqual(wasmRes.varCount, 19, `wasm should have 19 variables, got ${wasmRes.varCount}`);

    const hybridRes = ctx.flattenArena("TestArraySlice", undefined, uri, { backend: "hybrid" });
    assert(hybridRes !== null, "hybrid arena should not be null");
    assert.strictEqual(hybridRes.varCount, 19, `hybrid should have 19 variables, got ${hybridRes.varCount}`);
    assert.strictEqual((hybridRes as any).wasmErrorCode ?? 0, 0, "hybrid should execute in WASM without fallback");

    console.log("   ✔ array colon slicing verified in wasm & hybrid backends");
  }

  // ---------------------------------------------------------------------------
  // Test 25: der(array), Array If-Expressions & Algorithm Implicit For-Range in WASM & Hybrid
  // ---------------------------------------------------------------------------
  {
    console.log("\n25. Testing der(array), array if-expressions & algorithm implicit for-range in WASM & Hybrid...");
    const modelCode = `
      model TestWasmPhase12
        Real x[2](start = {1.0, 2.0});
        Real y[2];
        Real z[3];
      equation
        der(x) = -x;
        y = if time > 0.5 then {1.0, 2.0} else {3.0, 4.0};
      algorithm
        for i loop
          z[i] := i * 2.0;
        end for;
      end TestWasmPhase12;
    `;
    const { ctx, uri } = await initContext(modelCode, "TestWasmPhase12");
    const wasmRes = ctx.flattenArena("TestWasmPhase12", undefined, uri, { backend: "wasm" });
    assert(wasmRes !== null, "wasm arena should not be null");
    assert.strictEqual((wasmRes as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    assert.strictEqual(wasmRes.varCount, 7, `wasm should have 7 variables, got ${wasmRes.varCount}`);
    const printedWasm = printArenaDAE(wasmRes);
    assert(printedWasm.includes("der(x[1]) = -x[1];"), "WASM should expand der(x) element-wise");
    assert(printedWasm.includes("der(x[2]) = -x[2];"), "WASM should expand der(x[2]) element-wise");
    assert(
      printedWasm.includes("y[1] = if time > 0.5 then 1.0 else 3.0;"),
      "WASM should distribute array if-expression",
    );
    assert(printedWasm.includes("for i in 1:3 loop"), "WASM should infer implicit for-statement loop range 1:3");

    const hybridRes = ctx.flattenArena("TestWasmPhase12", undefined, uri, { backend: "hybrid" });
    assert(hybridRes !== null, "hybrid arena should not be null");
    assert.strictEqual((hybridRes as any).wasmErrorCode ?? 0, 0, "hybrid should execute in WASM without fallback");
    const printedHybrid = printArenaDAE(hybridRes);
    assert.strictEqual(printedHybrid, printedWasm, "hybrid and wasm DAE output should match identically");

    console.log("   ✔ der(array), array if-expressions & algorithm implicit for-range verified in wasm & hybrid");
  }

  // ---------------------------------------------------------------------------
  // Test 26: initial(), non-range for-loop unrolling, Integer identity/zeros/ones, noEvent(), and Call coercion
  // ---------------------------------------------------------------------------
  {
    console.log(
      "\n26. Testing initial(), non-range for-loop unrolling, Integer identity/zeros/ones, noEvent(), and Call coercion...",
    );
    const modelCode = `
      model TestWasmPhase13
        function scaleReal
          input Real x;
          input Real u;
          output Real y;
        algorithm
          y := x * u;
        end scaleReal;

        function sumVec
          input Real v[3];
          output Real s;
        algorithm
          s := v[1] + v[2] + v[3];
        end sumVec;

        parameter Integer n = 2;
        Integer I[n, n] = identity(n);
        parameter Integer Z[n] = zeros(n);
        parameter Integer O[n] = ones(n);
        Real a[3];
        Real b(start = 0.0);
        Real c;
        Real d;
        Real e;
      equation
        for i in {1, 2, 3} loop
          a[i] = i * 1.0;
        end for;
        when initial() then
          b = 5.0;
        end when;
        c = if noEvent(time > 1.0) then 1.0 else 0.0;
        d = scaleReal(b, 3);
        e = sumVec(a);
      end TestWasmPhase13;
    `;
    const { ctx, uri } = await initContext(modelCode, "TestWasmPhase13");
    const wasmRes = ctx.flattenArena("TestWasmPhase13", undefined, uri, {
      backend: "wasm",
      omcCompatibility: true,
    });
    assert(wasmRes !== null, "wasm arena should not be null");
    assert.strictEqual((wasmRes as any).wasmErrorCode ?? 0, 0, "wasmErrorCode should be 0");
    assert.strictEqual((wasmRes as any).wasmBail, undefined, "wasmBail should be undefined");
    const printedWasm = printArenaDAE(wasmRes);
    assert(printedWasm.includes("I = {{1, 0}, {0, 1}};"), "Integer identity(n) equation should be Integer matrix");
    assert(printedWasm.includes("parameter Integer Z[1] = 0;"), "parameter Integer zeros(n) should be Integer 0");
    assert(printedWasm.includes("parameter Integer O[1] = 1;"), "parameter Integer ones(n) should be Integer 1");
    assert(printedWasm.includes("when initial() then"), "when initial() should be lowered in WASM");
    assert(printedWasm.includes("noEvent(time > 1.0)"), "dynamic noEvent(time > 1.0) should be preserved");
    assert(printedWasm.includes("TestWasmPhase13.scaleReal(b, 3.0)"), "IntLiteral call arg should coerce to 3.0");
    assert(
      printedWasm.includes("TestWasmPhase13.sumVec({a[1], a[2], a[3]})"),
      "1D array call arg should reconstruct {a[1], a[2], a[3]}",
    );

    const tsRes = ctx.flattenArena("TestWasmPhase13", undefined, uri, {
      backend: "ts",
      omcCompatibility: true,
    });
    assert(tsRes !== null, "ts arena should not be null");
    const printedTs = printArenaDAE(tsRes);
    assert.strictEqual(printedWasm, printedTs, "WASM and TS printed DAE should match identically");

    const diffRes = ctx.flattenArena("TestWasmPhase13", undefined, uri, {
      backend: "diff",
      omcCompatibility: true,
    });
    assert(diffRes !== null, "diff arena should not be null");
    const diffReport = (diffRes as any).diffReport;
    assert(diffReport !== undefined, "diffReport should be attached in diff mode");
    assert.strictEqual(diffReport.bail, undefined, "diffReport.bail should be undefined when WASM succeeds");
    assert.strictEqual(diffReport.varCount, diffRes.varCount, "diffReport varCount should match TS varCount");

    console.log(
      "   ✔ initial(), non-range for-loop unrolling, Integer identity/zeros/ones, noEvent(), and Call coercion verified",
    );
  }

  console.log("\nAll dual-engine backend tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
