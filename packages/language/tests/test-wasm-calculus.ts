// SPDX-License-Identifier: AGPL-3.0-or-later
import * as assert from "assert";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { analysis, choice, domain, field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("=== Testing WASM Extended Calculus & Symbolic Integration Engine ===");

  const calculusDsl = language({
    name: "CalculusWasmTest",
    rules: {
      Program: ($: any) => repeat($.Stmt),
      Stmt: ($: any) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Expr), ";"),
      Expr: ($: any) => choice($.Identifier, $.Number),
      Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
      Number: ($: any) => semanticToken("number", /[0-9]+/),
    },
    extras: ($: any) => [/\s+/],
    analysis: {
      systemSolver: analysis({
        domain: domain.dae({
          indexReduction: "pantelides",
          tearing: "minimum_degree",
          groebnerPreReduction: true,
        }),
      }),
    },
  });

  const result = buildParser(calculusDsl as any);
  const tmpDir = path.join(__dirname, "scratch_build_calculus_wasm");
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const file of result.assemblyScriptFiles) {
    fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
  }

  const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
  const wasmOut = path.join(tmpDir, "calculus.wasm");

  console.log("Compiling AssemblyScript to WASM via asc...");
  childProcess.execSync(
    `node ${ascPath} ${path.join(tmpDir, "parser.ts")} --target release --outFile ${wasmOut} --runtime stub --enable threads --exportRuntime`,
    { stdio: "inherit" },
  );

  const wasmBytes = fs.readFileSync(wasmOut);
  const wasmCompiled = await WebAssembly.compile(wasmBytes);

  const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
  const imports: any = {
    env: {
      memory,
      abort: (msg: any, file: any, line: any, col: any) => {
        try {
          if (typeof msg === "number") {
            const u16 = new Uint16Array(memory.buffer);
            const len = u16[(msg - 4) >> 1];
            let str = "";
            for (let i = 0; i < len; i++) {
              str += String.fromCharCode(u16[(msg >> 1) + i]);
            }
            msg = str;
          }
          console.error(`WASM Abort: '${msg}' at line ${line}, col ${col}`);
        } catch (e) {
          console.error(`WASM Abort: line ${line}, col ${col}`);
        }
      },
    },
    JavaScript: { debugLog: () => {}, logNode: () => {} },
    engine: { debugLog: () => {} },
    parser: { logInt: () => {} },
    recovery: {},
    host: { runHostQuery: () => {} },
  };

  const instance = await WebAssembly.instantiate(wasmCompiled, imports);
  const wasmExports: any = instance.exports;

  console.log("Checking exported WASM functions...");
  assert.ok(typeof wasmExports.cas_export_differentiate === "function", "cas_export_differentiate must be exported");
  assert.ok(typeof wasmExports.integrate_expr === "function", "integrate_expr must be exported");
  assert.ok(typeof wasmExports.taylor_series === "function", "taylor_series must be exported");
  assert.ok(typeof wasmExports.nth_derivative === "function", "nth_derivative must be exported");
  assert.ok(typeof wasmExports.limit_expr === "function", "limit_expr must be exported");

  const daePtr = wasmExports.dae_createBuilder();
  assert.ok(daePtr > 0, "dae_createBuilder should return valid pointer");

  // Variables
  const varX = wasmExports.dae_addVariable(daePtr, 1, 0, 0, 0, 0.0, 0); // x
  const xExpr = wasmExports.dae_addName(daePtr, varX);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Math function derivatives in WASM (d/dx sin(x), d/dx x^3, d/dx exp(x))
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Testing symbolic derivatives in WASM...");

  // d/dx sin(x) = cos(x)
  const sinX = wasmExports.dae_addExpression(daePtr, 7, 0, xExpr, 1); // BuiltinMathFunc.Sin = 0
  const dSinX = wasmExports.cas_export_differentiate(daePtr, sinX, varX);
  assert.ok(dSinX !== 0xffffffff);

  // d/dx x^3 = 3 * x^2
  const threeExpr = wasmExports.dae_addRealLiteral(daePtr, 3.0);
  const xCubed = wasmExports.dae_addBinaryExpr(daePtr, 5, xExpr, threeExpr); // BinOp.Pow = 5
  const dXCubed = wasmExports.cas_export_differentiate(daePtr, xCubed, varX);
  assert.ok(dXCubed !== 0xffffffff);

  // 2nd derivative: d^2/dx^2 x^3 = 6*x
  const d2XCubed = wasmExports.nth_derivative(daePtr, xCubed, varX, 2);
  assert.ok(d2XCubed !== 0xffffffff);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: Indefinite Symbolic Integration in WASM
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Testing symbolic integration in WASM...");

  // ∫ 2*x dx = x^2
  const twoExpr = wasmExports.dae_addRealLiteral(daePtr, 2.0);
  const twoX = wasmExports.dae_addBinaryExpr(daePtr, 2, twoExpr, xExpr); // BinOp.Mul = 2
  const intTwoX = wasmExports.integrate_expr(daePtr, twoX, varX);
  assert.ok(intTwoX !== 0xffffffff, "∫ 2x dx should succeed");

  // ∫ sin(x) dx = -cos(x)
  const intSinX = wasmExports.integrate_expr(daePtr, sinX, varX);
  assert.ok(intSinX !== 0xffffffff, "∫ sin(x) dx should succeed");

  // ∫ exp(x) dx = exp(x)
  const expX = wasmExports.dae_addExpression(daePtr, 7, 10, xExpr, 1); // BuiltinMathFunc.Exp = 10
  const intExpX = wasmExports.integrate_expr(daePtr, expX, varX);
  assert.ok(intExpX !== 0xffffffff, "∫ exp(x) dx should succeed");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: Taylor Series Expansion in WASM
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Testing Taylor series expansion in WASM...");
  // Taylor series of x^3 around x0=1 up to order 3
  const taylor3 = wasmExports.taylor_series(daePtr, xCubed, varX, 1.0, 3);
  assert.ok(taylor3 !== 0xffffffff, "Taylor series should succeed");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4: Symbolic Limits in WASM
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Testing symbolic limit in WASM...");
  // lim_{x -> 2} 2*x = 4.0
  const lim = wasmExports.limit_expr(daePtr, twoX, varX, 2.0);
  const limVal = wasmExports.cas_getRealValue(daePtr, lim);
  console.log("Limit result:", limVal);
  assert.strictEqual(Math.round(limVal), 4);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("=== All WASM Calculus & Integration Tests Passed Cleanly ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
