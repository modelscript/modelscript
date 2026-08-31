// SPDX-License-Identifier: AGPL-3.0-or-later
import * as assert from "assert";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { analysis, choice, domain, field, language, repeat, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("=== Testing WASM Symbolic Linear Algebra Engine ===");

  const linalgDsl = language({
    name: "LinalgWasmTest",
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

  const result = buildParser(linalgDsl as any);
  const tmpDir = path.join(__dirname, "scratch_build_linalg_wasm");
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const file of result.assemblyScriptFiles) {
    fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
  }

  const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
  const wasmOut = path.join(tmpDir, "linalg.wasm");

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
  assert.ok(typeof wasmExports.linalg_determinant === "function", "linalg_determinant must be exported");
  assert.ok(typeof wasmExports.linalg_solve_system === "function", "linalg_solve_system must be exported");
  assert.ok(typeof wasmExports.dae_createBuilder === "function", "dae_createBuilder must be exported");

  // 1. Create a DaeBuilder
  const daePtr = wasmExports.dae_createBuilder();
  assert.ok(daePtr > 0, "dae_createBuilder should return valid pointer");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Symbolic 2x2 and 3x3 Determinants
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Testing 2x2 determinant in WASM...");
  // Matrix 2x2: [[2, 1], [1, 3]] -> det = 2*3 - 1*1 = 5.0
  const mat2Ptr = wasmExports.dae_allocInt32Array(4);
  const l2 = wasmExports.dae_addRealLiteral(daePtr, 2.0);
  const l1 = wasmExports.dae_addRealLiteral(daePtr, 1.0);
  const l3 = wasmExports.dae_addRealLiteral(daePtr, 3.0);

  wasmExports.dae_setInt32(mat2Ptr, 0, l2);
  wasmExports.dae_setInt32(mat2Ptr, 1, l1);
  wasmExports.dae_setInt32(mat2Ptr, 2, l1);
  wasmExports.dae_setInt32(mat2Ptr, 3, l3);

  const det2Expr = wasmExports.linalg_determinant(daePtr, mat2Ptr, 2);
  const det2Val = wasmExports.cas_getRealValue(daePtr, det2Expr);
  console.log("2x2 det result:", det2Val);
  assert.strictEqual(Math.round(det2Val), 5);

  console.log("Testing 3x3 determinant in WASM...");
  // Matrix 3x3:
  // [[1, 2, 3],
  //  [0, 1, 4],
  //  [5, 6, 0]]
  // det = 1*(0 - 24) - 2*(0 - 20) + 3*(0 - 5) = -24 + 40 - 15 = 1.0
  const mat3Ptr = wasmExports.dae_allocInt32Array(9);
  const l0 = wasmExports.dae_addRealLiteral(daePtr, 0.0);
  const l4 = wasmExports.dae_addRealLiteral(daePtr, 4.0);
  const l5 = wasmExports.dae_addRealLiteral(daePtr, 5.0);
  const l6 = wasmExports.dae_addRealLiteral(daePtr, 6.0);

  wasmExports.dae_setInt32(mat3Ptr, 0, l1);
  wasmExports.dae_setInt32(mat3Ptr, 1, l2);
  wasmExports.dae_setInt32(mat3Ptr, 2, l3);

  wasmExports.dae_setInt32(mat3Ptr, 3, l0);
  wasmExports.dae_setInt32(mat3Ptr, 4, l1);
  wasmExports.dae_setInt32(mat3Ptr, 5, l4);

  wasmExports.dae_setInt32(mat3Ptr, 6, l5);
  wasmExports.dae_setInt32(mat3Ptr, 7, l6);
  wasmExports.dae_setInt32(mat3Ptr, 8, l0);

  const det3Expr = wasmExports.linalg_determinant(daePtr, mat3Ptr, 3);
  const det3Val = wasmExports.cas_getRealValue(daePtr, det3Expr);
  console.log("3x3 det result:", det3Val);
  assert.strictEqual(Math.round(det3Val), 1);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: Linear Algebraic Loop Solving (2x2)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Setting up Linear DAE system in WASM...");
  // 2x + 3y = 8
  // x - y = -1
  // Solution: x = 1, y = 2
  const varX = wasmExports.dae_addVariable(daePtr, 10, 0, 0, 0, 0.0, 0); // var 0
  const varY = wasmExports.dae_addVariable(daePtr, 11, 0, 0, 0, 0.0, 0); // var 1

  const xExpr = wasmExports.dae_addName(daePtr, varX);
  const yExpr = wasmExports.dae_addName(daePtr, varY);

  // Eq 0: 2*x + 3*y = 8
  const twoX = wasmExports.dae_addBinaryExpr(daePtr, 2, l2, xExpr); // BinOp.Mul = 2
  const threeY = wasmExports.dae_addBinaryExpr(daePtr, 2, l3, yExpr); // BinOp.Mul = 2
  const lhs0 = wasmExports.dae_addBinaryExpr(daePtr, 0, twoX, threeY); // BinOp.Add = 0
  const rhs0 = wasmExports.dae_addRealLiteral(daePtr, 8.0);
  const eq0 = wasmExports.dae_addEquation(daePtr, 0, lhs0, rhs0, 0xffffffff);

  // Eq 1: x - y = -1
  const lhs1 = wasmExports.dae_addBinaryExpr(daePtr, 1, xExpr, yExpr); // BinOp.Sub = 1
  const rhs1 = wasmExports.dae_addRealLiteral(daePtr, -1.0);
  const eq1 = wasmExports.dae_addEquation(daePtr, 0, lhs1, rhs1, 0xffffffff);

  const eqIdxsPtr = wasmExports.dae_allocInt32Array(2);
  const varIdxsPtr = wasmExports.dae_allocInt32Array(2);

  wasmExports.dae_setInt32(eqIdxsPtr, 0, eq0);
  wasmExports.dae_setInt32(eqIdxsPtr, 1, eq1);

  wasmExports.dae_setInt32(varIdxsPtr, 0, varX);
  wasmExports.dae_setInt32(varIdxsPtr, 1, varY);

  console.log("Running linalg_solve_system in WASM...");
  const success = wasmExports.linalg_solve_system(daePtr, eqIdxsPtr, 2, varIdxsPtr, 2);
  assert.strictEqual(success, 1, "linalg_solve_system should succeed");

  const rewrittenLhs0 = wasmExports.dae_getEqLhs(daePtr, 0);
  const rewrittenRhs0 = wasmExports.dae_getEqRhs(daePtr, 0);
  const rewrittenLhs1 = wasmExports.dae_getEqLhs(daePtr, 1);
  const rewrittenRhs1 = wasmExports.dae_getEqRhs(daePtr, 1);

  const val0 = wasmExports.cas_getRealValue(daePtr, rewrittenRhs0);
  const val1 = wasmExports.cas_getRealValue(daePtr, rewrittenRhs1);

  console.log("Rewritten Eq 0: lhs =", rewrittenLhs0, ", rhs val =", val0);
  console.log("Rewritten Eq 1: lhs =", rewrittenLhs1, ", rhs val =", val1);

  assert.strictEqual(Math.round(val0), 1, "x should solve to 1");
  assert.strictEqual(Math.round(val1), 2, "y should solve to 2");

  console.log("Symbolic Linear Algebra solver successfully solved the system in WASM!");

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("=== All WASM Symbolic Linalg Tests Passed Cleanly ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
